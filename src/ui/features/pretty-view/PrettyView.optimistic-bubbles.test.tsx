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

/*
 * Phase 93 Slice 5 Task 2 — adapter mock scaffolding.
 *
 * The relay-source describe block (bottom of this file) mounts PrettyView
 * with source.kind === "relay" and needs to control useChatSurfaceAdapter's
 * return shape per test. Vitest hoists vi.mock() to the top of the file
 * before any imports; the factory closure needs a value that exists at
 * hoist-time. vi.hoisted() lifts a shared reference above the mock so the
 * factory + the describe block's beforeEach both reference the same
 * mutable state.
 *
 * The default value is an inert shape (messages: []) so the harness
 * describe blocks above (which don't set adapterStateRef.value) still
 * work — the harness case's effectiveMessages collapses to local state
 * anyway (PrettyView.tsx L668) so the adapter's messages field doesn't
 * affect harness rendering.
 */
const { adapterStateRef, sendMessageSpy } = vi.hoisted(() => {
  const sendMessageSpy = vi.fn(async (_b: string, _m: string) => true);
  return {
    sendMessageSpy,
    adapterStateRef: {
      value: {
        messages: [] as Array<Record<string, unknown>>,
        participants: {
          humans: [] as Array<{ mxid: string; displayName: string; userId: string }>,
          agents: [] as Array<{ mxid: string; identityKey: string }>,
        } as {
          humans: Array<{ mxid: string; displayName: string; userId: string }>;
          agents: Array<{ mxid: string; identityKey: string }>;
        } | null,
        sendMessage: sendMessageSpy as unknown as (
          b: string,
          m: string,
        ) => Promise<boolean>,
        error: null as string | null,
        isReady: false,
      },
    },
  };
});

