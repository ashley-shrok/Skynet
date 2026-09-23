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
 *   needed `role` at all. The operator, 2026-09-14, verbatim: *"currently the relay
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
 *   - Cross-user hostId spoofing → 404 (never 200 with empty data), checked
 *     BEFORE the pool is loaded or the host is contacted
 *   - Malformed role → 400 before any host contact (when role is supplied)
 *   - Enumeration failures log a coarse classification only — never the raw
 *     error message, which can embed the target address or auth hints
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
import {
  listArchivedIdentityEntriesOnHost,
  type ArchivedIdentityEntry,
} from "../claude-session/list-archived-identity-keys.js";
import { rankPoolCandidates } from "./rank-pool-candidates.js";
import { ROLE_NAME_PATTERN } from "../utils/role-name-pattern.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Role-name validation uses the CANONICAL kebab-case-lowercase pattern
// (`/^[a-z0-9-]+$/`) imported above.
//
// 2026-09-14: this file previously kept a private, STRICTER copy requiring a
// leading alpha per segment, mirroring identity-birth-orchestrator's MXID-shape
// gate. That made sense while this route composed an MXID to probe — a role that
// could not compose was worth rejecting early. It no longer composes anything,
// so the strict gate had become a liability rather than defense-in-depth: a role
// like `2fa-helper` passes creation AND passes the role-listing filter (which
// uses the canonical pattern), so it appears in the dropdown and would then 400
// here, killing name suggestions for a role the system itself accepted.
//
// Role is advisory on this route now — it is logged, not used to compute the
// answer. Validation is retained only so a malformed value fails loudly here
// rather than silently downstream, and it matches what the rest of the system
// considers a valid role name.

/**
 * SSH connect timeout for the REMOTE identity-enumeration branch. Matches
 * identity-exists-on-host.ts's connectOneShot budget — this route answers the
 * same "is this name taken on that host?" question.
 */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * Total wall-clock budget for the enumeration step (connect + exec).
 *
 * SSH_CONNECT_TIMEOUT_MS bounds only the handshake; listIdentityKeysOnHost's
 * REMOTE branch applies its own 15s exec timer, so the two together allow ~18s
 * before the degradation path engages. This endpoint only produces a name
 * suggestion for a modal, and the degradation path already returns a usable
 * (unverified) name — so failing fast beats making the user wait, since the
 * visible outcome of a slow answer and no answer is the same empty field.
 */
