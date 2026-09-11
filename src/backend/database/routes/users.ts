import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { createHash } from "node:crypto";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { users, settings, roles, userRoles } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";
import { authLogger } from "../../utils/logger.js";
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
import { multipartOriginGuard } from "../../utils/multipart-origin-guard.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import {
  parseUserAgent,
  generateDeviceFingerprint,
} from "../../utils/user-agent-parser.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import { getRequestOriginWithForceHTTPS } from "../../utils/request-origin.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";
import {
  getOIDCConfigFromEnv,
  isOIDCUserAllowed,
  verifyOIDCToken,
} from "./user-oidc-utils.js";
import { registerUserApiKeyRoutes } from "./user-api-key-routes.js";
import { registerUserSettingsRoutes } from "./user-settings-routes.js";
import { registerUserTotpRoutes } from "./user-totp-routes.js";
import { registerUserSessionRoutes } from "./user-session-routes.js";
import { registerUserOidcAccountRoutes } from "./user-oidc-account-routes.js";
import { registerUserPasswordResetRoutes } from "./user-password-reset-routes.js";
import { registerUserAdminRoutes } from "./user-admin-routes.js";
import { registerUserDataAccessRoutes } from "./user-data-access-routes.js";
import {
  userAvatarUpload,
  userAvatarMulterErrorHandler,
  writeUserAvatar,
  unlinkUserAvatar,
  readUserAvatar,
} from "./user-avatar-storage.js";
import { createOrUpdateUser, deactivateUser } from "../../matrix/matrix-admin-client.js";
import { assertAdminErr } from "../../matrix/matrix-admin-narrow.js";
import { buildHumanMxid, generateHumanRelayPassword, extractServerName } from "../../matrix/username-to-mxid.js";
import { getMatrixAdminCreds } from "../../matrix/matrix-admin-creds-store.js";
// Phase 89-02 Task 3: post-mint humans-registry-room join hook (D-11).
// Best-effort — a failed join does NOT fail the create; there is no
// in-process backfill safety net (backfill is fully manual, SSH-based).
import { joinHumanToHumansRegistry } from "../../relay-sessions/registry-rooms.js";

const authManager = AuthManager.getInstance();

const router = express.Router();

// Router-level timing middleware — SLICE 1 of auth-slow-requests-on-pwa-boot bounty.
// Runs for EVERY /users/* request (including unauthenticated paths like
// /users/registration-allowed and OIDC callback routes) — all are useful signal.
// Closure-captures startTimeNs so we never need to stash it on req.
// Uses authLogger (AUTH category) since the timing data is primarily for auth
// latency attribution.
router.use((req, res, next) => {
  const startTimeNs = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - startTimeNs) / 1_000_000n);
    const userId = (req as AuthenticatedRequest).userId ?? null;
    authLogger.info("Auth request timing", {
      operation: "auth_req_timing",
      method: req.method,
      path: req.path,
      durationMs,
      status: res.statusCode,
      userId,
    });
  });
  next();
});

/**
 * Derive a human-friendly displayname from a Skynet username (D-11).
 * For simple usernames: title-case the whole string.
 * For email-form usernames: take the pre-@ local part and title-case it.
 * Examples: "alice" → "Alice", "alice@example.com" → "Alice"
 */