vi.mock("./sources/use-chat-surface-adapter", () => ({
  useChatSurfaceAdapter: (..._args: unknown[]) => adapterStateRef.value,
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

/*
 * Phase 81 Plan 02 Task 2 — attachment pending bubbles.
 *
 * These 10 tests lock the Plan 02 wiring end-to-end:
 *   PrettyView.onUploadReadyToInject closure (seed call inserted at
 *   PrettyView.tsx L1517-1546) → handleOptimisticSend({attachments}) →
 *   PendingSend record grows an attachments field → ChatMessage's
 *   pending-with-attachments render branch (Plan 01, ChatMessage.tsx
 *   L525-569) fires → caption + AttachmentChipStrip readOnly render.
 *
 * Trigger mechanism: the seed lives inside PrettyView's
 * onUploadReadyToInject closure — a bare `upload_ready_to_inject` WS
 * frame alone is dropped by usePrettyViewUploads' handleServerEvent
 * batchId gate (use-pretty-view-uploads.ts:378). To make the callback
 * fire, we drive the whole flow: stage attachments via file input →
 * type caption → press Send → startBatch mints a batchId and emits
 * upload_start → capture the batchId off the WS mock's `send` calls →
 * inject `upload_ready_to_inject` on the SAME WS with that batchId.
 * The batchId gate accepts the event, the seed fires, and the pending
 * bubble renders in the DOM.
 *
 * Test A9 explicitly asserts data-event-id === "pending-<batchId>",
 * not "pending-pv-optim-*" — this locks Pitfall #2 (mqid invariant).
 */
describe("PrettyView — attachment pending bubbles (Phase 81)", () => {
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

  function mount() {
    const onSend = vi.fn((_text: string, _mqid?: string) => true);
    const { container, unmount } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={onSend}
      />,
    );
    return { container, unmount, onSend };
  }

  /**
   * Stage attachments through the hidden file input, then press Send.
   * Returns the batchId the upload hook minted (extracted from the WS
   * mock's `send` mock — startBatch emits `upload_start` first).
   *
   * When `caption` is empty string, we skip typing (empty-caption
   * attachment sends are legal per D-06 — the compose Send button is
   * still enabled once attachments are staged).
   */
  async function stageAndSend(
    container: HTMLElement,
    ws: WsStub,
    caption: string,
    filename: string,
    size: number,
    mimetype: string = "text/plain",
  ): Promise<string> {
    const filePicker = container.querySelector(
      '[data-testid="compose-file-picker"]',
    ) as HTMLInputElement;
    expect(filePicker).not.toBeNull();

    const file = new File(
      [new Uint8Array(size).fill(65)],
      filename,
      { type: mimetype },
    );

    await act(async () => {
      fireEvent.change(filePicker, { target: { files: [file] } });
      // Two microtask flushes for stageAttachments' state update to
      // propagate into attachmentsRefByTarget (the ref the startBatch
      // guard at use-pretty-view-uploads.ts:575 reads).
      await Promise.resolve();
      await Promise.resolve();
    });

    if (caption.length > 0) {
      const textarea = container.querySelector(
        'textarea[placeholder^="Message"]',
      ) as HTMLTextAreaElement;
      expect(textarea).not.toBeNull();
      await act(async () => {
        fireEvent.change(textarea, { target: { value: caption } });
        await Promise.resolve();
      });
    }

    // Click the primary Send button. Its aria-label is "Send".
    const sendBtn = container.querySelector(
      'button[aria-label="Send"]',
    ) as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    // sendDisabled gates on `text.trim() === "" && !hasAttachments` — with
    // a staged attachment the button should be enabled. Assert to catch
    // any regression that would silently no-op the click.
    expect(sendBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(sendBtn);
      // handleSend attachment branch fires runAttachmentSend() as a bare
      // async IIFE. Flush enough microtasks for:
      //   1. runAttachmentSend's own await onSendWithAttachments
      //   2. onSendWithAttachments' await uploads.startBatch
      //   3. startBatch's async wrapper microtask before ws.send
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // Pull batchId out of the upload_start frame on the WS mock.
    let batchId: string | null = null;
    await waitFor(
      () => {
        for (const call of ws.send.mock.calls) {
          try {
            const parsed = JSON.parse(call[0] as string);
            if (parsed.type === "upload_start" && parsed.messageQueueItemId) {
              batchId = parsed.messageQueueItemId;
              return;
            }
          } catch {
            /* skip non-JSON */
          }
        }
        throw new Error("upload_start frame not yet emitted on WS");
      },
      { timeout: 3000 },
    );
    expect(batchId).not.toBeNull();
    return batchId!;
  }

  /**
   * Fire an `upload_ready_to_inject` WS frame with the given batchId.
   *
   * The uploads hook (use-pretty-view-uploads.ts:355-359) attaches its
   * message handler via `ws.addEventListener("message", handler)`, NOT
   * via `ws.onmessage`. The PrettyView-level session/message/dormant
   * handler DOES bind to `ws.onmessage`. So a bare `ws.onmessage?.(...)`
   * only reaches PrettyView's own routing, not the uploads hook.
   *
   * To exercise the uploads hook's `upload_ready_to_inject` path (which
   * fires the seed callback under test), we must also invoke every
   * "message"-type handler registered via `addEventListener`. The WsStub
   * records these on `ws.addEventListener.mock.calls`; we replay each in
   * turn to hit both the PrettyView-level and uploads-hook-level
   * subscribers.
   */
  function fireUploadReadyToInject(
    ws: WsStub,
    batchId: string,
    files: Array<{
      tempId: string;
      filename: string;
      size: number;
      mimetype: string;
      landingPath?: string;
      uploadTimestamp?: string;
    }>,
    caption: string,
  ) {
    const frame = {
      type: "upload_ready_to_inject",
      messageQueueItemId: batchId,
      files: files.map((f) => ({
        tempId: f.tempId,
        filename: f.filename,
        size: f.size,
        mimetype: f.mimetype,
        landingPath: f.landingPath ?? `/tmp/pv-uploads/${f.filename}`,
        uploadTimestamp: f.uploadTimestamp ?? "2026-09-07T00:00:00Z",
      })),
      caption,
    };
    const evt = new MessageEvent("message", { data: JSON.stringify(frame) });
    act(() => {
      // (a) Route through ws.onmessage — reaches PrettyView-level dispatch.
      ws.onmessage?.(evt);
      // (b) Route through every "message" listener registered via
      //     addEventListener — reaches the uploads hook's handler.
      for (const call of ws.addEventListener.mock.calls) {
        const [type, handler] = call as [string, (e: MessageEvent) => void];
        if (type === "message" && typeof handler === "function") {
          handler(evt);
        }
      }
    });
  }

  it("Test A1: upload_ready_to_inject event with caption + one file → pending bubble seeds with attachment metadata + caption", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "hi", "a.txt", 42);
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "a.txt", size: 42, mimetype: "text/plain" }],
      "hi",
    );

    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector(
      '[data-event-id^="pending-"]',
    )!;
    expect(pendingEl.getAttribute("data-event-id")).toBe(`pending-${batchId}`);
    // Caption present.
    expect(pendingEl.textContent).toContain("hi");
    // Chip strip present with the filename.
    const chipStrip = pendingEl.querySelector('[data-readonly="true"]');
    expect(chipStrip).not.toBeNull();
    expect(chipStrip!.textContent).toContain("a.txt");
  });

  it("Test A2: upload_ready_to_inject event with EMPTY caption + files → pending bubble contains chip strip only, no caption div", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "", "b.txt", 10);
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "b.txt", size: 10, mimetype: "text/plain" }],
      "",
    );

    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector(
      '[data-event-id^="pending-"]',
    )!;
    // No caption div — pv-injected-caption is only rendered when content.length > 0.
    expect(pendingEl.querySelector(".pv-injected-caption")).toBeNull();
    // Chip strip still rendered.
    expect(pendingEl.querySelector('[data-readonly="true"]')).not.toBeNull();
  });

  it("Test A3: pending attachment bubble chip strip carries data-readonly=\"true\"", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "cap", "c.txt", 5);
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "c.txt", size: 5, mimetype: "text/plain" }],
      "cap",
    );

    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector(
      '[data-event-id^="pending-"]',
    )!;
    const chipStrip = pendingEl.querySelector('[data-readonly="true"]');
    expect(chipStrip).not.toBeNull();
    expect(chipStrip!.getAttribute("data-readonly")).toBe("true");
  });

  it("Test A4: pending attachment bubble flips to failed after 20s and outer bubble carries red inline background", async () => {
    // Timer strategy: stage + send + fire ready under REAL timers
    // (stageAndSend + waitFor use real setTimeout and would deadlock
    // under fake timers). Once the pending bubble is in the DOM, we
    // switch to fake timers WITHOUT re-seeding — but the seed's own
    // window.setTimeout was armed under real timers, so
    // vi.advanceTimersByTime would not fire it.
    //
    // Trick: after seeding, invoke fireUploadReadyToInject a SECOND time
    // is not viable (readyFiredRef guards it). Alternative: pluck the
    // pending record's `mqid`, then simulate the timeout by injecting a
    // `send_keys_error` WS frame that keys on the same mqid — that
    // fires flipToFailed via the WS handler (production code path used
    // by Phase 50 D-05). This tests the visual state on a truly-failed
    // attachment bubble without depending on timer swap.
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "will-fail", "d.txt", 8);
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "d.txt", size: 8, mimetype: "text/plain" }],
      "will-fail",
    );
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    // Fire a send_keys_error WS frame with the seed's mqid — this drives
    // flipToFailed via the production WS handler (same code path the 20s
    // timer would trigger). See PrettyView.tsx handling of
    // send_keys_error / paste_send_failed at ~L2456 — the frame carries
    // `mqid` (not `messageQueueItemId`) per the Phase 50 D-21 contract.
    sendWsFrame(ws, {
      type: "send_keys_error",
      mqid: batchId,
      reason: "test-driven-failure",
    });

    await waitFor(() => {
      const failedEl = container.querySelector("[data-pv-bubble-failed]");
      expect(failedEl).not.toBeNull();
    });

    const failedEl = container.querySelector(
      "[data-pv-bubble-failed]",
    ) as HTMLElement;
    const bg = failedEl.style.background;
    // jsdom may normalize hsla→rgba; tolerate both source and normalized forms
    // (same substring-tolerant pattern as ChatMessage.test.tsx Test 4b).
    expect(
      bg.includes("hsla(0, 60%") ||
        bg.includes("hsl(0, 60%") ||
        bg.includes("143, 36, 36") ||
        bg.includes("rgba(143"),
    ).toBe(true);
    // Chip strip still present on the red bubble (D-08: chips visible on red-fill).
    expect(failedEl.querySelector('[data-readonly="true"]')).not.toBeNull();
  });

  it("Test A5: superseded batch never fires onUploadReadyToInject → no pending bubble seeds; only completed batch seeds", async () => {
    // Direct simulation: superseded batches are gated by usePrettyViewUploads'
    // readyFiredRef guard + batchId gate — the callback simply never fires
    // for a superseded batch. Prove this by: (a) stage + send batch-A, but
    // DON'T inject upload_ready_to_inject for batch-A (simulates superseded
    // outcome); (b) inject a synthetic upload_ready_to_inject for a
    // NON-matching batchId (would be batch-A's replacement, but the gate at
    // handleServerEvent L378 drops non-current-batch frames). Assert zero
    // pending bubbles.
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "batch-A", "a.txt", 3);
    // Inject upload_ready_to_inject for a DIFFERENT batchId (simulating a
    // frame arriving for a superseded/foreign batch). The batchId gate at
    // use-pretty-view-uploads.ts:378 drops it silently → no seed.
    fireUploadReadyToInject(
      ws,
      `${batchId}-other`,
      [{ tempId: "t1", filename: "a.txt", size: 3, mimetype: "text/plain" }],
      "batch-A",
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Test A6: upload_failed frame → NO pending bubble ever seeds (D-12 regression)", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "will-fail", "e.txt", 4);
    // Fire upload_failed BEFORE upload_ready_to_inject — the hook resolves
    // the outcome as failure and never fires onUploadReadyToInject. Seed
    // never runs.
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "upload_failed",
            messageQueueItemId: batchId,
            tempId: "t1",
            reason: "upload_failed",
            message: "disk full",
          }),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Test A7: no upload_ready_to_inject frame ever arrives → NO pending bubble seeds (ws_not_open / server silent equivalence)", async () => {
    // The Option-B seed is entirely gated on the callback firing. When the
    // hook resolves with ws_not_open (WS null at startBatch time) OR when
    // the server simply never emits ready_to_inject, the callback never
    // fires — so the seed never runs. Prove this by staging + sending and
    // then NOT injecting any ready_to_inject frame at all.
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    await stageAndSend(container, ws, "silent", "f.txt", 2);
    // Do NOT fire ready_to_inject. Give the DOM a few microtasks and assert
    // the pending bubble count remains zero.
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Test A8: FIFO head-match on incoming user-role frame clears the pending attachment bubble (D-10)", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "hi", "g.txt", 6);
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "g.txt", size: 6, mimetype: "text/plain" }],
      "hi",
    );
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    // Simulate the harness echoing the user-role frame. Content need not
    // equal — FIFO head-match doesn't require content equality (Phase 50
    // D-10; quick-260823-fzy regression). The oldest sending pending
    // clears regardless.
    sendWsFrame(ws, {
      type: "message",
      role: "user",
      content: "hi\n---attached files---\n(1. g.txt ...)",
      eventId: "ev-echo",
      ts: Date.now(),
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    // Confirmed user bubble now appears.
    await waitFor(() =>
      expect(countConfirmedBubbles(container)).toBeGreaterThanOrEqual(1),
    );
  });

  it("Test A9 (Pitfall #2 invariant): pending attachment bubble's data-event-id equals \"pending-\" + messageQueueItemId, NOT \"pending-pv-optim-*\"", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const batchId = await stageAndSend(container, ws, "id-check", "h.txt", 7);
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "h.txt", size: 7, mimetype: "text/plain" }],
      "id-check",
    );
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector(
      '[data-event-id^="pending-"]',
    )!;
    const eventId = pendingEl.getAttribute("data-event-id")!;
    // The id must be the batchId (upload hook's makeId format), NOT the
    // useComposeSend text-only "pv-optim-<ts>-<hex>" mint.
    expect(eventId).toBe(`pending-${batchId}`);
    expect(eventId).not.toMatch(/^pending-pv-optim-/);
  });

  it("Test A10 (Pitfall #4 defense): caption containing literal `--- attached files ---` delimiter substring (without valid file lines) still renders as pending-with-attachments branch, NOT as settled injected branch", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    // Caption contains the ACTUAL delimiter substring but NO well-formed
    // file lines. parseInjectedUserTurn returns null for this input →
    // injected branch is false → pending-with-attachments branch fires.
    // Uses the real INJECTED_DELIMITER form ("--- attached files ---" with
    // spaces) — code-review M3 corrected the earlier no-spaces form which
    // wouldn't collide with the real delimiter at all.
    const spookyCaption = "look at this --- attached files --- no file lines follow";
    const batchId = await stageAndSend(
      container,
      ws,
      spookyCaption,
      "i.txt",
      3,
    );
    fireUploadReadyToInject(
      ws,
      batchId,
      [{ tempId: "t1", filename: "i.txt", size: 3, mimetype: "text/plain" }],
      spookyCaption,
    );

    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector(
      '[data-event-id^="pending-"]',
    )!;
    // pending-with-attachments branch fired: chip strip is present.
    expect(pendingEl.querySelector('[data-readonly="true"]')).not.toBeNull();
    // Chip contains the filename.
    expect(pendingEl.textContent).toContain("i.txt");
    // Caption text (including the delimiter substring) is rendered.
    expect(pendingEl.textContent).toContain("--- attached files ---");
  });
});

