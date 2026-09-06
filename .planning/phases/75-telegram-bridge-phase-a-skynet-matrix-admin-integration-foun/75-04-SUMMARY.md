---
phase: 75-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun
plan: 04
subsystem: database/routes
tags: [matrix, identity-birth, orchestrator, retry, atomic-birth, no-rollback, sse, admin-mint]

# Dependency graph
requires:
  - phase: 75
    provides: "Plan 75-01 — matrix-admin-creds-store (getMatrixAdminCreds returning MatrixAdminCreds{homeserverBase, userId, accessToken, password} or null)"
  - phase: 75
    provides: "Plan 75-02 — matrix-admin-client (createOrUpdateUser, loginAsUser, buildRelayJsonBody exports)"
  - phase: 22
    provides: "SRIC-02 identity-birth-orchestrator Step 2.5 pre-write pattern (mirrored for D-OQ3 local-branch skip)"
  - phase: 66
    provides: "Track 1 writeAvatarSiblingFile + ext_openssh_rename atomic-overwrite discipline (leveraged verbatim for relay.json)"
provides:
  - "birthIdentity extended with Steps 6/7/8 (admin-mint + relay.json write) for remote-branch births"
  - "runRelayMintAndWrite(opts, emit, deps, conn) exported helper shared between birthIdentity and the retry route"
  - "POST /identities/birth/retry/:key admin-gated retry endpoint (Q2 partial-failure recovery surface)"
  - "BirthEvent.n union widened to 1..8; BirthDeps widened with 4 new fields (matrixCreateOrUpdateUser, matrixLoginAsUser, matrixHomeserver, buildRelayJsonBody)"
  - "503 fail-early gate at both POST / and POST /retry/:key when matrix admin foundation not ingested (T-75-28 mitigation)"
  - "chmod 600 as REQUIRED (not best-effort) post-write for relay.json (T-75-18 mitigation)"
  - "7 new test cases proving happy path 1-8 + Q2 no-rollback invariant at 3 catch surfaces + useLocal skip + retry idempotency + chmod-600 enforcement"
affects: [75-05, phase-b-telegram-bridge, agent-relay-substrate]

# Tech tracking
tech-stack:
  added: []  # zero new npm packages — Node built-in crypto.randomBytes only
  patterns:
    - "Shared-helper extraction from within an existing orchestrator so a retry endpoint can reuse the same code path (birthIdentity + POST /retry/:key both drive runRelayMintAndWrite)"
    - "Q2 no-rollback documented inline at every catch surface AND in test names — belt-and-braces (comment for reviewers who read code, test name for reviewers who grep tests)"
    - "Fail-early gate at both handlers when a runtime prerequisite is absent — returns application/json 503 BEFORE opening SSE so the frontend surfaces the operator-actionable error inline"
    - "Server-name extraction from homeserver base URL (http://x.y:8008 → x.y) so a single BirthDeps.matrixHomeserver field can drive both mxid construction and buildRelayJsonBody.homeserverBase"
    - "Post-write chmod as a required step, not best-effort — a failed chmod fails the whole write step because world-readable relay.json is a real regression"

key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.ts (+274 lines: BirthEvent union, BirthDeps interface, runRelayMintAndWrite helper, birthIdentity integration point, extractServerName, generateAgentPassword)
    - src/backend/database/routes/identity-birth.ts (+215 lines: matrix imports, 503 fail-early gates, BirthDeps wiring for 4 new deps, POST /retry/:key route)
    - src/backend/database/routes/identity-birth-orchestrator.test.ts (+464 lines: 7 Phase 75 test cases + makeDeps update for 4 new deps + Test 1 event count update)

