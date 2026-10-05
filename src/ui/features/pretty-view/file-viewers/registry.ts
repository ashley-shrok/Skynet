import type { ComponentType } from "react";
import {
  File,
  FileDiff,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  type LucideIcon,
} from "lucide-react";
import { classifyByExtension } from "../editable-file-whitelist";
import { extensionOf } from "./registry-ext";
import {
  AudioChipPreview,
  AudioView,
  ImageChipPreview,
  ImageView,
  VideoChipPreview,
  VideoView,
} from "./media-views";
import { TextView } from "./text-view";
import { DiffChipPreview } from "./diff/DiffChipPreview";
import { SplitDiffMode, UnifiedDiffMode } from "./diff/DiffView";
import { DelimitedChipPreview } from "./delimited/DelimitedChipPreview";
import { TableMode } from "./delimited/table-mode";
import { PdfChipPreview } from "./pdf/PdfChipPreview";
import { PdfView } from "./pdf/PdfView";

/**
 * File-viewer registry — the ONE place that decides how a file type is shown.
 *
 * Every surface that can open an arbitrary file (chat file modal, skills
 * editor, runbooks editor, workspace file browser) renders <FileView>, and
 * chat file chips read their inline preview from here. Adding a file type
 * means adding an entry below plus its components; nothing per-surface.
 *
 * An entry has one or more MODES. Several modes show a switcher (e.g. SVG
 * Rendered / Source). Each mode declares what it needs:
 *   - "url":     a browser-loadable src (the served file URL, or a blob URL
 *                FileView builds from fetched bytes / text)
 *   - "content": the file's text, decoded; the mode may edit it
 *   - "none":    nothing (the binary notice)
 */

export type FileModeNeeds = "url" | "content" | "none";

export interface FileModeViewProps {
  filename: string;
  /** Browser-loadable src for "url" modes; null for other modes. */
  src: string | null;
  /** Current (draft) text for "content" modes; "" otherwise. */
  content: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /**
   * Modes that edit the file's bytes in place (e.g. PDF annotations) report
   * unsaved changes here: a draft while dirty, null once clean / unmounted.
   */
  onBinaryDraft?: (draft: BinaryDraft | null) => void;
}

/** Unsaved binary edits a mode holds (see FileModeViewProps.onBinaryDraft). */
export interface BinaryDraft {
  /** The edited file's bytes, as they should be written. */
  getBytes(): Promise<Uint8Array>;
  /** The host wrote `bytes`; the mode resets to a clean state showing them. */
  markSaved(bytes: Uint8Array): void;
}

export interface FileViewMode {
  id: string;
  label: string;
  needs: FileModeNeeds;
  editable: boolean;
  View: ComponentType<FileModeViewProps>;
}

export interface ChipPreviewProps {
  url: string;
  filename: string;
  /** Fire when the preview can't load; the chip falls back to its plain variant. */
  onError: () => void;
}

export interface FileViewerEntry {
  id: string;
  extensions: readonly string[];
  icon: LucideIcon;
  /** MIME type per extension, for blob URLs built from fetched bytes. */
  mime?: Readonly<Record<string, string>>;
  modes: readonly FileViewMode[];
  /** Inline preview inside a chat FileChip. Absent → plain chip. */
  ChipPreview?: ComponentType<ChipPreviewProps>;
}

function BinaryNoticeMode(): null {
  // Never rendered — FileView draws the binary notice itself so it can add
  // the host's download link. Exists so the binary entry has a mode.
  return null;
}

const textMode: FileViewMode = {
  id: "source",
  label: "Source",
  needs: "content",
  editable: true,
  View: TextView,
};

export const IMAGE_ENTRY: FileViewerEntry = {
  id: "image",
  extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"],
  icon: ImageIcon,
  mime: {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/vnd.microsoft.icon",
  },
  modes: [{ id: "view", label: "View", needs: "url", editable: false, View: ImageView }],
  ChipPreview: ImageChipPreview,
};

export const SVG_ENTRY: FileViewerEntry = {
  id: "svg",
  extensions: ["svg"],
  icon: ImageIcon,
  mime: { svg: "image/svg+xml" },
  modes: [
    { id: "rendered", label: "Rendered", needs: "url", editable: false, View: ImageView },
    textMode,
  ],
  ChipPreview: ImageChipPreview,
};

export const AUDIO_ENTRY: FileViewerEntry = {
  id: "audio",
  extensions: ["mp3", "m4a", "wav", "ogg", "oga", "flac", "opus"],
  icon: Music,
  mime: {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    flac: "audio/flac",
    opus: "audio/opus",
  },
  modes: [{ id: "view", label: "Play", needs: "url", editable: false, View: AudioView }],
  ChipPreview: AudioChipPreview,
};

export const VIDEO_ENTRY: FileViewerEntry = {
  id: "video",
  extensions: ["mp4", "m4v", "webm", "mov", "ogv"],
  icon: Video,
  mime: {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ogv: "video/ogg",
  },
  modes: [{ id: "view", label: "Play", needs: "url", editable: false, View: VideoView }],
  ChipPreview: VideoChipPreview,
};

/**
 * .diff / .patch: rendered unified or side-by-side (a dropdown picks the
 * file in multi-file patches), plus Raw for editing. The rendered modes
 * read the current draft, so Raw edits show up when switching back.
 */
