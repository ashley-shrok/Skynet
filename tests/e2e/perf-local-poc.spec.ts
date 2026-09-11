/**
 * Local-POC perf spec — points at http://127.0.0.1:4173 (locally-served dist)
 * for static assets, but proxies /users/*, /api/*, /host/*, /identities,
 * /debug/*, /branding/* to production (term.example.com) so the app can
 * render its actual state. This isolates the "shipped bundle change" from
 * "backend behavior change" — API responses are identical, only frontend
 * assets differ.
 *
 * Run:
 *   1. npm run build
 *   2. cd dist && python3 -m http.server 4173 --bind 127.0.0.1 &
 *   3. SKYNET_TEST_CREDS=... PLAYWRIGHT_LOCAL_BASE=http://127.0.0.1:4173
 *      npx playwright test tests/e2e/perf-local-poc.spec.ts --project=chromium
 */
import { test, expect, Page } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";
import * as fs from "node:fs";
import * as path from "node:path";

const BOUNTY_DIR = path.resolve(
  process.env.HOME ?? "",
  ".claude/roles/box-maintainer/bounties/profile-frontend-perf-and-see-if-improvements-can-be-made",
);
const REPORT_DIR = path.join(BOUNTY_DIR, "reports");

const LOCAL_BASE = process.env.PLAYWRIGHT_LOCAL_BASE ?? "http://127.0.0.1:4173";
const PROD_BASE = "https://term.example.com";

// Same PerformanceObserver init as the baseline spec — inline to keep the
// spec self-contained.
const PERF_OBSERVER_INIT = `
(() => {
  window.__perf = { lcpEntries: [], longTasks: [], layoutShifts: [] };
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.lcpEntries.push({ startTime: e.startTime, size: e.size }); }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.longTasks.push({ startTime: e.startTime, duration: e.duration }); }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__perf.layoutShifts.push({ startTime: e.startTime, value: e.value }); }).observe({ type: "layout-shift", buffered: true });
  } catch (e) {}
})();
`;

// Any path prefix in this list, when requested from LOCAL_BASE, gets proxied
// to the production backend. This lets us serve local frontend assets while
// hitting a real backend for auth / branding / config.
const API_PROXY_PREFIXES = [
  "/users/",
  "/api/",
  "/host/",
  "/identities",
  "/debug/",
  "/branding/",
  "/rbac/",
  "/fleet/",
  "/setup/",
];

function shouldProxy(url: URL): boolean {
  return API_PROXY_PREFIXES.some((p) => url.pathname.startsWith(p));
}

async function collectPerf(page: Page, label: string, wall_ms: number) {
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint") as PerformancePaintTiming[];
    const perf = (window as unknown as { __perf: { lcpEntries: { startTime: number }[]; longTasks: { startTime: number; duration: number }[]; layoutShifts: { startTime: number; value: number }[] } }).__perf;
    const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
    const lcp = perf?.lcpEntries.length ? perf.lcpEntries[perf.lcpEntries.length - 1].startTime : null;
    const longTasks = perf?.longTasks ?? [];
    const tbt = longTasks.filter((t) => (fcp ?? 0) <= t.startTime && t.duration > 50).reduce((s, t) => s + (t.duration - 50), 0);
    const cls = (perf?.layoutShifts ?? []).reduce((s, l) => s + l.value, 0);
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return {
      documentLoad_ms: nav ? Math.round(nav.loadEventEnd) : 0,
      domInteractive_ms: nav ? Math.round(nav.domInteractive) : 0,
      fcp,
      lcp,
      longTasks,
      tbt,
      cls,
      domNodes: document.getElementsByTagName("*").length,
      resources: {
        total: res.length,
        totalTransferKb: Math.round(res.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
        byType: (() => {
          const b: Record<string, { count: number; transferKb: number }> = {};
          for (const r of res) {
            const t = r.initiatorType || "other";
            b[t] = b[t] ?? { count: 0, transferKb: 0 };
            b[t].count++;
            b[t].transferKb += Math.round((r.transferSize || 0) / 1024);
          }
          return b;
        })(),
        top: res.slice().sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)).slice(0, 15).map((r) => ({ name: r.name, transferKb: Math.round((r.transferSize || 0) / 1024), duration_ms: Math.round(r.duration) })),
      },
    };
  });
  return {
    label,
    wall_ms,
    documentLoad_ms: m.documentLoad_ms,
    domInteractive_ms: m.domInteractive_ms,
    firstContentfulPaint_ms: m.fcp !== null ? Math.round(m.fcp) : null,
    largestContentfulPaint_ms: m.lcp !== null ? Math.round(m.lcp) : null,
    longTasks: m.longTasks,
    longTasks_totalBlockingTime_ms: Math.round(m.tbt),
    cumulativeLayoutShift: Number(m.cls.toFixed(4)),
    domNodes: m.domNodes,
    resources: m.resources,
  };
}

