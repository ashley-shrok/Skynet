---
phase: 260730-vtk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.test.tsx
autonomous: true
requirements:
  - move-attach-button-left-of-textarea
must_haves:
  truths:
    - "Paperclip button no longer renders in Row 1's aux-button group (flex-row) container"
    - "When showPaperclip=true, a Paperclip button renders INSIDE the Row 2 textarea wrapper as a sibling of the Send button"
    - "Paperclip sits at the LEFT (absolute left-1 bottom-0.5) mirroring Send's right-1 bottom-0.5 position"
    - "Paperclip's aria-label='Attach file' and title='Attach file' are preserved verbatim so existing Test 3/4/5 continue to pass"
    - "When showPaperclip=true the Textarea gets pl-10 to reserve left-side room for the 40x40 hit target"
    - "New regression-guard Test 4b asserts Paperclip and Send share the same .relative.flex-1 wrapper ancestor"
    - "`npx tsc --noEmit` passes with no type errors"
    - "`npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` — all tests pass"
    - "Full vitest suite passes; `grep -E 'FAIL|failed|✗' /tmp/build.log` shows no compose-related failures"
  artifacts:
    - path: src/ui/features/pretty-view/ComposeBox.tsx
      provides: "Paperclip removed from Row 1 aux group; Paperclip added inside Row 2 textarea wrapper as sibling of Send; Textarea gets conditional pl-10"
      contains: "absolute left-1 bottom-0.5"
    - path: src/ui/features/pretty-view/ComposeBox.test.tsx
      provides: "New Test 4b regression guard for Paperclip/Send shared-wrapper position"
      contains: "Test 4b"
  key_links:
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (Row 2 textarea wrapper `<div className='relative flex-1 self-stretch'>`)"
      to: "New Paperclip <button> + existing Send <button>"
      via: "sibling <button> elements absolutely positioned inside the same .relative wrapper"
      pattern: "absolute left-1 bottom-0\\.5"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (Textarea className cn())"
      to: "showPaperclip prop"
      via: "conditional `showPaperclip && 'pl-10'` inside cn()"
      pattern: "showPaperclip && \"pl-10\""
    - from: "src/ui/features/pretty-view/ComposeBox.test.tsx (Test 4b)"
      to: "shared wrapper assertion"
      via: ".closest('.relative.flex-1') + .contains(sendButton)"
      pattern: "closest\\(.*relative"
---

<objective>
Move the Paperclip attach button from Row 1's aux-button group to inside the Row 2 textarea wrapper on the LEFT side, mirroring the Send button's inside-textarea pattern (bare `<button>` at absolute right-1 bottom-0.5) that Send uses on the RIGHT. Also reserve `pl-10` on the Textarea when the Paperclip is visible, and add a regression-guard test.

Purpose: Ashley's next pinned bounty (`move-attach-button-left-of-textarea`). Puts the attach affordance directly next to the composition surface where files will end up, mirroring the Send button's inside-textarea treatment so both compose-primary actions share the same visual pattern.

