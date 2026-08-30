---
phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen
verified: 2026-08-14T02:57:00Z
verifier: gsd-verifier (Claude Opus 4.7)
status: passed
verdict: PASS
score: 8/8 code-verifiable goal steps satisfied by shipped code
uat_verifications: 3 (require live browser + real container + real target host)
notes: |
  Two log op names in the goal spec (fleet_status_frontend_subscribed and
  fleet_status_frontend_disconnected) do NOT match the shipped code (which
  emits fleet_status_subscribed and fleet_status_disconnect). This is NOT a
  Phase 39 regression — those ops were shipped by Phase 34 and Phase 39 did
  not touch them. The goal spec used aspirational op names; the runtime
  signature is functionally equivalent (log messages contain the required
  human-readable text). Flagged as UAT-time signature-name calibration item.
---

# Phase 39: Fleet-status Gate 2 — Verification Report

**Phase Goal:** Fleet-status pipeline works end-to-end from a real browser session — presence-driven lifecycle, per-host resolveHostById decrypt, structured error surfacing, Stop-hook install on first acquire per host per lifecycle.
**Verified:** 2026-08-14T02:57:00Z
**Status:** PASS (all code-verifiable goal steps satisfied; 3 items deferred to UAT)
**Branch:** feat/tab-title-from-tmux at 92253b23

## Goal-Backward Trace

Goal step → satisfying plan(s) → satisfying commit(s) → code evidence in the shipped tree.

| # | Goal Step (from bounty + Ashley 2026-08-13 LOCK) | Satisfying Plan | Commit(s) | Code Evidence | Status |
| - | ------------------------------------------------ | --------------- | --------- | ------------- | ------ |
| 1 | Browser opens https://term.gigaashley.click/ → session establishes | (nginx routing) | Patch #439 (pre-Phase-39) | Out of scope for Phase 39 — Gate 1 already fixed | UAT (requires deploy) |
| 2 | Fleet-status WS connects → backend logs `fleet_status_connect` + frontend-subscribed op | 39-02 | 5ff0bb40, 105e3aae | fleet-status-server.ts:94 emits `fleet_status_connect`; :233 emits `fleet_status_subscribed` (naming diff from goal spec — see Gaps §1); :242 threads `{ userId: userId! }` as ctx into `registry.subscribe` | VERIFIED (with naming note) |
| 3 | Within ~2s, SSH-poll starts (first-subscriber trigger) → per-host `resolveHostById(hostId, userId)` decrypt succeeds → SessionState frames flow | 39-01 + 39-02 | 014b10be, c0b8b235, 105e3aae | subscription-registry.ts:213-218 exposes `onFirstSubscriber`; starter.ts:478-493 wires it to `currentSubscriberUserId = userId; orchestrator.start()`; starter.ts:308-320 rewrites `listIdentityHostingHosts` to call `resolveHostById(row.id, userId)` for every enrolled host; `_connDetails` cast at :317 passes DECRYPTED SSHHost to `connectOneShot` at :390-393 | VERIFIED |
| 4 | session-working-store populates → convlist ready-dots + WipBubble + WaitingBubble | (frontend, out of scope) | pre-Phase-39 | Phase 39 CONTEXT §Out-of-scope: "no change to session-working-store.ts / session-waiting-store.ts / PrettyConversationsPanel / WipBubble / WaitingBubble — they're correct; they just have no data." | UAT (requires live SessionState frames from step 3) |
| 5 | Close all tabs → server logs `fleet_status_frontend_disconnected` for last → poller stops (~2s) | 39-01 + 39-02 | 014b10be, 105e3aae | subscription-registry.ts:161-181 fires `lastUnsubCallbacks` on 1→0 edge; fleet-status-server.ts:250-259 emits `fleet_status_disconnect` on ws close (naming diff — see Gaps §1); starter.ts:495-521 wires `onLastUnsubscriber` to `orchestrator.stop(); hostClients cleanup; hookInstallAttempted.clear(); currentSubscriberUserId = null` | VERIFIED (with naming note) |
| 6 | No `fleet_status_host_ssh_unreachable` during poll-active window (primary regression signal) | 39-02 | 105e3aae | Root cause was ciphertext→ssh2. Fixed by canonical `resolveHostById` decrypt at starter.ts:310 which routes through `SimpleDBOps.select(..., "ssh_data", userId)` → `DataCrypto.decryptRecords`. Same wrapper used by sessions.ts, identity-birth.ts, roles-create.ts, guacamole/routes.ts. | VERIFIED (in code) — UAT confirms zero-occurrence at runtime |
| 7 | Structured `error` field visible in logs (previously swallowed by 7-field whitelist) | 39-03 | 02be759b, e39c20c6 | logger.ts:156-185 adds generic non-sensitive passthrough loop after sanitizeContext. `KNOWN_CTX_FIELDS` set at :165-173 skips the 7 known fields; every other field (including `error`, `fleetHostId`, `zodError`, `reason`, etc.) flows through as `key:value`. Sensitive-field masking is preserved (still runs via `sanitizeContext` BEFORE the loop). 7/7 logger.test.ts cases assert the invariant. | VERIFIED |
| 8 | Stop-hook installed on each enrolled host during first successful acquire per lifecycle (blind, fire-and-forget) | 39-04 | 3ab86155, 30352381, 74aa43f5 | starter.ts:43-77 exports `maybeInstallStopHook` at module scope; :418-423 invokes it inside `acquireSshChannel` FIRST-successful-new-client branch; :346 declares `hookInstallAttempted` Set inside fleet-status IIFE; :519 clears it in `onLastUnsubscriber`. Fire-and-forget confirmed: no `await deps.installStopHook` anywhere; .catch() handler at :70-76 logs `fleet_status_hook_install_failed` with `err.message` via the Plan-03-fixed logger. Structured logs `_started` / `_success` / `_failed` all present. | VERIFIED (in code) — UAT confirms real SSH-side install |

