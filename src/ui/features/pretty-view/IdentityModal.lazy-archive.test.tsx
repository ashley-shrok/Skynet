/**
 * Quick 260823-80r — IdentityModal: lazy-load archived bounties on Accordion expand
 *
 * Locks the frontend contract for the opt-in archive fetch:
 *   1. Initial modal-open bounties WS carries NO `includeArchived: true`
 *      (backend defaults to false, so both omitted and explicit false are
 *      accepted).
 *   2. Archive accordion IS rendered pre-load (needs a click target); trigger
 *      label is `Archive` (no count in parens — count unknown yet).
 *   3. Clicking the AccordionTrigger opens a NEW WS via openClaudeSessionSocket
 *      and its first send() carries `includeArchived: true`. Label transitions
 *      to `Archive (loading…)` while in flight.
 *   4. On response `{type: "identity:bounties", bounties: [], archivedBounties: [3 items]}`,
 *      the state is `loaded`, label reads `Archive (3)`, and the 3 BountyCards
 *      render inside the AccordionContent.
 *   5. Idempotency — after test 4's loaded state, clicking to collapse and
 *      re-expand does NOT open a second archive WS. Only ONE archive fetch
 *      across both expand events.
 *   6. Failure path — archive WS `onclose`-before-response → label reads
 *      `Archive (failed to load — click to retry)`. Clicking the trigger
 *      again fires a NEW archive WS with `includeArchived: true`.
 *
 * Mock strategy mirrors IdentityModal.test.tsx: WsStub factory + module mock
 * on @/api/claude-session-api. The modal opens ~6 parallel WS via
 * openClaudeSessionSocket (initial bounties + 5 artifact reads); every call
 * to the factory returns a fresh stub and the tests identify the bounties WS
 * by inspecting the first send() payload for `type: "identity:list-bounties"`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub factory ─────────────────────────────────────────────────────────
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

// Track EVERY WS the modal opens so tests can inspect payloads and count
// how many bounties WS were opened (initial fetch + any archive fetches).
const openedSockets: WsStub[] = [];

function makeFakeWs(): WsStub {
  const stub: WsStub = {
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
  openedSockets.push(stub);
  return stub;
}

// Filter the sockets list for those whose first send() carried a
// `identity:list-bounties` payload — these are the bounties fetches we care
// about (the ~5 other WS are identity-file, role-file, history, wakeups,
// handoff and are not relevant here).
function bountiesSockets(): WsStub[] {
  return openedSockets.filter((s) => {
    if (s.send.mock.calls.length === 0) return false;
    try {
      const [firstArg] = s.send.mock.calls[0];
      const parsed = JSON.parse(String(firstArg));
      return parsed?.type === "identity:list-bounties";
    } catch {
      return false;
    }
  });
}

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ─

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    updateIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
    // Quick 260811-ax1: stays-awake init call — return a stable value so the
    // effect doesn't error out. The modal never asserts on this in these tests.
    getIdentityNoDormancy: vi.fn().mockResolvedValue(false),
    setIdentityNoDormancy: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
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

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    invalidateIdentity: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Late imports ────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";

// ── Shared fixture ──────────────────────────────────────────────────────────
const BASE_IDENTITY: Identity = {
  id: "id-wendy",
  identityKey: "wendy",
  displayName: "Wendy",
  title: "Fleet maintainer",
  colorHue: null,
  voice: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/id-wendy/avatar",
  avatarEtag: "etag-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderModal() {
  const onOpenChangeSpy = vi.fn();
  render(
    <IdentityModal
      open={true}
      onOpenChange={onOpenChangeSpy}
      identity={BASE_IDENTITY}
      hue={200}
      hostId={7}
      container={document.body}
    />,
  );
  return { onOpenChangeSpy };
}

// Deliver the initial-fetch response so `loading` clears and the Archive
// accordion decision-branch runs. Bounty list is empty by design — tests
// focus on the archive path.
function deliverInitialBountiesResponse(): void {
  const [initialWs] = bountiesSockets();
  expect(initialWs).toBeDefined();
  act(() => {
    initialWs.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "identity:bounties",
          bounties: [],
          archivedBounties: [],
        }),
      }),
    );
  });
}

describe("IdentityModal — lazy-load archived bounties (quick 260823-80r)", () => {
  beforeEach(() => {
    openedSockets.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Don't restoreAllMocks — the module mocks above are hoisted and need to
    // stay bound for every test in this file (matches IdentityModal.test.tsx).
  });

  it("test 1: initial modal-open bounties WS does NOT carry `includeArchived: true`", () => {
    renderModal();

    // Fire the WS onopen so the modal's send() runs.
    const [initialWs] = openedSockets;
    expect(initialWs).toBeDefined();
    act(() => { initialWs.onopen?.(); });

    // Find the socket that sent the identity:list-bounties frame.
    const bounties = bountiesSockets();
    expect(bounties).toHaveLength(1);
    const [firstSendArg] = bounties[0].send.mock.calls[0];
    const parsed = JSON.parse(String(firstSendArg));
    expect(parsed.type).toBe("identity:list-bounties");
    // includeArchived must be either absent OR explicitly false — never true
    // on the initial fetch.
    expect(parsed.includeArchived).not.toBe(true);
  });

  it("test 2: Archive accordion is rendered pre-load with label `Archive` (no count)", async () => {
    renderModal();
    const [initialWs] = openedSockets;
    act(() => { initialWs.onopen?.(); });
    deliverInitialBountiesResponse();

    // The Accordion trigger for Archive must be rendered even though no
    // archived bounties are loaded. It is a <button> whose accessible name
    // starts with "Archive".
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Archive$/ }),
      ).toBeTruthy();
    });

    // No parenthesized count in the label pre-load.
    const trigger = screen.getByRole("button", { name: /^Archive$/ });
    expect(trigger.textContent).not.toMatch(/\(\d+\)/);
    expect(trigger.textContent).not.toMatch(/loading/i);
    expect(trigger.textContent).not.toMatch(/failed/i);
  });

  it("test 3: clicking the Archive trigger opens a new WS and sends `includeArchived: true`; label shows `Archive (loading…)`", async () => {
    renderModal();
    const [initialWs] = openedSockets;
    act(() => { initialWs.onopen?.(); });
    deliverInitialBountiesResponse();

    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: /^Archive$/ }),
    );

    // Snapshot the raw openedSockets count BEFORE click. We inspect the raw
    // list (not bountiesSockets which filters on send() having been called)
    // because the archive WS is created synchronously in loadArchivedBounties
    // but its send() only fires when onopen runs — which we drive manually
    // below.
    const beforeRawCount = openedSockets.length;
    expect(bountiesSockets()).toHaveLength(1);

    await act(async () => {
      fireEvent.click(trigger);
    });

    // A NEW WS was opened synchronously by loadArchivedBounties.
    expect(openedSockets.length).toBe(beforeRawCount + 1);
    const archiveWs = openedSockets[openedSockets.length - 1];
    expect(archiveWs).toBeDefined();

    // Fire onopen on the archive WS so its send() runs.
    act(() => { archiveWs.onopen?.(); });

    // Now the archive WS is a bounties socket too.
    await waitFor(() => {
      expect(bountiesSockets()).toHaveLength(2);
    });

    // The archive WS's first send() must carry includeArchived: true.
    const [sendArg] = archiveWs.send.mock.calls[0];
    const parsed = JSON.parse(String(sendArg));
    expect(parsed.type).toBe("identity:list-bounties");
    expect(parsed.includeArchived).toBe(true);
    expect(parsed.identityKey).toBe("wendy");
    expect(parsed.hostId).toBe(7);

    // While in flight, label reads `Archive (loading…)`.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Archive \(loading/i }),
      ).toBeTruthy();
    });
  });

  it("test 4: on archive response, label transitions to `Archive (3)` and 3 BountyCards render", async () => {
    renderModal();
    const [initialWs] = openedSockets;
    act(() => { initialWs.onopen?.(); });
    deliverInitialBountiesResponse();

    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: /^Archive$/ }),
    );
    await act(async () => {
      fireEvent.click(trigger);
    });

    // Archive WS was opened synchronously — grab it, fire onopen so send()
    // runs, then verify the bounties-socket count.
    const archiveWs = openedSockets[openedSockets.length - 1];
    act(() => { archiveWs.onopen?.(); });
    await waitFor(() => {
      expect(bountiesSockets().length).toBe(2);
    });

    // Deliver 3 archived bounties.
    const threeArchived = [
      {
        id: "a1", slug: "a1", title: "Archived one", premise: "", status: "done",
        priority: "medium", keywords: [], requested_by: null,
        created_at: "2026-01-01", updated_at: "2026-01-01",
        timeline: [], todos: [], pinned: false, needs_desk: false,
        source_links: [], deadline: null, meeting_questions: [],
      },
      {
        id: "a2", slug: "a2", title: "Archived two", premise: "", status: "done",
        priority: "medium", keywords: [], requested_by: null,
        created_at: "2026-01-01", updated_at: "2026-01-02",
        timeline: [], todos: [], pinned: false, needs_desk: false,
        source_links: [], deadline: null, meeting_questions: [],
      },
      {
        id: "a3", slug: "a3", title: "Archived three", premise: "", status: "dropped",
        priority: "medium", keywords: [], requested_by: null,
        created_at: "2026-01-01", updated_at: "2026-01-03",
        timeline: [], todos: [], pinned: false, needs_desk: false,
        source_links: [], deadline: null, meeting_questions: [],
      },
    ];
    act(() => {
      archiveWs.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "identity:bounties",
            bounties: [],
            archivedBounties: threeArchived,
          }),
        }),
      );
    });

    // Label transitions to `Archive (3)`.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Archive \(3\)/ }),
      ).toBeTruthy();
    });

    // The 3 archived titles render inside the accordion content.
    expect(screen.getByText("Archived one")).toBeTruthy();
    expect(screen.getByText("Archived two")).toBeTruthy();
    expect(screen.getByText("Archived three")).toBeTruthy();
  });

  it("test 5: idempotency — collapse and re-expand does NOT open a second archive WS", async () => {
    renderModal();
    const [initialWs] = openedSockets;
    act(() => { initialWs.onopen?.(); });
    deliverInitialBountiesResponse();

    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: /^Archive$/ }),
    );

    // First expand → fires archive WS (opened synchronously; drive onopen).
    await act(async () => {
      fireEvent.click(trigger);
    });
    const archiveWs = openedSockets[openedSockets.length - 1];
    act(() => { archiveWs.onopen?.(); });
    await waitFor(() => {
      expect(bountiesSockets().length).toBe(2);
    });
    act(() => {
      archiveWs.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "identity:bounties",
            bounties: [],
            archivedBounties: [
              {
                id: "z", slug: "z", title: "Zed", premise: "", status: "done",
                priority: "medium", keywords: [], requested_by: null,
                created_at: "", updated_at: "", timeline: [], todos: [],
                pinned: false, needs_desk: false, source_links: [],
                deadline: null, meeting_questions: [],
              },
            ],
          }),
        }),
      );
    });

    // Wait for loaded state.
    const triggerLoaded = await waitFor(() =>
      screen.getByRole("button", { name: /Archive \(1\)/ }),
    );

    // Snapshot count BEFORE the toggle-off + toggle-on cycle.
    const countAfterLoad = bountiesSockets().length;
    expect(countAfterLoad).toBe(2);

    // Snapshot raw openedSockets count so we can also assert NO new WS was
    // opened synchronously (bountiesSockets only counts sockets that have
    // sent — a socket opened but not yet sending would slip the filter).
    const rawCountBeforeToggle = openedSockets.length;

    // Collapse the accordion.
    await act(async () => { fireEvent.click(triggerLoaded); });
    // Re-expand.
    await act(async () => { fireEvent.click(triggerLoaded); });

    // No new WS opened — raw count unchanged AND bountiesSockets count
    // unchanged. Waiting a tick guards against any queued microtask side
    // effect that might have opened a WS asynchronously.
    await new Promise((r) => setTimeout(r, 20));
    expect(openedSockets.length).toBe(rawCountBeforeToggle);
    expect(bountiesSockets().length).toBe(countAfterLoad);
  });

  it("test 6: failure — archive WS onclose before response → label shows `failed to load`; clicking retries with a new WS", async () => {
    renderModal();
    const [initialWs] = openedSockets;
    act(() => { initialWs.onopen?.(); });
    deliverInitialBountiesResponse();

    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: /^Archive$/ }),
    );
    await act(async () => { fireEvent.click(trigger); });

    const archiveWs = openedSockets[openedSockets.length - 1];
    act(() => { archiveWs.onopen?.(); });
    await waitFor(() => {
      expect(bountiesSockets().length).toBe(2);
    });

    // Simulate the WS closing without ever having sent a message back.
    act(() => { archiveWs.onclose?.(); });

    // Label transitions to a failed-to-load state (with retry hint).
    const failedTrigger = await waitFor(() =>
      screen.getByRole("button", { name: /Archive \(failed to load/i }),
    );
    expect(failedTrigger).toBeTruthy();

    const rawCountAfterFailure = openedSockets.length;

    // Click the trigger again to retry — a NEW archive WS opens synchronously.
    await act(async () => { fireEvent.click(failedTrigger); });
    expect(openedSockets.length).toBe(rawCountAfterFailure + 1);
    const retryWs = openedSockets[openedSockets.length - 1];
    act(() => { retryWs.onopen?.(); });

    const [sendArg] = retryWs.send.mock.calls[0];
    const parsed = JSON.parse(String(sendArg));
    expect(parsed.type).toBe("identity:list-bounties");
    expect(parsed.includeArchived).toBe(true);
  });
});
