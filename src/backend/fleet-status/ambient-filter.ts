/**
 * ambient-filter.ts — Filter ambient background tasks from fleet-status payloads.
 *
 * MARKER MECHANISM (RESEARCH §1 RECOMMENDATION — LOCKED):
 *   The `AGENT_AMBIENT=1` environment variable approach is BLOCKED because env
 *   vars do NOT appear in background_tasks[] entries of the Stop hook payload.
 *   The `description` prefix `[ambient]` is the ONLY viable mechanism: the
 *   description field IS present for Monitor-type tasks (and shell tasks), so a
 *   Monitor launched with description "[ambient] recv monitor" will carry that
 *   prefix in the Stop payload's background_tasks[] entry.
 *
 * CASE-SENSITIVITY (DELIBERATE):
 *   The filter is case-sensitive — only lowercase `[ambient]` is treated as the
 *   marker. Plan 05's id-skill edit emits the exact lowercase string verbatim.
 *   Any capitalisation variation (e.g. `[Ambient]`) is treated as a user-created
 *   non-ambient task. Defensive: better to over-count (false working signal) than
 *   to falsely filter something the user did NOT intend to tag as ambient.
 *
 * WHERE THIS RUNS (Plan 04):
 *   Plan 04's ssh-poll-orchestrator calls parseStopHookPayload (from types.ts),
 *   then filterAmbientTasks(payload.background_tasks), and attaches the filtered
 *   array to the SessionState it publishes via Plan 02's subscription-registry.ts.
 *   The frontend never sees ambient Monitors in backgroundTasks[].
 *
 * MISSING DESCRIPTION (D-CTX §Hard dependency):
 *   Tasks with no description field are NOT treated as ambient. The description
 *   absence means we cannot determine intent, so the safe choice is to preserve
 *   the task as potentially user-visible work.
 */
import type { BackgroundTask } from "./wire-protocol.js";

/**
 * Determine whether a single BackgroundTask is ambient.
 *
 * A task is ambient iff its description field is present AND starts with the
 * exact string `[ambient]` (lowercase, bracket-prefixed, case-sensitive).
 * Tasks with no description are NOT ambient.
 */
export function isAmbientTask(task: BackgroundTask): boolean {
  return task.description?.startsWith('[ambient]') ?? false;
}

/**
 * Filter ambient tasks from a BackgroundTask array.
 *
 * Returns a NEW array containing only the non-ambient tasks, preserving the
 * original ordering of non-ambient entries. The input array is NOT mutated.
 *
 * @param tasks - The background_tasks[] array from a parsed StopHookPayload
 * @returns A new array with all ambient tasks removed
 */
export function filterAmbientTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((t) => !isAmbientTask(t));
}
