// Phase 90 Plan 05 Task 2 — IdentityBadgeRow.
//
// The horizontal participant row at the top of the relay-room pane. Renders
// one badge per participant EXCEPT the viewing user (D-07 right-side-is-you
// convention — no self-tile).
//
// Ordering (D-07): humans first (alphabetical by displayName), agents second
// (alphabetical by identityKey). NOT recency-of-last-message reshuffling
// (rejected during grill — restless). NOT fixed-at-room-creation (arbitrary
// and unreadable).
//
// Per-role rendering:
//   - HUMAN (D-09): plain IdentityBadge, NO appendage, NO meter, NO reset.
//     Absence of the appendage is how the viewer distinguishes humans from
//     agents at a glance. Humans don't have bounded context (nothing to
//     meter) and nothing to reset.
//   - AGENT (D-08): PLACEHOLDER cell in this plan. Renders the plain badge
//     PLUS a `data-slot="agent-badge-appendage"` container that Plan 06
//     replaces with the full `AgentBadgeWithAppendage` component (meter +
//     reset). Keeping the plain badge here means the row layout is stable
//     across plans.
//
// IdentityBadge positioning quirk (from IdentityBadge.tsx L102): the badge
// primitive's rootClassName carries `absolute top-4 right-5 z-[101]` for
// pretty-view / terminal-mode overlay use. For badge-row use, that absolute
// positioning would break the horizontal flex layout — every badge would
// stack at the same top/right corner. Fix: wrap each badge in a `<div
// className="relative">` cell. The `relative` establishes a positioning
// context so IdentityBadge's `absolute` is scoped to the cell (a no-op
// visually because the cell is the same size as the badge would be) instead
// of the page.
//
// Identity resolution for humans: participants come from Plan 04's REST
// endpoint carrying (mxid, displayName, userId). To render an IdentityBadge,
// we need an identityKey. `resolveMxidToIdentity` (imported from the
// pretty-view sibling — pure helper per Plan 02 Task 3 rationale) extracts
// the localpart and looks it up in useIdentities().byKey. Phase 88 slice A
// created identity records for humans on birth, so most humans should
// resolve. When they don't, IdentityBadge itself returns null and the cell
// renders empty — a graceful degradation.
//
// Narrow-viewport fallback (D-20): outer row uses `overflow-x-auto` so
// badges scroll horizontally on narrow viewports rather than wrapping /
// clipping. v1.5 will revisit once real rooms show real pain points.

import { cn } from "@/lib/utils";
import { useIdentities } from "@/state/identities-store";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { resolveMxidToIdentity } from "@/features/pretty-view/relay-mxid-resolve";
import type { HumanParticipant, AgentParticipant } from "./relay-room-api";

export interface IdentityBadgeRowProps {
  /**
   * Humans from Plan 04's participants source (either the REST endpoint OR
   * the WS `participants` frame). The row filters out the viewing user
   * client-side regardless of source — the REST endpoint already filters
   * server-side, but filtering here again is defensive + also handles the
   * WS-frame path which carries the full list.
   */
  humans: HumanParticipant[];
  /** Agents from the same source; row does NOT self-filter (viewer is not an agent). */
  agents: AgentParticipant[];
  /**
   * The viewing user's Matrix mxid (from useViewingUserMxid — W#8). Drives
   * the D-07 self-exclusion filter.
   */
  viewingUserMxid: string;
  /** Optional wrapper class override. */
  className?: string;
}

/**
 * A single human's badge cell. Renders the plain IdentityBadge with NO
 * appendage (D-09). Wrapped in a `relative` positioning cell so
 * IdentityBadge's absolute positioning is scoped to this cell.
 */
function HumanBadgeCell({ human }: { human: HumanParticipant }) {
  const { byKey } = useIdentities();
  const resolution = resolveMxidToIdentity(human.mxid, byKey);
  // Prefer the resolved identity's key when available (matches server-side
  // identityKey derivation); fall back to the mxid localpart. Never leaves
  // an empty string — IdentityBadge internally returns null on unresolved,
  // which is acceptable graceful degradation.
  const identityKey =
    resolution.identity !== null
      ? resolution.identity.identityKey
      : extractLocalpart(human.mxid);
  return (
    <div
      data-testid="relay-room-participant"
      data-role="human"
      data-mxid={human.mxid}
      // `relative` establishes a positioning context for IdentityBadge's
      // absolute positioning (see file header — the absolute is scoped to
      // this cell instead of the page). Reserve height so the badge, which
      // is absolute-positioned inside, has a size to occupy in the flow.
      className="relative shrink-0 h-[72px] w-[220px]"
    >
      <IdentityBadge identityKey={identityKey} />
    </div>
  );
}

/**
 * A single agent's badge PLACEHOLDER cell for this plan. Renders the plain
 * badge PLUS a `data-slot="agent-badge-appendage"` container that Plan 06
 * will fill with the full AgentBadgeWithAppendage (meter + reset). Wrapped
 * in a `relative` positioning cell — same IdentityBadge positioning quirk
 * fix as HumanBadgeCell.
 */
function AgentBadgeCellPlaceholder({ agent }: { agent: AgentParticipant }) {
  return (
    <div
      data-testid="relay-room-participant"
      data-role="agent"
      data-mxid={agent.mxid}
      className="relative shrink-0 h-[72px] w-[220px] flex flex-col items-stretch"
    >
      <IdentityBadge identityKey={agent.identityKey} />
      {/* Placeholder appendage slot — Plan 06 replaces AgentBadgeCell-
          Placeholder with AgentBadgeWithAppendage and fills this container
          with the shrunk meter + reset button. Kept as an empty container
          so the row layout is stable across plans (no visual reflow when
          Plan 06 lands). */}
      <div
        data-slot="agent-badge-appendage"
        className="h-0 w-full"
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * Extract the localpart of an mxid (`@localpart:server` → `localpart`).
 * Lowercased for parity with sessionMatchKey / identityKey conventions.
 * Returns the empty string on malformed input.
 */
function extractLocalpart(mxid: string): string {
  if (!mxid.startsWith("@")) return "";
  const colon = mxid.indexOf(":");
  if (colon <= 1) return "";
  return mxid.slice(1, colon).toLowerCase();
}

export function IdentityBadgeRow({
  humans,
  agents,
  viewingUserMxid,
  className,
}: IdentityBadgeRowProps) {
  // D-07 self-exclusion filter for humans. Applied here so the WS-frame path
  // (which carries the full list) matches the REST endpoint path (which
  // server-side-filters) — one consistent visible-row-set regardless of
  // source.
  const humansOther = humans
    .filter((h) => h.mxid !== viewingUserMxid)
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  // Agents sorted alphabetical by identityKey (D-07).
  const agentsSorted = agents
    .slice()
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  return (
    <div
      data-testid="relay-room-identity-badge-row"
      className={cn(
        // Horizontal row of participant cells. `overflow-x-auto` is the
        // D-20 narrow-viewport fallback.
        "flex flex-row items-start gap-2 px-3 py-2 overflow-x-auto",
        // `shrink-0` on the outer container ensures the row keeps its own
        // height and doesn't get squeezed by a flex-column parent.
        "shrink-0",
        className,
      )}
    >
      {humansOther.map((h) => (
        <HumanBadgeCell key={h.mxid} human={h} />
      ))}
      {agentsSorted.map((a) => (
        <AgentBadgeCellPlaceholder key={a.mxid} agent={a} />
      ))}
    </div>
  );
}
