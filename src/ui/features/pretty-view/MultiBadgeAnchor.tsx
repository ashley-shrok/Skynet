// Phase 93 Slice 2 Task 2 — MultiBadgeAnchor.
//
// Multi-badge extension of PrettyView's upper-right badge anchor. Mounted
// ONLY when `source.kind === "relay"` (PrettyView Task 3 gates the mount).
// Renders humans-first-alphabetical then agents-alphabetical with the
// viewing user excluded from humans (D-03 self-exclusion).
//
// ## Layout (D-01)
//
// Root container is `absolute top-4 right-5 z-[101] flex flex-row-reverse
// items-start gap-1` — position-parity with the harness single-badge anchor
// at PrettyView.tsx:3349-3366 (harness has no inner gap because it renders
// a single badge). Inner gap was `gap-2` at Slice 2 ship-time; halved to
// `gap-1` in Phase 97 Plan 01 (F-4 / D-11) — the harness OUTER-instrument
// `gap-2` reads too wide when applied as an INNER gap between multi-badge
// cells; halved for tighter grouping. `flex-row-reverse` means the FIRST
// DOM child
// is RIGHTMOST visually; badges grow LEFTWARD from the harness anchor
// point. To achieve "humans-first" visual ordering (humans nearest the
// harness anchor, agents further left), agents map FIRST in JSX (rightmost
// visually) and humans map SECOND. This is Slice D's inversion; Slice D
// used a top-of-pane flex-row layout, and per RESEARCH.md Assumption A3
// we've flipped to flex-row-reverse for the leftward-growing D-01 anchor.
//
// ## Per-role rendering (D-02)
//
// - HUMAN (D-09): plain IdentityBadge wrapped in a `relative` positioning
//   cell (IdentityBadge's own `absolute` positioning scoped to the cell so
//   it doesn't collapse against the page). NO meter appendage.
// - AGENT (D-02/D-08): AgentBadgeWithMeter (Task 1 port) — plain badge
//   PLUS a shrunk meter + reset appendage. Meter reads via Wave 0
//   useSessionContextPct; reset dispatches via Wave 0 /agent-reset endpoint.
//   Reset is INTERNAL to AgentBadgeWithMeter.
//
// ## Loading vs. empty discrimination (Warning 2)
//
// When `isReady={false}` (WS still connecting), the anchor renders a
// subtle placeholder so the relay tab does NOT appear empty during the
// WS-connecting window. When `isReady={true}` with zero non-self
// participants, renders null (empty case).
//
// ## D-08 discipline
//
// This component does NOT read `source.kind`. It is only mounted when
// PrettyView (Task 3) has narrowed `source.kind === "relay"`. The
// component itself is source-oblivious — takes participants and viewing
// user as explicit props.
//
// ## D-18 discipline
//
// Badge-click in relay case is a no-op — human cells render bare
// IdentityBadge with no onClick prop; agent cells render
// AgentBadgeWithMeter whose badge is inert (reset button is separately
// clickable). No IdentityModal, no navigation.

import { cn } from "@/lib/utils";
import { IdentityBadge } from "@/features/terminal/IdentityBadge";
import { useIdentities } from "@/state/identities-store";
import { resolveMxidToIdentity } from "@/features/pretty-view/relay-mxid-resolve";
import { AgentBadgeWithMeter } from "./AgentBadgeWithMeter";
// Phase 93 Slice 4 (D-04): types re-homed to pretty-view/sources/ as part
// of the standalone relay-source tree retirement. Byte-identical shape
// (Slice 3 Task 1 verbatim port of the wire types).
import type {
  HumanParticipant,
  AgentParticipant,
} from "./sources/relay-room-api";

