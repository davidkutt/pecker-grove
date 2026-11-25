import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface GitHead {
  commit: string | null;
  branch: string | null;
  reason?: string;
}

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The checked-out commit, read from `.git` files: Mode B has no git binary (D127). */
export async function gitHead(dir: string): Promise<GitHead | null> {
  const git = join(dir, '.git');
  const info = await stat(git).catch(() => undefined);
  if (!info) return null;
  // A worktree or submodule: its gitdir lies elsewhere, in Mode B outside the mount.
  if (!info.isDirectory()) return { commit: null, branch: null, reason: 'linked worktree' };
  const read = (path: string) => readFile(join(git, path), 'utf8').catch(() => '');
  const head = (await read('HEAD')).trim();
  if (SHA.test(head)) return { commit: head, branch: null };
  const ref = /^ref: (refs\/heads\/(\S+))$/.exec(head);
  if (!ref) return { commit: null, branch: null, reason: 'unreadable HEAD' };
  const [, path, branch] = ref;
  const packed = (await read('packed-refs')).split('\n').filter((l) => l.endsWith(` ${path}`));
  const commit = [(await read(path)).trim(), ...packed.map((l) => l.split(' ')[0])].find((s) =>
    SHA.test(s),
  );
  return commit ? { commit, branch } : { commit: null, branch, reason: 'no commit on the branch' };
}
