/**
 * identity-artifact-reader.ts — Patch #92: shared helper for identity artifact reads.
 *
 * TWO BRANCHES:
 * - LOCAL branch (conn === null): reads from IDENTITIES_HOST_DIR bind-mount (patch #89
 *   fast-path). Used when the pane's hostId is in the IDENTITIES_LOCAL_HOST_IDS allowlist.
 *   Byte-identical to the pre-#92 server.ts handlers — preserves tina's use case.
 * - REMOTE branch (conn is SSHClientType): reads over SSH via execCommand from
 *   src/backend/ssh/tmux-helper.ts. Caller (claude-session-server.ts) opens a fresh
 *   connectOneShot per handler and .end()s it in try/finally (R4 decision: independent
 *   of the pane's own sshConn; identity handlers are one-shot WS connections).
 *
 * ROUTING (in server.ts): `isLocalHostId(hostId)` returns true when the hostId is in the
 * IDENTITIES_LOCAL_HOST_IDS env allowlist. Missing/invalid hostId falls back to LOCAL
 * branch (backward compat with pre-#92 clients — no breakage on deploy day).
 *
 * ENV VARS:
 * - IDENTITIES_LOCAL_HOST_IDS: comma-separated positive integer hostIds for which the
 *   bind-mount is authoritative (e.g. termix-ec2's own hostId). Parsed once at module load.
 * - IDENTITIES_HOST_DIR: the bind-mount path (patch #89). Used by getLocalIdentitiesRoot().
 *
 * SSH EXEC: all remote reads use execCommand from tmux-helper.ts (R3). Each call wrapped
 * in Promise.race with REMOTE_EXEC_TIMEOUT_MS (3000ms) so the modal stays responsive on
 * unreachable boxes (R3 / T-3n2-04). Timeout or SSH-layer exception → throws; server.ts
 * catches and emits error response.
 *
 * SHELL SAFETY: identityKey is regex-validated by IDENTITY_KEY_RE before reaching this
 * module, AND single-quoted by shellEscape() as defense-in-depth (T-3n2-01).
 *
 * PATH EXPANSION: remote commands use "$HOME" (not tilde ~) — shell-expanded by the
 * remote sshd login shell, consistent with patch #43 execCommand consumers (R3).
 */

import os from "os";
import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";
import { sshLogger } from "../utils/logger.js";
import { execCommand } from "../ssh/tmux-helper.js";

// ---------------------------------------------------------------------------
// Wakeup schedule humanizer (exported so server.ts can import it instead of
// maintaining a duplicate; replaces the now-private copy in server.ts)
// ---------------------------------------------------------------------------

/**
 * Humanize a wakeup schedule object into a human-readable string.
 * Handles interval / daily / weekly schedule types; falls back to "custom schedule".
 * Exported so claude-session-server.ts can re-export it (patch #92: moved here to
 * avoid a circular dependency — artifact reader must not import from server.ts).
 */
export function humanizeWakeupSchedule(schedule: unknown): string {
  if (typeof schedule !== "object" || schedule === null) return "custom schedule";
  const s = schedule as Record<string, unknown>;
  const type = s.type;
  if (type === "interval") {
    const every = s.every;
    if (typeof every === "string" && every.length > 0) {
      return `Every ${every}`;
    }
    if (typeof every === "number") {
      return `Every ${every}m`;
    }
    return "custom schedule";
  }
  if (type === "daily") {
    const at = typeof s.at === "string" ? s.at : "";
    return at ? `Daily at ${at} (box-local)` : "Daily (box-local)";
  }
  if (type === "weekly") {
    const at = typeof s.at === "string" ? s.at : "";
    const dayRaw = typeof s.day === "string" ? s.day : "";
    const day = dayRaw.length > 0
      ? dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1).toLowerCase()
      : "?";
    return at ? `Weekly on ${day} at ${at} (box-local)` : `Weekly on ${day} (box-local)`;
  }
  return "custom schedule";
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Shared validator for identity keys — matches the 5 inline copies in server.ts pre-#92. */
export const IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Module-load: parse IDENTITIES_LOCAL_HOST_IDS once
// ---------------------------------------------------------------------------

const LOCAL_HOST_IDS = new Set<number>();
(function parseLocalHostIds() {
  const raw = process.env.IDENTITIES_LOCAL_HOST_IDS ?? "";
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) continue; // skip malformed
    LOCAL_HOST_IDS.add(n);
  }
})();

