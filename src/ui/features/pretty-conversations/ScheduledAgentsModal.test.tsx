/**
 * ScheduledAgentsModal — the scheduled tasks window, as the user drives it
 * (apple-ux shape-scheduled-tasks-modal).
 *
 * List: grouped by machine (titles only with more than one), on tasks
 * soonest-next first then switched-off ones, one search box over name /
 * roles / instructions, empty + "No matches" states, right-click menu
 * (Run now / Open / Delete…), the row switch.
 *
 * One level deeper: a task (or a new one, the same view empty) — On switch,
 * Run now button, Name, Machine (new, >1 machine), Roles, When (shared
 * schedule control incl. "Only on" days + Time zone), Instructions, Archive,
 * Delete…, Cancel / Save or Create. Back button, Esc and the X all ask
 * before dropping unsaved edits.
 *
 * Each test is a user flow: open → act → check what the user sees and what
 * was written. detectBrowserTimezone is pinned to Europe/London.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { HostFolder } from "@/types/ui-types";
import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import type { ScheduledAgentListItem } from "@/api/scheduled-agents-api";

// ─── Module-level mocks (BEFORE component import) ────────────────────────────

const listScheduledAgentsMock = vi.fn();
const createScheduledAgentMock = vi.fn();
const updateScheduledAgentMock = vi.fn();
const toggleScheduledAgentEnabledMock = vi.fn();
const deleteScheduledAgentMock = vi.fn();
const runScheduledAgentNowMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const listRolesForHostMock = vi.fn();

vi.mock("@/api/scheduled-agents-api", () => ({
  listScheduledAgents: (...args: unknown[]) => listScheduledAgentsMock(...args),
  createScheduledAgent: (...args: unknown[]) => createScheduledAgentMock(...args),
  updateScheduledAgent: (...args: unknown[]) => updateScheduledAgentMock(...args),
  toggleScheduledAgentEnabled: (...args: unknown[]) => toggleScheduledAgentEnabledMock(...args),
  deleteScheduledAgent: (...args: unknown[]) => deleteScheduledAgentMock(...args),
  runScheduledAgentNow: (...args: unknown[]) => runScheduledAgentNowMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/api/identities-api", () => ({
  listRolesForHost: (...args: unknown[]) => listRolesForHostMock(...args),
  roleAvatarUrl: (hostId: number, role: string) => `/avatars/${hostId}/${role}.png`,
}));

vi.mock("@/features/pretty-view/WakeupFormShared", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, detectBrowserTimezone: () => "Europe/London" };
});

// Radix menus (the right-click menu) measure with ResizeObserver.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

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
    colorHue: null,
    lastFiredAt: null,
    nextFireAt: null,
    ...overrides,
  };
}

const HOST_A = {
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
  // Can run agents — a new task only offers such machines.
  runsFleetSubstrate: true,
  enableVnc: false,
  enableTelnet: false,
  sshPort: 22,
  rdpPort: 3389,
  vncPort: 5900,
  telnetPort: 23,
};

function host(overrides: Record<string, unknown>): never {
  return { ...HOST_A, ...overrides } as never;
}

const ONE_HOST_TREE: HostFolder = { name: "root", children: [host({})] };
const TWO_HOST_TREE: HostFolder = { name: "root", children: [host({}), host({ id: "2", name: "host-b" })] };

/** Minimal ApiError-shape carrier — mirrors src/ui/main-axios.ts. */
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROW = (slug: string) => `scheduled-agents-modal-row-${slug}`;

function renderModal(tree: HostFolder = ONE_HOST_TREE, onOpenChange = vi.fn()) {
  render(<ScheduledAgentsModal open={true} onOpenChange={onOpenChange} hostTree={tree} />);
  return onOpenChange;
}

/** Click a row in the list and wait for the task view. */
async function openTask(slug: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(ROW(slug)));
  await screen.findByTestId("scheduled-task-view");
}

/** From the list (empty or not), open the New scheduled task view. */
async function openNew(): Promise<void> {
  fireEvent.click(await screen.findByTestId("scheduled-agents-modal-new"));
  await screen.findByTestId("scheduled-task-view");
}

function rightClick(el: Element): void {
  fireEvent.contextMenu(el, { clientX: 40, clientY: 40 });
}

/** Esc pressed somewhere in the window (not in a field). */
function pressEsc(): void {
  fireEvent.keyDown(screen.getByTestId("scheduled-agents-modal"), { key: "Escape" });
}

const nameField = () => screen.getByTestId("scheduled-task-name") as HTMLInputElement;
const promptField = () => screen.getByTestId("scheduled-task-prompt") as HTMLTextAreaElement;
const saveButton = () => screen.getByTestId("scheduled-task-save") as HTMLButtonElement;
const inTaskView = () => screen.queryByTestId("scheduled-task-view") !== null;

/** The window's title (the modal head's heading). */
function title(): string {
  return screen.getAllByRole("heading")[0].textContent ?? "";
}

beforeEach(() => {
  listScheduledAgentsMock.mockReset();
  createScheduledAgentMock.mockReset();
  updateScheduledAgentMock.mockReset();
  toggleScheduledAgentEnabledMock.mockReset();
  deleteScheduledAgentMock.mockReset();
  runScheduledAgentNowMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  listRolesForHostMock.mockReset();
  // Defaults: any read not queued by a test answers "nothing"; machines have
  // one role.
  listScheduledAgentsMock.mockResolvedValue([]);
  listRolesForHostMock.mockResolvedValue([{ name: "assistant", description: "" }]);
});

afterEach(() => {
  cleanup();
  __resetKitDialogsForTests();
});

// ─── Read path ───────────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: opening and reading", () => {
  it("renders nothing while closed, and reads once on open (loading → rows)", async () => {
    const { rerender } = render(<ScheduledAgentsModal open={false} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    expect(screen.queryByTestId("scheduled-agents-modal")).toBeNull();
    expect(listScheduledAgentsMock).not.toHaveBeenCalled();

    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    rerender(<ScheduledAgentsModal open={true} onOpenChange={vi.fn()} hostTree={ONE_HOST_TREE} />);
    expect(title()).toBe("Scheduled Tasks");
    expect(
      screen.getByText("Conversations that start themselves on a schedule, to carry out instructions you write now."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Morning triage")).toBeInTheDocument();
    expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads every 30s while open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const nowSecs = Math.floor(Date.now() / 1000);
      listScheduledAgentsMock.mockResolvedValue([makeRow({ nextFireAt: nowSecs + 10 })]);
      renderModal();
      await screen.findByTestId(ROW("morning-triage"));
      expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(listScheduledAgentsMock).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("an open task deleted elsewhere says it's gone once its machine answers without it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listScheduledAgentsMock.mockResolvedValueOnce([makeRow(), makeRow({ slug: "other", name: "Other" })]);
      renderModal();
      await openTask("morning-triage");
      // Its machine answers, without it.
      listScheduledAgentsMock.mockResolvedValue([makeRow({ slug: "other", name: "Other" })]);
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(await screen.findByText("This scheduled task is gone.")).toBeInTheDocument();
      expect(screen.queryByTestId("scheduled-task-view")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed load shows the error banner", async () => {
    listScheduledAgentsMock.mockRejectedValueOnce(new Error("fleet unreachable"));
    renderModal();
    expect(await screen.findByTestId("scheduled-agents-modal-load-error")).toHaveTextContent("fleet unreachable");
  });

  it("slug-shaped names show prettified, and search matches either form", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ slug: "daily-box-check", name: "daily-box-check" })]);
    renderModal();
    await screen.findByText("Daily box check");
    expect(screen.queryByText("daily-box-check")).toBeNull();
    const search = screen.getByTestId("scheduled-agents-modal-filter-search");
    const user = userEvent.setup();
    await user.type(search, "daily-box");
    expect(screen.getByText("Daily box check")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "box check");
    expect(screen.getByText("Daily box check")).toBeInTheDocument();
  });
});

