// Patch #51 introduced the WIP indicator; patch #72 reworked it.
// Patch #86 (2026-07-20): canvas Fibonacci-lattice 3D dot-orb.
// Patch #260 (2026-08-02): canvas "voxel cube" — 4×4×4 lattice (64 dots)
// rotating on two axes with a radial pulse. Selected by Ashley from a
// gallery ("Dense 4³" at 2.5× base speed, 1.5× original 50px footprint).
//
// 2026-09-05: swapped the canvas rAF render for a pre-rendered animated
// WebP (public/wip-cube.webp). Diagnosis: the rAF loop repainted the canvas
// texture every frame, forcing GPU re-upload + Layerize/Commit/PrePaint
// pipeline every rAF cycle — the pipeline cost is invariant to canvas size,
// so a 52×52 indicator burned 40–50% idle CPU on the Skynet tab. Replacing
// with an <img> loads the animation once and lets the browser's image
// decoder path play it back at near-zero cost.
//
// Rates nudged to make the loop seamless at T = 2π s (variant B):
//   ROT_X_RATE 0.7 → 0.75, PULSE_RATE 5.5 → 6.0. Y unchanged at 1.0.
// Renderer source: scripts/render-wip-cube.py — Pillow-based, runs the same
// rot3d + pulse math the canvas used, dumps 180 frames at 35ms/frame (30fps
// effective, 6300ms total = 0.27% slow vs exact 2π, imperceptible).
// Regenerate with `python3 scripts/render-wip-cube.py public/wip-cube.webp`.
//
// Mount conditions unchanged from #86 — PrettyView.tsx renders <WipBubble />
// as the last child of the content wrapper when EITHER (a) the Terminal PTY
// reports non-idle OR (b) backgrounded agents/shells are running.
//
// Deliberately NOT a bubble. WIP is a naked, centered indicator so
// at-a-glance parsing distinguishes "session is busy" from "assistant
// said something." role="status" + aria-label carry semantics for AT.

import { cn } from "@/lib/utils";

export function WipBubble() {
  return (
    <div className={cn("flex", "justify-start", "mt-3")}>
      <img
        src="/wip-cube.webp"
        alt=""
        role="status"
        aria-label="Claude is working"
        className="h-[52px] w-[52px]"
      />
    </div>
  );
}
