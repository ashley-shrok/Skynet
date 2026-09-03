/**
 * Phase 68 Plan 01 — ComposeBox send-funnel baseline lock.
 *
 * Locks the main-textarea send path through the new useComposeSend hook:
 *   - Exactly one optimistic bubble seeded per Enter
 *   - data-event-id matches ^pending-pv-optim-
 *   - onSend receives (payload, mqid) where mqid matches the expected shape
 *
 * Style: mirrors PrettyView.optimistic-bubbles.test.tsx exactly — same WS stub,
 * same mount() factory rendering <PrettyView> (end-to-end, not <ComposeBox>
 * directly), same mqid capture pattern.
 *
 * Scope: main-textarea only. The other four affordances (queued-message slots,
 * quick-reply buttons, and reset) are Plan 68-03's responsibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";
import { getComposeDraft } from "@/api/compose-drafts-api";

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
  const all = container.querySelectorAll("[data-event-id]");
  let count = 0;
  all.forEach((el) => {
    const id = el.getAttribute("data-event-id") ?? "";
    if (!id.startsWith("pending-")) count++;
  });
  return count;
}

// Silence unused reference — countConfirmedBubbles is scaffolded for future
// use; sendWsFrame is used by Test 5's WS-frame parse so no suppression needed.
void countConfirmedBubbles;

describe("ComposeBox — send funnel (Phase 68 Plan 01)", () => {
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

  it("Test 1: main textarea Enter routes through useComposeSend — seeds bubble, onSend receives well-formed mqid", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello");

    // Exactly one pending optimistic bubble seeded.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    // The pending element's data-event-id is derived from the mqid.
    const pendingEl = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pendingEl).not.toBeNull();
    const eventId = pendingEl.getAttribute("data-event-id");
    expect(eventId).toMatch(/^pending-pv-optim-/);

    // Bubble visible text contains the payload.
    expect(pendingEl.textContent).toContain("hello");

    // onSend was called with (payload, mqid).
    expect(onSendMock).toHaveBeenCalledOnce();
    const [callPayload, callMqid] = onSendMock.mock.calls[0] as [string, string];
    expect(callPayload).toBe("hello");
    expect(callMqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);

    // The captured mqid matches the expected shape.
    expect(onSendMqidCapture).toBeDefined();
    expect(onSendMqidCapture).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);

    // The pending bubble's data-event-id is keyed on the same mqid.
    expect(eventId).toBe(`pending-${onSendMqidCapture}`);
  });

  it("Test 2: queue-slot send routes through funnel — 1 bubble, slot removed, mqid present", async () => {
    // Seed a queue slot via the compose-drafts mock BEFORE mounting so the
    // hydration effect picks it up on first render.
    vi.mocked(getComposeDraft).mockResolvedValueOnce({
      body: "",
      queueSlots: [{ id: "s1", text: "slot payload" }],
    });

    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Wait for the slot textarea to appear in the DOM (async hydration).
    await waitFor(() =>
      expect(container.querySelector('[data-testid="queue-slot-textarea-s1"]')).not.toBeNull(),
    );

    // Find the slot's "Send queued message" button. It lives in the same slot
    // container as the textarea (data-slot-id="s1").
    const slotContainer = container.querySelector('[data-slot-id="s1"]') as HTMLElement;
    expect(slotContainer).not.toBeNull();
    const sendBtn = slotContainer.querySelector('button[aria-label="Send queued message"]') as HTMLButtonElement | null;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn!.disabled).toBe(false);

    // Click the send button.
    act(() => {
      fireEvent.click(sendBtn!);
    });

    // Exactly one pending bubble seeded with the slot's payload.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pendingEl.textContent).toContain("slot payload");

    // onSend received (payload, mqid) — literal payload, not override.
    expect(onSendMock).toHaveBeenCalledOnce();
    const [callPayload, callMqid] = onSendMock.mock.calls[0] as [string, string];
    expect(callPayload).toBe("slot payload");
    expect(callMqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
    expect(onSendMqidCapture).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);

    // Slot row removed from the DOM after successful dispatch.
    await waitFor(() =>
      expect(container.querySelector('[data-slot-id="s1"]')).toBeNull(),
    );
  });

  it("Test 3: thumbs-up routes through funnel — 1 bubble showing the ThumbsUp icon, onSend receives 'thumbs up', button clickable when dormant", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Wait for the main textarea to be present (session streaming).
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // D-05 lockdown: thumbs-up button must NOT be disabled when streaming/dormant.
    const thumbsUpBtn = container.querySelector(
      'button[aria-label="Send \'thumbs up\'"]',
    ) as HTMLButtonElement | null;
    expect(thumbsUpBtn).not.toBeNull();
    expect(thumbsUpBtn!.disabled).toBe(false);

    act(() => {
      fireEvent.click(thumbsUpBtn!);
    });

    // Exactly one pending bubble seeded with the literal "thumbs up" payload,
    // which triggers ChatMessage's isQuickReply path → renders the ThumbsUp
    // lucide icon (aria-label="quick reply") instead of the raw text.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pendingEl.querySelector('[aria-label="quick reply"]')).not.toBeNull();
    expect(pendingEl.textContent).not.toContain("thumbs up"); // isQuickReply replaces text with icon

    // onSend received the LITERAL payload "thumbs up" (backend gets the command).
    expect(onSendMock).toHaveBeenCalledOnce();
    const [callPayload, callMqid] = onSendMock.mock.calls[0] as [string, string];
    expect(callPayload).toBe("thumbs up");
    expect(callMqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
    expect(onSendMqidCapture).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
  });

  it("Test 4: recap routes through funnel — 1 bubble with /explain text, no override, button clickable when dormant", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Wait for session to be ready.
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // D-05 lockdown: recap button must NOT be disabled when streaming/dormant.
    const recapBtn = container.querySelector(
      'button[aria-label="Recap the current situation"]',
    ) as HTMLButtonElement | null;
    expect(recapBtn).not.toBeNull();
    expect(recapBtn!.disabled).toBe(false);

    act(() => {
      fireEvent.click(recapBtn!);
    });

    // Exactly one pending bubble seeded — recap has NO override, bubble text == send text.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
    const pendingEl = container.querySelector('[data-event-id^="pending-"]')!;
    expect(pendingEl.textContent).toContain("/explain the current situation");

    // onSend received the exact recap command string.
    expect(onSendMock).toHaveBeenCalledOnce();
    const [callPayload, callMqid] = onSendMock.mock.calls[0] as [string, string];
    expect(callPayload).toBe("/explain the current situation");
    expect(callMqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
    expect(onSendMqidCapture).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
  });

  it("Test 5: reset routes through funnel — 0 bubbles (render-blacklist honored) BUT WS frame carries messageQueueItemId (wake gate fires)", async () => {
    // Wire a custom onSend that routes through PrettyView's sendInput so the
    // outgoing WS frame ({type:"input", data, messageQueueItemId}) actually
    // reaches ws.send. In production: handleComposeSend → IdentitySessionPane.onSend
    // → pvSendInputRef.current(text, mqid) → sendInput → ws.send. In this test:
    // we capture sendInput via onRegisterSendInput, then provide a custom onSend
    // that calls through — reproducing the full production send chain in-process.
    let capturedSendInput: ((text: string, mqid?: string) => boolean) | null = null;
    const onRegisterSendInputCapture = (fn: (text: string, mqid?: string) => boolean) => {
      capturedSendInput = fn;
    };

    // Custom onSend that (a) records the call for assertion and (b) calls sendInput
    // so the WS frame is actually sent through the stub.
    const customOnSend = vi.fn((text: string, mqid?: string): boolean => {
      onSendMqidCapture = mqid;
      onSendMock(text, mqid); // record in onSendMock for standard assertions
      return capturedSendInput ? capturedSendInput(text, mqid) : false;
    });

    const { container, unmount } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={customOnSend}
        onRegisterSendInput={onRegisterSendInputCapture}
      />,
    );

    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Wait for session to be ready and sendInput to be registered.
    await waitFor(() => {
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull();
      expect(capturedSendInput).not.toBeNull();
    });

    // Reset button is identified by its stable aria-label.
    const resetBtn = container.querySelector(
      'button[aria-label="Reset context window"]',
    ) as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn!.disabled).toBe(false);

    act(() => {
      fireEvent.click(resetBtn!);
    });

    // Render-blacklist honored: reset produces ZERO pending bubbles.
    // (isIdCommand guard in PrettyView.handleOptimisticSend returns early.)
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));

    // Funnel still called onSend with (payload, mqid) — D-03 invariant.
    expect(onSendMock).toHaveBeenCalledOnce();
    const [callPayload, callMqid] = onSendMock.mock.calls[0] as [string, string];
    expect(callPayload).toMatch(/^\/id reset/);
    expect(callMqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
    expect(onSendMqidCapture).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);

    // WAKE-GATE SHAPE ASSERTION: Parse the outgoing WS frames from the stub's
    // send.mock.calls to verify the input frame carries messageQueueItemId.
    // This is the executable verification of the CONTEXT.md reset-wake hypothesis:
    // post-refactor, reset's WS frame IS in the pretty-view submit shape that
    // the Phase 56 backend wake gate keys on.
    //
    // We call through sendInput (captured via onRegisterSendInput) so the WS frame
    // goes to ws.send exactly as it does in production via pvSendInputRef.
    const sentCalls = ws.send.mock.calls.map((c: [string]) => JSON.parse(c[0]) as Record<string, unknown>);
    const inputFrame = sentCalls.find(
      (f) => f.type === "input" && typeof f.data === "string" && (f.data as string).startsWith("/id reset"),
    );
    expect(inputFrame).toBeDefined();
    // The messageQueueItemId in the WS frame MUST equal the captured mqid.
    // If this assertion fails, reset's WS frame is missing the wake-gate field
    // and reset will land in bare bash on dormant sessions (the CONTEXT.md bug).
    expect(inputFrame!.messageQueueItemId).toBe(onSendMqidCapture);

    unmount();
  });
});
