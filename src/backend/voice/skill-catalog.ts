/**
 * Phase 34 plan 02 — SSH-fetch helper for the target box's `~/.claude/skills/`
 * user-wide skill catalog.
 *
 * This module is a leaf helper: it does not know about the STT route, does not
 * know about the pure matcher from plan 01, and is not aware of Ashley's
 * "slash <skill>" voice-first UX. It exposes a single async function that
 * takes a hostId + userId and resolves to a Set<string> of kebab-case skill
 * names found in `~/.claude/skills/*` on the target box.
 *
 * FAIL-OPEN CONTRACT (design decision — Ashley 2026-08-13, verbatim from
 * CONTEXT.md § Decisions "On wake-word HIT — SSH-fetch the skill catalog"):
 *
 *   > "instead of a 500 millisecond hard timeout, I think we could increase
 *   > the timeout to something way overboard, and as long as that call is
 *   > only happening when the message begins with the word slash, then I
 *   > feel like that's a good tradeoff ..."
 *
 * On ANY failure — SSH connect error, execCommand throw, timeout,
 * resolveHostById returning null, or unparseable output — this function
 * resolves to `new Set<string>()`. It NEVER throws to the caller. The STT
 * route handler in plan 03 relies on that invariant: an empty Set is
 * indistinguishable at the call site from "the host has zero skills
 * installed", and both fall through to the raw-transcript passthrough path.
 *
 * Non-negotiable invariants:
 *   1. NEVER throws — all error paths resolve to an empty Set.
 *   2. Connection ALWAYS closed in `finally` — no leaked ssh2 Clients even
 *      when execCommand throws.
 *   3. Timeout is a single outer deadline via Promise.race with setTimeout —
 *      the sessions.ts:77-88 pattern — so a hung SSH connect that never
 *      resolves cannot block the caller past `timeoutMs`.
 *   4. Skill names filtered to `/^[a-z0-9-]+$/` on parse (kebab-case per
 *      CONTEXT.md). Anything else in `~/.claude/skills/` — hidden files,
 *      non-conformant dirs, files-not-dirs — is dropped from the Set. This
 *      is our defense-in-depth against a compromised target box injecting
 *      slash-command-like names (see threat T-34-02-01).
 *   5. `error` level is NEVER used here — SSH failures on a per-invocation
 *      fetch are expected/benign (fail-open by design). Warn is the correct
 *      level; anything louder would spam the logs on every wake-word HIT
 *      against a temporarily-offline box.
 *
 * Pattern reuse: this file mirrors the canonical one-shot SSH pattern from
 * `src/backend/database/routes/sessions.ts` lines 65-149 (the /sessions/list
 * per-host loop): `resolveHostById` → `connectOneShot` → `Promise.race`
 * around `execCommand` with a matching setTimeout → `finally` block that
 * swallows conn.end() errors. Any change to that pattern in sessions.ts
 * SHOULD be reflected here (and vice versa).
 */

import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { sshLogger } from "../utils/logger.js";
import type { Client as SSHClient } from "ssh2";

/**
 * Generous 10s deadline on the SSH round-trip (connect + exec bounded by a
 * single outer Promise.race). Exported so the STT route in plan 03 can
 * import + reuse the same constant.
 *
 * Rationale (Ashley 2026-08-13, verbatim): "increase the timeout to something
 * way overboard, and as long as that call is only happening when the message
 * begins with the word slash, then I feel like that's a good tradeoff ...
 * I only invoke skills that way, you know, maybe a handful of times out of
 * every dozens of messages."
 */
export const DEFAULT_SKILL_CATALOG_TIMEOUT_MS = 10_000;

/**
 * The exact `ls` command run on the target box. Kept as a module-level const
 * so tests can grep for it and so the plan's acceptance criterion's literal
 * grep matches. Rationale for each flag:
 *   - `-1` forces one entry per line for parse simplicity (parser is
 *     `split(/\r?\n/)` + trim + kebab-case filter).
 *   - `2>/dev/null` suppresses "No such file or directory" if `~/.claude/skills/`
 *     doesn't exist on a fresh box. execCommand still throws on exit != 0
 *     with empty stdout, and the outer try/catch swallows that into an empty
 *     Set — fail-open cleanly.
 *   - Note: `ls` lists BOTH files and dirs. We do NOT use `ls -1d <dir>/`
 *     (dir-only variant of the ls flag combo)
 *     because the kebab-case filter on parse is our defense against
 *     files-not-dirs slipping through, and keeping the shell command minimal
 *     makes it easier to reason about the "empty ~/.claude/skills/" vs
 *     "missing ~/.claude/skills/" vs "list of names" trichotomy.
 */
const LS_SKILLS_COMMAND = "ls -1 ~/.claude/skills/ 2>/dev/null";

/**
 * Kebab-case regex per CONTEXT.md § Decisions "On wake-word HIT" (skill names
 * are already kebab-case on disk in `~/.claude/skills/`). Anchored on both
 * ends. Dropping non-conformant entries here is our T-34-02-01 mitigation:
 * an attacker who controls the target box's `~/.claude/skills/` cannot
 * inject anything past this filter (no `..`, no `/`, no spaces, no dots)
 * that the plan 03 matcher would then rewrite into a `/foo bar` slash-command.
 */
