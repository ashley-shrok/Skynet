/**
 * Telegram section of Preferences → Notifications.
 *
 * States:
 *   unavailable  → server has no bot configured; short note, no actions
 *   not linked   → "Connect Telegram" link (opens the bot with a one-time
 *                  code; the user taps Start there). While waiting, the
 *                  section polls the backend until the link lands.
 *   linked       → who it's linked to, title-only toggle, test, disconnect
 *
 * The Connect control is a real <a href> fetched ahead of time rather than a
 * window.open after an await — iOS blocks popups opened outside the tap, and
 * a plain link also hands off to the Telegram app cleanly.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  deleteTelegram,
  getTelegramStatus,
  patchTelegram,
  postTelegramLink,
  postTelegramTest,
  type TelegramStatus,
} from "@/features/notifications/telegram-setup-api";

const POLL_INTERVAL_MS = 3_000;
const POLL_WINDOW_MS = 15 * 60_000;
/** Link codes live 15 min server-side; refresh well before that. */
const LINK_REFRESH_MS = 10 * 60_000;

type TestStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok" }
  | { kind: "fail"; message: string };

const mutedText = { color: "#c8c4b8" };

const buttonStyle = (disabled: boolean, primary = false) => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: `1px solid rgba(255,240,215,${primary ? 0.18 : 0.12})`,
  background: primary ? "rgba(20,21,32,0.6)" : "transparent",
  color: primary ? "#e8e4d8" : "#c8c4b8",
  fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
  textDecoration: "none",
  display: "inline-block",
});

export function PreferencesTelegramSection(): ReactElement {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: "idle" });
  const pollStartedAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getTelegramStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsLink = !!status?.available && !status.linked;

  // Keep a fresh one-time link ready while not linked.
  useEffect(() => {
    if (!needsLink) {
      setLinkUrl(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      postTelegramLink()
        .then(({ url }) => {
          if (!cancelled) setLinkUrl(url);
        })
        .catch(() => {
          if (!cancelled) setLinkUrl(null);
        });
    };
    refresh();
    const timer = setInterval(refresh, LINK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [needsLink]);

  // After Connect is tapped, poll until the bot reports the link.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() - pollStartedAt.current > POLL_WINDOW_MS) {
        setWaiting(false);
        return;
      }
      getTelegramStatus()
        .then((s) => {
          if (s.linked) {
            setStatus(s);
            setWaiting(false);
          }
        })
        .catch(() => {
          // Transient — keep polling.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  const handleConnectClick = useCallback(() => {
    pollStartedAt.current = Date.now();
    setWaiting(true);
  }, []);

  const handleTest = useCallback(async () => {
    setTestStatus({ kind: "pending" });
    try {
      const result = await postTelegramTest();
      setTestStatus(
        result.ok ? { kind: "ok" } : { kind: "fail", message: result.error ?? "Unknown error" },
      );
    } catch (err: unknown) {
      setTestStatus({ kind: "fail", message: err instanceof Error ? err.message : "Network error" });
    }
  }, []);

  const handleTitleOnly = useCallback(async (titleOnly: boolean) => {
    setBusy(true);
    try {
      setStatus(await patchTelegram(titleOnly));
    } catch {
      // Leave the toggle as it was — user can retry.
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm("Stop sending Skynet notifications to Telegram?")) return;
    setBusy(true);
    try {
      setStatus(await deleteTelegram());
      setTestStatus({ kind: "idle" });
    } catch {
      // User can retry.
    } finally {
      setBusy(false);
    }
  }, []);

  let content: ReactElement;
  if (loadError) {
    content = (
      <p className="text-[13px]" style={{ color: "#d38f8f" }} data-testid="preferences-telegram-error">
        Failed to load Telegram settings: {loadError}
      </p>
    );
  } else if (!status) {
    content = (
      <p className="text-[13px]" style={mutedText} data-testid="preferences-telegram-loading">
        Loading…
      </p>
    );
  } else if (!status.available) {
    content = (
      <p className="text-[13px] leading-[18px]" style={mutedText} data-testid="preferences-telegram-unavailable">
        Telegram notifications aren&apos;t set up on this server.
      </p>
    );
  } else if (!status.linked) {
    content = (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[18px]" style={mutedText}>
          Get notifications as messages from the Skynet bot in Telegram. Tap
          Connect, then tap <strong>Start</strong> in Telegram.
        </p>
        <div>
          {linkUrl ? (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleConnectClick}
              data-testid="preferences-telegram-connect"
              style={buttonStyle(false, true)}
            >
              Connect Telegram
            </a>
          ) : (
            <span style={buttonStyle(true, true)} data-testid="preferences-telegram-connect-pending">
              Connect Telegram
            </span>
          )}
        </div>
        {waiting && (
          <span className="text-[12px]" style={mutedText} data-testid="preferences-telegram-waiting">
            Waiting for you to tap Start in Telegram…
          </span>
        )}
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[18px]" style={mutedText} data-testid="preferences-telegram-linked">
          Connected{status.telegramName ? <> to <strong>{status.telegramName}</strong></> : null}.
          Notifications arrive from @{status.botUsername}.
        </p>
        <label className="flex items-center gap-2 text-[13px]" style={mutedText}>
          <input
            type="checkbox"
            checked={!!status.titleOnly}
            disabled={busy}
            onChange={(e) => void handleTitleOnly(e.target.checked)}
            data-testid="preferences-telegram-title-only"
          />
          Only show who messaged, not the message text
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testStatus.kind === "pending"}
            data-testid="preferences-telegram-test"
            style={buttonStyle(testStatus.kind === "pending", true)}
          >
            {testStatus.kind === "pending" ? "Sending…" : "Send test notification"}
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={busy}
            data-testid="preferences-telegram-disconnect"
            style={buttonStyle(busy)}
          >
            Disconnect
          </button>
        </div>
        {(testStatus.kind === "ok" || testStatus.kind === "fail") && (
          <span
            className="text-[12px]"
            data-testid="preferences-telegram-test-result"
            style={{ color: testStatus.kind === "ok" ? "#8fd39e" : "#d38f8f" }}
          >
            {testStatus.kind === "ok" ? "✓ Test sent — check Telegram" : `Test failed: ${testStatus.message}`}
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="preferences-telegram-section">
      <h3
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "rgba(200,196,184,0.6)",
          fontWeight: 600,
          margin: 0,
        }}
      >
        Telegram
      </h3>
      {content}
    </section>
  );
}
