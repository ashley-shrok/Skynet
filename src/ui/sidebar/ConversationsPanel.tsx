// ─── ConversationsPanel ──────────────────────────────────────────────────────
// The Telegram-style list panel — renders the conversation-store's derived
// output as a flat, single-select, host-grouped list with pins on top.
//
// Drop-in for the HostsPanel content slot in AppShell's sidebar under a new
// RailView. Plan 06-01 landed the store + panel + row unwired; Plan 06-02
// (this plan) wires it into AppShell as the default RailView, extends it
// with the desktop gear-icon settings surface (Step F), and adds
// `onRailClick`/`isAdmin` props so the gear can route via AppShell's
// existing handleRailClick.
//
// Plan 06-04 owns the NewSessionButton insertion at the top of the scroller
// (the top slot was intentionally left unreserved in 06-01 for this).
//
// Reuses (do NOT reinvent):
//   - HostsPanel outer container idiom: <div className="relative flex flex-col
//     flex-1 min-h-0 overflow-hidden"> — matches the sidebar-panel-content-slot
//     size contract AppShell expects.
//   - SidebarTree FolderItem host-header style + empty-state idiom
//     (lines 941-943 / 1214-1220).
//   - SettingsRow.renderSettingsMenuItems for the canonical settings-surface
//     menu (shared with mobile SettingsRow — Plan 06-03 mounts that on
//     mobile viewports).
//
// Zero touches to AppShell (from this file), TabBar, MobileBottomBar,
// pretty-view, terminal, guacamole (Phase 6 scope-fence).

