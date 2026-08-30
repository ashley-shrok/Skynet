---
phase: quick-260731-ulo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx
autonomous: true
requirements:
  - bounty:mic-available-when-composebox-disabled
must_haves:
  truths:
    - "During a session recycle (recycleActive=true), the primary MicButton renders and is not disabled"
    - "During a session recycle, the per-queue-slot MicButton renders and is not disabled"
    - "During a session recycle, the Paperclip attach button renders and is not disabled"
    - "During a session recycle, a completed voice transcript for the PRIMARY target lands in the textarea but does NOT trigger onSend"
    - "During a session recycle, a completed voice transcript for a QUEUE SLOT lands in slot state but does NOT trigger onSend and does NOT remove the slot"
    - "During a session recycle, the Send button remains disabled even after a transcript populates the textarea"
    - "When showPaperclip=true, the primary textarea reserves 44px (pl-11) of left padding so text does not underlap the paperclip glyph"
    - "Full vitest suite passes with 0 failed; pass count increases by the new tests added; skipped count unchanged"
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Recycle-tolerant mic + paperclip render/gate logic; voice-send skip during recycle; +4px textarea left padding"
      contains: "showMicButton (no !recycleActive), showSlotMic (no !recycleActive), Paperclip disabled without recycleActive, handleVoiceSend gated on !recycleActive, showPaperclip && \"pl-11\""
    - path: "src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx"
      provides: "Coverage: paperclip removed from B2 aux-disabled set; new C1-C5 tests for mic/paperclip usable + voice-transcript-no-send during recycle"
      contains: "C1 paperclip usable, C2 mic renders + not disabled, C3 primary voice transcript lands + no onSend, C4 Send stays disabled through transcript flow, C5 slot voice transcript lands + no onSend + slot not removed"
  key_links:
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (showMicButton, showSlotMic)"
      to: "MicButton render path"
      via: "removed !recycleActive clauses (L1213 and L1776)"
      pattern: "showMicButton =[\\s\\S]*?!queueArmed;"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (Paperclip button)"
      to: "handleOpenFilePicker"
      via: "disabled predicate no longer includes recycleActive (L2018)"
      pattern: "disabled=\\{canSend === false \\|\\| asideActive === true\\}"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (handleVoiceSend)"
      to: "textarea state + autosave (NO onSend when recycleActive)"
      via: "recycleActive branch skips handleSend / onSend but preserves setText+setQueueSlots+scheduleAutosave"
      pattern: "if \\(!recycleActive\\)"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (primary textarea className)"
      to: "Paperclip absolute positioning (left-1)"
      via: "showPaperclip ? pl-11 : (no pad)"
      pattern: "showPaperclip && \"pl-11\""
---

