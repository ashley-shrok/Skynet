/**
 * POST /conversation-search — Phase 122 Plan 122-02 Task 2.
 *
 * Content-search across the caller's SSH+autoTmux hosts. Reads BOTH
 * `~/fleet/identities/` and `~/fleet/identities-archive/` on each host,
 * resolves each identity's latest JSONL transcript via
 * `discoverIdentitySessionFile` (per Plan 122-01 Wave 0 verdict
 * `go-same-helper` — no branching by archived vs live), runs a
 * shell-injection-safe fixed-string grep across those files, and returns
 * a mtime-sorted paginated slice of results with per-hit windowed snippets.
 *
 * REQUEST BODY:
 *   { query: string, offset?: number, limit?: number }
 *
 * RESPONSE:
 *   { results: ConversationSearchResult[], hasMore: boolean }
 *
 * RESULT ROW (11 fields — locked by Phase 122 must_haves.truths):
 *   transcriptPath    — absolute path to the matched JSONL on the host
 *   transcriptMtime   — mtime in milliseconds since epoch
 *   identityKey       — the fleet identity name (from listIdentity*Keys)
 *   hostId            — hosts.id column
 *   hostName          — hosts.name (or hosts.ip fallback)
 *   aiTitle           — deferred (null until follow-up per plan Task 2
 *                       action item 7; frontend falls back to identityKey)
 *   snippet           — pre-windowed ±80-char text around the query match
 *   hitStart          — char offset of match inside snippet (or -1 on fallback)
 *   hitLength         — length of match (or 0 on fallback)
 *   isArchived        — true iff identityKey came from
 *                       listArchivedIdentityKeysOnHost, false otherwise
 *   tmuxSessionName   — the tmux session name to attach to when opening this
 *                       conversation. By convention, fleet identity directory
 *                       names ARE the tmux session names (case-preserving),
 *                       and sessionMatchKey(name).toLowerCase() === identityKey.
 *                       For live identities the value equals identityKey; for
 *                       archived identities the tmux session may no longer
 *                       exist on the host, but the frontend needs the field
 *                       (for the "coming soon" alert path the value is unused;
 *                       for the live path it feeds openTab's
 *                       targetTmuxSession option). Added by Plan 122-03 Task 1
 *                       forward-patch so AppShell.tsx's onSearchResultOpenActive
 *                       can call openTab(host, "terminal", undefined,
 *                       { targetTmuxSession: result.tmuxSessionName, ... }).
 *
 * SECURITY DISPOSITIONS (Phase 122 plan threat register):
 *   T-122-01 (Tampering, shell-injection):
 *     Query is passed to the remote shell as a positional argument via
 *     `sh -c '<script>' -- "$QUERY"`. The script body reads it as "$1";
 *     the query bytes never enter the shell parser. Grep uses `-F`
 *     (fixed-string) to disable regex evaluation. Defense-in-depth:
 *     query is additionally single-quote-wrapped at the JS-composed
 *     command string boundary using the same `shellSingleQuote` idiom
 *     as `discover-identity-session-file.ts:247`.
 *
 *   T-122-02 (Information Disclosure, cross-tenant):
 *     Host projection scoped by `eq(hosts.userId, userId)` — user only
 *     sees results from their own hosts. No additional canAccessHost
 *     check needed since the userId filter is authoritative for host
 *     visibility (parallel to sessions.ts:298-302).
 *
 *   T-122-03/04 (DoS, slow host + pathological query):
 *     Per-host Promise.race([work, timeout(PER_HOST_TIMEOUT_MS)]) at
 *     30s; per-host try/catch → return [] so one host's failure yields
 *     an empty slice not global 500. MAX_QUERY_LEN=500 caps argv size;
 *     grep `--max-count=3` caps hits per file.
 *
 *   T-122-06 (Client-side XSS via snippet):
 *     snippet field is plain text. Frontend (plan 03) MUST render via
 *     React text children + <span> split around hitStart/hitLength —
 *     NEVER dangerouslySetInnerHTML. Backend does not encode or escape.
 *
 * CROSS-HOST FAN-OUT PATTERN:
 *   Byte-for-byte mirror of sessions.ts:294-566 —
 *     Promise.all(candidates.map(async (h) => {
 *       resolveHostById → connectOneShot → try work / catch [] / finally end();
 *     }))
 *   plus per-host Promise.race timeout.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
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
  __matchesIdentityFirstTurnForTests,
  buildDiscoveryScript,
  discoverIdentitySessionFile,
  parseDiscoveryStdout,
} from "../../claude-session/discover-identity-session-file.js";
import { listIdentityKeysOnHost } from "../../claude-session/identity-artifact-reader.js";
import { listArchivedIdentityKeysOnHost } from "../../claude-session/list-archived-identity-keys.js";
import { snippetForHit } from "../../claude-session/session-search-snippet.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SSH connect timeout — matches sessions.ts:57 (5s covers healthy handshake). */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Per-host budget (25s default). Overridable via
 * CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS env var for tests only. This
 * caps the entire runOneHost call (enumeration + discovery + grep) via
 * Promise.race — a stalled host contributes [] rather than blocking the
 * whole endpoint. 25s leaves ~5s headroom under Caddy's default 30s
 * proxy_read_timeout so the aggregated response can travel back to the
 * client before the edge times out.
 */
