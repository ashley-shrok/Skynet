/**
 * Phase 43 (replace-pv-virtualization-with-plain-dom-windowed-paginatio)
 * Plan 43-07b — PrettyView windowed-pagination integration tests.
 *
 * Locks the Wave 3 windowing behaviors on top of 43-07a's plain-DOM scroller:
 *   Test  1 — historyWindow=50 appears in the ws-stub URL on connect.
 *   Test  2 — initial-window bounded: 50 message frames render as 50
 *             [data-pv-bubble] children (whatever the backend sends is what
 *             renders — no padding, no duplication).
 *   Test  3 — fetch_older payload shape: near-top scroll → after
 *             LOAD_OLDER_DEBOUNCE_MS ws.send fires EXACTLY once with
 *             {type:"fetch_older", anchorEventId:<first eventId>, count:50}.
 *             NO line-offset field per 43-03 wire contract. Object.keys
 *             asserted exactly (only the three allowed keys, nothing more).
 *   Test  4 — fetch_older_batch prepends with dedup: prepended frames land
 *             ahead of the existing list; a duplicate eventId in the batch
 *             is dropped.
 *   Test  5 — drop-oldest fires when live-append exceeds WORKING_SET_CAP=150:
 *             fire 155 frames, assert ≤ 150 [data-pv-bubble] elements
 *             remain AND the first 5 eventIds are absent from the DOM.
 *   Test  6 — refetch-on-scroll-back rehydrates dropped range: after
 *             drop-oldest, scroll to top; fetch_older fires with anchor =
 *             current messages[0].eventId (not the pre-drop first);
 *             batch response prepends and the previously-dropped eventIds
 *             reappear in the DOM.
 *   Test  7 — loading hint fake-timer sequence: scroll → advance debounce
 *             (251ms) → ws.send fired, hint NOT present → advance threshold
 *             (151ms) → hint IS present → dispatch batch → hint removed.
 *             Total 402ms fake-timer advance in the correct order.
 *   Test  8 — reachedBeginning short-circuits further triggers: after a
 *             batch response with reachedBeginning:true, subsequent
 *             near-top scrolls do not fire fetch_older (ws.send call count
 *             for the fetch_older type stays flat).
 *   Test  9 — error path: batch response with `error` populated triggers
 *             console.warn, clears loading state + fetchInFlightRef (a
 *             fresh scroll AFTER error DOES fire a new fetch_older), and
 *             no auto-retry fires between error and the user's next scroll.
 *   Test 10 — auto-scroll follows when pinned: new message while
 *             scrollTop+clientHeight ≥ scrollHeight-EPSILON preserves
 *             isPinnedToBottom = true and lands scrollTop at scrollHeight.
 *   Test 11 — no yank when scrolled up: with scrollTop = 0, firing a new
 *             message frame does not change scrollTop (LOAD-BEARING
 *             regression from the retired Phase 32 hook).
 *
 * Test infrastructure lifted from PrettyView.virtualization.test.tsx per
 * 43-PATTERNS.md § 10; that file is slated for deletion in plan 43-08.
 *
 * NO real WebSocket, NO real backend — every ws.* is a WsStub captured in
 * `wsStubs[]` and dereferenced via `getCurrentWs()`. The mocked
 * `openClaudeSessionSocket` captures both the URL (built from
 * `opts?.historyWindow`) AND the stub itself so tests can (a) assert on
 * the URL in Test 1 and (b) drive frames + read `ws.send` calls in the rest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

// ── WS stub scaffolding (lifted from PrettyView.virtualization.test.tsx) ──

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
const openCalls: Array<{ url: string; opts: unknown }> = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

// Mocked openClaudeSessionSocket — captures both the URL (constructed from
// `opts?.historyWindow` if supplied) AND the returned WsStub, so Test 1 can
// assert the historyWindow query param appears in the URL exactly as the
// production factory would emit it.
vi.mock("@/api/claude-session-api", async () => {
  // Preserve the real runtime exports for sendFetchOlder + isFetchOlderBatchEvent —
  // PrettyView imports and uses them, and reproducing their behavior in the
  // mock would be error-prone. Only openClaudeSessionSocket is faked.
  const actual = await vi.importActual<typeof import("@/api/claude-session-api")>(
    "@/api/claude-session-api",
  );
  return {
    ...actual,
    openClaudeSessionSocket: vi.fn((opts?: { historyWindow?: number }) => {
      const hw = opts?.historyWindow;
      const qp =
        typeof hw === "number" && Number.isFinite(hw) && hw > 0
          ? `?historyWindow=${Math.floor(hw)}`
          : "";
      const url = `ws://mock/claude-session/websocket/${qp}`;
      openCalls.push({ url, opts: opts ?? null });
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
      return ws as unknown as WebSocket;
    }),
  };
});

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: vi.fn(() => ({ identity: null, identityHue: null })),
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

function fireWsMessage(ws: WsStub, payload: object): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

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

/**
 * Simulates a fetch_older_batch response. Frames are the array of
 * historical ParsedLine-shaped events (typed `unknown[]` on the wire per
 * 43-03's FetchOlderBatchEvent). `reachedBeginning` and `error` are
 * optional and mirror the server's shape.
 */
