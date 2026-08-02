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
type SFTPWrapper = import("ssh2").SFTPWrapper;
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
    // Patch #172 / quick 260728-sqk: independent boolean field (fleet
    // migration #168 by Nelly, 2026-07-28). Orthogonal to lifecycle
    // `status`; defaulted to false when absent from bounty.json so both
    // open and archive payloads always carry the flag to the frontend.
    pinned: typeof parsed.pinned === "boolean" ? parsed.pinned : false,
    // Phase 18 / IDMEDIT-04: three new pass-through fields for the bounty
    // field editor (Plan 18-04/18-05). Safe defaults match the existing
    // pattern (keywords/todos above). Pre-existing bounty.json files that
    // lack these fields get the safe default on every read — no migration
    // needed. Frontend consumers see [] / null rather than undefined.
    source_links: Array.isArray(parsed.source_links) ? parsed.source_links : [],
    deadline: typeof parsed.deadline === "string" ? parsed.deadline : null,
    meeting_questions: Array.isArray(parsed.meeting_questions) ? parsed.meeting_questions : [],
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

/** Result shape for history reads. Matches the wire shape "identity:history".
 * Phase 18 / IDMEDIT-02: widened to also carry `markdown` (raw file body)
 * so the HistoryTab editor can populate its textarea without a separate read.
 * The `entries` field is unchanged — additive widening, no consumers broken.
 */