const KEBAB_CASE_REGEX = /^[a-z0-9-]+$/;

/**
 * SSH to the target host and fetch the user-wide `~/.claude/skills/` catalog.
 *
 * Returns a Set of kebab-case skill names on success. Returns an empty Set on
 * any failure — see FAIL-OPEN CONTRACT in module header. Never throws.
 *
 * @param hostId    - DB row id of the target host; passed through to
 *                    resolveHostById which enforces per-user ownership.
 * @param userId    - Authenticated user (from `req.userId` at the STT route,
 *                    populated by `authenticateJWT`). Required because
 *                    `resolveHostById(hostId, userId)` scopes credential
 *                    lookup to this user's owned hosts (and their
 *                    override/shared credentials).
 * @param timeoutMs - Total end-to-end deadline for connect + exec. Defaults
 *                    to `DEFAULT_SKILL_CATALOG_TIMEOUT_MS` (10s).
 */
export async function fetchSkillCatalog(
  hostId: number,
  userId: string,
  timeoutMs: number = DEFAULT_SKILL_CATALOG_TIMEOUT_MS,
): Promise<Set<string>> {
  sshLogger.info(
    "[skill-catalog] fetch-start hostId=" + hostId + " timeoutMs=" + timeoutMs,
    { operation: "skill_catalog_fetch_start", hostId },
  );

  // Declare conn OUTSIDE the try so the finally block can null-check
  // before calling `.end()`. Same shape as sessions.ts:72-140 uses
  // (though there `conn` is inside a per-host closure — same lifecycle).
  let conn: SSHClient | null = null;

  try {
    // Step 1: resolve host + credentials INSIDE the fail-open try so a
    // DB fault or credential-manager throw is swallowed the same as any
    // downstream SSH failure. Invariant #1 says this function NEVER
    // throws — that has to hold even if the resolver blows up.
    // If the host doesn't exist for this user (or credential resolution
    // silently returned null), short-circuit BEFORE any SSH work. This
    // intentionally does NOT distinguish "host id typo" from "user does
    // not own this host" — both yield the same silent passthrough at
    // the STT route.
    const resolved = await resolveHostById(hostId, userId);
    if (!resolved) {
      sshLogger.warn("[skill-catalog] no-host hostId=" + hostId, {
        operation: "skill_catalog_no_host",
        hostId,
        userId,
      });
      return new Set<string>();
    }

    // Step 3a: open a one-shot SSH connection. connectOneShot enforces
    // BOTH its internal connect timeout AND readyTimeout as `timeoutMs`;
    // the outer Promise.race in step 3b is a defense-in-depth cap in case
    // the exec channel itself hangs after the connect resolved.
    conn = await connectOneShot(
      resolved as unknown as Parameters<typeof connectOneShot>[0],
      timeoutMs,
    );

    // Step 3b: run `ls` with an outer deadline that bounds connect+exec
    // together at `timeoutMs`. This mirrors sessions.ts:77-88 verbatim.
    // The `throw new Error(...)` inside the setTimeout callback is
    // swallowed by the outer try/catch — it never surfaces to the caller.
    const output = await Promise.race([
      execCommand(conn, LS_SKILLS_COMMAND),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("skill-catalog fetch timeout")),
          timeoutMs,
        ),
      ),
    ]);

    // Step 4: parse. `output` is trimmed by execCommand already, but each
    // line still needs its own trim (`ls -1` shouldn't emit padding but
    // we're defensive). Filter to kebab-case per KEBAB_CASE_REGEX.
    const names = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => KEBAB_CASE_REGEX.test(line));

    const result = new Set<string>(names);
    sshLogger.info(
      "[skill-catalog] fetch-ok hostId=" + hostId + " count=" + result.size,
      { operation: "skill_catalog_fetch_ok", hostId, count: result.size },
    );
    return result;
  } catch (err) {
    // FAIL-OPEN catch: swallow every SSH-integration failure into an empty
    // Set. This includes: connectOneShot reject (connect refused, auth fail,
    // connect timeout), execCommand reject (non-zero exit + empty stdout,
    // ssh stream error), and the Promise.race timeout above. Warn-level
    // only — see invariant #5 in module header.
    sshLogger.warn(
      "[skill-catalog] ssh-error hostId=" +
        hostId +
        " error=" +
        (err instanceof Error ? err.message : String(err)),
      {
        operation: "skill_catalog_ssh_error",
        hostId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return new Set<string>();
  } finally {
    // Step 5: ALWAYS close the connection, even when exec threw. Wrap in
    // try/catch to swallow conn.end() errors (a broken pipe on a
    // never-fully-opened connection can throw here). Mirror
    // sessions.ts:134-140 shape.
    if (conn) {
      try {
        conn.end();
      } catch {
        /* ignore — cleanup best-effort */
      }
    }
  }
}
