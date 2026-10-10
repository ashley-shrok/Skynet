/**
 * Stale-client recovery: the tunnel outlives the SSH client it was built on
 * (the pool's 10-min idle sweep closes it while a long video sits on its
 * read-ahead buffer). The next browser socket must be forwarded over a fresh
 * pooled client instead of failing with a 502.
 */
import net from "node:net";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Host } from "../../../types/index.js";

const clients: unknown[] = [];

vi.mock("../../ssh/ssh-connection-pool.js", async (orig) => {
  const actual = await orig<typeof import("../../ssh/ssh-connection-pool.js")>();
  return {
    hostPoolKey: actual.hostPoolKey,
    getClientBornAt: () => null,
    connectionPool: { markUsed: vi.fn() },
    withConnection: vi.fn(
      async (_key: string, _factory: unknown, fn: (c: unknown) => Promise<unknown>) =>
        fn(clients.shift()),
    ),
  };
});

vi.mock("../../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { tunnelCache } from "../tunnel-cache.js";

type Cb = (err: Error | null, stream: PassThrough) => void;

/** A client whose forwardOut echoes bytes back (PassThrough as the channel). */
const liveClient = () => ({
  _sock: { destroyed: false, writable: true },
  forwardOut: vi.fn((_a: string, _b: number, _c: string, _d: number, cb: Cb) =>
    cb(null, new PassThrough()),
  ),
});

const notConnected = () => {
  throw new Error("Not connected");
};

const row = (id: number): Host =>
  ({ id, userId: "ashley", name: "nasty", ip: "10.0.0.9", port: 22, username: "u" }) as unknown as Host;

function roundTrip(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1", () => s.write("ping"));
    s.once("data", (d) => {
      resolve(d.toString());
      s.destroy();
    });
    s.once("error", reject);
    s.once("close", () => reject(new Error("socket closed without data")));
  });
}

beforeEach(() => {
  clients.length = 0;
});

describe("tunnel cache stale SSH client", () => {
  it("swaps in a fresh client when the captured one's socket has died", async () => {
    const original = liveClient();
    const fresh = liveClient();
    clients.push(original, fresh);

    const t = await tunnelCache.getOrCreate({ hostname: "nasty", port: 9501, host: row(31) });
    expect(await roundTrip(t.tunnelPort)).toBe("ping");
    expect(original.forwardOut).toHaveBeenCalledTimes(1);

    // Pool idle sweep closes the captured client.
    original._sock.destroyed = true;
    original._sock.writable = false;
    original.forwardOut.mockImplementation(notConnected);

    expect(await roundTrip(t.tunnelPort)).toBe("ping");
    expect(original.forwardOut).toHaveBeenCalledTimes(1);
    expect(fresh.forwardOut).toHaveBeenCalledTimes(1);

    // Later sockets keep using the fresh client; the tunnel stays cached.
    expect(await roundTrip(t.tunnelPort)).toBe("ping");
    expect(fresh.forwardOut).toHaveBeenCalledTimes(2);
    expect(await tunnelCache.getOrCreate({ hostname: "nasty", port: 9501, host: row(31) })).toBe(t);
  });

  it("retries on a fresh client when forwardOut throws Not connected on a healthy-looking socket", async () => {
    const original = liveClient();
    original.forwardOut.mockImplementation(notConnected);
    const fresh = liveClient();
    clients.push(original, fresh);

    const t = await tunnelCache.getOrCreate({ hostname: "nasty", port: 9502, host: row(32) });
    expect(await roundTrip(t.tunnelPort)).toBe("ping");
    expect(fresh.forwardOut).toHaveBeenCalledTimes(1);
  });

  it("fails the socket and evicts the tunnel when no fresh client works", async () => {
    const original = liveClient();
    original.forwardOut.mockImplementation(notConnected);
    const alsoDead = liveClient();
    alsoDead.forwardOut.mockImplementation(notConnected);
    clients.push(original, alsoDead);

    const t = await tunnelCache.getOrCreate({ hostname: "nasty", port: 9503, host: row(33) });
    await expect(roundTrip(t.tunnelPort)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));

    const rebuilt = liveClient();
    clients.push(rebuilt);
    const t2 = await tunnelCache.getOrCreate({ hostname: "nasty", port: 9503, host: row(33) });
    expect(t2).not.toBe(t);
    expect(await roundTrip(t2.tunnelPort)).toBe("ping");
  });
});
