/**
 * DesktopTab — live look at an identity's virtual desktop, with "Take control",
 * inside the agent window (IdentityModal).
 *
 * The connection itself — view-only stream, take / renew / hand back control,
 * start, errors — is the shared desktop session (desktop-session.tsx), the
 * same one the split-view desktop pane uses. This tab adds its toolbar and
 * sizes the body: the identity modal grows to its wide viewer size while this
 * tab is active, its height following the body's desktop-shaped aspect ratio.
 * Hiding the tab or closing the modal drops the stream and hands back control.
 *
 * "Open beside the conversation" (desktop only) hands the desktop to a split
 * pane next to the conversation and closes the agent window.
 *
 * The identity modal only shows this tab once useDesktopRunning
 * (use-desktop-running.ts) sees the desktop running.
 */

import { Eye, Hand, MousePointer2, PanelRightOpen, RefreshCw, Undo2 } from "lucide-react";
import { useModalFullscreen } from "@/components/modal";
import { KitButton, KitChip, KitToolbar, KitToolbarSpacer } from "@/components/kit";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopStage, desktopGeometry, useDesktopSession } from "./desktop-session";

/** Body aspect before the live geometry is known (agent-desktop's default). */
const DEFAULT_W = 1280;
const DEFAULT_H = 800;

export default function DesktopTab({
  identityKey,
  hostId,
  isVisible,
  onControlChange,
  onPopOut,
}: {
  identityKey: string;
  hostId: number;
  /** Whether the tab is the active one; the stream only connects while visible. */
  isVisible: boolean;
  /** Told when this tab takes or gives up control (the modal stops Esc from closing it meanwhile). */
  onControlChange?: (inControl: boolean) => void;
  /** Open the desktop in a split pane instead; absent → no button. */
  onPopOut?: () => void;
}): JSX.Element {
  const session = useDesktopSession({
    identityKey,
    hostId,
    isVisible,
    logTag: "desktop-tab",
    onControlChange,
  });
  const { view, taking, inControl, connect, takeControl } = session;
  // Phone: the modal is fullscreen and the body just takes what's left.
  const fullscreen = useModalFullscreen();
  // No split view on a phone, so nowhere to pop out to.
  const isMobile = useIsMobile();

  const live = view.status === "live";
  const [geoW, geoH] = desktopGeometry(view);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="desktop-tab">
      <KitToolbar className="mx-3 mt-2 mb-2 shrink-0" aria-label="Desktop">
        {inControl ? (
          <KitChip
            tone="warn"
            title="Your mouse and keyboard go to the desktop. The agent's own input is paused until you hand back."
            data-testid="desktop-in-control"
            className="ml-1"
          >
            <MousePointer2 size={13} aria-hidden="true" /> You have control · agent paused
          </KitChip>
        ) : (
          <span
            title="You're watching the agent's desktop. Input from here is turned off."
            className="ml-1 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--k-t2)]"
            data-testid="desktop-view-only"
          >
            <Eye size={13} aria-hidden="true" /> View only
            {live && view.agentPaused && (
              <span className="text-[var(--k-t3)]">
                {" "}
                · agent paused (someone has control)
              </span>
            )}
          </span>
        )}
        {live && view.geometry && (
          <span className="text-[12.5px] text-[var(--k-t3)]">
            · {view.geometry.replace("x", "×")}
          </span>
        )}
        <KitToolbarSpacer />
        {live && !inControl && (
          <KitButton
            size="sm"
            onClick={() => void takeControl()}
            busy={taking}
            title="Use your own mouse and keyboard on this desktop. The agent pauses until you hand back."
            data-testid="desktop-take-control"
          >
            {taking ? null : <Hand size={13} aria-hidden="true" />}
            {taking ? "Taking control…" : "Take control"}
          </KitButton>
        )}
        {inControl && (
          <KitButton size="sm" onClick={() => void connect()} data-testid="desktop-hand-back">
            <Undo2 size={13} aria-hidden="true" /> Hand back to agent
          </KitButton>
        )}
        {onPopOut && !isMobile && (
          <KitButton
            size="sm"
            onClick={onPopOut}
            title="Show this desktop in its own pane beside the conversation"
            data-testid="desktop-pop-out"
          >
            <PanelRightOpen size={13} aria-hidden="true" /> Open beside conversation
          </KitButton>
        )}
        {(live || view.status === "disconnected" || view.status === "error") && (
          <KitButton size="sm" onClick={() => void connect()} data-testid="desktop-reconnect">
            <RefreshCw size={13} aria-hidden="true" /> Reconnect
          </KitButton>
        )}
      </KitToolbar>

      <div
        className="min-h-0 relative"
        style={{
          background: "var(--k-bg, #111)",
          // The identity modal's height follows this body while the tab is
          // active (viewer size): full width at the desktop's aspect ratio,
          // shrinking (flex) when the modal hits its 85vh cap — the display
          // then scales the desktop down to the smaller box. On a phone the
          // modal is full screen and the body takes what's left, with no
          // aspect ratio: iOS Safari otherwise derives the width from the
          // flex-grown height and the picture overflows the screen. Width is
          // pinned for the same reason. min-height is a floor so the display
          // never paints into a zero-size box.
          flex: "1 1 auto",
          width: "100%",
          ...(fullscreen
            ? {}
            : { aspectRatio: `${geoW || DEFAULT_W} / ${geoH || DEFAULT_H}` }),
          minHeight: 240,
        }}
      >
        <DesktopStage session={session} isVisible={isVisible} />
      </div>
    </div>
  );
}