// ─── List: groups, order, rows ───────────────────────────────────────────────

describe("ScheduledAgentsModal: the list", () => {
  it("groups tasks by machine, titled with the machine and its count, only when there's more than one", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "alpha", name: "Alpha" }),
      makeRow({ slug: "beta", name: "Beta" }),
      makeRow({ slug: "gamma", name: "Gamma", host: "host-b", hostId: 2 }),
    ]);
    renderModal(TWO_HOST_TREE);
    const groupA = await screen.findByTestId("scheduled-agents-modal-group-host-a");
    const groupB = screen.getByTestId("scheduled-agents-modal-group-host-b");
    expect(within(groupA).getByRole("heading")).toHaveTextContent("host-a");
    expect(within(groupA).getByRole("heading")).toHaveTextContent("2 tasks");
    expect(within(groupB).getByRole("heading")).toHaveTextContent("host-b");
    expect(within(groupB).getByRole("heading")).toHaveTextContent("1 task");
    expect(within(groupA).getByTestId(ROW("alpha"))).toBeInTheDocument();
    expect(within(groupA).getByTestId(ROW("beta"))).toBeInTheDocument();
    expect(within(groupB).getByTestId(ROW("gamma"))).toBeInTheDocument();
    cleanup();

    // One machine → one untitled group.
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ slug: "alpha", name: "Alpha" })]);
    renderModal(ONE_HOST_TREE);
    const only = await screen.findByTestId("scheduled-agents-modal-group-host-a");
    expect(within(only).queryByRole("heading")).toBeNull();
    expect(only).not.toHaveTextContent("1 task");
  });

  it("orders on tasks soonest-next first (no next time after those), then the switched-off ones", async () => {
    const now = Math.floor(Date.now() / 1000);
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({ slug: "a", name: "A later", nextFireAt: now + 3 * 3600 }),
      makeRow({ slug: "c", name: "C off soon", enabled: false, nextFireAt: now + 60 }),
      makeRow({ slug: "d", name: "D no next", nextFireAt: null }),
      makeRow({ slug: "b", name: "B soonest", nextFireAt: now + 600 }),
      makeRow({ slug: "e", name: "E off", enabled: false, nextFireAt: null }),
    ]);
    renderModal();
    await screen.findByTestId(ROW("a"));
    const order = screen.getAllByTestId(/^scheduled-agents-modal-row-[a-e]$/).map((el) => el.dataset.testid);
    expect(order).toEqual([ROW("b"), ROW("a"), ROW("d"), ROW("c"), ROW("e")]);
    // Off rows say Off instead of a next run.
    expect(screen.getByTestId(`${ROW("c")}-when`)).toHaveTextContent("Off");
    expect(screen.getByTestId(`${ROW("c")}-when`)).not.toHaveTextContent("Next");
  });

  it("a row shows the schedule without \"(box-local)\", the next run and one line of instructions", async () => {
    const now = Math.floor(Date.now() / 1000);
    listScheduledAgentsMock.mockResolvedValueOnce([
      makeRow({
        scheduleHuman: "Daily at 11:30 (box-local)",
        nextFireAt: now + 630,
        prompt: "Read the inbox.\n\nThen summarise it.",
      }),
    ]);
    renderModal();
    const when = await screen.findByTestId(`${ROW("morning-triage")}-when`);
    expect(when).toHaveTextContent(/^Daily at 11:30\s*·\s*Next in 10m$/);
    expect(when).not.toHaveTextContent("box-local");
    expect(screen.getByTestId(`${ROW("morning-triage")}-prompt`).textContent).toBe("Read the inbox. Then summarise it.");
    // No three-dots button on the row.
    expect(screen.queryByTestId(`${ROW("morning-triage")}-kebab`)).toBeNull();

    // The task view's On note drops it too.
    await openTask("morning-triage");
    expect(screen.getByTestId("scheduled-task-on-note")).toHaveTextContent("Daily at 11:30");
    expect(screen.getByTestId("scheduled-task-on-note")).not.toHaveTextContent("box-local");
  });

  it("the empty list says so, and its New scheduled task button opens the new-task view", async () => {
    renderModal();
    const empty = await screen.findByTestId("scheduled-agents-modal-empty-state");
    expect(empty).toHaveTextContent("No scheduled tasks");
    // No search box with nothing to search.
    expect(screen.queryByTestId("scheduled-agents-modal-filter-search")).toBeNull();
    fireEvent.click(within(empty).getByTestId("scheduled-agents-modal-add-button"));
    await screen.findByTestId("scheduled-task-view");
    expect(title()).toBe("New scheduled task");
    expect(screen.getByText("Starts a conversation on a schedule")).toBeInTheDocument();
    expect(nameField().value).toBe("");
    expect(nameField()).not.toBeDisabled();
    expect(promptField().value).toBe("");
    expect(saveButton().textContent).toBe("Create");
    // On by default; no Run now or Delete for a task that doesn't exist yet.
    expect((screen.getByTestId("scheduled-task-enabled") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("scheduled-task-run-now")).toBeNull();
    expect(screen.queryByTestId("scheduled-task-delete")).toBeNull();
  });
});

// ─── Search ──────────────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: search", () => {
  const ROWS = () => [
    makeRow({ slug: "triage", name: "Morning triage", prompt: "check the inbox", roles: ["assistant"] }),
    makeRow({ slug: "sweep", name: "Log sweep", prompt: "rotate nginx logs", roles: ["box-maintainer"] }),
    makeRow({ slug: "digest", name: "Weekly digest", prompt: "write a summary", roles: [], host: "host-b", hostId: 2 }),
  ];

  it("finds a role by the display name its machine gives it, not just its slug", async () => {
    listRolesForHostMock.mockImplementation((id: number) =>
      Promise.resolve(id === 1 ? [{ name: "box-maintainer", displayName: "thenasty", description: "" }] : []),
    );
    listScheduledAgentsMock.mockResolvedValueOnce(ROWS());
    renderModal(TWO_HOST_TREE);
    await screen.findByTestId(ROW("triage"));
    await waitFor(() => expect(listRolesForHostMock).toHaveBeenCalledWith(1));
    const user = userEvent.setup();
    await user.type(screen.getByTestId("scheduled-agents-modal-filter-search"), "thenasty");
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^scheduled-agents-modal-row-[a-z]+$/).map((el) => el.dataset.testid)).toEqual([
        ROW("sweep"),
      ]),
    );
  });

  it("matches names, roles (slug or display name) and instructions; nothing → No matches", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce(ROWS());
    renderModal(TWO_HOST_TREE);
    await screen.findByTestId(ROW("triage"));
    const search = screen.getByTestId("scheduled-agents-modal-filter-search");
    const user = userEvent.setup();
    const visible = () => screen.queryAllByTestId(/^scheduled-agents-modal-row-[a-z]+$/).map((el) => el.dataset.testid);

    // Name, case-insensitive.
    await user.type(search, "LOG");
    expect(visible()).toEqual([ROW("sweep")]);

    // A role, by its display name.
    await user.clear(search);
    await user.type(search, "box maintainer");
    expect(visible()).toEqual([ROW("sweep")]);
    // …and by its slug.
    await user.clear(search);
    await user.type(search, "assistant");
    expect(visible()).toEqual([ROW("triage")]);

    // Instructions.
    await user.clear(search);
    await user.type(search, "summary");
    expect(visible()).toEqual([ROW("digest")]);
    // A machine with no hits drops out of the list.
    expect(screen.queryByTestId("scheduled-agents-modal-group-host-a")).toBeNull();

    // Every word must match.
    await user.clear(search);
    await user.type(search, "inbox nginx");
    expect(visible()).toEqual([]);
    const none = screen.getByTestId("scheduled-agents-modal-no-matches");
    expect(none).toHaveTextContent("No matches");
    expect(none).toHaveTextContent("inbox nginx");

    // Clearing brings everything back.
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(visible()).toHaveLength(3);
    expect(screen.queryByTestId("scheduled-agents-modal-no-matches")).toBeNull();
  });

  it("there are no role or host dropdowns", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce(ROWS());
    renderModal(TWO_HOST_TREE);
    await screen.findByTestId(ROW("triage"));
    expect(screen.queryByTestId("scheduled-agents-modal-filter-role")).toBeNull();
    expect(screen.queryByTestId("scheduled-agents-modal-filter-host")).toBeNull();
    expect(within(screen.getByTestId("scheduled-agents-modal")).queryAllByRole("combobox")).toHaveLength(0);
  });
});

