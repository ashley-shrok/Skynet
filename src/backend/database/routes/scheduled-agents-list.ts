/**
 * Phase 134 Plan 134-01 (wake-ups-redesign campaign shape 2 — CRUD API):
 * GET /scheduled-agents — fleet-wide LIST of scheduled-agent specs.
 *
 * D-01: HTTP REST endpoint style (mirrors roles-*.ts + conversation-search.ts).
 * D-02: Fleet-wide sweep on list — this endpoint enumerates every managed host's
 *       ~/fleet/scheduled-agents/<slug>/scheduled-agent.json in one aggregated response. Each item
 *       carries {slug, host, hostId, name, enabled, schedule, scheduleHuman,
 *       prompt, roles[]}.
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
  readRoleFileByName,
  extractCosmeticsFromFrontmatter,
} from "../../claude-session/identity-artifact-reader.js";
import { computeNextFireAt } from "../../claude-session/schedule-next-fire.js";
import type { Client as SSHClientType } from "ssh2";
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
 *  firing). Scheduled-agent specs carry `prompt` and `roles[]`
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
  /**
   * First-role's colorHue, resolved from the role file's frontmatter on the
   * OWNING host. Cascade: `roleCosmetics.colorHue ?? null`. Populated
   * per-row via a memoized per-host `readRoleFileByName` pass alongside the
   * spec read (see readRoleHueMemo). Frontend row uses this for the
   * avatar-sm hue + `--row-hue` CSS custom-property; falls back to 190
   * when null.
   */
  colorHue: number | null;
  /**
   * Last fire epoch (seconds). Null when the `.state/<slug>.last` sentinel
   * is absent — which post the 2026-10-05 sentinel split means strictly
   * "has never actually fired yet" (first-sight anchor now writes
   * `.anchored` instead of `.last`, so `.last` is reserved for real fires).
   * The modal row omits the "Last" chip when this is null.
   */
  lastFiredAt: number | null;
  /**
   * Computed next-fire epoch (seconds). Derived at list-assembly time from
   * `schedule` + `lastFiredAt` by `computeNextFireAt` — the TS port of the
   * Python scheduler's `_due()` logic. Null for malformed schedules, past
   * one_shots, or when a days-filter prunes every candidate within 14 days.
   */
  nextFireAt: number | null;
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
 * safe defaults (name→slug, roles→[]). Called from both LOCAL and
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
    // colorHue starts null; the caller populates it via readRoleHueMemo
    // after specToRow returns (batched per-unique-role read reuses the
    // already-open SSH connection / local fs handle for that host).
    colorHue: null,
    // lastFiredAt + nextFireAt start null; LOCAL / REMOTE branches populate
    // lastFiredAt from the per-host `.state/<slug>.last` sentinel, then
    // computeNextFireAt derives nextFireAt from schedule + lastFiredAt.
    lastFiredAt: null,
    nextFireAt: null,
    users,
  };
}

/**
 * Attach `lastFiredAt` + `nextFireAt` to each row from per-host `slug→epoch`
 * maps of `.state/*.last` + `.state/*.anchored` reads. Idempotent.
 *
 * Semantics (2026-10-05 sentinel split):
 *   - `lastFiredAt` → strictly from `.last` — null when the spec has never
 *     actually fired. UI omits the "Last" chip in that case.
 *   - `nextFireAt` reference → `.last ?? .anchored`. This matches the
 *     Python scheduler's own due-check precedence so the modal's "Next"
 *     stays accurate for brand-new (anchored, never fired) specs.
 */
function attachFireTimestamps(
  rows: ScheduledAgentListItem[],
  lastBySlug: Map<string, number>,
  anchoredBySlug: Map<string, number>,
  nowSecs: number,
): void {
  for (const row of rows) {
    const last = lastBySlug.get(row.slug);
    const anchored = anchoredBySlug.get(row.slug);
    row.lastFiredAt = typeof last === "number" && Number.isFinite(last) ? last : null;
    const reference = row.lastFiredAt ??
      (typeof anchored === "number" && Number.isFinite(anchored) ? anchored : null);
    row.nextFireAt = computeNextFireAt(row.schedule, reference, nowSecs);
  }
}

/**
 * Batched per-unique-role colorHue read for one host. Piggybacks on the
 * per-host branch's existing connection (SSH or null-for-LOCAL). Mirrors
 * the gateHostRows memo in conversation-search.ts — Promise-valued map so
 * parallel duplicate reads collapse.
 *
 * Fail-open: role read failures OR frontmatter without colorHue both
 * resolve to null. The frontend row falls back to hue 190 on null.
 *
 * The gate on ROLE_NAME_PATTERN inside readRoleFileByName means a
 * garbage/invalid role slug in the scheduled-agent spec throws; catch
 * silently and set null (not our job to police spec content here — the
 * downstream identity-birth flow handles invalid roles).
 */
