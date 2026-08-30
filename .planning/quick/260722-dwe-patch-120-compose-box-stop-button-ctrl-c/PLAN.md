---
title: "Patch #120 — compose-box stop button (Ctrl-C into tmux)"
task_id: 260722-dwe
slug: patch-120-compose-box-stop-button-ctrl-c
description: >
  Add a Square-icon stop button to the pretty-view ComposeBox that sends
  Ctrl-C to the attached tmux session over a new WS `interrupt` message,
  mirroring patch #118's `tmux send-keys` + PTY-raw-byte fallback shape.
created: 2026-07-22
status: planned
---

## Task Summary

Add a safety-valve "stop" button next to the thumbs-up cluster in the
pretty-view ComposeBox that, on click, sends Ctrl-C into the attached tmux
session. Reuses patch #118's plumbing byte-for-byte: a new WS message type
`{ type: "interrupt" }` triggers `tmux send-keys -t <target> C-c` via the same
per-pane sshConn exec channel, with a raw `\x03`-to-PTY fallback when the
session is not tmux-attached or the exec errors. Additive only — new WS
branch, new prop, new button — no existing dispatch or button is touched.

## Files to modify

- `src/backend/ssh/terminal.ts` — add `case "interrupt"` WS handler; mirror
  patch #118's `tmux send-keys` (line 643) + fallback (lines 621-638) shape,
  sending `C-c` instead of `Enter`.
- `src/ui/features/pretty-view/ComposeBox.tsx` — import `Square` from
  lucide-react; add `onInterrupt?: () => void` to `ComposeBoxProps`;
  destructure it; render a new `<Button>` immediately BEFORE the ThumbsUp
  button (line 1089) inside the aux button group at lines 1058-1157.
- `src/ui/features/terminal/Terminal.tsx` — add an `onInterrupt` prop on
  the `<PrettyView>` render at line 2881; the callback fires
  `ws.send(JSON.stringify({ type: "interrupt" }))` guarded on `readyState`
  identically to `onSend` (line 2914).
- `src/ui/features/pretty-view/PrettyView.tsx` — add `onInterrupt?: () => void`
  to `PrettyViewProps` (near `onSend` at line 70), destructure it (near line
  117), and thread it into the `<ComposeBox>` render (line 738) as
  `onInterrupt={onInterrupt}`.

## Detailed change list

### 1. `src/backend/ssh/terminal.ts`

**Verified layout of the WS dispatcher:**