function summarize(run: Awaited<ReturnType<typeof collectPerf>>): string {
  return [
    `[perf ${run.label}]`,
    `wall=${run.wall_ms}ms`,
    `FCP=${run.firstContentfulPaint_ms}ms`,
    `LCP=${run.largestContentfulPaint_ms}ms`,
    `TBT=${run.longTasks_totalBlockingTime_ms}ms`,
    `longTasks=${run.longTasks.length}`,
    `DOMnodes=${run.domNodes}`,
    `transferKb=${run.resources.totalTransferKb}`,
    `scripts=${run.resources.byType.script?.count ?? 0}(${run.resources.byType.script?.transferKb ?? 0}Kb)`,
  ].join(" ");
}

test.use({ trace: "off" });

test.describe.serial("perf POC — local build with API proxied to production", () => {
  test.beforeAll(() => fs.mkdirSync(REPORT_DIR, { recursive: true }));

  // Route interception installed per-context.
  async function withProxy(ctx: import("@playwright/test").BrowserContext) {
    await ctx.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === new URL(LOCAL_BASE).origin && shouldProxy(u)) {
        const prodUrl = PROD_BASE + u.pathname + u.search;
        const req = route.request();
        const headers = { ...req.headers() };
        // Strip Origin so the prod backend doesn't reject
        delete headers.origin;
        delete headers.referer;
        const resp = await fetch(prodUrl, {
          method: req.method(),
          headers,
          body: req.method() !== "GET" && req.method() !== "HEAD" ? req.postData() ?? undefined : undefined,
          redirect: "manual",
        });
        const body = Buffer.from(await resp.arrayBuffer());
        await route.fulfill({
          status: resp.status,
          headers: Object.fromEntries(resp.headers.entries()),
          body,
        });
      } else {
        await route.continue();
      }
    });
  }

  test("POC cold-login page vs baseline (local build, proxied API)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(PERF_OBSERVER_INIT);
    await withProxy(context);
    const page = await context.newPage();

    const t0 = Date.now();
    await page.goto(LOCAL_BASE + "/", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(/username/i)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    await page.mouse.click(1, 1);
    await page.waitForTimeout(500);
    const tWall = Date.now() - t0;

    const run = await collectPerf(page, "POC-cold-login-page", tWall);
    fs.writeFileSync(
      path.join(REPORT_DIR, `POC-cold-login-page-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
      JSON.stringify(run, null, 2),
    );
    console.log(summarize(run));
    await context.close();
  });

  test("POC post-login shell (cookie seed via proxied /users/login)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(PERF_OBSERVER_INIT);
    // Seed the cookie DIRECTLY against production, then set localStorage.
    await seedFullAuth(context, PROD_BASE, readCreds());
    // Copy the prod-domain cookie to the local domain (cookies are per-domain).
    const prodCookies = await context.cookies(PROD_BASE);
    const jwt = prodCookies.find((c) => c.name === "jwt");
    if (jwt) {
      await context.addCookies([
        {
          name: "jwt",
          value: jwt.value,
          domain: new URL(LOCAL_BASE).hostname,
          path: "/",
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ]);
    }
    await withProxy(context);
    const page = await context.newPage();

    const t0 = Date.now();
    await page.goto(LOCAL_BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !document.querySelector('input[autocomplete="username"]'), { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await page.mouse.click(1, 1);
    await page.waitForTimeout(500);
    const tWall = Date.now() - t0;

    const run = await collectPerf(page, "POC-post-login-shell", tWall);
    (run as unknown as { loginFormVisible: boolean }).loginFormVisible =
      (await page.locator('input[autocomplete="username"]').count()) > 0;
    fs.writeFileSync(
      path.join(REPORT_DIR, `POC-post-login-shell-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
      JSON.stringify(run, null, 2),
    );
    console.log(summarize(run));
    await context.close();
  });
});