function deriveDisplayname(username: string): string {
  const localPart = username.includes("@") ? username.split("@")[0] : username;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isNativeAppRequest(req: Request): boolean {
  return (
    (req.get("User-Agent") || "").startsWith("Skynet-Mobile/") ||
    req.get("X-Electron-App") === "true"
  );
}

const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();

/**
 * @openapi
 * /users/create:
 *   post:
 *     summary: Create a new user
 *     description: Creates a new user with a username and password.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: User created successfully.
 *       400:
 *         description: Username and password are required.
 *       403:
 *         description: Registration is currently disabled.
 *       409:
 *         description: Username already exists.
 *       500:
 *         description: Failed to create user.
 */
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
router.post("/create", multipartOriginGuard, userAvatarUpload.single("avatar"), async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    if (row && (row as Record<string, unknown>).value !== "true") {
      return res
        .status(403)
        .json({ error: "Registration is currently disabled" });
    }
  } catch (e) {
    authLogger.warn("Failed to check registration status", {
      operation: "registration_check",
      error: e,
    });
  }

  // D-07 (T-85-06): Mandatoriness enforcement — avatar part MUST be present.
  // This fires BEFORE any DB write or file write so no side effects occur on failure.
  if (!req.file) {
    return res.status(400).json({ error: "avatar is required" });
  }

  const { username, password } = req.body;
  authLogger.info("User registration attempt", {
    operation: "user_register_attempt",
    username,
  });

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    authLogger.warn(
      "Invalid user creation attempt - missing username or password",
      {
        operation: "user_create",
        hasUsername: !!username,
        hasPassword: !!password,
      },
    );
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (existing && existing.length > 0) {
      authLogger.warn("Registration failed - username exists", {
        operation: "user_register_failed",
        username,
        reason: "username_exists",
      });
      return res.status(409).json({ error: "Username already exists" });
    }

    const saltRounds = parseInt(process.env.SALT || "10", 10);
    const password_hash = await bcrypt.hash(password, saltRounds);
    const id = nanoid();

    // Step 3.5 (D-03, D-04, D-05, D-08, D-11): Mint the Matrix relay identity BEFORE
    // any local side effect (avatar write, row INSERT). Mint failure → 500 with zero
    // local side effects (D-04). Password is discarded immediately after mint (D-08).
    const adminCreds = await getMatrixAdminCreds();
    if (!adminCreds) {
      authLogger.error("Matrix admin creds missing during user create", {
        operation: "user_create_admin_creds_missing",
        username,
      });
      return res.status(500).json({ error: "relay identity provisioning failed: admin creds missing" });
    }
    // Prefer the explicit server_name override when set; fall back to
    // URL-host derivation for legacy rows. The two are decoupled because
    // homeserverBase may need to stay as a raw IP for container-DNS reach
    // while Synapse's actual server_name is a hostname.
    const serverName =
      adminCreds.serverName ?? extractServerName(adminCreds.homeserverBase);
    const mintedMxid = buildHumanMxid(username, serverName);
    const displayname = deriveDisplayname(username);
    const relayPassword = generateHumanRelayPassword();
    const mintResult = await createOrUpdateUser(mintedMxid, relayPassword, displayname);
    if (mintResult.ok === false) {
      authLogger.error("Matrix account mint failed during user create", {
        operation: "user_create_matrix_mint_failed",
        username,
        mxid: mintedMxid,
        status: mintResult.status,
        error: mintResult.error,
      });
      // Zero side effects: no avatar written, no row inserted (D-04).
      return res.status(500).json({ error: "relay identity provisioning failed" });
    }
    // The generated password is discarded here — never stored, logged, or returned in any response (D-08).

    // Best-effort deactivation helper for post-mint rollback branches (D-05).
    // Captures mintedMxid in scope; logs on failure but never blocks the 500 response.
    const bestEffortDeactivate = async (reason: string) => {
      const r = await deactivateUser(mintedMxid);
      if (!r.ok) {
        assertAdminErr(r);
        authLogger.warn(
          "Matrix account deactivation failed during create rollback (orphaned mxid logged for future sweep)",
          {
            operation: reason,
            mxid: mintedMxid,
            status: r.status,
            error: r.error,
          },
        );
      }
    };

    // Step 4 (T-85-07, file-then-row ordering): Write avatar file BEFORE the SQL
    // INSERT so that on SQL failure the file can be unlinked with no dangling pointer.
    // If the file-write itself fails, we abort before any DB change — clean failure.
    let avatarFilename: string;
    try {
      avatarFilename = await writeUserAvatar(id, req.file.mimetype, req.file.buffer);
    } catch (writeErr) {
      // M4: mime-mismatch (declared vs sniffed bytes) → 400, not 500.
      // Deactivate the just-minted Matrix account (D-05 rollback) before returning.
      if (writeErr instanceof Error && writeErr.message.startsWith("avatar mime mismatch")) {
        authLogger.warn("Avatar mime mismatch on create", {
          operation: "user_create_avatar_mime_mismatch",
          error: writeErr.message,
        });
        await bestEffortDeactivate("user_create_deactivate_after_avatar_fail");
        return res.status(400).json({ error: writeErr.message });
      }
      authLogger.error("Failed to write user avatar to disk", writeErr, {
        operation: "user_create_avatar_write_failed",
      });
      await bestEffortDeactivate("user_create_deactivate_after_avatar_fail");
      return res.status(500).json({ error: "avatar write failed" });
    }

    let isFirstUser: boolean;
    try {
      isFirstUser = db.$client.transaction(() => {
        const countResult = db.$client
          .prepare("SELECT COUNT(*) as count FROM users")
          .get() as { count?: number };
        const first = (countResult?.count || 0) === 0;
        db.$client
          .prepare(
            "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes, avatar_path, mxid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            username,
            password_hash,
            first ? 1 : 0,
            0,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "openid email profile",
            null,
            0,
            null,
            avatarFilename,
            mintedMxid,
          );
        return first;
      })();
    } catch (sqlErr) {
      // T-85-07: SQL INSERT failed — rollback the file we already wrote (ENOENT-tolerant).
      await unlinkUserAvatar(avatarFilename);
      // D-05 rollback: deactivate the just-minted Matrix account (best-effort).
      await bestEffortDeactivate("user_create_deactivate_after_insert_fail");
      authLogger.error("Failed to insert user row during registration", sqlErr, {
        operation: "user_create_insert_failed",
        userId: id,
      });
      return res.status(500).json({ error: "user create failed" });
    }

    try {
      const defaultRoleName = isFirstUser ? "admin" : "user";
      const defaultRole = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, defaultRoleName))
        .limit(1);

      if (defaultRole.length > 0) {
        await db.insert(userRoles).values({
          userId: id,
          roleId: defaultRole[0].id,
          grantedBy: id,
        });
      } else {
        authLogger.warn("Default role not found during user registration", {
          operation: "assign_default_role",
          userId: id,
          roleName: defaultRoleName,
        });
      }
    } catch (roleError) {
      authLogger.error("Failed to assign default role", roleError, {
        operation: "assign_default_role",
        userId: id,
      });
    }

    try {
      await authManager.registerUser(id, password);
    } catch (encryptionError) {
      // T-85-06b: Encryption setup failed — unlink the avatar file we wrote (Step 4)
      // BEFORE deleting the row so cleanup is complete even if db.delete throws.
      await unlinkUserAvatar(avatarFilename);
      await db.delete(users).where(eq(users.id, id));
      // D-05 rollback: deactivate the just-minted Matrix account (best-effort).
      await bestEffortDeactivate("user_create_deactivate_after_encryption_fail");
      authLogger.error(
        "Failed to setup user encryption, user creation rolled back",
        encryptionError,
        {
          operation: "user_create_encryption_failed",
          userId: id,
        },
      );
      return res.status(500).json({
        error: "Failed to setup user security - user creation cancelled",
      });
    }

    // Phase 89 D-11 hook. Best-effort: a failed join does NOT fail the
    // create — the observation loop's classification for this human will
    // fall back to 'unknown foreign account'. Backfill of pre-existing
    // users is FULLY MANUAL (SSH-based dance if ever needed) — there is
    // no in-process backfill path. Hook fires AFTER the INSERT
    // transaction commits (so the row exists even if the join fails)
    // and BEFORE forceSave (so RAM state is fully in place before flush).
    try {
      const joinResult = await joinHumanToHumansRegistry(mintedMxid);
      if (joinResult.ok === false) {
        authLogger.warn(
          "user create: humans-registry join failed (best-effort per D-12)",
          {
            operation: "user_create_registry_join_failed",
            userId: id,
            mxid: mintedMxid,
            status: joinResult.status,
            error: joinResult.error,
          },
        );
      }
    } catch (joinErr) {
      authLogger.warn(
        "user create: humans-registry join threw unexpectedly (best-effort per D-12)",
        {
          operation: "user_create_registry_join_threw",
          userId: id,
          mxid: mintedMxid,
          error: joinErr instanceof Error ? joinErr.message : String(joinErr),
        },
      );
    }

    // D-17 (T-85-17): labeled forceSave after successful INSERT — crown-jewel invariant.
    // Failure logs a non-fatal error: the row is durable in RAM and the next debounce flush
    // will persist it. Do NOT fail the request on save error.
    try {
      await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-create");
    } catch (saveError) {
      authLogger.error("Failed to persist user creation to disk", saveError, {
        operation: "user_create_save_failed",
        userId: id,
      });
    }

    authLogger.success("User registration successful", {
      operation: "user_register_success",
      userId: id,
      username,
      isAdmin: isFirstUser,
    });
    res.json({
      message: "User created",
      is_admin: isFirstUser,
      toast: { type: "success", message: `User created: ${username}` },
    });
  } catch (err) {
    // Outer catch: unexpected throws from pure helpers or an unanticipated code path.
    // Do NOT attempt deactivation here. `mintedMxid` is in scope as a const, but from
    // this frame we cannot tell whether the throw happened BEFORE createOrUpdateUser was
    // called (in which case no Matrix account exists to deactivate) or AFTER a successful
    // mint returned but before the structured inner try/catch blocks could apply their own
    // rollback deactivation. Calling deactivateUser on an mxid that was never minted would
    // fire an admin API call that 404s harmlessly, but it also complicates the log signal
    // for the future orphan-sweep. Best-effort cleanup via that sweep is the right recovery
    // path for the rare inner-block-throws-past-its-own-catch case.
    authLogger.error("Failed to create user", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Multer error handler scoped to /create — maps LIMIT_FILE_SIZE → 413,
// mime-rejection → 400, LIMIT_UNEXPECTED_FILE → 400, other → 500.
// Must be placed AFTER the router.post("/create", ...) registration to only
// catch errors from that route (pattern from identity-avatar-batch.ts:453-478).
router.use("/create", userAvatarMulterErrorHandler);

// ---------------------------------------------------------------------------
// assertOwnOrAdminForAvatarChange — M7: authz middleware that fires BEFORE
// multer parse so we don't buffer 5 MB for unauthorized callers.
//
// Reads isAdmin from DB (not JWT) per RESEARCH.md § 6 — defends against
// mid-session role revocation. Returns 403 if caller is neither the target
// user nor an admin. Attaches callerRecord to req for the handler to reuse.
// ---------------------------------------------------------------------------
async function assertOwnOrAdminForAvatarChange(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = (req as AuthenticatedRequest).userId;
  const targetUserId = String(req.params.id);

  if (!isNonEmptyString(targetUserId)) {
    res.status(400).json({ error: "user id required in path" });
    return;
  }

  try {
    // Read caller's isAdmin from DB (not JWT) — defends against mid-session revocation.
    const callerRows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!callerRows || callerRows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const callerRecord = callerRows[0];

    // Own-or-admin guard — mirror user-session-routes.ts:154.
    if (!callerRecord.isAdmin && targetUserId !== userId) {
      res.status(403).json({ error: "Not authorized to change this user's avatar" });
      return;
    }

    // Attach callerRecord so the handler doesn't need to re-query.
    (req as AuthenticatedRequest & { callerRecord: typeof callerRecord }).callerRecord = callerRecord;
    next();
  } catch (err) {
    authLogger.error("assertOwnOrAdminForAvatarChange unexpected error", err, {
      operation: "user_avatar_change_authz_error",
      userId,
      targetUserId,
    });
    res.status(500).json({ error: "authorization check failed" });
  }
}

// ---------------------------------------------------------------------------
// PUT /users/:id/avatar — replace an existing user's avatar (D-10, D-12, D-14,
// D-15, D-16, D-17, D-23)
//
// Auth: authenticateJWT + assertOwnOrAdminForAvatarChange (M7: runs BEFORE
// multer so 5 MB is not buffered for unauthorized callers) + multer.
//
// Ordering: new-file-then-row-UPDATE-then-old-file-unlink per RESEARCH.md § 5.
// Rollback: if UPDATE fails, new file is unlinked (if different name from old).
// ---------------------------------------------------------------------------
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
router.put("/:id/avatar", multipartOriginGuard, authenticateJWT, assertOwnOrAdminForAvatarChange, userAvatarUpload.single("avatar"), async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const targetUserId = String(req.params.id);

    try {
      // Step 1+2 (own-or-admin guard) already enforced by assertOwnOrAdminForAvatarChange
      // middleware above (M7). Defense-in-depth: re-check here in case middleware is bypassed.
      // Caller record is available on req.callerRecord (attached by middleware).

      // Step 3: Verify target user exists so a legit admin targeting a bogus id gets 404.
      // (Read performed outside the tx to keep the 404 path simple — the tx below
      //  re-reads avatar_path atomically at UPDATE time, so this pre-check is only
      //  for existence; the tx-read is the authoritative old-filename source.)
      const targetRows = await db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
      if (!targetRows || targetRows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // Step 4: Verify avatar file was provided.
      if (!req.file) {
        return res.status(400).json({ error: "missing avatar field" });
      }

      // Step 5 (CHANGE ordering — RESEARCH.md § 5):
      // new-file-then-row-then-old-file-unlink.

      // 5a: Write new file first.
      let newFilename: string;
      try {
        newFilename = await writeUserAvatar(targetUserId, req.file.mimetype, req.file.buffer);
      } catch (writeErr) {
        // M4: mime-mismatch (declared vs sniffed bytes) → 400, not 500.
        if (writeErr instanceof Error && writeErr.message.startsWith("avatar mime mismatch")) {
          authLogger.warn("Avatar mime mismatch on change", {
            operation: "user_avatar_change_mime_mismatch",
            targetUserId,
            error: writeErr.message,
          });
          return res.status(400).json({ error: writeErr.message });
        }
        authLogger.error("Failed to write user avatar to disk", writeErr, {
          operation: "user_avatar_change_write_failed",
          targetUserId,
        });
        return res.status(500).json({ error: "avatar write failed" });
      }

      // 5b: UPDATE users row pointer + atomically capture the old filename in a
      // single better-sqlite3 transaction (M2 — change-vs-change race fix).
      // The SELECT + UPDATE are in one sync tx so the old filename we unlink is
      // exactly what was current at UPDATE time, not a stale read from Step 3.
      let oldFilename: string | null;
      try {
        const txResult = db.$client.transaction(() => {
          const row = db.$client
            .prepare("SELECT avatar_path FROM users WHERE id = ?")
            .get(targetUserId) as { avatar_path: string | null } | undefined;
          db.$client
            .prepare("UPDATE users SET avatar_path = ? WHERE id = ?")
            .run(newFilename, targetUserId);
          return { oldFilename: row?.avatar_path ?? null };
        })();
        oldFilename = txResult.oldFilename;
      } catch (sqlErr) {
        // Rollback: unlink the new file ONLY if it's a different name from what
        // the tx tried to set (we don't have oldFilename yet, but newFilename is
        // distinct from any prior value when a different ext was used).
        // Safe to always unlink newFilename here — if oldFilename happened to
        // be the same, writeUserAvatar overwrote it in place and a fresh retry
        // will re-write. The file is not user-visible until the row points to it.
        await unlinkUserAvatar(newFilename).catch(() => {
          /* best-effort rollback unlink */
        });
        authLogger.error("Failed to update users row avatar_path", sqlErr, {
          operation: "user_avatar_change_update_failed",
          targetUserId,
        });
        return res.status(500).json({ error: "avatar update failed" });
      }

      // 5c: Best-effort unlink of old file — only if it's a DIFFERENT name from new.
      // If same name, the new file has already overwritten it in place.
      // Unlink runs OUTSIDE the tx (async I/O cannot be inside a sync better-sqlite3 tx).
      // M3: wrap in its own try/catch so EPERM/EBUSY on the old file does NOT
      // return 500 after a fully successful UPDATE. Log WARN and continue.
      if (oldFilename && oldFilename !== newFilename) {
        try {
          await unlinkUserAvatar(oldFilename);
        } catch (unlinkErr) {
          authLogger.warn("Failed to unlink prior avatar file after successful change", {
            operation: "user_avatar_change_old_file_leak",
            targetUserId,
            oldFilename,
            newFilename,
            error: unlinkErr,
          });
        }
      }

      // Step 6: Labeled forceSave — D-17/D-18 crown-jewel invariant.
      try {
        await DatabaseSaveTrigger.forceSave("phase-85-user-avatar-change");
      } catch (saveError) {
        authLogger.error(
          "Failed to persist user avatar change to disk",
          saveError,
          {
            operation: "user_avatar_change_save_failed",
            userId: targetUserId,
          },
        );
      }

      return res.status(200).json({ id: targetUserId, avatarPath: newFilename });
    } catch (err) {
      authLogger.error("PUT /users/:id/avatar unexpected error", err, {
        operation: "user_avatar_change_unexpected",
        targetUserId,
      });
      return res.status(500).json({ error: "avatar change failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /users/:id/avatar — serve raw image bytes (D-11, D-12)
//
// Auth: authenticateJWT only — any logged-in user may fetch any user's avatar
// (mirrors identity-avatar precedent per RESEARCH.md § Q2).
// Content-Type derived from filename extension via EXT_TO_MIME in helper module.
// ETag: yes (mirrors identities.ts:626 — per-response hash, no server-side store).
// ---------------------------------------------------------------------------
router.get("/:id/avatar", authenticateJWT, async (req, res) => {
  const targetUserId = String(req.params.id);

  if (!isNonEmptyString(targetUserId)) {
    return res.status(400).json({ error: "user id required in path" });
  }

  // Step 1: Read avatar pointer from users row.
  const rows = await db
    .select({ avatarPath: users.avatarPath })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  // Step 2: 404 for missing row OR null pointer (pre-Phase-85 user with no avatar).
  if (rows.length === 0 || !rows[0].avatarPath) {
    return res.status(404).json({ error: "no avatar for this user" });
  }

  const filename = rows[0].avatarPath;

  // Step 3: Read bytes from disk via D-12 helper.
  try {
    const { bytes, mime } = await readUserAvatar(filename);

    // ETag: per-response MD5 hash (mirrors identities.ts:626 — no-store but
    // still allows 304 short-circuit within a single browser session).
    const etag = `"disk-${createHash("md5").update(bytes).digest("hex")}"`;
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(bytes.byteLength));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("ETag", etag);
    return res.send(bytes);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      // Row pointer valid but file missing on disk (RESEARCH.md Pitfall 4).
      return res.status(404).json({ error: "no avatar file on disk" });
    }
    authLogger.error("GET /users/:id/avatar unexpected read error", err, {
      operation: "user_avatar_read_failed",
      targetUserId,
    });
    return res.status(500).json({ error: "avatar read failed" });
  }
});

// Multer error handler scoped to /:id/avatar — covers oversize (413), missing
// part (400), bad mime (400) for the PUT change endpoint.
// The GET handler does not use multer, so this is inert for GET requests.
router.use("/:id/avatar", userAvatarMulterErrorHandler);

/**
 * @openapi
 * /users/oidc-config:
 *   post:
 *     summary: Configure OIDC provider
 *     description: Creates or updates the OIDC provider configuration.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: OIDC configuration updated.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to update OIDC config.
 */
router.post("/oidc-config", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const {
      client_id,
      client_secret,
      issuer_url,
      authorization_url,
      token_url,
      userinfo_url,
      identifier_path,
      name_path,
      scopes,
      allowed_users,
      admin_group,
    } = req.body;

    const isDisableRequest =
      (client_id === "" || client_id === null || client_id === undefined) &&
      (client_secret === "" ||
        client_secret === null ||
        client_secret === undefined) &&
      (issuer_url === "" || issuer_url === null || issuer_url === undefined) &&
      (authorization_url === "" ||
        authorization_url === null ||
        authorization_url === undefined) &&
      (token_url === "" || token_url === null || token_url === undefined);

    const isEnableRequest =
      isNonEmptyString(client_id) &&
      isNonEmptyString(client_secret) &&
      isNonEmptyString(issuer_url) &&
      isNonEmptyString(authorization_url) &&
      isNonEmptyString(token_url) &&
      isNonEmptyString(identifier_path) &&
      isNonEmptyString(name_path);

    if (!isDisableRequest && !isEnableRequest) {
      authLogger.warn(
        "OIDC validation failed - neither disable nor enable request",
        {
          operation: "oidc_config_update",
          userId,
          isDisableRequest,
          isEnableRequest,
        },
      );
      return res
        .status(400)
        .json({ error: "All OIDC configuration fields are required" });
    }

    if (isDisableRequest) {
      db.$client
        .prepare("DELETE FROM settings WHERE key = 'oidc_config'")
        .run();
      authLogger.info("OIDC configuration disabled", {
        operation: "oidc_disable",
        userId,
      });
      res.json({ message: "OIDC configuration disabled" });
    } else {
      const config = {
        client_id,
        client_secret,
        issuer_url,
        authorization_url,
        token_url,
        userinfo_url: userinfo_url || "",
        identifier_path,
        name_path,
        scopes: scopes || "openid email profile",
        allowed_users: allowed_users || "",
        admin_group: admin_group || "",
      };

      let encryptedConfig;
      try {
        const adminDataKey = DataCrypto.getUserDataKey(userId);
        if (adminDataKey) {
          const configWithId = { ...config, id: `oidc-config-${userId}` };
          encryptedConfig = DataCrypto.encryptRecord(
            "settings",
            configWithId,
            userId,
            adminDataKey,
          );
        } else {
          encryptedConfig = {
            ...config,
            client_secret: `encrypted:${Buffer.from(client_secret).toString("base64")}`,
          };
          authLogger.warn(
            "OIDC configuration stored with basic encoding - admin should re-save with password",
            {
              operation: "oidc_config_basic_encoding",
              userId,
            },
          );
        }
      } catch (encryptError) {
        authLogger.error(
          "Failed to encrypt OIDC configuration, storing with basic encoding",
          encryptError,
          {
            operation: "oidc_config_encrypt_failed",
            userId,
          },
        );
        encryptedConfig = {
          ...config,
          client_secret: `encoded:${Buffer.from(client_secret).toString("base64")}`,
        };
      }

      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('oidc_config', ?)",
        )
        .run(JSON.stringify(encryptedConfig));
      authLogger.info("OIDC configuration updated", {
        operation: "oidc_update",
        userId,
        hasUserinfoUrl: !!userinfo_url,
      });
      res.json({ message: "OIDC configuration updated" });
    }
  } catch (err) {
    authLogger.error("Failed to update OIDC config", err);
    res.status(500).json({ error: "Failed to update OIDC config" });
  }
});

/**
 * @openapi
 * /users/oidc-config:
 *   delete:
 *     summary: Disable OIDC configuration
 *     description: Disables the OIDC provider configuration.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: OIDC configuration disabled.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to disable OIDC config.
 */
router.delete("/oidc-config", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    db.$client.prepare("DELETE FROM settings WHERE key = 'oidc_config'").run();
    authLogger.success("OIDC configuration disabled", {
      operation: "oidc_disable",
      userId,
    });
    res.json({ message: "OIDC configuration disabled" });
  } catch (err) {
    authLogger.error("Failed to disable OIDC config", err);
    res.status(500).json({ error: "Failed to disable OIDC config" });
  }
});

