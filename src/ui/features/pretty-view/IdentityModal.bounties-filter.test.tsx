/**
 * Quick 260829-f9l — IdentityModal Bounties tab: sticky search box + filter.
 *
 * Locks the frontend contract for the client-side search box added at the top
 * of the Bounties tab:
 *
 *   A. Typing "wire" filters visible cards to only those whose title, premise,
 *      keywords, or slug contain the query (case-insensitive substring).
 *   B. Match by TITLE.
 *   C. Match by PREMISE.
 *   D. Match by KEYWORDS[].
 *   E. Match by SLUG.
 *   F. Empty-state renders `no matches for "…"` when query has no matches AND
 *      the archive IS loaded (with zero matches too).
 *   G. Archive-not-loaded hint renders when open has no matches AND the archive
 *      is NOT loaded; typing does NOT force an archive fetch.
 *   H. Filter applies to expanded archive too (loaded archive; query matches
 *      only the archived card).
 *   I. X-button clear: after typing, click the X to reset query to "".
 *   J. Escape clears: after typing, pressing Escape resets query to "".
 *   K. No autofocus on tab open — `document.activeElement` is not the input.
 *
 * Mock strategy mirrors IdentityModal.role-tab.test.tsx: WsStub factory +
 * module mock on @/api/claude-session-api. The modal opens ~6 parallel WS
 * (initial bounties + 5 artifact fetches); tests identify the bounties WS
 * via `findSocketForRequestType("identity:list-bounties")`.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

// ── WS stub with scriptable message queue (verbatim from role-tab test) ──────
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
  // Auto-fire onopen on next tick so the modal's `send` code inside sock.onopen
  // runs deterministically per test.
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
    // stays-awake init call — return a stable value so the effect doesn't error out.
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

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    invalidateIdentity: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Late imports ─────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";
// Phase 72 Plan 03: per-test reset of the modal-scope-store so scope memory
// from one test never leaks into the next.
import { __resetModalScopeForTest } from "@/state/modal-scope-store";
import type { Bounty } from "@/api/claude-session-api";

// ── Fixture ──────────────────────────────────────────────────────────────────
// Phase 68: Identity no longer has id/createdAt/updatedAt; avatarUrl bakes
// hostId at backend (no avatarUrlWithHost on frontend).
const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Old title",
  colorHue: null,
  voice: null,
  role: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
};

function renderModal(): void {
  render(
    <IdentityModal
      open={true}
      onOpenChange={vi.fn()}
      identity={BASE_IDENTITY}
      hue={200}
      hostId={1}
      container={document.body}
    />,
  );
}

/**
 * Find the socket whose first-sent payload matched the given type.
 * The modal opens 6 sockets (bounties + 5 artifact fetches); each sends its
 * request payload inside sock.onopen. This helper filters to the matching one.
 */
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

// ── Bounty fixtures ──────────────────────────────────────────────────────────
// Four OPEN bounties covering matches on title / premise / keywords / slug,
// plus one archived bounty for Test H.

function makeBounty(over: Partial<Bounty>): Bounty {
  return {
    id: over.id ?? "b-default",
    slug: over.slug ?? "260827-def-default",
    title: over.title ?? "Default title",
    premise: over.premise ?? "Default premise",
    status: over.status ?? "in_progress",
    priority: over.priority ?? "medium",
    pinned: over.pinned ?? false,
    needs_desk: over.needs_desk ?? false,
    keywords: over.keywords ?? [],
    requested_by: over.requested_by ?? null,
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: over.updated_at ?? "2026-01-01T00:00:00Z",
    timeline: over.timeline ?? [],
    todos: over.todos ?? [],
    source_links: over.source_links ?? [],
    deadline: over.deadline ?? null,
    meeting_questions: over.meeting_questions ?? [],
  };
}