function getPerHostTimeoutMs(): number {
  const raw = process.env.CONVERSATION_SEARCH_PER_HOST_TIMEOUT_MS;
  if (typeof raw === "string" && raw.length > 0) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 25_000;
}

/**
 * Max concurrent identity-discovery calls per host. OpenSSH's default
 * `MaxSessions` is 10; going above that queues (or in worst case rejects)
 * excess channels on the shared `ssh2.Client` for the host. Six leaves
 * safe headroom under the default while still parallelizing enough to
 * clear ~150 identities in a few seconds. Applied to both the live and
 * archived identity-key discovery Promise.all loops in resolveIdentityPaths.
 */
const DISCOVERY_CONCURRENCY = 6;

/**
 * Bounded-concurrency parallel map. Preserves input order. No dep on
 * p-limit; keeps the endpoint zero-new-dep.
 */
async function concurrentMap<T, U>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

/** Bound argv size. Query length cap per Security Domain V5. */
const MAX_QUERY_LEN = 500;

/**
 * Max grep hits per file — bounds per-host result-set memory (T-122-03).
 * `grep --max-count=3` on each file caps how much one chatty transcript
 * can dominate the returned page.
 */
const MAX_HITS_PER_FILE = 3;

/** Default pagination window. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Types (also exported for the frontend plan 03 to import verbatim)
// ---------------------------------------------------------------------------

/**
 * Exported result-row type. Matches the frontend contract in RESEARCH.md
 * `## Code Examples` — plan 03's executor can import this via the compiled
 * .d.ts file rather than duplicating the shape.
 */
export interface ConversationSearchResult {
  transcriptPath: string;
  transcriptMtime: number;
  identityKey: string;
  hostId: number;
  hostName: string;
  aiTitle: string | null;
  snippet: string;
  hitStart: number;
  hitLength: number;
  isArchived: boolean;
  /**
   * Tmux session name to attach to when opening the conversation. By fleet
   * convention `identityKey` (the directory basename under
   * `~/fleet/identities/`) IS the tmux session name (case-preserving), so
   * this field carries the same string as `identityKey`. Retained as its
   * own field because the frontend's AppShell handler reads
   * `result.tmuxSessionName` to feed `openTab`'s `targetTmuxSession` option,
   * mirroring the shape of the sidebar's `onDetachedRowClick` at
   * AppShell.tsx:3068 which reads `row.targetTmuxSession`. Plan 122-03
   * Task 1 forward-patch.
   */
  tmuxSessionName: string | null;
}

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// ---------------------------------------------------------------------------
// Shell script + escaping helpers
// ---------------------------------------------------------------------------

