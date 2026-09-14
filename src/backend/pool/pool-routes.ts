/**
 * Phase 80 Plan 04 — POST /identities/pool/pick router.
 *
 * Consumes:
 *   - pool-loader.ts (Plan 80-01) via getVettedPool()
 *   - identity-artifact-reader.ts via listIdentityKeysOnHost() + isLocalHostId()
 *   - ssh/host-resolver.ts via resolveHostById() (cross-user isolation)
 *   - ssh/ssh-one-shot.ts via connectOneShot() (REMOTE enumeration branch)
 *   - utils/auth-manager.ts via AuthManager (JWT gate)
 *
 * Returns a bare lowercase pool name (matches IDENTITY_KEY_RE) for the
 * frontend NewSessionDialog to prefill the identity name field. The response
 * is ALWAYS the bare pool name — the birth-orchestrator (Plan 80-03b) owns
 * full-handle MXID composition and appends an ordinal (`-2`, `-3`, ...) at
 * creation time if the base handle is taken.
 *
 * "Is this taken?" question (2026-09-14 rewrite — authority moved to the host):
 *   The availability authority is the TARGET HOST's identity directory set:
 *   a name is free iff `$HOME/fleet/identities/<name>` does not exist there.
 *   That is the same gate identity-birth-orchestrator enforces at creation
 *   time (L1313-1330), so the suggestion now agrees with what birth will
 *   actually accept.
 *
 *   The prior implementation probed SYNAPSE instead — composing the full
 *   base-handle MXID `@<candidate>-<role>:<serverHost>` per candidate and
 *   asking countUsersMatching whether it existed. That was the wrong
 *   authority (Matrix account existence is downstream of, and can disagree
 *   with, identity-folder existence) and it was the ONLY reason this route
 *   needed `role` at all. Ashley 2026-09-14, verbatim: *"currently the relay
 *   is not used to check units checking us only the identity folders on the
 *   given host are so i don't think we will have a problem of the
 *   availability probe."* Losing the MXID probe is deliberate: it was
 *   suggestion-quality polish, never the guarantee. Birth-time folder
 *   existence + the frontend's name-blur collision precheck +
 *   deriveMxidWithOrdinal remain the real gates.
 *
 *   Cost also improves: ONE enumeration round-trip replaces up to
 *   pool-length sequential admin-API calls.
 *
 * `role` is OPTIONAL (2026-09-14). It no longer participates in the
 * availability question, so the frontend can prefill a name before a role is
 * chosen. When supplied it is still validated (ROLE_NAME_PATTERN) so a
 * malformed value fails loudly here rather than silently later; when absent
 * the route behaves identically minus that validation.
 *
 * Degradation contract: an unreachable / unenumerable host must NOT fail the
 * request. The pool is still returned from (first shuffled candidate) so the
 * modal always offers a name — a suggestion box that stalls or errors is
 * worse UX than an unverified suggestion, and birth-time checks still
 * protect correctness.
 *
 * Route mount ordering (RESEARCH §Landmine 4):
 *   MUST be mounted at `/identities/pool` BEFORE the generic
 *   `/identities` mount in database.ts. Otherwise Express routes to the
 *   generic `/:identityKey` handler and rejects with 400 because "pool"
 *   fails IDENTITY_KEY_RE.
 *
 * Security discipline:
 *   - JWT auth via AuthManager.createAuthMiddleware()
 *   - Cross-user hostId spoofing → 404 (never 200 with empty data)
 *   - Missing matrix admin creds → 503 fail-early (mirror identity-birth L158-165)
 *   - Malformed role → 400 BEFORE any Synapse call (ROLE_NAME_PATTERN gate)
 *   - Never logs admin token / synapse response bodies
 *   - Generic 500 fallback at router base
 */

import type { AuthenticatedRequest } from "../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { sshLogger } from "../utils/logger.js";
import { getVettedPool } from "./pool-loader.js";
import {
  isLocalHostId,
  listIdentityKeysOnHost,
} from "../claude-session/identity-artifact-reader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Role name validator — kebab-case-lowercase with leading-alpha per segment.
 *
 * IMPORTANT: this MUST match identity-birth-orchestrator.ts's private
 * ROLE_NAME_RE exactly (L517). It is stricter than the widely-used
 * ROLE_NAME_PATTERN (`/^[a-z0-9-]+$/`) — the leading-alpha requirement
 * prevents the picker from composing a base handle that composeMxidLocalpart
 * would then reject with `mxid_role_malformed`. Keeping the two regexes in
 * sync means a role that passes this gate here will always successfully
 * compose downstream at birth time.
 *
 * Duplicated (not imported) because ROLE_NAME_RE is a private const in
 * identity-birth-orchestrator.ts — matches the local-duplication style of
 * IDENTITY_KEY_RE in identity-birth.ts:63 (defense-in-depth per T-75-16).
 */
