/**
 * Feature-sweep spec (2026-09-08) — mechanically exercises the visible UI
 * surfaces for throwaway-tina and screenshots each step. Not asserting
 * correctness; the point is to surface anything weird (visible errors,
 * layout breakage, slow responses) via the screenshots + console logs.
 *
 * Findings land in the bounty `frontend-testing-pattern/feature-sweep-findings.md`.
 */
import { test } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";

const OUT = path.resolve(
  process.env.HOME ?? "",
  ".claude/roles/box-maintainer/bounties/frontend-testing-pattern/feature-sweep-screenshots",
);

test.use({ trace: "off" });

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test("feature sweep — exercise every visible affordance for a fresh user", async ({ browser }) => {
  const consoleErrors: string[] = [];
  const context = await browser.newContext(process.env.MOBILE ? {} : { viewport: { width: 1440, height: 900 } });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text().slice(0, 200)}`);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, "01-shell.png") });
  console.log("[sweep] 01 shell painted");

  // 1. Toggle sidebar
  await page.getByLabel(/toggle sidebar/i).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "02-sidebar-collapsed.png") });
  await page.getByLabel(/toggle sidebar/i).click().catch(() => {});
  await page.waitForTimeout(500);
  console.log("[sweep] 02 sidebar toggle → collapsed → restored");

  // 2. Filter conversations
  await page.getByLabel(/filter conversations/i).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-filter-open.png") });
  // Close filter (click elsewhere)
  await page.mouse.click(1300, 500);
  await page.waitForTimeout(300);

  // 3. Search conversations — type and clear
  const search = page.getByPlaceholder(/search conversations/i);
  await search.fill("nonexistent");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "04-search-empty-results.png") });
  await search.fill("");

  // 4. More actions menu
  await page.locator('[data-testid="pv-header-menu-button"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "05-more-actions-menu.png") });

  // 5. New role dialog (probably empty since throwaway has no host with roles)
  const newRole = page.getByRole("menuitem", { name: /new role/i });
  if (await newRole.isVisible().catch(() => false)) {
    await newRole.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, "06-new-role-dialog.png") });
    // Close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // 6. Reopen menu, edit skills
  await page.locator('[data-testid="pv-header-menu-button"]').click();
  await page.waitForTimeout(400);
  const editSkills = page.getByRole("menuitem", { name: /edit skills/i });
  if (await editSkills.isVisible().catch(() => false)) {
    await editSkills.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "07-edit-skills.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // 7. Edit global files
  await page.locator('[data-testid="pv-header-menu-button"]').click();
  await page.waitForTimeout(400);
  const editGlobal = page.getByRole("menuitem", { name: /edit global files/i });
  if (await editGlobal.isVisible().catch(() => false)) {
    await editGlobal.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "08-edit-global-files.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  console.log("[sweep] console errors caught:", JSON.stringify(consoleErrors, null, 2));
  fs.writeFileSync(path.join(OUT, "console-errors.log"), consoleErrors.join("\n"));
  await context.close();
});
