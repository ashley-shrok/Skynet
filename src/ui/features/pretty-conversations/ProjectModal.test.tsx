/**
 * ProjectModal.test.tsx — the project modal (Project file + Files tabs).
 *
 * Behavior surface:
 *   - open=false: nothing in the DOM, nothing fetched
 *   - header shows the project's name; tabs are Project file + Files; it
 *     opens on Project file and fetches project.md for (hostId, slug)
 *   - the editor is seeded with the loaded content (always-edit)
 *   - Save calls updateProjectFile and keeps the modal open
 *   - an unsaved draft survives switching to Files and back; Save shows only
 *     on the Project file tab
 *   - closing with a dirty draft asks first; a clean close doesn't
 *   - the Files tab lists the project folder and hides project.md at the root
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

import { ProjectModal } from "./ProjectModal";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import { listWorkspace } from "@/api/workspace-api";

function renderModal(overrides: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  slug?: string;
  displayName?: string;
  hostId?: number;
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
      />,
    ),
  };
}

async function editor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByTestId("mdxeditor", {}, { timeout: 5000 })) as HTMLTextAreaElement;
}

/** Waits until the editor shows the loaded body, then edits it. */
async function editTo(loaded: string, next: string): Promise<void> {
  await waitFor(async () => expect((await editor()).value).toBe(loaded), { timeout: 5000 });
  fireEvent.change(await editor(), { target: { value: next } });
  await waitFor(() => expect(screen.getByTestId("project-modal-save")).not.toBeDisabled(), { timeout: 5000 });
}

describe("ProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectFileSpy.mockResolvedValue({ markdown: "" });
    updateProjectFileSpy.mockResolvedValue({ markdown: "" });
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

  it("header shows the name; tabs are Project file + Files; opens on Project file", async () => {
    renderModal({ hostId: 42, slug: "banana-project", displayName: "Banana Project" });

    expect(screen.getByText("Banana Project")).toBeInTheDocument();
    expect(screen.getByTestId("project-modal-close")).toBeInTheDocument();
    expect(screen.getByTestId("project-modal-nav-project")).toHaveTextContent("Project file");
    expect(screen.getByTestId("project-modal-nav-files")).toHaveTextContent("Files");
    expect(screen.getByTestId("project-modal-nav-project")).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => expect(getProjectFileSpy).toHaveBeenCalledTimes(1));
    expect(getProjectFileSpy).toHaveBeenCalledWith(42, "banana-project");
    // Files content isn't fetched until its tab is opened.
    expect(listWorkspace).not.toHaveBeenCalled();
  });

  it("the editor is seeded with the loaded content (always-edit)", async () => {
    getProjectFileSpy.mockResolvedValueOnce({
      markdown: "---\ndisplayName: 'Alpha'\n---\n\n# The trip plan",
    });
    renderModal();
    expect((await editor()).value).toBe("---\ndisplayName: 'Alpha'\n---\n\n# The trip plan");
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });

  it("Save calls updateProjectFile(hostId, slug, draft) and keeps the modal open", async () => {
    getProjectFileSpy.mockResolvedValueOnce({ markdown: "old body" });
    updateProjectFileSpy.mockResolvedValueOnce({ markdown: "new body" });
    const { onOpenChange } = renderModal({ hostId: 9, slug: "alpha" });

    await editTo("old body", "new body");
    fireEvent.click(screen.getByTestId("project-modal-save"));

    await waitFor(() => expect(updateProjectFileSpy).toHaveBeenCalledTimes(1));
    expect(updateProjectFileSpy).toHaveBeenCalledWith(9, "alpha", "new body");
    await waitFor(() => expect(screen.getByTestId("project-modal-save")).toBeDisabled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-modal")).toBeInTheDocument();
  });

  it("an unsaved draft survives a trip to Files and back; Save shows only on Project file", async () => {
    getProjectFileSpy.mockResolvedValueOnce({ markdown: "old body" });
    renderModal();

    await editTo("old body", "work in progress");

    fireEvent.click(screen.getByTestId("project-modal-nav-files"));
    await screen.findByText("reference.csv", {}, { timeout: 5000 });
    expect(screen.queryByTestId("project-modal-save")).toBeNull();

    fireEvent.click(screen.getByTestId("project-modal-nav-project"));
    expect((await editor()).value).toBe("work in progress");
    expect(screen.getByTestId("project-modal-save")).not.toBeDisabled();
  });

  it("closing with a dirty draft asks first; declining keeps it open", async () => {
    getProjectFileSpy.mockResolvedValueOnce({ markdown: "old body" });
    const { onOpenChange } = renderModal();

    await editTo("old body", "changed");
    fireEvent.click(screen.getByTestId("project-modal-close-foot"));
    fireEvent.click(await screen.findByTestId("kit-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("kit-dialog-cancel")).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("project-modal-close-foot"));
    fireEvent.click(await screen.findByTestId("kit-dialog-confirm"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("can't be closed while a save is in flight", async () => {
    getProjectFileSpy.mockResolvedValueOnce({ markdown: "old body" });
    let finishSave: (v: { markdown: string }) => void = () => {};
    updateProjectFileSpy.mockImplementationOnce(
      () => new Promise((resolve) => { finishSave = resolve; }),
    );
    const { onOpenChange } = renderModal();

    await editTo("old body", "new body");
    fireEvent.click(screen.getByTestId("project-modal-save"));
    await waitFor(() => expect(updateProjectFileSpy).toHaveBeenCalledTimes(1));

    // Record any dialog request instead of relying on the (async) render.
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    fireEvent.click(screen.getByTestId("project-modal-close"));
    await new Promise((r) => setTimeout(r, 50));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialogs.calls).toHaveLength(0);
    __resetKitDialogsForTests();

    finishSave({ markdown: "new body" });
    await waitFor(() => expect(screen.getByTestId("project-modal-save")).toHaveTextContent("Save"));
  });

  it("a clean close doesn't ask", async () => {
    const { onOpenChange } = renderModal();
    await editor();
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
  });
});
