/**
 * Phase 80 Plan 04 — POST /identities/pool/pick router.
 *
 * Consumes:
 *   - pool-loader.ts (Plan 80-01) via getVettedPool()
 *   - matrix-admin-client.ts (Plan 80-02) via countUsersMatching()
 *   - matrix-admin-creds-store.ts via getMatrixAdminCreds()
 *   - ssh/host-resolver.ts via resolveHostById() (cross-user isolation)
 *   - utils/auth-manager.ts via AuthManager (JWT gate)
 *
 * Returns a bare lowercase pool name (matches IDENTITY_KEY_RE) for the
 * frontend NewSessionDialog to prefill the identity name field when a role
 * is chosen. The response is ALWAYS the bare pool name — the birth-
 * orchestrator (Plan 80-03b) owns full-handle MXID composition and appends
 * an ordinal (`-2`, `-3`, ...) at creation time if the base handle is taken.
 *
 * "Is this taken?" question (blocker 2 fix, revision 2026-09-06):
 *   For each pool candidate, this handler composes the FULL base-handle
 *   MXID `@<PascalCandidate>-<PascalHyphenatedRole>:<serverHost>` using
 *   the SAME casing rule as identity-birth-orchestrator's
 *   composeMxidLocalpart, then calls countUsersMatching on that shape.
 *   The bare-lowercase check `@<candidate>:<server>` is WRONG — real
 *   Matrix accounts for pool-picked identities are minted as
 *   `@Willow-Skynet-Maintainer:server` per A1 DIVERGE lock, so the
 *   bare-lowercase query always returns total===0 and hands back names
 *   that are ALREADY taken in their real MXID form.
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
import { sshLogger } from "../utils/logger.js";
import { getVettedPool } from "./pool-loader.js";
import { countUsersMatching } from "../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";

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
    // 2. role validation — kebab-case-lowercase, alpha-leading per segment
    // -----------------------------------------------------------------------
    if (typeof role !== "string" || !ROLE_NAME_PATTERN.test(role.trim())) {
      res.status(400).json({
        error: "role must be kebab-case with alpha-leading segments",
      });
      return;
    }
    const roleTrimmed = role.trim();

    // -----------------------------------------------------------------------
    // 3. Matrix admin creds fail-early gate (mirror identity-birth.ts L158-165)
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
    // 4. Cross-user host isolation (T-80-04-01) — 404 on unowned/unknown
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 5. Load pool (never throws; returns [] on any pool-loader failure)
    // -----------------------------------------------------------------------
    const pool = getVettedPool();
    if (pool.length === 0) {
      res.status(503).json({ error: "pool is empty — see deploy runbook" });
      return;
    }

    // -----------------------------------------------------------------------
    // 6. Picker (Shape A per RESEARCH §8 — blocker-2-corrected):
    //    - Extract serverHost from creds.homeserverBase.
    //    - Compose pascalRole ONCE (kebab-case → PascalCase-hyphenated).
    //    - Shuffle pool, iterate candidates:
    //        - Normalize candidate to PascalCase (defense-in-depth vs casing
    //          drift in pool.json).
    //        - Compose FULL base-handle MXID
    //          `@<PascalCandidate>-<PascalHyphenatedRole>:<serverHost>`.
    //        - countUsersMatching(fullBaseHandle):
    //            - !ok → 502 (no leak of pool state).
    //            - total===0 → return 200 { name: pascalCandidate.toLowerCase() }.
    //    - All busy → fallback to first shuffled candidate lowercased;
    //      birth-orchestrator's deriveMxidWithOrdinal will append `-N`.
    // -----------------------------------------------------------------------
    const serverHost = new URL(creds.homeserverBase).host;

    // PascalCase-hyphenated role: `skynet-maintainer` → `Skynet-Maintainer`.
    // Matches composeMxidLocalpart's casing rule (identity-birth-orchestrator
    // L551-555) so the shape we probe here is byte-identical to the shape the
    // orchestrator will mint at birth time.
    const pascalRole = roleTrimmed
      .split("-")
      .map((seg) => seg[0].toUpperCase() + seg.slice(1))
      .join("-");

    // Shuffle a copy so the pool order isn't a covert stability signal.
    // Fisher-Yates — `sort(() => Math.random() - 0.5)` is a biased shuffle
    // (compare function violates transitivity; V8 TimSort skews permutations),
    // which would cluster picks against the shape's "recycle the pool evenly"
    // goal. See RESEARCH §Landmine 8 (pool exhaustion) — biased shuffle would
    // exhaust some names dramatically faster than others.
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (const candidate of shuffled) {
      // Defense-in-depth normalization: pool.json entries are PascalCase by
      // convention (Plan 80-01 seed shape) but any casing drift is corrected
      // here so the query and the returned name are both canonical.
      const pascalCandidate =
        candidate[0].toUpperCase() + candidate.slice(1).toLowerCase();

      // FULL base-handle MXID — blocker 2 fix. NEVER compose the bare shape
      // `@${candidate.toLowerCase()}:${serverHost}` — that produces false-
      // negatives against real accounts minted as `@Willow-Skynet-Maintainer`.
      // Note: Synapse admin `user_id=<mxid>` is a SUBSTRING match, so this
      // probe also matches any `@<base>-N:server` ordinals (e.g. `-2`, `-3`).
      // Consequence: once ANY ordinal of a base handle exists, this picker
      // considers the base "taken" even if the exact bare handle is free
      // (recycled after all `-N` accounts were deactivated). The birth
      // orchestrator's `deriveMxidWithOrdinal` still finds a free slot at
      // creation time (checking each ordinal individually), so this is a
      // picker-freshness note only — birth uniqueness is preserved.
      const baseHandleMxid = `@${pascalCandidate}-${pascalRole}:${serverHost}`;

      const result = await countUsersMatching(baseHandleMxid);
      if (!result.ok) {
        // Generic 502 — do NOT surface the underlying error string or leak
        // pool state (T-80-04-06 admin-token / info-disclosure defense).
        res.status(502).json({ error: "admin API failure" });
        return;
      }
      if (result.total === 0) {
        // Response is the bare lowercase pool name (matches IDENTITY_KEY_RE).
        // Birth-orchestrator re-derives the PascalCase MXID at creation time.
        res.json({ name: pascalCandidate.toLowerCase() });
        return;
      }
    }

    // All candidates busy — return first shuffled candidate lowercased.
    // deriveMxidWithOrdinal (identity-birth-orchestrator) appends `-N` when
    // the base handle exists. Never fails the request just because the pool
    // is exhausted (RESEARCH §Landmine 8).
    const fallbackCandidate = shuffled[0];
    const fallbackPascal =
      fallbackCandidate[0].toUpperCase() +
      fallbackCandidate.slice(1).toLowerCase();
    res.json({ name: fallbackPascal.toLowerCase() });
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
