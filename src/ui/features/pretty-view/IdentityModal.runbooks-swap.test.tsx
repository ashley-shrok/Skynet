/**
 * Phase 89 Plan 06 — Runbooks tab swap-not-stack (D-06) in-process test suite.
 *
 * Tests walk the full flow through the identity modal → Runbooks tab → runbook
 * editor swap coordination. Locks the D-06 invariant that closing the runbook
 * editor does NOT restore the identity modal.
 *
 *   S1: happy path — open identity modal → switch to Runbooks tab → click a
 *       runbook row → identity modal closed + runbook editor rendered with
 *       the picked runbook name in the title.
 *
 *   S2: swap-close-does-not-reopen — after S1, click close on the runbook
 *       editor → runbook editor unmounts + identity modal STILL closed (no
 *       reopen — D-06 v1).
 *
 *   S3: null-role fast path — identity with role=null → Runbooks tab renders
 *       the empty state "This role has no runbooks yet." → no fetch was
 *       issued (listRunbooks mock NOT called).
 *
 *   S4: empty-list state — identity with role='some-role' → listRunbooks
 *       mock returns [] → tab body shows "This role has no runbooks yet."
 *
 *   S5: multiple runbooks alphabetical — listRunbooks returns 3 unsorted
 *       runbooks → tab body renders 3 rows in alphabetical order.
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
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
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

vi.mock("@/state/bounty-counts-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    invalidateIdentity: vi.fn().mockResolvedValue(undefined),
  };
});

// Phase 89 Plan 06: runbooks-api mock — controls listRunbooks per test (S1–S5)
// and stubs all other API calls RunbookEditorModal may make on open.
vi.mock("@/api/runbooks-api", () => ({
  listRunbooks: vi.fn(),
  enumerateRunbookFiles: vi.fn().mockResolvedValue([]),
  readRunbookFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, isText: true }),
  writeRunbookFile: vi.fn(),
  createRunbookFile: vi.fn(),
  deleteRunbookFile: vi.fn(),
  deleteRunbook: vi.fn(),
  RunbookFileMtimeConflictError: class extends Error {},
  RunbookFileAlreadyExistsError: class extends Error {},
}));

// ── Late imports ─────────────────────────────────────────────────────────────
import { IdentityModal } from "./IdentityModal";
import RunbookEditorModal from "./RunbookEditorModal";
import { __resetModalScopeForTest } from "@/state/modal-scope-store";
import { listRunbooks } from "@/api/runbooks-api";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_IDENTITY: Identity = {
  identityKey: "tina",
  displayName: "Tina",
  title: "Actor identity",
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
};

function makeIdentity(overrides?: Partial<Identity>): Identity {
  return { ...BASE_IDENTITY, ...overrides };
}

// ── TestHarness — mirrors PrettyView's swap coordination shape ───────────────
// A small in-file harness that mimics PrettyView's state-management shape
// without pulling in the whole PrettyView component. This harness proves the
// SHAPE of the D-06 swap-not-stack coordination:
//   - state slot { roleName, runbookName } | null
//   - handleOpenRunbook closes identity modal + opens runbook editor at same tick
//   - runbook editor close returns to null, does NOT reopen identity modal

interface TestHarnessProps {
  identity: Identity;
  initialRunbooks?: Array<{ name: string }>;
}

function TestHarness({ identity, initialRunbooks }: TestHarnessProps): JSX.Element {
  const [isIdModalOpen, setIsIdModalOpen] = React.useState(true);
  const [runbookOpen, setRunbookOpen] = React.useState<{
    roleName: string;
    runbookName: string;
  } | null>(null);

  const handleOpenRunbook = React.useCallback(
    (runbookName: string) => {
      const roleName = identity.role;
      if (roleName === null) return;
      // D-06 swap-not-stack: close identity modal + open runbook editor at same tick.
      setIsIdModalOpen(false);
      setRunbookOpen({ roleName, runbookName });
    },
    [identity],
  );

  // Configure listRunbooks mock return value if specified.
  if (initialRunbooks !== undefined) {
    vi.mocked(listRunbooks).mockResolvedValue(initialRunbooks);
  }

  return (
    <>
      <IdentityModal
        open={isIdModalOpen}
        onOpenChange={setIsIdModalOpen}
        identity={identity}
        hue={220}
        hostId={7}
        onOpenRunbook={handleOpenRunbook}
        container={document.body}
      />
      {runbookOpen && (
        <RunbookEditorModal
          open={true}
          onOpenChange={(o) => {
            if (!o) setRunbookOpen(null);
          }}
          hostId={7}
          roleName={runbookOpen.roleName}
          runbookName={runbookOpen.runbookName}
        />
      )}
    </>
  );
}

// ── Nav click helper ─────────────────────────────────────────────────────────

function clickNav(labelSubstring: string): void {
  const btn = Array.from(
    document.querySelectorAll(".shrink-0.flex.items-stretch button"),
  ).find((b) => b.textContent?.includes(labelSubstring)) as
    | HTMLButtonElement
    | undefined;
  expect(btn).toBeDefined();
  fireEvent.click(btn!);
}

// ── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  openedSockets.length = 0;
  __resetModalScopeForTest();
});

afterEach(() => {
  cleanup();
  openedSockets.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// S1: happy path — open identity modal → Runbooks tab → click row → swap
// ─────────────────────────────────────────────────────────────────────────────
describe("Runbooks tab swap-not-stack (D-06) — S1: happy path", () => {
  it("S1: clicking a runbook row closes the identity modal and opens the runbook editor", async () => {
    render(
      <TestHarness
        identity={makeIdentity({ role: "box-maintainer" })}
        initialRunbooks={[{ name: "avatar-flow" }, { name: "skynet-admin" }]}
      />,
    );

    // Wait for identity modal to be open (dialog is rendered).
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 0));

    // Switch to the Role scope to access Runbooks tab (actor defaults to identity scope).
    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    ) as HTMLButtonElement | null;
    expect(roleBtn).toBeTruthy();
    fireEvent.click(roleBtn!);

    // Click the Runbooks nav tab.
    clickNav("Runbooks");

    // Wait for runbook rows to appear.
    await waitFor(() => {
      expect(screen.queryByText("avatar-flow")).toBeTruthy();
    });

    // Click the "avatar-flow" runbook row.
    act(() => {
      fireEvent.click(screen.getByText("avatar-flow"));
    });

    // D-06 swap-not-stack: RunbookEditorModal should now be visible with the runbook name.
    await waitFor(() => {
      expect(screen.queryByText(/Edit runbook: avatar-flow/i)).toBeTruthy();
    });

    // Identity modal dialog should be gone (identity modal closed at swap-time).
    // After swap, only the RunbookEditorModal's dialog remains.
    const dialogs = document.querySelectorAll('[role="dialog"]');
    // There may be 1 dialog (the runbook editor) but NOT 2 (identity + editor stacked).
    // Check that the identity modal's scope switch is no longer in the DOM.
    expect(document.querySelector('[data-testid="scope-switch-role"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2: swap-close-does-not-reopen — D-06 invariant: closing editor ≠ reopen identity
// ─────────────────────────────────────────────────────────────────────────────
describe("Runbooks tab swap-not-stack (D-06) — S2: close does not reopen identity modal", () => {
  it("S2: closing the runbook editor does NOT reopen the identity modal (D-06 v1)", async () => {
    render(
      <TestHarness
        identity={makeIdentity({ role: "box-maintainer" })}
        initialRunbooks={[{ name: "avatar-flow" }, { name: "skynet-admin" }]}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 0));

    // Switch to Role scope + Runbooks tab + click a runbook row (same as S1).
    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    ) as HTMLButtonElement | null;
    expect(roleBtn).toBeTruthy();
    fireEvent.click(roleBtn!);
    clickNav("Runbooks");

    await waitFor(() => {
      expect(screen.queryByText("avatar-flow")).toBeTruthy();
    });

    act(() => {
      fireEvent.click(screen.getByText("avatar-flow"));
    });

    // Wait for runbook editor to appear.
    await waitFor(() => {
      expect(screen.queryByText(/Edit runbook: avatar-flow/i)).toBeTruthy();
    });

    // Now close the runbook editor via the close button (aria-label="Close").
    const closeBtn = screen.getByRole("button", { name: /close/i });
    act(() => {
      fireEvent.click(closeBtn);
    });

    // D-06 swap-not-stack invariant: runbook editor is gone.
    await waitFor(() => {
      expect(screen.queryByText(/Edit runbook:/i)).toBeNull();
    });

    // Identity modal did NOT reopen — scope switch is still absent.
    expect(document.querySelector('[data-testid="scope-switch-role"]')).toBeNull();
    // No dialog at all (both modals are closed).
    const remainingDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(
      (d) => (d as HTMLElement).style.display !== "none",
    );
    expect(remainingDialogs).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3: null-role fast path — identity.role === null → empty state, no fetch
// ─────────────────────────────────────────────────────────────────────────────
describe("Runbooks tab swap-not-stack (D-06) — S3: null-role fast path", () => {
  it("S3: identity with role=null shows empty state without calling listRunbooks", async () => {
    render(
      <TestHarness identity={makeIdentity({ role: null })} />,
    );

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 0));

    // Actor identity with no role — stays in identity scope by default.
    // Switch to Role scope to reach the Runbooks tab.
    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    ) as HTMLButtonElement | null;
    expect(roleBtn).toBeTruthy();
    fireEvent.click(roleBtn!);

    clickNav("Runbooks");

    // D-10 fast-path: roleName===null → empty state rendered immediately (no fetch).
    await waitFor(() => {
      expect(screen.queryByText("This role has no runbooks yet.")).toBeTruthy();
    });

    // listRunbooks was NOT called — D-10 fast-path skips the fetch when role is null.
    expect(vi.mocked(listRunbooks).mock.calls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4: empty-list state — role present, listRunbooks returns [], shows empty state
// ─────────────────────────────────────────────────────────────────────────────
describe("Runbooks tab swap-not-stack (D-06) — S4: empty list state", () => {
  it("S4: identity with role='box-maintainer' and empty runbooks list shows empty state", async () => {
    render(
      <TestHarness
        identity={makeIdentity({ role: "box-maintainer" })}
        initialRunbooks={[]}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 0));

    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    ) as HTMLButtonElement | null;
    expect(roleBtn).toBeTruthy();
    fireEvent.click(roleBtn!);

    clickNav("Runbooks");

    // D-10: empty runbooks folder → "This role has no runbooks yet."
    await waitFor(() => {
      expect(screen.queryByText("This role has no runbooks yet.")).toBeTruthy();
    });

    // listRunbooks WAS called once — fetch happens (unlike S3 which fast-paths on null role).
    expect(vi.mocked(listRunbooks).mock.calls.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5: multiple runbooks — rows render in alphabetical order (D-09)
// ─────────────────────────────────────────────────────────────────────────────
describe("Runbooks tab swap-not-stack (D-06) — S5: alphabetical sort", () => {
  it("S5: listRunbooks returns 3 unsorted runbooks → tab renders rows in alphabetical order", async () => {
    render(
      <TestHarness
        identity={makeIdentity({ role: "box-maintainer" })}
        initialRunbooks={[{ name: "zebra" }, { name: "apple" }, { name: "mango" }]}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 0));

    const roleBtn = document.querySelector(
      '[data-testid="scope-switch-role"]',
    ) as HTMLButtonElement | null;
    expect(roleBtn).toBeTruthy();
    fireEvent.click(roleBtn!);

    clickNav("Runbooks");

    // Wait for all 3 rows to appear.
    await waitFor(() => {
      expect(screen.queryByText("apple")).toBeTruthy();
      expect(screen.queryByText("mango")).toBeTruthy();
      expect(screen.queryByText("zebra")).toBeTruthy();
    });

    // D-09: rows must be sorted alphabetically — grab all runbook row buttons by class.
    const runbookRows = Array.from(
      document.querySelectorAll(".text-left.px-3.py-2"),
    ).map((el) => el.textContent?.trim() ?? "");

    expect(runbookRows).toEqual(["apple", "mango", "zebra"]);
  });
});
