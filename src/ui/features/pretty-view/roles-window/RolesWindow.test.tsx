// The roles window — library, moving between views, archived roles.
//
// One window, five views (library → role → skill; new role and archived
// off the library). Back and Esc go up exactly one level; the library's Esc
// closes; leaving unsaved edits asks first.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/identities-api", async (o) => (await import("./roles-window.test-mocks")).identitiesApi(o));
vi.mock("@/api/instance-wide-api", async (o) => (await import("./roles-window.test-mocks")).instanceWideApi(o));
vi.mock("@/api/roles-archive-list-api", async () => (await import("./roles-window.test-mocks")).rolesArchiveListApi());
vi.mock("@/api/role-unarchive-api", async (o) => (await import("./roles-window.test-mocks")).roleUnarchiveApi(o));
vi.mock("@/api/role-archive-api", async () => (await import("./roles-window.test-mocks")).roleArchiveApi());
vi.mock("@/api/claude-session-api", async (o) => (await import("./roles-window.test-mocks")).claudeSessionApi(o));
vi.mock("@/api/role-skills-api", async (o) => (await import("./roles-window.test-mocks")).roleSkillsApi(o));
vi.mock("@/api/scheduled-agents-api", async (o) => (await import("./roles-window.test-mocks")).scheduledAgentsApi(o));
vi.mock("@/api/workspace-api", async (o) => (await import("./roles-window.test-mocks")).workspaceApi(o));
vi.mock("@/api/workspace-git-api", async (o) => (await import("./roles-window.test-mocks")).workspaceGitApi(o));
vi.mock("@/api/voice-api", async (o) => (await import("./roles-window.test-mocks")).voiceApi(o));
vi.mock("@/state/identities-store", async (o) => (await import("./roles-window.test-mocks")).identitiesStore(o));
vi.mock("@mdxeditor/editor", async () => (await import("./roles-window.test-mocks")).mdxEditor());

import { autoAnswerKitDialogs, __resetKitDialogsForTests } from "@/components/kit";
import { UnarchiveError } from "@/api/identity-unarchive-api";
import { m, resetRolesWindowMocks, store } from "./roles-window.test-mocks";
import { RolesWindow } from "./RolesWindow";
import {
  ALLY,
  BOX,
  HOST_ID,
  MULTI_HOST_TREE,
  SINGLE_HOST_TREE,
  SUPPORT,
  SUPPORT_ITEM,
  agent,
  backButton,
  expectLibrary,
  openRoleFromLibrary,
  pressEscape,
  renderWindow,
} from "./roles-window.test-fixtures";

/** Type in the role-file editor the way a person does (a keypress, then the text). */
function typeInEditor(el: HTMLElement, init: { target: { value: string } }): void {
  fireEvent.keyDown(el, { key: "a" });
  fireEvent.change(el, init);
}

beforeEach(() => {
  resetRolesWindowMocks();
  m.listRolesForHost.mockResolvedValue([BOX, SUPPORT, ALLY]);
  m.listInstanceWide.mockResolvedValue({ isAdmin: false, items: [SUPPORT_ITEM] });
});
afterEach(() => {
  __resetKitDialogsForTests();
});

// ─── Library ────────────────────────────────────────────────────────────────

