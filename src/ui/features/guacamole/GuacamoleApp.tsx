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
const TAKEOVER_MARKER = "TERMIX_SUPERSEDED:";

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
    window.addEventListener("termix:refresh-guacamole", handler);
    return () =>
      window.removeEventListener("termix:refresh-guacamole", handler);
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
        onError={(err) => setConnectionError(err)}
        onDisconnect={() => {
          // Unexpected tunnel close (server-side ping failure, network blip,
          // backgrounded-tab idle drop). Re-issue a token and remount the
          // display. Skipped if we already surfaced an explicit error from
          // onError — that path needs the user's eyeballs.
          if (!connectionError) handleReconnect();
        }}
      />
      <Toolbar adapter={guacamoleAdapter} guacamoleDisplayRef={displayRef} />
    </div>
  );
};

export default GuacamoleApp;
