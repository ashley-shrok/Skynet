// ─── PrettyBountyCountBadge — notification-badge style (V12, tiffany 2026-08-18) ──
//
// Stateless {pinned, needs-desk} display inside .pv-meta. Renders zero, one,
// or two icon-with-corner-count "wraps" per the count values. Replaces the
// prior middle-dot pill (Phase 26 Plan 03) — Ashley picked V12 from the
// pinned-desk-display-tasting bounty after seeing 20 variants + a live
// A/B via console overlay.
//
// Rendering rule (superset of the old 4-case table — each axis is independent):
//   - pinnedCount    > 0 → render Pin-icon wrap with corner count
//   - needsDeskCount > 0 → render Monitor-icon wrap with corner count
//   - both 0 / both undefined → render nothing (null; absence IS the signal)
//   - one undefined, other 0 → still null (unfetched pair)
//
// Corner count: bright cream pill (#f0ebe0) with dark text (#0a0b12) — the
// only "shouty" element in the row; icon body sits quiet at 70% opacity in
// warm off-white. No hue tinting on the badge itself (unlike the old pill's
// hue-tinted chrome) — the row's ready-dot still carries the per-identity
// hue signal in .pv-meta.
//
// Occupies the SAME .pv-meta slot as the previous pill (left-to-right order:
// [deactivate] [pin] [bounty-badge] [ready-dot]).

import React from "react";
import { Pin, Monitor } from "lucide-react";

export function PrettyBountyCountBadge({
  pinnedCount,
  needsDeskCount,
}: {
  pinnedCount: number | undefined;
  needsDeskCount: number | undefined;
}): JSX.Element | null {
  const p = pinnedCount ?? 0;
  const d = needsDeskCount ?? 0;

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
      {p > 0 && (
        <span
          className="pv-bounty-badge-wrap"
          data-testid="pv-bounty-badge-pinned"
        >
          <Pin className="pv-bounty-badge-icon" aria-hidden="true" />
          <span className="pv-bounty-badge-num">{p}</span>
        </span>
      )}
      {d > 0 && (
        <span
          className="pv-bounty-badge-wrap"
          data-testid="pv-bounty-badge-needs-desk"
        >
          <Monitor className="pv-bounty-badge-icon" aria-hidden="true" />
          <span className="pv-bounty-badge-num">{d}</span>
        </span>
      )}
    </span>
  );
}
