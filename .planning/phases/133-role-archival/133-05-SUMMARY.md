---
phase: 133
plan: 05
subsystem: frontend
tags: [ui, context-menu, archive, role, tdd]
status: PASS
dependency_graph:
  requires:
    - "@/features/pretty-conversations/PrettyConversationContextMenu (existing)"
    - "@/state/identities-store useIdentities() (existing)"
    - "@/api/role-archive-api archiveRole() (Plan 133-02)"
  provides:
    - "Right-click Archive gesture on RolesListModal rows — operator entry point for role archival"
    - "Fire-and-forget POST that drops the .archive-requested sentinel consumed by the Plan 133-04 supervisor scanner"
  affects:
    - "End-to-end Phase 133 flow now dialable: right-click role → double-confirm → sentinel drop → supervisor cascade → role folder moves to ~/fleet/roles-archive/<name>/"
tech_stack:
  added: []
  patterns:
    - "PrettyConversationContextMenu portal-mounted with hue-tinted border + single danger Archive item"
    - "Double window.confirm sequence — cascade preview then sanity tap (byte-identical to identity-archive sanity-tap copy)"
    - "Frontend-side cascade preview enumeration via useIdentities().filter (D-04)"
    - "task || displayName fallback matching AppShell.tsx:894 — no 'Untitled conversation' special-case"
    - "Fire-and-forget archiveRole().catch(err => console.warn({ structured shape })) — mirrors IdentitySessionPane.tsx:232-239"
    - "vi.spyOn(window, 'confirm') per-call return control + module-scoped identities-store mock for cascade-preview seeding"
key_files:
  created: []
  modified:
    - "src/ui/features/pretty-view/RolesListModal.tsx (+104 lines: three new imports, useIdentities() hook, menuOpen state atom, handleArchiveClick handler, onContextMenu row binding, PrettyConversationContextMenu mount)"
    - "src/ui/features/pretty-view/RolesListModal.test.tsx (+290 lines: two new module-level mocks (archiveRole + useIdentities), new Phase 133 describe block with 11 tests)"
decisions:
  - "D-01 honored: single POST fire-and-forget, no fan-out from frontend."
  - "D-02 honored: right-click affordance on RolesListModal rows, danger-styled Archive item, mirrors identity-archive shape."
  - "D-03 honored: double confirm — cascade preview (N=0 empty case + N>0 line-per-identity), sanity-tap copy byte-identical to identity-archive."
  - "D-04 honored: cascade preview computed frontend-side via useIdentities().filter — no new RPC."
  - "Plan-level divergence from identity-archive UX: RolesListModal STAYS OPEN after Archive click (browse-and-act — operator may archive several roles in sequence). Explicit per plan rationale."
  - "Radix Dialog + context-menu coexistence (RESEARCH A1): tests pass without any adapter code — Dialog is modal={false} at L184 so onInteractOutside doesn't eat the menu-item click. See 'Manual UAT' below — deferred to next in-app smoke."
metrics:
  duration_minutes: 12
  tasks_completed: 1
  tests_added: 11
  files_modified: 2
  completed_date: "2026-09-24"
---

# Phase 133 Plan 133-05: RolesListModal archive-role context menu Summary

One-liner: right-click a role row in `RolesListModal` → context menu with danger-red `Archive` → double `window.confirm` (cascade preview + sanity tap) → fire-and-forget `archiveRole(hostId, roleName)`.

## What Landed

Two file edits, one Task, TDD RED→GREEN (no REFACTOR needed):

1. **`src/ui/features/pretty-view/RolesListModal.tsx`** (+104 lines)
   - Three new imports: `PrettyConversationContextMenu` + `PrettyContextMenuItem` type, `useIdentities`, `archiveRole`.
   - `useIdentities()` hook wired at the top of the component — supplies the cascade-preview identities array.
   - New state atom `menuOpen: { x, y, roleName, roleDisplayLabel, hue } | null` — captures cursor coords + row identity for the mounted context menu.
   - New `handleArchiveClick(roleName, roleDisplayLabel)` handler — computes cascade via `identities.filter(i => i.role === roleName && i.hostId === selectedHostId)`, presents both `window.confirm` dialogs, fires `archiveRole` fire-and-forget with structured `console.warn` in the `.catch`.
   - Row `<button>` gets a new `onContextMenu` prop — `e.preventDefault()` then sets `menuOpen`.
   - `PrettyConversationContextMenu` mounted inside `DialogPrimitive.Portal` (its own `createPortal` decides its final DOM home).