const ENUMERATION_BUDGET_MS = 4000;

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
    // 5. Enumerate ACTIVE and ARCHIVED identity folders on the target host,
    //    then hand both to the tiered ranker.
    //
    //    LOCAL branch (conn === null): both enumerators read the bind-mounted
    //    host dirs directly (getLocalIdentitiesRoot / getLocalArchivedIdentitiesRoot).
    //    REMOTE branch: one connect, TWO exec channels fired in parallel
    //    (ssh2 supports concurrent channels; the enumerators are independent
    //    so serialization would be pure wall-clock waste).
    //
    //    Degradation — both dimensions independently:
    //      * If BOTH enumerations fail (SSH timeout, unreachable host, etc.),
    //        active + archived are treated as empty and the ranker degrades
    //        to a shuffled full-pool pick — matches the pre-Phase-128
    //        never-5xx contract.
    //      * If ONE succeeds and the other fails, we soft-degrade the failed
    //        side (log + empty) while KEEPING the good side. Partial info
    //        beats no info: active-only lets us still avoid handing back a
    //        currently-held name; archive-only lets us still de-prioritize
    //        recently-retired names. The wrapping try/catch handles the
    //        total-failure case; per-enumerator .catch() handles the partial.
    //
    //    A stalled or 5xx-ing suggestion box is worse UX than an unverified
    //    suggestion; birth-time folder-existence checks plus
    //    deriveMxidWithOrdinal remain the actual correctness gates.
    // -----------------------------------------------------------------------
    let activeNames = new Set<string>();
    let archivedEntries: readonly ArchivedIdentityEntry[] = [];
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    // Captured so the outer finally can (a) still close a late-arriving
    // connection when the budget race timed out before conn was assigned,
    // and (b) cancel the losing budget-timer so it doesn't linger.
    let connPromise: ReturnType<typeof connectOneShot> | null = null;
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bound the WHOLE enumeration, not just the connect. connectOneShot's
      // timeout covers the handshake only, and each enumerator's REMOTE branch
      // carries its own 15s exec timer — so worst-case is ~18s on a box that
      // accepts TCP but has a wedged shell. This route only produces a name
      // SUGGESTION and the degradation path below handles "no answer", so
      // failing fast beats making the user wait.
      const result = await Promise.race([
        (async () => {
          if (!isLocalHostId(hostId)) {
            connPromise = connectOneShot(
              host as unknown as Parameters<typeof connectOneShot>[0],
              SSH_CONNECT_TIMEOUT_MS,
            );
            conn = await connPromise;
          }
          const [activeList, archivedList] = await Promise.all([
            listIdentityKeysOnHost(conn).catch((err: unknown) => {
              sshLogger.warn(
                "pool pick: active-identity enumeration failed — soft-degrading to empty",
                {
                  hostId,
                  errorName: err instanceof Error ? err.name : "unknown",
                },
              );
              return [] as string[];
            }),
            listArchivedIdentityEntriesOnHost(conn).catch((err: unknown) => {
              sshLogger.warn(
                "pool pick: archived-identity enumeration failed — soft-degrading to empty",
                {
                  hostId,
                  errorName: err instanceof Error ? err.name : "unknown",
                },
              );
              return [] as ArchivedIdentityEntry[];
            }),
          ]);
          return {
            active: new Set(activeList),
            archived: archivedList,
          };
        })(),
        new Promise<never>((_, reject) => {
          budgetTimer = setTimeout(
            () => reject(new Error("enumeration_budget_exceeded")),
            ENUMERATION_BUDGET_MS,
          );
        }),
      ]);
      activeNames = result.active;
      archivedEntries = result.archived;
    } catch (err) {
      // Total-failure swallow (budget exceeded, connect failure). Log a COARSE
      // classification only — ssh2 error messages embed target IPs and can
      // carry key-material hints, and sshLogger.sanitizeContext masks by key
      // name (`error` is not in its sensitive list).
      sshLogger.warn(
        "pool pick: host enumeration failed entirely — returning unverified suggestion",
        {
          hostId,
          reason:
            err instanceof Error && err.message === "enumeration_budget_exceeded"
              ? "budget_exceeded"
              : "enumeration_failed",
          errorName: err instanceof Error ? err.name : "unknown",
        },
      );
    } finally {
      // Cancel the losing budget-timer so it doesn't stay armed for
      // ENUMERATION_BUDGET_MS after the happy path returns (harmless but
      // messy under load / in tests asserting clean event-loop drain).
      if (budgetTimer !== undefined) clearTimeout(budgetTimer);
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      } else if (connPromise) {
        // Race timed out BEFORE connectOneShot resolved — clean up the
        // connection whenever it does resolve, so a wedged-handshake host
        // can't leak sockets under sustained pressure. Swallow rejects.
        connPromise
          .then((c) => {
            try {
              c.end();
            } catch {
              /* ignore */
            }
          })
          .catch(() => {
            /* connect rejected — nothing to close */
          });
      }
    }

    // -----------------------------------------------------------------------
    // 6. Rank candidates by tier and return the head.
    //
    //    Ranker guarantees a non-empty output when the pool is non-empty
    //    (tier-3 is the full pool shuffled), so `ranked[0]` is always defined
    //    at this point. Tier ordering:
    //      1. Fresh (in pool, not active, not archived) — random.
    //      2. Recycled — archived AND in pool AND not active, oldest-mtime
    //         first. LRU semantics; the name gone longest returns first.
    //      3. Full pool shuffled — used only when tiers 1+2 are empty AND/OR
    //         everything is active (last-resort; birth-time gate catches it).
    //
    //    Determinism-in-tier-2 is safe: birth is globally serialized via the
    //    identity-birth throttle (concurrency=1 default), so two racing
    //    pool-picks cannot materialize as two concurrent births under the
    //    same name — the second birth waits for the first to commit and
    //    then hits the folder-exists gate.
    // -----------------------------------------------------------------------
    const ranked = rankPoolCandidates({
      pool,
      activeNames,
      archivedEntries,
    });
    res.json({ name: ranked[0] });
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
