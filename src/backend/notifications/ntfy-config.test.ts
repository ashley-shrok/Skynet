/**
 * Phase 144 Plan 01 Task 4 — tests for the ntfy boot-time config assertion module.
 *
 * Contract exercised:
 *   - `assertNtfyConfigAtBoot()` reads SKYNET_PUBLIC_URL, NTFY_PUBLISH_TOKEN,
 *     NTFY_ADMIN_USER, NTFY_ADMIN_PASS from `process.env` and throws a structured
 *     Error naming the offender on any failure.
 *   - SKYNET_PUBLIC_URL must be present AND start with "https://" (rejects http://
 *     and bare hostnames — Pitfall 4 from RESEARCH.md).
 *   - Returns void on the happy path; emits a systemLogger.info line WITHOUT
 *     leaking credential values.
 *   - `getNtfyBaseUrl()` returns `${SKYNET_PUBLIC_URL}/ntfy` with no doubled slash
 *     when SKYNET_PUBLIC_URL already has a trailing slash (Pitfall 7).
 *   - `getNtfyInternalPublishUrl()` returns the literal "http://ntfy:2586" (internal
 *     Docker network — never traverses the public internet).
 *   - `getNtfyPublishToken()`, `getNtfyAdminUser()`, `getNtfyAdminPassword()` return
 *     respective env values trimmed of surrounding whitespace.
 *
 * Test isolation:
 *   - `vi.stubEnv()` / `vi.unstubAllEnvs()` per test (vitest's canonical env approach).
 *   - `vi.mock("../utils/logger.js")` for spy-able systemLogger.
 *   - `vi.resetModules()` in beforeEach to ensure module-scope memoization (if any)
 *     is fresh.
 *
 * Tests:
 *   NC-01: happy path — all required envs present + https:// URL → returns void
 *   NC-02: throws containing "SKYNET_PUBLIC_URL" when missing
 *   NC-03: throws containing "SKYNET_PUBLIC_URL" when value does not start with https://
 *   NC-04: throws containing "NTFY_PUBLISH_TOKEN" when missing/empty
 *   NC-05: throws containing "NTFY_ADMIN_USER" when missing/empty
 *   NC-06: throws containing "NTFY_ADMIN_PASS" when missing/empty
 *   NC-07: getNtfyBaseUrl() strips trailing slash → no doubled slash in result
 *   NC-08: getNtfyInternalPublishUrl() returns "http://ntfy:2586"
 *   NC-09: getter functions return trimmed env values
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_PUBLIC_URL = "https://example.com";
const VALID_PUBLISH_TOKEN = "tk_abc1234567890abcdef12345678901";
const VALID_ADMIN_USER = "skynet-admin";
const VALID_ADMIN_PASS = "supersecret-plaintext-password";

function setAllValid(overrides: Partial<{
  SKYNET_PUBLIC_URL: string;
  NTFY_PUBLISH_TOKEN: string;
  NTFY_ADMIN_USER: string;
  NTFY_ADMIN_PASS: string;
}> = {}): void {
  vi.stubEnv("SKYNET_PUBLIC_URL", overrides.SKYNET_PUBLIC_URL ?? VALID_PUBLIC_URL);
  vi.stubEnv("NTFY_PUBLISH_TOKEN", overrides.NTFY_PUBLISH_TOKEN ?? VALID_PUBLISH_TOKEN);
  vi.stubEnv("NTFY_ADMIN_USER", overrides.NTFY_ADMIN_USER ?? VALID_ADMIN_USER);
  vi.stubEnv("NTFY_ADMIN_PASS", overrides.NTFY_ADMIN_PASS ?? VALID_ADMIN_PASS);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ntfy-config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("assertNtfyConfigAtBoot", () => {
    // NC-01: happy path — all required envs present + valid https:// URL
    it("NC-01: returns void when all required env vars are present and SKYNET_PUBLIC_URL is https://", async () => {
      setAllValid();
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).not.toThrow();
      expect(assertNtfyConfigAtBoot()).toBeUndefined();
    });

    // NC-02: throws containing "SKYNET_PUBLIC_URL" when missing
    it("NC-02: throws containing 'SKYNET_PUBLIC_URL' when SKYNET_PUBLIC_URL is missing", async () => {
      vi.stubEnv("SKYNET_PUBLIC_URL", "");
      vi.stubEnv("NTFY_PUBLISH_TOKEN", VALID_PUBLISH_TOKEN);
      vi.stubEnv("NTFY_ADMIN_USER", VALID_ADMIN_USER);
      vi.stubEnv("NTFY_ADMIN_PASS", VALID_ADMIN_PASS);

      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).toThrow(/SKYNET_PUBLIC_URL/);
    });

    // NC-03: throws containing "SKYNET_PUBLIC_URL" when value is not https://
    it("NC-03: throws containing 'SKYNET_PUBLIC_URL' when URL is http:// (not https://)", async () => {
      setAllValid({ SKYNET_PUBLIC_URL: "http://example.com" });
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).toThrow(/SKYNET_PUBLIC_URL/);
    });

    it("NC-03b: throws containing 'SKYNET_PUBLIC_URL' when URL is a bare hostname (no scheme)", async () => {
      setAllValid({ SKYNET_PUBLIC_URL: "example.com" });
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).toThrow(/SKYNET_PUBLIC_URL/);
    });

    // NC-04: throws containing "NTFY_PUBLISH_TOKEN" when missing/empty
    it("NC-04: throws containing 'NTFY_PUBLISH_TOKEN' when NTFY_PUBLISH_TOKEN is missing", async () => {
      setAllValid({ NTFY_PUBLISH_TOKEN: "" });
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).toThrow(/NTFY_PUBLISH_TOKEN/);
    });

    // NC-05: throws containing "NTFY_ADMIN_USER" when missing/empty
    it("NC-05: throws containing 'NTFY_ADMIN_USER' when NTFY_ADMIN_USER is missing", async () => {
      setAllValid({ NTFY_ADMIN_USER: "" });
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).toThrow(/NTFY_ADMIN_USER/);
    });

    // NC-06: throws containing "NTFY_ADMIN_PASS" when missing/empty
    it("NC-06: throws containing 'NTFY_ADMIN_PASS' when NTFY_ADMIN_PASS is missing", async () => {
      setAllValid({ NTFY_ADMIN_PASS: "" });
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      expect(() => assertNtfyConfigAtBoot()).toThrow(/NTFY_ADMIN_PASS/);
    });

    it("emits a systemLogger.info line on happy path without credential values", async () => {
      setAllValid();
      const { assertNtfyConfigAtBoot } = await import("./ntfy-config.js");
      const { systemLogger } = await import("../utils/logger.js");

      assertNtfyConfigAtBoot();

      expect(systemLogger.info).toHaveBeenCalledTimes(1);
      const [message, context] = (systemLogger.info as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(message).toMatch(/ntfy/i);

      // No credential values should appear in the log payload
      const rendered = JSON.stringify({ message, context });
      expect(rendered).not.toContain(VALID_PUBLISH_TOKEN);
      expect(rendered).not.toContain(VALID_ADMIN_PASS);
    });
  });

  describe("getNtfyBaseUrl", () => {
    // NC-07: no doubled slash when SKYNET_PUBLIC_URL has trailing slash
    it("NC-07: strips trailing slash from SKYNET_PUBLIC_URL before appending /ntfy", async () => {
      setAllValid({ SKYNET_PUBLIC_URL: "https://example.com/" });
      const { getNtfyBaseUrl } = await import("./ntfy-config.js");

      const result = getNtfyBaseUrl();

      expect(result).toBe("https://example.com/ntfy");
      // Defensive: exactly one slash between host and ntfy
      expect(result).not.toContain("//ntfy");
    });

    it("works without a trailing slash (normal case)", async () => {
      setAllValid({ SKYNET_PUBLIC_URL: "https://example.com" });
      const { getNtfyBaseUrl } = await import("./ntfy-config.js");

      const result = getNtfyBaseUrl();
      expect(result).toBe("https://example.com/ntfy");
    });
  });

  describe("getNtfyInternalPublishUrl", () => {
    // NC-08: returns the literal internal Docker network URL
    it("NC-08: returns 'http://ntfy:2586' (internal Docker network, never public)", async () => {
      setAllValid();
      const { getNtfyInternalPublishUrl } = await import("./ntfy-config.js");

      const result = getNtfyInternalPublishUrl();
      expect(result).toBe("http://ntfy:2586");
    });
  });

  describe("getter functions", () => {
    // NC-09: getters return trimmed env values
    it("NC-09: getNtfyPublishToken returns trimmed NTFY_PUBLISH_TOKEN", async () => {
      setAllValid({ NTFY_PUBLISH_TOKEN: `  ${VALID_PUBLISH_TOKEN}  ` });
      const { getNtfyPublishToken } = await import("./ntfy-config.js");

      expect(getNtfyPublishToken()).toBe(VALID_PUBLISH_TOKEN);
    });

    it("NC-09: getNtfyAdminUser returns trimmed NTFY_ADMIN_USER", async () => {
      setAllValid({ NTFY_ADMIN_USER: `  ${VALID_ADMIN_USER}  ` });
      const { getNtfyAdminUser } = await import("./ntfy-config.js");

      expect(getNtfyAdminUser()).toBe(VALID_ADMIN_USER);
    });

    it("NC-09: getNtfyAdminPassword returns trimmed NTFY_ADMIN_PASS", async () => {
      setAllValid({ NTFY_ADMIN_PASS: `  ${VALID_ADMIN_PASS}  ` });
      const { getNtfyAdminPassword } = await import("./ntfy-config.js");

      expect(getNtfyAdminPassword()).toBe(VALID_ADMIN_PASS);
    });
  });
});