// ─── Switch ──────────────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: the on/off switch is pessimistic", () => {
  it("success flips it via the re-read; failure shows a banner and leaves it", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    toggleScheduledAgentEnabledMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, enabled: false });
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: false })]);
    renderModal();
    const toggle = () => screen.getByTestId(`${ROW("morning-triage")}-toggle`) as HTMLInputElement;
    await screen.findByTestId(`${ROW("morning-triage")}-toggle`);
    expect(toggle().checked).toBe(true);
    fireEvent.click(toggle());
    await waitFor(() => expect(toggleScheduledAgentEnabledMock).toHaveBeenCalledWith("morning-triage", 1, false));
    await waitFor(() => expect(toggle().checked).toBe(false));
    // The switch never opens the task.
    expect(inTaskView()).toBe(false);
    cleanup();

    toggleScheduledAgentEnabledMock.mockReset();
    listScheduledAgentsMock.mockReset();
    listScheduledAgentsMock.mockResolvedValue([makeRow({ enabled: true })]);
    toggleScheduledAgentEnabledMock.mockRejectedValueOnce(new Error("Boom"));
    renderModal();
    await screen.findByTestId(`${ROW("morning-triage")}-toggle`);
    fireEvent.click(toggle());
    const banner = await screen.findByTestId("scheduled-agents-modal-write-error");
    expect(banner).toHaveTextContent("Couldn't turn “Morning triage” off: Boom");
    expect(toggle().checked).toBe(true);
  });

  it("the task view's On switch saves at once and follows the re-read", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    toggleScheduledAgentEnabledMock.mockResolvedValueOnce(undefined);
    listScheduledAgentsMock.mockResolvedValue([makeRow({ enabled: false })]);
    renderModal();
    await openTask("morning-triage");
    const on = screen.getByTestId("scheduled-task-enabled") as HTMLInputElement;
    expect(on.checked).toBe(true);
    fireEvent.click(on);
    await waitFor(() => expect(toggleScheduledAgentEnabledMock).toHaveBeenCalledWith("morning-triage", 1, false));
    await waitFor(() => expect((screen.getByTestId("scheduled-task-enabled") as HTMLInputElement).checked).toBe(false));
    expect(screen.getByTestId("scheduled-task-on-note")).toHaveTextContent("Off — it won't run · Daily at 9:00");
    // Not an unsaved edit: back goes straight to the list without asking.
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-back"));
    await waitFor(() => expect(inTaskView()).toBe(false));
    expect(dialogs.calls).toHaveLength(0);
    expect(updateScheduledAgentMock).not.toHaveBeenCalled();
  });

  it("Save waits while the On switch is still saving, and then writes the new on/off", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ enabled: true })]);
    let finishToggle: () => void = () => {};
    toggleScheduledAgentEnabledMock.mockReturnValueOnce(new Promise<void>((r) => (finishToggle = r)));
    // The re-read after the switch leaves the machine out (it didn't answer).
    listScheduledAgentsMock.mockResolvedValue([]);
    updateScheduledAgentMock.mockResolvedValue(undefined);
    renderModal();
    await openTask("morning-triage");
    fireEvent.change(promptField(), { target: { value: "check inbox twice" } });
    fireEvent.click(screen.getByTestId("scheduled-task-enabled"));
    await waitFor(() => expect(toggleScheduledAgentEnabledMock).toHaveBeenCalled());
    expect(saveButton()).toBeDisabled();
    await act(async () => finishToggle());
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].enabled).toBe(false);
  });

  it("a failed On switch in the task view shows the error there and stays put", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow({ enabled: true })]);
    toggleScheduledAgentEnabledMock.mockRejectedValueOnce(new Error("host down"));
    renderModal();
    await openTask("morning-triage");
    fireEvent.click(screen.getByTestId("scheduled-task-enabled"));
    expect(await screen.findByTestId("scheduled-task-error")).toHaveTextContent("host down");
    expect((screen.getByTestId("scheduled-task-enabled") as HTMLInputElement).checked).toBe(true);
  });
});

// ─── Same slug on two machines ───────────────────────────────────────────────

describe("ScheduledAgentsModal: same slug on two machines", () => {
  it("opening the second machine's row opens THAT task, and its switch writes to that machine", async () => {
    listScheduledAgentsMock.mockResolvedValue([
      makeRow({ host: "host-a", hostId: 1, prompt: "host A prompt" }),
      makeRow({ host: "host-b", hostId: 2, prompt: "host B prompt" }),
    ]);
    toggleScheduledAgentEnabledMock.mockResolvedValue(undefined);
    renderModal(TWO_HOST_TREE);
    const groupB = await screen.findByTestId("scheduled-agents-modal-group-host-b");
    expect(screen.getAllByTestId(ROW("morning-triage"))).toHaveLength(2);

    fireEvent.click(within(groupB).getByTestId(`${ROW("morning-triage")}-toggle`));
    await waitFor(() => expect(toggleScheduledAgentEnabledMock).toHaveBeenCalledWith("morning-triage", 2, false));

    fireEvent.click(within(screen.getByTestId("scheduled-agents-modal-group-host-b")).getByTestId(ROW("morning-triage")));
    await screen.findByTestId("scheduled-task-view");
    expect(promptField().value).toBe("host B prompt");
    expect(screen.getByText("On host-b")).toBeInTheDocument();
  });
});

