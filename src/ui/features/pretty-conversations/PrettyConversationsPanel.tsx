// ─── PrettyConversationsPanel ────────────────────────────────────────────────
// The flat-list composition of the Phase 10 pretty-conversations rework
// (as amended by Phase 41 Plan 01, Alice 2026-08-14 — three-zone reshape).
// Wraps Wave 1's `PrettyConversationRow` into a full conversation panel
// matching the user-signed-off prototypes (prototype.html for mobile,
// desktop.html for desktop):
//
//   - Pinned rows at the top with a "Pinned" divider chip (patch #234)
//   - Middle: FLAT recency-sorted rows (Phase 41 Plan 01). No per-host
//     divider chips. All non-pinned / non-active-set / non-RDP rows land
//     in `snapshot.middle` as a single flat array. Rendered in one
//     container with no host bucketing.
//   - RDP sentinel group rendered from `snapshot.rdpGroup` (nullable). When
//     `rdpGroup === null` (zero RDP-eligible hosts) the entire section —
//     divider chip + rows — is suppressed per Alice lock #7.
//     (The row's `data-rdp-host-row="true"` attribute already suppresses
//     pin+swipe intrinsically per Wave 1's contract.)
//   - Load-in-flight affordance: a compact "Loading conversations…" strip
//     with a spinning Loader2 renders at the top of the scroll region
//     while `useFleetSessionsLoaded()` is still false. Sits above whatever
//     rows have already arrived (RDP + openTab rows tend to land first
//     while the fleet enumeration is still in flight). No dedicated
//     empty-state card — the header chrome (SKYNET logo, pencil, filter,
//     usage meter) is affordance enough for a truly-empty list.
//   - Header carries a `variant` prop-driven layout:
//       * variant="mobile"  → pencil icon ONLY (right-aligned); no title
//       * variant="desktop" → title "Conversations" (left) + pencil (right)
//   - Pencil opens the existing NewSessionDialog VERBATIM (no dialog redesign)
//   - Gear (shadcn dropdown) removed in patch #133 — panel is now
//     shadcn-free.
//   - settingsRowSlot prop retired in Phase 11 (Alice's "no settings" lock —
//     SettingsRow deleted alongside AppRail).
//   - quick-260802-pq2: the mobile swipe-coordination layer
//     (currentlySwipedId + handleSwipeOpenChange + forceClosedFor + row-level
//     forceClosed/onSwipeOpenChange props) was retired alongside the row's
//     swipe state machine. Mobile row actions now flow through the same
//     PrettyConversationContextMenu desktop uses — reached via long-press on
//     mobile and right-click on desktop. Panel no longer coordinates row
//     open-state because there is no row open-state to coordinate.
//
// Store consumption is verbatim from ConversationsPanel.tsx — same three
// hooks (useConversations / useSelectedConversationId / usePinnedIds) and
// the same core action imports (selectConversation, plus pin/unpin — see
// handleTogglePin below for the both-shape write). No store reshape. No new
// derivations. The panel is a thin composition layer.
//
// Wave 3 (AppShell cutover) does the mount-site swap; this panel is NOT
// yet mounted anywhere. Wave 4 retires ConversationsPanel.tsx +
// ConversationRow.tsx.
//
// NO diagnostic spew — Patch #111e F3-diag scoped to the old panel is being
// retired in Wave 4 and NOT ported forward here.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
// Phase 41 Plan 01: `Server` icon retired alongside the per-host divider chips.
// Phase 41 Plan 02: `Search` and `X` icons added for the always-in-DOM search
// input mounted at the top of the pv-panel-scroll region.
import { ChevronDown, ChevronRight, EyeOff, Filter, Loader2, Monitor, MoreVertical, Search, X } from "lucide-react";
import GlobalFilesModal from "@/features/pretty-view/GlobalFilesModal";
import SkillsEditorModal from "@/features/pretty-view/SkillsEditorModal";
// Phase 90 Plan 90-06 (D-07 / D-04): the three-dots menu "Edit roles…" entry
// opens RolesListModal; a row click swaps to RoleModal; runbook click swaps to
// RunbookEditorModal (mirrors PrettyView's mount at L3281). All three are
// mounted as siblings alongside GlobalFilesModal + SkillsEditorModal.
import { RolesListModal } from "@/features/pretty-view/RolesListModal";
import { RoleModal } from "@/features/pretty-view/RoleModal";
import RunbookEditorModal from "@/features/pretty-view/RunbookEditorModal";
import { useTranslation } from "react-i18next";

import {
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  useHiddenIds,
  useActiveSet,
  useFleetSessionsLoaded,
  // Phase 92 Plan 04: hydrate effect reads the fleet-sessions snapshot to
  // build the identityHosts map for the deriveDiskPinnedIds projection.
  getFleetSessionsSnapshot,
  selectConversation,
  addToActiveSet,
  removeFromActiveSet,
  fleetRowId,
  pinConversation,
  unpinConversation,
  hydratePinnedIdsFromServer,
  hideConversation,
  unhideConversation,
  hydrateHiddenIdsFromServer,
  type ConversationRow as ConversationRowShape,
} from "@/state/conversation-store";
import {
  useSessionIsWorking,
  // Phase 47 Plan 04 — subscribes PrettyConversationRowLive to the working-
  // store's aiTitle axis (Plan 47-03 LAST-WINS chokepoint). Threaded through
  // to PrettyConversationRow as a new prop; Plan 47-05 consumes the value
  // as the row's subtitle content. Same key shape as useSessionIsWorking.
  useSessionAiTitle,
  // Phase 52 Plan 03 — useSessionIsDormant: hook for the dormant axis added by
  // Plan 01 (source A + source B). Used in PrettyConversationRowLive per the
  // same per-row hook pattern as useSessionIsWorking.
  // getSessionWorkingSnapshot + subscribeSessionWorkingStore: imperative snapshot
  // read via useSyncExternalStore for building the panel-level rowSessionStates
  // map consumed by matchesFilterForRow's Ready predicate.
  useSessionIsDormant,
  getSessionWorkingSnapshot,
  subscribeSessionWorkingStore,
  // Phase 53 Plan 03 — recycling axis (Plan 53-02) hook. Replaces the retired
  // client-side recycling bridge which required a mounted PrettyView pane to
  // publish the recycling state, leaving unmounted rows blind to their own
  // session's recycling state.
  useSessionIsRecycling,
} from "@/state/session-working-store";
// Phase 53 Plan 03 — the retired recycling-bridge hook import is REMOVED;
// now using useSessionIsRecycling from the working-store above
// (backend-authoritative via Plan 53-01 + Plan 53-02).
import { useSessionQueuePending } from "@/state/session-queue-pending-store";
// Phase 92 Plan 04: panel hydrate effect derives pinnedIds from the
// identities-store's `pinned: boolean` field (populated on-demand from disk
// by the backend per Plan 92-02) rather than fetching from GET /user-
// preferences. buildIdentityHostsFromFleet is the H2 lock helper shared
// with pin-toggle writes.
// Phase 104 Plan 02+03: trapped-work poller is the sole per-identity
// polling loop mounted here — the sibling bounty-count wire was retired
// in Plan 03 (bounty-counts-store deleted).
import {
  useIdentities,
  buildIdentityHostsFromFleet,
  deriveDiskPinnedIds,
  deriveDiskHiddenIds,
} from "@/state/identities-store";
import { startTrappedWorkPoller } from "@/state/trapped-work-store";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/popover";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { NewSessionDialog, type NewSessionOnCreateOpts } from "@/sidebar/NewSessionDialog";
// D-10 revised 2026-09-11: CreateRoleDialog re-imported at panel level. The
// Plan 90-06 stack-inside-RolesListModal arrangement caused a click-freeze
// (two Radix Dialog portals contending) and dropped the CRD → NewSessionDialog
// chain. Restored as swap-not-stack sibling of RolesListModal.
import { CreateRoleDialog } from "@/sidebar/CreateRoleDialog";
// Phase 80: clone flow repurposed into unified NewSessionDialog pre-seeded
// with initialHost + initialRole via the existing chain-hook mechanism
// (identical to CreateRoleDialog's onChainToCreateIdentity path). See
// handleRowClone below — the standalone clone dialog was deleted; the row's context-menu
// "create new agent under this role" item now routes through NewSessionDialog with the (bounty 260908-h78 label rewrite)
// row's host + identity.role seeded and NO task/brief prefill (A3 lock: each
// spawn describes its own why).
// Phase 92 Plan 04: getPinnedIds is retired. The panel projects the pin state
// from the identities-store's `pinned: boolean` field via deriveDiskPinnedIds
// (imported above).
// Phase 107 Plan 04: getHiddenIds is ALSO retired. The hidden slice now
// derives from the disk-sentinel model via deriveDiskHiddenIds (imported
// above) — same both-loaded-gated hydrate effect, same identityHosts, same
// hydratedRef one-shot guard.
import type { Host, HostFolder } from "@/types/ui-types";

import { PrettyConversationRow } from "./PrettyConversationRow";
import WeeklyUsageMeter from "./WeeklyUsageMeter";
// Phase 91 Plan 05 — NewConversationModal: portal-mounted sibling of
// GlobalFilesModal. Opened via the header three-dot menu "New conversation"
// item. onCreateRelayRoom prop threads the create response to AppShell.
import { NewConversationModal } from "./NewConversationModal";
import type { CreateRelayRoomResponse } from "./participant-types";
// Phase 70 Plan 04: header lockup (small icon + wordmark) now sourced from
// brandingConfig (Plan 70-03) so operator-provided assets swap in. Prior
// hardcoded inline-SVG logo import removed — no remaining consumers in this
// file after the JSX below switched to <img src={brandingConfig.iconPath}>.
import { useBrandingConfig } from "@/branding/branding-store";

// Phase 41 Plan 02: sessionStorage sentinel key for the one-shot cold-load
// search-input scroll-hide effect. Mirrors the pv-conv-active-set pattern at
// conversation-store.ts (ACTIVE_SET_STORAGE_KEY): per-tab, dies on tab close,
// silent try/catch on all reads/writes, cleared by the store's only=1 guard
// so new-window opener flows start with a fresh cold-load hide.
const SEARCH_HIDDEN_SENTINEL_KEY = "pv-conv-search-hidden-once";

// quick-260818-q73 (shape: .planning/shapes/shape-auto-deactivate-idle-convs.md):
// Per-tab idle-sweep tunables. `IDLE_DEACTIVATE_THRESHOLD_MS` = the wall-clock
// window a conv can sit un-selected in this tab before the sweep fires the
// existing `handleRowDeactivate(row)` against it. `IDLE_DEACTIVATE_SWEEP_MS` =
// how often the sweep walks the active-set looking for stale rows.
//
// Colocated by convention — this project has no shared app config module;
// other tunable UI constants live at their consumer's module top (see
// BACKPRESSURE_POLL_MS in use-pretty-view-uploads.ts, STICK_ARM_MS in
// use-auto-scroll.ts). Bumping the threshold = editing this constant.
//
// The whole feature is per-tab / in-memory only: no persistence, no server
// value, no cross-tab coordination, no URL param, no settings UI. The
// currently-selected conv is exempt from the sweep. Silent operation — no
// toast, no ARIA update, no console entry — a swept row disappears from the
// active-set exactly the way a manual click makes it disappear.
const IDLE_DEACTIVATE_THRESHOLD_MS = 300_000; // 5 min — shape default
const IDLE_DEACTIVATE_SWEEP_MS = 30_000;

// Patch #513: sentinel empty Set for the visibleInSplitTreeTabIds default.
// A single frozen module-level Set keeps the .has() call sites happy without
// re-allocating on every render, AND keeps the effect dep-array's identity
// stable when the caller omits the prop (which most tests do).
const EMPTY_VISIBLE_SET: ReadonlySet<string> = new Set();

// Patch #137: derive the (hostId:tmuxSessionName) key used by the session-
// working-store to look up the row's live isWorking state. Rows without a
// host (fleet-only pre-resolution races) resolve to null → the store hook
// short-circuits to null → dot suppressed at the row level. RDP rows carry
// targetTmuxSession=null and resolve to `${hostId}:` — a well-formed key
// whose store entry stays null (Terminal.tsx never publishes to it).
function sessionWorkingKey(row: ConversationRowShape): string | null {
  if (!row.host) return null;
  return `${row.host.id}:${row.targetTmuxSession ?? ""}`;
}

// Phase 107 Plan 04 (D-06 — affordance narrowing): gate discriminator for
// the Hide/Show button. Only fleet-synthetic identity rows (fleet:: id,
// non-relay-room, non-RDP-host-sentinel) show the button; RDP rows, relay-
// room rows, and dev-tab / harness rows lose the affordance per Alice
// 2026-09-12 "disappear" directive.
//
// Invariant: row.id.startsWith("fleet::") catches synthetic rows and excludes
// openTab-sourced rows (which carry tab-type ids). row.kind !== "relay-room"
// excludes relay-room synthetics (which lack a backing identity). rdpHostRow
// !== true excludes the per-host RDP sentinel rows that share the fleet::
// prefix but are rendered in the RDP zone with no identity backing.
function isFleetIdentityRow(row: ConversationRowShape): boolean {
  return (
    row.id.startsWith("fleet::") &&
    row.kind !== "relay-room" &&
    row.rdpHostRow !== true
  );
}

