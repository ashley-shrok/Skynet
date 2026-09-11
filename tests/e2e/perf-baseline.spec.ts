import { test, expect, Page, BrowserContext } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";
import * as fs from "node:fs";
import * as path from "node:path";

// Bounty-scoped output dir so traces + reports survive test-results/ rm.
const BOUNTY_DIR =
  process.env.PERF_OUTPUT_DIR ??
  path.resolve(
    process.env.HOME ?? "",
    ".claude/roles/box-maintainer/bounties/profile-frontend-perf-and-see-if-improvements-can-be-made",
  );
const TRACE_DIR = path.join(BOUNTY_DIR, "traces");
const REPORT_DIR = path.join(BOUNTY_DIR, "reports");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";

// Init script installed in the browser context BEFORE navigation begins.
// It sets up PerformanceObservers so LCP, long-tasks, layout-shifts, and
// element timings are captured from the very first bytes — getEntriesByType
// after the fact misses entries the browser emits transiently.
const PERF_OBSERVER_INIT = `
(() => {
  window.__perf = { lcpEntries: [], longTasks: [], layoutShifts: [], firstInput: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__perf.lcpEntries.push({
          startTime: e.startTime, size: e.size, id: e.id, url: e.url, element: e.element ? e.element.tagName : null
        });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__perf.longTasks.push({ startTime: e.startTime, duration: e.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__perf.layoutShifts.push({ startTime: e.startTime, value: e.value });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      const e = list.getEntries()[0];
      if (e && !window.__perf.firstInput) {
        window.__perf.firstInput = { startTime: e.startTime, processingStart: e.processingStart, duration: e.duration };
      }
    }).observe({ type: "first-input", buffered: true });
  } catch (e) {}
})();
`;

interface PerfRun {
  label: string;
  documentLoad_ms: number;
  domInteractive_ms: number;
  domContentLoaded_ms: number;
  firstPaint_ms: number | null;
  firstContentfulPaint_ms: number | null;
  largestContentfulPaint_ms: number | null;
  lcpDetails: unknown[];
  longTasks: { startTime: number; duration: number }[];
  longTasks_totalBlockingTime_ms: number;
  cumulativeLayoutShift: number;
  layoutShifts: { startTime: number; value: number }[];
  firstInput: unknown | null;
  domNodes: number;
  jsHeap_usedMb: number | null;
  jsHeap_totalMb: number | null;
  resources: {
    total: number;
    totalTransferKb: number;
    slowest: { name: string; duration_ms: number; transferSize: number }[];
    byType: Record<string, { count: number; transferKb: number }>;
  };
  jsCoverage: {
    scripts: number;
    bytesTotal: number;
    bytesUsed: number;
    unusedPct: number;
  };
  navigationTiming: Record<string, number>;
  wall_ms: number;
}