- Big `switch (parsed.type)`-style dispatcher in the WS `message` handler.
  Case sites already read (all verified):
  - `case "disconnect":` line 481
  - `case "get_cwd":` line 491
  - `case "input":` line 504 (patch #118's Enter fix lives here at line 643)
  - `case "upload_start":` line 760
  - `case "upload_chunk":` line 775
  - `case "upload_abort":` line 784
- `case "input":` ends its body at line 745 (matches the opening `{` on 504).
- Cases use lowercase-snake-case (`get_cwd`, `upload_start`) or lowercase
  single words (`input`, `resize`, `disconnect`). Convention for the new
  case: **`"interrupt"`** (single lowercase word — matches `input`,
  `resize`, `disconnect`).
- `shellQuote` is defined at line 123 (top-level in the module) — already in
  scope everywhere the switch runs.
- `sshLogger` is already imported and used in this file (see e.g. line 596).
- The reference exec block for `tmux send-keys ... Enter` is at line 643
  (inside the `setTimeout(() => { ... }, 250)` for the split-and-delay
  Enter). Its fallback via `fallbackToPtyCr` (line 591) writes `"\r"` to
  `inputStream` at line 607.
- The PTY-write API in scope for the pretty-view flow is
  `inputStream.write(...)` (see lines 514, 519, 607, 626, 685, 692). For
  the interrupt path we look up the stream the same way `case "input"`
  does at line 506: `sessionManager.getSession(currentSessionId)?.sshStream
  ?? sshStream`.

**Insertion point:** After `case "get_cwd": { ... } break; }` (line 502) and
before `case "input": {` (line 504). Rationale: keeps the "session
lifecycle / control" cases (`disconnect`, `get_cwd`, `interrupt`) grouped
above the data-plane cases (`input`, `upload_*`). If reviewer prefers,
alternative insertion right after `case "input"` closes at line 745 is
equally valid — no behavioral difference.

**Sketch of the new case (structural — implementer follows patch #118's
exec block at line 641-671 for the exact ssh2 exec/channel/close/error
callback shape):**

- Look up `session = sessionManager.getSession(currentSessionId)`; derive
  `tmuxTarget = session?.tmuxSessionName ?? null`, `submitConn =
  session?.sshConn ?? sshConn`, `interruptStream = session?.sshStream ??
  sshStream` — same pattern as lines 506-507 + 573-577.
- Define an inner `fallbackToRawByte(reason: string, err?: Error)` that:
  - Calls `sshLogger.info("Interrupt: falling back to raw Ctrl-C byte",
    { operation: "ssh_input_interrupt_raw_byte_fallback", userId,
    tmuxTarget, reason, error: err?.message })` — same log-field shape as
    the patch #118 fallback at line 596-605.
  - `try { interruptStream?.write("\x03"); } catch (writeErr) { sshLogger
    .error("Interrupt raw-byte write failed", ..., { operation:
    "ssh_input_interrupt_raw_byte", userId }); }` — same shape as line
    606-619.
- If `!submitConn || !tmuxTarget || !interruptStream`: call
  `fallbackToRawByte("no_tmux_target")` (or `"no_stream"` when the stream
  itself is missing) and `break`. If the stream is missing there is
  nothing to fall back to — log at `sshLogger.warn` and `break` cleanly.
- Otherwise call `submitConn.exec(\`tmux send-keys -t
  ${shellQuote(tmuxTarget)} C-c\`, (err, channel) => { ... })` — copy the
  callback body verbatim from lines 644-670, but:
  - Replace the fallback call from `fallbackToPtyCr(...)` to
    `fallbackToRawByte(...)`.
  - On the success/close branch, emit an INFO log
    `sshLogger.info("Interrupt: tmux send-keys C-c dispatched", {
    operation: "ssh_input_tmux_send_keys_interrupt", userId, tmuxTarget })`.
    Place it on the `channel.on("close", ...)` handler (line 654 in the
    reference), before the `channel.end()` cleanup, so it fires once per
    successful dispatch. Do NOT log on `data`/`stderr` events (tmux
    send-keys writes nothing on success).
  - Sync-throw catch wraps the whole `submitConn.exec(...)` — same as
    line 672 — and calls `fallbackToRawByte("exec_sync_throw", ...)`.
- NO `setTimeout` wrapper (unlike patch #118 which needed 250ms for
  Ink paste-detection). Ctrl-C is not subject to Ink's paste framing —
  it interrupts the entire tmux input pipeline regardless of framing
  state. Fire synchronously on message receipt.
- `break;` to exit the switch case.

**No changes to any existing case.** Patches #100, #111, #118, #60 remain
byte-identical.

**Log fields to match style:** existing sshLogger calls in this file use
`{ operation, userId, tmuxTarget?, reason?, error? }` — see lines 583-587,
596-605, 628-636. Match this shape exactly.

### 2. `src/ui/features/pretty-view/ComposeBox.tsx`

- **Line 2:** current import is
  `import { Hourglass, Paperclip, RefreshCw, RotateCcw, Send, ThumbsUp } from "lucide-react";`
  This IS alphabetized. Insert `Square` between `Send` and `ThumbsUp`:
  `import { Hourglass, Paperclip, RefreshCw, RotateCcw, Send, Square, ThumbsUp } from "lucide-react";`
- **In `ComposeBoxProps` (declared line 89):** add a new optional prop
  near `onSend` (line 97). Chosen slot: immediately after `onGoodToGo` at
  line 102, since Interrupt is semantically a compose-row control button
  peer of the ThumbsUp quick-send. Prop declaration:
  ```ts
  // Patch #120: optional interrupt callback. When provided, renders a
  // Square-icon "stop" button to the left of the ThumbsUp button that
  // sends Ctrl-C into the attached tmux session via a new WS
  // `interrupt` message (backend fires `tmux send-keys ... C-c`, with a
  // raw `\x03`-byte PTY fallback for non-tmux panes). When omitted the
  // button does not render — read-only PrettyView callers stay clean.
  onInterrupt?: () => void;
  ```
- **In the props destructure (currently lines 166-182):** add
  `onInterrupt,` on its own line, positioned near `onGoodToGo` (line 174)
  for symmetry with the prop declaration order.
- **JSX insertion — the aux button group (lines 1058-1157):** The order
  today is: Paperclip (1059, conditional on `showPaperclip`) → ThumbsUp
  (1089) → Hourglass/Queue (1120), closing `</div>` at 1158. Insert the
  Stop button immediately BEFORE the ThumbsUp button — i.e. between line
  1080 (`)}` closing the paperclip conditional) and the ThumbsUp comment
  block starting at line 1081.
  - Wrap the new button in `{onInterrupt && (...)}` so it does not render
    when the prop is absent (matches the `{showPaperclip && (...)}`
    pattern used one button up at line 1059).
  - Reuse the exact same className stack that ThumbsUp uses (lines
    1096-1105 — the warm-neutral Glass treatment). Rationale: Ashley
    approved "extra button next to the thumbs-up button" — visually
    grouping Stop with ThumbsUp under the same quiet Glass treatment
    makes them read as a peer pair rather than making Stop compete with
    Send's saturated amber (VISUAL-08 HARD LOCK — Send remains the sole
    attention grab-point). Stop is a rarely-used safety valve; quiet
    treatment is correct.
  - `size="icon-sm"`, `variant="outline"` — same as ThumbsUp.
  - `onClick={() => onInterrupt?.()}`.
  - `aria-label="Interrupt (send Ctrl-C)"`, `title="Interrupt (Ctrl-C)"`.
  - Icon: `<Square className="size-4" />` — same sizing as ThumbsUp's
    `<ThumbsUp className="size-4" />` at line 1107 and Send's
    `<Send className="size-4" />` at line 1284.
  - Do NOT gate on `canSend` — the stop button is a safety valve that
    must be available even if the WS is in a weird half-state. If the WS
    isn't ready the parent's `onInterrupt` callback silently no-ops
    (matches `onSend`'s posture at Terminal.tsx line 2914 which returns
    `false` on `readyState !== 1`).

