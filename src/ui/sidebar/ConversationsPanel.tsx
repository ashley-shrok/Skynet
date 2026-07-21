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
} from "@/state/conversation-store";
import { ConversationRow } from "@/sidebar/ConversationRow";
import { renderSettingsMenuItems } from "@/sidebar/SettingsRow";
import type { RailView } from "@/sidebar/AppRail";

export function ConversationsPanel({
  onRailClick,
  isAdmin,
}: {
  // Route to admin destinations via AppShell's handleRailClick. Passed in
  // from AppShell in Plan 06-02 Step G. Optional so the panel can render
  // in isolation (e.g. a Vitest smoke test that doesn't want to mock the
  // full sidebar-rail routing) — the gear icon is only shown when
  // onRailClick is provided.
  onRailClick?: (view: RailView) => void;
  isAdmin?: boolean;
}) {
  const { t } = useTranslation();
  const { pinned, grouped } = useConversations();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();

  const isEmpty = pinned.length === 0 && grouped.length === 0;
  const showGear = typeof onRailClick === "function";

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
                    onSelect={() => selectConversation(row.id)}
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
                    onSelect={() => selectConversation(row.id)}
                    onTogglePin={() => togglePinConversation(row.id)}
                  />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
