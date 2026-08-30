---
phase: 260802-uow-composebox-cluster
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
autonomous: false
requirements:
  - BOUNTY-1-composebox-recording-doesnt-nuke-sibling-buttons
  - BOUNTY-2-stt-loading-button-on-correct-textarea
  - BOUNTY-3-composebox-right-padding-for-three-buttons
  - BOUNTY-4-composebox-vertical-spacing-polish

must_haves:
  truths:
    - "Recording in slot A leaves slot B's mic button VISIBLE (may be disabled) — not removed"
    - "Recording in slot A leaves slot B's send-when-idle button FULLY FUNCTIONAL (visible AND enabled)"
    - "Recording in the primary textarea leaves every slot's mic + send-when-idle in the same state"
    - "Recording in a slot leaves the primary's mic (disabled OK) + send-when-idle (fully functional) visible"
    - "STT transcribing loading spinner replaces the send button on the SAME textarea where mic was pressed (matches micTarget), not always the primary"
    - "When 3 buttons are showing (send + mic + arm-idle), typed text does NOT slide under the mic or arm-idle icons — right padding accommodates the three-button footprint"
    - "3-button padding condition applies to BOTH the primary textarea AND each queued-slot textarea"
    - "Last-queued textarea → primary textarea visual gap matches queued→queued spacing (8px, from queue-slots wrapper's internal gap-2)"
    - "Row 1 (context meter + aux buttons) has a +3px bottom margin regardless of what block sits below (queued slot or primary)"
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Per-textarea recording visibility predicates, per-target transcribing spinner, conditional 3-button right padding, vertical spacing tweaks"
      contains: "voice.state, micTarget, showMicButton, showSlotMic, showPrimaryArmButton, showSlotArmButton, showTranscribingSend"
  key_links:
    - from: "showMicButton (primary)"
      to: "voice.state gate"
      via: "predicate at ~L1247"
      pattern: "showMicButton\\s*="
    - from: "showSlotMic (queue slot)"
      to: "isSlotIdle gate"
      via: "predicate at ~L1721"
      pattern: "showSlotMic\\s*="
    - from: "showTranscribingSend (transcribing spinner)"
      to: "target-aware render (primary vs slot)"
      via: "Loader2 render branch at ~L2162 + parallel slot render at ~L1824"
      pattern: "showTranscribingSend|Loader2"
---

<objective>
Fix four related composebox bugs in a single coherent revision to `ComposeBox.tsx`. The through-line: recording state is a single hook instance shared across the primary textarea + every queued-message textarea, and its `voice.state` + `micTarget` were being consulted with wrong visibility predicates. When recording starts in one textarea, sibling mic buttons vanish (should stay visible, may disable) and sibling send-when-idle buttons vanish (should stay fully functional). The transcribing-send spinner always renders on the primary regardless of which textarea recorded. Text underlaps the mic/arm-idle icons when three buttons show because right padding was sized for one button. Two vertical-spacing measurements are off.

Purpose: Ashley reported all four in one Vehicle Composebox session because they share the composebox surface. Root causes: (a) predicates use `voice.state === "idle"` where they should use `micTarget !== <this textarea>` (or ignore voice.state entirely for arm-idle), (b) transcribing spinner render isn't target-aware, (c) `pr-10` doesn't account for the 3-button layout, (d) `gap-1` on the outer container is undersized between the queued-slot wrapper and the primary, and Row 1 needs an explicit +3px.

Output: One modified file (`ComposeBox.tsx`), 3 atomic commits (task-per-commit).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/MicButton.tsx
@src/ui/features/pretty-view/useVoiceRecording.ts

Reference reading (skim only, do NOT re-read in full during implementation — the specific line ranges below are all you need):

