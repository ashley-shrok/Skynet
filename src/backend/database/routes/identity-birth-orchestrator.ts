/**
 * Identity birth orchestrator — pure logic module.
 *
 * Exports: birthIdentity(opts, emit, deps) — runs the birth bootstrap sequence
 * and streams progress via the emit callback.
 *
 * Design: pure function with injected deps (no direct express or HTTP imports).
 * The SSE route (identity-birth.ts) and the spawn-request worker
 * (spawn-requests/worker.ts) both wrap this with real dep instances.
 *
 * Step sequence (2026-09-24 mint-first atomic-birth reshape):
 *   Step 1: MXID derivation (Skynet-side). Validates role name, then calls
 *           Synapse admin API for ordinal collision resolution when
 *           opts.poolPicked === true. No SSH.
 *   Step 2: wire-compat instant-complete placeholder. The mkdir + identity-
 *           file write work that used to live here is folded into Step 8's
 *           atomic peer-commit script; emitted so the frontend
 *           BirthProgress checklist doesn't stall on a step that never fires.
 *   Step 6: admin-mint (createOrUpdateUser) + inline login-as-user +
 *           best-effort agents-registry join (Phase 89 D-11).
 *   Step 7: build relay.json body + identity file body — both fed into
 *           Step 8's peer script as base64 blobs.
 *   Step 8: SSH connect (remote branch) + ONE atomic peer-commit exec.
 *           The script stages files in a same-filesystem mktemp -d, then
 *           finalizes with a kernel-atomic mv rename. Peer disk either has
 *           the entire identity folder or none of it — no half-populated
 *           window (fixes the crane/eda51eac/maple half-birth failure mode).
 *   Wait for supervisor transcript signal (bounded up to
 *     WAIT_FOR_SUPERVISOR_TIMEOUT_MS, unchanged from pre-reshape).
 *
 * Rollback (mint-first invariant): if Step 6 mint succeeds but Step 7 or
 *   Step 8 fails, the orchestrator's finally block deactivates the
 *   just-minted Matrix account via deps.matrixDeactivateUser so retry with
 *   next ordinal doesn't leak Synapse accounts. On Step 8 SUCCESS, no
 *   rollback fires even if the supervisor-wait times out — the identity
 *   dir is whole on peer disk and the supervisor will bring it alive on
 *   its own schedule (Q2 no-rollback lock preserved for post-commit
 *   failures).
 *
 * D-20 reopened: the spawn-request-watcher shape locked
 * "identity-birth-orchestrator.ts unchanged" as D-20. That constraint is
 * reopened by this reshape — the atomic-commit peer script eliminates the
 * fragmented-round-trip failure surface it was protecting, and the mint-first
 * ordering makes rollback cleaner than the pre-reshape Q2 "no rollback ever"
 * discipline was designed to work around.
 *
 * Steps 3/4/5 (harness bootstrap: trust-flag pre-write, claude launch, Enter
 * settle train, `/id <name>` dispatch) were retired from birth per Phase 106
 * (D-01..D-03). The harness-start helper still lives at
 * ./identity-harness-start.js and is still used by identity-clone.ts:632.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Client as SSHClient } from "ssh2";
import yaml from "js-yaml";
import {
  MIME_TO_AVATAR_EXT,
  type AvatarExt,
  getLocalIdentitiesRoot,
  getLocalRolesRoot,
  stringifyColorHueForYaml,
} from "../../claude-session/identity-artifact-reader.js";
// Phase 92 Plan 92-01 Task 2 — per-identity file-touch primitive.
// Step 8's relay.json write routes through this primitive (D-05 wire
// generalization). The primitive delegates writes to writeMarkdownFileAtomic
// (same SFTP tmp+atomic-rename discipline Phase 77 shipped) and threads
// opts.chmod=0o600 for the post-write mode change — replacing the direct
// deps.writeMarkdownFileAtomic + deps.execCommand(chmod 600) sequence that
// lived here before. Byte-shape parity is proven by Task 2 regression tests
// (T1-T6) in identity-birth-orchestrator.test.ts.
import { writeIdentityFile } from "../../claude-session/per-identity-file.js";
// Phase 89-02 Task 3: post-mint agents-registry-room join hook (D-11).
// Best-effort — a failed join does NOT fail the birth; there is no
// in-process backfill safety net (backfill is fully manual, SSH-based).
import { joinAgentToAgentsRegistry } from "../../relay-sessions/registry-rooms.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Nelly-verbatim constants (audited against agent-supervisor.sh + DM §1)
// ---------------------------------------------------------------------------

/** Number of blind Enter presses in the settle train (Nelly §1(g)). */
export const ENTER_TRAIN_COUNT = 7;

/** Milliseconds between each Enter press in the train (Nelly §1(g), 3s per Enter). */
export const ENTER_TRAIN_SPACING_MS = 3000;

/**
 * SETTLE_SECONDS = 22 (Nelly §1(g), agent-supervisor.sh line 333).
 * Documentation constant: SETTLE_SECONDS × 1000 / ENTER_TRAIN_SPACING_MS ≈ 7 Enters.
 * Not directly used in loop logic (we use ENTER_TRAIN_COUNT), but exported
 * for parity with agent-supervisor.sh and for plan 06 documentation.
 */
export const SETTLE_SECONDS = 22;

/** Sleep after Step 2's mkdir so a login shell would have time to source its
 * profile (Nelly §1(b)). Retained after Phase 106's tmux retirement because
 * the constant is re-exported for clone's harness sequence, which still opens
 * a tmux session and needs this cadence (see identity-harness-start.ts). */
export const STEP_2_SLEEP_MS = 3000;

/** Sleep after claude launch before starting the Enter train (Nelly §1(f)). */
export const STEP_3_SLEEP_MS = 2000;

/**
 * Phase 106 (D-07): poll cadence for the wait-for-supervisor block. 2s matches
 * fleet-status orchestrator default granularity. Every tick runs one
 * `discoverIdentitySessionFile` SSH exec on the same connection the birth
 * request opened (no new connect). Cheap enough at 150 iterations over the full
 * 300s window because the discovery script is a single find+head+grep chain.
 */
export const WAIT_FOR_SUPERVISOR_POLL_MS = 2000;

/**
 * Hard ceiling on the wait-for-supervisor block. Timeout emits ended{ok:false,
 * reason:"supervisor_wait_timeout"} and stops — NO rollback (Q2 lock, per
 * shape file §"What would make it wrong" bullet 4). The identity may still
 * come alive after we've given up waiting; the operator sees the alert, the
 * log captures the operation-key `identity_birth_supervisor_wait_timeout`.
 *
 * The supervisor's reconcile tick is 15s, but launches are SERIALIZED and each
 * fresh launch costs ~16s (tmux + REPL-up + `/id` submit train), so queue
 * latency — not the tick — sets the real worst case. On a loaded host the wait
 * must absorb that queue depth: a 2026-09-16 batch of 10 births on a box with
 * 67 tmux sessions at load ~9.8 saw the supervisor start one identity's launch
 * 141s after its folder appeared, 20s AFTER the then-120s ceiling had already
 * reported birth_failed for an identity that came up healthy moments later.
 * 300s covers that observed depth with headroom.
 */
export const WAIT_FOR_SUPERVISOR_TIMEOUT_MS = 300000;

/** SSH connect timeout. */
export const SSH_CONNECT_TIMEOUT_MS = 30000;

/**
 * Claude CLI launch env-var prefix (Nelly §1(d) verbatim).
 * Dodges resume-summary and resume-threshold prompts that --dangerously-skip-permissions
 * does NOT cover on the RESUME path. Cheap insurance even for fresh launches.
 */
export const CLAUDE_LAUNCH_CMD_PREFIX =
  "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999";

/** tmux terminal sizing flags for the new-session invocation (Nelly §3
 * terminal-sizing gotcha). Post-Phase-106 the birth orchestrator no longer
 * opens the session itself, but this constant is re-exported for clone's
 * harness (identity-harness-start.ts) and for agent-supervisor parity docs. */
export const TMUX_NEW_SESSION_FLAGS = "-x 220 -y 50";

/**
 * Role name validator — kebab-case-lowercase per D-CONTEXT §Frontend surfaces
 * (Phase 22 Plan 22-02 / SRIC-02). Stricter subset of IDENTITY_KEY_RE.
 * Applied inside birthIdentity as defense-in-depth on top of the HTTP-handler
 * validation at identity-birth.ts (T-22-02-01 shell-injection mitigation:
 * the role name is interpolated into SSH exec commands that build the
 * identity file target path).
 *
 * Phase 90 Plan 90-10 (LOW-severity cleanup): the canonical definition now
 * lives in `src/backend/utils/role-name-pattern.ts`. This module re-exports
 * for backward compatibility with existing importers (test files reference
 * this path). New code should import from `../../utils/role-name-pattern.js`.
 */
import { ROLE_NAME_PATTERN } from "../../utils/role-name-pattern.js";
export { ROLE_NAME_PATTERN };

