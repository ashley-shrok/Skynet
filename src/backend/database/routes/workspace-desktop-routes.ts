/**
 * Identity desktop — status, start, and a view-only Guacamole connection to
 * an identity's virtual desktop (substrate/scripts/agent-desktop).
 *
 * Four endpoints under /workspace/desktop (mounted in database.ts; nginx's
 * /workspace location already proxies them):
 *   POST /status  — { available, running, display, vncPort, geometry, userHasControl }
 *                   `available: false` means agent-desktop isn't installed on the host
 *   POST /start   — kicks off `agent-desktop up` in the background and returns
 *                   at once (first start may install packages, far longer than
 *                   nginx's 15s /workspace timeout); the UI polls /status
 *   POST /connect — opens (or reuses) an SSH tunnel guacd can reach and
 *                   returns an encrypted, view-only Guacamole VNC token for it
 *   POST /control — body.action:
 *                     "take"    take the control lease + an INTERACTIVE token
 *                     "renew"   keep the lease alive (the tab calls this every 30s)
 *                     "release" hand the desktop back to the agent
 *
 * Same request chain as workspace-git-routes.ts: body check → extractTarget
 * (identity only) → resolveHostById → canAccessHost → SSH exec. Watching
 * needs "read"; /start and /control need "write", since they launch a process
 * or drive the desktop (shared hosts are view-only, so a share can watch but
 * not start or take control).
 *
 * Dev caveat: the tunnel listens on the address this process uses to reach
 * guacd. With the backend on the host and guacd in a container published on
 * localhost (docker/compose-dev.yml), that's 127.0.0.1, which guacd's own
 * loopback can't reach — run guacd with `--network host` to use this in dev.
 *
 * Watching is view-only: the /connect token carries guacd's `read-only`
 * setting, so guacd drops every key and mouse event server-side regardless of
 * the client. Taking control writes the identity's control-lock lease (see
 * `agent-desktop control`), which pauses the agent's own desktop-mcp input,
 * and issues a token without `read-only`. The lease lapses 90s after the last
 * renew, so a closed tab gives the agent its desktop back on its own.
 *
 * Error bodies are { error: "<class>" } only — never err.message (T-40-05).
 */

import express from "express";
import type { Request, Response } from "express";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { withConnection, hostPoolKey } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import { getDb } from "../db/index.js";
import { GuacamoleTokenService } from "../../guacamole/token-service.js";
import {
  getDesktopTunnel,
  type GuacdEndpoint,
} from "../../guacamole/desktop-tunnel.js";
import {
  classifyErrorToClass,
  classifyErrorToStatus,
  extractTarget,
  runWithAbort,
} from "./workspace-routes.js";

const SSH_CONNECT_TIMEOUT_MS = 5_000;
/** Under nginx's 15s proxy_read_timeout on /workspace. */
const DESKTOP_OP_TIMEOUT_MS = 12_000;
const MAX_SCRIPT_OUTPUT = 4_096;

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

export type DesktopStatus =
  | { available: false }
  | {
      available: true;
      running: boolean;
      display: number | null;
      vncPort: number | null;
      geometry: string | null;
      userHasControl: boolean;
    };

class DesktopError extends Error {}

const DESKTOP_ERROR_STATUS: Record<string, number> = {
  not_installed: 501,
  not_running: 409,
  no_password: 409,
  guacd_unreachable: 503,
  too_many_tunnels: 503,
  bad_output: 502,
};

/* ------------------------------------------------------------------------ */
/*  Scripts                                                                 */
/* ------------------------------------------------------------------------ */

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Locate agent-desktop: exec channels don't get ~/.local/bin on PATH. */
const FIND_AGENT_DESKTOP = [
  `ad="$HOME/.local/bin/agent-desktop"`,
  `[ -x "$ad" ] || ad=$(command -v agent-desktop 2>/dev/null) || { printf 'NOT_INSTALLED'; exit 0; }`,
].join("\n");

export function buildStatusScript(identityKey: string): string {
  // `status` exits 1 when stopped but still prints its JSON.
  return [
    FIND_AGENT_DESKTOP,
    `"$ad" status --identity ${shellEscape(identityKey)} --json 2>/dev/null`,
  ].join("\n");
}

export function buildStartScript(identityKey: string): string {
  // Detached: the exec channel returns immediately, the desktop comes up in
  // the background, and its errors land in the identity's serve.log.
  return [
    FIND_AGENT_DESKTOP,
    `nohup "$ad" up --identity ${shellEscape(identityKey)} --quiet </dev/null >/dev/null 2>&1 &`,
    `printf 'STARTED'`,
  ].join("\n");
}

