// ─── TaskPill ────────────────────────────────────────────────────────────────
//
// The top-center handle of an agent conversation pane (chat view AND terminal
// view) — it replaced the identity badge. It looks and behaves like that
// conversation's sidebar row:
//   - avatar + task (agent name when there is no task), same as the row
//   - click → the agent window (IdentityModal)
//   - ⋮ and right-click → the conversation menu (the same items the badge had)
//   - drag → the pane handle (drop lane, split rearrange, other windows,
//     filing into sidebar sections) — desktop only
//   - hover → tooltip with name, roles, project
//   - just before the ⋮, the agent memory pie (not on archived agents) — tap
//     for how full it is and Compact conversation
//
// Beside it, outside the pill, round buttons appear only while their
// condition holds, each a shortcut into the agent window:
//   - desktop running (green) → Desktop tab
//   - local work not pushed (amber) → Git tab
// The desktop button is also a drag source (desktop only): dragging it into
// the content area opens the desktop as its own split-view pane.
// They hang off the pill's right edge so the pill stays centered whether or
// not they show, and the pill's width reserves room for both so it never
// resizes when one appears.

import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import { GitPullRequestDraft, Monitor } from "lucide-react";
import { useIdentities } from "@/state/identities-store";
import type { Identity } from "@/api/identities-api";
import { useProjects } from "@/state/conversation-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTrappedWork } from "@/state/trapped-work-store";
import { useSessionDesktopRunning } from "@/api/fleet-status-client";
import {
  hasNeutralLook,
  identityRolesLabel,
  identityTint,
  NEUTRAL_HUE,
} from "@/lib/identity-roles";
import { AvatarImage } from "@/components/avatar-image";
import { KitScopeContext, type KitScopeValue } from "@/components/kit/scope";
import { writeBadgeDragData, type BadgeDragSource } from "@/shell/badge-drag";
import { desktopOpensFullScreen, requestDesktopPane, writeDesktopDragData } from "@/shell/desktop-drag";
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";
import { isCoarsePointer } from "@/features/pretty-conversations/row-touch-gestures";
import { MemoryGauge } from "./MemoryGauge";
import { useAgentCondense } from "./use-agent-condense";

/** Agent-window tabs the round buttons jump to. */
export type TaskPillJumpTab = "desktop" | "git";

export interface TaskPillProps {
  identityKey: string;
  hostId: number;
  /** The pane's tmux session — keys the live desktop-running signal. */
  tmuxSession: string | null;
  /** The machine's name — a failed Compact names it. */
  hostName?: string;
  /** Pane tab id; absent → not a drag source. */
  tabId?: string;
  dragDescriptor?: BadgeDragSource["descriptor"];
  menuItems: RowKebabMenuItem[];
  /** Open the agent window, optionally on a specific tab. */
  onOpen: (tab?: TaskPillJumpTab) => void;
  /** An archived agent (not in the identities registry): paint this look,
   *  and show no round buttons — nothing is running. */
  identity?: Identity;
}

// Each side keeps the pane margin plus room for both round buttons, so the
// pill can use the rest of the width and stay centered.
const SIDE_BUTTON_PX = 40;
const SIDE_RESERVE_PX = 16 + 8 + SIDE_BUTTON_PX + 8 + SIDE_BUTTON_PX;

// The pill's ⋯ menu takes the kit look, like the sidebar's and pane bars'.
// Below this much room for the pill, "Compacting…" doesn't fit beside the
// task: the pie says it by pulsing instead (a phone, a narrow split pane).
const NARROW_PILL_PX = 280;

const PILL_KIT_SCOPE: KitScopeValue = { hue: 220 };

