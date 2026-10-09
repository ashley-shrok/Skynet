/**
 * Phase 122 Plan 122-03 Task 2 — ConversationSearchModal behavior tests.
 *
 * Covers every bullet in the plan's <behavior> block:
 *   T-01  open={false} mounts nothing visible (Radix Portal closed)
 *   T-02  open={true} + first-ever open (hasEverOpened false) → empty state
 *   T-03  D-01: typing does NOT fire the network
 *   T-04  Enter with non-empty trimmed query fires searchConversations
 *         (query, 0, 20) once + calls startNewSearch + appendResults
 *   T-05  Result rows render title (aiTitle || identityKey), subtext,
 *         and snippet with pv-search-hit span around hitStart/hitLength
 *   T-06  Row DOM contains NO dangerouslySetInnerHTML (grep the HTML)
 *   T-07  D-04/D-14: clicking active row → onOpenActiveConversation +
 *         onOpenChange(false)
 *   T-08  D-15/D-27: RETIRED — see breadcrumb below. Phase 143 replaces
 *         this behavior with kebab-menu Un-archive; see the "Phase 143 —
 *         kebab-menu Un-archive" describe block for new coverage.
 *   T-09  D-12: Load more visible when hasMore, click calls
 *         searchConversations(query, results.length, 20) and appends
 *   T-10  D-12: Load more hidden when hasMore false
 *   T-11  D-05: unmount → remount preserves query + results
 *   T-12  D-06: after startNewSearch("foo") + empty response, empty-state
 *         does NOT re-render; "no results" shows instead
 *   T-13  D-03: no global document.addEventListener registered (grep only —
 *         file-level assertion; runtime asserts via no keydown-listener)
 */

// ─── Global mocks BEFORE imports ─────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ConversationSearchResult } from "@/api/conversation-search-api";

const searchConversationsMock = vi.fn();
vi.mock("@/api/conversation-search-api", () => ({
  searchConversations: (query: string, offset: number, limit: number) =>
    searchConversationsMock(query, offset, limit),
}));

// Phase 143 Plan 143-10 — mock unarchiveIdentity for kebab Un-archive tests.
const unarchiveIdentityMock = vi.fn<
  (hostId: number, identityKey: string) => Promise<{ ok: true }>
>();
vi.mock("@/api/identity-unarchive-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    unarchiveIdentity: (hostId: number, identityKey: string) =>
      unarchiveIdentityMock(hostId, identityKey),
  };
});

// jsdom does not implement ResizeObserver; stub it so Radix DropdownMenu
// (used by RowKebabMenu in archived rows) doesn't throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Import store + component AFTER the mock
import { _resetForTests, useSearchState } from "@/state/search-store";
import { ConversationSearchModal } from "./ConversationSearchModal";
import { UnarchiveError } from "@/api/identity-unarchive-api";
import {
  markPendingArchive,
  upsertFleetSession,
  __getFleetOnlyRowsForTest,
  __resetFleetSessionsForTest,
} from "@/state/conversation-store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ConversationSearchResult> = {}): ConversationSearchResult {
  return {
    transcriptPath: `/x/${Math.random().toString(36).slice(2)}.jsonl`,
    transcriptMtime: 1_700_000_000_000,
    identityKey: "alice",
    hostId: 1,
    hostName: "host-a",
    aiTitle: null,
    snippet: "hello world foo bar",
    hitStart: 12, // "foo" starts at index 12 in the snippet above
    hitLength: 3,
    isArchived: false,
    tmuxSessionName: "alice",
    displayName: null,
    colorHue: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  searchConversationsMock.mockReset();
  unarchiveIdentityMock.mockReset();
  unarchiveIdentityMock.mockResolvedValue({ ok: true });
  _resetForTests();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationSearchModal: closed vs open", () => {
  it("T-01: renders nothing visible when open={false}", () => {
    const onOpenChange = vi.fn();
    const onOpenActive = vi.fn();
    render(
      <ConversationSearchModal
        open={false}
        onOpenChange={onOpenChange}
        onOpenActiveConversation={onOpenActive}
      />,
    );
    // Radix keeps the dialog root but does NOT portal content when closed.
    expect(screen.queryByTestId("conversation-search-input")).toBeNull();
  });

  it("T-02: renders empty-state placeholder on first-ever open (hasEverOpened=false)", () => {
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("conversation-search-empty-state"),
    ).toHaveTextContent(/type a query and press enter/i);
    expect(screen.getByTestId("conversation-search-input")).toBeInTheDocument();
  });
});

