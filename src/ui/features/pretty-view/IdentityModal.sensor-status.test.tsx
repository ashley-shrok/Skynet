/**
 * Sensors shape 2 — in-process flow through the identity modal's Wake-ups
 * tab: a sensor wake-up shows its status on the row, the opened view shows
 * the read-only sensor section (with error lines when broken), clock
 * wake-ups show last fired, and an open Wake-ups tab re-reads its list
 * every 30s — and only while it's showing.
 *
 * WS harness copied from IdentityModal.wakeup-crud.test.tsx.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub with scriptable message queue ────────────────────────────────────
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
  __sentPayloads: string[];
};

const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
  const ws: WsStub = {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((payload: string) => {
      ws.__sentPayloads.push(payload);
    }),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    __sentPayloads: [],
  };
  openedSockets.push(ws);
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
    getIdentityNoDormancy: vi.fn().mockResolvedValue(false),
    setIdentityNoDormancy: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    applyIdentityChange: vi.fn(),
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: new Map(),
      loaded: true,
      refresh: vi.fn(),
    })),
  };
});

// Phase 89 Plan 05: RunbooksTab (mounted inside IdentityModal) calls listRunbooks
// via HTTP. Mock it to return an empty list so the tab renders without a network call.
vi.mock("@/api/runbooks-api", () => ({
  listRunbooks: vi.fn().mockResolvedValue([]),
}));

// Phase 112 Plan 03 — AddWakeupDialog's instruction field now routes through
// MarkdownEditor (D-06 pretty branch via synthetic filename="wakeup.md").
// Stub MDXEditor as a controlled <textarea data-testid="mdxeditor"> so
// Test W1's fireEvent.change on the instruction affordance still works.
// Rule 3 auto-fix: this test file was broken by Plan 03's swap; the same
// enhanced mock pattern lives in AddWakeupDialog.test.tsx / WakeupsTab.test.tsx.
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: {
    markdown: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      value={props.markdown}
      onChange={(e) => props.onChange?.(e.target.value)}
      disabled={props.readOnly}
      data-testid="mdxeditor"
    />
  ),
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  tablePlugin: () => ({}),
  codeBlockPlugin: () => ({}),
  codeMirrorPlugin: () => ({}),
  frontmatterPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  UndoRedo: () => null,
  BoldItalicUnderlineToggles: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  InsertTable: () => null,
  ListsToggle: () => null,
  InsertFrontmatter: () => null,
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";
// Phase 90 Plan 90-06 (D-09): __resetModalScopeForTest reference DELETED —
// the modal-scope store no longer backs identity-modal state.

// ── Fixture ──────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Actor identity",
  colorHue: null,
  voice: null,
  role: null,
  task: null,
  project: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
};

function renderModal(identityOverrides?: Partial<Identity>): void {
  const identity: Identity = { ...BASE_IDENTITY, ...identityOverrides };
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={identity}
      hue={200}
      hostId={1}
      // Phase 90 Plan 90-06: onOpenRoleModal is the new required prop.
      onOpenRoleModal={vi.fn()}
      container={document.body}
    />,
  );
}

function findSocketForRequestType(reqType: string): WsStub | undefined {
  return openedSockets.find((ws) => {
    if (ws.__sentPayloads.length === 0) return false;
    try {
      const parsed = JSON.parse(ws.__sentPayloads[0]) as { type?: string };
      return parsed.type === reqType;
    } catch {
      return false;
    }
  });
}

function socketsForRequestType(reqType: string): WsStub[] {
  return openedSockets.filter((ws) => {
    try {
      return (JSON.parse(ws.__sentPayloads[0] ?? "{}") as { type?: string }).type === reqType;
    } catch {
      return false;
    }
  });
}

const NOW = Math.floor(Date.now() / 1000);

function wakeupsPayload(sensorState: "healthy" | "broken") {
  return {
    type: "identity:wakeups",
    wakeups: [
      {
        slug: "morning",
        name: "morning",
        enabled: true,
        schedule: { type: "daily", at: "09:00" },
        scheduleHuman: "daily @ 09:00",
        instruction: "x",
        lastFiredAt: NOW - 3 * 3600,
        sensor: null,
      },
      {
        slug: "never",
        name: "never",
        enabled: true,
        schedule: { type: "interval", every: "1h" },
        scheduleHuman: "every 1h",
        instruction: "x",
        lastFiredAt: null,
        sensor: null,
      },
      {
        slug: "watcher",
        name: "watcher",
        enabled: true,
        schedule: { type: "sensor" },
        scheduleHuman: "Sensor",
        instruction: "x",
        lastFiredAt: NOW - 2 * 3600,
        sensor: {
          state: sensorState,
          run: "cadence",
          cadenceHuman: "Every 5m",
          lastRanAt: NOW - 60,
          waitingFires: 0,
          error: sensorState === "broken" ? "Traceback: boom" : null,
        },
      },
    ],
  };
}

function deliver(sock: WsStub, payload: unknown): void {
  act(() => {
    sock.onmessage!({ data: JSON.stringify(payload) } as MessageEvent<string>);
  });
}

function clickNav(value: string): void {
  const btn = document.querySelector(`[data-testid="identity-modal-nav-${value}"]`) as HTMLButtonElement | null;
  expect(btn).not.toBeNull();
  fireEvent.click(btn!);
}

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("IdentityModal Wake-ups tab — sensor status (sensors shape 2)", () => {
  it("rows show sensor status and last fired; the opened sensor shows its section", async () => {
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    clickNav("identity-wakeups");
    deliver(findSocketForRequestType("identity:list-wakeups")!, wakeupsPayload("broken"));

    const summary = await screen.findByTestId("wakeup-sensor-summary");
    expect(summary.textContent).toContain("Sensor");
    expect(summary.textContent).toContain("Broken");
    expect(summary.textContent).toContain("Last fired 2h ago");
    expect(screen.getByTestId("wakeup-sensor-summary-state").getAttribute("data-state")).toBe("broken");

    const lastFired = screen.getAllByTestId("wakeup-last-fired").map((n) => n.textContent);
    expect(lastFired).toEqual([" · Last fired 3h ago", " · Never fired"]);

    // Error lines stay off the row until it's opened.
    expect(screen.queryByTestId("wakeup-sensor-details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /watcher/i }));
    const details = await screen.findByTestId("wakeup-sensor-details");
    expect(details.textContent).toContain("Runs: Every 5m");
    expect(details.textContent).toContain("Last ran");
    expect(details.textContent).toContain("Last fired");
    expect(screen.getByTestId("wakeup-sensor-details-error").textContent).toBe("Traceback: boom");
  });

  it("re-reads the list every 30s while the tab shows, and stops when it doesn't", async () => {
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    clickNav("identity-wakeups");
    deliver(findSocketForRequestType("identity:list-wakeups")!, wakeupsPayload("healthy"));
    expect((await screen.findByTestId("wakeup-sensor-summary-state")).textContent).toBe("Healthy");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    // Generous wait: under a full parallel run the refresh's socket opens slowly.
    await waitFor(() => expect(socketsForRequestType("identity:list-wakeups").length).toBe(2), { timeout: 5000 });
    deliver(socketsForRequestType("identity:list-wakeups")[1], wakeupsPayload("broken"));
    await waitFor(() =>
      expect(screen.getByTestId("wakeup-sensor-summary-state").textContent).toBe("Broken"),
    );

    // Leave the tab — no further reads.
    clickNav("identity");
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(socketsForRequestType("identity:list-wakeups").length).toBe(2);
  });

  it("a refresh the machine doesn't answer turns sensors Unknown, keeping the rows", async () => {
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    clickNav("identity-wakeups");
    deliver(findSocketForRequestType("identity:list-wakeups")!, wakeupsPayload("healthy"));
    expect((await screen.findByTestId("wakeup-sensor-summary-state")).textContent).toBe("Healthy");

    // Advance until the refresh goes out: under load the tab's refresh timer
    // can be (re)armed after a single advance, which would then never fire.
    // One refresh runs at a time, so extra ticks don't send a third.
    for (let i = 0; i < 50 && socketsForRequestType("identity:list-wakeups").length < 2; i++) {
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(socketsForRequestType("identity:list-wakeups").length).toBe(2);
    deliver(socketsForRequestType("identity:list-wakeups")[1], {
      type: "identity:wakeups",
      wakeups: [],
      error: "host unreachable",
    });
    await waitFor(() =>
      expect(screen.getByTestId("wakeup-sensor-summary-state").textContent).toBe("Unknown"),
    );
    // Clock rows are untouched.
    expect(screen.getAllByTestId("wakeup-last-fired")).toHaveLength(2);
  });

  it("a background refresh never wipes an edit in progress", async () => {
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    clickNav("identity-wakeups");
    deliver(findSocketForRequestType("identity:list-wakeups")!, wakeupsPayload("healthy"));
    fireEvent.click(await screen.findByRole("button", { name: /morning/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit schedule" })[0]);
    const nameInput = (await screen.findByLabelText("Wakeup name")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "morning — edited" } });

    // Advance until the refresh goes out: under load the tab's refresh timer
    // can be (re)armed after a single advance, which would then never fire.
    // One refresh runs at a time, so extra ticks don't send a third.
    for (let i = 0; i < 50 && socketsForRequestType("identity:list-wakeups").length < 2; i++) {
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(socketsForRequestType("identity:list-wakeups").length).toBe(2);
    // Same data, freshly parsed (new schedule objects) — the classic trigger.
    deliver(socketsForRequestType("identity:list-wakeups")[1], wakeupsPayload("healthy"));
    await new Promise((r) => setTimeout(r, 0));
    expect((screen.getByLabelText("Wakeup name") as HTMLInputElement).value).toBe("morning — edited");
  });
});
