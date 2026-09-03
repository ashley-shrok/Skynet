/**
 * quick-260806-dwe: Tests for startHarnessOnIdentity — the extracted birth
 * steps 3-5 body (trust-flag pre-write, claude launch, 2s sleep, 7-Enter
 * train, /id <name> + Enter). Verifies the helper fires the exact 11-command
 * tmux sequence in the exact order with the exact timing so that both birth
 * and clone use the same source of truth for post-tmux harness startup.
 *
 * Test coverage (A-I from PLAN.md Task 1 <behavior>):
 *   A: FIRST exec call is the trust-flag node one-liner
 *   B: SECOND exec call is `tmux send-keys -t <name> -l '<claude launch>'`
 *      with both CLAUDE_CODE_RESUME_* env-vars + --dangerously-skip-permissions
 *   C: THIRD exec call is `tmux send-keys -t <name> Enter` (no -l flag)
 *   D: Between launch-Enter (#3) and the /id call there are EXACTLY 7 more
 *      `tmux send-keys -t <name> Enter` calls (total non-literal Enters = 8:
 *      1 post-launch + 7 train).
 *   E: SECOND-TO-LAST call is `tmux send-keys -t <name> -l '/id <name>'`.
 *   F: LAST call is `tmux send-keys -t <name> Enter`.
 *   G: Timing — helper needs at least 2000ms (STEP_3_SLEEP_MS) after the
 *      launch-Enter before continuing; 1999ms is not enough.
 *   H: remotePath is shellSingleQuote-escaped in the trust-flag command
 *      trailing argv.
 *   I: name is shell-escaped in the /id payload (`'/id <name>'`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLAUDE_LAUNCH_CMD_PREFIX,
  STEP_3_SLEEP_MS,
  ENTER_TRAIN_COUNT,
  ENTER_TRAIN_SPACING_MS,
} from "./identity-birth-orchestrator.js";
import { startHarnessOnIdentity } from "./identity-harness-start.js";

// ---------------------------------------------------------------------------
// Setup / teardown — mirrors identity-birth-orchestrator.test.ts pattern.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Import-time constant sanity — proves the helper's timing/count constants
// are IMPORTED from identity-birth-orchestrator (source of truth for the
// Nelly-tuned values), not duplicated in the helper module.
// ---------------------------------------------------------------------------

describe("harness-start constants (imported from birth-orchestrator)", () => {
  it("ENTER_TRAIN_COUNT is 7", () => {
    expect(ENTER_TRAIN_COUNT).toBe(7);
  });
  it("ENTER_TRAIN_SPACING_MS is 3000", () => {
    expect(ENTER_TRAIN_SPACING_MS).toBe(3000);
  });
  it("STEP_3_SLEEP_MS is 2000", () => {
    expect(STEP_3_SLEEP_MS).toBe(2000);
  });
  it("CLAUDE_LAUNCH_CMD_PREFIX contains both resume env-vars", () => {
    expect(CLAUDE_LAUNCH_CMD_PREFIX).toContain(
      "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999",
    );
    expect(CLAUDE_LAUNCH_CMD_PREFIX).toContain(
      "CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999",
    );
  });
});

// ---------------------------------------------------------------------------
// Test A: FIRST exec call is the trust-flag node one-liner
// ---------------------------------------------------------------------------

describe("startHarnessOnIdentity — 11-command tmux sequence", () => {
  it("Test A: FIRST exec call is the trust-flag node one-liner ending in escaped remotePath argv", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const first = exec.mock.calls[0][0] as string;
    expect(first).toMatch(/node -e/);
    expect(first).toContain("hasTrustDialogAccepted=true");
    // The remotePath is passed as trailing argv, shell-single-quoted.
    expect(first.endsWith(" '/home/test'")).toBe(true);
  });

  it("Test B: SECOND exec call is tmux send-keys -t <name> -l with claude launch + both env-vars", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const second = exec.mock.calls[1][0] as string;
    expect(second).toContain("tmux send-keys -t test -l");
    expect(second).toContain("CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999");
    expect(second).toContain("CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999");
    expect(second).toContain("claude --model opus --dangerously-skip-permissions");
    // The launch payload is single-quoted (literal-mode for tmux send-keys)
    expect(second).toContain(`'${CLAUDE_LAUNCH_CMD_PREFIX} claude --model opus --dangerously-skip-permissions'`);
  });

  it("Test C: THIRD exec call is tmux send-keys -t <name> Enter (no -l flag)", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const third = exec.mock.calls[2][0] as string;
    expect(third).toBe("tmux send-keys -t test Enter");
    // Sanity: no -l flag on the post-launch Enter
    expect(third).not.toContain("-l");
  });

  it("Test D: EXACTLY 8 non-literal Enters fire between launch and /id (1 post-launch + 7 train)", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const allCmds = exec.mock.calls.map((c) => c[0] as string);
    // Non-literal Enter pattern: exact `tmux send-keys -t test Enter` (no -l).
    // Total across the whole sequence: 9 = 1 post-launch + 7 train + 1 final
    // /id-dispatch Enter. The plan's assertion window is "between launch-Enter
    // (call #3) and the /id call" — that window contains exactly 8 non-literal
    // Enters (the post-launch Enter itself is call #3, followed by the 7-Enter
    // train). The final Enter after /id (call #11) is asserted separately by
    // Test F.
    const idCallIdx = allCmds.findIndex((c) => c.includes("/id test"));
    expect(idCallIdx).toBeGreaterThan(0);

    // Window: from call #2 (post-launch Enter) through the call BEFORE /id.
    const window = allCmds.slice(2, idCallIdx);
    const nonLiteralEntersInWindow = window.filter(
      (cmd) => /^tmux send-keys -t test Enter$/.test(cmd),
    );
    expect(nonLiteralEntersInWindow.length).toBe(1 + ENTER_TRAIN_COUNT);
    expect(nonLiteralEntersInWindow.length).toBe(8);

    // Sanity: whole-sequence total = 9 (window's 8 + 1 final).
    const totalNonLiteralEnters = allCmds.filter(
      (cmd) => /^tmux send-keys -t test Enter$/.test(cmd),
    );
    expect(totalNonLiteralEnters.length).toBe(9);
  });

  it("Test E: SECOND-TO-LAST exec call is tmux send-keys -t <name> -l '/id <name>'", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const calls = exec.mock.calls.map((c) => c[0] as string);
    const secondToLast = calls[calls.length - 2];
    expect(secondToLast).toBe("tmux send-keys -t test -l '/id test'");
  });

  it("Test F: LAST exec call is tmux send-keys -t <name> Enter", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const calls = exec.mock.calls.map((c) => c[0] as string);
    const last = calls[calls.length - 1];
    expect(last).toBe("tmux send-keys -t test Enter");
  });

  it("Test G: helper does NOT resolve after only 1999ms of virtual time (STEP_3_SLEEP_MS gate)", async () => {
    // We stall the exec at the FIRST train-Enter (call index 3 = post-launch Enter
    // isn't counted here since we look for the enter-loop kicking in AFTER the
    // 2s sleep). The specific sentinel: if we only advance 1999ms after step 2's
    // post-launch Enter fires, the loop's first iteration should NOT have run.

    // Track how many Enter train calls have fired.
    const execCallLog: string[] = [];
    const exec = vi.fn().mockImplementation(async (cmd: string) => {
      execCallLog.push(cmd);
      return "";
    });

    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });

    // Let the first 3 exec calls fire (trust-flag, launch, post-launch Enter).
    // They are synchronous mock resolves so they complete once microtasks flush.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Advance 1999ms — NOT enough to trip STEP_3_SLEEP_MS (2000ms).
    await vi.advanceTimersByTimeAsync(1999);
    const callsAt1999 = execCallLog.length;
    // Only 3 calls should have fired so far (trust, launch, post-launch Enter).
    // The Enter train is still gated behind the STEP_3_SLEEP_MS sleep.
    expect(callsAt1999).toBe(3);

    // Advance the remaining 1ms — sleep unblocks + train fires first Enter.
    await vi.advanceTimersByTimeAsync(1);
    // At this point at least the first train Enter should have fired.
    expect(execCallLog.length).toBeGreaterThan(callsAt1999);

    // Drain remaining timers + resolve.
    await vi.runAllTimersAsync();
    await p;
  });

  it("Test H: remotePath with single quote is shell-escaped in the trust-flag command", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/user's dir",
    });
    await vi.runAllTimersAsync();
    await p;

    const first = exec.mock.calls[0][0] as string;
    // POSIX single-quote escape: "'" → "'\''"
    // "/home/user's dir" → "'/home/user'\''s dir'"
    expect(first.endsWith(" '/home/user'\\''s dir'")).toBe(true);
  });

  it("Test I: name is single-quoted inside the /id payload literal", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const p = startHarnessOnIdentity({
      exec,
      name: "test",
      remotePath: "/home/test",
    });
    await vi.runAllTimersAsync();
    await p;

    const calls = exec.mock.calls.map((c) => c[0] as string);
    const idCall = calls.find((c) => c.includes("/id test"));
    expect(idCall).toBeDefined();
    // The literal-mode send-keys wraps the payload in single quotes: '/id test'
    expect(idCall!).toContain("'/id test'");
  });
});
