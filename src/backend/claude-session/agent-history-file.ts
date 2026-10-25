/**
 * agent-history-file.ts — THE way Skynet finds an agent's conversation
 * history file. Every caller (conversation view, sidebar status poll, memory
 * pie, search, birth confirmation) goes through here.
 *
 * Claude Code names each project folder after the REAL path of the directory
 * it was launched in (every non-alphanumeric character → `-`), and the supervisor launches
 * every identity in its own `~/fleet/identities/<name>/workspace/`. So an
 * agent's history lives in exactly one folder, known from its name alone:
 *
 *   ~/.claude/projects/<mangled ~/fleet/identities/<name>/workspace>/
 *
 * Archiving moves the identity folder but not the transcripts, so the same
 * lookup works for running, sleeping and archived agents.
 *
 * Inside that folder, an agent's history is the NEWEST `.jsonl` whose first
 * real user turn is `/id <name>` (harness records such as `mode` /
 * `file-history-snapshot` / `queue-operation` that precede it carry no
 * `"role":"user"` and are skipped). Files started some other way — someone
 * running a bare `claude` in the workspace while testing — are never picked.
 * Since Condense, an agent keeps one file for life; the newest-wins rule only
 * matters for agents that predate it.
 *
 * Deliberately NOT here: any machine-wide scan, any fallback outside the
 * agent's own folder, and any use of the agent's terminal or Claude process.
 *
 * The agent-supervisor's `_scan_dir_newest_owned` is the shell precedent; the
 * Python sweeps (pv-context-pct-sweep, fleet-status-sweep) carry the same rule.
 */

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "ssh2";
import { execCommand } from "../ssh/tmux-helper.js";
import {
  __matchesIdentityFirstTurnForTests as matchesIdentityFirstTurn,
  getLocalClaudeProjectsRoot,
  shellSingleQuote,
  toHostPerspectivePath,
  DISCOVERY_EXEC_TIMEOUT_MS,
} from "./discover-identity-session-file.js";

/** Bytes read from the head of each candidate file to find its first user turn. */
export const HISTORY_HEAD_BYTES = 4096;

/** Identity names that may be interpolated into the lookup (defense in depth). */
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Claude Code's project-folder rule: every non-alphanumeric char becomes `-`. */
export function claudeProjectFolderName(launchDir: string): string {
  return launchDir.replace(/[^a-zA-Z0-9]/g, "-");
}

/** The project-folder name for an identity whose host home is `home`. */
export function agentHistoryFolderName(home: string, identityName: string): string {
  return claudeProjectFolderName(
    `${home.replace(/\/+$/, "")}/fleet/identities/${identityName}/workspace`,
  );
}

const RECORD_SEP = "---AGENT-HISTORY---";

/**
 * One-round-trip shell script: for each name, list the `.jsonl` files in that
 * agent's own history folder (mtime-desc) and emit, per file,
 *   `NAME\tMTIME\tPATH\n<first "role":"user" line in the head>\n---AGENT-HISTORY---\n`
 * Matching happens in JS (`pickNewestOwned`) so the rule is unit-testable and
 * the name never reaches a grep pattern. Names are validated and single-quoted.
 */
export function buildAgentHistoryScript(identityNames: readonly string[]): string {
  const names = identityNames.filter((n) => SAFE_NAME_RE.test(n));
  if (names.length === 0) return "true";
  // LOAD-BEARING: joined on one line — every statement ends with `;`.
  return (
    // Claude names the folder after the launch dir's REAL path — where $HOME
    // is a symlink (Bazzite/Silverblue: /home → /var/home) the name must use
    // the resolved home, while the folder itself is still reached via $HOME.
    `RH=$(cd "$HOME" 2>/dev/null && pwd -P); [ -n "$RH" ] || RH="$HOME"; ` +
    `for N in ${names.map(shellSingleQuote).join(" ")}; do ` +
    `  D="$HOME/.claude/projects/$(printf '%s' "$RH/fleet/identities/$N/workspace" | sed 's/[^a-zA-Z0-9]/-/g')"; ` +
    `  [ -d "$D" ] || continue; ` +
    `  find "$D" -maxdepth 1 -type f -name '*.jsonl' -printf '%T@ %p\\n' 2>/dev/null | sort -rn | ` +
    `  while IFS=' ' read -r mtime path; do ` +
    `    printf '%s\\t%s\\t%s\\n' "$N" "$mtime" "$path"; ` +
    `    head -c ${HISTORY_HEAD_BYTES} "$path" 2>/dev/null | grep -m 1 '"role":"user"' || printf '\\n'; ` +
    `    printf '%s\\n' '${RECORD_SEP}'; ` +
    `  done; ` +
    `done`
  );
}

export type AgentHistoryRecord = {
  name: string;
  mtime: number;
  path: string;
  firstUserLine: string;
};

