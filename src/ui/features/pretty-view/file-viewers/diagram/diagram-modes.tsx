import { lazy, Suspense, type ComponentType } from "react";
import type { FileModeViewProps } from "../registry";

// Mermaid and Viz.js are large; they load the first time a diagram opens.
const load = (name: "MermaidSplit" | "MermaidDiagram" | "GraphvizSplit" | "GraphvizDiagram") =>
  lazy(() => import("./DiagramView").then((m) => ({ default: m[name] as ComponentType<FileModeViewProps> })));

const views = {
  MermaidSplit: load("MermaidSplit"),
  MermaidDiagram: load("MermaidDiagram"),
  GraphvizSplit: load("GraphvizSplit"),
  GraphvizDiagram: load("GraphvizDiagram"),
};

function wrap(name: keyof typeof views) {
  const View = views[name];
  return function DiagramMode(props: FileModeViewProps): JSX.Element {
    return (
      <Suspense fallback={<div className="p-6 text-sm text-[#a89a80] text-center">Loading diagram renderer…</div>}>
        <View {...props} />
      </Suspense>
    );
  };
}

export const MermaidSplitMode = wrap("MermaidSplit");
export const MermaidDiagramMode = wrap("MermaidDiagram");
export const GraphvizSplitMode = wrap("GraphvizSplit");
export const GraphvizDiagramMode = wrap("GraphvizDiagram");
