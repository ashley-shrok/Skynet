---
phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2
plan: 01
subsystem: skynet-backend-pretty-view-file-url
tags:
  - backend
  - ssh
  - sftp
  - security
  - split-router
  - xss-defense
  - cross-user-isolation
dependency-graph:
  requires:
    - src/backend/ssh/host-resolver.ts (existing resolveHostById + credential-resolution machinery reused verbatim)
    - src/backend/ssh/ssh-connection-pool.ts (withConnection)
    - src/backend/ssh/ssh-one-shot.ts (connectOneShot)
    - src/backend/utils/permission-manager.ts (canAccessHost)
    - src/backend/utils/editable-file-whitelist.ts (classifyByExtension)
    - src/backend/utils/editable-file-byte-sniff.ts (sniffTextBytes)
    - src/backend/utils/auth-manager.ts (createAuthMiddleware)
    - src/backend/utils/logger.ts (sshLogger)
    - src/backend/database/routes/pretty-view-fetch-tailnet-url.ts (structural sibling — response envelope shape + error taxonomy pattern)
    - src/backend/ssh/plan-file-fetch.ts (SFTP promise-wrapper idiom: openSftp / sftpRealpath / sftpStat / sftpReadFile)
  provides:
    - "resolveHostByName(name, userId): Promise<SSHHost | null> — a sibling helper alongside resolveHostById scoped by BOTH hosts.name AND hosts.userId (cross-user isolation)"
    - "prettyViewFetchHostFileRoutes — Express router with POST /fetch-host-file only, mounted at /pretty-view"
    - "fileUrlRoutes — Express router with GET /file/:host/{/*path} only, mounted at /"
    - "Shared private helper fetchHostFileBytes(userId, hostname, absolutePath): Promise<{bytes, host}> — owns all auth + resolve + guardrails + realpath + stat + read logic"
  affects:
    - "src/backend/database/database.ts — one new named-import line + two new mount lines (POST-only router at /pretty-view, GET-only router at /)"
tech-stack:
  added: []
  patterns:
    - "Split-router mount pattern (checker W-3) — two narrow named-export routers each mounted at exactly one prefix, eliminating ghost URL aliases"
    - "Shared private fetch helper — POST and GET call the same fetchHostFileBytes; no handler-code duplication"
    - "realpath-BEFORE-stat symlink defense (T-78-07) — sftp.realpath called first, resolved target re-checked against FORBIDDEN_PATH_RE regex BEFORE any stat/read"
    - "XSS defense via forced text/plain (T-78-01-GET1) — GET responses always Content-Type: text/plain; charset=utf-8 + X-Content-Type-Options: nosniff + Cache-Control: no-store, regardless of file extension"
    - "Info-leak invariant (T-40-05) — response bodies never contain err.message / absolutePath / filename; server logs carry errorClass = err.name only"
key-files:
  created:
    - src/backend/database/routes/pretty-view-fetch-host-file.ts (route module: 570 lines — shared helper + POST-only router + GET-only router + SFTP promise wrappers + error classifiers)
    - src/backend/database/routes/pretty-view-fetch-host-file.test.ts (945 lines — 35 tests covering 17 POST behaviors + 15 GET behaviors + Test 17 realpath-mocked symlink defense + 2 ghost-alias absence assertions)
    - src/backend/ssh/host-resolver.test.ts (314 lines — 6 tests covering resolveHostByName cross-user isolation invariants)
  modified:
    - src/backend/ssh/host-resolver.ts (added resolveHostByName sibling helper — +130 lines, resolveHostById untouched)
    - src/backend/database/database.ts (+13 lines: one named-import block + two mount lines + comment block)
