/**
 * Phase 134 Plan 134-01 (wake-ups-redesign campaign shape 2 — CRUD API):
 * POST / PATCH / DELETE /wakeups — per-host writes over the fleet's global
 * wake-up spec convention (~/fleet/wakeups/<slug>/wakeup.json).
 *
 * Endpoints:
 *   POST   /                          → CREATE (409 on slug collision)
 *   PATCH  /:slug                     → UPDATE (full-spec overwrite)
 *   PATCH  /:slug/toggle-enabled      → flip only the `enabled` field
 *   DELETE /:slug                     → hard delete + .fired sentinel cleanup
 *
 * D-01: HTTP REST endpoint style (mirrors roles-create.ts).
 * D-02: `host` param on writes — each request dispatches to exactly one host.
 * D-05: Atomic writes via writeMarkdownFileAtomic (SFTP writeFile + POSIX
 *       ext_openssh_rename REMOTE; fs.writeFile(.tmp) + fs.rename LOCAL).
 *       writeMarkdownFileAtomic is byte-agnostic despite the name — JSON body
 *       passes through unchanged (RESEARCH § Anti-patterns).
 * D-06: HARD DELETE — combined `rm -rf <dir> && rm -f <.state/<slug>.fired>`
 *       in ONE execCommand call (Pitfall #2). Orphan sentinel is a silent-
 *       fail failure mode; cleanup MUST accompany folder removal.
 * D-07: Slug derived kebab-case from spec.name via normalizeWakeupSlug; 409
 *       on collision. IDENTITY_SLUG_RE re-check as shell-safety gate before
 *       any interpolation.
 * D-08: Validation MIRRORS wakeup-scheduler.py `_load_specs_global()` at
 *       L224-248 exactly — spec is accepted iff dict-shaped, enabled !== false,
 *       has truthy `prompt` string, has truthy `schedule` object with a valid
 *       `type` (interval | daily | weekly | one_shot) and its type-specific
 *       required fields. NO additional gates (no prompt-cap, no roles-min).
 *       Drift-flavored test names are grep-banned in acceptance criteria.
 * D-16: LOCAL branch uses getLocalWakeupsRoot() for Skynet's own host.
 *
 * Security posture (STRIDE T-128-01..08):
 *   - authenticateJWT on every handler.
 *   - IDENTITY_SLUG_RE gate (/^[a-z0-9_-]{1,80}$/i) on every slug before
 *     shell interpolation. No `.` allowed → traversal structurally impossible.
 *   - resolveHostById(hostId, userId) — cross-user hosts → 404 (T-128-02).
 *   - getHostSemaphore(hostId).run(...) wraps every writer — serializes per-
 *     host writes so concurrent CREATEs on the same slug race-resolve to
 *     exactly one 201 + one 409 (T-128-05).
 *   - express.json({limit: "64kb"}) body cap — spec payloads are tiny;
 *     64kb defense-in-depth against DoS via unbounded body (T-128-04).
 *     Matches nginx client_max_body_size 64k in the paired location blocks.
 *   - writeMarkdownFileAtomic routes through ext_openssh_rename (POSIX atomic
 *     overwrite; sftp.rename cannot atomically overwrite existing target per
 *     the EEXIST → SSH2_FX_FAILURE prologue at identity-artifact-reader.ts
 *     L2547-2582). Regression test installs a throwing sftp.rename trap.
 *   - Generic 5xx error bodies ("SSH connect failed" / "SSH exec failed" /
 *     "SFTP write failed"); upstream detail goes to sshLogger only (T-128-08).
 *
 * Route mount: chained with wakeupsListRoutes at "/wakeups" in database.ts.
 * Matching nginx location blocks in BOTH docker/nginx.conf and
 * docker/nginx-https.conf (D-17 — CLAUDE.md load-bearing rule).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { sshLogger } from "../../utils/logger.js";
import { getHostSemaphore, makeSemaphore, type HostSemaphore } from "../../ssh/host-semaphore-registry.js";
import {
  writeMarkdownFileAtomic,
  normalizeWakeupSlug,
  IDENTITY_SLUG_RE,
  isLocalHostId,
  getLocalWakeupsRoot,
} from "../../claude-session/identity-artifact-reader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/** SSH exec race timeout — bounds any single exec inside a write handler. */
const SSH_EXEC_TIMEOUT_MS = 10_000;