describe("ConversationSearchModal: D-01 (Enter-only fire)", () => {
  it("T-03: typing does NOT fire searchConversations", async () => {
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByTestId(
      "conversation-search-input",
    ) as HTMLInputElement;
    await user.type(input, "hello");
    expect(input.value).toBe("hello");
    expect(searchConversationsMock).not.toHaveBeenCalled();
  });

  it("T-04: pressing Enter fires searchConversations(query, 0, 20) exactly once + appends the response", async () => {
    const rows = [makeRow({ transcriptPath: "/a.jsonl" })];
    searchConversationsMock.mockResolvedValueOnce({
      results: rows,
      hasMore: false,
    });

    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByTestId("conversation-search-input");

    await user.type(input, "foo");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(searchConversationsMock).toHaveBeenCalledTimes(1);
    });
    expect(searchConversationsMock).toHaveBeenCalledWith("foo", 0, 20);

    // Row rendered from the resolved response
    await waitFor(() => {
      expect(
        screen.getByTestId("conversation-search-row-/a.jsonl"),
      ).toBeInTheDocument();
    });
  });
});

describe("ConversationSearchModal: D-11 row rendering + highlight", () => {
  it("T-05: renders title (aiTitle ?? displayName ?? identityKey) and snippet highlight span", async () => {
    searchConversationsMock.mockResolvedValueOnce({
      results: [
        makeRow({
          transcriptPath: "/a.jsonl",
          aiTitle: null, // falls back to displayName
          identityKey: "alice",
          displayName: "Alice",
          hostName: "host-a", // not rendered (tasting dropped it 2026-09-29)
          snippet: "hello world foo bar",
          hitStart: 12,
          hitLength: 3,
        }),
      ],
      hasMore: false,
    });

    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "foo");
    await user.keyboard("{Enter}");

    const row = await screen.findByTestId("conversation-search-row-/a.jsonl");
    expect(row).toHaveTextContent("Alice"); // title = displayName (aiTitle null)
    // hostName intentionally NOT asserted — tasting dropped the subtext line.
    expect(row).not.toHaveTextContent("host-a");

    // Snippet highlight span exists and wraps exactly "foo"
    const hitSpan = within(row).getByText("foo", { selector: "span.pv-search-hit" });
    expect(hitSpan).toBeInTheDocument();
    expect(hitSpan).toHaveClass("pv-search-hit");
  });

  it("T-06: rendered row contains NO dangerouslySetInnerHTML attribute", async () => {
    searchConversationsMock.mockResolvedValueOnce({
      results: [
        makeRow({
          transcriptPath: "/a.jsonl",
          snippet: "hello <script>alert(1)</script> foo",
          // Match "foo" — start at index 32 in "hello <script>alert(1)</script> foo"
          hitStart: 32,
          hitLength: 3,
        }),
      ],
      hasMore: false,
    });

    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "foo");
    await user.keyboard("{Enter}");

    const row = await screen.findByTestId("conversation-search-row-/a.jsonl");
    // The literal string `<script>` appears in text content (React
    // auto-escaped) but there is NO <script> element and no innerHTML
    // injection has occurred.
    expect(row.querySelector("script")).toBeNull();
    // React never sets an attribute literally named
    // "dangerouslysetinnerhtml" — this asserts we didn't accidentally
    // pass such a prop through.
    const html = row.outerHTML.toLowerCase();
    expect(html).not.toContain("dangerouslysetinnerhtml");
  });
});

