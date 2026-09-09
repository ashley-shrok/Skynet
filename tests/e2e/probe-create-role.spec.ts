import { test } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.gigaashley.click";

test.use({ trace: "off" });

test("probe: create a role as throwaway-tina on test-vm-throwaway", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Click More Actions
  console.log("[1] click more actions");
  await page.locator('[data-testid="pv-header-menu-button"]').click();
  await page.waitForTimeout(600);

  // Click New role
  console.log("[2] click new role");
  await page.getByRole("menuitem", { name: /new role/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/probe-create-role-01.png" });

  // Fill role fields
  console.log("[3] fill fields");
  // NAME
  await page.getByLabel(/^name$/i).fill("perf-tester");
  await page.waitForTimeout(200);
  // DESCRIPTION
  const desc = page.getByLabel(/description/i).first();
  if (await desc.isVisible().catch(() => false)) {
    await desc.fill("Throwaway role for POC verification 2026-09-08");
  }
  // TITLE
  const title = page.getByLabel(/^title$/i);
  if (await title.isVisible().catch(() => false)) {
    await title.fill("Perf Tester");
  }
  await page.screenshot({ path: "test-results/probe-create-role-02-filled.png" });

  // Where does the role need to land — the dialog needs to know WHICH HOST
  // to write to. Let me inspect for host picker.
  const hostAffordance = await page.evaluate(() => {
    const results: string[] = [];
    document.querySelectorAll("[role='dialog'] *").forEach((el) => {
      const txt = (el.textContent || "").trim();
      const label = el.getAttribute("aria-label") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      if ((txt || label || placeholder) && (txt.match(/host|172|test-vm/i) || label.match(/host/i) || placeholder.match(/host/i))) {
        results.push(`${el.tagName} txt="${txt.slice(0, 40)}" aria="${label}" ph="${placeholder}"`);
      }
    });
    return results.slice(0, 20);
  });
  console.log("[4] host affordances in dialog:", hostAffordance);

  console.log("[5] click Create");
  await page.getByRole("button", { name: /^create$/i }).click().catch((e) => console.log("[create click err]", e.message));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "test-results/probe-create-role-03-post-create.png" });

  console.log("[6] URL after create:", page.url());
  // Check for toast / error
  const toast = await page.evaluate(() => {
    const t: string[] = [];
    document.querySelectorAll("[role='status'], .sonner-toast, [data-sonner-toast]").forEach((el) => {
      const txt = (el.textContent || "").trim();
      if (txt) t.push(txt.slice(0, 100));
    });
    return t;
  });
  console.log("[7] toasts/status:", toast);
  await context.close();
});
