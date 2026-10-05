/**
 * FileView component tests (ported from the retired GlobalFileTab tests) —
 * covers the render branches, with focus on
 * the 2026-08-05 change that dropped the empty-branch early-return so a
 * truly-empty file (content="" && mtime===0) renders the editable textarea
 * and the user can type + save to CREATE the file.
 *
 * Phase 112 Plan 02a additions:
 *   - Filetype-gate integration tests (D-06): .md filenames route to the
 *     mocked MDXEditor pretty branch; non-.md filenames stay on the raw
 *     <textarea>. Requires the same @mdxeditor/editor vi.mock as
 *     MarkdownEditor.test.tsx (RESEARCH.md §Pitfall 5).
 *   - Existing tests that assert `getByRole('textbox')` on the ready branch
 *     now pass a non-.md filename (e.g. "settings.json", "note.txt") so
 *     they continue to hit the textarea branch after FileView adopts
 *     MarkdownEditor. The intent of each test is preserved.
 *
 * Tests:
 *   1. loading state renders Skeleton (no textarea)
 *   2. error state renders error message (no textarea)
 *   3. ready with non-empty content renders textarea seeded with the content
 *   4. ready with empty content + mtime=0 renders EDITABLE textarea (regression
 *      gate for the dropped early-return) — save disabled until user types,
 *      typing enables save, click fires onSave with the draft + mtime=0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub the entire @mdxeditor/editor surface (mirrors MarkdownEditor.test.tsx).
// Sidesteps jsdom + Lexical contentEditable friction (RESEARCH.md §Pitfall 5).
// MDXEditor renders a testid div echoing props.markdown so tests can inspect
// what the parent piped through. Plugin/component exports are minimal no-ops.
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

// Stub CodeEditorImpl (mirrors MarkdownEditor.test.tsx). Mock renders a
// controlled <textarea> so existing `getByRole("textbox")` assertions on
// non-markdown paths continue to work.
vi.mock("../CodeEditorImpl", () => ({
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

import { FileView } from "./FileView";

describe("FileView — render branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 1: loading → Skeleton, no textarea, no error", () => {
    render(
      <FileView
        state={{ status: "loading" }}
        onSave={vi.fn()}
        filename="settings.json"
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Couldn't load file/i)).toBeNull();
  });

  it("test 2: error → renders error message, no textarea", () => {
    render(
      <FileView
        state={{ status: "error", error: "sftp read failed" }}
        onSave={vi.fn()}
        filename="settings.json"
      />,
    );
    expect(screen.getByText(/Couldn't load file/i)).toBeTruthy();
    expect(screen.getByText(/sftp read failed/i)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("test 3: ready with non-empty content → textarea seeded with content, save disabled until edit", async () => {
    render(
      <FileView
        state={{ status: "ready", data: { content: "hello", mtime: 42 } }}
        onSave={vi.fn()}
        filename="settings.json"
      />,
    );
    // CodeEditor lands via Suspense → await first grab.
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(ta.value).toBe("hello");
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.change(ta, { target: { value: "hello world" } });
    expect(saveBtn.disabled).toBe(false);
  });

  it("test 4: ready with empty content + mtime=0 → EDITABLE textarea; type + save creates the file (regression gate for dropped early-return)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <FileView
        state={{ status: "ready", data: { content: "", mtime: 0 } }}
        onSave={onSave}
        filename="settings.json"
      />,
    );

    // Textarea is present and empty (NOT the "No content in this file yet." dead-end).
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(ta.value).toBe("");

    // Save button starts disabled (draft === state.data.content, both "").
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // User types something — save enables.
    fireEvent.change(ta, { target: { value: "new content" } });
    expect(ta.value).toBe("new content");
    expect(saveBtn.disabled).toBe(false);

    // Click save — onSave fires with the draft + mtime=0 (write handler uses
    // mtime=0 as the "create the file" signal via SFTP tmp+rename).
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith("new content", 0);
    });
  });

  it("test 5: 'No content in this file yet.' dead-end copy is GONE (regression gate)", () => {
    render(
      <FileView
        state={{ status: "ready", data: { content: "", mtime: 0 } }}
        onSave={vi.fn()}
        filename="settings.json"
      />,
    );
    expect(screen.queryByText(/no content in this file yet/i)).toBeNull();
  });

  // ── Phase 40 Plan 40-03 (rev-2): optional onDraftChange callback ─────────
  // Backward-compat + firing correctness for the new optional prop consumed
  // by EditableFileModal's draft-guard confirm gate. Existing callers
  // (GlobalFilesModal) omit the prop → hook is a no-op.

  it("test 6 (Plan 40-03): backward-compat — no onDraftChange passed → existing behavior, no throw", async () => {
    // Regression gate: GlobalFilesModal never passes onDraftChange. If the
    // hook throws or misbehaves when the prop is undefined, every Global
    // Files modal user is affected.
    const onSave = vi.fn();
    render(
      <FileView
        state={{ status: "ready", data: { content: "hi", mtime: 1 } }}
        onSave={onSave}
        filename="settings.json"
      />,
    );
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(ta.value).toBe("hi");
    // Typing should not throw — existing tests already verify the wiring;
    // this test asserts prop-omitted no-op semantics.
    fireEvent.change(ta, { target: { value: "hi world" } });
    expect(ta.value).toBe("hi world");
    // No throw, no console error — existing save-flow untouched.
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("test 7 (Plan 40-03): onDraftChange fires false→true→false as draft diverges/converges", async () => {
    const onDraftChange = vi.fn<(dirty: boolean) => void>();
    render(
      <FileView
        state={{ status: "ready", data: { content: "hi", mtime: 1 } }}
        onSave={vi.fn()}
        onDraftChange={onDraftChange}
        filename="settings.json"
      />,
    );
    // Await the CodeEditor Suspense boundary before probing.
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;

    // Mount-time: draft = "" briefly (from useState), then the mtime effect
    // seeds it to "hi" → the onDraftChange effect fires with false (matches).
    // We wait for at least one call to have been made ending in false.
    expect(onDraftChange).toHaveBeenCalled();
    // The most recent call after seeding should be false (clean).
    const lastCallInitial = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1];
    expect(lastCallInitial[0]).toBe(false);

    onDraftChange.mockClear();

    // Diverge → dirty=true
    fireEvent.change(ta, { target: { value: "hi world" } });
    expect(onDraftChange).toHaveBeenCalledWith(true);

    onDraftChange.mockClear();

    // Converge back → dirty=false
    fireEvent.change(ta, { target: { value: "hi" } });
    expect(onDraftChange).toHaveBeenCalledWith(false);
  });
});

// ── Filetype gate integration ────────────────────────────────────────────
// FileView renders MarkdownEditor for text — the same filetype
// gate MarkdownEditor.test.tsx covers in isolation must fire end-to-end
// when the tab hosts it. .md filename → mocked MDXEditor renders;
// non-markdown filename → mocked CodeEditor renders.
describe("FileView — filetype gate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test A: filename='notes.md' + ready → renders MDXEditor (pretty branch), no CodeEditor", async () => {
    render(
      <FileView
        state={{ status: "ready", data: { content: "# hi", mtime: 1 } }}
        onSave={vi.fn()}
        filename="notes.md"
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("mdxeditor")).toBeTruthy();
    });
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });

  it("test B: filename='settings.json' + ready → renders CodeEditor, no MDXEditor", async () => {
    render(
      <FileView
        state={{ status: "ready", data: { content: '{"a":1}', mtime: 1 } }}
        onSave={vi.fn()}
        filename="settings.json"
      />,
    );
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    const ta = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(ta.value).toBe('{"a":1}');
    expect(ta.getAttribute("data-filename")).toBe("settings.json");
  });
});

describe("FileView — registry dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("media with a mediaUrl renders straight from it, even while state is loading", () => {
    render(
      <FileView
        filename="photo.png"
        state={{ status: "loading" }}
        mediaUrl="https://x/file/h/photo.png"
      />,
    );
    const img = screen.getByAltText("photo.png") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://x/file/h/photo.png");
  });

  it("media without a mediaUrl builds a typed blob URL from the fetched bytes", () => {
    const create = vi.fn((_b: Blob) => "blob:fake");
    const revoke = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      const { unmount } = render(
        <FileView
          filename="clip.webm"
          state={{
            status: "ready",
            data: { content: "", mtime: 1, isText: false, bytes: new Uint8Array([1, 2, 3]) },
          }}
        />,
      );
      expect(document.querySelector("video")?.getAttribute("src")).toBe("blob:fake");
      expect((create.mock.calls[0][0] as Blob).type).toBe("video/webm");
      unmount();
      expect(revoke).toHaveBeenCalledWith("blob:fake");
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it("known-binary extension shows the notice with the download link, whatever the state", () => {
    render(
      <FileView
        filename="report.pdf"
        state={{ status: "loading" }}
        downloadUrl="/dl/report.pdf"
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/can't preview this file/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("href")).toBe(
      "/dl/report.pdf",
    );
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("text-type file whose bytes aren't text shows the notice, no editor, no save", () => {
    render(
      <FileView
        filename="mystery.xyz"
        state={{ status: "ready", data: { content: "", mtime: 1, isText: false } }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/can't preview this file/i)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    // No download URL given → no download link.
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
  });

  it("multi-mode types get an inline switcher; SVG flips from rendered to editable source", async () => {
    const onModeChange = vi.fn();
    render(
      <FileView
        filename="logo.svg"
        state={{ status: "ready", data: { content: "<svg/>", mtime: 1, isText: true } }}
        mediaUrl="https://x/file/h/logo.svg"
        onSave={vi.fn()}
        onModeChange={onModeChange}
      />,
    );
    expect(screen.getByAltText("logo.svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    fireEvent.click(screen.getByTestId("file-view-mode-source"));
    expect(onModeChange).toHaveBeenCalledWith("source");
    const editor = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(editor.value).toBe("<svg/>");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
  });

  it("hideModeSwitcher leaves the switcher to the host", () => {
    render(
      <FileView
        filename="logo.svg"
        state={{ status: "loading" }}
        mediaUrl="https://x/file/h/logo.svg"
        hideModeSwitcher
      />,
    );
    expect(screen.queryByTestId("file-view-mode-source")).toBeNull();
  });
});

describe("FileView — diff / patch", () => {
  const PATCH = "--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new\n";

  it("opens rendered (unified), edits in Raw carry back, and Save stays reachable while dirty", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <FileView
        filename="fix.patch"
        state={{ status: "ready", data: { content: PATCH, mtime: 1, isText: true } }}
        onSave={onSave}
      />,
    );
    expect(screen.getByTestId("diff-view")).toBeTruthy();
    expect(screen.getByTestId("file-view-mode-unified").getAttribute("aria-selected")).toBe("true");
    // Read-only rendered mode, clean draft → no Save yet.
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    fireEvent.click(screen.getByTestId("file-view-mode-raw"));
    const raw = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(raw, { target: { value: PATCH.replace("+new", "+newer") } });

    fireEvent.click(screen.getByTestId("file-view-mode-unified"));
    expect(screen.getByTestId("diff-view").textContent).toContain("newer");
    const save = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(save);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(PATCH.replace("+new", "+newer"), 1),
    );
  });
});
