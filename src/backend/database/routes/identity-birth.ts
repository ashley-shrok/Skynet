/**
 * Phase 20 (IDUI-06/08/09): POST /identities/birth — SSE birth orchestrator route.
 *
 * Thin SSE glue around the pure birthIdentity() orchestrator. Responsibilities:
 *   - JWT auth + body validation (400 on missing/invalid fields)
 *   - SSE header flushing (Content-Type: text/event-stream, no-cache, etc.)
 *   - Assembling the real deps object and invoking birthIdentity()
 *   - Framing each BirthEvent as `event: birth\ndata: {...}\n\n`
 *   - Closing the connection after the orchestrator finishes
 *
 * Mount point: app.use("/identities/birth", identityBirthRoutes)
 * Must be mounted BEFORE the general /identities mount (more-specific path wins).
 */

import express from "express";
import type { Request, Response } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fsp from "node:fs/promises";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";
import { identities } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
  writeAvatarSiblingFile,
} from "../../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  birthIdentity,
  ROLE_NAME_PATTERN,
  type BirthEvent,
  type BirthDeps,
} from "./identity-birth-orchestrator.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// DB-direct helper: createIdentityRecord
// Mirrors POST /identities handler (identities.ts:86-171) but operates
// directly on the DB — avoids double-JWT-auth and internal HTTP round-trip.
// ---------------------------------------------------------------------------

