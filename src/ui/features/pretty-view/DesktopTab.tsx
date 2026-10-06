/**
 * DesktopTab — live, view-only look at an identity's virtual desktop.
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
import { Eye, Monitor, Play, RefreshCw } from "lucide-react";
import {
  connectDesktop,
  getDesktopStatus,
  startDesktop,
} from "@/api/workspace-desktop-api";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay";
import {
  resolveWorkspaceErrorCopy,
  type WorkspaceErrorCopy,
} from "./workspace-error-copy";

/** How long to wait for a desktop we just started before giving up. */
const START_TIMEOUT_MS = 90_000;
const START_POLL_MS = 2_000;

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
  | { status: "live"; token: string; geometry: string | null; attempt: number }
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
}: {
  identityKey: string;
  hostId: number;
  /** Whether the tab is the active one; the stream only connects while visible. */
  isVisible: boolean;
}): JSX.Element {
  const [view, setView] = useState<View>({ status: "connecting" });
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
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
  }, [identityKey, hostId]);

  // Connect when first shown; drop the stream when the tab is hidden.
  useEffect(() => {
    if (isVisible) void connect();
    else setView({ status: "connecting" });
  }, [isVisible, connect]);

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
        <span
          title="You're watching the agent's desktop. Input from here is turned off."
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          data-testid="desktop-view-only"
        >
          <Eye size={13} /> View only
        </span>
        {live && view.geometry && (
          <span style={{ opacity: 0.7 }}>
            · {view.geometry.replace("x", "×")}
          </span>
        )}
        <span style={{ flex: 1 }} />
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
            viewOnly
            isVisible={isVisible}
            connectionConfig={{
              token: view.token,
              protocol: "vnc",
              ...(geoW && geoH ? { width: geoW, height: geoH } : {}),
            }}
            onDisconnect={() =>
              mountedRef.current && setView({ status: "disconnected" })
            }
            onError={() =>
              mountedRef.current && setView({ status: "disconnected" })
            }
          />
        )}
      </div>
    </div>
  );
}