<objective>
Close bounty `mic-available-when-composebox-disabled`: revise the quick 260729-j8l recycle-disable behavior so mic + paperclip stay USABLE during a session recycle (they don't cause WS sends by themselves — mic just records, paperclip just stages a file), while keeping Send disabled. Also gate `handleVoiceSend` so a completed transcript during recycle lands in the textarea/slot but does NOT invoke `onSend` — the user sends manually once the recycle overlay clears. Finally, bump the primary textarea's left padding from `pl-10` (40px) to `pl-11` (44px) per Ashley's request for a few more pixels of clearance under the paperclip glyph.

Purpose: The prior 260729-j8l pass over-scoped the recycle gate — mic and paperclip do not fire WS side-effects on their own, so hiding/disabling them makes the UI feel dead during the 2-15s recycle window without safety benefit. This plan restores their usability while preserving the WS-safety invariant (no send while recycling).

Output: Two files modified in a single atomic commit on branch `feat/tab-title-from-tmux`. No backend touched. No deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx
@src/ui/features/pretty-view/ComposeBox.voice.test.tsx
@src/ui/features/pretty-view/MicButton.tsx
@src/ui/features/pretty-view/useVoiceRecording.ts
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Enable mic + paperclip during recycle, gate voice auto-send, bump textarea left padding, update test coverage</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx, src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx</files>
  <action>
Make all five source edits and both test edits in one commit. Order below is precise.

SOURCE FILE: `src/ui/features/pretty-view/ComposeBox.tsx`

(1) Around line 1207-1213, the `showMicButton` predicate: DROP the `!recycleActive` clause (and the `&&` on the previous line). The final predicate reads:
      `showMicButton = typeof navigator !== "undefined" && navigator.mediaDevices != null && voice.state === "idle" && !asideActive && !queueArmed;`
    Result: primary MicButton renders during recycle.

(2) Around line 1770-1776, the `showSlotMic` predicate inside the queue-slot map callback: DROP the `!recycleActive` clause (and the `&&` on the previous line). Final predicate:
      `showSlotMic = typeof navigator !== "undefined" && navigator.mediaDevices != null && isSlotIdle && !asideActive && !queueArmed;`
    Result: per-slot MicButton renders during recycle.

(3) Around line 2018, the Paperclip attach `disabled` prop: DROP the `|| recycleActive === true` clause. Final:
      `disabled={canSend === false || asideActive === true}`
    Result: paperclip enabled during recycle.

(4) `handleVoiceSend` function around L1012-1047. Gate the auto-send WITHOUT changing setText / setQueueSlots / scheduleAutosave behavior, so the transcript still lands in the textarea/slot during recycle — Ashley just sends manually once the overlay clears.

    PRIMARY branch (target === "primary", currently L1019-1024): keep `setText(result.glued)` and `scheduleAutosave(result.glued, latestQueueSlotsRef.current)`. Wrap the `handleSend(result.glued)` call in `if (!recycleActive)`. Add a one-line comment directly above that guard:
      `// Bounty mic-available-when-composebox-disabled (quick 260731-ulo): during recycle, land transcript in textarea but skip auto-send — Ashley sends manually once the overlay clears.`

    SLOT branch (else block, currently L1025-1043): keep the `setQueueSlots(prev => prev.map(...))` write. Wrap the entire `const payload = collapseNewlinesForSend(...)` block (including `if (payload) { ... }`) in `if (!recycleActive)`. Inside the new `else` (when recycleActive is true), mirror the "write-to-slot-only-no-send" pattern used by the sibling `handleVoiceAppend` (L985-1010): compute the same `nextSlots` mapping used by handleVoiceAppend —
      `const nextSlots = latestQueueSlotsRef.current.map((s) => s.id === target ? { ...s, text: result.glued } : s);`
      `scheduleAutosave(latestBodyRef.current, nextSlots);`
    Add a matching one-line comment above the `if (!recycleActive)` in the slot branch referencing the bounty slug + quick id and the "text lands, no dispatch, slot not removed" invariant.

(5) Around line 1975, the primary textarea's Tailwind className conditional: change `showPaperclip && "pl-10"` to `showPaperclip && "pl-11"`. Do NOT touch the surrounding comment block that explains the `pr-10` mirror — the rationale still holds; only the pixel value changes. If updating a stray phrase in that comment feels natural (e.g., "40px hit target at absolute left-1 bottom-0.5 needs matching left padding" → "44px matching left padding"), do it, otherwise leave the comment as-is.

Do NOT touch: Send button (`sendDisabled` OR-in of `recycleActive` stays), Reset, ThumbsUp, Lightbulb, Target `/bounty`, ListPlus `/queue`, Queue-for-idle button, textarea `disabled`, Enter-key early-return, or anything mic-recording-controls-related. Do NOT touch `~/.claude/identities/tina/*`.

TEST FILE: `src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx`

(6) File-header comment block (L1-27): edit line 14 — remove "paperclip" from the aux list. Add a short note (2-3 lines) near the bottom of the header block noting the scope shift, wording along the lines of:
      `Quick 260731-ulo (bounty mic-available-when-composebox-disabled): mic + paperclip stay USABLE during recycle (no WS side-effect from either alone). Voice-send is gated so a completed transcript during recycle lands in the textarea/slot but does NOT dispatch — Ashley sends manually once the overlay clears.`

(7) Test B2 (L80-103): remove the `attachBtn` const declaration AND its `expect(attachBtn.disabled).toBe(true)` assertion. Keep resetBtn, thumbsUpBtn, explainBtn, queueBtn assertions unchanged. Rename the test title from "aux buttons all disabled" to something narrower and accurate — e.g., `"B2: recycleActive=true — aux WS-side-effect buttons (reset, thumbs-up, explain, queue-for-idle) disabled"`. Do NOT add Target `/bounty` or ListPlus `/queue` buttons here — they render conditionally and are already covered by their own disabled expressions in the source; keep scope tight.

(8) Append (after B6) five new tests inside the same `describe` block. Reuse the existing `baseProps` helper. For any test that needs `navigator.mediaDevices` (C2 and later), adopt the SAME stubbing pattern as `ComposeBox.voice.test.tsx` (L102-116): `Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(mockStream) } }, writable: true, configurable: true })`. Add matching `beforeEach` setup INSIDE a new nested `describe("recycleActive=true — mic + paperclip usable (bounty mic-available-when-composebox-disabled)")` block so it does not perturb tests B1-B6. Also stub `MediaRecorder` and `fetch` per the voice-test pattern. Include an `afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); })` so B1-B6 state is not affected across test files.

    C1: `recycleActive=true` + `showPaperclip=true` + `onAttachFiles=vi.fn()` → assert `screen.getByLabelText("Attach file").disabled === false`.

    C2: `recycleActive=true` (with the mediaDevices stub above) → assert `screen.getByRole("button", { name: "Record voice" })` exists AND its `disabled === false`.

    C3: `recycleActive=true` + full voice flow for PRIMARY target. Mirror `ComposeBox.voice.test.tsx` Test 8 (L276-306) verbatim: click MicButton → wait for `"Send transcript"` button → `act(() => recorder.emitData(new Blob(["audio"], { type: "audio/webm" })))` → click Send transcript → `await waitFor` until the primary textarea's value equals `"hello world"` → assert `onSend` mock has zero calls (`expect(onSend).not.toHaveBeenCalled()`). This is the core no-auto-send-during-recycle assertion.

    C4: Same setup as C3 (recycle + transcript lands via Send transcript path). After the transcript lands in the textarea, assert `(screen.getByLabelText("Send") as HTMLButtonElement).disabled === true`. Rationale: proves `sendDisabled`'s recycleActive OR-in prevents the transcript-populated textarea from re-enabling Send. Guards a future refactor that decouples them.

    C5: `recycleActive=true` + full voice flow for a QUEUE SLOT target. Only add if it fits in a straightforward extension of the voice-test pattern; the slot mic requires a pre-existing queue slot to render. If setup takes more than ~30 lines or requires new fixture wiring beyond what's already in the file, skip C5 and add a single-line TODO comment in the file:
      `// TODO(quick 260731-ulo): C5 slot-branch parity test — deferred; primary-mic parity in C3 is required coverage.`
    Otherwise: seed a queue slot (check whether ComposeBox exposes an `initialQueueSlots` / `slots` prop; if not, use `PLUS` button flow to add a slot before the mic tap), tap the slot's mic, emit data, click Send transcript, assert (a) the slot's text state received the transcript AND (b) `onSend` mock has zero calls AND (c) the slot is NOT removed (still present in the DOM via its `data-testid={queue-slot-textarea-<id>}` or aria).

Do NOT modify B1, B3, B4, B5, B6.

COMMIT: single atomic commit on branch `feat/tab-title-from-tmux` with message including the bounty slug and quick id, e.g.:
    `feat(compose): enable mic + paperclip during recycle; gate voice auto-send; +4px textarea left padding — bounty mic-available-when-composebox-disabled (quick 260731-ulo)`
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/ulo-tsc.log &amp;&amp; ! grep -E "error TS" /tmp/ulo-tsc.log &amp;&amp; npm test 2>&amp;1 | tee /tmp/ulo-vitest.log &amp;&amp; ! grep -E "(FAIL|failed|✗)" /tmp/ulo-vitest.log | grep -v -E "(0 failed|Tests\s+.*failed.*0|failed\s*:\s*0)" &amp;&amp; grep -E "Test Files\s+.*passed" /tmp/ulo-vitest.log</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` exits 0 (no TS errors introduced).
    - `npm test` completes with `failed: 0`. Grep for `FAIL|failed|✗` in captured output shows no failure lines (per fleet learned-preference: do NOT trust the bare "0 failed" number without grepping).
    - Vitest pass count increased by the number of new tests added (~4 if C5 skipped with TODO, ~5 if C5 included); skipped count unchanged from baseline 6.
    - Test B2 no longer includes an `attachBtn` assertion; title reflects the narrower aux set.
    - `grep -nE "!recycleActive" src/ui/features/pretty-view/ComposeBox.tsx | wc -l` returns fewer occurrences than before the edit (the two mic predicates lost their clause). The remaining `recycleActive`-related lines belong to `sendDisabled`, `handleVoiceSend` guards, and the Enter-key early-return.
    - `grep -n "recycleActive === true" src/ui/features/pretty-view/ComposeBox.tsx | grep -i paperclip` shows no matches near the Paperclip disabled predicate.
    - `grep -n "showPaperclip && \"pl-11\"" src/ui/features/pretty-view/ComposeBox.tsx` returns one hit; `grep -n "showPaperclip && \"pl-10\"" ...` returns zero.
    - Single atomic commit landed on branch `feat/tab-title-from-tmux`. No push, no docker rebuild, no compose recreate (Ashley greenlights ship separately).
    - No files touched under `~/.claude/identities/tina/` (orchestrator handles skynet-patches.md + bounty archive after executor returns).
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with zero new TS errors.
- `npm test` full-suite from `/home/ubuntu/skynet`: `failed: 0`, `skipped: 6`, `passed: 972 + <new tests>`. Grep captured runner output for `FAIL|failed|✗` — must show no actual failure lines (per fleet rule, do NOT trust the bare "0 failed" number).
- Manual DOM sanity via grep on the two source-file changes (mic predicates, paperclip disabled, textarea padding, handleVoiceSend guards) — see task `<done>` for exact grep commands.
</verification>

<success_criteria>
- Both source edits (mic × 2, paperclip disabled, textarea padding, voice-send guards × 2) landed in ComposeBox.tsx.
- Both test edits (B2 attachBtn removed, new C1-C4 plus optional C5) landed in ComposeBox.recycle-disable.test.tsx.
- `npx tsc --noEmit` clean.
- `npm test` reports `failed: 0`, verified by grep — not by trusting the summary line.
- Baseline pass count (972) increased by the number of new tests; skipped unchanged (6).
- Single commit on `feat/tab-title-from-tmux`. No deploy motion. No identity-file edits.
- Bounty `mic-available-when-composebox-disabled` closable by orchestrator afterward.
</success_criteria>

<output>
Create `.planning/quick/260731-ulo-enable-mic-paperclip-during-session-recy/260731-ulo-SUMMARY.md` when done, following the standard summary template with:
- What shipped (verbatim list of the 7 edits — 5 source + 2 test, plus C1-C4/C5)
- Test delta (baseline → post: 972 → 972+N passed, 6 skipped, 0 failed)
- Files touched (both file paths, absolute)
- Commit SHA on branch `feat/tab-title-from-tmux`
- Bounty slug: `mic-available-when-composebox-disabled` — status: ready for orchestrator to archive
- Explicit note: no push / no docker rebuild / no compose recreate performed (Ashley greenlights ship separately)
- Explicit note: no `~/.claude/identities/tina/*` edits (orchestrator handles skynet-patches.md and bounty archive)
</output>
