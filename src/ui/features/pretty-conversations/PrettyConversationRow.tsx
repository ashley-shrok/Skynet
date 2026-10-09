// ─── PrettyConversationRow ───────────────────────────────────────────────────
// Phase 48 Plan 05 (v14 locked shape, user 2026-08-19) — biggest surface
// change since Phase 41 Plan 01. Retired vs pre-Phase-48:
//   * `.pv-meta` right column — element removed from the row entirely; the
//     right-column grid slot is gone. Bounty badges were relocated to avatar
//     corners (Pin + Monitor); ready-dot deleted outright. Phase 104 Plan 03
//     later retired the two bounty-count badges themselves alongside the
//     bounty-count wire; the trapped-work indicator (Phase 104 Plan 02) is now
//     the sole avatar-corner affordance.
//   * The pre-Phase-48 ready-dot span (with its inline display-block hack)
//     plus the 4-input `isWorking-false + !isRecycling` JSX render gate — the
//     "come look" cue is now INVERTED: idle rows have
//     NOTHING; working rows get a slow dashed spinner ring painted on
//     `.pv-avatar::before` (CSS only; no JSX element for the spinner).
//   * `.pv-host` Server-icon rendering — hostname migrates to the title line
//     wrapped in parens (`identityName (hostname)`); the subtitle line becomes
//     the aiTitle text (or an italic ellipsis placeholder when aiTitle is null).
//   * `subtitleMode` prop-driven sublabel branching — the prop is still
//     ACCEPTED on the interface for backward compat with the 5 panel render
//     sites (search-flat, pinned, middle, RDP, hidden), but its value has no
//     runtime effect: the subtitle is always the aiTitle string (or the
//     placeholder ellipsis when null). Kept in the interface so a plan-scope
//     grep-and-remove pass across all 5 render sites is a follow-up concern.
// New in Phase 48 Plan 05:
//   * Title-line hostname suffix: `<span className="pv-hostname-suffix">
//     ({row.host.name})</span>` — parens same font-size as identity name,
//     alpha 0.85 (CSS-owned).
//   * Subtitle line: `<span className="pv-ai-title">{aiTitle}</span>` when
//     aiTitle is truthy; `<span className="pv-ai-title pv-ai-title--placeholder">
//     …</span>` when aiTitle is null. Muted italic ellipsis anchors row height
//     regardless of ai-title presence.
//   * `.pv-avatar` originally gained Pin + Monitor bounty-count badge corners
//     in Phase 48 Plan 05 (retired in Phase 104 Plan 03 alongside the
//     bounty-count wire). The current avatar-corner affordance is the
//     Phase 104 Plan 02 trapped-work indicator.
//   * `showSpinnerOn` JS-computed boolean (user 2026-09-21 decouple from
//     active-set, superseding the 2026-08-20 active-set-scoped shape). The
//     spinner is a pure agent-readiness signal: ON when the agent is
//     working or recycling, regardless of whether this client happens to
//     have the tab open. `activeSet` is a per-tab client-side artifact and
//     was the wrong axis to gate on — the same agent's readiness appeared
//     or disappeared depending on the client's tab history. Concretely:
//     `showSpinnerOn = isWorking === true || isRecycling`.
//     Both are backend-authoritative via the fleet-status poller (Plan
//     53-03). Emitted as the `spinner-on` className on `.pv-row` (see
//     className composition below). CSS keys off
//     `.pv-row.spinner-on .pv-avatar::before` — single class match; all
//     inputs live in JS, CSS is the paint layer only.
//
// Phase 13 Plan 01 (user 2026-07-23 lift-from-mock v4) — as amended by
// Phase 41 Plan 01 (user 2026-08-14 ambient-retirement): the row renders the
// mock's semantic markup with class-toggle state variants. Every visual
// definition (base body, avatar disc, selected treatment, hover, RDP,
// spinner ring) lives in pretty-conversations.css.
//
// Phase 41 Plan 01 retired the ambient-recession visual entirely: this
// component no longer derives the pre-Phase-41 amb-recession flag and no
// longer toggles the recession className. The related CSS block is deleted;
// every row carries the same visual weight regardless of active-set membership.
// The `inActiveSet` prop is PRESERVED — it still drives the deactivate-
// action visibility gate (`.active-set` classname toggle at L873 below).
// Only the ambient VISUAL axis retired.
//
// This component keeps only the surviving JS-only concerns:
//
//   - Working-spinner gate (user 2026-09-21 decouple from active-set):
//     JS computes `showSpinnerOn = isWorking === true || isRecycling`.
//     Backend-authoritative via the fleet-status poller; no client-side
//     scope. Emitted as the `spinner-on` className on `.pv-row`; CSS at
//     `.pv-row.spinner-on .pv-avatar::before` paints the slow dashed
//     spinner ring. All inputs live in JS; CSS is the paint layer only.
//   - Avatar image src selection (identity.avatarUrl vs initial letter vs
//     tabIcon fallback).
//   - Click / keyboard / touch handlers, aria-labels, `--pv-hue` custom
//     property emission for hue-bearing rows.
//   - Mobile long-press → context menu (quick-260802-pq2): a 500ms touch
//     hold with <10px movement opens the SAME PrettyConversationContextMenu
//     desktop right-click uses, at the touch coordinates. Replaces the
//     retired swipe-to-reveal action strip (which had a bleed-through class
//     of bug through translucent ambient/hidden row backgrounds — bounty
//     `swipe-actions-visible-through-translucent-rows`). Nothing painted
//     behind rows = no bleed-through, ever.
//
// State variants are className toggles composed via `cn`:
//   className={cn('pv-row', variantClass, selected && 'selected',
//     inActiveSet && 'active-set', isWorking === true && 'working',
//     pinned && 'pinned', isRdp && 'rdp')}
// (Phase 41 Plan 01 dropped the retired amb-recession className toggle.)
//
// The ONE inline style on `.pv-row` is `{'--pv-hue': hue}` for hue-bearing
// rows. Post-pq2 mobile has no transform (no swipe machinery) — the row body
// is a static CSS-rendered card in both variants.
//
// Retired vs pre-Phase-13:
//   - All JS-computed CSSProperties for base body / avatar / selected /
//     hover overlays (~250 lines) — now in pretty-conversations.css as
//     class-toggled selectors. (Ambient overlays formerly in this list
//     were retired entirely in Phase 41 Plan 01.)
//   - `useState(hover)` + onMouseEnter/onMouseLeave handlers — CSS `:hover`
//     handles hover natively.
//   - `PC_ROW_MIN_H_MOBILE/DESKTOP` tokens — CSS variants (`.pv-row--mobile`
//     vs `.pv-row--desktop`) handle density.
//   - Tailwind layout scaffolding (`flex-1 min-w-0 flex flex-col gap-0.5`,
//     `shrink-0 flex items-center gap-1.5`, `rounded-full`, `w-12 h-12` /
//     `w-10 h-10`, `px-4 py-3` / `px-3 py-2.5`, `gap-3` / `gap-2.5`) on the
//     row/avatar/body/meta divs — CSS handles layout via `display: flex`,
//     `flex: 1`, `padding`, etc.
//   - quick-260802-pq2: swipe state machine (swipedOpen / dxLive / start refs /
//     onTouchStart / onTouchMove / onTouchEnd), swipe-reveal strip JSX,
//     PinAction / DeactivateAction / HideAction imports (only rendered inside
//     the retired strip), PC_SWIPE_* tokens, forceClosed / onSwipeOpenChange
//     props, data-swiped-open attribute.
//
// Identity carry-through mirrors ConversationRow.tsx lines 41-47 verbatim so
// identity-tinted rows keep the same "which session is this" reading after
// the sidebar is retired.

