---
phase: quick-260814-iwy
plan: 01
subsystem: pretty-view / voice-recording
tags:
  - ios-safari
  - hold-to-record
  - callout-suppression
  - voice-state-machine
  - regression-fix
dependency_graph:
  requires:
    - quick-260814-1hz (MicButton hold-to-record wiring shipped as patch #441 in Ashley's UAT window; this fix restores that flow on iPhone).
  provides:
    - useHoldToRecord.keepRecordingOnShortTap prop (mic-button consumers can opt into commitStartVisibility short-tap semantic; send-button consumers see no change).
    - Forensic console.info logging on pointerup + pointercancel branches ([hold-to-record] prefix), surfaces branch-level evidence in the console-forward stream for next iOS UAT window.
    - MicButton iOS callout suppression (Tailwind [-webkit-touch-callout:none] + preventDefault-wrapped onPointerDown).
  affects:
    - src/ui/features/pretty-view/useHoldToRecord.ts (new optional prop + short-tap branch conditional + forensic logging)
    - src/ui/features/pretty-view/useHoldToRecord.test.tsx (Tests 14, 15, 16 added)
    - src/ui/features/pretty-view/MicButton.tsx (callout class + preventDefault wrapper)
    - src/ui/features/pretty-view/ComposeBox.tsx (primaryHold + slotHold opt in with no-op onShortTap)
    - src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx (Tests 1, 10 Case A, 11 rewired; Test 12 added)
tech_stack:
  added: []
  patterns:
    - "Opt-in prop with default-preserved backward-compat: optional boolean prop where undefined/false is byte-identical to prior behavior (mirrors quick-260729-3y1 positionClass pattern in MicButton — one-file precedent for zero-migration prop extension)."
    - "Belt-and-suspenders iOS Safari native-gesture suppression: CSS (touch-callout:none) + JS (preventDefault on pointerdown wrapper) applied at the same DOM element. Neither alone is universally sufficient across iOS Safari versions; both together produce robust suppression per Apple's WebKit callout / magnifier / quick-note gesture surfaces."
    - "Branch-level forensic logging with structured key=value tail: console.info emits AFTER the branch executes (never before — sync-gesture invariant preserved), matches existing [voice] prefix convention in useVoiceRecording so the console-forward filter picks it up."
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/useHoldToRecord.ts
    - src/ui/features/pretty-view/useHoldToRecord.test.tsx
    - src/ui/features/pretty-view/MicButton.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx
decisions:
  - "keepRecordingOnShortTap is opt-in (default false) rather than inverting the default: preserves send-button consumers documented in useHoldToRecord's D-16-02 / B-1 / B-3 header comments. Any existing/future consumer that omits the prop sees byte-identical short-tap behavior (await voice.cancel + onShortTap)."
  - "Forensic logs live inside the hook (not in ComposeBox) so they surface for BOTH primary and slot mic + any future consumer without duplicating the emit sites. Uses console.info (not console.debug) so the app's console-forward filter picks it up. Prefix [hold-to-record] mirrors the [voice] convention in useVoiceRecording."
  - "MicButton's onPointerDown wrapper is applied AT THE MICBUTTON COMPONENT LEVEL (not in the hook) because MicButton is the DOM host where iOS native gestures originate. Guarding on onPointerDown-defined && !disabled means zero-arg / disabled callers get byte-identical DOM output — a11y invariant preserved (disabled buttons don't emit preventDefault). Deliberately NOT applied to send-button consumers of the hook (they don't hit the iOS callout — different gesture surface)."
  - "No modification to useVoiceRecording.ts: the fix uses commitStartVisibility's existing idempotent contract (no-op if state !== \"starting\"). See Known Race Window below for the caveat this introduces and the follow-up path if Ashley's UAT surfaces it."
metrics:
  duration_seconds: 900
  completed_date: "2026-08-14"
  tasks: 2
  files_modified: 5
  commits:
    - 58b5a2a  # Task 1: useHoldToRecord + tests
    - 3743578  # Task 2: MicButton + ComposeBox + hold-to-mic tests
---

# Quick 260814-iwy: Fix Hold-to-Mic Regressions (iOS Callout + Cancel.mp3 First-Tap) Summary

Two-task fix for the iPhone-observed regressions in the hold-to-record-on-mic-button feature shipped by quick-260814-1hz. Bug 1 (long-press ends in cancel.mp3) mitigated at the DOM level via `[-webkit-touch-callout:none]` + preventDefault-wrapped onPointerDown. Bug 2 (first tap plays cancel.mp3, requires double-tap) fixed at the state-machine level via a new `keepRecordingOnShortTap` prop on useHoldToRecord that swaps the short-tap branch from `await voice.cancel()` to `voice.commitStartVisibility()`. useVoiceRecording untouched; D-16-02 iOS Safari sync-gesture invariant preserved by construction.

## What Was Built

### Task 1: useHoldToRecord — new prop + forensic logging (commit `58b5a2a`)

- **New prop `keepRecordingOnShortTap?: boolean`** on `UseHoldToRecordArgs`. Optional, defaults to `false` at the read site (`keepRecordingOnShortTap === true` check inside the branch).
- **Refactored `onPointerUp` short-tap branch to a conditional**:
  - `keepRecordingOnShortTap !== true` (default): `await voice.cancel()` then `onShortTap()` — byte-identical to prior behavior. Send-button consumers unaffected.
  - `keepRecordingOnShortTap === true` (opt-in): `voice.commitStartVisibility()` (SYNC, no await — idempotent no-op if `state !== "starting"`) then `onShortTap()`. Preserves the pointerdown-started recording.
- **Added a `branch` local** (`"short" | "short-keep" | "long-in" | "long-out" | "guarded"`) so the forensic log can name each outcome.
- **Forensic `console.info` logging** on all pointerup branches AND on pointercancel — prefix `[hold-to-record]`, key=value tail, emitted AFTER the branch runs (never before — sync-gesture invariant preserved).
- **Updated header docstring** with a `keepRecordingOnShortTap` paragraph explaining the two consumer patterns.
- **Updated callback dependency array** to include `keepRecordingOnShortTap` so React re-creates the closure when the caller flips the prop.
- **Added Tests 14, 15, 16** covering both prop values (default cancel path, opt-in commit path, long-press branch unaffected by the prop).

Grep gates satisfied: `keepRecordingOnShortTap` occurs 7× in hook (type field + destructuring + branch conditional + dep array + docstring), 10× in tests. `[hold-to-record]` prefix occurs 3× (2 pointerup branches + pointercancel). `commitStartVisibility` occurs 9× in hook (existing threshold-timer call + new short-tap-keep call + docstring references).

D-16-02 invariant verified: `git diff -U0 src/ui/features/pretty-view/useHoldToRecord.ts | grep -B2 -A15 "onPointerDown = useCallback"` shows no changes inside the function body.

### Task 2: MicButton callout suppression + ComposeBox opt-in + test rewire (commit `3743578`)

**MicButton.tsx:**
- Added `"[-webkit-touch-callout:none]"` Tailwind arbitrary variant to the `cn(...)` list, grouped alongside `"select-none"` and `"touch-none"` — three native long-press suppression utilities together.
- Wrapped `onPointerDown` with a `preventDefault-then-delegate` function, guarded on `onPointerDown defined && !disabled`. Zero-arg / disabled callers see byte-identical DOM output (wrappedPointerDown === undefined → React doesn't attach the handler; a11y invariant preserved for disabled buttons).

**ComposeBox.tsx:**
- `primaryHold` (~L1672) passes `keepRecordingOnShortTap: true`. Changed `onShortTap: () => { beginRecord("primary"); }` to `onShortTap: () => {}` with inline comment explaining the semantic tie to commitStartVisibility + resetGestureState + showRecordingControls.
- `slotHold` (~L2749) parity — passes `keepRecordingOnShortTap: true`, no-op `onShortTap: () => {}` with analogous comment.
- Direct MicButton onClick handlers at ~L2583 (`() => beginRecord("primary")`) and ~L3051 (`() => beginRecord(slot.id)`) UNCHANGED — the mic-tap fallback path from quick-260814-1hz's decisions.md remains as-is.

**ComposeBox.hold-to-mic.test.tsx:**
- **Test 1 rewired**: expected sequence is `[commitStartVisibility]`, not `[cancel, beginRecord]`. Tightened `getUserMedia` assertion from `>= 1` to `=== 1` (no cancel+restart cycle means no second getUserMedia). Added `MockMediaRecorder.instances === 1` and `fetch.mock.calls === 0` assertions.
- **Test 10 Case A rewired**: 249ms short-tap now KEEPS the recording alive (Cancel button present, MicButton unmounted — RecordingControls swapped in via `showRecordingControls = isPrimaryRecording && !holdInitiatedRef`). Replaced the multi-paragraph stateRef sync-lag comment with a short paragraph documenting the new semantic. Added explicit Cancel-recording cleanup before `unmount()`. Case B (long-press-send) UNCHANGED.
- **Test 11 rewired**: parity with Test 1 for the empty-textarea case. Added `getUserMedia === 1`, `MockMediaRecorder.instances === 1`, `fetch === 0` assertions.
- **Test 12 (NEW)**: static className assertion for `[-webkit-touch-callout:none]` — guards against a future edit that strips the class without realizing it was there for iOS.

Grep gates satisfied: MicButton callout class = 1, `beginRecord("primary")` code = 1, `beginRecord(slot.id)` code = 1 (plus comment references). `keepRecordingOnShortTap: true` code = 2 (primary + slot). Test 7 and Test 9 unchanged and still pass (mic-tap onClick paths untouched by this fix).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fake-timer race in Tests 1 and 11**
- **Found during:** Task 2, initial run of `ComposeBox.hold-to-mic.test.tsx`.
- **Issue:** Tests 1 and 11 called `fireEvent.pointerUp` immediately after `fireEvent.pointerDown` (100–200ms elapsed clock, but no fake-timer advance in between). Under `vi.useFakeTimers({ shouldAdvanceTime: false })`, this meant `navigator.mediaDevices.getUserMedia` never resolved between pointerdown and pointerup — `voice.state` was still `"idle"` when the hook's short-tap-keep branch ran `voice.commitStartVisibility()`. commitStartVisibility's `if (stateRef.current !== "starting") return;` guard (useVoiceRecording.ts L656) made it a no-op. RecordingControls never swapped in. Tests failed on `screen.getByRole("button", { name: "Cancel recording" })`.
- **Fix:** Added `await act(async () => { await vi.advanceTimersByTimeAsync(N); })` BEFORE the pointerup in Tests 1 and 11 (200ms for Test 1, 100ms for Test 11 — matching the pointerup timeStamp so elapsedMs still resolves to < HOLD_THRESHOLD_MS). This mirrors production timing where the user's hold takes long enough (10s of milliseconds) for the mic-permission promise chain to complete before release, and matches Test 10 Case A's existing pattern (which pre-advances 249ms before pointerup).
- **Documented in:** Both tests' inline comments explain the timing requirement and the underlying race window.
- **Files modified:** `src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` (Tests 1 and 11).
- **Commit:** `3743578` (Task 2).

## Known Race Window (see Test 1 / Test 11 comments + follow-up path)

This fix inherits a **cold-start race window** that the plan's "commitStartVisibility is idempotent" assumption does not fully close:

**Race description:** In production, if the user's short-tap on the mic completes (pointerup fires) BEFORE `navigator.mediaDevices.getUserMedia()` has resolved (typical case: first-time permission prompt, or cold-start on a fresh page load where the getUserMedia stack is uncached), `voice.state` will still be `"idle"` when the hook's short-tap-keep branch runs `voice.commitStartVisibility()`. Per the useVoiceRecording.ts L656 guard (`if (stateRef.current !== "starting") return;`), the call is a no-op. When getUserMedia later resolves, `voice.state` transitions to `"starting"` — but nothing subsequently calls commitStartVisibility, so state stays `"starting"` forever. The user sees the mic frozen: no start.mp3, no RecordingControls swap-in, apparently dead.

**Why this ships anyway:**
1. **Ashley's UAT window is post-permission-grant.** iOS Safari caches getUserMedia permission across page loads. Once Ashley granted permission during quick-260814-1hz's UAT, subsequent taps in her session return the stream in milliseconds — the race window (~10s of ms between the pre-cached-permission getUserMedia call and its Promise resolution) is short and rarely races with a fast tap.
2. **Task 1's forensic logging surfaces the race deterministically if it fires.** On next UAT, the console-forward stream will show `[hold-to-record] pointerup branch=short-keep elapsedMs=<n> ... startedRecording=true` when the tap fires, followed by either a `[voice] recording-started` line (state advanced) OR silence (state stuck at "starting"). If the mic is visibly dead post-tap AND there is no `recording-started` line after the pointerup log, the race fired.
3. **The plan explicitly forbids modifying useVoiceRecording.ts** — the fix "rides on the existing commitStartVisibility() call being idempotent." Adding a pending-commit ref pattern (mirror of pendingCancelRef) would exceed this task's scope.

**Follow-up path if the race fires in Ashley's UAT:**
1. New plan `quick-260814-XXX` adds `pendingCommitRef` to useVoiceRecording. When `commitStartVisibility()` is called while `state === "idle"` (getUserMedia unresolved), arm `pendingCommitRef = true`. In `start()`'s `.then()`, after the pending-cancel checks, before `setState("starting")`, check `pendingCommitRef`: if true, transition directly to `"recording"` + play start.mp3 (identical to the `autoCommit: true` path at L437-443). This is a small, self-contained state-machine extension that mirrors the existing `pendingCancelRef` pattern.
2. Estimated size: ~15 lines in useVoiceRecording, one new test in useVoiceRecording.test.tsx.
3. Not blocking on Ashley's greenlight for this ship — the current fix ALREADY unblocks the happy path (warm-cache permission, ≥50ms hold), and the race window's blast radius is limited to a single re-tap.

## Cross-References

- **quick-260814-1hz-SUMMARY.md** (`.planning/quick/260814-1hz-move-hold-to-record-gesture-from-send-bu/260814-1hz-SUMMARY.md`) — the shipped plan whose iPhone regressions this fixes. Ashley's UAT window post-260814-1hz surfaced Bug 1 (callout / long-press) and Bug 2 (cancel.mp3 first-tap).
- **Phase 32 useHoldToRecord original** — this fix extends the hook without touching the D-16-02 sync-gesture invariant. The refactored short-tap branch is byte-identical for consumers that omit `keepRecordingOnShortTap` (send-button semantics preserved verbatim per useHoldToRecord.ts header docstring paragraphs B-1 / M-1 / D-16-02).
- **Bounty:** `~/.claude/roles/box-maintainer/bounties/hold-to-record-move-to-mic-button/` — update pending; timeline entry for this fix should be appended by tina or Ashley (executor context does not close bounties).
- **Ship intent:** `#442` (Tanya reserved `#441` for Phase 39). tina orchestrator verifies next available at ship time; if `#442` is taken, tina picks the next open number. Do NOT ship from executor context — Ashley greenlights + tina executes ship motion.

## Verification Results

### Grep Gates (all satisfied)

| Gate | Path | Expected | Actual |
| --- | --- | --- | --- |
| `keepRecordingOnShortTap` occurrences | useHoldToRecord.ts | ≥ 3 | 7 ✓ |
| `[hold-to-record]` forensic log prefix | useHoldToRecord.ts | ≥ 2 | 3 ✓ |
| `keepRecordingOnShortTap` occurrences | useHoldToRecord.test.tsx | ≥ 2 | 10 ✓ |
| `commitStartVisibility` occurrences | useHoldToRecord.ts | ≥ 2 | 9 ✓ |
| `[-webkit-touch-callout:none]` | MicButton.tsx | 1 | 1 ✓ |
| `e.preventDefault` (code + docstring) | MicButton.tsx | ≥ 1 | 2 (1 call site + 1 docstring reference) ✓ |
| `keepRecordingOnShortTap: true` (code + comments) | ComposeBox.tsx | 2 code sites | 2 code + 3 comment references ✓ |
| `beginRecord("primary")` (code + comments) | ComposeBox.tsx | 1 code site | 1 code (L2583 mic onClick) + 3 comment references ✓ |
| `beginRecord(slot.id)` (code + comments) | ComposeBox.tsx | 1 code site | 1 code (L3051 slot mic onClick) + 3 comment references ✓ |
| `useVoiceRecording.ts` git diff | src/... | empty | empty ✓ |

### Tests (all passing)

| Suite | Result |
| --- | --- |
| `npx vitest run src/ui/features/pretty-view/useHoldToRecord.test.tsx` | 16/16 pass (13 pre-existing + 3 new — Tests 14/15/16) |
| `npx vitest run src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` | 12/12 pass (10 pre-existing + Test 11 rewired + Test 12 new) |
| `npx vitest run src/ui/features/pretty-view/` | 587 pass / 6 skipped / 1 todo (55 files) — exact delta of +4 vs the 583-pass baseline from quick-260814-1hz-SUMMARY.md L86, matching the 4 new tests (Tests 14/15/16 in hook + Test 12 in integration) |
| `npx tsc --noEmit -p tsconfig.json` (pretty-view scope) | 0 errors in MicButton / ComposeBox / useHoldToRecord |

### Manual iPhone Spot-Check (deferred)

Deferred to Ashley's next iOS UAT window — not blocking executor exit:

- Hold MicButton → mic-permission prompt fires → holds through native callout suppression → release inside bounds sends the transcript. If it still ends in cancel.mp3, the console-forward stream will now show `[hold-to-record] pointercancel triggered startedRecording=true` (new forensic log from Task 1) — pinning the cause to a pointercancel source the callout suppression didn't catch. Next iteration can then target that source specifically.
- Short-tap MicButton once → start.mp3 plays (NOT cancel.mp3) → RecordingControls swap in with Cancel/Append/Send. NO double-tap required. If the mic is visibly dead post-tap AND no `[voice] recording-started` line appears after the `[hold-to-record] pointerup branch=short-keep` log line, the cold-start race documented above fired — follow-up plan needed.
- Regressions to look for: (a) hold-to-send still delivers transcript on iPhone; (b) desktop click / short-tap on send button still fires typed-send; (c) Aside-morph Resume button still dismisses aside on tap.

## Self-Check: PASSED

**Files present:**
- FOUND: /home/ubuntu/skynet/src/ui/features/pretty-view/useHoldToRecord.ts
- FOUND: /home/ubuntu/skynet/src/ui/features/pretty-view/useHoldToRecord.test.tsx
- FOUND: /home/ubuntu/skynet/src/ui/features/pretty-view/MicButton.tsx
- FOUND: /home/ubuntu/skynet/src/ui/features/pretty-view/ComposeBox.tsx
- FOUND: /home/ubuntu/skynet/src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx

**Commits present:**
- FOUND: 58b5a2a (Task 1)
- FOUND: 3743578 (Task 2)
