import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

/**
 * Pan / zoom surface for a decoded image: fit on load, scroll or pinch to
 * zoom around the pointer, drag to pan, 1:1, +/−. The canvas is shown as-is
 * (scaled with CSS), so huge images aren't re-rendered on every move.
 */

const MIN = 0.02;
const MAX = 32;

export function ZoomCanvas({ canvas }: { canvas: HTMLCanvasElement | null }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host || !canvas) return;
    const scale = Math.min(1, host.clientWidth / canvas.width, host.clientHeight / canvas.height) || 1;
    setView({
      scale,
      x: (host.clientWidth - canvas.width * scale) / 2,
      y: (host.clientHeight - canvas.height * scale) / 2,
    });
  }, [canvas]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const holder = host.querySelector<HTMLDivElement>("[data-canvas-holder]");
    if (!holder) return;
    holder.replaceChildren(...(canvas ? [canvas] : []));
    if (canvas) {
      canvas.style.display = "block";
      fit();
    }
  }, [canvas, fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const r = hostRef.current!.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = pinch.current.scale * (dist / pinch.current.dist);
      zoomAt(target / view.scale, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const center = () => {
    const host = hostRef.current;
    return host ? [host.clientWidth / 2, host.clientHeight / 2] : [0, 0];
  };

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={hostRef}
        className="absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        style={{
          backgroundColor: "#1c1915",
          backgroundImage:
            "linear-gradient(45deg,#26221c 25%,transparent 25%),linear-gradient(-45deg,#26221c 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#26221c 75%),linear-gradient(-45deg,transparent 75%,#26221c 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={fit}
        data-testid="zoom-canvas"
      >
        <div
          data-canvas-holder
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            imageRendering: view.scale >= 2 ? "pixelated" : "auto",
          }}
        />
      </div>
      <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded bg-black/60 p-0.5 text-[12px] text-[#e8e4d8]">
        <button type="button" title="Fit" aria-label="Fit to view" onClick={fit} className="rounded p-1 hover:bg-white/10">
          <Maximize size={13} aria-hidden />
        </button>
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, ...(center() as [number, number]))} className="rounded p-1 hover:bg-white/10">
          <Minus size={13} aria-hidden />
        </button>
        <button
          type="button"
          title="Actual size"
          onClick={() => zoomAt(1 / view.scale, ...(center() as [number, number]))}
          className="min-w-[3.2rem] rounded px-1 py-0.5 tabular-nums hover:bg-white/10"
          data-testid="zoom-level"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomAt(1.25, ...(center() as [number, number]))} className="rounded p-1 hover:bg-white/10">
          <Plus size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