async function collectPerf(
  page: Page,
  label: string,
  wall_ms: number,
): Promise<PerfRun> {
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;

    const paint = performance.getEntriesByType("paint") as PerformancePaintTiming[];
    const fp = paint.find((p) => p.name === "first-paint")?.startTime ?? null;
    const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;

    const perf = (window as unknown as { __perf: { lcpEntries: { startTime: number }[]; longTasks: { startTime: number; duration: number }[]; layoutShifts: { startTime: number; value: number }[]; firstInput: unknown | null } }).__perf;
    const lcpArr = perf?.lcpEntries ?? [];
    const lcp = lcpArr.length ? lcpArr[lcpArr.length - 1].startTime : null;

    const longTasks = perf?.longTasks ?? [];
    // TBT = sum of (duration - 50ms) for tasks longer than 50ms, between FCP and TTI (approx).
    const tbt = longTasks
      .filter((t) => (fcp ?? 0) <= t.startTime && t.duration > 50)
      .reduce((s, t) => s + (t.duration - 50), 0);
    const layoutShifts = perf?.layoutShifts ?? [];
    const cls = layoutShifts.reduce((s, l) => s + l.value, 0);

    const resEntries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const byType: Record<string, { count: number; transferKb: number }> = {};
    for (const r of resEntries) {
      const type = r.initiatorType || "other";
      byType[type] = byType[type] ?? { count: 0, transferKb: 0 };
      byType[type].count++;
      byType[type].transferKb += Math.round((r.transferSize || 0) / 1024);
    }
    const resources = {
      total: resEntries.length,
      totalTransferKb: Math.round(
        resEntries.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024,
      ),
      slowest: resEntries
        .slice()
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map((r) => ({
          name: r.name,
          duration_ms: Math.round(r.duration),
          transferSize: r.transferSize || 0,
        })),
      byType,
    };

    const heap =
      (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    const jsHeap_usedMb = heap ? Math.round(heap.usedJSHeapSize / (1024 * 1024)) : null;
    const jsHeap_totalMb = heap ? Math.round(heap.totalJSHeapSize / (1024 * 1024)) : null;

    const domNodes = document.getElementsByTagName("*").length;

    const navTiming = nav
      ? {
          startTime: 0,
          fetchStart: nav.fetchStart,
          domainLookupStart: nav.domainLookupStart,
          domainLookupEnd: nav.domainLookupEnd,
          connectStart: nav.connectStart,
          connectEnd: nav.connectEnd,
          secureConnectionStart: nav.secureConnectionStart,
          requestStart: nav.requestStart,
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          domInteractive: nav.domInteractive,
          domContentLoadedEventStart: nav.domContentLoadedEventStart,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          domComplete: nav.domComplete,
          loadEventStart: nav.loadEventStart,
          loadEventEnd: nav.loadEventEnd,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize,
        }
      : {};

    return {
      documentLoad_ms: nav ? Math.round(nav.loadEventEnd) : 0,
      domInteractive_ms: nav ? Math.round(nav.domInteractive) : 0,
      domContentLoaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      fp,
      fcp,
      lcp,
      lcpEntries: lcpArr,
      longTasks,
      tbt,
      cls,
      layoutShifts,
      firstInput: perf?.firstInput ?? null,
      domNodes,
      jsHeap_usedMb,
      jsHeap_totalMb,
      resources,
      navTiming,
    };
  });

  // JS coverage — Chromium only
  let jsCoverageStats = { scripts: 0, bytesTotal: 0, bytesUsed: 0, unusedPct: 0 };
  try {
    if (!page.coverage) throw new Error("coverage-unsupported");
    const coverage = await page.coverage.stopJSCoverage();
    let total = 0;
    let used = 0;
    for (const entry of coverage) {
      const size = entry.source?.length ?? 0;
      total += size;
      for (const fn of entry.functions) {
        for (const range of fn.ranges) {
          if (range.count > 0) used += range.endOffset - range.startOffset;
        }
      }
    }
    jsCoverageStats = {
      scripts: coverage.length,
      bytesTotal: total,
      bytesUsed: Math.min(used, total),
      unusedPct: total ? Math.round(((total - Math.min(used, total)) / total) * 100) : 0,
    };
  } catch {
    // ignore
  }

  return {
    label,
    documentLoad_ms: metrics.documentLoad_ms,
    domInteractive_ms: metrics.domInteractive_ms,
    domContentLoaded_ms: metrics.domContentLoaded_ms,
    firstPaint_ms: metrics.fp !== null ? Math.round(metrics.fp) : null,
    firstContentfulPaint_ms: metrics.fcp !== null ? Math.round(metrics.fcp) : null,
    largestContentfulPaint_ms: metrics.lcp !== null ? Math.round(metrics.lcp) : null,
    lcpDetails: metrics.lcpEntries,
    longTasks: metrics.longTasks,
    longTasks_totalBlockingTime_ms: Math.round(metrics.tbt),
    cumulativeLayoutShift: Number(metrics.cls.toFixed(4)),
    layoutShifts: metrics.layoutShifts,
    firstInput: metrics.firstInput,
    domNodes: metrics.domNodes,
    jsHeap_usedMb: metrics.jsHeap_usedMb,
    jsHeap_totalMb: metrics.jsHeap_totalMb,
    resources: metrics.resources,
    jsCoverage: jsCoverageStats,
    navigationTiming: metrics.navTiming as Record<string, number>,
    wall_ms,
  };
}

function writeReport(run: PerfRun, filename: string) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, filename), JSON.stringify(run, null, 2));
}

