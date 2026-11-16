# Task: Cursor setup for Grove

Written by the planning chat on 16 November 2026 against `main` at `ba97ff5`. Claude Code does this task. Commit this brief as `docs/tasks/cursor-setup.md` in the first commit of your pull request. `AGENTS.md` applies in full: pull request only, never merge, commands for David in bash first and fish second.

## Goal

David works on Grove in Cursor (Grok 4.7) as well as in Pi (nest) and Claude Code. Grove already has `.pi/gate.json` and `.pi/protect.json`; hooks built in pecker-nest will apply both in Cursor. This task adds the few things Cursor needs inside this repository. It does not restructure `AGENTS.md`.

## What we know

| Fact | Source |
| --- | --- |
| `.pi/protect.json` lists the read-protected paths (`.env` and its local variants, `backups/`, `evals/local/`), the write-protected paths and the blocked commands. | this repository |
| `.cursorignore` blocks Cursor's own file tools, but not terminal commands or MCP tools. | cursor.com/docs/context/ignore-files, read 16.11.2026 |
| Cursor loads the root `AGENTS.md` in full on every request, and since version 3.6 it also loads nested `AGENTS.md` files from the whole repository. | Cursor forum, staff answer, read 16.11.2026 |
| Rules in `.cursor/rules/*.mdc` are read by Cursor only. Pi and Claude Code would not see anything moved there. | cursor.com/docs/rules |
| Cursor loads the skills in `.claude/skills/`. | cursor.com/docs/skills |
| The Angular CLI ships an MCP server (`ng mcp`) with `get_best_practices`, `search_documentation` and `find_examples`, and a `--read-only` switch. | angular.dev/ai/mcp, read 16.11.2026 |

## Work

1. **`.cursorignore`:** the paths of the `read` list in `.pi/protect.json`, in ignore-file syntax. `.env.example` stays readable. Add a comment that the list mirrors `.pi/protect.json` and that terminal commands are stopped by the hook, not by this file.

2. **`AGENTS.md`, one new section "Working in Cursor"** next to "Working in Pi (nest)", as short as that one:
   - hooks apply `.pi/protect.json` and run `.pi/gate.json` after code changes; a block is reported to David with its reason, never worked around;
   - an agent never edits `.pi/`, `.cursorignore` or `.cursor/hooks.json`;
   - `git push` of a feature branch asks David for confirmation; everything else in the Workflow section applies unchanged;
   - tests run with `LLM_PROVIDER=fake`, as in Pi.

   Change nothing else in the file.

3. **`.cursor/mcp.json`:** the Angular CLI MCP server in read-only mode, started through the workspace's own installed CLI so its version matches `apps/web`. No experimental tools. No secret and no machine-specific path in the file.

4. **Findings, in `docs/research/cursor-tooling.md`,** each row with a source and read date:
   - **Context7** (or an equivalent) for NestJS, FastAPI and the other libraries newer than the models: who runs it, what it sends, whether it needs a key, and a recommendation. Do not add it in this pull request.
   - **Grove's own `/mcp` in Cursor:** which client id Cursor's MCP client presents (host of its metadata document, or dynamic registration), and what the realm would need for it. Read ADR-0014 and the realm file; change neither.
   - **Size of `AGENTS.md`:** its size in tokens, and which sections Cursor could do without on most requests. Propose at most one change that keeps the file fully usable for Pi and Claude Code, or say that none is worth it.

5. **`.gitignore`:** `.cursorignore` and `.cursor/mcp.json` are tracked; nothing else under `.cursor/` is.

## Rules

- Do not move content from `AGENTS.md` into `.cursor/rules/`. Three tools read that file.
- No change to `.pi/`, the realm, the stack or application code.
- `pnpm lint && pnpm test` pass.

## David's part

Review and merge. Then, once the adapter from pecker-nest is installed, the hand checks in `cursor-handschritte.md`.

## Acceptance checks

- [ ] `.cursorignore` and the `read` list name the same paths, and `.env.example` is still readable.
- [ ] `AGENTS.md` gained one section and lost nothing.
- [ ] `.cursor/mcp.json` starts the Angular server read-only from the workspace's CLI.
- [ ] Every row of the findings file has a source; each of the three topics ends with one recommendation.

## Out of scope

The hooks, Cursor's user rule, the reviewer subagent and shared skills (all in pecker-nest); moving skills to `.agents/skills/`; any change to how Pi or Claude Code work here.
