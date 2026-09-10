import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import {
  hosts,
  sshCredentials,
  sshCredentialUsage,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  transferRecent,
  commandHistory,
  recentActivity,
  hostAccess,
  userRoles,
  sessionRecordings,
  users,
} from "../db/schema.js";
import { eq, and, or, isNull, gte, sql, inArray, desc } from "drizzle-orm";
import type { Request, Response } from "express";
import axios from "axios";
import multer from "multer";
import { sshLogger, databaseLogger, systemLogger } from "../../utils/logger.js";
import { getSubstrateOrchestrator } from "../../distributor/substrate-orchestrator-singleton.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";
import {
  isNonEmptyString,
  isValidPort,
  stripSensitiveFields,
  transformHostResponse,
} from "./host-normalizers.js";
import { registerHostOpksshRoutes } from "./host-opkssh-routes.js";
import { registerHostFolderRoutes } from "./host-folder-routes.js";
import { registerHostFileManagerBookmarkRoutes } from "./host-file-manager-bookmark-routes.js";
import { registerHostCommandHistoryRoutes } from "./host-command-history-routes.js";
import { registerHostAutostartRoutes } from "./host-autostart-routes.js";
import { registerHostInternalRoutes } from "./host-internal-routes.js";
import { registerHostNetworkRoutes } from "./host-network-routes.js";
import { registerHostBulkRoutes } from "./host-bulk-routes.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const STATS_SERVER_URL = "http://localhost:30005";

function notifyStatsHostUpdated(
  hostId: number,
  headers: Pick<Request["headers"], "authorization" | "cookie">,
  operation: string,
): void {
  axios
    .post(
      `${STATS_SERVER_URL}/host-updated`,
      { hostId },
      {
        headers: {
          Authorization: headers.authorization || "",
          Cookie: headers.cookie || "",
        },
        timeout: 5000,
      },
    )
    .catch((err) => {
      sshLogger.warn("[host-db] notify-stats-update-failed", {
        operation,
        hostId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

/**
 * Read caller's isAdmin from DB (not JWT) — defends against mid-session revocation.
 * Mirrors the users.ts:442 pattern exactly.
 */
async function callerIsAdmin(userId: string): Promise<boolean> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return !!(rows[0]?.isAdmin);
}

registerHostInternalRoutes(router);

/**
 * @openapi
 * /host/db/host:
 *   post:
 *     summary: Create SSH host
 *     description: >
 *       Creates a new SSH host configuration.
 *       Optional body field `targetUserId` (string, admin-only): when set by an admin,
 *       the host row is inserted with hosts.userId = targetUserId instead of the caller's
 *       userId. Non-admin callers that supply targetUserId receive 403. Admin callers that
 *       supply targetUserId along with inline sensitive credentials (password, key,
 *       keyPassword, rdpPassword, vncPassword, telnetPassword, sudoPassword) receive 400
 *       — cross-user writes with inline creds are blocked because encryption requires the
 *       target's data key; use credentialId instead.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: Host created successfully.
 *       400:
 *         description: Invalid SSH data or cross-user write with inline sensitive credentials.
 *       403:
 *         description: Non-admin attempted to set targetUserId.
 *       500:
 *         description: Failed to save SSH data.
 */
router.post(
  "/db/host",
  authenticateJWT,
  requireDataAccess,
  upload.single("key"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    let hostData: Record<string, unknown>;

    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      if (req.body.data) {
        try {
          hostData = JSON.parse(req.body.data);
        } catch (err) {
          sshLogger.warn("[host-db] invalid-multipart-json", {
            operation: "host_create",
            userId,
            error: err,
          });
          return res.status(400).json({ error: "Invalid JSON data" });
        }
      } else {
        sshLogger.warn("[host-db] missing-data-field", {
          operation: "host_create",
          userId,
        });
        return res.status(400).json({ error: "Missing data field" });
      }

      if (req.file) {
        hostData.key = req.file.buffer.toString("utf8");
      }
    } else {
      hostData = req.body;
    }

    const {
      connectionType,
      name,
      folder,
      tags,
      ip,
      port,
      username,
      password,
      authMethod,
      authType,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      enableDocker,
      showTerminalInSidebar,
      showFileManagerInSidebar,
      showTunnelInSidebar,
      showDockerInSidebar,
      showServerStatsInSidebar,
      defaultPath,
      tunnelConnections,
      jumpHosts,
      quickActions,
      statsConfig,
      dockerConfig,
      terminalConfig,
      forceKeyboardInteractive,
      domain,
      security,
      ignoreCert,
      guacamoleConfig,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      portKnockSequence,
      overrideCredentialUsername,
      macAddress,
      enableSsh,
      enableRdp,
      enableVnc,
      enableTelnet,
      sshPort,
      rdpPort,
      vncPort,
      telnetPort,
      rdpUser,
      rdpPassword,
      rdpDomain,
      rdpSecurity,
      rdpIgnoreCert,
      vncPassword,
      vncUser,
      telnetUser,
      telnetPassword,
      // Phase 73 (feature 02 slice 2): opt-in flag for the Skynet-side
      // fleet-substrate reconcile sweep. Default false at the DB layer;
      // operator flips true per identity-hosting host that should receive
      // freshest bundled substrate bytes. Falsy on input = 0 stored.
      runsFleetSubstrate,
      // Admin-only: when set, insert the host with hosts.userId = targetUserId.
      // Non-admins supplying this field receive 403. Admin + inline sensitive creds → 400.
      targetUserId,
    } = hostData;
    databaseLogger.info("[host-db] create-host-start", {
      operation: "host_create",
      userId,
      name,
      ip,
    });

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(ip) ||
      !isValidPort(port)
    ) {
      sshLogger.warn("[host-db] create-host-validation-failed", {
        operation: "host_create",
        userId,
        hasIp: !!ip,
        port,
        isValidPort: isValidPort(port),
      });
      return res.status(400).json({ error: "Invalid SSH data" });
    }

    const effectiveConnectionType = connectionType || "ssh";
    const effectiveAuthType =
      authType ||
      authMethod ||
      (effectiveConnectionType !== "ssh" ? "password" : undefined);
    const effectiveUsername =
      username || rdpUser || vncUser || telnetUser || "";
    const effectiveName =
      name || (effectiveUsername ? `${effectiveUsername}@${ip}` : String(ip));
    // Default runsFleetSubstrate=true for new SSH hosts; every SSH-reachable
    // host in the fleet should receive the reconcile sweep unless the operator
    // explicitly opts out. Non-SSH hosts (RDP/VNC/Telnet) can't run the
    // agent-supervisor substrate, so they default false. An explicit value on
    // input wins over both defaults.
    const effectiveRunsFleetSubstrate =
      runsFleetSubstrate !== undefined
        ? !!runsFleetSubstrate
        : effectiveConnectionType === "ssh";

    // Admin-only targetUserId gate — must come AFTER basic validation but BEFORE sshDataObj.
    // D-08 guard fires after this block so ordering of 400/403 errors stays predictable.
    let effectiveUserId = userId;
    if (targetUserId && typeof targetUserId === "string" && targetUserId !== userId) {
      const isAdminForCreate = await callerIsAdmin(userId);
      if (!isAdminForCreate) {
        sshLogger.warn("[host-db] host-create-target-user-rejected-not-admin", {
          operation: "host_create_target_user_rejected_not_admin",
          userId,
          attemptedTargetUserId: targetUserId,
        });
        return res.status(403).json({ error: "Only admin users can set targetUserId" });
      }
      // Sensitive-field block: admin cross-user writes with inline creds would require
      // the target's data key which Skynet only holds when the target is logged in.
      // Block at the API boundary to avoid a runtime encryption failure.
      const sensitiveFieldsPresent = [
        password, key, keyPassword, rdpPassword, vncPassword, telnetPassword, sudoPassword,
      ].filter((v) => v !== null && v !== undefined && v !== "");
      if (sensitiveFieldsPresent.length > 0) {
        sshLogger.warn("[host-db] host-create-target-user-rejected-sensitive-fields", {
          operation: "host_create_target_user_rejected_sensitive_fields",
          userId,
          fieldsPresent: ["password", "key", "keyPassword", "rdpPassword", "vncPassword", "telnetPassword", "sudoPassword"]
            .filter((_, i) => sensitiveFieldsPresent[i] !== undefined),
        });
        return res.status(400).json({
          error: "Cross-user writes cannot include inline sensitive credentials — use credentialId instead",
        });
      }
      effectiveUserId = targetUserId;
    }

    const sshDataObj: Record<string, unknown> = {
      userId: effectiveUserId,
      connectionType: effectiveConnectionType,
      name: effectiveName,
      folder: folder || null,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username: effectiveUsername,
      authType: effectiveAuthType,
      credentialId: credentialId || null,
      overrideCredentialUsername: overrideCredentialUsername ? 1 : 0,
      pin: pin ? 1 : 0,
      enableTerminal: enableTerminal ? 1 : 0,
      enableTunnel: enableTunnel ? 1 : 0,
      tunnelConnections: Array.isArray(tunnelConnections)
        ? JSON.stringify(tunnelConnections)
        : null,
      jumpHosts: Array.isArray(jumpHosts) ? JSON.stringify(jumpHosts) : null,
      quickActions: Array.isArray(quickActions)
        ? JSON.stringify(quickActions)
        : null,
      enableFileManager: enableFileManager ? 1 : 0,
      enableDocker: enableDocker ? 1 : 0,
      showTerminalInSidebar: showTerminalInSidebar ? 1 : 0,
      showFileManagerInSidebar: showFileManagerInSidebar ? 1 : 0,
      showTunnelInSidebar: showTunnelInSidebar ? 1 : 0,
      showDockerInSidebar: showDockerInSidebar ? 1 : 0,
      showServerStatsInSidebar: showServerStatsInSidebar ? 1 : 0,
      defaultPath: defaultPath || null,
      statsConfig: statsConfig
        ? typeof statsConfig === "string"
          ? statsConfig
          : JSON.stringify(statsConfig)
        : null,
      dockerConfig: dockerConfig
        ? typeof dockerConfig === "string"
          ? dockerConfig
          : JSON.stringify(dockerConfig)
        : null,
      terminalConfig: terminalConfig
        ? typeof terminalConfig === "string"
          ? terminalConfig
          : JSON.stringify(terminalConfig)
        : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      domain: domain || null,
      security: security || null,
      ignoreCert: ignoreCert ? 1 : 0,
      guacamoleConfig: guacamoleConfig ? JSON.stringify(guacamoleConfig) : null,
      notes: notes || null,
      sudoPassword: sudoPassword || null,
      useSocks5: useSocks5 ? 1 : 0,
      socks5Host: socks5Host || null,
      socks5Port: socks5Port || null,
      socks5Username: socks5Username || null,
      socks5Password: socks5Password || null,
      socks5ProxyChain: socks5ProxyChain
        ? JSON.stringify(socks5ProxyChain)
        : null,
      macAddress: macAddress || null,
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
      enableSsh: enableSsh ? 1 : 0,
      enableRdp: enableRdp ? 1 : 0,
      enableVnc: enableVnc ? 1 : 0,
      enableTelnet: enableTelnet ? 1 : 0,
      sshPort: sshPort || port || 22,
      rdpPort: rdpPort || 3389,
      vncPort: vncPort || 5900,
      telnetPort: telnetPort || 23,
      rdpUser: rdpUser || null,
      rdpDomain: rdpDomain || null,
      rdpSecurity: rdpSecurity || null,
      rdpIgnoreCert: rdpIgnoreCert ? 1 : 0,
      vncUser: vncUser || null,
      telnetUser: telnetUser || null,
      runsFleetSubstrate: effectiveRunsFleetSubstrate ? 1 : 0,
    };

    // For non-SSH hosts (RDP, VNC, Telnet), always save password if provided
    if (effectiveConnectionType !== "ssh") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "password") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "key") {
      if (key && typeof key === "string") {
        if (!key.includes("-----BEGIN") || !key.includes("-----END")) {
          sshLogger.warn("[host-db] invalid-ssh-key-format", {
            operation: "host_create",
            userId,
            name,
            ip,
            port,
          });
          return res.status(400).json({
            error: "Invalid SSH key format. Key must be in PEM format.",
          });
        }

        const keyValidation = parseSSHKey(
          key,
          typeof keyPassword === "string" ? keyPassword : undefined,
        );
        if (!keyValidation.success) {
          sshLogger.warn("[host-db] ssh-key-validation-failed", {
            operation: "host_create",
            userId,
            name,
            ip,
            port,
            error: keyValidation.error,
          });
          return res.status(400).json({
            error: `Invalid SSH key: ${keyValidation.error || "Unable to parse key"}`,
          });
        }
      }

      sshDataObj.key = key || null;
      sshDataObj.keyPassword = keyPassword || null;
      sshDataObj.keyType = keyType;
      sshDataObj.password = null;
    } else {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    }

    sshDataObj.rdpPassword = rdpPassword || null;
    sshDataObj.vncPassword = vncPassword || null;
    sshDataObj.telnetPassword = telnetPassword || null;

    // D-08 guard (Phase 75-04): substrate hosts must use a named credential.
    // Inline credentials on the hosts row have no CSKEK columns, so the
    // server-context orchestrator's CSKEK decrypt path (75-03) would fail.
    // Enforce at the API boundary to make the invariant permanent.
    if (effectiveRunsFleetSubstrate && !credentialId) {
      sshLogger.warn("[host-db] substrate-host-requires-credential-id", {
        operation: "host_create_substrate_no_credential",
        userId,
        name,
        ip,
      });
      return res.status(400).json({
        error: "Hosts with runsFleetSubstrate=true must use a named credential (credentialId required)",
      });
    }

    try {
      let result;
      if (effectiveUserId !== userId) {
        // Admin cross-user path: cleartext-at-rest metadata only.
        // The sensitive-field-block guard above already rejected inline creds.
        // insertNonSensitive skips DataCrypto.validateUserAccess (target's data key not needed).
        const inserted = await SimpleDBOps.insertNonSensitive(hosts, "ssh_data", sshDataObj);
        result = inserted[0];
      } else {
        try {
          result = await SimpleDBOps.insert(
            hosts,
            "ssh_data",
            sshDataObj,
            effectiveUserId,
          );
        } catch (insertErr) {
          // DataCrypto.validateUserAccess throws when the target user is not logged in
          // (no data key cached server-side). Surface as a 400 so admin gets actionable feedback.
          if (
            insertErr instanceof Error &&
            (insertErr.message.includes("not logged in") ||
              insertErr.message.includes("No data key") ||
              insertErr.message.includes("User data key not found") ||
              insertErr.message.includes("Data key not available"))
          ) {
            sshLogger.warn("[host-db] host-create-target-user-not-logged-in", {
              operation: "host_create_target_user_not_logged_in",
              userId,
              effectiveUserId,
            });
            return res.status(400).json({
              error: "Target user not logged in — Skynet cannot encrypt on their behalf. Ask them to log in first.",
            });
          }
          throw insertErr;
        }
      }

      if (!result) {
        sshLogger.warn("[host-db] create-host-no-result", {
          operation: "host_create",
          userId,
          name,
          ip,
          port,
        });
        return res.status(500).json({ error: "Failed to create host" });
      }

      const createdHost = result;
      const baseHost = transformHostResponse(createdHost);

      const resolvedHost =
        (await resolveHostCredentials(baseHost, userId)) || baseHost;
      databaseLogger.success("[host-db] create-host-ok", {
        operation: "host_create_success",
        userId,
        hostId: createdHost.id as number,
        name,
      });

      if (effectiveUserId !== userId) {
        databaseLogger.info("[host-db] host-create-admin-cross-user", {
          operation: "host_create_admin_cross_user",
          callerUserId: userId,
          effectiveUserId,
          hostId: createdHost.id as number,
        });
      }

      res.json(resolvedHost);
      notifyStatsHostUpdated(
        createdHost.id as number,
        req.headers,
        "host_create",
      );

      // Phase 75-06 (D-02) — on-add fire-and-forget install pass. Substrate
      // hosts get an immediate sweep so the freshly-provisioned host is
      // bootstrapped without waiting for the 30s retry tick. Fire-and-forget
      // from this handler's perspective: the HTTP response has ALREADY been
      // sent (res.json above); the microtask runs after the response resolves.
      //
      // Uses queueMicrotask (NOT setImmediate) per WARN-3 discipline from
      // ssh-poll-orchestrator.ts:2110-2117 — queueMicrotask is drainable in
      // tests via `await Promise.resolve()`, setImmediate under vi.useFakeTimers
      // is not.
      //
      // Errors from sweepOneHost are contained by the orchestrator's never-
      // reject contract (75-02 test NT2). The wrapper's try/catch is defense-
      // in-depth to satisfy the phase-level invariant "fire-and-forget install-
      // pass errors must NEVER surface to the host-create HTTP response."
      if (effectiveRunsFleetSubstrate && effectiveConnectionType === "ssh") {
        queueMicrotask(async () => {
          const orch = getSubstrateOrchestrator();
          if (!orch) {
            systemLogger.warn("Substrate orchestrator not available for on-add sweep", {
              operation: "fleet_substrate_on_add_no_orchestrator",
              fleetHostId: String(createdHost.id),
              hostName: effectiveName,
            });
            return;
          }
          try {
            await orch.sweepOneHost({
              id: String(createdHost.id),
              name: effectiveName as string,
            });
          } catch (err) {
            // Defense-in-depth. Should be unreachable per 75-02 NT2.
            systemLogger.warn("On-add sweep threw unexpectedly", {
              operation: "fleet_substrate_on_add_sweep_error",
              fleetHostId: String(createdHost.id),
              hostName: effectiveName,
              error: err instanceof Error ? err.message : "unknown",
            });
          }
        });
      }
    } catch (err) {
      sshLogger.error("[host-db] create-host-failed", err, {
        operation: "host_create",
        userId,
        name,
        ip,
        port,
        authType: effectiveAuthType,
      });
      res.status(500).json({ error: "Failed to save SSH data" });
    }
  },
);

