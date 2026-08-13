---
phase: 35-pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow
plan: "02"
subsystem: pretty-view-compose-send
tags: [websocket, pretty-view, terminal, ref-forwarding, cutover]
dependency-graph:
  requires: [35-01]
  provides: [PVWS-08, PVWS-09, PVWS-10, PVWS-11, PVWS-12, PVWS-13]
  affects: [PrettyView.tsx, Terminal.tsx]
tech-stack:
  added: []
  patterns: [ref-forwarding-registration, useCallback-closes-over-ref, sendInput-boolean-return]
key-files:
  created:
    - src/ui/features/pretty-view/PrettyView.compose-send.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/terminal/Terminal.wiring.test.ts
decisions:
  - "ref-forwarding via onRegisterSendInput/onRegisterSendInterrupt props chosen over context/wsRef prop-drilling (Option A from RESEARCH.md Gap 8)"
  - "sendInput returns boolean (true on success, false on guard-trip or catch) — try/catch shape authoritative per plan requirement"
  - "sendInterrupt returns void with swallow-on-throw — matches existing onInterrupt contract at Terminal.tsx:3300"
  - "JSX block comments ({/* */}) not valid as JSX attributes; replaced with // comments in Terminal.tsx"
  - "Terminal.wiring.test.ts Tests 4+4b+5 updated to assert Phase 35 pvSendInputRef patterns (pre-Phase-35 assertions would have been stale)"
metrics:
  duration: "~95 minutes"
  completed: "2026-08-13T15:44:00Z"
  tasks: 4
  files_changed: 4
---

# Phase 35 Plan 02: PrettyView compose-send cutover — frontend atomic swap Summary

**One-liner:** Atomic cutover of all four pretty-view outbound-write call sites in Terminal.tsx from the borrowed terminal SSH WS (webSocketRef.current) to PrettyView's own claude-session WS via ref-forwarding callbacks (pvSendInputRef / pvSendInterruptRef), eliminating the silent-death bug on long-idle sessions.

## What Was Built

### PrettyView.tsx — Phase 35 ref-forwarding surface (Task 1)

- Added four new optional props to `PrettyViewProps`:
  - `onRegisterSendInput?: (fn: (text: string, mqid?: string) => boolean) => void`
  - `onUnregisterSendInput?: () => void`
  - `onRegisterSendInterrupt?: (fn: () => void) => void`
  - `onUnregisterSendInterrupt?: () => void`
- Added `sendInput(text, mqid?): boolean` useCallback — closes over `wsRef`, reads `.current` at call time, guards on `WebSocket.OPEN`, try/catch returns `false` on any failure (authoritative — ws.send can throw between readyState check and actual send during backgrounding/network flap)
- Added `sendInterrupt(): void` useCallback — closes over `wsRef`, void return, swallow-on-throw (matches existing onInterrupt contract)
- Added mount effect that registers both callbacks on mount and unregisters on unmount
- Line delta: +82 insertions (0 deletions of existing code)

### Terminal.tsx — atomic swap of all FOUR call sites (Task 2)

- Declared two new refs: `pvSendInputRef` and `pvSendInterruptRef` (near `webSocketRef` declaration)
- **Swap 1 — `handleInjectedTurnReady`**: reads `pvSendInputRef.current` for body event AND 60ms-delayed `\r`+mqid event (two-event pattern preserved)
- **Swap 2 — PrettyView `onSend`**: reads `pvSendInputRef.current`, single-event `pv-adhoc-*` mqid shape preserved, returns result of `send()` call (boolean)
- **Swap 3 — PrettyView `onInterrupt`**: reads `pvSendInterruptRef.current`
- **Swap 4 — `MessageQueueDrawer.onSend`**: reads `pvSendInputRef.current` for body event AND 60ms-delayed `\r`+mqid event (two-event pattern preserved)
- Wired four registration props (`onRegisterSendInput`, `onUnregisterSendInput`, `onRegisterSendInterrupt`, `onUnregisterSendInterrupt`) into PrettyView JSX
- `terminalWs={webSocketRef.current}` at line 3367 preserved byte-identical (feeds usePrettyViewUploads)
- `MessageQueueDrawer` mount at line 3391 stays as sibling of PrettyView (not moved into PrettyView subtree)
- Terminal-mode xterm.js keystrokes at sshAdapter still use `webSocketRef.current` (terminal SSH WS)
- `webSocketRef.current` count: PRE=96 → POST=90 (delta=6, strict decrease)
- Line delta: +37 insertions, -37 deletions (net neutral — pure swap, all comments preserved)