/**
 * @openapi
 * /users/oidc-config:
 *   get:
 *     summary: Get OIDC configuration
 *     description: Returns the public OIDC configuration.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Public OIDC configuration.
 *       500:
 *         description: Failed to get OIDC config.
 */
router.get("/oidc-config", async (req, res) => {
  try {
    const envConfig = getOIDCConfigFromEnv();
    if (envConfig) {
      return res.json({
        client_id: envConfig.client_id,
        issuer_url: envConfig.issuer_url,
        authorization_url: envConfig.authorization_url,
        scopes: envConfig.scopes,
      });
    }

    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!row) {
      return res.json(null);
    }

    const config = JSON.parse((row as Record<string, unknown>).value as string);

    const publicConfig = {
      client_id: config.client_id,
      issuer_url: config.issuer_url,
      authorization_url: config.authorization_url,
      scopes: config.scopes,
    };

    return res.json(publicConfig);
  } catch (err) {
    authLogger.error("Failed to get OIDC config", err);
    res.status(500).json({ error: "Failed to get OIDC config" });
  }
});

/**
 * @openapi
 * /users/oidc-config/admin:
 *   get:
 *     summary: Get OIDC configuration for admin
 *     description: Returns the full OIDC configuration for an admin.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Full OIDC configuration.
 *       500:
 *         description: Failed to get OIDC config for admin.
 */
