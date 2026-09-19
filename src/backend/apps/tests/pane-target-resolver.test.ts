/**
 * Phase 120 Plan 02 Task 2 — Unit tests for pane-target-resolver.
 *
 * Verifies the resolver that Wave 3's app-pane-router will call to turn
 * (hostId, host, port) into a ResolvedTarget. Per RESEARCH.md Open
 * Question 1 RESOLVED, the resolver uses the SSH tunnel unconditionally
 * — no local-loopback branch. This test file GREP-ENFORCES the single-
 * code-path invariant via structural assertions (both "local-looking"
 * and "remote" hostIds return usedTunnel: true).
 *
 * Pattern reference: 120-PATTERNS.md § pane-target-resolver,
 * 120-RESEARCH.md § Open Questions Q1 RESOLVED.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Host } from "../../../types/index.js";

/* ------------------------------------------------------------------------ */
/*  Hoisted mocks                                                            */
/* ------------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  // tunnelCache.getOrCreate stub — returns a stub TunnelInstance with a
  // fixed tunnelPort so the return-shape assertions are stable.
  getOrCreate: vi.fn(),
}));

vi.mock("../../serve-url/tunnel-cache.js", () => ({
  tunnelCache: {
    getOrCreate: mocks.getOrCreate,
  },
}));

/* ------------------------------------------------------------------------ */
/*  Helpers                                                                  */
/* ------------------------------------------------------------------------ */

function makeHost(name: string): Host {
  return {
    id: "1",
    name,
    ip: "10.0.0.1",
    username: "app",
  } as unknown as Host;
}

/* ------------------------------------------------------------------------ */
/*  Fixture setup                                                            */
/* ------------------------------------------------------------------------ */

beforeEach(() => {
  vi.resetModules();
  mocks.getOrCreate.mockReset();
  mocks.getOrCreate.mockResolvedValue({
    server: {} as unknown,
    tunnelPort: 12345,
    sshPoolKey: "10.0.0.1:22:app",
  });
});

/* ------------------------------------------------------------------------ */
/*  Q1 RESOLVED — unconditional tunnel path                                  */
/* ------------------------------------------------------------------------ */

describe("resolvePaneTarget — unconditional-tunnel (Q1 RESOLVED)", () => {
  it("resolves through tunnelCache.getOrCreate for a 'local-looking' hostId (usedTunnel: true)", async () => {
    const { resolvePaneTarget } = await import("../pane-target-resolver.js");
    const host = makeHost("t1000"); // "local" — the current Skynet host
    const result = await resolvePaneTarget(1, host, 3001);
    expect(mocks.getOrCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      target: { hostname: "t1000", port: 3001, host },
      tunnelPort: 12345,
      usedTunnel: true,
    });
  });

  it("resolves through tunnelCache.getOrCreate for a 'remote' hostId (usedTunnel: true)", async () => {
    const { resolvePaneTarget } = await import("../pane-target-resolver.js");
    const host = makeHost("remote-box");
    const result = await resolvePaneTarget(42, host, 3001);
    expect(mocks.getOrCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      target: { hostname: "remote-box", port: 3001, host },
      tunnelPort: 12345,
      usedTunnel: true,
    });
  });

  it("produces structurally-identical shape (usedTunnel: true) for BOTH local-looking and remote hostIds — no branching", async () => {
    const { resolvePaneTarget } = await import("../pane-target-resolver.js");
    const localHost = makeHost("t1000");
    const remoteHost = makeHost("remote-box");
    const localResult = await resolvePaneTarget(1, localHost, 3001);
    const remoteResult = await resolvePaneTarget(42, remoteHost, 3001);
    // Both must have the same usedTunnel value (true).
    expect(localResult.usedTunnel).toBe(true);
    expect(remoteResult.usedTunnel).toBe(true);
    // Both invoked the tunnel cache exactly once (total of 2 across both
    // calls) — the second call is NOT skipped by any local-branch bypass.
    expect(mocks.getOrCreate).toHaveBeenCalledTimes(2);
  });

  it("propagates tunnelCache.getOrCreate rejections unchanged (no swallowing)", async () => {
    const { resolvePaneTarget } = await import("../pane-target-resolver.js");
    const err = new Error("no route to host");
    mocks.getOrCreate.mockRejectedValueOnce(err);
    const host = makeHost("dead-box");
    await expect(resolvePaneTarget(9, host, 3001)).rejects.toThrow("no route to host");
  });

  it("passes tunnelCache.getOrCreate the exact ServeTarget shape { hostname, port, host }", async () => {
    const { resolvePaneTarget } = await import("../pane-target-resolver.js");
    const host = makeHost("some-box");
    await resolvePaneTarget(7, host, 4242);
    expect(mocks.getOrCreate).toHaveBeenCalledTimes(1);
    // Deep-equality on the argument — verifies no extra fields are passed
    // and no field is missing.
    expect(mocks.getOrCreate).toHaveBeenCalledWith({
      hostname: "some-box",
      port: 4242,
      host,
    });
  });

  it("returns tunnelPort from the tunnelCache instance (not the upstream app port)", async () => {
    const { resolvePaneTarget } = await import("../pane-target-resolver.js");
    // A tunnelPort different from the upstream app port should surface —
    // guards against a bug where the resolver returns `port` instead of
    // `instance.tunnelPort`.
    mocks.getOrCreate.mockResolvedValueOnce({
      server: {} as unknown,
      tunnelPort: 55555,
      sshPoolKey: "x",
    });
    const host = makeHost("some-box");
    const result = await resolvePaneTarget(3, host, 8080);
    expect(result.tunnelPort).toBe(55555);
    expect(result.tunnelPort).not.toBe(8080);
  });
});
