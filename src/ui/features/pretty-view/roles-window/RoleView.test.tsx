// The roles window's role view: picture, name, description (edited in
// place), the facts line, colour / voice, the tabs, the ⋯ menu, and the
// view-only treatment of shared roles for non-admins.

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
import { RunbookAlreadyExistsError } from "@/api/runbooks-api";
import { NEW_CONVERSATION_REQUEST_EVENT, type NewConversationRequest } from "@/lib/new-conversation-request";
import { DEFAULT_ROLE_FILE, m, resetRolesWindowMocks, store } from "./roles-window.test-mocks";
import {
  ALLY,
  BOX,
  HOST_ID,
  SUPPORT,
  SUPPORT_ITEM,
  agent,
  backButton,
  expectLibrary,
  openMenu,
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

/** Open the role view straight onto a role and wait for its file. */
async function openRole(name = "box-maintainer"): Promise<{ onOpenChange: ReturnType<typeof vi.fn> }> {
  const r = renderWindow();
  await openRoleFromLibrary(name);
  await waitFor(() => expect(m.getRoleFileByName).toHaveBeenCalled());
  return r;
}

function lastSavedFile(): string {
  const calls = m.updateRoleFileByName.mock.calls;
  return calls[calls.length - 1][2] as string;
}

// ─── Description ────────────────────────────────────────────────────────────

describe("role view — description", () => {
  it("an empty description shows a faded 'No description'; click → edit → Enter saves it into the frontmatter", async () => {
    await openRole();
    const desc = await screen.findByTestId("role-view-description");
    expect(desc.textContent).toBe("No description");
    expect(desc.querySelector(".italic")).toBeTruthy();

    fireEvent.click(desc);
    const input = (await screen.findByTestId("role-view-description-input")) as HTMLTextAreaElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "  Keeps   the box\nhealthy  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(m.updateRoleFileByName).toHaveBeenCalledTimes(1));
    const [name, hostId, markdown] = m.updateRoleFileByName.mock.calls[0] as [string, number, string];
    expect(name).toBe("box-maintainer");
    expect(hostId).toBe(HOST_ID);
    // Merged into the existing frontmatter; the rest of the file untouched.
    expect(markdown).toBe(
      "---\ndisplayName: Box Maintainer\ncolorHue: '320'\ndescription: \"Keeps the box healthy\"\n---\n\n# Box Maintainer\n\nKeeps the box healthy.\n",
    );
    await waitFor(() => expect(screen.getByTestId("role-view-description").textContent).toBe("Keeps the box healthy"));
    expect(screen.getByTestId("role-view-description").querySelector(".italic")).toBeNull();
    // The library row follows.
    fireEvent.click(backButton());
    expect((await screen.findByTestId("roles-window-row-box-maintainer")).textContent).toContain("Keeps the box healthy");
  });

  it("clearing the description removes the key from the frontmatter", async () => {
    m.getRoleFileByName.mockResolvedValue({
      markdown: "---\ndisplayName: Box Maintainer\ndescription: Old words\nowner: ashley\n---\n\nBody.\n",
    });
    await openRole();
    const desc = await screen.findByTestId("role-view-description");
    await waitFor(() => expect(desc.textContent).toBe("Old words"));
    fireEvent.click(desc);
    const input = (await screen.findByTestId("role-view-description-input")) as HTMLTextAreaElement;
    expect(input.value).toBe("Old words");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(m.updateRoleFileByName).toHaveBeenCalledTimes(1));
    expect(lastSavedFile()).toBe("---\ndisplayName: Box Maintainer\nowner: ashley\n---\n\nBody.\n");
    await waitFor(() => expect(screen.getByTestId("role-view-description").textContent).toBe("No description"));
  });

  it("Esc cancels the edit without saving and without leaving the role", async () => {
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-description"));
    const input = await screen.findByTestId("role-view-description-input");
    fireEvent.change(input, { target: { value: "Never saved" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("role-view-description-input")).toBeNull());
    expect(screen.getByTestId("role-view-description").textContent).toBe("No description");
    expect(screen.getByTestId("role-view-facts")).toBeTruthy();
    expect(m.updateRoleFileByName).not.toHaveBeenCalled();
  });

  it("a stored description longer than the editor's limit isn't cut by clicking in and out", async () => {
    const long = "word ".repeat(80).trim();
    m.getRoleFileByName.mockResolvedValue({ markdown: `---\ndescription: "${long}"\n---\n\n# Box\n` });
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-description"));
    fireEvent.blur(await screen.findByTestId("role-view-description-input"));
    await waitFor(() => expect(screen.queryByTestId("role-view-description-input")).toBeNull());
    expect(m.updateRoleFileByName).not.toHaveBeenCalled();
  });

  it("a multi-line description in the file shows as one line", async () => {
    m.getRoleFileByName.mockResolvedValue({
      markdown: "---\ndescription: >-\n  Keeps the box\n  healthy.\n---\n\n# Box\n",
    });
    await openRole();
    await waitFor(() => expect(screen.getByTestId("role-view-description").textContent).toBe("Keeps the box healthy."));
  });

  it("while the role file is being edited, colour, voice, picture and description are locked", async () => {
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-edit"));
    await screen.findByTestId("mdxeditor");
    expect((screen.getByTestId("role-view-color") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("role-view-voice") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("role-view-avatar-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("role-view-description"));
    expect(screen.queryByTestId("role-view-description-input")).toBeNull();
  });

  it("an unchanged description isn't written", async () => {
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-description"));
    fireEvent.keyDown(await screen.findByTestId("role-view-description-input"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("role-view-description-input")).toBeNull());
    expect(m.updateRoleFileByName).not.toHaveBeenCalled();
  });

  it("a failed save shows the kit alert", async () => {
    const dialogs = autoAnswerKitDialogs();
    m.updateRoleFileByName.mockRejectedValue(new Error("disk full"));
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-description"));
    const input = await screen.findByTestId("role-view-description-input");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Couldn't save the description");
    expect(dialogs.calls[0].opts.body).toBe("disk full");
  });
});

// ─── Facts, tabs ────────────────────────────────────────────────────────────

describe("role view — facts line and tabs", () => {
  it("one agent: '1 agent holds this role · on <host>'", async () => {
    store.identities = [agent("tabitha", ["box-maintainer"])];
    await openRole();
    expect(screen.getByTestId("role-view-facts").textContent).toBe("1 agent holds this role · on thenasty");
  });

  it("several agents: plural; none: 'No agents hold this role'", async () => {
    store.identities = [agent("tabitha", ["box-maintainer"]), agent("rex", ["box-maintainer"])];
    await openRole();
    expect(screen.getByTestId("role-view-facts").textContent).toBe("2 agents hold this role · on thenasty");
    fireEvent.click(backButton());
    await openRoleFromLibrary("ally-role");
    expect(screen.getByTestId("role-view-facts").textContent).toBe("No agents hold this role · on thenasty");
  });

  it("a shared role lives 'on every host' and counts its agents everywhere", async () => {
    store.identities = [agent("sam", ["support-bot"], 9)];
    await openRole("support-bot");
    expect(screen.getByTestId("role-view-facts").textContent).toBe("1 agent holds this role · on every host");
  });

  it("tabs are Role file / Runbooks / Files — no runbook count; Git only when the folder has a repo", async () => {
    m.listRunbooks.mockResolvedValue([{ name: "a" }, { name: "b" }]);
    await openRole();
    const tabs = screen.getByTestId("role-view-tabs");
    expect(Array.from(tabs.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Role file",
      "Runbooks",
      "Files",
    ]);
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    await screen.findByTestId("role-view-runbook-a");
    expect(screen.getByTestId("role-view-tab-runbooks").textContent).toBe("Runbooks");
    expect(screen.queryByTestId("role-view-tab-git")).toBeNull();
  });

  it("shows a Git tab when the role's folder holds a repo", async () => {
    m.hasGitRepos.mockResolvedValue(true);
    await openRole();
    expect(await screen.findByTestId("role-view-tab-git")).toBeTruthy();
  });

  it("the role file reads formatted; Edit → Save writes it", async () => {
    await openRole();
    expect((await screen.findByTestId("role-view-role-file")).querySelector("h1")?.textContent).toBe("Box Maintainer");
    fireEvent.click(screen.getByTestId("role-view-edit"));
    const editor = (await screen.findByTestId("mdxeditor")) as HTMLTextAreaElement;
    expect(editor.value).toBe(DEFAULT_ROLE_FILE);
    expect((screen.getByTestId("role-view-save") as HTMLButtonElement).disabled).toBe(true);
    const next = DEFAULT_ROLE_FILE.replace("Keeps the box healthy.", "Keeps it humming.");
    typeInEditor(editor, { target: { value: next } });
    fireEvent.click(screen.getByTestId("role-view-save"));
    await waitFor(() => expect(m.updateRoleFileByName).toHaveBeenCalledWith("box-maintainer", HOST_ID, next));
    await waitFor(() => expect(screen.getByTestId("role-view-role-file").textContent).toContain("Keeps it humming."));
    expect(screen.getByTestId("role-view-edit")).toBeTruthy();
  });

  it("the editor settling on its own after Edit (no typing) isn't an edit — Cancel leaves without asking", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-edit"));
    // The rich editor re-serialises the file once more, with no user input.
    fireEvent.change(await screen.findByTestId("mdxeditor"), { target: { value: DEFAULT_ROLE_FILE + "\n" } });
    expect((screen.getByTestId("role-view-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("role-view-cancel-edit"));
    await waitFor(() => expect(screen.getByTestId("role-view-edit")).toBeTruthy());
    expect(dialogs.calls).toHaveLength(0);
  });

  it("Esc while editing the role file with changes asks; 'no' keeps the draft", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    await openRole();
    fireEvent.click(await screen.findByTestId("role-view-edit"));
    typeInEditor(await screen.findByTestId("mdxeditor"), { target: { value: "changed" } });
    pressEscape();
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect((screen.getByTestId("mdxeditor") as HTMLTextAreaElement).value).toBe("changed");
  });
});

// ─── Picture, colour, voice ─────────────────────────────────────────────────

describe("role view — picture, colour and voice", () => {
  it("uploading a picture saves the file first, then merges avatar: into the role file", async () => {
    const order: string[] = [];
    m.updateRoleAvatarByName.mockImplementation(async () => {
      order.push("avatar");
      return { filename: "box-maintainer.png", avatarUrl: "/x" };
    });
    m.updateRoleFileByName.mockImplementation(async (_n: string, _h: number, markdown: string) => {
      order.push("file");
      return { markdown };
    });
    await openRole();
    await waitFor(() => expect((screen.getByTestId("role-view-avatar-button") as HTMLButtonElement).disabled).toBe(false));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(order).toEqual(["avatar", "file"]));
    expect(m.updateRoleAvatarByName).toHaveBeenCalledWith(HOST_ID, "box-maintainer", file);
    expect(lastSavedFile()).toMatch(/\navatar: "box-maintainer\.png"\n/);
    expect(lastSavedFile()).toContain("displayName: Box Maintainer");
  });

  it("Voice: pick one and apply → voice: merged into the frontmatter", async () => {
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-voice"));
    const pop = await screen.findByTestId("role-view-voice-popover");
    const select = within(pop).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    fireEvent.change(select, { target: { value: "Matthew" } });
    fireEvent.click(within(pop).getByTestId("voice-picker-apply"));
    await waitFor(() => expect(m.updateRoleFileByName).toHaveBeenCalledTimes(1));
    expect(lastSavedFile()).toBe(
      "---\ndisplayName: Box Maintainer\ncolorHue: '320'\nvoice: Matthew\n---\n\n# Box Maintainer\n\nKeeps the box healthy.\n",
    );
    expect(screen.getByTestId("role-view-voice").textContent).toContain("Matthew");
  });

  it("Colour: the window re-tints while dragging and saves colorHue: when the pop-over closes", async () => {
    await openRole();
    const win = screen.getByTestId("roles-window");
    expect(win.style.getPropertyValue("--pv-id-hue")).toBe("320");
    fireEvent.click(screen.getByTestId("role-view-color"));
    const pop = await screen.findByTestId("role-view-color-popover");
    fireEvent.change(within(pop).getByRole("slider"), { target: { value: "42" } });
    await waitFor(() => expect(win.style.getPropertyValue("--pv-id-hue")).toBe("42"));
    expect(m.updateRoleFileByName).not.toHaveBeenCalled();
    // Click away closes it and commits.
    fireEvent.mouseDown(screen.getByTestId("role-view-facts"));
    await waitFor(() => expect(m.updateRoleFileByName).toHaveBeenCalledTimes(1));
    expect(lastSavedFile()).toContain("colorHue: '42'\n");
    expect(screen.queryByTestId("role-view-color-popover")).toBeNull();
  });

  it("Esc closes the colour pop-over (and commits) without leaving the role", async () => {
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-color"));
    const pop = await screen.findByTestId("role-view-color-popover");
    fireEvent.change(within(pop).getByRole("slider"), { target: { value: "10" } });
    pressEscape();
    await waitFor(() => expect(screen.queryByTestId("role-view-color-popover")).toBeNull());
    await waitFor(() => expect(lastSavedFile()).toContain("colorHue: '10'"));
    expect(screen.getByTestId("role-view-facts")).toBeTruthy();
  });
});

// ─── ⋯ menu ─────────────────────────────────────────────────────────────────

describe("role view — ⋯ menu", () => {
  it("Start a conversation asks for the new-conversation dialog with this role and closes the window", async () => {
    const seen: NewConversationRequest[] = [];
    const onReq = (e: Event): void => {
      seen.push((e as CustomEvent<NewConversationRequest>).detail);
    };
    window.addEventListener(NEW_CONVERSATION_REQUEST_EVENT, onReq);
    try {
      const { onOpenChange } = await openRole();
      const menu = await openMenu("role-view-menu");
      fireEvent.click(within(menu).getByTestId("role-view-start-conversation"));
      await waitFor(() => expect(seen).toEqual([{ hostId: HOST_ID, role: "box-maintainer" }]));
      expect(onOpenChange).toHaveBeenCalledWith(false, "start-conversation");
    } finally {
      window.removeEventListener(NEW_CONVERSATION_REQUEST_EVENT, onReq);
    }
  });

  it("Start a conversation with unsaved role-file edits asks first; 'no' stays and sends nothing", async () => {
    const seen: NewConversationRequest[] = [];
    const onReq = (e: Event): void => {
      seen.push((e as CustomEvent<NewConversationRequest>).detail);
    };
    window.addEventListener(NEW_CONVERSATION_REQUEST_EVENT, onReq);
    try {
      const dialogs = autoAnswerKitDialogs({ confirm: false });
      const { onOpenChange } = await openRole();
      fireEvent.click(await screen.findByTestId("role-view-edit"));
      typeInEditor(await screen.findByTestId("mdxeditor"), { target: { value: "changed" } });
      const menu = await openMenu("role-view-menu");
      fireEvent.click(within(menu).getByTestId("role-view-start-conversation"));
      await waitFor(() => expect(dialogs.calls).toHaveLength(1));
      expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
      expect(seen).toEqual([]);
      expect(onOpenChange).not.toHaveBeenCalled();
      // Still editing. (The test editor is a stand-in the empty-pane guard can
      // swap out after 200ms on a busy run, so check the edit state, not it.)
      expect(screen.getByTestId("role-view-save")).toBeTruthy();
    } finally {
      window.removeEventListener(NEW_CONVERSATION_REQUEST_EVENT, onReq);
    }
  });

  it("a non-admin gets no sharing actions", async () => {
    await openRole();
    const menu = await openMenu("role-view-menu");
    expect(within(menu).queryByTestId("role-view-promote")).toBeNull();
    expect(within(menu).queryByTestId("role-view-stop-sharing")).toBeNull();
    expect(within(menu).getByTestId("role-view-archive")).toBeTruthy();
  });

  it("admin: Make instance-wide… confirms, promotes, and refreshes the shared list", async () => {
    m.listInstanceWide.mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRole();
    const menu = await openMenu("role-view-menu");
    fireEvent.click(within(menu).getByTestId("role-view-promote"));
    await waitFor(() => expect(m.promote).toHaveBeenCalledWith("role", "box-maintainer", HOST_ID));
    expect(m.previewPromote).toHaveBeenCalledWith("role", "box-maintainer", HOST_ID);
    expect(dialogs.calls[0].opts.title).toBe("Make Box Maintainer instance-wide?");
    await waitFor(() => expect(m.listInstanceWide.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByTestId("role-view-facts").textContent).toContain("on every host"));
  });

  it("admin: declining the promote confirm does nothing", async () => {
    m.listInstanceWide.mockResolvedValue({ isAdmin: true, items: [] });
    autoAnswerKitDialogs({ confirm: false });
    await openRole();
    const menu = await openMenu("role-view-menu");
    fireEvent.click(within(menu).getByTestId("role-view-promote"));
    await waitFor(() => expect(m.previewPromote).toHaveBeenCalled());
    expect(m.promote).not.toHaveBeenCalled();
  });

  it("admin: a role too big to share gets an alert, no confirm", async () => {
    m.listInstanceWide.mockResolvedValue({ isAdmin: true, items: [] });
    m.previewPromote.mockResolvedValue({ files: 9000, bytes: 1, tooLarge: true, clashes: [], unreachable: [] });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRole();
    fireEvent.click(within(await openMenu("role-view-menu")).getByTestId("role-view-promote"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].kind).toBe("alert");
    expect(String(dialogs.calls[0].opts.body)).toContain("9000 files");
    expect(m.promote).not.toHaveBeenCalled();
  });

  it("admin: Stop sharing… names how many hosts, removes it everywhere and goes back to the library", async () => {
    m.listInstanceWide.mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRole("support-bot");
    const menu = await openMenu("role-view-menu");
    expect(within(menu).queryByTestId("role-view-promote")).toBeNull();
    fireEvent.click(within(menu).getByTestId("role-view-stop-sharing"));
    await waitFor(() => expect(m.removeInstanceWide).toHaveBeenCalledWith("role", "support-bot"));
    expect(dialogs.calls[0].opts.title).toBe("Stop sharing Support Bot?");
    expect(String(dialogs.calls[0].opts.body)).toMatch(/4 hosts/);
    await expectLibrary();
  });

  it("Archive role… is one confirm naming the agents that hold it; yes archives and returns to the library", async () => {
    store.identities = [
      agent("tabitha", ["box-maintainer"], HOST_ID, "Fix the printer"),
      agent("rex", ["box-maintainer"]),
      agent("other-host", ["box-maintainer"], 9),
    ];
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRole();
    const menu = await openMenu("role-view-menu");
    fireEvent.click(within(menu).getByTestId("role-view-archive"));
    await waitFor(() => expect(m.archiveRole).toHaveBeenCalledWith(HOST_ID, "box-maintainer"));
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].opts.title).toBe("Archive Box Maintainer?");
    expect(dialogs.calls[0].opts.body).toBe("This also archives the 2 agents holding it:\n• Fix the printer\n• Rex");
    await expectLibrary();
    await waitFor(() => expect(screen.queryByTestId("roles-window-row-box-maintainer")).toBeNull());
    expect(screen.getByTestId("roles-window-row-ally-role")).toBeTruthy();
    // The archived list is fetched again (the row count follows).
    expect(m.listArchivedRoles.mock.calls.length).toBeGreaterThan(1);
  });

  it("Archive with no agents says so; 'no' archives nothing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    await openRole();
    fireEvent.click(within(await openMenu("role-view-menu")).getByTestId("role-view-archive"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(String(dialogs.calls[0].opts.body)).toMatch(/^No agents hold it\./);
    expect(m.archiveRole).not.toHaveBeenCalled();
    expect(screen.getByTestId("role-view-facts")).toBeTruthy();
  });

  it("a failed archive shows the kit alert and stays", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    m.archiveRole.mockRejectedValue(new Error("busy"));
    await openRole();
    fireEvent.click(within(await openMenu("role-view-menu")).getByTestId("role-view-archive"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    expect(dialogs.calls[1].opts.title).toBe("Couldn't archive Box Maintainer");
    expect(screen.getByTestId("role-view-facts")).toBeTruthy();
  });

  it("a shared role's Archive is greyed out with 'Stop sharing it first' (admin)", async () => {
    m.listInstanceWide.mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await openRole("support-bot");
    const menu = await openMenu("role-view-menu");
    const archive = within(menu).getByTestId("role-view-archive");
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    expect(archive.textContent).toContain("Stop sharing it first");
    fireEvent.click(archive);
    expect(dialogs.calls).toHaveLength(0);
    expect(m.archiveRole).not.toHaveBeenCalled();
  });
});

// ─── Read-only (non-admin, shared role) ─────────────────────────────────────

describe("role view — a shared role for a non-admin is view-only", () => {
  it("no Edit, no picture button, colour and voice disabled, description not editable, a plain note", async () => {
    await openRole("support-bot");
    await screen.findByTestId("role-view-role-file");
    expect(screen.queryByTestId("role-view-edit")).toBeNull();
    expect(screen.queryByTestId("role-view-avatar-button")).toBeNull();
    expect((screen.getByTestId("role-view-color") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("role-view-voice") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("role-view-readonly-note").textContent).toMatch(/only an admin can change it/i);
    const desc = screen.getByTestId("role-view-description");
    expect(desc.tagName).toBe("P");
    fireEvent.click(desc);
    expect(screen.queryByTestId("role-view-description-input")).toBeNull();
    const menu = await openMenu("role-view-menu");
    expect(within(menu).getByTestId("role-view-archive").getAttribute("aria-disabled")).toBe("true");
    expect(within(menu).getByTestId("role-view-archive").textContent).toContain("Only an admin can change a shared role");
  });

  it("runbooks: listed but no New runbook (also not on the empty state)", async () => {
    m.listRunbooks.mockResolvedValue([{ name: "triage" }]);
    await openRole("support-bot");
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    expect(await screen.findByTestId("role-view-runbook-triage")).toBeTruthy();
    expect(screen.queryByTestId("role-view-new-runbook")).toBeNull();
  });

  it("runbooks empty state has no New runbook either", async () => {
    await openRole("support-bot");
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    expect(await screen.findByText("No runbooks yet")).toBeTruthy();
    expect(screen.queryByTestId("role-view-new-runbook")).toBeNull();
  });

  it("Files tab is read-only: no Upload, New folder or New file", async () => {
    m.listWorkspace.mockResolvedValue({
      entries: [{ name: "notes.md", type: "file", size: 10, mtimeMs: 1, path: "notes.md" }],
      path: "",
    });
    await openRole("support-bot");
    fireEvent.click(screen.getByTestId("role-view-tab-files"));
    expect(await screen.findByText("notes.md")).toBeTruthy();
    expect(m.listWorkspace).toHaveBeenCalledWith({ kind: "role", roleSlug: "support-bot" }, HOST_ID, "");
    expect(screen.queryByRole("button", { name: /^Upload$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^New file$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^New folder$/ })).toBeNull();
  });

  it("the same role is editable for its own host's files when you're an admin", async () => {
    m.listInstanceWide.mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    m.listWorkspace.mockResolvedValue({ entries: [], path: "" });
    await openRole("support-bot");
    expect(await screen.findByTestId("role-view-edit")).toBeTruthy();
    fireEvent.click(screen.getByTestId("role-view-tab-files"));
    expect(await screen.findByRole("button", { name: /^Upload$/ })).toBeTruthy();
  });
});

// ─── Runbooks tab ───────────────────────────────────────────────────────────

describe("role view — runbooks", () => {
  it("lists runbooks title-cased; a row opens the runbook", async () => {
    m.listRunbooks.mockResolvedValue([{ name: "weekly-report" }, { name: "avatar-flow" }]);
    m.enumerateRunbookFiles.mockResolvedValue([{ path: "runbook.md" }]);
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    await screen.findByTestId("role-view-runbook-weekly-report");
    expect(m.listRunbooks).toHaveBeenCalledWith(HOST_ID, "box-maintainer");
    const rows = screen.getAllByTestId(/^role-view-runbook-/).map((r) => r.textContent);
    expect(rows).toEqual(["Avatar Flow", "Weekly Report"]);
    expect(screen.getByTestId("role-view-new-runbook")).toBeTruthy();
    fireEvent.click(screen.getByTestId("role-view-runbook-avatar-flow"));
    expect(await screen.findByText("Avatar Flow")).toBeTruthy();
    expect(m.enumerateRunbookFiles).toHaveBeenCalledWith(HOST_ID, "box-maintainer", "avatar-flow");
  });

  it("New runbook asks for a name, creates it with a starter runbook.md and opens it", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "Weekly report" });
    m.enumerateRunbookFiles.mockResolvedValue([{ path: "runbook.md" }]);
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    fireEvent.click(await screen.findByTestId("role-view-new-runbook"));
    await waitFor(() =>
      expect(m.createRunbook).toHaveBeenCalledWith(HOST_ID, "box-maintainer", "weekly-report", "runbook.md"),
    );
    expect(dialogs.calls[0].kind).toBe("prompt");
    expect(dialogs.calls[0].opts.title).toBe("New runbook");
    await waitFor(() => expect(m.writeRunbookFile).toHaveBeenCalledTimes(1));
    expect(m.writeRunbookFile).toHaveBeenCalledWith({
      hostId: HOST_ID,
      role: "box-maintainer",
      runbook: "weekly-report",
      path: "runbook.md",
      content: "# Weekly report\n\nWhen to use this:\n\nSteps:\n\n1. \n",
      expectedMtime: 5,
    });
    // createRunbook ran before the starter content was written.
    expect(m.createRunbook.mock.invocationCallOrder[0]).toBeLessThan(m.writeRunbookFile.mock.invocationCallOrder[0]);
    // The runbook view opened.
    expect(await screen.findByText("Weekly Report")).toBeTruthy();
    expect(m.enumerateRunbookFiles).toHaveBeenCalledWith(HOST_ID, "box-maintainer", "weekly-report");
  });

  it("a failed starter write still opens the new runbook, with an alert saying its first file is empty", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "Weekly report" });
    m.enumerateRunbookFiles.mockResolvedValue([{ path: "runbook.md" }]);
    m.writeRunbookFile.mockRejectedValueOnce(new Error("disk full"));
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    fireEvent.click(await screen.findByTestId("role-view-new-runbook"));
    expect(await screen.findByText("Weekly Report")).toBeTruthy();
    const alert = dialogs.calls.find((c) => c.kind === "alert");
    expect(alert?.opts.title).toBe("The runbook was made, but its starter text wasn't written");
  });

  it("an existing name shows the kit alert and stays on the runbooks tab", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "Weekly report" });
    m.createRunbook.mockRejectedValue(new RunbookAlreadyExistsError());
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    fireEvent.click(await screen.findByTestId("role-view-new-runbook"));
    await waitFor(() => expect(dialogs.calls.some((c) => c.kind === "alert")).toBe(true));
    const alert = dialogs.calls.find((c) => c.kind === "alert")!;
    expect(alert.opts.title).toBe("Couldn't create the runbook");
    expect(alert.opts.body).toBe('This role already has a runbook called "weekly-report".');
    expect(m.writeRunbookFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("role-view-new-runbook")).toBeTruthy();
  });

  it("a name with nothing sluggable is refused before anything is created", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: "!!!" });
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    fireEvent.click(await screen.findByTestId("role-view-new-runbook"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(2));
    expect(dialogs.calls[1].opts.title).toBe("That name won't work");
    expect(m.createRunbook).not.toHaveBeenCalled();
  });

  it("cancelling the name prompt creates nothing", async () => {
    const dialogs = autoAnswerKitDialogs({ prompt: null });
    await openRole();
    fireEvent.click(screen.getByTestId("role-view-tab-runbooks"));
    fireEvent.click(await screen.findByTestId("role-view-new-runbook"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(m.createRunbook).not.toHaveBeenCalled();
  });
});