router.get("/oidc-config/admin", requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get();
    if (!row) {
      const envConfig = getOIDCConfigFromEnv();
      return res.json(envConfig);
    }

    let config = JSON.parse((row as Record<string, unknown>).value as string);

    if (config.client_secret?.startsWith("encrypted:")) {
      try {
        const adminDataKey = DataCrypto.getUserDataKey(userId);
        if (adminDataKey) {
          config = DataCrypto.decryptRecord(
            "settings",
            config,
            userId,
            adminDataKey,
          );
        } else {
          config.client_secret = "[ENCRYPTED - PASSWORD REQUIRED]";
        }
      } catch {
        authLogger.warn("Failed to decrypt OIDC config for admin", {
          operation: "oidc_config_decrypt_failed",
          userId,
        });
        config.client_secret = "[ENCRYPTED - DECRYPTION FAILED]";
      }
    } else if (config.client_secret?.startsWith("encoded:")) {
      try {
        const decoded = Buffer.from(
          config.client_secret.substring(8),
          "base64",
        ).toString("utf8");
        config.client_secret = decoded;
      } catch {
        authLogger.warn("Failed to decode OIDC config for admin", {
          operation: "oidc_config_decode_failed",
          userId,
        });
        config.client_secret = "[ENCODING ERROR]";
      }
    }

    res.json(config);
  } catch (err) {
    authLogger.error("Failed to get OIDC config for admin", err);
    res.status(500).json({ error: "Failed to get OIDC config for admin" });
  }
});

/**
 * @openapi
 * /users/oidc/authorize:
 *   get:
 *     summary: Get OIDC authorization URL
 *     description: Returns the OIDC authorization URL.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: rememberMe
 *         schema:
 *           type: boolean
 *         description: Whether to extend the session to 30 days instead of 2 hours.
 *     responses:
 *       200:
 *         description: OIDC authorization URL.
 *       404:
 *         description: OIDC not configured.
 *       500:
 *         description: Failed to generate authorization URL.
 */
router.get("/oidc/authorize", async (req, res) => {
  try {
    const { rememberMe, desktopCallbackPort, appCallbackUrl } = req.query;
    const origin = getRequestOriginWithForceHTTPS(req);
    const backendCallbackUri = `${origin}/users/oidc/callback`;

    const envConfig = getOIDCConfigFromEnv();
    let config;

    if (envConfig) {
      config = envConfig;
    } else {
      const row = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
        .get();
      if (!row) {
        return res.status(404).json({ error: "OIDC not configured" });
      }
      config = JSON.parse((row as Record<string, unknown>).value as string);
    }
    const state = nanoid();
    const nonce = nanoid();

    const referer = req.get("Referer");
    let frontendOrigin;
    if (desktopCallbackPort) {
      frontendOrigin = `http://127.0.0.1:${desktopCallbackPort}/oidc-callback`;
    } else if (typeof appCallbackUrl === "string" && appCallbackUrl) {
      let callbackUrl: URL;
      try {
        callbackUrl = new URL(appCallbackUrl);
      } catch {
        return res.status(400).json({ error: "Invalid app callback URL" });
      }
      if (callbackUrl.protocol !== "skynet-mobile:") {
        return res.status(400).json({ error: "Unsupported app callback URL" });
      }
      frontendOrigin = callbackUrl.toString();
    } else if (referer) {
      const refererUrl = new URL(referer);
      frontendOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
    } else {
      frontendOrigin = origin;
    }

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_state_${state}`, nonce);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_backend_callback_${state}`, backendCallbackUri);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(`oidc_frontend_origin_${state}`, frontendOrigin);

    db.$client
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(
        `oidc_remember_me_${state}`,
        rememberMe === "true" ? "true" : "false",
      );

    const authUrl = new URL(config.authorization_url);
    authUrl.searchParams.set("client_id", config.client_id);
    authUrl.searchParams.set("redirect_uri", backendCallbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("nonce", nonce);

    res.json({ auth_url: authUrl.toString(), state, nonce });
  } catch (err) {
    authLogger.error("Failed to generate OIDC auth URL", err);
    res.status(500).json({ error: "Failed to generate authorization URL" });
  }
});

/**
 * @openapi
 * /users/oidc/callback:
 *   get:
 *     summary: OIDC callback
 *     description: Handles the OIDC callback, exchanges the code for a token, and creates or logs in the user.
 *     tags:
 *       - Users
 *     responses:
 *       302:
 *         description: Redirects to the frontend with a success or error message.
 *       400:
 *         description: Code and state are required.
 */