decisions:
  - "Split-router pattern per W-3: TWO narrow routers exported from the same file. prettyViewFetchHostFileRoutes has ONLY a POST handler; fileUrlRoutes has ONLY a GET handler. Ghost aliases (POST /fetch-host-file at root, GET /pretty-view/file/:host/*) return 404 by construction because the wrong-prefix router has no matching handler. Wire-level test assertions confirm both ghost URLs 404."
  - "sftpRealpath BEFORE sftpStat: the shared helper resolves the user-supplied absolutePath via sftp.realpath FIRST, re-applies FORBIDDEN_PATH_RE to the resolved target, and only then calls sftp.stat + sftp.readFile. This closes T-78-07 (symlink-escape) — a symlink /home/ubuntu/nasty-link → /proc/kmsg is rejected here BEFORE any data access. sftp.stat returns Stats only (not a path), so sftp.realpath is the only ssh2 API that closes this gap."
  - "GET handler forces Content-Type: text/plain; charset=utf-8 on ALL responses regardless of file extension (XSS defense T-78-01-GET1). A user-writeable evil.html served as text/plain will render as text, not execute. Also X-Content-Type-Options: nosniff (defense-in-depth against Chrome/Safari MIME-sniffing heuristics) and Cache-Control: no-store (cross-user cache poisoning defense T-78-01-GET2). All three headers set at the top of the handler via res.set(PLAIN_TEXT_HEADERS) so error branches inherit them without repetition."
  - "resolveHostByName scopes by BOTH hosts.name AND hosts.userId. hosts.name is a per-user friendly name and NOT unique across users; filtering by name alone would let user A trigger reads on user B's host by guessing the friendly name (RESEARCH § Pitfall 7). WHERE clause: and(eq(hosts.name, name), eq(hosts.userId, userId)). Returns null on zero results (route boundary maps null → 404 unknown_host, no cross-user existence leak via 403 differentiation)."
  - "Error taxonomy shared between POST and GET — same catch-block classification (invalid_hostname, path_must_be_absolute, path_traversal, path_forbidden, unknown_host, permission_denied, not_a_file, too_large, not_found, ssh_timeout, host_unreachable). POST returns JSON { error: <class> }; GET returns short human-readable text body `<class>: <sentence>`. Neither ever includes err.message, absolutePath, or filename."
  - "AbortController with 8s SFTP_READ_TIMEOUT_MS bounds the whole SFTP callback (realpath + stat + readFile). Handled via a runWithAbort helper that races the task against the signal; on abort, throws an AbortError-shaped Error so both handlers' catch blocks classify it to 504 ssh_timeout."
metrics:
  duration: "38m"
  completed: "2026-09-06"
  commits: 4
  tasks: 2
  files_changed: 5
  lines_added: 2019
  lines_removed: 0
---

# Phase 78 Plan 01: SFTP-backed File-URL Backend (POST + GET split-router) Summary

**One-liner:** Ships the backend half of Phase 78's file-URL feature — a `resolveHostByName(name, userId)` helper with cross-user isolation, plus a split-router route module that exports a POST-only router (`/pretty-view/fetch-host-file`, modal JSON path) and a GET-only router (`/file/:host/{/*path}`, verbatim URL path agents write), both calling one shared `fetchHostFileBytes` helper whose SFTP callback runs `realpath` BEFORE `stat` to close the symlink-escape gap (T-78-07).

## What Was Built

### Task 1: `resolveHostByName(name, userId)` (RED → GREEN)

- Added a sibling helper alongside `resolveHostById` in `src/backend/ssh/host-resolver.ts`.
- Signature: `async function resolveHostByName(name: string, userId: string): Promise<SSHHost | null>`
- WHERE clause: `and(eq(hosts.name, name), eq(hosts.userId, userId))` — filtering by BOTH is the load-bearing invariant per RESEARCH § Pitfall 7. `hosts.name` is a per-user friendly name and NOT unique across users; filtering by name alone would let user A trigger reads on user B's host.
- Returns `null` on zero results (route boundary maps `null → 404 unknown_host`); does NOT throw.
- Credential-resolution tail copied verbatim from `resolveHostById` — JSON-field parsing (jumpHosts, tunnelConnections, statsConfig, terminalConfig, socks5ProxyChain, quickActions), credential row lookup with `and(id, userId)` scope, and password/key/authType attachment. Since the WHERE clause already scopes by userId the user is always the owner, so no shared-access or override-credential branch is walked.
- `resolveHostById` unchanged.
- 6 tests pass (5 for the new helper + 1 sanity check that `resolveHostById` still exports).

