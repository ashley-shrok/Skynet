/**
 * Phase 128 — Tiered pool-selection ranker.
 *
 * Ranks pool names by a three-tier LRU preference so that a name freshly
 * retired on host X does not immediately come back as the next agent's name
 * on the same host — the failure mode described in shape-pool-selection-
 * tiered.md § What this is (`~/fleet/identities/avalon-box-maintainer-3/
 * workspace/shape-pool-selection-tiered.md`).
 *
 * TIERS (produced concatenated in this order, dedup preserves first-seen):
 *
 *   1. Fresh names — pool ∖ active ∖ archived. Random order (Fisher-Yates).
 *      "Never been held on this host" — the safest recycle.
 *
 *   2. Recycled, oldest-archived first — (pool ∩ archived) ∖ active,
 *      sorted ascending by archive folder mtime (oldest first).
 *      LRU semantics: the name that has been out of circulation the longest
 *      returns first.
 *
 *   3. Fallback — the full pool, shuffled. Runs when tiers 1+2 are empty
 *      (either because every pool name is currently active on this host, or
 *      because both enumerations failed and callers passed empty inputs).
 *      The dedup at concat time means non-active names picked up in tiers 1
 *      or 3-earlier-positions naturally come before any active names —
 *      tier 3 just guarantees the output is never empty when the pool is
 *      non-empty, so a caller always gets *something* to try. Birth-time
 *      folder-existence remains the correctness gate downstream.
 *
 * PURE — no I/O, no time reads. Deterministic modulo the Fisher-Yates
 * randomness in tiers 1 and 3.
 *
 * INPUT NORMALIZATION:
 *   - `pool` entries are treated case-insensitively (pool.json is PascalCase
 *     by convention; identity folders on disk are lowercase per H3 invariant).
 *     All returned candidates are lowercase.
 *   - `activeNames` MUST already be lowercase (matches identity-folder shape).
 *   - `archivedEntries` `.name` MUST already be lowercase.
 *
 * DEGRADATION SEMANTICS:
 *   - Empty `activeNames` means "we could not determine which names are
 *     currently held" — the ranker will over-include (some tier-1 or
 *     tier-3 candidates may in fact be active). Birth-time gate catches this.
 *   - Empty `archivedEntries` means "no archives known" — every non-active
 *     name looks fresh. This is exactly the intended behavior when the
 *     archive enumeration fails or the host has no archive directory yet.
 *   - When BOTH are empty, tier-3 dominates and the ranker degrades to the
 *     shuffle-then-first-free behavior of the pre-Phase-128 picker.
 */

export interface ArchivedEntryInput {
  /** Lowercase identity key. */
  name: string;
  /** Archive folder mtime, milliseconds since epoch. Lower = older = higher priority in tier 2. */
  mtimeMs: number;
}

export interface RankPoolCandidatesInput {
  /**
   * The full vetted pool. Entries may be PascalCase; the ranker lowercases
   * internally. Duplicates are dropped by lowercased comparison.
   */
  pool: string[];
  /** Lowercase names currently held by an active agent on this host. */
  activeNames: Set<string>;
  /**
   * Archived identity entries — lowercase names + folder mtime. Names not
   * present in the pool are silently ignored (they may have been removed
   * from the curated pool since the agent was archived).
   */
  archivedEntries: readonly ArchivedEntryInput[];
}

/**
 * Return an ordered list of lowercase pool candidates: tier 1 first, tier 2
 * next, tier 3 last. Callers pick the head of the list (or, in the worker's
 * bounded-retry loop, iterate through the list skipping locally-excluded
 * collided names).
 *
 * Never throws. Empty pool returns an empty list — caller decides how to
 * surface pool-exhausted.
 */
export function rankPoolCandidates(
  input: RankPoolCandidatesInput,
): string[] {
  // Deduplicate the pool case-insensitively, preserve first-seen order.
  const poolSeen = new Set<string>();
  const poolLower: string[] = [];
  for (const raw of input.pool) {
    const n = raw.toLowerCase();
    if (!poolSeen.has(n)) {
      poolSeen.add(n);
      poolLower.push(n);
    }
  }

  const active = input.activeNames;

  // Index archived entries by name (last one wins if the caller supplied
  // duplicates — should not happen but defense-in-depth).
  const archivedByName = new Map<string, number>();
  for (const e of input.archivedEntries) {
    archivedByName.set(e.name, e.mtimeMs);
  }

  // Tier 1: fresh (in pool, not active, not archived).
  const tier1 = poolLower.filter(
    (n) => !active.has(n) && !archivedByName.has(n),
  );
  fisherYatesShuffle(tier1);

  // Tier 2: archived AND still in pool AND not currently active, sorted by
  // mtime ascending (oldest first). We iterate the pool (not the archived
  // list) so pool-membership is the intersection filter.
  const tier2 = poolLower
    .filter((n) => archivedByName.has(n) && !active.has(n))
    .sort((a, b) => {
      const am = archivedByName.get(a) ?? 0;
      const bm = archivedByName.get(b) ?? 0;
      if (am !== bm) return am - bm;
      // Tie-break by name for total determinism when two folders share an mtime.
      return a.localeCompare(b);
    });

  // Tier 3: full pool, shuffled. Overlaps with tier 1 and tier 2 — the dedup
  // at concat time keeps the earliest-tier position, so non-active names
  // still surface first. Tier 3 exists to guarantee a non-empty output when
  // every pool name is currently active on the host (the "never 5xx a
  // suggestion endpoint over pool exhaustion" contract).
  const tier3 = [...poolLower];
  fisherYatesShuffle(tier3);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [tier1, tier2, tier3]) {
    for (const n of list) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

/**
 * Fisher-Yates in-place shuffle. Matches the shuffle already in pool-routes.ts
 * (in fact this ranker is meant to REPLACE that shuffle path), avoiding the
 * biased `sort(() => Math.random() - 0.5)` trap.
 */
function fisherYatesShuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