// ---------------------------------------------------------------------------
// Routing predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when `hostId` is in the IDENTITIES_LOCAL_HOST_IDS allowlist,
 * meaning the local bind-mount (IDENTITIES_HOST_DIR) is authoritative for this host.
 *
 * Returns false for undefined, zero, NaN, negative, non-integer, or any hostId
 * not in the parsed set. Fail-safe: any deploy that forgets IDENTITIES_LOCAL_HOST_IDS
 * will fall through to SSH (still correct — just skips the bind-mount fast-path).
 */
export function isLocalHostId(hostId: number | undefined): boolean {
  if (hostId === undefined || !Number.isFinite(hostId) || hostId <= 0) return false;
  return LOCAL_HOST_IDS.has(hostId);
}

// ---------------------------------------------------------------------------
// Local identities root (patch #89 pattern, byte-identical)
// ---------------------------------------------------------------------------

/**
 * Returns the local identities root directory.
 * Prefer IDENTITIES_HOST_DIR (bind-mount) over os.homedir() fallback (dev path).
 */
export function getLocalIdentitiesRoot(): string {
  return (
    process.env.IDENTITIES_HOST_DIR ||
    path.join(os.homedir(), ".claude", "identities")
  );
}

// ---------------------------------------------------------------------------
// Shell escape (3-line copy from session-file-tail.ts — same implementation)
// ---------------------------------------------------------------------------

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Timeout constant
// ---------------------------------------------------------------------------

const REMOTE_EXEC_TIMEOUT_MS = 3000;

