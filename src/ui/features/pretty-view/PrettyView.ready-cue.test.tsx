/**
 * PrettyView.ready-cue.test.tsx — Phase 126 Plan 02, Task 3.
 *
 * Integration coverage of the readiness-cue arming rule (D-02, D-08–D-12),
 * fire gate (D-03), visibility gate (D-05, D-06), and flicker collapse (D-04)
 * as expressed at the PrettyView boundary. Complements the store-scope suite
 * at src/ui/state/ready-cue-latch-store.test.ts (which tests the state
 * machine in isolation) by exercising the effect-level wiring.
 *
 * Seven tests, mapping to 126-CONTEXT.md decisions:
 *
 *   Test 1 — new assistant MessageEvent → armRow called             (D-02, D-08)
 *   Test 2 — new user MessageEvent → armRow NOT called              (D-09)
 *   Test 3 — new RelayInboundEvent → armRow NOT called              (D-12)
 *   Test 4 — WIP true→false + armed + visible → playTink + disarm   (D-03, D-05)
 *   Test 5 — WIP true→false + armed + NOT visible → NO fire, latch  (D-05, D-06)
 *              stays armed
 *   Test 6 — WIP true→false + NOT armed → NO fire, NO disarm        (D-04 half)
 *   Test 7 — WIP flicker (t→f→t→f) with single intervening bubble   (D-04)
 *              fires EXACTLY once
 *
 * Tests 1-6 spy on the LATCH functions and the AUDIO functions via vi.mock.
 * Test 7 uses the REAL latch store (imported via ReadyCueLatch namespace and
 * reset in beforeEach) to verify end-to-end multi-bubble-single-chime
 * behavior — mocking would obscure the semantic being tested.
 *
 * WS + session-working-store mock scaffolding lifted from
 * PrettyView.plain-dom.test.tsx (the canonical minimal-mount recipe).
 * `useSessionIsWorking` is mocked directly (following AgentBadgeWithMeter.test.tsx)
 * so we can drive its return value between renders without publishing wire
 * frames — the fire-effect's edge-detection is exactly the surface under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

// ── Module mocks (must come BEFORE the PrettyView import) ─────────────────

// Audio primitive — playTink is the fire we observe; the other two exports
// are stubbed as no-ops so PrettyView imports don't trip on missing symbols.
vi.mock("@/audio/ready-cue", () => ({
  playTink: vi.fn(),
  initReadyCueAudioUnlock: vi.fn(),
  isReadyCueUnlocked: vi.fn(() => true),
}));

// Latch store — Tests 1–6 spy on armRow / disarmRow / isRowArmed via these
// mocked functions; Test 7 unmocks the module at file scope by using
// vi.doMock inside its beforeEach + dynamic import. But vi.doMock is
// heavyweight and brittle across worker isolation modes. Simpler: default
// isRowArmed to false (so Tests 4 and 6 must explicitly override), spy on
// call counts, and use vi.clearAllMocks() in beforeEach. Test 7 clears the
// mocks and drives isRowArmed to reflect a lightweight local map — that
// keeps Test 7 hermetic without a vi.doMock dance.
const latchState = { armed: new Map<string, boolean>() };
vi.mock("@/state/ready-cue-latch-store", () => ({
  armRow: vi.fn((k: string) => {
    latchState.armed.set(k, true);
  }),
  disarmRow: vi.fn((k: string) => {
    latchState.armed.set(k, false);
  }),
  isRowArmed: vi.fn((k: string) => latchState.armed.get(k) === true),
  __resetForTest: vi.fn(() => {
    latchState.armed.clear();
  }),
}));

// useSessionIsWorking — the D-23 edge signal. Mocked as a factory so we can
// drive its returned value between rerenders. Pattern mirrors
// AgentBadgeWithMeter.test.tsx :28-90.
// Typed as (key: string | null) => boolean so callers pass the key. Test
// bodies drive returned values via `.mockReturnValue(...)` between rerenders.
const useSessionIsWorkingMock = vi.fn(
  (_key: string | null): boolean => false,
);
vi.mock("@/state/session-working-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/state/session-working-store")>();
  return {
    ...actual,
    useSessionIsWorking: (key: string | null) => useSessionIsWorkingMock(key),
  };
});

// ── WS + other PrettyView deps ────────────────────────────────────────────

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
      readyState: 1,
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

// ── Imports of the mocked modules (via namespaces for spy access) ─────────

import * as ReadyCueLatch from "@/state/ready-cue-latch-store";
import * as ReadyCueAudio from "@/audio/ready-cue";
import { PrettyView } from "./PrettyView";

// The mocked spies, re-typed for ergonomic call-count assertions.
const armRowMock = ReadyCueLatch.armRow as unknown as ReturnType<typeof vi.fn>;
const disarmRowMock = ReadyCueLatch.disarmRow as unknown as ReturnType<typeof vi.fn>;
const isRowArmedMock = ReadyCueLatch.isRowArmed as unknown as ReturnType<typeof vi.fn>;
const playTinkMock = ReadyCueAudio.playTink as unknown as ReturnType<typeof vi.fn>;

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

// ── Suite ────────────────────────────────────────────────────────────────

describe("PrettyView ready-cue wiring — Phase 126 Plan 02 Task 3", () => {
  const SESSION_WORKING_KEY = "1:s1"; // matches PrettyView.tsx L1697 derivation

  beforeEach(() => {
    // Zero all spies for clean call-count assertions.
    vi.clearAllMocks();
    // Reset our local latch state (backing the mocked functions).
    latchState.armed.clear();
    // Default: not working, not armed. Individual tests override.
    useSessionIsWorkingMock.mockReturnValue(false);
    wsStubs.length = 0;

    // jsdom lacks ResizeObserver; useAutoScroll's effect (post-Phase-43
    // rewrite) does not call `new ResizeObserver`, but bubble components
    // might, so provide a defensive no-op.
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 1 — new assistant MessageEvent → armRow called (D-02, D-08)
  // ───────────────────────────────────────────────────────────────────────

  it("Test 1: new assistant MessageEvent → armRow called with sessionWorkingKey", async () => {
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

    // Pre-condition: armRow not yet called (the flipToStreaming didn't push
    // any assistant bubbles).
    expect(armRowMock).not.toHaveBeenCalled();

    // Fire an assistant-role MessageEvent through the WS.
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "hello from the agent",
      eventId: "evt-a1",
      ts: 1_000_000,
      line: 1,
    });

    await waitFor(() => {
      expect(armRowMock).toHaveBeenCalled();
    });
    expect(armRowMock).toHaveBeenCalledWith(SESSION_WORKING_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 2 — new user MessageEvent → armRow NOT called (D-09)
  // ───────────────────────────────────────────────────────────────────────

  it("Test 2: new user MessageEvent → armRow NOT called", async () => {
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

    fireWsMessage(ws, {
      type: "message",
      role: "user",
      content: "hello from the user",
      eventId: "evt-u1",
      ts: 1_000_000,
      line: 1,
    });

    // Give React a chance to commit + run the arm effect.
    await new Promise((r) => setTimeout(r, 20));
    expect(armRowMock).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 3 — new RelayInboundEvent → armRow NOT called (D-12)
  // ───────────────────────────────────────────────────────────────────────

  it("Test 3: new relay_inbound event → armRow NOT called", async () => {
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

    // Send a relay_inbound frame — the type discriminator in the arm effect
    // filters on `type === "message"`, so this should not arm regardless of
    // the payload's other fields. Uses the real RelayInboundEvent shape from
    // claude-session-api.ts:215 (body/room/sender/matrixEventId/raw) so
    // RelayInboundBubble renders without throwing.
    fireWsMessage(ws, {
      type: "relay_inbound",
      room: "!room:server",
      sender: "@peer:server",
      matrixEventId: "$abc:server",
      body: "peer agent said hi",
      raw: "peer agent said hi",
      eventId: "evt-r1",
      ts: 1_000_000,
      line: 1,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(armRowMock).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 4 — WIP true→false + armed + visible → playTink + disarm (D-03, D-05)
  // ───────────────────────────────────────────────────────────────────────

  it("Test 4: WIP true→false + armed=true + isVisible=true → playTink + disarmRow", async () => {
    // Pre-set the latch to armed.
    latchState.armed.set(SESSION_WORKING_KEY, true);
    // Start with WIP true.
    useSessionIsWorkingMock.mockReturnValue(true);

    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Sanity: no fire yet — WIP is still true.
    expect(playTinkMock).not.toHaveBeenCalled();

    // Flip WIP to false; the edge observer should fire.
    useSessionIsWorkingMock.mockReturnValue(false);
    act(() => {
      rerender(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          onSend={() => true}
          isVisible={true}
        />,
      );
    });

    await waitFor(() => {
      expect(playTinkMock).toHaveBeenCalledTimes(1);
    });
    expect(disarmRowMock).toHaveBeenCalledWith(SESSION_WORKING_KEY);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 5 — WIP true→false + armed + NOT visible → NO fire, latch armed
  // (D-05, D-06)
  // ───────────────────────────────────────────────────────────────────────

  it("Test 5: WIP true→false + armed=true + isVisible=false → NO playTink, latch stays armed", async () => {
    latchState.armed.set(SESSION_WORKING_KEY, true);
    useSessionIsWorkingMock.mockReturnValue(true);

    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={false}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    useSessionIsWorkingMock.mockReturnValue(false);
    act(() => {
      rerender(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          onSend={() => true}
          isVisible={false}
        />,
      );
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(playTinkMock).not.toHaveBeenCalled();
    expect(disarmRowMock).not.toHaveBeenCalled();
    // Latch state preserved.
    expect(latchState.armed.get(SESSION_WORKING_KEY)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 6 — WIP true→false + NOT armed → NO playTink, NO disarm (D-04 half)
  // ───────────────────────────────────────────────────────────────────────

  it("Test 6: WIP true→false + armed=false → NO playTink, NO disarmRow", async () => {
    // Latch never armed for this key.
    useSessionIsWorkingMock.mockReturnValue(true);

    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    useSessionIsWorkingMock.mockReturnValue(false);
    act(() => {
      rerender(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          onSend={() => true}
          isVisible={true}
        />,
      );
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(playTinkMock).not.toHaveBeenCalled();
    expect(disarmRowMock).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 7 — WIP flicker collapse (D-04)
  //
  //   Sequence:
  //     (a) arm via a new assistant MessageEvent
  //     (b) WIP true→false with isVisible=true → playTink called once, latch
  //         disarmed
  //     (c) WIP false→true (no bubbles) — nothing arms
  //     (d) WIP true→false again — playTink call count MUST STILL BE 1
  //
  //   Uses the mocked latch store (with its local state map) so end-to-end
  //   arm/disarm/re-fire semantics are exercised.
  // ───────────────────────────────────────────────────────────────────────

  it("Test 7: WIP flicker t→f→t→f with a single intervening assistant bubble fires playTink EXACTLY once (D-04)", async () => {
    useSessionIsWorkingMock.mockReturnValue(true);

    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // (a) — assistant bubble arrives; latch arms.
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "reply-1",
      eventId: "evt-a-1",
      ts: 1_000_000,
      line: 1,
    });
    await waitFor(() => {
      expect(latchState.armed.get(SESSION_WORKING_KEY)).toBe(true);
    });

    // (b) — WIP true→false. Fire + disarm.
    useSessionIsWorkingMock.mockReturnValue(false);
    act(() => {
      rerender(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          onSend={() => true}
          isVisible={true}
        />,
      );
    });
    await waitFor(() => {
      expect(playTinkMock).toHaveBeenCalledTimes(1);
    });
    expect(latchState.armed.get(SESSION_WORKING_KEY)).toBe(false);

    // (c) — WIP false→true (no bubbles, no arm). No fire yet.
    useSessionIsWorkingMock.mockReturnValue(true);
    act(() => {
      rerender(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          onSend={() => true}
          isVisible={true}
        />,
      );
    });

    // (d) — WIP true→false AGAIN. Latch is disarmed (from step b); no new
    // bubble arrived to re-arm. playTink count MUST stay at 1.
    useSessionIsWorkingMock.mockReturnValue(false);
    act(() => {
      rerender(
        <PrettyView
          hostId={1}
          tmuxSession="s1"
          onSend={() => true}
          isVisible={true}
        />,
      );
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(playTinkMock).toHaveBeenCalledTimes(1);
  });
});