// ─── Right-click menu ────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: right-click menu", () => {
  it("Open opens the task one level deeper", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    renderModal();
    rightClick(await screen.findByTestId(ROW("morning-triage")));
    await user.click(await screen.findByTestId(`${ROW("morning-triage")}-open`));
    await screen.findByTestId("scheduled-task-view");
    expect(title()).toBe("Morning triage");
    expect(screen.getByText("On host-a")).toBeInTheDocument();
    expect(nameField().value).toBe("Morning triage");
    expect(nameField()).toBeDisabled();
    expect(screen.getByText("To rename it, delete it and create a new one.")).toBeInTheDocument();
    expect(saveButton().textContent).toBe("Save");
    expect(saveButton()).toBeDisabled();
  });

  it("Delete… asks, deletes on that machine and the row goes", async () => {
    const user = userEvent.setup();
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    deleteScheduledAgentMock.mockResolvedValueOnce(undefined);
    listScheduledAgentsMock.mockResolvedValueOnce([]);
    renderModal();
    rightClick(await screen.findByTestId(ROW("morning-triage")));
    await user.click(await screen.findByTestId(`${ROW("morning-triage")}-delete`));
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].kind).toBe("confirm");
    expect(dialogs.calls[0].opts.title).toBe('Delete "Morning triage"?');
    await waitFor(() => expect(deleteScheduledAgentMock).toHaveBeenCalledWith("morning-triage", 1));
    await waitFor(() => expect(screen.queryByTestId(ROW("morning-triage"))).toBeNull());
  });

  it("Delete… answered No deletes nothing", async () => {
    const user = userEvent.setup();
    autoAnswerKitDialogs({ confirm: false });
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    renderModal();
    rightClick(await screen.findByTestId(ROW("morning-triage")));
    await user.click(await screen.findByTestId(`${ROW("morning-triage")}-delete`));
    await new Promise((r) => setTimeout(r, 0));
    expect(deleteScheduledAgentMock).not.toHaveBeenCalled();
    expect(screen.getByTestId(ROW("morning-triage"))).toBeInTheDocument();
  });

  it("Run now starts it and says so", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    runScheduledAgentNowMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, requestId: "x" });
    renderModal();
    rightClick(await screen.findByTestId(ROW("morning-triage")));
    await user.click(await screen.findByTestId(`${ROW("morning-triage")}-run-now`));
    await waitFor(() => expect(runScheduledAgentNowMock).toHaveBeenCalledWith("morning-triage", 1));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledTimes(1));
    expect(String(toastSuccessMock.mock.calls[0][0])).toContain("Morning triage");
    expect(screen.queryByTestId("scheduled-agents-modal-write-error")).toBeNull();
    // Running it doesn't open it.
    expect(inTaskView()).toBe(false);
  });

  it("Run now failing shows the server's message in the banner", async () => {
    const user = userEvent.setup();
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow()]);
    runScheduledAgentNowMock.mockRejectedValueOnce(new FakeApiError("host unreachable", 502));
    renderModal();
    rightClick(await screen.findByTestId(ROW("morning-triage")));
    await user.click(await screen.findByTestId(`${ROW("morning-triage")}-run-now`));
    expect(await screen.findByTestId("scheduled-agents-modal-write-error")).toHaveTextContent("host unreachable");
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("a one-time task offers no Run now (firing it early would use it up) — in the menu or its view", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow({ schedule: { type: "one_shot", at: "2030-01-01T09:00" } })]);
    renderModal();
    rightClick(await screen.findByTestId(ROW("morning-triage")));
    await screen.findByTestId(`${ROW("morning-triage")}-open`);
    expect(screen.getByTestId(`${ROW("morning-triage")}-delete`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${ROW("morning-triage")}-run-now`)).toBeNull();
    cleanup();

    renderModal();
    await openTask("morning-triage");
    expect(screen.queryByTestId("scheduled-task-run-now")).toBeNull();
    // Its time is in your time zone; there's no Time zone field for it.
    expect(screen.getByText(/The time above is in your time zone \(Europe\/London\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("scheduled-task-tz")).toBeNull();
  });
});

// ─── Run now button in the task view ─────────────────────────────────────────

describe("ScheduledAgentsModal: Run now in the task view", () => {
  it("is a button that reads Starting… while it goes, then says it started", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    let finish: (v: unknown) => void = () => {};
    runScheduledAgentNowMock.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    renderModal();
    await openTask("morning-triage");
    expect(screen.getByText("Start a conversation for it right away. The schedule carries on as usual.")).toBeInTheDocument();
    const btn = screen.getByTestId("scheduled-task-run-now") as HTMLButtonElement;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveTextContent("Run now");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("scheduled-task-run-now")).toHaveTextContent("Starting…"));
    expect(screen.getByTestId("scheduled-task-run-now")).toBeDisabled();
    expect(runScheduledAgentNowMock).toHaveBeenCalledWith("morning-triage", 1);
    // A second click while it's going starts nothing.
    fireEvent.click(screen.getByTestId("scheduled-task-run-now"));
    expect(runScheduledAgentNowMock).toHaveBeenCalledTimes(1);

    await act(async () => finish({ slug: "morning-triage", host: 1, requestId: "x" }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledTimes(1));
    expect(String(toastSuccessMock.mock.calls[0][0])).toContain("Morning triage");
    expect(screen.getByTestId("scheduled-task-run-now")).toHaveTextContent("Run now");
    // Still in the task — running it isn't leaving it.
    expect(inTaskView()).toBe(true);
  });

  it("a failed Run now from the task view says so", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    runScheduledAgentNowMock.mockRejectedValueOnce(new Error("no capacity"));
    renderModal();
    await openTask("morning-triage");
    fireEvent.click(screen.getByTestId("scheduled-task-run-now"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(String(toastErrorMock.mock.calls[0][0])).toContain("no capacity");
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

// ─── Navigation: back, Esc, discard ──────────────────────────────────────────

describe("ScheduledAgentsModal: back, Esc and unsaved changes", () => {
  it("the back button returns to the list and re-reads it", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    renderModal();
    await openTask("morning-triage");
    const back = screen.getByTestId("scheduled-agents-modal-back");
    expect(back).toHaveAccessibleName("Back to Scheduled Tasks");
    listScheduledAgentsMock.mockClear();
    fireEvent.click(back);
    await screen.findByTestId(ROW("morning-triage"));
    expect(inTaskView()).toBe(false);
    expect(title()).toBe("Scheduled Tasks");
    expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("Cancel on an untouched new task goes back without asking", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    renderModal();
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    listScheduledAgentsMock.mockClear();
    await openNew();
    fireEvent.click(screen.getByTestId("scheduled-task-cancel"));
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    expect(dialogs.calls).toHaveLength(0);
    expect(listScheduledAgentsMock).toHaveBeenCalledTimes(1);
  });

  it("Esc: back from a task, then clears the search, then closes the window", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow(), makeRow({ slug: "log-sweep", name: "Log sweep" })]);
    const onOpenChange = renderModal();
    const user = userEvent.setup();
    await screen.findByTestId(ROW("log-sweep"));
    await user.type(screen.getByTestId("scheduled-agents-modal-filter-search"), "triage");
    expect(screen.queryByTestId(ROW("log-sweep"))).toBeNull();
    await openTask("morning-triage");

    // 1: back to the list, the search still there.
    pressEsc();
    await screen.findByTestId(ROW("morning-triage"));
    expect(inTaskView()).toBe(false);
    expect((screen.getByTestId("scheduled-agents-modal-filter-search") as HTMLInputElement).value).toBe("triage");
    expect(onOpenChange).not.toHaveBeenCalled();

    // 2: clears the search.
    pressEsc();
    await waitFor(() =>
      expect((screen.getByTestId("scheduled-agents-modal-filter-search") as HTMLInputElement).value).toBe(""),
    );
    expect(screen.getByTestId(ROW("log-sweep"))).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    // 3: closes.
    pressEsc();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("leaving a task with unsaved edits asks \"Discard your changes?\" — by back, Cancel, Esc and the X", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    const onOpenChange = renderModal();
    await openTask("morning-triage");
    fireEvent.change(promptField(), { target: { value: "edited" } });
    expect(saveButton()).not.toBeDisabled();

    // Keep editing — every way out stays put, edits intact.
    const keep = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-back"));
    fireEvent.click(screen.getByTestId("scheduled-task-cancel"));
    pressEsc();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(keep.calls).toHaveLength(4));
    for (const c of keep.calls) {
      expect(c.kind).toBe("confirm");
      expect(c.opts.title).toBe("Discard your changes?");
    }
    expect(inTaskView()).toBe(true);
    expect(promptField().value).toBe("edited");
    expect(onOpenChange).not.toHaveBeenCalled();

    // Discard → back to the list, nothing written.
    const discard = autoAnswerKitDialogs({ confirm: true });
    fireEvent.click(screen.getByTestId("scheduled-agents-modal-back"));
    await screen.findByTestId(ROW("morning-triage"));
    expect(discard.calls).toHaveLength(1);
    expect(updateScheduledAgentMock).not.toHaveBeenCalled();

    // Reopened: the edit is gone.
    await openTask("morning-triage");
    expect(promptField().value).toBe("check inbox");
  });

  it("the X on a new task with something typed asks, and closes the window on Discard", async () => {
    const onOpenChange = renderModal();
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    await openNew();
    fireEvent.change(nameField(), { target: { value: "half-done" } });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(createScheduledAgentMock).not.toHaveBeenCalled();
  });

  it("closing and reopening the window starts over: the list, no search", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow({ slug: "a", name: "Alpha", roles: ["writer"] })]);
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-testid="harness-toggle" onClick={() => setOpen((o) => !o)}>
            toggle
          </button>
          <ScheduledAgentsModal open={open} onOpenChange={setOpen} hostTree={TWO_HOST_TREE} />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.type(await screen.findByTestId("scheduled-agents-modal-filter-search"), "alp");
    await openTask("a");

    fireEvent.click(screen.getByTestId("harness-toggle"));
    await waitFor(() => expect(screen.queryByTestId("scheduled-agents-modal")).toBeNull());
    fireEvent.click(screen.getByTestId("harness-toggle"));
    const search = (await screen.findByTestId("scheduled-agents-modal-filter-search")) as HTMLInputElement;
    expect(search.value).toBe("");
    expect(inTaskView()).toBe(false);
    expect(title()).toBe("Scheduled Tasks");
  });
});

// ─── Save / create ───────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: creating", () => {
  it("New → fill in → Create writes the task, goes back, and the row shows at once (before the re-read lands)", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "fresh-agent", host: 1, spec: {} });
    renderModal();
    await screen.findByTestId("scheduled-agents-modal-empty-state");
    // The re-read after Create never answers within this test.
    let release: (rows: ScheduledAgentListItem[]) => void = () => {};
    listScheduledAgentsMock.mockImplementationOnce(() => new Promise<ScheduledAgentListItem[]>((r) => (release = r)));
    await openNew();

    // One machine → no machine list, roles straight away.
    expect(screen.queryByTestId("scheduled-task-machines")).toBeNull();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(nameField(), { target: { value: "fresh-agent" } });
    fireEvent.change(promptField(), { target: { value: "  do stuff  " } });
    fireEvent.click(await screen.findByTestId("scheduled-task-role-addable-assistant"));
    expect(screen.getByTestId("scheduled-task-role-selected-assistant")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("scheduled-task-archive-if-nothing-to-report"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    const [hostId, spec] = createScheduledAgentMock.mock.calls[0];
    expect(hostId).toBe(1);
    expect(spec).toEqual({
      name: "fresh-agent",
      prompt: "do stuff",
      schedule: { type: "daily", at: "09:00", timezone: "Europe/London" },
      roles: ["assistant"],
      enabled: true,
      archive_if_nothing_to_report: true,
    });
    // Back on the list with the new row from the splice.
    expect(await screen.findByTestId(ROW("fresh-agent"))).toHaveTextContent("Fresh agent");
    expect(inTaskView()).toBe(false);
    await act(async () => release([makeRow({ slug: "fresh-agent", name: "fresh-agent" })]));
  });

  it("a new task can be created switched off", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "later", host: 1, spec: {} });
    renderModal();
    await openNew();
    fireEvent.click(screen.getByTestId("scheduled-task-enabled"));
    expect(screen.getByTestId("scheduled-task-on-note")).toHaveTextContent("It's created switched off.");
    fireEvent.change(nameField(), { target: { value: "later" } });
    fireEvent.change(promptField(), { target: { value: "x" } });
    fireEvent.click(await screen.findByTestId("scheduled-task-no-roles"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][1].enabled).toBe(false);
  });

  it("a name that already exists (409) shows the error and the view stays open with what was typed", async () => {
    createScheduledAgentMock.mockRejectedValueOnce(new FakeApiError("Conflict", 409, "CONFLICT"));
    renderModal();
    await openNew();
    fireEvent.change(nameField(), { target: { value: "dup-agent" } });
    fireEvent.change(promptField(), { target: { value: "hi" } });
    fireEvent.click(await screen.findByTestId("scheduled-task-role-addable-assistant"));
    fireEvent.click(saveButton());
    const banner = await screen.findByTestId("scheduled-task-error");
    expect(banner).toHaveTextContent('A scheduled task named "dup-agent" already exists on this machine');
    expect(inTaskView()).toBe(true);
    expect(nameField().value).toBe("dup-agent");
    expect(saveButton()).toHaveTextContent("Create");
    expect(saveButton()).not.toBeDisabled();
  });

  it("offers only machines that can run agents, needs one picked, then loads its roles and writes to it", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "on-b", host: 3, spec: {} });
    listRolesForHostMock.mockImplementation((id: number) =>
      Promise.resolve(id === 3 ? [{ name: "ops", description: "" }] : [{ name: "assistant", description: "" }]),
    );
    const tree: HostFolder = {
      name: "root",
      children: [
        host({}),
        host({ id: "2", name: "winbox", runsFleetSubstrate: false }),
        host({ id: "3", name: "fleet-b" }),
        host({ id: "4", name: "rdp-box", enableRdp: true }),
      ],
    };
    renderModal(tree);
    await openNew();
    const machines = screen.getByTestId("scheduled-task-machines");
    expect(within(machines).getByTestId("scheduled-task-machine-1")).toHaveTextContent("host-a");
    expect(within(machines).getByTestId("scheduled-task-machine-3")).toHaveTextContent("fleet-b");
    expect(screen.queryByTestId("scheduled-task-machine-2")).toBeNull();
    expect(screen.queryByTestId("scheduled-task-machine-4")).toBeNull();
    // No machine yet → no roles to pick, can't create.
    expect(screen.queryByTestId("scheduled-task-roles")).toBeNull();
    fireEvent.change(nameField(), { target: { value: "on-b" } });
    fireEvent.change(promptField(), { target: { value: "x" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByTestId("scheduled-task-machine-3"));
    expect(within(screen.getByTestId("scheduled-task-machine-3")).getByLabelText("Picked")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("scheduled-task-role-addable-ops"));
    expect(listRolesForHostMock).toHaveBeenCalledWith(3);

    // Switching machine drops the roles picked for the other one.
    fireEvent.click(screen.getByTestId("scheduled-task-machine-1"));
    await screen.findByTestId("scheduled-task-role-addable-assistant");
    expect(screen.queryByTestId("scheduled-task-role-selected-ops")).toBeNull();
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByTestId("scheduled-task-machine-3"));
    fireEvent.click(await screen.findByTestId("scheduled-task-role-addable-ops"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][0]).toBe(3);
    expect(createScheduledAgentMock.mock.calls[0][1].roles).toEqual(["ops"]);
  });

  it("no machine can run agents → the new task says so and can't be created", async () => {
    const tree: HostFolder = { name: "root", children: [host({ id: "2", name: "winbox", runsFleetSubstrate: false })] };
    renderModal(tree);
    await openNew();
    expect(screen.getByTestId("scheduled-task-no-machines")).toHaveTextContent("None of your machines can run agents");
    expect(screen.queryByTestId("scheduled-task-machines")).toBeNull();
    fireEvent.change(nameField(), { target: { value: "x" } });
    fireEvent.change(promptField(), { target: { value: "x" } });
    expect(saveButton()).toBeDisabled();
  });

  it("one machine that can run agents (plus one that can't) → it's picked, no machine list", async () => {
    const tree: HostFolder = {
      name: "root",
      children: [host({}), host({ id: "2", name: "winbox", runsFleetSubstrate: false })],
    };
    renderModal(tree);
    await openNew();
    await screen.findByTestId("scheduled-task-no-roles");
    expect(screen.queryByTestId("scheduled-task-machines")).toBeNull();
    expect(screen.queryByText("winbox")).toBeNull();
    expect(listRolesForHostMock).toHaveBeenCalledWith(1);
  });

  it("the schedule kinds read Daily / Weekly / Monthly / Yearly / Every… / Once, Daily first", async () => {
    renderModal();
    await openNew();
    const kinds = within(screen.getByRole("group", { name: "Schedule type" })).getAllByRole("button");
    expect(kinds.map((b) => b.textContent)).toEqual(["Daily", "Weekly", "Monthly", "Yearly", "Every…", "Once"]);
    expect(screen.getByTestId("scheduled-task-type-daily")).toHaveAttribute("aria-pressed", "true");
    // Every… is the interval kind.
    fireEvent.click(screen.getByTestId("scheduled-task-type-interval"));
    expect(screen.getByLabelText("Every")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit")).toBeInTheDocument();
  });
});

describe("ScheduledAgentsModal: editing", () => {
  it("Save is enabled once something changed, writes the edit, and the row updates at once (before the re-read)", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ prompt: "old prompt" })]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    let release: (rows: ScheduledAgentListItem[]) => void = () => {};
    listScheduledAgentsMock.mockImplementationOnce(() => new Promise<ScheduledAgentListItem[]>((r) => (release = r)));
    renderModal();
    expect(await screen.findByTestId(ROW("morning-triage"))).toHaveTextContent("old prompt");
    await openTask("morning-triage");
    expect(promptField().value).toBe("old prompt");
    expect(saveButton()).toBeDisabled();
    fireEvent.change(promptField(), { target: { value: "new prompt" } });
    expect(saveButton()).not.toBeDisabled();
    // Typing it back is no change.
    fireEvent.change(promptField(), { target: { value: "old prompt" } });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(promptField(), { target: { value: "new prompt" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    const [slug, hostId, spec] = updateScheduledAgentMock.mock.calls[0];
    expect([slug, hostId]).toEqual(["morning-triage", 1]);
    expect(spec).toMatchObject({ name: "Morning triage", prompt: "new prompt", roles: ["assistant"], enabled: true });
    const row = await screen.findByTestId(ROW("morning-triage"));
    expect(row).toHaveTextContent("new prompt");
    expect(row).not.toHaveTextContent("old prompt");
    await act(async () => release([]));
  });

  it("a failed save keeps the view open with the error", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow()]);
    updateScheduledAgentMock.mockRejectedValueOnce(new FakeApiError("bad schedule: at", 400));
    renderModal();
    await openTask("morning-triage");
    fireEvent.change(promptField(), { target: { value: "edited" } });
    fireEvent.click(saveButton());
    expect(await screen.findByTestId("scheduled-task-error")).toHaveTextContent("bad schedule: at");
    expect(inTaskView()).toBe(true);
  });

  it("Delete scheduled task… asks, deletes, and goes back to a list without it", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow(), makeRow({ slug: "other", name: "Other" })]);
    listScheduledAgentsMock.mockResolvedValue([makeRow({ slug: "other", name: "Other" })]);
    deleteScheduledAgentMock.mockResolvedValueOnce(undefined);
    renderModal();
    await openTask("morning-triage");
    fireEvent.change(promptField(), { target: { value: "edited first" } });
    fireEvent.click(screen.getByTestId("scheduled-task-delete"));
    await waitFor(() => expect(deleteScheduledAgentMock).toHaveBeenCalledWith("morning-triage", 1));
    await screen.findByTestId(ROW("other"));
    expect(screen.queryByTestId(ROW("morning-triage"))).toBeNull();
    // Only the delete was asked about — not "discard your changes" as well.
    expect(dialogs.calls.map((c) => c.opts.title)).toEqual(['Delete "Morning triage"?']);
  });
});

// ─── Roles ───────────────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: roles", () => {
  it("\"No roles\" leads and must be picked deliberately; then Create writes roles: []", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "no-roles", host: 1, spec: {} });
    renderModal();
    await openNew();
    fireEvent.change(nameField(), { target: { value: "no-roles" } });
    fireEvent.change(promptField(), { target: { value: "x" } });
    await screen.findByTestId("scheduled-task-role-addable-assistant");
    const chips = within(screen.getByTestId("scheduled-task-roles")).getAllByRole("button");
    expect(chips[0]).toHaveTextContent("No roles");
    const noRoles = screen.getByTestId("scheduled-task-no-roles");
    expect(noRoles).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("scheduled-task-roles-hint")).toHaveTextContent("Pick roles, or No roles.");
    expect(saveButton()).toBeDisabled();

    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("scheduled-task-roles-hint")).toBeNull();
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][1].roles).toEqual([]);
  });

  it("\"No roles\" and roles exclude each other; unticking the last role leaves nothing picked", async () => {
    listRolesForHostMock.mockResolvedValue([
      { name: "assistant", description: "" },
      { name: "ops", description: "" },
    ]);
    renderModal();
    await openNew();
    fireEvent.change(nameField(), { target: { value: "x" } });
    fireEvent.change(promptField(), { target: { value: "x" } });
    const noRoles = await screen.findByTestId("scheduled-task-no-roles");

    fireEvent.click(noRoles);
    fireEvent.click(await screen.findByTestId("scheduled-task-role-addable-assistant"));
    expect(noRoles).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("scheduled-task-role-selected-assistant")).toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("scheduled-task-role-addable-ops"));
    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("scheduled-task-role-selected-assistant")).toBeNull();
    expect(screen.queryByTestId("scheduled-task-role-selected-ops")).toBeNull();

    fireEvent.click(screen.getByTestId("scheduled-task-role-addable-ops"));
    fireEvent.click(screen.getByTestId("scheduled-task-role-selected-ops"));
    expect(noRoles).toHaveAttribute("aria-pressed", "false");
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId("scheduled-task-roles-hint")).toBeInTheDocument();

    fireEvent.click(noRoles);
    fireEvent.click(noRoles);
    expect(noRoles).toHaveAttribute("aria-pressed", "false");
    expect(saveButton()).toBeDisabled();
  });

  it("a task saved with roles: [] opens with \"No roles\" picked and saves roles: []", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ roles: [] })]);
    updateScheduledAgentMock.mockResolvedValueOnce({});
    renderModal();
    await openTask("morning-triage");
    expect(await screen.findByTestId("scheduled-task-no-roles")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(promptField(), { target: { value: "edited" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].roles).toEqual([]);
  });

  it("a task with roles opens with them picked, not \"No roles\" — even one the machine no longer lists", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ roles: ["assistant", "retired-role"] })]);
    renderModal();
    await openTask("morning-triage");
    expect(await screen.findByTestId("scheduled-task-no-roles")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("scheduled-task-role-selected-assistant")).toBeInTheDocument();
    expect(screen.getByTestId("scheduled-task-role-selected-retired-role")).toHaveTextContent("Retired Role");
  });
});

// ─── Schedule round-trips ────────────────────────────────────────────────────

describe("ScheduledAgentsModal: schedule round-trips", () => {
  async function openEdit(schedule: Record<string, unknown>): Promise<void> {
    listScheduledAgentsMock.mockResolvedValueOnce([makeRow({ schedule })]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    renderModal();
    await openTask("morning-triage");
  }

  async function savedSchedule(): Promise<Record<string, unknown>> {
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    return updateScheduledAgentMock.mock.calls[0][2].schedule as Record<string, unknown>;
  }

  it("an edit that doesn't touch the schedule writes it back unchanged (every v2 key kept)", async () => {
    const schedule = {
      type: "monthly",
      nth: "last",
      weekday: "fri",
      at: ["09:00", "16:00"],
      every: 3,
      start: "2027-01-01T00:00:00",
      until: "2030-01-01T00:00:00",
      timezone: "Europe/Paris",
      days: ["mon", "fri"],
    };
    await openEdit(schedule);
    expect(screen.getByTestId("scheduled-task-type-monthly")).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByTestId("scheduled-task-monthly-nth") as HTMLSelectElement).value).toBe("last");
    expect((screen.getByTestId("scheduled-task-tz") as HTMLInputElement).value).toBe("Europe/Paris");
    // Nothing changed yet; a schedule-free edit makes it saveable.
    expect(saveButton()).toBeDisabled();
    fireEvent.change(promptField(), { target: { value: "edited" } });
    expect(await savedSchedule()).toEqual(schedule);
  });

  it("Every… keeps its hand-set time zone and gains a window", async () => {
    await openEdit({ type: "interval", every: "30m", timezone: "Europe/Paris" });
    expect(screen.getByTestId("scheduled-task-type-interval")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("scheduled-task-window-toggle"));
    expect(await savedSchedule()).toEqual({
      type: "interval",
      every: "30m",
      window: { from: "09:00", to: "17:00" },
      timezone: "Europe/Paris",
    });
  });

  it("daily → add a second time + end after 5 runs", async () => {
    await openEdit({ type: "daily", at: "09:00", timezone: "Europe/Paris" });
    fireEvent.click(screen.getByTestId("scheduled-task-daily-at-add"));
    fireEvent.change(screen.getByTestId("scheduled-task-daily-at-2"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByTestId("scheduled-task-ends"), { target: { value: "count" } });
    fireEvent.change(screen.getByTestId("scheduled-task-count"), { target: { value: "5" } });
    expect(await savedSchedule()).toEqual({
      type: "daily",
      at: ["09:00", "17:00"],
      timezone: "Europe/Paris",
      count: 5,
    });
  });

  it("switching to Monthly every 2 months writes a start", async () => {
    await openEdit({ type: "daily", at: "09:00", timezone: "Europe/Paris" });
    fireEvent.click(screen.getByTestId("scheduled-task-type-monthly"));
    fireEvent.change(screen.getByTestId("scheduled-task-monthly-dom"), { target: { value: "last" } });
    fireEvent.change(screen.getByTestId("scheduled-task-every"), { target: { value: "2" } });
    expect(screen.getByTestId("scheduled-task-start")).toBeInTheDocument();
    const saved = await savedSchedule();
    expect(saved).toMatchObject({ type: "monthly", day: "last", at: "09:00", every: 2, timezone: "Europe/Paris" });
    expect(Number.isNaN(new Date(saved.start as string).getTime())).toBe(false);
  });

  it("a task saved without a zone runs in its machine's zone, and saving keeps it that way", async () => {
    await openEdit({ type: "daily", at: "09:00" });
    const tz = screen.getByTestId("scheduled-task-tz") as HTMLInputElement;
    expect(tz.value).toBe("");
    expect(tz.placeholder).toBe("The machine's time zone");
    expect(screen.getByText("Times above are in this zone. Blank means the machine's own time zone.")).toBeInTheDocument();
    // An unrelated edit doesn't write this browser's zone in.
    fireEvent.change(promptField(), { target: { value: "check inbox twice" } });
    expect(await savedSchedule()).toEqual({ type: "daily", at: "09:00" });
  });

  it("the Time zone field shows the task's zone; typing one writes it, blank writes yours", async () => {
    await openEdit({ type: "daily", at: "09:00" });
    const tz = screen.getByTestId("scheduled-task-tz") as HTMLInputElement;
    fireEvent.change(tz, { target: { value: "  Asia/Tokyo " } });
    expect(await savedSchedule()).toEqual({ type: "daily", at: "09:00", timezone: "Asia/Tokyo" });
    cleanup();

    updateScheduledAgentMock.mockReset();
    await openEdit({ type: "daily", at: "09:00", timezone: "Asia/Tokyo" });
    fireEvent.change(screen.getByTestId("scheduled-task-tz"), { target: { value: "" } });
    expect(await savedSchedule()).toEqual({ type: "daily", at: "09:00", timezone: "Europe/London" });
  });

  it("\"Only on\" days show what's stored and the picked days are written on save", async () => {
    await openEdit({ type: "weekly", day: "mon", at: "09:00", timezone: "Europe/Paris", days: ["tue"] });
    expect(screen.getByText("Only on")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Tue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Toggle Mon" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Toggle Mon" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle Fri" }));
    expect(await savedSchedule()).toEqual({
      type: "weekly",
      day: "mon",
      at: "09:00",
      timezone: "Europe/Paris",
      days: ["mon", "tue", "fri"],
    });
  });

  it("\"Only on\" days picked on a new daily task are written on create", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "weekdays", host: 1, spec: {} });
    renderModal();
    await openNew();
    fireEvent.change(nameField(), { target: { value: "weekdays" } });
    fireEvent.change(promptField(), { target: { value: "x" } });
    fireEvent.click(await screen.findByTestId("scheduled-task-no-roles"));
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"]) fireEvent.click(screen.getByRole("button", { name: `Toggle ${d}` }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][1].schedule).toEqual({
      type: "daily",
      at: "09:00",
      timezone: "Europe/London",
      days: ["mon", "tue", "wed", "thu", "fri"],
    });
  });

  it("switching the kind and back is no change", async () => {
    await openEdit({ type: "daily", at: "09:00", timezone: "Europe/Paris" });
    fireEvent.click(screen.getByTestId("scheduled-task-type-weekly"));
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("scheduled-task-type-daily"));
    expect(saveButton()).toBeDisabled();
  });
});

// ─── Sensors ─────────────────────────────────────────────────────────────────

describe("ScheduledAgentsModal: sensor-fired tasks", () => {
  // Per test, not per file: under load the file can run past the 30s the
  // relative-time assertions ("in 10m") tolerate.
  let NOW = Math.floor(Date.now() / 1000);
  beforeEach(() => {
    NOW = Math.floor(Date.now() / 1000);
  });
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

  it("a sensor row reads 'Sensor · <status> · Last fired …' with no Next; clock rows unchanged", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("healthy"), makeRow({ lastFiredAt: NOW - 60, nextFireAt: NOW + 630 })]);
    renderModal();
    const line = await screen.findByTestId(`${ROW("deliveries")}-sensor`);
    expect(line).toHaveTextContent("Sensor");
    expect(line).toHaveTextContent("Healthy");
    expect(line).toHaveTextContent("Last fired 3h ago");
    expect(screen.getByTestId(ROW("deliveries"))).not.toHaveTextContent("Next");
    expect(screen.getByTestId(`${ROW("morning-triage")}-when`)).toHaveTextContent("Next in 10m");
  });

  it("a one-time sensor row reads 'Sensor · once'; a repeating one doesn't", async () => {
    listScheduledAgentsMock.mockResolvedValue([
      sensorRow("healthy", { schedule: { type: "sensor", once: true }, scheduleHuman: "Sensor · once" }),
      sensorRow("healthy", { slug: "payday", name: "Payday" }),
    ]);
    renderModal();
    expect(await screen.findByTestId(`${ROW("deliveries")}-sensor`)).toHaveTextContent("Sensor · once");
    expect(screen.getByTestId(`${ROW("payday")}-sensor`)).not.toHaveTextContent("once");
  });

  it("switched off with held fires shows Off and the waiting count", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("off", { enabled: false })]);
    renderModal();
    expect(await screen.findByTestId(`${ROW("deliveries")}-sensor`)).toHaveTextContent("Off");
    expect(screen.getByTestId(`${ROW("deliveries")}-sensor-waiting`)).toHaveTextContent("2 waiting");
  });

  it("never fired reads 'Never fired'; unknown reads Unknown", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("unknown", { lastFiredAt: null })]);
    renderModal();
    const line = await screen.findByTestId(`${ROW("deliveries")}-sensor`);
    expect(line).toHaveTextContent("Unknown");
    expect(line).toHaveTextContent("Never fired");
  });

  it("opening a broken sensor task: When says it runs on its sensor, with the sensor's details read-only", async () => {
    listScheduledAgentsMock.mockResolvedValue([sensorRow("broken")]);
    renderModal();
    const line = await screen.findByTestId(`${ROW("deliveries")}-sensor`);
    expect(line).toHaveTextContent("Broken");
    expect(line).not.toHaveTextContent("KeyError");
    await openTask("deliveries");
    expect(screen.getByTestId("scheduled-task-sensor-schedule")).toHaveTextContent("When its sensor fires");
    expect(screen.queryByRole("group", { name: "Schedule type" })).toBeNull();
    expect(screen.queryByTestId("scheduled-task-tz")).toBeNull();
    const details = screen.getByTestId("scheduled-task-sensor-details");
    expect(details).toHaveTextContent("Always running");
    expect(details).toHaveTextContent("Running since");
    expect(details).not.toHaveTextContent("Last ran");
    expect(screen.getByTestId("scheduled-task-sensor-details-error")).toHaveTextContent("KeyError: x");
    expect(screen.getByTestId("scheduled-task-on-note")).toHaveTextContent("Runs when its sensor sees something");
  });

  it("a sensor task's schedule is written back unchanged on save", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
    updateScheduledAgentMock.mockResolvedValueOnce({});
    renderModal();
    await openTask("deliveries");
    fireEvent.change(promptField(), { target: { value: "new prompt" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].schedule).toEqual({ type: "sensor" });
    expect(updateScheduledAgentMock.mock.calls[0][2].prompt).toBe("new prompt");
  });

  it("a one-time sensor task says it retires after firing and keeps the mark on save", async () => {
    listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy", { schedule: { type: "sensor", once: true } })]);
    updateScheduledAgentMock.mockResolvedValueOnce({});
    renderModal();
    await openTask("deliveries");
    expect(screen.getByTestId("scheduled-task-sensor-schedule")).toHaveTextContent("once, then it retires");
    fireEvent.change(promptField(), { target: { value: "new prompt" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].schedule).toEqual({ type: "sensor", once: true });
  });

  it("a refresh that fails outright turns on-screen sensors Unknown (no stale Healthy)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
      listScheduledAgentsMock.mockRejectedValue(new Error("network down"));
      renderModal();
      expect(await screen.findByTestId(`${ROW("deliveries")}-sensor`)).toHaveTextContent("Healthy");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(screen.getByTestId(`${ROW("deliveries")}-sensor`)).toHaveTextContent("Unknown"));
      expect(screen.getByTestId(`${ROW("deliveries")}-sensor`)).not.toHaveTextContent("Healthy");
      expect(screen.getByTestId("scheduled-agents-modal-load-error")).toHaveTextContent("network down");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slow background read that started before a toggle can't undo it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let releaseSlow: (rows: ScheduledAgentListItem[]) => void = () => {};
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
      listScheduledAgentsMock.mockImplementationOnce(
        () => new Promise<ScheduledAgentListItem[]>((res) => (releaseSlow = res)),
      );
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("off", { enabled: false })]);
      toggleScheduledAgentEnabledMock.mockResolvedValue(undefined);
      renderModal();
      await screen.findByTestId(`${ROW("deliveries")}-sensor`);
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(listScheduledAgentsMock).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByTestId(`${ROW("deliveries")}-toggle`));
      await waitFor(() => expect(screen.getByTestId(`${ROW("deliveries")}-sensor`)).toHaveTextContent("Off"));
      await act(async () => {
        releaseSlow([sensorRow("healthy")]);
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByTestId(`${ROW("deliveries")}-sensor`)).toHaveTextContent("Off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the open task's sensor section follows the 30s refresh, and survives a refresh that drops the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("healthy")]);
      listScheduledAgentsMock.mockResolvedValueOnce([sensorRow("broken")]);
      listScheduledAgentsMock.mockResolvedValue([]);
      renderModal();
      await openTask("deliveries");
      expect(screen.getByTestId("scheduled-task-sensor-details")).toHaveTextContent("Healthy");
      // An edit in progress isn't reset by the refresh.
      fireEvent.change(promptField(), { target: { value: "mid-edit" } });
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(screen.getByTestId("scheduled-task-sensor-details")).toHaveTextContent("Broken"));
      expect(promptField().value).toBe("mid-edit");
      // The next refresh returns nothing (its machine didn't answer) — the view
      // keeps the last copy, but its sensor can't be vouched for: Unknown.
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(listScheduledAgentsMock).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(screen.getByTestId("scheduled-task-sensor-details")).toHaveTextContent("Unknown"));
      expect(screen.getByTestId("scheduled-task-sensor-details")).not.toHaveTextContent("Broken");
      expect(screen.queryByTestId("scheduled-task-sensor-details-error")).toBeNull();
      expect(screen.getByTestId("scheduled-task-sensor-schedule")).toBeInTheDocument();
      expect(promptField().value).toBe("mid-edit");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Archive if nothing to report ────────────────────────────────────────────

describe("ScheduledAgentsModal: Archive if nothing to report", () => {
  const SWITCH = "scheduled-task-archive-if-nothing-to-report";

  it("new task: off by default with its description; switching it on creates with true", async () => {
    createScheduledAgentMock.mockResolvedValueOnce({ slug: "box-check", host: 1, spec: {} });
    renderModal();
    await openNew();
    const sw = screen.getByTestId(SWITCH) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(screen.getByRole("switch", { name: "Archive if nothing to report" })).toBe(sw);
    expect(
      screen.getByText("If the run goes smoothly, its agent archives itself so it doesn't stay in your sidebar."),
    ).toBeInTheDocument();
    fireEvent.change(nameField(), { target: { value: "box-check" } });
    fireEvent.change(promptField(), { target: { value: "check" } });
    fireEvent.click(await screen.findByTestId("scheduled-task-role-addable-assistant"));
    fireEvent.click(sw);
    fireEvent.click(saveButton());
    await waitFor(() => expect(createScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(createScheduledAgentMock.mock.calls[0][1].archive_if_nothing_to_report).toBe(true);
  });

  it("existing task: shows the stored setting; switching it off is a change and saves false", async () => {
    listScheduledAgentsMock.mockResolvedValue([makeRow({ archive_if_nothing_to_report: true })]);
    updateScheduledAgentMock.mockResolvedValueOnce({ slug: "morning-triage", host: 1, spec: {} });
    renderModal();
    await openTask("morning-triage");
    const sw = screen.getByTestId(SWITCH) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(sw);
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateScheduledAgentMock).toHaveBeenCalledTimes(1));
    expect(updateScheduledAgentMock.mock.calls[0][2].archive_if_nothing_to_report).toBe(false);
  });
});