/**
 * Phase 22 SRIC-02 seed comment embedded in the pre-written identity file.
 *
 * REVISION 2026-08-04 (user, at Task 2 checkpoint): Skynet no longer
 * SSH-invokes the relay-register block. Instead, we seed the identity file
 * with a plain-text HTML comment telling the wake-up agent to register a
 * Matrix relay account itself on first wake, then remove the comment.
 *
 * Style constraints (verbatim from user):
 *   - Do NOT say "Skynet" — agents don't know what that is (they see
 *     themselves as a fresh Claude Code agent on some box).
 *   - Do NOT reference id-skill section numbers (§2, §3) or the id-skill
 *     file path — those refs could change.
 *   - Speak in plain terms.
 *
 * REVISION 2026-09-12 (user): the birth flow (Steps 6-8: admin-mint +
 * login-as-user + SFTP-write relay.json) creates the Matrix account BEFORE
 * the identity's first wake, so the seed comment was factually stale by
 * the time any agent read it. Constant deleted; emitted identity file
 * now omits the seed comment entirely.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Phase 75 Plan 04 — step-number union widened to 1..8 for the three new
// admin-mint + relay.json write steps. Frontend BirthProgress checklist quietly
// ignores unknown step numbers today; the union widening here is backend-only
// (frontend widening is a Phase B concern per 75-RESEARCH.md Assumption A4).
// Phase 106 (D-11): `ended` grows an optional `reason` string on the failure
// path so backend log-forensics can distinguish Skynet-side failures from
// supervisor-wait timeouts. Frontend ignores the field entirely and always
// shows a generic alert (D-17). See shape file §"What would make it wrong"
// bullet 5 — same alert regardless of failure kind on the user-facing surface.
export type BirthEvent =
  | { type: "step"; n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; phase: "started" | "completed" | "failed"; reason?: string }
  | { type: "ended"; ok: boolean; failedStep?: number; reason?: string; identityId?: string; sessionName?: string };

export interface BirthOptions {
  // Patch #316: userId is the JWT subject (`users.id` = text() in schema,
  // nanoid-shaped string like "JqbJ5OmBQhQ-..."). Previous `number` typing
  // silently parseInt'd it to NaN upstream, blocking every birth at step 1
  // via getCandidateForBirth's userId scope guard.
  userId: string;
  hostId: number;
  name: string;
  title: string;
  path: string;
  colorHue: number | null;
  voice: string | null;
  /**
   * Phase 22 SRIC-02: kebab-case-lowercase role name from ~/fleet/roles/<role>/
   * on the target host. Validated at HTTP handler (identity-birth.ts) AND
   * re-validated at Step 2.5 entry (defense in depth per T-22-02-01).
   */
  role: string;
  /**
   * Phase 80 Plan 80-03: optional task string written to frontmatter at birth
   * time (write-once per D-05 — no in-UI edit, disk-only, no DB caching).
   * Absent / null / empty / whitespace-only → no `task:` key emitted
   * (absent-⇒-omit invariant matches title/voice pattern). Route handler
   * hard-caps at 500 chars; orchestrator does not re-cap since Step 2.5 is
   * an atomic write with no downstream consumers beyond the disk file.
   */
  task?: string;
  /**
   * Phase 129 D-4 auto-tag (write-side): the creator's Skynet username as
   * looked up in the route handler (identity-birth.ts) via
   * getUsernameForUserId. Threaded through as an opaque string so the
   * orchestrator stays pure (no DB imports leak here).
   *
   * The route handler is responsible for gating this field on
   * isHostMultiUser(hostId): it MUST be set only when the target host has
   * strictly more than one Skynet user with access, and MUST be undefined
   * on single-user hosts per shape file § "invisible in majority case".
   *
   * When present and non-empty, buildIdentityFileBody emits a
   * `users: [creatorUsername]` pair via the existing pairs.push pattern
   * (absent-⇒-omit fallback per D-3 preserved when this field is absent).
   * Case-sensitive — echoed verbatim from the DB (Pitfall 7 lock: no
   * .toLowerCase()/.toUpperCase() at this seam or downstream).
   */
  creatorUsername?: string;
  /**
   * Phase 80 Plan 80-03b A1 lock: when true, MXID composition follows the
   * DIVERGE shape (`<pool-name>-<role>[-N]` lowercase-hyphenated) — identity
   * folder key stays lowercase (`willow`) and the Matrix account MXID becomes
   * `@willow-skynet-maintainer:server` (with silent auto-suffix `-2`, `-3`,
   * ... on collision). When false/absent, the legacy `@<name>:<serverName>`
   * shape is used (backward compat for pre-Phase-80 identities and
   * manually-typed names — Taylor, Tina, Tabitha, etc. keep their existing
   * `@taylor:server` MXIDs). Frontend NewSessionDialog sets true when the
   * name field was pool-picked (plan 80-06).
   *
   * 2026-09-11: original PascalCase output (`Willow-Skynet-Maintainer`) was
   * rejected by Synapse (M_INVALID_USERNAME — Matrix spec requires mxid
   * localparts to be lowercase). Every pool-picked birth got 400 at Step 6;
   * the fix lowercases composeMxidLocalpart's output + the pool-picker's
   * availability query.
   */
  poolPicked?: boolean;
  /**
   * Phase 106 review (M1 fix): optional AbortSignal wired from the SSE
   * route's `req.on("close", ...)` — when the client disconnects mid-birth
   * (tab close, browser navigation, hard refresh), the wait-for-supervisor
   * poll checks `.aborted` before each iteration and breaks out silently
   * (no `emit()` — the SSE stream is already dead). Prevents server-side
   * SSH-connection pinning + wasted discovery execs during the up-to-120s
   * wait window when the frontend gave up. Steps 1/2/6/7/8 don't consult
   * the signal (they're seconds-scale and abort-mid-mint would leave worse
   * partial state); only the long-running wait block honors it.
   */
  abortSignal?: AbortSignal;
  /**
   * Phase 127 follow-up: optional body content emitted into the identity
   * file after the `# <name>` heading, rendered as a `## Do this first`
   * section. Consumed by the id-skill's load-time body-read contract —
   * the first client that loads the newborn (via `/id <name>` or Skynet
   * UI) treats it as a pre-authorized next action and acts on it in the
   * same turn. Used by wake-up-scheduler spawn-requests to deliver the
   * wake-up's `prompt` field to the newborn. Absent / null / empty /
   * whitespace-only → no block emitted (absent-⇒-omit invariant matches
   * title/voice/task pattern above).
   */
  bodyContent?: string;
}

export interface BirthDeps {
  /**
   * Phase 68: no DB record is created; disk folder + frontmatter + avatar
   * sibling ARE the identity's identity. createIdentityRecord and
   * getIdentityRecord have been removed from BirthDeps entirely.
   *
   * Step 1 now serves as the on-disk collision precheck:
   *   - For remote hosts: SSH exec `if [ -d ~/fleet/identities/<name> ]`
   *   - For local hosts: fs.access equivalent
   * The step fails immediately with "identity already exists on this host"
   * if the folder already exists.
   */