export function buildConnectScript(identityKey: string): string {
  const pwFile = `"$HOME"/${shellEscape(`fleet/identities/${identityKey}/desktop/vnc-password`)}`;
  return [
    buildStatusScript(identityKey),
    `printf '\\nPW:'`,
    `head -c 64 ${pwFile} 2>/dev/null`,
  ].join("\n");
}

export type ControlAction = "take" | "release";

export function buildControlScript(
  identityKey: string,
  action: ControlAction,
  by: string,
): string {
  return [
    FIND_AGENT_DESKTOP,
    `"$ad" control ${action} --identity ${shellEscape(identityKey)} --by ${shellEscape(by)} 2>/dev/null && printf 'CONTROL_OK'`,
  ].join("\n");
}

export function parseStatus(stdout: string): DesktopStatus {
  const line = stdout.split("\n")[0].trim();
  if (line === "NOT_INSTALLED") return { available: false };
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new DesktopError("bad_output");
  }
  if (!raw || typeof raw !== "object") throw new DesktopError("bad_output");
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
  return {
    available: true,
    running: r.running === true,
    display: num(r.display),
    vncPort: num(r.vncPort),
    geometry:
      typeof r.geometry === "string" && /^\d{2,5}x\d{2,5}$/.test(r.geometry)
        ? r.geometry
        : null,
    userHasControl: r.userHasControl === true,
  };
}

/* ------------------------------------------------------------------------ */
/*  Helpers                                                                 */
/* ------------------------------------------------------------------------ */

function execScript(client: SSHClientType, script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(`sh -c ${shellEscape(script)}`, (err, stream) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (buf: Buffer) => {
        if (size >= MAX_SCRIPT_OUTPUT) return;
        chunks.push(buf);
        size += buf.length;
      });
      stream.stderr.on("data", () => {
        /* drained */
      });
      stream.on("close", () =>
        resolve(Buffer.concat(chunks).toString("utf-8")),
      );
      stream.on("error", reject);
    });
  });
}

/** guacd's address, from the same guac_url setting the rest of Guacamole uses. */
export function getGuacdEndpoint(): GuacdEndpoint {
  let host = process.env.GUACD_HOST || "localhost";
  let port = parseInt(process.env.GUACD_PORT || "4822", 10);
  try {
    const row = getDb()
      .$client.prepare("SELECT value FROM settings WHERE key = 'guac_url'")
      .get() as { value: string } | undefined;
    if (row?.value) {
      const [h, p] = row.value.split(":");
      host = h || host;
      port = parseInt(p || String(port), 10);
    }
  } catch {
    /* fall back to env */
  }
  return { host, port };
}

function errorStatus(err: unknown): number {
  if (err instanceof DesktopError)
    return DESKTOP_ERROR_STATUS[err.message] ?? 502;
  if (err instanceof Error && err.message in DESKTOP_ERROR_STATUS) {
    return DESKTOP_ERROR_STATUS[err.message];
  }
  return classifyErrorToStatus(err);
}

function errorClass(err: unknown): string {
  if (err instanceof Error && err.message in DESKTOP_ERROR_STATUS)
    return err.message;
  if (err instanceof DesktopError) return "bad_output";
  return classifyErrorToClass(err);
}

type Host = NonNullable<Awaited<ReturnType<typeof resolveHostById>>>;

/**
 * Validate + authorise, then hand the resolved host to `run`. Every handler
 * goes through here.
 */
async function handleDesktopRequest(
  req: Request,
  res: Response,
  operation: string,
  action: "read" | "write",
  run: (ctx: {
    host: Host;
    hostId: number;
    identityKey: string;
    userId: string;
  }) => Promise<unknown>,
): Promise<void> {
  const body = req.body as Record<string, unknown> | null;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (typeof body.hostId !== "number" && typeof body.hostId !== "string")
  ) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const targetResult = extractTarget(body);
  if (targetResult.ok === false) {
    res.status(400).json({ error: targetResult.error });
    return;
  }
  if (targetResult.target.kind !== "identity") {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const identityKey = targetResult.target.identityKey;
  const userId = (req as Request & { userId: string }).userId;

  const hostId = Number(body.hostId);
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    res.status(404).json({ error: "unknown_host" });
    return;
  }
  const accessInfo = await permissionManager.canAccessHost(
    userId,
    hostId,
    action,
  );
  if (!accessInfo.hasAccess) {
    res.status(403).json({ error: "permission_denied" });
    return;
  }

  try {
    res.json(await run({ host, hostId, identityKey, userId }));
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorClass(err) });
    sshLogger.warn(`workspace-desktop ${operation} error`, {
      operation: `workspace_desktop_${operation}`,
      errorName: err instanceof Error ? err.name : "unknown",
      errorClass: errorClass(err),
      userId,
    });
  }
}

