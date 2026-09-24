/**
 * Phase 135 Plan 135-02 Task 4 — WakeupsModal behavioral tests.
 *
 * 15 tests covering the wave-1 read path + all wave-2 write paths:
 *   T-01  open={false} mounts nothing visible
 *   T-02  open={true} triggers listWakeups + skeleton → rows
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
import type { WakeupListItem } from "@/api/wakeups-api";

// ─── Module-level mocks (BEFORE component import) ────────────────────────────

const listWakeupsMock = vi.fn();
const createWakeupMock = vi.fn();
const updateWakeupMock = vi.fn();
const toggleWakeupEnabledMock = vi.fn();
const deleteWakeupMock = vi.fn();

vi.mock("@/api/wakeups-api", () => ({
  listWakeups: (...args: unknown[]) => listWakeupsMock(...args),
  createWakeup: (...args: unknown[]) => createWakeupMock(...args),
  updateWakeup: (...args: unknown[]) => updateWakeupMock(...args),
  toggleWakeupEnabled: (...args: unknown[]) => toggleWakeupEnabledMock(...args),
  deleteWakeup: (...args: unknown[]) => deleteWakeupMock(...args),
}));

vi.mock("@/api/identities-api", () => ({
  listRolesForHost: vi.fn().mockResolvedValue([]),
}));

// Component AFTER the mocks
import { WakeupsModal } from "./WakeupsModal";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<WakeupListItem> = {}): WakeupListItem {
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
  listWakeupsMock.mockReset();
  createWakeupMock.mockReset();
  updateWakeupMock.mockReset();
  toggleWakeupEnabledMock.mockReset();
  deleteWakeupMock.mockReset();
});

afterEach(() => {
  cleanup();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WakeupsModal: closed vs open + read path", () => {
  it("T-01: renders nothing visible when open={false}", () => {
    render(
      <WakeupsModal
        open={false}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    expect(screen.queryByTestId("wakeups-modal-close-button")).toBeNull();
  });

  it("T-02: open={true} triggers listWakeups once + skeleton → rows", async () => {
    listWakeupsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await waitFor(() =>
      expect(listWakeupsMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByText("Morning triage")).toBeInTheDocument(),
    );
  });

  it("T-03: empty response → empty-state helper text", async () => {
    listWakeupsMock.mockResolvedValueOnce([]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    const empty = await screen.findByTestId("wakeups-modal-empty-state");
    expect(empty.textContent).toMatch(/No wake-ups on any host/i);
  });
});

describe("WakeupsModal: filter bar", () => {
  it("T-04: search input narrows over name+prompt (case-insensitive)", async () => {
    listWakeupsMock.mockResolvedValueOnce([
      makeRow(),
      makeRow({
        slug: "log-sweep",
        name: "Log sweep",
        prompt: "sweep logs",
      }),
    ]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByText("Morning triage");
    const search = screen.getByTestId(
      "wakeups-modal-filter-search",
    ) as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(search, "log");
    expect(screen.getByText("Log sweep")).toBeInTheDocument();
    expect(screen.queryByText("Morning triage")).toBeNull();
  });

  it("T-05: role filter narrows to matching role", async () => {
    listWakeupsMock.mockResolvedValueOnce([
      makeRow({ slug: "a", name: "Alpha", roles: ["writer"] }),
      makeRow({ slug: "b", name: "Beta", roles: ["reader"] }),
    ]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByText("Alpha");
    const roleSel = screen.getByTestId(
      "wakeups-modal-filter-role",
    ) as HTMLSelectElement;
    fireEvent.change(roleSel, { target: { value: "writer" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("T-06: host filter narrows to matching host", async () => {
    listWakeupsMock.mockResolvedValueOnce([
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
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={TWO_HOST_TREE}
      />,
    );
    await screen.findByText("Alpha");
    const hostSel = screen.getByTestId(
      "wakeups-modal-filter-host",
    ) as HTMLSelectElement;
    fireEvent.change(hostSel, { target: { value: "1" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).toBeNull();
  });
});

describe("WakeupsModal: form-view entry points", () => {
  it("T-07: row click → form view, edit mode, fields prefilled, Name disabled", async () => {
    listWakeupsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    const row = await screen.findByTestId("wakeups-modal-row-morning-triage");
    fireEvent.click(row);
    const nameInput = await screen.findByTestId(
      "wakeups-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Morning triage");
    expect(nameInput).toBeDisabled();
    // Host lock-chip present
    expect(screen.getByTestId("wakeups-modal-form-host-locked")).toBeInTheDocument();
  });

  it("T-08: '+' button → form view, create mode, all fields empty", async () => {
    listWakeupsMock.mockResolvedValueOnce([]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("wakeups-modal-empty-state");
    fireEvent.click(screen.getByTestId("wakeups-modal-add-button"));
    const nameInput = await screen.findByTestId(
      "wakeups-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    expect(nameInput).not.toBeDisabled();
  });
});

describe("WakeupsModal: pessimistic toggle (D-12)", () => {
  it("T-09: success flips state via refetch; failure surfaces banner + no local flip", async () => {
    // Success path
    listWakeupsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    toggleWakeupEnabledMock.mockResolvedValueOnce({
      slug: "morning-triage",
      host: 1,
      enabled: false,
    });
    listWakeupsMock.mockResolvedValueOnce([makeRow({ enabled: false })]);

    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    let toggle = await screen.findByTestId(
      "wakeups-modal-row-morning-triage-toggle",
    );
    expect(toggle.textContent).toBe("On");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggleWakeupEnabledMock).toHaveBeenCalledWith(
        "morning-triage",
        1,
        false,
      );
    });
    // After refetch, row now shows Off
    await waitFor(() => {
      toggle = screen.getByTestId(
        "wakeups-modal-row-morning-triage-toggle",
      );
      expect(toggle.textContent).toBe("Off");
    });

    // Failure path: cleanup + re-render.
    cleanup();
    toggleWakeupEnabledMock.mockReset();
    listWakeupsMock.mockReset();
    listWakeupsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    toggleWakeupEnabledMock.mockRejectedValueOnce(new Error("Boom"));

    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    toggle = await screen.findByTestId(
      "wakeups-modal-row-morning-triage-toggle",
    );
    expect(toggle.textContent).toBe("On");
    fireEvent.click(toggle);
    // Banner appears with API message verbatim
    const banner = await screen.findByTestId("wakeups-modal-toggle-error");
    expect(banner.textContent).toMatch(/Boom/);
    // Row toggle STILL says On — no local flip on failure
    toggle = screen.getByTestId("wakeups-modal-row-morning-triage-toggle");
    expect(toggle.textContent).toBe("On");
  });
});

describe("WakeupsModal: kebab menu (D-13, D-14)", () => {
  it("T-10: Kebab → Edit → same as row click (form view, edit mode)", async () => {
    listWakeupsMock.mockResolvedValueOnce([makeRow()]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("wakeups-modal-row-morning-triage");
    fireEvent.click(
      screen.getByTestId("wakeups-modal-row-morning-triage-kebab"),
    );
    const editItem = await screen.findByTestId(
      "wakeups-modal-row-morning-triage-edit",
    );
    fireEvent.click(editItem);
    const nameInput = await screen.findByTestId(
      "wakeups-modal-form-name",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Morning triage");
    expect(nameInput).toBeDisabled();
  });

  it("T-11: Kebab → Delete → window.confirm + DELETE + refetch", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);
    listWakeupsMock.mockResolvedValueOnce([makeRow()]);
    deleteWakeupMock.mockResolvedValueOnce(undefined);
    listWakeupsMock.mockResolvedValueOnce([]);

    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("wakeups-modal-row-morning-triage");
    fireEvent.click(
      screen.getByTestId("wakeups-modal-row-morning-triage-kebab"),
    );
    const deleteItem = await screen.findByTestId(
      "wakeups-modal-row-morning-triage-delete",
    );
    fireEvent.click(deleteItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete wake-up "Morning triage"?',
    );
    await waitFor(() => {
      expect(deleteWakeupMock).toHaveBeenCalledWith("morning-triage", 1);
    });
    // Row disappears after refetch
    await waitFor(() => {
      expect(
        screen.queryByTestId("wakeups-modal-row-morning-triage"),
      ).toBeNull();
    });

    confirmSpy.mockRestore();
  });
});

describe("WakeupsModal: Save + Cancel flow (D-19, D-25, D-27)", () => {
  it("T-12: Save success → refetch + return to list view", async () => {
    listWakeupsMock.mockResolvedValueOnce([]);
    createWakeupMock.mockResolvedValueOnce({
      slug: "new-wake",
      host: 1,
      spec: {},
    });
    listWakeupsMock.mockResolvedValueOnce([
      makeRow({ slug: "new-wake", name: "New wake" }),
    ]);

    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("wakeups-modal-empty-state");
    fireEvent.click(screen.getByTestId("wakeups-modal-add-button"));

    const nameInput = await screen.findByTestId(
      "wakeups-modal-form-name",
    ) as HTMLInputElement;
    const promptInput = screen.getByTestId(
      "wakeups-modal-form-prompt",
    ) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "new-wake" } });
    fireEvent.change(promptInput, { target: { value: "hello" } });

    fireEvent.click(screen.getByTestId("wakeups-modal-form-save"));

    await waitFor(() => {
      expect(createWakeupMock).toHaveBeenCalledTimes(1);
    });
    // Back to list view — row from refetch is visible
    await waitFor(() => {
      expect(screen.getByText("New wake")).toBeInTheDocument();
    });
  });

  it("T-13: Save 409 → inline banner with server message, form stays open", async () => {
    listWakeupsMock.mockResolvedValueOnce([]);
    createWakeupMock.mockRejectedValueOnce(
      new FakeApiError("Conflict", 409, "CONFLICT"),
    );
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("wakeups-modal-empty-state");
    fireEvent.click(screen.getByTestId("wakeups-modal-add-button"));

    const nameInput = await screen.findByTestId(
      "wakeups-modal-form-name",
    ) as HTMLInputElement;
    const promptInput = screen.getByTestId(
      "wakeups-modal-form-prompt",
    ) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "dup-wake" } });
    fireEvent.change(promptInput, { target: { value: "hi" } });

    fireEvent.click(screen.getByTestId("wakeups-modal-form-save"));

    const banner = await screen.findByTestId("wakeups-modal-form-error");
    expect(banner.textContent).toMatch(/already exists/i);
    // Form stays open — Save button still present.
    expect(screen.getByTestId("wakeups-modal-form-save")).toBeInTheDocument();
  });

  it("T-14: Cancel → back to list view (with refetch per Recommendation #7)", async () => {
    listWakeupsMock.mockResolvedValue([]);
    render(
      <WakeupsModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={ONE_HOST_TREE}
      />,
    );
    await screen.findByTestId("wakeups-modal-empty-state");
    // Reset the call count after the initial fetch on open so we can
    // assert Cancel triggers exactly one additional refetch.
    listWakeupsMock.mockClear();

    fireEvent.click(screen.getByTestId("wakeups-modal-add-button"));
    await screen.findByTestId("wakeups-modal-form");

    fireEvent.click(screen.getByTestId("wakeups-modal-form-cancel"));

    // Back to list view — the empty-state is visible again
    await screen.findByTestId("wakeups-modal-empty-state");
    // Cancel triggered a refetch
    expect(listWakeupsMock).toHaveBeenCalledTimes(1);
  });
});

describe("WakeupsModal: filter reset on close (D-17)", () => {
  it("T-15: closing then reopening the modal resets filter search + role + host to defaults", async () => {
    listWakeupsMock.mockResolvedValue([
      makeRow({ slug: "a", name: "Alpha", roles: ["writer"] }),
    ]);

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
          <WakeupsModal
            open={open}
            onOpenChange={setOpen}
            hostTree={ONE_HOST_TREE}
          />
        </>
      );
    }

    render(<Harness />);
    const search = (await screen.findByTestId(
      "wakeups-modal-filter-search",
    )) as HTMLInputElement;
    const roleSel = (await screen.findByTestId(
      "wakeups-modal-filter-role",
    )) as HTMLSelectElement;
    const hostSel = (await screen.findByTestId(
      "wakeups-modal-filter-host",
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
        screen.queryByTestId("wakeups-modal-filter-search"),
      ).toBeNull();
    });

    // Reopen — every filter is back to its default ("__ALL__" sentinel).
    fireEvent.click(screen.getByTestId("harness-toggle"));
    const searchAgain = (await screen.findByTestId(
      "wakeups-modal-filter-search",
    )) as HTMLInputElement;
    const roleSelAgain = (await screen.findByTestId(
      "wakeups-modal-filter-role",
    )) as HTMLSelectElement;
    const hostSelAgain = (await screen.findByTestId(
      "wakeups-modal-filter-host",
    )) as HTMLSelectElement;
    expect(searchAgain.value).toBe("");
    expect(roleSelAgain.value).toBe("__ALL__");
    expect(hostSelAgain.value).toBe("__ALL__");
  });
});
