---
phase: 122-conversation-search-modal
plan: 02
subsystem: backend
tags: [backend, ssh-fanout, search, nginx]
requires:
  - 122-01 (Wave 0 empirical checkpoint — verdict: go-same-helper)
provides:
  - POST /conversation-search endpoint (JWT-authenticated, cross-host content-grep)
  - ConversationSearchResult TypeScript type (10-field row contract, exported for Wave 2)
  - snippetForHit helper (JSON-aware ±80-char windowed snippet with hitStart/hitLength)
  - listArchivedIdentityKeysOnHost helper (mirror of listIdentityKeysOnHost rooted at ~/fleet/identities-archive/)
affects:
  - src/backend/database/database.ts (mount)
  - docker/nginx.conf, docker/nginx-https.conf (proxy location blocks — parity)
  - src/backend/claude-session/session-file-parser.ts (extractText now exported)
tech-stack:
  added: [] # zero new packages
  patterns:
    - Cross-host fan-out via `Promise.all(candidates.map(...))` with per-host try/catch/return-[] + Promise.race timeout (verbatim shape from sessions.ts:319-566)
    - LOCAL vs REMOTE branch split for on-host enumeration (mirror of identity-artifact-reader.ts:1144)
    - Shell-injection safety via `sh -c '<script>' -- "$QUERY"` positional-argument passing + defense-in-depth single-quote wrapping
    - JSON-aware snippet extraction: JSON.parse hit line → extractText → window ±80 chars → return {snippet, hitStart, hitLength} for frontend `<span>` split rendering
key-files:
  created:
    - src/backend/claude-session/session-search-snippet.ts
    - src/backend/claude-session/session-search-snippet.test.ts
    - src/backend/claude-session/list-archived-identity-keys.ts
    - src/backend/database/routes/conversation-search.ts
    - src/backend/database/routes/conversation-search.test.ts
  modified:
    - src/backend/claude-session/session-file-parser.ts (added `export` to extractText at line 150)
    - src/backend/database/database.ts (import + mount conversationSearchRoutes)
    - docker/nginx.conf (added `location ~ ^/conversation-search(/.*)?$` block)
    - docker/nginx-https.conf (parity block)
decisions:
  - "Wave 0 verdict `go-same-helper` honored: BOTH live and archived identity keys resolve their latest JSONL via `discoverIdentitySessionFile(conn, key)`. No sidecar file. No mtime-fallback. archived-vs-live discriminator comes purely from which enumerator surfaced the key."
  - "Query passed to remote shell as positional argument via `sh -c '<script>' -- \"$QUERY\"`. Query bytes never enter shell parser as syntax. Defense-in-depth: also single-quote-wrapped at JS command boundary."
  - "aiTitle field deferred (all rows carry aiTitle:null). Frontend falls back to identityKey. Piggybacking scanTailForLatestAiTitle can land as small follow-up without changing response shape."
  - "extractText exported from session-file-parser.ts (was module-private) rather than duplicating the message.content flatten logic. Zero behavior change to existing callers."
  - "PER_HOST_TIMEOUT_MS (30s) is env-overridable via `CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS` for test injection (T-07 uses 150ms to exercise the race)."
metrics:
  duration_min: 12
  tasks_completed: 2
  files_created: 5
  files_modified: 4
  tests_added: 19
  completed: 2026-09-20
---

# Phase 122 Plan 02: Backend endpoint + supporting helpers — Summary

**One-liner:** JWT-authenticated `POST /conversation-search` that fans out to every SSH+autoTmux host, greps the latest transcript per identity across both live and archived trees, and returns a mtime-sorted, offset/limit-paginated slice of 10-field result rows with pre-windowed snippets — all reusing the codebase's established primitives (no invented patterns, zero new packages).

---

## What shipped

### Endpoint: `POST /conversation-search`

**Request body:**
```typescript
{ query: string; offset?: number; limit?: number }
```

**Response:**
```typescript
{ results: ConversationSearchResult[]; hasMore: boolean }
```

