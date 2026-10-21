/**
 * Phase 135 Plan 135-02 Task 4 — ScheduledAgentsModal behavioral tests.
 *
 * 15 tests covering the wave-1 read path + all wave-2 write paths:
 *   T-01  open={false} mounts nothing visible
 *   T-02  open={true} triggers listScheduledAgents + skeleton → rows
 *   T-03  Empty response → empty-state helper text
 *   T-04  Filter search narrows over name+prompt (case-insensitive)
 *   T-05  Filter role narrows to matching role
 *   T-06  Filter host narrows to matching host
 *   T-07  Row click → form view, edit mode, prefilled, Name disabled
 *   T-08  '+' button → form view, create mode, fields empty
 *   T-09  Pessimistic toggle — success + failure with banner
 *   T-10  Kebab → Edit → same as row click
 *   T-11  Kebab → Delete → window.confirm + DELETE + refetch
 *   T-12  Save success → refetch + return to list view
 *   T-13  Save 409 → inline banner with server message, form stays open
 *   T-14  Cancel → back to list view (with refetch — Recommendation #7)
 *   T-15  Modal close → filter state resets on next open
 *   T-18  Kebab → Run now → POST run-now + success toast; failure → banner;
 *         one_shot rows have no Run now item
 *   T-PR  Project: picker order + save, host switch clears, missing project
 *         kept on an unrelated edit, row path / missing chip
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { HostFolder } from "@/types/ui-types";
import type { ScheduledAgentListItem } from "@/api/scheduled-agents-api";

// ─── Module-level mocks (BEFORE component import) ────────────────────────────

const listScheduledAgentsMock = vi.fn();
const createScheduledAgentMock = vi.fn();
const updateScheduledAgentMock = vi.fn();
const toggleScheduledAgentEnabledMock = vi.fn();
const deleteScheduledAgentMock = vi.fn();
const runScheduledAgentNowMock = vi.fn();
const toastSuccessMock = vi.fn();
const listRolesForHostMock = vi.fn();
const listScheduledAgentProjectsMock = vi.fn();

vi.mock("@/api/scheduled-agents-api", () => ({
  listScheduledAgents: (...args: unknown[]) => listScheduledAgentsMock(...args),
  createScheduledAgent: (...args: unknown[]) => createScheduledAgentMock(...args),
  updateScheduledAgent: (...args: unknown[]) => updateScheduledAgentMock(...args),
  toggleScheduledAgentEnabled: (...args: unknown[]) => toggleScheduledAgentEnabledMock(...args),
  deleteScheduledAgent: (...args: unknown[]) => deleteScheduledAgentMock(...args),
  runScheduledAgentNow: (...args: unknown[]) => runScheduledAgentNowMock(...args),
  listScheduledAgentProjects: (...args: unknown[]) => listScheduledAgentProjectsMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccessMock(...args) },
}));

vi.mock("@/api/identities-api", () => ({
  listRolesForHost: (...args: unknown[]) => listRolesForHostMock(...args),
}));

// Component AFTER the mocks
import { ScheduledAgentsModal } from "./ScheduledAgentsModal";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ScheduledAgentListItem> = {}): ScheduledAgentListItem {
  return {
    slug: "morning-triage",
    host: "host-a",
    hostId: 1,
    name: "Morning triage",
    enabled: true,
    schedule: { type: "daily", at: "09:00" },
    scheduleHuman: "Daily at 9:00",
    prompt: "check inbox",
    roles: ["assistant"],
    archive_if_nothing_to_report: false,
    project: null,
    projectPath: null,
    projectMissing: false,
        colorHue: null,
    lastFiredAt: null,
    nextFireAt: null,
    ...overrides,
  };
}

const ONE_HOST_TREE: HostFolder = {
  name: "root",
  children: [
    {
      id: "1",
      name: "host-a",
      username: "user",
      ip: "10.0.0.1",
      port: 22,
      folder: "",
      online: true,
      cpu: null,
      ram: null,
      lastAccess: "",
      authType: "password",
      enableTerminal: true,
      enableTunnel: false,
      serverTunnels: [],
      enableFileManager: false,
      enableDocker: false,
      quickActions: [],
      enableSsh: true,
      enableRdp: false,
      // Can host agents — the form only offers such machines.
      runsFleetSubstrate: true,
      enableVnc: false,
      enableTelnet: false,
      sshPort: 22,
      rdpPort: 3389,
      vncPort: 5900,
      telnetPort: 23,
    } as never,
  ],
};

/** Minimal ApiError-shape carrier — mirrors src/ui/main-axios.ts:1020. */
class FakeApiError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status: number, code = "TEST_ERR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  listScheduledAgentsMock.mockReset();
  createScheduledAgentMock.mockReset();
  updateScheduledAgentMock.mockReset();
  toggleScheduledAgentEnabledMock.mockReset();
  deleteScheduledAgentMock.mockReset();
  runScheduledAgentNowMock.mockReset();
  toastSuccessMock.mockReset();
  listRolesForHostMock.mockReset();
  // Default: no roles. Tests that exercise the form opt in by overriding
  // with mockResolvedValueOnce / mockResolvedValue.
  listRolesForHostMock.mockResolvedValue([]);
  listScheduledAgentProjectsMock.mockReset();
  listScheduledAgentProjectsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: closed vs open + read path", () => {
  it("T-01: renders nothing visible when open={false}", () => {
    render(
      <ScheduledAgentsModal
        open={false}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    expect(screen.queryByTestId("scheduled-agents-modal-close-button")).toBeNull();
  });

  it("T-02: open={true} triggers listScheduledAgents once + skeleton → rows", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await waitFor(() =>
      expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByText("Morning triage")).toBeInTheDocument(),
    );
  });

  it("T-03: empty response → empty-state helper text", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    const empty = await screen.findByTestId("scheduled-agents-modal-empty-state");
    expect(empty.textContent).toMatch(/No scheduled tasks/i);
  });
});

