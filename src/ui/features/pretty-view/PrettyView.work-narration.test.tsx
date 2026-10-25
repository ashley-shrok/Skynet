/**
 * Work narration in the conversation view: the view tells the backend whether
 * it is showing the work indicator (narration_watch), shows the backend's
 * work_narration line beside the indicator, and drops the line when the
 * indicator goes away so the next turn starts blank.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

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
import type { SessionState } from "@/api/fleet-status-types";

function sendWsFrame(ws: WsStub, frame: unknown) {
  act(() => {
    ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  });
}

function publishWorking(working: boolean) {
  const state: SessionState = {
    hostId: "1",
    tmuxSession: "s1",
    sessionId: "sess-1",
    pid: 1234,
    status: working ? "busy" : "idle",
    backgroundTasks: [],
    updatedAt: Date.now(),
    activityMtime: 2000,
    stoppedMtime: working ? 1000 : 3000,
  };
  act(() => {
    publishFleetStatusSessionState("1", state);
  });
}

const WIP_SELECTOR = '[aria-label="Claude is working"]';
const narrationText = (c: HTMLElement) => c.querySelector('[data-testid="wip-narration"]')?.textContent ?? null;
const watchFrames = (ws: WsStub) =>
  ws.send.mock.calls
    .map((c) => JSON.parse(String(c[0])) as { type: string; active?: boolean })
    .filter((f) => f.type === "narration_watch")
    .map((f) => f.active);

describe("PrettyView — work narration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    resetWorkingStore();
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    localStorage.clear();
  });

  afterEach(() => {
    resetWorkingStore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(isVisible = true) {
    const r = render(<PrettyView hostId={1} tmuxSession="s1" isVisible={isVisible} onSend={() => true} />);
    const ws = getCurrentWs();
    act(() => {
      ws.onopen?.();
      ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }) }));
    });
    await waitFor(() => expect(r.container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull());
    return { ...r, ws };
  }

  it("tells the backend when the work indicator shows and hides", async () => {
    const { ws } = await mount();
    // The backend's default is "not watching" — nothing is sent for it.
    expect(watchFrames(ws)).toEqual([]);
    publishWorking(true);
    await waitFor(() => expect(watchFrames(ws).at(-1)).toBe(true));
    publishWorking(false);
    await waitFor(() => expect(watchFrames(ws).at(-1)).toBe(false));
  });

  it("never asks for narration while the view is not visible", async () => {
    const { ws } = await mount(false);
    publishWorking(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(watchFrames(ws)).toEqual([]);
  });

  it("shows nothing until a line arrives, then the line beside the indicator", async () => {
    const { container, ws } = await mount();
    publishWorking(true);
    await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());
    expect(narrationText(container)).toBeNull();
    sendWsFrame(ws, { type: "work_narration", short: "Fixing it", long: "Found the cause, fixing it now, then tests" });
    await waitFor(() => expect(narrationText(container)).toBe("Found the cause, fixing it now, then tests"));
  });

  it("drops the line when the turn ends, so the next turn starts blank", async () => {
    const { container, ws } = await mount();
    publishWorking(true);
    sendWsFrame(ws, { type: "work_narration", short: "Fixing it", long: "Fixing it now" });
    await waitFor(() => expect(narrationText(container)).toBe("Fixing it now"));
    publishWorking(false);
    await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).toBeNull());
    publishWorking(true);
    await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());
    expect(narrationText(container)).toBeNull();
  });

  it("clears on the backend's empty frame (a new prompt started)", async () => {
    const { container, ws } = await mount();
    publishWorking(true);
    sendWsFrame(ws, { type: "work_narration", short: "a", long: "a line" });
    await waitFor(() => expect(narrationText(container)).toBe("a line"));
    sendWsFrame(ws, { type: "work_narration", short: null, long: null });
    await waitFor(() => expect(narrationText(container)).toBeNull());
  });
});