// Patch #137: micro-wrapper that reads the row's live isWorking state from
// the session-working-store. Extracted so the store subscription sits at a
// stable hook-call site (top of an instance component) rather than inside
// a .map() callback — Rules-of-Hooks compliance. Each row is keyed on row.id
// at the render sites below, so React's reconciler pairs the same hook
// order to the same row instance across renders.
//
// Phase 53 Plan 03: recycling-axis subscription now reads from the working-store
// (useSessionIsRecycling — backend-authoritative via the fleet-status poller
// per Plans 53-01 + 53-02). Previously bridged via a client-side recycling
// store (quick-260730-qbl) which required a mounted PrettyView
// pane to publish; row-spinner correctness for unmounted rows is the entire
// reason for the swap. All working-store hooks share the exact same
// `${hostId}:${tmuxSession ?? ""}` key shape via `sessionWorkingKey()` at
// line ~162.
// quick-260802-w9e added the session-queue-pending-store subscription — the
// row's ready-dot is now suppressed by a FOURTH gate `!hasQueuePending` when
// this session has an armed idle-send queue in its ComposeBox. Both working-
// store and queue-pending-store share the same key shape.
function PrettyConversationRowLive(props: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  hidden?: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  // quick-260727-gm3: forwarded verbatim to PrettyConversationRow. Only
  // wired at render sites where the row can be in the active-set (active-
  // set group, pinned group, non-RDP grouped block). RDP sentinel omits
  // it because RDP rows never emit onDeactivate at the row level.
  onDeactivate?: () => void;
  // quick-260731-tgg: forwarded to PrettyConversationRow for Hide/Show wiring.
  onToggleHide?: () => void;
  // Phase 22 (SRIC-03): forwarded to PrettyConversationRow for the Clone
  // context-menu item. Only wired at non-RDP render sites where the row has
  // an identity + host. RDP + no-identity rows omit the prop.
  onClone?: () => void;
  // quick-260810-n3a: forwarded to PrettyConversationRow for the Kill
  // context-menu item. The row's items[] builder gates on !isRdp && !identity
  // && row.targetTmuxSession so the item only appears for valid targets.
  onKill?: () => void;
  // quick-260802-pq2: onSwipeOpenChange / forceClosed removed — the row's
  // swipe machinery was retired; mobile now uses long-press → context menu.
  inActiveSet: boolean;
  sessionKey: string | null;
  // quick-260727-f9v: pass-through for the row's sublabel render mode.
  // The non-RDP grouped render site AND the pinned render site (as of
  // patch #184 / quick-260729-gsv) set this to "identityTitle"; the
  // active-set and RDP render sites omit the prop → row defaults to
  // "hostname".
  subtitleMode?: "hostname" | "identityTitle";
}) {
  const { sessionKey, inActiveSet, ...rowProps } = props;
  const isWorking = useSessionIsWorking(sessionKey);
  // Phase 53 Plan 03 — recycling axis from the backend-authoritative
  // working-store. Keyed identically to the useSessionIsWorking hook above —
  // all working-store hooks share the same `${hostId}:${tmuxSession ?? ""}`
  // shape via sessionWorkingKey() at line ~162. Returns strict boolean (never
  // null) — the `=== true` coercion at the prop site below is now redundant
  // but simplified to `isRecycling={isRecycling}` for readability.
  const isRecycling = useSessionIsRecycling(sessionKey);
  // quick-260802-w9e: queue-pending-store consumption. Same key shape as
  // both stores above. Published by ComposeBox from a useEffect on
  // `[queue, sessionKey]`; the row-level ready-dot render at
  // PrettyConversationRow.tsx:507 gates on `!hasQueuePending` as the fourth
  // predicate so a session with an armed idle-send queue does NOT paint the
  // dot (the session is spoken-for pending idle; NOT ready for input).
  const hasQueuePending = useSessionQueuePending(sessionKey);
  // Phase 47 Plan 04 — subscribes to the working-store's aiTitle axis
  // (Plan 47-03 chokepoint) for the row's (host, tmuxSession) key. Same
  // key shape as the other three working-store hooks above. Returns
  // string | null; null for null-key rows (RDP) and for known-key rows
  // the store hasn't seen an ai-title for yet — PrettyConversationRow's
  // subtitle-line fallback (Plan 47-05) handles the null case.
  const aiTitle = useSessionAiTitle(sessionKey);
  return (
    <PrettyConversationRow
      {...rowProps}
      isWorking={isWorking}
      isRecycling={isRecycling}
      hasQueuePending={hasQueuePending}
      inActiveSet={inActiveSet}
      aiTitle={aiTitle}
    />
  );
}

