/**
 * Phase 117 Plan 117-04: /projects router.
 *
 * Three endpoints:
 *   GET  /projects?hostId=<n>              → enumerate non-archived projects
 *   POST /projects                          → create project (backend-slugify)
 *   POST /projects/:slug/archive            → move dir into archive/
 *
 * Semantic contract (per Phase 117 CONTEXT):
 *   - D-11:  GET /projects returns { projects: [{slug, displayName, archived}] }.
 *            archive/ subdir is excluded upstream (listProjects primitive).
 *   - D-25:  POST body {hostId, displayName}. Backend derives the slug
 *            (kebab-case, lowercased) via `normalizeToSlug` — Pitfall 1
 *            (backend is authoritative). Dupe slug rejected with 409 so the
 *            frontend modal can surface the collision to the user.
 *   - D-28+D-30: POST /:slug/archive body {hostId} moves the whole project
 *            directory into `~/fleet/projects/archive/<slug>/`.
 *   - D-36a: JSON body throughout (small sentinel-drop-shaped payloads; no
 *            file uploads).
 *   - D-37:  Every successful write triggers `publishProjectListChanged`
 *            with the FULL current-projects array so connected clients
 *            receive the wire event (via subscription-registry singleton
 *            introduced by this plan).
 *
 * Byte-shape mirrors identity-archive.ts:76-159 (Phase 115) for JSON body
 * posture, hostId parse, JWT + resolveHostById gates, LOCAL/REMOTE branch on
 * isLocalHostId, try/catch/finally with connectOneShot, generic-500-with-
 * server-side-log.
 *
 * Security (Phase 117 Plan 117-04 threat register):
 *   - T-117-04-01 (EoP cross-user hostId probe): resolveHostById(hostId,
 *     userId) → 404 on cross-user or unknown host (NOT 403 — probe
 *     distinguisher defense).
 *   - T-117-04-02 (Tampering path-traversal via slug): PROJECT_SLUG_RE
 *     gate fires BEFORE any I/O on the archive route; POST create route
 *     derives the slug internally so cannot receive a hostile one.
 *   - T-117-04-05 (Info Disclosure via 500 body): fixed error shape
 *     `{error: "fixed string"}`; underlying err.message goes to
 *     databaseLogger.error only.
 *   - T-117-04-04 (DoS unauth flood): authenticateJWT gate on every route.
 *
 * Mounted at /projects in database.ts alongside /runbooks-editor.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import {
  isLocalHostId,
  PROJECT_SLUG_RE,
  listProjects,
  createProject,
  archiveProject,
  readProjectFile,
  writeProjectFile,
} from "../../claude-session/identity-artifact-reader.js";
import { getSubscriptionRegistry } from "../../fleet-status/subscription-registry.js";
// Phase 130: per-user visibility gate write side for projects. isHostMultiUser
// gates whether the auto-tag branch fires at all (single-user hosts stay silent
// per shape §"invisible in the majority case"); getUsernameForUserId resolves
// the JWT userId to a case-preserved Skynet username so the frontmatter
// `users:` list gets the human-readable name, not the opaque nanoid subject.
// Mirrors the Phase 129 roles-create.ts + identity-birth.ts pattern.
import {
  isHostMultiUser,
  getUsernameForUserId,
} from "../../utils/host-user-counter.js";
// Phase 130: per-user READ-side gate. Pure function; consumes the users list
// parsed from project.md frontmatter and returns visible/hidden per caller.
import { isProjectVisibleToUser } from "../../fleet-status/project-visibility-gate.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/** displayName length cap — per plan behavior spec (1..80 chars). */
const DISPLAY_NAME_MAX_LEN = 80;

