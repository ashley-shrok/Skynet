import { MarkdownEditor } from "../MarkdownEditor";
import type { FileModeViewProps } from "./registry";

/**
 * Editable text view. MarkdownEditor gates on the filename: `.md` gets the
 * MDXEditor, everything else gets the CodeMirror code editor (with syntax
 * highlighting from language-for-filename when the extension is known).
 */
export function TextView({ filename, content, onChange, disabled }: FileModeViewProps): JSX.Element {
  return (
    <MarkdownEditor filename={filename} content={content} onChange={onChange} disabled={disabled} />
  );
}
