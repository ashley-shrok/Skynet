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
 *
 * apple-ux (shape-creation-and-search-dialogs, 2026-10-22): a line under the
 * title says what the window is; every row has a visible Un-archive button
 * (busy while it works, one at a time) instead of a ⋮ kebab; right-click on
 * a row still offers Un-archive; the empty state is "No archived apps —
 * Apps you archive land here, ready to bring back." The un-archive tests
 * below click the row's button (data-testid archived-apps-unarchive-<hostId>-<slug>).
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
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";

/** Kit notices shown so far, each as "<title> — <body>" (lower-cased body). */
function noticeTexts(d: ReturnType<typeof autoAnswerKitDialogs>): string[] {
  return d.calls
    .filter((c) => c.kind === "alert")
    .map((c) => `${String(c.opts.title)}${c.opts.body ? ` — ${String(c.opts.body)}` : ""}`);
}
// Import the mocked UnarchiveError so tests can instantiate it.
import { UnarchiveError } from "@/api/apps-unarchive-api";
import { renderHook } from "@testing-library/react";
import {
  markPendingAppArchive,
  publishAppUpdate,
  useAppTiles,
  __resetForTest as __resetAppTilesForTest,
} from "@/state/app-tiles-store";

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

const unarchiveBtn = (hostId: number, slug: string) =>
  screen.getByTestId(`archived-apps-unarchive-${hostId}-${slug}`) as HTMLButtonElement;

