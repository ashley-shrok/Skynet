// ─── PrettyConversationsPanel ────────────────────────────────────────────────
// The flat-list composition of the Phase 10 pretty-conversations rework
// (as amended by Phase 41 Plan 01, user 2026-08-14 — three-zone reshape).
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
//     divider chip + rows — is suppressed per user lock #7.
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
//   - settingsRowSlot prop retired in Phase 11 (user's "no settings" lock —
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
// Phase 119 Plan 04 (D-02): `AppWindow` glyph added for the new Apps section
// header at `size-3 text-[#5c6070]/85 shrink-0` typography.
// UAT 2026-09-19: `Pin` glyph added for the reinstated Pinned section header
// (reverses the 2026-08-17 "pinned header should go away entirely" lock — the
// Apps section landing above the flat middle re-introduced ambiguity between
// Apps and pinned rows that the earlier design didn't have).
import { AlarmClock, AppWindow, ChevronDown, FolderOpen, Globe, Loader2, MessageSquare, MessagesSquare, Monitor, MoreVertical, Pin, Search, Settings, SquarePen, X } from "lucide-react";
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
  // Phase 117 Plan 117-08 (D-09, D-15, D-39): projects-derived selector output.
  // The panel reads pinnedUnassigned/projectSections/rdp from the same
  // useConversations() snapshot the store now emits (117-07 additive fields).
  // useProjects is subscribed alongside so we react to fleet-status wire updates
  // (project-list-changed frames flow through setProjects → notify → re-render).
  useProjects,
  type ConversationRow as ConversationRowShape,
} from "@/state/conversation-store";
// Phase 117 Plan 117-08 (D-40): per-project collapse state (localStorage-backed
// via the hook landed in 117-07). Consumers pass the collapsed set + toggle
// callback into each PrettyProjectSectionHeader.
import { useCollapsedProjectSlugs } from "@/state/use-collapsed-project-slugs";
// Phase 117 Plan 117-08 (D-22): project drop-handler API surface. Landed by
// 117-06 as thin authApi wrappers; called fire-and-forget from the panel's
// handleProjectDrop / handleFlatMiddleDrop.
import { setSessionProject, setRelayRoomProject } from "@/api/session-project-api";
// Phase 117 Plan 117-09 Task 2 (D-28, D-29, D-30) — archive-project cascade.
// handleArchiveProject collects the section's members, presents the D-29
// verbatim confirmation, fires Promise.allSettled across archiveIdentity +
// setRelayRoomProject(null) member ops, then archiveProject as the folder-move.
import { archiveProject } from "@/api/project-list-api";
// Phase 117 Plan 117-09 Task 2 (D-14) — reusable right-click / long-press
// context menu chrome. The section header binds onContextMenu, which opens
// this menu at the pointer coords with Edit + Archive items.
import { PrettyConversationContextMenu } from "./PrettyConversationContextMenu";
// Phase 117 Plan 117-08: viewing user's Matrix mxid — required for the
// relay-room drop branch (setRelayRoomProject's second argument). Sourced from
// the same hook the shared chat surface uses (viewing-user-store, Phase 90 P5).
import { useViewingUserMxid } from "@/state/viewing-user-store";
// Phase 117 Plan 117-08 Task 1 — per-project section wrapper landed earlier
// in this plan. Consumes projectSections from the store selector; emits
// onDropRow → panel's handleProjectDrop (which resolves identity vs
// relay-room routing).
import { PrettyProjectSectionHeader } from "./PrettyProjectSectionHeader";
// Phase 117 Plan 117-09 Task 1 — CreateProjectModal: swap-target for the
// 117-08 placeholder marker. Controlled modal wired to the header
// "Create project" button; on 200 fires onCreated with the backend-echoed
// slug (D-25 backend-authoritative slugify per Pitfall 1).
import { CreateProjectModal } from "./CreateProjectModal";
// Phase 117 followup — ProjectFileModal, opened from the section-header
// context menu's "Edit project file" item. Wired below in
// handleEditProjectFile / mounted alongside the other project modals.
import { ProjectFileModal } from "./ProjectFileModal";
// Phase 122 Plan 03 Task 3 — ConversationSearchModal: opened via the
// header magnifying-glass button below (first child of .pv-header-actions).
// The modal owns its query + results store (module-scoped search-store) so
// state persists across open/close cycles (D-05). Active-result click
// bubbles up through onSearchResultOpenActive → AppShell's tab-open flow
// (mirrors onDetachedRowClick shape at AppShell.tsx:3068). Plan 03 does
// NOT remove the existing filter-as-you-type — that lands in Plan 04
// (D-18 ordering: modal usable BEFORE filter removed).
import { ConversationSearchModal } from "./ConversationSearchModal";
// Phase 135 Plan 135-01 Task 4 (shape 3, wake-ups-redesign) — WakeupsModal:
// portal-mounted sibling of ConversationSearchModal, opened via the new
// AlarmClock header button below (position 6 in the .pv-header-actions
// cluster, between Edit-global-files and the feedback + kebab buttons).
// Owns its own list + form + refetch lifecycle (D-03 no client cache);
// controlled open state lifted to this panel per D-26 (mirrors sibling
// modals). Consumes the fleet-wide LIST + CRUD helpers from
// src/ui/api/wakeups-api.ts, which layer over shape 2's REST endpoints.
import { WakeupsModal } from "./WakeupsModal";
import type { ConversationSearchResult } from "@/api/conversation-search-api";
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
  refreshIdentities,
} from "@/state/identities-store";
import { startTrappedWorkPoller } from "@/state/trapped-work-store";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { NewSessionDialog, type NewSessionOnCreateOpts } from "@/sidebar/NewSessionDialog";
// D-10 revised 2026-09-11: CreateRoleDialog re-imported at panel level. The
// Plan 90-06 stack-inside-RolesListModal arrangement caused a click-freeze
// (two Radix Dialog portals contending) and dropped the CRD → NewSessionDialog
// chain. Restored as swap-not-stack sibling of RolesListModal.
import { CreateRoleDialog } from "@/sidebar/CreateRoleDialog";
// Phase 92 Plan 04: getPinnedIds is retired. The panel projects the pin state
// from the identities-store's `pinned: boolean` field via deriveDiskPinnedIds
// (imported above).
// (Phase 115 Plan 115-02: the Phase 107 `.hidden` hydrate + deriveDiskHiddenIds
//  path was retired per D-21 alongside the backend .hidden fanout removal.)
import type { Host, HostFolder } from "@/types/ui-types";

import { PrettyConversationRow } from "./PrettyConversationRow";
// Phase 115 Plan 115-06 (Task 2): archive API client — invoked by row context
// menu; archived identities are searchable via the Phase 122 modal.
import { archiveIdentity } from "@/api/identity-archive-api";
// Phase 119 Plan 04 (D-01/D-02/D-03/D-04/D-05): sidebar Apps section. Consumes
// the useAppTiles() hook (Plan 119-02, backed by the fleet-status app-frame
// channel) and renders one <AppTile app={...}/> per entry (Plan 119-03) inside
// a new .pv-apps-section group. Not gated on `.length > 0` (D-05: always
// present so the empty-expanded prompt is discoverable).
import { AppTile } from "./AppTile";
import { useAppTiles } from "@/state/app-tiles-store";
import WeeklyUsageMeter from "./WeeklyUsageMeter";
// Phase 91 Plan 05 — NewConversationModal: portal-mounted sibling of
// GlobalFilesModal. Opened via the header three-dot menu "New conversation"
// item. onCreateRelayRoom prop threads the create response to AppShell.
import { NewConversationModal } from "./NewConversationModal";
import {
  EnableNotificationsModal,
  pushNotificationsSupported,
} from "@/features/notifications/EnableNotificationsModal";
import type { CreateRelayRoomResponse } from "./participant-types";
// Phase 70 Plan 04: header lockup (small icon + wordmark) now sourced from
// brandingConfig (Plan 70-03) so operator-provided assets swap in. Prior
// hardcoded inline-SVG logo import removed — no remaining consumers in this
// file after the JSX below switched to <img src={brandingConfig.iconPath}>.
import { useBrandingConfig } from "@/branding/branding-store";
// Phase 123 shape 2 (D-11): leaf-level subscription to the shape-1
// useSyncExternalStore singleton that tells us whether feedback is enabled
// on this deployment. Consumed at the top of the component body — controls
// the "Send feedback" header button's DOM presence (button ABSENT when
// disabled, not disabled-and-hidden, per D-11).
import { useFeedbackEnabled } from "@/feedback/feedback-store";
import { getBasePath } from "@/lib/base-path";
import { roleDisplayName } from "@/lib/role-display-name";

// Phase 122 Plan 04 (D-17 removal): the SEARCH_HIDDEN_SENTINEL_KEY constant
// and its one-shot cold-load scroll-hide useEffect at ~L950 were retired
// together with the inline filter-as-you-type input the Plan 03 modal
// replaced. The store-side clear in conversation-store.ts is also retired.

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

// Phase 117 M-I follow-up (2026-09-19): flatten a HostFolder into a list of
// Hosts via DFS. Used to filter the tree to a single host when the new-agent
// dialog opens in project context (destination host is implied). Mirrors
// the collectAllHosts helper inlined in CreateRoleDialog / NewSessionDialog /
// CreateProjectModal — kept local to avoid a shared-util migration for one
// call site.
function collectHostsFromFolder(folder: HostFolder): Host[] {
  const out: Host[] = [];
  const walk = (children: (Host | HostFolder)[]): void => {
    for (const child of children) {
      if ("children" in child) walk(child.children);
      else out.push(child);
    }
  };
  walk(folder.children ?? []);
  return out;
}

// (Phase 115 Plan 115-02: the Phase 107 `canonicalHideIdForRow` +
//  `isRowHidden` helpers were retired per D-21 alongside the Hide menu
//  affordance. 115-06 introduces an Archive equivalent with a distinct
//  discriminator sourced from the archived-tree sweep, not from these
//  helpers.)