Key line ranges (line numbers accurate as of the planner's read; use as anchors, verify with grep before editing):
- `voice = useVoiceRecording()` @ L333 — single state instance for the whole composebox
- `micTarget` state @ L395 — `"primary" | string(slotId)`; source of truth for who is recording
- `beginRecord(target)` @ L1092 — sets micTarget BEFORE voice.start() (synchronous, iOS Safari safe)
- Primary predicates @ L1246-1260 — `primaryArmed`, `showMicButton`, `showPrimaryArmButton`, `showRecordingControls`, `showTranscribingSend`
- Slot predicates @ L1711-1733 — `isSlotRecording`, `isSlotIdle`, `slotArmed`, `showSlotMic`, `showSlotArmButton`, `showSlotRecording`, `showSlotSend`
- Slot send button render @ L1824-1852 — plain `<button>` with paper-plane svg, NO Loader2 branch
- Primary send button render @ L2118-2175 — Loader2 branch @ L2162 gated on `showTranscribingSend`
- Row 1 aux-row container @ L1388 — `<div className={cn("flex items-center gap-2", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>`
- Queue-slots wrapper @ L1708-1709 — `{queueSlots.length > 0 && (<div className="flex flex-col gap-2">`
- Compose root container @ L1326 — `"flex flex-col gap-1 px-2 pt-2 pb-[env(safe-area-inset-bottom)] md:pb-2 shrink-0"`
- Primary textarea className @ L1930-1987 — currently `pr-10` @ L1973
- Slot textarea className @ L1754-1767 — currently `pr-10 pl-10` @ L1760

Existing state model (do NOT refactor into per-textarea hook instances — D-16-02 iOS Safari getUserMedia constraint mandates one hook call per user gesture; multiple instances would break that guarantee and be strictly worse). The fix is entirely in the VISIBILITY PREDICATES and RENDER BRANCHING, not the state itself.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scope recording visibility per-textarea (closes Bounty 1 + Bounty 2)</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx</files>
  <action>
Rework six visibility predicates in `ComposeBox.tsx` so sibling textareas keep their controls when another textarea is recording, and add target-aware routing for the transcribing spinner. Do NOT change `useVoiceRecording.ts`, do NOT introduce a second hook instance, do NOT change `beginRecord`/`handleVoice*`/`setMicTarget` semantics.

Concrete changes:

1) At the primary predicates block (~L1246-1260): keep `voice.state` reads intact, but change the semantics of what "idle-here" means. Introduce two local flags at the top of that block:
   - `const isPrimaryRecording = voice.state === "recording" && micTarget === "primary";`
   - `const isPrimaryTranscribing = voice.state === "transcribing" && micTarget === "primary";`
   Then rewrite the predicates:
   - `showMicButton`: replace the `voice.state === "idle"` gate with `!isPrimaryRecording && !isPrimaryTranscribing` (mic visible on primary whenever primary itself isn't the active recorder/transcriber; a slot recording elsewhere leaves this visible). Keep the `navigator.mediaDevices != null`, `!asideActive`, `!primaryArmed` gates. Additionally pass a `disabled` prop: mic is disabled while ANY other textarea is recording OR transcribing — i.e. `disabled={voice.state !== "idle"}` (only one recording at a time is fine; disable prevents starting a second).
   - `showPrimaryArmButton`: REMOVE the `voice.state === "idle"` gate entirely. Arm-idle is orthogonal to recording elsewhere (Ashley: "send-when-idle while recording elsewhere is a valid workflow"). Keep the other gates (`!asideActive`, `!primaryArmed`, `text.trim() !== ""`, `!recycleActive`). Do NOT disable it while a slot is recording.
   - `showRecordingControls`: change to `isPrimaryRecording` (was `voice.state === "recording"` — but the render site @ L2089 already guards with `&& micTarget === "primary"`, so semantically identical; consolidate here for clarity).
   - `showTranscribingSend`: change to `isPrimaryTranscribing` (was `voice.state === "transcribing"`). This is the Bounty 2 fix for the primary side — the Loader2 spinner @ L2162 must only replace the primary's send button when the PRIMARY is transcribing, not when a slot is transcribing.

2) At the slot predicates block (~L1711-1733) — inside the `queueSlots.map` callback, per slot: keep `isSlotRecording` as-is. Add:
   - `const isSlotTranscribing = voice.state === "transcribing" && micTarget === slot.id;`
   Rewrite the predicates:
   - Replace `const isSlotIdle = voice.state === "idle";` with `const isSlotActiveMic = isSlotRecording || isSlotTranscribing;` (used below; `isSlotIdle` name goes away because it was misnamed — it meant "hook is idle" not "this slot is idle").
   - `showSlotMic`: replace `isSlotIdle` gate with `!isSlotActiveMic`. Keep `navigator.mediaDevices != null`, `!asideActive`, `!slotArmed`. Pass `disabled={voice.state !== "idle"}` to `<MicButton>` at ~L1859 (mic stays visible on OTHER slots when one slot records, but disabled — same rule as primary).
   - `showSlotArmButton`: REMOVE the `isSlotIdle` gate entirely. Same rationale as primary: arm-idle orthogonal to recording. Keep `!asideActive`, `!slotArmed`, `slotHasText`.
   - Introduce `const showSlotTranscribingSend = isSlotTranscribing;` — a new local for the Bounty 2 slot-side fix.

