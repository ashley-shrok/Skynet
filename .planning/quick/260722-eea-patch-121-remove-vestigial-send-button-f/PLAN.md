---
title: "Patch #121 — remove vestigial send button from compose row"
task_id: 260722-eea
slug: patch-121-remove-vestigial-send-button-f
description: Rip the vestigial Send button + dead sendDisabled derived state out of ComposeBox — Enter (via patch #118) is the sole submit path Ashley uses.
created: 2026-07-22
status: planned
---

## Task Summary

Bounty #4 (`send-button-bigger`) re-scoped mid-session: the original ask was to grow the Send button to match textarea height, but on discussion Ashley realized she never clicks it — Enter is her sole submit path, made reliable by patch #118 (`tmux send-keys` hybrid). The button is vestigial from the pre-Phase-9 compose box. This patch rips it out along with its now-dead `sendDisabled` derived state, leaving the aux row clean: Paperclip / Square (stop, #120) / ThumbsUp / Hourglass.

## Files to modify

- `src/ui/features/pretty-view/ComposeBox.tsx` — pure trim. Import prune + JSX block delete + dead derived-state delete + one adjacent comment update.

## Detailed change list

1. **Line 2** — remove `Send` from the `lucide-react` import destructure. Keep alphabetization (`Hourglass, Paperclip, RefreshCw, RotateCcw, Square, ThumbsUp`).
2. **Lines 1304-1322** — delete the entire `<Button ... ><Send className="size-4" /></Button>` block. Preserves the enclosing `</div>` structure at line 1303/1323.
3. **Lines 789-792** — delete the `sendDisabled` derived-state const + its 2-line comment. Its only consumer was the deleted Button's `disabled={sendDisabled}`.
4. **Lines 794-798** — adjust the `queueDisabled` block comment: replace `mirrors sendDisabled's canSend gate` with `mirrors the canSend gate the removed Send button used` so the comment stays honest about what it references without leaving a dead cross-reference.

## Preserved (do NOT touch)

- `handleSend()` function — still the submit path, called by Enter (patch #118) and by the attachments flow.
- `onSend` prop — still the submit callback.
- `canSend` prop — still consumed by `queueDisabled` at line 800.
- `clearAfterSend`, `onSendWithAttachments`, all comment references to "Send" as an action concept.

## Verification steps

1. `cd ~/skynet && npx tsc --noEmit` — MUST be clean.
2. `grep -n "<Send " src/ui/features/pretty-view/ComposeBox.tsx` — should return NOTHING (no more JSX Send icon).
3. `grep -n "sendDisabled" src/ui/features/pretty-view/ComposeBox.tsx` — should return NOTHING.
4. `git diff --stat` — one file, net negative line count (~ -25 lines).

## Non-goals

- Do NOT change submit logic, Enter-key handling, or draft persistence.
- Do NOT touch the Square stop button (#120), Paperclip, ThumbsUp, Hourglass, or their flex layout.
- Do NOT deploy.

## Rebase risk

LOW. ComposeBox.tsx is fork-heavy (60+ patches through it) but this is a pure delete with no additive complexity. Rebase against upstream `main` will only conflict if upstream also touches the exact JSX region (unlikely — it's fork-only Phase-9 territory) or the exact import line (possible — upstream may add/remove other lucide icons). Both resolutions are trivial.
