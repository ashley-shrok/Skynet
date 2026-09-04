/**
 * ssh-push.ts — SSH-channel-backed push helpers for the fleet-substrate sweep.
 *
 * SHAPE SOURCE OF TRUTH:
 *   .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 *   § Shape — the sweep uses the orchestrator's already-held per-host channel,
 *   does NOT open its own SSH, does NOT introduce a new connection pool.
 *   Every helper here takes an injected `channel: SshChannel` as first
 *   argument and performs exactly one `channel.exec` call per invocation.
 *
 * SENTINEL-BASED TRANSPORT-VS-ENOENT PARSING:
 *   Mirrors readStatWithSentinel at src/backend/fleet-status/ssh-poll-orchestrator.ts:107–178.
 *   The channel adapter returns `null` on SSH transport errors (channel-open
 *   failures, network drops) and a string on successful command execution.
 *   A `2>/dev/null && echo __TAG_OK__ || echo __TAG_ENOENT__` shell idiom
 *   distinguishes real ENOENT (file absent — first-install case) from
 *   transport failure (unknown installed state — must fail-closed on unknown).
 *
 * BASE64 ENCODING RATIONALE:
 *   The file bytes may include newlines, null bytes, and non-UTF-8 content
 *   (compiled binaries will eventually land in the catalog too). base64
 *   pipes cleanly through a shell exec that captures stdout as a string,
 *   avoiding any escape-quoting issues around \0 or binary bytes.
 *
 * NEVER-THROW CONTRACT:
 *   Every helper returns a discriminated-union result rather than throwing.
 *   The Plan 04 hook site inside ssh-poll-orchestrator.ts's
 *   tryAcquireHostChannel is fire-and-forget from the poll's perspective —
 *   an unhandled promise rejection at the sweep composer level would leak
 *   past the poll's error containment and degrade the 2s poll cadence.
 *   Every path here catches, wraps, and returns a shaped failure.
 */
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { shellSingleQuote } from "../claude-session/discover-identity-session-file.js";

/**
 * Result shape for readInstalledBytes. Matches the ItemInputs.installedRead
 * contract in src/backend/distributor/sweep-logic.ts:
 *   - readOk:true + bytes:Buffer  → file read, contents known
 *   - readOk:true + bytes:null    → file genuinely absent (ENOENT / first install)
 *   - readOk:false + reason:...   → transport / unknown failure (fail-closed)
 */
export type InstalledReadResult =
  | { readOk: true; bytes: Buffer | null }
  | { readOk: false; reason: "transport" };

/**
 * Read the installed file's bytes on the target host via the injected channel.
 *
 * Command shape: `base64 -w0 '<path>' 2>/dev/null && echo __READ_OK__ || echo __READ_ENOENT__`
 *
 * Dispatch rules (mirror readStatWithSentinel):
 *   1. raw === null                             → transport failure
 *   2. trimmed endsWith "__READ_OK__"          → strip sentinel, base64-decode remainder → bytes
 *   3. trimmed endsWith "__READ_ENOENT__"      → file genuinely absent → bytes:null
 *   4. any other shape (fail-open on unknown)   → transport failure
 */
export async function readInstalledBytes(
  channel: SshChannel,
  installPath: string,
): Promise<InstalledReadResult> {
  try {
    const escaped = shellSingleQuote(installPath);
    const cmd = `base64 -w0 ${escaped} 2>/dev/null && echo __READ_OK__ || echo __READ_ENOENT__`;
    const raw = await channel.exec(cmd);

    if (raw === null) {
      return { readOk: false, reason: "transport" };
    }

    const trimmed = raw.trimEnd();

    if (trimmed.endsWith("__READ_OK__")) {
      const b64 = trimmed.slice(0, -"__READ_OK__".length);
      // The trailing sentinel is preceded by a newline from `echo`. base64 -w0
      // emits no newlines itself, but the shell adds one before the sentinel.
      // Buffer.from's base64 decoder is tolerant of whitespace, so we don't
      // need to strip it explicitly.
      const bytes = Buffer.from(b64, "base64");
      return { readOk: true, bytes };
    }

    if (trimmed.endsWith("__READ_ENOENT__")) {
      return { readOk: true, bytes: null };
    }

    // Unknown shape — fail-open (treat as transport failure so the sweep
    // does NOT push over an ambiguous installed state).
    return { readOk: false, reason: "transport" };
  } catch {
    return { readOk: false, reason: "transport" };
  }
}

