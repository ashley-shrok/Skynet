---
phase: quick-260720-ama
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/WipBubble.tsx
autonomous: true
requirements:
  - QUICK-260720-ama
tags:
  - ui
  - canvas
  - wip-indicator
  - pretty-view
must_haves:
  truths:
    - "WipBubble renders a 28px canvas element (h-7 w-7) instead of a Loader2 svg"
    - "In default motion mode, the canvas animates a Fibonacci-lattice sphere of 150 dots tumbling on X and Y axes"
    - "When prefers-reduced-motion is set, the canvas paints ONE static frame (t=0) and does not schedule requestAnimationFrame"
    - "Unmounting WipBubble cancels the active rAF (no leaked animation frames)"
    - "Assistive tech still receives role=\"status\" and aria-label=\"Claude is working\""
    - "Outer container is exactly <div className={cn(\"flex\",\"justify-start\")}> — bare-glyph invariant (patch #72) preserved, no bubble/card wrapper"
    - "`pnpm type-check` succeeds"
    - "`pnpm build` succeeds"
  artifacts:
    - path: "src/ui/features/pretty-view/WipBubble.tsx"
      provides: "Canvas-based 3D orb WIP indicator component (replaces Loader2)"
      contains: "Fibonacci-lattice sphere rendering with DPR-aware canvas + motion-reduce fallback"
      exports: ["WipBubble"]
  key_links:
    - from: "src/ui/features/pretty-view/WipBubble.tsx"
      to: "canvas 2D context"
      via: "useEffect on mount: canvasRef.current.getContext(\"2d\")"
      pattern: "getContext\\(\"2d\"\\)"
    - from: "src/ui/features/pretty-view/WipBubble.tsx"
      to: "requestAnimationFrame / cancelAnimationFrame"
      via: "rAF loop scheduled inside useEffect, cleaned up in return"
      pattern: "cancelAnimationFrame"
    - from: "src/ui/features/pretty-view/WipBubble.tsx"
      to: "prefers-reduced-motion media query"
      via: "window.matchMedia(\"(prefers-reduced-motion: reduce)\")"
      pattern: "prefers-reduced-motion"
---

<objective>
Replace the current `Loader2` spinner inside `WipBubble` with a canvas-rendered 3D orb — a Fibonacci-lattice sphere of 150 dots tumbling on X and Y axes with depth-modulated size and opacity. Ashley locked this design 2026-07-20 after 4 rounds of prototyping (see NOTES.md in `~/.claude/identities/tina/bounties/spirograph-wip-indicator/`).

