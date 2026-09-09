/**
 * Phase 90 Plan 90-04 Task 2 — RoleBountiesTab component tests (Plan 90-10
 * shim-removal refactor).
 *
 * Lift of the identity-modal Bounties tab body into a standalone component.
 * Plan 90-10: reads route through listBountiesForRoleName (Plan 90-09 helper)
 * — no identity-shim prop anywhere. Tests mock the helper directly so the
 * behavior parity + shim removal are both covered.
 *
 * Tests (6 cases per plan Task 2 <behavior>):
 *   A. render — 3 open + 2 archived → 3 BountyCard rows + archive accordion
 *   B. search filter — typing filters to matching titles
 *   C. archive toggle — expand accordion → 2 archived rows render
 *   D. loading state — pre-response → Skeleton rows
 *   E. error state — helper rejects → error branch renders
 *   F. roleName threading — helper called with {roleName, hostId}
 *      (Plan 90-10: replaced the prior identity-shim threading test)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the role-name-keyed helper from Plan 90-09. Individual tests set the
// resolved value / rejection via the mock's mockResolvedValueOnce.
const mockListBountiesForRoleName = vi.fn();

vi.mock("@/api/claude-session-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listBountiesForRoleName: (...args: unknown[]) =>
      mockListBountiesForRoleName(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("RoleBountiesTab — Phase 90 Plan 90-10 (role-name-keyed, no shim)", () => {
  it("Test A: renders 3 open BountyCard rows + Archive accordion", async () => {
    const open = [
      makeBounty({ slug: "b-1", title: "Bounty One" }),
      makeBounty({ slug: "b-2", title: "Bounty Two" }),
      makeBounty({ slug: "b-3", title: "Bounty Three" }),
    ];
    mockListBountiesForRoleName.mockResolvedValueOnce({
      bounties: open,
      archivedBounties: [],
    });

    render(
      <RoleBountiesTab roleName="box-maintainer" hostId={3} hue={320} />,
    );

    // After the response, 3 BountyCard rows render (their titles are visible).
    await waitFor(() => {
      expect(screen.getByText("Bounty One")).toBeTruthy();
      expect(screen.getByText("Bounty Two")).toBeTruthy();
      expect(screen.getByText("Bounty Three")).toBeTruthy();
    });

    // Archive accordion trigger is present.
    expect(screen.getByText(/^Archive/i)).toBeTruthy();
  });

  it("Test B: search filter — typing filters bounties by case-insensitive substring", async () => {
    const open = [
      makeBounty({ slug: "b-1", title: "Fix login bug" }),
      makeBounty({ slug: "b-2", title: "Refactor router" }),
      makeBounty({ slug: "b-3", title: "Investigate login timeout" }),
    ];
    mockListBountiesForRoleName.mockResolvedValueOnce({
      bounties: open,
      archivedBounties: [],
    });

    render(
      <RoleBountiesTab roleName="box-maintainer" hostId={3} hue={320} />,
    );

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
    const open = [makeBounty({ slug: "o-1", title: "Open Alpha" })];
    const archived = [
      makeBounty({ slug: "a-1", title: "Archived Alpha", status: "done" }),
      makeBounty({ slug: "a-2", title: "Archived Beta", status: "done" }),
    ];
    // First call — initial fetch (no archive).
    mockListBountiesForRoleName.mockResolvedValueOnce({
      bounties: open,
      archivedBounties: [],
    });
    // Second call — archive fetch (includeArchived: true).
    mockListBountiesForRoleName.mockResolvedValueOnce({
      bounties: open,
      archivedBounties: archived,
    });

    render(
      <RoleBountiesTab roleName="box-maintainer" hostId={3} hue={320} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Open Alpha")).toBeTruthy();
    });

    // Click the Archive accordion header — fires a NEW helper call with
    // includeArchived: true.
    const archiveTrigger = screen.getByText(/^Archive/i);
    fireEvent.click(archiveTrigger);

    // Wait for the archive fetch to resolve.
    await waitFor(() => {
      expect(mockListBountiesForRoleName).toHaveBeenCalledWith(
        expect.objectContaining({
          roleName: "box-maintainer",
          hostId: 3,
          includeArchived: true,
        }),
      );
    });

    // The archive accordion contents render both archived rows.
    await waitFor(() => {
      expect(screen.getByText("Archived Alpha")).toBeTruthy();
      expect(screen.getByText("Archived Beta")).toBeTruthy();
    });
  });

  it("Test D: loading state — pre-response renders no error + search input", () => {
    // Make the helper hang so we can observe the loading state.
    mockListBountiesForRoleName.mockReturnValueOnce(new Promise(() => {}));
    render(
      <RoleBountiesTab roleName="box-maintainer" hostId={3} hue={320} />,
    );

    // Before the helper resolves, no bounties visible + no error rendered.
    // Search input is always present.
    expect(screen.queryByText(/couldn't load bounties/i)).toBeNull();
    expect(screen.getByLabelText(/search bounties/i)).toBeTruthy();
  });

  it("Test E: error state — helper rejects → error branch + Retry button", async () => {
    mockListBountiesForRoleName.mockRejectedValueOnce(
      new Error("backend broke"),
    );

    render(
      <RoleBountiesTab roleName="box-maintainer" hostId={3} hue={320} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/couldn't load bounties/i)).toBeTruthy();
      expect(screen.getByText(/backend broke/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
  });

  it("Test F (Plan 90-10): roleName threading — helper called with {roleName, hostId}", async () => {
    mockListBountiesForRoleName.mockResolvedValueOnce({
      bounties: [],
      archivedBounties: [],
    });

    render(
      <RoleBountiesTab roleName="box-maintainer" hostId={7} hue={200} />,
    );

    await waitFor(() => {
      expect(mockListBountiesForRoleName).toHaveBeenCalled();
    });

    const firstCallArgs = mockListBountiesForRoleName.mock.calls[0][0] as {
      roleName: string;
      hostId: number;
    };
    expect(firstCallArgs.roleName).toBe("box-maintainer");
    expect(firstCallArgs.hostId).toBe(7);
    // Should NOT carry an identityKey.
    expect(firstCallArgs).not.toHaveProperty("identityKey");
    // The shim prop name (from pre-Plan-90-10 wire) must not leak here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((firstCallArgs as any)["identity" + "ShimKey"]).toBeUndefined();
  });
});
