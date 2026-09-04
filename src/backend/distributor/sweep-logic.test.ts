/**
 * sweep-logic.test.ts — Table-driven tests for the pure sweep-decision layer.
 *
 * These tests exercise every outcome branch of decideItemAction, plus the
 * two supporting pure functions (computeInstallMode, chooseRestartHook),
 * without SSH, without fs, without process, and without the logger. Plan 04
 * will wire the real transport around these decisions; this file proves the
 * decisions themselves are correct in isolation.
 *
 * See .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 * for the shape (fail-closed on transport error, byte-compare as the sole
 * push gate, bundled mode is source of truth) that these tests enforce.
 */
import { describe, it, expect } from "vitest";
import type { CatalogEntry } from "./catalog.js";
import {
  decideItemAction,
  computeInstallMode,
  chooseRestartHook,
  type ItemInputs,
  type ItemDecision,
} from "./sweep-logic.js";

const SKILL_ENTRY: CatalogEntry = {
  slug: "id-skill",
  bundledPath: "/app/fleet-substrate/skills/id/SKILL.md",
  installPath: "~/.claude/skills/id/SKILL.md",
  restartHook: null,
};

const SUPERVISOR_ENTRY: CatalogEntry = {
  slug: "agent-supervisor",
  bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
  installPath: "~/.local/bin/agent-supervisor",
  restartHook: "agent-supervisor.service",
};

describe("decideItemAction", () => {
  it("Test 1: match on skill entry (restartHook=null) → skip bytes-match", () => {
    const bytes = Buffer.from("hello");
    const inputs: ItemInputs = {
      entry: SKILL_ENTRY,
      bundledBytes: bytes,
      installedRead: { readOk: true, bytes: Buffer.from("hello") },
    };
    const decision = decideItemAction(inputs);
    expect(decision).toEqual({ action: "skip", reason: "bytes-match" });
  });

  it("Test 2: match on supervisor entry (restartHook set) → skip bytes-match, restart NOT fired", () => {
    const bytes = Buffer.from("#!/bin/bash\necho hi\n");
    const inputs: ItemInputs = {
      entry: SUPERVISOR_ENTRY,
      bundledBytes: bytes,
      installedRead: {
        readOk: true,
        bytes: Buffer.from("#!/bin/bash\necho hi\n"),
      },
    };
    const decision = decideItemAction(inputs);
    // A byte-match on the supervisor entry MUST NOT push and MUST NOT surface
    // a restart hook — that would restart the supervisor daemon for no reason.
    expect(decision).toEqual({ action: "skip", reason: "bytes-match" });
  });

  it("Test 3: mismatch on skill entry (restartHook=null) → push, no restart", () => {
    const inputs: ItemInputs = {
      entry: SKILL_ENTRY,
      bundledBytes: Buffer.from("hello"),
      installedRead: { readOk: true, bytes: Buffer.from("world") },
    };
    const decision = decideItemAction(inputs);
    expect(decision).toEqual({ action: "push", restartHookToFire: null });
  });

  it("Test 4: mismatch on supervisor entry → push, restart hook surfaced", () => {
    const inputs: ItemInputs = {
      entry: SUPERVISOR_ENTRY,
      bundledBytes: Buffer.from("new-bytes"),
      installedRead: { readOk: true, bytes: Buffer.from("old-bytes") },
    };
    const decision = decideItemAction(inputs);
    expect(decision).toEqual({
      action: "push",
      restartHookToFire: "agent-supervisor.service",
    });
  });

  it("Test 5: installed absent (ENOENT / first install) → push with entry's restart hook", () => {
    // Skill entry (no restart hook): first install still pushes but hook is null.
    const skillInputs: ItemInputs = {
      entry: SKILL_ENTRY,
      bundledBytes: Buffer.from("hello"),
      installedRead: { readOk: true, bytes: null },
    };
    expect(decideItemAction(skillInputs)).toEqual({
      action: "push",
      restartHookToFire: null,
    });

    // Supervisor entry: first install pushes AND surfaces the restart hook —
    // the daemon needs to start (or restart) to pick up the freshly-landed bytes.
    const supervisorInputs: ItemInputs = {
      entry: SUPERVISOR_ENTRY,
      bundledBytes: Buffer.from("#!/bin/bash\n"),
      installedRead: { readOk: true, bytes: null },
    };
    expect(decideItemAction(supervisorInputs)).toEqual({
      action: "push",
      restartHookToFire: "agent-supervisor.service",
    });
  });

  it("Test 6: installed-read transport error → skip (fail-closed, NEVER push)", () => {
    const inputs: ItemInputs = {
      entry: SUPERVISOR_ENTRY,
      bundledBytes: Buffer.from("bundled-bytes"),
      installedRead: { readOk: false, reason: "transport" },
    };
    const decision = decideItemAction(inputs);
    // FAIL-CLOSED invariant: when we don't know what's installed we do NOT
    // push. The shape doc's "bundled bytes reach the wrong host" and "sweep
    // hangs must not degrade the poll" concerns both point to this rule.
    expect(decision.action).toBe("skip");
    expect(decision).toEqual({
      action: "skip",
      reason: "installed-read-failed",
    });
  });

  it("Test 7: bundled-read failed (defensive, bundled is local /app/) → skip", () => {
    const inputs: ItemInputs = {
      entry: SKILL_ENTRY,
      bundledBytes: null,
      installedRead: { readOk: true, bytes: Buffer.from("anything") },
    };
    const decision = decideItemAction(inputs);
    expect(decision).toEqual({
      action: "skip",
      reason: "bundled-read-failed",
    });
  });

  it("Test 6b: installed-read 'unknown' reason also skips (all readOk:false cases fail-closed)", () => {
    const inputs: ItemInputs = {
      entry: SKILL_ENTRY,
      bundledBytes: Buffer.from("hello"),
      installedRead: { readOk: false, reason: "unknown" },
    };
    const decision = decideItemAction(inputs);
    expect(decision).toEqual({
      action: "skip",
      reason: "installed-read-failed",
    });
  });
});

