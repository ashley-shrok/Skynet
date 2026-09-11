---
quick_id: 260909-cdi
type: execute
vehicle: gsd-quick
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx
  - src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx
  - src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx
autonomous: true

must_haves:
  truths:
    - "The Recap button sends `/explain what has gone on since my last message` verbatim when clicked."
    - "The aux-row (below the primary textarea) contains exactly three buttons in order: Interrupt (Stop), ThumbsUp, Recap. The old ListPlus 'Queue a message' button is gone."
    - "A pebble-notch plus-tab is rendered horizontally centered on the top edge of the topmost textarea in the compose stack."
    - "When `queueSlots.length === 0`, the plus-tab rides on the primary textarea's wrapper."
    - "When `queueSlots.length > 0`, the plus-tab rides on the FIRST QueuedRow (index 0) wrapper, NOT the primary."
    - "Clicking the plus-tab inserts a new empty slot at index 0 of `queueSlots` (prepend), NOT at the end."
    - "The plus-tab is a real `<button type='button'>` with aria-label='Queue a message', so `screen.getByRole('button', { name: /queue a message/i })` still resolves."
    - "The plus-tab has no `disabled` prop and no disable rules (always clickable, matching today's queue button behavior)."
    - "The Recap button's aria-label, title, icon (CircleHelp), position (last in aux-row), disabled rules, and className are unchanged."
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "aux-row without ListPlus button; Recap payload string swapped; QueuePlusTab component rendered conditionally on primary wrapper OR first QueuedRow"
      contains: "/explain what has gone on since my last message"
    - path: "src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx"
      provides: "New behavioral coverage: tab renders on primary when empty, tab renders on first slot when populated, click prepends (not appends), recap payload updated"
  key_links:
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (QueuePlusTab onClick)"
      to: "setQueueSlots"
      via: "prev => [{ id: makeSlotId(), text: '' }, ...prev]"
      pattern: "\\.\\.\\.prev\\]"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx (Recap button onClick)"
      to: "handleQuickSend"
      via: "literal string arg"
      pattern: "/explain what has gone on since my last message"
    - from: "QueuePlusTab render site (primary wrapper OR first QueuedRow wrapper)"
      to: "position: absolute; top: -12px; left: 50%; transform: translateX(-50%)"
      via: "inline Tailwind arbitrary values or utility classes"
      pattern: "top-\\[-12px\\]|-top-3"
---

<objective>
UX pass on the compose box, bundling three motions in ONE atomic quick:

1. Change Recap button's send payload from `/explain the current situation` to `/explain what has gone on since my last message` (verbatim; nothing else about Recap changes).
2. Delete the leftmost aux-row button (ListPlus "Queue a message" `<Button>` at ComposeBox.tsx:2465-2485). Aux-row afterwards contains only Interrupt, ThumbsUp, Recap.
3. Add a new pebble-notch plus-tab affordance that visually notches into the top edge of the topmost textarea in the compose stack (primary when no slots exist; first QueuedRow when slots exist). Clicking it PREPENDS a new empty slot to `queueSlots` (index 0), inverting today's append-at-end behavior.

Purpose: Locality of interaction — clicking a plus on top of a stack should feel like adding to the top. The old button-in-a-row didn't carry that gesture. Recap phrasing tweak improves how often Alice reaches for it (her own usage found the new phrasing works better).

Output: One modified component file, three tests updated for the aria-label-preserving semantics (plus-tab is still a `<button>` with `name="Queue a message"`), and a new test file covering topmost-tracking + top-insertion + recap payload change.

Deploy: DEFERRED to campaign ship gate (bounty 6/8 of UX-pass campaign). Executor stops at code + atomic commits + scoped-green. NO push, NO docker build, NO deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/shapes/shape-composebox-buttons-and-queue-tab-redesign.md
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx
@src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx
@src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx

## Interface context extracted from source

**Aux-row layout** (ComposeBox.tsx around L2453-2587): parent `<div className="flex flex-row gap-1">` currently hosts, in order:
1. ListPlus queue button (L2465-2485) — DELETE
2. Interrupt/Stop button, gated on `onInterrupt` truthiness (L2494-2516) — KEEP
3. ThumbsUp button (L2525-2546) — KEEP
4. Recap/CircleHelp button (L2554-2579) — KEEP but change payload string on L2561 only