/**
 * Backend-authoritative slug derivation (Pitfall 1 in RESEARCH).
 *
 * Algorithm:
 *   1. Lowercase.
 *   2. Replace every run of non-[a-z0-9] characters with a single dash.
 *   3. Strip leading + trailing dashes.
 *
 * Empty output (e.g. from input `"___"` — pure separators) signals invalid
 * input; the POST /projects route responds 400 rather than attempting to
 * mint a project with an empty slug.
 *
 * Exported so the frontend test suite (117-09) can import and cross-check
 * that the modal's echo-slug-back UX matches the derivation. The frontend
 * does NOT call this at runtime — the raw displayName is submitted and the
 * derived slug is echoed back in the 200 response body.
 */
export function normalizeToSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse + validate a hostId value from either query params or body.
 *
 * Returns a positive integer or a { error } tuple describing the reason.
 */
interface ParsedHostOk {
  ok: true;
  hostId: number;
  error: null;
}
interface ParsedHostErr {
  ok: false;
  hostId: null;
  error: string;
}
type ParsedHost = ParsedHostOk | ParsedHostErr;

function parseHostId(raw: unknown): ParsedHost {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, hostId: null, error: "hostId is required" };
  }
  const hostId =
    typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
    return { ok: false, hostId: null, error: "hostId must be a positive integer" };
  }
  return { ok: true, hostId, error: null };
}

/**
 * Build the enriched wire-event payload from a listProjects result.
 *
 * Adds hostId (as string per wire-protocol schema), hostname (from the
 * resolved SSH host record), and archived:false (listProjects already
 * excludes the archive/ subdir per D-30). Non-archived only — v1 does
 * not surface archived projects on the wire.
 *
 * Phase 130: carries `users` on the internal ProjectListEntry so the
 * app-frame-filter's project-list-changed branch can apply the per-user
 * visibility gate against each subscriber before emit. The wire schema
 * `FrontendProjectListChangedFrameSchema` (wire-protocol.ts) deliberately
 * has NO users field — the filter STRIPS users before calling
 * makeProjectListChangedFrame, so the gate list never reaches subscribers.
 */
function enrichForWire(
  projects: Array<{
    slug: string;
    displayName: string;
    users: string[] | null;
  }>,
  hostId: number,
  hostname: string,
): Array<{
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
  users: string[] | null;
}> {
  return projects.map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    hostId: String(hostId),
    hostname,
    archived: false,
    users: p.users,
  }));
}

// ---------------------------------------------------------------------------
// GET /projects
// ---------------------------------------------------------------------------

