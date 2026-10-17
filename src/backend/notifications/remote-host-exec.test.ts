/**
 * withRemoteHost tests — exercised through createWithRemoteHost with
 * injected deps, so no DB, crypto, or SSH.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../database/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../distributor/list-substrate-hosts.js", () => ({ listSubstrateHosts: vi.fn() }));
vi.mock("../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));
vi.mock("../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));
vi.mock("../ssh/host-semaphore-registry.js", () => ({ getHostSemaphore: vi.fn() }));

import {
  createWithRemoteHost,
  SYSTEM_CONN_DETAILS_TTL_MS,
  type RemoteHostExecDeps,
} from "./remote-host-exec.js";
import { databaseLogger } from "../utils/logger.js";

const SYS = { ip: "10.0.0.6", username: "ubuntu", key: "k" };

function makeDeps(overrides: Partial<RemoteHostExecDeps> = {}) {
  let clock = 1_000;
  const conn = { end: vi.fn() };
  const deps = {
    listSystemConnDetails: vi.fn(async () => new Map([[6, SYS]])),
    getHostOwnerUserId: vi.fn(async (): Promise<string | null> => "owner"),
    canAccessHost: vi.fn(async () => false),
    // Per-user data key not in memory → the per-user resolver returns null.
    resolveHostById: vi.fn(async (): Promise<unknown> => null),
    connect: vi.fn(async () => conn as never),
    runWithSemaphore: vi.fn(<T>(_h: number, fn: () => Promise<T>) => fn()),
    now: () => clock,
    ...overrides,
  } satisfies RemoteHostExecDeps;
  return { deps, conn, advance: (ms: number) => void (clock += ms) };
}

describe("withRemoteHost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("substrate host + owner, no per-user key → runs over system creds", async () => {
    const { deps, conn } = makeDeps();
    const run = createWithRemoteHost(deps);
    const out = await run(6, "owner", 1000, async () => "found");
    expect(out).toBe("found");
    expect(deps.connect).toHaveBeenCalledWith(SYS, 1000);
    expect(deps.resolveHostById).not.toHaveBeenCalled();
    expect(conn.end).toHaveBeenCalledOnce();
    expect(databaseLogger.debug).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "notifications_remote_host_resolve",
        hostId: 6,
        credSource: "system",
      }),
    );
  });

  it("substrate host + non-owner with a read grant → runs over system creds", async () => {
    const { deps } = makeDeps({ canAccessHost: vi.fn(async () => true) });
    const run = createWithRemoteHost(deps);
    expect(await run(6, "guest", 1000, async () => "ok")).toBe("ok");
    expect(deps.canAccessHost).toHaveBeenCalledWith("guest", 6);
  });

  it("substrate host + user without access → null, never connects (access policy unchanged)", async () => {
    const { deps } = makeDeps();
    const run = createWithRemoteHost(deps);
    expect(await run(6, "stranger", 1000, async () => "x")).toBeNull();
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("unknown host row → null", async () => {
    const { deps } = makeDeps({ getHostOwnerUserId: vi.fn(async () => null) });
    const run = createWithRemoteHost(deps);
    expect(await run(6, "owner", 1000, async () => "x")).toBeNull();
  });

  it("non-substrate host → per-user resolver (credSource user)", async () => {
    const userHost = { ip: "10.0.0.8" };
    const { deps } = makeDeps({ resolveHostById: vi.fn(async () => userHost) });
    const run = createWithRemoteHost(deps);
    expect(await run(8, "owner", 1000, async () => "y")).toBe("y");
    expect(deps.resolveHostById).toHaveBeenCalledWith(8, "owner");
    expect(deps.connect).toHaveBeenCalledWith(userHost, 1000);
    expect(databaseLogger.debug).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ hostId: 8, credSource: "user" }),
    );
  });

  it("caches the substrate snapshot for the TTL", async () => {
    const { deps, advance } = makeDeps();
    const run = createWithRemoteHost(deps);
    await run(6, "owner", 1000, async () => 1);
    await run(6, "owner", 1000, async () => 1);
    expect(deps.listSystemConnDetails).toHaveBeenCalledTimes(1);
    advance(SYSTEM_CONN_DETAILS_TTL_MS + 1);
    await run(6, "owner", 1000, async () => 1);
    expect(deps.listSystemConnDetails).toHaveBeenCalledTimes(2);
  });
});