**Commits:**
- `4692b2c2` test(78-01): add failing tests for resolveHostByName cross-user isolation (RED)
- `045c3e9d` feat(78-01): add resolveHostByName(name, userId) with cross-user isolation (GREEN)

### Task 2: `pretty-view-fetch-host-file.ts` split-router (RED → GREEN + mount)

New route module at `src/backend/database/routes/pretty-view-fetch-host-file.ts` — ~570 lines.

**Exports (two named routers — W-3 split-router pattern):**
- `prettyViewFetchHostFileRoutes` (Express router): `POST /fetch-host-file` handler ONLY; no GET handler ever registered. Mounted at `/pretty-view` in database.ts. Reachable at `POST /pretty-view/fetch-host-file`.
- `fileUrlRoutes` (Express router): `GET /file/:host/{/*path}` handler ONLY; no POST handler ever registered. Mounted at `/` in database.ts. Reachable at `GET /file/:host/<absolute path>`.

**Shared private helper (called by BOTH handlers):**
```
async function fetchHostFileBytes(
  userId: string,
  hostname: string,
  absolutePath: string,
): Promise<{ bytes: Buffer; host: SSHHost }>
```

Execution order (STRICT — the realpath-BEFORE-stat sequence is the T-78-07 defense):
1. `HOSTNAME_RE.test(hostname)` — throw `invalid_hostname` on miss
2. `absolutePath.startsWith("/")` — throw `path_must_be_absolute` on miss
3. Traversal check (`/../`, `/./`, trailing `/..`/`/.`) — throw `path_traversal`
4. `FORBIDDEN_PATH_RE.test(absolutePath)` — throw `path_forbidden` (pre-SSH boundary check)
5. `resolveHostByName(hostname, userId)` — null → throw `unknown_host`
6. `permissionManager.canAccessHost(userId, host.id, "read")` — `!hasAccess` → throw `permission_denied`
7. `AbortController` + `SFTP_READ_TIMEOUT_MS` (8s) around the SFTP callback
8. `withConnection(poolKey, () => connectOneShot(host, 5s), async (client) => { ... })`
9. Inside callback:
   1. `sftp = await openSftp(client)`
   2. `resolvedPath = await sftpRealpath(sftp, absolutePath)`  ← **W-2 defense begins**
   3. `FORBIDDEN_PATH_RE.test(resolvedPath)` — match → throw `path_forbidden`  ← **W-2 defense: rejects symlink /home/ubuntu/nasty-link → /proc/kmsg HERE, BEFORE any stat/read**
   4. `stat = await sftpStat(sftp, resolvedPath)`
   5. `!stat.isFile()` → throw `not_a_file`
   6. `stat.size > MAX_BYTES` (2 MB) → throw `too_large`
   7. `return await sftpReadFile(sftp, resolvedPath)`

### Error Taxonomy (identical for POST + GET — only response shape differs)