describe("ScheduledAgentsModal: filter bar", () => {
  it("T-04: search input narrows over name+prompt (case-insensitive)", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow(),
      makeRow({
        slug: "log-sweep",
        name: "Log sweep",
        prompt: "sweep logs",
      }),
    ]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByText("Morning triage");
    const search = screen.getByTestId(
      "scheduled-agents-modal-filter-search",
    ) as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(search, "log");
    expect(screen.getByText("Log sweep")).toBeInTheDocument();
    expect(screen.queryByText("Morning triage")).toBeNull();
  });

  it("T-05: role filter narrows to matching role", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "a", name: "Alpha", roles: ["writer"] }),
      makeRow({ slug: "b", name: "Beta", roles: ["reader"] }),
    ]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByText("Alpha");
    const roleSel = screen.getByTestId(
      "scheduled-agents-modal-filter-role",
    ) as HTMLSelectElement;
    fireEvent.change(roleSel, { target: { value: "writer" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("T-04b: slug-shape names render prettified in the row + match on either form in search", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "daily-box-check", name: "daily-box-check" }),
    ]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    // Prettified render: hyphens → spaces, first char capitalized.
    await screen.findByText("Daily box check");
    expect(screen.queryByText("daily-box-check")).toBeNull();
    // Search still matches the raw-slug form (typed hyphens).
    const search = screen.getByTestId(
      "scheduled-agents-modal-filter-search",
    ) as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(search, "daily-box");
    expect(screen.getByText("Daily box check")).toBeInTheDocument();
    // And matches the prettified form (typed spaces).
    await user.clear(search);
    await user.type(search, "box check");
    expect(screen.getByText("Daily box check")).toBeInTheDocument();
  });

  it("T-06: host filter narrows to matching host", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "a", name: "Alpha", host: "host-a", hostId: 1 }),
      makeRow({ slug: "b", name: "Beta", host: "host-b", hostId: 2 }),
    ]);

    const TWO_HOST_TREE: HostFolder = {
      name: "root",
      children: [
        (ONE_HOST_TREE.children[0] as never),
        {
          ...(ONE_HOST_TREE.children[0] as never),
          id: "2",
          name: "host-b",
        } as never,
      ],
    };

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={TWO_HOST_TREE}
      />,
    );
    await screen.findByText("Alpha");
    const hostSel = screen.getByTestId(
      "scheduled-agents-modal-filter-host",
    ) as HTMLSelectElement;
    fireEvent.change(hostSel, { target: { value: "1" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).toBeNull();
  });
});

describe("ScheduledAgentsModal: form-view entry points", () => {
  it("T-07: row click → form view, edit mode, fields prefilled, Name disabled", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    const row = await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    fireEvent.click(row);
    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Morning triage");
    expect(nameInput).toBeDisabled();
    // Host lock-chip present
    expect(screen.getByTestId("scheduled-agents-modal-form-host-locked")).toBeInTheDocument();
  });

  it("T-07b: same slug on two hosts — clicking the second row edits THAT host's task", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ host: "host-a", hostId: 1, prompt: "host A prompt" }),
      makeRow({ host: "host-b", hostId: 2, prompt: "host B prompt" }),
    ]);
    const TWO_HOST_TREE: HostFolder = {
      name: "root",
      children: [
        (ONE_HOST_TREE.children[0] as never),
        { ...(ONE_HOST_TREE.children[0] as unknown as Record<string, unknown>), id: "2", name: "host-b" } as never,
      ],
    };
    render(
      <ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={TWO_HOST_TREE} />,
    );
    await screen.findAllByTestId("scheduled-agents-modal-row-morning-triage");
    const rows = screen.getAllByTestId("scheduled-agents-modal-row-morning-triage");
    expect(rows).toHaveLength(2);
    const hostBRow = rows.find((r) => r.textContent?.includes("host-b")) ?? rows[1];
    fireEvent.click(hostBRow);
    const prompt = (await screen.findByLabelText(/instructions/i)) as HTMLTextAreaElement;
    expect(prompt.value).toBe("host B prompt");
  });

  it("T-07c: while the list is open, it re-reads every 30s (Last/Next chips stay live)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      listScheduledAgentsMock.mockResolvedValue([makeRow({ nextFireAt: nowSecs + 10 })]);
      render(
        <ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />,
      );
      await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
      expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(listScheduledAgentsMock).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-08: '+' button → form view, create mode, all fields empty", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));
    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    expect(nameInput).not.toBeDisabled();
  });
});

describe("ScheduledAgentsModal: pessimistic toggle (D-12)", () => {
  it("T-09: success flips state via refetch; failure surfaces banner + no local flip", async () => {
    // Success path
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    toggleScheduledAgentEnabledMock.mockResolvedValueOnce({
      slug: "morning-triage",
      host: 1,
      enabled: false,
    });
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: false })]);

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    let toggle = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage-toggle",
    );
    // Modal-unification 2026-09-29: toggle is a visual pill (no text). On/off
    // state signals via `.on` class on the button.
    expect(toggle.classList.contains("on")).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggleScheduledAgentEnabledMock).toHaveBeenCalledWith(
        "morning-triage",
        1,
        false,
      );
    });
    // After refetch, row toggle is off
    await waitFor(() => {
      toggle = screen.getByTestId(
        "scheduled-agents-modal-row-morning-triage-toggle",
      );
      expect(toggle.classList.contains("on")).toBe(false);
    });

    // Failure path: cleanup + re-render.
    cleanup();
    toggleScheduledAgentEnabledMock.mockReset();
    listScheduledAgentsMock.mockReset();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    toggleScheduledAgentEnabledMock.mockRejectedValueOnce(new Error("Boom"));

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    toggle = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage-toggle",
    );
    expect(toggle.classList.contains("on")).toBe(true);
    fireEvent.click(toggle);
    // Banner appears with API message verbatim — unified write-error slot
    // replaces the pre-unification per-op banners (toggle/delete/load).
    const banner = await screen.findByTestId("scheduled-agents-modal-write-error");
    expect(banner.textContent).toMatch(/Boom/);
    // Row toggle STILL on — no local flip on failure
    toggle = screen.getByTestId("scheduled-agents-modal-row-morning-triage-toggle");
    expect(toggle.classList.contains("on")).toBe(true);
  });
});

