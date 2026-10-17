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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Eye,
  Hand,
  Monitor,
  MousePointer2,
  Play,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import {
  connectDesktop,
  getDesktopStatus,
  releaseDesktopControl,
  renewDesktopControl,
  startDesktop,
  takeDesktopControl,
} from "@/api/workspace-desktop-api";
import { useModalFullscreen } from "@/components/modal";
import {
  KitButton,
  KitChip,
  KitEmpty,
  KitToolbar,
  KitToolbarSpacer,
} from "@/components/kit";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay";
import {
  DesktopStage,
  desktopGeometry,
  desktopToolbarBtnStyle as toolbarBtnStyle,
  useDesktopSession,
} from "./desktop-session";

/** Body aspect before the live geometry is known (agent-desktop's default). */
const DEFAULT_W = 1280;
const DEFAULT_H = 800;
/** Control lease renew interval — well inside the 90s lease. */
const RENEW_MS = 30_000;

const DESKTOP_ERROR_COPY: Record<string, WorkspaceErrorCopy> = {
  not_installed: {
    heading: "Desktops aren't set up on this computer yet",
    body: "The desktop tools haven't been installed here. They arrive with the next fleet update.",
  },
  guacd_unreachable: {
    heading: "The viewer service isn't reachable",
    body: "Skynet's remote-desktop service isn't responding right now. Try again in a moment.",
  },
  too_many_tunnels: {
    heading: "Too many desktops open",
    body: "Close a desktop view in another window, then try again.",
  },
  no_password: {
    heading: "The desktop isn't ready yet",
    body: "It's still starting up. Try again in a few seconds.",
  },
  start_timeout: {
    heading: "The desktop didn't start",
    body: "It took too long to come up. Try again, or ask the agent to start it.",
  },
  stream_error: {
    heading: "Lost the connection to the desktop",
    body: "The live view stopped. Reconnect to pick it back up.",
  },
};

function errorCopy(errorClass: string): WorkspaceErrorCopy {
  return (
    DESKTOP_ERROR_COPY[errorClass] ?? resolveWorkspaceErrorCopy(errorClass)
  );
}

function errorClassOf(err: unknown): string {
  return err instanceof Error ? err.message : "host_unreachable";
}

type View =
  | { status: "connecting" }
  | {
      status: "live";
      token: string;
      geometry: string | null;
      attempt: number;
      /** This tab holds the control lease and an interactive token. */
      control: boolean;
      /** Someone (e.g. this user in another window) has control. */
      agentPaused: boolean;
    }
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "disconnected" }
  | { status: "error"; errorClass: string };

/** A desktop state in the body (connecting, stopped, problem). */
function Notice({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <KitEmpty
        icon={<Monitor aria-hidden="true" />}
        title={heading}
        body={body || undefined}
        action={children}
      />
    </div>
  );
}

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
          <KitButton
            size="sm"
            onClick={() => void connect()}
            data-testid="desktop-hand-back"
          >
            <Undo2 size={13} aria-hidden="true" /> Hand back to agent
          </KitButton>
        )}
        {onPopOut && !isMobile && (
          <button
            type="button"
            style={toolbarBtnStyle}
            onClick={onPopOut}
            title="Show this desktop in its own pane beside the conversation"
            data-testid="desktop-pop-out"
          >
            <PanelRightOpen size={12} /> Open beside conversation
          </button>
        )}
        {(live ||
          view.status === "disconnected" ||
          view.status === "error") && (
          <KitButton
            size="sm"
            onClick={() => void connect()}
            data-testid="desktop-reconnect"
          >
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
        {view.status === "connecting" && (
          <Notice heading="Connecting to the desktop…" body="" />
        )}
        {view.status === "starting" && (
          <Notice
            heading="Starting the desktop…"
            body="The first start on a computer can take a minute."
          />
        )}
        {view.status === "stopped" && (
          <Notice
            heading="The desktop isn't running"
            body="It starts on its own when the agent needs it. You can also start it now."
          >
            <KitButton
              variant="primary"
              onClick={() => void start()}
              data-testid="desktop-start"
            >
              <Play size={14} aria-hidden="true" /> Start desktop
            </KitButton>
          </Notice>
        )}
        {view.status === "disconnected" && (
          <Notice {...errorCopy("stream_error")}>
            <KitButton onClick={() => void connect()}>
              <RefreshCw size={14} aria-hidden="true" /> Reconnect
            </KitButton>
          </Notice>
        )}
        {view.status === "error" && <Notice {...errorCopy(view.errorClass)} />}
        {live && (
          <GuacamoleDisplay
            key={view.attempt}
            viewOnly={!view.control}
            fixedRemoteSize
            isVisible={isVisible}
            connectionConfig={{
              token: view.token,
              protocol: "vnc",
              ...(geoW && geoH ? { width: geoW, height: geoH } : {}),
            }}
            onDisconnect={onStreamLost}
            onError={onStreamLost}
          />
        )}
      </div>
    </div>
  );
}
