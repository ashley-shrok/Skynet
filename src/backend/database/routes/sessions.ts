import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveRoleForIdentity } from "../../claude-session/identity-artifact-reader.js";
import { discoverIdentitySessionFile } from "../../claude-session/discover-identity-session-file.js";
import { parseSessionLine } from "../../claude-session/session-file-parser.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const PER_HOST_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Phase 43 Plan 01 — dormant-side lastMessageAt derivation
// ---------------------------------------------------------------------------
//
// The canonical MESSAGE_BEARING_KINDS set lives in
// `src/backend/fleet-status/ssh-poll-orchestrator.ts:146-151` — re-declared
// here (not cross-imported) per 43-CONTEXT.md "reuse Phase 32 mechanism"
// scope decision. The fleet-status module owns the constant for the live-poll
// path; sessions.ts owns the identical local copy for the dormant /sessions/list
// path. If either set ever needs to change, update BOTH sites — a cross-cutting
// shared module was explicitly out of scope for Phase 43.
//
// The four kinds match session-file-parser.ts return-type discriminants and
// carry a numeric `ts` field (unix millis) that this scan consumes.
const MESSAGE_BEARING_KINDS = new Set(["message", "image", "relay_outbound", "relay_inbound"]);

/**
 * Scan the raw stdout of a `tail -n N <jsonl-path>` for the newest
 * message-bearing `ts` (unix millis) across all parseable lines. Returns null
 * if zero message-bearing lines are found (or the tail is empty).
 *
 * Mirrors the semantics of `scanTailForNewestMessageAt` in
 * `ssh-poll-orchestrator.ts:190-206`. Empty and malformed lines are silently
 * skipped — this is best-effort sampling, not a validation pass.
 */
function scanTailForNewestMessageAt(tailContents: string): number | null {
  let newest: number | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = parseSessionLine(line);
    if (!MESSAGE_BEARING_KINDS.has(parsed.kind)) continue;
    const ts = (parsed as { ts: number }).ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (newest === null || ts > newest) {
      newest = ts;
    }
  }
  return newest;
}

interface TmuxSessionRow {
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
  role: string | null;
  lastMessageAt: number | null;
}

/**
 * @openapi
 * /sessions/list:
 *   get:
 *     summary: List tmux sessions across all SSH+autoTmux hosts
 *     tags:
 *       - Sessions
 *     responses:
 *       200:
 *         description: Flat list of sessions. Hosts that error or time out are silently dropped.
 */
