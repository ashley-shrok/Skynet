/**
 * shape-compacting-indicator — the working orb while an agent compacts.
 * Compacting runs no turn, so the orb shows for it on its own: plain (no
 * Stop — nothing to stop), with the fixed line "Compacting the
 * conversation…"; lit from the moment a request is accepted, and held past
 * the compaction's end until the agent's follow-up turn lights it (at most
 * COMPACT_TAIL_MS). Scaffolding mirrors PrettyView.interrupt-button.
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

// The Stop orb only renders while the agent is working, so
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

import {
  markCompactRequested,
  __resetCompactRequestsForTests,
} from "@/state/compact-request-store";

const KEY = "1:s1";
const wip = (c: HTMLElement) => c.querySelector('[data-testid="pv-wip"]') as HTMLElement | null;
const line = (c: HTMLElement) => c.querySelector('[data-testid="wip-narration"]')?.textContent ?? null;

function publishCondensing(condensing: boolean) {
  act(() => {
    publishFleetStatusSessionState("1", {
      hostId: "1",
      tmuxSession: "s1",
      sessionId: "test-session",
      pid: 12345,
      status: "idle",
      backgroundTasks: [],
      updatedAt: Date.now(),
      lastMessageAt: null,
      aiTitle: null,
      dormant: false,
      condensing,
    });
  });
}

describe("PrettyView — the working orb while compacting (shape-compacting-indicator)", () => {
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
    workingRef.value = false;
  });

  afterEach(() => {
    act(() => {
      __resetCompactRequestsForTests();
      resetWorkingStore();
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount() {
    const onInterrupt = vi.fn();
    const utils = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} onSend={vi.fn(() => true)} onInterrupt={onInterrupt} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() => expect(utils.container.querySelector('textarea[placeholder="Write a message…"]')).not.toBeNull());
    return { ...utils, ws, onInterrupt };
  }

  it("an idle conversation shows no orb", async () => {
    const { container } = await mount();
    expect(wip(container)).toBeNull();
  });

  it("an accepted request lights a plain orb at once, with the fixed line and no Stop", async () => {
    const { container, ws } = await mount();
    act(() => markCompactRequested(KEY));
    const orb = wip(container);
    expect(orb).not.toBeNull();
    expect(orb!.getAttribute("data-stop")).toBe("working");
    expect(container.querySelector('[data-testid="pv-wip-stop"]')).toBeNull();
    expect(line(container)).toBe("Compacting the conversation…");
    // No narration is asked for — there's no turn to narrate.
    const sent = ws.send.mock.calls.map((c) => String(c[0]));
    expect(sent.some((m) => m.includes('"narration_watch"') && m.includes('"active":true'))).toBe(false);
  });

  it("screen readers hear that the conversation is being compacted", async () => {
    const { container } = await mount();
    act(() => markCompactRequested(KEY));
    expect(container.querySelector('.pv-wip-orb[role="status"]')?.getAttribute("aria-label")).toBe(
      "Compacting the conversation",
    );
  });

  it("the same orb stays mounted from the request through the compaction's end", async () => {
    const { container } = await mount();
    act(() => markCompactRequested(KEY));
    const first = wip(container);
    expect(first).not.toBeNull();
    publishCondensing(true);
    expect(wip(container)).toBe(first);
    publishCondensing(false);
    expect(wip(container)).toBe(first);
  });

  it("the poll's condensing signal lights the orb the same way", async () => {
    const { container } = await mount();
    publishCondensing(true);
    expect(wip(container)?.getAttribute("data-stop")).toBe("working");
    expect(line(container)).toBe("Compacting the conversation…");
  });

  it("while the agent's own turn runs, the orb is the turn's: Stop and no fixed line", async () => {
    workingRef.value = true;
    const { container } = await mount();
    publishCondensing(true);
    expect(wip(container)?.getAttribute("data-stop")).toBe("ready");
    expect(container.querySelector('[data-testid="pv-wip-stop"]')).not.toBeNull();
    expect(line(container)).not.toBe("Compacting the conversation…");
  });

  it("after the compaction ends the orb holds for the follow-up turn, then goes if none comes", async () => {
    const { container } = await mount();
    publishCondensing(true);
    vi.useFakeTimers();
    publishCondensing(false);
    expect(wip(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(wip(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(wip(container)).toBeNull();
  });
});
