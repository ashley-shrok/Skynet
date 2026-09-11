/**
 * Phase 79 Plan 03 Task 1 — shared-volume path constants + assertSafeHumanName
 *
 * Covers:
 *   - TG_BRIDGE_STATE_DIR default is "/state"
 *   - TG_BRIDGE_STATE_DIR_OVERRIDE env var replaces the default (test-only, per
 *     Plan 04 Task 1 origin)
 *   - all six path helpers return the expected canonical shape
 *   - traversal input throws (name-guard defends every human/identity-scoped path)
 *   - assertSafeHumanName accepts/rejects per the regex spec
 *
 * The OVERRIDE test uses a helper that sets the env var, then dynamic-imports
 * a FRESH copy of the module (vi.resetModules) so the module-scope
 * `TG_BRIDGE_STATE_DIR` is re-evaluated. Every other test uses the default
 * import (baseline "/state" behavior).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("shared-volume constants (default)", () => {
  beforeEach(() => {
    delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
    vi.resetModules();
  });

  it("TG_BRIDGE_STATE_DIR defaults to '/state'", async () => {
    const mod = await import("./shared-volume.js");
    expect(mod.TG_BRIDGE_STATE_DIR).toBe("/state");
  });

  it("registryPath returns '/state/registry.json'", async () => {
    const { registryPath } = await import("./shared-volume.js");
    expect(registryPath()).toBe("/state/registry.json");
  });

  it("configEnvPath returns '/state/config.env'", async () => {
    const { configEnvPath } = await import("./shared-volume.js");
    expect(configEnvPath()).toBe("/state/config.env");
  });

  it("humanTokenPath('alice') returns '/state/alice.token'", async () => {
    const { humanTokenPath } = await import("./shared-volume.js");
    expect(humanTokenPath("alice")).toBe("/state/alice.token");
  });

  it("humanSincePath('alice') returns '/state/alice.since'", async () => {
    const { humanSincePath } = await import("./shared-volume.js");
    expect(humanSincePath("alice")).toBe("/state/alice.since");
  });

  it("humanTokenDeadPath('alice') returns '/state/alice.token-dead'", async () => {
    const { humanTokenDeadPath } = await import("./shared-volume.js");
    expect(humanTokenDeadPath("alice")).toBe("/state/alice.token-dead");
  });

  it("botTokenFilePath('alexander') returns '/state/alexander.bottoken'", async () => {
    const { botTokenFilePath } = await import("./shared-volume.js");
    expect(botTokenFilePath("alexander")).toBe("/state/alexander.bottoken");
  });
});

describe("TG_BRIDGE_STATE_DIR_OVERRIDE env var (test-only escape hatch)", () => {
  const original = process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
    } else {
      process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = original;
    }
    vi.resetModules();
  });

  it("uses override when set, and all path helpers rebase to it", async () => {
    process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = "/tmp/tg-bridge-test";
    vi.resetModules();

    const {
      TG_BRIDGE_STATE_DIR,
      registryPath,
      humanTokenPath,
      humanSincePath,
      humanTokenDeadPath,
      botTokenFilePath,
      configEnvPath,
    } = await import("./shared-volume.js");

    expect(TG_BRIDGE_STATE_DIR).toBe("/tmp/tg-bridge-test");
    expect(registryPath()).toBe("/tmp/tg-bridge-test/registry.json");
    expect(configEnvPath()).toBe("/tmp/tg-bridge-test/config.env");
    expect(humanTokenPath("alice")).toBe("/tmp/tg-bridge-test/alice.token");
    expect(humanSincePath("alice")).toBe("/tmp/tg-bridge-test/alice.since");
    expect(humanTokenDeadPath("alice")).toBe(
      "/tmp/tg-bridge-test/alice.token-dead",
    );
    expect(botTokenFilePath("alexander")).toBe(
      "/tmp/tg-bridge-test/alexander.bottoken",
    );
  });
});

describe("assertSafeHumanName (guard exported for Plans 04 + 08)", () => {
  beforeEach(() => {
    delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
    vi.resetModules();
  });

  it("accepts single-word lowercase names (alice, zoey, laura)", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("alice")).not.toThrow();
    expect(() => assertSafeHumanName("zoey")).not.toThrow();
    expect(() => assertSafeHumanName("laura")).not.toThrow();
  });

  it("accepts hyphenated and underscored names", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("commander-zoey")).not.toThrow();
    expect(() => assertSafeHumanName("agent_007")).not.toThrow();
    expect(() => assertSafeHumanName("a1b2c3")).not.toThrow();
  });

  it("rejects path traversal input", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("../etc/passwd")).toThrow();
    expect(() => assertSafeHumanName("../foo")).toThrow();
    expect(() => assertSafeHumanName("foo/bar")).toThrow();
  });

  it("rejects names with spaces or shell metachars", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("foo bar")).toThrow();
    expect(() => assertSafeHumanName("foo;rm -rf /")).toThrow();
    expect(() => assertSafeHumanName("foo$bar")).toThrow();
  });

  it("rejects empty string", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("")).toThrow();
  });

  it("rejects names > 64 chars", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    const tooLong = "a".repeat(65);
    expect(() => assertSafeHumanName(tooLong)).toThrow();
  });

  it("rejects names starting with hyphen or underscore", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("-leading-hyphen")).toThrow();
    expect(() => assertSafeHumanName("_leading-underscore")).toThrow();
  });

  it("rejects uppercase letters", async () => {
    const { assertSafeHumanName } = await import("./shared-volume.js");
    expect(() => assertSafeHumanName("Alice")).toThrow();
    expect(() => assertSafeHumanName("ALICE")).toThrow();
  });
});

describe("path helpers refuse traversal (guard applied at every callsite)", () => {
  beforeEach(() => {
    delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
    vi.resetModules();
  });

  it("humanTokenPath('../etc/passwd') throws (does not return /state/../etc/passwd)", async () => {
    const { humanTokenPath } = await import("./shared-volume.js");
    expect(() => humanTokenPath("../etc/passwd")).toThrow();
  });

  it("humanSincePath('../foo') throws", async () => {
    const { humanSincePath } = await import("./shared-volume.js");
    expect(() => humanSincePath("../foo")).toThrow();
  });

  it("humanTokenDeadPath('../foo') throws", async () => {
    const { humanTokenDeadPath } = await import("./shared-volume.js");
    expect(() => humanTokenDeadPath("../foo")).toThrow();
  });

  it("botTokenFilePath('../evil') throws", async () => {
    const { botTokenFilePath } = await import("./shared-volume.js");
    expect(() => botTokenFilePath("../evil")).toThrow();
  });
});

// Phase 83 Plan 03 Task 1 — pendingChatIdPath (mirror shape of humanTokenDeadPath).
// The tg-bridge (Plan 83-01) writes `<agentName>.pending-chat-id` sentinels when
// its poller sees an unknown chat_id; the Skynet reconcile loop (Plan 83-03)
// reads them, persists to telegram_bot_tokens.telegramChatId, and unlinks.
describe("pendingChatIdPath (Plan 83-03: pending chat_id sentinels)", () => {
  beforeEach(() => {
    delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
    vi.resetModules();
  });

  it("SV-01: pendingChatIdPath('alexander') returns '/state/alexander.pending-chat-id'", async () => {
    const { pendingChatIdPath } = await import("./shared-volume.js");
    expect(pendingChatIdPath("alexander")).toBe(
      "/state/alexander.pending-chat-id",
    );
  });

  it("SV-02: pendingChatIdPath('../etc/passwd') throws (path traversal rejected)", async () => {
    const { pendingChatIdPath } = await import("./shared-volume.js");
    expect(() => pendingChatIdPath("../etc/passwd")).toThrow();
  });

  it("SV-03: pendingChatIdPath('Alexander') throws (uppercase rejected)", async () => {
    const { pendingChatIdPath } = await import("./shared-volume.js");
    expect(() => pendingChatIdPath("Alexander")).toThrow();
  });

  it("SV-04: pendingChatIdPath(65-char name) throws (64-char cap)", async () => {
    const { pendingChatIdPath } = await import("./shared-volume.js");
    expect(() => pendingChatIdPath("a".repeat(65))).toThrow();
  });
});
