---
quick_id: 260909-cdi
type: summary
vehicle: gsd-quick
plan: 260909-cdi-PLAN.md
shape: shape-composebox-buttons-and-queue-tab-redesign.md
tags: [ux-pass, composebox, queue, recap, pebble-notch]
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx
  - src/ui/features/pretty-view/ComposeBox.test.tsx
files_added:
  - src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx
commit: 8f87f722
deploy_status: deferred_to_campaign_ship_gate (bounty 6/8, batched with 7/8)
campaign: ux-pass (composebox-buttons-and-queue-tab-redesign)
---

# 260909-cdi — ComposeBox buttons + queue-tab redesign SUMMARY

One-liner: Three-motion UX pass on the compose box aux-row, bundled atomically —
Recap payload swapped, ListPlus aux-row button retired, new pebble-notch
QueuePlusTab affordance that rides on the topmost textarea's top edge and
PREPENDS new slots.

## Three motions landed

### 1. Recap payload

- **Before:** `/explain the current situation`
- **After:**  `/explain what has gone on since my last message`
- Site: `ComposeBox.tsx` around L2547 (the Recap `<Button>` `onClick`).
  Every other Recap attribute (aria-label "Recap the current situation",
  title "Recap", CircleHelp icon, position last in aux-row, disable rules,
  className) is unchanged.

### 2. Aux-row trim (4 → 3 buttons)

- **Before:** `[ListPlus "Queue a message", Interrupt/Stop, ThumbsUp, Recap]`
- **After:**  `[Interrupt/Stop, ThumbsUp, Recap]`
- The ListPlus button + its 2464-line-region comment block were deleted;
  `ListPlus` was removed from the lucide-react import on L3. The stale
  aux-group descriptive comment (formerly claiming the group hosts
  Queue-a-message, Stop, ThumbsUp, Recap, Hourglass) was updated to
  reflect the new three-button reality.

### 3. QueuePlusTab (new pebble-notch affordance)

- **Location:** `src/ui/features/pretty-view/ComposeBox.tsx` L3099 (the
  `function QueuePlusTab({ onAdd })` declaration), sitting just above the
  `QueuedRowProps` interface and the `QueuedRow` function.
- **Contract:** `<button type="button" aria-label="Queue a message" title=
  "Queue a message" onClick={onAdd}>` with a `<Plus className="size-3"
  strokeWidth={1.5} />` glyph inside. aria-label preserved from the old
  ListPlus button so `screen.getByRole("button", { name: /queue a
  message/i })` continues to resolve unchanged.
- **Visual:** `absolute top-[-12px] left-1/2 -translate-x-1/2 z-10 w-10
  h-[22px] rounded-full` with a `--color-pv-base` → `--color-pv-base-mid`
  vertical gradient fill (blends into compose surround), a 4%-opacity
  hairline border, and a hover `brightness-110 + text-pv-fg` treatment.
- **Placement rule:** the tab conditionally renders on the primary
  wrapper when `queueSlots.length === 0`, and on the first `QueuedRow`
  (index 0) when slots exist. Never both — hoisting logic lives in the
  parent (primary wrapper gates on `queueSlots.length === 0`; QueuedRow
  gates on `isTopmostInStack`).
- **Wiring:** clicking the tab prepends a new empty slot at index 0 via
  `setQueueSlots((prev) => [{ id: makeSlotId(), text: "" }, ...prev])`.
  This inverts the old append-at-end behavior; locality is the win
  (clicking a plus on top of a stack should add to the top of the
  stack). The primary wrapper binds this closure directly; QueuedRow
  receives it as the new `onAddSlotAtTop` prop from the parent.
- **Interface additions:** `QueuedRowProps` gained two fields —
  `isTopmostInStack: boolean` and `onAddSlotAtTop: () => void`. The
  `queueSlots.map` callsite in the parent was updated from
  `map((slot) => ...)` to `map((slot, index) => ...)` to compute
  `isTopmostInStack={index === 0}`.
- **Test hooks:** the primary textarea wrapper gained
  `data-testid="compose-primary-wrapper"` so tests can assert the tab's
  parent surface unambiguously; `[data-slot-id]` on QueuedRow was
  already present.

## Grep spot-checks (all pass)

