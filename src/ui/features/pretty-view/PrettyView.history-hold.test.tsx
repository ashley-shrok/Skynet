/**
 * Fast conversation open: the server replays only the recent window and then
 * sends `history_ready`. From the start of a hydration (wire_boot) until that
 * marker the client holds transcript frames and then shows them at once — no
 * top-to-bottom trickle. Non-transcript frames are never held, and a missing
 * marker releases after a safety timeout.
 *
 * WS stub scaffolding copied from PrettyView.hydration-cap.test.tsx.
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

describe("PrettyView — opening batch held until history_ready", () => {
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

  const frame = (ws: WsStub, payload: Record<string, unknown>) =>
    act(() => {
      ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
    });
  const msg = (i: number, line = i) => ({
    type: "message",
    role: i % 2 === 0 ? "user" : "assistant",
    content: `held message ${i}`,
    eventId: `e${i}`,
    ts: 1000 + i,
    line,
  });
  const bubbles = (c: HTMLElement) => c.querySelectorAll("[data-pv-bubble]").length;

  it("holds transcript frames after wire_boot and shows them all on history_ready", () => {
    const { container } = render(<PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />);
    const ws = getCurrentWs();
    frame(ws, { type: "wire_boot" });
    flipToStreaming(ws);
    for (let i = 0; i < 5; i++) frame(ws, msg(i, 100 + i));
    expect(bubbles(container)).toBe(0);
    expect(container.textContent).not.toContain("held message 0");
    frame(ws, { type: "history_ready", startLine: 100, totalLines: 104 });
    expect(bubbles(container)).toBe(5);
    expect(container.textContent).toContain("held message 0");
    expect(container.textContent).toContain("held message 4");
  });

  it("caps a held batch to the newest twenty when released", () => {
    const { container } = render(<PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />);
    const ws = getCurrentWs();
    frame(ws, { type: "wire_boot" });
    flipToStreaming(ws);
    for (let i = 0; i < 25; i++) frame(ws, msg(i));
    frame(ws, { type: "history_ready", startLine: 0, totalLines: 25 });
    expect(bubbles(container)).toBe(20);
    expect(container.textContent).not.toContain("held message 0");
    expect(container.textContent).toContain("held message 24");
  });

  it("live frames after history_ready render immediately", () => {
    const { container } = render(<PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />);
    const ws = getCurrentWs();
    frame(ws, { type: "wire_boot" });
    flipToStreaming(ws);
    frame(ws, { type: "history_ready", startLine: 1, totalLines: 0 });
    frame(ws, msg(1));
    expect(bubbles(container)).toBe(1);
  });

  it("does not hold when no hydration has started", () => {
    const { container } = render(<PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);
    frame(ws, msg(1));
    expect(bubbles(container)).toBe(1);
  });

  it("releases held frames after the safety timeout if history_ready never comes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { container } = render(<PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />);
      const ws = getCurrentWs();
      frame(ws, { type: "wire_boot" });
      flipToStreaming(ws);
      frame(ws, msg(1));
      expect(bubbles(container)).toBe(0);
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(bubbles(container)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
