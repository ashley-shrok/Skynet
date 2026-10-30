/**
 * Phase 117 Plan 117-04: /projects router.
 *
 * Endpoints:
 *   GET  /projects?hostId=<n>              → enumerate non-archived projects
 *   POST /projects                          → create project (backend-slugify)
 *   POST /projects/:slug/archive            → move dir into archive/
 *   POST /projects/:slug/parent             → nest under / un-nest a project
 *   GET|PUT /projects/:slug/file            → raw project.md read / write
 *
 * Semantic contract (per Phase 117 CONTEXT):
 *   - D-11:  GET /projects returns
 *            { projects: [{slug, displayName, archived, parent}] }.
 *            Nested projects: `parent` is the raw parent slug (or null);
 *            visibility inherits down the tree (filterVisibleProjectTree).
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
 * Mounted at /projects in database.ts alongside /role-skills-editor.
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
  setProjectParentField,
  projectMetaFromMarkdown,
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
// Pretty-names shape: shared backend-authoritative slug derivation
// (replaces the per-endpoint normalizeToSlug). Spells out digits so a
// user-derived slug is pure [a-z-]+ and any digit in a slug on disk is
// unambiguously a system-appended collision marker.
import { derivePrettyNameSlug } from "../../utils/pretty-name-slug.js";
// Phase 130: per-user READ-side gate. Pure function; consumes the users list
// parsed from project.md frontmatter and returns visible/hidden per caller.
// Nested projects: the gate inherits down the parent tree — a project shows
// only if it and every ancestor present on the host pass.
import {
  audienceWidens,
  effectiveProjectAudience,
  filterVisibleProjectTree,
  redactHiddenParents,
} from "../../fleet-status/project-visibility-gate.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import { bornInProjectUsers } from "../../sharing/born-in-project.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * Run a handler's SSH motion (connectOneShot + every exec/SFTP on that
 * connection + conn.end) under the shared per-host semaphore. One slot per
 * request: each handler drives its single connection serially, so a slot
 * bounds that request's channels. Local hosts touch the bind-mount with no
 * SSH channel and bypass the semaphore.
 */
function withHostSlot<T>(hostId: number, fn: () => Promise<T>): Promise<T> {
  return isLocalHostId(hostId) ? fn() : getHostSemaphore(hostId).run(fn);
}

/**
 * Per-host write lock for project-file edits that check the host's project
 * list and then write (create, move, archive, raw file save). Without it two
 * moves at once can each pass the "not into its own sub-project" check and
 * together write a loop. Held OUTSIDE withHostSlot, so lock waiters don't
 * occupy SSH slots. In-process only — every such write goes through this
 * backend.
 */
const projectWriteLocks = new Map<number, Promise<unknown>>();
function withProjectWriteLock<T>(hostId: number, fn: () => Promise<T>): Promise<T> {
  const prev = projectWriteLocks.get(hostId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  projectWriteLocks.set(hostId, tail);
  void tail.then(() => {
    if (projectWriteLocks.get(hostId) === tail) projectWriteLocks.delete(hostId);
  });
  return run;
}

/** displayName length cap — per plan behavior spec (1..80 chars). */
const DISPLAY_NAME_MAX_LEN = 80;

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
export function enrichForWire(
  projects: Array<{
    slug: string;
    displayName: string;
    users: string[] | null;
    parent: string | null;
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
  parent: string | null;
}> {
  return projects.map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    hostId: String(hostId),
    hostname,
    archived: false,
    users: p.users,
    parent: p.parent,
  }));
}

/**
 * Nested projects: true iff `candidate` is `root` or sits somewhere beneath
 * it, following `parent` links over one host's project list. Cycle-safe —
 * a repeat stops the walk.
 */
