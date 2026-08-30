/**
 * Phase 50 Plan 03 Task 3a + Task 3b — PrettyView pendingSends state machine
 * and render interleaving tests.
 *
 * The state machine (Task 3a):
 *   - handleOptimisticSend seeds a PendingSend record (mqid, content, sentAt,
 *     state, timer) into the pendingSends array.
 *   - Incoming kind:"message" role:"user" WS frames head-match the oldest
 *     pending by content equality (post-newline-collapse); on match, remove
 *     the pending AND clearTimeout its 20s timer.
 *   - paste_send_failed and send_keys_error WS frames look up the pending
 *     by mqid and flip it to state:'failed'; ComposeBox's overrideText
 *     prop is populated with the failed content so the user can edit-and-
 *     resend.
 *   - 20s client-side timer flips the pending to state:'failed' when the
 *     specific signal never arrives.
 *   - immediateFailure:true on the optimistic seed lands the pending in
 *     state:'failed' from birth (no timer armed).
 *   - Matched bubbles NEVER flip to failed (D-05 invariant enforced via
 *     clearTimeout on match).
 *   - Mqid threading end-to-end (Blocker #4 fix): the mqid ComposeBox
 *     generates flows through onSend → handleComposeSend → the parent's
 *     onSend prop → matched by paste_send_failed frames.
 *   - WS-close + unmount clears all pending timers.
 *   - onOverrideTextConsumed acks the overrideText one-way trigger
 *     (Warning #6 resolution).
 *
 * The render interleaving (Task 3b):
 *   - Optimistic bubbles render AFTER confirmed messages (chronological).
 *   - Only the newest 'sending' pending renders with the spinner
 *     (D-04 latest-only, iMessage-style).
 *   - Every 'failed' pending shows red styling regardless of position.
 *   - Bubble transitions on match are stable (no visual reshuffling).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1]!;
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const useSessionIdentityMock = vi.fn(() => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";

function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}

function typeAndEnter(container: HTMLElement, text: string) {
  const textarea = container.querySelector(
    'textarea[placeholder^="Message"]',
  ) as HTMLTextAreaElement;
  expect(textarea).not.toBeNull();
  act(() => {
    fireEvent.change(textarea, { target: { value: text } });
    fireEvent.keyDown(textarea, { key: "Enter" });
  });
  return textarea;
}

function sendWsFrame(ws: WsStub, frame: unknown) {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  });
}

function countPendingBubbles(container: HTMLElement): number {
  return container.querySelectorAll('[data-event-id^="pending-"]').length;
}

function countConfirmedBubbles(container: HTMLElement): number {
  // Confirmed bubbles have data-event-id NOT starting with "pending-".
  const all = container.querySelectorAll("[data-event-id]");
  let count = 0;
  all.forEach((el) => {
    const id = el.getAttribute("data-event-id") ?? "";
    if (!id.startsWith("pending-")) count++;
  });
  return count;
}

describe("PrettyView — optimistic bubbles state machine (Phase 50 Plan 03 Task 3a)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;
  let onSendMock: ReturnType<typeof vi.fn>;
  let onSendMqidCapture: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
    onSendMqidCapture = undefined;
    onSendMock = vi.fn((text: string, mqid?: string) => {
      onSendMqidCapture = mqid;
      return true;
    });
    // Ensure fake timers not left leaked between tests.
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount(onSendOverride?: (text: string, mqid?: string) => boolean) {
    const { container, unmount } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={onSendOverride ?? onSendMock}
      />,
    );
    return { container, unmount };
  }

  it("Test 1: onOptimisticSend seeds pendingSends and renders an optimistic bubble", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    // The bubble carries the ComposeBox-generated mqid in data-event-id.
    const pendingEl = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pendingEl).not.toBeNull();
    const eventId = pendingEl.getAttribute("data-event-id");
    expect(eventId).toMatch(/^pending-pv-optim-/);
    // Bubble content is the payload.
    expect(pendingEl.textContent).toContain("hello");
    // Sending spinner should be present (only-pending → latest).
    expect(pendingEl.querySelector("[data-pv-bubble-spinner]")).not.toBeNull();
  });

  it("Test 2: matching WS message frame clears the head-pending", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "hello",
      eventId: "ev1",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    // A confirmed bubble should render.
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));
  });

  /*
   * quick-260823-fzy regression guard.
   *
   * Pre-quick-260823-fzy this test asserted the OPPOSITE: pending survived
   * a mismatched-content frame because head-match required byte equality on
   * the collapsed content string. That behavior was the bug — Claude Code
   * re-writes user input into the jsonl frame (slash-command XML wrap,
   * JSON-paste pretty-serialization, and any future CC input transform),
   * so the seed content and the wire-frame content diverge byte-wise, the
   * head-match miss, and the 20s timer flip the pending red — DOUBLE BUBBLE.
   *
   * Real evidence of the shape-gap:
   *   ~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl
   *   ts=2026-08-23T01:41:48.723Z (Ashley's `/fake` send in tina session).
   *
   * Fix: drop byte equality from head-match — FIFO + role + state gate
   * alone. First incoming user-role frame clears the oldest sending pending,
   * period. Send order itself IS the match signal (CC processes user input
   * serially, WS preserves order).
   */
  it("Test 3 (quick-260823-fzy regression guard): incoming user-role frame with mismatched content STILL clears oldest sending pending — FIFO+role+state gate, no content equality", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "goodbye",
      eventId: "ev2",
      ts: Date.now(),
    });
    // Pending cleared under FIFO-only, despite content mismatch;
    // the incoming frame still lands as a confirmed message.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));
  });

  it("Test 3b (quick-260823-fzy): real slash-command XML wrap clears pending under FIFO-only", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // corpus: ~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl ts=2026-08-23T01:41:48.723Z
    typeAndEnter(container, "/fake we can try this one, problem happens 100% of the time");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "<command-message>fake</command-message>\n<command-name>/fake</command-name>\n<command-args>we can try this one, problem happens 100% of the time</command-args>",
      eventId: "ev-fake",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));
  });

  it("Test 3c (quick-260823-fzy): JSON-paste transformation still clears pending under FIFO-only (synthetic)", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // SYNTHETIC — represents Ashley-reported class ("pasting JSON in fail as well"), corpus TBD
    typeAndEnter(container, '{"foo": "bar"}');
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "{\n  \"foo\": \"bar\"\n}",
      eventId: "ev-json",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));
  });

  it("Test 4: FIFO tiebreaker — identical content sent twice; oldest clears first", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const firstMqid = onSendMqidCapture!;
    typeAndEnter(container, "hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(2));
    const secondMqid = onSendMqidCapture!;
    expect(firstMqid).not.toBe(secondMqid);

    // Dispatch one 'hello' → first (oldest) clears; second remains.
    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "hello",
      eventId: "ev1",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const remaining = container.querySelector('[data-event-id^="pending-"]')!;
    expect(remaining.getAttribute("data-event-id")).toBe(`pending-${secondMqid}`);
  });

  it("Test 5: 20s timer flips pending to failed and populates composeOverrideText", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    // Wait for the initial async draft-load effect to settle before typing.
    // With fake timers we still need microtask flushes.
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "will-fail");
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(1);
    // Bubble is sending (spinner present).
    expect(
      container.querySelector("[data-pv-bubble-spinner]"),
    ).not.toBeNull();

    // Advance past 20000ms.
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });
    // Pending should now be in 'failed' state.
    const failedEl = container.querySelector("[data-pv-bubble-failed]");
    expect(failedEl).not.toBeNull();
    // No spinner anymore (mutually exclusive).
    expect(container.querySelector("[data-pv-bubble-spinner]")).toBeNull();

    // ComposeBox textarea repopulated with the failed content.
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("will-fail");
  });

  it("Test 5b: dormant-at-arm-time defers pending flip from T+20s to T+220s (Phase 62 Wave 1 — client-side symmetric widening of Phase 60 backend widening)", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    // Deliver the dormant frame BEFORE the send. This drives setDormant(true)
    // through the WS onmessage `case "dormant":` handler at PrettyView.tsx:1976-1986,
    // which the dormantRef mirror useEffect (PrettyView.tsx:2381-2386) then copies
    // into dormantRef.current on the next tick. handleOptimisticSend will read
    // dormantRef.current === true at arm time (D-62-03).
    sendWsFrame(ws, { type: "dormant", dormant: true });
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "dormant-send-payload");
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(1);
    // Spinner still present — pending is 'sending'.
    expect(
      container.querySelector("[data-pv-bubble-spinner]"),
    ).not.toBeNull();

    // Advance past the NORMAL 20000ms timeout — dormant path defers flip,
    // so pending MUST still be 'sending' here. This is the assertion that
    // fails under today's PrettyView.tsx (which uses a hard-coded 20000ms
    // setTimeout unaware of dormancy) and passes after Task 2's widening.
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });
    expect(container.querySelector("[data-pv-bubble-failed]")).toBeNull();
    expect(
      container.querySelector("[data-pv-bubble-spinner]"),
    ).not.toBeNull();

    // Advance to just past the DORMANT 220000ms ceiling (total from arm =
    // 20001 + 200000 = 220001ms) — pending MUST now be 'failed'.
    await act(async () => {
      vi.advanceTimersByTime(200000);
      await Promise.resolve();
    });
    expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull();
    expect(container.querySelector("[data-pv-bubble-spinner]")).toBeNull();

    // composeOverrideText was populated (same edit-and-resend path as Test 5).
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("dormant-send-payload");
  });

  it("Test 6: paste_send_failed WS frame flips to failed and cancels 20s timer", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "watchdog-fail");
    await act(async () => {
      await Promise.resolve();
    });
    const mqid = onSendMqidCapture!;
    expect(mqid).toBeDefined();

    // Fire paste_send_failed at T+500ms.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    sendWsFrame(ws, {
      type: "paste_send_failed",
      mqid,
      reason: "no_signal_after_full_resend",
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Failed styling present.
    expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull();
    // Advancing timers past 20000ms MUST NOT double-fire (already-failed
    // pending stays failed; the timer was cancelled on flip).
    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });
    // Still exactly one failed pending; no additional state churn.
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(1);
  });

  it("Test 7: send_keys_error WS frame flips to failed", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "exec-throw");
    await act(async () => {
      await Promise.resolve();
    });
    const mqid = onSendMqidCapture!;

    sendWsFrame(ws, {
      type: "send_keys_error",
      mqid,
      reason: "exec_throw_body",
      message: "ETIMEDOUT",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull();
  });

  it("Test 8: immediateFailure=true (onSend returns false) → red immediately with no 20s timer", async () => {
    vi.useFakeTimers();
    // Force onSend to return false — ComposeBox will call
    // onOptimisticSend twice (once immediateFailure:false, once true).
    const onSend = vi.fn(() => false);
    const { container } = mount(onSend);
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "ws-not-ready");
    await act(async () => {
      await Promise.resolve();
    });
    // Immediately failed.
    expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull();
    // Textarea stays populated (ComposeBox preserves the draft on failure).
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("ws-not-ready");
    // No timer should exist to fire later — advancing timers doesn't
    // create additional failed bubbles.
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(1);
  });

  it("Test 9: D-05 invariant — matched bubble never flips to failed even after 20s advance", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "matched-then-time");
    await act(async () => {
      await Promise.resolve();
    });
    // Match at T+2000.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "matched-then-time",
      eventId: "ev-matched",
      ts: Date.now(),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(0);
    // Now advance past the 20000ms mark — the cancelled timer must NOT fire.
    await act(async () => {
      vi.advanceTimersByTime(20000);
      await Promise.resolve();
    });
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(0);
  });

  it("Test 10: once matched, subsequent identical WS frames append normally (no re-match)", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "hello",
      eventId: "ev1",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    // Second frame with same content — no pending to match; just appends.
    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "hello",
      eventId: "ev2",
      ts: Date.now(),
    });
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(2));
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Test 11 (Blocker #4): end-to-end mqid threading — the ComposeBox-generated mqid reaches flipToFailed unchanged", async () => {
    // The load-bearing test that a single mqid flows through:
    //   ComposeBox → onOptimisticSend seeds pendingSends[mqid]
    //   ComposeBox → onSend prop → handleComposeSend → parent onSend receives mqid
    //   Backend paste_send_failed carries the SAME mqid
    //   PrettyView.flipToFailed(mqid) finds the pending under that key
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "single-source");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    // The parent onSend received the ComposeBox mqid.
    const mqidReceivedByParent = onSendMqidCapture!;
    expect(mqidReceivedByParent).toMatch(/^pv-optim-/);
    // The pending bubble's data-event-id is derived from THIS mqid.
    const pending = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pending.getAttribute("data-event-id")).toBe(`pending-${mqidReceivedByParent}`);

    // Simulate a paste_send_failed frame carrying THAT mqid.
    sendWsFrame(ws, {
      type: "paste_send_failed",
      mqid: mqidReceivedByParent,
      reason: "no_signal_after_full_resend",
    });
    // The flipToFailed lookup MUST find the pending under that mqid and
    // convert it to failed (proves the mqid pass-through is intact).
    await waitFor(() =>
      expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull(),
    );
  });

  it("Test 12: WS close cleanup — pending timers cleared, pendingSends emptied", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    // Seed three sends.
    typeAndEnter(container, "one");
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "two");
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "three");
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(3);
    // Simulate WS close.
    act(() => {
      ws.readyState = 3; // CLOSED
      ws.onclose?.();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Pending array emptied.
    expect(countPendingBubbles(container)).toBe(0);
    // Advancing past 20000ms MUST NOT resurrect any failed bubbles
    // (all timers were cleared on close).
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(0);
  });

  it("Test 12b (Fix #3): session_changed WS frame clears pendingSends AND cancels their 20s timers", async () => {
    // Regression: after the backend emits `session_changed` (Phase 3
    // session recycle completed), the frontend's pendingSends array
    // previously SURVIVED with OLD-session entries. Their 20s timers
    // kept running, and when the fresh tail replayed with `-n +1`,
    // content-matching against the replay could incorrectly clear
    // pending bubbles that should have been dropped — or those timers
    // could later flip stale pendings to failed against a NEW session's
    // fresh transcript.
    //
    // Fix (frontend side, symmetric with backend Fix #2c
    // clearPvSendWatchdogsForSession): call clearAllPendingSends() in the
    // session_changed case. Both sides release together.
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });

    // Seed three sends on the OLD session — each starts a 20s timer.
    typeAndEnter(container, "old-one");
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "old-two");
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "old-three");
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(3);

    // Fire session_changed frame — simulates backend transitionToActiveNew
    // completing after a discovery-diff recycle.
    sendWsFrame(ws, {
      type: "session_changed",
      newSessionFile: "/tmp/new-session.jsonl",
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Pending array MUST be empty — every stale OLD-session pending
    // dropped alongside the rest of the session-scoped state
    // (messages, harnessTasks, contextPct, etc.).
    expect(countPendingBubbles(container)).toBe(0);

    // Advance past 20000ms — MUST NOT resurrect any failed bubbles.
    // If clearAllPendingSends did NOT cancel the 20s timers, they would
    // now fire flipToFailed and paint red bubbles for OLD content
    // against the NEW session's transcript.
    await act(async () => {
      vi.advanceTimersByTime(20_001);
      await Promise.resolve();
    });
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(0);
    // Pending bubbles also stay empty (no timer flipped a stale entry).
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Test 13: onOverrideTextConsumed clears composeOverrideText (Warning #6)", async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "override-check");
    await act(async () => {
      await Promise.resolve();
    });
    // Trigger the 20s timer → flipToFailed → composeOverrideText = "override-check"
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("override-check");
    // The ack should have fired (ComposeBox's overrideText useEffect
    // calls onOverrideTextConsumed synchronously with setText), which
    // resets composeOverrideText to null. Regression test: manually
    // clear the textarea and re-render (via re-typing anything) — the
    // useEffect must NOT re-fire and re-populate with "override-check".
    act(() => {
      fireEvent.change(textarea, { target: { value: "" } });
    });
    // Give the effect an opportunity to run again.
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Textarea stays empty — the ack path prevented a stale re-populate.
    expect(textarea.value).toBe("");
  });
});