const OPEN_BOUNTIES: Bounty[] = [
  makeBounty({
    id: "b1",
    slug: "260827-w1r-wire-rdp",
    title: "Wire the RDP relay",
    premise: "Route RDP traffic through the guacd bridge.",
    keywords: ["rdp", "guacd"],
    status: "in_progress",
    priority: "high",
  }),
  makeBounty({
    id: "b2",
    slug: "260827-crt-fix-cert-renewal",
    title: "Fix cert renewal",
    premise: "Investigate the guacd freeze on reconnect.",
    keywords: ["cert", "tls"],
    status: "waiting_on_someone_else",
    priority: "medium",
  }),
  makeBounty({
    id: "b3",
    slug: "260827-dsh-ship-dashboard",
    title: "Ship dashboard",
    premise: "Move the sessions dashboard behind the /sessions/ prefix.",
    keywords: ["freerdp", "network"],
    status: "in_progress",
    priority: "urgent",
  }),
  makeBounty({
    id: "b4",
    slug: "260828-a1b-fix-caddy-conf",
    title: "Sweep old configs",
    premise: "Remove stale VNC entries from the manager.",
    keywords: ["vnc"],
    status: "in_progress",
    priority: "low",
  }),
];

const ARCHIVED_BOUNTY: Bounty = makeBounty({
  id: "arc1",
  slug: "260701-old-purge-legacy",
  title: "Purge legacy tunnels",
  premise: "Old SSM ports.",
  keywords: ["ssm"],
  status: "done",
  priority: "unprioritized",
  updated_at: "2026-05-01T00:00:00Z",
});

/** Deliver the initial-open bounties response (open list only, empty archive). */
function deliverInitialBounties(bounties: Bounty[] = OPEN_BOUNTIES): void {
  const sock = findSocketForRequestType("identity:list-bounties");
  expect(sock).toBeDefined();
  act(() => {
    sock!.onmessage!({
      data: JSON.stringify({
        type: "identity:bounties",
        bounties,
        archivedBounties: [],
      }),
    } as MessageEvent<string>);
  });
}

