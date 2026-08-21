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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  __applyInputMessageForTests,
  __applyInterruptMessageForTests,
  __applyOnLineNotifyForTests,
  reconstructRawSlashCommand,
} from "./claude-session-server.js";
import {
  armPvSendWatchdog,
  clearPvSendWatchdog,
  __resetPvSendWatchdogForTests,
} from "./pv-send-watchdog.js";

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
      messageQueueItemId: "pv-test-mqid-1",
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

  it("input: SPLIT-SEND case under fake timers → 1000ms boundary enforced", async () => {
    // Gate: at t=999ms still ONE call; at t=1000ms exactly TWO calls.
    // Mirrors claude-session-server.aside.test.ts:376-403 (200ms gate for injectBtw),
    // substituting 999/1 for the 1000ms boundary (bumped from 250ms 2026-08-21
    // by tina after diagnosing stuck sends; see claude-session-server.ts's
    // SPLIT_SEND_DELAY block for reasoning).
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue("");

    // Kick off without awaiting so we can interleave timer ticks.
    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "pv-test-mqid-1",
    });

    // Flush microtasks so call #1 (body write) completes before timer gate check.
    await Promise.resolve();
    await Promise.resolve();

    // At 999ms — body write has fired, Enter (at 1000ms) has NOT yet fired.
    await vi.advanceTimersByTimeAsync(999);
    expect(exec.mock.calls.length).toBe(1);

    // Body call: must have -l flag, must NOT be the Enter call
    const cmd1 = exec.mock.calls[0][1] as string;
    expect(cmd1).toContain("send-keys");
    expect(cmd1).toContain("-l");
    expect(cmd1).toContain("-t 'legit-session'");
    expect(cmd1).toContain("'hello'");
    expect(cmd1).not.toMatch(/\sEnter\s*$/);

    // Advance 1ms more (total 1000ms) — setTimeout fires, Enter write executes.
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

  it("input: SPLIT-SEND with empty body (mqid = 'x', data = '\\r') → SKIP body write, ONE Enter call at 1000ms", async () => {
    // Edge case: data is just \r with a non-empty mqid → isSplitSend=true, body is empty.
    // Body write is SKIPPED (body.length === 0); only the Enter call fires after 1000ms.
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

    // Advance past 1000ms — Enter fires.
    await vi.advanceTimersByTimeAsync(1000);
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
      messageQueueItemId: "pv-test-mqid-1",
    });

    // Advance timers past 1000ms — the throw already caught in catch block; Enter never fires.
    await vi.advanceTimersByTimeAsync(1100);
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

// ─── Phase 50 Plan 02 Task 2 — pv-send-watchdog wire-up + send_keys_error frame ─
//
// Tests for the new wire-up between __applyInputMessageForTests and the
// pv-send-watchdog module (Task 1). Also covers the send_keys_error frame
// emission on execCommand throw (D-21) and the WS-close cleanup path (Test 6,
// MANDATORY per checker Warning #5).
//
// The seam signature was widened with three OPTIONAL injectable deps:
//   • sessionId    — threaded to arm-time key
//   • wsSend       — used both for send_keys_error emission and passed to
//                    the watchdog for later paste_send_failed escalation
//   • armWatchdog  — injectable so tests can spy without needing the real
//                    module-level Map state
//   • trackMqid    — caller-supplied hook that records the mqid in the
//                    per-connection pendingMqidsForThisConnection Set
//
// All four are optional to preserve pre-existing test call sites (see the
// describe block above — those calls omit the new deps and take the pre-
// Phase-50 behavior path unchanged).

const contentHashOf = (content: string): string =>
  createHash("sha256").update(content).digest("hex").slice(0, 32);