2. **`src/ui/features/pretty-view/RolesListModal.test.tsx`** (+290 lines)
   - Two new module-level mocks: `@/api/role-archive-api` (spy `archiveRoleMock`), `@/state/identities-store` (mutable `useIdentitiesReturn.identities` array seeded per-test).
   - New `describe("Phase 133 D-01/D-02/D-03/D-04 — archive role context menu")` block containing 11 tests. Uses `vi.spyOn(window, "confirm")` with `.mockReturnValue` / `.mockReturnValueOnce` for per-call control, and a shared `renderModalAndGetRow()` helper that returns the first role row.

## Test Results

`npx vitest run src/ui/features/pretty-view/RolesListModal.test.tsx --reporter=verbose` — **26/26 green** (11 new + 15 pre-existing), 3.54s.

| # | Phase 133 test | Result |
| - | -------------- | ------ |
| 1 | renders Archive item on right-click (danger `#ff9a8a` color pinned) | PASS |
| 2 | right-click does NOT open role modal (onSelectRole not called) | PASS |
| 3 | cascade preview N=0 → `archive role Role A? no identities hold it.` | PASS |
| 4 | cascade preview N=1 → first confirm lists identity's `task` | PASS |
| 5 | cascade preview N=3 → `task \|\| displayName` fallback works for null AND empty string; off-role and off-host identities filtered out | PASS |
| 6 | cancel first confirm → 1 confirm call, 0 API calls | PASS |
| 7 | cancel second confirm → 2 confirm calls, 0 API calls | PASS |
| 8 | both confirms → `archiveRole(2, "role-a")` called exactly once | PASS |
| 9 | second confirm copy pinned byte-for-byte: `"are you sure? this can't be undone."` | PASS |
| 10 | archiveRole rejection → `console.warn({ operation: "role_archive_failed", hostId, roleName, errMessage })` | PASS |
| 11 | modal stays open after Archive (onOpenChange NOT called with false) | PASS |

Pre-existing Phase 90 tests A-P (15) unchanged and still green.

## Done-Criteria Verification

- [x] `npx vitest run src/ui/features/pretty-view/RolesListModal.test.tsx` — all 26 tests green.
- [x] Test count grew by 11 (15 → 26). Verified with `--reporter=verbose`.
- [x] `grep -c 'archiveRole' RolesListModal.tsx` → **2** (import + call inside handler).
- [x] `grep -c 'onContextMenu' RolesListModal.tsx` → **6** (imports + prop + surrounding comments).
- [x] `grep -c 'PrettyConversationContextMenu' RolesListModal.tsx` → **5** (import + type import + mount + comments).
- [x] `grep -c 'useIdentities' RolesListModal.tsx` → **5** (import + hook call + comments).
- [x] Exact string `are you sure? this can't be undone.` appears exactly **1** time in the source file (D-03 sanity-tap copy pinned).
- [x] `npm run build` — exit 0 (frontend tsc + vite build succeeded, artifact list emitted).

## Decisions Made

- **D-01 honored** — single POST, fire-and-forget, cascade fan-out belongs to the supervisor scanner from Plan 133-04.
- **D-02 honored** — affordance lives on the roles-list row via right-click, identical shape to the identity-archive item on `IdentitySessionPane.tsx:218-220`.
- **D-03 honored, byte-locked** — first dialog N=0 says "no identities hold it.", N>0 lists every identity with `• task || displayName` per line; second dialog is byte-identical `are you sure? this can't be undone.`
- **D-04 honored** — frontend-side cascade preview via `useIdentities().filter`; no new RPC.
- **Divergence from identity-archive UX** — RolesListModal stays open after the Archive click. Rationale (from the plan): the roles-list is a "browse-and-act surface"; closing it forces a re-navigate for the next archive gesture. Identity-archive closes its pane because the pane IS the archived thing.

## Deviations from Plan

None — plan executed exactly as written. TDD RED→GREEN with no REFACTOR needed (implementation is a minimal three-atom addition: hook call + state atom + handler; nothing to clean up).

## RESEARCH Assumption A1 — Radix Dialog + PrettyConversationContextMenu coexistence

