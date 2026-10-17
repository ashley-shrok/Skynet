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
import {
  KitBanner,
  KitButton,
  KitField,
  KitInput,
  KitLoading,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  kitConfirm,
  type KitConfirmOptions,
} from "@/components/kit";

const POLL_INTERVAL_MS = 3_000;
const POLL_WINDOW_MS = 15 * 60_000;
/** Link codes live 15 min server-side; refresh well before that. */
const LINK_REFRESH_MS = 10 * 60_000;

type TestStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok" }
  | { kind: "fail"; message: string };

const mutedText = "m-0 text-[13px] leading-[19px] text-[var(--k-t2)]";
const linkClass = "text-[var(--k-acc-text)] underline";

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
    <div className="flex flex-col gap-4" data-testid="preferences-telegram-setup">
      <p className={mutedText}>
        Notifications arrive as messages from your own Telegram bot. Setting
        one up takes a minute:
      </p>
      <ol className={`${mutedText} pl-5 list-decimal flex flex-col gap-1`}>
        <li>
          In Telegram, open{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className={linkClass}>
            @BotFather
          </a>{" "}
          and send <strong className="text-[var(--k-t1)]">/newbot</strong>.
        </li>
        <li>
          Give it any name, then a username ending in{" "}
          <strong className="text-[var(--k-t1)]">bot</strong>.
        </li>
        <li>BotFather replies with a token. Copy it and paste it here.</li>
      </ol>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <KitField
          label="Bot token"
          error={
            error ? <span data-testid="preferences-telegram-token-error">{error}</span> : undefined
          }
        >
          <div className="flex gap-2 flex-wrap">
            <KitInput
              type="text"
              mono
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AA…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Bot token"
              data-testid="preferences-telegram-token-input"
              className="flex-[1_1_200px] w-auto"
            />
            <KitButton
              type="submit"
              variant="primary"
              disabled={token.trim() === ""}
              busy={saving}
              data-testid="preferences-telegram-token-save"
            >
              {saving ? "Checking…" : "Save"}
            </KitButton>
          </div>
        </KitField>
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

  const handleRemove = useCallback(async (confirm: KitConfirmOptions) => {
    if (!(await kitConfirm(confirm))) return;
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
      <KitBanner tone="danger" data-testid="preferences-telegram-error">
        Failed to load notification settings: {loadError}
      </KitBanner>
    );
  } else if (!status) {
    content = <KitLoading lines={2} data-testid="preferences-telegram-loading" />;
  } else if (!status.setUp) {
    content = <SetupSteps onSaved={setStatus} />;
  } else if (!status.linked) {
    content = (
      <div className="flex flex-col gap-3" data-testid="preferences-telegram-awaiting-start">
        <p className={mutedText}>
          Your bot <strong className="text-[var(--k-t1)]">@{status.botUsername}</strong> is ready. Tap{" "}
          <strong className="text-[var(--k-t1)]">Open my bot</strong>, then tap{" "}
          <strong className="text-[var(--k-t1)]">Start</strong> in Telegram.
        </p>
        <div className="flex gap-2.5 flex-wrap">
          {linkUrl ? (
            // A real link styled as the kit's main button — see the header
            // note on why this can't be a window.open after an await.
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenBotClick}
              data-testid="preferences-telegram-open-bot"
              data-slot="kit-button"
              data-variant="primary"
              data-size="md"
              className="k-btn no-underline"
            >
              Open my bot
            </a>
          ) : (
            <KitButton variant="primary" disabled data-testid="preferences-telegram-open-bot-pending">
              Open my bot
            </KitButton>
          )}
          <KitButton
            onClick={() =>
              void handleRemove({
                title: "Use a different bot?",
                body: `This removes @${status.botUsername} so you can start over with a different one.`,
                confirmLabel: "Remove bot",
                destructive: true,
              })
            }
            disabled={busy}
            data-testid="preferences-telegram-use-different-bot"
          >
            Use a different bot
          </KitButton>
        </div>
        {waiting && (
          <span
            className="text-[12.5px] text-[var(--k-t3)]"
            data-testid="preferences-telegram-waiting"
          >
            Waiting for you to tap Start in Telegram…
          </span>
        )}
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col">
        <KitSettingsGroup>
          <KitSettingsRow
            data-testid="preferences-telegram-linked"
            label={
              <>
                Connected
                {status.telegramName ? (
                  <>
                    {" "}to <strong>{status.telegramName}</strong>
                  </>
                ) : null}
              </>
            }
            description={`Notifications arrive from your bot @${status.botUsername}.`}
          />
          <KitSettingsRow
            label="Only show who messaged, not the message text"
            control={
              <KitSwitch
                checked={!!status.titleOnly}
                disabled={busy}
                onCheckedChange={(next) => void handleTitleOnly(next)}
                aria-label="Only show who messaged, not the message text"
                data-testid="preferences-telegram-title-only"
              />
            }
          />
        </KitSettingsGroup>
        <KitSettingsGroup>
          <KitSettingsRow
            label={testStatus.kind === "pending" ? "Sending…" : "Send test notification"}
            onClick={() => void handleTest()}
            disabled={testStatus.kind === "pending"}
            chevron={false}
            data-testid="preferences-telegram-test"
          />
          <KitSettingsRow
            tone="danger"
            label="Disconnect"
            onClick={() =>
              void handleRemove({
                title: "Stop Telegram notifications?",
                body: "You'll need to paste a bot token again to turn them back on.",
                confirmLabel: "Disconnect",
                destructive: true,
              })
            }
            disabled={busy}
            chevron={false}
            data-testid="preferences-telegram-disconnect"
          />
        </KitSettingsGroup>
        {(testStatus.kind === "ok" || testStatus.kind === "fail") && (
          <span
            className={
              "mt-2 mx-1 text-[12.5px] " +
              (testStatus.kind === "ok" ? "text-[var(--k-ok)]" : "text-[var(--k-danger-text)]")
            }
            data-testid="preferences-telegram-test-result"
            role={testStatus.kind === "fail" ? "alert" : "status"}
          >
            {testStatus.kind === "ok" ? "✓ Test sent — check Telegram" : `Test failed: ${testStatus.message}`}
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col" data-testid="preferences-telegram-section">
      <h3 className="k-group-title">Telegram</h3>
      {content}
    </section>
  );
}