describe("ScheduledAgentsModal: kebab menu (D-13, D-14)", () => {
  // Kebab is now the shared Radix-based `RowKebabMenu` (D-29, 2026-10-01) —
  // Radix needs a full pointer-event sequence to open the dropdown, so
  // `userEvent.click` is required here (bare `fireEvent.click` leaves the
  // trigger in `data-state="closed"`).

  it("T-10: Kebab → Edit → same as row click (form view, edit mode)", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    await user.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    const editItem = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage-edit",
    );
    await user.click(editItem);
    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Morning triage");
    expect(nameInput).toBeDisabled();
  });

  it("T-11: Kebab → Delete → window.confirm + DELETE + refetch", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    deleteScheduledAgentMock.mockResolvedValueOnce(undefined);
    listScheduledAgentsMock.mockResolvedValueOnce([]);

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    await user.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    const deleteItem = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage-delete",
    );
    await user.click(deleteItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete scheduled task "Morning triage"?',
    );
    await waitFor(() => {
      expect(deleteScheduledAgentMock).toHaveBeenCalledWith("morning-triage", 1);
    });
    // Row disappears after refetch
    await waitFor(() => {
      expect(
        screen.queryByTestId("scheduled-agents-modal-row-morning-triage"),
      ).toBeNull();
    });

    confirmSpy.mockRestore();
  });
});

describe("ScheduledAgentsModal: Save + Cancel flow (D-19, D-25, D-27)", () => {
  it("T-12: Save success → refetch + return to list view", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    createScheduledAgentMock.mockResolvedValueOnce({
      slug: "new-agent",
      host: 1,
      spec: {},
    });
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "new-agent", name: "New agent" }),
    ]);
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
    ]);

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));

    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    const promptInput = screen.getByTestId(
      "scheduled-agents-modal-form-prompt",
    ) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "new-agent" } });
    fireEvent.change(promptInput, { target: { value: "hello" } });

    // Pick a role (optional) so the save carries one.
    const roleChip = await screen.findByTestId(
      "scheduled-agents-modal-form-role-addable-assistant",
    );
    fireEvent.click(roleChip);

    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));

    await waitFor(() => {
      expect(createScheduledAgentMock).toHaveBeenCalledTimes(1);
    });
    // Back to list view — row from refetch is visible
    await waitFor(() => {
      expect(screen.getByText("New agent")).toBeInTheDocument();
    });
  });

  it("T-13: Save 409 → inline banner with server message, form stays open", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    createScheduledAgentMock.mockRejectedValueOnce(
      new FakeApiError("Conflict", 409, "CONFLICT"),
    );
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
    ]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));

    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    const promptInput = screen.getByTestId(
      "scheduled-agents-modal-form-prompt",
    ) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "dup-agent" } });
    fireEvent.change(promptInput, { target: { value: "hi" } });

    const roleChip = await screen.findByTestId(
      "scheduled-agents-modal-form-role-addable-assistant",
    );
    fireEvent.click(roleChip);

    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));

    const banner = await screen.findByTestId("scheduled-agents-modal-form-error");
    expect(banner.textContent).toMatch(/already exists/i);
    // Form stays open — Save button still present.
    expect(screen.getByTestId("scheduled-agents-modal-form-save")).toBeInTheDocument();
  });

  it("T-14: Cancel → back to list view (with refetch per Recommendation #7)", async () => {
    listScheduledAgentsMock.mockResolvedValue([]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    // Reset the call count after the initial fetch on open so we can
    // assert Cancel triggers exactly one additional refetch.
    listScheduledAgentsMock.mockClear();

    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));
    await screen.findByTestId("scheduled-agents-modal-form");

    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-cancel"));

    // Back to list view — the empty-state is visible again
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    // Cancel triggered a refetch
    expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1);
  });
});