/** Run a short script on the pooled connection, bounded by DESKTOP_OP_TIMEOUT_MS. */
async function runScript(
  host: Host,
  hostId: number,
  script: string,
): Promise<string> {
  const poolKey = hostPoolKey(host);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DESKTOP_OP_TIMEOUT_MS);
  try {
    return await getHostSemaphore(hostId).run(() =>
      withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        (client) => runWithAbort(ctrl.signal, () => execScript(client, script)),
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------ */
/*  Router                                                                  */
/* ------------------------------------------------------------------------ */

const workspaceDesktopRoutes = express.Router();

workspaceDesktopRoutes.post(
  "/status",
  express.json({ limit: "16kb" }),
  authenticateJWT,
  (req: Request, res: Response) =>
    handleDesktopRequest(
      req,
      res,
      "status",
      "read",
      async ({ host, hostId, identityKey }) =>
        parseStatus(
          await runScript(host, hostId, buildStatusScript(identityKey)),
        ),
    ),
);

workspaceDesktopRoutes.post(
  "/start",
  express.json({ limit: "16kb" }),
  authenticateJWT,
  (req: Request, res: Response) =>
    handleDesktopRequest(
      req,
      res,
      "start",
      "write",
      async ({ host, hostId, identityKey }) => {
        const out = await runScript(
          host,
          hostId,
          buildStartScript(identityKey),
        );
        if (out.startsWith("NOT_INSTALLED"))
          throw new DesktopError("not_installed");
        if (!out.includes("STARTED")) throw new DesktopError("bad_output");
        return { starting: true };
      },
    ),
);

/**
 * Check the desktop is up, open (or reuse) its tunnel, and mint a token for
 * it. View-only unless `interactive`.
 */
async function issueConnection(
  {
    host,
    hostId,
    identityKey,
  }: { host: Host; hostId: number; identityKey: string },
  interactive: boolean,
  beforeToken?: () => Promise<void>,
) {
  const out = await runScript(host, hostId, buildConnectScript(identityKey));
  const status = parseStatus(out);
  if (!status.available) throw new DesktopError("not_installed");
  if (!status.running || !status.vncPort) throw new DesktopError("not_running");
  const pwAt = out.lastIndexOf("\nPW:");
  const password = pwAt < 0 ? "" : out.slice(pwAt + 4).trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(password))
    throw new DesktopError("no_password");

  const tunnel = await getDesktopTunnel(
    `${hostId}:${identityKey}:${status.vncPort}`,
    () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
    status.vncPort,
    getGuacdEndpoint(),
  );
  await beforeToken?.();

  const token = GuacamoleTokenService.getInstance().createVncToken(
    tunnel.host,
    undefined,
    password,
    {
      port: tunnel.port,
      // Watching: guacd drops all input server-side.
      "read-only": !interactive,
      "color-depth": 24,
    },
  );
  return {
    token,
    geometry: status.geometry,
    userHasControl: interactive || status.userHasControl,
  };
}

async function runControl(
  host: Host,
  hostId: number,
  identityKey: string,
  action: ControlAction,
  userId: string,
): Promise<void> {
  const out = await runScript(
    host,
    hostId,
    buildControlScript(identityKey, action, userId),
  );
  if (out.startsWith("NOT_INSTALLED")) throw new DesktopError("not_installed");
  if (!out.includes("CONTROL_OK")) throw new DesktopError("bad_output");
}

workspaceDesktopRoutes.post(
  "/control",
  express.json({ limit: "16kb" }),
  authenticateJWT,
  (req: Request, res: Response) => {
    const action = (req.body as Record<string, unknown> | null)?.action;
    if (action !== "take" && action !== "renew" && action !== "release") {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    return handleDesktopRequest(
      req,
      res,
      `control_${action}`,
      "write",
      async (ctx) => {
        const { host, hostId, identityKey, userId } = ctx;
        if (action === "take") {
          // Lease only once the desktop is known to be up and the tunnel is open,
          // so a failed take never leaves the agent paused.
          return issueConnection(ctx, true, () =>
            runControl(host, hostId, identityKey, "take", userId),
          );
        }
        await runControl(
          host,
          hostId,
          identityKey,
          action === "renew" ? "take" : "release",
          userId,
        );
        return { ok: true };
      },
    );
  },
);

workspaceDesktopRoutes.post(
  "/connect",
  express.json({ limit: "16kb" }),
  authenticateJWT,
  (req: Request, res: Response) =>
    handleDesktopRequest(req, res, "connect", "read", (ctx) =>
      issueConnection(ctx, false),
    ),
);

export default workspaceDesktopRoutes;
