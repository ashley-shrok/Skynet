/**
 * PreferencesPhonePane — change or remove the number agents call (agent-phone).
 *
 * Only mounted when the user already has a number on file — PreferencesModal
 * hides the nav entry otherwise, and the backend refuses PUT/DELETE for users
 * without one. An admin grants the feature by setting the first number.
 *
 * Removing is allowed but one-way: a kit confirm warns that an admin has
 * to re-enable the feature before the user can set a number again.
 */

import { useState } from "react";
import {
  PHONE_E164_RE,
  clearMyPhone,
  normalizePhoneInput,
  updateMyPhone,
} from "@/api/user-phone-api";
import {
  KitButton,
  KitInput,
  KitSettingsGroup,
  KitSettingsRow,
  kitConfirm,
} from "@/components/kit";

export interface PreferencesPhonePaneProps {
  phoneE164: string;
  /** Called with the saved number, or null after the number is removed. */
  onPhoneChanged: (phoneE164: string | null) => void;
}

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
    const confirmed = await kitConfirm({
      title: "Remove your phone number?",
      body: "Agents will no longer be able to call you, and an admin will need to re-enable this feature before you can add a number again.",
      confirmLabel: "Remove",
      destructive: true,
    });
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
    <div data-testid="preferences-phone-pane">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <KitSettingsGroup
          footer={
            error ? (
              <span className="k-err" role="alert" data-testid="preferences-phone-error">
                {error}
              </span>
            ) : saved ? (
              <span data-testid="preferences-phone-saved" className="text-[var(--k-ok)]">
                ✓ Number saved
              </span>
            ) : (
              "Include the country code (+1 for the US and Canada)."
            )
          }
        >
          <KitSettingsRow
            label={<label htmlFor="preferences-phone-input">Number</label>}
            control={
              <span className="flex items-center gap-2">
                <KitInput
                  id="preferences-phone-input"
                  data-testid="preferences-phone-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  mono
                  value={draft}
                  disabled={busy}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                    setSaved(false);
                  }}
                  placeholder="+17165550100"
                  className="w-[190px] max-sm:w-[150px] text-right"
                />
                {(isDirty || status === "saving") && (
                  <KitButton
                    type="submit"
                    variant="primary"
                    size="sm"
                    data-testid="preferences-phone-save"
                    disabled={busy}
                    busy={status === "saving"}
                  >
                    {status === "saving" ? "Saving…" : "Save"}
                  </KitButton>
                )}
              </span>
            }
          />
        </KitSettingsGroup>
      </form>

      <KitSettingsGroup
        className="mt-[22px]"
        footer="Agents won't be able to call you. Adding a number again needs an admin."
      >
        <KitSettingsRow
          tone="danger"
          label={status === "removing" ? "Removing…" : "Remove phone number"}
          onClick={() => void handleRemove()}
          disabled={busy}
          chevron={false}
          data-testid="preferences-phone-remove"
        />
      </KitSettingsGroup>
    </div>
  );
}
