import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  GuacamoleDisplay,
  type GuacamoleDisplayHandle,
} from "@/features/guacamole/GuacamoleDisplay.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { getGuacamoleTokenFromHost, getGuacdStatus } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Toolbar } from "@/features/keyboard/Toolbar.tsx";
import { makeGuacamoleAdapter } from "@/features/keyboard/guacamoleAdapter.ts";
import { Button } from "@/components/button.tsx";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import type { SSHHost } from "@/types";
// Phase 111 SKEW-10: guacamole client-side drift detection. The backend
// (Plan 05 Task 4) emits a `SKYNET_STALE_CLIENT:<serverBuild>` guacamole
// error instruction from server.on("open") when the encrypted token's
// buildId does not match SERVER_BUILD_ID. We mirror the takeover-pattern
// (SKYNET_SUPERSEDED:) below and fire the shell-level lock on detection.
import { CLIENT_BUILD_ID } from "@/lib/client-build-id";
import { lockSkewedSession } from "@/state/skew-lock-store";

interface GuacamoleAppProps {
  hostId?: string;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
  isVisible?: boolean;
  onClose?: () => void;
}

// Server-side marker prefix on the Guacamole error instruction emitted
// when this session was closed because a NEWER window opened the same
// (userId, hostId) — see backend guacamole-server.ts. The frontend uses
// the presence of this prefix to switch the disconnect overlay from the
// single-Reconnect "connection failed" copy to the friendlier
// Reconnect + Close Tab pair with "taken over by another window" text.
const TAKEOVER_MARKER = "SKYNET_SUPERSEDED:";

// Phase 111 SKEW-10: server-side marker prefix on the guacamole error
// instruction emitted when the encrypted token's buildId did not match
// SERVER_BUILD_ID (Plan 05 Task 4). Distinct from TAKEOVER_MARKER — this
// one triggers the shell-level skew lock (framework-owned SkewLockModal),
// not the per-pane overlay. The suffix after the colon is the server's
// build SHA, useful for the lock's diagnostic fields.
const STALE_CLIENT_MARKER = "SKYNET_STALE_CLIENT:";

const GuacamoleApp: React.FC<GuacamoleAppProps> = ({
  hostId,
  tabId,
  protocol,
  isVisible = true,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="relative w-full h-full">
              <SimpleLoader visible={true} message={t("common.loading")} />
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div
              className="flex flex-col items-center justify-center h-full gap-4"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {t("guacamole.hostNotFound")}
              </span>
            </div>
          );
        }

        if (!hostId) {
          return (
            <div
              className="flex flex-col items-center justify-center h-full gap-4"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {t("guacamole.hostNotFound")}
              </span>
            </div>
          );
        }

        return (
          <GuacamoleAppInner
            hostId={parseInt(hostId, 10)}
            hostConfig={hostConfig}
            tabId={tabId}
            protocol={protocol}
            isVisible={isVisible}
            onClose={onClose}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<SSHHost, "connectionType">;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
  isVisible: boolean;
  onClose?: () => void;
}

