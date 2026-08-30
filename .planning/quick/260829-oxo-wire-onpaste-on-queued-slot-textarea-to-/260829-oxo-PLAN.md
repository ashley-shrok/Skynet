---
phase: quick-260829-oxo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx
autonomous: true
requirements: [quick-260829-oxo]
must_haves:
  truths:
    - "Ashley can paste a screenshot (or any file-shaped clipboard payload) into any queued-slot Textarea and the file is staged under target `queued:${slot.id}` via onAttachFilesForTarget — a chip renders in that slot's chip strip"
    - "Text pastes into a queued-slot Textarea still fall through to the browser default (no preventDefault, no attach call) — the '[pasted N lines]' collapse-avoidance path for text is preserved (byte-parity with the primary handlePaste text-branch behavior)"
    - "Primary composebox paste path (ComposeBox.tsx:2532 onPaste={handlePaste} → onAttachFiles) continues to work byte-identically — no regression, no widened signature on handlePaste, no touch to lines 497-506"
    - "A structured `[compose-paste]` log line fires from the new slot-scoped paste handler on any file-shaped paste, recording target and files.length (path was 100% un-instrumented before; logging is cheap)"
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Slot-scoped handlePasteForSlot inside QueuedRow + onPaste wire on the queued-slot Textarea at :3201"
      contains: "onPaste={handlePasteForSlot}"
    - path: "src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx"
      provides: "Regression suite for queued-slot paste routing"
      min_lines: 120
  key_links:
    - from: "QueuedRow.Textarea onPaste (ComposeBox.tsx ~:3201)"
      to: "onAttachFilesForTarget prop (threaded via handleOpenFilePicker/paperclip pattern)"
      via: "handlePasteForSlot slot-scoped useCallback inside QueuedRow"
      pattern: "onPaste=\\{handlePasteForSlot\\}"
    - from: "handlePasteForSlot file-branch"
      to: "onAttachFilesForTarget(target, files)"
      via: "e.preventDefault() + files.length > 0 gate (mirrors primary handlePaste :500-502)"
      pattern: "onAttachFilesForTarget\\?\\.\\(target,\\s*files\\)"
---

<objective>
Close the queued-slot paste gap Ashley live-reported. The primary composebox
Textarea (`ComposeBox.tsx:2532`) wires `onPaste={handlePaste}` where the
`handlePaste` useCallback at 497-506 reads `clipboardData.files` and calls
`onAttachFiles?.(files)`. The queued-slot Textarea at `ComposeBox.tsx:3201`
(inside `QueuedRow`, declared ~:2994) has NO `onPaste` prop — pasting a
screenshot into a queued slot falls through to the browser default and the
file is silently dropped. The paperclip → file-picker path for the same
queued slot already routes correctly through `onAttachFilesForTarget(target,
files)` with `target = \`queued:${slot.id}\`` (already declared at :3031),
so only the paste seam is missing.

Fix chosen shape: **(b) slot-scoped handler inside `QueuedRow`** (planner
picked b over the (a) parameterize-handlePaste option offered by the
orchestrator). One-line rationale: QueuedRow is already extracted, already
owns `target`, and already has `onAttachFilesForTarget` in its prop
signature. A new `handlePasteForSlot` useCallback inside QueuedRow
(byte-parallel to `handlePaste` at 497-506, but calling
`onAttachFilesForTarget?.(target, files)` instead of `onAttachFiles?.(files)`)
keeps the working primary path completely untouched and mirrors the
isolated-per-slot pattern nt9 established.

Purpose: Close a data-loss feature gap on a 100%-reproducible interaction
(paste screenshot into queued slot). Same defect class as nt9 (send-side
attachment silent-drop on queued slots), same fix philosophy (per-slot
target-aware routing, primary path preserved byte-identically).

Output: One production diff in `ComposeBox.tsx` (new slot-scoped useCallback
+ one `onPaste` prop wire + one structured log line) + one self-contained
regression test file. Zero prop-signature widening on the parent or primary
handler.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/ui/features/pretty-view/ComposeBox.tsx
@.planning/quick/260829-nt9-fix-queued-slot-send-silently-drops-atta/260829-nt9-PLAN.md
@.planning/quick/260829-nt9-fix-queued-slot-send-silently-drops-atta/260829-nt9-SUMMARY.md
@src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx

