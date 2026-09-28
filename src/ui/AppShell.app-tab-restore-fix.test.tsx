/**
 * Phase 120 code-review fix pass (2026-09-19) — MEDIUM-6 + MEDIUM-7
 * regression coverage.
 *
 * ---
 *
 * MEDIUM-6: reload restore must NOT silently drop app tabs whose home
 * host is missing from `allHosts`.
 *
 * Phase 137 D-31 update: the persisted-tab restore loop that contained
 * the MEDIUM-6 fix (hostlessTypes guard + Tab.app reconstruction) was
 * gated on `userPrefs.reopenTabsOnLogin` — a preference that was always
 * `false` (dead fork holdover). Phase 137 Plan 06 removed that entire
 * code path. The assertions below are updated to reflect the new state:
 *
 *   - The `hostlessTypes` restore-loop no longer exists in AppShell.tsx.
 *   - Saved tabs go to `setBackgroundTabRecords` unconditionally.
 *   - MEDIUM-6 (app tab with missing host reaches ConnectionsPanel vs.
 *     being silently dropped) is still satisfied through the background
 *     records path.
 *
 * ---
 *
 * MEDIUM-7: URL-fragment app-tab restore must validate `spec.hostId`
 * (positive integer regex) + `spec.slug` (APP_SLUG_RE shape) before
 * threading the values into `Tab.app`, refusing malformed fragments
 * fail-safe (returning null → dropped tab, matching the other
 * TabSpec variants' contract).
 *
 * MEDIUM-7 coverage is unaffected by D-31 and lives in
 * `src/ui/lib/tab-url.test.ts`.
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
/*  MEDIUM-6 — Phase 137 D-31 updated assertions                             */
/* ------------------------------------------------------------------------ */

describe("AppShell.tsx — MEDIUM-6 app tab restore (Phase 137 D-31 update)", () => {
  it("Phase 137 D-31: restore loop gated on reopenTabsOnLogin is gone — no hostlessTypes in AppShell", () => {
    // The entire restore-to-tab-bar loop (including the MEDIUM-6 hostlessTypes
    // fix) was inside `if (userPrefs.reopenTabsOnLogin)` which was always false.
    // Phase 137 D-31 removed it. Verify the dead code is gone.
    expect(appShellSrc).not.toContain("hostlessTypes");
  });

  it("Phase 137 D-31: setBackgroundTabRecords is called for saved tabs (background path)", () => {
    // Saved tabs go to ConnectionsPanel via background records.
    expect(appShellSrc).toContain("setBackgroundTabRecords");
  });

  it("Phase 137 D-31: no live references to reopenTabsOnLogin in AppShell (D-31 invariant)", () => {
    // The D-31 acceptance criterion: no live-code references survive.
    // Comments referencing the phase cleanup are also banned from AppShell
    // per the plan (the migration breadcrumb belongs in the DB migration file).
    expect(appShellSrc).not.toMatch(/reopenTabsOnLogin/);
  });
});

// MEDIUM-7 coverage lives in `src/ui/lib/tab-url.test.ts` — the parseTabParam
// "app:<hostId>:<slug>" branch validates hostId shape (positive-integer
// regex) and slug shape (APP_SLUG_RE) at the wire boundary, dropping the
// tab fail-safe rather than passing NaN through. See that file for the
// per-branch assertions; AppShell.tsx's callsite is unchanged (still
// `Number(spec.hostId)` — safe because the wire validator has already
// enforced the positive-integer shape upstream).

/* ------------------------------------------------------------------------ */
/*  splitTree resolver — app-leaf branch (2026-09-28 fix)                    */
/* ------------------------------------------------------------------------ */

// Symmetric with the Phase 97 Plan 05 BLOCKER-1 relay-branch fix
// (AppShell.relay-url-restore.test.tsx Test 3). The splitTree positional
// resolver at ~L1857 iterates every TabSpec variant; without an explicit
// `spec.protocol === "app"` branch the fall-through built key
// `app:${spec.host}:${spec.session ?? ""}` → `"app:undefined:"` (spec.host
// is `never` on the app variant), missed specToTabId, then hit
// `spec.host.toLowerCase()` → TypeError. decodeSplitTreeFromUrl's outer
// try/catch swallowed the exception and returned null, collapsing the
// entire splitTree on reload — visible as "only one tab shows up after
// reload" for any mixed workspace containing an app leaf. The
// split-tree-url.ts codec-side of this class of bug was fixed in
// fdbcd6d3; this is the resolver-side.

describe("AppShell.tsx — splitTree resolver app-leaf branch", () => {
  it("splitTree resolver has an if (spec.protocol === \"app\") branch (symmetric with the relay branch)", () => {
    // Regression floor: the resolver must relay- AND app-branch before
    // reaching the host-required fall-through. Both variants carry
    // `host?: never` and would TypeError otherwise.
    const matches = appShellSrc.match(/spec\.protocol === "app"/g) ?? [];
    // Sites: URL-restore loop 1 (opens the tab), specToTabId population
    // loop, AND the resolver — 3 minimum.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("splitTree resolver builds an app-flavored key (`app:${spec.hostId}:${spec.slug}`) matching the population loop", () => {
    // The population loop at ~L1828 writes `app:${spec.hostId}:${spec.slug}`
    // into specToTabId; the resolver MUST look up the same shape. A key
    // built from `spec.host` / `spec.session` misses every populated entry
    // and falls into the TypeError path.
    const matches = appShellSrc.match(/`app:\$\{spec\.hostId\}:\$\{spec\.slug\}`/g) ?? [];
    // Two sites: the population-loop set, and the resolver lookup.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("splitTree resolver fallback walk matches on isAppTab + hostId + slug identity", () => {
    // Whitespace-tolerant regex — Prettier may wrap the && conjunction
    // across lines. The fallback must use the app tuple, not host lookup.
    expect(appShellSrc).toMatch(
      /isAppTab\(t\)\s+&&\s+String\(t\.app\.hostId\) === spec\.hostId\s+&&\s+t\.app\.slug === spec\.slug/,
    );
  });
});
