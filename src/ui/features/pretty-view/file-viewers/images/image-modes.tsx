import { lazy, Suspense } from "react";
import type { FileModeViewProps } from "../registry";

// Decoders (UTIF, ag-psd, libheif, exifr) download the first time such an image opens.
const DecodedImageViewer = lazy(() => import("./DecodedImageViewer"));

export function DecodedImageMode(props: FileModeViewProps): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading image viewer…</div>}>
      <DecodedImageViewer {...props} />
    </Suspense>
  );
}
