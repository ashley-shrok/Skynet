/**
 * GET /users/admin/hosts — admin Hosts overview (see hosts-overview.ts).
 *
 * Probes are on-demand: the admin pane polls while it's open, nothing runs
 * otherwise. Results are cached per admin for CACHE_TTL_MS and concurrent
 * requests share one in-flight build. SSH clients are pooled per host row
 * so a refresh doesn't re-handshake every machine; a pooled client closes
 * after CLIENT_IDLE_MS without a probe (i.e. shortly after the pane closes)
 * and is replaced when the row's connection details change.
 *
 * DB / SSH modules are imported lazily inside build() so mounting this route
 * on the users router doesn't drag the SSH stack into every users-route test.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import type { Request, RequestHandler, Response, Router } from "express";
import type { Client } from "ssh2";
import type { AuthenticatedRequest } from "../../types/index.js";
import { systemLogger } from "../utils/logger.js";
import { PROBE_COMMAND, REMOTE_PROBE_COMMAND, tcpPing } from "./host-probe.js";
import {
  buildHostsOverview,
  type AdminHostsResponse,
  type HostRow,
  type RemoteExecResult,
} from "./hosts-overview.js";

const CACHE_TTL_MS = 10_000;
const CONNECT_TIMEOUT_MS = 8_000;
const EXEC_TIMEOUT_MS = 8_000;
const CLIENT_IDLE_MS = 45_000;

const lastSeen = new Map<string, number>();
const cache = new Map<string, { at: number; data: AdminHostsResponse }>();
const inFlight = new Map<string, Promise<AdminHostsResponse>>();
interface PooledClient {
  /** Hash of the connection details the client was opened with. */
  signature: string;
  client: Promise<Client>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}
const clients = new Map<number, PooledClient>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function dropClient(hostId: number, entry?: PooledClient): void {
  const c = clients.get(hostId);
  if (!c || (entry && c !== entry)) return;
  clients.delete(hostId);
  if (c.idleTimer) clearTimeout(c.idleTimer);
  c.client.then(
    (cl) => {
      try {
        cl.end();
      } catch {
        /* already gone */
      }
    },
    () => {},
  );
}

function signatureOf(connDetails: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(connDetails)).digest("hex");
}

/**
 * Pooled client for a row. One connect per row even under concurrent builds
 * (the connect promise is pooled, not the resolved client); a changed signature —
 * address, port, user or credentials edited — replaces the old client.
 */
async function getClient(
  row: HostRow,
  connDetails: Record<string, unknown>,
): Promise<PooledClient> {
  const { connectOneShot } = await import("../ssh/ssh-one-shot.js");
  const signature = signatureOf(connDetails);
  let entry = clients.get(row.id);
  if (entry && entry.signature !== signature) {
    dropClient(row.id, entry);
    entry = undefined;
  }
  if (!entry) {
    const created: PooledClient = {
      signature,
      client: connectOneShot(
        connDetails as unknown as Parameters<typeof connectOneShot>[0],
        CONNECT_TIMEOUT_MS,
      ),
      idleTimer: null,
    };
    clients.set(row.id, created);
    created.client.then(
      (cl) => {
        const evict = () => dropClient(row.id, created);
        cl.on("end", evict);
        cl.on("close", evict);
        cl.on("error", evict);
      },
      () => dropClient(row.id, created),
    );
    entry = created;
  }
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  const pooled = entry;
  pooled.idleTimer = setTimeout(() => dropClient(row.id, pooled), CLIENT_IDLE_MS);
  return pooled;
}

function execLocal(): Promise<string | null> {
  const home = process.env.HOME_HOST_DIR || os.homedir();
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    // Own process group so a timeout kills the whole pipeline (find, df…),
    // not just the bash parent.
    const child = spawn("bash", ["-c", PROBE_COMMAND], {
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
      finish(null);
    }, EXEC_TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf-8")));
    child.on("error", () => finish(null));
    child.on("close", () => finish(out || null));
  });
}

