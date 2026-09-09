import { test } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.gigaashley.click";

test.use({ trace: "off" });

test("probe: click Select an agent, see what UI appears", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Try multiple locators — the button might not have role="button"
  const trigger = page.getByText(/select an agent/i).first();
  await trigger.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/probe-picker.png", fullPage: true });

  const summary = await page.evaluate(() => {
    const results: Record<string, string[]> = { buttons: [], testIds: [], ariaLabels: [], textHostHits: [] };
    document.querySelectorAll("button").forEach((el) => {
      const txt = (el.textContent || "").trim().slice(0, 80);
      if (txt) results.buttons.push(txt);
    });
    document.querySelectorAll("[data-testid]").forEach((el) => {
      const t = el.getAttribute("data-testid");
      if (t) results.testIds.push(t);
    });
    document.querySelectorAll("[aria-label]").forEach((el) => {
      const t = el.getAttribute("aria-label");
      if (t) results.ariaLabels.push(t.slice(0, 80));
    });
    // Look for "test-vm" or "172" (IP fragment) anywhere in visible text
    document.querySelectorAll("*").forEach((el) => {
      const txt = (el.textContent || "").trim();
      if ((txt.includes("test-vm") || txt.includes("172.31")) && el.children.length === 0) {
        results.textHostHits.push(`${el.tagName}[${el.className.toString().slice(0, 40)}]: ${txt.slice(0, 80)}`);
      }
    });
    return results;
  });
  console.log("[probe picker]:", JSON.stringify(summary, null, 2));
  console.log("[probe] URL:", page.url());
  await context.close();
});
