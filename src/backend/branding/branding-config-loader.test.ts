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
  pwaIcons: [
    { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
  ],
  avatarDirectorSpec: "",
  avatarGammaDefault: 0.7,
};

// Per-test controls: what the mocked async fs returns for the config-file
// stat/read pair. Setting `readError` triggers the loader's error branch.
const state: {
  configJson: unknown | undefined;
  configError: NodeJS.ErrnoException | null;
} = {
  configJson: undefined,
  configError: { code: "ENOENT" } as NodeJS.ErrnoException,
};

vi.mock("node:fs", () => {
  return {
    promises: {
      stat: async () => {
        if (state.configError) throw state.configError;
        return { size: 1024 };
      },
      readFile: async () => {
        if (state.configError) throw state.configError;
        return JSON.stringify(state.configJson);
      },
    },
    readFileSync: () => JSON.stringify(bundledDefaultJson),
  };
});

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
    pwaIcons: [
      {
        src: "/branding/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    avatarDirectorSpec: "the operator's aesthetic director spec",
    avatarGammaDefault: 0.7,
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
});
