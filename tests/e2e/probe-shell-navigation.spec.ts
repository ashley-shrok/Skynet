import { test } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.gigaashley.click";

test.use({ trace: "off" });

test("probe: enumerate interactive elements on the shell after login", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  console.log("[probe] URL:", page.url());
  console.log("[probe] title:", await page.title());
  await page.screenshot({ path: "test-results/probe-shell.png", fullPage: true });

  // Enumerate visible elements with useful selectors
  const summary = await page.evaluate(() => {
    const results: Record<string, string[]> = { buttons: [], links: [], testIds: [], ariaLabels: [], headings: [] };
    document.querySelectorAll("button").forEach((el) => {
      const txt = (el.textContent || "").trim().slice(0, 60);
      if (txt) results.buttons.push(txt);
    });
    document.querySelectorAll("a").forEach((el) => {
      const txt = (el.textContent || "").trim().slice(0, 60);
      if (txt) results.links.push(txt);
    });
    document.querySelectorAll("[data-testid]").forEach((el) => {
      const t = el.getAttribute("data-testid");
      if (t) results.testIds.push(t);
    });
    document.querySelectorAll("[aria-label]").forEach((el) => {
      const t = el.getAttribute("aria-label");
      if (t) results.ariaLabels.push(t.slice(0, 60));
    });
    document.querySelectorAll("h1,h2,h3").forEach((el) => {
      const txt = (el.textContent || "").trim().slice(0, 60);
      if (txt) results.headings.push(`${el.tagName}: ${txt}`);
    });
    // Text nodes containing "test-vm"
    const tw = document.evaluate("//*[contains(text(),'test-vm')]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
    const hits: string[] = [];
    let n;
    while ((n = tw.iterateNext())) hits.push(`${(n as Element).tagName}: ${(n.textContent || "").slice(0, 80)}`);
    return { ...results, testVmHits: hits };
  });
  console.log("[probe] summary:", JSON.stringify(summary, null, 2));
  await context.close();
});