export function TaskPill({
  identityKey,
  hostId,
  tmuxSession,
  hostName,
  tabId,
  dragDescriptor,
  menuItems,
  onOpen,
  identity: archivedIdentity,
}: TaskPillProps) {
  const { byKey, byHostKey } = useIdentities();
  const nameLc = identityKey.toLowerCase();
  const identity =
    archivedIdentity ??
    (Number.isFinite(hostId)
      ? (byHostKey?.get(`${hostId}::${nameLc}`) ?? byKey.get(nameLc))
      : byKey.get(nameLc));
  const isMobile = useIsMobile();
  // Touch screens drag nothing — a press-and-hold there opens the menu.
  const isDragSource = !!tabId && !isMobile && !isCoarsePointer();
  const contextMenu = useRowKebabContextMenu(menuItems);
  const trappedWork = useTrappedWork(identityKey, hostId);
  const desktopRunning = useSessionDesktopRunning(hostId, tmuxSession);
  const memory = useAgentCondense(hostId, identityKey, tmuxSession, hostName);
  // The room the pill may take is the pane's width less the side reserves.
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((el: HTMLDivElement | null) => setPaneEl(el?.parentElement ?? null), []);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!paneEl) return;
    // 0 = not laid out yet; keep the full word until there's a real width.
    const measure = () => {
      const w = paneEl.clientWidth;
      setNarrow(w > 0 && w - SIDE_RESERVE_PX * 2 < NARROW_PILL_PX);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(paneEl);
    return () => ro.disconnect();
  }, [paneEl]);
  const projects = useProjects();

  if (!identity) return null;

  // An identity with no roles and no colorHue paints in the neutral grey.
  const neutralLook = hasNeutralLook(identity);
  const tint = identityTint(identity.colorHue ?? (neutralLook ? NEUTRAL_HUE : 35), neutralLook);
  const label = identity.task || identity.displayName || identity.identityKey;
  const roles = identityRolesLabel(identity);
  const projectName = identity.project
    ? (projects.find(
        (p) => p.slug === identity.project && p.hostId === String(identity.hostId),
      )?.displayName ?? null)
    : null;
  const tooltip = [
    identity.displayName,
    [roles, projectName].filter(Boolean).join(" · "),
  ]
    .filter(Boolean)
    .join(" — ");
  const hasUnpushed = trappedWork?.hasTrappedWork === true;

  const onDragStart = isDragSource
    ? (e: ReactDragEvent<HTMLElement>) => {
        const dragId = writeBadgeDragData(e.dataTransfer, {
          tabId: tabId!,
          identityKey,
          hostId,
          descriptor: dragDescriptor ?? null,
        });
        console.info(`[task-pill-drag] tabId=${tabId} dragId=${dragId} hostId=${hostId}`);
      }
    : undefined;

  // Desktop button drag → a desktop pane (a copy gesture; the button stays).
  const onDesktopDragStart =
    isMobile || !Number.isFinite(hostId)
    ? undefined
    : (e: ReactDragEvent<HTMLElement>) => {
        e.stopPropagation();
        writeDesktopDragData(e.dataTransfer, {
          hostId,
          identityKey: identity.identityKey.toLowerCase(),
          label: identity.displayName || identity.identityKey,
        });
        console.info(
          `[task-pill-desktop-drag] start hostId=${hostId} identityKey=${identity.identityKey}`,
        );
      };

  const open = (tab?: TaskPillJumpTab) => {
    console.info(
      `[task-pill] open hostId=${hostId} identityKey=${identityKey} tab=${tab ?? "default"}`,
    );
    // A phone opens the desktop full screen, skipping the agent window.
    if (tab === "desktop" && identity && Number.isFinite(hostId) && desktopOpensFullScreen()) {
      requestDesktopPane({
        hostId,
        identityKey: identity.identityKey.toLowerCase(),
        label: identity.displayName || identity.identityKey,
      });
      return;
    }
    onOpen(tab);
  };

  return (
    <div
      ref={anchorRef}
      data-testid="pv-task-pill-anchor"
      // inset-x-0 + mx-auto + w-fit centers it while letting it grow up to
      // maxWidth (a left:50% anchor would cap it at half the pane).
      className="absolute top-3 inset-x-0 mx-auto w-fit z-[101] flex"
      style={{ maxWidth: `calc(100% - ${SIDE_RESERVE_PX * 2}px)` }}
    >
      <div
        data-testid="pv-task-pill"
        title={tooltip}
        onClick={() => open()}
        onContextMenu={contextMenu.onContextMenu}
        {...contextMenu.holdProps}
        draggable={isDragSource}
        onDragStart={onDragStart}
        // Solid and neutral (shape-conversation-view), no blur — it floats
        // over the scrolling chat. The agent's colour is the ring on its
        // picture; the menu is the kit's ⋯.
        className="pv-float relative flex flex-row items-center gap-0.5 h-10 min-w-0 max-w-full rounded-full pl-1 pr-1 cursor-pointer select-none [-webkit-touch-callout:none]"
      >
        {/* The pill's primary control for keyboard / screen readers; its
            click bubbles to the pill root, which owns the open. A sibling of
            the kebab, never its ancestor. */}
        <button
          type="button"
          aria-label="Open agent info"
          data-testid="pv-task-pill-open"
          className="flex flex-row items-center gap-[9px] h-8 min-w-0 pl-0.5 pr-2 text-left cursor-pointer rounded-full hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <AvatarImage
            src={identity.avatarUrl}
            name={identity.displayName}
            className="shrink-0 object-cover"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              boxShadow: `0 0 0 1.5px ${tint(60, 60, 0.55)}`,
            }}
            initialClassName="shrink-0 inline-flex items-center justify-center font-semibold"
            initialStyle={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              fontSize: 12,
              background: tint(45, 35, 0.9),
              boxShadow: `0 0 0 1.5px ${tint(60, 60, 0.55)}`,
            }}
          />
          <span
            data-testid="pv-task-pill-label"
            className="truncate min-w-0 text-[color:var(--k-t1)]"
            style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.005em" }}
          >
            {label}
          </span>
        </button>
        {!archivedIdentity && (
          // The memory pie keeps its own taps: a click (or one inside its
          // pop-over, which bubbles here through the portal) never opens the
          // agent window, a hold never opens the pill's menu, and a
          // press-and-move never drags the pane. Right-click on the pie still
          // reaches the pill's menu.
          <span
            className="pv-pill-mem shrink-0 inline-flex"
            data-testid="pv-task-pill-memory"
            draggable
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) e.stopPropagation();
            }}
          >
            <MemoryGauge
              pct={memory.pct}
              condensing={memory.condensing}
              compact={narrow}
              condenseDisabled={memory.inFlight}
              onCondense={() => {
                void memory.condense();
              }}
            />
          </span>
        )}
        {menuItems.length > 0 && (
          // Its own (cancelled) drag source so a press-and-move starting on
          // the ⋮ doesn't drag the pane.
          <span
            className="shrink-0 inline-flex"
            draggable
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <KitScopeContext.Provider value={PILL_KIT_SCOPE}>
              <RowKebabMenu
                items={menuItems}
                ariaLabel="Agent menu"
                testId="pv-task-pill-kebab-trigger"
                triggerClassName="rounded-full"
              />
            </KitScopeContext.Provider>
          </span>
        )}
      </div>
      {!archivedIdentity && (desktopRunning || hasUnpushed) && (
        <div
          data-testid="pv-task-pill-side"
          className="absolute top-1/2 -translate-y-1/2 flex flex-row gap-2"
          style={{ left: "calc(100% + 8px)" }}
        >
          {desktopRunning && (
            <SideButton
              testId="pv-desktop-button"
              label={
                onDesktopDragStart
                  ? "Desktop running — click to open it, or drag it beside the conversation"
                  : "Desktop running — open it"
              }
              hue={150}
              onClick={() => open("desktop")}
              onDragStart={onDesktopDragStart}
            >
              <Monitor width={16} height={16} aria-hidden="true" />
            </SideButton>
          )}
          {hasUnpushed && (
            <SideButton
              testId="pv-unpushed-button"
              label="Local work not yet pushed to any remote — open Git"
              hue={35}
              onClick={() => open("git")}
            >
              <GitPullRequestDraft width={16} height={16} aria-hidden="true" />
            </SideButton>
          )}
        </div>
      )}
      {contextMenu.menu}
    </div>
  );
}

function SideButton({
  testId,
  label,
  hue,
  onClick,
  onDragStart,
  children,
}: {
  testId: string;
  label: string;
  hue: number;
  onClick: () => void;
  /** Present → the button is a drag source. */
  onDragStart?: (e: ReactDragEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      // Pulses on appearing (it mounts when its condition turns true), then
      // holds a steady color.
      className="pv-side-button shrink-0 inline-flex items-center justify-center cursor-pointer transition-transform hover:scale-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      style={
        {
          "--pv-side-hue": hue,
          width: SIDE_BUTTON_PX,
          height: SIDE_BUTTON_PX,
          borderRadius: "50%",
          color: "#f4fff8",
          background: `linear-gradient(160deg, hsla(${hue}, 50%, 32%, 0.88), hsla(${hue}, 45%, 20%, 0.92))`,
          border: `1px solid hsla(${hue}, 65%, 52%, 0.6)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 18px rgba(0,0,0,0.45)`,
        } as React.CSSProperties
      }
    >
      {children}
    </button>
  );
}
