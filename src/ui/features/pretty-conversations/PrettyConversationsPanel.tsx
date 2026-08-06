// ─── PrettyConversationsPanel ────────────────────────────────────────────────
// The flat-list composition of the Phase 10 pretty-conversations rework.
// Wraps Wave 1's `PrettyConversationRow` into a full conversation panel
// matching the Ashley-signed-off prototypes (prototype.html for mobile,
// desktop.html for desktop):
//
//   - Flat rows, NO "Pinned" section header, NO per-host semibold header
//   - Pinned rows at the top (only marker = the pin glyph on the row itself)
//   - Grouped identity-tmux rows below, flat
//   - RDP-sentinel HostGroup (hostId `"__rdp__"`) at the bottom with a
//     subtle "Remote desktop" divider chip and Monitor-glyph avatars
//     (the row's `data-rdp-host-row="true"` attribute already suppresses
//     pin+swipe intrinsically per Wave 1's contract)
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
//   - settingsRowSlot prop retired in Phase 11 (Ashley's "no settings" lock —
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
// the same two action imports (selectConversation / togglePinConversation).
// No store reshape. No new derivations. The panel is a thin composition
// layer.
//
// Wave 3 (AppShell cutover) does the mount-site swap; this panel is NOT
// yet mounted anywhere. Wave 4 retires ConversationsPanel.tsx +
// ConversationRow.tsx.
//
// NO diagnostic spew — Patch #111e F3-diag scoped to the old panel is being
// retired in Wave 4 and NOT ported forward here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, EyeOff, Filter, Loader2, Monitor, MoreVertical, Pin, Server } from "lucide-react";
import GlobalFilesModal from "@/features/pretty-view/GlobalFilesModal";
import { useTranslation } from "react-i18next";

import {
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  useHiddenIds,
  useActiveSet,
  useFleetSessionsLoaded,
  selectConversation,
  addToActiveSet,
  removeFromActiveSet,
  fleetRowId,
  togglePinConversation,
  hydratePinnedIdsFromServer,
  hideConversation,
  unhideConversation,
  hydrateHiddenIdsFromServer,
  type ConversationRow as ConversationRowShape,
} from "@/state/conversation-store";
import { useSessionWorking } from "@/state/session-working-store";
import { useSessionRecycling } from "@/state/session-recycling-store";
import { useSessionQueuePending } from "@/state/session-queue-pending-store";
import { useIdentities, refreshIdentities } from "@/state/identities-store";
import {
  bountyCountsCompositeKey,
  startBountyCountPoller,
  useAllBountyCounts,
} from "@/state/bounty-counts-store";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { NewSessionDialog, type NewSessionOnCreateOpts } from "@/sidebar/NewSessionDialog";
// Phase 22 (SRIC-04): CreateRoleDialog + `+ New role` launcher next to the pencil.
// Chain-to-create-identity hook (onChainToCreateIdentity) is deferred to Plan 22-05
// / SRIC-05 — this panel does NOT provide the callback (undefined-safe on the
// dialog side, verified by CreateRoleDialog.test.tsx Test 17b).
import { CreateRoleDialog } from "@/sidebar/CreateRoleDialog";
// Phase 22 (SRIC-03): CloneAgentDialog mounted here; opened by row-level
// context-menu "Clone" click via handleRowClone below. Panel owns the source-
// identity + hostId capture so the dialog stays pure (identity/host in props).
import { CloneAgentDialog } from "@/sidebar/CloneAgentDialog";
import type { Identity } from "@/api/identities-api";
import { getPinnedIds, getHiddenIds } from "@/api/user-preferences-api";
import type { Host, HostFolder } from "@/types/ui-types";

import { PrettyConversationRow } from "./PrettyConversationRow";
import WeeklyUsageMeter from "./WeeklyUsageMeter";
import SkynetLogo from "./SkynetLogo";

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