import {
  useCallback,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Pin, GitPullRequestDraft } from "lucide-react";

import { tabIcon } from "@/shell/tabUtils";
import { sessionMatchKey } from "@/features/terminal/session-hue";
import { useIdentities } from "@/state/identities-store";
// quick-260912-0t4: type-only import for the byHostKey → byKey fallback IIFE
// return-type annotation (see identity-resolution block below).
import type { Identity } from "@/api/identities-api";
// Phase 68 Plan 04: avatarUrlWithHost DELETED — backend bakes hostId into identity.avatarUrl.
// Phase 104 Plan 02: per-identity trapped-work indicator (D-05, D-06, D-07).
import { useTrappedWork } from "@/state/trapped-work-store";
import { cn } from "@/lib/utils";
import { armOutboundDrag, mintDragId } from "@/shell/cross-window-drag";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";
import { specForTab, encodeWorkspaceSpec } from "@/lib/tab-url";
import { identityRolesLabel, isMultiRole } from "@/lib/identity-roles";

// shape-sidebar-header-affordances: row context menu + long-press machinery
// retired; the row's five actions now live in a RowKebabMenu rendered inside
// the row body. Hover-reveal on desktop + always-visible on mobile is applied
// at the kebab's wrapper div (opacity-100 at <md, md:opacity-0 →
// md:group-hover:opacity-100 at md+). RowKebabMenu's portal-click-containment
// prevents item-click leaks to the row's onClick (row body is a clickable
// surface for session selection).
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
  type RowKebabSubmenuItem,
} from "./RowKebabMenu";

// ─── Prop shape ──────────────────────────────────────────────────────────────
// `variant` drives the density class (`pv-row--mobile` vs `pv-row--desktop`)
// AND the long-press wiring gate (mobile-only). Desktop rows never arm the
// long-press timer.
//
// quick-260802-pq2: the swipe machinery (forceClosed / onSwipeOpenChange
// props, PC_SWIPE_* tokens, swipedOpen state, transform emission,
// reveal-strip JSX) was fully removed. The mobile row exposes the same
// context menu desktop right-click uses via a 500ms long-press touch hold.

// Set the native `title` attribute on hover iff the element's text is truncated
// (scrollWidth > clientWidth). Wired to `.pv-label` and `.pv-ai-title` spans so
// long task strings surface a tooltip with the full text, without showing a
// redundant tooltip when the text already fits.
function setTitleIfOverflowing(e: React.MouseEvent<HTMLElement>): void {
  const el = e.currentTarget;
  if (el.scrollWidth > el.clientWidth) {
    el.title = el.textContent ?? "";
  } else {
    el.removeAttribute("title");
  }
}

