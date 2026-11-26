import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { isNotNull } from 'drizzle-orm';
import { load } from 'js-yaml';
import { z } from 'zod';
import { AiClient, type Domain } from '../ai-client/ai-client.service.js';
import { DOMAINS, DomainSchema } from '../catalog/taxonomy.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Db } from '../db/db.module.js';
import { type Document, documents } from '../db/schema.js';
import { DocumentsService, type Upload } from './documents.service.js';
import { gitHead } from './git-head.js';

const Skipped = z.object({ source: z.string(), reason: z.string() });
export const SyncResult = z
  .object({
    added: z.array(z.string()),
    updated: z.array(z.string()),
    deleted: z.array(z.string()),
    unchanged: z.int(),
    skipped: z.array(Skipped),
  })
  .meta({ id: 'SourcesSync' });
export type SyncResult = z.infer<typeof SyncResult>;

// snake_case like the other API → AI service bodies: pushed to the AI service as it is (D127).
const Folder = SyncResult.extend({
  label: z.string(),
  git: z
    .object({
      commit: z.string().nullable(),
      branch: z.string().nullable(),
      reason: z.string().optional(),
      pull: z.enum(['ok', 'failed', 'off']),
      pull_error: z.string().optional(),
    })
    .nullable(),
  excluded: z.array(z.string()),
  notes: z.int(),
  documents: z.object({
    ready: z.int(),
    in_progress: z.int(),
    failed: z.array(z.object({ source: z.string(), error: z.string() })),
  }),
});
type Folder = z.infer<typeof Folder>;
export const SourcesStatus = z
  .object({
    started_at: z.iso.datetime(),
    finished_at: z.iso.datetime(),
    interval_minutes: z.number(),
    error: z.string().optional(),
    folders: z.array(Folder),
    urls: z.object({ refreshed: z.array(z.string()), skipped: z.array(Skipped) }),
  })
  .meta({ id: 'SourcesStatus' });
export type SourcesStatus = z.infer<typeof SourcesStatus>;

const NOTES = { sub: 'notes', name: 'Notes folder' };
// shortcut: notes without frontmatter domains or a domain-named top folder; becomes the catch-all
// domain if the M3c.1 kickoff adds one.
const DEFAULT_DOMAINS: Domain[] = ['dev'];
// A page whose markup changes on every fetch is re-ingested (and re-contextualized) at most daily.
const URL_REFRESH_MS = 24 * 60 * 60 * 1000;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const Frontmatter = z.object({
  domains: z
    .array(DomainSchema)
    .min(1)
    .or(DomainSchema.transform((domain) => [domain]))
    .optional(),
  topics: z
    .array(z.string())
    .or(z.string().transform((topic) => [topic]))
    .optional(),
});
// The sync runs unattended and sends whole notes to the LLM and the traces: a note with one of these
// stays out (M3c.1).
const SECRETS: Record<string, RegExp> = {
  'a private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'an AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
  'a GitHub token': /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,})/,
  'an API key (sk-…)': /\bsk-[\w-]{20,}/,
  'a Slack token': /\bxox[abprs]-[\w-]{10,}/,
  'a Google API key': /\bAIza[\w-]{35}/,
  'a JWT': /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
};