/**
 * @openapi
 * /host/quick-connect:
 *   post:
 *     summary: Create a temporary SSH connection without saving to database
 *     description: Returns a temporary host configuration for immediate use
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip
 *               - port
 *               - username
 *               - authType
 *             properties:
 *               ip:
 *                 type: string
 *                 description: SSH server IP or hostname
 *               port:
 *                 type: number
 *                 description: SSH server port
 *               username:
 *                 type: string
 *                 description: SSH username
 *               authType:
 *                 type: string
 *                 enum: [password, key, credential]
 *                 description: Authentication method
 *               password:
 *                 type: string
 *                 description: Password (required if authType is password)
 *               key:
 *                 type: string
 *                 description: SSH private key (required if authType is key)
 *               keyPassword:
 *                 type: string
 *                 description: SSH key password (optional)
 *               keyType:
 *                 type: string
 *                 description: SSH key type
 *               credentialId:
 *                 type: number
 *                 description: Credential ID (required if authType is credential)
 *               overrideCredentialUsername:
 *                 type: boolean
 *                 description: Use provided username instead of credential username
 *     responses:
 *       200:
 *         description: Temporary host configuration created successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Credential not found
 *       500:
 *         description: Server error
 */
router.post(
  "/quick-connect",
  authenticateJWT,
  requireDataAccess,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    const {
      ip,
      port,
      username,
      authType,
      password,
      key,
      keyPassword,
      keyType,
      credentialId,
      overrideCredentialUsername,
    } = req.body;

    if (
      !isNonEmptyString(ip) ||
      !isValidPort(port) ||
      !isNonEmptyString(username) ||
      !authType
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      let resolvedPassword = password;
      let resolvedKey = key;
      let resolvedKeyPassword = keyPassword;
      let resolvedKeyType = keyType;
      let resolvedAuthType = authType;
      let resolvedUsername = username;

      if (authType === "credential" && credentialId) {
        const credentials = await SimpleDBOps.select(
          db
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, credentialId),
                eq(sshCredentials.userId, userId),
              ),
            ),
          "ssh_credentials",
          userId,
        );

        if (!credentials || credentials.length === 0) {
          return res.status(404).json({ error: "Credential not found" });
        }

        const cred = credentials[0];

        resolvedPassword = cred.password as string | undefined;
        resolvedKey = cred.privateKey as string | undefined;
        resolvedKeyPassword = cred.keyPassword as string | undefined;
        resolvedKeyType = cred.keyType as string | undefined;
        resolvedAuthType = cred.authType as string | undefined;

        if (!overrideCredentialUsername) {
          resolvedUsername = cred.username as string;
        }
      }

      const tempHost: Record<string, unknown> = {
        id: -Date.now(),
        userId: userId,
        name: `${resolvedUsername}@${ip}:${port}`,
        ip,
        port: Number(port),
        username: resolvedUsername,
        folder: "",
        tags: [],
        pin: false,
        authType: resolvedAuthType || authType,
        password: resolvedPassword,
        key: resolvedKey,
        keyPassword: resolvedKeyPassword,
        keyType: resolvedKeyType,
        enableTerminal: true,
        enableTunnel: false,
        enableFileManager: true,
        enableDocker: false,
        showTerminalInSidebar: true,
        showFileManagerInSidebar: false,
        showTunnelInSidebar: false,
        showDockerInSidebar: false,
        showServerStatsInSidebar: false,
        defaultPath: "/",
        tunnelConnections: [],
        jumpHosts: [],
        quickActions: [],
        statsConfig: {},
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return res.status(200).json(tempHost);
    } catch (error) {
      sshLogger.error("[host-db] quick-connect-failed", error, {
        operation: "quick_connect",
        userId,
        ip,
        port,
        authType,
      });
      return res
        .status(500)
        .json({ error: "Failed to create quick connection" });
    }
  },
);

