import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// SuperDoc is large; it downloads the first time a Word document opens.
const DocxEditor = lazy(() => import("./DocxEditor"));

export function DocxMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading document editor…</div>}
    >
      <DocxEditor {...props} />
    </Suspense>
  );
}