function summarize(run: PerfRun): string {
  return [
    `[perf ${run.label}]`,
    `wall=${run.wall_ms}ms`,
    `FCP=${run.firstContentfulPaint_ms}ms`,
    `LCP=${run.largestContentfulPaint_ms}ms`,
    `TBT=${run.longTasks_totalBlockingTime_ms}ms`,
    `CLS=${run.cumulativeLayoutShift}`,
    `longTasks=${run.longTasks.length}`,
    `DOMnodes=${run.domNodes}`,
    `heap=${run.jsHeap_usedMb}Mb`,
    `res=${run.resources.total}(${run.resources.totalTransferKb}Kb)`,
    `JSscripts=${run.jsCoverage.scripts}`,
    `JSunused=${run.jsCoverage.unusedPct}%`,
  ].join(" ");
}

async function makeContextWithObservers(browser: import("@playwright/test").Browser, opts?: { seedCreds?: boolean }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(PERF_OBSERVER_INIT);
  if (opts?.seedCreds) {
    await seedFullAuth(context, BASE_URL, readCreds());
    const cookies = await context.cookies(BASE_URL);
    const jwt = cookies.find((c) => c.name === "jwt");
    if (!jwt) {
      throw new Error(
        `cookie seed failed — no jwt cookie set on context after /users/login (got: ${cookies.map((c) => c.name).join(",") || "none"})`,
      );
    }
  }
  const page = await context.newPage();
  return { context, page };
}

// Opt out of the config-level trace: we drive our own tracing per-context.
test.use({ trace: "off" });

test.describe.serial("perf baseline against production", () => {
  test.beforeAll(() => {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  });

  test("cold login page (no auth, no service worker cache)", async ({ browser }) => {
    const { context, page } = await makeContextWithObservers(browser);
    try {
      await page.coverage?.startJSCoverage({ resetOnNavigation: false });
    } catch {
      /* non-chromium — coverage unavailable */
    }
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

    const t0 = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(/username/i)).toBeVisible({ timeout: 20_000 });
    // Nudge LCP to finalize — a simulated click OR let 5s elapse.
    await page.waitForTimeout(3000);
    // Force LCP finalization by dispatching a click far from any element.
    await page.mouse.click(1, 1);
    await page.waitForTimeout(500);
    const tWall = Date.now() - t0;

    const run = await collectPerf(page, "cold-login-page", tWall);
    writeReport(run, `cold-login-page-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await context.tracing.stop({
      path: path.join(TRACE_DIR, `cold-login-page-${Date.now()}.zip`),
    });
    await context.close();
    console.log(summarize(run));
  });

  test("post-login shell (cookie seeded, first paint of authed app)", async ({ browser }) => {
    const { context, page } = await makeContextWithObservers(browser, { seedCreds: true });
    try {
      await page.coverage?.startJSCoverage({ resetOnNavigation: false });
    } catch {
      /* non-chromium — coverage unavailable */
    }
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

    const t0 = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for authed shell — the login form should NOT appear at all (cookie seeded).
    // Instead, look for something in the app shell. We don't yet know exact selectors —
    // fall back to any element with a data-attribute or a broad heuristic.
    await page.waitForFunction(
      () => !document.querySelector('input[autocomplete="username"]'),
      { timeout: 15_000 },
    ).catch(() => {});
    await page.waitForTimeout(3500);
    await page.mouse.click(1, 1);
    await page.waitForTimeout(500);
    const tWall = Date.now() - t0;

    const run = await collectPerf(page, "post-login-shell", tWall);
    (run as PerfRun & { finalUrl: string; loginFormVisible: boolean }).finalUrl = page.url();
    (run as PerfRun & { finalUrl: string; loginFormVisible: boolean }).loginFormVisible =
      (await page.locator('input[autocomplete="username"]').count()) > 0;
    writeReport(run, `post-login-shell-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await context.tracing.stop({
      path: path.join(TRACE_DIR, `post-login-shell-${Date.now()}.zip`),
    });
    await context.close();
    console.log(summarize(run));
    console.log(`[perf post-login-shell] finalUrl=${page.url()}`);
  });
});
