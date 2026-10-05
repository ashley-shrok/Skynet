import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Download } from "lucide-react";
import {
  convertDocument,
  converterAvailable,
  DocumentConvertError,
  type ConvertTarget,
} from "@/api/document-convert-api";
import type { BinaryDraft, ChipPreviewProps, FileModeViewProps } from "../registry";
import { extensionOf } from "../registry-ext";
import { useInView } from "../chip-fetch";
import { PdfChipPreview } from "../pdf/PdfChipPreview";

/**
 * Legacy Office and OpenDocument files open in the viewers we already have
 * by converting them on the server (LibreOffice sidecar, /document-convert):
 *
 *   .doc / .odt         → .docx → Word editor; Save converts back and
 *                                 overwrites the original
 *   .xls / .ods         → .xlsx → Excel viewer (view-only)
 *   .ppt / .pptx / .odp → .pdf  → PDF viewer (view-only)
 *
 * convertedMode() wraps an inner viewer: it fetches the file, converts it,
 * and renders the inner viewer on a blob URL of the result. Without a
 * converter (not deployed, or down) it explains that and offers a download.
 */

const MAX_BYTES = 50 * 1024 * 1024;

const MIME: Record<ConvertTarget, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

function swapExtension(filename: string, ext: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return `${dot > 0 ? base.slice(0, dot) : base}.${ext}`;
}

async function fetchBytes(src: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(src, { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`Couldn't download the file (HTTP ${res.status}).`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
    throw new DocumentConvertError("too_large");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new DocumentConvertError("too_large");
  return bytes;
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string; unavailable: boolean };

/** Fetch `src`, convert it to `target`, and expose a blob URL of the result. */
function useConvertedUrl(src: string | null, filename: string, target: ConvertTarget): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    let url: string | null = null;
    setState({ status: "loading" });
    (async () => {
      try {
        if (!(await converterAvailable())) throw new DocumentConvertError("unavailable");
        const bytes = await fetchBytes(src, ctrl.signal);
        const out = await convertDocument(bytes, extensionOf(filename) ?? "bin", target, ctrl.signal);
        if (ctrl.signal.aborted) return;
        url = URL.createObjectURL(new Blob([out as BlobPart], { type: MIME[target] }));
        setState({ status: "ready", url });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const unavailable = err instanceof DocumentConvertError && err.reason === "unavailable";
        setState({
          status: "error",
          unavailable,
          message: err instanceof Error ? err.message : "This file couldn't be converted.",
        });
      }
    })();
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, filename, target]);
  return state;
}

function ConvertNotice({
  filename,
  src,
  message,
  unavailable,
}: {
  filename: string;
  src: string | null;
  message: string;
  unavailable: boolean;
}): JSX.Element {
  const ext = extensionOf(filename);
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-[#cfc8b8]" data-testid="converted-notice">
      <div className="font-medium text-[#fbf5e8]">Can't show {ext ? `this .${ext} file` : "this file"} here</div>
      <div className="max-w-md text-[#a89a80]">
        {message}
        {unavailable ? " An administrator can enable it by running the converter service (see docker-compose.yml)." : ""}
      </div>
      {src ? (
        <a
          href={src}
          download={filename.slice(filename.lastIndexOf("/") + 1)}
          className="inline-flex items-center gap-1.5 rounded border border-[#3a3428] px-3 py-1.5 text-[#e8e4d8] hover:bg-[#2a251c]"
        >
          <Download size={14} aria-hidden />
          Download
        </a>
      ) : null}
    </div>
  );
}

export interface ConvertedModeOptions {
  /** What the server converts the file to for viewing. */
  target: "docx" | "xlsx" | "pdf";
  /** The viewer that shows the converted file. */
  Inner: ComponentType<FileModeViewProps>;
  /**
   * Edits in the inner viewer are saved by converting back to the file's
   * own format (overwriting it). Off: the inner viewer is view-only here.
   */
  saveBack: boolean;
}

