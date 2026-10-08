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
import {
  AdminBadge,
  AdminButton,
  AdminError,
  adminErrorMessage,
  adminInputClass,
  formatAdminDate,
} from "@/features/admin/admin-ui";

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
    if (
      !window.confirm(
        `Remove ${secret.label}? Agents will no longer be able to use it.`,
      )
    )
      return;
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

  return (
    <div
      className="flex flex-col gap-1.5 py-2.5 border-b border-white/[0.06] last:border-b-0"
      data-testid={id}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={`${id}-input`} className="text-[13px] text-[#e8e4d8]">
          {secret.label}
        </label>
        {showManagedBy && (
          <AdminBadge
            tone={secret.managedBy === "admin" ? "accent" : undefined}
          >
            {secret.managedBy === "admin" ? "Admin-managed" : "User can change"}
          </AdminBadge>
        )}
        <span
          className="text-[12px] text-[#a89a80]"
          data-testid={`${id}-status`}
        >
          {status}
        </span>
      </div>
      {secret.description && (
        <span className="text-[12px] leading-[1.4] text-[#a89a80]">
          {secret.description}
        </span>
      )}
      <form
        className="flex gap-2 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          id={`${id}-input`}
          data-testid={`${id}-input`}
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
          className={`${adminInputClass} flex-1 min-w-[200px]`}
        />
        <AdminButton
          type="submit"
          data-testid={`${id}-save`}
          disabled={busy !== null || !draft.trim()}
        >
          {busy === "saving" ? "Saving…" : secret.isSet ? "Replace" : "Save"}
        </AdminButton>
        {secret.isSet && (
          <AdminButton
            tone="danger"
            data-testid={`${id}-remove`}
            disabled={busy !== null}
            onClick={() => void clear()}
          >
            {busy === "removing" ? "Removing…" : "Remove"}
          </AdminButton>
        )}
      </form>
      {error && <AdminError testId={`${id}-error`}>{error}</AdminError>}
      {saved && !error && (
        <span className="text-[12px] text-[#8fd39e]">✓ Saved</span>
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
