/**
 * Phase 74 Plan 02 — tests for the boot-time presence gate on
 * `avatarDirectorSpec`.
 *
 * Contract exercised:
 *   - `assertBrandingConfigAtBoot()` calls `loadBrandingConfig()` once, trims
 *     `avatarDirectorSpec`, and refuses (process.exit(1)) if the trimmed
 *     length is 0. Rejects: missing key, empty string, whitespace-only
 *     (per 74-CONTEXT.md § "What would make it wrong" §3).
 *   - Emits a structured fatal log via `systemLogger.error` with
 *     `operation: "branding_config_boot_gate"` on failure.
 *   - Does NOT gate on `avatarGammaDefault` — per Ashley resolution #5
 *     (74-CONTEXT.md), gamma is optional-with-code-default. The boot gate
 *     ignores it.
 *   - Non-empty (after trim) spec → returns silently, boot continues.
 *
 * Test isolation strategy:
 *   - `vi.mock("./branding-config-loader.js")` returns a mutable
 *     `mockLoadResult` per test (mirrors the loader-mocking pattern in
 *     branding-config-loader.test.ts's own approach, adapted for a module
 *     that CONSUMES the loader instead of BEING the loader).
 *   - `vi.mock("../utils/logger.js")` returns a spy-able `systemLogger`
 *     so tests can assert error was called with the right operation string.
 *   - `process.exit` is spied per test with `.mockImplementation` that
 *     THROWS instead of actually exiting — so the awaited call rejects and
 *     the test can catch it. Assertions run on the spy call log.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

type LoadResult = {
  appName: string;
  shortName: string;
  iconPath: string;
  wordmarkPath: string;
  faviconPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  // Both fields are declared optional here purely so individual tests can
  // omit them (e.g. Test 2 deletes avatarDirectorSpec entirely). At the
  // real loader boundary these are required strings/numbers — the boot
  // gate must still cope with the "shape violation reached us" defense-in-depth
  // case without crashing on `undefined`.
  avatarDirectorSpec?: unknown;
  avatarGammaDefault?: unknown;
};

const state: { loadResult: LoadResult } = {
  loadResult: makeValidLoadResult(),
};

function makeValidLoadResult(): LoadResult {
  return {
    appName: "Skynet",
    shortName: "Skynet",
    iconPath: "/branding/icon.png",
    wordmarkPath: "/branding/wordmark.png",
    faviconPath: "/branding/favicon.svg",
    pwaIcons: [
      { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    avatarDirectorSpec: "some real spec text",
    avatarGammaDefault: 0.7,
  };
}

vi.mock("./branding-config-loader.js", () => ({
  loadBrandingConfig: async () => state.loadResult,
}));

const systemLoggerErrorSpy = vi.fn();

vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  systemLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (...args: unknown[]) => systemLoggerErrorSpy(...args),
  },
}));

// ─── Fresh-import helper (defeats any module-scope caching if it exists) ────

async function freshGate() {
  vi.resetModules();
  return await import("./assert-boot.js");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("assertBrandingConfigAtBoot — Phase 74 boot-time presence gate", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.loadResult = makeValidLoadResult();
    systemLoggerErrorSpy.mockReset();
    // Replace process.exit with a throwing mock so the awaited call rejects
    // and we can catch it in the test. Real code path is process.exit(1);
    // the throw is a test-only observation trick, not production behavior.
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code}) called`);
      }) as never);
  });

  it("Test 1 — pass path: non-empty spec allows boot (no exit, no error log)", async () => {
    state.loadResult = { ...makeValidLoadResult(), avatarDirectorSpec: "some real spec text" };
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(systemLoggerErrorSpy).not.toHaveBeenCalled();
  });

  it("Test 2 — fail path: missing avatarDirectorSpec key → process.exit(1)", async () => {
    const bad = makeValidLoadResult();
    delete bad.avatarDirectorSpec;
    state.loadResult = bad;
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).rejects.toThrow(/process\.exit\(1\) called/);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("Test 3 — fail path: empty string → process.exit(1)", async () => {
    state.loadResult = { ...makeValidLoadResult(), avatarDirectorSpec: "" };
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).rejects.toThrow(/process\.exit\(1\) called/);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("Test 4 — fail path: whitespace-only string → process.exit(1) (per 74-CONTEXT.md § 'What would make it wrong' §3)", async () => {
    state.loadResult = { ...makeValidLoadResult(), avatarDirectorSpec: "   \n\t  " };
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).rejects.toThrow(/process\.exit\(1\) called/);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("Test 5 — structured log on failure: systemLogger.error called with operation 'branding_config_boot_gate'", async () => {
    state.loadResult = { ...makeValidLoadResult(), avatarDirectorSpec: "" };
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).rejects.toThrow();

    expect(systemLoggerErrorSpy).toHaveBeenCalledTimes(1);
    // systemLogger.error signature: (message, error?, context?)
    const call = systemLoggerErrorSpy.mock.calls[0];
    // message is a fatal / refusing-to-boot string
    expect(String(call[0])).toMatch(/avatarDirectorSpec|refusing to boot|branding\.json/i);
    // context object is arg 3 and carries operation
    const context = call[2] as { operation?: string } | undefined;
    expect(context).toBeDefined();
    expect(context?.operation).toBe("branding_config_boot_gate");
  });

  it("Test 6 — does NOT gate on avatarGammaDefault (per Ashley resolution #5): valid spec + weird gamma still passes", async () => {
    // Sub-case A: sane gamma → passes.
    state.loadResult = {
      ...makeValidLoadResult(),
      avatarDirectorSpec: "valid spec",
      avatarGammaDefault: 0.7,
    };
    let mod = await freshGate();
    await expect(mod.assertBrandingConfigAtBoot()).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    // Reset call log for sub-case B.
    exitSpy.mockClear();
    systemLoggerErrorSpy.mockReset();

    // Sub-case B: nonsense-but-finite gamma → still passes; the boot gate
    // ignores gamma entirely. Trust-the-admin per 74-CONTEXT.md.
    state.loadResult = {
      ...makeValidLoadResult(),
      avatarDirectorSpec: "valid spec",
      avatarGammaDefault: -999,
    };
    mod = await freshGate();
    await expect(mod.assertBrandingConfigAtBoot()).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(systemLoggerErrorSpy).not.toHaveBeenCalled();
  });
});
