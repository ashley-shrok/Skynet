import { useEffect, useRef, useState } from "react";
import { Box, Camera, Grid3x3, Maximize, Moon, Sun } from "lucide-react";
import type { FileModeViewProps } from "../registry";
import { applyEnvironment, destroyViewer, loadEngine, loadModelInto, type LoadedModel, type O3dv } from "./engine";

/**
 * 3D model viewer (view-only): orbit / pan / zoom with mouse or touch,
 * fit-to-view, Y-up / Z-up, edges, perspective / orthographic, light or dark
 * backdrop, and a PNG snapshot. Formats: see MODEL_3D_EXTENSIONS.
 *
 * A model whose materials or textures live in separate files (.obj + .mtl,
 * .gltf + .bin) opens without them; the viewer says which were missing.
 */

const MAX_BYTES = 200 * 1024 * 1024;

const DARK = { r: 26, g: 23, b: 18 }; // matches the app's panel background
const LIGHT = { r: 236, g: 233, b: 226 };

type State =
  | { status: "loading"; step: string }
  | { status: "ready"; info: LoadedModel }
  | { status: "error"; message: string };

function formatCount(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}

function formatSize(size: [number, number, number]): string {
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));
  return size.map(fmt).join(" × ");
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] ${
        active ? "bg-[#3a3428] text-[#fbf5e8]" : "text-[#cfc8b8] hover:bg-[#2a251c]"
      }`}
    >
      {children}
    </button>
  );
}

export default function ModelViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ OV: O3dv; viewer: InstanceType<O3dv["Viewer"]> } | null>(null);
  const [state, setState] = useState<State>({ status: "loading", step: "Loading 3D viewer…" });
  const [upAxis, setUpAxis] = useState<"Y" | "Z">("Y");
  const [edges, setEdges] = useState(false);
  const [ortho, setOrtho] = useState(false);
  const [light, setLight] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!src || !host) return;
    const ctrl = new AbortController();
    let viewer: InstanceType<O3dv["Viewer"]> | null = null;
    let loader: InstanceType<O3dv["ThreeModelLoader"]> | null = null;
    let observer: ResizeObserver | null = null;
    setState({ status: "loading", step: "Loading 3D viewer…" });

    (async () => {
      try {
        const OV = await loadEngine();
        if (ctrl.signal.aborted) return;
        setState({ status: "loading", step: "Downloading model…" });
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the model (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
          throw new Error("This model is too large to open here (over 200 MB).");
        }
        const blob = await res.blob();
        if (blob.size > MAX_BYTES) throw new Error("This model is too large to open here (over 200 MB).");
        if (ctrl.signal.aborted) return;

        setState({ status: "loading", step: "Importing model…" });
        const canvas = document.createElement("canvas");
        canvas.className = "block h-full w-full";
        host.replaceChildren(canvas);
        viewer = new OV.Viewer();
        viewer.Init(canvas);
        viewer.Resize(host.clientWidth, host.clientHeight);
        viewer.SetBackgroundColor(new OV.RGBAColor(DARK.r, DARK.g, DARK.b, 255));
        void applyEnvironment(OV, viewer);
        loader = new OV.ThreeModelLoader();
        observer = new ResizeObserver(() => viewer?.Resize(host.clientWidth, host.clientHeight));
        observer.observe(host);
        engineRef.current = { OV, viewer };

        const name = filename.slice(filename.lastIndexOf("/") + 1);
        const info = await loadModelInto(OV, viewer, loader, new File([blob], name));
        if (ctrl.signal.aborted) return;
        setUpAxis(info.upAxis);
        setState({ status: "ready", info });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "This model couldn't be opened.",
        });
      }
    })();

    return () => {
      ctrl.abort();
      observer?.disconnect();
      loader?.Destroy();
      if (viewer) destroyViewer(viewer);
      engineRef.current = null;
      host.replaceChildren();
    };
  }, [src, filename]);

  const withViewer = (fn: (OV: O3dv, viewer: InstanceType<O3dv["Viewer"]>) => void) => {
    const e = engineRef.current;
    if (e) fn(e.OV, e.viewer);
  };

  const fit = () =>
    withViewer((_OV, v) => {
      v.FitSphereToWindow(v.GetBoundingSphere(() => true), true);
    });

  const changeUp = (axis: "Y" | "Z") => {
    setUpAxis(axis);
    withViewer((OV, v) => v.SetUpVector(axis === "Z" ? OV.Direction.Z : OV.Direction.Y, true));
  };

  const toggleEdges = () => {
    const next = !edges;
    setEdges(next);
    withViewer((OV, v) =>
      v.SetEdgeSettings(new OV.EdgeSettings(next, light ? new OV.RGBColor(40, 40, 40) : new OV.RGBColor(0, 0, 0), 1)),
    );
  };

  const toggleOrtho = () => {
    const next = !ortho;
    setOrtho(next);
    withViewer((OV, v) => v.SetProjectionMode(next ? OV.ProjectionMode.Orthographic : OV.ProjectionMode.Perspective));
  };

  const toggleLight = () => {
    const next = !light;
    setLight(next);
    const c = next ? LIGHT : DARK;
    withViewer((OV, v) => v.SetBackgroundColor(new OV.RGBAColor(c.r, c.g, c.b, 255)));
  };

  const snapshot = () =>
    withViewer((_OV, v) => {
      const host = hostRef.current;
      if (!host) return;
      const ratio = window.devicePixelRatio || 1;
      const url: string = v.GetImageAsDataUrl(host.clientWidth * ratio, host.clientHeight * ratio, false);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename.slice(filename.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")}.png`;
      a.click();
    });

  const ready = state.status === "ready";
  return (
    <div className="flex h-full min-h-[320px] flex-col" data-testid="model-viewer">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#2e2a22] px-2 py-1">
        <ToolButton label="Fit model to view" onClick={fit}>
          <Maximize size={14} aria-hidden /> Fit
        </ToolButton>
        <div className="mx-1 flex rounded border border-[#3a3428]" role="group" aria-label="Up axis">
          {(["Y", "Z"] as const).map((axis) => (
            <ToolButton key={axis} label={`${axis} axis up`} active={upAxis === axis} onClick={() => changeUp(axis)}>
              {axis}-up
            </ToolButton>
          ))}
        </div>
        <ToolButton label="Show edges" active={edges} onClick={toggleEdges}>
          <Grid3x3 size={14} aria-hidden /> Edges
        </ToolButton>
        <ToolButton label="Orthographic projection" active={ortho} onClick={toggleOrtho}>
          <Box size={14} aria-hidden /> Ortho
        </ToolButton>
        <ToolButton label={light ? "Dark background" : "Light background"} onClick={toggleLight}>
          {light ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
        </ToolButton>
        <ToolButton label="Save a PNG snapshot" onClick={snapshot}>
          <Camera size={14} aria-hidden /> Snapshot
        </ToolButton>
        {ready ? (
          <span className="ml-auto truncate text-[11.5px] text-[#a89a80]" data-testid="model-stats">
            {formatCount(state.info.vertices)} vertices · {formatCount(state.info.triangles)} triangles
            {state.info.size ? ` · ${formatSize(state.info.size)} units` : ""}
          </span>
        ) : null}
      </div>
      {ready && state.info.missingFiles.length > 0 ? (
        <div className="border-b border-[#2e2a22] px-3 py-1.5 text-[12px] text-[#d9b98a]" data-testid="model-missing">
          Shown without {state.info.missingFiles.length === 1 ? "a file" : "files"} it references:{" "}
          {state.info.missingFiles.join(", ")}. Materials or textures from them are missing.
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 touch-none" />
        {state.status === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#a89a80]">{state.step}</div>
        ) : null}
        {state.status === "error" ? (
          <div
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[#cfc8b8]"
            data-testid="model-error"
          >
            {state.message}
          </div>
        ) : null}
      </div>
      {ready ? (
        <div className="border-t border-[#2e2a22] px-3 py-1 text-[11px] text-[#7d725f]">
          Drag to orbit · right-drag or two fingers to pan · scroll or pinch to zoom
        </div>
      ) : null}
    </div>
  );
}
