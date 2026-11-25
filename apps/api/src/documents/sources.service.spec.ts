import { Logger } from '@nestjs/common';
import type { AiClient } from '../ai-client/ai-client.service.js';
import type { Config } from '../config.js';
import type { Db } from '../db/db.module.js';
import type { DocumentsService } from './documents.service.js';
import { SourcesService, type SourcesStatus } from './sources.service.js';

describe('SourcesService status push', () => {
  const rows = vi.fn(async () => []);
  const put = vi.fn(async (_status: SourcesStatus, _requestId: string) => undefined);
  const pushed = () => put.mock.calls.map(([status]) => status);
  let sources: SourcesService;

  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => {
    vi.useFakeTimers();
    put.mockReset();
    const db = { select: () => ({ from: () => ({ where: rows }) }) } as unknown as Db;
    const config = { NOTES_EXCLUDE: [], NOTES_SOURCES: [], SOURCES_SYNC_MINUTES: 0 } as unknown;
    const documents = { list: async () => [] } as unknown as DocumentsService;
    const ai = { putSourcesStatus: put } as unknown as AiClient;
    sources = new SourcesService(db, config as Config, documents, ai);
  });
  afterEach(() => {
    sources.onModuleDestroy();
    vi.useRealTimers();
  });

  it('pushes after an unchanged run and after a failed one', async () => {
    await sources.sync();
    rows.mockRejectedValueOnce(new Error('Postgres down'));
    await expect(sources.sync()).rejects.toThrow('Postgres down');

    const [unchanged, failed] = pushed();
    expect(unchanged).toMatchObject({ interval_minutes: 0, folders: [] });
    expect(unchanged).not.toHaveProperty('error');
    expect(failed).toMatchObject({ error: 'Postgres down', folders: [] });
    expect(await sources.status('r')).toEqual(failed);
  });

  it('retries a failed push every 30 s until it lands or the next run starts, never throwing', async () => {
    put.mockRejectedValueOnce(new Error('AI service unreachable'));
    await sources.sync();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(pushed()).toHaveLength(2);
    expect(pushed()[1]).toBe(pushed()[0]);

    put.mockRejectedValueOnce(new Error('AI service unreachable'));
    await sources.sync();
    await sources.sync();
    await vi.advanceTimersByTimeAsync(90_000);

    const [, , stale, latest] = pushed();
    expect(pushed()).toHaveLength(4);
    expect(latest).not.toBe(stale);
  });
});