| Status | Error class          | Trigger                                                                                     | POST body                     | GET body (plain text)                                                             |
| ------ | -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| 400    | `invalid_body`       | POST body missing `hostname` OR `absolutePath` strings                                      | `{"error":"invalid_body"}`    | N/A (GET has no body)                                                             |
| 400    | `invalid_hostname`   | hostname fails `/^[a-zA-Z0-9._-]+$/`                                                        | `{"error":"invalid_hostname"}` | `invalid_hostname: hostname contains characters outside [a-zA-Z0-9._-]`           |
| 400    | `path_must_be_absolute` | absolutePath does not start with `/` (or GET tail is empty)                              | `{"error":"path_must_be_absolute"}` | `path_must_be_absolute: path must start with /`                             |
| 400    | `path_traversal`     | absolutePath contains `/../`, `/./`, trailing `/..`, or trailing `/.`                       | `{"error":"path_traversal"}`  | `path_traversal: . and .. segments are not allowed`                               |
| 400    | `path_forbidden`     | absolutePath matches `/^\/(proc\|sys\|dev)(\/\|$)/` **OR** resolved target does (W-2)       | `{"error":"path_forbidden"}`  | `path_forbidden: /proc, /sys, and /dev are not accessible via file URLs`          |
| 400    | `not_a_file`         | `sftp.stat` returned non-file (directory, socket, FIFO, device)                             | `{"error":"not_a_file"}`      | `not_a_file: directories, sockets, and device files are not viewable via file URLs` |
| 401    | (auth middleware)    | No/invalid JWT                                                                              | `{"error":"Unauthorized"}`    | `{"error":"Unauthorized"}` (also carries the three defense headers)               |
| 403    | `permission_denied`  | `canAccessHost` returned `hasAccess=false` OR SFTP EACCES/"Permission" error                | `{"error":"permission_denied"}` | `permission_denied: you do not have read access to this file on this host`      |
| 404    | `unknown_host`       | `resolveHostByName` returned null (host missing OR belongs to another user)                 | `{"error":"unknown_host"}`    | `unknown_host: host is not registered in this Skynet or you do not have access to it` |
| 404    | `not_found`          | SFTP ENOENT / "No such file"                                                                | `{"error":"not_found"}`       | `not_found: no such file at that path`                                            |
| 413    | `too_large`          | `stat.size > 2_000_000`                                                                     | `{"error":"too_large"}`       | `too_large: file exceeds the 2 MB cap`                                            |
| 502    | `host_unreachable`   | Unclassified SSH error (connect refused, network unreachable, etc.)                         | `{"error":"host_unreachable"}` | `host_unreachable: the box may be offline or the SSH channel is down`            |
| 504    | `ssh_timeout`        | AbortController fired after 8s                                                              | `{"error":"ssh_timeout"}`     | `ssh_timeout: the host is slow or unreachable — try again in a moment`            |

**T-40-05 invariant (info-leak):** Response bodies (JSON on POST, text on GET) NEVER include `err.message`, `absolutePath`, or `filename`. Server logs carry `errorClass = err.name` only. Enforced by grep gate (`grep -Ec 'res\.(json|send)\([^)]*err\.message'` returns 0) + Tests 16 (POST) + 33 (GET).

### XSS-defense header contract (GET responses)

Set at the top of the GET handler via `res.set(PLAIN_TEXT_HEADERS)` and re-asserted on every send so error responses inherit them uniformly:

| Header                    | Value                             | Rationale                                                                                                                        |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`            | `text/plain; charset=utf-8`       | XSS defense (T-78-01-GET1): browser NEVER renders user-served bytes as HTML/JS/SVG. `evil.html` displays as text, not executes. |
| `X-Content-Type-Options`  | `nosniff`                         | Defense-in-depth: blocks Chrome/Safari MIME-sniffing heuristics that could override the declared `text/plain` for HTML content. |
| `Cache-Control`           | `no-store`                        | Cross-user cache poisoning defense (T-78-01-GET2): every hit is a fresh auth-checked backend round-trip; no shared-browser leak. |

**Test 26** hits `/file/thenasty/home/ubuntu/evil.html` returning `<script>alert(1)</script>` bytes and asserts `Content-Type: text/plain; charset=utf-8` (NOT `text/html`) with the raw bytes preserved in the body. **Test 34** asserts all three headers are present on error responses (404 `unknown_host`), not just 200 responses.

### Split-router mount pattern (W-3)

In `database.ts`:
```ts
import {
  prettyViewFetchHostFileRoutes,
  fileUrlRoutes,
} from "./routes/pretty-view-fetch-host-file.js";

// ...

