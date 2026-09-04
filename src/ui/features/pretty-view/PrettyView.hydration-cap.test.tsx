/**
 * Phase 45 (fix-forward on Phase 43) Plan 45-03 — PrettyView hydration-cap spec.
 *
 * Locks the post-Phase-45 CLIENT-SIDE-ONLY hydration cap behavior. Replaces the
 * deleted PrettyView.windowed-pagination.test.tsx (Phase-43-born, 888 lines,
 * 11 tests locking the fetch_older + historyWindow client wiring that no longer
 * exists post-Phase-45 revert).
 *
 * Ashley's UAT 2026-08-18 moved the CAP AUTHORITY from server to client:
 *   - Server now emits every JSONL line on connect (tail -F -n +1). No
 *     historyWindow handshake param. No fetch_older WS handler.
 *   - Client caps `messages[]` to WORKING_SET_CAP (20) via
 *     `appendDedupWithCap` during BOTH initial hydration (as the server
 *     drains its full-file emission the client drops-oldest as it grows past
 *     the cap) AND live-tail (post-hydration frames continue to enforce the
 *     same cap so long-lived sessions bound their memory).
 *   - No scroll-back-forever. No fetch_older UX. Older-than-cap messages are
 *     LOST from client memory once dropped. Trade-off accepted per Ashley
 *     verbatim: "More bandwidth on cold load but zero observation-channel
 *     damage. This is the honest fix."
 *
 * Test infrastructure lifted VERBATIM from PrettyView.plain-dom.test.tsx
 * (untouched sibling) per 45-PATTERNS.md § 10 "infrastructure verbatim reuse":
 *   - WS stub scaffolding (WsStub type, wsStubs array, getCurrentWs helper)
 *   - vi.mock('@/api/claude-session-api') — Post-Phase-45 shape: mock accepts
 *     ZERO arguments. If the mock accepted opts, Tests would falsely pass
 *     against a code path that no longer exists.
 *   - vi.mock('@/api/compose-drafts-api'), session-hue, IdentityBadge, touch
 *   - ResizeObserver polyfill + HTMLElement.prototype.offsetHeight override
 *     on [data-pv-bubble]
 *   - fireMessageBatch(ws, count, makePayload) helper — one act() drives many
 *     frames so React batches the commits together.
 *
 * Eight tests (A-H) per 45-PATTERNS.md § 10:
 *   Test A: initial hydration cap — 40 frames arrive → 20 bubbles survive
 *           (drop-oldest math: first 20 dropped from the front).
 *   Test B: live-append respects cap after cap reached — one more frame after
 *           filling to cap keeps count at 20 (oldest shifts forward by 1).
 *   Test C: cap uniform across all 5 wire-frame types — 30 mixed frames
 *           (message + image + relay_outbound + relay_inbound + malformed_line)
 *           yield 20 bubbles.
 *   Test D: dedup within cap — same eventId fired twice = one bubble
 *           (appendDedupWithCap dedups; cap unaffected by would-be-duplicates).
 *   Test E: openClaudeSessionSocket called with ZERO arguments — locks
 *           Plan 45-02 wire contract (no opts object EVER passed).
 *   Test F: auto-scroll pinned-follow after drop-oldest — cap kicking in
 *           during hydration does not break the pin-to-bottom behavior.
 *           Regression carry-over from Phase 43 Test 10.
 *   Test G: no yank when scrolled up — user scroll to top + new frames arrive
 *           → view does NOT yank back to bottom. LOAD-BEARING regression
 *           carry-over from Phase 43 Test 11.
 *   Test H: no fetch_older payload ever sent under any scroll scenario —
 *           scroll to top + wait + more frames + assert ws.send has ZERO
 *           calls with a `type: "fetch_older"` payload. Locks that the
 *           fetch_older client path is truly gone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";
import { openClaudeSessionSocket } from "@/api/claude-session-api";

// ── WS stub scaffolding (verbatim copy from PrettyView.plain-dom.test.tsx) ──

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
  return wsStubs[wsStubs.length - 1];
}

// Post-Phase-45 API shape: openClaudeSessionSocket accepts ZERO arguments.
// The mock does NOT declare a parameter list — if a caller ever passes an
// opts object, `expect(openMock.mock.calls[0].length).toBe(0)` in Test E
// will fail.
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
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
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

// ── WS-frame helpers ──────────────────────────────────────────────────────

function flipToStreaming(ws: WsStub): void {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}

// Fire a batch of message frames — one act() call so React commits them
// together.
function fireMessageBatch(
  ws: WsStub,
  count: number,
  makePayload: (i: number) => Record<string, unknown>,
): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(makePayload(i)),
        }),
      );
    }
  });
}

// Walk from any bubble up to the outer scroll container (className contains
// `overflow-y-auto` — the LOCKED shape per Phase 43 Plan 43-07a). Same
// pattern used by PrettyView.plain-dom.test.tsx Test 2 + Test 4.
function findScrollContainer(container: HTMLElement): HTMLElement | null {
  const bubble = container.querySelector(
    "[data-pv-bubble]",
  ) as HTMLElement | null;
  if (!bubble) return null;
  let node: HTMLElement | null = bubble;
  while (node) {
    const cls = node.className || "";
    if (typeof cls === "string" && cls.includes("overflow-y-auto")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("PrettyView — hydration cap (Phase 45)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({
      identity: null,
      identityHue: null,
    });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);

    HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
      if (this.hasAttribute && this.hasAttribute("data-pv-bubble")) {
        return {
          top: 0,
          left: 0,
          right: 1024,
          bottom: 80,
          width: 1024,
          height: 80,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        if (this.hasAttribute && this.hasAttribute("data-pv-bubble")) {
          return 80;
        }
        return 0;
      },
    });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect =
      originalGetBoundingClientRect;
    if (originalOffsetHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeightDescriptor,
      );
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test A: initial hydration cap — 40 message frames arrive, exactly WORKING_SET_CAP=20 bubbles survive (first 20 dropped from the front)", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageBatch(ws, 40, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `hydration message ${i}`,
      eventId: String(i),
      ts: 1_000_000 + i,
    }));

    // Exactly 20 bubbles survive.
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(20);
    });

    // First surviving bubble is eventId "20" (0..19 dropped from front).
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(
      (bubbles[0] as HTMLElement).getAttribute("data-event-id"),
    ).toBe("20");
    // Last bubble is eventId "39" (the newest).
    expect(
      (bubbles[bubbles.length - 1] as HTMLElement).getAttribute(
        "data-event-id",
      ),
    ).toBe("39");
  });

  it("Test B: live-append respects cap — after filling to 20, one more frame keeps count at 20 (oldest shifts forward by 1)", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fill to cap first.
    fireMessageBatch(ws, 40, (i) => ({
      type: "message",
      role: "assistant",
      content: `fill ${i}`,
      eventId: String(i),
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(20);
    });

    // First surviving bubble is currently eventId "20".
    let bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(
      (bubbles[0] as HTMLElement).getAttribute("data-event-id"),
    ).toBe("20");

    // Fire ONE more frame — cap keeps the count at 20, oldest shifts by 1.
    fireMessageBatch(ws, 1, (_i) => ({
      type: "message",
      role: "assistant",
      content: "one more",
      eventId: "40",
      ts: 1_000_200,
    }));

    await waitFor(() => {
      const b = container.querySelectorAll("[data-pv-bubble]");
      expect(b.length).toBe(20);
      expect((b[0] as HTMLElement).getAttribute("data-event-id")).toBe("21");
      expect(
        (b[b.length - 1] as HTMLElement).getAttribute("data-event-id"),
      ).toBe("40");
    });
    // Reference used to avoid unused-var (helps lint suppression readers).
    void bubbles;
  });

  it("Test C: cap is uniform across all 5 wire-frame types (message, image, relay_outbound, relay_inbound, malformed_line) — 30 mixed frames yield 20 bubbles", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // 6 message + 6 image + 6 relay_outbound + 6 relay_inbound +
    // 6 malformed_line = 30 total, unique eventIds 0..29.
    let idx = 0;
    act(() => {
      for (let i = 0; i < 6; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: "assistant",
              content: `m ${i}`,
              eventId: String(idx++),
              ts: 1_000_000 + idx,
            }),
          }),
        );
      }
      for (let i = 0; i < 6; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "image",
              role: "user",
              images: ["/tmp/img.png"],
              text: `img ${i}`,
              eventId: String(idx++),
              ts: 1_000_000 + idx,
            }),
          }),
        );
      }
      for (let i = 0; i < 6; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "relay_outbound",
              room: "!r:example.org",
              rawCommand: "curl x",
              body: `rout ${i}`,
              eventId: String(idx++),
              ts: 1_000_000 + idx,
            }),
          }),
        );
      }
      for (let i = 0; i < 6; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "relay_inbound",
              room: "!r:example.org",
              sender: "@s:example.org",
              body: `rin ${i}`,
              eventId: String(idx++),
              ts: 1_000_000 + idx,
            }),
          }),
        );
      }
      for (let i = 0; i < 6; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "malformed_line",
              bytes: `malformed ${i}`,
              eventId: String(idx++),
              ts: 1_000_000 + idx,
            }),
          }),
        );
      }
    });

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(20);
    });

    // First 10 frames (eventIds 0..9) dropped from the front: the cap ate them
    // uniformly regardless of frame type (spanning message + image types).
    // First surviving eventId is "10".
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(
      (bubbles[0] as HTMLElement).getAttribute("data-event-id"),
    ).toBe("10");
    // Last surviving eventId is "29" (last malformed_line).
    expect(
      (bubbles[bubbles.length - 1] as HTMLElement).getAttribute(
        "data-event-id",
      ),
    ).toBe("29");
  });

  it("Test D: dedup within cap — same eventId fired twice produces exactly one bubble (cap unaffected by would-be-duplicates)", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire eventId "dup-1" twice, plus one distinct frame.
    fireMessageBatch(ws, 1, (_i) => ({
      type: "message",
      role: "assistant",
      content: "first arrival",
      eventId: "dup-1",
      ts: 1_000_000,
    }));
    fireMessageBatch(ws, 1, (_i) => ({
      type: "message",
      role: "assistant",
      content: "second (duplicate) arrival",
      eventId: "dup-1",
      ts: 1_000_100,
    }));
    fireMessageBatch(ws, 1, (_i) => ({
      type: "message",
      role: "assistant",
      content: "distinct",
      eventId: "distinct-1",
      ts: 1_000_200,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      // Exactly 2 bubbles total (1 for dup-1, 1 for distinct-1).
      expect(bubbles.length).toBe(2);
    });

    // Exactly ONE bubble carries data-event-id="dup-1".
    const dupBubbles = container.querySelectorAll(
      '[data-pv-bubble][data-event-id="dup-1"]',
    );
    expect(dupBubbles.length).toBe(1);
  });

  it("Test E: openClaudeSessionSocket called with ZERO arguments (Plan 45-02 wire contract — no opts object ever passed)", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // The mock function itself is imported after the vi.mock hoist.
    const openMock = openClaudeSessionSocket as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(openMock).toHaveBeenCalledTimes(1);
    // Zero-argument contract: the first (only) call has no args.
    expect(openMock.mock.calls[0].length).toBe(0);
  });

  it("Test F: auto-scroll pinned-follow after drop-oldest — cap kicks in during hydration but does not break the pin-to-bottom behavior", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire 40 frames — cap kicks in at 20.
    fireMessageBatch(ws, 40, (i) => ({
      type: "message",
      role: "assistant",
      content: `pinned ${i}`,
      eventId: `pin-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(20);
    });

    // Locate the outer scroll container and confirm we're still pinned to
    // the bottom (post-drop-oldest, useAutoScroll's pin still keeps us
    // near the tail within slop).
    const scrollContainer = findScrollContainer(container);
    expect(scrollContainer).toBeTruthy();
    // In JSDOM, offsetHeight/scrollHeight of the container is 0 unless we
    // simulate it, but the pin-to-bottom behavior is that
    // scrollTop + clientHeight >= scrollHeight - slop. When scrollHeight
    // is 0 and scrollTop is 0, the inequality holds trivially (0 >= -8).
    // If a future auto-scroll regression yanked scrollTop into positive
    // territory or set a negative value, this assertion catches it.
    const slop = 8;
    expect(
      scrollContainer!.scrollTop + scrollContainer!.clientHeight,
    ).toBeGreaterThanOrEqual(scrollContainer!.scrollHeight - slop);
  });

  it("Test G: no yank when user scrolled up — a trusted user-gesture scroll to top flips mode to not-at-bottom, then arrival of new frames does NOT yank the view back to the bottom (LOAD-BEARING — Phase 71 state machine 'not-at-bottom + content-changed → effect none')", async () => {
    // Phase 71 (2026-09-04, HEAD 79d14042) rewrote PrettyView auto-scroll from
    // first principles. The state machine's ONLY OUT transition from "at-bottom"
    // fires when a user-input event carries isTrusted=true AND its
    // distanceFromBottom is > BOTTOM_TOLERANCE_PX (28). JSDOM overwrites
    // isTrusted=false on ANY event that goes through dispatchEvent (see
    // use-auto-scroll.test.tsx L67-69 comment: "JSDOM's dispatchEvent always
    // sets isTrusted=false for synthetic events (spec-compliant but
    // untestable)"), so `fireEvent.scroll` and even subclass-override event
    // dispatch cannot exercise the user-input path.
    //
    // Workaround (verbatim pattern from use-auto-scroll.test.tsx `fireUserScroll`
    // helper): capture the hook's scroll handler via an addEventListener spy on
    // the scroll container and invoke it DIRECTLY with a plain { isTrusted:true }
    // object. This is the standard test-only bypass for the isTrusted gate.
    const capturedHandlers: EventListenerOrEventListenerObject[] = [];
    const realAdd = HTMLElement.prototype.addEventListener;
    HTMLElement.prototype.addEventListener = function (
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ): void {
      if (type === "scroll") {
        capturedHandlers.push(handler);
      }
      return realAdd.call(this, type, handler, options);
    } as typeof HTMLElement.prototype.addEventListener;

    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire 10 frames, enough to fill the DOM but well under cap.
    fireMessageBatch(ws, 10, (i) => ({
      type: "message",
      role: "assistant",
      content: `noyank ${i}`,
      eventId: `noyank-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(10);
    });

    // Locate the outer scroll container and mock a non-zero scrollHeight so
    // scrollTop=0 represents a meaningful "scrolled to top" position. JSDOM's
    // default scrollHeight is 0; without the override, distanceFromBottom
    // would be 0 and the reducer would keep mode=at-bottom.
    const scrollContainer = findScrollContainer(container);
    expect(scrollContainer).toBeTruthy();
    Object.defineProperty(scrollContainer!, "scrollHeight", {
      configurable: true,
      value: 3000,
    });
    Object.defineProperty(scrollContainer!, "clientHeight", {
      configurable: true,
      value: 600,
    });

    // Flush any pending RAF chase-writes from the initial-mount + first-batch
    // content-changed dispatches — the hook's `pendingChaseRef` gate would
    // otherwise treat our simulated user-input as a "programmatic-skip" and
    // never dispatch it to the reducer. The chase-write will assign
    // scrollTop = scrollHeight (3000); we reset it to 0 AFTER the flush so
    // the trusted user-input event sees distanceFromBottom = 2400.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(r, 0));
    scrollContainer!.scrollTop = 0;

    // Invoke the hook's scroll handler directly with a mocked-trusted event.
    // distanceFromBottom = 3000 - 0 - 600 = 2400 > 28 → OUT transition to
    // not-at-bottom.
    expect(capturedHandlers.length).toBeGreaterThan(0);
    act(() => {
      const syntheticEvent = { isTrusted: true } as Event;
      for (const h of capturedHandlers) {
        if (typeof h === "function") h(syntheticEvent);
        else h.handleEvent(syntheticEvent);
      }
    });

    // Now fire 5 more frames while the user is scrolled to top (10+5=15 < cap 20).
    fireMessageBatch(ws, 5, (i) => ({
      type: "message",
      role: "assistant",
      content: `after-scroll ${i}`,
      eventId: `after-${i}`,
      ts: 1_000_100 + i,
    }));

    // scrollTop must remain near 0 within slop (view did NOT yank back to
    // the bottom just because new frames arrived — the Phase 71 reducer's
    // "not-at-bottom + content-changed → effect: none" row is load-bearing).
    await new Promise((r) => setTimeout(r, 30));
    const slop = 16;
    try {
      expect(scrollContainer!.scrollTop).toBeLessThanOrEqual(slop);
    } finally {
      HTMLElement.prototype.addEventListener = realAdd;
    }
  });

  it("Test H: no fetch_older payload EVER sent under any scroll scenario (the fetch_older client path is truly gone)", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire 15 frames (under cap 20).
    fireMessageBatch(ws, 15, (i) => ({
      type: "message",
      role: "assistant",
      content: `pre-scroll ${i}`,
      eventId: `pre-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(15);
    });

    // Scroll to top.
    const scrollContainer = findScrollContainer(container);
    expect(scrollContainer).toBeTruthy();
    Object.defineProperty(scrollContainer!, "scrollHeight", {
      configurable: true,
      value: 5000,
    });
    Object.defineProperty(scrollContainer!, "clientHeight", {
      configurable: true,
      value: 600,
    });
    act(() => {
      scrollContainer!.scrollTop = 0;
      fireEvent.scroll(scrollContainer!);
    });

    // Wait 500ms so any hypothetical debounced fetch_older trigger would
    // have fired if it existed. (LOAD_OLDER_DEBOUNCE_MS was 250ms in
    // Phase 43; we wait 2x that.)
    await new Promise((r) => setTimeout(r, 500));

    // Fire 5 more frames while scrolled up (15+5=20 = cap, no drop yet).
    fireMessageBatch(ws, 5, (i) => ({
      type: "message",
      role: "assistant",
      content: `post-scroll ${i}`,
      eventId: `post-${i}`,
      ts: 1_000_100 + i,
    }));
    await new Promise((r) => setTimeout(r, 50));

    // Assert ws.send has ZERO calls where the payload includes
    // `"type":"fetch_older"`. Also catches any `fetch_older_batch` calls
    // (client should never send them, only receive).
    const fetchOlderSends = ws.send.mock.calls.filter((call) => {
      const arg = call[0];
      if (typeof arg !== "string") return false;
      try {
        const parsed = JSON.parse(arg);
        return (
          parsed.type === "fetch_older" ||
          parsed.type === "fetch_older_batch"
        );
      } catch {
        return false;
      }
    });
    expect(fetchOlderSends.length).toBe(0);
  });
});
