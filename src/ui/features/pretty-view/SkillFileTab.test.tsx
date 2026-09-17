/**
 * SkillFileTab component tests — covers the render branches inherited
 * from GlobalFileTab (Phase 23 GEFM-05) plus the two Phase 44 additions:
 *   - Non-text branch (isText: false → AlertTriangle placeholder, no textarea)
 *   - Delete-file Trash2 trigger (fires onRequestDelete)
 *
 * Phase 112 Plan 02a additions:
 *   - Filetype-gate integration tests (D-06): .md filenames route to the
 *     mocked MDXEditor pretty branch; non-.md filenames stay on the raw
 *     <textarea>. Requires the same @mdxeditor/editor vi.mock as
 *     MarkdownEditor.test.tsx (RESEARCH.md §Pitfall 5).
 *   - Existing tests that assert `getByRole('textbox')` on the ready branch
 *     now pass a non-.md filename (e.g. "script.sh") so they continue to hit
 *     the textarea branch after SkillFileTab adopts MarkdownEditor.
 *
 * Tests:
 *   1. loading state renders Skeleton (no textarea)
 *   2. error state renders error message (no textarea)
 *   3. ready with non-empty text content renders textarea seeded with the content
 *   4. ready with empty content + mtime=0 renders EDITABLE textarea (regression
 *      gate for the GlobalFileTab dropped early-return)
 *   5. "No content in this file yet." dead-end copy is GONE (regression gate)
 *   6. save disabled when draft equals state.data.content
 *   7. save enabled after edit
 *   8. NEW: non-text file → renders AlertTriangle placeholder, no textarea
 *   9. NEW: delete-file trigger fires onRequestDelete
 *  10. NEW: mtime reseed on data.mtime change replaces draft
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub the entire @mdxeditor/editor surface (mirrors MarkdownEditor.test.tsx).
// Sidesteps jsdom + Lexical contentEditable friction (RESEARCH.md §Pitfall 5).
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: (props: { markdown: string }) => (
    <div data-testid="mdxeditor">{props.markdown}</div>
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

import SkillFileTab from "./SkillFileTab";

describe("SkillFileTab — render branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 1: loading → Skeleton, no textarea, no error", () => {
    render(
      <SkillFileTab
        state={{ status: "loading" }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Couldn't load file/i)).toBeNull();
  });

  it("test 2: error → renders error message, no textarea", () => {
    render(
      <SkillFileTab
        state={{ status: "error", error: "sftp read failed" }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    expect(screen.getByText(/Couldn't load file/i)).toBeTruthy();
    expect(screen.getByText(/sftp read failed/i)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("test 3: ready with non-empty text content → textarea seeded with content, save disabled until edit", () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "hello", mtime: 42, isText: true },
        }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello");
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.change(ta, { target: { value: "hello world" } });
    expect(saveBtn.disabled).toBe(false);
  });

  it("test 4: ready with empty content + mtime=0 → EDITABLE textarea; type + save creates the file (regression gate for dropped early-return)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "", mtime: 0, isText: true },
        }}
        onSave={onSave}
        filename="script.sh"
      />,
    );

    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("");

    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    fireEvent.change(ta, { target: { value: "new content" } });
    expect(ta.value).toBe("new content");
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("new content", 0);
    });
  });

  it("test 5: 'No content in this file yet.' dead-end copy is GONE (regression gate)", () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "", mtime: 0, isText: true },
        }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    expect(screen.queryByText(/no content in this file yet/i)).toBeNull();
  });

  it("test 6: save disabled when draft equals state.data.content", () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "unchanged", mtime: 100, isText: true },
        }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("test 7: save enabled after edit", () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "base", mtime: 100, isText: true },
        }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "base+edit" } });
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("test 8: non-text file → renders AlertTriangle placeholder, no textarea", () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "", mtime: 42, isText: false },
        }}
        onSave={vi.fn()}
        filename="binary.bin"
      />,
    );
    // No textarea — non-text branch replaces the editor pane entirely.
    expect(screen.queryByRole("textbox")).toBeNull();
    // No save button either.
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    // Placeholder copy present (verbatim per UI-SPEC L165-166).
    expect(screen.getByText(/not a text file/i)).toBeTruthy();
    expect(screen.getByText(/isn't text and can't be edited/i)).toBeTruthy();
  });

  it("test 9: delete-file trigger fires onRequestDelete", () => {
    const onRequestDelete = vi.fn();
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "x", mtime: 1, isText: true },
        }}
        onSave={vi.fn()}
        onRequestDelete={onRequestDelete}
        filename="script.sh"
      />,
    );
    fireEvent.click(screen.getByTitle(/delete this file/i));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it("test 10: mtime reseed on data.mtime change replaces draft", () => {
    const { rerender } = render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "original", mtime: 100, isText: true },
        }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("original");

    // User edits — draft diverges from state.data.content.
    fireEvent.change(ta, { target: { value: "user-edit" } });
    expect(ta.value).toBe("user-edit");

    // Rerender with new mtime (as if a save landed with server-authoritative mtime).
    rerender(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "server-authoritative", mtime: 200, isText: true },
        }}
        onSave={vi.fn()}
        filename="script.sh"
      />,
    );
    // Draft reseeds because mtime changed (the eslint-disabled effect key).
    const ta2 = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta2.value).toBe("server-authoritative");
  });
});

// ── Phase 112 Plan 02a: filetype gate integration (D-06 / D-15) ──────────
// SkillFileTab is now a thin wrapper over MarkdownEditor — the same D-06
// filetype gate that MarkdownEditor.test.tsx covers in isolation must fire
// end-to-end when the tab hosts it. .md filename → mocked MDXEditor renders;
// .sh filename → raw <textarea> renders.
describe("SkillFileTab — filetype gate integration (D-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test A: filename='notes.md' + ready + isText=true → renders MDXEditor (pretty branch), no raw textarea", async () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "# hi", mtime: 1, isText: true },
        }}
        onSave={vi.fn()}
        filename="notes.md"
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeTruthy();
    });
    // Pretty branch replaces the raw <textarea>.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("test B: filename='deploy.sh' + ready + isText=true → renders raw <textarea>, no MDXEditor", () => {
    render(
      <SkillFileTab
        state={{
          status: "ready",
          data: { content: "#!/bin/bash", mtime: 1, isText: true },
        }}
        onSave={vi.fn()}
        filename="deploy.sh"
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("#!/bin/bash");
  });
});