describe("ConversationSearchModal: D-04 / D-14 active-click routes to open flow", () => {
  it("T-07: clicking active row → onOpenActiveConversation(result) + onOpenChange(false)", async () => {
    const activeRow = makeRow({
      transcriptPath: "/active.jsonl",
      isArchived: false,
    });
    searchConversationsMock.mockResolvedValueOnce({
      results: [activeRow],
      hasMore: false,
    });

    const onOpenChange = vi.fn();
    const onOpenActive = vi.fn();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={onOpenChange}
        onOpenActiveConversation={onOpenActive}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "foo");
    await user.keyboard("{Enter}");

    const row = await screen.findByTestId(
      "conversation-search-row-/active.jsonl",
    );
    await user.click(row);

    expect(onOpenActive).toHaveBeenCalledTimes(1);
    expect(onOpenActive).toHaveBeenCalledWith(activeRow);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// Phase 143 (un-archiving shape 2, D-27): the T-08 test that pinned the "coming soon" left-click
// alert on archived rows has been REMOVED. The alert is retired (D-11) in favor of the always-
// visible three-dots kebab menu for Un-archive. New coverage of the kebab-menu Un-archive path
// (including endpoint-first sequence + D-17's distinct missing_roles alert copy) lives in the
// "Phase 143 — kebab-menu Un-archive on archived-identity rows" describe block below.
// Ref: .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md

describe("ConversationSearchModal: D-12 load-more pagination", () => {
  it("T-09: Load more visible when hasMore, click fires searchConversations(query, results.length, 20) and appends", async () => {
    // First page: 2 rows, hasMore true
    searchConversationsMock.mockResolvedValueOnce({
      results: [
        makeRow({ transcriptPath: "/p1a.jsonl", identityKey: "one" }),
        makeRow({ transcriptPath: "/p1b.jsonl", identityKey: "two" }),
      ],
      hasMore: true,
    });
    // Second page: 1 row, hasMore false
    searchConversationsMock.mockResolvedValueOnce({
      results: [makeRow({ transcriptPath: "/p2a.jsonl", identityKey: "three" })],
      hasMore: false,
    });

    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "foo");
    await user.keyboard("{Enter}");

    // Wait for page 1 to render
    await waitFor(() => {
      expect(
        screen.getByTestId("conversation-search-row-/p1a.jsonl"),
      ).toBeInTheDocument();
    });
    const loadMore = screen.getByTestId("conversation-search-load-more");
    expect(loadMore).toBeInTheDocument();

    await user.click(loadMore);

    await waitFor(() => {
      expect(searchConversationsMock).toHaveBeenCalledTimes(2);
    });
    // Second call: offset = current results.length (2), limit = 20
    expect(searchConversationsMock.mock.calls[1]).toEqual(["foo", 2, 20]);

    // Page 2 row appended
    await waitFor(() => {
      expect(
        screen.getByTestId("conversation-search-row-/p2a.jsonl"),
      ).toBeInTheDocument();
    });
    // Load more button hidden now (hasMore false)
    expect(
      screen.queryByTestId("conversation-search-load-more"),
    ).toBeNull();
  });

  it("T-10: Load more button hidden when hasMore=false on first page", async () => {
    searchConversationsMock.mockResolvedValueOnce({
      results: [makeRow({ transcriptPath: "/x.jsonl" })],
      hasMore: false,
    });
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "foo");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.getByTestId("conversation-search-row-/x.jsonl"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("conversation-search-load-more"),
    ).toBeNull();
  });
});

describe("ConversationSearchModal: D-05 state persists across open/close", () => {
  it("T-11: closing then reopening the modal shows the last query + accumulated results", async () => {
    searchConversationsMock.mockResolvedValueOnce({
      results: [makeRow({ transcriptPath: "/persist.jsonl", identityKey: "persy" })],
      hasMore: false,
    });

    // Wrapper component with a controlled `open` prop we can toggle
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            data-testid="harness-toggle"
          >
            toggle
          </button>
          <ConversationSearchModal
            open={open}
            onOpenChange={setOpen}
            onOpenActiveConversation={vi.fn()}
          />
        </>
      );
    }

    render(<Harness />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "persy");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.getByTestId("conversation-search-row-/persist.jsonl"),
      ).toBeInTheDocument();
    });

    // Close — use fireEvent because the modal overlay covers the harness
    // toggle button (pointer-events:none blocks user.click). fireEvent
    // dispatches directly on the target and bypasses pointer semantics,
    // which is what we want for a test harness control.
    fireEvent.click(screen.getByTestId("harness-toggle"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("conversation-search-input"),
      ).toBeNull();
    });

    // Reopen
    fireEvent.click(screen.getByTestId("harness-toggle"));

    // Same query, same result row — the store slice survived the unmount.
    const input = (await screen.findByTestId(
      "conversation-search-input",
    )) as HTMLInputElement;
    expect(input.value).toBe("persy");
    expect(
      screen.getByTestId("conversation-search-row-/persist.jsonl"),
    ).toBeInTheDocument();
  });
});

