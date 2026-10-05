import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// ExcelJS + AG Grid download the first time a workbook opens.
const XlsxViewer = lazy(() => import("./XlsxViewer"));

export function XlsxMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading workbook…</div>}
    >
      <XlsxViewer {...props} />
    </Suspense>
  );
}
