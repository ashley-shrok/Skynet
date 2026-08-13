# Phase 35: pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow — Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Source:** Live orchestrator↔user design conversation 2026-08-13 (skipped `/gsd:discuss-phase` — decisions already settled inline before phase creation)

<domain>
## Phase Boundary

Pretty-view compose-send currently BORROWS the terminal pane's SSH WebSocket to write into the tmux pty — `Terminal.tsx:3261-3299 onSend` reads `webSocketRef.current` (the terminal's SSH WS at `Terminal.tsx:163`) and sends `type:"input", data:text+"\r", messageQueueItemId:"pv-adhoc-..."` which trips `terminal.ts:499`'s split-send gate. The terminal SSH WS silently dies during long-idle windows (Caddy idle-timeout, TCP keepalive gap, mobile-tower NAT rebind); the client-side `webSocketRef.current` still points at the dead socket; the one-line `if (!ws || ws.readyState !== 1) return false` guard trips instantly on Ashley's first send after returning to a session → `submit-failed err="not-connected"`. Second send (post visibility-triggered reopen) succeeds. Ashley's manual workaround is to navigate away and back to force the reopen.

**This phase migrates all pretty-view outbound writes off the borrowed terminal WS onto pretty-view's OWN WebSocket** (`PrettyView.tsx:639 wsRef` → `claude-session-server.ts:1382 wss` on port 30011). The pretty-view WS already has aggressive lifecycle handling (iOS-PWA visibilitychange reopen at `PrettyView.tsx:1493`, auto-reconnect per patch #148, pane-hide close+reopen) and already writes into the pane in production via `raw_keystrokes` (backend at `claude-session-server.ts:4015-4053` uses `tmux send-keys -l`) — so this is EXTENDING an existing channel, not inventing a new one.

Deliver a complete end-to-end vertical: (a) additive backend `input` + `interrupt` handlers on the claude-session WS that mirror `terminal.ts:499`'s split-send semantics via `tmux send-keys`; (b) atomic frontend cutover of all four call sites in `Terminal.tsx` that currently read `webSocketRef.current` for pretty-view outbound writes.

## Out of Scope (explicit)

- **Terminal-mode compose-send.** Bare xterm.js tmux pane (`isPrettyMode=false`) keeps using the terminal SSH WS for keystrokes — that's what it's for. Only pretty-view compose-send migrates.
- **Fix A (WS keep-alive ping on terminal WS).** Explicitly considered and rejected as a standalone fix. May be a follow-up belt-and-suspenders for the terminal WS itself if terminal-mode users hit similar symptoms, but not part of this phase.
- **Fix B (auto-retry on submit-failed on the borrowed terminal WS).** Considered and rejected — hides errors and doesn't fix the borrow smell.
- **Empirical verification of tmux-send-keys-vs-raw-pty byte stream.** Ashley 2026-08-13 verbatim: *"I don't even think we need to verify anything empirically … as long as we're using the same method as we used on the old WebSocket in this sense, then that's good enough for me."* Verification is `npx vitest run` green + `npm run build:backend` green; no separate byte-stream comparison.
- **Moving MessageQueueDrawer into PrettyView's subtree.** Its mount stays where it is (`Terminal.tsx:3327`); only its `wsRef` source flips. Planner picks between drilling wsRef as a prop or passing a callback that closes over it.
- **Backend cutover / removal of terminal WS's existing `type:"input"` handler at `terminal.ts:499`.** Terminal mode still uses it. Both handlers coexist post-cutover — the terminal one for keystrokes typed in xterm.js, the pretty-view one for compose-box writes.
- **Race-window special cases.** If pretty-view WS is momentarily CONNECTING/CLOSED during a submit, the guard `if (!ws || ws.readyState !== 1) return false` returns false the same way today's borrowed-terminal-WS version does; existing frontend hook keeps the batch in staging for retry (see `handleInjectedTurnReady` comment at `Terminal.tsx:3211`). No new retry/queue logic invented in this phase.

