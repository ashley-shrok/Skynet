import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// sql.js, hyparquet and apache-arrow download the first time a data file opens.
const SqliteViewer = lazy(() => import("./sqlite/SqliteViewer"));
const ColumnarViewer = lazy(() => import("./columnar/ColumnarViewer"));

const fallback = <div className="p-6 text-sm text-[#a89a80] text-center">Loading data viewer…</div>;

export function SqliteMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={fallback}>
      <SqliteViewer {...props} />
    </Suspense>
  );
}

export function ColumnarMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={fallback}>
      <ColumnarViewer {...props} />
    </Suspense>
  );
}