router.get("/list", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    // SimpleDBOps decrypts the encrypted columns (terminalConfig, etc.)
    const rows = (await SimpleDBOps.select(
      db.select().from(hosts).where(eq(hosts.userId, userId)),
      "ssh_data",
      userId,
    )) as Array<Record<string, unknown>>;

    const candidates = rows.filter((h) => {
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
      return cfg.autoTmux === true;
    });

    const results = await Promise.all(
      candidates.map(async (h): Promise<TmuxSessionRow[]> => {
        const hostId = h.id as number;
        const hostName = ((h.name as string) || (h.ip as string) || "") as string;
        try {
          const resolved = await resolveHostById(hostId, userId);
          if (!resolved) return [];
          const conn = await connectOneShot(
            resolved as unknown as Parameters<typeof connectOneShot>[0],
            PER_HOST_TIMEOUT_MS,
          );
          try {
            const output = await Promise.race([
              execCommand(
                conn,
                "tmux list-sessions -F '#{session_name}|#{session_created}' 2>/dev/null",
              ),
              new Promise<string>((_, reject) =>
                setTimeout(
                  () => reject(new Error("list-sessions timeout")),
                  PER_HOST_TIMEOUT_MS,
                ),
              ),
            ]);
            if (!output) return [];
            const rows = output
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [name, created] = line.split("|");
                return {
                  hostId,
                  hostName,
                  sessionName: name,
                  created: parseInt(created, 10) || 0,
                  role: null as string | null,
                  lastMessageAt: null as number | null,
                };
              });

            // Resolve role AND derive lastMessageAt for each session on the SAME
            // already-open conn, in parallel. Both per-session blocks are dispatched
            // concurrently so a slow discovery doesn't extend the wall-clock beyond
            // max(roleResolve, lastMessageAtDerive) for that session.
            //
            // Each per-session block wraps its work in Promise.race(PER_HOST_TIMEOUT_MS)
            // + try/catch — one hung/failed frontmatter read OR JSONL discovery must
            // NOT kill the whole host (Phase 43 Plan 01 <behavior> Test 3 lock).
            await Promise.all(
              rows.map(async (row) => {
                // Per-session role resolve (unchanged behavior).
                const roleResolveBlock = (async () => {
                  try {
                    row.role = await Promise.race([
                      resolveRoleForIdentity(conn, row.sessionName),
                      new Promise<string>((_, reject) =>
                        setTimeout(
                          () => reject(new Error("per-identity role resolve timeout")),
                          PER_HOST_TIMEOUT_MS,
                        ),
                      ),
                    ]);
                  } catch (e) {
                    sshLogger.debug("sessions/list: role resolve skipped for session", {
                      operation: "sessions_list_role_resolve_skip",
                      hostId,
                      hostName,
                      sessionName: row.sessionName,
                      error: e instanceof Error ? e.message : "unknown",
                    });
                    row.role = null;
                  }
                })();

                // Per-session lastMessageAt derivation (Phase 43 Plan 01).
                // Step 1: discoverIdentitySessionFile(conn, row.sessionName) locates
                //         the mtime-newest /id-first-turn JSONL for this identity.
                // Step 2: tail -n 200 of that JSONL, filter by MESSAGE_BEARING_KINDS,
                //         take the newest `ts`.
                // On any failure (discovery null, tail empty, timeout, throw): row's
                // lastMessageAt stays null and siblings are unaffected.
                const lastMessageAtBlock = (async () => {
                  try {
                    const resolved = await Promise.race([
                      (async (): Promise<number | null> => {
                        const jsonlPath = await discoverIdentitySessionFile(
                          conn,
                          row.sessionName,
                        );
                        if (jsonlPath === null) return null;
                        // jsonlPath is an absolute path shape returned by the
                        // discovery module (~/.claude/projects/<slug>/<uuid>.jsonl).
                        // Single-quote-wrap defensively (mirrors ssh-poll-orchestrator's
                        // fail-open path validation) even though the discovery module's
                        // output has no shell-special chars by construction.
                        const tailRaw = await execCommand(
                          conn,
                          `tail -n 200 '${jsonlPath}' 2>/dev/null || true`,
                        );
                        if (!tailRaw || tailRaw.trim() === "") return null;
                        return scanTailForNewestMessageAt(tailRaw);
                      })(),
                      new Promise<number | null>((_, reject) =>
                        setTimeout(
                          () =>
                            reject(
                              new Error(
                                "per-session lastMessageAt discovery timeout",
                              ),
                            ),
                          PER_HOST_TIMEOUT_MS,
                        ),
                      ),
                    ]);
                    row.lastMessageAt = resolved;
                  } catch (e) {
                    sshLogger.debug(
                      "sessions/list: lastMessageAt derivation skipped for session",
                      {
                        operation: "sessions_list_last_message_at_skip",
                        hostId,
                        hostName,
                        sessionName: row.sessionName,
                        error: e instanceof Error ? e.message : "unknown",
                      },
                    );
                    row.lastMessageAt = null;
                  }
                })();

                await Promise.all([roleResolveBlock, lastMessageAtBlock]);
              }),
            );

            return rows;
          } finally {
            try {
              conn.end();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          sshLogger.debug("sessions/list: host skipped", {
            operation: "sessions_list_host_skip",
            hostId,
            hostName,
            error: e instanceof Error ? e.message : "unknown",
          });
          return [];
        }
      }),
    );

    const flat = results.flat().sort((a, b) => b.created - a.created);
    return res.json(flat);
  } catch (e) {
    databaseLogger.error("Failed to list tmux sessions", e, {
      operation: "sessions_list",
      userId,
    });
    return res.status(500).json({ error: "Failed to list sessions" });
  }
});

export default router;
