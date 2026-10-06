/**
 * Text diagrams → SVG. Mermaid runs in its strict security mode (no click
 * handlers, labels sanitized) with plain SVG text labels; Graphviz runs as
 * WebAssembly (Viz.js). Either way the SVG is shown as an <img>, where it
 * can't run scripts or load anything.
 */

export type DiagramKind = "mermaid" | "graphviz";

export class DiagramError extends Error {}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
let renderSeq = 0;

function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
      // SVG text instead of HTML labels: renders inside <img> and exports to PNG.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    });
    return mermaid;
  });
  return mermaidReady;
}

let vizReady: Promise<{ render(src: string, opts: { format: string }): { status: string; output?: string; errors: { level?: string; message: string }[] } }> | null = null;

async function renderMermaid(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(source);
  } catch (err) {
    throw new DiagramError(cleanMessage(err));
  }
  try {
    const { svg } = await mermaid.render(`skynet-mermaid-${++renderSeq}`, source);
    return svg;
  } catch (err) {
    throw new DiagramError(cleanMessage(err));
  } finally {
    // Mermaid can leave its scratch element behind on failure.
    document.getElementById(`dskynet-mermaid-${renderSeq}`)?.remove();
  }
}

async function renderGraphviz(source: string): Promise<string> {
  vizReady ??= import("@viz-js/viz").then((m) => m.instance());
  const viz = await vizReady;
  const result = viz.render(source, { format: "svg" });
  if (result.status !== "success" || !result.output) {
    const first = result.errors.find((e) => e.level === "error") ?? result.errors[0];
    throw new DiagramError(first?.message?.trim() || "This graph couldn't be laid out.");
  }
  return result.output;
}

function cleanMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/\s+$/, "").slice(0, 600) || "This diagram has an error.";
}

/**
 * Give the SVG a pixel size (Mermaid emits width="100%" with a max-width
 * style), so an <img> of it has a natural size to fit and zoom.
 */
export function withIntrinsicSize(svg: string): { svg: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") throw new DiagramError("The renderer didn't produce an SVG.");
  const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  let width = parseFloat(root.getAttribute("width") ?? "");
  let height = parseFloat(root.getAttribute("height") ?? "");
  const isPercent = (v: string | null) => !!v && v.trim().endsWith("%");
  if (vb.length === 4 && vb.every(Number.isFinite) && (!width || isPercent(root.getAttribute("width")))) {
    width = vb[2];
    height = vb[3];
  }
  // Graphviz reports points ("123pt"); the viewBox is the same size in user units.
  if (!width || !height) {
    width = 800;
    height = 600;
  }
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.style.removeProperty("max-width");
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { svg: new XMLSerializer().serializeToString(root), width, height };
}

export async function renderDiagram(kind: DiagramKind, source: string): Promise<{ svg: string; width: number; height: number }> {
  if (!source.trim()) throw new DiagramError("Nothing to draw yet.");
  const raw = kind === "mermaid" ? await renderMermaid(source) : await renderGraphviz(source);
  return withIntrinsicSize(raw);
}

/** An <img> of the SVG, decoded and ready to measure. */
export async function svgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.alt = "Diagram";
  img.draggable = false;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}
