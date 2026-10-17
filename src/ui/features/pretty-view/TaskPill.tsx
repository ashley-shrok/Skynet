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
//
// Beside it, outside the pill, round buttons appear only while their
// condition holds, each a shortcut into the agent window:
//   - desktop running (green) → Desktop tab
//   - local work not pushed (amber) → Git tab
// They hang off the pill's right edge so the pill stays centered whether or
// not they show, and the pill's width reserves room for both so it never
// resizes when one appears.

import type { DragEvent as ReactDragEvent } from "react";
import { GitPullRequestDraft, Monitor } from "lucide-react";
import { useIdentities } from "@/state/identities-store";
import { useProjects } from "@/state/conversation-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTrappedWork } from "@/state/trapped-work-store";
import { useSessionDesktopRunning } from "@/api/fleet-status-client";
import { identityRolesLabel } from "@/lib/identity-roles";
import { writeBadgeDragData, type BadgeDragSource } from "@/shell/badge-drag";
import {
  RowKebabMenu,
  useRowKebabContextMenu,
  type RowKebabMenuItem,
} from "@/features/pretty-conversations/RowKebabMenu";

/** Agent-window tabs the round buttons jump to. */
export type TaskPillJumpTab = "desktop" | "git";

export interface TaskPillProps {
  identityKey: string;
  hostId: number;
  /** The pane's tmux session — keys the live desktop-running signal. */
  tmuxSession: string | null;
  /** Pane tab id; absent → not a drag source. */
  tabId?: string;
  dragDescriptor?: BadgeDragSource["descriptor"];
  menuItems: RowKebabMenuItem[];
  /** Open the agent window, optionally on a specific tab. */
  onOpen: (tab?: TaskPillJumpTab) => void;
}

// Each side keeps the pane margin plus room for both round buttons, so the
// pill can use the rest of the width and stay centered.
const SIDE_RESERVE_PX = 16 + 8 + 36 + 8 + 36;

export function TaskPill({
  identityKey,
  hostId,
  tmuxSession,
  tabId,
  dragDescriptor,
  menuItems,
  onOpen,
}: TaskPillProps) {
  const { byKey, byHostKey } = useIdentities();
  const nameLc = identityKey.toLowerCase();
  const identity = Number.isFinite(hostId)
    ? (byHostKey?.get(`${hostId}::${nameLc}`) ?? byKey.get(nameLc))
    : byKey.get(nameLc);
  const isMobile = useIsMobile();
  const isDragSource = !!tabId && !isMobile;
  const contextMenu = useRowKebabContextMenu(menuItems);
  const trappedWork = useTrappedWork(identityKey, hostId);
  const desktopRunning = useSessionDesktopRunning(hostId, tmuxSession);
  const projects = useProjects();

  if (!identity) return null;

  const hue = identity.colorHue ?? 35;
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

  const open = (tab?: TaskPillJumpTab) => {
    console.info(
      `[task-pill] open hostId=${hostId} identityKey=${identityKey} tab=${tab ?? "default"}`,
    );
    onOpen(tab);
  };

  return (
    <div
      data-testid="pv-task-pill-anchor"
      // inset-x-0 + mx-auto + w-fit centers it while letting it grow up to
      // maxWidth (a left:50% anchor would cap it at half the pane).
      className="absolute top-4 inset-x-0 mx-auto w-fit z-[101] flex"
      style={{ maxWidth: `calc(100% - ${SIDE_RESERVE_PX * 2}px)` }}
    >
      <div
        data-testid="pv-task-pill"
        title={tooltip}
        onClick={() => open()}
        onContextMenu={contextMenu.onContextMenu}
        draggable={isDragSource}
        onDragStart={onDragStart}
        className="pv-identity-breathe flex flex-row items-center gap-2 min-w-0 max-w-full cursor-pointer select-none [-webkit-touch-callout:none] transition-[filter] hover:brightness-110"
        style={{
          borderRadius: 22,
          padding: "5px 6px 5px 5px",
          background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
          boxShadow: `0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.14), 0 0 24px hsla(${hue}, 65%, 55%, 0.24)`,
          color: "#e8e4d8",
          animation: "pv-identity-breathe 5s ease-in-out infinite",
        }}
      >
        {/* The pill's primary control for keyboard / screen readers; its
            click bubbles to the pill root, which owns the open. A sibling of
            the kebab, never its ancestor. */}
        <button
          type="button"
          aria-label="Open agent info"
          data-testid="pv-task-pill-open"
          className="flex flex-row items-center gap-2 min-w-0 text-left cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          {identity.avatarUrl ? (
            <img
              src={identity.avatarUrl}
              alt=""
              draggable={false}
              className="shrink-0 object-cover"
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                boxShadow: `0 2px 6px rgba(0,0,0,0.5), 0 0 12px hsla(${hue}, 65%, 55%, 0.4)`,
              }}
            />
          ) : (
            <span
              className="shrink-0 inline-flex items-center justify-center font-semibold"
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                fontSize: 12,
                background: `hsla(${hue}, 45%, 35%, 0.9)`,
              }}
            >
              {(identity.displayName ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <span
            data-testid="pv-task-pill-label"
            className="truncate min-w-0"
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {label}
          </span>
        </button>
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
            <RowKebabMenu
              items={menuItems}
              ariaLabel="Agent menu"
              testId="pv-task-pill-kebab-trigger"
              triggerClassName="rounded-full"
            />
          </span>
        )}
      </div>
      {(desktopRunning || hasUnpushed) && (
        <div
          data-testid="pv-task-pill-side"
          className="absolute top-1/2 -translate-y-1/2 flex flex-row gap-2"
          style={{ left: "calc(100% + 8px)" }}
        >
          {desktopRunning && (
            <SideButton
              testId="pv-desktop-button"
              label="Desktop running — open it"
              hue={150}
              onClick={() => open("desktop")}
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
  children,
}: {
  testId: string;
  label: string;
  hue: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
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
          width: 36,
          height: 36,
          borderRadius: "50%",
          color: "#f4fff8",
          background: `linear-gradient(160deg, hsla(${hue}, 50%, 32%, 0.88), hsla(${hue}, 45%, 20%, 0.92))`,
          border: `1px solid hsla(${hue}, 65%, 52%, 0.6)`,
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          boxShadow: `0 4px 12px rgba(0,0,0,0.4), 0 0 14px hsla(${hue}, 70%, 50%, 0.35)`,
        } as React.CSSProperties
      }
    >
      {children}
    </button>
  );
}
