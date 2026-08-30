---
phase: 62-invisible-dormancy-client-side-follow-up
plan: 02
subsystem: backend-observability
tags: [instrumentation, diagnostics, sshLogger, phase62, wave2, dedup-map, tail-lifecycle, no-behavior-change]
requires:
  - crypto.randomBytes (already available — extended existing `import { createHash } from "node:crypto"` to also import `randomBytes`)
  - existing sshLogger.info + console-forward log pipeline (D-62-04)
  - startActiveSessionFlow closure (~L6221) + transitionToActiveNew closure (~L4217) + teardownPane closure (~L3527) + dormant→wake handoff site (~L7208)
  - closure-scoped tailHandle + queueEnqueueDedup + sessionIdFromFile
provides:
  - per-tail-watcher instance ID (crypto.randomBytes(4).toString("hex") — 8-char lowercase hex) regenerated at every tail-start site, closure-scoped
  - `[dedup] tail=<id> sessionId=<sid> contentHash=<no-hash> rawType=<t> operation=<op> action=<populate|suppress|passthrough> mapSize=<n>` — one sshLogger.info line per __applyQueueDedupForTests call outcome (only for kind:"message" role:"user" frames — the population the helper actually operates on)
  - `[frame-emit] tail=<id> eventId=<eid> role=<r> contentLen=<n> contentPreview=<first-50-collapsed>` — one sshLogger.info line per user-role ws.send passthrough (inside the try, after ws.send did not throw)
  - `[tail-lifecycle] tail=<id> action=<start|stop> sessionFile=<path> reason=<initial|transition|dormant-handoff|connection-teardown>` — four legitimate lifecycle boundaries; the `connection-teardown` reason value is ADDITIVE beyond the D-62-04 spec (initial|transition|dormant-handoff) and covers teardownPane's ws.on("close") + mid-life pane-switch path — documented as intentional additive per plan Task 1 STEP D-2
  - optional `startReason?: "initial" | "dormant-handoff" | "transition"` parameter on startActiveSessionFlow (forward decl + impl signature updated), defaults to "initial" when omitted; dormant-handoff caller at ~L7208 passes "dormant-handoff"
  - additive `tailInstanceId` metadata key on the existing "Starting Claude session tail" sshLogger.info line (no removals, no key renames on any existing log)
affects:
  - `src/backend/claude-session/claude-session-server.ts` — only file touched
tech-stack:
  added:
    - `randomBytes` import from `node:crypto` (added to existing `createHash` import; no new dependency)
  patterns:
    - closure-scoped per-connection state slot (matches existing `tailHandle`, `queueEnqueueDedup`, `pendingMqidsForThisConnection` conventions)
    - additive sshLogger.info emission adjacent to existing lifecycle logs (matches Phase 60 diagnostic instrumentation pattern; D-62-04)
    - single-line grep-safe log shape (newlines collapsed to single spaces in contentPreview)
key-files:
  created: []
  modified:
    - src/backend/claude-session/claude-session-server.ts (+164 lines, -3 lines; two commits — b698fc5c Task 1 + e7d7273a Task 2)
