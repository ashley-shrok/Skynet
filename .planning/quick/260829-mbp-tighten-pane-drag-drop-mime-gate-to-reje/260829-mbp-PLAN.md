---
phase: quick-260829-mbp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/shell/SplitView.tsx
  - src/ui/shell/SplitView.text-selection-drag.test.tsx
autonomous: true
requirements:
  - QUICK-260829-MBP-01
must_haves:
  truths:
    - "A browser text-selection drag (dataTransfer.types = ['text/plain'] only, no skynet MIMEs) hovering over a Pane in a multi-view split does NOT render the coral drop-preview overlay."
    - "A browser text-selection drag released on a Pane does NOT invoke onOpenSessionInTree and does NOT invoke onDropRowInTree — the fallback text/plain=<selected-text> branch is unreachable for this drag shape."
    - "A badge drag (dataTransfer carries BOTH application/x-skynet-badge AND text/plain=<tabId>) still renders the coral drop-preview overlay on dragOver AND still invokes onOpenSessionInTree(<tabId>, path, edge) on drop — the tighter gate does not break the intended rearrange flow."
    - "A row drag (dataTransfer carries application/x-skynet-row + text/plain=<tabId>) still passes the gate and dispatches via the rich branch (onDropRowInTree) — unchanged from current behavior."
  artifacts:
    - path: "src/ui/shell/SplitView.tsx"
      provides: "All three Pane native drag listeners (onDragOver, onDragLeave, onDrop) gate on presence of at least one skynet-owned MIME (application/x-skynet-badge OR application/x-skynet-row), not on text/plain."
      contains: "application/x-skynet-badge"
    - path: "src/ui/shell/SplitView.text-selection-drag.test.tsx"
      provides: "Regression suite: negative (text-selection drag) + positive-control (badge drag) tests for the tightened gate."
      exports: []
  key_links:
    - from: "src/ui/shell/SplitView.tsx"
      to: "IdentityBadge dragstart wire contract (application/x-skynet-badge + text/plain=<tabId>)"
      via: "onDrop text/plain fallback branch at SplitView.tsx:362 — MUST remain reachable for badge drags after the gate change"
      pattern: "application/x-skynet-badge"
    - from: "src/ui/shell/SplitView.tsx"
      to: "row-drag rich payload (application/x-skynet-row JSON)"
      via: "onDrop rich branch at SplitView.tsx:340-360 — MUST remain reachable for row drags after the gate change"
      pattern: "application/x-skynet-row"
---

<objective>
Tighten the Pane drag/drop MIME gate in `src/ui/shell/SplitView.tsx` so browser text-selection drags no longer trigger the coral drop-preview overlay or land as fake-tabId drops on a Pane. All three native drag listeners (`onDragOver` :262, `onDragLeave` :292, `onDrop` :315) currently gate on `e.dataTransfer?.types.includes("text/plain")`, which is too weak — browser text-selection drags ALSO carry `text/plain` (the selected string). Ashley UAT: highlight text → drag → hover Pane edge → coral zone renders → release → `payloadTabId = <selected-text>` flows through `onOpenSessionInTree`, AppShell can't resolve it, and the new split slot renders the `Session no longer exists` placeholder at `src/ui/shell/SplitView.tsx:436`.

Purpose: Prevent an accidental interaction pattern (highlight-then-drag in a pane) from silently creating stale split slots. The rich/fallback dispatch logic below the gate is correct — the gate itself is the wrong discriminator.

