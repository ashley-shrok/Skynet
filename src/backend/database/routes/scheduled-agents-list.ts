/**
 * Phase 134 Plan 134-01 (wake-ups-redesign campaign shape 2 — CRUD API):
 * GET /scheduled-agents — fleet-wide LIST of scheduled-agent specs.
 *
 * D-01: HTTP REST endpoint style (mirrors roles-*.ts + conversation-search.ts).
 * D-02: Fleet-wide sweep on list — this endpoint enumerates every managed host's
 *       ~/fleet/scheduled-agents/<slug>/scheduled-agent.json in one aggregated response. Each item
 *       carries {slug, host, hostId, name, enabled, schedule, scheduleHuman,
 *       prompt, roles[], skills[]}.
 * D-03: Thin API — files on disk are the source of truth. No SQLite shadow.
 * D-15: SSH fan-out pattern reused from conversation-search.ts:576-622 (per-host
 *       timeout + graceful degradation) + delimiter-batched cat from
 *       identity-artifact-reader.ts readIdentityWakeups L1486-1533.
 * D-16: skynet's own host is included in the fan-out via the LOCAL branch
 *       (isLocalHostId → getLocalScheduledAgentsRoot + fs/promises).
 *
 * Security posture (STRIDE T-128-02 / T-128-03 / T-128-08):
 *   - authenticateJWT gates the route.
 *   - Host projection scoped by userId + enableSsh + autoTmux — cross-user
 *     hosts filtered out at the DB projection stage before fan-out.
 *   - Per-host Promise.race([work, timeout(15s)]) + .catch(() => []) ensures
 *     one slow/down host contributes empty rows, does NOT stall the whole
 *     response (T-128-03 DoS mitigation).
 *   - No SSH stderr leaked into response body — 500 fallback returns
 *     generic {error: "internal"} (T-128-08).
 *   - Poisoned JSON on one entry is skipped via sshLogger.warn; one bad file
 *     never poisons the aggregate for that host.
 *
 * Route mount: app.use("/scheduled-agents", scheduledAgentsListRoutes) chained with
 * scheduledAgentsWriteRoutes at the same base path (Phase 134 D-17 — matching nginx
 * location blocks in BOTH docker/nginx.conf AND docker/nginx-https.conf).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { sshLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  humanizeWakeupSchedule,
  isLocalHostId,
  getLocalScheduledAgentsRoot,
  IDENTITY_SLUG_RE,
} from "../../claude-session/identity-artifact-reader.js";
// Per-user READ-side gate. Pure function; consumes the users list parsed from
// scheduled-agent.json and returns visible/hidden per caller. Kept file-parallel
// with project-visibility-gate.ts + app-visibility-gate.ts so a grep for
// isScheduledAgentVisibleToUser answers "did we gate every emit site?".
import { isScheduledAgentVisibleToUser } from "../../fleet-status/scheduled-agent-visibility-gate.js";
// Resolves the JWT userId to a case-preserved Skynet username so the D-3
// gate has the caller's identity for the case-sensitive match. Mirrors
// project-list.ts + conversation-search.ts pattern.
import { getUsernameForUserId } from "../../utils/host-user-counter.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Per-host bounded read timeout — one slow host contributes [] rather than
 *  stalling the entire fleet response. Mirrors conversation-search.ts fan-out
 *  discipline; 15s gives ~10x headroom over a healthy host read (< 500ms
 *  typical) per Assumption A2. */
const PER_HOST_TIMEOUT_MS = 15_000;

/** SSH exec race timeout — bounds a single exec inside the per-host window. */
const SSH_EXEC_TIMEOUT_MS = 10_000;

/** Shape of a single scheduled-agent row in the aggregated LIST response.
 *  Distinct from the per-identity `Wakeup` type in identity-artifact-reader.ts
 *  (which uses `instruction` — per-identity wake-ups fire an instruction into
 *  a running identity, whereas a scheduled agent spawns a new identity on
 *  firing). Scheduled-agent specs carry `prompt`, `roles[]`, and `skills[]`
 *  per Phase 127 D-04 + shape-3 modal renderer. */
