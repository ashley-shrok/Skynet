/**
 * Phase 20 (IDUI-06/08/09): POST /identities/birth — SSE birth orchestrator route.
 *
 * Thin SSE glue around the pure birthIdentity() orchestrator. Responsibilities:
 *   - JWT auth + body validation (400 on missing/invalid fields)
 *   - SSE header flushing (Content-Type: text/event-stream, no-cache, etc.)
 *   - Assembling the real deps object and invoking birthIdentity()
 *   - Framing each BirthEvent as `event: birth\ndata: {...}\n\n`
 *   - Closing the connection after the orchestrator finishes
 *
 * Mount point: app.use("/identities/birth", identityBirthRoutes)
 * Must be mounted BEFORE the general /identities mount (more-specific path wins).
 */

import express from "express";
import type { Request, Response } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fsp from "node:fs/promises";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger, sshLogger } from "../../utils/logger.js";
// Phase 129 Plan 07 Task 2: host-user-counter primitives from Plan 01.
// Used pre-orchestrator to gate the D-4 auto-tag branch: on multi-user hosts
// we resolve the caller's Skynet username and thread it as
// BirthOptions.creatorUsername so buildIdentityFileBody emits the users:
// pair. On single-user hosts both lookups are skipped and creatorUsername
// stays undefined — the identity file carries no users: key (absent-⇒-omit
// fallback per D-3; shape §"invisible in majority case").
//
// Write-side fail-open EXCEPTION per PATTERNS.md § "Read-path fail-open,
// write-path fail-closed": if getUsernameForUserId returns null on a
// multi-user host, we SKIP the auto-tag (creatorUsername stays undefined)
// and log a warn — a wrong-user auto-tag is a shape file §"would make it
// wrong" bullet-3 violation, so the safe choice is to write the file
// WITHOUT the users: key rather than tag with an empty string or fail the
// birth entirely. See PATTERNS.md § shared patterns for the full rationale.
import {
  isHostMultiUser,
  getUsernameForUserId,
} from "../../utils/host-user-counter.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
// Phase 106 (D-05/D-06): the wait-for-supervisor sensor wired into the
// birthIdentity orchestrator's `BirthDeps.discoverIdentitySessionFile`.
// Same helper fleet-status and sessions.ts already trust for "this is a
// live agent session, not a bare shell." Do NOT wire a parallel sensor.
import { discoverIdentitySessionFile } from "../../claude-session/discover-identity-session-file.js";
import {
  isLocalHostId,
  getLocalIdentitiesRoot,
  writeMarkdownFileAtomic,
  writeAvatarSiblingFile,
} from "../../claude-session/identity-artifact-reader.js";
import pathModule from "node:path";
import { resolveHostById } from "../../ssh/host-resolver.js";
// Phase 98 Plan 07: whitelist voice-value validation on identity birth. Same
// contract as identities.ts's PUT handler — any voice value that isn't a
// recognized voice ID of some TTS provider is 400-rejected. Null/absent are legal
// (identity is born voiceless; owner picks in the identity modal later).
import { isRecognizedVoiceId } from "../../voice/tts-provider.js";
import {
  birthIdentity,
  ROLE_NAME_PATTERN,
  ROLE_NAME_RE,
  sanitizeError,
  type BirthEvent,
  type BirthDeps,
} from "./identity-birth-orchestrator.js";
import {
  acquireBirthSlot,
  ThrottleRejectedError,
} from "../../identity-birth/global-throttle.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";
// Phase 75 Plan 04 — Matrix admin client (Plan 02) + creds store (Plan 01).
// Phase 80 Plan 80-03b — countUsersMatching (Plan 02) for Step 6 MXID ordinal
// derivation when opts.poolPicked === true.
import {
  createOrUpdateUser as matrixCreateOrUpdateUser,
  loginAsUser as matrixLoginAsUser,
  buildRelayJsonBody,
  countUsersMatching as matrixCountUsersMatching,
  deactivateUser as matrixDeactivateUser,
} from "../../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../../matrix/matrix-admin-creds-store.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const execAsync = promisify(exec);

// Phase 75 Plan 04 — matches identity-birth-orchestrator.ts IDENTITY_KEY_RE.
// Duplicated locally so we can validate the identity name at the route layer
// before touching any DB / SSH / Synapse dep (T-75-16 defense-in-depth).
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;

// Multi-role: cap on the optional `roles` body field (additional roles beyond
// `role`). Generous — the UI never gets near it — but bounds the peer
// script's role-folder guard loop.
const MAX_EXTRA_ROLES = 16;

