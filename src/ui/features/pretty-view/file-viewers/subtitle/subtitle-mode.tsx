import { lazy, Suspense, type ComponentType } from "react";
import type { FileModeViewProps } from "../registry";

// AG Grid downloads the first time a subtitle file opens.
const views = { editor: lazy(() => import("./SubtitleEditor")) };

export function SubtitleMode(props: FileModeViewProps): JSX.Element {
  const View: ComponentType<FileModeViewProps> = views.editor;
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading subtitles…</div>}>
      <View {...props} />
    </Suspense>
  );
}