const ROLE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;

/**
 * SSH connect timeout for the REMOTE identity-enumeration branch. Matches
 * identity-exists-on-host.ts's connectOneShot budget — this route answers the
 * same "is this name taken on that host?" question and sits behind the same
 * 10s nginx proxy_read_timeout, so it must not out-wait it.
 */
const SSH_CONNECT_TIMEOUT_MS = 3000;

// prettier-ignore
router.post("/pick", express.json(), authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const { role, hostId } = req.body as Record<string, unknown>;

    // -----------------------------------------------------------------------
    // 1. hostId validation — positive integer or 400
    // -----------------------------------------------------------------------
    if (
      typeof hostId !== "number" ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // -----------------------------------------------------------------------
    // 2. role validation — OPTIONAL as of 2026-09-14 (see header §role).
    //    Role no longer participates in the availability question, so absence
    //    is legal. When PRESENT it is still validated so a malformed value
    //    fails here rather than silently downstream at birth.
    // -----------------------------------------------------------------------
    if (role !== undefined && role !== null && role !== "") {
      if (typeof role !== "string" || !ROLE_NAME_PATTERN.test(role.trim())) {
        res.status(400).json({
          error: "role must be kebab-case with alpha-leading segments",
        });
        return;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Cross-user host isolation (T-80-04-01) — 404 on unowned/unknown
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 4. Load pool (never throws; returns [] on any pool-loader failure)
    // -----------------------------------------------------------------------
    const pool = getVettedPool();
    if (pool.length === 0) {
      res.status(503).json({ error: "pool is empty — see deploy runbook" });
      return;
    }

    // -----------------------------------------------------------------------
    // 5. Shuffle the pool.
    //
    //    Shuffle a copy so the pool order isn't a covert stability signal.
    //    Fisher-Yates — `sort(() => Math.random() - 0.5)` is a biased shuffle
    //    (compare function violates transitivity; V8 TimSort skews
    //    permutations), which would cluster picks against the shape's
    //    "recycle the pool evenly" goal. See RESEARCH §Landmine 8 (pool
    //    exhaustion) — a biased shuffle would exhaust some names dramatically
    //    faster than others.
    // -----------------------------------------------------------------------
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Defense-in-depth normalization: pool.json entries are PascalCase by
    // convention (Plan 80-01 seed shape) but any casing drift is corrected
    // here so both the comparison and the returned name are canonical
    // lowercase (IDENTITY_KEY_RE shape, and identity folders are lowercase
    // on disk per the H3 invariant).
    const candidates = shuffled.map((c) => c.toLowerCase());

    // -----------------------------------------------------------------------
    // 6. Enumerate identity names already present on the target host — ONE
    //    round-trip, then an in-memory set difference against the pool.
    //
    //    LOCAL branch (conn === null): reads getLocalIdentitiesRoot(), which
    //    honors the IDENTITIES_HOST_DIR bind-mount.
    //    REMOTE branch: one-shot SSH + `find $HOME/fleet/identities -maxdepth 1`.
    //
    //    Degradation (see header §Degradation contract): ANY failure here —
    //    unreachable host, SSH timeout, permission error — is swallowed and
    //    treated as "no information about taken names". The request still
    //    returns a name. A stalled or 5xx-ing suggestion box is worse UX than
    //    an unverified suggestion, and birth-time folder-existence checks plus
    //    deriveMxidWithOrdinal remain the actual correctness gates.
    // -----------------------------------------------------------------------
    let takenNames = new Set<string>();
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      if (!isLocalHostId(hostId)) {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      }
      takenNames = new Set(await listIdentityKeysOnHost(conn));
    } catch (err) {
      // Swallow per the degradation contract. Log for forensics — the name
      // returned below is unverified, and that fact should be diagnosable
      // from the log rather than inferred from a user's confusion later.
      sshLogger.warn(
        "pool pick: host identity enumeration failed — returning unverified suggestion",
        {
          hostId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }

    // -----------------------------------------------------------------------
    // 7. First candidate with no identity folder on the host wins.
    //    All busy (or enumeration failed and every name looks taken — which
    //    cannot happen with an empty set) → fall back to the first shuffled
    //    candidate; birth's deriveMxidWithOrdinal appends `-N`. Never fail the
    //    request just because the pool is exhausted (RESEARCH §Landmine 8).
    // -----------------------------------------------------------------------
    const free = candidates.find((c) => !takenNames.has(c));
    res.json({ name: free ?? candidates[0] });
  },
);

// Generic 500 fallback (mirror roles-list-for-host.ts L236-251)
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("pool-routes: unhandled error", {
      operation: "pool_routes_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