key-decisions:
  - "D-OQ6 landed VERBATIM as documented: matrixLoginAsUser is a fourth BirthDeps field, invoked inside runRelayMintAndWrite between the createOrUpdateUser call and the buildRelayJsonBody call. NOT coupled into createOrUpdateUser (would dilute Plan 02's 'one primitive per endpoint' contract). The relay.json body carries a real (non-empty) access_token from birth-time — recv.sh does not have to relogin on first read."
  - "D-OQ7 landed VERBATIM: NO hardcoded homeserver fallback anywhere in identity-birth.ts. The 503 fail-early check at deps-assembly time is the sole path — a fresh non-ingested deployment surfaces {error: matrix_admin_foundation_not_ingested, detail: matrix admin foundation not ingested — see deploy runbook} instead of falling through to a fake homeserver. Rationale: island-model per CONTEXT.md § Philosophy."
  - "Q2 partial-tolerated + NO ROLLBACK is enforced by (a) inline code comment `Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race` at every catch surface in the orchestrator + retry route (10 occurrences), (b) test names containing the phrase `Q2 agent-supervisor race` for Tests B/B2/C/C2 (W-3 lock — grep-recoverable rationale), (c) explicit assertion helper `assertNoRmRfInExecCalls` in the tests that fails if ANY execCommand call contains rm/rm -rf."
  - "chmod 600 is REQUIRED (not best-effort) per S-1 lock. A chmod failure throws `chmod_600_failed` from Step 8, emitting step:8:failed + ended{ok:false, failedStep:8}. Test C2 pins this behavior. Rationale: world-readable relay.json exposes the agent's Matrix credentials to any other target-host user (T-75-18)."
  - "D-OQ3 local-branch skip (useLocal=true) skips Steps 6/7/8 entirely by mirroring the existing Step 2.5 pre-write skip pattern. Phase A UAT is remote fleet hosts only; local-branch self-birth remains pre-Phase-75 behavior. Test D pins this."
  - "D-OQ1 retry mount lands under /identities/birth (inherits nginx /identities coverage per RESEARCH.md § Pitfall 1 — no new location blocks required in docker/nginx.conf or docker/nginx-https.conf). Alternative mount under a new /matrix-admin/... base was rejected."
  - "extractServerName(homeserverBase) derives the mxid server-name suffix from the first-class homeserverBase URL (strips scheme + port + path). Preserves the W-1 fix: creds.homeserverBase is read directly from the column; creds.userId is never split to derive the homeserver."
  - "Existing Test 1 expected 11 events (5 steps × 2 phases + 1 ended); updated to 17 to reflect the added Steps 6/7/8. Rule 1 auto-fix — the literal event count was fragile and needed to widen alongside the orchestrator."

patterns-established:
  - "Pattern: shared-helper extraction for orchestrator + retry route — the retry endpoint imports runRelayMintAndWrite from the orchestrator module and drives it with an SSE emit callback identical to the birth handler's. Consumers do NOT re-implement Step 6/7/8 logic. Future retry surfaces (e.g. Phase B telegram-account retry) can adopt this pattern."
  - "Pattern: Q2 no-rollback lock — for any orchestration step whose failure is safer to leave as partial state than to roll back, add (a) inline code comment citing the CONTEXT.md rationale at every catch surface, (b) test name containing the anti-rollback rationale phrase, (c) explicit test assertion that no rm/rm -rf call was issued. All three together survive both code review AND casual refactors."
  - "Pattern: fail-early 503 for absent runtime prerequisites — check the prerequisite at handler entry BEFORE opening the streaming response, return application/json 503 with a stable error code + operator-actionable detail. Enables the frontend to surface the message inline rather than as a broken-stream diagnostic."

requirements-completed: [MXA-03]

# Metrics
duration: 55min
completed: 2026-09-06
---

# Phase 75 Plan 04: Birth orchestrator relay-mint extensions + retry endpoint Summary

**Landed the phase's headline behavioral change: a single `POST /identities/birth` now atomically creates the on-disk identity folder, mints the relay account through the Matrix admin API, and writes `~/.claude/identities/<name>/relay.json` with a real (non-empty) access_token — chmod'd 0600 — in one operation. Plus the Q2 partial-failure recovery surface: `POST /identities/birth/retry/:key` re-runs Steps 6/7/8 for an existing identity folder using the same shared `runRelayMintAndWrite` helper.**

## Performance

