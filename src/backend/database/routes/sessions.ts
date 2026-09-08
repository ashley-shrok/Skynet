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
// Phase 85 (D-07): identity-name-keyed send-log store — replaces the
// byte-parallel `scanTailForNewestMessageAt` call for `/sessions/list`'s
// `lastMessageAt` seed. AppShell reads `/sessions/list` on page load to
// feed `seedSessionLastMessageAt` in the frontend working store; without
// this swap the seed would be the stale JSONL-derived value and the next
// WS-live orchestrator frame (Phase 85-04) would overwrite it ~2s later,
// causing a visible flicker. The store lookup is DB-local, independent
// of the SSH pathway, and cheap (indexed single-row SELECT per identity).
// Phase 85-02 owns the module + monotonic-write + fail-open contracts.
import { getIdentityLastSend } from "../../fleet-status/identity-send-log-store.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// quick-260821-m36: split the historical single PER_HOST_TIMEOUT_MS into two
// tiers so an unreachable candidate host (stale row whose IP no longer resolves
// on tailnet — e.g., phantom hosts.id 14/15 rows purged out-of-band in the
// plan's ops cleanup) fails fast at TCP+SSH connect instead of consuming the
// full 30s discovery budget. When one dead host burned all 30s
// of the wall-clock, the aggregate /sessions/list response pushed past the
// frontend's axios 30s ceiling → axios rejected → PrettyConversationsPanel
// never received fleet data (spinner stuck) and the WS-health pipeline fired
// "Server connection lost, recovering…" toasts on desktop + iPad. Splitting
// gives connectOneShot its own 5s cap while preserving the 30s roof for the
// three legitimate discovery-heavy blocks below.
//
// 5s is comfortable margin over the healthy SSH handshake wall-clock (~200-
// 800ms even on cold cross-region tailscale links) and small enough that a
// single dead host contributes at most ~5s to the aggregate.
const CONNECT_TIMEOUT_MS = 5_000;

// Per-block timeout for the /sessions/list handler — bumped 3000 → 30000
// (Ashley 2026-08-20 UAT) matching DISCOVERY_EXEC_TIMEOUT_MS. Wraps the
// connectOneShot + `tmux list-sessions` + per-session `discoverIdentitySessionFile`
// + `tail -c 262144` execs. On a ~5-identity host the concurrent-discovery
// wall-clock hits ~5s; 3s tripped every /sessions/list call and null'd both
// row.lastMessageAt and row.aiTitle for every local session. See
// DISCOVERY_EXEC_TIMEOUT_MS docblock in discover-identity-session-file.ts.
//
// quick-260821-m36 note: connectOneShot is NO LONGER wrapped by this cap —
// it uses CONNECT_TIMEOUT_MS (5_000) above. The three setTimeout(...,
// PER_HOST_TIMEOUT_MS) call sites below (tmux list-sessions Promise.race,
// per-session role-resolve Promise.race, per-session recency-signals
// Promise.race) still consume the full 30s budget — tanya's rationale
// applies to concurrent-discovery, not the connect handshake.
const PER_HOST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Phase 43 Plan 01 — dormant-side lastMessageAt derivation
// ---------------------------------------------------------------------------
//
// Ashley 2026-08-23 lock: "only my real messages going to them" —
// INVERTS the 2026-08-14 lock. See quick-260823-bap plan for the full
// predicate matrix. Canonical copy lives in
// `src/backend/fleet-status/ssh-poll-orchestrator.ts` (isAshleyRealUserTurn
// helper + scanTailForNewestMessageAt). This file owns the byte-parallel copy
// for the dormant /sessions/list path. If either copy ever needs to change,
// update BOTH sites — a cross-cutting shared module was explicitly out of
// scope for Phase 43 (43-CONTEXT.md "no new shared module" scope decision).

/**
 * Ashley 2026-08-23 lock: "only my real messages going to them" —
 * INVERTS the 2026-08-14 lock. Assistant activity, incoming/outgoing
 * DMs, scheduled wakes, task notifications, skill-body injections all
 * excluded. See quick-260823-bap plan for the full predicate matrix.
 *
 * Predicate: a JSONL line counts iff top-level type==="user" AND
 * message.content is a plain string AND (starts with "<command-" OR
 * NOT (starts with "<" AND ends with ">") on trimmed content) AND
 * NOT a Ctrl-C kill signal (control-chars-only content) AND
 * NOT an agent-supervisor /exit slash-command AND
 * NOT an agent-supervisor resumed-injection sentinel.
 *
 * Independent JSON.parse (mirrors scanTailForLatestAiTitle pattern) —
 * do NOT extend parseSessionLine to expose raw content. Parallel-copy
 * discipline preserved per 43-CONTEXT.md scope decision (canonical
 * copy in ssh-poll-orchestrator.ts must stay byte-parallel).
 *
 * Ashley 2026-08-29 refinement: three additional harness-injected shapes
 * confirmed on Tabitha's session file now explicitly rejected:
 * - Ctrl-C kill signal: supervisor delivers "\x03\x03" as plain-string
 *   content; after trimming, stripping all ASCII control chars yields "".
 * - /exit slash-command: agent-supervisor fires `/exit` before recycle;
 *   content contains "<command-name>/exit</command-name>".
 * - Resumed-injection sentinel: supervisor injects "Your session was just
 *   resumed by the agent-supervisor…" as a type:"user" turn in some paths.
 */
