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
}

const RDP_SUFFIX = /[-_ ]?rdp$/i;

export function groupHostRows(rows: HostRow[]): MachineGroup[] {
  const byAddress = new Map<string, HostRow[]>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const key = row.ip.trim().toLowerCase();
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
      if (r.enableSsh) add("ssh", r.sshPort ?? r.port);
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
  const candidates = [
    ...group.rows.filter((r) => r.runsFleetSubstrate && r.enableSsh),
    ...group.rows.filter((r) => !r.runsFleetSubstrate && r.enableSsh),
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
      const [probe, latencies] = await Promise.all([
        probeMachine(group, deps),
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
