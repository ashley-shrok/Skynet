import { lazy, Suspense, type ComponentType } from "react";
import type { FileModeViewProps } from "../registry";

// fontkit loads the first time a font opens.
const views = { font: lazy(() => import("./FontViewer")) };

export function FontMode(props: FileModeViewProps): JSX.Element {
  const View: ComponentType<FileModeViewProps> = views.font;
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading…</div>}>
      <View {...props} />
    </Suspense>
  );
}
