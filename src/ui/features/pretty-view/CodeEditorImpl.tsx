/**
 * CodeEditorImpl — lazy-loaded CodeMirror 6 editor for non-markdown files.
 *
 * Isolated so `MarkdownEditor.tsx` can `React.lazy(() => import(...))` the
 * heavy CodeMirror bundle (basicSetup + Dracula + every language pack we
 * ship). Mirrors the shape of `MdxEditorImpl.tsx` — heavy imports live at
 * module top of the lazy child, never at the caller.
 *
 * The Dracula theme is the editor's own colored island; the outer shell in
 * this file keeps Skynet's chrome (rounded corners, thin border, identity-
 * hued focus ring). That split is deliberate — see shape-code-editor.md.
 *
 * Callers stay identical to MarkdownEditor's contract: `filename`, `content`,
 * `onChange`, `disabled`, `placeholder`. The component NEVER knows about
 * "save"; that stays with each caller's existing handler.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { WrapText } from "lucide-react";
import { languageForFilename } from "./language-for-filename";
import { readSavedWrap, writeSavedWrap } from "./code-editor-wrap-preference";

// Layout theme: tell CM6 to fill its container's height and to hand
// scrolling to its own internal `.cm-scroller`. Without this, `.cm-editor`
// grows to natural content size and the outer shell's `overflow-hidden`
// clips it with no way for the user to scroll — no mouse wheel, no arrow
// keys, no drag-select-below-viewport. Kept OUTSIDE the theme extension
// (dracula) because layout and colors are separate concerns.
const layoutTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
});

interface CodeEditorImplProps {
  filename: string;
  content: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CodeEditorImpl({
  filename,
  content,
  onChange,
  disabled,
  placeholder,
}: CodeEditorImplProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Compartments let us reconfigure specific extensions without a full
  // editor remount. Filename → language, disabled → editable, wrap → line
  // wrapping. useMemo avoids re-allocating on every render (useRef would
  // evaluate `new Compartment()` each render and discard it).
  const langCompartment = useMemo(() => new Compartment(), []);
  const editableCompartment = useMemo(() => new Compartment(), []);
  const wrapCompartment = useMemo(() => new Compartment(), []);

  const [wrap, setWrapState] = useState<boolean>(() => readSavedWrap());

  // Keep onChange ref so the updateListener never captures a stale handler
  // even if the parent re-renders with a new function identity. Assignment
  // in useLayoutEffect (rather than during render) keeps the pattern
  // concurrent-mode clean — a discarded render can't leave a stale handler
  // in the ref.
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // Mount the editor once.
  useEffect(() => {
    if (!hostRef.current) return;

    const initialLang = languageForFilename(filename) ?? [];

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        dracula,
        layoutTheme,
        langCompartment.of(initialLang),
        editableCompartment.of(EditorView.editable.of(!disabled)),
        wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            // Diagnostic: save-failure investigation.
            // eslint-disable-next-line no-console
            console.log("[CodeEditor] doc changed", {
              filename,
              op: "code_editor_doc_change",
              docLen: next.length,
              head: next.slice(0, 40),
            });
            onChangeRef.current(next);
          }
        }),
        ...(placeholder ? [placeholderExt(placeholder)] : []),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentional single-mount: initial doc/filename/disabled/placeholder
    // are captured once; later prop changes are handled by the effects
    // below via compartment reconfigures + doc replacements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync content when the parent replaces it out-of-band (e.g. after a
  // reload, or a parent that normalizes CRLF/whitespace on the round-trip).
  // Skips when what the editor already holds matches — that's the echo of
  // our own onChange and re-dispatching it would collapse the cursor.
  //
  // When we DO have to replace the doc, we clamp the current selection into
  // the new document range so the cursor lands at the same offset (or the
  // end of the new content if the offset no longer exists). Without this,
  // CM6 defaults the selection to the end of the inserted range and the
  // user's cursor is lost.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    // Diagnostic: save-failure investigation. Content-sync only fires
    // when parent's content prop differs from the editor's own doc —
    // if this fires MID-typing it means the parent reset draft under us.
    // eslint-disable-next-line no-console
    console.log("[CodeEditor] content-sync forcing doc replacement", {
      filename,
      op: "code_editor_content_sync",
      currentLen: current.length,
      currentHead: current.slice(0, 40),
      incomingLen: content.length,
      incomingHead: content.slice(0, 40),
    });
    const oldSel = view.state.selection.main;
    const newLen = content.length;
    const clamp = (n: number): number => Math.min(Math.max(n, 0), newLen);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: content },
      selection: { anchor: clamp(oldSel.anchor), head: clamp(oldSel.head) },
    });
  }, [content, filename]);

  // Filename → language reconfigure (no remount, cursor + doc preserved).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const nextLang = languageForFilename(filename) ?? [];
    view.dispatch({
      effects: langCompartment.reconfigure(nextLang),
    });
  }, [filename, langCompartment]);

  // Disabled → editable reconfigure. `editable: false` prevents typing but
  // still allows text selection (users can select & copy during a save).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure(
        EditorView.editable.of(!disabled),
      ),
    });
  }, [disabled, editableCompartment]);

  // Wrap → lineWrapping reconfigure. Live-toggle preserves text and cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.reconfigure(
        wrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wrap, wrapCompartment]);

  // Toggle-and-persist. The localStorage write lives here (not inside the
  // state updater), because updater functions must be pure per React's
  // rules — Strict Mode may invoke them twice in dev, and the write is a
  // side effect. `writeSavedWrap` is idempotent so the current inline form
  // wouldn't corrupt anything, but keeping updaters pure is the discipline.
  const toggleWrap = useCallback(() => {
    const next = !wrap;
    setWrapState(next);
    writeSavedWrap(next);
  }, [wrap]);

  // Outer shell = Skynet's chrome. The Dracula-colored editor mounts
  // inside. `focus-within` triggers on CM6's internal focused element.
  // Opacity-60 during disabled is the visual signal; editable:false
  // (above) is what actually blocks input.
  //
  // The wrap-toggle sits absolutely-positioned in the top-right corner.
  // Its z-10 lifts it above CM6's content but the button is small enough
  // that clicks elsewhere still land in the editor.
  return (
    <div
      className={
        "relative w-full h-full min-h-[400px] rounded-md border border-white/10 " +
        "overflow-hidden " +
        "focus-within:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)] " +
        (disabled ? "opacity-60 " : "")
      }
    >
      <div ref={hostRef} className="w-full h-full" />
      <button
        type="button"
        onClick={toggleWrap}
        aria-pressed={wrap}
        aria-label={wrap ? "Soft-wrap on — click to turn off" : "Soft-wrap off — click to turn on"}
        title={wrap ? "Soft-wrap: on" : "Soft-wrap: off"}
        className={
          "absolute top-1.5 right-1.5 z-10 flex items-center justify-center " +
          "w-6 h-6 rounded text-[#e8e4d8] " +
          "hover:bg-white/10 transition-opacity " +
          (wrap ? "opacity-90 " : "opacity-40 hover:opacity-70 ")
        }
        data-testid="code-editor-wrap-toggle"
        data-wrap-state={wrap ? "on" : "off"}
      >
        <WrapText size={14} />
      </button>
    </div>
  );
}
