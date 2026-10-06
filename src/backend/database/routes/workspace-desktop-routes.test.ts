// @vitest-environment node
/**
 * Route-level tests for /workspace/desktop: auth, RBAC, body validation, the
 * { error: "<class>" } contract, and — when Xvnc is installed — the whole
 * path end to end: /start brings up a real desktop via the real
 * agent-desktop script, /connect opens a tunnel, and a VNC handshake comes
 * back through it.
 *
 * The stub SSH client's exec runs commands in a local shell against a temp
 * $HOME (same approach as workspace-git-routes.test.ts); its forwardOut dials
 * loopback. A fake guacd listens on 127.0.0.2 so the tunnel's "only guacd may
 * connect" check can be exercised by sourcing connections from that address.
 *
 * Opt-in integration (INTEGRATION_TESTS=1 + GUACD_HOST/GUACD_PORT pointing at
 * a real guacd, e.g. `docker run -d guacamole/guacd:1.6.0`): the fake guacd is
 * skipped and one more case drives the real guacd through the tunnel to the
 * real desktop, and checks guacd's read-only setting actually drops input.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import express from "express";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let mockUserId: string | null = "user-A";
let mockHasAccess = true;
let home = "";

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null)
            return res.status(401).json({ error: "Unauthorized" });
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  },
}));

const canAccessHost = vi.fn(async () => ({ hasAccess: mockHasAccess }));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({ canAccessHost }) },
}));

vi.mock("../../utils/logger.js", () => {
  const l = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { sshLogger: l, logger: l, databaseLogger: l, guacLogger: l };
});

// No DB in this test: getGuacdEndpoint falls back to GUACD_HOST/GUACD_PORT.
vi.mock("../db/index.js", () => ({
  getDb: () => {
    throw new Error("no db in tests");
  },
}));

vi.mock("../../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AGENT_DESKTOP = path.join(REPO_ROOT, "substrate/scripts/agent-desktop");

/** ssh2-shaped client: exec runs in a local shell, forwardOut dials loopback. */
function makeStubClient() {
  const em = new EventEmitter() as EventEmitter & Record<string, unknown>;
  em.exec = (
    command: string,
    cb: (err: Error | null, stream: EventEmitter) => void,
  ) => {
    const child = spawn("sh", ["-c", command], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        AGENT_DESKTOP_NO_SYSTEMD: "1",
        AGENT_DESKTOP_BASE_DISPLAY: "720",
      },
    });
    const stream = Object.assign(new EventEmitter(), { stderr: child.stderr });
    child.stdout.on("data", (b: Buffer) => stream.emit("data", b));
    child.on("close", () => stream.emit("close"));
    cb(null, stream);
  };
  em.forwardOut = (
    _a: string,
    _p: number,
    host: string,
    port: number,
    cb: (e: Error | null, s?: net.Socket) => void,
  ) => {
    const s = net.connect({ host, port }, () => cb(null, s));
    s.once("error", (e) => cb(e));
  };
  em.end = () => em.emit("close");
  return em;
}

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => makeStubClient()),
}));
vi.mock("../../ssh/ssh-connection-pool.js", () => ({
  withConnection: vi.fn(
    async (
      _k: string,
      factory: () => Promise<unknown>,
      fn: (c: unknown) => Promise<unknown>,
    ) => fn(await factory()),
  ),
}));

import { resolveHostById } from "../../ssh/host-resolver.js";
const { default: workspaceDesktopRoutes, parseStatus } =
  await import("./workspace-desktop-routes.js");
const { GuacamoleTokenService } =
  await import("../../guacamole/token-service.js");
const { closeAllDesktopTunnels } =
  await import("../../guacamole/desktop-tunnel.js");

