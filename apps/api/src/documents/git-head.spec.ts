import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitHead } from './git-head.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(64);

describe('gitHead', () => {
  let dir: string;
  const write = async (path: string, text: string) => {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  };

  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'head-'))));
  afterEach(() => rm(dir, { recursive: true }));

  it('reads a loose ref', async () => {
    await write('.git/HEAD', 'ref: refs/heads/main\n');
    await write('.git/refs/heads/main', `${A}\n`);

    expect(await gitHead(dir)).toEqual({ commit: A, branch: 'main' });
  });

  it('falls back to packed-refs, also for SHA-256 repositories', async () => {
    await write('.git/HEAD', 'ref: refs/heads/feat/x\n');
    await write(
      '.git/packed-refs',
      `# pack-refs with: peeled\n${A} refs/heads/main\n${B} refs/heads/feat/x\n`,
    );

    expect(await gitHead(dir)).toEqual({ commit: B, branch: 'feat/x' });
  });

  it('reads a detached HEAD', async () => {
    await write('.git/HEAD', `${A}\n`);

    expect(await gitHead(dir)).toEqual({ commit: A, branch: null });
  });

  it('gives no commit for a linked worktree, an unborn branch or a garbage HEAD', async () => {
    await write('.git', 'gitdir: /elsewhere/.git/worktrees/notes\n');
    expect(await gitHead(dir)).toEqual({ commit: null, branch: null, reason: 'linked worktree' });

    await rm(join(dir, '.git'));
    await write('.git/HEAD', 'ref: refs/heads/main\n');
    expect(await gitHead(dir)).toEqual({
      commit: null,
      branch: 'main',
      reason: 'no commit on the branch',
    });

    await write('.git/HEAD', 'not a ref\n');
    expect(await gitHead(dir)).toEqual({ commit: null, branch: null, reason: 'unreadable HEAD' });
  });

  it('is null without .git', async () => {
    expect(await gitHead(dir)).toBeNull();
  });
});
