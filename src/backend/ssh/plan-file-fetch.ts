/**
 * Plan-file SFTP fetch (Phase 24, side-channel).
 *
 * Reads the Claude Code plan file (`~/.claude/plans/<slug>.md`) via SFTP on
 * the pane's EXISTING ssh2 `Client`. Zero new handshake — the ssh2 Client
 * that already drives the pane's tmux capture-pane / send-keys traffic also
 * exposes `.sftp()` for a second subsystem channel (verified: the raw
 * `SSHClientType` is exposed at `claude-session-server.ts` L969 as
 * `let sshConn: SSHClientType | null = null`).
 *
 * Fallback (documented, not built): if a future refactor hides the raw
 * Client behind a wrapper, callers would spin up a fresh SSH connection
 * using the stored host key from the `skynet-data` volume — same
 * known-hosts trust, ~300ms handshake cost. Not built here because the
 * Client IS currently exposed.
 *
 * Threat mitigations wired here (see 24-02-PLAN.md threat_model):
 *   T-24-01  path traversal        — slug regex + full-path string compare
 *   T-24-02  network on bad input  — validate BEFORE calling `.sftp()`
 *   T-24-03  OOM via large file    — 500KB read cap (defense-in-depth)
 *   T-24-04  path injection        — SFTP subsystem, no shell (no shell-read)
 *
 * Public surface: a single async `fetchPlanFile(sshConn, planFilePath)`.
 * Return shape: `{ content: string } | { error: string }`. No WS emission
 * from this module — the caller (`claude-session-server.ts` in Plan 24-03)
 * owns re-emit.
 */

import type { Client as SSHClientType } from "ssh2";
import { sshLogger } from "../utils/logger.js";

/* -------------------------- Locked constants --------------------------- */

/**
 * 500 * 1024 = 512000 bytes. Named per CONTEXT § Specifics; do NOT inline
 * the number into the readFile call. Truncation appends the `[truncated]`
 * marker per CONTEXT § "Very long plan".
 */
export const MAX_PLAN_BYTES = 500 * 1024;

/**
 * Claude Code plans are always kebab-case English words joined by hyphens
 * (e.g. `groovy-watching-leaf`, `twinkling-strolling-eclipse`). Anything
 * outside this alphabet is rejected at the SECURITY BOUNDARY before any
 * SFTP contact.
 */
const SLUG_RE = /^[a-z0-9-]+$/;

/** Suffix appended when the source file exceeds MAX_PLAN_BYTES. */
const TRUNCATED_SUFFIX = "\n\n[truncated]";

/**
 * WR-04 fix: back off from a byte-offset that lands mid-codepoint to the
 * nearest UTF-8 codepoint boundary. `Buffer.subarray(0, MAX_PLAN_BYTES)`
 * on a plan file with non-ASCII bytes (smart quotes, em-dashes, non-ASCII
 * paths) can slice through a multi-byte codepoint, and Node's `.toString
 * ("utf8")` then either inserts U+FFFD or garbles the final characters
 * silently.
 *
 * Algorithm: if the cut offset points at a UTF-8 continuation byte
 * (top-2 bits `10xxxxxx`), walk backward until we're at either a lead
 * byte or an ASCII byte — that's the previous codepoint's start, so we
 * cut BEFORE it (the incomplete final codepoint is dropped rather than
 * decoded as U+FFFD).
 *
 * Boundary bytes: `(byte & 0xc0) === 0x80` identifies a continuation
 * byte; anything else (ASCII 0xxxxxxx or lead 11xxxxxx) is a codepoint
 * start. If `maxBytes >= buf.length`, no truncation needed.
 */
export function utf8SafeCutoff(buf: Buffer, maxBytes: number): number {
  if (buf.length <= maxBytes) return buf.length;
  let cut = maxBytes;
  // Walk back over continuation bytes; stop at the first non-continuation
  // byte (lead byte OR ASCII). That IS the incomplete-codepoint's start,
  // so return `cut` — everything at index < cut is complete codepoints.
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return cut;
}

/* -------------------- Minimal SFTP shape (duck) ------------------------ */

