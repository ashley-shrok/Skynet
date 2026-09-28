import { useState, type MouseEvent } from "react";
import { Download, FileText, Image as ImageIcon, Music, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHumanSize } from "@/api/pretty-view-upload-protocol";

/**
 * Interactive file chip — one canonical rendering for every file URL the
 * app knows about (assistant-side shares and user-side attachments).
 *
 * Shape agreement in `.planning/campaigns/more-file-editors/shape-native-viewers-in-modal.md`.
 *
 * Rendered as an anchor so browser-native middle-click / ⌘-click /
 * right-click "open in new tab" all work naturally — the onClick intercept
 * only fires on plain click.
 *
 * Two variants:
 *   plain — file-type icon + underlined filename + optional size + download icon
 *   media — inline preview (image / audio / video / svg) inside a rounded
 *           frame, caption strip below with the same trailing controls
 *
 * The media source is the URL itself — `<img>` / `<audio>` / `<video>` fetch
 * with the browser's Skynet session cookies. The backend's per-extension
 * inline-disposition serves image/audio/video with real MIME types; SVG is
 * served with attachment disposition for security, but `<img>` renders it
 * natively without executing embedded script.
 */

export type FileChipKind = "image" | "audio" | "video" | "svg" | "plain";

// Extension sets mirror the backend's EXT_INLINE lanes for image/audio/video.
// SVG is separately called out because the render path differs (rendered here,
// code-toggle in modal). Anything not in these sets is treated as plain.
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico",
]);
const AUDIO_EXTS = new Set([
  "mp3", "m4a", "wav", "ogg", "oga", "flac", "opus",
]);
const VIDEO_EXTS = new Set([
  "mp4", "m4v", "webm", "mov", "ogv",
]);

/**
 * Classify a filename into a chip kind. Extension lookup is case-insensitive.
 * Filenames without an extension fall through to "plain".
 */
export function classifyFileChipKind(filename: string): FileChipKind {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "plain";
  const ext = filename.slice(dot + 1).toLowerCase();
  if (ext === "svg") return "svg";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "plain";
}

// Type-icon glyph for the leading position on plain chips and the media
// caption row. Same mapping as classifyFileChipKind; image/svg share the
// image icon since visually they're both "picture-like".
function TypeIcon({ kind, className }: { kind: FileChipKind; className?: string }): JSX.Element {
  const cls = cn("shrink-0 opacity-70", className);
  switch (kind) {
    case "image":
    case "svg":
      return <ImageIcon className={cls} aria-hidden />;
    case "audio":
      return <Music className={cls} aria-hidden />;
    case "video":
      return <Video className={cls} aria-hidden />;
    default:
      return <FileText className={cls} aria-hidden />;
  }
}

export interface FileChipProps {
  /** Skynet-served file URL: `https://<skynet>/file/<host>/<abs-path>`. */
  url: string;
  /** Filename with extension — drives the media-vs-plain dispatch. */
  filename: string;
  /** Optional file size in bytes. Rendered when known (user attachments have this;
   *  assistant chips typically don't unless the message metadata carries it). */
  size?: number;
  /**
   * Called on plain click (whole-chip click for plain variant; whole-frame
   * click for media variant, except when the click lands on the audio/video
   * native controls or the download icon). Opens the file-URL modal.
   */
  onOpen: () => void;
  /**
   * Optional override for the download action. If omitted, the chip
   * triggers a programmatic download via a synthesized anchor with the
   * `download` attribute — same-origin Skynet file URLs respect it, so
   * the browser saves to disk regardless of the server's content-disposition.
   * The chip stops the event so the click does not also fire `onOpen`.
   */
  onDownload?: () => void;
  className?: string;
}