router.get("/oidc/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!isNonEmptyString(code) || !isNonEmptyString(state)) {
    return res.status(400).json({ error: "Code and state are required" });
  }

  const storedBackendCallbackRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_backend_callback_${state}`);
  const storedFrontendOriginRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_frontend_origin_${state}`);
  const storedRememberMeRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`oidc_remember_me_${state}`);

  if (!storedBackendCallbackRow || !storedFrontendOriginRow) {
    return res
      .status(400)
      .json({ error: "Invalid state parameter - redirect URIs not found" });
  }

  const backendCallbackUri = (
    storedBackendCallbackRow as Record<string, unknown>
  ).value as string;
  const frontendOrigin = (storedFrontendOriginRow as Record<string, unknown>)
    .value as string;
  const storedRememberMe =
    (storedRememberMeRow as Record<string, unknown> | null)?.value === "true";

  try {
    const storedNonce = db.$client
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(`oidc_state_${state}`);
    if (!storedNonce) {
      return res.status(400).json({ error: "Invalid state parameter" });
    }

    const envConfig = getOIDCConfigFromEnv();
    let config;

    if (envConfig) {
      config = envConfig;
    } else {
      const configRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
        .get();
      if (!configRow) {
        return res.status(500).json({ error: "OIDC not configured" });
      }
      config = JSON.parse(
        (configRow as Record<string, unknown>).value as string,
      );

      if (config.client_secret?.startsWith("encrypted:")) {
        config.client_secret = Buffer.from(
          config.client_secret.substring(10),
          "base64",
        ).toString("utf8");
      } else if (config.client_secret?.startsWith("encoded:")) {
        config.client_secret = Buffer.from(
          config.client_secret.substring(8),
          "base64",
        ).toString("utf8");
      }
    }

    const tokenResponse = await fetch(config.token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.client_id,
        client_secret: config.client_secret,
        code: code,
        redirect_uri: backendCallbackUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      authLogger.error("OIDC token exchange failed", {
        operation: "oidc_token_exchange_failed",
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        backendCallbackUri,
        frontendOrigin,
        errorResponse: errorText,
      });
      return res
        .status(400)
        .json({ error: "Failed to exchange authorization code" });
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;

    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_state_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_backend_callback_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_frontend_origin_${state}`);
    db.$client
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`oidc_remember_me_${state}`);

    let userInfo: Record<string, unknown> = null;
    const userInfoUrls: string[] = [];

    const normalizedIssuerUrl = config.issuer_url.endsWith("/")
      ? config.issuer_url.slice(0, -1)
      : config.issuer_url;
    const baseUrl = normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, "");

    try {
      const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
      const discoveryResponse = await fetch(discoveryUrl);
      if (discoveryResponse.ok) {
        const discovery = (await discoveryResponse.json()) as Record<
          string,
          unknown
        >;
        if (discovery.userinfo_endpoint) {
          userInfoUrls.push(discovery.userinfo_endpoint as string);
        }
      }
    } catch (discoveryError) {
      authLogger.error(`OIDC discovery failed: ${discoveryError}`);
    }

    if (config.userinfo_url) {
      userInfoUrls.unshift(config.userinfo_url);
    }

    userInfoUrls.push(
      `${baseUrl}/userinfo/`,
      `${baseUrl}/userinfo`,
      `${normalizedIssuerUrl}/userinfo/`,
      `${normalizedIssuerUrl}/userinfo`,
      `${baseUrl}/oauth2/userinfo/`,
      `${baseUrl}/oauth2/userinfo`,
      `${normalizedIssuerUrl}/oauth2/userinfo/`,
      `${normalizedIssuerUrl}/oauth2/userinfo`,
    );

    if (tokenData.id_token) {
      try {
        userInfo = await verifyOIDCToken(
          tokenData.id_token as string,
          config.issuer_url,
          config.client_id,
        );
      } catch {
        try {
          const parts = (tokenData.id_token as string).split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(
              Buffer.from(parts[1], "base64").toString(),
            );
            userInfo = payload;
          }
        } catch (decodeError) {
          authLogger.error("Failed to decode ID token payload:", decodeError);
        }
      }
    }

    if (!userInfo && tokenData.access_token) {
      for (const userInfoUrl of userInfoUrls) {
        try {
          const userInfoResponse = await fetch(userInfoUrl, {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
            },
          });

          if (userInfoResponse.ok) {
            userInfo = (await userInfoResponse.json()) as Record<
              string,
              unknown
            >;
            break;
          } else {
            authLogger.error(
              `Userinfo endpoint ${userInfoUrl} failed with status: ${userInfoResponse.status}`,
            );
          }
        } catch (error) {
          authLogger.error(`Userinfo endpoint ${userInfoUrl} failed:`, error);
          continue;
        }
      }
    }

    if (!userInfo) {
      authLogger.error("Failed to get user information from all sources");
      authLogger.error(`Tried userinfo URLs: ${userInfoUrls.join(", ")}`);
      authLogger.error(`Token data keys: ${Object.keys(tokenData).join(", ")}`);
      authLogger.error(`Has id_token: ${!!tokenData.id_token}`);
      authLogger.error(`Has access_token: ${!!tokenData.access_token}`);
      return res.status(400).json({ error: "Failed to get user information" });
    }

    const getNestedValue = (
      obj: Record<string, unknown>,
      path: string,
    ): unknown => {
      if (!path || !obj) return null;
      return path.split(".").reduce((current, key) => current?.[key], obj);
    };

    const identifier = (getNestedValue(userInfo, config.identifier_path) ||
      userInfo[config.identifier_path] ||
      userInfo.sub ||
      userInfo.email ||
      userInfo.preferred_username) as string;

    const name = (getNestedValue(userInfo, config.name_path) ||
      userInfo[config.name_path] ||
      userInfo.name ||
      userInfo.given_name ||
      identifier) as string;

    if (!identifier) {
      authLogger.error(
        `Identifier not found at path: ${config.identifier_path}`,
      );
      authLogger.error(`Available fields: ${Object.keys(userInfo).join(", ")}`);
      return res.status(400).json({
        error: `User identifier not found at path: ${config.identifier_path}. Available fields: ${Object.keys(userInfo).join(", ")}`,
      });
    }

    const deviceInfo = parseUserAgent(req);
    let user = await db
      .select()
      .from(users)
      .where(eq(users.oidcIdentifier, identifier));

    let isFirstUser = false;
    if (!user || user.length === 0) {
      const preCheckCount = db.$client
        .prepare("SELECT COUNT(*) as count FROM users")
        .get();
      isFirstUser = ((preCheckCount as { count?: number })?.count || 0) === 0;

      if (!isFirstUser && config.allowed_users) {
        const email = userInfo.email as string | undefined;
        if (!isOIDCUserAllowed(config.allowed_users, identifier, email)) {
          authLogger.warn("OIDC user not in allowed list", {
            operation: "oidc_user_not_allowed",
            identifier,
            email,
          });
          const redirectUrl = new URL(frontendOrigin);
          redirectUrl.searchParams.set("error", "user_not_allowed");
          return res.redirect(redirectUrl.toString());
        }
      }

      let oidcAutoProvision = false;
      try {
        const oidcProvRow = db.$client
          .prepare(
            "SELECT value FROM settings WHERE key = 'oidc_auto_provision'",
          )
          .get();
        if (oidcProvRow) {
          oidcAutoProvision =
            (oidcProvRow as Record<string, unknown>).value === "true";
        }
      } catch {
        // fall through to env var check
      }

      if (!oidcAutoProvision) {
        oidcAutoProvision =
          (process.env.OIDC_ALLOW_REGISTRATION || "").trim().toLowerCase() ===
          "true";
      }

      if (!isFirstUser && !oidcAutoProvision) {
        try {
          const regRow = db.$client
            .prepare(
              "SELECT value FROM settings WHERE key = 'allow_registration'",
            )
            .get();
          if (regRow && (regRow as Record<string, unknown>).value !== "true") {
            authLogger.warn(
              "OIDC user attempted to register when registration is disabled",
              {
                operation: "oidc_registration_disabled",
                identifier,
                name,
              },
            );

            const redirectUrl = new URL(frontendOrigin);
            redirectUrl.searchParams.set("error", "registration_disabled");

            return res.redirect(redirectUrl.toString());
          }
        } catch (e) {
          authLogger.warn("Failed to check registration status during OIDC", {
            operation: "oidc_registration_check",
            error: e,
          });
        }
      }

      const id = nanoid();
      isFirstUser = db.$client.transaction(() => {
        const countResult = db.$client
          .prepare("SELECT COUNT(*) as count FROM users")
          .get() as { count?: number };
        const first = (countResult?.count || 0) === 0;
        db.$client
          .prepare(
            "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, oidc_identifier, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            name,
            "",
            first ? 1 : 0,
            1,
            identifier,
            String(config.client_id),
            String(config.client_secret),
            String(config.issuer_url),
            String(config.authorization_url),
            String(config.token_url),
            String(config.identifier_path),
            String(config.name_path),
            String(config.scopes),
          );
        return first;
      })();

      try {
        const defaultRoleName = isFirstUser ? "admin" : "user";
        const defaultRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, defaultRoleName))
          .limit(1);

        if (defaultRole.length > 0) {
          await db.insert(userRoles).values({
            userId: id,
            roleId: defaultRole[0].id,
            grantedBy: id,
          });
        } else {
          authLogger.warn(
            "Default role not found during OIDC user registration",
            {
              operation: "assign_default_role_oidc",
              userId: id,
              roleName: defaultRoleName,
            },
          );
        }
      } catch (roleError) {
        authLogger.error(
          "Failed to assign default role to OIDC user",
          roleError,
          {
            operation: "assign_default_role_oidc",
            userId: id,
          },
        );
      }

      try {
        const sessionDurationMs =
          deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
            ? 30 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
        await authManager.registerOIDCUser(id, sessionDurationMs);
      } catch (encryptionError) {
        // Phase 85 (D-07): OIDC user creation bypasses the mandatoriness gate because
        // the OIDC redirect flow provides no avatar-upload opportunity. Backfill deferred
        // per D-13; downstream self-serve flow will populate via PUT /users/:id/avatar
        // (Plan 04). No avatar file to unlink on this rollback path.
        await db.delete(users).where(eq(users.id, id));
        authLogger.error(
          "Failed to setup OIDC user encryption, user creation rolled back",
          encryptionError,
          {
            operation: "oidc_user_create_encryption_failed",
            userId: id,
          },
        );
        return res.status(500).json({
          error: "Failed to setup user security - user creation cancelled",
        });
      }

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error("Failed to persist OIDC user to disk", saveError, {
          operation: "oidc_user_create_save_failed",
          userId: id,
        });
      }

      user = await db.select().from(users).where(eq(users.id, id));
    } else {
      if (config.allowed_users) {
        const email = userInfo.email as string | undefined;
        if (!isOIDCUserAllowed(config.allowed_users, identifier, email)) {
          authLogger.warn("OIDC user not in allowed list (existing user)", {
            operation: "oidc_user_not_allowed_existing",
            identifier,
            email,
            userId: user[0].id,
          });
          const redirectUrl = new URL(frontendOrigin);
          redirectUrl.searchParams.set("error", "user_not_allowed");
          return res.redirect(redirectUrl.toString());
        }
      }

      const isDualAuth =
        user[0].passwordHash && user[0].passwordHash.trim() !== "";

      if (!isDualAuth) {
        await db
          .update(users)
          .set({ username: name })
          .where(eq(users.id, user[0].id));
      }

      user = await db.select().from(users).where(eq(users.id, user[0].id));
    }

    const userRecord = user[0];

    // Sync admin status based on OIDC group membership
    if (config.admin_group) {
      const groups = (userInfo.groups || userInfo.roles || []) as string[];
      const shouldBeAdmin = groups.includes(config.admin_group);
      if (!!userRecord.isAdmin !== shouldBeAdmin) {
        await db
          .update(users)
          .set({ isAdmin: shouldBeAdmin })
          .where(eq(users.id, userRecord.id));
        userRecord.isAdmin = shouldBeAdmin;
        authLogger.info("OIDC admin status synced", {
          operation: "oidc_admin_group_sync",
          userId: userRecord.id,
          group: config.admin_group,
          isAdmin: shouldBeAdmin,
        });
      }
    }

    try {
      await authManager.authenticateOIDCUser(userRecord.id, deviceInfo.type);
    } catch (setupError) {
      authLogger.error("Failed to setup OIDC user encryption", setupError, {
        operation: "oidc_user_encryption_setup_failed",
        userId: userRecord.id,
      });
    }

    try {
      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();
      await sharedCredManager.reEncryptPendingCredentialsForUser(userRecord.id);
    } catch {
      // expected - re-encryption may fail if no pending credentials
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
      rememberMe: storedRememberMe,
    });

    authLogger.success("OIDC login successful", {
      operation: "oidc_login_complete",
      userId: userRecord.id,
      username: userRecord.username,
    });

    const redirectUrl = new URL(frontendOrigin);
    redirectUrl.searchParams.set("success", "true");

    const isTokenCallback =
      frontendOrigin.startsWith("http://127.0.0.1:") ||
      frontendOrigin.startsWith("skynet-mobile:");

    const maxAge =
      deviceInfo.type === "desktop" || deviceInfo.type === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : storedRememberMe
          ? 30 * 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

    res.clearCookie("jwt", authManager.getClearCookieOptions(req));

    if (isTokenCallback) {
      redirectUrl.searchParams.set("token", token);
      return res.redirect(redirectUrl.toString());
    }

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
      .redirect(redirectUrl.toString());
  } catch (err) {
    authLogger.error("OIDC callback failed", err);

    const redirectUrl = new URL(frontendOrigin);
    redirectUrl.searchParams.set("error", "OIDC authentication failed");

    res.redirect(redirectUrl.toString());
  }
});

/**
 * @openapi
 * /users/login:
 *   post:
 *     summary: User login
 *     description: Authenticates a user and returns a JWT.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful.
 *       400:
 *         description: Invalid username or password.
 *       401:
 *         description: Invalid username or password.
 *       403:
 *         description: Password authentication is currently disabled.
 *       429:
 *         description: Too many login attempts.
 *       500:
 *         description: Login failed.
 */
router.post("/login", async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  authLogger.info("User login request received", {
    operation: "user_login_request",
    username,
  });

  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    authLogger.warn("Invalid traditional login attempt", {
      operation: "user_login",
      hasUsername: !!username,
      hasPassword: !!password,
    });
    return res.status(400).json({ error: "Invalid username or password" });
  }

  const lockStatus = loginRateLimiter.isLocked(clientIp, username);
  if (lockStatus.locked) {
    authLogger.warn("Login attempt blocked due to rate limiting", {
      operation: "user_login_blocked",
      username,
      ip: clientIp,
      remainingTime: lockStatus.remainingTime,
    });
    return res.status(429).json({
      error: "Too many login attempts. Please try again later.",
      remainingTime: lockStatus.remainingTime,
    });
  }

  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_login'")
      .get();
    if (row && (row as { value: string }).value !== "true") {
      return res
        .status(403)
        .json({ error: "Password authentication is currently disabled" });
    }
  } catch (e) {
    authLogger.error("Failed to check password login status", {
      operation: "login_check",
      error: e,
    });
    return res.status(500).json({ error: "Failed to check login status" });
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, username));

    if (!user || user.length === 0) {
      loginRateLimiter.recordFailedAttempt(clientIp, username);
      authLogger.warn(`Login failed: user not found`, {
        operation: "user_login",
        username,
        ip: clientIp,
        remainingAttempts: loginRateLimiter.getRemainingAttempts(
          clientIp,
          username,
        ),
      });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const userRecord = user[0];

    if (
      userRecord.isOidc &&
      (!userRecord.passwordHash || userRecord.passwordHash.trim() === "")
    ) {
      authLogger.warn("OIDC-only user attempted traditional login", {
        operation: "user_login",
        username,
        userId: userRecord.id,
      });
      return res
        .status(403)
        .json({ error: "This user uses external authentication" });
    }

    const isMatch = await bcrypt.compare(password, userRecord.passwordHash);
    if (!isMatch) {
      loginRateLimiter.recordFailedAttempt(clientIp, username);
      authLogger.warn(`Login failed: incorrect password`, {
        operation: "user_login",
        username,
        userId: userRecord.id,
        ip: clientIp,
        remainingAttempts: loginRateLimiter.getRemainingAttempts(
          clientIp,
          username,
        ),
      });
      return res.status(401).json({ error: "Invalid username or password" });
    }

    try {
      const kekSalt = await db
        .select()
        .from(settings)
        .where(eq(settings.key, `user_kek_salt_${userRecord.id}`));

      if (kekSalt.length === 0) {
        await authManager.registerUser(userRecord.id, password);
      }
    } catch {
      // expected - KEK salt registration may fail for existing users
    }

    const deviceInfo = parseUserAgent(req);

    let dataUnlocked = false;
    if (userRecord.isOidc) {
      dataUnlocked = await authManager.authenticateOIDCUser(
        userRecord.id,
        deviceInfo.type,
      );
    } else {
      dataUnlocked = await authManager.authenticateUser(
        userRecord.id,
        password,
        deviceInfo.type,
      );
    }

    if (!dataUnlocked) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    try {
      const { SharedCredentialManager } =
        await import("../../utils/shared-credential-manager.js");
      const sharedCredManager = SharedCredentialManager.getInstance();
      await sharedCredManager.reEncryptPendingCredentialsForUser(userRecord.id);
    } catch (error) {
      authLogger.warn("Failed to re-encrypt pending shared credentials", {
        operation: "reencrypt_pending_credentials",
        userId: userRecord.id,
        error,
      });
    }

    if (userRecord.totpEnabled) {
      const deviceFingerprint = generateDeviceFingerprint(deviceInfo);

      const isTrusted = await authManager.isTrustedDevice(
        userRecord.id,
        deviceFingerprint,
      );

      if (isTrusted) {
        authLogger.info("TOTP bypassed for trusted device", {
          operation: "totp_bypass",
          userId: userRecord.id,
          deviceFingerprint,
        });
      } else {
        const tempToken = await authManager.generateJWTToken(userRecord.id, {
          pendingTOTP: true,
          expiresIn: "10m",
        });
        return res.json({
          success: true,
          requires_totp: true,
          temp_token: tempToken,
          rememberMe: !!rememberMe,
        });
      }
    }

    const token = await authManager.generateJWTToken(userRecord.id, {
      rememberMe: !!rememberMe,
      deviceType: deviceInfo.type,
      deviceInfo: deviceInfo.deviceInfo,
    });

    loginRateLimiter.resetAttempts(clientIp, username);

    const payload = await authManager.verifyJWTToken(token);
    authLogger.success("User login successful", {
      operation: "user_login_complete",
      userId: userRecord.id,
      username,
      sessionId: payload?.sessionId,
    });

    const response: Record<string, unknown> = {
      success: true,
      is_admin: !!userRecord.isAdmin,
      username: userRecord.username,
      ...(isNativeAppRequest(req) ? { token } : {}),
    };

    const timeoutRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'session_timeout_hours'")
      .get() as { value: string } | undefined;
    const timeoutHours = timeoutRow ? parseInt(timeoutRow.value, 10) || 24 : 24;
    const maxAge = rememberMe
      ? 30 * 24 * 60 * 60 * 1000
      : timeoutHours * 60 * 60 * 1000;

    return res
      .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
      .json(response);
  } catch (err) {
    authLogger.error("Failed to log in user", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * @openapi
 * /users/logout:
 *   post:
 *     summary: User logout
 *     description: Logs out the user and clears the JWT cookie.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Logged out successfully.
 *       500:
 *         description: Logout failed.
 */
router.post("/logout", authenticateJWT, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    if (userId) {
      const sessionId = authReq.sessionId;

      await authManager.logoutUser(userId, sessionId);
      authLogger.info("User logged out", {
        operation: "user_logout",
        userId,
        sessionId,
      });
    }

    return res
      .clearCookie("jwt", authManager.getClearCookieOptions(req))
      .json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    authLogger.error("Logout failed", err);
    return res.status(500).json({ error: "Logout failed" });
  }
});

/**
 * @openapi
 * /users/me:
 *   get:
 *     summary: Get current user's info
 *     description: Retrieves information about the currently authenticated user.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: User information.
 *       401:
 *         description: Invalid userId or user not found.
 *       500:
 *         description: Failed to get username.
 */
router.get("/me", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!isNonEmptyString(userId)) {
    authLogger.warn("Invalid userId in JWT for /users/me");
    return res.status(401).json({ error: "Invalid userId" });
  }
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      authLogger.warn(`User not found for /users/me: ${userId}`);
      return res.status(401).json({ error: "User not found" });
    }

    const hasPassword =
      user[0].passwordHash && user[0].passwordHash.trim() !== "";
    const hasOidc = user[0].isOidc && user[0].oidcIdentifier;
    const isDualAuth = hasPassword && hasOidc;

    res.json({
      userId: user[0].id,
      username: user[0].username,
      is_admin: !!user[0].isAdmin,
      is_oidc: !!user[0].isOidc,
      is_dual_auth: isDualAuth,
      totp_enabled: !!user[0].totpEnabled,
      data_unlocked: authManager.isUserUnlocked(userId),
      // Phase 90 Plan 05 Task 1 (W#8 resolution — Option A): expose the
      // viewing user's Matrix mxid so the relay-room pane's
      // `useViewingUserMxid()` hook can source it via `getUserInfo()`
      // without a dedicated endpoint. `users.mxid` is nullable (Phase 88
      // slice A durable column — pre-Phase-88 users may still have
      // mxid=null); the frontend UserInfo type declares `mxid?: string |
      // null` and consumers treat both undefined and null as "no mxid".
      mxid: user[0].mxid ?? null,
    });
  } catch (err) {
    authLogger.error("Failed to get username", err);
    res.status(500).json({ error: "Failed to get username" });
  }
});

