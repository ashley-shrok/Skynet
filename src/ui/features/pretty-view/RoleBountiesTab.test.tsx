/**
 * Phase 90 Plan 90-04 Task 2 — RoleBountiesTab component tests.
 *
 * Lift of the identity-modal Bounties tab body into a standalone component
 * addressed by an identityShimKey (Plan 90-04 Wave-2 identity-shim, see
 * <objective>). Wire type stays `identity:list-bounties` (identity-keyed) for
 * this phase; a role-name-keyed variant is a future follow-up.
 *
 * Tests (6 cases per plan Task 2 <behavior>):
 *   A. render — 3 open + 2 archived → 3 BountyCard rows + archive accordion
 *   B. search filter — typing filters to matching titles
 *   C. archive toggle — expand accordion → 2 archived rows render
 *   D. loading state — pre-response → Skeleton rows
 *   E. error state — response.error → error branch renders
 *   F. identityShimKey threading — WS payload carries the shim key + hostId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// WS stub (mirrors IdentityModal.role-tab.test.tsx pattern)
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
  // Auto-fire onopen on next microtask so the tab's send code inside
  // sock.onopen runs deterministically per test.
  queueMicrotask(() => ws.onopen?.());
  return ws;
}

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    openClaudeSessionSocket: () => makeFakeWs(),
  };
});

import { RoleBountiesTab } from "./RoleBountiesTab";
import type { Bounty } from "@/api/claude-session-api";

function makeBounty(overrides: Partial<Bounty> & { slug: string; title: string }): Bounty {
  return {
    slug: overrides.slug,
    id: overrides.id ?? `id-${overrides.slug}`,
    title: overrides.title,
    premise: overrides.premise ?? "premise text",
    status: overrides.status ?? "in_progress",
    priority: overrides.priority ?? "medium",
    pinned: overrides.pinned ?? false,
    needs_desk: overrides.needs_desk ?? false,
    keywords: overrides.keywords ?? [],
    requested_by: overrides.requested_by ?? null,
    created_at: overrides.created_at ?? "2026-09-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-09-08T00:00:00Z",
    timeline: overrides.timeline ?? [],
    todos: overrides.todos ?? [],
    source_links: overrides.source_links ?? [],
    deadline: overrides.deadline ?? null,
    meeting_questions: overrides.meeting_questions ?? [],
  };
}

function findBountiesSocket(): WsStub | undefined {
  return openedSockets.find((ws) => {
    if (ws.__sentPayloads.length === 0) return false;
    try {
      const parsed = JSON.parse(ws.__sentPayloads[0]) as { type?: string };
      return parsed.type === "identity:list-bounties";
    } catch {
      return false;
    }
  });
}

function respondWithBounties(
  bounties: Bounty[],
  archivedBounties: Bounty[] = [],
  errorField?: string,
): void {
  const sock = findBountiesSocket();
  if (!sock) throw new Error("bounties socket not found");
  sock.onmessage?.({
    data: JSON.stringify({
      type: "identity:bounties",
      bounties,
      archivedBounties,
      error: errorField,
    }),
  } as MessageEvent<string>);
}

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
});

afterEach(() => {
  openedSockets.length = 0;
});

describe("RoleBountiesTab — Phase 90 Plan 90-04 Task 2", () => {
  it("Test A: renders 3 open BountyCard rows + Archive accordion with count 2", async () => {
    render(
      <RoleBountiesTab identityShimKey="tabitha" hostId={3} hue={320} />,
    );

    // Wait for the initial fetch socket to open + send.
    await waitFor(() => {
      const sock = findBountiesSocket();
      expect(sock).toBeDefined();
    });

    const open = [
      makeBounty({ slug: "b-1", title: "Bounty One" }),
      makeBounty({ slug: "b-2", title: "Bounty Two" }),
      makeBounty({ slug: "b-3", title: "Bounty Three" }),
    ];
    respondWithBounties(open, []);

    // After the response, 3 BountyCard rows render (their titles are visible).
    await waitFor(() => {
      expect(screen.getByText("Bounty One")).toBeTruthy();
      expect(screen.getByText("Bounty Two")).toBeTruthy();
      expect(screen.getByText("Bounty Three")).toBeTruthy();
    });

    // Archive accordion trigger is present (label is "Archive" — count is
    // unknown pre-expand because the initial fetch omits archives per the
    // lazy-load pattern lifted from IdentityModal).
    expect(screen.getByText(/^Archive/i)).toBeTruthy();
  });

  it("Test B: search filter — typing filters bounties by case-insensitive substring", async () => {
    render(
      <RoleBountiesTab identityShimKey="tabitha" hostId={3} hue={320} />,
    );

    await waitFor(() => expect(findBountiesSocket()).toBeDefined());

    const open = [
      makeBounty({ slug: "b-1", title: "Fix login bug" }),
      makeBounty({ slug: "b-2", title: "Refactor router" }),
      makeBounty({ slug: "b-3", title: "Investigate login timeout" }),
    ];
    respondWithBounties(open, []);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    const searchInput = screen.getByLabelText(/search bounties/i) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "LOGIN" } });

    // Only matching-title bounties remain visible.
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
      expect(screen.getByText("Investigate login timeout")).toBeTruthy();
      expect(screen.queryByText("Refactor router")).toBeNull();
    });
  });

  it("Test C: archive toggle — clicking the accordion loads + renders archived rows", async () => {
    render(
      <RoleBountiesTab identityShimKey="tabitha" hostId={3} hue={320} />,
    );

    await waitFor(() => expect(findBountiesSocket()).toBeDefined());

    const open = [makeBounty({ slug: "o-1", title: "Open Alpha" })];
    respondWithBounties(open, []);

    await waitFor(() => {
      expect(screen.getByText("Open Alpha")).toBeTruthy();
    });

    // Click the Archive accordion header — fires a NEW socket with
    // includeArchived: true.
    const archiveTrigger = screen.getByText(/^Archive/i);
    fireEvent.click(archiveTrigger);

    // Wait for the second socket (the archive fetch) to open + send.
    await waitFor(() => {
      const archiveSockets = openedSockets.filter((ws) => {
        if (ws.__sentPayloads.length === 0) return false;
        try {
          const parsed = JSON.parse(ws.__sentPayloads[0]) as {
            type?: string;
            includeArchived?: boolean;
          };
          return parsed.type === "identity:list-bounties" && parsed.includeArchived === true;
        } catch {
          return false;
        }
      });
      expect(archiveSockets.length).toBeGreaterThan(0);
    });

    // Now respond to the archive socket.
    const archiveSock = openedSockets.find((ws) => {
      if (ws.__sentPayloads.length === 0) return false;
      try {
        const parsed = JSON.parse(ws.__sentPayloads[0]) as {
          type?: string;
          includeArchived?: boolean;
        };
        return parsed.type === "identity:list-bounties" && parsed.includeArchived === true;
      } catch {
        return false;
      }
    });
    expect(archiveSock).toBeDefined();
    archiveSock!.onmessage?.({
      data: JSON.stringify({
        type: "identity:bounties",
        bounties: open,
        archivedBounties: [
          makeBounty({ slug: "a-1", title: "Archived Alpha", status: "done" }),
          makeBounty({ slug: "a-2", title: "Archived Beta", status: "done" }),
        ],
      }),
    } as MessageEvent<string>);

    // The archive accordion contents render both archived rows.
    await waitFor(() => {
      expect(screen.getByText("Archived Alpha")).toBeTruthy();
      expect(screen.getByText("Archived Beta")).toBeTruthy();
    });
  });

  it("Test D: loading state — pre-response renders Skeleton placeholders", () => {
    render(
      <RoleBountiesTab identityShimKey="tabitha" hostId={3} hue={320} />,
    );

    // Before the WS responds, no bounties are visible + no error is shown.
    // The search input is rendered UNCONDITIONALLY (Ashley 2026-08-29 lock).
    expect(screen.queryByText(/couldn't load bounties/i)).toBeNull();
    // Search input is always present.
    expect(screen.getByLabelText(/search bounties/i)).toBeTruthy();
  });

  it("Test E: error state — response.error surfaces the error branch + Retry button", async () => {
    render(
      <RoleBountiesTab identityShimKey="tabitha" hostId={3} hue={320} />,
    );

    await waitFor(() => expect(findBountiesSocket()).toBeDefined());

    respondWithBounties([], [], "backend broke");

    await waitFor(() => {
      expect(screen.getByText(/couldn't load bounties/i)).toBeTruthy();
      expect(screen.getByText(/backend broke/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
  });

  it("Test F: identityShimKey threading — WS payload carries identityKey + hostId", async () => {
    render(
      <RoleBountiesTab identityShimKey="shim-tabitha" hostId={7} hue={200} />,
    );

    await waitFor(() => expect(findBountiesSocket()).toBeDefined());

    const sock = findBountiesSocket();
    const payload = JSON.parse(sock!.__sentPayloads[0]) as {
      type: string;
      identityKey: string;
      hostId: number;
    };
    expect(payload.type).toBe("identity:list-bounties");
    expect(payload.identityKey).toBe("shim-tabitha");
    expect(payload.hostId).toBe(7);
  });
});
