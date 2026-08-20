/**
 * Phase 50 Plan 04 Task 1 — Optimistic bubbles INTEGRATION tests.
 *
 * In-process end-to-end tests wiring the four seams from Plans 50-01, 50-02,
 * and 50-03 (backend-side) together and exercising every path described in
 * D-22 under fake timers.
 *
 * Seams wired:
 *   • parseSessionLine (Plan 50-01 Task 1 — queue-operation enqueue branch)
 *   • __applyQueueDedupForTests (Plan 50-01 Task 2 — content-only sha256 dedup Map)
 *   • __applyInputMessageForTests (Plan 50-02 Task 2 — arms watchdog on split-send)
 *   • armPvSendWatchdog / notifyMatched / clearPvSendWatchdog /
 *     __resetPvSendWatchdogForTests (Plan 50-02 Task 1 — signal-driven watchdog)
 *
 * Purpose (D-22, D-23 from 50-CONTEXT.md): Unit tests on each seam individually
 * cover their internal contracts. This file verifies the contracts compose
 * correctly — the parser's dedup + the watchdog's notifyMatched + the input
 * handler's arm all agree on the same content-hash derivation and the same
 * session-scope. If any pair drifts (e.g., dedup uses per-session scope but
 * notifyMatched uses per-mqid scope), unit tests pass but the composition
 * breaks; only an integration test catches it.
 *
 * Hash-derivation contract (load-bearing): computeContentHash MUST match Plan
 * 50-01 Task 2's dedup Map key derivation AND Plan 50-02 Task 1's watchdog
 * arm-time key derivation byte-for-byte: sha256(content).slice(0, 32) —
 * content-only, no sessionId, no timestamp. See 50-01-PLAN.md § objective
 * "Hash-derivation contract". This is DISTINCT from Plan 50-01 Task 1's
 * eventId derivation which uses sha256(sessionId+timestamp+content).
 *
 * Scenario coverage (D-22 a-g):
 *   (a) Happy path — direct user turn, spinner clears, no escalation.
 *   (b) Queued path — enqueue signal clears watchdog; ~2min later dequeue
 *       user turn dedup-suppressed (empirical 2-min span validates
 *       Warning #9 fix + Warning #10 re-verification).
 *   (c) Failure path — no signal for 20s → retry Enter (2500ms) → full-resend
 *       (5500ms) → paste_send_failed (20000ms).
 *   (d) Retry-Enter path — signal arrives after retry but before full-resend.
 *       Also asserts the retry-fired-once invariant.
 *   (e) Full-resend path — signal arrives after full-resend but before 20s.
 *   (f) SKIPPED — latest-only rendering is a frontend concern, covered by
 *       PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14.
 *   (g) Dedup — same as (b) with explicit exactly-one wsSend assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { parseSessionLine } from "./session-file-parser.js";
import {
  __applyInputMessageForTests,
  __applyQueueDedupForTests,
} from "./claude-session-server.js";
import {
  armPvSendWatchdog,
  notifyMatched,
  clearPvSendWatchdog,
  clearPvSendWatchdogsForSession,
  __resetPvSendWatchdogForTests,
} from "./pv-send-watchdog.js";
import { __applyTransitionToActiveNewCleanupForTests } from "./claude-session-server.js";

// Silence sshLogger — the modules log at every arm / retry / escalation /
// dedup step and tests would otherwise dump a lot of operation lines.
// Must mock the FULL logger surface because claude-session-server.ts
// transitively imports several named loggers (ssh, auth, database, api,
// system, file, stats, tunnel, dashboard, guac, version) via other
// backend modules (e.g. host-resolver's `logger` re-export).
vi.mock("../utils/logger.js", () => {
  const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  });
  const systemLogger = makeLogger();
  return {
    sshLogger: makeLogger(),
    authLogger: makeLogger(),
    databaseLogger: makeLogger(),
    apiLogger: makeLogger(),
    systemLogger,
    fileLogger: makeLogger(),
    statsLogger: makeLogger(),
    tunnelLogger: makeLogger(),
    dashboardLogger: makeLogger(),
    guacLogger: makeLogger(),
    versionLogger: makeLogger(),
    logger: systemLogger,
    setGlobalLogLevel: vi.fn(),
    getGlobalLogLevel: vi.fn(() => "info"),
  };
});

// Stub ssh2 Client — execCommand is injected so conn is never accessed.
const fakeConn = {} as import("ssh2").Client;

const SESSION_ID = "sess-A";
const TMUX_TARGET = "legit-session";
const HOST_ID = 1;

/**
 * Compute the contentHash byte-for-byte identical to:
 *   • Plan 50-01 Task 2's __applyQueueDedupForTests dedup Map key
 *   • Plan 50-02 Task 1's armPvSendWatchdog `contentHash` argument
 *   • Plan 50-02 Task 2's arm-time derivation inside
 *     __applyInputMessageForTests (~L1572-1575)
 *
 * CONTENT-ONLY derivation — no sessionId, no timestamp. This is the
 * SAME hash used across all three modules; if this helper drifts, the
 * whole optimistic-bubble pipeline breaks silently. See 50-01-PLAN.md
 * § objective "Hash-derivation contract".
 *
 * DO NOT change this to include sessionId or timestamp — that would be
 * the eventId derivation (Plan 50-01 Task 1), which is a DIFFERENT hash
 * used only by the frontend's per-eventId dedup Set.
 */