# Pre-planning verification (already performed by planner):
#
#   - Primary `handlePaste` at ComposeBox.tsx:497-506 is the exact shape to
#     mirror. It's a 3-line useCallback wrapping:
#         const files = Array.from(e.clipboardData?.files ?? []);
#         if (files.length > 0) { e.preventDefault(); onAttachFiles?.(files); }
#     DO NOT touch this — shape (b) leaves it byte-identical.
#
#   - Primary Textarea wire is at ComposeBox.tsx:2532 (`onPaste={handlePaste}`).
#     DO NOT touch this — shape (b) leaves it byte-identical.
#
#   - QueuedRow declaration starts at ComposeBox.tsx:2994. Its Textarea is
#     rendered at :3201 with existing `data-testid={queue-slot-textarea-${slot.id}}`
#     (:3217) — the test hook is already there. QueuedRow ALREADY receives
#     `onAttachFilesForTarget` implicitly through the paperclip pattern —
#     see :3303 `onClick={() => handleOpenFilePicker(target)}`. However,
#     grep on the QueuedRowProps interface at :2948-2992 shows
#     `handleOpenFilePicker` is threaded but the raw `onAttachFilesForTarget`
#     is NOT — the paperclip flows through the parent's file input dialog.
#
#     **Executor MUST verify at task 2 time**: which prop does QueuedRow
#     actually have access to for a synchronous per-target attach? Options:
#       (i)  Thread `onAttachFilesForTarget?: (target: string, files: File[]) => void`
#            through QueuedRowProps (add to interface at :2948-2992 + destructure
#            at :2994 + pass at the QueuedRow call site inside the parent's
#            queueSlots.map — grep parent for `<QueuedRow` to find the site).
#       (ii) OR reuse an existing prop that already reaches per-target attach.
#     Preference: (i). One prop threading, mirror how `getStagedAttachmentsForTarget`
#     and `clearStagedForTarget` are already threaded down (:2987-2988). Same
#     shape, same location in the interface.
#
#   - `target = \`queued:${slot.id}\`` is already declared inside QueuedRow at
#     :3031 — reuse it directly, do NOT recompute.
#
#   - Text-paste fallthrough is critical (COMPOSE-05 D-58/D-60 "[pasted N lines]"
#     collapse-avoidance path). Primary handlePaste at :500 gates on
#     `if (files.length > 0)` — file pastes get preventDefault + stage; text
#     pastes fall through to the browser default. The new slot handler MUST
#     mirror this exact gate — do NOT preventDefault on text-only paste.
#
#   - Logging: no `[compose-paste]` log currently exists in ComposeBox
#     (grep confirms zero hits). Executor adds ONE new log line inside the
#     new slot-scoped handler, ONLY on the file-paste branch, using the
#     existing `console.info` pattern (see :1136, :1140 — same style):
#         console.info(`[compose-paste] target=${target} files=${files.length}`);
#     Do NOT add a log to the primary handlePaste in this quick — separate
#     bounty if Ashley wants the primary path instrumented too.
#
#   - Existing test file `src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx`
#     (nt9's suite) is the template shape for the new file: same imports,
#     same `baseProps`, same `flushMountEffect`, same dynamic slot-ID capture
#     pattern via `document.querySelector("[data-slot-id]")`. Executor should
#     read it end-to-end before writing the new test file.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — add regression suite for queued-slot paste routing</name>
  <files>src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx</files>
  <behavior>
    New self-contained test file (DO NOT bloat the 4000+ line
    ComposeBox.test.tsx). Mirror the structure of the sibling
    `ComposeBox.queued-attachment.test.tsx` (nt9's suite) — same imports,
    same `baseProps` helper, same `flushMountEffect` helper, same dynamic
    slot-ID capture pattern via `document.querySelector("[data-slot-id]")`.

    4 tests exercising the queued-slot paste seam:

    Test 1 — "queued-slot Textarea paste with a file routes to onAttachFilesForTarget":
      Setup: render ComposeBox with `onAttachFilesForTarget = vi.fn()` (and
        `onAttachFiles = vi.fn()` as a negative-control stub); flush mount
        effects; click the "Queue a message" button to add one slot; capture
        the auto-generated slot ID from `document.querySelector("[data-slot-id]")`
        so `slotTarget = "queued:" + capturedId`; grab the slot's Textarea via
        `screen.getByTestId(\`queue-slot-textarea-${capturedId}\`)`.
      Action: construct a real File (`new File([bytes], "screenshot.png",
        { type: "image/png" })`); dispatch a paste event on the slot textarea.
        Two viable dispatch shapes — pick whichever works with jsdom's paste
        event synthesis:
          (a) `fireEvent.paste(slotTextarea, { clipboardData: { files: [file] } })`
          (b) construct a native ClipboardEvent and set `clipboardData.files`
              via a DataTransfer stub (see ComposeBox.test.tsx for prior art
              on `handlePaste` paste tests if a primary-textarea paste test
              exists there — mirror exactly).
        Executor: try (a) first; if the handler doesn't see `files`, fall
        back to (b) with a minimal `{ files: [file] }` object as clipboardData.
      Assert:
        - `onAttachFilesForTarget` called exactly once with
          `(slotTarget, <array-like containing file>)`.
        - `onAttachFiles` NOT called (proves the primary handler wasn't
          reused).
        - `e.preventDefault()` observable side effect: the file's name does
          NOT appear as literal text in the slot textarea's `value` (i.e.
          browser default text-insertion was suppressed).

    Test 2 — "queued-slot Textarea paste with TEXT ONLY falls through to browser default":
      Setup: same as Test 1 but no file — construct clipboardData with a
        string entry only. Executor may need to construct with
        `clipboardData: { files: [], getData: () => "pasted text" }` or
        equivalent — again mirror any existing text-paste test in the codebase
        if one exists (`grep -rn 'onPaste\\|clipboardData' src/ui/features/pretty-view/*.test.tsx`).
      Action: dispatch the paste event on the slot textarea.
      Assert:
        - `onAttachFilesForTarget` NOT called (files.length was 0).
        - `onAttachFiles` NOT called.
        - `e.preventDefault` was NOT called (browser default was allowed).
        Executor: verify preventDefault non-call via a spied event object or
        via checking the fireEvent.paste return value (returns false only if
        preventDefault fired).

    Test 3 — "primary composebox paste path still routes to onAttachFiles (backward-compat)":
      Setup: render ComposeBox with `onAttachFiles = vi.fn()` and
        `onAttachFilesForTarget = vi.fn()`; do NOT add any queued slots.
      Action: grab the primary Textarea (only textbox in the DOM); dispatch a
        paste event with one file.
      Assert:
        - `onAttachFiles` called exactly once with the file array (legacy
          primary path unchanged).
        - `onAttachFilesForTarget` NOT called (primary paste does NOT touch
          the target-aware entry point).
      This test guards against a regression where the executor accidentally
      widens the primary handlePaste to call onAttachFilesForTarget.

    Test 4 — "queued-slot paste with a file emits `[compose-paste]` log":
      Setup: spy on `console.info` (vi.spyOn(console, 'info')); same slot
        creation as Test 1.
      Action: paste one file into the slot textarea.
      Assert: `console.info` called at least once with a string matching
        /^\\[compose-paste\\] target=queued:.+ files=1$/.

    All 4 tests MUST FAIL against the pre-fix code (Task 1 lands as RED
    commit). Tests 1 + 4 fail because the slot Textarea has no onPaste
    wire at all. Test 2 fails because there's currently nothing to
    fall-through from (no handler exists to test). Test 3 passes from the
    start (primary path is not being changed) — that's the intentional
    guardrail.

    Note: If jsdom's paste-event synthesis proves problematic for these
    assertions (executor discovers at runtime), fall back to the same
    ClipboardEvent shim pattern used by any existing paste test in the
    codebase — do NOT invent a new pattern.
  </behavior>
  <action>Create the new test file `src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx` per the behavior block above. Mirror ComposeBox.queued-attachment.test.tsx's helpers (baseProps, flushMountEffect, dynamic slot-ID capture via `document.querySelector("[data-slot-id]")`). Do NOT bloat the primary ComposeBox.test.tsx. Verify all 4 tests FAIL against current code before proceeding to Task 2. Commit as RED with message `test(quick-260829-oxo): add queued-slot paste regression suite (RED)`.</action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx 2>&1 | grep -E "Tests|failed|passed"</automated>
  </verify>
  <done>4 tests present in the new file. Tests 1, 2, 4 FAIL against current code (RED gate satisfied — slot Textarea has no onPaste, no `[compose-paste]` log source, no fallthrough handler). Test 3 passes (primary path unchanged). Commit `test(quick-260829-oxo): add queued-slot paste regression suite (RED)` lands on `feat/tab-title-from-tmux`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — wire onPaste on queued-slot Textarea + structured log</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx</files>
  <behavior>
    Three focused changes, all inside `QueuedRow` (no touches to primary
    handlePaste at :497-506, no touches to primary onPaste wire at :2532):

    Change 1 — Thread `onAttachFilesForTarget` into QueuedRowProps:
      Add `onAttachFilesForTarget?: (target: string, files: File[]) => void;`
      to the `QueuedRowProps` interface (currently :2948-2992), positioned
      adjacent to the existing per-target props (near `getStagedAttachmentsForTarget`
      at :2987 and `clearStagedForTarget` at :2988). Destructure it in the
      QueuedRow function body at :2994 (append to the destructure list at
      :2995-3023). Grep the parent for `<QueuedRow` and add the prop pass at
      each call site — mirror how `getStagedAttachmentsForTarget` is already
      passed at that same site.

    Change 2 — New slot-scoped paste handler inside QueuedRow (byte-parallel
    shape to primary handlePaste at :497-506):
      Immediately after the `const target = \`queued:${slot.id}\`;` line at
      :3031 (or logically-close — early in QueuedRow before the JSX return),
      add:

        const handlePasteForSlot = useCallback(
          (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length > 0) {
              e.preventDefault();
              console.info(`[compose-paste] target=${target} files=${files.length}`);
              onAttachFilesForTarget?.(target, files);
            }
            // Text-only pastes fall through to the browser default so the
            // "[pasted N lines]" collapse-avoidance path (COMPOSE-05
            // D-58/D-60) is preserved verbatim — same rule as primary
            // handlePaste at ComposeBox.tsx:497-506.
          },
          [target, onAttachFilesForTarget],
        );

      Two invariants the executor MUST preserve:
        (i)  `if (files.length > 0)` gate — text-only pastes are ignored
             here so they fall through to the browser default. Do NOT call
             preventDefault outside this branch.
        (ii) `e.preventDefault()` runs BEFORE the onAttachFilesForTarget call
             (primary at :501-502 order). Prevents both the filename-as-text
             insertion AND any potential re-trigger.

    Change 3 — Wire the new handler onto the queued-slot Textarea at :3201:
      Add `onPaste={handlePasteForSlot}` to the Textarea's prop list. Place
      it immediately after `onBlur={...}` at :3211-3214 (mirror where primary
      has onPaste — right after onKeyDown at :2531-2532). Do NOT change any
      other props on this Textarea.

    Import hygiene: `useCallback` is already imported at ComposeBox.tsx:1
    (`import { useCallback, useEffect, useLayoutEffect, useRef, useState }
    from "react";`) — no new imports needed. React types
    (`React.ClipboardEvent<HTMLTextAreaElement>`) are already used at :498
    for the primary handler — same type.

    After changes: run scoped vitest for the new test file — all 4 tests
    MUST pass. Also run the sibling queued-attachment suite to confirm
    zero regressions in nt9's tests.
  </behavior>
  <action>Implement Change 1 (prop threading through QueuedRowProps + call site), Change 2 (new `handlePasteForSlot` useCallback inside QueuedRow mirroring primary handlePaste with target-aware call + `[compose-paste]` log), and Change 3 (wire `onPaste={handlePasteForSlot}` on the queued-slot Textarea at ~:3201). DO NOT modify primary handlePaste at :497-506 or the primary Textarea's onPaste wire at :2532. Commit as GREEN with message `fix(quick-260829-oxo): wire onPaste on queued-slot Textarea to onAttachFilesForTarget (GREEN)`.</action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx src/ui/features/pretty-view/ComposeBox.test.tsx 2>&1 | tail -20</automated>
  </verify>
  <done>All 4 tests in `ComposeBox.queued-slot-paste.test.tsx` pass. All pre-existing tests in `ComposeBox.queued-attachment.test.tsx` (nt9) still pass (zero regressions). All pre-existing tests in `ComposeBox.test.tsx` still pass (primary paste path untouched). `npx tsc --noEmit` exit 0. `grep -c 'onPaste' src/ui/features/pretty-view/ComposeBox.tsx | grep -v '^#'` returns 2 (primary at :2532 + new queued slot). Commit `fix(quick-260829-oxo): wire onPaste on queued-slot Textarea to onAttachFilesForTarget (GREEN)` lands on `feat/tab-title-from-tmux`.</done>
