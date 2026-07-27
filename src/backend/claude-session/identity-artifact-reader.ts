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
 *   bind-mount is authoritative (e.g. skynet-ec2's own hostId). Parsed once at module load.
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
    // Patch #109: slug is the folder basename, always. bounty.json's `id`
    // field is a UUID — useless for humans. The FOLDER name is what Ashley
    // refers to bounties by in conversation ("close identity-modal-bounty-
    // sorting"). Frontend renders slug alongside title in BountyCard for
    // legibility + copy-paste. Slug never falls back — fallbackId is
    // always populated by the caller (folder entry name).
    slug: fallbackId,
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

  // REMOTE branch — patch #95: shellEscape produces single-quoted
  // 'identityKey', but wrapping that inside outer double-quotes preserves
  // the single quotes as LITERAL path characters (path became
  // $HOME/.claude/identities/'moxie'/'moxie'.md). identityKey is already
  // validated by IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ — none of those
  // characters are shell-special inside double quotes, so direct
  // interpolation is safe. shellEscape is redundant + broken in this
  // wrapping and is dropped for the string readers.
  const cmd = `cat "$HOME/.claude/identities/${identityKey}/${identityKey}.md" 2>/dev/null || true`;
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
  // Patch #95: direct interpolation (see readIdentityFile for the shellEscape
  // + outer double-quote bug this replaces).
  const cmd = `cat "$HOME/.claude/identities/${identityKey}/history.md" 2>/dev/null || true`;
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

// Patch #154: expose `slug` (filename stem, addressability for updates) and
// raw `schedule` (unknown, so the modal's editor can render + edit it
// without a wire-side re-humanization round-trip). Existing fields stay
// so the read shape is a superset.
type Wakeup = {
  slug: string;
  name: string;
  enabled: boolean;
  scheduleHuman: string;
  schedule: unknown;
  instruction: string;
};

// Patch #154: allowed priority set for bounty-priority updates.
export const BOUNTY_PRIORITY_VALUES = [
  "urgent",
  "high",
  "medium",
  "low",
  "unprioritized",
] as const;
export type BountyPriority = (typeof BOUNTY_PRIORITY_VALUES)[number];

// Quick 260727-v0b: allowed status set for bounty-status updates. Defined
// locally (mirrors how BOUNTY_PRIORITY_VALUES is defined above) rather
// than imported from the UI api module, to keep the backend writer
// self-contained. The UI-side BOUNTY_STATUS_VALUES in claude-session-api.ts
// is the wire-side counterpart; both must stay in sync (same 5 values, same
// order — no compile-time cross-check because the module boundary crosses
// bundling contexts).
export const BOUNTY_STATUS_VALUES = [
  "pinned",
  "in_progress",
  "waiting_on_someone_else",
  "done",
  "dropped",
] as const;
export type BountyStatus = (typeof BOUNTY_STATUS_VALUES)[number];

/** Slug regex for wakeup filenames and bounty folder names — kebab/snake,
 *  1-80 chars. Enforced before we ever touch the filesystem so a hostile
 *  slug can't traverse into `..` or otherwise escape the identity dir. */
export const IDENTITY_SLUG_RE = /^[a-z0-9_-]{1,80}$/i;

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
        wakeups.push({ slug: stem, name, enabled, scheduleHuman, schedule: parsed.schedule ?? null, instruction });
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
  // Patch #95: direct interpolation (see readIdentityFile for the bug).
  const cmd =
    `cd "$HOME/.claude/identities/${identityKey}/wakeups" 2>/dev/null && ` +
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
      wakeups.push({ slug: stem, name, enabled, scheduleHuman, schedule: parsed.schedule ?? null, instruction });
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
  // Patch #95: direct interpolation (see readIdentityFile for the bug).
  const cmd = `cat "$HOME/.claude/identities/${identityKey}/handoff.md" 2>/dev/null || true`;
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
  // Patch #95: direct interpolation (see readIdentityFile for the bug).
  const openCmd =
    `cd "$HOME/.claude/identities/${identityKey}/bounties" 2>/dev/null && ` +
    'for d in */; do d="${d%/}"; [ "$d" = "archive" ] && continue; ' +
    '[ -f "$d/bounty.json" ] && echo "===DIR:$d===" && cat "$d/bounty.json"; done';
  const archiveCmd =
    `cd "$HOME/.claude/identities/${identityKey}/bounties/archive" 2>/dev/null && ` +
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

// ---------------------------------------------------------------------------
// 6. writeIdentityWakeupUpdate — patch a single wakeup spec file
// ---------------------------------------------------------------------------
//
// Patch #154: first write path on identity artifacts. Merges `enabled` and/or
// `schedule` into ~/.claude/identities/<key>/wakeups/<slug>.json. The wakeup
// scheduler reloads specs every ~30s (see id skill § Scheduled wake-ups), so
// the change takes effect within one poll — no scheduler restart.
//
// Local branch: JS reads → mutates → writes with 2-space indent.
// Remote branch: python3 one-liner reads → mutates → writes (jq is not
// universally installed on identity boxes; python3 IS, because the scheduler
// itself is python3). The one-liner writes to a temp file and moves into
// place so a mid-write kill can't leave a truncated JSON file.

export type WakeupUpdate = { enabled?: boolean; schedule?: unknown };

/** Merge `updates` into wakeups/<wakeupSlug>.json. Caller validates slug
 *  against IDENTITY_SLUG_RE before invoking. Throws on filesystem/parse errors
 *  or if the spec file doesn't exist. */
export async function writeIdentityWakeupUpdate(
  conn: SSHClientType | null,
  identityKey: string,
  wakeupSlug: string,
  updates: WakeupUpdate,
): Promise<void> {
  // Basic schema guard — refuse a schedule payload that isn't an object with a
  // recognized `type`. We deliberately don't lock down further (the scheduler
  // owns the schema; a new schedule type Nelly adds shouldn't require an
  // atomic co-deploy of Skynet).
  if (updates.schedule !== undefined) {
    if (typeof updates.schedule !== "object" || updates.schedule === null) {
      throw new Error("schedule must be an object");
    }
    const t = (updates.schedule as Record<string, unknown>).type;
    if (typeof t !== "string" || t.length === 0) {
      throw new Error("schedule.type must be a non-empty string");
    }
  }
  if (updates.enabled !== undefined && typeof updates.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "wakeups", wakeupSlug + ".json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (updates.enabled !== undefined) parsed.enabled = updates.enabled;
    if (updates.schedule !== undefined) parsed.schedule = updates.schedule;
    const next = JSON.stringify(parsed, null, 2) + "\n";
    // Atomic-ish write: temp file + rename (fs.writeFile is not atomic on
    // its own; a mid-write crash can leave a truncated file). Same guard the
    // remote branch uses.
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch: python3 reads the file, applies updates from stdin, writes
  // via tmp+rename. `updates` is JSON-encoded and piped in — no shell escaping
  // concerns for the payload itself.
  // We validate slug shape here as a second belt on top of the caller's check;
  // the slug is interpolated into a shell path so this matters.
  if (!IDENTITY_SLUG_RE.test(wakeupSlug)) {
    throw new Error("invalid wakeup slug");
  }
  const script =
    'import json,os,sys\n' +
    'p=sys.argv[1]\n' +
    'u=json.loads(sys.stdin.read())\n' +
    'with open(p,"r") as f: d=json.load(f)\n' +
    'for k,v in u.items(): d[k]=v\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n';
  const payload = JSON.stringify(updates).replace(/'/g, "'\\''");
  const cmd =
    `printf '%s' '${payload}' | python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/wakeups/${wakeupSlug}.json"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 7. writeIdentityBountyPriority — patch bounty.json's priority field
// ---------------------------------------------------------------------------
//
// Patch #154: updates priority + bumps updated_at + appends a one-line
// timeline entry so the priority change is visible in the timeline surface.
// Searches the OPEN bounties dir first (bounties/<slug>/bounty.json), then
// bounces off if not found — archived bounties are terminal (done/dropped)
// and their priority is not a useful edit surface, so we deliberately don't
// touch bounties/archive/*.

export async function writeIdentityBountyPriority(
  conn: SSHClientType | null,
  identityKey: string,
  bountySlug: string,
  priority: BountyPriority,
): Promise<void> {
  if (!BOUNTY_PRIORITY_VALUES.includes(priority)) {
    throw new Error("invalid priority");
  }

  const nowIso = new Date().toISOString();
  const timelineLine = `${nowIso} priority set to ${priority} via identity modal`;

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "bounties", bountySlug, "bounty.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.priority = priority;
    parsed.updated_at = nowIso;
    const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
    tl.push(timelineLine);
    parsed.timeline = tl;
    const next = JSON.stringify(parsed, null, 2) + "\n";
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  if (!IDENTITY_SLUG_RE.test(bountySlug)) {
    throw new Error("invalid bounty slug");
  }
  // Remote branch: python3 script takes the priority + timelineLine via stdin
  // JSON; updated_at is generated in-python from time.time() so the timestamp
  // reflects the box's own clock (matches the id skill's ISO-Z convention).
  const script =
    'import json,os,sys,datetime\n' +
    'p=sys.argv[1]\n' +
    'u=json.loads(sys.stdin.read())\n' +
    'with open(p,"r") as f: d=json.load(f)\n' +
    'd["priority"]=u["priority"]\n' +
    'now=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")\n' +
    'd["updated_at"]=now\n' +
    'tl=d.get("timeline") or []\n' +
    'if not isinstance(tl,list): tl=[]\n' +
    'tl.append(now+" priority set to "+u["priority"]+" via identity modal")\n' +
    'd["timeline"]=tl\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n';
  const payload = JSON.stringify({ priority }).replace(/'/g, "'\\''");
  const cmd =
    `printf '%s' '${payload}' | python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 8. writeIdentityBountyStatus — patch bounty.json's status field
// ---------------------------------------------------------------------------
//
// Quick 260727-v0b: byte-shape mirror of writeIdentityBountyPriority for the
// `status` field. Updates status + bumps updated_at + appends a one-line
// timeline entry ("status set to <new> via identity modal"). Patches
// bounty.json IN PLACE — bounties/<slug>/bounty.json is edited whether the
// new status is done/dropped or anything else. Folder-move between
// bounties/<slug>/ and bounties/archive/<slug>/ is DELIBERATELY out of
// scope (the id skill handles archive population on its own cadence; Ashley
// wants the resurrect flow — click "pinned" on a done/dropped/archived
// bounty — to be a pure JSON patch, not a rename).

export async function writeIdentityBountyStatus(
  conn: SSHClientType | null,
  identityKey: string,
  bountySlug: string,
  status: BountyStatus,
): Promise<void> {
  if (!(BOUNTY_STATUS_VALUES as readonly string[]).includes(status)) {
    throw new Error("invalid status");
  }

  const nowIso = new Date().toISOString();
  const timelineLine = `${nowIso} status set to ${status} via identity modal`;

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "bounties", bountySlug, "bounty.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.status = status;
    parsed.updated_at = nowIso;
    const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
    tl.push(timelineLine);
    parsed.timeline = tl;
    const next = JSON.stringify(parsed, null, 2) + "\n";
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  if (!IDENTITY_SLUG_RE.test(bountySlug)) {
    throw new Error("invalid bounty slug");
  }
  // Remote branch: python3 script takes the status via stdin JSON;
  // updated_at is generated in-python from time.time() so the timestamp
  // reflects the box's own clock (matches patch #154's priority writer).
  const script =
    'import json,os,sys,datetime\n' +
    'p=sys.argv[1]\n' +
    'u=json.loads(sys.stdin.read())\n' +
    'with open(p,"r") as f: d=json.load(f)\n' +
    'd["status"]=u["status"]\n' +
    'now=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")\n' +
    'd["updated_at"]=now\n' +
    'tl=d.get("timeline") or []\n' +
    'if not isinstance(tl,list): tl=[]\n' +
    'tl.append(now+" status set to "+u["status"]+" via identity modal")\n' +
    'd["timeline"]=tl\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n';
  const payload = JSON.stringify({ status }).replace(/'/g, "'\\''");
  const cmd =
    `printf '%s' '${payload}' | python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 9. readIdentityPinnedBountyCount — count of non-archived pinned bounties
// ---------------------------------------------------------------------------
//
// Quick 260727-tb1: cheap counter used by the per-row bounty badge in the
// pretty-conversations panel. Piggybacks on the readIdentityBounties layout
// convention (bounties/<slug>/bounty.json, with an archive/ subdir that must
// be skipped). Returns an integer.
//
// Local branch: fs.readdir the bounties dir, skip "archive", read each
// entry's bounty.json, count where parsed.status === "pinned". Per-file
// parse errors are swallowed as "not pinned" — a single poisoned file
// must not fail the whole count.
//
// Remote branch: python3 one-liner over SSH — grep on the raw JSON is
// fragile (pretty-printed vs single-line vs whitespace variants), so we
// json.load + status.get + count in-process on the far end and print an
// integer to stdout. python3 is universally present on identity boxes
// (the wakeup scheduler itself is python3).

export async function readIdentityPinnedBountyCount(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<number> {
  // Validation guard — reuse the same regex readIdentityBounties uses via
  // the server-side IDENTITY_KEY_RE. Path traversal is the concrete threat.
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const baseDir = path.join(root, identityKey, "bounties");

    let entries: string[];
    try {
      entries = (await fs.readdir(baseDir)).filter((e) => e !== "archive");
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return 0;
      }
      throw err;
    }

    let count = 0;
    for (const entry of entries) {
      const filePath = path.join(baseDir, entry, "bounty.json");
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.status === "pinned") count += 1;
      } catch {
        // Per-file parse/read error → count as "not pinned" (do NOT throw).
      }
    }
    return count;
  }

  // REMOTE branch — one round-trip; python3 emits a single integer to stdout.
  // The identityKey is validated above; the remote path interpolation is
  // safe because the regex forbids shell-special characters.
  const script =
    "import os,json,sys\n" +
    "r=os.path.expanduser(sys.argv[1])\n" +
    "n=0\n" +
    "try:\n" +
    "  ents=os.listdir(r)\n" +
    "except FileNotFoundError:\n" +
    "  print(0); sys.exit(0)\n" +
    "for d in ents:\n" +
    '  if d=="archive": continue\n' +
    '  p=os.path.join(r,d,"bounty.json")\n' +
    "  try:\n" +
    "    with open(p) as f: j=json.load(f)\n" +
    '    if j.get("status")=="pinned": n+=1\n' +
    "  except Exception: pass\n" +
    "print(n)\n";
  const cmd =
    `python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/bounties"`;
  const stdout = await execWithTimeout(conn, cmd);
  const n = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`remote pinned count returned non-integer: ${stdout}`);
  }
  return n;
}