const HAVE_X = ["Xvnc", "vncpasswd", "openbox", "xdotool", "import"].every(
  (c) => {
    try {
      execFileSync("sh", ["-c", `command -v ${c}`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },
);

let server: http.Server;
let base = "";
let guacd: net.Server | null = null;
const REAL_GUACD =
  process.env.INTEGRATION_TESTS === "1" && !!process.env.GUACD_HOST;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON for assertions
type Json = Record<string, any>;

async function post(
  route: string,
  body: unknown,
): Promise<{ status: number; body: Json }> {
  const r = await fetch(`${base}/workspace/desktop${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

function installHelper(): void {
  fs.mkdirSync(path.join(home, ".local/bin"), { recursive: true });
  const link = path.join(home, ".local/bin/agent-desktop");
  if (!fs.existsSync(link)) fs.symlinkSync(AGENT_DESKTOP, link);
}

beforeAll(async () => {
  home = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ws-desktop-route-")),
  );
  fs.mkdirSync(path.join(home, "fleet/identities/alice/workspace"), {
    recursive: true,
  });

  if (!REAL_GUACD) {
    const fake = net.createServer((s) => s.destroy());
    guacd = fake;
    await new Promise<void>((r) => fake.listen(0, "127.0.0.2", () => r()));
    process.env.GUACD_HOST = "127.0.0.2";
    process.env.GUACD_PORT = String((fake.address() as AddressInfo).port);
  }

  const app = express();
  app.use("/workspace/desktop", workspaceDesktopRoutes);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  closeAllDesktopTunnels();
  try {
    execFileSync(AGENT_DESKTOP, ["down", "--identity", "alice"], {
      env: { ...process.env, HOME: home, AGENT_DESKTOP_NO_SYSTEMD: "1" },
    });
  } catch {
    /* not started */
  }
  server.close();
  guacd?.close();
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  mockUserId = "user-A";
  mockHasAccess = true;
  vi.mocked(resolveHostById).mockResolvedValue({
    id: 7,
    ip: "10.0.0.7",
    port: 22,
    username: "ubuntu",
  } as unknown as Awaited<ReturnType<typeof resolveHostById>>);
});

describe("parseStatus", () => {
  it("maps NOT_INSTALLED", () => {
    expect(parseStatus("NOT_INSTALLED")).toEqual({ available: false });
  });
  it("sanitises fields", () => {
    expect(
      parseStatus(
        '{"running":true,"display":700,"vncPort":16600,"geometry":"1280x800; rm -rf","userHasControl":"yes"}',
      ),
    ).toEqual({
      available: true,
      running: true,
      display: 700,
      vncPort: 16600,
      geometry: null,
      userHasControl: false,
    });
  });
  it("throws bad_output on garbage", () => {
    expect(() => parseStatus("bash: oops")).toThrow("bad_output");
  });
});

describe("/workspace/desktop request chain", () => {
  it("401 without auth", async () => {
    mockUserId = null;
    expect(
      (await post("/status", { identityKey: "alice", hostId: 7 })).status,
    ).toBe(401);
  });

  it("400 on a bad identity key", async () => {
    const r = await post("/status", { identityKey: "../etc", hostId: 7 });
    expect(r).toEqual({ status: 400, body: { error: "invalid_identity_key" } });
  });

  it("400 on a role target", async () => {
    const r = await post("/status", {
      kind: "role",
      roleSlug: "ops",
      hostId: 7,
    });
    expect(r).toEqual({ status: 400, body: { error: "invalid_body" } });
  });

  it("404 on an unknown host", async () => {
    vi.mocked(resolveHostById).mockResolvedValueOnce(null);
    expect(await post("/status", { identityKey: "alice", hostId: 99 })).toEqual(
      {
        status: 404,
        body: { error: "unknown_host" },
      },
    );
  });

  it("start needs write access; status and connect only read", async () => {
    canAccessHost.mockClear();
    await post("/start", { identityKey: "alice", hostId: 7 });
    await post("/status", { identityKey: "alice", hostId: 7 });
    expect(canAccessHost.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      "write",
      "read",
    ]);
  });

  it("403 without host access", async () => {
    mockHasAccess = false;
    expect(await post("/connect", { identityKey: "alice", hostId: 7 })).toEqual(
      {
        status: 403,
        body: { error: "permission_denied" },
      },
    );
  });
});

describe("/workspace/desktop without agent-desktop installed", () => {
  it("status reports available:false", async () => {
    expect(await post("/status", { identityKey: "alice", hostId: 7 })).toEqual({
      status: 200,
      body: { available: false },
    });
  });

  it("start and connect fail with not_installed", async () => {
    expect(await post("/start", { identityKey: "alice", hostId: 7 })).toEqual({
      status: 501,
      body: { error: "not_installed" },
    });
    expect(await post("/connect", { identityKey: "alice", hostId: 7 })).toEqual(
      {
        status: 501,
        body: { error: "not_installed" },
      },
    );
  });
});

describe("/workspace/desktop with agent-desktop installed", () => {
  beforeAll(() => installHelper());

  it("status reports a stopped desktop, and connect says not_running", async () => {
    const st = await post("/status", { identityKey: "alice", hostId: 7 });
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ available: true, running: false });
    expect(await post("/connect", { identityKey: "alice", hostId: 7 })).toEqual(
      {
        status: 409,
        body: { error: "not_running" },
      },
    );
  });

  it.skipIf(!HAVE_X || REAL_GUACD)(
    "start → status running → connect → VNC handshake through the tunnel (read-only token)",
    async () => {
      expect(await post("/start", { identityKey: "alice", hostId: 7 })).toEqual(
        {
          status: 200,
          body: { starting: true },
        },
      );

      let running = false;
      for (let i = 0; i < 60 && !running; i++) {
        await new Promise((r) => setTimeout(r, 500));
        running =
          (await post("/status", { identityKey: "alice", hostId: 7 })).body
            .running === true;
      }
      expect(running).toBe(true);

      const conn = await post("/connect", { identityKey: "alice", hostId: 7 });
      expect(conn.status).toBe(200);
      expect(conn.body.geometry).toBe("1280x800");

      const tok = GuacamoleTokenService.getInstance().decryptToken(
        conn.body.token,
      );
      expect(tok?.connection.type).toBe("vnc");
      const s = tok!.connection.settings;
      expect(s["read-only"]).toBe(true);
      expect(s.password).toBe(
        fs
          .readFileSync(
            path.join(home, "fleet/identities/alice/desktop/vnc-password"),
            "utf8",
          )
          .trim(),
      );

      // Connect as guacd would (from guacd's address) and read the RFB banner.
      const banner = await new Promise<string>((resolve, reject) => {
        const sock = net.connect({
          host: s.hostname,
          port: s.port as number,
          localAddress: "127.0.0.2",
        });
        sock.once("data", (b) => {
          sock.destroy();
          resolve(b.toString());
        });
        sock.once("error", reject);
        setTimeout(() => reject(new Error("no banner")), 5000);
      });
      expect(banner).toMatch(/^RFB 003\.00\d\n/);
    },
    60_000,
  );

  it.skipIf(!HAVE_X || !REAL_GUACD)(
    "real guacd connects through the tunnel, and read-only drops input",
    async () => {
      await post("/start", { identityKey: "alice", hostId: 7 });
      for (let i = 0; i < 60; i++) {
        if (
          (await post("/status", { identityKey: "alice", hostId: 7 })).body
            .running === true
        )
          break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const conn = await post("/connect", { identityKey: "alice", hostId: 7 });
      expect(conn.status).toBe(200);
      const settings = GuacamoleTokenService.getInstance().decryptToken(
        conn.body.token,
      )!.connection.settings;
      const pointer = () =>
        execFileSync("xdotool", ["getmouselocation"], {
          env: { ...process.env, DISPLAY: ":720" },
        }).toString();
      execFileSync("xdotool", ["mousemove", "10", "10"], {
        env: { ...process.env, DISPLAY: ":720" },
      });

      // Read-only (as issued): guacd connects and streams, but the move is dropped.
      await guacdSession(settings, async (send) => {
        send(["mouse", "500", "400", "0"]);
        await new Promise((r) => setTimeout(r, 1000));
      });
      expect(pointer()).toMatch(/^x:10 y:10 /);

      // Control: the same session with read-only off does move the pointer,
      // so the assertion above is really testing guacd's setting.
      await guacdSession({ ...settings, "read-only": false }, async (send) => {
        send(["mouse", "500", "400", "0"]);
        await new Promise((r) => setTimeout(r, 1000));
      });
      expect(pointer()).toMatch(/^x:500 y:400 /);
    },
    60_000,
  );
});

/* ---- minimal Guacamole protocol client (integration case only) ---------- */

function encodeInstruction(parts: string[]): string {
  return parts.map((p) => `${[...p].length}.${p}`).join(",") + ";";
}

/** Splits a stream of instructions; returns parsed instructions and the unconsumed tail. */
function parseInstructions(buf: string): { done: string[][]; rest: string } {
  const done: string[][] = [];
  let i = 0;
  let cur: string[] = [];
  while (i < buf.length) {
    const dot = buf.indexOf(".", i);
    if (dot < 0) break;
    const len = parseInt(buf.slice(i, dot), 10);
    const chars = [...buf.slice(dot + 1)];
    if (chars.length < len + 1) break;
    const val = chars.slice(0, len).join("");
    const term = chars[len];
    cur.push(val);
    i = dot + 1 + val.length + 1;
    if (term === ";") {
      done.push(cur);
      cur = [];
    }
  }
  const consumed = done.length ? buf.lastIndexOf(";", i) + 1 : 0;
  return { done, rest: buf.slice(consumed) };
}

/** Handshake with guacd using the token's settings, wait for `ready`, run `body`, disconnect. */
async function guacdSession(
  settings: Record<string, unknown>,
  body: (send: (parts: string[]) => void) => Promise<void>,
): Promise<void> {
  const sock = net.connect({
    host: process.env.GUACD_HOST!,
    port: Number(process.env.GUACD_PORT ?? 4822),
  });
  const send = (parts: string[]) => sock.write(encodeInstruction(parts));
  let buf = "";
  const waitFor = (opcode: string) =>
    new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${opcode} from guacd`)),
        10_000,
      );
      const onData = (b: Buffer) => {
        buf += b.toString();
        const { done, rest } = parseInstructions(buf);
        buf = rest;
        for (const ins of done) {
          if (ins[0] === "sync") send(["sync", ins[1]]);
          if (ins[0] === "error") {
            clearTimeout(timer);
            sock.off("data", onData);
            reject(new Error(`guacd error: ${ins.slice(1).join(" ")}`));
            return;
          }
          if (ins[0] === opcode) {
            clearTimeout(timer);
            sock.off("data", onData);
            resolve(ins);
            return;
          }
        }
      };
      sock.on("data", onData);
    });

  await new Promise<void>((r) => sock.once("connect", () => r()));
  send(["select", "vnc"]);
  const args = await waitFor("args");
  send(["size", "1280", "800", "96"]);
  send(["audio"]);
  send(["video"]);
  send(["image", "image/png"]);
  send([
    "connect",
    ...args.slice(1).map((name) => {
      if (name.startsWith("VERSION_")) return name;
      const v = settings[name];
      return v === undefined || v === null ? "" : String(v);
    }),
  ]);
  await waitFor("ready");
  // `ready` comes before guacd's VNC client is up; the first frame means it is.
  await waitFor("sync");
  // Keep answering syncs in the background while the body runs.
  sock.on("data", (b: Buffer) => {
    buf += b.toString();
    const { done, rest } = parseInstructions(buf);
    buf = rest;
    for (const ins of done) if (ins[0] === "sync") send(["sync", ins[1]]);
  });
  await body(send);
  send(["disconnect"]);
  sock.destroy();
}
