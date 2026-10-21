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
    <form onSubmit={(e) => void handleSubmit(e)} data-testid="preferences-telegram-setup">
      <KitSettingsGroup
        title="Set up your bot — about a minute"
        footer={
          error ? (
            <span className="k-err" role="alert" data-testid="preferences-telegram-token-error">
              {error}
            </span>
          ) : (
            "The token is checked with Telegram before it's saved."
          )
        }
      >
        <KitSettingsRow
          leading={<StepNumber n={1} />}
          label={
            <>
              Open <strong>@BotFather</strong> in Telegram and send <strong>/newbot</strong>
            </>
          }
          control={
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              data-slot="kit-button"
              data-size="sm"
              className="k-btn no-underline shrink-0"
              data-testid="preferences-telegram-open-botfather"
            >
              Open BotFather
            </a>
          }
        />
        <KitSettingsRow
          leading={<StepNumber n={2} />}
          label={
            <>
              Give it any name, then a username ending in <strong>bot</strong>
            </>
          }
        />
        <KitSettingsRow
          stacked
          label={
            <span className="flex items-center gap-3">
              <StepNumber n={3} />
              <label htmlFor="preferences-telegram-token">Paste the token BotFather sends you</label>
            </span>
          }
          control={
            <span className="flex gap-2 pl-9 max-sm:pl-0">
              <KitInput
                id="preferences-telegram-token"
                type="text"
                mono
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AA…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Bot token"
                data-testid="preferences-telegram-token-input"
                className="flex-1 min-w-0 w-auto"
              />
              <KitButton
                type="submit"
                variant="primary"
                disabled={token.trim() === ""}
                busy={saving}
                data-testid="preferences-telegram-token-save"
              >
                {saving ? "Checking…" : "Connect"}
              </KitButton>
            </span>
          }
        />
      </KitSettingsGroup>
    </form>
  );
}

function StepNumber({ n }: { n: number }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="grid place-items-center size-6 shrink-0 rounded-full bg-[var(--k-s3)] text-[12px] font-bold text-[var(--k-t1)]"
    >
      {n}
    </span>
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
      <div data-testid="preferences-telegram-awaiting-start">
        <KitSettingsGroup
          footer={
            waiting ? (
              <span data-testid="preferences-telegram-waiting">
                Waiting for you to tap Start in Telegram…
              </span>
            ) : (
              <>
                Tap <strong>Open my bot</strong>, then tap <strong>Start</strong> in Telegram.
              </>
            )
          }
        >
          <KitSettingsRow
            label={
              <>
                Your bot <strong>@{status.botUsername}</strong> is ready
              </>
            }
            description="One last step links it to you."
            control={
              linkUrl ? (
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
                  data-size="sm"
                  className="k-btn no-underline shrink-0"
                >
                  Open my bot
                </a>
              ) : (
                <KitButton
                  variant="primary"
                  size="sm"
                  disabled
                  data-testid="preferences-telegram-open-bot-pending"
                >
                  Open my bot
                </KitButton>
              )
            }
          />
        </KitSettingsGroup>
        <KitSettingsGroup>
          <KitSettingsRow
            label="Use a different bot"
            onClick={() =>
              void handleRemove({
                title: "Use a different bot?",
                body: `This removes @${status.botUsername} so you can start over with a different one.`,
                confirmLabel: "Remove bot",
                destructive: true,
              })
            }
            disabled={busy}
            chevron={false}
            data-testid="preferences-telegram-use-different-bot"
          />
        </KitSettingsGroup>
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
            description={`From your bot @${status.botUsername}`}
          />
          <KitSettingsRow
            label="Only show who messaged"
            description="Leave the message text out of notifications."
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
        <KitSettingsGroup
          footer={
            testStatus.kind === "ok" || testStatus.kind === "fail" ? (
              <span
                className={testStatus.kind === "ok" ? "text-[var(--k-ok)]" : "k-err"}
                data-testid="preferences-telegram-test-result"
                role={testStatus.kind === "fail" ? "alert" : "status"}
              >
                {testStatus.kind === "ok"
                  ? "✓ Test sent — check Telegram"
                  : `Test failed: ${testStatus.message}`}
              </span>
            ) : undefined
          }
        >
          <KitSettingsRow
            tone="accent"
            label={testStatus.kind === "pending" ? "Sending…" : "Send a test notification"}
            onClick={() => void handleTest()}
            disabled={testStatus.kind === "pending"}
            chevron={false}
            data-testid="preferences-telegram-test"
          />
        </KitSettingsGroup>
        <KitSettingsGroup footer="Removes the bot from your settings. You can set it up again any time.">
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
      </div>
    );
  }

  return (
    <section className="flex flex-col" data-testid="preferences-telegram-section">
      {content}
    </section>
  );
}
