/**
 * The file window (shape-file-modal 2026-10-22) — one window, wherever a
 * file opens: a file shared in a chat (EditableFileModal) and a file opened
 * from a Files tab (WorkspaceTab's file window). In-process user flows.
 *
 * Both windows, per way a file opens:
 *   - look at (picture): no Edit, no Save;
 *   - read first (markdown): opens locked; Edit brings the formatting tools
 *     and Cancel + Save; Save dimmed until a change; Cancel with changes asks
 *     before discarding;
 *   - ready to work on (code): Save straight away, dimmed until a change;
 *   - text views of look-at types (diff Raw, calendar Source) show Save.
 * Plus: the head shows the name only, the ⋯ menu, the markdown switch in the head (and
 * none in the editor), the phone layout, and what saving means in each
 * window (chat: Save attaches the copy and closes; Files tab: Save writes, then back to reading).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act, configure } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The editors lazy-load; give async waits room under box load.
configure({ asyncUtilTimeout: 10_000 });

const mobileState = { isMobile: false };
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobileState.isMobile }));
vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
  fetchHostFileUrl: vi.fn(),
}));
vi.mock("@/api/workspace-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/workspace-api")>();
  return {
    ...actual,
    listWorkspace: vi.fn(),
    readWorkspaceFile: vi.fn(),
    writeWorkspaceFile: vi.fn(async () => undefined),
  };
});
vi.mock("@mdxeditor/editor", async () => (await import("./file-window.test-mocks")).mdxEditor());
vi.mock("./CodeEditorImpl", async () => (await import("./file-window.test-mocks")).codeEditor());

import EditableFileModal from "./EditableFileModal";
import WorkspaceTab from "./WorkspaceTab";
import { fetchHostFileUrl } from "@/api/editable-file-api";
import { listWorkspace, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry } from "@/api/workspace-api";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import { FORMATTED_UNAVAILABLE_COPY } from "./markdown-mode-switch";
import { UNPARSEABLE } from "./file-window.test-mocks";

const mockedFetch = vi.mocked(fetchHostFileUrl);
const mockedList = vi.mocked(listWorkspace);
const mockedRead = vi.mocked(readWorkspaceFile);
const mockedWrite = vi.mocked(writeWorkspaceFile);

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:1",
  "DTSTART:20261022T100000Z",
  "DTEND:20261022T110000Z",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const CONTENT: Record<string, string> = {
  "notes.md": "# Notes\n\nShip the file window today.",
  "broken.md": `Has ${UNPARSEABLE} markup.`,
  "main.ts": "const answer = 42;\n",
  "change.diff": "--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new\n",
  "invite.ics": ICS,
};

const b64 = (text: string): string => btoa(unescape(encodeURIComponent(text)));

// ── The two windows ─────────────────────────────────────────────────────────

const CHAT_FOLDER = "/home/ubuntu/work";
// A Skynet file URL (this origin's /file/<machine>/<path>), as a chat shares it.
const chatUrl = (name: string): string => `${window.location.origin}/file/harbor${CHAT_FOLDER}/${name}`;

interface WindowDriver {
  name: string;
  saveLabel: string;
  /** Opens `filename`; resolves once the window is on screen. */
  open: (filename: string) => Promise<HTMLElement>;
}

let onStageEditedFile: ReturnType<typeof vi.fn>;
let onOpenChange: ReturnType<typeof vi.fn>;

const chatWindow: WindowDriver = {
  name: "chat file window",
  saveLabel: "Save",
  open: async (filename) => {
    render(
      <EditableFileModal
        open
        onOpenChange={onOpenChange}
        messageEventId="e1"
        url={chatUrl(filename)}
        filename={filename}
        agentIdentityName="tanya"
        onStageEditedFile={onStageEditedFile}
      />,
    );
    return screen.findByTestId("editable-file-modal");
  },
};

const filesTabWindow: WindowDriver = {
  name: "Files-tab file window",
  saveLabel: "Save",
  open: async (filename) => {
    render(<WorkspaceTab target={{ kind: "identity", identityKey: "ada" }} hostId={1} hue={190} />);
    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText(filename));
    return screen.findByTestId("workspace-file-modal");
  },
};

