import { describe, expect, it, vi } from "vitest";
import {
  buildHostsOverview,
  groupHostRows,
  type HostRow,
  type OverviewDeps,
} from "./hosts-overview.js";

function row(p: Partial<HostRow> & { id: number; ip: string }): HostRow {
  return {
    name: null,
    port: 22,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    enableSsh: false,
    enableRdp: false,
    enableVnc: false,
    runsFleetSubstrate: false,
    hasJumpHosts: false,
    ...p,
  };
}

const PROBE_OK = "cores=4\nload=1\nmemTotalKb=100\nmemAvailKb=50\nfleet=1\nagents=3\napps=0\nrunning=1\nsupervisor=1\nprobe=ok";

function deps(over: Partial<OverviewDeps> = {}): OverviewDeps {
  return {
    listRows: async () => [],
    isLocal: () => false,
    execLocal: async () => PROBE_OK,
    execRemote: async () => ({ ok: true, output: PROBE_OK }),
    tcpPing: async () => 12,
    sweepStatus: () => null,
    now: () => 1000,
    lastSeen: new Map(),
    ...over,
  };
}

describe("groupHostRows", () => {
  it("merges SSH + RDP rows and other users' rows for the same address", () => {
    const groups = groupHostRows([
      row({ id: 5, name: "thenasty-RDP", ip: "100.1.1.1", port: 3389, enableRdp: true }),
      row({ id: 3, name: "thenasty", ip: "100.1.1.1", enableSsh: true, runsFleetSubstrate: true }),
      row({ id: 22, name: "thenasty", ip: "100.1.1.1", enableSsh: true }),
      row({ id: 11, name: "aither-cloud-prod-RDP", ip: "172.31.0.1", port: 3389, enableRdp: true }),
    ]);
    expect(groups).toHaveLength(2);
    const nasty = groups.find((g) => g.address === "100.1.1.1")!;
    expect(nasty.name).toBe("thenasty");
    expect(nasty.agentHost).toBe(true);
    expect(nasty.protocols).toEqual(["ssh", "rdp"]);
    expect(nasty.pingPorts).toEqual([22, 3389]);
    expect(nasty.rows.map((r) => r.id)).toEqual([3, 5, 22]);
    // RDP-only machine: suffix stripped from the display name.
    expect(groups.find((g) => g.address === "172.31.0.1")!.name).toBe("aither-cloud-prod");
  });

  it("splits one address fronting several SSH ports into separate machines", () => {
    const groups = groupHostRows([
      row({ id: 1, name: "vm-a", ip: "10.0.0.1", sshPort: 2201, enableSsh: true }),
      row({ id: 2, name: "vm-b", ip: "10.0.0.1", sshPort: 2202, enableSsh: true }),
      row({ id: 3, name: "gw-RDP", ip: "10.0.0.1", port: 3389, enableRdp: true }),
    ]);
    expect(groups.map((g) => g.key).sort()).toEqual(["10.0.0.1", "10.0.0.1:2201", "10.0.0.1:2202"]);
    expect(groups.find((g) => g.key === "10.0.0.1:2202")!.name).toBe("vm-b");
  });

  it("pings SSH and RDP ports when a parked entry has nothing enabled", () => {
    const [g] = groupHostRows([row({ id: 10, name: "DESKTOPPC", ip: "100.2.2.2" })]);
    expect(g.protocols).toEqual([]);
    expect(g.pingPorts).toEqual([22, 3389]);
  });
});

