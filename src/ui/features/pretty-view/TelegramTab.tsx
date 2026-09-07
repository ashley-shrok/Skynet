// Phase 79 Plan 07 Task 2 — TelegramTab (identity-scope, fixed real-estate).
//
// Renders the Telegram bridge activation surface for a single identity. Four
// state variants map to the CONTEXT § Locked decisions #3 flows:
//   • unconfigured  → paste-token form (3B: bad token / accepts+silent)
//   • pending-start → "waiting for /start" + Copy bot link + Cancel (3B)
//   • connected     → minimal "Connected. Bot: @X. Human: @Y." + Disconnect (3A)
//   • restart-failed→ error + Retry (3B: bridge did not come back)
//
// Plus loading + error transient variants that mirror HandoffTab's Skeleton /
// "Couldn't load…" branches (see IdentityFileTab TabState<T> shape family).
//
// Security invariants (see plan § threat_model T-79-07-01, T-79-07-02):
//   • The bot token lives ONLY in local component state (useState) during
//     paste; scrubbed on state transition (setToken("") after activate).
//   • NEVER console.log(token). NEVER render token in the DOM after transition.
//   • Bot token flows to the backend via POST body only (postTelegramActivate).
//
// AlertDialog confirm text (CONTEXT § 3D) is VERBATIM. Do not paraphrase.

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog";
import {
  postTelegramValidate,
  postTelegramActivate,
  postTelegramDisconnect,
  getTelegramPendingStatus,
} from "../../api/telegram-api";

// ─── State shape ─────────────────────────────────────────────────────────────
// Discriminated union covering loading + error + the four CONTEXT § 3 flows.
// Exported so IdentityModal can hold it in useState and thread it here.
export type TelegramState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "unconfigured" }
  | { status: "pending-start"; botUsername: string; botLink: string }
  | { status: "connected"; botUsername: string; telegramHandle: string }
  | { status: "restart-failed"; error: string };