3) Slot send-button render (~L1824-1852): the current render is a plain `<button>` with hard-coded paper-plane svg and no loading branch. Reshape to mirror the primary's pattern:
   - When `showSlotTranscribingSend`: render a disabled button (same className, same absolute positioning) with `<Loader2 className="size-6 animate-spin" aria-hidden="true" />` INSTEAD of the paper-plane svg. Keep the button `disabled={true}` in this branch (matches primary T-16-16 rapid-tap mitigation).
   - Otherwise (existing branch, `showSlotSend && !showSlotTranscribingSend`): keep the paper-plane svg render exactly as today.
   The `Loader2` import already exists at L2. Do NOT introduce a new component; inline the branch inside the existing render tree (same shape as primary's L2162 branch).

4) Slot render — pass `disabled={voice.state !== "idle"}` to the slot's `<MicButton>` at ~L1859 as noted in (2). Pass `disabled={voice.state !== "idle"}` to the primary's `<MicButton>` at ~L2189 as noted in (1). MicButton already supports `disabled` (see MicButton.tsx L27, L39, L47).

5) Update inline comments at the two predicate blocks to reflect the new semantics. Specifically the `showMicButton` block comment (~L1226-1231) which says "voice is idle (not recording, not transcribing)" — rewrite to "primary is NOT the active mic target (other textareas may be recording; mic stays visible but disabled)". Similarly for the slot block comment around L1713-1719.

Preserve verbatim:
- The showRecordingControls RENDER site guard `micTarget === "primary"` @ L2089 — still needed.
- The `beginRecord(target)` synchronous-getUserMedia flow (D-16-02 lock).
- All existing `voice.errorMessage`, `displayError` behavior.
- The primary's `Loader2` render branch structure @ L2162 (paper-plane <-> Loader2 swap based on `showTranscribingSend`).

Verification that state architecture assumption holds: grep confirms `useVoiceRecording()` is called ONCE in ComposeBox.tsx @ L333, and NOT called anywhere else in `src/ui/features/pretty-view/`. If a second call site surfaces during implementation, STOP and CALL OUT — the plan assumes single instance.

Risk callout: If while wiring the slot `Loader2` branch you discover the slot Send button click handler `handleQueueSlotSend` is called during transcribing (race between STT return and manual tap), the `disabled={true}` on the Loader2 branch already prevents this at the UI level. No state changes needed.

Commit message: `fix(composebox): scope recording visibility per-textarea (bounties 1+2)`
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx src/ui/features/pretty-view/ComposeBox.test.tsx 2>&1 | tail -40</automated>
  </verify>
  <done>
- Grep confirms new predicates: `grep -nE "isPrimaryRecording|isPrimaryTranscribing|isSlotTranscribing|showSlotTranscribingSend" src/ui/features/pretty-view/ComposeBox.tsx` returns matches in both the primary block (~L1246) and slot block (~L1711).
- Grep confirms removed dead flag name: `grep -n "const isSlotIdle" src/ui/features/pretty-view/ComposeBox.tsx` returns nothing (renamed to `isSlotActiveMic` or fully inlined).
- Grep confirms MicButton disabled wiring: `grep -nE "MicButton" src/ui/features/pretty-view/ComposeBox.tsx | grep -v "^import\|//"` — both mic renders exist; opening each shows `disabled={voice.state !== "idle"}` (verify visually via Read).
- Grep confirms slot Loader2 branch exists: `grep -n "Loader2" src/ui/features/pretty-view/ComposeBox.tsx` shows at least 2 matches (primary + slot).
- Existing voice tests pass (Test 11 spinner test, cancel-recording tests, mic-goes-away-while-recording tests). If any test relied on `voice.state === "idle"` hiding OTHER textareas' mic buttons, those tests need updating to match the new behavior — flag any test updates in the summary.
- Type-check clean: `npx tsc --noEmit` no new errors in ComposeBox.tsx.
  </done>
</task>

<task type="auto">
  <name>Task 2: Conditional right padding for 3-button state (Bounty 3)</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx</files>
  <action>
Extend the right padding on BOTH the primary textarea and each queue-slot textarea when three buttons are showing (send + mic + arm-idle). Currently both use `pr-10` (40px), which suffices for the always-present send button at `right-1 bottom-0.5` but not for the mic at `right-11` (~44px offset) and arm-idle at `right-21` (~84px offset) — the mic and arm-idle buttons visually overlap the last characters of typed text.

Concrete changes:

