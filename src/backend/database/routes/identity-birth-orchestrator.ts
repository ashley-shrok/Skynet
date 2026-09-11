/**
 * Phase 20 (IDUI-06/08/09): Identity birth orchestrator — pure logic module.
 *
 * Exports: birthIdentity(opts, emit, deps) — runs the 5-step Nelly-cribbed
 * bootstrap sequence and streams progress via the emit callback.
 *
 * Design: pure function with injected deps (no direct express or HTTP imports),
 * making unit testing clean. The SSE route wraps this with real dep instances.
 *
 * Step sequence (cribbed from ~/vms-apps/apps/home/agent-supervisor.sh §FRESH):
 *   Step 1: On-disk collision probe + avatar candidate check (Phase 68 rewire)
 *   Step 2: mkdir -p + tmux new-session on target host (SSH or local)
 *   Step 3: pre-write hasTrustDialogAccepted + launch claude CLI
 *   Step 4: blind Enter train × 7 at 3s spacing (fire-and-forget, timing-based)
 *   Step 5: send /id <name> then Enter
 *
 * Failure policy: any step failure emits step:N:failed + ended{ok:false,failedStep:N}
 * and STOPS. NO rollback. NO retry. NO cancel. (user-locked, CONTEXT.md §Failure.)
 *
 * tmux note: always -t <name> (plain). NEVER -t "=<name>" — tmux 3.4 exact-match
 * syntax errors on send-keys (Nelly §3).
 */

import { randomBytes } from "node:crypto";
import type { Client as SSHClient } from "ssh2";
import yaml from "js-yaml";
import { startHarnessOnIdentity } from "./identity-harness-start.js";
import {
  MIME_TO_AVATAR_EXT,
  type AvatarExt,
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

/** Sleep after tmux new-session so login shell can source its profile (Nelly §1(b)). */
export const STEP_2_SLEEP_MS = 3000;

/** Sleep after claude launch before starting the Enter train (Nelly §1(f)). */
export const STEP_3_SLEEP_MS = 2000;

/** SSH connect timeout. */
export const SSH_CONNECT_TIMEOUT_MS = 30000;

/**
 * Claude CLI launch env-var prefix (Nelly §1(d) verbatim).
 * Dodges resume-summary and resume-threshold prompts that --dangerously-skip-permissions
 * does NOT cover on the RESUME path. Cheap insurance even for fresh launches.
 */
export const CLAUDE_LAUNCH_CMD_PREFIX =
  "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999";

/** tmux new-session terminal sizing flags (Nelly §3 terminal-sizing gotcha). */
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
 * REVISION 2026-08-04 (Alice, at Task 2 checkpoint): Skynet no longer
 * SSH-invokes the relay-register block. Instead, we seed the identity file
 * with a plain-text HTML comment telling the wake-up agent to register a
 * Matrix relay account itself on first wake, then remove the comment.
 *
 * Style constraints (verbatim from Alice):
 *   - Do NOT say "Skynet" — agents don't know what that is (they see
 *     themselves as a fresh Claude Code agent on some box).
 *   - Do NOT reference id-skill section numbers (§2, §3) or the id-skill
 *     file path — those refs could change.
 *   - Speak in plain terms.
 */
export const IDENTITY_FILE_SEED_COMMENT =
  "<!-- This identity has no relay account yet. On first wake, please register a Matrix relay account for this identity and remove this comment. -->";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Phase 75 Plan 04 — step-number union widened to 1..8 for the three new
