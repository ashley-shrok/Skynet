// Patch #51 introduced the WIP indicator; patch #72 reworked it.
// Patch #86 (2026-07-20): Replaced Loader2 spinner with a canvas-rendered
// Fibonacci-lattice 3D orb. Design locked by Ashley after 4 rounds of
// prototyping (archive: ~/.claude/identities/tina/bounties/spirograph-wip-indicator/).
//
// Mounted by PrettyView.tsx as the last child of the content wrapper when
// EITHER (a) the Terminal PTY reports non-idle (Claude is mid-turn) OR
// (b) backgrounded agents/shells are running. All three states share one
// practical meaning to the operator: "session is busy, come back later."
//
// Deliberately NOT a bubble. WIP is a naked, floating, assistant-aligned
// spinner so at-a-glance parsing distinguishes "session is busy" (spinner,
// no bubble) from "assistant said something" (bubble). Contrast with
// PlanPendingBubble, which KEEPS its bubble because plan-pending semantics
// are "idle, waiting on you" — message-shaped, message chrome.
//
// aria-label + role="status" carry the semantic for assistive technology.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Fibonacci-lattice sphere: 150 points distributed over the unit sphere.
// Computed once at module scope — not per-mount, not per-frame.
const N = 150;
const phi = Math.PI * (3 - Math.sqrt(5));

const POINTS: Array<{ x: number; y: number; z: number }> = Array.from(
  { length: N },
  (_, i) => {
    const y = 1 - (i / (N - 1)) * 2;
    const rXZ = Math.sqrt(1 - y * y);
    const θ = phi * i;
    return { x: Math.cos(θ) * rXZ, y, z: Math.sin(θ) * rXZ };
  }
);

export function WipBubble() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = 50 * dpr;
    canvas.height = 50 * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = Math.min(canvas.width, canvas.height) / 2; // 14 * dpr
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
    ctx.lineCap = "round";

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    function renderFrame(t: number) {
      if (!ctx) return;
      const ay = t * 0.55;
      const ax = t * 0.31;
      const cy = Math.cos(ay);
      const sy = Math.sin(ay);
      const cx_ = Math.cos(ax);
      const sx = Math.sin(ax);

      ctx.clearRect(-2, -2, 4, 4);

      for (const p of POINTS) {
        const x1 = p.x * cy - p.z * sy;
        const z1 = p.x * sy + p.z * cy;
        const y2 = p.y * cx_ - z1 * sx;
        const z2 = p.y * sx + z1 * cx_;

        const px = x1 * 0.88;
        const py = y2 * 0.88;
        const depth = (z2 + 1) / 2; // 0 = far, 1 = near
        const dotSize = (0.55 + depth * 1.7) * 0.028;
        const alpha = (0.25 + depth * 0.75) * 0.9;

        ctx.fillStyle = `rgba(150, 180, 220, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, dotSize, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    if (prefersReduced) {
      renderFrame(0);
      return;
    }

    const mountedAt = performance.now();
    let rafId: number;

    function loop(now: number) {
      const t = (now - mountedAt) / 1000;
      renderFrame(t);
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className={cn("flex", "justify-start")}>
      <canvas
        ref={canvasRef}
        role="status"
        aria-label="Claude is working"
        className="h-[50px] w-[50px]"
      />
    </div>
  );
}