const entry = (path: string, type: "file" | "directory" = "file"): WorkspaceEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  type,
  size: type === "file" ? 100 : null,
  mtimeMs: 0,
  path,
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const head = (win: HTMLElement): HTMLElement => win.querySelector<HTMLElement>('[data-slot="modal-head"]')!;
const subtitleOf = (win: HTMLElement): string =>
  win.querySelector('[data-slot="dialog-description"]')?.textContent ?? "";
const saveButton = (): HTMLButtonElement => screen.getByTestId("file-window-save") as HTMLButtonElement;

async function menuItems(): Promise<string[]> {
  await userEvent.setup().click(screen.getByTestId("file-window-menu"));
  const menu = await screen.findByRole("menu");
  return Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.getAttribute("data-testid") ?? "");
}

/** The markdown editor stand-in, once it's on screen. */
const mdEditor = (): Promise<HTMLTextAreaElement> =>
  screen.findByTestId("mdxeditor") as Promise<HTMLTextAreaElement>;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mobileState.isMobile = false;
  onStageEditedFile = vi.fn();
  onOpenChange = vi.fn();
  mockedFetch.mockImplementation(async (url: string) => {
    const name = url.slice(url.lastIndexOf("/") + 1);
    return {
      contentBase64: b64(CONTENT[name] ?? ""),
      sizeBytes: (CONTENT[name] ?? "").length,
      contentType: null,
      extension: name.split(".").pop() ?? null,
      filename: name,
      isTextByExt: true,
    } as Awaited<ReturnType<typeof fetchHostFileUrl>>;
  });
  mockedList.mockImplementation(async (_t, _h, path) => ({
    path,
    entries:
      path === ""
        ? [entry("docs", "directory")]
        : Object.keys(CONTENT)
            .concat("photo.png")
            .map((n) => entry(`docs/${n}`)),
  }));
  mockedRead.mockImplementation(async (_t, _h, rel) => {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    return {
      contentBase64: b64(CONTENT[name] ?? ""),
      sizeBytes: (CONTENT[name] ?? "").length,
      filename: name,
      extension: name.split(".").pop() ?? null,
    };
  });
  mockedWrite.mockImplementation(async () => undefined);
  // URL-sourced views (calendar Events) read the file themselves.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const name = url.split("?")[0].slice(url.split("?")[0].lastIndexOf("/") + 1);
      return new Response(CONTENT[name] ?? "", { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  __resetKitDialogsForTests();
  vi.unstubAllGlobals();
});

// ── Per kind, in both windows ───────────────────────────────────────────────