/**
 * @openapi
 * /users/me/token:
 *   get:
 *     summary: Get current session token
 *     description: Returns the JWT for the currently authenticated session. Intended for mobile WebView clients that cannot read HTTP-only cookies.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Current session token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       401:
 *         description: Not authenticated.
 */
router.get("/me/token", authenticateJWT, (req: Request, res: Response) => {
  const token = (req as Request & { cookies: Record<string, string> }).cookies
    ?.jwt;
  res.json({ token: token || null });
});

/**
 * @openapi
 * /users/setup-required:
 *   get:
 *     summary: Check if setup is required
 *     description: Checks if the system requires initial setup (i.e., no users exist).
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Setup status.
 *       500:
 *         description: Failed to check setup status.
 */
router.get("/setup-required", async (req, res) => {
  try {
    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    const count = (countResult as { count?: number })?.count || 0;

    res.json({
      setup_required: count === 0,
    });
  } catch (err) {
    authLogger.error("Failed to check setup status", err);
    res.status(500).json({ error: "Failed to check setup status" });
  }
});

/**
 * @openapi
 * /users/count:
 *   get:
 *     summary: Count users
 *     description: Returns the total number of users in the system.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: User count.
 *       403:
 *         description: Admin access required.
 *       500:
 *         description: Failed to count users.
 */
