/**
 * Phase 111 SKEW-01/SKEW-02: server-build-id getter tests.
 *
 * Contract exercised (per PLAN.md Task 2 `<behavior>`):
 *   - Test 1: `getServerBuildId()` returns `process.env.VITE_BUILD_ID`
 *     when that env is set at module-load time.
 *   - Test 2: `getServerBuildId()` returns "dev-unknown" when
 *     `VITE_BUILD_ID` is unset at module-load time.
 *   - Test 3: The `SERVER_BUILD_ID` module-scope constant is captured
 *     ONCE at module-load. Mutating `process.env.VITE_BUILD_ID` AFTER
 *     the module is imported does NOT change subsequent
 *     `getServerBuildId()` return values.
 *
 * Test isolation strategy:
 *   - `vi.resetModules()` + dynamic `await import(...)` between mutations
 *     to re-run the module-scope `const` capture. This mirrors the
 *     `assert-boot.test.ts` fresh-import pattern (Phase 74 Plan 02).
 *   - `process.env.VITE_BUILD_ID` is a plain env var; the tests set it
 *     directly before each dynamic import to control what gets captured.
 *   - The module's contract is "read once at module load", so the
 *     read-once assertion in Test 3 works by loading the module under
 *     one env, mutating `process.env`, and confirming the exported fn
 *     STILL returns the originally-captured value.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";

// Preserve the pre-test env so afterEach can restore it. This is a shared
// backend-test env var; the setup file may have defaulted it and we must
// not leave a mutation behind.
const ORIGINAL_VITE_BUILD_ID = process.env.VITE_BUILD_ID;

async function freshGetter() {
  vi.resetModules();
  return await import("./server-build-id.js");
}

describe("server-build-id — Phase 111 SKEW-01 backend getter", () => {
  beforeEach(() => {
    // Clean slate for each test — every test explicitly sets or unsets the env.
    delete process.env.VITE_BUILD_ID;
  });

  afterEach(() => {
    if (ORIGINAL_VITE_BUILD_ID === undefined) {
      delete process.env.VITE_BUILD_ID;
    } else {
      process.env.VITE_BUILD_ID = ORIGINAL_VITE_BUILD_ID;
    }
  });

  it("Test 1: getServerBuildId() returns process.env.VITE_BUILD_ID when set at module-load", async () => {
    process.env.VITE_BUILD_ID = "abc123def456";
    const mod = await freshGetter();
    expect(mod.getServerBuildId()).toBe("abc123def456");
    expect(mod.SERVER_BUILD_ID).toBe("abc123def456");
  });

  it('Test 2: getServerBuildId() returns "dev-unknown" when VITE_BUILD_ID is unset at module-load', async () => {
    // beforeEach already deleted the var; explicit for clarity.
    delete process.env.VITE_BUILD_ID;
    const mod = await freshGetter();
    expect(mod.getServerBuildId()).toBe("dev-unknown");
    expect(mod.SERVER_BUILD_ID).toBe("dev-unknown");
  });

  it("Test 3: SERVER_BUILD_ID is captured ONCE at module-load; mutating process.env AFTER import does NOT change the return value", async () => {
    process.env.VITE_BUILD_ID = "captured-at-load";
    const mod = await freshGetter();
    expect(mod.getServerBuildId()).toBe("captured-at-load");

    // Simulate a hostile / accidental post-load env mutation. The module MUST
    // NOT re-read process.env — this is the D-16 single-startup-capture
    // guarantee. Any consumer that later mutates env should NOT be able to
    // spoof a fake build-id into a running backend.
    process.env.VITE_BUILD_ID = "MUTATED-AFTER-LOAD";
    expect(mod.getServerBuildId()).toBe("captured-at-load");
    expect(mod.SERVER_BUILD_ID).toBe("captured-at-load");
  });
});