function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

/**
 * Build a queue-operation enqueue JSONL line. Shape mirrors the empirical
 * evidence in 50-CONTEXT.md § Empirical evidence (enqueue writes ~111ms
 * post-send; content field carries the raw user text).
 */
function makeEnqueueLine(content: string, timestamp: string): string {
  return JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    content,
    timestamp,
  });
}

/**
 * Build a normal user-turn JSONL line. Shape matches what Claude Code
 * writes when it processes a user message directly (or when it dequeues
 * a previously-enqueued message ~seconds-to-minutes later).
 */
function makeUserTurnLine(
  content: string,
  timestamp: string,
  uuid: string,
): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content },
    timestamp,
    uuid,
  });
}

/**
 * Simulate what claude-session-server.ts's onLine callback does for a
 * single JSONL line: parseSessionLine → __applyQueueDedupForTests → (if
 * not suppressed) wsSend + notifyMatched. Mirrors the production wire-up
 * at ~L3095-3160.
 */
function simulateOnLine(
  line: string,
  sessionId: string,
  dedupMap: Map<string, number>,
  wsSend: (frame: object) => void,
  now: number,
): { emitted: boolean; suppressed: boolean } {
  const parsed = parseSessionLine(line, sessionId);
  if (parsed.kind !== "message") {
    return { emitted: false, suppressed: false };
  }
  // The dedup seam only cares about user-role message frames; other
  // frames pass through unchanged. Mirror the production gate.
  let rawObj: Record<string, unknown> = {};
  try {
    rawObj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { emitted: false, suppressed: false };
  }
  const dedupResult = __applyQueueDedupForTests({
    parsedFrame: parsed,
    rawObj,
    dedupMap,
    now,
  });
  if (dedupResult.suppress) {
    return { emitted: false, suppressed: true };
  }
  // Wire-frame emission (production stringifies; tests inspect the object).
  wsSend({
    type: "message",
    role: parsed.role,
    content: parsed.content,
    eventId: parsed.eventId,
    ts: parsed.ts,
  });
  // Notify watchdog — production computes contentHash from frame.content
  // (which equals parsed.content); we use the same helper here.
  if (
    parsed.role === "user" &&
    typeof parsed.content === "string" &&
    parsed.content.length > 0
  ) {
    notifyMatched(sessionId, computeContentHash(parsed.content));
  }
  return { emitted: true, suppressed: false };
}

