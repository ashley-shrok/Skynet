/**
 * GET /users/admin/hosts — admin Hosts overview (see hosts-overview.ts).
 *
 * Probes are on-demand: the admin pane polls while it's open, nothing runs
 * otherwise. Results are cached per admin for CACHE_TTL_MS and concurrent
 * requests share one in-flight build. SSH clients are pooled per host row
 * so a refresh doesn't re-handshake every machine.
 *
 * DB / SSH modules are imported lazily inside build() so mounting this route
 * on the users router doesn't drag the SSH stack into every users-route test.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import type { Request, RequestHandler, Response, Router } from "express";
import type { Client } from "ssh2";
import type { AuthenticatedRequest } from "../../types/index.js";
import { systemLogger } from "../utils/logger.js";
import { PROBE_COMMAND, tcpPing } from "./host-probe.js";
import {
  buildHostsOverview,
  type AdminHostsResponse,
  type HostRow,
  type RemoteExecResult,
} from "./hosts-overview.js";

const CACHE_TTL_MS = 10_000;
const CONNECT_TIMEOUT_MS = 8_000;
const EXEC_TIMEOUT_MS = 8_000;

const lastSeen = new Map<string, number>();
const cache = new Map<string, { at: number; data: AdminHostsResponse }>();
const inFlight = new Map<string, Promise<AdminHostsResponse>>();
const clients = new Map<number, Client>();

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

function dropClient(hostId: number): void {
  const c = clients.get(hostId);
  clients.delete(hostId);
  try {
    c?.end();
  } catch {
    /* already gone */
  }
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
    const child = spawn("bash", ["-c", PROBE_COMMAND], {
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill();
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
  const [{ connectOneShot }, { execCommand }, { getHostSemaphore }] =
    await Promise.all([
      import("../ssh/ssh-one-shot.js"),
      import("../ssh/tmux-helper.js"),
      import("../ssh/host-semaphore-registry.js"),
    ]);
  try {
    let client = clients.get(row.id);
    if (!client) {
      const fresh = await connectOneShot(
        connDetails as unknown as Parameters<typeof connectOneShot>[0],
        CONNECT_TIMEOUT_MS,
      );
      clients.set(row.id, fresh);
      const evict = () => {
        if (clients.get(row.id) === fresh) clients.delete(row.id);
      };
      fresh.on("end", evict);
      fresh.on("close", evict);
      fresh.on("error", evict);
      client = fresh;
    }
    const conn = client;
    const output = await withTimeout(
      getHostSemaphore(row.id).run(() => execCommand(conn, PROBE_COMMAND)),
      EXEC_TIMEOUT_MS,
    );
    return { ok: true, output };
  } catch (err) {
    dropClient(row.id);
    systemLogger.warn("Admin hosts: probe failed", {
      operation: "admin_hosts_probe_failed",
      hostId: row.id,
      hostName: row.name,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "connect_failed" };
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
        })
        .from(hostsTable);
      return rows.map((r) => ({
        ...r,
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