decisions:
  - W-1 (executor): __applyQueueDedupForTests return-type NOT extended with contentHash. Simpler path — hardcoded "<no-hash>" sentinel in the [dedup] log line. Rationale: keeps the helper's public contract untouched (D-62-01 — no changes to dedup internals), avoids any risk to the 24 __applyQueueDedupForTests call sites in claude-session-server.queue-dedup.test.ts (which destructure only `.suppress` and `.dedupMap`), and the rawType/operation/action/mapSize triple + the paired [frame-emit] line's eventId + contentPreview are enough to correlate frames across log lines without a hash. Cost: post-repro log analysis correlates on eventId + contentPreview instead of contentHash — negligible for the diagnostic use case Ashley described.
  - Additive fourth `reason` value "connection-teardown" (beyond D-62-04's initial|transition|dormant-handoff spec) at teardownPane's tailHandle stop block. Rationale: teardownPane fires on ws.on("close") (final teardown) AND on mid-life pane-switch — both are legitimate lifecycle boundaries and worth logging. Guarded by `if (tailInstanceId)` to avoid spurious stop for a tail that never started, and resets tailInstanceId = "" after emit so a redundant teardown call doesn't re-log a stale ID. Explicitly called out here per plan Task 1 STEP D-2 instruction.
  - Fleet-directive override on Task 3: Task 3's plan action was `npx vitest run` (full suite) per D-62-05. The orchestrator's `<sequential_execution>` block overrides this with "Test discipline (fleet rule 2026-08-20): Run scoped tests only... Full suite runs at the orchestrator ship-gate — NOT at executor exit." Executor ran 6 scoped test files (all target files listed in success_criteria + queue-dedup.test.ts as extra safety) — 97 tests passed, 1 skipped. Full-suite vitest run deferred to the orchestrator's ship-gate per fleet rule.
metrics:
  duration_hours: 0.4
  completed_date: 2026-08-30
---

# Phase 62 Plan 02: Wave 2 — dedup + emission-path diagnostic instrumentation Summary

Added per-tail-watcher instance ID + three sshLogger.info emission sites (`[dedup]`, `[frame-emit]`, `[tail-lifecycle]`) around the `queueEnqueueDedup` Map + `__applyQueueDedupForTests` call path in `src/backend/claude-session/claude-session-server.ts`, with zero behavior change (D-62-01 hard-lock enforced — all internal dedup logic, key derivation, TTL, and `Map.clear()` semantics untouched). Sets up Phase 63 to identify (or rule out) a dedup-Map leak mechanism from Ashley's next dormant-send repro.

## What was built

Three log-point sites and one instance-id generation pattern:

1. **`[dedup]` emission at `__applyQueueDedupForTests` call site (~L3949-3999 post-edit)** — fires once per helper call outcome for `kind:"message" role:"user"` frames. Records:
   - `tail=<8-char-hex>` — the closure's current tail-watcher instance ID
   - `sessionId=<sid>` — from closure `sessionIdFromFile`, or `<no-session>` fallback
   - `contentHash=<no-hash>` — sentinel per W-1 decision (helper return-type not extended)
   - `rawType=<t>` — from `rawObj.type`, or `<no-type>` fallback
   - `operation=<op>` — from `rawObj.operation`, or `<no-op>` fallback (stored under metadata key `dedupOperation` in the structured payload to avoid clobbering the outer `operation` key which identifies the log emission itself)
   - `action=<populate|suppress|passthrough>` — derived at the call site: `suppress===true` → "suppress"; else if `rawType==="queue-operation" && operation==="enqueue"` → "populate"; else "passthrough"
   - `mapSize=<n>` — `queueEnqueueDedup.size` read at emission time

2. **`[frame-emit]` emission at ws.send passthrough site (~L4021-4034 post-edit)** — fires once per user-role frame that passes the dedup gate AND ws.send did not throw. Placed INSIDE the try block, AFTER ws.send, so failures to reach the wire don't emit a spurious log. Records:
   - `tail=<id>`, `eventId=<eid>`, `role=<r>`, `contentLen=<n>`
   - `contentPreview=<first-50-chars-with-\r?\n-collapsed-to-single-spaces>` — grep-safe, single-line

3. **`[tail-lifecycle]` emissions at all four tail-boundary sites**:
   - `action=start reason=initial` — added AFTER the existing `"Starting Claude session tail"` sshLogger.info in startActiveSessionFlow (~L6284). Also handles `reason=dormant-handoff` when the dormant→wake caller at ~L7208 passes `startReason: "dormant-handoff"`.
   - `action=start reason=transition` — added AFTER the tailHandle reassign in transitionToActiveNew (~L4324).
   - `action=stop reason=dormant-handoff` — added AFTER the existing `"Dormant tail stopped for wake handoff"` log at ~L7190. Old ID stays visible here; new ID visible in the paired start log at ~L6284 (via `startReason: "dormant-handoff"`) — that's the exact tail-swap trace the diagnostic needs.
   - `action=stop reason=connection-teardown` — added AFTER the teardownPane tailHandle stop block at ~L3527. Additive fourth reason value beyond D-62-04's initial|transition|dormant-handoff spec (documented decision above). Guarded by `if (tailInstanceId)` + resets tailInstanceId = "" after emit.

**Per-tail-watcher instance ID generation:**
- `let tailInstanceId: string = "";` declared adjacent to `let tailHandle` (~L3133) — closure-scoped, never persisted beyond ws close.
- `tailInstanceId = randomBytes(4).toString("hex")` at BOTH tail-start sites (startActiveSessionFlow ~L6284 + transitionToActiveNew ~L4324). Greppable count: 2 as expected.
- `randomBytes` added alongside existing `createHash` in the top-of-file `import { createHash } from "node:crypto"` line (no new dependency).

## Behavior-neutrality proof (D-62-01 enforcement)

Every acceptance-criterion grep-gate passed:

| Assertion | Command | Result |
| --- | --- | --- |
| crypto import present | `grep -qE '(from "node:crypto"\|from "crypto")'` | OK |
| randomBytes referenced | `grep -q 'randomBytes'` | OK |
| tailInstanceId `let` declared exactly once | `grep -c '^\s*let tailInstanceId'` | 1 |
| randomBytes(4).toString("hex") reassignments at start sites | `grep -c 'tailInstanceId = randomBytes(4).toString("hex")'` | 2 |
| `[tail-lifecycle] ... action=start` present | `grep -q` | OK |
| `[tail-lifecycle] ... action=stop` present | `grep -q` | OK |
| `startReason: "dormant-handoff"` wired at dormant caller | `grep -q` | OK |
| `[dedup] ... tail=${tailInstanceId}` present | `grep -q` | OK |
| `[frame-emit] ... tail=${tailInstanceId}` present | `grep -q` | OK |
| `"claude_session_dedup_gate"` operation key | `grep -q` | OK |
| `"claude_session_frame_emit"` operation key | `grep -q` | OK |
| **`queueEnqueueDedup.clear()` call count UNCHANGED** | `grep -c 'queueEnqueueDedup.clear()'` | **1** (matches pre-Phase-62 baseline) |
| **`queueEnqueueDedup` Map declaration UNCHANGED** | `grep -q 'const queueEnqueueDedup = new Map<string, number>()'` | **OK** |

Build gates:
- `npm run build:backend` exit 0
- `npm run build` (frontend + backend + assets) exit 0 (built in 52.75s)

Scoped test files (all 4 target files + queue-dedup helper test + optimistic-bubbles integration = 6 files, 97 tests):

```
npx vitest run \
  src/backend/claude-session/claude-session-server.compose-send.test.ts \
  src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts \
  src/backend/claude-session/claude-session-server.dormant-tail.test.ts \
  src/backend/claude-session/dormant-poll.test.ts \
  src/backend/claude-session/pv-send-watchdog.test.ts \
  src/backend/claude-session/claude-session-server.queue-dedup.test.ts
→ Test Files  6 passed (6)
→ Tests      97 passed | 1 skipped (98)
→ Duration   81.44s
```

The `queue-dedup` test file was included as an extra safety check — it has 24 direct call sites of `__applyQueueDedupForTests` and would immediately catch any return-type or destructure-shape drift. All 24 sites still work with the untouched `{ suppress: boolean; dedupMap: Map<string, number> }` return shape (W-1 decision).

## What the next dormant-send repro from Ashley will produce

For a single dormant-send that emits one user-role frame from a queue-op enqueue:

```
[tail-lifecycle] tail=abc12345 action=start sessionFile=/path/e59b2000-...jsonl reason=initial
... (dormant marker frames) ...
[tail-lifecycle] tail=abc12345 action=stop sessionFile=/path/e59b2000-...jsonl reason=dormant-handoff
[tail-lifecycle] tail=def67890 action=start sessionFile=/path/e59b2000-...jsonl reason=dormant-handoff
[dedup] tail=def67890 sessionId=e59b2000-... contentHash=<no-hash> rawType=queue-operation operation=enqueue action=populate mapSize=1
[frame-emit] tail=def67890 eventId=<eid1> role=user contentLen=15 contentPreview=testing 1 2 3
```

If duplicate bubble mechanism IS a dedup miss, the log will show either a second `action=passthrough` [dedup] on the same content (Map got cleared or key derivation missed) OR a second `action=populate` (both enqueue+user paths executed). If duplicate mechanism is NOT dedup-related (e.g., the frontend receives the frame twice on the WS), the log will show exactly one [frame-emit] line per user-role emission and Phase 63 knows to look elsewhere.

The tail-instance-id transitions in `[tail-lifecycle]` lines make cross-tail races (start-old / stop-old / start-new emitting overlapping frames) trivially identifiable — the ID in each [dedup]/[frame-emit] line pins the frame to the exact tail-watcher instance that produced it.

## Deviations from Plan

### Auto-fixed Issues

None — the plan was executed as written for Tasks 1 and 2.

### Documented deviations

**1. [Rule 3 - Fleet directive override] Task 3 ran scoped tests only, not full `npx vitest run`**
- **Found during:** Task 3 pre-run
- **Issue:** Plan Task 3 acceptance criterion is `npx vitest run` exit 0 (full suite). The orchestrator's `<sequential_execution>` block (this executor's spawn prompt) supersedes it with fleet rule 2026-08-20: "Run scoped tests only… Full suite runs at the orchestrator ship-gate — NOT at executor exit."
- **Fix:** Ran the 6 scoped test files listed in success_criteria plus the queue-dedup helper test as an extra safety net. All 97 tests passed. Full-suite deferred to the orchestrator's ship-gate.
- **Files modified:** none (verification-only task, no code change committed)
- **Commit:** N/A (no code change)

