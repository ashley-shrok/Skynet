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
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  isLocalHostId,
  APP_SLUG_RE,
} from "../../claude-session/identity-artifact-reader.js";
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
    return titleFromManifestText(raw);
  } catch {
    // graceful degrade — frontend falls back to slug
  }
  return undefined;
}

/**
 * Extract a non-empty string `title` from raw app.json text. Same semantics
 * as readLocalArchivedAppTitle: anything else → undefined.
 */
function titleFromManifestText(raw: string): string | undefined {
  try {
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

/** Hard ceiling on the single REMOTE list+titles exec (matches list-archived-apps.ts). */
const REMOTE_LIST_TIMEOUT_MS = 15_000;

/**
 * REMOTE: one exec that enumerates archived app folders AND emits each
 * folder's app.json, so titles cost no extra channels. Output is one record
 * per line: `<slug>\t<base64(app.json) or empty>`. base64 (newlines stripped)
 * keeps arbitrary manifest bytes — newlines, tabs, quotes — from breaking
 * the framing. Folder selection mirrors listArchivedAppsOnHost's
 * `find -type d` (real directories only, symlinks skipped); manifests are
 * capped at 1 MiB (an over-cap manifest truncates → parse fails → no title).
 * Missing archive root → empty output.
 */
export const REMOTE_ARCHIVED_APPS_WITH_TITLES_CMD =
  `cd "$HOME/fleet/apps-archive" 2>/dev/null || exit 0; ` +
  `for d in */; do d="\${d%/}"; [ -d "$d" ] && [ ! -L "$d" ] || continue; ` +
  `printf '%s\\t' "$d"; ` +
  `if [ -f "$d/app.json" ]; then head -c 1048576 "$d/app.json" | base64 | tr -d '\\n'; fi; ` +
  `printf '\\n'; done`;

/** Parse REMOTE_ARCHIVED_APPS_WITH_TITLES_CMD output. Exported for tests. */
export function parseRemoteArchivedAppsWithTitles(
  stdout: string,
): Array<{ slug: string; title?: string }> {
  const out: Array<{ slug: string; title?: string }> = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    const slug = (tab === -1 ? line : line.slice(0, tab)).trim();
    if (!APP_SLUG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const b64 = tab === -1 ? "" : line.slice(tab + 1).trim();
    let title: string | undefined;
    if (b64.length > 0) {
      title = titleFromManifestText(Buffer.from(b64, "base64").toString("utf8"));
    }
    out.push(title === undefined ? { slug } : { slug, title });
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

async function listRemoteArchivedAppsWithTitles(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
): Promise<Array<{ slug: string; title?: string }>> {
  const stdout = await execCommand(
    conn as unknown as Parameters<typeof execCommand>[0],
    REMOTE_ARCHIVED_APPS_WITH_TITLES_CMD,
    { timeoutMs: REMOTE_LIST_TIMEOUT_MS },
  );
  return parseRemoteArchivedAppsWithTitles(stdout);
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
          // connect + the single list/titles exec + conn.end run under the
          // per-host semaphore (verify:ssh-cap).
          return await getHostSemaphore(hostId).run(async () => {
            const conn = await connectOneShot(
              resolved as unknown as Parameters<typeof connectOneShot>[0],
              SSH_CONNECT_TIMEOUT_MS,
            );
            try {
              // Slugs AND titles in one exec (same title semantics as LOCAL).
              const rows = await listRemoteArchivedAppsWithTitles(conn);
              return rows.map((r) =>
                r.title === undefined
                  ? { hostId, slug: r.slug }
                  : { hostId, slug: r.slug, title: r.title },
              );
            } finally {
              try {
                (conn as { end?: () => void }).end?.();
              } catch {
                /* ignore */
              }
            }
          });
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