export interface MultiBadgeAnchorProps {
  /** Participants — humans + agents. Both arrays may be empty. */
  participants: { humans: HumanParticipant[]; agents: AgentParticipant[] };
  /**
   * The viewing user's Matrix mxid. Drives the D-03 self-exclusion filter
   * (the viewer's own badge is not shown; the harness-anchor convention
   * "right-side-is-you" is preserved conceptually — the viewer sees others,
   * not themselves).
   */
  viewingUserMxid: string;
  /**
   * fleet-derived identityKey → hostId mapping (from
   * `buildIdentityHostsFromFleet`). Agent cells look up their host via this
   * map. Agents without a mapping render as a bare badge with a structured
   * warn — graceful degradation.
   */
  fleetIdentityHosts: Record<string, number>;
  /**
   * `false` = WS still connecting, participants list not yet authoritative
   * — renders the loading placeholder. `true` = participants list is
   * authoritative — renders normally per sort discipline (or null if the
   * effective participant count is zero after self-exclusion).
   *
   * Slice 3's real relay adapter flips this true when the first participants
   * frame arrives. The Slice 1 stub returns false so the loading placeholder
   * is what displays for a Slice-2-era relay mount.
   */
  isReady: boolean;
  /** Optional wrapper class override. */
  className?: string;
  /**
   * Phase 97 Finding 2: the enclosing relay tab's tabId. Threaded to every
   * per-participant IdentityBadge child so each badge becomes a drag SOURCE
   * carrying the ROOM tab's tabId (dragging any badge drags the whole room
   * tab, per D-05). Undefined → badges are not drag-sourceable (parity with
   * pre-Phase-97 behavior). D-18 preserved: onClick is separately
   * not-supplied by MultiBadgeAnchor, so click remains inert; only
   * drag-source is enabled by tabId presence. The isMobile gate at
   * IdentityBadge.tsx:82 still applies (mobile stays non-draggable).
   */
  tabId?: string;
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

/**
 * A single human's badge cell. Renders the plain IdentityBadge with NO
 * appendage (D-02/D-09). Wrapped in a `relative` positioning cell so
 * IdentityBadge's absolute positioning is scoped to this cell rather than
 * the page (IdentityBadge.tsx:110 bakes `absolute top-4 right-5 z-[101]`
 * into its own rootClassName).
 */
function HumanBadgeCell({
  human,
  tabId,
}: {
  human: HumanParticipant;
  tabId?: string;
}) {
  const { byKey } = useIdentities();
  const resolution = resolveMxidToIdentity(human.mxid, byKey);
  const identityKey =
    resolution.identity !== null
      ? resolution.identity.identityKey
      : extractLocalpart(human.mxid);
  return (
    <div
      data-testid="relay-room-participant"
      data-role="human"
      data-mxid={human.mxid}
      className="relative shrink-0 h-[72px] w-[220px] flex flex-col items-stretch"
    >
      <IdentityBadge identityKey={identityKey} tabId={tabId} />
    </div>
  );
}

/**
 * A single agent's badge cell. Renders AgentBadgeWithMeter (Task 1 port —
 * plain badge + shrunk meter + reset appendage). Graceful degradation on
 * missing host mapping: renders the plain badge without appendage and
 * emits a structured warn.
 */
function AgentBadgeCell({
  agent,
  fleetIdentityHosts,
  tabId,
}: {
  agent: AgentParticipant;
  fleetIdentityHosts: Record<string, number>;
  tabId?: string;
}) {
  const identityKey = agent.identityKey;
  const hostId = fleetIdentityHosts[identityKey];
  if (hostId === undefined) {
    // Defensive edge case — agent identity known but no live fleet mapping.
    // Log structurally so we can grep post-ship if this happens in the wild.
    // eslint-disable-next-line no-console
    console.warn({
      operation: "agent_badge_no_host_mapping",
      identityKey,
    });
    return (
      <div
        data-testid="relay-room-participant"
        data-role="agent"
        data-mxid={agent.mxid}
        className="relative shrink-0 h-[72px] w-[220px] flex flex-col items-stretch"
      >
        <IdentityBadge identityKey={identityKey} tabId={tabId} />
      </div>
    );
  }
  return (
    <div
      data-testid="relay-room-participant"
      data-role="agent"
      data-mxid={agent.mxid}
      className="relative shrink-0 h-[92px] w-[220px] flex flex-col items-stretch"
    >
      <AgentBadgeWithMeter
        identityKey={identityKey}
        mxid={agent.mxid}
        hostId={hostId}
        // One-identity-one-tmux-session convention: the identityKey IS the
        // tmux session name (lowercased) that the fleet publishes.
        tmuxSessionName={identityKey}
        tabId={tabId}
      />
    </div>
  );
}

/**
 * Root anchor class — Warning 2: kept identical between the loading branch
 * and the ready-with-participants branch so the position class parks at
 * the D-01 anchor from mount, regardless of adapter readiness.
 */
const ROOT_ANCHOR_CLASS =
  "absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-1";

export function MultiBadgeAnchor({
  participants,
  viewingUserMxid,
  fleetIdentityHosts,
  isReady,
  className,
  tabId,
}: MultiBadgeAnchorProps) {
  // D-03 self-exclusion filter for humans + humans-alphabetical sort.
  const humansOther = participants.humans
    .filter((h) => h.mxid !== viewingUserMxid)
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  // Agents alphabetical by identityKey (D-03).
  const agentsSorted = participants.agents
    .slice()
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  const totalCells = humansOther.length + agentsSorted.length;

  // Warning 2: loading discrimination. `isReady={false}` renders a subtle
  // placeholder so the relay tab does not appear empty during the
  // WS-connecting window. Anchor root class stays identical so the loading
  // placeholder parks at the D-01 anchor position.
  if (!isReady) {
    return (
      <div
        data-testid="multi-badge-anchor"
        className={cn(ROOT_ANCHOR_CLASS, className)}
      >
        <div
          data-testid="multi-badge-anchor-loading"
          className="opacity-40 text-xs text-[#e8e4d8] select-none"
        >
          loading participants...
        </div>
      </div>
    );
  }

  // Warning 2: empty discrimination. `isReady={true}` with zero non-self
  // participants renders null. In practice this shouldn't happen for a
  // relay room (implies at least one other participant), but the guard
  // keeps the render safe. The empty case renders NOTHING (no anchor, no
  // placeholder, no cells) so the harness anchor spot stays clean.
  if (totalCells === 0) {
    return null;
  }

  // Otherwise render the badge row per D-03 sort discipline. Order matters
  // — flex-row-reverse means the FIRST DOM child is RIGHTMOST visually.
  // Emit agents FIRST so agents sit closest to the harness anchor point;
  // humans SECOND so they grow further left (visually: humans-then-agents
  // reading left-to-right).
  return (
    <div
      data-testid="multi-badge-anchor"
      className={cn(ROOT_ANCHOR_CLASS, className)}
    >
      {agentsSorted.map((a) => (
        <AgentBadgeCell
          key={a.mxid}
          agent={a}
          fleetIdentityHosts={fleetIdentityHosts}
          tabId={tabId}
        />
      ))}
      {humansOther.map((h) => (
        <HumanBadgeCell key={h.mxid} human={h} tabId={tabId} />
      ))}
    </div>
  );
}
