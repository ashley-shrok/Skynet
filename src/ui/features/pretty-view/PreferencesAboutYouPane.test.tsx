/**
 * PreferencesAboutYouPane — tests for the folded-in About-you editor.
 *
 * Plan 137-05 Task 1 — TDD RED phase.
 *
 * Covers:
 *   (1) single-host single-file happy path: content loads, edit fires setDraft, Save calls writeGlobalFile
 *   (2) multi-host: picker renders, changing selection refetches files
 *   (3) multi-file: tab strip renders, first tab labeled "About you", switching lazy-loads
 *   (4) 409 conflict: window.confirm called; on confirm editor resets to currentContent; on cancel error rethrows
 *   (5) single-host does NOT render host picker
 *   (6) single-file does NOT render tab strip
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
import {
  listGlobalFiles,
  readGlobalFile,
  writeGlobalFile,
} from "@/api/global-files-api";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SINGLE_HOST_TREE: HostFolder = {
  name: "root",
  children: [
    {
      id: "1",
      name: "thenasty",
      enableRdp: false,
      enableSsh: true,
      enableTerminal: true,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableVnc: false,
      enableTelnet: false,
      username: "ubuntu",
      ip: "10.0.0.1",
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
    },
  ],
};

const MULTI_HOST_TREE: HostFolder = {
  name: "root",
  children: [
    {
      id: "1",
      name: "host-alpha",
      enableRdp: false,
      enableSsh: true,
      enableTerminal: true,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableVnc: false,
      enableTelnet: false,
      username: "ubuntu",
      ip: "10.0.0.1",
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
    },
    {
      id: "2",
      name: "host-beta",
      enableRdp: false,
      enableSsh: true,
      enableTerminal: true,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableVnc: false,
      enableTelnet: false,
      username: "ubuntu",
      ip: "10.0.0.2",
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
    },
  ],
};

const SINGLE_FILE_ENTRY = [{ path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" }];
const MULTI_FILE_ENTRIES = [
  { path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" },
  { path: "~/.claude/projects.md", label: "Projects" },
];

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
  });

  // ── Case 1: single-host single-file happy path ────────────────────────────

  it("(1) single-host single-file: content loads, edit fires draft update, Save calls writeGlobalFile with correct args", async () => {
    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );

    // Content should load into the editor (wait for the value, not just presence —
    // the editor renders with empty draft first, then re-renders after readGlobalFile resolves).
    await waitFor(
      () => {
        const el = screen.getByTestId("mock-editor") as HTMLTextAreaElement;
        expect(el.value).toBe("My preferences content");
      },
      { timeout: 2000 },
    );

    const editor = screen.getByTestId("mock-editor") as HTMLTextAreaElement;

    // Edit the content
    fireEvent.change(editor, { target: { value: "Updated content" } });

    // Save button should now be enabled (not disabled attribute)
    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    // Click Save
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(vi.mocked(writeGlobalFile)).toHaveBeenCalledWith({
        hostId: 1,
        path: "~/.claude/CLAUDE.md",
        content: "Updated content",
        expectedMtime: 1_700_000_000,
      }),
    );
  });

  // ── Case 2: multi-host — picker renders, changing selection refetches ────

  it("(2) multi-host: host picker renders with flatHosts.length > 1; changing selection refetches files", async () => {
    vi.mocked(listGlobalFiles).mockImplementation(async (hostId: number) => {
      return hostId === 1
        ? [{ path: "~/.claude/CLAUDE.md" }]
        : [{ path: "~/.config/notes.md" }];
    });
    vi.mocked(readGlobalFile).mockResolvedValue({
      content: "content for host",
      mtime: 1_700_000_000,
      size: 10,
    });

    render(
      <PreferencesAboutYouPane
        hostTree={MULTI_HOST_TREE}
        defaultHostId={1}
      />,
    );

    // Host picker should render
    await waitFor(() => expect(screen.getByTestId("preferences-about-you-host-picker")).toBeTruthy());

    const select = screen.getByTestId("preferences-about-you-host-picker").querySelector("select");
    expect(select).toBeTruthy();

    // Change to host-beta
    fireEvent.change(select!, { target: { value: "2" } });

    // listGlobalFiles should be called again for host 2
    await waitFor(() =>
      expect(vi.mocked(listGlobalFiles)).toHaveBeenCalledWith(2),
    );
  });

  // ── Case 3: multi-file — tab strip renders, first tab "About you" ────────

  it("(3) multi-file: tab strip renders; first tab labeled 'About you' for CLAUDE.md path; switching tabs lazy-loads", async () => {
    vi.mocked(listGlobalFiles).mockResolvedValue(MULTI_FILE_ENTRIES);
    vi.mocked(readGlobalFile).mockImplementation(async (_hostId, path) => ({
      content: `content of ${path}`,
      mtime: 1_700_000_000,
      size: 20,
    }));

    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );

    // Wait for files to load
    await waitFor(() =>
      expect(screen.getByTestId(`preferences-about-you-tab-${MULTI_FILE_ENTRIES[0].path}`)).toBeTruthy(),
    );

    // First tab label should be "About you" (not the filename)
    const firstTab = screen.getByTestId(`preferences-about-you-tab-${MULTI_FILE_ENTRIES[0].path}`);
    expect(firstTab.textContent).toBe("About you");

    // Second tab should use the configured label
    const secondTab = screen.getByTestId(`preferences-about-you-tab-${MULTI_FILE_ENTRIES[1].path}`);
    expect(secondTab.textContent).toBe("Projects");

    // Click the second tab — should trigger readGlobalFile for that path
    fireEvent.click(secondTab);

    await waitFor(() =>
      expect(vi.mocked(readGlobalFile)).toHaveBeenCalledWith(1, "~/.claude/projects.md"),
    );
  });

  // ── Case 4: 409 conflict UX ───────────────────────────────────────────────

  it("(4) 409 conflict: window.confirm called; on confirm editor resets to currentContent; on cancel error rethrows (inline error shown)", async () => {
    const conflictError = new GlobalFileMtimeConflictError(
      1_700_000_002,
      "Server version of the file",
    );
    vi.mocked(writeGlobalFile).mockRejectedValue(conflictError);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeTruthy());

    const editor = screen.getByTestId("mock-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "My local edits" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(
      "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
    ));

    // On confirm=true, editor should reset to server's content
    await waitFor(() => {
      const ed = screen.getByTestId("mock-editor") as HTMLTextAreaElement;
      expect(ed.value).toBe("Server version of the file");
    });

    confirmSpy.mockRestore();
  });

  it("(4b) 409 conflict on cancel: error is shown inline", async () => {
    const conflictError = new GlobalFileMtimeConflictError(
      1_700_000_002,
      "Server version of the file",
    );
    vi.mocked(writeGlobalFile).mockRejectedValue(conflictError);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeTruthy());

    const editor = screen.getByTestId("mock-editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "My local edits" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    // Error should be shown inline after cancel
    await waitFor(() =>
      expect(screen.getByTestId("preferences-about-you-save-error")).toBeTruthy(),
    );

    confirmSpy.mockRestore();
  });

  // ── Case 5: single-host does NOT render host picker ──────────────────────

  it("(5) single-host: host picker is NOT rendered", async () => {
    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );

    // Host picker should not be in the DOM
    expect(screen.queryByTestId("preferences-about-you-host-picker")).toBeNull();
  });

  // ── Case 6: single-file does NOT render tab strip ────────────────────────

  it("(6) single-file: tab strip is NOT rendered", async () => {
    vi.mocked(listGlobalFiles).mockResolvedValue(SINGLE_FILE_ENTRY);

    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeTruthy());

    // Tab buttons should not be in the DOM
    expect(screen.queryByTestId(`preferences-about-you-tab-${SINGLE_FILE_ENTRY[0].path}`)).toBeNull();
  });

  // ── Blurb check ──────────────────────────────────────────────────────────

  it("renders the D-22 blurb verbatim", () => {
    render(
      <PreferencesAboutYouPane
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={1}
      />,
    );
    expect(
      screen.getByText("Tell your agents anything you want them to know about you — how you work, your preferences, anything."),
    ).toBeTruthy();
  });
});