function isAshleyRealUserTurn(rawLine: string): { ok: true; ts: number } | { ok: false } {
  const trimmed = rawLine.trim();
  if (trimmed === "") return { ok: false };
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { ok: false };
  }
  if (obj === null || typeof obj !== "object") return { ok: false };
  const top = obj as Record<string, unknown>;
  // Step 2: top-level type must be "user" (excludes assistant, relay_outbound, etc.)
  if (top.type !== "user") return { ok: false };
  // Step 3: message.content must be a plain string (excludes list-content user turns:
  // tool_result arrays, skill-body [{type:"text",text:…}] injections, etc.)
  const msg = top.message;
  if (msg === null || typeof msg !== "object") return { ok: false };
  const content = (msg as Record<string, unknown>).content;
  if (typeof content !== "string") return { ok: false };
  // Step 4: apply the XML-wrapper exclusion.
  const t = content.trim();
  const isXmlWrapper = t.startsWith("<") && t.endsWith(">");
  const isCommand = t.startsWith("<command-");
  if (!isCommand && isXmlWrapper) return { ok: false };
  // Step 5 (2026-08-29 refinement): drop /exit slash-command injected by agent-supervisor
  // before recycle. Ashley's own slash-commands (/id, /build, /gsd:*) are unaffected.
  if (content.includes("<command-name>/exit</command-name>")) return { ok: false };
  // Step 6 (2026-08-29 refinement): drop control-chars-only content (e.g. Ctrl-C kill
  // signal "\x03\x03"). t is already trimmed of regular whitespace; stripping ASCII
  // control chars from t and getting "" means the payload was pure control-char noise.
  if (t.replace(/[\x00-\x1F]/g, "") === "") return { ok: false };
  // Step 7 (2026-08-29 refinement): drop agent-supervisor resumed-injection sentinel.
  // Prefix-anchored to avoid matching quoted mentions in real Ashley prose.
  if (content.startsWith("Your session was just resumed by the agent-supervisor")) return { ok: false };
  // Passed all gates — extract ts from the timestamp field.
  const rawTs = top.timestamp;
  if (typeof rawTs !== "string") return { ok: false };
  const ts = Date.parse(rawTs);
  if (!Number.isFinite(ts)) return { ok: false };
  return { ok: true, ts };
}

/**
 * Scan the raw stdout of a `tail -c 262144 <jsonl-path>` for the newest
 * Ashley-real-user-turn `ts` (unix millis) across all parseable lines.
 * Returns null if zero qualifying lines are found (or the tail is empty).
 *
 * Mirrors the semantics of `scanTailForNewestMessageAt` in
 * `ssh-poll-orchestrator.ts`. Empty and malformed lines are silently
 * skipped — this is best-effort sampling, not a validation pass.
 *
 * Predicate: isAshleyRealUserTurn (Ashley 2026-08-23 lock). The helper
 * returns {ok, ts} so a single JSON.parse feeds both the gate and the ts
 * extraction, avoiding a second parse on the keep path.
 *
 * Phase 85 (D-08): retired from the /sessions/list lastMessageAt
 * derivation (see the Promise.all block in the route handler below —
 * lastMessageAt now sources from getIdentityLastSend) but STAYS DEFINED
 * as the byte-parallel copy of the ssh-poll-orchestrator export. If
 * either copy changes, update BOTH per the file's parallel-copy
 * discipline docblock above (L54-64). The `isAshleyRealUserTurn` helper
 * this function calls (L93) is treated the same way — kept defined for
 * the byte-parallel copy discipline even if this file has zero remaining
 * callers post-swap. Do NOT delete either symbol.
 */
function scanTailForNewestMessageAt(tailContents: string): number | null {
  let newest: number | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const result = isAshleyRealUserTurn(line);
    if (!result.ok) continue;
    const { ts } = result;
    if (newest === null || ts > newest) {
      newest = ts;
    }
  }
  return newest;
}