const GuacamoleAppInner: React.FC<GuacamoleAppInnerProps> = ({
  hostId,
  hostConfig,
  tabId,
  protocol,
  isVisible,
  onClose,
}) => {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const displayRef = useRef<GuacamoleDisplayHandle>(null);
  // Takeover-vs-auto-reconnect race guard. The Guacamole client fires
  // `onerror` (with the SKYNET_SUPERSEDED message) and state-5 `ondisconnect`
  // in the same tick. `connectionError` state doesn't commit until the next
  // React render, so `onDisconnect` reading the state would still see null
  // and trigger patch #10's auto-reconnect — which fights the takeover and
  // ping-pongs guacd workers. This ref updates synchronously in `onError`
  // so `onDisconnect` can suppress the reconnect on the same tick. Cleared
  // when the user explicitly hits Reconnect (they want a fresh takeover).
  const takenOverRef = useRef(false);

  const resolvedProtocol = (protocol ?? hostConfig.connectionType) as
    | "rdp"
    | "vnc"
    | "telnet";

  const guacamoleAdapter = useMemo(
    () => makeGuacamoleAdapter(displayRef, resolvedProtocol),
    [resolvedProtocol],
  );

  useEffect(() => {
    setToken(null);
    setError(null);
    getGuacdStatus()
      .then((status) => {
        if (status.guacd.status !== "connected") {
          setError(t("guacamole.guacdUnavailable"));
          return;
        }
        return getGuacamoleTokenFromHost(hostId, protocol);
      })
      .then((result) => {
        if (result) setToken(result.token);
      })
      .catch((err) => setError(err?.message || t("guacamole.failedToConnect")));
  }, [hostId, protocol, retryCount, t]);

  const handleReconnect = useCallback(() => {
    takenOverRef.current = false;
    setConnectionError(null);
    setError(null);
    setToken(null);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!tabId) return;
    const handler = (e: Event) => {
      const { tabId: eventTabId } = (e as CustomEvent).detail;
      if (eventTabId === tabId) handleReconnect();
    };
    window.addEventListener("skynet:refresh-guacamole", handler);
    return () =>
      window.removeEventListener("skynet:refresh-guacamole", handler);
  }, [tabId, handleReconnect]);

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-4"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        <AlertCircle
          className="size-10"
          style={{ color: "var(--foreground)" }}
        />
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--foreground)" }}
        >
          {t("guacamole.connectionFailed")}
        </p>
        <p
          className="text-xs max-w-xs text-center"
          style={{ color: "var(--foreground-secondary)" }}
        >
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={handleReconnect}>
          <RefreshCw className="size-4 mr-2" />
          {t("guacamole.retry")}
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="relative w-full h-full">
        <SimpleLoader
          visible={true}
          message={t("guacamole.connecting", {
            type: (
              protocol ||
              hostConfig.connectionType ||
              "remote"
            ).toUpperCase(),
          })}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {connectionError &&
        (() => {
          const superseded = connectionError.startsWith(TAKEOVER_MARKER);
          const displayText = superseded
            ? connectionError.slice(TAKEOVER_MARKER.length).trim()
            : connectionError;
          return (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-50"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {superseded
                  ? t("guacamole.sessionTakenOver")
                  : t("guacamole.connectionFailed")}
              </p>
              <p
                className="text-xs max-w-xs text-center"
                style={{ color: "var(--foreground-secondary)" }}
              >
                {displayText}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleReconnect}>
                  <RefreshCw className="size-4 mr-2" />
                  {t("guacamole.reconnect")}
                </Button>
                {superseded && onClose && (
                  <Button variant="outline" size="sm" onClick={onClose}>
                    {t("terminal.closeTab")}
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      <GuacamoleDisplay
        key={token}
        ref={displayRef}
        connectionConfig={{
          token,
          protocol: resolvedProtocol,
          type: resolvedProtocol,
        }}
        isVisible={isVisible}
        onError={(err) => {
          // Phase 111 SKEW-10: drift-refusal → shell-level lock, NOT
          // per-pane connection overlay. Backend emitted this because our
          // encrypted-token buildId != SERVER_BUILD_ID. Fire the lock and
          // stop further protocol processing (no setConnectionError, no
          // reconnect — the SkewLockModal will take over the viewport and
          // window.location.reload() is the only path forward).
          if (err.startsWith(STALE_CLIENT_MARKER)) {
            const serverBuild = err.slice(STALE_CLIENT_MARKER.length) || "unknown";
            lockSkewedSession({
              reason: "ws_handshake_mismatch",
              clientBuild: CLIENT_BUILD_ID,
              serverBuild,
            });
            // Suppress the auto-reconnect that onDisconnect below would fire.
            takenOverRef.current = true;
            return;
          }
          if (err.startsWith(TAKEOVER_MARKER)) takenOverRef.current = true;
          setConnectionError(err);
        }}
        onDisconnect={() => {
          // Unexpected tunnel close (server-side ping failure, network blip,
          // backgrounded-tab idle drop). Re-issue a token and remount the
          // display. Skipped if we already surfaced an explicit error from
          // onError — that path needs the user's eyeballs. Also skipped on
          // takeover (read from the ref, not the state, because both events
          // fire in the same tick and the state update hasn't committed).
          if (!connectionError && !takenOverRef.current) handleReconnect();
        }}
      />
      <Toolbar adapter={guacamoleAdapter} guacamoleDisplayRef={displayRef} />
    </div>
  );
};

export default GuacamoleApp;
