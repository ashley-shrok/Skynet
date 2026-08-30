---
phase: 52-convo-list-filter-restyle-popover-add-ready-toggle
plan: "04"
subsystem: pretty-conversations-filter
tags:
  - ui
  - test
  - filter
  - react
  - working-store
  - ready-predicate
  - phase-52
dependency_graph:
  requires:
    - phase: 52-01
      provides: useSessionIsDormant hook + getSessionWorkingSnapshot + WorkingRecord.dormant shape
    - phase: 52-02
      provides: readyOnly state + filter popover markup + pv-filter-toggle-ready testid + width:auto W-1 fix
    - phase: 52-03
      provides: matchesFilterForRow Ready predicate (fail-CLOSED) + rowSessionStates map + B-2 stubs
  provides:
    - Phase 52 filter popover integration test coverage (10 tests)
    - vi.mock factory upgraded to spy-based per-test seeding via mockIsWorkingByKey / mockIsDormantByKey / mockWorkingSnapshot
    - W-1 lock: width:auto in chrome assertion
    - W-3 lock: P50-6b fail-CLOSED test (row absent from working-store hidden when readyOnly=on)
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
tech_stack:
  added: []
  patterns:
    - "Module-scoped mutable Map seeding for working-store mocks: mirrors existing mockAiTitleByKey pattern; Maps reset in beforeEach (module-level) and afterEach (describe-local) for belt-and-suspenders clean state"
    - "JSDOM color normalization: hex color #e8e4d8 → rgb(232, 228, 216) when read back from getAttribute('style'); test asserts both forms"
    - "sessionMatchKey key correction: mockWorkingSnapshot keyed by sessionMatchKey('tina-session')='tina-session' (what Panel uses for rowSessionStates lookup); mockIsWorkingByKey keyed by sessionWorkingKey(row)='1:tina-session' (what useSessionIsWorking uses)"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
key-decisions:
  - "Seeding key correction (Rule 1 auto-fix): the plan's example used '1:tina-session' as the mockWorkingSnapshot key. But the Panel's rowSessionStates builder does snapshot.get(sessionMatchKey(row.targetTmuxSession)) = snapshot.get('tina-session'). Using '1:tina-session' would make all Ready-predicate tests default to fail-CLOSED behavior regardless of what was seeded. Corrected to: mockWorkingSnapshot keyed by 'tina-session' (the sessionMatchKey result); mockIsWorkingByKey / mockIsDormantByKey keyed by '1:tina-session' (the sessionWorkingKey result, for per-row hooks)."
  - "JSDOM color normalization (Rule 1 auto-fix): P50-1's initial #e8e4d8 assertion failed because JSDOM normalizes hex to rgb() when reading back from style attributes. Fixed by checking both forms: styleAttr.includes('#e8e4d8') || styleAttr.includes('rgb(232, 228, 216)')."
  - "afterEach scoped to new describe block: the Plan 04 seeding Maps are cleared in an afterEach inside the Phase 52 describe block (belt-and-suspenders). The module-level beforeEach also resets all three Maps to empty Map instances, so existing tests see the exact same empty-Map default that Plan 03's default stubs provided."
metrics:
  duration: ~15 minutes
  completed: 2026-08-21
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 52 Plan 04: Phase 52 filter popover test coverage Summary

**Adds 10 integration tests covering the Phase 52 filter popover chrome, menu-item shape, Ready toggle predicate (all 4 branches including fail-CLOSED default), filter-dot extension, RDP pass-through, and AND-intersection. Upgrades the vi.mock factory from Plan 03's default stubs to spy-based per-test seeding via three module-scoped Maps.**

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Phase 52 filter popover describe block + upgrade vi.mock factory | `9fc17534` | PrettyConversationsPanel.test.tsx |

## Test Names (P50-1 through P50-9 + P50-6b)

