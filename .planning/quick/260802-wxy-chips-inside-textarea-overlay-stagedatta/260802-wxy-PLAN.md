---
phase: quick-260802-wxy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/use-pretty-view-uploads.ts
  - src/ui/features/pretty-view/use-pretty-view-uploads.test.ts
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.test.tsx
autonomous: true
requirements:
  - QUICK-260802-WXY
tags:
  - frontend
  - pretty-view
  - uploads
  - composebox
  - refactor

must_haves:
  truths:
    - "usePrettyViewUploads internally stores staged attachments per-target in a Map<string, StagedAttachment[]>"
    - "Existing consumers (ComposeBox) see NO behavior change — legacy `stagedAttachments` return field still mirrors the primary target"
    - "Hook exposes new `stageAttachments(target, files)` and `getStagedAttachments(target)` API"
    - "In ComposeBox main composebox, the AttachmentChipStrip renders INSIDE the primary textarea's wrapper (absolutely positioned, top-left) — not as a sibling above the compose rows"
    - "Textarea paddingTop grows dynamically to accommodate wrapping chip strip height so text baseline never underlaps chips"
    - "Chip strip only mounts when at least one primary-target attachment is staged (empty state adds no padding, no DOM element)"
    - "Queued-row textareas keep their current above-strip layout (unchanged in this quick)"
    - "Full frontend test suite passes with new tests green"
  artifacts:
    - path: "src/ui/features/pretty-view/use-pretty-view-uploads.ts"
      provides: "target-aware staging state model + new public API surface"
      contains: "stagedAttachmentsByTarget"
    - path: "src/ui/features/pretty-view/use-pretty-view-uploads.test.ts"
      provides: "target-aware API test coverage (isolation, mirroring, non-leakage)"
      contains: "target-aware API"
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "chip strip overlaid inside main textarea wrapper with dynamic padding-top"
    - path: "src/ui/features/pretty-view/ComposeBox.test.tsx"
      provides: "DOM-structure test asserting chip strip lives inside the textarea wrapper"
  key_links:
    - from: "use-pretty-view-uploads.ts return object"
      to: "ComposeBox stagedAttachments prop"
      via: "hook's legacy `stagedAttachments` field reads `map.get('primary') ?? []`"
      pattern: "stagedAttachmentsByTarget\\.get\\(\"primary\"\\)"
    - from: "ComposeBox chipStripRef"
      to: "textarea paddingTop"
      via: "useLayoutEffect + ResizeObserver measures offsetHeight and updates chipStripHeight state"
      pattern: "ResizeObserver"
    - from: "AttachmentChipStrip render site"
      to: "textarea wrapper div"
      via: "absolute-positioned inside the existing `<div className=\"relative flex-1 self-stretch\">` wrapper at ComposeBox.tsx:2009"
      pattern: "absolute.*top-0"
---

<objective>
Quick A of a paired ship (bounties #2 `attached-files-as-chips-in-textarea-per-message` +
#1 `adjust-visual-on-queued-messages`). Two pieces:

1. **Refactor** `usePrettyViewUploads` internal state from a flat `StagedAttachment[]` to
   `Map<string, StagedAttachment[]>` keyed by target ("primary" being the only producer in
   this quick), preserving outward behavior for existing callers.
2. **Move** the AttachmentChipStrip out of its current sibling-above-Row-1 location and
   overlay it INSIDE the primary textarea's wrapper (absolute top-left, with dynamic
   paddingTop on the textarea).

Purpose: Unlock per-queued-textarea attachments in Quick B without another state refactor,
and land the visual half of the bounty (chips inside textarea) for the primary composebox
now. Design was already agreed with the user — do NOT re-litigate.

Output: Refactored hook + relocated chip strip + updated tests, split into TWO atomic
commits (one per piece).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@src/ui/features/pretty-view/use-pretty-view-uploads.ts
@src/ui/features/pretty-view/use-pretty-view-uploads.test.ts
@src/ui/features/pretty-view/AttachmentChipStrip.tsx
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/ComposeBox.test.tsx
</context>

<scope_locks>
- Frontend-only. If a backend file needs to change, HALT and surface the scope conflict —
  do NOT touch backend files silently.
- Do NOT branch (already on `feat/tab-title-from-tmux` per orchestrator).
- Do NOT push, docker build, or docker compose. STOP after the second commit.
- Do NOT include skynet-patches.md or bounty-timeline edits — those are orchestrator work.
- Queued-row chip strips stay above-textarea in this quick (Quick B relocates them).
- Do NOT implement per-queued attach button, delete relocation, padding parity, or bounty
  #1's header restructure — those are Quick B scope, already carved out.