describe("ScheduledAgentsModal: filter reset on close (D-17)", () => {
  it("T-15: closing then reopening the modal resets filter search + role + host to defaults", async () => {
    listScheduledAgentsMock.mockResolvedValue([
      makeRow({ slug: "a", name: "Alpha", roles: ["writer"] }),
    ]);

    // Multi-host tree — the host filter is hidden on single-host boxes
    // (user 2026-09-29), so use a two-host tree to keep the host select
    // rendered for the assertion below.
    const TWO_HOST_TREE_T15: HostFolder = {
      name: "root",
      children: [
        (ONE_HOST_TREE.children[0] as never),
        {
          ...(ONE_HOST_TREE.children[0] as never),
          id: "2",
          name: "host-b",
        } as never,
      ],
    };

    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button
            type="button"
            data-testid="harness-toggle"
            onClick={() => setOpen((o) => !o)}
          >
            toggle
          </button>
          <ScheduledAgentsModal
            open={open}
            onOpenChange={setOpen}
            hostTree={TWO_HOST_TREE_T15}
          />
        </>
      );
    }

    render(<Harness />);
    const search = (await screen.findByTestId(
      "scheduled-agents-modal-filter-search",
    )) as HTMLInputElement;
    const roleSel = (await screen.findByTestId(
      "scheduled-agents-modal-filter-role",
    )) as HTMLSelectElement;
    const hostSel = (await screen.findByTestId(
      "scheduled-agents-modal-filter-host",
    )) as HTMLSelectElement;

    const user = userEvent.setup();
    await user.type(search, "foo");
    expect(search.value).toBe("foo");

    // Extended post-/close code review — M5: also mutate the role + host
    // dropdowns so we can verify BOTH reset on close, not just search.
    fireEvent.change(roleSel, { target: { value: "writer" } });
    expect(roleSel.value).toBe("writer");
    fireEvent.change(hostSel, { target: { value: "1" } });
    expect(hostSel.value).toBe("1");

    // Close via harness toggle (fireEvent bypasses portal pointer-events).
    fireEvent.click(screen.getByTestId("harness-toggle"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("scheduled-agents-modal-filter-search"),
      ).toBeNull();
    });

    // Reopen — every filter is back to its default ("__ALL__" sentinel).
    fireEvent.click(screen.getByTestId("harness-toggle"));
    const searchAgain = (await screen.findByTestId(
      "scheduled-agents-modal-filter-search",
    )) as HTMLInputElement;
    const roleSelAgain = (await screen.findByTestId(
      "scheduled-agents-modal-filter-role",
    )) as HTMLSelectElement;
    const hostSelAgain = (await screen.findByTestId(
      "scheduled-agents-modal-filter-host",
    )) as HTMLSelectElement;
    expect(searchAgain.value).toBe("");
    expect(roleSelAgain.value).toBe("__ALL__");
    expect(hostSelAgain.value).toBe("__ALL__");
  });
});