### 3. `src/ui/features/terminal/Terminal.tsx`

- **At the `<PrettyView>` render (lines 2881-2927):** add a new prop
  `onInterrupt={...}` on the JSX element. Slot it immediately after the
  closing `}}` of the `onSend` arrow function at line 2924, before the
  `terminalWs={webSocketRef.current}` line at 2925.
- **Callback body** — mirror the `onSend` posture at line 2913-2914 for the
  readyState guard:
  ```ts
  onInterrupt={() => {
    // Patch #120 — safety-valve Ctrl-C. Uses the same per-pane SSH WS
    // the compose-box submit rides. Backend `case "interrupt"` fires
    // `tmux send-keys ... C-c` and falls back to a raw \x03 byte on
    // non-tmux panes / exec errors. Silent no-op on WS-not-ready:
    // if the WS is dead there is nothing to interrupt anyway.
    const ws = webSocketRef.current;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "interrupt" }));
  }}
  ```
- Do NOT add any state, no toast, no error UI. Ashley's spec: "either
  works or we find out on the batch deploy after #121/#122" — fire and
  forget matches the safety-valve framing.

### 4. `src/ui/features/pretty-view/PrettyView.tsx`

- **In `PrettyViewProps` (lines 62-93):** add
  `onInterrupt?: () => void;` immediately after the `onSend?: ...`
  declaration at line 70. Short comment tying it to patch #120 and
  ComposeBox's own `onInterrupt` prop is fine.
- **In the destructure (lines 112-121):** add `onInterrupt,` on its own
  line, positioned adjacent to `onSend,` (line 117) for symmetry.
- **In the `<ComposeBox>` render (lines 738-765):** add `onInterrupt={onInterrupt}`
  as a new prop line. Slot: immediately after `onGoodToGo={scrollToBottomAndFollow}`
  at line 746 (mirrors the ComposeBoxProps declaration order and keeps
  the "compose-row control callbacks" clustered together above the
  upload wiring block that starts at line 747).

