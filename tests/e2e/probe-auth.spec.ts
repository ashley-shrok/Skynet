import { test } from "@playwright/test";
import { readCreds, seedAuthCookie } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.gigaashley.click";

test.use({ trace: "off" });

test("probe: what does the frontend see with a seeded cookie", async ({ browser }) => {
  const context = await browser.newContext();
  await seedAuthCookie(context.request, BASE_URL, readCreds());

  const ctxCookies = await context.cookies(BASE_URL);
  console.log("[probe] context cookies:", JSON.stringify(ctxCookies, null, 2));

  const page = await context.newPage();

  // Log every network response so we can see which requests get 401/redirect
  page.on("response", (r) => {
    const url = r.url();
    if (url.startsWith(BASE_URL) && !url.includes("/assets/") && !url.includes(".png") && !url.includes(".webp")) {
      console.log(`[net] ${r.status()} ${r.request().method()} ${url}`);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const browserSideProbes = await page.evaluate(async () => {
    const cookieVisible = document.cookie; // won't show HttpOnly cookies
    let meRes: { status: number; body: unknown } | { error: string };
    try {
      const r = await fetch("/users/me", { credentials: "include" });
      meRes = { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      meRes = { error: String(e) };
    }
    // Look for common auth-state hints in the DOM
    const loginFormPresent = !!document.querySelector('input[autocomplete="username"]');
    const bodyText = document.body?.innerText?.slice(0, 200) ?? "(no body)";
    return { cookieVisible, meRes, loginFormPresent, bodyText };
  });
  console.log("[probe] browser-side:", JSON.stringify(browserSideProbes, null, 2));
  await page.screenshot({ path: "test-results/probe-auth-screenshot.png", fullPage: true });
  console.log("[probe] URL after load:", page.url());
  await context.close();
});