**Score: 8/8 code-verifiable steps satisfied.** Steps 1, 4, and one runtime signal in step 6 defer to UAT — as expected per verification context.

## Artifact-Level Verification

| Artifact | Level 1 exists | Level 2 substantive | Level 3 wired | Level 4 data flows | Status |
| -------- | -------------- | ------------------- | ------------- | ------------------ | ------ |
| src/backend/fleet-status/subscription-registry.ts | yes | yes — 231 lines, callback Sets + try/catch + JSDoc | yes — consumed by fleet-status-server.ts:238 and starter.ts:478,495 | yes — Test 8-14 in registry.test.ts drives real 0→1 and 1→0 transitions | VERIFIED |
| src/backend/fleet-status/fleet-status-server.ts | yes | yes — subscribe:242 passes `{ userId: userId! }` | yes — imported at starter.ts:221-223, invoked at :256 | yes — Test 8b spies subscribe and asserts ctx `{ userId: "test-user" }` | VERIFIED |
| src/backend/starter.ts | yes | yes — 632 lines, IIFE guard + module helper + wired lifecycle | yes — boot entrypoint of the backend | not directly runtime-testable (boot IIFE, guarded VITEST) — helper covered by starter.test.ts | VERIFIED |
| src/backend/utils/logger.ts | yes | yes — generic passthrough loop at :156-185 | yes — imported by every backend module (338 lines, 12 named exports) | yes — 7/7 logger.test.ts cases assert error/extra/masking/ordering/JSON/omission/truncate invariants | VERIFIED |
| src/backend/starter.test.ts | yes — created by 39-04 | yes — 5 tests, all pass | N/A (test file) | yes — 9 invocation sites of `maybeInstallStopHook` with injected mock deps | VERIFIED |
| src/backend/utils/logger.test.ts | yes — created by 39-03 | yes — 7 tests, all pass | N/A (test file) | yes — 7 invocation sites, asserts `console.warn.mock.lastCall[0]` | VERIFIED |

