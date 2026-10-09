import { describe, expect, it } from "vitest";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { PROBE_COMMAND, REMOTE_PROBE_COMMAND, parseProbeOutput, tcpPing } from "./host-probe.js";

const FLEET_OUTPUT = [
  "os=Ubuntu 24.04.4 LTS",
  "arch=x86_64",
  "uptime=2711069.56",
  "cores=4",
  "load=3.65",
  "memTotalKb=15990360",
  "memAvailKb=11903288",
  "diskTotalKb=100476656",
  "diskUsedKb=54723324",
  "diskAvailKb=45736948",
  "fleet=1",
  "agents=60",
  "apps=2",
  "running=4",
  "supervisor=1",
  "probe=ok",
].join("\n");

describe("parseProbeOutput", () => {
  it("parses resources and fleet counts", () => {
    const r = parseProbeOutput(FLEET_OUTPUT)!;
    expect(r.resources).toEqual({
      os: "Ubuntu 24.04.4 LTS",
      arch: "x86_64",
      uptimeSec: 2711069.56,
      cores: 4,
      load1: 3.65,
      memTotalKb: 15990360,
      memAvailKb: 11903288,
      diskTotalKb: 100476656,
      diskUsedKb: 54723324,
      diskAvailKb: 45736948,
    });
    expect(r.fleet).toEqual({ agents: 60, running: 4, apps: 2, supervisorRunning: true });
  });

  it("returns fleet null on a non-fleet host", () => {
    const out = FLEET_OUTPUT.split("\n")
      .filter((l) => !/^(fleet|agents|apps|running|supervisor)=/.test(l))
      .join("\n");
    expect(parseProbeOutput(out)!.fleet).toBeNull();
  });

  it("reports supervisor down", () => {
    const r = parseProbeOutput(FLEET_OUTPUT.replace("supervisor=1", "supervisor=0"))!;
    expect(r.fleet!.supervisorRunning).toBe(false);
  });

  it("rejects output without the probe=ok terminator", () => {
    expect(parseProbeOutput(FLEET_OUTPUT.replace("probe=ok", ""))).toBeNull();
    expect(parseProbeOutput("'h' is not recognized as an internal command")).toBeNull();
    expect(parseProbeOutput(null)).toBeNull();
  });

  it("nulls blank or non-numeric fields instead of guessing", () => {
    const r = parseProbeOutput("os=\ncores=abc\nprobe=ok")!;
    expect(r.resources.os).toBeNull();
    expect(r.resources.cores).toBeNull();
    expect(r.resources.memTotalKb).toBeNull();
  });

  it("tolerates CRLF line endings", () => {
    expect(parseProbeOutput("cores=8\r\nprobe=ok\r\n")!.resources.cores).toBe(8);
  });
});

describe("tcpPing", () => {
  it("returns a latency for an open port and null for a closed one", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    expect(await tcpPing("127.0.0.1", port)).toBeTypeOf("number");
    await new Promise<void>((r) => server.close(() => r()));
    expect(await tcpPing("127.0.0.1", port, 500)).toBeNull();
  });
});

describe("REMOTE_PROBE_COMMAND", () => {
  it("runs from a non-bash shell and yields the same parseable output", () => {
    const viaSh = execFileSync("sh", ["-c", REMOTE_PROBE_COMMAND]).toString();
    const direct = execFileSync("bash", ["-c", PROBE_COMMAND]).toString();
    const a = parseProbeOutput(viaSh)!;
    const b = parseProbeOutput(direct)!;
    expect(a).not.toBeNull();
    expect(a.resources.os).toBe(b.resources.os);
    expect(a.resources.cores).toBe(b.resources.cores);
  });
});
