import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

const EbookViewer = lazy(() => import("./EbookViewer"));

export function EbookMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading reader…</div>}>
      <EbookViewer {...props} />
    </Suspense>
  );
}
