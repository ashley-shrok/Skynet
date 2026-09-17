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
 * Single-quote a path for safe shell interpolation, EXCEPT leave a leading
 * `~/` unquoted so the target shell performs home-directory expansion.
 * Shell tilde-expansion does NOT happen inside single quotes, so wrapping
 * a catalog install path like `~/.claude/skills/id/SKILL.md` in
 * shellSingleQuote(...) produces `'~/.claude/skills/id/SKILL.md'`, which
 * the remote shell treats as a literal `~/` directory in cwd rather than
 * $HOME. The catalog uses `~/…` paths pervasively (BLOCKER, phase 72
 * code review), so this helper is the correct wrapper at every push site.
 */
function quotePathPreservingTilde(path: string): string {
  if (path.startsWith("~/")) {
    return "~/" + shellSingleQuote(path.slice(2));
  }
  return shellSingleQuote(path);
}

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
    const escaped = quotePathPreservingTilde(installPath);
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
 * Command shape (installMode="user-home", default — byte-identical to Phase 72):
 *   `mkdir -p '<parentDir>' && base64 -d > '<installPath>' && chmod <mode> '<installPath>' && echo __WRITE_OK__ || echo __WRITE_FAIL__`
 *
 * Command shape (installMode="system-root", Phase 114 Plan 03):
 *   `mkdir -p <absParent> && chown root:root <absParent> && chmod 0755 <absParent>
 *     && base64 -d > <absPath> && chown root:root <absPath> && chmod <mode> <absPath>
 *     && { test -f <absPath> && test ! -L <absPath> && echo __WRITE_OK__ || echo __WRITE_SYMLINK_FAIL__ ; }
 *     || echo __WRITE_FAIL__`
 *
 * Path quoting per installMode (Pitfall 2 mitigation):
 *   - user-home  → quotePathPreservingTilde() — leaves `~/` unquoted for shell home-expansion.
 *   - system-root → shellSingleQuote()        — absolute path, no tilde expansion.
 *
 * System-root additions (D-13, D-18, T-114-06):
 *   - Parent dir chown/chmod to root:root 0755 (per D-18 managed-host invariant).
 *   - File chown/chmod to root:root <mode> (defense-in-depth per Assumption A6 — SSH is
 *     already root when this branch fires, per composer-level gate D-13).
 *   - Symlink-guard post-condition: `test -f <path> && test ! -L <path>` runs AFTER
 *     all mutations succeed. If the target is a symlink at that point (e.g. a rooted
 *     managed host placed a symlink to /etc/passwd before the sweep), the command
 *     emits __WRITE_SYMLINK_FAIL__ instead of __WRITE_OK__. Mitigates the symlink
 *     attack surface (RESEARCH § Security Domain last row, plan threat T-114-06).
 *
 * The base64 body is passed via the exec channel's STDIN (CHANNEL_DATA
 * frames), NOT embedded in the command string.
 *
 * WHY STDIN (not heredoc, not echo-pipe):
 *   Linux caps a single argv element at MAX_ARG_STRLEN = PAGE_SIZE * 32
 *   (128 KB on x86_64), regardless of the much larger overall ARG_MAX.
 *   sshd invokes `/bin/bash -c "<command>"` — the command string is one
 *   argv element. When agent-supervisor.sh grew past ~95 KB raw, its
 *   base64 (~128 KB) plus command framing pushed the exec string over
 *   the 128 KB limit; execve returned E2BIG and bash never started —
 *   `channel returned null` at the distributor with either
 *   "/bin/bash: Argument list too long" on OpenSSH hosts or empty
 *   streams on Tailscale-SSH hosts.
 *
 *   Heredocs inside `sh -c "..."` do NOT help — the heredoc body is
 *   parsed from within the same argv-element command string. Only
 *   splitting the payload onto a different channel (stdin) sidesteps
 *   the limit. ssh2 chunks CHANNEL_DATA to 32 KB packets automatically.
 *
 * The exec command string is now ~200 bytes regardless of payload size,
 * well below any conceivable limit.
 *
 * Parent-dir extraction: manual `installPath.slice(0, installPath.lastIndexOf('/'))`.
 * One atomic command per push per item, one round-trip.
 *
 * @returns Discriminated union — { ok: true } on success, else
 *   { ok: false, stage: "write" | "chmod" | "verify", errorMessage }.
 *   The "verify" stage is exclusive to installMode="system-root" and fires when
 *   the symlink-guard post-condition fails.
 */
