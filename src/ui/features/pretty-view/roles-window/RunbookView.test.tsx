// The roles window's runbook view — one level below the role: opens on
// runbook.md, an "N files" toggle for the file list, Add file (also on the
// empty state), delete file / runbook, Save writes the open file, and
// view-only for a non-admin looking at a shared role.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/identities-api", async (o) => (await import("./roles-window.test-mocks")).identitiesApi(o));
vi.mock("@/api/instance-wide-api", async (o) => (await import("./roles-window.test-mocks")).instanceWideApi(o));
vi.mock("@/api/roles-archive-list-api", async () => (await import("./roles-window.test-mocks")).rolesArchiveListApi());
vi.mock("@/api/role-unarchive-api", async (o) => (await import("./roles-window.test-mocks")).roleUnarchiveApi(o));
vi.mock("@/api/role-archive-api", async () => (await import("./roles-window.test-mocks")).roleArchiveApi());
vi.mock("@/api/claude-session-api", async (o) => (await import("./roles-window.test-mocks")).claudeSessionApi(o));
vi.mock("@/api/runbooks-api", async (o) => (await import("./roles-window.test-mocks")).runbooksApi(o));
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
  m.listRunbooks.mockResolvedValue([{ name: RB }]);
  m.enumerateRunbookFiles.mockResolvedValue([{ path: "a-notes.md" }, { path: "runbook.md" }]);
  m.readRunbookFile.mockImplementation(async (_h: number, _r: string, _rb: string, path: string) => ({
    content: `content of ${path}`,
    mtime: 11,
    size: 10,
    isText: true,
  }));
});
afterEach(() => {
  __resetKitDialogsForTests();
});

/** Open the role, its Runbooks tab, then the runbook. */
async function openRunbook(role: RoleSummary = BOX): Promise<{ onOpenChange: ReturnType<typeof vi.fn> }> {
  const r = renderWindow({ start: { view: "role", hostId: HOST_ID, role } });
  fireEvent.click(await screen.findByTestId("role-view-tab-runbooks"));
  fireEvent.click(await screen.findByTestId(`role-view-runbook-${RB}`));
  await screen.findByText("Weekly Report");
  return r;
}

function editor(): HTMLTextAreaElement {
  return screen.getByTestId("mdxeditor") as HTMLTextAreaElement;
}

