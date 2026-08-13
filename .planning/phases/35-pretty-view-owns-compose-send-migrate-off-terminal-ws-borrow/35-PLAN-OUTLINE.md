# Phase 35 — Plan Outline

**Phase:** 35 — pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow
**Outlined:** 2026-08-13
**Mode:** standard (chunked outline pass)

## Phase Goal

Migrate all pretty-view outbound writes (compose-send, interrupt, injected-turn, and MessageQueueDrawer.onSend) off the borrowed terminal SSH WebSocket onto pretty-view's own claude-session WebSocket, eliminating the silent-death-on-long-idle bug where `webSocketRef.current` points at a dead socket after a network middleware idle-kill (Caddy timeout / TCP keepalive gap / mobile-tower NAT rebind) and the first send after returning to a session fails with `submit-failed err="not-connected"`.

Delivered as two plans: an additive backend WS handler pair (Plan 35-01) that is safely shippable on its own, followed by an atomic frontend cutover (Plan 35-02) that flips all four call sites in one commit — half-migration is prohibited because leaving any one site on `webSocketRef.current` reintroduces the whole bug on that path.

## Requirement IDs

Introduced in this outline (Requirements: TBD in ROADMAP; captured here for plan-level traceability):

- **PVWS-01** — Backend: additive `type:"input"` handler on claude-session WS with split-send gate (`mqid.length > 0 && data.endsWith("\r")` → body via `tmux send-keys -l`, wait 250ms, then `tmux send-keys Enter`).
- **PVWS-02** — Backend: additive `type:"interrupt"` handler on claude-session WS (`tmux send-keys C-c`).
- **PVWS-03** — Backend: trust boundary — both new handlers derive target pane exclusively from connection-scoped `currentTmuxSession`; any client-supplied `hostId`/`tmuxSession` is IGNORED (mirrors T-14-02-01).
- **PVWS-04** — Backend: 16KB payload cap on `input` handler (mirrors `MAX_RAW_KEYSTROKES_BYTES`); empty-body early return; empty-body split-send (bare `\r` + mqid) still fires the Enter.
- **PVWS-05** — Backend: log-and-swallow on `execCommand` failure for both handlers (mirrors raw_keystrokes error posture); no throw back to client.
- **PVWS-06** — Backend: exported `__applyInputMessageForTests` + `__applyInterruptMessageForTests` seams mirroring `__applyWakeMessageForTests` shape (enables unit tests without live WS/SSH).
- **PVWS-07** — Backend tests: split-send timing gate asserted via `vi.useFakeTimers()` + `advanceTimersByTimeAsync(249)/(1)` for the 250ms boundary; non-split single-call case; trust-boundary regression; 16KB cap; empty-body edge case; log-and-swallow error path.
- **PVWS-08** — Frontend: PrettyView exposes `sendInput(text, mqid?): boolean` + `sendInterrupt(): void` callbacks closing over `wsRef.current`, mirroring the four-line guard posture of `handleWake`/`handlePlanApprove`/`handleAsideDismiss` (`WebSocket.OPEN` check + try/swallow).
- **PVWS-09** — Frontend: ref-forwarding surface — Terminal.tsx creates `pvSendInputRef` + `pvSendInterruptRef`, passes `onRegisterSendInput`/`onRegisterSendInterrupt` (and unregister) props to PrettyView; PrettyView sets `ref.current = callback` on mount effect and clears on unmount.
- **PVWS-10** — Frontend: atomic swap of all FOUR call sites in `Terminal.tsx` from `webSocketRef.current` reads → `pvSendInputRef.current?.(...)` / `pvSendInterruptRef.current?.()`:
  - `handleInjectedTurnReady` at :3208 (two-event pattern preserved: body then 60ms-delayed `\r`+mqid)
  - `onSend` (pretty-view composebox) at :3261 (single-event split-send shape preserved)
  - `onInterrupt` at :3300 (patch #120 safety-valve Ctrl-C)
  - `MessageQueueDrawer.onSend` at :3331 (two-event pattern preserved)
- **PVWS-11** — Frontend: `terminalWs={webSocketRef.current}` prop at `Terminal.tsx:3312` STAYS unchanged (feeds `usePrettyViewUploads`, not compose-send — RESEARCH.md Gap 2 confirmed). `MessageQueueDrawer` mount at `Terminal.tsx:3327` STAYS as sibling of PrettyView (must remain visible in both pretty and terminal modes).
- **PVWS-12** — Frontend tests: extend PrettyView test suite with ref-forwarding harness asserting each of the four migrated call sites writes to pretty-view's WS (`ws.send.mock.calls` inspection) not terminal's; use `PrettyView.aside.test.tsx`'s WS-mock scaffolding pattern.
- **PVWS-13** — Verification: `npx vitest run` exit 0 (currently 155 files / 2006 pass) + `npm run build:backend` exit 0. No byte-stream comparison (explicitly rejected by user).

## Plan Outline

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|------------|--------------|
| 35-01 | Backend additive `type:"input"` + `type:"interrupt"` handlers on claude-session WS. Slot into `claude-session-server.ts` wss.on("connection") dispatch block between `raw_keystrokes` (:4053) and `wake` (:4063). Split-send gate mirrors `terminal.ts:842` timing exactly — 250ms (NOT 50ms; the CONTEXT.md worked example says 50ms which is stale from patch #100, superseded by patch #111 → 250ms after Ashley UAT). Extract pure logic as exported `__applyInputMessageForTests` + `__applyInterruptMessageForTests` seams (shape mirrors `__applyWakeMessageForTests` at :1088). New test file `src/backend/claude-session/claude-session-server.compose-send.test.ts` covering: split-send fires two execCommand calls with 250ms gap (fake timers + `advanceTimersByTimeAsync(249)/(1)`); non-split fires one call; guard returns on null sshConn/currentTmuxSession; 16KB cap enforced; trust boundary (currentTmuxSession used, client-supplied fields ignored); empty-body split-send fires only Enter; log-and-swallow on execCommand throw. Additive — no frontend cutover, no removal of anything. Safely shippable on its own. | 1 | none | PVWS-01, PVWS-02, PVWS-03, PVWS-04, PVWS-05, PVWS-06, PVWS-07 |
| 35-02 | Atomic frontend cutover of ALL FOUR call sites in `Terminal.tsx` from borrowed terminal SSH WS (`webSocketRef.current`) → pretty-view's own claude-session WS (via PrettyView-exposed callbacks). PrettyView.tsx adds two new `useCallback`s: `sendInput(text, mqid?): boolean` and `sendInterrupt(): void`, both closing over `wsRef.current`, mirroring the four-line posture of `handleWake`/`handlePlanApprove`/`handleAsideDismiss` (guard on `WebSocket.OPEN`, try/swallow). PrettyView registers both callbacks via new `onRegisterSendInput`/`onUnregisterSendInput`/`onRegisterSendInterrupt`/`onUnregisterSendInterrupt` props in a mount effect. Terminal.tsx declares `pvSendInputRef = useRef<((text, mqid?) => boolean) \| null>(null)` + `pvSendInterruptRef = useRef<(() => void) \| null>(null)`, passes registration callbacks to PrettyView, and swaps all four call sites: `handleInjectedTurnReady` :3208 (two-event body+60ms-`\r`+mqid pattern preserved, `deps: []` posture unchanged since pvSendInputRef is a stable React ref), `onSend` :3261 (single-event split-send shape preserved, mqid = `"pv-adhoc-<uuid>"`), `onInterrupt` :3300 (calls `pvSendInterruptRef.current?.()`), `MessageQueueDrawer.onSend` :3331 (two-event pattern preserved). CRITICAL preservations: `terminalWs={webSocketRef.current}` at :3312 UNCHANGED (feeds usePrettyViewUploads); MessageQueueDrawer mount at :3327 UNCHANGED (stays sibling of PrettyView — must be visible in terminal mode too); terminal-mode xterm.js keystrokes at :3175 UNCHANGED (still route through terminal SSH WS's own `type:"input"` handler at `terminal.ts:499` — both handlers coexist post-cutover). Extend PrettyView test suite (`PrettyView.aside.test.tsx` pattern) with ref-forwarding harness asserting each of the four migrated call sites writes to pretty-view's WS not terminal's, via `ws.send.mock.calls` inspection filtering by `type === "input"` / `type === "interrupt"`. Atomic — half-migration is prohibited (would reintroduce bug on un-migrated path). | 2 | 35-01 | PVWS-08, PVWS-09, PVWS-10, PVWS-11, PVWS-12, PVWS-13 |

## Wave Structure

- **Wave 1:** 35-01 (backend, no dependencies, additive)
- **Wave 2:** 35-02 (frontend, depends on 35-01 so backend handlers exist to receive the new-shape frames)

Note: 35-01 is strictly additive and could ship independently before 35-02 exists, but 35-02 cannot ship before 35-01 without the frontend sending frames the backend doesn't handle. Wave 2 dependency is correct.

## Source Coverage Audit

- **GOAL** (ROADMAP phase 35 goal — "To be planned", refined by CONTEXT.md § domain): Migrate all four pretty-view outbound writes off borrowed terminal WS → PrettyView's own WS to fix silent-death bug. → COVERED by 35-01 (backend) + 35-02 (frontend cutover).
- **REQ** (Requirements: TBD in ROADMAP; enumerated as PVWS-01..PVWS-13 above): All 13 IDs assigned across the two plans. Every ID appears in exactly one plan's `requirements` field.
- **RESEARCH** (35-RESEARCH.md): Critical 250ms-not-50ms discrepancy (Gap 5) → covered by 35-01 timing requirement PVWS-01 (explicit 250ms). Test seam pattern (Gap 4) → covered by PVWS-06. MessageQueueDrawer file location `src/ui/features/terminal/MessageQueueDrawer.tsx` (Gap 1) → covered by 35-02 (component internals unchanged, only parent's `onSend` prop source flips). `terminalWs` prop stays (Gap 2 observation) → covered by PVWS-11. `useCallback` deps `[]` posture correctness post-migration (Gap 9) → covered by 35-02 preservation note. Ref-forwarding Option A (Gap 8) → covered by PVWS-09. All 6 common pitfalls addressed.
- **CONTEXT** (35-CONTEXT.md): Backend approach (additive `input` + `interrupt` on claude-session WS with 250ms split-send) → 35-01. Trust boundary → PVWS-03. Frontend atomic cutover of all four call sites → 35-02 / PVWS-10. MessageQueueDrawer mount stays sibling → PVWS-11. Verification collapses to tests-green + build-green (no byte-stream comparison) → PVWS-13. Deploy ordering (Phase 35 ships first, batches 34 + quick 260813-0qx) → deployment concern, not a plan requirement. All locked decisions covered.
- **Deferred (out of scope, not gaps):** Terminal WS keep-alive ping (Fix A), removing terminal.ts:499 `type:"input"` handler, byte-stream comparison, consolidating raw_keystrokes+input frames, migration of other `webSocketRef.current` reads. All explicitly deferred per CONTEXT.md § deferred.

No unplanned items. No split recommended.

## OUTLINE COMPLETE

**Plan count:** 2 (35-01 backend additive, 35-02 frontend atomic cutover)