export async function writeInstalledBytesWithMode(
  channel: SshChannel,
  installPath: string,
  bytes: Buffer,
  modeOctal: number,
  opts?: { installMode?: "user-home" | "system-root" },
): Promise<
  | { ok: true }
  | { ok: false; stage: "write" | "chmod" | "verify"; errorMessage: string }
> {
  try {
    const installMode = opts?.installMode ?? "user-home";
    const lastSlash = installPath.lastIndexOf("/");
    const parentDir = lastSlash >= 0 ? installPath.slice(0, lastSlash) : ".";

    // Path-quoting branch (Pitfall 2): absolute system-root paths use
    // shellSingleQuote (no tilde expansion desired); user-home paths use
    // quotePathPreservingTilde (leaves `~/` unquoted for shell home-expand).
    const escapedPath =
      installMode === "system-root"
        ? shellSingleQuote(installPath)
        : quotePathPreservingTilde(installPath);
    const escapedParent =
      installMode === "system-root"
        ? shellSingleQuote(parentDir)
        : quotePathPreservingTilde(parentDir);
    const modeStr = modeOctal.toString(8);

    // longer affects command-string length.
    let cmd: string;
    if (installMode === "system-root") {
      // Phase 114 Plan 03: chained mkdir/chown/chmod on parent + file, then
      // a nested symlink-guard test that emits __WRITE_SYMLINK_FAIL__ if the
      // target is a symlink at that point (T-114-06 mitigation for symlink
      // attack on the write path).
      // The outer `||` catches any earlier-step failure and emits __WRITE_FAIL__
      // via the same sentinel-inference path used by the user-home branch.
      cmd =
        `mkdir -p ${escapedParent} && chown root:root ${escapedParent} && chmod 0755 ${escapedParent} && ` +
        `base64 -d > ${escapedPath} && chown root:root ${escapedPath} && chmod ${modeStr} ${escapedPath} && ` +
        `{ test -f ${escapedPath} && test ! -L ${escapedPath} && echo __WRITE_OK__ || echo __WRITE_SYMLINK_FAIL__ ; } ` +
        `|| echo __WRITE_FAIL__`;
    } else {
      cmd =
        `mkdir -p ${escapedParent} && base64 -d > ${escapedPath} && chmod ${modeStr} ${escapedPath} && echo __WRITE_OK__ || echo __WRITE_FAIL__`;
    }

    const b64 = bytes.toString("base64");
    const stdinBody = Buffer.from(b64, "utf-8");

    const raw = await channel.exec(cmd, stdinBody);

    if (raw === null) {
      return { ok: false, stage: "write", errorMessage: "channel returned null" };
    }

    const trimmed = raw.trimEnd();

    if (trimmed.endsWith("__WRITE_OK__")) {
      return { ok: true };
    }

    // Phase 114 Plan 03: symlink-guard post-condition failure — the write
    // itself succeeded (all mutations landed), but the post-condition
    // caught that the target is a symlink. Refuse to trust the file at
    // that path — mitigates T-114-06 (symlink attack on system-root push).
    if (trimmed.endsWith("__WRITE_SYMLINK_FAIL__")) {
      return {
        ok: false,
        stage: "verify",
        errorMessage:
          `post-write invariant failed: target is a symlink at ${installPath} ` +
          `(T-114-SYMLINK mitigation) — refusing to trust the file at that path`,
      };
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
 *   `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart '<unit>' && echo __RESTART_OK__ || echo __RESTART_FAIL__`
 *
 * XDG_RUNTIME_DIR is required so `systemctl --user` can reach the user
 * dbus socket; bare SSH-exec on Ubuntu does not create a logind session
 * and leaves the var unset, which makes every `systemctl --user` call
 * silently fail with "Failed to connect to bus: No medium found" and
 * exit 1. `$(id -u)` is evaluated by the remote shell so the fix is
 * UID-agnostic across managed hosts. Symmetric with the three
 * `systemctl --user` call sites in run-bootstrap.ts.
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
      `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart ${escapedUnit} && echo __RESTART_OK__ || echo __RESTART_FAIL__`;

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

/**
 * Remove the installed file at `installPath` on the target host via the
 * injected channel. Phase 114 Plan 03 Task 2 — peer helper to
 * writeInstalledBytesWithMode, consumed by Plan 05's sweep composer removal
 * branch (D-16 + D-27).
 *
 * When: The runtime resolver for a `sourceKind: "runtime"` catalog entry
 * returns null (admin cleared the branding-config field or removed the
 * referenced markdown file or the file exceeded the byte cap). Rather than
 * leave stale bytes on managed hosts (D-17 "clean unset state"), the sweep
 * issues rm -f on every root-SSH host to reach idempotent absence.
 *
 * Command shape (all one line, absolute path — no tilde):
 *   `{ if [ -f '<path>' ]; then rm -f '<path>' && echo __REMOVE_DID__ ;
 *      elif [ ! -e '<path>' ]; then echo __REMOVE_ALREADY__ ;
 *      else echo __REMOVE_FAIL__ ; fi ; } 2>&1`
 *
 * Sentinel-based dispatch (mirrors readInstalledBytes / writeInstalledBytes):
 *   - __REMOVE_DID__       → file existed, rm succeeded  → {ok:true, action:"removed"}
 *   - __REMOVE_ALREADY__   → file was absent (idempotent) → {ok:true, action:"already-absent"}
 *   - __REMOVE_FAIL__      → path exists but is not a regular file (dir, symlink, socket…),
 *                             OR rm returned non-zero    → {ok:false, stage:"verify", errorMessage:<stdout>}
 *   - Transport failure (channel.exec !ok) → {ok:false, stage:"remove", errorMessage:<mock msg>}
 *   - Uncaught throw       → {ok:false, stage:"remove", errorMessage:"__THROW__ <msg>"}
 *
 * Why shellSingleQuote (not quotePathPreservingTilde):
 *   The removal path is an absolute /etc/ path per D-14 (`/etc/claude-code/CLAUDE.md`).
 *   Tilde-preservation would be semantically wrong for /etc/ paths (Pitfall 2);
 *   even if a caller passed a `~/…` path, shellSingleQuote produces the correct
 *   literal path the shell will not tilde-expand — the helper is path-agnostic
 *   but expects absolute paths in production use.
 *
 * Why no sudo:
 *   D-27 mechanics — Plan 05's composer-level gate D-13 ensures this helper is
 *   ONLY called against hosts whose SSH user is `root`. No elevation needed.
 *
 * Never-throws contract (inherited from module docstring L26-33):
 *   Outer try/catch wraps every path; JS throws land as
 *   `{ ok: false, stage: "remove", errorMessage: "__THROW__ <msg>" }` per
 *   Phase 111 code-review M1 — the sweep's retry predicate classifies
 *   __THROW__ as non-retryable (code bug, not transient).
 *
 * @param channel Injected SSH channel from the orchestrator's per-host session.
 * @param installPath Absolute path to remove — e.g. "/etc/claude-code/CLAUDE.md".
 * @returns Discriminated union — see sentinel dispatch table above.
 */
export async function removeInstalledFile(
  channel: SshChannel,
  installPath: string,
): Promise<
  | { ok: true; action: "removed" | "already-absent" }
  | { ok: false; stage: "remove" | "verify"; errorMessage: string }
> {
  try {
    // Absolute-path safe quoting — no tilde preservation (Pitfall 2).
    const escaped = shellSingleQuote(installPath);
    const cmd =
      `{ if [ -f ${escaped} ]; then rm -f ${escaped} && echo __REMOVE_DID__ ; ` +
      `elif [ ! -e ${escaped} ]; then echo __REMOVE_ALREADY__ ; ` +
      `else echo __REMOVE_FAIL__ ; fi ; } 2>&1`;

    const raw = await channel.exec(cmd);
    // Transport failure — surface distinct from verify-stage failure so
    // the composer can retry-on-transport per the existing predicate.
    if (raw === null) {
      return {
        ok: false,
        stage: "remove",
        errorMessage: "channel returned null",
      };
    }

    const trimmed = raw.trimEnd();
    if (trimmed.endsWith("__REMOVE_DID__")) {
      return { ok: true, action: "removed" };
    }
    if (trimmed.endsWith("__REMOVE_ALREADY__")) {
      return { ok: true, action: "already-absent" };
    }

    // __REMOVE_FAIL__ (non-regular-file at path, or rm non-zero) OR unknown
    // shape — both dispatch to verify-stage failure. The composer will mark
    // the row failed on this sweep; next-sweep retry will re-evaluate.
    return {
      ok: false,
      stage: "verify",
      errorMessage: trimmed.slice(0, 500) || "unknown remove failure",
    };
  } catch (err) {
    // Phase 111 M1: __THROW__ prefix classifies as non-retryable code bug.
    const errMsg = err instanceof Error ? err.message : "unknown throw";
    return {
      ok: false,
      stage: "remove",
      errorMessage: `__THROW__ ${errMsg}`,
    };
  }
}
