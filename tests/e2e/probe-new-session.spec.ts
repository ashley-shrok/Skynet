import { test } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.gigaashley.click";

test.use({ trace: "off" });

test("probe: More actions → New agent → pick host → measure open", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "test-results/probe-ns-01-shell.png" });

  console.log("[1] shell loaded, clicking More actions");
  const moreActions = page.locator('[data-testid="pv-header-menu-button"]');
  await moreActions.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/probe-ns-02-menu-open.png" });

  // Log what the menu shows
  const menuContent = await page.evaluate(() => {
    const items: string[] = [];
    document.querySelectorAll("[role='menuitem'], button, [role='dialog'] button").forEach((el) => {
      const t = (el.textContent || "").trim().slice(0, 60);
      const label = el.getAttribute("aria-label") || "";
      if (t || label) items.push(`${el.tagName}[${el.getAttribute("role") || ""}] "${t}" aria=${label}`);
    });
    return items.slice(0, 30);
  });
  console.log("[2] menu items after More Actions click:", menuContent);

  // Try to click New agent (or similar)
  const newAgent = page.getByText(/new agent/i).first();
  const newAgentVisible = await newAgent.isVisible().catch(() => false);
  console.log("[3] New agent visible?", newAgentVisible);
  if (newAgentVisible) {
    await newAgent.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/probe-ns-03-new-session-dialog.png" });

    // Log dialog structure
    const dialogContent = await page.evaluate(() => {
      const items: string[] = [];
      const dialog = document.querySelector("[role='dialog']");
      if (!dialog) return ["(no dialog role element)"];
      dialog.querySelectorAll("button, input, [role='button'], [role='combobox']").forEach((el) => {
        const t = (el.textContent || "").trim().slice(0, 40);
        const label = el.getAttribute("aria-label") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        items.push(`${el.tagName}[${el.getAttribute("role") || ""}]${placeholder ? ` ph="${placeholder}"` : ""} "${t}" aria="${label}"`);
      });
      return items.slice(0, 30);
    });
    console.log("[4] New-session dialog structure:", dialogContent);
  }
  await context.close();
});