router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse hostId (query param for GET).
    const parsed = parseHostId(req.query.hostId);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { hostId } = parsed;

    // 2. Verify host ownership — 404 on cross-user / unknown (T-117-04-01).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // Projects live on SSH hosts. RDP/VNC-only hosts have no shell to enumerate
    // ~/.claude/projects/ on, so short-circuit with an empty list rather than
    // paying a 60s SSH connect-timeout per call. Frontend host loops already
    // handle an empty projects array.
    if (host.enableSsh === false) {
      res.json({ projects: [] });
      return;
    }

    // 3. LOCAL vs REMOTE branch on isLocalHostId.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        res.status(504).json({ error: "Host unreachable" });
        return;
      }
    }

    try {
      const raw = await listProjects(conn);

      // Phase 130: per-user READ-side gate. Resolve caller's Skynet username
      // and drop any project the caller isn't gated to see. Fail-OPEN on
      // username-lookup failure (matches wave-2 identity-gate discipline at
      // starter.ts L685-697) — a null callerUsername is an infra bug, not
      // a gate signal; treating it as "hide everything" would empty every
      // user's projects sidebar on the affected code path.
      //
      // The `users` field is STRIPPED from the response body per Phase 129
      // HIGH-1 mirror: it's gate-only, MUST NOT leak to the client (no
      // evidence of cohabitants in a network trace).
      let callerUsername: string | null = null;
      try {
        callerUsername = await getUsernameForUserId(userId);
      } catch (usernameErr) {
        databaseLogger.warn(
          `projects-list: caller username lookup threw — gate disabled userId=${userId} hostId=${hostId}: ${usernameErr instanceof Error ? usernameErr.message : String(usernameErr)}`,
        );
      }

      const projects = raw
        .filter((p) => isProjectVisibleToUser(p.users, callerUsername))
        .map((p) => ({
          slug: p.slug,
          displayName: p.displayName,
          archived: false,
        }));
      res.json({ projects });
      return;
    } catch (err) {
      databaseLogger.error(
        `failed to list projects hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(500).json({ error: "failed to list projects" });
      return;
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /projects
// ---------------------------------------------------------------------------

router.post(
  "/",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const body = (req.body ?? {}) as {
      hostId?: unknown;
      displayName?: unknown;
    };

    // 1. hostId gate.
    const parsedHost = parseHostId(body.hostId);
    if (!parsedHost.ok) {
      res.status(400).json({ error: parsedHost.error });
      return;
    }
    const { hostId } = parsedHost;

    // 2. displayName gate — string, trimmed length 1..80.
    const rawDN = body.displayName;
    if (typeof rawDN !== "string") {
      res.status(400).json({ error: "displayName is required" });
      return;
    }
    const trimmed = rawDN.trim();
    if (trimmed.length < 1) {
      res.status(400).json({ error: "displayName is required" });
      return;
    }
    if (trimmed.length > DISPLAY_NAME_MAX_LEN) {
      res.status(400).json({
        error: `displayName must be ${DISPLAY_NAME_MAX_LEN} characters or fewer`,
      });
      return;
    }

    // 3. Derive slug backend-side (Pitfall 1). Empty slug → 400.
    const slug = normalizeToSlug(trimmed);
    if (slug === "") {
      res.status(400).json({
        error:
          "displayName must contain at least one alphanumeric character",
      });
      return;
    }

    // 4. Host ownership gate.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // Projects live on SSH hosts — see gate on GET / for rationale.
    if (host.enableSsh === false) {
      res.status(400).json({ error: "SSH is not enabled on this host" });
      return;
    }

    // 5. LOCAL/REMOTE branch.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        res.status(504).json({ error: "Host unreachable" });
        return;
      }
    }

    // -----------------------------------------------------------------------
    // Phase 130: auto-tag creator on multi-user hosts.
    //
    // On multi-user hosts (>1 distinct Skynet user with access), write the
    // creator's Skynet username to the new project.md's `users:` frontmatter
    // list. Single-user hosts stay silent — the file is byte-identical to a
    // pre-130 project.md.
    //
    // Ordering invariants (mirror roles-create.ts L580-604):
    //   - This branch runs BEFORE createProject so the auto-tag is baked into
    //     the FIRST write (no separate rewrite pass, no live-file mutation).
    //   - createProject itself is atomic + collision-safe (Phase 117 M2 fix
    //     at identity-artifact-reader.ts:830-870): a race-loser sees EEXIST
    //     and 409s without touching the winner's file. So no auto-tag can
    //     ever overwrite an existing cohabitant's tag list.
    //
    // Fail-open on username-lookup failure (matches roles-create discipline):
    // if getUsernameForUserId returns null on a multi-user host, we skip
    // auto-tag and log loudly. A wrong-user auto-tag would be a shape §"would
    // make it wrong" violation ("auto-tagged with the wrong user's name"), so
    // we prefer to leave the file untagged and surface the failure in logs.
    //
    // Case preservation (Phase 129 Pitfall 7): getUsernameForUserId returns
    // the case-preserved username as stored in the DB — we do NOT normalize.
    // -----------------------------------------------------------------------
    let autoTagUsers: string[] | null = null;
    try {
      const isMultiUser = await isHostMultiUser(hostId);
      if (isMultiUser) {
        const creatorUsername = await getUsernameForUserId(userId);
        if (creatorUsername) {
          autoTagUsers = [creatorUsername];
          databaseLogger.info(
            `projects-create: auto-tagged creator on multi-user host userId=${userId} hostId=${hostId} slug=${slug} creatorUsername=${creatorUsername}`,
          );
        } else {
          databaseLogger.warn(
            `projects-create: username lookup failed — auto-tag skipped userId=${userId} hostId=${hostId} slug=${slug}`,
          );
        }
      }
    } catch (autoTagErr) {
      // Multi-user probe failure MUST NOT block the create — fall through
      // without auto-tag. This matches Phase 129 fail-open discipline for
      // write-side gate failures (a wrongly-open project is recoverable via
      // a manual edit; a wrongly-BLOCKED create is not).
      databaseLogger.warn(
        `projects-create: isHostMultiUser probe failed — auto-tag skipped userId=${userId} hostId=${hostId} slug=${slug}: ${autoTagErr instanceof Error ? autoTagErr.message : String(autoTagErr)}`,
      );
    }

    try {
      try {
        await createProject(conn, slug, trimmed, autoTagUsers);
      } catch (err) {
        // Duplicate slug distinguisher — EEXIST or message contains "exists".
        const code = (err as NodeJS.ErrnoException).code;
        const msg = err instanceof Error ? err.message : String(err);
        if (code === "EEXIST" || /exists/i.test(msg)) {
          res.status(409).json({ error: "slug exists", slug });
          return;
        }
        // Everything else is a real 500.
        databaseLogger.error(
          `failed to create project hostId=${hostId} slug=${slug}: ${msg}`,
        );
        res.status(500).json({ error: "failed to create project" });
        return;
      }

      // 6. Post-write wire event (D-37) — rebuild the full projects list
      // for this host and hand it to the singleton registry.
      try {
        const registry = getSubscriptionRegistry();
        if (registry) {
          const current = await listProjects(conn);
          registry.publishProjectListChanged(
            enrichForWire(current, hostId, host.name ?? String(hostId)),
          );
        } else {
          // Phase 117 M8 fix (2026-09-18): getSubscriptionRegistry() returns
          // null when the singleton hasn't been initialized yet (starter.ts
          // wires it during bootstrap). In tests that's expected; in
          // production it means a request landed BEFORE the registry was
          // available — a startup-timing bug, not a silent success. Log
          // a warning so the failure is visible instead of dropping the
          // WS fanout silently.
          databaseLogger.warn(
            `project-list-changed publish skipped: subscription registry not initialized (hostId=${hostId} slug=${slug} op=create)`,
          );
        }
      } catch (publishErr) {
        // Publishing failure MUST NOT roll back the create. Log and continue.
        databaseLogger.warn(
          `project-list-changed publish failed after create hostId=${hostId} slug=${slug}: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}`,
        );
      }

      databaseLogger.info(
        `project created: userId=${userId} hostId=${hostId} slug=${slug}`,
      );
      res.json({ ok: true, slug });
      return;
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /projects/:slug/archive
// ---------------------------------------------------------------------------

router.post(
  "/:slug/archive",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. PROJECT_SLUG_RE gate BEFORE any I/O (T-117-04-02 path-traversal).
    const slug = String(req.params.slug ?? "");
    if (!slug || !PROJECT_SLUG_RE.test(slug)) {
      res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
      return;
    }

    // 2. hostId gate.
    const body = (req.body ?? {}) as { hostId?: unknown };
    const parsedHost = parseHostId(body.hostId);
    if (!parsedHost.ok) {
      res.status(400).json({ error: parsedHost.error });
      return;
    }
    const { hostId } = parsedHost;

    // 3. Host ownership gate.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // Projects live on SSH hosts — see gate on GET / for rationale.
    if (host.enableSsh === false) {
      res.status(400).json({ error: "SSH is not enabled on this host" });
      return;
    }

    // 4. LOCAL/REMOTE branch.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        res.status(504).json({ error: "Host unreachable" });
        return;
      }
    }

    try {
      try {
        await archiveProject(conn, slug);
      } catch (err) {
        databaseLogger.error(
          `failed to archive project hostId=${hostId} slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Generic-500 shape — no err.message leak (T-117-04-05).
        res.status(500).json({ error: "failed to archive project" });
        return;
      }

      // 5. Post-write wire event (D-37) — rebuild the projects list
      // (which now excludes the just-archived slug) and publish.
      try {
        const registry = getSubscriptionRegistry();
        if (registry) {
          const current = await listProjects(conn);
          registry.publishProjectListChanged(
            enrichForWire(current, hostId, host.name ?? String(hostId)),
          );
        } else {
          // Phase 117 M8 fix (2026-09-18): null-registry-at-request-time is
          // a startup-timing bug in production. Log a warning so the
          // failure is visible instead of dropping the WS fanout silently.
          databaseLogger.warn(
            `project-list-changed publish skipped: subscription registry not initialized (hostId=${hostId} slug=${slug} op=archive)`,
          );
        }
      } catch (publishErr) {
        databaseLogger.warn(
          `project-list-changed publish failed after archive hostId=${hostId} slug=${slug}: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}`,
        );
      }

      databaseLogger.info(
        `project archived: userId=${userId} hostId=${hostId} slug=${slug}`,
      );
      res.json({ ok: true });
      return;
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// GET /projects/:slug/file  →  { markdown: string }
// PUT /projects/:slug/file  body { hostId, contents }  →  { markdown: string }
// ---------------------------------------------------------------------------
//
// Byte-shape mirror of the sibling routes above: authenticateJWT + parseHostId
// + resolveHostById + LOCAL/REMOTE branch + generic-500. Underlying primitives
// are readProjectFile / writeProjectFile in identity-artifact-reader.ts.
//
// Security:
//   - PROJECT_SLUG_RE gate BEFORE any I/O (T-117-04-02 path-traversal defense —
//     `.` / `/` outside the charset).
//   - resolveHostById 404 on cross-user / unknown (T-117-04-01 EoP defense).
//   - Fixed 500 shape (T-117-04-05 info-disclosure defense).
//   - authenticateJWT on both routes (T-117-04-04 unauth flood).

