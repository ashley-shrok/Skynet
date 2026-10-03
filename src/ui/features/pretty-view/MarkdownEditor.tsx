/**
 * MarkdownEditor — shared controlled editor for every file-edit surface.
 *
 * File-tab surfaces (four file tabs + EditableFileModal + RunbookEditorModal
 * + WorkspaceTab + project-file-tab) plus two prose-input fields (BountyCard
 * premise, AddWakeupDialog instruction) all drop this in place of a raw
 * <textarea>. This component owns:
 *   - The filetype gate: `/\.md$/i` → MDXEditor (pretty); otherwise → a
 *     real code editor with syntax highlighting for every mainstream
 *     language, in the Dracula theme.
 *   - The lazy Suspense boundary: both children (MDXEditor's ~1.5MB
 *     bundle, CodeEditor's ~500KB bundle) are dynamic-imported so callers
 *     that never open one of those filetypes don't pay for it.
 *   - The `key={filename}` remount on the markdown child: MDXEditor is
 *     uncontrolled after mount, so a filename change remounts it. The
 *     code editor is controlled and reconfigures its language compartment
 *     in place — no remount needed there.
 *   - The load-failure fallback: if the code editor's bundle fails to
 *     load (offline, network hiccup, server outage), gracefully drop back
 *     to the raw <textarea> so the user can still edit their file.
 *
 * Callers are responsible for the `content` state + `onChange` handler
 * (controlled input). The component NEVER knows about "save"; that stays
 * with each caller's existing handler.
 */

import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";

// Lazy-loaded: @mdxeditor/editor bundles Lexical + CodeMirror + Radix
// Dialog + react-hook-form + js-yaml — ~1.5MB uncompressed. Only paid for
// on first mount of a .md-filetype editor. Mirrors the shape at
// src/ui/features/terminal/Terminal.tsx L34-39.
const MdxEditorImpl = lazy(() => import("./MdxEditorImpl").then((m) => ({ default: m.MdxEditorImpl })));

// Lazy-loaded: CodeMirror 6 + Dracula theme + every mainstream language
// pack (@codemirror/lang-* + @codemirror/legacy-modes). Only paid for on
// first mount of a non-markdown filetype in the session.
const CodeEditorImpl = lazy(() =>
  import("./CodeEditorImpl").then((m) => ({ default: m.CodeEditorImpl })),
);

export interface MarkdownEditorProps {
  /** Filename (with extension) — drives the D-06 filetype gate. Pass a
   *  synthetic `.md` name for markdown-content fields that don't map to a
   *  file (BountyCard premise → "premise.md", AddWakeupDialog instruction
   *  → "wakeup.md"). */
  filename: string;
  /** Current content (controlled). */
  content: string;
  /** Called on every keystroke (pretty mode) / every input event (raw
   *  mode). Parent owns the string. */
  onChange: (next: string) => void;
  /** When true, the editor is read-only. Wire from saving state or
   *  view-mode. */
  disabled?: boolean;
  /** Optional placeholder — only visible on the raw <textarea> branch. */
  placeholder?: string;
}

// Textarea styling copied VERBATIM from GlobalFileTab.tsx L106-111 per the
// project directive `do NOT reinvent, it's tuned` (see the load-bearing
// comment at GlobalFileTab.tsx L102-103). Same class survives across all
// four file tabs today; consolidating it here keeps the visual contract.
// Reused as: (1) the load-failure fallback for the code editor branch;
// (2) tests that check for the raw-textarea path continue to work when
// the code editor's bundle can't be loaded.
const RAW_TEXTAREA_CLASS =
  "font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]";

