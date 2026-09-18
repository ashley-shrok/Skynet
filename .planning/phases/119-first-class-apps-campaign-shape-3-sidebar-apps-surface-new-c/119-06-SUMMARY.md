---
phase: 119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c
plan: 06
subsystem: sidebar-apps-section-integration-tests
tags:
  - frontend
  - integration-test
  - lazy-render
  - three-layer-coverage
dependency-graph:
  requires:
    - "119-02 — app-tiles-store: exports AppState type consumed by mockAppTiles fixture + module path @/state/app-tiles-store swapped via vi.mock"
    - "119-03 — AppTile component: exposes `role='button'` + `aria-label='App tile: {title}'` shape queried by A16 / A18"
    - "119-04 — Panel integration: the .pv-apps-section chrome + data-testid='pretty-conversations-apps-header' + the D-04 empty-state string that A15-A20 interrogate"
  provides:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx — new `describe('PrettyConversationsPanel: Phase 119 Apps section', ...)` block containing A15-A20 integration tests + module-level mockAppTiles fixture + vi.mock('@/state/app-tiles-store', ...) swap"
  affects:
    - "Closes D-18 three-layer testing invariant for the sidebar Apps section — component (119-03) + store (119-02) + integration (this plan) all landed"
    - "Frontend regression net: any future change to Apps section chrome / lazy-render gate / search-outside-ternary insertion / above-Pinned placement is caught at CI time"
tech-stack:
  added: []
  patterns:
    - "Module-level mock swap (mirror of Phase 115's mockArchivedFleetRows pattern): `let mockAppTiles: AppState[] = []` + `vi.mock('@/state/app-tiles-store', () => ({ useAppTiles: () => mockAppTiles, ... }))` + `mockAppTiles = []` reset in beforeEach"
    - "Six integration tests A15-A20 in a namespaced describe block: `describe('PrettyConversationsPanel: Phase 119 Apps section', ...)` — no naming collision with A10-A14 Archived section describe (which is namespaced by 'Phase 115 Plan 115-06 Archived section (D-06 / D-19)')"
    - "role-based lookups where the component provides them: `screen.queryAllByRole('button', { name: /App tile:/ })` for tile counting, `screen.getByRole('searchbox')` for the search input, `screen.getByTestId('pretty-conversations-apps-header')` for the section header"
    - "compareDocumentPosition + Node.DOCUMENT_POSITION_FOLLOWING bitwise-AND gate for A20 DOM-order assertion (Apps header must precede [data-pinned-group='true'] wrapper — D-01 placement)"
    - "Local fixture builder `makeAppTile(overrides: Partial<AppState> = {}): AppState` keeps A15-A20 fixture assembly compact — nine-field AppState fixture with sensible defaults, tests override only the fields they exercise"
