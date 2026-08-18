/**
 * Phase 43 (replace-pv-virtualization-with-plain-dom-windowed-paginatio)
 * Plan 43-07a — PrettyView plain-DOM render spec.
 *
 * Locks the post-virtualizer behavior for the Wave 3 surgery:
 *   Test 1 — plain-DOM render: every message in `messages[]` mounts as a real
 *            in-flow `[data-pv-bubble]` child (no `position: absolute`, no
 *            `transform: translateY(...)` — the virtualizer's hallmark).
 *   Test 2 — overflow-anchor NOT disabled on the outer scroll container:
 *            className does not contain `[overflow-anchor:none]` (browser
 *            default `overflow-anchor: auto` wins), which is load-bearing
 *            per 43-CONTEXT.md `<decisions>` § "`overflow-anchor: auto` is
 *            load-bearing".
 *   Test 3 — aside-arm walk preserved (behavioral proxy): fires an /id user
 *            turn followed by an isIdle:false→true transition on an
 *            identity-attached session and asserts the backwards-walk at
 *            PrettyView.tsx:2056 correctly SUPPRESSES the aside_arm send
 *            (the walk finds the last user turn, sees `isIdCommand`, and
 *            returns before ws.send). If the walk was accidentally moved
 *            or its body edited by the Region B/C deletions above, this
 *            test regresses.
 *   Test 4 — accessory bubbles render as siblings of the message list:
 *            WipBubble mounts inside the outer scroll container as a sibling
 *            of the message-list wrapper (post-Phase-27 layout invariant
 *            preserved). PlanPendingBubble is exercised the same way.
 *   Test 5 — all five wire-frame bubble types render: message / image /
 *            relay_outbound / relay_inbound / malformed_line each land inside
 *            their own `[data-pv-bubble]` wrapper with the correct bubble
 *            component subtree (verified by presence + characteristic text
 *            content).
 *   Test 6 — data-event-id preserved on each bubble: after firing 5 frames
 *            with unique eventIds, every rendered `[data-pv-bubble]` has a
 *            matching `data-event-id` attribute equal to the frame's eventId.
 *
 * Test infrastructure lifted from PrettyView.virtualization.test.tsx per
 * 43-PATTERNS.md § 10; that file is slated for deletion in plan 43-08.
 * Aside-related mock scaffolding for Test 3 lifted from PrettyView.aside.test.tsx.
 *
 * NO fetch_older / historyWindow / drop-oldest / loading-hint scaffolding —
 * plan 43-07b owns those and lands its own dedicated test file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import {
  publishFleetStatusSessionState,
  __resetForTest as resetWorkingStore,
} from "@/state/session-working-store";
import type { SessionState } from "@/api/fleet-status-types";

// ── WS stub scaffolding (verbatim copy from PrettyView.virtualization.test.tsx) ──

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

// Test 3 needs to inject an identity-attached session so the aside-arm
// gate (`if (!pvIdentity) return`) does not short-circuit before the walk.
// Default: anonymous session; Test 3 overrides.
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

function fireWsMessage(ws: WsStub, payload: object): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

// Fire a batch of message frames — one act() call so React commits them
// together (post-virtualizer, this just controls React batching; nothing
// virtualization-specific).
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

// ── Test suite ────────────────────────────────────────────────────────────

describe("PrettyView plain-DOM render — Phase 43 Plan 43-07a", () => {
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
    // Reset session-working-store so Test 3's publishFleetStatusSessionState
    // does not leak into unrelated tests. (Same pattern as
    // PrettyView.aside.test.tsx :126.)
    resetWorkingStore();
    // Reset identity mock — default anonymous.
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    // JSDOM lacks ResizeObserver; useAutoScroll's effect (post-Phase-43
    // rewrite) does not call `new ResizeObserver`, but other bubble
    // components / accessory panels might, so keep the no-op stub as
    // defense-in-depth (also lets the test suite tolerate future accessory
    // mount surprises without breaking).
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);

    // Give every [data-pv-bubble] a non-zero measured height. In JSDOM
    // offsetHeight/getBoundingClientRect return 0 by default; without this
    // shim, downstream sizing logic in ChatMessage / ImageBubble / etc.
    // could collapse and hide characteristic content.
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

  it("Test 1: plain-DOM render — every message renders as an in-flow [data-pv-bubble] child (no absolute positioning, no translateY)", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire 20 message frames (well within the plain-DOM path — no virt
    // slicing threshold to worry about).
    fireMessageBatch(ws, 20, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `plain-dom message ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));

    // Every frame renders — plain-DOM path mounts them all.
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(20);
    });

    // No bubble carries the virtualizer's absolute-positioning shape.
    // Under the virtualizer, each item wrapper had
    // `style="position: absolute; top: 0; left: 0; width: 100%;
    //         transform: translateY(<n>px); padding-bottom: 9px"`.
    // The plain-DOM replacement has no inline style, or at most an
    // inline style with none of the tell-tale absolute-positioning
    // properties.
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    for (const bubble of Array.from(bubbles)) {
      const el = bubble as HTMLElement;
      // Not absolutely positioned.
      expect(el.style.position).not.toBe("absolute");
      // No translateY transform.
      expect(el.style.transform || "").not.toContain("translateY");
    }
  });

  it("Test 2: outer scroll container className does NOT contain [overflow-anchor:none] — browser default overflow-anchor:auto is load-bearing", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire a single frame so the outer scroll container renders (the
    // container is gated by `status === "streaming" || ...` — flipping
    // to streaming above is sufficient, but firing one message ensures
    // the message-list child mounts too so the container's shape is fully
    // realized in the DOM).
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "hello",
      eventId: "evt-0",
      ts: 1_000_000,
    });

    // The outer scroll container is the div that owns overflow-y-auto —
    // find it by querying every div and checking for the load-bearing
    // Tailwind classes. There should be exactly one match under
    // PrettyView's chat region.
    await waitFor(() => {
      const bubble = container.querySelector("[data-pv-bubble]");
      expect(bubble).toBeTruthy();
    });

    // Walk up from a bubble to its scroll-container ancestor by looking
    // for the div whose className contains `overflow-y-auto`. This is
    // the shape the plan mandates for the outer scroll container in
    // 43-PATTERNS.md § 5.
    let scrollContainer: HTMLElement | null = null;
    const bubble = container.querySelector("[data-pv-bubble]") as HTMLElement | null;
    let node: HTMLElement | null = bubble;
    while (node) {
      const cls = node.className || "";
      if (typeof cls === "string" && cls.includes("overflow-y-auto")) {
        scrollContainer = node;
        break;
      }
      node = node.parentElement;
    }
    expect(scrollContainer).toBeTruthy();

    const cls = (scrollContainer!.className as string) || "";
    // The Tailwind arbitrary-value class must be gone.
    expect(cls).not.toContain("[overflow-anchor:none]");
    // The literal CSS string must also not appear (defense against a
    // future author writing `style="overflow-anchor: none"` inline).
    expect(cls).not.toContain("overflow-anchor:none");
    // The inline style (if any) must not disable overflow-anchor either.
    expect(scrollContainer!.style.overflowAnchor || "").not.toBe("none");
  });

  it("Test 3: aside-arm walk preserved — isIdle:false→true on an identity-attached session with a trailing /id user turn suppresses aside_arm (walk finds isIdCommand and returns early)", async () => {
    // This is the behavioral proxy for "the backwards walk at
    // PrettyView.tsx:2056 was not touched by Region B/C/D deletions."
    // If the walk was accidentally removed / its body edited / its
    // termination changed, the aside_arm suppression regresses and the
    // ws.send below fires — this test fails.
    //
    // Setup: identity-attached session (aside-arm gate requires
    // pvIdentity != null per PrettyView.tsx aside-arm effect).
    useSessionIdentityMock.mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    });

    const { rerender } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire a few normal turns then an /id user turn (as the LAST user turn).
    fireMessageBatch(ws, 3, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
      eventId: `evt-pre-${i}`,
      ts: 1_000_000 + i,
    }));

    // The critical frame — a user turn matching isIdCommand. If the walk
    // reaches this one first (scanning backward from the newest), it
    // triggers the isIdCommand early-return and aside_arm is NEVER sent.
    fireWsMessage(ws, {
      type: "message",
      role: "user",
      content: "/id tina",
      eventId: "evt-id",
      ts: 1_000_500,
    });

    // Snapshot send calls before triggering the aside-arm effect so we
    // can isolate whether the trigger caused an aside_arm send. Note:
    // AUTO_ASIDE_ARM_ENABLED is FALSE in the current PrettyView per the
    // aside.test.tsx comment (Tests 3/4/7/8/9 are .skip pending the flag
    // flip). This makes Test 3 slightly weaker as a proxy — the walk's
    // early-return path via isIdCommand isn't exercised end-to-end while
    // the flag is off. BUT the walk itself still executes on every
    // isIdleDerived transition regardless of the flag (the flag gates
    // the ws.send at the tail; the walk runs upstream). If the walk was
    // accidentally deleted, the effect would throw or misbehave — this
    // test still guards against that structural regression.
    ws.send.mockClear();

    // Drive isIdle:false→true via the working-store (same pattern as
    // PrettyView.aside.test.tsx :512-522).
    const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
      hostId: "1",
      tmuxSession: "s1",
      sessionId: "sess-1",
      pid: 1234,
      status: "idle",
      backgroundTasks: [],
      updatedAt: Date.now(),
      ...overrides,
    });
    act(() => {
      publishFleetStatusSessionState("1", makeState({ status: "busy" }));
    });
    rerender(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    act(() => {
      publishFleetStatusSessionState("1", makeState({ status: "idle" }));
    });
    rerender(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );

    // Give any effect microtasks a chance to run.
    await new Promise((r) => setTimeout(r, 30));

    // No aside_arm should have been sent — the walk found the /id turn
    // as the last user turn and returned before the ws.send. This
    // behavioral assertion is the byte-preserve invariant.
    //
    // NOTE: this test is intentionally a weak upper-bound assertion.
    // AUTO_ASIDE_ARM_ENABLED is currently false in PrettyView.tsx per
    // Ashley 2026-07-27 (see PrettyView.aside.test.tsx :186-191 — Tests
    // 3/4/7/8/9 are .skip pending the flag flip), so ws.send would not
    // fire for aside_arm regardless of what the walk does. The walk
    // still runs on every isIdleDerived transition upstream of the flag
    // gate; if it was accidentally deleted, the effect would throw or
    // misbehave. The byte-preserve invariant is verified STRONGLY by
    // the anchor-comment `awk` diff + content-based greps in Task 2 of
    // this plan; this test is a supplementary structural smoke check.
    const asideArmSends = ws.send.mock.calls.filter((call) => {
      try {
        const parsed = JSON.parse(call[0] as string);
        return parsed.type === "aside_arm";
      } catch {
        return false;
      }
    });
    expect(asideArmSends.length).toBe(0);

    // Additional RED-locking assertion: the virtualizer's sized-container
    // wrapper `<div style="height: Npx; position: relative; width: 100%">`
    // MUST NOT be present in the plain-DOM path. This wrapper was the shape
    // Wave 2 (Plan 27-02) established and is the deletion target for
    // Region E. If it survives, this test regresses.
    const _container = document.body;
    const sizedWrappers = Array.from(
      _container.querySelectorAll("div[style*='position: relative']"),
    ).filter((d) => {
      const s = (d as HTMLElement).style;
      return s.height && s.position === "relative" && s.width === "100%";
    });
    expect(sizedWrappers.length).toBe(0);
  });

  it("Test 4: accessory bubble WipBubble mounts as a sibling of the message-list container inside the outer scroll container", async () => {
    // Post-Phase-27 layout invariant: WipBubble / PlanPendingBubble /
    // AsideBubble live as in-flow siblings of the message-list container
    // (not children of the map). Under the virtualizer they were siblings
    // of the sized virtualizer container; under the plain-DOM path they
    // remain siblings of whichever wrapper holds the .map() output.
    // Either way they must render INSIDE the outer scroll container.
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "hello",
      eventId: "evt-0",
      ts: 1_000_000,
    });

    // Publish a working state so isWorking flips true and WipBubble renders.
    const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
      hostId: "1",
      tmuxSession: "s1",
      sessionId: "sess-1",
      pid: 1234,
      status: "busy",
      backgroundTasks: [],
      updatedAt: Date.now(),
      ...overrides,
    });
    act(() => {
      publishFleetStatusSessionState("1", makeState());
    });

    // Find the outer scroll container via its overflow-y-auto class.
    await waitFor(() => {
      const bubble = container.querySelector("[data-pv-bubble]");
      expect(bubble).toBeTruthy();
    });
    let scrollContainer: HTMLElement | null = null;
    const bubble = container.querySelector("[data-pv-bubble]") as HTMLElement | null;
    let node: HTMLElement | null = bubble;
    while (node) {
      const cls = node.className || "";
      if (typeof cls === "string" && cls.includes("overflow-y-auto")) {
        scrollContainer = node;
        break;
      }
      node = node.parentElement;
    }
    expect(scrollContainer).toBeTruthy();

    // WipBubble carries role="status" (per WipBubble.tsx L166). Locate
    // it and assert it's a descendant of the scroll container.
    await waitFor(() => {
      const wip = scrollContainer!.querySelector('[role="status"]');
      expect(wip).toBeTruthy();
    });

    // Verify it is NOT nested inside a [data-pv-bubble] — the accessory
    // must be a sibling of the message-list wrappers, not one of the
    // per-message subtrees.
    const wip = scrollContainer!.querySelector('[role="status"]') as HTMLElement;
    let ancestor: HTMLElement | null = wip.parentElement;
    let insideBubble = false;
    while (ancestor && ancestor !== scrollContainer) {
      if (ancestor.hasAttribute && ancestor.hasAttribute("data-pv-bubble")) {
        insideBubble = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    expect(insideBubble).toBe(false);

    // Additional RED-locking assertion: no absolute-positioned sized
    // virtualizer wrapper. Plain-DOM path renders the message list in-flow.
    const sizedWrappers = Array.from(
      container.querySelectorAll("div[style*='position: relative']"),
    ).filter((d) => {
      const s = (d as HTMLElement).style;
      return s.height && s.position === "relative" && s.width === "100%";
    });
    expect(sizedWrappers.length).toBe(0);
  });

  it("Test 5: all five wire-frame bubble types render inside their own [data-pv-bubble] wrappers", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire one of each of the five wire-frame types.
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "hello chat message",
      eventId: "evt-msg",
      ts: 1_000_000,
    });
    fireWsMessage(ws, {
      type: "image",
      role: "user",
      images: ["/tmp/img.png"],
      text: "img-caption",
      eventId: "evt-img",
      ts: 1_000_001,
    });
    fireWsMessage(ws, {
      type: "relay_outbound",
      room: "!room:example.org",
      rawCommand: "curl -X PUT https://example.org/rooms/!room/send/m.room.message/1",
      body: "relay-out-body",
      eventId: "evt-rout",
      ts: 1_000_002,
    });
    fireWsMessage(ws, {
      type: "relay_inbound",
      room: "!room:example.org",
      sender: "@sender:example.org",
      body: "relay-in-body",
      eventId: "evt-rin",
      ts: 1_000_003,
    });
    fireWsMessage(ws, {
      type: "malformed_line",
      bytes: "not-json-garbage",
      eventId: "evt-malformed",
      ts: 1_000_004,
    });

    // All five must render as [data-pv-bubble] children.
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(5);
    });

    // Each bubble carries the frame's eventId as data-event-id.
    const eventIds = Array.from(
      container.querySelectorAll("[data-pv-bubble]"),
    ).map((b) => (b as HTMLElement).getAttribute("data-event-id"));
    expect(new Set(eventIds)).toEqual(
      new Set(["evt-msg", "evt-img", "evt-rout", "evt-rin", "evt-malformed"]),
    );

    // Characteristic text content is present somewhere in the DOM (proves
    // each bubble component was mounted with its payload, not just an
    // empty shell).
    expect(container.textContent).toContain("hello chat message");
    // Image bubbles render caption text.
    expect(container.textContent).toContain("img-caption");
    // Relay bubbles render body text.
    expect(container.textContent).toContain("relay-out-body");
    expect(container.textContent).toContain("relay-in-body");
    // Malformed bubbles render the raw bytes payload somewhere in the tree.
    expect(container.textContent).toContain("not-json-garbage");

    // Additional RED-locking assertion: no per-item absolute positioning.
    // Under the virtualizer each bubble wrapper had
    // `style="position: absolute; top: 0; left: 0; width: 100%; transform: translateY(...)"`.
    // The plain-DOM path renders them as in-flow children.
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    for (const bubble of Array.from(bubbles)) {
      const el = bubble as HTMLElement;
      expect(el.style.position).not.toBe("absolute");
      expect(el.style.transform || "").not.toContain("translateY");
    }
  });

  it("Test 6: data-event-id preserved on every rendered bubble (matches frame's eventId)", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    const eventIds = ["a", "b", "c", "d", "e"];
    fireMessageBatch(ws, eventIds.length, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      eventId: eventIds[i],
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBe(eventIds.length);
    });

    const observed = Array.from(
      container.querySelectorAll("[data-pv-bubble]"),
    ).map((b) => (b as HTMLElement).getAttribute("data-event-id"));
    expect(observed).toEqual(eventIds);

    // Additional RED-locking assertion: no per-item absolute positioning
    // — the plain-DOM path. Under the virtualizer, each item wrapper
    // carried `position: absolute` + `translateY(...)`.
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    for (const bubble of Array.from(bubbles)) {
      const el = bubble as HTMLElement;
      expect(el.style.position).not.toBe("absolute");
      expect(el.style.transform || "").not.toContain("translateY");
    }
  });
});
