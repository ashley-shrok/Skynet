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
import { derivePrettyNameSlug } from "../utils/pretty-name-slug.js";
import type { SpawnRequestBody } from "./types.js";

/**
 * Maximum length for the `task` field (chars). 500 is the cap user picked
 * for the coord-side dispatch prompt at the coordinator-instructions.md wire.
 */
export const TASK_MAX_LENGTH = 500;

/**
 * Project slug gate — mirror of PROJECT_SLUG_RE in
 * claude-session/identity-artifact-reader.ts (duplicated rather than imported
 * to keep this file dependency-free; see header).
 */
const PROJECT_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Cap on `requested_by` — a log-only free-form tag, not an identifier. */
export const REQUESTED_BY_MAX_LENGTH = 200;

/**
 * Parse and validate a request file's raw JSON body.
 * Returns ok:true + SpawnRequestBody on success, or ok:false + reason + message
 * on any validation failure (D-04, D-05, D-12, T-99-01).
 *
 * Accepted fields: roles[], skills?[], prompt, task, requested_at, users?[],
 * name?, project?, requested_by?.
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

  // users[] validation — optional spec-provided user tag for the newborn's
  // frontmatter `users:` field. Same validation shape as skills[].
  const users = obj["users"];
  if (users !== undefined) {
    if (!Array.isArray(users)) {
      return { ok: false, reason: "malformed", message: "users must be an array if present" };
    }
    for (const u of users) {
      if (typeof u !== "string" || u.length === 0) {
        return { ok: false, reason: "malformed", message: "users: each element must be a non-empty string" };
      }
    }
  }

  // name — optional typed name (the "name it myself" path). Same pretty-name
  // rules as the new-conversation dialog; the worker derives the slug again
  // at birth time, this is the early malformed gate.
  const name = obj["name"];
  if (name !== undefined) {
    if (typeof name !== "string") {
      return { ok: false, reason: "malformed", message: "name must be a string if present" };
    }
    const derivation = derivePrettyNameSlug(name);
    if (derivation.ok !== true) {
      return { ok: false, reason: "malformed", message: `name is not usable (${derivation.reason}): ${JSON.stringify(name)}` };
    }
  }

  // project — optional project slug written to the newborn's `project:`
  // frontmatter. Pattern-gated only (same as the move-to-project route).
  const project = obj["project"];
  if (project !== undefined) {
    if (typeof project !== "string" || !PROJECT_SLUG_PATTERN.test(project)) {
      return {
        ok: false,
        reason: "malformed",
        message: `project must match ${PROJECT_SLUG_PATTERN}: ${JSON.stringify(project)}`,
      };
    }
  }

  // requested_by — optional free-form tag naming who dropped the request.
  // Logged by the worker only; never written to the newborn's identity file.
  const requested_by = obj["requested_by"];
  if (requested_by !== undefined) {
    if (typeof requested_by !== "string" || requested_by.length === 0) {
      return { ok: false, reason: "malformed", message: "requested_by must be a non-empty string if present" };
    }
    if (requested_by.length > REQUESTED_BY_MAX_LENGTH) {
      return {
        ok: false,
        reason: "malformed",
        message: `requested_by exceeds ${REQUESTED_BY_MAX_LENGTH} character limit (got ${requested_by.length})`,
      };
    }
  }

  return {
    ok: true,
    body: {
      roles,
      skills: skills as string[] | undefined,
      prompt,
      task: task as string | null,
      requested_at,
      users: users as string[] | undefined,
      name: name as string | undefined,
      project: project as string | undefined,
      requested_by: requested_by as string | undefined,
    },
  };
}
