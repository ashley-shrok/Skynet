/**
 * catalog.test.ts — Structural assertions on the fleet-substrate catalog.
 *
 * These tests verify the shape and invariants of FLEET_SUBSTRATE_CATALOG. They
 * are pure structural checks (no SSH, no orchestrator wiring, no DB) — the
 * catalog is a hand-maintained data module and the tests enforce that the
 * hand-maintenance stays honest.
 *
 * See .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md for
 * the shape source of truth these assertions derive from.
 */
import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  FLEET_SUBSTRATE_CATALOG,
  type CatalogEntry,
} from "./catalog.js";

// Repo root for Test 7 (executable-bit sanity check). The test file lives at
// src/backend/distributor/catalog.test.ts; four levels up is the repo root.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/**
 * Convert a bundled container path (e.g. "/app/fleet-substrate/scripts/foo.sh")
 * to the corresponding on-disk repo path ("<repoRoot>/substrate/scripts/foo.sh").
 * Used only by Test 7 to read the mode bits from the checked-in bundled file.
 */
function bundledPathToRepoPath(bundledPath: string): string {
  const rel = bundledPath.replace(/^\/app\/fleet-substrate\//, "substrate/");
  return resolve(REPO_ROOT, rel);
}

describe("FLEET_SUBSTRATE_CATALOG", () => {
  it("Test 1: contains exactly 19 entries (15 conceptual items across 19 files)", () => {
    // 15 = 7 single-file skills + agent-relay (SKILL.md + recv.sh counted as
    // one item) + id (SKILL.md + 3 companions counted as one item) + 6 helper
    // scripts. Per-FILE row layout is required by the byte-compare mechanism
    // in Plan 03, so the array has 13 skill-side rows + 6 scripts-side rows.
    expect(FLEET_SUBSTRATE_CATALOG.length).toBe(19);
  });

  it("Test 2: every bundledPath starts with /app/fleet-substrate/skills/ or /app/fleet-substrate/scripts/", () => {
    for (const entry of FLEET_SUBSTRATE_CATALOG) {
      const ok =
        entry.bundledPath.startsWith("/app/fleet-substrate/skills/") ||
        entry.bundledPath.startsWith("/app/fleet-substrate/scripts/");
      expect(ok, `bad bundledPath: ${entry.bundledPath}`).toBe(true);
    }
  });

  it("Test 3: every installPath starts with ~/.claude/skills/ or ~/.local/bin/", () => {
    for (const entry of FLEET_SUBSTRATE_CATALOG) {
      const ok =
        entry.installPath.startsWith("~/.claude/skills/") ||
        entry.installPath.startsWith("~/.local/bin/");
      expect(ok, `bad installPath: ${entry.installPath}`).toBe(true);
    }
  });

  it("Test 4: exactly one entry has a non-null restartHook, and it is the agent-supervisor entry", () => {
    const withRestart = FLEET_SUBSTRATE_CATALOG.filter(
      (e: CatalogEntry) => e.restartHook !== null,
    );
    expect(withRestart.length).toBe(1);
    expect(withRestart[0].restartHook).toBe("agent-supervisor.service");
    expect(withRestart[0].installPath).toBe("~/.local/bin/agent-supervisor");
  });

  it("Test 5: every slug is unique", () => {
    const slugs = FLEET_SUBSTRATE_CATALOG.map((e) => e.slug);
    const uniq = new Set(slugs);
    expect(uniq.size).toBe(slugs.length);
  });

  it("Test 6: skill-side + scripts-side partitioning matches the shape doc enumeration", () => {
    const skillRows = FLEET_SUBSTRATE_CATALOG.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/skills/"),
    );
    const scriptRows = FLEET_SUBSTRATE_CATALOG.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/scripts/"),
    );

    // 13 skill-side files: 4 under id/ + 2 under agent-relay/ + 7 single-file skills
    expect(skillRows.length).toBe(13);
    expect(scriptRows.length).toBe(6);

    // id has 4 entries (SKILL.md + 3 companions)
    const idRows = skillRows.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/skills/id/"),
    );
    expect(idRows.length).toBe(4);

    // agent-relay has 2 entries (SKILL.md + recv.sh)
    const agentRelayRows = skillRows.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/skills/agent-relay/"),
    );
    expect(agentRelayRows.length).toBe(2);

    // Seven single-file skills each contribute one entry.
    const singleFileSkillSlugs = [
      "backlog",
      "bounty",
      "claude-code-harness-auth",
      "next-bounty",
      "promote-to-coordinator",
      "queue",
      "role",
    ];
    for (const slug of singleFileSkillSlugs) {
      const rows = skillRows.filter((e) =>
        e.bundledPath.startsWith(`/app/fleet-substrate/skills/${slug}/`),
      );
      expect(rows.length, `expected 1 row for skill ${slug}`).toBe(1);
      expect(rows[0].bundledPath).toBe(
        `/app/fleet-substrate/skills/${slug}/SKILL.md`,
      );
    }

    // All 6 scripts land under ~/.local/bin/
    for (const row of scriptRows) {
      expect(row.installPath.startsWith("~/.local/bin/")).toBe(true);
    }
  });

  // Test 7 is a sanity check against the developer's on-disk substrate/ tree.
  // It confirms that every ~/.local/bin/ item's bundled sibling is chmod +x
  // (any exec bit set — owner, group, or other). Skipped automatically if
  // substrate/ is not present (which is the case in the container image where
  // the source tree isn't shipped alongside the compiled JS).
  const substrateRootAvailable = existsSync(
    resolve(REPO_ROOT, "substrate", "scripts"),
  );
  const runOrSkip = substrateRootAvailable ? it : it.skip;
  runOrSkip(
    "Test 7: every ~/.local/bin/ entry's bundled file has the executable bit set on disk",
    () => {
      const scriptEntries = FLEET_SUBSTRATE_CATALOG.filter((e) =>
        e.installPath.startsWith("~/.local/bin/"),
      );
      expect(scriptEntries.length).toBeGreaterThan(0);
      for (const entry of scriptEntries) {
        const repoPath = bundledPathToRepoPath(entry.bundledPath);
        const st = statSync(repoPath);
        // Any exec bit: owner (0o100), group (0o010), or other (0o001).
        const hasExec = (st.mode & 0o111) !== 0;
        expect(
          hasExec,
          `${repoPath} (mode 0o${st.mode.toString(8)}) is missing exec bit`,
        ).toBe(true);
      }
    },
  );
});
