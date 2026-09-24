---
phase: 128-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-
verified: 2026-09-21T06:25:00Z
status: human_needed
score: 20/20 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Deploy container + curl /wakeups (HTTP + HTTPS) end-to-end"
    expected: "GET /wakeups (via nginx.conf and via nginx-https.conf) returns 401 without JWT and 200 with a JWT; nginx does NOT fall through to the SPA (i.e. response is JSON, not the HTML index page). Confirms the paired location blocks route to the backend."
    why_human: "Requires docker build + docker compose up + a live JWT session; not runnable inside the verifier without starting services and issuing an authenticated request. Executor's remit stops at HEAD; this is the D-18/D-19 orchestrator/human deploy motion."
  - test: "Create → List → Toggle → Delete a wake-up via HTTP from the shape-3 modal (or curl) against a real fleet host"
    expected: "POST returns 201 with {slug, host, spec}; GET reflects the new row across the fleet fan-out; PATCH /:slug/toggle-enabled flips enabled; DELETE returns 204 and BOTH the folder AND the .state/<slug>.fired sentinel are gone on the target host; scheduler picks up subsequent state changes without stale-sentinel artifacts."
    why_human: "Involves real SSH round-trips + real filesystem state on a managed host; requires the container running + the scheduler daemon observable. Cannot be exercised programmatically inside the verifier (no live target host in the verifier sandbox)."
  - test: "Confirm no browser tab on the OLD build regresses noticeably after deploy (stale-tab A1)"
    expected: "Any browser tab still on the pre-Phase-128 build that sends role:list-wakeups over WS observes a silent no-op (server drops the message) rather than a runtime error; user-facing failure mode is exactly a hung Wakeups tab in RoleModal until the tab is hard-refreshed."
    why_human: "Requires a stale tab + running server + WS traffic; A1 accepted-risk in RESEARCH.md — verify the failure mode is behavior-consistent with the accepted risk description."
---

# Phase 134: wake-ups-redesign campaign shape 2 (CRUD API) — Verification Report

**Phase Goal:** Skynet backend REST endpoints for fleet-wide CRUD over global wake-up specs at `~/fleet/wakeups/<slug>/wakeup.json` (list / create / update / delete / toggle-enabled) plus role enumeration for the modal's chip-picker. Fleet-wide sweep pattern mirroring fleet-status. Thin layer over on-disk state — file is the truth. Also folds in removal of the retired per-role wake-up CRUD surface.

