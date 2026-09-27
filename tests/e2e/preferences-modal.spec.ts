/**
 * Preferences modal smoke spec (Phase 137).
 *
 * Covers: open via gear button → navigate all four panes (General, Voice,
 * Notifications, About you) → close via Escape. Smoke only — does NOT test
 * avatar upload, voice picker autosave, notification permission-request, or
 * the About-you save flow (those are unit-test-covered in Plans 02-05 and are
 * fragile at the browser layer).
 *
 * Per D-04: backdrop-click does NOT close the modal; that non-behavior is
 * intentional and is NOT tested here (asserting a non-behavior in Playwright
 * is brittle).
 *
 * Note: spec lives in tests/e2e/ (the actual Playwright testDir per
 * playwright.config.ts). The plan listed tests/playwright/ which does not
 * exist in this project — path adjusted accordingly (Phase 137 D-32 cleanup
 * deviation, no functional change).
 */
import { test, expect } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";

test.use({ trace: "retain-on-failure" });

test.describe("Preferences modal (Phase 137 smoke)", () => {
  test.beforeEach(async ({ browser, page }) => {
    // Re-use seedFullAuth so both the session cookie AND localStorage["skynet_auth"]
    // are seeded before the page navigates — same pattern as feature-sweep.spec.ts.
    const context = page.context();
    await seedFullAuth(context, BASE_URL, readCreds());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for the shell to hydrate — the gear button appears only after login.
    await expect(
      page.locator('[data-testid="pv-footer-preferences-button"]'),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("opens preferences modal from gear button", async ({ page }) => {
    await page.locator('[data-testid="pv-footer-preferences-button"]').click();
    await expect(
      page.locator('[data-testid="preferences-modal"]'),
    ).toBeVisible();
  });

  test("navigates through all four panes", async ({ page }) => {
    // Open modal
    await page.locator('[data-testid="pv-footer-preferences-button"]').click();
    await expect(
      page.locator('[data-testid="preferences-modal"]'),
    ).toBeVisible();

    // General pane — default active; avatar circle should be visible
    await page.locator('[data-testid="preferences-nav-general"]').click();
    await expect(
      page.locator('[data-testid="preferences-general-pane"]'),
    ).toBeVisible();

    // Voice pane — voice picker container should be visible
    await page.locator('[data-testid="preferences-nav-voice"]').click();
    await expect(
      page.locator('[data-testid="preferences-voice-pane"]'),
    ).toBeVisible();

    // Notifications pane — either the unsupported message or the enable button
    await page.locator('[data-testid="preferences-nav-notifications"]').click();
    const notifUnsupported = page.locator(
      '[data-testid="preferences-notifications-unsupported"]',
    );
    const notifEnableBtn = page.locator(
      '[data-testid="enable-notifications-button"]',
    );
    await expect(notifUnsupported.or(notifEnableBtn)).toBeVisible();

    // About you pane — blurb text (D-22 verbatim)
    await page.locator('[data-testid="preferences-nav-about-you"]').click();
    await expect(
      page.getByText("Tell your agents anything you want them to know about you"),
    ).toBeVisible();
  });

  test("closes on Escape", async ({ page }) => {
    // Open modal
    await page.locator('[data-testid="pv-footer-preferences-button"]').click();
    await expect(
      page.locator('[data-testid="preferences-modal"]'),
    ).toBeVisible();

    // Press Escape
    await page.keyboard.press("Escape");

    // Modal should be hidden
    await expect(
      page.locator('[data-testid="preferences-modal"]'),
    ).toBeHidden();
  });
});
