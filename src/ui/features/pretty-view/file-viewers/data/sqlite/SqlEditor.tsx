import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { sql, SQLite } from "@codemirror/lang-sql";
import { dracula } from "@uiw/codemirror-theme-dracula";

/**
 * SQL input for the SQLite viewer: CodeMirror with the SQLite dialect,
 * table/column completion, and Ctrl/Cmd+Enter to run.
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  schema,
}: {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  /** table → column names, for completion. */
  schema: Record<string, string[]>;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onRun });
  handlers.current = { onChange, onRun };

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                handlers.current.onRun();
                return true;
              },
            },
          ]),
          basicSetup,
          sql({ dialect: SQLite, schema, upperCaseKeywords: true }),
          dracula,
          EditorView.theme({ "&": { height: "100%", fontSize: "12.5px" }, ".cm-scroller": { overflow: "auto" } }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor owns its text after mount; schema changes rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden rounded border border-[#2e2a22]" data-testid="sql-editor" />;
}
