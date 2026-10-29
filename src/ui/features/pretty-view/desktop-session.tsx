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
 * Handing over: a surface that opens another view of the same desktop while
 * in control (the phone's "Open full screen") hands its lease over instead of
 * releasing it; the next surface to connect takes control straight away, so
 * the agent never gets the desktop back in between. Unclaimed after
 * HANDOVER_MS, the lease is released.
 *
 * Several surfaces may show the same desktop at once (the tab in one window, a
 * pane in another): the backend shares one tunnel per desktop, and each
 * surface sees `agentPaused` when someone else holds control. A watching
 * surface re-reads that every STATUS_POLL_MS, so it follows control being
 * taken or handed back elsewhere.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
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
import { KitButton, KitEmpty } from "@/components/kit";
import {
  GuacamoleDisplay,
  type GuacamoleDisplayHandle,
} from "@/features/guacamole/GuacamoleDisplay";
import { FITTED_VIEW, type ViewState } from "@/features/guacamole/touch/viewport";
import { makeGuacamoleAdapter } from "@/features/keyboard/guacamoleAdapter";
import type { ModifierState } from "@/features/keyboard/inputAdapter";
import { Toolbar } from "@/features/keyboard/Toolbar";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
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
/** How often a watching surface re-checks whether someone has control. */
const STATUS_POLL_MS = 15_000;
/** How long a handed-over lease waits for the next surface before it's released. */
export const HANDOVER_MS = 10_000;

const DESKTOP_ERROR_COPY: Record<string, WorkspaceErrorCopy> = {
  not_installed: {
    heading: "Desktops aren't set up on this computer yet",
    body: "The desktop tools haven't been installed here. They arrive with the next fleet update.",
  },
  guacd_unreachable: {
    heading: "The viewer service isn't reachable",
    body: "The remote-desktop service isn't responding right now. Try again in a moment.",
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
  /**
   * Pass the lease on to the next surface that opens this desktop, instead of
   * releasing it (true when there was a lease to pass on).
   */
  handOverControl: () => boolean;
}

/**
 * Releases still in flight, per desktop. Every surface's connect waits for
 * one, so a surface opened as another hands back (e.g. "Open beside
 * conversation" while in control) doesn't read the lease being dropped and
 * show the agent as paused.
 */
const pendingReleases = new Map<string, Promise<void>>();

function desktopKey(identityKey: string, hostId: number): string {
  return `${hostId}::${identityKey}`;
}

/** Release the lease, recorded so every surface's connect waits for it. */
function trackRelease(identityKey: string, hostId: number): Promise<void> {
  const key = desktopKey(identityKey, hostId);
  const release = releaseDesktopControl(identityKey, hostId).then(
    () => {},
    () => {},
  );
  pendingReleases.set(key, release);
  void release.then(() => {
    if (pendingReleases.get(key) === release) pendingReleases.delete(key);
  });
  return release;
}

/** Leases handed over and not yet claimed, per desktop: the release timer. */
const pendingHandovers = new Map<string, ReturnType<typeof setTimeout>>();

/** Take a handed-over lease for this desktop (true when there was one). */
function claimHandover(key: string): boolean {
  const timer = pendingHandovers.get(key);
  if (timer === undefined) return false;
  clearTimeout(timer);
  pendingHandovers.delete(key);
  return true;
}

/** Test-only: forget handovers between cases. */
export function __resetDesktopHandoversForTest(): void {
  for (const t of pendingHandovers.values()) clearTimeout(t);
  pendingHandovers.clear();
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
  /** Bumped by every connect and hide; an older connect that resumes late bows out. */
  const connectGenRef = useRef(0);
  const onControlChangeRef = useRef(onControlChange);
  onControlChangeRef.current = onControlChange;
  const opPrefix = logTag.replace(/-/g, "_");

  /**
   * Drop the lease if we hold it. Returns the release request (callers may
   * await it; it never rejects — the lease lapses on its own anyway), or null
   * when there was nothing to drop.
   */
  const releaseIfHeld = useCallback(
    (reason: string): Promise<void> | null => {
      if (!controlRef.current) return null;
      controlRef.current = false;
      onControlChangeRef.current?.(false);
      systemLogger.info(`[${logTag}] control released`, {
        operation: `${opPrefix}_control_released`,
        identityKey,
        hostId,
        reason,
      });
      return trackRelease(identityKey, hostId);
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
    const gen = ++connectGenRef.current;
    releaseIfHeld("reconnect-or-hand-back");
    setView({ status: "connecting" });
    try {
      // Let any release of this desktop land first, or the connect's status
      // read can still see that lease and report the agent as paused.
      const release = pendingReleases.get(desktopKey(identityKey, hostId));
      if (release) await release;
      if (!mountedRef.current || gen !== connectGenRef.current) return;
      const conn = await connectDesktop(identityKey, hostId);
      if (!mountedRef.current || gen !== connectGenRef.current) return;
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
      if (!mountedRef.current || gen !== connectGenRef.current) return;
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

  /** A handed-over take is in flight (a re-run effect mustn't connect over it). */
  const handoverTakingRef = useRef(false);
  // Assigned below once takeControl exists (it needs connect).
  const takeControlRef = useRef<(opts?: { handedOver?: boolean }) => Promise<void>>(
    async () => {},
  );
  // Connect when shown — straight into control when a lease was handed over
  // to this desktop; drop the stream (and any control) when hidden.
  useEffect(() => {
    if (isVisible) {
      if (handoverTakingRef.current) return;
      if (claimHandover(desktopKey(identityKey, hostId))) {
        systemLogger.info(`[${logTag}] control handover claimed`, {
          operation: `${opPrefix}_control_handover_claimed`,
          identityKey,
          hostId,
        });
        void takeControlRef.current({ handedOver: true });
      } else void connect();
    } else {
      connectGenRef.current += 1;
      if (releaseIfHeld("hidden") !== null) toast.info("Handed back to agent");
      setView({ status: "connecting" });
    }
  }, [isVisible, connect, releaseIfHeld, identityKey, hostId, logTag, opPrefix]);

  const takeControl = useCallback(async (opts?: { handedOver?: boolean }) => {
    const handedOver = opts?.handedOver === true;
    // A connect still in flight bows out rather than land over the take.
    const gen = ++connectGenRef.current;
    if (handedOver) handoverTakingRef.current = true;
    setTaking(true);
    try {
      const conn = await takeDesktopControl(identityKey, hostId);
      if (!mountedRef.current || gen !== connectGenRef.current) {
        // Unmounted, hidden or reconnected meanwhile: don't keep the lease.
        void trackRelease(identityKey, hostId);
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
      if (handedOver) {
        // The handed-over lease is still ours: let the agent have it back,
        // and say so rather than leave a view-only desktop that looks driven.
        systemLogger.info(`[${logTag}] control handover failed`, {
          operation: `${opPrefix}_control_handover_failed`,
          identityKey,
          hostId,
          errorClass: errorClassOf(err),
        });
        void trackRelease(identityKey, hostId);
        if (mountedRef.current) {
          toast.error("Couldn't keep control — handed back to agent");
          handoverTakingRef.current = false;
          void connect();
        }
      } else if (mountedRef.current) {
        toast.error(desktopErrorCopy(errorClassOf(err)).heading);
      }
    } finally {
      if (handedOver) handoverTakingRef.current = false;
      if (mountedRef.current) setTaking(false);
    }
  }, [identityKey, hostId, logTag, opPrefix, connect]);
  takeControlRef.current = takeControl;

  const handOverControl = useCallback((): boolean => {
    if (!controlRef.current) return false;
    controlRef.current = false;
    onControlChangeRef.current?.(false);
    const key = desktopKey(identityKey, hostId);
    const prev = pendingHandovers.get(key);
    if (prev !== undefined) clearTimeout(prev);
    pendingHandovers.set(
      key,
      setTimeout(() => {
        if (!pendingHandovers.has(key)) return;
        pendingHandovers.delete(key);
        systemLogger.info(`[${logTag}] control handover unclaimed — released`, {
          operation: `${opPrefix}_control_handover_unclaimed`,
          identityKey,
          hostId,
        });
        void trackRelease(identityKey, hostId);
      }, HANDOVER_MS),
    );
    systemLogger.info(`[${logTag}] control handed over`, {
      operation: `${opPrefix}_control_handed_over`,
      identityKey,
      hostId,
    });
    return true;
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

  // While watching, keep "someone has control" current — control can be
  // taken or handed back from another surface at any time.
  const watching =
    isVisible && view.status === "live" && !view.control;
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const timer = setInterval(() => {
      getDesktopStatus(identityKey, hostId)
        .then((s) => {
          if (cancelled || !mountedRef.current) return;
          if (!s.available || !s.running) return;
          setView((v) => {
            if (v.status !== "live" || v.control) return v;
            if (v.agentPaused === s.userHasControl) return v;
            systemLogger.info(`[${logTag}] control status changed`, {
              operation: `${opPrefix}_agent_paused_changed`,
              identityKey,
              hostId,
              agentPaused: s.userHasControl,
            });
            return { ...v, agentPaused: s.userHasControl };
          });
        })
        .catch(() => {});
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watching, identityKey, hostId, logTag, opPrefix]);

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

  return {
    view,
    taking,
    inControl,
    connect,
    takeControl: () => takeControl(),
    start,
    onStreamLost,
    handOverControl,
  };
}

/** Width × height of a live view's geometry, or [0, 0] when unknown. */
export function desktopGeometry(view: DesktopView): [number, number] {
  if (view.status !== "live" || !view.geometry) return [0, 0];
  const [w, h] = view.geometry.split("x").map(Number);
  return [w || 0, h || 0];
}


/** A desktop state in the box (connecting, stopped, problem). */
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
    <div className="flex h-full items-center justify-center">
      <KitEmpty icon={<Monitor aria-hidden="true" />} title={heading} body={body || undefined} action={children} />
    </div>
  );
}

/**
 * What fills the desktop's box: a notice for every non-live state, or the
 * live display. The caller sizes the box.
 *
 * On a touch screen, while this surface has control, the key strip (the one
 * remote sessions and terminals use) floats over the desktop, and phone
 * typing combines with its held modifiers. `displayRef` lets the caller's
 * bar raise the phone keyboard.
 */
export function DesktopStage({
  session,
  isVisible,
  displayRef: callerDisplayRef,
}: {
  session: DesktopSession;
  isVisible: boolean;
  displayRef?: RefObject<GuacamoleDisplayHandle | null>;
}): ReactElement {
  const { view, connect, start, onStreamLost } = session;
  const [geoW, geoH] = desktopGeometry(view);
  const ownDisplayRef = useRef<GuacamoleDisplayHandle | null>(null);
  const displayRef = callerDisplayRef ?? ownDisplayRef;
  const isTouchDevice = useIsTouchDevice();
  // The zoomed view lasts while this surface is open (through reconnects).
  const touchViewRef = useRef<ViewState>({ ...FITTED_VIEW });
  const adapter = useMemo(() => makeGuacamoleAdapter(displayRef, "vnc"), [displayRef]);
  const stickyRef = useRef<ModifierState | null>(null);
  const clearStickyRef = useRef<(() => void) | null>(null);
  const handleStickyChange = useCallback((mods: ModifierState) => {
    stickyRef.current = mods;
  }, []);
  const registerClearSticky = useCallback((clear: () => void) => {
    clearStickyRef.current = clear;
  }, []);
  const handlePhoneTyped = useCallback(() => {
    const mods = stickyRef.current;
    if (mods && (mods.ctrl || mods.alt || mods.shift || mods.win)) {
      clearStickyRef.current?.();
    }
  }, []);
  const showKeyStrip = isTouchDevice && view.status === "live" && view.control;
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
          <KitButton variant="primary" onClick={() => void start()} data-testid="desktop-start">
            <Play size={14} aria-hidden="true" /> Start desktop
          </KitButton>
        </Notice>
      )}
      {view.status === "disconnected" && (
        <Notice {...desktopErrorCopy("stream_error")}>
          <KitButton onClick={() => void connect()}>
            <RefreshCw size={14} aria-hidden="true" /> Reconnect
          </KitButton>
        </Notice>
      )}
      {view.status === "error" && (
        <Notice {...desktopErrorCopy(view.errorClass)} />
      )}
      {view.status === "live" && (
        <GuacamoleDisplay
          key={view.attempt}
          ref={displayRef}
          viewOnly={!view.control}
          fixedRemoteSize
          touchView={touchViewRef}
          onPhoneTyped={handlePhoneTyped}
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
      {showKeyStrip && (
        <Toolbar
          adapter={adapter}
          guacamoleDisplayRef={displayRef}
          onStickyChange={handleStickyChange}
          registerClearSticky={registerClearSticky}
        />
      )}
    </>
  );
}
