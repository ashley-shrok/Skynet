/**
 * parse-request-body.ts — slim, side-effect-free extraction of parseRequestBody
 * from worker.ts.
 *
 * WHY THIS EXISTS: worker.ts's transitive imports (birthIdentity → Skynet DB
 * initialization, pool-loader, matrix-admin-client, etc.) pull heavy modules
 * into every consumer. ssh-poll-orchestrator.ts (the fleet-status poller) only
 * needs the pure parser to validate spawn-request bodies during its per-tick
 * scan — it does NOT need the birth machinery. Importing worker.ts from
 * ssh-poll-orchestrator.ts inflates the fleet-status test module graph and
 * broke Phase 52/53 tests during the id-skill-revamp campaign squash-merge.
 *
 * Keep this file dependency-free (only ROLE_NAME_PATTERN + the local
 * TASK_MAX_LENGTH constant). Any change to the validation logic here should
 * ALSO update tests in worker.test.ts that exercise it via the re-export.
 */

import { ROLE_NAME_PATTERN } from "../utils/role-name-pattern.js";
import type { SpawnRequestBody } from "./types.js";

/**
 * Maximum length for the `task` field (chars). 500 is the cap user picked
 * for the coord-side dispatch prompt at the coordinator-instructions.md wire.
 */
export const TASK_MAX_LENGTH = 500;

/**
 * Parse and validate a request file's raw JSON body.
 * Returns ok:true + SpawnRequestBody on success, or ok:false + reason + message
 * on any validation failure (D-04, D-05, D-12, T-99-01).
 *
 * Accepted fields: roles[], skills?[], prompt, task, requested_at.
 * Extra fields (coord_mxid, target-host, priority, retry_count, ordinal) are
 * rejected as malformed (D-05).
 */
export function parseRequestBody(
  _uuid: string,
  rawBody: string,
): { ok: true; body: SpawnRequestBody } | { ok: false; reason: "malformed"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    return {
      ok: false,
      reason: "malformed",
      message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "malformed", message: "body is not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;

  // roles[] validation — replaces single role: string (D-12)
  const roles = obj["roles"];
  if (!Array.isArray(roles) || roles.length === 0) {
    return { ok: false, reason: "malformed", message: "missing required field: roles (must be non-empty array)" };
  }
  for (const r of roles) {
    if (typeof r !== "string" || r.length === 0) {
      return { ok: false, reason: "malformed", message: "roles: each element must be a non-empty string" };
    }
    if (!ROLE_NAME_PATTERN.test(r)) {
      return {
        ok: false,
        reason: "malformed",
        message: `roles: element does not match pattern ${ROLE_NAME_PATTERN}: ${JSON.stringify(r)}`,
      };
    }
  }

  // skills[] validation — optional field (D-04)
  const skills = obj["skills"];
  if (skills !== undefined) {
    if (!Array.isArray(skills)) {
      return { ok: false, reason: "malformed", message: "skills must be an array if present" };
    }
    for (const s of skills) {
      if (typeof s !== "string" || s.length === 0) {
        return { ok: false, reason: "malformed", message: "skills: each element must be a non-empty string" };
      }
    }
  }

  // prompt validation — plain string, no length cap (D-06)
  const prompt = obj["prompt"];
  if (typeof prompt !== "string" || prompt.length === 0) {
    return { ok: false, reason: "malformed", message: "missing required field: prompt" };
  }

  const task = obj["task"];
  if (task !== null && typeof task !== "string") {
    return { ok: false, reason: "malformed", message: "task must be string or null" };
  }

  if (typeof task === "string" && task.length > TASK_MAX_LENGTH) {
    return {
      ok: false,
      reason: "malformed",
      message: `task exceeds ${TASK_MAX_LENGTH} character limit (got ${task.length})`,
    };
  }

  const requested_at = obj["requested_at"];
  if (typeof requested_at !== "string") {
    return { ok: false, reason: "malformed", message: "missing required field: requested_at" };
  }

  return {
    ok: true,
    body: { roles, skills: skills as string[] | undefined, prompt, task: task as string | null, requested_at },
  };
}