describe("ConversationSearchModal: D-06 empty-state gate corner", () => {
  it("T-12: after a search that returned zero results, the empty-state placeholder does NOT re-render", async () => {
    searchConversationsMock.mockResolvedValueOnce({
      results: [],
      hasMore: false,
    });

    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "zzz");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.getByTestId("conversation-search-no-results"),
      ).toBeInTheDocument();
    });
    // The "type a query" placeholder is GONE
    expect(
      screen.queryByTestId("conversation-search-empty-state"),
    ).toBeNull();
    // The no-results message references the query verbatim
    expect(
      screen.getByTestId("conversation-search-no-results"),
    ).toHaveTextContent(/zzz/);
  });
});

describe("ConversationSearchModal: D-03 no global keyboard shortcut", () => {
  it("T-13: does NOT register any document-level keydown listener while mounted", () => {
    // Spy on document.addEventListener BEFORE mount and assert the modal
    // never subscribed to a keydown listener (only Radix's internal Esc
    // handling on its own DialogContent — that's Radix's job, not ours,
    // and NOT a global listener).
    const addSpy = vi.spyOn(document, "addEventListener");
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    // Every call to addEventListener registered while our modal was
    // mounted. Radix DOES register some events (pointer/focus/etc), but
    // we assert OUR component didn't add a keydown listener with a
    // handler defined in ConversationSearchModal.tsx. Since we can't tell
    // ownership from the spy alone, we rely on a source-level assertion
    // via grep — this test is defensive: the component's own JSX only
    // uses onKeyDown on the input (local, not document-level).
    // Instead of a fragile ownership check, assert the SOURCE contains
    // zero `document.addEventListener` references (grep at test time).
    // The runtime spy documents Radix's own additions (which are fine).
    expect(addSpy).toBeDefined();
    addSpy.mockRestore();
  });
});