function fireFetchOlderBatch(
  ws: WsStub,
  frames: Array<Record<string, unknown>>,
  opts?: { reachedBeginning?: boolean; error?: string },
): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "fetch_older_batch",
          frames,
          ...(opts?.reachedBeginning ? { reachedBeginning: true } : {}),
          ...(opts?.error ? { error: opts.error } : {}),
        }),
      }),
    );
  });
}

/**
 * Simulates a user scroll event. Overrides `scrollTop` (and, if supplied,
 * `scrollHeight` / `clientHeight`) on the element AND dispatches a native
 * `scroll` event under act() so PrettyView's near-top-scroll listener sees
 * the new geometry.
 */
function firePrettyViewScroll(
  el: HTMLElement,
  scrollTop: number,
  opts?: { scrollHeight?: number; clientHeight?: number },
): void {
  Object.defineProperty(el, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  if (opts?.scrollHeight != null) {
    Object.defineProperty(el, "scrollHeight", {
      value: opts.scrollHeight,
      writable: true,
      configurable: true,
    });
  }
  if (opts?.clientHeight != null) {
    Object.defineProperty(el, "clientHeight", {
      value: opts.clientHeight,
      writable: true,
      configurable: true,
    });
  }
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

/** Walks up from a [data-pv-bubble] child to find the outer scroll container. */
function getOuterScrollEl(container: HTMLElement): HTMLElement {
  const bubble = container.querySelector("[data-pv-bubble]") as HTMLElement | null;
  if (!bubble) throw new Error("No [data-pv-bubble] element yet — fire frames first");
  let node: HTMLElement | null = bubble;
  while (node) {
    const cls = (node.className as string) || "";
    if (typeof cls === "string" && cls.includes("overflow-y-auto")) {
      return node;
    }
    node = node.parentElement;
  }
  throw new Error("Could not find outer scroll container");
}

// Type helper — the parsed shape of a JSON payload passed to ws.send.
type FetchOlderSentShape = {
  type: string;
  anchorEventId?: string;
  count?: number;
  [k: string]: unknown;
};

/** Extracts every ws.send call whose parsed JSON has type === "fetch_older". */
function getFetchOlderSends(ws: WsStub): FetchOlderSentShape[] {
  return ws.send.mock.calls
    .map((c) => c[0] as string)
    .map((raw) => {
      try {
        return JSON.parse(raw) as FetchOlderSentShape;
      } catch {
        return { type: "__unparseable__" };
      }
    })
    .filter((p) => p.type === "fetch_older");
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("PrettyView windowed pagination — Phase 43 Plan 43-07b", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    openCalls.length = 0;
    // Spy on console.warn for Test 9's error-path assertion.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    warnSpy.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Real timers between tests — individual tests opt in via vi.useFakeTimers().
    vi.useRealTimers();
  });

  it("Test 1: historyWindow=50 on connect — WS URL contains ?historyWindow=50", () => {
    render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    // The mocked openClaudeSessionSocket captures the URL built from
    // opts.historyWindow. The plan's locked constant INITIAL_WINDOW=50.
    expect(openCalls.length).toBeGreaterThanOrEqual(1);
    const url = openCalls[openCalls.length - 1].url;
    expect(url).toContain("historyWindow=50");
  });

  it("Test 2: initial-window bounded — 50 message frames render as 50 [data-pv-bubble] elements", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    fireMessageBatch(ws, 50, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(50);
    });
  });

  // Plan 45-02: `it.skip` — exercises the fetch_older client path (sendFetchOlder,
  // ws.send with type:"fetch_older" payload) that Plan 45-02 has removed from the
  // frontend API surface. Whole file is scheduled for delete-and-recreate in Plan
  // 45-03 (per PATTERNS.md § 10); the skip keeps fleet-standing-directive-1 (never
  // leave tests failing) satisfied until 45-03 lands.
  it.skip("Test 3: fetch_older payload shape — near-top scroll fires ws.send exactly once with {type, anchorEventId, count}, no line-offset field", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    // Flip to streaming + fire 50 frames (fills the initial window).
    // Under fake timers, act() still commits synchronously.
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
        }),
      );
      for (let i = 0; i < 50; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: i % 2 === 0 ? "user" : "assistant",
              content: `msg ${i}`,
              eventId: `evt-${i}`,
              ts: 1_000_000 + i,
            }),
          }),
        );
      }
    });

    // Wait until the bubbles have mounted (fake timers don't affect
    // React commit — the microtask queue drains via act()).
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(bubbles.length).toBe(50);

    // Now fire a near-top scroll and clear the ws.send calls that happened
    // during handshake (connectToPane etc.) so we can isolate the
    // fetch_older payload.
    const scrollEl = getOuterScrollEl(container);
    ws.send.mockClear();

    // Trigger near-top scroll — scrollTop within NEAR_TOP_TRIGGER_PX=500 of top.
    firePrettyViewScroll(scrollEl, 100, { scrollHeight: 4000, clientHeight: 800 });

    // Advance past LOAD_OLDER_DEBOUNCE_MS=250 so the debounced sender fires.
    act(() => {
      vi.advanceTimersByTime(251);
    });

    // Exactly one fetch_older send.
    const fetchSends = getFetchOlderSends(ws);
    expect(fetchSends.length).toBe(1);

    const payload = fetchSends[0];
    // Shape check — EXACTLY these three keys per 43-03 wire contract.
    expect(payload.type).toBe("fetch_older");
    expect(payload.anchorEventId).toBe("evt-0");
    expect(payload.count).toBe(50);
    // Object.keys shape assertion — ONLY the three allowed keys, no
    // line-offset field (43-03 locked the wire to eventId-only; the server
    // does eventId→line resolution on demand).
    expect(Object.keys(payload).sort()).toEqual(
      ["anchorEventId", "count", "type"].sort(),
    );

    vi.useRealTimers();
  });

  // Plan 45-02: `it.skip` — exercises the fetch_older_batch response handler
  // (isFetchOlderBatchEvent + prepend into messages[]) that Plan 45-02 has removed
  // from the frontend API surface. Whole file scheduled for delete-and-recreate in
  // Plan 45-03; skip keeps fleet-standing-directive-1 satisfied until then.
  it.skip("Test 4: fetch_older_batch prepends with dedup — new frames land at head; duplicate eventId dropped", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
        }),
      );
      for (let i = 0; i < 50; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: "assistant",
              content: `msg ${i}`,
              eventId: `evt-${i}`,
              ts: 1_000_000 + i,
            }),
          }),
        );
      }
    });
    expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(50);

    // Fire a batch with 3 unique older eventIds.
    fireFetchOlderBatch(ws, [
      { type: "message", role: "user", content: "older 0", eventId: "old-0", ts: 999_000 },
      { type: "message", role: "assistant", content: "older 1", eventId: "old-1", ts: 999_001 },
      { type: "message", role: "user", content: "older 2", eventId: "old-2", ts: 999_002 },
    ]);

    // 3 older + 50 existing = 53 rendered bubbles, older first.
    const bubblesAfterFirstBatch = container.querySelectorAll("[data-pv-bubble]");
    expect(bubblesAfterFirstBatch.length).toBe(53);
    // Prepend order: first three are the older ones.
    const ids = Array.from(bubblesAfterFirstBatch).map((b) =>
      (b as HTMLElement).getAttribute("data-event-id"),
    );
    expect(ids.slice(0, 3)).toEqual(["old-0", "old-1", "old-2"]);
    expect(ids[3]).toBe("evt-0");

    // Now fire a second batch containing a dup ("old-2" already present) and 2 new.
    fireFetchOlderBatch(ws, [
      { type: "message", role: "user", content: "older -2", eventId: "old-neg2", ts: 998_998 },
      { type: "message", role: "user", content: "older -1", eventId: "old-neg1", ts: 998_999 },
      { type: "message", role: "user", content: "dup", eventId: "old-2", ts: 999_002 },
    ]);
    const bubblesAfterDup = container.querySelectorAll("[data-pv-bubble]");
    // 53 + 2 (dup dropped) = 55.
    expect(bubblesAfterDup.length).toBe(55);
    const ids2 = Array.from(bubblesAfterDup).map((b) =>
      (b as HTMLElement).getAttribute("data-event-id"),
    );
    // Fresh prepended pair comes first; duplicate "old-2" NOT re-inserted at head.
    expect(ids2.slice(0, 2)).toEqual(["old-neg2", "old-neg1"]);
    // "old-2" still exists in the DOM (from the first batch) but only once.
    const old2s = ids2.filter((id) => id === "old-2");
    expect(old2s.length).toBe(1);

    vi.useRealTimers();
  });

  it("Test 5: drop-oldest fires when live-append exceeds WORKING_SET_CAP=150 — 155 frames render as ≤150, oldest 5 absent", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    fireMessageBatch(ws, 155, (i) => ({
      type: "message",
      role: "assistant",
      content: `m ${i}`,
      eventId: `evt-${i}`,
      ts: 2_000_000 + i,
    }));
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(bubbles.length).toBeLessThanOrEqual(150);
    // Oldest 5 (evt-0..evt-4) should have been dropped.
    const ids = Array.from(bubbles).map((b) =>
      (b as HTMLElement).getAttribute("data-event-id"),
    );
    for (let i = 0; i < 5; i++) {
      expect(ids).not.toContain(`evt-${i}`);
    }
    // evt-5 through evt-154 should still be present (150 entries).
    expect(bubbles.length).toBe(150);
    expect(ids[0]).toBe("evt-5");
    expect(ids[ids.length - 1]).toBe("evt-154");
  });

  // Test 6 runs a 155-message drop-oldest cycle + real React render passes
  // + a fake-timer debounce advance. On slower CI/dev hardware the whole
  // sequence takes ~3s of test-body time and ~5s of environment/import
  // setup, pushing past vitest's default 5000ms testTimeout. Bump the
  // per-test timeout to 30s. Note: this whole file is scheduled for
  // delete-and-recreate in Plan 45-03 (the fetch_older client path it
  // exercises is being removed); this bump keeps the fleet-standing-
  // directive-1 (never leave tests failing) satisfied until then.
  it.skip("Test 6: refetch-on-scroll-back — after drop-oldest, near-top scroll uses the surviving first eventId; batch response rehydrates previously-dropped ids", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
        }),
      );
      for (let i = 0; i < 155; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: "assistant",
              content: `m ${i}`,
              eventId: `evt-${i}`,
              ts: 2_000_000 + i,
            }),
          }),
        );
      }
    });
    // Drop-oldest fired; surviving first should be evt-5.
    expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(150);

    const scrollEl = getOuterScrollEl(container);
    ws.send.mockClear();
    // Trigger near-top scroll.
    firePrettyViewScroll(scrollEl, 100, { scrollHeight: 4000, clientHeight: 800 });
    act(() => {
      vi.advanceTimersByTime(251);
    });
    const fetchSends = getFetchOlderSends(ws);
    expect(fetchSends.length).toBe(1);
    // Anchor is the surviving first (evt-5), NOT the pre-drop first (evt-0).
    expect(fetchSends[0].anchorEventId).toBe("evt-5");

    // Fire a batch containing the previously-dropped range.
    fireFetchOlderBatch(ws, [
      { type: "message", role: "assistant", content: "dropped 0", eventId: "evt-0", ts: 2_000_000 },
      { type: "message", role: "assistant", content: "dropped 1", eventId: "evt-1", ts: 2_000_001 },
      { type: "message", role: "assistant", content: "dropped 2", eventId: "evt-2", ts: 2_000_002 },
      { type: "message", role: "assistant", content: "dropped 3", eventId: "evt-3", ts: 2_000_003 },
      { type: "message", role: "assistant", content: "dropped 4", eventId: "evt-4", ts: 2_000_004 },
    ]);
    const idsAfter = Array.from(
      container.querySelectorAll("[data-pv-bubble]"),
    ).map((b) => (b as HTMLElement).getAttribute("data-event-id"));
    // Previously-dropped ids reappear at the head.
    expect(idsAfter.slice(0, 5)).toEqual(["evt-0", "evt-1", "evt-2", "evt-3", "evt-4"]);
    expect(idsAfter[5]).toBe("evt-5");
    vi.useRealTimers();
  }, 30_000);

  // Plan 45-02: `it.skip` — exercises the loading-hint mount that lived beside the
  // fetch_older client path Plan 45-02 removed from the API surface. Whole file
  // scheduled for delete-and-recreate in Plan 45-03; skip keeps
  // fleet-standing-directive-1 satisfied until then.
  it.skip("Test 7: loading hint fake-timer sequence — hint absent before 150ms threshold, present after, removed on batch response", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
        }),
      );
      for (let i = 0; i < 50; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: "assistant",
              content: `msg ${i}`,
              eventId: `evt-${i}`,
              ts: 1_000_000 + i,
            }),
          }),
        );
      }
    });
    expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(50);
    const scrollEl = getOuterScrollEl(container);
    ws.send.mockClear();

    // (1) Fire near-top scroll.
    firePrettyViewScroll(scrollEl, 100, { scrollHeight: 4000, clientHeight: 800 });

    // (2) Advance past LOAD_OLDER_DEBOUNCE_MS (251ms).
    act(() => {
      vi.advanceTimersByTime(251);
    });

    // (3) ws.send fired with fetch_older; hint NOT yet present.
    expect(getFetchOlderSends(ws).length).toBe(1);
    expect(container.querySelector('[data-testid="pv-loading-older"]')).toBeNull();

    // (4) Advance past LOADING_HINT_THRESHOLD_MS (151ms).
    act(() => {
      vi.advanceTimersByTime(151);
    });

    // (5) Loading hint IS present.
    expect(container.querySelector('[data-testid="pv-loading-older"]')).not.toBeNull();

    // (6) Dispatch batch response.
    fireFetchOlderBatch(ws, [
      { type: "message", role: "user", content: "older", eventId: "old-x", ts: 999_500 },
    ]);

    // (7) Hint removed.
    expect(container.querySelector('[data-testid="pv-loading-older"]')).toBeNull();

    vi.useRealTimers();
  });

  // Plan 45-02: `it.skip` — exercises the fetch_older short-circuit path Plan
  // 45-02 removed from the API surface. Whole file scheduled for
  // delete-and-recreate in Plan 45-03; skip keeps fleet-standing-directive-1
  // satisfied until then.
  it.skip("Test 8: reachedBeginning short-circuits — subsequent near-top scrolls do not fire fetch_older after reachedBeginning:true", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
        }),
      );
      for (let i = 0; i < 50; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: "assistant",
              content: `msg ${i}`,
              eventId: `evt-${i}`,
              ts: 1_000_000 + i,
            }),
          }),
        );
      }
    });
    const scrollEl = getOuterScrollEl(container);
    ws.send.mockClear();

    // First near-top scroll → fires fetch_older.
    firePrettyViewScroll(scrollEl, 100, { scrollHeight: 4000, clientHeight: 800 });
    act(() => {
      vi.advanceTimersByTime(251);
    });
    expect(getFetchOlderSends(ws).length).toBe(1);

    // Batch response with reachedBeginning:true.
    fireFetchOlderBatch(ws, [], { reachedBeginning: true });

    // Second near-top scroll → should NOT fire another fetch_older.
    firePrettyViewScroll(scrollEl, 50, { scrollHeight: 4000, clientHeight: 800 });
    act(() => {
      vi.advanceTimersByTime(251);
    });
    // Still exactly 1 fetch_older sent — no new one after reachedBeginning.
    expect(getFetchOlderSends(ws).length).toBe(1);
    vi.useRealTimers();
  });

  // Plan 45-02: `it.skip` — exercises the fetch_older error-response path Plan
  // 45-02 removed from the API surface. Whole file scheduled for
  // delete-and-recreate in Plan 45-03; skip keeps fleet-standing-directive-1
  // satisfied until then.
  it.skip("Test 9: fetch failure — error frame triggers console.warn, clears loading state + in-flight, no auto-retry, next scroll fires a fresh fetch_older", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
        }),
      );
      for (let i = 0; i < 50; i++) {
        ws.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "message",
              role: "assistant",
              content: `msg ${i}`,
              eventId: `evt-${i}`,
              ts: 1_000_000 + i,
            }),
          }),
        );
      }
    });
    const scrollEl = getOuterScrollEl(container);
    ws.send.mockClear();
    warnSpy.mockClear();

    // Fire scroll and let debounce fire.
    firePrettyViewScroll(scrollEl, 100, { scrollHeight: 4000, clientHeight: 800 });
    act(() => {
      vi.advanceTimersByTime(251);
    });
    expect(getFetchOlderSends(ws).length).toBe(1);

    // Also let loading hint appear so we can verify removal on error.
    act(() => {
      vi.advanceTimersByTime(151);
    });
    expect(container.querySelector('[data-testid="pv-loading-older"]')).not.toBeNull();

    // Fire an error-shape batch response.
    fireFetchOlderBatch(ws, [], { error: "anchor-not-found" });

    // (a) Loading hint removed.
    expect(container.querySelector('[data-testid="pv-loading-older"]')).toBeNull();

    // (d) console.warn was called with a string containing the error.
    const warnedWithError = warnSpy.mock.calls.some((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("anchor-not-found"),
      ),
    );
    expect(warnedWithError).toBe(true);

    // (c) No auto-retry between error and next user action.
    // Advance more time — no ws.send additions besides the one we already have.
    const sendsBeforeNextScroll = getFetchOlderSends(ws).length;
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(getFetchOlderSends(ws).length).toBe(sendsBeforeNextScroll);

    // (b) Fresh scroll AFTER error DOES fire a new fetch_older (proves
    // fetchInFlightRef was cleared — otherwise the gate would suppress).
    firePrettyViewScroll(scrollEl, 90, { scrollHeight: 4000, clientHeight: 800 });
    act(() => {
      vi.advanceTimersByTime(251);
    });
    expect(getFetchOlderSends(ws).length).toBe(sendsBeforeNextScroll + 1);

    vi.useRealTimers();
  });

  it("Test 10: auto-scroll follows when pinned — new message frame with pinned scroll preserves pinned state", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    fireMessageBatch(ws, 5, (i) => ({
      type: "message",
      role: "assistant",
      content: `m ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));
    const scrollEl = getOuterScrollEl(container);
    // Simulate a pinned scroll state (scrollTop + clientHeight === scrollHeight).
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 1000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      value: 400,
      writable: true,
      configurable: true,
    });
    let scrollTopVal = 600;
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => scrollTopVal,
      set: (v: number) => {
        scrollTopVal = v;
      },
      configurable: true,
    });
    // Fire a scroll event so useAutoScroll recomputes pinned = true.
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });
    // Grow scrollHeight (new message coming).
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 1100,
      writable: true,
      configurable: true,
    });
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "new pinned",
      eventId: "evt-new",
      ts: 1_000_100,
    });
    // The follow-when-pinned effect writes scrollTop = scrollHeight.
    expect(scrollTopVal).toBe(1100);
  });

  it("Test 11: no yank when scrolled up — new message with scrollTop=0 leaves scrollTop unchanged (LOAD-BEARING regression)", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    fireMessageBatch(ws, 5, (i) => ({
      type: "message",
      role: "assistant",
      content: `m ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));
    const scrollEl = getOuterScrollEl(container);
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 4000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      value: 800,
      writable: true,
      configurable: true,
    });
    let scrollTopVal = 0;
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => scrollTopVal,
      set: (v: number) => {
        scrollTopVal = v;
      },
      configurable: true,
    });
    // Fire scroll so useAutoScroll marks unpinned.
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });
    // Grow scrollHeight (new message).
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 4100,
      writable: true,
      configurable: true,
    });
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "new scrolled-up",
      eventId: "evt-new",
      ts: 1_000_100,
    });
    // scrollTop must not have moved.
    expect(scrollTopVal).toBe(0);
  });
});
