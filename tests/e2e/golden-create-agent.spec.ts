/**
 * Golden-path E2E — create a new agent from the shell.
 *
 * Flow: seedFullAuth → shell paints → click pv-header-new-agent-button →
 *   the sidebar NewSessionDialog opens → pick a host → fill session name →
 *   click Create → assert a new conversation row appears with that name.
 *
 * quick-260914-liu: "New agent" is now a dedicated header icon button
 * (pv-header-new-agent-button); no kebab open needed.
 *
 * Requires: the test user has at least one host they can select. Skips
 * gracefully if the shell state doesn't offer the host picker.
 *
 * Selector strategy: prefer accessible-name + role first, testid second,
 * placeholder third. If UI changes and selectors drift, tune here — the
 * shape (button → dialog → pick → fill → create → assert) IS the golden path.
 */
import { test, expect } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";

test.use({ trace: "retain-on-failure" });

test("golden: create a new agent — New agent header button → pick host → name → Create", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();
  await page.waitForTimeout(2500);

  // 1. Click the dedicated New agent header icon button (quick-260914-liu).
  const newAgentBtn = page.locator('[data-testid="pv-header-new-agent-button"]');
  await expect(newAgentBtn).toBeVisible({ timeout: 10_000 });
  await newAgentBtn.click();

  // 2. The sidebar NewSessionDialog opens. Wait for the modal shell.
  const dialogTitle = page.getByRole("heading", { name: /new agent/i });
  await expect(dialogTitle).toBeVisible({ timeout: 8_000 });

  // 3. Pick a host — the dialog has a searchable host list. Find and click
  //    the first host row. If the test user has no hosts, skip.
  //    Host rows have role=option or role=button; the search input is
  //    labeled with a placeholder like "Search hosts…".
  //    Exclude all header/footer icon buttons from the candidate list so
  //    the host-picker click cannot land on one. Globe migrated to the
  //    sidebar footer in shape-sidebar-header-footer-redesign; the
  //    pv-footer-global-files-button test-id is included here too.
  const hostCandidates = page
    .locator('[role="option"], [role="button"][data-host-id], button[data-host-id]')
    .filter({ hasNot: page.locator('[data-testid="pv-header-menu-button"], [data-testid="pv-header-new-agent-button"], [data-testid="pv-header-edit-roles-button"], [data-testid="pv-footer-global-files-button"]') });

  const hostCount = await hostCandidates.count();
  test.skip(
    hostCount === 0,
    "test user has no hosts — seed at least one before running the create-agent golden path",
  );

  await hostCandidates.first().click();
  await page.waitForTimeout(500);

  // 5. Session name — the sidebar dialog uses an input near a label like
  //    "Session name" or a similar placeholder. Use accessible-name first.
  const sessionInput =
    (await page.getByLabel(/session name|agent name|task/i).count()) > 0
      ? page.getByLabel(/session name|agent name|task/i).first()
      : page.locator('input[type="text"]').last();

  await expect(sessionInput).toBeVisible({ timeout: 5_000 });
  const sessionName = `e2e-agent-${Date.now()}`;
  await sessionInput.fill(sessionName);

  // 6. Click Create (or Start — legacy i18n fallback).
  const createBtn = page.getByRole("button", { name: /^create$|^start$/i }).first();
  await expect(createBtn).toBeEnabled({ timeout: 5_000 });
  await createBtn.click();

  // 7. The dialog closes and a new conversation row containing the name
  //    should appear in the sidebar. Give it a generous timeout — the
  //    backend needs to spin up the tmux session.
  const newRow = page.getByText(new RegExp(sessionName, "i")).first();
  await expect(newRow).toBeVisible({ timeout: 30_000 });

  await context.close();
});