**2. [W-1 planner allowance] Skipped return-type extension on __applyQueueDedupForTests**
- **Found during:** Task 2 STEP A read of the helper
- **Choice:** Path B — keep the helper's return type as-is (`{ suppress: boolean; dedupMap: Map<string, number> }`) and hardcode `contentHash=<no-hash>` in the `[dedup]` log line.
- **Rationale:** D-62-01 hard-locks the helper's internals; extending its return shape is at the edge of that lock even though 24 test call sites happen to only destructure `.suppress`. Simpler + zero risk. The rawType/operation/action/mapSize + [frame-emit] eventId/contentPreview correlation is sufficient for the diagnostic goal.
- **Files modified:** src/backend/claude-session/claude-session-server.ts (only the log line — no helper change)
- **Commit:** e7d7273a (Task 2)

## Auth gates encountered

None.

## Known Stubs

None. The `contentHash=<no-hash>` sentinel is documented above under W-1 decision — it is an intentional trade-off (skip helper return-type extension), NOT a placeholder awaiting future wiring. Phase 63 uses the [dedup]+[frame-emit] correlation, not the hash.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| Task 1 | `b698fc5c` | feat(62-02): Task 1 — per-tail-watcher instance ID + [tail-lifecycle] logs |
| Task 2 | `e7d7273a` | feat(62-02): Task 2 — [dedup] + [frame-emit] instrumentation at dedup call site |
| Task 3 | (no commit) | Verification-only; fleet-directive scoped-tests-only per deviation #1 |

## Ship-boundary posture (per D-62-05)

HEAD `e7d7273a` is LOCAL on `feat/tab-title-from-tmux`. NOT pushed, NOT docker-built, NOT deployed. Wave 2 bundles with Wave 1 (Plan 62-01, HEAD `b98f81f1`) in ONE docker build/deploy on Ashley's greenlight per D-62-05. Fleet directive from spawn prompt: "DO NOT `git push`, DO NOT `docker build`, DO NOT `docker compose up`. This is a 'not shipping until done' bundle — the orchestrator (taylor) ships after all Phase 62 waves + full-suite green + ship greenlight from Ashley."

## Self-Check: PASSED

- File `.planning/phases/62-invisible-dormancy-client-side-follow-up-widen-client-pendin/62-02-SUMMARY.md` — will exist after Write.
- Commit `b698fc5c` (Task 1) — exists in git log (verified via `git log --oneline`).
- Commit `e7d7273a` (Task 2) — exists in git log (verified via `git log --oneline`).
- File `src/backend/claude-session/claude-session-server.ts` — exists and contains all expected greppable markers ([dedup] tail=, [frame-emit] tail=, [tail-lifecycle] tail=, tailInstanceId declared as let exactly once, `queueEnqueueDedup.clear()` count = 1).