// Phase 115 Plan 115-06 (D-01, D-04): affordance-narrowing gate for the
// Archive menu item — mirrors the deleted `canonicalHideIdForRow` (115-02).
// Returns the canonical fleet-synthetic id (`fleet::<hostId>::<key>`) for a
// row when the Archive item should be offered, or null when the row is NOT
// an eligible target:
//   - RDP host-rows (`row.rdpHostRow === true`)   → null (RDP has no identity backing).
//   - Relay-room rows (`row.kind === "relay-room"`) → null (rooms are not identities).
//   - Rows without host + targetTmuxSession       → null (fleet-synthetic id
//                                                    cannot be constructed).
// The panel only threads `onArchive` on rows whose gate returns non-null,
// which the row component then renders as the "Archive" menu entry.
function canonicalArchiveIdForRow(row: ConversationRowShape): string | null {
  if (row.rdpHostRow === true) return null;
  if (row.kind === "relay-room") return null;
  if (!row.host || !row.targetTmuxSession) return null;
  const hostIdNum = parseInt(row.host.id, 10);
  if (!Number.isFinite(hostIdNum)) return null;
  return fleetRowId(hostIdNum, row.targetTmuxSession);
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
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  // quick-260727-gm3: forwarded verbatim to PrettyConversationRow. Only
  // wired at render sites where the row can be in the active-set (active-
  // set group, pinned group, non-RDP grouped block). RDP sentinel omits
  // it because RDP rows never emit onDeactivate at the row level.
  onDeactivate?: () => void;
  // (Phase 115 Plan 115-02: prior onToggleHide + hidden props retired per
  //  D-21.) Phase 115 Plan 115-06 (D-01): onArchive forwarded to
  //  PrettyConversationRow for the Archive context-menu item. Wired ONLY at
  //  render sites for fleet-synthetic identity-backed rows (gated by
  //  canonicalArchiveIdForRow at the parent panel level) so RDP synthetic
  //  rows, relay-room rows, and openTab-derived rows without host +
  //  targetTmuxSession never receive it — the row's items[] builder gates
  //  on `onArchive !== undefined`, so absence at this seam means absence in
  //  the menu.
  onArchive?: () => void;
  // quick-260810-n3a: forwarded to PrettyConversationRow for the Kill
  // context-menu item. The row's items[] builder gates on !isRdp && !identity
  // && row.targetTmuxSession so the item only appears for valid targets.
  onKill?: () => void;
  // shape-move-to-project-context-menu (2026-09-23): three props for the
  // context-menu drill-in that lets a user assign a row's project without
  // dragging. Forwarded verbatim to PrettyConversationRow via {...rowProps}.
  // onMoveToProject is UNDEFINED for RDP rows AND for zero-project fleets —
  // the row's items[] builder gates on its presence to hide the parent item
  // entirely (hidden-not-grey). projects + currentProjectSlug drive the
  // submenu's rendering (list order, checkmark, "Remove from project"
  // visibility).
  onMoveToProject?: (slug: string | null) => void;
  projects?: readonly { slug: string; displayName: string }[];
  currentProjectSlug?: string | null;
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
  username = null,
  onCreateRelayRoom,
  onOpenApp,
  onOpenFeedback,
  onSearchResultOpenActive,
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
  // alongside AppRail per user's "no settings" lock).
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
  // quick-260727-gm3: fired when user clicks the red-tinted X on an
  // active-set row. AppShell wires this to closeTab(row.id) so
  // the deactivate action reuses the existing tab-close plumbing verbatim
  // (including the confirm-tab-close toast branch). Required — the panel
  // composes removeFromActiveSet(row.id) + onDeactivateRow(row) at the
  // handleRowDeactivate call site; making the prop required forces every
  // caller (production AppShell + tests) to explicitly wire the tab-close
  // side. Test files that don't care pass `onDeactivateRow={() => {}}`.
  onDeactivateRow: (row: ConversationRowShape) => void;
  /**
   * quick-260810-n3a: Fired when user confirms the Kill dialog.
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
  // Sidebar-footer "you" anchor — current user's username, sourced from
  // /users/me.username (AppShell state). Feeds both the display name and
  // the initials-circle glyph. Null/undefined/empty → footer renders
  // without the anchor slot; footer action affordances still render.
  username?: string | null;
  /**
   * Phase 91 Plan 05 — Fired when the user successfully creates a relay room
   * via NewConversationModal. AppShell wires this to open the relay-room tab
   * via the canonical openTab signature (mirroring onRelayRoomRowClick). The
   * modal itself calls onOpenChange(false) before this fires, so the prop is
   * called after the modal has already closed.
   */
  onCreateRelayRoom?: (result: CreateRelayRoomResponse) => void;
  /**
   * Phase 120 D-06 — Fired when the user left-clicks an AppTile in the Apps
   * section. AppShell wires this to
   * `openTab(null, "app", ..., { app: { hostId, slug }, label: title })`,
   * creating a new app-type pane leaf. Optional so tests + non-integrated
   * mount sites can render the panel without wiring the callback (Phase 119
   * shipped AppTile.tsx with a deliberate no-op click; Plan 07 activates it
   * end-to-end through this prop hole).
   */
  onOpenApp?: (hostId: number, slug: string, title: string) => void;
  /**
   * Phase 124 shape 2 (rescue-rebased from Phase 123) — fired when the
   * user clicks the header "Send feedback" button (sixth icon in the
   * header row, between Search and the kebab). AppShell lifts its
   * existing feedbackOpen state atom to "general", opening the shared
   * FeedbackModal that Phase 123 already mounted unconditionally at
   * AppShell. Optional so tests can render the panel without wiring
   * feedback (the button will still render if feedbackEnabled is true —
   * clicking it with no callback is a silent no-op via optional
   * chaining).
   */
  onOpenFeedback?: () => void;
  /**
   * Phase 122 Plan 03 Task 3 — Fired when the user clicks an ACTIVE
   * (isArchived === false) result in the ConversationSearchModal. AppShell
   * resolves the hostId to a Host and calls openTab(host, "terminal",
   * undefined, { targetTmuxSession: result.tmuxSessionName, ... }) —
   * verbatim mirror of the onDetachedRowClick handler at AppShell.tsx:3068.
   * The modal itself calls onOpenChange(false) after invoking this callback
   * (D-04 jump-and-close). Optional so tests + non-AppShell mounts can
   * render the panel without wiring the callback (the modal button will
   * still open the modal, but clicking a result becomes a silent no-op —
   * fine for unit tests).
   */
  onSearchResultOpenActive?: (result: ConversationSearchResult) => void;
}) {
  const visibleInSplitTree = visibleInSplitTreeTabIds ?? EMPTY_VISIBLE_SET;
  const { t } = useTranslation();
  // Phase 70 Plan 04: header lockup below (small icon + wordmark) reads
  // from the branding store instead of importing an inline-SVG logo /
  // hardcoding the wordmark asset path.
  const brandingConfig = useBrandingConfig();
  // Phase 123 shape 2 (D-11/D-12): leaf-level subscription to the
  // feedback-enabled useSyncExternalStore singleton (shape-1 D-08).
  // Gates ONLY the header "Send feedback" button — INDEPENDENT of the
  // showPencilButton gate below (D-12), so the button renders on any
  // header where feedback is configured even when the create-buttons are
  // hidden. Starts as false (default-disabled sentinel per shape-1 D-08)
  // and resolves after feedback-fetch answers — small load-time pop-in
  // is accepted (D-13; no reserved space, no fade-in, no placeholder).
  const feedbackEnabled = useFeedbackEnabled();
  // Phase 41 Plan 01: destructure the three-zone shape — `middle` (flat
  // recency-sorted rows) + `rdpGroup` (nullable RDP sentinel group) replace
  // the retired `grouped: HostGroup[]` field.
  // Phase 117 Plan 117-08 (D-09, D-39): the store's derived selector now also
  // emits pinnedUnassigned + projectSections + rdp alongside the pre-Phase-117
  // pinned + middle + rdpGroup fields (117-07 additive extension). This plan
  // consumes the NEW fields for the projects-aware render pass and keeps
  // `pinned` (unchanged upstream — same array reference contract) for
  // continuity with existing display filters (bounty toggle, etc). The
  // pinned tier switches from `pinned` → `pinnedUnassigned` in the render
  // block below so pinned-in-project rows float to their project section
  // (D-19) instead of the top pinned zone.
  const {
    activeSet: activeSetRows,
    pinned,
    middle,
    rdpGroup,
    pinnedUnassigned,
    projectSections,
  } = useConversations();
  // Subscribe to the projects list so the panel re-renders when the wire
  // event flushes a new set through setProjects. useProjects() also feeds
  // the derived selector's projectSections computation — subscribing here is
  // required for the snapshot version to bump on project mutations. Phase
  // 117 Plan 117-09 Task 2 additionally uses the returned list to look up
  // a project's hostId when firing archiveProject.
  const projectsList = useProjects();
  // Per-project collapse state (D-40). Toggle is a callback threaded through
  // PrettyProjectSectionHeader's `onToggleCollapse` prop.
  const { collapsed: collapsedProjectSlugs, toggle: toggleProjectCollapse } =
    useCollapsedProjectSlugs();
  // Viewing user's mxid — required for the relay-room drop branch
  // (setRelayRoomProject signature: roomId, userMxid, slug). Null before the
  // /users/me fetch resolves — drop guards below refuse to fire when null.
  const viewingUserMxid = useViewingUserMxid();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();
  // (Phase 115 Plan 115-02: prior useHiddenIds subscription retired per D-21.
  //  115-06 introduces an archived-tree subscription driven off the sweep,
  //  not off a hiddenIds set.)
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
  const { byHostKey: identitiesByHostKey, byKey: identitiesByKey } = useIdentities();
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

  // Patch #144 Fix (d): every selectedId change enrolls the id in the
  // active set — not just click-driven selection via handleRowSelect.
  // URL-fragment restore, keyboard nav, and any other programmatic path
  // that mutates selectedId now lights the row up with the full pretty-
  // view bubble treatment instead of the ambient flat treatment. user's
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
  //       L540-547. Depends on [fleetSessionsLoaded, identitiesByKey] so the
  //       body reruns when the fleet loads AND every time identities grows —
  //       idempotent per the sink-side additive-on-empty guards in
  //       hydratePinnedIdsFromServer.
  //       (Phase 115 Plan 115-02: prior sibling hydrateHiddenIdsFromServer
  //        gate retired per D-21 alongside the deriveDiskHiddenIds call.)
  useEffect(() => {
    if (!fleetSessionsLoaded) return;
    // 2026-09-17: gate loosened from `identitiesLoaded` (the slow /identities
    // fetch flip) to `identitiesByKey.size > 0` (any identity data present).
    // The pulse populates identities-store with pinned/hidden well before
    // /identities returns; waiting on identitiesLoaded added ~7-8s of
    // pin/hide-out-of-place time after the row-set already dressed. The
    // quick-260912-5q2 protection (empty derivation MUST NOT wipe pinnedIds)
    // is enforced at THIS callsite via the `if (pinnedIds.length > 0)` skip
    // in the async IIFE below — a partial store may derive [], and skipping
    // preserves whatever's already in state.pinnedIds until identities is
    // complete. Legitimate "user unpinned via disk" wipes still land via
    // identities-store's reprojectDiskPinHideIntoRows path, which is gated on
    // state.loaded (authoritative) and is trusted to project [] as real.
    if (identitiesByKey.size === 0) return;
    // hydratedRef retired 2026-09-17. The effect is idempotent — the empty-
    // projection skip in the IIFE below plus the sink's same-content guard
    // together ensure re-firing as identities grow does no wrong work.
    // Keeping the ref would re-introduce the "one shot, wrong moment"
    // failure mode this change exists to remove.
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
      // Empty-projection skip (2026-09-17, replaces the retired
      // identitiesLoaded gate): this effect fires eagerly as identities grow
      // — an empty projection from a partial store is indistinguishable from
      // a real "nothing pinned" answer, and the sink hydrate function is
      // authoritative (would wipe on empty). Skip empty here; a subsequent
      // fire once identities are complete will project the real set.
      // Legitimate "user unpinned via disk" transitions still land via
      // identities-store's reprojectDiskPinHideIntoRows, which is gated on
      // state.loaded (authoritative) and does trust empty projections.
      if (pinnedIds.length > 0) {
        hydratePinnedIdsFromServer(pinnedIds);
      }

      // (Phase 115 Plan 115-02: sibling `.hidden` hydrate block retired per
      //  D-21 — the deriveDiskHiddenIds projection + hydrateHiddenIdsFromServer
      //  call are gone alongside the backend `.hidden` fanout removal.)
    })();
    return () => {
      cancelled = true;
    };
  }, [fleetSessionsLoaded, identitiesByKey]);

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
  // Phase 122 Plan 03 Task 3 — ConversationSearchModal open/closed toggle.
  // Opened via the new magnifying-glass button in the header cluster
  // (first child of .pv-header-actions below). Query + accumulated results
  // live in the module-scoped search-store, NOT in this useState — this
  // flag is only whether the modal is currently mounted-open (D-05
  // persistence uses the store, this useState is the visibility gate).
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  // Phase 44 SKILLED-01: SkillsEditorModal open/closed toggle (opened from menu item, sibling of GlobalFilesModal).
  const [skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false);
  // EnableNotificationsModal open/closed toggle (opened from kebab menu item).
  // Feature-detected — menu item only renders when Web Push is supported.
  const [enableNotificationsModalOpen, setEnableNotificationsModalOpen] =
    useState(false);
  const notificationsSupported = pushNotificationsSupported();
  // Phase 91 Plan 05 — NewConversationModal open/closed toggle (opened from
  // menu's "New conversation" item — v1 throwaway placement per shape §Philosophy).
  const [newConversationModalOpen, setNewConversationModalOpen] = useState(false);
  // Phase 117 Plan 117-09 Task 2 (D-27) — pre-select a project slug when
  // the per-section SquarePen new-conversation button opens the modal. The
  // freshly-minted room's account_data gets a u.project.<slug> tag via a
  // follow-up setRelayRoomProject call inside the modal.
  const [newConversationPreSelectedProject, setNewConversationPreSelectedProject] =
    useState<string | null>(null);
  // Phase 117 M-F follow-up (2026-09-18): the per-project SquarePen new-conv
  // button opens the NEW-AGENT dialog (was: NewConversationModal for relay
  // rooms) with a pending project slug that gets applied to the freshly-
  // minted identity via setSessionProject after onCreate resolves. Same
  // pattern as newConversationPreSelectedProject but for the identity path.
  const [newSessionPendingProjectSlug, setNewSessionPendingProjectSlug] =
    useState<string | null>(null);
  // Phase 117 M-I follow-up (2026-09-19): also stash the project's hostId
  // so the NewSessionDialog mount can pass a filtered single-host hostTree
  // — the picker auto-hides in project context because the destination
  // host is implied (projects live on a specific host; agents-in-project
  // must be born on the same host to appear under the section).
  const [newSessionPendingProjectHostId, setNewSessionPendingProjectHostId] =
    useState<number | null>(null);
  // Phase 90 Plan 90-06 (D-07): RolesListModal open/closed toggle. Opened by the
  // three-dots menu "Edit roles…" entry (which replaces the deleted "New role"
  // entry). See <RolesListModal> mount below.
  const [rolesListModalOpen, setRolesListModalOpen] = useState(false);
  // Phase 129 (shape 3, wake-ups-redesign) Plan 129-01 Task 4 — controlled
  // open state for the new WakeupsModal. Opened via the AlarmClock button
  // in .pv-header-actions below (inserted after the Edit-global-files
  // Globe, before the feedback + kebab buttons). No preserved query
  // state — modal refetches every open (D-03) and resets filter state on
  // close (D-17). Sibling of ConversationSearchModal's controlled state.
  const [wakeupsModalOpen, setWakeupsModalOpen] = useState(false);
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

  // Phase 119 Plan 04 (D-03): Apps section collapsed by default on every
  // mount. Content is lazy-rendered via `{appsExpanded && ...}` in the JSX
  // block (D-03 invariant: NO CSS `hidden` class, NO aria-only approach —
  // content is not in the DOM at all until the user expands).
  //
  // Phase 119 Plan 04 (D-14 pass-through): `useAppTiles()` subscribes to the
  // module-scoped app-tiles-store (Plan 119-02). Every frame notify from the
  // fleet-status client (Plan 119-01 switch → Plan 119-02 publish fn) re-runs
  // the memoised selector and yields a stable-sorted (D-15) array. Panel
  // performs zero re-filtering / re-sorting — backend `app-frame-filter.ts`
  // is the sole authority for host visibility per D-14 + Phase 118 D-15.
  const [appsExpanded, setAppsExpanded] = useState(false);
  const appTiles = useAppTiles();

  // Phase 122 Plan 04 (D-17 removal): the old label-only `searchQuery` state,
  // `searchContainerRef` + `scrollContainerRef` refs, and the one-shot cold-
  // load scroll-hide useEffect (all Phase 41 Plan 02) are retired together
  // with the inline filter-as-you-type input the modal (Phase 122 Plan 03)
  // replaced. Search is now driven by ConversationSearchModal mounted below,
  // opened via the pv-header-search-button in the header-actions cluster.

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
  // Ready filter (Phase 52) survives as dead code — its UI entry point (the
  // Filter popover) was removed in quick-260914-liu. The state and predicate
  // machinery is retained intentionally (the operator's explicit decision: not worth
  // the render-path refactor risk to clean up). The filter flag is permanently
  // false, so displayedPinned / displayedMiddle pass rows through unfiltered.
  const [readyOnly, setReadyOnly] = useState(false);
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
  //     downstream renderer skips the entire section (user lock #7).
  //   - The former `displayedActiveSetRows` (D-06 exemption) is retired
  //     alongside the Tier 1 activeSet render tier; `activeSetRows` in the
  //     destructure is now always an empty array from the store snapshot.
  //
  // (Phase 115 Plan 115-02: prior visible-vs-hidden partition retired per
  //  D-21 — every row in the pinned/middle tiers is unconditionally visible
  //  now. 115-06 will re-introduce an archived partition sourced from the
  //  sweep's archived-tree, not from a hiddenIds set.)
  // Phase 117 Plan 117-08 (D-09, D-19): the pinned tier now renders
  // `pinnedUnassigned` (pinned rows with NO project assignment). Pinned rows
  // that DO have a project assignment float to the top of their project
  // section per D-19 — they're already inside projectSections[i].rows[0..].
  // Pre-Phase-117 tests that never seed projectSections see
  // pinnedUnassigned === pinned (identical arrays via the store's derived
  // selector) so the switch is a no-op for them.
  const displayedPinned = anyFilterOn
    ? pinnedUnassigned.filter(matchesFilterForRow)
    : pinnedUnassigned;
  const displayedMiddle = anyFilterOn
    ? middle.filter(matchesFilterForRow)
    : middle;
  const displayedRdpGroup = rdpGroup;
  // Phase 117 Plan 117-08: filter each project section's rows through the
  // bounty-count filter when active. Sections stay in the derived selector's
  // alphabetical order (D-15) regardless of filter state — empty sections
  // continue to render as header-only per D-11.
  const displayedProjectSections = anyFilterOn
    ? projectSections.map((s) => ({
        slug: s.slug,
        displayName: s.displayName,
        rows: s.rows.filter(matchesFilterForRow),
      }))
    : projectSections;

  // (Phase 115 Plan 115-02: prior `hiddenRows` accumulator retired per D-21
  //  alongside the Hidden section render block. Phase 115 Plan 115-06's
  //  `archivedRows` counterpart retired in the Phase 122 shape follow-up;
  //  archived identities surface via the ConversationSearchModal.)

  // Current-render row lookup for the idle-deactivate sweep below, which
  // resolves an active-set id back to a row object.
  const rowsByIdRef = useRef(new Map<string, ConversationRowShape>());
  const rowsById = useMemo(() => {
    const out = new Map<string, ConversationRowShape>();
    for (const r of activeSetRows) out.set(r.id, r);
    for (const r of pinned) out.set(r.id, r);
    for (const r of middle) out.set(r.id, r);
    if (rdpGroup !== null) {
      for (const r of rdpGroup.rows) out.set(r.id, r);
    }
    return out;
  }, [activeSetRows, pinned, middle, rdpGroup]);
  rowsByIdRef.current = rowsById;

  // Phase 122 Plan 04 (D-17 removal): the Phase 41 Plan 02 `matchesSearch`
  // label-only filter predicate + the `trimmedSearchQuery` / `searchMatches`
  // useMemo were retired together with the inline filter-as-you-type input.
  // Content-search across active + archived conversations is now performed by
  // ConversationSearchModal (Phase 122 Plan 03) via POST /conversation-search.
  // The three-zone view (pinned / middle / rdpGroup / activeSet) below now
  // renders unconditionally — the `searchMatches !== null` branch is gone.

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
    // (Phase 115 Plan 115-02: prior "hidden means hidden" click note retired
    //  per D-21 alongside the Hide affordance. Once 115-06 lands the Archive
    //  affordance, an archived row won't have a context menu at all (D-06),
    //  so the click path doesn't need special handling for it.)
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
  // the AppShell splitTree. user's user-focus signal is "I have this
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
  // a session user was looking at moments ago.
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
  // resolve the row via the current-render `rowsByIdRef` and call
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
        // session user can see on-screen violates the sweep's
        // user-focus contract.
        if (currentVisibleInSplitTree.has(id)) continue;
        const stamp = lastUnfocusedAtRef.current.get(id);
        if (stamp === undefined) continue; // never focused-then-unfocused in this tab
        if (now - stamp < IDLE_DEACTIVATE_THRESHOLD_MS) continue;
        const row = rowsByIdRef.current.get(id);
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
    // (Phase 115 Plan 115-02: prior "unhide-before-pin" side effect retired
    //  per D-21 alongside the Hide affordance. Once 115-06 lands the Archive
    //  affordance, pinning an archived row is out of scope — archived rows
    //  render inert per D-06 without a Pin/Unpin item.)
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

  // (Phase 115 Plan 115-02: prior `handleToggleHide` handler retired per
  //  D-21 alongside the Hide/Show context-menu item on both the sidebar row
  //  and the identity badge.)
  //
  // Phase 115 Plan 115-06 (D-01, D-03, D-04, D-05): handleArchive — the
  // panel-level composition invoked by the row menu's Archive item.
  // Sequence:
  //   1. Gate on canonicalArchiveIdForRow — the same fleet-synthetic-
  //      identity-backed gate the deleted Hide handler used (RDP synthetic
  //      rows, relay-room rows, and rows without host + targetTmuxSession
  //      are excluded — the row-side menu builder never even shows the item
  //      for those cases, but the guard is defense-in-depth).
  //   2. window.confirm with EXACT copy `archive <displayName>? this can't
  //      be undone.` (D-03 user-locked verbatim). The displayName is the
  //      identity's `displayName` (mirrors the row's own label field per
  //      115-06 plan-check refinement — Test 8 asserts exact-string equality
  //      with a fixture identity name `wren`). If the identity is not yet
  //      resolved on the frontend, fall back to the identity key from the
  //      row's targetTmuxSession (safe default — the sentinel drop still
  //      succeeds regardless of the confirmation copy).
  //   3. If confirm=false → return immediately, no API call, no pane close.
  //   4. If confirm=true → D-04 side effect: if the row is in the active-set
  //      (identity has a visible pane), call handleRowDeactivate(row) to
  //      close the pane BEFORE firing the API call. This mirrors the deleted
  //      handleToggleHide's `handleRowDeactivate` composition.
  //   5. Fire-and-forget archiveIdentity(hostId, identityKey). Errors go to
  //      console — no toast infrastructure at the panel level today; the
  //      row disappears from the live list once the sentinel scan tick fires
  //      supervisor's retire flow, so the user sees success visually.
  //
  // D-05 lock: no un-archive branch. One-way gesture.
  const handleArchive = (row: ConversationRowShape) => {
    if (canonicalArchiveIdForRow(row) === null) return;
    if (!row.host || !row.targetTmuxSession) return; // gate above already ensures this; TS narrowing
    const hostIdNum = parseInt(row.host.id, 10);
    if (!Number.isFinite(hostIdNum)) return;
    const identityKey = row.targetTmuxSession;
    // Prefer the resolved identity's displayName so the confirmation reads
    // consistent with the row's label (same field the row's header line
    // renders). Fall back to the identity key if the identity hasn't yet
    // resolved (fleet-status enrichment race — no drift from displayName in
    // steady state because the row itself falls back the same way).
    const resolved =
      (Number.isFinite(hostIdNum)
        ? identitiesByHostKey?.get(`${hostIdNum}::${identityKey}`)
        : undefined) ?? identitiesByKey.get(identityKey);
    const displayName = resolved?.displayName ?? identityKey;
    // D-03 EXACT COPY — do NOT wrap displayName in backticks or quotes in
    // the actual string; the CONTEXT.md formatting uses backticks as
    // MARKDOWN emphasis around the <identity> placeholder, not as literal
    // characters in the dialog. Test 8 asserts byte-identical equality
    // against `archive wren? this can't be undone.` with fixture `wren`.
    // Apostrophe is a straight ASCII apostrophe (U+0027), not a curly one.
    if (!window.confirm(`archive ${displayName}? this can't be undone.`)) return;
    if (activeSet.has(row.id)) {
      handleRowDeactivate(row);
    }
    void archiveIdentity(hostIdNum, identityKey).catch((err) => {
      console.warn({
        operation: "identity_archive_failed",
        hostId: hostIdNum,
        identityKey,
        errMessage: err instanceof Error ? err.message : String(err),
      });
    });
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

  // ─── Phase 117 Plan 117-08 — projects DnD + create-project state ─────────────
  //
  // (a) createProjectModalOpen — state toggle wired to the header "Create
  //     project" button. The actual CreateProjectModal component lands in
  //     117-09; this plan only mounts a placeholder marker so downstream
  //     tests + integration can verify the state flip. The placeholder gets
  //     swapped for the real modal at 117-09's task-2 render insertion site.
  //
  // (b) pendingProjectSlug — set by handleNewConversationInProject when the
  //     per-section new-conversation button fires. The 117-09 modal reads
  //     this to pre-select the project in its dropdown. Cleared on close.
  //
  // (c) rowIdToProjectSlug — lookup table for the D-22 gesture #2 (drop-in-
  //     middle clears). Built from the derived selector's projectSections so
  //     the panel can answer "is this row currently assigned to a project?"
  //     without a second store subscription. O(N) construction, O(1) lookup.
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [pendingProjectSlug, setPendingProjectSlug] = useState<string | null>(null);

  // Phase 117 Plan 117-09 Task 2 (D-14) — per-section context menu state.
  // Populated on right-click of a section header (or long-press on mobile);
  // menu shows "Edit project file" + "Archive project" items per D-14. Reset
  // on menu item click / outside click / Escape.
  const [projectContextMenu, setProjectContextMenu] = useState<
    | { x: number; y: number; slug: string; displayName: string }
    | null
  >(null);

  // Phase 117 followup — ProjectFileModal open state. Populated when the user
  // clicks "Edit project file" in the section context menu (handleEditProject
  // File below); reset when the modal dismisses. hostId is resolved from
  // projectsList at click time so the modal endpoints hit the correct host.
  const [projectFileModal, setProjectFileModal] = useState<
    | { slug: string; displayName: string; hostId: number }
    | null
  >(null);

  // Phase 117 M-G follow-up (2026-09-18): CreateProjectModal now takes the
  // full hostTree and owns its own host picker (Phase-84 pattern — hidden
  // when the user has exactly one pickable host, visible listbox otherwise).
  // The previous defaultCreateProjectHostId derivation (silently picked the
  // first host in the tree) was retired because on multi-host fleets it
  // routinely picked the wrong host (thenasty, hostId=3) when the user
  // meant the local host — the user creates a project without noticing
  // where it landed. The picker moves the choice into the UI.

  // Row-id → project-slug lookup (derived from projectSections). Used by
  // handleFlatMiddleDrop to answer "was this row assigned to a project?".
  const rowIdToProjectSlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const section of projectSections) {
      for (const row of section.rows) m.set(row.id, section.slug);
    }
    return m;
  }, [projectSections]);

  // (d) handleProjectDrop — fired by PrettyProjectSectionHeader's onDropRow.
  //     The section-level component has already:
  //       - type-gated on application/x-skynet-row
  //       - parsed the payload safely
  //       - validated `id` is a non-empty string
  //       - refused rdpHostRow=true payloads (D-08 defense-in-depth)
  //     The panel handler routes based on row kind:
  //       - matrixRoomId set → relay-room row → setRelayRoomProject
  //         (requires viewingUserMxid — if not yet resolved, log + skip)
  //       - identityKey + host set → identity row → setSessionProject
  //       - neither → console.warn + no-op (defensive; the derived selector
  //         should never emit a row shape that misses both carriers)
  //
  // (e) handleFlatMiddleDrop — fired on the flat-middle container's onDrop.
  //     Type-gated on application/x-skynet-row so badge drags + OS file drops
  //     fall through (they're handled elsewhere in the panel). Clears the
  //     project field only if the row IS currently in a project (per
  //     rowIdToProjectSlug lookup). Non-project rows are no-ops.
  //
  // (f) handleNewConversationInProject — records the pending slug + opens
  //     the modal. Full pre-fill behavior lands in 117-09 (modal reads
  //     pendingProjectSlug to pre-select the project in its dropdown).
  const handleProjectDrop = useCallback(
    (
      slug: string,
      payload: {
        id: string;
        host?: { id: string } | null;
        targetTmuxSession?: string | null;
        matrixRoomId?: string | null;
        rdpHostRow?: boolean;
        identityKey?: string | null;
      },
    ) => {
      // Defense-in-depth: RDP short-circuit (also handled at section-level).
      if (payload.rdpHostRow === true) return;
      // Relay-room path — matrixRoomId is the carrier.
      if (typeof payload.matrixRoomId === "string" && payload.matrixRoomId.length > 0) {
        if (!viewingUserMxid) {
          // viewing-user mxid not yet resolved — skip rather than fire with a
          // placeholder. The user will see the row stay in place; a fresh
          // drop after the mxid fetch settles will succeed.
          console.warn(`[project-drop] skipping relay-room drop — viewing user mxid not yet resolved (roomId=${payload.matrixRoomId})`);
          return;
        }
        console.info(`[project-drop] slug=${slug} kind=relay-room roomId=${payload.matrixRoomId}`);
        setRelayRoomProject(payload.matrixRoomId, viewingUserMxid, slug).catch(
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[project-drop] setRelayRoomProject failed: ${msg}`);
          },
        );
        return;
      }
      // Identity path — need host + identityKey. Fall back to
      // targetTmuxSession when identityKey isn't in the payload (older
      // clients pre-117-08 didn't carry identityKey; sessionMatchKey is the
      // canonical identity-name derivation).
      if (!payload.host || typeof payload.host.id !== "string") return;
      const hostIdNum = parseInt(payload.host.id, 10);
      if (!Number.isFinite(hostIdNum) || hostIdNum <= 0) return;
      const identityKey =
        payload.identityKey ??
        (payload.targetTmuxSession
          ? sessionMatchKey(payload.targetTmuxSession) ?? payload.targetTmuxSession
          : null);
      if (!identityKey) {
        console.warn(`[project-drop] identity row missing identityKey (rowId=${payload.id})`);
        return;
      }
      console.info(`[project-drop] slug=${slug} kind=identity hostId=${hostIdNum} key=${identityKey}`);
      setSessionProject(hostIdNum, identityKey, slug).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[project-drop] setSessionProject failed: ${msg}`);
      });
    },
    [viewingUserMxid],
  );

  // shape-move-to-project-context-menu (2026-09-23): sidebar-order project
  // list piped into every non-RDP row's "Move to project" submenu. Same
  // ordering the sidebar renders its project sections in (projectSections
  // is the authoritative order from the derived selector) — the menu's
  // mental map matches the sidebar's. Displayed even for the currently-
  // assigned project (checkmarked in place), so the ordering does not
  // change based on which row opened the menu.
  //
  // hostId is carried alongside slug/displayName here so the per-row
  // narrowing below (submenuProjectsForRow) can filter identity rows to
  // projects that live on that row's host. Sourced from projectsList
  // (ProjectRow carries hostId; projectSections does not).
  const submenuProjects = useMemo(() => {
    const hostBySlug = new Map<string, string>();
    for (const p of projectsList) hostBySlug.set(p.slug, p.hostId);
    return projectSections.map((s) => ({
      slug: s.slug,
      displayName: s.displayName,
      hostId: hostBySlug.get(s.slug) ?? null,
    }));
  }, [projectSections, projectsList]);

  // Per-row narrowing for the "Move to project" submenu.
  //
  // Identity rows are host-scoped: projects live under the identity's
  // host's ~/fleet/projects/ tree (D-01), and setSessionProject writes
  // to that host's identity file. Offering a cross-host project would
  // fire setSessionProject(row.host.id, key, slug-that-lives-on-another-
  // host) which the writer can't satisfy — the project directory doesn't
  // exist on the row's host. Filter to matching hostId so the menu can't
  // list options the wire would then bounce.
  //
  // Relay-room rows are cross-host by design (the setRelayRoomProject
  // payload is {roomId, userMxid, slug} with no hostId; the room-project
  // tag is per-user, not per-host). No natural host key to filter on —
  // return the full list.
  //
  // hostId=null entries (project not yet in projectsList — race window
  // between projectSections update and useProjects snapshot bump) are
  // conservatively hidden from identity rows to avoid a wire call whose
  // routing we can't verify.
  const submenuProjectsForRow = useCallback(
    (
      row: ConversationRowShape,
    ): readonly { slug: string; displayName: string }[] => {
      if (typeof row.roomId === "string" && row.roomId.length > 0) {
        return submenuProjects.map(({ slug, displayName }) => ({
          slug,
          displayName,
        }));
      }
      const rowHostId = row.host?.id;
      if (!rowHostId) return [];
      return submenuProjects
        .filter((p) => p.hostId === rowHostId)
        .map(({ slug, displayName }) => ({ slug, displayName }));
    },
    [submenuProjects],
  );

  // shape-move-to-project-context-menu (2026-09-23): context-menu path for
  // setting a row's project assignment. Mirrors handleProjectDrop's routing
  // (relay-room vs identity; RDP refusal; identityKey fallback via
  // sessionMatchKey) but also accepts a null slug for the "Remove from
  // project" leaf. Same-project taps arrive here filtered out — the row
  // pre-guards the currently-assigned project as a silent no-op before
  // firing the callback (see PrettyConversationRow.tsx items[] gate).
  const handleRowMoveToProject = useCallback(
    (row: ConversationRowShape, slug: string | null) => {
      if (row.rdpHostRow === true) return; // defense-in-depth
      // Relay-room path — roomId is the carrier (matches DnD payload's
      // `matrixRoomId` field).
      const roomId = row.roomId;
      if (typeof roomId === "string" && roomId.length > 0) {
        if (!viewingUserMxid) {
          console.warn(
            `[project-menu] skipping relay-room move — viewing user mxid not yet resolved (roomId=${roomId})`,
          );
          return;
        }
        console.info(
          `[project-menu] slug=${slug ?? "(null)"} kind=relay-room roomId=${roomId}`,
        );
        setRelayRoomProject(roomId, viewingUserMxid, slug).catch(
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[project-menu] setRelayRoomProject failed: ${msg}`);
          },
        );
        return;
      }
      // Identity path — need host + identityKey. identityKey resolution
      // prefers the identities-store lookup (real identityKey from the
      // Identity object) and falls back to sessionMatchKey(targetTmuxSession)
      // ?? targetTmuxSession, matching handleProjectDrop / handleFlatMiddleDrop
      // when their DnD payload didn't carry a real identityKey.
      if (!row.host) return;
      const hostIdNum = parseInt(row.host.id, 10);
      if (!Number.isFinite(hostIdNum) || hostIdNum <= 0) return;
      const sessionKey =
        (row.targetTmuxSession
          ? sessionMatchKey(row.targetTmuxSession) ?? row.targetTmuxSession
          : null) ?? null;
      const scopedId =
        sessionKey !== null
          ? identitiesByHostKey.get(`${hostIdNum}::${sessionKey}`)
          : undefined;
      const globalId =
        sessionKey !== null ? identitiesByKey.get(sessionKey) : undefined;
      const identityKey =
        scopedId?.identityKey ?? globalId?.identityKey ?? sessionKey;
      if (!identityKey) {
        console.warn(
          `[project-menu] identity row missing identityKey (rowId=${row.id})`,
        );
        return;
      }
      console.info(
        `[project-menu] slug=${slug ?? "(null)"} kind=identity hostId=${hostIdNum} key=${identityKey}`,
      );
      setSessionProject(hostIdNum, identityKey, slug).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[project-menu] setSessionProject failed: ${msg}`);
      });
    },
    [viewingUserMxid, identitiesByHostKey, identitiesByKey],
  );

  // Returns the row-scoped onMoveToProject callback, or undefined to hide
  // the "Move to project" affordance entirely (RDP row OR zero projects
  // ON THIS ROW'S HOST — both are hide-not-grey per shape). Called at
  // each row render site. Zero-projects check uses submenuProjectsForRow
  // so an identity on a host with no local projects hides the item even
  // when other hosts have projects.
  const rowMoveToProjectCallback = useCallback(
    (row: ConversationRowShape): ((slug: string | null) => void) | undefined => {
      if (row.rdpHostRow === true) return undefined;
      if (submenuProjectsForRow(row).length === 0) return undefined;
      return (slug: string | null) => handleRowMoveToProject(row, slug);
    },
    [submenuProjectsForRow, handleRowMoveToProject],
  );

  const [isFlatMiddleDragOver, setIsFlatMiddleDragOver] = useState(false);

  useEffect(() => {
    const onDragEnd = () => setIsFlatMiddleDragOver(false);
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, []);

  const handleFlatMiddleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const types = e.dataTransfer?.types;
      if (!(types && Array.from(types).includes("application/x-skynet-row"))) return;
      e.preventDefault();
      // Do NOT stopPropagation — the outer panel handler's badge drag machinery
      // relies on unrelated MIMEs falling through, and the row MIME never
      // reaches the outer handler because its badge type-gate rejects it.
      setIsFlatMiddleDragOver(true);
    },
    [],
  );

  const handleFlatMiddleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const types = e.dataTransfer?.types;
      if (!(types && Array.from(types).includes("application/x-skynet-row"))) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const stillInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (stillInside) return;
      setIsFlatMiddleDragOver(false);
    },
    [],
  );

  const handleFlatMiddleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsFlatMiddleDragOver(false);
      const raw = e.dataTransfer?.getData("application/x-skynet-row") ?? "";
      if (raw === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object") return;
      const p = parsed as {
        id?: string;
        host?: { id: string } | null;
        targetTmuxSession?: string | null;
        matrixRoomId?: string | null;
        rdpHostRow?: boolean;
        identityKey?: string | null;
      };
      if (typeof p.id !== "string" || p.id.length === 0) return;
      if (p.rdpHostRow === true) return; // D-08 defense
      // Drop on Other = "neither pinned nor in a project". Two actions may
      // fire; either is optional but at least one must apply or this is a
      // no-op (fall through so outer badge machinery can still catch other
      // MIMEs). Order: unpin first (pure store write, no async), then clear
      // project (network round-trip).
      const currentSlug = rowIdToProjectSlug.get(p.id);
      const inProject = currentSlug !== undefined;
      const shadowFleetId =
        p.host && typeof p.host.id === "string" && p.targetTmuxSession
          ? fleetRowId(parseInt(p.host.id, 10), p.targetTmuxSession)
          : null;
      const openTabPinned = pinnedIds.has(p.id);
      const shadowPinned = shadowFleetId !== null && pinnedIds.has(shadowFleetId);
      const isPinned = openTabPinned || shadowPinned;
      if (!inProject && !isPinned) return; // no-op — nothing to change
      e.preventDefault();
      e.stopPropagation();
      if (isPinned) {
        console.info(`[pin-drop] unpin from Other id=${p.id} openTab=${openTabPinned} shadow=${shadowPinned}`);
        if (openTabPinned) unpinConversation(p.id);
        if (shadowPinned && shadowFleetId !== null) unpinConversation(shadowFleetId);
      }
      if (!inProject) return;
      // Route the clear the same way handleProjectDrop routes an assign,
      // but with slug=null.
      if (typeof p.matrixRoomId === "string" && p.matrixRoomId.length > 0) {
        if (!viewingUserMxid) {
          console.warn(`[project-drop] skipping clear — viewing user mxid not yet resolved`);
          return;
        }
        console.info(`[project-drop] clear kind=relay-room roomId=${p.matrixRoomId}`);
        setRelayRoomProject(p.matrixRoomId, viewingUserMxid, null).catch(
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[project-drop] setRelayRoomProject(null) failed: ${msg}`);
          },
        );
        return;
      }
      if (!p.host || typeof p.host.id !== "string") return;
      const hostIdNum = parseInt(p.host.id, 10);
      if (!Number.isFinite(hostIdNum) || hostIdNum <= 0) return;
      const identityKey =
        p.identityKey ??
        (p.targetTmuxSession
          ? sessionMatchKey(p.targetTmuxSession) ?? p.targetTmuxSession
          : null);
      if (!identityKey) return;
      console.info(`[project-drop] clear kind=identity hostId=${hostIdNum} key=${identityKey}`);
      setSessionProject(hostIdNum, identityKey, null).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[project-drop] setSessionProject(null) failed: ${msg}`);
      });
    },
    [rowIdToProjectSlug, viewingUserMxid, pinnedIds],
  );

  // Pinned-zone drop lane — mirror of the flat-middle machinery. Drop a row
  // onto the Pinned wrapper to pin it (if not already pinned). Uses the same
  // dual-shape write pattern as handleTogglePin: prefer the fleet-synthetic
  // shadow id when host+targetTmuxSession are available so the pin survives
  // openTab id churn across URL-restores.
  const [isPinnedZoneDragOver, setIsPinnedZoneDragOver] = useState(false);

  useEffect(() => {
    const onDragEnd = () => setIsPinnedZoneDragOver(false);
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, []);

  const handlePinnedZoneDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const types = e.dataTransfer?.types;
      if (!(types && Array.from(types).includes("application/x-skynet-row"))) return;
      e.preventDefault();
      setIsPinnedZoneDragOver(true);
    },
    [],
  );

  const handlePinnedZoneDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const types = e.dataTransfer?.types;
      if (!(types && Array.from(types).includes("application/x-skynet-row"))) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const stillInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (stillInside) return;
      setIsPinnedZoneDragOver(false);
    },
    [],
  );

  const handlePinnedZoneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsPinnedZoneDragOver(false);
      const raw = e.dataTransfer?.getData("application/x-skynet-row") ?? "";
      if (raw === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object") return;
      const p = parsed as {
        id?: string;
        host?: { id: string } | null;
        targetTmuxSession?: string | null;
        rdpHostRow?: boolean;
      };
      if (typeof p.id !== "string" || p.id.length === 0) return;
      if (p.rdpHostRow === true) return; // D-08 defense
      const shadowFleetId =
        p.host && typeof p.host.id === "string" && p.targetTmuxSession
          ? fleetRowId(parseInt(p.host.id, 10), p.targetTmuxSession)
          : null;
      const openTabPinned = pinnedIds.has(p.id);
      const shadowPinned = shadowFleetId !== null && pinnedIds.has(shadowFleetId);
      if (openTabPinned || shadowPinned) return; // already pinned — no-op
      e.preventDefault();
      e.stopPropagation();
      const targetId = shadowFleetId ?? p.id;
      console.info(`[pin-drop] pin id=${targetId} (from rowId=${p.id})`);
      pinConversation(targetId);
    },
    [pinnedIds],
  );

  // Phase 117 M-F follow-up (2026-09-18): the section's SquarePen opens the
  // NEW-AGENT dialog (NewSessionDialog) with a pending project slug. After
  // the identity is born, the NewSessionDialog's onCreate wrapper below
  // fires setSessionProject(host, identityKey, slug) as a fire-and-forget
  // call so the newborn identity's frontmatter carries `project:` from the
  // first sweep tick. Was: opened NewConversationModal (relay-room path) —
  // that flow rejected by the user 2026-09-18 in favor of "new agent mode".
  //
  // Phase 117 M-I follow-up (2026-09-19): also stash the project's hostId
  // so the dialog renders with a single-host tree (picker auto-hides).
  const handleNewConversationInProject = useCallback(
    (slug: string) => {
      setNewSessionPendingProjectSlug(slug);
      // Resolve the project's home host (projects live per-host; the newborn
      // agent must be born on the SAME host to appear under the section).
      const proj = projectsList.find((p) => p.slug === slug);
      const projHostIdNum = proj ? parseInt(proj.hostId, 10) : NaN;
      setNewSessionPendingProjectHostId(
        Number.isFinite(projHostIdNum) && projHostIdNum > 0
          ? projHostIdNum
          : null,
      );
      setNewSessionDialogOpen(true);
    },
    [projectsList],
  );

  // Phase 117 Plan 117-09 Task 2 (D-28, D-29, D-30 + Fix 3) — archive
  // project cascade. Sequence per Fix 3 revision:
  //   1. Prompt user with the verbatim D-29 warning.
  //   2. On confirm=true, run ONE Promise.allSettled batch that includes
  //      BOTH identity-archive calls (archiveIdentity per identity member)
  //      AND relay-room tag-clear calls (setRelayRoomProject(null) per
  //      relay-room member). Not two sequential Promise.alls — Fix 3
  //      requires the members share a single wait boundary so the double-
  //      wait cost isn't visible on typical projects.
  //   3. Log partial failures via console.error but do NOT roll back
  //      (Phase 115 semantics — one-way archive).
  //   4. After the batch settles, fire archiveProject(hostId, slug) to
  //      move the directory to ~/fleet/projects/archive/<slug>/.
  //
  // RDP rows are defense-in-depth guarded (D-08) — the derived selector
  // should never emit them into a project section, but the filter here is
  // a safety net.
  const handleArchiveProject = useCallback(
    async (slug: string) => {
      // 1. Collect member rows from the derived selector snapshot.
      const section = projectSections.find((s) => s.slug === slug);
      const members = section?.rows ?? [];
      // 2. Verbatim D-29 warning.
      const proceed = window.confirm(
        "About to archive this project AND all conversations inside it. Drag conversations out first if you want to keep any active.",
      );
      if (!proceed) return;
      // 3. Partition members into identity + relay-room lanes.
      const nonRdpMembers = members.filter((r) => r.rdpHostRow !== true);
      const identityMembers = nonRdpMembers.filter(
        (r) => !(r as { matrixRoomId?: string | null; roomId?: string | null }).matrixRoomId &&
          !(r as { roomId?: string | null }).roomId,
      );
      const relayRoomMembers = nonRdpMembers.filter(
        (r) => !!(r as { matrixRoomId?: string | null; roomId?: string | null }).matrixRoomId ||
          !!(r as { roomId?: string | null }).roomId,
      );
      // 4. Build the single-batch Promise.allSettled ops. Identity members
      //    call archiveIdentity(hostId, identityKey); relay-room members
      //    call setRelayRoomProject(roomId, mxid, null) (Fix 3 — tag clear
      //    instead of Matrix-room deactivate; the room itself survives).
      const ops: Promise<unknown>[] = [];
      const hostForRow = (
        row: { host?: { id: string } | null; targetTmuxSession?: string | null },
      ) => {
        if (!row.host || typeof row.host.id !== "string") return null;
        const n = parseInt(row.host.id, 10);
        if (!Number.isFinite(n) || n <= 0) return null;
        const key = row.targetTmuxSession
          ? sessionMatchKey(row.targetTmuxSession) ?? row.targetTmuxSession
          : null;
        if (!key) return null;
        return { hostId: n, identityKey: key };
      };
      for (const r of identityMembers) {
        const parsed = hostForRow(r);
        if (!parsed) continue;
        ops.push(archiveIdentity(parsed.hostId, parsed.identityKey));
      }
      // relay-room tag-clear ops require the viewing user's mxid (D-05a).
      if (relayRoomMembers.length > 0) {
        if (!viewingUserMxid) {
          console.warn({
            operation: "archive_project_relay_members_skipped_no_mxid",
            slug,
            relayRoomMemberCount: relayRoomMembers.length,
          });
        } else {
          for (const r of relayRoomMembers) {
            const roomId =
              (r as { matrixRoomId?: string | null }).matrixRoomId ??
              (r as { roomId?: string | null }).roomId ??
              null;
            if (typeof roomId !== "string" || roomId.length === 0) continue;
            // Fix 3 gate: setRelayRoomProject(roomId, mxid, null) is the
            // canonical tag-clear call. The literal `null` third arg is
            // asserted by the acceptance grep on this file.
            ops.push(setRelayRoomProject(roomId, viewingUserMxid, null));
          }
        }
      }
      // 5. Await the single batch.
      const results = await Promise.allSettled(ops);
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.error({
          operation: "archive_project_partial_member_failures",
          slug,
          failureCount: failures.length,
          totalOps: ops.length,
          failures: failures.map((f) =>
            f.status === "rejected"
              ? f.reason instanceof Error
                ? f.reason.message
                : String(f.reason)
              : "",
          ),
        });
      }
      // 6. Folder-move regardless of partial failures. hostId comes from
      //    the project's own hostId (D-01: projects live under a specific
      //    host's ~/fleet/projects/ tree). Look up the ProjectRow by slug
      //    from useProjects.
      //
      // Phase 117 M7 fix (2026-09-18): pre-fix, if projectsList did not
      // contain the slug (which "should never happen"), the code fell
      // back to the panel-inferred "first host in hostTree" hostId — a
      // DIFFERENT host than the one the project actually lives on. That
      // fallback would silently fail or, worse, archive a same-slug
      // project on the wrong host. (That inferred-hostId derivation was
      // retired in M-G when CreateProjectModal grew its own host picker.)
      // Correct behavior: if we cannot resolve the project's host, log a
      // warning and RETURN early. Better to skip the folder-move than to
      // archive on the wrong host. The identity-side ops (Section 4-5
      // above) already ran, so the member conversations are archived;
      // the on-disk project directory itself just doesn't move.
      const proj = projectsList.find((p) => p.slug === slug);
      const projHostIdNum = proj ? parseInt(proj.hostId, 10) : NaN;
      if (!proj || !(Number.isFinite(projHostIdNum) && projHostIdNum > 0)) {
        console.warn({
          operation: "archive_project_folder_move_skipped_no_host",
          slug,
          reason: proj
            ? "project host invalid"
            : "project not found in projectsList",
        });
        return;
      }
      try {
        await archiveProject(projHostIdNum, slug);
      } catch (err) {
        console.error({
          operation: "archive_project_folder_move_failed",
          slug,
          hostId: projHostIdNum,
          errMessage: err instanceof Error ? err.message : "unknown",
        });
      }
    },
    [projectSections, projectsList, viewingUserMxid],
  );

  // Phase 117 Plan 117-09 Task 2 (D-14) — right-click / long-press handler
  // on the project section header. Opens the shared context menu with
  // "Edit project file" + "Archive project" items at the pointer coords.
  // Header calls `e.preventDefault()` itself and passes coords, so the same
  // handler serves both desktop right-click and mobile long-press paths.
  const handleSectionContextMenu = useCallback(
    (slug: string, displayName: string, x: number, y: number) => {
      setProjectContextMenu({ x, y, slug, displayName });
    },
    [],
  );

  // Phase 117 Plan 117-09 Task 2 (D-14) — "Edit project file" menu item.
  // Followup wire (Phase 117 tail): resolve the project's host from
  // projectsList (same lookup pattern as handleArchiveProject above — projects
  // live under a specific host's ~/fleet/projects/ tree per D-01) and open
  // the ProjectFileModal. If the slug isn't in projectsList (should never
  // happen — the menu opens from a rendered section header), log a warning
  // and no-op rather than silently opening against an ambiguous host.
  const handleEditProjectFile = useCallback(
    (slug: string) => {
      const proj = projectsList.find((p) => p.slug === slug);
      const projHostIdNum = proj ? parseInt(proj.hostId, 10) : NaN;
      if (!proj || !(Number.isFinite(projHostIdNum) && projHostIdNum > 0)) {
        // eslint-disable-next-line no-console
        console.warn({
          operation: "edit_project_file_no_host",
          slug,
          reason: proj
            ? "project host invalid"
            : "project not found in projectsList",
        });
        return;
      }
      setProjectFileModal({
        slug,
        displayName: proj.displayName,
        hostId: projHostIdNum,
      });
    },
    [projectsList],
  );

  // Phase 22 (SRIC-04): label for the `+ New role` launcher button.
  const newRoleLabel = t("nav.newRole", {
    defaultValue: "New role",
  });
  const rdpSectionLabel = t("nav.conversations.rdpSection", {
    defaultValue: "Remote desktop",
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
          session (destructive gesture — user UAT 2026-08-28: "no tint or
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
              was wrong per user 2026-07-24. */}
          <span
            className="pv-title"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <a
              href={`${getBasePath()}/`}
              aria-label={`${brandingConfig.appName} home`}
              data-testid="pv-header-home-link"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <img
                src={brandingConfig.iconPath}
                alt=""
                aria-hidden="true"
                className="pv-header-logo"
              />
            </a>
          </span>
          <div className="pv-header-actions">
            {/* Header icon buttons, left-to-right (8 total):
                (1) Search (Phase 122; opens ConversationSearchModal — prepended
                    as the leftmost for discoverability per that phase's RESEARCH),
                (2) New conversation, (3) Create project, (4) Edit roles,
                (5) Edit global files, (6) Wake-ups (Phase 129 shape 3;
                    opens WakeupsModal — added between Globe and feedback),
                (7) Send feedback (Phase 124 shape 2; gates independently on
                    useFeedbackEnabled per D-12, not on showPencilButton),
                (8) kebab.
                The Search + create/edit/wake-ups/kebab siblings all share
                the `showPencilButton` guard (typeof onCreateSession ===
                "function") and appear/disappear together. The kebab was
                split out from this fragment in Phase 124 so the feedback
                button can render between the guarded cluster and the kebab
                regardless of showPencilButton. Only the feedback button
                gates independently. */}
            {showPencilButton && (
              <>
                <button
                  type="button"
                  className="pv-pencil"
                  aria-label="Search conversations"
                  title="Search conversations"
                  data-testid="pv-header-search-button"
                  onClick={() => setSearchModalOpen(true)}
                >
                  <Search size={18} />
                </button>
                <button
                  type="button"
                  className="pv-pencil"
                  aria-label="New conversation"
                  title="New conversation"
                  data-testid="pv-header-new-agent-button"
                  onClick={() => setNewSessionDialogOpen(true)}
                >
                  <SquarePen size={18} />
                </button>
                {/* Phase 117 Plan 117-08 (D-24) — Create project header
                    button. Toggles createProjectModalOpen; the actual
                    CreateProjectModal lands in 117-09 which replaces the
                    placeholder marker rendered at the bottom of this panel. */}
                <button
                  type="button"
                  className="pv-pencil"
                  aria-label="Create project"
                  title="Create project"
                  data-testid="pv-header-create-project-button"
                  onClick={() => {
                    setPendingProjectSlug(null);
                    setCreateProjectModalOpen(true);
                  }}
                >
                  <FolderOpen size={18} />
                </button>
                {/* Edit roles migrated into the catchall (kebab) menu in
                    shape-sidebar-header-footer-redesign — occasional-use
                    action, pairs semantically with Edit global skills below.
                    Now rendered as the third item in the kebab list. */}
                {/* Edit global files (Globe) migrated to the sidebar footer
                    in shape-sidebar-header-footer-redesign — files scoped to
                    the whole account belong in the "about me" zone, not the
                    "act on this conversation list" zone. Now rendered as
                    pv-footer-global-files-button at the bottom of the panel. */}
                {/* Phase 129 (shape 3, wake-ups-redesign) Plan 129-01 Task 4
                    — Wake-ups header button. Chrome mirrors sibling
                    .pv-pencil buttons verbatim: AlarmClock at size 18,
                    aria-label + title both "Wake-ups". Opens the WakeupsModal
                    mounted alongside the sibling modals below. */}
                <button
                  type="button"
                  className="pv-pencil"
                  aria-label="Wake-ups"
                  title="Wake-ups"
                  data-testid="pv-header-wakeups-button"
                  onClick={() => setWakeupsModalOpen(true)}
                >
                  <AlarmClock size={18} />
                </button>
              </>
            )}
            {/* Phase 123 shape 2 (D-01/D-02/D-11/D-12): "Send feedback" header
                button. Position: fifth of six (after Globe, before the kebab).
                Gate: feedbackEnabled ONLY — deliberately INDEPENDENT of the
                showPencilButton fragment above and below so the button renders
                on any header where feedback is configured, even when
                onCreateSession is undefined (D-12). Chrome mirrors the five
                siblings exactly: same .pv-pencil class, MessageSquare at
                size 18, aria-label + title both "Send feedback" verbatim
                (D-03/D-04/D-05/D-22). Click lifts AppShell's existing
                feedbackOpen atom to "general" via the onOpenFeedback callback
                (D-07/D-08); optional-chaining call is a silent no-op if the
                prop is absent, so tests can render the panel without wiring
                feedback. */}
            {feedbackEnabled && (
              <button
                type="button"
                className="pv-pencil"
                aria-label="Send feedback"
                title="Send feedback"
                data-testid="pv-header-send-feedback-button"
                onClick={() => onOpenFeedback?.()}
              >
                <MessageSquare size={18} />
              </button>
            )}
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
          covered when scroll is at rest. Phase 122 Plan 04 (D-17 removal):
          the Phase 41 Plan 02 scrollContainerRef + inline search input +
          one-shot cold-load scroll-hide have all been retired. Search is now
          the pv-header-search-button in the header-actions cluster which
          opens ConversationSearchModal (portal-mounted below). */}
      <div className="pv-panel-scroll min-h-0">
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
        {/* Phase 119 Plan 04 (D-01/D-02/D-03/D-04/D-05):
            The sidebar Apps section — first content group under the search
            input and above the search-vs-three-zone ternary below. Rendered
            OUTSIDE the ternary (RESEARCH.md Pitfall 2) so the section stays
            visible when the user is typing in the search box; putting this
            block INSIDE either branch of the ternary would silently hide
            the section during active search, violating the D-05 always-
            present invariant that IS the campaign's discoverability point.

            Chrome mirrors the Archived section at PrettyConversationsPanel
            .tsx:1995-2033 verbatim (D-02): same button semantics, same
            typography tokens, same rule-line gradient, same rotating
            ChevronDown, same data-testid + aria-expanded + aria-controls
            pattern. ONE difference vs Archived: the outer wrapper is NOT
            gated on `appTiles.length > 0` (D-05 lock — the section header
            renders unconditionally so a user with zero apps can still
            discover the section).

            Section body is lazy-rendered via `{appsExpanded && ...}`
            (D-03) — the tile list and the D-04 empty-state prompt are
            both inside that gate, so neither is in the DOM until the user
            expands. When `appTiles.length === 0`, the D-04 empty-state
            prompt renders as a single italic muted line (verbatim copy
            per D-04, React-escaped text node — zero XSS surface). When
            populated, one <AppTile
            key={`${hostId}:${slug}`} app={app}/> per entry in the sort
            order returned by useAppTiles() (D-15 sort applied at the
            store level; the panel does not re-sort). */}
        <div className="pv-panel-group pv-apps-section">
          <button
            type="button"
            onClick={() => setAppsExpanded((v) => !v)}
            className="flex items-center gap-2 px-4 pt-1 pb-1.5 w-full text-left"
            data-testid="pretty-conversations-apps-header"
            aria-expanded={appsExpanded}
            aria-controls="pv-apps-section-content"
          >
            <AppWindow
              className="size-3 text-[#5c6070]/85 shrink-0"
              aria-hidden="true"
            />
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
              Apps
            </span>
            <span
              aria-hidden="true"
              className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
            />
            <ChevronDown
              className={`size-3 text-[#5c6070]/85 shrink-0 transition-transform ${appsExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {appsExpanded && (
            <div id="pv-apps-section-content">
              {appTiles.length === 0 ? (
                <div className="pv-apps-empty px-4 py-2 text-center text-[13px] italic text-[#5c6070]/85">
                  Ask an agent to make an app for you.
                </div>
              ) : (
                appTiles.map((app) => (
                  <AppTile
                    key={`${app.hostId}:${app.slug}`}
                    app={app}
                    onOpenApp={onOpenApp}
                    variant={variant}
                  />
                ))
              )}
            </div>
          )}
        </div>
        {/* Phase 122 Plan 04 (D-17 removal): the Phase 41 Plan 02
            `searchMatches !== null` ternary that swapped between a flat
            match list and the three-zone view is retired. The three-zone
            view (pinned / middle / rdpGroup / activeSet) now renders
            unconditionally — content-search is handled by
            ConversationSearchModal (Phase 122 Plan 03). */}
        <>
            {/* Phase 42 UAT amendment 2026-08-17: active-set top zone retired
                — active-set rows now flow through to pinned (if pinned) or
                middle (by recency). Pinned tier still renders inside
                `.pv-panel-group[data-pinned-group="true"]` with per-row
                inActiveSet={activeSet.has(row.id)} wiring preserved to gate the
                `.active-set` CSS deactivate-action hover-reveal.

                UAT 2026-09-19: the "Pinned" header — retired 2026-08-17 —
                is REINSTATED. Phase 119's Apps section landed above the flat
                middle and created ambiguity that didn't exist under the
                original 2026-08-17 layout (pinned rows sitting right after
                the search box read unambiguously as pinned). With Apps in
                place, pinned rows visually appear to belong to the Apps
                section unless a header explicitly disambiguates. Header
                chrome mirrors the Apps + Archived sections' typography
                verbatim (Pin icon at size-3 + uppercase label + rule-line
                gradient), MINUS the ChevronDown — Pinned is not
                collapsible.

                UAT 2026-09-23: header + drop lane are now ALWAYS rendered
                (previously gated on `displayedPinned.length > 0`) so the
                Pinned zone is a discoverable drag-drop target for the pin
                gesture — parity with project sections and the flat-middle
                unpin gesture. Empty state gets a "Drag a conversation here
                to pin" italic muted line mirroring the empty-project
                pattern. */}
            <div
              className="pv-panel-group relative"
              data-pinned-group="true"
              style={{ isolation: "isolate" }}
              onDragOver={handlePinnedZoneDragOver}
              onDragLeave={handlePinnedZoneDragLeave}
              onDrop={handlePinnedZoneDrop}
            >
              {isPinnedZoneDragOver && (
                <div
                  data-testid="pv-pinned-zone-drop-overlay"
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: "rgba(255, 184, 150, 0.22)",
                    border: "2px solid rgba(255, 184, 150, 0.60)",
                    zIndex: 30,
                  }}
                />
              )}
              <div
                className="flex items-center gap-2 px-4 pt-1 pb-1.5"
                data-testid="pretty-conversations-pinned-header"
              >
                <Pin
                  className="size-3 text-[#5c6070]/85 shrink-0"
                  aria-hidden="true"
                />
                <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
                  Pinned
                </span>
                <span
                  aria-hidden="true"
                  className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
                />
              </div>
              {displayedPinned.length === 0 ? (
                <div
                  className="pv-pinned-empty px-4 py-2 text-center text-[13px] italic text-[#5c6070]/85"
                  data-testid="pretty-conversations-pinned-empty"
                >
                  Drag a conversation here to pin.
                </div>
              ) : (
                displayedPinned.map((row) => (
                  <PrettyConversationRowLive
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                    pinned={true}
                    variant={variant}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={() => handleTogglePin(row)}
                    onDeactivate={() => handleRowDeactivate(row)}
                    onKill={() => handleRowKill(row)}
                    onArchive={
                      canonicalArchiveIdForRow(row) !== null
                        ? () => handleArchive(row)
                        : undefined
                    }
                    onMoveToProject={rowMoveToProjectCallback(row)}
                    projects={submenuProjectsForRow(row)}
                    currentProjectSlug={rowIdToProjectSlug.get(row.id) ?? null}
                    inActiveSet={activeSet.has(row.id)}
                    sessionKey={sessionWorkingKey(row)}
                    subtitleMode="identityTitle"
                  />
                ))
              )}
            </div>
            {/* Phase 117 Plan 117-08 (D-09, D-10, D-11) — projects zone.
                Inserted BETWEEN the pinned zone (above) and the flat middle
                (below) per D-09's vertical order lock. NO wrapping
                super-section "Projects" label per D-10 — each header stands
                alone. Empty sections still render as header-only per D-11.
                Each section wraps its rows in a coral drop lane (D-22
                gesture #1) via PrettyProjectSectionHeader. */}
            {displayedProjectSections.map((section) => (
              <PrettyProjectSectionHeader
                key={section.slug}
                slug={section.slug}
                displayName={section.displayName}
                collapsed={collapsedProjectSlugs.has(section.slug)}
                onToggleCollapse={toggleProjectCollapse}
                onNewConversationClick={handleNewConversationInProject}
                onDropRow={handleProjectDrop}
                onContextMenu={handleSectionContextMenu}
                rows={
                  section.rows.length === 0 ? (
                    // UAT 2026-09-19: empty-state message when a project has
                    // zero conversations — mirrors the Apps section's D-04
                    // empty-state pattern (centered italic muted line) so
                    // the two sections read consistently. The drop lane on
                    // PrettyProjectSectionHeader is already active on the
                    // whole section, so drag-and-drop works over this text.
                    <div
                      className="pv-project-empty px-4 py-2 text-center text-[13px] italic text-[#5c6070]/85"
                      data-testid="pretty-conversations-project-empty"
                    >
                      Create a new conversation, or drag one here.
                    </div>
                  ) : (
                    section.rows.map((row) => (
                      <PrettyConversationRowLive
                        key={row.id}
                        row={row}
                        selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                        pinned={isRowPinned(row)}
                        variant={variant}
                        onSelect={() => handleRowSelect(row)}
                        onTogglePin={() => handleTogglePin(row)}
                        onDeactivate={() => handleRowDeactivate(row)}
                        onKill={() => handleRowKill(row)}
                        onArchive={
                          canonicalArchiveIdForRow(row) !== null
                            ? () => handleArchive(row)
                            : undefined
                        }
                        onMoveToProject={rowMoveToProjectCallback(row)}
                        projects={submenuProjectsForRow(row)}
                        currentProjectSlug={rowIdToProjectSlug.get(row.id) ?? null}
                        inActiveSet={activeSet.has(row.id)}
                        sessionKey={sessionWorkingKey(row)}
                        subtitleMode="identityTitle"
                      />
                    ))
                  )
                }
              />
            ))}
            {/* Phase 41 Plan 01 (user 2026-08-14): FLAT middle zone.
                No per-host divider chips (retired). Every non-pinned, non-
                active-set, non-RDP row lands in `displayedMiddle` as a
                single flat array from `snapshot.middle`, sorted by the
                store's compareByRecencyDesc + insertion-order fallback.
                Rendered inside ONE `.pv-panel-group` container without
                per-host wrappers.

                Phase 117 Plan 117-08 (D-22 gesture #2) — the flat-middle
                container is also a drop target that CLEARS the project field
                on a row currently assigned to a project. Type-gated on
                application/x-skynet-row so the outer panel's badge-drag
                machinery is not clobbered (badge MIME falls through to the
                outer handler; row MIME is handled here). Renders regardless
                of `displayedMiddle.length > 0` when there are projects to
                clear from — the drop target needs to exist even on an empty
                middle so users can drag out of a project section. */}
            {(displayedMiddle.length > 0 || projectSections.length > 0) && (
              <div
                className="pv-panel-group relative"
                data-middle-group="true"
                data-testid="pv-panel-flat-middle"
                style={{ isolation: "isolate" }}
                onDragOver={handleFlatMiddleDragOver}
                onDragLeave={handleFlatMiddleDragLeave}
                onDrop={handleFlatMiddleDrop}
              >
                {isFlatMiddleDragOver && (
                  <div
                    data-testid="pv-flat-middle-drop-overlay"
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: "rgba(255, 184, 150, 0.22)",
                      border: "2px solid rgba(255, 184, 150, 0.60)",
                      zIndex: 30,
                    }}
                  />
                )}
                {/* Phase 117 M-J follow-up (2026-09-19): flat-middle section
                    header. Mirrors the shape of PrettyProjectSectionHeader's
                    top row (icon + label + gradient rule) so every zone
                    besides pinned-unassigned has an unambiguous visual
                    top boundary. No collapse chevron / no per-section
                    new-conv button — those are project-section affordances,
                    not applicable here. Skipped when displayedMiddle is
                    empty (the wrapper still renders for the drop-out-of-
                    project affordance, but there's nothing to label). */}
                {displayedMiddle.length > 0 && (
                  <div
                    className="flex items-center gap-2 px-4 pt-3 pb-1.5"
                    data-testid="pv-flat-middle-section-header"
                  >
                    <MessagesSquare
                      className="size-3 text-[#5c6070]/85 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
                      Other
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
                    />
                  </div>
                )}
                {displayedMiddle.map((row) => (
                  <PrettyConversationRowLive
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId || visibleInSplitTree.has(row.id)}
                    pinned={isRowPinned(row)}
                    variant={variant}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={() => handleTogglePin(row)}
                    onDeactivate={() => handleRowDeactivate(row)}
                    onKill={() => handleRowKill(row)}
                    onArchive={
                      canonicalArchiveIdForRow(row) !== null
                        ? () => handleArchive(row)
                        : undefined
                    }
                    onMoveToProject={rowMoveToProjectCallback(row)}
                    projects={submenuProjectsForRow(row)}
                    currentProjectSlug={rowIdToProjectSlug.get(row.id) ?? null}
                    inActiveSet={activeSet.has(row.id)}
                    sessionKey={sessionWorkingKey(row)}
                    subtitleMode="identityTitle"
                  />
                ))}
              </div>
            )}
            {/* Phase 41 Plan 01: RDP zone renderer. When `displayedRdpGroup`
                is null (zero RDP-eligible hosts), the entire section —
                divider chip + rows — is suppressed (user lock #7).
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
                    /* RDP rows are excluded from the archive affordance —
                       canonicalArchiveIdForRow short-circuits rdpHostRow=true
                       to null, so onArchive is intentionally omitted here.
                       Documented explicitly so a future refactor doesn't
                       accidentally add it and re-open the affordance-
                       narrowing gate 115-02 landed for the Hide slot.
                       (D-01 affordance-narrowing: Archive is identity-only.) */
                    inActiveSet={activeSet.has(row.id)}
                    sessionKey={sessionWorkingKey(row)}
                  />
                ))}
              </div>
            )}
            {/* (Phase 115 Plan 115-02: prior Hidden section render block
                retired per D-21 alongside the Hide affordance.
                Phase 115 Plan 115-06 Archived section retired in the
                Phase 122 shape follow-up — archived identities are now
                surfaced exclusively via the ConversationSearchModal.) */}
        </>
      </div>

      {/* Sidebar footer — the "about me" zone. Sibling of .pv-panel-header
          and .pv-panel-scroll in the panel's flex column. Left slot: initials
          circle (decorative, no click behavior) + username. Right slot: the
          Globe (migrated from the header — files scoped to the whole account
          belong here) and the inert Settings-gear placeholder (rendered as a
          <span> so it's semantically not-interactive; preferences service
          ships in a follow-on shape). The anchor slot renders only when
          username is populated; the actions slot always renders. */}
      <div className="pv-panel-footer" data-testid="pv-panel-footer">
        <div className="pv-footer-anchor">
          {username ? (
            <>
              <span
                className="pv-footer-initials"
                aria-hidden="true"
                data-testid="pv-footer-initials"
              >
                {username.trim().charAt(0).toUpperCase()}
              </span>
              <span
                className="pv-footer-username"
                data-testid="pv-footer-username"
              >
                {username}
              </span>
            </>
          ) : null}
        </div>
        <div className="pv-footer-actions">
          <button
            type="button"
            className="pv-footer-btn"
            aria-label="Edit global files"
            title="Edit global files"
            data-testid="pv-footer-global-files-button"
            onClick={() => setGlobalFilesModalOpen(true)}
          >
            <Globe size={18} />
          </button>
          <span
            className="pv-footer-btn pv-footer-btn-inert"
            aria-label="User preferences (coming soon)"
            title="User preferences (coming soon)"
            data-testid="pv-footer-preferences-placeholder"
            aria-disabled="true"
          >
            <Settings size={18} />
          </span>
        </div>
      </div>

      {/* NewSessionDialog VERBATIM from ConversationsPanel.tsx lines
          358-368. Portal-mounted; DOM sibling position doesn't drive
          layout. Only mounted when onCreateSession is wired — same gate
          as the pencil button. */}
      {/* Phase 117 M-F follow-up (2026-09-18): wrapper node with a data
          attribute so tests can observe the pending project slug wired
          through the panel (mirrors the pv-new-conv-modal-wrapper pattern
          above). The slug is applied via setSessionProject inside onCreate
          below, then cleared on close/create. */}
      <div
        data-testid="pv-new-session-dialog-wrapper"
        data-pending-project-slug={newSessionPendingProjectSlug ?? ""}
        hidden
      />
      {showPencilButton && (
        <NewSessionDialog
          open={newSessionDialogOpen}
          onClose={() => {
            setNewSessionDialogOpen(false);
            // Phase 22 SRIC-05: clear chainPrefill on close so a subsequent
            // manual open (via pencil) does NOT inherit stale chain state.
            setChainPrefill(null);
            // Phase 117 M-F/M-I: clear pending project slug + hostId so a
            // subsequent header-pencil open does NOT inherit stale project
            // context.
            setNewSessionPendingProjectSlug(null);
            setNewSessionPendingProjectHostId(null);
          }}
          // Phase 117 M-I follow-up: when opened via the per-project
          // SquarePen, pass a synthetic single-host tree so NewSessionDialog's
          // existing Phase-84 auto-hide-when-single-host logic kicks in — the
          // destination host is implied (project lives on one host; agent
          // must be born there to appear under the section). When opened
          // via the header pencil (pendingProjectHostId===null), pass the
          // full hostTree unchanged.
          hostTree={(() => {
            const fullTree = hostTree ?? null;
            if (newSessionPendingProjectHostId === null) return fullTree;
            if (!fullTree) return fullTree;
            const projectHost = collectHostsFromFolder(fullTree).find(
              (h) => parseInt(h.id, 10) === newSessionPendingProjectHostId,
            );
            if (!projectHost) return fullTree; // fall back to full tree if not found
            return { name: fullTree.name, children: [projectHost] };
          })()}
          onCreate={(opts) => {
            onCreateSession!(opts);
            // Phase 117 M-F: if this dialog was opened via the per-project
            // SquarePen, apply the pending project slug to the newborn (or
            // clone-attached) identity via setSessionProject. identityMode:
            // false is a plain tmux session — no identity to tag; skip.
            //
            // Phase 117 M-H (2026-09-19): chain refreshIdentities AFTER the
            // write so the store observes the fresh `project:` field. The
            // birth flow's built-in refresh runs BEFORE onCreate fires, so
            // without this re-fetch the store carries project=null and the
            // sidebar derivation never buckets the newborn under its
            // section (visible symptom: agent opens as a tab but does NOT
            // appear under the project section until the next full page
            // reload).
            const slug = newSessionPendingProjectSlug;
            if (slug !== null) {
              const identityKey =
                opts.identityMode === true
                  ? opts.name
                  : opts.identityMode === "existing"
                    ? opts.identityName
                    : null;
              if (identityKey !== null) {
                const hostIdNum = parseInt(opts.host.id, 10);
                if (Number.isFinite(hostIdNum) && hostIdNum > 0) {
                  setSessionProject(hostIdNum, identityKey, slug)
                    .then(() =>
                      refreshIdentities({ [identityKey]: hostIdNum }),
                    )
                    .catch((err: unknown) => {
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      // eslint-disable-next-line no-console
                      console.error(
                        `[project-new-session] setSessionProject failed hostId=${hostIdNum} key=${identityKey} slug=${slug}: ${msg}`,
                      );
                    });
                }
              }
            }
            setNewSessionDialogOpen(false);
            // Also clear on successful submit path (matches close semantics).
            setChainPrefill(null);
            setNewSessionPendingProjectSlug(null);
            setNewSessionPendingProjectHostId(null);
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
      {/* Phase 117 Plan 117-09 Task 2 (D-27) — wrapper node with a data
          attribute so tests can observe the pre-selected slug wired
          through the panel without reaching into modal internals. */}
      <div
        data-testid="pv-new-conv-modal-wrapper"
        data-pre-selected-project={newConversationPreSelectedProject ?? ""}
        hidden
      />
      <NewConversationModal
        open={newConversationModalOpen}
        onOpenChange={(o) => {
          setNewConversationModalOpen(o);
          if (!o) setNewConversationPreSelectedProject(null);
        }}
        onCreated={(result) => {
          setNewConversationModalOpen(false);
          setNewConversationPreSelectedProject(null);
          onCreateRelayRoom?.(result); // AppShell-side handler opens the tab
        }}
        preSelectedProject={newConversationPreSelectedProject}
      />
      {/* EnableNotificationsModal — portal-mounted sibling of the other modal
          mounts. Opened from the kebab menu's "Enable notifications…" item.
          The menu item is feature-detected via pushNotificationsSupported();
          the modal itself renders regardless (the item won't be there to
          open it on unsupported browsers). */}
      <EnableNotificationsModal
        open={enableNotificationsModalOpen}
        onOpenChange={setEnableNotificationsModalOpen}
      />
      {/* Phase 122 Plan 03 Task 3 — ConversationSearchModal: portal-mounted
          sibling of NewConversationModal + GlobalFilesModal. Opened via the
          magnifying-glass button in .pv-header-actions above (first child of
          the cluster, gated by showPencilButton). D-04 jump-and-close on
          active-result click; D-15 blunt window.alert on archived-result
          click; the modal itself closes on the active-click path (via
          onOpenChange false), so the parent only routes the
          onOpenActiveConversation callback through to AppShell. */}
      <ConversationSearchModal
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        onOpenActiveConversation={(result) => {
          onSearchResultOpenActive?.(result);
        }}
      />
      {/* Phase 129 (shape 3, wake-ups-redesign) Plan 129-01 Task 4 —
          WakeupsModal: portal-mounted sibling of ConversationSearchModal.
          Opened via the AlarmClock button in .pv-header-actions above
          (position 6 in the guarded cluster — after Edit-global-files
          Globe, before feedback + kebab). Owns its own list + form +
          refetch lifecycle (D-03 no client cache, D-17 filter reset on
          close); controlled open state only. hostTree threaded so the
          filter-bar host dropdown + wave-2 host chip-picker can render
          the same user-scoped host set every other modal in this cluster
          uses. */}
      <WakeupsModal
        open={wakeupsModalOpen}
        onOpenChange={setWakeupsModalOpen}
        hostTree={hostTree ?? null}
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
          {/* KEEP ORDER: New group conversation → Edit global skills… (Phase 44 Pitfall 8 guard —
              do not alphabetize or reshuffle these two survivors). quick-260914-liu moved
              New agent, Edit roles, and Edit global files into dedicated header icon buttons;
              those three entries were gone from this list at the time. The Phase 44 no-reshuffle
              guard still applies to the original pair.
              shape-sidebar-header-footer-redesign: Edit roles came back into this list as the
              THIRD item, appended after the guarded pair (which keeps its order). Rationale:
              occasional-use action; pairs semantically with Edit global skills (both are
              edit-shared-things). The Phase 44 guard on the first two items is NOT extended to
              cover Edit roles — Edit roles is deliberately at the end so future re-ordering of
              its position doesn't disturb the original pair. */}
          {[
            { label: "New group conversation", onClick: () => setNewConversationModalOpen(true) }, // Phase 91 Plan 05
            { label: "Edit global skills…", onClick: () => setSkillsEditorModalOpen(true) },
            { label: "Edit roles…", onClick: () => setRolesListModalOpen(true) }, // shape-sidebar-header-footer-redesign
            // Feature-detected — omitted entirely when the browser can't do Web Push.
            ...(notificationsSupported
              ? [{ label: "Enable notifications…", onClick: () => setEnableNotificationsModalOpen(true) }]
              : []),
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
      {/* Phase 117 Plan 117-09 Task 1 — CreateProjectModal, wired to the
          header "Create project" button (state landed in 117-08). Replaces
          the 117-08 placeholder marker. Backend-authoritative slugify:
          modal submits the raw displayName; the response body carries the
          slug produced by the backend's normalizeToSlug (D-25, Pitfall 1). */}
      <CreateProjectModal
        open={createProjectModalOpen}
        onOpenChange={(o) => {
          setCreateProjectModalOpen(o);
          if (!o) setPendingProjectSlug(null);
        }}
        onCreated={() => {
          // Wire event (project-list-changed → useProjects) refreshes the
          // sidebar; nothing else to do here. If pendingProjectSlug was set
          // (i.e. this modal-open was triggered by a per-section new-conv
          // click that 117-09's Task 2 hooked into NewConversationModal
          // instead), it's cleared alongside the modal close.
        }}
        hostTree={hostTree ?? null}
      />
      {/* 117-08 legacy placeholder marker — kept for tests written against
          117-08's state contract that observe the marker rather than the
          real modal. Rendered ALONGSIDE the real modal so both markers are
          visible for the same open state. 117-09's tests observe the real
          modal via role="dialog" / data-testid="create-project-modal". */}
      {createProjectModalOpen && (
        <div
          data-testid="create-project-modal-placeholder"
          data-pending-project-slug={pendingProjectSlug ?? ""}
          hidden
        />
      )}
      {/* Phase 117 followup — ProjectFileModal wired to the section-header
          context menu's "Edit project file" item. State carries {slug,
          displayName, hostId} at open time (resolved from projectsList in
          handleEditProjectFile). onOpenChange(false) clears the state so a
          re-open shows the loading skeleton rather than stale content. */}
      {projectFileModal !== null && (
        <ProjectFileModal
          open={true}
          onOpenChange={(o) => {
            if (!o) setProjectFileModal(null);
          }}
          slug={projectFileModal.slug}
          displayName={projectFileModal.displayName}
          hostId={projectFileModal.hostId}
        />
      )}
      {/* Phase 117 Plan 117-09 Task 2 (D-14) — per-section context menu.
          Opened by right-click / long-press on any PrettyProjectSectionHeader
          via handleSectionContextMenu; renders "Edit project file" +
          "Archive project" items at the pointer coords. Reused
          PrettyConversationContextMenu chrome (portal-mounted, Escape +
          outside-click dismiss). */}
      {projectContextMenu !== null && (
        <PrettyConversationContextMenu
          x={projectContextMenu.x}
          y={projectContextMenu.y}
          onClose={() => setProjectContextMenu(null)}
          items={[
            {
              label: "Edit project file",
              onClick: () => handleEditProjectFile(projectContextMenu.slug),
            },
            {
              label: "Archive project",
              onClick: () => {
                void handleArchiveProject(projectContextMenu.slug);
              },
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
}