router.get(
  "/:slug/file",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const slug = String(req.params.slug ?? "");
    if (!slug || !PROJECT_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
      return;
    }

    const parsed = parseHostId(req.query.hostId);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { hostId } = parsed;

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // Projects live on SSH hosts — see gate on GET / for rationale.
    if (host.enableSsh === false) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        res.status(504).json({ error: "Host unreachable" });
        return;
      }
    }

    try {
      const { markdown } = await readProjectFile(conn, slug);
      res.json({ markdown });
      return;
    } catch (err) {
      databaseLogger.error(
        `failed to read project file hostId=${hostId} slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(500).json({ error: "failed to read project file" });
      return;
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

router.put(
  "/:slug/file",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const slug = String(req.params.slug ?? "");
    if (!slug || !PROJECT_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
      return;
    }

    const body = (req.body ?? {}) as {
      hostId?: unknown;
      contents?: unknown;
    };

    const parsedHost = parseHostId(body.hostId);
    if (!parsedHost.ok) {
      res.status(400).json({ error: parsedHost.error });
      return;
    }
    const { hostId } = parsedHost;

    if (typeof body.contents !== "string") {
      res.status(400).json({ error: "contents is required" });
      return;
    }
    const contents = body.contents;

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // Projects live on SSH hosts — see gate on GET / for rationale.
    if (host.enableSsh === false) {
      res.status(400).json({ error: "SSH is not enabled on this host" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        res.status(504).json({ error: "Host unreachable" });
        return;
      }
    }

    try {
      const { markdown } = await writeProjectFile(conn, slug, contents);
      databaseLogger.info(
        `project file written: userId=${userId} hostId=${hostId} slug=${slug} bytes=${contents.length}`,
      );
      res.json({ markdown });
      return;
    } catch (err) {
      databaseLogger.error(
        `failed to write project file hostId=${hostId} slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(500).json({ error: "failed to write project file" });
      return;
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// Generic 500 fallback error handler (mirrors sibling routes).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "project-list route error" });
  },
);

export default router;
