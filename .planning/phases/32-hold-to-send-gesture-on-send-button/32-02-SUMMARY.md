---
phase: 32-hold-to-send-gesture-on-send-button
plan: 02
subsystem: ui
tags: [react, pointer-events, voice-recording, gestures, css-animation, ios-safari, testing]

# Dependency graph
requires:
  - phase: 32
    plan: 01
    provides: "useHoldToRecord hook (Shape 1 optimistic-start + rollback, holdInitiatedRef, HOLD_THRESHOLD_MS); useVoiceRecording.cancel() race-safety (pendingCancelRef)"
provides:
  - "ComposeBox primary send button wired to useHoldToRecord — press-and-hold ≥250ms starts voice recording; release inside bounds sends transcript+typed glued via handleVoiceSend; release outside bounds cancels via voice.cancel; short-tap <250ms fires handleSend after awaited voice.cancel teardown (M-1); onClick preserved as `asideActive ? () => onAsideDismiss?.() : undefined` so short-tap-on-X still dismisses aside via native click event (B-2)"
  - "ComposeBox slot send button (inside QueuedRow subcomponent) wired to useHoldToRecord — symmetric with primary, slot-scoped callbacks; short-tap fires handleQueueSlotSend(slot.id); long-press fires handleVoiceSend(slot.id)"
  - "showRecordingControls at ComposeBox.tsx:1663 gated on !primaryHold.holdInitiatedRef.current so hold-initiated recording does NOT swap in RecordingControls under the pointer (B-3 primary variant)"
  - "showSlotRecording inside QueuedRow gated on !slotHold.holdInitiatedRef.current (B-3 slot variant)"
  - "slotSendDisabled shared local extracted from the 7-clause boolean previously inlined at the slot send button's disabled prop; used in both the JSX disabled prop and the useHoldToRecord disabled arg (M-2 fix — prevents silent drift)"
  - "CSS rule `button[data-hold-active=\"true\"]` in src/ui/index.css tints color to var(--color-pv-code-fg) coral and applies @keyframes pv-hold-pulse (1.4s ease-in-out infinite, opacity 1 → 0.6 → 1)"
  - "shortTapSendButton + withMediaDevicesStub test helpers established in ComposeBox.test.tsx for driving the pointer-gesture send path"