1) Primary textarea (~L1930-1987): the current `pr-10` @ L1973 stays as the default. When the 3-button state is active (send + mic + arm-idle all rendered), swap to a wider padding. The 3-button state predicate is derived: `showMicButton && showPrimaryArmButton`. When true, both mic (right-11) and arm-idle (right-21) render alongside the always-present send at right-1.
   - Compute at the primary predicates block: `const primaryThreeButtonState = showMicButton && showPrimaryArmButton;`
   - In the primary Textarea's className (~L1966-1973): replace `"pr-10"` with a conditional. Use tailwind-merge semantics — the LATER class wins. Recommended: keep `"pr-10"` as the base, then add `primaryThreeButtonState && "pr-32"` (128px) as a subsequent class in the `cn(...)`. This gives ~128px right clearance which comfortably clears the arm-idle button whose right edge sits ~124px from container's right (right-21 = 84px + button width ~40px).
   - Executor may tune the exact value: try `pr-32` first, sanity-check visually via `/gsd-execute-plan` visual checkpoint. If text still visually crowds against the arm-idle icon, bump to `pr-36` (144px). Do NOT go smaller than `pr-32`.
   - Preserve the `showPaperclip && "pl-11"` LEFT padding logic verbatim.

2) Queue-slot textarea (~L1754-1767): same treatment. Compute inside the map callback:
   - `const slotThreeButtonState = showSlotMic && showSlotArmButton;`
   - In the slot Textarea's className (~L1760): replace `"pr-10 pl-10"` with `"pr-10 pl-10"` as base + `slotThreeButtonState && "pr-32"` (or equivalent — SAME value chosen for primary so both surfaces feel consistent).

3) Do NOT change the padding when only 2 buttons render (send + mic, OR send + arm-idle) — that's what `pr-10` was sized for. Ashley: "I think there's enough padding for the send button because there always is but the mic and send when idle buttons just end up overlapping the text" — the fix is specifically for the 3-button case.

4) Do NOT touch the ABSOLUTE positions of the mic (right-11) / arm-idle (right-21) / send (right-1) buttons themselves — they're pinned by hard-locked positioning tokens (comments at L2176-2188 lock these). Only the textarea's padding changes.

Commit message: `fix(composebox): conditional right padding for 3-button state (bounty 3)`
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx 2>&1 | tail -30 && grep -nE "primaryThreeButtonState|slotThreeButtonState" src/ui/features/pretty-view/ComposeBox.tsx</automated>
  </verify>
  <done>
- Grep finds both new predicates in the file.
- Grep confirms conditional pr class: `grep -nE "pr-32|pr-36" src/ui/features/pretty-view/ComposeBox.tsx` shows at least 2 matches (one in primary Textarea className, one in slot Textarea className).
- Existing ComposeBox.test.tsx passes (no test asserts on `pr-10` specifically; if one does, it needs updating to accept either — flag in summary).
- Type-check clean.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Vertical spacing polish + visual verification (Bounty 4 + full-cluster sanity check)</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx</files>
  <what-built>
Two vertical-spacing edits, then a visual sanity check across all four bounties in one interactive pass.

Concrete edits (do these BEFORE the checkpoint pause):

(a) Row 1 (context meter + aux buttons) bottom margin: at ~L1388, the container is `<div className={cn("flex items-center gap-2", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>`. Add `mb-[3px]` to the className. This gives Row 1 a 3px bottom margin on TOP OF the outer `gap-1` (4px), for a total 7px gap between Row 1 and whatever renders next (queued slot stack OR primary textarea, since queued slots may or may not be present). Ashley verified 3px in DevTools computed stats — do not round to a Tailwind numeric class; use the arbitrary bracket `mb-[3px]`.

(b) Last-queued to primary gap: the queue-slots wrapper @ L1709 is `<div className="flex flex-col gap-2">` (queued→queued spacing = 8px). The OUTER compose container @ L1326 uses `gap-1` (4px between the queue-slots wrapper and the primary Row 2). Ashley reports the last-queued → primary gap "has ZERO margin" — DevTools measures element margin, not flex gap, so what she saw was the queued textarea's own margin (correctly 0). The fix that matches her intent ("last-queued → main gap should match queued→queued spacing") is to add `mb-1` to the queue-slots wrapper. `mb-1` = 4px. Combined with the outer `gap-1` = 4px, total gap = 8px, matching the `gap-2` between queued items. Preserve the existing `flex flex-col gap-2` classes — add `mb-1` to the same className string.

Commit message for the code edits: `fix(composebox): vertical spacing polish for row 1 and last-queued gap (bounty 4)`

Then, after the code commit, pause for human verification.
  </what-built>
  <how-to-verify>
