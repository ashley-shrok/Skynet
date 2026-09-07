import dotenv from "dotenv";
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AutoSSLSetup } from "./utils/auto-ssl-setup.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { SystemCrypto } from "./utils/system-crypto.js";
import {
  systemLogger,
  versionLogger,
  setGlobalLogLevel,
} from "./utils/logger.js";
import { flushBackendLogs } from "./utils/console-forward-transport.js";
import type { SshChannel } from "./fleet-status/ssh-poll-orchestrator.js";

// ---------------------------------------------------------------------------
// Phase 39 Plan 04 (D-05 / GATE2-05): Module-scope helper for fire-and-forget
// Stop-hook install on first successful acquireSshChannel per host.
//
// Extracted to module scope (per plan-check WARNING 2) so starter.test.ts can
// import + call directly without driving the whole boot-time IIFE. All deps
// are injected via `deps` — the helper is pure w.r.t. installStopHook and
// the logger.
//
// Semantics:
//   - Install-once-per-lifecycle: guarded by the hookInstallAttempted Set
//     passed in from the caller. Caller is expected to clear the Set inside
//     onLastUnsubscriber (see fleet-status IIFE) so subsequent lifecycles
//     re-attempt install. installStopHook itself is idempotent per RESEARCH
//     §Q5 (readAndMergeStopHookSettings alreadyInstalled short-circuit).
//   - Fire-and-forget: the helper never awaits the install-hook promise —
//     the surrounding acquireSshChannel returns immediately so the poll
//     cycle proceeds without blocking on the install. The .catch handler
//     is REQUIRED — the install returns a Promise; an unhandled rejection
//     would crash the process (documented in the starter's
//     unhandledRejection handler at the bottom of the IIFE).
//   - Failure does not invalidate the acquire — the SshChannel is still
//     returned to the orchestrator for polling. RESEARCH §Common Pitfalls
//     does not list install-failure as a poll blocker.
// ---------------------------------------------------------------------------
export function maybeInstallStopHook(
  hostId: string,
  channelAdapter: SshChannel,
  hookInstallAttempted: Set<string>,
  deps: {
    installStopHook: (channel: SshChannel) => Promise<{
      hookInstalled: boolean;
      settingsUpdated: boolean;
    }>;
    systemLogger: typeof systemLogger;
  },
): void {
  if (hookInstallAttempted.has(hostId)) return;
  hookInstallAttempted.add(hostId);
  deps.systemLogger.info("Fleet-status stop-hook install started", {
    operation: "fleet_status_hook_install_started",
    fleetHostId: hostId,
  });
  deps.installStopHook(channelAdapter)
    .then((result) => {
      deps.systemLogger.info("Fleet-status stop-hook install completed", {
        operation: "fleet_status_hook_install_success",
        fleetHostId: hostId,
        hookInstalled: result.hookInstalled,
        settingsUpdated: result.settingsUpdated,
      });
    })
    .catch((err) => {
      deps.systemLogger.warn("Fleet-status stop-hook install failed", {
        operation: "fleet_status_hook_install_failed",
        fleetHostId: hostId,
        error: err instanceof Error ? err.message : "unknown",
      });
    });
}

