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
 *   - Does NOT gate on `avatarGammaDefault` — per user resolution #5
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
  // Phase 82: required at the backend loader boundary — mirror the shape here
  // so the fixture stays valid against the extended BrandingConfig type.
  wipIndicatorPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  // Both fields are declared optional here purely so individual tests can
  // omit them (e.g. Test 2 deletes avatarDirectorSpec entirely). At the
  // real loader boundary these are required strings/numbers — the boot
  // gate must still cope with the "shape violation reached us" defense-in-depth
  // case without crashing on `undefined`.
  avatarDirectorSpec?: unknown;
  avatarGammaDefault?: unknown;
  // Phase 114 (D-01 + D-05): field is required at the loader boundary but
  // declared optional here so Phase 74 tests can omit it without disturbing
  // their existing shape.
  instancePolicyFilename?: unknown;
};

const state: {
  loadResult: LoadResult;
  // Phase 114 (D-11 + D-21): mock return value for readInstancePolicyBytes.
  // Test cases mutate this per-scenario:
  //   - null (default) simulates "file missing / over-cap / containment / read error"
  //   - Buffer simulates "file present + within cap + safe path"
  instancePolicyBytes: Buffer | null;
} = {
  loadResult: makeValidLoadResult(),
  instancePolicyBytes: null,
};

