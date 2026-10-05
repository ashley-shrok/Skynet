import { useEffect, useMemo, useRef } from "react";
import type { BinaryDraft, FileModeViewProps } from "../registry";
import { pdfEmbedCssUrl, pdfViewerUrl } from "./pdfjs-paths";

/**
 * PDF view: Mozilla's pdf.js viewer (vendored under public/pdfjs/) in a
 * same-origin iframe. Toolbar, thumbnails, search, print, forms and the
 * annotation editors (highlight, text, drawing, image, signature, comment)
 * all come from pdf.js.
 *
 * Saving: when the document has unsaved changes this reports a BinaryDraft.
 * `getBytes` runs the viewer's own save path (annotations, form data, page
 * reorganisation) and captures the bytes it would have downloaded;
 * `markSaved` reloads the saved bytes so the viewer is clean again.
 */

/** The slice of pdf.js's viewer globals this file touches. */
interface PdfJsViewerWindow extends Window {
  PDFViewerApplicationOptions?: { set(name: string, value: unknown): void };
  PDFViewerApplication?: {
    initializedPromise: Promise<void>;
    pdfDocument: {
      annotationStorage: {
        onSetModified: (() => void) | null;
        onResetModified: (() => void) | null;
        size: number;
      };
    } | null;
    page: number;
    eventBus: { on(name: string, cb: () => void): void; off(name: string, cb: () => void): void };
    downloadManager: { download(data: Uint8Array, url: string, filename: string): void } | null;
    downloadOrSave(): Promise<void>;
    open(args: { data: Uint8Array; filename?: string }): Promise<void>;
    _hasChanges?: () => boolean;
  };
}

/** Viewer options, set before pdf.js initialises (webviewerloaded). */
const VIEWER_OPTIONS: Record<string, unknown> = {
  viewerCssTheme: 2, // dark, matching the app
  disablePreferences: true, // ignore prefs pdf.js saved in localStorage
  disableHistory: true, // don't rewrite the iframe's URL / history
  sidebarViewOnLoad: 0, // no sidebar by default; the toolbar toggles it
  enableSignatureEditor: true,
  enableComment: true,
  enableHighlightFloatingButton: true,
};

/**
 * Without an onBinaryDraft there is nowhere to save edits (e.g. a deck
 * converted to PDF for viewing), so the annotation tools are switched off.
 */
const READ_ONLY_OPTIONS: Record<string, unknown> = {
  annotationEditorMode: -1, // AnnotationEditorType.DISABLE
  enableSignatureEditor: false,
  enableComment: false,
  enableHighlightFloatingButton: false,
};

/** How often to re-check for changes no pdf.js event reports (page edits). */
const DIRTY_POLL_MS = 1000;

export function PdfView({ filename, src, onBinaryDraft }: FileModeViewProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewerSrc = useMemo(() => (src ? pdfViewerUrl(src) : null), [src]);
  const reportRef = useRef(onBinaryDraft);
  reportRef.current = onBinaryDraft;

  // Options must land between the viewer's script load and its init;
  // pdf.js signals that window with "webviewerloaded" on the parent document.
  useEffect(() => {
    const onLoaded = (e: Event) => {
      const source = (e as CustomEvent<{ source: Window }>).detail?.source as PdfJsViewerWindow;
      if (!source || source !== iframeRef.current?.contentWindow) return;
      const opts = source.PDFViewerApplicationOptions;
      const options = reportRef.current ? VIEWER_OPTIONS : { ...VIEWER_OPTIONS, ...READ_ONLY_OPTIONS };
      for (const [k, v] of Object.entries(options)) opts?.set(k, v);
    };
    document.addEventListener("webviewerloaded", onLoaded);
    return () => document.removeEventListener("webviewerloaded", onLoaded);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !viewerSrc) return;
    let disposed = false;
    let dirty = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const cleanups: Array<() => void> = [];

    const setup = async () => {
      const win = iframe.contentWindow as PdfJsViewerWindow | null;
      const app = win?.PDFViewerApplication;
      if (!win || !app || disposed) return;
      // Hides viewer chrome that doesn't fit an embedded file (opening
      // other files). A <link>, because the viewer's CSP blocks inline styles.
      const link = win.document.createElement("link");
      link.rel = "stylesheet";
      link.href = pdfEmbedCssUrl();
      win.document.head.appendChild(link);
      await app.initializedPromise;
      if (disposed) return;

      const draft: BinaryDraft = {
        getBytes: () =>
          new Promise<Uint8Array>((resolve, reject) => {
            const dm = app.downloadManager;
            if (!dm) return reject(new Error("PDF viewer isn't ready"));
            const original = dm.download;
            let captured = false;
            dm.download = (data: Uint8Array) => {
              captured = true;
              dm.download = original;
              resolve(new Uint8Array(data));
            };
            app
              .downloadOrSave()
              .catch(reject)
              .finally(() => {
                dm.download = original;
                if (!captured) reject(new Error("PDF save produced no data"));
              });
          }),
        markSaved: (bytes: Uint8Array) => {
          const page = app.page;
          dirty = false;
          reportRef.current?.(null);
          void app.open({ data: bytes.slice(), filename }).then(() => {
            const restore = () => {
              app.page = page;
              app.eventBus.off("pagesloaded", restore);
            };
            app.eventBus.on("pagesloaded", restore);
          });
        },
      };

      const check = () => {
        if (disposed) return;
        const doc = app.pdfDocument;
        const now = !!doc && (app._hasChanges?.() ?? doc.annotationStorage.size > 0);
        if (now === dirty) return;
        dirty = now;
        reportRef.current?.(now ? draft : null);
      };

      // Chain onto pdf.js's own modified callbacks each time a document loads.
      const hook = () => {
        const storage = app.pdfDocument?.annotationStorage;
        if (!storage) return;
        const prevSet = storage.onSetModified;
        const prevReset = storage.onResetModified;
        storage.onSetModified = () => {
          prevSet?.();
          check();
        };
        storage.onResetModified = () => {
          prevReset?.();
          check();
        };
        check();
      };
      app.eventBus.on("documentloaded", hook);
      app.eventBus.on("annotationeditorstateschanged", check);
      cleanups.push(() => {
        app.eventBus.off("documentloaded", hook);
        app.eventBus.off("annotationeditorstateschanged", check);
      });
      if (app.pdfDocument) hook();
      timer = setInterval(check, DIRTY_POLL_MS);
    };

    const onLoad = () => void setup();
    iframe.addEventListener("load", onLoad);
    return () => {
      disposed = true;
      iframe.removeEventListener("load", onLoad);
      if (timer) clearInterval(timer);
      cleanups.forEach((f) => f());
      if (dirty) reportRef.current?.(null);
    };
  }, [viewerSrc, filename]);

  if (!viewerSrc) {
    return <div className="p-6 text-sm text-[#a89a80] text-center">Can&apos;t load this PDF here.</div>;
  }
  return (
    <iframe
      ref={iframeRef}
      src={viewerSrc}
      title={filename}
      className="block w-full h-full min-h-[560px] border-0 rounded-md bg-[#2a2a2e]"
      data-testid="pdf-view"
    />
  );
}