export const DIFF_ENTRY: FileViewerEntry = {
  id: "diff",
  extensions: ["diff", "patch"],
  icon: FileDiff,
  modes: [
    { id: "unified", label: "Unified", needs: "content", editable: false, View: UnifiedDiffMode },
    { id: "split", label: "Side-by-side", needs: "content", editable: false, View: SplitDiffMode },
    { ...textMode, id: "raw", label: "Raw" },
  ],
  ChipPreview: DiffChipPreview,
};

/**
 * CSV / TSV / PSV: editable table (AG Grid, lazy-loaded) plus Raw. Saves
 * keep the file's delimiter, line endings, BOM and quoting style.
 */
export const DELIMITED_ENTRY: FileViewerEntry = {
  id: "delimited",
  extensions: ["csv", "tsv", "psv"],
  icon: FileSpreadsheet,
  modes: [
    { id: "table", label: "Table", needs: "content", editable: true, View: TableMode },
    { ...textMode, id: "raw", label: "Raw" },
  ],
  ChipPreview: DelimitedChipPreview,
};

/**
 * PDF: Mozilla's pdf.js viewer (vendored, see public/pdfjs/README.md) with
 * its annotation editors. Edits surface as a BinaryDraft for hosts to save.
 */
export const PDF_ENTRY: FileViewerEntry = {
  id: "pdf",
  extensions: ["pdf"],
  icon: FileText,
  modes: [{ id: "view", label: "View", needs: "url", editable: true, View: PdfView }],
  ChipPreview: PdfChipPreview,
};

/**
 * Formats we know are binary and have no viewer yet. Recognising them up
 * front lets surfaces skip the (up to 2 MB) fetch and show the notice
 * immediately. Entries move out of here as they gain real viewers.
 */
export const BINARY_ENTRY: FileViewerEntry = {
  id: "binary",
  extensions: [
    // archives
    "zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar", "zst",
    // documents
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub",
    // executables / objects
    "exe", "dll", "so", "dylib", "o", "a", "class", "jar", "war", "pyc", "wasm", "bin",
    // disk images / databases
    "iso", "dmg", "img", "sqlite", "sqlite3", "db",
    // fonts
    "woff", "woff2", "ttf", "otf", "eot",
    // images browsers can't show natively
    "tif", "tiff", "heic", "heif", "psd",
  ],
  icon: File,
  modes: [{ id: "none", label: "File", needs: "none", editable: false, View: BinaryNoticeMode }],
};

/** Fallback for everything else: text/code in the editor. */
export const TEXT_ENTRY: FileViewerEntry = {
  id: "text",
  extensions: [],
  icon: FileText,
  modes: [textMode],
};

const ENTRIES: readonly FileViewerEntry[] = [
  IMAGE_ENTRY,
  SVG_ENTRY,
  AUDIO_ENTRY,
  VIDEO_ENTRY,
  DIFF_ENTRY,
  DELIMITED_ENTRY,
  PDF_ENTRY,
  BINARY_ENTRY,
];

const BY_EXTENSION = new Map<string, FileViewerEntry>();
for (const entry of ENTRIES) {
  for (const ext of entry.extensions) {
    if (BY_EXTENSION.has(ext)) {
      throw new Error(`file-viewer registry: extension "${ext}" registered twice`);
    }
    BY_EXTENSION.set(ext, entry);
  }
}

export { extensionOf };

/** The registry entry for a filename. Unknown types resolve to TEXT_ENTRY. */
export function resolveFileViewer(filename: string): FileViewerEntry {
  const ext = extensionOf(filename);
  return (ext && BY_EXTENSION.get(ext)) || TEXT_ENTRY;
}

/** The entry's mode with this id, or its first (default) mode. */
export function resolveMode(entry: FileViewerEntry, modeId?: string | null): FileViewMode {
  return entry.modes.find((m) => m.id === modeId) ?? entry.modes[0];
}

/** MIME type for building a blob URL, or "" when the entry doesn't know one. */
export function mimeFor(entry: FileViewerEntry, filename: string): string {
  const ext = extensionOf(filename);
  return (ext && entry.mime?.[ext]) || "";
}

/** True when the filename alone says the file is text (no byte sniff needed). */
export function isTextByName(filename: string): boolean {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  return classifyByExtension(extensionOf(base), base);
}

/** True when the current mode needs the host to fetch the file's content. */
export function fileViewNeedsContent(
  filename: string,
  modeId: string | null | undefined,
  hasMediaUrl: boolean,
): boolean {
  const mode = resolveMode(resolveFileViewer(filename), modeId);
  if (mode.needs === "content") return true;
  if (mode.needs === "url") return !hasMediaUrl;
  return false;
}

/** True when the current mode can be edited (and so a Save button applies). */
export function fileViewIsEditable(
  filename: string,
  modeId: string | null | undefined,
  isText: boolean | undefined,
): boolean {
  const mode = resolveMode(resolveFileViewer(filename), modeId);
  return mode.editable && isText !== false;
}

/**
 * True when no mode of the file's type reads its text (media, known
 * binary) — hosts with a mediaUrl can skip fetching the content entirely.
 */
export function fileViewNeverNeedsContent(filename: string): boolean {
  return resolveFileViewer(filename).modes.every((m) => m.needs !== "content");
}
