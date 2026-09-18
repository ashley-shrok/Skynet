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
  it("Test 1: contains exactly 53 entries (17 conceptual items + agent-supervisor.service unit + role-file-watch fourth ambient monitor + fleet-status-sweep Phase 92 + pv-context-pct-sweep Phase 95 + ambient-monitor mega-monitor phase + instance-policy-claude-md Phase 114 twinkie + image-gen-skill + image-gen-helper Phase 116 + 26 app-development shape-1 rows + task-field-check hook)", () => {
    // 17 = 6 single-file skills + agent-relay (SKILL.md + recv.sh counted as
    // one item) + id (SKILL.md + 3 companions counted as one item) + 8 helper
    // scripts + 1 mega-monitor launcher (ambient-monitor) + 1 Phase 114 twinkie
    // (instance-policy-claude-md). Per-FILE row layout is required by the
    // byte-compare mechanism in Plan 03, so the array has 12 skill-side rows
    // + 10 scripts-side rows + 1 user-onboarding row (agent-supervisor.service)
    // + 1 Phase 114 twinkie row + 26 app-development rows.
    // role-file-watch is the 7th helper script (fourth ambient monitor alongside
    // wakeup-scheduler and context-watch). fleet-status-sweep is the 8th helper
    // script (Phase 92 batch sweep for the fleet-status poller).
    // pv-context-pct-sweep is the 9th helper script (Phase 95 batch sweep for the
    // PrettyView context-pct poller). ambient-monitor is the 10th — the single
    // on-wake launcher that spawns the four ambient watchers under one Monitor
    // instead of four (mega-monitor phase).
    // instance-policy-claude-md is a runtime-sourced Phase 114 twinkie row —
    // bytes come from readInstancePolicyBytes() at sweep time, not from
    // /app/fleet-substrate/ — AND the first system-root-installed row
    // (writes to /etc/claude-code/CLAUDE.md as root:root 0644, gated on
    // hosts.username === "root" per Plan 05 D-13).
    // Phase 116 (image-gen) adds 2 rows: SKILL.md + a helper script.
    // The first-class-apps campaign (shape 1, 2026-09-17) adds a new skill
    // folder with SKILL.md + 5 helper scripts (bootstrap/create/archive/
    // restore/backup) + a 20-file starter template (17 source files + 3
    // files for the pre-generated initial Drizzle migration: the SQL, a
    // journal, and a snapshot) for the Bun + SvelteKit + Tailwind + Drizzle
    // + SQLite stack — 26 rows all landing under
    // ~/.claude/skills/app-development/ on managed boxes.
    // task-field-check adds 1 helper script (UserPromptSubmit hook for
    // the id-skill task: field nag).
    expect(FLEET_SUBSTRATE_CATALOG.length).toBe(53);
  });

  it("Test 2: every bundled row's bundledPath starts with /app/fleet-substrate/skills/, /app/fleet-substrate/scripts/, or /app/fleet-substrate/user-onboarding/", () => {
    // Post Phase 114 D-12: only BundledCatalogEntry carries `bundledPath`;
    // runtime rows (sourceKind: "runtime") resolve their bytes at sweep time
    // via a resolverKey lookup and don't have this field. Narrow first.
    const bundled = FLEET_SUBSTRATE_CATALOG.filter(
      (e) => e.sourceKind === "bundled",
    );
    for (const entry of bundled) {
      const ok =
        entry.bundledPath.startsWith("/app/fleet-substrate/skills/") ||
        entry.bundledPath.startsWith("/app/fleet-substrate/scripts/") ||
        entry.bundledPath.startsWith("/app/fleet-substrate/user-onboarding/");
      expect(ok, `bad bundledPath: ${entry.bundledPath}`).toBe(true);
    }
  });

  it("Test 3: installPath prefix invariant split by installMode (Phase 114 D-14)", () => {
    // Prior to Phase 114 every row had a `~/`-relative installPath. Phase 114
    // introduces the `installMode: "system-root"` axis: rows so-marked write
    // to absolute paths under /etc/ instead. Split the invariant accordingly:
    //   - user-home rows (default) → installPath must start with ~/.claude/skills/,
    //     ~/.local/bin/, or ~/.config/systemd/user/ (existing invariant).
    //   - system-root rows → installPath must start with /etc/ AND match the
    //     exact D-14 value /etc/claude-code/CLAUDE.md. There is exactly one
    //     such row today; if a future contributor adds a second system-root
    //     row without updating this test, the exact-match assertion fires as
    //     a regression guard.
    for (const entry of FLEET_SUBSTRATE_CATALOG) {
      const installMode =
        "installMode" in entry ? entry.installMode : undefined;
      if (installMode === "system-root") {
        expect(
          entry.installPath.startsWith("/etc/"),
          `system-root installPath must start with /etc/: ${entry.installPath}`,
        ).toBe(true);
        expect(
          entry.installPath,
          `system-root installPath must match D-14 exact value`,
        ).toBe("/etc/claude-code/CLAUDE.md");
      } else {
        const ok =
          entry.installPath.startsWith("~/.claude/skills/") ||
          entry.installPath.startsWith("~/.local/bin/") ||
          entry.installPath.startsWith("~/.config/systemd/user/");
        expect(ok, `bad installPath: ${entry.installPath}`).toBe(true);
      }
    }
  });

  it("Test 4: exactly two entries have non-null restartHooks — agent-supervisor binary + .service unit", () => {
    const withRestart = FLEET_SUBSTRATE_CATALOG.filter(
      (e: CatalogEntry) => e.restartHook !== null,
    );
    expect(withRestart.length).toBe(2);
    // Both fire the same unit name (agent-supervisor.service).
    for (const entry of withRestart) {
      expect(entry.restartHook).toBe("agent-supervisor.service");
    }
    // One is the binary, one is the unit file.
    const slugs = withRestart.map((e) => e.slug).sort();
    expect(slugs).toEqual([
      "agent-supervisor",
      "agent-supervisor-service-unit",
    ]);
  });

  it("Test 5: every slug is unique", () => {
    const slugs = FLEET_SUBSTRATE_CATALOG.map((e) => e.slug);
    const uniq = new Set(slugs);
    expect(uniq.size).toBe(slugs.length);
  });

  it("Test 6: skill-side + scripts-side + user-onboarding partitioning matches the shape doc enumeration", () => {
    // Post Phase 114 D-12: partition by bundledPath applies only to
    // BundledCatalogEntry rows; the twinkie row (sourceKind: "runtime")
    // has no bundledPath and is enumerated separately by Test T-07.
    const bundledOnly = FLEET_SUBSTRATE_CATALOG.filter(
      (e) => e.sourceKind === "bundled",
    );
    const skillRows = bundledOnly.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/skills/"),
    );
    const scriptRows = bundledOnly.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/scripts/"),
    );
    const userOnboardingRows = bundledOnly.filter((e) =>
      e.bundledPath.startsWith("/app/fleet-substrate/user-onboarding/"),
    );

    // 39 skill-side files: 4 under id/ + 2 under agent-relay/ + 6 single-file
    // skills + 1 image-gen (Phase 116) + 26 under app-development/ (SKILL.md +
    // 5 helpers + 20 template files including the 3-file pre-generated initial
    // Drizzle migration, first-class-apps shape 1)
    expect(skillRows.length).toBe(39);
    // 12 helper scripts: agent-supervisor + wakeup-scheduler + context-watch +
    // role-file-watch (4th ambient monitor) + usage-reporter + install-usage-reporter +
    // claude-usage-collector + fleet-status-sweep (Phase 92 batch sweep) +
    // pv-context-pct-sweep (Phase 95 PrettyView context-pct batch sweep) +
    // ambient-monitor (mega-monitor phase, single on-wake launcher) +
    // image-gen (Phase 116 file-drop broker helper) +
    // task-field-check (UserPromptSubmit hook for id skill task: field nag)
    expect(scriptRows.length).toBe(12);
    // 1 user-onboarding file: agent-supervisor.service
    expect(userOnboardingRows.length).toBe(1);

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

    // Six single-file skills each contribute one entry.
    const singleFileSkillSlugs = [
      "backlog",
      "bounty",
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

    // All 10 scripts land under ~/.local/bin/
    for (const row of scriptRows) {
      expect(row.installPath.startsWith("~/.local/bin/")).toBe(true);
    }

    // The 1 user-onboarding file lands under ~/.config/systemd/user/
    for (const row of userOnboardingRows) {
      expect(row.installPath.startsWith("~/.config/systemd/user/")).toBe(true);
    }
  });

  it("Test 8: agent-supervisor-service-unit entry has correct bundledPath and installPath", () => {
    const entry = FLEET_SUBSTRATE_CATALOG.find(
      (e) => e.slug === "agent-supervisor-service-unit",
    );
    expect(
      entry,
      "agent-supervisor-service-unit entry not found in catalog",
    ).toBeDefined();
    expect(entry!.bundledPath).toBe(
      "/app/fleet-substrate/user-onboarding/agent-supervisor.service",
    );
    expect(entry!.installPath).toBe(
      "~/.config/systemd/user/agent-supervisor.service",
    );
    expect(entry!.restartHook).toBe("agent-supervisor.service");
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

  it("Test T-07: sourceKind discriminant — 52 bundled + 1 runtime row (Phase 114 D-22 + Phase 116 additions + task-field-check + 26 app-development rows)", () => {
    // Regression guard for Phase 114 D-12 + D-14: the catalog is a
    // discriminated union on sourceKind. Phase 116 added 2 bundled rows
    // (image-gen-skill + image-gen-helper); task-field-check adds one more
    // bundled row (UserPromptSubmit hook); first-class-apps shape 1 adds 26
    // bundled rows (app-development skill + helpers + starter template).
    // Runtime row (twinkie) unchanged at 1.
    const bundled = FLEET_SUBSTRATE_CATALOG.filter(
      (e) => e.sourceKind === "bundled",
    );
    const runtime = FLEET_SUBSTRATE_CATALOG.filter(
      (e) => e.sourceKind === "runtime",
    );
    expect(bundled.length).toBe(52);
    expect(runtime.length).toBe(1);

    // Every bundled row retains bundledPath under /app/fleet-substrate/
    // (byte-identity of the pre-Phase-112 shape).
    for (const e of bundled) {
      expect(typeof e.bundledPath).toBe("string");
      expect(e.bundledPath.startsWith("/app/fleet-substrate/")).toBe(true);
    }

    // The single runtime row is exactly the twinkie per D-14. The cast
    // to a resolverKey-carrying shape is safe: sourceKind === "runtime"
    // narrows RuntimeCatalogEntry which has this field, but we spell out
    // the shape for readers not tracking the discriminated-union type.
    expect(runtime[0].slug).toBe("instance-policy-claude-md");
    expect(runtime[0].installPath).toBe("/etc/claude-code/CLAUDE.md");
    expect(runtime[0].installMode).toBe("system-root");
    expect(
      (runtime[0] as { resolverKey: string }).resolverKey,
    ).toBe("instance-policy");
    expect(runtime[0].restartHook).toBeNull();
  });
});
