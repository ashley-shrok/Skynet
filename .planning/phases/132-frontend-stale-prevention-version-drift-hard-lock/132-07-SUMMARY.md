---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 07
subsystem: frontend-stale-prevention
tags:
  - skew-lock
  - cache-control
  - codification
  - assertion-test
  - playwright
  - drift-smoke
dependency_graph:
  requires:
    - 132-01
    - 132-02
    - 132-03
    - 132-04
    - 132-05
    - 132-06
  provides:
    - "Codified load-bearing no-store enforcement at 3 layers (2 nginx + 2 Express setHeader sites)"
    - "Vitest assertion guarding all 3 enforcement layers + phase-marker comments (5 tests)"
    - "Playwright drift-smoke spec (Phase 132 end-to-end behavioral gate) — orchestrator-executable"
  affects:
    - docker/nginx.conf
    - docker/nginx-https.conf
    - src/backend/database/database.ts
    - src/backend/database/cache-headers.test.ts
    - tests/e2e/skew-lock.spec.ts
tech_stack:
  added: []
  patterns:
    - "fs.readFileSync + path.resolve for source-file assertion tests (fileURLToPath ESM idiom)"
    - "page.route header-rewrite interposer for mid-session drift simulation"
key_files:
  created:
    - src/backend/database/cache-headers.test.ts
    - tests/e2e/skew-lock.spec.ts
  modified:
    - docker/nginx.conf
    - docker/nginx-https.conf
    - src/backend/database/database.ts
decisions:
  - "Used fileURLToPath(import.meta.url) for ESM __dirname equivalent in the assertion vitest (per existing precedent in claude-session-server.contextpct-dual-write.test.ts and dormant-tail.test.ts) — avoids CJS/ESM polyfill fragility across vitest versions."
  - "Added a fifth codification test (Phase-marker presence) beyond the plan's four behaviors — Rule 2 (auto-add missing critical functionality) since the plan's <behavior> block covered enforcement-substring presence but omitted the cross-reference-comment presence check. A future refactor stripping the load-bearing comments without stripping the enforcement would silently pass the four original tests; the fifth catches drift-of-intent."
  - "Playwright spec matches only **/host/** for the header-rewrite interposer per RESEARCH.md § Q10 template. Broader wildcards (`**/*`) risk rewriting the top-level HTML response and blocking the reload's own recovery; the narrow filter keeps the recovery path clean."
metrics:
  duration_seconds: 387
  completed: 2026-09-21
  tasks_completed: 3
  files_touched: 5
---

# Phase 132 Plan 07: Cache-Control codification + drift-smoke spec Summary