| Tag | Test name | What it locks |
|-----|-----------|---------------|
| P50-1 | popover chrome tokens are present on PopoverContent inline style including width:auto (plan-checker W-1 alignment) | Glass gradient, warm border, blur/saturate, rgb(232,228,216) color, min-width:200px, **width:auto** |
| P50-2 | popover renders 3 menuitemcheckbox buttons in Ready → Pinned → Needs desk order | Item count, roles, order |
| P50-3 | Ready button has a .pv-filter-check affordance with inline-SVG path M3.5 8.5 L7 12 L13 5; clicking toggles data-checked | SVG check path, data-checked toggle |
| P50-4 | Ready toggle hides rows where isWorking=true | Working-row hidden branch |
| P50-5 | Ready toggle hides rows where isDormant=true | Dormant-row hidden branch |
| P50-6 | Ready toggle shows idle-not-dormant rows that have a seeded wire signal (fail-CLOSED-compatible admit case) | Admit branch (rowState defined + idle + not-dormant) |
| P50-6b | Ready toggle fail-CLOSED default: row with no wire signal is HIDDEN when readyOnly is on | **W-3 lock**: fail-CLOSED default (rowState undefined → hidden) |
| P50-7 | anyFilterOn extends to readyOnly: .pv-filter-dot appears and data-active=true when only Ready is on | Filter-dot extension to readyOnly |
| P50-8 | RDP-group rows pass through unfiltered when Ready toggle is on | RDP pass-through |
| P50-9 | AND-intersection: Ready-on + Pinned-on rejects a row that passes Ready but has pinnedCount=0 | AND-intersection logic |

## vi.mock Factory Shape (post-Plan-04)

```ts
// Module-scoped Maps + spies (Phase 52 Plan 04 additions):
let mockIsWorkingByKey: Map<string | null, boolean> = new Map();
let mockIsDormantByKey: Map<string | null, boolean> = new Map();
let mockWorkingSnapshot: Map<string, { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null; dormant: boolean }> = new Map();

const useSessionIsWorkingSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return false;
  return mockIsWorkingByKey.get(sessionKey) ?? false;
});
const useSessionIsDormantSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return false;
  return mockIsDormantByKey.get(sessionKey) ?? false;
});
const getSessionWorkingSnapshotSpy = vi.fn(() => mockWorkingSnapshot as ReadonlyMap<...>);

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: (sessionKey: string | null) => useSessionIsWorkingSpy(sessionKey),
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: (sessionKey: string | null) => useSessionAiTitleSpy(sessionKey),
  getSessionWorkingSnapshot: () => getSessionWorkingSnapshotSpy(),
  useSessionIsDormant: (sessionKey: string | null) => useSessionIsDormantSpy(sessionKey),
}));
```

## Test Counts (Before / After)

| File | Before Plan 04 | After Plan 04 |
|------|---------------|---------------|
| PrettyConversationsPanel.test.tsx | 91 | 101 (+10) |
| Full pretty-conversations suite | 213 | 223 (+10) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Incorrect mockWorkingSnapshot key in plan examples**
- **Found during:** Implementation — cross-referencing `sessionMatchKey` mock (line 49-51: just lowercases the name) against the plan's `"1:tina-session"` key for `mockWorkingSnapshot`.
- **Issue:** The plan said to seed `mockWorkingSnapshot.set("1:tina-session", ...)`. But the Panel's `rowSessionStates` builder does `snapshot.get(sessionMatchKey(row.targetTmuxSession))` = `snapshot.get("tina-session")`. Using `"1:tina-session"` would make the lookup return `undefined` for every row, causing all Ready-predicate tests to default to the fail-CLOSED path regardless of what was seeded — making P50-4, P50-5, P50-6, and P50-9 produce incorrect (misleading) results.
- **Fix:** Seed `mockWorkingSnapshot` with `"tina-session"` (the `sessionMatchKey` result). Seed `mockIsWorkingByKey` / `mockIsDormantByKey` with `"1:tina-session"` (the `sessionWorkingKey` result, used by per-row hooks). Both keys are documented in a comment in the shared `setupTinaRow()` helper.
- **Files modified:** PrettyConversationsPanel.test.tsx
- **Commit:** `9fc17534`

