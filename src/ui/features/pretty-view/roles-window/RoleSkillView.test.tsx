// The roles window's role-skill view — one level below the role: opens on
// SKILL.md, an "N files" toggle for the file list, Add file (also on the
// empty state), rename (from the menu, or by saving a changed `name:`),
// delete file / skill, Save writes the open file, and
// view-only for a non-admin looking at a shared role.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

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
import type { RoleSummary } from "@/api/identities-api";
import { m, resetRolesWindowMocks } from "./roles-window.test-mocks";
import {
  BOX,
  HOST_ID,
  SUPPORT,
  SUPPORT_ITEM,
  backButton,
  openMenu,
  renderWindow,
} from "./roles-window.test-fixtures";

const RB = "weekly-report";

beforeEach(() => {
  resetRolesWindowMocks();
  m.listRolesForHost.mockResolvedValue([BOX, SUPPORT]);
  m.listInstanceWide.mockResolvedValue({ isAdmin: false, items: [SUPPORT_ITEM] });
  m.listRoleSkills.mockResolvedValue([{ name: RB }]);
  m.enumerateRoleSkillFiles.mockResolvedValue([{ path: "a-notes.md" }, { path: "SKILL.md" }]);
  m.readRoleSkillFile.mockImplementation(async (_h: number, _r: string, _rb: string, path: string) => ({
    content: `content of ${path}`,
    mtime: 11,
    size: 10,
    isText: true,
  }));
});
afterEach(() => {
  __resetKitDialogsForTests();
});

/** Open the role, its Skills tab, then the skill. */
async function openSkill(role: RoleSummary = BOX): Promise<{ onOpenChange: ReturnType<typeof vi.fn> }> {
  const r = renderWindow({ start: { view: "role", hostId: HOST_ID, role } });
  fireEvent.click(await screen.findByTestId("role-view-tab-skills"));
  fireEvent.click(await screen.findByTestId(`role-view-skill-${RB}`));
  await screen.findByText("weekly-report");
  return r;
}

function editor(): HTMLTextAreaElement {
  return screen.getByTestId("mdxeditor") as HTMLTextAreaElement;
}

