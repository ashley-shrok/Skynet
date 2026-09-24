---
phase: 133
plan: 02
subsystem: frontend
tags: [api-wrapper, archive, role, tdd]
status: PASS
dependency_graph:
  requires:
    - "@/main-axios (authApi.post, handleApiError)"
    - "Backend route POST /roles/:name/archive (landed in 133-01)"
  provides:
    - "archiveRole(hostId, roleName) → Promise<{ ok: true }>"
  affects:
    - "Wave D RolesListModal integration will import this wrapper"
tech_stack:
  added: []
  patterns:
    - "Thin authApi wrapper (mirrors identity-archive-api.ts byte-for-byte)"
    - "handleApiError for uniform error surfacing"
    - "encodeURIComponent on path segment (defense-in-depth)"
    - "vi.mock('@/main-axios', ...) at module level for isolated unit tests"
key_files:
  created:
    - "src/ui/api/role-archive-api.ts (34 lines)"
    - "src/ui/api/role-archive-api.test.ts (113 lines)"
  modified: []
decisions:
  - "D-01 honored: single call, no fan-out from frontend"
  - "D-19 honored: no unarchive companion; one-way archival"
metrics:
  duration_minutes: 3
  tasks_completed: 1
  tests_added: 5
  files_created: 2
  completed_date: "2026-09-24"
---

# Phase 133 Plan 133-02: Frontend `archiveRole` API Wrapper Summary

One-liner: `archiveRole(hostId, roleName)` thin authApi.post wrapper for `POST /roles/:name/archive`, a byte-shape clone of `archiveIdentity` with the identity → role concept substitution.

## What Landed

Two new files under `src/ui/api/`:

1. **`role-archive-api.ts`** (34 lines) — exports one function, `archiveRole(hostId: number, roleName: string): Promise<{ ok: true }>`. Direct clone of `identity-archive-api.ts` (32 lines) with:
   - endpoint path: `/identities/:key/archive` → `/roles/:name/archive`
   - parameter names: `identityKey` → `roleName`
   - operation label: `"archive identity"` → `"archive role"`
   - docstring header rewritten to reference Phase 133 D-01 (single sentinel drop, no fan-out) and D-19 (one-way, no un-archive companion by design)
   - function body: identical shape — `try { authApi.post(url, { hostId }) } catch { handleApiError(error, "archive role") }`
   - `encodeURIComponent(roleName)` applied at the call site (mirrors sibling's defense-in-depth discipline)

2. **`role-archive-api.test.ts`** (113 lines) — vitest coverage, 5 tests, all green. Mirrors `identity-archive-api.test.ts` structure verbatim: module-level `vi.mock("@/main-axios", …)` with `handleApiError` stub that rethrows `${op}: ${msg}`; `beforeEach(() => vi.mocked(authApi.post).mockReset())`; `afterEach(() => vi.clearAllMocks())`.

## Line-Count Comparison (Clone Fidelity)

| File                        | Lines |
| --------------------------- | ----- |
| `identity-archive-api.ts`   | 32    |
| `role-archive-api.ts`       | 34    |

Δ = +2 lines, entirely in the docstring header (Phase 133 references D-01 + D-19 explicitly; the sibling references D-07 / D-08 / D-17 + D-05, marginally shorter). Function body identical shape. No deviations from the template beyond the mechanical concept substitution.

## Test Results

`npx vitest related --run src/ui/api/role-archive-api.test.ts` — all 5 tests green (Duration 1.73s):

| # | Test                                                                                                 | Result |
| - | ---------------------------------------------------------------------------------------------------- | ------ |
| 1 | happy path: `archiveRole(42, 'box-maintainer')` POSTs `/roles/box-maintainer/archive` body `{hostId: 42}`, returns `{ok:true}` | PASS |
| 2 | 400 rejection: propagates through `handleApiError` and throws with `/archive role/i`                 | PASS   |
| 3 | 404 rejection: propagates through `handleApiError` and throws with `/archive role/i`                 | PASS   |
| 4 | 500 rejection: propagates through `handleApiError` and throws with `/archive role/i`                 | PASS   |
| 5 | URL encoding: `archiveRole(1, 'a b')` → URL is `/roles/a%20b/archive` (`encodeURIComponent` locked in) | PASS |

## Done-Criteria Verification

- [x] `src/ui/api/role-archive-api.ts` exports `archiveRole(hostId, roleName)`
- [x] `npx vitest run src/ui/api/role-archive-api.test.ts` — all 5 tests green
- [x] `grep -c 'archiveRole' role-archive-api.ts` → 2 hits; `grep -c 'archiveIdentity' role-archive-api.ts` → 0 hits (no accidental copy)
- [x] `grep -c 'unarchive\|batchArchive' role-archive-api.ts` → 0 hits (no un-archive or batch helper accidentally added; D-19 honored)
- [x] Pre-commit typecheck passes: `npm run build` exits 0 (frontend tsc + vite build succeeded, artifact list emitted)

## Decisions Made

- **D-01 honored** — one function, one call, no fan-out; no batch shape.
- **D-19 honored** — no `unarchiveRole` companion, no restore surface.
- Function signature matches the plan's `must_haves.truths` verbatim: `archiveRole(hostId: number, roleName: string): Promise<{ ok: true }>`.
- URL-encoding applied at call site (D-04 defense-in-depth, mirrors `archiveIdentity(identityKey)` discipline).

## Deviations from Plan

None — plan executed exactly as written. Task 1 followed TDD (RED commit → GREEN commit; no REFACTOR needed because the file is already a minimal clone with no cleanup surface).

## Known Stubs

None. `archiveRole` is fully wired to the real `authApi.post` in production paths; only the test mocks `@/main-axios` per sibling convention.

## Commits

| Phase | Hash       | Message                                                             |
| ----- | ---------- | ------------------------------------------------------------------- |
| RED   | `da2b94de` | `test(133-02-1): add failing tests for archiveRole API wrapper`     |
| GREEN | `dd3982ae` | `feat(133-02-1): implement archiveRole API wrapper`                 |

## TDD Gate Compliance

Task-level TDD executed: RED commit (test-only, failing) landed at `da2b94de` before GREEN commit (implementation, passing) at `dd3982ae`. Gate sequence intact.

## Self-Check: PASSED

- [x] `src/ui/api/role-archive-api.ts` — FOUND (34 lines)
- [x] `src/ui/api/role-archive-api.test.ts` — FOUND (113 lines)
- [x] Commit `da2b94de` — FOUND on `feat/tab-title-from-tmux`
- [x] Commit `dd3982ae` — FOUND on `feat/tab-title-from-tmux`
- [x] All 5 tests green under `npx vitest related --run src/ui/api/role-archive-api.test.ts`
- [x] `npm run build` exits 0
