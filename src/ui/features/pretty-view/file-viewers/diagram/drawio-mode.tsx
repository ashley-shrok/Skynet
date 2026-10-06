import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

const DrawioViewer = lazy(() => import("./DrawioViewer"));

export function DrawioMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading diagram viewer…</div>}>
      <DrawioViewer {...props} />
    </Suspense>
  );
}
