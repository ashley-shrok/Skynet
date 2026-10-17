/**
 * ServiceSecretRow — one agent-service secret: status, a write-only input,
 * Save, and Remove. Shared by Preferences → Services (the user's own
 * user-managed secrets) and the admin user modal (every secret).
 *
 * The value is never shown: the API never returns it, and the input always
 * starts empty. Saving replaces whatever is stored.
 */

import { useState } from "react";
import type { ServiceSecret } from "@/api/service-secrets-api";
import { adminErrorMessage, formatAdminDate } from "@/features/admin/admin-ui";
import {
  KitBanner,
  KitButton,
  KitChip,
  KitInput,
  kitConfirm,
} from "@/components/kit";

export interface ServiceSecretRowProps {
  secret: ServiceSecret;
  onSave: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
  /** Admin view: show who manages it. */
  showManagedBy?: boolean;
}

export function ServiceSecretRow({
  secret,
  onSave,
  onClear,
  showManagedBy = false,
}: ServiceSecretRowProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"saving" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = `service-secret-${secret.service}-${secret.name}`;

  const status = secret.isSet
    ? `Set${secret.updatedAt ? ` · updated ${formatAdminDate(secret.updatedAt)}` : ""}`
    : secret.hasFallback
      ? "Not set · the instance default is used"
      : "Not set";

  const save = async () => {
    const value = draft.trim();
    if (!value) return;
    setBusy("saving");
    setError(null);
    setSaved(false);
    try {
      await onSave(value);
      setDraft("");
      setSaved(true);
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to save."));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    const ok = await kitConfirm({
      title: `Remove ${secret.label}?`,
      body: "Agents will no longer be able to use it.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy("removing");
    setError(null);
    setSaved(false);
    try {
      await onClear();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to remove."));
    } finally {
      setBusy(null);
    }
  };

  // A block that sits inside a kit settings group (Preferences → Services,
  // Admin → user → Service secrets); hairline between consecutive rows.
  return (
    <div
      className="flex flex-col gap-1.5 py-2.5 border-b border-[var(--k-hair)] last:border-b-0"
      data-testid={id}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={`${id}-input`} className="text-[14px] text-[var(--k-t1)]">
          {secret.label}
        </label>
        {showManagedBy && (
          <KitChip tone={secret.managedBy === "admin" ? "accent" : "neutral"}>
            {secret.managedBy === "admin" ? "Admin-managed" : "User can change"}
          </KitChip>
        )}
        <span
          className="text-[12.5px] text-[var(--k-t3)]"
          data-testid={`${id}-status`}
        >
          {status}
        </span>
      </div>
      {secret.description && (
        <span className="text-[12.5px] leading-[1.4] text-[var(--k-t3)]">
          {secret.description}
        </span>
      )}
      <form
        className="flex gap-2 flex-wrap items-center"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <KitInput
          id={`${id}-input`}
          data-testid={`${id}-input`}
          size="sm"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={busy !== null}
          placeholder={
            secret.isSet ? "Enter a new value to replace it" : "Paste the value"
          }
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSaved(false);
          }}
          className="flex-1 min-w-[200px] w-auto"
        />
        <KitButton
          type="submit"
          size="sm"
          variant="primary"
          data-testid={`${id}-save`}
          disabled={!draft.trim() || busy === "removing"}
          busy={busy === "saving"}
        >
          {busy === "saving" ? "Saving…" : secret.isSet ? "Replace" : "Save"}
        </KitButton>
        {secret.isSet && (
          <KitButton
            size="sm"
            variant="danger-quiet"
            data-testid={`${id}-remove`}
            disabled={busy === "saving"}
            busy={busy === "removing"}
            onClick={() => void clear()}
          >
            {busy === "removing" ? "Removing…" : "Remove"}
          </KitButton>
        )}
      </form>
      {error && (
        <KitBanner tone="danger" data-testid={`${id}-error`}>
          {error}
        </KitBanner>
      )}
      {saved && !error && (
        <span className="text-[12.5px] text-[var(--k-ok)]" role="status">
          ✓ Saved
        </span>
      )}
    </div>
  );
}

/** Group secrets by service, keeping declaration order. */
export function groupByService(secrets: ServiceSecret[]): Array<{
  service: string;
  description: string;
  secrets: ServiceSecret[];
}> {
  const groups = new Map<
    string,
    { service: string; description: string; secrets: ServiceSecret[] }
  >();
  for (const s of secrets) {
    const g = groups.get(s.service) ?? {
      service: s.service,
      description: s.serviceDescription,
      secrets: [],
    };
    g.secrets.push(s);
    groups.set(s.service, g);
  }
  return [...groups.values()];
}
