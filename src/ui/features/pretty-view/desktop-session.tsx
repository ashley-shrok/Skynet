/**
 * desktop-session — the live connection to an identity's virtual desktop,
 * shared by the agent window's Desktop tab (DesktopTab.tsx) and the split-view
 * desktop pane (shell/DesktopPane.tsx).
 *
 * The desktop is the identity's own X display (substrate/scripts/agent-desktop)
 * that the agent drives through its desktop-mcp tools. It streams through the
 * existing Guacamole pipeline: the backend opens an SSH tunnel to the
 * desktop's VNC port and hands back a token with guacd's `read-only` set, and
 * GuacamoleDisplay renders it with input capture off (viewOnly).
 *
 * States: connecting → live view; stopped (with a Start button that starts the
 * desktop in the background and polls until it's up); not installed; error.
 *
 * Take control: the backend writes the identity's control lease (the agent's
 * desktop tools pause) and issues an interactive token. While held, the
 * session renews the lease every RENEW_MS; Hand back, the surface hiding or
 * unmounting, or the stream dropping releases it (hiding says so with a
 * toast). If none of that gets through (tab killed), the lease lapses on its
 * own 90s after the last renew.
 *
 * The agent's screen size is the agent's: the display runs with
 * fixedRemoteSize, so neither watching nor control ever resizes it — the
 * picture just scales to fill whatever box it is given.
 *
 * Several surfaces may show the same desktop at once (the tab in one window, a
 * pane in another): the backend shares one tunnel per desktop, and each
 * surface sees `agentPaused` when someone else holds control.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Monitor, Play, RefreshCw } from "lucide-react";
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
import { systemLogger } from "@/lib/frontend-logger";
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

export function desktopErrorCopy(errorClass: string): WorkspaceErrorCopy {
  return (
    DESKTOP_ERROR_COPY[errorClass] ?? resolveWorkspaceErrorCopy(errorClass)
  );
}

function errorClassOf(err: unknown): string {
  return err instanceof Error ? err.message : "host_unreachable";
}

export type DesktopView =
  | { status: "connecting" }
  | {
      status: "live";
      token: string;
      geometry: string | null;
      attempt: number;
      /** This surface holds the control lease and an interactive token. */
      control: boolean;
      /** Someone (e.g. this user in another window) has control. */
      agentPaused: boolean;
    }
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "disconnected" }
  | { status: "error"; errorClass: string };

export interface DesktopSession {
  view: DesktopView;
  /** A take-control request is in flight. */
  taking: boolean;
  inControl: boolean;
  /** (Re)connect view-only — also how control is handed back. */
  connect: () => Promise<void>;
  takeControl: () => Promise<void>;
  start: () => Promise<void>;
  onStreamLost: () => void;
}

export function useDesktopSession({
  identityKey,
  hostId,
  isVisible,
  logTag,
  onControlChange,
}: {
  identityKey: string;
  hostId: number;
  /** The stream only connects while visible; hiding drops it (and control). */
  isVisible: boolean;
  /** Log prefix, e.g. "desktop-tab" / "desktop-pane". */
  logTag: string;
  /** Told when this surface takes or gives up control. */
  onControlChange?: (inControl: boolean) => void;
}): DesktopSession {
  const [view, setView] = useState<DesktopView>({ status: "connecting" });
  const [taking, setTaking] = useState(false);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const controlRef = useRef(false);
  const onControlChangeRef = useRef(onControlChange);
  onControlChangeRef.current = onControlChange;
  const opPrefix = logTag.replace(/-/g, "_");

  /**
   * Drop the lease if we hold it (fire and forget — it lapses on its own
   * anyway). Returns whether there was one to drop.
   */
  const releaseIfHeld = useCallback(
    (reason: string): boolean => {
      if (!controlRef.current) return false;
      controlRef.current = false;
      onControlChangeRef.current?.(false);
      systemLogger.info(`[${logTag}] control released`, {
        operation: `${opPrefix}_control_released`,
        identityKey,
        hostId,
        reason,
      });
      releaseDesktopControl(identityKey, hostId).catch(() => {});
      return true;
    },
    [identityKey, hostId, logTag, opPrefix],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseIfHeld("unmount");
    };
  }, [releaseIfHeld]);

  const connect = useCallback(async () => {
    releaseIfHeld("reconnect-or-hand-back");
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
      systemLogger.info(`[${logTag}] connect failed`, {
        operation: `${opPrefix}_connect_failed`,
        identityKey,
        hostId,
        errorClass: cls,
      });
      setView(
        cls === "not_running"
          ? { status: "stopped" }
          : { status: "error", errorClass: cls },
      );
    }
  }, [identityKey, hostId, releaseIfHeld, logTag, opPrefix]);

  // Connect when shown; drop the stream (and any control) when hidden.
  useEffect(() => {
    if (isVisible) void connect();
    else {
      if (releaseIfHeld("hidden")) toast.info("Handed back to agent");
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
      systemLogger.info(`[${logTag}] control taken`, {
        operation: `${opPrefix}_control_taken`,
        identityKey,
        hostId,
        geometry: conn.geometry,
      });
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
      if (mountedRef.current)
        toast.error(desktopErrorCopy(errorClassOf(err)).heading);
    } finally {
      if (mountedRef.current) setTaking(false);
    }
  }, [identityKey, hostId, logTag, opPrefix]);

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
    systemLogger.info(`[${logTag}] stream lost`, {
      operation: `${opPrefix}_stream_lost`,
      identityKey,
      hostId,
    });
    releaseIfHeld("stream-lost");
    setView({ status: "disconnected" });
  }, [releaseIfHeld, identityKey, hostId, logTag, opPrefix]);

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

  return { view, taking, inControl, connect, takeControl, start, onStreamLost };
}

/** Width × height of a live view's geometry, or [0, 0] when unknown. */
export function desktopGeometry(view: DesktopView): [number, number] {
  if (view.status !== "live" || !view.geometry) return [0, 0];
  const [w, h] = view.geometry.split("x").map(Number);
  return [w || 0, h || 0];
}

export const desktopToolbarBtnStyle: CSSProperties = {
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
}): ReactElement {
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

/**
 * What fills the desktop's box: a notice for every non-live state, or the
 * live display. The caller sizes the box.
 */
export function DesktopStage({
  session,
  isVisible,
}: {
  session: DesktopSession;
  isVisible: boolean;
}): ReactElement {
  const { view, connect, start, onStreamLost } = session;
  const [geoW, geoH] = desktopGeometry(view);
  return (
    <>
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
            style={desktopToolbarBtnStyle}
            onClick={() => void start()}
            data-testid="desktop-start"
          >
            <Play size={12} /> Start desktop
          </button>
        </Notice>
      )}
      {view.status === "disconnected" && (
        <Notice {...desktopErrorCopy("stream_error")}>
          <button
            type="button"
            style={desktopToolbarBtnStyle}
            onClick={() => void connect()}
          >
            <RefreshCw size={12} /> Reconnect
          </button>
        </Notice>
      )}
      {view.status === "error" && (
        <Notice {...desktopErrorCopy(view.errorClass)} />
      )}
      {view.status === "live" && (
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
    </>
  );
}
