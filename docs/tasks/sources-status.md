# Task: report what the knowledge base has indexed (sources status)

Written by the cross-project planning chat on 25 November 2026. Claude Code does this task. pecker-nest has a
follow-up task (`docs/tasks/kb-sources-status.md` there) that uses the MCP tool built here.

Read first: `AGENTS.md`, `plan-daily-use.md` (D121–D126, M3c.1), `apps/api/src/documents/sources.service.ts`,
`sources.controller.ts`, `internal.controller.ts`, `apps/api/src/ai-client/ai-client.service.ts`,
`apps/ai-service/src/ai_service/mcp_server.py`, `core/auth.py`, `main.py`, `docs/setup/startup.md` (§4
"Your notes and URLs as sources", "Use the knowledge base from Claude Code / VS Code", §7).

## Problem

David can't tell what grove has indexed from his notes repositories (the labelled folders in `NOTES_DIR`):
whether a merge reached the index, whether a note was skipped, whether an ingest failed. Today:

- `SourcesService.run()` returns a `SyncResult`, but the interval and boot runs only log counts
  (`Sources: 1 added, 0 updated, 0 deleted, 1 skipped`). The result is gone after that.
- Grove doesn't record which commit of a checkout it read.
- A failed `git pull --ff-only` (feature branch checked out, diverged, offline) lands in `skipped` as
  `<label>:`, and the sync continues with the old files. Only that one log line shows it.
- In Mode B `NOTES_GIT_PULL` is off, so a checkout only moves when David pulls it himself.
- A note can be left out by `NOTES_EXCLUDE`, skipped (frontmatter, unknown topic, secret pattern) or fail in
  the AI service's ingest. The web UI shows only the last of these.

## Goal

After every sync, grove knows per notes folder which commit it read, whether the pull worked, what it
added, changed, deleted, excluded and skipped, and which documents are still in progress or failed. David
sees this on the documents page; MCP clients (Claude Code, VS Code, Pi in pecker-nest) get it from a new
`kb:read` tool `index_status`.

## Decisions (made; don't reopen)

| Id | Decision | Why |
| --- | --- | --- |
| S1 | **The API pushes the status to the AI service** after every run. The MCP tool returns the last pushed status. | The status lives in the API, the MCP server in the AI service. A pull from the AI service would need a new client role for `kb-ai`: a realm change, a Keycloak database recreate and new logins for Claude Code, VS Code and Pi. The push uses the existing API → AI service hop with the API's service account. |
| S2 | **In memory on both sides.** No migration. | The API syncs at boot. After a restart of the AI service the status returns with the next run (at most `SOURCES_SYNC_MINUTES`). |
| S3 | **The commit is read from `.git` files, not with the `git` binary.** | Mode B mounts the notes read-only into an image without git. |
| S4 | **Grove doesn't check uncommitted changes or the remote.** | Without git it can't. pecker-nest's `doctor.sh` checks these on the host, where git, `gh` and the network are available. |

Record S1–S4 as **D127** in `plan-daily-use.md` §2. No ADR: the push uses the API → AI service hop that D36
and ADR-0009 already describe.

## Contract

Zod in the API (`.meta({ id: 'SourcesStatus' })`), the matching pydantic model in the AI service. Use the
naming convention the existing API → AI service models use; the shape is:

```
SourcesStatus
  startedAt, finishedAt     ISO timestamps of the run
  intervalMinutes           SOURCES_SYNC_MINUTES (0 = boot and "Sync now" only)
  error?                    the run itself failed (e.g. Postgres down); folders may be empty
  folders[]
    label                   as in NOTES_SOURCES, or "notes"
    git                     null when the folder is no checkout, else:
      commit                full hex SHA (40 or 64), or null
      branch                null when detached or unknown
      reason?               why commit is null ("linked worktree", "unreadable HEAD", …)
      pull                  "ok" | "failed" | "off"
      pullError?            stderr of the failed pull, as SyncResult has it today
    excluded[]              this label's NOTES_EXCLUDE paths, without the "<label>:" prefix
    notes                   number of notes found after exclusion
    added[], updated[], deleted[]   sources of this run
    unchanged               count
    skipped[]               { source, reason }, including the "folder has no notes" guard
    documents               from Postgres, by source prefix, at the end of the run:
      ready                 count
      inProgress            count of pending|queued|parsing|contextualizing|embedding
      failed[]              { source, error }
  urls
    refreshed[]             URL sources re-fetched in this run
    skipped[]               { source, reason }
```

`SyncResult` and `POST /api/admin/sources/sync` keep their shape: the web UI and the contracts depend on
them.

## Steps

1. **Read the checkout's commit** (`apps/api/src/documents/`, a small pure module with its own spec):
   `.git` is a directory → read `HEAD`; `ref: refs/heads/<b>` → branch `<b>`, SHA from `refs/heads/<b>` or
   else the matching line in `packed-refs`; a bare SHA → detached. `.git` is a file (worktree, submodule) →
   commit null, reason `linked worktree`; in Mode B its gitdir lies outside the mount anyway. No `.git` →
   `git: null`. Read it **after** the pull and before the notes, so the commit is the one the notes came
   from.
