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
 * Scope: main-textarea only. The quick-reply buttons are Plan 68-03's
 * responsibility. Compact conversation lives in the task pill, not here
 * (TaskPill.memory.test.tsx).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";

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

// No real network for PrettyView's side requests.
vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      post: vi.fn(),
      get: vi.fn(),
    },
  };
});

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

// Silence unused references — scaffolded for future use.
void countConfirmedBubbles;
void sendWsFrame;

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
    // Auto-accept any kit confirm a test happens to raise.
    autoAnswerKitDialogs({ confirm: true });
  });

  afterEach(() => {
    __resetKitDialogsForTests();
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
      expect(container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull(),
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

  it("Test 3: thumbs-up routes through funnel — 1 bubble showing the ThumbsUp icon, onSend receives 'thumbs up', button clickable when dormant", async () => {
    const { container } = mount();
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Wait for the main textarea to be present (session streaming).
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull(),
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

});