**Recap current onClick** (L2561):
`() => { onGoodToGo?.(); handleQuickSend("/explain the current situation"); }`

**Recap new onClick** (only the string literal changes):
`() => { onGoodToGo?.(); handleQuickSend("/explain what has gone on since my last message"); }`

Exact target string (no leading/trailing whitespace, no trailing punctuation):
`/explain what has gone on since my last message`

**Queue-slot state shape** (already exists): `queueSlots: Array<{ id: string; text: string }>` with a `makeSlotId()` helper. Existing append pattern (to be removed with the ListPlus button):
`setQueueSlots((prev) => [...prev, { id: makeSlotId(), text: "" }])`
New PREPEND pattern:
`setQueueSlots((prev) => [{ id: makeSlotId(), text: "" }, ...prev])`

**Primary textarea wrapper** (L2645): `<div className="relative flex-1 self-stretch">` — already has `position: relative`, so an absolutely-positioned tab child positions correctly. Add a stable `data-testid="compose-primary-wrapper"` here to help tests disambiguate.

**QueuedRow root wrapper** (L3317): `<div className="relative flex-1" data-slot-id={slot.id}>` — already has `relative` and a `data-slot-id` identifier. No new testid needed on QueuedRow; tests can use `data-slot-id` to locate it.

**QueuedRow surface**: to know whether it is the topmost slot, pass a new boolean prop `isTopmostInStack` (added to `QueuedRowProps`) — set to `true` only for the slot at index 0 in the `queueSlots.map((slot, index) => ...)` callback. Inside QueuedRow's returned JSX, render `{isTopmostInStack && <QueuePlusTab onAdd={...} />}` as the FIRST child of the outer wrapper `<div className="relative flex-1" data-slot-id={slot.id}>`.

**Primary-wrapper conditional render**: at the primary textarea's wrapper (L2645), conditionally render the tab when `queueSlots.length === 0`: `{queueSlots.length === 0 && <QueuePlusTab onAdd={...} />}`. Place it as the FIRST child of that wrapper, before the chipStripRef div.

