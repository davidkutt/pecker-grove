import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const schema = z.object({
  API_PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_DATABASE_URL: z.string().min(1), // `:memory:` = in-process PGlite (tests)
  KEYCLOAK_ISSUER: z.url().default('http://localhost:8080/realms/kb'),
  // Where the API reaches the realm (JWKS, token); differs from the issuer inside Compose.
  KEYCLOAK_REALM_URL: z.url().optional(),
  KEYCLOAK_AUDIENCE: z.string().default('kb-api'),
  KEYCLOAK_CLIENT_ID: z.string().default('kb-api'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  AI_SERVICE_URL: z.url().default('http://localhost:8000'),
  AI_SERVICE_AUDIENCE: z.string().default('kb-ai'), // hop-1 token exchange (ADR-0009)
  // `kb.ingest_url` fetches only from these hosts (`host[:port]`, D36).
  INGEST_URL_ALLOWED_HOSTS: z
    .string()
    .default('raw.githubusercontent.com')
    .transform((hosts) => hosts.split(',').map((host) => host.trim())),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(20),
  // M3c.1: Markdown notes kept in sync as documents (absolute path; empty = none), and how often
  // notes and fetched URLs sync after the one at boot (0 = only at boot and on demand).
  NOTES_DIR: z.string().default(''),
  // `label=folder` pairs, folders inside NOTES_DIR (one mount in Mode B), each synced as
  // `<label>:<path>`; empty = NOTES_DIR itself as `notes`.
  NOTES_SOURCES: list(
    /^(?!https?=)[a-z][a-z0-9-]*=(?!.*\.\.)[^=]+$/,
    'label=folder: lowercase label other than http/https, a folder inside NOTES_DIR',
  ),
  // `<label>:<path>` (a folder or a note) left out of the sync.
  NOTES_EXCLUDE: list(/^[a-z][a-z0-9-]*:.+$/, '<label>:<path>').transform((paths) =>
    paths.map((path) => path.replace(/\/+$/, '')),
  ),
  // `git pull --ff-only` in each source that is a git checkout, before its sync (Mode A only).
  NOTES_GIT_PULL: z.stringbool().default(false),
  SOURCES_SYNC_MINUTES: z.coerce.number().nonnegative().default(15),
  CHAT_THROTTLE_PER_MIN: z.coerce.number().int().positive().default(20),
  // LLM cost per user and UTC day by highest role (D44); once reached, LLM relays answer 429.
  DAILY_COST_CAP_USD_VIEWER: z.coerce.number().nonnegative().default(0.2),
  DAILY_COST_CAP_USD_EDITOR: z.coerce.number().nonnegative().default(1),
  DAILY_COST_CAP_USD_ADMIN: z.coerce.number().nonnegative().default(5),
  // The repo's file, from src/ and dist/ alike; the image sets its own path.
  TAXONOMY_CONFIG: z
    .string()
    .default(fileURLToPath(new URL('../../../config/taxonomy.yaml', import.meta.url))),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((origins) => origins.split(',').map((origin) => origin.trim())),
});

const checked = schema
  .refine((c) => !c.NOTES_SOURCES.length || c.NOTES_DIR, {
    path: ['NOTES_SOURCES'],
    message: 'needs NOTES_DIR, the folder that holds the sources',
  })
  // A second source under one label would delete the first one's notes.
  .refine(
    (c) => new Set(c.NOTES_SOURCES.map((s) => s.split('=')[0])).size === c.NOTES_SOURCES.length,
    {
      path: ['NOTES_SOURCES'],
      message: 'labels must be unique',
    },
  );

function list(pattern: RegExp, message: string) {
  return z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(pattern, message)));
}

export type Config = z.infer<typeof schema>;
export const CONFIG = Symbol('CONFIG');

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => checked.parse(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}
