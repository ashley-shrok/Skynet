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
 * responsibility. Condense conversation goes off the funnel entirely (Tests 5+
 * below).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent, screen } from "@testing-library/react";
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

// Condense conversation posts to authApi.post('/identities/<key>/condense')
// instead of routing through the pretty-view WS funnel. Mock authApi.post
// so tests can drive success + failure paths.
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

// Condense conversation lives in the memory gauge's pop-over (tap the gauge,
// then Condense conversation).
async function condense(container: HTMLElement): Promise<void> {
  const gauge = container.querySelector('[data-testid="memory-gauge"]') as HTMLButtonElement | null;
  expect(gauge).not.toBeNull();
  act(() => {
    fireEvent.click(gauge!);
  });
  const btn = (await screen.findByRole("button", { name: "Condense conversation" })) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  act(() => {
    fireEvent.click(btn);
  });
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
    // Condense shows a kit confirm (kitConfirm) first. Auto-accept in tests
    // that click it — the confirm gate itself is covered by
    // ComposeBox.condense.test.tsx.
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

  function mountStreaming() {
    const view = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={onSendMock}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    return { ...view, ws };
  }

  function gaugeEl(container: HTMLElement): HTMLElement {
    return container.querySelector('[data-testid="memory-gauge"]') as HTMLElement;
  }

  it(
    "Test 5: Condense posts /identities/<key>/condense with { hostId, guidance }; ZERO bubbles; NO WS input frame; onSend not called",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container, unmount, ws } = mountStreaming();

      await waitFor(() => {
        expect(container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull();
      });

      await condense(container);

      // No identity resolves for "s1" in this harness, so the key falls back
      // to the tmux session.
      await waitFor(() => {
        expect(postMock).toHaveBeenCalled();
      });
      const [url, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe("/identities/s1/condense");
      expect(body).toEqual({ hostId: 1, guidance: "" });

      // Off the funnel entirely: no bubble, no WS input frame, no onSend.
      expect(countPendingBubbles(container)).toBe(0);
      const sentCalls = ws.send.mock.calls.map(
        (c: [string]) => JSON.parse(c[0]) as Record<string, unknown>,
      );
      expect(sentCalls.find((f) => f.type === "input")).toBeUndefined();
      expect(onSendMock).not.toHaveBeenCalled();

      unmount();
    },
  );

  // onCondenseRequested fires ONLY on request success; PrettyView's handler
  // turns on the optimistic "Condensing…" on the memory pie. A failed
  // request must not leave the pie claiming a condense is under way.

  it(
    "Test 6a: Condense accepted → the pie reads Condensing… optimistically; Send stays usable",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container } = mountStreaming();

      await waitFor(() => expect(gaugeEl(container)).not.toBeNull());
      expect(gaugeEl(container).getAttribute("data-condensing")).toBeNull();

      await condense(container);

      await waitFor(() => {
        expect(gaugeEl(container).getAttribute("data-condensing")).toBe("true");
      });
      expect(gaugeEl(container).textContent).toContain("Condensing…");
      // No overlay, nothing disabled: the user can keep writing and sending.
      expect(screen.queryByText(/Session recycling/i)).toBeNull();
      const textarea = container.querySelector(
        'textarea[placeholder="Write a message…"]',
      ) as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);
      typeAndEnter(container, "still here");
      await waitFor(() => expect(onSendMock).toHaveBeenCalledTimes(1));
    },
  );

  it(
    "Test 6b: Condense request fails → the pie does NOT read Condensing…",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockRejectedValue(new Error("Network Error"));

      const { container } = mountStreaming();

      await waitFor(() => expect(gaugeEl(container)).not.toBeNull());

      await condense(container);

      await waitFor(() => expect(container.textContent).toContain("Not connected"));
      expect(gaugeEl(container).getAttribute("data-condensing")).toBeNull();
    },
  );

  it(
    "Test 11: Condense sends the typed text as guidance and clears the textarea on success",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container } = mountStreaming();

      await waitFor(() =>
        expect(container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull(),
      );

      const textarea = container.querySelector(
        'textarea[placeholder="Write a message…"]',
      ) as HTMLTextAreaElement;
      act(() => {
        fireEvent.change(textarea, { target: { value: "  keep the API notes  " } });
      });

      await condense(container);

      await waitFor(() => {
        expect(textarea.value).toBe("");
      });

      const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(body).toEqual({ hostId: 1, guidance: "keep the API notes" });
    },
  );

  it(
    "Test 12: request failure → error message set + textarea NOT cleared + no Condensing…",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockRejectedValue(new Error("Network Error"));

      const { container } = mountStreaming();

      await waitFor(() =>
        expect(container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull(),
      );

      const textarea = container.querySelector(
        'textarea[placeholder="Write a message…"]',
      ) as HTMLTextAreaElement;
      act(() => {
        fireEvent.change(textarea, { target: { value: "should stay" } });
      });
      expect(textarea.value).toBe("should stay");

      await condense(container);

      await waitFor(() => {
        expect(container.textContent).toContain("Not connected — try again in a moment");
      });
      expect(textarea.value).toBe("should stay");
      expect(gaugeEl(container).getAttribute("data-condensing")).toBeNull();
    },
  );
});
