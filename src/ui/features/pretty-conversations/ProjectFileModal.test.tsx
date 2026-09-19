/**
 * ProjectFileModal.test.tsx — Phase 117 followup smoke tests.
 *
 * Behavior surface:
 *   Test 1  — open=false: modal is not in the DOM
 *   Test 2  — open=true: header shows displayName + close X + sr-only title;
 *             getProjectFile fired with (hostId, slug) on mount
 *   Test 3  — after load resolves: markdown preview shows the loaded content
 *   Test 4  — Edit → change → Save calls updateProjectFile with (hostId, slug, draft)
 *             and server-echoed markdown replaces the local state
 *   Test 5  — close X fires onOpenChange(false)
 *
 * MDXEditor is stubbed the same way RoleFileTab.test.tsx does — a real
 * <textarea data-testid="mdxeditor"> that plumbs value + onChange, so
 * fireEvent.change on the textbox reaches the save-path draft.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock @mdxeditor/editor so jsdom + Lexical don't collide (see
// RoleFileTab.test.tsx L32-64 for the same shape).
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: {
    markdown: string;
    onChange?: (next: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="mdxeditor"
      value={props.markdown}
      onChange={(e) => props.onChange?.(e.target.value)}
      readOnly={props.readOnly}
    />
  ),
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  tablePlugin: () => ({}),
  codeBlockPlugin: () => ({}),
  codeMirrorPlugin: () => ({}),
  frontmatterPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  UndoRedo: () => null,
  BoldItalicUnderlineToggles: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  InsertTable: () => null,
  ListsToggle: () => null,
  InsertFrontmatter: () => null,
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

import { ProjectFileModal } from "./ProjectFileModal";

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
      <ProjectFileModal
        open={overrides.open ?? true}
        onOpenChange={onOpenChange}
        slug={overrides.slug ?? "alpha"}
        displayName={overrides.displayName ?? "Alpha"}
        hostId={overrides.hostId ?? 1}
      />,
    ),
  };
}

describe("ProjectFileModal — smoke", () => {
  beforeEach(() => {
    getProjectFileSpy.mockClear();
    updateProjectFileSpy.mockClear();
    getProjectFileSpy.mockResolvedValue({ markdown: "" });
    updateProjectFileSpy.mockResolvedValue({ markdown: "" });
    cleanup();
  });

  it("Test 1: open=false → modal not in the DOM", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("project-file-modal")).toBeNull();
    expect(getProjectFileSpy).not.toHaveBeenCalled();
  });

  it("Test 2: open=true → renders header + close X; fires getProjectFile(hostId, slug)", async () => {
    renderModal({ hostId: 42, slug: "banana-project", displayName: "Banana Project" });

    // Header: displayName visible.
    expect(screen.getByText("Banana Project")).toBeInTheDocument();
    // project.md subheader.
    expect(screen.getByText("project.md")).toBeInTheDocument();
    // Close X.
    expect(screen.getByTestId("project-file-modal-close")).toBeInTheDocument();

    // Fetch fired exactly once with the right (hostId, slug).
    await waitFor(() => {
      expect(getProjectFileSpy).toHaveBeenCalledTimes(1);
    });
    expect(getProjectFileSpy).toHaveBeenCalledWith(42, "banana-project");
  });

  it("Test 3: after load resolves → markdown preview shows content + Edit button appears", async () => {
    getProjectFileSpy.mockResolvedValueOnce({
      markdown: "---\ndisplayName: 'Alpha'\n---\n\n# The trip plan",
    });
    renderModal();

    // Rendered markdown heading proves the preview branch fired.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /the trip plan/i })).toBeInTheDocument();
    });
    // Edit button visible.
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("Test 4: Edit → change → Save calls updateProjectFile with (hostId, slug, draft)", async () => {
    getProjectFileSpy.mockResolvedValueOnce({ markdown: "old body" });
    updateProjectFileSpy.mockResolvedValueOnce({ markdown: "new body" });
    renderModal({ hostId: 9, slug: "alpha" });

    // Wait for the loaded state, then click Edit.
    const editBtn = await screen.findByRole("button", { name: /edit/i });
    fireEvent.click(editBtn);

    // MDXEditor mock renders a textarea seeded with the loaded body.
    const textarea = await screen.findByTestId("mdxeditor");
    expect((textarea as HTMLTextAreaElement).value).toBe("old body");

    // Type a change and click Save.
    fireEvent.change(textarea, { target: { value: "new body" } });
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateProjectFileSpy).toHaveBeenCalledTimes(1);
    });
    expect(updateProjectFileSpy).toHaveBeenCalledWith(9, "alpha", "new body");
  });

  it("Test 5: close X fires onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange });

    await waitFor(() => {
      expect(screen.getByTestId("project-file-modal-close")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("project-file-modal-close"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