// Row-level unified tooltip: shows the identity's displayName so the user can
// tell which identity the convo is for without opening it; appends the full
// task on a second line iff the task label is currently truncated. Subsumes
// the per-span overflow tooltip in the task-primary branch.
function setRowTooltip(
  displayName: string | null | undefined,
  task: string | null | undefined,
): (e: React.MouseEvent<HTMLElement>) => void {
  return (e) => {
    const rowEl = e.currentTarget;
    if (!displayName) {
      rowEl.removeAttribute("title");
      return;
    }
    const label = rowEl.querySelector<HTMLElement>(".pv-label");
    const overflowing = !!label && label.scrollWidth > label.clientWidth;
    rowEl.title = task && overflowing ? `${displayName}\n${task}` : displayName;
  };
}

export function PrettyConversationRow({
  row,
  selected,
  pinned,
  variant,
  onSelect,
  onTogglePin,
  onDeactivate,
  onArchive,
  onKill,
  onMoveToProject,
  projects = [],
  currentProjectSlug = null,
  isWorking = null,
  isRecycling = false,
  inActiveSet = false,
  subtitleMode = "hostname",
  aiTitle = null,
}: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  // Fired by the "Pinned" entry of the Move-to submenu (when `pinned` is
  // false) and by its "Unpin" leaf (when true). Omitted for rows that can't
  // be pinned (relay rooms, non-identity terminals — no `.pinned` sentinel
  // to write); Pinned is then left out of the submenu.
  onTogglePin?: () => void;
  // quick-260727-gm3: fired when user clicks the red-tinted Deactivate
  // menu item (desktop right-click OR mobile long-press). MUST be provided by
  // the panel whenever inActiveSet === true — otherwise the menu item is
  // filtered out at items[] build time. See
  // PrettyConversationsPanel.handleRowDeactivate for the store-mutation +
  // tab-close composition. As of quick-260804-uo4, RDP rows also receive this
  // prop (RDP context menu is now enabled).
  onDeactivate?: () => void;
  /**
   * Phase 115 Plan 115-06 (D-01 / D-02 / D-03): fired when user clicks the
   * red Archive menu item. When provided, the Archive item appears in the
   * context menu (row + badge). The PANEL is responsible for gating this
   * prop on fleet-synthetic identity-backed rows only (via
   * canonicalArchiveIdForRow) — the row component itself just renders when
   * the prop is present.
   *
   * The confirmation dialog + the actual archiveIdentity() call live at the
   * panel level (handleArchive), not here — this callback simply fires;
   * handleArchive owns the window.confirm + POST + pane-close composition.
   */
  onArchive?: () => void;
  /**
   * quick-260810-n3a: Fired when user clicks the red Kill menu item.
   * Provided by the panel only when !isRdp && !identity && row.targetTmuxSession.
   * The panel wraps the actual kill in a window.confirm — this callback fires
   * ONLY on confirm=true. See PrettyConversationsPanel.handleRowKill.
   */
  onKill?: () => void;
  /**
   * shape-move-to-project-context-menu (2026-09-23): fired when the user
   * picks a project (or "Remove from project") from the row's context-menu
   * drill-in submenu. Called with the target project slug, or `null` to
   * clear the assignment (null-clears semantic, matching setSessionProject
   * / setRelayRoomProject). The panel wires this to the same routing
   * handleProjectDrop uses (identity vs relay-room based on the row's own
   * data). The panel gates this prop on !isRdp AND projects.length > 0, so
   * absence at the row is the row's signal to leave projects (and "Remove
   * from project") out of the "Move to" submenu.
   */
  onMoveToProject?: (slug: string | null) => void;
  /**
   * shape-move-to-project-context-menu (2026-09-23): the project list shown
   * inside the "Move to" submenu, in the same order the sidebar
   * renders its project sections. Empty array is the "zero projects"
   * signal — combined with `onMoveToProject` being provided/absent, the
   * row's items[] gate handles hiding the parent item.
   */
  projects?: readonly { slug: string; displayName: string }[];
  /**
   * shape-move-to-project-context-menu (2026-09-23): the slug of the
   * project this row currently belongs to, or `null` if unassigned. Drives
   * the checkmark on the currently-assigned project inside the submenu,
   * the "Remove from project" visibility (only shown when non-null), and
   * the silent-no-op behavior when tapping the currently-assigned project
   * (fires no setter, just closes the menu).
   */
  currentProjectSlug?: string | null;
  // Patch #137: WS-published working state for the row's (host, tmux)
  // pair. `true` = agent busy, `false` = idle, `null` = unknown
  // (backend hasn't published yet). Only `false` allows the ready-dot
  // to render; `null` and `true` both suppress. Panel resolves via
  // useSessionWorking(sessionWorkingKey(row)).
  isWorking?: boolean | null;
  // quick-260730-qbl: true when the row's pretty-view surface is currently
  // rendering SessionHoldingOverlay (patch #74). Suppresses the ready-dot
  // regardless of other conditions — a row whose pane is showing the
  // "session recycling…" overlay is NOT ready for user's next
  // instruction, so showing the ready-dot would be a false-positive
  // signal. Phase 53 Plan 03: Panel resolves via useSessionIsRecycling
  // (working-store Axis E, backend-authoritative) — keyed identically
  // to useSessionIsWorking: `${hostId}:${tmuxSession ?? ""}`.
  isRecycling?: boolean;
  // Phase 47 Plan 04 — the identity's freshest ai-title sourced from the
  // working-store's aiTitle axis (Plan 47-03 LAST-WINS chokepoint). Null
  // when no ai-title has been published yet, or when this row has no
  // working-store key (RDP rows via sessionKey === null → hook short-
  // circuits). Panel resolves via useSessionAiTitle(sessionWorkingKey(row))
  // — keyed identically to the isWorking / isRecycling stores. Consumed
  // in Plan 47-05 as the row's subtitle content; NOT yet
  // rendered by this component's tree — the prop is accepted here so the
  // type surface is stable before Plan 47-05 wires the visual. Default
  // null so tests constructing the row without the prop keep working.
  aiTitle?: string | null;
  // Patch #137 (updated Phase 41 Plan 01): whether this row is in user's
  // active-set (any session she has selectConversation-ed in this browser-tab
  // session). Phase 41 retired the ambient-recession visual entirely, so this
  // flag no longer controls "full-bubble vs recessed" appearance — every row
  // carries the same visual weight. The flag SURVIVES because it still gates:
  //   1. The `.active-set` className toggle at L873, which drives the
  //      deactivate-action hover-reveal CSS at pretty-conversations.css:978/994.
  //   2. Context-menu item gating (Move-vs-Open new-window side effect).
  inActiveSet?: boolean;
  // quick-260727-f9v: sublabel render mode.
  //   "hostname"      → default; sublabel renders hostname + Server icon
  //                     (verbatim pre-f9v behavior, backward-compatible).
  //   "identityTitle" → sublabel renders identity.title (falling back to
  //                     identity.displayName when title is null), and the
  //                     Server icon is DROPPED (the per-host divider chip
  //                     rendered by the panel above the group already
  //                     carries the Server glyph, so duplicating it here
  //                     would be noisy). If no identity resolves, the
  //                     row falls back verbatim to "hostname" mode as a
  //                     terminal safety net — see the render block below
  //                     and Tina's patch #149 lesson in the plan.
  //
  // RDP render site omits the prop → default "hostname" (RDP rows don't
  // resolve identities). Pinned + grouped + active-set render sites all
  // pass "identityTitle" (patch #184 for pinned, quick-260727-f9v for
  // grouped, patch #195 for active-set — closes the last scope gap).
  subtitleMode?: "hostname" | "identityTitle";
}) {
  // ─── Identity resolution ───────────────────────────────────────────────────
  // quick-260912-0t4: scope identity lookup by hostId so two identities sharing
  // a name across different fleet hosts (e.g. willow on workstation vs t1000)
  // don't collide on `byKey.get("willow")` — each row picks the RIGHT identity
  // for its pane's host. Relay-room rows (`row.host === undefined`) can't have
  // an identity anyway, so hostId=NaN → identity=null.
  //
  // Backwards-compat fallback: try byHostKey first; when it misses (either
  // because the row lacks a host, or because a test fixture only seeds byKey,
  // or because the wire response predates the hostId field), fall back to
  // bare-name byKey. In production the backend surfaces hostId on every row
  // (per publicIdentity() + Task 1 dedup removal) so byHostKey hits first;
  // the fallback exists solely to preserve legacy test fixtures and to
  // survive the ms-window before the first fleet-populated fetch resolves.
  const { byHostKey: identitiesByHostKey, byKey: identitiesByKey } = useIdentities();
  const key = sessionMatchKey(row.targetTmuxSession);
  const isRdp = row.rdpHostRow === true;

  // Host.id is a string in the fork's ui-types; we convert with parseInt
  // (same shape AppShell uses at openTab hostId derivation). Hoisted above
  // the identity lookup so the byHostKey composite key can use it; also
  // consumed by useTrappedWork below.
  const rowHostIdNum = row.host ? parseInt(row.host.id, 10) : NaN;

  const identity: Identity | null = (() => {
    if (!key) return null;
    if (Number.isFinite(rowHostIdNum)) {
      const scoped = identitiesByHostKey?.get(`${rowHostIdNum}::${key}`);
      if (scoped) return scoped;
    }
    return identitiesByKey?.get(key) ?? null;
  })();
  const hue: number | null = identity?.colorHue ?? null;

  // Phase 104 Plan 02 (D-05, D-06, D-07): per-identity trapped-work snapshot.
  // Hook short-circuits to undefined when identityKey is null. Both undefined
  // (pre-fetch / non-identity row) AND {hasTrappedWork:false} render nothing
  // — the indicator gates on strict `=== true` at the JSX site below.
  //
  // Phase 104 code-review finding #3: hostIdNum > 0 matches the WS handler's
  // coercion (claude-session-server.ts:1211-1216). Any non-positive hostId
  // (0 or negative) routes as local; without this gate, the row keys the
  // store on `${...}:0` but the response echoes hostId=null → lookup misses.
  const trappedWork = useTrappedWork(
    identity?.identityKey ?? null,
    Number.isFinite(rowHostIdNum) && rowHostIdNum > 0 ? rowHostIdNum : null,
  );

  // Phase 41 Plan 01 (user 2026-08-14): the pre-Phase-41 amb-recession
  // derivation (`!isRdp && !inActiveSet`) and its className toggle were
  // retired here. The related CSS block is deleted; every row carries the
  // same visual weight. `isRdp` and `inActiveSet` survive as separate flags
  // for their other consumers (deactivate-action gating, context-menu item
  // wiring — see the className composition below).

  const isMobile = variant === "mobile";
  const variantClass = isMobile ? "pv-row--mobile" : "pv-row--desktop";

  // shape-sidebar-header-affordances: useIsTouchDevice / acceptsTouch gating
  // + DEV-only touch-handler-wired breadcrumb RETIRED alongside the context
  // menu + long-press machinery. Row context menu is now a RowKebabMenu
  // rendered inside the row body (hover-reveal on desktop, always-visible on
  // mobile via a CSS-only group-hover + viewport-width gate at the kebab's
  // wrapper div — no runtime touch-device detection needed).

  // Phase 56 Plan 03 (user 2026-08-28 shape file):
  // HTML5 native drag. Coexists with the existing tap-select (onClick),
  // touch long-press context menu (500ms timer inside onTouchStart), and
  // desktop right-click context menu (onContextMenu). Browser's built-in
  // drag threshold (~5px on desktop,
  // long-press-and-move on touch) is the disambiguation mechanism — no manual
  // dx/dy gate is needed. The dataTransfer payload shape (`text/plain` with
  // the row's tab id) is the wire contract with `SplitView.tsx`'s Pane onDrop
  // handler, established by Plan 56-02 and preserved verbatim.
  const onRowDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Patch #511: the drop handler needs enough info to reproduce the
      // click-flow's row-type priority ladder (rdpHostRow → openTab rdp;
      // fleetOnly → openTab terminal with targetTmuxSession; otherwise
      // treat as already-open tab id). Patch #509/510 wrote only row.id,
      // which silent-no-op'd on selectConversation when the row was a
      // fleet-only detached row (not yet in openTabs) — the split then
      // referenced a tab id that didn't exist, rendering an empty "Pane
      // 1 empty" cell in place of the intended session.
      //
      // Cross-window drag (2026-09-17): mint a dragId and arm the outbound
      // drag so a drop in a DIFFERENT same-origin Skynet window can echo
      // the dragId back via BroadcastChannel; AppShell's accept subscriber
      // then closes this window's source tab (hard-move semantics). Rows
      // already carry the descriptor pieces (host + targetTmuxSession +
      // fleetOnly + rdpHostRow) that AppShell's resolveRowPayloadTabId
      // needs to open a fresh session in the target window, so no new
      // fields are needed here — just the dragId.
      const dragId = mintDragId();
      armOutboundDrag(dragId, row.id);
      e.dataTransfer.setData("text/plain", row.id);
      // Phase 117 Plan 117-08: DnD payload extended with `matrixRoomId` +
      // `identityKey` so the projects drop-lane handler at PrettyProject
      // SectionHeader → PrettyConversationsPanel can route the drop to
      // setRelayRoomProject (relay-room rows) vs setSessionProject (identity
      // rows) without a second store lookup at the drop site. Both fields
      // are OPTIONAL on the wire — null-carrier is the row's kind marker:
      //   - matrixRoomId set (row.kind === "relay-room") → relay-room path
      //   - identityKey set (identity row) → identity path
      //   - neither → fleet-only row falls through the panel's guard
      // Backward-compat: the pre-117-08 SplitView Pane onDrop reads only
      // `id`, so the added fields are additive per the row-shape's
      // "backward-compat rule per PATTERNS.md" (see Phase 90 Plan 07 Task 3
      // comment at PrettyConversationRow.tsx L119-134).
      e.dataTransfer.setData(
        "application/x-skynet-row",
        JSON.stringify({
          id: row.id,
          dragId,
          host: row.host ?? null,
          targetTmuxSession: row.targetTmuxSession ?? null,
          fleetOnly: row.fleetOnly === true,
          rdpHostRow: row.rdpHostRow === true,
          matrixRoomId: row.roomId ?? null,
          // roomTitle carries the human-readable relay-room label so a
          // cross-window resolver can label the freshly-opened target tab
          // (openTab's label option). Null for non-relay rows.
          roomTitle: row.roomTitle ?? null,
          identityKey: identity?.identityKey ?? null,
        }),
      );
      e.dataTransfer.effectAllowed = "move";
    },
    [
      row.id,
      row.host,
      row.targetTmuxSession,
      row.fleetOnly,
      row.rdpHostRow,
      row.roomId,
      row.roomTitle,
      identity?.identityKey,
    ],
  );

  // shape-sidebar-header-affordances: long-press timer unmount cleanup +
  // notifyMenuClosed singleton drain RETIRED (both targeted machinery that no
  // longer exists). RowKebabMenu's Radix implementation manages its own
  // open/close lifecycle via portal.

  // ─── Row-body click ────────────────────────────────────────────────────────
  // Mobile short-tap AND desktop click both fire onSelect. The pre-shape-3
  // suppressNextClickRef gate (which caught the synthesized click following a
  // long-press on real browsers) is retired alongside the long-press timer.
  const onBodyClick = useCallback(() => {
    onSelect();
  }, [onSelect]);

  const onBodyKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onBodyClick();
      }
    },
    [onBodyClick],
  );

  // ─── Class composition ────────────────────────────────────────────────────
  // Every state variant is a CSS class toggle; the CSS file (pretty-
  // conversations.css) handles all visual response. Phase 41 Plan 01 retired
  // the amb-recession className toggle — the corresponding CSS block is
  // deleted so the row no longer emits that class.

  // Working-spinner gate (user 2026-09-21 decouple from active-set).
  // `activeSet` is a per-tab client-side artifact — a sessionStorage-backed
  // set of tab ids this ONE client currently has open or recently opened.
  // Gating spinner visibility on it made the same agent's readiness appear
  // or disappear depending on which client the user was looking from, which
  // is the wrong axis. `isWorking` and `isRecycling` are already backend-
  // authoritative via the fleet-status poller (Plan 53-03), so the spinner
  // now lights on the fleet signal alone regardless of which client has
  // the tab open.
  //
  //   showSpinnerOn = isWorking === true || isRecycling
  //
  // Emitted as the `spinner-on` className on `.pv-row`; CSS matches on that
  // single class alone at `.pv-row.spinner-on .pv-avatar::before`. The
  // `.active-set` class is still emitted from `inActiveSet` for the other
  // things active-set legitimately drives (deactivate hover-reveal,
  // "Open in new window" menu behavior) — it just no longer gates the
  // spinner.
  const showSpinnerOn = isWorking === true || isRecycling;

  const rowClassName = cn(
    "pv-row",
    variantClass,
    selected && "selected",
    inActiveSet && "active-set",
    isWorking === true && "working",
    showSpinnerOn && "spinner-on",
    isRecycling === true && "recycling",
    pinned && "pinned",
    // Phase 41 Plan 01: amb-recession className toggle retired.
    // (Phase 115 post-code-review fix 3: `hidden && "hidden"` className toggle
    //  retired alongside the Hide/Show menu branch — hidden prop is gone.)
    isRdp && "rdp",
    isMultiRole(identity) && "pv-multi-role",
  );

  // ─── Hue custom property ─────────────────────────────────────────────────
  // The ONLY structural inline style on `.pv-row` is `--pv-hue: {hue}` for
  // hue-bearing rows.
  const bodyStyle: CSSProperties =
    hue !== null ? ({ "--pv-hue": hue } as CSSProperties) : {};

  // ─── Render tree ───────────────────────────────────────────────────────────
  const wrapperClass = "relative";

  const initialLetter = identity
    ? (identity.displayName ?? "?").charAt(0).toUpperCase()
    : null;

  // Kebab items (shared by the ⋮ trigger and right-click on the row body).
  // (Open in new window / Move to / Kill / Archive).
  const kebabItems = ((): RowKebabMenuItem[] => {
    const items: RowKebabMenuItem[] = [];
    // Open in new window — desktop-only, only when the row is URL-
    // addressable (specForTab produces a spec). Window.open without
    // "noopener" so we can detect popup-blocker returns null.
    if (!isMobile) {
      const spec = specForTab({ type: row.type, host: row.host, targetTmuxSession: row.targetTmuxSession });
      if (spec !== null) {
        items.push({
          label: "Open in new window",
          onClick: () => {
            const payload = encodeWorkspaceSpec({ tabs: [spec], activeIndex: 0, only: true });
            const w = window.open("#" + payload, "_blank");
            if (w !== null && inActiveSet) {
              onDeactivate?.();
            }
          },
          testId: "pv-row-kebab-item-open-new-window",
        });
      }
    }
    // Move to — drill-in submenu. Pinned and every project are destinations
    // of the same kind: a row is in at most one of them (pinned and in-a-
    // project are mutually exclusive), so they share one list with a
    // checkmark on wherever the row is now, followed by the leaf that takes
    // it out ("Unpin" / "Remove from project"). Pinned is offered when the
    // row is pinnable (onTogglePin); projects when the panel provides
    // onMoveToProject (non-RDP, this host has projects).
    {
      const submenu: RowKebabSubmenuItem[] = [];
      const canPin = onTogglePin !== undefined && !isRdp;
      if (canPin) {
        submenu.push({
          label: "Pinned",
          checked: pinned,
          onClick: () => {
            if (!pinned) onTogglePin?.();
          },
          testId: "pv-row-kebab-item-move-to-pinned",
        });
      }
      if (onMoveToProject) {
        for (const p of projects) {
          const isCurrent = p.slug === currentProjectSlug;
          submenu.push({
            label: p.displayName,
            checked: isCurrent,
            onClick: () => {
              if (!isCurrent) onMoveToProject(p.slug);
            },
            testId: `pv-row-kebab-item-move-to-${p.slug}`,
          });
        }
      }
      if (pinned && canPin) {
        submenu.push({
          label: "Unpin",
          onClick: onTogglePin,
          testId: "pv-row-kebab-item-unpin",
        });
      } else if (onMoveToProject && currentProjectSlug !== null) {
        submenu.push({
          label: "Remove from project",
          onClick: () => onMoveToProject(null),
          testId: "pv-row-kebab-item-remove-from-project",
        });
      }
      if (submenu.length > 0) {
        items.push({
          label: "Move to",
          submenu,
          testId: "pv-row-kebab-item-move-to",
        });
      }
    }
    // Kill — hard-terminates the underlying tmux session. Gated to
    // rows without an identity backing (identity rows have /id save
    // state and must not be nuked from a context menu).
    if (
      onKill &&
      !isRdp &&
      !identity &&
      row.targetTmuxSession !== null &&
      row.targetTmuxSession !== undefined
    ) {
      items.push({
        label: "Kill",
        onClick: onKill,
        danger: true,
        testId: "pv-row-kebab-item-kill",
      });
    }
    // Archive — gated on `onArchive` being provided. The panel
    // provides it only for fleet-synthetic identity-backed rows.
    if (onArchive) {
      items.push({
        label: "Archive",
        onClick: onArchive,
        danger: true,
        testId: "pv-row-kebab-item-archive",
      });
    }
    return items;
  })();
  const kebabContextMenu = useRowKebabContextMenu(kebabItems);

  return (
    <div
      className={wrapperClass}
      data-conversation-id={row.id}
      data-selected={selected ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
      data-variant={variant}
      data-rdp-host-row={isRdp ? "true" : undefined}
    >
      {/* Row body — the CSS file (pretty-conversations.css) handles all
          layout, background, border, shadow, hover, and state variants via
          the composed className. The only inline style is `--pv-hue` (for
          hue-bearing rows). shape-sidebar-header-affordances: `group` class
          added for the kebab's hover-reveal below. onTouchStart/Move/End/Cancel
          long-press handlers stay retired; onContextMenu opens the SAME kebab
          menu at the cursor (useRowKebabContextMenu) as a desktop convenience. */}
      <div
        role="button"
        tabIndex={0}
        draggable={true}
        aria-pressed={selected}
        onClick={onBodyClick}
        onContextMenu={kebabContextMenu.onContextMenu}
        onKeyDown={onBodyKeyDown}
        onMouseEnter={setRowTooltip(identity?.displayName, identity?.task)}
        onDragStart={onRowDragStart}
        style={bodyStyle}
        className={cn("group", rowClassName)}
      >
        {/* Phase 67 Plan 67-02 Track A: coordinator watermark. Renders iff the
            row's resolved identity carries `coordinator: true` on the wire
            (Phase 67 Plan 67-01 backend contract — safe-default false when
            the identity's on-disk YAML frontmatter has no coordinator key).
            FIRST child of .pv-row so it lands earliest in DOM order (aria-
            hidden keeps it silent for screen readers); z-index: 0 in
            pretty-conversations.css places paint order below the avatar +
            badges + text which have no explicit z-index (or positive) —
            paint order defers to z-index regardless of DOM order. Absence-
            of-marker is the actor contract: coordinator=false/undefined
            renders nothing here. Strict `=== true` guard means only the
            literal boolean true triggers the marker; any other truthy value
            (number, string, non-boolean) is treated as "no marker" per the
            Wave 1 narrowing contract that only ever writes true|false. */}
        {identity?.coordinator === true && (
          <span
            aria-hidden="true"
            data-testid="coordinator-watermark"
            className="pv-coordinator-watermark"
          />
        )}
        {/* Avatar disc — identity avatar OR initial letter OR tabIcon fallback.
            Phase 104 Plan 03: `.pv-avatar` now hosts ONLY the trapped-work
            indicator (Plan 02). The prior Pin + Monitor bounty-count badges
            were retired alongside the bounty-count wire in this plan. */}
        <div className="pv-avatar" data-testid="pcrow-avatar">
          {identity ? (
            // Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar
            // requires hostId query param. `rowHostIdNum` above is
            // parseInt(row.host.id, 10) when row.host is present; NaN when
            // absent. If NaN we can't fetch the avatar (backend 400s) so
            // fall back to the initial-letter placeholder rather than
            // producing a broken-image affordance. user 2026-09-01:
            // "some conversation-list rows show broken-image icons" — this
            // gates on avatarUrl truthiness (Phase 68: hostId is baked in by backend).
            identity.avatarUrl ? (
              <img
                // Phase 68 Plan 04: avatarUrlWithHost deleted — backend bakes hostId
                // into identity.avatarUrl at emit time; render directly.
                src={identity.avatarUrl}
                alt=""
                className="pv-avatar-img"
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
                draggable={false}
              />
            ) : (
              <span className="pv-avatar-initial">{initialLetter}</span>
            )
          ) : (
            <span className="pv-avatar-fallback-icon" aria-hidden="true">
              {tabIcon(row.type)}
            </span>
          )}
          {/* Phase 104 Plan 02 — trapped-work indicator (D-05, D-06, D-07).
              Bottom-right corner of the avatar in a warm-amber pilled disc.
              Gates on strict `=== true` — pre-fetch (undefined) AND
              hasTrappedWork:false both render nothing (D-06 start-absent +
              silent-for-non-participants). Icon: GitPullRequestDraft from
              lucide-react. Tooltip copy VERBATIM per D-07. No click behavior
              (hover-only affordance per D-05). */}
          {trappedWork?.hasTrappedWork === true && (
            <span
              className="pv-trapped-work-indicator"
              data-testid="pv-trapped-work-indicator"
              title="Has local work not yet pushed to any remote"
            >
              <GitPullRequestDraft
                className="pv-trapped-work-icon"
                aria-hidden="true"
              />
            </span>
          )}
        </div>

        {/* Body: title line + subtitle line.
            Phase 48 Plan 05 (user 2026-08-19) established the shape:
              Title line — identity displayName (or row.label as safety-net
              fallback) followed by a parenthetical suffix. Subtitle line —
              aiTitle (or `…` placeholder). Server icon dropped.

            inline-261001-conv-title-role-suffix (user 2026-10-01):
              The parenthetical PREFERS the identity's role display name over
              `row.host.name`. User verbatim: "right now it would show
              'Aqua (workstation)' but it should say the role instead of host
              like 'Aqua (Secretary)'". Role carries the "who is this" signal
              a glance needs; the host basically never matters.
              Resolution order:
                1. identity's roles → identityRolesLabel(identity)
                2. row.host?.name — fallback when identity has no role, or for
                   non-identity rows (unresolved sessions)
                3. absent — no parens at all
              Supersedes inline-260823's `identity.title || host.name` ladder;
              `identity.title` is no longer consulted for the no-task branch
              (parity with the task-primary branch, which already uses role).
              The CSS class name `pv-hostname-suffix` is kept for backward
              compat — it now styles a role OR hostname parenthetical. */}
        {/* Phase 80 Plan 08: gated task-primary body swap (D-03, D-06).
            When `identity?.task` is truthy → task-primary display:
              - Top line: the task string alone (reuses .pv-label typography).
              - Subtitle: role prominent via <strong> + (displayName) muted
                via existing .pv-hostname-suffix class.
              - The aiTitle drops entirely from this branch — user greenlit
                the drop per 80-CONTEXT specifics §last bullet ("do NOT quietly
                preserve it").
            When `identity?.task` is null/empty → fallback branch preserves the
            pre-Phase-80 markup VERBATIM (D-06 graceful degradation for legacy
            identities without task). Reuses .pv-label / .pv-hostname-suffix /
            .pv-ai-title verbatim per D-03 — no new CSS selectors invented at
            plan time. */}
        <div className="pv-body">
          {identity?.task ? (
            <>
              <span className="pv-label">{identity.task}</span>
              <span className="pv-ai-title">
                <strong>
                  {identityRolesLabel(identity)}
                </strong>
              </span>
            </>
          ) : (
            <>
              <span className="pv-label" onMouseEnter={setTitleIfOverflowing}>
                {identity ? identity.displayName : row.label}
                {(() => {
                  // inline-261001-conv-title-role-suffix: prefer role display
                  // name over host.name in the parens; host.name is the
                  // fallback for identities without a role, or for rows with
                  // no identity resolved at all.
                  const rolesLabel = identity ? identityRolesLabel(identity) : "";
                  const suffix = rolesLabel || row.host?.name;
                  return suffix ? (
                    <span className="pv-hostname-suffix"> ({suffix})</span>
                  ) : null;
                })()}
              </span>
              {aiTitle !== null ? (
                <span className="pv-ai-title" onMouseEnter={setTitleIfOverflowing}>{aiTitle}</span>
              ) : (
                <span className="pv-ai-title pv-ai-title--placeholder">…</span>
              )}
            </>
          )}
        </div>

        {/* Non-interactive pin indicator — absolute-positioned at the row's
            top-left corner so it reads as a row-level flag. Preserved from
            pre-Phase-48; the right-column meta wrapper retirement does NOT
            affect this element. Rendered iff `pinned`. */}
        {pinned && (
          <span
            className="pv-pin-indicator"
            aria-hidden="true"
            data-testid="pv-pin-indicator"
          >
            <Pin />
          </span>
        )}
        {/* Phase 48 Plan 05 — the right-column meta wrapper RETIRED entirely.
            Retired symbols and their replacements:
              - The pre-Phase-48 badges → Phase 104 Plan 03 retired those
                entirely (per-identity indicator wire deletion).
              - The pre-Phase-48 ready-dot span (with its inline display-block
                hack) plus the 4-input `isWorkingFalse + notRecycling +
                noQueuePending` JSX render gate → replaced by the CSS-painted
                spinner ring on `.pv-avatar::before` (see pretty-conversations
                .css). */}
        {/* shape-sidebar-header-affordances: row-level kebab menu. Positioned
            absolute, top-right of the row card. Hover-reveal on desktop
            (opacity-0 at md+, group-hover + group-focus-within bump to 100);
            always-visible on mobile (opacity-100 at <md where no hover
            exists). RowKebabMenu's portal-click-containment prevents item
            onClicks from leaking through to the row body's onClick. The
            items[] builder mirrors the retired PrettyConversationContextMenu
            items[] (Open in new window / Move to / Kill / Archive) with the
            same per-item eligibility gates. */}
        <div
          className="absolute top-1.5 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity shrink-0 z-[5]"
          data-testid="pv-row-kebab-slot"
        >
          <RowKebabMenu
            ariaLabel="Conversation menu"
            testId="pv-row-kebab-trigger"
            items={kebabItems}
          />
          {kebabContextMenu.menu}
        </div>
      </div>
    </div>
  );
}
