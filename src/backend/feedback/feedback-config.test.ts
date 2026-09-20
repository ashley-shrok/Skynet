/**
 * Phase 121 Plan 01 — vitest coverage for feedback-config.ts.
 *
 * Test discipline mirrors the never-throws contract of branding-config-loader.ts:
 * every case (a) snapshots process.env, (b) mutates env for the case,
 * (c) calls loadFeedbackConfig(), (d) asserts on getFeedbackConfig(),
 * (e) restores process.env in afterEach.
 *
 * Coverage maps to CONTEXT.md D-01, D-02, D-04, D-05, D-06, D-07 + threats
 * T-121-01 (INCLUDE_CONTENT default OFF), T-121-03 (no password in logs),
 * T-121-04 (never throws on hostile env).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sshLogger } from "../utils/logger.js";
import {
  loadFeedbackConfig,
  getFeedbackConfig,
  type FeedbackConfig,
} from "./feedback-config.js";

const FEEDBACK_ENV_KEYS = [
  "FEEDBACK_SMTP_HOST",
  "FEEDBACK_SMTP_PORT",
  "FEEDBACK_SMTP_USER",
  "FEEDBACK_SMTP_PASSWORD",
  "FEEDBACK_SMTP_FROM",
  "FEEDBACK_TO_ADDRESS",
  "FEEDBACK_INCLUDE_CONTENT",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of FEEDBACK_ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of FEEDBACK_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function clearFeedbackEnv(): void {
  for (const k of FEEDBACK_ENV_KEYS) delete process.env[k];
}

function setValidEnv(): void {
  process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
  process.env.FEEDBACK_SMTP_PORT = "587";
  process.env.FEEDBACK_SMTP_USER = "user@example.com";
  process.env.FEEDBACK_SMTP_PASSWORD = "hunter2";
  process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
  process.env.FEEDBACK_TO_ADDRESS = "ops@example.com";
  process.env.FEEDBACK_INCLUDE_CONTENT = "1";
}

describe("feedback-config", () => {
  let envSnap: Record<string, string | undefined>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearFeedbackEnv();
    // Also blow away the module cache — loadFeedbackConfig re-populates on
    // each call, but getFeedbackConfig's "not_yet_loaded" default only fires
    // when the module was never loaded in this process. Since vitest runs
    // multiple test cases in the same process, we rely on loadFeedbackConfig
    // being called explicitly per case rather than a per-case module reset.
    infoSpy = vi.spyOn(sshLogger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    restoreEnv(envSnap);
    infoSpy.mockRestore();
  });

  describe("D-06 required-set enablement", () => {
    it("all seven env vars missing → after load → disabled, reason mentions FEEDBACK_SMTP_HOST", () => {
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) expect(cfg.reason).toContain("FEEDBACK_SMTP_HOST");
    });

    it("HOST present, PORT missing → disabled, reason mentions FEEDBACK_SMTP_PORT", () => {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) expect(cfg.reason).toContain("FEEDBACK_SMTP_PORT");
    });

    it("HOST + PORT present, TO_ADDRESS missing → disabled, reason mentions FEEDBACK_TO_ADDRESS", () => {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      process.env.FEEDBACK_SMTP_PORT = "587";
      process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) expect(cfg.reason).toContain("FEEDBACK_TO_ADDRESS");
    });

    it("HOST + PORT + FROM + TO present, USER + PASSWORD both missing → enabled (anonymous relay, D-04)", () => {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      process.env.FEEDBACK_SMTP_PORT = "25";
      process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
      process.env.FEEDBACK_TO_ADDRESS = "ops@example.com";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) {
        expect(cfg.smtp.user).toBe("");
        expect(cfg.smtp.password).toBe("");
        expect(cfg.toAddress).toBe("ops@example.com");
      }
    });

    it("USER set but PASSWORD missing → disabled, reason mentions both must be set together (D-04 pairing)", () => {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      process.env.FEEDBACK_SMTP_PORT = "587";
      process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
      process.env.FEEDBACK_TO_ADDRESS = "ops@example.com";
      process.env.FEEDBACK_SMTP_USER = "user@example.com";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) {
        expect(cfg.reason).toContain("FEEDBACK_SMTP_USER");
        expect(cfg.reason).toContain("FEEDBACK_SMTP_PASSWORD");
      }
    });

    it("PASSWORD set but USER missing → disabled, reason mentions both must be set together (D-04 pairing)", () => {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      process.env.FEEDBACK_SMTP_PORT = "587";
      process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
      process.env.FEEDBACK_TO_ADDRESS = "ops@example.com";
      process.env.FEEDBACK_SMTP_PASSWORD = "hunter2";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) {
        expect(cfg.reason).toContain("FEEDBACK_SMTP_USER");
        expect(cfg.reason).toContain("FEEDBACK_SMTP_PASSWORD");
      }
    });

    it("all seven present with valid values → enabled fully populated", () => {
      setValidEnv();
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) {
        expect(cfg.smtp.host).toBe("smtp.example.com");
        expect(cfg.smtp.port).toBe(587);
        expect(cfg.smtp.user).toBe("user@example.com");
        expect(cfg.smtp.password).toBe("hunter2");
        expect(cfg.smtp.fromAddress).toBe("noreply@example.com");
        expect(cfg.toAddress).toBe("ops@example.com");
        expect(cfg.includeContent).toBe(true);
      }
    });
  });

  describe("PORT validation (D-06 numeric 1-65535)", () => {
    function setBase(): void {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
      process.env.FEEDBACK_TO_ADDRESS = "ops@example.com";
    }

    it('PORT="abc" → disabled with FEEDBACK_SMTP_PORT reason', () => {
      setBase();
      process.env.FEEDBACK_SMTP_PORT = "abc";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) expect(cfg.reason).toContain("FEEDBACK_SMTP_PORT");
    });

    it('PORT="99999" → disabled with 1-65535 range hint', () => {
      setBase();
      process.env.FEEDBACK_SMTP_PORT = "99999";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) expect(cfg.reason).toContain("1-65535");
    });

    it('PORT="0" → disabled with 1-65535 range hint', () => {
      setBase();
      process.env.FEEDBACK_SMTP_PORT = "0";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);
      if (!cfg.enabled) expect(cfg.reason).toContain("1-65535");
    });

    it('PORT="587" → parsed as numeric 587 in cfg', () => {
      setBase();
      process.env.FEEDBACK_SMTP_PORT = "587";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) expect(cfg.smtp.port).toBe(587);
    });
  });

  describe("trimming discipline (Pitfall 4)", () => {
    it("HOST leading/trailing whitespace → trimmed", () => {
      setValidEnv();
      process.env.FEEDBACK_SMTP_HOST = "  smtp.example.com  ";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) expect(cfg.smtp.host).toBe("smtp.example.com");
    });

    it("PASSWORD value NOT trimmed (Pitfall 4)", () => {
      setValidEnv();
      process.env.FEEDBACK_SMTP_PASSWORD = "  hunter2  ";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) expect(cfg.smtp.password).toBe("  hunter2  ");
    });
  });

  describe("FEEDBACK_INCLUDE_CONTENT parser (D-02, T-121-01 default OFF)", () => {
    function setBase(): void {
      process.env.FEEDBACK_SMTP_HOST = "smtp.example.com";
      process.env.FEEDBACK_SMTP_PORT = "587";
      process.env.FEEDBACK_SMTP_FROM = "noreply@example.com";
      process.env.FEEDBACK_TO_ADDRESS = "ops@example.com";
    }

    it("unset → includeContent=false (T-121-01)", () => {
      setBase();
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) expect(cfg.includeContent).toBe(false);
    });

    it('"1" → includeContent=true', () => {
      setBase();
      process.env.FEEDBACK_INCLUDE_CONTENT = "1";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      if (cfg.enabled) expect(cfg.includeContent).toBe(true);
    });

    it('"true" → includeContent=true', () => {
      setBase();
      process.env.FEEDBACK_INCLUDE_CONTENT = "true";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      if (cfg.enabled) expect(cfg.includeContent).toBe(true);
    });

    it('"TRUE" (case-insensitive) → includeContent=true', () => {
      setBase();
      process.env.FEEDBACK_INCLUDE_CONTENT = "TRUE";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      if (cfg.enabled) expect(cfg.includeContent).toBe(true);
    });

    it('"yes" → includeContent=true', () => {
      setBase();
      process.env.FEEDBACK_INCLUDE_CONTENT = "yes";
      loadFeedbackConfig();
      const cfg = getFeedbackConfig();
      if (cfg.enabled) expect(cfg.includeContent).toBe(true);
    });

    it.each(["0", "false", "no", "", "off", "nope"])(
      '"%s" → includeContent=false',
      (val) => {
        setBase();
        process.env.FEEDBACK_INCLUDE_CONTENT = val;
        loadFeedbackConfig();
        const cfg = getFeedbackConfig();
        if (cfg.enabled) expect(cfg.includeContent).toBe(false);
      },
    );
  });

  describe("never-throws contract (D-07 + T-121-04)", () => {
    it("loadFeedbackConfig() called twice does NOT throw and re-populates cached", () => {
      // First: nothing set → disabled
      expect(() => loadFeedbackConfig()).not.toThrow();
      let cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(false);

      // Now set full env and call again — must re-populate with new values.
      setValidEnv();
      expect(() => loadFeedbackConfig()).not.toThrow();
      cfg = getFeedbackConfig();
      expect(cfg.enabled).toBe(true);
      if (cfg.enabled) {
        expect(cfg.smtp.host).toBe("smtp.example.com");
      }
    });

    it("loadFeedbackConfig() never throws even when process.env is hostile (Proxy that throws on get — T-121-04)", () => {
      // Node's real process.env rejects accessor descriptors, so we can't
      // install a getter directly on process.env. Instead, temporarily
      // replace process.env with a Proxy that throws on every property
      // access. loadFeedbackConfig must swallow and yield disabled.
      const origEnv = process.env;
      const hostileEnv = new Proxy(
        {},
        {
          get(): never {
            throw new Error("hostile env access");
          },
          has(): boolean {
            return true;
          },
          ownKeys(): string[] {
            return [];
          },
          getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
            return undefined;
          },
        },
      );
      try {
        // Casting through unknown because process.env has a strict type but
        // the Proxy honors the shape at runtime.
        (process as unknown as { env: NodeJS.ProcessEnv }).env =
          hostileEnv as unknown as NodeJS.ProcessEnv;
        expect(() => loadFeedbackConfig()).not.toThrow();
        // Restore before we call getFeedbackConfig so any log or assertion
        // machinery sees a normal env.
        (process as unknown as { env: NodeJS.ProcessEnv }).env = origEnv;
        const cfg = getFeedbackConfig();
        expect(cfg.enabled).toBe(false);
      } finally {
        (process as unknown as { env: NodeJS.ProcessEnv }).env = origEnv;
      }
    });
  });

  describe("structured logging (T-121-03 no password leak)", () => {
    it("sshLogger.info called exactly once per loadFeedbackConfig() with operation:feedback_config_load and enabled boolean", () => {
      setValidEnv();
      loadFeedbackConfig();
      // Filter to just calls with operation=feedback_config_load
      const relevantCalls = infoSpy.mock.calls.filter((call) => {
        const ctx = call[1] as Record<string, unknown> | undefined;
        return ctx?.operation === "feedback_config_load";
      });
      expect(relevantCalls.length).toBe(1);
      const ctx = relevantCalls[0][1] as Record<string, unknown>;
      expect(typeof ctx.enabled).toBe("boolean");
      expect(ctx.enabled).toBe(true);
    });

    it("log payload NEVER contains the password value (T-121-03)", () => {
      setValidEnv();
      process.env.FEEDBACK_SMTP_PASSWORD = "SUPER-SECRET-SENTINEL";
      loadFeedbackConfig();
      for (const call of infoSpy.mock.calls) {
        const ctx = call[1] as Record<string, unknown> | undefined;
        if (ctx === undefined) continue;
        const serialized = JSON.stringify(ctx);
        expect(serialized).not.toContain("SUPER-SECRET-SENTINEL");
        // Explicit belt: no key called `password` should appear.
        expect(ctx).not.toHaveProperty("password");
      }
      // Also check the message string didn't leak the password.
      for (const call of infoSpy.mock.calls) {
        const msg = call[0] as string;
        expect(msg).not.toContain("SUPER-SECRET-SENTINEL");
      }
    });

    it("disabled-branch log carries operation:feedback_config_load and enabled=false + reason", () => {
      loadFeedbackConfig();
      const relevantCalls = infoSpy.mock.calls.filter((call) => {
        const ctx = call[1] as Record<string, unknown> | undefined;
        return ctx?.operation === "feedback_config_load";
      });
      expect(relevantCalls.length).toBe(1);
      const ctx = relevantCalls[0][1] as Record<string, unknown>;
      expect(ctx.enabled).toBe(false);
      expect(typeof ctx.reason).toBe("string");
    });
  });

  describe("type discriminant safety", () => {
    it("FeedbackConfig discriminated union narrows on `enabled`", () => {
      setValidEnv();
      loadFeedbackConfig();
      const cfg: FeedbackConfig = getFeedbackConfig();
      if (cfg.enabled) {
        // TS narrowing: these fields exist on the enabled branch.
        expect(cfg.smtp).toBeDefined();
        expect(cfg.toAddress).toBeDefined();
      } else {
        // TS narrowing: reason field exists on the disabled branch.
        expect(cfg.reason).toBeDefined();
      }
    });
  });
});
