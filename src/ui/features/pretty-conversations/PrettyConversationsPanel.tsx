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
//   - Empty state = PlanPendingBubble-style idle glass card centered in the
//     scroll region ("No conversations yet")
//   - Header carries a `variant` prop-driven layout:
//       * variant="mobile"  → pencil icon ONLY (right-aligned); no title
//                             (mobile settings live in settingsRowSlot
//                             at the bottom of the scroller)
//       * variant="desktop" → title "Conversations" (left) + pencil (right)
//   - Pencil opens the existing NewSessionDialog VERBATIM (no dialog redesign)
//   - Gear (shadcn dropdown) removed in patch #133 — panel is now
//     shadcn-free; settings surfaces via settingsRowSlot on mobile and the
//     AppRail on desktop.
//   - Swipe coordination (mobile): only one row swiped-open at a time;
//     opening a new one auto-closes the previous via the row's Wave 1
//     `forceClosed` prop; selecting any row also resets the coordinator
//     state (defense-in-depth)
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

import { useState, type ReactNode } from "react";
import { MessagesSquare, Monitor, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  useActiveSet,
  selectConversation,
  togglePinConversation,
  type ConversationRow as ConversationRowShape,
} from "@/state/conversation-store";
import { useSessionWorking } from "@/state/session-working-store";
import { NewSessionDialog } from "@/sidebar/NewSessionDialog";
import type { Host, HostFolder } from "@/types/ui-types";

import { PrettyConversationRow } from "./PrettyConversationRow";

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
function PrettyConversationRowLive(props: {
  row: ConversationRowShape;
  selected: boolean;
  pinned: boolean;
  variant: "mobile" | "desktop";
  onSelect: () => void;
  onTogglePin: () => void;
  onSwipeOpenChange?: (open: boolean) => void;
  forceClosed?: boolean;
  inActiveSet: boolean;
  sessionKey: string | null;
}) {
  const { sessionKey, inActiveSet, ...rowProps } = props;
  const isWorking = useSessionWorking(sessionKey);
  return (
    <PrettyConversationRow
      {...rowProps}
      isWorking={isWorking}
      inActiveSet={inActiveSet}
    />
  );
}

