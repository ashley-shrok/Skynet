/**
 * PreferencesPhonePane — change or remove the number agents call (agent-phone).
 *
 * Only mounted when the user already has a number on file — PreferencesModal
 * hides the nav entry otherwise, and the backend refuses PUT/DELETE for users
 * without one. An admin grants the feature by setting the first number.
 *
 * Removing is allowed but one-way: a window.confirm warns that an admin has
 * to re-enable the feature before the user can set a number again.
 */

import { useState } from "react";
import {
  PHONE_E164_RE,
  clearMyPhone,
  normalizePhoneInput,
  updateMyPhone,
} from "@/api/user-phone-api";

export interface PreferencesPhonePaneProps {
  phoneE164: string;
  /** Called with the saved number, or null after the number is removed. */
  onPhoneChanged: (phoneE164: string | null) => void;
}

const buttonStyle = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid rgba(255,240,215,0.18)",
  background: "rgba(20,21,32,0.6)",
  color: "#e8e4d8",
  fontSize: 13,
} as const;

export function PreferencesPhonePane({
  phoneE164,
  onPhoneChanged,
}: PreferencesPhonePaneProps): JSX.Element {
  const [draft, setDraft] = useState(phoneE164);
  const [status, setStatus] = useState<"idle" | "saving" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const normalized = normalizePhoneInput(draft);
  const isDirty = normalized !== phoneE164;
  const busy = status !== "idle";

  const handleSave = async () => {
    setSaved(false);
    if (!PHONE_E164_RE.test(normalized)) {
      setError(
        "Enter a full number including the country code, e.g. +1 716 555 0100.",
      );
      return;
    }
    setError(null);
    setStatus("saving");
    try {
      const savedNumber = await updateMyPhone(normalized);
      setDraft(savedNumber);
      setSaved(true);
      onPhoneChanged(savedNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save number.");
    } finally {
      setStatus("idle");
    }
  };

  const handleRemove = async () => {
    const confirmed = window.confirm(
      "Remove your phone number? Agents will no longer be able to call you, and an admin will need to re-enable this feature before you can add a number again.",
    );
    if (!confirmed) return;
    setError(null);
    setSaved(false);
    setStatus("removing");
    try {
      await clearMyPhone();
      onPhoneChanged(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove number.");
      setStatus("idle");
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col gap-4" data-testid="preferences-phone-pane">
      <p className="text-[13px] leading-[18px]" style={{ color: "#c8c4b8" }}>
        Agents can phone you at this number when they need you.
      </p>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <label
          htmlFor="preferences-phone-input"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "rgba(200,196,184,0.6)",
            fontWeight: 600,
          }}
        >
          Phone number
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id="preferences-phone-input"
            data-testid="preferences-phone-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft}
            disabled={busy}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
              setSaved(false);
            }}
            placeholder="+17165550100"
            style={{
              flex: "1 1 180px",
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${error ? "rgba(211,143,143,0.6)" : "rgba(255,240,215,0.18)"}`,
              background: "rgba(0,0,0,0.25)",
              color: "#e8e4d8",
              fontFamily: "monospace",
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            data-testid="preferences-phone-save"
            disabled={busy || !isDirty}
            style={{
              ...buttonStyle,
              cursor: busy || !isDirty ? "not-allowed" : "pointer",
              opacity: busy || !isDirty ? 0.6 : 1,
            }}
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
        <span style={{ fontSize: 12, color: "rgba(200,196,184,0.6)" }}>
          Include the country code (+1 for US/Canada).
        </span>
        {error && (
          <span
            data-testid="preferences-phone-error"
            role="alert"
            style={{ fontSize: 12, color: "#d38f8f" }}
          >
            {error}
          </span>
        )}
        {saved && !error && (
          <span
            data-testid="preferences-phone-saved"
            style={{ fontSize: 12, color: "#8fd39e" }}
          >
            ✓ Number saved
          </span>
        )}
      </form>

      <div
        style={{
          marginTop: 8,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,240,215,0.08)",
        }}
      >
        <button
          type="button"
          data-testid="preferences-phone-remove"
          onClick={() => void handleRemove()}
          disabled={busy}
          style={{
            ...buttonStyle,
            border: "1px solid rgba(211,143,143,0.35)",
            background: "transparent",
            color: "#d38f8f",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {status === "removing" ? "Removing…" : "Remove phone number"}
        </button>
      </div>
    </div>
  );
}