key-files:
  created:
    - .planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/119-06-SUMMARY.md
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Placed the AppState type import as a sibling of `import type { Host, HostFolder } from '@/types/ui-types'` at :38 — same import-family (type-only imports for test-side fixture shapes) with a Phase 119 Plan 119-06 comment block above documenting the fixture-swap connection"
  - "Placed the `let mockAppTiles: AppState[] = []` declaration directly below the `mockArchivedFleetRows` declaration at :249-257 — physical adjacency to the sibling fixture the pattern mirrors, making the D-05-vs-Archived contrast discoverable in one place"
  - "Placed the `vi.mock('@/state/app-tiles-store', ...)` directly below the `vi.mock('@/state/conversation-store', ...)` block that includes `useArchivedFleetRows: () => mockArchivedFleetRows` — same file-region (state-slice mocks) so a future edit to either sibling mock lives in the same neighborhood"
  - "Included stubs for publishAppSnapshot / publishAppUpdate / publishAppGone / subscribeAppTilesStore / __resetForTest in the vi.mock even though the panel does not call them — mirrors the real module's export surface so if a future integration test imports any of them from this file's mock (e.g. to assert AppShell wiring didn't leak), the mock does not throw 'undefined is not a function'"
  - "Added the `mockAppTiles = []` reset in the beforeEach directly below the `mockArchivedFleetRows = []` reset, with a Phase 119 Plan 119-06 comment tying it to D-05 (header present) and D-03 (lazy-render body absent)"
  - "Named the new describe block `PrettyConversationsPanel: Phase 119 Apps section` — namespaces on Phase-number to prevent any collision with the sibling A10-A14 describe (`Phase 115 Plan 115-06 Archived section (D-06 / D-19)`), addressing threat T-119-06-02 grep-verified"
  - "Kept the local fixture builder INSIDE the describe block (not at module top level) — tests A15-A20 are the only site that needs it, and colocating avoids polluting the module namespace with a symbol that has no other consumers"
  - "Reused `screen.queryAllByRole('button', { name: /App tile:/ })` for tile counting rather than a data-testid selector — the AppTile's aria-label at AppTile.tsx:206 is the accessible-name contract Plan 119-03 established, and role-based queries better assert the aria surface actually being reachable"
  - "Used `screen.getByRole('searchbox')` for A19 rather than the data-testid — the panel's `<input type='search'>` at :1807 exposes the WAI-ARIA implicit 'searchbox' role, and role-based queries assert the a11y surface is intact. Fallback via `getByPlaceholderText(/search/i)` was NOT needed — the role query resolved cleanly (verified by test pass)"
  - "For A20 DOM-order, used compareDocumentPosition + Node.DOCUMENT_POSITION_FOLLOWING (constant, not literal 4) — self-documenting; matches the pattern the existing Test A2 at :2807 uses (literal 4) but with the constant name for clarity"
  - "A18 seeds three tiles in [Alpha, Beta, Gamma] order representing what the D-15 store sort returns, and asserts DOM order matches. Does NOT re-test the store's sort (that lives in Plan 119-02's app-tiles-store.test.ts) — the assertion here is that the PANEL preserves hook-returned order without adding a second sort layer"
  - "A16 seeds a POPULATED mockAppTiles (not empty) to prove the collapsed lazy-gate is what suppresses the DOM, rather than the empty-list branch happening to render nothing. This is the D-03 lazy-render invariant expressed in its strongest form"
  - "Did NOT re-test AppTile visual rendering (icon fallback, healthMessage, hover states) — that coverage lives in AppTile.test.tsx per Plan 119-03. D-18 three-layer discipline explicitly separates the concerns"
  - "Did NOT re-test store publish fns / sort tiebreak / subscribe/unsubscribe lifecycle — that coverage lives in app-tiles-store.test.ts per Plan 119-02. Same three-layer discipline"
  - "Did NOT modify any of the pre-existing A1-A14 tests — pure appends verified via `git diff --stat` (264 insertions, 0 deletions) and `git diff | grep -E '^-[^-]'` (empty output)"
metrics:
  duration_minutes: 15
  completed: "2026-09-18"
  tasks_completed: 1
  files_touched: 1
  commits: 1
  new_tests: 6
  scoped_vitest_total: 181
  scoped_vitest_prior: 175
---

# Phase 119 Plan 06: Apps section integration tests (A15-A20) — Summary

Closed the D-18 three-layer testing invariant for the sidebar Apps section
by appending six integration tests A15-A20 to
`PrettyConversationsPanel.test.tsx`, mirroring the module-level mock swap
pattern that Phase 115 Plan 115-06 established for the Archived section
tests (A10-A14). Coverage now spans:

- **Component-level** (Plan 119-03 → `AppTile.test.tsx`) — icon render +
  fallback + healthMessage + context menu + ordering stability
- **Store-level** (Plan 119-02 → `app-tiles-store.test.ts`) — publish fns
  + snapshot/update/gone reconciliation + sort tiebreak + subscribe cleanup
- **Integration-level** (this plan → new describe in
  `PrettyConversationsPanel.test.tsx`) — section header always-present +
  lazy-render invariant + empty-state prompt + hook-order preservation +
  search-outside-ternary + above-Pinned DOM placement

