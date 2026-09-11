/**
 * Session-storm perf spec — open N terminal tabs simultaneously via URL-driven
 * tab restore (`#tab=terminal:<host>&tab=terminal:<host>...`) and measure the
 * shell-mount cost + long-task profile. Cross-references bounties
 * `hidden-pane-cost-mitigation-empirical-rotation` (Alice's iPhone chugs with
 * 4-5 active sessions) and `appshell-max-update-depth-under-session-storm`.
 */
import { test, expect } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";
const NUM_TABS = parseInt(process.env.STORM_TABS ?? "11", 10);
const REPORT_DIR = path.resolve(
  process.env.HOME ?? "",
  ".claude/roles/box-maintainer/bounties/profile-frontend-perf-and-see-if-improvements-can-be-made/reports",
);

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

test.use({ trace: "off" });

test(`session-storm: open ${NUM_TABS} terminal tabs via URL restore, measure`, async ({ browser }) => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(PERF_OBSERVER_INIT);
  await seedFullAuth(context, BASE_URL, readCreds());

  // Build the URL — 1 test-vm-throwaway + 10 storm-vm-N
  const hosts = ["test-vm-throwaway", ...Array.from({ length: NUM_TABS - 1 }, (_, i) => `storm-vm-${i + 1}`)];
  const params = new URLSearchParams();
  for (const h of hosts) params.append("tab", `terminal:${h}`);
  const url = `${BASE_URL}/#${params.toString()}`;

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text().slice(0, 200)}`);
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Wait for shell to settle. Skynet may throw many resources / open many
  // WebSockets for each SSH pane; give it a full 10s.
  await page.waitForTimeout(10_000);
  const tWall = Date.now() - t0;

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint") as PerformancePaintTiming[];
    const perf = (window as unknown as { __perf: { lcpEntries: { startTime: number }[]; longTasks: { startTime: number; duration: number }[]; layoutShifts: { startTime: number; value: number }[] } }).__perf;
    const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
    const lcp = perf?.lcpEntries.length ? perf.lcpEntries[perf.lcpEntries.length - 1].startTime : null;
    const longTasks = perf?.longTasks ?? [];
    const tbt = longTasks.filter((t) => (fcp ?? 0) <= t.startTime && t.duration > 50).reduce((s, t) => s + (t.duration - 50), 0);
    const cls = (perf?.layoutShifts ?? []).reduce((s, l) => s + l.value, 0);
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    return {
      documentLoad_ms: nav ? Math.round(nav.loadEventEnd) : 0,
      domInteractive_ms: nav ? Math.round(nav.domInteractive) : 0,
      fcp,
      lcp,
      longTasks,
      tbt,
      cls,
      domNodes: document.getElementsByTagName("*").length,
      jsHeap_usedMb: heap ? Math.round(heap.usedJSHeapSize / (1024 * 1024)) : null,
      jsHeap_totalMb: heap ? Math.round(heap.totalJSHeapSize / (1024 * 1024)) : null,
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
      },
      // Count terminal panes actually rendered
      terminalCount: document.querySelectorAll(".xterm, [data-testid*='terminal']").length,
      openWebSockets: (() => {
        // Approximate via known WS-fetching resource-type entries
        const ws = res.filter((r) => r.initiatorType === "other" && r.name.includes("ws://"));
        return ws.length;
      })(),
    };
  });

  const report = {
    label: `session-storm-${NUM_TABS}-tabs`,
    tabs_requested: NUM_TABS,
    hosts,
    wall_ms: tWall,
    documentLoad_ms: metrics.documentLoad_ms,
    firstContentfulPaint_ms: metrics.fcp !== null ? Math.round(metrics.fcp) : null,
    largestContentfulPaint_ms: metrics.lcp !== null ? Math.round(metrics.lcp) : null,
    longTasks_count: metrics.longTasks.length,
    longTasks_totalBlockingTime_ms: Math.round(metrics.tbt),
    longTasks_total_duration_ms: Math.round(metrics.longTasks.reduce((s, t) => s + t.duration, 0)),
    cumulativeLayoutShift: Number(metrics.cls.toFixed(4)),
    domNodes: metrics.domNodes,
    jsHeap_usedMb: metrics.jsHeap_usedMb,
    resources: metrics.resources,
    terminalCount_rendered: metrics.terminalCount,
    consoleErrors: consoleErrors.slice(0, 20),
    consoleErrors_count: consoleErrors.length,
  };
  fs.writeFileSync(
    path.join(REPORT_DIR, `session-storm-${NUM_TABS}tabs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
    JSON.stringify(report, null, 2),
  );

  console.log(`[session-storm ${NUM_TABS} tabs]`);
  console.log(`  wall=${tWall}ms FCP=${report.firstContentfulPaint_ms}ms LCP=${report.largestContentfulPaint_ms}ms TBT=${report.longTasks_totalBlockingTime_ms}ms`);
  console.log(`  longTasks=${report.longTasks_count} (total dur ${report.longTasks_total_duration_ms}ms)`);
  console.log(`  DOMnodes=${report.domNodes} heap=${report.jsHeap_usedMb}Mb`);
  console.log(`  terminalCount=${report.terminalCount_rendered} (out of ${NUM_TABS} requested)`);
  console.log(`  consoleErrors=${report.consoleErrors_count}`);
  if (consoleErrors.length) console.log("  first error:", consoleErrors[0]);

  await page.screenshot({ path: `test-results/session-storm-${NUM_TABS}-final.png`, fullPage: false });
  await context.close();
});