affects: [32-03, "any future ComposeBox visual regression tests", "any future test file that clicks the ComposeBox Send button"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Native onClick + hook pointer handlers coexistence on the same button element: when asideActive=true, the hook guards short-circuit pointerdown but the browser still synthesizes a click event from the valid pointerdown/pointerup pair — the preserved onClick consumes that click for aside-dismiss. When !asideActive, onClick is undefined and the hook's pointer handlers govern the short-tap-send exclusively (B-2 wiring shape)."
    - "showState = baseState && !holdInitiatedRef.current guard predicate: consumer reads a hook's MutableRefObject during render to gate a UI branch OFF during a hold-initiated recording. Ref (not state) so the ref write in pointerdown does not trigger a re-render, but the re-render triggered by voice.state → \"recording\" naturally re-evaluates the predicate and sees the ref already set to true (B-3 wiring shape)."
    - "Shared-local-extraction anti-drift pattern: when a JSX prop expression and a hook argument expression must stay in perfect sync, extract the expression into a named const above both use sites (M-2 wiring shape)."
    - "Post-morph currentColor tint pipeline: a CSS rule that only sets `color:` inherits into any child SVG with fill='currentColor' or lucide icon that inherits color — no per-child styling needed for the paper-plane paper-plane SVG at ComposeBox.tsx:2451-2458 or the Loader2 spinner at :2449."

key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.test.tsx
    - src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx
    - src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx
    - src/ui/index.css

key-decisions:
  - "Wired useHoldToRecord into ComposeBox using Option A restructuring per plan Task 1 Step 3 — moved the showRecordingControls line from L1603 to after the hook call so `primaryHold` is in scope; the base derivations (isPrimaryRecording, showTranscribingSend, sendDisabled) sit above the hook so its `disabled` arg can reference them."
  - "For the slot restructuring, applied the same Option A pattern to QueuedRow: extracted slotSendDisabled first, then instantiated slotHold, then redefined showSlotRecording and moved showSlotSend after showSlotRecording (order matters — showSlotSend = !showSlotRecording only makes sense after the gated showSlotRecording is defined)."
  - "Preserved the primary send button's onClick prop as `asideActive ? () => onAsideDismiss?.() : undefined` rather than deleting it — the browser synthesizes a click event on every valid pointerdown/pointerup pair, so when asideActive=true (hook inert) the preserved onClick still fires for the aside-dismiss short-tap. When !asideActive the onClick is undefined and the hook's pointer handlers govern the send path exclusively (B-2 wiring choice; alternative shapes considered and rejected in-plan)."
  - "Updated 7 pre-existing tests across 5 test files (Test 4 in aside-morph; D5/B5/R5/B5 in the 4 disable-state files; Test 7 + inside-textarea-Send + QS 4/5 in ComposeBox.test.tsx) that used `fireEvent.click(sendBtn)` to drive the enabled-send sanity check. The plan intentionally moves the send path from onClick-owned to hook-pointer-owned; these tests now drive a short-tap pointer sequence alongside a scoped navigator.mediaDevices stub. Introduced shortTapSendButton + withMediaDevicesStub helpers in ComposeBox.test.tsx to keep the pattern DRY across the 4 updates in that file."
  - "Kept the slot button's shape symmetric with the primary except no B-2 onClick preservation — the slot never renders as X (no aside-morph), so there is no aside-dismiss branch to preserve. Slot has 4 pointer handlers + data-hold-active + `disabled={slotSendDisabled}` only."
  - "Applied Task 3's CSS as append-only at the bottom of index.css, using button[data-hold-active=\"true\"] selector (button-scoped, not bare attribute) to guard against future data-hold-active collisions on non-button elements. Selected pv-hold-pulse (opacity 1 → 0.6 → 1) rather than a scale/brightness pulse because opacity does not compete with the existing .pv-btn-pressed scale:0.92 transform. Duration 1.4s matches plan's specifics § L119."

patterns-established:
  - "Preserved-native-onClick + hook-pointer-handlers coexistence pattern (B-2 shape) for buttons that need to serve both an aside-dismiss short-tap and a pointer-gesture send path from the same element."
  - "Ref-gated UI predicate (B-3 shape) for hooks that must not re-render on internal signal writes but must gate a render branch during their active window — expose a MutableRefObject; consumer reads it during render inside a predicate combined with a state that WILL trigger the re-render (voice.state)."
  - "shortTapSendButton test helper — drive the pointer-gesture short-tap in jsdom via fireEvent.pointerDown(t=0) → fireEvent.pointerUp(t=50) → 3 microtask flushes. Use alongside withMediaDevicesStub() around the test scope so useHoldToRecord's guarded voice.start does not crash on missing navigator.mediaDevices."

requirements-completed:
  - HOLD-SEND-06
  - HOLD-SEND-07
  - HOLD-SEND-08
  - HOLD-SEND-09
  - HOLD-SEND-10

# Metrics
duration: 90min
completed: 2026-08-13
---

# Phase 32 Plan 02: Wire useHoldToRecord into ComposeBox send buttons + hold-active CSS Summary

**Both primary and slot send buttons in ComposeBox.tsx are now wired to the useHoldToRecord hook from Plan 32-01 with symmetric behavior; primary preserves `onClick={asideActive ? () => onAsideDismiss?.() : undefined}` for aside-dismiss (B-2), showRecordingControls/showSlotRecording are gated on !holdInitiatedRef so hold-recordings do NOT swap in RecordingControls under the pointer (B-3), slot shares a single extracted `slotSendDisabled` local across JSX prop and hook arg (M-2), and a new `button[data-hold-active="true"]` CSS rule + @keyframes pv-hold-pulse tint the paper-plane coral during hold.**

## Performance

- **Duration:** ~90 min (started 2026-08-13T14:25:42Z, completed 2026-08-13T15:55:35Z)
- **Started:** 2026-08-13T14:25:42Z
- **Completed:** 2026-08-13T15:55:35Z
- **Tasks:** 3 (all atomic, task-per-commit)
- **Files created:** 0
- **Files modified:** 8 (1 production + 1 CSS + 6 test files — 5 test-file updates match the plan's deliberate behavior change from click-owned to hook-pointer-owned send)

## Accomplishments

- **Primary send button wired to useHoldToRecord** (ComposeBox.tsx:2404-2461). The button now carries four pointer-event handlers (`onPointerDown`, `onPointerUp`, `onPointerCancel`, `onPointerLeave`) from `primaryHold`, plus `data-hold-active={primaryHold.holdActive ? "true" : "false"}`. The B-2 aside-dismiss `onClick={asideActive ? () => onAsideDismiss?.() : undefined}` is preserved verbatim. `type="button"`, `disabled`, `aria-label`, `title`, and the entire `className cn(...)` block including asideActive-branched color are byte-identical to before.
- **Slot send button wired symmetrically** (ComposeBox.tsx:~2870 inside QueuedRow). Same 4 pointer-event handlers + data-hold-active, but no B-2 preservation because the slot never renders as X (no aside-morph branch). Its `disabled` prop is now the extracted `slotSendDisabled` local instead of the 7-clause inline boolean.
- **B-3 showRecordingControls gate** (ComposeBox.tsx:1663). Rewrote from `const showRecordingControls = isPrimaryRecording;` to `const showRecordingControls = isPrimaryRecording && !primaryHold.holdInitiatedRef.current;`. Restructured surrounding lines so `primaryHold` (defined by useHoldToRecord call) is in scope by the time `showRecordingControls` is derived. The mic-tap path leaves `holdInitiatedRef` false and retains its existing RecordingControls swap behavior.
- **B-3 showSlotRecording gate** (QueuedRow subcomponent). Same pattern applied inside QueuedRow: `const showSlotRecording = isSlotRecording && !slotHold.holdInitiatedRef.current;` with `showSlotSend = !showSlotRecording;` moved after it so the negation reads the gated value.
- **M-2 shared slotSendDisabled local** (QueuedRow). Extracted the 7-clause boolean (`showSlotTranscribingSend || slot.text.trim() === "" || slotArmed || recycleActive === true || planPendingActive === true || reconnectingActive === true || dormantActive === true`) into a single named const used in both the JSX `disabled={slotSendDisabled}` prop and the useHoldToRecord `disabled: slotSendDisabled` arg. Prevents silent drift.
- **Hold-active CSS** (src/ui/index.css tail). Added `button[data-hold-active="true"] { color: var(--color-pv-code-fg); animation: pv-hold-pulse 1.4s ease-in-out infinite; }` and `@keyframes pv-hold-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }`. Coral tint (`#ffb896`) matches the RecordingControls Send button color; selector is button-scoped to guard against future data-hold-active attribute collisions on non-button elements. The paper-plane SVG (`fill="currentColor"`) and Loader2 spinner both inherit the coral automatically.
- **7 pre-existing tests updated across 5 test files** (Rule 3 scope — directly caused by the plan's deliberate behavior change from onClick-owned to pointer-gesture-owned send path). Updated tests now drive `fireEvent.pointerDown → pointerUp` with `elapsedMs < 250ms` alongside a scoped `navigator.mediaDevices` stub. Introduced two DRY helpers in ComposeBox.test.tsx: `shortTapSendButton(btn)` and `withMediaDevicesStub()`. Test disabled-state assertions (which use `fireEvent.click` on disabled buttons and assert onSend was NOT called) survive intact — a disabled button in jsdom does not dispatch either click or pointer events.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: Wire useHoldToRecord into the primary send button + gate showRecordingControls** — `ee2c98f` (feat)
   - `src/ui/features/pretty-view/ComposeBox.tsx` — import useHoldToRecord; instantiate `primaryHold`; primary send button gets 4 pointer handlers + data-hold-active + B-2 preserved onClick; showRecordingControls gated on !primaryHold.holdInitiatedRef.current
   - `src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx` — Test 4 refactored from click-driven to short-tap-pointer-driven (with mediaDevices stub); Test 5 (aside-dismiss branch) unchanged and still passes via the preserved onClick
2. **Task 2: Wire useHoldToRecord into the slot send button + M-2 extract + B-3 slot gate** — `c54b6ea` (feat)
   - `src/ui/features/pretty-view/ComposeBox.tsx` — QueuedRow gets slotSendDisabled shared local + slotHold instantiation + gated showSlotRecording; slot send button loses onClick, gains 4 pointer handlers + data-hold-active + `disabled={slotSendDisabled}`
   - `src/ui/features/pretty-view/ComposeBox.test.tsx` — Test 7 (2 clicks), inside-textarea-Send COMPOSE-04 test, and QS 4/5 (queue slot send success/failure) updated to pointer-gesture short-tap; introduced shortTapSendButton + withMediaDevicesStub helpers at top of file
   - `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` — D5 baseline click-fires-onSend test updated to short-tap
   - `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` — B5 same update
   - `src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx` — R5 same update
   - `src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` — B5 same update
3. **Task 3: Add hold-active visual (data-hold-active CSS rule + @keyframes)** — `2b371d2` (style)
   - `src/ui/index.css` — append-only Phase 32 section at the file tail; no existing rule modified

**Plan metadata commit:** to follow this SUMMARY.md write + STATE.md/ROADMAP.md updates.

## Files Created/Modified

- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.tsx` (+68 lines net across 2 hunks) — Import useHoldToRecord; instantiate `primaryHold` after sendDisabled derivation; gate showRecordingControls (line 1663); rewrite primary send button props (line 2404-onwards) with preserved onClick + 4 pointer handlers + data-hold-active. QueuedRow subcomponent: extract slotSendDisabled; instantiate slotHold; gate showSlotRecording; rewrite slot send button props (~line 2870) with 4 pointer handlers + data-hold-active + shared disabled.
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.test.tsx` (+70 lines net) — Added shortTapSendButton + withMediaDevicesStub helpers; refactored 4 pre-existing send-click tests to pointer-gesture short-tap.
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx` (+27 lines) — Test 4 refactored.
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` (+28 lines) — D5 refactored.
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` (+28 lines) — B5 refactored.
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx` (+28 lines) — R5 refactored.
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` (+28 lines) — B5 refactored.
- **MODIFIED** `src/ui/index.css` (+36 lines, append-only) — Phase 32 section: `button[data-hold-active="true"]` rule + `@keyframes pv-hold-pulse`.

## Evidence

### grep-based plan verification

```
=== useHoldToRecord( count (expect 2) ===
2
=== data-hold-active= count (expect 2) ===
2
=== const slotSendDisabled count (expect 1) ===
1
=== holdInitiatedRef.current count (expect 2) ===
2
=== primary onClick asideActive pattern (B-2 preserved) ===
1
```

### Primary send button diff (only the changed attributes; className / disabled / aria-label / title / child render preserved verbatim)

Before:
```tsx
<button
  type="button"
  onClick={() => {
    if (asideActive) { onAsideDismiss?.(); return; }
    if (!sendDisabled) handleSend();
  }}
  disabled={asideActive ? false : (sendDisabled || showTranscribingSend)}
  ...
```

After:
```tsx
<button
  type="button"
  // B-2 (Phase 32): ...
  onClick={asideActive ? () => onAsideDismiss?.() : undefined}
  onPointerDown={primaryHold.onPointerDown}
  onPointerUp={primaryHold.onPointerUp}
  onPointerCancel={primaryHold.onPointerCancel}
  onPointerLeave={primaryHold.onPointerLeave}
  data-hold-active={primaryHold.holdActive ? "true" : "false"}
  disabled={asideActive ? false : (sendDisabled || showTranscribingSend)}
  ...
```

### Slot send button diff

Before:
```tsx
<button
  type="button"
  onClick={() => handleQueueSlotSend(slot.id)}
  disabled={
    showSlotTranscribingSend ||
    slot.text.trim() === "" ||
    slotArmed ||
    recycleActive === true ||
    planPendingActive === true ||
    reconnectingActive === true ||
    dormantActive === true
  }
  ...
```

After:
```tsx
<button
  type="button"
  onPointerDown={slotHold.onPointerDown}
  onPointerUp={slotHold.onPointerUp}
  onPointerCancel={slotHold.onPointerCancel}
  onPointerLeave={slotHold.onPointerLeave}
  data-hold-active={slotHold.holdActive ? "true" : "false"}
  disabled={slotSendDisabled}
  ...
```

### M-2 extraction (QueuedRow, after showSlotTranscribingSend)

```tsx
const slotSendDisabled =
  showSlotTranscribingSend ||
  slot.text.trim() === "" ||
  slotArmed ||
  recycleActive === true ||
  planPendingActive === true ||
  reconnectingActive === true ||
  dormantActive === true;
```

### B-3 predicate lines

- Primary (ComposeBox.tsx:1663):
  ```tsx
  const showRecordingControls = isPrimaryRecording && !primaryHold.holdInitiatedRef.current;
  ```
- Slot (QueuedRow, ~line 2688):
  ```tsx
  const showSlotRecording = isSlotRecording && !slotHold.holdInitiatedRef.current;
  ```

### CSS additions (src/ui/index.css tail)

```css
button[data-hold-active="true"] {
  color: var(--color-pv-code-fg);
  animation: pv-hold-pulse 1.4s ease-in-out infinite;
}

@keyframes pv-hold-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
```

### Verification results

- `npx tsc --noEmit`: exit 0
- `npm run build` (Vite): built in ~5s; no CSS parse errors; new @keyframes present in dist assets
- Focused smoke suite (ComposeBox.voice + ComposeBox.aside-morph + useHoldToRecord + useVoiceRecording): **63/63 pass** in isolation
- Updated ComposeBox tests (ComposeBox.test + 4 disable-state files): **87/87 pass** in isolation

### Full-suite result

See the "Issues Encountered" section below for the same pre-existing IdentityModal flake pattern documented in Plan 32-01's SUMMARY.

## Decisions Made

1. **Option A restructuring for both primary and slot predicates** — Per plan Task 1 Step 3 and Task 2 Step 4, hoisted the useHoldToRecord call to a position where its args are all in scope, then defined the gated show*Recording line AFTER the hook call. Cleaner than trying to compute an inline sendDisabled inside the hook call args (Option B).
2. **Preserved onClick on primary only** — Slot has no aside-morph branch (verified: `sed -n '2870,2900p' src/ui/features/pretty-view/ComposeBox.tsx | grep -c asideActive` returns 0), so no B-2 fix needed on the slot button. Kept the slot's shape lean.
3. **navigator.mediaDevices stub in updated tests** — Pattern lifted from ComposeBox.voice.test.tsx (Phase 16). getUserMedia returns a never-resolving Promise because the short-tap branch awaits voice.cancel() before the recording state ever materializes — the Plan 32-01 pendingCancelRef synchronous branch tears down the arriving stream (except there is no arriving stream since the promise never resolves), and voice.state stays "idle" throughout.
4. **shortTapSendButton + withMediaDevicesStub helpers in ComposeBox.test.tsx only** — 4 update sites in that one file justified the extraction; the single update sites in the 4 disable-state files kept the inline try/finally shape to preserve their existing structural style. If more send-click test updates land in Plan 32-03, the helpers can be lifted to a shared test util.
5. **Selector `button[data-hold-active="true"]` scoped to `button`** — Prevents future collisions if any other element grows a data-hold-active attribute. Matches the pattern already used elsewhere in index.css (`.pv-composebox button[...]`).
6. **CSS uses opacity pulse, not scale/brightness** — Opacity does not compete with the existing `.pv-btn-pressed` scale:0.92 transform (patch #181). Users pressing the send button briefly can trigger both classes in a small window; combining opacity + scale reads cleanly, whereas combining two conflicting transforms would need `!important` or a compositing decision.
7. **Task-3 patch-based commit** — Used `git apply --cached` with a filtered patch to stage ONLY the Task 3 additions to src/ui/index.css, leaving a pre-existing (unrelated) `.pv-speak-btn` modification unstaged in the working tree. That change was in the working tree before Plan 32-02 started and is not part of this plan's scope.

## Deviations from Plan

**1. [Rule 3 — Blocking-for-Acceptance] Updated 7 pre-existing tests to match the plan's deliberate behavior change from onClick-owned to hook-pointer-owned send**

- **Found during:** Task 1 verification (aside-morph Test 4) and Task 2 verification (dormant/plan-pending/reconnecting/recycle D5/B5/R5/B5 + ComposeBox.test.tsx Test 7 + inside-textarea-Send + QS 4/5).
- **Issue:** The plan actively removes `fireEvent.click(sendBtn)` as a path to `onSend` (primary send button's onClick prop is now `asideActive ? ... : undefined`). Pre-existing tests that used click to drive the enabled-send sanity check no longer trigger onSend. Additionally, the tests never mocked `navigator.mediaDevices` (which the new pointer path now touches through voice.start).
- **Fix:** Refactored each affected test to drive `fireEvent.pointerDown(sendBtn, {timeStamp: 0}) → fireEvent.pointerUp(sendBtn, {timeStamp: 50})` (elapsed < 250ms → short-tap branch) alongside a scoped `navigator.mediaDevices` stub with a never-resolving `getUserMedia` mock. Flushed three microtasks after pointerup so the awaited voice.cancel() → onShortTap dispatch settles. In ComposeBox.test.tsx (4 update sites), introduced `shortTapSendButton` + `withMediaDevicesStub` DRY helpers at the top of the file.
- **Files modified:** ComposeBox.aside-morph.test.tsx (Test 4), ComposeBox.dormant-disable.test.tsx (D5), ComposeBox.plan-pending-disable.test.tsx (B5), ComposeBox.reconnecting-disable.test.tsx (R5), ComposeBox.recycle-disable.test.tsx (B5), ComposeBox.test.tsx (Test 7 with 2 clicks, inside-textarea-Send COMPOSE-04, QS 4, QS 5).
- **Verification:** All 5 files pass in isolation (87/87 combined). The `disabled` state tests that use `fireEvent.click(btn)` on a disabled button and assert onSend was NOT called (ComposeBox.test.tsx L440-457) survive intact — jsdom does not dispatch events on disabled buttons.
- **Rationale (Rule 3 scope):** The failures are directly caused by the plan's declared behavior change. This is exactly the scenario Rule 3 covers: fix pre-existing tests that break due to the plan's own deliberate refactor. Non-scope-widening: only touched tests that clicked the ComposeBox Send button; no tests in other feature folders required updates.
- **Committed in:** `ee2c98f` (aside-morph Test 4 update) and `c54b6ea` (5 disable-state + ComposeBox.test.tsx updates).

**2. [Rule 3 — Blocking-for-Acceptance] Wrapped shortTapSendButton call in `act()` for COMPOSE-04 test**

- **Found during:** Task 2 verification (COMPOSE-04 "textarea cleared after send" test).
- **Issue:** After the pointer sequence + microtask flushes, the setText("") state update triggered by handleSend's success branch had not yet been committed to the DOM by the time the assertion `expect(textarea.value).toBe("")` ran — the assertion saw the pre-clear "hi there  ".
- **Fix:** Wrapped `await shortTapSendButton(...)` in `await act(async () => { ... })` so React commits the state update before the assertion.
- **Files modified:** ComposeBox.test.tsx COMPOSE-04 test.
- **Rationale:** Standard `act()` usage — the microtask flush advances the awaited promise chain, but the React commit phase still needs an explicit act to be observed on the DOM. Not a new pattern.
- **Committed in:** `c54b6ea` (same commit as the QS 4/5 update).

---

**Total deviations:** 2 (both Rule 3 test-scope updates directly caused by the plan's declared send-path refactor)
**Impact on plan:** None — production code is byte-identical to the plan spec; test updates are the minimum surface required to keep the pre-existing suite green under the new send-button wiring.

## Issues Encountered

**1. Pre-existing full-suite flakes (documented in Plan 32-01 SUMMARY L184-200).**

The full `npx vitest run` in the pretty-view folder reported 2 test files with 1 failure each — both in the same `IdentityModal` cluster documented in Plan 32-01's SUMMARY:

| Test File | Failing Test (this run) | Failing Test (32-01 SUMMARY) | Isolated Result |
|---|---|---|---|
| `src/ui/features/pretty-view/IdentityModal.test.tsx` | Test 1 (`edit-title happy path`) | Test 1 (`edit-title happy path`) | pass in isolation (14/14) |
| `src/ui/features/pretty-view/IdentityModal.voice.test.tsx` | Test 1 (`getVoices called exactly once on open`) | Test 5 (`Save with changed voice`) | pass in isolation (14/14) |

**Diagnosis:** Same pattern as Plan 32-01's SUMMARY — these tests time out under parallel-runner concurrency but complete well within the timeout in isolation. Confirmed by running both files in isolation: `npx vitest run src/ui/features/pretty-view/IdentityModal.test.tsx src/ui/features/pretty-view/IdentityModal.voice.test.tsx` → **14/14 pass**. Neither `IdentityModal.tsx` nor its test files intersect with any file this plan touched (ComposeBox.tsx, ComposeBox.*.test.tsx, index.css). The exact test in the voice file that flakes varies run-to-run (Test 1 this time, Test 5 in Plan 32-01's SUMMARY), matching the parallel-runner timeout characteristic.

**Action taken:** Flagged in this SUMMARY per fleet rule "if pre-existing failing tests in files you touch or their neighbors, either fix them or explicitly flag them in the plan SUMMARY.md as pre-existing." No code changes attempted — the flakes are outside plan scope. Recommend the same follow-up as Plan 32-01: quick task to raise per-test timeout in these 2 IdentityModal files (or convert them to `test.concurrent(false)`) if they continue to flake.

## Deferred Issues

**Fix-attempt-limit note:** Task 2 iteration hit multiple test breakages (Test 4 in aside-morph → D5/B5/R5/B5 in disable files → COMPOSE-04 clearing → QS 4/5 slot). Each was a distinct symptom of the same underlying plan-declared behavior change (send path moved from click-owned to hook-pointer-owned). Each fix used the same shape (pointer sequence + mediaDevices stub + microtask flush ± `act()`), and all were in-scope (Rule 3 — directly caused by the plan's own refactor). Total in-file fix attempts: 5 files, 7 tests. Under 3-per-file, so within limit.

**Pre-existing pv-speak-btn CSS change:** The `.pv-speak-btn` and `.pv-speak-btn svg` size/border-radius change (52px → 39px, 26px → 20px, radius 10 → 8) was present in the working tree BEFORE Plan 32-02 started (see the git status snapshot at conversation start). Plan 32-02 deliberately did not include it in the Task 3 commit — I used `git apply --cached` with a filtered patch to stage only my additions. That pre-existing change remains unstaged in the working tree; whoever put it there (a prior in-flight change) can commit it separately.

## Known Stubs

None — this plan wires real hooks to real send buttons; no placeholder data, no mock UI, no TODOs.

## User Setup Required

None — no external service configuration, no env vars, no dashboard steps. Frontend-only integration + CSS rule.

## Threat Flags

None — no new network endpoints, no new auth paths, no new file access patterns, no schema changes. Pure UI wiring inside ComposeBox + additive CSS.

## Self-Check

- **File `src/ui/features/pretty-view/ComposeBox.tsx` (import + primaryHold + slotHold + gated show*Recording + button wiring):** FOUND (grep confirms 2× useHoldToRecord calls, 2× data-hold-active, 2× holdInitiatedRef.current, 1× slotSendDisabled, 1× preserved B-2 onClick)
- **File `src/ui/features/pretty-view/ComposeBox.test.tsx` (helpers + 4 test updates):** FOUND
- **File `src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx` (Test 4 update):** FOUND
- **File `src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx` (D5 update):** FOUND
- **File `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` (B5 update):** FOUND
- **File `src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx` (R5 update):** FOUND
- **File `src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` (B5 update):** FOUND
- **File `src/ui/index.css` (button[data-hold-active=true] + @keyframes pv-hold-pulse):** FOUND (grep confirms both)
- **Commit `ee2c98f` (Task 1 feat):** FOUND in `git log`
- **Commit `c54b6ea` (Task 2 feat):** FOUND in `git log`
- **Commit `2b371d2` (Task 3 style):** FOUND in `git log`
- **`npx tsc --noEmit`:** exit 0
- **`npm run build` (Vite):** exit 0, ~5s
- **Focused smoke tests (63/63 in 4 core files):** PASSED
- **Updated ComposeBox test files (87/87 in 5 files):** PASSED

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 32-03 (ComposeBox integration tests for the hold gesture) is UNBLOCKED.** The production wiring is in place; the test-consumer shape is exercised in 7 of the pre-existing test-file updates (short-tap-pointer + mediaDevices stub pattern established). Plan 32-03 can add new integration-level tests covering:
  - Long-press (≥ 250ms) → voice.start → release inside bounds → handleVoiceSend called
  - Long-press → release outside bounds → voice.cancel called; textarea unchanged
  - Aside-morph inertness (asideActive=true blocks the hold, preserves aside-dismiss short-tap)
  - Disabled-state inertness (sendDisabled=true blocks the hold entirely)
  - showRecordingControls / showSlotRecording B-3 gate — during a hold-initiated recording, the button stays in place (RecordingControls do NOT swap in)
  - Both symmetric-primary and symmetric-slot cases
- Reusable test helpers `shortTapSendButton` and `withMediaDevicesStub` are already available in ComposeBox.test.tsx for Plan 32-03 to consume (or lift into a shared util if Plan 32-03 spans multiple test files).

---
*Phase: 32-hold-to-send-gesture-on-send-button*
*Plan: 02*
*Completed: 2026-08-13*