describe("PrettyView — render latest-only + interleaving (Phase 50 Plan 03 Task 3b)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function mount(onSendOverride?: (text: string, mqid?: string) => boolean) {
    const send = onSendOverride ?? vi.fn(() => true);
    const { container, unmount } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={send}
      />,
    );
    return { container, unmount, send };
  }

  it("Test 14 (D-04): only-latest 'sending' bubble shows spinner", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );
    typeAndEnter(container, "A");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    typeAndEnter(container, "B");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(2));

    // Only ONE spinner should be present in the DOM — on the latest (B).
    const spinners = container.querySelectorAll("[data-pv-bubble-spinner]");
    expect(spinners.length).toBe(1);
    // The spinner belongs to bubble containing "B".
    const spinnerBubble = spinners[0]!.closest('[data-event-id^="pending-"]');
    expect(spinnerBubble).not.toBeNull();
    expect(spinnerBubble!.textContent).toContain("B");
  });

  it("Test 15: failed bubbles render red regardless of position; sending bubble shows spinner", async () => {
    vi.useFakeTimers();
    // Setup: onSend returns false for first call → immediateFailure, then true.
    let callCount = 0;
    const onSend = vi.fn(() => {
      callCount++;
      return callCount > 1; // First call fails, second call succeeds.
    });
    const { container } = mount(onSend);
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "A-fails");
    await act(async () => {
      await Promise.resolve();
    });
    // Bubble A is failed (immediateFailure from onSend returning false).
    typeAndEnter(container, "B-sending");
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(2);
    // Failed bubble present (A).
    expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull();
    // Spinner ONE (B - latest sending).
    expect(container.querySelectorAll("[data-pv-bubble-spinner]").length).toBe(1);
  });

  it("Test 16: bubble insertion order — pendings render AFTER confirmed messages", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    // Send 3 confirmed messages (assistant, doesn't touch pendingSends).
    for (let i = 1; i <= 3; i++) {
      sendWsFrame(ws, {
        type: "message",
        role: "assistant",
        content: `confirmed-${i}`,
        eventId: `ev-c${i}`,
        ts: Date.now() + i,
      });
    }
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(3));

    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );
    typeAndEnter(container, "p1");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    typeAndEnter(container, "p2");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(2));

    // DOM order: confirmed[0], confirmed[1], confirmed[2], pending[0], pending[1].
    const allBubbles = Array.from(
      container.querySelectorAll("[data-event-id]"),
    );
    // Take exactly the first 5 to verify DOM order stable across the interleaving.
    const orderedIds = allBubbles.map((el) => el.getAttribute("data-event-id"));
    // First three are confirmed (non-pending prefix).
    expect(orderedIds[0]).toBe("ev-c1");
    expect(orderedIds[1]).toBe("ev-c2");
    expect(orderedIds[2]).toBe("ev-c3");
    // Last two are pending (in insertion order).
    expect(orderedIds[3]).toMatch(/^pending-pv-optim-/);
    expect(orderedIds[4]).toMatch(/^pending-pv-optim-/);
  });

  it("Test 17: bubble transitions on match — pending disappears, confirmed appears, no reshuffle", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    // One confirmed assistant message first.
    sendWsFrame(ws, {
      type: "message",
      role: "assistant",
      content: "assistant reply",
      eventId: "ev-a1",
      ts: Date.now(),
    });
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));

    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );
    typeAndEnter(container, "user-hello");
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    // Match the pending with a user-message frame.
    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "user-hello",
      eventId: "ev-u1",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    await waitFor(() => expect(countConfirmedBubbles(container)).toBe(2));
    // Order: assistant reply, then user-hello (chronological).
    const allBubbles = Array.from(
      container.querySelectorAll("[data-event-id]"),
    );
    const orderedIds = allBubbles.map((el) => el.getAttribute("data-event-id"));
    expect(orderedIds[0]).toBe("ev-a1");
    expect(orderedIds[1]).toBe("ev-u1");
  });
});