Ashley: please pull up the pretty-view compose box locally (dev build; browser DevTools open helps).

STEP 1 — Bounty 4 (vertical spacing), measure in DevTools:
1a. With NO queued messages present: inspect the Row 1 (context meter + aux buttons) container. Its computed bottom-margin should be `3px`. The visual gap between Row 1 and the primary textarea should feel a hair more generous than before (was ~4px, now ~7px).
1b. Add 1+ queued messages. Inspect the queue-slots wrapper (the `<div class="flex flex-col gap-2 mb-1">`). Its computed bottom-margin should be `4px`. The visual gap between the last-queued textarea's bottom edge and the primary textarea's top edge should visually MATCH the gap between two queued textareas (both should feel like 8px).

STEP 2 — Bounty 1 (recording doesn't nuke siblings):
2a. Have 2+ queued messages + text in primary.
2b. Tap mic in a QUEUED slot. Verify: (i) primary's mic button is still VISIBLE but disabled/greyed. (ii) primary's send-when-idle (hourglass) button is still VISIBLE AND clickable — tap it, confirm it fires the arm-idle overlay on the primary as normal. (iii) OTHER queued slots' mic buttons are still visible (disabled). (iv) OTHER queued slots' send-when-idle buttons still fully functional.
2c. Cancel that recording. Tap mic in the PRIMARY. Verify: every queued slot's mic button is still visible (disabled) and their send-when-idle buttons still fully functional.

STEP 3 — Bounty 2 (STT loading spinner on correct textarea):
3a. Tap mic in a queued slot, say a few words, tap Send (paper-plane in RecordingControls).
3b. During the STT round-trip (~1-2s), verify the Loader2 spinner appears on the SAME queued slot's send-button position, NOT the primary. Primary's paper-plane should stay untouched.
3c. Repeat with the primary. Spinner should appear on primary, queued slot(s) untouched.

STEP 4 — Bounty 3 (3-button right padding):
4a. Type text into the primary. Verify send + mic + send-when-idle all render.
4b. Verify the typed text does NOT slide under the mic or send-when-idle icons — there should be visible whitespace between the end of the text and the leftmost of the three icons.
4c. Repeat with typed text in a queued slot. Same expectation.
4d. Delete the text so the send-when-idle button hides (only send + mic show, 2-button state). Verify padding relaxes — text can now go closer to the mic icon (this is the intended behavior; the extra padding is 3-button-only).

STEP 5 — regression sanity:
5a. Voice recording still works end-to-end (iOS Safari getUserMedia not broken — best verified on physical device, or by confirming the getUserMedia call is still the first statement in `useVoiceRecording.ts::start()` — no changes were made to that file).
5b. The armed-overlay dark scrim still covers a slot/primary when send-when-idle is tapped (Vehicle C v2 behavior preserved).
5c. The aside-morph X-for-Resume button still swaps in place (Phase 14 morph behavior).

If ANY step fails, describe which one; DO NOT approve.
  </how-to-verify>
  <resume-signal>Type "approved" if all steps pass; otherwise describe the failure(s) so I can iterate.</resume-signal>
</task>

</tasks>

<threat_model>
No security-sensitive changes. All edits are UI predicate logic + CSS classes in a client-only component. No new inputs cross a trust boundary. No package installs. STRIDE is not applicable here — informational note only, no register entries needed.
</threat_model>

<verification>
- All existing ComposeBox test suites pass (`ComposeBox.test.tsx`, `ComposeBox.voice.test.tsx`, `ComposeBox.aside-morph.test.tsx`, `ComposeBox.aside-props.test.tsx`, `ComposeBox.recycle-disable.test.tsx`).
- `npx tsc --noEmit` clean.
- `npx eslint src/ui/features/pretty-view/ComposeBox.tsx` clean.
- Human verification checkpoint (Task 3) passes all 5 STEPs.
</verification>

<success_criteria>
- All 4 bounties resolved per Ashley's verbatim descriptions in the planning context.
- Exactly 3 commits authored (one per task).
- Only `src/ui/features/pretty-view/ComposeBox.tsx` modified.
- `useVoiceRecording.ts` NOT modified (D-16-02 iOS Safari getUserMedia constraint untouched).
- No new component files; changes are inline in ComposeBox.tsx.
- Recording state remains a SINGLE hook instance — no per-textarea hook proliferation.
- Human verification approved.
</success_criteria>

<output>
Create `.planning/quick/260802-uow-composebox-cluster-scope-recording-state/260802-uow-SUMMARY.md` when done.
</output>