**QueuePlusTab component** (new, local to ComposeBox.tsx — put it near the QueuedRow definition around L3070 or just above `function QueuedRow` at L3136): a plain `<button type="button">` with the pebble-notch visual, tuned per the shape. The visual class string (all inline Tailwind arbitrary values to match the file's existing pattern):

```
absolute top-[-12px] left-1/2 -translate-x-1/2 z-10
w-10 h-[22px] rounded-full
inline-flex items-center justify-center
bg-[linear-gradient(180deg,var(--color-pv-base),var(--color-pv-base-mid))]
border border-[rgba(220,225,245,0.04)]
text-[color:var(--color-pv-fg-muted)]
cursor-pointer
hover:brightness-110 hover:text-[color:var(--color-pv-fg)]
transition-[filter,color] duration-150
```

Inside the button, render `<Plus className="size-3" strokeWidth={1.5} />` — add `Plus` to the existing lucide-react import at ComposeBox.tsx:3 (currently imports `CircleHelp, ListPlus, Paperclip, RefreshCw, RotateCcw, RotateCwFadingClock, Square, ThumbsUp, X`; add `Plus`). Since `ListPlus` is no longer used after the aux-row button is deleted, verify no other references remain (`grep -c "ListPlus" src/ui/features/pretty-view/ComposeBox.tsx`) — if the count is 0, drop `ListPlus` from the import. If the count is > 0 (stale comment references), leave `ListPlus` in the import to avoid a lint error on unused import.

**Button contract for tests**: `<button type="button" aria-label="Queue a message" title="Queue a message" onClick={onAdd}>` — using the same aria-label as today's Button means existing tests using `screen.getByRole("button", { name: /queue a message/i })` continue to resolve without change (e.g., `hold-to-mic.test.tsx:1132`).

**Trust boundary / disable rules**: None. Today's ListPlus button had no `disabled` prop and clicked regardless of asideActive/recycleActive/planPendingActive/reconnectingActive. New QueuePlusTab inherits this — always clickable.

## Prior tests that must still pass unchanged (aria-label preserved)
- `ComposeBox.hold-to-mic.test.tsx:1132` — uses `getByRole("button", { name: /queue a message/i })` to add a slot. New QueuePlusTab keeps the same accessible name, so this test needs NO change.

## Prior tests that need trivial edits (payload string swap)
- `ComposeBox.send-funnel.test.tsx:317, 322` — asserts `"/explain the current situation"` in the recap bubble body and onSend payload. Update both string literals to `"/explain what has gone on since my last message"`.
- `ComposeBox.send-funnel.test.tsx:293` — the `it(...)` description mentions `/explain text`; leave the description as-is (still accurate) OR retitle to reflect new payload — planner leaves description edit to executor discretion.
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user click → setQueueSlots | Untrusted user interaction crosses into React state mutation. Existing pattern; no new attack surface. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-cdi-01 | Tampering | QueuePlusTab onClick handler | mitigate | `setQueueSlots` state setter uses the same functional form as the deleted button — no new state validation surface; behavior parity preserved by test coverage. |
| T-cdi-02 | Information disclosure | Recap payload string | accept | New payload string contains no PII, no secrets — it's a canned prompt phrase. Same trust profile as the string it replaces. |
| T-cdi-03 | Denial of service | Plus-tab always clickable (no disable rules) | accept | Matches today's queue button behavior verbatim. Users can already spam slot creation; this changes only WHERE the slot appears, not WHETHER it can be spammed. Follow-up bounty territory if debouncing needed. |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Update tests (send-funnel payload + new plus-tab test file)</name>
  <files>src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx, src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx</files>
  <behavior>
    - **send-funnel.test.tsx**: existing "Test 4: recap routes through funnel" (L293-325) must now assert the NEW payload `/explain what has gone on since my last message` in both `pendingEl.textContent` (L317) and `callPayload` (L322). RED before implementation because ComposeBox.tsx still sends the old string.
    - **queue-plus-tab.test.tsx** (NEW FILE): four `it(...)` blocks, all initially RED because QueuePlusTab does not exist yet:
      - Test A — "renders on primary wrapper when queueSlots is empty": mount ComposeBox with no draft slots; assert `screen.getByRole("button", { name: /queue a message/i })` resolves; assert its `closest("[data-testid='compose-primary-wrapper']")` is truthy AND its `closest("[data-slot-id]")` is null.
      - Test B — "renders on the first (topmost) QueuedRow when slots exist": pre-seed a draft with one queue slot via `getComposeDraft` mock (mirror the pattern in `hold-to-mic.test.tsx:56`); after mount + microtask flush, assert the plus-tab's `closest("[data-slot-id]")` is truthy AND its `closest("[data-testid='compose-primary-wrapper']")` is null. If two slots are seeded, the tab must be inside the FIRST slot's `[data-slot-id]` (compare against the two slot IDs).
      - Test C — "clicking the tab PREPENDS a new empty slot": mount with no slots; click the plus-tab; wait for one `[data-slot-id]` to appear; capture its slot id; click the plus-tab again; assert TWO `[data-slot-id]` slots exist AND the NEW empty one (empty textarea value) is at DOM index 0 (before the first-created slot). Use `container.querySelectorAll("[data-slot-id]")` to get DOM order.
      - Test D — "recap button sends the new payload": mount; click the recap button (aria-label "Recap the current situation"); assert onSend received `/explain what has gone on since my last message` exactly. (This is a lightweight companion to send-funnel's Test 4 — safe redundant coverage in the new file to keep the shape's behavior spec collocated.)
    - All four in queue-plus-tab.test.tsx MUST fail initially with a clear message ("Unable to find role button with name /queue a message/i" or similar) or fail the substring/count assertion. RED confirmation is the gate for GREEN in Task 2.
  </behavior>
  <action>
    Load @src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx and identify the two string literals `"/explain the current situation"` on L317 and L322. Replace both with `"/explain what has gone on since my last message"`. Do NOT edit any other line in that file. Do NOT retitle the `it(...)` description on L293 (its wording — `1 bubble with /explain text` — remains accurate).

    Create a NEW test file at `src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx`. Mirror the imports + mock-setup boilerplate from `src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx` (top ~120 lines — the `getComposeDraft` vi.fn mock at L56 is load-bearing for Test B). Structure with a single top-level `describe("ComposeBox queue plus-tab", ...)` containing the four `it(...)` blocks above.

    For **Test A**, the assertion pattern:
    - `const tab = screen.getByRole("button", { name: /queue a message/i });`
    - `expect(tab.closest("[data-testid='compose-primary-wrapper']")).not.toBeNull();`
    - `expect(tab.closest("[data-slot-id]")).toBeNull();`

    For **Test B**, override the `getComposeDraft` mock BEFORE mount:
    - `getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [{ id: "seed-slot-1", text: "" }] })`
    - After mount + `await vi.advanceTimersByTimeAsync(50)` + a few microtask ticks (mirror hold-to-mic.test.tsx:1121-1127), assert:
      - `const tab = screen.getByRole("button", { name: /queue a message/i });`
      - `expect(tab.closest("[data-slot-id]")).not.toBeNull();`
      - `expect(tab.closest("[data-testid='compose-primary-wrapper']")).toBeNull();`
      - For the two-slot variant: seed `[{ id: "slot-A", text: "" }, { id: "slot-B", text: "" }]`; after mount, assert `tab.closest("[data-slot-id]")?.getAttribute("data-slot-id") === "slot-A"`.

    For **Test C**, use `container.querySelectorAll("[data-slot-id]")` to get slots in DOM order. After first click, one slot exists. After second click, two slots exist; assert the NEW (empty, most-recently-added) slot precedes the first-created one in DOM order. Identify the "new" slot by capturing the first-click slot's `data-slot-id` attribute value before the second click.

    For **Test D**, use the send-funnel test's onSend capture pattern (mirror send-funnel.test.tsx:293-325 setup) OR read the current pending bubble's textContent — either is fine; the assertion is `expect(payload).toBe("/explain what has gone on since my last message")`.

    Confirm RED: run `npx vitest run src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx` — expect the send-funnel "Test 4" to FAIL on the payload assertion, and all four queue-plus-tab tests to FAIL. This is the RED gate. Do NOT proceed to Task 2 until RED is confirmed. Do NOT commit yet (Task 2 will co-commit test edits + implementation as one atomic feat commit, per project's atomic-commit convention).
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx 2>&1 | tail -40</automated>
  </verify>
  <done>
    - `ComposeBox.send-funnel.test.tsx` Test 4 fails on the payload string assertion (expected new payload, got old payload).
    - `ComposeBox.queue-plus-tab.test.tsx` exists with 4 `it(...)` blocks, all failing (component not implemented).
    - No source file (`ComposeBox.tsx`) modified in this task.
    - No commit yet.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement the three motions in ComposeBox.tsx and land GREEN</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx</files>
  <behavior>
    - Recap button (L2561) now calls `handleQuickSend("/explain what has gone on since my last message")`. Every other attribute (aria-label, title, icon, position, disabled rules, className) unchanged.
    - The `<Button>` at L2465-2485 (ListPlus queue button) and its adjacent explanatory comment block (L2454-2464) are DELETED. Aux-row now renders only Interrupt (conditional on onInterrupt), ThumbsUp, Recap.
    - New `QueuePlusTab` component defined locally in ComposeBox.tsx (place it just above the QueuedRow definition, around L3070). Signature: `function QueuePlusTab({ onAdd }: { onAdd: () => void }) { ... }`. Renders `<button type="button" aria-label="Queue a message" title="Queue a message" onClick={onAdd} className="{pebble-notch classes per plan context}"><Plus className="size-3" strokeWidth={1.5} /></button>`. Import `Plus` from `lucide-react` (add to existing import on L3). If `ListPlus` becomes unused (grep confirms zero references outside the deleted block), remove it from the import; otherwise leave it to avoid an unused-import lint error.
    - Primary textarea wrapper (L2645): add `data-testid="compose-primary-wrapper"` to the `<div className="relative flex-1 self-stretch">`. As its FIRST child (before the chipStripRef div at L2657), conditionally render `{queueSlots.length === 0 && <QueuePlusTab onAdd={() => setQueueSlots((prev) => [{ id: makeSlotId(), text: "" }, ...prev])} />}`.
    - QueuedRow: add `isTopmostInStack: boolean` to the `QueuedRowProps` interface (L3088). Destructure it in the function body (L3137-3165). At the top of the returned JSX inside the outer `<div className="relative flex-1" data-slot-id={slot.id}>` (L3317), conditionally render `{isTopmostInStack && <QueuePlusTab onAdd={onAddSlotAtTop} />}`. Thread `onAddSlotAtTop: () => void` as a new prop on `QueuedRowProps` (bound in the parent to the same prepend closure used for the primary case).
    - Parent's `queueSlots.map` callsite (L2596): change to `queueSlots.map((slot, index) => (...))` and pass `isTopmostInStack={index === 0}` and `onAddSlotAtTop={() => setQueueSlots((prev) => [{ id: makeSlotId(), text: "" }, ...prev])}` on the QueuedRow.
    - After changes: `grep -c "\\[\\.\\.\\.prev, { id: makeSlotId(), text: \\\"\\\" }\\]" src/ui/features/pretty-view/ComposeBox.tsx | grep -v '^#'` returns `0` (append pattern gone). `grep -c "/explain the current situation" src/ui/features/pretty-view/ComposeBox.tsx | grep -v '^#'` returns `0`. `grep -c "/explain what has gone on since my last message" src/ui/features/pretty-view/ComposeBox.tsx | grep -v '^#'` returns `1`.
  </behavior>
  <action>
    Apply the four ComposeBox.tsx edits described above in a single implementation pass. Read the file first (already loaded in context above L2440-2700 and L3070-3340). Use the Edit tool for each specific hunk.

    Ordering within the file to minimize diff churn:
    1. Add `Plus` to the lucide-react import on L3. Preserve alphabetical order of the existing named imports.
    2. Delete the ListPlus `<Button>` block at L2465-2485 AND its comment block at L2454-2464 (both are stale after the button leaves — no need to leave orphaned prose).
    3. Update the Recap onClick string on L2561 (single string literal swap).
    4. Add `data-testid="compose-primary-wrapper"` to the primary textarea wrapper `<div>` at L2645.
    5. Insert the conditional QueuePlusTab render as the FIRST child inside that wrapper (before the chipStripRef div at L2657).
    6. Update the `queueSlots.map` callsite around L2596 to include `index` in the callback and pass `isTopmostInStack={index === 0}` + `onAddSlotAtTop={...prepend closure...}` on `<QueuedRow ... />`.
    7. Update `QueuedRowProps` interface (L3088-3134) to add `isTopmostInStack: boolean` and `onAddSlotAtTop: () => void`.
    8. Destructure `isTopmostInStack` and `onAddSlotAtTop` in the QueuedRow function body (L3137-3165).
    9. Insert the conditional `{isTopmostInStack && <QueuePlusTab onAdd={onAddSlotAtTop} />}` at the top of the outer wrapper `<div>` in QueuedRow's returned JSX (immediately inside `<div className="relative flex-1" data-slot-id={slot.id}>` at L3317, BEFORE the delete-x button on L3323).
    10. Add the `QueuePlusTab` component definition immediately above the `function QueuedRow(...)` declaration on L3136. Keep it small — a pure functional component, no state, no effects.
    11. Optional cleanup: if `grep -c "ListPlus" src/ui/features/pretty-view/ComposeBox.tsx | grep -v '^#'` returns `0` after edits, remove `ListPlus` from the lucide-react import to avoid an unused-import lint error. If any stale comment still references `ListPlus`, either (a) update the comment to say `Plus` instead, or (b) leave the import in place — planner leaves that call to executor judgment based on comment context.

    After edits, run the scoped test suite:
    `npx vitest run src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx`

    All should pass GREEN. If hold-to-mic.test.tsx fails on the L1132 selector (unlikely — the aria-label is preserved), inspect the failure; the plus-tab is a `<button type="button">` with the same accessible name, so `getByRole("button", { name: /queue a message/i })` MUST still resolve. If it fails for a different reason (e.g., the tab click no longer produces a MicButton in the primary because the tab prepended a slot that shifted focus), the test may need a trivial edit — but ONLY if unrelated to the aria-label change.

    Also run the two queue-slot tests explicitly listed as read priors to confirm no regression:
    `npx vitest run src/ui/features/pretty-view/ComposeBox.queued-attachment.test.tsx src/ui/features/pretty-view/ComposeBox.queued-slot-paste.test.tsx`

    Then run the full ComposeBox test glob for scoped confidence:
    `npx vitest run "src/ui/features/pretty-view/ComposeBox*"`

    If ALL scoped tests pass, create ONE atomic commit:
    - Message: `feat(260909-cdi): compose-box aux-row trim + queue plus-tab + recap payload swap`
    - Body: brief bullets on the three motions and the aria-label-preserving contract.
    - Co-author trailer per project convention.
    - Multi-identity discipline (per CLAUDE.md, if it exists in repo root): if `git pull --rebase` before push is required by fleet rules, DO NOT push in this task — the shape defers deploy/push to the campaign ship gate. Executor's remit stops at the atomic commit.
  </action>
  <verify>
    <automated>npx vitest run "src/ui/features/pretty-view/ComposeBox*" 2>&1 | tail -60</automated>
  </verify>
  <done>
    - `grep -c "/explain what has gone on since my last message" src/ui/features/pretty-view/ComposeBox.tsx` returns 1; `grep -c "/explain the current situation" src/ui/features/pretty-view/ComposeBox.tsx` returns 0.
    - `grep -c "ListPlus className=\"size-4\"" src/ui/features/pretty-view/ComposeBox.tsx` returns 0 (aux-row button JSX gone).
    - `grep -c "aria-label=\"Queue a message\"" src/ui/features/pretty-view/ComposeBox.tsx` returns 1 (the new QueuePlusTab component; the old aux-row Button is deleted).
    - `grep -c "data-testid=\"compose-primary-wrapper\"" src/ui/features/pretty-view/ComposeBox.tsx` returns 1.
    - `grep -c "isTopmostInStack" src/ui/features/pretty-view/ComposeBox.tsx` returns >= 3 (interface, destructure, JSX conditional in QueuedRow + map callsite).
    - All 4 tests in `ComposeBox.queue-plus-tab.test.tsx` pass.
    - `ComposeBox.send-funnel.test.tsx` Test 4 passes with the new payload.
    - `ComposeBox.hold-to-mic.test.tsx` passes unchanged (aria-label semantics preserved).
    - `ComposeBox.queued-attachment.test.tsx` + `ComposeBox.queued-slot-paste.test.tsx` pass unchanged.
    - Full `ComposeBox*` scoped run reports 0 failures.
    - One atomic commit created on the current branch. No push. No docker build. No deploy.
  </done>
</task>

</tasks>

<verification>
Scoped test gate (executor's green gate — NOT full suite):

```
npx vitest run "src/ui/features/pretty-view/ComposeBox*"
```

All tests in that glob must pass. Full-suite runs are orchestrator-only at ship time (per CLAUDE.md fleet rule "test discipline: scoped during dev, full suite only after explicit ship greenlight").

Behavior spot-checks (grep-based, run after Task 2):
- `grep -c "/explain what has gone on since my last message" src/ui/features/pretty-view/ComposeBox.tsx` → 1
- `grep -c "/explain the current situation" src/ui/features/pretty-view/ComposeBox.tsx` → 0
- `grep -c "aria-label=\"Queue a message\"" src/ui/features/pretty-view/ComposeBox.tsx` → 1
- `grep -c "isTopmostInStack" src/ui/features/pretty-view/ComposeBox.tsx` → ≥ 3

Recap regression guard (out-of-scope trap): the ONLY line in ComposeBox.tsx that should change in the Recap `<Button>` block (L2554-2579) is L2561. Diff-review the block; if any other line changed (icon, aria-label, title, disabled expr, className), REVERT that line before commit.

Deploy: NOT part of this quick. Deferred to campaign ship gate (bounty 6/8 of the UX-pass campaign).
</verification>

<success_criteria>
- Alice clicking Recap now sends `/explain what has gone on since my last message` verbatim.
- The aux-row has three buttons, not four. No ListPlus icon visible in the aux-row.
- A small pebble-notch plus-tab is visible centered on the top edge of whichever textarea is topmost in the compose stack.
- Clicking the tab adds a new empty textarea at the TOP of the queue stack.
- All 4 new tests in `ComposeBox.queue-plus-tab.test.tsx` pass.
- All existing `ComposeBox.*` scoped tests pass (aria-label preservation kept the selector-based tests working; send-funnel Test 4 gets a trivial payload-literal swap).
- One atomic commit lands on the current branch.
- No push, no docker build, no deploy — deferred to campaign ship gate.
</success_criteria>

<output>
Create `.planning/quick/260909-cdi-composebox-buttons-and-queue-tab-redesig/260909-cdi-SUMMARY.md` when done. Include:
- Recap payload before/after strings.
- Aux-row button count before/after (4 → 3) and which button was removed.
- New QueuePlusTab component's file location + line range.
- Confirmation of the four grep spot-checks above.
- The scoped test result line count (e.g., `Test Files 12 passed | 12 total`).
- The single atomic commit SHA.
- Explicit note that deploy is deferred to the UX-pass campaign ship gate.
</output>