/** Body size cap — spec payloads are small; 64kb defense-in-depth against
 *  DoS-via-unbounded-body (T-128-04). Parity with nginx client_max_body_size
 *  64k in the paired location blocks. */
const JSON_BODY_LIMIT = "64kb";

// ---------------------------------------------------------------------------
// Per-slug write mutex
// ---------------------------------------------------------------------------
//
// getHostSemaphore is a per-host SSH concurrency pool (limit=8) — NOT a mutex.
// Concurrent CREATEs on the same slug can each pass the "does this file exist?"
// probe and each proceed to atomic-write, with the second silently clobbering
// the first (Phase 128 code-review finding #1 — CREATE TOCTOU race).
//
// This registry provides a per-(hostId, slug) mutex (slot count 1) that
// serializes writers on the same slug. CREATE wraps its business logic in
// this mutex so the probe-then-write dance is transactional per-slug. UPDATE
// / DELETE / TOGGLE also opt in to close the same race window on their side
// (two concurrent UPDATEs would both write via atomic-overwrite anyway, but
// per-slug serialization keeps the read-modify-write cycle for TOGGLE
// coherent and matches CREATE's guarantee).
//
// Entries accumulate over process lifetime — one per unique (hostId, slug).
// Footprint per entry is trivial (a closure pair, ~tens of bytes). No cleanup
// path is provided.

const slugMutexRegistry = new Map<string, HostSemaphore>();

function getSlugMutex(hostId: string | number, slug: string): HostSemaphore {
  const key = `${String(hostId)}:${slug}`;
  let m = slugMutexRegistry.get(key);
  if (!m) {
    m = makeSemaphore(1);
    slugMutexRegistry.set(key, m);
  }
  return m;
}

/** Test-only: clears the per-slug mutex registry to prevent state leak
 *  between test cases. Do NOT call from production code. */
