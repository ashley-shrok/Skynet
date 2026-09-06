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

  it("Test 5: 20s timer flips pending to failed; composebox stays empty (no repopulate)", async () => {
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

    // ComposeBox textarea stays EMPTY after failure — the red bubble is
    // the record of the send; no edit-and-resend repopulate (Ashley
    // 2026-09-02, reversing Phase 50 D-03).
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
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

    // Composebox stays EMPTY after failure (same no-repopulate contract as Test 5).
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("Test 5c: pane_state:dormant hydrates dormantRef after WS reconnect — reconnect-mid-dormancy send arms 220s branch even when type:dormant frame is NOT re-delivered (Phase 76 — signal unification)", async () => {
    // This test proves the Phase 62 miss scenario: after a WS reconnect while
    // dormant, the backend may NOT re-emit {type:"dormant"} (Signal A) because
    // the cached-session fast-path fires instead of the inactive-branch dormancy
    // probe. Phase 76 fix (option a): `case "pane_state"` now also calls
    // setDormant(true) when parsed.state === "dormant", so dormantRef stays
    // authoritative even when Signal A is absent on the fresh connection.
    //
    // Test sequence:
    //   ws1: establish dormancy via BOTH Signal A + Signal B
    //   ws1: close (simulate reconnect)
    //   ws2: deliver ONLY Signal B (pane_state:dormant) — NO Signal A (type:dormant)
    //   ws2: send — assert 220s branch armed (no flip at T+20001ms)
    //         then assert flip at T+220001ms cumulative
    //
    // Under Phase 62 code (before fix): dormantRef.current is false on ws2
    // because case "pane_state" did NOT write setDormant → 20s branch fires →
    // [data-pv-bubble-failed] present at T+20001ms (test FAILS at step 12).
    // Under Phase 76 code (after fix): dormantRef.current is true on ws2
    // because case "pane_state" now writes setDormant(true) → 220s branch fires →
    // [data-pv-bubble-failed] absent at T+20001ms (test PASSES).
    vi.useFakeTimers();
    const { container } = mount();

    // Step 1: Mount and get ws1
    const ws1 = getCurrentWs();
    flipToStreaming(ws1);

    // Let mirror useEffects settle
    await act(async () => {
      await Promise.resolve();
    });

    // Step 2: Establish initial dormancy on ws1 via BOTH signals
    // Signal A: {type:"dormant", dormant:true}
    sendWsFrame(ws1, { type: "dormant", dormant: true });
    // Signal B: {type:"pane_state", state:"dormant"}
    sendWsFrame(ws1, { type: "pane_state", state: "dormant" });

    // Step 3: Let mirror useEffects settle (dormantRef.current syncs after this)
    await act(async () => {
      await Promise.resolve();
    });

    // Step 4: Simulate WS close → triggers PrettyView reconnect path.
    // The onclose handler schedules a reconnect setTimeout (0..2000ms jitter).
    // With fake timers we must advance time to fire it.
    act(() => {
      ws1.readyState = 3; // CLOSED
      ws1.onclose?.();
    });

    // Step 5: Advance past reconnect backoff window (max 2000ms) to let the
    // reconnect timer fire and push a new WS stub. Then flush microtasks.
    await act(async () => {
      vi.advanceTimersByTime(2001);
      await Promise.resolve();
    });

    // Step 6: Get ws2 and assert it is a fresh connection
    const ws2 = getCurrentWs();
    expect(ws2).not.toBe(ws1);
    flipToStreaming(ws2);

    // Step 7: Deliver ONLY Signal B on ws2 — THE RACE: backend did NOT re-emit
    // the {type:"dormant"} (Signal A) frame because cached-session fast-path
    // fired instead of the inactive-branch dormancy probe (the exact Phase 62
    // miss scenario). We intentionally omit any Signal A frame on ws2.
    sendWsFrame(ws2, { type: "pane_state", state: "dormant" });

    // Step 8: Let effects settle
    await act(async () => {
      await Promise.resolve();
    });

    // Step 9: Send a message on the fresh dormant connection
    typeAndEnter(container, "reconnect-dormant-send-payload");

    // Step 10: Pending bubble should be present and spinning
    expect(countPendingBubbles(container)).toBe(1);
    expect(container.querySelector("[data-pv-bubble-spinner]")).not.toBeNull();

    // Step 11: Advance past NORMAL 20000ms ceiling
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });

    // Step 12: [data-pv-bubble-failed] MUST be null (dormant branch armed —
    // 220s ceiling, not 20s). Under Phase 62 code this assertion FAILS because
    // dormantRef.current was false on ws2 (pane_state handler did not call
    // setDormant). Under Phase 76 code this assertion PASSES.
    expect(container.querySelector("[data-pv-bubble-failed]")).toBeNull();
    expect(container.querySelector("[data-pv-bubble-spinner]")).not.toBeNull();

    // Step 13: Advance to just past DORMANT 220000ms ceiling
    // (total from arm = 20001 + 200000 = 220001ms)
    await act(async () => {
      vi.advanceTimersByTime(200000);
      await Promise.resolve();
    });

    // Step 14: Now the widened ceiling fires — bubble must be failed
    expect(container.querySelector("[data-pv-bubble-failed]")).not.toBeNull();
    expect(container.querySelector("[data-pv-bubble-spinner]")).toBeNull();
  });

  it("Test 5d: multi-send during widened wait after reconnect-mid-dormancy — two sends arm 220s branch, both clear in FIFO order when matching frames arrive (D-07 verification of Phase 62 multi-send claim)", async () => {
    // This test verifies Phase 62's multi-send-during-wake claim under real conditions
    // including the exact reconnect-mid-dormancy failure mode that Plan 01 fixed.
    //
    // D-07 verbatim: "Multiple pending sends during a wake all deliver in order when
    // wake completes." Nobody had confirmed this under real conditions.
    //
    // Test sequence:
    //   ws1: establish dormancy via BOTH Signal A + Signal B
    //   ws1: close (simulate reconnect)
    //   ws2: deliver ONLY Signal B (pane_state:dormant) — NO Signal A (type:dormant)
    //   ws2: send "message-one" → countPendingBubbles === 1
    //   ws2: send "message-two" → countPendingBubbles === 2
    //   Advance past T+20001ms → BOTH pendings still exist (220s branch armed for both)
    //   Deliver {type:"message", role:"user", content:"message-one"} → first clears (FIFO)
    //   Deliver {type:"message", role:"user", content:"message-two"} → second clears
    //   Final: countPendingBubbles === 0, countConfirmedBubbles === 2, no failed bubbles
    //
    // PASS → Phase 62 multi-send claim upheld; D-07 verified; phase ships.
    // FAIL → Phase 62 multi-send claim was wrong; escalate to follow-up plan.
    vi.useFakeTimers();
    const { container } = mount();

    // Step 1: Mount and get ws1
    const ws1 = getCurrentWs();
    flipToStreaming(ws1);

    // Let mirror useEffects settle
    await act(async () => {
      await Promise.resolve();
    });

    // Step 2: Establish initial dormancy on ws1 via BOTH signals (Signal A + Signal B)
    sendWsFrame(ws1, { type: "dormant", dormant: true });
    sendWsFrame(ws1, { type: "pane_state", state: "dormant" });

    // Step 3: Let mirror useEffects settle (dormantRef.current syncs after this)
    await act(async () => {
      await Promise.resolve();
    });

    // Step 4: Simulate WS close → triggers PrettyView reconnect path.
    act(() => {
      ws1.readyState = 3; // CLOSED
      ws1.onclose?.();
    });

    // Step 5: Advance past reconnect backoff window (max 2000ms) to fire the
    // reconnect timer, which pushes a new WS stub. Then flush microtasks.
    await act(async () => {
      vi.advanceTimersByTime(2001);
      await Promise.resolve();
    });

    // Step 6: Get ws2 and assert it is a fresh connection
    const ws2 = getCurrentWs();
    expect(ws2).not.toBe(ws1);
    flipToStreaming(ws2);

    // Step 7: Deliver ONLY Signal B on ws2 — THE RACE: backend did NOT re-emit
    // {type:"dormant"} (Signal A) because cached-session fast-path fired instead
    // of the inactive-branch dormancy probe. This is the exact Phase 62 miss
    // scenario. Plan 01 fixed dormantRef to stay authoritative via pane_state:dormant.
    sendWsFrame(ws2, { type: "pane_state", state: "dormant" });

    // Step 8: Let effects settle (dormantRef.current hydrated via pane_state handler)
    await act(async () => {
      await Promise.resolve();
    });

    // Step 9: First send during dormancy-after-reconnect
    typeAndEnter(container, "message-one");
    await act(async () => {
      await Promise.resolve();
    });
    // One pending bubble after first send
    expect(countPendingBubbles(container)).toBe(1);

    // Step 10: Second send during dormancy-after-reconnect (back-to-back)
    typeAndEnter(container, "message-two");
    await act(async () => {
      await Promise.resolve();
    });
    // Two pending bubbles after both sends
    expect(countPendingBubbles(container)).toBe(2);

    // Step 11: No failed bubbles — both sends should be in "sending" state
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(0);

    // Step 12: Advance past NORMAL 20000ms ceiling — BOTH pendings must still exist.
    // This proves BOTH sends armed the 220s branch (D-07 multi-send claim):
    // - Under Phase 62 code (before Plan 01 fix): FIRST send might arm 220s but
    //   the handleOptimisticSend for the second could see stale dormantRef → 20s
    // - Under Phase 76 code (Plan 01 fix): dormantRef stays authoritative for BOTH
    //   sends because pane_state:dormant hydrates it before either send
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });
    // Both pendings still present — 220s branch armed for both sends
    expect(countPendingBubbles(container)).toBe(2);
    // Still no failed bubbles — neither send flipped at 20s
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(0);

    // Step 13: Deliver first matching user-role frame for "message-one" (FIFO head)
    // The FIFO head-match clears the OLDEST pending (message-one sent first).
    sendWsFrame(ws2, {
      type: "message",
      role: "user",
      content: "message-one",
      eventId: "ev-5d-1",
      line: 1,
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Step 14: First pending cleared in FIFO order
    expect(countPendingBubbles(container)).toBe(1);
    // First message now confirmed
    expect(countConfirmedBubbles(container)).toBe(1);

    // Step 15: Deliver second matching user-role frame for "message-two"
    sendWsFrame(ws2, {
      type: "message",
      role: "user",
      content: "message-two",
      eventId: "ev-5d-2",
      line: 2,
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Step 16: Both pendings cleared — FIFO discipline held for both sends
    expect(countPendingBubbles(container)).toBe(0);
    // Both messages now confirmed
    expect(countConfirmedBubbles(container)).toBe(2);

    // Step 17: No failed bubbles anywhere — D-07 verification complete
    expect(container.querySelectorAll("[data-pv-bubble-failed]").length).toBe(0);
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
    // Textarea is CLEARED on WS-not-open (Ashley 2026-09-02) — the red
    // bubble is the record; no need to also keep the text in the textarea.
    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
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

  // (Test 13 deleted 2026-09-02 alongside the Ashley-directed removal of
  // flipToFailed's composeOverrideText populate. The Warning-#6 ack path
  // it exercised is dead in production — nothing sets composeOverrideText
  // to a non-null value anymore. Tests 5 / 5b / 8 cover the new
  // "textarea stays empty after failure" contract.)
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
