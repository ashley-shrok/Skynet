/**
 * Tunnel + SSH-pool isolation between users who share a physical box.
 *
 * A tunnel carries its opener's SSH login. Two users' rows for the same box
 * (same machine_id, same ip/port/username — one possibly with bogus
 * credentials) must never get each other's tunnel or pooled connection.
 */
import { describe, it, expect, vi } from "vitest";
import type { Host } from "../../../types/index.js";

const poolKeys: string[] = [];

vi.mock("../../ssh/ssh-connection-pool.js", async (orig) => {
  const actual = await orig<typeof import("../../ssh/ssh-connection-pool.js")>();
  return {
    hostPoolKey: actual.hostPoolKey,
    getClientBornAt: () => null,
    connectionPool: { markUsed: vi.fn() },
    withConnection: vi.fn(
      async (key: string, _factory: unknown, fn: (c: unknown) => Promise<unknown>) => {
        poolKeys.push(key);
        return fn({});
      },
    ),
  };
});

vi.mock("../../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { tunnelCache } from "../tunnel-cache.js";
import { hostPoolKey } from "../../ssh/ssh-connection-pool.js";

const row = (id: number, userId: string): Host =>
  ({
    id,
    userId,
    machineId: 5,
    name: "box",
    ip: "10.0.0.5",
    port: 22,
    username: "ubuntu",
  }) as unknown as Host;

describe("tunnel cache isolation", () => {
  it("gives two users' rows for the same machine separate tunnels and pool keys", async () => {
    const alice = await tunnelCache.getOrCreate({
      hostname: "box",
      port: 3000,
      host: row(5, "alice"),
    });
    const bob = await tunnelCache.getOrCreate({
      hostname: "box",
      port: 3000,
      host: row(9, "bob"),
    });

    expect(bob.tunnelPort).not.toBe(alice.tunnelPort);
    expect(new Set(poolKeys).size).toBe(2);
    expect(poolKeys).toEqual([
      "alice:10.0.0.5:22:ubuntu",
      "bob:10.0.0.5:22:ubuntu",
    ]);
  });

  it("reuses the tunnel for the same row", async () => {
    const a = await tunnelCache.getOrCreate({ hostname: "box", port: 3001, host: row(5, "alice") });
    const b = await tunnelCache.getOrCreate({ hostname: "x", port: 3001, host: row(5, "alice") });
    expect(b).toBe(a);
  });
});

describe("hostPoolKey", () => {
  it("scopes by owner, and falls back to the row id when the owner is unknown", () => {
    expect(hostPoolKey({ userId: "u1", ip: "h", port: 2222, username: "x" })).toBe("u1:h:2222:x");
    expect(hostPoolKey({ id: 7, ip: "h", username: "x" })).toBe("row7:h:22:x");
  });
});