describe("roles window — library", () => {
  it("lists shared roles first under 'On every host', then the host's own under 'On <host>'", async () => {
    renderWindow();
    const shared = await screen.findByTestId("roles-window-section-shared");
    const own = screen.getByTestId("roles-window-section-host");
    expect(within(shared).getByRole("heading").textContent).toBe("On every host");
    expect(within(own).getByRole("heading").textContent).toBe("On thenasty");
    // Shared section comes first in the document.
    expect(shared.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(shared).getByTestId("roles-window-row-support-bot")).toBeTruthy();
    expect(within(shared).queryByTestId("roles-window-row-box-maintainer")).toBeNull();
    // The host's own roles, sorted by name: Ally before Box Maintainer.
    const ownRows = within(own).getAllByTestId(/^roles-window-row-/).map((r) => r.dataset.testid);
    expect(ownRows).toEqual(["roles-window-row-ally-role", "roles-window-row-box-maintainer"]);
    // Rows show the description.
    expect(within(own).getByText("Keeps the box healthy")).toBeTruthy();
    expect(m.listRolesForHost).toHaveBeenCalledWith(HOST_ID);
  });

  it("shows how many agents hold each role — a shared role counts every host, a local one only this host", async () => {
    store.identities = [
      agent("tabitha", ["box-maintainer"]),
      agent("rex", ["box-maintainer", "ally-role"]),
      agent("elsewhere", ["box-maintainer"], 9),
      agent("sam", ["support-bot"], 9),
    ];
    renderWindow();
    const box = await screen.findByTestId("roles-window-row-box-maintainer");
    expect(box.textContent).toContain("2 agents");
    expect(screen.getByTestId("roles-window-row-ally-role").textContent).toContain("1 agent");
    expect(screen.getByTestId("roles-window-row-ally-role").textContent).not.toContain("1 agents");
    expect(screen.getByTestId("roles-window-row-support-bot").textContent).toContain("1 agent");
  });

  it("a role nobody holds shows no count", async () => {
    renderWindow();
    const ally = await screen.findByTestId("roles-window-row-ally-role");
    expect(ally.textContent).not.toMatch(/agent/);
  });

  it("search filters by name and description; no match says so; the archived row hides while searching", async () => {
    m.listArchivedRoles.mockResolvedValue([{ name: "old-role", description: "" }]);
    renderWindow();
    await screen.findByTestId("roles-window-archived-row");
    const search = screen.getByTestId("roles-window-search");

    fireEvent.change(search, { target: { value: "healthy" } });
    expect(screen.getByTestId("roles-window-row-box-maintainer")).toBeTruthy();
    expect(screen.queryByTestId("roles-window-row-ally-role")).toBeNull();
    expect(screen.queryByTestId("roles-window-section-shared")).toBeNull();
    expect(screen.queryByTestId("roles-window-archived-row")).toBeNull();

    fireEvent.change(search, { target: { value: "support" } });
    expect(screen.getByTestId("roles-window-row-support-bot")).toBeTruthy();
    expect(screen.queryByTestId("roles-window-section-host")).toBeNull();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No roles match.")).toBeTruthy();

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByTestId("roles-window-archived-row")).toBeTruthy();
  });

  it("the archived row shows the count and opens the archived view; back returns to the library", async () => {
    m.listArchivedRoles.mockResolvedValue([
      { name: "old-maintainer", description: "Retired" },
      { name: "older-one", description: "" },
    ]);
    renderWindow();
    const row = await screen.findByTestId("roles-window-archived-row");
    expect(row.textContent).toContain("Archived roles");
    expect(row.textContent).toContain("2");
    fireEvent.click(row);
    expect(await screen.findByText("Archived roles")).toBeTruthy();
    expect(screen.getByTestId("roles-window-archived-old-maintainer").textContent).toContain("Old Maintainer");
    expect(screen.getByTestId("roles-window-archived-old-maintainer").textContent).toContain("Retired");
    fireEvent.click(backButton());
    await expectLibrary();
    expect(screen.getByTestId("roles-window-row-box-maintainer")).toBeTruthy();
  });

  it("no archived row when nothing is archived", async () => {
    renderWindow();
    await screen.findByTestId("roles-window-row-box-maintainer");
    await waitFor(() => expect(m.listArchivedRoles).toHaveBeenCalledWith(HOST_ID));
    expect(screen.queryByTestId("roles-window-archived-row")).toBeNull();
  });

  it("one host: no host picker, the host is picked for you", async () => {
    renderWindow();
    await screen.findByTestId("roles-window-row-box-maintainer");
    expect(screen.queryByTestId("roles-window-host-select")).toBeNull();
  });

  it("several hosts: a host picker (RDP-only hosts left out); picking one loads its roles", async () => {
    renderWindow({ tree: MULTI_HOST_TREE });
    const select = (await screen.findByTestId("roles-window-host-select")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Pick a host…", "alpha", "thenasty"]);
    expect(screen.getByText("Pick a host to see its roles.")).toBeTruthy();
    expect(m.listRolesForHost).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "1" } });
    await waitFor(() => expect(m.listRolesForHost).toHaveBeenCalledWith(1));
    expect(await screen.findByText("On alpha")).toBeTruthy();
  });

  it("starts on the host it was asked for", async () => {
    renderWindow({ tree: MULTI_HOST_TREE, start: { view: "library", hostId: 2 } });
    await screen.findByText("On thenasty");
    expect((screen.getByTestId("roles-window-host-select") as HTMLSelectElement).value).toBe("2");
  });

  it("an empty host offers New role", async () => {
    m.listRolesForHost.mockResolvedValue([]);
    m.listInstanceWide.mockResolvedValue({ isAdmin: false, items: [] });
    renderWindow();
    expect(await screen.findByText("No roles on thenasty yet.")).toBeTruthy();
    expect(screen.getAllByTestId("roles-window-new-role").length).toBeGreaterThan(0);
  });

  it("a failed load says so", async () => {
    m.listRolesForHost.mockRejectedValue(new Error("SSH down"));
    renderWindow();
    expect(await screen.findByText(/Couldn.t load roles: SSH down/)).toBeTruthy();
  });
});

// ─── Navigation ─────────────────────────────────────────────────────────────

