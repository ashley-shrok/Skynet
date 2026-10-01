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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import {
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

vi.mock("@/api/scheduled-agents-api", () => ({
  listScheduledAgents: (...args: unknown[]) => listScheduledAgentsMock(...args),
  createScheduledAgent: (...args: unknown[]) => createScheduledAgentMock(...args),
  updateScheduledAgent: (...args: unknown[]) => updateScheduledAgentMock(...args),
  toggleScheduledAgentEnabled: (...args: unknown[]) => toggleScheduledAgentEnabledMock(...args),
  deleteScheduledAgent: (...args: unknown[]) => deleteScheduledAgentMock(...args),
}));

vi.mock("@/api/identities-api", () => ({
  listRolesForHost: vi.fn().mockResolvedValue([]),
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
    skills: [],
    colorHue: null,
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
    expect(empty.textContent).toMatch(/No scheduled agents on any host/i);
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
  it("T-10: Kebab → Edit → same as row click (form view, edit mode)", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <ScheduledAgentsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("scheduled-agents-modal-row-morning-triage");
    fireEvent.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    const editItem = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage-edit",
    );
    fireEvent.click(editItem);
    const nameInput = await screen.findByTestId(
      "scheduled-agents-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Morning triage");
    expect(nameInput).toBeDisabled();
  });

  it("T-11: Kebab → Delete → window.confirm + DELETE + refetch", async () => {
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
    fireEvent.click(
      screen.getByTestId("scheduled-agents-modal-row-morning-triage-kebab"),
    );
    const deleteItem = await screen.findByTestId(
      "scheduled-agents-modal-row-morning-triage-delete",
    );
    fireEvent.click(deleteItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete scheduled agent "Morning triage"?',
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
