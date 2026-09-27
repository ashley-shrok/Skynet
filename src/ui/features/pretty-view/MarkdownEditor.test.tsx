/**
 * MarkdownEditor component tests.
 *
 * Covers the filetype gate (`.md` case-insensitive → MDXEditor; anything
 * else → real code editor with a raw-<textarea> load-failure fallback),
 * the controlled-input contract (`content` prop mirrors into the child,
 * `onChange` fires on user input), disabled-state propagation, and a
 * link-scheme sanitisation canary (javascript: URLs must never surface as
 * href on rendered anchors).
 *
 * Both lazy-loaded editors are `vi.mock`'d so vitest + jsdom don't collide
 * with their heavy DOM (Lexical contentEditable for MDXEditor, CodeMirror
 * 6 contentEditable for CodeEditor). Each mock renders a testid'd stand-in
 * that faithfully implements the controlled-input contract so callers can
 * still exercise onChange / disabled / content.
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

  it("test 3: filename='settings.json' → CodeEditor seeded with content, no MDXEditor", async () => {
    render(
      <MarkdownEditor
        filename="settings.json"
        content='{"a":1}'
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    // Suspense boundary — findByTestId awaits resolution of the lazy child.
    const ta = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(ta.value).toBe('{"a":1}');
    expect(ta.getAttribute("data-filename")).toBe("settings.json");
  });

  it("test 4: filename='Dockerfile' (no extension) → CodeEditor, no MDXEditor", async () => {
    render(
      <MarkdownEditor
        filename="Dockerfile"
        content="FROM node"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
  });

  it("test 5: filename='deploy.sh' → CodeEditor, no MDXEditor", async () => {
    render(
      <MarkdownEditor
        filename="deploy.sh"
        content="#!/bin/bash"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
  });

  it("test 6: CodeEditor branch — onChange propagates to prop.onChange", async () => {
    const onChange = vi.fn<(next: string) => void>();
    render(
      <MarkdownEditor
        filename="notes.txt"
        content="alpha"
        onChange={onChange}
      />,
    );
    const ta = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "alpha beta" } });
    expect(onChange).toHaveBeenCalledWith("alpha beta");
  });

  it("test 7: CodeEditor branch — disabled=true propagates through to the editor", async () => {
    render(
      <MarkdownEditor
        filename="notes.txt"
        content="foo"
        onChange={vi.fn()}
        disabled
      />,
    );
    const ta = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(ta.disabled).toBe(true);
  });

  it("test 8: CodeEditor load failure falls back to raw <textarea> preserving content + onChange + disabled", async () => {
    // Simulate the load-failure path: the error boundary catches the
    // thrown error and renders the raw-textarea fallback. We isolate the
    // failure to this test by throwing from the mocked CodeEditorImpl.
    vi.doMock("./CodeEditorImpl", () => ({
      CodeEditorImpl: () => {
        throw new Error("simulated bundle load failure");
      },
    }));
    // Silence the boundary's console.error for this test — otherwise the
    // expected error dominates the test output.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Fresh import so the doMock takes effect for the lazy child.
      vi.resetModules();
      const mod = await import("./MarkdownEditor");
      const onChange = vi.fn<(next: string) => void>();
      const { container } = render(
        <mod.MarkdownEditor
          filename="fallback-test.txt"
          content="alpha"
          onChange={onChange}
          disabled
          placeholder="type something"
        />,
      );
      // Falls back to the raw <textarea>. Look up by role/attributes since
      // the mock CodeEditor won't render (it throws) and the boundary
      // renders the RawTextarea component.
      const ta = await waitFor(() => {
        const el = container.querySelector<HTMLTextAreaElement>("textarea");
        if (!el) throw new Error("no textarea yet");
        return el;
      });
      expect(ta.value).toBe("alpha");
      expect(ta.disabled).toBe(true);
      expect(ta.placeholder).toBe("type something");
      fireEvent.change(ta, { target: { value: "changed" } });
      expect(onChange).toHaveBeenCalledWith("changed");
    } finally {
      errSpy.mockRestore();
      vi.doUnmock("./CodeEditorImpl");
      vi.resetModules();
    }
  });

  it("test 9 (security): javascript: URL in markdown content does NOT surface as href in rendered DOM", async () => {
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