export type ScheduledAgentListItem = {
  slug: string;
  host: string;
  hostId: number;
  name: string;
  enabled: boolean;
  schedule: unknown;
  scheduleHuman: string;
  prompt: string;
  roles: string[];
  skills: string[];
  /**
   * Per-user visibility gate list. Mirrors the `users` field on projects +
   * apps + identity/role frontmatter. GATE-ONLY — this field MUST be
   * stripped from every row before the response body is emitted (see the
   * `.map` seam in the GET / handler). It carries data through the
   * fan-out so `isScheduledAgentVisibleToUser` can filter each row, then
   * is stripped. A leak here is the exact class of failure the field
   * exists to prevent (network-trace enumeration of hidden agents).
   */
  users: string[] | null;
};

/**
 * Race an SSH exec against a timeout so a hung remote can't stall a per-host
 * read past the outer per-host timeout window. Mirrors
 * roles-list-for-host.ts:88-102 execWithTimeout.
 */
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

/**
 * Parse a spec object (JSON-loaded from scheduled-agent.json) into a ScheduledAgentListItem
 * row for the aggregated response. Non-string / non-array fields fall back to
 * safe defaults (name→slug, roles→[], skills→[]). Called from both LOCAL and
 * REMOTE branches so shape normalization lives in one place.
 */
function specToRow(
  spec: Record<string, unknown>,
  slug: string,
  hostName: string,
  hostId: number,
): ScheduledAgentListItem {
  // Per-user gate list. Only accept if it's an array of strings; anything
  // else (missing / non-array / non-string entries) coerces to null =
  // "no gate" (D-3 falls-open). Matches app-frame-filter parser lenience
  // for the same field on apps.
  const rawUsers = spec.users;
  const users: string[] | null =
    Array.isArray(rawUsers) && rawUsers.every((u) => typeof u === "string")
      ? (rawUsers as string[])
      : null;

  return {
    slug,
    host: hostName,
    hostId,
    name: typeof spec.name === "string" ? spec.name : slug,
    enabled: typeof spec.enabled === "boolean" ? spec.enabled : true,
    schedule: spec.schedule ?? null,
    scheduleHuman: humanizeWakeupSchedule(spec.schedule),
    prompt: typeof spec.prompt === "string" ? spec.prompt : "",
    roles: Array.isArray(spec.roles) ? (spec.roles as string[]) : [],
    skills: Array.isArray(spec.skills) ? (spec.skills as string[]) : [],
    users,
  };
}

/**
 * LOCAL branch — read ~/fleet/scheduled-agents/<slug>/scheduled-agent.json via fs/promises
 * against the container bind mount (D-16). Silent-empty on ENOENT (host has
 * never had a scheduled-agent spec written). Poisoned JSON entries are skipped via
 * sshLogger.warn; one bad file must not poison the aggregate.
 */