Output:
- One production-code edit to `src/ui/shell/SplitView.tsx` (three gate lines + one rationale-comment update at :287-292; optionally a small `hasSkynetDragPayload` helper — executor's discretion, both shapes acceptable).
- One new regression test file `src/ui/shell/SplitView.text-selection-drag.test.tsx` (do NOT bloat the 481+ line existing `SplitView.test.tsx`).
- No changes to the onDrop rich/fallback dispatch below the gate (:340-369). No changes to AppShell outer onDrop (patch #510). No touch to the isolate stacking-context patch (fh3, #524) or CollapsedPanelCloseLane (ih3, #525).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/shell/SplitView.tsx
@src/ui/shell/SplitView.test.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx

Read specifically:
- `src/ui/shell/SplitView.tsx` lines 240-395 — the full Pane native-drag `useEffect` block and the rationale comments explaining WHY native listeners (patch #514) and WHY the type-gate (patch #510 + plan-check finding #3 comment at :287-292).
- `src/ui/shell/SplitView.tsx` lines 340-369 — the onDrop rich/fallback dispatch that MUST remain reachable for both application/x-skynet-row (rich, row-drag) AND text/plain (fallback, badge-drag) once past the tightened gate.
- `src/ui/shell/SplitView.test.tsx` lines 300-486 — mount pattern, `findPaneOuter` walker (matches the `relative isolate flex flex-col` className on the Pane outer div per patch #517/fh3 rename), `dispatchDragOverAt` + `dispatchDropAt` helpers using `createEvent.dragOver`/`createEvent.drop` + `Object.defineProperty` for clientX/Y (jsdom doesn't honor init object clientX/Y for DragEvent), and the existing `data-testid="pane-drop-preview-overlay"` assertion pattern at :518+.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` lines 4076-4091 — `makeConvListDataTransferStub` shape (Map-backed store with `getData`, `setData`, `types` getter, `effectAllowed`) which is the reference dataTransfer stub for the new test file.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` lines 4366-4398 — Test I of Phase 58 Plan 02, which locks the IdentityBadge dragstart wire contract: badge sources write BOTH `application/x-skynet-badge` (JSON with tabId) AND `text/plain=<tabId>`. The positive-control test in this plan mirrors that payload shape.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Tighten Pane MIME gate + add regression suite (RED → GREEN in one atomic pair)</name>
  <files>
    src/ui/shell/SplitView.tsx
    src/ui/shell/SplitView.text-selection-drag.test.tsx
  </files>
  <behavior>
    New test file `src/ui/shell/SplitView.text-selection-drag.test.tsx` under a single top-level describe (suggested: `SplitView Pane — text-selection drag rejection (tightened MIME gate)`).

    Fixtures and helpers (self-contained; do not import from SplitView.test.tsx):
    - Reuse the same `SplitNode leaf(tabId)` / `makeTab(id, label)` fixture shape as in SplitView.test.tsx lines 52-71.
    - Copy the `findPaneOuter(from: HTMLElement): HTMLElement` walker verbatim (matches the `relative isolate flex flex-col` className added by patch #517/fh3).
    - Copy the `dispatchDragOverAt(el, clientX, clientY, dataTransfer?)` and `dispatchDropAt(el, clientX, clientY, dataTransfer)` helpers verbatim (they use `createEvent.dragOver` / `createEvent.drop` + `Object.defineProperty` for clientX/Y — jsdom does NOT honor init-object clientX/Y for DragEvent). CRITICAL: the copied helpers must NOT force `types: ["text/plain"]` into the stub — this plan's whole point is that the caller controls the exact `types[]` and `getData` payload. If reusing the existing helpers verbatim would pre-inject text/plain into every stub, adapt the helpers so caller-supplied dataTransfer is used AS-IS (no spread-defaults on types).
    - Use the `makeConvListDataTransferStub(entries)` shape from PrettyConversationsPanel.test.tsx:4079 (Map-backed store with `getData`, `setData`, `types` getter, `effectAllowed`) — reproduce it inline in the new test file for isolation.
    - Standard mount: `render(<SplitView splitTree={leaf("aaa")} tabs={[tabA]} onOpenSessionInTree={onOpenSessionInTree} onDropRowInTree={onDropRowInTree} />)`, then `findPaneOuter(container.querySelector("[data-tab-id]") as HTMLElement)` to get the outer div, then mock its `getBoundingClientRect` to a known rect (e.g. 200x100 at origin) so `computeEdgeZone` resolves deterministically.

    Tests (four total — the three negative + one positive-control specified in the task brief, plus one extra for the row-drag branch to prevent quiet breakage):

    Test 1 (NEGATIVE — text-selection drag does NOT render coral overlay on dragOver):
    - dataTransfer stub with entries `{ "text/plain": "some highlighted user text" }` — ONLY text/plain, no skynet MIMEs.
    - `dispatchDragOverAt(paneOuter, 10, 50, dtStub)` (10px from left of a 200x100 rect → would resolve to 'left' zone if the gate passed).
    - Assert `container.querySelector('[data-testid="pane-drop-preview-overlay"]')` is null.

    Test 2 (NEGATIVE — text-selection drop does NOT call onOpenSessionInTree):
    - Same dataTransfer stub shape as Test 1.
    - `dispatchDropAt(paneOuter, 10, 50, dtStub)`.
    - Assert `onOpenSessionInTree` mock was NOT called (`.not.toHaveBeenCalled()`).

    Test 3 (NEGATIVE — text-selection drop does NOT call onDropRowInTree):
    - Same dataTransfer stub shape as Test 1 (no application/x-skynet-row present).
    - `dispatchDropAt(paneOuter, 10, 50, dtStub)`.
    - Assert `onDropRowInTree` mock was NOT called.
    (Tests 2 and 3 MAY be combined into one `it()` block if the executor prefers — both assertions on the same drop event.)

    Test 4 (POSITIVE-CONTROL — badge drag still renders overlay + still calls onOpenSessionInTree):
    - dataTransfer stub with BOTH entries: `{ "application/x-skynet-badge": JSON.stringify({ tabId: "tab-alice-1" }), "text/plain": "tab-alice-1" }` (mirrors the IdentityBadge dragstart wire contract locked at PrettyConversationsPanel.test.tsx:4366-4398).
    - `dispatchDragOverAt(paneOuter, 10, 50, dtStub)` → assert overlay IS rendered (`not.toBeNull()`).
    - `dispatchDropAt(paneOuter, 10, 50, dtStub)` → assert `onOpenSessionInTree` was called ONCE with `("tab-alice-1", [], "left")` (path=[] for single-leaf tree, edge='left' at x=10 of 200-wide rect).
    - This test PROVES the tighter gate does not break the badge rearrange flow — without it, a regression that over-tightened the gate (e.g. accidentally requiring BOTH skynet MIMEs) would go undetected.

    Test 5 (POSITIVE-CONTROL — row drag still dispatches via rich branch):
    - dataTransfer stub with `{ "application/x-skynet-row": JSON.stringify({ id: "row-42", tabId: "tab-42", fleetOnly: false }), "text/plain": "tab-42" }`.
    - `dispatchDropAt(paneOuter, 10, 50, dtStub)`.
    - Assert `onDropRowInTree` was called ONCE with the parsed object + `[]` + `"left"`.
    - Assert `onOpenSessionInTree` was NOT called (rich branch short-circuits per SplitView.tsx:354).

    Production edit in `src/ui/shell/SplitView.tsx`:

    Change all three `if (!e.dataTransfer?.types.includes("text/plain")) return;` gates (at :262, :292, :315) to require at least one skynet-owned MIME. Two acceptable shapes — executor's discretion, either passes acceptance:

    Shape A (inline, three copies):
    Replace each gate line with:
    `if (!(e.dataTransfer?.types.includes("application/x-skynet-badge") || e.dataTransfer?.types.includes("application/x-skynet-row"))) return;`

    Shape B (extract helper — likely cleaner given three copies):
    Add a module-scope (or file-scope, above the Pane component) pure function:
    - Name: `hasSkynetDragPayload`
    - Signature: `(dt: DataTransfer | null | undefined) => boolean`
    - Body: returns true iff `dt?.types.includes("application/x-skynet-badge") || dt?.types.includes("application/x-skynet-row")` (both, either) — false otherwise.
    Then replace each of the three gates with: `if (!hasSkynetDragPayload(e.dataTransfer)) return;`.

    Rationale-comment update at :287-292 (the `onDragLeave` gate comment): reword away from the current "scope to our own row-drag payload only" / text/plain framing to something like: "Type-gate FIRST — scope the flicker-fix machinery to our own skynet drag payloads (row-drag via application/x-skynet-row OR badge-drag via application/x-skynet-badge). Without this gate, unrelated dragleaves (browser text-selection drags, OS file drags, native OS drags) would clear dropPreview mid-drag whenever the browser fires a spurious dragleave on the pane. Tightened from text/plain-only gate in quick-260829-mbp — browser text-selection drags carry text/plain=<selected-text> and were passing the old gate, causing coral overlay + fake-tabId drops that landed as stale split slots (SplitView.tsx:436 placeholder)." (Executor may compress this while preserving the two load-bearing facts: (1) skynet-MIME requirement, (2) quick-260829-mbp reference so future greppers land here.)

    The onDrop rich/fallback dispatch below the gate (`SplitView.tsx:340-369`) stays byte-identical — the rich branch reads `application/x-skynet-row` first, and the fallback branch reads `text/plain=<tabId>` for badge drags (per the wire contract at PrettyConversationsPanel.test.tsx:4366+). The gate change only filters WHICH drags reach that dispatch; the dispatch itself is correct.

    Explicitly DO NOT TOUCH:
    - AppShell outer onDrop / patch #510.
    - The Pane's isolate/stacking-context wrapper className `relative isolate flex flex-col ...` at SplitView.tsx:417 (fh3 patch #524).
    - CollapsedPanelCloseLane wiring (ih3 patch #525).
    - Any `[pv-split-preview]` / `[pv-split-drop]` structured log lines — the gate change is orthogonal to logging.
    - Test file `src/ui/shell/SplitView.test.tsx` — the existing test file uses `types: ["text/plain"]` in its stub defaults, which under the tighter gate would make many existing tests fail. Look at the `dispatchDropAt` / `dispatchDragOverAt` helpers at :270-293 and :428-461: their stubs currently force `types: ["text/plain"]`. Under the tightened gate, tests that rely on the drop firing (Tests 6, 7 in the Phase 56 block; Tests 1-13 in the Phase 57 block) will regress because their stubs no longer include a skynet MIME. Fix: update the SHARED helpers in `src/ui/shell/SplitView.test.tsx` to include `application/x-skynet-row` in the default types array (or add it to the default stub via caller-side pass-through). The minimal change is a two-place edit inside `SplitView.test.tsx`: change `types: ["text/plain"] as readonly string[]` to `types: ["application/x-skynet-row", "text/plain"] as readonly string[]` in both `dispatchDropAt` (~L282) and `dispatchDragOverAt` / `dispatchDragLeaveAt` (~L437, L453). The existing tests are semantically about geometry + zone + dispatch behavior — they should have had skynet MIMEs all along; the old text/plain gate was just permissive enough to let them pass. Rerun the full `src/ui/shell/SplitView` scoped suite after both edits.
  </behavior>
  <action>
    Write both files in a single conceptual "RED test + GREEN code" motion. Commit style choice — executor's discretion given the fix is 4 gate lines + 1 comment update + 1 helper file update + 1 new test file:

    Option 1 (recommended — matches recent quick-task pattern e.g. quick-260829-fh3 `11ef10d6` RED + `aee16c8f` GREEN + `ebda9fb3` docs): two atomic commits.
    - RED commit: `test(quick-260829-mbp): failing regression suite for tightened Pane MIME gate` — introduces `SplitView.text-selection-drag.test.tsx` with all four (or five) tests; run scoped tests and confirm the negative tests FAIL against the current implementation (they will fail because the current text/plain gate lets the drop through) and the positive-control tests PASS (existing behavior still intact).
    - GREEN commit: `fix(quick-260829-mbp): tighten Pane drag/drop MIME gate to reject browser text-selection drags` — applies the three gate line changes (or helper extraction) in `src/ui/shell/SplitView.tsx`, updates the rationale comment at :287-292, updates the shared `dispatchDropAt`/`dispatchDragOverAt`/`dispatchDragLeaveAt` helper stubs in `src/ui/shell/SplitView.test.tsx` to include `application/x-skynet-row` in the default types so pre-existing tests still pass. Run scoped tests: all new tests + all existing tests green.

    Option 2 (acceptable if executor prefers a single commit for a 6-line change plus a small test file): one commit `fix(quick-260829-mbp): tighten Pane drag/drop MIME gate to reject browser text-selection drags`. Include both the production edit AND the new test file. TDD-style is common in this repo but not mandatory for a fix this small (see recent inline patches like #462, #454 which are single commits).

    Do NOT push, do NOT run `docker build`, do NOT `docker compose up`, do NOT deploy. Executor scope stops at code + commit + scoped tests green — the orchestrator handles ship motion per the standing directive ("Subagents don't do deploys — the orchestrator does").

    Do NOT run the full test suite. Scoped `npx vitest run src/ui/shell/SplitView` only (see verify block). Full-suite is orchestrator scope at the ship gate.

    Do NOT use git worktrees.
  </action>
  <verify>
    <automated>npx vitest run src/ui/shell/SplitView</automated>
  </verify>
  <done>
    - `src/ui/shell/SplitView.tsx` has zero remaining `types.includes("text/plain")` gates (grep confirms: `grep -c 'types.includes("text/plain")' src/ui/shell/SplitView.tsx` returns 0, or if the executor kept a comment referencing the old string for historical breadcrumb, `grep -c 'types\.includes("text/plain")' src/ui/shell/SplitView.tsx` in non-comment lines is 0 — use `grep -v '^\s*//' src/ui/shell/SplitView.tsx | grep -c 'types.includes("text/plain")'` for a stricter check that returns 0).
    - `src/ui/shell/SplitView.tsx` gates for the three drag listeners (onDragOver, onDragLeave, onDrop) reference at least one of `application/x-skynet-badge` or `application/x-skynet-row`. Grep: `grep -v '^\s*//' src/ui/shell/SplitView.tsx | grep -Ec 'application/x-skynet-(badge|row)'` returns >= 3 (three gate sites; higher if the executor uses inline shape A, or 1 if the executor extracted `hasSkynetDragPayload` helper + 3 call sites — both acceptable, so accept >= 1 for the MIME string count AND separately verify each of the three listeners has a gate that either inlines the check or calls the helper).
    - The rationale comment at (formerly) :287-292 no longer frames the gate as "text/plain" — it references either "skynet drag payloads" / "application/x-skynet-badge" / "application/x-skynet-row" / "quick-260829-mbp" as the anchor. Grep: `grep -c 'quick-260829-mbp' src/ui/shell/SplitView.tsx` returns >= 1.
    - `src/ui/shell/SplitView.text-selection-drag.test.tsx` exists as a new file.
    - `npx vitest run src/ui/shell/SplitView` exits 0 with all new tests passing AND all pre-existing SplitView tests still passing (existing test-helper stubs updated to include a skynet MIME as described in the behavior block).
    - onDrop rich/fallback dispatch at SplitView.tsx:340-369 is byte-unchanged from HEAD `5b3ff27a` (git diff shows changes ONLY in the three gate lines, the rationale comment, and optionally the added helper — NOT inside the rich/fallback dispatch block). Verify: `git diff HEAD -- src/ui/shell/SplitView.tsx | grep -E '^[+-]' | grep -vE 'types\.includes|application/x-skynet|hasSkynetDragPayload|// |quick-260829-mbp'` returns only trivial context / comment lines, no substantive dispatch changes.
    - No touch to AppShell.tsx, no touch to the Pane className with `isolate` (fh3), no touch to CollapsedPanelCloseLane files (ih3). Verify: `git diff HEAD --name-only` returns exactly `src/ui/shell/SplitView.tsx` + `src/ui/shell/SplitView.text-selection-drag.test.tsx` + `src/ui/shell/SplitView.test.tsx` (the shared-helper stub update).
    - One or two atomic commit(s) on `feat/tab-title-from-tmux` with `fix(quick-260829-mbp): ...` (and optionally `test(quick-260829-mbp): ...`) prefix matching recent style. NOT pushed.
    - Follow-up bounty candidate note captured in the summary (NOT in code) if the executor spots a related AppShell outer onDrop issue (patch #510 scope) during the diff — but DO NOT expand the plan to address it.
  </done>
</task>

</tasks>

<verification>
- All three Pane native drag listeners (`onDragOver`, `onDragLeave`, `onDrop`) reject drags whose `dataTransfer.types` contains ONLY `text/plain` (or `text/plain` + non-skynet types like `Files`). They accept drags whose types include at least one of `application/x-skynet-badge` or `application/x-skynet-row`.
- The existing badge-drag rearrange path (IdentityBadge dragstart → Pane onDrop text/plain fallback → `onOpenSessionInTree(<tabId>, path, edge)`) still works end-to-end (positive-control Test 4 in the new suite).
- The existing row-drag rearrange path (row dragstart with rich JSON → Pane onDrop rich branch → `onDropRowInTree(parsed, path, edge)`) still works end-to-end (positive-control Test 5).
- No new stale split slots created from browser text-selection drags (negative Tests 1-3).
- No changes to AppShell outer onDrop, the isolate stacking-context patch (fh3), or CollapsedPanelCloseLane (ih3) — all queued for the pending ship at HEAD `5b3ff27a` remain untouched.
- `npx vitest run src/ui/shell/SplitView` exits 0.
</verification>

<success_criteria>
- Ashley can highlight text in any pane, drag it, hover another pane's edge, and see NO coral drop-preview overlay. Releasing the drag creates NO split slot and NO "Session no longer exists" placeholder.
- Ashley can still press-and-drag an IdentityBadge onto a pane edge to rearrange the split tree — coral overlay renders, release creates the new split slot with the correct session.
- Ashley can still drag a conv-list row onto a pane edge — coral overlay renders, release creates the new split slot via the rich payload branch.
- `git diff HEAD --stat` shows changes confined to `src/ui/shell/SplitView.tsx`, `src/ui/shell/SplitView.test.tsx` (shared-helper stub update only), and the new `src/ui/shell/SplitView.text-selection-drag.test.tsx`.
- Scoped test run (`npx vitest run src/ui/shell/SplitView`) is green with no regressions in the pre-existing Phase 56 / Phase 57 / Phase 58 / patch #514 test blocks.
- One or two atomic commits on `feat/tab-title-from-tmux`, NOT pushed. Deploy motion is orchestrator scope.
</success_criteria>

<output>
Create `.planning/quick/260829-mbp-tighten-pane-drag-drop-mime-gate-to-reje/260829-mbp-SUMMARY.md` when done.
Include in the summary:
- Which gate shape was chosen (inline A or helper B) and why.
- Exact commit SHAs (RED + GREEN, or the single fix commit).
- Scoped test count (before/after) from `npx vitest run src/ui/shell/SplitView`.
- Any follow-up bounty candidate noticed but not addressed (e.g. related AppShell outer onDrop scope observed during diff).
- Confirmation that HEAD is LOCAL only (not pushed, no docker, no deploy).
</output>
