/**
 * Admin Hosts overview — one entry per MACHINE, not per host row.
 *
 * The hosts table has a row per (user, protocol) connection: "thenasty" and
 * "thenasty-RDP" are the same box, and two users who both added the same box
 * each have their own row. Rows are grouped by address, then each machine is
 * probed once:
 *
 *   - resources: PROBE_COMMAND over SSH (or locally for the Skynet box), using
 *     the substrate row's system credentials when there is one, else an
 *     SSH-enabled row the requesting admin can decrypt.
 *   - reachability: a plain TCP connect to each enabled protocol port, so
 *     RDP-only / Windows targets still get online + latency.
 *   - substrate: the substrate orchestrator's last sweep outcome.
 *
 * Everything host-touching is injected (OverviewDeps) so the grouping and
 * assembly are testable without SSH.
 */

import type { HostSweepStatus } from "../distributor/server-substrate-orchestrator.js";
import {
  parseProbeOutput,
  type HostFleetCounts,
  type HostResources,
} from "./host-probe.js";

export interface HostRow {
  id: number;
  name: string | null;
  ip: string;
  port: number;
  sshPort: number | null;
  rdpPort: number | null;
  vncPort: number | null;
  enableSsh: boolean;
  enableRdp: boolean;
  enableVnc: boolean;
  runsFleetSubstrate: boolean;
  /** Probe can't route through jump hosts; such rows are skipped. */
  hasJumpHosts: boolean;
}

export type Protocol = "ssh" | "rdp" | "vnc";

export interface MachineGroup {
  key: string;
  name: string;
  address: string;
  rows: HostRow[];
  protocols: Protocol[];
  agentHost: boolean;
  pingPorts: number[];
}

/** Why a machine has no resource readings. */
export type ResourcesNote = "no_ssh" | "no_access" | "probe_failed";

export interface AdminHostOverview {
  key: string;
  name: string;
  address: string;
  protocols: Protocol[];
  agentHost: boolean;
  online: boolean;
  latencyMs: number | null;
  /** Last time this Skynet process saw the machine respond; null = never. */
  lastSeenAt: number | null;
  resources: HostResources | null;
  resourcesNote: ResourcesNote | null;
  fleet: HostFleetCounts | null;
  /** Agent hosts only; null when no sweep has been attempted yet. */
  substrate: HostSweepStatus | null;
}

export interface AdminHostsResponse {
  hosts: AdminHostOverview[];
  generatedAt: number;
}

/** Outcome of running PROBE_COMMAND on a row. */
export type RemoteExecResult =
  | { ok: true; output: string | null }
  | { ok: false; reason: "no_access" | "connect_failed" };

/** Cap on probing one machine (all candidate rows together). */
export const MACHINE_PROBE_DEADLINE_MS = 15_000;

export interface OverviewDeps {
  listRows(): Promise<HostRow[]>;
  isLocal(hostId: number): boolean;
  execLocal(): Promise<string | null>;
  execRemote(row: HostRow): Promise<RemoteExecResult>;
  tcpPing(ip: string, port: number): Promise<number | null>;
  sweepStatus(hostId: string): HostSweepStatus | null;
  now(): number;
  /** Shared across calls so "last seen" survives between refreshes. */
  lastSeen: Map<string, number>;
  /** Override for tests. */
  probeDeadlineMs?: number;
}

const RDP_SUFFIX = /[-_ ]?rdp$/i;

const sshPortOf = (r: HostRow) => r.sshPort ?? r.port;

/**
 * Group key: the address, except when one address fronts several SSH ports
 * (NAT / port-forwards to different boxes) — then each SSH port is its own
 * machine and non-SSH rows stay on the bare address.
 */
function machineKey(row: HostRow, splitAddresses: Set<string>): string {
  const ip = row.ip.trim().toLowerCase();
  return splitAddresses.has(ip) && row.enableSsh ? `${ip}:${sshPortOf(row)}` : ip;
}