### PrettyView.compose-send.test.tsx — ref-forwarding harness (Task 3, new file)

5 test cases in `describe("PrettyView — Phase 35 compose-send ref-forwarding cutover", ...)`:

1. **Test 1: pretty-view composebox single-event split-send** — `sendInput("hello world\r", "pv-adhoc-abc")` fires exactly one `{type:"input"}` on PrettyView WS; `terminalWsMock.send` not called
2. **Test 2: onInterrupt** — `sendInterrupt()` fires exactly one `{type:"interrupt"}`; `terminalWsMock.send` not called
3. **Test 3: handleInjectedTurnReady two-event pattern** — `sendInput("hello")` then 60ms-delayed `sendInput("\r", "mq-injected-1")`; fake timers gate at 59ms/60ms boundary; body event has no `messageQueueItemId` field; `terminalWsMock.send` not called
4. **Test 4: MessageQueueDrawer.onSend two-event pattern** — same shape as Test 3 with `("body-text")` + `("\r", "mq-42")`; `terminalWsMock.send` not called
5. **Test 5: WS-closed regression** — `sendInput` returns `false` when `readyState === 3`; no `ws.send` call; `terminalWsMock.send` not called

Every test mounts a second `terminalWsMock` WsStub passed as `terminalWs` prop and asserts `expect(terminalWsMock.send).not.toHaveBeenCalled()` (defense-in-depth against accidental terminal-WS cross-wiring). WS-stub scaffolding copied verbatim from `PrettyView.aside.test.tsx` template.

### Terminal.wiring.test.ts — updated to assert Phase 35 implementation (Task 2 fix)

- Tests 4, 4b, 5 updated to assert pvSendInputRef-based routing instead of pre-Phase-35 webSocketRef.current patterns
- Test 1c: fixed `handleInjectedTurnReady` occurrence count (removed from Phase 35 comment to keep count at exactly 2: definition + JSX attribute)

## Verification Results

### All Four Migrated Call Sites — Confirmed

```
grep -nE 'webSocketRef\.current' Terminal.tsx | awk -F: '{if ($1 >= 3310 && $1 <= 3400) print}'
# Output: 3367:            terminalWs={webSocketRef.current}
# Exactly ONE match — the preserved terminalWs prop. All four call sites migrated.
```

### webSocketRef.current Count

| | Count |
|---|---|
| PRE (HEAD~5 = 45524f6, post-Plan-35-01) | 96 |
| POST (current) | 90 |
| Delta | -6 (strict decrease) |

The delta of 6 is empirical: `handleInjectedTurnReady` had two nested reads (outer body + inside setTimeout callback), `onSend` had one, `onInterrupt` had one, `MessageQueueDrawer.onSend` had two.

### Registration Props Wired Both Sides

| File | onRegisterSendInput/onRegisterSendInterrupt count |
|---|---|
| PrettyView.tsx | 9 (≥ 8 required) |
| Terminal.tsx | 4 (≥ 4 required) |

### Verification Commands

| Command | Result |
|---|---|
| `npx vitest run PrettyView.compose-send.test.tsx` | 5/5 pass |
| `npx vitest run Terminal.wiring.test.ts` | 38/38 pass |
| `npx tsc --noEmit` | 0 errors |
| `npm run build` | exit 0 (built in ~16s) |
| `npm run build:backend` | exit 0 |

### No inline type:"input"/"interrupt" in pretty-view prop region (3310-3420)

```
grep -nE 'type:\s*"(input|interrupt)"' Terminal.tsx | awk -F: '{if ($1 >= 3310 && $1 <= 3420) print}'
# (empty — zero matches in PrettyView JSX prop region)
```