// admin-mint + relay.json write steps. Frontend BirthProgress checklist quietly
// ignores unknown step numbers today; the union widening here is backend-only
// (frontend widening is a Phase B concern per 75-RESEARCH.md Assumption A4).
export type BirthEvent =
  | { type: "step"; n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; phase: "started" | "completed" | "failed"; reason?: string }
  | { type: "ended"; ok: boolean; failedStep?: number; identityId?: string; sessionName?: string };

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
  avatarCandidateId: string;
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
   * Phase 80 Plan 80-03b A1 lock: when true, MXID composition follows the
   * DIVERGE shape (`<PoolName>-<Role>[-N]` PascalCase-hyphenated per shape
   * file) — identity folder key stays lowercase (`willow`) while the Matrix
   * account MXID becomes `@Willow-Skynet-Maintainer:server` (with silent
   * auto-suffix `-2`, `-3`, ... on collision). When false/absent, the legacy
   * `@<name>:<serverName>` shape is used (backward compat for pre-Phase-80
   * identities and manually-typed names — Taylor, Tina, Tabitha, etc. keep
   * their existing `@taylor:server` MXIDs). Frontend NewSessionDialog sets
   * true when the name field was pool-picked (plan 80-06).
   */
  poolPicked?: boolean;
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
  /** Fetches avatar candidate bytes from plan 01's cache. Returns null if expired/missing. */
  getCandidateForBirth: (userId: string, id: string) => { bytes: Buffer; mime: string } | null;
  /** Resolves a hostId to host connection details. */
  resolveHostById: (hostId: number, userId: string) => Promise<unknown>;
  /** fs/promises subset for trust-flag write (local-branch only). */
  fsp: {
    readFile: (p: string, enc: "utf8") => Promise<string>;
    writeFile: (p: string, content: string) => Promise<void>;
  };
  /**
   * Phase 22 SRIC-02: SFTP tmp+rename helper for the Step 2.5 identity file
   * pre-write. Wraps identity-artifact-reader.writeMarkdownFileAtomic so the
   * ext_openssh_rename discipline (Pitfall 3 / #2924) is preserved.
   */
  writeMarkdownFileAtomic: (
    conn: SSHClient,
    targetPath: string,
    contents: string,
  ) => Promise<void>;
  /**
   * Phase 66 Plan 66-01 Track 1: SFTP binary tmp+rename helper for the
   * Step 2.5 avatar sibling write. Wraps
   * identity-artifact-reader.writeAvatarSiblingFile — same ext_openssh_rename
   * atomic-overwrite discipline as writeMarkdownFileAtomic, but with a binary
   * Buffer payload and its own log tag (identity_avatar_write). Called AFTER
   * writeMarkdownFileAtomic in Step 2.5's remote branch; called ONCE per
   * successful birth.
   */
  writeAvatarSiblingFile: (
    conn: SSHClient,
    identityKey: string,
    ext: AvatarExt,
    bytes: Buffer,
  ) => Promise<void>;
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
 */
