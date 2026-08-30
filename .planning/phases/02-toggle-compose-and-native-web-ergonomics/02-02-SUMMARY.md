---
phase: 02-toggle-compose-and-native-web-ergonomics
plan: "02"
subsystem: pretty-view
tags: [compose-box, split-send, websocket, pretty-view, phase-2]
dependency_graph:
  requires: [02-01]
  provides: [COMPOSE-01, COMPOSE-02, COMPOSE-03, COMPOSE-04, COMPOSE-05]
  affects:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/terminal/Terminal.tsx
tech_stack:
  added: []
  patterns:
    - controlled textarea with Enter/Shift-Enter semantics
    - split-send WS pattern (text + \r as two events 60ms apart)
    - optional prop gating for backward-compatible read-only mode
key_files:
  created:
    - src/ui/features/pretty-view/ComposeBox.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/terminal/Terminal.tsx
decisions:
  - "Newlines collapsed to spaces on send (D-50) — Ink safety; mirrors MessageQueueDrawer patch #39 behavior"
  - "onSend returns boolean; false triggers inline error + text preservation (D-56)"
  - "ComposeBox gated on status === streaming only (not connecting/inactive/error)"
  - "No optimistic display (COMPOSE-04 hard lock) — textarea cleared, nothing more"
  - "Split-send callback duplicated between PrettyView and MessageQueueDrawer per D-73 spirit — intentional, not drift"
  - "Plan verify command pattern mismatch documented (see Deviations)"
metrics:
  duration_seconds: 420
  completed_date: "2026-07-17"
  tasks_completed: 3
  files_modified: 3
---

# Phase 02 Plan 02: Compose Box + Split-Send Summary

Delivered the compose-and-send box that turns pretty mode from a read-only viewer into a real chat surface. Three files touched, three commits, COMPOSE-01 through COMPOSE-05 delivered.

## What Was Built

**COMPOSE-01**: A compose textarea appears directly below the conversation scroll region inside PrettyView, always present when the session is streaming. No separate panel, no modal, no drawer — inline at the bottom of the same flex column as the message list.

**COMPOSE-02 + COMPOSE-03**: Enter sends (preventDefault suppresses newline); Shift-Enter inserts a literal newline via browser default textarea behavior. Sends travel through the patch #40 split-send WebSocket path: text as one `{type:"input"}` event, then `\r` as a second `{type:"input"}` event 60ms later.

**COMPOSE-04** (hard lock): No optimistic display. On successful send, the textarea is cleared. The sent message appears in the conversation only when Phase 1's session-file tail JSONL confirms it through the separate claude-session WebSocket. No toast, no spinner, no ghost bubble anywhere in the new code.

**COMPOSE-05**: No custom paste handler. Browser default textarea paste behavior gives full readable content to the user. Because the send path uses WS `input` events (not terminal paste events), Claude Code's Ink REPL treats it as typed input — the "[pasted N lines]" collapse does not trigger.

**Send failure UX**: When `onSend` returns false (WS not ready), an inline `text-destructive` error surfaces below the textarea and the typed text is preserved for retry.

## Key Implementation Decisions

**ComposeBox is self-contained and independent** (per D-73 spirit): ~136 lines, no imports from MessageQueueDrawer. The queue drawer is a persisted queue-of-messages with CRUD; the compose box is an ephemeral single-message entry. Duplication of ~10 lines of shared patterns is cleaner than shared-component scope.

