---
title: "Patch #122 — meter reset session-holding overlay instant + zero-lock + red-bubble failure"
task_id: 260722-eqv
slug: patch-122-meter-reset-triggers-session-h
status: complete
completed: 2026-07-22
code_commit: 4bfa2e5
---

## Summary

Three coordinated fork-side polish mechanics on the existing Phase-3
session-recycling state machine (backend untouched) that close the
fifth of the five 2026-07-22 bounties. Frontend-only:

- **Immediate overlay trigger.** New `onResetClicked?` callback
  threaded from `PrettyView` through `ComposeBox` and fired
  synchronously at the top of `handleResetSend()` — BEFORE `/id reset`
  dispatches. Flips `PrettyView.isHolding=true` so patch #74's 350ms
  delay-arm timer starts NOW instead of on the backend's
  `session_holding` WS frame round-trip. Idempotent with the existing
  frame handler.
- **Meter zero-lock during holding.** New `isHolding?` prop on
  ComposeBox; adds `&& !isHolding` to the per-segment `isLit`
  conjunction so all 12 segments render unlit for the entire recycle
  window. Well glow, border, and reset-cell styling stay intact — only
  the per-segment lit branch flips off. Patch #83's 800ms cosmetic
  drain still animates on click, unmodified.
- **Red-bubble failure state.** New `holdingTimeoutError` state in
  PrettyView, threaded as `error?` prop to `SessionHoldingOverlay`.
  When true the overlay geometry is unchanged but RefreshCcw goes
  `text-[hsl(0,72%,60%)]` (reusing the fork's meter red-band palette),
  card gets a subtle warm-red inset glow, text swaps to "Session
  recycle failed — refresh to check", `aria-label` swaps too. Motion
  guardrail preserved (NO `animate-spin`). Two trigger paths wired:
  the backend's existing `inactive { reason: 'holding_timeout' }`
  frame AND a client-side 120s belt-and-suspenders `setTimeout` in a
  new `useEffect` (survives WS-drop cases). Dedicated cleanup
  `useEffect` resets the error state whenever `isHolding` clears via
  any path.

`case "inactive"` split by reason: the holding_timeout branch
deliberately does NOT `setStatus("inactive")` or `setIsHolding(false)`
— flipping to inactive would unmount the compose box and drop the
overlay's parent surface, leaking the "no active Claude session"
fallback instead of the red-bubble the failure demands.
`case "session_changed"` gets a paired `setHoldingTimeoutError(false)`
alongside the existing `setIsHolding(false)`.

## Files touched

- `src/ui/features/pretty-view/ComposeBox.tsx`
- `src/ui/features/pretty-view/PrettyView.tsx`
- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx`

## Verification

- `npx tsc --noEmit` — clean (EXIT=0).
- `git diff --stat` — exactly 3 files, +159 / -8 (code commit).
- No tests touched (additive optional props).
- Motion-channel guardrail preserved (no `animate-spin` anywhere in
  SessionHoldingOverlay, even in the error variant).
- Drain-sweep timing (#83) and 350ms delay-arm gate (#74) untouched.
- Payload sent by `/id reset` unchanged.

## Deploy status

NOT DEPLOYED. Batched with patches #118-#121 for a single deploy later
per Ashley 2026-07-22 batching directive. All five bounties are now
code-complete on `feat/tab-title-from-tmux` and ship together on the
next `docker compose up -d --force-recreate termix` behind the 15-min
deadman rollback.

## Commits

- **Code:** `4bfa2e5` — feat(compose): patch #122 — meter reset
  session-holding overlay instant + zero-lock + red-bubble failure
- **Docs:** _(this commit)_

## Deviations from plan

None. Executed as written; every insertion site + JSDoc + comment
paragraph landed on the lines the plan called out. `termix-patches.md`
outside the repo was updated with a full per-patch entry #122 matching
the `### Patch #N` header format established by patch #121, and the
top-of-file count marker was bumped ONE HUNDRED TWENTY-ONE → ONE
HUNDRED TWENTY-TWO.