/**
 * Write bundled bytes to the installed path AND chmod to the given octal
 * mode, in a single atomic exec (one round-trip per item).
 *
 * Command shape:
 *   `mkdir -p '<parentDir>' && echo '<b64>' | base64 -d > '<installPath>' && chmod <mode> '<installPath>' && echo __WRITE_OK__ || echo __WRITE_FAIL__`
 *
 * Parent-dir extraction: manual `installPath.slice(0, installPath.lastIndexOf('/'))`.
 * Never spawns a second exec — one atomic command per push per item, to keep
 * the trail simple and to avoid partial-write states across exec boundaries.
 */
export async function writeInstalledBytesWithMode(
  channel: SshChannel,
  installPath: string,
  bytes: Buffer,
  modeOctal: number,
): Promise<{ ok: true } | { ok: false; stage: "write" | "chmod"; errorMessage: string }> {
  try {
    const escapedPath = shellSingleQuote(installPath);
    const lastSlash = installPath.lastIndexOf("/");
    const parentDir = lastSlash >= 0 ? installPath.slice(0, lastSlash) : ".";
    const escapedParent = shellSingleQuote(parentDir);
    const b64 = bytes.toString("base64");
    const modeStr = modeOctal.toString(8);

    const cmd =
      `(mkdir -p ${escapedParent} && echo ${shellSingleQuote(b64)} | base64 -d > ${escapedPath} && chmod ${modeStr} ${escapedPath} && echo __WRITE_OK__) || echo __WRITE_FAIL__`;

    const raw = await channel.exec(cmd);

    if (raw === null) {
      return { ok: false, stage: "write", errorMessage: "channel returned null" };
    }

    const trimmed = raw.trimEnd();

    if (trimmed.endsWith("__WRITE_OK__")) {
      return { ok: true };
    }

    // Failure — best-effort stage inference. If the trimmed output contains
    // "chmod" we blame chmod; otherwise blame write. Both surfaces feed a
    // logItemFailed line with a truncated errorMessage for the operator.
    const stage: "write" | "chmod" = trimmed.includes("chmod") ? "chmod" : "write";
    return {
      ok: false,
      stage,
      errorMessage: trimmed.slice(0, 500) || "unknown write failure",
    };
  } catch (err) {
    return {
      ok: false,
      stage: "write",
      errorMessage: err instanceof Error ? err.message : "unknown throw",
    };
  }
}

/**
 * Fire `systemctl --user restart <unit>` via the injected channel.
 *
 * Command shape:
 *   `systemctl --user restart '<unit>' && echo __RESTART_OK__ || echo __RESTART_FAIL__`
 *
 * Only ever called for catalog entries whose restartHook is non-null AND
 * whose byte-compare actually pushed bytes (never on skip). See the
 * chooseRestartHook contract in sweep-logic.ts.
 */
export async function restartUserUnit(
  channel: SshChannel,
  unitName: string,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  try {
    const escapedUnit = shellSingleQuote(unitName);
    const cmd =
      `systemctl --user restart ${escapedUnit} && echo __RESTART_OK__ || echo __RESTART_FAIL__`;

    const raw = await channel.exec(cmd);

    if (raw === null) {
      return { ok: false, errorMessage: "channel returned null" };
    }

    const trimmed = raw.trimEnd();

    if (trimmed.endsWith("__RESTART_OK__")) {
      return { ok: true };
    }

    return {
      ok: false,
      errorMessage: trimmed.slice(0, 500) || "systemctl restart failed",
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : "unknown throw",
    };
  }
}
