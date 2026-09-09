/**
 * Golden-path E2E — create a new agent from the shell.
 *
 * Flow: seedFullAuth → shell paints → open kebab menu → click "New agent" →
 *   the sidebar NewSessionDialog opens → pick a host → fill session name →
 *   click Create → assert a new conversation row appears with that name.
 *
 * Requires: the test user has at least one host they can select. Skips
 * gracefully if the shell state doesn't offer the host picker.
 *
 * Selector strategy: prefer accessible-name + role first, testid second,
 * placeholder third. If UI changes and selectors drift, tune here — the
 * shape (menu → dialog → pick → fill → create → assert) IS the golden path.
 */
import { test, expect } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://term.gigaashley.click";

test.use({ trace: "retain-on-failure" });

test("golden: create a new agent — kebab → New agent → pick host → name → Create", async ({
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

  // 1. Open the kebab menu in the pretty-view header.
  const kebab = page.locator('[data-testid="pv-header-menu-button"]');
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  // 2. Click the "New agent" menu item — the order-locked first entry per
  //    PrettyConversationsPanel.tsx:2036 ("KEEP ORDER: New agent → New role
  //    → Edit global files… → Edit skills…").
  const newAgentItem = page.getByText(/^new agent$/i).first();
  await expect(newAgentItem).toBeVisible({ timeout: 5_000 });
  await newAgentItem.click();

  // 3. The sidebar NewSessionDialog opens. Wait for the modal shell.
  const dialogTitle = page.getByRole("heading", { name: /new agent/i });
  await expect(dialogTitle).toBeVisible({ timeout: 8_000 });

  // 4. Pick a host — the dialog has a searchable host list. Find and click
  //    the first host row. If the test user has no hosts, skip.
  //    Host rows have role=option or role=button; the search input is
  //    labeled with a placeholder like "Search hosts…".
  const hostCandidates = page
    .locator('[role="option"], [role="button"][data-host-id], button[data-host-id]')
    .filter({ hasNot: page.locator('[data-testid="pv-header-menu-button"]') });

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