describe("roles window — moving between views", () => {
  it("open a role → its view; ‹ Roles → back to the library", async () => {
    renderWindow();
    await openRoleFromLibrary("box-maintainer");
    expect(screen.queryByTestId("roles-window-search")).toBeNull();
    expect(backButton().textContent).toContain("Roles");
    expect(m.getRoleFileByName).toHaveBeenCalledWith({ roleName: "box-maintainer", hostId: HOST_ID });
    fireEvent.click(backButton());
    await expectLibrary();
    expect(screen.getByTestId("roles-window-row-box-maintainer")).toBeTruthy();
  });

  it("skill → back lands on the role's Skills tab", async () => {
    m.listRoleSkills.mockResolvedValue([{ name: "weekly-report" }]);
    m.enumerateRoleSkillFiles.mockResolvedValue([{ path: "SKILL.md" }]);
    renderWindow();
    await openRoleFromLibrary("box-maintainer");
    fireEvent.click(screen.getByTestId("role-view-tab-skills"));
    fireEvent.click(await screen.findByTestId("role-view-skill-weekly-report"));
    // The skill view: its title, and back names the role.
    expect(await screen.findByText("Weekly Report")).toBeTruthy();
    expect(backButton().textContent).toContain("Box Maintainer");
    expect(m.enumerateRoleSkillFiles).toHaveBeenCalledWith(HOST_ID, "box-maintainer", "weekly-report");
    fireEvent.click(backButton());
    expect(await screen.findByTestId("role-view-skill-weekly-report")).toBeTruthy();
    expect(screen.getByTestId("role-view-tab-skills").getAttribute("aria-pressed")).toBe("true");
  });

  it("re-opening a role from the library starts on the Role file tab", async () => {
    renderWindow();
    await openRoleFromLibrary("box-maintainer");
    fireEvent.click(screen.getByTestId("role-view-tab-skills"));
    fireEvent.click(backButton());
    await openRoleFromLibrary("box-maintainer");
    expect(screen.getByTestId("role-view-tab-role").getAttribute("aria-pressed")).toBe("true");
  });

  it("Esc steps back one level at a time, and closes from the library", async () => {
    m.listRoleSkills.mockResolvedValue([{ name: "weekly-report" }]);
    m.enumerateRoleSkillFiles.mockResolvedValue([{ path: "SKILL.md" }]);
    const { onOpenChange } = renderWindow();
    await openRoleFromLibrary("box-maintainer");
    fireEvent.click(screen.getByTestId("role-view-tab-skills"));
    fireEvent.click(await screen.findByTestId("role-view-skill-weekly-report"));
    await screen.findByText("Weekly Report");

    pressEscape();
    expect(await screen.findByTestId("role-view-skill-weekly-report")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();

    pressEscape();
    await expectLibrary();
    expect(onOpenChange).not.toHaveBeenCalled();

    pressEscape();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("the X closes the window from any view", async () => {
    const { onOpenChange } = renderWindow();
    await openRoleFromLibrary("box-maintainer");
    fireEvent.click(screen.getByTestId("roles-window-close"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("leaving the role file with unsaved edits asks; 'no' keeps you editing, 'yes' leaves", async () => {
    let answer = false;
    const dialogs = autoAnswerKitDialogs({ confirm: () => answer });
    const { onOpenChange } = renderWindow();
    await openRoleFromLibrary("box-maintainer");
    fireEvent.click(await screen.findByTestId("role-view-edit"));
    typeInEditor(await screen.findByTestId("mdxeditor"), { target: { value: "# Changed\n" } });

    fireEvent.click(backButton());
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].kind).toBe("confirm");
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    // Stayed: still editing, the draft intact.
    expect((screen.getByTestId("mdxeditor") as HTMLTextAreaElement).value).toBe("# Changed\n");
    expect(screen.queryByTestId("roles-window-search")).toBeNull();

    // The X asks too.
    fireEvent.click(screen.getByTestId("roles-window-close"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(2));
    expect(screen.getByTestId("mdxeditor")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();

    answer = true;
    fireEvent.click(backButton());
    await expectLibrary();
  });

  it("leaving the role file without edits doesn't ask", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    renderWindow();
    await openRoleFromLibrary("box-maintainer");
    fireEvent.click(await screen.findByTestId("role-view-edit"));
    await screen.findByTestId("mdxeditor");
    fireEvent.click(backButton());
    await expectLibrary();
    expect(dialogs.calls).toHaveLength(0);
  });

  it("opens straight onto a role when asked (an agent's window), and ‹ Roles still goes to the library", async () => {
    renderWindow({ start: { view: "role", hostId: HOST_ID, role: BOX } });
    expect(await screen.findByTestId("role-view-facts")).toBeTruthy();
    fireEvent.click(backButton());
    await expectLibrary();
    expect(await screen.findByTestId("roles-window-row-ally-role")).toBeTruthy();
  });

  it("each open starts fresh: closed on a half-filled new role, reopened on the library", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const props = { onOpenChange: vi.fn(), hostTree: SINGLE_HOST_TREE, start: { view: "library" as const }, newRoleHop: null };
    const { rerender } = render(<RolesWindow open={true} {...props} />);
    fireEvent.click(await screen.findByTestId("roles-window-new-role"));
    fireEvent.change(await screen.findByTestId("new-role-name"), { target: { value: "Meal Planner" } });
    rerender(<RolesWindow open={false} {...props} />);
    rerender(<RolesWindow open={true} {...props} />);
    await expectLibrary();
    expect(screen.queryByTestId("new-role-name")).toBeNull();
    // A fresh new-role form registers its own guard again.
    fireEvent.click(screen.getByTestId("roles-window-new-role"));
    fireEvent.change(await screen.findByTestId("new-role-name"), { target: { value: "Meal Planner" } });
    fireEvent.click(screen.getByTestId("new-role-cancel"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard this new role?");
  });

  it("a shared role opened without its shared flag (an agent's window) is still view-only down into its skills", async () => {
    m.listRoleSkills.mockResolvedValue([{ name: "weekly-report" }]);
    m.enumerateRoleSkillFiles.mockResolvedValue([{ path: "SKILL.md" }]);
    const { instanceWide: _drop, ...bare } = SUPPORT;
    renderWindow({ start: { view: "role", hostId: HOST_ID, role: bare } });
    expect(await screen.findByTestId("role-view-readonly-note")).toBeTruthy();
    fireEvent.click(screen.getByTestId("role-view-tab-skills"));
    fireEvent.click(await screen.findByTestId("role-view-skill-weekly-report"));
    await screen.findByText("Weekly Report");
    expect(screen.queryByTestId("skill-view-save")).toBeNull();
    expect(screen.queryByTestId("skill-view-add-file")).toBeNull();
  });
});

// ─── Archived roles ─────────────────────────────────────────────────────────

describe("roles window — archived roles", () => {
  beforeEach(() => {
    m.listArchivedRoles.mockResolvedValue([
      { name: "old-maintainer", description: "Retired" },
      { name: "older-one", description: "" },
    ]);
  });

  async function openArchived(): Promise<void> {
    renderWindow();
    fireEvent.click(await screen.findByTestId("roles-window-archived-row"));
    await screen.findByTestId("roles-window-archived-list");
  }

  it("Un-archive keeps you there, marks the row 'On its way back' and refreshes the roles", async () => {
    let resolve!: () => void;
    m.unarchiveRole.mockImplementation(() => new Promise((r) => (resolve = () => r({ ok: true }))));
    await openArchived();
    const callsBefore = m.listRolesForHost.mock.calls.length;
    fireEvent.click(screen.getByTestId("roles-window-unarchive-old-maintainer"));
    expect(m.unarchiveRole).toHaveBeenCalledWith(HOST_ID, "old-maintainer");
    // In flight: the button is busy, nothing claimed yet.
    expect((screen.getByTestId("roles-window-unarchive-old-maintainer") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/On its way back/)).toBeNull();
    resolve();
    await waitFor(() =>
      expect(screen.getByTestId("roles-window-archived-old-maintainer").textContent).toMatch(/On its way back/),
    );
    expect(screen.queryByTestId("roles-window-unarchive-old-maintainer")).toBeNull();
    // The other row is untouched; still in the archived view.
    expect(screen.getByTestId("roles-window-unarchive-older-one")).toBeTruthy();
    await waitFor(() => expect(m.listRolesForHost.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("a name collision shows the kit alert and leaves the row as it was", async () => {
    const dialogs = autoAnswerKitDialogs();
    m.unarchiveRole.mockRejectedValue(new UnarchiveError("collision", "name_collision"));
    await openArchived();
    fireEvent.click(screen.getByTestId("roles-window-unarchive-old-maintainer"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    expect(dialogs.calls[0].opts.title).toBe("Couldn't un-archive Old Maintainer");
    expect(dialogs.calls[0].opts.body).toBe("A live role with that name already exists.");
    expect(screen.getByTestId("roles-window-unarchive-old-maintainer")).toBeTruthy();
    expect(screen.getByTestId("roles-window-archived-old-maintainer").textContent).not.toMatch(/On its way back/);
  });

  it("any other failure says to try again", async () => {
    const dialogs = autoAnswerKitDialogs();
    m.unarchiveRole.mockRejectedValue(new Error("network"));
    await openArchived();
    fireEvent.click(screen.getByTestId("roles-window-unarchive-older-one"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.body).toBe("Try again in a moment.");
    expect(screen.getByTestId("roles-window-unarchive-older-one")).toBeTruthy();
  });
});