/**
 * Phase 85 (D-08): test-only re-export of scanTailForNewestMessageAt for the
 * byte-parallel-copy predicate-matrix regression suite. Follows the same
 * convention as `__scanTailForNewestMessageAtForTests` in
 * `src/backend/fleet-status/ssh-poll-orchestrator.ts` (Phase 85-04). The
 * `/sessions/list` route no longer calls `scanTailForNewestMessageAt` on
 * the lastMessageAt axis (lookup swapped to the send-log store), but the
 * function definition + its `isAshleyRealUserTurn` dependency stay alive
 * per the D-08 parallel-copy discipline. This export lets the
 * quick-260823-bap predicate-matrix suite continue to assert the byte-level
 * shape of the retired scanner without going through the route observable.
 *
 * Do NOT import from non-test code.
 */
export function __scanTailForNewestMessageAtForTests(
  tailContents: string,
): number | null {
  return scanTailForNewestMessageAt(tailContents);
}

// ---------------------------------------------------------------------------
// Phase 47 Plan 02 — dormant-side aiTitle derivation
// ---------------------------------------------------------------------------
//
// Harness ai-title source per Phase 47 CONTEXT.md § Backend scraper mechanics:
// Claude Code appends `{"type":"ai-title","aiTitle":"…","sessionId":"…"}` lines
// to the session JSONL as the topic drifts. Multiple such lines can exist in a
// single JSONL — the LAST one in file order is the current title (last-wins
// semantics, distinct from Phase 44's max-wins lastMessageAt).
//
// This helper takes the same tail buffer that scanTailForNewestMessageAt
// consumes (see recencySignalsBlock below — OPTION A per 47-02-PLAN.md Task 1:
// one `tail -c 262144` exec feeds BOTH signals to avoid a duplicate discovery
// + tail round-trip per row). Filtering strategy: cheap `line.includes(...)`
// substring pre-filter, then in-process JSON.parse (matches the parseSessionLine
// in-process pattern the Phase 44 Plan 01 scanner uses — no jq subprocess).
//
// Failure model matches scanTailForNewestMessageAt: empty tail, malformed JSON,
// missing aiTitle field, wrong-type aiTitle value → return null (best-effort
// sampling, not validation).
function scanTailForLatestAiTitle(tailContents: string): string | null {
  let latest: string | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    // Cheap substring pre-filter — avoids JSON.parse on every message line.
    if (!line.includes('"type":"ai-title"')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as { aiTitle?: unknown }).aiTitle === "string"
      ) {
        // Last-wins: update sticky `latest` on every valid match. File order
        // is the definitive last-wins order (topic drift moves forward).
        latest = (parsed as { aiTitle: string }).aiTitle;
      }
    } catch {
      // Malformed JSON — skip silently.
      continue;
    }
  }
  return latest;
}

