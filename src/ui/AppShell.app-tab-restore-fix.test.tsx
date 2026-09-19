/**
 * Phase 120 code-review fix pass (2026-09-19) — MEDIUM-6 + MEDIUM-7
 * regression coverage.
 *
 * ---
 *
 * MEDIUM-6: reload restore must NOT silently drop app tabs whose home
 * host is missing from `allHosts`.
 *
 * The persisted-tab restore loop filters saved rows against `allHosts`:
 * for each row it does `allHosts.find(h => h.id === saved.hostId)` and,
 * if the host is absent AND the tab type isn't in `hostlessTypes`, it
 * `continue`s — dropping the tab entirely. Pre-fix, `hostlessTypes` was
 * `["dashboard"]` only, so an `"app"` tab whose home host had been
 * removed (host deleted, credential revoked, box scaled down) between
 * save and reload was silently dropped, breaking shape 4's principle
 * that "gone-at-reload is a display concern, not a behaviour concern"
 * (the leaf should render and the proxy should show Phase 103's
 * failure interstitial).
 *
 * Fix: `hostlessTypes: TabType[] = ["dashboard", "app"]`. The tab still
 * pushes onto `restoredTabs`; `Tab.host` is left undefined for hostless
 * app rows; `renderAppTab` reads only `tab.app.hostId` / `tab.app.slug`
 * and the proxy's own failure surface handles the missing-host case.
 *
 * ---
 *
 * MEDIUM-7: URL-fragment app-tab restore must validate `spec.hostId`
 * (positive integer regex) + `spec.slug` (APP_SLUG_RE shape) before
 * threading the values into `Tab.app`, refusing malformed fragments
 * fail-safe (returning null → dropped tab, matching the other
 * TabSpec variants' contract).
 *
 * Both fixes are structural — this file uses the source-grep pattern
 * (mirror of `AppShell.relay-url-restore.test.tsx`) rather than
 * mounting AppShell (30+ imports) so the coverage runs on every CI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appShellSrc = readFileSync(
  resolve(__dirname, "AppShell.tsx"),
  "utf8",
);

/* ------------------------------------------------------------------------ */
/*  MEDIUM-6 — reload restore keeps app tabs even when host is gone          */
/* ------------------------------------------------------------------------ */

describe("AppShell.tsx — MEDIUM-6 app tab restore (host-gone survives)", () => {
  it("Test 1: hostlessTypes includes 'app' alongside 'dashboard'", () => {
    // Pre-fix: `const hostlessTypes: TabType[] = ["dashboard"];`
    // Post-fix: `const hostlessTypes: TabType[] = ["dashboard", "app"];`
    // Loosely-anchored regex allows for the same array literal to also
    // gain other entries in future without breaking this guard.
    expect(appShellSrc).toMatch(
      /hostlessTypes:\s*TabType\[\]\s*=\s*\[[^\]]*"dashboard"[^\]]*"app"[^\]]*\]/,
    );
  });

  it("Test 1b: hostlessTypes literal contains exactly the two entries expected today", () => {
    // Load-bearing constraint — if anything else is added to hostlessTypes
    // in the future, we want a review conversation, not silent drift. The
    // check is order-agnostic.
    const match = appShellSrc.match(
      /hostlessTypes:\s*TabType\[\]\s*=\s*\[([^\]]+)\]/,
    );
    expect(match).toBeTruthy();
    const entries = match![1]
      .split(",")
      .map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""))
      .filter((s) => s.length > 0);
    expect(entries.sort()).toEqual(["app", "dashboard"]);
  });

  it("Test 2: filter guard uses hostlessTypes.includes(saved.tabType as TabType)", () => {
    // Preserves the shape of the filter — the guard is still on
    // `!host && !hostlessTypes.includes(...)`, so the whitelist widening
    // is the load-bearing change (not a filter-shape refactor).
    expect(appShellSrc).toContain(
      "hostlessTypes.includes(saved.tabType as TabType)",
    );
  });

  it("Test 3: pre-fix regression floor — hostlessTypes is NOT dashboard-only anymore", () => {
    // Explicit anti-regression: if a future refactor reverts to the
    // dashboard-only whitelist, this test fails.
    expect(appShellSrc).not.toMatch(
      /hostlessTypes:\s*TabType\[\]\s*=\s*\[\s*"dashboard"\s*\]/,
    );
  });

  it("Test 4: Tab.app reconstruction still gated on both hostId AND appSlug being populated", () => {
    // Load-bearing symmetry: even when the host is gone (MEDIUM-6 allows
    // the tab to restore), Tab.app is only constructed when BOTH halves
    // of the (hostId, slug) tuple are present on the saved row. A row
    // missing appSlug (legacy mid-rollout data) still restores but
    // without Tab.app — `isAppTab` narrows false, `renderAppTab` returns
    // null (per Plan 07's D-16 comment).
    expect(appShellSrc).toMatch(
      /saved\.tabType === "app"\s*&&[\s\S]*?saved\.hostId != null\s*&&[\s\S]*?saved\.appSlug != null/,
    );
  });
});

// MEDIUM-7 coverage lives in `src/ui/lib/tab-url.test.ts` — the parseTabParam
// "app:<hostId>:<slug>" branch validates hostId shape (positive-integer
// regex) and slug shape (APP_SLUG_RE) at the wire boundary, dropping the
// tab fail-safe rather than passing NaN through. See that file for the
// per-branch assertions; AppShell.tsx's callsite is unchanged (still
// `Number(spec.hostId)` — safe because the wire validator has already
// enforced the positive-integer shape upstream).
