---
title: "Patch #121 — remove vestigial send button from compose row"
task_id: 260722-eea
slug: patch-121-remove-vestigial-send-button-f
status: complete
completed: 2026-07-22
code_commit: f452c2e
docs_commit: TBD
---

## What shipped

- **Removed `<Button><Send/></Button>` block** from `src/ui/features/pretty-view/ComposeBox.tsx` (former lines 1304-1322). The pretty-view compose aux row is now Paperclip / Square (stop, #120) / ThumbsUp / Hourglass — no submit button. Enter (via patch #118's `tmux send-keys Enter` hybrid) is the sole submit path.
- **Removed dead `sendDisabled` derived state** (former lines 789-792). Its only consumer was the deleted Button.
- **Removed `Send` from the lucide-react import** at line 2.
- **Updated the `queueDisabled` block comment** to reference "the canSend gate the removed Send button used" instead of the deleted `sendDisabled` var.
- **Preserved** `handleSend()`, `onSend`, `canSend`, `clearAfterSend`, `onSendWithAttachments`, and all conceptual "Send" comment references — those describe the submit ACTION, still very much alive.

## Verification

- `npx tsc --noEmit` — clean.
- `grep -n "<Send " src/ui/features/pretty-view/ComposeBox.tsx` — no matches.
- `grep -n "sendDisabled" src/ui/features/pretty-view/ComposeBox.tsx` — no matches.
- `git diff --stat` — single file, +4/-28.

## Deploy status

Not deployed. Batched with #118-#120 (+ upcoming #122 for meter-reset-no-segments-until-new-session). Ashley-gated batch deploy after all 5 bounties are code-complete.

## Bounty note

`send-button-bigger` (bounty #4) was re-scoped mid-session from "make it bigger" to "rip it out" after Ashley confirmed she uses Enter exclusively. Bounty closed done, not dropped — the underlying intent (compose row that reflects her actual workflow) landed, just via a different mechanism than the original title suggested.
