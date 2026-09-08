---
phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2
verified: 2026-09-06T09:31:00Z
status: passed
score: 10/10 verification items PASS
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 78: Passthrough URLs — file URL scheme (phase 1 of 2) — Verification Report

**Phase Goal:** Ship the file half of the two-phase passthrough-URL shape: agent-cited URLs `<skynet-domain>/file/<hostname>/<absolute-path>` that Skynet fetches via SSH and surfaces in message bubbles with the existing edit affordance, plus the per-box `~/.claude/skynet-parent` config file pushed by the distributor, plus the id-skill rewrite retiring the tailnet http.server recipe.

**Verified:** 2026-09-06T09:31:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement — 10 Verification Focus Items

| #  | Item                                       | Status | Evidence |
| -- | ------------------------------------------ | ------ | -------- |
| 1  | D-01 URL grammar delivered                 | PASS   | Backend GET route `fileUrlRoutes.get("/file/:host{/*path}", ...)` at `pretty-view-fetch-host-file.ts:577` uses Express 5 / path-to-regexp v8 syntax (documented deviation from plan's bare `*` — appropriate for the runtime). Frontend regex `SKYNET_FILE_URL_RE_CLIENT = /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g` at `editable-file-whitelist.ts:143-144` matches the shape agents construct. |
| 2  | D-02 broken-URL UX delivered               | PASS   | (a) No preflight HEAD anywhere: `grep -n -E "\.head\(\|method:\s*['\"]HEAD['\"]\|preflight"` across `use-editable-file-eligibility.ts`, `EditableFileModal.tsx`, `EditableFileAffordance.tsx`, `editable-file-api.ts` returns 0 matches. (b) 12-entry `FILE_URL_ERROR_COPY` table + `classifyModalError()` at `EditableFileModal.tsx:63-147` map all 11 backend error classes (host_unreachable, not_found, too_large, not_a_file, path_forbidden, path_traversal, path_must_be_absolute, unknown_host, ssh_timeout, invalid_hostname, invalid_body) plus `permission_denied` special-case (weaves hostname) plus `generic` fallback → human-readable {heading, body} pairs with no HTTP status codes or stack traces. |
| 3  | D-03 distributor config delivered          | PASS   | `run-bootstrap.ts:146` reads `process.env.SKYNET_PUBLIC_URL ?? ""` at function top (per RESEARCH Assumption A6 — avoids 3-layer plumbing). Step 4 at L374-437: writes `~/.claude/skynet-parent` idempotently via content-diff guard `[ "$(cat "$SP")" = "$NEW" ]` + atomic `printf … > .new && mv .new`. Guard clause at L386 `if (!skynetPublicUrl \|\| !/^https:\/\//.test(skynetPublicUrl))` skips cleanly, does NOT set `hadError=true`, logs a `systemLogger.warn`. Sentinel `__SKYNET_PARENT_OK__` echoed and checked via `.endsWith`. NEVER-THROW envelope: outer try/catch calls `logBootstrapFailed`, function still resolves. |
| 4  | D-04 SSH-user read mechanic delivered      | PASS   | Shared helper `fetchHostFileBytes` at `pretty-view-fetch-host-file.ts:201-282` uses `withConnection(poolKey, () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS), …)` — imports at L53-54. No `sudo` anywhere in the file. `permissionManager.canAccessHost(userId, host.id, "read")` gates access before any SFTP work at L233-244. Skynet's existing per-host SSH connection is used verbatim. |
| 5  | Shape philosophy — BOTH POST + GET routes  | PASS   | Two narrow routers exported at `pretty-view-fetch-host-file.ts:563-577`: `prettyViewFetchHostFileRoutes` (POST-only) mounted at `/pretty-view` (database.ts:1883) serves modal JSON path; `fileUrlRoutes` (GET-only) mounted at `/` (database.ts:1884) serves verbatim URL agents cite. Both call the same shared `fetchHostFileBytes` helper — no handler-code duplication. |
| 6  | Shape scope-edges respected                | PASS   | (a) No directory listings — `grep -i -E "readdir\|opendir"` on route file returns 0. (b) No writes — `grep -i -E "writefile\|sftp\.write"` on route file returns 0; Skynet is read-only per Save-attaches-to-compose flow. (c) No fallback in id-skill — `grep -c "python3 -m http.server"` on `substrate/skills/id/SKILL.md` returns 0 (also mktemp -d -t share- = 0, tailscale ip -4 = 0). (d) No preflight HEAD — verified in item 2 above. |
| 7  | Cross-user isolation invariant             | PASS   | `resolveHostByName` at `host-resolver.ts:291-306` uses `and(eq(hosts.name, name), eq(hosts.userId, userId))` at L301 — filters by BOTH name AND userId. Returns null on zero results (L306). Route boundary at `pretty-view-fetch-host-file.ts:228-231` maps null → `throw new Error("unknown_host")` → 404 (generic — no cross-user existence leak via 403 differentiation). Same generic `unknown_host` returned whether host doesn't exist anywhere or belongs to another user. |
| 8  | XSS defense on GET route                   | PASS   | `PLAIN_TEXT_HEADERS` at `pretty-view-fetch-host-file.ts:101-104` = `{ "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" }`. Set at top of GET handler (`res.set(PLAIN_TEXT_HEADERS)` at L413) so error branches inherit; re-asserted on 200 success (L443), path_must_be_absolute error (L432), and generic error (L456). All three headers present on every GET response regardless of file extension. |
| 9  | Symlink defense via sftp.realpath (T-78-07)| PASS   | Shared helper at `pretty-view-fetch-host-file.ts:257-274` runs STRICT ORDER: (1) openSftp, (2) `resolvedPath = await sftpRealpath(sftp, absolutePath)` at L263, (3) `FORBIDDEN_PATH_RE.test(resolvedPath)` re-check at L264-266 throwing `path_forbidden`, (4) `sftpStat(sftp, resolvedPath)` at L267, (5) size + isFile checks, (6) `sftpReadFile(sftp, resolvedPath)` at L274. Realpath runs BEFORE stat; forbidden regex re-applied on RESOLVED target; test Test 17 in the suite mocks `sftpRealpath → /proc/kmsg` and asserts `sftpStat` NOT called. |
| 10 | Whitelist mirror rule respected            | PASS   | Client `SKYNET_FILE_URL_RE_CLIENT` at `src/ui/features/pretty-view/editable-file-whitelist.ts:143-144`. Backend mirror-note docblock at `src/backend/utils/editable-file-whitelist.ts:16-26` explicitly references the new client regex and documents WHY the backend twin does NOT re-export it (backend route does its own validation via `/^[a-zA-Z0-9._-]+$/`). Whitelist DATA (EDITABLE_EXTENSIONS + EDITABLE_BASENAMES + classifyByExtension) remains byte-identical between the two files per Phase 40 D-02. |

**Score:** 10/10 verification items PASS

## Required Artifacts

| Artifact                                                              | Expected                                    | Status     | Details |
| --------------------------------------------------------------------- | ------------------------------------------- | ---------- | ------- |
| `src/backend/database/routes/pretty-view-fetch-host-file.ts`          | New split-router route file                 | VERIFIED   | 24175 bytes; exports `prettyViewFetchHostFileRoutes` + `fileUrlRoutes`; shared `fetchHostFileBytes` helper; realpath-BEFORE-stat symlink defense; PLAIN_TEXT_HEADERS |
| `src/backend/database/routes/pretty-view-fetch-host-file.test.ts`     | 35 tests covering POST + GET + symlink       | VERIFIED   | 35/35 pass (POST 17 + GET 17 + shared helper 1) |
| `src/backend/ssh/host-resolver.ts`                                    | Extended with `resolveHostByName(name, userId)` | VERIFIED | New sibling export at L291-306, `and(hosts.name, hosts.userId)` WHERE clause; existing `resolveHostById` untouched |
| `src/backend/ssh/host-resolver-by-name.test.ts` (post-rescue-rebase)  | Cross-user isolation tests                   | VERIFIED   | Split from origin's CSKEK suite in fix commit `1380309f`; 10 tests pass |
| `src/backend/database/database.ts`                                    | Two mount lines for split routers            | VERIFIED   | Named import at L42-45; `app.use("/pretty-view", prettyViewFetchHostFileRoutes)` at L1883; `app.use("/", fileUrlRoutes)` at L1884 |
| `src/ui/features/pretty-view/editable-file-whitelist.ts`              | Sibling `SKYNET_FILE_URL_RE_CLIENT` export   | VERIFIED   | Export at L143-144 with matching docblock discipline; TAILNET_URL_RE_CLIENT unchanged |
| `src/backend/utils/editable-file-whitelist.ts`                        | Mirror-rule docblock note                    | VERIFIED   | Docblock note at L16-26; regex NOT re-exported (as designed) |
| `src/ui/features/pretty-view/editable-file-whitelist.test.ts`         | 8 whitelist tests                            | VERIFIED   | Included in 40-test frontend whitelist suite pass |
| `src/ui/features/pretty-view/use-editable-file-eligibility.ts`        | Dual-regex scan + dispatch                   | VERIFIED   | Imports `SKYNET_FILE_URL_RE_CLIENT` + `fetchHostFileUrl`; `FILE_URL_DISPATCH_RE` at L48; scans both regexes at L87; dispatches at L126-128 |
| `src/ui/features/pretty-view/use-editable-file-eligibility.test.ts`   | 5 new hook tests                             | VERIFIED   | All pass in 56-test frontend suite |
| `src/ui/api/editable-file-api.ts`                                     | New `fetchHostFileUrl` export                | VERIFIED   | Export at L131-163; parses URL, POSTs to `/pretty-view/fetch-host-file`, preserves backend error-class across axios boundary |
| `src/ui/api/editable-file-api.test.ts`                                | 5 API tests                                  | VERIFIED   | Included in 56-test frontend suite |
| `src/ui/features/pretty-view/EditableFileModal.tsx`                   | Dispatch by URL shape + 9-class error copy   | VERIFIED   | Imports `fetchHostFileUrl`; `FILE_URL_DISPATCH_RE` at L34; dispatch at L249-252; `FILE_URL_ERROR_COPY` table at L63-112 (12 entries); `classifyModalError` at L129-147 |
| `src/ui/features/pretty-view/EditableFileModal.test.tsx`              | 7 modal tests                                | VERIFIED   | Included in 56-test frontend suite |
| `src/backend/distributor/run-bootstrap.ts`                            | Step 4 skynet-parent write                   | VERIFIED   | `skynetPublicUrl` read at L146; `BootstrapResult.skynetParentOk` at L82; step 4 block at L374-437; return object at L439-447 |
| `src/backend/distributor/run-bootstrap.test.ts`                       | 11 new step-4 tests                          | VERIFIED   | 24 total pass (11 new + 13 pre-existing regression) |
| `substrate/skills/id/SKILL.md`                                        | "Sending files" section rewritten            | VERIFIED   | Section at L794-873; http.server / mktemp -d -t share- / tailscale ip -4 all fully retired (grep = 0); new URL scheme + construction snippet + D-03 missing-file behavior + read-only round-trip semantics + "why we replaced" paragraph all present |

## Key Link Verification

| From                                                                     | To                                                            | Via                                            | Status | Details |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------- | ------ | ------- |
| `src/backend/database/database.ts`                                       | `pretty-view-fetch-host-file.ts` (POST router)                | `app.use("/pretty-view", prettyViewFetchHostFileRoutes)` | WIRED  | Line 1883, exact match to plan |
| `src/backend/database/database.ts`                                       | `pretty-view-fetch-host-file.ts` (GET router)                 | `app.use("/", fileUrlRoutes)`                  | WIRED  | Line 1884, exact match to plan |
| `pretty-view-fetch-host-file.ts` (fetchHostFileBytes)                    | `host-resolver.ts` (resolveHostByName)                        | import + call from shared helper               | WIRED  | Import at L57; call at L228 |
| `pretty-view-fetch-host-file.ts` (fetchHostFileBytes)                    | `ssh-connection-pool.ts` (withConnection)                     | import + call                                  | WIRED  | Import at L53; call at L252 |
| `pretty-view-fetch-host-file.ts` (fetchHostFileBytes)                    | `permission-manager.ts` (canAccessHost)                       | permissionManager.canAccessHost(userId, host.id, "read") | WIRED | Called at L233-237 |
| `pretty-view-fetch-host-file.ts` (fetchHostFileBytes)                    | `sftp.realpath` (T-78-07 defense)                             | sftpRealpath BEFORE sftpStat                   | WIRED  | Ordered at L263 (realpath) → L267 (stat) → L274 (read) |
| `use-editable-file-eligibility.ts`                                       | `editable-file-whitelist.ts` (SKYNET_FILE_URL_RE_CLIENT)      | import + .match()                              | WIRED  | Import at L38; used at L87 |
| `use-editable-file-eligibility.ts`                                       | `editable-file-api.ts` (fetchHostFileUrl)                     | import + call                                  | WIRED  | Import at L32; call at L128 |
| `EditableFileModal.tsx`                                                  | `editable-file-api.ts` (fetchHostFileUrl)                     | import + call                                  | WIRED  | Import at L13; call at L251 |
| `editable-file-api.ts` (fetchHostFileUrl)                                | backend POST /pretty-view/fetch-host-file                     | authApi.post                                   | WIRED  | Called at L142 |
| `run-bootstrap.ts` (runBootstrapForHost step 4)                          | `~/.claude/skynet-parent` on managed host                     | channel.exec of idempotent shell script        | WIRED  | Executed at L414 |
| `run-bootstrap.ts`                                                       | `process.env.SKYNET_PUBLIC_URL`                               | read at function top                           | WIRED  | Read at L146 |
| `substrate/skills/id/SKILL.md § Sending files to the user`               | `~/.claude/skynet-parent`                                     | `cat ~/.claude/skynet-parent` in construction snippet | WIRED  | At L820 (`SKYNET=$(cat ~/.claude/skynet-parent 2>/dev/null)`) |

## Behavioral Spot-Checks

| Behavior                                                    | Command                                                              | Result | Status |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ------ | ------ |
| Backend route + resolveHostByName + host-resolver + run-bootstrap tests | `npx vitest run ...pretty-view-fetch-host-file.test.ts ...host-resolver.test.ts ...host-resolver-by-name.test.ts ...run-bootstrap.test.ts` | 35 + 6 + 10 + 24 = 75 tests pass | PASS |
| Frontend whitelist + eligibility + modal + API tests        | `npx vitest run ...editable-file-whitelist.test.ts ...use-editable-file-eligibility.test.ts EditableFileModal.test.tsx editable-file-api.test.ts` | 56 tests pass (8 + 15 + 23 + 10) | PASS |
| Total scoped test count (per SUMMARY claim)                 | Aggregate                                                             | 131 tests pass across 8 files | PASS |
| No preflight HEAD anywhere in frontend                      | `grep -n -E "\\.head\\(\|method:\\s*['\"]HEAD['\"]\|preflight" src/ui/features/pretty-view/*.ts* src/ui/api/editable-file-api.ts` | 0 hits | PASS |
| http.server recipe fully retired from id-skill              | `grep -c "python3 -m http.server\|mktemp -d -t share-\|tailscale ip -4" substrate/skills/id/SKILL.md` | 0 hits each | PASS |
| Split-router ghost-alias absence at source                  | `grep -c 'prettyViewFetchHostFileRoutes.get(' pretty-view-fetch-host-file.ts`; `grep -c 'fileUrlRoutes.post(' ...` | 0 / 0 | PASS |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src/ui/features/pretty-view/editable-file-whitelist.ts` | L55 | `"TODO"` in `EDITABLE_BASENAMES` set | Info | This is a filename string literal (agents commonly create files named `TODO`) — NOT a code debt marker. Same file has other basenames like `README`, `LICENSE`, `NOTICE`. |
| `src/backend/utils/editable-file-whitelist.ts` | L66 | `"TODO"` in `EDITABLE_BASENAMES` set | Info | Byte-identical mirror of the above; same benign classification. |

No `TBD`, `FIXME`, or `XXX` markers found in any file modified this phase. No blocker anti-patterns.

## Requirements Coverage

No REQUIREMENTS.md IDs are mapped to this phase (per ROADMAP L1871): "REQUIREMENTS.md scope is patch #43 pretty-view work, this phase is a separate fleet-substrate feature under the box-maintainer role's ownership stream." Verification governed entirely by CONTEXT D-01..D-04 + the shape file.

## Deferred / Out-of-Scope (per Shape)

| Item                                                              | Addressed In                        | Evidence |
| ----------------------------------------------------------------- | ----------------------------------- | -------- |
| Serve URL scheme (`/serve/<host>/<port>/…`)                       | Phase 2 of the shape (later phase)  | Explicit in shape + CONTEXT deferred block |
| Directory listings via file URL                                   | Ruled out by shape                  | Verified absent in codebase (no readdir/opendir) |
| Skynet writing directly to host files                             | Ruled out by shape                  | Verified absent (no sftp.write / writeFile in route) |
| Fallback tailnet http.server path in id-skill                     | Ruled out by RESEARCH Pitfall 5     | Grep confirms 0 mentions |
| Preflight HEAD on rendered URLs                                   | Ruled out by D-02                   | Grep confirms 0 mentions in eligibility/modal/API |

## Human Verification Required

None. All 10 verification focus items were verifiable programmatically via grep + file inspection + test execution. The phase is documentation-, code-, and test-complete at ship boundary. Deployment-time behaviors (operator adds `SKYNET_PUBLIC_URL` to `/opt/skynet/skynet.env`, docker compose recreate, browser tab opens verbatim URL on live Skynet) are explicitly out of executor scope per each plan's "Coordination note" and Ashley's greenlight is required next session.

## Gaps Summary

None. Every verification focus item has direct code evidence in the shipped files:
- URL grammar exists on both surfaces (backend GET route + frontend regex).
- Broken-URL UX has no preflight HEAD and a 12-entry human-readable error copy table.
- Distributor step 4 writes `~/.claude/skynet-parent` idempotently with proper missing-env skip.
- SSH-user read mechanic uses `withConnection` + `connectOneShot`, no sudo.
- BOTH POST and GET routes exist and share the fetch helper.
- Shape scope-edges (directory listings, host writes, tailnet fallback, preflight HEAD) all confirmed absent.
- Cross-user isolation via `and(hosts.name, hosts.userId)` and generic `unknown_host` error.
- XSS defense headers (text/plain + nosniff + no-store) set on every GET response.
- Symlink defense: `sftp.realpath` called BEFORE `sftp.stat` with `FORBIDDEN_PATH_RE` re-check.
- Whitelist mirror-rule bookkeeping preserved on backend twin (docblock note only, per Phase 40 D-02 rationale for URL regexes).

Ship boundary status matches SUMMARY claims: code + commits + tests-green only. NOT pushed, NOT built, NOT deployed.

---

_Verified: 2026-09-06T09:31:00Z_
_Verifier: Claude (gsd-verifier)_
