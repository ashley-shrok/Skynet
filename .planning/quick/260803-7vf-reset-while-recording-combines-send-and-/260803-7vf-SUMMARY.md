---
phase: 260803-7vf-reset-while-recording
plan: 01
subsystem: compose-voice
tags: [compose, voice, reset, ux, ashley-bounty]
requires: []
provides:
  - fireResetSyncFx (synchronous UI-effect helper)
  - dispatchResetPayload (payload construction + dispatch helper)
  - handleVoiceResetSend (async recording-branch handler)
  - handleResetClick (voice.state-branching router)
affects:
  - meter-well reset button (onClick + disabled prop)
tech-stack:
  added: []
  patterns:
    - "sync-fx-before-await ordering (patch #122 latency guarantee)"
    - "recording-state gate mirroring send-button pattern"
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
decisions:
  - "STT failure never silent no-op — fall back to existing textarea body (locked #4)"
  - "Transcribing state disables reset button (locked #5, mirrors send-button pattern)"
  - "No new UI affordance — behavior-only change (locked #1)"
  - "fireResetSyncFx MUST run BEFORE await (patch #122 latency guarantee)"
metrics:
  duration: "~30 min"
  completed: "2026-08-03"
  tests_before: 12
  tests_after: 15
  tests_touched: 0 (existing tests untouched — additive only)
  files_modified: 2
requirements:
  - RESET-VOICE-01
---

# Quick 260803-7vf: Reset button while recording combines send-and-reset — Summary

Wired the meter-well reset button so clicking while `voice.state === "recording"`
combines send-while-recording (stop → transcribe → glue) with reset dispatch —
one click, one motion, one dispatch of `/id reset (glued)`.

## Ashley's Ask (2026-08-03 verbatim)

> "if you are recording and you hit the reset button, then it essentially combines
> the functionality of the send button when you're recording and the functionality
> of the reset button."

Bounty pinned: `reset-button-while-recording-combines-send-and-reset`.

## What Changed

### `src/ui/features/pretty-view/ComposeBox.tsx`

Refactored `handleResetSend` into three named helpers so the recording branch
can share the sync-fx block:

1. **`fireResetSyncFx()`** — extracted the synchronous UI effects from
   `handleResetSend` (lines 1225-1262 pre-refactor): `onResetClicked`,
   source-scoped cancel of primary armed source, `setErrorMessage(null)`,
   drain-sweep timer setup. Provenance comments (patch #122, Vehicle C v2,
   patch #83) relocated inside so intent stays with the code.

2. **`dispatchResetPayload(body: string)`** — extracted the payload
   construction + dispatch tail: `.trim()`, `collapseNewlinesForSend`, then
   `onSend("/id reset (…)")` or plain `/id reset` for empty body. On
   success: `setText("") + clearAfterSend()`. On dispatch failure:
   `setErrorMessage("Not connected — try again in a moment")`. Body
   parameter replaces the closed-over `text` variable so the recording
   branch can pass a glued transcript.

3. **`handleResetSend()`** — reduced to two calls: `fireResetSyncFx();
   dispatchResetPayload(text);`. Idle behavior is byte-identical to before
   (regression guard).

4. **`async function handleVoiceResetSend()`** — new. Calls
   `fireResetSyncFx()` SYNCHRONOUSLY first (load-bearing: patch #122
   latency guarantee — `SessionHoldingOverlay` must pop on click, not
   after the STT round-trip), captures `baseText = text` to avoid
   stale-closure surprises during the await, awaits
   `voice.endSend(baseText)`, then dispatches with
   `result ? result.glued : baseText`. STT-fail fallback per locked
   design decision #4.

5. **`handleResetClick()`** — new router. Branches on
   `voice.state === "recording"` and calls the appropriate handler.

6. **Reset button JSX** — `onClick={handleResetSend}` → `onClick={handleResetClick}`.
   `disabled` prop appended with `|| voice.state === "transcribing"`
   (locked design decision #5, mirrors send-button transcribing disable).

### `src/ui/features/pretty-view/ComposeBox.voice.test.tsx`

Three additive tests appended after Test 12:

- **Test 13** (glue+dispatch): text="hi there", fetch returns
  `{ text: "and one more thing" }`, click reset → asserts `onResetClicked`
  fired synchronously (before await) + `onSend` called with
  `"/id reset (hi there and one more thing)"` + textarea cleared.

- **Test 14** (STT-fail fallback): text="existing body", fetch returns 500,
  click reset → asserts `onResetClicked` fired synchronously + `onSend`
  called with `"/id reset (existing body)"` — the KEY assertion is that it
  is NOT `/id reset` alone and NOT a silent no-op.

- **Test 15** (transcribing disable): freeze fetch with never-resolving
  promise → click Send transcript → asserts reset button's `disabled === true`.

Existing tests 1-12 were not modified.

## Test Results

- Before this quick: 12 tests in `ComposeBox.voice.test.tsx` (all passing).
- After this quick: 15 tests, all passing.
- Broader `ComposeBox` test suite: 95/95 passing (5 test files) — regression-free
  refactor confirmed.
- `npx tsc --noEmit` — clean (no new type errors).

## Verification Log

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx
Test Files  1 passed (1)
Tests       15 passed (15)

$ npx vitest run src/ui/features/pretty-view/ComposeBox
Test Files  5 passed (5)
Tests       95 passed (95)
```

## Commits

- `5e34324` — `test(compose-260803-7vf): add failing tests for reset-while-recording combines send-and-reset` (RED — Tests 13 and 15 failing; Test 14 passing coincidentally because pre-refactor code already used textarea body regardless of voice.state).
- `ccd8658` — `feat(compose-260803-7vf): reset button while recording combines send-while-recording with reset` (GREEN — refactor + new behavior; all 15 tests pass).

## Deviations from Plan

None. Plan executed exactly as written. All locked design decisions honored:

- #1 — No new UI affordance on the reset button. Style/label/icon unchanged.
- #4 — STT failure never silent no-op. Fallback to existing textarea body.
- #5 — Transcribing state disables the reset button.
- Patch #122 latency guarantee — `fireResetSyncFx()` runs BEFORE the await
  in `handleVoiceResetSend`.

## Deployment Status

**HELD pending Ashley greenlight.** Fleet directive: code motion only —
no push, no `docker build`, no `docker compose up`. Ashley greenlights ship
separately.

## Self-Check: PASSED

- `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND (modified, committed in ccd8658)
- `src/ui/features/pretty-view/ComposeBox.voice.test.tsx` — FOUND (modified, committed in 5e34324)
- Commit `5e34324` — FOUND
- Commit `ccd8658` — FOUND
- All grep spot-checks in `<verification>` block pass:
  - `handleResetClick` present as onClick handler at ~line 1607 of ComposeBox.tsx
  - `voice.state === "transcribing"` present in reset button's disabled prop at ~line 1608
  - `handleVoiceResetSend` defined and referenced from handleResetClick
  - `fireResetSyncFx()` called inside both `handleResetSend` (line 1294) and `handleVoiceResetSend` (line 1306)