async function readScheduledAgentsLocal(
  hostId: number,
  hostName: string,
): Promise<ScheduledAgentListItem[]> {
  const scheduledAgentsDir = getLocalScheduledAgentsRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(scheduledAgentsDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    sshLogger.warn("scheduled-agents-list: local readdir failed", {
      operation: "scheduled_agents_list_local_readdir",
      hostId,
      hostName,
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
  const out: ScheduledAgentListItem[] = [];
  for (const slug of entries) {
    if (slug === ".state" || slug.startsWith(".")) continue;
    // Code-review fix #6: defense-in-depth against a hand-edited garbage
    // slug on disk (e.g. `~/fleet/scheduled-agents/foo bar/`). LIST would otherwise
    // surface it as `{slug: "foo bar", ...}` and the shape-3 UI's
    // DELETE /scheduled-agents/${slug} URL construction would 400 from the slug
    // regex on the write side. Skip garbage slugs with a warning.
    if (!IDENTITY_SLUG_RE.test(slug)) {
      sshLogger.warn("scheduled-agents-list: local skipping non-conforming slug", {
        operation: "scheduled_agents_list_local_slug_skip",
        hostId,
        hostName,
        slug,
      });
      continue;
    }
    const specPath = path.join(scheduledAgentsDir, slug, "scheduled-agent.json");
    let raw: string;
    try {
      raw = await fs.readFile(specPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      sshLogger.warn("scheduled-agents-list: local readFile failed", {
        operation: "scheduled_agents_list_local_read",
        hostId,
        hostName,
        slug,
        error: err instanceof Error ? err.message : "unknown",
      });
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      out.push(specToRow(parsed, slug, hostName, hostId));
    } catch (err) {
      sshLogger.warn("scheduled-agents-list: local parse error", {
        operation: "scheduled_agents_list_local_parse_error",
        hostId,
        hostName,
        slug,
        error: err instanceof Error ? err.message : "unknown",
      });
      // Skip poisoned entry.
    }
  }
  return out;
}

/**
 * REMOTE branch — one SSH round-trip via the delimiter one-liner adapted from
 * identity-artifact-reader.ts readIdentityWakeups L1486-1533. Nested layout
 * differs from per-identity's flat wakeups/<file>.json: scheduled-agent specs
 * live at scheduled-agents/<slug>/scheduled-agent.json, so the loop iterates
 * directories (`for d in <star-slash>; do`) and cats the nested spec file.
 * Empty dir + missing dir both yield empty stdout (cd 2>/dev/null && ...
 * short-circuits cleanly).
 */
async function readScheduledAgentsRemote(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  hostId: number,
  hostName: string,
): Promise<ScheduledAgentListItem[]> {
  // Code-review fix #5: `shopt -s nullglob` prevents the shell from
  // keeping `*/` as a literal when the scheduled-agents dir exists but is empty.
  // Without nullglob, the loop would run once with d="*/" and echo a
  // spurious `===SLUG:*===` chunk; the parser drops it via the
  // !slug || !jsonContent guard below, but that's parser-side defense.
  // Making the shell one-liner correct in isolation is preferable.
  const cmd =
    `cd "$HOME/fleet/scheduled-agents" 2>/dev/null && ` +
    'shopt -s nullglob; ' +
    'for d in */; do slug="${d%/}"; echo "===SLUG:${slug}==="; cat "$d/scheduled-agent.json" 2>/dev/null; done';
  let stdout: string;
  try {
    stdout = await execWithTimeout(conn, cmd);
  } catch (err) {
    sshLogger.debug("scheduled-agents-list: remote exec failed", {
      operation: "scheduled_agents_list_remote_exec",
      hostId,
      hostName,
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
  if (!stdout) return [];

  const chunks = stdout.split("===SLUG:");
  const out: ScheduledAgentListItem[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const sepIdx = chunk.indexOf("===");
    if (sepIdx === -1) continue;
    const slug = chunk.slice(0, sepIdx).trim();
    const jsonContent = chunk.slice(sepIdx + 3).trim();
    if (!slug || !jsonContent) continue;
    // Code-review fix #6: defense-in-depth against a hand-edited garbage
    // slug on the remote host. See LOCAL branch comment above.
    if (!IDENTITY_SLUG_RE.test(slug)) {
      sshLogger.warn("scheduled-agents-list: remote skipping non-conforming slug", {
        operation: "scheduled_agents_list_remote_slug_skip",
        hostId,
        hostName,
        slug,
      });
      continue;
    }
    try {
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;
      out.push(specToRow(parsed, slug, hostName, hostId));
    } catch (err) {
      sshLogger.warn("scheduled-agents-list: remote parse error", {
        operation: "scheduled_agents_list_remote_parse_error",
        hostId,
        hostName,
        slug,
        error: err instanceof Error ? err.message : "unknown",
      });
      // Skip poisoned entry — one bad file must not poison the aggregate.
    }
  }
  return out;
}

/**
 * GET /scheduled-agents — fleet-wide aggregated LIST.
 * Responds 200 with {items: ScheduledAgentListItem[]}.
 */
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Host candidate projection scoped by userId + enableSsh + autoTmux.
    //    Mirror conversation-search.ts:542-563. Cross-user hosts filtered out
    //    HERE, at the Drizzle projection — not per host inside the fan-out.
    let candidates: Array<Record<string, unknown>>;
    try {
      const rows = (await SimpleDBOps.select(
        db.select().from(hosts).where(eq(hosts.userId, userId)),
        "ssh_data",
        userId,
      )) as Array<Record<string, unknown>>;
      candidates = rows.filter((h) => {
        if (!h.enableSsh) return false;
        let cfg: Record<string, unknown> = {};
        if (typeof h.terminalConfig === "string" && h.terminalConfig) {
          try {
            cfg = JSON.parse(h.terminalConfig as string);
          } catch {
            /* ignore */
          }
        } else if (h.terminalConfig && typeof h.terminalConfig === "object") {
          cfg = h.terminalConfig as Record<string, unknown>;
        }
        return cfg.autoTmux !== false;
      });
    } catch (e) {
      sshLogger.debug("scheduled-agents-list: host projection failed", {
        operation: "scheduled_agents_list_host_projection_failed",
        userId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return res.status(500).json({ error: "host_projection_failed" });
    }

    // 2. Fan out per host with per-host timeout + graceful degradation.
    //    One slow/down host contributes [] to the flat aggregate rather than
    //    poisoning the whole response (T-128-03).
    const perHost = await Promise.all(
      candidates.map(async (h): Promise<ScheduledAgentListItem[]> => {
        const hostId = h.id as number;
        const hostName = ((h.name as string) || (h.ip as string) || "") as string;
        try {
          const resolved = await resolveHostById(hostId, userId);
          if (!resolved) return [];

          // LOCAL branch — Skynet's own host reads via the container bind
          // mount, not loopback SSH (D-16).
          if (isLocalHostId(hostId)) {
            return await Promise.race<ScheduledAgentListItem[]>([
              readScheduledAgentsLocal(hostId, hostName),
              new Promise<ScheduledAgentListItem[]>((_, reject) =>
                setTimeout(
                  () => reject(new Error("per_host_timeout")),
                  PER_HOST_TIMEOUT_MS,
                ),
              ),
            ]);
          }

          // REMOTE branch — one SSH round-trip via delimiter one-liner.
          const conn = await connectOneShot(
            resolved as unknown as Parameters<typeof connectOneShot>[0],
            CONNECT_TIMEOUT_MS,
          );
          try {
            return await Promise.race<ScheduledAgentListItem[]>([
              readScheduledAgentsRemote(conn, hostId, hostName),
              new Promise<ScheduledAgentListItem[]>((_, reject) =>
                setTimeout(
                  () => reject(new Error("per_host_timeout")),
                  PER_HOST_TIMEOUT_MS,
                ),
              ),
            ]);
          } finally {
            try {
              (conn as { end?: () => void }).end?.();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          sshLogger.debug("scheduled-agents-list: host skipped", {
            operation: "scheduled_agents_list_host_skip",
            hostId,
            hostName,
            error: e instanceof Error ? e.message : "unknown",
          });
          return [];
        }
      }),
    );

    // Per-user visibility gate. Resolve caller's Skynet username, drop any
    // row the caller isn't gated to see, then STRIP the users field before
    // emit. Mirrors project-list.ts + app-frame-filter's strip discipline:
    // the `users` list is gate-only and MUST NOT reach the wire (no
    // evidence of hidden rows in a network trace).
    //
    // Fail-OPEN on username-lookup failure — a null callerUsername is an
    // infra bug, not a gate signal; treating it as "hide everything" would
    // empty every user's scheduled-agents list on the affected code path.
    let callerUsername: string | null = null;
    try {
      callerUsername = await getUsernameForUserId(userId);
    } catch (usernameErr) {
      sshLogger.warn("scheduled-agents-list: caller username lookup threw — gate disabled", {
        operation: "scheduled_agents_list_username_lookup_threw",
        userId,
        error: usernameErr instanceof Error ? usernameErr.message : String(usernameErr),
      });
    }

    const items = perHost
      .flat()
      .filter((row) => isScheduledAgentVisibleToUser(row.users, callerUsername))
      .map((row) => {
        const { users: _users, ...rest } = row;
        return rest;
      });

    return res.json({ items });
  },
);

// Trailing catch-all error middleware — mirrors roles-list-for-host.ts:281-297.
// Never leaks upstream detail into the response body (T-128-08 info-disclosure).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("scheduled-agents-list: unhandled error", {
      operation: "scheduled_agents_list_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
