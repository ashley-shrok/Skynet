/**
 * MarkdownEditor component tests — phase 111, plan 01.
 *
 * Covers the D-06 filetype gate (`.md` case-insensitive → MDXEditor;
 * anything else → raw <textarea>), the D-08 controlled-input contract
 * (`content` prop mirrors into the child, `onChange` fires on user input),
 * disabled-state propagation, and a link-scheme sanitisation canary
 * (javascript: URLs must never surface as href on rendered anchors).
 *
 * `@mdxeditor/editor` is `vi.mock`'d so vitest + jsdom don't collide with
 * Lexical's contentEditable behaviour (RESEARCH.md §Pitfall 5). Every named
 * export the impl imports gets a stub — MDXEditor itself renders a
 * `<div data-testid="mdxeditor">` so we can assert the pretty branch fired.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub the entire @mdxeditor/editor surface. MDXEditor renders a testid div
// with the markdown as text content so tests can inspect what the parent
// piped through. Plugin/component exports are minimal no-ops.
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

import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor — filetype gate (D-06) + controlled-input contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 1: filename='README.md' → renders MDXEditor (pretty branch), no raw textarea", async () => {
    render(
      <MarkdownEditor
        filename="README.md"
        content="# hi"
        onChange={vi.fn()}
      />,
    );
    // Suspense-fallback resolves then the mocked MDXEditor mounts.
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeTruthy();
    });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("test 2: filename='NOTES.MD' (uppercase) → renders MDXEditor (case-insensitive gate)", async () => {
    render(
      <MarkdownEditor filename="NOTES.MD" content="" onChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeTruthy();
    });
  });

  it("test 3: filename='settings.json' → raw <textarea> seeded with content, no MDXEditor", () => {
    render(
      <MarkdownEditor
        filename="settings.json"
        content='{"a":1}'
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe('{"a":1}');
  });

  it("test 4: filename='Dockerfile' (no extension) → raw <textarea>, no MDXEditor", () => {
    render(
      <MarkdownEditor
        filename="Dockerfile"
        content="FROM node"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("test 5: filename='deploy.sh' → raw <textarea>, no MDXEditor", () => {
    render(
      <MarkdownEditor
        filename="deploy.sh"
        content="#!/bin/bash"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("test 6: raw-textarea branch — onChange propagates to prop.onChange", () => {
    const onChange = vi.fn<(next: string) => void>();
    render(
      <MarkdownEditor
        filename="notes.txt"
        content="alpha"
        onChange={onChange}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "alpha beta" } });
    expect(onChange).toHaveBeenCalledWith("alpha beta");
  });

  it("test 7: raw-textarea branch — disabled=true sets the textarea's disabled attribute", () => {
    render(
      <MarkdownEditor
        filename="notes.txt"
        content="foo"
        onChange={vi.fn()}
        disabled
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.disabled).toBe(true);
  });

  it("test 8 (security): javascript: URL in markdown content does NOT surface as href in rendered DOM", async () => {
    // Canary for future regression if the impl ever bypasses MDXEditor's
    // Lexical sanitiser. The mocked MDXEditor renders props.markdown as text
    // only (not as a link), so a javascript: URL in the raw markdown string
    // MUST NOT appear as an anchor href in the rendered DOM.
    const { container } = render(
      <MarkdownEditor
        filename="test.md"
        content="[click me](javascript:alert(1))"
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeTruthy();
    });
    // No anchor with href starting with 'javascript:' anywhere in the tree.
    const anchors = container.querySelectorAll("a");
    for (const a of Array.from(anchors)) {
      const href = a.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
    // The mocked MDXEditor should also NOT have rendered a link at all.
    expect(screen.queryByRole("link")).toBeNull();
  });
});