export function __resetSlugMutexRegistryForTests(): void {
  slugMutexRegistry.clear();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WakeupScheduleType = "interval" | "daily" | "weekly" | "one_shot";

/** Global wake-up spec shape — mirrors Phase 127 D-04 + wakeup-scheduler.py
 *  `_load_specs_global` acceptance criteria. */
export type GlobalWakeupSpec = {
  name: string;
  enabled?: boolean;
  prompt: string;
  schedule: {
    type: WakeupScheduleType;
    // Type-specific fields — validated by validateGlobalWakeupSpec below,
    // NOT tightened at TS type level (D-08: mirror the scheduler's runtime
    // acceptance, don't opinion-ate at compile time).
    every?: string | number;
    at?: string;
    day?: string;
    days?: unknown[];
  };
  roles?: string[];
  skills?: string[];
};

// ---------------------------------------------------------------------------
// Validation — MIRRORS wakeup-scheduler.py::_load_specs_global (D-08)
// ---------------------------------------------------------------------------

/**
 * Validate a global wake-up spec against wakeup-scheduler.py's parser at
 * substrate/scripts/wakeup-scheduler.py:224-248 exactly.
 *
 * ACCEPTS iff:
 *   - spec is a plain object (dict)
 *   - spec.enabled !== false (missing or truthy is acceptable)
 *   - spec.prompt is a truthy string
 *   - spec.schedule is a truthy object
 *   - spec.schedule.type ∈ {"interval","daily","weekly","one_shot"} AND its
 *     type-specific required fields are present (interval→`every`;
 *     daily→`at`; weekly→`day` + `at`; one_shot→`at`).
 *   - spec.name is a non-empty string (needed to derive slug — the scheduler
 *     also accepts spec-with-name-missing by falling back to basename, but
 *     our HTTP API needs a name to derive the slug from, so require it here).
 *
 * REJECTS with a per-violation error string; NULL means valid.
 *
 * DOES NOT add gates the scheduler wouldn't have (Pitfall #4 — no prompt-min-
 * length, no roles-min-count, no arbitrary field caps). Any drift-flavored
 * validation is a bug.
 */
export function validateGlobalWakeupSpec(spec: unknown): string | null {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return "spec must be a JSON object";
  }
  const s = spec as Record<string, unknown>;
  if (typeof s.name !== "string" || s.name.length === 0) {
    return "spec.name must be a non-empty string";
  }
  if (typeof s.prompt !== "string" || s.prompt.length === 0) {
    return "spec.prompt must be a non-empty string";
  }
  const sched = s.schedule;
  if (sched === null || typeof sched !== "object" || Array.isArray(sched)) {
    return "spec.schedule must be an object";
  }
  const sc = sched as Record<string, unknown>;
  const t = sc.type;
  if (t !== "interval" && t !== "daily" && t !== "weekly" && t !== "one_shot") {
    return "spec.schedule.type must be one of interval, daily, weekly, one_shot";
  }
  if (t === "interval") {
    if (
      sc.every === undefined ||
      (typeof sc.every !== "string" && typeof sc.every !== "number")
    ) {
      return "spec.schedule.every is required for interval schedules";
    }
  } else if (t === "daily") {
    if (typeof sc.at !== "string" || sc.at.length === 0) {
      return "spec.schedule.at is required for daily schedules";
    }
  } else if (t === "weekly") {
    if (typeof sc.day !== "string" || sc.day.length === 0) {
      return "spec.schedule.day is required for weekly schedules";
    }
    if (typeof sc.at !== "string" || sc.at.length === 0) {
      return "spec.schedule.at is required for weekly schedules";
    }
  } else if (t === "one_shot") {
    if (typeof sc.at !== "string" || sc.at.length === 0) {
      return "spec.schedule.at is required for one_shot schedules";
    }
  }
  // enabled is optional; when present it must be boolean (else scheduler's
  // `spec.get("enabled", True) != False` treats any truthy → true).
  if (s.enabled !== undefined && typeof s.enabled !== "boolean") {
    return "spec.enabled must be a boolean when present";
  }
  // roles + skills are pass-through per D-04+D-08 — if present, must be
  // arrays of strings (structural gate; content is not opined on).
  if (s.roles !== undefined) {
    if (!Array.isArray(s.roles) || s.roles.some((r) => typeof r !== "string")) {
      return "spec.roles must be an array of strings when present";
    }
  }
  if (s.skills !== undefined) {
    if (!Array.isArray(s.skills) || s.skills.some((r) => typeof r !== "string")) {
      return "spec.skills must be an array of strings when present";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execWithTimeout(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  command: string,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`SSH exec timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/** Parse + validate hostId from the JSON body. Returns null + writes response
 *  when invalid; returns the hostId when good. */
function requirePositiveIntegerHost(
  body: unknown,
  res: Response,
): number | null {
  if (body === null || typeof body !== "object") {
    res.status(400).json({ error: "body must be a JSON object" });
    return null;
  }
  const b = body as Record<string, unknown>;
  const rawHost = b.host;
  if (
    typeof rawHost !== "number" ||
    !Number.isInteger(rawHost) ||
    rawHost <= 0
  ) {
    res.status(400).json({ error: "host must be a positive integer" });
    return null;
  }
  return rawHost;
}

/** Absolute local path for a slug's wakeup.json file. LOCAL branch. */
function localSpecPath(slug: string): string {
  return path.join(getLocalWakeupsRoot(), slug, "wakeup.json");
}

/** Absolute local path for a slug's .fired sentinel. LOCAL branch. */
function localSentinelPath(slug: string): string {
  return path.join(getLocalWakeupsRoot(), ".state", `${slug}.fired`);
}

// ---------------------------------------------------------------------------
// POST /wakeups — CREATE
// ---------------------------------------------------------------------------

router.post(
  "/",
  express.json({ limit: JSON_BODY_LIMIT }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const hostId = requirePositiveIntegerHost(req.body, res);
    if (hostId === null) return;
    const spec = (req.body as { spec?: unknown }).spec;
    const validationError = validateGlobalWakeupSpec(spec);
    if (validationError !== null) {
      res.status(400).json({ error: validationError });
      return;
    }
    const validSpec = spec as GlobalWakeupSpec;

    const slug = normalizeWakeupSlug(validSpec.name);
    if (!slug || !IDENTITY_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "name normalizes to empty or invalid slug" });
      return;
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    let responded = false;
    try {
      // Outer: per-slug mutex — serializes CREATEs on the same (hostId, slug)
      // so probe-then-write is transactional per-slug (code-review fix #1).
      // Inner: per-host SSH semaphore — caps concurrent channels per host.
      // Different-slug CREATEs on the same host still run in parallel (up to
      // getHostSemaphore's slot count); same-slug CREATEs serialize.
      await getSlugMutex(hostId, slug).run(async () => {
      await getHostSemaphore(hostId).run(async () => {
        // ─── LOCAL branch ───────────────────────────────────────────────
        if (isLocalHostId(hostId)) {
          const targetPath = localSpecPath(slug);
          const dir = path.dirname(targetPath);
          // Clobber probe — LOCAL. fs.access resolves iff file exists.
          try {
            await fs.access(targetPath);
            res.status(409).json({ error: "wakeup with this name already exists" });
            responded = true;
            return;
          } catch {
            // ENOENT — good, continue.
          }
          try {
            await fs.mkdir(dir, { recursive: true });
            const body = JSON.stringify(validSpec, null, 2) + "\n";
            // writeMarkdownFileAtomic is byte-agnostic despite the name —
            // JSON body passes through unchanged (RESEARCH § Anti-patterns).
            await writeMarkdownFileAtomic(null, targetPath, body);
          } catch (err) {
            sshLogger.error(
              "wakeups-create: local write failed",
              err instanceof Error ? err : new Error(String(err)),
              { operation: "wakeups_create_local_write", hostId, slug, targetPath },
            );
            res.status(502).json({ error: "SFTP write failed" });
            responded = true;
            return;
          }
          res.status(201).json({ slug, host: hostId, spec: validSpec });
          responded = true;
          return;
        }

        // ─── REMOTE branch ──────────────────────────────────────────────
        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch (err) {
          sshLogger.warn("wakeups-create: SSH connect failed", {
            operation: "wakeups_create_connect",
            hostId,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH connect failed" });
          responded = true;
          return;
        }

        // Clobber probe. Slug is IDENTITY_SLUG_RE-validated → shell-safe.
        let probe: string;
        try {
          probe = (
            await execWithTimeout(
              conn,
              `[ -e "$HOME/fleet/wakeups/${slug}/wakeup.json" ] && echo EXISTS || echo OK`,
            )
          ).trim();
        } catch (err) {
          sshLogger.warn("wakeups-create: existence probe exec failed", {
            operation: "wakeups_create_exists_probe",
            hostId,
            slug,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH exec failed" });
          responded = true;
          return;
        }
        if (probe === "EXISTS") {
          res.status(409).json({ error: "wakeup with this name already exists" });
          responded = true;
          return;
        }

        try {
          await execWithTimeout(
            conn,
            `mkdir -p "$HOME/fleet/wakeups/${slug}"`,
          );
        } catch (err) {
          sshLogger.warn("wakeups-create: mkdir exec failed", {
            operation: "wakeups_create_mkdir",
            hostId,
            slug,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH exec failed" });
          responded = true;
          return;
        }

        const targetPath = `$HOME/fleet/wakeups/${slug}/wakeup.json`;
        const body = JSON.stringify(validSpec, null, 2) + "\n";
        try {
          // writeMarkdownFileAtomic is byte-agnostic despite the name —
          // JSON body passes through unchanged (RESEARCH § Anti-patterns).
          // Uses SFTP writeFile(.tmp) + ext_openssh_rename (POSIX atomic
          // overwrite — sftp.rename cannot atomically overwrite existing
          // target; see prologue at identity-artifact-reader.ts L2547-2582).
          await writeMarkdownFileAtomic(conn, targetPath, body);
        } catch (err) {
          sshLogger.error(
            "wakeups-create: SFTP write failed",
            err instanceof Error ? err : new Error(String(err)),
            {
              operation: "wakeups_create_sftp_write",
              hostId,
              slug,
              targetPath,
            },
          );
          res.status(502).json({ error: "SFTP write failed" });
          responded = true;
          return;
        }

        res.status(201).json({ slug, host: hostId, spec: validSpec });
        responded = true;
      });
      });
    } catch (err) {
      if (!responded) {
        sshLogger.error(
          "wakeups-create: unhandled error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "wakeups_create_unhandled", hostId, slug },
        );
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /wakeups/:slug — UPDATE (full-spec overwrite)
// ---------------------------------------------------------------------------

router.patch(
  "/:slug",
  express.json({ limit: JSON_BODY_LIMIT }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    // Skip subpath — /toggle-enabled handled by its own route below.
    if (req.path.endsWith("/toggle-enabled")) {
      // Should never reach here — Express matches most-specific first, but
      // defense-in-depth: return 404 instead of misrouting.
      res.status(404).json({ error: "not found" });
      return;
    }

    const userId = (req as AuthenticatedRequest).userId;
    const slug = String(req.params.slug ?? "");
    if (!slug || !IDENTITY_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "invalid slug" });
      return;
    }

    const hostId = requirePositiveIntegerHost(req.body, res);
    if (hostId === null) return;
    const spec = (req.body as { spec?: unknown }).spec;
    const validationError = validateGlobalWakeupSpec(spec);
    if (validationError !== null) {
      res.status(400).json({ error: validationError });
      return;
    }
    const validSpec = spec as GlobalWakeupSpec;

    // Code-review fix #4: URL slug and body spec.name must agree. Without
    // this gate, PATCH /wakeups/morning-digest with {name: "Evening Review"}
    // would leave folder `morning-digest/` containing `name: "Evening Review"`
    // — LIST shows one thing, scheduler's spawn-request uses the other.
    // Renames must go through DELETE + CREATE, not silent rename-via-PATCH.
    const nameSlug = normalizeWakeupSlug(validSpec.name);
    if (nameSlug !== slug) {
      res.status(400).json({
        error:
          "spec.name normalizes to a different slug than the URL — renames must go through DELETE + CREATE",
      });
      return;
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    let responded = false;
    try {
      // Per-slug mutex (fix #1) — serializes writers on same (hostId, slug).
      await getSlugMutex(hostId, slug).run(async () => {
      await getHostSemaphore(hostId).run(async () => {
        const body = JSON.stringify(validSpec, null, 2) + "\n";

        if (isLocalHostId(hostId)) {
          const targetPath = localSpecPath(slug);
          try {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await writeMarkdownFileAtomic(null, targetPath, body);
          } catch (err) {
            sshLogger.error(
              "wakeups-update: local write failed",
              err instanceof Error ? err : new Error(String(err)),
              { operation: "wakeups_update_local_write", hostId, slug, targetPath },
            );
            res.status(502).json({ error: "SFTP write failed" });
            responded = true;
            return;
          }
          res.status(200).json({ slug, host: hostId, spec: validSpec });
          responded = true;
          return;
        }

        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch (err) {
          sshLogger.warn("wakeups-update: SSH connect failed", {
            operation: "wakeups_update_connect",
            hostId,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH connect failed" });
          responded = true;
          return;
        }

        try {
          await execWithTimeout(
            conn,
            `mkdir -p "$HOME/fleet/wakeups/${slug}"`,
          );
        } catch (err) {
          sshLogger.warn("wakeups-update: mkdir exec failed", {
            operation: "wakeups_update_mkdir",
            hostId,
            slug,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH exec failed" });
          responded = true;
          return;
        }

        const targetPath = `$HOME/fleet/wakeups/${slug}/wakeup.json`;
        try {
          // writeMarkdownFileAtomic is byte-agnostic despite the name —
          // JSON body passes through unchanged (RESEARCH § Anti-patterns).
          await writeMarkdownFileAtomic(conn, targetPath, body);
        } catch (err) {
          sshLogger.error(
            "wakeups-update: SFTP write failed",
            err instanceof Error ? err : new Error(String(err)),
            { operation: "wakeups_update_sftp_write", hostId, slug, targetPath },
          );
          res.status(502).json({ error: "SFTP write failed" });
          responded = true;
          return;
        }

        res.status(200).json({ slug, host: hostId, spec: validSpec });
        responded = true;
      });
      });
    } catch (err) {
      if (!responded) {
        sshLogger.error(
          "wakeups-update: unhandled error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "wakeups_update_unhandled", hostId, slug },
        );
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /wakeups/:slug/toggle-enabled — flip enabled bit only
// ---------------------------------------------------------------------------

router.patch(
  "/:slug/toggle-enabled",
  express.json({ limit: JSON_BODY_LIMIT }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const slug = String(req.params.slug ?? "");
    if (!slug || !IDENTITY_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "invalid slug" });
      return;
    }

    const hostId = requirePositiveIntegerHost(req.body, res);
    if (hostId === null) return;
    const rawEnabled = (req.body as { enabled?: unknown }).enabled;
    if (typeof rawEnabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }
    const enabled = rawEnabled;

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    let responded = false;
    try {
      // Per-slug mutex (fix #1) — serializes writers on same (hostId, slug).
      // TOGGLE reads-then-writes the spec, so the mutex also closes the
      // read-modify-write race window against concurrent UPDATE.
      await getSlugMutex(hostId, slug).run(async () => {
      await getHostSemaphore(hostId).run(async () => {
        // ─── LOCAL branch ───────────────────────────────────────────────
        if (isLocalHostId(hostId)) {
          const targetPath = localSpecPath(slug);
          let raw: string;
          try {
            raw = await fs.readFile(targetPath, "utf-8");
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              res.status(404).json({ error: "wakeup not found" });
              responded = true;
              return;
            }
            sshLogger.error(
              "wakeups-toggle: local read failed",
              err instanceof Error ? err : new Error(String(err)),
              { operation: "wakeups_toggle_local_read", hostId, slug, targetPath },
            );
            res.status(502).json({ error: "SFTP write failed" });
            responded = true;
            return;
          }
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch (err) {
            sshLogger.error(
              "wakeups-toggle: local parse failed",
              err instanceof Error ? err : new Error(String(err)),
              { operation: "wakeups_toggle_local_parse", hostId, slug },
            );
            res.status(502).json({ error: "SFTP write failed" });
            responded = true;
            return;
          }
          parsed.enabled = enabled;
          const body = JSON.stringify(parsed, null, 2) + "\n";
          try {
            await writeMarkdownFileAtomic(null, targetPath, body);
          } catch (err) {
            sshLogger.error(
              "wakeups-toggle: local write failed",
              err instanceof Error ? err : new Error(String(err)),
              { operation: "wakeups_toggle_local_write", hostId, slug, targetPath },
            );
            res.status(502).json({ error: "SFTP write failed" });
            responded = true;
            return;
          }
          res.status(200).json({ slug, host: hostId, enabled });
          responded = true;
          return;
        }

        // ─── REMOTE branch ──────────────────────────────────────────────
        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch (err) {
          sshLogger.warn("wakeups-toggle: SSH connect failed", {
            operation: "wakeups_toggle_connect",
            hostId,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH connect failed" });
          responded = true;
          return;
        }

        // Probe existence + read the current spec in one exec.
        let stdout: string;
        try {
          stdout = await execWithTimeout(
            conn,
            `cat "$HOME/fleet/wakeups/${slug}/wakeup.json" 2>/dev/null || echo "__WAKEUP_MISSING__"`,
          );
        } catch (err) {
          sshLogger.warn("wakeups-toggle: read exec failed", {
            operation: "wakeups_toggle_read",
            hostId,
            slug,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH exec failed" });
          responded = true;
          return;
        }
        if (stdout.trim() === "__WAKEUP_MISSING__" || stdout.trim() === "") {
          res.status(404).json({ error: "wakeup not found" });
          responded = true;
          return;
        }
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(stdout) as Record<string, unknown>;
        } catch (err) {
          sshLogger.error(
            "wakeups-toggle: remote parse failed",
            err instanceof Error ? err : new Error(String(err)),
            { operation: "wakeups_toggle_remote_parse", hostId, slug },
          );
          res.status(502).json({ error: "SFTP write failed" });
          responded = true;
          return;
        }
        parsed.enabled = enabled;
        const body = JSON.stringify(parsed, null, 2) + "\n";
        const targetPath = `$HOME/fleet/wakeups/${slug}/wakeup.json`;
        try {
          await writeMarkdownFileAtomic(conn, targetPath, body);
        } catch (err) {
          sshLogger.error(
            "wakeups-toggle: SFTP write failed",
            err instanceof Error ? err : new Error(String(err)),
            { operation: "wakeups_toggle_sftp_write", hostId, slug, targetPath },
          );
          res.status(502).json({ error: "SFTP write failed" });
          responded = true;
          return;
        }
        res.status(200).json({ slug, host: hostId, enabled });
        responded = true;
      });
      });
    } catch (err) {
      if (!responded) {
        sshLogger.error(
          "wakeups-toggle: unhandled error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "wakeups_toggle_unhandled", hostId, slug },
        );
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /wakeups/:slug — HARD DELETE + .fired sentinel cleanup (D-06)
// ---------------------------------------------------------------------------

router.delete(
  "/:slug",
  express.json({ limit: JSON_BODY_LIMIT }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const slug = String(req.params.slug ?? "");
    if (!slug || !IDENTITY_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "invalid slug" });
      return;
    }

    const hostId = requirePositiveIntegerHost(req.body, res);
    if (hostId === null) return;

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    let responded = false;
    try {
      // Per-slug mutex (fix #1) — serializes writers on same (hostId, slug).
      await getSlugMutex(hostId, slug).run(async () => {
      await getHostSemaphore(hostId).run(async () => {
        // ─── LOCAL branch ───────────────────────────────────────────────
        if (isLocalHostId(hostId)) {
          const wakeupsRoot = getLocalWakeupsRoot();
          const dir = path.join(wakeupsRoot, slug);
          const sentinel = localSentinelPath(slug);
          try {
            await fs.rm(dir, { recursive: true, force: true });
          } catch (err) {
            sshLogger.error(
              "wakeups-delete: local rm failed",
              err instanceof Error ? err : new Error(String(err)),
              { operation: "wakeups_delete_local_rm", hostId, slug, dir },
            );
            res.status(502).json({ error: "SFTP write failed" });
            responded = true;
            return;
          }
          // Best-effort sentinel cleanup — never throws (D-06 idempotence).
          await fs.unlink(sentinel).catch(() => {});
          res.status(204).end();
          responded = true;
          return;
        }

        // ─── REMOTE branch ──────────────────────────────────────────────
        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch (err) {
          sshLogger.warn("wakeups-delete: SSH connect failed", {
            operation: "wakeups_delete_connect",
            hostId,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH connect failed" });
          responded = true;
          return;
        }

        // D-06 + Pitfall #2: ONE exec, combined rmdir + sentinel cleanup.
        // An orphaned .fired sentinel would inherit "already fired" state
        // onto any future wake-up that happens to get the same slug.
        // Slug is IDENTITY_SLUG_RE-validated → shell-safe interpolation.
        try {
          await execWithTimeout(
            conn,
            `rm -rf "$HOME/fleet/wakeups/${slug}" && rm -f "$HOME/fleet/wakeups/.state/${slug}.fired"`,
          );
        } catch (err) {
          sshLogger.error(
            "wakeups-delete: rm exec failed",
            err instanceof Error ? err : new Error(String(err)),
            { operation: "wakeups_delete_rm", hostId, slug },
          );
          res.status(502).json({ error: "SSH exec failed" });
          responded = true;
          return;
        }
        res.status(204).end();
        responded = true;
      });
      });
    } catch (err) {
      if (!responded) {
        sshLogger.error(
          "wakeups-delete: unhandled error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "wakeups_delete_unhandled", hostId, slug },
        );
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// Trailing catch-all error middleware — mirrors roles-list-for-host.ts:281-297.
// Never leaks upstream detail into the response body (T-128-08).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("wakeups-write: unhandled error", {
      operation: "wakeups_write_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
