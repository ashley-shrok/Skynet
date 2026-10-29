// In-process user flow for the archived conversation tab: opened from search,
// it asks the server for the archived conversation, paints the agent's look,
// shows the history with no compose box, and Un-archive brings it back — the
// tab turns live once the agent is in the identities registry and the fleet.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent, screen } from "@testing-library/react";

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

vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi",
  fetchVoiceCatalog: vi.fn(async () => ({ voices: [], defaultVoice: "", listError: false })),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const { sessionIdentity } = vi.hoisted(() => ({ sessionIdentity: { value: null as unknown } }));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn((s: string | null | undefined) => (s ? s.toLowerCase() : null)),
  useSessionIdentity: () => ({ identity: sessionIdentity.value, identityHue: null }),
}));

const { unarchiveMock, identitiesState, fleetSessions, refreshOneMock } = vi.hoisted(() => ({
  unarchiveMock: vi.fn(),
  identitiesState: { byHostKey: new Map<string, unknown>() },
  fleetSessions: { list: [] as Array<{ hostId: number; sessionName: string }> },
  refreshOneMock: vi.fn(async () => false),
}));

vi.mock("@/api/identity-unarchive-api", async (orig) => ({
  ...(await orig<typeof import("@/api/identity-unarchive-api")>()),
  unarchiveIdentity: unarchiveMock,
}));

vi.mock("@/state/identities-store", async (orig) => {
  const actual = await orig<typeof import("@/state/identities-store")>();
  return {
    ...actual,
    useIdentities: () => ({ ...actual.useIdentities(), byHostKey: identitiesState.byHostKey }),
    refreshOneIdentity: refreshOneMock,
  };
});

vi.mock("@/state/conversation-store", async (orig) => {
  const actual = await orig<typeof import("@/state/conversation-store")>();
  return { ...actual, getFleetSessionsSnapshot: () => fleetSessions.list };
});

import { ArchivedConversationPane } from "./ArchivedConversationPane";
import { ARCHIVED_TAB_LIVE_EVENT, noteAgentWindowReopen, seedArchivedLook, takeAgentWindowReopen } from "./archived-identity";
import { PrettyView } from "@/features/pretty-view/PrettyView";
import { identityFromArchivedLook } from "./archived-identity";
import type { Tab, Host } from "@/types/ui-types";

const host = { id: "7", name: "harbor", enableSsh: true } as unknown as Host;
const tab = {
  id: "harbor-terminal-1",
  instanceId: "i1",
  type: "terminal",
  label: "olden",
  host,
  openedAt: 0,
  targetTmuxSession: "olden",
  sessionKind: "archived",
} as Tab;

const look = {
  identityKey: "olden",
  hostId: 7,
  displayName: "Olden",
  title: null,
  colorHue: 140,
  voice: null,
  task: "Fix the printer",
  role: "box-maintainer",
  roles: ["box-maintainer"],
  archivedRoles: [],
  roleDisplayNames: { "box-maintainer": "Skynet" },
  avatarUrl: "",
};

function frame(ws: WsStub, data: unknown) {
  act(() => {
    ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  });
}

function mount() {
  const onCloseTab = vi.fn();
  const utils = render(<ArchivedConversationPane tab={tab} host={host} isVisible={true} onCloseTab={onCloseTab} />);
  const ws = wsStubs[wsStubs.length - 1]!;
  act(() => ws.onopen?.());
  return { ...utils, ws, onCloseTab };
}

