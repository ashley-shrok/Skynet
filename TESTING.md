# Testing

Skynet uses two test layers, both invoked locally on the deploying box:

- **Unit + component (vitest + Testing Library).** Runs via `npm test`
  or `npx vitest run`. Scoped runs during dev
  (`npx vitest run <changed-files-or-dir>`); full-suite runs as a
  per-deployment gate immediately before `docker build`.

- **End-to-end (Playwright).** Runs via `npx playwright test`.
  `tests/e2e/smoke.spec.ts` is the pre-deploy smoke gate (login,
  conversation panel renders, no console errors). Other specs cover
  perf profiling and ad-hoc feature testing.

**Playwright first-time setup:**

    npx playwright install chromium

**Running the pre-deploy gate manually** (from a clean tree):

    export SKYNET_TEST_CREDS="<username>:<password>"
    npx vitest run
    npx playwright test tests/e2e/smoke.spec.ts --project=chromium

There is no CI test step — `.github/workflows/pr-check.yml` is dormant.
The deploying identity's local machine is the gate.
