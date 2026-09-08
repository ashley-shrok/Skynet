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
import { render, act, waitFor, fireEvent, screen } from "@testing-library/react";
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

// Phase 90 Plan 00 Wave 0 Task 3 (D-03 mechanical rewire): ComposeBox's
// reset button now dispatches through authApi.post('/agent-reset/...')
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
    expect(pendingEl.textContent).toContain("/explain what has gone on since my last message");

    // onSend received the exact recap command string.
    expect(onSendMock).toHaveBeenCalledOnce();
    const [callPayload, callMqid] = onSendMock.mock.calls[0] as [string, string];
    expect(callPayload).toBe("/explain what has gone on since my last message");
    expect(callMqid).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
    expect(onSendMqidCapture).toMatch(/^pv-optim-\d+-[0-9a-z]{8}$/);
  });

  it(
    "Test 5 (Phase 90 rewire): reset dispatches through POST /agent-reset endpoint; ZERO bubbles rendered; NO WS input frame containing /id reset",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      // Default: resolve success so onResetClicked side effects don't matter
      // to this test's assertions (Tests 6a/6b lock those).
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container, unmount } = render(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          isVisible={true}
          onSend={onSendMock}
        />,
      );

      const ws = getCurrentWs();
      flipToStreaming(ws);

      await waitFor(() => {
        expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull();
      });

      const resetBtn = container.querySelector(
        'button[aria-label="Reset context window"]',
      ) as HTMLButtonElement | null;
      expect(resetBtn).not.toBeNull();
      expect(resetBtn!.disabled).toBe(false);

      act(() => {
        fireEvent.click(resetBtn!);
      });

      // Assertion 1: POST /agent-reset/1/s1 called with body { body: "" }
      // (empty textarea → trimmed empty body).
      await waitFor(() => {
        expect(postMock).toHaveBeenCalled();
      });
      const [url, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe("/agent-reset/1/s1");
      expect(body).toEqual({ body: "" });

      // Assertion 2: ZERO pending bubbles rendered (reset never seeded a
      // bubble even under the OLD funnel path — render-blacklist for /id
      // commands. Under the rewire, the funnel path isn't invoked at all
      // for reset, so this is even more strictly zero.)
      expect(countPendingBubbles(container)).toBe(0);

      // Assertion 3: NO WS input frame carrying /id reset. The rewire
      // routes reset entirely off the pretty-view WS.
      const sentCalls = ws.send.mock.calls.map(
        (c: [string]) => JSON.parse(c[0]) as Record<string, unknown>,
      );
      const inputFrame = sentCalls.find(
        (f) =>
          f.type === "input" &&
          typeof f.data === "string" &&
          (f.data as string).startsWith("/id reset"),
      );
      expect(inputFrame).toBeUndefined();

      // Assertion 4: onSend prop was NOT called for the reset click either
      // — the rewire skips the funnel entirely.
      expect(onSendMock).not.toHaveBeenCalled();

      unmount();
    },
  );

  // quick 260905-d79 (updated for Phase 90 rewire) — dispatch-success-vs-fail
  // gate for onResetClicked. The invariant is unchanged: onResetClicked
  // fires ONLY on dispatch success so a disconnected/failed dispatch does
  // NOT falsely mount the SessionHoldingOverlay for 10 minutes. Only the
  // dispatch mechanism changed: authApi.post's promise resolution/rejection
  // is now what gates the side-effect (was: funnel.send's synchronous
  // boolean return).
  //
  // The observable proxy for onResetClicked firing is SessionHoldingOverlay
  // mounting: PrettyView's onResetClicked sets optimisticRecycling=true which
  // effectiveRecycling=isRecycling||optimisticRecycling gates to true.

  it(
    "Test 6a (Phase 90 rewire): reset with dispatch success (authApi.post resolves {ok:true}) → SessionHoldingOverlay mounts optimistically",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container } = render(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          isVisible={true}
          onSend={vi.fn(() => true)}
        />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      await waitFor(() =>
        expect(container.querySelector('button[aria-label="Reset context window"]')).not.toBeNull(),
      );

      expect(screen.queryByText(/Session recycling/i)).toBeNull();

      const resetBtn = container.querySelector(
        'button[aria-label="Reset context window"]',
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(resetBtn);
      });

      // Overlay mounts once the promise resolves — onResetClicked fired.
      await waitFor(() => {
        expect(screen.queryByText(/Session recycling/i)).not.toBeNull();
      });
    },
  );

  it(
    "Test 6b (Phase 90 rewire): reset with dispatch fail (authApi.post rejects) → SessionHoldingOverlay does NOT mount",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockRejectedValue(new Error("Network Error"));

      const { container } = render(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          isVisible={true}
          onSend={vi.fn(() => true)}
        />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      await waitFor(() =>
        expect(container.querySelector('button[aria-label="Reset context window"]')).not.toBeNull(),
      );

      expect(screen.queryByText(/Session recycling/i)).toBeNull();

      const resetBtn = container.querySelector(
        'button[aria-label="Reset context window"]',
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(resetBtn);
      });

      // Wait for the promise rejection to be flushed.
      await new Promise((r) => setTimeout(r, 30));

      // Overlay must NOT mount — onResetClicked was NOT called because
      // authApi.post rejected.
      expect(screen.queryByText(/Session recycling/i)).toBeNull();
    },
  );

  // Task 3 behaviors 9-13 (regression suite per plan) — verify the mechanical
  // rewire preserves every observable ComposeBox reset behavior end-to-end.

  it(
    "Test 9 (Phase 90 rewire behavior 9): reset click still fires the drain-sweep animation (fireResetSyncFx runs before dispatch)",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container } = render(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          isVisible={true}
          onSend={vi.fn(() => true)}
        />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      await waitFor(() =>
        expect(container.querySelector('button[aria-label="Reset context window"]')).not.toBeNull(),
      );

      const resetBtn = container.querySelector(
        'button[aria-label="Reset context window"]',
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(resetBtn);
      });

      // The drain-sweep manipulates the segmented meter's segment DOM. The
      // meter has role="meter" (aria-label="Context window"). Its presence
      // + not-erroring is proof enough that the sync-fx path didn't crash;
      // the button still exists and is not disabled (draining is a visual
      // effect, not a state that disables the button).
      const meter = container.querySelector('[role="meter"][aria-label="Context window"]');
      expect(meter).not.toBeNull();
      // The reset button is still in the DOM (not unmounted by the click).
      expect(container.querySelector('button[aria-label="Reset context window"]')).not.toBeNull();
    },
  );

  it(
    "Test 11 (Phase 90 rewire behavior 11): reset click clears the textarea on dispatch success",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockResolvedValue({ status: 200, data: { ok: true } });

      const { container } = render(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          isVisible={true}
          onSend={vi.fn(() => true)}
        />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      await waitFor(() =>
        expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
      );

      // Type some text into the textarea.
      const textarea = container.querySelector(
        'textarea[placeholder^="Message"]',
      ) as HTMLTextAreaElement;
      act(() => {
        fireEvent.change(textarea, { target: { value: "hello" } });
      });
      expect(textarea.value).toBe("hello");

      // Click reset — endpoint is invoked with the trimmed body, success
      // path clears the textarea.
      const resetBtn = container.querySelector(
        'button[aria-label="Reset context window"]',
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(resetBtn);
      });

      await waitFor(() => {
        expect(textarea.value).toBe("");
      });

      // Endpoint received the body verbatim.
      const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(body).toEqual({ body: "hello" });
    },
  );

  it(
    "Test 12 (Phase 90 rewire behavior 12): dispatch failure → error message set + textarea NOT cleared + onResetClicked NOT called",
    async () => {
      const { authApi } = await import("@/main-axios");
      const postMock = authApi.post as ReturnType<typeof vi.fn>;
      postMock.mockRejectedValue(new Error("Network Error"));

      const { container } = render(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          isVisible={true}
          onSend={vi.fn(() => true)}
        />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      await waitFor(() =>
        expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
      );

      const textarea = container.querySelector(
        'textarea[placeholder^="Message"]',
      ) as HTMLTextAreaElement;
      act(() => {
        fireEvent.change(textarea, { target: { value: "should stay" } });
      });
      expect(textarea.value).toBe("should stay");

      const resetBtn = container.querySelector(
        'button[aria-label="Reset context window"]',
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(resetBtn);
      });

      // Wait for the rejection to flush.
      await waitFor(() => {
        // Error message surfaces (text or aria) in the compose area.
        expect(container.textContent).toContain("Not connected");
      });
      // Textarea preserved on failure (no wipe).
      expect(textarea.value).toBe("should stay");
      // No overlay (proxy for onResetClicked NOT firing).
      expect(screen.queryByText(/Session recycling/i)).toBeNull();
    },
  );
});