</domain>

<decisions>
## Implementation Decisions (LOCKED — from user)

### Root cause is the BORROW, not the terminal WS dying

The terminal SSH WS's silent-death under network middleware IS a real thing, but "fix the terminal WS to not die" is a whack-a-mole path (Caddy timeouts, TCP keepalives, cellular NAT rebinds — every network layer has its own idle killer). The structural fix is to stop borrowing it: pretty-view should own its outbound writes because pretty-view already owns its inbound stream (the JSONL tail WS). Ashley 2026-08-13 verbatim on the framing: *"can't the PrettyView WebSocket just interact the same way as the Terminal WebSocket did for the Compose send?"* — yes, exactly. That's the whole phase.

### Backend approach — additive `type:"input"` + `type:"interrupt"` handlers on claude-session WS

Add two new message handlers to the `wss.on("connection", async (ws, req) => { ... })` block in `src/backend/claude-session/claude-session-server.ts` (the same block that already dispatches `raw_keystrokes` at `:4015`, `wake` at `:4063`, `aside_arm`, `aside_dismissed`, etc.):

**`type:"input"`** — mirrors the semantics of `terminal.ts:499`'s split-send gate but via tmux instead of raw pty write. Payload shape matches what the terminal WS accepts today:

```
{ type: "input", data: string, messageQueueItemId?: string }
```

