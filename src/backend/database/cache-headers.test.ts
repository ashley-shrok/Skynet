/**
 * Phase 111 SKEW-14: assertion test that the three `Cache-Control: no-store`
 * enforcement layers for `index.html` are still in place.
 *
 * D-19 (from CONTEXT.md) requires index.html to be served with a no-store
 * policy so the browser NEVER uses a cached shell — the reload-recovery
 * gesture (D-13) depends on a fresh shell fetch pointing at the current
 * asset hashes on any reload.
 *
 * The D-20 audit (see 111-RESEARCH.md § Q6) confirmed the discipline
 * already ships in production at three places:
 *
 *   1. docker/nginx.conf                — `location /` block (add_header)
 *   2. docker/nginx-https.conf          — mirror `location /` block (nginx-parity)
 *   3. src/backend/database/database.ts — Express SPA fallback (setHeader),
 *                                          at TWO sites: the express.static
 *                                          setHeaders callback for
 *                                          index.html/sw.js/manifest.json,
 *                                          PLUS the branding SPA fallback
 *                                          middleware for GET requests
 *                                          accepting html.
 *
 * This test guards those three layers via substring-presence checks. A
 * future refactor that removes ANY of the three layers gets a red test in
 * CI, forcing the maintainer to reconsider whether they've broken Phase
 * 111's design. The substring check is intentionally lax on whitespace
 * (`toContain`) so a legitimate reformat that preserves the semantic
 * policy still passes — the test's purpose is to catch DELETIONS, not
 * whitespace churn (see T-111-26 threat register).
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// __dirname equivalent for ESM. cache-headers.test.ts lives at
// src/backend/database/cache-headers.test.ts — three ../ hops to reach the
// repo root regardless of where vitest is invoked from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");

// The exact policy string mandated by D-19. Sourced by copying the bytes
// out of the three source files (verified 2026-09-21). If any layer's
// exact quoting/ordering diverges from this literal, the test needs a
// per-file substring — but as of Phase 111 all three layers use the SAME
// five-directive combo in the SAME order, which is by design (Pitfall 2:
// nginx-parity + Express-parity keeps the deploy predictable).
const CACHE_HEADER_SUBSTRING =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

// Phase 111 cross-reference comment marker — Task 1 of Plan 111-07 added
// this exact tag above every enforcement layer's `add_header` /
// `setHeader` call so a future refactor's grep discovers the load-bearing
// property. If a refactor deletes the comment without deleting the
// enforcement, the enforcement tests below still pass — but this test
// (below) fails, surfacing the drift.
const PHASE_MARKER = "Phase 111 SKEW-14";

describe("Phase 111 SKEW-14: index.html cache-control enforcement layers", () => {
  test("layer 1: docker/nginx.conf contains the no-store block", () => {
    const src = readFileSync(
      path.join(REPO_ROOT, "docker/nginx.conf"),
      "utf8",
    );
    expect(src).toContain(CACHE_HEADER_SUBSTRING);
  });

  test("layer 2: docker/nginx-https.conf contains the no-store block", () => {
    const src = readFileSync(
      path.join(REPO_ROOT, "docker/nginx-https.conf"),
      "utf8",
    );
    expect(src).toContain(CACHE_HEADER_SUBSTRING);
  });

  test("layer 3: database.ts SPA fallback sets no-store on index.html at >= 2 sites", () => {
    // The Express layer has TWO `setHeader("Cache-Control", "no-store, ...")`
    // sites: (a) the express.static setHeaders callback that runs on the
    // static-serve path for index.html/sw.js/manifest.json, and (b) the
    // branding SPA fallback middleware that overrides for the templated
    // index.html response. Both are load-bearing per RESEARCH.md § Q6.
    const src = readFileSync(
      path.join(REPO_ROOT, "src/backend/database/database.ts"),
      "utf8",
    );
    // Count occurrences by splitting on the substring and subtracting one
    // from the resulting array length. Robust to overlapping-substring
    // edge cases because the substring is unique enough not to appear
    // inside itself.
    const count = src.split(CACHE_HEADER_SUBSTRING).length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("nginx-parity: both nginx configs contain the block (Pitfall 2)", () => {
    // The full parity check across all 30+ location blocks is not this
    // test's job — that lives in the ship-time smoke check. This test
    // asserts the ONE location block Phase 111 depends on is present in
    // BOTH configs, so an SSL vs non-SSL deploy path doesn't diverge on
    // the shell-page cache policy.
    const http = readFileSync(
      path.join(REPO_ROOT, "docker/nginx.conf"),
      "utf8",
    );
    const https = readFileSync(
      path.join(REPO_ROOT, "docker/nginx-https.conf"),
      "utf8",
    );
    expect(http).toContain(CACHE_HEADER_SUBSTRING);
    expect(https).toContain(CACHE_HEADER_SUBSTRING);
  });

  test("codification: all three layers carry the Phase 111 cross-reference comment", () => {
    // Task 1 of Plan 111-07 added a "Phase 111 SKEW-14" comment above each
    // enforcement site so future refactors' grep discovers the load-bearing
    // property. If a refactor strips the comment without stripping the
    // header, this test fails while the enforcement tests still pass —
    // surfacing the drift-of-intent even when the mechanism is intact.
    const nginxHttp = readFileSync(
      path.join(REPO_ROOT, "docker/nginx.conf"),
      "utf8",
    );
    const nginxHttps = readFileSync(
      path.join(REPO_ROOT, "docker/nginx-https.conf"),
      "utf8",
    );
    const databaseTs = readFileSync(
      path.join(REPO_ROOT, "src/backend/database/database.ts"),
      "utf8",
    );

    expect(nginxHttp).toContain(PHASE_MARKER);
    expect(nginxHttps).toContain(PHASE_MARKER);
    // database.ts has two sites — expect the marker to appear at least
    // twice (once above each setHeader call).
    const dbMarkerCount = databaseTs.split(PHASE_MARKER).length - 1;
    expect(dbMarkerCount).toBeGreaterThanOrEqual(2);
  });
});
