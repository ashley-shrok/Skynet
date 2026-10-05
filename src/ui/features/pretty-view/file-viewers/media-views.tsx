import type { ChipPreviewProps, FileModeViewProps } from "./registry";

/**
 * Native browser viewers for image / audio / video / rendered SVG. Both the
 * full-size view (inside FileView) and the small inline preview (inside a
 * chat FileChip) source straight from a URL — either the served file URL or
 * a blob URL FileView builds from already-fetched bytes.
 */

export function ImageView({ src, filename }: FileModeViewProps): JSX.Element {
  return (
    <div className="flex-1 min-h-0 h-full overflow-auto flex items-center justify-center p-6 bg-black/30">
      <img
        src={src ?? undefined}
        alt={filename}
        className="max-w-full max-h-full object-contain"
        draggable={false}
      />
    </div>
  );
}

export function AudioView({ src }: FileModeViewProps): JSX.Element {
  return (
    <div className="flex-1 min-h-0 h-full flex items-center justify-center p-6">
      <audio src={src ?? undefined} controls preload="metadata" className="w-full max-w-xl" />
    </div>
  );
}

export function VideoView({ src }: FileModeViewProps): JSX.Element {
  return (
    <div className="flex-1 min-h-0 h-full overflow-auto flex items-center justify-center p-6 bg-black/30">
      <video src={src ?? undefined} controls preload="metadata" className="max-w-full max-h-full" />
    </div>
  );
}

// Chip previews cap at max-height so a tall image doesn't blow out the
// bubble; audio is a single row of native controls; video has native
// controls and no autoplay.

export function ImageChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  return (
    <img
      src={url}
      alt={filename}
      className="block max-w-full max-h-[240px] mx-auto"
      loading="lazy"
      draggable={false}
      onError={onError}
    />
  );
}

export function AudioChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  return <audio src={url} controls preload="metadata" className="block w-full" onError={onError} />;
}

export function VideoChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  return (
    <video
      src={url}
      controls
      preload="metadata"
      className="block max-w-full max-h-[240px] mx-auto bg-black"
      onError={onError}
    />
  );
}
