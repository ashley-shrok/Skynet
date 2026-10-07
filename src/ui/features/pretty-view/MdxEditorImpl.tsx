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

import { useEffect, useRef } from "react";
import {
  MDXEditor,
  type MDXEditorMethods,
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
  /** Called whenever MDXEditor's parser can't produce a trustworthy
   *  render — either silently (empty contenteditable despite non-empty
   *  content, detected 200ms post-mount) or loudly (its onError fires
   *  with a MarkdownParseError / UnrecognizedMarkdownConstructError /
   *  JsxKindMismatchError, which can also surface as a PARTIAL render
   *  cut off at the breaking construct). MarkdownEditor uses this to
   *  fall back to the code-editor branch so the user sees the full
   *  file source. */
  onSilentParseFailure?: () => void;
}

export function MdxEditorImpl({
  content,
  onChange,
  disabled,
  onSilentParseFailure,
}: MdxEditorImplProps): JSX.Element {
  // MDXEditor reads the `markdown` prop ONCE at mount and is uncontrolled
  // after — a later `content` change (async load landing after mount, 409
  // reload swapping content in place, per-path draft seed firing the render
  // after tabData became ready) never reaches the editor, and the pane
  // silently shows blank while the file has content. Push subsequent
  // content changes through the imperative `setMarkdown` ref API instead.
  //
  // `lastKnownRef` tracks the value the editor currently holds (seeded from
  // initial `content`, updated on every emitted onChange, updated when we
  // push via setMarkdown). We only push when the incoming prop diverges,
  // so typing (parent echoes the same value back) doesn't loop.
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastKnownRef = useRef<string>(content);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (content === lastKnownRef.current) return;
    lastKnownRef.current = content;
    editorRef.current?.setMarkdown(content);
  }, [content]);

  // Silent-parse-failure detector. MDXEditor's Lexical-based parser doesn't
  // throw on malformed input — it just renders an empty contenteditable
  // pane. Repro: markdown that contains a bare `<foo>` outside of backticks
  // (`Argument: sets X to <thing>.`) breaks the parse. This is common in
  // SKILL.md / CLI-doc content that describes slash-commands with angle-
  // bracket placeholders (`<arg>`) in prose.
  //
  // After mount + any content change, we let the editor settle then compare
  // the contenteditable's textContent against props.content. If the pane is
  // empty (no contenteditable OR contenteditable is empty) while content is
  // non-empty, we call onSilentParseFailure so the caller can swap to a
  // plain textarea. The 200ms delay is enough for MDXEditor to render its
  // full tree (toolbar + editable) in both real browsers and jsdom.
  useEffect(() => {
    if (!onSilentParseFailure) return;
    if (!content) return;
    const timer = setTimeout(() => {
      const editable = rootRef.current?.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      const text = editable ? (editable.textContent ?? "").trim() : "";
      if (text === "") {
        onSilentParseFailure();
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [content, onSilentParseFailure]);

  return (
    <div ref={rootRef} className="h-full w-full">
    <MDXEditor
      ref={editorRef}
      markdown={content}
      onChange={(md, initialMarkdownNormalize) => {
        // MDXEditor re-serialises a file as it loads (bullet style, spacing,
        // final newline). That isn't an edit: passing it on would mark the
        // file changed just by opening it (or switching to Formatted) and
        // rewrite its formatting on the next save.
        if (initialMarkdownNormalize) return;
        lastKnownRef.current = md;
        onChange(md);
      }}
      readOnly={disabled}
      // Disable the mdast-util-mdx-jsx extension so bare `<thing>` /
      // `<slug>` / `<name>` placeholders in prose (common in SKILL.md,
      // role files, runbooks) stop being interpreted as attempted JSX
      // tags and silently rendering an empty editor. Tradeoff: inline
      // HTML tags inside markdown (e.g. `<u>...</u>`, `<kbd>...</kbd>`)
      // no longer render — but Skynet's markdown files are plain
      // prose + code fences, no inline HTML. See
      // https://mdxeditor.dev/editor/docs/error-handling and the UAT
      // round 2026-10-01 where explain + app-development SKILL.md
      // both fell through to the raw-textarea fallback.
      suppressHtmlProcessing={true}
      // Loud parse failure. MDXEditor's tryImportingMarkdown catches
      // MarkdownParseError / UnrecognizedMarkdownConstructError /
      // JsxKindMismatchError, stashes them on markdownProcessingError$,
      // and fires this signal. In SOME failure shapes the Lexical
      // editor stays empty (the silent-failure detector below handles
      // that). In OTHERS the parser emits a PARTIAL tree — the pane
      // renders content up to the breaking construct and then stops —
      // which the empty-pane check never catches. Rule: a parse error
      // emitted at all means we can't trust the rendered output, so
      // propagate to onSilentParseFailure and let MarkdownEditor swap
      // to the code-editor branch. Also log the payload so the next
      // regression doesn't require guesswork at which construct tripped
      // the parser.
      onError={(payload) => {
        // eslint-disable-next-line no-console
        console.error("[MdxEditorImpl] MDXEditor parse error:", payload);
        onSilentParseFailure?.();
      }}
      className="dark-theme skynet-mdxeditor"
      contentEditableClassName="mdx-prose prose prose-sm prose-invert max-w-none prose-code:before:content-none prose-code:after:content-none"
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
    </div>
  );
}
