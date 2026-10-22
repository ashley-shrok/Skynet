/**
 * MarkdownEditor's "Formatted | Plain text" switch: default, remembered
 * choice shared by every markdown editor, no edit from switching, and no
 * switch for non-markdown files.
 *
 * Where it sits (shape-file-modal 2026-10-22):
 *   - formatted + editable: at the right end of the formatting toolbar;
 *   - plain text, or read-only (no formatting toolbar): in a slim bar
 *     `markdown-editor-bar` above the editor;
 *   - inside a host (file window / file pane) that provides
 *     MarkdownSwitchHostContext: nowhere — the host's header has it, and the
 *     editor reports to the host when the file can't be shown formatted.
 *   - a file the formatted view can't show: Formatted is greyed out with the
 *     reason beside the switch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@mdxeditor/editor", async () => (await import("./file-window.test-mocks")).mdxEditor());
vi.mock("./CodeEditorImpl", async () => (await import("./file-window.test-mocks")).codeEditor());

import { MarkdownEditor } from "./MarkdownEditor";
import { MARKDOWN_MODE_STORAGE_KEY } from "./markdown-editor-mode-preference";
import { FORMATTED_UNAVAILABLE_COPY, MarkdownSwitchHostContext } from "./markdown-mode-switch";
import { UNPARSEABLE } from "./file-window.test-mocks";

const pressed = (el: HTMLElement): string | null => el.getAttribute("aria-pressed");

describe("MarkdownEditor editing-style switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens markdown formatted by default and switches to plain text", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor filename="notes.md" content="# Hi" onChange={onChange} />);
    expect(await screen.findByTestId("mdxeditor")).toBeTruthy();
    expect(pressed(screen.getByTestId("markdown-mode-formatted"))).toBe("true");

    fireEvent.click(screen.getByTestId("markdown-mode-plain"));
    const code = (await screen.findByTestId("code-editor")) as HTMLTextAreaElement;
    expect(code.value).toBe("# Hi");
    expect(screen.queryByTestId("mdxeditor")).toBeNull();
    expect(pressed(screen.getByTestId("markdown-mode-plain"))).toBe("true");
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
    fireEvent.click(screen.getAllByTestId("markdown-mode-formatted")[0]);
    // Both editors follow the change.
    await waitFor(() => expect(screen.getAllByTestId("mdxeditor")).toHaveLength(2));
    expect(window.localStorage.getItem(MARKDOWN_MODE_STORAGE_KEY)).toBe("formatted");
  });

  it("doesn't show the switch for non-markdown files", async () => {
    render(<MarkdownEditor filename="a.ts" content="x" onChange={() => {}} />);
    await screen.findByTestId("code-editor");
    expect(screen.queryByTestId("markdown-mode-formatted")).toBeNull();
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
  });
});

describe("MarkdownEditor switch placement", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("sits at the end of the formatting toolbar when editing formatted, with no row of its own", async () => {
    render(<MarkdownEditor filename="notes.md" content="# Hi" onChange={() => {}} />);
    const toolbar = await screen.findByTestId("mdx-toolbar");
    expect(within(toolbar).getByTestId("markdown-mode-formatted")).toBeTruthy();
    expect(within(toolbar).getByTestId("markdown-mode-plain")).toBeTruthy();
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
    expect(screen.getAllByTestId("markdown-mode-formatted")).toHaveLength(1);
  });

  it("sits in the slim bar above the editor in plain text (no formatting toolbar)", async () => {
    window.localStorage.setItem(MARKDOWN_MODE_STORAGE_KEY, "plain");
    render(<MarkdownEditor filename="notes.md" content="# Hi" onChange={() => {}} />);
    await screen.findByTestId("code-editor");
    const bar = screen.getByTestId("markdown-editor-bar");
    expect(within(bar).getByTestId("markdown-mode-plain")).toBeTruthy();
    expect(screen.queryByTestId("mdx-toolbar")).toBeNull();
  });

  it("sits in the slim bar when the editor is read-only (the formatting toolbar is gone)", async () => {
    render(<MarkdownEditor filename="notes.md" content="# Hi" onChange={() => {}} readOnly />);
    expect(await screen.findByTestId("mdxeditor")).toBeTruthy();
    expect(screen.queryByTestId("mdx-toolbar")).toBeNull();
    const bar = screen.getByTestId("markdown-editor-bar");
    expect(pressed(within(bar).getByTestId("markdown-mode-formatted"))).toBe("true");
  });

  it("draws no switch at all inside a host that shows it in its header", async () => {
    const host = { onFormattedUnavailable: vi.fn() };
    render(
      <MarkdownSwitchHostContext.Provider value={host}>
        <MarkdownEditor filename="notes.md" content="# Hi" onChange={() => {}} />
      </MarkdownSwitchHostContext.Provider>,
    );
    expect(await screen.findByTestId("mdx-toolbar")).toBeTruthy();
    expect(screen.queryByTestId("markdown-mode-formatted")).toBeNull();
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
    // Shown formatted fine: the host is told Formatted is available.
    await new Promise((r) => setTimeout(r, 300));
    expect(host.onFormattedUnavailable).not.toHaveBeenCalledWith(true);
  });

  it("tells the host when the file can't be shown formatted", async () => {
    const host = { onFormattedUnavailable: vi.fn() };
    render(
      <MarkdownSwitchHostContext.Provider value={host}>
        <MarkdownEditor filename="notes.md" content={`Hi ${UNPARSEABLE}`} onChange={() => {}} />
      </MarkdownSwitchHostContext.Provider>,
    );
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
    await waitFor(() => expect(host.onFormattedUnavailable).toHaveBeenLastCalledWith(true));
    expect(screen.queryByTestId("markdown-editor-bar")).toBeNull();
    expect(screen.queryByTestId("markdown-formatted-unavailable")).toBeNull();
  });

  it("greys out Formatted with the reason when the file can't be shown formatted", async () => {
    render(<MarkdownEditor filename="notes.md" content={`Hi ${UNPARSEABLE}`} onChange={() => {}} />);
    // Falls back to plain text after the empty-pane check.
    expect(await screen.findByTestId("code-editor")).toBeTruthy();
    const bar = screen.getByTestId("markdown-editor-bar");
    const formatted = within(bar).getByTestId("markdown-mode-formatted") as HTMLButtonElement;
    expect(formatted.disabled).toBe(true);
    expect(formatted.title).toBe(FORMATTED_UNAVAILABLE_COPY);
    expect(pressed(within(bar).getByTestId("markdown-mode-plain"))).toBe("true");
    expect(within(bar).getByTestId("markdown-formatted-unavailable").textContent).toBe(
      FORMATTED_UNAVAILABLE_COPY,
    );
    // The remembered choice is untouched — only this file stays plain.
    expect(window.localStorage.getItem(MARKDOWN_MODE_STORAGE_KEY)).toBeNull();
  });
});
