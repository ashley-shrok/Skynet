/**
 * Shared primitives for finding an agent's history file, plus the
 * `discoverIdentitySessionFile` entry point kept for its existing callers
 * (conversation view, identity birth, spawn worker).
 *
 * The lookup itself lives in `agent-history-file.ts`: the agent's own
 * history folder, newest file whose first real user turn is `/id <name>`.
 * The machine-wide scans that used to live here (every `.jsonl` under
 * `~/.claude/projects/`) are gone — see that file for why they aren't needed.
 *
 * WHY BYTE-PATTERN NOT JSON-PARSE: raw `line.includes` checks are ~40×
 * cheaper than JSON.parse per line and tolerant of minor byte-shape drift.
 * `__matchesIdentityFirstTurnForTests` below is the single source of truth
 * for "is this line `/id <name>`"; the Python sweeps mirror it.
 *
 * LOG EMISSION IS THE CALLER'S RESPONSIBILITY: this module logs nothing; a
 * failed lookup returns null and the caller logs.
 */

import os from "node:os";
import path from "node:path";
import type { Client } from "ssh2";
import { findAgentHistoryFile } from "./agent-history-file.js";

/**
 * Returns the local Claude Code projects root — the parent of the per-cwd
 * subfolders the Claude CLI writes transcripts into.
 *
 * Routes through HOME_HOST_DIR (bind-mount path inside the Skynet container,
 * typically `/host-home`) with os.homedir() as the dev fallback. The
 * container's host-home mount exposes `~/.claude/projects/` at
 * `/host-home/.claude/projects/` — same shape as the direct dev path.
 *
 * Previously used a dedicated `CLAUDE_PROJECTS_HOST_DIR` env + its own
 * `/host-claude-projects` bind mount; retired 2026-09-18 when the host-home
 * mount was widened from `~/fleet` to `~/` (see local-fleet-install.ts for
 * the widening rationale), making the dedicated projects mount redundant.
 *
 * Consumed by discoverIdentitySessionFile's LOCAL branch (conn === null),
 * which is exercised by identity-birth-orchestrator's supervisor-wait for
 * co-located births (isLocalHostId=true).
 */
export function getLocalClaudeProjectsRoot(): string {
  const homeRoot = process.env.HOME_HOST_DIR || os.homedir();
  return path.join(homeRoot, ".claude", "projects");
}

/**
 * Translate a container-perspective path (rooted under `HOME_HOST_DIR`, e.g.
 * `/host-home/.claude/projects/.../uuid.jsonl`) into the equivalent
 * host-perspective path (rooted under `SKYNET_HOME_MOUNT_SRC`, e.g.
 * `/home/ubuntu/.claude/projects/.../uuid.jsonl`).
 *
 * Why this exists: `readLocalDiscovery` below walks the directory tree using
 * container-perspective paths (that's the only shape node's `fs` sees inside
 * the Skynet container — the host home is bind-mounted at `HOME_HOST_DIR`).
 * But the discovered path is HANDED BACK to callers who write it to the
 * fleet-status `sessionFileCache`, and every downstream consumer of that
 * cache entry (the connect-time `totalLines` probe in
 * `claude-session-server.ts:6076`, the `tail -F` in `session-file-tail.ts`,
 * `fetch_older_range` handling in `session-file-range-reader.ts`) runs the
 * path through SSH exec against `ubuntu@t1000`. The SSH session sees the
 * HOST filesystem, where `/host-home` doesn't exist — only
 * `${SKYNET_HOME_MOUNT_SRC}` does (the source side of the bind mount). So a
 * container-perspective path reaching SSH fails with "No such file or
 * directory" and the caller silently falls back to a degraded default
 * (totalLines: 0 → pretty-view's load-more button never appears, per the
 * `hasOlderMessages` gate at `PrettyView.tsx:3708-3711`).
 *
 * Failure symmetry: `discoverClaudeSessionBatched` (the SSH branch of
 * discovery) has this right already — it builds paths from `$HOME` inside
 * the SSH session, which resolves to `/home/ubuntu` (host-perspective).
 * `discoverIdentitySessionFileLocal` (the in-container fs branch) is the
 * odd one out, so translation happens here at the source. Fixing at the
 * source means every downstream SSH consumer (probe, tail, range-reader)
 * gets the right shape without needing per-consumer translation.
 *
 * No-op when either env var is unset — a native-dev run has neither, so
 * `getLocalClaudeProjectsRoot` falls back to `os.homedir()` (already
 * host-perspective) and translation is a pass-through. Any Skynet compose
 * install has BOTH set (Dockerfile pins `HOME_HOST_DIR=/host-home`; the
 * compose file hard-fails without `SKYNET_HOME_MOUNT_SRC`).
 *
 * Also a no-op for paths that don't sit under `HOME_HOST_DIR` (defensive
 * — the discovery walker only produces paths under it, but this guard
 * means a caller can pass any path through safely).
 */
