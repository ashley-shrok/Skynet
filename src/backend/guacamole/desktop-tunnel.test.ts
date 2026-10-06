// @vitest-environment node
/**
 * desktop-tunnel: probe → listen on guacd's route → forward through SSH.
 *
 * Real sockets on loopback. A fake guacd listens on 127.0.0.2 (Linux routes
 * all of 127/8 to lo), so the probe sees guacd at 127.0.0.2 and us at
 * 127.0.0.1 — which lets the test tell "guacd" connections (sourced from
 * 127.0.0.2) apart from anyone else's. The SSH client is a stub whose
 * forwardOut opens a plain TCP connection to a local echo server standing in
 * for VNC.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import net from "node:net";
import { EventEmitter } from "node:events";
import type { Client as SSHClient } from "ssh2";

vi.mock("../utils/logger.js", () => {
  const l = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { guacLogger: l };
});

const {
  getDesktopTunnel,
  probeGuacdRoute,
  closeAllDesktopTunnels,
  openDesktopTunnelCount,
} = await import("./desktop-tunnel.js");

const GUACD_ADDR = "127.0.0.2";
let guacd: net.Server;
let guacdPort = 0;
let echo: net.Server;
let echoPort = 0;

function listen(server: net.Server, host: string): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, host, () =>
      resolve((server.address() as net.AddressInfo).port),
    ),
  );
}

/** ssh2-shaped stub: forwardOut dials the given port on loopback. */
function stubSsh(): SSHClient & { forwards: number[] } {
  const em = new EventEmitter() as EventEmitter & {
    forwards: number[];
    forwardOut: unknown;
    end: () => void;
  };
  em.forwards = [];
  em.forwardOut = (
    _sa: string,
    _sp: number,
    dstAddr: string,
    dstPort: number,
    cb: (e: Error | null, s?: net.Socket) => void,
  ) => {
    em.forwards.push(dstPort);
    const s = net.connect({ host: dstAddr, port: dstPort }, () => cb(null, s));
    s.once("error", (e) => cb(e));
  };
  em.end = () => em.emit("close");
  return em as unknown as SSHClient & { forwards: number[] };
}

/** Connect to the tunnel as guacd would (sourced from guacd's address) and round-trip a message. */
function roundTrip(
  host: string,
  port: number,
  localAddress: string,
  msg: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port, localAddress }, () => s.write(msg));
    let got = "";
    s.on("data", (b) => {
      got += b.toString();
      if (got.length >= msg.length) {
        s.end();
        resolve(got);
      }
    });
    s.on("close", () => resolve(got));
    s.on("error", reject);
  });
}

beforeAll(async () => {
  guacd = net.createServer((s) => s.destroy());
  guacdPort = await listen(guacd, GUACD_ADDR);
  echo = net.createServer((s) => s.pipe(s));
  echoPort = await listen(echo, "127.0.0.1");
});

afterAll(() => {
  guacd.close();
  echo.close();
});

afterEach(() => closeAllDesktopTunnels());

describe("probeGuacdRoute", () => {
  it("reports our address on guacd's route and guacd's own address", async () => {
    const route = await probeGuacdRoute({ host: GUACD_ADDR, port: guacdPort });
    expect(route.guacdAddress).toBe(GUACD_ADDR);
    expect(route.localAddress).toMatch(/^127\./);
  });

  it("rejects with guacd_unreachable when nothing listens", async () => {
    const closed = net.createServer();
    const port = await listen(closed, "127.0.0.1");
    closed.close();
    await expect(probeGuacdRoute({ host: "127.0.0.1", port })).rejects.toThrow(
      "guacd_unreachable",
    );
  });
});

describe("getDesktopTunnel", () => {
  it("forwards guacd's connections to the VNC port through SSH", async () => {
    const ssh = stubSsh();
    const t = await getDesktopTunnel(
      "h1:alice:16000",
      async () => ssh,
      echoPort,
      { host: GUACD_ADDR, port: guacdPort },
    );
    expect(await roundTrip(t.host, t.port, GUACD_ADDR, "RFB hello")).toBe(
      "RFB hello",
    );
    expect(ssh.forwards).toEqual([echoPort]);
  });

  it("refuses connections that don't come from guacd", async () => {
    const ssh = stubSsh();
    const t = await getDesktopTunnel(
      "h1:alice:16000",
      async () => ssh,
      echoPort,
      { host: GUACD_ADDR, port: guacdPort },
    );
    // Sourced from 127.0.0.1 (not guacd's 127.0.0.2): dropped before any forward.
    expect(await roundTrip(t.host, t.port, "127.0.0.1", "sneaky")).toBe("");
    expect(ssh.forwards).toEqual([]);
  });

  it("reuses one tunnel (and one SSH connection) per desktop", async () => {
    const connect = vi.fn(async () => stubSsh());
    const g = { host: GUACD_ADDR, port: guacdPort };
    const [a, b] = await Promise.all([
      getDesktopTunnel("h1:bob:16001", connect, echoPort, g),
      getDesktopTunnel("h1:bob:16001", connect, echoPort, g),
    ]);
    const c = await getDesktopTunnel("h1:bob:16001", connect, echoPort, g);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(openDesktopTunnelCount()).toBe(1);
  });

  it("closes the tunnel when its SSH connection drops", async () => {
    const ssh = stubSsh();
    const t = await getDesktopTunnel(
      "h1:carol:16002",
      async () => ssh,
      echoPort,
      { host: GUACD_ADDR, port: guacdPort },
    );
    expect(openDesktopTunnelCount()).toBe(1);
    ssh.emit("close");
    expect(openDesktopTunnelCount()).toBe(0);
    await expect(roundTrip(t.host, t.port, GUACD_ADDR, "x")).rejects.toThrow();
  });

  it("fails without opening SSH when guacd is unreachable", async () => {
    const connect = vi.fn(async () => stubSsh());
    const closed = net.createServer();
    const port = await listen(closed, "127.0.0.1");
    closed.close();
    await expect(
      getDesktopTunnel("h1:dan:16003", connect, echoPort, {
        host: "127.0.0.1",
        port,
      }),
    ).rejects.toThrow("guacd_unreachable");
    expect(connect).not.toHaveBeenCalled();
  });
});
