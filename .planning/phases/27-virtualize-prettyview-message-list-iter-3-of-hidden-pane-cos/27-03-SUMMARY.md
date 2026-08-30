---
phase: 27-virtualize-prettyview-message-list-iter-3-of-hidden-pane-cos
plan: 03
subsystem: pretty-view
tags: [virtualization, tests, integration, tanstack-virtual, hidden-pane-cost-mitigation-iter3]
dependency_graph:
  requires:
    - 27-02 (virtualized message list already landed with data-pv-bubble / data-event-id / data-index markers; accessories moved out to sibling-of-scroller block)
  provides:
    - PrettyView.virtualization.test.tsx (empirical CI proof for must_haves #2/#3/#4/#5/#8)
    - Widened capturing ResizeObserver polyfill pattern (per 27-PATTERNS.md SURPRISE #3 mitigation) for future PV tests
  affects:
    - CI test surface (adds 6 new test cases to the pretty-view suite)
tech_stack:
  added: []
  patterns:
    - "Capturing multi-slot ResizeObserver polyfill (widened from PrettyView.aside.test.tsx's single-slot no-op stub per 27-PATTERNS.md SURPRISE #3 mitigation) — every constructed RO callback is stored so tests can manually fire the virtualizer's observeElementRect RO after mutating the scroll container's offsetHeight."
    - "HTMLElement.prototype.offsetHeight + getBoundingClientRect conditional override on [data-pv-bubble] elements (JSDOM's default 0-height would collapse TanStack Virtual's measurement cache and defeat slice selection). Original prototype descriptors are captured in `beforeEach` and restored in `afterEach` to avoid polluting sibling test files."
key_files:
  created:
    - path: src/ui/features/pretty-view/PrettyView.virtualization.test.tsx
      purpose: |
        Wave 3 empirical proof for the phase's virtualization contract.
        6 `it(...)` cases (behaviors 1/2/3/4 always separate + accessory
        Test 5a + Test 5b). Real TanStack Virtual, real DOM, no
        @tanstack/react-virtual mocking (per Plan 27-03 step 6). Uses the
        widened capturing RO polyfill and per-bubble prototype-getter
        overrides described in tech_stack.patterns above.
  modified: []
decisions:
  - "Task 1 (update PrettyView.aside.test.tsx) was SKIPPED with rationale in Plan 27-03 § Task 1 outcome below. The Wave 2 SUMMARY documented that all pretty-view tests stayed green after Step B's DOM restructure — including every aside test — because the aside tests use presence-based selectors (`container.querySelector('[role=\"note\"]')`, `container.textContent.toContain(...)`) that are correct-for-scope: they verify the aside subsystem's WS-driven behavior, not the virtualization layer's DOM-tree shape. Strengthening them into tree-shape assertions would duplicate what Task 2's new virtualization test file covers explicitly (Test 5a in the new file). The plan's adjusted Task 1 directive ('if any DOM-tree assertion is now over-permissive because it survived a layout change it should have caught, STRENGTHEN it') was inspected: none of the aside tests make DOM-tree assertions, so none are 'silently permissive after a layout change'. They were always presence-only, correctly scoped."
  - "Widened the no-op ResizeObserver stub (from PrettyView.aside.test.tsx:122-127) into a capturing multi-slot polyfill. Rationale: Test 1 (bounded-DOM cap) needs to shrink the scroll container's viewport AFTER mount and then force TanStack Virtual's observeElementRect RO to re-fire so it re-reads the new offsetHeight. The single-slot polyfill from use-auto-scroll.test.ts:6-16 is unsafe here per 27-PATTERNS.md SURPRISE #3 — TanStack Virtual constructs multiple ROs (its own for observeElementRect PLUS one per measureElement item) that would overwrite the useAutoScroll RO's slot. Multi-slot capture side-steps the ordering fragility entirely. This is precisely the mitigation SURPRISE #3 recommends."
  - "Overrode HTMLElement.prototype.offsetHeight + getBoundingClientRect conditionally on [data-pv-bubble] elements to return 80px (matching estimateSize) instead of JSDOM's default 0. Without this override, TanStack Virtual v3's `measureElement` reads element.offsetHeight (virtual-core/index.js:150 fallback path when no ResizeObserver entry is available), gets 0, caches size=0 for each rendered item, and `getTotalSize()` collapses to 0 — at which point the visible range calculation degenerates and the virtualizer ends up rendering ~66 items regardless of viewport size. With the 80px override, measurements match estimateSize, totalSize = count*80 = 9600px for 120 items, and visible-slice math yields the expected ~10-25 items + overscan under a 600px viewport."
metrics:
  plan_start_utc: "2026-08-09T14:20:00Z"
  duration_minutes: 25
  tasks_completed: 1
  tasks_total: 2
  tasks_skipped: 1
  commits: 1
  files_created: 1
  files_modified: 0
---

# Phase 27 Plan 03: Wave 3 empirical virtualization tests — Summary

**One-liner:** Wave 3 of Phase 27 adds `PrettyView.virtualization.test.tsx` — 6 real-virtualizer, real-DOM integration tests that empirically enforce the phase's core must-haves (bounded DOM cap ≤ 30 on 120-msg conversations, auto-scroll-to-bottom-when-pinned, don't-yank-when-scrolled-up, getItemKey identity via observable `data-event-id`, and accessory sibling-of-scroller layout for AsideBubble + PlanPendingBubble) — landing the phase code-complete and test-verified for handoff to the orchestrator's deploy motion.

## What was done

### Task 1 — Update PrettyView.aside.test.tsx — SKIPPED (with rationale)

**Outcome:** No changes needed. Aside tests still green unchanged (4 passing / 5 skipped — the 5 skips are the identity-attached / anonymous-suppression tests that Ashley disabled at the source via `AUTO_ASIDE_ARM_ENABLED=false` back in 2026-07-27, unrelated to Phase 27).

**Rationale:**

The Wave 2 SUMMARY (`27-02-SUMMARY.md` § "Test failures after Step B") documented that ZERO tests broke after Wave 2 Step B moved AsideBubble out of the sized virtualizer container into the sibling-of-scroller position — including every aside test. The plan predicted DOM-tree assertion failures; in practice the aside tests use presence-based selectors:

- `container.querySelector('[role="note"]')` — presence, not tree-shape.
- `container.textContent.toContain('...')` — text presence, not layout.
- `note.textContent` reads — content check, not layout.

Neither Test 1 nor Test 2 nor Test 5 nor Test 6 of `PrettyView.aside.test.tsx` traverses `parentElement` / `closest()` / `children[]` / `firstChild` / etc. So the DOM-tree restructure landed cleanly with no tree-shape assertion churn.

The orchestrator's adjusted Task 1 directive was: *"if any DOM-tree assertion is now over-permissive because it survived a layout change it should have caught (e.g. asserting a specific parent-child relationship that no longer holds but the test uses a permissive selector), STRENGTHEN it to actually verify the new sibling-of-scroller layout. Do NOT weaken existing tests. If no changes are needed, skip Task 1 with a rationale in the SUMMARY."*

I inspected all aside tests (`PrettyView.aside.test.tsx` :113-489 — the active `it(...)` cases at :135, :160, :268, :290, plus the 5 `it.skip(...)` cases that pre-date this phase). None of them make DOM-tree assertions — they are all presence-based, and they are correctly scoped to the aside subsystem's WS-driven behavior (Phase 14 Wave 3 wiring: aside_ready renders AsideBubble → aside_dismissed clears it → paneKey change resets it → session_changed clears it). The layout-tree invariant (aside as sibling of scroller, not child of the sized virtualizer container) is a separate concern, better verified in Task 2's new virtualization test file (Test 5a in the new file — see below).

Strengthening the aside tests into tree-shape assertions would duplicate Test 5a's coverage AND misplace responsibility: layout-tree invariants belong in the virtualization test file, not the aside subsystem file. Correct scope separation preserved.

**Verification:** `npx vitest run src/ui/features/pretty-view/PrettyView.aside.test.tsx --reporter=json` → `passed: 4 failed: 0 total: 9` (5 skips are pre-existing, unrelated).

### Task 2 — Create PrettyView.virtualization.test.tsx — COMPLETE

**Outcome:** New test file at `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` with 6 `it(...)` cases, all passing.

**Test list:**

| # | Case | Behavior verified | Must-have covered |
|---|------|-------------------|-------------------|
| 1 | Test 1: bounded DOM — 120 messages produces ≤ 30 [data-pv-bubble] subtrees | Fires 120 chat_message WS frames on a mounted PrettyView, shrinks the scroll container's viewport to 600px, manually fires the captured RO callbacks so TanStack Virtual re-reads the shrunk offsetHeight, fires one more frame, asserts `container.querySelectorAll('[data-pv-bubble]').length <= 30` (with a lower bound `> 0`). This is the phase's raison d'être — the ≤ 30 bubble-subtree cap on 100+ msg conversations. | CONTEXT.md § Success criteria #2/#3 |
| 2 | Test 2: auto-scroll-to-bottom-when-pinned — scrollTop jumps to bottom via paneKey rAF-chain over virtualized layout | Uses `vi.useFakeTimers()`. Mounts PV, fires 20 message frames, shrinks the scroll container to viewport 600px + scrollHeight 5000px + scrollTop 0. Advances timers by 400ms to run through useAutoScroll's 300ms LOAD_LOCK_MS rAF-chain (`use-auto-scroll.ts:108-127`). Asserts `scrollTop === 5000` — the jump-to-bottom primitive still fires over the virtualized layout. | CONTEXT.md § Success criteria #4 |
| 3 | Test 3: don't-yank-when-scrolled-up — after wheel-up gesture, subsequent frames do not force scrollTop back to bottom | Uses `vi.useFakeTimers()`. Mounts PV, fires 20 messages, shrinks scroll container, advances past LOAD_LOCK_MS. Sets scrollTop to 1000 (user scrolled up), dispatches a `WheelEvent` with `deltaY: -100` to trigger useAutoScroll's exitStick branch, bumps scrollHeight to 5200, fires a new message frame. Asserts `scrollTop` stayed at 1000 (was NOT yanked back to bottom). | CONTEXT.md § Success criteria #5 |
| 4 | Test 4: getItemKey identity via data-event-id — each [data-pv-bubble] carries the eventId of the message at its data-index | Fires 10 messages with distinct known eventIds `known-evt-0` … `known-evt-9`. For every rendered [data-pv-bubble] element in the DOM, reads `el.getAttribute("data-index")` and `el.getAttribute("data-event-id")` (per checker Warning 4 — observable DOM attributes, NOT React key inspection). Asserts that `dataEventId === expectedEventIds[dataIndex]` for every rendered item — proving getItemKey stably maps the row-index to the correct eventId. Regression here would invalidate TanStack Virtual's measurement cache on every dedup/reorder (SURPRISE #2). | Warning 4 must-have (getItemKey identity, SURPRISE #2 stability lock-in) |
| 5a | Test 5a: AsideBubble renders as a sibling of the sized virtualizer container, INSIDE the outer scroll container (not a child of the sized container) | Fires aside_ready, then walks the DOM: (i) `sizedContainer.contains(asideEl) === false` (not a child of the sized virtualizer container), (ii) `outerScroll.contains(asideEl) === true` (in-flow inside the outer scroll container), (iii) walker traversal from asideEl up to outerScroll does NOT cross the sized container. Locks the Wave 2 Step B layout restructure invariant. | CONTEXT.md § Success criteria #8 layout invariant |
| 5b | Test 5b: PlanPendingBubble renders as a sibling of the sized virtualizer container, INSIDE the outer scroll container | Analogous to 5a using `plan_pending` WS frame + selector `[aria-label="Plan waiting for your approval"]`. Same three invariant assertions. Together 5a + 5b cover the accessory-sibling layout invariant for the two WS-driven accessories; WipBubble's sibling invariant is verified transitively — all three accessories are rendered from the same JSX triplet in `PrettyView.tsx:1896-1916`, so if aside + plan_pending are siblings, wip is too by construction. | CONTEXT.md § Success criteria #8 layout invariant |

**Deliberately-dropped test:** Test 5 (image-bubble re-measure) is NOT in this file per checker Warning 3. The available ResizeObserver stubs cannot reliably drive TanStack Virtual's per-item measureElement ROs; that must_have (#7) is verified by the Wave 2 Step B manual smoke check deferred to post-deploy production UAT (documented in `27-02-SUMMARY` § "Image-bubble grow smoke check").

**Infrastructure notes:**

- **WS-stub scaffolding** — verbatim copy of the `wsStubs[]` + `getCurrentWs()` + `openClaudeSessionSocket` factory + `flipToStreaming` + `fireWsMessage` pattern from `PrettyView.test.tsx` :12-100. Also copied identically: mocks for `@/api/compose-drafts-api`, `@/features/terminal/session-hue`, `@/features/terminal/IdentityBadge`, `@/hooks/use-is-touch-device`.
- **Capturing multi-slot ResizeObserver polyfill** (widened from the no-op stub at `PrettyView.aside.test.tsx:122-127` per 27-PATTERNS.md SURPRISE #3) — every constructed RO's callback is stored in `capturedROCallbacks[]` so tests can manually fire the virtualizer's own observeElementRect RO after shrinking the scroll container's offsetHeight. Restored via `vi.unstubAllGlobals()` in `afterEach`.
- **HTMLElement.prototype prototype-getter overrides on [data-pv-bubble]:** `offsetHeight` returns 80 (matching estimateSize); `getBoundingClientRect` returns `{height: 80, width: 1024, ...}`. Necessary because TanStack Virtual v3's `measureElement` fallback (virtual-core/index.js:150) reads `element.offsetHeight` when no ResizeObserver entry is available, and JSDOM's default of 0 would collapse the measurement cache and defeat slice-selection (every item rendered regardless of viewport). Non-bubble elements fall through to the original prototype. Original prototype descriptor captured at module scope and restored in `afterEach` so sibling test files are unaffected.
- **`shrinkScrollContainer(el, clientHeight, scrollHeight)` helper** — mounts `offsetHeight` / `offsetWidth` / `clientHeight` / `scrollHeight` / `scrollTop` overrides via `Object.defineProperty` on a specific element (the outer scroll container) with a mutable `setScrollHeight` / `setScrollTop` / `getScrollTop` API. Modeled after `use-auto-scroll.test.ts` :23-60 `makeScrollEl` / `makeMutableScrollEl` helpers.

## Commit SHAs

| Task | SHA | Message |
|------|-----|---------|
| 1    | — (skipped) | — |
| 2    | `5de45b1` | `test(27-03): add PrettyView.virtualization.test.tsx covering bounded-DOM + anchor + getItemKey + accessory placement` |

The final SUMMARY commit (this file) will land as a separate `docs(27-03)` commit after this file is written.

## `<automated>` gate output

Plan 27-03 Task 2's `<automated>` gate runs vitest twice via `--reporter=json | node -e "..."` — once for the new file, once for the full suite. Both gates chain via `&&`, both preserve exit codes.

```
$ test -f src/ui/features/pretty-view/PrettyView.virtualization.test.tsx \
  && npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx --reporter=json 2>/dev/null \
     | node -e "... numFailedTests > 0 ? exit 1 : numPassedTests < 5 ? exit 1 : ok" \
  && npx vitest run --reporter=json 2>/dev/null \
     | node -e "... numFailedTests > 0 ? exit 1 : ok"

NEW-FILE OK: 6 passed
FULL-SUITE OK: 1692 passed, 1698 total
```

Both gates exit 0. Full-suite has 6 pre-existing skipped tests (5 aside identity-attach tests disabled at source since 2026-07-27, 1 unrelated to this phase); 0 failures, 1692 passing.

## Full-suite pass count

`npx vitest run` on the full frontend suite:

- 1692 passed
- 0 failed
- 6 skipped (all pre-existing — none from Wave 3)
- 1698 total tests
- 652 test suites

Delta from Wave 2 (post-Step-B): `+6 tests` in the newly-added `PrettyView.virtualization.test.tsx`. All other test files unchanged.

`npx tsc --noEmit`: exit 0 (no TypeScript errors).

## Acceptance criteria check (from Plan 27-03 Task 2 `<acceptance_criteria>`)

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | File `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` exists | ✓ | `git log --oneline --all | grep 5de45b1` — creation commit; file present in tree |
| 2 | ≥ 5 `it(...)` cases covering behaviors 1, 2, 3, 4 (always separate) + at least one accessory-sibling test | ✓ | 6 cases: Test 1 (bounded), Test 2 (auto-scroll), Test 3 (don't-yank), Test 4 (getItemKey via data-event-id), Test 5a (AsideBubble sibling), Test 5b (PlanPendingBubble sibling) |
| 3 | Test 4 uses `el.getAttribute('data-event-id')` — NOT React key inspection — to prove getItemKey identity (per Warning 4) | ✓ | `PrettyView.virtualization.test.tsx:546` reads `el.getAttribute("data-event-id")` (semantically identical to the plan's single-quoted `el.getAttribute('data-event-id')` — both are valid JavaScript string literal quote styles; project file already uses double quotes throughout imports and other assertions). The critical Warning 4 requirement is that the test observes the DOM attribute rather than React's internal key — met by attribute reads at both `getAttribute("data-index")` and `getAttribute("data-event-id")` in Test 4. |
| 4 | No test attempts image-bubble grow re-measure verification (per Warning 3 — deferred to Wave 2 Step B manual smoke check) | ✓ | `grep -c 'image.*grow\|grow.*image\|measureElement.*image' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` returns 0 |
| 5 | `npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` exits 0 with 0 failed tests and ≥ 6 passing | ✓ | 6 passed / 6 total, exit 0 (Task 2 `<automated>` NEW-FILE gate output above) |
| 6 | `npx vitest run` (full frontend suite) exits 0 with 0 failed tests | ✓ | 1692 passed / 0 failed / 1698 total, exit 0 (Task 2 `<automated>` FULL-SUITE gate output above); CONTEXT.md § Success criteria #9 satisfied |
| 7 | Uses pre-existing `resizeObserverStub` no-op pattern from PrettyView.aside.test.tsx and the `makeScrollEl` / `makeMutableScrollEl` pattern from use-auto-scroll.test.ts (or inline equivalent) — no new mocking framework introduced | ✓ | Widened aside.test.tsx's no-op stub into a capturing multi-slot form (per 27-PATTERNS.md SURPRISE #3 mitigation — this is an inline widening of the existing pattern, not a new framework); the `shrinkScrollContainer` helper is an inline equivalent of use-auto-scroll.test.ts's makeScrollEl helper, adapted for post-mount installation on a specific DOM element |
| 8 | The bounded-DOM test asserts `container.querySelectorAll('[data-pv-bubble]').length <= 30` on a 100+ msg fixture | ✓ | `PrettyView.virtualization.test.tsx:378` `expect(bubbles.length).toBeLessThanOrEqual(30)` on a 120-msg fixture (Test 1 fires 120 frames + 1 additional = 121 total messages, well past the 100 threshold) |
| 9 | No source files under `src/ui/features/pretty-view/` (other than tests) modified | ✓ | `git diff --stat 80cd6e8 HEAD` shows only `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` added (+685 lines); no non-test file diffs |
| 10 | `npx tsc --noEmit` exits 0 | ✓ | Verified after Task 2 completion, exit 0 |
| 11 | Exit-code hygiene preserved: vitest runs at most TWICE in `<automated>` — once for new file, once for full suite — both gated purely by `--reporter=json` piped to a `node -e` exit-code check. Zero `| tail` / `| head` masking (per checker Blocker 2) | ✓ | Plan 27-03's `<automated>` block re-read: contains two `&&`-chained invocations, both use `--reporter=json 2>/dev/null | node -e "..."`, zero `tail` / `head` matches |

## Plan-level `<verification>` grep checks (from Plan 27-03 `<verification>`)

| Check | Result | Evidence |
|-------|--------|----------|
| `<= 30` (literal empirical cap assertion) | ✓ | `grep -c '<= 30' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` → 1 match at line 366 comment (the semantic assertion at line 378 uses `toBeLessThanOrEqual(30)`) |
| At least one `getAttribute('data-event-id')` (Warning 4 witness) | see note | `grep -c "getAttribute('data-event-id')" src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` → 0 with single-quote form, but `grep -c 'getAttribute("data-event-id")' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` → 1 match at line 546. Semantically equivalent — the test observes the DOM attribute rather than React internals per Warning 4. See § "Deviations from Plan" for the quote-style note. |
| No image-bubble grow test (per Warning 3) | ✓ | `grep -c 'image.*grow\|grow.*image\|measureElement.*image' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` → 0 |
| `<automated>` block runs vitest at most twice via `--reporter=json | node -e "..."` with no `| tail` / `| head` prefixes | ✓ | Plan `<automated>` re-read; zero `tail` / `head` invocations, both gates chained via `&&`, both use `--reporter=json | node -e "..."` |
| `git diff --stat` shows exactly the new test file (+aside test unchanged, +no source-file diffs) | ✓ | `git diff --stat 80cd6e8 HEAD` after this SUMMARY commit will show: (1) `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (new, +685), (2) `.planning/phases/27-.../27-03-SUMMARY.md` (new, this file). `PrettyView.aside.test.tsx` is byte-untouched. |

## Phase 27 close-out readiness

**Yes.** Phase 27 is code-complete and CI-verified for the orchestrator's deploy motion:

- Wave 1 (Plan 27-01): `@tanstack/react-virtual@3.14.9` runtime dependency installed. ✓
- Wave 2 (Plan 27-02): PrettyView message-list virtualized via `useVirtualizer` in two atomic commits (Step A adds virtualizer, Step B moves accessories out of the sized container). Full pretty-view test suite still green (426/426 passing). ✓
- Wave 3 (Plan 27-03, this plan): empirical CI coverage for must_haves #2/#3/#4/#5/#8 via 6 new tests in `PrettyView.virtualization.test.tsx`. Full frontend suite 1692/0 passed/failed. `tsc --noEmit` exit 0. ✓
- must_have #7 (image-bubble grow) verification path: Wave 2 Step B manual smoke check deferred to post-deploy production UAT — orchestrator's responsibility per fleet standing directive #2 (deploy motion is orchestrator-only). ✓
- must_have #10 (post-ship diag comparison): the diag emitter is byte-untouched across the phase (Wave 2 SUMMARY acceptance criteria #10 confirms). Post-ship diag comparison against `pre-iter3-baseline-diag.jsonl` is the empirical closing check for the parent hidden-pane-cost-mitigation-empirical-rotation bounty — that comparison is the orchestrator's responsibility on production after ship. ✓

**Reminder to orchestrator (tiffany):**

1. **Deploy motion:** docker build + coord-room announce + recreate + HTTPS 200 verify + push + `skynet-patches.md` entry per fleet standing directive #2.
2. **Image-bubble smoke check on production UAT** (per Wave 2 Step B handoff): load a session with at least one image-bearing message and verify the three observations from B6 (image bubble grows without jitter; items below stay correctly positioned; scroll-round-trip produces stable layout).
3. **Post-ship diag comparison:** on production, load the same 200-msg conversation used to capture `pre-iter3-baseline-diag.jsonl` and pull a fresh diag snapshot. Compare `domNodeCount` before/after — expected drop from ~2,500+ to ~200-400. That comparison closes the parent `hidden-pane-cost-mitigation-empirical-rotation` bounty. Same conversation on the same device viewport, per 27-02-SUMMARY § "Surprises for Wave 3 #3" caveat about viewport-height dependency.
4. **Post-ship cleanup:** once the parent bounty closes, rip out the diag emitter (~5 min per patch #342 notes) — that is out of scope for this executor's remit but is the natural next follow-up.

## Deviations from Plan

### Task 1 skipped (with rationale, per orchestrator's adjusted directive)

Not a deviation from the plan — the orchestrator's spawn prompt explicitly permitted this outcome: *"if the tests are already green after Step B (they were per the Wave 2 SUMMARY), Task 1 becomes: (a) confirm the aside tests still pass unchanged, (b) if any DOM-tree assertion is now over-permissive because it survived a layout change it should have caught, STRENGTHEN it. If no changes are needed, skip Task 1 with a rationale in the SUMMARY."* Rationale documented under Task 1 above.

### Widened the ResizeObserver stub (Rule 3 — auto-fix blocking issue)

The plan's `<action>` step 2 for Task 2 said: *"In a top-level beforeEach, set up the no-op resizeObserverStub from PrettyView.aside.test.tsx:122-127."* The no-op form is fine for Tests 4, 5a, 5b (they don't need to fire RO callbacks). But Tests 1, 2, 3 need to shrink the scroll container's offsetHeight AFTER mount AND drive the virtualizer's observeElementRect callback to re-read the new size. A no-op stub silently drops those callbacks.

**Fix:** widened the stub into a capturing multi-slot polyfill that stores every constructed RO's callback in `capturedROCallbacks[]`. This is precisely the mitigation 27-PATTERNS.md SURPRISE #3 recommends: *"the capturing polyfill can be widened to store an array of callbacks and expose 'fire the useAutoScroll one specifically'."* Test 1 fires all captured callbacks so the virtualizer's observeElementRect callback re-reads offsetHeight. No infrastructure churn beyond this inline widening.

**Files modified:** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` only (the new file — no other file touched).

**Rule:** Rule 3 (auto-fix blocking issue). The no-op stub blocked Test 1 from proving the bounded-DOM cap. The widening was necessary to satisfy the plan's own Test 1 requirement.

### Overrode HTMLElement.prototype offsetHeight + getBoundingClientRect on [data-pv-bubble] (Rule 3 — auto-fix blocking issue)

TanStack Virtual v3's `measureElement` reads `element.offsetHeight` when no ResizeObserver entry is available (`virtual-core/index.js:150`). JSDOM's default is 0. Without this override, every rendered item's measurement caches to 0, `getTotalSize()` returns 0, the virtualizer's visible-range math degenerates, and ~66 items get rendered regardless of viewport size — defeating Test 1's bounded-DOM cap.

**Fix:** conditional `Object.defineProperty(HTMLElement.prototype, "offsetHeight", ...)` + conditional `HTMLElement.prototype.getBoundingClientRect = function() { ... }`, both returning 80px only for elements that carry `data-pv-bubble`. Non-bubble elements fall through to the original prototype. Original descriptor captured at module scope and restored in `afterEach` so sibling test files are unaffected.

**Files modified:** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` only.

**Rule:** Rule 3 (auto-fix blocking issue). Without this, Test 1 could not pass regardless of any other change.

### Quote-style note on `getAttribute("data-event-id")` vs `getAttribute('data-event-id')`

Plan verification grep uses single quotes (`grep -c "getAttribute('data-event-id')"`). Test file uses double quotes (`el.getAttribute("data-event-id")`) at line 546 — matches the file's overall double-quote style (imports, other assertions, mock factory strings). Semantically identical JavaScript; the strict grep pattern misses the double-quote form. The plan's `<acceptance_criteria>` item 3 is a semantic requirement (observe the DOM attribute, not React's internal key), which is fully satisfied. See § "Plan-level `<verification>` grep checks" for the equivalent double-quote grep result (1 match).

**Not a deviation** — semantically identical, but flagging for orchestrator awareness in case a mechanical grep-verification post-check trips on quote style.

## Threat Flags

None. This is a test-only plan — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. The new test file's mocks (WS, compose-drafts API, session-hue) are verbatim copies from existing test files.

## Self-Check: PASSED

- `[ -f /home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/PrettyView.virtualization.test.tsx ]` — FOUND
- `git log --oneline --all | grep -q 5de45b1` — FOUND (Task 2 commit)
- `git diff --stat 80cd6e8 HEAD~0` shows exactly one file added: `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (+685 lines) — CONFIRMED (git status pre-SUMMARY-commit)
- `git diff --stat src/ui/features/pretty-view/PrettyView.aside.test.tsx src/ui/features/pretty-view/PrettyView.test.tsx src/ui/features/pretty-view/PrettyView.tsx src/ui/features/pretty-view/hooks/use-auto-scroll.ts src/ui/lib/diag-emitter.ts src/ui/lib/diag-registry.ts` prints nothing — CONFIRMED (all locked files untouched)
- `npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — 6 files test, 6 passed, 0 failed, exit 0
- `npx vitest run` (full suite) — 1692 passed / 0 failed / 1698 total (6 skipped, all pre-existing)
- `npx tsc --noEmit` — exit 0
- Plan `<automated>` gate — both NEW-FILE and FULL-SUITE stages exit 0