// Pretty-names shape (2026-09-30): when the request body carries a free-form
// `displayName`, the backend derives the slug from it via the shared helper
// — the user never has to think about kebab-case or Matrix-safe characters.
// When `displayName` is absent (the pool-picked path, which supplies a
// pre-slugged `name`), this branch is skipped.
//
// Scope cut (known gap): slug-collision auto-suffix is NOT implemented for
// identity birth in this phase. Identity birth is a long multi-step
// orchestration (local filesystem + Matrix account + tmux session) and
// retrying it on collision would mean leaking Matrix accounts across
// attempts. The frontend's runCollisionPrecheck already surfaces collisions
// at type-time (NewSessionDialog), so a user who types a colliding name
// sees it before clicking Create. True race-collisions still fail with the
// orchestrator's "identity already exists on this host" error.
import { derivePrettyNameSlug } from "../../utils/pretty-name-slug.js";

// ---------------------------------------------------------------------------
// Local exec helper (child_process.exec promisified)
// ---------------------------------------------------------------------------

async function execLocal(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Pretty-names shape (2026-10-01): identity-folder collision probe used by
// the name-it-myself path to pick a non-colliding slug BEFORE the orchestrator
// runs. Mirrors identity-exists-on-host.ts's probe shape — local branch via
// fs.stat against getLocalIdentitiesRoot(), remote branch via a one-shot SSH
// exec `[ -d ... ]`.
//
// Scope: this closes the common-case auto-suffix gap. The vanishingly rare
// race case (two concurrent births picking the same base slug and both
// passing the probe before either reaches the orchestrator) still falls
// through to the orchestrator's existing step-8 EEXIST path, which fires
// the rollback-and-deactivate flow in the finally block — no leaked Matrix
// accounts, user sees "identity already exists" and retries.
// ---------------------------------------------------------------------------

const PROBE_SSH_EXEC_TIMEOUT_MS = 3000;

// Defensive regex gate (code-review Finding #2): a future caller that
// forwards an unvetted `name` into the SSH probe below would be a shell-
// injection footgun. Keep interpolation safety independent of caller
// discipline — matches IDENTITY_KEY_RE above.
const PROBE_NAME_SAFE_RE = /^[a-z0-9._=/+-]+$/;

async function identityFolderExistsOnHost(
  host: unknown,
  hostId: number,
  name: string,
): Promise<boolean> {
  if (!PROBE_NAME_SAFE_RE.test(name)) {
    throw new Error(
      `probe name unsafe for shell interpolation: ${JSON.stringify(name)}`,
    );
  }
  if (isLocalHostId(hostId)) {
    const candidate = pathModule.join(getLocalIdentitiesRoot(), name);
    try {
      await fsp.stat(candidate);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }
  let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
  try {
    conn = await connectOneShot(
      host as Parameters<typeof connectOneShot>[0],
      PROBE_SSH_EXEC_TIMEOUT_MS,
    );
    const output = await Promise.race([
      execCommand(
        conn,
        `if [ -d "$HOME/fleet/identities/${name}" ]; then echo exists; else echo missing; fi`,
      ),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("probe_ssh_exec_timeout")),
          PROBE_SSH_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
    return output.trim() === "exists";
  } finally {
    if (conn) {
      try {
        conn.end();
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Typed error for suffix cap exhaustion. Code-review Finding #3: on cap
 *  hit, surface a 400 with a user-facing message instead of silently teeing
 *  up a doomed birth against the colliding base slug. */
export class SlugCapExhaustedError extends Error {
  constructor(public readonly baseSlug: string, public readonly attempts: number) {
    super(
      `slug cap exhausted for baseSlug=${baseSlug} after ${attempts} attempts`,
    );
    this.name = "SlugCapExhaustedError";
  }
}

/**
 * Resolve a free (collision-free) identity slug by probing the target host
 * and bumping the suffix until a free slot is found. Returns the resolved
 * slug.
 *
 * Throws SlugCapExhaustedError when the suffix sanity cap is hit — the
 * caller must map that to a user-visible 400 ("pick a more distinctive
 * name"). Probe-level failures (SSH timeout, fs error) are caught and
 * fall open to the base slug, since the orchestrator's step-8 EEXIST +
 * rollback path still protects correctness.
 */
async function resolveFreeIdentitySlug(
  host: unknown,
  hostId: number,
  baseSlug: string,
): Promise<string> {
  const MAX_SUFFIX_ATTEMPTS = 100;
  let candidate = baseSlug;
  let attempt = 0;
  try {
    while (await identityFolderExistsOnHost(host, hostId, candidate)) {
      attempt += 1;
      if (attempt >= MAX_SUFFIX_ATTEMPTS) {
        databaseLogger.warn(
          "identity-birth: suffix cap exhausted during pre-check",
          {
            operation: "identity_birth_suffix_cap",
            hostId,
            baseSlug,
            attempts: attempt,
          },
        );
        throw new SlugCapExhaustedError(baseSlug, attempt);
      }
      candidate = `${baseSlug}-${attempt + 1}`;
    }
  } catch (err) {
    if (err instanceof SlugCapExhaustedError) throw err;
    // Fall-open: probe failure doesn't block birth. The orchestrator's
    // step-8 EEXIST + rollback path will handle a true collision; a probe
    // failure here just means we try the un-suffixed slug.
    databaseLogger.warn("identity-birth: pre-check probe failed", {
      operation: "identity_birth_precheck_probe_failed",
      hostId,
      baseSlug,
      error: err instanceof Error ? err.message : String(err),
    });
    return baseSlug;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

router.post(
  "/",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // Body validation — 400 before opening SSE if any required field is missing
    // -----------------------------------------------------------------------
    const bodyAny = req.body as Record<string, unknown>;
    const {
      hostId,
      title,
      path,
      colorHue,
      voice,
      avatarCandidateId,
      role,
      roles,
      task,
      poolPicked,
      project,
    } = bodyAny;

    if (
      typeof hostId !== "number" ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // Pretty-names shape (2026-09-30): if the caller provides a free-form
    // `displayName`, derive the identity's slug from it via the shared
    // helper. The pool-picked path still sends a pre-slugged `name` and
    // is unchanged. One of the two must be present.
    const rawDisplayName = bodyAny.displayName;
    let name: string;
    if (typeof rawDisplayName === "string" && rawDisplayName.trim().length > 0) {
      const derivation = derivePrettyNameSlug(rawDisplayName);
      if (derivation.ok !== true) {
        const errorMsg =
          derivation.reason === "empty"
            ? "displayName is required"
            : derivation.reason === "too_long"
              ? "displayName must be 80 characters or fewer"
              : "displayName must contain at least one letter";
        res.status(400).json({ error: errorMsg });
        return;
      }
      name = derivation.slug;
    } else {
      const rawName = bodyAny.name;
      if (typeof rawName !== "string" || !rawName.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      name = rawName;
    }

    // Phase 88 code-review M1 (defense-in-depth): gate `name` against
    // IDENTITY_KEY_RE at the route layer for parity with the `role` gate at
    // L146. The orchestrator revalidates `opts.name` before any shell/SFTP
    // work (identity-birth-orchestrator.ts:862/871), so this is not the
    // primary defense today — but Plan 88-01's parsedPath fallback at
    // L228-232 substitutes `name.trim().toLowerCase()` into the working-
    // directory path, and a future refactor that ever reorders those checks
    // would turn a bad name into path traversal via `parsedPath` before the
    // orchestrator's gate fires. Closing the asymmetry here removes the
    // footgun for zero behavior change today.
    //
    // Pretty-names derived slugs (pure [a-z-]+) pass this regex by
    // construction, so backend-derivation above does not change gate
    // semantics.
    if (!IDENTITY_KEY_RE.test(name.trim())) {
      res
        .status(400)
        .json({ error: "name must match [a-z0-9._=/+-]+ (kebab-case)" });
      return;
    }

    // Phase 86 Plan 86-04: title-required gate deleted. Identities born without
    // a title inherit their role's title on landing (D-CTX-86-inherit) — the
    // orchestrator's absent-⇒-omit invariant at buildIdentityFileBody L392-395
    // already skips emitting a title: key when opts.title is empty/absent, and
    // the backend merge in publicIdentity (Plan 86-01) resolves the display
    // title from the role's frontmatter under `identity ?? role ?? null`.
    if (title !== undefined && title !== null && typeof title !== "string") {
      res.status(400).json({ error: "title must be a string or null" });
      return;
    }

    // Phase 86 Plan 86-04: avatarCandidateId-required gate deleted. Identities
    // born without an avatar inherit their role's avatar (served via
    // /identities/:key/avatar role-folder fallback landed in Plan 86-01).
    // Downstream: when opts.avatarCandidateId is empty, the orchestrator's
    // Step 1 candidate lookup + Step 2.5 sibling-file write are skipped
    // entirely (see identity-birth-orchestrator.ts's absent-avatar branch).
    if (
      avatarCandidateId !== undefined &&
      avatarCandidateId !== null &&
      typeof avatarCandidateId !== "string"
    ) {
      res
        .status(400)
        .json({ error: "avatarCandidateId must be a string or null" });
      return;
    }

    // Phase 22 SRIC-02: role is REQUIRED and must be kebab-case-lowercase.
    // Defense in depth — the orchestrator re-validates before shell interpolation.
    if (typeof role !== "string" || !ROLE_NAME_PATTERN.test(role.trim())) {
      res.status(400).json({
        error: "role is required and must be kebab-case-lowercase",
      });
      return;
    }

    // Multi-role: optional `roles` array of ADDITIONAL roles beyond the
    // first `role`. Same kebab-case gate as `role`; duplicates (and a
    // repeat of `role`) collapse silently.
    let extraRoles: string[] = [];
    if (roles !== undefined && roles !== null) {
      if (
        !Array.isArray(roles) ||
        roles.length > MAX_EXTRA_ROLES ||
        !roles.every(
          (r) => typeof r === "string" && ROLE_NAME_PATTERN.test(r.trim()),
        )
      ) {
        res.status(400).json({
          error: `roles must be an array of at most ${MAX_EXTRA_ROLES} kebab-case-lowercase role names`,
        });
        return;
      }
      const first = role.trim();
      extraRoles = Array.from(
        new Set((roles as string[]).map((r) => r.trim())),
      ).filter((r) => r !== first);
    }

    // colorHue and voice are optional (nullable)
    if (colorHue !== null && colorHue !== undefined && typeof colorHue !== "number") {
      res.status(400).json({ error: "colorHue must be a number or null" });
      return;
    }

    if (voice !== null && voice !== undefined && typeof voice !== "string") {
      res.status(400).json({ error: "voice must be a string or null" });
      return;
    }
    // Phase 98 Plan 07: voice validation. A present-and-string voice value
    // must be a recognized voice ID of some TTS provider
    // (isRecognizedVoiceId). Null / absent voice remains legal
    // — a newborn identity without a voice frontmatter key inherits its
    // role's voice at read time (Plan 86-01 merge in publicIdentity).
    if (voice !== null && voice !== undefined && !isRecognizedVoiceId(voice)) {
      res
        .status(400)
        .json({ error: "voice must be a supported voice ID" });
      return;
    }

    // Phase 80 Plan 80-03: task is optional (nullable). Validate BEFORE
    // flushHeaders so a 400 lands as JSON, not as an SSE frame after the
    // stream opens (RESEARCH §7 landmine parity with existing shape).
    // Hard-cap at 500 chars (T-80-03-02 DoS mitigation) — frontend soft-caps
    // ~200 chars; server hard-caps 500 as defense-in-depth.
    if (task !== null && task !== undefined && typeof task !== "string") {
      res.status(400).json({ error: "task must be a string or null" });
      return;
    }
    if (typeof task === "string" && task.length > 500) {
      res.status(400).json({ error: "task must be ≤500 chars" });
      return;
    }

    // Phase 80 Plan 80-03b: poolPicked is optional (nullable). When true, Step 6
    // derives MXID via composeMxidLocalpart + deriveMxidWithOrdinal from the
    // pool-picked name + role. When false/absent, legacy `@<name>:<server>`
    // shape is used (backward compat for pre-Phase-80 identities and
    // manually-typed names). Validated as boolean-or-undefined; 400 on any
    // other type so client bugs surface loudly rather than silently taking
    // the legacy branch.
    if (poolPicked !== undefined && typeof poolPicked !== "boolean") {
      res.status(400).json({ error: "poolPicked must be a boolean" });
      return;
    }

    // Phase 80 review fix (H3): when poolPicked === true, role MUST match the
    // stricter ROLE_NAME_RE (no leading digit per segment, no empty segments)
    // because composeMxidLocalpart's derivation uses the same regex and will
    // rethrow mid-birth (Step 6 failure) on malformed segments — leaving a
    // partial state (identity folder on disk, no relay account). Reject at
    // the HTTP door instead of falling into the orchestrator's throw-path.
    if (poolPicked === true && !ROLE_NAME_RE.test(role.trim())) {
      res.status(400).json({
        error:
          "role must be kebab-case-lowercase with no leading digit per segment when poolPicked=true",
      });
      return;
    }

    const parsedColorHue = (typeof colorHue === "number" ? colorHue : null) as number | null;
    const parsedVoice = (typeof voice === "string" ? voice : null) as string | null;
    // Path handling: empty/absent body.path → pass empty through, letting
    // the orchestrator normalize to $HOME and skip its best-effort mkdir.
    // The peer-commit script (identity-birth-orchestrator.ts L1266) already
    // creates `$STAGING/workspace` and moves it under the composed
    // identityFolderName as part of Step 8's atomic commit, so
    // `~/fleet/identities/<identityFolderName>/workspace/` exists
    // unconditionally post-commit; the orchestrator's post-commit mkdir is
    // only meaningful for admin-typed CUSTOM paths.
    //
    // The pre-2026-09-27 substitution used opts.name (the raw pool-picked
    // name) to compose `~/fleet/identities/<name>/workspace/` here, but the
    // actual identity folder gets composed later as `<name>-<role>[-N]` by
    // the orchestrator's Step 6 MXID derivation. So the mkdir would create
    // an EMPTY sibling folder at the raw name — fleet-status source-B then
    // enumerated it as a phantom identity with no frontmatter, leaking into
    // every user's sidebar on shared hosts.
    const parsedPath = (typeof path === "string" ? path : "") as string;
    // Phase 86 Plan 86-04: absent-⇒-empty-string fallbacks for cosmetics that
    // moved to role level. The orchestrator's buildIdentityFileBody
    // (identity-birth-orchestrator.ts L392-395) already treats empty-string
    // title as absent (omits the `title:` key from frontmatter), so passing ""
    // is byte-equivalent to omitting the field from identity frontmatter — the
    // role's title wins via the Plan 86-01 merge at publicIdentity.
    const parsedTitle =
      typeof title === "string" && title.trim() ? title.trim() : "";
    // Empty avatarCandidateId signals the orchestrator to skip Step 1's
    // candidate lookup + Step 2.5's avatar-sibling write; the role's
    // avatar file is served via Plan 86-01's GET /:key/avatar fallback.
    const parsedAvatarCandidateId =
      typeof avatarCandidateId === "string" && avatarCandidateId.trim()
        ? avatarCandidateId.trim()
        : "";
    // Phase 80 Plan 80-03: trim task string here so orchestrator's absent-⇒-omit
    // guard (opts.task.trim().length > 0) sees the canonical value. Null → null.
    const parsedTask = (typeof task === "string" ? task.trim() : null) as string | null;
    // Phase 80 Plan 80-03b: parsedPoolPicked preserves the tri-state (true / false /
    // undefined). undefined → orchestrator takes legacy branch. false is threaded
    // as-is (explicit opt-out from a client that knows the field exists but wants
    // legacy shape).
    const parsedPoolPicked =
      typeof poolPicked === "boolean" ? poolPicked : undefined;
    // Optional project slug (born-into-project from a section's "New
    // conversation"). Same slug shape as the project routes; anything else is
    // dropped rather than 400'd — the post-birth move still runs client-side.
    const parsedProject =
      typeof project === "string" && /^[a-z0-9-]{1,64}$/.test(project.trim())
        ? project.trim()
        : undefined;

    // -----------------------------------------------------------------------
    // Pretty-names shape (2026-10-01): auto-suffix the identity slug for the
    // name-it-myself path. Probe the target host for `~/fleet/identities/
    // <name>/`; if it exists, bump the suffix (-2, -3, ...) until free. This
    // closes the common-case collision gap — users never see "identity
    // already exists" for a typed name whose slug happens to match an
    // existing identity. The pool-picked path handles collisions via Synapse
    // MXID ordinal inside the orchestrator, so we only run the probe when
    // the caller came through displayName.
    //
    // The probe is best-effort: if resolveHostById or the probe itself fails,
    // we leave the name unchanged and let the orchestrator surface whatever
    // the real failure is. The step-8 EEXIST + rollback path still protects
    // against the vanishingly rare true-race case (two concurrent births
    // picking the same base slug past the probe) — no Matrix accounts leak.
    // -----------------------------------------------------------------------
    const isNameItMyself =
      typeof bodyAny.displayName === "string" &&
      bodyAny.displayName.trim().length > 0;
    if (isNameItMyself) {
      const probeHost = await resolveHostById(hostId, userId);
      if (probeHost) {
        try {
          name = await resolveFreeIdentitySlug(probeHost, hostId, name);
        } catch (err) {
          // Code-review Finding #3: cap-exhausted surfaces as a user-visible
          // 400 ("too many existing identities with similar names") rather
          // than falling through to a doomed birth. The sanity cap is 100,
          // so the user realistically only hits this if the name is extremely
          // common on this host.
          if (err instanceof SlugCapExhaustedError) {
            res.status(400).json({
              error:
                "Too many existing identities with similar names on this host — try a more distinctive name.",
            });
            return;
          }
          throw err;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 75 Plan 04 — fail-early 503 when matrix admin creds absent.
    //
    // Fail-early per D-OQ7 in 75-04-PLAN + T-75-28 in threat model — no
    // hardcoded homeserver fallback; each Skynet box is its own island
    // (CONTEXT.md § Philosophy). On a fresh non-ingested deployment the
    // operator sees a clear "matrix_admin_foundation_not_ingested" signal
    // rather than a mint-call failure several steps later against a fake
    // homeserver.
    //
    // MUST run BEFORE opening SSE (returns application/json 503, not an SSE
    // stream with a failed event) so the frontend can surface the deploy-
    // runbook message inline.
    // -----------------------------------------------------------------------
    const creds = await getMatrixAdminCreds();
    if (!creds) {
      res.status(503).json({
        error: "matrix_admin_foundation_not_ingested",
        detail: "matrix admin foundation not ingested — see deploy runbook",
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Phase 110 (reshaped 2026-09-24 to per-host): acquire a per-target-host
    // birth-throttle slot before opening SSE. If the host's queue is at
    // capacity, reject with 429 JSON (Content-Type application/json) — do NOT
    // flush SSE headers, because a caller that receives text/event-stream
    // frames after a 429 status has no clean way to route the response. The
    // 429 body carries retry_after_ms so the frontend can back off with a
    // hint. Cross-host concurrency is now unrestricted.
    // -----------------------------------------------------------------------
    let release: (() => void) | null = null;
    try {
      release = await acquireBirthSlot({ source: "http", hostId });
    } catch (err) {
      if (err instanceof ThrottleRejectedError) {
        res
          .status(429)
          .json({ error: "identity_birth_queue_full", retry_after_ms: err.retryAfterMs });
        return;
      }
      throw err;
    }

    // -----------------------------------------------------------------------
    // Open SSE stream (headers flushed BEFORE orchestrator starts)
    // -----------------------------------------------------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx SSE disable-buffering hint
    res.flushHeaders();

    // -----------------------------------------------------------------------
    // Phase 106 (D-09): 30s SSE comment-frame keepalive.
    //
    // The birth stream holds open up to WAIT_FOR_SUPERVISOR_TIMEOUT_MS
    // (300s in identity-birth-orchestrator.ts) during the wait-for-supervisor
    // poll after Step 8. Intermediary idle-timeout defaults (nginx 60s, Caddy
    // 30s per docker/nginx.conf + docker/nginx-https.conf) would kill the
    // stream mid-wait without a periodic frame. The `:keepalive` leading-colon
    // form is an SSE comment per spec — consumers ignore it silently, so no
    // frontend-side handling is needed.
    //
    // 30s cadence sits well under both the nginx default (60s) and Caddy
    // default (30s), giving the first keepalive frame ~two chances to fire
    // before Caddy would close on inactivity.
    // -----------------------------------------------------------------------
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(":keepalive\n\n");
      } catch {
        /* ignore write errors after close */
      }
    }, 30000);

    // -------------------------------------------------------------------------
    // Phase 106 review (M1 fix): wire an AbortController to req.on("close")
    // so a client disconnect (browser tab close, hard navigation, user's
    // AbortController.abort()) breaks the orchestrator's up-to-120s wait
    // block instead of pinning an SSH connection + firing wasted discovery
    // execs against the target host. Only the wait block honors it; the mint
    // steps (1/2/6/7/8) are seconds-scale and abort-mid-mint would leave
    // worse partial state than letting them finish.
    // -------------------------------------------------------------------------
    const abortController = new AbortController();
    req.on("close", () => {
      abortController.abort();
    });

    // -----------------------------------------------------------------------
    // Emit helper — frames each event as SSE
    // -----------------------------------------------------------------------
    const emit = (e: BirthEvent): void => {
      res.write(`event: birth\ndata: ${JSON.stringify(e)}\n\n`);
    };

    // -----------------------------------------------------------------------
    // Build real deps object
    // -----------------------------------------------------------------------
    // Patch #316: userId is the JWT subject string (users.id = text() in
    // schema). Prior parseInt() produced NaN → String(NaN) = "NaN" downstream,
    // breaking every birth at step 1's getCandidateForBirth scope guard.
    // Pass the string through unmodified; dep signatures updated to match.

    // Phase 68 Plan 03: createIdentityRecord + getIdentityRecord removed —
    // no DB record is created; disk folder + frontmatter + avatar sibling ARE
    // the identity's identity. forceSave also removed (no DB mutation to save).
    const deps: BirthDeps = {
      connectOneShot,
      execCommand,
      isLocalHostId,
      execLocal,
      resolveHostById: async (hostId, uid) =>
        resolveHostById(hostId, uid),
      // Phase 75 Plan 04 — four new BirthDeps for the admin-mint + relay.json
      // write sequence (Steps 6/7/8). Wired to Plan 02's matrix-admin-client
      // exports. matrixHomeserver is read from the first-class column on
      // matrix_admin_creds (W-1: read creds.homeserverBase directly; do NOT
      // split creds.userId to derive it). D-OQ7: NO hardcoded fallback —
      // the 503 fail-early check above guarantees creds is non-null here.
      matrixCreateOrUpdateUser: (mxid, password, displayname) =>
        matrixCreateOrUpdateUser(mxid, password, displayname),
      matrixLoginAsUser: (mxid, validUntilMs) =>
        matrixLoginAsUser(mxid, validUntilMs),
      // Rollback primitive for the mint-first atomic-birth flow: when Step 6
      // mint succeeds but Step 8 peer-commit fails, the orchestrator calls
      // this to deactivate the just-minted account so retry with next
      // ordinal doesn't leak Synapse accounts.
      matrixDeactivateUser: (mxid) => matrixDeactivateUser(mxid),
      matrixHomeserver: creds.homeserverBase,
      matrixServerName: creds.serverName,
      // Host-reachable relay.json base — falls back to homeserverBase when
      // the hostSideBase column is null (single-URL fleets like t1000).
      relayJsonHomeserverBase: creds.hostSideBase ?? creds.homeserverBase,
      buildRelayJsonBody: (opts) => buildRelayJsonBody(opts),
      // Phase 80 Plan 80-03b — countUsersMatching primitive from plan 80-02.
      // Called by deriveMxidWithOrdinal inside Step 6 to find the first unused
      // ordinal for the composed base handle when opts.poolPicked === true.
      // Never invoked on the legacy path (poolPicked absent/false).
      matrixCountUsersMatching: (mxid) => matrixCountUsersMatching(mxid),
      // Phase 106 (D-05/D-06) — wait-for-supervisor sensor. Called every
      // WAIT_FOR_SUPERVISOR_POLL_MS from birthIdentity's wait block after
      // Step 8's relay.json write. Same helper fleet-status and sessions.ts
      // already trust — do NOT introduce a parallel sensor per shape file
      // §"What would make it wrong" bullet 7.
      discoverIdentitySessionFile: (conn, identityName) =>
        discoverIdentitySessionFile(conn, identityName),
    };

    // -----------------------------------------------------------------------
    // Phase 129 Plan 07 D-4 auto-tag: check if the target host is multi-user;
    // if so, resolve the caller's Skynet username so the orchestrator can
    // auto-tag the new identity file's frontmatter with `users: [creator]`.
    // On single-user hosts, both queries are skipped (creatorUsername stays
    // undefined; buildIdentityFileBody omits the users: key per D-3
    // absent-⇒-omit fallback). Ordering: this runs AFTER the pre-existing
    // body validation, matrix-creds 503 gate, and throttle-slot acquire, so
    // a bad request never reaches the DB lookups. It runs BEFORE the
    // birthIdentity call so creatorUsername can be threaded into
    // BirthOptions.
    //
    // Write-side fail-open per PATTERNS.md § "Read-path fail-open, write-
    // path fail-closed" EXCEPTION:
    //   - isHostMultiUser throws → treat as single-user (auto-tag skipped),
    //     log a warn. Doing this defensively rather than propagating the
    //     throw preserves the identity-birth code path in the face of a
    //     transient DB glitch (D-8 defensive fail-open).
    //   - getUsernameForUserId returns null on a multi-user host → auto-tag
    //     is SKIPPED, sshLogger.warn fires. A wrong-user auto-tag would be
    //     a shape §"would make it wrong" bullet-3 violation, so we write
    //     the file WITHOUT the users: key rather than tag with an empty
    //     string.
    //
    // Structured log at successful auto-tag path (sshLogger.info with
    // operation:"identity_birth_auto_tagged") mirrors the roles-create.ts
    // shape from Plan 129-06 so ops has a single grep target for D-4
    // auto-tag decisions across both endpoints.
    // -----------------------------------------------------------------------
    let creatorUsername: string | undefined = undefined;
    let isMultiUser = false;
    try {
      isMultiUser = await isHostMultiUser(hostId);
    } catch (err) {
      sshLogger.warn(
        "Phase 129: identity-birth isHostMultiUser threw — treating as single-user (fail-open)",
        {
          operation: "identity_birth_multi_user_probe_failed",
          userId,
          hostId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    if (isMultiUser) {
      const resolved = await getUsernameForUserId(userId);
      if (resolved) {
        creatorUsername = resolved;
        sshLogger.info(
          "Phase 129: identity-birth auto-tagged creator on multi-user host",
          {
            operation: "identity_birth_auto_tagged",
            name: name.trim(),
            hostId,
            creatorUsername,
          },
        );
      } else {
        sshLogger.warn(
          "Phase 129: identity-birth username lookup failed — auto-tag skipped",
          {
            operation: "identity_birth_username_lookup_failed",
            userId,
            hostId,
            name: name.trim(),
          },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Invoke orchestrator — catch errors and surface in SSE stream
    // -----------------------------------------------------------------------
    try {
      await birthIdentity(
        {
          userId,
          hostId,
          name: name.trim(),
          // Phase 86 Plan 86-04: empty-string title threads the absent-⇒-omit
          // invariant through the orchestrator so the identity's frontmatter
          // gets no `title:` key and inherits from the role at read time
          // (D-CTX-86-inherit + Plan 86-01 publicIdentity merge).
          title: parsedTitle,
          path: parsedPath,
          colorHue: parsedColorHue,
          voice: parsedVoice,
          role: role.trim(),
          extraRoles,
          // Phase 80 Plan 80-03: thread task through opts. ?? undefined so
          // parsedTask=null → orchestrator sees undefined (omit-empty matches
          // BirthOptions optional shape).
          task: parsedTask ?? undefined,
          // Phase 80 Plan 80-03b: thread poolPicked through opts. undefined
          // (absent from body) → orchestrator takes legacy `@<name>:<server>`
          // MXID branch. true → derivation path. false → legacy branch
          // (explicit opt-out preserved as boolean, distinct from undefined).
          poolPicked: parsedPoolPicked,
          project: parsedProject,
          // Phase 106 review M1 fix: thread the client-disconnect signal into
          // the orchestrator so the wait-for-supervisor loop breaks early on
          // browser navigation / tab close instead of pinning an SSH conn.
          abortSignal: abortController.signal,
          // Phase 129 Plan 07 D-4 auto-tag: resolved above from
          // isHostMultiUser + getUsernameForUserId. undefined on single-user
          // hosts OR on lookup failure — orchestrator's buildIdentityFileBody
          // omits the users: key in either case (absent-⇒-omit fallback).
          creatorUsername,
        },
        emit,
        deps,
      );
    } catch (err) {
      // Unexpected throw from orchestrator (should emit ended event itself,
      // but catch here as a safety net — emit an ended{ok:false} if not already).
      // Phase 106 (D-11): carry sanitized reason on the safety-net emit too,
      // for log-forensic wire parity with the orchestrator's own outer-catch.
      databaseLogger.error("Identity birth orchestrator threw unexpectedly", err, {
        operation: "identity_birth",
        userId,
        name,
      });
      emit({ type: "ended", ok: false, reason: sanitizeError(err) });
    } finally {
      // Phase 106 (D-09): tear down the keepalive timer FIRST — the interval
      // holds a ref on the event loop, and any post-close write attempt from
      // the interval would race with `res.end()` below.
      clearInterval(keepAliveInterval);
      // Consume the candidate to prevent re-use.
      // Phase 86 Plan 86-04: skip when no candidate was submitted — role-
      // inherited-avatar births (D-CTX-86-inherit) never touch the candidate
      // cache, so there is nothing to consume. consumeCandidateForBirth is
      // already a no-op on missing entries, but skipping saves a spurious
      // lookup and prevents any future variant of the helper from surfacing
      // a `key not found` warning on the happy path.
      if (parsedAvatarCandidateId) {
        try {
          consumeCandidateForBirth(userId, parsedAvatarCandidateId);
        } catch {
          // Ignore cleanup errors
        }
      }
      res.end();
      // Phase 110: release the throttle slot LAST — after res.end() has flushed
      // pending frames but before the handler returns to Express. The
      // global-throttle module guards release() with a local `released` flag,
      // so a stray double-call is a no-op.
      if (release) release();
    }
  },
);

// ---------------------------------------------------------------------------
// Error handler (mirrors identities.ts L316-333)
// ---------------------------------------------------------------------------
router.use(
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    databaseLogger.error("Identity birth route error", err, {
      operation: "identity_birth_route_error",
    });
    return res.status(500).json({ error: err?.message ?? "Identity birth error" });
  },
);

export default router;