// ssh2's SFTPWrapper types don't neatly expose the two callback methods we
// use here in a way that plays nicely with our promise wrappers; a minimal
// duck-typed local interface keeps the mocking in tests trivial.
type SftpLike = {
  realpath(
    p: string,
    cb: (err: Error | null, resolved: string) => void,
  ): void;
  stat(
    p: string,
    cb: (
      err: (Error & { code?: number }) | null,
      stats?: { size: number; isFile: () => boolean },
    ) => void,
  ): void;
  readFile(
    p: string,
    cb: (err: Error | null, data: Buffer) => void,
  ): void;
};

/* -------------------------- Home-dir cache ----------------------------- */

/**
 * Per-Client home-directory cache. Keyed by the ssh2 Client so a WeakMap
 * gives us GC-safety when the pane's connection is torn down. Typical use
 * is "resolve once per pane lifetime" but plans can arrive back-to-back on
 * one pane, so caching pays for itself.
 */
const homeDirCache: WeakMap<SSHClientType, string> = new WeakMap();

/** Test-only: clear the cache between test cases. */
export function __resetHomeDirCacheForTest(): void {
  // WeakMap doesn't expose iteration; the test harness constructs fresh
  // mock Clients per test so entries become unreachable on their own. This
  // hook exists for parity with pretty-view-upload.ts's `__resetActive*`.
}

/* ------------------- SFTP promise wrappers ----------------------------- */

function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (
      sshConn as unknown as {
        sftp: (cb: (err: Error | null, sftp: SftpLike) => void) => void;
      }
    ).sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

function sftpRealpath(sftp: SftpLike, p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(p, (err, resolved) => {
      if (err) return reject(err);
      resolve(resolved);
    });
  });
}

function sftpStat(
  sftp: SftpLike,
  p: string,
): Promise<{ size: number; isFile: () => boolean }> {
  return new Promise((resolve, reject) => {
    sftp.stat(p, (err, stats) => {
      if (err || !stats) return reject(err ?? new Error("stat failed"));
      resolve(stats);
    });
  });
}

