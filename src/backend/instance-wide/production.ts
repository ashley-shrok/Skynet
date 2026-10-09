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
 * means the primary row's owner is an admin — a box an admin merely has a row
 * for does not count, so an employee's box stays non-admin.
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
    const primary =
      machineRows.find((r) => String(r.id) === machineId) ??
      machineRows.sort((a, b) => a.id - b.id)[0];
    const hostRowIds = machineRows.map((r) => String(r.id));
    out.push({
      machineId,
      hostName: record.name,
      adminOwned: !!primary?.isAdmin,
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
