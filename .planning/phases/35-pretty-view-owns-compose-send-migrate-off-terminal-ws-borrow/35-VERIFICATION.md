---
phase: 35-pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow
verified: 2026-08-13T16:35:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 35: pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow Verification Report

**Phase Goal:** Migrate all four pretty-view outbound writes (compose-send, interrupt, injected-turn, MessageQueueDrawer.onSend) off the borrowed terminal SSH WebSocket onto pretty-view's own claude-session WebSocket, eliminating the silent-death-on-long-idle bug where `webSocketRef.current` points at a dead socket after network-middleware idle-kill.

**Verified:** 2026-08-13T16:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `msg.type === "input"` handler exists in claude-session-server.ts with 250ms split-send (NOT 50ms); `msg.type === "interrupt"` handler exists; both slot between raw_keystrokes (4128) and wake (4219) | ✓ VERIFIED | `grep -n 'msg.type'` → raw_keystrokes:4128, input:4184, interrupt:4202, wake:4219; `setTimeout(resolve, 250)` count=1; `setTimeout(resolve, 50)` count=0 |
| 2 | Both handlers early-return on null sshConn/currentTmuxSession; use connection-scoped currentTmuxSession only; 16KB MAX_INPUT_BYTES cap; log-and-swallow on throw | ✓ VERIFIED | Read lines 1093-1189 of claude-session-server.ts confirms all guards, trust boundary, cap enforcement, and catch blocks |
| 3 | `__applyInputMessageForTests` + `__applyInterruptMessageForTests` exported, mirror `__applyWakeMessageForTests` shape | ✓ VERIFIED | grep confirms 3 exported seams; signature read confirms explicit deps, no live WS/SSH required |
| 4 | PrettyView.tsx adds `sendInput(text, mqid?): boolean` + `sendInterrupt(): void` callbacks closing over wsRef; four registration props; mount effect registers/unregisters | ✓ VERIFIED | PrettyView.tsx lines 633-661 (callbacks), 177-180 (props), 1966-1978 (mount effect) all present and substantive |
| 5 | Terminal.tsx has pvSendInputRef + pvSendInterruptRef; ALL FOUR call sites migrated (handleInjectedTurnReady, onSend, onInterrupt, MessageQueueDrawer.onSend); registration props wired into PrettyView JSX | ✓ VERIFIED | grep confirms refs at 180-181, call sites at 3273/3277, 3349, 3363, 3395/3405; registration props at 3373-3376 |
| 6 | MUST-NOT-TOUCH: `terminalWs={webSocketRef.current}` at :3367 byte-identical; MessageQueueDrawer at :3391 stays sibling; xterm.js keystrokes at :3240 still on terminal SSH WS; terminal.ts case "input" untouched | ✓ VERIFIED | terminalWs=grep → exactly one match at 3367; MQD at 3391 sibling; sshAdapter at 3240 uses webSocketRef; `git diff HEAD~6 HEAD -- src/backend/ssh/terminal.ts` = 0 lines |
| 7 | webSocketRef.current in pretty-view JSX region (3310-3420) shows exactly ONE match — the preserved terminalWs prop | ✓ VERIFIED | `grep -nE 'webSocketRef\.current' Terminal.tsx | awk '{3310<=L<=3420}'` → exactly one: line 3367 |
| 8 | All new tests pass; full suite green (flaky IdentityModal tests timeout-only under parallel load, pass in isolation and with extended timeout — pre-existing, not Phase 35) | ✓ VERIFIED | Backend test: 16/16 pass. Frontend test: 5/5 pass. Full suite with --testTimeout=10000: 157 files / 2040 pass / 6 skipped / 1 todo / 0 fail. npm run build exit 0. npx tsc --noEmit exit 0. npm run build:backend exit 0. |