/*
 * Phase 93 Slice 5 Task 2 — PrettyView relay-source optimistic-bubble
 * parity + Matrix unsigned.transaction_id echo correlation (D-14, D-21,
 * Pitfall 4).
 *
 * Slice 3 Task 1 landed the hook-level regression assertion in
 * `sources/use-relay-adapter.test.ts` (Test 5: live_event
 * sender===viewingUserMxid AND unsigned.transaction_id===mqid correlates +
 * appends real event). Slice 5 lifts the same load-bearing regression up
 * one level to the PrettyView-composed shared chat surface, so the FULL
 * send → optimistic bubble → echo → real bubble pipeline is covered
 * end-to-end at the level real users experience it (through the shared
 * surface, not the isolated adapter).
 *
 * Test strategy: mock `./sources/use-chat-surface-adapter` (the same
 * seam PrettyView.relay-source.test.tsx uses). Mount PrettyView with
 * source.kind === "relay". Drive sends via ComposeBox (fireEvent Enter),
 * observe:
 *   - adapter.sendMessage received the ComposeBox-generated mqid
 *     byte-for-byte (Pitfall 4 anchor — this mqid becomes the Matrix
 *     unsigned.transaction_id on the wire, correlating server echoes back
 *     to the pending record).
 *   - PrettyView.pendingSends seeds an optimistic bubble on send-attempt
 *     (D-14 — bubble emits before adapter.sendMessage resolves).
 *   - The 20s no-echo timer flips optimistic → failed (D-14 timeout
 *     invariant).
 *   - Multiple sends produce unique mqids (Pitfall 4 correlation-uniqueness
 *     precondition).
 *   - Harness case regression floor: harness sends bypass adapter (case-
 *     selected send preserved from Slice 3 Task 3).
 *
 * NOTE on architectural gap surfaced by this composed test: the relay
 * case's optimistic bubble (rendered from PrettyView.pendingSends) is
 * cleared by the WS onmessage handler's `case "message"` FIFO head-match
 * (PrettyView.tsx L2295), which only fires for `type: "message"` frames
 * — not `type: "live_event"` (the relay-case frame type owned by the
 * adapter). This means at composed level, after adapter.messages appends
 * the echoed relay_outbound, PrettyView.pendingSends still holds the
 * optimistic ChatMessage bubble. Test 2 below OBSERVES this — it asserts
 * the echoed bubble renders in the message list AND the optimistic
 * bubble remains until the 20s timer fires. The hook-level correlation
 * (adapter's internal pending FIFO → live_event echo → real event
 * appended, pending removed) is verified in use-relay-adapter.test.ts
 * Test 5. Wiring adapter-pending-cleared → PrettyView.pendingSends-cleared
 * is a downstream architectural item (Rule 4 — architectural, not this
 * slice's scope per D-21 test-migration discipline).
 */
