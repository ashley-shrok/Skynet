import { useEffect, useRef, useState } from "react";
import { getBasePath } from "@/lib/base-path";
import type { FileModeViewProps } from "../registry";

/**
 * draw.io diagrams (.drawio / .dio), view-only, with draw.io's own viewer:
 * pages, zoom, layers. It runs in public/drawio/viewer.html inside a sandbox
 * without allow-same-origin (its own opaque origin) and a CSP that keeps it
 * on this server — diagram labels can carry HTML.
 */

const MAX_BYTES = 30 * 1024 * 1024;

type Msg = { source?: string; type: "ready" | "rendered" | "error"; pages?: number; message?: string };

export default function DrawioViewer({ src }: FileModeViewProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const xmlRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({ kind: "loading" });

  const sendIfReady = () => {
    if (readyRef.current && xmlRef.current !== null) {
      // The frame's origin is opaque, so "*" is the only target origin that
      // reaches it; the message goes to this one window either way.
      frameRef.current?.contentWindow?.postMessage({ type: "open", xml: xmlRef.current }, "*");
    }
  };

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    xmlRef.current = null;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the diagram (HTTP ${res.status}).`);
        const text = await res.text();
        if (text.length > MAX_BYTES) throw new Error("This diagram is too large to open here.");
        if (ctrl.signal.aborted) return;
        xmlRef.current = text;
        sendIfReady();
      } catch (err) {
        if (!ctrl.signal.aborted) setStatus({ kind: "error", message: err instanceof Error ? err.message : "This diagram couldn't be opened." });
      }
    })();
    return () => ctrl.abort();
     
  }, [src]);

  useEffect(() => {
    const onMessage = (e: MessageEvent<Msg>) => {
      if (e.source !== frameRef.current?.contentWindow || e.data?.source !== "skynet-drawio") return;
      if (e.data.type === "ready") {
        readyRef.current = true;
        sendIfReady();
      } else if (e.data.type === "rendered") {
        setStatus({ kind: "ready" });
      } else if (e.data.type === "error") {
        setStatus({ kind: "error", message: e.data.message });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
     
  }, []);

  return (
    <div className="relative h-full min-h-[420px] bg-white" data-testid="drawio-viewer">
      <iframe
        ref={frameRef}
        src={`${getBasePath()}/drawio/viewer.html`}
        title="draw.io diagram"
        // No allow-same-origin: the viewer gets an opaque origin of its own.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        className="absolute inset-0 h-full w-full border-0"
      />
      {status.kind !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1a1712] p-6 text-center text-sm text-[#a89a80]" data-testid={status.kind === "error" ? "drawio-error" : undefined}>
          {status.kind === "error" ? status.message : "Opening diagram…"}
        </div>
      ) : null}
    </div>
  );
}