describe("role skill view", () => {
  it("opens on SKILL.md (even when it isn't first) under the skill's name, with 'Role skill' under it", async () => {
    await openSkill();
    await waitFor(() => expect(editor().value).toBe("content of SKILL.md"));
    expect(m.readRoleSkillFile).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "SKILL.md");
    expect(m.readRoleSkillFile).not.toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "a-notes.md");
    expect(screen.getByTestId("skill-view-current-file").textContent).toBe("SKILL.md");
    expect(screen.getByText("Role skill")).toBeTruthy();
    expect(backButton().textContent).toContain("Box Maintainer");
  });

  it("the 'N files' toggle brings the file list down the side; picking a file opens it", async () => {
    await openSkill();
    const toggle = await screen.findByTestId("skill-view-files-toggle");
    expect(toggle.textContent).toContain("2 files");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("skill-view-file-list").className).toMatch(/\bhidden\b/);
    fireEvent.click(toggle);
    expect(screen.getByTestId("skill-view-files-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("skill-view-file-list").className).not.toMatch(/\bhidden\b/);
    fireEvent.click(screen.getByTestId("skill-view-file-a-notes.md"));
    await waitFor(() => expect(screen.getByTestId("skill-view-current-file").textContent).toBe("a-notes.md"));
    await waitFor(() => expect(editor().value).toBe("content of a-notes.md"));
    // "Add file" sits at the bottom of the list.
    expect(within(screen.getByTestId("skill-view-file-list")).getByTestId("skill-view-add-file")).toBeTruthy();
  });

  it("a one-file skill's toggle just says Files", async () => {
    m.enumerateRoleSkillFiles.mockResolvedValue([{ path: "SKILL.md" }]);
    await openSkill();
    expect((await screen.findByTestId("skill-view-files-toggle")).textContent?.trim()).toBe("Files");
  });

  it("an empty skill shows its own Add file; adding one opens it", async () => {
    m.enumerateRoleSkillFiles.mockResolvedValueOnce([]).mockResolvedValue([{ path: "notes.md" }]);
    const dialogs = autoAnswerKitDialogs({ prompt: "notes.md" });
    await openSkill();
    expect(await screen.findByText("No files yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("skill-view-add-file"));
    await waitFor(() => expect(m.createRoleSkillFile).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "notes.md"));
    expect(dialogs.calls[0].opts.title).toBe("New file");
    await waitFor(() => expect(screen.getByTestId("skill-view-current-file").textContent).toBe("notes.md"));
  });

  it("Add file… from the ⋯ menu; an existing name gets the kit alert", async () => {
    const { RoleSkillFileAlreadyExistsError } = await import("@/api/role-skills-api");
    m.createRoleSkillFile.mockRejectedValue(new RoleSkillFileAlreadyExistsError());
    const dialogs = autoAnswerKitDialogs({ prompt: "SKILL.md" });
    await openSkill();
    fireEvent.click(within(await openMenu("skill-view-menu")).getByTestId("skill-view-add-file-menu"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    expect(dialogs.calls[1].opts.body).toBe('A file named "SKILL.md" already exists in this skill.');
  });

  it("Delete skill… confirms, deletes, and returns to the role's Skills tab", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openSkill();
    const listCalls = m.listRoleSkills.mock.calls.length;
    fireEvent.click(within(await openMenu("skill-view-menu")).getByTestId("skill-view-delete"));
    await waitFor(() => expect(m.deleteRoleSkill).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB));
    expect(dialogs.calls[0].opts.title).toBe('Delete skill "weekly-report"?');
    await waitFor(() => expect(screen.getByTestId("role-view-tab-skills").getAttribute("aria-pressed")).toBe("true"));
    expect(m.listRoleSkills.mock.calls.length).toBeGreaterThan(listCalls);
  });

  it("declining Delete skill keeps it", async () => {
    autoAnswerKitDialogs({ confirm: false });
    await openSkill();
    fireEvent.click(within(await openMenu("skill-view-menu")).getByTestId("skill-view-delete"));
    await waitFor(() => expect(screen.getByTestId("skill-view-current-file")).toBeTruthy());
    expect(m.deleteRoleSkill).not.toHaveBeenCalled();
  });

  it("Rename… slugs the new name, renames the skill and re-opens it under that name", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "Monthly Report" });
    await openSkill();
    m.listRoleSkills.mockResolvedValue([{ name: "monthly-report" }]);
    fireEvent.click(within(await openMenu("skill-view-menu")).getByTestId("skill-view-rename"));
    await waitFor(() =>
      expect(m.renameRoleSkill).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "monthly-report", undefined),
    );
    expect(dialogs.calls[0].kind).toBe("prompt");
    expect(await screen.findByText("monthly-report")).toBeTruthy();
    await waitFor(() => expect(m.enumerateRoleSkillFiles).toHaveBeenLastCalledWith(HOST_ID, "box-maintainer", "monthly-report"));
  });

  it("Rename… to a taken name says so and stays", async () => {
    const { RoleSkillAlreadyExistsError } = await import("@/api/role-skills-api");
    m.renameRoleSkill.mockRejectedValue(new RoleSkillAlreadyExistsError());
    const dialogs = autoAnswerKitDialogs({ prompt: "taken" });
    await openSkill();
    fireEvent.click(within(await openMenu("skill-view-menu")).getByTestId("skill-view-rename"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    expect(dialogs.calls[1].opts.body).toBe('A skill named "taken" already exists in this role.');
    expect(screen.getByText("weekly-report")).toBeTruthy();
  });

  it("saving SKILL.md with a changed name offers the rename, and the draft rides along", async () => {
    m.readRoleSkillFile.mockResolvedValue({ content: `---\nname: ${RB}\n---\n# Steps\n`, mtime: 11, size: 10, isText: true });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openSkill();
    await waitFor(() => expect(editor().value).toContain(`name: ${RB}`));
    fireEvent.change(editor(), { target: { value: "---\nname: deploy\n---\n# Steps\n" } });
    await waitFor(() => expect((screen.getByTestId("skill-view-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("skill-view-save"));
    await waitFor(() =>
      expect(m.renameRoleSkill).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "deploy", {
        path: "SKILL.md",
        content: "---\nname: deploy\n---\n# Steps\n",
        expectedMtime: 11,
      }),
    );
    expect(dialogs.calls[0].kind).toBe("confirm");
    expect(m.writeRoleSkillFile).not.toHaveBeenCalled();
    expect(await screen.findByText("deploy")).toBeTruthy();
  });

  it("a changed name: Cancel saves nothing and keeps the edits", async () => {
    m.readRoleSkillFile.mockResolvedValue({ content: `---\nname: ${RB}\n---\n`, mtime: 11, size: 10, isText: true });
    autoAnswerKitDialogs({ confirm: false });
    await openSkill();
    await waitFor(() => expect(editor().value).toContain(`name: ${RB}`));
    fireEvent.change(editor(), { target: { value: "---\nname: deploy\n---\n" } });
    await waitFor(() => expect((screen.getByTestId("skill-view-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("skill-view-save"));
    await waitFor(() => expect((screen.getByTestId("skill-view-save") as HTMLButtonElement).disabled).toBe(false));
    expect(m.renameRoleSkill).not.toHaveBeenCalled();
    expect(m.writeRoleSkillFile).not.toHaveBeenCalled();
    expect(editor().value).toBe("---\nname: deploy\n---\n");
  });

  it("deleting the open file confirms, removes it and opens the next", async () => {
    m.enumerateRoleSkillFiles
      .mockResolvedValueOnce([{ path: "a-notes.md" }, { path: "SKILL.md" }])
      .mockResolvedValue([{ path: "SKILL.md" }]);
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openSkill();
    await waitFor(() => expect(editor().value).toBe("content of SKILL.md"));
    // SKILL.md itself can't be deleted — only the skill's other files.
    expect(screen.queryByRole("button", { name: "Delete this file" })).toBeNull();
    fireEvent.click(screen.getByTestId("skill-view-files-toggle"));
    fireEvent.click(await screen.findByTestId("skill-view-file-a-notes.md"));
    await waitFor(() => expect(editor().value).toBe("content of a-notes.md"));
    fireEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    await waitFor(() => expect(m.deleteRoleSkillFile).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "a-notes.md"));
    expect(dialogs.calls[0].opts.title).toBe('Delete "a-notes.md"?');
    await waitFor(() => expect(screen.getByTestId("skill-view-current-file").textContent).toBe("SKILL.md"));
  });

  it("Save writes the open file with its mtime; disabled until there's a change", async () => {
    await openSkill();
    await waitFor(() => expect(editor().value).toBe("content of SKILL.md"));
    const save = screen.getByTestId("skill-view-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(editor(), { target: { value: "# Steps\n\n1. Do it\n" } });
    await waitFor(() => expect((screen.getByTestId("skill-view-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("skill-view-save"));
    await waitFor(() =>
      expect(m.writeRoleSkillFile).toHaveBeenCalledWith({
        hostId: HOST_ID,
        role: "box-maintainer",
        skill: RB,
        path: "SKILL.md",
        content: "# Steps\n\n1. Do it\n",
        expectedMtime: 11,
      }),
    );
  });

  it("leaving with unsaved edits asks first; 'no' stays", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    await openSkill();
    await waitFor(() => expect(editor().value).toBe("content of SKILL.md"));
    fireEvent.change(editor(), { target: { value: "changed" } });
    await waitFor(() => expect((screen.getByTestId("skill-view-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(backButton());
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(dialogs.calls[0].opts.body).toBe("Your edits to this skill haven't been saved.");
    expect(editor().value).toBe("changed");
  });

  it("Close closes the window", async () => {
    const { onOpenChange } = await openSkill();
    fireEvent.click(screen.getByTestId("skill-view-close"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("a shared role's skill is view-only for a non-admin: no Save, no Add file, menu says why", async () => {
    await openSkill(SUPPORT);
    await waitFor(() => expect(editor().value).toBe("content of SKILL.md"));
    expect(screen.queryByTestId("skill-view-save")).toBeNull();
    expect(screen.queryByTestId("skill-view-add-file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete this file" })).toBeNull();
    const menu = await openMenu("skill-view-menu");
    expect(within(menu).queryByTestId("skill-view-delete")).toBeNull();
    expect(menu.textContent).toContain("Only an admin can change a shared role's skills");
  });
});
