/**
 * inline-260823-pv-session-file-rotation-reset — locks the frontend-side
 * session-file-rotation detection in the `session` frame handler.
 *
 * Failure mode this closes:
 *   - PrettyView WS pauses via hidden-pane debounced-close (pane hidden 60s).
 *     Messages state preserved across the pause (per WS-pause effect).
 *   - Target's session file rotates while paused (`/id reset` recycles the
 *     identity: new sessionId → new `~/.claude/sessions/<uuid>.jsonl`).
 *   - Pane becomes visible → fresh WS opens → backend runs
 *     `startActiveSessionFlow` and emits `{type:"session", sessionFile:<new>}`
 *     as pure metadata. It does NOT emit `session_changed` — that fires only
 *     from the discovery-repoll ticker on an already-open connection
 *     (claude-session-server.ts:4229).
 *   - Without this reset, patch #504's line-sorted insertion places new-file
 *     line=1,2,3 frames ABOVE the preserved old-file line=N frames.
 *     Viewport-at-bottom shows old final message; new session content lands
 *     invisible above.
 *
 * Three tests cover the invariant:
 *   A — rotation detected: session A, N frames, session B → messages reset,
 *       then new frames (low line numbers) render alone.
 *   B — no-rotation: session A, N frames, session A again (idempotent replay)
 *       → messages preserved (no spurious reset).
 *   C — session_changed path updates the ref: session A → session_changed B →
 *       new frames → session B (same as post-changed) → no spurious reset.
 *
 * Infrastructure copied verbatim from PrettyView.hydration-cap.test.tsx per
 * PATTERNS.md § infrastructure verbatim reuse.
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

function sendSessionFrame(ws: WsStub, sessionFile: string): void {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", pid: 1, sessionFile }),
      }),
    );
  });
}

function sendSessionChangedFrame(ws: WsStub, newSessionFile: string): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session_changed", newSessionFile }),
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

describe("PrettyView — session-file rotation detection at fresh-WS attach", () => {
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
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
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

  it("Test A: rotation detected — session A → 3 old frames → session B → old frames dropped, only new frames present", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();

    // First `session` frame — sessionFile A. Fresh-pane path; ref was null,
    // so no reset fires.
    sendSessionFrame(ws, "/tmp/a.jsonl");

    // Three "old" frames land with high line numbers (post-hydration live-
    // tail on a long-running session).
    fireMessageBatch(ws, 3, (i) => ({
      type: "message",
      role: "assistant",
      content: `old ${i}`,
      eventId: `old-${i}`,
      ts: 1_000_000 + i,
      line: 300 + i,
    }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(3);
    });

    // Simulate the WS-pause / /id-reset / WS-reopen scenario by sending a
    // second `session` frame with a DIFFERENT sessionFile (as the fresh WS
    // attach would on reopen). The reset must fire.
    sendSessionFrame(ws, "/tmp/b.jsonl");

    // Messages array reset.
    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(0);
    });

    // New-file frames arrive with low line numbers (fresh -n +1 replay).
    fireMessageBatch(ws, 2, (i) => ({
      type: "message",
      role: "assistant",
      content: `new ${i}`,
      eventId: `new-${i}`,
      ts: 2_000_000 + i,
      line: 1 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(2);
      // Only the NEW-file frames are present.
      const ids = Array.from(bubbles).map((b) =>
        (b as HTMLElement).getAttribute("data-event-id"),
      );
      expect(ids).toEqual(["new-0", "new-1"]);
    });
  });

  it("Test B: idempotent replay — session A → 2 frames → session A again → messages preserved (no spurious reset)", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();

    sendSessionFrame(ws, "/tmp/a.jsonl");
    fireMessageBatch(ws, 2, (i) => ({
      type: "message",
      role: "assistant",
      content: `msg ${i}`,
      eventId: `m-${i}`,
      ts: 1_000_000 + i,
      line: 100 + i,
    }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(2);
    });

    // Second `session` frame with the SAME sessionFile — no rotation.
    sendSessionFrame(ws, "/tmp/a.jsonl");

    // Give React a tick to run any state updates. Bubble count unchanged.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(2);
  });

  it("Test C: session_changed keeps the ref in sync — session A → session_changed B → 1 frame → session B (same as post-changed) → no spurious reset", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();

    sendSessionFrame(ws, "/tmp/a.jsonl");
    fireMessageBatch(ws, 2, (i) => ({
      type: "message",
      role: "assistant",
      content: `old ${i}`,
      eventId: `old-${i}`,
      ts: 1_000_000 + i,
      line: 200 + i,
    }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(2);
    });

    // Discovery-repoll fires `session_changed` mid-connection (old-flow path).
    sendSessionChangedFrame(ws, "/tmp/b.jsonl");

    // session_changed's own reset clears the message list.
    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(0);
    });

    fireMessageBatch(ws, 1, () => ({
      type: "message",
      role: "assistant",
      content: "fresh-b",
      eventId: "b-0",
      ts: 3_000_000,
      line: 1,
    }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(1);
    });

    // Some backends emit an extra `session` frame carrying the post-change
    // sessionFile (e.g. on a subsequent WS-lifecycle event). Because the ref
    // was updated inside `session_changed`, this must NOT trigger a spurious
    // reset — the sole surviving bubble stays present.
    sendSessionFrame(ws, "/tmp/b.jsonl");

    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(1);
  });
});