function sftpReadFile(sftp: SftpLike, p: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(p, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/* ---------------------- Format-only validation ------------------------- */

/**
 * Synchronous pre-check that runs BEFORE any SFTP contact. Only checks
 * properties that don't require the resolved home directory (traversal
 * dots, punctuation, tilde prefix, `.claude/plans/` prefix, slug regex,
 * `.md` suffix). If this returns `!ok`, `fetchPlanFile` short-circuits
 * WITHOUT calling `sshConn.sftp()` — the tests verify this fail-closed
 * property for every rejection case (T-24-02).
 */
function validateFormat(
  rawPath: string,
): { ok: true; slugWithExt: string } | { ok: false; error: string } {
  // T-24-01: traversal dots anywhere in the path.
  if (rawPath.includes("..")) return { ok: false, error: "invalid plan path" };

  // T-24-04: shell-metacharacter defense-in-depth. SFTP itself has no shell
  // parsing so these can't inject today, but reject them so a future
  // refactor that swaps SFTP for a shell-exec pathway doesn't silently open
  // a hole. Applies to the WHOLE rawPath, not just the slug.
  if (/[`'"$]/.test(rawPath)) return { ok: false, error: "invalid plan path" };

  // Tilde-prefix normalization: `~/.claude/plans/<slug>.md` → strip `~/`.
  // Reject absolute paths that don't fit the tilde-relative shape (T-24-01
  // "absolute paths that don't start with the resolved home + .claude/plans").
  const stripped = rawPath.startsWith("~/") ? rawPath.slice(2) : rawPath;
  const expectedPrefix = ".claude/plans/";
  if (!stripped.startsWith(expectedPrefix)) {
    return { ok: false, error: "invalid plan path" };
  }

  const slugWithExt = stripped.slice(expectedPrefix.length);
  if (!slugWithExt.endsWith(".md")) {
    return { ok: false, error: "invalid plan path" };
  }

  const slug = slugWithExt.slice(0, -3);
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: "invalid plan path" };
  }

  return { ok: true, slugWithExt };
}

/* -------------------- Home-directory resolution ------------------------ */

/**
 * Resolve the SSH connection user's home directory via `sftp.realpath(".")`
 * — one SFTP roundtrip, zero shell interaction. Cached per-Client (WeakMap)
 * so repeat fetches on the same tab don't re-hit the network.
 *
 * Preferred over shell-exec `echo $HOME` because this module intentionally
 * avoids shells (T-24-04) — realpath goes through the same subsystem channel
 * as readFile.
 */
async function resolveHomeDir(sshConn: SSHClientType): Promise<string> {
  const cached = homeDirCache.get(sshConn);
  if (cached) return cached;
  const sftp = await openSftp(sshConn);
  const resolved = await sftpRealpath(sftp, ".");
  homeDirCache.set(sshConn, resolved);
  return resolved;
}

/* -------------------------- Read + cap --------------------------------- */

/**
 * `stat` FIRST to read the on-disk size (safer than blindly `readFile`ing
 * a `/dev/zero`-shaped path), then read. If the file exceeds
 * MAX_PLAN_BYTES, truncate the decoded string to that many bytes' worth
 * and append TRUNCATED_SUFFIX. Explicit UTF-8 decode.
 *
 * Note: we still `readFile` the whole buffer even when it exceeds the cap,
 * because ssh2's SFTP doesn't expose a partial-read API on `readFile` and
 * the stat-check already gives us the size — but we cap the buffer slice
 * BEFORE the utf8 decode so we never surface more than MAX_PLAN_BYTES
 * bytes to the caller. A hostile 100MB file would still transit RAM
 * briefly; if that becomes a concern, swap `readFile` for a stream with
 * a highWaterMark.
 */
async function sftpReadFileCapped(
  sftp: SftpLike,
  path: string,
): Promise<{ content: string; truncated: boolean }> {
  const stats = await sftpStat(sftp, path);
  const data = await sftpReadFile(sftp, path);
  if (stats.size > MAX_PLAN_BYTES || data.length > MAX_PLAN_BYTES) {
    // WR-04 fix: back off to a UTF-8 codepoint boundary BEFORE decoding.
    // The prior `data.subarray(0, MAX_PLAN_BYTES).toString("utf8")` cut
    // at exactly 512000 bytes, which — for any plan file containing
    // non-ASCII characters (smart quotes, em-dashes, non-ASCII paths) —
    // could slice through a multi-byte codepoint, producing U+FFFD or
    // silently garbling the final characters. The safe-cutoff walks
    // backward from the cap to the nearest codepoint boundary so the
    // truncated content always ends on a complete codepoint.
    const safeCut = utf8SafeCutoff(data, MAX_PLAN_BYTES);
    return {
      content: data.subarray(0, safeCut).toString("utf8") + TRUNCATED_SUFFIX,
      truncated: true,
    };
  }
  return { content: data.toString("utf8"), truncated: false };
}

/* ------------------------- Exported fetch ------------------------------ */

/**
 * Fetch the contents of a Claude Code plan file via SFTP on `sshConn`.
 *
 * `planFilePath` is the tilde-relative path extracted from the pane
 * footer by `parsePlanFilePath` (see `plan-pending-parser.ts`), e.g.
 * `~/.claude/plans/groovy-watching-leaf.md`.
 *
 * Fail-closed contract (T-24-02): if `planFilePath` does not pass the
 * format-only validation, this function returns `{ error: "invalid plan
 * path" }` WITHOUT calling `sshConn.sftp()`, `sftp.realpath`, or
 * `sftp.readFile`. Tests assert this property for every rejection case.
 */
export async function fetchPlanFile(
  sshConn: SSHClientType,
  planFilePath: string,
): Promise<{ content: string } | { error: string }> {
  // Fail-closed pre-check. Runs SYNCHRONOUSLY before any SFTP contact.
  const format = validateFormat(planFilePath);
  if (!format.ok) {
    sshLogger.warn?.("plan-file-fetch: rejected invalid path", {
      operation: "plan_file_fetch_reject",
      // Do NOT log the raw path — it may contain the attacker's payload.
      // Log length + presence-of-suspect-chars only.
      length: planFilePath.length,
      hasDotDot: planFilePath.includes(".."),
    });
    return { error: (format as { ok: false; error: string }).error };
  }

  try {
    const resolvedHome = await resolveHomeDir(sshConn);
    const absPath = `${resolvedHome}/.claude/plans/${format.slugWithExt}`;
    const sftp = await openSftp(sshConn);
    const { content } = await sftpReadFileCapped(sftp, absPath);
    return { content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sshLogger.warn?.("plan-file-fetch: SFTP read failed", {
      operation: "plan_file_fetch_sftp_error",
      error: message,
    });
    return { error: message };
  }
}
