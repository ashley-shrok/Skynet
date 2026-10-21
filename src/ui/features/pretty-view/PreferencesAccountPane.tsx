/**
 * Preferences → the account: the user's picture, name and Log out, plus the
 * account card that leads the side list.
 *
 * Load-bearing invariants (picture):
 *   - Local preview via URL.createObjectURL + revokeObjectURL cleanup (no leaks)
 *   - Upload/remove failure reverts preview and shows an inline error
 *   - Cache-bust on the persisted picture src: ?f={avatarPath} so the sidebar
 *     and this section stay in sync; changes reach the sidebar footer through
 *     onAvatarChanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { uploadUserAvatar, removeUserAvatar } from "@/api/user-preferences-api";
import { logoutUser } from "@/main-axios";
import {
  KitAvatar,
  KitBanner,
  KitButton,
  KitSettingsGroup,
  KitSettingsRow,
  kitConfirm,
} from "@/components/kit";

/** The persisted picture's URL, or null when there is none. */
function avatarSrc(userId: string, avatarPath: string | null): string | null {
  return avatarPath
    ? `/users/${encodeURIComponent(userId)}/avatar?f=${encodeURIComponent(avatarPath)}`
    : null;
}

/** First letter of the trimmed username (a whole code point, so an emoji-first
 *  name isn't cut in half) — the same letter as the sidebar footer's circle. */
function initialOf(username: string | null): string {
  const trimmed = (username ?? "").trim();
  return trimmed ? ([...trimmed][0]?.toUpperCase() ?? "?") : "?";
}

async function confirmLogout(): Promise<void> {
  const ok = await kitConfirm({
    title: "Log out?",
    body: "You'll need to sign in again to get back to your agents.",
    confirmLabel: "Log out",
  });
  if (!ok) return;
  void logoutUser()
    .catch(() => {})
    .finally(() => {
      window.dispatchEvent(new Event("skynet:logout"));
    });
}

// ─── Account card (top of the side list) ─────────────────────────────────────

export function PreferencesAccountCard({
  userId,
  username,
  avatarPath,
  selected,
  drill,
  onSelect,
}: {
  userId: string;
  username: string | null;
  avatarPath: string | null;
  selected: boolean;
  /** Phone list: a card in its own group with an arrow. */
  drill: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected && !drill ? "true" : undefined}
      data-drill={drill ? "true" : undefined}
      data-testid="preferences-nav-account"
      className="k-side-item k-account-card"
    >
      <KitAvatar
        src={avatarSrc(userId, avatarPath)}
        fallback={initialOf(username)}
        size={drill ? 52 : 38}
      />
      <span className="flex flex-col min-w-0 text-left">
        <span className="k-account-name truncate">{username?.trim() || "Your account"}</span>
        <span className="k-account-sub truncate">Picture, log out</span>
      </span>
      {drill ? (
        <ChevronRight size={16} aria-hidden="true" className="ml-auto shrink-0 opacity-45" />
      ) : null}
    </button>
  );
}

// ─── Account section ─────────────────────────────────────────────────────────

export interface PreferencesAccountPaneProps {
  userId: string;
  username: string | null;
  isAdmin: boolean;
  avatarPath: string | null;
  onAvatarChanged: (path: string | null) => void;
}

export function PreferencesAccountPane({
  userId,
  username,
  isAdmin,
  avatarPath,
  onAvatarChanged,
}: PreferencesAccountPaneProps): JSX.Element {
  // Local blob URL for the picture before the upload completes
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the blob URL whenever previewUrl changes or the section unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onFileChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const newPreviewUrl = URL.createObjectURL(file);
      setPreviewUrl(newPreviewUrl);
      setStatus("uploading");
      setError(null);

      try {
        const result = await uploadUserAvatar(userId, file);
        URL.revokeObjectURL(newPreviewUrl);
        setPreviewUrl(null);
        onAvatarChanged(result.avatarPath);
        setStatus("idle");
      } catch {
        URL.revokeObjectURL(newPreviewUrl);
        setPreviewUrl(null);
        setError("Upload failed — please try again.");
        setStatus("idle");
      }

      // Reset the file input so the same file can be re-selected
      e.target.value = "";
    },
    [userId, previewUrl, onAvatarChanged],
  );

  const onRemove = useCallback(async () => {
    setStatus("removing");
    setError(null);
    try {
      await removeUserAvatar(userId);
      onAvatarChanged(null);
      setStatus("idle");
    } catch {
      setError("Couldn't remove your picture — please try again.");
      setStatus("idle");
    }
  }, [userId, onAvatarChanged]);

  const pictureSrc = previewUrl ?? avatarSrc(userId, avatarPath);
  const hasPicture = !!(avatarPath || previewUrl);
  const choose = () => {
    if (status === "idle") fileInputRef.current?.click();
  };

  return (
    <div data-testid="preferences-account-pane">
      <div className="flex flex-col items-center text-center gap-1.5 pt-2 pb-6">
        <button
          type="button"
          onClick={choose}
          disabled={status !== "idle"}
          aria-label="Choose a new picture"
          title="Choose a new picture"
          className="relative rounded-full cursor-pointer disabled:cursor-default"
          data-testid="preferences-account-avatar"
        >
          <KitAvatar src={pictureSrc} fallback={initialOf(username)} size={96} />
          <span className="absolute right-0 bottom-0 size-7 rounded-full bg-[var(--k-s3)] border-2 border-[var(--k-bg)] grid place-items-center text-[var(--k-t1)]">
            <Pencil size={13} aria-hidden="true" />
          </span>
        </button>
        <h2 className="m-0 mt-2 text-[24px] font-bold tracking-[-0.025em] text-[var(--k-t1)]">
          {username?.trim() || "Your account"}
        </h2>
        <p className="m-0 text-[13.5px] text-[var(--k-t2)]" data-testid="preferences-account-meta">
          {isAdmin ? "Administrator" : "Member"} · {window.location.host}
        </p>
      </div>

      <KitSettingsGroup title="Picture">
        <KitSettingsRow
          label="Your picture"
          description="Shows beside your messages and at the bottom of the conversation list."
          control={
            <span className="flex flex-wrap justify-end items-center gap-2">
              <KitButton
                size="sm"
                data-testid="preferences-account-choose-btn"
                disabled={status !== "idle"}
                busy={status === "uploading"}
                onClick={choose}
              >
                Choose…
              </KitButton>
              {hasPicture && (
                <KitButton
                  size="sm"
                  variant="plain"
                  data-testid="preferences-account-remove-btn"
                  disabled={status !== "idle"}
                  onClick={() => void onRemove()}
                >
                  {status === "removing" ? "Removing…" : "Remove"}
                </KitButton>
              )}
            </span>
          }
        />
      </KitSettingsGroup>

      {error !== null && (
        <KitBanner tone="danger" className="-mt-2 mb-5" data-testid="preferences-account-error">
          {error}
        </KitBanner>
      )}

      <KitSettingsGroup footer="You'll need to sign in again to get back to your agents.">
        <KitSettingsRow
          tone="danger"
          label="Log out"
          chevron={false}
          onClick={() => void confirmLogout()}
          data-testid="preferences-account-logout"
        />
      </KitSettingsGroup>

      {/* Images only; no client-side size check */}
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={(e) => void onFileChosen(e)}
        className="hidden"
        data-testid="preferences-account-file-input"
      />
    </div>
  );
}