app.use("/pretty-view", prettyViewFetchHostFileRoutes);  // POST only
app.use("/", fileUrlRoutes);                              // GET only
```

**Ghost aliases confirmed 404 at wire level** (per the test suite's dedicated `describe("Split-router ghost-alias absence (W-3)")` block):
- `POST /fetch-host-file` at root → 404 (no POST handler on root-mounted router)
- `GET /pretty-view/file/:host/*` → 404 (no GET handler on `/pretty-view`-mounted router)

**Source-level grep gates all pass:**
- `grep -c 'prettyViewFetchHostFileRoutes.get('` → **0** (POST-only router has no GET)
- `grep -c 'fileUrlRoutes.post('` → **0** (GET-only router has no POST)
- `grep -c 'fetchHostFileBytes'` → **5** (declaration + 2 callsites + 2 references) — proves no duplication
- `grep -Ec 'sftp\.realpath|sftpRealpath'` → **6** (import + type + wrapper + call + docstrings) — W-2 defense present
- `grep -c 'FORBIDDEN_PATH_RE'` → **5** (declaration + docstring + 2 test sites + import comment) — same regex used at BOTH boundaries

**Commits:**
- `776d4371` test(78-01): add failing tests for pretty-view-fetch-host-file split-router (RED)
- `ec6875fa` feat(78-01): add pretty-view-fetch-host-file split-router (POST + GET) (GREEN + mount)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Express 5 / path-to-regexp v8+ rejects the plan's literal `/file/:host/*` pattern**

- **Found during:** Task 2 GREEN — router.get() call failed at module load time with `TypeError: Missing parameter name at index 13: /file/:host/*` from `path-to-regexp/src/index.ts`.
- **Issue:** The plan's `<action>` block specifies the Express route as `fileUrlRoutes.get("/file/:host/*", authenticateJWT, getHandler);`. But this project runs Express 5.2.1 (per `package.json`), which uses `path-to-regexp` v8+. v8 no longer accepts bare `*` in the middle of a pattern — all wildcards MUST be named (e.g. `*path`) so downstream code can address them via `req.params.path`. The plan was written against Express 4 semantics.
- **Fix:** Changed the route pattern to `"/file/:host{/*path}"` — path-to-regexp v8 syntax for an OPTIONAL named wildcard. Matches both `/file/host/foo/bar` (yielding `req.params.path = ["foo", "bar"]`) and `/file/host/` (yielding `req.params.path === undefined`). The handler joins segments with `/` and re-adds the leading slash per D-01. The trailing-slash case surfaces as a `path_must_be_absolute` error inside the handler so the GET error taxonomy still covers Test 20.
- **Behavior contract preserved:** From the caller's perspective, `GET /file/<host>/<absolute path>` still resolves to the shared helper with the correct `hostname` and reconstructed `absolutePath`. The `/pretty-view/file/:host/*` ghost-alias 404 assertion (Test suite) still passes.
- **Impact on acceptance criteria:** The plan's grep gate `grep -c 'fileUrlRoutes.get("/file/:host/\*"'` looking for a literal `/*` in the source returns 0 in the shipped code. This is a documented deviation. The equivalent grep `grep -c 'fileUrlRoutes.get("/file/:host'` returns 1 and confirms the GET handler is registered on the GET-only router. The plan's OTHER W-3 grep gates all pass unchanged.
- **Files modified:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` (only the route path string + a comment explaining v8+ semantics + a small `req.params.path` decoding helper in the GET handler).
- **Commit:** `ec6875fa`

**2. [Documentation clarification, not a code deviation] SFTP promise wrappers copied locally rather than imported from `plan-file-fetch.ts`**

- **Found during:** Task 2 planning — the plan's `<action>` block gives planner discretion between importing SFTP helpers from `plan-file-fetch.ts` OR copying them locally.
- **Decision:** Copied locally. `plan-file-fetch.ts`'s `SftpLike` type is module-private (not exported), and adding a new export just for this consumer would widen the plan-file-fetch surface unnecessarily. Local copies are identical in behavior and keep the two callers independent. Documented in a docstring at the top of the SFTP-wrapper section pointing at `plan-file-fetch.ts:L122-163` as the source of truth for the idiom.

No architectural changes. No new npm dependencies. Existing `pretty-view-fetch-tailnet-url.ts` and `resolveHostById` untouched.

## Authentication Gates

None. All test setup uses a mocked `AuthManager.getInstance().createAuthMiddleware()` that accepts a preconfigured `mockUserId`. No real JWTs needed for the vitest suite. Runtime deployment uses the resident `authenticateJWT` middleware inherited from `pretty-view-fetch-tailnet-url.ts` — no new auth wiring.

## Verification Summary

| Check                                                              | Result                              |
| ------------------------------------------------------------------ | ----------------------------------- |
| `npx tsc --noEmit -p tsconfig.node.json` (backend TS graph)        | ✅ exit 0                            |
| `npx vitest run src/backend/ssh/host-resolver.test.ts`             | ✅ 6/6 pass                          |
| `npx vitest run src/backend/database/routes/pretty-view-fetch-host-file.test.ts` | ✅ 35/35 pass          |
| `npx vitest run src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts` (regression) | ✅ 30/30 pass |
| Split-router source-level grep gates (W-3)                         | ✅ 0 cross-registrations             |
| Realpath call present (W-2)                                        | ✅ 6 occurrences                     |
| FORBIDDEN_PATH_RE re-check on resolved target                      | ✅ 2 call sites (pre-SSH + post-realpath) |
| Info-leak grep gate (T-40-05)                                      | ✅ 0 `err.message` in response body  |
| XSS-defense headers on GET (200 + error paths)                     | ✅ Tests 25 + 34 both assert         |
| Wire-level ghost-alias 404 assertions                              | ✅ 2/2 pass                          |
| Backend TS backend compile: `npx tsc --noEmit -p tsconfig.node.json` | ✅ clean                            |

## Known Stubs

None. Every code path is fully wired.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already registers. All mitigations documented in the plan (T-78-01 through T-78-11 + T-78-01-GET1/GET2/GET3/MOUNT + T-78-SC) are implemented and covered by tests.

## Self-Check: PASSED

**Files created (all exist):**
- ✅ `/home/ubuntu/skynet-tiffany/src/backend/database/routes/pretty-view-fetch-host-file.ts`
- ✅ `/home/ubuntu/skynet-tiffany/src/backend/database/routes/pretty-view-fetch-host-file.test.ts`
- ✅ `/home/ubuntu/skynet-tiffany/src/backend/ssh/host-resolver.test.ts`
- ✅ `/home/ubuntu/skynet-tiffany/.planning/phases/78-passthrough-urls-file-url-scheme-phase-1-of-2/78-01-SUMMARY.md` (this file)

**Files modified (verified via `git diff`):**
- ✅ `/home/ubuntu/skynet-tiffany/src/backend/ssh/host-resolver.ts` (+130 lines, `resolveHostById` byte-identical to its pre-change form)
- ✅ `/home/ubuntu/skynet-tiffany/src/backend/database/database.ts` (+13 lines, additive only)

**Commits exist in git log:**
- ✅ `4692b2c2` test(78-01): add failing tests for resolveHostByName cross-user isolation
- ✅ `045c3e9d` feat(78-01): add resolveHostByName(name, userId) with cross-user isolation
- ✅ `776d4371` test(78-01): add failing tests for pretty-view-fetch-host-file split-router
- ✅ `ec6875fa` feat(78-01): add pretty-view-fetch-host-file split-router (POST + GET)

## TDD Gate Compliance

Both tasks followed the RED → GREEN cycle. No plan-level `type: tdd` on the plan frontmatter (`type: execute`), but per-task `tdd="true"` was honored: each task has a `test(...)` commit BEFORE its `feat(...)` commit in the git log. No REFACTOR pass was needed (initial GREEN was clean).
