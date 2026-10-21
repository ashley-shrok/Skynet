/**
 * A scheduled task's `project` — the project every conversation it starts is
 * born in. Shared by the scheduled-agents write (validation, run-now) and
 * list (row path) routes; the scheduler's `_live_project` is the Python twin.
 */

import { PROJECT_SLUG_RE } from "./identity-artifact-reader.js";

/** True iff `slug` can name a live project folder (`archive` is the
 *  archived-projects folder, never a project). */
export function isProjectSlug(slug: unknown): slug is string {
  return typeof slug === "string" && PROJECT_SLUG_RE.test(slug) && slug !== "archive";
}