/**
 * Single-quote wrap for use as a shell literal. Mirror of the export at
 * discover-identity-session-file.ts:247. Duplicated here rather than
 * imported to avoid cross-module coupling: this route module's use is
 * defense-in-depth on top of the positional-argument passing below.
 */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Build the per-host grep shell script.
 *
 * The script reads QUERY from $1, then reads each transcript path as a
 * positional argument ($2..$N). Both the query and the paths never enter
 * the shell parser as syntax — they're consumed as $-referenced argument
 * values, so shell metacharacters in either are inert.
 *
 * Emits: `<mtime>\t<path>\t<lineno>\t<raw-line>\n` per hit.
 *
 * Grep flags:
 *   -F  fixed-string (no regex) — honors D-02 case-insensitive PLAIN substring
 *   -i  case-insensitive — honors D-02
 *   -n  emit line number — used to disambiguate re-hits in the same file
 *   --max-count=N  bound hits per file
 *   --  end of options; anything after is a literal pattern/path
 *
 * Wrapped so that a missing file (`stat` fail) or empty grep result never
 * causes non-zero exit to propagate — `|| true` is not needed at the
 * outer boundary because the whole script exits 0 if every iteration
 * completes; internal 2>/dev/null suppresses per-file "no such file"
 * chatter.
 */
function buildGrepScript(): string {
  return (
    'QUERY="$1"; shift; ' +
    'for path in "$@"; do ' +
    '  mtime=$(stat -c "%Y" "$path" 2>/dev/null || echo 0); ' +
    '  [ "$mtime" = "0" ] && continue; ' +
    `  grep -F -i -n --max-count=${MAX_HITS_PER_FILE} -- "$QUERY" "$path" 2>/dev/null | ` +
    '  while IFS=: read -r lineno content; do ' +
    '    printf "%s\\t%s\\t%s\\t%s\\n" "$mtime" "$path" "$lineno" "$content"; ' +
    '  done; ' +
    "done"
  );
}

/**
 * Compose the full remote command string.
 *
 * The shape is:
 *   sh -c '<script>' -- '<query>' '<path1>' '<path2>' ...
 *
 * Everything past `sh -c '<script>' --` is a positional argument (the
 * shell parser inside `sh -c` sees only the script; the arguments after
 * `--` are $0..$N inside that script). Every user-controlled value is
 * ALSO single-quote-wrapped as defense-in-depth against a hypothetical
 * `execCommand` implementation change.
 */