/**
 * @openapi
 * /host/db/host/{id}:
 *   put:
 *     summary: Update SSH host
 *     description: >
 *       Updates an existing SSH host configuration.
 *       Optional body field `targetUserId` (string, admin-only): when set by an admin,
 *       the host row's userId is re-assigned to targetUserId. Admin callers can also update
 *       rows they do not own (bypassing the "only owner" 403) when no inline sensitive
 *       credentials are in the body. Non-admin callers that supply targetUserId receive 403.
 *       Admin callers that supply targetUserId with inline sensitive credentials receive 400
 *       — use credentialId instead.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Host updated successfully.
 *       400:
 *         description: Invalid SSH data or cross-user write with inline sensitive credentials.
 *       403:
 *         description: Access denied or non-admin attempted to set targetUserId.
 *       404:
 *         description: Host not found.
 *       500:
 *         description: Failed to update SSH data.
 */
router.put(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  upload.single("key"),
  async (req: Request, res: Response) => {
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const userId = (req as AuthenticatedRequest).userId;
    let hostData: Record<string, unknown>;

    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      if (req.body.data) {
        try {
          hostData = JSON.parse(req.body.data);
        } catch (err) {
          sshLogger.warn("[host-db] invalid-multipart-json", {
            operation: "host_update",
            hostId: parseInt(hostId),
            userId,
            error: err,
          });
          return res.status(400).json({ error: "Invalid JSON data" });
        }
      } else {
        sshLogger.warn("[host-db] missing-data-field", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(400).json({ error: "Missing data field" });
      }

      if (req.file) {
        hostData.key = req.file.buffer.toString("utf8");
      }
    } else {
      hostData = req.body;
    }

    const {
      connectionType,
      name,
      folder,
      tags,
      ip,
      port,
      username,
      password,
      authMethod,
      authType,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      enableDocker,
      showTerminalInSidebar,
      showFileManagerInSidebar,
      showTunnelInSidebar,
      showDockerInSidebar,
      showServerStatsInSidebar,
      defaultPath,
      tunnelConnections,
      jumpHosts,
      quickActions,
      statsConfig,
      dockerConfig,
      terminalConfig,
      forceKeyboardInteractive,
      domain,
      security,
      ignoreCert,
      guacamoleConfig,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      portKnockSequence,
      overrideCredentialUsername,
      macAddress,
      enableSsh,
      enableRdp,
      enableVnc,
      enableTelnet,
      sshPort,
      rdpPort,
      vncPort,
      telnetPort,
      rdpUser,
      rdpPassword,
      rdpDomain,
      rdpSecurity,
      rdpIgnoreCert,
      vncPassword,
      vncUser,
      telnetUser,
      telnetPassword,
      // Phase 73 (feature 02 slice 2): opt-in flag for the Skynet-side
      // fleet-substrate reconcile sweep. Default false at the DB layer;
      // operator flips true per identity-hosting host that should receive
      // freshest bundled substrate bytes. Falsy on input = 0 stored.
      runsFleetSubstrate,
      // Admin-only: when set, re-assign the host row's userId to targetUserId.
      // Admin can also update rows they do not own when targetUserId is absent.
      targetUserId,
    } = hostData;
    databaseLogger.info("[host-db] update-host-start", {
      operation: "host_update",
      userId,
      hostId: parseInt(hostId),
      changes: Object.keys(hostData),
    });

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(ip) ||
      !isValidPort(port) ||
      !hostId
    ) {
      sshLogger.warn("[host-db] update-host-validation-failed", {
        operation: "host_update",
        hostId: parseInt(hostId),
        userId,
        hasIp: !!ip,
        port,
        isValidPort: isValidPort(port),
      });
      return res.status(400).json({ error: "Invalid SSH data" });
    }

    const effectiveAuthType = authType || authMethod;
    const effectiveUsername =
      username || rdpUser || vncUser || telnetUser || "";
    const effectiveName =
      name || (effectiveUsername ? `${effectiveUsername}@${ip}` : String(ip));
    const sshDataObj: Record<string, unknown> = {
      connectionType: connectionType || "ssh",
      name: effectiveName,
      folder,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username: effectiveUsername,
      authType: effectiveAuthType,
      credentialId: credentialId || null,
      overrideCredentialUsername: overrideCredentialUsername ? 1 : 0,
      pin: pin ? 1 : 0,
      enableTerminal: enableTerminal ? 1 : 0,
      enableTunnel: enableTunnel ? 1 : 0,
      tunnelConnections: Array.isArray(tunnelConnections)
        ? JSON.stringify(tunnelConnections)
        : null,
      jumpHosts: Array.isArray(jumpHosts) ? JSON.stringify(jumpHosts) : null,
      quickActions: Array.isArray(quickActions)
        ? JSON.stringify(quickActions)
        : null,
      enableFileManager: enableFileManager ? 1 : 0,
      enableDocker: enableDocker ? 1 : 0,
      showTerminalInSidebar: showTerminalInSidebar ? 1 : 0,
      showFileManagerInSidebar: showFileManagerInSidebar ? 1 : 0,
      showTunnelInSidebar: showTunnelInSidebar ? 1 : 0,
      showDockerInSidebar: showDockerInSidebar ? 1 : 0,
      showServerStatsInSidebar: showServerStatsInSidebar ? 1 : 0,
      defaultPath: defaultPath || null,
      statsConfig: statsConfig
        ? typeof statsConfig === "string"
          ? statsConfig
          : JSON.stringify(statsConfig)
        : null,
      dockerConfig: dockerConfig
        ? typeof dockerConfig === "string"
          ? dockerConfig
          : JSON.stringify(dockerConfig)
        : null,
      terminalConfig: terminalConfig
        ? typeof terminalConfig === "string"
          ? terminalConfig
          : JSON.stringify(terminalConfig)
        : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      domain: domain || null,
      security: security || null,
      ignoreCert: ignoreCert ? 1 : 0,
      guacamoleConfig: guacamoleConfig ? JSON.stringify(guacamoleConfig) : null,
      notes: notes || null,
      sudoPassword: sudoPassword || null,
      useSocks5: useSocks5 ? 1 : 0,
      socks5Host: socks5Host || null,
      socks5Port: socks5Port || null,
      socks5Username: socks5Username || null,
      socks5Password: socks5Password || null,
      socks5ProxyChain: socks5ProxyChain
        ? JSON.stringify(socks5ProxyChain)
        : null,
      macAddress: macAddress || null,
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
      enableSsh: enableSsh ? 1 : 0,
      enableRdp: enableRdp ? 1 : 0,
      enableVnc: enableVnc ? 1 : 0,
      enableTelnet: enableTelnet ? 1 : 0,
      sshPort: sshPort || port || 22,
      rdpPort: rdpPort || 3389,
      vncPort: vncPort || 5900,
      telnetPort: telnetPort || 23,
      rdpUser: rdpUser || null,
      rdpDomain: rdpDomain || null,
      rdpSecurity: rdpSecurity || null,
      rdpIgnoreCert: rdpIgnoreCert ? 1 : 0,
      vncUser: vncUser || null,
      telnetUser: telnetUser || null,
      // Phase 73 (feature 02 slice 2): opt-in flag for the Skynet-side
      // fleet-substrate reconcile sweep.
      runsFleetSubstrate: runsFleetSubstrate ? 1 : 0,
    };

    // For non-SSH hosts (RDP, VNC, Telnet), always save password if provided
    if ((connectionType || "ssh") !== "ssh") {
      if (password) {
        sshDataObj.password = password;
      }
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "password") {
      if (password) {
        sshDataObj.password = password;
      }
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "key") {
      if (key && typeof key === "string") {
        if (!key.includes("-----BEGIN") || !key.includes("-----END")) {
          sshLogger.warn("[host-db] invalid-ssh-key-format", {
            operation: "host_update",
            hostId: parseInt(hostId),
            userId,
            name,
            ip,
            port,
          });
          return res.status(400).json({
            error: "Invalid SSH key format. Key must be in PEM format.",
          });
        }

        const keyValidation = parseSSHKey(
          key,
          typeof keyPassword === "string" ? keyPassword : undefined,
        );
        if (!keyValidation.success) {
          sshLogger.warn("[host-db] ssh-key-validation-failed", {
            operation: "host_update",
            hostId: parseInt(hostId),
            userId,
            name,
            ip,
            port,
            error: keyValidation.error,
          });
          return res.status(400).json({
            error: `Invalid SSH key: ${keyValidation.error || "Unable to parse key"}`,
          });
        }

        sshDataObj.key = key;
      }
      if (keyPassword !== undefined) {
        sshDataObj.keyPassword = keyPassword || null;
      }
      if (keyType) {
        sshDataObj.keyType = keyType;
      }
      sshDataObj.password = null;
    } else {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    }

    if (rdpPassword !== undefined) sshDataObj.rdpPassword = rdpPassword || null;
    if (vncPassword !== undefined) sshDataObj.vncPassword = vncPassword || null;
    if (telnetPassword !== undefined)
      sshDataObj.telnetPassword = telnetPassword || null;

    // Admin-only targetUserId gate — must come BEFORE permissionManager.canAccessHost.
    // Read isAdmin once here and reuse below to avoid a second DB round-trip.
    const isAdminForUpdate = await callerIsAdmin(userId);
    let effectiveUpdateUserId = userId;

    if (targetUserId && typeof targetUserId === "string" && targetUserId !== userId) {
      if (!isAdminForUpdate) {
        sshLogger.warn("[host-db] host-update-target-user-rejected-not-admin", {
          operation: "host_update_target_user_rejected_not_admin",
          userId,
          hostId: parseInt(hostId),
          attemptedTargetUserId: targetUserId,
        });
        return res.status(403).json({ error: "Only admin users can set targetUserId" });
      }
      // Sensitive-field block for cross-user writes: requires target's data key.
      const sensitiveFieldsPresent = [
        password, key, keyPassword, rdpPassword, vncPassword, telnetPassword, sudoPassword,
      ].filter((v) => v !== null && v !== undefined && v !== "");
      if (sensitiveFieldsPresent.length > 0) {
        sshLogger.warn("[host-db] host-update-target-user-rejected-sensitive-fields", {
          operation: "host_update_target_user_rejected_sensitive_fields",
          userId,
          hostId: parseInt(hostId),
        });
        return res.status(400).json({
          error: "Cross-user writes cannot include inline sensitive credentials — use credentialId instead",
        });
      }
      effectiveUpdateUserId = targetUserId;
    }

    try {
      const accessInfo = await permissionManager.canAccessHost(
        userId,
        Number(hostId),
        "write",
      );

      // Admin bypasses the "no access" gate entirely (they can update any host).
      if (!accessInfo.hasAccess && !isAdminForUpdate) {
        sshLogger.warn("[host-db] update-host-unauthorized", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(403).json({ error: "Access denied" });
      }

      // Admin bypasses the "only owner can modify" gate.
      if (!accessInfo.isOwner && !isAdminForUpdate) {
        sshLogger.warn("[host-db] update-host-view-only-rejected", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(403).json({
          error: "Only the host owner can modify host configuration",
        });
      }

      // Phase 75-06 — load BEFORE-state along with ownership fields so we can
      // detect substrate-relevant transitions (flag flip-on OR credentialId
      // change on already-substrate) for the fire-and-forget sweep trigger.
      const hostRecord = await db
        .select({
          userId: hosts.userId,
          credentialId: hosts.credentialId,
          authType: hosts.authType,
          runsFleetSubstrate: hosts.runsFleetSubstrate,
        })
        .from(hosts)
        .where(eq(hosts.id, Number(hostId)))
        .limit(1);

      if (hostRecord.length === 0) {
        sshLogger.warn("[host-db] update-host-not-found", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found" });
      }

      const ownerId = hostRecord[0].userId;

      // Admin bypasses the credential-change and authType-change owner restrictions.
      if (
        !accessInfo.isOwner &&
        !isAdminForUpdate &&
        sshDataObj.credentialId !== undefined &&
        sshDataObj.credentialId !== hostRecord[0].credentialId
      ) {
        return res.status(403).json({
          error: "Only the host owner can change the credential",
        });
      }

      if (
        !accessInfo.isOwner &&
        !isAdminForUpdate &&
        sshDataObj.authType !== undefined &&
        sshDataObj.authType !== hostRecord[0].authType
      ) {
        return res.status(403).json({
          error: "Only the host owner can change the authentication type",
        });
      }

      if (sshDataObj.credentialId !== undefined) {
        if (
          hostRecord[0].credentialId !== null &&
          sshDataObj.credentialId === null
        ) {
          await db
            .delete(hostAccess)
            .where(eq(hostAccess.hostId, Number(hostId)));
        }
      }

      // D-08 guard (Phase 75-04): substrate hosts must use a named credential.
      // Same invariant as POST — enforced on update including flag-flip-on.
      if (!!runsFleetSubstrate && !credentialId) {
        sshLogger.warn("[host-db] substrate-host-requires-credential-id", {
          operation: "host_update_substrate_no_credential",
          userId,
          hostId: parseInt(hostId),
        });
        return res.status(400).json({
          error: "Hosts with runsFleetSubstrate=true must use a named credential (credentialId required)",
        });
      }

      // Admin re-assignment: when admin provides targetUserId (→ effectiveUpdateUserId),
      // update the row's userId column so ownership is transferred.
      // Only set this when admin AND effectiveUpdateUserId differs from current ownerId.
      if (isAdminForUpdate && effectiveUpdateUserId !== userId) {
        sshDataObj.userId = effectiveUpdateUserId;
      }

      // Use ownerId (existing row owner) for the encrypt/decrypt key in SimpleDBOps.update
      // so that fields already encrypted under ownerId are re-encrypted correctly.
      // effectiveUpdateUserId is captured in sshDataObj.userId above for the DB column.
      const encryptKeyUserId = effectiveUpdateUserId !== userId ? effectiveUpdateUserId : ownerId;

      if (isAdminForUpdate && effectiveUpdateUserId !== userId) {
        // Admin cross-user path: skip target-user data key validation.
        // The sensitive-field-block guard above already rejected inline creds.
        await SimpleDBOps.updateNonSensitive(
          hosts,
          "ssh_data",
          eq(hosts.id, Number(hostId)),
          sshDataObj,
        );
      } else {
        try {
          await SimpleDBOps.update(
            hosts,
            "ssh_data",
            eq(hosts.id, Number(hostId)),
            sshDataObj,
            encryptKeyUserId,
          );
        } catch (updateErr) {
          // DataCrypto.validateUserAccess throws when the target user is not logged in.
          // This branch is only reachable for same-user writes; cross-user uses updateNonSensitive.
          if (
            updateErr instanceof Error &&
            (updateErr.message.includes("not logged in") ||
              updateErr.message.includes("No data key") ||
              updateErr.message.includes("User data key not found") ||
              updateErr.message.includes("Data key not available"))
          ) {
            sshLogger.warn("[host-db] host-update-target-user-not-logged-in", {
              operation: "host_update_target_user_not_logged_in",
              userId,
              effectiveUpdateUserId,
              hostId: parseInt(hostId),
            });
            return res.status(400).json({
              error: "Target user not logged in — Skynet cannot encrypt on their behalf. Ask them to log in first.",
            });
          }
          throw updateErr;
        }
      }

      if (isAdminForUpdate && effectiveUpdateUserId !== userId) {
        databaseLogger.info("[host-db] host-update-admin-cross-user", {
          operation: "host_update_admin_cross_user",
          callerUserId: userId,
          effectiveUserId: effectiveUpdateUserId,
          hostId: parseInt(hostId),
        });
      }

      const updatedHosts = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(eq(hosts.id, Number(hostId))),
        "ssh_data",
        ownerId,
      );

      if (updatedHosts.length === 0) {
        sshLogger.warn("[host-db] update-host-no-result", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found after update" });
      }

      const updatedHost = updatedHosts[0];
      const baseHost = transformHostResponse(updatedHost);

      const resolvedHost =
        (await resolveHostCredentials(baseHost, userId)) || baseHost;
      databaseLogger.success("[host-db] update-host-ok", {
        operation: "host_update_success",
        userId,
        hostId: parseInt(hostId),
      });

      res.json(resolvedHost);
      notifyStatsHostUpdated(parseInt(hostId), req.headers, "host_update");

      // Phase 75-06 (D-08) — on-update fire-and-forget install pass.
      // Triggers when:
      //   (a) runsFleetSubstrate transitioned false→true (flag flip-on), OR
      //   (b) runsFleetSubstrate stays true AND credentialId changed
      //       (SSH key rotation, password change, etc.).
      // Non-triggers:
      //   - Flag stays false (never was, still isn't substrate)
      //   - Flag flipped true→false (leaving substrate — nothing to sweep)
      //   - Flag stays true, credentialId unchanged (metadata-only edit)
      //
      // Same fire-and-forget shape as POST (Task 1) — queueMicrotask, null-
      // orchestrator check, defense-in-depth try/catch.
      {
        const nowIsSubstrate = !!runsFleetSubstrate;
        const currentCredentialId = (credentialId as number | null) ?? null;
        const wasSubstrate = hostRecord[0].runsFleetSubstrate === true;
        const previousCredentialId =
          (hostRecord[0].credentialId as number | null) ?? null;

        const flagFlippedOn = !wasSubstrate && nowIsSubstrate;
        const credentialChangedOnSubstrate =
          wasSubstrate &&
          nowIsSubstrate &&
          previousCredentialId !== currentCredentialId;

        if (flagFlippedOn || credentialChangedOnSubstrate) {
          queueMicrotask(async () => {
            const orch = getSubstrateOrchestrator();
            if (!orch) {
              systemLogger.warn(
                "Substrate orchestrator not available for on-update sweep",
                {
                  operation: "fleet_substrate_on_add_no_orchestrator",
                  fleetHostId: String(hostId),
                  hostName: effectiveName,
                  reason: flagFlippedOn ? "flag_flip_on" : "credential_change",
                },
              );
              return;
            }
            try {
              await orch.sweepOneHost({
                id: String(hostId),
                name: effectiveName as string,
              });
            } catch (err) {
              systemLogger.warn("On-update sweep threw unexpectedly", {
                operation: "fleet_substrate_on_add_sweep_error",
                fleetHostId: String(hostId),
                hostName: effectiveName,
                error: err instanceof Error ? err.message : "unknown",
              });
            }
          });
        }
      }
    } catch (err) {
      sshLogger.error("[host-db] update-host-failed", err, {
        operation: "host_update",
        hostId: parseInt(hostId),
        userId,
        name,
        ip,
        port,
        authType: effectiveAuthType,
      });
      res.status(500).json({ error: "Failed to update SSH data" });
    }
  },
);

/**
 * @openapi
 * /host/db/host:
 *   get:
 *     summary: Get all SSH hosts
 *     description: Retrieves all SSH hosts for the authenticated user.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: A list of SSH hosts.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch SSH data.
 */
router.get(
  "/db/host",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!isNonEmptyString(userId)) {
      sshLogger.warn("[host-db] fetch-hosts-invalid-user", {
        operation: "host_fetch",
        userId,
      });
      return res.status(400).json({ error: "Invalid userId" });
    }
    // Phase 102: opt-in `?ownedOnly=true` restricts results to hosts the
    // requester owns (hosts.userId === userId), bypassing both admin
    // cross-user visibility AND shared-credential access. Every UI surface
    // that presents a picker or sidebar of hosts should pass this so on
    // multi-user instances (T800 with 100 users) the picker doesn't surface
    // every other user's hosts. Default (param omitted) preserves the
    // existing behavior verbatim so no non-picker consumer regresses.
    const ownedOnly = req.query.ownedOnly === "true";
    try {
      const isAdmin = await callerIsAdmin(userId);
      const treatAsAdmin = isAdmin && !ownedOnly;
      const now = new Date().toISOString();

      const userRoleIds = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      const roleIds = userRoleIds.map((r) => r.roleId);

      const rawData = await db
        .select({
          id: hosts.id,
          userId: hosts.userId,
          connectionType: hosts.connectionType,
          name: hosts.name,
          ip: hosts.ip,
          port: hosts.port,
          username: hosts.username,
          folder: hosts.folder,
          tags: hosts.tags,
          pin: hosts.pin,
          authType: hosts.authType,
          password: hosts.password,
          key: hosts.key,
          keyPassword: hosts.keyPassword,
          keyType: hosts.keyType,
          enableTerminal: hosts.enableTerminal,
          enableTunnel: hosts.enableTunnel,
          tunnelConnections: hosts.tunnelConnections,
          jumpHosts: hosts.jumpHosts,
          enableFileManager: hosts.enableFileManager,
          defaultPath: hosts.defaultPath,
          autostartPassword: hosts.autostartPassword,
          autostartKey: hosts.autostartKey,
          autostartKeyPassword: hosts.autostartKeyPassword,
          forceKeyboardInteractive: hosts.forceKeyboardInteractive,
          statsConfig: hosts.statsConfig,
          terminalConfig: hosts.terminalConfig,
          sudoPassword: hosts.sudoPassword,
          createdAt: hosts.createdAt,
          updatedAt: hosts.updatedAt,
          credentialId: hosts.credentialId,
          overrideCredentialUsername: hosts.overrideCredentialUsername,
          quickActions: hosts.quickActions,
          notes: hosts.notes,
          enableDocker: hosts.enableDocker,
          showTerminalInSidebar: hosts.showTerminalInSidebar,
          showFileManagerInSidebar: hosts.showFileManagerInSidebar,
          showTunnelInSidebar: hosts.showTunnelInSidebar,
          showDockerInSidebar: hosts.showDockerInSidebar,
          showServerStatsInSidebar: hosts.showServerStatsInSidebar,
          useSocks5: hosts.useSocks5,
          socks5Host: hosts.socks5Host,
          socks5Port: hosts.socks5Port,
          socks5Username: hosts.socks5Username,
          socks5Password: hosts.socks5Password,
          socks5ProxyChain: hosts.socks5ProxyChain,
          portKnockSequence: hosts.portKnockSequence,
          domain: hosts.domain,
          security: hosts.security,
          ignoreCert: hosts.ignoreCert,
          guacamoleConfig: hosts.guacamoleConfig,
          macAddress: hosts.macAddress,
          dockerConfig: hosts.dockerConfig,
          enableSsh: hosts.enableSsh,
          enableRdp: hosts.enableRdp,
          enableVnc: hosts.enableVnc,
          enableTelnet: hosts.enableTelnet,
          sshPort: hosts.sshPort,
          rdpPort: hosts.rdpPort,
          vncPort: hosts.vncPort,
          telnetPort: hosts.telnetPort,
          rdpUser: hosts.rdpUser,
          rdpPassword: hosts.rdpPassword,
          rdpDomain: hosts.rdpDomain,
          rdpSecurity: hosts.rdpSecurity,
          rdpIgnoreCert: hosts.rdpIgnoreCert,
          vncUser: hosts.vncUser,
          vncPassword: hosts.vncPassword,
          telnetUser: hosts.telnetUser,
          telnetPassword: hosts.telnetPassword,
          runsFleetSubstrate: hosts.runsFleetSubstrate,

          ownerId: hosts.userId,
          isShared: sql<boolean>`${hostAccess.id} IS NOT NULL AND ${hosts.userId} != ${userId}`,
          permissionLevel: hostAccess.permissionLevel,
          expiresAt: hostAccess.expiresAt,
        })
        .from(hosts)
        .leftJoin(
          hostAccess,
          and(
            eq(hostAccess.hostId, hosts.id),
            or(
              eq(hostAccess.userId, userId),
              roleIds.length > 0
                ? inArray(hostAccess.roleId, roleIds)
                : sql`false`,
            ),
            or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
          ),
        )
        .where(
          ownedOnly
            ? eq(hosts.userId, userId)
            : treatAsAdmin
              ? undefined
              : or(
                  eq(hosts.userId, userId),
                  and(
                    eq(hostAccess.userId, userId),
                    or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
                  ),
                  roleIds.length > 0
                    ? and(
                        inArray(hostAccess.roleId, roleIds),
                        or(
                          isNull(hostAccess.expiresAt),
                          gte(hostAccess.expiresAt, now),
                        ),
                      )
                    : sql`false`,
                ),
        );

      if (treatAsAdmin) {
        databaseLogger.info("[host-db] admin-cross-user-read-hosts", {
          operation: "admin_cross_user_read",
          table: "hosts",
          callerUserId: userId,
          rowCount: rawData.length,
        });
      }

      // For admin: treat ALL rows as "own" for the decryption loop (foreign rows
      // will decrypt with admin's data key; sensitive fields on other users' rows
      // will fall through LazyFieldEncryption's empty-string fallback — that is
      // acceptable: admin's use case is linking rows to shared credentials, not
      // viewing other users' inline passwords). Under ownedOnly the WHERE
      // already restricts rawData to own rows, so this split degenerates to
      // ownHosts=rawData, sharedHosts=[] naturally.
      const ownHosts = treatAsAdmin ? rawData : rawData.filter((row) => row.userId === userId);
      const sharedHosts = treatAsAdmin ? [] : rawData.filter((row) => row.userId !== userId);

      const decryptedOwnHosts: Record<string, unknown>[] = [];
      const userDataKey = DataCrypto.getUserDataKey(userId);
      if (userDataKey) {
        for (const host of ownHosts) {
          try {
            decryptedOwnHosts.push(
              DataCrypto.decryptRecord("ssh_data", host, userId, userDataKey),
            );
          } catch (decryptError) {
            sshLogger.warn("[host-db] fetch-host-invalid-encrypted-fields", {
              operation: "host_fetch_own_decrypt_failed",
              userId,
              hostId: host.id,
              error:
                decryptError instanceof Error
                  ? decryptError.message
                  : "Unknown error",
            });
          }
        }
      }

      const sanitizedSharedHosts = sharedHosts;

      const data = [...decryptedOwnHosts, ...sanitizedSharedHosts];

      const result = await Promise.all(
        data.map(async (row: Record<string, unknown>) => {
          const baseHost = {
            ...transformHostResponse(row),
            isShared: !!row.isShared,
            permissionLevel: row.permissionLevel || undefined,
            sharedExpiresAt: row.expiresAt || undefined,
          };

          const resolved =
            (await resolveHostCredentials(baseHost, userId)) || baseHost;
          return resolved;
        }),
      );

      const sanitized = result.map((host) => stripSensitiveFields(host));
      res.json(sanitized);
    } catch (err) {
      sshLogger.error("[host-db] fetch-hosts-failed", err, {
        operation: "host_fetch",
        userId,
      });
      res.status(500).json({ error: "Failed to fetch SSH data" });
    }
  },
);