/** Wrap a remote execCommand in a 3-second Promise.race timeout. */
async function execWithTimeout(
  conn: SSHClientType,
  command: string,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`remote exec timeout after ${REMOTE_EXEC_TIMEOUT_MS}ms`)),
        REMOTE_EXEC_TIMEOUT_MS,
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Bounty normalization helper (shared between local + remote branches,
// open + archive paths — single source of truth for safe defaults)
// ---------------------------------------------------------------------------

function normalizeBounty(parsed: Record<string, unknown>, fallbackId: string): unknown {
  return {
    id: typeof parsed.id === "string" ? parsed.id : fallbackId,
    title: typeof parsed.title === "string" ? parsed.title : "",
    premise: typeof parsed.premise === "string" ? parsed.premise : "",
    status: typeof parsed.status === "string" ? parsed.status : "",
    priority:
      typeof parsed.priority === "string" ? parsed.priority : "unprioritized",
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    requested_by:
      typeof parsed.requested_by === "string" ? parsed.requested_by : null,
    created_at: typeof parsed.created_at === "string" ? parsed.created_at : "",
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
    timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
  };
}

// ---------------------------------------------------------------------------
// 1. readIdentityFile — <key>/<key>.md
// ---------------------------------------------------------------------------

/** Result shape for identity file reads. Matches the wire shape "identity:identity-file". */
export async function readIdentityFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, identityKey + ".md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #94: append `|| true` so cat's exit-1 on missing
  // file resolves as empty stdout (execCommand's `code !== 0 && stdout ===
  // ""` rejects otherwise; there IS no stderr because we redirected it, so
  // the reject surfaces as an opaque "Command exited with code 1" in the
  // modal — that was Ashley's #92 deploy eyeball bug on workstation panes
  // where the target identity has no file at the expected path). Empty
  // stdout is treated as "missing artifact = empty state" by callers.
  const escapedKey = shellEscape(identityKey);
  const cmd = 'cat "$HOME/.claude/identities/' + escapedKey + '/' + escapedKey + '.md" 2>/dev/null || true';
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

// ---------------------------------------------------------------------------
// 2. readIdentityHistory — <key>/history.md
// ---------------------------------------------------------------------------

/** Result shape for history reads. Matches the wire shape "identity:history". */
export async function readIdentityHistory(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ entries: string[] }> {
  if (conn === null) {
    // LOCAL branch (mirrors server.ts lines 1275-1281)
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "history.md");
    try {
      const contents = await fs.readFile(filePath, "utf-8");
      const entries = contents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .reverse();
      return { entries };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { entries: [] };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #94: `|| true` so missing history.md resolves as
  // empty stdout instead of throwing "Command exited with code 1".
  const escapedKey = shellEscape(identityKey);
  const cmd = 'cat "$HOME/.claude/identities/' + escapedKey + '/history.md" 2>/dev/null || true';
  const stdout = await execWithTimeout(conn, cmd);
  if (!stdout) return { entries: [] };
  const entries = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reverse();
  return { entries };
}

// ---------------------------------------------------------------------------
// 3. readIdentityWakeups — <key>/wakeups/*.json
// ---------------------------------------------------------------------------

type Wakeup = { name: string; enabled: boolean; scheduleHuman: string; instruction: string };

/** Result shape for wakeups reads. Matches the wire shape "identity:wakeups". */
export async function readIdentityWakeups(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ wakeups: Wakeup[] }> {
  if (conn === null) {
    // LOCAL branch (mirrors server.ts lines 1319-1351)
    const root = getLocalIdentitiesRoot();
    const wakeupsDir = path.join(root, identityKey, "wakeups");
    let dirEntries: string[];
    try {
      dirEntries = await fs.readdir(wakeupsDir);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { wakeups: [] };
      }
      throw err;
    }
    const jsonFiles = dirEntries.filter((e) => e.endsWith(".json"));
    const wakeups: Wakeup[] = [];
    for (const filename of jsonFiles) {
      const filePath = path.join(wakeupsDir, filename);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const stem = filename.replace(/\.json$/, "");
        const name = typeof parsed.name === "string" ? parsed.name : stem;
        const enabled =
          typeof parsed.enabled === "boolean" ? parsed.enabled : false;
        const instruction =
          typeof parsed.instruction === "string" ? parsed.instruction : "";
        const scheduleHuman = humanizeWakeupSchedule(parsed.schedule);
        wakeups.push({ name, enabled, scheduleHuman, instruction });
      } catch (err) {
        sshLogger.error(
          "identity-artifact-reader: failed to parse local wakeup JSON",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "identity_wakeups_local_parse_error",
            identityKey,
            filename,
          },
        );
        // Skip poisoned entry — one bad file must not poison the list.
      }
    }
    return { wakeups };
  }

  // REMOTE branch — delimiter-based one-liner (one round-trip for all wakeup files)
  const escapedKey = shellEscape(identityKey);
  const cmd =
    'cd "$HOME/.claude/identities/' + escapedKey + '/wakeups" 2>/dev/null && ' +
    'for f in *.json; do echo "===FILE:$f==="; cat "$f"; done';
  let stdout: string;
  try {
    stdout = await execWithTimeout(conn, cmd);
  } catch {
    // Wakeups dir likely doesn't exist — treat as empty (matches ENOENT semantics).
    return { wakeups: [] };
  }

  if (!stdout) return { wakeups: [] };

  const wakeups: Wakeup[] = [];
  // Split on ===FILE: delimiter; first chunk is empty (before the first marker).
  const chunks = stdout.split("===FILE:");
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    // chunk = "<filename>.json===\n<json content>"
    const separatorIdx = chunk.indexOf("===");
    if (separatorIdx === -1) continue;
    const filename = chunk.slice(0, separatorIdx).trim();
    const jsonContent = chunk.slice(separatorIdx + 3).trim();
    if (!filename.endsWith(".json") || !jsonContent) continue;
    try {
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;
      const stem = filename.replace(/\.json$/, "");
      const name = typeof parsed.name === "string" ? parsed.name : stem;
      const enabled =
        typeof parsed.enabled === "boolean" ? parsed.enabled : false;
      const instruction =
        typeof parsed.instruction === "string" ? parsed.instruction : "";
      const scheduleHuman = humanizeWakeupSchedule(parsed.schedule);
      wakeups.push({ name, enabled, scheduleHuman, instruction });
    } catch (err) {
      sshLogger.error(
        "identity-artifact-reader: failed to parse remote wakeup JSON",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "identity_wakeups_remote_parse_error",
          identityKey,
          filename,
        },
      );
      // Skip poisoned entry.
    }
  }
  return { wakeups };
}

// ---------------------------------------------------------------------------
// 4. readIdentityHandoff — <key>/handoff.md
// ---------------------------------------------------------------------------

