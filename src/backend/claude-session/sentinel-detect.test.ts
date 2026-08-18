/**
 * Unit tests for the sentinel-present recycle detector — the third arm
 * signal for SessionHoldingOverlay alongside Layer 1 (/id reset in JSONL)
 * and Layer 2 (discovery-repoll session-file diff).
 *
 * Bounty: session-holding-overlay-arm-on-recycle-sentinel (2026-08-18).
 *
 * Helpers are pure — no I/O, no imports from ssh2 / WebSocket / logger.
 * The integration seam __applySentinelCheckForTests exercises the full
 * probe → reducer → transitionToHolding path with injected helpers, so
 * production wiring cannot silently drift from tests.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildSentinelCheckCommand,
  isSentinelPresent,
  decideSentinelAction,
  __applySentinelCheckForTests,
} from "./sentinel-detect.js";

describe("buildSentinelCheckCommand", () => {
  it("returns a test -f command with `yes`/`no` output for the identity's .recycle-requested path", () => {
    const cmd = buildSentinelCheckCommand("tina");
    expect(cmd).toContain("test -f");
    expect(cmd).toContain("~/.claude/identities/'tina'/.recycle-requested");
    expect(cmd).toContain("echo yes");
    expect(cmd).toContain("echo no");
  });

  it("single-quote wraps the identity name", () => {
    // Callers are expected to pre-validate the name to a shell-safe subset
    // (tmux-safe subset, alphanumeric + dash + underscore) — this test just
    // documents the quoting contract so a future refactor doesn't drop it.
    const cmd = buildSentinelCheckCommand("tiffany");
    expect(cmd).toContain("'tiffany'");
  });
});

describe("isSentinelPresent", () => {
  it("true on 'yes'", () => {
    expect(isSentinelPresent("yes")).toBe(true);
  });

  it("true on 'yes\\n' (trailing newline from ssh exec)", () => {
    expect(isSentinelPresent("yes\n")).toBe(true);
  });

  it("true on '  yes  ' (surrounding whitespace)", () => {
    expect(isSentinelPresent("  yes  ")).toBe(true);
  });

  it("false on 'no'", () => {
    expect(isSentinelPresent("no")).toBe(false);
  });

  it("false on empty output (SSH failure)", () => {
    expect(isSentinelPresent("")).toBe(false);
  });

  it("false on garbage (never spuriously arms)", () => {
    expect(isSentinelPresent("something else entirely")).toBe(false);
  });
});

describe("decideSentinelAction", () => {
  it("sentinel present + active → arm_holding", () => {
    expect(decideSentinelAction(true, "active")).toBe("arm_holding");
  });

  it("sentinel present + holding → none (already armed)", () => {
    expect(decideSentinelAction(true, "holding")).toBe("none");
  });

  it("sentinel present + dead → none (terminal)", () => {
    expect(decideSentinelAction(true, "dead")).toBe("none");
  });

  it("sentinel absent + active → none", () => {
    expect(decideSentinelAction(false, "active")).toBe("none");
  });

  it("sentinel absent + holding → none (do NOT clear on disappearance — transitionToActiveNew owns the clear path)", () => {
    expect(decideSentinelAction(false, "holding")).toBe("none");
  });
});

describe("__applySentinelCheckForTests", () => {
  it("Case A: active + probe returns 'yes' → transitionToHolding('sentinel') called", async () => {
    const transitionToHolding = vi.fn();
    const execCommand = vi.fn().mockResolvedValueOnce("yes\n");
    const state = { changeoverState: "active" as const };

    await __applySentinelCheckForTests(
      { connSnapshot: {}, identityName: "tina", execCommand },
      state,
      { transitionToHolding },
    );

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(transitionToHolding).toHaveBeenCalledTimes(1);
    expect(transitionToHolding).toHaveBeenCalledWith("sentinel");
  });

  it("Case B: active + probe returns 'no' → transitionToHolding NOT called", async () => {
    const transitionToHolding = vi.fn();
    const execCommand = vi.fn().mockResolvedValueOnce("no\n");
    const state = { changeoverState: "active" as const };

    await __applySentinelCheckForTests(
      { connSnapshot: {}, identityName: "tina", execCommand },
      state,
      { transitionToHolding },
    );

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(transitionToHolding).not.toHaveBeenCalled();
  });

  it("Case C: holding + probe skipped entirely (no exec, saves round-trip)", async () => {
    const transitionToHolding = vi.fn();
    const execCommand = vi.fn();
    const state = { changeoverState: "holding" as const };

    await __applySentinelCheckForTests(
      { connSnapshot: {}, identityName: "tina", execCommand },
      state,
      { transitionToHolding },
    );

    expect(execCommand).not.toHaveBeenCalled();
    expect(transitionToHolding).not.toHaveBeenCalled();
  });

  it("Case D: dead + probe skipped entirely", async () => {
    const transitionToHolding = vi.fn();
    const execCommand = vi.fn();
    const state = { changeoverState: "dead" as const };

    await __applySentinelCheckForTests(
      { connSnapshot: {}, identityName: "tina", execCommand },
      state,
      { transitionToHolding },
    );

    expect(execCommand).not.toHaveBeenCalled();
    expect(transitionToHolding).not.toHaveBeenCalled();
  });

  it("Case E: active + SSH error → caught silently, no arm, no throw", async () => {
    const transitionToHolding = vi.fn();
    const execCommand = vi.fn().mockRejectedValueOnce(new Error("ssh broken"));
    const state = { changeoverState: "active" as const };

    await expect(
      __applySentinelCheckForTests(
        { connSnapshot: {}, identityName: "tina", execCommand },
        state,
        { transitionToHolding },
      ),
    ).resolves.toBeUndefined();

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(transitionToHolding).not.toHaveBeenCalled();
  });

  it("Case F: active + garbage output → treated as absent, no arm", async () => {
    const transitionToHolding = vi.fn();
    const execCommand = vi.fn().mockResolvedValueOnce("something unexpected");
    const state = { changeoverState: "active" as const };

    await __applySentinelCheckForTests(
      { connSnapshot: {}, identityName: "tina", execCommand },
      state,
      { transitionToHolding },
    );

    expect(transitionToHolding).not.toHaveBeenCalled();
  });
});