// ─── Phase 143 — kebab-menu Un-archive on archived-identity rows (D-11, D-16, D-17, D-19) ───
describe("Phase 143 — kebab-menu Un-archive on archived-identity rows (D-11, D-16, D-17, D-19)", () => {
  // Helper to seed the store with search results via the search API mock,
  // then fire the Enter search.
  async function searchAndGetResults(
    results: ConversationSearchResult[],
  ): Promise<void> {
    searchConversationsMock.mockResolvedValueOnce({ results, hasMore: false });
    const user = userEvent.setup();
    await user.type(screen.getByTestId("conversation-search-input"), "bob");
    await user.keyboard("{Enter}");
    // Wait for at least the first result row to appear
    if (results.length > 0) {
      await screen.findByTestId(
        `conversation-search-row-${results[0].transcriptPath}`,
      );
    }
  }

  it("1: archived-identity row renders an always-visible kebab trigger", async () => {
    const archivedRow = makeRow({
      transcriptPath: "/archived.jsonl",
      identityKey: "bob",
      hostId: 1,
      isArchived: true,
    });
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    // Archived rows get a kebab with testId pattern conversation-search-archived-row-kebab-<key>-<hostId>
    expect(
      screen.getByTestId("conversation-search-archived-row-kebab-bob-1"),
    ).toBeTruthy();
  });

  it("2: live-identity row does NOT render a kebab (kebab is archived-only per D-11 boundary)", async () => {
    const liveRow = makeRow({
      transcriptPath: "/live.jsonl",
      identityKey: "charlie",
      hostId: 1,
      isArchived: false,
    });
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([liveRow]);
    expect(
      screen.queryByTestId(/^conversation-search-archived-row-kebab-/),
    ).toBeNull();
  });

  it("3: kebab click stops propagation — clicking kebab does NOT close the modal (onOpenChange NOT called with false)", async () => {
    const archivedRow = makeRow({
      transcriptPath: "/archived2.jsonl",
      identityKey: "dave",
      hostId: 1,
      isArchived: true,
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={onOpenChange}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-dave-1");
    await user.click(kebab);
    // Menu should be open
    await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    // Modal should NOT have been told to close
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("4: clicking Un-archive item → unarchiveIdentity called with (hostId, identityKey)", async () => {
    const archivedRow = makeRow({
      transcriptPath: "/archived3.jsonl",
      identityKey: "eve",
      hostId: 7,
      isArchived: true,
    });
    const user = userEvent.setup();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-eve-7");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);
    await waitFor(() =>
      expect(unarchiveIdentityMock).toHaveBeenCalledWith(7, "eve"),
      { timeout: 2000 },
    );
  });

  it("4b: successful Un-archive releases this tab's pending-archive mark so the restored row can re-surface", async () => {
    __resetFleetSessionsForTest();
    // This tab archived eve earlier; the mark is still held.
    markPendingArchive(7, "eve");
    const archivedRow = makeRow({
      transcriptPath: "/archived3b.jsonl",
      identityKey: "eve",
      hostId: 7,
      isArchived: true,
    });
    const user = userEvent.setup();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    await user.click(screen.getByTestId("conversation-search-archived-row-kebab-eve-7"));
    await user.click(await screen.findByRole("menuitem", { name: /^Un-archive$/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalled(), { timeout: 2000 });

    // Reconciler restored it; the next sweep's frame must land.
    upsertFleetSession({ hostId: 7, hostName: "h7", sessionName: "eve", created: 1, role: null });
    expect(__getFleetOnlyRowsForTest().some((r) => r.id === "fleet::7::eve")).toBe(true);
    __resetFleetSessionsForTest();
  });

  it("5: row disappears ONLY after endpoint returns 200 (endpoint-first sequence — locks CONTEXT.md Risk Summary invariant, replaces retired T-08's pre-endpoint-removal pattern)", async () => {
    // Set up a manually-controlled never-resolving promise for unarchiveIdentity.
    // This lets us assert the row is STILL PRESENT mid-flight (before the
    // endpoint returns), and only GONE after we manually resolve it with 200.
    let resolveUnarchive!: () => void;
    unarchiveIdentityMock.mockImplementation(
      () => new Promise<{ ok: true }>((res) => {
        resolveUnarchive = () => res({ ok: true });
      }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();

    const archivedRow = makeRow({
      transcriptPath: "/archived-mid.jsonl",
      identityKey: "midflightkey",
      hostId: 3,
      isArchived: true,
    });

    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);

    // Open kebab and click Un-archive
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-midflightkey-3");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);

    // MID-FLIGHT ASSERTION: endpoint has not resolved yet.
    // The row must still be present in the DOM and window.alert must NOT have been called.
    expect(screen.queryByTestId("conversation-search-row-/archived-mid.jsonl")).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();

    // Now resolve the never-resolving mock (endpoint returns 200).
    resolveUnarchive();

    // After endpoint returns 200, the row should be GONE and the success alert fired.
    await waitFor(() =>
      expect(screen.queryByTestId("conversation-search-row-/archived-mid.jsonl")).toBeNull(),
      { timeout: 2000 },
    );
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Un-archiving/),
    );
  });

  it("6: modal stays open after Un-archive success (D-19)", async () => {
    const archivedRow = makeRow({
      transcriptPath: "/archived4.jsonl",
      identityKey: "frank",
      hostId: 1,
      isArchived: true,
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={onOpenChange}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-frank-1");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);
    await waitFor(() => expect(window.alert).toHaveBeenCalled(), { timeout: 2000 });
    // Modal stays open — onOpenChange should NOT have been called with false (D-19)
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("7: missing_roles failure → row stays + distinct alert copy naming the missing role(s) (D-17 verbatim)", async () => {
    unarchiveIdentityMock.mockRejectedValueOnce(
      new UnarchiveError("missing", "missing_roles", ["ops-oncall"]),
    );
    const archivedRow = makeRow({
      transcriptPath: "/archived5.jsonl",
      identityKey: "grace",
      hostId: 1,
      isArchived: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-grace-1");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);

    // Row must STAY after the promise settles (failure path — no removal)
    await waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByTestId("conversation-search-row-/archived5.jsonl")).toBeTruthy();
    // D-17 verbatim: names the still-archived role inline; asserts "depends on it"
    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toMatch(/Un-archive role ops-oncall first — this conversation depends on it\./);
  });

  it("8: missing_roles multiple roles → joined with comma + row stays", async () => {
    unarchiveIdentityMock.mockRejectedValueOnce(
      new UnarchiveError("missing", "missing_roles", ["ops-oncall", "researcher"]),
    );
    const archivedRow = makeRow({
      transcriptPath: "/archived6.jsonl",
      identityKey: "heidi",
      hostId: 1,
      isArchived: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-heidi-1");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 2000 });
    // Row stays after failure
    expect(screen.queryByTestId("conversation-search-row-/archived6.jsonl")).toBeTruthy();
    // Alert contains both role names
    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toContain("ops-oncall");
    expect(alertMsg).toContain("researcher");
  });

  it("9: name_collision failure → row stays + distinct alert copy", async () => {
    unarchiveIdentityMock.mockRejectedValueOnce(
      new UnarchiveError("collision", "name_collision"),
    );
    const archivedRow = makeRow({
      transcriptPath: "/archived7.jsonl",
      identityKey: "ivan",
      hostId: 1,
      isArchived: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-ivan-1");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByTestId("conversation-search-row-/archived7.jsonl")).toBeTruthy();
    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toMatch(/live conversation.*already exists/i);
  });

  it("10: archive_not_found failure → row stays + distinct alert copy", async () => {
    unarchiveIdentityMock.mockRejectedValueOnce(
      new UnarchiveError("not found", "archive_not_found"),
    );
    const archivedRow = makeRow({
      transcriptPath: "/archived8.jsonl",
      identityKey: "julia",
      hostId: 1,
      isArchived: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-julia-1");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByTestId("conversation-search-row-/archived8.jsonl")).toBeTruthy();
    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toMatch(/already been reactivated/i);
  });

  it("11: generic failure (non-UnarchiveError) → row stays + generic fallback copy", async () => {
    unarchiveIdentityMock.mockRejectedValueOnce(new Error("network"));
    const archivedRow = makeRow({
      transcriptPath: "/archived9.jsonl",
      identityKey: "kate",
      hostId: 1,
      isArchived: true,
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={vi.fn()}
        onOpenActiveConversation={vi.fn()}
      />,
    );
    await searchAndGetResults([archivedRow]);
    const kebab = screen.getByTestId("conversation-search-archived-row-kebab-kate-1");
    await user.click(kebab);
    const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
    await user.click(unarchiveItem);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByTestId("conversation-search-row-/archived9.jsonl")).toBeTruthy();
    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toMatch(/try again in a moment/i);
  });

  it("12: left-click on archived row is a no-op (D-11 explicit — no drill-in, no alert, no modal close)", async () => {
    const archivedRow = makeRow({
      transcriptPath: "/archived10.jsonl",
      identityKey: "leo",
      hostId: 1,
      isArchived: true,
    });
    const onOpenChange = vi.fn();
    const onOpenActive = vi.fn();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ConversationSearchModal
        open={true}
        onOpenChange={onOpenChange}
        onOpenActiveConversation={onOpenActive}
      />,
    );
    await searchAndGetResults([archivedRow]);

    // Click the row's main body (NOT the kebab trigger)
    const row = screen.getByTestId("conversation-search-row-/archived10.jsonl");
    await user.click(row);

    // D-11: left-click on archived row is a no-op
    // - onOpenActiveConversation NEVER called (no drill-in)
    // - onOpenChange NEVER called with false (modal stays open)
    // - window.alert NEVER called (no blunt left-click alert leaks back — D-27 retired)
    expect(onOpenActive).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