2. **Build the status in `run()`** next to `SyncResult`, per folder as in the contract. Wrap the whole run
   so that a thrown error still yields a status with `error`. Keep the last status in the service.
3. **Push after every run**: boot, interval and "Sync now", also when nothing changed and when the run
   failed. `AiClient` sends `PUT /v1/sources/status` as the API's service account (empty subject). A failed
   push is logged as a warning and retried every 30 seconds until it succeeds or the next run starts:
   at boot the AI service is often still loading its models.
4. **AI service route** `PUT /v1/sources/status` (behind `ServiceAuth` like every `/v1` router): accepts
   **only the API's service account**. Refuse an exchanged user token (also `aud=kb-ai`) with 403. Find the
   claim that separates the two in Keycloak 26.8 tokens and test both cases. **If they cannot be told apart
   without a realm change, stop and report; don't change the realm.** Keep the body and the time it arrived
   in `app.state`; answer 204.
5. **MCP tool `index_status`** in `mcp_server.py`, no parameters, `_claims("viewer")`, scope `kb:read`.
   Returns `{ reportedAt, status, note }`: the last pushed status, or `status: null` with a note like
   "No sync reported since the AI service started at <time>; the API reports after every sync." Docstring
   (the model sees it): what the knowledge base has indexed from each notes folder (commit and branch it
   read, last sync, skipped notes with reasons, failed documents). Use it before concluding that the
   knowledge base has nothing on a topic.
6. **Admin route and web UI.** `GET /api/admin/sources/status` (`@Roles('admin')`, in `SourcesController`)
   returns the last status with `documents` recomputed at request time, so the page is live. On the
   documents page, next to *Sync notes and URLs*, one line per folder, for example
   `ressources · a1b2c3d (main) · pull ok · synced 14:20 · 1 skipped · 0 failed`. The skipped and failed
   lists expand. Refresh after a sync. Admins only, like the sync button.
7. **Contracts:** `pnpm contracts:generate`, commit `packages/contracts`.
8. **Tests** (`LLM_PROVIDER=fake`, no paid calls):
   - API unit: the commit reader (loose ref, packed ref, detached, `.git` file, no `.git`, garbage `HEAD`);
     status per folder with excluded, skipped and the empty-folder guard; push after an unchanged run and
     after a failed run; a failed push is retried and never thrown.
   - API e2e (`test/sources.e2e-spec.ts`): a notes folder made with `git init` and one commit; the status
     names that commit and branch. `GET /api/admin/sources/status`: 403 for a non-admin.
   - AI service: `PUT` by the service account 204, by an exchanged user token 403; `index_status` for a
     viewer returns the pushed status, before any push the note, without the viewer role it is refused.
9. **Docs:**
   - `plan-daily-use.md`: D127; under M3c.1 `[x] Added 2026-11-25: sources status …` and an open hand
     check line.
   - `docs/setup/startup.md` §4: where the status shows (documents page, `index_status`) and that
     `pull: off` in Mode B means "pull the checkout yourself". The `kb:read` tool list for external
     clients gains `index_status`.

## Rules

- `AGENTS.md` applies: pull request from a new branch, never merge, commands for David in bash and fish, no
  secrets or `.env` values anywhere, handoff at the end.
- No realm change, no new client role, no migration (S1, S2).
- No change in the notes repositories.
- `pnpm lint && pnpm test` pass; contracts have no drift.

## Acceptance checks

- [ ] Every run (boot, interval, "Sync now") ends with a status and a push, also when nothing changed or the run failed.
- [ ] The commit reader works without the `git` binary; its cases are unit-tested.
- [ ] A failed pull shows as `pull: failed` with the error, not only as a log line.
- [ ] `PUT /v1/sources/status` refuses an exchanged user token (test).
- [ ] `index_status` needs `kb:read` and the viewer role, and says plainly when nothing was pushed yet.
- [ ] The documents page shows the status per folder, live counts included, for admins only.
- [ ] `SyncResult` and `POST /api/admin/sources/sync` unchanged; contracts regenerated.
- [ ] D127 and the M3c.1 line in `plan-daily-use.md`; `startup.md` updated.

## Out of scope

- Comparing with GitHub (remote commit, open pull requests) and uncommitted changes: pecker-nest's `doctor.sh` does that.
- Pulling in Mode B, a status history, alerts.
- Any change to the realm, to `NOTES_EXCLUDE` handling or to what a sync ingests.

## David's part

1. Review and merge.
2. Hand check on the daily stack: restart `pnpm dev`. The documents page shows each folder's commit, and it
   matches `git -C <checkout> rev-parse --short HEAD` (same in bash and fish). In Claude Code or Pi,
   `index_status` returns the same commit.
3. Then pecker-nest's task `kb-sources-status.md`, part 2.

## Pull request

The branch `feat/sources-status` and its draft pull request already exist, with this brief as the first
commit. Build on that branch, keep the pull request a draft until the checks pass, and replace its
description: the problem in three lines, D127, the contract, what was tested, the hand check from "David's
part". Title `feat(sources): report what the knowledge base has indexed`. Never merge it yourself.