function makeValidLoadResult(): LoadResult {
  return {
    appName: "Skynet",
    shortName: "Skynet",
    iconPath: "/branding/icon.png",
    wordmarkPath: "/branding/wordmark.png",
    faviconPath: "/branding/favicon.svg",
    wipIndicatorPath: "/branding/wip-cube.webp",
    pwaIcons: [
      { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    avatarDirectorSpec: "some real spec text",
    avatarGammaDefault: 0.7,
    // Phase 114 default: empty string = "no twinkie configured" (D-01
    // clean-unset default). Individual T-06 tests override this per case.
    instancePolicyFilename: "",
  };
}

vi.mock("./branding-config-loader.js", () => ({
  loadBrandingConfig: async () => state.loadResult,
  // Phase 114 (D-11): the new never-throws twinkie reader consumed by
  // assert-boot.ts's non-fatal alarm branch. Routed through `state` so
  // individual tests can vary the return value.
  readInstancePolicyBytes: async () => state.instancePolicyBytes,
}));

const systemLoggerErrorSpy = vi.fn();
const sshLoggerErrorSpy = vi.fn();

vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    // Phase 114 (D-05): assert-boot now emits its non-fatal misconfig alarm
    // through sshLogger.error (contrast with Phase 74's fatal branch that
    // uses systemLogger.error before process.exit(1)).
    error: (...args: unknown[]) => sshLoggerErrorSpy(...args),
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
    state.instancePolicyBytes = null;
    systemLoggerErrorSpy.mockReset();
    sshLoggerErrorSpy.mockReset();
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

  it("Test 6 — does NOT gate on avatarGammaDefault (per user resolution #5): valid spec + weird gamma still passes", async () => {
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

  // ─── Phase 114 (D-05, D-21) — non-throwing instance-policy alarm branch ────
  //
  // These tests exercise the NEW branch appended AFTER the Phase 74 fatal
  // gate. Every T-06 test keeps a non-empty avatarDirectorSpec so the Phase 74
  // gate is a no-op — the T-06 tests observe ONLY the Phase 114 alarm branch.
  //
  // Contract under test:
  //   - Empty instancePolicyFilename (default): NO sshLogger.error, NO exit.
  //     Regression guard against future accidental boot gate on the field.
  //   - Field set + resolver returns Buffer: NO sshLogger.error, NO exit.
  //     Clean startup case — the twinkie is well-configured and readable.
  //   - Field set + resolver returns null (missing / over-cap / containment
  //     / read error): sshLogger.error fires with the D-05 message + the
  //     "branding_instance_policy_boot_alarm" operation tag AND process.exit
  //     is NEVER called (non-fatal alarm invariant).
  //   - The Phase 74 fatal gate remains untouched — the "constant one exit
  //     call in the file" invariant is enforced by acceptance_criteria grep,
  //     not this test, but T-06c asserts exitSpy.not.toHaveBeenCalled which
  //     doubly proves the Phase 114 branch is not-a-gate.

  it("Test 7 (T-06a): empty instancePolicyFilename → no alarm, no exit (regression guard against accidental boot gate)", async () => {
    state.loadResult = {
      ...makeValidLoadResult(),
      instancePolicyFilename: "",
    };
    // Even if the resolver were somehow called, its return doesn't matter
    // for an empty filename — but set it to null to prove the guard fires
    // BEFORE any resolver call would need to be interpreted.
    state.instancePolicyBytes = null;
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
    // Guard specifically against the boot-alarm operation firing. Other
    // sshLogger.error calls from unrelated boot paths would be caught by
    // a general `not.toHaveBeenCalled` — but the tighter assertion here
    // scopes the check to THIS phase's alarm shape.
    const bootAlarmCalls = sshLoggerErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation ===
          "branding_instance_policy_boot_alarm",
    );
    expect(bootAlarmCalls).toHaveLength(0);
  });

  it("Test 8 (T-06b): field set + resolver returns Buffer → clean startup, no alarm, no exit", async () => {
    state.loadResult = {
      ...makeValidLoadResult(),
      instancePolicyFilename: "team.md",
    };
    state.instancePolicyBytes = Buffer.from("hello twinkie");
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
    const bootAlarmCalls = sshLoggerErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        (call[1] as { operation?: string }).operation ===
          "branding_instance_policy_boot_alarm",
    );
    expect(bootAlarmCalls).toHaveLength(0);
  });

  it("Test 9 (T-06c): field set + resolver returns null (missing file) → sshLogger.error fires with D-05 shape; NO exit (non-fatal alarm)", async () => {
    state.loadResult = {
      ...makeValidLoadResult(),
      instancePolicyFilename: "team.md",
    };
    state.instancePolicyBytes = null;
    const { assertBrandingConfigAtBoot } = await freshGate();

    // The critical non-fatal-alarm assertion: the function RESOLVES, never
    // rejects — process.exit is not called, no throw.
    await expect(assertBrandingConfigAtBoot()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
    // sshLogger.error should have been called with:
    //   - message containing the field name "'team.md'"
    //   - message containing the resolved path "/etc/skynet/branding/team.md"
    //   - message containing the "no twinkie will be pushed" phrase (from D-05)
    //   - metadata with operation "branding_instance_policy_boot_alarm",
    //     instancePolicyFilename "team.md", resolvedPath "/etc/skynet/branding/team.md"
    expect(sshLoggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("instance-policy field is set to 'team.md'"),
      expect.objectContaining({
        operation: "branding_instance_policy_boot_alarm",
        instancePolicyFilename: "team.md",
        resolvedPath: "/etc/skynet/branding/team.md",
      }),
    );
    const call = sshLoggerErrorSpy.mock.calls.find(
      (c) =>
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as { operation?: string }).operation ===
          "branding_instance_policy_boot_alarm",
    );
    expect(call).toBeDefined();
    const message = String(call?.[0]);
    expect(message).toContain("/etc/skynet/branding/team.md");
    expect(message).toContain("no twinkie will be pushed");
  });

  it("Test 10 (T-06d): field set + over-cap file (resolver returns null identically) → alarm still fires (guards against boot forgetting to alarm on over-cap)", async () => {
    // From the assert-boot caller's view, readInstancePolicyBytes returns
    // null identically for "over-cap" and "missing" — the loader's own
    // sshLogger.error(branding_instance_policy_size) log is separate and
    // fires INSIDE readInstancePolicyBytes (see 112-01-SUMMARY.md § P114-T-03).
    // This test proves the boot alarm still fires when the reason is size —
    // regression guard against a code path that special-cases size vs missing
    // at the caller level and forgets to alarm.
    state.loadResult = {
      ...makeValidLoadResult(),
      instancePolicyFilename: "huge.md",
    };
    // Mock represents "readInstancePolicyBytes returned null because the
    // file was over the 256 KB cap." The size-specific log fired inside
    // the reader is a separate concern (not observable here — the reader
    // is mocked out).
    state.instancePolicyBytes = null;
    const { assertBrandingConfigAtBoot } = await freshGate();

    await expect(assertBrandingConfigAtBoot()).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(sshLoggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("instance-policy field is set to 'huge.md'"),
      expect.objectContaining({
        operation: "branding_instance_policy_boot_alarm",
        instancePolicyFilename: "huge.md",
        resolvedPath: "/etc/skynet/branding/huge.md",
      }),
    );
  });
});
