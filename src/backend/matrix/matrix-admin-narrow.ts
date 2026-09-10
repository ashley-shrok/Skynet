/**
 * TS 6.0.3 narrowing workaround helpers.
 *
 * `if (!r.ok) { ... r.status, r.error }` should narrow `r` to its error
 * variant on `SomethingOk | AdminErr` (and other ok-discriminated) unions,
 * but TS 6.0.3 lost the narrowing. See `compose-drafts.ts:254` /
 * `src/backend/database/routes/pretty-view-fetch-host-file.ts` for the inline-cast
 * + SFTP-wrapper precedent (Phase 95 Part B retired the prior SFTP side-channel module).
 *
 * These are zero-cost `asserts` predicates callers invoke inside the `!r.ok`
 * branch to re-narrow `r` to its error variant. Three names for
 * grep-visibility; identical `Extract<T, { ok: false }>` implementation.
 * (TS 2775 forbids const-aliasing an assertion predicate, so each is its own
 * function declaration.)
 *
 * Kept in its own module — separate from `matrix-admin-client` — so tests
 * that `vi.mock("../matrix/matrix-admin-client")` don't need to also stub
 * these helpers.
 */

export function assertNotOk<T extends { ok: boolean }>(
  _r: T,
): asserts _r is Extract<T, { ok: false }> {
  // No-op — caller has already checked !_r.ok.
}

export function assertAdminErr<T extends { ok: boolean }>(
  _r: T,
): asserts _r is Extract<T, { ok: false }> {
  // No-op — same as assertNotOk; distinct name for AdminErr call sites.
}

export function assertReasonErr<T extends { ok: boolean }>(
  _r: T,
): asserts _r is Extract<T, { ok: false }> {
  // No-op — same as assertNotOk; distinct name for reason-shaped call sites.
}