- Do NOT stage to any non-"primary" target from any producer in this quick — the state
  model accommodates it; no UI wires it yet.
</scope_locks>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Refactor usePrettyViewUploads to per-target Map state (+ new API + tests)</name>
  <files>
    src/ui/features/pretty-view/use-pretty-view-uploads.ts,
    src/ui/features/pretty-view/use-pretty-view-uploads.test.ts
  </files>
  <behavior>
    - New public API `stageAttachments(target: string, items)` — the CURRENT hook already
      exports a `stageAttachments(items)` method (see UsePrettyViewUploadsReturn line
      90-105). RENAME the current signature to accept `target` as the first arg. All
      existing internal call sites and public callers of the old zero-arg-target
      `stageAttachments(items)` must be updated to pass `"primary"` explicitly.
      Note: the paste path in ComposeBox and any other current caller passes items only;
      they must be updated to pass "primary" first. Search for callers with:
      `grep -rn "\\.stageAttachments(" src/ui/`.
    - New public API `getStagedAttachments(target: string): StagedAttachment[]` — returns
      `stagedAttachmentsByTarget.get(target) ?? []`.
    - Legacy public field `stagedAttachments: StagedAttachment[]` STAYS on the return
      object and its value equals `stagedAttachmentsByTarget.get("primary") ?? []`. This
      preserves ComposeBox's read path unchanged.
    - New tests to add in `describe("target-aware API", ...)`:
        1. `stageAttachments("primary", files)` sets `stagedAttachments` (legacy field) to
           length N with matching filenames and unique tempIds.
        2. `getStagedAttachments("q-slot-1")` returns `[]` when nothing has been staged to
           that target.
        3. Staging 2 files to "primary" leaves `getStagedAttachments("q-slot-1")` as `[]`
           AND `stagedAttachments` (legacy) length 2.
        4. Staging 2 files to "q-slot-1" leaves `stagedAttachments` (legacy = primary)
           empty AND `getStagedAttachments("q-slot-1")` length 2.
        5. `stagedAttachments` (legacy) equals `getStagedAttachments("primary")` after
           any staging — same array snapshot / identical contents.
        6. `resetBatch()` (the existing clear-primary API) does NOT clear "q-slot-1" —
           stage to both targets, call `resetBatch()`, assert `stagedAttachments`
           (primary) is empty and `getStagedAttachments("q-slot-1")` still has entries.
           (This confirms clear stays scoped to the primary chunk pump.)
    - ALL 14 existing tests in `use-pretty-view-uploads.test.ts` must continue to pass
      unchanged in behavior. The only mechanical edit permitted in existing tests is
      changing `result.current.stageAttachments([f1, f2])` call sites to
      `result.current.stageAttachments("primary", [f1, f2])` — nothing else.
    - Behavior invariant for the primary target: identical tempIds, batch progression,
      status transitions, folder-drop rejection, paste path, chunk pump ordering,
      backpressure, retry, disconnect handling — the primary target must behave exactly
      as today.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/use-pretty-view-uploads.ts`:

    1. **State + ref**: Replace `const [stagedAttachments, setStagedAttachments] =
       useState<StagedAttachment[]>([])` at ~line 124-126 with
       `const [stagedAttachmentsByTarget, setStagedAttachmentsByTarget] =
       useState<Map<string, StagedAttachment[]>>(() => new Map())`.
       Replace `const attachmentsRef = useRef<StagedAttachment[]>([])` at ~line 134 with
       `const attachmentsRefByTarget = useRef<Map<string, StagedAttachment[]>>(new Map())`.

    2. **`setAttachments` updater helper** (~lines 135-151): Rewrite as
       `setAttachments(target, updater)` — reads
       `stagedAttachmentsByTarget.get(target) ?? []` as prev, computes next via updater
       (support both plain-array and function forms), constructs a NEW Map via
       `new Map(prevMap).set(target, next)` (immutable so React re-renders), keeps
       `attachmentsRefByTarget.current` in sync by cloning + setting the same key.

    3. **Internal call-site sweep**: Every current `setAttachments(fn)` call site inside
       the hook (`stageAttachments`, `removeAttachment`, `handleServerEvent` upload_*
       cases, `retryBatch`, `resetBatch`, `pumpFile` error/status branches) becomes
       `setAttachments("primary", fn)`. There are ~10 call sites; do a full pass. Every
       `attachmentsRef.current` read becomes `attachmentsRefByTarget.current.get("primary")
       ?? []`. The chunk pump (`pumpBatch` at ~line 521) uses the PREFERRED APPROACH:
       iterate `attachmentsRefByTarget.current.values()` FLATLY as the initial target
       set — treat all targets identically since batch/status/progress logic is per-tempId,
       not per-target. Concretely: replace `const initialAttachments =
       attachmentsRef.current` at line 522 with:
       `const initialAttachments = Array.from(attachmentsRefByTarget.current.values())
       .flat()`.

    4. **`stageAttachments` signature change**: Change the outer signature to
       `stageAttachments(target: string, items: File[] | DataTransferItemList | FileList)`.
       The body's folder-check and file-normalize logic is unchanged; only the final
       `setAttachments((prev) => [...prev, ...newlyStaged])` becomes
       `setAttachments(target, (prev) => [...prev, ...newlyStaged])`.

    5. **New `getStagedAttachments(target)`**: Add a `useCallback` that reads
       `stagedAttachmentsByTarget.get(target) ?? []`. Include it in the returned useMemo
       and in its dep array; also include `stagedAttachmentsByTarget` in the useMemo dep
       array so a re-render of `getStagedAttachments`'s captured map fires when state
       changes (or make it read `attachmentsRefByTarget.current` — pick the pattern that
       matches how `stagedAttachments` (legacy) is derived; simplest is to also derive
       `getStagedAttachments` from `stagedAttachmentsByTarget` in the useMemo body so the
       closure sees the freshest map).

    6. **Legacy `stagedAttachments` field**: In the returned useMemo (~line 680-706),
       derive `const stagedAttachments = stagedAttachmentsByTarget.get("primary") ?? []`
       once at the top of the memo body (or before it) and include it in the returned
       object; update the useMemo dep array to depend on `stagedAttachmentsByTarget`
       instead of `stagedAttachments`.

    7. **Types**: Update `UsePrettyViewUploadsReturn` interface (~line 90-105):
       - `stageAttachments` becomes `(target: string, items: File[] |
         DataTransferItemList | FileList) => void`.
       - Add `getStagedAttachments: (target: string) => StagedAttachment[]`.
       - `stagedAttachments: StagedAttachment[]` STAYS (mirrors primary).
       Add a short comment above the interface explaining the "primary" convention
       (string type, no enum enforcement).

    8. **Caller sweep** for `stageAttachments` in ComposeBox (and anywhere else in
       `src/ui/`): run `grep -rn "\\.stageAttachments(" src/ui/` and update each call site
       to pass `"primary"` as the first arg. This is a mechanical edit; do NOT alter the
       surrounding logic.

    Edit `src/ui/features/pretty-view/use-pretty-view-uploads.test.ts`:

    9. In existing tests, mechanically update every `result.current.stageAttachments(
       [...])` call to `result.current.stageAttachments("primary", [...])`. Every other
       assertion stays the same. (Tests 1-14 exist today; grep the file and update each.)

    10. Append a new `describe("target-aware API (Quick 260802-wxy)", () => { ... })`
        block with the 6 tests enumerated in `<behavior>`. Use the same `MockWS` +
        `makeMockFile` helpers already in the file. No new test infrastructure needed —
        target-isolation checks are pure state-shape assertions on the return object.

    11. Commit ONLY after `npx tsc --noEmit` and `npm test -- --run
        src/ui/features/pretty-view/use-pretty-view-uploads.test.ts` both pass. Commit
        message:
        `refactor(uploads): stagedAttachments → per-target Map (Quick A of paired ship #2/#1)`
        Body should reference bounty slug `attached-files-as-chips-in-textarea-per-message`
        and note "Quick A of paired ship with adjust-visual-on-queued-messages (Quick B
        follows)."

    Do NOT edit ComposeBox.tsx's chip strip render location in this task — that's Task 2.
    In this task, ComposeBox.tsx changes are LIMITED to the mechanical `stageAttachments`
    caller sweep in step 8.
  </action>
  <verify>
    <automated>npx tsc --noEmit &amp;&amp; npm test -- --run src/ui/features/pretty-view/use-pretty-view-uploads.test.ts</automated>
  </verify>
  <done>
    - `use-pretty-view-uploads.ts` internally uses `Map&lt;string, StagedAttachment[]&gt;`
      state + ref keyed by target.
    - Public API exports `stageAttachments(target, items)` and `getStagedAttachments(target)`.
    - Legacy `stagedAttachments` field on the return object mirrors primary target.
    - All 14 existing tests pass with mechanical "primary" arg updates only.
    - 6 new target-aware API tests pass.
    - All `stageAttachments` call sites in `src/ui/` updated to pass `"primary"`.
    - `npx tsc --noEmit` clean.
    - Committed as commit #1 with message per action step 11.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Overlay AttachmentChipStrip inside main textarea wrapper + update tests</name>
  <files>
    src/ui/features/pretty-view/ComposeBox.tsx,
    src/ui/features/pretty-view/ComposeBox.test.tsx
  </files>
  <behavior>
    - When staged primary attachments exist, the chip strip element (queryable by
      `data-testid="attachment-chip-strip"` per AttachmentChipStrip.tsx line 65) is a
      DESCENDANT of the same wrapper div that contains the primary `<textarea>` element
      (the wrapper at ComposeBox.tsx line 2009: `<div className="relative flex-1
      self-stretch">`).
    - The chip strip element carries `absolute top-0 left-0` positioning classes.
    - The textarea's inline `style.paddingTop` grows to accommodate the chip strip's
      rendered height (measured via ResizeObserver). When no attachments are staged, the
      chip strip is NOT in the DOM (matching AttachmentChipStrip's return-null-when-empty
      contract at line 61) and the textarea's paddingTop falls back to its base value.
    - Chips wrap (existing `flex-wrap` in AttachmentChipStrip.tsx line 67 already handles
      this — no change needed to AttachmentChipStrip).
    - The chip strip is REMOVED from its former render site above the Row 1 instrument
      bar (currently at ComposeBox.tsx line 1408). No empty wrapper left behind.
    - The chip strip does NOT visually collide with the inside-textarea Send button
      (bottom-right) or Paperclip (bottom-left) — they sit at bottom-0.5 while the chip
      strip is anchored top-0.
    - Queued-row textareas (queueSlots stack at ~line 1775-onward) are UNCHANGED in this
      quick.
    - Existing ComposeBox tests updated: the current Test 2 ("chip strip mounts above
      the textarea") at ComposeBox.test.tsx line 71-88 asserts `strip.compareDocumentPosition(
      textarea) & 0x04` (textarea follows strip). AFTER the overlay move, the strip and
      textarea are siblings inside the same wrapper with the strip rendered FIRST (so it
      still document-precedes the textarea) — verify this holds and update the test's
      description/comment to reflect "strip is a descendant of the same wrapper as the
      textarea" if the DOM_POSITION_FOLLOWING assertion still passes; if positioning
      changes make it fail, replace the assertion with the descendant check described in
      the new test below.
    - Two new (or extended) tests in ComposeBox.test.tsx:
        A. **Chip strip renders inside the primary textarea wrapper.** Render ComposeBox
           with staged attachments; assert the chip strip's closest ancestor with class
           containing `relative` and `flex-1` (the textarea wrapper — the one at line
           2009) is the SAME node as the textarea's closest matching ancestor. Also
           assert the chip strip's `className` contains `absolute` (proves overlay
           positioning, not stacked layout).
        B. **No chip strip when empty.** Already covered by existing Test 1 — no change
           needed unless behavior differs; verify Test 1 still passes as-is.
    - `showPaperclip` visibility, disabled states, and the retry-affordance rendering
      logic are unchanged.
  </behavior>
  <action>
    Edit `src/ui/features/pretty-view/ComposeBox.tsx`:

    1. **Remove the current chip strip render site** at lines 1404-1411 (the
       `{/* Phase 05: chip strip ... */}` block that renders `<AttachmentChipStrip
       attachments={stagedAttachments ?? []} onRemove={onRemoveAttachment ?? (() =>
       {})} />` immediately below the composeRootRef opening div). Delete the entire
       block including the surrounding JSX comment. The retry-affordance block
       immediately after (lines 1412-1432) STAYS in place at its current location —
       do NOT relocate it.

    2. **Add refs + measurement state** near the other refs in the component (search for
       `const textareaRef = useRef&lt;HTMLTextAreaElement&gt;(null);` at line 341 and add
       adjacent):
       ```
       const chipStripRef = useRef&lt;HTMLDivElement | null&gt;(null);
       const [chipStripHeight, setChipStripHeight] = useState(0);
       ```

    3. **Add useLayoutEffect + ResizeObserver** to measure the chip strip's rendered
       height. Place near other layout effects (e.g. near the auto-grow useLayoutEffect
       at ~line 926). Sketch (DO NOT paste code as-is if the file structure demands
       adjustment — this is intent, not verbatim):
       - Watch `chipStripRef.current`. If null (empty state — chip strip returns null),
         set `chipStripHeight` to 0 and skip observer.
       - Otherwise construct a `ResizeObserver` that reads
         `entries[0].contentRect.height` (or `chipStripRef.current.getBoundingClientRect()
         .height`) and calls `setChipStripHeight(Math.ceil(height))`.
       - Observe `chipStripRef.current`.
       - Cleanup: `observer.disconnect()` in the effect's return.
       - Dep array: include `stagedAttachments` (or the length thereof) so the effect
         re-runs when the ref target appears/disappears — because a null-return
         AttachmentChipStrip unmounts, the ref.current transitions null↔element.

    4. **Wrap the chip strip inside the textarea wrapper** at line 2009. The wrapper
       currently is:
       ```
       &lt;div className="relative flex-1 self-stretch"&gt;
         &lt;Textarea ref={textareaRef} ... /&gt;
         ...other absolute children (armed overlay, paperclip, send button)...
       &lt;/div&gt;
       ```
       Add a NEW absolutely-positioned child at the TOP of this wrapper (before the
       Textarea), rendered only when the ComposeBox is not in a read-only/paste-only
       state (mirror the render conditions the previous site used — the old site had no
       explicit gate, relying on AttachmentChipStrip's null-when-empty; keep that same
       simplicity — no new gate). Sketch:
       ```
       &lt;div
         ref={chipStripRef}
         className="absolute top-0 left-0 right-0 z-10 px-2 pt-2 pointer-events-auto"
       &gt;
         &lt;AttachmentChipStrip
           attachments={stagedAttachments ?? []}
           onRemove={onRemoveAttachment ?? (() =&gt; {})}
         /&gt;
       &lt;/div&gt;
       ```
       Right-side clearance for Send/Paperclip is NOT needed at the chip-strip level
       because chips sit at TOP and Send/Paperclip sit at BOTTOM (right-1 bottom-0.5,
       left-1 bottom-0.5). If chip wrapping ever grows tall enough to visually approach
       the buttons, the buttons still sit at the textarea's bottom edge — no collision.

    5. **Dynamic textarea paddingTop**: Add an inline `style` prop to the Textarea at
       line 2010-2108. It currently has no `style` prop. Add:
       `style={ chipStripHeight &gt; 0 ? { paddingTop: `${chipStripHeight + 12}px` } :
       undefined }`
       (The `+ 12` mirrors the existing `py-3` base top padding — 12px — so text stays
       comfortably below the chips. Base `py-3` remains in the className unchanged; the
       inline `paddingTop` overrides only when chips are present.)

    6. **Skynet fs-* specificity trap**: Not expected to bite here (no html-level or
       root-level CSS), but if the paddingTop inline style is defeated by a `fs-*` class
       cascade elsewhere in the codebase, apply `!important` via inline
       `style={{ paddingTop: `${chipStripHeight + 12}px !important` as any }}` or via
       an ad-hoc class enumeration — do NOT silently drop the padding rule.

    7. **Verify no queued-row impact**: The queueSlots.map render at ~lines 1775-onward
       has its own Textarea rendered with its own wrapper (`<div key={slot.id}
       className="relative flex-1" ...>` at line 1823). Do NOT touch that block. Confirm
       queued rows still render whatever attachment presentation they had before
       (currently none per bounty premise — queued rows do not yet stage attachments).

    Edit `src/ui/features/pretty-view/ComposeBox.test.tsx`:

    8. **Update existing Test 2** (line 71-88): Its current assertion
       `strip.compareDocumentPosition(textarea) & 0x04` says "textarea comes after
       strip in document order." AFTER the overlay move, the strip is rendered FIRST
       inside the wrapper (top of children) followed by the Textarea, so
       DOM_POSITION_FOLLOWING should STILL hold. Keep the assertion but update the test
       name and comment to reflect the new invariant: "chip strip mounts INSIDE the
       textarea wrapper (still document-precedes the textarea, but as a sibling not a
       parent-container sibling)." Add an additional assertion:
       `expect(strip.className).toMatch(/absolute/)` — proves overlay positioning.

    9. **Add new test** in the same describe block, adjacent to Test 2. Name it e.g.
       "Test 2b: chip strip's parent wrapper is the same wrapper that contains the
       textarea." Logic:
       ```
       const strip = screen.getByTestId("attachment-chip-strip");
       const textarea = screen.getByPlaceholderText(/message/i);
       const stripWrapper = strip.closest("div.relative.flex-1");
       const textareaWrapper = textarea.closest("div.relative.flex-1");
       expect(stripWrapper).not.toBeNull();
       expect(stripWrapper).toBe(textareaWrapper);
       ```
       This is the load-bearing structural assertion — it will fail hard if a future
       refactor moves the strip out of the wrapper.

    10. Existing Test 1 ("no chip strip when stagedAttachments is empty") at line 57-69
        should continue to pass unchanged (empty state = AttachmentChipStrip returns
        null = chipStripHeight stays 0 = no padding change = no strip in DOM). Verify.

    11. Run BOTH the ComposeBox test file AND the full frontend test suite before
        committing:
        - `npx tsc --noEmit`
        - `npm test -- --run src/ui/features/pretty-view/ComposeBox.test.tsx`
        - `npm test -- --run` (full suite — chip-strip location may affect any
          unrelated test that reasoned about DOM structure; catch regressions).

    12. Commit as commit #2 with message:
        `feat(composebox): overlay chip strip inside main textarea (Quick A of paired ship #2/#1)`
        Body should reference bounty slug `attached-files-as-chips-in-textarea-per-message`
        and note "Quick A of paired ship with adjust-visual-on-queued-messages (Quick B
        follows)."
  </action>
  <verify>
    <automated>npx tsc --noEmit &amp;&amp; npm test -- --run src/ui/features/pretty-view/ComposeBox.test.tsx &amp;&amp; npm test -- --run</automated>
  </verify>
  <done>
    - Chip strip removed from its former render site above the Row 1 instrument bar (no
      empty wrapper remains).
    - Chip strip rendered as an absolutely-positioned child inside the primary textarea's
      wrapper div at ComposeBox.tsx:2009, with `absolute top-0 left-0 right-0 z-10`.
    - `chipStripRef` + `chipStripHeight` state + useLayoutEffect + ResizeObserver present
      and correctly wire the textarea's inline `paddingTop`.
    - When no attachments staged: chip strip absent from DOM, `chipStripHeight=0`,
      textarea paddingTop falls back to base `py-3`.
    - Queued-row rendering (queueSlots.map block) UNCHANGED.
    - Existing ComposeBox Test 1 passes unchanged.
    - Existing Test 2 updated with new name/comment + added `absolute` className
      assertion — passes.
    - New Test 2b (descendant-of-same-wrapper) passes.
    - `npx tsc --noEmit` clean.
    - Full frontend test suite green.
    - Committed as commit #2 with message per action step 12.
    - STOPPED. No push, no docker build, no compose up.
  </done>
