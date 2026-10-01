/**
 * GET /apps-archive — Phase 143 Plan 143-03 (D-05/D-07).
 *
 * Fleet-wide list of archived app slugs across the caller's own hosts.
 *
 * DESIGN (D-07):
 *   Fleet-wide scoping mirrors GET /identities-archive (identities-archive-list.ts).
 *   Calls listArchivedAppsOnHost (plan 143-02 primitive).
 *
 * REQUEST: GET / (no body, no query params)
 *
 * RESPONSE:
 *   200 { hostId: number; slug: string; title?: string }[]
 *   Sorted by (hostId ASC, slug ASC) for deterministic ordering.
 *   `title` is populated from the archived app's `app.json` on LOCAL hosts
 *   so the frontend can render the pretty display name instead of the slug.
 *   For REMOTE hosts, `title` is left undefined and the frontend falls back
 *   to the slug (reading remote app.json would require an extra SSH read
 *   per app; not needed for the common same-box archive case).
 *
 * FAN-OUT PATTERN (mirrors identities-archive-list.ts):
 *   Promise.all over caller's hosts → per-host try/catch → silent-drop on
 *   SSH connect failure. try/finally guarantees conn.end() on every REMOTE exit.
 *
 * SECURITY (T-143-03-01 / T-143-03-02 / T-143-03-03):
 *   - authenticateJWT gates the route; only the caller's own hosts are queried.
 *   - 500 returns generic { error: "failed to list archived apps" } —
 *     underlying details logged server-side via databaseLogger.error.
 *   - SSH connect timeout: SSH_CONNECT_TIMEOUT_MS = 5000ms (T-143-03-03).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { listArchivedAppsOnHost } from "../../claude-session/list-archived-apps.js";
import { getLocalArchivedAppsRoot } from "../../claude-session/per-app-archive-file.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling fleet-wide list routes (5s). */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Read the `title` field from a LOCAL archived app's `app.json`, if
 * present and parseable. Returns undefined on any failure (missing file,
 * malformed JSON, missing/non-string title). Never throws — a bad
 * manifest just degrades to slug-fallback at the frontend.
 */
async function readLocalArchivedAppTitle(
  slug: string,
): Promise<string | undefined> {
  try {
    const manifestPath = path.join(getLocalArchivedAppsRoot(), slug, "app.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "title" in parsed &&
      typeof (parsed as { title: unknown }).title === "string" &&
      (parsed as { title: string }).title.length > 0
    ) {
      return (parsed as { title: string }).title;
    }
  } catch {
    // graceful degrade — frontend falls back to slug
  }
  return undefined;
}

/**
 * GET /apps-archive
 * Returns fleet-wide array of { hostId, slug } — one entry per
 * archived app slug per host.
 */
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // --- Host projection (fleet-wide, scoped to caller's userId) ----------
    // Mirrors identities-archive-list.ts host projection shape.
    let candidateRows: Array<{ id: number }>;
    try {
      candidateRows = (await db
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.userId, userId))) as Array<{ id: number }>;
    } catch (e) {
      databaseLogger.error("apps-archive-list: host projection failed", {
        operation: "apps_archive_list_host_projection_failed",
        userId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return res.status(500).json({ error: "failed to list archived apps" });
    }

    // --- Fleet-wide fan-out (mirrors identities-archive-list.ts) ----------
    const perHost = await Promise.all(
      candidateRows.map(async (h): Promise<Array<{ hostId: number; slug: string; title?: string }>> => {
        const hostId = h.id;
        try {
          if (isLocalHostId(hostId)) {
            // LOCAL branch — no SSH needed. Read each archived app's
            // `app.json` title alongside the slug so the frontend can
            // render the display name instead of the slug.
            const slugs = await listArchivedAppsOnHost(null);
            const entries = await Promise.all(
              slugs.map(async (slug) => {
                const title = await readLocalArchivedAppTitle(slug);
                return title === undefined
                  ? { hostId, slug }
                  : { hostId, slug, title };
              }),
            );
            return entries;
          }

          // REMOTE branch
          const resolved = await resolveHostById(hostId, userId);
          if (!resolved) return [];
          const conn = await connectOneShot(
            resolved as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
          try {
            const slugs = await listArchivedAppsOnHost(
              conn as unknown as Parameters<typeof listArchivedAppsOnHost>[0],
            );
            // Remote titles are not read (would require per-app SSH reads).
            // Frontend gracefully falls back to slug when title is absent.
            return slugs.map((slug) => ({ hostId, slug }));
          } finally {
            try {
              (conn as { end?: () => void }).end?.();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          // Per-host failure is silently swallowed — mirrors identities-archive-list.ts
          // fan-out discipline (one bad host contributes [] rather than a 500).
          databaseLogger.debug("apps-archive-list: host skipped", {
            operation: "apps_archive_list_host_skip",
            hostId,
            error: e instanceof Error ? e.message : "unknown",
          });
          return [];
        }
      }),
    );

    // --- Aggregate + sort -------------------------------------------------
    const flat = perHost.flat();
    flat.sort((a, b) => {
      if (a.hostId !== b.hostId) return a.hostId - b.hostId;
      return a.slug.localeCompare(b.slug);
    });

    return res.json(flat);
  },
);

export default router;