describe("archived conversation tab", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
    wsStubs.length = 0;
    unarchiveMock.mockReset();
    refreshOneMock.mockClear();
    identitiesState.byHostKey = new Map();
    fleetSessions.list = [];
    sessionIdentity.value = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the archived conversation, paints the agent, shows history and no compose box", async () => {
    seedArchivedLook({ ...look, task: "From search" });
    const { ws, container } = mount();
    const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(sent).toEqual({ type: "connectToPane", hostId: 7, tmuxSession: "olden", archived: true });
    // Painted from search's look before the server answers.
    expect(screen.getByTestId("pv-task-pill-label").textContent).toContain("From search");

    frame(ws, { type: "archived_state", state: "archived", look });
    frame(ws, { type: "message", role: "assistant", content: "old reply", eventId: "a-1", ts: Date.now(), line: 3 });
    await waitFor(() => expect(container.textContent).toContain("old reply"));
    expect(screen.getByTestId("pv-task-pill-label").textContent).toContain("Fix the printer");
    expect(screen.getByTestId("archived-strip").textContent).toContain("Archived");
    expect(container.querySelector('textarea[placeholder="Write a message…"]')).toBeNull();
  });

  it("says so when no history was kept", async () => {
    const { ws } = mount();
    frame(ws, { type: "archived_state", state: "archived", look });
    frame(ws, { type: "archived_state", state: "archived", noHistory: true });
    await waitFor(() => expect(screen.getByTestId("archived-no-history")).toBeTruthy());
  });

  it("Un-archive: refused → stays archived and says why", async () => {
    const { UnarchiveError } = await import("@/api/identity-unarchive-api");
    unarchiveMock.mockRejectedValue(new UnarchiveError("blocked", "missing_roles", ["gardener"]));
    const { ws } = mount();
    frame(ws, { type: "archived_state", state: "archived", look });
    fireEvent.click(screen.getByTestId("archived-unarchive"));
    await waitFor(() =>
      expect(screen.getByTestId("archived-strip-status").textContent).toContain("Un-archive role gardener first"),
    );
  });

  it("Un-archive: restored → turns live once the agent is loaded and its session is running", async () => {
    unarchiveMock.mockResolvedValue({ outcome: "restored" });
    const live = vi.fn();
    window.addEventListener(ARCHIVED_TAB_LIVE_EVENT, live);
    const { ws, rerender, onCloseTab } = mount();
    frame(ws, { type: "archived_state", state: "archived", look });
    fireEvent.click(screen.getByTestId("archived-unarchive"));
    await waitFor(() => expect(screen.getByTestId("archived-strip-status").textContent).toContain("Coming back"));
    await waitFor(() => expect(refreshOneMock).toHaveBeenCalledWith("olden", 7));
    expect(live).not.toHaveBeenCalled();

    // The agent shows up: identity loaded, session in the fleet list.
    identitiesState.byHostKey = new Map([["7::olden", { identityKey: "olden" }]]);
    fleetSessions.list = [{ hostId: 7, sessionName: "olden" }];
    rerender(<ArchivedConversationPane tab={tab} host={host} isVisible={true} onCloseTab={onCloseTab} />);
    await waitFor(() => expect(live).toHaveBeenCalledTimes(1));
    expect((live.mock.calls[0][0] as CustomEvent).detail).toEqual({ tabId: tab.id });
    window.removeEventListener(ARCHIVED_TAB_LIVE_EVENT, live);
  });

  it("an agent window open when the tab turns live is handed over to reopen on the same tab", async () => {
    const { ws, rerender, onCloseTab } = mount();
    frame(ws, { type: "archived_state", state: "archived", look });
    fireEvent.click(screen.getByTestId("pv-task-pill-open"));
    await waitFor(() => expect(screen.getByTestId("identity-modal")).toBeTruthy());
    frame(ws, { type: "archived_state", state: "live" });
    identitiesState.byHostKey = new Map([["7::olden", { identityKey: "olden" }]]);
    fleetSessions.list = [{ hostId: 7, sessionName: "olden" }];
    rerender(<ArchivedConversationPane tab={tab} host={host} isVisible={true} onCloseTab={onCloseTab} />);
    await waitFor(() => expect(takeAgentWindowReopen(tab.id)).toEqual({ tab: "identity" }));
  });

  it("the live view reopens a handed-over agent window, now editable", async () => {
    sessionIdentity.value = identityFromArchivedLook(look);
    noteAgentWindowReopen("tab-x", "identity");
    render(<PrettyView hostId={7} tmuxSession="olden" tabId="tab-x" isVisible={true} />);
    await waitFor(() => expect(screen.getByTestId("identity-modal")).toBeTruthy());
    expect(takeAgentWindowReopen("tab-x")).toBeNull();
  });

  it("not in the archive → its notice, and the loading spinner never sits on top", async () => {
    const { ws } = mount();
    frame(ws, { type: "archived_state", state: "gone" });
    await waitFor(() => expect(screen.getByTestId("archived-gone")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByLabelText("Loading conversation…")).toBeNull();
    expect(screen.queryByTestId("archived-unarchive")).toBeNull();
  });

  it("stale lists alone never turn the tab live — the server said archived", async () => {
    identitiesState.byHostKey = new Map([["7::olden", { identityKey: "olden" }]]);
    fleetSessions.list = [{ hostId: 7, sessionName: "olden" }];
    const live = vi.fn();
    window.addEventListener(ARCHIVED_TAB_LIVE_EVENT, live);
    const { ws } = mount();
    frame(ws, { type: "archived_state", state: "archived", look });
    await new Promise((r) => setTimeout(r, 50));
    expect(live).not.toHaveBeenCalled();
    window.removeEventListener(ARCHIVED_TAB_LIVE_EVENT, live);
  });

  it("the server says the agent is live again (un-archived elsewhere) → waits for it, then turns live", async () => {
    const live = vi.fn();
    window.addEventListener(ARCHIVED_TAB_LIVE_EVENT, live);
    const { ws, rerender, onCloseTab } = mount();
    frame(ws, { type: "archived_state", state: "live" });
    await waitFor(() => expect(screen.getByTestId("archived-strip-status").textContent).toContain("Coming back"));
    identitiesState.byHostKey = new Map([["7::olden", { identityKey: "olden" }]]);
    fleetSessions.list = [{ hostId: 7, sessionName: "olden" }];
    rerender(<ArchivedConversationPane tab={tab} host={host} isVisible={true} onCloseTab={onCloseTab} />);
    await waitFor(() => expect(live).toHaveBeenCalledTimes(1));
    window.removeEventListener(ARCHIVED_TAB_LIVE_EVENT, live);
  });
});
