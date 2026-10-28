/**
 * ssh-connection-pool.test.ts — the pool's wait for a free connection.
 *
 * Coverage:
 *   A — all of a host's connections held: a waiter fails with
 *       SshPoolBusyError after its wait limit instead of hanging, and the
 *       timeout log names who holds the connections
 *   B — a connection handed back while a caller waits goes to that caller
 *   C — a dead free connection whose reconnect fails rejects the caller
 *       instead of leaving it waiting
 *
 * No real SSH: clients are EventEmitters with a fake socket.
 */
import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterAll } from "vitest";
import type { Client } from "ssh2";
import { connectionPool, SshPoolBusyError, withConnection } from "./ssh-connection-pool.js";
import { sshLogger } from "../utils/logger.js";

function fakeClient(): Client & { _sock: { destroyed: boolean; writable: boolean } } {
  const c = new EventEmitter() as unknown as Client & {
    _sock: { destroyed: boolean; writable: boolean };
  };
  c._sock = { destroyed: false, writable: true };
  (c as unknown as { end: () => void }).end = () => {};
  return c;
}

afterAll(() => connectionPool.destroy());

describe("ssh connection pool — waiting for a free connection", () => {
  it("A: fails with SshPoolBusyError when every connection stays held, logging the holders", async () => {
    const key = "test:A";
    const factory = async () => fakeClient();
    for (let i = 0; i < 3; i++) await connectionPool.getConnection(key, factory);

    const warn = vi.spyOn(sshLogger, "warn");
    const started = Date.now();
    await expect(connectionPool.getConnection(key, factory, 300)).rejects.toBeInstanceOf(
      SshPoolBusyError,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);

    const call = warn.mock.calls.find(
      (c) => (c[1] as { operation?: string } | undefined)?.operation === "ssh_pool_wait_timeout",
    );
    expect(call).toBeTruthy();
    const meta = call![1] as { hostKey: string; holders: Array<{ holder: string; heldMs: number }> };
    expect(meta.hostKey).toBe(key);
    expect(meta.holders).toHaveLength(3);
    for (const h of meta.holders) {
      expect(h.holder).toMatch(/ssh-connection-pool\.test\.ts:\d+$/);
      expect(h.heldMs).toBeGreaterThanOrEqual(0);
    }
    warn.mockRestore();
    connectionPool.clearKeyConnections(key);
  });

  it("B: a connection handed back while waiting goes to the waiter", async () => {
    const key = "test:B";
    const factory = async () => fakeClient();
    const held: Client[] = [];
    for (let i = 0; i < 3; i++) held.push(await connectionPool.getConnection(key, factory));

    const waiting = connectionPool.getConnection(key, factory, 2_000);
    setTimeout(() => connectionPool.releaseConnection(key, held[1]), 150);
    await expect(waiting).resolves.toBe(held[1]);
    connectionPool.clearKeyConnections(key);
  });

  it("C: a failed reconnect in place of a dead free connection rejects the caller", async () => {
    const key = "test:C";
    const clients = [fakeClient(), fakeClient(), fakeClient()];
    let n = 0;
    for (let i = 0; i < 3; i++) await connectionPool.getConnection(key, async () => clients[n++]);

    const failing = vi.fn(async (): Promise<Client> => {
      throw new Error("connect refused");
    });
    const waiting = withConnection(key, failing, async () => "never");
    // The freed connection is dead by the time the waiter picks it up.
    clients[0]._sock.destroyed = true;
    connectionPool.releaseConnection(key, clients[0]);
    await expect(waiting).rejects.toThrow("connect refused");
    expect(failing).toHaveBeenCalledTimes(1);
    connectionPool.clearKeyConnections(key);
  });
});