## Key Link Verification

| From | To | Via | Verified | Detail |
| ---- | -- | --- | -------- | ------ |
| fleet-status-server.ts:242 | subscription-registry.ts subscribe | direct call with ctx | yes | Test 8b asserts ctx = `{ userId: "test-user" }` |
| subscription-registry.ts:144-158 | starter.ts:478-493 (onFirstSubscriber) | callback fired on 0→1 edge | yes | Set-based lifecycle emitter; try/catch per-callback |
| subscription-registry.ts:166-180 | starter.ts:495-521 (onLastUnsubscriber) | callback fired on 1→0 edge | yes | Set-based lifecycle emitter; try/catch per-callback |
| starter.ts:296-310 (listIdentityHostingHosts) | ssh/host-resolver.ts resolveHostById | dynamic import at :244, called at :310 | yes | userId sourced from `currentSubscriberUserId` (set by onFirstSubscriber) |
| starter.ts:310 resolveHostById → :317 `_connDetails` | ssh-one-shot.ts connectOneShot | starter.ts:390-393 passes `_connDetails as Parameters<typeof connectOneShot>[0]` | yes | DECRYPTED SSHHost flows through — matches sessions.ts:70-75 canonical |
| starter.ts:418 maybeInstallStopHook | fleet-status/remote-hook-install.ts installStopHook | dynamic import at :249, injected as `deps.installStopHook` | yes | Fire-and-forget with .catch handler; SshChannel adapter is same reference returned to orchestrator |
| starter.ts:495-521 onLastUnsubscriber | orchestrator.stop() + hostClients.end()/.clear() + hookInstallAttempted.clear() + currentSubscriberUserId = null | direct calls in order | yes | Full cleanup — resolves RESEARCH §Pitfall 3 (orchestrator.stop() only touches perHostState, not the raw ssh2 Clients) |
| logger.ts sanitizeContext | logger.ts formatMessage generic loop | in-file call at :139, loop at :174-185 | yes | Sensitive masking preserved; generic passthrough gets already-sanitized values |

## Landmine Compliance (RESEARCH §Landmines/Watch-outs)

| # | Landmine | Disposition |
| - | -------- | ----------- |
| 1 | `pollTickCount` doesn't reset across start/stop | Informational — no code change required (refresh is safe on immediate re-start) |
| 2 | Timing of `fleet_status_subscribed` log vs orchestrator start | Compliant — two separate ops, no coupling |
| 3 | Zombie WS: disposer runs, no throw mid-poll | Verified — ws.on("close") at :250 invokes disposer; orchestrator.stop() is sync + idempotent |
| 4 | `_connDetails` typing | Verified — starter.ts:317 uses `as unknown as Record<string, unknown>` cast on DECRYPTED host record |
| 5 | releaseSshChannel is no-op — cleanup elsewhere | Verified — cleanup lives in onLastUnsubscriber at starter.ts:507-514 (iterates hostClients + client.end()) |
| 6 | stop-hook.sh + orchestrator payload path agreement | Verified — all three refs consistent: stop-hook.sh:14, orchestrator.ts:136, starter.ts:463 |
| 7 | Duplicate `fleet_status_orchestrator_started` log removed | Verified — grep on starter.ts finds zero occurrences of the op AND zero occurrences of `listIdentityHostingHosts().then(` |

All 7 landmines identified in RESEARCH.md are addressed correctly in the shipped code.

## Anti-Pattern Scan

| File | TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER count | Notes |
| ---- | ---------------------------------------- | ----- |
| src/backend/starter.ts | 0 | Clean |
| src/backend/fleet-status/subscription-registry.ts | 0 | Clean |
| src/backend/fleet-status/fleet-status-server.ts | 0 | Clean |
| src/backend/utils/logger.ts | 0 | Clean |