**Exported TypeScript type (Wave 2 frontend imports verbatim):**
```typescript
export interface ConversationSearchResult {
  transcriptPath: string;    // absolute path to matched JSONL on the host
  transcriptMtime: number;   // ms since epoch (shell emits seconds; route ×1000)
  identityKey: string;       // fleet identity name
  hostId: number;            // hosts.id column
  hostName: string;          // hosts.name (or hosts.ip fallback)
  aiTitle: string | null;    // deferred — always null in this plan; frontend falls back to identityKey
  snippet: string;           // pre-windowed ±80-char text around match
  hitStart: number;          // char offset of match inside snippet (−1 on fallback)
  hitLength: number;         // length of match (0 on fallback)
  isArchived: boolean;       // true iff identityKey came from listArchivedIdentityKeysOnHost
}
```

**Handler contract:**
- Empty query → `200 { results: [], hasMore: false }` with zero SSH work
- Query > 500 chars → `400 { error: "query_too_long" }`
- Malformed body → coerced to sane defaults (offset=0, limit=20, query="")
- One host down/slow → contributes `[]`, endpoint still returns 200
- All fan-out failures per-host silent (`sshLogger.debug`)

### Helpers

1. **`snippetForHit(rawLine, query): { snippet, hitStart, hitLength }`** — `src/backend/claude-session/session-search-snippet.ts`
   - Parses the hit's JSONL line, pulls `message.content` through `extractText` (the same helper session-file-parser.ts uses for every other JSONL consumer), locates the case-insensitive match, windows ±80 chars, prepends/appends `…` at boundaries, computes `hitStart` accounting for leading ellipsis.
   - Fail-safe: JSON.parse throw → raw-line first-160 chars with hitStart=-1; query not present in extracted text → extracted-text first-160 chars with hitStart=-1.

2. **`listArchivedIdentityKeysOnHost(conn): Promise<string[]>`** — `src/backend/claude-session/list-archived-identity-keys.ts`
   - Byte-for-byte mirror of `listIdentityKeysOnHost` at `identity-artifact-reader.ts:1144`, rooted at `~/fleet/identities-archive/` instead of `~/fleet/identities/`.
   - LOCAL (node fs, ENOENT → []) + REMOTE (SSH `find ... 2>/dev/null || true`, 15s Promise.race guard) branches.
   - Also exports `getLocalArchivedIdentitiesRoot()` (env-overridable via `IDENTITIES_ARCHIVE_HOST_DIR` for tests).

### Wiring

- **Mount:** `src/backend/database/database.ts` — new import + `app.use("/conversation-search", conversationSearchRoutes)` alongside `identityArchiveRoutes`.
- **nginx:** `docker/nginx.conf` and `docker/nginx-https.conf` — parity `location ~ ^/conversation-search(/.*)?$` blocks with `proxy_pass http://127.0.0.1:30001`, `proxy_read_timeout 60s` (bounds 30s per-host budget + slack), `client_max_body_size 32k`. Comment cites CLAUDE.md nginx-parity caveat.

---

## Tests

**19/19 passing** across two files:

| File | Tests | Coverage |
|------|-------|----------|
| `session-search-snippet.test.ts` | 8 | string-content window, array-of-blocks extractText, case-insensitive, query-absent fallback, JSON.parse fallback, three ellipsis-boundary cases |
| `conversation-search.test.ts` | 11 | auth-401, empty-query short-circuit + whitespace-trim, 2-host aggregation + mtime-desc sort + isArchived + 10-field row shape, offset/limit slice + hasMore + beyond-total, per-host error isolation, per-host timeout via `Promise.race`, shell-injection canary (`/tmp/OWNED-{hex}` MUST NOT exist), query-length cap (500 + boundary) |

**Scoped `npx vitest related --run` gate on all touched files:** 598 passed, 1 skipped, 0 failed across 27 test files.

**Backend typecheck (`npm run build:backend`):** 0 errors.

---

## Deviations from Plan

### Auto-fixed issues

**1. [W-1 pre-flagged, Rule 3] Exported `extractText` from session-file-parser.ts**
- **Found during:** Task 1 (planned — the plan flagged W-1 in `<known_gotchas>`)
- **Issue:** `extractText` at `session-file-parser.ts:150` was declared `function extractText`, not `export function extractText`. Plan 02 Task 1 imports it in `session-search-snippet.ts`.
- **Fix:** One-word diff — added the `export` keyword. Zero behavior change to existing callers.
- **Files modified:** `src/backend/claude-session/session-file-parser.ts`
- **Commit:** `813728ec`

