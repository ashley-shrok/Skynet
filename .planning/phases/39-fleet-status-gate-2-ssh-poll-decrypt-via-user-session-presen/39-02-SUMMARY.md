---
phase: 39
plan: 02
subsystem: backend/fleet-status + backend/starter
tags: [presence-lifecycle, path-c, resolve-host-by-id, decrypt-fix, phase-39-gate2, subscribe-ctx]
requirements: [GATE2-01, GATE2-02, GATE2-03, GATE2-06]
requires:
  - 39-01 (SubscriptionRegistry onFirstSubscriber/onLastUnsubscriber hooks + subscribe(sendFrame, ctx?) — commits cf2db817 / 017c5fc6 / 805ffbee)
  - 39-03 (logger.formatMessage generic context passthrough — commit b15b5c44 — so err.message on this plan's new lifecycle warns actually surfaces in console-forward.log)
provides:
  - Fleet-status SSH-poll orchestrator now starts on the FIRST browser fleet-status subscriber (registry.onFirstSubscriber) and stops on the LAST unsubscriber (registry.onLastUnsubscriber); no boot-time SSH work
  - Per-host decrypt goes through the canonical resolveHostById(id, userId) path in listIdentityHostingHosts — ssh2 now receives plaintext key/password material, fixing the "all hosts unreachable" pattern (39-CONTEXT §Root cause)
  - Frontend WS subscribe threads the JWT-verified userId as ctx into registry.subscribe so onFirstSubscriber gets the current user's userId
  - onLastUnsubscriber cleans up long-lived ssh2 Clients (hostClients.end() + hostClients.clear()) so no browser watching = no TCP:22 connections to identity-hosting boxes
  - New boot log fleet_status_awaiting_subscriber replaces the misleading eager fleet_status_orchestrator_started that used to fire at server boot regardless of subscriber presence (39-RESEARCH §Landmine 7)
affects:
  - src/backend/fleet-status/fleet-status-server.ts
  - src/backend/fleet-status/fleet-status-server.test.ts
  - src/backend/starter.ts
tech_stack:
  added: []
  patterns:
    - "Presence-driven background work (Ashley's principle 39-CONTEXT §Decisions: \"nobody needs to know if something is idle or not, or anything else that's going on here, if no user is present to want to know the information\")"
    - "Canonical decrypt-then-connect via resolveHostById(id, userId) → connectOneShot(host, timeout) — matches sessions.ts:70-75, identity-birth.ts, roles-create.ts, guacamole/routes.ts"
    - "Non-null assertion at safe control-flow gates (userId! at subscribe call site — the auth branch above returns 1008 if payload.userId is absent, so control never reaches the subscribe line with an undefined userId)"
    - "Type predicate filter for Promise.all null-elimination (`(h): h is {...} => h !== null`) — preserves the strict return type through null-drops from resolveHostById"
    - "Defence-in-depth guard (fleet_status_host_list_no_user warn + return []) even though the calling contract guarantees currentSubscriberUserId is set before listIdentityHostingHosts runs"
key_files:
  created: []
  modified:
    - src/backend/fleet-status/fleet-status-server.ts (single-line change at line 242 — subscribe call now passes `{ userId: userId! }` as ctx)
    - src/backend/fleet-status/fleet-status-server.test.ts (new Test 8b — spies on registry.subscribe and asserts the ctx arg deep-equals { userId: "test-user" })
    - src/backend/starter.ts (fleet-status IIFE block rewired — see "What Got Built" below for the diff shape)
decisions:
  - "Kept the current currentSubscriberUserId single-user model over per-user pooler instances — matches Skynet's single-tenant reality on this box, plan explicitly notes multi-user is deferred (39-CONTEXT §Deferred / §Multi-user semantics). If second concurrent subscriber connects mid-poll under different user, they'll receive existing state via snapshot; poller keeps running under the FIRST subscriber's userId until BOTH disconnect. Documented as deferred in this SUMMARY §Deferred Behaviors — Ashley to revisit if multi-user is ever exercised."
  - "listIdentityHostingHosts null-guard emits warn (fleet_status_host_list_no_user) and returns [] rather than throwing — orchestrator's start() path swallows []-returning listIdentityHostingHosts gracefully, so a soft-fail preserves fail-open semantics (matches the existing catch-and-warn pattern for DB errors on line 253-258)."
  - "Non-null assertion `userId!` at fleet-status-server.ts:242 is safe: the auth branch at line 172-179 returns 1008 if payload.userId is absent, so control only reaches line 242 with userId as a defined string. The subscribe path is inside the ws.on('message') callback registered AFTER the auth branch, so userId is bound in closure scope at that point."
  - "The three explicit host id/name/_connDetails object shape returned from listIdentityHostingHosts uses `as unknown as Record<string, unknown>` for the _connDetails cast — matches the SSHHost surface consumed by acquireSshChannel via `connDetails as Parameters<typeof connectOneShot>[0]` (line 311). Same double-cast pattern used everywhere in this file; no new type-widening."
  - "hostClients.end() + hostClients.clear() are inside onLastUnsubscriber ONLY (not inside orchestrator.stop()) — the orchestrator's stop() releases channel wrappers via releaseSshChannel (no-op here), but the raw ssh2 Clients in the hostClients Map are outside the orchestrator's ownership. Explicit close here fulfills Ashley's contract per 39-RESEARCH §Pitfall 3."
metrics:
  duration: "~27 minutes"
  completed_date: 2026-08-14
  tasks_completed: 2
  files_modified: 3
  files_created: 0
  tests_added: 1 (Test 8b — subscribe ctx spy in fleet-status-server.test.ts)
  tests_passing_targeted: "9/9 fleet-status-server (8 pre-existing + 1 new)"
  tests_passing_full_suite: "2259 pass / 6 skipped / 1 todo / 0 fail across 179 files"
---

# Phase 39 Plan 02: Presence-Driven SSH-Poll Orchestrator + resolveHostById Decrypt Path — Summary

Rewires the fleet-status SSH-poll orchestrator to Path C (Ashley LOCKED 2026-08-13, 39-CONTEXT §Decisions): the poller runs only while at least one fleet-status browser subscriber is connected, and uses that subscriber's authenticated session for per-host decrypt via the canonical `resolveHostById(hostId, userId)` path — fixing both the "always-on background work" anti-pattern AND the ciphertext-passed-to-ssh2 root-cause bug in one atomic wire-up.

## What Got Built

**Task 1 — Thread { userId } through subscribe (commits `537bf803` RED, `6a3da3e5` GREEN)**

- **`src/backend/fleet-status/fleet-status-server.ts:242`** — single-line change: the `registry.subscribe((outFrame) => { ... })` call now becomes `registry.subscribe((outFrame) => { ... }, { userId: userId! })`. The `userId` is already extracted from the verified JWT payload at line 181 and held in closure scope through the subscribe handler. Non-null assertion is safe because the auth branch (line 172-179) returns 1008 when `payload.userId` is absent, so control never reaches the subscribe line with an undefined userId.
- **`src/backend/fleet-status/fleet-status-server.test.ts`** — added Test 8b (Phase 39-02) that spies on `registry.subscribe` via `vi.spyOn(registry, "subscribe")`, drives a valid JWT + subscribe frame through the frontend WS handler, and asserts `subscribeSpy.mock.calls[0][1]` deep-equals `{ userId: "test-user" }`. Mirrors the `publishSpy` / `goneSpy` pattern already established in Tests 4 and 6.
- **RED confirmation:** committed the test first at 537bf803; ran `npx vitest run src/backend/fleet-status/fleet-status-server.test.ts` — the new test failed with `expected undefined to deeply equal { userId: 'test-user' }` (call[1] was undefined because the pre-change subscribe was single-arg).
- **GREEN confirmation:** applied the one-line source change at 6a3da3e5; re-ran the targeted suite — 9/9 pass.

**Task 2 — Presence-driven lifecycle + resolveHostById decrypt (commit `fcc254fc`)**

Rewrote the fleet-status IIFE block in `src/backend/starter.ts` (~lines 154-430 post-edit). Concrete deltas:

1. **New dynamic import** — `const { resolveHostById } = await import("./ssh/host-resolver.js");` added next to the existing dynamic imports (~line 178).
2. **New closure var** — `let currentSubscriberUserId: string | null = null;` declared immediately after the `const hostClients = new Map<string, import("ssh2").Client>();` line (~line 267). Same block scope as `listIdentityHostingHosts` so the function closes over it naturally.
3. **`listIdentityHostingHosts` rewritten** — no longer selects the encrypted `hostsTable.key / .password / .keyPassword` columns via raw drizzle. Now selects only `{ id, name }` filtered by `enableSsh = true`, then `Promise.all` maps each row through `await resolveHostById(row.id, currentSubscriberUserId)`. Null resolves are filtered out via a type predicate (`(h): h is {...} => h !== null`) so the strict return type is preserved. The returned `_connDetails` is the DECRYPTED SSHHost record — `connectOneShot` at line 311-314 consumes it via the existing `Parameters<typeof connectOneShot>[0]` cast, matching the canonical sessions.ts:70-75 pattern. Defence-in-depth guard: if `currentSubscriberUserId` is somehow null at call time (shouldn't happen — start() lives behind onFirstSubscriber), the function emits a warn with operation `fleet_status_host_list_no_user` and returns `[]`.
4. **Deleted** — the fire-and-forget `orchestrator.start().catch(...)` at old line 340-345 AND the trailing `listIdentityHostingHosts().then(...)` block that logged `fleet_status_orchestrator_started` at old line 348-357. That log was a duplicate — `orchestrator.start()` already emits `fleet_status_orchestrator_started` from inside `ssh-poll-orchestrator.ts:525` (39-RESEARCH §Landmine 7).
5. **Inserted** — `registry.onFirstSubscriber(({ userId }) => { currentSubscriberUserId = userId; systemLogger.info("...on first subscriber", { operation: "fleet_status_orchestrator_lifecycle", userId }); orchestrator.start().catch(err => systemLogger.warn("...start failed", { operation: "fleet_status_orchestrator_start_failed", error: ... })); })` — start-on-first-sub.
6. **Inserted** — `registry.onLastUnsubscriber(() => { systemLogger.info("...on last unsubscriber", { operation: "fleet_status_orchestrator_lifecycle" }); orchestrator.stop(); for (const [, client] of hostClients) { try { client.end(); } catch { /* best-effort */ } } hostClients.clear(); currentSubscriberUserId = null; })` — stop-on-last-unsub + explicit ssh2 Client cleanup (39-RESEARCH §Pitfall 3: `orchestrator.stop()` only clears `perHostState` channel wrappers; the raw ssh2 Clients in `hostClients` are outside the orchestrator's ownership).
7. **Inserted** — new boot log at the end of the fleet-status IIFE: `systemLogger.info("Fleet-status orchestrator initialized (awaiting first subscriber)", { operation: "fleet_status_awaiting_subscriber", pollIntervalMs: 2000, staleSweepIntervalMs: 30000 });`. Replaces the misleading eager-start log; makes it obvious in boot logs that the orchestrator is intentionally idle until a browser connects.

No changes to `acquireSshChannel`, `releaseSshChannel`, `createSshPollOrchestrator` construction, or the orchestrator's `deps.listIdentityHostingHosts` signature. The decrypt change lives entirely inside `listIdentityHostingHosts`; `_connDetails` now carries the decrypted SSHHost record and flows through the existing acquireSshChannel path unchanged.

## Verification Results

| Gate | Result |
|------|--------|
| `npm run build:backend` | Exit 0 (verified after each Task 1 + Task 2 edit) |
| `npm run build` (full frontend + backend) | Exit 0 |
| `npx vitest run src/backend/fleet-status/fleet-status-server.test.ts` | 9/9 pass (8 pre-existing + Test 8b new) |
| `npx vitest run` (full suite) | 2259 pass / 6 skipped / 1 todo / 0 fail across 179 test files, 969.74s (~16 min) |
| Grep gate: `registry.subscribe(` in fleet-status-server.ts | 1 call site, second arg contains `userId` (per plan acceptance line 100-101) |
| Grep gate: `{ userId: userId` in fleet-status-server.ts | 1 (>= 1 required) |
| Grep gate: subscribe spy assertion pattern in fleet-status-server.test.ts | 1 (>= 1 required) |
| Grep gate: `registry.onFirstSubscriber\|registry.onLastUnsubscriber` in starter.ts | 5 (>= 2 required) |
| Grep gate: `resolveHostById` in starter.ts | 5 (>= 2 required — import + call site + comments count) |
| Grep gate: `currentSubscriberUserId` in starter.ts | 8 (>= 4 required) |
| Grep gate: `fleet_status_awaiting_subscriber` in starter.ts | 1 (>= 1 required) |
| Grep gate: `fleet_status_orchestrator_lifecycle` in starter.ts | 2 (>= 2 required — onFirstSub log + onLastUnsub log) |
| Grep gate: `hostClients.clear\|client.end()` in starter.ts | 2 (== 2 required — the pair in onLastUnsubscriber) |
| Grep gate: `listIdentityHostingHosts().then(` in starter.ts (non-comment) | 0 (== 0 required — duplicate log block deleted per §Landmine 7) |
| Grep gate: `orchestrator.start().catch(` in starter.ts (non-comment) | 1 (== 1 required — inside onFirstSubscriber ONLY) |

## Deviations from Plan

**None** — plan executed exactly as written. Every acceptance-criterion grep gate, every behavior line item, and both verify commands returned the exact expected shape. No Rule 1/2/3 auto-fixes needed.

Minor implementation note (not a deviation, just documentation of a choice within the plan's discretion): I chose to use a TypeScript type predicate (`(h): h is {...} => h !== null`) instead of `.filter(Boolean)` for the null-drop after `Promise.all` in the rewritten `listIdentityHostingHosts`. This preserves the strict return type of the array without needing a downstream cast. `Array.prototype.filter(Boolean)` widens the type to `T[]` even when the type-guard is truthiness-based, which would have required an extra cast when passing to `createSshPollOrchestrator`. The type predicate is a small idiomatic win.

## Coordination Notes

- No parallel executor was running during this plan — 39-01 (SubscriptionRegistry hooks) and 39-03 (logger.formatMessage passthrough) both landed BEFORE this plan started, at commits `cf2db817` / `017c5fc6` / `805ffbee` (39-01) and `f269b8ca` → `b15b5c44` → `2b5c1c0a` (39-03). Verified via `git log --oneline -10` before starting.
- Zero file overlap with 39-01 (which touched `subscription-registry.ts`, `subscription-registry.test.ts`, `ssh-poll-orchestrator.test.ts`) and 39-03 (which touched `utils/logger.ts` and added `logger.test.ts`).
- Worked entirely on `feat/tab-title-from-tmux` in the main tree at `/home/ubuntu/skynet-tanya`. NO git worktrees per fleet directive #1.
- All commits carry no `--no-verify` flag per fleet directive #3. `git commit` succeeded on first try each time (no pre-commit hooks configured in this repo).

## Threat Model Compliance

The plan's threat register (T-39-04 through T-39-07 plus T-39-SC) is upheld:

- **T-39-04 (Information Disclosure — decrypted host credentials in memory):** mitigated — decrypted `SSHHost` records live in `_connDetails` for the same lifetime as every other request-driven SSH consumer in Skynet (sessions.ts, identity-birth.ts). No new persistence, no new log surface. Credentials pass through `resolved._connDetails` into `acquireSshChannel` → `connectOneShot` → ssh2 Client, matching the canonical sessions.ts:70-75 pattern verbatim.
- **T-39-05 (Elevation of Privilege — userId threading via WS ctx):** mitigated — userId is the JWT-verified `payload.userId` extracted at fleet-status-server.ts:181; not user-controlled at the subscribe path (auth happens BEFORE the subscribe frame is processed at lines 171-179). `resolveHostById` calls `SimpleDBOps.select(..., "ssh_data", userId)` which enforces per-user scope on decrypt — a subscriber cannot decrypt another user's hosts even if they spoofed the WS frame body (which they can't).
- **T-39-06 (DoS — presence-driven poller start/stop churn):** accepted — poll cadence is 2s but user tab open/close cycles are orders of magnitude slower. Re-entrancy across start/stop cycles is safe per 39-RESEARCH §Q2 analysis. `hostClients.clear()` + `client.end()` on last-unsub prevents the resource-leak scenario named in §Pitfall 3.
- **T-39-07 (Tampering — ssh2 hostVerifier: () => true):** accepted — documented Tailscale trust boundary in ssh-one-shot.ts:67, predates Phase 39, preserved verbatim.
- **T-39-SC (Supply-Chain):** mitigated — no new npm packages introduced; pure in-tree refactor.

## Deferred Behaviors (out of scope for this plan)

Documented here so that a future planner sees them and can decide whether to formalize:

- **Multi-user concurrent subscribers.** Current wiring: FIRST subscriber's userId is captured in `currentSubscriberUserId` and used for ALL decrypt calls until BOTH disconnect. If a second subscriber with a different userId connects while the first is still active, the poller continues to decrypt under the first user's session. On Skynet's single-tenant box (Ashley only) this is a non-issue. If multi-user is ever exercised, options include: (a) per-user poller instances (39-CONTEXT §Multi-user semantics alternative), (b) union-of-hosts poller keyed by each host's own owner userId (39-CONTEXT §Multi-user semantics recommendation), (c) unify decrypt subject to the host's owner userId directly (bypass currentSubscriberUserId — but this reintroduces the "system-key plumbing" concern Ashley explicitly rejected in Path C). No action taken.
- **Stop-hook install verification per host (Plan 04 territory).** The plan's `<domain>` explicitly names Plan 04's `stop-hook.sh` install verification as in-scope for Phase 39 overall — but that's a separate plan (39-04 if scheduled). This plan (39-02) does not touch remote-hook-install.ts.
- **Runtime signature verification (post-deploy).** Boot log `fleet_status_awaiting_subscriber` and per-lifecycle-event `fleet_status_orchestrator_lifecycle` info logs are added — but observing them fire in production is the orchestrator's post-deploy verification job, not this executor's. Executor scope stops at test-green per fleet directive #2.

## What Downstream Plans Consume

- Phase 39 completion criteria (all four gates GATE2-01 / GATE2-02 / GATE2-03 / GATE2-06) are materially met by this plan — the deploy step (orchestrator/tanya scope) will verify runtime behavior against the success signals in 39-CONTEXT §Specific Ideas.
- If a follow-up plan wants to add a starter.ts-level integration test (there is none today), the seams are now clean: `registry.onFirstSubscriber` / `registry.onLastUnsubscriber` are injectable via the shared `createSubscriptionRegistry()` instance, and `resolveHostById` can be mocked at the module level with `vi.mock("../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }))`.

## Threat Flags

No new security-relevant surface introduced beyond what the threat register already covers. The subscribe ctx addition passes an already-JWT-verified userId (no new trust decision at that boundary), and the decrypt-path change moves from a broken raw-drizzle read to the canonical resolveHostById wrapper — strictly reducing security surface (per-user decrypt enforcement now in place where before ciphertext was leaking to ssh2).

## Self-Check: PASSED

Files:
- FOUND: src/backend/fleet-status/fleet-status-server.ts
- FOUND: src/backend/fleet-status/fleet-status-server.test.ts
- FOUND: src/backend/starter.ts

Commits (via `git log --oneline -3`):
- FOUND: 537bf803 test(39-02): add failing test — subscribe must carry { userId } ctx
- FOUND: 6a3da3e5 feat(39-02): thread { userId } into registry.subscribe ctx
- FOUND: fcc254fc feat(39-02): presence-driven orchestrator lifecycle + resolveHostById decrypt

TDD gate compliance:
- RED gate: 537bf803 (`test:` prefix) — failing test committed first
- GREEN gate: 6a3da3e5 (`feat:` prefix) — implementation made RED pass; targeted suite 9/9
- Task 2 (`feat:` prefix at fcc254fc) — no test-first gate because the plan's Task 2 verify block did not require new tests; existing coverage (fleet-status-server, subscription-registry, ssh-poll-orchestrator, remote-hook-install) protects the rewired starter block via full-suite regression (2259/2259 pass).