function makeEntry(overrides: Partial<{ hostId: number; slug: string; title?: string; iconUrl?: string }> = {}) {
  return {
    hostId: 1,
    slug: "notes-app",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Phase 143 Plan 143-06 Task 1 — ArchivedAppsModal", () => {
  let alertSpy: ReturnType<typeof autoAnswerKitDialogs>;

  beforeEach(() => {
    alertSpy = autoAnswerKitDialogs();
    // Clean up portals from previous tests.
    document.body.innerHTML = "";
  });

  afterEach(() => {
    __resetKitDialogsForTests();
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

  it("Test 2 (D-18 empty state): renders 'No archived apps' with its explainer when list is empty", async () => {
    listArchivedAppsMock.mockResolvedValue([]);

    render(
      <ArchivedAppsModal
        open={true}
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("No archived apps")).toBeTruthy();
    expect(screen.getByText("Apps you archive land here, ready to bring back.")).toBeTruthy();
  });

  it("Test 2b: the subtitle under the title says what the window is", async () => {
    listArchivedAppsMock.mockResolvedValue([]);
    render(<ArchivedAppsModal open={true} onOpenChange={() => {}} />);
    expect(screen.getByText("Archived apps")).toBeTruthy();
    expect(
      screen.getByText("Apps you've archived. Un-archive one to put it back in the sidebar."),
    ).toBeTruthy();
  });

  // ─── Test 3: Row list (D-09) ──────────────────────────────────────────────

  it("Test 3 (D-09 rows): every row shows its name and its own visible Un-archive button — no ⋮ kebab", async () => {
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

    // Shape §What would make it wrong: "Un-archive reachable only through a
    // hidden menu." Each row's button is there without opening anything.
    for (const [hostId, slug] of [[1, "notes-app"], [2, "timer"]] as const) {
      const btn = unarchiveBtn(hostId, slug);
      expect(btn.textContent).toBe("Un-archive");
      expect(btn.disabled).toBe(false);
    }
    expect(screen.getAllByRole("button", { name: "Un-archive" })).toHaveLength(2);
    // No ⋮ on rows.
    expect(document.querySelector('[data-testid*="kebab"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /more|options|actions/i })).toBeNull();
    expect(screen.queryByText("⋮")).toBeNull();
  });

  it("Test 3b: a row shows the app's title (else its slug) and its picture (else its initial)", async () => {
    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app", title: "Notes", iconUrl: "/apps/1/notes-app/icon" }),
      makeEntry({ hostId: 2, slug: "timer" }),
    ]);
    render(<ArchivedAppsModal open={true} onOpenChange={() => {}} />);
    await screen.findByText("Notes");
    expect(screen.queryByText("notes-app")).toBeNull();
    const imgs = Array.from(document.querySelectorAll("img"));
    expect(imgs.map((i) => i.getAttribute("src"))).toContain("/apps/1/notes-app/icon");
    expect(screen.getByText("T")).toBeTruthy();
  });

  it("Test 3c: the button is busy while its un-archive is in flight, and the other rows' buttons wait (one at a time)", async () => {
    listArchivedAppsMock.mockResolvedValue([
      makeEntry({ hostId: 1, slug: "notes-app" }),
      makeEntry({ hostId: 2, slug: "timer" }),
    ]);
    let resolveUnarchive!: () => void;
    unarchiveAppMock.mockImplementation(
      () => new Promise<{ ok: true }>((res) => { resolveUnarchive = () => res({ ok: true }); }),
    );
    render(<ArchivedAppsModal open={true} onOpenChange={() => {}} />);
    await screen.findByText("notes-app");

    fireEvent.click(unarchiveBtn(1, "notes-app"));
    await waitFor(() => expect(unarchiveBtn(1, "notes-app").getAttribute("aria-busy")).toBe("true"));
    expect(unarchiveBtn(1, "notes-app").disabled).toBe(true);
    // The other row's button is not busy, but can't start a second one.
    expect(unarchiveBtn(2, "timer").getAttribute("aria-busy")).not.toBe("true");
    expect(unarchiveBtn(2, "timer").disabled).toBe(true);
    fireEvent.click(unarchiveBtn(2, "timer"));
    // Right-click on the other row can't start one either.
    fireEvent.contextMenu(screen.getByText("timer"), { clientX: 10, clientY: 10 });
    const item = screen.queryByRole("menuitem", { name: "Un-archive" });
    if (item) fireEvent.click(item);
    expect(unarchiveAppMock).toHaveBeenCalledTimes(1);
    expect(unarchiveAppMock).toHaveBeenCalledWith(1, "notes-app");

    await act(async () => {
      resolveUnarchive();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText("notes-app")).toBeNull());
    // Free again.
    await waitFor(() => expect(unarchiveBtn(2, "timer").disabled).toBe(false));
  });

  it("Test 3d: right-clicking a row still offers Un-archive, and it works like the button", async () => {
    const user = userEvent.setup();
    listArchivedAppsMock.mockResolvedValue([makeEntry({ hostId: 1, slug: "notes-app" })]);
    unarchiveAppMock.mockResolvedValue({ ok: true });
    render(<ArchivedAppsModal open={true} onOpenChange={() => {}} />);
    const label = await screen.findByText("notes-app");
    fireEvent.contextMenu(label, { clientX: 120, clientY: 80 });
    await user.click(await screen.findByRole("menuitem", { name: "Un-archive" }));
    await waitFor(() => expect(unarchiveAppMock).toHaveBeenCalledWith(1, "notes-app"));
    await waitFor(() => expect(screen.queryByText("notes-app")).toBeNull());
    expect(noticeTexts(alertSpy)[0]).toContain("Un-archiving notes-app");
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

    // Click the row's own Un-archive button.
    await user.click(unarchiveBtn(1, "notes-app"));

    // MID-FLIGHT: endpoint has not resolved yet.
    // Row MUST still be present.
    expect(screen.queryByText("notes-app")).not.toBeNull();
    // Alert MUST NOT have been called yet.
    expect(noticeTexts(alertSpy)).toHaveLength(0);

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
    expect(noticeTexts(alertSpy)[0]).toContain("Un-archiving notes-app");
    expect(noticeTexts(alertSpy)[0]?.toLowerCase()).toContain(
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

    await user.click(unarchiveBtn(1, "notes-app"));

    // Wait for the promise to settle.
    await waitFor(() => {
      expect(noticeTexts(alertSpy).length).toBeGreaterThan(0);
    });

    // Row MUST still be present (never removed on failure).
    expect(screen.queryByText("notes-app")).not.toBeNull();
    // And its button is usable again for a retry.
    await waitFor(() => expect(unarchiveBtn(1, "notes-app").disabled).toBe(false));
    expect(unarchiveBtn(1, "notes-app").getAttribute("aria-busy")).not.toBe("true");

    // Alert copy must match D-17 generic fallback.
    expect(noticeTexts(alertSpy)[0]?.toLowerCase()).toContain(
      "couldn't un-archive notes-app — try again in a moment.",
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

    await user.click(unarchiveBtn(1, "notes-app"));

    await waitFor(() => {
      expect(noticeTexts(alertSpy).length).toBeGreaterThan(0);
    });

    // Alert copy must mention "same slug" or "collision" or "live" — distinct
    // from the generic fallback copy.
    const alertArg = (noticeTexts(alertSpy)[0] ?? "").toLowerCase();
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

  it("Test 4b: successful un-archive releases this tab's pending-archive mark so the restored tile can re-surface", async () => {
    __resetAppTilesForTest();
    markPendingAppArchive("1", "notes-app");
    const user = userEvent.setup();
    listArchivedAppsMock.mockResolvedValue([makeEntry({ hostId: 1, slug: "notes-app" })]);
    unarchiveAppMock.mockResolvedValue({ ok: true });

    render(<ArchivedAppsModal open={true} onOpenChange={vi.fn()} />);
    await screen.findByText("notes-app");
    await user.click(unarchiveBtn(1, "notes-app"));
    await waitFor(() => expect(noticeTexts(alertSpy).length).toBeGreaterThan(0));

    // Reconciler restored it; the next sweep's app-update must land.
    publishAppUpdate({
      hostId: "1",
      slug: "notes-app",
      title: "Notes",
      description: "",
      port: null,
      hasIcon: false,
      createdAtMs: 1,
      isHealthy: true,
      healthMessage: null,
    });
    const { result } = renderHook(() => useAppTiles());
    expect(result.current.map((a) => a.slug)).toContain("notes-app");
    __resetAppTilesForTest();
  });

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

    await user.click(unarchiveBtn(1, "notes-app"));

    // Wait for success alert to be called (confirms the full success path ran).
    await waitFor(() => {
      expect(noticeTexts(alertSpy).length).toBeGreaterThan(0);
    });

    // D-19: onOpenChange must NEVER have been called with false.
    const closeCalls = onOpenChangeSpy.mock.calls.filter(
      (args: unknown[]) => args[0] === false,
    );
    expect(closeCalls.length).toBe(0);
  });
});
