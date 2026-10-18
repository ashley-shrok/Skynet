/**
 * ProjectModal.test.tsx — the project modal (Project file + Files tabs).
 *
 * Behavior surface:
 *   - open=false: nothing in the DOM, nothing fetched
 *   - top: folder tile, name, lineage for a sub-project, the count line;
 *     tabs are Project file + Files; X only, no foot Close
 *   - Project file reads formatted (frontmatter stripped); Edit opens the
 *     editor with Cancel / Save; Save writes and returns to reading
 *   - nothing written → empty state whose "Write it" opens the editor
 *   - unsaved edits ask before Cancel, Esc, X or a tab switch drop them
 *   - no closing mid-save
 *   - Files lists the project folder, hides project.md, "No files yet" when empty
 *
 * MarkdownEditor is stubbed with a controlled <textarea data-testid="mdxeditor">.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Stub the whole MarkdownEditor with a plain controlled textarea. The real
// one lazy-loads MDXEditor and swaps to a source editor when a timer decides
// the rich editor rendered empty — timing these tests have no business with.
vi.mock("@/features/pretty-view/MarkdownEditor", () => ({
  MarkdownEditor: (props: {
    content: string;
    onChange: (next: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      data-testid="mdxeditor"
      value={props.content}
      onChange={(e) => props.onChange(e.target.value)}
      readOnly={props.disabled}
    />
  ),
}));

// Mock the project-file API — spies observed per-test.
const getProjectFileSpy = vi.fn<
  (hostId: number, slug: string) => Promise<{ markdown: string }>
>(async () => ({ markdown: "" }));
const updateProjectFileSpy = vi.fn<
  (hostId: number, slug: string, contents: string) => Promise<{ markdown: string }>
>(async () => ({ markdown: "" }));

vi.mock("@/api/project-list-api", () => ({
  getProjectFile: (hostId: number, slug: string) =>
    getProjectFileSpy(hostId, slug),
  updateProjectFile: (hostId: number, slug: string, contents: string) =>
    updateProjectFileSpy(hostId, slug, contents),
}));

vi.mock("@/api/workspace-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/workspace-api")>();
  return {
    ...actual,
    listWorkspace: vi.fn(async () => ({
      path: "",
      entries: [
        { name: "project.md", type: "file", size: 40, mtimeMs: 0, path: "project.md" },
        { name: "reference.csv", type: "file", size: 1234, mtimeMs: 0, path: "reference.csv" },
      ],
    })),
  };
});

import { ProjectModal, type ProjectContents } from "./ProjectModal";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import { listWorkspace } from "@/api/workspace-api";
import { setProjects } from "@/state/conversation-store";

function renderModal(overrides: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  slug?: string;
  displayName?: string;
  hostId?: number;
  contents?: ProjectContents;
} = {}) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  return {
    onOpenChange,
    ...render(
      <ProjectModal
        open={overrides.open ?? true}
        onOpenChange={onOpenChange}
        slug={overrides.slug ?? "alpha"}
        displayName={overrides.displayName ?? "Alpha"}
        hostId={overrides.hostId ?? 1}
        contents={overrides.contents}
      />,
    ),
  };
}

async function editor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByTestId("mdxeditor", {}, { timeout: 5000 })) as HTMLTextAreaElement;
}

/** Opens the editor on a loaded file and changes it. */
async function editTo(next: string): Promise<void> {
  fireEvent.click(await screen.findByTestId("project-modal-edit", {}, { timeout: 5000 }));
  const ed = await editor();
  fireEvent.keyDown(ed, { key: "a" });
  fireEvent.change(ed, { target: { value: next } });
  await waitFor(() => expect(screen.getByTestId("project-modal-save")).not.toBeDisabled(), { timeout: 5000 });
}

const WRITTEN = "---\ndisplayName: Alpha\nmembers:\n  - copper\n---\n\n# The trip plan\n\nPack light.\n";