interface RawTextareaProps {
  content: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function RawTextarea({ content, onChange, disabled, placeholder }: RawTextareaProps): JSX.Element {
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      className={RAW_TEXTAREA_CLASS}
      spellCheck={false}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

// Error boundary that catches failures in the lazy-loaded code editor and
// falls back to the raw <textarea> so users can still edit their file.
// React.lazy() rejects on import failure and the error propagates here.
interface CodeEditorErrorBoundaryProps {
  fallback: ReactNode;
  filename: string;
  children: ReactNode;
  /** Fired on catch so the parent can also flip its own sticky-fallback
   *  state. Used by the MdxEditor-branch wrap so a thrown parse exception
   *  prevents the next render from re-mounting the throwing child. */
  onError?: () => void;
}

interface CodeEditorErrorBoundaryState {
  hasError: boolean;
  errorFilename: string | null;
}

class CodeEditorErrorBoundary extends Component<
  CodeEditorErrorBoundaryProps,
  CodeEditorErrorBoundaryState
> {
  state: CodeEditorErrorBoundaryState = { hasError: false, errorFilename: null };

  static getDerivedStateFromError(): Partial<CodeEditorErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Record which filename tripped the failure so a later filename change
    // can reset the boundary.
    this.setState({ errorFilename: this.props.filename });
    this.props.onError?.();
    // eslint-disable-next-line no-console
    console.error(
      `[MarkdownEditor] Editor subtree crashed for filename=${this.props.filename}; falling back.`,
      error,
    );
  }

  componentDidUpdate(prevProps: CodeEditorErrorBoundaryProps): void {
    // Reset the boundary when the user navigates to a different file — one
    // transient load failure shouldn't trap a long-lived consumer (e.g. a
    // modal that stays mounted across file switches).
    if (
      this.state.hasError &&
      prevProps.filename !== this.props.filename &&
      this.state.errorFilename !== this.props.filename
    ) {
      this.setState({ hasError: false, errorFilename: null });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function MarkdownEditor({
  filename,
  content,
  onChange,
  disabled,
  placeholder,
}: MarkdownEditorProps): JSX.Element {
  const isMarkdown = /\.md$/i.test(filename);

  // Suspense fallback used for both branches — same visual pane. On first
  // open (before the ~1.5MB markdown chunk or the code-editor chunk is
  // cached) the placeholder reserves layout so nothing jumps when the
  // editor materializes. `role="status"` + `aria-live="polite"` announce
  // the loading state to assistive tech.
  const loadingFallback = (
    <div
      role="status"
      aria-live="polite"
      className="w-full h-full min-h-[400px] rounded-md bg-black/20 border border-white/10 flex items-center justify-center text-white/40 text-sm"
    >
      Loading editor…
    </div>
  );

  if (!isMarkdown) {
    // Non-markdown files → real code editor, wrapped in an error boundary
    // that falls back to the raw textarea if the bundle fails to load.
    // This is what makes an offline / network-hiccup / server-outage
    // scenario still leave the user able to edit their file.
    return (
      <CodeEditorErrorBoundary
        filename={filename}
        fallback={
          <RawTextarea
            content={content}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
          />
        }
      >
        <Suspense fallback={loadingFallback}>
          <CodeEditorImpl
            filename={filename}
            content={content}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
          />
        </Suspense>
      </CodeEditorErrorBoundary>
    );
  }

  return (
    <MarkdownWithSilentFailureFallback
      filename={filename}
      content={content}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      loadingFallback={loadingFallback}
    />
  );
}

// Splits out the .md branch so we can hold local state for the "MDXEditor
// silently rendered empty" fallback. MDXEditor's Lexical parser doesn't
// have a clean path for several agent-authored constructs in markdown
// prose — HTML comments (`<!-- ... -->`), bare `<role>` / `<name>`
// placeholders, YAML frontmatter edge cases — and when any of them hits,
// the editor renders an empty contenteditable with no error. The
// mdx-editor maintainer has acknowledged this architectural limit (issue
// #903); flipping `suppressHtmlProcessing` only trades one failure path
// for another. See 2026-10-01 research under
// `.planning/<phase>/RESEARCH.md`.
//
// When MdxEditorImpl fires onSilentParseFailure, we swap to CodeEditorImpl
// with the markdown language pack loaded — a real syntax-highlighted
// source editor with line numbers in the Dracula theme. Byte-exact
// roundtrip on save (the source IS the display), so HTML comments,
// placeholders, frontmatter all survive. This matches the industry's
// dominant pattern for agent-touched markdown: Zed, VS Code, iA Writer,
// Zettlr, Logseq, StackEdit, HedgeDoc all take the same "source-first
// with syntax highlighting" shape. Cursor conditionally disables its
// WYSIWYG for files under `.claude/` paths for the same reason; we do it
// automatically when the pretty editor can't actually render the content.
function MarkdownWithSilentFailureFallback({
  filename,
  content,
  onChange,
  disabled,
  placeholder,
  loadingFallback,
}: MarkdownEditorProps & { loadingFallback: ReactNode }): JSX.Element {
  // Sticky per-mount fallback. Once MdxEditor has failed for this filename
  // — silently (empty contenteditable detected 200ms post-mount) OR by
  // throwing from inside its useMemo-based import pipeline (js-yaml's
  // YAMLException on malformed frontmatter is the known trigger) — stay in
  // the code-editor branch for the rest of this filename's lifetime in the
  // UI. The previous content-keyed check broke the moment the user typed
  // one character inside the fallback: equality snapped, the branch flipped
  // back to MdxEditor, which either re-silent-failed (losing focus every
  // keystroke) or re-threw and crashed the whole app (no boundary wrapped
  // this branch before). Reset only on filename change — switching tabs
  // re-attempts MdxEditor cleanly.
  const [hasFallenBack, setHasFallenBack] = useState(false);
  useEffect(() => {
    setHasFallenBack(false);
  }, [filename]);
  const handleFallback = useCallback(() => {
    setHasFallenBack(true);
  }, []);

  const codeEditorBranch = (
    <CodeEditorErrorBoundary
      filename={filename}
      fallback={
        <RawTextarea
          content={content}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
        />
      }
    >
      <Suspense fallback={loadingFallback}>
        <CodeEditorImpl
          filename={filename}
          content={content}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
        />
      </Suspense>
    </CodeEditorErrorBoundary>
  );

  if (hasFallenBack) return codeEditorBranch;

  // Wrap MdxEditor in the error boundary so a thrown exception (YAMLException
  // on malformed frontmatter is the field repro) falls back to the code
  // editor instead of unmounting the whole app. onError also sets the sticky
  // flag so after a filename-stable re-render the boundary doesn't retry.
  return (
    <CodeEditorErrorBoundary
      filename={filename}
      fallback={codeEditorBranch}
      onError={handleFallback}
    >
      <Suspense fallback={loadingFallback}>
        <MdxEditorImpl
          key={filename}
          content={content}
          onChange={onChange}
          disabled={disabled}
          onSilentParseFailure={handleFallback}
        />
      </Suspense>
    </CodeEditorErrorBoundary>
  );
}
