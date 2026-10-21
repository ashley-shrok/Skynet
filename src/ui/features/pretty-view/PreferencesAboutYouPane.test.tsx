/**
 * PreferencesAboutYouPane — the About-you section of Preferences.
 *
 * Covers:
 *   (1) read view → Edit → Save calls writeGlobalFile; Save stays greyed until changed
 *   (2) multi-machine: Machine row lists only agent-capable machines, preselects
 *       defaultHostId (else the first), and changing it refetches files
 *   (3) multi-file: switcher renders, first tab labeled "About you", switching lazy-loads
 *   (4) 409 conflict: reload confirm; on confirm editor resets; on cancel inline error
 *   (5) one machine → no Machine row; no agent-capable machines → empty state
 *   (6) single-file → no switcher
 *   (7) empty file → "Nothing written yet" + Write it
 *   (8) Cancel / Esc with unsaved writing asks "Discard your changes?"
 *   (9) the registered leave guard asks only while there's unsaved writing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { Host } from "@/types/ui-types";
import type { HostFolder } from "@/types/ui-types";
import { GlobalFileMtimeConflictError } from "@/api/global-files-api";

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ──

// Stub MarkdownEditor with a controlled textarea so getByRole("textbox") works.
// Mirrors the mock in GlobalFilesModal.test.tsx.
vi.mock("@/features/pretty-view/MarkdownEditor", () => ({
  MarkdownEditor: (props: { content: string; onChange: (v: string) => void; disabled?: boolean; filename?: string }) => (
    <textarea
      data-testid="mock-editor"
      value={props.content}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.disabled}
    />
  ),
}));

vi.mock("@/api/global-files-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listGlobalFiles: vi.fn(),
    readGlobalFile: vi.fn(),
    writeGlobalFile: vi.fn(),
  };
});

// ── Late imports (after mocks are registered) ────────────────────────────────

import { PreferencesAboutYouPane } from "./PreferencesAboutYouPane";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import {
  listGlobalFiles,
  readGlobalFile,
  writeGlobalFile,
} from "@/api/global-files-api";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function host(id: string, name: string, runsFleetSubstrate = true): Host {
  return {
    id,
    name,
    enableRdp: false,
    enableSsh: true,
    enableTerminal: true,
    enableTunnel: false,
    enableFileManager: false,
    enableDocker: false,
    enableVnc: false,
    enableTelnet: false,
    username: "ubuntu",
    ip: `10.0.0.${id}`,
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "key",
    serverTunnels: [],
    quickActions: [],
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    runsFleetSubstrate,
  } as Host;
}

const SINGLE_HOST_TREE: HostFolder = {
  name: "root",
  children: [host("1", "thenasty")],
};

const MULTI_HOST_TREE: HostFolder = {
  name: "root",
  children: [host("1", "host-alpha"), host("2", "host-beta")],
};

const SINGLE_FILE_ENTRY = [{ path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" }];
const MULTI_FILE_ENTRIES = [
  { path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" },
  { path: "~/.claude/projects.md", label: "Projects" },
];

/** Read view → Edit → wait for the editor to hold the file. */
async function openEditor(expected = "My preferences content"): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByTestId("preferences-about-you-edit"));
  const editor = (await screen.findByTestId("mock-editor")) as HTMLTextAreaElement;
  expect(editor.value).toBe(expected);
  return editor;
}

/** A user edit: the pane only counts changes after the user touches the
 *  editor (the rich editor re-serialises the file on load). */
