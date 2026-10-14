/**
 * Preferences → Notifications: Telegram setup. Each user sets up their own
 * bot — nothing server-side to configure.
 *
 * States:
 *   not set up   → steps for creating a bot with @BotFather + a token box
 *   bot saved    → "Open my bot" (a one-time Start link). While waiting, the
 *                  section polls the backend until the chat link lands.
 *   linked       → who it's linked to, title-only toggle, test, disconnect
 *
 * The Open-my-bot control is a real <a href> fetched ahead of time rather
 * than a window.open after an await — iOS blocks popups opened outside the
 * tap, and a plain link also hands off to the Telegram app cleanly.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  deleteTelegram,
  getTelegramStatus,
  patchTelegram,
  postTelegramLink,
  postTelegramTest,
  putTelegramBot,
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
const linkStyle = { color: "#e8e4d8", textDecoration: "underline" };

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

function SetupSteps({ onSaved }: { onSaved: (s: TelegramStatus) => void }): ReactElement {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);
      try {
        onSaved(await putTelegramBot(token.trim()));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Couldn't save the token");
      } finally {
        setSaving(false);
      }
    },
    [token, onSaved],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="preferences-telegram-setup">
      <p className="text-[13px] leading-[18px]" style={mutedText}>
        Notifications arrive as messages from your own Telegram bot. Setting
        one up takes a minute:
      </p>
      <ol className="text-[13px] leading-[19px]" style={{ ...mutedText, margin: 0, paddingLeft: 20 }}>
        <li>
          In Telegram, open{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={linkStyle}>
            @BotFather
          </a>{" "}
          and send <strong>/newbot</strong>.
        </li>
        <li>
          Give it any name, then a username ending in <strong>bot</strong>.
        </li>
        <li>BotFather replies with a token. Copy it and paste it here.</li>
      </ol>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-2">
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="123456789:AA…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Bot token"
          data-testid="preferences-telegram-token-input"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,240,215,0.18)",
            background: "rgba(20,21,32,0.6)",
            color: "#e8e4d8",
            fontFamily: "monospace",
            fontSize: 13,
          }}
        />
        <div>
          <button
            type="submit"
            disabled={saving || token.trim() === ""}
            data-testid="preferences-telegram-token-save"
            style={buttonStyle(saving || token.trim() === "", true)}
          >
            {saving ? "Checking…" : "Save"}
          </button>
        </div>
        {error && (
          <span className="text-[12px]" style={{ color: "#d38f8f" }} data-testid="preferences-telegram-token-error">
            {error}
          </span>
        )}
      </form>
    </div>
  );
}

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

  const needsLink = !!status?.setUp && !status.linked;

  // Keep a fresh one-time Start link ready while the bot isn't linked yet.
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
  }, [needsLink, status?.botUsername]);

  // After Open my bot is tapped, poll until the bot reports the link.
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

  const handleOpenBotClick = useCallback(() => {
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

  const handleRemove = useCallback(async (confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      setStatus(await deleteTelegram());
      setWaiting(false);
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
        Failed to load notification settings: {loadError}
      </p>
    );
  } else if (!status) {
    content = (
      <p className="text-[13px]" style={mutedText} data-testid="preferences-telegram-loading">
        Loading…
      </p>
    );
  } else if (!status.setUp) {
    content = <SetupSteps onSaved={setStatus} />;
  } else if (!status.linked) {
    content = (
      <div className="flex flex-col gap-3" data-testid="preferences-telegram-awaiting-start">
        <p className="text-[13px] leading-[18px]" style={mutedText}>
          Your bot <strong>@{status.botUsername}</strong> is ready. Tap{" "}
          <strong>Open my bot</strong>, then tap <strong>Start</strong> in
          Telegram.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {linkUrl ? (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenBotClick}
              data-testid="preferences-telegram-open-bot"
              style={buttonStyle(false, true)}
            >
              Open my bot
            </a>
          ) : (
            <span style={buttonStyle(true, true)} data-testid="preferences-telegram-open-bot-pending">
              Open my bot
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleRemove("Remove this bot and start over with a different one?")}
            disabled={busy}
            data-testid="preferences-telegram-use-different-bot"
            style={buttonStyle(busy)}
          >
            Use a different bot
          </button>
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
          Notifications arrive from your bot @{status.botUsername}.
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
            onClick={() =>
              void handleRemove(
                "Stop Telegram notifications? You'll need to paste a bot token again to turn them back on.",
              )
            }
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
