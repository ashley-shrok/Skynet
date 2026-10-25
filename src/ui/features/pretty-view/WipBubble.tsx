// Patch #51 introduced the WIP indicator; patch #72 reworked it.
// Patch #86 (2026-07-20): canvas Fibonacci-lattice 3D dot-orb.
// Patch #260 (2026-08-02): canvas "voxel cube" — 4×4×4 lattice (64 dots)
// rotating on two axes with a radial pulse. Selected by user from a
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
// Regenerate with `python3 scripts/render-wip-cube.py docker/branding-defaults/wip-cube.webp`.
// 2026-09-07 (Phase 82): image src is now branding-configurable via useBrandingConfig().wipIndicatorPath; asset moved from public/ to docker/branding-defaults/ so it flows through the branding router's per-file fallback (override → bundled default). Operators drop /opt/skynet/branding/wip-cube.webp for a custom animation — no restart needed.
//
// 2026-10-24 (shape-conversation-view): the default is now an orb in the
// agent's colour — an arc spinning around a breathing core, beside the word
// "Working" (conversation.css .pv-wip*). Only transform / opacity animate, so
// it costs nothing per frame. An installation that supplies its own working
// image (branding wipIndicatorCustom) keeps its image.
//
// Mount condition: PrettyView's agentWorking (main turn working, or a
// background sub-agent running).
//
// Deliberately NOT a bubble, so at-a-glance parsing distinguishes "session is
// busy" from "assistant said something." role="status" + aria-label carry
// semantics for AT.
//
// Work narration (2026-10-25): an optional one-line "where the agent is in
// the job" from the backend, in a short and a long version. Once the turn's
// first line arrives it takes the place of "Working" (beside the custom image
// on installations that have one); the long version shows when it fits on one
// line, else the short one. Never wraps. A new line fades in over the old one.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBrandingConfig } from "@/branding/branding-store";

const FADE_MS = 200;

type Narration = { short: string; long: string };

function NarrationLine({ line, className }: { line: Narration; className: string }) {
  // The line on screen. A new line fades out the old one first.
  const [shown, setShown] = useState(line);
  const [opaque, setOpaque] = useState(true);
  useEffect(() => {
    if (line.short === shown.short && line.long === shown.long) {
      // Back to the line already on screen mid-fade: make sure it's visible.
      setOpaque(true);
      return;
    }
    setOpaque(false);
    const t = setTimeout(() => {
      setShown(line);
      setOpaque(true);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [line, shown]);

  // Long version when it fits on one line in the space available, else short.
  const slotRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [longFits, setLongFits] = useState(true);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const measure = measureRef.current;
    if (!slot || !measure) return;
    const check = () => setLongFits(measure.offsetWidth <= slot.clientWidth);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [shown.long]);

  return (
    <span ref={slotRef} className="relative block min-w-0 flex-1">
      <span
        ref={measureRef}
        aria-hidden="true"
        className={`pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap ${className}`}
      >
        {shown.long}
      </span>
      <span
        data-testid="wip-narration"
        className={`block overflow-hidden text-ellipsis whitespace-nowrap transition-opacity ${className}`}
        style={{ opacity: opaque ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        {longFits ? shown.long : shown.short}
      </span>
    </span>
  );
}

export function WipBubble({ narration = null }: { narration?: Narration | null }) {
  const { wipIndicatorPath, wipIndicatorCustom } = useBrandingConfig();
  if (wipIndicatorCustom) {
    return (
      <div className="flex justify-start items-center mt-3">
        <img
          src={wipIndicatorPath}
          alt=""
          role="status"
          aria-label="Claude is working"
          className="h-[52px] w-[52px] flex-none"
        />
        {narration && (
          <span className="ml-2.5 flex min-w-0 flex-1">
            <NarrationLine line={narration} className="text-sm text-muted-foreground" />
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className="pv-wip"
        role="status"
        aria-label="Claude is working"
        data-testid="pv-wip"
        // With a line, the indicator spans the row so the line can use the room.
        style={narration ? { display: "flex", flex: "1 1 auto", minWidth: 0 } : undefined}
      >
        <span className="pv-wip-orb" aria-hidden="true">
          <i />
        </span>
        {narration ? (
          <NarrationLine line={narration} className="pv-wip-word" />
        ) : (
          <span className="pv-wip-word" aria-hidden="true">
            Working
          </span>
        )}
      </div>
    </div>
  );
}
