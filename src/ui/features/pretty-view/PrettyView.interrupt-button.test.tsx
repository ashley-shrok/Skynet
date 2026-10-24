/**
 * shape-interrupt-button — PrettyView end of the interrupt button: hiding
 * cancelled prompts, giving their words back, the agent-side "Interrupted"
 * bubble, the work indicator after a stop, and the greyed-out button while a
 * send is being delivered. Scaffolding mirrors PrettyView.optimistic-bubbles.
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

const useSessionIdentityMock = vi.fn((_name?: unknown) => ({
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

// shape-conversation-view: Stop only renders while the agent is working, so
// these tests hold the session's working signal on (tests that need it off
// flip workingRef.value).
const { workingRef } = vi.hoisted(() => ({ workingRef: { value: true } }));
vi.mock("@/state/session-working-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useSessionIsWorking: () => workingRef.value,
  };
});

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
import {
  publishFleetStatusSessionState,
  __resetForTest as resetWorkingStore,
} from "@/state/session-working-store";

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
    'textarea[placeholder="Write a message…"]',
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

// Optimistic WipBubble (aria-label set in WipBubble.tsx). Doubles as the
// in-flight marker now that pending bubbles carry no spinner.
const WIP_SELECTOR = '[aria-label="Claude is working"]';

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


const PRIMARY = 'textarea[placeholder="Write a message…"]';

describe("PrettyView — interrupt button (shape-interrupt-button)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
    vi.useRealTimers();
    localStorage.clear();
    workingRef.value = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount() {
    const onInterrupt = vi.fn();
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={vi.fn(() => true)}
        onInterrupt={onInterrupt}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() => expect(container.querySelector(PRIMARY)).not.toBeNull());
    return { container, ws, onInterrupt };
  }

  const bubble = (c: HTMLElement, id: string) => c.querySelector(`[data-event-id="${id}"]`);
  const interruptBtn = (c: HTMLElement) =>
    c.querySelector('button[aria-label="Interrupt"]') as HTMLButtonElement;
  const press = (c: HTMLElement) =>
    act(() => {
      fireEvent.click(interruptBtn(c));
    });

  it("a cancelled prompt's bubble disappears on messages_hidden and comes back on messages_unhidden", async () => {
    const { container, ws } = await mount();
    sendWsFrame(ws, { type: "message", role: "user", content: "write a poem", eventId: "u1", ts: 1 });
    await waitFor(() => expect(bubble(container, "u1")).not.toBeNull());

    sendWsFrame(ws, { type: "messages_hidden", eventIds: ["u1"], reason: "cancelled" });
    await waitFor(() => expect(bubble(container, "u1")).toBeNull());

    sendWsFrame(ws, { type: "messages_unhidden", eventIds: ["u1"], reason: "revived" });
    await waitFor(() => expect(bubble(container, "u1")).not.toBeNull());
  });

  it("a hide that arrives before its message (replay order) still hides it", async () => {
    const { container, ws } = await mount();
    sendWsFrame(ws, { type: "messages_hidden", eventIds: ["u9"], reason: "cancelled" });
    sendWsFrame(ws, { type: "message", role: "user", content: "late", eventId: "u9", ts: 1 });
    sendWsFrame(ws, { type: "message", role: "assistant", content: "visible", eventId: "a9", ts: 2 });
    await waitFor(() => expect(bubble(container, "a9")).not.toBeNull());
    expect(bubble(container, "u9")).toBeNull();
  });

  it("cancel verdict gives the words back into the empty compose box", async () => {
    const { container, ws } = await mount();
    press(container);
    sendWsFrame(ws, { type: "interrupt_result", verdict: "cancelled", eventId: "u2", content: "the cancelled words" });
    await waitFor(() =>
      expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).toBe("the cancelled words"),
    );
  });

  it("cancel verdict while the user is typing → a queued box gets the words", async () => {
    const { container, ws } = await mount();
    act(() => {
      fireEvent.change(container.querySelector(PRIMARY)!, { target: { value: "new draft" } });
    });
    press(container);
    sendWsFrame(ws, { type: "interrupt_result", verdict: "cancelled", eventId: "u3", content: "older words" });
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('textarea[placeholder="Queued message…"]')).map(
          (t) => (t as HTMLTextAreaElement).value,
        ),
      ).toEqual(["older words"]),
    );
    expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).toBe("new draft");
  });

  it("a restore is used once: switching conversations never carries the words over", async () => {
    const onInterrupt = vi.fn();
    const { container, rerender } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} onSend={vi.fn(() => true)} onInterrupt={onInterrupt} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() => expect(container.querySelector(PRIMARY)).not.toBeNull());
    press(container);
    sendWsFrame(ws, { type: "interrupt_result", verdict: "cancelled", eventId: "u7", content: "only here" });
    await waitFor(() => expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).toBe("only here"));

    rerender(<PrettyView hostId={1} tmuxSession="s2" isVisible={true} onSend={vi.fn(() => true)} onInterrupt={onInterrupt} />);
    const ws2 = getCurrentWs();
    flipToStreaming(ws2);
    await waitFor(() => expect(container.querySelector(PRIMARY)).not.toBeNull());
    expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).not.toBe("only here");
  });

  it("hidden bubbles reset with the message list: a fresh conversation decides again from its own replay", async () => {
    const onInterrupt = vi.fn();
    const { container, rerender } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} onSend={vi.fn(() => true)} onInterrupt={onInterrupt} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    sendWsFrame(ws, { type: "messages_hidden", eventIds: ["shared-id"], reason: "cancelled" });
    rerender(<PrettyView hostId={1} tmuxSession="s2" isVisible={true} onSend={vi.fn(() => true)} onInterrupt={onInterrupt} />);
    const ws2 = getCurrentWs();
    flipToStreaming(ws2);
    sendWsFrame(ws2, { type: "message", role: "user", content: "shown", eventId: "shared-id", ts: 1 });
    await waitFor(() => expect(bubble(container, "shared-id")).not.toBeNull());
  });

  it("stop and none verdicts give nothing back", async () => {
    const { container, ws } = await mount();
    press(container);
    sendWsFrame(ws, { type: "interrupt_result", verdict: "stopped" });
    sendWsFrame(ws, { type: "interrupt_result", verdict: "none", reason: "agent_output" });
    expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).toBe("");
    expect(container.querySelectorAll('textarea[placeholder="Queued message…"]')).toHaveLength(0);
  });

  it("the interrupted line renders as an agent-side 'Interrupted' bubble and turns the work indicator off", async () => {
    const { container, ws } = await mount();
    act(() => {
      fireEvent.change(container.querySelector(PRIMARY)!, { target: { value: "long job" } });
      fireEvent.keyDown(container.querySelector(PRIMARY)!, { key: "Enter" });
    });
    await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());
    sendWsFrame(ws, { type: "message", role: "user", content: "long job", eventId: "u4", ts: 1 });
    expect(container.querySelector(WIP_SELECTOR)).not.toBeNull();

    sendWsFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Interrupted",
      eventId: "m4",
      ts: 2,
      interrupted: true,
    });
    await waitFor(() => expect(bubble(container, "m4")).not.toBeNull());
    const el = bubble(container, "m4")!;
    expect(el.textContent).toContain("Interrupted");
    expect(el.querySelector(".justify-start") ?? el.closest(".justify-start")).not.toBeNull();
    expect(container.querySelector(WIP_SELECTOR)).toBeNull();
  });

  it("the button is greyed out while a send is still being delivered, and comes back when it lands", async () => {
    const { container, ws } = await mount();
    expect(interruptBtn(container).disabled).toBe(false);
    act(() => {
      fireEvent.change(container.querySelector(PRIMARY)!, { target: { value: "hello" } });
      fireEvent.keyDown(container.querySelector(PRIMARY)!, { key: "Enter" });
    });
    await waitFor(() => expect(interruptBtn(container).disabled).toBe(true));
    sendWsFrame(ws, { type: "message", role: "user", content: "hello", eventId: "u5", ts: 1 });
    await waitFor(() => expect(interruptBtn(container).disabled).toBe(false));
  });

  const feedback = (c: HTMLElement) =>
    c.querySelector('[data-testid="interrupt-feedback"]')?.getAttribute("data-feedback") ?? null;

  it("pressing shows 'Stopping' at once, then the verdict, then the Stop button again", async () => {
    const { container, ws, onInterrupt } = await mount();
    press(container);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(feedback(container)).toBe("stopping");
    expect(container.textContent).toContain("Stopping");
    expect(interruptBtn(container)).toBeNull();

    vi.useFakeTimers();
    sendWsFrame(ws, { type: "interrupt_result", verdict: "cancelled", eventId: "u8", content: null });
    expect(feedback(container)).toBe("cancelled");
    expect(container.textContent).toContain("Cancelled");
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(feedback(container)).toBeNull();
    expect(interruptBtn(container)).not.toBeNull();
  });

  it.each([
    ["stopped", { verdict: "stopped" }, "Stopped"],
    ["nothing", { verdict: "none", reason: "agent_output" }, "Nothing to stop"],
  ] as const)("a %s verdict is shown on the button", async (state, frame, label) => {
    const { container, ws } = await mount();
    act(() => {
      fireEvent.click(interruptBtn(container));
    });
    sendWsFrame(ws, { type: "interrupt_result", ...frame });
    expect(feedback(container)).toBe(state);
    expect(container.textContent).toContain(label);
  });

  it("no verdict within the timeout says 'Failed' rather than spinning forever", async () => {
    const { container } = await mount();
    vi.useFakeTimers();
    act(() => {
      fireEvent.click(interruptBtn(container));
    });
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(feedback(container)).toBe("failed");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(interruptBtn(container)).not.toBeNull();
  });

  it("a server-side failure shows 'Failed' at once", async () => {
    const { container, ws } = await mount();
    press(container);
    sendWsFrame(ws, { type: "interrupt_result", verdict: "failed" });
    expect(feedback(container)).toBe("failed");
  });

  it("with no open connection the press shows 'Failed' and sends nothing", async () => {
    const { container, ws, onInterrupt } = await mount();
    ws.readyState = 3; // CLOSED
    press(container);
    expect(onInterrupt).not.toHaveBeenCalled();
    expect(feedback(container)).toBe("failed");
  });

  it("a verdict with no press behind it changes nothing and gives nothing back", async () => {
    const { container, ws } = await mount();
    sendWsFrame(ws, { type: "interrupt_result", verdict: "cancelled", eventId: "u10", content: "stray words" });
    expect(feedback(container)).toBeNull();
    expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).toBe("");
  });

  it("a verdict arriving after the view was reset is ignored", async () => {
    const { container, ws } = await mount();
    press(container);
    sendWsFrame(ws, { type: "session_changed", sessionFile: "/tmp/y.jsonl" });
    expect(feedback(container)).toBeNull();
    sendWsFrame(ws, { type: "interrupt_result", verdict: "cancelled", eventId: "u11", content: "old words" });
    expect(feedback(container)).toBeNull();
    expect((container.querySelector(PRIMARY) as HTMLTextAreaElement).value).toBe("");
  });

  it("a quick outcome stays up until the server's repeat-press window has passed", async () => {
    const { container, ws } = await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    press(container);
    sendWsFrame(ws, { type: "interrupt_result", verdict: "stopped" });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(feedback(container)).toBe("stopped");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(feedback(container)).toBeNull();
    expect(interruptBtn(container)).not.toBeNull();
  });

  it("a verdict that arrives after 'Failed' still shows what really happened", async () => {
    const { container, ws } = await mount();
    vi.useFakeTimers();
    press(container);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(feedback(container)).toBe("failed");
    sendWsFrame(ws, { type: "interrupt_result", verdict: "stopped" });
    expect(feedback(container)).toBe("stopped");
  });

  it("the interrupted line never counts as delivery of a send still in flight", async () => {
    const { container, ws } = await mount();
    act(() => {
      fireEvent.change(container.querySelector(PRIMARY)!, { target: { value: "in flight" } });
      fireEvent.keyDown(container.querySelector(PRIMARY)!, { key: "Enter" });
    });
    await waitFor(() => expect(container.querySelectorAll('[data-event-id^="pending-"]')).toHaveLength(1));
    sendWsFrame(ws, { type: "message", role: "assistant", content: "Interrupted", eventId: "m6", ts: 1, interrupted: true });
    expect(container.querySelectorAll('[data-event-id^="pending-"]')).toHaveLength(1);
    expect(interruptBtn(container).disabled).toBe(true);
  });
  describe("turn-ending message turns the work indicator off at once", () => {
    const working = (activityMtime: number, stoppedMtime: number) =>
      act(() => {
        publishFleetStatusSessionState("1", {
          hostId: "1",
          tmuxSession: "s1",
          sessionId: "sess-1",
          pid: 42,
          status: "busy",
          backgroundTasks: [],
          updatedAt: 1,
          activityMtime,
          stoppedMtime,
        });
      });

    beforeEach(() => resetWorkingStore());
    afterEach(() => resetWorkingStore());

    it("a mid-turn message keeps it on; the end_turn message turns it off while the signal still says working", async () => {
      const { container, ws } = await mount();
      working(1000, 500);
      await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());

      sendWsFrame(ws, { type: "message", role: "assistant", content: "Looking…", eventId: "a1", ts: 1500 });
      expect(container.querySelector(WIP_SELECTOR)).not.toBeNull();

      sendWsFrame(ws, { type: "message", role: "assistant", content: "Done.", eventId: "a2", ts: 2000, turnEnd: true });
      await waitFor(() => expect(bubble(container, "a2")).not.toBeNull());
      expect(container.querySelector(WIP_SELECTOR)).toBeNull();
    });

    it("comes back when the agent's activity moves past the turn-ending message", async () => {
      const { container, ws } = await mount();
      working(1000, 500);
      sendWsFrame(ws, { type: "message", role: "assistant", content: "Done.", eventId: "a3", ts: 2000, turnEnd: true });
      await waitFor(() => expect(bubble(container, "a3")).not.toBeNull());
      expect(container.querySelector(WIP_SELECTOR)).toBeNull();

      working(3000, 500);
      await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());
    });

    it("a lagging working frame taken before the turn-ending message doesn't re-light it", async () => {
      const { container, ws } = await mount();
      working(400, 500); // idle
      sendWsFrame(ws, { type: "message", role: "assistant", content: "Done.", eventId: "a5", ts: 2000, turnEnd: true });
      await waitFor(() => expect(bubble(container, "a5")).not.toBeNull());
      working(1500, 500); // rising edge, but the activity predates the message
      expect(container.querySelector(WIP_SELECTOR)).toBeNull();
    });

    it("comes back when the user's next message is the latest", async () => {
      const { container, ws } = await mount();
      working(1000, 500);
      sendWsFrame(ws, { type: "message", role: "assistant", content: "Done.", eventId: "a4", ts: 2000, turnEnd: true });
      await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).toBeNull());

      sendWsFrame(ws, { type: "message", role: "user", content: "next", eventId: "u9", ts: 2500 });
      await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());
    });
  });
});