Backend behavior:
1. Guard: `if (!sshConn || !currentTmuxSession) return;` (same posture as `raw_keystrokes` at `:4016`).
2. Payload validation: coerce `data` to string; reject if empty; cap at 16KB (mirror `MAX_RAW_KEYSTROKES_BYTES` at `:4025`) to keep parity with the existing safety cap.
3. Detect the split-send case: `data` ends in `\r` AND `messageQueueItemId` is a non-empty string. This is the pretty-view compose-send shape (single event with mqid + trailing \r) that `terminal.ts:499` splits today. On this shape:
   - Strip the trailing `\r` from data → `body`.
   - Fire `tmux send-keys -l -t <session> <body>` via `execCommand(sshConn, ...)`. `-l` = literal, so `body` bytes go through without tmux key-name interpretation. Preserves the existing raw_keystrokes shell-quoting posture (see `shellQuote` at `:4039`).
   - **Wait 250ms** (NOT 50ms — the value in `terminal.ts:842`'s live split-send is 250ms, patched up from 50ms by patch #111 after Ashley UAT confirmed 50ms was too short and messages arrived at Claude Code's composer but Enter didn't fire. Mirror the validated timing exactly.)
   - Fire `tmux send-keys -t <session> Enter`. NO `-l` — `Enter` is interpreted as the tmux key name for carriage return. This is the second half of the split-send.
4. Non-split case (no mqid OR data doesn't end in \r): fire one `tmux send-keys -l -t <session> <data>` call. Same shape as `raw_keystrokes` for non-plan-mode writes. This handles `handleInjectedTurnReady`'s two-event pattern (Terminal.tsx:3208 sends body then a separate `\r`+mqid event 60ms later) — each event is a non-split-case `input` frame; the 60ms gap already exists on the client side; the backend just forwards each one via tmux send-keys.
5. On execCommand failure: log-and-swallow (mirror raw_keystrokes' error posture at `:4041-4051`). Do NOT throw back to the client. The bubble stays mounted; user can retry via composebox.

**`type:"interrupt"`** — mirrors terminal WS's `case "interrupt"` handler (backend equivalent of `Terminal.tsx:3300 onInterrupt`, currently sends `type:"interrupt"` over the borrowed terminal WS). Payload shape:

```
{ type: "interrupt" }
```

Backend behavior:
1. Same guard as above.
2. Fire `tmux send-keys -t <session> C-c` via `execCommand(sshConn, ...)`. `C-c` is tmux's key name for Ctrl-C. This is what the terminal WS's interrupt handler does at the SSH level today — using tmux instead of raw pty write reaches the same pane program the same way.
3. On failure: log-and-swallow.

### Trust boundary — connection-scoped session, ignore client-supplied fields

Both new handlers reuse the trust boundary the pretty-view WS already established for `raw_keystrokes` (`:4010-4014`) and `wake` (`:4057-4062`): the target pane is derived exclusively from the connection-scoped `currentTmuxSession` (set at `connectToPane` discovery success). Any `hostId`, `tmuxSession`, or pane-identifying field the client sends in the `input`/`interrupt` payload is IGNORED. A client cannot spoof an input frame into a pane they don't own. This matches T-cd6-01 / T-14-02-01 verbatim.

### Frontend cutover — atomic swap of ALL four call sites

The migration is atomic — do NOT half-migrate (leaving one call site on `webSocketRef.current` reintroduces the whole bug on that path). Four call sites in `src/ui/features/terminal/Terminal.tsx` swap from `webSocketRef.current` (terminal SSH WS) → pretty-view's `wsRef.current` (claude-session WS):

1. **`onSend` at `:3261-3299`** — the pretty-view composebox send. Currently reads `webSocketRef.current`, sends `type:"input", data:text+"\r", messageQueueItemId:"pv-adhoc-<uuid>"`. Post-cutover: same payload shape, sent over pretty-view's WS. (New backend handler picks up the split-send behavior — same on-wire shape, different backend path.)
2. **`onInterrupt` at `:3300-3311`** — the safety-valve Ctrl-C (patch #120). Currently sends `type:"interrupt"` over the borrowed terminal WS. Post-cutover: sent over pretty-view's WS.
3. **`onInjectedTurnReady` at `:3208-3223`** — the message-queue fire path (Plan 02 hook batch-injection). Currently sends body event + 60ms-delayed `\r`+mqid event over the borrowed terminal WS. Post-cutover: same two-event pattern over pretty-view's WS. The 60ms setTimeout stays.
4. **`MessageQueueDrawer.onSend` at `:3331-3345`** — the queue-drawer send. Currently sends two events (patch #60 pattern: body, then 60ms-delayed `\r`+mqid) over the borrowed terminal WS. Post-cutover: over pretty-view's WS.

**MessageQueueDrawer's mount stays where it is.** MessageQueueDrawer is currently mounted at `Terminal.tsx:3327` as a sibling of PrettyView, not inside PrettyView's subtree. Moving it is out of scope. What flips is where its `onSend` callback reads the WS from — planner picks between (a) drilling `wsRef` down as a prop through PrettyView → Terminal (backward — awkward) OR (b) having PrettyView export a `sendInput(text: string, mqid?: string): boolean` callback via a prop (or context) that closes over its own `wsRef.current`, and MessageQueueDrawer's `onSend` calls THAT. Callback-with-closure is the cleaner shape (unidirectional data flow, no ref threading). Planner may also consider a small `usePrettyViewWsSender` custom hook if that reduces duplication across the four call sites.

### Verification collapses to tests-green

No separate byte-stream comparison plan. Ashley 2026-08-13 verbatim: *"as long as we're using the same method as we used on the old WebSocket in this sense, then that's good enough for me."* Verification per plan:
- **Plan 1 (backend):** unit tests for the new `input` + `interrupt` handlers in `claude-session-server.ts` (or a nearby test file — mirror the pattern used for `raw_keystrokes` and `wake` handler tests). Split-send behavior asserted via mock `execCommand` observing two send-keys calls with the 50ms gap between them. Non-split case asserts single send-keys call. Trust-boundary tests: client-supplied hostId/tmuxSession is IGNORED (mirror `raw_keystrokes` T-14-02-01 test).
- **Plan 2 (frontend cutover):** existing PrettyView test suite continues passing (`PrettyView.test.tsx`, `PrettyView.aside.test.tsx`, `PrettyView.phase29.test.tsx`, `PrettyView.virtualization.test.tsx`). Add tests covering: pretty-view compose-send writes to pretty-view's WS not terminal's; onInterrupt writes to pretty-view's WS; onInjectedTurnReady writes to pretty-view's WS; MessageQueueDrawer's onSend writes to pretty-view's WS.
- **Suite-wide:** `npx vitest run` exit 0 (currently 155 files / 2006 pass / 6 skipped / 1 todo / 0 fail); `npm run build:backend` exit 0.

### Deploy ordering — Phase 35 SHIPS FIRST

Phase 34 (voice-slash-server-side-skill-catalog) + quick 260813-0qx (deactivate-reactivate-during-reset-latches-inactive) are code-complete but HELD pending Phase 35 ship. Ashley 2026-08-13 verbatim: *"why don't you just save shipping the slash command stuff for after we do this new stuff next session."* When Phase 35 ships, the deploy batches all three (Phase 34 + quick 260813-0qx + Phase 35).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bounty (design source of truth)

- `~/.claude/roles/box-maintainer/bounties/terminal-ws-silent-death-on-session-return/bounty.json` — primary bounty, contains Ashley's original report + live diagnosis + design lock

### Frontend — Pretty-view WS + all four call sites to migrate

- `src/ui/features/pretty-view/PrettyView.tsx` — the pretty-view surface; owns `wsRef` at `:639`; already sends `wake` at `:542-548`, `raw_keystrokes` at `:564-584`, `aside_dismissed` at `:521-534`. All four post-cutover call sites will send through this WS.
- `src/ui/features/terminal/Terminal.tsx` — currently holds ALL four call sites that borrow the terminal SSH WS: `onInjectedTurnReady` at `:3208-3223`, `onSend` (pretty-view compose) at `:3261-3299`, `onInterrupt` at `:3300-3311`, `MessageQueueDrawer.onSend` at `:3331-3345`.
- `src/ui/features/pretty-view/MessageQueueDrawer.tsx` (or wherever MessageQueueDrawer lives — planner should confirm exact path via grep — currently rendered at `Terminal.tsx:3327` and receives an `onSend` prop; the component doesn't need to change internally, just what its parent passes as `onSend`).

### Backend — where to add the new handlers

- `src/backend/claude-session/claude-session-server.ts` — the WS server (port 30011) that pretty-view connects to. WS connection scope at `:1384 wss.on("connection", async (ws, req) => { ... })`. Message dispatch block near `:2836` onward (`identity:*` handlers), then `aside_arm` at `:3957`, `aside_dismissed` at `:3992`, `raw_keystrokes` at `:4015`, `wake` at `:4063`, `connectToPane` at `:4090`. New `input` + `interrupt` handlers slot in this dispatch chain (before the `connectToPane` fallback).
- `src/backend/terminal/terminal.ts` — the CURRENT split-send implementation at `:499` (terminal SSH WS side). READ THIS to mirror the split-send timing exactly (50ms gap between body write and `\r` write). Do NOT modify — terminal-mode keeps using it.

### Test patterns

- `src/backend/claude-session/claude-session-server.layer1.test.ts` — established test-file pattern for claude-session-server units. New backend handler tests should live in a peer file (planner picks name — perhaps `claude-session-server.compose-send.test.ts` or extend an existing test file if that fits the codebase convention).
- `src/ui/features/pretty-view/PrettyView.test.tsx`, `PrettyView.aside.test.tsx`, `PrettyView.phase29.test.tsx`, `PrettyView.virtualization.test.tsx` — established PrettyView test-file pattern. `PrettyView.aside.test.tsx` mocks the WS with `ws.send.mock.calls` assertions (`:203`, `:243`, etc.) — that shape is the reusable template for the four new call-site tests.

### Related patches (context)

- **patch #44** (`terminal.ts:499` split-send origin) — established the body-then-50ms-then-`\r` pattern because Ink races body-and-`\r` when they arrive as one write. Preserve this timing on the new backend path.
- **patch #60** (MessageQueueDrawer atomic mqid pattern) — established that MessageQueueDrawer sends body first then a delayed `\r`+mqid event so backend deletes the queue row atomically after both writes land.
- **patch #100** (backend split-send + isPrettyViewSubmit gate) — established the mqid-triggered split-send gate at the backend.
- **patch #110** (single-event pretty-view compose-send) — collapsed pretty-view's onSend from two events to one event with mqid+`\r` so backend split-send fires atomically instead of racing the client-side setTimeout.
- **patch #120** (`onInterrupt` safety-valve Ctrl-C) — established the `type:"interrupt"` frame on the terminal WS.
- **patch #148** (pretty-view WS auto-reconnect) — established the aggressive reconnect pattern that motivates this migration (borrowing terminal WS misses these guarantees).

</canonical_refs>

<specifics>
## Specific Ideas

### Backend handler shape — worked example

Slot into `claude-session-server.ts` after the `raw_keystrokes` handler (~L4053) and before the `wake` handler (~L4063), so the two "write into the pane" handlers sit adjacent:

```
if (msg.type === "input") {
  if (!sshConn || !currentTmuxSession) return;
  const data = String((msg as { data?: unknown }).data ?? "");
  if (data.length === 0) return;
  if (data.length > MAX_INPUT_BYTES) { /* log + return, mirror raw_keystrokes at :4026 */ }
  const mqid = String((msg as { messageQueueItemId?: unknown }).messageQueueItemId ?? "");
  const isSplitSend = mqid.length > 0 && data.endsWith("\r");
  try {
    if (isSplitSend) {
      const body = data.slice(0, -1);
      if (body.length > 0) {
        await execCommand(sshConn, `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(body)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 250));  // 250ms — matches terminal.ts:842 (patch #111 raised from 50ms)
      await execCommand(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} Enter`);
    } else {
      await execCommand(sshConn, `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(data)}`);
    }
  } catch (err) {
    sshLogger.warn("input send failed", { operation: "input_send_error", hostId: currentHostId, tmuxSession: currentTmuxSession, dataLength: data.length, error: err instanceof Error ? err.message : String(err) });
  }
  return;
}

if (msg.type === "interrupt") {
  if (!sshConn || !currentTmuxSession) return;
  try {
    await execCommand(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} C-c`);
  } catch (err) {
    sshLogger.warn("interrupt send failed", { operation: "interrupt_send_error", hostId: currentHostId, tmuxSession: currentTmuxSession, error: err instanceof Error ? err.message : String(err) });
  }
  return;
}
```

Notes:
- `MAX_INPUT_BYTES` cap: same 16KB as raw_keystrokes' cap; declare a peer constant `const MAX_INPUT_BYTES = 16 * 1024;` near `MAX_RAW_KEYSTROKES_BYTES` at `:4025`. Rationale: composebox submits can be pasted multi-KB text; 16KB is comfortably above any realistic composebox input and matches the raw_keystrokes cap for consistency.
- Empty-body split-send (mqid + bare `\r`): skip the body write, just send the Enter. Handles the edge case of an empty send that only wants to submit.
- Logging fields mirror raw_keystrokes' pattern verbatim — operation, hostId, tmuxSession, byte-length, error message.

### Frontend shape — callback pattern for MessageQueueDrawer

PrettyView exports a `sendInput(text: string, mqid?: string): boolean` callback closure (declared inside PrettyView's function body, closes over `wsRef.current`). Passes it as a prop to Terminal.tsx via one of these shapes (planner picks):
- New prop on PrettyView: `sendInputRef={sendInputRefFromParent}` — Terminal.tsx passes a `useRef<((text, mqid?) => boolean) | null>(null)` in via ref-forwarding style, PrettyView sets `sendInputRef.current = sendInput` in a mount effect, Terminal.tsx's MessageQueueDrawer.onSend reads `sendInputRef.current?.(text, mqid) ?? false`.
- Alt: Terminal.tsx renders MessageQueueDrawer INSIDE PrettyView instead of as a sibling — no ref threading needed, MQD closes over PrettyView's `wsRef` directly. This crosses the "MQD stays mounted where it is" line above — planner should evaluate whether the current mount is load-bearing (e.g., MQD needs to be visible when PrettyView is unmounted) before proposing this. Grep for MQD's visibility conditions.

Recommend the ref-forwarding shape as the safer default (preserves current mount structure).

### Existing invariants to preserve

- `handleInjectedTurnReady` at `Terminal.tsx:3208` sends body event FIRST, then a separate `\r`+mqid event 60ms later. This is the message-queue Plan 02 batch-injection path (patch #100 lineage). Post-cutover: same two-event pattern, over pretty-view's WS. Each event is a NON-split-case `input` frame on the new backend (no mqid on body event; mqid on second event but body is just `\r` alone — matches the split-send-with-empty-body edge case above).
- Compose-send at `Terminal.tsx:3288` uses a SINGLE event with `data:text+"\r", messageQueueItemId:"pv-adhoc-<uuid>"`. This IS the split-send case on the new backend (mqid present + trailing `\r`). Behavior preserved.
- MessageQueueDrawer.onSend at `Terminal.tsx:3331` sends TWO events (body, then 60ms later `\r`+mqid) — mirrors handleInjectedTurnReady's pattern for the same reason (backend deletes queue row atomically after both writes land). Post-cutover: same two-event pattern.

### Rebase risk

LOW. Fork-local files only:
- `src/ui/features/pretty-view/PrettyView.tsx` (fork-local)
- `src/ui/features/terminal/Terminal.tsx` (upstream Skynet file — but the touched region is fork-local: the pretty-view render block at `:3225-3345` doesn't exist on upstream Skynet; it was added by earlier pretty-view phases)
- `src/backend/claude-session/claude-session-server.ts` (fork-local — entire file added by Phase 1 of pretty-view)
- MessageQueueDrawer's file (likely fork-local — pretty-view-related; planner confirms via grep)
- Test files (fork-local)

No upstream Skynet surfaces touched.

</specifics>

<deferred>
## Deferred Ideas

- **Terminal WS keep-alive ping (Fix A).** Belt-and-suspenders for terminal-mode users hitting the same silent-death class. Not part of this phase. Ashley may raise it later if terminal-mode symptoms surface post-Phase-35.
- **Removing the terminal WS's `type:"input"` handler at `terminal.ts:499`.** Terminal-mode keystrokes still route through it. Both handlers coexist post-cutover.
- **Migration of any additional `webSocketRef.current` reads in `Terminal.tsx`** that aren't in the four-call-site list above. Grep confirms those four are the ONLY pretty-view-adjacent uses; the other `webSocketRef.current` references (see `:679`, `:713`, `:837`, `:842`, `:865-870`, `:904-905`, `:934-935`, `:968-969`, `:1009-1013`, `:1063-1094`, `:1273-1289`, `:1323-1324`, `:1481-1484`, `:1550-1758`, etc.) are terminal-mode plumbing: xterm.js data handlers, resize, cwd polling, focus routing, disconnect coordination. Those stay on the terminal WS.
- **Byte-stream comparison verification.** Explicitly rejected above by Ashley.
- **Renaming/consolidating the two send paths at the API level.** Post-cutover, `raw_keystrokes` and `input` are two very similar frames on the same WS. Consolidation could happen later but adds no value in this phase and risks disturbing Phase 24's plan-mode approval flow. Keep them separate.

</deferred>

---

*Phase: 35-pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow*
*Context gathered: 2026-08-13 via live orchestrator↔user design conversation*