// ---------------------------------------------------------------------------
// Bounty b31a5c8e-7f2d-4c91-a4b6-8e9f1c3b7d24 — per-connection SSH exec
// throttle. OpenSSH default MaxSessions=10 (universal since OpenSSH 5.1,
// 2008) is per-CONNECTION, not per-host-global (sshd_config man page: "the
// maximum number of open shell, login or subsystem sessions permitted per
// network connection"). We cap Skynet's own exec-channel concurrency at 8
// per (host, SSH connection) — this leaves 2 channels of headroom on our
// own connection's bucket and cannot starve any other legitimate SSH
// client on any target box (they each get their own private 10-cap
// bucket). This eliminates CHANNEL_OPEN_FAILURE bursts from the
// fleet-status poller under any target host's default sshd config, with
// zero call-site changes to ssh-poll-orchestrator.ts (its Promise.all
// fan-outs queue implicitly).
//
// Contract:
//   - `run(fn)` runs fn() when a slot is free; otherwise queues FIFO.
//   - Slot decrement + queue drain happen in try/finally so a throwing
//     fn() still releases its slot and wakes the next waiter.
//   - Errors from fn() propagate unchanged — the semaphore does NOT catch
//     or transform them. The channel adapter's outer try/catch → null
//     remains the SOLE null-conversion point in the exec pipeline.
//   - No timing / no timeouts. Pure counting semaphore with a FIFO queue.
// ---------------------------------------------------------------------------
export function makeSemaphore(limit: number): {
  run<T>(fn: () => Promise<T>): Promise<T>;
} {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        const next = waiters.shift();
        if (next) next();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 72 Plan 05 — projection helper for the `runs_fleet_substrate` opt-in
// flag added to the hosts table in Plan 02 (Drizzle:
// `runsFleetSubstrate: integer("runs_fleet_substrate", { mode: "boolean" })
// .notNull().default(false)`).
//
// Extracted to module scope (mirrors `maybeInstallStopHook` at line 43 and
// `makeSemaphore` at line 102) so starter.test.ts can cover it directly
// without booting the fleet-status IIFE.
//
// Fail-closed rule (dispatch order):
//   1. raw === true   → true
//   2. raw === 1      → true (raw-SQL escape hatch that bypasses drizzle's
//                       `{ mode: "boolean" }` coercion)
//   3. anything else  → false (false, 0, null, undefined, strings, etc.)
//
// Drizzle's `{ mode: "boolean" }` coercion normally hands back true/false;
// the helper accepts the wider `boolean | number | null` union to survive
// two escape hatches:
//   - Legacy NULL rows from an ALTER TABLE ADD COLUMN backfill edge case
//     (the migration `.default(false)` covers new writes, but an older row
//     inserted before the migration could sit at NULL).
//   - A raw-SQL read that bypasses drizzle's coercion layer (unlikely in
//     the current codebase, but the helper is the single normalization
//     point so future raw-SQL escape hatches still land at fail-closed).
//
// Consumers see the strict `boolean` field
// `IdentityHostingHostRecord.runsFleetSubstrate`
// declared in `src/backend/fleet-status/ssh-poll-orchestrator.ts`, which the
// Plan 04 fleet-substrate sweep hook reads at the tryAcquireHostChannel
// site to gate the once-per-host-per-instance runSweepForHost call.
// ---------------------------------------------------------------------------
export function projectRunsFleetSubstrate(row: {
  runsFleetSubstrate?: boolean | number | null;
}): boolean {
  const raw = row.runsFleetSubstrate;
  if (raw === true || raw === 1) return true;
  return false; // fail-closed on false / 0 / null / undefined / any other shape
}

// Guard the boot IIFE so test imports of exported helpers (Phase 39-04) do
// not trigger real backend initialization (dotenv, DB init, SSL setup, WS
// servers). Vitest sets process.env.VITEST === "true" automatically.
if (process.env.VITEST !== "true") {
(async () => {
  const initStartTime = Date.now();
  try {
    dotenv.config({ quiet: true });

    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");
    try {
      await fs.access(envPath);
      const persistentConfig = dotenv.config({ path: envPath, quiet: true });
      if (persistentConfig.parsed) {
        Object.assign(process.env, persistentConfig.parsed);
      }
    } catch {
      // expected - env file may not exist
    }

    systemLogger.info("Skynet backend initialization started", {
      operation: "backend_init_start",
      nodeEnv: process.env.NODE_ENV || "production",
      port: process.env.PORT || 4090,
    });

    let version = "unknown";

    const versionSources = [
      () => process.env.VERSION,
      () => {
        try {
          const packageJsonPath = path.join(process.cwd(), "package.json");
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
          return packageJson.version;
        } catch {
          return null;
        }
      },
      () => {
        try {
          const __filename = fileURLToPath(import.meta.url);
          const packageJsonPath = path.join(
            path.dirname(__filename),
            "../../../package.json",
          );
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
          return packageJson.version;
        } catch {
          return null;
        }
      },
      () => {
        try {
          const packageJsonPath = path.join("/app", "package.json");
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          );
          return packageJson.version;
        } catch {
          return null;
        }
      },
    ];

    for (const getVersion of versionSources) {
      try {
        const foundVersion = getVersion();
        if (foundVersion && foundVersion !== "unknown") {
          version = foundVersion;
          break;
        }
      } catch {
        continue;
      }
    }
    versionLogger.info(`Skynet Backend starting - Version: ${version}`, {
      operation: "startup",
      version: version,
    });

    const systemCrypto = SystemCrypto.getInstance();
    await systemCrypto.initializeJWTSecret();
    await systemCrypto.initializeDatabaseKey();
    await systemCrypto.initializeEncryptionKey();
    await systemCrypto.initializeInternalAuthToken();

    await AutoSSLSetup.initialize();
    systemLogger.success("SSL setup completed", {
      operation: "backend_init_ssl",
      sslEnabled: process.env.SSL_ENABLED === "true",
    });

    const dbModule = await import("./database/db/index.js");
    await dbModule.initializeDatabase();
    systemLogger.success("Database initialized", {
      operation: "backend_init_db",
    });

    // Phase 79 Plan 04 — bridge-config-writer
    // Write /state/config.env + registry.json + <human>.token
    // + <identityKey>.bottoken files for the tg-bridge Docker service.
    // Fire-and-forget: bridge tolerates a 5-min cold-start delay per
    // RESEARCH.md § Assumption A9. Failure here is non-fatal — Plan 08's
    // reconcile loop will re-attempt any missing human tokens on its
    // next tick, and Plan 03's /telegram/activate handler calls
    // rewriteRegistryFromCurrentState on every activation so
    // first-user-activation self-heals a startup miss.
    // See CONTEXT § 4C for the reliability check.
    void import("./telegram/bridge-config-writer.js")
      .then((m) => m.ensureBridgeConfigWritten())
      .catch((err) => {
        systemLogger.warn("ensureBridgeConfigWritten failed at startup", {
          operation: "bridge_config_write_startup_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

    // Phase 79 Plan 08 — start the 30s reconcile-dead-tokens loop.
    // Reactive-to-401s only (RESEARCH § Q6 — admin-minted tokens don't
    // TTL-expire). Fire-and-forget: startReconcileLoop returns a timer
    // handle that we don't store (loop runs for container lifetime).
    // Errors inside the loop log a warn and continue; the loop never
    // crashes the container (T-79-08-06).
    //
    // Ordering (blocker W-1): this block MUST come after the Plan 04
    // `bridge_config_write_startup_failed` block; the reconcile loop
    // assumes the shared volume has been initialized (config.env +
    // registry.json + at least an initial pass at .token / .bottoken
    // files).
    void import("./telegram/reconcile-dead-tokens.js")
      .then((m) => {
        m.startReconcileLoop(30_000);
      })
      .catch((err) => {
        systemLogger.warn("startReconcileLoop failed to start", {
          operation: "reconcile_dead_tokens_start_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

    // Phase 83 Plan 03 — start the 30s reconcile-pending-chat-ids loop.
    // Reads /state/<agent>.pending-chat-id sentinels the bridge writes when
    // tg_poller sees an unknown chat_id (Plan 83-01), persists chat_id to
    // telegram_bot_tokens.telegramChatId, and triggers registry rewrite.
    // Fire-and-forget: startReconcilePendingChatIdsLoop returns a
    // .unref()'d timer handle that we don't store. Errors inside the loop
    // log a warn and continue; the loop never crashes the container
    // (T-83-03 mirrors T-79-08-06 fail-open contract).
    //
    // Ordering: MUST come after the Plan 04 bridge_config_write block AND
    // after reconcile-dead-tokens (same shared-volume assumption). Placed
    // as a sibling of reconcile-dead-tokens for symmetry — both loops
    // consume /state sentinels at the same cadence.
    void import("./telegram/reconcile-pending-chat-ids.js")
      .then((m) => {
        m.startReconcilePendingChatIdsLoop(30_000);
      })
      .catch((err) => {
        systemLogger.warn("startReconcilePendingChatIdsLoop failed to start", {
          operation: "reconcile_pending_chat_id_start_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

    // Phase 74: fail-fast if the branding config lacks a non-empty
    // avatarDirectorSpec. Placed AFTER initializeDatabase() so the DB
    // logger stream is live, and BEFORE AuthManager + the dbServer
    // route mounts at L292 so no HTTP routes come up if the gate fires.
    const { assertBrandingConfigAtBoot } = await import(
      "./branding/assert-boot.js"
    );
    await assertBrandingConfigAtBoot();

    const authManager = AuthManager.getInstance();
    await authManager.initialize();
    DataCrypto.initialize();

    import("./utils/opkssh-binary-manager.js").then(
      ({ OPKSSHBinaryManager }) => {
        OPKSSHBinaryManager.ensureBinary().catch((error) => {
          const dataDir =
            process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
          systemLogger.warn(
            "Failed to initialize OPKSSH binary - OPKSSH authentication will not be available",
            {
              operation: "opkssh_binary_init_failed",
              error: error instanceof Error ? error.message : "Unknown error",
              stack: error instanceof Error ? error.stack : undefined,
              platform: process.platform,
              arch: process.arch,
              dataDir,
            },
          );
        });
      },
    );

    const dbServer = await import("./database/database.js");
    await (dbServer as unknown as { serverReady: Promise<void> }).serverReady;
    await import("./ssh/terminal.js");
    await import("./claude-session/claude-session-server.js");
    await import("./ssh/tunnel.js");
    await import("./ssh/file-manager.js");
    await import("./ssh/server-stats.js");
    await import("./ssh/docker.js");
    await import("./ssh/docker-console.js");
    await import("./dashboard.js");

    // Phase 34-02: Fleet-status broadcast WebSocket server (port 30012)
    // Phase 34-04: SSH-poll orchestrator wired in after server start
    {
      const { startFleetStatusServer } = await import(
        "./fleet-status/fleet-status-server.js"
      );
      const { createSubscriptionRegistry } = await import(
        "./fleet-status/subscription-registry.js"
      );
      const { resolveHostRecordByName } = await import(
        "./fleet-status/host-id-resolver.js"
      );
      const { createSshPollOrchestrator } = await import(
        "./fleet-status/ssh-poll-orchestrator.js"
      );
      const { connectOneShot } = await import("./ssh/ssh-one-shot.js");
      const { execCommand } = await import("./ssh/tmux-helper.js");
      const { getDb } = await import("./database/db/index.js");
      const { hosts: hostsTable } = await import(
        "./database/db/schema.js"
      );
      const { eq } = await import("drizzle-orm");
      // Phase 39 D-03 (GATE2-03): canonical decrypt path — same wrapper used by
      // sessions.ts, identity-birth.ts, roles-create.ts, guacamole/routes.ts.
      // Reads hosts via SimpleDBOps.select(..., "ssh_data", userId) which
      // unconditionally runs DataCrypto.decryptRecords before returning.
      const { resolveHostById } = await import("./ssh/host-resolver.js");
      // Phase 39 D-05 (GATE2-05): blind Stop-hook install per host (LOCKED
      // 2026-08-13 by researcher — no probe-first). installStopHook is
      // idempotent per RESEARCH §Q5; readAndMergeStopHookSettings detects
      // alreadyInstalled and short-circuits the write path.
      const { installStopHook } = await import(
        "./fleet-status/remote-hook-install.js"
      );

      // The subscription registry is shared between the WS server and the orchestrator
      const registry = createSubscriptionRegistry();

      startFleetStatusServer({
        port: 30012,
        authManager,
        registry,
        resolveHostRecordByName,
      });
      systemLogger.info("Fleet-status WS server initialized", {
        operation: "fleet_status_init",
        port: 30012,
      });

      // --- Phase 34-04: SSH-poll orchestrator ---

      /**
       * Query the DB for identity-hosting hosts — hosts that have SSH enabled.
       *
       * Phase 39 D-03 (GATE2-03): decrypts each host's credentials via the
       * canonical resolveHostById(id, userId) path so ssh2 receives PLAINTEXT
       * key/password material. Previously this function read raw drizzle
       * selects on hostsTable.key/password/keyPassword — Skynet's per-record
       * ciphertext, which ssh2 rejects as invalid key (the "all hosts
       * unreachable" pattern in the logs). See 39-CONTEXT §Root cause.
       *
       * The subject userId is the currently-subscribing user — captured into
       * `currentSubscriberUserId` by the registry.onFirstSubscriber callback
       * below. orchestrator.start() only runs inside that callback, so at the
       * time this function is called `currentSubscriberUserId` is always set.
       */
      async function listIdentityHostingHosts() {
        // Defence-in-depth: should never happen because start() lives behind
        // onFirstSubscriber which assigns currentSubscriberUserId first.
        if (!currentSubscriberUserId) {
          systemLogger.warn(
            "Fleet-status: listIdentityHostingHosts called with no active subscriber userId",
            {
              operation: "fleet_status_host_list_no_user",
            },
          );
          return [];
        }
        const userId = currentSubscriberUserId;

        try {
          const db = getDb();
          const rows = await db
            .select({
              id: hostsTable.id,
              name: hostsTable.name,
              // Phase 72 Plan 05 — project the runs_fleet_substrate opt-in
              // column added by Plan 02 so the sweep hook in
              // ssh-poll-orchestrator.ts sees the operator's flag on each
              // returned record. Normalized to strict boolean by
              // projectRunsFleetSubstrate in the rows.map below.
              runsFleetSubstrate: hostsTable.runsFleetSubstrate,
            })
            .from(hostsTable)
            .where(eq(hostsTable.enableSsh, true));

          const resolved = await Promise.all(
            rows.map(async (row) => {
              const host = await resolveHostById(row.id, userId);
              if (!host) return null;
              return {
                id: String(row.id),
                name: row.name ?? String(row.id),
                // Phase 72 Plan 05 — fail-closed normalization via the
                // module-scope helper (drizzle boolean mode normally hands
                // back true/false but the helper accepts the wider union
                // to survive legacy NULL rows + raw-SQL escape hatches).
                runsFleetSubstrate: projectRunsFleetSubstrate(row),
                // Decrypted SSHHost record — connectOneShot consumes this directly
                // (matches the canonical sessions.ts:70-75 pattern).
                _connDetails: host as unknown as Record<string, unknown>,
              };
            }),
          );
          return resolved.filter(
            (
              h,
            ): h is {
              id: string;
              name: string;
              runsFleetSubstrate: boolean;
              _connDetails: Record<string, unknown>;
            } => h !== null,
          );
        } catch (err) {
          systemLogger.warn("Fleet-status: identity-host list query failed", {
            operation: "fleet_status_host_list_failed",
            error: err instanceof Error ? err.message : "unknown",
          });
          return [];
        }
      }

      // Long-lived ssh2 Client connections keyed by hostId
      const hostClients = new Map<string, import("ssh2").Client>();
      // Phase 39 D-01/D-03: the userId of the currently-subscribed browser
      // session. Set by registry.onFirstSubscriber; cleared by
      // registry.onLastUnsubscriber. Used as the subject for per-host
      // resolveHostById decrypt inside listIdentityHostingHosts.
      let currentSubscriberUserId: string | null = null;
      // Phase 39 D-05 (GATE2-05): host.id strings that have already had
      // installStopHook invoked during THIS lifecycle. Cleared on
      // registry.onLastUnsubscriber alongside hostClients.clear() so a
      // subsequent poller session re-attempts install (idempotent per
      // RESEARCH §Q5).
      const hookInstallAttempted = new Set<string>();

      async function acquireSshChannel(host: {
        id: string;
        name: string;
        _connDetails?: Record<string, unknown>;
      }) {
        try {
          // Return existing live client if available
          const existing = hostClients.get(host.id);
          if (existing) {
            // Health-check: try a simple command
            try {
              // Bounty b31a5c8e: per-connection SSH exec throttle. Cap at
              // 8 in flight to stay under OpenSSH default MaxSessions=10.
              const sem = makeSemaphore(8);
              const channel = {
                exec: async (command: string): Promise<string | null> => {
                  try {
                    return await sem.run(async () =>
                      execCommand(existing, command),
                    );
                  } catch {
                    return null;
                  }
                },
              };
              // Quick health probe — routed through the SAME semaphore so
              // it cannot bypass the cap on a saturated connection.
              await sem.run(async () => execCommand(existing, "echo ok"));
              return channel;
            } catch {
              // Connection dead — remove and reconnect
              hostClients.delete(host.id);
              try {
                existing.end();
              } catch {
                // ignore
              }
            }
          }

          // Open a new long-lived connection
          const connDetails = (
            host as unknown as { _connDetails: Record<string, unknown> }
          )._connDetails;
          if (!connDetails) {
            return null;
          }

          const client = await connectOneShot(
            connDetails as Parameters<typeof connectOneShot>[0],
            10000,
          );
          hostClients.set(host.id, client);

          // Auto-remove on disconnect
          client.on("end", () => hostClients.delete(host.id));
          client.on("close", () => hostClients.delete(host.id));
          client.on("error", () => hostClients.delete(host.id));

          // Bounty b31a5c8e: per-connection SSH exec throttle. Cap at 8
          // in flight to stay under OpenSSH default MaxSessions=10.
          const sem = makeSemaphore(8);
          const channelAdapter: SshChannel = {
            exec: async (command: string): Promise<string | null> => {
              try {
                return await sem.run(async () => execCommand(client, command));
              } catch {
                return null;
              }
            },
          };

          // Phase 39 D-05 (GATE2-05): fire-and-forget blind Stop-hook
          // install on FIRST successful new-client acquire per host per
          // lifecycle. Fires the SAME channelAdapter that we're about to
          // return to the orchestrator — installStopHook uses it for the
          // heredoc-quoted script drop + settings.json merge. Install
          // failures are logged (warn) but never block acquire — the
          // SshChannel is still returned so the poll cycle proceeds.
          maybeInstallStopHook(
            host.id,
            channelAdapter,
            hookInstallAttempted,
            { installStopHook, systemLogger },
          );

          return channelAdapter;
        } catch (err) {
          systemLogger.warn("Fleet-status: SSH channel acquire failed", {
            operation: "fleet_status_host_ssh_unreachable",
            fleetHostId: host.id,
            error: err instanceof Error ? err.message : "unknown",
          });
          return null;
        }
      }

      function releaseSshChannel(
        host: { id: string },
        _channel: unknown,
      ): void {
        // quick-260820-tm0 — eviction path: called by the orchestrator when a
        // host is pruned from the identity-host list (e.g. admin-disabled
        // `enable_ssh=false`). Closes the underlying ssh2 Client and removes
        // it from hostClients so the connection is actually reclaimed —
        // previously this was a no-op, which meant an admin-disabled host
        // leaked its long-lived Client indefinitely (the 2026-08-20 wilma
        // incident secondary bug).
        //
        // `_channel` is unused by design: the orchestrator's SshChannel
        // abstraction is a thin exec wrapper with no independent lifecycle;
        // the real handle is the ssh2 Client stored in hostClients.
        //
        // Also clear hookInstallAttempted so a subsequent re-enable of the
        // same host re-attempts installStopHook on the fresh acquire
        // (matches the hookInstallAttempted.clear() on onLastUnsubscriber).
        //
        // The `.on("end") | .on("close") | .on("error")` handlers registered
        // in acquireSshChannel will also fire on client.end() and delete the
        // hostClients entry; the explicit delete here is belt-and-suspenders
        // in case a synchronous eviction races the event-loop-async 'end'.
        // Map.delete on a missing key is a no-op, so double-delete is safe.
        const client = hostClients.get(host.id);
        if (client) {
          try {
            client.end();
          } catch {
            // best-effort — client may already be dead
          }
          hostClients.delete(host.id);
          hookInstallAttempted.delete(host.id);
        }
      }

      const orchestrator = createSshPollOrchestrator({
        // Phase 72 Plan 05 — tightened cast: the projected records now carry
        // runsFleetSubstrate + _connDetails, matching IdentityHostingHostRecord.
        // The compiler catches any future shape drift between starter.ts's
        // returned records and the OrchestratorDeps contract.
        listIdentityHostingHosts: listIdentityHostingHosts as unknown as () => Promise<
          Array<import("./fleet-status/ssh-poll-orchestrator.js").IdentityHostingHostRecord>
        >,
        acquireSshChannel: acquireSshChannel as unknown as (
          host: { id: string; name: string },
        ) => Promise<import("./fleet-status/ssh-poll-orchestrator.js").SshChannel | null>,
        releaseSshChannel: releaseSshChannel as unknown as (
          host: { id: string; name: string },
          channel: import("./fleet-status/ssh-poll-orchestrator.js").SshChannel,
        ) => void,
        registry,
        setInterval,
        clearInterval,
        now: () => Date.now(),
        pollIntervalMs: 2000,
        staleSweepIntervalMs: 30000,
        hookPayloadPath: "~/.claude/fleet-status/last-stop-payload.json",
        hookPayloadWarnCooldownMs: 60000,
      });

      // ---------------------------------------------------------------------
      // Phase 39 Path C — presence-driven orchestrator lifecycle
      // (Ashley LOCKED 2026-08-13: "nobody needs to know if something is idle
      // or not, or anything else that's going on here, if no user is present
      // to want to know the information")
      //
      // D-01 (GATE2-01): first fleet-status browser subscriber → start poller
      // D-02 (GATE2-02): last unsubscriber → stop poller + close ssh2 Clients
      // D-03 (GATE2-03): capture that subscriber's userId as the decrypt
      //                  subject for listIdentityHostingHosts / resolveHostById
      // ---------------------------------------------------------------------
      registry.onFirstSubscriber(({ userId }) => {
        currentSubscriberUserId = userId;
        systemLogger.info(
          "Fleet-status orchestrator starting on first subscriber",
          {
            operation: "fleet_status_orchestrator_lifecycle",
            userId,
          },
        );
        orchestrator.start().catch((err) => {
          systemLogger.warn("Fleet-status orchestrator start failed", {
            operation: "fleet_status_orchestrator_start_failed",
            error: err instanceof Error ? err.message : "unknown",
          });
        });
      });

      registry.onLastUnsubscriber(() => {
        systemLogger.info(
          "Fleet-status orchestrator stopping on last unsubscriber",
          {
            operation: "fleet_status_orchestrator_lifecycle",
          },
        );
        orchestrator.stop();
        // Close the long-lived ssh2 Clients so we don't leak the very TCP
        // connections we said "no user watching = no work" — orchestrator.stop()
        // only clears perHostState (channel wrappers), not the underlying
        // ssh2 Clients held in hostClients. See 39-RESEARCH §Pitfall 3.
        for (const [, client] of hostClients) {
          try {
            client.end();
          } catch {
            // best-effort — client may already be dead
          }
        }
        hostClients.clear();
        // Phase 39 D-05 (GATE2-05): reset install-once tracking so the
        // next lifecycle (next fleet-status subscriber) re-attempts install
        // per host. installStopHook is idempotent (RESEARCH §Q5) so
        // re-attempts are safe and cheap when already installed.
        hookInstallAttempted.clear();
        currentSubscriberUserId = null;
      });

      systemLogger.info(
        "Fleet-status orchestrator initialized (awaiting first subscriber)",
        {
          operation: "fleet_status_awaiting_subscriber",
          pollIntervalMs: 2000,
          staleSweepIntervalMs: 30000,
        },
      );
    }

    // =========================================================================
    // Phase 75-05: Server-substrate orchestrator wire-in
    //
    // PURPOSE: Delivers D-01 (startup pass runs at container boot) and enables
    // D-02 (singleton exposed so host-create route in 75-06 can trigger per-host
    // sweeps on demand).
    //
    // WHAT THIS BLOCK DOES:
    //   - Walks every runsFleetSubstrate:true host serially via 75-03's
    //     listSubstrateHosts (session-less CSKEK path — no browser required).
    //   - Retries failures on a 30-second tick (D-03 piggybacks on existing cadence).
    //   - Alerts loudly after N=3 consecutive failures per host (D-06/D-07).
    //   - Populates substrate-orchestrator singleton so host.ts on-add trigger
    //     (75-06) can call getSubstrateOrchestrator().sweepOneHost(host).
    //   - start() is called fire-and-forget (.catch(), NOT await) so the boot
    //     IIFE does NOT block on network I/O to substrate hosts. See rationale
    //     comment on the start() call below.
    //   - Independent of fleet-status subscription lifecycle: no browser, no
    //     per-user DEK, no onFirstSubscriber gate. Reads substrate-host
    //     credentials through CSKEK per D-08.
    //
    // PLACEMENT: After fleet-status block (line 682) — DB is ready because
    //   `await (dbServer as ...).serverReady` was done at line 302.
    //   RESEARCH.md Pitfall 3: starting the orchestrator before DB is ready
    //   causes listSubstrateHosts to throw on an uninitialized DB handle.
    // =========================================================================
    {
      const { createServerSubstrateOrchestrator } = await import(
        "./distributor/server-substrate-orchestrator.js"
      );
      const { listSubstrateHosts: listSubstrateHostsFn } = await import(
        "./distributor/list-substrate-hosts.js"
      );
      const { setSubstrateOrchestrator } = await import(
        "./distributor/substrate-orchestrator-singleton.js"
      );
      const { connectOneShot: connectOneShotSub } = await import(
        "./ssh/ssh-one-shot.js"
      );
      const { execCommand: execCommandSub } = await import(
        "./ssh/tmux-helper.js"
      );
      const { getDb: getDbForSubstrate } = await import(
        "./database/db/index.js"
      );

      // Per-host ssh2 Client pool — independent of fleet-status hostClients Map
      // so the two lifecycles do not contaminate each other.
      const substrateHostClients = new Map<string, import("ssh2").Client>();

      // Per-host semaphore Map — lazy-created per host on first acquire.
      // makeSemaphore(8) matches the wilma-incident MaxSessions=10 fix
      // (fleet-status uses the same cap at starter.ts:520).
      const substrateHostSemaphores = new Map<
        string,
        ReturnType<typeof makeSemaphore>
      >();

      async function substrateAcquireChannel(host: {
        id: string;
        name: string;
        _connDetails: Record<string, unknown>;
      }) {
        try {
          // Lazy-init client: reuse existing or open a fresh one-shot connection.
          let client = substrateHostClients.get(host.id);
          if (!client) {
            client = await connectOneShotSub(
              host._connDetails as Parameters<typeof connectOneShotSub>[0],
              10000,
            );
            substrateHostClients.set(host.id, client);
            // Auto-evict on disconnect so the next acquire creates a fresh client.
            client.on("end", () => substrateHostClients.delete(host.id));
            client.on("close", () => substrateHostClients.delete(host.id));
            client.on("error", () => substrateHostClients.delete(host.id));
          }

          // Lazy-init semaphore: one per host, capped at 8 in-flight execs.
          let sem = substrateHostSemaphores.get(host.id);
          if (!sem) {
            sem = makeSemaphore(8);
            substrateHostSemaphores.set(host.id, sem);
          }

          const capturedClient = client;
          const capturedSem = sem;
          return {
            exec: async (cmd: string): Promise<string | null> => {
              try {
                return await capturedSem.run(async () =>
                  execCommandSub(capturedClient, cmd),
                );
              } catch {
                return null;
              }
            },
          };
        } catch (err) {
          // SECURITY: never include host._connDetails (plaintext creds) or
          // err.stack in the log call — only err.message is safe to surface.
          systemLogger.warn(
            "Substrate-orchestrator SSH channel acquire failed",
            {
              operation: "fleet_substrate_channel_acquire_failed",
              fleetHostId: host.id,
              hostName: host.name,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
          return null;
        }
      }

      // No-op: the underlying ssh2 Client is reused across sweeps for the
      // container lifetime. Cleanup happens on SIGTERM via substrateHostClients.
      function substrateReleaseChannel(
        _host: { id: string; name: string },
        _channel: unknown,
      ): void {
        // intentional no-op — see comment above
      }

      const substrateOrch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHostsFn({ getDb: getDbForSubstrate }),
        acquireChannel: substrateAcquireChannel as Parameters<
          typeof createServerSubstrateOrchestrator
        >[0]["acquireChannel"],
        releaseChannel: substrateReleaseChannel as Parameters<
          typeof createServerSubstrateOrchestrator
        >[0]["releaseChannel"],
        setInterval,
        clearInterval,
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      // Populate the singleton so the host-create route (75-06) can reach it.
      setSubstrateOrchestrator(substrateOrch);

      // Fire-and-forget start() — LOAD-BEARING, do NOT convert to `await`.
      //
      // RATIONALE: D-01 says the pass "runs at container start," NOT "boot
      // blocks until pass completes." Awaiting start() would serialize the
      // boot IIFE on however long it takes to walk all substrate hosts —
      // on Stacy's box with unreachable VMs this could be minutes. Fire-and-
      // forget lets the container become fully ready quickly while the pass
      // runs in the background. If a future decision changes this (e.g.,
      // health-check probes need the pass to complete before serving traffic),
      // swap .catch(...) for `await` — trivial one-line change.
      //
      // The orchestrator's own start() has never-reject contracts (75-02 tests
      // NT1/NT2), so the .catch() is defense-in-depth. Any actual rejection
      // means a bug in the orchestrator itself and is loud-logged.
      substrateOrch.start().catch((err) => {
        systemLogger.warn(
          "Substrate orchestrator start() rejected (unexpected)",
          {
            operation: "fleet_substrate_orchestrator_start_failed",
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      });

      systemLogger.info("Server-substrate orchestrator started", {
        operation: "fleet_substrate_orchestrator_started",
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      // SIGTERM cleanup — separate from the gracefulShutdown handler below
      // which handles the full process exit. This handler runs the orchestrator's
      // stop() immediately when SIGTERM arrives, clearing the retry interval
      // and closing all substrate ssh2 Clients before the process exits.
      process.once("SIGTERM", () => {
        systemLogger.info("Substrate orchestrator stopping on SIGTERM", {
          operation: "fleet_substrate_orchestrator_lifecycle",
        });
        substrateOrch.stop();
        for (const [, client] of substrateHostClients) {
          try {
            client.end();
          } catch {
            /* best-effort — client may already be dead */
          }
        }
        substrateHostClients.clear();
        substrateHostSemaphores.clear();
      });
    }

    // Initialize log level from database settings
    const { getDb: getDbForSettings } = await import("./database/db/index.js");
    const settingsDb = getDbForSettings();
    const logLevelRow = settingsDb.$client
      .prepare("SELECT value FROM settings WHERE key = 'log_level'")
      .get() as { value: string } | undefined;
    if (logLevelRow) {
      setGlobalLogLevel(logLevelRow.value);
      systemLogger.info(`Log level set to: ${logLevelRow.value}`, {
        operation: "log_level_init",
      });
    }

    // Initialize Guacamole server for RDP/VNC/Telnet support
    const { getDb: getDbForGuac } = await import("./database/db/index.js");
    const guacDb = getDbForGuac();
    const guacEnabledRow = guacDb.$client
      .prepare("SELECT value FROM settings WHERE key = 'guac_enabled'")
      .get() as { value: string } | undefined;
    const guacEnabled = guacEnabledRow
      ? guacEnabledRow.value !== "false"
      : true;

    if (process.env.ENABLE_GUACAMOLE !== "false" && guacEnabled) {
      import("./guacamole/guacamole-server.js")
        .then(() => {
          systemLogger.info("Guacamole server initialized", {
            operation: "guac_init",
          });
        })
        .catch((error) => {
          systemLogger.warn(
            "Failed to initialize Guacamole server (guacd may not be available)",
            {
              operation: "guac_init_skip",
              error: error instanceof Error ? error.message : "Unknown error",
            },
          );
        });
    }

    systemLogger.success("Skynet backend started successfully", {
      operation: "backend_init_complete",
      port: process.env.PORT || 4090,
      ssl: process.env.SSL_ENABLED === "true",
      duration: Date.now() - initStartTime,
    });

    const gracefulShutdown = async (signal: string) => {
      systemLogger.info(`Received ${signal}, initiating graceful shutdown...`, {
        operation: "shutdown",
      });
      // Phase 31 D-03: flush any pending backend log lines before exit
      flushBackendLogs();
      try {
        const { saveMemoryDatabaseToFile } =
          await import("./database/db/index.js");
        await saveMemoryDatabaseToFile();
        systemLogger.info("Database saved to disk before exit", {
          operation: "shutdown_db_saved",
        });
      } catch (error) {
        systemLogger.error("Failed to save database during shutdown", error, {
          operation: "shutdown_db_save_failed",
        });
      }
      process.exit(0);
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    process.on("message", (msg: { type?: string }) => {
      if (msg?.type === "shutdown") {
        gracefulShutdown("IPC shutdown");
      }
    });

    process.on("uncaughtException", (error) => {
      systemLogger.error("Uncaught exception occurred", error, {
        operation: "error_handling",
      });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      systemLogger.error("Unhandled promise rejection", reason, {
        operation: "error_handling",
      });
      process.exit(1);
    });
  } catch (error) {
    systemLogger.error("Failed to initialize backend services", error, {
      operation: "startup_failed",
    });
    process.exit(1);
  }
})();
} // end if (process.env.VITEST !== "true")