// UAT 2026-10-01 — the user's two follow-ups on scheduled-agents create flow.
describe("ScheduledAgentsModal: UAT 2026-10-01", () => {
  it("T-16: Save success → new row appears optimistically before refetch resolves", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    createScheduledAgentMock.mockResolvedValueOnce({
      slug: "fresh-agent",
      host: 1,
      spec: {},
    });
    // Refetch after save — never resolves within this test so we're
    // asserting the OPTIMISTIC row (not the refetched one).
    let resolveRefetch: ((rows: ScheduledAgentListItem[]) => void) | null = null;
    listScheduledAgentsMock.mockImplementationOnce(
      () => new Promise<ScheduledAgentListItem[]>((r) => {
        resolveRefetch = r;
      }),
    );
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
    ]);

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));

    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    const promptInput = screen.getByTestId(
      "scheduled-agents-modal-form-prompt",
    ) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "fresh-agent" } });
    fireEvent.change(promptInput, { target: { value: "do stuff" } });

    const roleChip = await screen.findByTestId(
      "scheduled-agents-modal-form-role-addable-assistant",
    );
    fireEvent.click(roleChip);

    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));

    // Row visible from the OPTIMISTIC splice — refetch is still pending.
    const row = await screen.findByTestId(
      "scheduled-agents-modal-row-fresh-agent",
    );
    expect(row).toBeInTheDocument();
    // Refetch hasn't resolved yet.
    expect(resolveRefetch).not.toBeNull();
    // Clean up the pending promise so React doesn't warn on unmount.
    resolveRefetch!([]);
  });

  it("T-16b: Edit success → row updates optimistically before refetch resolves", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "morning-triage", name: "Morning triage", prompt: "old prompt" }),
    ]);
    updateScheduledAgentMock.mockResolvedValueOnce({
      slug: "morning-triage",
      host: 1,
      spec: {},
    });
    // Pending refetch — we want to assert the edit's optimistic overlay,
    // not the post-refetch state.
    let resolveRefetch: ((rows: ScheduledAgentListItem[]) => void) | null = null;
    listScheduledAgentsMock.mockImplementationOnce(
      () => new Promise<ScheduledAgentListItem[]>((r) => {
        resolveRefetch = r;
      }),
    );
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
    ]);

    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    const row = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage",
    );
    expect(row.textContent).toMatch(/old prompt/);
    fireEvent.click(row);

    const promptInput = (await screen.findByTestId(
      "scheduled-agents-modal-form-prompt",
    )) as HTMLTextAreaElement;
    fireEvent.change(promptInput, { target: { value: "new prompt" } });

    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));

    await waitFor(() => {
      expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1);
    });
    // Back on the list; row carries the NEW prompt from the optimistic
    // overlay — refetch hasn't resolved yet.
    const updatedRow = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage",
    );
    expect(updatedRow.textContent).toMatch(/new prompt/);
    expect(updatedRow.textContent).not.toMatch(/old prompt/);
    expect(resolveRefetch).not.toBeNull();
    resolveRefetch!([]);
  });

  it("T-17: zero roles must be picked deliberately — Save disabled until \"No roles\" is picked, then saves roles: []", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
    ]);
    createScheduledAgentMock.mockResolvedValueOnce({
      slug: "no-roles",
      host: 1,
      spec: {},
    });
    listScheduledAgentsMock.mockResolvedValueOnce([]);

    await openCreateForm();

    // Roles offered, nothing picked (not even "No roles") — Save disabled + hint.
    await screen.findByTestId("scheduled-agents-modal-form-role-addable-assistant");
    const noRoles = screen.getByTestId("scheduled-agents-modal-form-no-roles");
    expect(noRoles).toHaveTextContent("No roles");
    expect(noRoles).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("scheduled-agents-modal-form-roles-hint")).toHaveTextContent(
      "Pick roles, or No roles.",
    );
    const saveBtn = screen.getByTestId(
      "scheduled-agents-modal-form-save",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("scheduled-agents-modal-form-roles-hint")).toBeNull();
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(createScheduledAgentMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.stringify(createScheduledAgentMock.mock.calls[0])).toContain('"roles":[]');
    expect(screen.queryByTestId("scheduled-agents-modal-form-error")).toBeNull();
  });

  it("T-17b: \"No roles\" and roles are exclusive; unticking the last role leaves nothing picked", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
      { name: "ops", description: "" },
    ]);
    await openCreateForm();
    const saveBtn = screen.getByTestId("scheduled-agents-modal-form-save") as HTMLButtonElement;
    const noRoles = screen.getByTestId("scheduled-agents-modal-form-no-roles");

    // "No roles" → picking a role clears it.
    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-checked", "true");
    fireEvent.click(await screen.findByTestId("scheduled-agents-modal-form-role-addable-assistant"));
    expect(noRoles).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("scheduled-agents-modal-form-role-selected-assistant")).toBeInTheDocument();
    expect(saveBtn.disabled).toBe(false);

    // Picking "No roles" clears the roles.
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-role-addable-ops"));
    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("scheduled-agents-modal-form-role-selected-assistant")).toBeNull();
    expect(screen.queryByTestId("scheduled-agents-modal-form-role-selected-ops")).toBeNull();

    // Unticking the last role does NOT fall back to "No roles".
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-role-addable-ops"));
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-role-selected-ops"));
    expect(noRoles).toHaveAttribute("aria-checked", "false");
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByTestId("scheduled-agents-modal-form-roles-hint")).toBeInTheDocument();

    // Unticking "No roles" leaves nothing picked either.
    fireEvent.click(noRoles);
    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-checked", "false");
    expect(saveBtn.disabled).toBe(true);
  });

  it("T-17c: editing a task saved with roles: [] shows \"No roles\" picked and saves roles: []", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ roles: [] })]);
    listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
    updateScheduledAgentMock.mockResolvedValueOnce({});
    listScheduledAgentsMock.mockResolvedValue([]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    fireEvent.click(await screen.findByText("Morning triage"));
    const noRoles = await screen.findByTestId("scheduled-agents-modal-form-no-roles");
    expect(noRoles).toHaveAttribute("aria-checked", "true");
    const saveBtn = screen.getByTestId("scheduled-agents-modal-form-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(updateScheduledAgentMock.mock.calls[0])).toContain('"roles":[]');
  });

  it("T-17d: editing a task with roles shows them picked, not \"No roles\"", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ roles: ["assistant"] })]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    fireEvent.click(await screen.findByText("Morning triage"));
    const noRoles = await screen.findByTestId("scheduled-agents-modal-form-no-roles");
    expect(noRoles).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("scheduled-agents-modal-form-role-selected-assistant")).toBeInTheDocument();
  });

  it("T-17e: create only offers machines that can host agents", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    const tree: HostFolder = {
      name: "root",
      children: [
        ONE_HOST_TREE.children[0] as never,
        { ...(ONE_HOST_TREE.children[0] as unknown as Record<string, unknown>), id: "2", name: "winbox", runsFleetSubstrate: false } as never,
        { ...(ONE_HOST_TREE.children[0] as unknown as Record<string, unknown>), id: "3", name: "fleet-b" } as never,
      ],
    };
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={tree} />);
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));
    await screen.findByTestId("scheduled-agents-modal-form-host-option-1");
    expect(screen.getByTestId("scheduled-agents-modal-form-host-option-3")).toBeInTheDocument();
    expect(screen.queryByTestId("scheduled-agents-modal-form-host-option-2")).toBeNull();
  });

  it("T-17f: one eligible + one ineligible host → the eligible one is auto-picked, no host picker", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    const tree: HostFolder = {
      name: "root",
      children: [
        ONE_HOST_TREE.children[0] as never,
        { ...(ONE_HOST_TREE.children[0] as unknown as Record<string, unknown>), id: "2", name: "winbox", runsFleetSubstrate: false } as never,
      ],
    };
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={tree} />);
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));
    await screen.findByTestId("scheduled-agents-modal-form-no-roles");
    expect(screen.queryByTestId("scheduled-agents-modal-form-host")).toBeNull();
    expect(listRolesForHostMock).toHaveBeenCalledWith(1);
  });
});

/** Open the create form on the one-host tree with a name + prompt filled in. */
async function openCreateForm(): Promise<void> {
  render(
    <ScheduledAgentsModal
      open={true}
      onOpenChange={vi.fn()}
      hostTree={ONE_HOST_TREE}
    />,
  );
  await screen.findByTestId("scheduled-agents-modal-empty-state");
  fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));
  fireEvent.change(await screen.findByTestId("scheduled-agents-modal-form-name"), {
    target: { value: "no-roles" },
  });
  fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-prompt"), {
    target: { value: "x" },
  });
  await screen.findByTestId("scheduled-agents-modal-form-no-roles");
}

describe("ScheduledAgentsModal: Run now", () => {
  it("T-18: Kebab → Run now → POST run-now + success toast", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    runScheduledAgentNowMock.mockResolvedValueOnce({
      slug: "morning-triage",
      host: 1,
      requestId: "00000000-0000-0000-0000-000000000000",
    });
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    await user.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    await user.click(
      await screen.findByTestId("scheduled-agents-modal-row-morning-triage-run-now"),
    );
    await waitFor(() => {
      expect(runScheduledAgentNowMock).toHaveBeenCalledWith("morning-triage", 1);
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    });
    expect(String(toastSuccessMock.mock.calls[0][0])).toContain("Morning triage");
    expect(screen.queryByTestId("scheduled-agents-modal-write-error")).toBeNull();
  });

  it("T-18b: Run now failure surfaces the server message in the banner", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    runScheduledAgentNowMock.mockRejectedValueOnce(
      new FakeApiError("host unreachable", 502),
    );
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    await user.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    await user.click(
      await screen.findByTestId("scheduled-agents-modal-row-morning-triage-run-now"),
    );
    const banner = await screen.findByTestId("scheduled-agents-modal-write-error");
    expect(banner.textContent).toMatch(/host unreachable/);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("T-18c: one_shot rows have no Run now item (firing early would consume the spec)", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ schedule: { type: "one_shot", at: "2030-01-01T09:00" } }),
    ]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    await user.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage-edit");
    expect(
      screen.queryByTestId("scheduled-agents-modal-row-morning-triage-run-now"),
    ).toBeNull();
  });
});

