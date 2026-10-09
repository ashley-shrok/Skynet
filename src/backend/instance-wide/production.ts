/**
 * instance-wide/production.ts — the production wiring for the engine: machine
 * enumeration from the DB, the local-host channel, and the process singleton.
 */
import { spawn } from "child_process";
import os from "os";
import { eq } from "drizzle-orm";
import { hosts, users } from "../database/db/schema.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import {
  listSubstrateHosts,
  type SubstrateHostRecord,
} from "../distributor/list-substrate-hosts.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import type { InstanceWideEngine, SyncMachine } from "./engine.js";

export interface ProductionMachine extends SyncMachine {
  /** The substrate host row used to reach the machine. */
  record: SubstrateHostRecord;
  local: boolean;
}

type GetDb = () => ReturnType<typeof import("../database/db/index.js").getDb>;

/**
 * Every fleet-substrate machine, one entry per physical box. A box several
 * users registered is reached through its primary row (id == machine id) when
 * that row is a substrate row, else the lowest-id substrate row. "Admin-owned"
 * is judged on that same row — the account whose home folder is actually
 * synced — so an employee's box an admin also registered never counts as the
 * admin's.
 */
export async function listMachines(getDb: GetDb): Promise<ProductionMachine[]> {
  const substrate = await listSubstrateHosts({ getDb });
  if (substrate.length === 0) return [];
  const rows = await getDb()
    .select({
      id: hosts.id,
      machineId: hosts.machineId,
      isAdmin: users.isAdmin,
    })
    .from(hosts)
    .leftJoin(users, eq(hosts.userId, users.id));

  const byMachine = new Map<string, SubstrateHostRecord[]>();
  for (const rec of substrate) {
    const mid = rec.machineId ?? rec.id;
    const list = byMachine.get(mid) ?? [];
    list.push(rec);
    byMachine.set(mid, list);
  }

  const out: ProductionMachine[] = [];
  for (const [machineId, recs] of byMachine) {
    recs.sort((a, b) => Number(a.id) - Number(b.id));
    const record = recs.find((r) => r.id === machineId) ?? recs[0];
    const machineRows = rows.filter((r) => String(r.machineId ?? r.id) === machineId);
    const syncedRow = machineRows.find((r) => String(r.id) === record.id);
    const hostRowIds = machineRows.map((r) => String(r.id));
    out.push({
      machineId,
      hostName: record.name,
      adminOwned: !!syncedRow?.isAdmin,
      hostRowIds,
      record,
      local: hostRowIds.some((id) => isLocalHostId(Number(id))),
    });
  }
  return out.sort((a, b) => Number(a.machineId) - Number(b.machineId));
}

/**
 * Bash on the co-located host via the bind-mounted home (no SSH to self).
 * Runs as the container's root; host-ops re-owns what it writes.
 */
export function localChannel(): SshChannel {
  const home = process.env.HOME_HOST_DIR || os.homedir();
  return {
    exec(command: string, stdinBody?: Buffer): Promise<string | null> {
      return new Promise((resolve) => {
        let child;
        try {
          child = spawn("bash", ["-c", command], {
            env: { ...process.env, HOME: home },
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          resolve(null);
          return;
        }
        let stdout = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
        child.on("error", () => resolve(null));
        child.on("close", (code: number | null) =>
          resolve(code !== 0 && stdout === "" ? null : stdout.trim()),
        );
        child.stdin.on("error", () => {});
        child.stdin.end(stdinBody ?? Buffer.alloc(0));
      });
    },
  };
}

let engine: InstanceWideEngine | null = null;
let machinesFn: (() => Promise<ProductionMachine[]>) | null = null;

export function setInstanceWide(e: InstanceWideEngine, listFn: () => Promise<ProductionMachine[]>): void {
  engine = e;
  machinesFn = listFn;
}

export function getInstanceWide(): InstanceWideEngine | null {
  return engine;
}

export async function getMachines(): Promise<ProductionMachine[]> {
  return machinesFn ? machinesFn() : [];
}

/** The machine a hosts row points at, if it takes part in instance-wide sync. */
export async function machineForHostRow(hostId: number): Promise<ProductionMachine | null> {
  const id = String(hostId);
  return (await getMachines()).find((m) => m.hostRowIds.includes(id)) ?? null;
}

/**
 * Skill/role names the app's own standard files use (built-in skills it
 * distributes, plus retired ones it actively deletes). Making one of these
 * instance-wide would have two mechanisms fighting over one folder.
 */
export function reservedNameCheck(
  catalogInstallPaths: string[],
  retiredDirs: readonly string[],
): (kind: "skill" | "role", name: string) => boolean {
  const skills = new Set<string>();
  for (const p of catalogInstallPaths) {
    const m = /^~\/\.claude\/skills\/([^/]+)\//.exec(p);
    if (m) skills.add(m[1]);
  }
  for (const d of retiredDirs) {
    const m = /^\.claude\/skills\/([^/]+)$/.exec(d);
    if (m) skills.add(m[1]);
  }
  return (kind, name) => kind === "skill" && skills.has(name);
}

/** The co-located machine (writes with no host id land there). */
export async function localMachine(): Promise<ProductionMachine | null> {
  return (await getMachines()).find((m) => m.local) ?? null;
}