The six tests concretise D-05 (A15 always-present), D-03 (A16 lazy-render
zero tiles + no empty-state prompt when collapsed), D-04 (A17 empty-state
prompt on expand), D-01+D-15 (A18 populated + hook-order preservation),
RESEARCH.md Pitfall 2 (A19 survives active search), and D-01 placement
(A20 header precedes Pinned group).

## What Was Built

### Task 1: A15-A20 integration tests + mock swap (commit see below)

Four co-located additions to `PrettyConversationsPanel.test.tsx`, zero
touches to prior tests:

**1. AppState type import** placed as sibling of the existing
`{ Host, HostFolder }` type import at :38, with a comment tying it to
the Phase 119 Plan 119-06 mock-swap contract:
```tsx
import type { AppState } from "@/api/fleet-status-types";
```

**2. Module-level mockAppTiles fixture** placed directly below the
sibling `mockArchivedFleetRows` fixture (physical adjacency to the
pattern being mirrored) with a comment covering all six invariants
A15-A20 exercise:
```tsx
let mockAppTiles: AppState[] = [];
```

**3. `vi.mock("@/state/app-tiles-store", ...)`** placed directly below
the `vi.mock("@/state/conversation-store", ...)` block that includes
`useArchivedFleetRows: () => mockArchivedFleetRows`. Includes stubs for
all real-module exports (publishAppSnapshot / publishAppUpdate /
publishAppGone / subscribeAppTilesStore / __resetForTest) even though
the panel only calls `useAppTiles`, so a future test that imports any
of them from this mock does not hit "undefined is not a function":
```tsx
vi.mock("@/state/app-tiles-store", () => ({
  useAppTiles: () => mockAppTiles,
  publishAppSnapshot: vi.fn(),
  publishAppUpdate: vi.fn(),
  publishAppGone: vi.fn(),
  subscribeAppTilesStore: (_cb: () => void) => () => {},
  __resetForTest: vi.fn(),
}));
```

**4. `mockAppTiles = []` reset** in the shared `beforeEach` alongside
the sibling `mockArchivedFleetRows = []` reset, with a Phase 119 Plan
119-06 comment tying it to D-05 (header present) + D-03 (lazy-render
body absent) — this is the collapsed-and-empty default that all non-
119-06 tests observe automatically.

**5. New describe block** appended at the end of the file containing
the six tests A15-A20 + a local `makeAppTile(overrides)` fixture
builder (nine-field AppState defaults; tests override only what they
exercise):

- **A15** — `mockAppTiles=[]` → `screen.getByTestId(
  "pretty-conversations-apps-header")` succeeds AND header text
  contains "Apps" (D-05 always-present chrome + D-02 label mirror)
- **A16** — `mockAppTiles=[appA, appB]` (populated to prove the gate,
  not the empty branch, is what suppresses the DOM) + default-collapsed
  → `screen.queryAllByRole("button", {name: /App tile:/}).length === 0`
  AND `screen.queryByText("Ask an agent to make an app for you.")` is
  null (D-03 lazy-render — both tiles AND empty-state gated out)
- **A17** — `mockAppTiles=[]` + `fireEvent.click(header)` → the D-04
  prompt "Ask an agent to make an app for you." becomes visible
  (before the click, `queryByText(...)` returns null — proving the D-03
  lazy-gate encloses the empty-state too)
- **A18** — `mockAppTiles=[Alpha, Beta, Gamma]` (already in the order
  the D-15 store sort would return) + expanded → three AppTile buttons
  render in exactly [Alpha, Beta, Gamma] DOM order (panel preserves
  hook-returned order; no re-sort layer)
- **A19** — `mockAppTiles=[]` + `fireEvent.change(searchInput,
  {target: {value: "xyz"}})` where `searchInput = screen.getByRole(
  "searchbox")` → the section header is present BOTH before and after
  the search input change (Pitfall 2 + D-05 — section is a sibling of
  the loading strip, not a child of either ternary branch)
