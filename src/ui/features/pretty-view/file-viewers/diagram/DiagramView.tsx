import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import type { FileModeViewProps } from "../registry";
import { TextView } from "../text-view";
import { ZoomCanvas } from "../images/ZoomCanvas";
import { baseName } from "../data/cell-format";
import { renderDiagram, svgImage, type DiagramKind } from "./diagram-render";

/**
 * Mermaid / Graphviz: the diagram drawn from the current (draft) source,
 * re-rendered as you type. "split" puts the source editor beside it. When
 * the source has an error the last good drawing stays up with the message.
 */

const RENDER_DELAY_MS = 300;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DiagramView({ kind, layout, ...props }: FileModeViewProps & { kind: DiagramKind; layout: "split" | "diagram" }): JSX.Element {
  const { content, filename } = props;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setRendering(true);
    const timer = setTimeout(
      async () => {
        try {
          const out = await renderDiagram(kind, content);
          const image = await svgImage(out.svg);
          if (mine !== seq.current) return;
          setSvg(out.svg);
          setImg(image);
          setError(null);
        } catch (err) {
          if (mine !== seq.current) return;
          setError(err instanceof Error ? err.message : "This diagram couldn't be drawn.");
        } finally {
          if (mine === seq.current) setRendering(false);
        }
      },
      img ? RENDER_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
    // Re-render on source changes only; img is read for the first-render delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, content]);

  const exportSvg = () => svg && download(new Blob([svg], { type: "image/svg+xml" }), `${baseName(filename)}.svg`);
  const exportPng = () => {
    if (!img) return;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    try {
      canvas.toBlob((blob) => blob && download(blob, `${baseName(filename)}.png`), "image/png");
    } catch {
      setError("This diagram can't be exported as PNG; use SVG instead.");
    }
  };

  const diagram = (
    <div className="flex h-full min-h-0 flex-col" data-testid="diagram-view">
      <div className="flex items-center gap-2 border-b border-[#2e2a22] px-2 py-1 text-[12px]">
        <span className="text-[#a89a80]">{kind === "mermaid" ? "Mermaid" : "Graphviz"}</span>
        {rendering ? <span className="text-[#7d725f]">Drawing…</span> : null}
        <span className="ml-auto" />
        <button type="button" onClick={exportSvg} disabled={!svg} className="inline-flex items-center gap-1 rounded border border-[#3a3428] px-2 py-0.5 hover:bg-[#2a251c] disabled:opacity-40">
          <Download size={12} aria-hidden /> SVG
        </button>
        <button type="button" onClick={exportPng} disabled={!img} className="inline-flex items-center gap-1 rounded border border-[#3a3428] px-2 py-0.5 hover:bg-[#2a251c] disabled:opacity-40">
          <Download size={12} aria-hidden /> PNG
        </button>
      </div>
      {error ? (
        <div className="flex items-start gap-1.5 border-b border-[#5a3a2a] bg-[#2e1f17] px-3 py-1.5 font-mono text-[11.5px] text-[#f0c9b0]" data-testid="diagram-error">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {img ? (
          <ZoomCanvas canvas={img} background="paper" />
        ) : !rendering ? (
          <div className="flex h-full items-center justify-center text-sm text-[#a89a80]">No diagram to show.</div>
        ) : null}
      </div>
    </div>
  );

  if (layout === "diagram") return <div className="h-full min-h-[360px] text-[#e8e4d8]">{diagram}</div>;
  return (
    <div className="flex h-full min-h-[360px] text-[#e8e4d8]">
      <div className="flex min-w-0 flex-1 flex-col border-r border-[#2e2a22]">
        <TextView {...props} />
      </div>
      <div className="min-w-0 flex-1">{diagram}</div>
    </div>
  );
}

export const MermaidSplit = (p: FileModeViewProps) => <DiagramView {...p} kind="mermaid" layout="split" />;
export const MermaidDiagram = (p: FileModeViewProps) => <DiagramView {...p} kind="mermaid" layout="diagram" />;
export const GraphvizSplit = (p: FileModeViewProps) => <DiagramView {...p} kind="graphviz" layout="split" />;
export const GraphvizDiagram = (p: FileModeViewProps) => <DiagramView {...p} kind="graphviz" layout="diagram" />;