function isSelfOrDescendant(
  projects: Array<{ slug: string; parent: string | null }>,
  candidate: string,
  root: string,
): boolean {
  const parentOf = new Map(projects.map((p) => [p.slug, p.parent]));
  const seen = new Set<string>();
  let node: string | null | undefined = candidate;
  while (typeof node === "string" && !seen.has(node)) {
    if (node === root) return true;
    seen.add(node);
    node = parentOf.get(node);
  }
  return false;
}

/**
 * Every project beneath `root` over one host's raw parent links (not `root`
 * itself). A project on a loop with `root` is not beneath it — the sidebar
 * draws loop members at top level.
 */
function descendantSlugs(
  projects: Array<{ slug: string; parent: string | null }>,
  root: string,
): string[] {
  const out: string[] = [];
  for (const p of projects) {
    if (p.slug === root) continue;
    if (isSelfOrDescendant(projects, root, p.slug)) continue; // loop with root
    if (isSelfOrDescendant(projects, p.slug, root)) out.push(p.slug);
  }
  return out;
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
    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withHostSlot(hostId, async () => {
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

        const projects = redactHiddenParents(
          raw,
          filterVisibleProjectTree(raw, callerUsername),
        ).map((p) => ({
          slug: p.slug,
          displayName: p.displayName,
          archived: false,
          parent: p.parent,
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
    });
  },
);

// ---------------------------------------------------------------------------
// POST /projects
// ---------------------------------------------------------------------------

/**
 * Slugs of the projects on this host the caller can see (tree-aware, same
 * gate as GET /). The write routes treat a project hidden from the caller as
 * absent, so nesting under — or moving — a hidden project answers exactly
 * like "not found" and never reveals it exists. A failed username lookup
 * falls open, matching GET /.
 */
async function visibleSlugsForCaller(
  projects: Array<{ slug: string; parent?: string | null; users: string[] | null }>,
  userId: string,
): Promise<Set<string>> {
  let callerUsername: string | null = null;
  try {
    callerUsername = await getUsernameForUserId(userId);
  } catch (err) {
    databaseLogger.warn(
      `projects: caller username lookup threw — visibility gate open for write userId=${userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return new Set(filterVisibleProjectTree(projects, callerUsername).map((p) => p.slug));
}


router.post(
  "/",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const body = (req.body ?? {}) as {
      hostId?: unknown;
      displayName?: unknown;
      parent?: unknown;
    };

    // 1. hostId gate.
    const parsedHost = parseHostId(body.hostId);
    if (!parsedHost.ok) {
      res.status(400).json({ error: parsedHost.error });
      return;
    }
    const { hostId } = parsedHost;

    // 2. displayName gate + slug derivation via shared helper. Pure letters
    // and dashes on success; input validation (empty, too long, unslugifiable)
    // uniform across roles/identities/projects per the pretty-names shape.
    const rawDN = body.displayName;
    if (typeof rawDN !== "string") {
      res.status(400).json({ error: "displayName is required" });
      return;
    }
    const trimmed = rawDN.trim();
    const derivation = derivePrettyNameSlug(rawDN);
    if (derivation.ok !== true) {
      const errorMsg =
        derivation.reason === "empty"
          ? "displayName is required"
          : derivation.reason === "too_long"
            ? `displayName must be ${DISPLAY_NAME_MAX_LEN} characters or fewer`
            : "displayName must contain at least one letter";
      res.status(400).json({ error: errorMsg });
      return;
    }
    const baseSlug = derivation.slug;

    // 3. Optional parent (nested projects). Format-checked here; existence
    // is checked against the host's live list once connected.
    let parent: string | null = null;
    if (body.parent !== undefined && body.parent !== null) {
      if (typeof body.parent !== "string" || !PROJECT_SLUG_RE.test(body.parent)) {
        res.status(400).json({ error: "parent must match [a-z0-9-]{1,64}" });
        return;
      }
      parent = body.parent;
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
    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withProjectWriteLock(hostId, () => withHostSlot(hostId, async () => {
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
              `projects-create: auto-tagged creator on multi-user host userId=${userId} hostId=${hostId} baseSlug=${baseSlug} creatorUsername=${creatorUsername}`,
            );
          } else {
            databaseLogger.warn(
              `projects-create: username lookup failed — auto-tag skipped userId=${userId} hostId=${hostId} baseSlug=${baseSlug}`,
            );
          }
        }
      } catch (autoTagErr) {
        // Multi-user probe failure MUST NOT block the create — fall through
        // without auto-tag. This matches Phase 129 fail-open discipline for
        // write-side gate failures (a wrongly-open project is recoverable via
        // a manual edit; a wrongly-BLOCKED create is not).
        databaseLogger.warn(
          `projects-create: isHostMultiUser probe failed — auto-tag skipped userId=${userId} hostId=${hostId} baseSlug=${baseSlug}: ${autoTagErr instanceof Error ? autoTagErr.message : String(autoTagErr)}`,
        );
      }

      try {
        // Slugs some live project already names as its parent (a leftover
        // line from an archived or failed-archive parent) are taken too:
        // creating one would silently adopt that project as a sub-project.
        let existing: Awaited<ReturnType<typeof listProjects>> = [];
        try {
          existing = await listProjects(conn);
        } catch (listErr) {
          if (parent !== null) throw listErr;
          databaseLogger.warn(
            `projects-create: project list failed — parent-name check skipped hostId=${hostId} baseSlug=${baseSlug}: ${listErr instanceof Error ? listErr.message : String(listErr)}`,
          );
        }
        const namedAsParent = new Set(
          existing.map((p) => p.parent).filter((p): p is string => p !== null),
        );
        if (parent !== null) {
          const visible = await visibleSlugsForCaller(existing, userId);
          if (!existing.some((p) => p.slug === parent) || !visible.has(parent)) {
            databaseLogger.warn("projects-create: parent not found", {
              operation: "project_create_parent",
              userId,
              hostId,
              baseSlug,
              parent,
              outcome: "parent_not_found",
            });
            res.status(400).json({ error: "parent project not found" });
            return;
          }
          // Made inside a project: start shared with its people as well as
          // the creator — or with everyone when it isn't limited.
          if (autoTagUsers !== null) {
            const shared = bornInProjectUsers(existing, parent, autoTagUsers[0]);
            if (shared === "everyone") {
              autoTagUsers = null;
              databaseLogger.info("projects-create: parent isn't limited — no users list", {
                operation: "project_create_parent_open",
                hostId,
                baseSlug,
                parent,
              });
            } else if (shared !== null) {
              autoTagUsers = shared;
              databaseLogger.info("projects-create: shared with the parent's people", {
                operation: "project_create_parent_shared",
                hostId,
                baseSlug,
                parent,
                userCount: shared.length,
              });
            }
          }
        }

        // Pretty-names shape: collision auto-suffix. Try the base slug;
        // on EEXIST retry with base-2, base-3, ... up to a sanity cap.
        // Loop is race-safe because createProject's mkdir is atomic — a
        // race-loser throws EEXIST without touching the winner's file, so
        // every iteration is a fresh attempt at a distinct slug.
        const MAX_COLLISION_ATTEMPTS = 100;
        let slug = baseSlug;
        let attempt = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            if (namedAsParent.has(slug)) {
              const claimed = new Error(`slug ${slug} is named as a parent`);
              (claimed as NodeJS.ErrnoException).code = "EEXIST";
              throw claimed;
            }
            await createProject(conn, slug, trimmed, autoTagUsers, parent);
            break;
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const msg = err instanceof Error ? err.message : String(err);
            if (code === "EEXIST" || /exists/i.test(msg)) {
              attempt += 1;
              if (attempt >= MAX_COLLISION_ATTEMPTS) {
                databaseLogger.error(
                  `project create collision cap exhausted hostId=${hostId} baseSlug=${baseSlug} attempts=${attempt}`,
                );
                res
                  .status(500)
                  .json({ error: "failed to create project" });
                return;
              }
              slug = `${baseSlug}-${attempt + 1}`;
              continue;
            }
            // Non-collision error is a real 500.
            databaseLogger.error(
              `failed to create project hostId=${hostId} slug=${slug}: ${msg}`,
            );
            res.status(500).json({ error: "failed to create project" });
            return;
          }
        }

        // 6. Post-write wire event (D-37) — rebuild the full projects list
        // for this host and hand it to the singleton registry, scoped to
        // this hostId (client merges by dropping existing entries for
        // this hostId and splicing in the incoming rows).
        try {
          const registry = getSubscriptionRegistry();
          if (registry) {
            const current = await listProjects(conn);
            registry.publishProjectListChanged(
              String(hostId),
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
        `project created: userId=${userId} hostId=${hostId} slug=${slug} baseSlug=${baseSlug} parent=${parent ?? "none"}`,
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
    }));
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
    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withProjectWriteLock(hostId, () => withHostSlot(hostId, async () => {
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
        // Archive takes the whole subtree, deepest first, so by the time a
        // project itself is archived nothing should sit beneath it. If
        // something still does (most likely a sub-project the caller can't
        // see), refuse rather than strand it at top level for whoever can.
        try {
          const current = await listProjects(conn);
          const remaining = descendantSlugs(current, slug);
          if (remaining.length > 0) {
            databaseLogger.warn("project archive refused: sub-projects remain", {
              operation: "project_archive",
              userId,
              hostId,
              slug,
              remainingCount: remaining.length,
              outcome: "sub_projects_remain",
            });
            res.status(409).json({
              error: "this project still has sub-projects inside it",
            });
            return;
          }
        } catch (err) {
          databaseLogger.error(
            `failed to list projects before archive hostId=${hostId} slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
          );
          res.status(500).json({ error: "failed to archive project" });
          return;
        }

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
        // (which now excludes the just-archived slug) and publish, scoped
        // to this hostId. If the archived slug was the LAST project on
        // this host, current is [] — a legitimate per-host delta.
        try {
          const registry = getSubscriptionRegistry();
          if (registry) {
            const current = await listProjects(conn);
            registry.publishProjectListChanged(
              String(hostId),
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
    }));
  },
);

// ---------------------------------------------------------------------------
// POST /projects/:slug/parent  body { hostId, parent: string | null }
// ---------------------------------------------------------------------------
//
// Nested projects: nest a project under another on the same host, or move it
// back to top level (parent: null). A one-line edit of project.md's `parent:`
// line (setProjectParentField — line-based, every other byte preserved); the
// folder never moves, and the subtree follows because children name this
// project by slug.
//
// Guard rails:
//   - slug + parent PROJECT_SLUG_RE gates BEFORE any I/O.
//   - project must exist on the host (404), parent must exist on the host and
//     not be archived (400) — listProjects excludes archive/.
//   - parent must not be the project itself or any of its descendants (409),
//     computed over the host's current parent links, cycle-safe.

const MOVE_INTO_SELF_ERROR =
  "cannot move a project inside itself or its own sub-project";

router.post(
  "/:slug/parent",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const slug = String(req.params.slug ?? "");
    if (!slug || !PROJECT_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
      return;
    }

    const body = (req.body ?? {}) as { hostId?: unknown; parent?: unknown };
    const parsedHost = parseHostId(body.hostId);
    if (!parsedHost.ok) {
      res.status(400).json({ error: parsedHost.error });
      return;
    }
    const { hostId } = parsedHost;

    const parent: string | null =
      typeof body.parent === "string" && PROJECT_SLUG_RE.test(body.parent)
        ? body.parent
        : null;
    if (body.parent !== null && parent === null) {
      res
        .status(400)
        .json({ error: "parent must be null or match [a-z0-9-]{1,64}" });
      return;
    }

    const logCtx = {
      operation: "project_set_parent",
      userId,
      hostId,
      slug,
      parent,
    };

    if (parent === slug) {
      databaseLogger.warn("project parent rejected: self", {
        ...logCtx,
        outcome: "rejected_self",
      });
      res.status(409).json({ error: MOVE_INTO_SELF_ERROR });
      return;
    }

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

    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withProjectWriteLock(hostId, () => withHostSlot(hostId, async () => {
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
        let current: Awaited<ReturnType<typeof listProjects>>;
        try {
          current = await listProjects(conn);
        } catch (err) {
          databaseLogger.error("project parent: failed to list projects", {
            ...logCtx,
            outcome: "list_failed",
            error: err instanceof Error ? err.message : String(err),
          });
          res.status(500).json({ error: "failed to move project" });
          return;
        }

        const visible = await visibleSlugsForCaller(current, userId);
        if (!current.some((p) => p.slug === slug) || !visible.has(slug)) {
          databaseLogger.warn("project parent rejected: project not found", {
            ...logCtx,
            outcome: "project_not_found",
          });
          res.status(404).json({ error: "Project not found" });
          return;
        }

        if (parent !== null) {
          if (!current.some((p) => p.slug === parent) || !visible.has(parent)) {
            databaseLogger.warn("project parent rejected: parent not found", {
              ...logCtx,
              outcome: "parent_not_found",
            });
            res.status(400).json({ error: "parent project not found" });
            return;
          }
          if (isSelfOrDescendant(current, parent, slug)) {
            databaseLogger.warn("project parent rejected: descendant", {
              ...logCtx,
              outcome: "rejected_descendant",
            });
            res.status(409).json({ error: MOVE_INTO_SELF_ERROR });
            return;
          }
        }

        // A move never widens who can see the project (shape: a sub-project
        // can narrow its audience, never widen it). Taking it out of a
        // restricted parent, or under a less restricted one, would open it
        // — and everything beneath it — to more users; instead its current
        // audience is written into its own `users:` list in the same write.
        const before = effectiveProjectAudience(current, slug);
        const after = effectiveProjectAudience(current, slug, parent);
        const keepUsers =
          before !== null && audienceWidens(before, after) ? before : undefined;
        if (keepUsers !== undefined) {
          databaseLogger.info("project parent: audience kept on move", {
            ...logCtx,
            outcome: "audience_kept",
            userCount: keepUsers.length,
          });
        }

        try {
          if (keepUsers === undefined) {
            await setProjectParentField(conn, slug, parent);
          } else {
            await setProjectParentField(conn, slug, parent, keepUsers);
          }
        } catch (err) {
          databaseLogger.error("project parent: write failed", {
            ...logCtx,
            outcome: "write_failed",
            error: err instanceof Error ? err.message : String(err),
          });
          res.status(500).json({ error: "failed to move project" });
          return;
        }

        // Post-write wire event (D-37 mirror) — same shape as create/archive.
        // Publish failure MUST NOT roll back the write.
        try {
          const registry = getSubscriptionRegistry();
          if (registry) {
            const after = await listProjects(conn);
            registry.publishProjectListChanged(
              String(hostId),
              enrichForWire(after, hostId, host.name ?? String(hostId)),
            );
          } else {
            databaseLogger.warn(
              `project-list-changed publish skipped: subscription registry not initialized (hostId=${hostId} slug=${slug} op=set-parent)`,
            );
          }
        } catch (publishErr) {
          databaseLogger.warn(
            `project-list-changed publish failed after set-parent hostId=${hostId} slug=${slug}: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}`,
          );
        }

        databaseLogger.info("project parent set", {
          ...logCtx,
          outcome: "ok",
        });
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
    }));
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

// ---------------------------------------------------------------------------
// GET /projects/:slug/archive-preflight?hostId=<n>  →  { hiddenSubProjects }
// ---------------------------------------------------------------------------
//
// Nested projects: archiving a project archives its whole subtree, but the
// sidebar only knows the sub-projects the caller can see. This counts the
// ones beneath the project that are hidden from the caller, so the archive
// confirm can refuse up front instead of archiving part of the subtree. A
// project hidden from the caller answers "not found", like the move route.
router.get(
  "/:slug/archive-preflight",
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

    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withHostSlot(hostId, async () => {
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
        const current = await listProjects(conn);
        const visible = await visibleSlugsForCaller(current, userId);
        if (!current.some((p) => p.slug === slug) || !visible.has(slug)) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
        const hiddenSubProjects = descendantSlugs(current, slug).filter(
          (s) => !visible.has(s),
        ).length;
        databaseLogger.info("project archive preflight", {
          operation: "project_archive_preflight",
          userId,
          hostId,
          slug,
          hiddenSubProjects,
        });
        res.json({ hiddenSubProjects });
        return;
      } catch (err) {
        databaseLogger.error(
          `failed archive preflight hostId=${hostId} slug=${slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
        res.status(500).json({ error: "failed to check project" });
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
    });
  },
);

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

    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withHostSlot(hostId, async () => {
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
    });
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

    // SSH work (connect + execs + conn.end) runs under the per-host
    // semaphore (verify:ssh-cap); local hosts bypass it.
    return withProjectWriteLock(hostId, () => withHostSlot(hostId, async () => {
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
        // Nested projects: a raw save that changes the `parent:` line gets
        // the same guard rails as a move — the parent must exist, be visible
        // to the caller, and not be the project itself or one of its own
        // sub-projects (a loop could otherwise expose a restricted project).
        const nextParent = projectMetaFromMarkdown(slug, contents).parent;
        if (nextParent !== null) {
          const { markdown: prevMarkdown } = await readProjectFile(conn, slug);
          if (projectMetaFromMarkdown(slug, prevMarkdown).parent !== nextParent) {
            const current = await listProjects(conn);
            const visible = await visibleSlugsForCaller(current, userId);
            const reject = (status: number, error: string, outcome: string) => {
              databaseLogger.warn("project file parent rejected", {
                operation: "project_file_parent",
                userId,
                hostId,
                slug,
                parent: nextParent,
                outcome,
              });
              res.status(status).json({ error });
            };
            if (!current.some((p) => p.slug === nextParent) || !visible.has(nextParent)) {
              reject(400, "parent project not found", "parent_not_found");
              return;
            }
            if (isSelfOrDescendant(current, nextParent, slug)) {
              reject(409, MOVE_INTO_SELF_ERROR, "rejected_descendant");
              return;
            }
          }
        }

        const { markdown } = await writeProjectFile(conn, slug, contents);
        databaseLogger.info(
          `project file written: userId=${userId} hostId=${hostId} slug=${slug} bytes=${contents.length}`,
        );

        // Post-write wire event (D-37 mirror): a project.md edit can change
        // the displayName in the frontmatter, so the sidebar's project
        // section headers must re-render across all connected clients. Mirror
        // the POST create + POST archive publish shape verbatim so the wire
        // frame looks identical no matter which write path fired it. Publish
        // failure MUST NOT roll back the file write — log and continue.
        try {
          const registry = getSubscriptionRegistry();
          if (registry) {
            const current = await listProjects(conn);
            registry.publishProjectListChanged(
              String(hostId),
              enrichForWire(current, hostId, host.name ?? String(hostId)),
            );
          } else {
            databaseLogger.warn(
              `project-list-changed publish skipped: subscription registry not initialized (hostId=${hostId} slug=${slug} op=write-file)`,
            );
          }
        } catch (publishErr) {
          databaseLogger.warn(
            `project-list-changed publish failed after write-file hostId=${hostId} slug=${slug}: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}`,
          );
        }

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
    }));
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