**Verified:** 2026-09-21T06:25:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /wakeups fleet-wide LIST router exists with fan-out + graceful degradation | VERIFIED | `wakeups-list.ts` L253-353: `router.get("/", authenticateJWT, ...)` with `Promise.all(candidates.map(...))` + `Promise.race([work, timeout(15s)])` at L306-314 and L323-331; per-host `.catch` fallback via outer try/catch returning `[]` at L339-347. |
| 2 | POST /wakeups CREATE creates spec atomically, returns 201 | VERIFIED | `wakeups-write.ts` L261-435: LOCAL and REMOTE branches; `writeMarkdownFileAtomic` at L312/396; 201 return at L323/413. |
| 3 | PATCH /wakeups/:slug UPDATE overwrites atomically, returns 200 | VERIFIED | `wakeups-write.ts` L441-574: `res.status(200).json({slug, host, spec})` at L498/552; atomic write via `writeMarkdownFileAtomic` at L487/540. |
| 4 | PATCH /wakeups/:slug/toggle-enabled flips enabled bit, returns 200 (404 if missing) | VERIFIED | `wakeups-write.ts` L580-754: reads spec, mutates `parsed.enabled = enabled` at L645/717, atomic write; 404 at L619/700. |
| 5 | DELETE /wakeups/:slug removes folder AND .state/<slug>.fired sentinel, returns 204 | VERIFIED | `wakeups-write.ts` L760-867: LOCAL branch `fs.rm(dir, recursive:true)` + `fs.unlink(sentinel)` at L791-803; REMOTE branch ONE `execCommand` combining `rm -rf .../<slug> && rm -f .../.state/<slug>.fired` at L831-834; 204 at L804/845. |
| 6 | 409 returned when CREATE slug collides | VERIFIED | `wakeups-write.ts` L301 (LOCAL) + L366 (REMOTE probe with `[ -e ... ] && echo EXISTS`): `res.status(409).json(...)`. |
| 7 | 400 returned when spec violates scheduler parity gate | VERIFIED | `validateGlobalWakeupSpec` at L141-202 mirrors `_load_specs_global` L224-248 exactly — accept iff dict + truthy `prompt` + truthy `schedule` object + `type ∈ {interval,daily,weekly,one_shot}` + per-type required fields (`every` / `at` / `day+at`). Caller at L272-275 returns 400 on validation error. |
| 8 | 404 returned when host is unowned (resolveHostById returns null) | VERIFIED | All four handlers call `resolveHostById(hostId, userId)` and return `404 {error: "Host not found"}` when null: L285/473/602/776. |
| 9 | LIST responds even when one managed host is down/slow (graceful degradation) | VERIFIED | Per-host `Promise.race([work, timeout(15_000ms)])` + outer try/catch returns `[]` for that host at `wakeups-list.ts` L306-347 mirroring `conversation-search.ts:576-622`. |
| 10 | Skynet's own host is included in fan-out via LOCAL branch (bind mount, not loopback SSH) — D-16 | VERIFIED | `wakeups-list.ts` L305 `if (isLocalHostId(hostId))` uses `readWakeupsLocal` (L140-191) via `fs/promises` against `getLocalWakeupsRoot()`; write path same at L295/483/612/786. |
| 11 | New /wakeups routes reach the backend in BOTH HTTP and HTTPS nginx configs — D-17 | VERIFIED | `docker/nginx.conf:465` + `docker/nginx-https.conf:479` both have paired `location ~ ^/wakeups(/.*)?$` blocks; identical `proxy_pass http://127.0.0.1:30001`, `proxy_read_timeout 15s`, `client_max_body_size 64k`. |
| 12 | Role enumeration endpoint still available for shape-3 modal chip-picker (D-04 — reuse only) | VERIFIED | `git diff --stat 0057fc4c^..HEAD -- src/backend/database/routes/roles-list-for-host.ts` reports 0 changes. Endpoint intact and reachable. |
| 13 | Per-role wake-up backend service functions removed from identity-artifact-reader.ts (D-10) | VERIFIED | `grep -c "function readRoleWakeups\|function readRoleWakeupsByName\|function writeRoleWakeupUpdate\|function writeRoleWakeupCreate\|function writeRoleWakeupDelete\|function writeRoleWakeupByName\|function deleteRoleWakeupByName"` = 0. Only 2 comment breadcrumb references remain. |
| 14 | Per-role wake-up WS handlers removed from claude-session-server.ts (D-11) | VERIFIED | `grep -c "identity:list-role-wakeups\|identity:update-role-wakeup\|identity:create-role-wakeup\|identity:delete-role-wakeup\|\"role:list-wakeups\"\|\"role:create-wakeup\"\|\"role:update-wakeup\"\|\"role:delete-wakeup\""` finds only 2 lines — both inside comment breadcrumbs at L1766-1767; no live handlers. Per-identity wire ops (`identity:list-wakeups` etc — no `-role`) grep to 33 occurrences → preserved. |
| 15 | Per-role wake-up frontend helpers + payload/event types removed from claude-session-api.ts (D-12) | VERIFIED | `grep -c "export function listRoleWakeups\|export function listRoleWakeupsByName\|export function createRoleWakeupByName\|export function updateRoleWakeupByName\|export function deleteRoleWakeupByName"` = 0. Event types grep finds only 2 lines — both inside comment breadcrumb at L414-415. `WakeupSpecWire` grep = 3 (STAYS). |
| 16 | RoleModal.tsx role-wakeups tab + state + effects + callbacks + imports removed (D-09) | VERIFIED | `grep -c "AlarmClock\|WakeupsTab\|listRoleWakeupsByName\|createRoleWakeupByName\|updateRoleWakeupByName\|deleteRoleWakeupByName" src/ui/features/pretty-view/RoleModal.tsx` = 0. NAV_SECTIONS entries at L81-83 = 3 items (role/runbooks/bounties). No `roleWakeupsState`; no `TabsContent value="role-wakeups"`. |
| 17 | Per-identity WakeupsTab.tsx byte-identical during Phase 134 (D-09) — IdentityModal still mounts it | VERIFIED | `git log --oneline 0057fc4c^..HEAD -- src/ui/features/pretty-view/WakeupsTab.tsx` returns empty (0 Phase 134 commits touch it). `grep -c "import.*WakeupsTab\|WakeupsTab from " src/ui/features/pretty-view/IdentityModal.tsx` = 1 (import preserved). |
| 18 | 4 test files DELETED wholesale + 2 test files surgically excised (D-13) | VERIFIED | `ls` of `identity-artifact-reader.role-wakeups.test.ts`, `claude-session-server.role-wakeups.test.ts`, `claude-session-server.role-wakeup-crud.test.ts`, `claude-session-api.role-wakeup-crud.test.ts` all return "No such file or directory". `PrettyView.role-modal-swap.test.tsx` grep for the 4 mock stubs = 0. `identity-artifact-reader.wakeup-crud.test.ts` (per-identity — D-13 KEEP) is present and passes 7/7. |
| 19 | Backend + frontend TypeScript compile clean | VERIFIED | `npm run build:backend` exits 0; `npm run build` exits 0 (see build output section below). |
| 20 | Scoped tests over all touched files pass | VERIFIED | 133 test files pass, 2134 tests pass, 10 skipped, 1 todo across every scoped-related file (identity-artifact-reader.ts, claude-session-server.ts, claude-session-api.ts, RoleModal.tsx, WakeupsTab.tsx, IdentityModal.tsx). New route tests: 3 files, 46 pass (wakeups-list.ts + wakeups-write.ts scoped set). Per-identity CRUD: 7/7. |