describe("ScheduledAgentsModal: schedule format v2", () => {
  async function openEdit(schedule: Record<string, unknown>): Promise<void> {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ schedule })]);
    listScheduledAgentsMock.mockResolvedValue([]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    fireEvent.click(await screen.findByTestId("scheduled-agents-modal-row-morning-triage"));
    await screen.findByTestId("scheduled-agents-modal-form-prompt");
  }

  async function savedSchedule(): Promise<Record<string, unknown>> {
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    return updateScheduledAgentMock.mock.calls[0][2].schedule as Record<string, unknown>;
  }

  it("T-19: editing a v2 spec without touching the schedule saves it unchanged", async () => {
    const schedule = {
      type: "monthly",
      nth: "last",
      weekday: "fri",
      at: ["09:00", "16:00"],
      every: 3,
      start: "2027-01-01T00:00:00",
      until: "2030-01-01T00:00:00",
      timezone: "Europe/London",
      days: ["mon", "fri"],
    };
    await openEdit(schedule);
    expect(screen.getByTestId("scheduled-agents-modal-form-schedule-kind-monthly")).toBeInTheDocument();
    expect((screen.getByTestId("scheduled-agents-modal-form-schedule-monthly-nth") as HTMLSelectElement).value).toBe("last");
    expect(await savedSchedule()).toEqual(schedule);
  });

  it("T-19b: interval keeps its hand-set timezone and gains a window from the form", async () => {
    await openEdit({ type: "interval", every: "30m", timezone: "Europe/London" });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-schedule-window-toggle"));
    expect(await savedSchedule()).toEqual({
      type: "interval",
      every: "30m",
      window: { from: "09:00", to: "17:00" },
      timezone: "Europe/London",
    });
  });

  it("T-19c: daily → add a second time + end after 5 runs", async () => {
    await openEdit({ type: "daily", at: "09:00", timezone: "Europe/London" });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-schedule-daily-at-add"));
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-schedule-daily-at-2"), {
      target: { value: "17:00" },
    });
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-schedule-ends"), { target: { value: "count" } });
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-schedule-count"), { target: { value: "5" } });
    expect(await savedSchedule()).toEqual({
      type: "daily",
      at: ["09:00", "17:00"],
      timezone: "Europe/London",
      count: 5,
    });
  });

  it("T-19e: a sensor task shows a read-only Sensor schedule and saves it unchanged", async () => {
    await openEdit({ type: "sensor" });
    expect(screen.getByTestId("scheduled-agents-modal-form-schedule-sensor")).toHaveTextContent("Sensor");
    expect(screen.queryByTestId("scheduled-agents-modal-form-schedule-kind")).toBeNull();
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-prompt"), { target: { value: "new prompt" } });
    expect(await savedSchedule()).toEqual({ type: "sensor" });
    expect(updateScheduledAgentMock.mock.calls[0][2].prompt).toBe("new prompt");
  });

  it("T-19f: a one-time sensor task reads 'Sensor · once' and keeps the mark on save", async () => {
    await openEdit({ type: "sensor", once: true });
    expect(screen.getByTestId("scheduled-agents-modal-form-schedule-sensor")).toHaveTextContent("Sensor · once");
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-prompt"), { target: { value: "new prompt" } });
    expect(await savedSchedule()).toEqual({ type: "sensor", once: true });
  });

  it("T-19d: switching to Monthly every 2 months writes a start", async () => {
    await openEdit({ type: "daily", at: "09:00", timezone: "Europe/London" });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-schedule-kind-monthly"));
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-schedule-monthly-dom"), {
      target: { value: "last" },
    });
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-schedule-every"), { target: { value: "2" } });
    expect(screen.getByTestId("scheduled-agents-modal-form-schedule-start")).toBeInTheDocument();
    const saved = await savedSchedule();
    expect(saved).toMatchObject({ type: "monthly", day: "last", at: "09:00", every: 2, timezone: "Europe/London" });
    expect(Number.isNaN(new Date(saved.start as string).getTime())).toBe(false);
  });
});