**2. [Rule 1 - Bug] JSDOM normalizes #e8e4d8 hex to rgb() in style attribute reads**
- **Found during:** First test run — P50-1 failed with `expected '...' to contain '#e8e4d8'`.
- **Issue:** JSDOM converts hex colors to `rgb()` form when returning `getAttribute("style")`. The actual value was `color: rgb(232, 228, 216)`.
- **Fix:** Assert both forms: `styleAttr.includes('#e8e4d8') || styleAttr.includes('rgb(232, 228, 216)') || styleAttr.includes('rgb(232,228,216)')`.
- **Files modified:** PrettyConversationsPanel.test.tsx
- **Commit:** `9fc17534`

## Acceptance Criteria Verification

| Check | Result |
|-------|--------|
| `grep -c "Phase 52 — filter popover restyle + Ready toggle"` = 1 | 1 |
| `grep -c "P50-[1-9]\|P50-6b"` ≥ 10 | 21 |
| `grep -c "pv-filter-toggle-ready"` ≥ 4 | 9 |
| `grep -q "M3.5 8.5 L7 12 L13 5"` exits 0 | PRESENT |
| `grep -q "menuitemcheckbox"` exits 0 | PRESENT |
| `grep -c "dormant"` ≥ 3 | 13 |
| `grep -q "width: auto\|width:auto"` exits 0 | PRESENT |
| `grep -q "fail-CLOSED"` exits 0 | PRESENT |
| `grep -c "mockIsWorkingByKey\|mockIsDormantByKey\|mockWorkingSnapshot"` ≥ 6 | 22 |
| `grep -c "useSessionIsWorkingSpy\|useSessionIsDormantSpy\|getSessionWorkingSnapshotSpy"` ≥ 6 | 9 |
| `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel` 0 failures | 101/101 passed |
| Total passing count = existing + 10 | 91 → 101 (+10) |
| `npx tsc --noEmit` error TS count = 0 | 0 |
| Existing Phase 26 tests still passing | PASSED (all 91 pre-Plan-04 tests green) |
| Full pretty-conversations suite | 223/223 passed (9/9 files) |

## Known Stubs

None — all 10 tests exercise real filter behavior via the spy-seeded working-store mock. The `mockWorkingSnapshot` entries mirror the exact `WorkingRecord` shape from Plan 01 (`{ isWorking, lastMessageAt, aiTitle, dormant }`).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. All changes are test-only.

## Self-Check: PASSED

Verified files exist:
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — modified and committed at `9fc17534`

Verified commit exists:
- `git log --oneline | grep 9fc17534` — present on `feat/tab-title-from-tmux`

Verified acceptance criteria greps:
- `grep -c "Phase 52 — filter popover restyle + Ready toggle"` → 1 ✓
- `grep -c "P50-[1-9]\|P50-6b"` → 21 (≥10) ✓
- `grep -c "pv-filter-toggle-ready"` → 9 (≥4) ✓
- `grep -q "M3.5 8.5 L7 12 L13 5"` → exits 0 ✓
- `grep -q "menuitemcheckbox"` → exits 0 ✓
- `grep -c "dormant"` → 13 (≥3) ✓
- `grep -q "width: auto\|width:auto"` → exits 0 ✓
- `grep -q "fail-CLOSED"` → exits 0 ✓
- `grep -c "mockIsWorkingByKey\|mockIsDormantByKey\|mockWorkingSnapshot"` → 22 (≥6) ✓
- `grep -c "useSessionIsWorkingSpy\|useSessionIsDormantSpy\|getSessionWorkingSnapshotSpy"` → 9 (≥6) ✓
- `npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel` → 101/101 passed ✓
- `npx vitest run src/ui/features/pretty-conversations/` → 223/223 passed, 9/9 files ✓
- `npx tsc --noEmit` → 0 error TS ✓