/**
 * @openapi
 * /host/db/host/{id}:
 *   get:
 *     summary: Get SSH host by ID
 *     description: Retrieves a specific SSH host by its ID.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The requested SSH host.
 *       400:
 *         description: Invalid userId or hostId.
 *       404:
 *         description: SSH host not found.
 *       500:
 *         description: Failed to fetch SSH host.
 */
router.get(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId) || !hostId) {
      sshLogger.warn("[host-db] fetch-host-by-id-invalid-params", {
        operation: "host_fetch_by_id",
        hostId: parseInt(hostId),
        userId,
      });
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }
    try {
      const isAdmin = await callerIsAdmin(userId);
      const data = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(
            isAdmin
              ? eq(hosts.id, Number(hostId))
              : and(eq(hosts.id, Number(hostId)), eq(hosts.userId, userId)),
          ),
        "ssh_data",
        userId,
      );

      if (data.length === 0) {
        sshLogger.warn("[host-db] fetch-host-not-found", {
          operation: "host_fetch_by_id",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found" });
      }

      if (isAdmin && data[0].userId !== userId) {
        databaseLogger.info("[host-db] admin-cross-user-read-host-by-id", {
          operation: "admin_cross_user_read",
          table: "hosts",
          callerUserId: userId,
          hostId: parseInt(hostId),
        });
      }

      const host = data[0];
      const result = transformHostResponse(host);
      const resolved = (await resolveHostCredentials(result, userId)) || result;

      res.json(stripSensitiveFields(resolved));
    } catch (err) {
      sshLogger.error("[host-db] fetch-host-by-id-failed", err, {
        operation: "host_fetch_by_id",
        hostId: parseInt(hostId),
        userId,
      });
      res.status(500).json({ error: "Failed to fetch SSH host" });
    }
  },
);