describe("computeInstallMode", () => {
  it("Test 8: masks to permission bits (0o777) and preserves 0o755 / 0o644 identity", () => {
    // Pure permission bits pass through unchanged.
    expect(computeInstallMode(0o755)).toBe(0o755);
    expect(computeInstallMode(0o644)).toBe(0o644);

    // fs.statSync().mode includes S_IFREG (0o100000); mask must strip it.
    expect(computeInstallMode(0o100755)).toBe(0o755);
    expect(computeInstallMode(0o100644)).toBe(0o644);
  });
});

describe("chooseRestartHook", () => {
  it("Test 9: happy path — push decision + entry with hook returns the hook", () => {
    const decision: ItemDecision = {
      action: "push",
      restartHookToFire: "agent-supervisor.service",
    };
    expect(chooseRestartHook(decision, SUPERVISOR_ENTRY)).toBe(
      "agent-supervisor.service",
    );
  });

  it("Test 10: null cases — skip decisions and push-with-null-hook all return null", () => {
    // Any skip decision → null hook, regardless of reason.
    const skipMatch: ItemDecision = { action: "skip", reason: "bytes-match" };
    expect(chooseRestartHook(skipMatch, SUPERVISOR_ENTRY)).toBe(null);

    const skipFailed: ItemDecision = {
      action: "skip",
      reason: "installed-read-failed",
    };
    expect(chooseRestartHook(skipFailed, SUPERVISOR_ENTRY)).toBe(null);

    // Push decision but the catalog entry has no restart hook → null.
    const pushSkill: ItemDecision = {
      action: "push",
      restartHookToFire: null,
    };
    expect(chooseRestartHook(pushSkill, SKILL_ENTRY)).toBe(null);
  });
});
