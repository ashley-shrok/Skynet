/**
 * Phase 90 Plan 90-10 (LOW cleanup 1 — from unbiased code review): consolidate
 * ROLE_NAME_PATTERN into a single canonical location.
 *
 * Prior to this file, the regex `/^[a-z0-9-]+$/` was CLONED into:
 *   - src/backend/database/routes/roles.ts (L85, marked "cloned per plan Task 1")
 *   - src/backend/database/routes/roles-list-for-host.ts (L62)
 *   - and defined-then-re-exported from
 *     src/backend/database/routes/identity-birth-orchestrator.ts (L79)
 *
 * `identity-artifact-reader.ts` + `claude-session-server.ts` already imported
 * from identity-birth-orchestrator; the two routes above kept local clones on
 * the (now-retired) theory that keeping the routers independent would prevent
 * a test in one from cascading into the other. In practice the divergence risk
 * outweighs the isolation benefit — a future loosening in one clone would leak
 * a shell-safety gap without any grep hit.
 *
 * This module is the single source of truth. Consumers import `ROLE_NAME_PATTERN`
 * (the regex constant) or `isValidRoleName(name)` (a boolean helper for call sites
 * that read better without the `.test(...)` idiom). `identity-birth-orchestrator.ts`
 * re-exports from here for backward compatibility with the many test files that
 * import through that path.
 *
 * Semantics: kebab-case-lowercase — one or more characters from [a-z0-9-]. No
 * leading-alpha requirement (that's the stricter `pool-routes.ts` pattern which
 * stays local — it's a distinct concern about pool-name aesthetics).
 *
 * STRIDE T-22-02-02 (SSH shell-injection): this pattern is the primary defense
 * for role names interpolated into SSH exec commands. Any loosening here needs
 * a review of every SSH command builder that reads role names.
 */

export const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Boolean helper — reads more naturally than `ROLE_NAME_PATTERN.test(name)` at
 * call sites that gate work by role-name validity (STRIDE T-22-02-02 parallel).
 */
export function isValidRoleName(name: string): boolean {
  if (typeof name !== "string") return false;
  return ROLE_NAME_PATTERN.test(name);
}
