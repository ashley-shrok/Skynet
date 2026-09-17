/**
 * Phase 22 SRIC-06 / Plan 22-06 Task 3 — RoleFileTab component tests.
 *
 * Byte-shape mirror of IdentityFileTab test coverage (which doesn't have
 * a dedicated file; behaviors are asserted at IdentityModal integration
 * level). This file covers the RoleFileTab's four render states so a future
 * refactor of the shared TabState<string> shape catches the role tab too.
 *
 * Tests (17-20 per plan Task 3 <behavior>):
 *   17. loading → Skeleton placeholders
 *   18. ready without onSave → read-only markdown preview
 *   19. ready with onSave → toolbar, Edit → textarea, Save calls onSave with draft
 *   20. error → renders error message
 *
 * Phase 112 / Plan 02b addendum — MarkdownEditor adoption (D-08):
 *   Edit-mode body now renders `<MarkdownEditor filename="role.md" …>` which
 *   routes through the D-06 pretty branch. `@mdxeditor/editor` is `vi.mock`'d
 *   at the top of the file (mirroring MarkdownEditor.test.tsx) so vitest +
 *   jsdom don't collide with Lexical's contentEditable. The mock renders a
 *   real `<textarea data-testid="mdxeditor">` with props.markdown wired to
 *   props.onChange so existing `getByRole("textbox")` assertions keep firing
 *   against the same code path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub the entire @mdxeditor/editor surface. MDXEditor renders a real
// <textarea> (not a bare <div>) so existing tests that use
// getByRole("textbox") + fireEvent.change keep working against the same
// affordance. This mirrors the shape used in MarkdownEditor.test.tsx.
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

import { RoleFileTab } from "./RoleFileTab";

describe("RoleFileTab — Phase 22 SRIC-06 render states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 17: loading state renders Skeleton placeholders (no textarea, no markdown)", () => {
    render(<RoleFileTab state={{ status: "loading" }} />);
    // Read-mode markdown preview is absent, textarea is absent.
    expect(screen.queryByRole("textbox")).toBeNull();
    // Skeleton uses generic div with rounded class — safest assertion is
    // "no error text present" + "no ready-mode text present".
    expect(screen.queryByText(/Couldn't load role file/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("test 18: ready without onSave renders markdown preview in read-only mode (no toolbar, no textarea)", () => {
    const md = "# Box Maintainer\n\n## Role\n\nKeeps boxes running.";
    render(<RoleFileTab state={{ status: "ready", data: md }} />);
    // Markdown rendered: heading + paragraph text appear in the DOM.
    expect(screen.getByText("Box Maintainer")).toBeTruthy();
    expect(screen.getByText(/Keeps boxes running/)).toBeTruthy();
    // No Edit button (onSave is not threaded)
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    // No textarea (not in edit mode)
    expect(screen.queryByRole("textbox")).toBeNull();
    // MarkdownEditor is only mounted in edit mode — read mode stays on
    // ReactMarkdown, so the mocked MDXEditor testid must be absent.
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
  });

  it("test 19: ready with onSave → Edit toolbar → typing → Save calls onSave with draft; success flips back to read mode", async () => {
    const md = "# Original Body\n";
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleFileTab state={{ status: "ready", data: md }} onSave={onSave} />);

    // Toolbar Edit button visible in ready+onSave mode
    const editBtn = screen.getByRole("button", { name: /edit/i });
    fireEvent.click(editBtn);

    // Edit mode now shows the mocked MDXEditor (rendered as a <textarea
    // data-testid="mdxeditor">). Pre-filled with draft = state.data.
    const textarea = await waitFor(
      () => screen.getByTestId("mdxeditor") as HTMLTextAreaElement,
    );
    expect(textarea.value).toBe(md);

    // Type a new value into the editor's textarea — the mock wires
    // props.onChange to the DOM change event, so setDraft fires.
    const newBody = "# Edited Body\n";
    fireEvent.change(textarea, { target: { value: newBody } });
    expect(textarea.value).toBe(newBody);

    // Save button becomes enabled (draft !== state.data)
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveBtn);

    // onSave invoked with the draft string
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(newBody);
    });

    // After successful save, edit mode collapses back → editor gone.
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeNull();
    });
  });

  it("test 20: error state renders 'Couldn't load role file: <error>' message (no textarea, no markdown)", () => {
    render(
      <RoleFileTab
        state={{ status: "error", error: "identity tina has no role: frontmatter in identity file" }}
      />,
    );

    // Error message present. The mirror of IdentityFileTab uses &apos; (apostrophe entity)
    // in the copy; RTL renders the entity as a normal ' character in the DOM.
    expect(
      screen.getByText(/Couldn't load role file/i),
    ).toBeTruthy();
    expect(screen.getByText(/no role: frontmatter/i)).toBeTruthy();

    // No textarea, no Edit button, no markdown body
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});

describe("RoleFileTab — MarkdownEditor adoption (D-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test D: edit mode with a ready state renders the mocked MDXEditor (role.md → pretty branch)", async () => {
    const md = "# Role\n\nBody.\n";
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleFileTab state={{ status: "ready", data: md }} onSave={onSave} />);

    // Enter edit mode via the toolbar Edit button.
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    // The synthetic filename="role.md" is threaded into MarkdownEditor,
    // which routes through the .md pretty branch, which lazy-mounts
    // MdxEditorImpl, which renders the mocked MDXEditor. The mock exposes
    // a data-testid="mdxeditor" element — assert it appears.
    await waitFor(() => {
      expect(screen.getByTestId("mdxeditor")).toBeTruthy();
    });
  });

  it("test E: read mode preserved unchanged — Edit / Save / Cancel toolbar buttons still work after MarkdownEditor adoption", async () => {
    const md = "# Role\n";
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleFileTab state={{ status: "ready", data: md }} onSave={onSave} />);

    // Start in read mode — Edit visible, Save/Cancel absent.
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();

    // Click Edit — toolbar swaps to Save + Cancel; MDXEditor mounts.
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() => {
      expect(screen.getByTestId("mdxeditor")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();

    // Cancel with no changes returns to read mode without confirm prompt.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeNull();
    });
    // Edit button back.
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    // onSave never called.
    expect(onSave).not.toHaveBeenCalled();
  });
});