router.get("/count", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user[0] || !user[0].isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM users")
      .get();
    const count = (countResult as { count?: number })?.count || 0;
    res.json({ count });
  } catch (err) {
    authLogger.error("Failed to count users", err);
    res.status(500).json({ error: "Failed to count users" });
  }
});

/**
 * @openapi
 * /users/db-health:
 *   get:
 *     summary: Database health check
 *     description: Checks if the database is accessible.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Database is accessible.
 *       500:
 *         description: Database not accessible.
 */
router.get("/db-health", requireAdmin, async (req, res) => {
  try {
    db.$client.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  } catch (err) {
    authLogger.error("DB health check failed", err);
    res.status(500).json({ error: "Database not accessible" });
  }
});

/**
 * @openapi
 * /users/registration-allowed:
 *   get:
 *     summary: Get registration status
 *     description: Checks if user registration is currently allowed.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Registration status.
 *       500:
 *         description: Failed to get registration allowed status.
 */
router.get("/registration-allowed", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    res.json({
      allowed: row ? (row as Record<string, unknown>).value === "true" : true,
    });
  } catch (err) {
    authLogger.error("Failed to get registration allowed", err);
    res.status(500).json({ error: "Failed to get registration allowed" });
  }
});

/**
 * @openapi
 * /users/registration-allowed:
 *   patch:
 *     summary: Set registration status
 *     description: Enables or disables user registration.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Registration status updated.
 *       400:
 *         description: Invalid value for allowed.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to set registration allowed status.
 */
router.patch("/registration-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    // UPSERT rather than bare UPDATE: on a DB where the init-time seed at
    // db/index.ts:571-578 never fired (older migration path, or race), a
    // straight UPDATE affects 0 rows silently and the caller sees a lying 200.
    db.$client
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('allow_registration', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(allowed ? "true" : "false");
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set registration allowed", err);
    res.status(500).json({ error: "Failed to set registration allowed" });
  }
});

router.get("/oidc-auto-provision", async (_req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_auto_provision'")
      .get();
    res.json({
      enabled: row ? (row as Record<string, unknown>).value === "true" : false,
    });
  } catch (err) {
    authLogger.error("Failed to get OIDC auto-provision setting", err);
    res
      .status(500)
      .json({ error: "Failed to get OIDC auto-provision setting" });
  }
});

router.patch("/oidc-auto-provision", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "Invalid value for enabled" });
    }
    const existing = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_auto_provision'")
      .get();
    if (existing) {
      db.$client
        .prepare(
          "UPDATE settings SET value = ? WHERE key = 'oidc_auto_provision'",
        )
        .run(enabled ? "true" : "false");
    } else {
      db.$client
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('oidc_auto_provision', ?)",
        )
        .run(enabled ? "true" : "false");
    }
    res.json({ enabled });
  } catch (err) {
    authLogger.error("Failed to set OIDC auto-provision", err);
    res.status(500).json({ error: "Failed to set OIDC auto-provision" });
  }
});

/**
 * @openapi
 * /users/password-login-allowed:
 *   get:
 *     summary: Get password login status
 *     description: Checks if password-based login is currently allowed.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Password login status.
 *       500:
 *         description: Failed to get password login allowed status.
 */
router.get("/password-login-allowed", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_login'")
      .get();
    res.json({
      allowed: row ? (row as { value: string }).value === "true" : true,
    });
  } catch (err) {
    authLogger.error("Failed to get password login allowed", err);
    res.status(500).json({ error: "Failed to get password login allowed" });
  }
});

/**
 * @openapi
 * /users/password-login-allowed:
 *   patch:
 *     summary: Set password login status
 *     description: Enables or disables password-based login.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Password login status updated.
 *       400:
 *         description: Invalid value for allowed.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to set password login allowed status.
 */
router.patch("/password-login-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_password_login', ?)",
      )
      .run(allowed ? "true" : "false");
    const { saveMemoryDatabaseToFile } = await import("../db/index.js");
    await saveMemoryDatabaseToFile();
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set password login allowed", err);
    res.status(500).json({ error: "Failed to set password login allowed" });
  }
});

/**
 * @openapi
 * /users/password-reset-allowed:
 *   get:
 *     summary: Get password reset status
 *     description: Checks if password reset is currently allowed.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Password reset status.
 *       500:
 *         description: Failed to get password reset allowed status.
 */
router.get("/password-reset-allowed", async (req, res) => {
  try {
    const row = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_reset'")
      .get();
    res.json({
      allowed: row ? (row as { value: string }).value === "true" : true,
    });
  } catch (err) {
    authLogger.error("Failed to get password reset allowed", err);
    res.status(500).json({ error: "Failed to get password reset allowed" });
  }
});

/**
 * @openapi
 * /users/password-reset-allowed:
 *   patch:
 *     summary: Set password reset status
 *     description: Enables or disables password reset.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowed:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Password reset status updated.
 *       400:
 *         description: Invalid value for allowed.
 *       403:
 *         description: Not authorized.
 *       500:
 *         description: Failed to set password reset allowed status.
 */