async function createIdentityRecord(
  userId: string,
  meta: {
    identityKey: string;
    displayName: string;
    title: string | null;
    colorHue: number | null;
    voice: string | null;
  },
  avatarBytes: Buffer,
): Promise<{
  id: string;
  colorHue: number | null;
  voice: string | null;
  avatarEtag: string;
}> {
  const etag = createHash("md5").update(avatarBytes).digest("hex");
  const id = nanoid();
  const now = new Date().toISOString();

  db.insert(identities)
    .values({
      id,
      userId,
      identityKey: meta.identityKey,
      displayName: meta.displayName,
      title: meta.title,
      colorHue: meta.colorHue ?? null,
      voice: meta.voice ?? null,
      avatarMime: "image/png",
      avatarData: avatarBytes,
      avatarEtag: etag,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  try {
    await DatabaseSaveTrigger.forceSave("identity_birth");
  } catch (saveErr) {
    databaseLogger.warn("Force-save after identity birth failed", {
      operation: "identity_birth_save_failed",
      userId,
      identityKey: meta.identityKey,
      error: saveErr instanceof Error ? saveErr.message : "Unknown error",
    });
  }

  return { id, colorHue: meta.colorHue, voice: meta.voice, avatarEtag: etag };
}

// ---------------------------------------------------------------------------
// DB-direct helper: getIdentityRecord
// Used for GET-verify after step 1 (silent-no-op guard).
// ---------------------------------------------------------------------------

async function getIdentityRecord(
  userId: string,
  id: string,
): Promise<{
  id: string;
  colorHue: number | null;
  voice: string | null;
  avatarEtag: string;
}> {
  const rows = db
    .select()
    .from(identities)
    .where(and(eq(identities.id, id), eq(identities.userId, userId)))
    .all();

  if (rows.length === 0) {
    throw new Error(`Identity ${id} not found after creation`);
  }

  const row = rows[0];
  return {
    id: row.id,
    colorHue: row.colorHue ?? null,
    voice: row.voice ?? null,
    avatarEtag: row.avatarEtag,
  };
}

// ---------------------------------------------------------------------------
// Local exec helper (child_process.exec promisified)
// ---------------------------------------------------------------------------

async function execLocal(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

router.post(
  "/",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // Body validation — 400 before opening SSE if any required field is missing
    // -----------------------------------------------------------------------
    const {
      hostId,
      name,
      title,
      path,
      colorHue,
      voice,
      avatarCandidateId,
      role,
    } = req.body as Record<string, unknown>;

    if (
      typeof hostId !== "number" ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    if (typeof avatarCandidateId !== "string" || !avatarCandidateId.trim()) {
      res.status(400).json({ error: "avatarCandidateId is required" });
      return;
    }

    // Phase 22 SRIC-02: role is REQUIRED and must be kebab-case-lowercase.
    // Defense in depth — the orchestrator re-validates before shell interpolation.
    if (typeof role !== "string" || !ROLE_NAME_PATTERN.test(role.trim())) {
      res.status(400).json({
        error: "role is required and must be kebab-case-lowercase",
      });
      return;
    }

    // colorHue and voice are optional (nullable)
    if (colorHue !== null && colorHue !== undefined && typeof colorHue !== "number") {
      res.status(400).json({ error: "colorHue must be a number or null" });
      return;
    }

    if (voice !== null && voice !== undefined && typeof voice !== "string") {
      res.status(400).json({ error: "voice must be a string or null" });
      return;
    }

    const parsedColorHue = (typeof colorHue === "number" ? colorHue : null) as number | null;
    const parsedVoice = (typeof voice === "string" ? voice : null) as string | null;
    const parsedPath = (typeof path === "string" ? path : "~") as string;

    // -----------------------------------------------------------------------
    // Open SSE stream (headers flushed BEFORE orchestrator starts)
    // -----------------------------------------------------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx SSE disable-buffering hint
    res.flushHeaders();

    // -----------------------------------------------------------------------
    // Emit helper — frames each event as SSE
    // -----------------------------------------------------------------------
    const emit = (e: BirthEvent): void => {
      res.write(`event: birth\ndata: ${JSON.stringify(e)}\n\n`);
    };

    // -----------------------------------------------------------------------
    // Build real deps object
    // -----------------------------------------------------------------------
    // Patch #316: userId is the JWT subject string (users.id = text() in
    // schema). Prior parseInt() produced NaN → String(NaN) = "NaN" downstream,
    // breaking every birth at step 1's getCandidateForBirth scope guard.
    // Pass the string through unmodified; dep signatures updated to match.

    const deps: BirthDeps = {
      connectOneShot,
      execCommand,
      isLocalHostId,
      execLocal,
      createIdentityRecord: async (uid, meta, avatarBytes) =>
        createIdentityRecord(uid, meta, avatarBytes),
      getIdentityRecord: async (uid, id) =>
        getIdentityRecord(uid, id),
      getCandidateForBirth: (uid, id) => getCandidateForBirth(uid, id),
      resolveHostById: async (hostId, uid) =>
        resolveHostById(hostId, uid),
      fsp: {
        readFile: (p: string, enc: "utf8") => fsp.readFile(p, enc),
        writeFile: (p: string, content: string) => fsp.writeFile(p, content),
      },
      // Phase 22 SRIC-02: SFTP tmp+rename helper for Step 2.5 pre-write.
      writeMarkdownFileAtomic: async (conn, targetPath, contents) =>
        writeMarkdownFileAtomic(conn, targetPath, contents),
      // Phase 66 Plan 66-01 Track 1: SFTP binary tmp+rename helper for the
      // Step 2.5 avatar sibling write — same ext_openssh_rename discipline
      // as writeMarkdownFileAtomic, binary payload, log tag
      // identity_avatar_write.
      writeAvatarSiblingFile: async (conn, identityKey, ext, bytes) =>
        writeAvatarSiblingFile(conn, identityKey, ext, bytes),
    };

    // -----------------------------------------------------------------------
    // Invoke orchestrator — catch errors and surface in SSE stream
    // -----------------------------------------------------------------------
    try {
      await birthIdentity(
        {
          userId,
          hostId,
          name: name.trim(),
          title: title.trim(),
          path: parsedPath,
          colorHue: parsedColorHue,
          voice: parsedVoice,
          avatarCandidateId: avatarCandidateId.trim(),
          role: role.trim(),
        },
        emit,
        deps,
      );
    } catch (err) {
      // Unexpected throw from orchestrator (should emit ended event itself,
      // but catch here as a safety net — emit an ended{ok:false} if not already)
      databaseLogger.error("Identity birth orchestrator threw unexpectedly", err, {
        operation: "identity_birth",
        userId,
        name,
      });
      emit({ type: "ended", ok: false });
    } finally {
      // Consume the candidate to prevent re-use
      try {
        consumeCandidateForBirth(userId, avatarCandidateId as string);
      } catch {
        // Ignore cleanup errors
      }
      res.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Error handler (mirrors identities.ts L316-333)
// ---------------------------------------------------------------------------
router.use(
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    databaseLogger.error("Identity birth route error", err, {
      operation: "identity_birth_route_error",
    });
    return res.status(500).json({ error: err?.message ?? "Identity birth error" });
  },
);

export default router;