**Newlines collapsed to spaces on send** (D-50 policy): `trimmed.replace(/\r?\n/g, " ")` before calling onSend. This is the same proven behavior as the queue drawer (patch #39) and avoids Ink's REPL treating an embedded `\r` as a mid-message submit. Multi-line send-side preservation (option (b) in D-50) is a potential follow-up if Ashley later wants it — it would require either per-line chunking or bracketed-paste framing, each with tradeoffs.

**ComposeBox gated on `status === "streaming"` only**: Compose box does not appear during `connecting` (< 500ms typical, not worth the churn), `inactive` (FALLBACK-01 requires exactly one string), or `error` (WS is down). When `onSend` is omitted, PrettyView renders as a read-only viewer — backward-compat with any future call site that doesn't wire a WS.

**Split-send callback duplicated intentionally**: The `onSend` callback in PrettyView's mount site is byte-for-byte identical to the MessageQueueDrawer's `onSend` at lines 2834–2845. This is intentional per D-73 (two different surfaces, different structural roles). Any future patch that changes the split-send timing (e.g., a hypothetical patch #45) MUST update both call sites.

**Auto-grow textarea**: Rows computed as `Math.min(6, Math.max(2, text.split("\n").length))` — simple, no ResizeObserver, matches MessageQueueDrawer approach.

## Verification Evidence

Task 1 (ComposeBox):
- `export function ComposeBox` — present
- `onSend` prop present and called only in `handleSend`
- `!e.shiftKey` and `preventDefault` in `handleKeyDown` — present
- No `onPaste` handler in the file
- No `user-select` restrictions
- 136 lines (under 200-line target)
- `npx tsc --noEmit` — 0 errors on ComposeBox.tsx

Task 2 (PrettyView):
- `import { ComposeBox }` from `./ComposeBox` — present
- `onSend?: (text: string) => boolean` in PrettyViewProps — present
- `<ComposeBox` mount present, gated on `onSend && status === "streaming"`
- `no active Claude session` FALLBACK-01 render unchanged
- `npx tsc --noEmit` — 0 errors on PrettyView.tsx + ComposeBox.tsx

Task 3 (Terminal.tsx):
- `onSend={(text) =>` at the PrettyView mount site — present
- Split-send pattern: `ws.send(JSON.stringify({ type: "input", data: text }))` + `setTimeout` 60ms + `ws2.send(JSON.stringify({ type: "input", data: "\r" }))`
- MessageQueueDrawer onSend body at lines 2834–2845 — byte-for-byte unchanged
- No toast, spinner, or optimistic-bubble code added
- `npx tsc --noEmit` — 0 errors on Terminal.tsx + PrettyView.tsx + ComposeBox.tsx

## Deviations from Plan

**Plan verify command pattern mismatch (non-blocking, documentation only):**
The Task 3 verify command specifies `grep -c 'webSocketRef.current.send.*type.*input' src/ui/features/terminal/Terminal.tsx -ge 2` but the actual implementation (and the existing MessageQueueDrawer pattern being mirrored) assigns `webSocketRef.current` to a local `ws` variable and calls `ws.send(...)`. The pattern `webSocketRef.current.send` never appears in the onSend callbacks — only `ws.send` and `ws2.send` do. The grep would match only the existing line 760 (`webSocketRef.current.send(JSON.stringify({ type: "input", data }))`), not the two new callbacks. Implementation is correct; the verify command's regex assumption was wrong. Confirmed correct behavior by checking: `grep -c 'ws\.send(JSON\.stringify({ type: "input"' Terminal.tsx` = 3 (existing + PrettyView + MessageQueueDrawer).

## Known Stubs

None. All components wire to real state and real data sources:
- ComposeBox receives a live onSend callback from Terminal.tsx
- PrettyView's onSend prop is threaded from the real `webSocketRef.current`
- ComposeBox auto-focuses on mount; rows auto-grow from real text state

## Threat Flags

None. No new backend routes, no new auth paths, no schema changes. The compose send reuses the existing terminal WS input channel — same trust boundary as typing in the xterm terminal.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 458c520 | feat(pretty-view): compose textarea with Enter-sends / Shift-Enter-newlines |
| 2 | f41f564 | feat(pretty-view): mount ComposeBox in PrettyView when streaming |
| 3 | 96e9283 | feat(pretty-view): wire compose split-send through terminal WebSocket |

## Self-Check

### Files exist
- [x] `src/ui/features/pretty-view/ComposeBox.tsx` — created (136 lines)
- [x] `src/ui/features/pretty-view/PrettyView.tsx` — modified (+19 lines)
- [x] `src/ui/features/terminal/Terminal.tsx` — modified (+12 lines)

### Commits exist
- [x] 458c520 — Task 1 ComposeBox
- [x] f41f564 — Task 2 PrettyView mount
- [x] 96e9283 — Task 3 Terminal wiring
