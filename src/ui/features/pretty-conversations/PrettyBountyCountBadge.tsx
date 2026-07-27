// ─── PrettyBountyCountBadge (quick 260727-tb1 Task 3) ────────────────────────
//
// Stateless pill component inside .pv-meta showing the count of non-archived,
// on_deck-status bounties for the row's identity. Falsy count (undefined OR 0)
// renders NULL — absence is the correct signal (Key design decision #7 in the
// approved spec). All hue tinting comes from the `.pv-row` parent's `--pv-hue`
// custom property inheritance (palette-authority rule); the badge does not
// redefine those custom properties.
//
// Coexists with (does not replace) the ready-for-attention dot in .pv-meta.
// Order left-to-right: [deactivate] [pin] [badge] [ready-dot]. See
// PrettyConversationRow.tsx for the insertion site + the coexistence contract.

import React from "react";

export function PrettyBountyCountBadge({
  count,
}: {
  count: number | undefined;
}) {
  if (!count) return null; // covers undefined and 0
  return (
    <span className="pv-bounty-badge" data-testid="pv-bounty-badge">
      {count}
    </span>
  );
}
