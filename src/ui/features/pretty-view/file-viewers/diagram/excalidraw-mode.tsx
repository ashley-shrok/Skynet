import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";
import { pointExcalidrawAtOwnAssets } from "./excalidraw-assets";

// Excalidraw is large; it loads the first time a drawing opens.
const ExcalidrawEditor = lazy(() => {
  pointExcalidrawAtOwnAssets();
  return import("./ExcalidrawEditor");
});

export function ExcalidrawMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading Excalidraw…</div>}>
      <ExcalidrawEditor {...props} />
    </Suspense>
  );
}
