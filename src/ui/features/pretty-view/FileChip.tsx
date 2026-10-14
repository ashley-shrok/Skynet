import { useState, type DragEvent, type MouseEvent } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHumanSize } from "@/api/pretty-view-upload-protocol";
import { useIsMobile } from "@/hooks/use-mobile";
import { systemLogger } from "@/lib/frontend-logger";
import { resolveFileViewer } from "./file-viewers/registry";
import { FILE_CHIP_MIME, parseSkynetFileUrl, type FileChipDragPayload } from "./file-url";

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
 *   plain   — file-type icon + underlined filename + optional size + download icon
 *   preview — the type's inline preview inside a rounded frame, caption strip
 *             below with the same trailing controls
 *
 * Audio / video previews are the exception to "the whole chip is an anchor":
 * the frame is a plain <div> and only the caption strip is the anchor. A
 * native player nested inside an <a href> lets iOS Safari treat a tap on the
 * play button as link activation and navigate to the bare media URL (a
 * full-screen player with no way back), so the player must sit outside it.
 *
 * Drag source (desktop): dragging the chip — or an image preview, which is
 * part of the chip's anchor — writes a FILE_CHIP_MIME payload that split
 * view turns into a file pane. Audio / video players stay undraggable so
 * scrubbing never starts a drag; their caption strip carries the drag.
 * Inner images are made non-draggable so the browser never offers the
 * image itself as a dropped file (which the compose box would upload).
 *
 * The file-viewer registry (file-viewers/registry.ts) decides both the icon
 * and whether a type has an inline preview (`ChipPreview`). Media previews
 * source from the URL itself — `<img>` / `<audio>` / `<video>` fetch with the
 * browser's Skynet session cookies. SVG is served with attachment
 * disposition for security, but `<img>` renders it without executing script.
 */

/**
 * Registry entry id when the type has an inline chip preview (today: image,
 * svg, audio, video), else "plain". Rendered as `data-file-chip-kind`.
 */
export type FileChipKind = string;

export function classifyFileChipKind(filename: string): FileChipKind {
  const entry = resolveFileViewer(filename);
  return entry.ChipPreview ? entry.id : "plain";
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
   * click for preview variant; caption-strip click for audio/video, whose
   * player sits outside the anchor). Never fires from the download icon.
   * Opens the file-URL modal.
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
  /**
   * Encoded tab spec of the conversation this chip sits in. Rides the drag
   * payload so a file pane knows which conversation the file came from.
   */
  dragOrigin?: string | null;
  className?: string;
}

export function FileChip({
  url,
  filename,
  size,
  onOpen,
  onDownload,
  dragOrigin,
  className,
}: FileChipProps): JSX.Element {
  const isMobile = useIsMobile();
  const entry = resolveFileViewer(filename);
  const Icon = entry.icon;
  const Preview = entry.ChipPreview;
  // Shape (2026-09-28) — media-load-error fallback: if the browser can't
  // render the media (corrupt bytes, truncated file, permission denied on
  // the underlying host), we downgrade the chip to the plain variant so
  // the reader never sees a broken-media icon inside the rounded frame.
  // Once flipped, we stay flipped for the lifetime of this render — a
  // re-mount (e.g. after the file is fixed) resets it naturally.
  const [mediaBroken, setMediaBroken] = useState(false);
  const kind: FileChipKind = mediaBroken || !Preview ? "plain" : entry.id;

  // onClick intercept for the whole chip / whole frame. preventDefault
  // stops the anchor from navigating on plain click. Middle-click and
  // ⌘-click never fire this handler, so browser-native open-in-new-tab
  // survives untouched.
  const handleOpen = (e: MouseEvent<HTMLAnchorElement>) => {
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

  // Desktop-only drag source (no split view on a phone). URLs that don't
  // parse to a (host, path) pair stay plain links.
  const address = isMobile ? null : parseSkynetFileUrl(url);
  const handleDragStart = (e: DragEvent<HTMLElement>) => {
    if (address === null) return;
    // Drop the browser's own link data (text/plain would read as a stray
    // text drag) — only the file payload rides along.
    e.dataTransfer.clearData();
    const payload: FileChipDragPayload = {
      host: address.host,
      path: address.path,
      filename,
      origin: dragOrigin ?? null,
    };
    e.dataTransfer.setData(FILE_CHIP_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
    systemLogger.info("[file-chip-drag] start", {
      operation: "file_chip_drag_start",
      host: address.host,
      filename,
      hasOrigin: !!dragOrigin,
    });
  };
  const dragProps =
    address === null
      ? {}
      : { draggable: true, onDragStart: handleDragStart, "data-file-chip-draggable": "" };
  const noImgDrag = "[&_img]:[-webkit-user-drag:none]";

  const sizeLabel = typeof size === "number" ? formatHumanSize(size) : null;

  // Plain variant — types without an inline preview, or a preview that failed.
  if (kind === "plain" || !Preview) {
    return (
      <a
        href={url}
        onClick={handleOpen}
        {...dragProps}
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
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
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

  // Preview variant — the registry's inline preview inside a rounded frame,
  // caption row below.
  const frameClassName = cn(
    "block max-w-[340px] rounded-2xl overflow-hidden no-underline",
    "bg-[rgba(10,12,20,0.5)] border border-white/10",
    "text-[#e8e4d8]",
    "hover:border-white/[0.22]",
    "transition-[border-color] duration-[120ms]",
    className,
  );
  const captionClassName = cn(
    "flex items-center gap-2 px-2.5 py-1.5 text-xs",
    "border-t border-white/[0.08]",
  );
  const title = sizeLabel ? `${filename} (${sizeLabel})` : filename;
  const preview = (
    <div className="block bg-black/60">
      <Preview url={url} filename={filename} onError={() => setMediaBroken(true)} />
    </div>
  );
  const caption = (
    <>
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
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
    </>
  );

  // Audio / video — the native player stays OUT of the anchor (see header).
  if (kind === "audio" || kind === "video") {
    return (
      <div className={frameClassName} title={title} data-file-chip-kind={kind}>
        {preview}
        <a
          href={url}
          onClick={handleOpen}
          {...dragProps}
          className={cn(captionClassName, "no-underline text-inherit cursor-pointer")}
        >
          {caption}
        </a>
      </div>
    );
  }

  return (
    <a
      href={url}
      onClick={handleOpen}
      {...dragProps}
      className={cn(frameClassName, noImgDrag, "cursor-pointer")}
      title={title}
      data-file-chip-kind={kind}
    >
      {preview}
      <div className={captionClassName}>{caption}</div>
    </a>
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
