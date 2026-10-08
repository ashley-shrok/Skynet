/**
 * agent-services/engine/scan-orchestrator.ts — one scan loop for every
 * agent service.
 *
 * Every tick (default 10s) it walks the substrate hosts and, for each,
 * claims new files from `~/fleet/service-requests/` and hands them to the
 * engine. One SSH exec per host per tick, however many services exist.
 *
 * Carried over from the per-service scanners it replaces:
 *   - per-host in-flight guard, so a slow host never stacks scans;
 *   - per-host timeout that force-releases the guard if a scan wedges;
 *   - local host read through the bind mount instead of SSH-to-self;
 *   - never-throw start()/stop().
 */

import { systemLogger } from "../../utils/logger.js";
import type { HostRequestIo, SshChannel } from "./host-io.js";
import type { ClaimedFile } from "./protocol.js";

export interface ScanHostRecord {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
}

export interface ScanOrchestratorDeps {
  listSubstrateHosts(): Promise<ScanHostRecord[]>;
  acquireChannel(host: ScanHostRecord): Promise<SshChannel | null>;
  isLocalHostId(hostIdNum: number): boolean;
  sshIo(hostId: string, channel: SshChannel): HostRequestIo;
  localIo(): HostRequestIo;
  intake(
    host: { id: string; idNum: number },
    io: HostRequestIo,
    claimed: ClaimedFile[],
  ): Promise<void>;
  setInterval(
    fn: () => Promise<void> | void,
    ms: number,
  ): ReturnType<typeof setInterval>;
  clearInterval(h: ReturnType<typeof setInterval>): void;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(h: ReturnType<typeof setTimeout>): void;
  scanIntervalMs?: number;
  scanTimeoutMs?: number;
}

export interface ScanOrchestrator {
  start(): Promise<void>;
  stop(): void;
  getScanTickCount(): number;
}

export function createScanOrchestrator(
  deps: ScanOrchestratorDeps,
): ScanOrchestrator {
  const scanIntervalMs = deps.scanIntervalMs ?? 10_000;
  const scanTimeoutMs = deps.scanTimeoutMs ?? 30_000;
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let tick = 0;
  let stopped = false;

  async function scanOneHost(host: ScanHostRecord): Promise<void> {
    const idNum = parseInt(host.id, 10);
    try {
      let io: HostRequestIo;
      if (deps.isLocalHostId(idNum)) {
        io = deps.localIo();
      } else {
        const channel = await deps.acquireChannel(host);
        if (channel === null) return; // acquireChannel logs its own failure
        io = deps.sshIo(host.id, channel);
      }
      const claimed = await io.claim();
      if (claimed.length === 0) return;
      systemLogger.info("agent-services scan: claimed requests", {
        operation: "agent_services_scan_claimed",
        fleetHostId: host.id,
        hostName: host.name,
        claimed: claimed.length,
      });
      await deps.intake({ id: host.id, idNum }, io, claimed);
    } catch (err) {
      systemLogger.warn("agent-services scan: host scan threw", {
        operation: "agent_services_scan_host_threw",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  async function scanAllHosts(): Promise<void> {
    if (stopped) return;
    tick++;
    let hosts: ScanHostRecord[];
    try {
      hosts = await deps.listSubstrateHosts();
    } catch (err) {
      systemLogger.warn("agent-services scan: host list failed", {
        operation: "agent_services_scan_host_list_failed",
        error: err instanceof Error ? err.message : "unknown",
        tick,
      });
      return;
    }
    for (const host of hosts) {
      if (inFlight.has(host.id)) continue;
      inFlight.add(host.id);
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        inFlight.delete(host.id);
      };
      const timeout = deps.setTimeout(() => {
        if (settled) return;
        systemLogger.warn(
          "agent-services scan: host scan timed out, releasing guard",
          {
            operation: "agent_services_scan_timeout",
            fleetHostId: host.id,
            scanTimeoutMs,
            tick,
          },
        );
        release();
      }, scanTimeoutMs);
      void scanOneHost(host).finally(() => {
        deps.clearTimeout(timeout);
        release();
      });
    }
  }

  return {
    async start() {
      stopped = false;
      try {
        await scanAllHosts();
      } catch {
        // scanAllHosts never throws; belt and braces for the boot path
      }
      timer = deps.setInterval(scanAllHosts, scanIntervalMs);
      systemLogger.info("agent-services scan orchestrator started", {
        operation: "agent_services_scan_started",
        scanIntervalMs,
      });
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        deps.clearInterval(timer);
        timer = null;
      }
      inFlight.clear();
    },
    getScanTickCount() {
      return tick;
    },
  };
}