**Score:** 8/8 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/claude-session/claude-session-server.ts` | input+interrupt handlers; exported seams; 250ms; 16KB cap | ✓ VERIFIED | Handlers at 4184/4202; seams at 1093/1168; `setTimeout(resolve,250)` at 1136; `MAX_INPUT_BYTES = 16 * 1024` at 1109 |
| `src/backend/claude-session/claude-session-server.compose-send.test.ts` | 16 tests covering all behavior spec bullets | ✓ VERIFIED | File exists (14234 bytes), 16 `it(` blocks; fake-timer 249/1 gate at lines 177/189; all 16/16 pass in isolation |
| `src/ui/features/pretty-view/PrettyView.tsx` | sendInput/sendInterrupt callbacks; four registration props; mount effect | ✓ VERIFIED | Props at 177-180; callbacks at 633-661; mount effect at 1966-1978; 9 hits for registration prop identifiers (≥8 required) |
| `src/ui/features/terminal/Terminal.tsx` | Two new refs; four migrated call sites; registration props in JSX | ✓ VERIFIED | Refs at 180-181; call sites confirmed; 4 hits for registration props (≥4 required); webSocketRef.current PRE=96 → POST=90 |
| `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` | 5 tests; terminalWsMock in all 5; sends go to PrettyView WS not terminal WS | ✓ VERIFIED | File exists (16623 bytes), 5 `it(` blocks; 14 terminalWsMock references (≥6 required); 5 `not.toHaveBeenCalled()` assertions; all 5/5 pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| claude-session-server.ts input handler | `__applyInputMessageForTests` seam | `await __applyInputMessageForTests({...})` call at 4185 | ✓ WIRED | Dispatch block delegates to seam; seam calls execCommand with shellQuote-wrapped args |
| claude-session-server.ts interrupt handler | `__applyInterruptMessageForTests` seam | `await __applyInterruptMessageForTests({...})` at 4203 | ✓ WIRED | Same delegation pattern |
| Terminal.tsx pvSendInputRef | PrettyView.tsx sendInput | `onRegisterSendInput={(fn) => { pvSendInputRef.current = fn; }}` at 3373 | ✓ WIRED | Mount effect in PrettyView fires onRegisterSendInput(sendInput) on mount; PrettyView.compose-send.test.tsx Test 1-5 all confirm the callback reaches PrettyView's wsRef |
| PrettyView.tsx sendInput | claude-session WS (wsRef.current) | `ws.send(JSON.stringify({type:"input",...}))` at PrettyView.tsx:637 | ✓ WIRED | Reads wsRef.current at call time; guards on WebSocket.OPEN; returns boolean |
| All four Terminal.tsx call sites | pvSendInputRef.current or pvSendInterruptRef.current | Direct ref read at call time | ✓ WIRED | grep confirms: 3273, 3277, 3349, 3363, 3395, 3405 all read pv*Ref.current |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend 250ms split-send gate | `npx vitest run claude-session-server.compose-send.test.ts` | 16/16 pass; timer gate at 249ms=1 call, 250ms=2 calls | ✓ PASS |
| Frontend four call sites send on PrettyView WS (not terminal) | `npx vitest run PrettyView.compose-send.test.tsx` | 5/5 pass; all 5 tests assert terminalWsMock.send not called | ✓ PASS |
| Backend build clean | `npm run build:backend` | exit 0 | ✓ PASS |
| Frontend build clean | `npm run build` | exit 0, built in 28.11s | ✓ PASS |
| TypeScript type check | `npx tsc --noEmit` | 0 errors | ✓ PASS |
| Full suite (10s timeout) | `npx vitest run --testTimeout=10000` | 157 files / 2040 pass / 6 skip / 1 todo / 0 fail | ✓ PASS |

---

### Critical Regression Checks

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `setTimeout(resolve, 250)` count in claude-session-server.ts | ≥1 | 1 | ✓ PASS |
| `setTimeout(resolve, 50)` count in claude-session-server.ts | 0 | 0 | ✓ PASS — 50ms stale value never introduced |
| handler order: raw_keystrokes < input < interrupt < wake | 4128 < 4184 < 4202 < 4219 | exact | ✓ PASS |
| `terminalWs={webSocketRef.current}` line count in JSX region | exactly 1 | 1 at :3367 | ✓ PASS |
| `type:"input"` construction in PrettyView JSX region (3310-3420) | 0 | 0 | ✓ PASS |
| `type:"interrupt"` construction in PrettyView JSX region (3310-3420) | 0 | 0 | ✓ PASS |
| terminal.ts diff from Phase 35 | 0 | 0 | ✓ PASS — completely untouched |
| MessageQueueDrawer mount line | ~3391 sibling | 3391 sibling | ✓ PASS |
| webSocketRef.current total count | strictly < 96 (pre-cutover) | 90 (delta=-6) | ✓ PASS |

---

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers in Phase 35 files. No stubs — all handlers are fully wired. No hardcoded empty returns in data-serving paths. The `__applyInputMessageForTests` / `__applyInterruptMessageForTests` naming convention is the established fork-wide pattern for exported test seams.

---

### Human Verification Required

None. All critical behaviors are verifiable via the test suite and grep-based invariants. The fix addresses a runtime networking race (silent-death on idle-kill) — integration-level production behavior requires network-middleware idle-kill conditions that cannot be simulated in tests, but the structural guarantee (all four send paths now route through PrettyView's own claude-session WS which has auto-reconnect) is proven by the ref-forwarding test harness.

---

### Notes on Full Suite Flakiness

Two test files (`IdentityModal.test.tsx`, `IdentityModal.stays-awake.test.tsx`) timeout at 5000ms under parallel load but pass: (1) in isolation, (2) with `--testTimeout=10000`, and (3) are in zero files touched by Phase 35. This is the pre-existing bounty `identitymodal-test-unhandled-errors-from-391` — shared global state in parallel runs. Not a Phase 35 regression.

---

_Verified: 2026-08-13T16:35:00Z_
_Verifier: Claude (gsd-verifier)_
