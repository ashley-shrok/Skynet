---
phase: 260802-uow-composebox-cluster
plan: 01
subsystem: pretty-view/ComposeBox
tags: [ui, composebox, voice-recording, arm-idle, spacing, quick-task]
requires: []
provides:
  - Per-textarea recording visibility predicates (isPrimaryRecording, isPrimaryTranscribing, isSlotTranscribing, isSlotActiveMic)
  - Per-target Loader2 spinner routing on send button (primary + each slot)
  - Conditional pr-32 padding for 3-button state (primary + slot textareas)
  - mb-[3px] on Row 1 + mb-1 on queue-slots wrapper for vertical spacing
affects:
  - src/ui/features/pretty-view/ComposeBox.tsx
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "Kept single useVoiceRecording() call site — D-16-02 iOS Safari getUserMedia synchronous-gesture lock forbids proliferating hook instances. Fix is entirely in visibility predicates + render branching."
  - "MicButton disabled prop uses `voice.state !== 'idle'` (blocks second concurrent recording) instead of the narrower `micTarget !== <this-source>` — matches Ashley's verbatim intent ('mic stays visible but disabled')."
  - "Slot Loader2 branch also flips the button's `disabled` to true during transcribing — mirrors primary T-16-16 rapid-tap mitigation."
  - "Row 1 bottom margin uses the arbitrary bracket `mb-[3px]` (not a Tailwind numeric class) to preserve Ashley's DevTools-measured 3px exactly."
metrics:
  duration_minutes: ~10
  completed_date: 2026-08-02
  tasks_completed: 3
  files_modified: 1
  tests_passing: 1064
  tests_skipped: 6
---

# Quick 260802-uow: ComposeBox Cluster (Scope Recording State) Summary

**One-liner:** Rewrote ComposeBox visibility predicates to scope recording state per-textarea (mic + send-when-idle survive sibling recording), routed the STT transcribing spinner to the correct target textarea, added conditional right padding for the 3-button layout, and tightened two vertical-spacing measurements — all in a single file, three atomic commits.

## What Was Built

### Task 1 — Scope recording visibility per-textarea (bounties 1+2) — commit `754484f`

Reworked the primary + slot predicate blocks in `ComposeBox.tsx`:

- **Primary block (~L1246-1272):**
  - Introduced `isPrimaryRecording` and `isPrimaryTranscribing` locals scoped by `micTarget === "primary"`.
  - `showMicButton` now gates on `!isPrimaryRecording && !isPrimaryTranscribing` (was `voice.state === "idle"`). Mic stays visible on the primary whenever the primary itself isn't the active mic target.
  - `showPrimaryArmButton` — removed the `voice.state === "idle"` gate entirely. Send-when-idle is orthogonal to recording elsewhere (Ashley: valid workflow).
  - `showRecordingControls = isPrimaryRecording` — semantic consolidation (previous `voice.state === "recording"` was fine at the render site because the guard `&& micTarget === "primary"` existed, but the predicate now reads correctly on its own).
  - `showTranscribingSend = isPrimaryTranscribing` — Bounty 2 fix. The Loader2 spinner on the primary's send button now only fires when the primary is transcribing, not when a slot is transcribing.
  - Primary `<MicButton>` at ~L2256 now receives `disabled={voice.state !== "idle"}` — visible but disabled when a slot records.

- **Slot block (~L1711-1772):**
  - Added `isSlotTranscribing` local scoped by `micTarget === slot.id`.
  - Replaced `isSlotIdle` (misnamed — meant "hook is idle" not "this slot is idle") with `isSlotActiveMic = isSlotRecording || isSlotTranscribing`.
  - `showSlotMic` gates on `!isSlotActiveMic` (was `isSlotIdle`).
  - `showSlotArmButton` — removed the `isSlotIdle` gate (parallel to primary).
  - Added `showSlotTranscribingSend = isSlotTranscribing`.
  - Slot `<MicButton>` at ~L1920 receives `disabled={voice.state !== "idle"}`.

