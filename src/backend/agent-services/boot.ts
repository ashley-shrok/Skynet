/**
 * agent-services/boot.ts — start the engine and its scan loop. Called once
 * from starter.ts; replaces the per-service boot blocks that used to live
 * there.
 */

import type { Client as SSHClientType } from "ssh2";
import { systemLogger } from "../utils/logger.js";
import { listSubstrateHosts } from "../distributor/list-substrate-hosts.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { SSH_CONNECT_TIMEOUT_MS } from "../database/routes/identity-birth-orchestrator.js";
import {
  isLocalHostId,
  writeBinaryFileAtomic,
  writeMarkdownFileAtomic,
} from "../claude-session/identity-artifact-reader.js";
import { createAgentServiceEngine } from "./engine/engine.js";
import {
  createResponseWriter,
  localRequestIo,
  sshRequestIo,
  type SshChannel,
} from "./engine/host-io.js";
import {
  createScanOrchestrator,
  type ScanHostRecord,
} from "./engine/scan-orchestrator.js";
import { AGENT_SERVICES } from "./registry.js";
import { resolveActingUser } from "./user-secrets/acting-user.js";
import { getUserSecret } from "./user-secrets/store.js";

const SCAN_INTERVAL_MS = 10_000;

async function getHostOwnerUserId(hostIdNum: number): Promise<string | null> {
  const rows = await getDb()
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostIdNum))
    .limit(1);
  return rows[0]?.userId ?? null;
}

// Latest system-wrapped (CSKEK) conn details per substrate host, refreshed on
// every scan tick. The response writer uses these so replies never depend on
// the host owner's per-user data key (only in memory during a live session).
const systemConnDetailsByHost = new Map<string, Record<string, unknown>>();

async function listSubstrateHostsCaching() {
  const list = await listSubstrateHosts({ getDb });
  systemConnDetailsByHost.clear();
  for (const h of list) systemConnDetailsByHost.set(h.id, h._connDetails);
  return list;
}

async function getSystemConnDetails(
  hostIdNum: number,
): Promise<Record<string, unknown> | null> {
  const key = String(hostIdNum);
  const cached = systemConnDetailsByHost.get(key);
  if (cached) return cached;
  // Cache miss (e.g. first tick not yet complete) — fetch fresh.
  await listSubstrateHostsCaching();
  return systemConnDetailsByHost.get(key) ?? null;
}

export function startAgentServices(): void {
  const engine = createAgentServiceEngine({
    services: AGENT_SERVICES,
    resolveActingUser,
    loadUserSecret: getUserSecret,
    writeResponse: createResponseWriter({
      isLocalHostId,
      getSystemConnDetails,
      getHostOwnerUserId,
      resolveHostById,
      connect: (hostDetails) =>
        connectOneShot(
          hostDetails as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        ),
      writeTextAtomic: writeMarkdownFileAtomic,
      writeBinaryAtomic: writeBinaryFileAtomic,
    }),
  });

  // Scan connections are reused across ticks for the life of the process.
  const scanClients = new Map<string, SSHClientType>();

  async function acquireChannel(
    host: ScanHostRecord,
  ): Promise<SshChannel | null> {
    try {
      let client = scanClients.get(host.id);
      if (!client) {
        client = await connectOneShot(
          host._connDetails as Parameters<typeof connectOneShot>[0],
          10_000,
        );
        scanClients.set(host.id, client);
        const forget = () => scanClients.delete(host.id);
        client.on("end", forget);
        client.on("close", forget);
        client.on("error", forget);
      }
      // Shared per-host semaphore: bounds exec channels across every SSH
      // producer talking to this host.
      const sem = getHostSemaphore(host.id);
      const c = client;
      return {
        exec: async (cmd) => {
          try {
            return await sem.run(() => execCommand(c, cmd));
          } catch {
            return null;
          }
        },
      };
    } catch (err) {
      const payload = {
        operation: "agent_services_scan_acquire_failed",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : "unknown",
      };
      if (err instanceof Error && err.name === "CircuitBreakerOpenError") {
        systemLogger.info(
          "agent-services scan: SSH acquire refused by breaker",
          payload,
        );
      } else {
        systemLogger.warn("agent-services scan: SSH acquire failed", payload);
      }
      return null;
    }
  }

  const orchestrator = createScanOrchestrator({
    listSubstrateHosts: listSubstrateHostsCaching,
    acquireChannel,
    isLocalHostId,
    sshIo: sshRequestIo,
    localIo: () => localRequestIo(),
    intake: engine.intake,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    scanIntervalMs: SCAN_INTERVAL_MS,
  });

  void orchestrator.start();
  systemLogger.info("Agent services started", {
    operation: "agent_services_started",
    services: AGENT_SERVICES.map((s) => s.name),
    scanIntervalMs: SCAN_INTERVAL_MS,
  });

  process.once("SIGTERM", () => {
    orchestrator.stop();
    engine.stop();
    for (const client of scanClients.values()) {
      try {
        client.end();
      } catch {
        // already gone
      }
    }
    scanClients.clear();
  });
}