function typeInto(editor: HTMLTextAreaElement, value: string): void {
  fireEvent.keyDown(editor, { key: "a" });
  fireEvent.change(editor, { target: { value } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PreferencesAboutYouPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listGlobalFiles).mockResolvedValue(SINGLE_FILE_ENTRY);
    vi.mocked(readGlobalFile).mockResolvedValue({
      content: "My preferences content",
      mtime: 1_700_000_000,
      size: 22,
    });
    vi.mocked(writeGlobalFile).mockResolvedValue({ mtime: 1_700_000_001 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetKitDialogsForTests();
  });

  // ── Case 1: read → Edit → Save ─────────────────────────────────────────────

  it("(1) shows the file formatted; Edit opens the editor; Save writes and returns to reading", async () => {
    vi.mocked(readGlobalFile).mockResolvedValue({
      content: "# Hello\n\nMy preferences content",
      mtime: 1_700_000_000,
      size: 30,
    });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);

    const file = await screen.findByTestId("preferences-about-you-file");
    expect(file.querySelector("h1")?.textContent).toBe("Hello");
    expect(screen.queryByTestId("mock-editor")).toBeNull();
    expect(screen.queryByTestId("preferences-about-you-save")).toBeNull();

    const editor = await openEditor("# Hello\n\nMy preferences content");
    expect(screen.queryByTestId("preferences-about-you-edit")).toBeNull();
    const saveBtn = screen.getByTestId("preferences-about-you-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    typeInto(editor, "Updated content");
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(vi.mocked(writeGlobalFile)).toHaveBeenCalledWith({
        hostId: 1,
        path: "~/.claude/CLAUDE.md",
        content: "Updated content",
        expectedMtime: 1_700_000_000,
      }),
    );
    // Back to reading, showing what was saved.
    await waitFor(() =>
      expect(screen.getByTestId("preferences-about-you-file").textContent).toContain("Updated content"),
    );
    expect(screen.queryByTestId("mock-editor")).toBeNull();
  });

  it("(1b) Cancel with no changes goes straight back to reading (no prompt)", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);
    await openEditor();
    fireEvent.click(screen.getByTestId("preferences-about-you-cancel"));
    await screen.findByTestId("preferences-about-you-file");
    expect(dialogs.calls).toHaveLength(0);
  });

  // ── Case 2: multi-machine ──────────────────────────────────────────────────

  it("(2) Machine row: preselects defaultHostId; changing it refetches files", async () => {
    vi.mocked(listGlobalFiles).mockImplementation(async (hostId: number) =>
      hostId === 1 ? [{ path: "~/.claude/CLAUDE.md" }] : [{ path: "~/.config/notes.md" }],
    );
    render(<PreferencesAboutYouPane hostTree={MULTI_HOST_TREE} defaultHostId={2} />);

    const picker = await screen.findByTestId("preferences-about-you-host-picker");
    const select = picker.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("2");
    await waitFor(() => expect(vi.mocked(listGlobalFiles)).toHaveBeenCalledWith(2));
    expect(vi.mocked(listGlobalFiles)).not.toHaveBeenCalledWith(1);

    fireEvent.change(select, { target: { value: "1" } });
    await waitFor(() => expect(vi.mocked(listGlobalFiles)).toHaveBeenCalledWith(1));
  });

  it("(2b) without defaultHostId the first machine is chosen — never an empty picker", async () => {
    render(<PreferencesAboutYouPane hostTree={MULTI_HOST_TREE} defaultHostId={null} />);
    const picker = await screen.findByTestId("preferences-about-you-host-picker");
    expect((picker.querySelector("select") as HTMLSelectElement).value).toBe("1");
    await waitFor(() => expect(vi.mocked(listGlobalFiles)).toHaveBeenCalledWith(1));
    await screen.findByTestId("preferences-about-you-file");
  });

  it("(2c) lists only machines that can run agents; a defaultHostId that can't is ignored", async () => {
    const tree: HostFolder = {
      name: "root",
      children: [
        host("1", "nas", false),
        { name: "lab", children: [host("2", "agent-a"), { ...host("3", "printer"), runsFleetSubstrate: undefined }] },
        host("4", "agent-b"),
      ],
    };
    render(<PreferencesAboutYouPane hostTree={tree} defaultHostId={1} />);
    const picker = await screen.findByTestId("preferences-about-you-host-picker");
    const select = picker.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["agent-a", "agent-b"]);
    expect(select.value).toBe("2");
    await waitFor(() => expect(vi.mocked(listGlobalFiles)).toHaveBeenCalledWith(2));
    expect(vi.mocked(listGlobalFiles)).not.toHaveBeenCalledWith(1);
  });

  it("(2d) switching machine with unsaved writing asks first; Keep editing stays", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(<PreferencesAboutYouPane hostTree={MULTI_HOST_TREE} defaultHostId={1} />);
    const editor = await openEditor();
    typeInto(editor, "draft");
    const select = screen
      .getByTestId("preferences-about-you-host-picker")
      .querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(vi.mocked(listGlobalFiles)).not.toHaveBeenCalledWith(2);
    expect((screen.getByTestId("mock-editor") as HTMLTextAreaElement).value).toBe("draft");
  });

  // ── Case 3: multi-file ─────────────────────────────────────────────────────

  it("(3) multi-file: switcher renders; first tab labeled 'About you'; switching lazy-loads", async () => {
    vi.mocked(listGlobalFiles).mockResolvedValue(MULTI_FILE_ENTRIES);
    vi.mocked(readGlobalFile).mockImplementation(async (_hostId, path) => ({
      content: `content of ${path}`,
      mtime: 1_700_000_000,
      size: 20,
    }));
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);

    const firstTab = await screen.findByTestId(
      `preferences-about-you-tab-${MULTI_FILE_ENTRIES[0].path}`,
    );
    expect(firstTab.textContent).toBe("About you");
    const secondTab = screen.getByTestId(`preferences-about-you-tab-${MULTI_FILE_ENTRIES[1].path}`);
    expect(secondTab.textContent).toBe("Projects");

    fireEvent.click(secondTab);
    await waitFor(() =>
      expect(vi.mocked(readGlobalFile)).toHaveBeenCalledWith(1, "~/.claude/projects.md"),
    );
  });

  // ── Case 4: 409 conflict ───────────────────────────────────────────────────

  it("(4) 409 conflict: asks to reload; on confirm the editor resets to the disk version", async () => {
    vi.mocked(writeGlobalFile).mockRejectedValue(
      new GlobalFileMtimeConflictError(1_700_000_002, "Server version of the file"),
    );
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);

    const editor = await openEditor();
    typeInto(editor, "My local edits");
    fireEvent.click(screen.getByTestId("preferences-about-you-save"));

    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].kind).toBe("confirm");
    expect(dialogs.calls[0].opts.title).toBe("Reload from disk?");
    expect(String(dialogs.calls[0].opts.body)).toMatch(/changed on disk.*loses your local edits/);
    await waitFor(() =>
      expect((screen.getByTestId("mock-editor") as HTMLTextAreaElement).value).toBe(
        "Server version of the file",
      ),
    );
  });

  it("(4b) 409 conflict, keep my edits: the draft stays and an inline note shows", async () => {
    vi.mocked(writeGlobalFile).mockRejectedValue(
      new GlobalFileMtimeConflictError(1_700_000_002, "Server version of the file"),
    );
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);

    const editor = await openEditor();
    typeInto(editor, "My local edits");
    fireEvent.click(screen.getByTestId("preferences-about-you-save"));

    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    await screen.findByTestId("preferences-about-you-save-error");
    expect((screen.getByTestId("mock-editor") as HTMLTextAreaElement).value).toBe("My local edits");
  });

  // ── Case 5: machine row visibility ─────────────────────────────────────────

  it("(5) one machine: no Machine row", async () => {
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);
    await screen.findByTestId("preferences-about-you-file");
    expect(screen.queryByTestId("preferences-about-you-host-picker")).toBeNull();
  });

  it("(5b) no machine can run agents: says so instead of a picker", async () => {
    const tree: HostFolder = { name: "root", children: [host("1", "nas", false)] };
    render(<PreferencesAboutYouPane hostTree={tree} defaultHostId={null} />);
    expect(screen.getByText("No machines can run agents yet")).toBeTruthy();
    expect(screen.queryByTestId("preferences-about-you-host-picker")).toBeNull();
    expect(vi.mocked(listGlobalFiles)).not.toHaveBeenCalled();
  });

  // ── Case 6: single file ────────────────────────────────────────────────────

  it("(6) single-file: no switcher", async () => {
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);
    await screen.findByTestId("preferences-about-you-file");
    expect(
      screen.queryByTestId(`preferences-about-you-tab-${SINGLE_FILE_ENTRY[0].path}`),
    ).toBeNull();
  });

  // ── Case 7: empty file ─────────────────────────────────────────────────────

  it("(7) empty file: 'Nothing written yet' with Write it, which opens an empty editor", async () => {
    vi.mocked(readGlobalFile).mockResolvedValue({ content: "  \n", mtime: 1_700_000_000, size: 3 });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);

    const empty = await screen.findByTestId("preferences-about-you-empty");
    expect(empty.textContent).toContain("Nothing written yet");
    // No Edit foot while there's nothing to edit.
    expect(screen.queryByTestId("preferences-about-you-edit")).toBeNull();

    fireEvent.click(screen.getByTestId("preferences-about-you-write"));
    const editor = (await screen.findByTestId("mock-editor")) as HTMLTextAreaElement;
    typeInto(editor, "I like tea");
    fireEvent.click(screen.getByTestId("preferences-about-you-save"));
    await waitFor(() =>
      expect(vi.mocked(writeGlobalFile)).toHaveBeenCalledWith(
        expect.objectContaining({ content: "I like tea" }),
      ),
    );
  });

  // ── Case 8: discard prompt ─────────────────────────────────────────────────

  it("(8) Cancel with unsaved writing asks; Keep editing stays, Discard returns to reading", async () => {
    const answers = [false, true];
    const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? false });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);
    const editor = await openEditor();
    typeInto(editor, "half a thought");

    fireEvent.click(screen.getByTestId("preferences-about-you-cancel"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect((screen.getByTestId("mock-editor") as HTMLTextAreaElement).value).toBe("half a thought");

    fireEvent.click(screen.getByTestId("preferences-about-you-cancel"));
    await screen.findByTestId("preferences-about-you-file");
    expect(screen.getByTestId("preferences-about-you-file").textContent).toContain(
      "My preferences content",
    );
    expect(vi.mocked(writeGlobalFile)).not.toHaveBeenCalled();
  });

  it("(8b) Esc while editing with unsaved writing asks before leaving the editor", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);
    const editor = await openEditor();
    typeInto(editor, "half a thought");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    await screen.findByTestId("preferences-about-you-file");
  });

  // ── Case 9: leave guard ────────────────────────────────────────────────────

  it("(9) the leave guard lets the window go freely unless there's unsaved writing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const guardRef: { current: (() => Promise<boolean>) | null } = { current: null };
    const registerLeaveGuard = vi.fn((g: (() => Promise<boolean>) | null) => {
      guardRef.current = g;
    });
    const { unmount } = render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
        registerLeaveGuard={registerLeaveGuard}
      />,
    );
    await screen.findByTestId("preferences-about-you-file");
    expect(guardRef.current).not.toBeNull();
    // Reading: nothing to lose.
    await act(async () => expect(await guardRef.current!()).toBe(true));
    expect(dialogs.calls).toHaveLength(0);

    const editor = await openEditor();
    typeInto(editor, "draft");
    await act(async () => expect(await guardRef.current!()).toBe(false));
    expect(dialogs.calls).toHaveLength(1);
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");

    unmount();
    expect(registerLeaveGuard).toHaveBeenLastCalledWith(null);
  });

  // ── Header ─────────────────────────────────────────────────────────────────

  it("opens with a header saying what the section is for", () => {
    render(<PreferencesAboutYouPane hostTree={SINGLE_HOST_TREE} defaultHostId={1} />);
    const hero = screen.getByTestId("preferences-section-hero");
    expect(hero.textContent).toContain("About you");
    expect(hero.textContent).toContain("Every agent you start on this machine reads this first");
  });
});
