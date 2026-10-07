/**
 * Admin → Sign-in: instance-wide login policy.
 *
 *   - Allow registration (new accounts from the login page)
 *   - Allow password reset
 *   - Session timeout (hours a login stays valid)
 *
 * OIDC-only controls — "allow password login" and "auto-provision OIDC
 * users" — render only when the instance actually uses OIDC. Turning off
 * password login without OIDC would lock everyone out, so it's hidden
 * rather than offered.
 */

import { useEffect, useState } from "react";
import { Switch } from "@/components/switch";
import {
  getOidcAutoProvision,
  getPasswordResetAllowed,
  updateOidcAutoProvision,
  updatePasswordLoginAllowed,
  updatePasswordResetAllowed,
  updateRegistrationAllowed,
} from "@/api/user-management-api";
import { getSessionTimeout, updateSessionTimeout } from "@/api/settings-api";
import { getPasswordLoginAllowed, getRegistrationAllowed } from "@/main-axios";
import {
  AdminButton,
  AdminError,
  AdminMuted,
  AdminRow,
  AdminSection,
  adminErrorMessage,
  adminInputClass,
} from "./admin-ui";

type ToggleKey =
  | "registration"
  | "passwordReset"
  | "passwordLogin"
  | "oidcAutoProvision";

function updaterFor(key: ToggleKey): (v: boolean) => Promise<unknown> {
  switch (key) {
    case "registration":
      return updateRegistrationAllowed;
    case "passwordReset":
      return updatePasswordResetAllowed;
    case "passwordLogin":
      return updatePasswordLoginAllowed;
    case "oidcAutoProvision":
      return updateOidcAutoProvision;
  }
}

const MIN_TIMEOUT_HOURS = 1;
const MAX_TIMEOUT_HOURS = 720;