  /** Opens an SSH connection to the target host. */
  connectOneShot: (host: unknown, timeoutMs: number) => Promise<SSHClient>;
  /** Runs a command over SSH and returns stdout. */
  execCommand: (conn: SSHClient, command: string) => Promise<string>;
  /** Returns true when hostId maps to the local Skynet host (self-birth). */
  isLocalHostId: (hostId: number) => boolean;
  /** Runs a shell command locally (child_process.exec equivalent). */
  execLocal: (command: string) => Promise<string>;
  /** Resolves a hostId to host connection details. */
  resolveHostById: (hostId: number, userId: string) => Promise<unknown>;
  /**
   * Phase 75 Plan 04 (D-OQ6 lock) — Matrix admin mint primitive from Plan 02.
   * Called by runRelayMintAndWrite at Step 6. Wired in identity-birth.ts to
   * matrix-admin-client.ts's createOrUpdateUser export (PUT /_synapse/admin/v2
   * /users/<mxid>, treats 200 update AND 201 create as success per Pitfall 5).
   * `displayname` is optional (D-OQ2 lock: pass frontmatter displayName when set,
   * else omit for graceful fallback).
   */
  matrixCreateOrUpdateUser: (
    mxid: string,
    password: string,
    displayname?: string,
  ) => Promise<
    | { ok: true; mxid: string; password: string; status: number }
    | { ok: false; status: number; error: string }
  >;
  /**
   * Phase 75 Plan 04 (D-OQ6 lock) — Matrix admin login-as-user primitive from
   * Plan 02. Called by runRelayMintAndWrite between Step 6 and Step 7. Mints
   * a fresh access_token for the freshly-created mxid so relay.json carries a
   * real (non-empty) token from birth-time — recv.sh does not have to relogin
   * on first read. POST /_synapse/admin/v1/users/<mxid>/login. Separate from
   * matrixCreateOrUpdateUser to preserve Plan 02's "each primitive is one
   * endpoint" contract (see D-OQ6 in 75-04-PLAN.md § objective).
   */
  matrixLoginAsUser: (
    mxid: string,
    validUntilMs?: number,
  ) => Promise<
    | { ok: true; accessToken: string }
    | { ok: false; status: number; error: string }
  >;
  /**
   * Rollback primitive for the mint-first birth flow. When Step 6 (Matrix
   * admin-mint) succeeds but the subsequent Step 8 peer-commit fails, the
   * orchestrator deactivates the just-minted Matrix account so a retry with
   * the next ordinal doesn't leak Synapse accounts. Wired to
   * matrix-admin-client.ts's deactivateUser export
   * (POST /_synapse/admin/v1/deactivate/<mxid> with erase:false — no
   * room-history erasure per that primitive's RESEARCH.md Assumption A3).
   * Best-effort: a non-ok result is warn-logged but does not raise (the
   * orphan is recoverable via periodic Synapse sweep).
   */
  matrixDeactivateUser: (
    mxid: string,
  ) => Promise<
    | { ok: true }
    | { ok: false; status: number; error: string }
  >;
  /**
   * Phase 75 Plan 04 — Matrix homeserver base URL (with scheme + port). Used
   * two ways inside runRelayMintAndWrite: (a) as the `homeserverBase` field of
   * buildRelayJsonBody so recv.sh's `base` becomes `<homeserverBase>/_matrix/
   * client/v3`; (b) the hostname portion (extracted from the URL) becomes the
   * server-name suffix of the mxid: `@<name>:<server-name>`. Sourced in
   * identity-birth.ts from getMatrixAdminCreds().homeserverBase — the
   * first-class column on matrix_admin_creds. NEVER a hardcoded fallback per
   * D-OQ7 (island-model per 75-CONTEXT.md § Philosophy).
   */
  matrixHomeserver: string;
  /**
   * 2026-09-11: Matrix server_name override, wired from
   * matrix_admin_creds.serverName (matrix-admin-creds-store.ts). Consumed
   * by runRelayMintAndWrite's Step 6 mxid derivation in preference to
   * extractServerName(matrixHomeserver) when non-null. Load-bearing when
   * homeserverBase is a URL whose host is NOT the Matrix server_name —
   * e.g. `http://matrix:8008` (internal docker alias, host = "matrix")
   * but synapse's real server_name is `t1000.taild9b663.ts.net`.
   * Without this, Step 6 mints `@name:matrix` and synapse returns 400
   * "This endpoint can only be used with local users" because mxid claims
   * to belong to server "matrix", not the local server_name.
   */
  matrixServerName: string | null;
  /**
   * 2026-09-11: URL to write into per-identity relay.json's `base` field.
   * Distinct from matrixHomeserver because relay.json is consumed by recv.sh
   * on the identity's HOST — which may require a different URL than
   * Skynet-in-container uses to reach synapse (e.g. hosts unable to reach a
   * docker-internal alias like `http://synapse:8008`). Sourced in
   * identity-birth.ts from `creds.hostSideBase ?? creds.homeserverBase` — a
   * falsy hostSideBase preserves the pre-2026-09-11 single-URL behavior.
   * NEVER a hardcoded fallback per D-OQ7 (island-model per 75-CONTEXT.md
   * § Philosophy).
   */
  relayJsonHomeserverBase: string;
  /**
   * Phase 75 Plan 04 — pure builder for the relay.json JSON body that Step 8
   * writes to `~/fleet/identities/<name>/relay.json` on the target host.
   * Wired to Plan 02's buildRelayJsonBody export. Emits exactly five keys
   * (base, user_id, password, token, access_token) per agent-relay/SKILL.md.
   */
  buildRelayJsonBody: (opts: {
    mxid: string;
    password: string;
    accessToken: string;
    homeserverBase: string;
  }) => string;
  /**
   * Phase 80 Plan 80-03b A1 lock — wired to matrix-admin-client.countUsersMatching
   * from plan 80-02. Called by deriveMxidWithOrdinal inside Step 6 (before the
   * matrixCreateOrUpdateUser call) to find the first unused ordinal for the
   * composed base handle. The derivation is gated on opts.poolPicked === true;
   * legacy births (poolPicked absent/false) never invoke this dep. Returns the
   * same discriminated-union shape as the other matrix-admin primitives — a
   * failure here propagates through Step 6's runStep as an `admin_count_failed`
   * step failure (Q2 no-rollback discipline preserved).
   */
  matrixCountUsersMatching: (mxid: string) => Promise<
    | { ok: true; total: number }
    | { ok: false; status: number; error: string }
  >;
  /**
   * Phase 106 (D-05/D-06): the wait-for-supervisor sensor. Called once every
   * WAIT_FOR_SUPERVISOR_POLL_MS from the wait block that runs after Step 8's
   * relay.json write. Returns the JSONL path when the supervisor has picked
   * the identity up, opened its tmux session, launched the claude REPL, and
   * the agent's /id <name> first-turn is on disk under the exec-user's
   * ~/.claude/projects/ (mtime-newest JSONL). Returns null when nothing has
   * appeared yet OR on any SSH-side error (helper's fail-safe null-return
   * contract).
   *
   * Wired in identity-birth.ts to
   * src/backend/claude-session/discover-identity-session-file.ts's
   * discoverIdentitySessionFile(conn, identityName) — the SAME sensor
   * fleet-status and sessions.ts already trust for "this is a live agent
   * session, not a bare shell." Do NOT introduce a parallel sensor per shape
   * file §"What would make it wrong" bullet 7.
   */
  discoverIdentitySessionFile: (conn: SSHClient | null, identityName: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Sentinel error for early termination (step failure path)
// ---------------------------------------------------------------------------

class BirthAborted extends Error {
  constructor(public readonly step: number) {
    super(`BirthAborted at step ${step}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POSIX single-quote escape. Wraps s in '...' and escapes embedded ' as '\''. */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Shell-safe path helper:
 * - "$HOME" or "$HOME/..." → unquoted (shell must expand the var)
 * - everything else → single-quoted
 */
function shellPath(p: string): string {
  if (p === "$HOME" || p.startsWith("$HOME/")) {
    return p; // let shell expand $HOME
  }
  return shellSingleQuote(p);
}

/** await-friendly sleep that works with vi.useFakeTimers. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sanitize an error message for safe inclusion in SSE reason field.
 * Maps common SSH errors to safe strings. Never leaks raw stacks.
 *
 * Phase 106 (D-11 + W-1 fix): exported so identity-birth.ts's /retry/:key
 * route can carry the same sanitized reason string on its failure `ended`
 * emit — wire-parity with the orchestrator's outer-catch failure emit.
 */
export function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return "Unknown error";
  const msg = err.message;
  if (/timeout|unreachable/i.test(msg)) return "Host unreachable";
  if (/connect/i.test(msg)) return "Host unreachable";
  // Truncate to 200 chars max; no stack, no raw SSH internals
  return msg.slice(0, 200);
}

// Regex gate (matches identities.ts IDENTITY_KEY_RE)
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;

/**
 * Stricter than IDENTITY_KEY_RE — used as a second gate inside birthIdentity()
 * to reject names that would be valid identity keys but produce malformed or
 * ambiguous tmux target arguments. Rejects `=`, `/`, `+`, `.` because tmux
 * interprets these in target syntax (`-t =name` = exact match, `.name` =
 * window/pane reference, `+name` = relative pane offset, `/name` = malformed
 * target). See CR-02 in .planning/phases/20-identity-creation-ui/20-REVIEW.md.
 */
const TMUX_SAFE_NAME_RE = /^[a-z][a-z0-9_-]*$/;

// ---------------------------------------------------------------------------
// Phase 66 Plan 66-01 Track 1 — full-cosmetics identity file body builder
// ---------------------------------------------------------------------------
//
// Grows the Step 2.5 identityFileBody from role-only frontmatter into a full
// cosmetics-carrying block so a Skynet-created identity is byte-shape-
// indistinguishable from a Nelly-migrated (Phase A) one:
//
//   ---
//   role: <role>
//   displayName: <Capitalize(name)>
//   title: <title>          (omitted if empty or null)
//   colorHue: <colorHue>    (omitted if null)
//   voice: <voice>          (omitted if null)
//   avatar: <name>.<ext>    (always present when avatar bytes were written)
//   ---
//
//   <!-- seed comment (user-locked verbatim) -->
//
//   # <name>
//
// Absent-⇒-omit invariant (CONTEXT.md Track 1): fields whose birth-opts
// value is null OR empty-string are NEVER emitted as YAML null / empty —
// they are literally not present as keys in the emitted frontmatter.
//
// role-first ordering matters (post-Phase-A byte-shape parity per
// CONTEXT.md), so yaml.dump is called with sortKeys:false; the pairs array
// is built in canonical order.
//
// yaml.dump options rationale:
//   sortKeys: false    — preserve the [role, displayName, title, colorHue,
//                        voice, avatar] insertion order
//   lineWidth: -1      — no line-wrapping; keeps long titles / voice paths
//                        on a single line for cleaner grep/diff on disk
//   noRefs: true       — never emit `&anchor` / `*alias` for repeated
//                        values (defense-in-depth; shouldn't fire on scalars)
//   forceQuotes: false — let yaml.dump decide per-value; it correctly
//                        quotes strings containing colons/newlines
//                        automatically (T-66-01-04)
export function buildIdentityFileBody(
  opts: BirthOptions,
  displayName: string,
  avatarFilename: string,
): string {
  // Phase 129: pair-value union widened to include string[] so the auto-tag
  // branch below can push ["users", [creatorUsername]] via the same pattern.
  // stringifyColorHueForYaml (call site further down) only inspects the
  // colorHue key, so widening here is byte-shape neutral for pre-129 fields.
  const pairs: Array<[string, string | number | string[]]> = [];

  // role is ALWAYS present (validated upstream)
  pairs.push(["role", opts.role]);
  // displayName is ALWAYS present (derived from opts.name)
  pairs.push(["displayName", displayName]);

  // title: skip if null OR empty-after-trim (absent-⇒-omit)
  if (typeof opts.title === "string" && opts.title.trim().length > 0) {
    pairs.push(["title", opts.title]);
  }
  // colorHue: skip if null (integer 0 is a valid hue — do NOT skip on falsy)
  if (opts.colorHue !== null && opts.colorHue !== undefined) {
    pairs.push(["colorHue", opts.colorHue]);
  }
  // voice: skip if null OR empty-after-trim
  if (typeof opts.voice === "string" && opts.voice.trim().length > 0) {
    pairs.push(["voice", opts.voice]);
  }
  // Phase 86 Plan 86-04 (D-CTX-86-inherit): avatar is now absent-⇒-omit.
  // When the birth request omits avatarCandidateId (role-inherited-avatar
  // path), Step 2.5's writeAvatarSiblingFile is skipped and this builder
  // is invoked with an empty avatarFilename — the identity's frontmatter
  // gets no `avatar:` key and the resolved avatar URL comes from the
  // role folder via Plan 86-01's GET /:key/avatar role-folder fallback
  // branch. Matches the existing absent-⇒-omit pattern for title / voice /
  // task above.
  if (avatarFilename.length > 0) {
    pairs.push(["avatar", avatarFilename]);
  }
  // Phase 80 Plan 80-03: task: absent-⇒-omit — position AFTER avatar per plan
  // spec. yaml.dump correctly quotes strings containing YAML metacharacters
  // (colons, quotes, newlines) via forceQuotes:false (T-66-01-04 precedent) —
  // do NOT hand-quote here. Round-trip test asserts value preservation.
  if (typeof opts.task === "string" && opts.task.trim().length > 0) {
    pairs.push(["task", opts.task]);
  }
  // Phase 129 D-4 auto-tag: users:[creator] on multi-user hosts. Route
  // handler (identity-birth.ts) sets opts.creatorUsername only when
  // isHostMultiUser(hostId)=true; absent-⇒-omit fallback preserves the
  // zero-migration byte-shape on single-user hosts (shape §"invisible
  // in majority case"). Case-sensitive echo of the DB users.username value
  // (Pitfall 7 lock — NO .toLowerCase()/.toUpperCase() at this seam).
  //
  // Positioned AFTER task per PATTERNS.md § buildIdentityFileBody insertion
  // point. sortKeys:false + noRefs:true guarantee the emitted key lands last
  // in the frontmatter block and serializes as a plain YAML flow-or-block
  // sequence with no anchor/alias emission. yaml.dump serializes arrays of
  // strings correctly under the canonical options block (T-66-01-04 precedent
  // — no forceQuotes required).
  if (
    typeof opts.creatorUsername === "string" &&
    opts.creatorUsername.length > 0
  ) {
    pairs.push(["users", [opts.creatorUsername]]);
  }

  const yamlBody = yaml.dump(
    stringifyColorHueForYaml(Object.fromEntries(pairs)),
    {
      sortKeys: false,
      lineWidth: -1,
      noRefs: true,
      forceQuotes: false,
    },
  );

  let body = `---\n${yamlBody}---\n\n# ${opts.name}\n`;
  // Phase 127 follow-up: emit `## Do this first` section when bodyContent
  // is set. Absent-⇒-omit — trims whitespace and skips if empty.
  if (typeof opts.bodyContent === "string" && opts.bodyContent.trim().length > 0) {
    body += `\n## Do this first\n\n${opts.bodyContent.trim()}\n`;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Phase 75 Plan 04 — runRelayMintAndWrite helper (Steps 6, 7, 8)
// ---------------------------------------------------------------------------
//
// Extracted so BOTH birthIdentity AND the retry endpoint (identity-birth.ts
// POST /identities/birth/retry/:key) can drive the same three-step sequence:
//
//   Step 6: admin-mint (createOrUpdateUser) — generates a fresh 48-char hex
//           password locally, calls PUT /_synapse/admin/v2/users/<mxid>, then
//           calls POST /_synapse/admin/v1/users/<mxid>/login to mint a real
//           access_token (D-OQ6 lock — matrixLoginAsUser is invoked inside
//           Step 6 rather than requiring a separate primitive downstream).
//   Step 7: build the relay.json JSON body via deps.buildRelayJsonBody. Guards
//           against an empty access_token from the login call — throws before
//           writing to disk if the token is missing.
//   Step 8: SFTP-write ~/fleet/identities/<name>/relay.json (atomic tmp +
//           ext_openssh_rename), then chmod 600. A chmod failure DOES fail
//           the step (world-readable relay.json is a security regression per
//           agent-relay/SKILL.md:105 fleet convention, T-75-18).
//
// Failure semantics (Q2 partial-tolerated, NO ROLLBACK):
//   - Any throw from Step 6/7/8 is caught by runStep which emits
//     step:N:failed + ended{ok:false, failedStep:N} and re-throws BirthAborted.
//   - NO folder-cleanup (rm/unlink) logic anywhere in this helper or its
//     callers. The Q2 lock is documented in the comment on runStep's catch
//     (above) and here.
//   - Every consumer of this helper MUST NOT wrap it in a try/catch that adds
//     rollback behavior — the identity folder from Step 1 stays on disk on
//     any failure, and the id skill's self-register fallback handles the
//     partial-state case (agent-relay/SKILL.md:65-87).

/** Generate a fresh 48-char hex password (96 bits of entropy) for the relay
 * account. Used ONLY by Step 6; the value is passed to Synapse via the admin
 * PUT body and to the target host via the SFTP-written relay.json. Never
 * logged. */
function generateAgentPassword(): string {
  return randomBytes(24).toString("hex");
}

/** Extract the server-name portion (host:port stripped, scheme stripped) from
 * a homeserver base URL. Used for mxid construction only.
 * Examples:
 *   "https://matrix.example.com:8448" → "matrix.example.com"
 *   "http://100.113.23.63:8008"       → "100.113.23.63"
 *   "matrix.example.com"              → "matrix.example.com"
 */
function extractServerName(homeserverBase: string): string {
  // Strip scheme prefix if present (http:// or https://)
  let s = homeserverBase.replace(/^https?:\/\//, "");
  // Strip trailing slash and any path
  s = s.split("/")[0];
  // Strip port suffix
  s = s.split(":")[0];
  return s;
}

// ---------------------------------------------------------------------------
// 2026-09-18 (quick 260918-52n): MXID + identity-folder-name derivation
// ---------------------------------------------------------------------------
//
// Shared helper — invoked in Step 1 of birthIdentity BEFORE the folder-
// existence probe, and by the retry route in identity-birth.ts to compute
// the same values for a re-invocation against an existing folder.
//
// Returns `{ mxid, identityFolderName }` where identityFolderName is the
// MXID localpart (a plain slice: leading `@` stripped, `:<serverName>`
// suffix stripped). identityFolderName is used for ALL folder/file path
// construction downstream (identity dir, identity file basename, avatar
// filename, relay.json path, tmux session name, JSONL discovery key).
//
// Purpose (fixes two production bugs verified 2026-09-18):
//   1. Claude Code auto-resume of the OLD JSONL at
//      ~/.claude/projects/-home-ubuntu-fleet-identities-<name>-workspace/
//      when a pool name is reused. deriveMxidWithOrdinal guarantees MXID
//      uniqueness against Synapse; deriving the folder name from the MXID
//      means the workspace path is also structurally unique.
//   2. agent-supervisor's retire_identity "State 3" archive-name collision
//      (identities-archive/<name>/ already exists → mv refuses → archive
//      silently fails, identity stuck). Folder uniqueness ⇒ archive path
//      uniqueness.
//
// Note: opts.name is still used for displayName (UI badge) and the H1
// heading inside <name>.md — those are human-readable strings, not
// filesystem identifiers, so they stay short ("Anthem", not
// "Anthem-box-maintainer-2").
async function deriveMxidAndFolderName(
  input: { name: string; role?: string; poolPicked?: boolean },
  deps: {
    matrixServerName: string | null;
    matrixHomeserver: string;
    matrixCountUsersMatching: (
      mxid: string,
    ) => Promise<
      | { ok: true; total: number }
      | { ok: false; status: number; error: string }
    >;
  },
): Promise<{ mxid: string; identityFolderName: string }> {
  // Server-name suffix for the mxid — same branching that used to live at
  // the top of runRelayMintAndWrite (L886-889 pre-refactor).
  const serverName =
    deps.matrixServerName != null
      ? deps.matrixServerName
      : extractServerName(deps.matrixHomeserver);

  let mxid: string;
  if (input.poolPicked === true && typeof input.role === "string") {
    let baseHandle: string | null = null;
    try {
      baseHandle = composeMxidLocalpart(input.name, input.role);
    } catch (e) {
      // Silent fallback for `mxid_name_not_pool_shape` ONLY — matches shape
      // file's "user can edit the name to anything" invariant. Other errors
      // (e.g. `mxid_role_malformed`) rethrow to fail Step 1 loudly since
      // role names are gate-validated upstream.
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.startsWith("mxid_name_not_pool_shape")) {
        throw e;
      }
      baseHandle = null;
    }
    if (baseHandle !== null) {
      mxid = await deriveMxidWithOrdinal(
        baseHandle,
        serverName,
        deps.matrixCountUsersMatching,
      );
    } else {
      // Silent-fallback branch (name-not-pool-shape catch above).
      mxid = `@${input.name}:${serverName}`;
    }
  } else {
    // Legacy branch — unchanged behavior for pre-Phase-80 identities and the
    // retry route (poolPicked undefined).
    mxid = `@${input.name}:${serverName}`;
  }

  // identityFolderName = MXID localpart (strip leading `@` and `:<serverName>`
  // suffix by explicit slice). We control the composition so this is a plain
  // slice — do NOT regex-strip (a future serverName containing regex
  // metacharacters would silently break).
  const identityFolderName = mxid.slice(1, mxid.length - serverName.length - 1);

  // Defense-in-depth on the DERIVED value. composeMxidLocalpart output is
  // already lowercase-kebab and the legacy branch just echoes opts.name
  // (which passed IDENTITY_KEY_RE upstream), so this should never fire —
  // but a future change to the localpart shape must not silently break
  // folder-safety.
  if (!IDENTITY_KEY_RE.test(identityFolderName)) {
    throw new Error(
      `derived identityFolderName fails IDENTITY_KEY_RE gate: ${JSON.stringify(identityFolderName)}`,
    );
  }

  return { mxid, identityFolderName };
}

// ---------------------------------------------------------------------------
// Phase 80 Plan 80-03b — A1 lock MXID derivation helpers
// ---------------------------------------------------------------------------
//
// composeMxidLocalpart + deriveMxidWithOrdinal implement the A1 DIVERGE
// decision: identity KEY (folder name, IDENTITY_KEY_RE gate) stays lowercase
// (e.g. `willow`) AND the Matrix account MXID localpart is also lowercase-
// hyphenated `<pool-name>-<role>[-N]` (e.g. `willow-skynet-maintainer`,
// `willow-skynet-maintainer-2`, ...). Both helpers are pure (side-effect-free
// modulo deriveMxidWithOrdinal's injected countFn) so they're testable in
// isolation without matrix mocking.
//
// 2026-09-11: mxid localpart was PascalCase (`Willow-Skynet-Maintainer`) until
// Synapse rejected every birth with M_INVALID_USERNAME (Matrix spec requires
// lowercase). Casing convention below is preserved as the DERIVATION rules
// but the OUTPUT is lowercase — see composeMxidLocalpart body.
//
// Casing convention (locked to shape file 2026-09-06):
//   - PoolName PascalCase (`willow` → `Willow`): first letter uppercased,
//     rest verbatim. Pool names are single-lowercase-word (POOL_NAME_RE) so
//     this is safe.
//   - Role name PascalCase-hyphenated (`skynet-maintainer` → `Skynet-Maintainer`):
//     each hyphen-separated segment's first letter uppercased, rest verbatim.
//     Applies to role shapes matching ROLE_NAME_RE.
//   - Malformed role → throws `mxid_role_malformed` (Step 6 does NOT catch —
//     malformed role is a genuine bug).
//   - Non-pool-shape name → throws `mxid_name_not_pool_shape` (Step 6 catches
//     and falls back to legacy `@<name>:<server>` — user may have edited a
//     pool-picked name to a non-pool form; silent fallback per shape file).

/** Pool-name regex: single-word lowercase, no hyphens, no leading digit.
 * Enforces the pool-restriction in composeMxidLocalpart — if the operator has
 * edited the name field to a non-pool shape (e.g. legacy `taylor-2` or
 * user-typed `my-custom`), throws `mxid_name_not_pool_shape` which Step 6
 * catches as a signal to fall back to the legacy MXID shape. */
const POOL_NAME_RE = /^[a-z][a-z0-9]*$/;

/** Role-name regex: kebab-case-lowercase, no leading digit per segment, no
 * empty segments. Stricter than the existing ROLE_NAME_PATTERN (which accepts
 * digits at segment starts and any [a-z0-9-] shape) — required for MXID
 * composition where the derived PascalCase output must be deterministic and
 * segment boundaries must be well-formed. */
export const ROLE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;

/** Ordinal-search safety cap. Pool exhaustion beyond 100 accounts of the same
 * handle indicates operator intervention needed — pool-list expansion or
 * manual renaming. Exceeding the cap throws `mxid_ordinal_exhausted` which
 * propagates through Step 6's runStep as a step-failed SSE event (Q2
 * no-rollback discipline preserved). */
export const MXID_ORDINAL_MAX = 100;

/**
 * Compose the MXID localpart from a pool-picked name + role per the A1 DIVERGE
 * shape file lock. Pure — no I/O, no state. See constants above for casing
 * convention.
 *
 * Throws:
 *   - `Error("mxid_role_malformed: <role>")` when role fails ROLE_NAME_RE.
 *     Step 6 does NOT catch this — malformed role is a genuine bug that must
 *     surface as a Step 6 failure.
 *   - `Error("mxid_name_not_pool_shape: <name>")` when name fails POOL_NAME_RE.
 *     Step 6 catches this and falls back to `@<name>:<server>` — the operator
 *     may have edited a pool-picked name to a non-pool shape.
 *
 * Examples:
 *   composeMxidLocalpart("willow", "skynet-maintainer") → "willow-skynet-maintainer"
 *   composeMxidLocalpart("aster", "coordinator")        → "aster-coordinator"
 *   composeMxidLocalpart("willow", "foo-bar-baz")       → "willow-foo-bar-baz"
 */
export function composeMxidLocalpart(name: string, role: string): string {
  // Phase 80 review fix (H5): defensive lowercase — the frontend already
  // lowercases via `name.toLowerCase()` at NewSessionDialog submit-time, but a
  // client bypassing that path (curl, hand-rolled tool) could submit `Willow`
  // (PascalCase from the pool.json seed). Without this, POOL_NAME_RE rejects
  // and Step 6 falls back to legacy `@Willow:server` — an uppercase-localpart
  // MXID that Synapse rejects. Normalize here so backend is source-of-truth.
  const normalizedName = name.toLowerCase();
  if (!POOL_NAME_RE.test(normalizedName)) {
    throw new Error(`mxid_name_not_pool_shape: ${name}`);
  }
  if (!ROLE_NAME_RE.test(role)) {
    throw new Error(`mxid_role_malformed: ${role}`);
  }
  // 2026-09-11: lowercase output. Matrix spec (client-server v3 §5.5.1) +
  // Synapse (M_INVALID_USERNAME "User ID can only contain characters a-z,
  // 0-9, or '=_-./+'") both require mxid localparts to be lowercase. Phase
  // 80's original PascalCase output ("Willow-Box-Maintainer") was rejected
  // by Synapse's admin PUT /_synapse/admin/v2/users/<mxid> — every
  // pool-picked birth got 400 back at Step 6 (admin_mint_failed). Since
  // the composed handle is only ever consumed as an mxid (Skynet doesn't
  // use it as a display name — displayName is derived separately from
  // opts.name in the orchestrator's Step 6 call site), casing lives here.
  // ROLE_NAME_RE is already kebab-case-lowercase, so role passes through
  // unchanged; only the pool name needs normalization (already done above).
  return `${normalizedName}-${role}`;
}

/**
 * Derive an unused MXID by iterating ordinal suffixes against the Synapse
 * admin API until an unused handle is found. Silent auto-suffix per CONTEXT.md
 * `<domain>` bullet: caller (Step 6) never sees the ordinal choice — the
 * returned MXID is opaquely usable.
 *
 * Algorithm:
 *   1. Try `@<baseHandle>:<serverName>`. If countFn returns total===0 → use it.
 *   2. Iterate n=2..MXID_ORDINAL_MAX: try `@<baseHandle>-<n>:<serverName>`.
 *      Return the first total===0.
 *   3. All busy → throws `mxid_ordinal_exhausted: <baseHandle>`.
 *
 * Any countFn failure (ok:false) throws `admin_count_failed: <error> (<status>)`
 * which Step 6's runStep catches and attributes to step 6 as a step-failed
 * SSE event (mirrors the existing admin_mint_failed / admin_login_failed
 * error-attribution pattern in runRelayMintAndWrite).
 */
export async function deriveMxidWithOrdinal(
  baseHandle: string,
  serverName: string,
  countFn: (
    mxid: string,
  ) => Promise<
    | { ok: true; total: number }
    | { ok: false; status: number; error: string }
  >,
): Promise<string> {
  // n=1 is the bare handle (no ordinal suffix); n=2..MXID_ORDINAL_MAX carry
  // the `-<n>` suffix. Cap total iterations at MXID_ORDINAL_MAX per T-80-03b-02.
  for (let n = 1; n <= MXID_ORDINAL_MAX; n++) {
    const candidate =
      n === 1
        ? `@${baseHandle}:${serverName}`
        : `@${baseHandle}-${n}:${serverName}`;
    const result = await countFn(candidate);
    if (result.ok === false) {
      // Explicit `=== false` narrowing matches the existing pattern at Step 6's
      // mintResult / loginResult guards (L677+). `!result.ok` fails to narrow
      // the discriminated union under tsconfig.node.json's strict setup —
      // build tsc sees the full union inside the guard instead of just the
      // ok:false variant.
      throw new Error(
        `admin_count_failed: ${result.error} (${result.status})`,
      );
    }
    if (result.total === 0) {
      return candidate;
    }
  }
  throw new Error(`mxid_ordinal_exhausted: ${baseHandle}`);
}

/**
 * Run Step 6 (admin-mint + login), Step 7 (build relay.json body), and Step 8
 * (SFTP write + chmod 600) via the same runStep-shaped wrapper that
 * birthIdentity uses. Exported so identity-birth.ts POST /retry/:key can
 * invoke this directly against an existing identity folder (Q2 partial-
 * failure recovery path).
 *
 * Emits: step:6:started, step:6:completed, step:7:started, step:7:completed,
 *        step:8:started, step:8:completed on happy path.
 *        step:N:failed + ended{ok:false, failedStep:N} on any failure.
 *
 * Throws BirthAborted on step failure so callers can distinguish "step
 * failed, event already emitted" from "unexpected error, emit ended{ok:false}".
 *
 * Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-
 * supervisor race. This helper NEVER deletes the identity folder on failure;
 * neither may any caller.
 */
export async function runRelayMintAndWrite(
  opts: {
    name: string;
    displayName?: string;
    /**
     * Target host record ID. Threaded into Step 8's writeIdentityFile
     * primitive so it can pick LOCAL (isLocalHostId → bind-mount fast-path,
     * `conn` here is null) vs REMOTE (SFTP tmp+rename, `conn` non-null) —
     * matches the WriteIdentityFileOpts contract at
     * claude-session/per-identity-file.ts.
     */
    hostId: number;
    /**
     * 2026-09-18 (quick 260918-52n): the fully-derived MXID
     * (`@<localpart>:<serverName>`). Derivation now happens in Step 1 of
     * birthIdentity (or at the retry-route call site in identity-birth.ts)
     * via the shared deriveMxidAndFolderName helper, so this helper no
     * longer computes the MXID internally — it just uses what the caller
     * derived. Step 6 (admin-mint) consumes it as the Synapse admin PUT
     * target; Step 7 threads it into the relay.json body.
     */
    mxid: string;
    /**
     * 2026-09-18 (quick 260918-52n): the MXID localpart (leading `@` and
     * `:<serverName>` suffix stripped). Used by Step 8 as the identity
     * folder key for the relay.json write path
     * (`fleet/identities/<identityFolderName>/relay.json`). Identical to
     * MXID localpart to guarantee folder-name uniqueness (deriveMxidWithOrdinal
     * enforces MXID uniqueness against Synapse).
     */
    identityFolderName: string;
  },
  emit: (e: BirthEvent) => void,
  deps: BirthDeps,
  conn: SSHClient | null,
): Promise<void> {
  // Local runStep — same shape as birthIdentity's inner runStep so events emit
  // with identical framing whether we're inside birthIdentity or the retry
  // route. Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode +
  // agent-supervisor race. NO folder-cleanup in this catch, ever.
  //
  // conn === null → LOCAL host (isLocalHostId=true). writeIdentityFile at
  // Step 8 routes on hostId + conn; matrix-admin primitives (Steps 6/7) do
  // not touch conn at all.
  async function runStep(
    n: 6 | 7 | 8,
    fn: () => Promise<void>,
  ): Promise<void> {
    emit({ type: "step", n, phase: "started" });
    try {
      await fn();
      emit({ type: "step", n, phase: "completed" });
    } catch (e) {
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      // Phase 106 (D-11): propagate the sanitized reason string on the ended
      // event too, so log-forensics on the SSE consumer side can distinguish
      // Skynet-side step failures from supervisor-wait timeouts by inspecting
      // ended.reason without having to correlate to the step:failed breadcrumb.
      const reason = sanitizeError(e);
      emit({ type: "step", n, phase: "failed", reason });
      emit({ type: "ended", ok: false, failedStep: n, reason });
      throw new BirthAborted(n);
    }
  }

  // 2026-09-18 (quick 260918-52n): MXID derivation moved OUT of Step 6 and
  // into Step 1 of birthIdentity (or into the retry-route call site in
  // identity-birth.ts). The caller passes both the fully-derived MXID and
  // the identityFolderName; this helper just uses them. See
  // deriveMxidAndFolderName above for the shared derivation logic and
  // rationale (fixes Claude-Code session-resume + agent-supervisor
  // archive-name collision bugs).
  const mxid = opts.mxid;

  // Closure-scoped state passed between the three steps.
  let agentPassword = "";
  let mintedAccessToken = "";

  // -------------------------------------------------------------------------
  // Step 6: admin-mint (createOrUpdateUser) + inline login-as-user
  //
  // 2026-09-18 (quick 260918-52n): MXID derivation used to live INSIDE this
  // runStep block. It has been hoisted into Step 1 of birthIdentity so the
  // on-disk folder-existence probe runs against the correct
  // (mxid-localpart-derived) path. See deriveMxidAndFolderName.
  //
  // D-OQ6 lock: matrixLoginAsUser is called immediately after
  // matrixCreateOrUpdateUser inside the same runStep so the relay.json body
  // built in Step 7 carries a real (non-empty) access_token — recv.sh does
  // not have to relogin on first read. A login failure attributes to Step 6
  // (still an admin-mint concern from the caller's POV).
  // -------------------------------------------------------------------------
  await runStep(6, async () => {
    agentPassword = generateAgentPassword();
    const mintResult = await deps.matrixCreateOrUpdateUser(
      mxid,
      agentPassword,
      opts.displayName,
    );
    if (mintResult.ok === false) {
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      // Explicit `=== false` narrowing: `!mintResult.ok` fails to narrow the
      // discriminated union under tsconfig.node.json's strict setup (build tsc
      // sees the full union inside the guard instead of just the ok:false variant).
      throw new Error(
        `admin_mint_failed: ${mintResult.error} (${mintResult.status})`,
      );
    }
    // D-OQ6: mint a real access_token so relay.json carries it from birth-time.
    const loginResult = await deps.matrixLoginAsUser(mxid);
    if (loginResult.ok === false) {
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      throw new Error(
        `admin_login_failed: ${loginResult.error} (${loginResult.status})`,
      );
    }
    mintedAccessToken = loginResult.accessToken;

    // -----------------------------------------------------------------------
    // Phase 89 D-11 hook. Best-effort: a failed join does NOT fail the
    // birth — the observation loop's classification will fall back to
    // 'unknown foreign account'. Backfill of pre-existing agents is
    // FULLY MANUAL (SSH-based dance if ever needed) — no in-process path.
    // -----------------------------------------------------------------------
    try {
      const joinResult = await joinAgentToAgentsRegistry(mxid);
      if (joinResult.ok === false) {
        databaseLogger.warn(
          "identity birth: agents-registry join failed (best-effort per D-12)",
          {
            operation: "identity_birth_registry_join_failed",
            mxid,
            status: joinResult.status,
            error: joinResult.error,
          },
        );
      }
    } catch (joinErr) {
      databaseLogger.warn(
        "identity birth: agents-registry join threw unexpectedly (best-effort per D-12)",
        {
          operation: "identity_birth_registry_join_threw",
          mxid,
          error: joinErr instanceof Error ? joinErr.message : String(joinErr),
        },
      );
    }
  });

  // -------------------------------------------------------------------------
  // Step 7: build relay.json body via the pure Plan-02 helper
  //
  // Guards against an empty access_token propagating to disk — that would
  // silently break recv.sh's first-read semantics without failing loudly here.
  // -------------------------------------------------------------------------
  let relayJsonBody = "";
  await runStep(7, async () => {
    if (!mintedAccessToken) {
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      throw new Error("empty_access_token_from_login");
    }
    relayJsonBody = deps.buildRelayJsonBody({
      mxid,
      password: agentPassword,
      accessToken: mintedAccessToken,
      // 2026-09-11: relay.json's `base` field consumes the host-reachable
      // URL — NOT deps.matrixHomeserver, which may be a container-internal
      // alias like `http://synapse:8008`. Sourced from
      // creds.hostSideBase ?? creds.homeserverBase in identity-birth.ts.
      // Step 6's mxid derivation (extractServerName(deps.matrixHomeserver))
      // is intentionally unchanged — that path needs the URL Skynet uses
      // to reach synapse from inside its container.
      homeserverBase: deps.relayJsonHomeserverBase,
    });
  });

  // -------------------------------------------------------------------------
  // Step 8: relay.json write + chmod 600 via per-identity-file primitive
  //
  // Phase 92 Plan 92-01 Task 2 (D-05): rerouted from a direct
  // deps.writeMarkdownFileAtomic + deps.execCommand(chmod 600) sequence to
  // the writeIdentityFile primitive at src/backend/claude-session/per-identity-file.ts.
  //
  // Byte-shape parity vs pre-refactor L862 literal:
  //   - Target path: `$HOME/fleet/identities/${opts.name}/relay.json` —
  //     $HOME is passed to SFTP as a LITERAL string (primitive matches this
  //     shape verbatim; see per-identity-file.ts remoteTargetPath).
  //   - Body: relayJsonBody is threaded through unchanged.
  //   - chmod 600: opts.chmod=0o600 threaded into the primitive, which
  //     preserves the pre-refactor `chmod_600_failed:` error tag on failure.
  //
  // The tmp+atomic-rename discipline in writeMarkdownFileAtomic
  // (identity-artifact-reader.ts:1924) handles the concurrency case where
  // a retry lands on an existing relay.json — Pitfall 3 / #2924. The
  // primitive delegates writes to that helper (do NOT re-implement).
  //
  // chmod 600 is REQUIRED (not best-effort) per S-1 lock — a world-readable
  // relay.json exposes the agent's Matrix credentials to any other target-
  // host user (T-75-18). Matches agent-relay/SKILL.md:105 fleet convention.
  //
  // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode +
  // agent-supervisor race. runStep(8)'s catch is unchanged.
  // -------------------------------------------------------------------------
  await runStep(8, async () => {
    // 2026-09-18 (quick 260918-52n): first arg is the identity folder key
    // used to build `fleet/identities/<key>/relay.json` — swap opts.name →
    // opts.identityFolderName so the write lands under the mxid-localpart-
    // derived path (matches the folder created in Step 2).
    await writeIdentityFile(opts.identityFolderName, "relay.json", relayJsonBody, {
      hostId: opts.hostId,
      conn,
      chmod: 0o600,
    });
  });
}

// ---------------------------------------------------------------------------
// Peer-commit script builder (mint-first atomic-birth reshape)
// ---------------------------------------------------------------------------

/**
 * Build the single bash script that lands the birth's peer-side state
 * atomically. Executed in ONE SSH exec (or one execLocal for self-birth) —
 * no round-trip fragmentation. Replaces the pre-reshape Step 1 collision
 * probe + Step 2 mkdir/writes + Step 8 SFTP-relay.json chain.
 *
 * Atomicity model: everything is staged inside a mktemp -d directory that
 * lives on the SAME filesystem as `<fleetRoot>/identities` (kept under
 * `<fleetRoot>/.cache/skynet-birth-staging/` for this reason — a
 * cross-filesystem `mv` degrades to copy+delete which is NOT atomic and
 * would leave a window where the identity folder is half-populated).
 * The final `mv` is a kernel-atomic rename syscall: peer disk either has
 * the entire identity folder or none of it.
 *
 * Exit-code taxonomy consumed by callers (execCommand rejects on non-zero
 * exit with stderr baked into the Error message — the taxonomy is preserved
 * through the STRING content, not just the code, since ssh2's exec API
 * doesn't surface the numeric code back through the Promise reject):
 *   0  = success (stdout ends "birth_committed")
 *   90 = role folder missing on peer                  → matches worker.ts
 *          /role.*not found/i → `role_unknown`
 *   91 = identity folder already exists on peer       → matches pre-reshape
 *          "identity already exists on this host" string
 *   92 = staging area setup failed
 *   93 = writing into staging failed
 *   94 = atomic commit rename failed
 *
 * All file bodies are base64-encoded before interpolation so any special
 * characters (newlines, quotes, non-ASCII) survive the SSH command channel
 * + shell heredoc-free single-quoted echo cleanly. Same convention as
 * fleet-status/remote-hook-install.ts and distributor/ssh-push.ts.
 *
 * fleetRoot: pass "$HOME/fleet" for remote branch (target shell expands),
 *            pass an absolute bind-mount path (e.g. "/host-home/fleet") for
 *            LOCAL self-birth where the container shell's $HOME does NOT
 *            resolve to the fleet dir.
 */
function buildPeerCommitScript(args: {
  role: string;
  identityFolderName: string;
  identityFileBody: string;
  relayJsonBody: string;
  fleetRoot: string;
}): string {
  // role + identityFolderName are already regex-gated (ROLE_NAME_PATTERN
  // and IDENTITY_KEY_RE) before we reach this builder, so shell
  // interpolation is safe.
  const { role, identityFolderName, fleetRoot } = args;
  const identityFileBodyB64 = Buffer.from(args.identityFileBody, "utf-8").toString("base64");
  const relayJsonBodyB64 = Buffer.from(args.relayJsonBody, "utf-8").toString("base64");

  return `set -e
FLEET_ROOT="${fleetRoot}"
ROLE="${role}"
KEY="${identityFolderName}"

# Guard 1: role folder must exist on peer
if [ ! -f "$FLEET_ROOT/roles/$ROLE/$ROLE.md" ]; then
  echo "role not found on target host: $ROLE" >&2
  exit 90
fi

# Guard 2: identity folder must NOT already exist
if [ -d "$FLEET_ROOT/identities/$KEY" ]; then
  echo "identity already exists on this host" >&2
  exit 91
fi

# Ensure the identities parent exists (brand-new peers may not have it yet)
mkdir -p "$FLEET_ROOT/identities" || { echo "peer_identities_root_mkdir_failed" >&2; exit 92; }

# Staging root on the SAME filesystem as the target so the final mv is
# kernel-atomic (rename syscall). A cross-filesystem mv degrades to
# copy+delete and would open a half-populated window.
STAGING_ROOT="$FLEET_ROOT/.cache/skynet-birth-staging"
mkdir -p "$STAGING_ROOT" || { echo "peer_staging_root_mkdir_failed" >&2; exit 92; }
STAGING=$(mktemp -d "$STAGING_ROOT/birth-XXXXXX") || { echo "peer_staging_mktemp_failed" >&2; exit 92; }
trap 'rm -rf "$STAGING"' EXIT

# Write identity file
printf '%s' '${identityFileBodyB64}' | base64 -d > "$STAGING/$KEY.md" || { echo "peer_identity_md_write_failed" >&2; exit 93; }

# Create subdirs + handoff sentinel
mkdir "$STAGING/wakeups" "$STAGING/workspace" || { echo "peer_subdir_mkdir_failed" >&2; exit 93; }
touch "$STAGING/handoff.md" || { echo "peer_handoff_touch_failed" >&2; exit 93; }

# Write relay.json + chmod 600 (T-75-18 S-1 lock: Matrix creds cannot be
# world-readable). chmod on the staging path is fine — permissions survive
# the mv into place.
printf '%s' '${relayJsonBodyB64}' | base64 -d > "$STAGING/relay.json" || { echo "peer_relay_json_write_failed" >&2; exit 93; }
chmod 600 "$STAGING/relay.json" || { echo "peer_relay_json_chmod_failed" >&2; exit 93; }

# Atomic commit
mv "$STAGING" "$FLEET_ROOT/identities/$KEY" || { echo "peer_commit_mv_failed" >&2; exit 94; }

# Post-mv: $STAGING no longer exists. The trap's rm -rf is a silent no-op
# on nonexistent paths (rm -rf never errors when the target is gone).

echo birth_committed
exit 0
`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the birth sequence and emit progress events. Post-Phase-106 the steps
 * that actually fire are 1 (collision probe + candidate check), 2 (mkdir +
 * identity file + avatar sibling), 6 (admin-mint + login), 7 (build relay.json
 * body), 8 (SFTP-write relay.json), then a wait-for-supervisor block that
 * closes with an ended:ok:true (success) or ended:ok:false + reason (timeout).
 * The retired 3/4/5 slots are documented in the file header block above.
 *
 * @param opts   Birth options from the HTTP request body + userId from JWT
 * @param emit   Callback receiving BirthEvent objects as each step runs
 * @param deps   Injected dependencies (testable; route provides real ones)
 */
export async function birthIdentity(
  opts: BirthOptions,
  emit: (e: BirthEvent) => void,
  deps: BirthDeps,
): Promise<void> {
  // -------------------------------------------------------------------------
  // Mint-first atomic-birth reshape (2026-09-24, reopens D-20 from spawn-
  // request-watcher shape).
  //
  // Pre-reshape: birth was 5 ordered steps with fragmented state — Step 1
  //   probed peer (SSH), Step 2 mkdir+wrote identity file (SFTP), Step 6
  //   admin-minted on Synapse, Step 7 built relay.json in-memory, Step 8
  //   SFTP-wrote relay.json + chmod. A Skynet crash between steps 2 and 8
  //   left half-births on peer disk (identity dir + .md file with no
  //   relay.json — the eda51eac/crane/maple failure mode).
  //
  // Post-reshape: mint FIRST on Skynet, then commit ALL peer state in ONE
  //   atomic SSH exec via a bash script that stages inside a same-filesystem
  //   mktemp -d and finalizes with a kernel-atomic mv rename. Peer disk
  //   never sees a half-populated identity dir. On any peer-commit failure,
  //   deactivate the just-minted Matrix account so retry with next ordinal
  //   doesn't leak Synapse accounts.
  //
  // Wire-compat: BirthEvent step numbers (1, 2, 6, 7, 8) are preserved so
  //   the frontend BirthProgress checklist doesn't need re-wiring. Steps 1
  //   and 2 now cover MXID derivation (fast, local, no SSH) and step 2 is
  //   emitted as an instant-complete placeholder for the retired
  //   "mkdir+writes on peer" phase. Steps 6 and 7 stay Skynet-side. Step 8
  //   is the new peer-commit script exec.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 0. Validate name (defense-in-depth — route layer should also gate)
  // -------------------------------------------------------------------------
  if (!IDENTITY_KEY_RE.test(opts.name)) {
    throw new Error(
      `identityKey must match [a-z0-9._=/+-]+; got: ${JSON.stringify(opts.name)}`,
    );
  }

  // CR-02: Second gate — stricter tmux-safety check. Names containing `=`,
  // `/`, `+`, or `.` pass IDENTITY_KEY_RE but produce malformed/ambiguous tmux
  // target arguments. Reject them before any SSH/exec/DB work is done.
  if (!TMUX_SAFE_NAME_RE.test(opts.name)) {
    throw new Error(
      `identity name unsafe for tmux target — must match [a-z][a-z0-9_-]*; got: ${JSON.stringify(opts.name)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 0b. Normalize opts.path (best-effort custom workspace dir pre-created by
  // the peer-commit script AFTER the atomic commit lands — kept as a
  // frontend affordance, not a birth-gating field). Same ~/…/$HOME rewrite
  // rules as pre-reshape so existing form inputs keep working.
  // -------------------------------------------------------------------------
  let normalizedPath = opts.path.replace(/\\/g, "/");
  if (
    normalizedPath === "" ||
    normalizedPath === "~" ||
    normalizedPath === "~/"
  ) {
    normalizedPath = "$HOME";
  } else if (normalizedPath.startsWith("~/")) {
    normalizedPath = "$HOME/" + normalizedPath.slice(2);
  }

  // -------------------------------------------------------------------------
  // 0c. runStep helper — wraps each step in started/completed/failed events
  // -------------------------------------------------------------------------
  async function runStep(
    // Phase 75 Plan 04 — n widened to include the three new admin-mint +
    // relay.json write steps (6: createOrUpdateUser, 7: buildRelayJsonBody,
    // 8: SFTP write + chmod 600).
    n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    fn: () => Promise<void>,
    failReasonOverride?: string,
  ): Promise<void> {
    emit({ type: "step", n, phase: "started" });
    try {
      await fn();
      emit({ type: "step", n, phase: "completed" });
    } catch (e) {
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      // A step:N:failed here MUST NOT trigger any folder-cleanup of the
      // on-disk identity folder created at Step 1. The agent-supervisor race
      // (Pitfall 6) means the supervisor may already have started a tmux
      // session for the identity; deleting the folder would delete something
      // the supervisor is actively dealing with. The id skill's self-register
      // fallback handles the partial-state case gracefully.
      //
      // Phase 106 (D-11): propagate the sanitized reason string on the ended
      // event too, so log-forensics on the SSE consumer side can distinguish
      // Skynet-side step failures from supervisor-wait timeouts by inspecting
      // ended.reason without having to correlate to the step:failed breadcrumb.
      const reason = failReasonOverride ?? sanitizeError(e);
      emit({ type: "step", n, phase: "failed", reason });
      emit({ type: "ended", ok: false, failedStep: n, reason });
      throw new BirthAborted(n);
    }
  }

  // -------------------------------------------------------------------------
  // Closure-scoped state shared across steps + rollback.
  //
  //   mxid + identityFolderName: derived in Step 1 (Skynet-side, consults
  //     Synapse admin API for ordinal collision). identityFolderName drives
  //     every subsequent path (peer script's target dir, supervisor sensor
  //     probe key, ended event's identityId + sessionName).
  //
  //   agentPassword + mintedAccessToken: filled by Step 6 (admin-mint +
  //     login-as-user), consumed by Step 7 (relay.json body build).
  //
  //   mintedForRollback: flipped true once the Synapse admin mint returns
  //     ok:true. Consumed by the finally block: if birthCommitted is still
  //     false when we exit, deactivate the just-minted account so a retry
  //     with next ordinal doesn't leak Synapse accounts.
  //
  //   birthCommitted: flipped true once the peer-side atomic mv lands in
  //     Step 8. Once true, we don't roll back on subsequent failure — the
  //     identity is fully on peer disk and the supervisor will bring it
  //     alive; a supervisor-wait timeout leaves everything on disk (Q2
  //     no-rollback lock preserved from the pre-reshape flow).
  // -------------------------------------------------------------------------
  let mxid = "";
  let identityFolderName = "";
  let agentPassword = "";
  let mintedAccessToken = "";
  let relayJsonBody = "";
  let identityFileBody = "";
  let mintedForRollback = false;
  let birthCommitted = false;

  const useLocal = deps.isLocalHostId(opts.hostId);

  // For SSH branch: resolve the host and connect BEFORE Step 8. Wrap all
  // step ops + wait-for-supervisor in a single try/catch/finally so the
  // SSH connection is released regardless of which step failed, and so the
  // rollback (matrixDeactivateUser) fires exactly once on any pre-commit
  // failure path.
  let conn: SSHClient | null = null;

  try {
    // -----------------------------------------------------------------------
    // Step 1: Skynet-side MXID derivation (consults Synapse admin API for
    //         ordinal collision resolution when poolPicked=true). No SSH.
    //         The failure surface is: local role-name validation + one
    //         Synapse admin API call.
    // -----------------------------------------------------------------------
    await runStep(1, async () => {
      if (!opts.role || !ROLE_NAME_PATTERN.test(opts.role)) {
        throw new Error(
          `role must match ${ROLE_NAME_PATTERN}; got: ${JSON.stringify(opts.role)}`,
        );
      }
      const derived = await deriveMxidAndFolderName(
        { name: opts.name, role: opts.role, poolPicked: opts.poolPicked },
        {
          matrixServerName: deps.matrixServerName,
          matrixHomeserver: deps.matrixHomeserver,
          matrixCountUsersMatching: deps.matrixCountUsersMatching,
        },
      );
      mxid = derived.mxid;
      identityFolderName = derived.identityFolderName;
    });

    // -----------------------------------------------------------------------
    // Step 2: wire-compat instant-complete placeholder. The mkdir + identity-
    //         file write that lived here pre-reshape is folded into Step 8's
    //         atomic peer-commit script. Emitted as instant start+complete
    //         so the frontend BirthProgress checklist doesn't stall on a
    //         step that never fires.
    // -----------------------------------------------------------------------
    emit({ type: "step", n: 2, phase: "started" });
    emit({ type: "step", n: 2, phase: "completed" });

    const displayName = opts.name.length > 0
      ? opts.name[0].toUpperCase() + opts.name.slice(1)
      : opts.name;

    // -----------------------------------------------------------------------
    // Step 6: admin-mint (createOrUpdateUser) + login-as-user +
    //         best-effort agents-registry join. On mint success we set
    //         mintedForRollback=true so a subsequent Step 7 or Step 8
    //         failure triggers deactivate in the finally block below.
    // -----------------------------------------------------------------------
    await runStep(6, async () => {
      agentPassword = generateAgentPassword();
      const mintResult = await deps.matrixCreateOrUpdateUser(
        mxid,
        agentPassword,
        displayName,
      );
      if (mintResult.ok === false) {
        throw new Error(
          `admin_mint_failed: ${mintResult.error} (${mintResult.status})`,
        );
      }
      mintedForRollback = true;

      const loginResult = await deps.matrixLoginAsUser(mxid);
      if (loginResult.ok === false) {
        throw new Error(
          `admin_login_failed: ${loginResult.error} (${loginResult.status})`,
        );
      }
      mintedAccessToken = loginResult.accessToken;

      // Phase 89 D-11 hook — best-effort join to the agents registry room.
      // A failed join does NOT fail the birth; the observation loop's
      // classification falls back to 'unknown foreign account'.
      try {
        const joinResult = await joinAgentToAgentsRegistry(mxid);
        if (joinResult.ok === false) {
          databaseLogger.warn(
            "identity birth: agents-registry join failed (best-effort per D-12)",
            {
              operation: "identity_birth_registry_join_failed",
              mxid,
              status: joinResult.status,
              error: joinResult.error,
            },
          );
        }
      } catch (joinErr) {
        databaseLogger.warn(
          "identity birth: agents-registry join threw unexpectedly (best-effort per D-12)",
          {
            operation: "identity_birth_registry_join_threw",
            mxid,
            error:
              joinErr instanceof Error ? joinErr.message : String(joinErr),
          },
        );
      }
    });

    // -----------------------------------------------------------------------
    // Step 7: build relay.json body + identity file body — both consumed
    //         by Step 8's peer-commit script as base64-encoded blobs.
    //         Guards against empty access_token propagating to disk.
    // -----------------------------------------------------------------------
    await runStep(7, async () => {
      if (!mintedAccessToken) {
        throw new Error("empty_access_token_from_login");
      }
      relayJsonBody = deps.buildRelayJsonBody({
        mxid,
        password: agentPassword,
        accessToken: mintedAccessToken,
        homeserverBase: deps.relayJsonHomeserverBase,
      });
      // Phase 86 Plan 86-04 (D-CTX-86-inherit): avatar is absent-⇒-omit for
      // this reshape — spawn-request births never carry an avatar, and the
      // SSE frontend's create form dropped its avatar-upload affordance
      // (avatars are edit-only now). Empty avatarFilename → frontmatter
      // omits `avatar:` and the role's avatar resolves via role-folder
      // fallback per Plan 86-01.
      identityFileBody = buildIdentityFileBody(opts, displayName, "");
    });

    // -----------------------------------------------------------------------
    // Step 8: SSH connect (remote branch) + execute the atomic peer-commit
    //         script in ONE exec. Failure at any point in the peer script
    //         exits non-zero with a stderr message; execCommand rejects
    //         with that message baked into the Error, which runStep's
    //         catch converts to a step:8:failed emit + BirthAborted throw.
    //         The finally block below picks up the pieces (rollback +
    //         connection release).
    // -----------------------------------------------------------------------
    if (!useLocal) {
      try {
        const host = await deps.resolveHostById(opts.hostId, opts.userId);
        conn = await deps.connectOneShot(host, SSH_CONNECT_TIMEOUT_MS);
      } catch (e) {
        // SSH connect failure surfaces as step:8:failed with the same "Host
        // unreachable" reason string Fix 3's worker.ts routing depends on
        // (sanitizeError maps /connect/i → "Host unreachable" →
        // peer_host_unreachable). Rollback still fires via the finally
        // block because mintedForRollback=true.
        const reason = "Host unreachable";
        emit({ type: "step", n: 8, phase: "started" });
        emit({ type: "step", n: 8, phase: "failed", reason });
        emit({ type: "ended", ok: false, failedStep: 8, reason });
        throw new BirthAborted(8);
      }
    }

    // Resolve the fleet root for the peer script. Remote branch relies on
    // the peer shell to expand $HOME; local branch substitutes the
    // container's bind-mount fleet root (parent of getLocalIdentitiesRoot()).
    const fleetRoot = useLocal
      ? path.dirname(getLocalIdentitiesRoot())
      : "$HOME/fleet";

    const peerScript = buildPeerCommitScript({
      role: opts.role,
      identityFolderName,
      identityFileBody,
      relayJsonBody,
      fleetRoot,
    });

    await runStep(8, async () => {
      const output = useLocal
        ? await deps.execLocal(peerScript)
        : await deps.execCommand(conn!, peerScript);
      // Peer script emits "birth_committed" on happy path. `set -e` +
      // trailing `exit 0` should make any other final stdout impossible,
      // but assert defensively.
      if (output.trim() !== "birth_committed") {
        throw new Error(
          `peer_commit_unexpected_output: ${output.slice(0, 100)}`,
        );
      }
    });

    // Peer commit landed atomically. From here on no rollback fires even
    // if the supervisor-wait times out — the identity dir is whole on
    // peer disk and the supervisor will bring it alive on its own
    // schedule (Q2 no-rollback lock preserved for post-commit failures).
    birthCommitted = true;

    // Best-effort: pre-create opts.path (frontend-supplied custom workspace
    // directory) AFTER the atomic commit. Failure here does NOT fail the
    // birth — the identity is already committed. Skipped when normalizedPath
    // resolves to $HOME (trivial default) since that always exists on peer.
    if (normalizedPath !== "$HOME") {
      try {
        const mkdirCmd = `mkdir -p ${shellPath(normalizedPath)}`;
        if (useLocal) {
          await deps.execLocal(mkdirCmd);
        } else {
          await deps.execCommand(conn!, mkdirCmd);
        }
      } catch (mkdirErr) {
        databaseLogger.warn(
          "identity birth: custom workspace mkdir failed (best-effort, birth already committed)",
          {
            operation: "identity_birth_custom_workspace_mkdir_failed",
            identityKey: identityFolderName,
            hostId: opts.hostId,
            path: normalizedPath,
            error:
              mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr),
          },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Wait for the supervisor's 15s reconcile tick to bring the identity
    // alive. Unchanged from pre-reshape: poll discoverIdentitySessionFile
    // every WAIT_FOR_SUPERVISOR_POLL_MS until a transcript JSONL appears
    // under the identity's ~/.claude/projects/ dir, up to
    // WAIT_FOR_SUPERVISOR_TIMEOUT_MS. On timeout we STAY on disk (Q2
    // no-rollback lock): the supervisor may still pick up the identity
    // after we've given up polling; deleting on timeout re-introduces the
    // race the no-rollback rule was written to prevent.
    // -----------------------------------------------------------------------
    const supervisorSensorConn: SSHClient | null = useLocal ? null : conn;
    if (useLocal || conn) {
      const waitStartMs = Date.now();
      let discoveredPath: string | null = null;
      let clientAborted = false;
      while (Date.now() - waitStartMs < WAIT_FOR_SUPERVISOR_TIMEOUT_MS) {
        if (opts.abortSignal?.aborted) {
          clientAborted = true;
          break;
        }
        discoveredPath = await deps.discoverIdentitySessionFile(
          supervisorSensorConn,
          identityFolderName,
        );
        if (discoveredPath !== null) break;
        await sleep(WAIT_FOR_SUPERVISOR_POLL_MS);
      }
      if (clientAborted) {
        databaseLogger.warn(
          "identity birth: client aborted during supervisor wait",
          {
            operation: "identity_birth_client_aborted",
            identityKey: identityFolderName,
            hostId: opts.hostId,
            elapsedMs: Date.now() - waitStartMs,
          },
        );
        return;
      }
      if (discoveredPath === null) {
        databaseLogger.warn("identity birth: supervisor wait timed out", {
          operation: "identity_birth_supervisor_wait_timeout",
          identityKey: identityFolderName,
          hostId: opts.hostId,
          timeoutMs: WAIT_FOR_SUPERVISOR_TIMEOUT_MS,
        });
        emit({ type: "ended", ok: false, reason: "supervisor_wait_timeout" });
        return;
      }
    }

    // All steps completed successfully and the supervisor's transcript
    // signal fired (for the remote branch) within the timeout window.
    emit({
      type: "ended",
      ok: true,
      identityId: identityFolderName,
      sessionName: identityFolderName,
    });
  } catch (e) {
    if (e instanceof BirthAborted) {
      // Failure event already emitted by runStep — no re-emit
      return;
    }
    // Unexpected error outside a step — Phase 106 (D-11): propagate the
    // sanitized reason string so log-forensics can distinguish this from
    // step failures and from the supervisor-wait timeout.
    emit({ type: "ended", ok: false, reason: sanitizeError(e) });
  } finally {
    // Rollback path: if we minted a Matrix account but the atomic peer
    // commit never landed, deactivate the mint so a retry with the next
    // ordinal doesn't leak a Synapse account. Best-effort — a failed
    // deactivate is warn-logged (the orphan is recoverable via periodic
    // sweep) but does not raise (we're already in finally on an existing
    // failure path).
    if (mintedForRollback && !birthCommitted) {
      try {
        const deactResult = await deps.matrixDeactivateUser(mxid);
        if (deactResult.ok === false) {
          databaseLogger.warn("identity birth: rollback deactivate failed", {
            operation: "identity_birth_rollback_deactivate_failed",
            mxid,
            status: deactResult.status,
            error: deactResult.error,
          });
        }
      } catch (rollbackErr) {
        databaseLogger.warn("identity birth: rollback deactivate threw", {
          operation: "identity_birth_rollback_deactivate_threw",
          mxid,
          error:
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr),
        });
      }
    }
    // Always release SSH connection if we opened one
    if (conn) {
      try {
        (conn as SSHClient & { end: () => void }).end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