export function PrettyConversationsPanel({
  variant,
  onConversationSelected,
  settingsRowSlot,
  hostTree,
  onCreateSession,
  onDetachedRowClick,
  onRdpRowClick,
}: {
  // NEW in Wave 2: drives BOTH the header layout branching AND the child
  // rows' pin mechanism (mobile=swipe / desktop=hover-reveal). AppShell
  // (Wave 3) will resolve this from `useIsMobile()` at the mount site.
  variant: "mobile" | "desktop";
  // Fired AFTER the store's selectConversation (or the detached/RDP-branch
  // callbacks) run on a row tap. AppShell's mobile branch passes a handler
  // that transitions list→view.
  onConversationSelected?: (id: string) => void;
  // Mobile-only settings-row slot rendered at the bottom of the scroll
  // region. Desktop reaches settings via the gear icon in the header.
  settingsRowSlot?: ReactNode;
  // Host tree fed into the NewSessionDialog's host picker. Optional so
  // tests can render the panel without wiring the picker.
  hostTree?: HostFolder | null;
  // Fired when the user completes the NewSessionDialog. The pencil-icon
  // header button is only mounted when this callback is provided (matches
  // the ConversationsPanel gate that used to be on the old inline
  // new-session button affordance).
  onCreateSession?: (opts: { host: Host; sessionName?: string }) => void;
  // Detached-fleet-row click (Plan 07-01, TG-14) — same contract as
  // ConversationsPanel: fired instead of selectConversation when the row
  // is fleet-only. When omitted, fleet-only rows fall through to
  // selectConversation (which silent-no-ops at the store level).
  onDetachedRowClick?: (row: ConversationRowShape) => void;
  // RDP-host-row click (Plan 07-02, TG-15) — same contract as
  // ConversationsPanel. When omitted, RDP rows fall through to
  // selectConversation (silent-no-op at the store level).
  onRdpRowClick?: (row: ConversationRowShape) => void;
}) {
  const { t } = useTranslation();
  const { pinned, grouped } = useConversations();
  const selectedId = useSelectedConversationId();
  const pinnedIds = usePinnedIds();
  // Patch #137: hoisted once so all row-level activeSet.has(row.id) reads
  // hit a stable ReadonlySet reference (Set identity flips only on real
  // additions; consumers get a memoized reference across no-ops).
  const activeSet = useActiveSet();

  // Local state: NewSessionDialog open/closed toggle (opened by pencil).
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);

  // Swipe-coordination state: which row is currently swiped open? Only
  // meaningful on mobile — desktop rows don't emit onSwipeOpenChange. Panel
  // passes `forceClosed={true}` to every row EXCEPT the currently-open one,
  // enforcing the "only one row swiped-open at a time" rule per Wave 1's
  // handoff pattern.
  const [currentlySwipedId, setCurrentlySwipedId] = useState<string | null>(
    null,
  );

  const isEmpty = pinned.length === 0 && grouped.length === 0;

  const showPencilButton = typeof onCreateSession === "function";
  const showDesktopTitle = variant === "desktop";
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
  // Also defensively resets currentlySwipedId to null — the row itself
  // suppresses onSelect when swipedOpen, so this is belt-and-suspenders
  // for the case where two rows are open due to a race.
  const handleRowSelect = (row: ConversationRowShape) => {
    if (isMobileVariant) setCurrentlySwipedId(null);
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

  // Coordinator callback wired into every mobile row. When a row reports
  // open=true, we record its id; when it reports open=false we clear it if
  // it was ours. Desktop rows never call this (the row only calls it when
  // its swipe state transitions, which only happens in mobile variant).
  const handleSwipeOpenChange = (rowId: string, open: boolean) => {
    setCurrentlySwipedId((prev) => {
      if (open) return rowId;
      // Row reports it closed: clear only if this was the tracked row.
      return prev === rowId ? null : prev;
    });
  };

  // Helper: `forceClosed` value to pass to a given row. In mobile variant,
  // it's `true` for every row whose id is NOT the currently-swiped row.
  // In desktop variant, forceClosed is irrelevant (no swipe state at all).
  const forceClosedFor = (rowId: string): boolean | undefined => {
    if (!isMobileVariant) return undefined;
    return currentlySwipedId !== null && currentlySwipedId !== rowId;
  };

  // Precompute a stable no-op togglePin for RDP rows (belt-and-suspenders —
  // Wave 1's contract already suppresses swipe/pin intrinsically for RDP,
  // but hand a no-op arrow anyway so nothing fires if the invariant ever
  // regresses).
  const rdpNoopTogglePin = () => {};

  const headerLabel = t("nav.conversations.title", {
    defaultValue: "Conversations",
  });
  const newSessionLabel = t("nav.newSession", {
    defaultValue: "New session",
  });
  const rdpSectionLabel = t("nav.conversations.rdpSection", {
    defaultValue: "Remote desktop",
  });
  const emptyLabel = t("nav.conversations.empty", {
    defaultValue: "No conversations yet",
  });

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0 overflow-hidden pb-[env(safe-area-inset-bottom)]"
      data-testid="pretty-conversations-panel"
      data-variant={variant}
    >
      {/* Header: variant-agnostic hairline treatment matching prototype's
          `.top-strip` / desktop's `.sidebar-header`. Layout branches on
          `variant`:
            desktop → title (left) + pencil + gear (right)
            mobile  → empty left, pencil only (right)  */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        {showDesktopTitle ? (
          <span className="text-[13px] font-semibold text-[rgba(240,234,224,0.9)] tracking-tight truncate">
            {headerLabel}
          </span>
        ) : (
          // Empty left side keeps `justify-between` right-anchoring the
          // pencil on mobile (prototype's empty top-strip label slot).
          <span aria-hidden="true" />
        )}
        <div className="flex items-center gap-1">
          {showPencilButton && (
            <button
              type="button"
              onClick={() => setNewSessionDialogOpen(true)}
              aria-label={newSessionLabel}
              title={newSessionLabel}
              className={
                "inline-flex items-center justify-center " +
                "w-[34px] h-[34px] rounded-full " +
                "bg-white/[0.04] border border-white/[0.09] " +
                "text-[#f0eae0] hover:bg-white/[0.08] " +
                "transition-colors " +
                "[-webkit-tap-highlight-color:transparent] " +
                "cursor-pointer select-none"
              }
            >
              <Pencil className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scroll region: safe-area padding lives on outer container (patch #131)
          so the panel bottom sits ABOVE the safe-area — settings row is not
          covered when scroll is at rest. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {isEmpty ? (
          // Empty-state = PlanPendingBubble-style idle glass card centered
          // in the scroll region. Uses the neutral no-identity treatment
          // (blue-gray gradient like ChatMessage user bubble) since there
          // is no identity hue to reference for an empty list.
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-10">
            <div
              role="status"
              aria-label={emptyLabel}
              data-testid="pretty-conversations-empty"
              className={
                "flex items-center gap-2 text-sm text-[#dfe3ee] " +
                "rounded-[14px] px-4 py-3 " +
                "backdrop-blur-xl saturate-150 " +
                "[-webkit-backdrop-filter:blur(20px)_saturate(1.6)] " +
                "bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))] " +
                "border border-[rgba(120,140,180,0.32)] " +
                "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,220,170,0.10)_inset,_0_0_0_0.5px_rgba(120,140,180,0.16)_inset,_0_0_24px_rgba(120,140,180,0.08)]"
              }
            >
              <MessagesSquare
                className="size-4 shrink-0 text-[#dfe3ee]/80"
                aria-hidden="true"
              />
              <span>{emptyLabel}</span>
            </div>
          </div>
        ) : (
          <>
            {/* Pinned rows — flat, no "Pinned" section header. The pin
                glyph on each row is the only marker. Patch #137: live
                isWorking + inActiveSet wiring per row. The panel-level
                activeSet subscription is hoisted once (above); each row's
                isWorking is read inside PrettyConversationRowLive so the
                store subscription happens at a stable hook-call site.
                Same wiring repeats at the two grouped render sites below. */}
            {pinned.map((row) => (
              <PrettyConversationRowLive
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                pinned={true}
                variant={variant}
                onSelect={() => handleRowSelect(row)}
                onTogglePin={() => togglePinConversation(row.id)}
                onSwipeOpenChange={
                  isMobileVariant
                    ? (open) => handleSwipeOpenChange(row.id, open)
                    : undefined
                }
                forceClosed={forceClosedFor(row.id)}
                inActiveSet={activeSet.has(row.id)}
                sessionKey={sessionWorkingKey(row)}
              />
            ))}
            {/* Grouped rows — FLAT per Ashley/prototype lock: no per-host
                semibold header. The `__rdp__` sentinel group renders a
                subtle "Remote desktop" divider chip above its rows.  */}
            {grouped.map((group) => {
              if (group.hostId === "__rdp__") {
                return (
                  <div
                    key={group.hostId}
                    className="flex flex-col"
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
                      <Monitor
                        className="size-3 text-[#5c6070]/50 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/50 shrink-0">
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
                        inActiveSet={activeSet.has(row.id)}
                        sessionKey={sessionWorkingKey(row)}
                      />
                    ))}
                  </div>
                );
              }
              // Regular host group — FLAT, no per-host semibold header
              // (Ashley/prototype lock). Just emit the rows.
              return (
                <div key={group.hostId} className="flex flex-col">
                  {group.rows.map((row) => (
                    <PrettyConversationRowLive
                      key={row.id}
                      row={row}
                      selected={row.id === selectedId}
                      pinned={pinnedIds.has(row.id)}
                      variant={variant}
                      onSelect={() => handleRowSelect(row)}
                      onTogglePin={() => togglePinConversation(row.id)}
                      onSwipeOpenChange={
                        isMobileVariant
                          ? (open) => handleSwipeOpenChange(row.id, open)
                          : undefined
                      }
                      forceClosed={forceClosedFor(row.id)}
                      inActiveSet={activeSet.has(row.id)}
                      sessionKey={sessionWorkingKey(row)}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}
        {/* Mobile settings-row slot at the BOTTOM of the scroll region.
            Desktop mounts do NOT pass this — desktop reaches settings via
            the header gear icon. Same position rule as ConversationsPanel:
            below the last group so it doesn't compete with pinned/active
            rows for prime attention (TG-10). */}
        {settingsRowSlot}
      </div>

      {/* NewSessionDialog VERBATIM from ConversationsPanel.tsx lines
          358-368. Portal-mounted; DOM sibling position doesn't drive
          layout. Only mounted when onCreateSession is wired — same gate
          as the pencil button. */}
      {showPencilButton && (
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
