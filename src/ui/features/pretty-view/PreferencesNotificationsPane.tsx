/**
 * Phase 144 Plan 03 — PreferencesNotificationsPane (ntfy rebuild)
 * Phase 145 — now surfaces FOUR values (server, topic, username, password).
 * The ntfy iOS app's per-topic Login dialog does Basic auth; it needs both a
 * username and a password, not a single bearer token.
 *
 * Rebuilt from scratch. Replaces the Phase 128/137 browser-push flow entirely.
 *
 * Two states:
 *   isSetUp === false  → "Set up notifications" primary button + explainer copy
 *   isSetUp === true   → Four value rows (server address, topic name, ntfy
 *                        username, ntfy password) with copy-to-clipboard
 *                        affordances, a "Send test notification" button, and a
 *                        "Regenerate password" button.
 *
 * Honest state signal: isSetUp is derived from backend truth (GET /ntfy-setup
 * returning a row), NOT from a browser permission bit. The pane has NO calls
 * to Notification.permission, requestPermission, pushManager, or VAPID APIs.
 *
 * The test button is the ONLY ground truth for delivery health — there is no
 * passive "last delivery" indicator, heartbeat, or drift detection.
 *
 * "Regenerate password" uses window.confirm to gate the hard rotation
 * (T-144-15: mitigate spoofing — user must explicitly confirm before the
 * backend invalidates the old credential).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getNtfySetup,
  postNtfySetup,
  postNtfyTest,
  postNtfyRegenerate,
  type NtfySetup,
} from "@/features/notifications/ntfy-setup-api";

// ─── Types ────────────────────────────────────────────────────────────────────

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; setup: NtfySetup };

type TestStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok" }
  | { kind: "fail"; message: string };

// ─── Copy affordance hook ─────────────────────────────────────────────────────

function useCopyToClipboard(value: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard write failed silently — not a critical failure
    });
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { copy, copied };
}

// ─── Value row ───────────────────────────────────────────────────────────────

interface ValueRowProps {
  label: string;
  value: string;
  testId: string;
}

function ValueRow({ label, value, testId }: ValueRowProps) {
  const { copy, copied } = useCopyToClipboard(value);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 0",
        borderBottom: "1px solid rgba(255,240,215,0.08)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "rgba(200,196,184,0.6)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          data-testid={testId}
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            color: "#e8e4d8",
            wordBreak: "break-all",
            flex: 1,
          }}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,240,215,0.18)",
            background: "rgba(20,21,32,0.6)",
            color: copied ? "#8fd39e" : "#c8c4b8",
            fontSize: 11,
            cursor: "pointer",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ─── Not-set-up view ─────────────────────────────────────────────────────────

interface NotSetUpViewProps {
  onSetUp: () => void;
  isSettingUp: boolean;
}

function NotSetUpView({ onSetUp, isSettingUp }: NotSetUpViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <p
        className="text-[13px] leading-[18px]"
        style={{ color: "#c8c4b8" }}
      >
        Tap to generate your ntfy credentials. You&apos;ll enter the values
        into the ntfy iOS app.
      </p>
      <button
        type="button"
        onClick={onSetUp}
        disabled={isSettingUp}
        aria-label="Set up notifications"
        title="Set up notifications"
        data-testid="preferences-notifications-setup-button"
        style={{
          padding: "10px 16px",
          borderRadius: 10,
          border: "1px solid rgba(255,240,215,0.18)",
          background: "rgba(20,21,32,0.6)",
          color: "#e8e4d8",
          fontSize: 14,
          cursor: isSettingUp ? "not-allowed" : "pointer",
          alignSelf: "flex-start",
          opacity: isSettingUp ? 0.6 : 1,
        }}
      >
        {isSettingUp ? "Setting up…" : "Set up notifications"}
      </button>
    </div>
  );
}

// ─── Set-up view ─────────────────────────────────────────────────────────────

interface SetUpViewProps {
  setup: NtfySetup;
  onTest: () => void;
  onRegenerate: () => void;
  testStatus: TestStatus;
  isRegenerating: boolean;
}

function SetUpView({
  setup,
  onTest,
  onRegenerate,
  testStatus,
  isRegenerating,
}: SetUpViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Honest-copy section above setup values */}
      <p
        className="text-[13px] leading-[18px]"
        style={{ color: "#c8c4b8", marginBottom: 8 }}
      >
        Notifications arrive on your phone via the ntfy iOS app (not this
        browser). Install the ntfy app, add a subscription using the values
        below.
      </p>

      {/* Four value rows */}
      <ValueRow
        label="Server address"
        value={setup.serverAddress ?? ""}
        testId="preferences-notifications-server-address"
      />
      <ValueRow
        label="Topic name"
        value={setup.topicName ?? ""}
        testId="preferences-notifications-topic-name"
      />
      <ValueRow
        label="ntfy username"
        value={setup.ntfyUsername ?? ""}
        testId="preferences-notifications-ntfy-username"
      />
      <ValueRow
        label="ntfy password"
        value={setup.ntfyPassword ?? ""}
        testId="preferences-notifications-ntfy-password"
      />

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onTest}
          disabled={testStatus.kind === "pending"}
          aria-label="Send test notification"
          title="Send test notification"
          data-testid="preferences-notifications-test-button"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,240,215,0.18)",
            background: "rgba(20,21,32,0.6)",
            color: "#e8e4d8",
            fontSize: 13,
            cursor: testStatus.kind === "pending" ? "not-allowed" : "pointer",
            opacity: testStatus.kind === "pending" ? 0.6 : 1,
          }}
        >
          {testStatus.kind === "pending" ? "Sending…" : "Send test notification"}
        </button>

        <button
          type="button"
          onClick={onRegenerate}
          disabled={isRegenerating}
          aria-label="Regenerate password"
          title="Regenerate password"
          data-testid="preferences-notifications-regenerate-button"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(255,240,215,0.12)",
            background: "transparent",
            color: "#c8c4b8",
            fontSize: 13,
            cursor: isRegenerating ? "not-allowed" : "pointer",
            opacity: isRegenerating ? 0.6 : 1,
          }}
        >
          {isRegenerating ? "Regenerating…" : "Regenerate password"}
        </button>
      </div>

      {/* Test result inline */}
      {testStatus.kind !== "idle" && testStatus.kind !== "pending" && (
        <span
          data-testid="preferences-notifications-test-result"
          style={{
            fontSize: 12,
            marginTop: 4,
            color: testStatus.kind === "ok" ? "#8fd39e" : "#d38f8f",
          }}
        >
          {testStatus.kind === "ok"
            ? "✓ Test sent — if your phone buzzed, setup works"
            : `Test failed: ${testStatus.message}`}
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface PreferencesNotificationsPaneProps {
  userId?: string;
}

export function PreferencesNotificationsPane(
  _props: PreferencesNotificationsPaneProps,
): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: "idle" });
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const testClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount, fetch ntfy setup state from backend (backend is the only truth)
  useEffect(() => {
    let cancelled = false;
    getNtfySetup()
      .then((setup) => {
        if (!cancelled) setLoadState({ status: "loaded", setup });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load notification settings",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup test-clear timer on unmount
  useEffect(() => {
    return () => {
      if (testClearTimerRef.current !== null) clearTimeout(testClearTimerRef.current);
    };
  }, []);

  const handleSetUp = useCallback(async () => {
    setIsSettingUp(true);
    try {
      const setup = await postNtfySetup();
      setLoadState({ status: "loaded", setup });
    } catch {
      // Error handled in the setup button state — user can retry
    } finally {
      setIsSettingUp(false);
    }
  }, []);

  const handleTest = useCallback(async () => {
    setTestStatus({ kind: "pending" });
    if (testClearTimerRef.current !== null) clearTimeout(testClearTimerRef.current);
    try {
      const result = await postNtfyTest();
      if (result.ok) {
        setTestStatus({ kind: "ok" });
      } else {
        setTestStatus({ kind: "fail", message: result.error ?? "Unknown error" });
      }
    } catch (err: unknown) {
      setTestStatus({
        kind: "fail",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
    // Auto-clear after 10s
    testClearTimerRef.current = setTimeout(() => {
      setTestStatus({ kind: "idle" });
    }, 10000);
  }, []);

  const handleRegenerate = useCallback(async () => {
    // T-144-15 mitigation: hard rotation requires explicit user confirmation
    const confirmed = window.confirm(
      "Replace the current ntfy password? You’ll need to re-enter the new password in the ntfy iOS app.",
    );
    if (!confirmed) return;

    setIsRegenerating(true);
    try {
      const newSetup = await postNtfyRegenerate();
      setLoadState({ status: "loaded", setup: newSetup });
    } catch {
      // Regenerate error — user can retry
    } finally {
      setIsRegenerating(false);
    }
  }, []);

  // ── Render states ─────────────────────────────────────────────────────────

  if (loadState.status === "loading") {
    return (
      <div
        className="flex-1 p-6 text-[13px] text-[#c8c4b8]"
        data-testid="preferences-notifications-loading"
      >
        Loading notification settings…
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div
        className="flex-1 p-6 text-[13px]"
        style={{ color: "#d38f8f" }}
        data-testid="preferences-notifications-error"
      >
        Failed to load notification settings: {loadState.message}
      </div>
    );
  }

  const { setup } = loadState;

  return (
    <div className="flex-1 p-6 flex flex-col gap-4">
      {setup.isSetUp ? (
        <SetUpView
          setup={setup}
          onTest={handleTest}
          onRegenerate={handleRegenerate}
          testStatus={testStatus}
          isRegenerating={isRegenerating}
        />
      ) : (
        <NotSetUpView onSetUp={handleSetUp} isSettingUp={isSettingUp} />
      )}
    </div>
  );
}
