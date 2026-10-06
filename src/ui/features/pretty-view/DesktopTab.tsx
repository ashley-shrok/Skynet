/**
 * DesktopTab — live look at an identity's virtual desktop, with "Take control".
 *
 * The desktop is the identity's own X display (substrate/scripts/agent-desktop)
 * that the agent drives through its desktop-mcp tools. This tab streams it
 * through the existing Guacamole pipeline: the backend opens an SSH tunnel to
 * the desktop's VNC port and hands back a token with guacd's `read-only` set,
 * and GuacamoleDisplay renders it with input capture off (viewOnly).
 *
 * States: connecting → live view; stopped (with a Start button that starts the
 * desktop in the background and polls until it's up); not installed; error.
 *
 * Take control: the backend writes the identity's control lease (the agent's
 * desktop tools pause) and issues an interactive token. While held, the tab
 * renews the lease every RENEW_MS; Hand back, hiding the tab, closing the
 * modal, or the stream dropping releases it. If none of that gets through
 * (tab killed), the lease lapses on its own 90s after the last renew.
 *
 * The identity modal only shows this tab once useDesktopRunning
 * (use-desktop-running.ts) sees the desktop running.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay";
import {
  resolveWorkspaceErrorCopy,
  type WorkspaceErrorCopy,
} from "./workspace-error-copy";

/** How long to wait for a desktop we just started before giving up. */
const START_TIMEOUT_MS = 90_000;
const START_POLL_MS = 2_000;
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

const toolbarBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-pv-fg-muted)",
  background: "var(--color-pv-surface-quiet-alt)",
  border: "1px solid var(--color-pv-border-quiet)",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: "100%",
        padding: 24,
        textAlign: "center",
        color: "var(--color-pv-fg-muted)",
      }}
    >
      <Monitor size={28} style={{ opacity: 0.5 }} />
      <div
        style={{ fontWeight: 600, fontSize: 14, color: "var(--color-pv-fg)" }}
      >
        {heading}
      </div>
      <div style={{ fontSize: 12.5, maxWidth: 380 }}>{body}</div>
      {children}
    </div>
  );
}

