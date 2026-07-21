// ─── ConversationsPanel ──────────────────────────────────────────────────────
// The Telegram-style list panel — renders the conversation-store's derived
// output as a flat, single-select, host-grouped list with pins on top.
//
// Drop-in for the HostsPanel content slot in AppShell's sidebar under a new
// RailView. This plan (06-01) does NOT wire it into AppShell — Plan 06-02
// owns the RailView addition + the atomic tab-strip removal + settings gear.
// Plan 06-04 owns the NewSessionButton insertion at the top of the scroller.
//
// Header treatment per plan Step B: NO new-session button (06-04), NO gear
// icon (06-02). Empty header — the scroller's top slot is left UNRESERVED
// so 06-04's NewSessionButton can insert cleanly ABOVE the pinned section
// without a chrome refactor.
//
// Reuses (do NOT reinvent):
//   - HostsPanel outer container idiom: <div className="relative flex flex-col
//     flex-1 min-h-0 overflow-hidden"> — matches the sidebar-panel-content-slot
//     size contract AppShell expects.
//   - SidebarTree FolderItem host-header style + empty-state idiom
//     (lines 941-943 / 1214-1220).
//
// Zero touches to AppShell, TabBar, MobileBottomBar, pretty-view, terminal,
// guacamole (Phase 6 scope-fence).

import { MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  selectConversation,
  togglePinConversation,
} from "@/state/conversation-store";
import { ConversationRow } from "@/sidebar/ConversationRow";

export function ConversationsPanel() {
  const { t } = useTranslation();
  const { pinned, grouped } = useConversations();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();

  const isEmpty = pinned.length === 0 && grouped.length === 0;

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Empty header row — kept as a zero-height presence so future plans
          (06-02 gear, 06-04 NewSessionButton) have a chrome slot to inject
          into without re-shaping the panel. */}
      <div className="shrink-0" />

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
