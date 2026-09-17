/**
 * MdxEditorImpl — lazy-loaded MDXEditor wrapper (phase 111, plan 01).
 *
 * Isolated so `MarkdownEditor.tsx` can `React.lazy(() => import(...))` the
 * heavy `@mdxeditor/editor` bundle (Lexical + CodeMirror + Radix Dialog +
 * react-hook-form + js-yaml — ~1.5 MB uncompressed). Mirrors the shape of
 * `SSHAuthDialog.tsx` — the heavy library imports live at module top of the
 * lazy child, never at module top of the caller.
 *
 * Plugin composition per D-03 + RESEARCH §Pattern 2. Dark theme wired via
 * `className="dark-theme skynet-mdxeditor"` (D-11) + the sibling
 * `mdxeditor.dark.css` remaps MDXEditor's `--baseBg`/`--baseText`/… vars to
 * Skynet's `--color-pv-*` tokens.
 */

import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  ListsToggle,
  InsertFrontmatter,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./mdxeditor.dark.css";

interface MdxEditorImplProps {
  content: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function MdxEditorImpl({
  content,
  onChange,
  disabled,
}: MdxEditorImplProps): JSX.Element {
  return (
    <MDXEditor
      markdown={content}
      onChange={onChange}
      readOnly={disabled}
      className="dark-theme skynet-mdxeditor"
      contentEditableClassName="mdx-prose"
      plugins={[
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <UndoRedo />
              <BoldItalicUnderlineToggles />
              <BlockTypeSelect />
              <ListsToggle />
              <CreateLink />
              <InsertTable />
              <InsertFrontmatter />
            </>
          ),
        }),
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: "bash" }),
        codeMirrorPlugin({
          codeBlockLanguages: {
            bash: "Bash",
            sh: "Shell",
            js: "JavaScript",
            ts: "TypeScript",
            tsx: "TSX",
            jsx: "JSX",
            json: "JSON",
            yaml: "YAML",
            md: "Markdown",
            py: "Python",
            "": "Plain",
          },
        }),
        frontmatterPlugin(),
        markdownShortcutPlugin(),
      ]}
    />
  );
}