export function FileChip({
  url,
  filename,
  size,
  onOpen,
  onDownload,
  className,
}: FileChipProps): JSX.Element {
  const detectedKind = classifyFileChipKind(filename);
  // Shape (2026-09-28) — media-load-error fallback: if the browser can't
  // render the media (corrupt bytes, truncated file, permission denied on
  // the underlying host), we downgrade the chip to the plain variant so
  // the reader never sees a broken-media icon inside the rounded frame.
  // Once flipped, we stay flipped for the lifetime of this render — a
  // re-mount (e.g. after the file is fixed) resets it naturally.
  const [mediaBroken, setMediaBroken] = useState(false);
  const kind: FileChipKind = mediaBroken ? "plain" : detectedKind;

  // onClick intercept for the whole chip / whole frame. preventDefault
  // stops the anchor from navigating on plain click. Middle-click and
  // ⌘-click never fire this handler, so browser-native open-in-new-tab
  // survives untouched.
  const handleOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    // Bail out if the click landed inside an audio/video native control
    // (users need to be able to play/pause/scrub without triggering the
    // modal open). The check is a target-walk up to the chip root,
    // stopping if we hit a media element along the way.
    let el: HTMLElement | null = e.target as HTMLElement;
    while (el && el !== e.currentTarget) {
      if (el.tagName === "AUDIO" || el.tagName === "VIDEO") return;
      el = el.parentElement;
    }
    e.preventDefault();
    onOpen();
  };

  const handleDownload = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }
    // Default: synthesize an anchor with the `download` attribute and
    // click it. Same-origin URLs respect the attribute over any inline
    // content-disposition the server sent, so the file lands in Downloads
    // rather than opening in the current tab.
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const sizeLabel = typeof size === "number" ? formatHumanSize(size) : null;

  // Plain variant — non-media types (text, pdf, docx, csv, diff, unknown).
  if (kind === "plain") {
    return (
      <a
        href={url}
        onClick={handleOpen}
        className={cn(
          "inline-flex max-w-full items-center gap-2 px-2.5 py-1.5",
          "rounded-lg border text-xs no-underline",
          "bg-[rgba(10,12,20,0.5)] border-white/10 text-[#e8e4d8]",
          "shadow-[inset_0_1px_0_rgba(220,225,245,0.05)]",
          "hover:bg-[rgba(20,24,34,0.65)] hover:border-white/[0.18]",
          "transition-[background-color,border-color] duration-[120ms]",
          "cursor-pointer",
          className,
        )}
        title={sizeLabel ? `${filename} (${sizeLabel})` : filename}
        data-file-chip-kind={kind}
      >
        <TypeIcon kind={kind} className="size-3.5" />
        <span
          className={cn(
            "max-w-[220px] truncate underline underline-offset-[3px]",
            "decoration-white/[0.35] hover:decoration-white/[0.85]",
          )}
        >
          {filename}
        </span>
        {sizeLabel ? (
          <span className="opacity-60">{sizeLabel}</span>
        ) : null}
        <span className="ml-auto shrink-0">
          <DownloadButton onClick={handleDownload} label={`Download ${filename}`} />
        </span>
      </a>
    );
  }

  // Media variant — image / audio / video / svg. Inline preview inside a
  // rounded frame, caption row below.
  return (
    <a
      href={url}
      onClick={handleOpen}
      className={cn(
        "block max-w-[340px] rounded-2xl overflow-hidden no-underline",
        "bg-[rgba(10,12,20,0.5)] border border-white/10",
        "text-[#e8e4d8]",
        "hover:border-white/[0.22]",
        "transition-[border-color] duration-[120ms]",
        "cursor-pointer",
        className,
      )}
      title={sizeLabel ? `${filename} (${sizeLabel})` : filename}
      data-file-chip-kind={kind}
    >
      <div className="block bg-black/60">
        <MediaPreview
          kind={kind}
          url={url}
          filename={filename}
          onError={() => setMediaBroken(true)}
        />
      </div>
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 text-xs",
          "border-t border-white/[0.08]",
        )}
      >
        <TypeIcon kind={kind} className="size-3.5" />
        <span
          className={cn(
            "flex-1 min-w-0 truncate underline underline-offset-[3px]",
            "decoration-white/[0.35] hover:decoration-white/[0.85]",
          )}
        >
          {filename}
        </span>
        {sizeLabel ? (
          <span className="opacity-60 shrink-0">{sizeLabel}</span>
        ) : null}
        <DownloadButton onClick={handleDownload} label={`Download ${filename}`} />
      </div>
    </a>
  );
}

/**
 * Inline media preview. All four kinds source directly from the URL —
 * `<img>` / `<audio>` / `<video>` fetch with the browser's session
 * cookies, so no extra fetch layer is needed at chip time. The modal open
 * path (via `onOpen`) still does its own fetch for the editor / viewer.
 *
 * Image and SVG cap at max-height so a tall image doesn't blow out the
 * bubble; audio is a single row of native controls; video renders with
 * native controls and no autoplay (per shape philosophy).
 */
function MediaPreview({
  kind,
  url,
  filename,
  onError,
}: {
  kind: FileChipKind;
  url: string;
  filename: string;
  /** Fired when the native media element fails to load — corrupt bytes,
   *  network error, permission denied. The chip flips to plain variant so
   *  we don't leave a broken-media icon inside the rounded frame. */
  onError: () => void;
}): JSX.Element {
  if (kind === "image" || kind === "svg") {
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
  if (kind === "audio") {
    return (
      <audio
        src={url}
        controls
        preload="metadata"
        className="block w-full"
        onError={onError}
      />
    );
  }
  // video
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

/** Small download-icon button used in both variants. */
function DownloadButton({
  onClick,
  label,
}: {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 inline-flex items-center justify-center size-6 rounded",
        "text-[#a89a80] hover:text-[#e8e4d8]",
        "hover:bg-white/[0.08] transition-[background-color,color] duration-[120ms]",
        "cursor-pointer",
      )}
    >
      <Download className="size-3.5" aria-hidden />
    </button>
  );
}