async function execOn(
  row: HostRow,
  connDetails: Record<string, unknown>,
): Promise<RemoteExecResult> {
  const [{ execCommand }, { getHostSemaphore }] = await Promise.all([
    import("../ssh/tmux-helper.js"),
    import("../ssh/host-semaphore-registry.js"),
  ]);
  let entry: PooledClient | undefined;
  let stage = "connect";
  try {
    entry = await getClient(row, connDetails);
    const client = await entry.client;
    stage = "exec";
    // Timeout covers the exec only, not time queued behind other producers
    // on the host's shared semaphore (the machine deadline bounds that).
    const output = await getHostSemaphore(row.id).run(() =>
      withTimeout(execCommand(client, REMOTE_PROBE_COMMAND), EXEC_TIMEOUT_MS),
    );
    return { ok: true, output };
  } catch (err) {
    dropClient(row.id, entry);
    systemLogger.warn("Admin hosts: probe failed", {
      operation: "admin_hosts_probe_failed",
      hostId: row.id,
      hostName: row.name,
      stage,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "connect_failed" };
  }
}

function hasJumpHosts(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length > 0 : !!parsed;
  } catch {
    return raw.trim() !== "";
  }
}

async function build(userId: string): Promise<AdminHostsResponse> {
  const [
    { getDb },
    { hosts: hostsTable },
    { listSubstrateHosts },
    { getSubstrateOrchestrator },
    { isLocalHostId },
    { resolveHostById },
  ] = await Promise.all([
    import("../database/db/index.js"),
    import("../database/db/schema.js"),
    import("../distributor/list-substrate-hosts.js"),
    import("../distributor/substrate-orchestrator-singleton.js"),
    import("../claude-session/identity-artifact-reader.js"),
    import("../ssh/host-resolver.js"),
  ]);
  const db = getDb();
  // Substrate rows carry system-wrapped creds — no per-user decrypt needed.
  const substrateCreds = new Map(
    (await listSubstrateHosts({ getDb })).map((h) => [h.id, h._connDetails]),
  );
  const orch = getSubstrateOrchestrator();

  const started = Date.now();
  const result = await buildHostsOverview({
    listRows: async () => {
      const rows = await db
        .select({
          id: hostsTable.id,
          name: hostsTable.name,
          ip: hostsTable.ip,
          port: hostsTable.port,
          sshPort: hostsTable.sshPort,
          rdpPort: hostsTable.rdpPort,
          vncPort: hostsTable.vncPort,
          enableSsh: hostsTable.enableSsh,
          enableRdp: hostsTable.enableRdp,
          enableVnc: hostsTable.enableVnc,
          runsFleetSubstrate: hostsTable.runsFleetSubstrate,
          jumpHosts: hostsTable.jumpHosts,
        })
        .from(hostsTable);
      return rows.map(({ jumpHosts, ...r }) => ({
        ...r,
        hasJumpHosts: hasJumpHosts(jumpHosts),
        enableSsh: !!r.enableSsh,
        enableRdp: !!r.enableRdp,
        enableVnc: !!r.enableVnc,
        runsFleetSubstrate: !!r.runsFleetSubstrate,
      }));
    },
    isLocal: (id) => isLocalHostId(id),
    execLocal,
    execRemote: async (row) => {
      const sys = row.runsFleetSubstrate ? substrateCreds.get(String(row.id)) : undefined;
      if (sys) return execOn(row, sys);
      const own = await resolveHostById(row.id, userId).catch(() => null);
      if (!own) return { ok: false, reason: "no_access" };
      return execOn(row, own as unknown as Record<string, unknown>);
    },
    tcpPing: (ip, port) => tcpPing(ip, port),
    sweepStatus: (id) => orch?.getHostSweepStatus(id) ?? null,
    now: () => Date.now(),
    lastSeen,
  });

  systemLogger.info("Admin hosts: overview built", {
    operation: "admin_hosts_overview_built",
    machines: result.hosts.length,
    online: result.hosts.filter((h) => h.online).length,
    withResources: result.hosts.filter((h) => h.resources).length,
    durationMs: Date.now() - started,
  });
  return result;
}

export function registerAdminHostsRoutes(
  router: Router,
  requireAdmin: RequestHandler,
): void {
  router.get("/admin/hosts", requireAdmin, async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.json(hit.data);

    let p = inFlight.get(userId);
    if (!p) {
      p = build(userId).finally(() => inFlight.delete(userId));
      inFlight.set(userId, p);
    }
    try {
      const data = await p;
      cache.set(userId, { at: Date.now(), data });
      return res.json(data);
    } catch (err) {
      systemLogger.error("Admin hosts: overview failed", {
        operation: "admin_hosts_overview_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      return res.status(500).json({ error: "Failed to load hosts" });
    }
  });
}
