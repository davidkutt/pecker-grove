# Cursor tooling: findings

Researched on 16 November 2026 for [the Cursor setup task](../tasks/cursor-setup.md). cursor.com,
forum.cursor.com, context7.com and keycloak.org do not resolve from the cloud session this was written in.
Rows marked *(excerpt)* rest on the search engine's excerpt of that page on the read date, not on the page
itself; open the page before acting on them. Token counts use OpenAI's `o200k_base` (npm `gpt-tokenizer`) as a
stand-in: Grok's tokenizer is not public, so expect the real figure within roughly ±15 %.

## 1. Library docs newer than the model (Context7 or an equivalent)

| Finding | Source | Read |
|---|---|---|
| Context7 is Upstash's. The MCP server is MIT on GitHub; the API backend, parser and crawler are private. | https://github.com/upstash/context7 | 16.11.2026 |
| Two tools: `resolve-library-id` (`libraryName`, `query`) and `query-docs` (`libraryId`, `query`, optional `language`). Remote endpoint `https://mcp.context7.com/mcp`; the npm package `@upstash/context7-mcp` runs locally but calls the same API. | https://github.com/upstash/context7 | 16.11.2026 |
| What leaves the machine: a search query the model writes (not the prompt or the code), the library name or id, the API key if set, and the client's name and version. The tool descriptions tell the model to strip secrets, personal data and proprietary code from the query; that relies on the model obeying. | https://context7.com/docs/security/data-privacy *(excerpt)* | 16.11.2026 |
| A key is optional. Without one: "low" rate limits, no published number, only anonymised aggregate usage kept. A free key (dashboard, sent as `Authorization: Bearer`) raises the limits and logs per-library usage against the account. | https://github.com/upstash/context7, https://context7.com/docs/api-guide *(excerpt)*, https://context7mcp.pages.dev/faq *(excerpt)* | 16.11.2026 |
| The keyed free tier dropped from about 6,000 to 1,000 requests a month in January 2026. | https://blog.devgenius.io/context7-quietly-slashed-its-free-tier-by-92-16fa05ddce03 *(excerpt)* | 16.11.2026 |
| `${env:NAME}` was reported unresolved in `headers` of remote servers (works for stdio servers), so a keyed remote entry may send the literal string. | https://forum.cursor.com/t/config-interpolation-env-name-not-working-in-headers-for-remote-mcp-servers/156069 *(excerpt)* | 16.11.2026 |
| Cursor's own equivalent is gone: `@Docs` (Settings → Indexing & Docs) was removed in 3.14.2; staff point to the agent's own web search and fetch, or a link in the prompt, a rule or a skill. | https://forum.cursor.com/t/cursor-3-14-2-sunsetting-docs/167423 *(excerpt)* | 16.11.2026 |
| Angular is covered without a third party: `ng mcp --read-only` registers `search_documentation`, `get_best_practices`, `ai_tutor`, `list_projects`, `onpush_zoneless_migration` and `devserver_wait_for_build` (Angular CLI 22.2.6; `find_examples` is not among them). | `.cursor/mcp.json` in this repository, run over stdio | 16.11.2026 |

**Recommendation:** add Context7 in a follow-up pull request as the remote endpoint
`https://mcp.context7.com/mcp` in `.cursor/mcp.json`, without a key, for NestJS 12, FastAPI, Drizzle,
Keycloak 26.8 and the MCP SDK v2. Only the model-written query leaves the machine, and Cursor no longer
has a docs index of its own. If it starts answering 429, switch that entry to the stdio package with the
key passed through `env` (`${env:CONTEXT7_API_KEY}`), not through a remote header.

## 2. Grove's own `/mcp` in Cursor

| Finding | Source | Read |
|---|---|---|
| Cursor does not support Client ID Metadata Documents; a forum thread asking for plans has no date from staff. | https://forum.cursor.com/t/mcp-oauth-cimd-support-plans-and-timelines/148096 *(excerpt)* | 16.11.2026 |
| An MCP server that fixed its Cursor login in September 2026: Cursor needs either dynamic client registration via `registration_endpoint` or a static `CLIENT_ID` in `mcp.json`, as a public client with PKCE. | https://github.com/arpitdalal/PocketCircle/issues/354 | 16.11.2026 |
| Cursor reads the protected resource metadata (RFC 9728), sends `resource` (RFC 8707), and registers by DCR as a public client without secret. A static client goes in an `auth` object: `CLIENT_ID` (required), `CLIENT_SECRET` (optional), `scopes`. | https://cursor.com/docs/mcp *(excerpt)* | 16.11.2026 |
| Redirect URIs are fixed by Cursor, with no field to change them: desktop `http://localhost:8787/callback`, web and cloud agents `https://www.cursor.com/agents/mcp/oauth/callback`. Staff advise keeping `cursor://anysphere.cursor-mcp/oauth/callback` allowed, as the desktop flow still falls back to it. | https://cursor.com/docs/mcp *(excerpt)*, https://forum.cursor.com/t/oauth-redirect-uri-changed-from-cursor-to-http-localhost-for-streamable-http-mcp/165019 *(excerpt)* | 16.11.2026 |
| DCR on 3.13.25 and 3.14.27 still registers the `cursor://` URI next to the loopback one and omits `application_type`; strict servers reject the whole registration. Cursor re-registers on reconnects. | https://forum.cursor.com/t/mcp-oauth-dcr-still-uses-custom-scheme-callback-on-3-13-25-breaks-standards-compliant-providers/167372, https://forum.cursor.com/t/cursor-mcp-dcr-still-omits-application-type-and-uses-a-non-rfc-8252-compliant-private-redirect-uri-3-14-27/167608, https://forum.cursor.com/t/mcp-oauth-persist-dcr-client-id-across-reconnects-avoid-as-side-registration-spam/158226 *(all excerpts)* | 16.11.2026 |
| The realm's CIMD policies match only client ids on `claude.ai`, `vscode.dev` and `davidkutt.github.io`; it has no client registration policies of its own. | `infra/keycloak/realm-kb.json`, ADR-0014 | 16.11.2026 |
| Without its own policies, a realm gets Keycloak's defaults for anonymous DCR: *Trusted Hosts* with an empty host list and both "must match" checks on, *Consent Required*, *Full Scope Disabled*, *Max Clients*, and *Allowed Client Scopes* limited to default scopes. So a Cursor DCR request is refused today, and `kb:read` (an optional scope) would not be allowed either. | https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/services/clientregistration/policy/DefaultClientRegistrationPolicies.java | 16.11.2026 |