Output: A single atomic commit touching ComposeBox.tsx (remove + add + padding) and ComposeBox.test.tsx (new Test 4b regression guard). No push, no build, no deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/ComposeBox.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Move Paperclip from Row 1 aux group into Row 2 textarea wrapper (LEFT of textarea) + add regression test</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx, src/ui/features/pretty-view/ComposeBox.test.tsx</files>
  <behavior>
    - Test 3 (existing, unchanged): showPaperclip=false → `queryByLabelText(/attach file/i)` is null. MUST still pass — aria-label is preserved verbatim on the new button.
    - Test 4 (existing, unchanged): showPaperclip=true → `getByLabelText(/attach file/i)` returns an element. MUST still pass.
    - Test 5 (existing, unchanged): clicking the paperclip triggers the hidden file input's `.click()`. MUST still pass — `onClick={handleOpenFilePicker}` is preserved on the new button.
    - Test 4b (NEW regression guard): showPaperclip=true → the Paperclip button (looked up via `getByLabelText(/attach file/i)`) has a closest `.relative.flex-1` ancestor, AND that ancestor `.contains()` the Send button (looked up via `getByRole('button', { name: 'Send' })`). Fails if Paperclip is not inside the textarea wrapper, or if Paperclip and Send end up in separate wrappers.
  </behavior>
  <action>
    Perform four coordinated edits in a single atomic commit. Read the full file first (~1858 lines) to get exact current text for Edit tool matches — line numbers below are indicative, not literal offsets.

    (1) REMOVE Row 1 aux-group Paperclip block in `src/ui/features/pretty-view/ComposeBox.tsx`:
      - Delete the leading comment block at ~L1345-1352 that begins with "Paperclip attach button (Phase 05 UPLOAD-03). Gated by ..." and describes the paperclip's warm-neutral Glass treatment.
      - Delete the `{showPaperclip && ( <Button size="icon-sm" variant="outline" onClick={handleOpenFilePicker} ... > <Paperclip className="size-4" /> </Button> )}` JSX block at ~L1353-1378.
      - Update the aux-group container comment at ~L1338-1343 (currently "Aux-button group — least-used (paperclip) on the left, most-used (Queue) on the right, mirroring distance-from-meter logic. Converted from flex-col to flex-row for the horizontal Row 1 layout. Patch #83 marker: ... Patch #84 marker: ...") so the opening sentence reflects that Paperclip is no longer in this group. Suggested rewrite: "Aux-button group — Paperclip moved OUT to inside the Row 2 textarea (2026-07-30 vtk, mirroring Send on the LEFT); this group now hosts Stop, ThumbsUp, Lightbulb, Target, Queue, Hourglass with most-used (Queue) on the right, mirroring distance-from-meter logic." KEEP the "Patch #83 marker" and "Patch #84 marker" sentences intact verbatim so those historical markers survive.

    (2) ADD new inside-textarea Paperclip `<button>` in the Row 2 wrapper in the same file:
      - Locate the textarea wrapper `<div className="relative flex-1 self-stretch">` at ~L1605.
      - Insert the new Paperclip button as a sibling of the Send `<button>` at ~L1773 (INSIDE the same wrapper, before the `{showRecordingControls ? ... : ...}` conditional OR immediately after the existing pending-overlay block — both are inside the same wrapper and either placement is fine; recommend adding it just before the Send button's containing `{showRecordingControls ? ...}` block so the JSX order reads: pending overlay → Paperclip → send/recording slot).
      - Use a bare `<button type="button">`, NOT the shadcn `Button` component, to sidestep the wrapper-specificity trap called out in patch #129's comment.
      - Include a short leading comment: "Quick 260730-vtk: Paperclip attach button moved from Row 1 aux group to here per Ashley 2026-07-30. Mirrors Send's inside-textarea pattern on the LEFT (Send is right-1 bottom-0.5; Paperclip is left-1 bottom-0.5). Bare <button> not shadcn Button — same reason as Send (#129 wrapper-specificity trap). aria-label / title / onClick preserved verbatim from the old aux-group Paperclip so Tests 3/4/5 keep passing."
      - Gate on `{showPaperclip && ( ... )}` — unchanged `showPaperclip` prop semantics per the prop doc-comment at ~L184-189.
      - Attributes on the new `<button>`:
        - `type="button"`
        - `onClick={handleOpenFilePicker}` — same handler as the removed aux-group button.
        - `disabled={canSend === false || asideActive === true || recycleActive === true}` — same disable rule as the removed aux-group button.
        - `aria-label="Attach file"` — VERBATIM (existing Test 3/4/5 depend on this literal string via `/attach file/i`).
        - `title="Attach file"` — VERBATIM.
        - `className={cn( "absolute left-1 bottom-0.5", "p-2", "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]", "disabled:text-[rgba(240,235,224,0.15)]", "disabled:cursor-not-allowed", "transition-[color,transform] duration-120", "active:scale-95", "cursor-pointer", )}` — mirrors Send's non-morphed branch at ~L1782-1798 (LEFT positioning instead of RIGHT; no `asideActive` morph — Paperclip has no morph state).
      - Icon: `<Paperclip className="size-6" />` — 24×24 matches Send's paper-plane at 24×24, NOT the removed aux-group's `size-4`. The `Paperclip` import from lucide-react already exists in the file (was used by the removed aux-group button); confirm it's still imported after the removal — if the ONLY consumer was the removed block, keep the import (the new button uses it). If tsc flags an unused import elsewhere, don't remove it — it IS consumed by the new button.

    (3) UPDATE the Textarea className for LEFT-side padding when Paperclip is present:
      - Locate the Textarea's className `cn(...)` block at ~L1634-1684, specifically the `"pr-10"` line at ~L1677 with the preceding comment block at ~L1671-1676.
      - Change `"pr-10",` to `"pr-10",` followed by `showPaperclip && "pl-10",` on a new line inside the same `cn(...)` (matches the file's existing cn-conditional pattern — cn accepts truthy/falsy string arguments).
      - Add a short leading comment on the new `pl-10` line: "Quick 260730-vtk: mirrors the `pr-10` above on the LEFT when the inside-textarea Paperclip is present (showPaperclip=true → 40px hit target at absolute left-1 bottom-0.5 needs matching left padding on the Textarea so text doesn't underlap the icon)."

    (4) ADD Test 4b in `src/ui/features/pretty-view/ComposeBox.test.tsx`:
      - Insert between Test 4 (~L104-116) and Test 5 (~L118) inside the existing `describe("ComposeBox — Phase 05 upload wiring", ...)` block.
      - Test body (follow the file's existing style — see the DOM_POSITION check at L84-87 for `.compareDocumentPosition` / DOM-relationship assertion patterns):
        ```
        it("Test 4b: paperclip renders INSIDE the textarea wrapper (sibling of Send), not in the Row 1 aux group", () => {
          render(
            <ComposeBox
              {...baseProps({
                stagedAttachments: [],
                onRemoveAttachment: vi.fn(),
                showPaperclip: true,
                onAttachFiles: vi.fn(),
              })}
            />,
          );
          const paperclip = screen.getByLabelText(/attach file/i);
          const sendButton = screen.getByRole("button", { name: "Send" });
          // Regression guard: paperclip and send must share the same
          // `.relative.flex-1` textarea wrapper ancestor. If a future
          // refactor moves paperclip back to Row 1 or into a separate
          // wrapper, `.closest` returns null OR the ancestor won't
          // contain the send button — either way this test fails.
          const wrapper = paperclip.closest(".relative.flex-1");
          expect(wrapper).not.toBeNull();
          expect(wrapper?.contains(sendButton)).toBe(true);
        });
        ```
      - No new imports needed — `render`, `screen`, `vi`, `baseProps` are already imported at the top of the file.

    Do NOT modify tina.md, skynet-patches.md, or anything under `~/.claude/identities/tina/` — Tina (the orchestrator) handles bookkeeping AFTER. Do NOT touch the Send button, mic slot, RecordingControls, pending overlay, or the mobile `max-md:size-12` overrides on the OTHER aux-group buttons (Stop, ThumbsUp, Lightbulb, Target, Queue, Hourglass). Do NOT change `showPaperclip` prop semantics or its default handling in PrettyView.

    After the edits, commit atomically with an imperative message (no push):
    `git add src/ui/features/pretty-view/ComposeBox.tsx src/ui/features/pretty-view/ComposeBox.test.tsx && git commit -m "move paperclip inside textarea on left, mirror send"`
    (or similar; standard fork commit-message shape per the branch's existing style).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit &amp;&amp; npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx &amp;&amp; npx vitest run --reporter=verbose 2>&amp;1 | tee /tmp/build.log &amp;&amp; ! grep -E "FAIL|✗" /tmp/build.log | grep -v '^#' | head -20 | grep -q .</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` exits 0 with no type errors.
    - `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` — ALL ComposeBox tests pass, including existing Tests 3/4/5 (they depend on `aria-label="Attach file"` being preserved verbatim) AND the new Test 4b regression guard.
    - Full suite: `npx vitest run --reporter=verbose 2>&1 | tee /tmp/build.log` completes; `grep -E "FAIL|failed|✗" /tmp/build.log | head -20` shows no compose-related failures (the grep-verify step catches the tina.md-flagged #209→#211 regression pattern where a vitest "0 failed" summary hid actual failures).
    - Row 1 aux-group Paperclip block is gone (grep `Paperclip className="size-4"` in ComposeBox.tsx returns 0 matches).
    - Row 2 textarea wrapper contains a new bare `<button>` with `aria-label="Attach file"` and `className` containing `absolute left-1 bottom-0.5` (grep `absolute left-1 bottom-0\.5` in ComposeBox.tsx returns exactly 1 match — the new Paperclip button; Send uses `right-1 bottom-0.5`).
    - Textarea className contains `showPaperclip && "pl-10"` (grep `showPaperclip && "pl-10"` returns 1 match).
    - One atomic commit created on `feat/tab-title-from-tmux`. NOT pushed. NOT built. NOT deployed. tina.md / skynet-patches.md / identity files UNTOUCHED.
  </done>
</task>

</tasks>

<verification>
Manual grep spot-checks after Task 1:
- `grep -n "Paperclip className" src/ui/features/pretty-view/ComposeBox.tsx` — should show exactly 1 result: `<Paperclip className="size-6" />` in the new inside-textarea button. The old `size-4` aux-group version is gone.
- `grep -n "absolute left-1 bottom-0.5" src/ui/features/pretty-view/ComposeBox.tsx` — exactly 1 match (new Paperclip button).
- `grep -n "absolute right-1 bottom-0.5" src/ui/features/pretty-view/ComposeBox.tsx` — at least 1 match (existing Send button — unchanged).
- `grep -n "aria-label=\"Attach file\"" src/ui/features/pretty-view/ComposeBox.tsx` — exactly 1 match (on the new bare `<button>` — verbatim preserved).
- `grep -n "showPaperclip && \"pl-10\"" src/ui/features/pretty-view/ComposeBox.tsx` — exactly 1 match (Textarea cn conditional).
- `grep -n "Test 4b:" src/ui/features/pretty-view/ComposeBox.test.tsx` — exactly 1 match (new regression-guard test).

Git state after commit:
- `git log --oneline -1` shows the new atomic commit on `feat/tab-title-from-tmux`.
- `git status` is clean (no unstaged changes, no untracked files touched under `~/.claude/identities/tina/`).
- No push has occurred (`git status -sb` shows local branch ahead of origin by 1 commit).
</verification>

<success_criteria>
1. Paperclip has moved: NOT in Row 1's `flex flex-row gap-1` aux-button group; IS inside the Row 2 `<div className="relative flex-1 self-stretch">` textarea wrapper as a sibling of the Send `<button>`.
2. Position mirrors Send: Paperclip at `absolute left-1 bottom-0.5` (LEFT); Send unchanged at `absolute right-1 bottom-0.5` (RIGHT).
3. Icon size matches Send: `size-6` (24×24), not the removed aux-group's `size-4`.
4. Textarea padding: `pl-10` reserved conditionally on `showPaperclip` (mirrors existing `pr-10` for Send).
5. Existing behavior preserved: `aria-label="Attach file"`, `title="Attach file"`, `onClick={handleOpenFilePicker}`, `disabled={canSend===false || asideActive===true || recycleActive===true}` — all verbatim from the removed aux-group button.
6. Tests: Existing Test 3/4/5 pass unchanged (aria-label preserved), new Test 4b passes (regression guard: Paperclip and Send share same `.relative.flex-1` wrapper).
7. tsc: 0 errors. Full vitest suite: 0 compose-related failures (independently verified via `grep -E "FAIL|failed|✗" /tmp/build.log`).
8. One atomic commit, no push, no build, no deploy. Identity/bookkeeping files untouched.
</success_criteria>

<output>
Create `.planning/quick/260730-vtk-move-attach-button-inside-textarea-on-le/260730-vtk-01-SUMMARY.md` when done, capturing:
- The four edits actually applied (before/after snippets for the aux-group deletion, new inside-textarea button, textarea pl-10 addition, Test 4b insertion).
- Test results (vitest counts for the ComposeBox file and the full suite).
- The single commit SHA on `feat/tab-title-from-tmux`.
- Confirmation that push/build/deploy did NOT occur and no identity/bookkeeping files were touched.
</output>