- **Slot send-button render (~L1852-1908):**
  - Reshaped from a plain paper-plane render to a target-aware branch: when `showSlotTranscribingSend`, a `<Loader2 className="size-6 animate-spin" />` replaces the paper-plane svg AND the button's `disabled` includes `showSlotTranscribingSend` (parallel to primary T-16-16).
  - Otherwise the existing paper-plane render is preserved byte-for-byte.

- **Comment blocks** at ~L1220 and ~L1738 rewritten to reflect the new per-target semantics (previously said "voice is idle" — now says "primary/slot is NOT the active mic target").

### Task 2 — Conditional right padding for 3-button state (bounty 3) — commit `be67dea`

- Introduced `primaryThreeButtonState = showMicButton && showPrimaryArmButton` in the primary predicates block, and `slotThreeButtonState = showSlotMic && showSlotArmButton` in the slot predicates block.
- Added `primaryThreeButtonState && "pr-32"` to the primary Textarea's `cn(...)` classname (after the `pr-10` base). Same treatment for the slot Textarea with `slotThreeButtonState && "pr-32"`.
- tailwind-merge later-wins dedupes `pr-10` vs `pr-32` cleanly. 2-button states (send + mic OR send + arm-idle) keep the existing `pr-10`.
- Absolute positions of send (`right-1`), mic (`right-11`), and arm-idle (`right-21`) untouched — padding is the only lever that moves.

### Task 3 — Vertical spacing polish (bounty 4) — commit `9dec204`