// ─── Component ───────────────────────────────────────────────────────────────
export function TelegramTab({
  state,
  identityKey,
  identityName,
  humanUserId,
  onStateChange,
}: {
  state: TelegramState;
  identityKey: string;
  identityName: string;
  // Blocker W-3 fix: humanUserId is threaded from IdentityModal via
  // getUserInfo().userId (mirrors AppShell.tsx:412). Empty string until the
  // parent's fetch resolves; Submit is disabled while empty.
  humanUserId: string;
  onStateChange: (next: TelegramState) => void;
}) {
  // Local component state — never crosses component boundaries.
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ── Phase 83 Plan 06 — pending-start poll ────────────────────────────────
  //
  // Poll GET /telegram/status every 3s while awaiting the user's /start
  // message. When the bridge reports a non-null chatId (Plan 83-03 has
  // reconciled the sentinel into the DB), transition to "connected".
  //
  // Per CONTEXT § 5, poll errors are silently swallowed — no timeout that
  // flips to an error state ("human gets to it when they get to it").
  //
  // Cleanup semantics: interval is cleared on unmount AND on any state
  // transition away from pending-start (deps array below). A local flag
  // guards against a late-resolving tick calling onStateChange after
  // React has already torn down.
  //
  // Dep-array notes:
  //   • state.status keys the effect on/off pending-start.
  //   • The ternary for botUsername pulls the value from the discriminated-
  //     union variant that owns it; other variants pass "" so React sees
  //     no dep change from unrelated state changes.
  //   • identityKey is included so that a mid-poll identity switch restarts
  //     the interval with the new key (PLL-06).
  //   • onStateChange is stable-referenced by the parent modal; still
  //     included per exhaustive-deps hygiene.
  const pendingBotUsername =
    state.status === "pending-start" ? state.botUsername : "";
  useEffect(() => {
    if (state.status !== "pending-start") return;
    const currentBotUsername = pendingBotUsername;
    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled) return;
      try {
        const resp = await getTelegramPendingStatus(identityKey);
        if (cancelled) return;
        if (resp.ok === true && resp.chatId !== null) {
          onStateChange({
            status: "connected",
            botUsername: currentBotUsername,
            telegramHandle: resp.chatId,
          });
        }
        // Errors are silently swallowed — CONTEXT § 5 "no timeout that flips
        // to error". Next tick retries.
      } catch {
        // Defensive: swallow any thrown error too. The client wrapper
        // returns { ok:false } on axios failures, but guard anyway.
      }
    }

    const handle = setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [state.status, pendingBotUsername, identityKey, onStateChange]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleSubmitToken(): Promise<void> {
    if (!token || saving) return;
    setSaving(true);
    setInlineError(null);
    try {
      const validate = await postTelegramValidate({ botToken: token });
      if ("error" in validate) {
        // CONTEXT § 3B "Bad bot token" — inline error + clear + refocus.
        setInlineError(
          "Telegram rejected that token — check you copied the full string from @BotFather.",
        );
        setToken("");
        inputRef.current?.focus();
        return;
      }
      // Token is valid — activate.
      const activate = await postTelegramActivate({
        identityKey,
        botToken: token,
        humanUserId,
      });
      if ("error" in activate) {
        setInlineError(activate.error);
        setToken("");
        inputRef.current?.focus();
        return;
      }
      // Success: transition to pending-start; scrub token from local state.
      const botUsername = activate.botUsername;
      setToken("");
      onStateChange({
        status: "pending-start",
        botUsername,
        botLink: `https://t.me/${botUsername}`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyBotLink(link: string): Promise<void> {
    try {
      // navigator.clipboard is a public URL; the bot link never carries the
      // bot token. Safe to write.
      await navigator.clipboard.writeText(link);
    } catch {
      // Swallow — clipboard failures shouldn't break the flow. The link is
      // still visible on screen for manual copy.
    }
  }

  async function handleCancelPending(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const result = await postTelegramDisconnect({ identityKey });
      if ("error" in result) {
        onStateChange({ status: "restart-failed", error: result.error });
        return;
      }
      onStateChange({ status: "unconfigured" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnectConfirmed(): Promise<void> {
    setConfirmOpen(false);
    if (saving) return;
    setSaving(true);
    try {
      const result = await postTelegramDisconnect({ identityKey });
      if ("error" in result) {
        onStateChange({ status: "restart-failed", error: result.error });
        return;
      }
      onStateChange({ status: "unconfigured" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRetry(): Promise<void> {
    // CONTEXT § 3B: Retry re-attempts disconnect (recovery direction — the
    // safer default). If the bridge is broken enough that disconnect also
    // fails, we stay in restart-failed with the fresh error.
    if (saving) return;
    setSaving(true);
    try {
      const result = await postTelegramDisconnect({ identityKey });
      if ("error" in result) {
        onStateChange({ status: "restart-failed", error: result.error });
        return;
      }
      onStateChange({ status: "unconfigured" });
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-20 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load Telegram: {state.error}
      </div>
    );
  }

  if (state.status === "unconfigured") {
    return (
      <div className="flex flex-col gap-3 max-w-md">
        <div className="text-[15px] font-semibold text-[#f0ebe0]">
          Bridge this identity to Telegram
        </div>
        <div className="text-xs text-[var(--color-pv-fg-muted)]">
          Paste the bot token from @BotFather. The token is sent once and
          stored encrypted — it never leaves this page except to the backend.
        </div>
        <label
          htmlFor="telegram-bot-token"
          className="text-[10px] uppercase tracking-wide text-[var(--color-pv-fg-dim)] font-semibold"
        >
          Bot token
        </label>
        <input
          ref={inputRef}
          id="telegram-bot-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="bg-black/30 text-[#e8e4d8] border border-white/10 focus:outline-none focus:border-white/25 rounded px-2 py-1.5 text-xs font-mono"
        />
        {inlineError && (
          <div
            role="alert"
            className="text-xs text-rose-300 whitespace-pre-wrap"
          >
            {inlineError}
          </div>
        )}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={saving || !token || !humanUserId}
            onClick={() => { void handleSubmitToken(); }}
            className="cursor-pointer"
          >
            {saving ? "Submitting…" : "Submit"}
          </Button>
          {!humanUserId && (
            <span className="ml-2 text-[11px] text-[var(--color-pv-fg-muted)]">
              couldn&apos;t verify session
            </span>
          )}
        </div>
      </div>
    );
  }

  if (state.status === "pending-start") {
    return (
      <div className="flex flex-col gap-3 max-w-md">
        <div className="text-sm text-[#f0ebe0]">
          Waiting for you to send <span className="font-mono">/start</span> to{" "}
          <span className="font-semibold">@{state.botUsername}</span> …
        </div>
        <div className="text-xs text-[var(--color-pv-fg-muted)]">
          Open Telegram, tap the bot link below, then send <code>/start</code>.
          This page will update automatically after the bridge receives it.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => { void handleCopyBotLink(state.botLink); }}
          >
            Copy bot link
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={saving}
            onClick={() => { void handleCancelPending(); }}
          >
            {saving ? "Cancelling…" : "Cancel"}
          </Button>
          <a
            href={state.botLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[var(--color-pv-fg-muted)] underline"
          >
            {state.botLink}
          </a>
        </div>
      </div>
    );
  }

  if (state.status === "connected") {
    return (
      <div className="flex flex-col gap-3 max-w-md">
        <div className="flex items-center gap-2 text-sm text-[#f0ebe0]">
          <span
            aria-label="connected"
            className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
          />
          <span>
            Connected. Bot: @{state.botUsername}. Human: @{state.telegramHandle}.
          </span>
        </div>
        <div>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={saving}
            onClick={() => setConfirmOpen(true)}
          >
            Disconnect
          </Button>
        </div>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Telegram?</AlertDialogTitle>
              {/* CONTEXT § 3D verbatim — do not paraphrase.
                  Full literal: "This will unbridge <identity> from Telegram.
                  The bot stays alive in Telegram (you can reconnect anytime
                  with the same token, or paste a new one). Confirm." */}
              <AlertDialogDescription>
                {`This will unbridge ${identityName} from Telegram. The bot stays alive in Telegram (you can reconnect anytime with the same token, or paste a new one). Confirm.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                data-testid="telegram-disconnect-cancel"
                className="cursor-pointer"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="telegram-disconnect-confirm"
                className="cursor-pointer"
                onClick={() => { void handleDisconnectConfirmed(); }}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // status === "restart-failed"
  return (
    <div className="flex flex-col gap-3 max-w-md">
      <div className="text-sm text-rose-300">
        Bridge didn&apos;t come back up — Telegram is not receiving messages
        right now.
      </div>
      <div className="text-xs text-[var(--color-pv-fg-muted)] font-mono whitespace-pre-wrap">
        {state.error}
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={saving}
          onClick={() => { void handleRetry(); }}
        >
          {saving ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}