## Verification steps

1. `cd ~/skynet && npx tsc --noEmit` — MUST be clean. This is the only
   pre-deploy gate. Types must compile end-to-end (new WS-message shape
   is untyped on the frontend side and the backend `parsed as { type }`
   already accepts any string, so no shared-type file needs a change).
2. `cd ~/skynet && git diff --stat` — should show exactly 4 files:
   `src/backend/ssh/terminal.ts`, `src/ui/features/pretty-view/ComposeBox.tsx`,
   `src/ui/features/pretty-view/PrettyView.tsx`,
   `src/ui/features/terminal/Terminal.tsx`. No test files, no config
   files, no lockfile changes.
3. `grep -n "interrupt\|Square" src/backend/ssh/terminal.ts src/ui/features/pretty-view/ComposeBox.tsx src/ui/features/pretty-view/PrettyView.tsx src/ui/features/terminal/Terminal.tsx`
   — verify all four sites match the plan:
   - `terminal.ts`: `case "interrupt":`,
     `ssh_input_tmux_send_keys_interrupt`,
     `ssh_input_interrupt_raw_byte_fallback`, one `C-c` string.
   - `ComposeBox.tsx`: `Square` in lucide import, `onInterrupt` in props
     interface + destructure + JSX click handler, one `<Square` element.
   - `PrettyView.tsx`: `onInterrupt` in props interface + destructure +
     `<ComposeBox>` prop pass-through.
   - `Terminal.tsx`: `onInterrupt={` on the `<PrettyView>` render, one
     `type: "interrupt"` string in the callback body.
4. **DO NOT test in the browser — no deploy this batch.** Runtime
   verification is deferred to the batch deploy after patches #121/#122.
   The button either works or Ashley UATs it post-deploy.

## Non-goals

- No confirm modal / are-you-sure dialog.
- No busy-state or isIdle-conditional visibility — button is always
  visible when the compose-box is rendered.
- No keyboard shortcut wiring (no Ctrl-C hotkey in the textarea, no
  global keybind).
- No changes to send / draft-persistence / message-queue / upload paths.
- No new HTTP endpoint — extends the existing per-pane SSH WebSocket.
- No `canSend` gating on the Stop button (safety valve must stay
  reachable even when Send is disabled).
- No toast / notification / error UI on interrupt-failure — mirrors
  COMPOSE-04 HARD LOCK "no ghost UI that lies about state."
- No shared TypeScript type for the new WS message payload (the
  frontend just serializes an inline object literal; the backend
  reads `parsed.type` as an untyped string, same as every other case).
- No changes to session lifecycle (`disconnect`, `attachedWs`,
  `sessionManager`, etc.).

## Rebase risk

**LOW-MEDIUM** — additive only, no touch to any existing dispatch branch
or existing button.

- `terminal.ts`: patch #118 (2026-07-22 today) just landed a big block in
  the `case "input"` region at lines 573-682. If upstream refactors the
  WS dispatcher shape (unlikely — this switch has been stable for many
  patches) the new `case "interrupt"` will need to be re-slotted, but the
  case body is self-contained and can move as one block. `shellQuote`
  (line 123) is fork-local and won't move.
- `ComposeBox.tsx`: has 60+ patches through it. The lucide import at
  line 2 is a common merge hotspot — adding `Square` between `Send` and
  `ThumbsUp` alphabetically is the lowest-conflict slot. The aux button
  group at lines 1058-1157 is patch-#84 / patch-#96 territory; the new
  button between the Paperclip conditional and the ThumbsUp button
  should merge cleanly as long as upstream doesn't restructure the group
  wrapper.
- `PrettyView.tsx`: props interface + destructure are additive; the
  `<ComposeBox>` render call at lines 738-765 has been stable through
  Phase 05.
- `Terminal.tsx`: the `<PrettyView>` render at lines 2881-2927 has
  patch #110's onSend arrow. Adding `onInterrupt` as a peer prop next to
  it is additive and low-conflict.

No changes to shared type definitions, no protocol version bump, no
migration.