</task>

</tasks>

<verification>
Scoped test run (executor's green gate — do NOT run the full suite; that's
the orchestrator's ship gate):

```
npx vitest run \
  src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx \
  src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx \
  src/ui/features/pretty-view/ComposeBox.test.tsx
```

Expected: all files pass, exit 0. If any pre-existing test regresses,
STOP — the change touched something it shouldn't have.

TypeScript check:

```
npx tsc --noEmit
```

Expected: exit 0, zero errors.

Sanity greps (executor may run these to self-check):

```
# Primary handlePaste at :497-506 unchanged (byte-identical):
grep -n "onAttachFiles?" src/ui/features/pretty-view/ComposeBox.tsx | grep -v ForTarget

# Primary Textarea onPaste wire at :2532 unchanged:
grep -n "onPaste={handlePaste}" src/ui/features/pretty-view/ComposeBox.tsx

# New slot-scoped wire present exactly once:
grep -n "onPaste={handlePasteForSlot}" src/ui/features/pretty-view/ComposeBox.tsx

# Structured log source present exactly once (comment-safe count):
grep -v '^#' src/ui/features/pretty-view/ComposeBox.tsx | grep -c '\[compose-paste\]'
# Expected: 1
```
</verification>

<success_criteria>
- File `src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx` exists with 4 tests.
- Test 1 (queued paste with file → onAttachFilesForTarget): PASS.
- Test 2 (queued paste text-only → fallthrough, no preventDefault, no attach): PASS.
- Test 3 (primary paste unchanged → onAttachFiles): PASS.
- Test 4 (`[compose-paste]` log fires with target + files.length): PASS.
- Sibling `ComposeBox.queued-attachment.test.tsx` still passes 6/6 (nt9 zero-regression).
- `ComposeBox.test.tsx` still passes (primary paste path untouched — byte-identical).
- Primary `handlePaste` at ComposeBox.tsx:497-506 is byte-identical (only whitespace/formatting must remain unchanged).
- Primary Textarea `onPaste={handlePaste}` at :2532 is byte-identical.
- `QueuedRow` has a new `handlePasteForSlot` useCallback that calls
  `onAttachFilesForTarget?.(target, files)` behind an `if (files.length > 0) { e.preventDefault(); ... }` gate.
- Queued-slot Textarea at ~:3201 has `onPaste={handlePasteForSlot}` wired.
- `console.info` line matching `/^\\[compose-paste\\] target=queued:.+ files=\\d+$/` fires on the file-paste branch only.
- Two atomic commits on `feat/tab-title-from-tmux`: RED (test file only, fails) + GREEN (fix, tests pass).
- `npx tsc --noEmit` exit 0.
- NOT pushed. NOT built. NOT deployed. Executor stops at code + commit + scoped tests green.
- ROADMAP.md, STATE.md, `skynet-patches.md` NOT modified by executor (orchestrator scope).
- PLAN.md, SUMMARY.md NOT committed by executor (orchestrator's docs commit).
</success_criteria>

<output>
No SUMMARY.md creation by the executor for this quick — orchestrator (tanya)
writes the SUMMARY at wrap-up time. Executor's remit ends at code + two
atomic commits (RED + GREEN) + scoped vitest exit 0 + `npx tsc --noEmit`
exit 0.
</output>
