# Task: run the open hand checks of M3c.0 and M3c.1 on the daily stack

Written by the cross-project planning chat on 12 November 2026. For a Claude Code session **on David's
Mac, with David present**. A cloud session can't do this: D124 wants the checks on the daily stack.

Read first: `plan-daily-use.md` (D121–D126, M3c.0, M3c.1), `docs/setup/startup.md` (§4 "Your notes and
URLs as sources" and "Use the knowledge base from Claude Code / VS Code", §7 "Changing the Keycloak realm"
and "Backup and restore"), `plan-phase-3.md` D50.

## Goal

Tick the open boxes of M3c.0 and M3c.1 with evidence from the daily stack. Claude Code runs the commands
and checks the results; David approves the destructive step, logs in in the browser and rotates the
tokens. The only code change is `mem_limit` per Compose service.

## Who does what

| Step | Claude Code | David |
|---|---|---|
| 1 Keycloak database | Backup, recreate, compare documents and owners before and after | Says go before the drop |
| 2 `/mcp` login | Adds the server, runs the search | Logs in and consents in the browser; VS Code |
| 3 Notes | Counts notes, proposes the domain decision, runs the sync and the edit check | Decides the domain question, approves the sync cost, asks once in the web UI |
| 4 Memory | Measures Mode B, sets `mem_limit`, measures again | — |
| 5 GitHub tokens | Checks which variables are set | Rotates or clears them before 2026-11-18 |
| 6 Close-out | Ticks the boxes, opens the pull request | Reviews and merges |

## Steps

### 1. Recreate Keycloak's database

1. Record the state before: log in as each seed user (skill `user-token`) and note the number of documents
   per owner and of conversations. Keep the notes in `backups/` (git-ignored).
2. `pnpm stack:backup`. Check that the new file in `backups/` is not empty and contains all three
   databases.
3. Tell David what is lost (users registered in the app, admin-console edits, sessions, the Claude Code
   and VS Code consents) and wait for his go.
4. Run the three commands of startup.md §7 "Changing the Keycloak realm".
5. Check: every seed user logs in, the documents and conversations per owner match step 1, and `/mcp`
   answers 401 with a challenge without a token (startup.md §4).
6. If anything differs: stop, restore the backup (startup.md "Backup and restore") and report. Don't
   repair by hand.

### 2. Claude Code and VS Code log in to `/mcp`

1. Add the server as in startup.md. Keycloak needs internet for this login.
2. David runs `/mcp` → `grove-kb` → *Authenticate*, logs in and consents.
3. Call `search_knowledge_base` with a question the corpus can answer. Record the question, the number
   of hits and the first source.
4. David repeats the login in VS Code (startup.md). Tick the box only when both clients returned hits.

### 3. Notes: kickoff decision and hand check (M3c.1)

1. Check that `NOTES_DIR` is set (grep `^\s*NOTES_DIR=`; print the name, never a value from `.env`).
2. Count the notes: total, per top folder and per frontmatter `domains:`. Paths and counts only; don't
   print note text.
3. Propose the kickoff decision: is a tenth catch-all domain needed, or does `dev` as the default do?
   David decides. A new domain is code (both `Domain` enums, `taxonomy.yaml`, contracts): don't build it
   in this task, report it.
4. Before the first full sync, tell David the note count and the estimated cost (about 0.002 USD per
   note in `CONTEXTUAL_DOMAINS`) and wait for his go. Then *Sync notes and URLs*
   (`POST /api/admin/sources/sync`). Report added, updated, deleted and skipped; for notes the secret
   guard skipped, the path and the reason only.
5. The edit check, with a note of your own so David's notes stay untouched:
   - create `grove-hand-check.md` in `NOTES_DIR` with one sentence that occurs nowhere else, sync, and
     search for it from Claude Code; David asks the same in the web UI. Both cite the note;
   - change the sentence, sync: both answers cite the new text and not the old;
   - delete the note, sync: it is gone from the search and from the documents page.

### 4. Daily run mode and memory

1. Stop `pnpm dev`, start Mode B (`pnpm stack:up:full`).
2. Measure with `pnpm mem` and `sysctl vm.swapusage` at three points: idle after start, after a few
   searches (bge-m3 loaded), and at the peak while `data/sample-docs/slo-handbook.pdf` is ingested
   (Docling, contextual retrieval on). Upload it as a throwaway document and delete it afterwards.
3. Hold the numbers against D50 (AI service ≤ ~6 GB, Docker VM ≤ ~4 GB).
4. Add `mem_limit` to every service in `infra/compose/docker-compose.yml`: the measured peak plus
   headroom, rounded. Restart, repeat the PDF ingest, and confirm that no container was OOM-killed.
5. Only if D50 still fails: put Phoenix behind a Compose profile, after checking that the AI service
   starts and answers without it. Otherwise leave Phoenix alone.

### 5. GitHub tokens

Check whether `GITHUB_PAT_READ` and the other GitHub token variables are set (names only). David rotates
them before 2026-11-18 or clears them. If he clears them, confirm that the AI service starts and the agent
answers without the GitHub tools.

### 6. Close-out

- Tick in `plan-daily-use.md` only the boxes whose check ran on the daily stack today, each with the
  date and one line of evidence (counts, question and hits, memory numbers). Leave the rest open and
  say why.
- Update the status lines that mention the open M2.8 hand check (`README.md`, `CLAUDE.md`).
- One pull request: `mem_limit`, the plan and the status lines. `pnpm lint && pnpm test` pass.

## Rules

- Never `pnpm stack:reset`. Nothing destructive without a fresh backup and David's go.
- Never print a value from `.env`, a token, or the text of a note.
- Paid calls: the notes sync and the few hand-check questions, nothing else. Name the estimated cost
  first.
- Commands David has to type himself: give the bash form first, then the fish form.
- A check that fails stays unticked. Report what you saw; fixes that need code are a new task.

## Acceptance checks

- [ ] Documents and conversations per owner are the same before and after the Keycloak recreate.
- [ ] Claude Code and VS Code each returned hits from `search_knowledge_base` after a browser login.
- [ ] The edit check passed all three stages (new, changed, deleted) in Claude Code and in the web UI.
- [ ] The kickoff decision on the catch-all domain is recorded in `plan-daily-use.md`.
- [ ] Every Compose service has a `mem_limit`, and the PDF ingest ran under the limits without an OOM
      kill; the three measurements are in the pull request.
- [ ] The GitHub tokens are rotated or cleared, or the box is left open with the date it is due.
- [ ] `plan-daily-use.md` has a dated line of evidence for every box ticked.

## Out of scope

- M3c.2 and later. M3c.2 is reserved for nest.
- A new domain, a login for Pi (pecker-nest `docs/tasks/grove-kb.md`) and any realm change.
- Tuning retrieval or changing the frozen parts (reranker, priorities, HyDE, router, Docling).

## Pull request

Title `chore(infra): memory limits and M3c.0/M3c.1 hand checks`. Description: the before-and-after
counts, the search evidence, the three memory measurements with the limits chosen, and what is still
open. Never merge it yourself.
