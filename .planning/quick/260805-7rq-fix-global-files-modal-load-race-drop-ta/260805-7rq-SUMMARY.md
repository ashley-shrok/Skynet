---
phase: quick-260805-7rq
plan: "01"
subsystem: pretty-view / GlobalFilesModal
tags: [bug-fix, tdd, react-hooks, useEffect, race-condition]
dependency_graph:
  requires: []
  provides: [GlobalFilesModal lazy-load no longer cancels its own in-flight read]
  affects: [src/ui/features/pretty-view/GlobalFilesModal.tsx]
tech_stack:
  added: []
  patterns: [intentional stale-closure useEffect, eslint-disable-next-line with WHY comment]
key_files:
  created:
    - src/ui/features/pretty-view/GlobalFilesModal.test.tsx
  modified:
    - src/ui/features/pretty-view/GlobalFilesModal.tsx
decisions:
  - Drop tabData from lazy-load useEffect deps; use eslint-disable-next-line with WHY comment per plan spec
metrics:
  duration: ~12 minutes
  completed: 2026-08-05
---

# Quick 260805-7rq: Fix GlobalFilesModal Load Race (Drop tabData from deps) — Summary

**One-liner:** Dropped `tabData` from the lazy-load `useEffect` deps array in `GlobalFilesModal.tsx` so `setTabData({loading})` no longer triggers a re-run that sets `cancelled = true` on the in-flight `readGlobalFile`, fixing the forever-spinner race exposed by the tilde-expansion commit (5e468c8) that made SSH reads take ~700ms.

---

## Task 1 — Regression Test (RED)

**Commit:** `5c88555` — `test(quick-260805-7rq-01): add regression test for GlobalFilesModal lazy-load race`

**File created:** `src/ui/features/pretty-view/GlobalFilesModal.test.tsx`

**Pre-fix RED result** (test run against unpatched `GlobalFilesModal.tsx` — `tabData` still in deps):

```
× GlobalFilesModal — lazy-load race regression (quick 260805-7rq)
  › renders the READY textarea after an asynchronous readGlobalFile resolves
    (regression: lazy-load useEffect must not cancel its own in-flight read via tabData-in-deps re-run)
    2454ms

  - Expected: true
  + Received: null

   ❯ waitFor.timeout src/ui/features/pretty-view/GlobalFilesModal.test.tsx:102:51
       () => expect(screen.queryByRole("textbox")).toBeTruthy(),
                                                   ^
     { timeout: 2000 },

Test Files  1 failed (1)
     Tests  1 failed (1)
  Duration  6.22s
```

The DOM showed the loading skeleton (three animated `data-slot="skeleton"` divs) still present after the 2000ms ceiling — the textbox never appeared. `queryByRole("textbox") → null` confirms the tab never transitioned from `loading` to `ready`. Race reproduced: the cleanup fired `cancelled = true` before the 50ms `readGlobalFile` mock resolved, so the `.then()` branch was suppressed.

---

## Task 2 — Fix + GREEN

**Commit:** `4a2310e` — `fix(quick-260805-7rq-01): drop tabData from lazy-load useEffect deps to fix modal spinner race`

**File modified:** `src/ui/features/pretty-view/GlobalFilesModal.tsx`

**Change:** Deps array on the lazy-load `useEffect` changed from `[selectedHostId, activeTab, tabData]` to `[selectedHostId, activeTab]`. A WHY comment and `// eslint-disable-next-line react-hooks/exhaustive-deps` were inserted directly above the deps line.

**Post-fix GREEN result:**

```
✓ GlobalFilesModal — lazy-load race regression (quick 260805-7rq)
  › renders the READY textarea after an asynchronous readGlobalFile resolves  636ms

Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  3.66s
```

The textarea rendered with value `"MOCKED FILE CONTENT"` as asserted.

---

## Full Suite Regression Gate

```
Test Files  118 passed (118)
     Tests  1415 passed | 6 skipped (1421)
    Errors  2 errors  (pre-existing EnvironmentTeardownError in IdentityModal.test.tsx — not caused by this change)
  Duration  224.67s
```

Exit code: **0**. Zero test failures. The 2 `EnvironmentTeardownError` entries are pre-existing in `IdentityModal.test.tsx` and were present before this change.

---

## Build Gate

```
npm run build → ✓ built in 4.54s
Exit code: 0
```

---

## Deviations from Plan

**[Rule 1 - Bug] Fixed `toBeInTheDocument` assertion not available in test environment**

- **Found during:** Task 1 first run
- **Issue:** `toBeInTheDocument` is a `@testing-library/jest-dom` matcher not imported in `vitest.setup.ts`. The project uses `.toBeTruthy()` / `.toBeNull()` patterns (see `IdentityModal.test.tsx`).
- **Fix:** Changed `expect(...).toBeInTheDocument()` to `expect(...).toBeTruthy()` in the `waitFor` call, matching the existing test patterns.
- **Files modified:** `src/ui/features/pretty-view/GlobalFilesModal.test.tsx`
- **Impact:** None on test correctness — the assertion still catches the race condition (returns `null` pre-fix, truthy textarea post-fix).

---

## Deploy Status

Deploy NOT run — awaiting Ashley greenlight. No `docker build`, no `docker compose up`, no `git push`. Backend build intentionally skipped (frontend-only change per plan explicit non-goal).
