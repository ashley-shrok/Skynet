import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// three.js + the importers are large; they download the first time a model opens.
const ModelViewer = lazy(() => import("./ModelViewer"));

export function ModelMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading 3D viewer…</div>}>
      <ModelViewer {...props} />
    </Suspense>
  );
}