| Grep                                                                       | Expected | Got |
|----------------------------------------------------------------------------|----------|-----|
| `/explain what has gone on since my last message` in ComposeBox.tsx        | 1        | 1   |
| `/explain the current situation` in ComposeBox.tsx                         | 0        | 0   |
| `ListPlus className="size-4"` in ComposeBox.tsx                            | 0        | 0   |
| `aria-label="Queue a message"` in ComposeBox.tsx                           | 1        | 1   |
| `data-testid="compose-primary-wrapper"` in ComposeBox.tsx                  | 1        | 1   |
| `isTopmostInStack` in ComposeBox.tsx                                       | ≥ 3      | 6   |
| Append pattern `[...prev, { id: makeSlotId(), text: "" }]` in ComposeBox.tsx | 0      | 0   |

## Tests

### RED gate confirmation (before implementation)

Scoped run of `ComposeBox.send-funnel.test.tsx` + the new
`ComposeBox.queue-plus-tab.test.tsx` produced 5 expected failures:
- Test A (tab on primary wrapper) — component not implemented.
- Test B (tab on first slot) — component not implemented.
- Test C (prepend, not append) — old wiring was append.
- Test D (recap payload) — payload was still the old string.
- send-funnel Test 4 — payload was still the old string.
`Tests 5 failed | 6 passed (11)` on the RED run.

### GREEN gate (after implementation, scoped)

`npx vitest run 'src/ui/features/pretty-view/ComposeBox.'`
→ **Test Files 13 passed | 13 total. Tests 167 passed | 167 total.**

Includes the full 260909-cdi test surface plus every prior ComposeBox test.

### Scope-boundary fix (Rule 3 auto-fix, inside scope)

`ComposeBox.test.tsx` QS 3 (`clicking the X (delete) button on a slot
removes only that slot`) captured a reference to the "Queue a message"
button DOM node before the first click, then reused that stale reference
for the second click. This worked with the old aux-row button (a stable
DOM node that never unmounts) but broke against QueuePlusTab (which
re-parents between primary and first-slot wrappers between clicks). Fix:
re-query the button on each click. This is a test-only fix landing in
the same atomic commit; QS 3 now passes.

### File-scope inventory of test surface exercised

- `ComposeBox.queue-plus-tab.test.tsx` — 4 new tests, all pass.
- `ComposeBox.send-funnel.test.tsx` — Test 4 payload literals updated, all 5 pass.
- `ComposeBox.hold-to-mic.test.tsx` — 13 tests, all pass (aria-label preserved).
- `ComposeBox.queued-attachment.test.tsx` + `ComposeBox.queued-slot-paste.test.tsx` — pass unchanged.
- `ComposeBox.test.tsx` — 78 tests including the QS-3 fix, all pass.
- The remaining ComposeBox-prefixed test files under the pretty-view directory pass unchanged.

## Deviations from plan

**1. [Rule 3 - Blocking-issue auto-fix, in-scope] ComposeBox.test.tsx QS 3 stale button reference**
- **Found during:** Task 2 GREEN gate (full `ComposeBox*` scoped glob).
- **Issue:** QS 3 captured `plusBtn = getByRole(...)` once and reused it across two clicks. QueuePlusTab re-parents between the primary wrapper and the first slot when a slot is added, unmounting the first-click DOM node — so the second click fired on a detached node and no slot was added.
- **Fix:** Re-query the "Queue a message" button on each click. In-scope per the plan's ComposeBox* glob and Alice's "never leave tests failing" directive.
- **File modified:** `src/ui/features/pretty-view/ComposeBox.test.tsx` L783-798.
- **Commit:** included in the same atomic commit 8f87f722.

No other deviations. Recap block was diff-reviewed: L2547 was the only line changed inside the Recap `<Button>` block (icon, aria-label, title, disabled expr, className all unchanged).

## Atomic commit

- **SHA (short):** `8f87f722`
- **Message:** `feat(260909-cdi): compose plus-tab + recap payload + top-insertion`
- **Files:** 4 changed, 290 insertions(+), 48 deletions(-).

## Deploy

DEFERRED to the UX-pass campaign ship gate. This is bounty 6/8 — ships batched with 7/8 (per shape L145-150 and PLAN constraint). No push, no `docker build`, no `docker cp`, no `force-recreate` performed in this quick.

## Self-Check: PASSED

- FOUND: src/ui/features/pretty-view/ComposeBox.tsx (modified)
- FOUND: src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx (modified)
- FOUND: src/ui/features/pretty-view/ComposeBox.test.tsx (modified)
- FOUND: src/ui/features/pretty-view/ComposeBox.queue-plus-tab.test.tsx (created)
- FOUND: commit 8f87f722
- FOUND: QueuePlusTab component at ComposeBox.tsx L3099
- All 7 grep spot-checks pass with expected counts.
- Scoped test run: 13 files, 167 tests, all green.