export function PrettyConversationsPanel({
  variant,
  onConversationSelected,
  hostTree,
  onCreateSession,
  onDetachedRowClick,
  onRdpRowClick,
  onRelayRoomRowClick,
  onDeactivateRow,
  onKillRow,
  sidebarToggleOverlaps = false,
  visibleInSplitTreeTabIds,
  onCloseSession,
  openTabIds = [],
  isAdmin = false,
  onCreateRelayRoom,
}: {
  // NEW in Wave 2: drives BOTH the header layout branching AND the child
  // rows' pin mechanism (mobile=swipe / desktop=hover-reveal). AppShell
  // (Wave 3) will resolve this from `useIsMobile()` at the mount site.
  variant: "mobile" | "desktop";
  // Fired AFTER the store's selectConversation (or the detached/RDP-branch
  // callbacks) run on a row tap. AppShell's mobile branch passes a handler
  // that transitions list→view.
  onConversationSelected?: (id: string) => void;
  // Phase 11 Plan 03: settingsRowSlot prop RETIRED (SettingsRow deleted
  // alongside AppRail per Alice's "no settings" lock).
  // Host tree fed into the NewSessionDialog's host picker. Optional so
  // tests can render the panel without wiring the picker.
  hostTree?: HostFolder | null;
  // Fired when the user completes the NewSessionDialog. The pencil-icon
  // header button is only mounted when this callback is provided (matches
  // the ConversationsPanel gate that used to be on the old inline
  // new-session button affordance).
  onCreateSession?: (opts: NewSessionOnCreateOpts) => void;
  // Detached-fleet-row click (Plan 07-01, TG-14) — same contract as
  // ConversationsPanel: fired instead of selectConversation when the row
  // is fleet-only. When omitted, fleet-only rows fall through to
  // selectConversation (which silent-no-ops at the store level).
  onDetachedRowClick?: (row: ConversationRowShape) => void;
  // RDP-host-row click (Plan 07-02, TG-15) — same contract as
  // ConversationsPanel. When omitted, RDP rows fall through to
  // selectConversation (silent-no-op at the store level).
  onRdpRowClick?: (row: ConversationRowShape) => void;
  // Phase 90 Plan 07 Task 3 — relay-room-row click. Fired when the user
  // clicks a row whose FleetSession carries `kind === "relay-room"` (Phase
  // 89 sidebar merge; Plan 01 widened FleetSession + Plan 07 propagated the
  // fields onto the ConversationRow shape). AppShell owns the tab-spawn
  // side effect: constructs a Tab with sessionKind + relayRoomId +
  // relayRoomTitle set so tabUtils's dispatcher routes the tab to the
  // shared chat surface (PrettyView with source.kind === "relay" per
  // Phase 93 Slice 4). Priority in handleRowSelect: AFTER
  // rdpHostRow + fleetOnly branches (which gate on their own row-shape
  // markers), BEFORE the default selectConversation path. When omitted,
  // relay-room rows fall through to selectConversation (matches
  // rdpHostRow/fleetOnly semantics — silent-no-op at the store level).
  onRelayRoomRowClick?: (row: ConversationRowShape) => void;
  // quick-260727-gm3: fired when Alice clicks the red-tinted X on an
  // active-set row. AppShell wires this to closeTab(row.id) so
  // the deactivate action reuses the existing tab-close plumbing verbatim
  // (including the confirm-tab-close toast branch). Required — the panel
  // composes removeFromActiveSet(row.id) + onDeactivateRow(row) at the
  // handleRowDeactivate call site; making the prop required forces every
  // caller (production AppShell + tests) to explicitly wire the tab-close
  // side. Test files that don't care pass `onDeactivateRow={() => {}}`.
  onDeactivateRow: (row: ConversationRowShape) => void;
  /**
   * quick-260810-n3a: Fired when Alice confirms the Kill dialog.
   * AppShell wires this to POST /host/:hostId/session/kill + closeTab(row.id).
   * Optional so tests can render the panel without wiring it.
   */
  onKillRow?: (row: ConversationRowShape) => void | Promise<void>;
  // Patch #142 (Fix 5): when the desktop sidebar is open, the fixed
  // top-left chevron overlaps the "Conversations" title. This prop adds
  // padding-left clearance via data-sidebar-toggle-overlaps attribute +
  // CSS rule. Mobile unaffected (mobile hides the desktop title already).
  sidebarToggleOverlaps?: boolean;
  // Patch #513: tabIds currently rendered as leaves in the AppShell
  // splitTree. Drives two things: (1) row "selected" glow visibility so
  // every session on-screen in the split view shows the selected-ring
  // treatment, not just the single selectedId (before Phase 56 only ONE
  // session could be visible at a time so selectedId alone sufficed);
  // (2) idle-sweep exemption — sessions in the tree are held in view by
  // the user, must not be silently deactivated by the 5-min sweep.
  // Optional so tests + non-AppShell renders default to the pre-Phase-56
  // single-visible behavior via an empty set.
  visibleInSplitTreeTabIds?: ReadonlySet<string>;
  // Phase 58 PV58-CONVLIST-DROP-TARGET-CLOSE — receives a VALIDATED tabId
  // (validated against openTabIds below) from a badge dropped on the panel's
  // outermost DOM element. AppShell wires this to closeTab so a badge-drop
  // closes the tab (with the confirm-tab-close toast branch preserved by
  // closeTab's existing behavior + the setSplitTree removeLeaf reconcile at
  // AppShell.tsx:1498 firing on the doCloseTab side). Optional so tests and
  // any pre-Phase-58 caller that doesn't wire it can render safely — an
  // absent handler makes the drop a silent no-op after validation.
  onCloseSession?: (tabId: string) => void;
  // Phase 58 PV58-CONVLIST-DROP-TARGET-CLOSE — validation source for the
  // drop handler (per security_config / threat T-58-02-01: "in the conv-list
  // drop handler, validate the received tabId matches an entry in the
  // current tabs[] array before calling closeTab"). A drop whose parsed
  // tabId is NOT in this list is silently dropped — defense against
  // attacker-controlled dataTransfer payloads that could inject an
  // arbitrary tabId string. Optional; defaults to [] so tests and any
  // non-AppShell caller default to "no tab is open" and every drop is a
  // silent no-op.
  openTabIds?: readonly string[];
  // Feature 09 (per-user usage meter) collapsed 2026-09-04 to an admin-only
  // visibility gate on the existing single-source WeeklyUsageMeter. Non-admin
  // users don't see anyone's usage — not their own, not the box aggregate.
  // Sourced from /users/me.is_admin (AppShell state); default false so tests
  // and any non-AppShell caller render as non-admin (meter hidden).
  isAdmin?: boolean;
  /**
   * Phase 91 Plan 05 — Fired when the user successfully creates a relay room
   * via NewConversationModal. AppShell wires this to open the relay-room tab
   * via the canonical openTab signature (mirroring onRelayRoomRowClick). The
   * modal itself calls onOpenChange(false) before this fires, so the prop is
   * called after the modal has already closed.
   */
  onCreateRelayRoom?: (result: CreateRelayRoomResponse) => void;
}) {
  const visibleInSplitTree = visibleInSplitTreeTabIds ?? EMPTY_VISIBLE_SET;
  const { t } = useTranslation();
  // Phase 70 Plan 04: header lockup below (small icon + wordmark) reads
  // from the branding store instead of importing an inline-SVG logo /
  // hardcoding the wordmark asset path.
  const brandingConfig = useBrandingConfig();
  // Phase 41 Plan 01: destructure the three-zone shape — `middle` (flat
  // recency-sorted rows) + `rdpGroup` (nullable RDP sentinel group) replace
  // the retired `grouped: HostGroup[]` field.
  const { activeSet: activeSetRows, pinned, middle, rdpGroup } = useConversations();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();
  // quick-260731-tgg: hiddenIds subscription — drives the Hidden section render
  // and per-row hidden prop threading.
  const hiddenIds = useHiddenIds();
  // Quick 260727-tb1: identity map for the bounty-count poller's getTargets
  // callback. Same hook the row uses to resolve identity — subscribing at
  // the panel level lets the poller enumerate every visible row's identity
  // without a second per-row identities-store subscription.
  //
  // quick-260912-0t4: destructure BOTH byHostKey and byKey — cosmetics
  // consumers below try the hostId-scoped composite key first (fixes
  // cross-host name collisions) and fall back to bare-name byKey when the
  // composite misses. The fallback preserves compat with test fixtures that
  // seed only byKey and with any transitional wire state where the row has
  // no hostId yet. See identities-store.ts byHostKey JSDoc for the
  // additive-vs-rename rationale.
  const { byHostKey: identitiesByHostKey, byKey: identitiesByKey, loaded: identitiesLoaded } = useIdentities();
  // Patch #137: hoisted once so all row-level activeSet.has(row.id) reads
  // hit a stable ReadonlySet reference (Set identity flips only on real
  // additions; consumers get a memoized reference across no-ops).
  const activeSet = useActiveSet();
  // quick-260727-kbw: fleet-loaded gate for the mount hydration effect
  // below (see §(d) in the block comment above the effect). Subscribes
  // via useSyncExternalStore; a false→true flip in the store bumps
  // snapshotVersion → this hook returns true on the next render → the
  // mount effect's [fleetSessionsLoaded] dep triggers the body to run.
  const fleetSessionsLoaded = useFleetSessionsLoaded();
  // quick-260727-kbw: guards against re-hydration across renders even if
  // the flag were to flip back-and-forth (defense-in-depth per bug spec —
  // Alice confirmed the store flag stays true after first flip, but a
  // ref-based dedupe costs nothing and closes the invariant regardless).
  const hydratedRef = useRef(false);

  // Patch #144 Fix (d): every selectedId change enrolls the id in the
  // active set — not just click-driven selection via handleRowSelect.
  // URL-fragment restore, keyboard nav, and any other programmatic path
  // that mutates selectedId now lights the row up with the full pretty-
  // view bubble treatment instead of the ambient flat treatment. Alice's
  // 2026-07-24 diag showed 32/32 rendered rows as ambient because
  // fragment-restore never touched the click path. addToActiveSet is
  // idempotent (early-return when id present), so double-fires from
  // click-that-also-changes-selectedId are harmless no-ops.
  useEffect(() => {
    if (selectedId) addToActiveSet(selectedId);
  }, [selectedId]);

  // Phase 15 (Wave 3): mount-fetch for server-authoritative pinnedIds.
  //   (a) First-render UX is "empty pinned tier hydrates on fetch-complete"
  //       per 15-CONTEXT.md § "No sessionStorage/localStorage fallback layer"
  //       — the panel renders immediately with an empty pinned tier and the
  //       fetch resolves in a microtask. Sibling of the L182-184 addToActiveSet
  //       effect (patch #144 Fix d), NOT a modification of it.
  //   (b) Silent try/catch on failure — state.pinnedIds stays as-is (empty on
  //       first mount, whatever's in memory on subsequent mounts). The natural
  //       retry cadence is the next pin/unpin click (which fires a PUT with
  //       the current in-memory set) OR the next remount (which fires a fresh
  //       GET). Matches 15-CONTEXT.md § Deferred: "No offline queue / durable
  //       client-side retry beyond next-sync".
  //   (c) Cancel-token guards against post-unmount hydrate for React 18
  //       StrictMode double-mount in dev + real navigate-away in production —
  //       a stale resolve from an unmounted effect early-returns before
  //       touching store state (T-15-13 + T-15-14 mitigations).
  //   (d) quick-260727-kbw fleet-loaded gate — the fetch-then-hydrate IIFE is
  //       deferred until useFleetSessionsLoaded() returns true so that the
  //       first background updateOpenTabs after hydration has a populated
  //       fleetPinKeepSet (from state.fleetSessions) and does NOT nuke
  //       freshly-hydrated fleet pins via the pruner at conversation-store.ts
  //       L540-547. hydratedRef guards defense-in-depth against a hypothetical
  //       false→true→false→true flip (Alice confirmed the flag stays true
  //       after first flip, but the ref costs nothing). Depends on
  //       [fleetSessionsLoaded] not [] so the body reruns when the flag flips.
  useEffect(() => {
    if (!fleetSessionsLoaded) return;
    // quick-260912-5q2: gate on identities-store loaded — the GET /identities
    // fanout that populates per-identity `pinned: boolean` starts on the SAME
    // fleetSessionsLoaded flip event. Without this guard, deriveDiskPinnedIds
    // reads an empty state.identities, returns [], and hydratePinnedIdsFromServer([])
    // wipes pinnedIds. Because hydratedRef prevents re-fire, every cold reload
    // loses pins. Waiting for identitiesLoaded=true ensures the fanout has landed
    // before we project — the dep-array addition below is the trigger.
    if (!identitiesLoaded) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    (async () => {
      // Phase 92 Plan 04 (D-04): pinnedConversationIds no longer fetches from
      // GET /user-preferences. Instead the panel projects the identities-store's
      // per-identity `pinned: boolean` field (populated by the backend fanout
      // per Plan 92-02) into the row id space via deriveDiskPinnedIds.
      //
      // H2 identityHosts lock: buildIdentityHostsFromFleet is the SINGLE
      // fleetSessions → identityHosts helper in the codebase (identities-
      // store.ts:74-85). It uses sessionMatchKey to derive keys — correctly
      // handles relay-room sessions (skipped: sessionMatchKey(undefined) →
      // null → identities-store L80 continues past). Do NOT replace this
      // with a local iterator that calls .toLowerCase() on sessionName —
      // that pattern is forbidden per H2 and would crash on the relay-room
      // undefined-sessionName case (see conversation-store.ts L710-731).
      const identityHosts = buildIdentityHostsFromFleet(
        getFleetSessionsSnapshot(),
      );
      const pinnedIds = deriveDiskPinnedIds(identityHosts);
      if (cancelled) return;
      hydratePinnedIdsFromServer(pinnedIds);

      // Phase 107 Plan 04 (D-03): hiddenConversationIds now also derives from
      // the disk-sentinel model — same pass, same identityHosts, same
      // hydratedRef guard. getHiddenIds (GET /user-preferences) is retired.
      // deriveDiskHiddenIds mirrors deriveDiskPinnedIds: walks identities-
      // store, filters identity.hidden === true, projects into fleet:: space.
      const hiddenIds = deriveDiskHiddenIds(identityHosts);
      if (cancelled) return;
      hydrateHiddenIdsFromServer(hiddenIds);
    })();
    return () => {
      cancelled = true;
    };
  }, [fleetSessionsLoaded, identitiesLoaded]);

  // Phase 42 UAT amendment 2026-08-17: `activeSetRowsRef` retired alongside
  // the Tier 1 active-set render tier — the store's snapshot.activeSet is now
  // always an empty array, so the ref-and-iterate in the (now-retired) bounty-
  // count poller getTargets closure was a trivially-empty no-op.
  //
  // Phase 104 Plan 03: bounty-count poller mount retired alongside the wire.
  // The trapped-work poller below is now the sole per-identity polling loop.
  const pinnedRowsRef = useRef(pinned);
  // Phase 41 Plan 01: refs for the new three-zone shape. `middleRef` replaces
  // `groupedRef`; `rdpGroupRef` is new. Both stay bumped on every render.
  const middleRef = useRef(middle);
  const rdpGroupRef = useRef(rdpGroup);
  // quick-260912-0t4: ref mirrors of BOTH maps — poller uses byHostKey with
  // byKey fallback to survive test fixtures that only seed the bare-name map.
  const identitiesByHostKeyRef = useRef(identitiesByHostKey);
  const identitiesByKeyRef = useRef(identitiesByKey);
  pinnedRowsRef.current = pinned;
  middleRef.current = middle;
  rdpGroupRef.current = rdpGroup;
  identitiesByHostKeyRef.current = identitiesByHostKey;
  identitiesByKeyRef.current = identitiesByKey;

  // Phase 104 Plan 02: trapped-work poller mount (D-08 cadence: 60_000 ms +
  // window.focus refresh). getTargets walks pinned + middle + rdpGroup,
  // resolves identities via the identitiesByHostKeyRef, dedupes by composite
  // key. Per Pitfall #5 in RESEARCH.md, this MUST cover dormant identities
  // (the whole rescue-oriented signal breaks if we gate on activeSet).
  //
  // quick-260912-0t4: identity resolution now uses the hostId-scoped
  // byHostKey map (`${hostIdNum}::${matchKey}`) so two identities sharing a
  // name across different hosts resolve to their per-host row rather than
  // collapsing on the bare-name byKey lookup.
  useEffect(() => {
    const getTargets = () => {
      const idsSeen = new Set<string>();
      const targets: Array<{ identityKey: string; hostId: number | null }> = [];
      const collect = (row: ConversationRowShape) => {
        const matchKey = sessionMatchKey(row.targetTmuxSession);
        if (!matchKey) return;
        // Phase 104 code-review finding #3: match the WS handler's coercion.
        // Server side (claude-session-server.ts:1211-1216) treats hostIdRaw > 0
        // as remote, everything else as local (null). If we let 0 or negative
        // slip through here as-is, our composite-key uses `${...}:0` but the
        // response echoes hostId=null → row lookup misses. hostIds come from
        // SQLite auto-increment starting at 1, so 0 is effectively "not a
        // valid hostId" and should route local. Client + server now agree.
        // Hoisted above the identity lookup for quick-260912-0t4 — the same
        // hostIdNum drives both the byHostKey composite and the target hostId.
        const hostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
        const hostId =
          Number.isFinite(hostIdNum) && hostIdNum > 0 ? hostIdNum : null;
        // quick-260912-0t4: try hostId-scoped composite first, fall back to
        // bare-name byKey when the composite misses (test-fixture compat +
        // pre-quick-260912-0t4 wire responses that omit hostId on the row).
        let ident = Number.isFinite(hostIdNum)
          ? identitiesByHostKeyRef.current?.get(`${hostIdNum}::${matchKey}`)
          : undefined;
        if (!ident) ident = identitiesByKeyRef.current?.get(matchKey);
        if (!ident) return;
        const composite = `${ident.identityKey}:${hostId ?? "local"}`;
        if (idsSeen.has(composite)) return;
        idsSeen.add(composite);
        targets.push({ identityKey: ident.identityKey, hostId });
      };
      for (const row of pinnedRowsRef.current) collect(row);
      for (const row of middleRef.current) collect(row);
      if (rdpGroupRef.current !== null) {
        for (const row of rdpGroupRef.current.rows) collect(row);
      }
      return targets;
    };
    const stop = startTrappedWorkPoller(getTargets, 60_000);
    return stop;
  }, []);

  // Quick 260727-tb1 identity:bounty-priority-updated piggyback comment
  // RETIRED in Phase 104 Plan 03 alongside the bounty-count wire deletion.

  // Local state: NewSessionDialog open/closed toggle (opened by pencil).
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  // D-10 revised 2026-09-11: panel-level CreateRoleDialog state RESTORED.
  // Opened when RolesListModal fires onNewRole (which also closes the list
  // per swap-not-stack). See <CreateRoleDialog> mount below.
  const [createRoleDialogOpen, setCreateRoleDialogOpen] = useState(false);
  // Phase 22 (SRIC-05): chain-into-create-identity pre-fill payload. Set when
  // CreateRoleDialog fires onChainToCreateIdentity ({role, host}); consumed by
  // the NewSessionDialog mount as its initialHost + initialRole props. Cleared
  // when NewSessionDialog closes (either via successful submit or user cancel)
  // so subsequent manual opens via the pencil don't inherit stale chain state
  // (regression gate — Test 13).
  // Phase 80: chainPrefill.description is optional so the clone entry-point
  // (handleRowClone) can seed initialHost + initialRole WITHOUT prefilling
  // the task/brief field (A3 lock: task is NOT inherited from the source
  // identity; each spawn describes its own why). CreateRoleDialog's chain
  // path continues to pass a description string.
  const [chainPrefill, setChainPrefill] = useState<{
    role: string;
    host: Host;
    description?: string;
  } | null>(null);

  // Phase 23 (GEFM-01): panel-header MoreVertical menu state.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Phase 23 (GEFM-05): GlobalFilesModal open/closed toggle (opened from menu item).
  const [globalFilesModalOpen, setGlobalFilesModalOpen] = useState(false);
  // Phase 44 SKILLED-01: SkillsEditorModal open/closed toggle (opened from menu item, sibling of GlobalFilesModal).
  const [skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false);
  // Phase 91 Plan 05 — NewConversationModal open/closed toggle (opened from
  // menu's "New conversation" item — v1 throwaway placement per shape §Philosophy).
  const [newConversationModalOpen, setNewConversationModalOpen] = useState(false);
  // Phase 90 Plan 90-06 (D-07): RolesListModal open/closed toggle. Opened by the
  // three-dots menu "Edit roles…" entry (which replaces the deleted "New role"
  // entry). See <RolesListModal> mount below.
  const [rolesListModalOpen, setRolesListModalOpen] = useState(false);
  // Phase 90 Plan 90-06 (D-04): role modal swap-not-stack coordination. Set by
  // RolesListModal's onSelectRole (row click closes list + opens role modal).
  // Also used by the nested RoleModal → RunbookEditorModal swap through
  // runbookEditorOpenState below. Cleared to null on close.
  // Phase 90 Plan 90-10 (D-08.3 lock): the earlier identity-shim prop was
  // removed from this state slot. Every read/write on the RoleModal now routes
  // through role-name-keyed helpers (Plan 90-09), so `roleName` + `hostId`
  // fully identifies every artifact the modal touches.
  const [roleModalOpenState, setRoleModalOpenState] = useState<
    | null
    | {
        roleName: string;
        roleCosmetics: import("@/api/identities-api").RoleSummary;
        hostId: number;
      }
  >(null);
  // Phase 90 Plan 90-06 (D-06): nested RunbookEditorModal swap target. RoleModal
  // opened from RolesListModal fires onOpenRunbook → set this state → RoleModal
  // closes + RunbookEditorModal opens. Mirrors PrettyView's mount at L3281 shape.
  const [panelRunbookEditorOpenState, setPanelRunbookEditorOpenState] = useState<
    | null
    | { roleName: string; runbookName: string; hostId: number }
  >(null);

  // quick-260731-tgg: collapsed by default on every mount per Alice's design lock.
  const [hiddenExpanded, setHiddenExpanded] = useState(false);

  // Phase 41 Plan 02: search filter state (Task 2 will consume this for the
  // label-only flatten-and-filter render branch). Controlled input; the clear
  // affordance × sets it back to "".
  const [searchQuery, setSearchQuery] = useState("");

  // Phase 41 Plan 02: refs for the one-shot cold-load scroll-hide effect
  // below. `scrollContainerRef` is attached to the `.pv-panel-scroll` div;
  // `searchContainerRef` is attached to the `<div className="pv-search-
  // container">` wrapper so the effect can measure its offsetHeight and set
  // scrollTop to hide the input just above the viewport. Both are
  // pre-effect-attached refs — the effect reads .current in the useEffect
  // body after mount, when both nodes have been rendered.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Phase 41 Plan 02: one-shot cold-load scroll-hide effect. Gated by a
  // sessionStorage sentinel (SEARCH_HIDDEN_SENTINEL_KEY) so the hide fires
  // exactly ONCE per browser session (StrictMode dev double-mount + any
  // future panel remount both no-op on the second run). Alice lock —
  // "we make the effort on first load of the list to hide it and then
  // don't mess with it after that." Silent try/catch guards protect against
  // sessionStorage-unavailable environments (SSR / private-mode Safari
  // quota errors); if the read throws, we fall through and still perform
  // the hide (best-effort). The `only=1` new-window opener path clears the
  // sentinel at the store's module init (conversation-store.ts) so a
  // fresh tab re-hides on first mount. Empty dep array — mount-only.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SEARCH_HIDDEN_SENTINEL_KEY) === "1") return;
    } catch {
      /* sessionStorage unavailable — fall through and still set scroll */
    }
    const scrollEl = scrollContainerRef.current;
    const searchEl = searchContainerRef.current;
    if (!scrollEl || !searchEl) return;
    scrollEl.scrollTop = searchEl.offsetHeight;
    try {
      sessionStorage.setItem(SEARCH_HIDDEN_SENTINEL_KEY, "1");
    } catch {
      /* best-effort persist */
    }
  }, []);

  // Phase 23 (GEFM-01): open the header menu anchored below the trigger button.
  const openMenu = useCallback(() => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (rect) setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpen(true);
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Phase 23 (GEFM-01): Escape + click-outside dismiss handlers for the menu.
  useEffect(() => {
    if (!menuOpen) return;
    function handleDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (menuRef.current?.contains(t) || menuButtonRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDocClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDocClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  // Phase 26 D-02 / Phase 104 Plan 03 D-11: the pinned + needs-desk bounty-
  // count filter toggles are RETIRED alongside the bounty-count wire. The
  // Ready filter (Phase 52) survives — it has an independent data source
  // (session-working-store). Local state only — NOT persisted (Alice
  // 2026-07-28: "no remembering filter state"). filterPopoverOpen controls
  // the Popover controlled binding required for Test 30 Escape-closes
  // semantics.
  const [readyOnly, setReadyOnly] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const anyFilterOn = readyOnly;

  // Phase 52 Plan 03 — per-row (isWorking, isDormant) map for the Ready predicate.
  // Built via useSyncExternalStore over the working-store snapshot so the panel
  // re-renders when the store notifies — preserves reactivity without calling
  // hooks inside the pure matchesFilterForRow function (Rules-of-Hooks compliance).
  // Keyed by sessionMatchKey (same shape as useSessionIsWorking + useSessionIsDormant).
  // Only pinned + middle rows are included; RDP rows pass through unfiltered and
  // are absent from the map (matchesFilterForRow's early-return-false on null
  // matchKey handles RDP correctly). Rows absent from the working-store snapshot
  // are omitted — matchesFilterForRow's fail-CLOSED default handles them.
  //
  // Referential stability: useSyncExternalStore requires getSnapshot to return the
  // SAME object reference when the underlying data has not changed (React's tearing
  // check calls getSnapshot twice per commit and forces a re-render if it sees
  // different references). We use a ref-based cache with a `dirty` flag. The dirty
  // flag is set in the subscribe callback (i.e., when the store notifies) and cleared
  // after each rebuild. Additionally, if the pinned/middle input arrays changed (new
  // render with different conversation data), we also rebuild. This guarantees that
  // React's two consecutive tearing-check calls to getSnapshot both return the same
  // cached Map reference, preventing the infinite re-render loop.
  const rowSessionStatesCacheRef = useRef<{
    dirty: boolean;
    pinnedRowsRef: typeof pinned;
    middleRef: typeof middle;
    result: Map<string, { isWorking: boolean; isDormant: boolean }>;
  }>({ dirty: true, pinnedRowsRef: pinned, middleRef: middle, result: new Map() });

  // Stable subscribe wrapper that marks the cache dirty on store notify, then
  // calls the useSyncExternalStore listener so React schedules a re-render.
  const subscribeRowSessionStates = useCallback(
    (onStoreChange: () => void) => {
      return subscribeSessionWorkingStore(() => {
        rowSessionStatesCacheRef.current.dirty = true;
        onStoreChange();
      });
    },
    [], // stable — subscribeSessionWorkingStore is a module-level export
  );

  const rowSessionStates = useSyncExternalStore(
    subscribeRowSessionStates,
    () => {
      const cache = rowSessionStatesCacheRef.current;
      // Return cached result when the store has not notified AND input arrays unchanged.
      if (!cache.dirty && cache.pinnedRowsRef === pinned && cache.middleRef === middle) {
        return cache.result;
      }
      const snapshot = getSessionWorkingSnapshot();
      const out = new Map<string, { isWorking: boolean; isDormant: boolean }>();
      for (const row of [...pinned, ...middle]) {
        const matchKey = sessionMatchKey(row.targetTmuxSession);
        if (!matchKey) continue;
        const record = snapshot.get(matchKey);
        if (record === undefined) continue; // absent from working-store — fail-CLOSED default in matchesFilterForRow
        out.set(matchKey, {
          isWorking: record.isWorking === true,
          isDormant: record.dormant === true,
        });
      }
      rowSessionStatesCacheRef.current = { dirty: false, pinnedRowsRef: pinned, middleRef: middle, result: out };
      return out;
    },
    () => new Map<string, { isWorking: boolean; isDormant: boolean }>(),
  );

  // Phase 26 D-02 / Phase 52 Plan 03 / Phase 104 Plan 03 D-11:
  // Ready-predicate-only filter helper. "Is this row Ready?"
  //   matchesFilterForRow(row) = !readyOnly || (rowState defined && !isWorking && !isDormant)
  // Rows with no resolvable identity → false (filtered out when the toggle is
  // on). Wrapped in useMemo so the helper identity is stable across renders
  // that don't change identitiesByHostKey, readyOnly, or rowSessionStates.
  //
  // Phase 104 Plan 03: the pinned + needs-desk filter branches (and their
  // store dependencies) were retired alongside their data source. Only the
  // Ready predicate remains.
  //
  // quick-260912-0t4: identity resolution uses the hostId-scoped byHostKey
  // composite key so cross-host name collisions don't collapse on lookup.
  const matchesFilterForRow = useMemo(() => {
    return (row: ConversationRowShape): boolean => {
      const matchKey = sessionMatchKey(row.targetTmuxSession);
      if (!matchKey) return false;
      const hostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
      // quick-260912-0t4: byHostKey first, byKey fallback for compat.
      let ident = Number.isFinite(hostIdNum)
        ? identitiesByHostKey?.get(`${hostIdNum}::${matchKey}`)
        : undefined;
      if (!ident) ident = identitiesByKey?.get(matchKey);
      if (!ident) return false;
      // Phase 52 Plan 03 — Ready predicate: !isWorking && !isDormant per CONTEXT.md § decisions § Filter semantic.
      // Row's session state is looked up from the pre-computed rowSessionStates map keyed by matchKey.
      // FAIL-CLOSED default (plan-checker W-3 fix, 2026-08-20): a row absent from rowSessionStates
      // (no working-store publish for this key) is treated as NOT ready. Plan 01's source B publishes
      // dormant frames for identities that have no live PID, so an undefined rowState now genuinely
      // represents "no wire signal at all" — which the Ready filter conservatively treats as
      // "not confirmed ready" and hides.
      const rowState = rowSessionStates.get(matchKey);
      const readyOk = !readyOnly || (rowState !== undefined && !rowState.isWorking && !rowState.isDormant);
      return readyOk;
    };
  }, [identitiesByHostKey, identitiesByKey, readyOnly, rowSessionStates]);

  // Phase 26 D-02 (as amended by Phase 41 Plan 01, Phase 42 UAT amendment
  // 2026-08-17): apply the AND-intersect filter to each render collection when
  // EITHER toggle is on.
  //   - `displayedPinned` = pinned tier, filtered when a toggle is on.
  //   - `displayedMiddle` = FLAT middle zone, filtered when a toggle is on
  //     (was: `displayedGrouped: HostGroup[]` with per-group empty-drop; now
  //     just a flat ConversationRow[] filter). Phase 41 retired per-host
  //     bucketing in the middle.
  //   - `displayedRdpGroup` = the RDP sentinel group. RDP is NOT filtered by
  //     the bounty-count toggles today (inherits the pre-Phase-41 policy:
  //     RDP rows never match the filter predicate anyway — no identity, no
  //     bounty counts). Pass through verbatim. When `rdpGroup === null` the
  //     downstream renderer skips the entire section (Alice lock #7).
  //   - The former `displayedActiveSetRows` (D-06 exemption) is retired
  //     alongside the Tier 1 activeSet render tier; `activeSetRows` in the
  //     destructure is now always an empty array from the store snapshot.
  const displayedPinned = anyFilterOn
    ? pinned.filter(matchesFilterForRow)
    : pinned;
  const displayedMiddle = anyFilterOn
    ? middle.filter(matchesFilterForRow)
    : middle;
  const displayedRdpGroup = rdpGroup;

  // quick-260731-tgg: resolve hidden rows for the Hidden section. We look up
  // rows in the PRE-filter source (activeSetRows ∪ pinned ∪ grouped before the
  // hiddenIds filter in the store removed them) by constructing the full union
  // from the raw useConversations() output — but computeSnapshot() already
  // stripped them. We work around this by holding a separate pre-filter source
  // derived from the store's raw snapshot BEFORE the hidden-filter pass. Since
  // the store filters hidden ids out of the tiers, hidden rows won't appear in
  // activeSetRows/pinned/grouped at all. Instead, we resolve them from the
  // hiddenIds set itself by finding matches in the currently-open conversations.
  // The simplest correct approach: iterate hiddenIds and resolve each to a row
  // object from ALL known rows (pre-filter union). Because the store already
  // filtered them, we need a different source. We'll compute this from the
  // store's own data that IS visible: the full union includes rows from all
  // tiers, but hidden rows have been removed. We fetch hidden rows by iterating
  // hiddenIds and checking openTabs/fleet data indirectly via what's available.
  //
  // In practice, the simplest approach that matches the plan spec: pre-filter
  // union of activeSetRows ∪ pinned ∪ grouped from useConversations() BEFORE
  // hiddenIds filter. Since computeSnapshot() already filters hidden ids, we
  // need an unfiltered source. We therefore read from the panel's available
  // data: the three tiers post-store-filter (which excludes hidden rows) do NOT
  // include hidden rows. We need to reconstruct hidden rows. The plan says to
  // resolve against "PRE-filter tiers" — but since the store filters them, we
  // cannot get them from useConversations(). We solve this pragmatically:
  // build hiddenRows from hiddenIds by constructing minimal ConversationRow
  // stubs from what the store makes available. The store's hiddenIds are string
  // ids; we don't have direct access to the raw rows once filtered. We therefore
  // keep a ref that accumulates rows seen in any tier across renders (a row that
  // becomes hidden stops appearing in tiers but we remember it).
  //
  // Simpler correct solution: The panel exposes hiddenIds from the store.
  // For the Hidden section we need row objects. Since the store filters hidden
  // rows from all tiers, the panel cannot reconstruct the full row shape without
  // additional data. The plan's action block says: "resolve against the
  // pre-filter tiers (i.e. resolve to the row object BEFORE the hiddenIds
  // filter is applied)" — meaning we need the store to provide pre-filter data.
  // However, looking at the store design, computeSnapshot IS the post-filter
  // output. The plan approach requires us to have the pre-filter rows available.
  //
  // Correct implementation per plan §(3) action point: useMemo over
  // [...activeSetRows, ...pinned, ...grouped.flatMap(g=>g.rows)] — BUT these
  // are already post-filter (hidden rows removed). The plan's intent is that
  // the panel renders hidden rows in the Hidden section using row objects from
  // before filtering. Since the store doesn't expose pre-filter tiers, we
  // use a ref-based accumulator that captures rows as they pass through the
  // visible tiers — rows that transition from visible to hidden are still in
  // the ref. On fresh mount they hydrate from the server via hydrateHiddenIds.
  // For rows that were ALWAYS hidden (server-persisted), we won't have row
  // objects immediately. This is an acceptable trade-off per the plan's note
  // that "resolve to the row object BEFORE the hiddenIds filter is applied"
  // — those rows appeared in the tiers on initial render before hydration.
  //
  // For now, use the ref-accumulator approach: accumulate all rows ever seen
  // in any tier, key by id. Hidden section resolves from this accumulator.
  // This is the idiomatic approach for this store architecture.
  //
  // NOTE: This ref is update-on-every-render (tiny cost; no closure issues).
  const knownRowsRef = useRef(new Map<string, ConversationRowShape>());
  // Accumulate rows from all currently-visible tiers on every render.
  // Phase 41 Plan 01: walk `middle` (flat) + `rdpGroup.rows` (nullable) —
  // replaces the retired grouped[].forEach walk.
  for (const r of activeSetRows) knownRowsRef.current.set(r.id, r);
  for (const r of pinned) knownRowsRef.current.set(r.id, r);
  for (const r of middle) knownRowsRef.current.set(r.id, r);
  if (rdpGroup !== null) {
    for (const r of rdpGroup.rows) knownRowsRef.current.set(r.id, r);
  }

  const hiddenRows = useMemo(() => {
    const out: ConversationRowShape[] = [];
    const seen = new Set<string>();
    for (const id of hiddenIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = knownRowsRef.current.get(id);
      if (row) out.push(row);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenIds, activeSetRows, pinned, middle, rdpGroup]);

  // Phase 41 Plan 02 (Alice 2026-08-14): label-only filter predicate.
  //
  // Contract per 41-CONTEXT.md § Filter behavior:
  //   - Extract the row's visible text: primary label (identity.displayName
  //     when identity resolves for the row's targetTmuxSession, else
  //     row.label) + sublabel (identity.title when identity resolves, else
  //     the row's hostname). Reproduces PrettyConversationRow.tsx:983-1005
  //     resolution so what the user sees IS what the filter searches.
  //   - Normalizes both sides via .toLowerCase() and uses .includes() —
  //     substring match, case-insensitive. No regex interpretation (T-41-02-05
  //     mitigation), no HTML interpretation.
  //   - Empty query is a defensive no-op that returns true.
  //
  // NOTE: matchesSearch is called from the searchMatches useMemo below when
  // searchQuery.trim() !== "". Passing identitiesByHostKey through so the
  // predicate stays pure.
  //
  // quick-260912-0t4: identity resolution uses the hostId-scoped byHostKey
  // composite key so search hits pull the RIGHT displayName/title for the
  // row's host (cross-host name collisions previously read the wrong row's
  // metadata into the sublabel).
  const matchesSearch = useCallback(
    (row: ConversationRowShape, query: string): boolean => {
      if (query === "") return true;
      const q = query.toLowerCase();
      // Reproduce PrettyConversationRow.tsx:1003-1024 label + sublabel
      // resolution (the non-RDP render sites all pass subtitleMode="identity
      // Title" — so identity resolution wins when available; RDP rows use
      // subtitleMode="hostname" so hostname is the sublabel).
      const matchKey = sessionMatchKey(row.targetTmuxSession);
      const hostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
      // quick-260912-0t4: byHostKey first, byKey fallback for compat.
      let identity =
        matchKey && Number.isFinite(hostIdNum)
          ? identitiesByHostKey?.get(`${hostIdNum}::${matchKey}`)
          : undefined;
      if (!identity && matchKey) identity = identitiesByKey?.get(matchKey);
      const isRdp = row.rdpHostRow === true;

      let primary: string;
      let sublabel: string;
      if (!isRdp && identity) {
        primary = String(identity.displayName ?? row.label ?? "");
        sublabel = String(identity.title ?? identity.displayName ?? "");
      } else {
        // RDP rows OR non-RDP rows without a resolved identity: fall through
        // to the "hostname" mode — primary is row.label, sublabel is the
        // host's name (matches the row's Server-icon + hostname sublabel).
        primary = String(row.label ?? "");
        sublabel = String(row.host?.name ?? "");
      }

      return primary.toLowerCase().includes(q) || sublabel.toLowerCase().includes(q);
    },
    [identitiesByHostKey, identitiesByKey],
  );

  // Phase 41 Plan 02: flat match list when the search query is non-empty.
  // `null` signals "no filter active → render three-zone view". Non-null
  // signals "filter active → render this flat list of matches with NO zone
  // chrome (no divider chips)".
  //
  // Alice locks encoded here:
  //   - Union of activeSetRows + pinned + middle + rdpGroup.rows. HIDDEN
  //     ROWS ARE EXCLUDED per Alice lock #3 (hidden section is not in the
  //     union).
  //   - Deduplicate by row.id — activeSet + pinned can overlap in principle.
  //   - Case-insensitive substring match against primary + sublabel via
  //     matchesSearch (label-only; no message-body content search).
  //   - Uses `searchQuery.trim()` to treat whitespace-only queries as empty
  //     (defensive; no jitter on typing then deleting).
  const trimmedSearchQuery = searchQuery.trim();
  const searchMatches = useMemo<ConversationRowShape[] | null>(() => {
    if (trimmedSearchQuery === "") return null;
    const seen = new Set<string>();
    const out: ConversationRowShape[] = [];
    const pushIfMatches = (row: ConversationRowShape) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      if (matchesSearch(row, trimmedSearchQuery)) out.push(row);
    };
    for (const r of activeSetRows) pushIfMatches(r);
    for (const r of pinned) pushIfMatches(r);
    for (const r of middle) pushIfMatches(r);
    if (rdpGroup !== null) {
      for (const r of rdpGroup.rows) pushIfMatches(r);
    }
    // NOTE: hiddenRows deliberately NOT included (Alice lock #3 —
    // hidden rows do NOT appear in filter matches).
    return out;
  }, [trimmedSearchQuery, activeSetRows, pinned, middle, rdpGroup, matchesSearch]);

  // quick-260802-pq2: swipe-coordination state (currentlySwipedId +
  // handleSwipeOpenChange + forceClosedFor) removed alongside the row's
  // swipe state machine. Mobile now uses long-press → PrettyConversation
  // ContextMenu; there is no row open-state to coordinate.

  const showPencilButton = typeof onCreateSession === "function";
  const isMobileVariant = variant === "mobile";

  // Row-click dispatcher — VERBATIM behavior from ConversationsPanel.tsx
  // lines 153-183 MINUS the [F3-diag] diagnostic spew (patch #111e retired
  // in Wave 4). Priority order:
  //   1. `row.rdpHostRow` → onRdpRowClick (openTab host, "rdp")
  //   2. `row.fleetOnly`  → onDetachedRowClick (openTab host, "terminal", …)
  //   3. default          → selectConversation(row.id)
  // All branches fire onConversationSelected so the mobile list→view
  // transition (Plan 06-03) fires identically for every click.
  //
  // quick-260802-pq2: prior implementation reset currentlySwipedId here as
  // belt-and-suspenders for the swipe-open race; both the state and the
  // race are gone with the swipe machinery.
  const handleRowSelect = (row: ConversationRowShape) => {
    // Alice 2026-09-03 [inverts quick-260731-tgg]: hidden means hidden.
    // Clicking a hidden row opens the session WITHOUT mutating hiddenIds.
    // Two reasons: (1) semantic — "hidden" is a user-controlled bucket, only
    // the explicit Unhide context-menu action (handleToggleHide) should change
    // it; (2) race — the prior synchronous unhide re-rendered the Hidden
    // section, shifted the row's DOM out from under the cursor mid-click, and
    // sometimes swallowed the routing branch entirely so the session never
    // opened. Note: handleTogglePin (line ~1188) still unhides-before-pin
    // because pinning is promotion — that path is intentional and untouched.
    addToActiveSet(row.id);
    if (row.rdpHostRow && onRdpRowClick) {
      onRdpRowClick(row);
      onConversationSelected?.(row.id);
      return;
    }
    if (row.fleetOnly && onDetachedRowClick) {
      onDetachedRowClick(row);
      onConversationSelected?.(row.id);
      return;
    }
    // Phase 90 Plan 07 Task 3 (BLOCKER #3 fix) — relay-room branch. Placed
    // AFTER rdpHostRow + fleetOnly to preserve their existing priority (a
    // row is at most one of these types — a relay-room row is neither
    // rdpHostRow nor fleetOnly). Discipline mirrors the two branches above:
    // early return + fire onConversationSelected alongside. Defensive path
    // on missing roomId: log-and-fall-through to the default
    // selectConversation path (backend shouldn't emit this state per Plan
    // 04 wire discipline; belt-and-suspenders).
    if (row.kind === "relay-room" && onRelayRoomRowClick) {
      if (!row.roomId) {
        // eslint-disable-next-line no-console
        console.warn("relay-room row missing roomId", { rowId: row.id });
        // Fall through to default path.
      } else {
        onRelayRoomRowClick(row);
        onConversationSelected?.(row.id);
        return;
      }
    }
    selectConversation(row.id);
    onConversationSelected?.(row.id);
  };

  // quick-260727-gm3: pure reverse of handleRowSelect — removes the id from
  // the activeSet (row visually recedes to ambient) AND fires
  // onDeactivateRow so AppShell can closeTab(row.id). Deliberately paired at
  // the panel level (not the row) so the row stays a dumb consumer of a
  // single callback and the panel owns the "store mutation + tab close"
  // composition — same architectural shape as handleRowSelect +
  // selectConversation + onConversationSelected.
  //
  // Order matters: removeFromActiveSet FIRST so the store update lands
  // before closeTab kicks off any UI transition. Both operations are
  // synchronous store mutations at the boundary; the flip order is a
  // defense-in-depth choice, not a correctness requirement.
  //
  // quick-260727-s8g: purge BOTH id shapes. Rationale — activeSet may hold
  // BOTH `row.id` (openTab id shape, e.g. `tab-xxx`) AND the fleet-synthetic
  // id shape (`fleet::HOSTID::SESSIONNAME`) when the row was reached via
  // ambient-fleet-row tap: handleRowSelect adds the fleet id, then AppShell
  // opens a tab whose different id shape gets added by the selectedId
  // useEffect. If we only purge `row.id`, the next computeSnapshot un-
  // suppresses the fleet-synthetic entry (openTab is gone) and Tier 1 re-
  // promotes the row with `.active-set` glow because activeSet still has the
  // fleet id. Same class of id-shape-mismatch bug as the queued #149
  // followup-1 pin-nuke (scoped to pinnedIds), separately queued. The
  // guard skips the fleet-id purge for rows without host or
  // targetTmuxSession so we never construct a bogus `fleet::null::` string.
  // removeFromActiveSet is idempotent so calling it with an id that's not
  // present is a safe no-op.
  const handleRowDeactivate = (row: ConversationRowShape) => {
    removeFromActiveSet(row.id);
    if (row.host && row.targetTmuxSession) {
      removeFromActiveSet(fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession));
    }
    onDeactivateRow(row);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // quick-260818-q73: per-tab idle sweep
  // ────────────────────────────────────────────────────────────────────────────
  // Shape: .planning/shapes/shape-auto-deactivate-idle-convs.md
  //
  // Policy: any active-set row whose "last moment it stopped being the
  // selected conv" is older than IDLE_DEACTIVATE_THRESHOLD_MS is fed to the
  // existing `handleRowDeactivate(row)` above — the SAME function the manual
  // red-X click passes to `onDeactivate` on each row. Zero new mechanism,
  // zero visible signal, zero backend touch.
  //
  // Data:
  //   - `lastUnfocusedAtRef` — per-tab, in-memory ONLY. Never persisted,
  //     never sent to the server, never shared with other tabs/devices. Dies
  //     on tab close. Values are `performance.now()` millisecond timestamps.
  //     The currently-selected conv's clock is NOT running — it lives outside
  //     this map (see selectedId tracker below).
  //   - `previousSelectedIdRef` — one-slot memory of the last selectedId so
  //     the tracker knows which id just became un-selected on a change.
  //   - `activeSetRef` / `selectedIdRef` — mirror the two hook-subscribed
  //     values so the mount-only sweep reads the LATEST snapshot every tick
  //     instead of a stale closure over first-render values.
  //   - `handleRowDeactivateRef` — mirror of `handleRowDeactivate` so the
  //     mount-only sweep calls the current function reference rather than
  //     the first-render capture. handleRowDeactivate is defined inline in
  //     the component body (no useCallback), so its identity churns on every
  //     render; the ref keeps the sweep pointed at the fresh copy.
  const lastUnfocusedAtRef = useRef<Map<string, number>>(new Map());
  const previousSelectedIdRef = useRef<string | null>(null);
  const activeSetRef = useRef(activeSet);
  const selectedIdRef = useRef(selectedId);
  const handleRowDeactivateRef = useRef(handleRowDeactivate);
  // Patch #513: idle-sweep exemption for sessions currently rendered in
  // the AppShell splitTree. Alice's user-focus signal is "I have this
  // pane on screen right now" — deactivating a session she can see is
  // the sweep firing against a user-attention row and breaks the
  // deactivate-when-idle contract. Ref-mirror pattern matches the
  // existing activeSet + selectedId refs so the mount-only sweep reads
  // the latest snapshot rather than a first-render capture.
  const visibleInSplitTreeRef = useRef<ReadonlySet<string>>(visibleInSplitTree);
  // Track the effective visible set (selectedId ∪ splitTree tabIds) so
  // transitions can correctly stamp/unstamp lastUnfocusedAtRef entries.
  // Without this, dragging a session OUT of the tree would keep whatever
  // stale stamp existed from when it was previously un-selected — and if
  // that stamp is older than 5 min, the very next sweep would deactivate
  // a session Alice was looking at moments ago.
  const previousVisibleSetRef = useRef<ReadonlySet<string>>(EMPTY_VISIBLE_SET);

  // Ref-sync: keep the sweep's view of activeSet + selectedId +
  // handleRowDeactivate in sync with the current render values. Single-line
  // ref writes — no work in the effect body beyond `.current = value`.
  useEffect(() => {
    activeSetRef.current = activeSet;
  }, [activeSet]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    handleRowDeactivateRef.current = handleRowDeactivate;
  }, [handleRowDeactivate]);
  useEffect(() => {
    visibleInSplitTreeRef.current = visibleInSplitTree;
  }, [visibleInSplitTree]);

  // Patch #513: unified visible-set tracker. The pre-Phase-56 tracker
  // fired only on selectedId change; that was sufficient when exactly
  // ONE session could be on-screen at a time. Now with the split tree,
  // "visible" means: selectedId OR any tabId in the tree. On every
  // change to that set:
  //   1. For each id that just LEFT the set (was visible last render,
  //      not visible now) → stamp with `now` so the sweep counts from
  //      the moment the session actually left the user's view.
  //   2. For each id that IS visible now → delete its stamp so the
  //      sweep never fires against it (idempotent for entries with no
  //      prior stamp).
  //   3. Update previousSelectedIdRef + previousVisibleSetRef for the
  //      next transition.
  useEffect(() => {
    const now = performance.now();
    const nextVisible = new Set<string>(visibleInSplitTree);
    if (selectedId !== null) nextVisible.add(selectedId);
    const prevVisible = previousVisibleSetRef.current;
    for (const id of prevVisible) {
      if (!nextVisible.has(id)) {
        lastUnfocusedAtRef.current.set(id, now);
      }
    }
    for (const id of nextVisible) {
      lastUnfocusedAtRef.current.delete(id);
    }
    previousVisibleSetRef.current = nextVisible;
    previousSelectedIdRef.current = selectedId;
  }, [selectedId, visibleInSplitTree]);

  // Mount-only sweep: fire every IDLE_DEACTIVATE_SWEEP_MS. Body reads all
  // dependencies from refs so no stale-closure hazard exists. For each id in
  // the current active-set that (a) is NOT the currently-selected id, (b)
  // HAS a stamp in the map, and (c) whose stamp is older than the threshold,
  // resolve the row via the existing `knownRowsRef` and call
  // `handleRowDeactivate(row)` — verbatim, no wrapper, no re-implementation.
  // Silent: no console log, no toast, no ARIA update.
  useEffect(() => {
    const sweep = () => {
      const now = performance.now();
      const currentSelected = selectedIdRef.current;
      const currentActive = activeSetRef.current;
      const currentVisibleInSplitTree = visibleInSplitTreeRef.current;
      const handleRowDeactivate = handleRowDeactivateRef.current;
      for (const id of currentActive) {
        if (id === currentSelected) continue; // HARD INVARIANT: never sweep the selected conv
        // Patch #513: HARD INVARIANT — never sweep a session currently
        // rendered as a leaf in the AppShell splitTree. Deactivating a
        // session Alice can see on-screen violates the sweep's
        // user-focus contract.
        if (currentVisibleInSplitTree.has(id)) continue;
        const stamp = lastUnfocusedAtRef.current.get(id);
        if (stamp === undefined) continue; // never focused-then-unfocused in this tab
        if (now - stamp < IDLE_DEACTIVATE_THRESHOLD_MS) continue;
        const row = knownRowsRef.current.get(id);
        if (!row) continue; // row unknown to the panel — silently skip
        handleRowDeactivate(row);
        // Delete after firing so a still-active-set entry (e.g. reactivate
        // path re-adds later) doesn't re-fire on the very next tick against
        // the same stale stamp.
        lastUnfocusedAtRef.current.delete(id);
      }
    };
    const handle = setInterval(sweep, IDLE_DEACTIVATE_SWEEP_MS);
    return () => clearInterval(handle);
  }, []);
  // ────────────────────────────────────────────────────────────────────────────
  // end quick-260818-q73 idle sweep
  // ────────────────────────────────────────────────────────────────────────────

  // quick-260810-n3a: panel-level Kill handler. Shows a native confirm dialog
  // naming the tmux session + host before forwarding to onKillRow. The dialog
  // is the user-facing mitigation (T-n3a-06) — user reads session name + host
  // before clicking OK. Only fires onKillRow when confirm=true.
  const handleRowKill = (row: ConversationRowShape) => {
    const tmuxSession = row.targetTmuxSession;
    const hostName = row.host?.name ?? row.host?.ip ?? "the host";
    if (!tmuxSession) return; // defense-in-depth; row-side gate should have prevented
    const ok = window.confirm(
      `Kill tmux session "${tmuxSession}" on ${hostName}? This cannot be undone.`,
    );
    if (!ok) return;
    onKillRow?.(row);
  };

  // quick-260731-tgg: panel-level togglePin with mutual exclusion — unhide before pin.
  // quick-260807 followup to e4s: takes the whole row and handles BOTH pin
  // id shapes symmetrically (openTab id + fleet-synthetic shadow id). e4s
  // fixed only the READ side (isRowPinned) — this closes the WRITE side:
  // when the pin was persisted under the fleet-synthetic shape but the row
  // renders in the active-set/grouped tier under its openTab id, a click on
  // Unpin used to hit togglePinConversation(openTabId), find openTabId NOT
  // in pinnedIds, and treat it as a PIN (adding a second stale entry) —
  // leaving the fleet-shadow pin in place forever. Now: if EITHER shape is
  // pinned, remove BOTH; if NEITHER, pin the canonical (fleet-synthetic
  // when host+targetTmuxSession are available so the pin survives openTab
  // id churn across URL-restores).
  const handleTogglePin = (row: ConversationRowShape) => {
    if (hiddenIds.has(row.id)) unhideConversation(row.id);
    const shadowFleetId =
      row.host && row.targetTmuxSession
        ? fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession)
        : null;
    const openTabPinned = pinnedIds.has(row.id);
    const shadowPinned = shadowFleetId !== null && pinnedIds.has(shadowFleetId);
    if (openTabPinned || shadowPinned) {
      if (openTabPinned) unpinConversation(row.id);
      if (shadowPinned && shadowFleetId !== null) unpinConversation(shadowFleetId);
    } else {
      pinConversation(shadowFleetId ?? row.id);
    }
  };

  // quick-260731-tgg: panel-level hide/show handler.
  // - If already hidden (Show button): unhide only.
  // - If in active-set: deactivate FIRST (closes tab), then hide.
  // - Otherwise: hide directly.
  const handleToggleHide = (row: ConversationRowShape) => {
    if (hiddenIds.has(row.id)) {
      unhideConversation(row.id);
      return;
    }
    if (activeSet.has(row.id)) {
      handleRowDeactivate(row);
    }
    hideConversation(row.id);
  };

  // Phase 80 (Landmine 11 — reuse, don't build new): panel-level clone
  // handler. "Clone" was rebranded to "create new agent under this role" (originally 'Clone', then 'Spawn under this role' until bounty 260908-h78) (see
  // PrettyConversationRow.tsx context-menu label). It is no longer a
  // separate flow with its own dialog — it now opens the unified
  // NewSessionDialog with initialHost + initialRole seeded via the SAME
  // chain-hook mechanism that CreateRoleDialog uses (chainPrefill state
  // → NewSessionDialog initialHost + initialRole props).
  //
  // A3 lock: initialBrief is intentionally omitted so the task/brief field
  // starts empty — the cosmetics come from the role, so nothing is being
  // carried from the source identity; each spawn describes its own why.
  //
  // Guards (same as the prior standalone-clone-dialog impl): matchKey → identity
  // → identity.role → row.host → parseable hostId. If any fails, no-op —
  // the row-level items[] gate (see PrettyConversationRow.tsx items
  // builder) already prevents the menu item from surfacing in that case,
  // so this is belt-and-suspenders.
  const handleRowClone = (row: ConversationRowShape) => {
    const matchKey = sessionMatchKey(row.targetTmuxSession);
    if (!matchKey) return;
    // quick-260912-0t4: resolve identity via hostId-scoped byHostKey so a
    // clone action fired from row X on host A doesn't pick up identity Y on
    // host B (which shares the identityKey name). row.host is guarded below
    // for the setChainPrefill path — hoist the hostIdNum computation ABOVE
    // the identity lookup so both use the same value. Falls back to bare-name
    // byKey when the composite misses (test-fixture compat).
    if (!row.host) return;
    const hostIdNum = parseInt(row.host.id, 10);
    if (!Number.isFinite(hostIdNum)) return;
    let identity = identitiesByHostKey?.get(`${hostIdNum}::${matchKey}`);
    if (!identity) identity = identitiesByKey?.get(matchKey);
    if (!identity) return;
    if (!identity.role) return;
    // Seed the chain-hook state with initialHost + initialRole ONLY.
    // description is omitted → NewSessionDialog receives initialBrief=null
    // (see mount site below) → brief field stays empty.
    setChainPrefill({
      role: identity.role,
      host: row.host,
    });
    setNewSessionDialogOpen(true);
  };

  // quick-260807-e4s (patch #149 followup-1 pin-nuke): mirror the store's
  // Tier 2 shadow-fleet-id pinned check (conversation-store.ts:493-499) so
  // active-set + grouped rows render "Unpin" when the pin was persisted
  // under the fleet-synthetic id shape.
  const isRowPinned = (row: ConversationRowShape): boolean => {
    const shadowFleetId =
      row.host && row.targetTmuxSession
        ? fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession)
        : null;
    return (
      pinnedIds.has(row.id) ||
      (shadowFleetId !== null && pinnedIds.has(shadowFleetId))
    );
  };

  // quick-260802-pq2: handleSwipeOpenChange + forceClosedFor removed —
  // the row's swipe machinery was retired; there is no per-row open-state
  // to coordinate. Mobile actions flow through the long-press context menu.

  // Precompute a stable no-op togglePin for RDP rows (belt-and-suspenders —
  // Wave 1's contract already suppresses swipe/pin intrinsically for RDP,
  // but hand a no-op arrow anyway so nothing fires if the invariant ever
  // regresses).
  const rdpNoopTogglePin = () => {};

  // ─── Phase 58 Plan 02: conv-list panel-level drop target for badge close ─
  // Wires the outermost <div data-testid="pretty-conversations-panel"> as a
  // drop target that closes the dragged tab when a badge (identified by the
  // Phase 58 Plan 01 dual-MIME dragstart payload) is released on it.
  //
  // Wire contract (matches IdentityBadge.tsx Phase 58 Plan 01 dragstart):
  //   dataTransfer["application/x-skynet-badge"] = JSON.stringify({tabId})
  //     — the discriminator MIME. A drop without this key is ignored
  //       (row-drags, OS file drags, etc. fall through — T-58-02-06).
  //   dataTransfer["text/plain"] = tabId
  //     — routes to Phase 56 Pane onDrop's rearrange path when the drop
  //       lands on a Pane instead. NOT read here (belt-and-suspenders —
  //       requiring the explicit badge MIME as the discriminator; see
  //       Phase 58 Plan 02 Test C).
  //
  // Security / threat model (per plan's <threat_model> block):
  //   T-58-02-01 (Spoofing): parsed tabId is validated against openTabIds
  //     BEFORE calling onCloseSession. An unknown tabId is silently dropped.
  //   T-58-02-02 (Tampering): JSON.parse wrapped in try/catch — malformed
  //     payload is silently dropped without throwing.
  //   T-58-02-04 (Repudiation): single explicit-field structured log emits
  //     on the close path — no JSON.stringify(event).
  //   T-58-02-06 (Tampering): dragover type-gate on application/x-skynet-badge
  //     means non-badge drops (e.g. OS file drags) never call preventDefault
  //     during dragover — the browser's default not-a-drop-target semantic
  //     is preserved.
  // ─── Phase 59 Plan 01 Gap 2: coral tint state for badge drop-to-close ───
  // Additive on the existing Phase 58 Plan 02 handlers. Set true INSIDE the
  // badge type-gate so row drags + OS file drags NEVER trigger tint. Cleared
  // on drop / bounding-rect-guarded dragleave / window-level dragend
  // (Escape-cancel). Ref-based zone-change gate for the structured log
  // mirrors SplitView.tsx:223 prevZoneRef — synchronous ref-write is atomic
  // with log emission, avoids React 18 strict-mode double-fire. `null`
  // initial (not `false`) so the first false→false transition never emits.
  const [isBadgeDragOver, setIsBadgeDragOver] = useState(false);
  const prevConvlistVisibleRef = useRef<boolean | null>(null);

  // Phase 59 Gap 2 — window-level dragend listener for Escape-cancel path.
  // Escape cancels a drag WITHOUT moving the cursor, so no dragleave fires;
  // dragend on the drag source (IdentityBadge per Phase 58 Plan 01) is the
  // only reliable signal. Window-level attach — dragend fires on the SOURCE
  // element, not on this panel. Empty deps: ref-write pattern doesn't
  // capture any changing state (unlike Task 1's splitTree closure).
  useEffect(() => {
    const onDragEnd = () => {
      setIsBadgeDragOver(false);
      if (prevConvlistVisibleRef.current !== false) {
        // eslint-disable-next-line no-console
        console.info(`[convlist-drop-preview] visible=false`);
        prevConvlistVisibleRef.current = false;
      }
    };
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, []);

  const handlePanelDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Only badge drags get captured. Row drags + OS file drags fall through
    // without preventDefault so the browser doesn't treat the panel as a
    // drop target for them. NO log here — dragover fires constantly during
    // a drag hover; only dragstart + drop should log per fleet directive.
    const types = e.dataTransfer?.types;
    if (types && Array.from(types).indexOf("application/x-skynet-badge") !== -1) {
      e.preventDefault();
      // Phase 59 Gap 2 tint state — INSIDE the type-gate so non-badge drags
      // (row drags, OS file drags) NEVER trigger tint (per CONTEXT.md
      // §Edge case #3). Zone-change-gated log for audit trail.
      setIsBadgeDragOver(true);
      if (prevConvlistVisibleRef.current !== true) {
        // eslint-disable-next-line no-console
        console.info(`[convlist-drop-preview] visible=true`);
        prevConvlistVisibleRef.current = true;
      }
    }
  };
  const handlePanelDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Phase 59 Gap 2 — type-gate FIRST (mirror SplitView.tsx:292 pattern +
    // handlePanelDragOver's :1300 type-gate shape). Unrelated dragleaves
    // (row drags, OS file drags) never clear tint state.
    const types = e.dataTransfer?.types;
    if (
      !(types && Array.from(types).indexOf("application/x-skynet-badge") !== -1)
    )
      return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Bounding-rect stateless guard (mirror SplitView.tsx:301-305) — robust
    // against dragleaves fired when the cursor crosses child row boundaries.
    const stillInside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (stillInside) return;
    setIsBadgeDragOver(false);
    if (prevConvlistVisibleRef.current !== false) {
      // eslint-disable-next-line no-console
      console.info(`[convlist-drop-preview] visible=false`);
      prevConvlistVisibleRef.current = false;
    }
  };
  const handlePanelDrop = (e: React.DragEvent<HTMLDivElement>) => {
    // Phase 59 Gap 2 tint clear — clear FIRST regardless of downstream 6-step
    // gauntlet outcome. Defensive: even a non-badge drop that reaches this
    // handler (shouldn't be possible given the dragover type-gate) still
    // clears state. Idempotent.
    setIsBadgeDragOver(false);
    if (prevConvlistVisibleRef.current !== false) {
      // eslint-disable-next-line no-console
      console.info(`[convlist-drop-preview] visible=false`);
      prevConvlistVisibleRef.current = false;
    }
    // Step 1: read the discriminator MIME. Empty string = not a badge drop.
    const raw = e.dataTransfer?.getData("application/x-skynet-badge") ?? "";
    if (raw === "") return;
    // Step 2: parse JSON safely (T-58-02-02).
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    // Step 3: extract + validate tabId shape.
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as { tabId?: unknown }).tabId !== "string" ||
      (parsed as { tabId: string }).tabId === ""
    ) {
      return;
    }
    const tabId = (parsed as { tabId: string }).tabId;
    // Step 4: validate against openTabIds (T-58-02-01 mitigation). This is
    // the security guard — an attacker-controlled dataTransfer payload
    // cannot inject an arbitrary tabId that closes a tab the user did not
    // open. Silent drop on miss.
    if (!openTabIds.includes(tabId)) return;
    // Step 5: signal the drop is handled (prevents default browser
    // behavior like navigating to the text payload).
    e.preventDefault();
    // Step 6: structured log (T-58-02-04 mitigation, PV58-STRUCTURED-LOGGING).
    // Explicit-field extraction — no JSON.stringify(event).
    console.info(`[convlist-drop] close tabId=${tabId}`);
    // Step 7: fire the callback (optional so tests without the prop don't throw).
    onCloseSession?.(tabId);
  };

  const newSessionLabel = t("nav.newSession", {
    defaultValue: "New agent",
  });
  // Phase 22 (SRIC-04): label for the `+ New role` launcher button.
  const newRoleLabel = t("nav.newRole", {
    defaultValue: "New role",
  });
  const rdpSectionLabel = t("nav.conversations.rdpSection", {
    defaultValue: "Remote desktop",
  });
  const filterLabel = t("nav.conversations.filterPinnedBounties", {
    defaultValue: "Filter by pinned bounties",
  });
  const loadingLabel = t("nav.conversations.loading", {
    defaultValue: "Loading conversations…",
  });

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0 overflow-hidden pb-[env(safe-area-inset-bottom)]"
      data-testid="pretty-conversations-panel"
      data-variant={variant}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      {/* Phase 59 Plan 01 Gap 2 — coral drop-target-affordance tint overlay.
          Sibling to the header (:pv-panel-header shrink-0) and scroll region
          below. Signals that dropping an IdentityBadge here will close the
          session (destructive gesture — Alice UAT 2026-08-28: "no tint or
          anything. So it doesn't necessarily seem interactable.").
          Palette values verbatim from SplitView.tsx:446-447 (`--highlight`
          from prototype). pointer-events-none is LOAD-BEARING — drop still
          fires on the underlying panel div. zIndex 30 matches Gap 1
          (AppShell.tsx empty-PV overlay) for visual-language consistency.
          Single-condition render gate — no architectural exclusion here
          (unlike Gap 1's splitTree === null gate). */}
      {isBadgeDragOver && (
        <div
          data-testid="convlist-drop-preview"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "rgba(255, 184, 150, 0.22)",
            border: "2px solid rgba(255, 184, 150, 0.60)",
            zIndex: 30,
            transition: "opacity 120ms ease",
          }}
        />
      )}
      {/* Header: mock v4 `.pv-panel-header` treatment (14px 16px padding +
          hairline border-bottom via --color-pv-border-quiet, 12px UPPERCASE
          700-weight 0.1em-tracked title in --color-pv-fg, 32x32 transparent
          pencil with 8px radius + --color-pv-fg-muted icon). Layout + all
          typography + all button chrome come from the CSS class declared in
          pretty-conversations.css. Retain `shrink-0` on the container to
          defend against parent-flex shrinking; everything else (display:
          flex, align-items: center, justify-content: space-between, padding,
          border-bottom) comes from `.pv-panel-header`.

          Layout branches on `variant`:
            desktop → title (left) + pencil (right)
            mobile  → empty left, pencil only (right)  */}
      <div className="pv-panel-header shrink-0" data-sidebar-toggle-overlaps={sidebarToggleOverlaps ? "true" : "false"}>
        {/* Plan 260729-1vd: .pv-panel-header-row wraps the original title +
            actions so the header can stack vertically (column) with the
            WeeklyUsageMeter below. Patch #142 data-sidebar-toggle-overlaps
            attribute stays on the outer .pv-panel-header (unchanged). */}
        <div className="pv-panel-header-row">
          {/* Patch #144 Fix (f): title renders on BOTH mobile and desktop.
              Prior handoff note "deliberately left off per Phase 10 design"
              was wrong per Alice 2026-07-24. */}
          <span
            className="pv-title"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <img
              src={brandingConfig.iconPath}
              alt=""
              aria-hidden="true"
              className="pv-header-logo"
            />
            <img
              src={brandingConfig.wordmarkPath}
              alt={brandingConfig.appName}
              className="pv-header-wordmark"
            />
          </span>
          <div className="pv-header-actions">
            {/* Phase 26 D-03/D-05 (Phase 52 Plan 02 restyle): Filter button → shadcn Popover
                with three menuitemcheckbox buttons (Ready, Pinned, Needs desk). Popover
                handles Escape, click-outside, and Tab navigation via Radix primitives. The
                button's aria-label is hardcoded as the literal English string
                "Filter conversations" — NOT the stale filterLabel i18n key
                which reads "Filter by pinned bounties" and would mislead
                screen readers after the popover offers a needs-desk toggle. */}
            <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Filter conversations"
                  aria-haspopup="dialog"
                  aria-expanded={filterPopoverOpen}
                  title="Filter conversations"
                  className="pv-filter"
                  data-active={anyFilterOn ? "true" : "false"}
                  data-testid="pv-filter-toggles"
                >
                  <Filter />
                  {anyFilterOn && <span className="pv-filter-dot" aria-hidden="true" />}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={6}
                className="pv-filter-popover"
                data-testid="pv-filter-toggles-popover"
                style={{
                  padding: 4,
                  borderRadius: 12,
                  background: "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))",
                  border: "1px solid rgba(255,240,215,0.12)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)",
                  backdropFilter: "blur(20px) saturate(1.6)",
                  WebkitBackdropFilter: "blur(20px) saturate(1.6)",
                  color: "#e8e4d8",
                  minWidth: 200,
                  // Phase 52 Plan 02 (plan-checker W-1 fix): shadcn PopoverContent hardcodes
                  // w-72 (fixed 288px width) in its className. Inline `width: "auto"` here
                  // overrides that utility via same-property inline-wins so the popover
                  // sizes to content (matching the three-dots menu's auto-width behavior).
                  // Without this, minWidth: 200 alone leaves the popover at 288px because
                  // width and min-width are different CSS properties.
                  width: "auto",
                }}
              >
                {/* Phase 52 Plan 02 / Phase 104 Plan 03 D-11: Ready menuitemcheckbox.
                    Was Ready + Pinned + Needs desk pre-Plan-03; the two bounty-scoped
                    toggles retired alongside the bounty-count wire. Chrome (background
                    gradient, border, radius, blur, drop shadow, color, width, padding)
                    is on the PopoverContent inline style above. Item hover/active flash
                    comes from .pv-filter-menu-item CSS rules. Checkbox affordance from
                    .pv-filter-check. */}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={readyOnly ? "true" : "false"}
                  data-testid="pv-filter-toggle-ready"
                  className="pv-filter-menu-item"
                  onClick={(e) => { e.preventDefault(); setReadyOnly((v) => !v); }}
                >
                  <span className="pv-filter-check" data-checked={readyOnly ? "true" : "false"} aria-hidden="true">
                    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3.5 8.5 L7 12 L13 5" />
                    </svg>
                  </span>
                  <span>Ready</span>
                </button>
              </PopoverContent>
            </Popover>
            {/* Phase 23 (GEFM-01): pencil + `+ New role` collapsed into one
                MoreVertical menu button. Three items: New agent, New role,
                Edit global files…. Gated on the same showPencilButton
                predicate; uses pv-pencil class for chrome parity with the
                removed individual buttons. */}
            {showPencilButton && (
              <button
                ref={menuButtonRef}
                type="button"
                className="pv-pencil"
                onClick={openMenu}
                data-testid="pv-header-menu-button"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreVertical size={18} />
              </button>
            )}
          </div>
        </div>
        {/* Plan 260729-1vd (WEEKLY-METER-01): dual-race split-bar meter.
            Sibling of .pv-panel-header-row, still INSIDE .pv-panel-header.
            Polls /api/usage every 15s; gracefully retains last values on failure.
            Feature 09 (2026-09-04): admin-only visibility. */}
        {isAdmin && <WeeklyUsageMeter />}
      </div>

      {/* Scroll region: safe-area padding lives on outer container (patch #131)
          so the panel bottom sits ABOVE the safe-area — settings row is not
          covered when scroll is at rest. Phase 41 Plan 02: ref attached so the
          one-shot cold-load scroll-hide effect can set scrollTop. */}
      <div ref={scrollContainerRef} className="pv-panel-scroll min-h-0">
        {/* Phase 41 Plan 02 (Alice 2026-08-14): always-in-DOM search input at
            the very top of the scroll region. On the first cold-load per
            browser session the one-shot effect above sets scrollTop to this
            container's offsetHeight so the input sits just above the visible
            area (revealed only by scrolling up). Scoped test-ids per
            41-02-PLAN.md acceptance criteria. NO auto-focus (Alice lock #4 —
            uniform tap/click-to-focus on both mobile + desktop). */}
        <div
          ref={searchContainerRef}
          className="pv-search-container"
          data-testid="pretty-conversations-search-container"
        >
          <Search
            className="pv-search-icon"
            aria-hidden="true"
            width={16}
            height={16}
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations"
            className="pv-search-input"
            data-testid="pretty-conversations-search-input"
            aria-label="Search conversations"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="pv-search-clear"
              data-testid="pretty-conversations-search-clear"
              aria-label="Clear search"
            >
              <X width={14} height={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {/* Load-in-flight affordance. Renders at the top of the scroll region
            while the fleet enumeration is still in flight; disappears once
            useFleetSessionsLoaded() flips true. RDP and openTab rows tend to
            arrive first (host-tree endpoint), so consumers with RDP hosts
            see the strip above already-rendered rows, while RDP-less
            consumers see just the strip on an otherwise empty panel — both
            get an explicit "more is coming" signal instead of a blank flash.
            No separate empty-state card: the header chrome is affordance
            enough when the list is genuinely empty post-load. */}
        {!fleetSessionsLoaded && (
          <div
            role="status"
            aria-busy="true"
            aria-label={loadingLabel}
            data-testid="pretty-conversations-loading"
            className="flex items-center justify-center gap-2 px-4 py-3 text-[14px] text-[#dfe3ee]/75"
          >
            <Loader2
              className="size-4 shrink-0 animate-spin"
              aria-hidden="true"
            />
            <span>{loadingLabel}</span>
          </div>
        )}
        {/* Phase 41 Plan 02 (Alice 2026-08-14): render tree BRANCHES on
            whether the search input has a non-empty trimmed query.
              - searchMatches !== null → FLAT match list — no divider chips,
                no zone chrome, pinned/middle/rdp all collapse into one
                container. Hidden rows deliberately excluded from the union
                (Alice lock #3). Deactivate/pin actions preserved per row.
              - searchMatches === null → three-zone view restores (activeSet
                + pinned + middle + rdpGroup + Hidden). */}
        {searchMatches !== null ? (
          <div className="pv-panel-group" data-search-flat-group="true">
            {searchMatches.map((row) => (
              <PrettyConversationRowLive
                key={row.id}
                row={row}
                selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                pinned={isRowPinned(row)}
                hidden={hiddenIds.has(row.id)}
                variant={variant}
                onSelect={() => handleRowSelect(row)}
                onTogglePin={
                  row.rdpHostRow === true ? rdpNoopTogglePin : () => handleTogglePin(row)
                }
                onDeactivate={() => handleRowDeactivate(row)}
                onToggleHide={
                  isFleetIdentityRow(row) ? () => handleToggleHide(row) : undefined
                }
                onClone={row.rdpHostRow === true ? undefined : () => handleRowClone(row)}
                onKill={() => handleRowKill(row)}
                inActiveSet={activeSet.has(row.id)}
                sessionKey={sessionWorkingKey(row)}
                subtitleMode={row.rdpHostRow === true ? undefined : "identityTitle"}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Phase 42 UAT amendment 2026-08-17 (Alice verbatim): active-set
                top zone retired — active-set rows now flow through to pinned
                (if pinned) or middle (by recency). Pinned tier still renders
                inside `.pv-panel-group[data-pinned-group="true"]` with per-row
                inActiveSet={activeSet.has(row.id)} wiring preserved to gate the
                `.active-set` CSS deactivate-action hover-reveal. The "Pinned"
                divider chip previously rendered above this group is also
                retired (Alice verbatim: "the pinned header should go away
                entirely"). */}
            <div className="pv-panel-group" data-pinned-group="true">
              {displayedPinned.map((row) => (
                <PrettyConversationRowLive
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                  pinned={true}
                  hidden={hiddenIds.has(row.id)}
                  variant={variant}
                  onSelect={() => handleRowSelect(row)}
                  onTogglePin={() => handleTogglePin(row)}
                  onDeactivate={() => handleRowDeactivate(row)}
                  onToggleHide={
                    isFleetIdentityRow(row) ? () => handleToggleHide(row) : undefined
                  }
                  onClone={() => handleRowClone(row)}
                  onKill={() => handleRowKill(row)}
                  inActiveSet={activeSet.has(row.id)}
                  sessionKey={sessionWorkingKey(row)}
                  subtitleMode="identityTitle"
                />
              ))}
            </div>
            {/* Phase 41 Plan 01 (Alice 2026-08-14): FLAT middle zone.
                No per-host divider chips (retired). Every non-pinned, non-
                active-set, non-RDP row lands in `displayedMiddle` as a
                single flat array from `snapshot.middle`, sorted by the
                store's compareByRecencyDesc + insertion-order fallback.
                Rendered inside ONE `.pv-panel-group` container without
                per-host wrappers. */}
            {displayedMiddle.length > 0 && (
              <div className="pv-panel-group" data-middle-group="true">
                {displayedMiddle.map((row) => (
                  <PrettyConversationRowLive
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                    pinned={isRowPinned(row)}
                    hidden={hiddenIds.has(row.id)}
                    variant={variant}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={() => handleTogglePin(row)}
                    onDeactivate={() => handleRowDeactivate(row)}
                    onToggleHide={
                      isFleetIdentityRow(row) ? () => handleToggleHide(row) : undefined
                    }
                    onClone={() => handleRowClone(row)}
                    onKill={() => handleRowKill(row)}
                    inActiveSet={activeSet.has(row.id)}
                    sessionKey={sessionWorkingKey(row)}
                    subtitleMode="identityTitle"
                  />
                ))}
              </div>
            )}
            {/* Phase 41 Plan 01: RDP zone renderer. When `displayedRdpGroup`
                is null (zero RDP-eligible hosts), the entire section —
                divider chip + rows — is suppressed (Alice lock #7).
                When non-null, renders the "Remote desktop" divider chip +
                Monitor-glyph rows. */}
            {displayedRdpGroup !== null && (
              <div
                key={displayedRdpGroup.hostId}
                className="pv-panel-group"
                data-rdp-group="true"
              >
                {/* Subtle RDP divider chip — mirrors prototype.html
                    .rdp-divider block: small Monitor glyph + uppercase
                    muted label + gradient rule. Rendered ONCE above the
                    RDP row cluster regardless of how many RDP rows exist. */}
                <div
                  className="flex items-center gap-2 px-4 pt-3 pb-1.5"
                  data-testid="rdp-divider"
                >
                  {/* quick-260727-f9v: brightness bumped from /50 → /85
                      on BOTH icon and label so this chip reads at the
                      same weight as the retired per-host chips did. */}
                  <Monitor
                    className="size-3 text-[#5c6070]/85 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
                    {rdpSectionLabel}
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
                  />
                </div>
                {displayedRdpGroup.rows.map((row) => (
                  <PrettyConversationRowLive
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                    pinned={false}
                    variant={variant}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={rdpNoopTogglePin}
                    onDeactivate={() => handleRowDeactivate(row)}
                    onKill={() => handleRowKill(row)}
                    inActiveSet={activeSet.has(row.id)}
                    sessionKey={sessionWorkingKey(row)}
                  />
                ))}
              </div>
            )}
            {/* quick-260731-tgg: Hidden section — collapsed by default, rendered
                BELOW the __rdp__ group iff hiddenIds.size > 0. Header chip mirrors
                the pinned/RDP chip treatment: EyeOff glyph + uppercase "Hidden"
                label + gradient rule + ChevronRight/ChevronDown caret.
                Local hiddenExpanded state; collapsed on every mount (no persistence). */}
            {hiddenRows.length > 0 && (
              <div className="pv-panel-group pv-hidden-section" data-hidden-group="true">
                <button
                  type="button"
                  className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full"
                  data-testid="hidden-divider"
                  aria-expanded={hiddenExpanded}
                  onClick={() => setHiddenExpanded((v) => !v)}
                >
                  <EyeOff
                    className="size-3 text-[#5c6070]/85 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
                    Hidden
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
                  />
                  {hiddenExpanded ? (
                    <ChevronDown
                      className="size-3 text-[#5c6070]/85 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronRight
                      className="size-3 text-[#5c6070]/85 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
                {hiddenExpanded &&
                  hiddenRows.map((row) => (
                    <PrettyConversationRowLive
                      key={row.id}
                      row={row}
                      selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                      pinned={false}
                      hidden={true}
                      variant={variant}
                      onSelect={() => handleRowSelect(row)}
                      onTogglePin={() => handleTogglePin(row)}
                      onToggleHide={
                        isFleetIdentityRow(row) ? () => handleToggleHide(row) : undefined
                      }
                      onClone={() => handleRowClone(row)}
                      onKill={() => handleRowKill(row)}
                      inActiveSet={activeSet.has(row.id)}
                      sessionKey={sessionWorkingKey(row)}
                      subtitleMode="identityTitle"
                    />
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* NewSessionDialog VERBATIM from ConversationsPanel.tsx lines
          358-368. Portal-mounted; DOM sibling position doesn't drive
          layout. Only mounted when onCreateSession is wired — same gate
          as the pencil button. */}
      {showPencilButton && (
        <NewSessionDialog
          open={newSessionDialogOpen}
          onClose={() => {
            setNewSessionDialogOpen(false);
            // Phase 22 SRIC-05: clear chainPrefill on close so a subsequent
            // manual open (via pencil) does NOT inherit stale chain state.
            setChainPrefill(null);
          }}
          hostTree={hostTree ?? null}
          onCreate={(opts) => {
            onCreateSession!(opts);
            setNewSessionDialogOpen(false);
            // Also clear on successful submit path (matches close semantics).
            setChainPrefill(null);
          }}
          // Phase 22 SRIC-05: chain pre-fill props. Null when chainPrefill
          // has not been set (fresh manual pencil open); populated when
          // CreateRoleDialog's onChainToCreateIdentity fired.
          initialHost={chainPrefill?.host ?? null}
          initialRole={chainPrefill?.role ?? null}
          initialBrief={chainPrefill?.description ?? null}
          // Phase 88: forward admin-gate to NewSessionDialog for Path field + shell checkbox visibility (see 88-CONTEXT.md §isAdmin prop plumbing).
          isAdmin={isAdmin}
        />
      )}
      {/* D-10 revised 2026-09-11: panel-level CreateRoleDialog mount RESTORED
          as swap-not-stack sibling of RolesListModal + NewSessionDialog.
          Opened via RolesListModal's onNewRole callback (which also closes
          the list). onChainToCreateIdentity fires after successful role
          create → sets chainPrefill + opens NewSessionDialog with role +
          host + description pre-filled, restoring the historical chain. */}
      <CreateRoleDialog
        open={createRoleDialogOpen}
        onClose={() => setCreateRoleDialogOpen(false)}
        hostTree={hostTree ?? null}
        onChainToCreateIdentity={({ role, host, description }) => {
          setCreateRoleDialogOpen(false);
          setChainPrefill({ role, host, description });
          setNewSessionDialogOpen(true);
        }}
      />
      {/* Phase 80: the dedicated clone-dialog mount was DELETED. The row
          context-menu "create new agent under this role" item (formerly labeled
          "Clone") now routes through the NewSessionDialog mount above via
          chainPrefill (see handleRowClone). No standalone clone dialog
          exists anymore — one creation flow, one modal (Landmine 11:
          reuse, don't build new). */}
      {/* Phase 23 (GEFM-05): GlobalFilesModal — portal-mounted sibling of the
          existing dialog mounts. Opened via the header MoreVertical menu's
          "Edit global files…" item. defaultHostId={null} is deliberate: the
          panel-header trigger has no active-conversation context (it renders
          a list), so the modal falls through to its own host picker. */}
      <GlobalFilesModal
        open={globalFilesModalOpen}
        onOpenChange={setGlobalFilesModalOpen}
        hostTree={hostTree ?? null}
        defaultHostId={null}
      />
      {/* Phase 44 SKILLED-01: SkillsEditorModal — portal-mounted sibling of
          GlobalFilesModal. Opened via the header menu's "Edit skills…" item.
          defaultHostId={null} deliberate — the panel-header trigger has no
          active-conversation context, so the modal falls through to its own
          host picker. */}
      <SkillsEditorModal
        open={skillsEditorModalOpen}
        onOpenChange={setSkillsEditorModalOpen}
        hostTree={hostTree ?? null}
        defaultHostId={null}
      />
      {/* Phase 91 Plan 05 — NewConversationModal — portal-mounted sibling of
          existing modal mounts. Opened via the header MoreVertical menu's "New
          conversation" item. Controlled state; the modal itself owns form state
          via useNewConversationForm hook. On successful create, calls
          onCreateRelayRoom which threads through AppShell to open the pane. */}
      {/* newConversationModalOpen controls the portal; setNewConversationModalOpen
          is the toggle. onCreated closes + calls the AppShell callback. */}
      <NewConversationModal
        open={newConversationModalOpen}
        onOpenChange={setNewConversationModalOpen}
        onCreated={(result) => {
          setNewConversationModalOpen(false);
          onCreateRelayRoom?.(result); // AppShell-side handler opens the tab
        }}
      />
      {/* Phase 90 Plan 90-06 (D-07): RolesListModal — portal-mounted sibling of
          GlobalFilesModal + SkillsEditorModal. Opened via the header menu's
          "Edit roles…" item. defaultHostId={null} deliberate — the panel-header
          trigger has no active-conversation context, so the modal falls through
          to its own host picker (matches GlobalFilesModal + SkillsEditorModal
          shape). Row click swaps to <RoleModal> below (D-04 swap-not-stack). */}
      <RolesListModal
        open={rolesListModalOpen}
        onOpenChange={setRolesListModalOpen}
        hostTree={hostTree ?? null}
        defaultHostId={null}
        onSelectRole={({ roleName, roleCosmetics, hostId: pickedHostId }) => {
          // D-04 swap-not-stack: close list, open role modal.
          setRolesListModalOpen(false);
          // Phase 90 Plan 90-10 (D-08.3): the identity-shim derivation was
          // removed — the RoleModal now reads/writes purely by role name via
          // Plan 90-09's role-name-keyed helpers. No identity indirection.
          setRoleModalOpenState({
            roleName,
            roleCosmetics,
            hostId: pickedHostId,
          });
        }}
        onNewRole={() => {
          // D-10 revised 2026-09-11 swap-not-stack: close list, open create.
          setRolesListModalOpen(false);
          setCreateRoleDialogOpen(true);
        }}
      />
      {/* Phase 90 Plan 90-06 (D-04): RoleModal — swap target for RolesListModal
          row click. Mounted at document.body via its own DialogPrimitive.Portal
          (D-03). Runbook row click nests to RunbookEditorModal (below) —
          mirrors PrettyView's mount pattern. */}
      {roleModalOpenState && (
        <RoleModal
          open={true}
          onOpenChange={(o) => {
            if (!o) setRoleModalOpenState(null);
          }}
          roleName={roleModalOpenState.roleName}
          roleCosmetics={roleModalOpenState.roleCosmetics}
          hostId={roleModalOpenState.hostId}
          onOpenRunbook={(runbookName) => {
            // Nested swap: close role modal, open runbook editor.
            // Capture hostId + roleName BEFORE clearing roleModalOpenState so
            // the runbook editor can read them even after the parent state
            // slot went null.
            setPanelRunbookEditorOpenState({
              roleName: roleModalOpenState.roleName,
              runbookName,
              hostId: roleModalOpenState.hostId,
            });
            setRoleModalOpenState(null);
          }}
        />
      )}
      {/* Phase 90 Plan 90-06 (D-06 nested): RunbookEditorModal — swap target
          for RoleModal's onOpenRunbook. Mirrors PrettyView's mount at L3281.
          Close just clears state (no reopen of RoleModal per D-03). */}
      {panelRunbookEditorOpenState && (
        <RunbookEditorModal
          open={true}
          onOpenChange={(o) => {
            if (!o) setPanelRunbookEditorOpenState(null);
          }}
          hostId={panelRunbookEditorOpenState.hostId}
          roleName={panelRunbookEditorOpenState.roleName}
          runbookName={panelRunbookEditorOpenState.runbookName}
        />
      )}
      {/* Phase 23 (GEFM-01): glass portal menu — keyboard-Escape + click-outside
          dismiss. Portal-mounted to document.body to escape overflow clipping
          from .pv-panel-header. Chrome mirrors PrettyConversationContextMenu.tsx
          (same glass gradient, border, backdrop-filter, color tokens). */}
      {menuOpen && menuAnchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            top: menuAnchor.top,
            right: menuAnchor.right,
            minWidth: 200,
            zIndex: 200,
            padding: 4,
            borderRadius: 12,
            background: "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))",
            border: "1px solid rgba(255,240,215,0.12)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)",
            backdropFilter: "blur(20px) saturate(1.6)",
            WebkitBackdropFilter: "blur(20px) saturate(1.6)",
            color: "#e8e4d8",
          }}
        >
          {/* KEEP ORDER: New conversation → New agent → Edit roles… → Edit global files… → Edit skills… (Phase 44 Pitfall 8 guard — do not alphabetize or reshuffle).
              Phase 90 Plan 90-06 (D-07): "New role" swapped out for "Edit roles…"
              — the roles-list modal is the new front door to role creation
              (via its header '+ New role' button) AND to per-role editing.
              Phase 91 — "New conversation" prepended as v1 throwaway placement;
              conversation-list area redesign will resurface this. */}
          {[
            { label: "New conversation", onClick: () => setNewConversationModalOpen(true) }, // Phase 91 Plan 05
            { label: "New agent", onClick: () => setNewSessionDialogOpen(true) },
            { label: "Edit roles…", onClick: () => setRolesListModalOpen(true) },
            { label: "Edit global files…", onClick: () => setGlobalFilesModalOpen(true) },
            { label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); item.onClick(); closeMenu(); }}
              className="py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                fontSize: 14,
                lineHeight: "18px",
                borderRadius: 8,
                background: "transparent",
                border: "none",
                color: "#e8e4d8",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,240,215,0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