export function convertedMode({ target, Inner, saveBack }: ConvertedModeOptions): ComponentType<FileModeViewProps> {
  function ConvertedMode({ filename, src, onBinaryDraft, ...rest }: FileModeViewProps): JSX.Element {
    const state = useConvertedUrl(src, filename, target);
    const originalExt = extensionOf(filename) ?? "";
    const convertedName = useMemo(() => swapExtension(filename, target), [filename]);
    const [saveBackFailed, setSaveBackFailed] = useState<Uint8Array | null>(null);
    const reportRef = useRef(onBinaryDraft);
    reportRef.current = onBinaryDraft;

    // The inner viewer's draft holds the converted format (.docx); hosts
    // must write the original format, so convert back on the way out.
    const wrapDraft = useMemo(() => {
      if (!saveBack) return undefined;
      return (inner: BinaryDraft | null) => {
        if (!inner) {
          reportRef.current?.(null);
          return;
        }
        let lastConverted: Uint8Array | null = null;
        reportRef.current?.({
          getBytes: async () => {
            const edited = await inner.getBytes();
            lastConverted = edited;
            try {
              const back = await convertDocument(edited, target, originalExt as ConvertTarget);
              setSaveBackFailed(null);
              return back;
            } catch (err) {
              setSaveBackFailed(edited);
              const why = err instanceof DocumentConvertError ? ` ${err.message}` : "";
              throw new Error(`Couldn't save your edits as .${originalExt}.${why} Your edits are still open.`);
            }
          },
          markSaved: () => {
            setSaveBackFailed(null);
            if (lastConverted) inner.markSaved(lastConverted);
          },
        });
      };
    }, [originalExt]);

    if (state.status === "loading") {
      return (
        <div className="p-6 text-sm text-[#a89a80] text-center" data-testid="converted-loading">
          Converting {originalExt ? `.${originalExt}` : "file"}…
        </div>
      );
    }
    if (state.status === "error") {
      return <ConvertNotice filename={filename} src={src} message={state.message} unavailable={state.unavailable} />;
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        {saveBackFailed ? (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-[#5a3a2a] bg-[#2e1f17] px-3 py-2 text-[12.5px] text-[#f0c9b0]"
            role="alert"
            data-testid="converted-saveback-failed"
          >
            <span>
              Couldn't save your edits back as .{originalExt}. Keep them as a Word (.docx) copy instead:
            </span>
            <button
              type="button"
              onClick={() => downloadBytes(saveBackFailed, convertedName, MIME.docx)}
              className="inline-flex items-center gap-1 rounded border border-[#7a5a44] px-2 py-0.5 hover:bg-[#3a281d]"
            >
              <Download size={13} aria-hidden />
              Save as {convertedName}
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <Inner {...rest} filename={convertedName} src={state.url} onBinaryDraft={wrapDraft} />
        </div>
      </div>
    );
  }
  ConvertedMode.displayName = `Converted(${target})`;
  return ConvertedMode;
}

const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Chat chip thumbnail for presentations: once the chip scrolls into view,
 * convert the deck to PDF and show its first slide via the PDF thumbnail.
 * The server caches conversions, so opening the deck afterwards is instant.
 */
export function ConvertedPdfChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    let blobUrl: string | null = null;
    (async () => {
      try {
        if (!(await converterAvailable())) throw new Error("no converter");
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("too large");
        const pdf = await convertDocument(bytes, extensionOf(filename) ?? "bin", "pdf", ctrl.signal);
        if (ctrl.signal.aborted) return;
        blobUrl = URL.createObjectURL(new Blob([pdf as BlobPart], { type: MIME.pdf }));
        setPdfUrl(blobUrl);
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => {
      ctrl.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="converted-chip-preview">
      {pdfUrl ? (
        <PdfChipPreview url={pdfUrl} filename={swapExtension(filename, "pdf")} onError={onError} />
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Loading preview…</div>
      )}
    </div>
  );
}