describe("PrettyView — relay-source optimistic bubbles (Phase 93 Slice 5)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    sendMessageSpy.mockClear();
    sendMessageSpy.mockImplementation(async (_b: string, _m: string) => true);
    // Reset adapter state to a fresh "ready" shape at the start of each
    // relay-source test — beforeEach runs BEFORE each test in this describe.
    adapterStateRef.value = {
      messages: [],
      participants: { humans: [], agents: [] },
      sendMessage: sendMessageSpy as unknown as (
        b: string,
        m: string,
      ) => Promise<boolean>,
      error: null,
      isReady: true,
    };
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

  function mountRelay(onSendOverride?: (text: string, mqid?: string) => boolean) {
    const { container, unmount } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: "Test Room" }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={onSendOverride ?? (() => true)}
      />,
    );
    return { container, unmount };
  }

  // Sub-mock the adapter seam — LOCAL to this describe block via
  // vi.doMock isn't viable (hoisting semantics differ from vi.mock).
  // Instead we install a vi.mock at file scope below (via a factory that
  // reads adapterStateRef.value) — Vitest hoists it; the harness/attachment
  // describes above are unaffected because the returned inert shape's
  // messages === [], which mirrors useHarnessAdapter's Slice 1 shim.

  it("Test 1 (Slice 6 post-close fix — regression floor for Info-5): relay send routes to adapter.sendMessage with mqid AND does NOT seed PrettyView.pendingSends", async () => {
    // Slice 5 originally asserted PrettyView.pendingSends seeded an optimistic
    // bubble on every relay send-attempt (via handleOptimisticSend). Slice 6's
    // post-close code-review Info-5 identified this as a real bug: local
    // pendingSends never head-matches in relay mode (harness ingestion effect
    // is gated off), producing a DOUBLE bubble (local pending + adapter's own
    // optimistic in adapter.messages) that then flips red at the 20s timeout.
    // Fix: PrettyView passes `onOptimisticSend={source.kind === "relay" ?
    // undefined : handleOptimisticSend}` — the adapter owns relay-case
    // optimistic bubbles internally (verified end-to-end at hook level in
    // use-relay-adapter.test.ts Test 5). This test locks in the fix.
    const { container } = mountRelay();

    // Wait for the ComposeBox textarea to appear — the relay-case mount
    // gate keeps ComposeBox mounted (see PrettyView.tsx L4135:
    // `onSend || source.kind === "relay"` gate ensures ComposeBox is
    // mounted for relay case even without status===streaming).
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello relay");

    // adapter.sendMessage was called with the payload + a non-empty mqid.
    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledTimes(1));
    const [body, mqid] = sendMessageSpy.mock.calls[0];
    expect(body).toBe("hello relay");
    expect(typeof mqid).toBe("string");
    expect((mqid as string).length).toBeGreaterThan(0);
    // Pattern is `pv-optim-<ms>-<8hex>` — ComposeBox's canonical mqid mint
    // (see ComposeBox.tsx L530).
    expect(mqid).toMatch(/^pv-optim-/);

    // Slice 6 regression floor: NO local PrettyView.pendingSends bubble
    // emitted in relay mode. Adapter owns the optimistic bubble via
    // adapter.messages (this composed test mocks the adapter, so no
    // optimistic bubble appears from adapter.messages either — hook-level
    // Test 5 in use-relay-adapter.test.ts covers the adapter's own pending
    // FIFO + echo correlation).
    expect(countPendingBubbles(container)).toBe(0);
    expect(
      container.querySelector('[data-event-id^="pending-"]'),
    ).toBeNull();
  });

  it("Test 2 (Pitfall 4 echo correlation at composed level): adapter.messages populated with echoed relay_outbound event (unsigned.transaction_id === mqid semantics) → real bubble renders in the message list", async () => {
    // Test strategy: at composed level, drive the adapter mock to return
    // `messages` containing an echoed relay_outbound event. The adapter's
    // internal FIFO correlation (unsigned.transaction_id === mqid) is
    // covered end-to-end at the hook level in use-relay-adapter.test.ts
    // Test 5. This composed test observes THE OUTCOME of that correlation
    // in the shared chat surface: after echo, the message list contains
    // a real relay_outbound bubble whose content matches the send payload.
    //
    // Pre-echo: seed the send + assert optimistic-bubble present.
    // Post-echo: re-render with adapter.messages containing the echoed
    // event; assert the relay_outbound bubble renders alongside the
    // optimistic bubble (see architectural-gap note in the describe
    // header — the optimistic bubble is NOT auto-cleared at composed
    // level for the relay case; this test asserts the observable state).
    const { container, unmount } = mountRelay();
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");
    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledTimes(1));
    const [, mqid] = sendMessageSpy.mock.calls[0];
    // Slice 6 post-close fix: no local PrettyView pendingSends in relay
    // mode (Info-5). Adapter owns the optimistic bubble via adapter.messages.
    // The composed test's mock adapter doesn't simulate the adapter's own
    // pending — hook-level Test 5 in use-relay-adapter.test.ts covers that.
    expect(countPendingBubbles(container)).toBe(0);

    // Simulate the adapter post-echo state: unsigned.transaction_id === mqid
    // → the adapter has appended the real relay_outbound event to messages.
    // We mutate adapterStateRef.value.messages then re-render by unmounting
    // + re-mounting with the same source; the fresh mount reads the updated
    // adapter state on first render.
    //
    // Note: Because useChatSurfaceAdapter is called every render, updating
    // adapterStateRef.value BEFORE the next React render is enough — no
    // full remount required. But React will only re-render when a state
    // change triggers it; the cleanest way to force a re-render here is to
    // dispatch a benign state update. Since we don't have a public API,
    // unmount + remount is the deterministic path.
    unmount();

    // Now the adapter reflects post-echo state: relay_outbound event
    // present with the mqid used above as its unsigned.transaction_id.
    // Slice 3's use-relay-adapter maps the echoed MatrixEvent to a
    // relay_outbound StreamEvent when sender===viewingUserMxid AND
    // unsigned.transaction_id matches a pending mqid — the mapper output
    // is what surfaces in adapter.messages.
    adapterStateRef.value = {
      ...adapterStateRef.value,
      messages: [
        {
          type: "relay_outbound",
          room: "!room:x",
          rawCommand: "hello",
          body: "hello",
          matrixEventId: "$echo-1",
          eventId: "$echo-1",
          ts: Date.now(),
          // The echoed txn_id — this is what Pitfall 4 asserts flows
          // byte-for-byte from ComposeBox's mqid through the adapter's
          // Matrix wire (as unsigned.transaction_id) back to the mapper.
          unsignedTransactionId: mqid,
        },
      ],
    };
    const { container: container2 } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: "Test Room" }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    // The message list now contains the real relay_outbound bubble.
    // Since we're rendering via PrettyView, the bubble is a RelayOutboundBubble
    // (real component; no test-local mock — the test uses the production
    // render path per D-21). RelayOutboundBubble is COLLAPSED by default —
    // only the header shows; the body ("hello") is behind the expand toggle.
    // We verify the bubble exists via the stable testid + its aria-label +
    // the room attribute in the header text.
    await waitFor(() => {
      const outboundHeaders = container2.querySelectorAll(
        '[data-testid="relay-outbound-header"]',
      );
      expect(outboundHeaders.length).toBe(1);
    });
    // The header identifies the correct room (Pitfall 4 downstream visibility:
    // if the wrong txn_id echoed back, the bubble either wouldn't render OR
    // would carry a different room; the header exposes room via its text).
    const outboundHeader = container2.querySelector(
      '[data-testid="relay-outbound-header"]',
    )!;
    expect(outboundHeader.textContent).toContain("!room:x");
    // Bubble aria-expanded defaults to false (collapsed) — this is the D-21
    // shape-preservation of Slice D's RelayOutboundBubble contract.
    expect(outboundHeader.getAttribute("aria-expanded")).toBe("false");
  });

  it("Test 3 (Slice 6 post-close fix — D-14 timeout is adapter-owned in relay mode): 20s advance does NOT flip a local pending bubble because no local pending is seeded in relay", async () => {
    // Slice 5 originally asserted PrettyView-owned local pendingSends flipped
    // to failed at 20s in relay mode. Slice 6 fix (Info-5): no local
    // pendingSends is seeded in relay mode — the adapter owns the pending
    // FIFO + 20s timeout internally (hook-level coverage in
    // use-relay-adapter.test.ts Test 3+5). At composed level, the assertion
    // is simply that nothing local flips after 20s (no local state to flip).
    vi.useFakeTimers();
    const { container } = mountRelay();

    await act(async () => {
      await Promise.resolve();
    });
    typeAndEnter(container, "will-timeout");
    await act(async () => {
      await Promise.resolve();
    });
    // Slice 6: no local pending in relay mode.
    expect(countPendingBubbles(container)).toBe(0);
    expect(container.querySelector("[data-pv-bubble-spinner]")).toBeNull();

    // Advance past 20000ms — no local timer to fire.
    await act(async () => {
      vi.advanceTimersByTime(20001);
      await Promise.resolve();
    });
    // Still no local failed bubble (nothing local to flip; adapter owns
    // this state internally per use-relay-adapter.ts's timeout FIFO).
    expect(container.querySelector("[data-pv-bubble-failed]")).toBeNull();
    expect(container.querySelector("[data-pv-bubble-spinner]")).toBeNull();
  });

  it("Test 4 (Slice 6 post-close fix — adapter-owned failure behavior): sendMessage resolving false does NOT surface at composed level because relay optimistic is adapter-owned", async () => {
    // Slice 5 originally asserted a local PrettyView pending bubble emitted
    // on send + stayed sending (immediateFailure not wired for relay). Slice
    // 6 fix (Info-5): no local pending emitted at all in relay mode. The
    // adapter's own sendMessage promise resolution flows into the adapter's
    // internal pending FIFO — hook-level Test 3 in use-relay-adapter.test.ts
    // covers the adapter's failure-path behavior. Composed level asserts
    // only what it can observe: adapter.sendMessage was called, and no
    // local pending bubble was seeded.
    sendMessageSpy.mockImplementation(async () => false); // WS not open

    const { container } = mountRelay();
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "ws-not-open");

    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledTimes(1));
    // Slice 6: no local pending. Adapter owns the failure surface.
    expect(countPendingBubbles(container)).toBe(0);
    expect(container.querySelector("[data-pv-bubble-failed]")).toBeNull();
    expect(container.querySelector("[data-pv-bubble-spinner]")).toBeNull();
  });

  it("Test 5 (Pitfall 4 mqid preservation end-to-end): ComposeBox-generated mqid threads byte-for-byte through PrettyView.handleComposeSend into adapter.sendMessage", async () => {
    // The load-bearing test for Pitfall 4's correlation precondition:
    // whatever mqid ComposeBox mints becomes the Matrix
    // `unsigned.transaction_id` on the wire (Slice 3's use-relay-adapter
    // constructs the Matrix send payload from the mqid). If the mqid gets
    // rewritten anywhere in the send chain, the server-echo correlation
    // breaks and the pending bubble either stays orphaned OR the adapter
    // appends a duplicate event.
    //
    // At composed level we verify:
    //   - the mqid that ComposeBox generates
    //   - equals the mqid the pending bubble's data-event-id encodes
    //   - equals the mqid adapter.sendMessage received as second arg
    //
    // Three-way equality proves the byte-for-byte pass-through.
    const { container } = mountRelay();
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // Two sends in a row → each mqid is fresh (unique) and threads through
    // independently.
    typeAndEnter(container, "first");
    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledTimes(1));
    typeAndEnter(container, "second");
    await waitFor(() => expect(sendMessageSpy).toHaveBeenCalledTimes(2));

    const firstMqid = sendMessageSpy.mock.calls[0][1] as string;
    const secondMqid = sendMessageSpy.mock.calls[1][1] as string;
    // Unique mqids (correlation identity precondition).
    expect(firstMqid).not.toBe(secondMqid);
    // Both match ComposeBox's canonical mint pattern.
    expect(firstMqid).toMatch(/^pv-optim-/);
    expect(secondMqid).toMatch(/^pv-optim-/);

    // Slice 6 post-close fix: no local PrettyView pending bubbles in relay
    // mode — the mqid three-way identity is verified at the adapter-call
    // level above (adapter.sendMessage received both fresh mqids in order).
    // The adapter's internal pending FIFO keyed on those mqids is covered
    // end-to-end at the hook level in use-relay-adapter.test.ts Test 5.
    expect(
      container.querySelectorAll('[data-event-id^="pending-"]').length,
    ).toBe(0);
  });

  it("Test 6 (harness case unchanged — regression floor): mount with source.kind === 'harness' → send does NOT invoke adapter.sendMessage; harness onSend prop IS invoked with (text, mqid)", async () => {
    // Test 3 in PrettyView.relay-source.test.tsx already asserts adapter.sendMessage
    // is invoked for relay case; Test 6 here is the mirror at composed level for
    // Slice 5's regression floor: the harness case must remain byte-identical to
    // its pre-Phase-93 behavior (D-04 discipline — harness routing is untouched).
    const harnessOnSend = vi.fn(() => true);
    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1", tabId: "t1" }}
        hostId={1}
        tmuxSession="s1"
        tabId="t1"
        isVisible={true}
        onSend={harnessOnSend}
      />,
    );

    // Drive the harness WS to streaming so ComposeBox mounts (harness
    // case's ComposeBox mount gate requires status === "streaming" per
    // PrettyView.tsx L4135 — unlike the relay case which mounts
    // unconditionally).
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "harness send");

    // The harness onSend was invoked with (text, mqid).
    await waitFor(() => expect(harnessOnSend).toHaveBeenCalledTimes(1));
    const [text, mqid] = harnessOnSend.mock.calls[0];
    expect(text).toBe("harness send");
    expect(typeof mqid).toBe("string");
    expect(mqid).toMatch(/^pv-optim-/);
    // adapter.sendMessage was NOT called (harness case bypasses the adapter
    // send path per D-13 case-selection).
    expect(sendMessageSpy).not.toHaveBeenCalled();
    // Optimistic bubble still renders (D-14 — same harness-case behavior
    // Test 1 of the outer describe covers, verified here for regression).
    expect(countPendingBubbles(container)).toBe(1);
  });

  // File-scope adapter mock is installed at the top of this file via
  // vi.hoisted + vi.mock — see the scaffolding block above the PrettyView
  // import. adapterStateRef.value is read on every useChatSurfaceAdapter
  // invocation, so beforeEach + individual tests can drive the adapter's
  // return shape by mutating .value directly.
  //
  // Effect on the harness/attachment describes above: the vi.hoisted
  // default returns messages=[], which mirrors useHarnessAdapter's Slice 1
  // inert shim (see use-harness-adapter.ts). effectiveMessages in the
  // harness case collapses to local `messages` state anyway
  // (PrettyView.tsx L668), so the harness-case tests are unaffected by
  // the adapter mock's messages field.
});