function sanitizeError(err: unknown): string {
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
function buildIdentityFileBody(
  opts: BirthOptions,
  displayName: string,
  avatarFilename: string,
): string {
  const pairs: Array<[string, string | number]> = [];

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

  const yamlBody = yaml.dump(Object.fromEntries(pairs), {
    sortKeys: false,
    lineWidth: -1,
    noRefs: true,
    forceQuotes: false,
  });

  return `---\n${yamlBody}---\n\n${IDENTITY_FILE_SEED_COMMENT}\n\n# ${opts.name}\n`;
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
// Phase 80 Plan 80-03b — A1 lock MXID derivation helpers
// ---------------------------------------------------------------------------
//
// composeMxidLocalpart + deriveMxidWithOrdinal implement the A1 DIVERGE
// decision: identity KEY (folder name, IDENTITY_KEY_RE gate) stays lowercase
// (e.g. `willow`) while the Matrix account MXID localpart becomes PascalCase-
// hyphenated `<PoolName>-<Role>[-N]` (e.g. `Willow-Skynet-Maintainer`,
// `Willow-Skynet-Maintainer-2`, ...). Both helpers are pure (side-effect-free
// modulo deriveMxidWithOrdinal's injected countFn) so they're testable in
// isolation without matrix mocking.
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
 *   composeMxidLocalpart("willow", "skynet-maintainer") → "Willow-Skynet-Maintainer"
 *   composeMxidLocalpart("aster", "coordinator")        → "Aster-Coordinator"
 *   composeMxidLocalpart("willow", "foo-bar-baz")       → "Willow-Foo-Bar-Baz"
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
  const pascalName = normalizedName[0].toUpperCase() + normalizedName.slice(1);
  const pascalRole = role
    .split("-")
    .map((seg) => seg[0].toUpperCase() + seg.slice(1))
    .join("-");
  return `${pascalName}-${pascalRole}`;
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
     * primitive so it can pick LOCAL (isLocalHostId → bind-mount fast-path)
     * vs REMOTE (SFTP tmp+rename) — matches the WriteIdentityFileOpts
     * contract at claude-session/per-identity-file.ts.
     */
    hostId: number;
    /**
     * Phase 80 Plan 80-03b A1 lock: kebab-case-lowercase role name (matches
     * BirthOptions.role). Only consumed when poolPicked === true — used by
     * composeMxidLocalpart to build the PascalCase-hyphenated MXID base handle.
     * Optional so the retry route (which does not know the role from its
     * request body) can invoke this helper without triggering derivation —
     * retry always takes the legacy MXID branch (poolPicked undefined).
     */
    role?: string;
    /**
     * Phase 80 Plan 80-03b A1 lock: when true, Step 6 derives the MXID from
     * composeMxidLocalpart(name, role) + deriveMxidWithOrdinal instead of
     * using the legacy `@<name>:<server>` shape. Retry route leaves this
     * undefined so retry always uses the legacy shape (retry operates on the
     * already-on-disk identity folder, so the folder name IS the correct
     * MXID localpart source for the retry semantics).
     */
    poolPicked?: boolean;
  },
  emit: (e: BirthEvent) => void,
  deps: BirthDeps,
  conn: SSHClient,
): Promise<void> {
  // Local runStep — same shape as birthIdentity's inner runStep so events emit
  // with identical framing whether we're inside birthIdentity or the retry
  // route. Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode +
  // agent-supervisor race. NO folder-cleanup in this catch, ever.
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
      const reason = sanitizeError(e);
      emit({ type: "step", n, phase: "failed", reason });
      emit({ type: "ended", ok: false, failedStep: n });
      throw new BirthAborted(n);
    }
  }

  // Server-name suffix for the mxid — extracted from the homeserver URL so
  // the deps only need to carry one homeserver value. NEVER a hardcoded
  // fallback per D-OQ7 (island-model per 75-CONTEXT.md § Philosophy).
  const serverName = extractServerName(deps.matrixHomeserver);
  // Phase 80 Plan 80-03b: mxid is now a `let` — Step 6 assigns based on the
  // poolPicked branch (derived MXID for the pool-picked path, legacy shape
  // otherwise). Steps 7 and 8 read the final value.
  let mxid: string;

  // Closure-scoped state passed between the three steps.
  let agentPassword = "";
  let mintedAccessToken = "";

  // -------------------------------------------------------------------------
  // Step 6: admin-mint (createOrUpdateUser) + inline login-as-user
  //
  // Phase 80 Plan 80-03b A1 lock: MXID derivation lives INSIDE Step 6's runStep
  // (BEFORE matrixCreateOrUpdateUser) so derivation failures attribute to
  // step 6 as an SSE step-failed event — Q2 no-rollback discipline preserved,
  // no new numbered SSE step introduced.
  //
  // D-OQ6 lock: matrixLoginAsUser is called immediately after
  // matrixCreateOrUpdateUser inside the same runStep so the relay.json body
  // built in Step 7 carries a real (non-empty) access_token — recv.sh does
  // not have to relogin on first read. A login failure attributes to Step 6
  // (still an admin-mint concern from the caller's POV).
  // -------------------------------------------------------------------------
  await runStep(6, async () => {
    // Phase 80 Plan 80-03b A1 lock — derive MXID when poolPicked === true.
    // Legacy branch (poolPicked absent/false OR retry-route caller) uses the
    // existing `@<name>:<server>` shape unchanged. See CONTEXT.md `<domain>`
    // for the DIVERGE rationale.
    if (opts.poolPicked === true && typeof opts.role === "string") {
      let baseHandle: string | null = null;
      try {
        baseHandle = composeMxidLocalpart(opts.name, opts.role);
      } catch (e) {
        // Silent fallback for `mxid_name_not_pool_shape` ONLY — matches shape
        // file's "user can edit the name to anything" invariant. Other errors
        // (e.g. `mxid_role_malformed`) rethrow to fail Step 6 loudly since
        // role names are gate-validated upstream (ROLE_NAME_PATTERN in the
        // route handler + Step 2.5 re-check) so a malformed role at Step 6
        // is a genuine bug.
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
        mxid = `@${opts.name}:${serverName}`;
      }
    } else {
      // Legacy branch — unchanged behavior for pre-Phase-80 identities, the
      // retry route (opts.poolPicked undefined), and any manually-created
      // identity whose name was not pool-picked by the frontend.
      mxid = `@${opts.name}:${serverName}`;
    }

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
      homeserverBase: deps.matrixHomeserver,
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
    await writeIdentityFile(opts.name, "relay.json", relayJsonBody, {
      hostId: opts.hostId,
      conn,
      chmod: 0o600,
    });
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run the 5-step birth sequence and emit progress events.
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
  // 0b. Normalize path
  //   - Replace backslashes with forward slashes
  //   - Empty / bare "~" / "~/" → "$HOME"  (unquoted so remote shell expands)
  //   - "~/foo/bar"             → "$HOME/foo/bar"  (unquoted prefix)
  //
  // Patch #318: previous code only handled the bare-"~" case, so a normal
  // input like "~/pdf-inspector" fell through to shellSingleQuote() and hit
  // the remote shell as literal '~/pdf-inspector' — inside single quotes the
  // tilde does NOT expand. shellPath() only leaves the string unquoted when
  // it starts with "$HOME", so we have to do the ~-to-$HOME rewrite here.
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
      const reason = failReasonOverride ?? sanitizeError(e);
      emit({ type: "step", n, phase: "failed", reason });
      emit({ type: "ended", ok: false, failedStep: n });
      throw new BirthAborted(n);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 68 Plan 03: identityId is now opts.name (the identityKey).
  // There is no DB-generated nanoid — the identity IS its folder name on disk.
  // -------------------------------------------------------------------------
  const identityId = opts.name;

  // -------------------------------------------------------------------------
  // Branch selection: SSH vs local
  // -------------------------------------------------------------------------
  const useLocal = deps.isLocalHostId(opts.hostId);

  // For SSH branch: resolve the host and connect.
  // Wrap ALL step 1-5 ops in try/finally that calls conn.end().
  let conn: SSHClient | null = null;

  // -------------------------------------------------------------------------
  // Exec abstraction — same interface for remote and local branches
  // -------------------------------------------------------------------------
  async function exec(command: string): Promise<string> {
    if (useLocal) {
      return deps.execLocal(command);
    } else {
      return deps.execCommand(conn!, command);
    }
  }

  // Phase 66 Plan 66-01: hoisted so Step 2.5 can reuse the candidate mime+bytes
  // without calling getCandidateForBirth() a second time (would race with
  // consumeCandidateForBirth's cleanup path). Assigned before Step 1 after
  // the non-null guard; Step 2.5 asserts non-null with `!` because a null
  // candidate at Step 1 already threw and aborted the flow.
  let birthCandidate: { bytes: Buffer; mime: string } | null = null;

  // -------------------------------------------------------------------------
  // Steps 1-5: SSH or local (wrapped in single try/finally for conn cleanup)
  // -------------------------------------------------------------------------
  try {
    // For remote branch, connect now (before Step 1 so the collision probe
    // can use SSH exec). SHAPE B: Step 1 is the on-disk collision probe.
    if (!useLocal) {
      const host = await deps.resolveHostById(opts.hostId, opts.userId);
      try {
        conn = await deps.connectOneShot(host, SSH_CONNECT_TIMEOUT_MS);
      } catch (e) {
        // Step 1 failure: SSH connect error before collision probe
        emit({ type: "step", n: 1, phase: "started" });
        const reason = /timeout|unreachable/i.test((e as Error).message ?? "")
          ? "Host unreachable"
          : "Host unreachable";
        emit({ type: "step", n: 1, phase: "failed", reason });
        emit({ type: "ended", ok: false, failedStep: 1 });
        return;
      }
    }

    // -----------------------------------------------------------------------
    // Step 1: On-disk collision probe + avatar candidate check
    //         (Phase 68 rewire — no DB INSERT or GET-verify)
    //
    //   For remote: SSH exec `if [ -d ~/fleet/identities/<name> ]`
    //   For local: relies on Step 2's mkdir being idempotent (local branch
    //              self-birth doesn't probe — same pre-Phase-68 behavior).
    //
    // Avatar candidate check is also in Step 1 so a cache miss aborts before
    // any state mutation (mirrors the pre-Phase-68 early-abort discipline).
    // -----------------------------------------------------------------------
    await runStep(1, async () => {
      // Phase 86 Plan 86-04 (D-CTX-86-inherit): the avatar candidate lookup
      // is now gated on opts.avatarCandidateId being non-empty. Identities
      // born without an explicit candidate inherit the role's avatar via
      // Plan 86-01's GET /:key/avatar role-folder fallback — the identity's
      // frontmatter omits `avatar:` (see buildIdentityFileBody's
      // absent-⇒-omit branch) and Step 2.5 skips writeAvatarSiblingFile.
      // Empty-string sentinel matches identity-birth.ts's parsedAvatarCandidateId
      // fallback (Phase 86 Plan 86-04 route handler).
      if (opts.avatarCandidateId.length > 0) {
        // Look up avatar bytes from plan 01's candidate cache
        const cand = deps.getCandidateForBirth(opts.userId, opts.avatarCandidateId);
        if (!cand) {
          throw new Error("avatar candidate expired or not found");
        }
        birthCandidate = cand;
      }
      // else: birthCandidate stays null; Step 2.5 will skip the sibling
      // file write; buildIdentityFileBody will skip the `avatar:` key.

      // On-disk collision probe for remote branch (SHAPE B).
      // opts.name is already gated by IDENTITY_KEY_RE + TMUX_SAFE_NAME_RE so
      // it's safe to interpolate into the double-quoted path (matches the
      // same "validate-then-interpolate" pattern as identity-clone.ts:119).
      if (!useLocal && conn) {
        const probeOut = await deps.execCommand(
          conn,
          `if [ -d "$HOME/fleet/identities/${opts.name}" ]; then echo exists; else echo missing; fi`,
        );
        if (probeOut.trim() === "exists") {
          throw new Error("identity already exists on this host");
        }
      }
    });

    // Single-quote the session name for shell safety
    const escName = shellSingleQuote(opts.name);
    const escPath = shellPath(normalizedPath);

    // -----------------------------------------------------------------------
    // Step 2: mkdir -p + tmux new-session (Nelly §1(a) + terminal sizing)
    //
    // Phase 22 SRIC-02 addendum (B4b(a), REVISION 2026-08-04):
    //   Step 2 now ALSO pre-writes ~/fleet/identities/<name>/<name>.md with
    //   role: frontmatter + a wake-up seed comment, creates the wakeups/ dir,
    //   and touches handoff.md — BEFORE Step 5's `/id <name>` fires. This
    //   causes the id skill on the box to take its load-existing branch
    //   instead of the interactive create branch (so no human prompt is
    //   needed on the box side for role selection). Piggybacked on Step 2's
    //   number so the frontend BirthProgress checklist stays untouched.
    //
    //   Skynet does NOT invoke the relay-register block — that's the fresh
    //   agent's own responsibility at first wake (per the seed comment).
    //
    //   Local branch (isLocalHostId=true) is currently NOT covered — this
    //   phase's UAT scope is remote fleet hosts only. Local-branch self-birth
    //   remains a pre-Phase-22 workflow and skips the pre-write silently.
    // -----------------------------------------------------------------------
    await runStep(2, async () => {
      await exec(
        `mkdir -p ${escPath} && tmux new-session -d -s ${escName} -c ${escPath} ${TMUX_NEW_SESSION_FLAGS}`,
      );
      // Sleep 3s: login shell needs to source its profile (Nelly §1(b))
      await sleep(STEP_2_SLEEP_MS);

      // Phase 22 SRIC-02 Step 2.5: identity file pre-write (remote branch only).
      // Phase 66 Plan 66-01 grew this to also emit full-cosmetics frontmatter
      // (displayName/title/colorHue/voice/avatar) + write the avatar sibling
      // file, so Skynet-born identities are byte-shape-indistinguishable from
      // Nelly-migrated (Phase A) ones on disk.
      if (!useLocal && conn) {
        // Defense in depth: HTTP handler validates opts.role, but re-check
        // here because role is shell-interpolated below (T-22-02-01).
        if (!opts.role || !ROLE_NAME_PATTERN.test(opts.role)) {
          throw new Error(
            `role must match ${ROLE_NAME_PATTERN}; got: ${JSON.stringify(opts.role)}`,
          );
        }

        // Resolve $HOME on the target host — one SSH round-trip.
        const remoteHome = (await deps.execCommand(conn, "echo $HOME")).trim();
        if (!remoteHome || remoteHome.includes("\n")) {
          throw new Error("could not resolve remote $HOME");
        }

        // Build the identity folder path. opts.name is already gated by
        // IDENTITY_KEY_RE + TMUX_SAFE_NAME_RE above, so it's shell-safe.
        const identityDir = `${remoteHome}/fleet/identities/${opts.name}`;
        const identityFilePath = `${identityDir}/${opts.name}.md`;

        // 1. Create the identity folder tree — wakeups/ + workspace/ (generic working dir per D-04)
        //    plus touch handoff.md to satisfy id skill's load-existing branch.
        //    Single mkdir -p covers both sub-parts and the parent identityDir.
        await deps.execCommand(
          conn,
          `mkdir -p "${identityDir}/wakeups" "${identityDir}/workspace" && touch "${identityDir}/handoff.md"`,
        );

        // 2. Derive avatar ext from the candidate mime. Defense-in-depth: the
        //    birth upload path is capped to png/jpeg/webp so an unmapped mime
        //    should never surface here, but throw loud instead of silent-no-op
        //    if the map ever narrows and a caller widens (T-66-01-01).
        //
        //    Phase 86 Plan 86-04 (D-CTX-86-inherit): when opts.avatarCandidateId
        //    was absent from the birth request, Step 1's candidate lookup was
        //    skipped and birthCandidate is still null — the identity inherits
        //    the role's avatar via Plan 86-01's GET /:key/avatar role-folder
        //    fallback. buildIdentityFileBody receives "" for avatarFilename
        //    (absent-⇒-omit invariant), the .md is written, and
        //    writeAvatarSiblingFile is skipped entirely.
        let avatarExt: AvatarExt | null = null;
        let avatarFilename = "";
        if (birthCandidate !== null) {
          const derivedExt = MIME_TO_AVATAR_EXT[birthCandidate.mime];
          if (!derivedExt) {
            throw new Error(
              "unsupported avatar mime for on-disk write: " + birthCandidate.mime,
            );
          }
          avatarExt = derivedExt;
          avatarFilename = `${opts.name}.${avatarExt}`;
        }

        // 3. Compose the identity file body via the Phase 66 builder —
        //    full cosmetics frontmatter with role-first ordering and the
        //    absent-⇒-omit invariant for null / empty-string fields.
        //    displayName mirrors identity-birth.ts createIdentityRecord's
        //    capitalize(opts.name) rule (Patch #320 correct mapping).
        const displayName =
          opts.name.length > 0
            ? opts.name[0].toUpperCase() + opts.name.slice(1)
            : opts.name;
        const identityFileBody = buildIdentityFileBody(
          opts,
          displayName,
          avatarFilename,
        );

        // 4. Write markdown via SFTP tmp+rename (ext_openssh_rename per
        //    Pitfall 3 / #2924).
        await deps.writeMarkdownFileAtomic(conn, identityFilePath, identityFileBody);

        // 5. Write avatar sibling file via SFTP tmp+rename (same
        //    ext_openssh_rename discipline, binary payload — Phase 66
        //    Plan 66-01 Track 1). Runs AFTER writeMarkdownFileAtomic:
        //    graceful partial recovery — if the avatar write fails, the
        //    .md + wakeups/ + handoff.md are still on disk (re-birth is
        //    the recovery path, not a rollback we build). Test 24b pins
        //    this ordering.
        //
        //    Phase 86 Plan 86-04 (D-CTX-86-inherit): skip the sibling write
        //    when no candidate bytes exist (role-inherited-avatar path).
        //    The role's avatar file at ~/fleet/roles/<role>/<file> is
        //    served via Plan 86-01's GET /:key/avatar role-folder fallback.
        //    avatarExt was assigned above inside the same `birthCandidate
        //    !== null` guard, so the non-null assertion is safe here.
        if (birthCandidate !== null) {
          await deps.writeAvatarSiblingFile(conn, opts.name, avatarExt!, birthCandidate.bytes);
        }
      }
    });

    // -----------------------------------------------------------------------
    // Phase 75 Plan 04 — Steps 6, 7, 8 (remote branch only, D-OQ3 lock):
    // admin-mint relay account + write relay.json to target host with a real
    // access_token. Local-branch self-birth SKIPS these entirely (mirrors the
    // Step 2.5 pre-write skip at L523 above — Phase A UAT is remote fleet
    // hosts only).
    //
    // The helper handles all three steps' event emission and error handling.
    // Its runStep wrapper throws BirthAborted on failure which propagates
    // through the outer try/catch below (L634-644) exactly like Steps 1-3.
    //
    // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode +
    // agent-supervisor race. The helper does NOT delete the identity folder
    // on any Step 6/7/8 failure; this call site MUST NOT either.
    // -----------------------------------------------------------------------
    if (!useLocal && conn) {
      const displayName =
        opts.name.length > 0
          ? opts.name[0].toUpperCase() + opts.name.slice(1)
          : opts.name;
      // Phase 80 Plan 80-03b A1 lock: thread role + poolPicked into the helper
      // so its Step 6 can derive the PascalCase-hyphenated MXID when the
      // frontend pool-picked the name. Absent poolPicked → helper takes the
      // legacy `@<name>:<server>` branch (backward compat preserved).
      await runRelayMintAndWrite(
        {
          name: opts.name,
          displayName,
          hostId: opts.hostId,
          role: opts.role,
          poolPicked: opts.poolPicked,
        },
        emit,
        deps,
        conn,
      );
    }

    // -----------------------------------------------------------------------
    // Steps 3-5: post-tmux Claude-harness bootstrap.
    //
    // quick-260806-dwe: The verbatim body of steps 3-5 was extracted into
    // identity-harness-start.ts so clone can reuse the exact same sequence
    // (trust-flag pre-write → claude launch → 2s sleep → 7-Enter train →
    // /id <name> + Enter). Birth delegates the whole sequence to the helper.
    //
    // SSE contract preservation: the frontend's BirthProgress checklist
    // ticks 5 items (steps 1..5), so after the helper completes we still
    // emit synthetic started+completed events for steps 4 and 5. The actual
    // work all happens inside runStep(3); a helper rejection surfaces as
    // step:3:failed (Test 14 expects that attribution for the claude-launch
    // failure case, which is inside the helper). Failure attribution for a
    // rejection during the Enter train or /id would also surface as step 3,
    // which is acceptable — the frontend's failure UX just shows "step
    // failed at N" and offers no per-step recovery.
    // -----------------------------------------------------------------------
    await runStep(3, async () => {
      await startHarnessOnIdentity({
        exec,
        name: opts.name,
        remotePath: escPath,
      });
    });
    // Preserve the SSE 5-event contract for the frontend checklist. These are
    // informational only — the actual work happened inside runStep(3).
    emit({ type: "step", n: 4, phase: "started" });
    emit({ type: "step", n: 4, phase: "completed" });
    emit({ type: "step", n: 5, phase: "started" });
    emit({ type: "step", n: 5, phase: "completed" });

    // All 5 steps completed successfully
    emit({ type: "ended", ok: true, identityId, sessionName: opts.name });
  } catch (e) {
    if (e instanceof BirthAborted) {
      // Failure event already emitted by runStep — no re-emit
      return;
    }
    // Unexpected error outside a step
    emit({ type: "ended", ok: false });
  } finally {
    // Always clean up SSH connection if we opened one
    if (conn) {
      try {
        (conn as SSHClient & { end: () => void }).end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