Purpose: Ship the winning prototype variant as the production WIP indicator for the pretty-view.
Output: One rewritten file — `src/ui/features/pretty-view/WipBubble.tsx` — with zero new dependencies, preserved accessibility, preserved container invariant (patch #72), preserved motion-reduce support.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/features/pretty-view/WipBubble.tsx
@$HOME/.claude/identities/tina/bounties/spirograph-wip-indicator/NOTES.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Rewrite WipBubble.tsx as canvas-based 3D orb</name>
  <files>src/ui/features/pretty-view/WipBubble.tsx</files>
  <behavior>
    - Component still named `WipBubble`, still a default named export used by PrettyView.
    - Outer container is EXACTLY `<div className={cn("flex", "justify-start")}>` — no bubble, no card, no extra wrapper (patch #72 bare-glyph invariant).
    - Inner element is `<canvas>` with `ref={canvasRef}`, `role="status"`, `aria-label="Claude is working"`, `className="h-7 w-7"` (28px footprint matches the current Loader2, per patch #85).
    - On mount (single `useEffect(..., [])`):
      1. Read `dpr = window.devicePixelRatio || 1`.
      2. Set `canvas.width = 28 * dpr; canvas.height = 28 * dpr` (backing store; Tailwind `h-7 w-7` handles CSS size).
      3. Get `ctx = canvas.getContext("2d")`; bail out if null.
      4. Compute `scale = Math.min(canvas.width, canvas.height) / 2` (i.e. `14 * dpr`) and call `ctx.setTransform(scale, 0, 0, scale, canvas.width/2, canvas.height/2)` so drawing coords are in `[-1, 1]`.
      5. Set `ctx.lineCap = "round"` (unused today, future-safe).
      6. Detect `prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches`.
      7. If `prefersReduced`: call `renderFrame(0)` ONCE, do not schedule rAF, return a no-op cleanup.
      8. Otherwise: capture `mountedAt = performance.now()`, start rAF loop that computes `t = (now - mountedAt) / 1000` and calls `renderFrame(t)` each frame. Cleanup returns `cancelAnimationFrame(rafId)`.
    - Fibonacci-lattice points are computed ONCE at module scope (not per-mount, not per-frame): a `const POINTS: Array<{x:number,y:number,z:number}>` of length `N = 150`, using `phi = Math.PI * (3 - Math.sqrt(5))`. For each `i` in `[0, N)`:
      - `y = 1 - (i / (N - 1)) * 2`
      - `rXZ = Math.sqrt(1 - y*y)`
      - `θ = phi * i`
      - `POINTS[i] = { x: Math.cos(θ)*rXZ, y, z: Math.sin(θ)*rXZ }`
    - `renderFrame(t)` (defined inside the effect, closes over `ctx`):
      - `ay = t * 0.55`, `ax = t * 0.31`
      - `cy = cos(ay); sy = sin(ay); cx_ = cos(ax); sx = sin(ax)` (rename local to `cx_` to avoid shadowing anything; naming is discretion)
      - `ctx.clearRect(-2, -2, 4, 4)` (transform is active; this covers the [-1,1] area with margin)
      - For each `p` in `POINTS`:
        - `x1 = p.x*cy - p.z*sy`
        - `z1 = p.x*sy + p.z*cy`
        - `y2 = p.y*cx_ - z1*sx`
        - `z2 = p.y*sx + z1*cx_`
        - `px = x1 * 0.88`
        - `py = y2 * 0.88`
        - `depth = (z2 + 1) / 2`  // 0 = far, 1 = near
        - `dotSize = (0.55 + depth * 1.7) * 0.028`
        - `alpha = (0.25 + depth * 0.75) * 0.9`
        - `ctx.fillStyle = \`rgba(150, 180, 220, ${alpha})\``
        - `ctx.beginPath(); ctx.arc(px, py, dotSize, 0, 2*Math.PI); ctx.fill();`
    - Imports:
      - REMOVE `import { Loader2 } from "lucide-react";`
      - ADD `import { useEffect, useRef } from "react";`
      - KEEP `import { cn } from "@/lib/utils";`
    - Leave the file's leading comments (patch #51 + patch #72 provenance, "Deliberately NOT a bubble", aria/role rationale) in place; you may append a short note that the glyph is now a Fibonacci-lattice canvas orb picked 2026-07-20 after 4 rounds of prototyping (design archive: `~/.claude/identities/tina/bounties/spirograph-wip-indicator/`).
  </behavior>
  <action>
    Rewrite `src/ui/features/pretty-view/WipBubble.tsx` end-to-end to match the &lt;behavior&gt; block exactly. Follow the algorithm parameters from the hard_requirements block of the planning context (Fibonacci lattice, per-frame rotation, projection, depth-modulated dot size + alpha) — these are the LOCKED ship parameters Ashley approved and MUST NOT be adjusted.

    Key implementation constraints (recap so the executor does not need to re-derive):
    - `N = 150` (locked, do not change)
    - Y-axis rotation rate `0.55 rad/s`, X-axis rotation rate `0.31 rad/s` (locked)
    - Sphere radius `0.88` of canvas half-width (locked)
    - Point size formula `(0.55 + depth * 1.7) * 0.028` (locked)
    - Point alpha formula `(0.25 + depth * 0.75) * 0.9` (locked)
    - Color `rgba(150, 180, 220, alpha)` (locked — same as current WIP color)
    - Points array computed ONCE at module scope, not on every mount or every frame
    - `ctx.clearRect(-2, -2, 4, 4)` — coordinate system is transformed to [-1, 1]; a 4x4 area centered at origin fully clears the drawable area with margin
    - No `ctx.save()` / `ctx.restore()` needed — `setTransform` is called once during setup, not per frame
    - NO new imports beyond `useEffect` and `useRef` from React (already-present `cn` from `@/lib/utils` stays)
    - NO npm dependencies added (canvas API is browser-native, per constraint)
    - Preserve the outer `<div className={cn("flex", "justify-start")}>` container EXACTLY — this is the patch #72 bare-glyph invariant (no bubble/card wrapper). The inner element becomes `<canvas>` in place of the previous `<Loader2>`.
    - Preserve `role="status"` and `aria-label="Claude is working"` on the visible element (now the canvas, per hard_requirements) so assistive tech is unchanged.
    - Preserve `className="h-7 w-7"` for the 28px footprint (matches patch #85 sizing; keep the same visual footprint the layout expects).
    - Motion-reduce fallback: when `window.matchMedia("(prefers-reduced-motion: reduce)").matches` is true, render exactly ONE frame at `t = 0` and do NOT schedule rAF. Cleanup for that branch is a no-op (or return undefined from the effect body — the executor's discretion, as long as no rAF runs).
    - rAF lifecycle: store the current rAF id in a mutable variable local to the effect, and return `() => cancelAnimationFrame(rafId)` so unmount cannot leak an animation frame.

    Do NOT split this component across multiple files. Everything (the module-scope `POINTS` constant, the `WipBubble` function, the useEffect body, and the `renderFrame` closure) lives in this one file.
  </action>
  <verify>
    <automated>pnpm type-check &amp;&amp; pnpm build</automated>
  </verify>
  <done>
    - `src/ui/features/pretty-view/WipBubble.tsx` no longer imports from `lucide-react`.
    - `useEffect` + `useRef` are imported from `react`; `cn` still imported from `@/lib/utils`.
    - Module-scope `POINTS` constant of length 150 is present (grep-able as `N = 150` or `length: 150` — implementation discretion).
    - `phi = Math.PI * (3 - Math.sqrt(5))` appears exactly once in the file (Fibonacci lattice constant).
    - Rotation constants `0.55` and `0.31` both appear in the source (the per-frame axis rates).
    - Projection radius `0.88`, dot-size coefficients `0.55` and `1.7` and `0.028`, alpha coefficients `0.25`, `0.75`, `0.9` all appear as numeric literals (verifiable via grep).
    - `window.matchMedia("(prefers-reduced-motion: reduce)")` appears in source; when the query matches, no rAF is scheduled.
    - `cancelAnimationFrame` is called from the useEffect cleanup path.
    - Outer wrapper is EXACTLY `<div className={cn("flex", "justify-start")}>`; there is no extra bubble/card element.
    - Inner element is a `<canvas>` with `role="status"`, `aria-label="Claude is working"`, `className="h-7 w-7"`.
    - `pnpm type-check` exits 0.
    - `pnpm build` exits 0.
    - No new entries in `package.json` dependencies (grep the git diff — package.json should be untouched by this plan).
  </done>
</task>

</tasks>

<verification>
Automated (executor runs these; both must succeed):
- `pnpm type-check` — TypeScript passes (no `any` implicit types on the canvas ref, `points` array, or `ctx`).
- `pnpm build` — Vite frontend build + tsconfig.node.json build both succeed.

Structural (grep-able post-edit, executor should spot-check):
- `grep -c "from \"lucide-react\"" src/ui/features/pretty-view/WipBubble.tsx` — 0 (Loader2 import removed).
- `grep -c "useEffect\|useRef" src/ui/features/pretty-view/WipBubble.tsx` — ≥ 2 (both hooks used).
- `grep -c "Math\\.sqrt(5)" src/ui/features/pretty-view/WipBubble.tsx` — 1 (Fibonacci phi).
- `grep -c "prefers-reduced-motion" src/ui/features/pretty-view/WipBubble.tsx` — 1.
- `grep -c "cancelAnimationFrame" src/ui/features/pretty-view/WipBubble.tsx` — 1 (cleanup path).
- `git diff --name-only` after the edit lists ONLY `src/ui/features/pretty-view/WipBubble.tsx` (nothing else — no package.json, no new files).

Visual verification is DEFERRED to deploy time in Ashley's browser (per planning context). No unit test or Playwright hookup required for this quick task.
</verification>

<success_criteria>
- WipBubble.tsx compiles cleanly (`pnpm type-check` exits 0).
- Frontend builds cleanly (`pnpm build` exits 0).
- The only file changed by this plan is `src/ui/features/pretty-view/WipBubble.tsx`.
- No npm dependencies added or removed (package.json / pnpm-lock.yaml untouched).
- All locked algorithm parameters from the hard_requirements block are present in the source (verifiable by grep, per the verification block).
- Container / a11y / motion-reduce invariants are preserved (bare-glyph wrapper, role="status", aria-label unchanged, static-frame fallback, rAF cleanup on unmount).
</success_criteria>

<output>
Create `.planning/quick/260720-ama-3d-orb-wip-indicator-canvas-based-fibona/260720-ama-SUMMARY.md` when done, following the standard summary template. Key items to record in the summary:
- Confirmation that only `src/ui/features/pretty-view/WipBubble.tsx` changed
- `pnpm type-check` + `pnpm build` output tails (or "clean")
- Brief note that visual verification is Ashley's next step at deploy time
- Pointer back to the design archive: `~/.claude/identities/tina/bounties/spirograph-wip-indicator/NOTES.md`
</output>