/** Result shape for handoff reads. Matches the wire shape "identity:handoff". */
export async function readIdentityHandoff(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "handoff.md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #94: `|| true` so missing handoff.md resolves as
  // empty stdout instead of throwing "Command exited with code 1".
  const escapedKey = shellEscape(identityKey);
  const cmd = 'cat "$HOME/.claude/identities/' + escapedKey + '/handoff.md" 2>/dev/null || true';
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

// ---------------------------------------------------------------------------
// 5. readIdentityBounties — <key>/bounties/ (open) + <key>/bounties/archive/ (archived)
// ---------------------------------------------------------------------------

/** Result shape for bounties reads. Matches the wire shape "identity:bounties". */
export async function readIdentityBounties(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ bounties: unknown[]; archivedBounties: unknown[] }> {
  if (conn === null) {
    // LOCAL branch (mirrors server.ts lines 1064-1184)
    const root = getLocalIdentitiesRoot();
    const baseDir = path.join(root, identityKey, "bounties");

    // Read open bounties (all subdirs of baseDir EXCEPT "archive")
    let openEntries: string[];
    try {
      openEntries = (await fs.readdir(baseDir)).filter((e) => e !== "archive");
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { bounties: [], archivedBounties: [] };
      }
      throw err;
    }

    const bounties: unknown[] = [];
    for (const entry of openEntries) {
      const filePath = path.join(baseDir, entry, "bounty.json");
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        bounties.push(normalizeBounty(parsed, entry));
      } catch (err) {
        sshLogger.error(
          "identity-artifact-reader: failed to parse local open bounty.json",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "identity_bounties_local_parse_error",
            identityKey,
            filePath,
          },
        );
        // Skip poisoned entry.
      }
    }

    // Archived bounties
    const archiveDir = path.join(baseDir, "archive");
    let archiveEntries: string[];
    try {
      archiveEntries = await fs.readdir(archiveDir);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        archiveEntries = [];
      } else {
        throw err;
      }
    }

    const archivedBounties: unknown[] = [];
    for (const entry of archiveEntries) {
      const filePath = path.join(archiveDir, entry, "bounty.json");
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        archivedBounties.push(normalizeBounty(parsed, entry));
      } catch (err) {
        sshLogger.error(
          "identity-artifact-reader: failed to parse local archive bounty.json",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "identity_bounties_archive_local_parse_error",
            identityKey,
            filePath,
          },
        );
        // Skip poisoned entry.
      }
    }

    return { bounties, archivedBounties };
  }

  // REMOTE branch — two commands in parallel (open + archive) via Promise.all,
  // delimiter-based dir enumeration (one round-trip per artifact per R5).
  const escapedKey = shellEscape(identityKey);
  const openCmd =
    'cd "$HOME/.claude/identities/' + escapedKey + '/bounties" 2>/dev/null && ' +
    'for d in */; do d="${d%/}"; [ "$d" = "archive" ] && continue; ' +
    '[ -f "$d/bounty.json" ] && echo "===DIR:$d===" && cat "$d/bounty.json"; done';
  const archiveCmd =
    'cd "$HOME/.claude/identities/' + escapedKey + '/bounties/archive" 2>/dev/null && ' +
    'for d in */; do d="${d%/}"; ' +
    '[ -f "$d/bounty.json" ] && echo "===DIR:$d===" && cat "$d/bounty.json"; done';

  const [openStdout, archiveStdout] = await Promise.all([
    execWithTimeout(conn, openCmd).catch(() => ""),
    execWithTimeout(conn, archiveCmd).catch(() => ""),
  ]);

  function parseDelimited(stdout: string, identityKeyForLog: string, isArchive: boolean): unknown[] {
    const results: unknown[] = [];
    if (!stdout) return results;
    const chunks = stdout.split("===DIR:");
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const separatorIdx = chunk.indexOf("===");
      if (separatorIdx === -1) continue;
      const dirName = chunk.slice(0, separatorIdx).trim();
      const jsonContent = chunk.slice(separatorIdx + 3).trim();
      if (!dirName || !jsonContent) continue;
      try {
        const parsed = JSON.parse(jsonContent) as Record<string, unknown>;
        results.push(normalizeBounty(parsed, dirName));
      } catch (err) {
        sshLogger.error(
          `identity-artifact-reader: failed to parse remote ${isArchive ? "archive " : ""}bounty.json`,
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: isArchive
              ? "identity_bounties_archive_remote_parse_error"
              : "identity_bounties_remote_parse_error",
            identityKey: identityKeyForLog,
            dirName,
          },
        );
        // Skip poisoned entry.
      }
    }
    return results;
  }

  const bounties = parseDelimited(openStdout, identityKey, false);
  const archivedBounties = parseDelimited(archiveStdout, identityKey, true);

  return { bounties, archivedBounties };
}