describe("runbook view", () => {
  it("opens on runbook.md (even when it isn't first) under the runbook's name, with 'Runbook' under it", async () => {
    await openRunbook();
    await waitFor(() => expect(editor().value).toBe("content of runbook.md"));
    expect(m.readRunbookFile).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "runbook.md");
    expect(m.readRunbookFile).not.toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "a-notes.md");
    expect(screen.getByTestId("runbook-view-current-file").textContent).toBe("runbook.md");
    expect(screen.getByText("Runbook")).toBeTruthy();
    expect(backButton().textContent).toContain("Box Maintainer");
  });

  it("the 'N files' toggle brings the file list down the side; picking a file opens it", async () => {
    await openRunbook();
    const toggle = await screen.findByTestId("runbook-view-files-toggle");
    expect(toggle.textContent).toContain("2 files");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("runbook-view-file-list").className).toMatch(/\bhidden\b/);
    fireEvent.click(toggle);
    expect(screen.getByTestId("runbook-view-files-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("runbook-view-file-list").className).not.toMatch(/\bhidden\b/);
    fireEvent.click(screen.getByTestId("runbook-view-file-a-notes.md"));
    await waitFor(() => expect(screen.getByTestId("runbook-view-current-file").textContent).toBe("a-notes.md"));
    await waitFor(() => expect(editor().value).toBe("content of a-notes.md"));
    // "Add file" sits at the bottom of the list.
    expect(within(screen.getByTestId("runbook-view-file-list")).getByTestId("runbook-view-add-file")).toBeTruthy();
  });

  it("a one-file runbook's toggle just says Files", async () => {
    m.enumerateRunbookFiles.mockResolvedValue([{ path: "runbook.md" }]);
    await openRunbook();
    expect((await screen.findByTestId("runbook-view-files-toggle")).textContent?.trim()).toBe("Files");
  });

  it("an empty runbook shows its own Add file; adding one opens it", async () => {
    m.enumerateRunbookFiles.mockResolvedValueOnce([]).mockResolvedValue([{ path: "notes.md" }]);
    const dialogs = autoAnswerKitDialogs({ prompt: "notes.md" });
    await openRunbook();
    expect(await screen.findByText("No files yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("runbook-view-add-file"));
    await waitFor(() => expect(m.createRunbookFile).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "notes.md"));
    expect(dialogs.calls[0].opts.title).toBe("New file");
    await waitFor(() => expect(screen.getByTestId("runbook-view-current-file").textContent).toBe("notes.md"));
  });

  it("Add file… from the ⋯ menu; an existing name gets the kit alert", async () => {
    const { RunbookFileAlreadyExistsError } = await import("@/api/runbooks-api");
    m.createRunbookFile.mockRejectedValue(new RunbookFileAlreadyExistsError());
    const dialogs = autoAnswerKitDialogs({ prompt: "runbook.md" });
    await openRunbook();
    fireEvent.click(within(await openMenu("runbook-view-menu")).getByTestId("runbook-view-add-file-menu"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    expect(dialogs.calls[1].opts.body).toBe('A file named "runbook.md" already exists in this runbook.');
  });

  it("Delete runbook… confirms, deletes, and returns to the role's Runbooks tab", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRunbook();
    const listCalls = m.listRunbooks.mock.calls.length;
    fireEvent.click(within(await openMenu("runbook-view-menu")).getByTestId("runbook-view-delete"));
    await waitFor(() => expect(m.deleteRunbook).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB));
    expect(dialogs.calls[0].opts.title).toBe("Delete the Weekly Report runbook?");
    await waitFor(() => expect(screen.getByTestId("role-view-tab-runbooks").getAttribute("aria-pressed")).toBe("true"));
    expect(m.listRunbooks.mock.calls.length).toBeGreaterThan(listCalls);
  });

  it("declining Delete runbook keeps it", async () => {
    autoAnswerKitDialogs({ confirm: false });
    await openRunbook();
    fireEvent.click(within(await openMenu("runbook-view-menu")).getByTestId("runbook-view-delete"));
    await waitFor(() => expect(screen.getByTestId("runbook-view-current-file")).toBeTruthy());
    expect(m.deleteRunbook).not.toHaveBeenCalled();
  });

  it("deleting the open file confirms, removes it and opens the next", async () => {
    m.enumerateRunbookFiles
      .mockResolvedValueOnce([{ path: "a-notes.md" }, { path: "runbook.md" }])
      .mockResolvedValue([{ path: "a-notes.md" }]);
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRunbook();
    await waitFor(() => expect(editor().value).toBe("content of runbook.md"));
    fireEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    await waitFor(() => expect(m.deleteRunbookFile).toHaveBeenCalledWith(HOST_ID, "box-maintainer", RB, "runbook.md"));
    expect(dialogs.calls[0].opts.title).toBe('Delete "runbook.md"?');
    await waitFor(() => expect(screen.getByTestId("runbook-view-current-file").textContent).toBe("a-notes.md"));
  });

  it("Save writes the open file with its mtime; disabled until there's a change", async () => {
    await openRunbook();
    await waitFor(() => expect(editor().value).toBe("content of runbook.md"));
    const save = screen.getByTestId("runbook-view-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(editor(), { target: { value: "# Steps\n\n1. Do it\n" } });
    await waitFor(() => expect((screen.getByTestId("runbook-view-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("runbook-view-save"));
    await waitFor(() =>
      expect(m.writeRunbookFile).toHaveBeenCalledWith({
        hostId: HOST_ID,
        role: "box-maintainer",
        runbook: RB,
        path: "runbook.md",
        content: "# Steps\n\n1. Do it\n",
        expectedMtime: 11,
      }),
    );
  });

  it("leaving with unsaved edits asks first; 'no' stays", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    await openRunbook();
    await waitFor(() => expect(editor().value).toBe("content of runbook.md"));
    fireEvent.change(editor(), { target: { value: "changed" } });
    await waitFor(() => expect((screen.getByTestId("runbook-view-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(backButton());
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(dialogs.calls[0].opts.body).toBe("Your edits to this runbook haven't been saved.");
    expect(editor().value).toBe("changed");
  });

  it("Close closes the window", async () => {
    const { onOpenChange } = await openRunbook();
    fireEvent.click(screen.getByTestId("runbook-view-close"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("a shared role's runbook is view-only for a non-admin: no Save, no Add file, menu says why", async () => {
    await openRunbook(SUPPORT);
    await waitFor(() => expect(editor().value).toBe("content of runbook.md"));
    expect(screen.queryByTestId("runbook-view-save")).toBeNull();
    expect(screen.queryByTestId("runbook-view-add-file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete this file" })).toBeNull();
    const menu = await openMenu("runbook-view-menu");
    expect(within(menu).queryByTestId("runbook-view-delete")).toBeNull();
    expect(menu.textContent).toContain("Only an admin can change a shared role's runbooks");
  });
});
