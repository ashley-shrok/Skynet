import { spawn } from "child_process";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { AutoSSLSetup } from "./utils/auto-ssl-setup.js";
import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { SystemCrypto } from "./utils/system-crypto.js";
// Phase 128 Plan 08 — VAPID env fail-fast boot gate (mirrors
// assertBrandingConfigAtBoot placement at ~L474-481). Static import: this
// is a synchronous throw-at-boot gate, not a fire-and-forget module load
// (contrast with the void-import blocks below).
import { assertVapidConfigAtBoot } from "./notifications/vapid-config.js";
import {
  systemLogger,
  versionLogger,
  setGlobalLogLevel,
} from "./utils/logger.js";
import { flushBackendLogs } from "./utils/console-forward-transport.js";
import { isLocalHostId } from "./claude-session/identity-artifact-reader.js";
import type { SshChannel } from "./fleet-status/ssh-poll-orchestrator.js";
import { enqueue as enqueueSpawnRequest, setProcessBirth as setSpawnRequestProcessBirth } from "./spawn-requests/queue.js";
import { processBirth as processSpawnRequestBirth, buildProductionDeps as buildSpawnRequestWorkerDeps } from "./spawn-requests/worker.js";

/**
 * Local-host channel adapter — child_process.spawn behind the SshChannel
 * interface. Used by acquireSshChannel when isLocalHostId(hostId) matches:
 * bypasses SSH entirely and runs the command inside this process's own
 * container, with HOME rewritten to HOME_HOST_DIR so `~` in the SSH-shaped
 * commands (e.g. `~/.local/bin/fleet-status-sweep`, `test -x ~/.claude/...`)
 * resolves to the bind-mounted host home rather than the container's /root.
 *
 * Semantics match execCommand (src/backend/ssh/tmux-helper.ts): resolves with
 * trimmed stdout on success (including non-zero exit if stdout is non-empty —
 * the SSH probes rely on `... && echo yes || echo no` patterns that always
 * emit stdout); resolves with null on spawn error or non-zero exit with empty
 * stdout. Callers already treat null as "SSH hiccup"; we reuse that path
 * unchanged for local errors.
 *
 * Motivation: the fleet-status poll orchestrator is otherwise SSH-only, which
 * makes the self-poll (hostId 6 → Skynet) traverse an SSH loopback for what
 * should be a direct fs read. That loopback is the exact "half-broken TCP"
 * failure mode the LEGACY_POLL_TIMEOUT_MS docblock names, and observed in the
 * wild on 2026-09-19 (900+ skipped polls / ~30min jam until manual restart).
 * Every other host-touching subsystem in the codebase branches on
 * isLocalHostId already — this brings the poll orchestrator in line.
 */
