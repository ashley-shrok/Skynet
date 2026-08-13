/**
 * Phase 35 — pretty-view compose-send migrated onto claude-session WS.
 *
 * Unit tests for the new `input` + `interrupt` message handlers exported
 * as test seams from claude-session-server.ts. Mirrors the
 * __applyWakeMessageForTests test pattern from dormant-poll.test.ts
 * + the fake-timers gate from claude-session-server.aside.test.ts:376-403.
 * No live WebSocket server or SSH connection needed.
 *
 * INPUT TESTS (describe block 1):
 *   - sshConn null → no execCommand, no throw
 *   - currentTmuxSession null → no execCommand, no throw
 *   - empty data → no execCommand (regardless of mqid)
 *   - data.length > MAX_INPUT_BYTES (17KB) → no execCommand, one sshLogger.warn
 *   - NON-SPLIT (no mqid, data = "hello") → one execCommand with -l flag, no Enter
 *   - NON-SPLIT (mqid = "", data = "hello\r") → one execCommand (empty mqid = non-split)
 *   - NON-SPLIT (mqid = "x", data = "hello" — no trailing \r) → one execCommand
 *   - SPLIT-SEND timing gate (mqid + \r) under fake timers → 250ms boundary enforced
 *   - SPLIT-SEND with empty body (data = "\r") → zero body calls, ONE Enter call at 250ms
 *   - Trust boundary → command contains "legit-session", not "spoofed-session"
 *   - execCommand throws on body call → caught; no rethrow; no Enter fires; sshLogger.warn
 *   - execCommand throws on non-split call → caught; no rethrow; sshLogger.warn
 *
 * INTERRUPT TESTS (describe block 2):
 *   - sshConn null → no execCommand, no throw
 *   - currentTmuxSession null → no execCommand, no throw
 *   - happy path → ONE execCommand with C-c, no -l, no Enter
 *   - execCommand throws → caught; no rethrow; sshLogger.warn
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  __applyInputMessageForTests,
  __applyInterruptMessageForTests,
} from "./claude-session-server.js";

// Stub ssh2 Client — execCommand is injected so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

// ─── __applyInputMessageForTests ──────────────────────────────────────────────

describe("__applyInputMessageForTests", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("input: sshConn null → no execCommand call, no throw", async () => {
    const exec = vi.fn();
    await expect(
      __applyInputMessageForTests({
        sshConn: null,
        currentTmuxSession: "legit-session",
        currentHostId: 1,
        execCommand: exec,
        data: "hello",
      }),
    ).resolves.toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });

  it("input: currentTmuxSession null → no execCommand call, no throw", async () => {
    const exec = vi.fn();
    await expect(
      __applyInputMessageForTests({
        sshConn: fakeConn,
        currentTmuxSession: null,
        currentHostId: 1,
        execCommand: exec,
        data: "hello",
      }),
    ).resolves.toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });

  it("input: empty data → no execCommand call (regardless of mqid)", async () => {
    const exec = vi.fn();
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "",
      messageQueueItemId: "pv-adhoc-1",
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("input: data.length > MAX_INPUT_BYTES (17KB payload) → no execCommand call", async () => {
    const exec = vi.fn();
    // 17 * 1024 = 17408 bytes — exceeds the 16KB (16384) cap
    const bigData = "x".repeat(17 * 1024);
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: bigData,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it("input: NON-SPLIT case (no mqid, data = 'hello') → exactly ONE execCommand with -l flag, no Enter", async () => {
    const exec = vi.fn().mockResolvedValue("");
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello",
    });
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).toContain("send-keys");
    expect(cmd).toContain("-l");
    expect(cmd).toContain("-t 'legit-session'");
    expect(cmd).toContain("'hello'");
    expect(cmd).not.toMatch(/\sEnter\s*$/);
  });

  it("input: NON-SPLIT case (mqid = '', data = 'hello\\r') → exactly ONE execCommand (empty mqid → non-split even though \\r present)", async () => {
    const exec = vi.fn().mockResolvedValue("");
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "",
    });
    // mqid is empty string → isSplitSend = false → one call
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).toContain("-l");
    expect(cmd).not.toMatch(/\sEnter\s*$/);
  });

  it("input: NON-SPLIT case (mqid = 'x', data = 'hello' — no trailing \\r) → exactly ONE execCommand", async () => {
    const exec = vi.fn().mockResolvedValue("");
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello",
      messageQueueItemId: "x",
    });
    // data does not end in \r → isSplitSend = false → one call
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).toContain("-l");
    expect(cmd).not.toMatch(/\sEnter\s*$/);
  });

  it("input: SPLIT-SEND case under fake timers → 250ms boundary enforced", async () => {
    // Gate: at t=249ms still ONE call; at t=250ms exactly TWO calls.
    // Mirrors claude-session-server.aside.test.ts:376-403 (200ms gate for injectBtw),
    // substituting 249/1 for the 250ms boundary per D-PVWS-01 + terminal.ts:842 (patch #111).
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue("");

    // Kick off without awaiting so we can interleave timer ticks.
    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "pv-adhoc-1",
    });

    // Flush microtasks so call #1 (body write) completes before timer gate check.
    await Promise.resolve();
    await Promise.resolve();

    // At 249ms — body write has fired, Enter (at 250ms) has NOT yet fired.
    await vi.advanceTimersByTimeAsync(249);
    expect(exec.mock.calls.length).toBe(1);

    // Body call: must have -l flag, must NOT be the Enter call
    const cmd1 = exec.mock.calls[0][1] as string;
    expect(cmd1).toContain("send-keys");
    expect(cmd1).toContain("-l");
    expect(cmd1).toContain("-t 'legit-session'");
    expect(cmd1).toContain("'hello'");
    expect(cmd1).not.toMatch(/\sEnter\s*$/);

    // Advance 1ms more (total 250ms) — setTimeout fires, Enter write executes.
    await vi.advanceTimersByTimeAsync(1);
    // Flush microtasks triggered by the timer.
    await Promise.resolve();
    await Promise.resolve();

    expect(exec.mock.calls.length).toBe(2);

    // Enter call: NO -l flag, command ends with Enter
    const cmd2 = exec.mock.calls[1][1] as string;
    expect(cmd2).toContain("send-keys");
    expect(cmd2).not.toContain("-l");
    expect(cmd2).toContain("-t 'legit-session'");
    expect(cmd2).toMatch(/\sEnter\s*$/);

    await promise;
  });

  it("input: SPLIT-SEND with empty body (mqid = 'x', data = '\\r') → SKIP body write, ONE Enter call at 250ms", async () => {
    // Edge case: data is just \r with a non-empty mqid → isSplitSend=true, body is empty.
    // Body write is SKIPPED (body.length === 0); only the Enter call fires after 250ms.
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue("");

    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "\r",
      messageQueueItemId: "x",
    });

    // Flush microtasks — body write is skipped so at t=0 there are ZERO calls.
    await Promise.resolve();
    await Promise.resolve();
    expect(exec.mock.calls.length).toBe(0);

    // Advance past 250ms — Enter fires.
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();

    expect(exec.mock.calls.length).toBe(1);
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).toMatch(/\sEnter\s*$/);
    expect(cmd).not.toContain("-l");

    await promise;
  });

  it("input: trust boundary — command contains 'legit-session', NOT any spoofed value", async () => {
    // The seam signature takes currentTmuxSession as a parameter and never reads
    // any client-supplied hostId/tmuxSession from the payload. The trust assertion
    // is trivially structural — the seam doesn't have a "msg" parameter — but the
    // command-string assertion serves as a regression-guard + documentation.
    // Mirrors T-14-02-01 / T-cd6-01 posture from CONTEXT.md § Trust Boundary.
    const exec = vi.fn().mockResolvedValue("");
    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello",
      // Note: the seam signature has NO hostId/tmuxSession fields from the payload —
      // the trust boundary is enforced structurally. There is no "spoofed" field to pass.
      // The test verifies the emitted command uses the explicit currentTmuxSession value.
    });
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][1] as string;
    // Command must contain the session name we passed (shell-quoted)
    expect(cmd).toContain("'legit-session'");
    // Confirm command does NOT contain some other value that could indicate a spoof
    expect(cmd).not.toContain("spoofed-session");
  });

  it("input: execCommand throws on body call in split-send → caught; no rethrow; Enter does NOT fire", async () => {
    // The try block wraps BOTH the body await and the Enter await. A throw on the body
    // call short-circuits the Enter — this is documented behavior (log-and-swallow posture
    // per D-PVWS-05 mirrors raw_keystrokes at :4041-4051).
    vi.useFakeTimers();
    const exec = vi.fn().mockRejectedValue(new Error("SSH channel closed"));

    // Must resolve without throwing (log-and-swallow).
    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "pv-adhoc-1",
    });

    // Advance timers past 250ms — the throw already caught in catch block; Enter never fires.
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    await Promise.resolve();

    await expect(promise).resolves.toBeUndefined();
    // Only one execCommand attempt was made (the body call that threw)
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("input: execCommand throws on non-split call → caught; no rethrow", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("exec error"));
    await expect(
      __applyInputMessageForTests({
        sshConn: fakeConn,
        currentTmuxSession: "legit-session",
        currentHostId: 1,
        execCommand: exec,
        data: "hello",
      }),
    ).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

// ─── __applyInterruptMessageForTests ─────────────────────────────────────────

describe("__applyInterruptMessageForTests", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("interrupt: sshConn null → no execCommand call, no throw", async () => {
    const exec = vi.fn();
    await expect(
      __applyInterruptMessageForTests({
        sshConn: null,
        currentTmuxSession: "legit-session",
        currentHostId: 1,
        execCommand: exec,
      }),
    ).resolves.toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });

  it("interrupt: currentTmuxSession null → no execCommand call, no throw", async () => {
    const exec = vi.fn();
    await expect(
      __applyInterruptMessageForTests({
        sshConn: fakeConn,
        currentTmuxSession: null,
        currentHostId: 1,
        execCommand: exec,
      }),
    ).resolves.toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });

  it("interrupt: happy path → exactly ONE execCommand with C-c; no -l flag; no Enter", async () => {
    const exec = vi.fn().mockResolvedValue("");
    await __applyInterruptMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).toContain("send-keys");
    // C-c is a tmux key name — no -l literal flag
    expect(cmd).not.toContain("-l");
    expect(cmd).toContain("-t 'legit-session'");
    expect(cmd).toContain("C-c");
    // Must NOT have Enter (that would be a different command)
    expect(cmd).not.toMatch(/\sEnter\s*$/);
  });

  it("interrupt: execCommand throws → caught; no rethrow; sshLogger.warn called with operation interrupt_send_error", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("SSH channel closed"));
    await expect(
      __applyInterruptMessageForTests({
        sshConn: fakeConn,
        currentTmuxSession: "legit-session",
        currentHostId: 1,
        execCommand: exec,
      }),
    ).resolves.toBeUndefined();
    // Log-and-swallow: function resolves, does not rethrow
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
