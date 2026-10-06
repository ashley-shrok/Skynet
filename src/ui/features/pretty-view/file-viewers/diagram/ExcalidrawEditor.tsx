import { useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { BinaryDraft, FileModeViewProps } from "../registry";

/**
 * Excalidraw drawings (.excalidraw), edited with the real Excalidraw editor.
 * Changes surface as a BinaryDraft (the host's Save writes the file back as
 * Excalidraw JSON). The editor's own Open / Save-to-file actions are hidden;
 * its image export stays. Fonts come from our own server (excalidraw-assets).
 */

const MAX_BYTES = 50 * 1024 * 1024;

type Scene = Awaited<ReturnType<typeof loadFromBlob>>;
type Api = {
  getSceneElements(): readonly { version: number; isDeleted?: boolean }[];
  getSceneElementsIncludingDeleted(): readonly { version: number }[];
  getAppState(): Parameters<typeof serializeAsJSON>[1];
  getFiles(): Parameters<typeof serializeAsJSON>[2];
};

/** Changes to the drawing itself — not selection, scrolling or zoom. */
function contentVersion(elements: readonly { version: number }[], files: object): string {
  let sum = 0;
  for (const e of elements) sum += e.version;
  return `${elements.length}:${sum}:${Object.keys(files).length}`;
}

export default function ExcalidrawEditor({ filename, src, onBinaryDraft }: FileModeViewProps): JSX.Element {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<Api | null>(null);
  const baseline = useRef<string | null>(null);
  const dirty = useRef(false);
  const reportRef = useRef(onBinaryDraft);
  reportRef.current = onBinaryDraft;
  const editable = !!onBinaryDraft;

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setScene(null);
    setError(null);
    baseline.current = null;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the drawing (HTTP ${res.status}).`);
        const blob = await res.blob();
        if (blob.size > MAX_BYTES) throw new Error("This drawing is too large to open here (over 50 MB).");
        const loaded = await loadFromBlob(new Blob([blob], { type: "application/json" }), null, null);
        if (!ctrl.signal.aborted) setScene(loaded);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error && /^(Couldn't|This)/.test(err.message) ? err.message : "This isn't an Excalidraw drawing the editor can open.");
      }
    })();
    return () => {
      ctrl.abort();
      if (dirty.current) reportRef.current?.(null);
      dirty.current = false;
    };
  }, [src]);

  const draft = useMemo<BinaryDraft>(
    () => ({
      getBytes: async () => {
        const api = apiRef.current;
        if (!api) throw new Error("The drawing isn't loaded.");
        const json = serializeAsJSON(api.getSceneElementsIncludingDeleted() as never, api.getAppState(), api.getFiles(), "local");
        return new TextEncoder().encode(json);
      },
      markSaved: () => {
        const api = apiRef.current;
        if (api) baseline.current = contentVersion(api.getSceneElementsIncludingDeleted(), api.getFiles());
        dirty.current = false;
        reportRef.current?.(null);
      },
    }),
    [],
  );

  if (error) {
    return (
      <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="excalidraw-error">
        {error}
      </div>
    );
  }
  if (!scene) return <div className="p-6 text-center text-sm text-[#a89a80]">Opening drawing…</div>;

  return (
    <div className="h-full min-h-[420px]" data-testid="excalidraw-editor">
      <Excalidraw
        initialData={{ elements: scene.elements, appState: { ...scene.appState, theme: "dark" }, files: scene.files, scrollToContent: true }}
        excalidrawAPI={(api) => {
          apiRef.current = api as unknown as Api;
        }}
        name={filename.slice(filename.lastIndexOf("/") + 1)}
        viewModeEnabled={!editable}
        aiEnabled={false}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
        onChange={(elements, _appState, files) => {
          const version = contentVersion(elements, files);
          // The first change is the editor settling on the loaded scene.
          if (baseline.current === null) {
            baseline.current = version;
            return;
          }
          const now = version !== baseline.current;
          if (now === dirty.current || !editable) return;
          dirty.current = now;
          reportRef.current?.(now ? draft : null);
        }}
      />
    </div>
  );
}