describe("Phase 50 optimistic bubbles — integration (D-22 scenarios a-g)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear module-level pv-send-watchdog state cleanly between scenarios.
    // Seam guaranteed by Plan 50-02 Task 1 export + Test 11 coverage.
    __resetPvSendWatchdogForTests();
  });

  afterEach(() => {
    __resetPvSendWatchdogForTests();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("(a) happy path — send fires, direct user turn signal arrives, spinner clears, no escalation", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const dedupMap = new Map<string, number>();

    // 1. Fire __applyInputMessageForTests (production input handler seam)
    //    with all four Task 2 injectable deps wired.
    const inputPromise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: TMUX_TARGET,
      currentHostId: HOST_ID,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: SESSION_ID,
      wsSend,
      armWatchdog: armPvSendWatchdog,
    });

    // 2. Advance past the 250ms split-send gate → body + Enter fire.
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    await inputPromise;

    // Body + Enter fired (exactly 2 execCommand calls from the split-send).
    expect(exec).toHaveBeenCalledTimes(2);

    // 3. Simulate the parser seeing the direct user turn at T+300ms
    //    (from arm time). Advance a further 50ms (250 + 50 = 300).
    await vi.advanceTimersByTimeAsync(50);
    const line = makeUserTurnLine("hello", "2026-08-20T12:00:00Z", "u1");
    const result = simulateOnLine(line, SESSION_ID, dedupMap, wsSend, Date.now());
    expect(result.emitted).toBe(true);
    expect(result.suppressed).toBe(false);

    // 4. Advance well past all three watchdog timers.
    await vi.advanceTimersByTimeAsync(30_000);

    // 5. Assertions:
    //    • execCommand called exactly 2 times (body + Enter from split-send only).
    //      No retry Enter (would be 3), no full-resend (would be 5+).
    expect(exec).toHaveBeenCalledTimes(2);
    //    • wsSend never emitted paste_send_failed or send_keys_error.
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed" || f?.type === "send_keys_error";
    });
    expect(escalations.length).toBe(0);
  });

  it("(b) queued path — enqueue signal clears watchdog; dequeue user turn at T+2min is dedup-suppressed (Warning #9/#10 re-verification)", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const dedupMap = new Map<string, number>();

    // 1. Fire __applyInputMessageForTests same as (a).
    const inputPromise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: TMUX_TARGET,
      currentHostId: HOST_ID,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: SESSION_ID,
      wsSend,
      armWatchdog: armPvSendWatchdog,
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    await inputPromise;

    expect(exec).toHaveBeenCalledTimes(2);

    // 2. At T+300ms (from split-send start): simulate parser seeing enqueue.
    //    parseSessionLine emits kind:"message" role:"user"; dedup Map
    //    inserts contentHash 'sha256(hello).slice(0,32)' with value Date.now();
    //    wsSend fires once with MessageEvent; notifyMatched clears watchdog.
    await vi.advanceTimersByTimeAsync(50);
    const enqueueLine = makeEnqueueLine("hello", "2026-08-20T12:00:00.111Z");
    const enqResult = simulateOnLine(
      enqueueLine,
      SESSION_ID,
      dedupMap,
      wsSend,
      Date.now(),
    );
    expect(enqResult.emitted).toBe(true);
    expect(enqResult.suppressed).toBe(false);

    // Dedup Map now contains the contentHash for "hello".
    expect(dedupMap.has(computeContentHash("hello"))).toBe(true);

    // Count the message-frame emissions so far (should be exactly 1).
    let messageFrames = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "message";
    });
    expect(messageFrames.length).toBe(1);

    // 3. At T+120000ms (2 MINUTES — matches empirical enqueue→dequeue span
    //    per 50-CONTEXT.md § Empirical evidence): parser sees normal user
    //    turn for the SAME content. __applyQueueDedupForTests SUPPRESSES
    //    because rawObj is type:'user' with matching contentHash still in
    //    the dedup Map (unexpired since 2 min < 10 min TTL).
    //
    //    This assertion PROVES the Warning #9 fix: contentHash-only
    //    dedup key (no timestamp) matches across the 2-minute span. If
    //    the dedup regressed to a ±2-second-bucket sketch, this suppress
    //    would fail because the T+300ms enqueue bucket would not equal
    //    the T+120000ms user-turn bucket.
    await vi.advanceTimersByTimeAsync(120_000 - 300);
    const dequeueLine = makeUserTurnLine(
      "hello",
      "2026-08-20T12:02:00Z",
      "u2",
    );
    const dqResult = simulateOnLine(
      dequeueLine,
      SESSION_ID,
      dedupMap,
      wsSend,
      Date.now(),
    );
    expect(dqResult.emitted).toBe(false);
    expect(dqResult.suppressed).toBe(true);

    // 4. Advance past the 20-second watchdog window from arm time (already
    //    long past — we're at T+120s from arm). Assert no lingering escalation.
    await vi.advanceTimersByTimeAsync(30_000);

    // 5. Final assertions:
    //    • wsSend called EXACTLY ONCE with a MessageEvent (from the enqueue).
    //      This is Warning #10's re-verification: the wsSend-called-once
    //      assertion depends on Warning #9's contentHash-only key + 10-min TTL.
    messageFrames = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "message";
    });
    expect(messageFrames.length).toBe(1);

    //    • NEVER paste_send_failed / send_keys_error (watchdog was cleared).
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed" || f?.type === "send_keys_error";
    });
    expect(escalations.length).toBe(0);

    //    • execCommand called exactly 2 times (initial split-send only).
    //      No retry, no full-resend.
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("(c) failure path — no signal for 20s → retry Enter at 2500ms, full-resend at 5500ms, paste_send_failed at 20000ms", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();

    // 1. Fire __applyInputMessageForTests same as (a).
    const inputPromise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: TMUX_TARGET,
      currentHostId: HOST_ID,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: SESSION_ID,
      wsSend,
      armWatchdog: armPvSendWatchdog,
    });

    // 2. Advance past split-send 250ms gate.
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    await inputPromise;

    // Split-send done. execCommand = 2 (body + Enter).
    // Watchdog was armed at approximately T=250ms (post-Enter). Timing below
    // measured from watchdog arm time = 250ms after the outer test t=0.
    expect(exec).toHaveBeenCalledTimes(2);

    // 3. Do NOT feed any JSONL to the parser. Advance to watchdog T+2500ms
    //    (= outer t=2750ms). RETRY_ENTER_MS.
    await vi.advanceTimersByTimeAsync(2500);
    // Watchdog fired retry Enter — 1 more execCommand call.
    expect(exec).toHaveBeenCalledTimes(3);
    const retryCmd = exec.mock.calls[2][1] as string;
    expect(retryCmd).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);
    expect(retryCmd).not.toContain("-l");
    expect(retryCmd).not.toContain("hello");

    // 4. Advance to watchdog T+5500ms (= 3000ms more). FULL_RESEND_MS.
    //    Full re-send: C-u, then -l body, then Enter → 3 more execCommand calls.
    await vi.advanceTimersByTimeAsync(3000);
    expect(exec).toHaveBeenCalledTimes(6);

    const cUCmd = exec.mock.calls[3][1] as string;
    const bodyCmd = exec.mock.calls[4][1] as string;
    const enterCmd = exec.mock.calls[5][1] as string;
    expect(cUCmd).toBe(`tmux send-keys -t '${TMUX_TARGET}' C-u`);
    expect(cUCmd).not.toContain("-l");
    expect(bodyCmd).toContain("send-keys -l -t");
    expect(bodyCmd).toContain(`'${TMUX_TARGET}'`);
    expect(bodyCmd).toContain("'hello'");
    expect(enterCmd).toBe(`tmux send-keys -t '${TMUX_TARGET}' Enter`);
    expect(enterCmd).not.toContain("-l");

    // No paste_send_failed yet.
    let escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(0);

    // 5. Advance to watchdog T+20000ms (= 14500ms more). GIVE_UP_MS.
    //    wsSend called with paste_send_failed frame.
    await vi.advanceTimersByTimeAsync(14_500);
    escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed";
    });
    expect(escalations.length).toBe(1);
    const failFrame = escalations[0][0] as {
      type: string;
      mqid: string;
      reason: string;
    };
    expect(failFrame.type).toBe("paste_send_failed");
    expect(failFrame.mqid).toBe("m1");
    expect(failFrame.reason).toBe("no_signal_after_full_resend");

    // 6. Advance further; assert no further wsSend / execCommand activity.
    const execCountAfter = exec.mock.calls.length;
    const wsSendCountAfter = wsSend.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exec.mock.calls.length).toBe(execCountAfter);
    expect(wsSend.mock.calls.length).toBe(wsSendCountAfter);
  });

  it("(d) retry-Enter path — signal arrives after retry but before full-resend; retry-fired-once invariant holds", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const dedupMap = new Map<string, number>();

    // 1. Fire __applyInputMessageForTests + advance past 250ms split-send.
    const inputPromise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: TMUX_TARGET,
      currentHostId: HOST_ID,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: SESSION_ID,
      wsSend,
      armWatchdog: armPvSendWatchdog,
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    await inputPromise;

    expect(exec).toHaveBeenCalledTimes(2);

    // 2. Advance to watchdog T+2500ms — retry Enter fires (execCommand #3).
    await vi.advanceTimersByTimeAsync(2500);
    expect(exec).toHaveBeenCalledTimes(3);

    // 3. At watchdog T+3000ms (500ms after retry, before 5500ms full-resend):
    //    parser sees matching user-turn JSONL → notifyMatched fires.
    await vi.advanceTimersByTimeAsync(500);
    const line = makeUserTurnLine("hello", "2026-08-20T12:00:03Z", "u1");
    const result = simulateOnLine(
      line,
      SESSION_ID,
      dedupMap,
      wsSend,
      Date.now(),
    );
    expect(result.emitted).toBe(true);

    // 4. Advance well past all remaining watchdog windows.
    await vi.advanceTimersByTimeAsync(30_000);

    // 5. Assertions:
    //    • execCommand call count is EXACTLY 3 (initial body + initial Enter
    //      + retry Enter). NO full-resend (would be 6+), NO retry-again.
    //    This is the retry-fired-once invariant (Fleet directive + D-06):
    //    even though the retry itself didn't "produce" a signal, the
    //    watchdog does not re-fire retry; the signal that eventually
    //    arrived at T+3000 cleared the pending completely.
    expect(exec).toHaveBeenCalledTimes(3);

    //    • wsSend never emitted paste_send_failed or send_keys_error.
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed" || f?.type === "send_keys_error";
    });
    expect(escalations.length).toBe(0);
  });

  it("(e) full-resend path — signal arrives after full-resend but before 20s escalation", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();
    const dedupMap = new Map<string, number>();

    // 1. Fire __applyInputMessageForTests + advance past 250ms split-send.
    const inputPromise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: TMUX_TARGET,
      currentHostId: HOST_ID,
      execCommand: exec,
      data: "hello\r",
      messageQueueItemId: "m1",
      sessionId: SESSION_ID,
      wsSend,
      armWatchdog: armPvSendWatchdog,
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    await inputPromise;

    expect(exec).toHaveBeenCalledTimes(2);

    // 2. Advance to watchdog T+2500ms — retry Enter fires (execCommand #3).
    await vi.advanceTimersByTimeAsync(2500);
    expect(exec).toHaveBeenCalledTimes(3);

    // 3. Advance to watchdog T+5500ms — full-resend fires (execCommand #4, #5, #6).
    await vi.advanceTimersByTimeAsync(3000);
    expect(exec).toHaveBeenCalledTimes(6);

    // 4. At watchdog T+7000ms (1500ms after full-resend, well before 20s):
    //    parser sees matching user-turn JSONL → notifyMatched fires.
    await vi.advanceTimersByTimeAsync(1500);
    const line = makeUserTurnLine("hello", "2026-08-20T12:00:07Z", "u1");
    const result = simulateOnLine(
      line,
      SESSION_ID,
      dedupMap,
      wsSend,
      Date.now(),
    );
    expect(result.emitted).toBe(true);

    // 5. Advance well past the give-up window.
    await vi.advanceTimersByTimeAsync(20_000);

    // 6. Assertions:
    //    • execCommand call count is EXACTLY 6 (initial 2 + retry 1 + full-resend 3).
    expect(exec).toHaveBeenCalledTimes(6);
    //    • wsSend never emitted paste_send_failed or send_keys_error.
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed" || f?.type === "send_keys_error";
    });
    expect(escalations.length).toBe(0);
  });

  it("(h) Fix #2 session-recycle path — mid-armed watchdog on OLD session is cleared; no full-resend into NEW session", async () => {
    // Regression: transitionToActiveNew (session recycle) previously reset
    // buffered per-session state (harnessTasks, backgroundedAgents, plan
    // pending, tail-state, etc.) but did NOT clear:
    //   • queueEnqueueDedup Map    (stale hashes suppress fresh-session frames)
    //   • pv-send-watchdog pending (armed against OLD sessionId — full-resend
    //                               retypes OLD body into NEW composebox)
    //   • pendingMqidsForThisConnection Set (stale mqid bookkeeping)
    //
    // A watchdog armed against the OLD sessionId whose full-resend timer
    // fires post-recycle directly violates the shape invariant "retry
    // never submits an unintended message" AND leaks private OLD-session
    // content into the NEW session's transcript.
    //
    // This scenario:
    //   1. Fires split-send under OLD sessionId ("sess-OLD") → watchdog armed.
    //   2. Populates queueEnqueueDedup with an OLD-session hash + adds mqid
    //      to a mock pendingMqidsForThisConnection Set.
    //   3. Simulates transitionToActiveNew via the extracted cleanup helper
    //      __applyTransitionToActiveNewCleanupForTests(oldSessionId, ...).
    //   4. Advances 30s past every watchdog stage.
    //   5. Asserts:
    //      • NO retry Enter fired (would be a 3rd exec call).
    //      • NO full-resend body C-u/-l/Enter (would be 3 more exec calls).
    //      • NO paste_send_failed frame.
    //      • queueEnqueueDedup.size === 0 (cleared).
    //      • pendingMqidsForThisConnection.size === 0 (mqid removed).
    const OLD_SESSION_ID = "sess-OLD";
    const exec = vi.fn().mockResolvedValue("");
    const wsSend = vi.fn();

    // Per-connection state mirrors — same shapes as production
    // (~L2419 queueEnqueueDedup, ~L2426 pendingMqidsForThisConnection).
    const queueEnqueueDedup = new Map<string, number>();
    const pendingMqidsForThisConnection = new Set<string>();
    const trackMqid = (mqid: string) =>
      pendingMqidsForThisConnection.add(mqid);

    // 1. Fire split-send under OLD_SESSION_ID.
    const inputPromise = __applyInputMessageForTests({
      sshConn: fakeConn,
      currentTmuxSession: TMUX_TARGET,
      currentHostId: HOST_ID,
      execCommand: exec,
      data: "secret-old-body\r",
      messageQueueItemId: "m1",
      sessionId: OLD_SESSION_ID,
      wsSend,
      armWatchdog: armPvSendWatchdog,
      trackMqid,
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    await inputPromise;

    // Body + Enter fired; watchdog armed; mqid tracked.
    expect(exec).toHaveBeenCalledTimes(2);
    expect(pendingMqidsForThisConnection.has("m1")).toBe(true);

    // 2. Populate queueEnqueueDedup with an OLD-session hash to prove the
    //    recycle cleanup wipes it. Real production sets these hashes via
    //    __applyQueueDedupForTests when an enqueue frame parses; we insert
    //    directly to keep the test focused on the cleanup step under test.
    queueEnqueueDedup.set(computeContentHash("secret-old-body"), Date.now());
    expect(queueEnqueueDedup.size).toBe(1);

    // 3. Simulate transitionToActiveNew mid-arm (before any signal arrives).
    //    Fires ~1s after the split-send — well before the 2500ms retry
    //    timer would otherwise trigger. Snapshot exec call count so
    //    post-recycle activity can be measured in isolation from the
    //    (legitimate) initial split-send body+Enter calls.
    await vi.advanceTimersByTimeAsync(1000);
    const execCallCountAtRecycle = exec.mock.calls.length;
    __applyTransitionToActiveNewCleanupForTests({
      oldSessionId: OLD_SESSION_ID,
      queueEnqueueDedup,
      pendingMqidsForThisConnection,
    });

    // Cleanup immediate assertions:
    expect(queueEnqueueDedup.size).toBe(0);
    expect(pendingMqidsForThisConnection.size).toBe(0);

    // 4. Advance 30s — well past every watchdog stage.
    await vi.advanceTimersByTimeAsync(30_000);

    // 5. No escalation fired post-recycle. exec call count is UNCHANGED
    //    from the snapshot at recycle time — only the initial split-send
    //    body + Enter (both pre-recycle) executed. Any additional exec
    //    call would indicate the watchdog fired retry Enter (→ +1),
    //    full-resend (→ +3), or the give-up escalation (via wsSend, not
    //    exec) — all forbidden post-recycle.
    expect(exec.mock.calls.length).toBe(execCallCountAtRecycle);
    // Sanity: those pre-recycle calls were exactly the split-send pair.
    expect(execCallCountAtRecycle).toBe(2);

    // No POST-recycle exec call contains the OLD body — proves full-resend
    // body write did NOT retype OLD content into NEW composebox. Skip the
    // pre-recycle calls (index 0 body, index 1 Enter) because the initial
    // body write LEGITIMATELY contains the OLD body.
    const postRecycleCalls = exec.mock.calls.slice(execCallCountAtRecycle);
    for (const call of postRecycleCalls) {
      const cmd = call[1] as string;
      expect(cmd).not.toContain("secret-old-body");
    }

    // No paste_send_failed / send_keys_error frame.
    const escalations = wsSend.mock.calls.filter((c: unknown[]) => {
      const f = c[0] as { type?: string };
      return f?.type === "paste_send_failed" || f?.type === "send_keys_error";
    });
    expect(escalations.length).toBe(0);
  });

  it.skip("(f) latest-only rendering — see PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14", () => {
    // D-22 (f) latest-only rendering is a FRONTEND-only concern (only newest
    // 'sending' pending shows spinner; every 'failed' shows red). It is fully
    // covered by:
    //   • src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
    //     — Test 14 in the Task 3b "PrettyView — pending render behavior"
    //     describe block, which asserts the exact filter().at(-1) derivation
    //     + strict identity comparison in the render loop.
    //
    // This placeholder exists purely for D-22 audit-trail traceability —
    // greppers scanning for all 7 D-22 scenarios in this file will find the
    // reference to the frontend test that owns the concern.
    //
    // Deliberately skipped (not deleted) per Plan 50-04 Task 1 § action —
    // a placeholder scenario provides D-22 audit-trail traceability without
    // duplicating the frontend rendering test that already owns the concern.
  });

  it("(g) dedup — enqueue then normal user turn 2 min later; exactly ONE wsSend message frame", async () => {
    // This scenario is structurally identical to (b) but focuses assertions
    // on the exact wsSend call count instead of the watchdog side. It is
    // an isolated dedup-mechanism test (no split-send, no watchdog arm).
    const wsSend = vi.fn();
    const dedupMap = new Map<string, number>();

    // 1. At T+0: simulate parser seeing enqueue JSONL for content 'hello'
    //    on SESSION_ID. parseSessionLine returns kind:'message';
    //    __applyQueueDedupForTests inserts contentHash into dedup Map;
    //    wsSend called once.
    const enqueueLine = makeEnqueueLine("hello", "2026-08-20T12:00:00.111Z");
    const enqResult = simulateOnLine(
      enqueueLine,
      SESSION_ID,
      dedupMap,
      wsSend,
      Date.now(),
    );
    expect(enqResult.emitted).toBe(true);
    expect(enqResult.suppressed).toBe(false);
    expect(dedupMap.has(computeContentHash("hello"))).toBe(true);

    // 2. At T+120000ms (2 MINUTES later): normal user turn for content
    //    'hello' on same SESSION_ID. parseSessionLine returns kind:'message';
    //    __applyQueueDedupForTests SUPPRESSES; wsSend NOT called.
    //    Same content-hash-only-key mechanism as scenario (b).
    await vi.advanceTimersByTimeAsync(120_000);
    const dequeueLine = makeUserTurnLine(
      "hello",
      "2026-08-20T12:02:00Z",
      "u2",
    );
    const dqResult = simulateOnLine(
      dequeueLine,
      SESSION_ID,
      dedupMap,
      wsSend,
      Date.now(),
    );
    expect(dqResult.emitted).toBe(false);
    expect(dqResult.suppressed).toBe(true);

    // 3. Assert wsSend total call count: EXACTLY 1.
    //    Only the enqueue produced a wire frame; the dequeue was suppressed.
    expect(wsSend).toHaveBeenCalledTimes(1);
    const only = wsSend.mock.calls[0][0] as {
      type: string;
      role: string;
      content: string;
    };
    expect(only.type).toBe("message");
    expect(only.role).toBe("user");
    expect(only.content).toBe("hello");
  });

  // D-23 audit note (surfaces here for co-location; the audit gate lives in
  // Task 2's grep-based acceptance criteria and the runtime pass of the pre-
  // existing compose-send.test.ts):
  //   • The existing PV send-path tests (compose-send.test.ts,
  //     ComposeBox.test.tsx, ChatMessage.test.tsx, PrettyView.compose-send.test.tsx)
  //     were adapted in place across Plans 50-02 (Test 6 WS-close cleanup)
  //     and 50-03 (prior HARD LOCK sweep + mqid-arg update + local-mqid
  //     rename), NOT wholesale deleted. This integration file ADDS coverage —
  //     it does not supplant the unit-level coverage that already exists
  //     on each seam.
  //   • No test-file deletions in this plan.
  //   • See 50-04-PLAN.md Task 2 for the D-23 baseline audit + adaptation
  //     verification.
});

// Silence the unused clearPvSendWatchdog import — retained for symmetry with
// pv-send-watchdog module surface and available for future scenario
// extensions (e.g., mid-watchdog WS-close simulation in Plan 50-04+).
void clearPvSendWatchdog;
// clearPvSendWatchdogsForSession is used indirectly via
// __applyTransitionToActiveNewCleanupForTests in scenario (h); the import
// stays for direct-invocation availability in future recycle-scenario tests.
void clearPvSendWatchdogsForSession;