function acquireLocalChannel(): SshChannel {
  const localHome = process.env.HOME_HOST_DIR || os.homedir();
  return {
    exec: (command: string, stdinBody?: Buffer): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        let child;
        try {
          child = spawn("bash", ["-c", command], {
            env: { ...process.env, HOME: localHome },
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          resolve(null);
          return;
        }
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf-8");
        });
        child.on("error", () => resolve(null));
        child.on("close", (code: number | null) => {
          if (code !== 0 && stdout === "") {
            systemLogger.warn(
              "Fleet-status: local-channel exec non-zero + empty stdout",
              {
                operation: "fleet_status_local_channel_exec_nonzero",
                command: command.slice(0, 80),
                code,
                stderrLen: stderr.length,
              },
            );
            resolve(null);
            return;
          }
          resolve(stdout.trim());
        });
        if (stdinBody !== undefined) {
          child.stdin.end(stdinBody);
        } else {
          child.stdin.end();
        }
      });
    },
  };
}

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
//
// D-02 (Phase 101 Plan 01): makeSemaphore moved to host-semaphore-registry.ts.
// Re-exported so starter.test.ts can still import it directly.
// D-04 (Phase 101 Plan 02): fleet-status + substrate call sites migrated to
// getHostSemaphore() — both producers running on the same hostId now share ONE
// 8-slot pool (Bounty b31a5c8e Phase 101). makeSemaphore no longer called
// locally; import retained as re-export for downstream test consumers.
// ---------------------------------------------------------------------------
export { makeSemaphore } from "./ssh/host-semaphore-registry.js";
import { getHostSemaphore } from "./ssh/host-semaphore-registry.js";

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

    // Event-loop lag sampler — SLICE 1 of auth-slow-requests-on-pwa-boot bounty.
    // Belt-and-suspenders inner VITEST gate: the outer if (process.env.VITEST !==
    // "true") at L167 already prevents this IIFE from running during tests, but
    // the extra guard here documents intent at the sampler site itself.
    if (process.env.VITEST !== "true") {
      const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
      eventLoopHistogram.enable();
      const eventLoopSampleInterval = setInterval(() => {
        const p50Ms = Math.round((eventLoopHistogram.percentile(50) / 1_000_000) * 10) / 10;
        const p99Ms = Math.round((eventLoopHistogram.percentile(99) / 1_000_000) * 10) / 10;
        const maxMs = Math.round((eventLoopHistogram.max / 1_000_000) * 10) / 10;
        systemLogger.info("Event loop lag sample", {
          operation: "event_loop_lag_sample",
          p50Ms,
          p99Ms,
          maxMs,
        });
        eventLoopHistogram.reset();
      }, 1000);
      eventLoopSampleInterval.unref();
      process.once("SIGTERM", () => {
        clearInterval(eventLoopSampleInterval);
        eventLoopHistogram.disable();
      });
    }

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

    // Phase 98 — one-shot voice-value migration.
    // Walks ~/.claude/identities/*/*.md and ~/.claude/roles/*/*.md and
    // clears any voice: frontmatter value matching the old Chatterbox
    // regex /^[A-Z][A-Za-z]+\.wav$/ (per D-Per-identity-voice-binding
    // hard reset). Idempotent — no-ops after the first successful run
    // (identity/role files with already-conformant Polly voice IDs are
    // fast-skipped). Fire-and-forget: ensureVoiceValuesMigrated NEVER
    // throws (its own try/catch barrier); the .catch() here is defensive
    // against the dynamic import itself failing to resolve.
    void import("./voice/voice-migration.js")
      .then((m) => m.ensureVoiceValuesMigrated())
      .catch((err) => {
        systemLogger.warn("ensureVoiceValuesMigrated failed at startup", {
          operation: "voice_migration_startup_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

    // Phase 89 — start the observation loop that materializes relay-room
    // sessions. Fire-and-forget: startObservationLoopOnBoot returns a
    // promise we don't await. Errors inside the boot sequence log a warn
    // and swallow; the loop never crashes the container (D-07 no
    // user-visible surface applies to boot too). Ordering: MUST come after
    // `dbModule.initializeDatabase()` — the boot sequence enumerates users
    // from the DB. Matrix admin creds may or may not be ingested yet at
    // this point; `ensureRegistryRoomsExist` gates cleanly on
    // `creds_missing` and returns without starting the loop, so a fresh
    // install with no admin creds is a legitimate no-op.
    void import("./relay-sessions/observation-loop-starter.js")
      .then((m) => {
        m.startObservationLoopOnBoot().catch((err) => {
          systemLogger.warn(
            "[phase-89] observation-loop bootstrap failed at startup",
            {
              operation: "relay_observation_bootstrap_error",
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        });
      })
      .catch((err) => {
        systemLogger.warn("startObservationLoopOnBoot module load failed", {
          operation: "relay_observation_bootstrap_module_load_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

    // Phase 128 — start the push-trigger loop that dispatches web-push
    // notifications on new DM messages. Fire-and-forget mirroring the
    // observation-loop-starter block above (S3 discipline in
    // 128-PATTERNS.md § S3): outer catch on the dynamic import, inner
    // catch on the startPushTriggerLoopOnBoot() promise. Both operation
    // strings are grep-anchors — see 128-08-PLAN.md acceptance criteria.
    // Ordering: after observation-loop (both enumerate users with mxid;
    // symmetry keeps the bootstrap pair visually paired). The push loop
    // additionally requires VAPID env; assertVapidConfigAtBoot below is
    // the fail-fast gate for that env, but push-trigger-starter also
    // performs its own belt-and-suspenders getVapidDetails() gate.
    void import("./notifications/push-trigger-starter.js")
      .then((m) => {
        m.startPushTriggerLoopOnBoot().catch((err) => {
          systemLogger.warn(
            "[phase-128] push-trigger bootstrap failed at startup",
            {
              operation: "push_trigger_bootstrap_error",
              error: err instanceof Error ? err.message : "unknown",
            },
          );
        });
      })
      .catch((err) => {
        systemLogger.warn("startPushTriggerLoopOnBoot module load failed", {
          operation: "push_trigger_bootstrap_module_load_failed",
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

    // Phase 128 Plan 08 — fail-fast if VAPID env vars are missing or
    // malformed. Mirrors the branding assert-boot placement (BEFORE any
    // route mounts). Synchronous throw contract — matches the "let it
    // propagate" style of assertBrandingConfigAtBoot; starter's
    // uncaught-exception handler surfaces the structured error + non-zero
    // exit that container supervisor watches for. See
    // src/backend/notifications/vapid-config.ts for the fail-fast rationale
    // (missing/malformed VAPID subject = every push returns 403 silently
    // from Apple's push service — better to refuse to boot).
    assertVapidConfigAtBoot();

    // Phase 121 (feedback-config): boot-time env parse + module-scope cache.
    // DELIBERATELY DIVERGES from the branding assert-boot pattern above:
    //   - No throw / process.exit on missing env (feedback is optional per
    //     D-01/D-06). A disabled feedback config is a valid runtime state;
    //     the frontend hides the UI.
    //   - No SMTP handshake pre-check at boot (D-07 — the pre-check is
    //     fragile against unreachable relays and bricks Skynet for what is
    //     a non-essential feature). Bad-but-present SMTP creds surface at
    //     real send time in feedback-transport.ts.
    // loadFeedbackConfig() is synchronous + never-throws (contract locked
    // in feedback-config.ts JSDoc). No await on the call itself.
    const { loadFeedbackConfig } = await import(
      "./feedback/feedback-config.js"
    );
    loadFeedbackConfig();

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
    const claudeSessionServerModule = await import("./claude-session/claude-session-server.js");
    claudeSessionServerModule.startClaudeSessionServer();
    // Phase 90 Plan 04 — relay-room-stream WebSocket server (port 30015).
    // Self-starts on import (see relay-room-stream-server.ts L1342-1344 —
    // guarded to skip in vitest/test env). Was never imported anywhere in
    // the arc-close ship; nginx proxies /relay-room/websocket/ to 30015
    // and returned 404 because nothing was listening. user UAT 2026-09-09.
    await import("./relay-room-stream/relay-room-stream-server.js");
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
      const { resolveHostRecordByName } = await import(
        "./fleet-status/host-id-resolver.js"
      );
      const { createSshPollOrchestrator } = await import(
        "./fleet-status/ssh-poll-orchestrator.js"
      );
      const { connectOneShot } = await import("./ssh/ssh-one-shot.js");
      const { execCommand, execCommandWithStdin } = await import("./ssh/tmux-helper.js");
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
      // Phase 129 Plan 129-05 (D-2, D-7): identity-artifact-reader primitives
      // + pure visibility gate + username lookup. Composed inside the
      // resolveIdentityGate closure below and injected into the WS filter
      // via startFleetStatusServer opts. Kept as awaited imports (matches
      // this block's dynamic-import discipline for the rest of the fleet-
      // status subsystem) rather than top-of-file to avoid pulling
      // identity-artifact-reader into the boot graph for non-fleet callers.
      const {
        readIdentityFile: readIdentityFileForGate,
        readRoleFileByName: readRoleFileByNameForGate,
        extractCosmeticsFromFrontmatter: extractCosmeticsForGate,
        extractRoleFromMarkdown: extractRoleForGate,
      } = await import("./claude-session/identity-artifact-reader.js");
      const { isIdentityVisibleToUser } = await import(
        "./fleet-status/identity-visibility-gate.js"
      );
      const { getUsernameForUserId: getUsernameForUserIdForGate } = await import(
        "./utils/host-user-counter.js"
      );
      // Phase 39 D-05 (GATE2-05): blind Stop-hook install per host (LOCKED
      // 2026-08-13 by researcher — no probe-first). installStopHook is
      // idempotent per RESEARCH §Q5; readAndMergeStopHookSettings detects
      // alreadyInstalled and short-circuits the write path.
      const { installStopHook } = await import(
        "./fleet-status/remote-hook-install.js"
      );

      // Phase 118 code-review HIGH-1a (fix pass 2026-09-18): production wiring
      // for the per-user app-frame visibility filter (T-118-05-IL info-disclosure
      // gap). Prior shape constructed the registry here + passed it to
      // startFleetStatusServer, which hit branch 1 of the server's
      // registry-construction switch — SILENTLY unfiltered mode. Now the server
      // owns registry construction and receives `resolveHostOwnerById` so it
      // takes branch 2 (build filter + registry internally + emit
      // `fleet_status_filter_attached` info log). The registry is read back off
      // the returned FleetStatusServer for the orchestrator lifecycle wiring
      // below.
      //
      // D-10 discipline: this resolver is READ-ONLY. No DatabaseSaveTrigger,
      // no writes. It only maps a wire-shaped hostId string to the numeric
      // hostId + owner userId pair checkHostAccess needs.
      async function resolveHostOwnerById(
        hostIdStr: string,
      ): Promise<{ hostIdNum: number; hostUserId: string } | null> {
        const hostIdNum = Number(hostIdStr);
        if (!Number.isFinite(hostIdNum)) {
          return null;
        }
        try {
          const db = getDb();
          const rows = await db
            .select({
              id: hostsTable.id,
              userId: hostsTable.userId,
            })
            .from(hostsTable)
            .where(eq(hostsTable.id, hostIdNum))
            .limit(1);
          if (rows.length === 0) {
            return null;
          }
          const row = rows[0];
          return {
            hostIdNum: row.id,
            hostUserId: row.userId,
          };
        } catch (err) {
          systemLogger.warn(
            "Fleet-status: resolveHostOwnerById DB lookup failed",
            {
              operation: "fleet_status_owner_lookup_failed",
              hostIdStr,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
          return null;
        }
      }

      // Phase 129 Plan 129-05 (D-2, D-7): production wiring for the per-user
      // identity-name visibility gate at the WS surface. Complements the
      // Wave-2 read-path gates (identities.ts, sessions.ts,
      // roles-list-for-host.ts, conversation-search.ts) by closing the live-
      // status heartbeat leak — every frame that carries an identityKey /
      // tmuxSession is filtered through this closure before fan-out.
      //
      // Composition:
      //   1. Resolve hostIdStr → SSHHost (owner-scoped decrypt via
      //      resolveHostById; matches the pattern the pre-existing
      //      resolveHostOwnerById uses for the numeric hostId + owner userId).
      //   2. Resolve the caller's Skynet username (userId → username via
      //      getUsernameForUserId — mirrors Wave-2 read-path plans).
      //   3. Open a one-shot SSH conn (connectOneShot with a bounded
      //      timeout; matches identities.ts L363's 5s timeout — a WS frame
      //      that takes longer than 5s to gate is already a stale signal).
      //   4. Read identity file + extract role + read role file (best-effort
      //      on role read errors — matches identities.ts L414-419 silent-
      //      swallow discipline for a role file that fails to read).
      //   5. Apply isIdentityVisibleToUser and return boolean.
      //
      // Fail-CLOSED discipline: the app-frame-filter shim wraps this
      // closure in a try/catch that returns false on throw (Test I lock at
      // app-frame-filter.test.ts). Anything this closure THROWS becomes a
      // dropped frame at the wire — matches the D-7 depth invariant that a
      // leaked live-status frame is more visible than a dropped one in a
      // real-time sidebar.
      //
      // NO CACHE per Assumption A3: the shape file requires that a
      // `users:` frontmatter edit propagates on next read; a stale cache
      // would visibly regress that promise. If SSH profiling shows the
      // per-call cost is prohibitive under load, revisit with a 2-5s TTL
      // cache in a follow-up phase — not this one.
      //
      // D-10 (this-file discipline mirrors resolveHostOwnerById): READ-
      // ONLY. No writes anywhere in this closure.
      async function resolveIdentityGate(
        identityName: string,
        hostIdStr: string,
        userId: string,
      ): Promise<boolean> {
        const hostIdNum = Number(hostIdStr);
        if (!Number.isFinite(hostIdNum)) {
          systemLogger.debug(
            "Fleet-status identity gate: unparseable hostIdStr — denying",
            {
              operation: "fleet_status_identity_gate_bad_host",
              hostIdStr,
              userId,
              identityName,
            },
          );
          return false;
        }
        // Callers' Skynet username. A null result means the userId does
        // not map to a users row (JWT payload for a deleted / renamed
        // user, or a bare-subscriber code path that shouldn't reach this
        // closure). PER-REQUEST fail-OPEN mirrors the wave-2 pattern
        // (conversation-search Test G, sessions.ts): a null caller is an
        // infra bug, not a gate signal; treating it as "hide everything"
        // would empty every user's sidebar on the affected code path.
        const callerUsername = await getUsernameForUserIdForGate(userId);
        if (callerUsername === null) {
          systemLogger.warn(
            "Fleet-status identity gate: caller username lookup returned null — gate disabled",
            {
              operation: "fleet_status_identity_gate_username_missing",
              userId,
              hostIdStr,
              identityName,
            },
          );
          return true;
        }
        // Resolve host (decrypts SSH credentials for the OWNER user).
        // Local-host branch bypasses SSH entirely — readIdentityFile /
        // readRoleFileByName both accept conn=null and read from the
        // container's HOME_HOST_DIR bind-mount (matches identities.ts
        // L357-364 local-host branch shape).
        const local = isLocalHostId(hostIdNum);

        // Phase 129 HIGH-2 fix (2026-09-23): route the WS identity-gate
        // SSH work through the per-host semaphore to prevent MaxSessions
        // exhaustion on multi-identity hosts. The `snapshot` frame's
        // Promise.all in app-frame-filter.ts fans out N identity-gate
        // calls in parallel per subscriber connect; without the semaphore
        // each fires its own connectOneShot + reads, and hosts with more
        // than ~8 identities can exhaust sshd's default MaxSessions=10
        // cap on subscribe (matches the discipline identities.ts uses at
        // L380-384 for the REST fanout, cap 8). Local-host branch
        // bypasses the semaphore because bind-mount reads consume no SSH
        // channels — same short-circuit shape as identities.ts's
        // `withSlot` closure.
        //
        // NO CACHE per Assumption A3 lock (preserved above at L652-656):
        // the shape's "picked up on next read" promise is untouched. If
        // semaphore-serialized SSH turns out to be too slow under
        // profiling, revisit the 2-5s TTL cache as a separate decision —
        // not part of this fix.
        const runGate = async (): Promise<boolean> => {
          let conn: import("ssh2").Client | null = null;
          if (!local) {
            const host = await resolveHostById(hostIdNum, userId);
            if (!host) {
              systemLogger.debug(
                "Fleet-status identity gate: host record not found — denying",
                {
                  operation: "fleet_status_identity_gate_host_missing",
                  hostIdNum,
                  userId,
                  identityName,
                },
              );
              return false;
            }
            // 5s connect budget — a WS frame gate that stalls longer is
            // already a stale signal; the fail-closed catch in the app-
            // frame-filter shim will drop the frame if the connect times out.
            conn = await connectOneShot(host, 5_000);
          }
          try {
            const { markdown } = await readIdentityFileForGate(
              conn,
              identityName,
            );
            if (!markdown) {
              // Missing identity file on disk — deny per the D-7 depth
              // invariant. An identity that no longer exists on the host
              // has no frontmatter to gate against; surfacing the frame
              // would leak the fact of an in-flight event for a deleted
              // identity.
              systemLogger.debug(
                "Fleet-status identity gate: identity file empty/missing — denying",
                {
                  operation: "fleet_status_identity_gate_no_file",
                  hostIdNum,
                  userId,
                  identityName,
                },
              );
              return false;
            }
            const identityCos = extractCosmeticsForGate(markdown);
            const role = extractRoleForGate(markdown);
            let roleCos: ReturnType<typeof extractCosmeticsForGate> | null = null;
            if (role !== null) {
              try {
                const { markdown: roleMd } = await readRoleFileByNameForGate(
                  conn,
                  role,
                );
                roleCos = roleMd ? extractCosmeticsForGate(roleMd) : null;
              } catch {
                // Role file read failed — silent-swallow (matches
                // identities.ts L414-419 discipline for role reads that
                // fail behind an identity read that succeeded). The gate
                // treats roleCos=null as "no gate on the role side"; the
                // identity side still applies.
                roleCos = null;
              }
            }
            return isIdentityVisibleToUser(
              identityCos,
              roleCos,
              callerUsername,
            );
          } finally {
            // Release the one-shot SSH connection. LOCAL branch has no
            // conn to close. connectOneShot returns a live ssh2 Client;
            // .end() releases it. Wrapped in try because a half-open
            // client may already be in an error state.
            if (conn !== null) {
              try {
                conn.end();
              } catch {
                // best-effort — the fail-closed catch in the app-frame-
                // filter shim would have already dropped the frame if
                // anything upstream threw.
              }
            }
          }
        };

        return local
          ? runGate()
          : getHostSemaphore(hostIdNum).run(runGate);
      }

      const fleetStatusServer = startFleetStatusServer({
        port: 30012,
        authManager,
        resolveHostRecordByName,
        resolveHostOwnerById,
        resolveIdentityGate,
        // Phase 130: wire per-user project gate. Reuse the same
        // getUsernameForUserIdForGate closure the identity gate uses;
        // it's a pure userId → username DB lookup with no side effects.
        resolveCallerUsername: getUsernameForUserIdForGate,
      });
      // Registry is now server-owned — pull it back for the orchestrator
      // lifecycle wiring (onFirstSubscriber / onLastUnsubscriber below).
      const registry = fleetStatusServer.registry;

      // Phase 117 Plan 117-04: publish the same instance to the module-level
      // singleton so Express routes (mounted in database.ts) can reach it at
      // request time via getSubscriptionRegistry(). Same object — every
      // publish path (WS server, orchestrator, project-list route, session-
      // project-write route) fans out through the SAME subscriber set.
      const { setSubscriptionRegistry } = await import(
        "./fleet-status/subscription-registry.js"
      );
      setSubscriptionRegistry(registry);
      // Phase 119 code review HIGH-1 (fix pass 2026-09-18): publish the
      // registry reference to a process-wide singleton so the new
      // GET /apps/:hostId/:slug redirect route (src/backend/database/routes/apps.ts)
      // can look up an app's port from getAppSnapshot() without threading
      // the closure-scoped reference through the Express router
      // construction path. This is a read-only accessor — the WS server +
      // poll orchestrator continue to receive the registry via
      // constructor args (see below).
      {
        const { setRegistry } = await import(
          "./fleet-status/registry-holder.js"
        );
        setRegistry(registry);
      }
      systemLogger.info("Fleet-status WS server initialized", {
        operation: "fleet_status_init",
        port: 30012,
      });

      // --- Phase 34-04: SSH-poll orchestrator ---

      /**
       * Factory: build a fleet-status watcher scoped to one Skynet user.
       *
       * Each call returns an independent { start, stop } handle over its own
       * hostClients Map, hookInstallAttempted Set, and orchestrator instance.
       * The `userId` closure parameter is the decrypt subject for the
       * identity-hosting host list — the watcher only sees hosts this user
       * can decrypt (owns directly, or has a shared credential for).
       *
       * 2026-09-23 refactor (multi-tenant-fleet-status-orchestrator shape,
       * chunk A of 4): factory extracted. Currently still called ONCE per
       * global first-subscriber (behavior byte-identical to pre-refactor).
       * A follow-up commit adds per-user lifecycle events to the registry;
       * a further commit switches this wiring to per-user so N concurrent
       * subscribers each get their own watcher instance.
       */
      function createUserFleetStatusWatcher(userId: string): {
        start: () => Promise<void>;
        stop: () => void;
      } {
        // Long-lived ssh2 Client connections keyed by hostId — per-user pool.
        const hostClients = new Map<string, import("ssh2").Client>();
        // Phase 39 D-05 (GATE2-05): host.id strings that have already had
        // installStopHook invoked during THIS watcher's lifecycle. Cleared
        // on stop() so a subsequent watcher re-attempts install (idempotent
        // per RESEARCH §Q5). Per-user scope — two concurrent watchers on
        // the same host will each attempt install once.
        const hookInstallAttempted = new Set<string>();

        /**
         * Query the DB for identity-hosting hosts — hosts that have SSH enabled.
         *
         * Phase 39 D-03 (GATE2-03): decrypts each host's credentials via the
         * canonical resolveHostById(id, userId) path so ssh2 receives PLAINTEXT
         * key/password material. The subject userId is the factory's closure
         * param, captured at watcher construction — no shared mutable state.
         */
        async function listIdentityHostingHosts() {
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

        async function acquireSshChannel(host: {
          id: string;
          name: string;
          _connDetails?: Record<string, unknown>;
        }) {
          // Local-host fast path — bypass SSH entirely. See acquireLocalChannel
          // docblock. Returns a fresh child_process-backed adapter each call
          // (no persistent connection to cache, and spawning bash is cheap).
          // Stop-hook install (maybeInstallStopHook) is intentionally skipped
          // here — it writes into ~/.claude/ via the channel and would end up
          // creating root-owned files under the host's home via the bind-mount
          // (container runs as uid 0). Local hosts' stop-hook lifecycle is
          // out of scope for this fix; if it's needed later, wire it through
          // the substrate distributor's local-fleet-install pipeline instead.
          if (isLocalHostId(Number(host.id))) {
            return acquireLocalChannel();
          }
          try {
            // Return existing live client if available
            const existing = hostClients.get(host.id);
            if (existing) {
              // Health-check: try a simple command
              try {
                // Bounty b31a5c8e (Phase 101): per-host semaphore now shared via
                // registry — fleet-status + substrate + route producers running on
                // the same host now share a single 8-slot pool. Wilma-incident
                // MaxSessions=10 citation: cap at 8 leaves 2 channels of headroom.
                const sem = getHostSemaphore(host.id);
                const channel = {
                  exec: async (command: string, stdinBody?: Buffer): Promise<string | null> => {
                    try {
                      return await sem.run(async () =>
                        stdinBody === undefined
                          ? execCommand(existing, command)
                          : execCommandWithStdin(existing, command, stdinBody),
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

            // Bounty b31a5c8e (Phase 101): per-host semaphore now shared via
            // registry — fleet-status + substrate + route producers running on
            // the same host now share a single 8-slot pool. Wilma-incident
            // MaxSessions=10 citation: cap at 8 leaves 2 channels of headroom.
            const sem = getHostSemaphore(host.id);
            const channelAdapter: SshChannel = {
              exec: async (command: string, stdinBody?: Buffer): Promise<string | null> => {
                try {
                  return await sem.run(async () =>
                    stdinBody === undefined
                      ? execCommand(client, command)
                      : execCommandWithStdin(client, command, stdinBody),
                  );
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
          // (matches the hookInstallAttempted.clear() on stop() below).
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
          // Spawn-request scan is NO LONGER bundled into this orchestrator.
          // See bounty fleet-status-orchestrator-coupling-with-spawn-request-
          // scanning: the fleet-status orchestrator is gated on WS subscribers
          // (start on first, stop on last), which meant scanning stopped when
          // no browser was subscribed and coord-dropped requests sat unclaimed.
          // A dedicated always-on `createSpawnScanOrchestrator` runs at
          // container boot (wired below, alongside the substrate orchestrator)
          // and owns spawn-request scanning independently of browser presence.
        });

        return {
          start: () => orchestrator.start(),
          stop: () => {
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
            hookInstallAttempted.clear();
          },
        };
      }

      // Phase 99: wire the spawn-request birth-worker into the queue module.
      // Runs once at server boot (independent of per-user watcher lifecycle)
      // so any request claimed on the first tick has a processBirth callback
      // ready to drain it. Moved above the per-user watcher factory in the
      // multi-tenant refactor (2026-09-23) because it registers a process-
      // wide callback, not per-user state.
      // (D-06 in-memory queue + D-07 serialized worker + D-14 host-owner userId
      // + D-20 no changes to identity-birth-orchestrator.ts — the worker is a
      // new caller of the existing birthIdentity export.)
      const spawnRequestWorkerDeps = buildSpawnRequestWorkerDeps();
      setSpawnRequestProcessBirth((item) => processSpawnRequestBirth(item, spawnRequestWorkerDeps));

      // ---------------------------------------------------------------------
      // Phase 39 Path C — presence-driven orchestrator lifecycle
      // (user LOCKED 2026-08-13: "nobody needs to know if something is idle
      // or not, or anything else that's going on here, if no user is present
      // to want to know the information")
      //
      // D-01 (GATE2-01): first fleet-status browser subscriber → start poller
      // D-02 (GATE2-02): last unsubscriber → stop poller + close ssh2 Clients
      // D-03 (GATE2-03): capture that subscriber's userId as the decrypt
      //                  subject via createUserFleetStatusWatcher's parameter
      //
      // 2026-09-23 refactor (multi-tenant-fleet-status-orchestrator shape,
      // chunk A of 4): factory extracted. Still gated on GLOBAL first/last
      // subscriber — one watcher at a time, scoped to whichever user
      // subscribes first. A follow-up commit adds per-user lifecycle events
      // to the registry; a further commit switches this wiring so every
      // subscribed user gets their own watcher.
      // ---------------------------------------------------------------------
      let currentWatcher: ReturnType<typeof createUserFleetStatusWatcher> | null = null;

      registry.onFirstSubscriber(({ userId }) => {
        systemLogger.info(
          "Fleet-status orchestrator starting on first subscriber",
          {
            operation: "fleet_status_orchestrator_lifecycle",
            userId,
          },
        );
        currentWatcher = createUserFleetStatusWatcher(userId);
        currentWatcher.start().catch((err) => {
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
        currentWatcher?.stop();
        currentWatcher = null;
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
      const { execCommand: execCommandSub, execCommandWithStdin: execCommandWithStdinSub } = await import(
        "./ssh/tmux-helper.js"
      );
      const { getDb: getDbForSubstrate } = await import(
        "./database/db/index.js"
      );

      // Per-host ssh2 Client pool — independent of fleet-status hostClients Map
      // so the two lifecycles do not contaminate each other.
      const substrateHostClients = new Map<string, import("ssh2").Client>();

      // Bounty b31a5c8e (Phase 101, D-04): substrate semaphore now shared via
      // the module-scope registry (host-semaphore-registry.ts). The former
      // substrateHostSemaphores Map is removed — fleet-status + substrate
      // producers running on the same hostId now share ONE 8-slot pool.
      // Wilma-incident MaxSessions=10 citation: cap at 8 leaves 2 channels
      // of headroom per connection.

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

          // Shared registry semaphore — same instance as fleet-status on this
          // hostId (Bounty b31a5c8e Phase 101 D-04). getHostSemaphore is
          // idempotent: first call creates the 8-slot pool; subsequent calls
          // return the same instance.
          const sem = getHostSemaphore(host.id);

          const capturedClient = client;
          const capturedSem = sem;
          return {
            exec: async (cmd: string, stdinBody?: Buffer): Promise<string | null> => {
              try {
                return await capturedSem.run(async () =>
                  stdinBody === undefined
                    ? execCommandSub(capturedClient, cmd)
                    : execCommandWithStdinSub(capturedClient, cmd, stdinBody),
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
        // substrateHostSemaphores.clear() removed (Phase 101 Plan 02, D-04):
        // semaphores now live in the shared registry; registry lifecycle is
        // process-scoped and does not need SIGTERM cleanup.
      });
    }

    // =========================================================================
    // Spawn-request scan orchestrator (bounty
    // fleet-status-orchestrator-coupling-with-spawn-request-scanning)
    //
    // Decouples spawn-request scanning from the fleet-status orchestrator's
    // WS-subscriber-gated lifecycle. Pre-fix: scan piggybacked on the
    // 2s fleet-status poll and stopped when the last browser unsubscribed,
    // leaving coord-dropped requests unclaimed. Post-fix: this always-on
    // scanner starts at container boot, uses the same session-less CSKEK
    // enumeration as the substrate orchestrator (listSubstrateHosts), and
    // runs independently of browser presence.
    //
    // PLACEMENT: After the substrate block — same DB-readiness precondition,
    // same session-less enumeration primitive, isolated SSH-client pool.
    // =========================================================================
    {
      const { createSpawnScanOrchestrator } = await import(
        "./spawn-requests/scan-orchestrator.js"
      );
      const { listSubstrateHosts: listSubstrateHostsForScan } = await import(
        "./distributor/list-substrate-hosts.js"
      );
      const { connectOneShot: connectOneShotSpawn } = await import(
        "./ssh/ssh-one-shot.js"
      );
      const { execCommand: execCommandSpawn, execCommandWithStdin: execCommandWithStdinSpawn } = await import(
        "./ssh/tmux-helper.js"
      );
      const { getDb: getDbForSpawnScan } = await import(
        "./database/db/index.js"
      );

      // Own per-host ssh2 Client pool — independent of fleet-status +
      // substrate host-clients maps so the three lifecycles never
      // contaminate each other.
      const spawnScanHostClients = new Map<string, import("ssh2").Client>();

      async function spawnScanAcquireChannel(host: {
        id: string;
        name: string;
        _connDetails: Record<string, unknown>;
      }) {
        try {
          let client = spawnScanHostClients.get(host.id);
          if (!client) {
            client = await connectOneShotSpawn(
              host._connDetails as Parameters<typeof connectOneShotSpawn>[0],
              10000,
            );
            spawnScanHostClients.set(host.id, client);
            client.on("end", () => spawnScanHostClients.delete(host.id));
            client.on("close", () => spawnScanHostClients.delete(host.id));
            client.on("error", () => spawnScanHostClients.delete(host.id));
          }

          // Shared registry semaphore — same 8-slot pool as fleet-status +
          // substrate on this hostId (bounty b31a5c8e Phase 101 D-04).
          const sem = getHostSemaphore(host.id);
          const capturedClient = client;
          const capturedSem = sem;
          return {
            exec: async (cmd: string, stdinBody?: Buffer): Promise<string | null> => {
              try {
                return await capturedSem.run(async () =>
                  stdinBody === undefined
                    ? execCommandSpawn(capturedClient, cmd)
                    : execCommandWithStdinSpawn(capturedClient, cmd, stdinBody),
                );
              } catch {
                return null;
              }
            },
          };
        } catch (err) {
          systemLogger.warn(
            "Spawn-scan: SSH channel acquire failed",
            {
              operation: "spawn_scan_channel_acquire_failed",
              fleetHostId: host.id,
              hostName: host.name,
              error: err instanceof Error ? err.message : "unknown",
            },
          );
          return null;
        }
      }

      function spawnScanReleaseChannel(
        _host: { id: string; name: string },
        _channel: unknown,
      ): void {
        // no-op — underlying ssh2 Client is reused across ticks for the
        // container lifetime. Cleanup happens on SIGTERM.
      }

      const spawnScanOrch = createSpawnScanOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHostsForScan({ getDb: getDbForSpawnScan }),
        acquireChannel: spawnScanAcquireChannel,
        releaseChannel: spawnScanReleaseChannel,
        enqueue: enqueueSpawnRequest,
        setInterval,
        clearInterval,
        now: () => Date.now(),
        scanIntervalMs: 10000,
      });

      // Fire-and-forget start() — matches the substrate orchestrator's
      // rationale: the initial pass may await SSH connects across all
      // substrate hosts (potentially minutes on an unreachable VM), and
      // boot must not block on that. The scan orchestrator's start()
      // never rejects in normal operation.
      spawnScanOrch.start().catch((err) => {
        systemLogger.warn(
          "Spawn-scan orchestrator start() rejected (unexpected)",
          {
            operation: "spawn_scan_orchestrator_start_failed",
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      });

      systemLogger.info("Spawn-scan orchestrator started", {
        operation: "spawn_scan_orchestrator_started_at_boot",
        scanIntervalMs: 10000,
      });

      process.once("SIGTERM", () => {
        systemLogger.info("Spawn-scan orchestrator stopping on SIGTERM", {
          operation: "spawn_scan_orchestrator_lifecycle",
        });
        spawnScanOrch.stop();
        for (const [, client] of spawnScanHostClients) {
          try {
            client.end();
          } catch {
            /* best-effort — client may already be dead */
          }
        }
        spawnScanHostClients.clear();
      });
    }

    // =========================================================================
    // Phase 116 (image-gen-skill) — always-on image-gen-request scan
    // orchestrator + 5-worker pool + token bucket, wired IMMEDIATELY AFTER the
    // spawn-scan block (mirrors its structure verbatim).
    //
    // Boot ordering: read SKYNET_IMAGE_GEN_RPM → construct the single token
    // bucket → wire buildProductionDeps(tokenBucket) + processImageGen +
    // startPool → construct the scan orchestrator with its own hostClients
    // map and acquireChannel closure (independent lifecycle from fleet-
    // status + substrate + spawn-scan).
    //
    // The token bucket is a BOOT-TIME SINGLETON — every worker loop shares
    // this one instance so the RPM cap applies fleet-wide (not per-loop).
    // =========================================================================
    {
      const { createImageGenScanOrchestrator } = await import(
        "./image-gen-requests/scan-orchestrator.js"
      );
      const { listSubstrateHosts: listSubstrateHostsForImageGenScan } = await import(
        "./distributor/list-substrate-hosts.js"
      );
      const { connectOneShot: connectOneShotImageGen } = await import(
        "./ssh/ssh-one-shot.js"
      );
      const { execCommand: execCommandImageGen, execCommandWithStdin: execCommandWithStdinImageGen } = await import(
        "./ssh/tmux-helper.js"
      );
      const { getDb: getDbForImageGenScan } = await import(
        "./database/db/index.js"
      );
      const { createTokenBucket } = await import(
        "./image-gen-requests/token-bucket.js"
      );
      const {
        enqueue: enqueueImageGenRequest,
        setProcessImageGen: setImageGenProcessFn,
        setWorkerDeps: setImageGenWorkerDeps,
        startPool: startImageGenWorkerPool,
        stopPool: stopImageGenWorkerPool,
      } = await import("./image-gen-requests/queue.js");
      const {
        processImageGen,
        buildProductionDeps: buildImageGenWorkerDeps,
      } = await import("./image-gen-requests/worker.js");

      // Read SKYNET_IMAGE_GEN_RPM at boot (D-21). Defaults to 30 when unset
      // or unparseable. The `Math.max(1, ...)` floor prevents a 0/negative
      // env from producing a deadlocked bucket.
      const rawRpm = process.env.SKYNET_IMAGE_GEN_RPM;
      const parsedRpm = rawRpm !== undefined ? parseInt(rawRpm, 10) : NaN;
      const rpm = Math.max(1, Number.isFinite(parsedRpm) && parsedRpm > 0 ? parsedRpm : 30);
      const imageGenTokenBucket = createTokenBucket(rpm);
      systemLogger.info("Image-gen token bucket instantiated", {
        operation: "image_gen_token_bucket_started",
        rpm,
        capacity: imageGenTokenBucket.getState().capacity,
      });

      // Wire the worker into the queue BEFORE starting the pool — invariant:
      // `startPool()` must never invoke a null processImageGenFn.
      const imageGenWorkerDeps = buildImageGenWorkerDeps(imageGenTokenBucket);
      setImageGenWorkerDeps(imageGenWorkerDeps);
      setImageGenProcessFn(processImageGen);
      startImageGenWorkerPool();
      systemLogger.info("Image-gen worker pool started", {
        operation: "image_gen_worker_pool_started",
        workerCount: 5,
      });

      // Own per-host ssh2 Client pool — independent of every other
      // scan/orchestrator hostClients map so the lifecycles never contaminate.
      const imageGenScanHostClients = new Map<string, import("ssh2").Client>();

      async function imageGenScanAcquireChannel(host: {
        id: string;
        name: string;
        _connDetails: Record<string, unknown>;
      }) {
        try {
          let client = imageGenScanHostClients.get(host.id);
          if (!client) {
            client = await connectOneShotImageGen(
              host._connDetails as Parameters<typeof connectOneShotImageGen>[0],
              10000,
            );
            imageGenScanHostClients.set(host.id, client);
            client.on("end", () => imageGenScanHostClients.delete(host.id));
            client.on("close", () => imageGenScanHostClients.delete(host.id));
            client.on("error", () => imageGenScanHostClients.delete(host.id));
          }

          // Shared registry semaphore — same 8-slot pool as fleet-status +
          // substrate + spawn-scan on this hostId (bounty b31a5c8e Phase 101 D-04).
          const sem = getHostSemaphore(host.id);
          const capturedClient = client;
          const capturedSem = sem;
          return {
            exec: async (cmd: string, stdinBody?: Buffer): Promise<string | null> => {
              try {
                return await capturedSem.run(async () =>
                  stdinBody === undefined
                    ? execCommandImageGen(capturedClient, cmd)
                    : execCommandWithStdinImageGen(capturedClient, cmd, stdinBody),
                );
              } catch {
                return null;
              }
            },
          };
        } catch (err) {
          systemLogger.warn("Image-gen-scan: SSH channel acquire failed", {
            operation: "image_gen_scan_channel_acquire_failed",
            fleetHostId: host.id,
            hostName: host.name,
            error: err instanceof Error ? err.message : "unknown",
          });
          return null;
        }
      }

      function imageGenScanReleaseChannel(
        _host: { id: string; name: string },
        _channel: unknown,
      ): void {
        // no-op — underlying ssh2 Client is reused across ticks for the
        // container lifetime. Cleanup happens on SIGTERM.
      }

      const imageGenScanOrch = createImageGenScanOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHostsForImageGenScan({ getDb: getDbForImageGenScan }),
        acquireChannel: imageGenScanAcquireChannel,
        releaseChannel: imageGenScanReleaseChannel,
        enqueue: enqueueImageGenRequest,
        setInterval,
        clearInterval,
        now: () => Date.now(),
        scanIntervalMs: 10000,
      });

      // Fire-and-forget start() — never rejects in normal operation.
      imageGenScanOrch.start().catch((err) => {
        systemLogger.warn("Image-gen-scan orchestrator start() rejected (unexpected)", {
          operation: "image_gen_scan_orchestrator_start_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      });

      systemLogger.info("Image-gen-scan orchestrator started at boot", {
        operation: "image_gen_scan_orchestrator_started_at_boot",
        scanIntervalMs: 10000,
      });

      process.once("SIGTERM", () => {
        systemLogger.info("Image-gen-scan orchestrator stopping on SIGTERM", {
          operation: "image_gen_scan_orchestrator_lifecycle",
        });
        imageGenScanOrch.stop();
        stopImageGenWorkerPool();
        for (const [, client] of imageGenScanHostClients) {
          try {
            client.end();
          } catch {
            /* best-effort — client may already be dead */
          }
        }
        imageGenScanHostClients.clear();
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