// ─── Sensors shape 2 ─────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: sensor status", () => {
  const NOW = Math.floor(Date.now() / 1000);
  const sensorRow = (state: "healthy" | "broken" | "off" | "unknown", extra: Partial<ScheduledAgentListItem> = {}) =>
    makeRow({
      slug: "deliveries",
      name: "Deliveries",
      schedule: { type: "sensor" },
      scheduleHuman: "Sensor",
      lastFiredAt: NOW - 3 * 3600,
      nextFireAt: null,
      sensor: {
        state,
        run: "always",
        cadenceHuman: null,
        lastRanAt: NOW - 30,
        waitingFires: state === "off" ? 2 : 0,
        error: state === "broken" ? "Traceback\nKeyError: x" : null,
      },
      ...extra,
    });

  it("T-20: a sensor row reads 'Sensor · <status> · Last fired …' with no Next; clock rows unchanged", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("healthy"), makeRow({ lastFiredAt: NOW - 60, nextFireAt: NOW + 630 })]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    const line = await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor");
    expect(line).toHaveTextContent("Sensor");
    expect(line).toHaveTextContent("Healthy");
    expect(line).toHaveTextContent("Last fired 3h ago");
    const row = screen.getByTestId("scheduled-agents-modal-row-deliveries");
    expect(row).not.toHaveTextContent("Next:");
    expect(screen.getByTestId("scheduled-agents-modal-row-morning-triage")).toHaveTextContent("Next: in 10m");
  });

  it("T-20g: a one-time sensor row reads 'Sensor · once'; a repeating one doesn't", async () => {
    listScheduledAgentsMock.mockResolvedValue([
      sensorRow("healthy", { schedule: { type: "sensor", once: true }, scheduleHuman: "Sensor · once" }),
      sensorRow("healthy", { slug: "payday", name: "Payday" }),
    ]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    expect(await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor")).toHaveTextContent("Sensor · once");
    expect(screen.getByTestId("scheduled-agents-modal-row-payday-sensor")).not.toHaveTextContent("once");
  });

  it("T-20b: switched off with held fires shows Off and the waiting count", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("off", { enabled: false })]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    const line = await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor");
    expect(line).toHaveTextContent("Off");
    expect(screen.getByTestId("scheduled-agents-modal-row-deliveries-sensor-waiting")).toHaveTextContent("2 waiting");
  });

  it("T-20c: never fired reads 'Never fired'; unknown reads Unknown", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("unknown", { lastFiredAt: null })]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    const line = await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor");
    expect(line).toHaveTextContent("Unknown");
    expect(line).toHaveTextContent("Never fired");
  });

  it("T-20d: opening a broken sensor task shows the read-only sensor section with the error lines", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("broken")]);
    listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    const line = await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor");
    expect(line).toHaveTextContent("Broken");
    expect(line).not.toHaveTextContent("KeyError");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-row-deliveries"));
    const details = await screen.findByTestId("scheduled-agents-modal-form-sensor-details");
    expect(details).toHaveTextContent("Always running");
    expect(details).toHaveTextContent("Running since");
    expect(details).not.toHaveTextContent("Last ran");
    expect(screen.getByTestId("scheduled-agents-modal-form-sensor-details-error")).toHaveTextContent("KeyError: x");
  });

  it("T-20f: a refresh that fails outright turns on-screen sensors Unknown (no stale Healthy)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
      listScheduledAgentsMock.mockRejectedValue(new Error("network down"));
      render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
      const line = await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor");
      expect(line).toHaveTextContent("Healthy");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() =>
        expect(screen.getByTestId("scheduled-agents-modal-row-deliveries-sensor")).toHaveTextContent("Unknown"),
      );
      expect(screen.getByTestId("scheduled-agents-modal-row-deliveries-sensor")).not.toHaveTextContent("Healthy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-20g: a slow background read that started before a toggle can't undo it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let releaseSlow: (rows: ScheduledAgentListItem[]) => void = () => {};
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
      // Timed refresh: slow, carries the pre-toggle (enabled) row.
      listScheduledAgentsMock.mockImplementationOnce(
        () => new Promise<ScheduledAgentListItem[]>((res) => (releaseSlow = res)),
      );
      // The toggle's own refetch: fresh, disabled.
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("off", { enabled: false })]);
      toggleScheduledAgentEnabledMock.mockResolvedValue(undefined);
      render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
      await screen.findByTestId("scheduled-agents-modal-row-deliveries-sensor");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(listScheduledAgentsMock).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByTestId("scheduled-agents-modal-row-deliveries-toggle"));
      await waitFor(() =>
        expect(screen.getByTestId("scheduled-agents-modal-row-deliveries-sensor")).toHaveTextContent("Off"),
      );
      await act(async () => {
        releaseSlow([sensorRow("healthy")]);
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByTestId("scheduled-agents-modal-row-deliveries-sensor")).toHaveTextContent("Off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-20e: the opened task's sensor section follows the 30s refresh, and survives a refresh that drops the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("broken")]);
      listScheduledAgentsMock.mockResolvedValue([]);
      listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
      render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
      fireEvent.click(await screen.findByTestId("scheduled-agents-modal-row-deliveries"));
      const details = await screen.findByTestId("scheduled-agents-modal-form-sensor-details");
      expect(details).toHaveTextContent("Healthy");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() =>
        expect(screen.getByTestId("scheduled-agents-modal-form-sensor-details")).toHaveTextContent("Broken"),
      );
      // Next refresh returns nothing (host didn't answer) — the form keeps the
      // last copy, but its sensor can no longer be vouched for: Unknown.
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(listScheduledAgentsMock).toHaveBeenCalledTimes(3));
      await waitFor(() =>
        expect(screen.getByTestId("scheduled-agents-modal-form-sensor-details")).toHaveTextContent("Unknown"),
      );
      expect(screen.getByTestId("scheduled-agents-modal-form-sensor-details")).not.toHaveTextContent("Broken");
      expect(screen.queryByTestId("scheduled-agents-modal-form-sensor-details-error")).toBeNull();
      expect(screen.getByTestId("scheduled-agents-modal-form-schedule-sensor")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ScheduledAgentsModal: Archive if nothing to report", () => {
  const BOX = "scheduled-agents-modal-form-archive-if-nothing-to-report";

  it("T-AR1: create — unticked by default, with the helper line; ticking it saves true", async () => {
    listScheduledAgentsMock.mockResolvedValue([]);
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "box-check", host: 1, spec: {} });
    listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));

    const box = (await screen.findByTestId(BOX)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByLabelText("Archive if nothing to report")).toBe(box);
    expect(
      screen.getByText("If the run goes smoothly, the agent archives itself so it doesn't stay in your sidebar."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-name"), { target: { value: "box-check" } });
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-prompt"), { target: { value: "check" } });
    fireEvent.click(await screen.findByTestId("scheduled-agents-modal-form-role-addable-assistant"));
    fireEvent.click(box);
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));

    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][1].archive_if_nothing_to_report).toBe(true);
  });

  it("T-AR2: edit — reflects the stored setting; unticking saves false", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow({ archive_if_nothing_to_report: true })]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    fireEvent.click(await screen.findByTestId("scheduled-agents-modal-row-morning-triage"));

    const box = (await screen.findByTestId(BOX)) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));

    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].archive_if_nothing_to_report).toBe(false);
  });
});