// Phase 72 Plan 03: tap the segmented Role/Identity scope switch. Bounties
// lives under Role scope in the new shape; the actor mount defaults to
// scope='identity' so we must flip to Role before the Bounties nav button
// becomes visible.
function switchScope(scope: "role" | "identity"): void {
  const btn = document.querySelector(
    `[data-testid="scope-switch-${scope}"]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`scope-switch-${scope} button not found`);
  fireEvent.click(btn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup — Phase 72 Plan 03: actor identities now default to
// scope='identity'; Bounties tab lives under scope='role'. Flip scope FIRST,
// then click the Bounties nav button (which is only rendered under Role).
// ─────────────────────────────────────────────────────────────────────────────
async function renderModalOnBountiesTab(): Promise<void> {
  renderModal();
  // Let queueMicrotask fire onopen on each fake socket so send() runs.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  switchScope("role");
  const bountiesNavBtn = Array.from(
    document.querySelectorAll(".shrink-0.flex.items-stretch button"),
  ).find((b) => b.textContent?.includes("Bounties")) as
    | HTMLButtonElement
    | undefined;
  if (bountiesNavBtn) {
    fireEvent.click(bountiesNavBtn);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
  __resetModalScopeForTest();
});

afterEach(() => {
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test A — typing "wire" hides non-matching cards
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal Bounties filter — basic behavior", () => {
  it("Test A: typing 'wire' hides non-matching cards; matching card visible", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    // All four cards visible before typing.
    await waitFor(() => {
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.getByText("Fix cert renewal")).toBeTruthy();
      expect(screen.getByText("Ship dashboard")).toBeTruthy();
      expect(screen.getByText("Sweep old configs")).toBeTruthy();
    });

    // Find and type into the search input.
    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "wire" } });

    // Only the "Wire the RDP relay" card remains.
    await waitFor(() => {
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
      expect(screen.queryByText("Ship dashboard")).toBeNull();
      expect(screen.queryByText("Sweep old configs")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test B — match by TITLE
  // ─────────────────────────────────────────────────────────────────────────
  it("Test B: matches by title (query 'rdp' → 'Wire the RDP relay')", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "rdp" } });

    await waitFor(() => {
      // Matches by title (RDP appears in "Wire the RDP relay").
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      // Non-matching cards hidden.
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
      expect(screen.queryByText("Sweep old configs")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test C — match by PREMISE
  // ─────────────────────────────────────────────────────────────────────────
  it("Test C: matches by premise (query 'guacd' → premise contains 'guacd bridge')", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "guacd" } });

    await waitFor(() => {
      // Both cards whose premise or keywords contain "guacd" are visible.
      // b1: keywords contains "guacd" AND premise contains "guacd bridge".
      // b2: premise contains "guacd freeze".
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.getByText("Fix cert renewal")).toBeTruthy();
      // Non-matching cards hidden.
      expect(screen.queryByText("Ship dashboard")).toBeNull();
      expect(screen.queryByText("Sweep old configs")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test D — match by KEYWORDS[]
  // ─────────────────────────────────────────────────────────────────────────
  it("Test D: matches by keywords (query 'freerdp' → b3 whose keywords contain 'freerdp')", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "freerdp" } });

    await waitFor(() => {
      // b3 is the only match — its keywords include "freerdp".
      expect(screen.getByText("Ship dashboard")).toBeTruthy();
      // Non-matching cards hidden.
      expect(screen.queryByText("Wire the RDP relay")).toBeNull();
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
      expect(screen.queryByText("Sweep old configs")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test E — match by SLUG
  // ─────────────────────────────────────────────────────────────────────────
  it("Test E: matches by slug (query 'caddy' → b4 slug '260828-a1b-fix-caddy-conf')", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "caddy" } });

    await waitFor(() => {
      // b4 is the only match — slug contains "caddy".
      expect(screen.getByText("Sweep old configs")).toBeTruthy();
      // Non-matching cards hidden.
      expect(screen.queryByText("Wire the RDP relay")).toBeNull();
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
      expect(screen.queryByText("Ship dashboard")).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty-state coverage
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal Bounties filter — empty state", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Test F — no matches + archive loaded → `no matches for "…"`
  //          (archive-not-loaded hint MUST NOT appear).
  // ─────────────────────────────────────────────────────────────────────────
  it("Test F: query with no matches and archive loaded → renders `no matches for \"…\"` (no archive-not-loaded hint)", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    // Load the archive (empty) so archivedLoadState === "loaded".
    // Expand the Archive accordion which triggers the fetch; then feed the
    // fetch's response.
    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: /^Archive$/ }),
    );
    await act(async () => {
      fireEvent.click(trigger);
      // give the microtask a chance to fire onopen on the new archive WS
      await new Promise((r) => setTimeout(r, 0));
    });
    // Find the SECOND identity:list-bounties socket (the archive fetch).
    const archiveSock = openedSockets
      .filter((s) => s.__sentPayloads.length > 0)
      .find((s) => {
        try {
          const p = JSON.parse(s.__sentPayloads[0]) as {
            type?: string;
            includeArchived?: boolean;
          };
          return (
            p.type === "identity:list-bounties" && p.includeArchived === true
          );
        } catch {
          return false;
        }
      });
    expect(archiveSock).toBeDefined();
    act(() => {
      archiveSock!.onmessage!({
        data: JSON.stringify({
          type: "identity:bounties",
          bounties: OPEN_BOUNTIES,
          archivedBounties: [],
        }),
      } as MessageEvent<string>);
    });

    // Type a query that matches nothing.
    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "zzznomatchzzz" } });

    await waitFor(() => {
      expect(screen.getByText(/no matches for/i)).toBeTruthy();
    });
    // Archive-not-loaded hint MUST NOT appear (archive IS loaded).
    expect(screen.queryByText(/archive not loaded/i)).toBeNull();
    // No card titles rendered.
    expect(screen.queryByText("Wire the RDP relay")).toBeNull();
    expect(screen.queryByText("Fix cert renewal")).toBeNull();
    expect(screen.queryByText("Ship dashboard")).toBeNull();
    expect(screen.queryByText("Sweep old configs")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test G — no matches + archive NOT loaded → hint appears, no WS fires.
  // ─────────────────────────────────────────────────────────────────────────
  it("Test G: query with no matches and archive unloaded → renders archive-not-loaded hint; typing fires NO archive WS", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    // Snapshot state BEFORE typing: how many sockets exist, and how many
    // include-archived payloads have been sent.
    const beforeSocketCount = openedSockets.length;
    const beforeArchiveFetches = openedSockets.filter((s) =>
      s.__sentPayloads.some((p) => {
        try {
          const parsed = JSON.parse(p) as { includeArchived?: boolean };
          return parsed.includeArchived === true;
        } catch {
          return false;
        }
      }),
    ).length;
    expect(beforeArchiveFetches).toBe(0);

    // Type a query that matches nothing in the open set.
    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "zzznomatchzzz" } });

    await waitFor(() => {
      expect(screen.getByText(/no matches for/i)).toBeTruthy();
    });
    // The archive-not-loaded hint MUST be present (archive is unloaded).
    expect(screen.getByText(/archive not loaded/i)).toBeTruthy();

    // Deltas — no NEW socket opened, no NEW archive fetch sent.
    expect(openedSockets.length).toBe(beforeSocketCount);
    const afterArchiveFetches = openedSockets.filter((s) =>
      s.__sentPayloads.some((p) => {
        try {
          const parsed = JSON.parse(p) as { includeArchived?: boolean };
          return parsed.includeArchived === true;
        } catch {
          return false;
        }
      }),
    ).length;
    expect(afterArchiveFetches).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H — filter applies to expanded archive too
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal Bounties filter — archive path", () => {
  it("Test H: filter applies to expanded archive body (query matches only archived card)", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    // Expand the archive accordion.
    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: /^Archive$/ }),
    );
    await act(async () => {
      fireEvent.click(trigger);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Feed the archive fetch with the archived bounty fixture.
    const archiveSock = openedSockets
      .filter((s) => s.__sentPayloads.length > 0)
      .find((s) => {
        try {
          const p = JSON.parse(s.__sentPayloads[0]) as {
            type?: string;
            includeArchived?: boolean;
          };
          return (
            p.type === "identity:list-bounties" && p.includeArchived === true
          );
        } catch {
          return false;
        }
      });
    expect(archiveSock).toBeDefined();
    act(() => {
      archiveSock!.onmessage!({
        data: JSON.stringify({
          type: "identity:bounties",
          bounties: OPEN_BOUNTIES,
          archivedBounties: [ARCHIVED_BOUNTY],
        }),
      } as MessageEvent<string>);
    });

    // Sanity: archived card visible before typing.
    await waitFor(() => {
      expect(screen.getByText("Purge legacy tunnels")).toBeTruthy();
    });

    // Type a query that ONLY matches the archived card (its title contains
    // "purge" — none of the OPEN bounties do).
    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "purge" } });

    await waitFor(() => {
      // Archived card is visible.
      expect(screen.getByText("Purge legacy tunnels")).toBeTruthy();
      // No OPEN card is visible.
      expect(screen.queryByText("Wire the RDP relay")).toBeNull();
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
      expect(screen.queryByText("Ship dashboard")).toBeNull();
      expect(screen.queryByText("Sweep old configs")).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I / J — clear via X button and Escape
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal Bounties filter — clear", () => {
  it("Test I: X button clears the query and restores the full list", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "wire" } });

    // Filtered list visible; X button visible.
    await waitFor(() => {
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
    });
    const clearBtn = screen.getByRole("button", { name: /clear search/i });
    expect(clearBtn).toBeTruthy();

    fireEvent.click(clearBtn);

    // Full unfiltered list returns.
    await waitFor(() => {
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.getByText("Fix cert renewal")).toBeTruthy();
      expect(screen.getByText("Ship dashboard")).toBeTruthy();
      expect(screen.getByText("Sweep old configs")).toBeTruthy();
    });
    // Input value reset.
    expect((input as HTMLInputElement).value).toBe("");
    // X button disappears when query is empty again.
    expect(screen.queryByRole("button", { name: /clear search/i })).toBeNull();
  });

  it("Test J: Escape on the input clears the query and restores the full list", async () => {
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    fireEvent.change(input, { target: { value: "wire" } });

    await waitFor(() => {
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.queryByText("Fix cert renewal")).toBeNull();
    });

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByText("Wire the RDP relay")).toBeTruthy();
      expect(screen.getByText("Fix cert renewal")).toBeTruthy();
      expect(screen.getByText("Ship dashboard")).toBeTruthy();
      expect(screen.getByText("Sweep old configs")).toBeTruthy();
    });
    expect((input as HTMLInputElement).value).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test K — no autofocus on tab open
// ─────────────────────────────────────────────────────────────────────────────
describe("IdentityModal Bounties filter — focus", () => {
  it("Test K: opening the modal on the Bounties tab does NOT autofocus the search input", async () => {
    // Phase 72 Plan 03: actor default scope='identity' — the Bounties tab
    // isn't the active pane until we flip scope + click the Bounties nav.
    // Use the shared helper so the search input is queryable via getByRole.
    await renderModalOnBountiesTab();
    deliverInitialBounties();

    const input = screen.getByRole("textbox", { name: /search bounties/i });
    // The search input must not be the focused element after mount.
    expect(document.activeElement).not.toBe(input);
  });
});
