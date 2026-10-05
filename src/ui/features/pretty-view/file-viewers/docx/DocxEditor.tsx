import { useEffect, useRef, useState } from "react";
import { SuperDoc, type DocumentMode } from "superdoc";
import "superdoc/style.layered.css";
import { cn } from "@/lib/utils";
import type { BinaryDraft, FileModeViewProps } from "../registry";

/**
 * Word (.docx) editor on SuperDoc (AGPL-3.0 — see THIRD_PARTY_NOTICES.md and
 * the README's licence section). Lazy-loaded by docx-mode.tsx.
 *
 * Opens in Editing; Suggesting records edits as tracked changes; Viewing is
 * read-only. Edits surface as a BinaryDraft (export to .docx), saved by the
 * host like PDF annotations. SuperDoc's document-open telemetry is off.
 */

/** Largest document the browser will download and open. */
const MAX_BYTES = 50 * 1024 * 1024;

const MODES: Array<{ id: DocumentMode; label: string }> = [
  { id: "editing", label: "Editing" },
  { id: "suggesting", label: "Suggesting" },
  { id: "viewing", label: "Viewing" },
];

type LoadState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

export default function DocxEditor({ filename, src, onBinaryDraft }: FileModeViewProps): JSX.Element {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<SuperDoc | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [mode, setMode] = useState<DocumentMode>("editing");
  const reportRef = useRef(onBinaryDraft);
  reportRef.current = onBinaryDraft;

  useEffect(() => {
    const toolbarEl = toolbarRef.current;
    const editorEl = editorRef.current;
    if (!src || !toolbarEl || !editorEl) return;
    const ctrl = new AbortController();
    let dirty = false;
    let ready = false;
    let superdoc: SuperDoc | null = null;

    const draft: BinaryDraft = {
      getBytes: async () => {
        if (!superdoc) throw new Error("Document isn't ready");
        const blob = await superdoc.export({ exportType: ["docx"], triggerDownload: false });
        return new Uint8Array(await blob.arrayBuffer());
      },
      markSaved: () => {
        dirty = false;
        reportRef.current?.(null);
      },
    };

    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the document (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
          throw new Error("This document is too large to open here (over 50 MB).");
        }
        const file = new File([await res.blob()], filename, {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        if (ctrl.signal.aborted) return;
        superdoc = new SuperDoc({
          selector: editorEl,
          toolbar: toolbarEl,
          document: file,
          documentMode: "editing",
          title: filename,
          telemetry: { enabled: false },
          onReady: () => {
            ready = true;
            if (!ctrl.signal.aborted) setState({ status: "ready" });
          },
          onEditorUpdate: () => {
            // Layout passes during load also emit updates; only edits after
            // the document is ready count as unsaved changes.
            if (!ready || dirty) return;
            dirty = true;
            reportRef.current?.(draft);
          },
          onContentError: () => {
            if (!ctrl.signal.aborted) {
              setState({ status: "error", message: "This file couldn't be opened as a Word document." });
            }
          },
        });
        docRef.current = superdoc;
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error && /^(Couldn't|This document)/.test(err.message)
            ? err.message
            : "This file couldn't be opened as a Word document.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      ctrl.abort();
      docRef.current = null;
      try {
        superdoc?.destroy();
      } catch {
        /* already torn down */
      }
      if (dirty) reportRef.current?.(null);
    };
  }, [src, filename]);

  const switchMode = (next: DocumentMode) => {
    setMode(next);
    docRef.current?.setDocumentMode(next);
  };

  return (
    <div className="flex flex-col h-full min-h-[560px] gap-2" data-testid="docx-editor">
      <div className="flex items-center gap-2 shrink-0">
        <div className="pv-variant-tabs" role="tablist" aria-label="Document mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              disabled={state.status !== "ready"}
              onClick={() => switchMode(m.id)}
              data-testid={`docx-mode-${m.id}`}
              className={cn("pv-variant-tab", mode === m.id && "on")}
            >
              {m.label}
            </button>
          ))}
        </div>
        {state.status === "loading" ? <span className="text-[12px] text-[#a89a80]">Opening document…</span> : null}
      </div>
      {state.status === "error" ? (
        <div className="p-6 text-sm text-[#a89a80] text-center" data-testid="docx-error">
          {state.message}
        </div>
      ) : null}
      <div
        className={cn(
          "docx-shell flex-1 min-h-0 flex flex-col rounded-md overflow-hidden bg-[#e8e8e8]",
          state.status === "error" && "hidden",
        )}
      >
        <div ref={toolbarRef} className="shrink-0 bg-white border-b border-black/10" />
        <div className="flex-1 min-h-0 overflow-auto">
          <div ref={editorRef} />
        </div>
      </div>
    </div>
  );
}
