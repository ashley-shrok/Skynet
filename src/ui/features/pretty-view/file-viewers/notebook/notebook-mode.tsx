import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// Markdown + KaTeX + CodeMirror cells; loaded the first time a notebook opens.
const NotebookView = lazy(() => import("./NotebookView"));

export function NotebookMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading notebook…</div>}>
      <NotebookView {...props} />
    </Suspense>
  );
}