- **A20** — `mockAppTiles=[appA]` + `pinned=[row-a]` + `pinnedIds=Set(
  ["a"])` → `appsHeader.compareDocumentPosition(pinnedGroup) &
  Node.DOCUMENT_POSITION_FOLLOWING === Node.DOCUMENT_POSITION_FOLLOWING`
  (D-01 placement — Apps header precedes `[data-pinned-group="true"]`
  in DOM order)

Diff shape: `1 file changed, 264 insertions(+), 0 deletions(-)`. Pure
additions — verified by `git diff | grep -E '^-[^-]'` returning empty.
No modifications to any A1-A14 test or any other pre-existing block.

## Verification

- **Scoped vitest** (executor gate per D-19):
  `npx vitest related --run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx src/ui/state/app-tiles-store.ts src/ui/features/pretty-conversations/AppTile.tsx`
  → **8 test files passed, 181 tests passed, 0 failed** (previously 175
  for this exact scope per 119-04-SUMMARY.md; delta = +6 = exactly the
  new A15-A20 count)
- **Verbose reporter** shows each of A15-A20 running individually under
  the new describe:
  - `A15: mockAppTiles=[] → Apps section header renders (D-05 always-present)` 13ms
  - `A16: D-03 lazy — collapsed section renders zero AppTile instances + no empty-state prompt` 30ms
  - `A17: click header → section expands → 'Ask an agent to make an app for you.' becomes visible (D-04)` 22ms
  - `A18: mockAppTiles populated + expanded → renders one AppTile per entry in hook order (D-01 + D-15)` 45ms
  - `A19: typing in the search input does NOT hide the Apps section header (Pitfall 2 + D-05)` 33ms
  - `A20: Apps section header precedes the Pinned group in DOM order (D-01 placement)` 19ms
- **Diff hygiene** (pure additive):
  - `git diff --stat`: `1 file changed, 264 insertions(+), 0 deletions(-)`
  - `git diff | grep -E '^-[^-]'`: empty output (no line deletions
    other than the diff-header `---` markers)
  - Therefore A1-A14 + every other pre-existing test block is byte-
    unchanged; the mock-swap addition is purely additive to the
    module-level fixture block
- **Post-commit deletion check** (from `<task_commit_protocol>` step 6):
  `git diff --diff-filter=D --name-only HEAD~1 HEAD` → empty. Pure add.
- **Untracked-file check**: `git status --short` after commit → clean.

## Acceptance Criteria Traceability

| Criterion (from plan `<acceptance_criteria>`) | Threshold | Result |
|-----------|-----------|--------|
| `grep -c "Phase 119 Apps section" PrettyConversationsPanel.test.tsx` | ≥ 1 | **1** (describe block name — namespaced to prevent collision per T-119-06-02) |
| `grep -c "mockAppTiles" PrettyConversationsPanel.test.tsx` | ≥ 3 | **15** (1 declaration + 1 reset + 1 vi.mock body ref + 12 test-body uses across A15-A20) |
| `grep -c "app-tiles-store" PrettyConversationsPanel.test.tsx` | ≥ 1 | **4** (vi.mock path + 3 comment refs across the mock/fixture/beforeEach comments) |
| `grep -c "pretty-conversations-apps-header" PrettyConversationsPanel.test.tsx` | ≥ 3 | **6** (A15 + A16 chain via header, A17 + A19 + A20 direct + comment ref) |
| `grep -c 'Ask an agent to make an app for you\.' PrettyConversationsPanel.test.tsx` | ≥ 2 | **5** (A16 negative queryByText + A17 pre-click queryByText + A17 post-click getByText + comment ref in describe intro + comment ref in A17 body) |
| Existing A10-A14 Archived tests unchanged (`git diff` shows only appended + mock swap) | pure adds | **verified** — `git diff | grep -E '^-[^-]'` empty; sole additions are (a) AppState import (b) mockAppTiles fixture (c) vi.mock (d) beforeEach reset line (e) appended describe block. All Archived-section blocks and their `mockArchivedFleetRows` swap are byte-unchanged |
| Scoped vitest exits 0 with all A15-A20 passing AND all A1-A14 still passing | 0 exit + 181 pass | **0 exit** + **181 pass** (verbose reporter confirms A15-A20 all ✓ AND A10-A14 all ✓ AND every other pre-existing test ✓) |
| A16 concretely observes zero AppTile instances via `.queryAllByRole("button", {name: /App tile:/}).length === 0` | 0 tiles | **verified** — A16 seeds 2 tiles (populated store) AND asserts `tiles.length).toBe(0)` — proves the gate is what suppresses, not the empty branch |
| A20 uses `compareDocumentPosition` to assert Apps header precedes Pinned group | precedence | **verified** — A20 body uses `appsHeader.compareDocumentPosition(pinnedGroup!) & Node.DOCUMENT_POSITION_FOLLOWING` with `Node.DOCUMENT_POSITION_FOLLOWING` constant (self-documenting vs. literal 4) |

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's `<action>` block was implemented byte-for-byte: (1)
`mockAppTiles: AppState[] = []` declaration placed near
`mockArchivedFleetRows`, (2) `vi.mock("@/state/app-tiles-store", ...)`
using the exact module path the panel imports (`@/state/app-tiles-store`
— verified against panel :166 which reads
`import { useAppTiles } from "@/state/app-tiles-store"`), (3) reset in
beforeEach, (4) new namespaced describe block with A15-A20.