**2. [Rule 3] Added `CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS` env override in the route**
- **Found during:** Task 2 (writing test T-07 for per-host timeout)
- **Issue:** T-07 needs to exercise the `Promise.race([work, timeout])` branch. Using the production 30 000 ms constant would make the test take ≥30 s. No other route in the codebase parameterizes its per-host timeout at test time, so there was no precedent to reuse.
- **Fix:** Read `process.env.CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS` at call time (not at module load) inside a `getPerHostTimeoutMs()` helper. If unset or invalid → default 30 000 ms (production semantics unchanged). Test sets it to `"150"` around the assertion window and deletes it in `finally`.
- **Files modified:** `src/backend/database/routes/conversation-search.ts`
- **Commit:** `48439f81`
- **Why not Rule 4:** This is a plumbing tweak, not an architectural change. The production default and behavior are byte-identical to what the plan specified; only test-injection is affected.

### Deferred (not in scope for Wave 1)

- **`aiTitle` field:** All result rows carry `aiTitle: null` per the plan's Task 2 action item 7 (Open Question 3 in RESEARCH.md). The frontend (Wave 2) falls back to `identityKey` as the row header. Piggybacking `scanTailForLatestAiTitle` on each hit's transcript file is cheap (~10–30 ms per host) and can ship as a small follow-up commit without changing the response shape or breaking Wave 2 rendering.

### None (verbatim to plan)

- Cross-host fan-out shape: verbatim mirror of `sessions.ts:319-566` (no invention)
- Identity → latest transcript resolution: verbatim reuse of `discoverIdentitySessionFile` (no fork)
- `listArchivedIdentityKeysOnHost` structure: verbatim mirror of `listIdentityKeysOnHost` (no fork of identity-key parsing / graceful-degrade idiom)
- nginx proxy block: verbatim template of the `/workspace` block at line 525 (only URL prefix + `proxy_read_timeout` + `client_max_body_size` tuned)

---

## Auth Gates

None encountered. The endpoint's own auth is `AuthManager.createAuthMiddleware()` (existing JWT gate) — no new secrets or credentials required for development.

---

## Threat Flags

None. The plan's `<threat_model>` register enumerated all trust boundaries; no new security-relevant surface was introduced beyond what the plan already itemized (T-122-01 through T-122-06 + T-122-SC).

---

## Known Stubs

None. All handler-emitted data is real (either from `discoverIdentitySessionFile` or from the parsed grep output). `aiTitle: null` is a documented deferral with a clear follow-up path, not a UI stub.

---

## Follow-ups (not blockers for Wave 2)

1. **aiTitle piggyback:** small commit to Task 2's `runOneHost` to call `scanTailForLatestAiTitle` on each hit's transcript path within the same SSH connection. Zero response-shape change (field already exists as nullable).
2. **UAT verification:** manual smoke test after Wave 2 lands — `curl -X POST http://localhost:30001/conversation-search -H "Content-Type: application/json" -H "Cookie: <jwt-cookie>" -d '{"query":"claude","offset":0,"limit":5}'` should return `200` with the 10-field shape.

---

## Commits

- `813728ec` — feat(122-02): add snippetForHit + archive-tree identity enumerator (Task 1: helpers + 8 tests + `extractText` export)
- `48439f81` — feat(122-02): add POST /conversation-search endpoint + nginx wiring + 11 route tests (Task 2: endpoint + mount + parity nginx)

---

## Success criteria (all green)

- [x] Wave 2's frontend plan can `authApi.post("/conversation-search", { query, offset, limit })` and receive the exact `{ results: ConversationSearchResult[], hasMore: boolean }` shape with all 10 fields per row
- [x] Shell-injection test proves the query is safe to interpolate (T-09 canary)
- [x] One offline host does not 500 the endpoint (T-06 error isolation, T-07 timeout race)
- [x] Recency sort is provably correct (T-04 asserts mtime-desc across two mocked hosts)
- [x] Code is committed with green tests (`813728ec`, `48439f81`)

---

## Self-Check

**Files created / modified verification:**

```
FOUND: src/backend/claude-session/session-search-snippet.ts
FOUND: src/backend/claude-session/session-search-snippet.test.ts
FOUND: src/backend/claude-session/list-archived-identity-keys.ts
FOUND: src/backend/database/routes/conversation-search.ts
FOUND: src/backend/database/routes/conversation-search.test.ts
FOUND: .planning/phases/122-conversation-search-modal/122-02-SUMMARY.md
FOUND: 813728ec
FOUND: 48439f81
```

## Self-Check: PASSED
