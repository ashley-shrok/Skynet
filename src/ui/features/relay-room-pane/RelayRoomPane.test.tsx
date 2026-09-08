/**
 * Phase 90 Plan 05 Task 3 — RelayRoomPane tests.
 *
 * RelayRoomPane is the top-level component composing:
 *   - IdentityBadgeRow (top) — humans + agents from Plan 04 REST participants.
 *   - RelayMessageList (middle) — empty in this plan (Plan 06 wires WS).
 *   - <div data-slot="compose-box" /> placeholder (Plan 06 fills).
 *
 * Reads viewingUserMxid from useViewingUserMxid() (W#8 hook, NOT a prop).
 * Handles the D-18 error state on 403/404 from participants fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// Mock authApi.get for the participants fetch.
vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

// Mock useViewingUserMxid so tests can drive the W#8 hook value directly.
vi.mock("@/state/viewing-user-store", () => ({
  useViewingUserMxid: vi.fn(),
}));

// Mock identities-store so IdentityBadge / IdentityBadgeRow renders don't
// hit the real fetch pipeline.
vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [] as Identity[],
    byKey: new Map<string, Identity>(),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

import { authApi } from "@/main-axios";
import { useViewingUserMxid } from "@/state/viewing-user-store";
import { RelayRoomPane } from "./RelayRoomPane";

const mockedGet = authApi.get as unknown as ReturnType<typeof vi.fn>;
const mockedUseViewingUserMxid = useViewingUserMxid as unknown as ReturnType<
  typeof vi.fn
>;

const VIEWING_MXID = "@ashley:matrix.example.com";

beforeEach(() => {
  mockedGet.mockReset();
  mockedUseViewingUserMxid.mockReset();
  mockedUseViewingUserMxid.mockReturnValue(VIEWING_MXID);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RelayRoomPane (Phase 90 Plan 05 Task 3)", () => {
  it("Test 1: on mount, calls authApi.get('/relay-room/:roomId/participants') with the roomId", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    render(
      <RelayRoomPane
        roomId="!room123:matrix.example.com"
        roomTitle="Working session"
        isVisible={true}
      />,
    );
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });
    const url = mockedGet.mock.calls[0][0] as string;
    expect(url).toContain("/relay-room/");
    expect(url).toContain("/participants");
    // Path arg is URL-encoded (defense-in-depth vs. `!`, `:` chars).
    expect(url).toContain(encodeURIComponent("!room123:matrix.example.com"));
  });

  it("Test 2: passes viewingUserMxid from useViewingUserMxid() into IdentityBadgeRow", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: {
        humans: [
          { mxid: VIEWING_MXID, displayName: "Ashley", userId: "1" },
          { mxid: "@tina:matrix.example.com", displayName: "Tina", userId: "2" },
        ],
        agents: [],
      },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle="Working session"
        isVisible={true}
      />,
    );
    // After fetch resolves + row renders, viewing user is excluded (D-07).
    await waitFor(() => {
      const cells = container.querySelectorAll(
        '[data-testid="relay-room-participant"]',
      );
      expect(cells.length).toBe(1);
      expect(cells[0].getAttribute("data-mxid")).toBe("@tina:matrix.example.com");
    });
  });

  it("Test 3: renders RelayMessageList with empty history + hasOlder=false in this plan", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle="Working session"
        isVisible={true}
      />,
    );
    await waitFor(() => {
      const list = container.querySelector(
        '[data-testid="relay-room-message-list"]',
      );
      expect(list).not.toBeNull();
    });
    // No bubbles in this plan (empty history from parent).
    expect(container.querySelectorAll(".pv-bubble").length).toBe(0);
    expect(
      container.querySelectorAll('[data-testid="relay-room-inbound-wrap"]').length,
    ).toBe(0);
    // LoadMoreOlderButton renders null when hasOlder=false (no-lie invariant).
    expect(container.querySelector('[aria-label*="older messages" i]')).toBeNull();
  });

  it("Test 4: renders a data-slot='compose-box' placeholder cell for Plan 06", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle="Working session"
        isVisible={true}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="compose-box"]'),
      ).not.toBeNull();
    });
  });

  it("Test 5 (D-18): 404 participants fetch → renders RelayRoomErrorState in place of the pane content", async () => {
    // Axios 404 rejects with { response: { status: 404 } }.
    mockedGet.mockRejectedValueOnce({
      response: { status: 404, data: { error: "not_found" } },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!gone:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      const err = container.querySelector(
        '[data-testid="relay-room-error-state"]',
      );
      expect(err).not.toBeNull();
    });
    // No badge row, no message list, no compose slot — replaced by the error state.
    expect(
      container.querySelector('[data-testid="relay-room-identity-badge-row"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="relay-room-message-list"]'),
    ).toBeNull();
    expect(container.querySelector('[data-slot="compose-box"]')).toBeNull();
  });

  it("Test 5b (D-18): 403 participants fetch → same friendly error state", async () => {
    mockedGet.mockRejectedValueOnce({
      response: { status: 403, data: { error: "not_found" } },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!kicked:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="relay-room-error-state"]'),
      ).not.toBeNull();
    });
  });

  it("Test 6: 401 participants fetch → session-expired error state", async () => {
    mockedGet.mockRejectedValueOnce({
      response: { status: 401, data: { error: "unauthorized" } },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      const err = container.querySelector(
        '[data-testid="relay-room-error-state"]',
      );
      expect(err).not.toBeNull();
      // The title is different for 401 vs 404 — signal via the title testid.
      const title = err!.querySelector(
        '[data-testid="relay-room-error-title"]',
      );
      expect(title?.textContent?.toLowerCase()).toContain("session");
    });
  });

  it("Test 7 (D-17): empty-room state — one other-user participant, empty history → row + empty middle + compose slot, no chrome", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: {
        humans: [{ mxid: "@tina:matrix.example.com", displayName: "Tina", userId: "2" }],
        agents: [],
      },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!fresh:matrix.example.com"
        roomTitle="Fresh room"
        isVisible={true}
      />,
    );
    await waitFor(() => {
      // Badge row present with one participant (Tina).
      const cells = container.querySelectorAll(
        '[data-testid="relay-room-participant"]',
      );
      expect(cells.length).toBe(1);
    });
    // Message list present but empty.
    expect(
      container.querySelector('[data-testid="relay-room-message-list"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll(".pv-bubble").length).toBe(0);
    // Compose slot placeholder present.
    expect(container.querySelector('[data-slot="compose-box"]')).not.toBeNull();
    // No empty-state chrome.
    expect(container.textContent?.toLowerCase() ?? "").not.toContain(
      "start the conversation",
    );
  });

  it("Test 8: viewing-user-only room — humans list filters out the viewer → empty badge row + normal render", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: {
        humans: [
          { mxid: VIEWING_MXID, displayName: "Ashley", userId: "1" },
        ],
        agents: [],
      },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!alone:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      // Message list should render (means the fetch settled successfully).
      expect(
        container.querySelector('[data-testid="relay-room-message-list"]'),
      ).not.toBeNull();
    });
    // Zero cells in the row — viewer filtered out.
    const cells = container.querySelectorAll(
      '[data-testid="relay-room-participant"]',
    );
    expect(cells.length).toBe(0);
    // NOT an error state.
    expect(
      container.querySelector('[data-testid="relay-room-error-state"]'),
    ).toBeNull();
  });

  it("Test 9: structured logging on mount — console.info called with operation + roomId (no raw response body)", async () => {
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    render(
      <RelayRoomPane
        roomId="!log:matrix.example.com"
        roomTitle="Log test"
        isVisible={true}
      />,
    );
    await waitFor(() => {
      expect(infoSpy).toHaveBeenCalled();
    });
    // Find the mount log call among possibly-many info calls.
    const mountCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0];
      return (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { operation?: string }).operation ===
          "relay_room_pane_mount"
      );
    });
    expect(mountCall).toBeDefined();
    const payload = mountCall![0] as { operation: string; roomId?: string };
    expect(payload.roomId).toBe("!log:matrix.example.com");
    // Payload MUST be a plain object with explicit fields — no JSON.stringify
    // of a response body or Matrix event.
    expect(typeof payload).toBe("object");
  });

  it("Plan06-T1: instantiates useRelayRoomStream with expected opts + wires stream state into RelayMessageList props", async () => {
    // Mock useRelayRoomStream to observe args + drive state.
    const mockedStream = await import("./use-relay-room-stream");
    const spy = vi.spyOn(mockedStream, "useRelayRoomStream").mockReturnValue({
      history: [],
      participants: null,
      error: null,
      pendingSends: [],
      hasOlder: true,
      loadOlderStatus: "idle",
      loadOlderError: null,
      sendMessage: vi.fn(),
      fetchOlder: vi.fn(),
    });
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle="Working session"
        isVisible={true}
      />,
    );
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });
    const opts = spy.mock.calls[0][0];
    expect(opts.roomId).toBe("!room:matrix.example.com");
    expect(opts.viewingUserMxid).toBe(VIEWING_MXID);
    expect(opts.isVisible).toBe(true);
    spy.mockRestore();
  });

  it("Plan06-T2: replaces data-slot='compose-box' placeholder with ComposeBoxShell (D-04 upperArea + D-05 attachButton both undefined)", async () => {
    const mockedStream = await import("./use-relay-room-stream");
    const spy = vi.spyOn(mockedStream, "useRelayRoomStream").mockReturnValue({
      history: [],
      participants: null,
      error: null,
      pendingSends: [],
      hasOlder: false,
      loadOlderStatus: "idle",
      loadOlderError: null,
      sendMessage: vi.fn(),
      fetchOlder: vi.fn(),
    });
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      // A textarea is present (from ComposeBoxShell).
      expect(container.querySelector("textarea")).not.toBeNull();
      // The Send button appears with aria-label="Send".
      expect(
        container.querySelector('button[aria-label="Send"]'),
      ).not.toBeNull();
    });
    // D-04: no upperArea slot rendered (would carry data-testid="compose-shell-upper-area").
    expect(
      container.querySelector('[data-testid="compose-shell-upper-area"]'),
    ).toBeNull();
    // D-05: no attachButton slot rendered.
    expect(
      container.querySelector('[data-testid="compose-shell-attach-slot"]'),
    ).toBeNull();
    spy.mockRestore();
  });

  it("Plan06-T3 (D-15/D-16 + W#7 mqid prefix): handleSend calls stream.sendMessage with mqid matching /^relay-optim-/ + fires structured send log", async () => {
    const sendMessageSpy = vi.fn();
    const mockedStream = await import("./use-relay-room-stream");
    const spy = vi.spyOn(mockedStream, "useRelayRoomStream").mockReturnValue({
      history: [],
      participants: null,
      error: null,
      pendingSends: [],
      hasOlder: false,
      loadOlderStatus: "idle",
      loadOlderError: null,
      sendMessage: sendMessageSpy,
      fetchOlder: vi.fn(),
    });
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    let textarea: HTMLTextAreaElement | null = null;
    await waitFor(() => {
      textarea = container.querySelector("textarea");
      expect(textarea).not.toBeNull();
    });
    // Type "hello" and press Enter.
    fireEvent.change(textarea!, { target: { value: "hello" } });
    fireEvent.keyDown(textarea!, { key: "Enter" });
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    const [body, mqid] = sendMessageSpy.mock.calls[0];
    expect(body).toBe("hello");
    // W#7 committed prefix.
    expect(mqid).toMatch(/^relay-optim-/);
    // Structured send log observed.
    const sendCall = infoSpy.mock.calls.find((call) => {
      const p = call[0];
      return (
        typeof p === "object" &&
        p !== null &&
        (p as { operation?: string }).operation === "relay_room_send"
      );
    });
    expect(sendCall).toBeDefined();
    infoSpy.mockRestore();
    spy.mockRestore();
  });

  it("Plan06-T4 (W#7 mqid prefix distinct from pretty-view): generated mqid MUST NOT carry the pv-optim- prefix", async () => {
    const sendMessageSpy = vi.fn();
    const mockedStream = await import("./use-relay-room-stream");
    const spy = vi.spyOn(mockedStream, "useRelayRoomStream").mockReturnValue({
      history: [],
      participants: null,
      error: null,
      pendingSends: [],
      hasOlder: false,
      loadOlderStatus: "idle",
      loadOlderError: null,
      sendMessage: sendMessageSpy,
      fetchOlder: vi.fn(),
    });
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    let textarea: HTMLTextAreaElement | null = null;
    await waitFor(() => {
      textarea = container.querySelector("textarea");
      expect(textarea).not.toBeNull();
    });
    fireEvent.change(textarea!, { target: { value: "hello" } });
    fireEvent.keyDown(textarea!, { key: "Enter" });
    const [, mqid] = sendMessageSpy.mock.calls[0];
    expect(mqid).not.toMatch(/^pv-optim-/);
    spy.mockRestore();
  });

  it("Plan06-T5: stream.participants (WS-derived) takes precedence over REST participants when present", async () => {
    const mockedStream = await import("./use-relay-room-stream");
    const spy = vi.spyOn(mockedStream, "useRelayRoomStream").mockReturnValue({
      history: [],
      participants: {
        humans: [
          { mxid: "@bob:matrix.example.com", displayName: "Bob", userId: "3" },
        ],
        agents: [],
      },
      error: null,
      pendingSends: [],
      hasOlder: false,
      loadOlderStatus: "idle",
      loadOlderError: null,
      sendMessage: vi.fn(),
      fetchOlder: vi.fn(),
    });
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: {
        humans: [
          { mxid: "@tina:matrix.example.com", displayName: "Tina", userId: "2" },
        ],
        agents: [],
      },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      const cells = container.querySelectorAll(
        '[data-testid="relay-room-participant"]',
      );
      // WS participants (Bob) wins over REST (Tina) once the frame lands.
      expect(cells.length).toBe(1);
      expect(cells[0].getAttribute("data-mxid")).toBe(
        "@bob:matrix.example.com",
      );
    });
    spy.mockRestore();
  });

  it("Plan06-T6 (D-18 unified with hook error): stream.error='room-not-found' → RelayRoomErrorState renders", async () => {
    const mockedStream = await import("./use-relay-room-stream");
    const spy = vi.spyOn(mockedStream, "useRelayRoomStream").mockReturnValue({
      history: [],
      participants: null,
      error: "room-not-found",
      pendingSends: [],
      hasOlder: false,
      loadOlderStatus: "idle",
      loadOlderError: null,
      sendMessage: vi.fn(),
      fetchOlder: vi.fn(),
    });
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: { humans: [], agents: [] },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="relay-room-error-state"]'),
      ).not.toBeNull();
    });
    spy.mockRestore();
  });

  it("Test 10 (W#8 wiring): useViewingUserMxid returns null → pane renders a loading state (badge row + message list hidden until mxid known)", async () => {
    // Simulate the W#8 hook still being in-flight.
    mockedUseViewingUserMxid.mockReturnValue(null);
    mockedGet.mockResolvedValueOnce({
      status: 200,
      data: {
        humans: [{ mxid: "@tina:matrix.example.com", displayName: "Tina", userId: "2" }],
        agents: [],
      },
    });
    const { container } = render(
      <RelayRoomPane
        roomId="!room:matrix.example.com"
        roomTitle={null}
        isVisible={true}
      />,
    );
    // The pane renders a loading affordance (small textual "Loading…" per
    // the graceful-degradation strategy in PLAN.md).
    await waitFor(() => {
      const loading = container.querySelector(
        '[data-testid="relay-room-loading"]',
      );
      expect(loading).not.toBeNull();
    });
    // While loading, the badge row + message list are NOT rendered (we don't
    // yet know which human to filter out per D-07).
    expect(
      container.querySelector('[data-testid="relay-room-identity-badge-row"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="relay-room-message-list"]'),
    ).toBeNull();
  });
});
