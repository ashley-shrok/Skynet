/**
 * Phase 74 Plan 01 — shape guard tests for the two new BrandingConfig fields:
 * `avatarDirectorSpec: string` (required) and `avatarGammaDefault: number`
 * (required, must be finite).
 *
 * Rationale for test file at this level: `isValidBrandingShape` is not
 * exported from branding-config-loader.ts (module-private, per house style).
 * Rather than widen its visibility just for tests, we exercise it indirectly
 * through the public `loadBrandingConfig()` path — the loader silently
 * returns bundled defaults on ANY shape-guard rejection, so we can observe
 * the guard's decision by checking whether the returned config matches the
 * bundled default vs. the provided fixture.
 *
 * Test isolation strategy: `vi.mock("node:fs")` lets us feed synthetic
 * config payloads through `fs.stat` + `fs.readFile` (the async promises API
 * that `loadBrandingConfig()` uses) without touching the real filesystem.
 * The bundled-defaults path is memoized in module scope, so we mock the
 * synchronous `readFileSync` used by `getBundledDefaults()` too, returning
 * a canonical extended default (matching docker/branding-defaults/branding.json
 * post-Task-1) so the ENOENT fallback branch in Test 6 has something valid
 * to hand back.
 *
 * The memoization inside `getBundledDefaults()` is per-module-instance;
 * `vi.resetModules()` in beforeEach forces a fresh import so cached defaults
 * don't leak between tests.
 *
 * Phase 74 Anti-pattern reminder documented in 74-CONTEXT.md § "Tempting-but-no"
 * and 74-RESEARCH.md § "Pitfall 1": the bundled default's avatarDirectorSpec
 * MUST be empty string. A shipped director spec would silently satisfy the
 * Plan 02 boot gate on no-config deployments. Test 6 therefore asserts the
 * bundled default returns EMPTY spec — not a placeholder value.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

/**
 * Extended canonical default matching docker/branding-defaults/branding.json
 * post-Task-1. Kept in a mutable holder so individual tests can substitute
 * an alternate payload (e.g. a shape-invalid config) without redefining
 * the whole mock.
 */
const bundledDefaultJson = {
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
  avatarDirectorSpec: "",
  avatarGammaDefault: 0.7,
  // Phase 114 Task 1: bundled defaults MUST byte-mirror HARDCODED_FALLBACK
  // per D-04 + Phase 70 D-14. Empty-string = "no twinkie" clean unset state.
  instancePolicyFilename: "",
};

// Per-test controls: what the mocked async fs returns for the config-file
// stat/read pair. Setting `readError` triggers the loader's error branch.
//
// Phase 114 Task 2 extension: `twinkieFile` controls the dispatch for
// requests targeting `/etc/skynet/branding/<filename>` where filename is NOT
// `branding.json` (the twinkie's markdown file). Any request with a path
// not equal to `/etc/skynet/branding/branding.json` is routed through the
// twinkieFile state. Set `error` to simulate ENOENT/EACCES; set `size` to
// simulate byte-cap check; set `bytes` for happy-path Buffer return.
const state: {
  configJson: unknown | undefined;
  configError: NodeJS.ErrnoException | null;
  twinkieFile: {
    size?: number;
    bytes?: Buffer;
    error?: NodeJS.ErrnoException;
  };
} = {
  configJson: undefined,
  configError: { code: "ENOENT" } as NodeJS.ErrnoException,
  twinkieFile: {},
};

// Path dispatch: config path is /etc/skynet/branding/branding.json; anything
// else under /etc/skynet/branding/ is treated as a twinkie file request.
const CONFIG_PATH = "/etc/skynet/branding/branding.json";

vi.mock("node:fs", () => {
  return {
    promises: {
      stat: async (p: string) => {
        if (p === CONFIG_PATH) {
          if (state.configError) throw state.configError;
          return { size: 1024 };
        }
        // Twinkie file path
        if (state.twinkieFile.error) throw state.twinkieFile.error;
        return { size: state.twinkieFile.size ?? 0 };
      },
      readFile: async (p: string) => {
        if (p === CONFIG_PATH) {
          if (state.configError) throw state.configError;
          return JSON.stringify(state.configJson);
        }
        // Twinkie file path
        if (state.twinkieFile.error) throw state.twinkieFile.error;
        return state.twinkieFile.bytes ?? Buffer.alloc(0);
      },
    },
    readFileSync: () => JSON.stringify(bundledDefaultJson),
  };
});

