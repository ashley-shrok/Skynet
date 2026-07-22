---
title: "Patch #120 — compose-box stop button (Ctrl-C into tmux)"
task_id: 260722-dwe
slug: patch-120-compose-box-stop-button-ctrl-c
status: complete
completed: 2026-07-22
code_commit: 1bd0fd8
docs_commit: TBD
---

## What shipped

- **New WS message type `{ type: "interrupt" }`** — dispatched over the
  existing per-pane SSH WebSocket. Backend `case "interrupt":` in
  `src/backend/ssh/terminal.ts` calls `tmux send-keys -t <session> C-c`
  on the same multiplexed sshConn used by patch #118's pretty-view
  submit path. No new HTTP endpoint, no new module, no new lib, no new
  dep.
- **Fallback path**: when `session.tmuxSessionName` is null (non-tmux
  SSH pane) or the `submitConn.exec` errors, writes a raw `\x03` byte
  directly to the PTY via `interruptStream.write("\x03")`. No
  `setTimeout` wrapper (unlike patch #118) — Ctrl-C interrupts Ink's
  input pipeline regardless of paste-detection framing state.
- **Frontend Square-icon Button** in the ComposeBox aux button group,
  rendered inside a `{onInterrupt && (...)}` conditional immediately
  before the ThumbsUp button. Wears ThumbsUp's exact warm-neutral
  Glass className stack (VISUAL-08 HARD LOCK preserved — Send remains
  the sole saturated-amber attention grab-point). NOT gated on
  `canSend`.
- **Prop threading**: `Terminal.tsx` builds the actual WS-send callback
  (readyState-guarded identically to `onSend`); `PrettyView.tsx`
  threads `onInterrupt` through as a pass-through prop; `ComposeBox.tsx`
  renders the button.
- **Diagnostics**: two `sshLogger.info` events on the backend
  (`ssh_input_tmux_send_keys_interrupt` on success,
  `ssh_input_interrupt_raw_byte_fallback` on fallback) matching patch
  #118's log-field shape.

## Files touched

- `src/backend/ssh/terminal.ts` — new `case "interrupt":` block
  inserted between `case "get_cwd":` and `case "input":`.
- `src/ui/features/pretty-view/ComposeBox.tsx` — `Square` in lucide
  import; `onInterrupt?: () => void` prop + destructure; new
  conditional Button.
- `src/ui/features/pretty-view/PrettyView.tsx` — `onInterrupt?: () => void`
  in PrettyViewProps + destructure + pass-through to ComposeBox.
- `src/ui/features/terminal/Terminal.tsx` — new `onInterrupt={...}`
  prop on the `<PrettyView>` render.

## Verification

- `npx tsc --noEmit` — CLEAN (exit 0).
- `git diff --stat` (code commit) — 4 files, +174 / -1.
- All four sites grep-verified: `case "interrupt"` in backend,
  `onInterrupt` symbol threaded through all three frontend files,
  `Square` in both lucide import and JSX at ComposeBox.

## Deploy status

**NOT DEPLOYED.** Local commit only, batched with #118-#122 for a
single deploy later per Ashley 2026-07-22. Runtime verification
(Ctrl-C actually interrupts a live Claude Code run) deferred to
post-deploy UAT.

## Patches doc

`~/.claude/identities/tina/termix-patches.md` updated:
- Header patch count bumped `ONE HUNDRED NINETEEN` → `ONE HUNDRED TWENTY`.
- Full per-patch entry #120 added after #119, matching the style of
  #117/#118/#119 entries (motivating gap, fix summary, fallback,
  target discovery, files touched, rebase risk, diagnostic strategy,
  deploy status).

## Deviations from plan

None. Plan was executed exactly as written.