- **Duration:** ~55 minutes
- **Started:** 2026-09-06T07:10:00Z
- **Completed:** 2026-09-06T07:28:00Z
- **Tasks:** 3 completed (Task 1 orchestrator extension, Task 2 route wiring + retry endpoint, Task 3 tests)
- **Files created:** 0
- **Files modified:** 3
- **Test cases added:** 7 (all pass — total suite is now 38/38 green)
- **New npm dependencies:** 0

## Accomplishments

- **The atomic-birth completion criterion (MXA-03) now holds:** a Skynet-driven `POST /identities/birth` against a remote fleet host ends with the identity folder + relay account + relay.json all landed. No two-worlds gap between "Skynet-side identity" and "relay-side identity" anymore.
- **The relay.json body carries a real access_token at birth-time** (D-OQ6 lock): `runRelayMintAndWrite` calls `matrixLoginAsUser` between the admin-mint and the buildRelayJsonBody call, so recv.sh does not have to invoke its `relogin()` self-heal on the very first read. This is the correctness improvement over the pre-revision plan's "empty accessToken OK" story.
- **The Q2 no-rollback lock is enforced three ways** (belt-and-braces per W-3): (a) inline code comment `Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race` at every catch surface in production code (10 occurrences across orchestrator + retry route), (b) the Phase 75 test names contain the exact phrase `Q2 agent-supervisor race` for Tests B/B2/C/C2 (grep-recoverable rationale that survives casual refactors), (c) an explicit test-side `assertNoRmRfInExecCalls` helper that fails if any execCommand invocation contains rm/rm -rf/rm -r/rm -f.
- **chmod 600 is a hard step-8 requirement** (S-1): a chmod failure throws `chmod_600_failed` from Step 8, emitting `step:8:failed + ended{ok:false, failedStep:8}`. Test C2 pins this behavior. Rationale: a world-readable relay.json exposes the agent's Matrix credentials to any other target-host user (T-75-18 mitigation).
- **No hardcoded homeserver fallback** (D-OQ7 / T-75-28): both POST / and POST /retry/:key run a `getMatrixAdminCreds()` check as their first non-validation step. If it returns null, respond `503 {error: "matrix_admin_foundation_not_ingested", detail: "matrix admin foundation not ingested — see deploy runbook"}` and RETURN before opening SSE. `grep -c "thenasty.taild9b663.ts.net" src/backend/database/routes/identity-birth.ts` returns 0.
- **Retry endpoint lands with no new nginx config** (D-OQ1): `POST /identities/birth/retry/:key` mounts inside identity-birth.ts's router under the existing `/identities/birth` mount, inheriting the existing nginx `/identities` location block. Admin-gated via `createAdminMiddleware`. Validation order: 401 → 403 → 400 (bad key) → 400 (missing hostId) → 503 (missing creds) → 404 (unknown host) → SSE.

## Task Commits

Each task committed atomically per plan:

1. **Task 1 — orchestrator extension:** `2fdc66ac` (feat) — BirthEvent union + BirthDeps interface + runRelayMintAndWrite helper + birthIdentity integration + updated test's makeDeps for the 4 new deps + Test 1 event count 11→17.
2. **Task 2 — identity-birth.ts wiring + retry route:** `15f3d437` (feat) — matrix imports + 503 fail-early gate at both handlers + BirthDeps wiring for 4 new deps + POST /retry/:key route with full validation ladder.
3. **Task 3 — Phase 75 test cases:** `9b44ca18` (test) — 7 new tests (A/B/B2/C/C2/D/E) with Q2 agent-supervisor race phrase in Tests B/B2/C/C2 names.

## Widened Shapes (Output item 1)

### BirthEvent

```typescript
export type BirthEvent =
  | { type: "step"; n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; phase: "started" | "completed" | "failed"; reason?: string }
  | { type: "ended"; ok: boolean; failedStep?: number; identityId?: string; sessionName?: string };
```

Backend-only widening. Frontend BirthProgress checklist quietly ignores unknown step numbers today; the frontend widening is a Phase B concern (75-RESEARCH.md Assumption A4).

### BirthDeps (four new fields)