**Score:** 20/20 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/database/routes/wakeups-list.ts` | GET /wakeups fleet-wide fan-out router (min 150 lines, default export) | VERIFIED | 373 lines. `export default router;` at L372. Contains `Promise.race` (2 hits), `isLocalHostId` (2 hits), `===SLUG:` delimiter (2 hits). |
| `src/backend/database/routes/wakeups-write.ts` | POST/PATCH/DELETE /wakeups router (min 250 lines, atomic writes, semaphore) | VERIFIED | 887 lines. `export default router;` at L886. Contains `getHostSemaphore` (4 hits, one per write handler), `writeMarkdownFileAtomic` (5 hits), `.fired` (7 hits — sentinel cleanup wired). |
| `src/backend/database/routes/wakeups-list.test.ts` | vitest coverage of LIST endpoint (10+ cases) | VERIFIED | 12 `it()` blocks. Includes 401 auth, 2-host fan-out, timeout, LOCAL branch, REMOTE branch, poisoned JSON, empty dir, cross-user filter, humanizeWakeupSchedule population, enableSsh filter, multi-slug batch. |
| `src/backend/database/routes/wakeups-write.test.ts` | vitest coverage of write endpoints (10+ cases, includes clobber + sentinel + sftp.rename trap) | VERIFIED | 16 `it()` blocks. `sftp.rename` throwing trap at L246. `.fired` regression pin at L5 references verify combined rm exec. |
| `src/backend/claude-session/identity-artifact-reader.ts` | getLocalWakeupsRoot() helper + exported normalizeWakeupSlug | VERIFIED | `export function getLocalWakeupsRoot(): string` at L324. `export function normalizeWakeupSlug(name: string): string` at L1981. Per-identity wakeup functions (readIdentityWakeups, writeIdentityWakeupCreate, ...Update, ...Delete) preserved at L1454/1888/2019/2097. |
| `src/backend/database/database.ts` | app.use("/wakeups", ...) chained mounts | VERIFIED | Imports at L76-77; chained mounts at L2036-2037: `app.use("/wakeups", wakeupsListRoutes); app.use("/wakeups", wakeupsWriteRoutes);` |
| `docker/nginx.conf` | location ~ ^/wakeups(/.*)?$ block | VERIFIED | Line 465-474; proxy_pass 127.0.0.1:30001, HTTP/1.1, standard headers, proxy_read_timeout 15s, client_max_body_size 64k. |
| `docker/nginx-https.conf` | paired /wakeups location block | VERIFIED | Line 479-488; byte-shape identical to HTTP conf. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `database.ts` | `wakeups-list.ts` | `app.use("/wakeups", wakeupsListRoutes)` | WIRED | Line 2036. |
| `database.ts` | `wakeups-write.ts` | `app.use("/wakeups", wakeupsWriteRoutes)` | WIRED | Line 2037. |
| `wakeups-list.ts` | `identity-artifact-reader.ts` | `import { humanizeWakeupSchedule, isLocalHostId, getLocalWakeupsRoot }` | WIRED | Line 48-52. All 3 helpers used. |
| `wakeups-write.ts` | `identity-artifact-reader.ts` | `import { writeMarkdownFileAtomic, normalizeWakeupSlug, IDENTITY_SLUG_RE, isLocalHostId, getLocalWakeupsRoot }` | WIRED | Line 66-72. All 5 helpers used. |
| `docker/nginx.conf` | `docker/nginx-https.conf` | Paired `location ~ ^/wakeups` (D-17) | WIRED | Both configs carry byte-shape-identical blocks (proxy_pass, headers, timeouts). |
| `IdentityModal.tsx` | `WakeupsTab.tsx` | `import ... WakeupsTab from "./WakeupsTab"` (D-09 — untouched) | WIRED | 1 import in IdentityModal. WakeupsTab.tsx byte-identical during Phase 134. |
| `RoleModal.tsx` | (no WakeupsTab import — removal verification) | negative-grep verified | WIRED | 0 matches for `AlarmClock\|WakeupsTab\|listRoleWakeupsByName\|createRoleWakeupByName\|updateRoleWakeupByName\|deleteRoleWakeupByName`. |

### Data-Flow Trace (Level 4)

Not applicable for backend REST routes — request/response data flow is directly observable via the test suite (46 scoped tests over wakeups-list.ts + wakeups-write.ts assert JSON shape end-to-end through mocked SSH/DB seams). The frontend consumer (shape-3 modal) is out of scope for Phase 134.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend TS compiles clean | `npm run build:backend` | 0 errors, dist output produced | PASS |
| Frontend TS compiles clean | `npm run build` | 0 errors, ✓ built in 4.26s | PASS |
| New wakeups routes tests pass | `npx vitest related --run src/backend/database/routes/wakeups-list.ts src/backend/database/routes/wakeups-write.ts` | 3 files pass, 46 tests pass | PASS |
| Cross-cutting scoped tests pass | `npx vitest related --run identity-artifact-reader.ts claude-session-server.ts claude-session-api.ts RoleModal.tsx WakeupsTab.tsx IdentityModal.tsx` | 133 files pass, 2134 pass / 10 skip / 1 todo | PASS |
| Per-identity CRUD test still green | `npx vitest related --run identity-artifact-reader.wakeup-crud.test.ts` | 1 file pass, 7 tests pass | PASS |
| Live curl against dev container | (requires docker-compose up) | SKIPPED — routed to human verification | SKIP |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes are declared in the PLANs or SUMMARY, nor discovered in `scripts/` for Phase 134. Not applicable.

### Requirements Coverage

Phase 134 uses D-XX decisions instead of REQ-IDs (matching Phase 123/127 pattern per CONTEXT.md). No `requirements:` field is populated in the plans. Decision coverage below.

| Decision | Description | Status | Evidence |
|----------|-------------|--------|----------|
| D-01 | HTTP REST endpoint style (not WS) | SATISFIED | `wakeups-list.ts` + `wakeups-write.ts` use `express.Router()`; no WS wire ops added. |
| D-02 | Fleet-wide sweep on LIST; host param on writes | SATISFIED | LIST fan-out at wakeups-list.ts L295-349; writes accept `host` in body (`requirePositiveIntegerHost` at L226-245). |
| D-03 | Thin API; no DB shadow | SATISFIED | No new schema, no migration. Wakeups read/written directly on disk (LOCAL: fs/promises; REMOTE: SSH). |
| D-04 | Roles enumeration reuse, skills OUT | SATISFIED | `roles-list-for-host.ts` untouched during Phase 134 (0 commits). No `/skills` endpoint added. |
| D-05 | Atomic writes via writeMarkdownFileAtomic + ext_openssh_rename | SATISFIED | 5 writeMarkdownFileAtomic call sites in wakeups-write.ts (CREATE LOCAL/REMOTE, UPDATE LOCAL/REMOTE, TOGGLE, DELETE). sftp.rename ONLY mentioned in docstrings + test trap. |
| D-06 | Hard delete + .fired sentinel cleanup | SATISFIED | REMOTE at wakeups-write.ts L831-834: single execCommand with `rm -rf .../<slug> && rm -f .../.state/<slug>.fired`. LOCAL at L791-803: `fs.rm(dir, recursive:true)` + `fs.unlink(sentinel).catch(()=>{})`. |
| D-07 | Kebab-case slug via normalizeWakeupSlug; 409 on collision | SATISFIED | POST at wakeups-write.ts L278 `normalizeWakeupSlug(validSpec.name)`; probe + 409 at L301/366. |
| D-08 | Validation MIRRORS wakeup-scheduler.py _load_specs_global | SATISFIED | `validateGlobalWakeupSpec` at wakeups-write.ts L141-202 accepts iff object + prompt + schedule object + type ∈ {interval,daily,weekly,one_shot} + type-specific fields. No prompt-cap, no roles-min. Mirrors substrate/scripts/wakeup-scheduler.py L224-248. |
| D-09 | WakeupsTab.tsx stays intact; RoleModal role-wakeups tab removed | SATISFIED | WakeupsTab.tsx 0 Phase 134 commits; RoleModal 0 remnants (AlarmClock/WakeupsTab/callbacks/NAV/TabsContent). |
| D-10 | 6 role-wakeup backend service functions removed | SATISFIED | 0 role-wakeup functions in identity-artifact-reader.ts. SUMMARY notes a 7th (`deleteRoleWakeupByName`) also removed as Rule-3 orphan — appropriate since its only consumer was retired in Task 2. |
| D-11 | 8 role-wakeup WS handlers + JSDoc + imports removed | SATISFIED | 0 handlers matching the 8 wire-op strings. 2 comment breadcrumbs remain. Per-identity handlers preserved (33 occurrences). |
| D-12 | 5 role-wakeup frontend helpers + payload/event types removed; WakeupSpecWire STAYS | SATISFIED | 0 role-wakeup helpers. Event types only in 1 comment breadcrumb. WakeupSpecWire = 3 occurrences (STAYS). |
| D-13 | 4 wholesale test-file deletions + 2 surgical excisions | SATISFIED | All 4 files gone. PrettyView.role-modal-swap.test.tsx has 0 role-wakeup mock stubs. claude-session-api.role-reads.test.ts surgical excision applied. Plus 3 Rule-3 mop-ups (claude-session-server.role-reads.test.ts, RoleModal.test.tsx, PrettyConversationsPanel.role-management-flow.test.tsx) — expected auto-fixes surfaced by scoped tests. |
| D-14 | Order: Plan 134-01 lands before 134-02 | SATISFIED | Git log shows plan 134-01 commits (0057fc4c, a8016297, 9bf67631, 83b77b08) precede plan 134-02 commits (689ad7a4, bc18bbcb, 5c37ebf1, eab253d6). |
| D-15 | SSH fan-out with delimiter one-liner | SATISFIED | wakeups-list.ts L207-208: `===SLUG:` delimiter pattern; adapted from readIdentityWakeups. |
| D-16 | Skynet host in fan-out via LOCAL branch (bind mount) | SATISFIED | LOCAL branch (`isLocalHostId(hostId)`) uses `fs/promises` against `getLocalWakeupsRoot()` in all 5 handlers (LIST + 4 writes). Never loopback SSH. |
| D-17 | Paired nginx blocks in BOTH nginx.conf AND nginx-https.conf | SATISFIED | Line 465 in nginx.conf; Line 479 in nginx-https.conf; byte-shape-identical block contents. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) found in the 4 new files | — | None |
| — | — | No hardcoded empty stubs in wakeups-list.ts / wakeups-write.ts | — | None |
| — | — | No streaming affordances (SSE/EventSource/res.write) — Phase 134 fleet-wide rule respected | — | None |
| — | — | No deployment commands (`docker build`, `docker compose up`, `git push`, `git pull --rebase`) in Phase 134 commit messages | — | None |
| — | — | No `.role-wakeup` (with dot) test files remaining; per-identity `.wakeup-crud` test STILL present as required | — | None |

### Human Verification Required

Automated verification found all 20 must-have truths satisfied and every D-XX decision delivered. However, the following end-to-end behaviors cannot be verified programmatically without a running container + live target host + JWT session:

#### 1. End-to-end reachability of /wakeups through nginx (HTTP + HTTPS)

**Test:** After deploying the container (`docker compose up --force-recreate`), issue `curl -sv https://skynet.<domain>/wakeups` (and the HTTP variant) with and without a JWT bearer.
**Expected:** Without JWT → 401 JSON body (not 200 with the SPA `index.html` fallthrough). With JWT → 200 with `{items: [...]}`. Confirms both nginx paired blocks route to backend port 30001 and that the JWT middleware fires. Also confirms 64kb `client_max_body_size` is in effect on the HTTPS conf.
**Why human:** Requires docker build + compose up + a valid JWT. Executor's remit stops at HEAD per D-18/D-19; the container motion is orchestrator/user-scope.