function composeGrepCommand(query: string, paths: string[]): string {
  const script = buildGrepScript();
  const parts = [
    "sh",
    "-c",
    shellSingleQuote(script),
    "--",
    shellSingleQuote(query),
    ...paths.map(shellSingleQuote),
  ];
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Grep-output parser
// ---------------------------------------------------------------------------

interface RawHit {
  mtime: number;
  path: string;
  lineno: number;
  rawLine: string;
}

function parseGrepOutput(stdout: string): RawHit[] {
  if (!stdout || stdout.length === 0) return [];
  const hits: RawHit[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    // Format: <mtime>\t<path>\t<lineno>\t<raw-line>
    // Only split on FIRST 3 tabs — the raw JSONL line may contain tabs.
    const t1 = line.indexOf("\t");
    if (t1 === -1) continue;
    const t2 = line.indexOf("\t", t1 + 1);
    if (t2 === -1) continue;
    const t3 = line.indexOf("\t", t2 + 1);
    if (t3 === -1) continue;
    const mtimeStr = line.slice(0, t1);
    const path = line.slice(t1 + 1, t2);
    const linenoStr = line.slice(t2 + 1, t3);
    const rawLine = line.slice(t3 + 1);
    const mtime = Number(mtimeStr);
    const lineno = Number(linenoStr);
    if (!Number.isFinite(mtime) || !Number.isFinite(lineno) || path.length === 0) continue;
    hits.push({ mtime, path, lineno, rawLine });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Per-host worker
// ---------------------------------------------------------------------------

interface ResolvedIdentity {
  key: string;
  path: string;
  isArchived: boolean;
}

async function resolveIdentityPaths(
  conn: Parameters<typeof discoverIdentitySessionFile>[0],
): Promise<ResolvedIdentity[]> {
  const [liveKeys, archivedKeys] = await Promise.all([
    listIdentityKeysOnHost(conn).catch(() => [] as string[]),
    listArchivedIdentityKeysOnHost(conn).catch(() => [] as string[]),
  ]);

  // Bulk discovery — ONE SSH exec per host that returns records for ALL
  // JSONLs on the host (mtime-desc sorted). We then match each record's
  // first-user-line against every identity key in a single JS pass, so a
  // host with 150 identities costs one SSH round-trip instead of 150.
  //
  // Pre-fix history: earlier revisions called discoverIdentitySessionFile
  // once per identity via concurrent Promise.all (see review MED-1). Even
  // at concurrency 6 that took ~25s per host on t1000 because each call
  // opens its own SSH exec channel + re-runs the same enumeration script.
  // The batched form drops that to ~1s per host (single channel, single
  // enumeration pass, in-memory match).
  //
  // The identity name in buildDiscoveryScript is comment-only — it never
  // enters a shell primitive and the byte-pattern match happens in JS
  // via __matchesIdentityFirstTurnForTests. So passing an empty string
  // as the "identity name" for the shell script is safe and yields the
  // full corpus back for post-hoc matching.
  const allKeys = [...liveKeys, ...archivedKeys];
  if (allKeys.length === 0) return [];
  const archivedKeySet = new Set<string>(archivedKeys);

  let stdout: string;
  try {
    const script = buildDiscoveryScript(shellSingleQuote(""));
    stdout = await execCommand(
      conn as Parameters<typeof execCommand>[0],
      script,
    );
  } catch {
    return [];
  }
  const records = parseDiscoveryStdout(stdout);
  records.sort((a, b) => b.mtime - a.mtime); // defensive; shell already sorts

  const resolved = new Map<string, ResolvedIdentity>();
  for (const rec of records) {
    if (resolved.size === allKeys.length) break;
    if (rec.firstUserLine.length === 0) continue;
    for (const key of allKeys) {
      if (resolved.has(key)) continue;
      if (__matchesIdentityFirstTurnForTests(rec.firstUserLine, key)) {
        resolved.set(key, {
          key,
          path: rec.path,
          isArchived: archivedKeySet.has(key),
        });
        // First-user-line names exactly one identity; break inner loop.
        break;
      }
    }
  }
  return [...resolved.values()];
}

async function runOneHost(
  conn: Parameters<typeof discoverIdentitySessionFile>[0],
  hostId: number,
  hostName: string,
  query: string,
): Promise<ConversationSearchResult[]> {
  const identities = await resolveIdentityPaths(conn);
  if (identities.length === 0) return [];

  // Build a map path → { key, isArchived } so we can reattach each hit to its
  // originating identity + archived flag after the grep.
  const pathIndex = new Map<string, { key: string; isArchived: boolean }>();
  for (const id of identities) {
    // If two identities share the same JSONL path (rare but possible), the
    // LIVE identity wins — matches the "live is authoritative" preference.
    if (!pathIndex.has(id.path) || !id.isArchived) {
      pathIndex.set(id.path, { key: id.key, isArchived: id.isArchived });
    }
  }

  const cmd = composeGrepCommand(query, Array.from(pathIndex.keys()));
  // conn may be null (LOCAL branch) — execCommand's signature requires a
  // Client. When conn is null in this route we're never called (route only
  // wires REMOTE per candidate host), but the type system doesn't know that
  // here. Cast conservatively.
  const stdout = await execCommand(conn as Parameters<typeof execCommand>[0], cmd);
  const hits = parseGrepOutput(stdout);

  const rows: ConversationSearchResult[] = [];
  for (const hit of hits) {
    const meta = pathIndex.get(hit.path);
    if (!meta) continue; // grep matched a path we didn't feed in — shouldn't happen
    const { snippet, hitStart, hitLength } = snippetForHit(hit.rawLine, query);
    rows.push({
      transcriptPath: hit.path,
      transcriptMtime: hit.mtime * 1000, // shell emits seconds; contract is ms
      identityKey: meta.key,
      hostId,
      hostName,
      aiTitle: null, // deferred per plan Task 2 action item 7 (Open Question 3)
      snippet,
      hitStart,
      hitLength,
      isArchived: meta.isArchived,
      // Fleet convention: identity directory name (meta.key) IS the tmux
      // session name (case-preserving). See conversation-store.ts:906 —
      // fleet sessions populate `targetTmuxSession: session.sessionName`
      // and sessionMatchKey lowercases sessionName to derive identityKey.
      // So the inverse ("identityKey → tmux session") is identity here.
      tmuxSessionName: meta.key,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

router.post(
  "/",
  express.json({ limit: "16kb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // --- Body validation --------------------------------------------------
    const body = req.body as
      | { query?: unknown; offset?: unknown; limit?: unknown }
      | null;

    const rawQuery = body?.query;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

    const rawOffset = body?.offset;
    const offset =
      typeof rawOffset === "number" &&
      Number.isFinite(rawOffset) &&
      Number.isInteger(rawOffset) &&
      rawOffset >= 0
        ? rawOffset
        : 0;

    const rawLimit = body?.limit;
    const limit =
      typeof rawLimit === "number" &&
      Number.isFinite(rawLimit) &&
      Number.isInteger(rawLimit) &&
      rawLimit > 0 &&
      rawLimit <= MAX_LIMIT
        ? rawLimit
        : DEFAULT_LIMIT;

    // Empty-query short-circuit — NO SSH work, NO fan-out.
    if (query.length === 0) {
      return res.json({ results: [], hasMore: false });
    }

    // Query-length cap (T-122-04).
    if (query.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: "query_too_long" });
    }

    // --- Host projection (T-122-02 scoped to caller) ----------------------
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
      sshLogger.debug("conversation-search: host projection failed", {
        operation: "conversation_search_host_projection_failed",
        userId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return res.status(500).json({ error: "host_projection_failed" });
    }

    // --- Fan-out (mirror of sessions.ts:319-566) ---------------------------
    const perHostTimeoutMs = getPerHostTimeoutMs();

    const perHost = await Promise.all(
      candidates.map(async (h): Promise<ConversationSearchResult[]> => {
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
            const rows = await Promise.race<ConversationSearchResult[]>([
              runOneHost(
                conn as unknown as Parameters<
                  typeof discoverIdentitySessionFile
                >[0],
                hostId,
                hostName,
                query,
              ),
              new Promise<ConversationSearchResult[]>((_, reject) =>
                setTimeout(
                  () => reject(new Error("per_host_timeout")),
                  perHostTimeoutMs,
                ),
              ),
            ]);
            return rows;
          } finally {
            try {
              (conn as { end?: () => void }).end?.();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          sshLogger.debug("conversation-search: host skipped", {
            operation: "conversation_search_host_skip",
            hostId,
            hostName,
            error: e instanceof Error ? e.message : "unknown",
          });
          return [];
        }
      }),
    );

    // --- Aggregate → sort desc by mtime → slice offset/limit ---------------
    const flat = perHost.flat();
    flat.sort((a, b) => b.transcriptMtime - a.transcriptMtime);
    const page = flat.slice(offset, offset + limit);
    const hasMore = flat.length > offset + limit;

    return res.json({ results: page, hasMore });
  },
);

export default router;