- **Row 1 container (~L1406):** Added `mb-[3px]` (arbitrary bracket — not a Tailwind numeric class, per Ashley's DevTools-measured 3px). Combined with the outer `gap-1` (4px), total gap Row 1 → next block = 7px, regardless of whether the queued-slot stack is present.
- **Queue-slots wrapper (~L1727):** Added `mb-1` (4px). Combined with the outer `gap-1` (4px), total gap last-queued → primary = 8px — matches the `gap-2` inside the wrapper (queued↔queued spacing).

### Task 3 override: human-verify pause SKIPPED

Per the executor constraint override in the invocation, the `checkpoint:human-verify` pause in Task 3 was skipped. Both spacing edits were made in the same task and committed atomically (matching Task 1 and Task 2's pattern). No wait-for-approval step.

## Files Modified

- `src/ui/features/pretty-view/ComposeBox.tsx` (only file touched)
  - Task 1: +67 / -22 lines
  - Task 2: +20 / -0 lines
  - Task 3: +2 / -2 lines (whitespace-only in effective class strings)

## Files NOT Modified (by design)

- `src/ui/features/pretty-view/useVoiceRecording.ts` — untouched per plan (D-16-02 iOS Safari getUserMedia synchronous-gesture constraint must not be perturbed).
- `src/ui/features/pretty-view/MicButton.tsx` — already accepts `disabled?: boolean` (L27, L39, L47), no changes needed.

## Verification Results

- `npx tsc --noEmit`: clean (no output).
- `npx eslint src/ui/features/pretty-view/ComposeBox.tsx`: 0 errors, 5 pre-existing warnings (queueArmed unused, empty catch blocks, useCallback exhaustive-deps — all present pre-touch, none introduced by this task).
- `npx vitest run` (full suite): **88 test files passed, 1064 tests passing, 6 skipped**. No test failures.
- `npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx`: 12/12 pass.
- `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx`: 33/33 pass.

**No existing tests needed updating** — none of the ComposeBox tests asserted "mic hidden while recording elsewhere" (the old behavior). The suite already tolerated the new per-target semantics, likely because the tests focus on single-textarea flows and don't exercise sibling-textarea visibility.

## Deviations from Plan

None. Plan executed exactly as written for Tasks 1 and 2. Task 3's human-verify checkpoint was skipped per the invocation-time constraint override ("no UAT check-ins, silence is success"). Both spacing edits made, single atomic commit, no wait for approval.

## Grep Verification (done criteria)

```
$ grep -nE "isPrimaryRecording|isPrimaryTranscribing|isSlotTranscribing|showSlotTranscribingSend" src/ui/features/pretty-view/ComposeBox.tsx
1247:  //   MicButton and send button are both hidden. Gated on isPrimaryRecording
1257:  const isPrimaryRecording = voice.state === "recording" && micTarget === "primary";
1258:  const isPrimaryTranscribing = voice.state === "transcribing" && micTarget === "primary";
1262:    !isPrimaryRecording &&
1263:    !isPrimaryTranscribing &&
1271:  const showRecordingControls = isPrimaryRecording;
1272:  const showTranscribingSend = isPrimaryTranscribing;
1730:            const isSlotTranscribing = voice.state === "transcribing" && micTarget === slot.id;
1749:            // Quick 260802-uow bounty 2: showSlotTranscribingSend gates
1755:            const isSlotActiveMic = isSlotRecording || isSlotTranscribing;
1767:            const showSlotTranscribingSend = isSlotTranscribing;
1873:                          showSlotTranscribingSend ||
1896:                        {showSlotTranscribingSend ? (

$ grep -n "const isSlotIdle" src/ui/features/pretty-view/ComposeBox.tsx
(no matches — renamed to isSlotActiveMic)

$ grep -nE 'disabled=\{voice\.state !== "idle"\}' src/ui/features/pretty-view/ComposeBox.tsx
1920:                        disabled={voice.state !== "idle"}
2256:                disabled={voice.state !== "idle"}

$ grep -n "Loader2" src/ui/features/pretty-view/ComposeBox.tsx
2:import { CircleHelp, ListPlus, Loader2, Paperclip, RefreshCw, RotateCcw, RotateCwFadingClock, Square, ThumbsUp, X } from "lucide-react";
1744:            // the slot's Loader2 spinner render (parallel to the primary's
1877:                            Loader2 spinner — mirrors the primary's pattern
1882:                          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
2203:                    Loader2 spinner replaces the paper-plane for the STT
2207:                  <Loader2 className="size-6 animate-spin" aria-hidden="true" />

$ grep -nE "primaryThreeButtonState|slotThreeButtonState|pr-32" src/ui/features/pretty-view/ComposeBox.tsx
1276:  // arm-idle icons. Bump right padding to pr-32 (128px) only when the
1278:  const primaryThreeButtonState = showMicButton && showPrimaryArmButton;
1769:            // Quick 260802-uow bounty 3: mirror of primaryThreeButtonState
1772:            const slotThreeButtonState = showSlotMic && showSlotArmButton;
1803:                    // dedupes pr-10 vs pr-32.
1804:                    slotThreeButtonState && "pr-32",
2036:            // pr-10 vs pr-32. 2-button states keep pr-10.
2037:            primaryThreeButtonState && "pr-32",

$ grep -nE 'mb-\[3px\]|"flex flex-col gap-2 mb-1"' src/ui/features/pretty-view/ComposeBox.tsx
1406:      <div className={cn("flex items-center gap-2 mb-[3px]", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>
1727:        <div className="flex flex-col gap-2 mb-1">
```

## Commits

| Task | Commit    | Message |
|------|-----------|---------|
| 1    | `754484f` | fix(composebox): scope recording visibility per-textarea (bounties 1+2) |
| 2    | `be67dea` | fix(composebox): conditional right padding for 3-button state (bounty 3) |
| 3    | `9dec204` | fix(composebox): vertical spacing polish for row 1 and last-queued gap (bounty 4) |

## Success Criteria Checklist

- [x] All 4 bounties resolved per Ashley's verbatim descriptions.
- [x] Exactly 3 commits authored (one per task, atomic).
- [x] Only `src/ui/features/pretty-view/ComposeBox.tsx` modified.
- [x] `useVoiceRecording.ts` NOT modified (D-16-02 lock preserved).
- [x] No new component files.
- [x] Recording state remains a SINGLE hook instance (grep-confirmed L333, no other call sites in `src/ui/features/pretty-view/`).
- [x] Human verification skipped per invocation override — orchestrator handles fleet deploy verification asynchronously.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/ComposeBox.tsx` (modified across 3 commits)
- FOUND: `754484f` — Task 1 commit
- FOUND: `be67dea` — Task 2 commit
- FOUND: `9dec204` — Task 3 commit
- Typecheck clean
- Full test suite passing (1064 tests)
- No existing tests broken; no test updates required