#### 2. Live CRUD round-trip against a real fleet host

**Test:** From the shape-3 modal (or curl), execute `POST /wakeups` → `GET /wakeups` → `PATCH /wakeups/:slug/toggle-enabled` → `DELETE /wakeups/:slug` against a real managed host. On the host, verify `~/fleet/wakeups/<slug>/wakeup.json` appears/disappears atomically and that `~/fleet/wakeups/.state/<slug>.fired` is cleaned up after DELETE.
**Expected:** Every response code matches the plan (201/200/200/204). Files land atomically (no `.tmp` residue). Sentinel cleanup is verified by absence of the `.fired` file after a targeted DELETE. Confirms SSH SFTP writeFile + ext_openssh_rename semantics behave as designed under real conditions.
**Why human:** Involves real SSH + real remote filesystem state + a live scheduler observer. Cannot run inside the verifier without starting services.

#### 3. Stale-tab A1 behavior (accepted risk verification)

**Test:** After deploy, open a browser tab still on the pre-Phase-128 build. Have it invoke the retired `role:list-wakeups` WS wire op (via the RoleModal Wakeups tab if the tab was open pre-deploy).
**Expected:** The server drops the message silently (no response). Client observes the Wakeups tab hanging on "loading" until refreshed. No runtime error, no data loss.
**Why human:** Reproduces the RESEARCH.md A1 accepted-risk failure mode with a real browser + real WS + real backend. Behavior needs eyes-on confirmation that it matches the accepted risk description.

