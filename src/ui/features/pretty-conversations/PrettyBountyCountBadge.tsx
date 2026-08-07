// ─── PrettyBountyCountBadge (Phase 26 Plan 03 — combined pin·desk pill) ───────
//
// Stateless combined pin·desk pill inside .pv-meta. Accepts a {pinnedCount,
// needsDeskCount} pair and renders per the 4-case rendering-rule table from
// CONTEXT.md §decisions "Row-display format — LOCKED" (D-01):
//
//   case 1: both undefined (pre-fetch)           → null (no pill)
//   case 2: both coerced to 0                    → null (no pill)
//   case 3: pinnedCount>0, needsDeskCount===0    → "3·" (right side blank)
//   case 4: pinnedCount===0, needsDeskCount>0    → "·1" (left side blank)
//   case 5: both>0                               → "3·1"
//
// Middle-dot separator is U+00B7 `·` (not a hyphen or interpunct near-miss).
//
// The pill occupies the SAME .pv-meta slot as the previous single-count badge
// (order left-to-right: [deactivate] [pin] [bounty-badge] [ready-dot]).
// Both halves inherit --pv-hue from the .pv-row parent — no dual-hue
// treatment. All hue tinting comes from the `.pv-row` parent's `--pv-hue`
// custom property inheritance (palette-authority rule); the badge does not
// redefine those custom properties.
//
// Coexists with (does not replace) the ready-for-attention dot in .pv-meta.
// See PrettyConversationRow.tsx for the insertion site + coexistence contract.

import React from "react";

export function PrettyBountyCountBadge({
  pinnedCount,
  needsDeskCount,
}: {
  pinnedCount: number | undefined;
  needsDeskCount: number | undefined;
}): JSX.Element | null {
  const p = pinnedCount ?? 0;
  const d = needsDeskCount ?? 0;

  // null cases: fully unpopulated pair (both undefined = pre-fetch) OR both
  // coerced values are 0 (absence is the correct signal — no empty pill).
  if (
    (pinnedCount === undefined && needsDeskCount === undefined) ||
    (p === 0 && d === 0)
  ) {
    return null;
  }

  return (
    <span
      className="pv-bounty-badge"
      data-testid="pv-bounty-badge"
      aria-label={`${p} pinned, ${d} needs desk`}
    >
      <span
        className="pv-bounty-badge-half pv-bounty-badge-half--pinned"
        data-testid="pv-bounty-badge-pinned"
      >
        {p > 0 ? String(p) : ""}
      </span>
      <span className="pv-bounty-badge-sep" aria-hidden="true">
        {"·"}
      </span>
      <span
        className="pv-bounty-badge-half pv-bounty-badge-half--needs-desk"
        data-testid="pv-bounty-badge-needs-desk"
      >
        {d > 0 ? String(d) : ""}
      </span>
    </span>
  );
}
