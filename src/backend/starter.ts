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
       * Query the DB for identity-hosting hosts — hosts that have SSH enabled
       * and enableTerminal=true (initial approximation; refined per the plan comment).
       *
       * TODO: once an explicit "identity_hosting" flag or join via messageQueueItems
       * is available, use that instead. For now, enableSsh + enableTerminal is the
       * best available signal from the schema.
       */
      async function listIdentityHostingHosts() {
        try {
          const db = getDb();
          const rows = await db
            .select({
              id: hostsTable.id,
              name: hostsTable.name,
              ip: hostsTable.ip,
              port: hostsTable.port,
              sshPort: hostsTable.sshPort,
              username: hostsTable.username,
              authType: hostsTable.authType,
              password: hostsTable.password,
              key: hostsTable.key,
              keyPassword: hostsTable.keyPassword,
            })
            .from(hostsTable)
            .where(eq(hostsTable.enableSsh, true));

          return rows.map((row) => ({
            id: String(row.id),
            name: row.name ?? String(row.id),
            // Store connection details for acquireSshChannel
            _connDetails: row,
          }));
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
              const channel = {
                exec: async (command: string): Promise<string | null> => {
                  try {
                    return await execCommand(existing, command);
                  } catch {
                    return null;
                  }
                },
              };
              // Quick health probe
              await execCommand(existing, "echo ok");
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

          return {
            exec: async (command: string): Promise<string | null> => {
              try {
                return await execCommand(client, command);
              } catch {
                return null;
              }
            },
          };
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
        // Long-lived channels are NOT released after each use — they persist for
        // the life of the orchestrator. releaseSshChannel is a no-op in this wiring.
        // The connection is cleaned up on stop() or on SSH disconnect event.
        void host;
      }

      const orchestrator = createSshPollOrchestrator({
        listIdentityHostingHosts: listIdentityHostingHosts as unknown as () => Promise<
          Array<{ id: string; name: string }>
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

      // Fire-and-forget start (does not block backend boot)
      orchestrator.start().catch((err) => {
        systemLogger.warn("Fleet-status orchestrator start failed", {
          operation: "fleet_status_orchestrator_start_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

      // Log initial host count after start (best-effort)
      listIdentityHostingHosts().then((initialHosts) => {
        systemLogger.info("Fleet-status orchestrator started", {
          operation: "fleet_status_orchestrator_started",
          identityHostCount: initialHosts.length,
          pollIntervalMs: 2000,
          staleSweepIntervalMs: 30000,
        });
      }).catch(() => {
        // ignore — logged inside listIdentityHostingHosts already
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