Codified the three-layer `Cache-Control: no-store` discipline on `index.html`
(nginx.conf + nginx-https.conf + database.ts's two SPA-fallback setHeader
sites) with cross-reference comments citing Phase 132 SKEW-14, added a vitest
that guards all three layers against future deletion, and wrote the phase's
headline end-to-end playwright drift-smoke spec (orchestrator-executable, not
run during executor scope per Rio's role file).

## What Shipped

### Task 1 — Cross-reference comments on the 3 no-store enforcement layers
**Commit:** `cc77ee47` — `docs(132-07): codify Phase 132 SKEW-14 load-bearing no-store on index.html`

Three surgical comment insertions, zero behavior change:

- **`docker/nginx.conf`** — comment above the `location /` block (L131-140)
  explains the load-bearing property of the existing `add_header Cache-Control
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;`
  at L138. References D-13 (reload-recovery gesture) and Pitfall 2 (nginx-parity).
- **`docker/nginx-https.conf`** — identical comment above the mirror block at
  L142-151. The nginx-parity rule (Pitfall 2) requires the same block in both
  configs; the comment cross-references its sibling.
- **`src/backend/database/database.ts`** — comment above both `setHeader(
  "Cache-Control", "no-store, ...")` sites in the SPA fallback:
  - Site 1: the `setHeaders` callback in `express.static(frontendDist, ...)`
    that runs when `index.html` / `sw.js` / `manifest.json` are served
    statically (currently at ~L2078-2081).
  - Site 2: the `getBrandedIndexHtml` SPA-fallback middleware that overrides
    for GET requests accepting HTML (currently at ~L2094-2098).

Verified:
- `grep -c "Phase 132 SKEW-14"` returns 1 for each nginx config and 2 for
  `database.ts`.
- The `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` block
  is still present in all three files.

### Task 2 — Assertion vitest guarding the discipline
**Commit:** `c4f8241b` — `test(132-07): assert Phase 132 SKEW-14 no-store enforcement layers persist`

New test at `src/backend/database/cache-headers.test.ts` reads the three
source files via `fs.readFileSync` (with `fileURLToPath(import.meta.url)` for
the ESM `__dirname` equivalent, anchored to `REPO_ROOT` three hops up from
the test file). Five behaviors covered:

1. `docker/nginx.conf` contains the no-store block.
2. `docker/nginx-https.conf` contains the no-store block.
3. `database.ts` contains ≥ 2 occurrences of the no-store block (the two SPA
   fallback setHeader sites).
4. Nginx-parity: both configs contain the block (Pitfall 2 assertion).
5. Codification: all three layers carry the `Phase 132 SKEW-14` cross-reference
   comment. Extra behavior beyond the plan's original four — see § Deviations.

Verified:
- `npx vitest related src/backend/database/cache-headers.test.ts --run` → 5/5
  passed in 248ms.
- `npx tsc --noEmit` → clean.
- `npm run build:backend && npm run build` → both green (touched
  `src/backend/`).

### Task 3 — Playwright drift-smoke spec
**Commit:** `95814fe6` — `test(132-07): playwright drift-smoke spec for Phase 132 SKEW-15 end-to-end`

New spec at `tests/e2e/skew-lock.spec.ts` captures the phase's headline
behavioral assertion. Uses `page.route` to interpose on `**/host/**` responses
and rewrite the `x-skynet-server-build` header to `"totally-different-build-id"`,
simulating a mid-session deploy. Asserts:

- The modal renders with `role="dialog"` + accessible name matching
  `/newer version/i` (matches the SkewLockModal aria-labelledby heading
  "A newer version is available" from Plan 132-02).
- The Reload button click triggers `window.location.reload()`.
- Post-reload, the modal is not visible (fresh page has no locked state).

Uses existing `tests/e2e/helpers/auth.ts` for `loginViaUI(page, readCreds())`
— same idiom as the 8-line `smoke.spec.ts` baseline.

**Execution boundary:** Per Rio's role file, playwright specs are
orchestrator-owned deploy-time gates. Executor's verification is limited to
parse-check via `npx playwright test --list`. NOT executed during this task.

Verified:
- `npx playwright test --list tests/e2e/skew-lock.spec.ts` → lists 2 tests
  (chromium + mobile-iphone projects) with no syntax errors.
- `npx tsc --noEmit` → clean.

## Commits

| Task | Type | Hash       | Message                                                              |
| ---- | ---- | ---------- | -------------------------------------------------------------------- |
| 1    | docs | `cc77ee47` | codify Phase 132 SKEW-14 load-bearing no-store on index.html         |
| 2    | test | `c4f8241b` | assert Phase 132 SKEW-14 no-store enforcement layers persist         |
| 3    | test | `95814fe6` | playwright drift-smoke spec for Phase 132 SKEW-15 end-to-end         |

## Deviations from Plan

### Added Functionality (Rule 2 — auto-add missing critical functionality)

**1. [Rule 2 - Test coverage] Fifth codification test in the assertion vitest**
- **Found during:** Task 2 authoring
- **Issue:** The plan's `<behavior>` block for Task 2 listed four tests, all
  focused on presence of the no-store enforcement string. A future refactor
  that deleted the Phase 132 cross-reference comments (Task 1's output) but
  left the enforcement intact would silently pass the four behaviors — losing
  the codification-of-intent that is the whole point of Task 1's comments.
- **Fix:** Added a fifth `test("codification: ...")` that asserts each of the
  three source files contains the `"Phase 132 SKEW-14"` marker at least once
  (twice for `database.ts`). Guards drift-of-intent even when the mechanism
  is intact.
- **Files modified:** `src/backend/database/cache-headers.test.ts` (test file
  itself; the codification test was added at authoring time, not as a
  follow-up)
- **Commit:** `c4f8241b`

### Line-number drift from plan

The plan referenced `database.ts` setHeader sites at "~L2041 and ~L2058"; the
actual file has them at L2076 and L2092 as of `HEAD~3`. Not a real deviation
— the plan's `<read_first>` block warned this could happen, and the acceptance
criterion is by grep-count, not line number. Comments were placed above the
actual setHeader sites regardless of the drifted line numbers.

## Threat Flags

None. This plan introduces zero new network endpoints, auth paths, file
access patterns, or trust-boundary crossings. The three modified files' new
comments are inert; the two new test files are test-scope only (never bundled
into runtime).

## Self-Check: PASSED

Files created:
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/database/cache-headers.test.ts` — FOUND
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/tests/e2e/skew-lock.spec.ts` — FOUND

Files modified:
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/nginx.conf` — FOUND (grep confirms SKEW-14 marker)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/nginx-https.conf` — FOUND (grep confirms SKEW-14 marker)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/database/database.ts` — FOUND (grep confirms 2 SKEW-14 markers)

Commits:
- `cc77ee47` — FOUND in `git log --oneline`
- `c4f8241b` — FOUND in `git log --oneline`
- `95814fe6` — FOUND in `git log --oneline`

Test results:
- Task 2 vitest: 5/5 passed (`npx vitest related src/backend/database/cache-headers.test.ts --run`)
- Task 3 playwright: 2 tests listed (`npx playwright test --list tests/e2e/skew-lock.spec.ts`)
- Backend build: clean (`npm run build:backend`)
- Frontend build: clean (`npm run build`)
- `npx tsc --noEmit`: clean

All success criteria met per plan's `<success_criteria>` block: the three
no-store enforcement layers are documented as load-bearing; a future refactor
that deletes any of them gets a red vitest; the end-to-end drift-and-recover
behavior is captured in a repeatable playwright spec the orchestrator uses
as a ship-time gate.
