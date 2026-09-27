/**
 * resolveAgentHostId tests.
 *
 * The resolver reads IDENTITIES_LOCAL_HOST_IDS at MODULE LOAD, so tests
 * that vary the env var use vi.resetModules() + a fresh dynamic import per
 * scenario. Tests that share the "populated env" branch import once at the
 * top-level and reuse the module.
 *
 * fs/promises is mocked so the disk-existence probe is deterministic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    lstat: vi.fn(),
  },
  lstat: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { lstat as fspLstat } from "fs/promises";
import { databaseLogger } from "../utils/logger.js";

const statMock = fspLstat as unknown as ReturnType<typeof vi.fn>;
const warnSpy = databaseLogger.warn as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Env-populated scenarios — module loaded once with a valid IDENTITIES_LOCAL_HOST_IDS.
// ---------------------------------------------------------------------------

describe("resolveAgentHostId — env populated with a single hostId", () => {
  let resolveAgentHostId: (mxid: string) => Promise<number | null>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("IDENTITIES_LOCAL_HOST_IDS", "42");
    statMock.mockReset();
    warnSpy.mockReset();
    // Re-import after env stub so LOCAL_HOST_IDS parses with the new value.
    const mod = await import("./resolve-agent-host-id.js");
    resolveAgentHostId = mod.resolveAgentHostId;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("well-formed mxid + identity dir exists → returns first local hostId", async () => {
    statMock.mockResolvedValue({ isDirectory: () => true });
    const result = await resolveAgentHostId("@zulu:t1000.example.net");
    expect(result).toBe(42);
    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it("mxid localpart is lowercased before disk lookup", async () => {
    statMock.mockResolvedValue({ isDirectory: () => true });
    await resolveAgentHostId("@Zulu:t1000.example.net");
    const pathArg = statMock.mock.calls[0][0] as string;
    // Path ends with the lowercased localpart, not the original case.
    expect(pathArg.endsWith("/zulu")).toBe(true);
  });

  it("identity dir missing (stat throws ENOENT) → null", async () => {
    statMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const result = await resolveAgentHostId("@ghost:t1000.example.net");
    expect(result).toBeNull();
  });

  it("path exists but is not a directory → null", async () => {
    statMock.mockResolvedValue({ isDirectory: () => false });
    const result = await resolveAgentHostId("@rogue:t1000.example.net");
    expect(result).toBeNull();
  });

  it("malformed mxid (no colon) → null, no disk call", async () => {
    const result = await resolveAgentHostId("@zulu-no-server");
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });

  it("malformed mxid (empty localpart) → null, no disk call", async () => {
    const result = await resolveAgentHostId("@:server.example.net");
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });

  it("mxid with disallowed localpart chars → null, no disk call", async () => {
    // Canonical IDENTITY_KEY_RE only permits `[a-z0-9_-]{1,64}`; anything
    // else is rejected before the disk probe.
    const result = await resolveAgentHostId("@zulu#bad:server.example.net");
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });

  it("mxid with `.` in localpart → null, no disk call (path-traversal defense)", async () => {
    const result = await resolveAgentHostId("@..:server.example.net");
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });

  it("mxid with `/` in localpart → null, no disk call (path-traversal defense)", async () => {
    const result = await resolveAgentHostId("@a/b:server.example.net");
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });

  it("mxid localpart longer than 64 chars → null, no disk call", async () => {
    const longLocalpart = "a".repeat(65);
    const result = await resolveAgentHostId(
      `@${longLocalpart}:server.example.net`,
    );
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });

  it("empty string mxid → null, no disk call", async () => {
    const result = await resolveAgentHostId("");
    expect(result).toBeNull();
    expect(statMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Empty-env scenario — module loaded with IDENTITIES_LOCAL_HOST_IDS unset.
// ---------------------------------------------------------------------------

describe("resolveAgentHostId — IDENTITIES_LOCAL_HOST_IDS empty", () => {
  let resolveAgentHostId: (mxid: string) => Promise<number | null>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("IDENTITIES_LOCAL_HOST_IDS", "");
    statMock.mockReset();
    warnSpy.mockReset();
    const mod = await import("./resolve-agent-host-id.js");
    resolveAgentHostId = mod.resolveAgentHostId;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("well-formed mxid + empty local host id set → null + warn log", async () => {
    const result = await resolveAgentHostId("@zulu:t1000.example.net");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, ctx] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/IDENTITIES_LOCAL_HOST_IDS is empty/);
    expect((ctx as { operation: string }).operation).toBe(
      "resolve_agent_host_id_no_local_hosts",
    );
  });
});

// ---------------------------------------------------------------------------
// Multi-hostId env scenario — first entry wins.
// ---------------------------------------------------------------------------

describe("resolveAgentHostId — multi-entry IDENTITIES_LOCAL_HOST_IDS", () => {
  let resolveAgentHostId: (mxid: string) => Promise<number | null>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("IDENTITIES_LOCAL_HOST_IDS", "42,99,101");
    statMock.mockReset();
    warnSpy.mockReset();
    const mod = await import("./resolve-agent-host-id.js");
    resolveAgentHostId = mod.resolveAgentHostId;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the FIRST entry of IDENTITIES_LOCAL_HOST_IDS", async () => {
    statMock.mockResolvedValue({ isDirectory: () => true });
    const result = await resolveAgentHostId("@zulu:t1000.example.net");
    expect(result).toBe(42);
  });

  it("multi-entry env logs a warn at module load naming the ambiguity", async () => {
    // The module has already loaded via beforeEach's dynamic import — the
    // warn call must have fired then, not on the first resolveAgentHostId
    // invocation.
    const multiWarn = warnSpy.mock.calls.find(([msg]) =>
      String(msg).includes("multiple entries"),
    );
    expect(multiWarn).toBeDefined();
    expect((multiWarn?.[1] as { operation: string }).operation).toBe(
      "resolve_agent_host_id_multi_entry_env",
    );
    expect((multiWarn?.[1] as { count: number }).count).toBe(3);
    expect((multiWarn?.[1] as { chosenHostId: number }).chosenHostId).toBe(
      42,
    );
  });
});