export default function DesktopTab({
  identityKey,
  hostId,
  isVisible,
  onControlChange,
}: {
  identityKey: string;
  hostId: number;
  /** Whether the tab is the active one; the stream only connects while visible. */
  isVisible: boolean;
  /** Told when this tab takes or gives up control (the modal stops Esc from closing it meanwhile). */
  onControlChange?: (inControl: boolean) => void;
}): JSX.Element {
  const [view, setView] = useState<View>({ status: "connecting" });
  const [taking, setTaking] = useState(false);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const controlRef = useRef(false);
  const onControlChangeRef = useRef(onControlChange);
  onControlChangeRef.current = onControlChange;

  /** Drop the lease if we hold it (fire and forget — it lapses on its own anyway). */
  const releaseIfHeld = useCallback(() => {
    if (!controlRef.current) return;
    controlRef.current = false;
    onControlChangeRef.current?.(false);
    releaseDesktopControl(identityKey, hostId).catch(() => {});
  }, [identityKey, hostId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseIfHeld();
    };
  }, [releaseIfHeld]);

  const connect = useCallback(async () => {
    releaseIfHeld();
    setView({ status: "connecting" });
    try {
      const conn = await connectDesktop(identityKey, hostId);
      if (!mountedRef.current) return;
      attemptRef.current += 1;
      setView({
        status: "live",
        token: conn.token,
        geometry: conn.geometry,
        attempt: attemptRef.current,
        control: false,
        agentPaused: conn.userHasControl,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const cls = errorClassOf(err);
      setView(
        cls === "not_running"
          ? { status: "stopped" }
          : { status: "error", errorClass: cls },
      );
    }
  }, [identityKey, hostId, releaseIfHeld]);

  // Connect when first shown; drop the stream (and any control) when hidden.
  useEffect(() => {
    if (isVisible) void connect();
    else {
      releaseIfHeld();
      setView({ status: "connecting" });
    }
  }, [isVisible, connect, releaseIfHeld]);

  const takeControl = useCallback(async () => {
    setTaking(true);
    try {
      const conn = await takeDesktopControl(identityKey, hostId);
      if (!mountedRef.current) {
        releaseDesktopControl(identityKey, hostId).catch(() => {});
        return;
      }
      controlRef.current = true;
      onControlChangeRef.current?.(true);
      attemptRef.current += 1;
      setView({
        status: "live",
        token: conn.token,
        geometry: conn.geometry,
        attempt: attemptRef.current,
        control: true,
        agentPaused: true,
      });
    } catch (err) {
      if (mountedRef.current) toast.error(errorCopy(errorClassOf(err)).heading);
    } finally {
      if (mountedRef.current) setTaking(false);
    }
  }, [identityKey, hostId]);

  const inControl = view.status === "live" && view.control;

  // Keep the lease alive while we hold it.
  useEffect(() => {
    if (!inControl) return;
    const timer = setInterval(() => {
      renewDesktopControl(identityKey, hostId).catch(() => {});
    }, RENEW_MS);
    return () => clearInterval(timer);
  }, [inControl, identityKey, hostId]);

  const onStreamLost = useCallback(() => {
    if (!mountedRef.current) return;
    releaseIfHeld();
    setView({ status: "disconnected" });
  }, [releaseIfHeld]);

  const start = useCallback(async () => {
    setView({ status: "starting" });
    try {
      await startDesktop(identityKey, hostId);
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, START_POLL_MS));
        if (!mountedRef.current) return;
        const s = await getDesktopStatus(identityKey, hostId).catch(() => null);
        if (s?.available && s.running) {
          await connect();
          return;
        }
      }
      if (mountedRef.current)
        setView({ status: "error", errorClass: "start_timeout" });
    } catch (err) {
      if (mountedRef.current)
        setView({ status: "error", errorClass: errorClassOf(err) });
    }
  }, [identityKey, hostId, connect]);

  const live = view.status === "live";
  const [geoW, geoH] =
    live && view.geometry ? view.geometry.split("x").map(Number) : [0, 0];

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="desktop-tab">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-pv-border-quiet)",
          fontSize: 12,
          color: "var(--color-pv-fg-muted)",
        }}
      >
        {inControl ? (
          <span
            title="Your mouse and keyboard go to the desktop. The agent's own input is paused until you hand back."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "hsla(40, 90%, 70%, 1)",
              fontWeight: 600,
            }}
            data-testid="desktop-in-control"
          >
            <MousePointer2 size={13} /> You have control · agent paused
          </span>
        ) : (
          <span
            title="You're watching the agent's desktop. Input from here is turned off."
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            data-testid="desktop-view-only"
          >
            <Eye size={13} /> View only
            {live && view.agentPaused && (
              <span style={{ opacity: 0.8 }}>
                {" "}
                · agent paused (someone has control)
              </span>
            )}
          </span>
        )}
        {live && view.geometry && (
          <span style={{ opacity: 0.7 }}>
            · {view.geometry.replace("x", "×")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {live && !inControl && (
          <button
            type="button"
            style={toolbarBtnStyle}
            onClick={() => void takeControl()}
            disabled={taking}
            title="Use your own mouse and keyboard on this desktop. The agent pauses until you hand back."
            data-testid="desktop-take-control"
          >
            <Hand size={12} /> {taking ? "Taking control…" : "Take control"}
          </button>
        )}
        {inControl && (
          <button
            type="button"
            style={toolbarBtnStyle}
            onClick={() => void connect()}
            data-testid="desktop-hand-back"
          >
            <Undo2 size={12} /> Hand back to agent
          </button>
        )}
        {(live ||
          view.status === "disconnected" ||
          view.status === "error") && (
          <button
            type="button"
            style={toolbarBtnStyle}
            onClick={() => void connect()}
            data-testid="desktop-reconnect"
          >
            <RefreshCw size={12} /> Reconnect
          </button>
        )}
      </div>

      <div
        className="flex-1 min-h-0 relative"
        style={{ background: "var(--bg-base, #111)" }}
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
            <button
              type="button"
              style={toolbarBtnStyle}
              onClick={() => void start()}
              data-testid="desktop-start"
            >
              <Play size={12} /> Start desktop
            </button>
          </Notice>
        )}
        {view.status === "disconnected" && (
          <Notice {...errorCopy("stream_error")}>
            <button
              type="button"
              style={toolbarBtnStyle}
              onClick={() => void connect()}
            >
              <RefreshCw size={12} /> Reconnect
            </button>
          </Notice>
        )}
        {view.status === "error" && <Notice {...errorCopy(view.errorClass)} />}
        {live && (
          <GuacamoleDisplay
            key={view.attempt}
            viewOnly={!view.control}
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
