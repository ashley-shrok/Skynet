/**
 * Phase 128 — Tests for the shared tiered pool-selection ranker.
 *
 * The ranker is a PURE function — no I/O, no time reads, no logger. Tests
 * verify tier ordering, dedup semantics, degradation behavior, and the
 * determinism / randomness contract on tiers 2 and 1/3 respectively.
 *
 * Randomness is seeded via vi.spyOn(Math, "random") in the tests that need
 * to pin shuffle output; tests that DON'T pin it assert set-equality or
 * position properties that hold regardless of the shuffle result.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rankPoolCandidates,
  type ArchivedEntryInput,
} from "./rank-pool-candidates.js";

// Helper: a fixed pseudo-random source so shuffles are deterministic.
// Returns 0 for every call, which makes Fisher-Yates degrade to a reversal
// (each swap picks j=0). Good enough to prove "shuffled" vs "sorted" without
// needing to seed a real PRNG.
function pinRandomToZero(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rankPoolCandidates", () => {
  it("Test 1: all pool names are fresh — returns tier 1 only, no active or archived", () => {
    const result = rankPoolCandidates({
      pool: ["Aster", "Willow", "Cedar"],
      activeNames: new Set(),
      archivedEntries: [],
    });
    expect(new Set(result)).toEqual(new Set(["aster", "willow", "cedar"]));
    expect(result).toHaveLength(3);
  });

  it("Test 2: mixed fresh + archived — tier 1 comes before tier 2, tier 2 sorted oldest-first", () => {
    // Aster and Willow are fresh; Cedar and Pine are archived (Cedar older).
    const now = 1_700_000_000_000;
    const result = rankPoolCandidates({
      pool: ["Aster", "Willow", "Cedar", "Pine"],
      activeNames: new Set(),
      archivedEntries: [
        { name: "cedar", mtimeMs: now - 30 * 86_400_000 }, // 30 days old
        { name: "pine", mtimeMs: now - 5 * 86_400_000 }, // 5 days old
      ],
    });
    // Tier 1 = {aster, willow} in some random order; Tier 2 = [cedar, pine]
    // (cedar is older → first in tier 2).
    const tier1Names = new Set(result.slice(0, 2));
    expect(tier1Names).toEqual(new Set(["aster", "willow"]));
    expect(result.slice(2)).toEqual(["cedar", "pine"]);
  });

  it("Test 3: no fresh names — only tier 2 fires (in oldest-first order)", () => {
    const result = rankPoolCandidates({
      pool: ["Alpha", "Beta", "Gamma"],
      activeNames: new Set(),
      archivedEntries: [
        { name: "alpha", mtimeMs: 3000 }, // newest
        { name: "beta", mtimeMs: 1000 }, // oldest
        { name: "gamma", mtimeMs: 2000 },
      ],
    });
    // Every pool name is archived, none active — pure tier 2 ordering.
    expect(result[0]).toBe("beta");
    expect(result[1]).toBe("gamma");
    expect(result[2]).toBe("alpha");
  });

  it("Test 4: all names currently active — tier 3 (full-pool shuffle) is the safety valve", () => {
    // When every pool name is active, tiers 1 and 2 are empty. Tier 3 (full
    // shuffled pool) is what saves the never-5xx contract — an active name
    // gets returned, birth-time gate rejects it downstream.
    pinRandomToZero();
    const result = rankPoolCandidates({
      pool: ["A", "B", "C"],
      activeNames: new Set(["a", "b", "c"]),
      archivedEntries: [],
    });
    expect(new Set(result)).toEqual(new Set(["a", "b", "c"]));
    expect(result).toHaveLength(3);
  });

  it("Test 5: archived name no longer in pool — silently ignored, does not surface", () => {
    // Simulate a name that was archived but has since been removed from the
    // pool (e.g., we dropped Dagda in the pool commit; if Dagda-folder still
    // exists in the archive, we do NOT want to recycle it as a tier-2 pick).
    const result = rankPoolCandidates({
      pool: ["Aster", "Willow"],
      activeNames: new Set(),
      archivedEntries: [
        { name: "dagda", mtimeMs: 1000 }, // NOT in pool
        { name: "aster", mtimeMs: 2000 }, // in pool
      ],
    });
    // dagda must never appear in the output.
    expect(result).not.toContain("dagda");
    // aster is archived AND in pool AND not active — that goes to tier 2.
    // willow is fresh — tier 1.
    // Tier 1 = [willow], Tier 2 = [aster], expected order: [willow, aster]
    expect(result[0]).toBe("willow");
    expect(result[1]).toBe("aster");
  });

  it("Test 6: empty pool — returns empty list (caller surfaces pool_exhausted)", () => {
    const result = rankPoolCandidates({
      pool: [],
      activeNames: new Set(),
      archivedEntries: [],
    });
    expect(result).toEqual([]);
  });

  it("Test 7: tier-2 ordering is deterministic (same input → same order)", () => {
    // Two calls with identical inputs must produce identical tier-2 slices.
    // (Tier 1 shuffling can differ; here we make tier 1 empty so tier 2
    // dominates.)
    const input = {
      pool: ["Ember", "Frost", "Glade"],
      activeNames: new Set<string>(),
      archivedEntries: [
        { name: "glade", mtimeMs: 100 },
        { name: "ember", mtimeMs: 300 },
        { name: "frost", mtimeMs: 200 },
      ] satisfies ArchivedEntryInput[],
    };
    const first = rankPoolCandidates(input);
    const second = rankPoolCandidates(input);
    expect(first).toEqual(second);
    expect(first[0]).toBe("glade"); // oldest
    expect(first[1]).toBe("frost");
    expect(first[2]).toBe("ember"); // newest
  });

  it("Test 8: tie-break on identical mtimes uses name locale order (total determinism)", () => {
    // Two archives with identical mtime — no natural ordering; use name to
    // guarantee the same order every time.
    const result = rankPoolCandidates({
      pool: ["Zeta", "Alpha", "Mu"],
      activeNames: new Set(),
      archivedEntries: [
        { name: "zeta", mtimeMs: 500 },
        { name: "alpha", mtimeMs: 500 },
        { name: "mu", mtimeMs: 500 },
      ],
    });
    // All tie on mtime → sort by name ascending: alpha, mu, zeta.
    expect(result).toEqual(["alpha", "mu", "zeta"]);
  });

  it("Test 9: pool with PascalCase input yields lowercase output", () => {
    const result = rankPoolCandidates({
      pool: ["ArcaDia", "MOONSTONE"],
      activeNames: new Set(),
      archivedEntries: [],
    });
    for (const name of result) {
      expect(name).toBe(name.toLowerCase());
    }
    expect(new Set(result)).toEqual(new Set(["arcadia", "moonstone"]));
  });

  it("Test 10: active name in archived list — treated as active, not recycled", () => {
    // An identity with the same name is both currently active AND was
    // previously archived under that name. The active set wins — the name
    // is NOT surfaced as a tier-2 recycle candidate.
    const result = rankPoolCandidates({
      pool: ["Kestrel"],
      activeNames: new Set(["kestrel"]),
      archivedEntries: [{ name: "kestrel", mtimeMs: 100 }],
    });
    // Tier 1 = empty (kestrel is archived), Tier 2 = empty (kestrel is
    // active), Tier 3 = full pool shuffled = [kestrel] — safety valve returns
    // the active name; birth-time gate catches it.
    expect(result).toEqual(["kestrel"]);
  });

  it("Test 11: enumeration-failed degradation — empty active + empty archive gives full-pool shuffle", () => {
    // When both enumerations fail, callers pass empty inputs. The ranker
    // treats every name as fresh (tier 1). Result: shuffled full pool.
    pinRandomToZero();
    const pool = ["A", "B", "C", "D"];
    const result = rankPoolCandidates({
      pool,
      activeNames: new Set(),
      archivedEntries: [],
    });
    // All pool names present, none dropped.
    expect(new Set(result)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(result).toHaveLength(4);
  });

  it("Test 12: partial degradation (active known, archive empty) — every non-active name looks fresh", () => {
    // Archive enumeration failed → archivedEntries is empty. Active known.
    // Result: names not in active are all tier-1 (fresh); no tier-2.
    const result = rankPoolCandidates({
      pool: ["Ember", "Frost", "Glade"],
      activeNames: new Set(["ember"]),
      archivedEntries: [],
    });
    // Tier 1 = [frost, glade] shuffled; Tier 3 will include ember.
    // ember must NOT be the head (tier 1 comes first).
    expect(new Set(result.slice(0, 2))).toEqual(new Set(["frost", "glade"]));
    expect(result[2]).toBe("ember"); // ember arrives only via tier 3
  });

  it("Test 13: partial degradation (active empty, archive known) — no active means every archive is a tier-2 candidate", () => {
    // Active enumeration failed → activeNames is empty. Archive known.
    // Names in archive still go to tier 2 (oldest-first); rest to tier 1.
    const result = rankPoolCandidates({
      pool: ["Ember", "Frost", "Glade"],
      activeNames: new Set(),
      archivedEntries: [
        { name: "frost", mtimeMs: 100 },
        { name: "glade", mtimeMs: 200 },
      ],
    });
    // Tier 1 = [ember]; Tier 2 = [frost, glade] (oldest first).
    expect(result[0]).toBe("ember");
    expect(result[1]).toBe("frost");
    expect(result[2]).toBe("glade");
  });

  it("Test 14: pool duplicates are collapsed case-insensitively", () => {
    const result = rankPoolCandidates({
      pool: ["Aster", "aster", "ASTER", "Willow"],
      activeNames: new Set(),
      archivedEntries: [],
    });
    expect(result).toHaveLength(2);
    expect(new Set(result)).toEqual(new Set(["aster", "willow"]));
  });
});