// Patch #137: micro-wrapper that reads the row's live isWorking state from
// the session-working-store. Extracted so the store subscription sits at a
// stable hook-call site (top of an instance component) rather than inside
// a .map() callback — Rules-of-Hooks compliance. Each row is keyed on row.id
// at the render sites below, so React's reconciler pairs the same hook
// order to the same row instance across renders.
//
// quick-260730-qbl added the session-recycling-store subscription.
// quick-260802-w9e added the session-queue-pending-store subscription — the
// row's ready-dot is now suppressed by a FOURTH gate `!hasQueuePending` when
// this session has an armed idle-send queue in its ComposeBox. All three
// stores share the exact same `${hostId}:${tmuxSession ?? ""}` key shape.
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
  const isWorking = useSessionWorking(sessionKey);
  // quick-260730-qbl: recycling-store consumption. Keyed identically to the
  // working-store subscription above — both stores share the exact same
  // `${hostId}:${tmuxSession ?? ""}` shape (PrettyView.tsx and Terminal.tsx
  // compute the same key; sessionWorkingKey() at line 81-84 produces it here).
  const isRecycling = useSessionRecycling(sessionKey);
  // quick-260802-w9e: queue-pending-store consumption. Same key shape as
  // both stores above. Published by ComposeBox from a useEffect on
  // `[queue, sessionKey]`; the row-level ready-dot render at
  // PrettyConversationRow.tsx:507 gates on `!hasQueuePending` as the fourth
  // predicate so a session with an armed idle-send queue does NOT paint the
  // dot (the session is spoken-for pending idle; NOT ready for input).
  const hasQueuePending = useSessionQueuePending(sessionKey);
  return (
    <PrettyConversationRow
      {...rowProps}
      isWorking={isWorking}
      isRecycling={isRecycling === true}
      hasQueuePending={hasQueuePending}
      inActiveSet={inActiveSet}
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
  onDeactivateRow,
  sidebarToggleOverlaps = false,
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
  // alongside AppRail per Ashley's "no settings" lock).
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
  // quick-260727-gm3: fired when Ashley clicks the red-tinted X on an
  // active-set row. AppShell wires this to closeTab(row.id) so
  // the deactivate action reuses the existing tab-close plumbing verbatim
  // (including the confirm-tab-close toast branch). Required — the panel
  // composes removeFromActiveSet(row.id) + onDeactivateRow(row) at the
  // handleRowDeactivate call site; making the prop required forces every
  // caller (production AppShell + tests) to explicitly wire the tab-close
  // side. Test files that don't care pass `onDeactivateRow={() => {}}`.
  onDeactivateRow: (row: ConversationRowShape) => void;
  // Patch #142 (Fix 5): when the desktop sidebar is open, the fixed
  // top-left chevron overlaps the "Conversations" title. This prop adds
  // padding-left clearance via data-sidebar-toggle-overlaps attribute +
  // CSS rule. Mobile unaffected (mobile hides the desktop title already).
  sidebarToggleOverlaps?: boolean;
}) {
  const { t } = useTranslation();
  const { activeSet: activeSetRows, pinned, grouped } = useConversations();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();
  // quick-260731-tgg: hiddenIds subscription — drives the Hidden section render
  // and per-row hidden prop threading.
  const hiddenIds = useHiddenIds();
  // Quick 260727-tb1: identity map for the bounty-count poller's getTargets
  // callback. Same hook the row uses to resolve identity — subscribing at
  // the panel level lets the poller enumerate every visible row's identity
  // without a second per-row identities-store subscription.
  const { byKey: identitiesByKey } = useIdentities();
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
  // Ashley confirmed the store flag stays true after first flip, but a
  // ref-based dedupe costs nothing and closes the invariant regardless).
  const hydratedRef = useRef(false);

  // Patch #144 Fix (d): every selectedId change enrolls the id in the
  // active set — not just click-driven selection via handleRowSelect.
  // URL-fragment restore, keyboard nav, and any other programmatic path
  // that mutates selectedId now lights the row up with the full pretty-
  // view bubble treatment instead of the ambient flat treatment. Ashley's
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
  //       false→true→false→true flip (Ashley confirmed the flag stays true
  //       after first flip, but the ref costs nothing). Depends on
  //       [fleetSessionsLoaded] not [] so the body reruns when the flag flips.
  useEffect(() => {
    if (!fleetSessionsLoaded) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    (async () => {
      // quick-260731-tgg: fetch pinnedIds and hiddenIds in parallel so
      // a network failure on either does NOT prevent the other from succeeding.
      // Each is independently try/caught — same silent-catch semantics as the
      // pre-tgg single-fetch path. Both dispatches are guarded by the same
      // `cancelled` cancel-token (one unmount = both guarded).
      const [pinnedResult, hiddenResult] = await Promise.allSettled([
        getPinnedIds(),
        getHiddenIds(),
      ]);
      if (cancelled) return;
      if (pinnedResult.status === "fulfilled") {
        hydratePinnedIdsFromServer(pinnedResult.value);
      }
      if (hiddenResult.status === "fulfilled") {
        hydrateHiddenIdsFromServer(hiddenResult.value);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fleetSessionsLoaded]);

  // Quick 260727-tb1: bounty-count poller mount. getTargets walks the CURRENT
  // union of activeSet + pinned + grouped rows (via refs bumped on every
  // render — the poller must NOT close over a mount-time snapshot), filters
  // to rows whose sessionMatchKey resolves to a known identity, and returns
  // the deduped {identityKey, hostId} list. startBountyCountPoller fires an
  // initial fetch, sets a 60s setInterval, and adds a window.focus listener
  // that fires an extra refresh. The returned stop-fn is invoked on unmount.
  // Non-identity rows are filtered here so useBountyCount inside those rows
  // stays subscribed to `undefined` (short-circuit path). Dedup by composite
  // key protects the batch from a single identity appearing across multiple
  // panel sections (e.g. in both pinned AND active-set).
  const activeSetRowsRef = useRef(activeSetRows);
  const pinnedRef = useRef(pinned);
  const groupedRef = useRef(grouped);
  const identitiesByKeyRef = useRef(identitiesByKey);
  activeSetRowsRef.current = activeSetRows;
  pinnedRef.current = pinned;
  groupedRef.current = grouped;
  identitiesByKeyRef.current = identitiesByKey;

  useEffect(() => {
    const getTargets = () => {
      const idsSeen = new Set<string>();
      const targets: Array<{ identityKey: string; hostId: number | null }> = [];
      const collect = (row: ConversationRowShape) => {
        const matchKey = sessionMatchKey(row.targetTmuxSession);
        if (!matchKey) return;
        const ident = identitiesByKeyRef.current.get(matchKey);
        if (!ident) return;
        const hostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
        const hostId = Number.isFinite(hostIdNum) ? hostIdNum : null;
        const composite = `${ident.identityKey}:${hostId ?? "local"}`;
        if (idsSeen.has(composite)) return;
        idsSeen.add(composite);
        targets.push({ identityKey: ident.identityKey, hostId });
      };
      for (const row of activeSetRowsRef.current) collect(row);
      for (const row of pinnedRef.current) collect(row);
      for (const group of groupedRef.current) {
        for (const row of group.rows) collect(row);
      }
      return targets;
    };
    const stop = startBountyCountPoller(getTargets, 60_000);
    return stop;
  }, []);

  // Quick 260727-tb1: identity:bounty-priority-updated piggyback (Key design
  // decision #5). The actual invalidateIdentity(identityKey, hostId) call is
  // wired at src/ui/features/pretty-view/IdentityModal.tsx inside the
  // sendIdentityMutation success path for the "identity:update-bounty-priority"
  // request — that's where the response arrives and where identityKey +
  // hostId are already in scope. Placing the wiring in the panel would
  // require inventing a shared identity:* WS subscription bus (none exists
  // — every identity:* request today is one-shot per WebSocket, closed
  // after receipt). The modal path is functionally equivalent for the
  // user story ("Ashley reprioritizes → badge refreshes immediately")
  // and avoids the architectural expansion. Search invalidateIdentity /
  // identity:bounty-priority-updated to find the wire site.

  // Local state: NewSessionDialog open/closed toggle (opened by pencil).
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  // Phase 22 (SRIC-04): CreateRoleDialog open/closed toggle (opened by the
  // sibling `+ New role` launcher button, mounted below alongside NewSessionDialog).
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
    description: string;
  } | null>(null);
  // Phase 22 (SRIC-03): CloneAgentDialog state — captures the row's source
  // identity + hostId when Ashley clicks the Clone context-menu item, so the
  // dialog opens pre-wired for that specific row. Set to null when closed.
  const [cloneDialogState, setCloneDialogState] = useState<{
    sourceIdentity: Identity;
    hostId: number;
  } | null>(null);

  // Phase 23 (GEFM-01): panel-header MoreVertical menu state.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Phase 23 (GEFM-05): GlobalFilesModal open/closed toggle (opened from menu item).
  const [globalFilesModalOpen, setGlobalFilesModalOpen] = useState(false);

  // quick-260731-tgg: collapsed by default on every mount per Ashley's design lock.
  const [hiddenExpanded, setHiddenExpanded] = useState(false);

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

  // Patch #167: pinned-bounty filter toggle (header funnel button). Local
  // state only — NOT persisted (Ashley 2026-07-28: "no remembering filter
  // state"). Each fresh panel mount starts with filter off.
  const [filterPinnedOnly, setFilterPinnedOnly] = useState(false);

  // Patch #167: subscribes to the full bounty-counts map so the filter
  // re-runs when the 60s poller lands a new count OR when the IdentityModal
  // fires invalidateIdentity() post-priority-change. Same store the row-level
  // badge subscribes to via useBountyCount — this is a whole-map read that
  // powers the panel-level filter helper below.
  const bountyCounts = useAllBountyCounts();

  // Patch #167: "does this row's identity have at least one pinned bounty?"
  // Semantics match the row-level PrettyBountyCountBadge exactly: host-scoped
  // (`(identityKey, hostId)`), status=pinned only (backend already narrows),
  // rows without a resolvable identity → false (filtered out when filter is
  // on). Wrapped in useMemo so the helper identity is stable across renders
  // that don't change identitiesByKey or the counts snapshot.
  const hasPinnedForRow = useMemo(() => {
    return (row: ConversationRowShape): boolean => {
      const matchKey = sessionMatchKey(row.targetTmuxSession);
      if (!matchKey) return false;
      const ident = identitiesByKey.get(matchKey);
      if (!ident) return false;
      const hostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;
      const hostId = Number.isFinite(hostIdNum) ? hostIdNum : null;
      const key = bountyCountsCompositeKey(ident.identityKey, hostId);
      return (bountyCounts.get(key) ?? 0) > 0;
    };
  }, [identitiesByKey, bountyCounts]);

  // Patch #167: apply the filter to each render collection when active.
  // Groups with 0 rows post-filter are dropped so we don't render empty
  // host-divider chips. RDP-sentinel group is filtered the same way; if all
  // RDP rows fall out (they typically will — RDP rows don't map to identities
  // with bounties), the whole "Remote desktop" section disappears from the
  // list, matching Ashley's directive that filter applies "to the entire
  // conversation list."
  //
  // Exception (Ashley 2026-07-28): the active-set tier is exempt from the
  // filter — active sessions always show through, regardless of pinned-bounty
  // count. Conversation-store's tier partition guarantees active-set rows
  // never appear in the pinned or grouped tiers, so this exemption doesn't
  // leak: pinned-only conversations (not in active-set) still get filtered.
  const displayedActiveSetRows = activeSetRows;
  const displayedPinned = filterPinnedOnly
    ? pinned.filter(hasPinnedForRow)
    : pinned;
  const displayedGrouped = filterPinnedOnly
    ? grouped
        .map((g) => ({ ...g, rows: g.rows.filter(hasPinnedForRow) }))
        .filter((g) => g.rows.length > 0)
    : grouped;

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
  for (const r of activeSetRows) knownRowsRef.current.set(r.id, r);
  for (const r of pinned) knownRowsRef.current.set(r.id, r);
  for (const g of grouped) for (const r of g.rows) knownRowsRef.current.set(r.id, r);

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
  }, [hiddenIds, activeSetRows, pinned, grouped]);

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
    // quick-260731-tgg: opening a hidden row auto-unhides it before routing.
    if (hiddenIds.has(row.id)) unhideConversation(row.id);
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

  // quick-260731-tgg: panel-level togglePin with mutual exclusion — unhide before pin.
  // Replaces direct togglePinConversation calls at the render sites.
  const handleTogglePin = (rowId: string) => {
    if (hiddenIds.has(rowId)) unhideConversation(rowId);
    togglePinConversation(rowId);
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

  // Phase 22 (SRIC-03): panel-level clone handler. Given a row, resolve the
  // identity via the already-hoisted useIdentities() byKey lookup (identity
  // resolution is shared with the row itself — same sessionMatchKey key
  // shape). If identity resolves AND row.host is set, capture both into
  // cloneDialogState so CloneAgentDialog opens pre-wired. If either is null
  // (RDP rows, unresolved identity), no-op — the row-level items[] gate
  // (see PrettyConversationRow.tsx items builder) already prevents the menu
  // item from surfacing in that case, so this is belt-and-suspenders.
  const handleRowClone = (row: ConversationRowShape) => {
    const matchKey = sessionMatchKey(row.targetTmuxSession);
    if (!matchKey) return;
    const identity = identitiesByKey.get(matchKey);
    if (!identity) return;
    if (!row.host) return;
    const hostIdNum = parseInt(row.host.id, 10);
    if (!Number.isFinite(hostIdNum)) return;
    setCloneDialogState({ sourceIdentity: identity, hostId: hostIdNum });
  };

  // quick-260802-pq2: handleSwipeOpenChange + forceClosedFor removed —
  // the row's swipe machinery was retired; there is no per-row open-state
  // to coordinate. Mobile actions flow through the long-press context menu.

  // Precompute a stable no-op togglePin for RDP rows (belt-and-suspenders —
  // Wave 1's contract already suppresses swipe/pin intrinsically for RDP,
  // but hand a no-op arrow anyway so nothing fires if the invariant ever
  // regresses).
  const rdpNoopTogglePin = () => {};

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
    >
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
              was wrong per Ashley 2026-07-24. */}
          <span
            className="pv-title"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <SkynetLogo
              aria-hidden="true"
              className="pv-header-logo"
            />
            <img
              src="/skynet-wordmark.png"
              alt="SKYNET"
              className="pv-header-wordmark"
            />
          </span>
          <div className="pv-header-actions">
            {/* quick-260805-70q: filter button un-hidden per Ashley 2026-08-05 (reverses patch #317 gate). */}
            <button
              type="button"
              onClick={() => setFilterPinnedOnly((v) => !v)}
              aria-label={filterLabel}
              aria-pressed={filterPinnedOnly}
              title={filterLabel}
              className="pv-filter"
              data-active={filterPinnedOnly ? "true" : "false"}
              data-testid="pv-filter-pinned-bounties"
            >
              <Filter />
            </button>
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
            Polls /api/usage every 15s; gracefully retains last values on failure. */}
        <WeeklyUsageMeter />
      </div>

      {/* Scroll region: safe-area padding lives on outer container (patch #131)
          so the panel bottom sits ABOVE the safe-area — settings row is not
          covered when scroll is at rest. */}
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
        {/* Patch #149 B+C: active-set rows overtake pinned per Ashley 2026-07-24.
                Rows here get pinned={pinnedIds.has(row.id)} so a row that IS pinned
                AND active still shows the pin glyph.
                Patch #195 (Ashley 2026-07-29): sublabel switched to
                subtitleMode="identityTitle" — active-set rows now match pinned
                + host-grouped in reading identity.title (fallback identity.
                displayName, terminal fallback hostname). Closes the scope gap
                left by quick-260727-f9v + #184 that only switched pinned +
                grouped and left the active-set default at "hostname". */}
            {displayedActiveSetRows.length > 0 && (
              <div className="pv-panel-group" data-active-set-group="true">
                {displayedActiveSetRows.map((row) => (
                  <PrettyConversationRowLive
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    pinned={pinnedIds.has(row.id)}
                    hidden={hiddenIds.has(row.id)}
                    variant={variant}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={() => handleTogglePin(row.id)}
                    onDeactivate={() => handleRowDeactivate(row)}
                    onToggleHide={() => handleToggleHide(row)}
                    onClone={() => handleRowClone(row)}
                    inActiveSet={activeSet.has(row.id)}
                    sessionKey={sessionWorkingKey(row)}
                    subtitleMode="identityTitle"
                  />
                ))}
              </div>
            )}
            {/* Pinned rows. Patch #234: a "Pinned" divider chip renders
                above the pinned tier when displayedPinned.length > 0,
                mirroring the RDP divider chip pattern (Pin glyph + uppercase
                muted label + gradient rule). Chip is gated on length so an
                empty pinned tier stays visually absent (no lonely header).
                Patch #137: live isWorking + inActiveSet wiring per row.
                The panel-level activeSet subscription is hoisted once
                (above); each row's isWorking is read inside
                PrettyConversationRowLive so the store subscription happens
                at a stable hook-call site. Same wiring repeats at the two
                grouped render sites below. Patch #144 Fix (e): pinned rows
                now share the same `pv-panel-group` wrapper as the grouped
                sections so intra-group row gap (8px) is uniform with
                between-group gap. */}
            <div className="pv-panel-group" data-pinned-group="true">
              {displayedPinned.length > 0 && (
                <div
                  className={`flex items-center gap-2 px-4 pb-1.5 ${
                    displayedActiveSetRows.length > 0 ? "pt-3" : "pt-0.5"
                  }`}
                  data-testid="pinned-divider"
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
              )}
              {displayedPinned.map((row) => (
                <PrettyConversationRowLive
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  pinned={true}
                  hidden={hiddenIds.has(row.id)}
                  variant={variant}
                  onSelect={() => handleRowSelect(row)}
                  onTogglePin={() => handleTogglePin(row.id)}
                  onDeactivate={() => handleRowDeactivate(row)}
                  onToggleHide={() => handleToggleHide(row)}
                  onClone={() => handleRowClone(row)}
                  inActiveSet={activeSet.has(row.id)}
                  sessionKey={sessionWorkingKey(row)}
                  subtitleMode="identityTitle"
                />
              ))}
            </div>
            {/* Grouped rows — FLAT per Ashley/prototype lock: no per-host
                semibold header. The `__rdp__` sentinel group renders a
                subtle "Remote desktop" divider chip above its rows.  */}
            {displayedGrouped.map((group) => {
              if (group.hostId === "__rdp__") {
                return (
                  <div
                    key={group.hostId}
                    className="pv-panel-group"
                    data-rdp-group="true"
                  >
                    {/* Subtle RDP divider chip — mirrors prototype.html
                        .rdp-divider block: small Monitor glyph +
                        uppercase muted label + gradient rule. Rendered
                        ONCE above the RDP row cluster regardless of how
                        many RDP rows exist. */}
                    <div
                      className="flex items-center gap-2 px-4 pt-3 pb-1.5"
                      data-testid="rdp-divider"
                    >
                      {/* quick-260727-f9v: brightness bumped from /50 → /85
                          on BOTH icon and label so this chip reads at the
                          same weight as the new per-host chips below. */}
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
                    {group.rows.map((row) => (
                      <PrettyConversationRowLive
                        key={row.id}
                        row={row}
                        selected={row.id === selectedId}
                        pinned={false}
                        variant={variant}
                        onSelect={() => handleRowSelect(row)}
                        onTogglePin={rdpNoopTogglePin}
                        onDeactivate={() => handleRowDeactivate(row)}
                        inActiveSet={activeSet.has(row.id)}
                        sessionKey={sessionWorkingKey(row)}
                      />
                    ))}
                  </div>
                );
              }
              // Regular host group — quick-260727-f9v: the earlier
              // "FLAT per Ashley/prototype lock" was intentionally
              // reversed. Each non-RDP host group now renders a divider
              // chip above its rows (mirrors the RDP chip's treatment,
              // Server glyph + uppercase hostName + gradient rule), AND
              // the rows within receive `subtitleMode="identityTitle"`
              // so the sublabel reads as identity.title (falling back to
              // identity.displayName; further fallback to hostname+Server
              // icon when no identity resolves — the row's built-in
              // safety net). Active-set + pinned + RDP render sites are
              // UNTOUCHED (they omit subtitleMode → default "hostname").
              return (
                <div key={group.hostId} className="pv-panel-group">
                  <div
                    className="flex items-center gap-2 px-4 pt-3 pb-1.5"
                    data-testid="host-divider"
                    data-host-id={group.hostId}
                  >
                    <Server
                      className="size-3 text-[#5c6070]/85 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
                      {group.hostName}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
                    />
                  </div>
                  {group.rows.map((row) => (
                    <PrettyConversationRowLive
                      key={row.id}
                      row={row}
                      selected={row.id === selectedId}
                      pinned={pinnedIds.has(row.id)}
                      hidden={hiddenIds.has(row.id)}
                      variant={variant}
                      onSelect={() => handleRowSelect(row)}
                      onTogglePin={() => handleTogglePin(row.id)}
                      onDeactivate={() => handleRowDeactivate(row)}
                      onToggleHide={() => handleToggleHide(row)}
                      onClone={() => handleRowClone(row)}
                      inActiveSet={activeSet.has(row.id)}
                      sessionKey={sessionWorkingKey(row)}
                      subtitleMode="identityTitle"
                    />
                  ))}
                </div>
              );
            })}
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
                      selected={row.id === selectedId}
                      pinned={false}
                      hidden={true}
                      variant={variant}
                      onSelect={() => handleRowSelect(row)}
                      onTogglePin={() => handleTogglePin(row.id)}
                      onToggleHide={() => handleToggleHide(row)}
                      onClone={() => handleRowClone(row)}
                      inActiveSet={activeSet.has(row.id)}
                      sessionKey={sessionWorkingKey(row)}
                      subtitleMode="identityTitle"
                    />
                  ))}
              </div>
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
        />
      )}
      {/* Phase 22 (SRIC-04 + SRIC-05): CreateRoleDialog — portal-mounted
          sibling of NewSessionDialog. Gated on the SAME showPencilButton
          predicate so both dialogs share their onCreateSession-wired
          lifecycle. Phase 22 SRIC-05 wires onChainToCreateIdentity: when
          CreateRoleDialog submits with the chain checkbox CHECKED (default),
          this callback fires with {role, host} — we close CRD, stash the
          pre-fill in chainPrefill state, and open NewSessionDialog which
          then reads chainPrefill via its new initialHost + initialRole
          props (Plan 22-05 Task 1). */}
      {showPencilButton && (
        <CreateRoleDialog
          open={createRoleDialogOpen}
          onClose={() => setCreateRoleDialogOpen(false)}
          hostTree={hostTree ?? null}
          onChainToCreateIdentity={(opts) => {
            // Phase 22 SRIC-05: on CRD chain fire → close CRD, stash pre-fill,
            // open NSD with initialHost + initialRole seeded.
            setCreateRoleDialogOpen(false);
            setChainPrefill(opts);
            setNewSessionDialogOpen(true);
          }}
        />
      )}
      {/* Phase 22 (SRIC-03): CloneAgentDialog — portal-mounted sibling of the
          NewSessionDialog + CreateRoleDialog mounts. Not gated on
          showPencilButton because the Clone flow is reachable from any row's
          context menu regardless of whether the pencil is wired (the row's
          onClone prop is only threaded when handleRowClone can capture the
          source identity + hostId — so the guard lives at the wiring layer,
          not the mount layer). */}
      <CloneAgentDialog
        open={cloneDialogState !== null}
        onClose={() => setCloneDialogState(null)}
        sourceIdentity={cloneDialogState?.sourceIdentity ?? null}
        hostId={cloneDialogState?.hostId ?? null}
        onCloned={() => {
          // Mirror NewSessionDialog's post-birth refresh: the identities-store
          // loads once on first useIdentities() mount and never re-fetches on
          // its own, so a fresh clone row is absent from byKey lookups until
          // this fires. Without it the sidebar row renders with empty title,
          // no colorHue, and the default avatar even though the DB row is
          // fully populated.
          void refreshIdentities();
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
          {[
            { label: "New agent", onClick: () => setNewSessionDialogOpen(true) },
            { label: "New role", onClick: () => setCreateRoleDialogOpen(true) },
            { label: "Edit global files…", onClick: () => setGlobalFilesModalOpen(true) },
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