describe("ProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectFileSpy.mockResolvedValue({ markdown: WRITTEN });
    updateProjectFileSpy.mockResolvedValue({ markdown: WRITTEN });
    setProjects([]);
  });
  afterEach(() => {
    cleanup();
    __resetKitDialogsForTests();
    vi.restoreAllMocks();
  });

  it("open=false → modal not in the DOM, nothing fetched", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("project-modal")).toBeNull();
    expect(getProjectFileSpy).not.toHaveBeenCalled();
  });

  it("top shows name and count; tabs are Project file + Files; X only, no foot Close", async () => {
    renderModal({
      hostId: 42,
      slug: "banana-project",
      displayName: "Banana Project",
      contents: { conversations: 2, subProjects: 3 },
    });

    const hero = screen.getByTestId("project-modal-hero");
    expect(hero).toHaveTextContent("Banana Project");
    expect(screen.getByTestId("project-modal-count")).toHaveTextContent("2 conversations · 3 sub-projects");
    expect(screen.queryByTestId("project-modal-lineage")).toBeNull();
    expect(screen.getByTestId("project-modal-close")).toBeInTheDocument();
    expect(screen.queryByTestId("project-modal-close-foot")).toBeNull();
    expect(screen.getByTestId("project-modal-nav-project")).toHaveTextContent("Project file");
    expect(screen.getByTestId("project-modal-nav-files")).toHaveTextContent("Files");
    expect(screen.getByTestId("project-modal-nav-project")).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => expect(getProjectFileSpy).toHaveBeenCalledWith(42, "banana-project"));
    // Files content isn't fetched until its tab is opened.
    expect(listWorkspace).not.toHaveBeenCalled();
  });

  it("count drops the sub-project part when there are none; singular wording", () => {
    renderModal({ contents: { conversations: 1, subProjects: 0 } });
    expect(screen.getByTestId("project-modal-count")).toHaveTextContent(/^1 conversation$/);
  });

  it("a sub-project shows its parents top-down, without its own name", () => {
    setProjects([
      { slug: "top", displayName: "Morpheus 2", hostId: "1", hostname: "h", archived: false },
      { slug: "mid", displayName: "M2 · Runs", hostId: "1", hostname: "h", archived: false, parent: "top" },
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "h", archived: false, parent: "mid" },
    ]);
    renderModal();
    expect(screen.getByTestId("project-modal-lineage")).toHaveTextContent("In Morpheus 2 › M2 · Runs");
  });

  it("reads the file formatted, without its settings block, with Edit and read aloud at the foot", async () => {
    renderModal();
    const reading = await screen.findByTestId("project-modal-file");
    expect(reading.querySelector("h1")).toHaveTextContent("The trip plan");
    expect(reading).not.toHaveTextContent("displayName");
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(screen.getByTestId("project-modal-edit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /read aloud|speak/i })).toBeInTheDocument();
  });

  it("nothing written → empty state; Write it opens the editor on the whole file", async () => {
    const bare = "---\ndisplayName: Alpha\nmembers:\n  - copper\n---\n";
    getProjectFileSpy.mockResolvedValueOnce({ markdown: bare });
    renderModal();
    const empty = await screen.findByTestId("project-modal-empty");
    expect(empty).toHaveTextContent("Nothing written yet");
    expect(screen.queryByTestId("project-modal-edit")).toBeNull();
    fireEvent.click(screen.getByTestId("project-modal-write"));
    expect((await editor()).value).toBe(bare);
    expect(screen.getByTestId("project-modal-save")).toBeDisabled();
  });

  it("Edit → Save writes (hostId, slug, draft), returns to reading and keeps the window open", async () => {
    updateProjectFileSpy.mockResolvedValueOnce({ markdown: "# New plan\n" });
    const { onOpenChange } = renderModal({ hostId: 9, slug: "alpha" });

    await editTo("# New plan\n");
    fireEvent.click(screen.getByTestId("project-modal-save"));

    await waitFor(() => expect(updateProjectFileSpy).toHaveBeenCalledWith(9, "alpha", "# New plan\n"));
    expect(await screen.findByTestId("project-modal-file")).toHaveTextContent("New plan");
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("a failed save keeps the editor and the draft, with the error", async () => {
    updateProjectFileSpy.mockRejectedValueOnce(new Error("disk full"));
    renderModal();
    await editTo("changed");
    fireEvent.click(screen.getByTestId("project-modal-save"));
    expect(await screen.findByTestId("project-modal-save-error")).toHaveTextContent("disk full");
    expect((await editor()).value).toBe("changed");
  });

  it("Cancel with unsaved edits asks; Keep editing stays, Discard returns to reading", async () => {
    renderModal();
    await editTo("changed");
    fireEvent.click(screen.getByTestId("project-modal-cancel-edit"));
    fireEvent.click(await screen.findByTestId("kit-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("kit-dialog-cancel")).toBeNull());
    expect((await editor()).value).toBe("changed");

    fireEvent.click(screen.getByTestId("project-modal-cancel-edit"));
    fireEvent.click(await screen.findByTestId("kit-dialog-confirm"));
    expect(await screen.findByTestId("project-modal-file")).toBeInTheDocument();
  });

  it("Cancel without edits doesn't ask", async () => {
    renderModal();
    fireEvent.click(await screen.findByTestId("project-modal-edit"));
    await editor();
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("project-modal-cancel-edit"));
    expect(await screen.findByTestId("project-modal-file")).toBeInTheDocument();
    expect(dialogs.calls).toHaveLength(0);
  });

  it("Esc in the editor leaves the editor (asking when dirty), not the window", async () => {
    const { onOpenChange } = renderModal();
    await editTo("changed");
    const dialogs = autoAnswerKitDialogs({ confirm: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByTestId("project-modal-file")).toBeInTheDocument();
    expect(dialogs.calls).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("switching tabs with unsaved edits asks first; declining stays in the editor", async () => {
    renderModal();
    await editTo("changed");
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("project-modal-nav-files"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(screen.getByTestId("project-modal-nav-project")).toHaveAttribute("aria-pressed", "true");
    expect((await editor()).value).toBe("changed");
  });

  it("closing with unsaved edits asks first; declining keeps it open", async () => {
    const { onOpenChange } = renderModal();
    await editTo("changed");
    fireEvent.click(screen.getByTestId("project-modal-close"));
    fireEvent.click(await screen.findByTestId("kit-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("kit-dialog-cancel")).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("project-modal-close"));
    fireEvent.click(await screen.findByTestId("kit-dialog-confirm"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("can't be closed while a save is in flight", async () => {
    let finishSave: (v: { markdown: string }) => void = () => {};
    updateProjectFileSpy.mockImplementationOnce(
      () => new Promise((resolve) => { finishSave = resolve; }),
    );
    const { onOpenChange } = renderModal();

    await editTo("new body");
    fireEvent.click(screen.getByTestId("project-modal-save"));
    await waitFor(() => expect(updateProjectFileSpy).toHaveBeenCalledTimes(1));

    const dialogs = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("project-modal-close"));
    await new Promise((r) => setTimeout(r, 50));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialogs.calls).toHaveLength(0);
    __resetKitDialogsForTests();

    finishSave({ markdown: "new body" });
    expect(await screen.findByTestId("project-modal-file")).toHaveTextContent("new body");
  });

  it("a clean close doesn't ask", async () => {
    const { onOpenChange } = renderModal();
    await screen.findByTestId("project-modal-file");
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("project-modal-close"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(dialogs.calls).toHaveLength(0);
  });

  it("Files lists the project folder on the project's host and hides project.md at the root", async () => {
    renderModal({ hostId: 7, slug: "launch" });
    fireEvent.click(screen.getByTestId("project-modal-nav-files"));

    await screen.findByText("reference.csv", {}, { timeout: 5000 });
    expect(listWorkspace).toHaveBeenCalledWith({ kind: "project", projectSlug: "launch" }, 7, "");
    expect(screen.queryByText("project.md")).toBeNull();
    expect(screen.queryByTestId("project-modal-edit")).toBeNull();
  });

  it("an empty project folder says No files yet", async () => {
    vi.mocked(listWorkspace).mockResolvedValueOnce({
      path: "",
      entries: [{ name: "project.md", type: "file", size: 40, mtimeMs: 0, path: "project.md" }],
    } as Awaited<ReturnType<typeof listWorkspace>>);
    renderModal();
    fireEvent.click(screen.getByTestId("project-modal-nav-files"));
    expect(await screen.findByTestId("workspace-empty-root", {}, { timeout: 5000 })).toHaveTextContent("No files yet");
  });
});