export async function readIdentityHistory(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ entries: string[]; markdown: string }> {
  if (conn === null) {
    // LOCAL branch (mirrors server.ts lines 1275-1281)
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "history.md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      const entries = markdown
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .reverse();
      return { entries, markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { entries: [], markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #94: `|| true` so missing history.md resolves as
  // empty stdout instead of throwing "Command exited with code 1".
  // Patch #95: direct interpolation (see readIdentityFile for the shellEscape
  // + outer double-quote bug this replaces).
  const cmd = `cat "$HOME/.claude/identities/${identityKey}/history.md" 2>/dev/null || true`;
  const markdown = await execWithTimeout(conn, cmd);
  if (!markdown) return { entries: [], markdown: "" };
  const entries = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reverse();
  return { entries, markdown };
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
// is the wire-side counterpart; both must stay in sync (same 4 values, same
// order — no compile-time cross-check because the module boundary crosses
// bundling contexts).
//
// Patch #168: "pinned" removed from the status enum. `pinned` is now an
// independent boolean field orthogonal to lifecycle status (fleet migration
// by Nelly 2026-07-28). Writes attempting status:"pinned" are rejected here.
export const BOUNTY_STATUS_VALUES = [
  "in_progress",
  "waiting_on_someone_else",
  "done",
  "dropped",
] as const;
export type BountyStatus = (typeof BOUNTY_STATUS_VALUES)[number];

// Quick 260727-wd0: terminal-status set — archive preserves these, flips
// everything else to done. Kept adjacent to BOUNTY_STATUS_VALUES so the two
// sets stay visually paired (any future addition to the status enum should
// prompt an explicit decision about terminal membership here).
export const TERMINAL_BOUNTY_STATUSES = ["done", "dropped"] as const;

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
//
// Quick 260731-2pa: `WakeupUpdate` widened to also accept `name` and
// `instruction`. The form-based editor in WakeupsTab.tsx (which replaces the
// raw JSON schedule textarea from patch #154) writes the full spec on Save
// — {name, enabled, schedule, instruction} — so all four fields need a
// write path. The remote-branch python script's generic `for k,v in
// u.items(): d[k]=v` already merges any key; only the local branch needs
// the two new explicit assignments.

export type WakeupUpdate = {
  enabled?: boolean;
  schedule?: unknown;
  name?: string;
  instruction?: string;
};

/**
 * Partial-patch shape for writeIdentityBountyFields.
 *
 * MUST stay in sync with BountyFieldsPatch in src/ui/api/claude-session-api.ts
 * (backend↔frontend tsconfig boundary prevents a direct import — the UI tsconfig
 * uses browser globals that fail under the Node-targeted backend tsconfig).
 *
 * `pinned` is intentionally absent — it has its own handler (writeIdentityBountyPinned).
 * `meeting_questions` accepts writes from any authenticated caller; user-only-authored
 * semantics are a UI convention, not wire enforcement (IDMEDIT-08 / SCRATCH-REPORT.md).
 */
export type BountyFieldsPatch = {
  title?: string;
  premise?: string;
  todos?: { text: string; done: boolean }[];
  keywords?: string[];
  source_links?: string[];
  deadline?: string | null;
  meeting_questions?: { text: string; answered: boolean }[];
};

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
  // Quick 260731-2pa: name/instruction guards. name must be a non-empty
  // string (empty-name spec files break the scheduler's dedup key); instruction
  // is any string (including empty, in case the user clears it).
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || updates.name.length === 0) {
      throw new Error("name must be a non-empty string");
    }
  }
  if (updates.instruction !== undefined && typeof updates.instruction !== "string") {
    throw new Error("instruction must be a string");
  }

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "wakeups", wakeupSlug + ".json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (updates.enabled !== undefined) parsed.enabled = updates.enabled;
    if (updates.schedule !== undefined) parsed.schedule = updates.schedule;
    // Quick 260731-2pa: name/instruction assignment. Remote branch's python
    // one-liner already merges these generically — no script change needed.
    if (updates.name !== undefined) parsed.name = updates.name;
    if (updates.instruction !== undefined) parsed.instruction = updates.instruction;
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
// 6b. Markdown atomic write primitives — Phase 18 (IDMEDIT-06)
// ---------------------------------------------------------------------------
//
// Three exported writers (writeIdentityFile, writeIdentityHistory,
// writeIdentityHandoff) plus one private SFTP helper (writeMarkdownFileAtomic)
// and a byte-cap constant (IDMEDIT_MAX_MARKDOWN_BYTES).
//
// LOCAL branch (conn === null): tmp+rename via fs.writeFile + fs.rename —
//   mirrors the wakeup writer's lines 713-718 pattern byte-for-byte.
// REMOTE branch (conn is SSHClientType): SFTP tmp+rename via ssh2 SFTPWrapper.
//   execCommand in tmux-helper.ts does NOT support stdin (see lines 1-50 there),
//   so arbitrary markdown payloads cannot be safely streamed through shell
//   interpolation. SFTP delivers UTF-8 bytes as a first-class stream and
//   matches the SFTP idiom already used in file-manager-session.ts and
//   host-transfer.ts. Only the target path is interpolated into a string;
//   identityKey is regex-validated before path construction (D-IDMEDIT-06).
//
// Security posture per threat model:
//   T-18-01 / T-18-02: IDENTITY_KEY_RE validated at handler AND inside each
//     REMOTE branch (double-belt, matches writeIdentityWakeupUpdate line 727).
//   T-18-03: IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000 hard cap checked via
//     Buffer.byteLength before opening SFTP — mirrors SPEAK_TEXT_MAX pattern.
//   T-18-06 / T-18-07: writeMarkdownFileAtomic uses SFTP tmp+rename with
//     try/finally sftp.end() and best-effort tmp cleanup on error.

/** Maximum UTF-8 byte size for markdown payloads written via the three
 *  identity markdown writers. Mirrors SPEAK_TEXT_MAX = 25000 from voice.ts;
 *  2MB is generous for identity files (nelly.md is ~40KB) while capping DoS. */
export const IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000;

/** Maximum UTF-8 byte size for bounty.json after a partial-patch write.
 *  100KB cap prevents a crafted todos[]/meeting_questions[] from bloating
 *  bounty.json to an absurd size (T-18-19). Checked on the serialized
 *  post-patch JSON BEFORE the write on both LOCAL and REMOTE branches. */
export const IDMEDIT_MAX_BOUNTY_JSON_BYTES = 100_000;

/**
 * Private SFTP helper — promise-wraps conn.sftp → sftp.writeFile(tmp) →
 * sftp.ext_openssh_rename(tmp, target). On any error: best-effort
 * sftp.unlink(tmp) cleanup (fire-and-forget) then re-throw. Always closes
 * SFTP in finally.
 *
 * Called exclusively from the three REMOTE-branch writers below so the
 * SFTP tmp+rename byte-shape is defined in one place (one audit surface per
 * D-IDMEDIT-06).
 *
 * WHY ext_openssh_rename AND NOT sftp.rename (quick 260802-qrw, root-caused
 * by @stacy on ceo-skynet 2026-08-02, confirmed on skynet-ec2):
 *
 *   SFTPv3's SSH_FXP_RENAME cannot atomically overwrite an existing target.
 *   OpenSSH's process_rename tries link(old, new) first; when `new` already
 *   exists, link() returns EEXIST. OpenSSH's errno_to_portable() has no
 *   case for EEXIST and falls through to SSH2_FX_FAILURE — the ssh2 client
 *   surfaces this as a generic `Error: Failure` with code 4 and an empty
 *   error string. Every overwrite of an existing identity file therefore
 *   fails; only first-time writes (target missing) succeed. That was the
 *   root cause of Ashley's IdentityModal "sometimes it works, sometimes
 *   it doesn't" saves — all her edits are on EXISTING identity files.
 *
 *   The posix-rename@openssh.com extension (ext_openssh_rename) has POSIX
 *   rename(2) semantics: atomic overwrite of an existing target, no
 *   link()/EEXIST detour. It is advertised by every OpenSSH ≥5.1 (2008+)
 *   and is universal across Ashley's fleet — no fallback needed. Any
 *   hypothetical missing-extension case surfaces as ssh2 throwing
 *   "Server does not support this extended request" synchronously, which
 *   gets caught by the try/catch below and logged with the existing shape.
 *
 *   The regression test at identity-artifact-reader.remote-writes.test.ts
 *   installs a throwing trap on sftp.rename that fails loudly with a
 *   diagnostic naming the fix if a future refactor reverts this call site.
 */
async function writeMarkdownFileAtomic(
  conn: SSHClientType,
  targetPath: string,
  contents: string,
): Promise<void> {
  const tmpPath = targetPath + ".tmp";
  const buf = Buffer.from(contents, "utf-8");
  const bytes = buf.byteLength;

  // Promise-wrap conn.sftp — mirrors file-manager-session.ts getSessionSftp idiom
  // but without session caching (identity writes are one-shot per WS message).
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });

  try {
    // Write to .tmp first (atomic-write pattern: crash leaves prior file intact)
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(tmpPath, buf, { mode: 0o644 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Rename tmp → target via posix-rename@openssh.com (atomic overwrite;
    // see prologue for the EEXIST → SSH2_FX_FAILURE trap that made
    // plain sftp.rename unsafe for existing-file overwrites).
    await new Promise<void>((resolve, reject) => {
      sftp.ext_openssh_rename(tmpPath, targetPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    sshLogger.info("identity-artifact-reader: identity_markdown_write", {
      operation: "identity_markdown_write",
      targetPath,
      bytes,
    });
  } catch (err) {
    sshLogger.error(
      "identity-artifact-reader: identity_markdown_write failed",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_markdown_write_error", targetPath, bytes },
    );
    // Best-effort cleanup of the .tmp file — fire-and-forget
    sftp.unlink(tmpPath, () => {});
    throw err;
  } finally {
    sftp.end();
  }
}

/**
 * Private SFTP helper — reads a remote file into a Buffer via SFTP.
 * Promise-wraps conn.sftp → sftp.readFile(remotePath) → sftp.end() in finally.
 * Returns Buffer (sftp.readFile default). Throws on any SSH/SFTP error.
 *
 * Mirrors writeMarkdownFileAtomic's promise-wrap discipline. Used by the
 * REMOTE branch of writeIdentityBountyFields so JSON mutation stays in Node
 * process memory rather than being piped through a python shell script.
 */
async function sftpReadFile(conn: SSHClientType, remotePath: string): Promise<Buffer> {
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  } finally {
    sftp.end();
  }
}

/** Write the identity file (<key>/<key>.md) atomically.
 *
 * LOCAL branch (conn === null): tmp+rename via Node fs — mirrors
 *   writeIdentityWakeupUpdate lines 713-718.
 * REMOTE branch (conn is SSHClientType): SFTP tmp+rename via
 *   writeMarkdownFileAtomic. Validates identityKey and byte-caps contents
 *   before opening SFTP (D-IDMEDIT-06 / T-18-02 / T-18-03). */
export async function writeIdentityFile(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  if (conn === null) {
    // LOCAL branch — tmp+rename, mirrors writeIdentityWakeupUpdate lines 713-718
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, identityKey + ".md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — validate + cap before opening SFTP (D-IDMEDIT-06)
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/.claude/identities/${identityKey}/${identityKey}.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

/** Write the identity history file (<key>/history.md) atomically.
 *
 * Identical shape to writeIdentityFile; targetPath basename is history.md. */
export async function writeIdentityHistory(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "history.md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/.claude/identities/${identityKey}/history.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

/** Write the identity handoff file (<key>/handoff.md) atomically.
 *
 * Identical shape to writeIdentityFile; targetPath basename is handoff.md. */
export async function writeIdentityHandoff(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "handoff.md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/.claude/identities/${identityKey}/handoff.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
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
// 8b. writeIdentityBountyPinned — patch bounty.json's pinned field
// ---------------------------------------------------------------------------
//
// Quick 260728-sqk / patch #172: byte-shape mirror of writeIdentityBountyStatus
// for the `pinned` boolean field. Post-Nelly-fleet-migration (#168,
// 2026-07-28), `pinned` is an independent boolean orthogonal to lifecycle
// `status`. This writer flips the boolean, bumps updated_at, and appends
// a "pinned set to <bool> via identity modal" timeline line. Folder is
// deliberately untouched (no rename, no archive dir created) — mirrors the
// status writer's resurrect-safe pattern.

export async function writeIdentityBountyPinned(
  conn: SSHClientType | null,
  identityKey: string,
  bountySlug: string,
  pinned: boolean,
): Promise<void> {
  if (typeof pinned !== "boolean") {
    throw new Error("invalid pinned");
  }

  const nowIso = new Date().toISOString();
  const timelineLine = `${nowIso} pinned set to ${pinned} via identity modal`;

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "bounties", bountySlug, "bounty.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.pinned = pinned;
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
  // Remote branch: python3 script takes the pinned bool via stdin JSON;
  // updated_at is generated in-python from utcnow() so the timestamp
  // reflects the box's own clock (matches patch #154's priority writer
  // and #v0b's status writer). The timeline line uses str(u["pinned"]).lower()
  // so remote emits JS-style "true"/"false" tokens matching what the wire
  // panel shows.
  const script =
    'import json,os,sys,datetime\n' +
    'p=sys.argv[1]\n' +
    'u=json.loads(sys.stdin.read())\n' +
    'with open(p,"r") as f: d=json.load(f)\n' +
    'd["pinned"]=u["pinned"]\n' +
    'now=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")\n' +
    'd["updated_at"]=now\n' +
    'tl=d.get("timeline") or []\n' +
    'if not isinstance(tl,list): tl=[]\n' +
    'tl.append(now+" pinned set to "+str(u["pinned"]).lower()+" via identity modal")\n' +
    'd["timeline"]=tl\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n';
  const payload = JSON.stringify({ pinned }).replace(/'/g, "'\\''");
  const cmd =
    `printf '%s' '${payload}' | python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 8c. writeIdentityBountyFields — partial-JSON-patch write for bounty fields
// ---------------------------------------------------------------------------
//
// Phase 18 / IDMEDIT-04: accepts a partial patch object and writes ONLY the
// fields present in the patch to bounty.json. Server-owned fields (id,
// created_at, updated_at, timeline, pinned, requested_by) are never writable
// via this handler — the changedFields list is derived from the caller's patch
// object, and updated_at + timeline are unconditionally re-assigned after the
// merge so the server clock always wins (T-18-17 / T-18-22).
//
// REMOTE branch uses SFTP to read+write (no python pipe) — the JSON mutation
// lives in Node process memory so arbitrary-size content (todos[], meeting_
// questions[]) is handled safely. writeMarkdownFileAtomic is reused for the
// SFTP tmp+rename write half (accepts arbitrary UTF-8 content despite its name).
//
// `pinned` is explicitly rejected via an upfront guard — it has its own handler
// (writeIdentityBountyPinned). Per SCRATCH-REPORT.md IDMEDIT-08 locked semantics,
// `meeting_questions` is accepted from any authenticated caller (user-reserved-
// authoring is a UI convention, not a wire enforcement).

/** ALLOWED_PATCH_KEYS: the only keys in BountyFieldsPatch that may be written.
 *  Any key NOT in this set that the caller sneaks into the patch is silently
 *  ignored because changedFields is derived from this set intersected with the
 *  caller's own keys (T-18-17). */
const ALLOWED_BOUNTY_PATCH_KEYS = new Set<string>([
  "title",
  "premise",
  "todos",
  "keywords",
  "source_links",
  "deadline",
  "meeting_questions",
]);

/**
 * Partial-JSON-patch writer for bounty.json's editable fields.
 *
 * patch: object with optional title?, premise?, todos?, keywords?,
 *   source_links?, deadline?, meeting_questions?. Only present keys are
 *   written; unmentioned fields are untouched. pinned is explicitly rejected.
 *
 * LOCAL branch: fs.readFile → JSON.parse → merge → JSON.stringify → tmp+rename.
 * REMOTE branch: sftpReadFile → JSON.parse → merge → JSON.stringify →
 *   writeMarkdownFileAtomic (SFTP tmp+rename). Both branches enforce:
 *   - per-field type validation BEFORE any I/O
 *   - IDMEDIT_MAX_BOUNTY_JSON_BYTES byte-cap on serialized post-patch JSON
 *   - updated_at unconditionally bumped to server clock
 *   - one timeline entry per changed field key
 */
export async function writeIdentityBountyFields(
  conn: SSHClientType | null,
  identityKey: string,
  bountySlug: string,
  patch: BountyFieldsPatch,
): Promise<void> {
  // --- Upfront guard: pinned is not writable via this handler ---
  if ("pinned" in patch) {
    throw new Error("pinned is not editable via update-bounty-fields; use update-bounty-pinned");
  }

  // --- Per-field type validation (BEFORE any file I/O) ---
  if (patch.title !== undefined) {
    if (typeof patch.title !== "string" || patch.title.length > 500) {
      throw new Error("title must be a string of at most 500 chars");
    }
  }
  if (patch.premise !== undefined) {
    if (typeof patch.premise !== "string" || patch.premise.length > 50000) {
      throw new Error("premise must be a string of at most 50000 chars");
    }
  }
  if (patch.todos !== undefined) {
    if (!Array.isArray(patch.todos)) {
      throw new Error("todos must be an array of { text: string; done: boolean }");
    }
    for (const item of patch.todos) {
      if (
        typeof item !== "object" || item === null ||
        typeof item.text !== "string" || item.text.length > 5000 ||
        typeof item.done !== "boolean"
      ) {
        throw new Error("todos must be an array of { text: string; done: boolean }");
      }
    }
  }
  if (patch.keywords !== undefined) {
    if (!Array.isArray(patch.keywords)) {
      throw new Error("keywords must be an array of strings");
    }
    for (const kw of patch.keywords) {
      if (typeof kw !== "string" || kw.length > 200) {
        throw new Error("keywords must be an array of strings each at most 200 chars");
      }
    }
  }
  if (patch.source_links !== undefined) {
    if (!Array.isArray(patch.source_links)) {
      throw new Error("source_links must be an array of strings");
    }
    for (const link of patch.source_links) {
      if (typeof link !== "string" || link.length > 2000) {
        throw new Error("source_links must be an array of strings each at most 2000 chars");
      }
    }
  }
  if (patch.deadline !== undefined && patch.deadline !== null) {
    if (typeof patch.deadline !== "string") {
      throw new Error("deadline must be a string (ISO-8601) or null to clear");
    }
  }
  if (patch.meeting_questions !== undefined) {
    if (!Array.isArray(patch.meeting_questions)) {
      throw new Error("meeting_questions must be an array of { text: string; answered: boolean }");
    }
    for (const mq of patch.meeting_questions) {
      if (
        typeof mq !== "object" || mq === null ||
        typeof mq.text !== "string" || mq.text.length > 5000 ||
        typeof mq.answered !== "boolean"
      ) {
        throw new Error("meeting_questions must be an array of { text: string; answered: boolean }");
      }
    }
  }

  // Derive the list of fields actually being changed (only ALLOWED keys).
  // Using ALLOWED_BOUNTY_PATCH_KEYS ensures a client that sneaks extra keys
  // (e.g. { id: "attacker" }) cannot stomp server-owned fields (T-18-17).
  const changedFields = Object.keys(patch).filter(
    (k) => ALLOWED_BOUNTY_PATCH_KEYS.has(k) && (patch as Record<string, unknown>)[k] !== undefined,
  );
  if (changedFields.length === 0) {
    throw new Error("no updates");
  }

  const nowIso = new Date().toISOString();
  const timelineLines = changedFields.map((f) => `${nowIso} ${f} updated via identity modal`);

  if (conn === null) {
    // LOCAL branch — fs.readFile → JSON.parse → merge → JSON.stringify → tmp+rename
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "bounties", bountySlug, "bounty.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Apply only ALLOWED changed keys (T-18-17: server-owned fields untouched)
    for (const k of changedFields) {
      parsed[k] = (patch as Record<string, unknown>)[k];
    }
    // Unconditional server-clock overwrite — client cannot suppress these (T-18-22)
    parsed.updated_at = nowIso;
    const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
    for (const line of timelineLines) tl.push(line);
    parsed.timeline = tl;
    const next = JSON.stringify(parsed, null, 2) + "\n";
    if (Buffer.byteLength(next, "utf-8") > IDMEDIT_MAX_BOUNTY_JSON_BYTES) {
      throw new Error("bounty JSON exceeds IDMEDIT_MAX_BOUNTY_JSON_BYTES");
    }
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — SFTP read → Node merge → SFTP tmp+rename write
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (!IDENTITY_SLUG_RE.test(bountySlug)) {
    throw new Error("invalid bounty slug");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json`;
  // Read current bounty.json via SFTP into Node process memory
  const currentBytes = await sftpReadFile(conn, targetPath);
  const parsed = JSON.parse(currentBytes.toString("utf-8")) as Record<string, unknown>;
  // Apply only ALLOWED changed keys (T-18-17: server-owned fields untouched)
  for (const k of changedFields) {
    parsed[k] = (patch as Record<string, unknown>)[k];
  }
  // Unconditional server-clock overwrite — client cannot suppress these (T-18-22)
  parsed.updated_at = nowIso;
  const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
  for (const line of timelineLines) tl.push(line);
  parsed.timeline = tl;
  const next = JSON.stringify(parsed, null, 2) + "\n";
  if (Buffer.byteLength(next, "utf-8") > IDMEDIT_MAX_BOUNTY_JSON_BYTES) {
    throw new Error("bounty JSON exceeds IDMEDIT_MAX_BOUNTY_JSON_BYTES");
  }
  // Write via SFTP tmp+rename — reuses writeMarkdownFileAtomic (generic UTF-8
  // content helper despite its name; the SFTP tmp+rename logic is content-agnostic)
  await writeMarkdownFileAtomic(conn, targetPath, next);
}

// ---------------------------------------------------------------------------
// 9. archiveIdentityBounty — patch bounty.json status (flip or preserve),
//    tmp+rename at CURRENT path, mkdir -p bounties/archive/, then mv
//    bounties/<slug>/ → bounties/archive/<slug>/
// ---------------------------------------------------------------------------
//
// Quick 260727-wd0: sibling of writeIdentityBountyStatus on the archive axis.
// Semantics locked by Ashley (see PLAN.md § Semantics):
//
//   1. LIVE-status bounty (status ∈ {pinned, in_progress,
//      waiting_on_someone_else}) — atomically: (a) status → "done",
//      (b) updated_at → nowIso, (c) append `<ISO> archived via identity
//      modal (status flipped from <prev> to done)` to timeline[], (d)
//      tmp+rename write at the CURRENT (open) path, (e) mkdir -p
//      bounties/archive/ if absent, (f) mv bounties/<slug>/ →
//      bounties/archive/<slug>/.
//   2. TERMINAL-status bounty (status ∈ {done, dropped}) still sitting
//      in bounties/ — steps (b), (c) with `<prev> preserved` line, (d),
//      (e), (f). No status flip (preserves `dropped` from being
//      clobbered to `done`).
//   3. Unparseable bounty.json → throw a clear `please repair before
//      archiving` error BEFORE any mutation is attempted. No tmp file,
//      no mkdir, no mv. Disk state is byte-for-byte identical.
//
// Sequencing is load-bearing per Nelly's fleet audit (fleet-archived-
// bounty-storage-audit): the tmp+rename JSON patch happens FIRST at the
// current path so a mid-crash can never leave a truncated bounty.json in
// the archive/ tree. mkdir -p is idempotent. fs.rename on same-filesystem
// directories is POSIX-atomic — either the folder is at bounties/<slug>/
// (crash before rename) or at bounties/archive/<slug>/ (crash after) but
// never half-in-both. On rename failure (e.g. ENOTEMPTY from a slug
// collision under archive/), the error propagates; handler surfaces it
// to the modal; the JSON patch at the OLD path is already durable so a
// retry is safe (timeline gains a duplicate entry — acceptable, better
// than half-moved).

export async function archiveIdentityBounty(
  conn: SSHClientType | null,
  identityKey: string,
  bountySlug: string,
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const bountyDir = path.join(root, identityKey, "bounties", bountySlug);
    const filePath = path.join(bountyDir, "bounty.json");
    const archiveParentDir = path.join(root, identityKey, "bounties", "archive");
    const archiveDestDir = path.join(archiveParentDir, bountySlug);

    const raw = await fs.readFile(filePath, "utf-8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(
        `please repair before archiving: bounty.json at ${filePath} is unparseable`,
      );
    }

    const prevStatus =
      typeof parsed.status === "string" ? parsed.status : "unknown";
    const isTerminal = (TERMINAL_BOUNTY_STATUSES as readonly string[]).includes(
      prevStatus,
    );
    const nextStatus = isTerminal ? prevStatus : "done";
    const timelineLine = isTerminal
      ? `${nowIso} archived via identity modal (status ${prevStatus} preserved)`
      : `${nowIso} archived via identity modal (status flipped from ${prevStatus} to done)`;

    parsed.status = nextStatus;
    parsed.updated_at = nowIso;
    const tl = Array.isArray(parsed.timeline) ? [...parsed.timeline] : [];
    tl.push(timelineLine);
    parsed.timeline = tl;

    const next = JSON.stringify(parsed, null, 2) + "\n";
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);

    // mkdir -p bounties/archive/ (fresh-mkdir case for the 4 fleet
    // identities that don't have this dir yet, per Nelly's audit).
    await fs.mkdir(archiveParentDir, { recursive: true });

    // POSIX rename — atomic on same filesystem. Throws ENOTEMPTY/EEXIST
    // if archiveDestDir exists non-empty (slug collision → fail loud).
    await fs.rename(bountyDir, archiveDestDir);
    return;
  }

  if (!IDENTITY_SLUG_RE.test(bountySlug)) {
    throw new Error("invalid bounty slug");
  }
  // Remote branch: python3 script mirrors the local branch step-for-step.
  // updated_at is generated in-python (utcnow) so the timestamp reflects
  // the box's own clock (matches patch #154 / v0b's remote convention).
  // On parse failure sys.exit surfaces via execWithTimeout's error
  // propagation. On rename failure (dest exists non-empty), Python's
  // OSError propagates as a non-zero exit — handler surfaces the traceback.
  const script =
    'import json,os,sys,datetime\n' +
    'p=sys.argv[1]\n' +
    'bounty_dir=os.path.dirname(p)\n' +
    'bounties_dir=os.path.dirname(bounty_dir)\n' +
    'archive_parent=os.path.join(bounties_dir,"archive")\n' +
    'archive_dest=os.path.join(archive_parent,os.path.basename(bounty_dir))\n' +
    'try:\n' +
    '  with open(p,"r") as f: d=json.load(f)\n' +
    'except Exception:\n' +
    '  sys.exit("please repair before archiving: bounty.json at "+p+" is unparseable")\n' +
    'prev=d.get("status","unknown")\n' +
    'is_terminal=prev in ("done","dropped")\n' +
    'nxt=prev if is_terminal else "done"\n' +
    'now=datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")\n' +
    'd["status"]=nxt\n' +
    'd["updated_at"]=now\n' +
    'tl=d.get("timeline") or []\n' +
    'if not isinstance(tl,list): tl=[]\n' +
    'if is_terminal:\n' +
    '  tl.append(now+" archived via identity modal (status "+prev+" preserved)")\n' +
    'else:\n' +
    '  tl.append(now+" archived via identity modal (status flipped from "+prev+" to done)")\n' +
    'd["timeline"]=tl\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n' +
    'os.makedirs(archive_parent,exist_ok=True)\n' +
    'os.rename(bounty_dir,archive_dest)\n';
  const cmd =
    `python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/bounties/${bountySlug}/bounty.json"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 9b. deleteIdentityBounty — quick 260729-g5r
// ---------------------------------------------------------------------------
//
// Permanent-delete (rm -rf) of a bounty folder. Called from the identity
// modal's Bounties tab via the identity:delete-bounty WS handler. Unlike
// archive (which flips status + moves the folder under bounties/archive/),
// delete is a plain filesystem removal — no JSON patch, no timeline entry,
// no status flip, no tmp-and-rename. The bounty simply ceases to exist.
//
// SEMANTICS (locked in PLAN.md § D-1 / D-2):
//   - Delete applies to BOTH open (bounties/<slug>/) AND archived
//     (bounties/archive/<slug>/) cards. To cover both card locations with
//     a single code path, we rm -rf BOTH candidate paths with force:true —
//     the path that doesn't match the bounty's actual location is a no-op.
//   - Slug regex guard fires at the TOP of the function (before both the
//     local and remote branches) so it protects the shell-interpolated
//     remote path AND the local fs.rm — this fixes the pattern-drift in
//     archiveIdentityBounty where the guard only fires on the remote
//     branch (per strict scope we don't retrofit that here — just do it
//     right in the new function).
//   - No confirmation gate here — window.confirm() lives in BountyCard
//     next to the button (destructive UX belongs at the click surface).
//
// LOCAL branch: fs.rm(dir, {recursive:true, force:true}) on both candidate
// paths in sequence. force:true makes the non-matching call idempotent.
//
// REMOTE branch: python3 script mirrors the local semantics using
// shutil.rmtree(..., ignore_errors=True) on both candidate paths.

export async function deleteIdentityBounty(
  conn: SSHClientType | null,
  identityKey: string,
  bountySlug: string,
): Promise<void> {
  // Slug guard at the TOP — fires regardless of branch. Fixes the drift
  // in archiveIdentityBounty where this only ran on the remote branch.
  if (!IDENTITY_SLUG_RE.test(bountySlug)) {
    throw new Error("invalid bounty slug");
  }

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const openDir = path.join(root, identityKey, "bounties", bountySlug);
    const archivedDir = path.join(
      root,
      identityKey,
      "bounties",
      "archive",
      bountySlug,
    );
    // force:true makes each call idempotent — the path that doesn't
    // match the bounty's actual location is a no-op, so a single code
    // path covers both open + archived cards (locked D-1 semantics).
    await fs.rm(openDir, { recursive: true, force: true });
    await fs.rm(archivedDir, { recursive: true, force: true });
    return;
  }

  // Remote branch: python3 script mirrors the local branch. identityKey is
  // regex-validated upstream by IDENTITY_KEY_RE at the handler layer, and
  // bountySlug is guarded above — direct interpolation of both is safe here
  // (same convention as the rest of this file — see the note near line 229
  // about patch #95).
  const script =
    'import shutil,os,sys\n' +
    'base=sys.argv[1]\n' +
    'slug=sys.argv[2]\n' +
    'shutil.rmtree(os.path.join(base,slug),ignore_errors=True)\n' +
    'shutil.rmtree(os.path.join(base,"archive",slug),ignore_errors=True)\n';
  const cmd =
    `python3 -c ${shellEscape(script)} ` +
    `"$HOME/.claude/identities/${identityKey}/bounties" ` +
    `"${bountySlug}"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 10. readIdentityPinnedBountyCount — count of non-archived pinned bounties
// ---------------------------------------------------------------------------
//
// Quick 260727-tb1: cheap counter used by the per-row bounty badge in the
// pretty-conversations panel. Piggybacks on the readIdentityBounties layout
// convention (bounties/<slug>/bounty.json, with an archive/ subdir that must
// be skipped). Returns an integer.
//
// Schema note (patch #168): `pinned` is now an independent boolean field
// orthogonal to the lifecycle `status` field. Every previously-pinned bounty
// is now `status:"in_progress" + pinned:true` after Nelly's fleet-wide
// migration. The counter reads `parsed.pinned === true` — NOT
// `parsed.status === "pinned"` (that value no longer exists in the enum).
//
// Local branch: fs.readdir the bounties dir, skip "archive", read each
// entry's bounty.json, count where parsed.pinned === true. Per-file
// parse errors are swallowed as "not pinned" — a single poisoned file
// must not fail the whole count.
//
// Remote branch: python3 one-liner over SSH — grep on the raw JSON is
// fragile (pretty-printed vs single-line vs whitespace variants), so we
// json.load + check the `pinned` boolean field in-process on the far end
// and print an integer to stdout. python3 is universally present on identity
// boxes (the wakeup scheduler itself is python3).

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
        if (parsed.pinned === true) count += 1;
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
    '    if j.get("pinned") is True: n+=1\n' +
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
