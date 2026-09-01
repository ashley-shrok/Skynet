/**
 * Phase 67 /close 2026-09-01 follow-up (M2 + M3): shared coordinator
 * watermark constants + style helper.
 *
 * Before this module, the ~2KB inline SVG data-URL + full CSS-in-JS style
 * object was duplicated in IdentityBadge and IdentityModal (each adding
 * ~4KB per render across two components). The conversation row already
 * used `.pv-coordinator-watermark` in `pretty-conversations.css`; this
 * module keeps that side-by-side arrangement (CSS class for the row,
 * JS helper for badge + modal) but funnels everything through one
 * definition so a future tuning pass only edits ONE surface.
 *
 * M3 (unified null-hue fallback): the WATERMARK's null-hue fallback is
 * unified to 216 across every surface — the row's CSS `--pv-hue: 216`
 * default already gives 216; this helper's `hue` parameter is expected to
 * arrive as `identity.colorHue ?? 216` from both callers so badge and
 * modal render the same coral-blue watermark as the row when hue is null.
 * The CHROME fallback (badge/modal container tint) stays at `?? 35` at
 * the call sites — that decision is separate and load-bearing for the
 * existing visual identity of the pill / dialog.
 */
import type { CSSProperties } from "react";

/** MdHub hub-and-spoke SVG data-URL used as the watermark mask. Verbatim
 *  copy of the SVG that was previously duplicated in Badge, Modal, and
 *  pretty-conversations.css. Keep as a single string constant so any
 *  future icon swap only touches this file. */
export const COORDINATOR_WATERMARK_MASK_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M8.4 18.2c.38.5.6 1.12.6 1.8 0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3c.44 0 .85.09 1.23.26l1.41-1.77a4.504 4.504 0 0 1-1.09-3.69l-2.03-.68A2.997 2.997 0 0 1 0 9.5c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .07 0 .14-.01.21l2.03.68a4.468 4.468 0 0 1 3.22-2.32V5.91A3.018 3.018 0 0 1 9 3c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.4-.96 2.57-2.25 2.91v2.16c1.4.23 2.58 1.11 3.22 2.32L18 9.71V9.5c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3c-1.06 0-1.98-.55-2.52-1.37l-2.03.68a4.49 4.49 0 0 1-1.09 3.69l1.41 1.77c.38-.18.79-.27 1.23-.27 1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3c0-.68.22-1.3.6-1.8l-1.41-1.77c-1.35.75-3.01.76-4.37 0L8.4 18.2z'/></svg>\")";

/** Watermark hue null-fallback. Matches pretty-conversations.css
 *  `.pv-row { --pv-hue: 216; }` so all three surfaces agree when the
 *  identity's colorHue is null. */
export const COORDINATOR_WATERMARK_HUE_FALLBACK = 216;

/** Which surface the watermark is being rendered on. Currently the badge
 *  and modal share the same "larger" treatment (opacity 0.14, width 148,
 *  bleed -28/-32) per shape file tasting-v5 option-C. The `variant`
 *  parameter is present so a future divergence (e.g. modal getting a
 *  slightly different bleed) only touches this file. The `row` variant is
 *  reserved — the row uses the CSS class in pretty-conversations.css. */
export type CoordinatorWatermarkVariant = "row" | "badge" | "modal";

/**
 * Returns the full `React.CSSProperties` inline-style object for the
 * coordinator watermark span at the given hue + variant. Callers apply
 * this directly on a `<span aria-hidden data-testid="coordinator-
 * watermark" style={getCoordinatorWatermarkStyle(hue, variant)} />`.
 *
 * The `hue` parameter must already have the null-fallback applied by the
 * caller (`identity.colorHue ?? COORDINATOR_WATERMARK_HUE_FALLBACK`) —
 * keeping the fallback at the call site preserves the pattern of
 * "resolve identity nullables in the component, pass numbers to helpers".
 */
export function getCoordinatorWatermarkStyle(
  hue: number,
  variant: CoordinatorWatermarkVariant,
): CSSProperties {
  // Badge + modal share the same treatment today (shape-file locked).
  // The variant parameter is here for future-proofing.
  void variant;
  return {
    position: "absolute",
    right: -28,
    top: -32,
    bottom: -32,
    width: 148,
    zIndex: 0,
    pointerEvents: "none",
    opacity: 0.14,
    backgroundColor: `hsl(${hue}, 85%, 78%)`,
    WebkitMaskImage: COORDINATOR_WATERMARK_MASK_URL,
    maskImage: COORDINATOR_WATERMARK_MASK_URL,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}
