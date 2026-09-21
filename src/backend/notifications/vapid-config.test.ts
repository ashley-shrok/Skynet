/**
 * Phase 128 Plan 02 Task 2 — tests for the fail-fast VAPID boot loader.
 *
 * Contract exercised:
 *   - `assertVapidConfigAtBoot()` reads `process.env.VAPID_PUBLIC_KEY /
 *     VAPID_PRIVATE_KEY / VAPID_SUBJECT` and throws a structured Error naming
 *     which env var is missing when ANY is empty / absent.
 *   - The Error thrown on malformed `VAPID_SUBJECT` names the subject and
 *     the accepted shapes. `VAPID_SUBJECT` must match `^(mailto:|https:\/\/)`
 *     (RESEARCH.md § Pitfall 2 — Apple's push service returns 403 otherwise).
 *   - Happy path: three well-formed envs → returns void, emits a
 *     `systemLogger.info` line WITHOUT the private key or the full public key.
 *   - `getVapidDetails()` returns `{subject, publicKey, privateKey}` sourced
 *     from env (never from disk, never from DB — planner's env-var path per
 *     RESEARCH.md § Open Question 1).
 *
 * Test isolation strategy:
 *   - `vi.stubEnv()` / `vi.unstubAllEnvs()` per test — matches vitest's
 *     canonical env-mutation approach and avoids the global-mutation
 *     footgun of assigning to `process.env` directly.
 *   - `vi.mock("../utils/logger.js")` returns a spy-able `systemLogger` so
 *     tests can assert `.info` was called AND that neither key value leaked
 *     into the log payload.
 *
 * These tests are RED-phase: they define the contract before the module
 * exists. The GREEN commit adds src/backend/notifications/vapid-config.ts.
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

// Realistic-shaped VAPID keys (base64url, ES256 P-256). These are throwaway
// values generated only to satisfy shape validation; they never leave this file.
const VALID_PUBLIC_KEY =
  "BNbA6uxUqiPMYo1PVUyzYNCP7lYr50iRfBmb2Qmy2Sd0mUkKlyLB6-9uPeeCH1IknEFCwZs4WIPeJv-DVN3ZBIw";
const VALID_PRIVATE_KEY = "8kFuFwYWk5vY-Y8n5x-Q_kd6TgD1v6mJcQqQm4KtByE";
const VALID_MAILTO_SUBJECT = "mailto:ashley@t1000.taild9b663.ts.net";
const VALID_HTTPS_SUBJECT = "https://t1000.taild9b663.ts.net/";

function setAllValid(subject = VALID_MAILTO_SUBJECT): void {
  vi.stubEnv("VAPID_PUBLIC_KEY", VALID_PUBLIC_KEY);
  vi.stubEnv("VAPID_PRIVATE_KEY", VALID_PRIVATE_KEY);
  vi.stubEnv("VAPID_SUBJECT", subject);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("vapid-config", () => {
  beforeEach(() => {
    vi.resetModules(); // ensure module-scoped memoization (if any) is fresh
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("assertVapidConfigAtBoot", () => {
    it("throws with a structured error naming VAPID_PUBLIC_KEY when it is missing", async () => {
      vi.stubEnv("VAPID_PUBLIC_KEY", "");
      vi.stubEnv("VAPID_PRIVATE_KEY", VALID_PRIVATE_KEY);
      vi.stubEnv("VAPID_SUBJECT", VALID_MAILTO_SUBJECT);

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).toThrow(/VAPID_PUBLIC_KEY/);
    });

    it("throws with a structured error naming VAPID_PRIVATE_KEY when it is missing", async () => {
      vi.stubEnv("VAPID_PUBLIC_KEY", VALID_PUBLIC_KEY);
      vi.stubEnv("VAPID_PRIVATE_KEY", "");
      vi.stubEnv("VAPID_SUBJECT", VALID_MAILTO_SUBJECT);

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).toThrow(/VAPID_PRIVATE_KEY/);
    });

    it("throws with a structured error naming VAPID_SUBJECT when it is missing", async () => {
      vi.stubEnv("VAPID_PUBLIC_KEY", VALID_PUBLIC_KEY);
      vi.stubEnv("VAPID_PRIVATE_KEY", VALID_PRIVATE_KEY);
      vi.stubEnv("VAPID_SUBJECT", "");

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).toThrow(/VAPID_SUBJECT/);
    });

    it("throws when VAPID_SUBJECT is a bare domain (no mailto: or https:// prefix)", async () => {
      // Apple's push service returns 403 for this (Pitfall 2)
      setAllValid("t1000.taild9b663.ts.net");

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).toThrow(/VAPID_SUBJECT/);
      expect(() => assertVapidConfigAtBoot()).toThrow(/mailto:|https:/);
    });

    it("throws when VAPID_SUBJECT is http:// (not https://)", async () => {
      // Only mailto: and https:// are accepted per Pitfall 2.
      setAllValid("http://t1000.taild9b663.ts.net/");

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).toThrow(/VAPID_SUBJECT/);
    });

    it("throws when VAPID_SUBJECT is a bare email (no mailto: prefix)", async () => {
      setAllValid("ashley@t1000.taild9b663.ts.net");

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).toThrow(/VAPID_SUBJECT/);
    });

    it("returns void on the happy path with a mailto: subject", async () => {
      setAllValid(VALID_MAILTO_SUBJECT);

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).not.toThrow();
      expect(assertVapidConfigAtBoot()).toBeUndefined();
    });

    it("returns void on the happy path with an https:// subject", async () => {
      setAllValid(VALID_HTTPS_SUBJECT);

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");

      expect(() => assertVapidConfigAtBoot()).not.toThrow();
    });

    it("emits an info log naming successful load WITHOUT the private key or full public key", async () => {
      setAllValid(VALID_MAILTO_SUBJECT);

      const { assertVapidConfigAtBoot } = await import("./vapid-config.js");
      const { systemLogger } = await import("../utils/logger.js");

      assertVapidConfigAtBoot();

      expect(systemLogger.info).toHaveBeenCalledTimes(1);
      const [message, context] = (systemLogger.info as ReturnType<typeof vi.fn>).mock.calls[0];

      // Message should mention VAPID load success
      expect(message).toMatch(/VAPID|vapid/);

      // Neither the private key nor the full public key should appear anywhere
      const rendered = JSON.stringify({ message, context });
      expect(rendered).not.toContain(VALID_PRIVATE_KEY);
      expect(rendered).not.toContain(VALID_PUBLIC_KEY);
    });
  });

  describe("getVapidDetails", () => {
    it("returns {subject, publicKey, privateKey} sourced from env", async () => {
      setAllValid(VALID_MAILTO_SUBJECT);

      const { getVapidDetails } = await import("./vapid-config.js");

      const details = getVapidDetails();
      expect(details).toEqual({
        subject: VALID_MAILTO_SUBJECT,
        publicKey: VALID_PUBLIC_KEY,
        privateKey: VALID_PRIVATE_KEY,
      });
    });

    it("throws (or refuses to return) if any env var is missing at call time", async () => {
      vi.stubEnv("VAPID_PUBLIC_KEY", "");
      vi.stubEnv("VAPID_PRIVATE_KEY", VALID_PRIVATE_KEY);
      vi.stubEnv("VAPID_SUBJECT", VALID_MAILTO_SUBJECT);

      const { getVapidDetails } = await import("./vapid-config.js");

      // Contract: getVapidDetails cannot silently return partial config;
      // callers (push-sender.ts) depend on all three fields being valid.
      expect(() => getVapidDetails()).toThrow(/VAPID_PUBLIC_KEY/);
    });
  });
});
