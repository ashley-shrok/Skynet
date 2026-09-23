/**
 * Phase 111 SKEW-01: client-build-id getter smoke tests.
 *
 * Contract exercised:
 *   - `CLIENT_BUILD_ID` is a NON-EMPTY string exported as a plain const from
 *     `src/ui/lib/client-build-id.ts`. Consumers (interceptor, WS clients)
 *     import from here — never touching `import.meta.env.VITE_BUILD_ID`
 *     directly — so we can rely on Vite's compile-time `define` substitution
 *     baking a byte-stable literal into every bundle.
 *
 *   - In the vitest jsdom test env there is NO Vite build pass; the
 *     `import.meta.env.VITE_BUILD_ID` `define` substitution never fires,
 *     so the getter falls through to its `"dev-unknown"` fallback. That's
 *     the expected wire under test — this test does NOT try to simulate a
 *     production bundle (that's what the acceptance-criteria grep on
 *     vite.config.ts checks).
 *
 *   - Plain-const shape (not a getter fn) — tree-shaking sees the value as
 *     a literal after `define` substitution in prod builds.
 */

import { describe, it, expect } from "vitest";
import { CLIENT_BUILD_ID } from "./client-build-id.js";

describe("CLIENT_BUILD_ID — Phase 111 SKEW-01 client getter", () => {
  it("Test 1: is a non-empty string", () => {
    expect(typeof CLIENT_BUILD_ID).toBe("string");
    expect(CLIENT_BUILD_ID.length).toBeGreaterThan(0);
  });

  it('Test 2: in test env (VITE_BUILD_ID unset), value is "dev-unknown" or a "dev-*" fallback (accept either — depends on import.meta.env behavior under vitest jsdom)', () => {
    // Vite's `define` substitution does not fire in vitest — it fires only
    // during `vite build`. So under vitest jsdom the value MUST land at the
    // module-scope `|| "dev-unknown"` fallback OR (if some vite-eval-time
    // fallback made it in via a `dev-<base36>` string) a `dev-*` prefix.
    expect(
      CLIENT_BUILD_ID === "dev-unknown" || CLIENT_BUILD_ID.startsWith("dev-"),
    ).toBe(true);
  });

  it("Test 3: exported binding is a plain const (not a getter fn) so tree-shaking sees it as a literal", () => {
    // If someone accidentally re-exports the value as a function, this asserts
    // the shape mismatch immediately — the const contract is load-bearing for
    // the compile-time-literal promise in vite.config.ts's `define` block.
    expect(typeof CLIENT_BUILD_ID).not.toBe("function");
  });
});
