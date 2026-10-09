/**
 * Host probe for the admin Hosts overview — one shell command that reads a
 * Linux host's resources (and, on fleet hosts, its agent counts) as
 * `key=value` lines, plus the parser and a plain TCP reachability ping for
 * hosts we can't (or don't) run commands on.
 *
 * The command reads /proc directly rather than `ps` / `systemctl` so it works
 * the same over SSH and inside the Skynet container (pid: host, HOME rewritten
 * to the bind-mounted host home by the local channel). OS name tries
 * /proc/1/root first so the local probe reports the host's distro, not the
 * container's; non-root SSH users can't read that and fall back to
 * /etc/os-release, which is already the host's.
 */

import net from "node:net";

export const PROBE_COMMAND = [
  `h="$HOME"`,
  `osr=$( (cat /proc/1/root/etc/os-release || cat /etc/os-release) 2>/dev/null | sed -n 's/^PRETTY_NAME="\\{0,1\\}\\([^"]*\\)"\\{0,1\\}$/\\1/p' | head -1)`,
  `echo "os=$osr"`,
  `echo "arch=$(uname -m)"`,
  `echo "uptime=$(cut -d' ' -f1 /proc/uptime)"`,
  `echo "cores=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"`,
  `echo "load=$(cut -d' ' -f1 /proc/loadavg)"`,
  `awk '/^MemTotal:/{print "memTotalKb="$2} /^MemAvailable:/{print "memAvailKb="$2}' /proc/meminfo`,
  `df -Pk "$h" 2>/dev/null | awk 'NR==2{print "diskTotalKb="$2; print "diskUsedKb="$3; print "diskAvailKb="$4}'`,
  `if [ -d "$h/fleet" ]; then`,
  `  echo "fleet=1"`,
  `  echo "agents=$(find "$h/fleet/identities" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"`,
  `  echo "apps=$(find "$h/fleet/apps" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"`,
  `  echo "running=$(cat /proc/[0-9]*/comm 2>/dev/null | grep -cx claude)"`,
  `  if cat /proc/[0-9]*/comm 2>/dev/null | grep -qx agent-superviso; then echo supervisor=1; else echo supervisor=0; fi`,
  `fi`,
  `echo "probe=ok"`,
].join("\n");

export interface HostResources {
  os: string | null;
  arch: string | null;
  uptimeSec: number | null;
  cores: number | null;
  load1: number | null;
  memTotalKb: number | null;
  memAvailKb: number | null;
  diskTotalKb: number | null;
  diskUsedKb: number | null;
  diskAvailKb: number | null;
}

export interface HostFleetCounts {
  agents: number;
  running: number;
  apps: number;
  supervisorRunning: boolean;
}

export interface ProbeResult {
  resources: HostResources;
  /** Null when the host has no ~/fleet folder (not an agent host). */
  fleet: HostFleetCounts | null;
}

/**
 * Parse PROBE_COMMAND output. Returns null unless the `probe=ok` terminator
 * is present — a Windows shell or a truncated exec yields garbage, and we'd
 * rather show "no readings" than half-parsed numbers.
 */
export function parseProbeOutput(text: string | null): ProbeResult | null {
  if (!text) return null;
  const kv = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  if (kv.get("probe") !== "ok") return null;

  const num = (k: string): number | null => {
    const v = kv.get(k);
    if (v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (k: string): string | null => kv.get(k) || null;

  const resources: HostResources = {
    os: str("os"),
    arch: str("arch"),
    uptimeSec: num("uptime"),
    cores: num("cores"),
    load1: num("load"),
    memTotalKb: num("memTotalKb"),
    memAvailKb: num("memAvailKb"),
    diskTotalKb: num("diskTotalKb"),
    diskUsedKb: num("diskUsedKb"),
    diskAvailKb: num("diskAvailKb"),
  };
  const fleet =
    kv.get("fleet") === "1"
      ? {
          agents: num("agents") ?? 0,
          running: num("running") ?? 0,
          apps: num("apps") ?? 0,
          supervisorRunning: kv.get("supervisor") === "1",
        }
      : null;
  return { resources, fleet };
}

/**
 * Open a TCP connection to host:port and close it. Resolves with the connect
 * latency in ms, or null on refusal / timeout. Never rejects.
 */
export function tcpPing(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const sock = net.connect({ host, port });
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => finish(null));
    sock.once("connect", () => finish(Date.now() - start));
    sock.once("error", () => finish(null));
  });
}
