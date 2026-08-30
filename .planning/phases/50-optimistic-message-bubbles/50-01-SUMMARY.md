---
phase: 50-optimistic-message-bubbles
plan: 01
subsystem: backend/session-file-parser
tags: [claude-session, jsonl, queue-operation, dedup, sha256, websocket, pretty-view]

# Dependency graph
requires:
  - phase: 44-fix-convo-list-recency-signal
    provides: baseline claude-session backend (parseSessionLine, tail-watcher, WS emit path)
provides:
  - kind:"message" role:"user" emission for normal-content type:"queue-operation" + operation:"enqueue" JSONL entries (D-09)
  - deterministic eventId derivation (sha256(sessionId + timestamp + content).slice(0,32)) for queue-operation-derived frames (D-10)
  - per-session queue-enqueue dedup Map (contentHash-only key, 10-minute wall-clock TTL, 100-entry cap, single-shot suppress) that collapses the empirically-observed enqueue → dequeue double-write (D-11)
  - __applyQueueDedupForTests seam mirroring the __applyInputMessageForTests convention
  - sessionIdFromFile threaded through both parseSessionLine call sites (streaming tail + handleFetchOlderRange)
affects:
  - 50-02 (send-path watchdog — will key its arm-time + notifyMatched contentHash derivation off the SAME sha256(content).slice(0,32) derivation this plan uses)
  - 50-03 (frontend optimistic-bubble state machine — will consume the new kind:"message" frames on the wire; per-eventId dedup Set in that plan collapses re-play of the same enqueue line via the deterministic eventId this plan produces)
  - 50-04 (end-to-end integration tests — test helper must use the SAME sha256(content).slice(0,32) contentHash derivation)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies (uses node's built-in crypto)
  patterns:
    - "Two-hash contract cross-referenced in inline comments — eventId (line-scoped, includes sessionId+timestamp) is DISTINCT from contentHash (content-only, spans enqueue → dequeue) to serve two distinct dedup purposes"
    - "Optional sessionId argument on parseSessionLine — backward-compatible via fallback for the queue-operation branch only"
    - "Test seam mirrors __applyInputMessageForTests convention — pure function with injectable Map + now for hermetic timing tests"
    - "Lazy TTL pruning with monotonic-order early-exit — walks Map from head, breaks at first non-expired entry"
    - "Oldest-first eviction leveraging Map insertion-order preservation in JS — no separate LRU list needed"

key-files:
  created:
    - src/backend/claude-session/claude-session-server.queue-dedup.test.ts
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/session-file-parser.test.ts
    - src/backend/claude-session/claude-session-server.ts

key-decisions:
  - "eventId (frontend line-scoped dedup Set key) = sha256(`${sessionId}\\n${timestamp}\\n${content}`).slice(0, 32) — includes sessionId+timestamp because it must collapse re-play of the SAME line"
  - "contentHash (backend dedup Map key + Plan 50-02 watchdog key + Plan 50-04 test helper) = sha256(content).slice(0, 32) — content-only, so the ~T+0 enqueue entry matches the ~T+2min dequeue entry"
  - "Dedup Map key is content-only; per-session scope comes from the Map living on the per-connection tail-watcher closure (not from the key)"
  - "10-minute wall-clock TTL (D-11 Discretion) with lazy prune on insert; 100-entry cap with oldest-first eviction; single-shot dedup deletes the matched entry on suppress"
  - "handleFetchOlderRange gets sessionIdFromFile via optional deps.sessionIdFromFile — dedup is NOT applied on the range-fetch path (historical replay; frontend per-eventId Set handles collapse)"
  - "Patch #66 task-notification handler (claude-session-server.ts L2582-2623) left byte-for-byte unchanged — the new normal-content enqueue path is strictly additive"

patterns-established:
  - "Two-hash contract for cross-plan hash-derivation consistency — cross-referenced in inline block comments in both parser branch and seam body"
  - "Per-connection state dedup Maps hang off the tail-watcher closure and are destroyed with the WS lifecycle (no new global cache) — mirrors backgroundedAgents/backgroundedShells/pendingPlans pattern"
  - "Fresh JSON.parse inside onLine for rawObj inspection when the shared reshape helper can't be widened — matches the existing parallel raw-line scan for backgrounded Agent invocations at ~L2483"

requirements-completed: []  # Phase 50 has no formal REQ-ID mapping per 50-CONTEXT.md; coverage is against D-09/D-10/D-11 decisions

# Metrics
duration: ~40min
completed: 2026-08-20
---

# Phase 50 Plan 01: Backend queue-operation enqueue emission + per-session dedup Summary

**parseSessionLine emits kind:"message" for normal-content queue-operation enqueue entries with a deterministic (sessionId, timestamp, content) eventId, and a per-session contentHash-only dedup Map on the tail-watcher closure suppresses the ~2-minute-later dequeue-time double-write.**

## Performance

- **Duration:** ~40 minutes (including dependency install for a fresh node_modules)
- **Started:** 2026-08-20T13:51:52Z (per STATE.md)
- **Completed:** 2026-08-20T14:50Z
- **Tasks:** 2 (each committed as TDD RED + GREEN pair)
- **Files modified:** 3 (session-file-parser.ts, session-file-parser.test.ts, claude-session-server.ts)
- **Files created:** 1 (claude-session-server.queue-dedup.test.ts)

## Accomplishments

- The Claude Code harness's queued-message path (busy-turn shape — writes a `type:"queue-operation", operation:"enqueue"` entry ~111ms after send instead of a normal user turn) is now a first-class signal that renders as a chat bubble at enqueue time. Previously silently ignored; now surfaces as a `kind:"message"` frame identical in wire shape to a normal user turn.
- The empirically-observed enqueue → dequeue double-write (up to ~2 minutes between the enqueue entry and the eventual normal user turn per 50-CONTEXT.md § Empirical evidence) is deduped at the backend before the second WS frame is emitted — no double bubbles, no per-eventId frontend dance.
- Established the two-hash contract that Plans 50-02, 50-03, and 50-04 depend on: eventId (line-scoped, includes sessionId+timestamp) is DISTINCT from contentHash (content-only, spans enqueue → dequeue). Both derivations cross-referenced in inline comments to prevent future conflation.
- Zero new dependencies (uses node's built-in `crypto`). Patch #66 task-notification completion-detection handler untouched.
- 17 new tests (9 in session-file-parser.test.ts + 8 in the new queue-dedup.test.ts), all green. Full backend claude-session suite: 449/449 tests pass. Full-repo vitest: 2670 passed | 9 skipped | 1 todo, exit 0.

## Task Commits

Each task was committed atomically with TDD RED then GREEN:

1. **Task 1 RED: failing parser tests** — `5342a350` (test)
2. **Task 1 GREEN: parseSessionLine queue-operation branch** — `ed541d0f` (feat)
3. **Task 2 RED: failing __applyQueueDedupForTests tests** — `bb2a3243` (test)
4. **Task 2 GREEN: per-session dedup + sessionId wire-through** — `44fcaa63` (feat)

Plan metadata commit follows this SUMMARY (final commit — includes SUMMARY.md + STATE.md + ROADMAP.md).

## Files Created/Modified

- `src/backend/claude-session/session-file-parser.ts` — added `createHash` import; parseSessionLine signature widened with optional `sessionId?: string`; new queue-operation enqueue branch (~L718-802) inserted between the attachment/queued_command branch and the isUser/isAssistant gate. New branch emits `kind:"message"` role:"user" with deterministic eventId when `type === "queue-operation"` AND `operation === "enqueue"` AND content is a non-empty, non-wrapper string.
- `src/backend/claude-session/session-file-parser.test.ts` — appended new `describe` block covering 9 scenarios (QO-1 through QO-7): positive normal-content emission, deterministic eventId with sessionId variation, task-notification/system-reminder skip, non-enqueue-operation skip, timestamp derivation (parsed / missing / unparseable), empty-content and whitespace-only skip, sessionId-omitted back-compat.
- `src/backend/claude-session/claude-session-server.ts` — added `queueEnqueueDedup = new Map<string, number>()` on the per-connection tail-watcher closure (~L2332); added `__QUEUE_DEDUP_TTL_MS`, `__QUEUE_DEDUP_CAP`, `pruneExpiredQueueDedupEntries`, `enforceQueueDedupCap`, `isWrapperContent`, and exported `__applyQueueDedupForTests` seam (~L1523-1710); wired the seam into onLine before ws.send with a fresh JSON.parse for rawObj (~L2988-3037); threaded `sessionIdFromFile` through both parseSessionLine call sites (streaming tail + handleFetchOlderRange); handleFetchOlderRange deps widened with optional `sessionIdFromFile?: string | null`; caller at ~L4926 updated to pass it.
- `src/backend/claude-session/claude-session-server.queue-dedup.test.ts` — new test file (per plan directive that the seam belongs to claude-session-server, not the parser). 8 scenarios: cross-2-minute-span dedup, different-content non-dedup, cross-Map isolation, 10-minute TTL expiry, 100-entry cap with oldest-first eviction, task-notification unaffected, lazy TTL prune on next insert, assistant frames pass through.

## Decisions Made

- **contentHash derivation is content-only (no sessionId, no timestamp).** The empirically-observed enqueue → dequeue span is ~2 minutes; any timestamp-inclusive key would fail to match. Per-session scope comes from the Map living on the per-connection closure — not from the key. This revises the earlier ±2-second-bucket sketch that appeared in 50-CONTEXT.md D-11.
- **eventId derivation is line-scoped (sessionId + timestamp + content).** The frontend's per-eventId dedup Set (Plan 50-03) keys on eventId to collapse re-play of the same enqueue line on WS reconnect / tail-replay. Line-scoped identity is what that Set needs.
- **handleFetchOlderRange does NOT apply dedup.** Range-fetch is historical replay of already-emitted history; enqueue → dequeue pairs were already collapsed live when they first streamed. The frontend per-eventId Set (Plan 50-03) handles collapse of any straggler that reaches the client twice.
- **The seam applies dedup to user-role message frames only.** Assistant turns, images, relay frames, and skip/malformed all pass through unchanged. Task-notification and system-reminder wrapped content is guarded both upstream (parser skips) and defensively (seam's `isWrapperContent` gate).
- **Fresh JSON.parse in onLine to inspect rawObj.** The shared `reshapeParsedLineToWireFrame` helper doesn't expose the raw object, and widening its contract would ripple through 5+ callers. A fresh JSON.parse is negligible on live tail volumes (matches the existing pattern for backgrounded-agent detection at ~L2483).

## Deviations from Plan

None substantive — plan executed as written. Two minor procedural notes:

1. **Node modules were empty on the executor box** and had to be freshly installed via `npm ci --ignore-scripts` (the `better-sqlite3` native compile fails without `make` installed, and `make` isn't needed for the vitest / tsc / vite paths this plan exercises). Recorded here for future executors — this is an environment prep step, not a code change.
2. **The plan's action text referenced `~L1343` as the location for the seam** ("Place the seam near the existing `__applyInputMessageForTests` seam at L1343"). The actual location of `__applyInputMessageForTests` is L1463 (line-number drift since the plan was written); the seam was placed at L1523-1710, immediately after `__applyInputMessageForTests` and before `__applyInterruptMessageForTests`. Same intent, same neighborhood.

## Issues Encountered

- **First full-repo vitest run reported "3 errors" in the summary line** despite exit 0 and no test failures. Investigation via re-run showed these were non-fatal jsdom environment warnings (`HTMLMediaElement.play() not implemented`, `HTMLCanvasElement.getContext() without canvas npm package`) surfacing on the first test-file preload; the second run had zero errors and 2670 passed | 9 skipped | 1 todo. Not a code issue; recorded so future readers don't chase it.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 50-02 is unblocked.** It will introduce the send-path watchdog and MUST key its arm-time + notifyMatched contentHash off the SAME `sha256(content).slice(0, 32)` derivation this plan established. The two-hash contract is documented in inline comments in both `session-file-parser.ts` (Task 1 block comment) and `claude-session-server.ts` (`__applyQueueDedupForTests` block comment).
- **Wire protocol unchanged.** The new emission uses the existing `MessageEvent` shape; frontend (Plan 50-03) needs no new routing — its per-eventId dedup Set will handle enqueue re-plays via the deterministic eventId.
- **Test seam is in place** for Plan 50-04's integration tests to plug into if they need to drive dedup behavior without the full tail-watcher.

## Self-Check: PASSED

All claimed files exist:
- `.planning/phases/50-optimistic-message-bubbles/50-01-SUMMARY.md` — this file
- `src/backend/claude-session/session-file-parser.ts` — modified (queue-operation branch + createHash import + sessionId param)
- `src/backend/claude-session/session-file-parser.test.ts` — modified (9 new tests appended)
- `src/backend/claude-session/claude-session-server.ts` — modified (dedup Map + seam + wire-through)
- `src/backend/claude-session/claude-session-server.queue-dedup.test.ts` — created (8 tests)

All claimed commits exist on `feat/tab-title-from-tmux`:
- `5342a350` test(50-01) RED for Task 1
- `ed541d0f` feat(50-01) GREEN for Task 1
- `bb2a3243` test(50-01) RED for Task 2
- `44fcaa63` feat(50-01) GREEN for Task 2

Verification commands all pass:
- `node_modules/.bin/vitest run src/backend/claude-session/session-file-parser.test.ts src/backend/claude-session/claude-session-server.queue-dedup.test.ts` → 56/56 pass
- `node_modules/.bin/vitest run src/backend/claude-session/` → 449/449 pass
- `node_modules/.bin/vitest run` (full repo) → 2670 passed | 9 skipped | 1 todo, exit 0
- `npm run build:backend` → exit 0
- `npm run build` → exit 0
- `npx tsc --noEmit` → exit 0
- `grep -n 'queue-operation' src/backend/claude-session/session-file-parser.ts` → 4 hits (inside parseSessionLine)
- `grep -c 'kind:\s*"message"' src/backend/claude-session/session-file-parser.ts` → 5 (was 2 pre-plan; new branch + type union + other emitters)
- `grep -n 'createHash' src/backend/claude-session/session-file-parser.ts` → 2 hits (import + derivation)
- `grep -n 'queueEnqueueDedup' src/backend/claude-session/claude-session-server.ts` → 2 hits (declaration + onLine)
- `grep -Ec '^export.*__applyQueueDedupForTests' src/backend/claude-session/claude-session-server.ts` → 1
- `grep -n 'parseSessionLine(' src/backend/claude-session/claude-session-server.ts` → 2 hits, both call sites pass sessionIdFromFile
- Patch #66 task-notification handler (L2582-2623 in claude-session-server.ts before Plan 50-01) has zero `-` diff lines against pre-plan HEAD

---
*Phase: 50-optimistic-message-bubbles*
*Completed: 2026-08-20*