/** Keeps the documents of the notes folders and fetched URLs in step with their sources (M3c.1). */
@Injectable()
export class SourcesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SourcesService.name);
  private running?: Promise<SyncResult>;
  private timer?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private runs = 0;
  private last?: SourcesStatus;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    private readonly documents: DocumentsService,
    private readonly ai: AiClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.tick();
    const minutes = this.config.SOURCES_SYNC_MINUTES;
    if (minutes) this.timer = setInterval(() => void this.tick(), minutes * 60_000).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.retry);
  }

  /** One sync at a time: a call during a running one gets that one's result. */
  sync(requestId = 'sources-sync'): Promise<SyncResult> {
    this.running ??= this.run(requestId).finally(() => (this.running = undefined));
    return this.running;
  }

  /** The last run's status with document counts as they are now; null until a run has ended. */
  async status(requestId: string): Promise<SourcesStatus | null> {
    if (!this.last) return null;
    return { ...this.last, folders: await this.counted(this.last.folders, requestId) };
  }

  private async tick(): Promise<void> {
    try {
      const { added, updated, deleted, skipped } = await this.sync();
      if (added.length || updated.length || deleted.length || skipped.length) {
        const counts = `${added.length} added, ${updated.length} updated, ${deleted.length} deleted`;
        this.logger.log(`Sources: ${counts}, ${skipped.length} skipped`);
      }
    } catch (error) {
      this.logger.warn(`Sources sync failed: ${String(error)}`);
    }
  }

  /** Every run ends with a status pushed to the AI service, a failed one too (D127). */
  private async run(requestId: string): Promise<SyncResult> {
    const run = ++this.runs;
    const status: SourcesStatus = {
      started_at: new Date().toISOString(),
      finished_at: '',
      interval_minutes: this.config.SOURCES_SYNC_MINUTES,
      folders: [],
      urls: { refreshed: [], skipped: [] },
    };
    try {
      return await this.walk(status, requestId);
    } catch (error) {
      status.error = reason(error);
      throw error;
    } finally {
      status.finished_at = new Date().toISOString();
      this.last = status;
      void this.push(status, run, requestId);
    }
  }

  /** Retried every 30 s until the next run starts: at boot the AI service is often still loading. */
  private async push(status: SourcesStatus, run: number, requestId: string): Promise<void> {
    if (run !== this.runs) return;
    try {
      await this.ai.putSourcesStatus(status, requestId);
    } catch (error) {
      this.logger.warn(`Sources status not reported, retry in 30 s: ${reason(error)}`);
      this.retry = setTimeout(() => void this.push(status, run, requestId), 30_000).unref();
    }
  }

  /** Sets `status.folders` and `status.urls` once all is done; the result is merged from them. */
  private async walk(status: SourcesStatus, requestId: string): Promise<SyncResult> {
    const rows = await this.db.select().from(documents).where(isNotNull(documents.source));
    const known = new Set(rows.map((doc) => doc.source));
    const put = async (
      result: SyncResult,
      source: string,
      owner: { sub: string; name: string },
      read: () => Promise<{ file: Upload; domains: Domain[]; topics: string[] }>,
    ) => {
      try {
        const { file, domains, topics } = await read();
        const { changed } = await this.documents.fromSource(
          owner,
          source,
          file,
          domains,
          topics,
          requestId,
        );
        if (!changed) result.unchanged++;
        else (known.has(source) ? result.updated : result.added).push(source);
      } catch (error) {
        result.skipped.push({ source, reason: reason(error) });
      }
    };

    const exclude = this.config.NOTES_EXCLUDE;
    const included = (source: string) =>
      !exclude.some((x) => source === x || source.startsWith(`${x}/`));
    const done: Folder[] = [];
    for (const { label, dir } of folders(this.config)) {
      const prefix = `${label}:`;
      const excluded = exclude
        .filter((x) => x.startsWith(prefix))
        .map((x) => x.slice(prefix.length));
      const folder: Folder = { ...tally(), label, git: null, excluded, notes: 0, documents: NONE };
      done.push(folder);
      const skip = (error: unknown) =>
        folder.skipped.push({ source: prefix, reason: reason(error) });
      let git: Pick<NonNullable<Folder['git']>, 'pull' | 'pull_error'> = { pull: 'off' };
      if (this.config.NOTES_GIT_PULL && existsSync(join(dir, '.git'))) {
        git = await pull(dir).then(
          () => ({ pull: 'ok' }),
          (error: unknown) => ({ pull: 'failed', pull_error: reason(error) }),
        );
      }
      // After the pull: the commit the notes below are read from.
      const head = await gitHead(dir);
      folder.git = head && { ...head, ...git };
      const found = await notes(dir).catch((error: unknown) => void skip(error));
      if (!found) continue;
      const paths = found.filter((path) => included(prefix + path));
      folder.notes = paths.length;
      for (const path of paths) {
        await put(folder, prefix + path, NOTES, () => note(dir, prefix, path));
      }
      const seen = new Set(paths.map((path) => prefix + path));
      const gone = rows.filter((doc) => doc.source!.startsWith(prefix) && !seen.has(doc.source!));
      if (!paths.length && gone.length) {
        // An unmounted or emptied folder must not wipe the knowledge base.
        skip(`${dir} has no notes; its ${gone.length} indexed ones stay`);
      } else {
        for (const doc of gone) await this.remove(doc, requestId, folder);
      }
    }

    const urls = tally();
    const cutoff = Date.now() - URL_REFRESH_MS;
    const due = rows.filter(
      (row) => /^https?:\/\//.test(row.source!) && row.updatedAt.getTime() <= cutoff,
    );
    for (const doc of due) {
      await put(urls, doc.source!, { sub: doc.ownerId, name: doc.ownerName }, async () => ({
        file: await this.documents.fetch(doc.source!),
        domains: doc.domains as Domain[],
        topics: doc.topics,
      }));
    }

    status.folders = await this.counted(done, requestId);
    const failed = new Set(urls.skipped.map((s) => s.source));
    status.urls = {
      refreshed: due.map((doc) => doc.source!).filter((source) => !failed.has(source)),
      skipped: urls.skipped,
    };
    // SyncResult lists a failed pull as skipped, as before D127.
    const parts: SyncResult[] = done.map(({ label, git, ...folder }) => ({
      ...folder,
      skipped: [
        ...(git?.pull_error ? [{ source: `${label}:`, reason: git.pull_error }] : []),
        ...folder.skipped,
      ],
    }));
    parts.push(urls);
    return {
      added: parts.flatMap((p) => p.added),
      updated: parts.flatMap((p) => p.updated),
      deleted: parts.flatMap((p) => p.deleted),
      unchanged: parts.reduce((sum, p) => sum + p.unchanged, 0),
      skipped: parts.flatMap((p) => p.skipped),
    };
  }

  /** Each folder's documents as they are now, by source prefix. */
  private async counted(folders: Folder[], requestId: string): Promise<Folder[]> {
    const docs = await this.documents.list(requestId);
    return folders.map((folder) => {
      const own = docs.filter((doc) => doc.source?.startsWith(`${folder.label}:`));
      const failed = own.filter((doc) => doc.status === 'failed');
      const ready = own.filter((doc) => doc.status === 'ready').length;
      return {
        ...folder,
        documents: {
          ready,
          in_progress: own.length - ready - failed.length,
          failed: failed.map((doc) => ({ source: doc.source!, error: doc.error ?? '' })),
        },
      };
    });
  }

  private async remove(doc: Document, requestId: string, result: SyncResult): Promise<void> {
    try {
      await this.documents.remove({ ...NOTES, roles: [] }, doc.id, requestId);
      result.deleted.push(doc.source!);
    } catch (error) {
      result.skipped.push({ source: doc.source!, reason: reason(error) });
    }
  }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const tally = (): SyncResult => ({
  added: [],
  updated: [],
  deleted: [],
  unchanged: 0,
  skipped: [],
});
const NONE: Folder['documents'] = { ready: 0, in_progress: 0, failed: [] };

