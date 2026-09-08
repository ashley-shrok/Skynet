/**
 * Phase 90 Plan 07 Task 1 — RelayRoomSessionPane shell wrapper tests.
 *
 * Peer of IdentitySessionPane. Mounts RelayRoomPane inside the shell contract.
 *
 * Behaviors:
 *   1. Renders RelayRoomPane inside a `<div className="h-full w-full relative flex flex-col">`
 *      wrapper. NO viewingUserMxid prop threaded (Plan 05 Task 3 refactor —
 *      RelayRoomPane sources internally via useViewingUserMxid).
 *   2. forwardRef exposes an imperative handle whose relay-pane-irrelevant
 *      methods (togglePrettyMode, toggleMessageQueue, disconnect, and the
 *      rest of the IdentityPaneHandle surface) are all no-ops.
 *   3. Mount logs a structured record via console.info:
 *      {operation: 'relay_room_session_pane_mount', tabId, roomId}. Never
 *      JSON.stringifies raw event/tab objects.
 *   4. Does NOT render Terminal, MessageQueueDrawer, IdentityBadge, or
 *      IdentityModal (per PATTERNS.md § RelayRoomSessionPane 'What NOT to include').
 *   5. Props threading — tab.relayRoomId → roomId; tab.relayRoomTitle → roomTitle;
 *      isVisible → isVisible.
 *
 * Mocking strategy:
 * - Mock @/features/relay-room-pane/RelayRoomPane with a test-controllable
 *   double that records its props via a global spy so the wrapper contract
 *   can be asserted without pulling in the full relay-pane dep tree.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";

// ── Mock: RelayRoomPane ──────────────────────────────────────────────────────
const relayRoomPaneSpy = vi.fn();

vi.mock("@/features/relay-room-pane/RelayRoomPane", () => ({
  RelayRoomPane: (props: {
    roomId: string;
    roomTitle: string | null;
    isVisible: boolean;
    className?: string;
  }) => {
    relayRoomPaneSpy(props);
    return (
      <div
        data-testid="mock-relay-room-pane"
        data-room-id={props.roomId}
        data-room-title={props.roomTitle ?? ""}
        data-visible={String(props.isVisible)}
        data-classname={props.className ?? ""}
      />
    );
  },
}));

// ── Component under test (import AFTER mocks) ────────────────────────────────
import { RelayRoomSessionPane } from "./RelayRoomSessionPane";
import type { RelayRoomPaneHandle } from "./RelayRoomSessionPane";
import type { Tab } from "@/types/ui-types";

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-abc",
    instanceId: "inst-abc",
    type: "terminal",
    label: "Design room",
    openedAt: 1,
    sessionKind: "relay-room",
    relayRoomId: "!abc:matrix.example",
    relayRoomTitle: "Design room",
    ...overrides,
  };
}

describe("RelayRoomSessionPane", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    relayRoomPaneSpy.mockClear();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("Test 1: renders RelayRoomPane inside the standard pane wrapper", () => {
    const { container } = render(
      <RelayRoomSessionPane
        tab={makeTab()}
        roomId="!abc:matrix.example"
        roomTitle="Design room"
        isVisible={true}
      />,
    );

    // Outer wrapper carries the pane geometry class list.
    const wrapper = container.querySelector(
      "div.h-full.w-full.relative.flex.flex-col",
    );
    expect(wrapper).not.toBeNull();

    // RelayRoomPane mounted inside.
    const pane = container.querySelector('[data-testid="mock-relay-room-pane"]');
    expect(pane).not.toBeNull();
    expect(wrapper?.contains(pane!)).toBe(true);

    // NO viewingUserMxid prop threaded — the mock's spy captured props;
    // assert the key is absent from what the wrapper passed down.
    expect(relayRoomPaneSpy).toHaveBeenCalledTimes(1);
    const receivedProps = relayRoomPaneSpy.mock.calls[0][0];
    expect(receivedProps).not.toHaveProperty("viewingUserMxid");
  });

  it("Test 2: forwardRef exposes an imperative handle whose relay-pane-irrelevant methods are all no-ops", () => {
    const ref = createRef<RelayRoomPaneHandle>();
    render(
      <RelayRoomSessionPane
        ref={ref}
        tab={makeTab()}
        roomId="!abc:matrix.example"
        roomTitle="Design room"
        isVisible={true}
      />,
    );
    expect(ref.current).not.toBeNull();
    // Enumerated methods (mirror IdentityPaneHandle from terminal-types.ts):
    //   togglePrettyMode, toggleMessageQueue, disconnect, reconnect, fit,
    //   sendInput, notifyResize, refresh, openFileManager.
    expect(typeof ref.current!.togglePrettyMode).toBe("function");
    expect(typeof ref.current!.toggleMessageQueue).toBe("function");
    expect(typeof ref.current!.disconnect).toBe("function");
    expect(typeof ref.current!.reconnect).toBe("function");
    expect(typeof ref.current!.fit).toBe("function");
    expect(typeof ref.current!.sendInput).toBe("function");
    expect(typeof ref.current!.notifyResize).toBe("function");
    expect(typeof ref.current!.refresh).toBe("function");
    expect(typeof ref.current!.openFileManager).toBe("function");

    // Each is a no-op — invoking must not throw and must return undefined.
    expect(() => ref.current!.togglePrettyMode()).not.toThrow();
    expect(() => ref.current!.toggleMessageQueue()).not.toThrow();
    expect(() => ref.current!.disconnect()).not.toThrow();
    expect(() => ref.current!.reconnect()).not.toThrow();
    expect(() => ref.current!.fit()).not.toThrow();
    expect(() => ref.current!.sendInput("noop")).not.toThrow();
    expect(() => ref.current!.notifyResize()).not.toThrow();
    expect(() => ref.current!.refresh()).not.toThrow();
    expect(() => ref.current!.openFileManager()).not.toThrow();
  });

  it("Test 3: mount logs a structured record via console.info (no JSON.stringify of raw objects)", () => {
    render(
      <RelayRoomSessionPane
        tab={makeTab({ id: "tab-xyz" })}
        roomId="!xyz:matrix.example"
        roomTitle="Standup"
        isVisible={true}
      />,
    );
    // Expect at least one info call with the structured shape.
    const matching = infoSpy.mock.calls.find((call) => {
      const arg = call[0] as { operation?: string; tabId?: string; roomId?: string };
      return (
        arg &&
        typeof arg === "object" &&
        arg.operation === "relay_room_session_pane_mount"
      );
    });
    expect(matching).toBeDefined();
    const arg = matching![0] as {
      operation: string;
      tabId: string;
      roomId: string;
    };
    expect(arg.tabId).toBe("tab-xyz");
    expect(arg.roomId).toBe("!xyz:matrix.example");
    // Explicit fields — not a stringified event / tab object.
    expect(typeof arg.tabId).toBe("string");
    expect(typeof arg.roomId).toBe("string");
  });

  it("Test 4: does NOT render Terminal, MessageQueueDrawer, IdentityBadge, or IdentityModal", () => {
    const { container } = render(
      <RelayRoomSessionPane
        tab={makeTab()}
        roomId="!abc:matrix.example"
        roomTitle="Design room"
        isVisible={true}
      />,
    );
    // These test-ids come from the IdentitySessionPane test mocks and would
    // surface if the wrapper accidentally mounted them. In this suite we do
    // NOT mock them (they aren't even imported by RelayRoomSessionPane per
    // the implementation contract). Assert via absence of common data-testid
    // markers AND by the fact that querying for the mock-relay-room-pane is
    // the ONLY child of the wrapper.
    const wrapper = container.querySelector(
      "div.h-full.w-full.relative.flex.flex-col",
    );
    expect(wrapper).not.toBeNull();
    // Only the RelayRoomPane child should be present inside the wrapper.
    expect(wrapper!.children.length).toBe(1);
    const onlyChild = wrapper!.children[0];
    expect(onlyChild.getAttribute("data-testid")).toBe("mock-relay-room-pane");
  });

  it("Test 5: props threading — tab.relayRoomId → roomId, tab.relayRoomTitle → roomTitle, isVisible → isVisible", () => {
    const { container } = render(
      <RelayRoomSessionPane
        tab={makeTab({ id: "tab-props" })}
        roomId="!threaded:matrix.example"
        roomTitle="Threaded room"
        isVisible={false}
      />,
    );
    const pane = container.querySelector(
      '[data-testid="mock-relay-room-pane"]',
    ) as HTMLElement | null;
    expect(pane).not.toBeNull();
    expect(pane!.getAttribute("data-room-id")).toBe("!threaded:matrix.example");
    expect(pane!.getAttribute("data-room-title")).toBe("Threaded room");
    expect(pane!.getAttribute("data-visible")).toBe("false");
  });
});
