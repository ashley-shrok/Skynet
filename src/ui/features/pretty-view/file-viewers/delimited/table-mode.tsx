import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// AG Grid is heavy; it downloads the first time a delimited file opens.
const DelimitedTable = lazy(() => import("./DelimitedTable"));

export function TableMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading table…</div>}
    >
      <DelimitedTable {...props} />
    </Suspense>
  );
}