describe("buildHostsOverview", () => {
  it("probes over the substrate row first and reports resources + fleet", async () => {
    const execRemote = vi.fn(async () => ({ ok: true as const, output: PROBE_OK }));
    const res = await buildHostsOverview(
      deps({
        listRows: async () => [
          row({ id: 22, ip: "a", enableSsh: true }),
          row({ id: 3, ip: "a", enableSsh: true, runsFleetSubstrate: true }),
        ],
        execRemote,
        sweepStatus: (id) =>
          id === "3"
            ? { lastSuccessAt: 900, lastFailureAt: null, lastError: null, consecutiveFailures: 0, inFlight: false }
            : null,
      }),
    );
    expect(execRemote).toHaveBeenCalledTimes(1);
    expect((execRemote.mock.calls[0] as unknown as [HostRow])[0].id).toBe(3);
    const [h] = res.hosts;
    expect(h.online).toBe(true);
    expect(h.resources?.cores).toBe(4);
    expect(h.fleet).toEqual({ agents: 3, running: 1, apps: 0, supervisorRunning: true });
    expect(h.substrate?.lastSuccessAt).toBe(900);
    expect(h.resourcesNote).toBeNull();
  });

  it("runs the probe locally for the Skynet box itself", async () => {
    const execRemote = vi.fn();
    const res = await buildHostsOverview(
      deps({
        listRows: async () => [row({ id: 6, ip: "me", enableSsh: true, runsFleetSubstrate: true })],
        isLocal: (id) => id === 6,
        execRemote,
      }),
    );
    expect(execRemote).not.toHaveBeenCalled();
    expect(res.hosts[0].resources?.cores).toBe(4);
  });

  it("falls back to another SSH row when the first can't be decrypted", async () => {
    const execRemote = vi.fn(async (r: HostRow) =>
      r.id === 21 ? ({ ok: false, reason: "no_access" } as const) : ({ ok: true, output: PROBE_OK } as const),
    );
    const res = await buildHostsOverview(
      deps({
        listRows: async () => [row({ id: 21, ip: "w", enableSsh: true }), row({ id: 30, ip: "w", enableSsh: true })],
        execRemote,
      }),
    );
    expect(execRemote).toHaveBeenCalledTimes(2);
    expect(res.hosts[0].resources).not.toBeNull();
  });

  it("skips rows that need a jump host", async () => {
    const execRemote = vi.fn();
    const res = await buildHostsOverview(
      deps({ listRows: async () => [row({ id: 60, ip: "j", enableSsh: true, hasJumpHosts: true })], execRemote }),
    );
    expect(execRemote).not.toHaveBeenCalled();
    expect(res.hosts[0].resourcesNote).toBe("no_ssh");
  });

  it("gives up on a machine whose probe overruns the deadline", async () => {
    const res = await buildHostsOverview(
      deps({
        listRows: async () => [row({ id: 70, ip: "slow", enableSsh: true })],
        execRemote: () => new Promise(() => {}),
        probeDeadlineMs: 20,
      }),
    );
    expect(res.hosts[0].resources).toBeNull();
    expect(res.hosts[0].resourcesNote).toBe("probe_failed");
    expect(res.hosts[0].online).toBe(true);
  });

  it("marks RDP-only machines online via TCP with a no_ssh note", async () => {
    const res = await buildHostsOverview(
      deps({ listRows: async () => [row({ id: 11, ip: "r", port: 3389, enableRdp: true })] }),
    );
    const [h] = res.hosts;
    expect(h.online).toBe(true);
    expect(h.latencyMs).toBe(12);
    expect(h.resources).toBeNull();
    expect(h.resourcesNote).toBe("no_ssh");
    expect(h.substrate).toBeNull();
  });

  it("reports no_access when the admin holds no credentials for any SSH row", async () => {
    const res = await buildHostsOverview(
      deps({
        listRows: async () => [row({ id: 40, ip: "x", enableSsh: true })],
        execRemote: async () => ({ ok: false, reason: "no_access" }),
      }),
    );
    expect(res.hosts[0].resourcesNote).toBe("no_access");
    expect(res.hosts[0].online).toBe(true);
  });

  it("goes offline and keeps last-seen from an earlier build", async () => {
    const lastSeen = new Map<string, number>();
    const rows = async () => [row({ id: 13, ip: "l", enableSsh: true })];
    await buildHostsOverview(deps({ listRows: rows, lastSeen, now: () => 500 }));
    const res = await buildHostsOverview(
      deps({
        listRows: rows,
        lastSeen,
        now: () => 9000,
        tcpPing: async () => null,
        execRemote: async () => ({ ok: false, reason: "connect_failed" }),
      }),
    );
    const [h] = res.hosts;
    expect(h.online).toBe(false);
    expect(h.lastSeenAt).toBe(500);
    expect(h.resourcesNote).toBe("probe_failed");
  });

  it("treats garbage probe output as no readings but still online by TCP", async () => {
    const res = await buildHostsOverview(
      deps({
        listRows: async () => [row({ id: 50, ip: "win", enableSsh: true })],
        execRemote: async () => ({ ok: true, output: "not a shell" }),
      }),
    );
    expect(res.hosts[0].resources).toBeNull();
    expect(res.hosts[0].resourcesNote).toBe("probe_failed");
    expect(res.hosts[0].online).toBe(true);
  });
});