async function attachColorHuesForHost(
  conn: SSHClientType | null,
  rows: ScheduledAgentListItem[],
  hostId: number,
  hostName: string,
): Promise<void> {
  if (rows.length === 0) return;
  const uniqueRoles = new Set<string>();
  for (const row of rows) {
    const first = row.roles[0];
    if (typeof first === "string" && first.length > 0) uniqueRoles.add(first);
  }
  if (uniqueRoles.size === 0) return;

  const hueMap = new Map<string, Promise<number | null>>();
  for (const roleName of uniqueRoles) {
    hueMap.set(
      roleName,
      (async () => {
        try {
          const { markdown } = await readRoleFileByName(conn, roleName);
          if (!markdown) return null;
          const cos = extractCosmeticsFromFrontmatter(markdown);
          return typeof cos.colorHue === "number" ? cos.colorHue : null;
        } catch (err) {
          sshLogger.debug("scheduled-agents-list: role hue read failed", {
            operation: "scheduled_agents_list_role_hue_read",
            hostId,
            hostName,
            roleName,
            error: err instanceof Error ? err.message : "unknown",
          });
          return null;
        }
      })(),
    );
  }
  await Promise.all(hueMap.values());
  for (const row of rows) {
    const first = row.roles[0];
    if (typeof first === "string" && hueMap.has(first)) {
      row.colorHue = (await hueMap.get(first)!) ?? null;
    }
  }
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
  await attachColorHuesForHost(null, out, hostId, hostName);
  // Read `.state/*.last` + `.state/*.anchored` sentinels so lastFiredAt +
  // nextFireAt can be attached. ENOENT on the state dir (scheduler never ran
  // here) collapses to empty maps — every row keeps lastFiredAt: null and
  // nextFireAt gets computed from a null reference (interval still renders
  // usefully). Both sentinels are read in one readdir pass.
  const lastBySlug = new Map<string, number>();
  const anchoredBySlug = new Map<string, number>();
  const stateDir = path.join(scheduledAgentsDir, ".state");
  try {
    const stateEntries = await fs.readdir(stateDir);
    await Promise.all(
      stateEntries.map(async (fname) => {
        let slug: string | null = null;
        let target: Map<string, number> | null = null;
        if (fname.endsWith(".last")) {
          slug = fname.slice(0, -".last".length);
          target = lastBySlug;
        } else if (fname.endsWith(".anchored")) {
          slug = fname.slice(0, -".anchored".length);
          target = anchoredBySlug;
        } else {
          return;
        }
        if (!IDENTITY_SLUG_RE.test(slug)) return;
        try {
          const raw = await fs.readFile(path.join(stateDir, fname), "utf-8");
          const n = Number(raw.trim());
          if (Number.isFinite(n) && n > 0) target.set(slug, n);
        } catch {
          /* ignore unreadable sentinel */
        }
      }),
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      sshLogger.debug("scheduled-agents-list: local state readdir failed", {
        operation: "scheduled_agents_list_local_state_readdir",
        hostId,
        hostName,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  attachFireTimestamps(out, lastBySlug, anchoredBySlug, Math.floor(Date.now() / 1000));
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
  // Three sections per round-trip: SLUG blocks (spec contents), LAST blocks
  // (`.state/*.last` sentinels — real fires), and ANCHORS blocks
  // (`.state/*.anchored` sentinels — first-sight anchors, 2026-10-05 split).
  // Keeping all three in a single exec avoids extra per-host round-trips.
  const cmd =
    `cd "$HOME/fleet/scheduled-agents" 2>/dev/null && ` +
    'shopt -s nullglob; ' +
    'for d in */; do slug="${d%/}"; echo "===SLUG:${slug}==="; cat "$d/scheduled-agent.json" 2>/dev/null; done; ' +
    'echo "===LASTS==="; ' +
    'for f in .state/*.last; do slug="$(basename "$f" .last)"; echo "${slug}=$(cat "$f" 2>/dev/null)"; done; ' +
    'echo "===ANCHORS==="; ' +
    'for f in .state/*.anchored; do slug="$(basename "$f" .anchored)"; echo "${slug}=$(cat "$f" 2>/dev/null)"; done';
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

  // Split the three sections: SLUGs (specs), LASTs (real fires), ANCHORS
  // (first-sight anchors). Older remote scheduler builds that don't emit
  // the ANCHORS section are gracefully handled — anchoredSection stays ""
  // and anchoredBySlug stays empty.
  const lastsIdx = stdout.indexOf("===LASTS===");
  const anchorsIdx = stdout.indexOf("===ANCHORS===");
  const slugsSection = lastsIdx >= 0 ? stdout.slice(0, lastsIdx) : stdout;
  const lastsSection =
    lastsIdx >= 0
      ? stdout.slice(
          lastsIdx + "===LASTS===".length,
          anchorsIdx >= 0 ? anchorsIdx : undefined,
        )
      : "";
  const anchorsSection = anchorsIdx >= 0
    ? stdout.slice(anchorsIdx + "===ANCHORS===".length)
    : "";

  const parseKvSection = (section: string): Map<string, number> => {
    const out = new Map<string, number>();
    if (!section) return out;
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const slug = trimmed.slice(0, eq);
      if (!IDENTITY_SLUG_RE.test(slug)) continue;
      const n = Number(trimmed.slice(eq + 1));
      if (Number.isFinite(n) && n > 0) out.set(slug, n);
    }
    return out;
  };

  const lastBySlug = parseKvSection(lastsSection);
  const anchoredBySlug = parseKvSection(anchorsSection);

  const chunks = slugsSection.split("===SLUG:");
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
  await attachColorHuesForHost(conn, out, hostId, hostName);
  attachFireTimestamps(out, lastBySlug, anchoredBySlug, Math.floor(Date.now() / 1000));
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
