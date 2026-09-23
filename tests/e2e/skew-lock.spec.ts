/**
 * Phase 111 SKEW-15: version-drift hard-lock end-to-end drift-smoke.
 *
 * Deploy-time gate for the phase's headline behavioral assertion: prove
 * from a real browser that a mid-session server-tag mismatch fires the
 * skew-lock modal, and that clicking Reload recovers the tab onto the
 * current version.
 *
 * Scope: written per RESEARCH.md § Q10 template, adapted to the modal
 * shape landed in Plan 111-02 (SkewLockModal at src/ui/features/skew-lock/
 * with `role="dialog"` + `aria-labelledby="skynet-skew-lock-title"` + title
 * text "A newer version is available" in normal mode).
 *
 * Execution boundary: this spec is orchestrator-owned. Per Rio's role file,
 * Playwright specs run as deploy-time gates against a live deploy — NOT
 * during executor-scope work. The executor's verification is limited to
 * `npx playwright test --list <spec>` (parse-only). The orchestrator runs
 * the spec after a successful `docker compose up --force-recreate` with
 * PLAYWRIGHT_BASE_URL pointing at the deploy under test.
 *
 * Simulation strategy: page.route interposes on responses from the Skynet
 * backend and rewrites the `x-skynet-server-build` header to a
 * deliberately-mismatched value, simulating a mid-session deploy where the
 * server jumped versions while the tab was open. The axios response
 * interceptor at src/ui/main-axios.ts:536 detects the mismatch and calls
 * lockSkewedSession(), which the SkewLockModal renders in response.
 *
 * Reload-loop guardrail: this spec triggers the lock ONCE per test run.
 * The sessionStorage reload-count sentinel (RESEARCH.md § Pitfall 4)
 * activates the fatal-mode variant after >3 attempts within 60s — safely
 * under the threshold. If a future revision of this spec triggers the lock
 * multiple times, clear sessionStorage["skynet_skew_reload_count"] between
 * assertions or the second run will render the no-Reload-button fatal
 * modal instead of the normal one.
 */

import { test, expect } from "@playwright/test";
import { loginViaUI, readCreds } from "./helpers/auth";

test.describe("Phase 111 SKEW-15: version-drift hard-lock end-to-end", () => {
  test("modal activates on server-tag mismatch and reload recovers", async ({
    page,
  }) => {
    // 1. Auth. Existing helper reads creds from SKYNET_TEST_CREDS env.
    await loginViaUI(page, readCreds());
    await expect(page).not.toHaveURL(/\/login/);

    // 2. Interpose on backend responses. `**/host/**` matches the primary
    //    axios lane the post-login shell polls (hostApi at
    //    main-axios.ts:952 uses base `/host`, plus authApi calls prefixed
    //    with `/host/`). Any successful response from these routes will be
    //    rewritten with a mismatched build header, driving the axios
    //    response interceptor at main-axios.ts:536 into the mismatch
    //    branch → lockSkewedSession → modal renders.
    await page.route("**/host/**", async (route) => {
      const response = await route.fetch();
      const headers = {
        ...response.headers(),
        "x-skynet-server-build": "totally-different-build-id",
      };
      await route.fulfill({ response, headers });
    });

    // 3. Trigger a request. The post-login shell already fires host-status
    //    polls periodically; a page.reload() also re-fetches the host list
    //    from a fresh top-level navigation, guaranteeing at least one
    //    `/host/*` request hits the interposer. The `.catch(() => {})`
    //    swallows any transient navigation error — the reload MAY not
    //    strictly succeed if the network is briefly weird, and we care
    //    about the modal state, not the reload's own success.
    await page.reload().catch(() => {});

    // 4. Assert the skew-lock modal renders. Locator matches the modal's
    //    accessible name (via aria-labelledby → "A newer version is
    //    available" heading in normal mode, per SkewLockModal.tsx:108).
    //    5s timeout accommodates the axios request round-trip + React
    //    render cycle; typical activation is <500ms.
    const modal = page.getByRole("dialog", { name: /newer version/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 5. Restore the route so the reload's fresh top-level navigation
    //    sees a real (non-injected) response from the server. Without
    //    unroute, the reload's own /host/* requests would still be
    //    rewritten → modal would re-fire after reload → false negative.
    await page.unroute("**/host/**");

    // 6. Click Reload. Playwright treats window.location.reload() as a
    //    real navigation, so the click at SkewLockModal.tsx:124 triggers
    //    a full page reload. The sessionStorage reload-count sentinel
    //    increments (per reload-loop-sentinel.ts) — this spec is the
    //    first activation in the test-context session so the count goes
    //    from 0 → 1, well under the >3-within-60s fatal threshold.
    await modal.getByRole("button", { name: /reload/i }).click();
    await page.waitForLoadState("networkidle");

    // 7. Post-reload, the modal must be gone: the fresh page has no
    //    locked state, and the (now un-intercepted) /host/* requests
    //    return the real server build, matching the freshly-baked
    //    client build. If the modal is STILL visible here, either the
    //    lock leaked across the reload (a bug — sessionStorage-based
    //    state should NOT persist locked-ness) OR our unroute at
    //    step 5 didn't take effect.
    await expect(modal).not.toBeVisible();
  });
});