export function groupHostRows(rows: HostRow[]): MachineGroup[] {
  const sshPorts = new Map<string, Set<number>>();
  for (const r of rows) {
    if (!r.enableSsh) continue;
    const ip = r.ip.trim().toLowerCase();
    if (!sshPorts.has(ip)) sshPorts.set(ip, new Set());
    sshPorts.get(ip)!.add(sshPortOf(r));
  }
  const split = new Set(
    [...sshPorts.entries()].filter(([, ports]) => ports.size > 1).map(([ip]) => ip),
  );

  const byAddress = new Map<string, HostRow[]>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const key = machineKey(row, split);
    const list = byAddress.get(key);
    if (list) list.push(row);
    else byAddress.set(key, [row]);
  }

  return [...byAddress.entries()].map(([key, group]) => {
    const named =
      group.find((r) => r.runsFleetSubstrate) ??
      group.find((r) => r.enableSsh) ??
      group[0];
    const name =
      (named.name ?? "").replace(RDP_SUFFIX, "").trim() || named.ip;

    const protocols: Protocol[] = [];
    const ports: number[] = [];
    const add = (p: Protocol, port: number) => {
      if (!protocols.includes(p)) protocols.push(p);
      if (!ports.includes(port)) ports.push(port);
    };
    for (const r of group) {
      if (r.enableSsh) add("ssh", sshPortOf(r));
      if (r.enableRdp) add("rdp", r.rdpPort ?? 3389);
      if (r.enableVnc) add("vnc", r.vncPort ?? 5900);
    }
    // Nothing enabled (a parked entry) — still worth knowing if it's up.
    if (ports.length === 0) {
      for (const p of [named.port, named.rdpPort ?? 3389]) {
        if (!ports.includes(p)) ports.push(p);
      }
    }

    return {
      key,
      name,
      address: named.ip,
      rows: group,
      protocols,
      agentHost: group.some((r) => r.runsFleetSubstrate),
      pingPorts: ports,
    };
  });
}

async function probeMachine(
  group: MachineGroup,
  deps: OverviewDeps,
): Promise<{
  output: string | null;
  attempted: boolean;
  note: ResourcesNote | null;
}> {
  const local = group.rows.find((r) => deps.isLocal(r.id));
  if (local) {
    return { output: await deps.execLocal(), attempted: true, note: null };
  }
  // Substrate row first (system creds, no per-user decrypt), then any
  // SSH-enabled row the admin can open.
  const sshRows = group.rows.filter((r) => r.enableSsh && !r.hasJumpHosts);
  const candidates = [
    ...sshRows.filter((r) => r.runsFleetSubstrate),
    ...sshRows.filter((r) => !r.runsFleetSubstrate),
  ];
  if (candidates.length === 0) {
    return { output: null, attempted: false, note: "no_ssh" };
  }
  let sawConnectFailure = false;
  for (const row of candidates) {
    const res = await deps.execRemote(row);
    if (!("reason" in res)) return { output: res.output, attempted: true, note: null };
    if (res.reason === "connect_failed") sawConnectFailure = true;
  }
  return {
    output: null,
    attempted: sawConnectFailure,
    note: sawConnectFailure ? "probe_failed" : "no_access",
  };
}

export async function buildHostsOverview(
  deps: OverviewDeps,
): Promise<AdminHostsResponse> {
  const groups = groupHostRows(await deps.listRows());

  const hosts = await Promise.all(
    groups.map(async (group): Promise<AdminHostOverview> => {
      const deadline = deps.probeDeadlineMs ?? MACHINE_PROBE_DEADLINE_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const [probe, latencies] = await Promise.all([
        Promise.race([
          probeMachine(group, deps),
          new Promise<Awaited<ReturnType<typeof probeMachine>>>((resolve) => {
            timer = setTimeout(
              () => resolve({ output: null, attempted: true, note: "probe_failed" }),
              deadline,
            );
          }),
        ]).finally(() => clearTimeout(timer)),
        Promise.all(group.pingPorts.map((p) => deps.tcpPing(group.address, p))),
      ]);

      const parsed = parseProbeOutput(probe.output);
      const latencyMs = latencies.find((l) => l !== null) ?? null;
      const online = parsed !== null || latencyMs !== null;
      if (online) deps.lastSeen.set(group.key, deps.now());

      const note: ResourcesNote | null = parsed
        ? null
        : probe.note ?? (probe.attempted ? "probe_failed" : "no_ssh");

      const substrateRow = group.rows.find((r) => r.runsFleetSubstrate);
      return {
        key: group.key,
        name: group.name,
        address: group.address,
        protocols: group.protocols,
        agentHost: group.agentHost,
        online,
        latencyMs,
        lastSeenAt: deps.lastSeen.get(group.key) ?? null,
        resources: parsed?.resources ?? null,
        resourcesNote: note,
        fleet: parsed?.fleet ?? null,
        substrate: substrateRow ? deps.sweepStatus(String(substrateRow.id)) : null,
      };
    }),
  );

  return { hosts, generatedAt: deps.now() };
}
