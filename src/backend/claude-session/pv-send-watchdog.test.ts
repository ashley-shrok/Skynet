/**
 * Phase 50 Plan 02 Task 1 — signal-driven send-path watchdog unit tests.
 *
 * Replaces the PTY-activity-proxy watchdog in src/backend/ssh/terminal-pv-
 * watchdog.ts with a three-stage timer chain that fires only on the
 * ABSENCE of the specific parser signal Plan 50-01 introduced
 * (contentHash = sha256(content).slice(0, 32) content-only).
 *
 * Timing chain (from arm time T=0):
 *   • T+2500ms → retry Enter (`tmux send-keys -t <target> Enter`)
 *   • T+5500ms → full re-send (C-u, then -l body, then Enter)
 *   • T+20000ms → wsSend {type:'paste_send_failed', mqid, reason}
 *
 * Uses vi.useFakeTimers()+vi.advanceTimersByTimeAsync() because the
 * full-resend step involves awaited execCommand calls (three sequential
 * `await`s inside setTimeout). See the OLD terminal-layer watchdog test file
 * (deleted in Task 3) via git-log for the fake-timer pattern reference.
 *
 * Test surface:
 *   T-1  happy path (matched at T+100ms) → no retry, no failure
 *   T-2  retry fires at T+2500ms silence
 *   T-3  retry succeeds → no full-resend, no paste_send_failed
 *   T-4  full-resend fires at T+5500ms silence
 *   T-5  paste_send_failed at T+20000ms silence
 *   T-6  retry-fired-once invariant + arm-again-same-mqid no-op
 *   T-7  execCommand throws on retry → escalation still runs
 *   T-8  clearPvSendWatchdog cancels pending
 *   T-9  notifyMatched with wrong hash does NOT clear
 *   T-10 per-mqid isolation
 *   T-11 __resetPvSendWatchdogForTests clears ALL module state
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { createHash } from "node:crypto";
import {
  armPvSendWatchdog,
  clearPvSendWatchdog,
  clearPvSendWatchdogsForSession,
  notifyMatched,
  __resetPvSendWatchdogForTests,
  RETRY_ENTER_MS,
  FULL_RESEND_MS,
  GIVE_UP_MS,
  RETRY_ENTER_MS_DORMANT,
  FULL_RESEND_MS_DORMANT,
  GIVE_UP_MS_DORMANT,
  MARKER_FALLBACK_MS_MIRROR,
} from "./pv-send-watchdog.js";

// Silence sshLogger — the module logs at every arm / retry / escalation and
// tests would otherwise dump a lot of operation=pv_send_watchdog_* lines.
vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const SESSION_ID = "sess-A";
const TMUX_TARGET = "ashley-tmux";

function contentHashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

function makeExec(): Mock {
  return vi.fn().mockResolvedValue("");
}

function makeWsSend(): Mock {
  return vi.fn();
}

describe("pv-send-watchdog (Phase 50 Plan 02 Task 1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetPvSendWatchdogForTests();
  });

  afterEach(() => {
    __resetPvSendWatchdogForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("T-1 happy path: matched at T+100ms → no retry, no paste_send_failed", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // Simulate the parser signal arriving quickly.
    await vi.advanceTimersByTimeAsync(100);
    notifyMatched(SESSION_ID, contentHashOf("hello"));

    // Cross well past all three timers.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(exec).not.toHaveBeenCalled();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-2 retry fires at T+2500ms silence: EXACTLY ONE `tmux send-keys ... Enter`", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    await vi.advanceTimersByTimeAsync(2500);

    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);
    expect(cmd).not.toContain("-l");
    expect(cmd).not.toContain("hello");
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-3 retry succeeds: matched between retry and full-resend → no further exec, no paste_send_failed", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // T+2500ms → retry fires
    await vi.advanceTimersByTimeAsync(2500);
    expect(exec).toHaveBeenCalledTimes(1);

    // T+3000ms → signal arrives
    await vi.advanceTimersByTimeAsync(500);
    notifyMatched(SESSION_ID, contentHashOf("hello"));

    // Cross past 20000ms.
    await vi.advanceTimersByTimeAsync(20_000);

    expect(exec).toHaveBeenCalledTimes(1); // still only retry
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-4 full-resend fires at T+5500ms silence: C-u, then -l body, then Enter", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello world",
      contentHash: contentHashOf("hello world"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // T+2500ms retry
    await vi.advanceTimersByTimeAsync(2500);
    expect(exec).toHaveBeenCalledTimes(1);

    // T+5500ms full-resend fires: 3 more execCommand calls
    await vi.advanceTimersByTimeAsync(3000);

    // Total should be 4: initial retry + 3 full-resend calls
    expect(exec).toHaveBeenCalledTimes(4);

    const call2 = exec.mock.calls[1][0] as string;
    const call3 = exec.mock.calls[2][0] as string;
    const call4 = exec.mock.calls[3][0] as string;

    // C-u to clear composebox
    expect(call2).toBe(`tmux send-keys -t '${TMUX_TARGET}' C-u`);
    expect(call2).not.toContain("-l");

    // -l body (literal flag)
    expect(call3).toContain("send-keys -l -t");
    expect(call3).toContain(`'${TMUX_TARGET}'`);
    expect(call3).toContain("'hello world'");

    // Enter
    expect(call4).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);
    expect(call4).not.toContain("-l");

    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-5 paste_send_failed at T+20000ms silence after retry+full-resend", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // Cross past all three timers.
    await vi.advanceTimersByTimeAsync(20_000);

    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = wsSend.mock.calls[0][0] as {
      type: string;
      mqid: string;
      reason: string;
    };
    expect(emitted).toEqual({
      type: "paste_send_failed",
      mqid: "m1",
      reason: "no_signal_after_full_resend",
    });
  });

  it("T-6 retry-fired-once invariant: second arm with same mqid is no-op; retry does NOT double-fire", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();

    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // Second arm with SAME mqid immediately — must be a no-op.
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // T+2500ms — first retry fires. Even though we "armed" twice, only ONE retry.
    await vi.advanceTimersByTimeAsync(2500);
    expect(exec).toHaveBeenCalledTimes(1);

    // Cross the full-resend + escalation windows: still guarded by retryFired.
    await vi.advanceTimersByTimeAsync(3000);
    // Full-resend fires (that's the 5500ms scheduled timer, not a retry-again).
    // At this point exec was called 1 (retry) + 3 (full-resend) = 4 times, NOT 5+.
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it("T-7 execCommand throws on retry → error caught, escalation still runs", async () => {
    // Body "hello" — first call is the retry Enter; that one throws.
    // Subsequent full-resend calls succeed. paste_send_failed still emits at 20s.
    let callCount = 0;
    const exec = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) throw new Error("SSH channel closed");
      return "";
    });
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    await vi.advanceTimersByTimeAsync(20_000);

    // Retry attempted (throws) + full-resend 3 calls = 4 total attempts
    expect(exec).toHaveBeenCalledTimes(4);
    // Escalation still fires
    expect(wsSend).toHaveBeenCalledTimes(1);
    const emitted = wsSend.mock.calls[0][0] as { type: string; mqid: string };
    expect(emitted.type).toBe("paste_send_failed");
    expect(emitted.mqid).toBe("m1");
  });

  it("T-8 clearPvSendWatchdog cancels pending → no exec, no wsSend", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    await vi.advanceTimersByTimeAsync(100);
    clearPvSendWatchdog("m1");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(exec).not.toHaveBeenCalled();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-9 notifyMatched with wrong hash does NOT clear → retry still fires", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    await vi.advanceTimersByTimeAsync(100);
    // Wrong content hash — should NOT clear the watchdog.
    notifyMatched(SESSION_ID, contentHashOf("goodbye"));

    await vi.advanceTimersByTimeAsync(2500);
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);
  });

  it("T-10 per-mqid isolation: match on m1's hash does NOT clear m2's watchdog", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();

    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "A",
      contentHash: contentHashOf("A"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    await vi.advanceTimersByTimeAsync(100);

    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m2",
      body: "B",
      contentHash: contentHashOf("B"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // T+2600ms from t=0: m1's 2500ms window has passed → but if we match A here,
    // m1 was already going to fire retry — the match at 2600 is AFTER retry.
    // The important isolation: matching A after m1's retry does NOT stop m2.
    await vi.advanceTimersByTimeAsync(2500);
    // At this point (t=2600): m1's retry fired (it was armed at t=0). m2 was armed at
    // t=100 so m2's retry fires at t=2600 too (100+2500). Both fired one retry each.
    expect(exec.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Match A → this should clear m1 only (m1 already fired retry; matching now would
    // stop escalation for m1). m2 should be unaffected.
    notifyMatched(SESSION_ID, contentHashOf("A"));

    // Continue to t = 5600 (m2's full-resend fires at 100+5500=5600).
    // m1's would-be full-resend at t=5500 was cancelled by the match at t=2600.
    // Advance from t=2600 to t=5700 (3100ms).
    await vi.advanceTimersByTimeAsync(3100);

    // m2 full-resend should have fired (3 execs), m1 should NOT have.
    // Simple invariant: after match A, m2 is still armed → its escalation continues.
    // Total execs: m1 retry (1) + m2 retry (1) + m2 full-resend (3) = 5
    expect(exec.mock.calls.length).toBe(5);
  });

  it("T-11 __resetPvSendWatchdogForTests clears ALL module-level state", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();

    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m1",
      body: "one",
      contentHash: contentHashOf("one"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m2",
      body: "two",
      contentHash: contentHashOf("two"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m3",
      body: "three",
      contentHash: contentHashOf("three"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    __resetPvSendWatchdogForTests();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(exec).not.toHaveBeenCalled();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-12 (Fix #2) clearPvSendWatchdogsForSession(sessionId) cancels only matching-session watchdogs; unrelated sessions survive", async () => {
    // Regression: on session recycle, pv-send-watchdog entries armed against
    // the OLD sessionId must be cancelled so their full-resend stage does
    // not retype the OLD body into the NEW Claude session's composebox.
    const exec = makeExec();
    const wsSend = makeWsSend();

    // Arm three watchdogs on OLD session + one on a different (unrelated) session.
    armPvSendWatchdog({
      sessionId: "sess-OLD",
      mqid: "m1",
      body: "old-one",
      contentHash: contentHashOf("old-one"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });
    armPvSendWatchdog({
      sessionId: "sess-OLD",
      mqid: "m2",
      body: "old-two",
      contentHash: contentHashOf("old-two"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });
    armPvSendWatchdog({
      sessionId: "sess-OLD",
      mqid: "m3",
      body: "old-three",
      contentHash: contentHashOf("old-three"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });
    armPvSendWatchdog({
      sessionId: "sess-OTHER",
      mqid: "m4",
      body: "keep",
      contentHash: contentHashOf("keep"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // Clear ONLY sess-OLD entries — returns array of cleared mqids.
    const cleared = clearPvSendWatchdogsForSession("sess-OLD");
    expect(cleared.sort()).toEqual(["m1", "m2", "m3"]);

    // Advance past every timer stage.
    await vi.advanceTimersByTimeAsync(30_000);

    // Nothing from sess-OLD should have escalated:
    //   - No retry Enter (would be exec call with `Enter` for old bodies)
    //   - No full-resend body (would be exec call with -l flag + 'old-*')
    //   - No paste_send_failed for m1/m2/m3
    for (const call of exec.mock.calls) {
      const cmd = call[0] as string;
      expect(cmd).not.toContain("old-one");
      expect(cmd).not.toContain("old-two");
      expect(cmd).not.toContain("old-three");
    }
    for (const call of wsSend.mock.calls) {
      const frame = call[0] as { type?: string; mqid?: string };
      if (frame.type === "paste_send_failed") {
        expect(["m1", "m2", "m3"]).not.toContain(frame.mqid);
      }
    }

    // The sess-OTHER watchdog SURVIVED — it should still escalate normally.
    // At T+20000ms we expect its paste_send_failed frame to have fired.
    const otherEscalations = wsSend.mock.calls.filter((c) => {
      const f = c[0] as { type?: string; mqid?: string };
      return f?.type === "paste_send_failed" && f?.mqid === "m4";
    });
    expect(otherEscalations.length).toBe(1);
  });

  // ── T-14/T-15/T-16 — retryEnterOnly flag (2026-08-21, tina) ────────────────
  // Non-split-path safety net: Stage 1 (retry Enter at T+2500ms) fires as
  // usual, Stages 2 (full-resend at T+5500ms) and 3 (paste_send_failed at
  // T+20000ms) are SKIPPED. See ArmPvSendWatchdogArgs.retryEnterOnly for the
  // double-submit reasoning.

  it("T-14 retryEnterOnly: Stage 1 retry Enter fires at T+2500ms (identical to full mode)", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m-retry-only",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
      retryEnterOnly: true,
    });

    // Just before boundary — no retry yet.
    await vi.advanceTimersByTimeAsync(2499);
    expect(exec).not.toHaveBeenCalled();

    // Cross the boundary — retry Enter fires once.
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(exec).toHaveBeenCalledTimes(1);
    const cmd = exec.mock.calls[0][0] as string;
    expect(cmd).toMatch(/\sEnter\s*$/);
    expect(cmd).not.toContain("-l");
  });

  it("T-15 retryEnterOnly: Stage 2 full-resend NEVER fires (no C-u, no body retype, no second Enter)", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m-no-full-resend",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
      retryEnterOnly: true,
    });

    // Advance well past the full-resend boundary (5500ms).
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    // Only the retry Enter fired — no C-u, no body retype.
    expect(exec).toHaveBeenCalledTimes(1);
    const cmds = exec.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => c.includes("C-u"))).toBe(false);
    expect(cmds.some((c) => c.includes("-l"))).toBe(false);
  });

  it("T-16 retryEnterOnly: Stage 3 paste_send_failed NEVER fires (no wsSend at all)", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "m-no-give-up",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
      retryEnterOnly: true,
    });

    // Advance well past the give-up boundary (20_000ms).
    await vi.advanceTimersByTimeAsync(25_000);
    await Promise.resolve();

    // wsSend was never called — no paste_send_failed frame ever emitted.
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("T-13 (Fix #2) clearPvSendWatchdogsForSession(sessionId) with no matches returns empty array; no side-effects", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: "sess-A",
      mqid: "m1",
      body: "hello",
      contentHash: contentHashOf("hello"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    const cleared = clearPvSendWatchdogsForSession("sess-NONEXISTENT");
    expect(cleared).toEqual([]);

    // The unrelated watchdog is intact — should escalate at T+20000ms.
    await vi.advanceTimersByTimeAsync(20_000);
    const escalations = wsSend.mock.calls.filter((c) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(1);
  });
});

// ─── Phase 56 Plan 02 — widened window for dormant-triggered sends ──────────
//
// The invisible-wake path (Plan 01): send-path drops .dormant sentinel + polls
// .resume-complete marker with MARKER_FALLBACK_MS=90_000 timeout, THEN
// dispatches send-keys. The watchdog arms at that send-keys moment. Without
// widening, the normal 20_000ms give-up would fire DURING the healthy ~90s
// wake window → red-bubble on a healthy send.
//
// Fix: pv-send-watchdog.ts's new `dormantSend?: boolean` flag swaps the three
// stages to widened variants (retry T+92500ms, full-resend T+95500ms, give-up
// T+120_000ms). Awake-pane sends omit the flag → today's timings byte-for-byte.
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 56: widened window for dormant-triggered sends", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetPvSendWatchdogForTests();
  });

  afterEach(() => {
    __resetPvSendWatchdogForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("Test WW-1: dormantSend:true swaps GIVE_UP_MS to GIVE_UP_MS_DORMANT — paste_send_failed does NOT fire at T+20s, DOES fire at T+120s", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "mqid-ww1",
      body: "hello dormant",
      contentHash: contentHashOf("hello dormant"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
      dormantSend: true,
    });

    // Advance past the NORMAL give-up window (T+20_000+1ms).
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + 1);

    // paste_send_failed must NOT have fired yet — the widened window has
    // NOT elapsed. (Note: retry-Enter + full-resend have fired their execs by
    // now for the WIDENED cadence — they're scheduled at T+92500/T+95500 so
    // they're still pending. Only wsSend of paste_send_failed is asserted here.)
    let escalations = wsSend.mock.calls.filter((c) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(0);

    // Advance the rest of the way to just past the widened give-up boundary
    // (total T+120_001ms).
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS_DORMANT - GIVE_UP_MS);

    // Now paste_send_failed DID fire — with the exact wire shape.
    escalations = wsSend.mock.calls.filter((c) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(1);
    expect(escalations[0][0]).toEqual({
      type: "paste_send_failed",
      mqid: "mqid-ww1",
      reason: "no_signal_after_full_resend",
    });
  });

  it("Test WW-2: dormantSend:false (or omitted) preserves today's GIVE_UP_MS = 20_000 — no regression", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    // Omit dormantSend entirely — undefined must be treated as false in the
    // widened-window ternary (byte-for-byte pre-Phase-56 behavior).
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "mqid-ww2",
      body: "hello awake",
      contentHash: contentHashOf("hello awake"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
    });

    // Advance past the NORMAL give-up window.
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + 1);

    // paste_send_failed MUST have fired at T+20_001ms — awake-pane behavior
    // unchanged from pre-Phase-56.
    const escalations = wsSend.mock.calls.filter((c) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(1);
    expect(escalations[0][0]).toEqual({
      type: "paste_send_failed",
      mqid: "mqid-ww2",
      reason: "no_signal_after_full_resend",
    });
  });

  it("Test WW-3: dormantSend:true delays retry-Enter to T+92500ms and full-resend to T+95500ms — awake-window retries do not fire early", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "mqid-ww3",
      body: "widened body",
      contentHash: contentHashOf("widened body"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
      dormantSend: true,
    });

    // Advance past the NORMAL retry-Enter boundary (T+2600ms).
    await vi.advanceTimersByTimeAsync(RETRY_ENTER_MS + 100);
    // No exec should have fired — retry-Enter for dormant is at T+92500.
    let cmds = exec.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => /send-keys.*Enter/.test(c))).toBe(false);

    // Advance past the NORMAL full-resend boundary (total T+5600ms).
    await vi.advanceTimersByTimeAsync(FULL_RESEND_MS - RETRY_ENTER_MS);
    // Still no exec — full-resend for dormant is at T+95500.
    cmds = exec.mock.calls.map((c) => c[0] as string);
    expect(exec).not.toHaveBeenCalled();

    // Advance to just past the WIDENED retry-Enter boundary (total
    // T+92_600ms).
    await vi.advanceTimersByTimeAsync(
      RETRY_ENTER_MS_DORMANT + 100 - (FULL_RESEND_MS + 100),
    );
    // Now the retry-Enter exec HAS fired — exactly one send-keys Enter.
    cmds = exec.mock.calls.map((c) => c[0] as string);
    const retryCalls = cmds.filter(
      (c) => /send-keys.*Enter$/.test(c) && !c.includes("-l"),
    );
    expect(retryCalls.length).toBe(1);
    expect(retryCalls[0]).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);

    // Advance to just past the WIDENED full-resend boundary (total
    // T+95_600ms).
    await vi.advanceTimersByTimeAsync(
      FULL_RESEND_MS_DORMANT + 100 - (RETRY_ENTER_MS_DORMANT + 100),
    );
    // Now the full-resend triplet HAS fired: C-u + -l body + Enter.
    cmds = exec.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => c.includes("C-u"))).toBe(true);
    expect(
      cmds.some((c) => c.includes("-l") && c.includes("widened body")),
    ).toBe(true);
    // At least two send-keys Enter — the earlier retry + full-resend's Enter.
    const enterCount = cmds.filter(
      (c) => /send-keys.*Enter$/.test(c) && !c.includes("-l"),
    ).length;
    expect(enterCount).toBeGreaterThanOrEqual(2);
  });

  it("Test WW-4: dormantSend + retryEnterOnly compose — only retry-Enter is scheduled, at the widened cadence, no full-resend, no give-up", async () => {
    const exec = makeExec();
    const wsSend = makeWsSend();
    armPvSendWatchdog({
      sessionId: SESSION_ID,
      mqid: "mqid-ww4",
      body: "compose-mode body",
      contentHash: contentHashOf("compose-mode body"),
      execCommand: exec,
      tmuxTarget: TMUX_TARGET,
      wsSend,
      dormantSend: true,
      retryEnterOnly: true,
    });

    // Advance to just past the WIDENED retry-Enter boundary.
    await vi.advanceTimersByTimeAsync(RETRY_ENTER_MS_DORMANT + 100);

    // The bare Enter DID fire.
    const cmds = exec.mock.calls.map((c) => c[0] as string);
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);
    // No C-u, no -l body — retryEnterOnly suppresses full-resend.
    expect(cmds.some((c) => c.includes("C-u"))).toBe(false);
    expect(cmds.some((c) => c.includes("-l"))).toBe(false);

    // Advance well past the WIDENED give-up boundary.
    await vi.advanceTimersByTimeAsync(
      GIVE_UP_MS_DORMANT + 1 - (RETRY_ENTER_MS_DORMANT + 100),
    );

    // paste_send_failed NEVER fired — retryEnterOnly suppresses stage 3.
    const escalations = wsSend.mock.calls.filter((c) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(0);
  });
});

// WW-5 lives OUTSIDE the describe block — it's a file-read invariant guard,
// not a timer-based watchdog test. Fake-timer setup would be a no-op here.
describe("Phase 56: constant-drift guard", () => {
  it("Test WW-5: MARKER_FALLBACK_MS_MIRROR must equal MARKER_FALLBACK_MS in claude-session-server.ts", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/backend/claude-session/claude-session-server.ts",
      "utf-8",
    );
    // Match `MARKER_FALLBACK_MS = 90_000;` (allow `_` in numeric literal).
    const m = src.match(/MARKER_FALLBACK_MS\s*=\s*(\d[\d_]*)/);
    expect(m).not.toBeNull();
    if (m === null) return; // narrow for TS
    const upstreamValue = parseInt(m[1].replace(/_/g, ""), 10);
    expect(upstreamValue).toBe(MARKER_FALLBACK_MS_MIRROR);
    // Sanity: guard against the raw 90_000 value silently changing.
    expect(MARKER_FALLBACK_MS_MIRROR).toBe(90_000);
    expect(GIVE_UP_MS_DORMANT).toBe(120_000);
    expect(RETRY_ENTER_MS_DORMANT).toBe(92_500);
    expect(FULL_RESEND_MS_DORMANT).toBe(95_500);
  });
});
