import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { languageForFilename } from "../../language-for-filename";

/**
 * One cell's source in CodeMirror (the app's code editor setup), sized to
 * its content. Read-only when the notebook can't be saved.
 */
export function CellEditor({
  value,
  languageFile,
  editable,
  onChange,
  autoFocus,
}: {
  value: string;
  /** Pseudo filename picking the syntax mode, e.g. "cell.py". */
  languageFile: string;
  editable: boolean;
  onChange?: (next: string) => void;
  autoFocus?: boolean;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editableCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!hostRef.current) return;
    const language = languageForFilename(languageFile);
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          ...(language ? [language] : []),
          dracula,
          editableCompartment.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          EditorView.theme({
            "&": { fontSize: "12.5px", backgroundColor: "#1d1f27" },
            ".cm-gutters": { backgroundColor: "#1d1f27" },
            "&.cm-focused": { outline: "1px solid hsl(220,60%,55%)" },
            // Only the cell being edited shows its current line.
            "&:not(.cm-focused) .cm-activeLine, &:not(.cm-focused) .cm-activeLineGutter": { backgroundColor: "transparent" },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor owns its text once mounted; value changes from outside are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageFile]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
    });
  }, [editable]);

  // Text changed from outside (undo of a cell move, a reload): replace it.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="overflow-hidden rounded" data-testid="nb-cell-editor" />;
}