Status: **Not surfaced in JSDOM tests.** All 11 tests pass without any adapter code (no `stopPropagation` hack on the menu-item onClick; no `onInteractOutside` carve-out for the context-menu portal). Rationale for the clean pass: the `RolesListModal` `DialogPrimitive.Root` is already `modal={false}` at L184, so Radix's outside-click handling is opt-in via `onInteractOutside` — and the existing handler at L197 already calls `e.preventDefault()` unconditionally (Patch #111f pattern), which means Radix will not itself close the dialog when the context menu is clicked outside its `Content` boundary.

**Manual UAT still recommended before shipping**, per the plan's cautionary flag: JSDOM doesn't run the real Radix pointer-capture pipeline, so the definitive answer comes from real browser interaction. If manual UAT surfaces a click swallowed, the fix documented in the plan (option a: `e.stopPropagation()` on the menu-item onClick; option b: `onInteractOutside` ignore-list for `[data-pv-context-menu]`) is a one-line change. Left as a smoke item for the orchestrator's UAT sweep.

## Cascade Preview Wild-Fixture Test (Test 5)

Test 5 verified the plan's D-04 assertion end-to-end with a mixed fixture: 3 role-holding identities (one with `task: "Task A"`, one with `task: null`, one with `task: ""`) plus one off-role identity and one same-role-different-host identity. Assertions:

- `task: null` → falls back to `displayName: "Wren"` ✓
- `task: ""` (empty string, falsy) → falls back to `displayName: "Aqua"` ✓
- `task: "Task A"` → renders literally ✓
- Off-role identity → filtered out ✓
- Same role, wrong hostId → filtered out ✓
- Cascade count in dialog copy: `3 identities holding it` (not 5) — the filter runs before the count ✓

Confirms the `identity.role === roleName && identity.hostId === hostId` predicate + `task || displayName` short-circuit both fire correctly against realistic mixed inputs.

## Mocking Strategy Deviations

None of substance. Notes:

- `@/api/role-archive-api` mocked at module scope via `vi.fn()` closure, mirroring the existing `@/api/identities-api` mock pattern in the same test file.
- `@/state/identities-store` mocked with a mutable module-scoped return object (`useIdentitiesReturn.identities` array reassigned per test), so the mock factory always yields the current state on call. Matches the same "held in module scope" pattern the file already uses for `listRolesForHost`.
- `console.warn` spied with `mockImplementation(() => {})` inside the Phase 133 `beforeEach` so Test 10 can assert on the exact call payload without leaking noise into the test output.

## Modal Stays Open (Test 11)

Confirmed: `onOpenChange` is not invoked with `false` after the Archive click, matching the plan's browse-and-act rationale. Test 11 spies on `onOpenChange` and asserts `expect(onOpenChange).not.toHaveBeenCalledWith(false)` after the full double-confirm-then-fire sequence.

## Known Stubs

None. The full path is wired: right-click → menu → double confirm → real `archiveRole` API call (mocked only inside test isolation). The Plan 133-01 backend route accepts the request; the Plan 133-04 supervisor scanner picks up the sentinel; the cascade executes end-to-end.

## Commits

| Phase | Hash       | Message                                                                    |
| ----- | ---------- | -------------------------------------------------------------------------- |
| RED   | `fafb1d7b` | `test(133-05-1): add failing tests for role-archive context menu`          |
| GREEN | `04f46192` | `feat(133-05-1): wire archive-role context menu into RolesListModal`       |

## TDD Gate Compliance

Task-level TDD executed: RED commit (test-only, 11 failing tests, 15 pre-existing still green) landed at `fafb1d7b` before GREEN commit (implementation, all 26 tests green) at `04f46192`. Gate sequence intact. No REFACTOR commit needed — implementation is a minimal three-atom addition with no cleanup surface.

## Self-Check: PASSED

- [x] `src/ui/features/pretty-view/RolesListModal.tsx` — FOUND (modified, +104 lines)
- [x] `src/ui/features/pretty-view/RolesListModal.test.tsx` — FOUND (modified, +290 lines)
- [x] Commit `fafb1d7b` — FOUND on `feat/tab-title-from-tmux` (`git log --oneline | grep fafb1d7b` → hit)
- [x] Commit `04f46192` — FOUND on `feat/tab-title-from-tmux` (`git log --oneline | grep 04f46192` → hit)
- [x] All 26 tests green under `npx vitest run src/ui/features/pretty-view/RolesListModal.test.tsx`
- [x] `npm run build` exits 0
- [x] All grep done-criteria met (see "Done-Criteria Verification" above)
- [x] Sanity-tap copy pinned exactly once in source
