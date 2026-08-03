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
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  birthIdentity,
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
      colorHue: meta.colorHue ?? null,
      voice: meta.voice ?? null,
      avatarMime: "image/png",
      avatarData: avatarBytes,
      avatarEtag: etag,
      createdAt: now,
      updatedAt: now,
    })
    .run();

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
    const userIdNum = parseInt(userId, 10);

    const deps: BirthDeps = {
      connectOneShot,
      execCommand,
      isLocalHostId,
      execLocal,
      createIdentityRecord: async (uid, meta, avatarBytes) =>
        createIdentityRecord(String(uid), meta, avatarBytes),
      getIdentityRecord: async (uid, id) =>
        getIdentityRecord(String(uid), id),
      getCandidateForBirth: (uid, id) => getCandidateForBirth(uid, id),
      resolveHostById: async (hostId, uid) =>
        resolveHostById(hostId, String(uid)),
      fsp: {
        readFile: (p: string, enc: "utf8") => fsp.readFile(p, enc),
        writeFile: (p: string, content: string) => fsp.writeFile(p, content),
      },
    };

    // -----------------------------------------------------------------------
    // Invoke orchestrator — catch errors and surface in SSE stream
    // -----------------------------------------------------------------------
    try {
      await birthIdentity(
        {
          userId: userIdNum,
          hostId,
          name: name.trim(),
          title: title.trim(),
          path: parsedPath,
          colorHue: parsedColorHue,
          voice: parsedVoice,
          avatarCandidateId: avatarCandidateId.trim(),
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
        consumeCandidateForBirth(userIdNum, avatarCandidateId as string);
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