export function AdminSignInPane({ oidcInUse }: { oidcInUse: boolean }) {
  const [toggles, setToggles] = useState<Partial<Record<ToggleKey, boolean>>>(
    {},
  );
  const [busyKey, setBusyKey] = useState<ToggleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [timeout, setTimeoutHours] = useState<number | null>(null);
  const [timeoutDraft, setTimeoutDraft] = useState("");
  const [timeoutBusy, setTimeoutBusy] = useState(false);
  const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const [timeoutSaved, setTimeoutSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const set = (key: ToggleKey) => (v: boolean) => {
      if (!cancelled) setToggles((t) => ({ ...t, [key]: v }));
    };
    const fail = (err: unknown) => {
      if (!cancelled)
        setError(adminErrorMessage(err, "Failed to load sign-in settings."));
    };
    getRegistrationAllowed()
      .then((r) => set("registration")(r.allowed))
      .catch(fail);
    getPasswordResetAllowed().then(set("passwordReset")).catch(fail);
    if (oidcInUse) {
      getPasswordLoginAllowed()
        .then((r) => set("passwordLogin")(r.allowed))
        .catch(fail);
      getOidcAutoProvision()
        .then((r) => set("oidcAutoProvision")(r.enabled))
        .catch(fail);
    }
    getSessionTimeout()
      .then((r) => {
        if (cancelled) return;
        setTimeoutHours(r.timeoutHours);
        setTimeoutDraft(String(r.timeoutHours));
      })
      .catch((err) => {
        if (!cancelled)
          setTimeoutError(
            adminErrorMessage(err, "Failed to load session timeout."),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [oidcInUse]);

  const flip = async (key: ToggleKey, next: boolean) => {
    if (
      key === "passwordLogin" &&
      !next &&
      !window.confirm(
        "Turn off password login? Everyone, including admins, will have to sign in through OIDC.",
      )
    ) {
      return;
    }
    setBusyKey(key);
    setError(null);
    try {
      await updaterFor(key)(next);
      setToggles((t) => ({ ...t, [key]: next }));
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to save setting."));
    } finally {
      setBusyKey(null);
    }
  };

  const toggle = (key: ToggleKey, label: string) => (
    <Switch
      data-testid={`admin-signin-${key}`}
      aria-label={label}
      checked={toggles[key] ?? false}
      disabled={toggles[key] === undefined || busyKey !== null}
      onCheckedChange={(v) => void flip(key, v)}
    />
  );

  const parsedTimeout = Number(timeoutDraft);
  const timeoutValid =
    Number.isInteger(parsedTimeout) &&
    parsedTimeout >= MIN_TIMEOUT_HOURS &&
    parsedTimeout <= MAX_TIMEOUT_HOURS;
  const timeoutDirty = timeout !== null && parsedTimeout !== timeout;

  const saveTimeout = async () => {
    setTimeoutBusy(true);
    setTimeoutError(null);
    setTimeoutSaved(false);
    try {
      await updateSessionTimeout(parsedTimeout);
      setTimeoutHours(parsedTimeout);
      setTimeoutSaved(true);
    } catch (err) {
      setTimeoutError(
        adminErrorMessage(err, "Failed to save session timeout."),
      );
    } finally {
      setTimeoutBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-6 px-6 py-5"
      data-testid="admin-signin-pane"
    >
      <AdminSection title="Accounts">
        <div className="flex flex-col">
          <AdminRow
            label="Allow registration"
            description="Anyone who can reach the login page can create an account."
            control={toggle("registration", "Allow registration")}
          />
          <AdminRow
            label="Allow password reset"
            description="Users can reset a forgotten password from the login page."
            control={toggle("passwordReset", "Allow password reset")}
          />
          {oidcInUse && (
            <>
              <AdminRow
                label="Allow password login"
                description="When off, users can only sign in through OIDC."
                control={toggle("passwordLogin", "Allow password login")}
              />
              <AdminRow
                label="Auto-create OIDC users"
                description="Create an account the first time someone signs in through OIDC."
                control={toggle("oidcAutoProvision", "Auto-create OIDC users")}
              />
            </>
          )}
        </div>
        {error && <AdminError testId="admin-signin-error">{error}</AdminError>}
      </AdminSection>

      <AdminSection
        title="Session timeout"
        description="How long a login stays valid before the user has to sign in again. Applies to new logins."
      >
        {timeout === null && !timeoutError ? (
          <AdminMuted>Loading…</AdminMuted>
        ) : (
          <form
            className="flex items-center gap-2 flex-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (timeoutValid && timeoutDirty) void saveTimeout();
            }}
          >
            <input
              type="number"
              min={MIN_TIMEOUT_HOURS}
              max={MAX_TIMEOUT_HOURS}
              step={1}
              data-testid="admin-signin-timeout-input"
              aria-label="Session timeout in hours"
              value={timeoutDraft}
              disabled={timeoutBusy || timeout === null}
              onChange={(e) => {
                setTimeoutDraft(e.target.value);
                setTimeoutSaved(false);
                setTimeoutError(null);
              }}
              className={`${adminInputClass} w-24`}
            />
            <span className="text-[12.5px] text-[#a89a80]">hours</span>
            <AdminButton
              type="submit"
              data-testid="admin-signin-timeout-save"
              disabled={timeoutBusy || !timeoutValid || !timeoutDirty}
            >
              {timeoutBusy ? "Saving…" : "Save"}
            </AdminButton>
          </form>
        )}
        {!timeoutValid && timeoutDraft !== "" && (
          <AdminError>
            Enter a whole number of hours between {MIN_TIMEOUT_HOURS} and{" "}
            {MAX_TIMEOUT_HOURS}.
          </AdminError>
        )}
        {timeoutError && (
          <AdminError testId="admin-signin-timeout-error">
            {timeoutError}
          </AdminError>
        )}
        {timeoutSaved && !timeoutError && (
          <span className="text-[12px] text-[#8fd39e]">✓ Saved</span>
        )}
      </AdminSection>
    </div>
  );
}