interface TmuxSessionRow {
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
  role: string | null;
  lastMessageAt: number | null;
  // Phase 47 Plan 02 — required-on-server-but-null-when-unknown, matching
  // Phase 44 Plan 01's invariant for lastMessageAt. The route always emits
  // this key; the value is either the harness's latest ai-title string OR
  // null on any failure path (no discovery, empty tail, malformed line,
  // timeout, throw). See scanTailForLatestAiTitle helper docblock above.
  aiTitle: string | null;
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
      return cfg.autoTmux !== false;
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
            CONNECT_TIMEOUT_MS,
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
                  // Phase 47 Plan 02 — aiTitle third axis. Row-init null; the
                  // recencySignalsBlock below will populate on discovery hit.
                  aiTitle: null as string | null,
                };
              });

            // Resolve role AND derive recency-signals for each session in
            // parallel. Three independent per-session blocks dispatched
            // concurrently:
            //
            //   1. roleResolveBlock — reads the identity's frontmatter over
            //      the same already-open SSH conn.
            //   2. sendLogLookupBlock — reads the identity-name-keyed send-log
            //      store for `lastMessageAt`. INDEPENDENT of the SSH pathway
            //      (in-process DB lookup) so a slow tail-scan cannot null the
            //      recency signal, and a timeout on the ai-title scan below
            //      cannot regress `row.lastMessageAt` because it's already set
            //      by this block.
            //   3. aiTitleBlock — reads the JSONL tail for the harness
            //      ai-title line. Wrapped in Promise.race(PER_HOST_TIMEOUT_MS)
            //      + try/catch so one hung discovery does NOT kill the whole
            //      host (Phase 47 Plan 02 <behavior> Test 6 lock).
            //
            // Phase 85 (D-07): source-swap parallel to Plan 85-04. The
            // `/sessions/list` route is the initial-seed path that AppShell
            // reads on page-load to feed `seedSessionLastMessageAt` in the
            // frontend working store. Without this swap a fresh page-load
            // would seed the stale JSONL-derived value, then the WS-live
            // orchestrator frame (Plan 85-04) would overwrite ~2s later
            // (visible flicker as rows re-sort). Swapping the seed to the
            // store makes the initial paint authoritative-consistent with
            // the WS-live frame from the moment the page loads.
            //
            // Phase 85 (D-08): `scanTailForNewestMessageAt` STAYS DEFINED in
            // this file (see docblock above the function definition) —
            // byte-parallel copy discipline with the ssh-poll-orchestrator
            // export. Only the CALL retires; the function + its
            // `isAshleyRealUserTurn` dependency remain.
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

                // Phase 85 (D-07): per-session send-log store lookup for
                // `lastMessageAt`. Fleet convention: identity name ===
                // tmux session name === /id target (see 79-CONTEXT.md § D-02).
                // The store owns the max-wins + fail-open contracts (Phase
                // 85-02); the try/catch here is belt-and-suspenders on the
                // per-row path. On store-null or throw → row.lastMessageAt
                // stays at its row-init `null`, which is the same D-09
                // first-ship "natural fill" contract the WS-live orchestrator
                // frame uses.
                const sendLogLookupBlock = (async () => {
                  try {
                    const stored = await getIdentityLastSend(row.sessionName);
                    row.lastMessageAt = stored;
                    sshLogger.debug(
                      "sessions/list: lastMessageAt derived from send-log store",
                      {
                        operation: "sessions_list_last_message_at_from_store",
                        hostId,
                        hostName,
                        sessionName: row.sessionName,
                        lookupResult: stored,
                      },
                    );
                  } catch (e) {
                    sshLogger.debug(
                      "sessions/list: getIdentityLastSend failed — leaving lastMessageAt null",
                      {
                        operation: "sessions_list_send_log_lookup_failed",
                        hostId,
                        hostName,
                        sessionName: row.sessionName,
                        error: e instanceof Error ? e.message : "unknown",
                      },
                    );
                    row.lastMessageAt = null;
                  }
                })();

                // Per-session ai-title derivation.
                // Phase 47 Plan 02 semantics preserved — ONE discovery +
                // ONE tail read to feed `scanTailForLatestAiTitle`. Phase
                // 79 (D-07) retired the sibling `scanTailForNewestMessageAt`
                // call from this block; `lastMessageAt` now sources from
                // the store lookup above. Tail width stays at 256KB
                // (`tail -c 262144`) per Phase 47 CONTEXT.md § Backend
                // scraper mechanics — an ai-title line older than the last
                // handful of message-bearing lines is still captured.
                //
                // On any failure (discovery null, tail empty, timeout,
                // throw): row.aiTitle stays null and siblings are
                // unaffected. `row.lastMessageAt` is NOT touched by this
                // block — it was set independently by the store lookup
                // above and cannot be regressed by an SSH failure here.
                //
                // The log-operation tag preserves the historical
                // `sessions_list_recency_signals_skip` string so post-deploy
                // log-tailing dashboards continue to match. Semantic scope
                // has narrowed to the aiTitle axis only.
                const aiTitleBlock = (async () => {
                  try {
                    const resolved = await Promise.race([
                      (async (): Promise<{ aiTitle: string | null }> => {
                        const jsonlPath = await discoverIdentitySessionFile(
                          conn,
                          row.sessionName,
                        );
                        if (jsonlPath === null) {
                          return { aiTitle: null };
                        }
                        // jsonlPath is an absolute path shape returned by the
                        // discovery module (~/.claude/projects/<slug>/<uuid>.jsonl).
                        // Single-quote-wrap defensively (mirrors
                        // ssh-poll-orchestrator's fail-open path validation)
                        // even though the discovery module's output has no
                        // shell-special chars by construction.
                        const tailRaw = await execCommand(
                          conn,
                          `tail -c 262144 '${jsonlPath}' 2>/dev/null || true`,
                        );
                        if (!tailRaw || tailRaw.trim() === "") {
                          return { aiTitle: null };
                        }
                        return {
                          aiTitle: scanTailForLatestAiTitle(tailRaw),
                        };
                      })(),
                      new Promise<{ aiTitle: string | null }>((_, reject) =>
                        setTimeout(
                          () =>
                            reject(
                              new Error(
                                "per-session recency-signals discovery timeout",
                              ),
                            ),
                          PER_HOST_TIMEOUT_MS,
                        ),
                      ),
                    ]);
                    row.aiTitle = resolved.aiTitle;
                  } catch (e) {
                    sshLogger.debug(
                      "sessions/list: recency-signals derivation skipped for session",
                      {
                        operation: "sessions_list_recency_signals_skip",
                        hostId,
                        hostName,
                        sessionName: row.sessionName,
                        error: e instanceof Error ? e.message : "unknown",
                      },
                    );
                    row.aiTitle = null;
                  }
                })();

                await Promise.all([
                  roleResolveBlock,
                  sendLogLookupBlock,
                  aiTitleBlock,
                ]);
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