```typescript
export interface BirthDeps {
  // ...pre-existing fields unchanged...

  /** Phase 75 Plan 04 (D-OQ6 lock) — Matrix admin mint primitive from Plan 02. */
  matrixCreateOrUpdateUser: (
    mxid: string,
    password: string,
    displayname?: string,
  ) => Promise<
    | { ok: true; mxid: string; password: string; status: number }
    | { ok: false; status: number; error: string }
  >;

  /** Phase 75 Plan 04 (D-OQ6 lock) — Matrix admin login-as-user primitive from Plan 02. */
  matrixLoginAsUser: (
    mxid: string,
    validUntilMs?: number,
  ) => Promise<
    | { ok: true; accessToken: string }
    | { ok: false; status: number; error: string }
  >;

  /** Phase 75 Plan 04 — Matrix homeserver base URL (with scheme + port). */
  matrixHomeserver: string;

  /** Phase 75 Plan 04 — pure builder for the relay.json JSON body. */
  buildRelayJsonBody: (opts: {
    mxid: string;
    password: string;
    accessToken: string;
    homeserverBase: string;
  }) => string;
}
```

## D-OQ6 lock confirmation (Output item 2)

**matrixLoginAsUser is a fourth BirthDeps field**, wired in identity-birth.ts to Plan 02's `loginAsUser` export. It is called inside `runRelayMintAndWrite` between `matrixCreateOrUpdateUser` and `buildRelayJsonBody`:

```typescript
// runRelayMintAndWrite, Step 6 body
await runStep(6, async () => {
  agentPassword = generateAgentPassword();
  const mintResult = await deps.matrixCreateOrUpdateUser(mxid, agentPassword, opts.displayName);
  if (!mintResult.ok) throw new Error(`admin_mint_failed: ${mintResult.error} (${mintResult.status})`);
  // D-OQ6: mint a real access_token so relay.json carries it from birth-time.
  const loginResult = await deps.matrixLoginAsUser(mxid);
  if (!loginResult.ok) throw new Error(`admin_login_failed: ${loginResult.error} (${loginResult.status})`);
  mintedAccessToken = loginResult.accessToken;
});
```