describe("ScheduledAgentsModal: project", () => {
  const SELECT = "scheduled-agents-modal-form-project-select";
  const PROJECTS = [
    { slug: "skynet", displayName: "SKYNET", parent: null },
    { slug: "later", displayName: "later", parent: "skynet" },
    { slug: "aither", displayName: "Aither", parent: null },
  ];
  const TWO_HOSTS: HostFolder = {
    name: "root",
    children: [
      ONE_HOST_TREE.children[0] as never,
      { ...(ONE_HOST_TREE.children[0] as unknown as Record<string, unknown>), id: "2", name: "host-b" } as never,
    ],
  };

  it("T-PR1: create — No project by default; lists the host's projects in sidebar order; saves the pick", async () => {
    listScheduledAgentProjectsMock.mockResolvedValue(PROJECTS);
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "no-roles", host: 1, spec: {} });
    listScheduledAgentsMock.mockResolvedValue([]);
    await openCreateForm();
    const select = (await screen.findByTestId(SELECT)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(4));
    expect(listScheduledAgentProjectsMock).toHaveBeenCalledWith(1);
    expect(select.value).toBe("");
    expect([...select.options].map((o) => o.value)).toEqual(["", "aither", "skynet", "later"]);
    expect(select.options[3].textContent).toBe("\u00a0\u00a0\u00a0\u00a0later");
    fireEvent.change(select, { target: { value: "later" } });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-no-roles"));
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][1].project).toBe("later");
  });

  it("T-PR2: No project saves without a project key", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "no-roles", host: 1, spec: {} });
    listScheduledAgentsMock.mockResolvedValue([]);
    await openCreateForm();
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-no-roles"));
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect("project" in createScheduledAgentMock.mock.calls[0][1]).toBe(false);
  });

  it("T-PR3: switching the host clears the project pick", async () => {
    listScheduledAgentsMock.mockResolvedValue([]);
    listScheduledAgentProjectsMock.mockResolvedValue(PROJECTS);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={TWO_HOSTS} />);
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-add-button"));
    fireEvent.click(await screen.findByTestId("scheduled-agents-modal-form-host-option-1"));
    const select = (await screen.findByTestId(SELECT)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(4));
    fireEvent.change(select, { target: { value: "skynet" } });
    expect(select.value).toBe("skynet");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-host-option-1"));
    expect((screen.getByTestId(SELECT) as HTMLSelectElement).value).toBe("skynet");
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-host-option-2"));
    await waitFor(() => expect(listScheduledAgentProjectsMock).toHaveBeenCalledWith(2));
    expect((screen.getByTestId(SELECT) as HTMLSelectElement).value).toBe("");
  });

  it("T-PR4: edit — a missing project stays picked, marked missing, and an unrelated save keeps it", async () => {
    listScheduledAgentProjectsMock.mockResolvedValue(PROJECTS);
    listScheduledAgentsMock.mockResolvedValue([makeRow({ project: "gone", projectPath: null, projectMissing: true })]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    expect(await screen.findByTestId("scheduled-agents-modal-row-morning-triage-project")).toHaveTextContent(
      "Project missing: gone",
    );
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-row-morning-triage"));
    await screen.findByTestId("scheduled-agents-modal-form-project-missing");
    const select = screen.getByTestId(SELECT) as HTMLSelectElement;
    expect(select.value).toBe("gone");
    expect(select.selectedOptions[0].textContent).toBe("gone (missing)");
    fireEvent.change(screen.getByTestId("scheduled-agents-modal-form-prompt"), { target: { value: "new words" } });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].project).toBe("gone");
  });

  it("T-PR5: edit — the saved project is picked even before the project list loads, and can be cleared", async () => {
    let release: (v: unknown) => void = () => {};
    listScheduledAgentProjectsMock.mockReturnValue(new Promise((r) => { release = r; }));
    listScheduledAgentsMock.mockResolvedValue([makeRow({ project: "later", projectPath: ["SKYNET", "later"] })]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    expect(await screen.findByTestId("scheduled-agents-modal-row-morning-triage-project")).toHaveTextContent(
      "SKYNET › later",
    );
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-row-morning-triage"));
    const select = (await screen.findByTestId(SELECT)) as HTMLSelectElement;
    expect(select.value).toBe("later");
    expect(screen.queryByTestId("scheduled-agents-modal-form-project-missing")).toBeNull();
    await act(async () => release(PROJECTS));
    expect(select.value).toBe("later");
    expect(select.selectedOptions[0].textContent).toBe("\u00a0\u00a0\u00a0\u00a0later");
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-form-save"));
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect("project" in updateScheduledAgentMock.mock.calls[0][2]).toBe(false);
  });

  it("T-PR7: a project whose host couldn't be read shows its slug in the neutral style", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow({ project: "later", projectPath: null, projectMissing: false })]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    const chip = await screen.findByTestId("scheduled-agents-modal-row-morning-triage-project");
    expect(chip).toHaveTextContent("later");
    expect(chip).toHaveClass("unknown");
    expect(chip).not.toHaveClass("missing");
  });

  it("T-PR6: rows without a project show no project chip", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    render(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    await screen.findByText("Morning triage");
    expect(screen.queryByTestId("scheduled-agents-modal-row-morning-triage-project")).toBeNull();
  });
});
