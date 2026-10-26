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
  useSessionIdentity: () => useSessionIdentityMock(),
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


// A condense shows as one divider (shape-compaction-divider): never a user
// bubble, summary closed until clicked, guidance folded in, and nothing it
// writes settles a pending send.

function countPendingBubbles(container: HTMLElement): number {
  return container.querySelectorAll('[data-event-id^="pending-"]').length;
}

const SUMMARY = "## Primary Request\n\n- Remember **OSPREY**.";

describe("PrettyView — compaction divider", () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount() {
    const onSend = vi.fn(() => true);
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} onSend={onSend} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    return { container, ws };
  }

  it("renders one closed divider, not a user bubble; clicking opens and closes the summary", async () => {
    const { container, ws } = mount();
    sendWsFrame(ws, { type: "compaction", summary: SUMMARY, eventId: "s-1", ts: Date.now(), line: 10 });
    const divider = await waitFor(() => {
      const d = container.querySelector('[data-testid="compaction-divider"]');
      expect(d).not.toBeNull();
      return d as HTMLElement;
    });
    expect(divider.textContent).toContain("Conversation condensed");
    expect(container.querySelector('[data-testid="compaction-summary"]')).toBeNull();
    expect(container.textContent).not.toContain("OSPREY");

    const bar = divider.querySelector("button")!;
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(bar);
    const summary = container.querySelector('[data-testid="compaction-summary"]')!;
    expect(summary).not.toBeNull();
    expect(summary.querySelector("h2")?.textContent).toBe("Primary Request");
    expect(summary.querySelector("strong")?.textContent).toBe("OSPREY");
    expect(bar.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(bar);
    expect(container.querySelector('[data-testid="compaction-summary"]')).toBeNull();
  });

  it("folds the guidance into the divider above it: one line closed, in full above the summary when open", async () => {
    const { container, ws } = mount();
    sendWsFrame(ws, { type: "compaction", summary: SUMMARY, eventId: "s-1", ts: Date.now(), line: 10 });
    sendWsFrame(ws, { type: "compaction_guidance", guidance: "keep the pending file question", eventId: "c-1", ts: Date.now(), line: 12 });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="compaction-guidance"]')?.textContent).toContain(
        "keep the pending file question",
      ),
    );
    // The guidance frame renders no item of its own.
    expect(container.querySelector('[data-event-id="c-1"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="compaction-divider"] button')!);
    expect(container.querySelector('[data-testid="compaction-guidance"]')).toBeNull();
    const body = container.querySelector('[data-testid="compaction-summary"]')!;
    expect(body.textContent).toContain("keep the pending file question");
    expect(body.textContent!.indexOf("keep the pending")).toBeLessThan(body.textContent!.indexOf("OSPREY"));
  });

  it("guidance with no divider just above it shows nothing", async () => {
    const { container, ws } = mount();
    sendWsFrame(ws, { type: "message", role: "assistant", content: "hi there", eventId: "a-1", ts: Date.now(), line: 3 });
    sendWsFrame(ws, { type: "compaction_guidance", guidance: "orphan guidance", eventId: "c-9", ts: Date.now(), line: 4 });
    await waitFor(() => expect(container.textContent).toContain("hi there"));
    expect(container.textContent).not.toContain("orphan guidance");
  });

  it("a message sent during a condense keeps its sending bubble until the message itself lands", async () => {
    const { container, ws } = mount();
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull(),
    );
    const textarea = container.querySelector('textarea[placeholder="Write a message…"]') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: "sent mid-condense" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    sendWsFrame(ws, { type: "compaction", summary: SUMMARY, eventId: "s-1", ts: Date.now(), line: 20 });
    sendWsFrame(ws, { type: "compaction_guidance", guidance: "keep it", eventId: "c-1", ts: Date.now(), line: 22 });
    await waitFor(() => expect(container.querySelector('[data-testid="compaction-divider"]')).not.toBeNull());
    expect(countPendingBubbles(container)).toBe(1);

    sendWsFrame(ws, { type: "message", role: "user", content: "sent mid-condense", eventId: "u-1", ts: Date.now(), line: 25 });
    await waitFor(() => expect(countPendingBubbles(container)).toBe(0));
    expect(container.querySelectorAll('[data-testid="compaction-divider"]').length).toBe(1);
  });
  it("guidance far below the divider (a later, failed compact) is not attached to it", async () => {
    const { container, ws } = mount();
    sendWsFrame(ws, { type: "compaction", summary: SUMMARY, eventId: "s-1", ts: Date.now(), line: 10 });
    sendWsFrame(ws, { type: "compaction_guidance", guidance: "from a later attempt", eventId: "c-2", ts: Date.now(), line: 40 });
    await waitFor(() => expect(container.querySelector('[data-testid="compaction-divider"]')).not.toBeNull());
    expect(container.textContent).not.toContain("from a later attempt");
  });

  it("links in an opened summary open in a new tab", async () => {
    const { container, ws } = mount();
    sendWsFrame(ws, { type: "compaction", summary: "See [the doc](https://example.com/doc).", eventId: "s-1", ts: Date.now(), line: 10 });
    await waitFor(() => expect(container.querySelector('[data-testid="compaction-divider"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="compaction-divider"] button')!);
    const a = container.querySelector('[data-testid="compaction-summary"] a')!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
});
