// Shared editor stand-ins for the file-window test suites (chat file window,
// Files-tab file window, markdown editor switch placement).
//
// Each suite registers its own (hoisted) vi.mock calls and points the
// factories here, e.g.
//   vi.mock("@mdxeditor/editor", async () => (await import("./file-window.test-mocks")).mdxEditor());
//   vi.mock("./CodeEditorImpl", async () => (await import("./file-window.test-mocks")).codeEditor());
// This module imports nothing from the app, so a factory can load it while
// the module it is mocking is still pending.

import type { ReactNode } from "react";

interface ToolbarPlugin {
  __toolbar: () => ReactNode;
}

/** Markdown carrying this renders an empty pane, as the real editor does on
 *  markup it can't parse — MarkdownEditor then falls back to plain text. */
export const UNPARSEABLE = "<unparseable>";

/**
 * MDXEditor → a textarea (jsdom can't run the real editor), with the
 * formatting toolbar drawn when toolbarPlugin is among the plugins (the real
 * editor only gets it while editable) as `mdx-toolbar`.
 */
export function mdxEditor(): Record<string, unknown> {
  const none = (): null => null;
  const plugin = (): Record<string, never> => ({});
  return {
    MDXEditor: (props: {
      markdown: string;
      onChange?: (v: string) => void;
      readOnly?: boolean;
      plugins?: unknown[];
    }) => {
      const toolbar = (props.plugins ?? []).find(
        (p): p is ToolbarPlugin => !!p && typeof (p as ToolbarPlugin).__toolbar === "function",
      );
      return (
        <div data-testid="mdx-root" data-readonly={props.readOnly ? "true" : "false"}>
          {toolbar ? <div data-testid="mdx-toolbar">{toolbar.__toolbar()}</div> : null}
          {/* Wrapped like the real editor's editable area, carrying the text, so
              the "formatted editor rendered nothing" check doesn't swap it for
              plain text. */}
          {props.markdown.includes(UNPARSEABLE) ? (
            <div contentEditable={false} suppressContentEditableWarning />
          ) : (
            <div contentEditable={false} suppressContentEditableWarning>
              <span hidden>{props.markdown || " "}</span>
              <textarea
                data-testid="mdxeditor"
                value={props.markdown}
                onChange={(e) => props.onChange?.(e.target.value)}
                readOnly={props.readOnly}
              />
            </div>
          )}
        </div>
      );
    },
    headingsPlugin: plugin,
    listsPlugin: plugin,
    quotePlugin: plugin,
    thematicBreakPlugin: plugin,
    markdownShortcutPlugin: plugin,
    linkPlugin: plugin,
    linkDialogPlugin: plugin,
    tablePlugin: plugin,
    codeBlockPlugin: plugin,
    codeMirrorPlugin: plugin,
    frontmatterPlugin: plugin,
    toolbarPlugin: (opts: { toolbarContents: () => ReactNode }): ToolbarPlugin => ({
      __toolbar: opts.toolbarContents,
    }),
    UndoRedo: none,
    BoldItalicUnderlineToggles: none,
    BlockTypeSelect: none,
    CreateLink: none,
    InsertTable: none,
    ListsToggle: none,
    InsertFrontmatter: none,
  };
}

/** CodeEditorImpl → a controlled textarea `code-editor`. */
export function codeEditor(): Record<string, unknown> {
  return {
    CodeEditorImpl: (props: {
      filename: string;
      content: string;
      onChange: (next: string) => void;
      disabled?: boolean;
      readOnly?: boolean;
      placeholder?: string;
    }) => (
      <textarea
        data-testid="code-editor"
        data-filename={props.filename}
        value={props.content}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled && !props.readOnly}
        readOnly={props.readOnly}
        placeholder={props.placeholder}
      />
    ),
  };
}
