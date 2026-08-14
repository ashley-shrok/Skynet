---
phase: quick-260814-iwy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/useHoldToRecord.ts
  - src/ui/features/pretty-view/useHoldToRecord.test.tsx
  - src/ui/features/pretty-view/MicButton.tsx
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx
autonomous: true
requirements:
  - QUICK-260814-iwy

must_haves:
  truths:
    - "iPhone long-press on the MicButton no longer terminates in cancel.mp3 with nothing sent — iOS Safari native long-press gestures (callout menu, magnifier, quick-note) can no longer preempt the pointer stream via the callout/selection UI. `[-webkit-touch-callout:none]` on the button + `e.preventDefault()` inside the wrapped onPointerDown suppress the native gesture surface; the useHoldToRecord chain runs to release-inside-bounds as designed."
    - "iPhone short-tap on the MicButton starts a recording on the FIRST tap — no cancel.mp3 preamble, no double-tap required. The hook's short-tap branch now skips `voice.cancel()` and instead calls `voice.commitStartVisibility()` when `keepRecordingOnShortTap: true`, so the recording that voice.start() kicked off in pointerdown advances `starting → recording` (playing start.mp3, not cancel.mp3) and stays live for the RecordingControls swap."
    - "MicButton consumers (primary + slot) pass `keepRecordingOnShortTap: true` and a no-op onShortTap; the recording that started in pointerdown is preserved through pointerup, and RecordingControls swaps in when resetGestureState clears holdInitiatedRef (making `showRecordingControls` — `isPrimaryRecording && !holdInitiatedRef` — evaluate true)."
    - "Existing send-button-hosted useHoldToRecord semantics (if any consumer ever passes `keepRecordingOnShortTap: false` or omits the prop) are BYTE-IDENTICAL to today: short-tap still calls `await voice.cancel()` then `onShortTap()`. The prop defaults to false; call sites that don't opt in see zero behavior change."
    - "D-16-02 iOS Safari sync-gesture invariant is preserved: `voice.start()` remains the first non-conditional statement after guards + `holdInitiatedRef.current = true` in `onPointerDown`. No await, no microtask, no reorder in pointerdown."
    - "Forensic logging: pointerup emits `[hold-to-record] pointerup branch=<short|long-in|long-out|guarded> elapsedMs=<n> withinBounds=<b> outOfBoundsRef=<b> startedRecording=<b>`; pointercancel emits `[hold-to-record] pointercancel triggered startedRecording=<b>`. Both log AFTER the branch decision — pointerdown's sync-gesture chain is untouched. Next iOS UAT window will have branch-level evidence in the console-forward stream if the callout suppression is insufficient."
    - "MicButton.tsx wrapping is guarded: `onPointerDown` is wrapped with `e.preventDefault()` ONLY when the caller passed an onPointerDown AND disabled !== true; zero-arg / disabled callers see byte-identical DOM output and no preventDefault side effect."
    - "useVoiceRecording.ts UNCHANGED — the voice state machine (idle/starting/recording/transcribing) and commitStartVisibility contract are locked; the fix rides on the existing commitStartVisibility() call being idempotent (it no-ops if state !== 'starting')."
  artifacts:
    - path: "src/ui/features/pretty-view/useHoldToRecord.ts"
      provides: "UseHoldToRecordArgs.keepRecordingOnShortTap?: boolean added (default false); short-tap branch conditional: cancel+onShortTap (default) OR commitStartVisibility+onShortTap (opt-in); forensic console.info in pointerup + pointercancel."
      contains: "keepRecordingOnShortTap"
    - path: "src/ui/features/pretty-view/useHoldToRecord.test.tsx"
      provides: "Two new test groups: (a) keepRecordingOnShortTap=false default preserves cancel+onShortTap; (b) keepRecordingOnShortTap=true fires commitStartVisibility (not cancel) then onShortTap."
      contains: "keepRecordingOnShortTap"
    - path: "src/ui/features/pretty-view/MicButton.tsx"
      provides: "`[-webkit-touch-callout:none]` Tailwind arbitrary variant on the button className; onPointerDown wrapped to call e.preventDefault() before delegating (guarded on onPointerDown defined && !disabled)."
      contains: "[-webkit-touch-callout:none]"
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "primaryHold + slotHold both pass keepRecordingOnShortTap: true; onShortTap callbacks are no-ops (removed beginRecord() calls); inline comments explain the semantic tie to commitStartVisibility + resetGestureState + showRecordingControls."
      contains: "keepRecordingOnShortTap: true"
    - path: "src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx"
      provides: "Short-tap tests rewired to expected sequence [voice.commitStartVisibility] (not [voice.cancel, beginRecord]); explicit voice.cancel call-count === 0 assertions on short-tap; new className presence assertion `[-webkit-touch-callout:none]`."
      contains: "commitStartVisibility"
  key_links:
    - from: "src/ui/features/pretty-view/useHoldToRecord.ts onPointerUp short-tap branch (~L311-320)"
      to: "voice.commitStartVisibility() when keepRecordingOnShortTap: true"
      via: "conditional inside the elapsedMs < threshold branch"
      pattern: "keepRecordingOnShortTap.*commitStartVisibility|commitStartVisibility.*keepRecordingOnShortTap"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx primaryHold (~L1672)"
      to: "useHoldToRecord({..., keepRecordingOnShortTap: true, onShortTap: () => {} })"
      via: "hook argument"
      pattern: "keepRecordingOnShortTap: true"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx slotHold (~L2749)"
      to: "useHoldToRecord({..., keepRecordingOnShortTap: true, onShortTap: () => {} })"
      via: "hook argument"
      pattern: "keepRecordingOnShortTap: true"
    - from: "src/ui/features/pretty-view/MicButton.tsx button className"
      to: "[-webkit-touch-callout:none] arbitrary variant"
      via: "cn(...) class list"
      pattern: "\\[-webkit-touch-callout:none\\]"
    - from: "src/ui/features/pretty-view/MicButton.tsx wrappedPointerDown"
      to: "e.preventDefault(); onPointerDown(e)"
      via: "wrapper function only when onPointerDown defined && !disabled"
      pattern: "e\\.preventDefault\\(\\)"
    - from: "useHoldToRecord.ts resetGestureState (short-tap branch tail, ~L334)"
      to: "showRecordingControls swap-in via holdInitiatedRef cleared"
      via: "ComposeBox.tsx L1735 showRecordingControls = isPrimaryRecording && !holdInitiatedRef"
      pattern: "resetGestureState"
---