</task>

</tasks>

<verification>
After both commits are in place:

1. `git log --oneline -3` shows the two new commits at HEAD:
   - `feat(composebox): overlay chip strip inside main textarea (Quick A of paired ship #2/#1)`
   - `refactor(uploads): stagedAttachments → per-target Map (Quick A of paired ship #2/#1)`
2. `npx tsc --noEmit` exits 0.
3. `npm test -- --run` exits 0.
4. `git status` clean (no untracked files, no unstaged changes) — otherwise flag
   surprise artifacts before returning.
5. No backend files (`src/server/**`, `docker/**`, `prisma/**`, backend routes) appear
   in `git diff HEAD~2..HEAD --name-only`. If any do, HALT — scope violation.
</verification>

<success_criteria>
- Two atomic commits landed on `feat/tab-title-from-tmux`.
- `usePrettyViewUploads` internally per-target, outwardly identical for existing callers.
- Chip strip visually overlaid inside the main textarea (top-left, wrapping).
- Textarea paddingTop grows/shrinks with chip strip height.
- All existing tests + 6 new hook tests + 1-2 new/updated ComposeBox tests pass.
- No backend edits. No push. No deploy.
- Executor STOPPED after commit #2 — deploy queue join is orchestrator's decision.
</success_criteria>

<output>
Create `.planning/quick/260802-wxy-chips-inside-textarea-overlay-stagedatta/260802-wxy-SUMMARY.md`
when done, summarizing:
- Two commits landed (SHAs + subjects).
- Files touched.
- Test result summary.
- Any deviations from plan (e.g. a call site the sweep didn't find until later, an
  unexpected fs-* interaction, a paddingTop tweak beyond `+ 12`).
- Explicit note: "Quick B (queued-row surgery + bounty #1's header restructure) still
  pending; state model is ready for per-target consumers."
</output>