Zero debt markers in any Phase 39 modified file.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Backend build passes | `npm run build:backend` | exit 0 | PASS |
| Full frontend+backend build passes | `npm run build` | exit 0 (built in 7.79s) | PASS |
| All 5 Phase-39 targeted test files pass | `npx vitest run <5 files>` | 5 files / 53 tests pass in 8.34s | PASS |
| Fleet-status server subscribe passes ctx | `grep -n 'registry.subscribe' fleet-status-server.ts` | 1 call site, line 238, second arg `{ userId: userId! }` at line 242 | PASS |
| Presence hooks wired in starter | `grep -n 'onFirstSubscriber\|onLastUnsubscriber' starter.ts` | 2 wire-up call sites at :478 and :495 | PASS |
| resolveHostById used in list function | `grep -n 'resolveHostById' starter.ts` | 5 references (1 import + 1 call + 3 comments) | PASS |
| maybeInstallStopHook exported + invoked | `grep -c 'maybeInstallStopHook' starter.ts` | 2 (export + IIFE call site) | PASS |
| Logger generic passthrough shipped | `grep -n 'KNOWN_CTX_FIELDS\|Object.entries(sanitizedContext)' logger.ts` | KNOWN_CTX_FIELDS at :165; loop at :174 | PASS |

## Fleet-Rule Compliance

| Fleet Rule | Status | Evidence |
| ---------- | ------ | -------- |
| #1: No worktrees (single tree at `~/skynet-tanya` on `feat/tab-title-from-tmux`) | PASS | `git worktree list` → single entry: `/home/ubuntu/skynet-tanya  92253b23 [feat/tab-title-from-tmux]` |
| #2: Executor scope stops at test-green (no deploys in plans) | PASS | All 14 Phase-39 commits are code/test/docs only; no build push, no docker push, no restart calls in any commit |
| #3: No `--no-verify` on commits | PASS | `git log` grep on last 30 commits: zero matches for no-verify pattern |
| #4: `npm run build:backend && npm run build` used at plan boundaries | PASS | Verified live in this verification: both exit 0. All 4 SUMMARY files claim these gates green. |
| #5: `npx vitest run` full-suite green | PASS | Per user-supplied context: 2264 pass / 0 fail full suite. Targeted re-run of 5 Phase-39 files: 53/53 pass. |
| Commit format (`test:` / `feat:` / `docs:` prefixes) | PASS | 4 `test:` RED gates + 4 `feat:` GREEN gates + 1 `test:` coverage-only + 4 `docs:` completion commits + 1 `docs:` plan-check |

## Gaps

**None (code-verifiable).**

### Minor semantic note (NOT a blocker)

The goal spec uses log op names `fleet_status_frontend_subscribed` and `fleet_status_frontend_disconnected`, but the shipped code emits `fleet_status_subscribed` and `fleet_status_disconnect`. Both ops exist and fire on the required transitions — the semantic behavior is identical. The naming difference:

- Pre-dates Phase 39: these ops were shipped by Phase 34 and were not touched by Phase 39.
- Is not called out in any Phase-39 plan or SUMMARY.
- Does not affect functionality — a UAT grep against `console-forward.log` looking for `fleet_status_subscribed` (or the human-readable message "Fleet-status frontend subscribed") will find the events on subscribe.

If Ashley wants the goal-spec names honored verbatim, that's a trivial follow-up rename (2 lines in fleet-status-server.ts) — but it's not a Gate 2 regression, so it does NOT block this verification.

## UAT-Time Verifications (require deploy)

Not verifiable from static code alone — must be exercised against a running container + real browser + real target host:

### UAT-1: Browser-driven end-to-end signal chain