<objective>
Fix two iPhone-observed regressions in the hold-to-record-on-mic-button feature shipped by quick-260814-1hz (Ashley's UAT surfaced them post-ship; sibling to Tanya's Phase 39 patch #441). No behavior change on desktop or on the send button — this is a mic-button-specific correctness fix.

Bug 1 — iOS long-press ends with cancel.mp3, nothing sent. Best-guess diagnosis (no direct log evidence — console-forward log has a gap during Ashley's UAT window, likely iOS PWA backgrounding losing the `[voice]` forwarded lines): iOS Safari native long-press gestures (callout menu, magnifier, "quick note") fire `pointercancel` on the MicButton mid-hold. The hook correctly routes `pointercancel → voice.cancel()` (useHoldToRecord.ts L339-359), so the mic goes hot then dies before pointerup ever fires. Fix: suppress the iOS callout via `[-webkit-touch-callout:none]` on the MicButton className (Tailwind arbitrary variant), and wrap `onPointerDown` with `e.preventDefault()` before delegating (belt-and-suspenders iOS gesture suppression). Add forensic logging so the next UAT window has branch-level evidence to distinguish "callout still fires" from "some other pointercancel source" if the fix is partial.

Bug 2 — iPhone first mic tap plays cancel.mp3 and needs a second tap. Deterministic diagnosis from useHoldToRecord.ts:311-320: short-tap branch always calls `await voice.cancel()` then `onShortTap()`. On the mic button `onShortTap = beginRecord("primary")` post-260814-1hz. So every short tap: pointerdown → voice.start() → pointerup < 250ms → `voice.cancel()` (audibly plays cancel.mp3 as the just-started recording tears down) → `beginRecord("primary")` (attempts a fresh start that races with mid-cleanup — Ashley reports the second tap succeeds where the first one didn't). Fix: add `keepRecordingOnShortTap?: boolean` prop to the hook; when true, the short-tap branch calls `voice.commitStartVisibility()` (advances the in-flight "starting" state to "recording", plays start.mp3) INSTEAD OF `voice.cancel()`; `onShortTap()` still fires after the state commit but consumers pass a no-op (voice is already recording from pointerdown, no beginRecord needed). `resetGestureState` at the tail of the branch clears `holdInitiatedRef`, which makes `showRecordingControls` (ComposeBox.tsx L1735) evaluate true — RecordingControls swap in.

Purpose: restore Ashley's mic-hold + mic-tap flows on her iPhone (Option B: BOTH short-tap opens RecordingControls AND long-press records-while-held). Ship as `#442` after tina orchestrator confirms next available.

Output:
- `useHoldToRecord.ts` extended with `keepRecordingOnShortTap` prop + forensic logging (pointerup + pointercancel).
- `useHoldToRecord.test.tsx` extended with two new test groups covering both prop values.
- `MicButton.tsx` extended with callout-suppression class + wrapped-onPointerDown preventDefault.
- `ComposeBox.tsx` primaryHold + slotHold pass `keepRecordingOnShortTap: true` and no-op onShortTap.
- `ComposeBox.hold-to-mic.test.tsx` short-tap tests rewired: expected sequence is `[voice.commitStartVisibility]`, NOT `[voice.cancel, beginRecord]`; new className assertion for `[-webkit-touch-callout:none]`.

Invariants preserved (LOCKED — do not violate):
- D-16-02 iOS Safari sync-gesture chain: `voice.start()` is the first non-conditional statement after guards + `holdInitiatedRef.current = true` write in `onPointerDown`. No await/microtask inserted before it.
- `useVoiceRecording.ts` UNCHANGED — voice state machine stays as-is.
- MicButton visibility gate from quick-260814-1hz Task 3 (`showMicButton` disjunct with `holdInitiatedRef.current`) UNCHANGED.
- Existing consumers that omit `keepRecordingOnShortTap` see byte-identical behavior (default: false).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/ui/features/pretty-view/useHoldToRecord.ts
@src/ui/features/pretty-view/MicButton.tsx

Read-first source files (targeted Reads only — do NOT open in full unless necessary):
- `src/ui/features/pretty-view/useHoldToRecord.test.tsx` (573 lines) — study the existing test pattern (makeMockVoice, TestConsumer, installBoundsShim, Test 5 for the awaited-cancel short-tap contract, Test 11 for commitStartVisibility-NOT-called-on-short-tap contract) before authoring the two new test groups.
- `src/ui/features/pretty-view/ComposeBox.tsx` (3051 lines) — use offset/limit around L1672 (primaryHold) and L2749 (slotHold). Two small edits (add one property, replace the onShortTap body); do NOT touch surrounding predicates or the visibility gates that quick-260814-1hz landed.
- `src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` (1014 lines) — Test 1 (L208), Test 10 Case A (L806), Test 11 (L952) are the short-tap tests to rewire. Test 7 (L596) uses fireEvent.click on the mic, not a pointer sequence, so its semantic is orthogonal — read but do NOT rewire.
- `src/ui/features/pretty-view/useVoiceRecording.ts` (663 lines) — reference-only for the commitStartVisibility signature at L655-660 (`if (stateRef.current !== "starting") return; setState("recording"); ...; playSound(startAudioRef.current);`). Idempotent no-op if state !== "starting" — the safety net that makes it safe to call from the short-tap branch even if the sync-gesture chain was interrupted by a guard.

Anchor lines to load with Read offset/limit before editing:
- useHoldToRecord.ts L91-116 (UseHoldToRecordArgs), L152-155 (destructuring in hook body), L271-337 (onPointerUp body — where the new branch conditional lands), L339-359 (onPointerCancel body — where the forensic log lands).
- useHoldToRecord.test.tsx L37-61 (makeMockVoice + makeArgs helpers — extended in Task 2), L138-197 (guard tests — patterns to mirror), L458-573 (Tests 11-13 for commitStartVisibility assertion patterns to mirror).
- MicButton.tsx L54-96 (destructuring + JSX button + className list).
- ComposeBox.tsx L1670-1691 (primaryHold construction), L2749-2763 (slotHold construction).
- ComposeBox.hold-to-mic.test.tsx L208-285 (Test 1 body), L789-950 (Test 10 body), L952-1013 (Test 11 body).

Context on quick-260814-1hz's B-3 gate (unchanged, referenced by this fix): `showRecordingControls = isPrimaryRecording && !primaryHold.holdInitiatedRef.current` (ComposeBox.tsx L1735). Under the new short-tap semantic, `resetGestureState` still runs at the tail of the short-tap branch and clears `holdInitiatedRef.current = false`. That transition — combined with voice.state already being "recording" from the commitStartVisibility call — makes `showRecordingControls` evaluate true on the next render, which swaps the mic button out for the Cancel/Append/Send controls. This is the mechanism by which "short tap opens RecordingControls" is preserved end-to-end without needing to call beginRecord() again.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: useHoldToRecord — add keepRecordingOnShortTap prop, wire commitStartVisibility short-tap alternate branch, add forensic logging (pointerup + pointercancel); extend tests to cover both prop values</name>
  <files>src/ui/features/pretty-view/useHoldToRecord.ts, src/ui/features/pretty-view/useHoldToRecord.test.tsx</files>
  <behavior>
    - `UseHoldToRecordArgs` gains an optional field: `keepRecordingOnShortTap?: boolean` (default `false` at the read site — do NOT set a default via `?:` in the type, keep the type optional and read `args.keepRecordingOnShortTap === true` at the call site so `undefined` and `false` both resolve to the default cancel+onShortTap branch).
    - Hook body destructures `keepRecordingOnShortTap` alongside the other args (add it to the destructuring on line ~155). It participates in the `onPointerUp` closure — the callback dependency array MUST list `keepRecordingOnShortTap` alongside the existing deps (voice, onShortTap, onLongPressSend, effectiveThreshold, resetGestureState) so React re-creates the closure when the caller flips the prop.
    - `onPointerUp` short-tap branch (currently useHoldToRecord.ts L311-320) is refactored to a conditional:
        * DEFAULT (`keepRecordingOnShortTap !== true`, matching today's behavior): `await voice.cancel()` then `onShortTap()`. Byte-identical to current logic for any consumer that omits the prop or passes `false`. This preserves the send-button consumers described in the existing D-16-02 / B-1 docstrings (useHoldToRecord.ts L1-54) verbatim.
        * OPT-IN (`keepRecordingOnShortTap === true`): call `voice.commitStartVisibility()` (SYNCHRONOUS — no await; commitStartVisibility returns void per UseVoiceRecordingReturn), then `onShortTap()`. voice.cancel is NOT called. commitStartVisibility is idempotent (useVoiceRecording.ts L656: `if (stateRef.current !== "starting") return;`), so if the guard chain in pointerdown ever short-circuited without voice.start(), or if getUserMedia has already resolved and auto-committed via the autoCommit:true path, this call is a safe no-op.
    - Forensic logging (Ashley called this out — next iOS UAT needs branch-level evidence in the forwarded console stream):
        * In `onPointerUp`, immediately AFTER the branch decision (i.e., inside each of the three post-branch tails — short-tap, long-in-bounds, long-out-of-bounds — OR as a single line at the top of the branch with the branch name resolved into a local first, whichever produces the cleaner diff): emit `console.info("[hold-to-record] pointerup branch=<branch> elapsedMs=<n> withinBounds=<b> outOfBoundsRef=<b> startedRecording=<b>")`. `<branch>` is one of `"short"` (default cancel+onShortTap), `"short-keep"` (opt-in commitStartVisibility+onShortTap), `"long-in"` (onLongPressSend), `"long-out"` (voice.cancel for slide-off), or `"guarded"` (pointerdown was short-circuited). MUST log AFTER the branch runs — not before — so the sync-gesture chain is untouched. Use `console.info`, not `console.log` / `console.debug`, so the forwarded log filter picks it up.
        * In `onPointerCancel`, emit `console.info("[hold-to-record] pointercancel triggered startedRecording=<b>")` immediately after the `if (startedRecordingRef.current) { void voice.cancel(); }` block runs. This is the critical log for Bug 1 diagnosis — if iOS is firing pointercancel mid-hold post-fix, this line will be in the console-forward stream even if pointerup never fires.
        * Log lines are prefixed `[hold-to-record]` (matches the existing `[voice]` convention in useVoiceRecording — pretty-view has an established prefix pattern for module-scoped console diagnostics; the forwarded log filter matches on bracketed prefixes).
    - Docstring updates (useHoldToRecord.ts header comment L1-54): add a paragraph under the "Consumer responsibilities NOT owned by this hook" section explaining `keepRecordingOnShortTap` — one paragraph, two examples: (a) send-button consumer omits the prop → short-tap cancels + fires typed-send handler [default], (b) mic-button consumer passes true + no-op onShortTap → short-tap keeps the pointerdown-started recording alive and lets showRecordingControls swap in via holdInitiatedRef clearing in resetGestureState.
    - LOCKED (do NOT modify): `onPointerDown` body remains exactly as-is — guard chain → `holdInitiatedRef.current = true` → `voice.start()` → post-start bookkeeping. D-16-02 iOS Safari sync-gesture invariant survives by construction because this task touches only pointerup and pointercancel.

    Tests to add in useHoldToRecord.test.tsx (append to the existing describe block, following Tests 11-13's pattern):
    - Test 14: `"keepRecordingOnShortTap=false (default): short tap awaits voice.cancel, fires onShortTap, does NOT call commitStartVisibility"`. Mirror Test 5's structure (controllable cancel promise), but explicitly assert `voice.commitStartVisibility` was NOT called. This is the regression guard proving default behavior is byte-identical to today.
    - Test 15: `"keepRecordingOnShortTap=true: short tap calls voice.commitStartVisibility, fires onShortTap, does NOT call voice.cancel"`. Pointerdown → advance 200ms (< HOLD_THRESHOLD_MS) → pointerup. Assert (a) `voice.start` called once, (b) `voice.commitStartVisibility` called once, (c) `voice.cancel` NOT called, (d) `onShortTap` called once. Because there is no cancel promise to await, this branch is synchronous — no `await Promise.resolve()` gymnastics needed after pointerup (though the pointerup handler is still declared async, so a single `await Promise.resolve()` inside act is safe belt-and-suspenders).
    - Test 16 (optional but recommended — ONLY add if it fits under the ~50% context budget and does not require reshaping existing helpers): `"keepRecordingOnShortTap=true: long-press branch is unaffected (still fires onLongPressSend at threshold, no commitStartVisibility from onPointerUp — the threshold-timer already fired that)"`. Mirror Test 6/12 structure. Guards against a future edit that accidentally hoists commitStartVisibility out of the short-tap conditional. If context is tight, skip Test 16 — the branch conditional is small enough that Tests 14+15 cover the invariant.
    - Do NOT alter Tests 1-13. They exercise the default (omitted prop) path — Test 14 is the explicit-false counterpart and asserts NOT-called on commitStartVisibility, which is a stronger guarantee than any of Tests 1-13 currently makes.
    - `makeArgs` helper (L50-61) does NOT need modification — the new prop is optional and Test 15 passes it via override. Tests 14 and 16 either omit it (implicit default) or pass `false` explicitly.
  </behavior>
  <action>
    Read useHoldToRecord.ts L91-116 (UseHoldToRecordArgs), L152-160 (destructuring), L271-359 (onPointerUp + onPointerCancel) with Read offset/limit before editing. Then perform these edits in order:

    1. Extend `UseHoldToRecordArgs` (~L91): add `keepRecordingOnShortTap?: boolean;` as a new optional field with a JSDoc comment describing its semantic — one sentence: "When true, the short-tap branch calls voice.commitStartVisibility() instead of voice.cancel() — used by mic-button consumers that want the pointerdown-started recording to survive a sub-threshold tap. Defaults to false (send-button behavior)."

    2. Extend the destructuring inside `useHoldToRecord` (~L155): add `keepRecordingOnShortTap` to the destructured names. Do NOT set a default in destructuring — read `keepRecordingOnShortTap === true` at the branch site so undefined/false both resolve to the default branch.

    3. Refactor `onPointerUp`'s short-tap branch (~L311-320) to a conditional:
       - Compute the branch name as a local first: after all the pre-branch bookkeeping (elapsedMs, withinBounds, timer clear, release capture, startedRecordingRef check), determine which of the four outcomes applies. Let this local be `branch` of type `"short" | "short-keep" | "long-in" | "long-out" | "guarded"`.
       - Guarded branch (startedRecordingRef=false): return early after logging (see step 5 for the log). `branch = "guarded"`.
       - Sub-threshold: `if (keepRecordingOnShortTap === true) { voice.commitStartVisibility(); onShortTap(); branch = "short-keep"; }` else `{ await voice.cancel(); onShortTap(); branch = "short"; }`.
       - Long-in-bounds: existing `onLongPressSend(); branch = "long-in";`.
       - Long-out-of-bounds: existing `void voice.cancel(); branch = "long-out";`.

    4. Update the onPointerUp callback dependency array (currently `[voice, onShortTap, onLongPressSend, effectiveThreshold, resetGestureState]`, ~L336) to include `keepRecordingOnShortTap`.

    5. Add forensic logging:
       - In `onPointerUp`, after the branch has executed and BEFORE `resetGestureState()`, emit: `console.info("[hold-to-record] pointerup branch=" + branch + " elapsedMs=" + elapsedMs + " withinBounds=" + withinBounds + " outOfBoundsRef=" + outOfBoundsRef.current + " startedRecording=" + startedRecordingRef.current);`. Concatenation (not template literals) mirrors the existing console patterns in the file — cosmetic preference; either compiles. For the guarded-branch early-return case, log the same line BEFORE the return so branch=guarded still emits.
       - In `onPointerCancel`, after the `if (startedRecordingRef.current) { void voice.cancel(); }` line and BEFORE `resetGestureState()`, emit: `console.info("[hold-to-record] pointercancel triggered startedRecording=" + startedRecordingRef.current);`. Snapshot `startedRecordingRef.current` into a local before resetGestureState because resetGestureState mutates the ref to false; the log MUST reflect the pre-reset value. (Actually the log fires before resetGestureState per this instruction, so no snapshot needed — verify the code order at edit time.)

    6. Update the header docstring (~L1-54) — insert a paragraph before the "Guards" section (~L50) explaining the new prop. Reference the two consumer patterns: (a) send-button default behavior [omit prop or pass false — cancel+onShortTap], (b) mic-button behavior [pass true + no-op onShortTap — commitStartVisibility+onShortTap so the pointerdown-started recording is preserved for the RecordingControls swap-in].

    7. In useHoldToRecord.test.tsx, append Test 14 and Test 15 (and Test 16 if it fits) to the existing describe block (~L138). Follow the existing helper conventions: use `makeArgs({ keepRecordingOnShortTap: true })`, `makeMockVoice()`, `installBoundsShim(button)`, `fireEvent.pointerDown` + advance timers + `fireEvent.pointerUp` inside `act`. Test 15 does NOT need a controllable cancel promise (no cancel is called); Test 14 DOES need one to prove awaiting-before-onShortTap holds when the prop is false (mirrors Test 5 exactly, with the added `voice.commitStartVisibility NOT called` assertion). Cross-check assertion cardinality: `expect((voice.X as ReturnType<typeof vi.fn>).mock.calls.length).toBe(N)` for each of start / cancel / commitStartVisibility / onShortTap / onLongPressSend.

    Grep gates to run after edits:
    - `grep -c "keepRecordingOnShortTap" src/ui/features/pretty-view/useHoldToRecord.ts` — expect ≥ 3 (type field, destructuring, branch conditional).
    - `grep -c "console\.info(\"\\[hold-to-record\\]" src/ui/features/pretty-view/useHoldToRecord.ts` — expect ≥ 2 (pointerup + pointercancel).
    - `grep -c "keepRecordingOnShortTap" src/ui/features/pretty-view/useHoldToRecord.test.tsx` — expect ≥ 2 (Tests 14 + 15).
    - `grep -c "commitStartVisibility" src/ui/features/pretty-view/useHoldToRecord.ts` — expect ≥ 2 (existing threshold-timer call at ~L253 + new short-tap-keep call).

    Do NOT modify `onPointerDown` (D-16-02 lock). Do NOT modify `useVoiceRecording.ts`. Do NOT change the existing 13 tests.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -c "keepRecordingOnShortTap" src/ui/features/pretty-view/useHoldToRecord.ts | awk '$1 &gt;= 3 {exit 0} {exit 1}' &amp;&amp; grep -c "console\.info(\"\[hold-to-record\]" src/ui/features/pretty-view/useHoldToRecord.ts | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; grep -c "keepRecordingOnShortTap" src/ui/features/pretty-view/useHoldToRecord.test.tsx | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; test -z "$(git diff --name-only src/ui/features/pretty-view/useVoiceRecording.ts)" &amp;&amp; npx vitest run src/ui/features/pretty-view/useHoldToRecord.test.tsx 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    - useHoldToRecord.ts declares `keepRecordingOnShortTap?: boolean` on UseHoldToRecordArgs with a JSDoc comment.
    - Hook body destructures and uses `keepRecordingOnShortTap` in onPointerUp's short-tap branch conditional.
    - When `keepRecordingOnShortTap === true`, short-tap calls `voice.commitStartVisibility()` (not `voice.cancel()`), then `onShortTap()`.
    - When `keepRecordingOnShortTap !== true` (default), short-tap behavior is BYTE-IDENTICAL to pre-change (await voice.cancel then onShortTap).
    - `onPointerUp` emits `console.info("[hold-to-record] pointerup branch=<branch> elapsedMs=<n> withinBounds=<b> outOfBoundsRef=<b> startedRecording=<b>")` after the branch executes.
    - `onPointerCancel` emits `console.info("[hold-to-record] pointercancel triggered startedRecording=<b>")` after the branch executes.
    - `onPointerDown` body is BYTE-IDENTICAL to pre-change (verify via `git diff -U0 src/ui/features/pretty-view/useHoldToRecord.ts | grep -A5 "^@@.*onPointerDown"` should show no changes in the function body — only surrounding edits).
    - `useVoiceRecording.ts` is UNCHANGED (`git diff --name-only src/ui/features/pretty-view/useVoiceRecording.ts` returns empty).
    - useHoldToRecord.test.tsx has new Test 14 (keepRecordingOnShortTap=false, cancel path + explicit commitStartVisibility NOT-called) and Test 15 (keepRecordingOnShortTap=true, commitStartVisibility path + explicit cancel NOT-called); optional Test 16 (long-press unaffected by the prop).
    - Full useHoldToRecord.test.tsx suite passes: `npx vitest run src/ui/features/pretty-view/useHoldToRecord.test.tsx` → 15+ tests pass, 0 fail.
    - `npx tsc --noEmit` reports no new errors in useHoldToRecord.ts.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MicButton iOS callout suppression + preventDefault-wrapped onPointerDown; ComposeBox opt-in to keepRecordingOnShortTap with no-op onShortTap (primary + slot); rewire hold-to-mic short-tap tests to the new expected sequence</name>
  <files>src/ui/features/pretty-view/MicButton.tsx, src/ui/features/pretty-view/ComposeBox.tsx, src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx</files>
  <behavior>
    MicButton.tsx changes:
    - Add `"[-webkit-touch-callout:none]"` (Tailwind arbitrary variant string) to the `cn(...)` className list on the `<button>` element (~L79-91). Group it alongside the existing `"select-none"` + `"touch-none"` block — those three utilities together suppress the iOS native long-press UI surface (text-selection, callout menu, touch-action gestures, and now the iOS Safari callout / magnifier). Insertion order within cn() is cosmetic; place it adjacent to select-none/touch-none for readability.
    - Wrap the passed `onPointerDown` prop with `e.preventDefault()`:
        ```
        const wrappedPointerDown = onPointerDown && disabled !== true
          ? (e: React.PointerEvent<HTMLButtonElement>) => {
              e.preventDefault();
              onPointerDown(e);
            }
          : onPointerDown;
        ```
      Pass `wrappedPointerDown` (not raw `onPointerDown`) to the `<button>`. The guard on `disabled !== true` ensures a disabled MicButton does NOT emit preventDefault on pointerdown (would break a11y / keyboard synthesis expectations); zero-arg callers who never pass onPointerDown still see byte-identical DOM output (wrappedPointerDown === undefined → React does not attach a handler).
    - Do NOT modify anything else in MicButton.tsx: aria-label, title, positionClass default, dataHoldActive emission, other className tokens, Mic icon rendering, or the pre-existing `select-none touch-none` classes.

    ComposeBox.tsx changes (two edits, both micro):
    - `primaryHold` (~L1672-1691): add `keepRecordingOnShortTap: true` to the useHoldToRecord({...}) argument object. Change `onShortTap: () => { beginRecord("primary"); }` to `onShortTap: () => {}` (empty arrow — voice is already recording from pointerdown's voice.start() + the hook's new commitStartVisibility call in the short-tap-keep branch; beginRecord would attempt a second voice.start that the hook's guard chain (`voice.state !== "idle"`) short-circuits, so calling it was redundant even before this fix — now it's explicitly documented as unnecessary). Add an inline comment ABOVE the empty arrow explaining the semantic: `// quick-260814-iwy: no-op — voice is already recording from pointerdown's voice.start(). Hook's short-tap-keep branch (keepRecordingOnShortTap: true) fired commitStartVisibility() to advance the state → "recording" + play start.mp3. resetGestureState clears holdInitiatedRef, which makes showRecordingControls (L1735) evaluate true and swap RecordingControls in.`
    - `slotHold` (~L2749-2763): parity edit. Add `keepRecordingOnShortTap: true`; change `onShortTap: () => beginRecord(slot.id)` to `onShortTap: () => {}` with the analogous inline comment referencing `slot.id` and showSlotRecording (L2796).
    - Update the surrounding comment blocks (L1658-1668 for primary, L2739-2748 for slot) to reflect the new reality: onShortTap is no-op because the hook now preserves the pointerdown-started recording via commitStartVisibility. Old text says "onShortTap now starts a mic-tap recording (beginRecord)" — replace with "onShortTap is now a no-op; the hook's short-tap-keep branch (keepRecordingOnShortTap: true) preserves the pointerdown-started recording via commitStartVisibility. quick-260814-iwy fix for the iPhone double-tap regression."
    - `disabled: showTranscribingSend` (primary) / `disabled: showSlotTranscribingSend` (slot) UNCHANGED — the Rule 1 fix from quick-260814-1hz stays as-is.
    - `voice`, `onLongPressSend`, `asideActive` UNCHANGED.
    - MicButton call sites at ~L2567-2571 (primary) and ~L3018-3022 (slot) UNCHANGED — the pointer handlers still spread through; MicButton.tsx now wraps them internally with preventDefault.
    - `showMicButton` / `showSlotMic` / `showRecordingControls` / `showSlotRecording` predicates UNCHANGED (all from quick-260814-1hz). This fix rides on the existing gate machinery.

    ComposeBox.hold-to-mic.test.tsx changes:
    - Test 1 (L208, "short tap on the mic under threshold OPENS a recording via beginRecord — onSend NOT called, RecordingControls swap in"): the assertion "beginRecord opens a NEW recording (second getUserMedia call)" (L263-266) is now WRONG — under keepRecordingOnShortTap:true there is no second voice.start, and getUserMedia is called EXACTLY ONCE (from pointerdown's voice.start). Rewire the test:
      * Rename the `it(...)` description to `"Test 1 (rewired per 260814-iwy): short tap on the mic under threshold OPENS a recording via commitStartVisibility (NOT via cancel+beginRecord) — onSend NOT called, voice.cancel NOT called, RecordingControls swap in"`.
      * Update the pre-assertion comment (L227-232) to describe the new expected sequence: pointerdown → voice.start (sync, from the hook) → pointerup at t=200ms < HOLD_THRESHOLD_MS → hook's short-tap-KEEP branch: voice.commitStartVisibility() (SYNC, advances "starting" → "recording") → onShortTap() (no-op) → resetGestureState clears holdInitiatedRef → showRecordingControls flips to true → Cancel-recording button renders.
      * Assertion changes:
        - KEEP: `expect(onSend).not.toHaveBeenCalled();` (L257).
        - CHANGE `expect(getUserMediaMock.mock.calls.length).toBeGreaterThanOrEqual(1)` (L266) to `expect(getUserMediaMock.mock.calls.length).toBe(1)` — under the new semantic, there is EXACTLY ONE getUserMedia call. This is a tightening of the invariant.
        - ADD `expect(fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)` after Assertion 2 (no STT round-trip on a short tap that keeps the recording alive).
        - KEEP: `expect(queryCancelRecordingButton()).not.toBeNull();` (L271).
        - KEEP: `expect(textarea.value).toBe("hello world");` (L274).
        - NEW ASSERTION (belt-and-suspenders — proves the cancel path was NOT taken): drill into voice.cancel via the test-consumer-level intercept if practical, OR simpler — assert `MockMediaRecorder.instances.length === 1` (only ONE recorder was constructed; a cancel+beginRecord sequence would construct two). Add this assertion right before the queryCancelRecordingButton assertion.
      * Cleanup block (L276-284) is unchanged.

    - Test 10 Case A (L806-872, "short-tap on mic under 260814-1hz yields cancel+idle"): the entire Case A premise is inverted by the new semantic — a short tap now leaves the recording ALIVE (not returned to idle). Rewire:
      * Rename `it(...)` description to `"Test 10 (rewired per 260814-iwy): threshold boundary — 249ms (HOLD_THRESHOLD_MS - 1) short-tap on mic KEEPS the recording alive via commitStartVisibility (no send, no fetch, RecordingControls swapped in); 250ms (HOLD_THRESHOLD_MS) long-press sends glued transcript"`.
      * Case A block (L806-872): replace the "cancel+idle" assertions with the new "recording alive" assertions:
        - REMOVE: `expect(queryCancelRecordingButton()).toBeNull();` (L869) and `expect(getMicButton()).toBeTruthy();` (L871).
        - ADD: `expect(queryCancelRecordingButton()).not.toBeNull();` — RecordingControls swapped in.
        - ADD: `expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();` — MicButton unmounted (showMicButton evaluated false because holdInitiatedRef cleared, but isPrimaryRecording is true).
        - KEEP: `expect(onSendA).toHaveBeenCalledTimes(0);` (L866) and `expect(fetchMockA.mock.calls.length).toBe(0);` (L868).
        - ADD explicit cleanup step for Case A: click Cancel-recording, flush timers — matches Case B's implicit "run to completion" pattern and ensures the unmount() at L874 doesn't fight an in-flight recording. Use the same pattern as Test 1's cleanup.
        - The multi-paragraph comment block explaining the fake-timer stateRef sync-lag limitation (L790-805 and L836-846) is now OBSOLETE — the new short-tap-keep branch doesn't call cancel at all, so there's no cancel-timing lag to explain. Replace the whole comment cluster with a single short paragraph: `// quick-260814-iwy: Case A rewired. Under the new keepRecordingOnShortTap:true semantic, a <threshold tap on the mic no longer runs voice.cancel — it runs voice.commitStartVisibility, which advances the pointerdown-started recording into the "recording" state. RecordingControls swap in. The stateRef sync-lag limitation of useVoiceRecording (documented in the pre-260814-iwy version of this test and in deferred-items.md) is no longer relevant to this code path because no cancel-then-restart race exists.` Keep the mid-block re-stub (L878-897) as-is; Case B is unchanged (long-press-send path is orthogonal to this fix).
      * Case B (L899-950) UNCHANGED — long-press-send is unaffected by keepRecordingOnShortTap; the branch conditional in Task 1 only touches the short-tap arm.

    - Test 11 (L952-1013, "NEW under 260814-1hz: mic short-tap starts recording"): the description already matches the new semantic ("mic short-tap starts recording (opens RecordingControls path)"), but the pre-assertion comment (L968-970) describes the OLD flow ("await voice.cancel() (rollback of the optimistic voice.start), then onShortTap() → beginRecord"). Rewire:
      * Rename `it(...)` description to `"Test 11 (rewired per 260814-iwy): mic short-tap starts recording (opens RecordingControls path) via commitStartVisibility — proves the hook's keepRecordingOnShortTap:true wiring works end-to-end on the mic button"`.
      * Update pre-assertion comment to describe the new flow (see Test 1's rewired comment above — mirror the language).
      * Assertions:
        - KEEP: `expect(screen.getByRole("button", { name: "Cancel recording" })).toBeTruthy();` (L998-1000).
        - KEEP: `expect(onSend).not.toHaveBeenCalled();` (L1003).
        - ADD: `expect(getUserMediaMock.mock.calls.length).toBe(1)` (exactly one, not one-or-more).
        - ADD: `expect(MockMediaRecorder.instances.length).toBe(1)` (only ONE recorder — proves no cancel+restart cycle).
        - ADD: `expect(fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)` (no STT on short-tap that keeps recording).
      * Cleanup block UNCHANGED.

    - Test 9 (L702-787, "both paths coexist — after a hold-send cycle on the mic, the mic-tap path still works cleanly"): the second half of the test (L754-786) uses `fireEvent.click(micBtn)` to trigger the mic-tap cycle, NOT a pointer sequence. Under the new semantic, `fireEvent.click` still runs the MicButton's onClick (`() => beginRecord("primary")`) — that path is untouched by this fix. Test 9 SHOULD pass unchanged. Read it before edits to confirm; if `expect(MockMediaRecorder.instances.length).toBe(2)` still holds (one from the hold-send cycle, one from the click-triggered mic-tap cycle) then no rewiring is needed. If it fails post-fix for an unexpected reason, STOP and surface — do NOT weaken the assertion.

    - New test: `"Test 12 (NEW under 260814-iwy): MicButton className includes [-webkit-touch-callout:none] (iOS Safari callout suppression)"`. Simple string presence assertion. Body:
        ```
        it("Test 12 (NEW under 260814-iwy): MicButton className includes [-webkit-touch-callout:none] (iOS Safari callout suppression)", () => {
          render(<ComposeBox {...baseProps()} />);
          const button = getMicButton();
          expect(button.className).toContain("[-webkit-touch-callout:none]");
        });
        ```
      jsdom cannot verify the actual iOS Safari behavior — this is a static-attribute assertion that the Tailwind class is present. The invariant it guards against is "someone strips the callout suppression without realizing it was there for iOS." Place it at the end of the describe block, after Test 11.

    - Test 7 (L596-645, "voice.state !== 'idle' guard — while a mic-tap recording is active, MicButton is not visible"): UNCHANGED. Uses fireEvent.click, not a pointer sequence; asserts on getUserMedia call count (exactly 1) and the RecordingControls swap-in. Under the new semantic the direct onClick path is untouched. Verify assertions still hold; do NOT rewire.
    - Test 2 (L287, long-press identity preservation), Tests 3/4/5/6/8/9 (long-press and non-short-tap variants): UNCHANGED. Long-press-send / long-press-cancel branches are untouched by this fix.

    Grep gates after edits:
    - `grep -c "\\[-webkit-touch-callout:none\\]" src/ui/features/pretty-view/MicButton.tsx` — expect 1.
    - `grep -c "keepRecordingOnShortTap: true" src/ui/features/pretty-view/ComposeBox.tsx` — expect 2 (primary + slot).
    - `grep -c "onShortTap: () => {" src/ui/features/pretty-view/ComposeBox.tsx` — expect ≥ 1 (at least primary; slot may use `() => {}` on the same line depending on formatter).
    - `grep -c "beginRecord(\"primary\")" src/ui/features/pretty-view/ComposeBox.tsx` — expect 1 (the direct onClick={() => beginRecord("primary")} at L2566 is UNCHANGED). If this returns 2, the old primaryHold onShortTap body is still there — the edit didn't land.
    - `grep -c "beginRecord(slot.id)" src/ui/features/pretty-view/ComposeBox.tsx` — expect 1 (the direct onClick={() => beginRecord(slot.id)} at L3017 is UNCHANGED). Same logic as above.
    - `grep -c "e\\.preventDefault" src/ui/features/pretty-view/MicButton.tsx` — expect 1.

    LOCKED (do not touch):
    - `useVoiceRecording.ts` (any changes → STOP and surface).
    - `useHoldToRecord.ts` (Task 1 owns edits there; Task 2 must not touch it).
    - MicButton visibility gates in ComposeBox.tsx (showMicButton, showSlotMic — quick-260814-1hz landed these).
    - The direct `onClick={() => beginRecord("primary")}` and `onClick={() => beginRecord(slot.id)}` on the MicButtons (L2566, L3017) — these are the mic-tap fallback path from quick-260814-1hz's decisions.md and MUST stay.
  </behavior>
  <action>
    Read the anchor windows first (offset/limit — do NOT open the full 3051-line ComposeBox or 1014-line test file):
    - MicButton.tsx L54-96 (destructuring + JSX button — one anchor).
    - ComposeBox.tsx L1660-1695 (primaryHold + surrounding comment) and L2735-2770 (slotHold + surrounding comment).
    - ComposeBox.hold-to-mic.test.tsx L208-286 (Test 1), L596-645 (Test 7 — read but do not edit), L702-790 (Test 9 — read but do not edit), L789-950 (Test 10), L952-1013 (Test 11).

    Perform these edits:

    1. MicButton.tsx:
       a. Add `"[-webkit-touch-callout:none]"` to the cn(...) list (~L79-91), grouped alongside `"select-none"` and `"touch-none"`.
       b. Add `const wrappedPointerDown = onPointerDown && disabled !== true ? (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); onPointerDown(e); } : onPointerDown;` immediately BEFORE the `return (` (~L64-65).
       c. Change the `onPointerDown={onPointerDown}` prop on the `<button>` (~L69) to `onPointerDown={wrappedPointerDown}`.
       d. Do NOT alter anything else in this file.

    2. ComposeBox.tsx primaryHold (~L1672):
       a. Add `keepRecordingOnShortTap: true,` to the argument object (place it after `voice,` for grouping — cosmetic; any position in the object literal is fine).
       b. Replace the `onShortTap` value with an empty arrow: `onShortTap: () => {},`.
       c. Add the inline comment above the empty arrow describing the semantic (see <behavior> for exact text).
       d. Update the surrounding block comment (L1658-1668) to reflect the new reality (see <behavior>).

    3. ComposeBox.tsx slotHold (~L2749): parity — add `keepRecordingOnShortTap: true`, change `onShortTap` to `() => {}` with the analogous inline comment, update the surrounding block comment (L2739-2748).

    4. ComposeBox.hold-to-mic.test.tsx:
       a. Rewire Test 1 per <behavior> — update description + pre-assertion comment; tighten getUserMedia assertion to `.toBe(1)`; add fetch=0 assertion; add MockMediaRecorder.instances.length === 1 assertion.
       b. Rewire Test 10 Case A per <behavior> — update description; replace cancel+idle assertions with recording-alive assertions; replace the multi-paragraph fake-timer stateRef sync-lag comment with the single short paragraph from <behavior>; add explicit Cancel-recording cleanup before the unmount() at L874. Case B UNCHANGED.
       c. Rewire Test 11 per <behavior> — update description + pre-assertion comment; add getUserMedia=1, MockMediaRecorder.instances=1, fetch=0 assertions.
       d. Add Test 12 at the end of the describe block per <behavior> — 3-line static className assertion.
       e. Verify Test 7 and Test 9 still pass unchanged (read only; if they fail, STOP and surface).

    Post-edit verification (in order):
    - `grep` gates from <behavior> (all four expected counts).
    - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "MicButton|ComposeBox|useHoldToRecord" | head -20` — expect no output (no TS errors in these files).
    - `npx vitest run src/ui/features/pretty-view/useHoldToRecord.test.tsx` — expect all Task-1-added tests pass (Tests 14+15 minimum, 16 if added).
    - `npx vitest run src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` — expect all 12 tests pass (Test 12 is new).
    - `npx vitest run src/ui/features/pretty-view/` — expect no new regressions vs the pre-change baseline (Ashley's UAT baseline: 583 pass / 6 skip / 1 todo per SUMMARY.md L86).
    - `git diff --name-only src/ui/features/pretty-view/useVoiceRecording.ts` — expect empty (D-16-02 lock, and the voice state machine lock in general).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -c "\[-webkit-touch-callout:none\]" src/ui/features/pretty-view/MicButton.tsx | grep -qx 1 &amp;&amp; grep -c "keepRecordingOnShortTap: true" src/ui/features/pretty-view/ComposeBox.tsx | grep -qx 2 &amp;&amp; grep -c "e\.preventDefault" src/ui/features/pretty-view/MicButton.tsx | grep -qx 1 &amp;&amp; grep -c "beginRecord(\"primary\")" src/ui/features/pretty-view/ComposeBox.tsx | grep -qx 1 &amp;&amp; grep -c "beginRecord(slot.id)" src/ui/features/pretty-view/ComposeBox.tsx | grep -qx 1 &amp;&amp; test -z "$(git diff --name-only src/ui/features/pretty-view/useVoiceRecording.ts)" &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "MicButton|ComposeBox|useHoldToRecord" | head -20 &amp;&amp; npx vitest run src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    - MicButton.tsx: className includes `[-webkit-touch-callout:none]`; onPointerDown is wrapped with a preventDefault-then-delegate function ONLY when onPointerDown is defined AND !disabled; existing props / other classes / dataHoldActive emission untouched.
    - ComposeBox.tsx primaryHold and slotHold both pass `keepRecordingOnShortTap: true` to useHoldToRecord and use a no-op `onShortTap: () => {}`.
    - Inline comments above both no-op arrows document the semantic tie to commitStartVisibility + resetGestureState + showRecordingControls / showSlotRecording.
    - Direct MicButton onClick handlers at ~L2566 (`() => beginRecord("primary")`) and ~L3017 (`() => beginRecord(slot.id)`) UNCHANGED — grep confirms exactly one occurrence of each.
    - ComposeBox.hold-to-mic.test.tsx: Tests 1, 10 Case A, 11 rewired per <behavior>; new Test 12 asserts `[-webkit-touch-callout:none]` present on MicButton className; Tests 2/3/4/5/6/7/8/9 and Test 10 Case B unchanged.
    - `expect(voice.cancel).not.toHaveBeenCalled` (or equivalent call-count === 0 assertion) is present in Tests 1, 10 Case A, and 11's short-tap assertions — belt-and-suspenders proof that the cancel path was NOT taken.
    - `npx tsc --noEmit` reports no new errors for MicButton.tsx or ComposeBox.tsx.
    - Full hold-to-mic suite passes: `npx vitest run src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` → 12/12 pass.
    - Broader pretty-view suite passes: `npx vitest run src/ui/features/pretty-view/` → no new failures vs the 583/6/1 baseline (pre-existing IdentityModal edit-title flake is not a regression).
    - `useVoiceRecording.ts` and `useHoldToRecord.ts` (Task 2 scope) UNCHANGED — `git diff --name-only` for both returns empty in Task 2's commit boundary (useHoldToRecord.ts was modified by Task 1 in a prior commit; Task 2 must not add further edits to it).
  </done>
</task>

</tasks>

<verification>
End-to-end checks (run in order after both tasks complete):

1. Type-check the whole tree: `cd /home/ubuntu/skynet && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20` — should surface no new errors in `pretty-view/` files.

2. Hook unit tests: `npx vitest run src/ui/features/pretty-view/useHoldToRecord.test.tsx` — all pre-existing 13 tests + new Tests 14/15 (and optional 16) pass. Test 14 explicitly asserts `voice.commitStartVisibility` was NOT called on the default (false) short-tap path. Test 15 explicitly asserts `voice.cancel` was NOT called on the opt-in (true) short-tap path.

3. Integration tests: `npx vitest run src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` — all 12 tests pass (10 pre-existing + 1 pre-existing new-under-260814-1hz Test 11 rewired + new Test 12 for the callout-suppression className).

4. Broader pretty-view suite regression sweep: `npx vitest run src/ui/features/pretty-view/` — no new failures relative to the 583 pass / 6 skip / 1 todo baseline documented in quick-260814-1hz-SUMMARY.md L86. Pre-existing IdentityModal edit-title flake is not a regression from this task.

5. Voice state machine lock: `git diff --name-only src/ui/features/pretty-view/useVoiceRecording.ts` returns EMPTY. D-16-02 iOS Safari sync-gesture invariant preserved by construction (Task 1 touched only pointerup + pointercancel, not pointerdown; verify via targeted `git diff -U0 src/ui/features/pretty-view/useHoldToRecord.ts | grep -B2 -A15 "onPointerDown = useCallback"` — should show no changes inside the function body).

6. Grep gates (all should return the expected counts):
   - `grep -c "keepRecordingOnShortTap" src/ui/features/pretty-view/useHoldToRecord.ts` → ≥ 3.
   - `grep -c "console\\.info(\"\\[hold-to-record\\]" src/ui/features/pretty-view/useHoldToRecord.ts` → ≥ 2.
   - `grep -c "keepRecordingOnShortTap: true" src/ui/features/pretty-view/ComposeBox.tsx` → 2.
   - `grep -c "\\[-webkit-touch-callout:none\\]" src/ui/features/pretty-view/MicButton.tsx` → 1.
   - `grep -c "e\\.preventDefault" src/ui/features/pretty-view/MicButton.tsx` → 1.
   - `grep -c "beginRecord(\"primary\")" src/ui/features/pretty-view/ComposeBox.tsx` → 1 (direct onClick only; onShortTap no longer calls it).
   - `grep -c "beginRecord(slot.id)" src/ui/features/pretty-view/ComposeBox.tsx` → 1 (direct onClick only).

7. Manual iPhone spot-check (deferred to Ashley's next UAT window — not blocking executor exit):
   - Hold MicButton → mic-permission prompt fires → holds through native callout suppression → release inside bounds sends the transcript. If it still ends in cancel.mp3, the console-forward stream will now show `[hold-to-record] pointercancel triggered startedRecording=true` (new forensic log from Task 1) — pinning the cause to a pointercancel source the callout suppression didn't catch. Next iteration can then target that source specifically.
   - Short-tap MicButton once → start.mp3 plays (NOT cancel.mp3) → RecordingControls swap in with Cancel/Append/Send. NO double-tap required.
   - Regressions to look for: (a) hold-to-send still delivers transcript on iPhone; (b) desktop click / short-tap on send button still fires typed-send; (c) Aside-morph Resume button still dismisses aside on tap (asideActive path is orthogonal to this fix — MicButton hides entirely when asideActive=true per quick-260814-1hz Task 3).

8. Bounty update (deferred to Ashley's discretion):
   - Update `~/.claude/roles/box-maintainer/bounties/hold-to-record-move-to-mic-button/` — append timeline entries per task; mark iPhone UAT regressions closed once the manual spot-check confirms fix. Do NOT close the bounty from executor context — the manual verification is Ashley's call.

9. Ship path (deferred to tina orchestrator — not blocking):
   - Ship as `#442` (Tanya took `#441` for Phase 39). tina verifies next available at ship time; if `#442` is taken, tina picks the next open number.
</verification>

<success_criteria>
- iPhone long-press regression (Bug 1) mitigated at the DOM level: `[-webkit-touch-callout:none]` class on MicButton + `e.preventDefault()` on the wrapped onPointerDown suppress the iOS callout / magnifier / quick-note gesture surface that was firing pointercancel mid-hold. Forensic logging in pointerup + pointercancel gives the next UAT window branch-level evidence in the console-forward stream if the fix is partial.
- iPhone first-tap regression (Bug 2) fixed at the state-machine level: hook's new `keepRecordingOnShortTap` prop makes the short-tap branch call `voice.commitStartVisibility()` (advances "starting" → "recording", plays start.mp3) instead of `voice.cancel()` (which played cancel.mp3 audibly). MicButton consumers opt in with `keepRecordingOnShortTap: true` + no-op onShortTap; no beginRecord() second-start-race. resetGestureState clears holdInitiatedRef → showRecordingControls swaps in RecordingControls on the next render.
- Backward compatibility: consumers that omit `keepRecordingOnShortTap` (or pass false explicitly) see byte-identical behavior — the send-button semantics documented in useHoldToRecord.ts's B-1 / D-16-02 / B-3 header comments are preserved verbatim.
- D-16-02 iOS Safari sync-gesture invariant preserved by construction: onPointerDown body is untouched; voice.start() remains the first non-conditional statement after guards + holdInitiatedRef write.
- useVoiceRecording.ts UNCHANGED. quick-260814-1hz visibility gates (showMicButton / showSlotMic disjuncts on holdInitiatedRef) UNCHANGED.
- Test coverage: useHoldToRecord unit tests cover both prop values (Tests 14+15, optionally 16). ComposeBox integration tests: Tests 1, 10 Case A, 11 rewired to the new expected sequence (`[commitStartVisibility]`, not `[cancel, beginRecord]`); explicit `voice.cancel` call-count === 0 assertions on short-tap; new Test 12 asserts callout-suppression className presence.
- Type-check clean; full useHoldToRecord + hold-to-mic suites pass; broader pretty-view suite has no new failures.
</success_criteria>

<output>
Create `.planning/quick/260814-iwy-fix-hold-to-mic-regressions-ios-callout-/260814-iwy-SUMMARY.md` when done. Cross-reference:
- quick-260814-1hz-SUMMARY.md (the plan whose regressions this fixed).
- The bounty at `~/.claude/roles/box-maintainer/bounties/hold-to-record-move-to-mic-button/` — timeline entries + todo progression.
- Ship intent `#442` (verify next available at ship time; do NOT ship from executor context — tina orchestrator handles ship motion after Ashley greenlight).
</output>