/**
 * @openapi
 * /host/db/host/{id}/password:
 *   get:
 *     summary: Get host password for clipboard copy
 *     description: Returns the password for a specific host. Used by the copy-password feature.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: field
 *         schema:
 *           type: string
 *           enum: [password, sudoPassword]
 *     responses:
 *       200:
 *         description: The requested password value.
 *       404:
 *         description: Host not found or no password set.
 */
router.get(
  "/db/host/:id/password",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;
    const field = (req.query.field as string) || "password";

    if (!["password", "sudoPassword"].includes(field)) {
      return res.status(400).json({ error: "Invalid field" });
    }

    try {
      const data = await SimpleDBOps.select(
        db.select().from(hosts).where(eq(hosts.id, hostId)),
        "ssh_data",
        userId,
      );

      if (data.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = data[0];
      const resolved = (await resolveHostCredentials(host, userId)) || host;
      const value = resolved[field];

      if (!value) {
        return res.status(404).json({ error: "No password set" });
      }

      res.json({ value });
    } catch (err) {
      sshLogger.error("[host-db] fetch-host-password-failed", err, {
        operation: "host_password_fetch",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to fetch password" });
    }
  },
);

/**
 * @openapi
 * /host/db/host/{id}/export:
 *   get:
 *     summary: Export SSH host
 *     description: Exports a specific SSH host with decrypted credentials.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The exported SSH host.
 *       400:
 *         description: Invalid userId or hostId.
 *       404:
 *         description: SSH host not found.
 *       500:
 *         description: Export failed.
 */
router.get(
  "/db/host/:id/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId) || !hostId) {
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }

    try {
      const isAdmin = await callerIsAdmin(userId);
      const hostResults = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(
            isAdmin
              ? eq(hosts.id, Number(hostId))
              : and(eq(hosts.id, Number(hostId)), eq(hosts.userId, userId)),
          ),
        "ssh_data",
        userId,
      );

      if (hostResults.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      if (isAdmin && hostResults[0].userId !== userId) {
        databaseLogger.info("[host-db] admin-cross-user-read-host-export", {
          operation: "admin_cross_user_read",
          table: "hosts",
          callerUserId: userId,
          hostId: parseInt(hostId),
        });
      }

      const host = hostResults[0];

      const resolvedHost = (await resolveHostCredentials(host, userId)) || host;

      const exportedConnectionType =
        (resolvedHost.connectionType as string) || "ssh";
      const isRemoteDesktop = ["rdp", "vnc", "telnet"].includes(
        exportedConnectionType,
      );

      const baseExportData = {
        connectionType: exportedConnectionType,
        name: resolvedHost.name,
        ip: resolvedHost.ip,
        port: resolvedHost.port,
        username: resolvedHost.username,
        password: resolvedHost.password || null,
        folder: resolvedHost.folder,
        tags:
          typeof resolvedHost.tags === "string"
            ? resolvedHost.tags.split(",").filter(Boolean)
            : resolvedHost.tags || [],
        pin: !!resolvedHost.pin,
        notes: resolvedHost.notes || null,
      };

      const exportData = isRemoteDesktop
        ? {
            ...baseExportData,
            enableSsh: !!resolvedHost.enableSsh,
            enableRdp: !!resolvedHost.enableRdp,
            enableVnc: !!resolvedHost.enableVnc,
            enableTelnet: !!resolvedHost.enableTelnet,
            rdpPort: resolvedHost.rdpPort || 3389,
            vncPort: resolvedHost.vncPort || 5900,
            telnetPort: resolvedHost.telnetPort || 23,
            rdpUser: resolvedHost.rdpUser || null,
            rdpPassword: resolvedHost.rdpPassword || null,
            rdpDomain: resolvedHost.rdpDomain || null,
            rdpSecurity: resolvedHost.rdpSecurity || null,
            rdpIgnoreCert: !!resolvedHost.rdpIgnoreCert,
            vncUser: resolvedHost.vncUser || null,
            vncPassword: resolvedHost.vncPassword || null,
            telnetUser: resolvedHost.telnetUser || null,
            telnetPassword: resolvedHost.telnetPassword || null,
            guacamoleConfig: resolvedHost.guacamoleConfig
              ? JSON.parse(resolvedHost.guacamoleConfig as string)
              : null,
          }
        : {
            ...baseExportData,
            authType: resolvedHost.authType,
            key: resolvedHost.key || null,
            keyPassword: resolvedHost.keyPassword || null,
            keyType: resolvedHost.keyType || null,
            credentialId: resolvedHost.credentialId || null,
            overrideCredentialUsername:
              !!resolvedHost.overrideCredentialUsername,
            // The four connection-type enable flags are all included in the
            // export so a round-trip (GET /export → modify → PUT) preserves
            // them. The PUT handler treats a missing enable* field as false,
            // so omitting them here would silently drop them on any PUT.
            enableSsh: !!resolvedHost.enableSsh,
            enableRdp: !!resolvedHost.enableRdp,
            enableVnc: !!resolvedHost.enableVnc,
            enableTelnet: !!resolvedHost.enableTelnet,
            enableTerminal: !!resolvedHost.enableTerminal,
            enableTunnel: !!resolvedHost.enableTunnel,
            enableFileManager: !!resolvedHost.enableFileManager,
            enableDocker: !!resolvedHost.enableDocker,
            showTerminalInSidebar: !!resolvedHost.showTerminalInSidebar,
            showFileManagerInSidebar: !!resolvedHost.showFileManagerInSidebar,
            showTunnelInSidebar: !!resolvedHost.showTunnelInSidebar,
            showDockerInSidebar: !!resolvedHost.showDockerInSidebar,
            showServerStatsInSidebar: !!resolvedHost.showServerStatsInSidebar,
            defaultPath: resolvedHost.defaultPath,
            sudoPassword: resolvedHost.sudoPassword || null,
            tunnelConnections: resolvedHost.tunnelConnections
              ? JSON.parse(resolvedHost.tunnelConnections as string)
              : [],
            jumpHosts: resolvedHost.jumpHosts
              ? JSON.parse(resolvedHost.jumpHosts as string)
              : null,
            quickActions: resolvedHost.quickActions
              ? JSON.parse(resolvedHost.quickActions as string)
              : null,
            statsConfig: resolvedHost.statsConfig
              ? JSON.parse(resolvedHost.statsConfig as string)
              : null,
            dockerConfig: resolvedHost.dockerConfig
              ? JSON.parse(resolvedHost.dockerConfig as string)
              : null,
            terminalConfig: resolvedHost.terminalConfig
              ? JSON.parse(resolvedHost.terminalConfig as string)
              : null,
            forceKeyboardInteractive:
              resolvedHost.forceKeyboardInteractive === "true",
            useSocks5: !!resolvedHost.useSocks5,
            socks5Host: resolvedHost.socks5Host || null,
            socks5Port: resolvedHost.socks5Port || null,
            socks5Username: resolvedHost.socks5Username || null,
            socks5Password: resolvedHost.socks5Password || null,
            socks5ProxyChain: resolvedHost.socks5ProxyChain
              ? JSON.parse(resolvedHost.socks5ProxyChain as string)
              : null,
            portKnockSequence: resolvedHost.portKnockSequence
              ? JSON.parse(resolvedHost.portKnockSequence as string)
              : null,
            // Phase 73 (feature 02 slice 2): opt-in flag for the Skynet-side
            // fleet-substrate reconcile sweep. Only meaningful for SSH-like
            // identity-hosting hosts — RDP/VNC/Telnet targets don't run
            // agent-supervisor, so the flag is omitted from the remote-desktop
            // export branch by construction.
            runsFleetSubstrate: !!resolvedHost.runsFleetSubstrate,
          };

      sshLogger.success("[host-db] export-host-ok", {
        operation: "host_export",
        hostId: parseInt(hostId),
        userId,
      });

      res.json(exportData);
    } catch (err) {
      sshLogger.error("[host-db] export-host-failed", err, {
        operation: "host_export",
        hostId: parseInt(hostId),
        userId,
      });
      res.status(500).json({ error: "Failed to export host" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/hosts/export:
 *   get:
 *     summary: Export all SSH hosts
 *     description: Exports all SSH hosts for the current user with decrypted credentials.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: All exported SSH hosts.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Export failed.
 */
router.get(
  "/db/hosts/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const isAdmin = await callerIsAdmin(userId);
      if (isAdmin) {
        databaseLogger.info("[host-db] admin-cross-user-read-hosts-export", {
          operation: "admin_cross_user_read",
          table: "hosts",
          callerUserId: userId,
        });
      }
      const allHosts = await SimpleDBOps.select(
        isAdmin
          ? db.select().from(hosts)
          : db.select().from(hosts).where(eq(hosts.userId, userId)),
        "ssh_data",
        userId,
      );

      const exportedHosts = [];

      for (const host of allHosts) {
        const resolvedHost =
          (await resolveHostCredentials(host, userId)) || host;

        const exportedConnectionType =
          (resolvedHost.connectionType as string) || "ssh";
        const isRemoteDesktop = ["rdp", "vnc", "telnet"].includes(
          exportedConnectionType,
        );

        const baseExportData = {
          connectionType: exportedConnectionType,
          name: resolvedHost.name,
          ip: resolvedHost.ip,
          port: resolvedHost.port,
          username: resolvedHost.username,
          password: resolvedHost.password || null,
          folder: resolvedHost.folder,
          tags:
            typeof resolvedHost.tags === "string"
              ? resolvedHost.tags.split(",").filter(Boolean)
              : resolvedHost.tags || [],
          pin: !!resolvedHost.pin,
          notes: resolvedHost.notes || null,
        };

        const exportData = isRemoteDesktop
          ? {
              ...baseExportData,
              domain: resolvedHost.domain || null,
              security: resolvedHost.security || null,
              ignoreCert: !!resolvedHost.ignoreCert,
              guacamoleConfig: resolvedHost.guacamoleConfig
                ? JSON.parse(resolvedHost.guacamoleConfig as string)
                : null,
            }
          : {
              ...baseExportData,
              authType: resolvedHost.authType,
              key: resolvedHost.key || null,
              keyPassword: resolvedHost.keyPassword || null,
              keyType: resolvedHost.keyType || null,
              credentialId: resolvedHost.credentialId || null,
              overrideCredentialUsername:
                !!resolvedHost.overrideCredentialUsername,
              enableTerminal: !!resolvedHost.enableTerminal,
              enableTunnel: !!resolvedHost.enableTunnel,
              enableFileManager: !!resolvedHost.enableFileManager,
              enableDocker: !!resolvedHost.enableDocker,
              showTerminalInSidebar: !!resolvedHost.showTerminalInSidebar,
              showFileManagerInSidebar: !!resolvedHost.showFileManagerInSidebar,
              showTunnelInSidebar: !!resolvedHost.showTunnelInSidebar,
              showDockerInSidebar: !!resolvedHost.showDockerInSidebar,
              showServerStatsInSidebar: !!resolvedHost.showServerStatsInSidebar,
              defaultPath: resolvedHost.defaultPath,
              sudoPassword: resolvedHost.sudoPassword || null,
              tunnelConnections: resolvedHost.tunnelConnections
                ? JSON.parse(resolvedHost.tunnelConnections as string)
                : [],
              jumpHosts: resolvedHost.jumpHosts
                ? JSON.parse(resolvedHost.jumpHosts as string)
                : null,
              quickActions: resolvedHost.quickActions
                ? JSON.parse(resolvedHost.quickActions as string)
                : null,
              statsConfig: resolvedHost.statsConfig
                ? JSON.parse(resolvedHost.statsConfig as string)
                : null,
              dockerConfig: resolvedHost.dockerConfig
                ? JSON.parse(resolvedHost.dockerConfig as string)
                : null,
              terminalConfig: resolvedHost.terminalConfig
                ? JSON.parse(resolvedHost.terminalConfig as string)
                : null,
              forceKeyboardInteractive:
                resolvedHost.forceKeyboardInteractive === "true",
              useSocks5: !!resolvedHost.useSocks5,
              socks5Host: resolvedHost.socks5Host || null,
              socks5Port: resolvedHost.socks5Port || null,
              socks5Username: resolvedHost.socks5Username || null,
              socks5Password: resolvedHost.socks5Password || null,
              socks5ProxyChain: resolvedHost.socks5ProxyChain
                ? JSON.parse(resolvedHost.socks5ProxyChain as string)
                : null,
            };

        exportedHosts.push(exportData);
      }

      sshLogger.success("[host-db] export-all-hosts-ok", {
        operation: "hosts_export_all",
        count: exportedHosts.length,
        userId,
      });

      res.json({ hosts: exportedHosts });
    } catch (err) {
      sshLogger.error("[host-db] export-all-hosts-failed", err, {
        operation: "hosts_export_all",
        userId,
      });
      res.status(500).json({ error: "Failed to export hosts" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/host/{id}:
 *   delete:
 *     summary: Delete SSH host
 *     description: Deletes an SSH host by its ID.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: SSH host deleted successfully.
 *       400:
 *         description: Invalid userId or id.
 *       404:
 *         description: SSH host not found.
 *       500:
 *         description: Failed to delete SSH host.
 */
router.delete(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    if (!isNonEmptyString(userId) || !hostId) {
      sshLogger.warn("[host-db] delete-host-invalid-params", {
        operation: "host_delete",
        hostId: parseInt(hostId),
        userId,
      });
      return res.status(400).json({ error: "Invalid userId or id" });
    }
    databaseLogger.info("[host-db] delete-host-start", {
      operation: "host_delete",
      userId,
      hostId: parseInt(hostId),
    });
    try {
      const hostToDelete = await db
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, Number(hostId)), eq(hosts.userId, userId)));

      if (hostToDelete.length === 0) {
        sshLogger.warn("[host-db] delete-host-not-found", {
          operation: "host_delete",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found" });
      }

      const numericHostId = Number(hostId);

      await db
        .delete(fileManagerRecent)
        .where(eq(fileManagerRecent.hostId, numericHostId));

      await db
        .delete(fileManagerPinned)
        .where(eq(fileManagerPinned.hostId, numericHostId));

      await db
        .delete(fileManagerShortcuts)
        .where(eq(fileManagerShortcuts.hostId, numericHostId));

      await db
        .delete(transferRecent)
        .where(
          or(
            eq(transferRecent.sourceHostId, numericHostId),
            eq(transferRecent.destHostId, numericHostId),
          ),
        );

      await db
        .delete(commandHistory)
        .where(eq(commandHistory.hostId, numericHostId));

      await db
        .delete(sshCredentialUsage)
        .where(eq(sshCredentialUsage.hostId, numericHostId));

      await db
        .delete(recentActivity)
        .where(eq(recentActivity.hostId, numericHostId));

      await db.delete(hostAccess).where(eq(hostAccess.hostId, numericHostId));

      await db
        .delete(sessionRecordings)
        .where(eq(sessionRecordings.hostId, numericHostId));

      await db
        .delete(hosts)
        .where(and(eq(hosts.id, numericHostId), eq(hosts.userId, userId)));

      // Skynet's DB is in-memory-decrypted SQLite; direct db.delete().run() writes
      // reach RAM only. Without an explicit save call, this delete survives to
      // disk only if SIGTERM's graceful flush wins the deploy race. Force the
      // save here so the delete is durable before we ACK.
      try {
        await DatabaseSaveTrigger.forceSave("host_delete");
      } catch (saveErr) {
        databaseLogger.warn("Force-save after host delete failed", {
          operation: "host_delete_save_failed",
          userId,
          hostId: parseInt(hostId),
          error:
            saveErr instanceof Error ? saveErr.message : "Unknown error",
        });
      }

      databaseLogger.success("[host-db] delete-host-ok", {
        operation: "host_delete_success",
        userId,
        hostId: parseInt(hostId),
      });

      try {
        const axios = (await import("axios")).default;
        await axios.post(
          `${STATS_SERVER_URL}/host-deleted`,
          { hostId: numericHostId },
          {
            headers: {
              Authorization: req.headers.authorization || "",
              Cookie: req.headers.cookie || "",
            },
            timeout: 5000,
          },
        );
      } catch (err) {
        sshLogger.warn("[host-db] notify-stats-delete-failed", {
          operation: "host_delete",
          hostId: numericHostId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json({ message: "Host deleted" });
    } catch (err) {
      sshLogger.error("[host-db] delete-host-failed", err, {
        operation: "host_delete",
        hostId: parseInt(hostId),
        userId,
      });
      res.status(500).json({ error: "Failed to delete SSH host" });
    }
  },
);

registerHostFileManagerBookmarkRoutes(router, authenticateJWT);

router.get(
  "/transfer/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sourceHostIdQuery = Array.isArray(req.query.sourceHostId)
      ? req.query.sourceHostId[0]
      : req.query.sourceHostId;
    const sourceHostId = sourceHostIdQuery
      ? parseInt(sourceHostIdQuery as string)
      : null;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!sourceHostId) {
      return res.status(400).json({ error: "Source host ID is required" });
    }

    try {
      const recent = await db
        .select()
        .from(transferRecent)
        .where(
          and(
            eq(transferRecent.userId, userId),
            eq(transferRecent.sourceHostId, sourceHostId),
          ),
        )
        .orderBy(desc(transferRecent.lastUsed))
        .limit(10);

      res.json(recent);
    } catch (err) {
      sshLogger.error("[host-db] fetch-transfer-destinations-failed", err);
      res.status(500).json({ error: "Failed to fetch recent destinations" });
    }
  },
);

router.post(
  "/transfer/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { sourceHostId, destHostId, destPath, destPathLabel } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !sourceHostId ||
      !destHostId ||
      !destPath
    ) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const existing = await db
        .select()
        .from(transferRecent)
        .where(
          and(
            eq(transferRecent.userId, userId),
            eq(transferRecent.sourceHostId, sourceHostId),
            eq(transferRecent.destHostId, destHostId),
            eq(transferRecent.destPath, destPath),
          ),
        );

      if (existing.length > 0) {
        await db
          .update(transferRecent)
          .set({ lastUsed: new Date().toISOString() })
          .where(eq(transferRecent.id, existing[0].id));
      } else {
        await db.insert(transferRecent).values({
          userId,
          sourceHostId,
          destHostId,
          destPath,
          destPathLabel: destPathLabel || destPath,
          lastUsed: new Date().toISOString(),
        });
      }

      const allRecent = await db
        .select()
        .from(transferRecent)
        .where(
          and(
            eq(transferRecent.userId, userId),
            eq(transferRecent.sourceHostId, sourceHostId),
          ),
        )
        .orderBy(desc(transferRecent.lastUsed));

      if (allRecent.length > 10) {
        const toDelete = allRecent.slice(10);
        for (const entry of toDelete) {
          await db
            .delete(transferRecent)
            .where(eq(transferRecent.id, entry.id));
        }
      }

      res.json({ message: "Recent destination saved" });
    } catch (err) {
      sshLogger.error("[host-db] save-transfer-destination-failed", err);
      res.status(500).json({ error: "Failed to save recent destination" });
    }
  },
);
registerHostCommandHistoryRoutes(router, authenticateJWT);

async function resolveHostCredentials(
  host: Record<string, unknown>,
  requestingUserId?: string,
): Promise<Record<string, unknown>> {
  try {
    if (host.credentialId && (host.userId || host.ownerId)) {
      const credentialId = host.credentialId as number;
      const ownerId = (host.ownerId || host.userId) as string;

      if (requestingUserId && requestingUserId !== ownerId) {
        try {
          const { SharedCredentialManager } =
            await import("../../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            host.id as number,
            requestingUserId,
          );

          if (sharedCred) {
            const resolvedHost: Record<string, unknown> = {
              ...host,
              password: sharedCred.password,
              key: sharedCred.key,
              keyPassword: sharedCred.keyPassword,
              keyType: sharedCred.keyType,
            };

            if (
              !host.overrideCredentialUsername &&
              isNonEmptyString(sharedCred.username)
            ) {
              resolvedHost.username = sharedCred.username;
            }

            return resolvedHost;
          }
        } catch (sharedCredError) {
          sshLogger.warn(
            "[host-db] resolve-shared-cred-fallback",
            {
              operation: "resolve_shared_credential_fallback",
              hostId: host.id as number,
              requestingUserId,
              error:
                sharedCredError instanceof Error
                  ? sharedCredError.message
                  : "Unknown error",
            },
          );
        }
      }

      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, credentialId),
              eq(sshCredentials.userId, ownerId),
            ),
          ),
        "ssh_credentials",
        ownerId,
      );

      if (credentials.length > 0) {
        const credential = credentials[0];
        const resolvedHost: Record<string, unknown> = {
          ...host,
          password: credential.password,
          key: credential.key,
          keyPassword: credential.keyPassword,
          keyType: credential.keyType,
        };

        if (
          !host.overrideCredentialUsername &&
          isNonEmptyString(credential.username)
        ) {
          resolvedHost.username = credential.username;
        }

        return resolvedHost;
      }
    }

    return { ...host };
  } catch (error) {
    sshLogger.warn(
      `[host-db] resolve-creds-failed hostId=${host.id} err="${error instanceof Error ? error.message : "Unknown error"}"`,
    );
    return host;
  }
}

