/**
 * resolveRemoteAgentHostId tests — exercised through
 * createRemoteAgentHostIdResolver with injected deps, so no DB or SSH.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../database/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));
vi.mock("../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));
vi.mock("../ssh/tmux-helper.js", () => ({ execCommand: vi.fn() }));

import {
  createRemoteAgentHostIdResolver,
  REMOTE_HOST_ID_HIT_TTL_MS,
  REMOTE_HOST_ID_MISS_TTL_MS,
  type RemoteAgentHostIdDeps,
} from "./resolve-remote-agent-host-id.js";

const USER = "user-1";
const MXID = "@vesper:matrix.example";

function makeDeps(onHosts: Record<number, string[]>, candidates = Object.keys(onHosts).map(Number)) {
  let clock = 1_000_000;
  const deps = {
    listCandidateHostIds: vi.fn(async () => candidates),
    probeHost: vi.fn(async (hostId: number, _userId: string, localpart: string) =>
      (onHosts[hostId] ?? []).includes(localpart),
    ),
    now: () => clock,
  } satisfies RemoteAgentHostIdDeps;
  return { deps, advance: (ms: number) => { clock += ms; } };
}

describe("resolveRemoteAgentHostId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("identity on a peer host → that hostId", async () => {
    const { deps } = makeDeps({ 7: ["other"], 9: ["vesper"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(MXID, USER)).toBe(9);
    expect(deps.probeHost).toHaveBeenCalledWith(9, USER, "vesper");
  });

  it("localpart is lowercased before probing", async () => {
    const { deps } = makeDeps({ 9: ["vesper"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve("@Vesper:matrix.example", USER)).toBe(9);
  });

  it("identity on no host → null", async () => {
    const { deps } = makeDeps({ 7: ["other"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(MXID, USER)).toBeNull();
  });

  it("multiple matching hosts → lowest hostId wins", async () => {
    const { deps } = makeDeps({ 12: ["vesper"], 5: ["vesper"] }, [12, 5]);
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(MXID, USER)).toBe(5);
  });

  it("a probe that throws counts as not-found, other hosts still match", async () => {
    const { deps } = makeDeps({ 9: ["vesper"] }, [3, 9]);
    deps.probeHost.mockImplementation(async (hostId: number) => {
      if (hostId === 3) throw new Error("ssh down");
      return hostId === 9;
    });
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(MXID, USER)).toBe(9);
  });

  it("candidate list failure → null", async () => {
    const { deps } = makeDeps({});
    deps.listCandidateHostIds.mockRejectedValue(new Error("db down"));
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(MXID, USER)).toBeNull();
  });

  it.each([
    ["no colon", "vesper"],
    ["empty localpart", "@:matrix.example"],
    ["shell metacharacters", "@ves$(id):matrix.example"],
    ["dot in localpart", "@ves.per:matrix.example"],
    ["slash in localpart", "@ves/per:matrix.example"],
  ])("malformed mxid (%s) → null, no probe", async (_label, mxid) => {
    const { deps } = makeDeps({ 9: ["vesper"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(mxid, USER)).toBeNull();
    expect(deps.listCandidateHostIds).not.toHaveBeenCalled();
    expect(deps.probeHost).not.toHaveBeenCalled();
  });

  it("hit is cached until REMOTE_HOST_ID_HIT_TTL_MS elapses", async () => {
    const { deps, advance } = makeDeps({ 9: ["vesper"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    await resolve(MXID, USER);
    advance(REMOTE_HOST_ID_HIT_TTL_MS - 1);
    expect(await resolve(MXID, USER)).toBe(9);
    expect(deps.listCandidateHostIds).toHaveBeenCalledTimes(1);
    advance(1);
    await resolve(MXID, USER);
    expect(deps.listCandidateHostIds).toHaveBeenCalledTimes(2);
  });

  it("miss is cached until REMOTE_HOST_ID_MISS_TTL_MS elapses", async () => {
    const { deps, advance } = makeDeps({ 9: [] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    expect(await resolve(MXID, USER)).toBeNull();
    advance(REMOTE_HOST_ID_MISS_TTL_MS - 1);
    expect(await resolve(MXID, USER)).toBeNull();
    expect(deps.probeHost).toHaveBeenCalledTimes(1);
    advance(1);
    await resolve(MXID, USER);
    expect(deps.probeHost).toHaveBeenCalledTimes(2);
  });

  it("cache is scoped per user", async () => {
    const { deps } = makeDeps({ 9: ["vesper"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    await resolve(MXID, USER);
    await resolve(MXID, "user-2");
    expect(deps.probeHost).toHaveBeenCalledWith(9, USER, "vesper");
    expect(deps.probeHost).toHaveBeenCalledWith(9, "user-2", "vesper");
  });

  it("concurrent lookups for the same key share one probe", async () => {
    const { deps } = makeDeps({ 9: ["vesper"] });
    const resolve = createRemoteAgentHostIdResolver(deps);
    const [a, b] = await Promise.all([resolve(MXID, USER), resolve(MXID, USER)]);
    expect(a).toBe(9);
    expect(b).toBe(9);
    expect(deps.listCandidateHostIds).toHaveBeenCalledTimes(1);
  });
});
