/**
 * PreferencesGeneralPane — avatar upload/remove UI for the Preferences modal.
 *
 * Fully implemented in Plan 137-02 Task 2. The General tab of the
 * Preferences modal — lets the user upload a profile avatar, preview it
 * locally before upload, and remove it. Changes propagate to the sidebar
 * footer's initials-circle via the onAvatarChanged callback (D-12, D-30).
 *
 * Load-bearing invariants:
 *   - Local preview via URL.createObjectURL + revokeObjectURL cleanup (no leaks)
 *   - Upload/remove failure reverts preview and shows inline error; inline-only (D-13)
 *   - Cache-bust on persisted avatar src: ?f={avatarPath} so sidebar and pane stay in sync
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadUserAvatar, removeUserAvatar } from "@/api/user-preferences-api";

export interface PreferencesGeneralPaneProps {
  userId: string;
  /**
   * M6 fix: username used to derive the initial-letter fallback. Without
   * this, the pane fell back to `userId[0]` (a nanoid character), which
   * showed a different letter than the sidebar-footer initials-circle
   * (which uses the trimmed username's first code point).
   */
  username?: string | null;
  avatarPath: string | null;
  onAvatarChanged: (path: string | null) => void;
}

export function PreferencesGeneralPane({
  userId,
  username,
  avatarPath,
  onAvatarChanged,
}: PreferencesGeneralPaneProps): JSX.Element {
  // Local blob URL for the preview circle before upload completes
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the blob URL whenever previewUrl changes or component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onFileChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Revoke old preview and set new one immediately
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const newPreviewUrl = URL.createObjectURL(file);
      setPreviewUrl(newPreviewUrl);
      setStatus("uploading");
      setError(null);

      try {
        const result = await uploadUserAvatar(userId, file);
        // Revoke the temp blob URL now that we have the server path
        URL.revokeObjectURL(newPreviewUrl);
        setPreviewUrl(null);
        onAvatarChanged(result.avatarPath);
        setStatus("idle");
      } catch {
        // Revert preview on failure
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
      setError("Couldn't remove your avatar — please try again.");
      setStatus("idle");
    }
  }, [userId, onAvatarChanged]);

  // Determine what to show in the preview circle:
  // 1. previewUrl (local blob, before upload completes)
  // 2. persisted avatar from backend
  // 3. null (no avatar — caller renders initials fallback)
  const circleSrc: string | null = previewUrl
    ? previewUrl
    : avatarPath
      ? `/users/${encodeURIComponent(userId)}/avatar?f=${encodeURIComponent(avatarPath)}`
      : null;

  // M6: derive from trimmed username first code point (matches the
  // sidebar-footer initials-circle). Spread-index the first character so
  // astral/emoji-first usernames get a full code point, not a UTF-16
  // surrogate half. Falls back to "?" when username is empty/absent.
  const trimmedName = (username ?? "").trim();
  const initial = trimmedName ? [...trimmedName][0]?.toUpperCase() ?? "?" : "?";

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="preferences-general-pane">
      <div className="flex items-start gap-5">
        {/* Avatar preview circle */}
        <div
          className="shrink-0 size-[72px] rounded-full overflow-hidden flex items-center justify-center text-[28px] font-semibold select-none"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(220,225,245,0.15)",
            color: "#e8e4d8",
          }}
          data-testid="preferences-general-avatar-circle"
        >
          {circleSrc ? (
            <img
              src={circleSrc}
              alt="Your avatar"
              className="size-full object-cover"
              data-testid="preferences-general-avatar-img"
            />
          ) : (
            <span aria-hidden="true" data-testid="preferences-general-initials">
              {initial}
            </span>
          )}
        </div>

        {/* Buttons column */}
        <div className="flex flex-col gap-2 mt-1">
          <button
            type="button"
            data-testid="preferences-general-choose-btn"
            disabled={status !== "idle"}
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-md text-sm cursor-pointer text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(220,225,245,0.15)",
            }}
          >
            Choose image…
          </button>
          <button
            type="button"
            data-testid="preferences-general-remove-btn"
            disabled={(!avatarPath && !previewUrl) || status !== "idle"}
            onClick={() => void onRemove()}
            className="px-4 py-2 rounded-md text-sm cursor-pointer text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(220,225,245,0.10)",
            }}
          >
            {status === "removing" ? "Removing…" : "Remove"}
          </button>

          {/* Hidden file input — D-13: accept image/* only; no client-side size check */}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={(e) => void onFileChosen(e)}
            className="hidden"
            data-testid="preferences-general-file-input"
          />
        </div>
      </div>

      {/* Inline error only — D-13 */}
      {error !== null && (
        <div className="text-sm text-red-400" data-testid="preferences-general-error">
          {error}
        </div>
      )}
    </div>
  );
}