- **Test:** Open browser to `https://term.gigaashley.click/`, wait 5 seconds.
- **Expected in `console-forward.log`:**
  1. `fleet_status_connect` on the WS upgrade for `/fleet-status/ws`
  2. `fleet_status_subscribed` (goal spec name: `fleet_status_frontend_subscribed`) with the JWT userId in `user:...`
  3. `fleet_status_orchestrator_lifecycle` info log with `userId:<id>` — proves onFirstSubscriber fired
  4. `fleet_status_orchestrator_started` info log — proves orchestrator.start() reached its post-init branch
  5. Per enrolled host: `fleet_status_poll_start` → EITHER a session_state publish frame OR (fail-open) `fleet_status_hook_payload_missing`
  6. Per enrolled host on first tick: `fleet_status_hook_install_started` → `fleet_status_hook_install_success` (or `_failed` with `error:...` on hosts that reject the install)
- **Why human:** requires live browser + running container + real user JWT + real hosts.

### UAT-2: Zero `fleet_status_host_ssh_unreachable` during poll-active window

- **Test:** With browser tab open + `docker logs skynet | grep fleet_status_host_ssh_unreachable | wc -l` over a 60-second window.
- **Expected:** 0 occurrences (was: 2× every 60s per host = 20 per minute before the fix).
- **Why human:** primary regression signal; requires deploy + real SSH-enabled hosts with encrypted PEM keys in the DB.

### UAT-3: Stop-hook install verification against a real target host

- **Test:** After a fresh fleet-status lifecycle, SSH to any enrolled host and check for `~/.claude/hooks/skynet-fleet-status-stop.sh` and the Stop-hook entry in `~/.claude/settings.json`.
- **Expected:** Both artifacts present; second lifecycle iteration is a no-op (readAndMergeStopHookSettings.alreadyInstalled short-circuit).
- **Why human:** requires live SSH access to the enrolled hosts, not exercisable from vitest.

### UAT-4: Log op name calibration (optional)

- **Test:** Cross-reference the log op names in `console-forward.log` against the goal spec expectations.
- **Expected:** If exact naming matters, `fleet_status_subscribed` needs to become `fleet_status_frontend_subscribed` and `fleet_status_disconnect` needs `_frontend_disconnected`. Otherwise, dismiss as spec-vs-code naming drift with no functional impact.
- **Why human:** decision call by Ashley whether the op names should match the goal spec verbatim or the existing Phase-34 shape stands.

## Verdict

**PASS.**

Every code-verifiable step of the phase goal is satisfied by shipped code that has been individually opened and read during this verification (not just SUMMARY-trusted):

- Subscription-registry presence hooks (39-01) — read at subscription-registry.ts:213-225.
- Presence-driven orchestrator lifecycle + resolveHostById decrypt (39-02) — read at starter.ts:296-521, fleet-status-server.ts:242.
- Logger generic passthrough (39-03) — read at logger.ts:156-185.
- Fire-and-forget blind Stop-hook install per host per lifecycle (39-04) — read at starter.ts:43-77 (helper) + :418-423 (call site) + :346 (Set decl) + :519 (Set clear).

All 7 landmines from RESEARCH.md are addressed correctly. Zero debt markers in modified files. Both build gates green (verified live in this verification, not just trusted from SUMMARY claims). Targeted 53-test Phase-39 suite green (verified live). Fleet rules (#1-#5 plus commit format) all upheld.

The 3 UAT-time items are expected — they can only be exercised against a running container + real browser + real target host, and are called out per verification-context instructions.

The one minor semantic difference (log op names `fleet_status_frontend_subscribed` vs shipped `fleet_status_subscribed`) is a pre-Phase-39 naming that Phase 39 did not touch, functionally equivalent, and does NOT gate the phase — flagged as an optional UAT-time calibration decision.

Ready for orchestrator to proceed with deploy + runtime UAT.

---

*Phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen*
*Verified: 2026-08-14T02:57:00Z*
*Verifier: gsd-verifier (Claude Opus 4.7)*
