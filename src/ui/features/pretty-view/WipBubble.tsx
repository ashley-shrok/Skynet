// Patch #51 introduced the WIP indicator; patch #72 reworked it.
// Patch #86 (2026-07-20): canvas Fibonacci-lattice 3D dot-orb.
// Patch #260 (2026-08-02): canvas "voxel cube" — 4×4×4 lattice (64 dots)
// rotating on two axes with a radial pulse that ripples out from the
// center. Selected by Ashley from a gallery of voxel variants; picked the
// "Dense 4³" variant at 2.5× the gallery's base speed and 1.5× the
// original 50px footprint (75×75).
//
// Iter history for #260:
//   iter-1..4  Uiverse SVG loader with wave-mask overlay — dropped after
//              ~5s paint-defer on session mount.
//   iter-5     Canvas "orbital core".
//   iter-6     3³ voxel cube ("Fast" gallery entry).
//   iter-7     4³ voxel cube ("Dense" at 2.5× speed, 1.5× size, 75×75).
//   iter-8     Same cube, canvas trimmed to 52×52 to hug the cube's actual
//              rotated extent (~24 CSS px half-diameter) — kills the empty
//              padding band Ashley called out on iter-7 — shipped.
//
// Mount conditions unchanged from #86 — PrettyView.tsx renders <WipBubble />
// as the last child of the content wrapper when EITHER (a) the Terminal PTY
// reports non-idle OR (b) backgrounded agents/shells are running.
//
// Deliberately NOT a bubble. WIP is a naked, centered indicator so
// at-a-glance parsing distinguishes "session is busy" from "assistant
// said something." role="status" + aria-label carry semantics for AT.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// SCALE governs the VISUAL size of the cube (spacing + dot sizes). The
// canvas is sized to just enclose the cube's rotated extent instead of the
// naive 50 × SCALE, so there's no dead margin around the indicator.
// Max half-extent = sqrt(3) × 1.5 × SPACING + maxDotRadius ≈ 24.14 CSS px.
const SCALE = 1.5;
const CANVAS_PX = 52; // hugs the extent with ~2 CSS px anti-aliasing margin

// 4×4×4 voxel grid centered on origin — 64 points. Coords: -1.5..1.5.
const VOXELS: Array<{ x: number; y: number; z: number }> = [];
for (let x = 0; x < 4; x++) {
  for (let y = 0; y < 4; y++) {
    for (let z = 0; z < 4; z++) {
      VOXELS.push({ x: x - 1.5, y: y - 1.5, z: z - 1.5 });
    }
  }
}

// Precomputed distance-from-center per voxel — drives radial pulse phase.
const VOXEL_DIST = VOXELS.map((v) =>
  Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
);

// Base timings from gallery-voxel entry #4 "Dense 4³", each multiplied by
// the 2.5× Ashley selected on the global speed slider.
const BASE_SPEED = 2.5;
const SPACING = 5.5 * SCALE;                // 8.25
const ROT_Y_RATE = 0.40 * BASE_SPEED;       // 1.0
const ROT_X_RATE = 0.28 * BASE_SPEED;       // 0.7
const PULSE_RATE = 2.2 * BASE_SPEED;        // 5.5
const PULSE_DELAY = 1.2;                    // spatial (radians per unit)
const MAX_D = SPACING * 1.8;                // depth-normalization extent for dim=4

function rot3d(
  x: number,
  y: number,
  z: number,
  ay: number,
  ax: number
) {
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const y2 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  return { x: x1, y: y2, z: z2 };
}

export function WipBubble() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_PX * dpr;
    canvas.height = CANVAS_PX * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.translate(CANVAS_PX / 2, CANVAS_PX / 2);

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    type Item = { z: number; x: number; y: number; alpha: number; size: number };
    const buf: Item[] = new Array(VOXELS.length);
    for (let i = 0; i < VOXELS.length; i++) {
      buf[i] = { z: 0, x: 0, y: 0, alpha: 0, size: 0 };
    }

    const half = CANVAS_PX / 2;

    function renderFrame(t: number) {
      if (!ctx) return;
      ctx.clearRect(-half, -half, CANVAS_PX, CANVAS_PX);

      const gy = t * ROT_Y_RATE;
      const gx = t * ROT_X_RATE;

      for (let i = 0; i < VOXELS.length; i++) {
        const v = VOXELS[i];
        const p = rot3d(v.x * SPACING, v.y * SPACING, v.z * SPACING, gy, gx);
        const depthRaw = (p.z + MAX_D) / (2 * MAX_D);
        const depth =
          depthRaw < 0 ? 0 : depthRaw > 1 ? 1 : depthRaw;
        const pulse =
          0.5 + 0.5 * Math.sin(t * PULSE_RATE - VOXEL_DIST[i] * PULSE_DELAY);
        const alpha = (0.3 + depth * 0.5) * (0.6 + pulse * 0.4);
        const size = (0.8 + depth * 0.8 + pulse * 0.2) * SCALE;
        const it = buf[i];
        it.z = p.z;
        it.x = p.x;
        it.y = p.y;
        it.alpha = alpha;
        it.size = size;
      }

      buf.sort((a, b) => a.z - b.z);
      for (const it of buf) {
        ctx.fillStyle = `rgba(200, 230, 255, ${it.alpha})`;
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.size > 0 ? it.size : 0, 0, Math.PI * 2);
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
      const t = Math.max(0, (now - mountedAt) / 1000);
      renderFrame(t);
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className={cn("flex", "justify-start", "mt-3")}>
      <canvas
        ref={canvasRef}
        role="status"
        aria-label="Claude is working"
        className="h-[52px] w-[52px]"
      />
    </div>
  );
}