So Cursor presents no metadata document; it tries DCR, and that fails against the realm as it is. What the
realm would need, per path (none verified on a Keycloak):

- **DCR:** trust the address Cursor's request arrives from (the Docker side of the host, which differs per
  machine), turn off the client-URI check for the `cursor://` URI, allow `kb:read`, and give created clients
  the `http://localhost:8000/mcp` audience, which only the CIMD executor adds today. ADR-0014 rejected DCR, and
  Cursor's re-registration on reconnects fills the realm with clients.
- **A pre-registered public client** (e.g. `kb-cursor`): standard flow only, the two desktop redirect URIs
  above, `kb:read` as optional scope, full scope off (roles then come from `kb:read`'s scope mapping, as for
  the CIMD clients), PKCE through the existing `pkce-for-public-clients` policy, and audience
  `http://localhost:8000/mcp`. Open point: how Keycloak's `resource-indicators` treats `resource` for a client
  the CIMD executor did not create (ADR-0014: a `resource_url` client "only matters for pre-registered
  clients"). Cursor's side is then `"grove": {"url": "http://localhost:8000/mcp", "auth": {"CLIENT_ID":
  "kb-cursor", "scopes": ["kb:read"]}}` in `.cursor/mcp.json`: no secret, nothing machine-specific. ADR-0014's
  objection to pre-registered clients (a client id and a callback port per tool, entered by hand) does not
  apply: Cursor fixes the port itself and the client id would be committed.
- **CIMD, once Cursor ships it:** a fourth policy and profile like `mcp-pi`, for the host of Cursor's document.

**Recommendation:** the pre-registered public client, in its own pull request with an amendment to ADR-0014,
checked with the `realm-check` skill on its throwaway Keycloak (login, `aud`, `kb:read`, roles, and the
`resource` question above) before it reaches David's stack. Replace it with a CIMD policy when Cursor supports
CIMD.

## 3. Size of `AGENTS.md`

| Finding | Source | Read |
|---|---|---|
| 6,499 tokens (24.6 kB, 307 lines) with this pull request's section; 6,360 before. | `AGENTS.md`, counted with `o200k_base` | 16.11.2026 |
| By section: Conventions and gotchas 1,540 · What this is 1,370 (of which the milestone history from "Phase 1 is done" to "Phase 3 ADRs start at 0015" 1,106) · Map 857 · Commands 526 · Capturing lessons 502 · The smallest complete change 453 · Workflow 295 · ALWAYS rules 266 · Working in Pi 220 · Applied Learnings 161 · Working in Cursor 139 · rest 170. | `AGENTS.md`, counted with `o200k_base` | 16.11.2026 |
| Cursor loads the root file in full on every request, and nested `AGENTS.md` files too since 3.6. | Cursor forum staff answer, as cited in the [task brief](../tasks/cursor-setup.md) | 16.11.2026 |
| Claude Code reaches `AGENTS.md` here only through the `@AGENTS.md` import in `CLAUDE.md`. | `CLAUDE.md` in this repository | 16.11.2026 |

What Cursor could do without on most requests: *Working in Pi* (220, never applies in Cursor), *Capturing
lessons* (502, needed only when David corrects the agent or a task ends), the milestone history in *What this
is* (1,106, a record of what is done) and the parked-plan rows of *Map* (78). Splitting by area into nested
`AGENTS.md` files saves nothing: Cursor would load them on every request anyway, and Claude Code would need a
`CLAUDE.md` next to each.

**Recommendation:** one change, in its own docs pull request: cut the milestone history to the facts that
still bind (the goal, M1.7 and Azure postponed, the list of components frozen until M3c.2, Phase 3 ADRs from
0015, check plan-daily-use.md §3 before building), about 150 tokens. That saves about 950 tokens (15 %) on
every request in all three tools, and Pi and Claude Code lose nothing they act on: the done milestones are in
the phase plans, and the paragraph's two open items are already tracked in plan-daily-use.md (the README GIF
in M3c.5, the `/mcp` hand check in M3c.0). Everything else stays: the sections that do not apply to Cursor are short or needed at the
end of a task.