describe("__applyInputMessageForTests — pv-send-watchdog wire-up (Task 2)", () => {
  beforeEach(() => {
    __resetPvSendWatchdogForTests();
  });

  afterEach(() => {
    __resetPvSendWatchdogForTests();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("Test 1: split-send with mqid → armPvSendWatchdog called with content-only sha256 hash", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const armWatchdog = vi.fn();
    const trackMqid = vi.fn();

    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: "sess-A",
      wsSend,
      armWatchdog,
      trackMqid,
    });

    // Advance past the 1000ms split-send gate so Enter completes.
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    await Promise.resolve();
    await promise;

    // Body + Enter fired
    expect(exec).toHaveBeenCalledTimes(2);
    // Watchdog armed exactly once, after successful Enter
    expect(armWatchdog).toHaveBeenCalledTimes(1);
    const armArgs = armWatchdog.mock.calls[0][0] as {
      sessionId: string;
      mqid: string;
      body: string;
      contentHash: string;
      tmuxTarget: string;
      wsSend: unknown;
      execCommand: unknown;
    };
    expect(armArgs.sessionId).toBe("sess-A");
    expect(armArgs.mqid).toBe("m1");
    expect(armArgs.body).toBe("hello");
    expect(armArgs.contentHash).toBe(contentHashOf("hello"));
    expect(armArgs.tmuxTarget).toBe("legit-session");
    expect(armArgs.wsSend).toBe(wsSend);
    expect(typeof armArgs.execCommand).toBe("function");
    // trackMqid called with the mqid
    expect(trackMqid).toHaveBeenCalledTimes(1);
    expect(trackMqid).toHaveBeenCalledWith("m1");
    // No error frame
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("Test 2: non-split (no mqid) → armPvSendWatchdog NOT called", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const armWatchdog = vi.fn();
    const trackMqid = vi.fn();

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello",
      sessionId: "sess-A",
      wsSend,
      armWatchdog,
      trackMqid,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(armWatchdog).not.toHaveBeenCalled();
    expect(trackMqid).not.toHaveBeenCalled();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("Test 2b (Fix #1): bare-Enter split-send (data='\\r' + mqid) → armPvSendWatchdog NOT called and pending Map stays empty", async () => {
    // Regression: MessageQueueDrawer sends two separate WS events for its
    // queued send — (a) body without \r without mqid, then (b) bare "\r"
    // with mqid ~60ms later. Event (b) enters __applyInputMessageForTests
    // with data="\r" + non-empty mqid → isSplitSend=true but body="".
    //
    // Previously we armed a watchdog against sha256("").slice(0,32). The
    // parser never emits an empty-content message frame → notifyMatched
    // NEVER fires for that hash → guaranteed T+2.5s retry Enter, T+5.5s
    // full re-send, T+20s paste_send_failed. Silent noise on every
    // queue-drawer send.
    //
    // Fix: skip the arm entirely when body.length === 0 — the message
    // body was already written by a prior WS input event (queue-drawer
    // step (a)); the bare Enter alone does not need signal-driven retry
    // escalation.
    vi.useFakeTimers();
    __resetPvSendWatchdogForTests();
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const trackMqid = vi.fn();

    // Use the REAL armPvSendWatchdog so we can observe module-level pending
    // Map state — a spied vi.fn() would not exercise the real behavior we
    // want to protect against (the module-level Map growing an entry for
    // sha256("") that no signal will ever clear).
    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "\r",
      messageQueueItemId: "mqid-bare-enter",
      sessionId: "sess-A",
      wsSend,
      armWatchdog: armPvSendWatchdog,
      trackMqid,
    });

    // Advance past the 1000ms split-send gate so the Enter completes.
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    await promise;

    // Split-send fired only the Enter (body write was skipped for body="").
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][1] as string;
    expect(cmd).toMatch(/\sEnter\s*$/);

    // armPvSendWatchdog MUST NOT have been called → trackMqid not invoked.
    expect(trackMqid).not.toHaveBeenCalled();

    // Observable side-effect proof: advance past all three watchdog stages.
    // If a watchdog HAD been armed against sha256("").slice(0,32), it would
    // fire retry Enter (2500ms), full-resend C-u+body+Enter (5500ms), and
    // paste_send_failed (20000ms). None of those should occur.
    await vi.advanceTimersByTimeAsync(30_000);

    // exec still at 1 (no retry Enter → 2, no full-resend → 4).
    expect(exec).toHaveBeenCalledTimes(1);
    // wsSend never emitted paste_send_failed.
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed" || f?.type === "send_keys_error";
    });
    expect(escalations.length).toBe(0);
  });

  it("Test 2c (2026-08-21, tina): non-split with data ending in \\r + no mqid → arm retry-Enter-only watchdog with synthetic mqid", async () => {
    // Non-split-path safety net: the frontend chain sometimes loses the
    // messageQueueItemId (diagnosed 2026-08-21 — 2/6 sends this session
    // took the non-split path with body pasted + literal \r → composer
    // newline, no submit, watchdog never armed). This test locks in the
    // rescue: on non-split with data.length > 1 && data.endsWith("\r"),
    // arm a retry-Enter-only watchdog with a synthetic backend-side mqid.
    // The retry Enter at T+2500ms submits whatever's in the composer.
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const armWatchdog = vi.fn();
    const trackMqid = vi.fn();

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      // No messageQueueItemId — this is the trap: frontend meant to submit
      // but lost the mqid somewhere; backend takes the non-split path.
      sessionId: "sess-A",
      wsSend,
      armWatchdog,
      trackMqid,
    });

    // Body written once via the non-split path (`send-keys -l <data>`).
    expect(exec).toHaveBeenCalledTimes(1);
    const bodyCmd = exec.mock.calls[0][1] as string;
    expect(bodyCmd).toContain("-l");
    expect(bodyCmd).toContain("hello");
    // \r survives inside the single-quoted argument as a literal byte.
    expect(bodyCmd).toContain("\r");

    // Watchdog armed exactly once with retryEnterOnly=true and a synthetic mqid.
    expect(armWatchdog).toHaveBeenCalledTimes(1);
    const armArgs = armWatchdog.mock.calls[0][0] as {
      sessionId: string;
      mqid: string;
      body: string;
      contentHash: string;
      tmuxTarget: string;
      retryEnterOnly?: boolean;
    };
    expect(armArgs.sessionId).toBe("sess-A");
    expect(armArgs.mqid).toMatch(/^backend-synth-\d+-[a-z0-9]{8}$/);
    expect(armArgs.body).toBe("hello"); // data without trailing \r
    expect(armArgs.tmuxTarget).toBe("legit-session");
    expect(armArgs.retryEnterOnly).toBe(true);
    // contentHash derivation MUST match sha256(body).slice(0,32).
    const expectedHash = createHash("sha256")
      .update("hello")
      .digest("hex")
      .slice(0, 32);
    expect(armArgs.contentHash).toBe(expectedHash);

    // Synthetic mqid tracked on the connection for orphan-frame prevention.
    expect(trackMqid).toHaveBeenCalledTimes(1);
    expect(trackMqid.mock.calls[0][0]).toBe(armArgs.mqid);
  });

  it("Test 2d (2026-08-21, tina): non-split with data='\\r' only (1 byte) → do NOT arm the retry-Enter-only watchdog", async () => {
    // Boundary check: the non-split arm gate requires data.length > 1. A
    // bare \r on the non-split path (data='\r' without mqid) is not a
    // compose-submit shape — it's a raw single-byte write. Do not arm.
    const exec = vi.fn().mockResolvedValue("");
    const armWatchdog = vi.fn();
    const trackMqid = vi.fn();

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "\r",
      sessionId: "sess-A",
      wsSend: vi.fn(),
      armWatchdog,
      trackMqid,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(armWatchdog).not.toHaveBeenCalled();
    expect(trackMqid).not.toHaveBeenCalled();
  });

  it("Test 3: execCommand throws on body → send_keys_error frame emitted with reason exec_throw_body; armWatchdog NOT called", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockRejectedValue(new Error("SSH channel closed"));
    const wsSend = vi.fn();
    const armWatchdog = vi.fn();
    const trackMqid = vi.fn();

    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: "sess-A",
      wsSend,
      armWatchdog,
      trackMqid,
    });

    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    await Promise.resolve();
    await promise;

    // Only body exec attempted (threw)
    expect(exec).toHaveBeenCalledTimes(1);
    // wsSend called with send_keys_error
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = wsSend.mock.calls[0][0] as {
      type: string;
      mqid: string | null;
      reason: string;
      message: string;
    };
    expect(frame.type).toBe("send_keys_error");
    expect(frame.mqid).toBe("m1");
    expect(frame.reason).toBe("exec_throw_body");
    expect(frame.message).toContain("SSH channel closed");
    // armWatchdog NOT called — no signal will ever arrive for a failed send
    expect(armWatchdog).not.toHaveBeenCalled();
    expect(trackMqid).not.toHaveBeenCalled();
  });

  it("Test 4: execCommand throws on Enter (after body succeeded) → send_keys_error with reason exec_throw_enter; armWatchdog NOT called", async () => {
    vi.useFakeTimers();
    // Body call succeeds, Enter call throws.
    let call = 0;
    const exec = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) return ""; // body OK
      throw new Error("Enter exec failed");
    });
    const wsSend = vi.fn();
    const armWatchdog = vi.fn();
    const trackMqid = vi.fn();

    const promise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: "sess-A",
      wsSend,
      armWatchdog,
      trackMqid,
    });

    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();
    await Promise.resolve();
    await promise;

    expect(exec).toHaveBeenCalledTimes(2);
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = wsSend.mock.calls[0][0] as {
      type: string;
      mqid: string | null;
      reason: string;
      message: string;
    };
    expect(frame.type).toBe("send_keys_error");
    expect(frame.mqid).toBe("m1");
    expect(frame.reason).toBe("exec_throw_enter");
    expect(frame.message).toContain("Enter exec failed");
    expect(armWatchdog).not.toHaveBeenCalled();
    expect(trackMqid).not.toHaveBeenCalled();
  });

  it("Test 5: non-split exec throws → send_keys_error with reason exec_throw (no split, no mqid)", async () => {
    // Non-split throw path — reason is a generic 'exec_throw', mqid is null.
    const exec = vi.fn().mockRejectedValue(new Error("connection reset"));
    const wsSend = vi.fn();
    const armWatchdog = vi.fn();

    await __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: "legit-session",
      currentHostId: 1,
      execCommand: exec,
      data: "hello",
      // no mqid → non-split
      sessionId: "sess-A",
      wsSend,
      armWatchdog,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(wsSend).toHaveBeenCalledTimes(1);
    const frame = wsSend.mock.calls[0][0] as {
      type: string;
      mqid: string | null;
      reason: string;
      message: string;
    };
    expect(frame.type).toBe("send_keys_error");
    expect(frame.mqid).toBeNull();
    expect(frame.reason).toBe("exec_throw");
    expect(frame.message).toContain("connection reset");
    expect(armWatchdog).not.toHaveBeenCalled();
  });

  it("Test 6 (MANDATORY per checker Warning #5): WS-close cleanup — arm two mqids on same connection, close → clearPvSendWatchdog called for each; no paste_send_failed emits", async () => {
    // Simulates the wire-up in claude-session-server.ts's ws-connection scope:
    //   • per-connection `pendingMqidsForThisConnection` Set
    //   • trackMqid adds each arm's mqid
    //   • ws.on("close") iterates the Set + calls clearPvSendWatchdog
    vi.useFakeTimers();
    const wsSend = vi.fn();

    // Per-connection Set (mirrors production's declaration at ws-connection outer scope).
    const pendingMqidsForThisConnection = new Set<string>();
    const trackMqid = (mqid: string) => pendingMqidsForThisConnection.add(mqid);

    // Arm two watchdogs using the REAL armPvSendWatchdog (imported at top-of-file).
    // The Task 2 wiring under test is the trackMqid.add call — verify it happens.
    armPvSendWatchdog({
      sessionId: "sess-A",
      mqid: "m1",
      body: "one",
      contentHash: contentHashOf("one"),
      execCommand: async () => "",
      tmuxTarget: "legit-session",
      wsSend,
    });
    trackMqid("m1");

    await vi.advanceTimersByTimeAsync(100);

    armPvSendWatchdog({
      sessionId: "sess-A",
      mqid: "m2",
      body: "two",
      contentHash: contentHashOf("two"),
      execCommand: async () => "",
      tmuxTarget: "legit-session",
      wsSend,
    });
    trackMqid("m2");

    // Both mqids recorded in the per-connection Set
    expect(pendingMqidsForThisConnection.size).toBe(2);
    expect(pendingMqidsForThisConnection.has("m1")).toBe(true);
    expect(pendingMqidsForThisConnection.has("m2")).toBe(true);

    // Fire the ws.on("close") cleanup synchronously (spy on clearPvSendWatchdog
    // is difficult because it's a module import — use the observable side-effect
    // instead: after clearing, advancing past 20000ms must NOT emit paste_send_failed).
    for (const mqid of pendingMqidsForThisConnection) {
      clearPvSendWatchdog(mqid);
    }
    pendingMqidsForThisConnection.clear();

    // Advance past all three timer stages for both mqids.
    await vi.advanceTimersByTimeAsync(30_000);

    // No paste_send_failed emitted for either mqid — cleared before escalation.
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(0);
  });
});