export function toHostPerspectivePath(p: string): string {
  const containerHome = process.env.HOME_HOST_DIR;
  const hostHome = process.env.SKYNET_HOME_MOUNT_SRC;
  if (!containerHome || !hostHome) return p;
  if (p !== containerHome && !p.startsWith(containerHome + "/")) return p;
  return hostHome + p.slice(containerHome.length);
}

/**
 * Hard ceiling on one history-lookup exec. The lookup now reads one folder
 * per agent, so it normally returns in milliseconds; the generous ceiling
 * only bounds a hung SSH exec on a heavily loaded host.
 */
export const DISCOVERY_EXEC_TIMEOUT_MS = 30_000;

/**
 * The four delimiter characters that MAY appear immediately after the
 * identity name inside `<command-args>` per D-01:
 *   - `<` : the empirical case (closes with `</command-args>`).
 *   - ` ` (space) : hypothetical multi-token args (`<command-args>tanya extra>`).
 *   - `\r` : Windows-line-ending edge case.
 *   - end-of-line : the JSONL line ends immediately after the identity name.
 *
 * The guard REFUSES partial-name matches: `<command-args>tiff<` MUST NOT
 * match identity `tiffany`. This is the load-bearing correctness property
 * of D-01.
 */
const DELIMITER_SET = new Set(["<", " ", "\r"]);

/**
 * Byte-pattern predicate: returns true iff `line` represents a REAL Claude
 * Code first user turn that invoked `/id <identityName>` (with a strict
 * delimiter check refusing partial-name matches per D-01).
 *
 * Load-bearing checks (in order):
 *   1. Line contains `"type":"user"` AND does NOT contain `"tool_result"`
 *      (self-contained here — this module stays independent per D-09).
 *   2. Line contains `<command-name>/id</command-name>` (literal).
 *   3. Line contains `<command-args><identityName>` where the character
 *      immediately after the identity name is one of `<`, ` `, `\r`, or
 *      end-of-line.
 *
 * All checks are `line.includes` or single-index char checks. ZERO
 * JSON.parse — the byte-shape assumption is captured entirely here.
 *
 * Exported for unit testing under the established `__forTests` convention
 * (see the `claude-session-server.ts` seams).
 *
 * @param line — one raw JSONL line (the first user-role line of a file).
 * @param identityName — the identity to match (e.g. `tanya`, `tiffany`).
 */
export function __matchesIdentityFirstTurnForTests(
  line: string,
  identityName: string,
): boolean {
  // 1. Outer shape must be a real user-role turn.
  if (!line.includes('"type":"user"')) return false;
  if (line.includes('"tool_result"')) return false;
  // 2. Must be the /id slash-command.
  if (!line.includes("<command-name>/id</command-name>")) return false;
  // 3. Must be `<command-args><identityName>` followed by a valid delimiter.
  const argsTag = "<command-args>";
  const argsIdx = line.indexOf(argsTag);
  if (argsIdx === -1) return false;
  const nameStart = argsIdx + argsTag.length;
  // Verify the identity name literally appears at nameStart.
  // Using startsWith on a slice is a single scan and avoids a regex.
  const nameEnd = nameStart + identityName.length;
  if (line.slice(nameStart, nameEnd) !== identityName) return false;
  // Delimiter check: char at nameEnd must be `<`, ` `, `\r`, or line-end.
  // EOL is expressed as "nameEnd >= line.length" (no character exists at
  // that position — the identity name is the last thing on the line).
  if (nameEnd >= line.length) return true;
  const delimiter = line[nameEnd];
  return DELIMITER_SET.has(delimiter);
}

/**
 * Single-quote-wrap a string for use as a shell literal. Same pattern used
 * at `session-file-tail.ts:27` and `claude-session-server.ts:4660-4664`.
 * The identity name is already validated to a safe subset upstream at the
 * WS-attach layer; this is defense-in-depth per T-32-01.
 */
export function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Locate the identity's history file: newest `.jsonl` in its own history
 * folder whose first real user turn is `/id <identityName>`, or null.
 * `conn === null` reads the co-located host through the container mount.
 * Fail-safe: never throws; any transport error / timeout → null.
 */
export async function discoverIdentitySessionFile(
  conn: Client | null,
  identityName: string,
): Promise<string | null> {
  return findAgentHistoryFile(conn, identityName);
}