describe.each([chatWindow, filesTabWindow])("$name", (w) => {
  it("a picture just shows: no Edit, no Save", async () => {
    const win = await w.open("photo.png");
    expect(await within(win).findByAltText("photo.png")).toBeTruthy();
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    expect(screen.queryByTestId("file-window-save")).toBeNull();
    expect(screen.queryByTestId("file-window-cancel")).toBeNull();
  });

  it("markdown opens for reading; Edit brings the tools, Cancel + Save, Save dimmed until a change", async () => {
    await w.open("notes.md");
    const reading = await mdEditor();
    expect(reading.readOnly).toBe(true);
    expect(screen.queryByTestId("mdx-toolbar")).toBeNull();
    expect(screen.queryByTestId("file-window-save")).toBeNull();

    fireEvent.click(screen.getByTestId("file-window-edit"));
    expect(await screen.findByTestId("mdx-toolbar")).toBeTruthy();
    const editor = await mdEditor();
    expect(editor.readOnly).toBe(false);
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    expect(screen.getByTestId("file-window-cancel")).toBeTruthy();
    expect(saveButton().textContent).toBe(w.saveLabel);
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(editor, { target: { value: "# Notes\n\nChanged." } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it("Cancel with no changes goes straight back to reading", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    await w.open("notes.md");
    await mdEditor();
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    fireEvent.click(screen.getByTestId("file-window-cancel"));
    expect(await screen.findByTestId("file-window-edit")).toBeTruthy();
    expect((await mdEditor()).readOnly).toBe(true);
    expect(dialogs.calls).toHaveLength(0);
  });

  it("Cancel with changes asks first; keeping them stays editing, discarding returns to the file as it was", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const win = await w.open("notes.md");
    await mdEditor();
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    fireEvent.change(await mdEditor(), { target: { value: "draft words" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    // "Keep editing".
    fireEvent.click(screen.getByTestId("file-window-cancel"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    await act(async () => {});
    expect(screen.getByTestId("file-window-cancel")).toBeTruthy();
    expect((await mdEditor()).value).toBe("draft words");

    // "Discard".
    const discard = autoAnswerKitDialogs({ confirm: true });
    fireEvent.click(screen.getByTestId("file-window-cancel"));
    expect(await screen.findByTestId("file-window-edit")).toBeTruthy();
    expect(discard.calls).toHaveLength(1);
    const editor = await mdEditor();
    expect(editor.readOnly).toBe(true);
    expect(editor.value).toBe(CONTENT["notes.md"]);

    // The discarded draft is gone for good: editing again starts clean, and
    // leaving doesn't ask about unsaved changes.
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    await act(async () => {});
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(within(head(win)).getByRole("button", { name: "Close" }));
    await act(async () => {});
    expect(discard.calls).toHaveLength(1);
  });

  it("code opens ready to work on: Save straight away, dimmed until a change", async () => {
    await w.open("main.ts");
    const editor = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(false);
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    expect(screen.queryByTestId("file-window-cancel")).toBeNull();
    expect(saveButton().textContent).toBe(w.saveLabel);
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(editor, { target: { value: "const answer = 43;\n" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it("a diff is looked at; its Raw text view shows Save", async () => {
    await w.open("change.diff");
    await waitFor(() => expect(screen.getByTestId("file-view-mode-raw")).toBeTruthy());
    expect(screen.queryByTestId("file-window-save")).toBeNull();
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    fireEvent.click(screen.getByTestId("file-view-mode-raw"));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
  });

  it("a calendar file is looked at; its Source text view shows Save", async () => {
    await w.open("invite.ics");
    await waitFor(() => expect(screen.getByTestId("file-view-mode-source")).toBeTruthy());
    expect(screen.queryByTestId("file-window-save")).toBeNull();
    fireEvent.click(screen.getByTestId("file-view-mode-source"));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it("the head carries the type tile and name; there's no footer", async () => {
    const win = await w.open("notes.md");
    await mdEditor();
    expect(within(head(win)).getByTestId("file-window-icon")).toBeTruthy();
    expect(within(head(win)).getByText("notes.md")).toBeTruthy();
    expect(win.querySelector('[data-slot="modal-foot"]')).toBeNull();
    expect(screen.queryByTestId("editable-file-modal-close-foot")).toBeNull();
  });

  it("markdown's Formatted / Plain text switch sits in the head, and the editor draws none", async () => {
    const win = await w.open("notes.md");
    await mdEditor();
    expect(within(head(win)).getByTestId("markdown-mode-formatted")).toBeTruthy();
    expect(screen.getAllByTestId("markdown-mode-formatted")).toHaveLength(1);
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();

    // Still only in the head while editing (not at the toolbar's end).
    fireEvent.click(screen.getByTestId("file-window-edit"));
    const toolbar = await screen.findByTestId("mdx-toolbar");
    expect(within(toolbar).queryByTestId("markdown-mode-formatted")).toBeNull();
    expect(screen.getAllByTestId("markdown-mode-formatted")).toHaveLength(1);

    // Switching from the head flips the editor.
    fireEvent.click(within(head(win)).getByTestId("markdown-mode-plain"));
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
  });

  it("when the file can't be shown formatted, the head's Formatted is greyed out with the reason", async () => {
    const win = await w.open("broken.md");
    // The editor falls back to plain text after its empty-pane check.
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
    await waitFor(() =>
      expect((within(head(win)).getByTestId("markdown-mode-formatted") as HTMLButtonElement).disabled).toBe(true),
    );
    expect(within(head(win)).getByTestId("markdown-mode-formatted").title).toBe(FORMATTED_UNAVAILABLE_COPY);
    // A greyed-out segment takes no pointer, so the reason also rides on the whole switch.
    expect(within(head(win)).getByTestId("markdown-mode-switch").title).toBe(FORMATTED_UNAVAILABLE_COPY);
    expect(within(head(win)).getByTestId("markdown-mode-plain").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
  });

  it("a file the formatted view can't show stays plain text through Edit, without retrying formatted", async () => {
    await w.open("broken.md");
    await waitFor(() => expect((screen.getByTestId("markdown-mode-formatted") as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByTestId("file-window-edit"));
    // Right after Edit the rebuilt editor already knows: no formatted attempt.
    expect((screen.getByTestId("markdown-mode-formatted") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
  });

  it("offers read aloud in the head for prose, not in the ⋯ menu", async () => {
    const win = await w.open("notes.md");
    await mdEditor();
    await waitFor(() => expect(within(head(win)).getByTestId("file-speak-button")).toBeTruthy());
    expect(await menuItems()).not.toContain("file-window-speak-item");
  });

  it("phone: the top row keeps name, ⋯ and close; the switch and Edit share a row under it; read aloud moves into ⋯", async () => {
    mobileState.isMobile = true;
    const win = await w.open("notes.md");
    await mdEditor();
    const top = head(win);
    expect(within(top).getByText("notes.md")).toBeTruthy();
    expect(within(top).getByTestId("file-window-menu")).toBeTruthy();
    expect(within(top).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(top).queryByTestId("markdown-mode-formatted")).toBeNull();
    expect(within(top).queryByTestId("file-window-edit")).toBeNull();

    const row = within(win).getByTestId("file-window-switch-row");
    expect(top.contains(row)).toBe(false);
    expect(within(row).getByTestId("markdown-mode-formatted")).toBeTruthy();
    expect(within(row).getByTestId("file-window-edit")).toBeTruthy();
    expect(screen.getAllByTestId("markdown-mode-formatted")).toHaveLength(1);

    // Edit → Cancel + Save in the same row.
    fireEvent.click(within(row).getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    const editingRow = within(win).getByTestId("file-window-switch-row");
    expect(within(editingRow).getByTestId("file-window-cancel")).toBeTruthy();
    expect(within(editingRow).getByTestId("file-window-save").textContent).toBe(w.saveLabel);

    // Read aloud: no head button, first in ⋯ instead.
    expect(screen.queryByTestId("file-speak-button")).toBeNull();
    const items = await menuItems();
    expect(items[0]).toBe("file-window-speak-item");
    expect(items).toContain("file-window-download");
  });

  it("phone: a one-view type that you work on gets the row for its Save only", async () => {
    mobileState.isMobile = true;
    const win = await w.open("main.ts");
    await screen.findByTestId("code-editor");
    const row = await within(win).findByTestId("file-window-switch-row");
    expect(within(row).getByTestId("file-window-save")).toBeTruthy();
    expect(row.querySelector('[data-testid^="file-view-mode-"]')).toBeNull();
    expect(row.querySelector('[data-testid^="markdown-mode-"]')).toBeNull();
    expect(within(head(win)).queryByTestId("file-window-save")).toBeNull();
  });

  it("phone: a picture (one view, nothing to edit) gets no row under the name", async () => {
    mobileState.isMobile = true;
    const win = await w.open("photo.png");
    await within(win).findByAltText("photo.png");
    expect(screen.queryByTestId("file-window-switch-row")).toBeNull();
  });
});

// ── What differs: what saving means, ⋯ menu ─────────────────────────────────

describe("chat file window", () => {
  it("shows the name only — not where the file lives", async () => {
    const win = await chatWindow.open("notes.md");
    expect(subtitleOf(win)).toBe("");
    expect(win.textContent).not.toContain(CHAT_FOLDER);
  });

  it("⋯ holds Download and Copy path", async () => {
    await chatWindow.open("photo.png");
    expect(await menuItems()).toEqual(["file-window-download", "file-window-copy-path"]);
    // userEvent.setup() installs its own clipboard stub — spy after it.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTestId("file-window-copy-path"));
    expect(writeText).toHaveBeenCalledWith(`${CHAT_FOLDER}/photo.png`);
  });

  it("Save hands the edited version to the conversation and closes", async () => {
    await chatWindow.open("notes.md");
    await mdEditor();
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    fireEvent.change(await mdEditor(), { target: { value: "edited copy" } });
    const send = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(send);
    });
    expect(onStageEditedFile).toHaveBeenCalledWith("notes.md", "edited copy");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(["notes.md", "main.ts", "photo.png"])("view-only (no conversation to send to): %s shows no Edit or Save", async (name) => {
    render(
      <EditableFileModal
        open
        onOpenChange={onOpenChange}
        messageEventId="e1"
        url={chatUrl(name)}
        filename={name}
        agentIdentityName="tanya"
      />,
    );
    await screen.findByTestId("editable-file-modal");
    if (name !== "photo.png") await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    expect(screen.queryByTestId("file-window-save")).toBeNull();
    expect(screen.queryByTestId("file-window-cancel")).toBeNull();
  });
});

describe("Files-tab file window", () => {
  it("shows the name only — no Files › folder", async () => {
    const win = await filesTabWindow.open("notes.md");
    expect(subtitleOf(win)).toBe("");
    expect(head(win).textContent).not.toContain("Files ›");
  });

  it("⋯ holds Download (no Copy path — the window doesn't know the full path)", async () => {
    await filesTabWindow.open("photo.png");
    expect(await menuItems()).toEqual(["file-window-download"]);
  });

  it("Save writes the file in place, then a read-first file goes back to reading", async () => {
    await filesTabWindow.open("notes.md");
    await mdEditor();
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    fireEvent.change(await mdEditor(), { target: { value: "saved words" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedWrite).toHaveBeenCalledWith(expect.anything(), 1, "docs/notes.md", "saved words"),
    );
    expect(await screen.findByTestId("file-window-edit")).toBeTruthy();
    const editor = await mdEditor();
    expect(editor.readOnly).toBe(true);
    expect(editor.value).toBe("saved words");
    expect(screen.queryByTestId("mdx-toolbar")).toBeNull();
  });

  it("a failed save keeps you editing, with your changes", async () => {
    mockedWrite.mockRejectedValueOnce(new Error("host_unreachable"));
    await filesTabWindow.open("notes.md");
    await mdEditor();
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    fireEvent.change(await mdEditor(), { target: { value: "unsaved words" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockedWrite).toHaveBeenCalled());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByTestId("file-window-cancel")).toBeTruthy();
    expect((await mdEditor()).value).toBe("unsaved words");
  });

  it("a failed save's error goes away when you cancel the edit", async () => {
    mockedWrite.mockRejectedValueOnce(new Error("host_unreachable"));
    autoAnswerKitDialogs({ confirm: true });
    await filesTabWindow.open("notes.md");
    await mdEditor();
    fireEvent.click(screen.getByTestId("file-window-edit"));
    await screen.findByTestId("mdx-toolbar");
    fireEvent.change(await mdEditor(), { target: { value: "unsaved words" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByTestId("file-window-cancel"));
    expect(await screen.findByTestId("file-window-edit")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a markdown file that can't be read shows no Formatted / Plain text switch", async () => {
    mockedRead.mockRejectedValueOnce(new Error("host_unreachable"));
    const win = await filesTabWindow.open("notes.md");
    await waitFor(() => expect(win.textContent).toMatch(/reach|unreachable|couldn/i));
    expect(screen.queryByTestId("markdown-mode-formatted")).toBeNull();
  });

  it("a code file stays ready to work on after saving", async () => {
    await filesTabWindow.open("main.ts");
    fireEvent.change(await screen.findByTestId("code-editor"), { target: { value: "x" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockedWrite).toHaveBeenCalled());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    expect(((await screen.findByTestId("code-editor")) as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it("a read-only Files tab shows no Edit or Save", async () => {
    render(<WorkspaceTab target={{ kind: "identity", identityKey: "ada" }} hostId={1} hue={190} readOnly />);
    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("notes.md"));
    await mdEditor();
    expect(screen.queryByTestId("file-window-edit")).toBeNull();
    expect(screen.queryByTestId("file-window-save")).toBeNull();
  });
});