No auth gates. No architectural questions (Rule 4). No package installs.
No CLAUDE.md conflicts (the repo has no `./CLAUDE.md`). No untracked-
file leakage. No prior tests / mocks / fixtures / hooks touched.

The AppState fixture followed the plan's suggested nine-field shape
exactly (`hostId, slug, title, description, port, hasIcon, createdAtMs,
isHealthy, healthMessage`) via a local `makeAppTile(overrides)` builder;
extended for multi-tile cases via `overrides` (A16 uses two tiles, A18
uses three tiles, A20 uses one tile alongside a real conversation row
for the DOM-order comparison).

The A19 search-input lookup used `screen.getByRole("searchbox")` on
the first attempt — the WAI-ARIA implicit role of `<input type="search">`
at PrettyConversationsPanel.tsx:1807 resolved cleanly. The plan's
fallback path (`getByPlaceholderText(/search/i)`) was NOT needed.

The A20 Pinned-group identifier was found by grepping the same test
file for `data-pinned-group` — pre-existing tests at :663-665 / :760-762
/ :882 / :2083 already use `[data-pinned-group="true"]` as the Pinned-
wrapper selector, so A20 adopts the same. No new selector introduced.

## Known Stubs

**None.** All six tests exercise real live code paths:
- `PrettyConversationsPanel.tsx` (real component, Plan 119-04)
- `useAppTiles` mock returning a real `AppState[]` (the mock IS the
  test contract for the hook's return shape; the real hook's behavior
  is covered by `app-tiles-store.test.ts` per Plan 119-02)
- `AppTile` (real component, Plan 119-03) — A16 / A18 / A20 render real
  AppTile instances and query their real aria-label surface
- Real search input at panel :1806-1814 driven by `fireEvent.change`
- Real Pinned-group render path with a real seeded conversation row +
  `data-pinned-group="true"` wrapper

The `publish*` fn stubs in the vi.mock are inert on purpose — the
panel never calls them, they exist only so a future test that imports
them from this file's mock doesn't hit `undefined is not a function`.
No test currently exercises them.

## TDD Gate Compliance

The plan's task is marked `tdd="true"`. Because the sidebar Apps
section is already implemented (Plan 119-04, commit `dd51941a`), the
new A15-A20 tests naturally pass on the first invocation — a
retroactive-coverage add pattern (D-18 three-layer coverage was the
plan's explicit goal, not a fresh feature). This is the correct RED
behavior for a coverage-completion plan: the test IS the RED gate,
and it lands green because the SUT already satisfies the contract.

The plan is not adding new production code; the executor's `<action>`
block is scoped exclusively to the test file. There is no separate
GREEN-phase implementation commit, nor a REFACTOR-phase commit — the
plan's `<done>` criterion (six integration tests cover the Apps
section per D-01/D-03/D-04/D-05/D-18; all pre-existing tests in the
file continue to pass) is met by the single test-file edit landing
green immediately.