registerHostFolderRoutes(router, {
  authenticateJWT,
  statsServerUrl: STATS_SERVER_URL,
});

registerHostBulkRoutes(router, authenticateJWT);

/**
 * @openapi
 * /host/folders/{folderName}/hosts:
 *   delete:
 *     summary: Delete all hosts in a folder
 *     description: Deletes all hosts within a specific folder.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: folderName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All hosts deleted successfully.
 *       400:
 *         description: Invalid folder name.
 *       500:
 *         description: Failed to delete hosts.
 */
router.delete(
  "/folders/:folderName/hosts",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const folderName = decodeURIComponent(
      Array.isArray(req.params.folderName)
        ? req.params.folderName[0]
        : req.params.folderName,
    );

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    try {
      const hostsToDelete = await db
        .select({ id: hosts.id })
        .from(hosts)
        .where(and(eq(hosts.userId, userId), eq(hosts.folder, folderName)));

      if (hostsToDelete.length === 0) {
        return res.json({ deletedCount: 0 });
      }

      const hostIds = hostsToDelete.map((h) => h.id);

      for (const hostId of hostIds) {
        await db
          .delete(fileManagerRecent)
          .where(eq(fileManagerRecent.hostId, hostId));
        await db
          .delete(fileManagerPinned)
          .where(eq(fileManagerPinned.hostId, hostId));
        await db
          .delete(fileManagerShortcuts)
          .where(eq(fileManagerShortcuts.hostId, hostId));
        await db
          .delete(transferRecent)
          .where(
            or(
              eq(transferRecent.sourceHostId, hostId),
              eq(transferRecent.destHostId, hostId),
            ),
          );
        await db
          .delete(commandHistory)
          .where(eq(commandHistory.hostId, hostId));
        await db
          .delete(sshCredentialUsage)
          .where(eq(sshCredentialUsage.hostId, hostId));
        await db
          .delete(recentActivity)
          .where(eq(recentActivity.hostId, hostId));
        await db.delete(hostAccess).where(eq(hostAccess.hostId, hostId));
        await db
          .delete(sessionRecordings)
          .where(eq(sessionRecordings.hostId, hostId));
      }

      await db
        .delete(hosts)
        .where(and(eq(hosts.userId, userId), eq(hosts.folder, folderName)));

      databaseLogger.success("[host-db] delete-folder-hosts-ok", {
        operation: "delete_folder_hosts",
        userId,
        folderName,
        deletedCount: hostsToDelete.length,
      });

      res.json({ deletedCount: hostsToDelete.length });
    } catch (error) {
      sshLogger.error("[host-db] delete-folder-hosts-failed", error, {
        operation: "delete_folder_hosts",
        userId,
        folderName,
      });
      res.status(500).json({ error: "Failed to delete hosts in folder" });
    }
  },
);