### Gaps Summary

**No gaps found.** All 20 observable truths are VERIFIED by codebase evidence. All 17 D-XX decisions are SATISFIED. Both builds (backend + frontend) exit 0. All scoped tests (2134) pass. The three human-verification items above are inherent to any REST + SSH + deploy phase and were expected — they do not indicate incomplete work at HEAD.

### Notes for Orchestrator

- Phase 134 is code-complete at HEAD. The D-18/D-19 deploy motion (docker build + docker compose up --force-recreate + playwright smoke) is orchestrator/user-scope per SUMMARY.md and Phase 134 CONTEXT.md.
- The 3 Rule-3 auto-fixes documented in 134-02-SUMMARY.md (`claude-session-server.role-reads.test.ts` mop-up, `RoleModal.test.tsx` tab-count assertion, `PrettyConversationsPanel.role-management-flow.test.tsx` mocks) are all appropriate cleanup surfaced by the executor's scoped-test discipline — they extend D-13's audit surgically without adding architectural scope, consistent with Rule 3.
- Per-identity WakeupsTab.tsx byte-identical during Phase 134 (0 commits touch it) — the shape-3 modal replacement work is deferred to a future phase and does not disturb the per-identity mount.

---

_Verified: 2026-09-21T06:25:00Z_
_Verifier: Claude (gsd-verifier)_