function folders({ NOTES_DIR, NOTES_SOURCES }: Config): { label: string; dir: string }[] {
  if (!NOTES_SOURCES.length) return NOTES_DIR ? [{ label: 'notes', dir: NOTES_DIR }] : [];
  return NOTES_SOURCES.map((pair) => {
    const [label, folder] = pair.split('=');
    return { label, dir: join(NOTES_DIR, folder) };
  });
}

/** Unattended: no prompt for credentials, no repository hooks, and a time limit. */
async function pull(dir: string): Promise<void> {
  const args = ['-C', dir, '-c', 'core.hooksPath=/dev/null', 'pull', '--ff-only', '--quiet'];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  await promisify(execFile)('git', args, { env, timeout: 60_000 }).catch((error: unknown) => {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git pull: ${stderr || reason(error)}`);
  });
}

/** `*.md` below `dir` as POSIX paths, without hidden files and folders (`.obsidian`, `.git`). */
async function notes(dir: string): Promise<string[]> {
  const paths = await readdir(dir, { recursive: true });
  return paths
    .map((path) => path.split(sep))
    .filter((parts) => parts.at(-1)!.endsWith('.md') && !parts.some((p) => p.startsWith('.')))
    .map((parts) => parts.join('/'))
    .sort();
}

/** Domains from the frontmatter, else a top folder named after a domain, else the default. */
async function note(dir: string, prefix: string, path: string) {
  const buffer = await readFile(join(dir, path));
  const text = buffer.toString('utf8');
  const secret = Object.keys(SECRETS).find((kind) => SECRETS[kind].test(text));
  if (secret) throw new Error(`Looks like it holds ${secret}; not sent to the knowledge base`);
  const frontmatter = FRONTMATTER.exec(text);
  const front = Frontmatter.safeParse((frontmatter && load(frontmatter[1])) ?? {});
  if (!front.success) throw new Error(`Frontmatter: ${z.prettifyError(front.error)}`);
  const top = path.includes('/') ? path.split('/')[0] : undefined;
  const folder = DOMAINS.find((domain) => domain === top);
  // Indexed, the frontmatter took a search hit of its own; domains and topics are stored apart.
  const body = frontmatter ? Buffer.from(text.slice(frontmatter[0].length)) : buffer;
  return {
    // Named by source: citations show only this, and many notes share a file name like README.md.
    file: { originalname: prefix + path, buffer: body, size: body.length },
    domains: front.data.domains ?? (folder ? [folder] : DEFAULT_DOMAINS),
    topics: front.data.topics ?? [],
  };
}