Note: Terminal.tsx still contains `type:"input"` in terminal-mode keystroke paths (xterm.js sshAdapter, toolbar, autocomplete — all at lines outside 3310-3420). These are MUST-NOT-TOUCH paths for terminal-mode keystrokes.

### MessageQueueDrawer Mount Unchanged

`MessageQueueDrawer` is mounted at line 3391, still as a sibling of PrettyView (guarded by `isMessageQueueOpen && hostConfig.id != null`). It was NOT moved into PrettyView's subtree. Only its `onSend` prop source changed from `webSocketRef.current` to `pvSendInputRef.current`.

### terminalWs Prop Preserved

`grep -n 'terminalWs=' Terminal.tsx` → exactly one match: `3367: terminalWs={webSocketRef.current}`. Byte-identical to pre-cutover.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSX block comment in PrettyView JSX attribute position**
- **Found during:** Task 4 (npm run build failed)
- **Issue:** `{/* Phase 35 ref-forwarding... */}` comment placed as a JSX attribute, which is invalid TSX. Rollup/Vite caught the parse error; tsc was silent (tsc does not validate JSX comment position at attribute sites).
- **Fix:** Replaced with standard `// ...` line comments above the `onRegisterSendInput` props
- **Files modified:** Terminal.tsx
- **Commit:** 20e8173

**2. [Rule 1 - Bug] Terminal.wiring.test.ts Tests 4, 4b, 5 asserting pre-Phase-35 implementation**
- **Found during:** Task 4 (npx vitest run — 3 tests failed in Terminal.wiring.test.ts)
- **Issue:** The wiring test was checking for `if (!ws || ws.readyState !== 1) return false;` and `ws.send(JSON.stringify({ type: "input"... }))` in the onSend/MessageQueueDrawer callbacks — but Phase 35 intentionally replaced these with `pvSendInputRef.current` reads. Also Test 1c was failing because the `handleInjectedTurnReady` identifier appeared 3x (definition + JSX attribute + Phase 35 comment), but the test expects exactly 2.
- **Fix:** Updated Tests 4, 4b, 5 to assert the new pvSendInputRef-based routing. Removed `handleInjectedTurnReady` from the Phase 35 JSX comment to keep the 2-occurrence count.
- **Files modified:** Terminal.wiring.test.ts, Terminal.tsx
- **Commit:** 96256e5

### Pre-existing Flaky Test Failures (Out of Scope)

The full parallel vitest suite runs show intermittent failures in `src/ui/sidebar/` and `src/ui/features/pretty-conversations/` test files (`NewSessionDialog.test.tsx`, `CreateRoleDialog.test.tsx`, `CloneAgentDialog.test.tsx`, etc.). These:
- Are NOT in files touched by Phase 35-02 (zero import relationship with my changes)
- Pass when run in isolation (`NewSessionDialog.test.tsx` → 46/46 pass)
- Are pre-existing flaky tests due to shared global state in parallel test runs
- Are documented in `deferred-items.md` for the project team

These are out-of-scope per the SCOPE BOUNDARY rule and are NOT caused by Plan 35-02.

## Known Stubs

None. All four call sites are fully wired. The ref-forwarding surface (sendInput/sendInterrupt) writes to PrettyView's own live claude-session WebSocket (wsRef.current, established by the existing patch #148 reconnect lifecycle).

## Threat Flags

No new threat surface. The Phase 35-01 backend handlers (`type:"input"` + `type:"interrupt"`) established the trust boundary (connection-scoped currentTmuxSession, 16KB cap, shellQuote). This plan only changes which frontend socket writes those frames.

## Self-Check

- [x] PrettyView.compose-send.test.tsx exists at src/ui/features/pretty-view/PrettyView.compose-send.test.tsx
- [x] Terminal.wiring.test.ts all 38 pass (confirmed)
- [x] Commits exist: d846e7a, 509e94f, aabf340, 20e8173, 96256e5
- [x] terminalWs={webSocketRef.current} preserved at Terminal.tsx:3367

## Self-Check: PASSED
