/**
 * MarkdownEditor's "Formatted | Plain text" switch: default, remembered
 * choice shared by every markdown editor, no edit from switching, and no
 * switch for non-markdown files. Both lazy editors are mocked the same way
 * as in MarkdownEditor.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useState } from "react";

// Stub the entire @mdxeditor/editor surface. The MDXEditor mock is
// FAITHFUL to the real component's uncontrolled-after-mount contract:
// `markdown` is captured to internal state ONCE on mount and later prop
// changes are ignored — only `ref.current.setMarkdown(next)` updates the
// displayed value. This is what MdxEditorImpl's ref+effect exists to work
// around; a stateless mock would silently mask that bug.
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: forwardRef<
    { setMarkdown: (v: string) => void; getMarkdown: () => string },
    { markdown: string; onChange?: (md: string, initial: boolean) => void }
  >(function MockMDXEditor(props, ref) {
    const [internal, setInternal] = useState(props.markdown);
    useImperativeHandle(ref, () => ({
      setMarkdown: (v: string) => setInternal(v),
      getMarkdown: () => internal,
    }));
    return <div data-testid="mdxeditor">{internal}</div>;
  }),
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

// Stub CodeEditorImpl so tests don't need a real CM6 contentEditable in
// jsdom. The mock renders a controlled <textarea data-testid="code-editor">
// so existing tests that use `getByRole("textbox")` on the non-markdown
// branch continue to work. The mock preserves the controlled-input
// contract (value + onChange + disabled + placeholder).
vi.mock("./CodeEditorImpl", () => ({
  CodeEditorImpl: (props: {
    filename: string;
    content: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="code-editor"
      data-filename={props.filename}
      value={props.content}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.disabled}
      placeholder={props.placeholder}
    />
  ),
}));

import { MarkdownEditor } from "./MarkdownEditor";
import { MARKDOWN_MODE_STORAGE_KEY } from "./markdown-editor-mode-preference";

describe("MarkdownEditor editing-style switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens markdown formatted by default and switches to plain text", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor filename="notes.md" content="# Hi" onChange={onChange} />);
    expect(await screen.findByTestId("mdxeditor")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Formatted" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Plain text" }));
    const code = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(code.value).toBe("# Hi");
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(window.localStorage.getItem(MARKDOWN_MODE_STORAGE_KEY)).toBe("plain");
    // Switching alone never edits the file.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("remembers plain text for every markdown editor, and switching back works", async () => {
    window.localStorage.setItem(MARKDOWN_MODE_STORAGE_KEY, "plain");
    render(
      <>
        <MarkdownEditor filename="a.md" content="A" onChange={() => {}} />
        <MarkdownEditor filename="b.md" content="B" onChange={() => {}} />
      </>,
    );
    expect(await screen.findAllByTestId("code-editor")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("radio", { name: "Formatted" })[0]);
    // Both editors follow the change.
    await waitFor(() => expect(screen.getAllByTestId("mdxeditor")).toHaveLength(2));
    expect(window.localStorage.getItem(MARKDOWN_MODE_STORAGE_KEY)).toBe("formatted");
  });

  it("doesn't show the switch for non-markdown files", async () => {
    render(<MarkdownEditor filename="a.ts" content="x" onChange={() => {}} />);
    await screen.findByTestId("code-editor");
    expect(screen.queryByRole("radiogroup", { name: /markdown editing style/i })).toBeNull();
  });
});