registerHostAutostartRoutes(router, {
  authenticateJWT,
  requireDataAccess,
});

/**
 * @openapi
 * /host/opkssh/token/{hostId}:
 *   get:
 *     summary: Get OPKSSH token status for a host
 *     tags: [SSH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: hostId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: Host ID
 *     responses:
 *       200:
 *         description: Token status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *                   description: Whether a valid token exists
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: Token expiration timestamp
 *                 email:
 *                   type: string
 *                   description: User email from OIDC identity
 *       404:
 *         description: No valid token found
 *       500:
 *         description: Internal server error
 */
router.get(
  "/ssh/opkssh/token/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    const hostId = parseInt(
      Array.isArray(req.params.hostId)
        ? req.params.hostId[0]
        : req.params.hostId,
    );

    if (!userId || isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const { opksshTokens } = await import("../db/schema.js");
      const token = await db
        .select()
        .from(opksshTokens)
        .where(
          and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
        )
        .limit(1);

      if (!token || token.length === 0) {
        return res.status(404).json({ exists: false });
      }

      const tokenData = token[0];
      const expiresAt = new Date(tokenData.expiresAt);

      if (expiresAt < new Date()) {
        await db
          .delete(opksshTokens)
          .where(
            and(
              eq(opksshTokens.userId, userId),
              eq(opksshTokens.hostId, hostId),
            ),
          );
        return res.status(404).json({ exists: false });
      }

      res.json({
        exists: true,
        expiresAt: tokenData.expiresAt,
        email: tokenData.email,
      });
    } catch (error) {
      sshLogger.error("[host-db] opkssh-token-status-error", error, {
        operation: "opkssh_token_status_error",
        userId,
        hostId,
      });
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @openapi
 * /host/opkssh/token/{hostId}:
 *   delete:
 *     summary: Delete OPKSSH token for a host
 *     tags: [SSH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: hostId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: Host ID
 *     responses:
 *       200:
 *         description: Token deleted successfully
 *       500:
 *         description: Internal server error
 */
router.delete(
  "/ssh/opkssh/token/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    const hostId = parseInt(
      Array.isArray(req.params.hostId)
        ? req.params.hostId[0]
        : req.params.hostId,
    );

    if (!userId || isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const { deleteOPKSSHToken } = await import("../../ssh/opkssh-auth.js");
      await deleteOPKSSHToken(userId, hostId);
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("[host-db] opkssh-token-delete-error", error, {
        operation: "opkssh_token_delete_error",
        userId,
        hostId,
      });
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

registerHostOpksshRoutes(router);

registerHostNetworkRoutes(router, {
  authenticateJWT,
  requireDataAccess,
});

// ---------------------------------------------------------------------------
// quick-260810-n3a: POST /:hostId/session/kill
// Full path: POST /host/:hostId/session/kill (hostRoutes is mounted at
// app.use("/host", hostRoutes) in database.ts:1794).
//
// Runs `tmux kill-session -t <session>` on the remote host via SSH.
// Treats "session not found" / "can't find session" as idempotent success.
// Sanitizes tmuxSession against /^[A-Za-z0-9._-]+$/ BEFORE any interpolation.
// ---------------------------------------------------------------------------

const PER_HOST_KILL_TIMEOUT_MS = 3000;

/**
 * Tmux session allowlist — enforced BEFORE any shell interpolation.
 * Only alphanumeric characters plus `.`, `_`, and `-` are permitted.
 * Any other character (whitespace, semicolons, pipes, dollar signs, etc.)
 * is rejected with 400 and zero SSH connections attempted.
 */
const TMUX_SESSION_ALLOWLIST = /^[A-Za-z0-9._-]+$/;

/**
 * Patterns that indicate the tmux session is already gone (idempotent kill).
 * Tmux versions vary in their exact wording; match all known variants
 * case-insensitively.
 */
const TMUX_SESSION_NOT_FOUND_RE = /session not found|can't find session|no such session/i;

router.post(
  "/:hostId/session/kill",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse and validate hostId
    const hostId = Number(req.params.hostId);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "Invalid hostId" });
    }

    // 2. Extract and type-check tmuxSession
    const { tmuxSession } = req.body as Record<string, unknown>;
    if (typeof tmuxSession !== "string" || tmuxSession.length === 0) {
      return res.status(400).json({ error: "Missing tmuxSession" });
    }

    // 3. Security gate — validate against allowlist BEFORE any interpolation
    if (!TMUX_SESSION_ALLOWLIST.test(tmuxSession)) {
      sshLogger.warn("[host-db] session-kill-invalid-name", {
        operation: "session_kill_reject",
        hostId,
        reason: "invalid_session_name",
      });
      return res.status(400).json({ error: "Invalid tmux session name" });
    }

    // 4. Resolve host
    const resolved = await resolveHostById(hostId, userId);
    if (!resolved) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 5. Open SSH connection — surface errors as 500 (do NOT swallow)
    let conn: Awaited<ReturnType<typeof connectOneShot>>;
    try {
      conn = await connectOneShot(
        resolved as unknown as Parameters<typeof connectOneShot>[0],
        PER_HOST_KILL_TIMEOUT_MS,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "SSH connection failed";
      sshLogger.error("[host-db] session-kill-ssh-failed", e, {
        operation: "session_kill_ssh_fail",
        hostId,
        userId,
      });
      return res.status(500).json({ error: message });
    }

    // 6. Run tmux kill-session in try/finally so conn.end() always fires
    try {
      // tmuxSession has already passed the allowlist — safe to interpolate here
      await execCommand(conn, `tmux kill-session -t ${tmuxSession}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (TMUX_SESSION_NOT_FOUND_RE.test(message)) {
        // Session already gone — treat as idempotent success
        sshLogger.info("[host-db] session-kill-already-gone", {
          operation: "session_kill",
          hostId,
          tmuxSession,
          userId,
        });
      } else {
        // Any other execCommand failure is a real error — surface as 500
        sshLogger.error("[host-db] session-kill-exec-failed", e, {
          operation: "session_kill_exec_fail",
          hostId,
          tmuxSession,
          userId,
        });
        return res.status(500).json({ error: message || "Failed to kill session" });
      }
    } finally {
      try { conn.end(); } catch { /* ignore */ }
    }

    // 7. Log successful kill
    sshLogger.info("[host-db] session-kill-ok", {
      operation: "session_kill",
      hostId,
      tmuxSession,
      userId,
    });

    // 8. Return 204 No Content
    return res.status(204).end();
  },
);

export default router;