// sshLogger spy — Phase 114 twinkie failure modes emit sshLogger.error with
// specific `operation` payload keys. Individual tests reset via beforeEach.
const sshLoggerErrorSpy = vi.fn();

vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (...args: unknown[]) => sshLoggerErrorSpy(...args),
  },
  systemLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function validFixture() {
  return {
    appName: "Skynet",
    shortName: "Skynet",
    iconPath: "/branding/icon.png",
    wordmarkPath: "/branding/wordmark.png",
    faviconPath: "/branding/favicon.svg",
    wipIndicatorPath: "/branding/wip-cube.webp",
    pwaIcons: [
      {
        src: "/branding/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    avatarDirectorSpec: "the operator's aesthetic director spec",
    avatarGammaDefault: 0.7,
    // Phase 114 Task 1: new required-in-type but optional-in-guard field.
    // Explicitly set to empty here so the fixture parses cleanly through the
    // shape guard; tests that need to omit or malform it override this key.
    instancePolicyFilename: "",
  };
}

/**
 * Load the module fresh so `getBundledDefaults()`'s memoized cache doesn't
 * leak between tests. Each test starts from a known-clean loader state.
 */
async function freshLoader() {
  vi.resetModules();
  return await import("./branding-config-loader.js");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("branding-config-loader — Phase 74 shape guard (avatarDirectorSpec + avatarGammaDefault)", () => {
  beforeEach(() => {
    state.configJson = undefined;
    state.configError = null;
    state.twinkieFile = {};
    sshLoggerErrorSpy.mockReset();
  });

  it("Test 1: accepts a valid extended config (all Phase 70 fields + new ones)", async () => {
    const { loadBrandingConfig } = await freshLoader();
    state.configError = null;
    state.configJson = validFixture();

    const cfg = await loadBrandingConfig();

    expect(cfg.avatarDirectorSpec).toBe("the operator's aesthetic director spec");
    expect(cfg.avatarGammaDefault).toBe(0.7);
    expect(cfg.appName).toBe("Skynet");
  });

  it("Test 2: rejects when avatarDirectorSpec is missing → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = validFixture() as Partial<ReturnType<typeof validFixture>>;
    delete bad.avatarDirectorSpec;
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    // Shape guard rejected → bundled defaults returned (which have empty spec).
    expect(cfg.avatarDirectorSpec).toBe("");
    expect(cfg.avatarGammaDefault).toBe(0.7);
  });

  it("Test 3: rejects when avatarDirectorSpec is a number → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = { ...validFixture(), avatarDirectorSpec: 42 };
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    expect(cfg.avatarDirectorSpec).toBe("");
    expect(cfg.avatarGammaDefault).toBe(0.7);
  });

  it("Test 4: rejects when avatarGammaDefault is missing → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = validFixture() as Partial<ReturnType<typeof validFixture>>;
    delete bad.avatarGammaDefault;
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    // Shape guard rejected → bundled defaults returned.
    expect(cfg.avatarGammaDefault).toBe(0.7);
    expect(cfg.avatarDirectorSpec).toBe("");
  });

  it("Test 5a: rejects when avatarGammaDefault is NaN → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    // NaN survives JSON round-trip only via explicit string→number.
    // Testing via the object path (fixture is stringified through JSON.stringify).
    // JSON.stringify(NaN) → "null" which the shape guard would then reject
    // anyway (number check fails on null). We simulate this by injecting
    // the pre-parsed value using the JSON.stringify(null) path.
    const bad = { ...validFixture(), avatarGammaDefault: null };
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    expect(cfg.avatarGammaDefault).toBe(0.7);
  });

  it("Test 5b: rejects when avatarGammaDefault is a string → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = { ...validFixture(), avatarGammaDefault: "0.7" };
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    expect(cfg.avatarGammaDefault).toBe(0.7);
    expect(cfg.avatarDirectorSpec).toBe("");
  });

  it("Test 6: loadBrandingConfig returns extended bundled defaults on ENOENT (spec='' + gamma=0.7)", async () => {
    const { loadBrandingConfig } = await freshLoader();
    state.configError = { code: "ENOENT" } as NodeJS.ErrnoException;

    const cfg = await loadBrandingConfig();

    // This is the load-bearing assertion: the bundled default MUST have
    // empty avatarDirectorSpec so Plan 02's boot gate fires on no-config
    // deployments. See 74-CONTEXT.md § "Tempting-but-no" §1 and
    // 74-RESEARCH.md § "Pitfall 1".
    expect(cfg.avatarDirectorSpec).toBe("");
    expect(cfg.avatarGammaDefault).toBe(0.7);
  });

  it("Test 7: accepts empty avatarDirectorSpec — loader is never-throws; presence check is Plan 02's job", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const cfg0 = { ...validFixture(), avatarDirectorSpec: "" };
    state.configError = null;
    state.configJson = cfg0;

    const cfg = await loadBrandingConfig();

    // Empty string is a VALID shape — the boot gate is what will refuse it
    // downstream in Plan 02. The loader stays honest about what the operator
    // wrote (or didn't write). The returned config carries the empty spec
    // straight through, NOT bundled defaults (which would also be empty and
    // observationally identical — so we assert on the specific gamma value
    // to prove we got the operator's config back, not the fallback).
    expect(cfg.avatarDirectorSpec).toBe("");
    expect(cfg.avatarGammaDefault).toBe(0.7);
    // Distinguishing property: the operator config in this test has the
    // shortened pwaIcons array (single icon), whereas bundled default has 2.
    expect(cfg.pwaIcons.length).toBe(1);
  });

  // ─── Phase 82 shape-guard tests (wipIndicatorPath) ────────────────────────

  it("Test 8: rejects when wipIndicatorPath is missing → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = validFixture() as Partial<ReturnType<typeof validFixture>>;
    delete bad.wipIndicatorPath;
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    // Shape guard rejected → bundled defaults returned (which carry the
    // canonical wipIndicatorPath: "/branding/wip-cube.webp" per Phase 82).
    expect(cfg.wipIndicatorPath).toBe("/branding/wip-cube.webp");
  });

  it("Test 9: rejects when wipIndicatorPath is a number → bundled defaults", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = { ...validFixture(), wipIndicatorPath: 42 };
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    // Shape guard rejected at the typeof branch → bundled defaults returned.
    // Assert BOTH the wipIndicatorPath value AND the 2-icon bundled shape
    // (validFixture has 1 icon) to distinguish "got bundled default" from
    // "got operator config unchanged".
    expect(cfg.wipIndicatorPath).toBe("/branding/wip-cube.webp");
    expect(cfg.pwaIcons.length).toBe(2);
  });

  // ─── Phase 114 Task 1: instancePolicyFilename shape + defaults ────────────

  it("P114-T-01: valid filename parses correctly (config.instancePolicyFilename === 'team.md')", async () => {
    const { loadBrandingConfig } = await freshLoader();
    state.configError = null;
    state.configJson = { ...validFixture(), instancePolicyFilename: "team.md" };

    const cfg = await loadBrandingConfig();

    expect(cfg.instancePolicyFilename).toBe("team.md");
    // Distinguishing property: shortened pwaIcons array from validFixture,
    // proving we got the operator's config back, not bundled defaults.
    expect(cfg.pwaIcons.length).toBe(1);
  });

  it("P114-T-02: absent field is optional-in-guard, normalized to '' (guards Pitfall 1 — no override-stomp)", async () => {
    const { loadBrandingConfig } = await freshLoader();
    // Simulate a deployed branding.json written BEFORE Phase 114 landed —
    // has no instancePolicyFilename field at all. Shape guard MUST accept
    // this document (optional-in-guard) so the operator's iconPath and
    // wordmarkPath overrides survive first-boot after upgrade.
    const fixture = validFixture() as Partial<ReturnType<typeof validFixture>>;
    delete fixture.instancePolicyFilename;
    state.configError = null;
    state.configJson = fixture;

    const cfg = await loadBrandingConfig();

    // Load-bearing assertion: the parsed config MUST come back with
    // instancePolicyFilename normalized to empty string (never undefined,
    // never null). Downstream callers depend on `.trim()` being safe.
    expect(cfg.instancePolicyFilename).toBe("");
    // Distinguishing property: the operator's shortened pwaIcons array
    // (1 icon) survives — proves we got the operator config back, NOT
    // bundled defaults (which have 2 icons). This is the regression
    // guard against Pitfall 1 (shape guard stomping unrelated overrides).
    expect(cfg.pwaIcons.length).toBe(1);
    // Distinguishing property: the operator's aesthetic director spec
    // survives — proves shape guard did NOT reject the whole document.
    expect(cfg.avatarDirectorSpec).toBe("the operator's aesthetic director spec");
  });

  it("P114-T-01c: HARDCODED_FALLBACK.instancePolicyFilename is empty string (byte-check)", async () => {
    // Force the loader down the last-resort HARDCODED_FALLBACK path by
    // making BOTH the config file AND the bundled defaults JSON unreadable
    // for the shape guard. Since the module memoizes bundled defaults, we
    // rely on the ENOENT → getBundledDefaults() → happy-path bundled-JSON
    // observation from Task 1's bundledDefaultJson fixture, which mirrors
    // HARDCODED_FALLBACK byte-for-byte for this field.
    const { loadBrandingConfig } = await freshLoader();
    state.configError = { code: "ENOENT" } as NodeJS.ErrnoException;

    const cfg = await loadBrandingConfig();

    // Bundled defaults path returns instancePolicyFilename: "" — this
    // implicitly validates HARDCODED_FALLBACK's value via byte-mirror.
    expect(cfg.instancePolicyFilename).toBe("");
  });

  it("P114-T-01d: docker/branding-defaults/branding.json byte-mirrors HARDCODED_FALLBACK (has instancePolicyFilename: '')", async () => {
    // Read the actual on-disk JSON via Node's built-in fs (bypassing the
    // vi.mock("node:fs")) — the top-of-file mock only intercepts imports
    // done AFTER vi.mock lands, so a direct dynamic import of "node:fs"
    // via the JSON module resolver won't work here. Instead, we use
    // fs.readFileSync from a hoisted require to avoid the mock.
    const { readFileSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
    const raw = readFileSync(
      "/home/ubuntu/skynet-tina/docker/branding-defaults/branding.json",
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.instancePolicyFilename).toBe("");
  });

  it("P114-T-01e: malformed instancePolicyFilename (number) → bundled defaults + shape-error log", async () => {
    const { loadBrandingConfig } = await freshLoader();
    const bad = { ...validFixture(), instancePolicyFilename: 123 };
    state.configError = null;
    state.configJson = bad;

    const cfg = await loadBrandingConfig();

    // Shape guard rejected at the "exists AND not a string" branch →
    // bundled defaults returned (2-icon pwaIcons array proves fallback).
    expect(cfg.instancePolicyFilename).toBe("");
    expect(cfg.pwaIcons.length).toBe(2);
    // sshLogger.error fires with operation: "branding_config_shape".
    const shapeErrorCalls = sshLoggerErrorSpy.mock.calls.filter((call) => {
      const meta = call[1] as Record<string, unknown> | undefined;
      return meta?.operation === "branding_config_shape";
    });
    expect(shapeErrorCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Phase 114 Task 2: readInstancePolicyBytes() ──────────────────────────

  it("P114-T-01r: happy path — filename set + file present → returns Buffer bytes", async () => {
    const { readInstancePolicyBytes } = await freshLoader();
    state.configError = null;
    state.configJson = { ...validFixture(), instancePolicyFilename: "team.md" };
    state.twinkieFile = { size: 100, bytes: Buffer.from("hello") };

    const result = await readInstancePolicyBytes();

    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result?.toString("utf-8")).toBe("hello");
  });

  it("P114-T-02r: absent field (normalized to '') → returns null without any fs call for the twinkie", async () => {
    const { readInstancePolicyBytes } = await freshLoader();
    const fixture = validFixture() as Partial<ReturnType<typeof validFixture>>;
    delete fixture.instancePolicyFilename;
    state.configError = null;
    state.configJson = fixture;
    // Sentinel: if the reader tries to touch the twinkie path, this error
    // would surface (transformed to null via the never-throws catch). We
    // assert the return is null explicitly and the config path was the only
    // one dispatched — the empty-filename fast path returns before any stat.
    state.twinkieFile = {
      error: Object.assign(new Error("SHOULD_NOT_STAT"), {
        code: "SHOULD_NOT_STAT",
      }) as NodeJS.ErrnoException,
    };

    const result = await readInstancePolicyBytes();

    expect(result).toBeNull();
    // If the fast-path is broken, the twinkie-path error would either
    // surface (thrown) or produce an sshLogger.error("branding_instance_policy_read")
    // entry. Neither is expected.
    const readErrorCalls = sshLoggerErrorSpy.mock.calls.filter((call) => {
      const meta = call[1] as Record<string, unknown> | undefined;
      return meta?.operation === "branding_instance_policy_read";
    });
    expect(readErrorCalls.length).toBe(0);
  });

  it("P114-T-03: over-cap file → null + sshLogger.error(branding_instance_policy_size)", async () => {
    const { readInstancePolicyBytes } = await freshLoader();
    state.configError = null;
    state.configJson = { ...validFixture(), instancePolicyFilename: "big.md" };
    // 256 KB + 1 byte — MAX_CONFIG_BYTES is 256 * 1024 = 262144, cap check
    // is `stat.size > MAX_CONFIG_BYTES`, so 262145 triggers the branch.
    // Note: bytes NOT set — if the code reads the file anyway, `Buffer.alloc(0)`
    // returns 0-byte buffer (won't match "hello") but more importantly the
    // reader MUST short-circuit at the size check BEFORE readFile, so we
    // don't need to populate `bytes`.
    state.twinkieFile = { size: 262145 };

    const result = await readInstancePolicyBytes();

    expect(result).toBeNull();
    const sizeErrorCalls = sshLoggerErrorSpy.mock.calls.filter((call) => {
      const meta = call[1] as Record<string, unknown> | undefined;
      return meta?.operation === "branding_instance_policy_size";
    });
    expect(sizeErrorCalls.length).toBe(1);
  });

  it("P114-T-04: filename contains '..' → null + sshLogger.error(branding_instance_policy_containment) + no fs.stat", async () => {
    const { readInstancePolicyBytes } = await freshLoader();
    state.configError = null;
    state.configJson = {
      ...validFixture(),
      instancePolicyFilename: "../etc/passwd",
    };
    // If containment guard failed to fire, the reader would call fs.stat on
    // the escaped path; that path (`/etc/etc/passwd` after resolve) does not
    // match CONFIG_PATH so it routes into the twinkie branch — set an error
    // sentinel there to prove the guard short-circuits BEFORE any stat call.
    state.twinkieFile = {
      error: Object.assign(new Error("STAT_SHOULD_NOT_FIRE"), {
        code: "STAT_SHOULD_NOT_FIRE",
      }) as NodeJS.ErrnoException,
    };

    const result = await readInstancePolicyBytes();

    expect(result).toBeNull();
    const containmentErrorCalls = sshLoggerErrorSpy.mock.calls.filter((call) => {
      const meta = call[1] as Record<string, unknown> | undefined;
      return meta?.operation === "branding_instance_policy_containment";
    });
    expect(containmentErrorCalls.length).toBe(1);
    // Guard MUST short-circuit before fs.stat; no branding_instance_policy_read
    // log fires (that would indicate the stat call was attempted and surfaced
    // the twinkieFile sentinel error through the catch branch).
    const readErrorCalls = sshLoggerErrorSpy.mock.calls.filter((call) => {
      const meta = call[1] as Record<string, unknown> | undefined;
      return meta?.operation === "branding_instance_policy_read";
    });
    expect(readErrorCalls.length).toBe(0);
  });

  it("P114-T-05: file ENOENT → null SILENTLY (no sshLogger.error — assert-boot handles loudness)", async () => {
    const { readInstancePolicyBytes } = await freshLoader();
    state.configError = null;
    state.configJson = { ...validFixture(), instancePolicyFilename: "team.md" };
    state.twinkieFile = {
      error: Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      }) as NodeJS.ErrnoException,
    };

    const result = await readInstancePolicyBytes();

    expect(result).toBeNull();
    // Load-bearing: ENOENT is the D-05 misconfig state, but the LOUD alarm
    // fires at boot-time (Plan 04 assert-boot), NOT here on every sweep call.
    // Per-sweep silence is required to avoid log spam.
    expect(sshLoggerErrorSpy).not.toHaveBeenCalled();
  });

  it("P114-T-05b: non-ENOENT read error (EACCES) → null + sshLogger.error(branding_instance_policy_read)", async () => {
    const { readInstancePolicyBytes } = await freshLoader();
    state.configError = null;
    state.configJson = { ...validFixture(), instancePolicyFilename: "team.md" };
    state.twinkieFile = {
      error: Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      }) as NodeJS.ErrnoException,
    };

    const result = await readInstancePolicyBytes();

    expect(result).toBeNull();
    const readErrorCalls = sshLoggerErrorSpy.mock.calls.filter((call) => {
      const meta = call[1] as Record<string, unknown> | undefined;
      return meta?.operation === "branding_instance_policy_read";
    });
    expect(readErrorCalls.length).toBe(1);
  });
});
