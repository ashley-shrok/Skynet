import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: stub, sshLogger: stub };
});

import {
  createScanOrchestrator,
  type ScanOrchestratorDeps,
} from "./scan-orchestrator.js";
import { createResponseWriter } from "./host-io.js";
import type { HostRequestIo } from "./host-io.js";

const host = (id: string) => ({ id, name: `h${id}`, _connDetails: {} });
const claimed = [{ uuid: "0b5c2f9e-1a2b-4c3d-8e9f-001122334455", body: "{}" }];
const flush = () => new Promise((r) => setTimeout(r, 0));

function deps(overrides: Partial<ScanOrchestratorDeps> = {}) {
  const timeouts: Array<() => void> = [];
  const io = (label: string): HostRequestIo => ({
    claim: vi.fn(async () => (label === "empty" ? [] : claimed)),
    readAttachment: vi.fn(async () => "missing" as const),
  });
  const d: ScanOrchestratorDeps = {
    listSubstrateHosts: vi.fn(async () => [host("1"), host("2")]),
    acquireChannel: vi.fn(async () => ({ exec: vi.fn() })),
    isLocalHostId: (n) => n === 1,
    sshIo: vi.fn(() => io("ssh")),
    localIo: vi.fn(() => io("local")),
    intake: vi.fn(async () => {}),
    setInterval: vi.fn(() => 0 as unknown as ReturnType<typeof setInterval>),
    clearInterval: vi.fn(),
    setTimeout: vi.fn((fn: () => void) => {
      timeouts.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }),
    clearTimeout: vi.fn(),
    ...overrides,
  };
  return { d, timeouts };
}

describe("agent-services scan orchestrator", () => {
  it("reads the local host through the bind mount and others over SSH", async () => {
    const { d } = deps();
    await createScanOrchestrator(d).start();
    await flush();
    expect(d.localIo).toHaveBeenCalledOnce();
    expect(d.acquireChannel).toHaveBeenCalledOnce();
    expect(d.acquireChannel).toHaveBeenCalledWith(host("2"));
    expect(d.intake).toHaveBeenCalledTimes(2);
    expect(vi.mocked(d.intake).mock.calls.map((c) => c[0])).toEqual([
      { id: "1", idNum: 1 },
      { id: "2", idNum: 2 },
    ]);
  });

  it("skips intake when nothing was claimed, and hosts whose SSH acquire fails", async () => {
    const { d } = deps({
      acquireChannel: vi.fn(async () => null),
      localIo: () => ({
        claim: async () => [],
        readAttachment: async () => "missing" as const,
      }),
    });
    await createScanOrchestrator(d).start();
    await flush();
    expect(d.sshIo).not.toHaveBeenCalled();
    expect(d.intake).not.toHaveBeenCalled();
  });

  it("does not stack scans on a slow host, and the timeout releases the guard", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const { d, timeouts } = deps({
      listSubstrateHosts: vi.fn(async () => [host("2")]),
      intake: vi.fn(() => slow),
    });
    const orch = createScanOrchestrator(d);
    await orch.start();
    const tick = vi.mocked(d.setInterval).mock.calls[0][0];
    await flush();

    await tick(); // host 2 still in flight
    await flush();
    expect(d.acquireChannel).toHaveBeenCalledTimes(1);

    timeouts[0](); // scan timeout fires
    await tick();
    await flush();
    expect(d.acquireChannel).toHaveBeenCalledTimes(2);
    release();
  });

  it("survives a host-list failure and stops cleanly", async () => {
    const { d } = deps({
      listSubstrateHosts: vi.fn(async () => Promise.reject(new Error("db"))),
    });
    const orch = createScanOrchestrator(d);
    await expect(orch.start()).resolves.toBeUndefined();
    orch.stop();
    expect(d.clearInterval).toHaveBeenCalledOnce();
  });
});

describe("response writer", () => {
  function writerDeps(local: boolean) {
    const calls: string[] = [];
    const conn = { end: vi.fn() };
    return {
      calls,
      conn,
      deps: {
        isLocalHostId: () => local,
        getHostOwnerUserId: vi.fn(async () => "owner"),
        resolveHostById: vi.fn(async () => ({ ip: "10.0.0.1" })),
        connect: vi.fn(async () => conn as never),
        writeTextAtomic: vi.fn(
          async (c: unknown, p: string) =>
            void calls.push(`text ${c ? "ssh" : "local"} ${p}`),
        ),
        writeBinaryAtomic: vi.fn(
          async (c: unknown, p: string) =>
            void calls.push(`bin ${c ? "ssh" : "local"} ${p}`),
        ),
      },
    };
  }

  it("writes outputs before the response, over one SSH connection", async () => {
    const w = writerDeps(false);
    await createResponseWriter(w.deps)(
      5,
      "u",
      [{ filename: "u.out.0.png", bytes: Buffer.from("x") }],
      "u.response.json",
      "{}",
    );
    expect(w.calls).toEqual([
      "bin ssh $HOME/fleet/service-requests/u.out.0.png",
      "text ssh $HOME/fleet/service-requests/u.response.json",
    ]);
    expect(w.deps.resolveHostById).toHaveBeenCalledWith(5, "owner");
    expect(w.deps.connect).toHaveBeenCalledOnce();
    expect(w.conn.end).toHaveBeenCalledOnce();
  });

  it("writes locally without SSH for the local host", async () => {
    const w = writerDeps(true);
    await createResponseWriter(w.deps)(1, "u", [], "u.response.json", "{}");
    expect(w.calls).toEqual([
      "text local $HOME/fleet/service-requests/u.response.json",
    ]);
    expect(w.deps.connect).not.toHaveBeenCalled();
  });

  it("never throws when the write fails", async () => {
    const w = writerDeps(false);
    w.deps.writeTextAtomic.mockRejectedValueOnce(new Error("sftp"));
    await expect(
      createResponseWriter(w.deps)(5, "u", [], "u.response.json", "{}"),
    ).resolves.toBeUndefined();
    expect(w.conn.end).toHaveBeenCalledOnce();
  });
});