import { useState, type ReactNode } from "react";
import { MessagesSquare, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";
import {
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  selectConversation,
  togglePinConversation,
  type ConversationRow as ConversationRowShape,
} from "@/state/conversation-store";
import { ConversationRow } from "@/sidebar/ConversationRow";
import { renderSettingsMenuItems } from "@/sidebar/SettingsRow";
import { NewSessionButton } from "@/sidebar/NewSessionButton";
import { NewSessionDialog } from "@/sidebar/NewSessionDialog";
import type { RailView } from "@/sidebar/AppRail";
import type { Host, HostFolder } from "@/types/ui-types";

export function ConversationsPanel({
  onRailClick,
  isAdmin,
  onConversationSelected,
  settingsRowSlot,
  hostTree,
  onCreateSession,
}: {
  // Route to admin destinations via AppShell's handleRailClick. Passed in
  // from AppShell in Plan 06-02 Step G. Optional so the panel can render
  // in isolation (e.g. a Vitest smoke test that doesn't want to mock the
  // full sidebar-rail routing) — the gear icon is only shown when
  // onRailClick is provided.
  onRailClick?: (view: RailView) => void;
  isAdmin?: boolean;
  // Plan 06-03: fired AFTER the store's selectConversation runs on a row
  // tap. AppShell's mobile branch passes a handler that calls
  // navigateToView() so touchscreen viewports transition list→view.
  // Optional so desktop mounts + isolated tests don't have to supply it.
  onConversationSelected?: (id: string) => void;
  // Plan 06-03: mobile-only settings-row slot rendered at the bottom of
  // the scroll region (below the last host group, above any padding).
  // The desktop mount does NOT pass this — desktop reaches settings via
  // the gear icon in the header slot (Plan 06-02). Not competing with
  // pinned/active rows for prime attention per TG-10.
  settingsRowSlot?: ReactNode;
  // Plan 06-04: host tree fed into the NewSessionDialog's host picker.
  // AppShell threads its memoized realHostTree here. Optional so tests
  // can render the panel without wiring the picker.
  hostTree?: HostFolder | null;
  // Plan 06-04: fired when the user completes the NewSessionDialog with a
  // host + optional session name. AppShell wires this to openTab +
  // selectConversationDeferred + (on touchscreens) navigateToView. Panel
  // itself stays viewport-agnostic — no useIsTouchDevice call inside.
  // Optional so tests can render the panel without wiring the callback;
  // NewSessionButton is only mounted when this callback is provided
  // (Plan 06-04: no button in the isolated-test surface, either).
  onCreateSession?: (opts: { host: Host; sessionName?: string }) => void;
  // Plan 07-01 (TG-14): fired when the user clicks a fleet-only row (a
  // row present in state.fleetSessions with no corresponding openTabs
  // entry — see conversation-store §Plan 07-01). AppShell resolves the
  // row → Host via state.hostsFlat + calls openTab(host, "terminal", ...,
  // { targetTmuxSession, allowCreateTmux: false }) + selectConversationDeferred.
  // Optional so isolated tests / desktop-only surfaces can omit — when
  // undefined, fleet-only rows fall through to the default
  // selectConversation path (which will silent-no-op at the store level
  // per T-06-01-01 stale-id guard, since fleet ids are never in openTabs).
  // Under TG-13 the ConversationRow renders identically for both paths;
  // the branch happens ONLY at the click-handler level, INTERNAL to the
  // panel-wiring layer — never visible to Ashley.
  onDetachedRowClick?: (row: ConversationRowShape) => void;
}) {
  const { t } = useTranslation();
  const { pinned, grouped } = useConversations();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);

  const isEmpty = pinned.length === 0 && grouped.length === 0;
  const showGear = typeof onRailClick === "function";
  const showNewSessionButton = typeof onCreateSession === "function";

  // Plan 07-01 (TG-14): single row-click dispatcher. Fleet-only rows route
  // through `onDetachedRowClick` (AppShell handler resolves row → Host →
  // openTab + selectConversationDeferred); openTabs rows use the direct
  // `selectConversation` path. Both branches fire `onConversationSelected`
  // so the mobile list→view transition (Plan 06-03) fires identically for
  // attached AND detached clicks — Ashley cannot tell the two states apart
  // per TG-13.
  //
  // Extracted here (rather than inlined at both call sites) so the pinned
  // and grouped row lists stay identical — a future planner adding e.g. a
  // click-analytics hook only edits one place.
  const handleRowSelect = (row: ConversationRowShape) => {
    if (row.fleetOnly && onDetachedRowClick) {
      onDetachedRowClick(row);
      onConversationSelected?.(row.id);
      return;
    }
    selectConversation(row.id);
    onConversationSelected?.(row.id);
  };

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header row: minimal chrome with an optional gear icon on the right.
          The top-of-scroller slot (below this header) remains unreserved so
          Plan 06-04's NewSessionButton can insert above the pinned section
          without competing with the gear. */}
      {showGear ? (
        <div className="shrink-0 flex items-center justify-end px-1 py-1 border-b border-border/40">
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center justify-center size-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      aria-label={t("nav.conversations.settings", {
                        defaultValue: "Settings & Admin",
                      })}
                    >
                      <Settings className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("nav.conversations.settings", {
                    defaultValue: "Settings & Admin",
                  })}
                </TooltipContent>
                <DropdownMenuContent align="end" className="w-56">
                  {renderSettingsMenuItems({
                    onRailClick: onRailClick!,
                    isAdmin: Boolean(isAdmin),
                    t,
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : (
        <div className="shrink-0" />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Plan 06-04: NewSessionButton mounts at the TOP of the scroller
            (above the pinned section), visible on both mobile and desktop.
            Primary CTA for TG-09. Distinct from the header gear icon
            (Plan 06-02) — button = primary action, gear = settings chrome.
            Renders even in the empty-state branch since Ashley may open a
            fresh page and need the button to be the very first affordance
            she sees. Only shown when onCreateSession is wired in — isolated
            tests that don't want the button can omit the callback. */}
        {showNewSessionButton && (
          <div className="px-2 pt-2 pb-1 border-b border-border/40">
            <NewSessionButton
              onOpen={() => setNewSessionDialogOpen(true)}
            />
          </div>
        )}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <MessagesSquare className="size-8 text-muted-foreground/20 mb-2" />
            <span className="text-sm font-semibold text-muted-foreground/60">
              {t("nav.conversations.empty", {
                defaultValue: "No active conversations",
              })}
            </span>
          </div>
        ) : (
          <>
            {/* Pinned section: bare pins at top (no explicit "Pinned" header
                per plan Step B — reads cleaner and matches shape file's
                planner-discretion note). A subtle divider separates pinned
                from the first host group so the visual hierarchy is
                obvious without a chrome header. */}
            {pinned.length > 0 && (
              <div className="flex flex-col">
                {pinned.map((row) => (
                  <ConversationRow
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    pinned={true}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={() => togglePinConversation(row.id)}
                  />
                ))}
                {grouped.length > 0 && (
                  <div className="border-t border-border/40" />
                )}
              </div>
            )}

            {/* Host-grouped section: for each HostGroup, small semibold host
                header (matching FolderItem lines 941-943) with a top border
                separator, then the rows for that group. */}
            {grouped.map((group) => (
              <div key={group.hostId} className="flex flex-col">
                <div className="flex items-center gap-2 px-3 py-2 border-t border-border/40">
                  <span className="text-[13px] font-semibold text-foreground/80 truncate flex-1">
                    {group.hostName}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/40 shrink-0">
                    {group.rows.length}
                  </span>
                </div>
                {group.rows.map((row) => (
                  <ConversationRow
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    pinned={pinnedIds.has(row.id)}
                    onSelect={() => handleRowSelect(row)}
                    onTogglePin={() => togglePinConversation(row.id)}
                  />
                ))}
              </div>
            ))}
          </>
        )}
        {/* Plan 06-03: mobile settings-row slot. Rendered at the BOTTOM of
            the scroller (below the last host group) so it does not compete
            with pinned/active rows for prime attention (TG-10). Absent on
            desktop; the desktop settings surface is the gear icon in the
            header above. Not rendered inside the empty-state branch because
            an empty list already offers zero attention competition — the
            SettingsRow living above the empty-state message would read as
            the primary CTA, which is not what we want. AppShell always
            provides the slot on mobile mounts either way; when the list is
            empty the mobile row is still useful — it's still reachable
            below the empty-state block. */}
        {settingsRowSlot}
      </div>

      {/* Plan 06-04: NewSessionDialog is mounted OUTSIDE the scroller
          (Dialog is portaled anyway, so DOM position doesn't drive layout)
          — kept sibling-to-scroller to make the render-tree responsibilities
          obvious. Dialog controlled by local dialog-open state; on submit
          delegates to AppShell's onCreateSession callback (which handles
          openTab + selectConversationDeferred + navigateToView on mobile).
          Only mounted when onCreateSession is wired — same gate as the
          button — so tests that don't want the picker don't pay for it. */}
      {showNewSessionButton && (
        <NewSessionDialog
          open={newSessionDialogOpen}
          onClose={() => setNewSessionDialogOpen(false)}
          hostTree={hostTree ?? null}
          onCreate={(opts) => {
            onCreateSession!(opts);
            setNewSessionDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
