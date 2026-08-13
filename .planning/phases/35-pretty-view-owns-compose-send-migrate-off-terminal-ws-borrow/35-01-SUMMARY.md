---
phase: 35-pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow
plan: "01"
subsystem: backend
tags: [websocket, tmux, compose-send, test-seam, split-send, trust-boundary]
dependency_graph:
  requires: []
  provides:
    - claude-session WS input handler (type:"input" → tmux send-keys, split-send with 250ms gap)
    - claude-session WS interrupt handler (type:"interrupt" → tmux send-keys C-c)
    - __applyInputMessageForTests seam (exported, callable without live WS/SSH)
    - __applyInterruptMessageForTests seam (exported, callable without live WS/SSH)
    - MAX_INPUT_BYTES constant (16KB cap, mirrors MAX_RAW_KEYSTROKES_BYTES)
  affects:
    - src/backend/claude-session/claude-session-server.ts (two new message handlers + two exported seams)
tech_stack:
  added: []
  patterns:
    - "test seam pattern: exported async function __applyXForTests(deps) (mirrors __applyWakeMessageForTests at :1088)"
    - "fake-timers gate: vi.useFakeTimers() + advanceTimersByTimeAsync(249)/(1) for 250ms boundary"
    - "split-send pattern: body write → 250ms delay → Enter write via tmux send-keys"
key_files:
  created:
    - src/backend/claude-session/claude-session-server.compose-send.test.ts
  modified:
    - src/backend/claude-session/claude-session-server.ts
decisions:
  - "Used 250ms (not 50ms) per terminal.ts:842 + patch #111 — CONTEXT.md worked example had stale 50ms value"
  - "MAX_INPUT_BYTES declared at seam scope (not module scope) mirroring raw_keystrokes local const at :4025"
  - "messageQueueItemId coercion in dispatch block: String(...) || undefined to ensure empty string → undefined (non-split)"
  - "16 test cases covering all behavior-spec bullets; afterEach uses vi.useRealTimers() defensive reset"
metrics:
  duration_minutes: ~40
  completed: "2026-08-13T14:00:00Z"
  tasks_completed: 3
  files_changed: 2
  lines_added: 528
---

# Phase 35 Plan 01: Add input + interrupt handlers on claude-session WS — Summary

**One-liner:** Additive input/interrupt WebSocket handlers on claude-session server (port 30011) with 250ms split-send timing + 16KB cap, exported test seams, and 16-test fake-timers suite covering both seams.

## What Was Built

Two additive message handlers inserted into the `wss.on("connection")` dispatch block in `src/backend/claude-session/claude-session-server.ts`, positioned between the existing `raw_keystrokes` handler (line 4092) and the `wake` handler (line 4219):

### `type:"input"` handler (line 4184)

Accepts `{ type: "input", data: string, messageQueueItemId?: string }` frames. Delegates to `__applyInputMessageForTests` seam. Behavior:

