/**
 * Regression guard for the two client-state-stuck bugs fixed in commit
 * 4a28b005 (2026-09-09):
 *
 *   Fix 1 — pane_state:non-error no longer strands status="error" on WS
 *     reconnect. Prior to the fix, a reconnect against a dormant pane got
 *     `pane_state` but no `session` frame; status stayed "error" →
 *     reconnectingActive stayed true → Send/Reset/ThumbsUp/Recap disabled
 *     forever until a tab refresh, even though the WS was healthy and the
 *     pane was dormant. The fix clears status back to "streaming" on any
 *     pane_state whose `state` is NOT "error", when statusRef is currently
 *     "error".
 *
 *   Fix 2 — wire_boot frame clears the messages array. Backend's per-WS
 *     `lineNum` counter starts at 0 on every fresh WS closure (container
 *     restart, transient WS drop). Retaining pre-attach messages traps
 *     post-attach frames below them under the insertion-sort-by-line +
 *     20-cap-drop policy. `wire_boot` is emitted at ws.open before any
 *     tail machinery — the fix calls setMessages([]) so post-attach
 *     frames sort into a clean line-counter space.
 *
 * Infrastructure copied verbatim from PrettyView.session-rotation.test.tsx
 * per PATTERNS.md § infrastructure verbatim reuse.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  act,
  screen,
  waitFor,
} from "@testing-library/react";

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

import { PrettyView } from "./PrettyView";

function sendFrame(ws: WsStub, payload: Record<string, unknown>): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

function fireWsOpen(ws: WsStub): void {
  act(() => {
    ws.onopen?.();
  });
}

function fireWsClose(ws: WsStub): void {
  act(() => {
    ws.onclose?.();
  });
}

describe("PrettyView — reconnect recovery regression (commit 4a28b005)", () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
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

  // ---------------------------------------------------------------
  // FIX 1 — pane_state:non-error clears status="error" on reconnect
  // ---------------------------------------------------------------

  it("Fix 1: pane_state with state='dormant' clears status='error' → Send re-enables", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    fireWsOpen(ws);
    sendFrame(ws, { type: "session", pid: 1, sessionFile: "/tmp/a.jsonl" });

    // Drive status into "error" by closing the WS (the natural producer of
    // status="error" — see PrettyView.tsx onclose handler ~L2578).
    // Drive status into "error" by sending an `error` frame (clean path;
    // ws.onclose would also work but schedules a reconnect timer that
    // complicates the test surface).
    sendFrame(ws, { type: "error", message: "test-error" });

    // Send button should now be disabled (reconnectingActive=true derives
    // from status==="error").
    // Assert Reset button is disabled (its disabled gate is reconnectingActive
    // alone — cleaner than Send, which is ALSO disabled by empty-textarea).
    const resetBtnErrored = (await screen.findByRole("button", {
      name: /Reset context window/,
    })) as HTMLButtonElement;
    expect(resetBtnErrored.disabled).toBe(true);

    // Send pane_state on the SAME ws (no reconnect involved with the
    // error-frame path).
    sendFrame(ws, { type: "pane_state", state: "dormant" });

    // After the fix, status flips back to "streaming" → Reset re-enables.
    await waitFor(() => {
      const resetBtnRecovered = screen.getByRole("button", {
        name: /Reset context window/,
      }) as HTMLButtonElement;
      expect(resetBtnRecovered.disabled).toBe(false);
    });
  });

  it("Fix 1: pane_state with state='active' also clears status='error'", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    fireWsOpen(ws);
    sendFrame(ws, { type: "session", pid: 1, sessionFile: "/tmp/a.jsonl" });
    // Drive status into "error" by sending an `error` frame (clean path;
    // ws.onclose would also work but schedules a reconnect timer that
    // complicates the test surface).
    sendFrame(ws, { type: "error", message: "test-error" });

    const resetBtn = (await screen.findByRole("button", {
      name: /Reset context window/,
    })) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    sendFrame(ws, { type: "pane_state", state: "active" });

    await waitFor(() => {
      const recovered = screen.getByRole("button", {
        name: /Reset context window/,
      }) as HTMLButtonElement;
      expect(recovered.disabled).toBe(false);
    });
  });

  it("Fix 1 (guard): pane_state with state='error' does NOT clear status='error'", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    fireWsOpen(ws);
    sendFrame(ws, { type: "session", pid: 1, sessionFile: "/tmp/a.jsonl" });
    // Drive status into "error" by sending an `error` frame (clean path;
    // ws.onclose would also work but schedules a reconnect timer that
    // complicates the test surface).
    sendFrame(ws, { type: "error", message: "test-error" });

    const resetBtn = (await screen.findByRole("button", {
      name: /Reset context window/,
    })) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    // A pane_state:error must NOT recover Reset — the fix's condition
    // `parsed.state !== "error"` guards this. Regression: dropping that
    // guard would falsely recover controls when the pane is actually errored.
    sendFrame(ws, { type: "pane_state", state: "error" });

    // Give React a beat to process; Reset should STAY disabled.
    await new Promise((r) => setTimeout(r, 50));
    const stillDisabled = screen.getByRole("button", {
      name: /Reset context window/,
    }) as HTMLButtonElement;
    expect(stillDisabled.disabled).toBe(true);
  });

  // ---------------------------------------------------------------
  // FIX 2 — wire_boot frame clears the messages array
  // ---------------------------------------------------------------

  it("Fix 2: wire_boot frame clears any previously-rendered messages", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    fireWsOpen(ws);
    sendFrame(ws, { type: "session", pid: 1, sessionFile: "/tmp/a.jsonl" });

    // Deliver three assistant messages so we have visible bubbles.
    for (let i = 0; i < 3; i++) {
      sendFrame(ws, {
        type: "message",
        role: "assistant",
        content: `pre-boot-${i}`,
        eventId: `e-${i}`,
        ts: Date.now() + i,
        line: 100 + i,
      });
    }

    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(3);
    });

    // Fire wire_boot — client MUST setMessages([]).
    sendFrame(ws, { type: "wire_boot" });

    await waitFor(() => {
      expect(container.querySelectorAll("[data-pv-bubble]").length).toBe(0);
    });
  });

  it("Fix 2: wire_boot lets post-boot low-line frames render without being cap-dropped", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    fireWsOpen(ws);
    sendFrame(ws, { type: "session", pid: 1, sessionFile: "/tmp/a.jsonl" });

    // Simulate pre-restart tail: 3 messages with HIGH line values (as
    // would exist on a long-running session that just hit a WS
    // reconnect against a fresh backend).
    for (let i = 0; i < 3; i++) {
      sendFrame(ws, {
        type: "message",
        role: "assistant",
        content: `pre-restart-${i}`,
        eventId: `pre-${i}`,
        ts: Date.now() + i,
        line: 500 + i,
      });
    }

    // Backend restarts (container recreate). Fresh WS attach fires
    // wire_boot — client clears messages.
    sendFrame(ws, { type: "wire_boot" });

    // Now post-restart frames arrive with FRESH low line numbers (backend
    // per-WS counter restarted from 0).
    for (let i = 0; i < 3; i++) {
      sendFrame(ws, {
        type: "message",
        role: "assistant",
        content: `post-restart-${i}`,
        eventId: `post-${i}`,
        ts: Date.now() + 100 + i,
        line: 1 + i,
      });
    }

    // Without the wire_boot reset, the post-restart frames (line=1..3)
    // would sort ABOVE the pre-restart frames (line=500..502) and hit
    // the 20-cap-drop only if the total exceeded 20 — but the deeper
    // bug is that even a normal 3-frame append gets buried under the
    // preserved pre-restart tail and never becomes visible.
    // With the fix, only the 3 post-restart frames should be rendered.
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(3);
    });

    // Assert content is the POST-restart set, not the pre-restart set.
    const bubbleText = Array.from(
      container.querySelectorAll("[data-pv-bubble]"),
    )
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(bubbleText).toContain("post-restart-0");
    expect(bubbleText).not.toContain("pre-restart-0");
  });
});