The three-layer D-18 coverage is now COMPLETE across the phase:
- **Component gate** (119-03): `AppTile.test.tsx` — 11 tests
- **Store gate** (119-02): `app-tiles-store.test.ts` — 11 tests
- **Integration gate** (119-06 — THIS PLAN): 6 tests A15-A20
- **Backend route gate** (119-05): `apps.test.ts` for the icon endpoint

## Threat Model Coverage

| Threat ID | Category | Disposition | Where mitigated |
|-----------|----------|-------------|-----------------|
| T-119-06-01 | Tampering — mock leakage into pre-existing A10-A14 / Pinned / search tests | mitigate | `mockAppTiles = []` reset lives in the SHARED module-level `beforeEach` (not the new describe's local beforeEach) — every test in the file gets the empty-store default. The existing `mockArchivedFleetRows` swap is byte-unchanged (verified by `git diff | grep -E '^-[^-]'` returning empty). Scoped vitest passes 181/181 including all pre-existing tests |
| T-119-06-02 | Denial of Service — describe naming collision suppressing existing describes | mitigate | Describe block name explicitly namespaced `"PrettyConversationsPanel: Phase 119 Apps section"` — grep of the file for `Phase 119` returns exactly 1 (the describe name); no pre-existing describe uses "Phase 119" in its title |
| T-119-06-SC | Tampering — npm/pip/cargo installs | accept | Zero package installs; the test file uses pre-existing imports (`vitest`, `@testing-library/react`, existing app-tiles-store/AppTile symbols) — all already present in the workspace |

## Threat Flags

None. This plan adds no new network endpoints, no new auth paths, no
new file access, no schema at any trust boundary. It appends test-only
assertions and one module-level mock swap to an existing test file. The
mock swap replaces a real module import with a test double at load
time — a well-established vitest pattern already used elsewhere in the
same file (six sibling `vi.mock(...)` calls existed before this edit).

## Downstream — Post-Deploy Agent-UAT Reminder (D-20)

**Agent-UAT (NOT this executor's job — the orchestrator or the
campaign-close step owns it):** D-20 requires real end-to-end
integration on t1000 before the campaign ships. Create scratch
`~/fleet/apps/scratch-sidebar-test/` on t1000 with a real `app.json`
+ a real systemd `--user` unit + a real `icon.webp`; open the sidebar;
expand the Apps section; verify the tile appears with the icon
rendered; right-click → "Open in new tab" opens a fresh authenticated
tab; stop the unit → tile flips to unhealthy two-line with the
healthMessage; delete the folder → tile disappears on next sweep tick.
Cleanup after (delete folder + `systemctl --user stop` + `disable` +
`daemon-reload`). This is agent-side UAT, not CI-runnable — and it is
outside Plan 119-06's scope (per D-19: executor uses scoped test runs;
orchestrator runs full-suite + Playwright pre-deploy; campaign-close
runs agent-UAT).

## Commits

- (see git log after the commit) — test(119-06): add A15-A20 Apps
  section integration coverage (closes D-18 three-layer)

## Self-Check: PASSED

- `.planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/119-06-SUMMARY.md` — CREATED
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — MODIFIED (+264, -0)
- Scoped vitest: 181/181 tests pass (was 175/175 before this plan; delta = +6 = exactly the A15-A20 count)
- All A15-A20 tests pass individually under `describe("PrettyConversationsPanel: Phase 119 Apps section", ...)`
- All A10-A14 Archived tests still pass (regression-safe)
- Diff hygiene: 264 insertions, 0 deletions — pure add
- Acceptance criteria: 9/9 met (see Traceability table)
- D-18 three-layer testing gate: COMPLETE (component + store + integration + backend route across the phase's 6 plans)