- **Guard:** null `sshConn` or null `currentTmuxSession` → silent return (same as raw_keystrokes at :4016)
- **Empty data:** returns without calling execCommand
- **16KB cap:** `MAX_INPUT_BYTES = 16 * 1024` — rejects with `sshLogger.warn` (operation: `input_reject_size`)
- **Split-send (mqid non-empty + data ends in `\r`):** body write via `tmux send-keys -l`, then `await new Promise(resolve => setTimeout(resolve, 250))`, then Enter write via `tmux send-keys` — 250ms matches `terminal.ts:842` (patch #111)
- **Empty-body split-send (data = `\r`):** skip body write, Enter only
- **Non-split:** single `tmux send-keys -l` call
- **Error:** log-and-swallow (operation: `input_send_error`), mirrors raw_keystrokes :4041-4051
- **Trust boundary:** target derived from connection-scoped `currentTmuxSession` only — client payload fields ignored

### `type:"interrupt"` handler (line 4202)

Accepts `{ type: "interrupt" }` frames. Delegates to `__applyInterruptMessageForTests` seam. Behavior:

- **Guard:** same null-guard as input handler
- **Happy path:** single `tmux send-keys -t <shellQuote(session)> C-c` call (no `-l` flag — C-c is a tmux key name)
- **Error:** log-and-swallow (operation: `interrupt_send_error`)

### Exported test seams

`__applyInputMessageForTests` (line 1093) and `__applyInterruptMessageForTests` (line 1168) exported alongside `__applyWakeMessageForTests` (line 1201). Both accept explicit `deps` parameters — callable directly from tests without live WS or SSH.

### Test file

`src/backend/claude-session/claude-session-server.compose-send.test.ts` — 372 lines, 16 tests:
- 12 input handler tests: null-guards (2), empty data, 16KB cap, 3x NON-SPLIT variants, split-send timing gate, empty-body split-send, trust boundary, 2x execCommand-throw paths
- 4 interrupt handler tests: null-guards (2), happy path, execCommand throw
- Timing gate: `vi.useFakeTimers()` + `advanceTimersByTimeAsync(249)` asserts 1 call, `advanceTimersByTimeAsync(1)` asserts 2 calls — gates the 250ms boundary (mirrors `aside.test.ts:376-403`)

## Verify Gate Outcomes

| Gate | Result |
|------|--------|
| `grep -c 'msg.type === "input"' ...` = 1 | PASS |
| `grep -c '__applyInputMessageForTests' ...` in [2-9] | PASS (2 occurrences) |
| `grep -c 'MAX_INPUT_BYTES' ...` in [2-9] | PASS (3 occurrences) |
| `grep -q 'setTimeout(resolve, 250)'` | PASS |
| `! grep -q 'setTimeout(resolve, 50)'` | PASS (0 occurrences) |
| `npm run build:backend` (Task 1) | PASS (exit 0) |
| `grep -c 'msg.type === "interrupt"'` = 1 | PASS |
| `grep -q 'export async function __applyInterruptMessageForTests'` | PASS |
| `grep -q 'send-keys -t.*C-c'` | PASS |
| `npm run build:backend` (Task 2) | PASS (exit 0) |
| `test -f ...compose-send.test.ts` | PASS |
| `npx vitest run ...compose-send.test.ts` (solo) | PASS (16/16) |
| `npx vitest run src/backend/claude-session/` | PASS (27 files, 379 tests) |
| `npm run build:backend` (Task 3) | PASS (exit 0) |
| `git diff --name-only` only in `src/backend/claude-session/` | PASS |
| `git diff src/backend/ssh/terminal.ts` empty | PASS (terminal.ts untouched) |
| `grep -q 'IGNORE any client-supplied'` near input handler | PASS |

Note: Full `npx vitest run` (155-file suite) was running at SUMMARY write time. Baseline run 1 (pre-changes) showed 155 passed/2019 passing. Baseline run 2 showed 3 pre-existing flaky failures (IdentityModal-related, unrelated to this plan). The claude-session subsuite (27 files, 379 tests) runs clean.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | `5594342` | feat(35-01): add MAX_INPUT_BYTES + input handler + __applyInputMessageForTests seam |
| Task 2 | `3294cbb` | feat(35-01): add interrupt handler + __applyInterruptMessageForTests seam (D-PVWS-02) |
| Task 3 | `05df22f` | test(35-01): add compose-send test file — 16 tests covering both seams (D-PVWS-07) |

## Deviations from Plan

### No deviations — plan executed exactly as designed.

Minor implementation notes (not deviations):
- `MAX_INPUT_BYTES` declared inside `__applyInputMessageForTests` seam body (not at module scope) — this matches the `raw_keystrokes` handler's pattern where `MAX_RAW_KEYSTROKES_BYTES` is declared local at :4025. The plan said "planner's discretion"; local declaration mirrors the existing pattern.
- `messageQueueItemId` coercion in dispatch block: `String(...) || undefined` converts empty string to `undefined` so the seam's `mqid.length > 0` gate triggers only on genuinely non-empty mqids.
- afterEach in test file uses `vi.clearAllMocks()` + `vi.useRealTimers()` — defensive reset matches aside.test.ts:344-347 pattern.

## Known Stubs

None — all handlers are fully wired (execCommand calls are real in production, mocked only in tests via injected deps pattern).

## Threat Flags

No new threat surface beyond what's documented in the plan's `<threat_model>`. All four STRIDE threats (T-35-01-01 through T-35-01-04) are mitigated as designed:
- Trust boundary: structural (seam signature has no payload-sourced pane fields)
- 16KB cap: enforced in `__applyInputMessageForTests` before any execCommand call
- Shell injection: `shellQuote()` wraps both `currentTmuxSession` and `body`/`data` in every emitted command
- Session integrity: T-35-01-05 (DoS accept) and T-35-01-06 (test seam disclosure accept) match existing posture
