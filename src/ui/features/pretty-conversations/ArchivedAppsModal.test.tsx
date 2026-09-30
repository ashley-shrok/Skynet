/**
 * Phase 143 Plan 143-06 Task 1 — ArchivedAppsModal behavioral tests.
 *
 * 7 tests covering D-09 / D-16 / D-17 / D-18 / D-19 and the CONTEXT.md
 * Risk Summary invariant ("the row must not be removed until the endpoint
 * returns 200"):
 *
 *   Test 1  renders "Loading…" while fetch pending
 *   Test 2  renders empty state on zero results (D-18)
 *   Test 3  renders row list on results (D-09)
 *   Test 4  row disappears ONLY after endpoint returns 200 (locks Risk Summary invariant)
 *   Test 5  row stays on Un-archive failure (D-17)
 *   Test 6  name_collision reason surfaces distinct copy (D-17)
 *   Test 7  modal stays open after un-archive (D-19)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";

// ─── Module-level mocks (BEFORE component import) ────────────────────────────

const listArchivedAppsMock = vi.fn();
const unarchiveAppMock = vi.fn();

vi.mock("@/api/apps-archive-list-api", () => ({
  listArchivedApps: (...args: unknown[]) => listArchivedAppsMock(...args),
}));

vi.mock("@/api/apps-unarchive-api", () => ({
  unarchiveApp: (...args: unknown[]) => unarchiveAppMock(...args),
  // Re-export UnarchiveError so the component can import it from this module path.
  UnarchiveError: class UnarchiveError extends Error {
    constructor(
      message: string,
      public readonly reason: string,
      public readonly missingRoles?: string[],
    ) {
      super(message);
      this.name = "UnarchiveError";
    }
  },
}));

// Component AFTER the mocks
import { ArchivedAppsModal } from "./ArchivedAppsModal";
// Import the mocked UnarchiveError so tests can instantiate it.
import { UnarchiveError } from "@/api/apps-unarchive-api";

// ─── jsdom stubs ─────────────────────────────────────────────────────────────

// jsdom does not implement ResizeObserver; stub it so Radix's content doesn't
// throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{ hostId: number; slug: string; title?: string; iconUrl?: string }> = {}) {
  return {
    hostId: 1,
    slug: "notes-app",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Phase 143 Plan 143-06 Task 1 — ArchivedAppsModal", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    // Clean up portals from previous tests.
    document.body.innerHTML = "";
  });

  afterEach(() => {
    alertSpy.mockRestore();
    vi.clearAllMocks();
    cleanup();
  });

  // ─── Test 1: Loading state ────────────────────────────────────────────────

  it("Test 1: renders 'Loading…' while fetch is pending", () => {
    // Never-resolving promise keeps modal in loading state.
    listArchivedAppsMock.mockReturnValue(new Promise(() => {}));

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  // ─── Test 2: Empty state (D-18) ───────────────────────────────────────────

  it("Test 2 (D-18 empty state): renders 'No archived apps.' when list is empty", async () => {
    listArchivedAppsMock.mockResolvedValue([]);

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    const emptyState = await screen.findByText("No archived apps.");
    expect(emptyState).toBeTruthy();
  });

  // ─── Test 3: Row list (D-09) ──────────────────────────────────────────────

  it("Test 3 (D-09 rows): renders slug labels and kebab triggers for each entry", async () => {
    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app" }),
      makeEntry({ hostId: 2, slug: "timer" }),
    ]);

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await screen.findByText("notes-app");
    await screen.findByText("timer");

    // Both kebab triggers present via data-testid.
    expect(screen.getByTestId("archived-apps-row-kebab-1-notes-app")).toBeTruthy();
    expect(screen.getByTestId("archived-apps-row-kebab-2-timer")).toBeTruthy();
  });

  // ─── Test 4: Row disappears ONLY after endpoint returns 200 ───────────────
  //
  // This test locks the CONTEXT.md Risk Summary invariant:
  // "the row must not be removed until the endpoint returns 200".
  //
  // Mid-flight assertion: row still present + alert not yet fired.
  // Post-resolve assertion: row gone + alert fired with success copy.

  it("Test 4 (Risk Summary invariant): row disappears ONLY after endpoint returns 200, stays mid-flight", async () => {
    const user = userEvent.setup();

    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app" }),
    ]);

    // Manually-controlled promise — we decide when unarchiveApp resolves.
    let resolveUnarchive!: () => void;
    unarchiveAppMock.mockImplementation(
      () =>
        new Promise<{ ok: true }>((res) => {
          resolveUnarchive = () => res({ ok: true });
        }),
    );

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // Wait for rows to render.
    await screen.findByText("notes-app");

    // Open the kebab menu on the notes-app row.
    const kebabTrigger = screen.getByTestId("archived-apps-row-kebab-1-notes-app");
    await user.click(kebabTrigger);

    // Find and click the "Un-archive" item (rendered in a Radix portal).
    const unarchiveItem = await screen.findByText("Un-archive");
    await user.click(unarchiveItem);

    // MID-FLIGHT: endpoint has not resolved yet.
    // Row MUST still be present.
    expect(screen.queryByText("notes-app")).not.toBeNull();
    // Alert MUST NOT have been called yet.
    expect(alertSpy).not.toHaveBeenCalled();

    // Now resolve the endpoint.
    await act(async () => {
      resolveUnarchive();
      // Flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
    });

    // POST-RESOLVE: row MUST be gone.
    await waitFor(() => {
      expect(screen.queryByText("notes-app")).toBeNull();
    });

    // Alert MUST have been called with the success copy.
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Un-archiving notes-app"),
    );
    expect(alertSpy.mock.calls[0]?.[0]).toContain(
      "it may take a moment to reflect elsewhere in the app",
    );
  });

  // ─── Test 5: Row stays on failure (D-17) ─────────────────────────────────

  it("Test 5 (D-17 failure): row stays present and generic alert fires on unarchiveApp rejection", async () => {
    const user = userEvent.setup();

    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app" }),
    ]);

    // Reject with a generic Error (non-UnarchiveError).
    unarchiveAppMock.mockRejectedValue(new Error("network error"));

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await screen.findByText("notes-app");

    const kebabTrigger = screen.getByTestId("archived-apps-row-kebab-1-notes-app");
    await user.click(kebabTrigger);

    const unarchiveItem = await screen.findByText("Un-archive");
    await user.click(unarchiveItem);

    // Wait for the promise to settle.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    // Row MUST still be present (never removed on failure).
    expect(screen.queryByText("notes-app")).not.toBeNull();

    // Alert copy must match D-17 generic fallback.
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't un-archive notes-app — try again in a moment."),
    );
  });

  // ─── Test 6: name_collision distinct copy (D-17) ─────────────────────────

  it("Test 6 (D-17 name_collision): distinct alert copy mentions collision/name when UnarchiveError reason is name_collision", async () => {
    const user = userEvent.setup();

    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app" }),
    ]);

    // Reject with an UnarchiveError whose reason is "name_collision".
    unarchiveAppMock.mockRejectedValue(
      new UnarchiveError(
        "Un-archive blocked: a live app with the same slug already exists on this host.",
        "name_collision",
        undefined,
      ),
    );

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await screen.findByText("notes-app");

    const kebabTrigger = screen.getByTestId("archived-apps-row-kebab-1-notes-app");
    await user.click(kebabTrigger);

    const unarchiveItem = await screen.findByText("Un-archive");
    await user.click(unarchiveItem);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    // Alert copy must mention "same slug" or "collision" or "live" — distinct
    // from the generic fallback copy.
    const alertArg = alertSpy.mock.calls[0]?.[0] as string;
    // The distinct wording per the plan: "a live app with the same slug already exists"
    expect(alertArg).toContain("notes-app");
    // Must NOT be the generic fallback copy (which says "try again in a moment").
    expect(alertArg).not.toContain("try again in a moment");
    // Must mention the collision nature.
    expect(
      alertArg.includes("same slug") || alertArg.includes("already exists") || alertArg.includes("collision"),
    ).toBe(true);
  });

  // ─── Test 7: Modal stays open after un-archive (D-19) ────────────────────

  it("Test 7 (D-19): onOpenChange(false) is NEVER called after a successful un-archive", async () => {
    const user = userEvent.setup();
    const onOpenChangeSpy = vi.fn();

    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app" }),
    ]);

    unarchiveAppMock.mockResolvedValue({ ok: true });

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={onOpenChangeSpy}
      />,
    );

    await screen.findByText("notes-app");

    const kebabTrigger = screen.getByTestId("archived-apps-row-kebab-1-notes-app");
    await user.click(kebabTrigger);

    const unarchiveItem = await screen.findByText("Un-archive");
    await user.click(unarchiveItem);

    // Wait for success alert to be called (confirms the full success path ran).
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    // D-19: onOpenChange must NEVER have been called with false.
    const closeCalls = onOpenChangeSpy.mock.calls.filter(
      (args: unknown[]) => args[0] === false,
    );
    expect(closeCalls.length).toBe(0);
  });
});