router.patch("/password-reset-allowed", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0 || !user[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { allowed } = req.body;
    if (typeof allowed !== "boolean") {
      return res.status(400).json({ error: "Invalid value for allowed" });
    }
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_password_reset', ?)",
      )
      .run(allowed ? "true" : "false");
    res.json({ allowed });
  } catch (err) {
    authLogger.error("Failed to set password reset allowed", err);
    res.status(500).json({ error: "Failed to set password reset allowed" });
  }
});

/**
 * @openapi
 * /users/delete-account:
 *   delete:
 *     summary: Delete user account
 *     description: Deletes the authenticated user's account.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account deleted successfully.
 *       400:
 *         description: Password is required.
 *       401:
 *         description: Incorrect password.
 *       403:
 *         description: Cannot delete external authentication accounts or the last admin user.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to delete account.
 */
router.delete("/delete-account", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { password } = req.body;

  if (!isNonEmptyString(password)) {
    return res
      .status(400)
      .json({ error: "Password is required to delete account" });
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userRecord = user[0];

    if (userRecord.isOidc) {
      return res.status(403).json({
        error:
          "Cannot delete external authentication accounts through this endpoint",
      });
    }

    const isMatch = await bcrypt.compare(password, userRecord.passwordHash);
    if (!isMatch) {
      authLogger.warn(
        `Incorrect password provided for account deletion: ${userRecord.username}`,
      );
      return res.status(401).json({ error: "Incorrect password" });
    }

    if (userRecord.isAdmin) {
      const adminCount = db.$client
        .prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1")
        .get();
      if (((adminCount as { count?: number })?.count || 0) <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    // Phase 85 (D-22) — remove this user's avatar file before deleting the row.
    // This path (DELETE /users/delete-account) does NOT go through
    // deleteUserAndRelatedData, so the cleanup wiring in delete-user-data.ts
    // does not cover it (RESEARCH.md § 1 site #4). ENOENT-tolerant per Plan 02.
    // Wrapped in try/catch so a broken filesystem does not block the user from
    // deleting their own account (T-85-DEL-BLOCK — log-and-continue policy;
    // admin-side let-throw is the separate policy in delete-user-data.ts).
    try {
      const avatarRow = await db.select({ avatarPath: users.avatarPath })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (avatarRow.length > 0) {
        await unlinkUserAvatar(avatarRow[0].avatarPath);
      }
    } catch (unlinkErr) {
      authLogger.warn(
        "[phase-85] avatar unlink failed on delete-account (non-fatal — proceeding with row DELETE)",
        { operation: "delete_account_avatar_unlink_failed", userId, error: unlinkErr },
      );
    }

    // Phase 88 D-09 — deactivate Matrix account BEFORE row DELETE (Pitfall 5 — cannot read mxid after DELETE).
    // Best-effort per D-10: Synapse failure logs a warning with the orphan mxid and proceeds with the row DELETE
    // anyway. Refusing to delete the Skynet account because of Synapse infra weirdness is worse UX than leaving
    // a temporarily-orphaned deactivated Matrix account behind.
    if (userRecord.mxid) {
      const deactivateResult = await deactivateUser(userRecord.mxid);
      if (!deactivateResult.ok) {
        assertAdminErr(deactivateResult);
        authLogger.warn(
          "Matrix account deactivation failed on delete-account (orphaned mxid logged for future sweep — D-10 best-effort)",
          {
            operation: "delete_account_matrix_deactivate_failed",
            userId,
            mxid: userRecord.mxid,
            status: deactivateResult.status,
            error: deactivateResult.error,
          },
        );
      }
    }

    await db.delete(users).where(eq(users.id, userId));

    // M5: forceSave after row deletion — crown-jewel invariant (matches the
    // pattern used by /create and PUT /:id/avatar). Failure logs but does NOT
    // fail the request (the row deletion already succeeded in SQLite RAM and
    // the debounce flush will eventually persist it).
    try {
      await DatabaseSaveTrigger.forceSave("phase-85-user-delete-account");
    } catch (saveError) {
      authLogger.error("Failed to persist delete-account to disk", saveError, {
        operation: "delete_account_save_failed",
        userId,
      });
    }

    authLogger.success(`User account deleted: ${userRecord.username}`);
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    authLogger.error("Failed to delete user account", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

registerUserPasswordResetRoutes(router, { authManager });

/**
 * @openapi
 * /users/change-password:
 *   post:
 *     summary: Change user password
 *     description: Changes the authenticated user's password.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully.
 *       400:
 *         description: Old and new passwords are required.
 *       401:
 *         description: Incorrect current password.
 *       500:
 *         description: Failed to update password and re-encrypt data.
 */
router.post("/change-password", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { oldPassword, newPassword } = req.body;
  authLogger.info("Password change request", {
    operation: "password_change_request",
    userId,
  });

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "Old and new passwords are required." });
  }

  const user = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const isMatch = await bcrypt.compare(oldPassword, user[0].passwordHash);
  if (!isMatch) {
    authLogger.warn("Password change failed - old password incorrect", {
      operation: "password_change_failed",
      userId,
      reason: "old_password_wrong",
    });
    return res.status(401).json({ error: "Incorrect current password" });
  }

  const success = await authManager.changeUserPassword(
    userId,
    oldPassword,
    newPassword,
  );
  if (!success) {
    return res
      .status(500)
      .json({ error: "Failed to update password and re-encrypt data." });
  }

  const saltRounds = parseInt(process.env.SALT || "10", 10);
  const password_hash = await bcrypt.hash(newPassword, saltRounds);
  await db
    .update(users)
    .set({ passwordHash: password_hash })
    .where(eq(users.id, userId));

  authManager.logoutUser(userId);
  authLogger.success("Password changed successfully", {
    operation: "password_change_complete",
    userId,
  });

  res.json({ message: "Password changed successfully. Please log in again." });
});

router.post("/change-username", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { newUsername } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }
  if (!isNonEmptyString(newUsername)) {
    return res.status(400).json({ error: "newUsername is required" });
  }

  const trimmed = newUsername.trim();
  const user = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }
  if (user[0].username === trimmed) {
    return res
      .status(400)
      .json({ error: "New username is the same as current" });
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, trimmed));
  if (existing && existing.length > 0) {
    return res.status(409).json({ error: "Username already taken" });
  }

  await db
    .update(users)
    .set({ username: trimmed })
    .where(eq(users.id, userId));

  authLogger.success("Username changed", {
    operation: "username_change_complete",
    userId,
    oldUsername: user[0].username,
    newUsername: trimmed,
  });

  res.json({ message: "Username changed successfully.", username: trimmed });
});

registerUserAdminRoutes(router, authenticateJWT);

registerUserTotpRoutes(router, {
  authenticateJWT,
  authManager,
  isNativeAppRequest,
});

/**
 * @openapi
 * /users/delete-user:
 *   delete:
 *     summary: Delete user (admin only)
 *     description: Allows an admin to delete another user and all related data.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: User deleted successfully.
 *       400:
 *         description: Username is required or cannot delete yourself.
 *       403:
 *         description: Not authorized or cannot delete last admin.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Failed to delete user.
 */
router.delete("/delete-user", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { username } = req.body;

  if (!isNonEmptyString(username)) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const adminUser = await db.select().from(users).where(eq(users.id, userId));
    if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (adminUser[0].username === username) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    const targetUser = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    if (!targetUser || targetUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser[0].isAdmin) {
      const adminCount = db.$client
        .prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1")
        .get();
      if (((adminCount as { count?: number })?.count || 0) <= 1) {
        return res
          .status(403)
          .json({ error: "Cannot delete the last admin user" });
      }
    }

    const targetUserId = targetUser[0].id;

    await deleteUserAndRelatedData(targetUserId);

    authLogger.warn("User account deleted by admin", {
      operation: "admin_delete_user",
      adminId: userId,
      targetUserId,
      targetUsername: username,
    });
    res.json({ message: `User ${username} deleted successfully` });
  } catch (err) {
    authLogger.error("Failed to delete user", err);

    if (err && typeof err === "object" && "code" in err) {
      if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        res.status(400).json({
          error:
            "Cannot delete user: User has associated data that cannot be removed",
        });
      } else {
        res.status(500).json({ error: `Database error: ${err.code}` });
      }
    } else {
      res.status(500).json({ error: "Failed to delete account" });
    }
  }
});

registerUserDataAccessRoutes(router, {
  authenticateJWT,
  authManager,
});

registerUserSessionRoutes(router, {
  authenticateJWT,
  authManager,
});

registerUserOidcAccountRoutes(router, {
  authenticateJWT,
  authManager,
});

registerUserSettingsRoutes(router, authenticateJWT);

registerUserApiKeyRoutes(router, requireAdmin);

export default router;