matrixLoginAsUser is NOT coupled into createOrUpdateUser (would dilute Plan 02's "each primitive is one endpoint" contract). Test A asserts both `mockCreateOrUpdate` and `mockLoginAsUser` are called exactly once, with the same mxid, in that order. Test B2 asserts that a login failure attributes to step 6 and emits `ended{ok:false, failedStep:6}`.

## Test count + green status + Q2 phrase locations (Output item 3)

- **Total tests:** 38 (31 pre-existing + 7 new Phase 75 tests). All green.
- **Vitest:** `npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts` → 38/38 pass, ~13s runtime.
- **tsc:** `npx tsc --noEmit` → exit 0, clean.

**Tests carrying the "Q2 agent-supervisor race" phrase in their name (W-3 lock):**

| Test | Name | Purpose |
|------|------|---------|
| B    | "step 6 (createOrUpdateUser) failure does NOT roll back folder (Q2 agent-supervisor race)" | Anti-rollback proof for admin-mint failure |
| B2   | "step 6.5 (matrixLoginAsUser) failure does NOT roll back folder (Q2 agent-supervisor race)" | Anti-rollback proof for login failure (D-OQ6 attribution) |
| C    | "step 8 (SFTP write) failure does NOT roll back folder or Synapse account (Q2 agent-supervisor race)" | Anti-rollback proof for disk-write failure (no inverse admin-delete either) |
| C2   | "chmod 600 failure fails step 8 without rollback (Q2 agent-supervisor race)" | S-1 lock proof — chmod is REQUIRED not best-effort |

`grep -c "Q2 agent-supervisor race" src/backend/database/routes/identity-birth-orchestrator.test.ts` → 12 (4 test names × ~3 mentions each including comments).

## Retry endpoint URL + request/response shape (Output item 4)

**URL:** `POST /identities/birth/retry/:key`

**Admin gate:** `createAdminMiddleware` — verifies JWT cookie or Bearer token, blocks `pendingTOTP:true`, verifies `users.isAdmin`.

**Request body (JSON):**
```json
{ "hostId": 123 }
```

**Response — 401** (missing JWT), **403** (non-admin), **400** (bad :key or missing hostId), **503** (matrix admin foundation not ingested), **404** (host not found).

**Response — 200 SSE stream** on happy path (Content-Type: text/event-stream):
```
event: birth
data: {"type":"step","n":6,"phase":"started"}

event: birth
data: {"type":"step","n":6,"phase":"completed"}

event: birth
data: {"type":"step","n":7,"phase":"started"}

event: birth
data: {"type":"step","n":7,"phase":"completed"}

event: birth
data: {"type":"step","n":8,"phase":"started"}

event: birth
data: {"type":"step","n":8,"phase":"completed"}

event: birth
data: {"type":"ended","ok":true,"identityId":"<key>","sessionName":"<key>"}
```

**Response — failure SSE** (any step throws): `step:N:failed` + `ended{ok:false, failedStep:N}`. The success `ended{ok:true}` is emitted by the retry route itself (runRelayMintAndWrite only emits `ended` on failure via its runStep's catch).

**Idempotency:** PUT /_synapse/admin/v2/users/<uid> is idempotent (Pitfall 5 — returns 200 on update, 201 on create); writeMarkdownFileAtomic uses ext_openssh_rename for atomic overwrite. Test E pins this: calling runRelayMintAndWrite twice with the same opts succeeds both times.

## chmod 600 confirmation (Output item 5)

chmod 600 is applied as a REQUIRED post-write step inside `runStep(8)`:

```typescript
await runStep(8, async () => {
  const relayJsonPath = `$HOME/.claude/identities/${opts.name}/relay.json`;
  await deps.writeMarkdownFileAtomic(conn, relayJsonPath, relayJsonBody);
  const quotedPath = "'" + relayJsonPath.replace(/'/g, "'\\''") + "'";
  try {
    await deps.execCommand(conn, `chmod 600 ${quotedPath}`);
  } catch (chmodErr) {
    // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
    throw new Error(`chmod_600_failed: ${chmodErr instanceof Error ? chmodErr.message : String(chmodErr)}`);
  }
});
```

If chmod fails, step 8 fails loudly (Test C2). This is S-1 lock — the "DEFERRED to executor's judgment" pre-revision language is gone; chmod 600 is required to match `agent-relay/SKILL.md:105` fleet convention. The path is single-quoted for shell safety even though `opts.name` is already gated by IDENTITY_KEY_RE + TMUX_SAFE_NAME_RE upstream (defense-in-depth per T-75-16).

**Grep proof:** `grep -c "chmod 600" src/backend/database/routes/identity-birth-orchestrator.ts` returns 8 (one call site + comments explaining the S-1 lock rationale).

## No-hardcoded-homeserver confirmation (Output item 6)

`grep -c "thenasty.taild9b663.ts.net" src/backend/database/routes/identity-birth.ts` → **0**. No hardcoded fallback exists anywhere in the file. The sole homeserver source is `getMatrixAdminCreds().homeserverBase` (a first-class column on the matrix_admin_creds table per Plan 01). The 503 fail-early gates at both POST / and POST /retry/:key ensure that a null-creds condition surfaces to the operator as `matrix_admin_foundation_not_ingested` rather than proceeding against a hardcoded or fake homeserver.

T-75-28 mitigation is complete.

## Deviations from Plan

**One Rule 1 auto-fix, no Rule 2/3/4 deviations.**

**Rule 1 — Bug: existing Test 1's literal event count `expect(events.length).toBe(11)` was fragile.**

- **Found during:** Task 1, when the initial post-Task-1 test run flagged Test 1 as failing (17 events emitted vs 11 expected).
- **Issue:** Test 1 pinned the exact event count for the pre-Phase-75 5-step orchestrator. When Steps 6/7/8 were added to the remote-branch happy path, the event count grew to 17 (5 steps × 2 phases + 3 new steps × 2 phases + 1 ended).
- **Fix:** Updated the expectation to `expect(events.length).toBe(17)` with an inline comment explaining the D-OQ6 lock adds Steps 6/7/8, and widened the sequence-check loop from `n=1..5` to `n=1..8`.
- **Files modified:** `src/backend/database/routes/identity-birth-orchestrator.test.ts` (Test 1 body only).
- **Commit:** `2fdc66ac` (included with the Task 1 orchestrator extension so tests pass on every intermediate commit).

**Rule 1 — Auto-cleanup: initial phrasing of Q2 inline comments contained the literal string "rm -rf" which tripped the anti-rollback grep check.**

- **Found during:** Task 1 acceptance-criteria verification.
- **Issue:** The initial three Q2 comments I wrote used phrases like `NO rm -rf logic` and `No rm -rf in this catch` — grammatically clearer but they matched the `rm[[:space:]]+-rf` anti-rollback regex, causing the grep count to be 3 instead of 0.
- **Fix:** Rewrote the comments to say `NO folder-cleanup (rm/unlink) logic` and `NO folder-cleanup in this catch` — same meaning, doesn't false-positive the grep.
- **Files modified:** `src/backend/database/routes/identity-birth-orchestrator.ts` (three comment blocks only).
- **Commit:** `2fdc66ac` (included in the same Task 1 commit).

Auth gates: none required. All admin authentication is via existing `createAdminMiddleware`; no new auth surface was added.

## Threat model coverage

Every `mitigate` disposition in the plan's `<threat_model>` is honored in the implementation:

| Threat ID | Mitigation status |
|-----------|-------------------|
| T-75-16 (mxid tampering) | IDENTITY_KEY_RE gate at both handlers; encodeURIComponent inside Plan 02's client; shell single-quote in the chmod path even though opts.name is already gated. |
| T-75-17 (agent password logged) | `generateAgentPassword` returns a hex string held only in local scope inside runRelayMintAndWrite; never logged, never surfaced in error messages, never in databaseLogger calls. |
| T-75-18 (relay.json world-readable) | Post-write `chmod 600` as a REQUIRED step (S-1 lock). Test C2 pins that a chmod failure fails step 8. |
| T-75-19 (retry endpoint non-admin) | `createAdminMiddleware` runs before the handler body (401 missing JWT → 403 non-admin → per-user isAdmin DB check). |
| T-75-20 (retry endpoint DoS) | Accepted per plan — admin-only, no rate-limiting added. |
| T-75-21 (repudiation) | SSE emit stream logs step transitions; ended event carries `failedStep` on any failure. |
| T-75-22 (agent-supervisor race) | Q2 accepted; inline comments at 10 catch surfaces cite the CONTEXT.md rationale; test names carry the phrase. |
| T-75-28 (silent divergence via missing admin foundation) | 503 fail-early at both handlers before any SSH/Synapse call. `grep -c "thenasty.taild9b663.ts.net"` = 0. |
| T-75-SC (package legitimacy) | Zero new packages installed. |

## Threat Flags

None. No new network endpoints beyond the two documented in the threat model. No new auth path (both use existing createAdminMiddleware / createAuthMiddleware). No schema changes at trust boundaries. No new file-access patterns beyond the relay.json write (documented in T-75-18 with chmod 600 mitigation).

## Verification

- `npx tsc --noEmit` → exit 0, clean ✓
- `npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts` → 38/38 pass ✓
- `grep -c "runStep(6\|runStep(7\|runStep(8" src/backend/database/routes/identity-birth-orchestrator.ts` → 3 ✓
- `grep -c "matrixCreateOrUpdateUser" src/backend/database/routes/identity-birth-orchestrator.ts` → 4 (>=2) ✓
- `grep -c "matrixLoginAsUser" src/backend/database/routes/identity-birth-orchestrator.ts` → 4 (>=2) ✓
- `grep -c "buildRelayJsonBody" src/backend/database/routes/identity-birth-orchestrator.ts` → 6 (>=2) ✓
- `grep -c "writeMarkdownFileAtomic" src/backend/database/routes/identity-birth-orchestrator.ts` → 9 (>=2) ✓
- `grep -c "chmod 600" src/backend/database/routes/identity-birth-orchestrator.ts` → 8 (>=1) ✓
- `grep -c "export async function runRelayMintAndWrite" src/backend/database/routes/identity-birth-orchestrator.ts` → 1 ✓
- `grep -Ec 'rm[[:space:]]+-rf|execCommand[^)]*"rm[[:space:]]' src/backend/database/routes/identity-birth-orchestrator.ts` → 0 ✓ (Q2 anti-rollback: no rm calls in production code)
- `grep -c "Q2 no-rollback lock" src/backend/database/routes/identity-birth-orchestrator.ts` → 10 (>=3) ✓
- `grep -c 'router.post("/retry/:key"' src/backend/database/routes/identity-birth.ts` → 1 ✓
- `grep -c "runRelayMintAndWrite" src/backend/database/routes/identity-birth.ts` → 8 (>=1) ✓
- `grep -c "createAdminMiddleware" src/backend/database/routes/identity-birth.ts` → 3 (>=1) ✓
- `grep -c "matrix_admin_foundation_not_ingested" src/backend/database/routes/identity-birth.ts` → 3 (>=1) ✓
- `grep -c "creds.homeserverBase" src/backend/database/routes/identity-birth.ts` → 3 (>=1) ✓
- `grep -c "thenasty.taild9b663.ts.net" src/backend/database/routes/identity-birth.ts` → 0 ✓
- `grep -c "Q2 agent-supervisor race" src/backend/database/routes/identity-birth-orchestrator.test.ts` → 12 (>=3) ✓
- `grep -c "chmod 600" src/backend/database/routes/identity-birth-orchestrator.test.ts` → 7 (>=1) ✓
- `grep -Ec 'rm[[:space:]]+-rf' src/backend/database/routes/identity-birth-orchestrator.test.ts` → 5 (>=1 — the anti-rollback grep pattern is asserted in tests) ✓
- `grep -c "runRelayMintAndWrite" src/backend/database/routes/identity-birth-orchestrator.test.ts` → 7 (>=1) ✓

## Follow-ups for downstream work

- **Plan 75-05** (end-to-end integration test) can now exercise the full birth → Synapse admin PUT → login-as-user → SFTP write → chmod 600 chain against live thenasty and verify that (a) the relay.json file lands with mode 0600, (b) its access_token field is a real syt_... token (not empty), (c) recv.sh's first read succeeds without invoking `relogin()`.
- **Phase B** (Telegram bridge substrate promotion + identity-modal Telegram section) can build on top of the retry endpoint's admin-gate + SSE-envelope pattern for its own admin surfaces (e.g., "add telegram to identity" flow). The runRelayMintAndWrite shared-helper pattern is the template for any future orchestrator/retry pair.
- **Frontend Phase B** will need to widen the BirthProgress checklist union to include steps 6/7/8 so the operator sees per-step progress in the birth UI (currently: unknown step numbers are quietly ignored — a Phase B concern per 75-RESEARCH.md Assumption A4).
- **Deploy runbook** (Wave 3) MUST include the initial-ingestion step for `matrix_admin_creds` via `setMatrixAdminCreds` — otherwise POST /identities/birth returns 503 on every call.

## Self-Check: PASSED

Verified:
- `src/backend/database/routes/identity-birth-orchestrator.ts` modified (contains `runRelayMintAndWrite`, `matrixLoginAsUser`, chmod 600, Q2 no-rollback lock) ✓
- `src/backend/database/routes/identity-birth.ts` modified (contains 503 fail-early, retry route, no hardcoded homeserver) ✓
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` modified (contains 7 new Phase 75 tests with Q2 agent-supervisor race phrase) ✓
- Commits present: `2fdc66ac`, `15f3d437`, `9b44ca18` — all found in `git log` ✓
- `.planning/phases/75-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun/75-04-SUMMARY.md` exists (this file) ✓

---
*Phase: 75-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun*
*Plan: 04*
*Completed: 2026-09-06*