export function parseAgentHistoryStdout(stdout: string): AgentHistoryRecord[] {
  const out: AgentHistoryRecord[] = [];
  if (!stdout) return out;
  for (const raw of stdout.split(`\n${RECORD_SEP}`)) {
    const chunk = raw.startsWith("\n") ? raw.slice(1) : raw;
    if (!chunk) continue;
    const nl = chunk.indexOf("\n");
    if (nl === -1) continue;
    const header = chunk.slice(0, nl).split("\t");
    if (header.length !== 3) continue;
    const [name, mtimeStr, p] = header;
    const mtime = parseFloat(mtimeStr);
    if (!name || !p || !Number.isFinite(mtime)) continue;
    let firstUserLine = chunk.slice(nl + 1);
    if (firstUserLine.endsWith("\n")) firstUserLine = firstUserLine.slice(0, -1);
    out.push({ name, mtime, path: p, firstUserLine });
  }
  return out;
}

/**
 * Newest record per name whose first user turn is that name's `/id` load.
 * Every requested name appears in the result (null when it has none).
 */
export function pickNewestOwned(
  identityNames: readonly string[],
  records: readonly AgentHistoryRecord[],
): Map<string, string | null> {
  const best = new Map<string, { path: string; mtime: number }>();
  for (const r of records) {
    if (!matchesIdentityFirstTurn(r.firstUserLine, r.name)) continue;
    const cur = best.get(r.name);
    if (!cur || r.mtime > cur.mtime) best.set(r.name, { path: r.path, mtime: r.mtime });
  }
  const result = new Map<string, string | null>();
  for (const n of identityNames) result.set(n, best.get(n)?.path ?? null);
  return result;
}

/** Runs a shell command on the target host; null = transport failure. */
export type HistoryExec = (script: string) => Promise<string | null>;

/**
 * Batched lookup over any exec channel (ssh2 client, fleet-status SshChannel).
 * Throws on transport failure / timeout so callers can tell "not found"
 * (null entry) from "couldn't look".
 */
export async function findAgentHistoryFilesVia(
  exec: HistoryExec,
  identityNames: readonly string[],
): Promise<Map<string, string | null>> {
  const names = identityNames.filter((n) => SAFE_NAME_RE.test(n));
  if (names.length === 0) return pickNewestOwned(identityNames, []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stdout = await Promise.race([
      exec(buildAgentHistoryScript(names)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`agent-history lookup timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`)),
          DISCOVERY_EXEC_TIMEOUT_MS,
        );
      }),
    ]);
    if (stdout === null) throw new Error("agent-history lookup: exec returned null");
    return pickNewestOwned(identityNames, parseAgentHistoryStdout(stdout));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Batched lookup over an ssh2 client. Throws on transport failure. */
export function findAgentHistoryFiles(
  conn: Client,
  identityNames: readonly string[],
): Promise<Map<string, string | null>> {
  return findAgentHistoryFilesVia((s) => execCommand(conn, s), identityNames);
}

/**
 * Single-agent lookup. `conn === null` reads the bind-mounted host home from
 * inside the container (co-located host). Returns the host-perspective path,
 * or null when the agent has no history yet OR the lookup couldn't run
 * (fail-safe: callers treat both as "nothing to show yet").
 */
export async function findAgentHistoryFile(
  conn: Client | null,
  identityName: string,
): Promise<string | null> {
  if (!SAFE_NAME_RE.test(identityName)) return null;
  try {
    if (conn === null) return await findAgentHistoryFileLocal(identityName);
    return (await findAgentHistoryFiles(conn, [identityName])).get(identityName) ?? null;
  } catch {
    return null;
  }
}

/**
 * LOCAL branch: same rule via node fs. The folder NAME comes from the host's
 * home path (Claude named it on the host), while the folder is READ through
 * the container's mount; the returned path is translated back to the host
 * perspective because every downstream reader runs over SSH.
 */
async function findAgentHistoryFileLocal(identityName: string): Promise<string | null> {
  // Claude named the folder on the host, so name it from the HOST home
  // (SKYNET_HOME_MOUNT_SRC in a compose install; native dev = os.homedir()).
  const hostHome = process.env.SKYNET_HOME_MOUNT_SRC || (await fsp.realpath(os.homedir()).catch(() => os.homedir()));
  const dir = path.join(getLocalClaudeProjectsRoot(), agentHistoryFolderName(hostHome, identityName));
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const records: AgentHistoryRecord[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    const full = path.join(dir, e.name);
    try {
      const st = await fsp.stat(full);
      records.push({
        name: identityName,
        mtime: st.mtimeMs,
        path: full,
        firstUserLine: (await readFirstUserLine(full)) ?? "",
      });
    } catch {
      continue;
    }
  }
  const found = pickNewestOwned([identityName], records).get(identityName) ?? null;
  return found === null ? null : toHostPerspectivePath(found);
}

async function readFirstUserLine(filePath: string): Promise<string | null> {
  const handle = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(HISTORY_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HISTORY_HEAD_BYTES, 0);
    for (const line of buf.subarray(0, bytesRead).toString("utf8").split("\n")) {
      if (line.includes('"role":"user"')) return line;
    }
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}