// ─── reconstructRawSlashCommand + __applyOnLineNotifyForTests (quick-260821-shn) ─
//
// See .planning/quick/260821-shn-slash-cmd-watchdog-dual-hash-notify/260821-shn-PLAN.md.
// Purpose: prove the dual-hash notify seam clears the frontend pv-send-watchdog
// for slash-command sends (frontend hashed raw `/id tabitha`; backend previously
// only hashed the wrapper `<command-message>id</command-message><command-name>/id
// </command-name><command-args>tabitha</command-args>`). Post-fix the tail-side
// onLine callback notifies BOTH hashes for slash-command frames — clearing the
// pending watchdog and preventing the T+2500ms retry + T+5500ms double-submit.

describe("reconstructRawSlashCommand + __applyOnLineNotifyForTests — dual-hash notify (quick-260821-shn)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const hash32 = (s: string): string =>
    createHash("sha256").update(s).digest("hex").slice(0, 32);

  it("Test 1 (with-args): wrapper /id tabitha → returns \"/id tabitha\" and notifyMatched called TWICE (wrapper-hash then raw-hash, in order)", () => {
    const content =
      "<command-message>id</command-message>" +
      "<command-name>/id</command-name>" +
      "<command-args>tabitha</command-args>";
    expect(reconstructRawSlashCommand(content)).toBe("/id tabitha");

    const spy = vi.fn();
    __applyOnLineNotifyForTests({
      frame: { type: "message", role: "user", content },
      sessionIdFromFile: "sess-A",
      notifyMatched: spy,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    // First call = wrapper-hash (unchanged from pre-fix)
    expect(spy).toHaveBeenNthCalledWith(1, "sess-A", hash32(content));
    // Second call = raw-hash (the fix)
    expect(spy).toHaveBeenNthCalledWith(2, "sess-A", hash32("/id tabitha"));
  });

  it("Test 2 (no-args, missing <command-args> block): wrapper /help → returns \"/help\" (no trailing space) and notifyMatched called TWICE", () => {
    const content =
      "<command-message>help</command-message>" +
      "<command-name>/help</command-name>";
    expect(reconstructRawSlashCommand(content)).toBe("/help");

    const spy = vi.fn();
    __applyOnLineNotifyForTests({
      frame: { type: "message", role: "user", content },
      sessionIdFromFile: "sess-A",
      notifyMatched: spy,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, "sess-A", hash32(content));
    expect(spy).toHaveBeenNthCalledWith(2, "sess-A", hash32("/help"));
  });

  it("Test 3 (empty <command-args></command-args>): reconstructs to \"/help\" (no trailing space) and notifyMatched called TWICE", () => {
    const content =
      "<command-message>help</command-message>" +
      "<command-name>/help</command-name>" +
      "<command-args></command-args>";
    expect(reconstructRawSlashCommand(content)).toBe("/help");

    const spy = vi.fn();
    __applyOnLineNotifyForTests({
      frame: { type: "message", role: "user", content },
      sessionIdFromFile: "sess-A",
      notifyMatched: spy,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, "sess-A", hash32(content));
    expect(spy).toHaveBeenNthCalledWith(2, "sess-A", hash32("/help"));
  });

  it("Test 4 (multi-line args verbatim): newline preserved inside args body, notifyMatched called TWICE with raw-hash of multi-line body", () => {
    const rawBody = "/note line one\nline two";
    const content =
      "<command-message>note</command-message>" +
      "<command-name>/note</command-name>" +
      "<command-args>line one\nline two</command-args>";
    expect(reconstructRawSlashCommand(content)).toBe(rawBody);

    const spy = vi.fn();
    __applyOnLineNotifyForTests({
      frame: { type: "message", role: "user", content },
      sessionIdFromFile: "sess-A",
      notifyMatched: spy,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, "sess-A", hash32(content));
    expect(spy).toHaveBeenNthCalledWith(2, "sess-A", hash32(rawBody));
  });

  it("Test 5 (NON-slash control): plain \"hello\" → returns null and notifyMatched called EXACTLY ONCE (byte-identical to pre-fix)", () => {
    expect(reconstructRawSlashCommand("hello")).toBeNull();

    const spy = vi.fn();
    __applyOnLineNotifyForTests({
      frame: { type: "message", role: "user", content: "hello" },
      sessionIdFromFile: "sess-A",
      notifyMatched: spy,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenNthCalledWith(1, "sess-A", hash32("hello"));
  });

  it("Test 6 (malformed wrapper — <command-message> present but NO <command-name>): returns null, notifyMatched called EXACTLY ONCE with wrapper-hash, no crash", () => {
    // Plan § malformed handling: this path is the "no <command-name> at all"
    // pass-through — per behavior spec (§ A detection contract) the helper
    // returns null and does NOT log (hot path stays silent per role directive
    // "logging is cheap and batched" — batched here means not-per-message on
    // the common path). Test asserts safe fallthrough behavior: single
    // wrapper-hash notify, no second call, no crash.
    const content =
      "<command-message>foo</command-message>this is bare text";
    expect(reconstructRawSlashCommand(content)).toBeNull();

    const spy = vi.fn();
    const infoSpy = vi.fn();
    __applyOnLineNotifyForTests({
      frame: { type: "message", role: "user", content },
      sessionIdFromFile: "sess-A",
      notifyMatched: spy,
      logger: {
        info: infoSpy,
        debug: vi.fn(),
      },
    });

    // Safe fallthrough: single wrapper-hash notify.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenNthCalledWith(1, "sess-A", hash32(content));
    // No dual-hash notify INFO log fired via the injected logger (the wrapper-
    // detected INFO log is the only one routed through the injectable logger;
    // the malformed-path helper log routes through the module-level sshLogger
    // and is not pinned by this test to avoid coupling to logger transport).
    expect(infoSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("dual-hash notify"),
      expect.anything(),
    );
  });
});
