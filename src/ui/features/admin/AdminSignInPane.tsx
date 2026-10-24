/**
 * Admin → Sign-in: instance-wide login policy.
 *
 *   - Allow registration (new accounts from the login page)
 *   - Allow password reset
 *   - Sign-ins last (hours a login stays valid) — saves when the box is
 *     left or Enter is pressed, like every other setting here
 *
 * OIDC-only controls — "allow password login" and "auto-provision OIDC
 * users" — render only when the instance actually uses OIDC. Turning off
 * password login without OIDC would lock everyone out, so it's hidden
 * rather than offered.
 */

import { useEffect, useRef, useState } from "react";
import {
  KitBanner,
  KitInput,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  kitConfirm,
} from "@/components/kit";
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
import { adminErrorMessage } from "./admin-ui";

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
    return () => {
      cancelled = true;
    };
  }, [oidcInUse]);

  // Read once — "OIDC in use" settling later must not overwrite a length
  // the admin has started typing.
  useEffect(() => {
    let cancelled = false;
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
  }, []);

  const flip = async (key: ToggleKey, next: boolean) => {
    if (
      key === "passwordLogin" &&
      !next &&
      !(await kitConfirm({
        title: "Turn off password login?",
        body: "Everyone, including admins, will have to sign in through OIDC.",
        confirmLabel: "Turn off",
        destructive: true,
      }))
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
    <KitSwitch
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

  // Leaving the section (or closing the window) with a valid change still
  // saves it — focus can go away without the box ever losing it. Not after a
  // save that failed (the error was shown; a silent retry would surprise).
  // Esc in the box puts the saved value back instead.
  const pending = useRef<number | null>(null);
  pending.current = timeoutValid && timeoutDirty && !timeoutBusy && !timeoutError ? parsedTimeout : null;
  useEffect(
    () => () => {
      if (pending.current !== null) {
        const hours = pending.current;
        void updateSessionTimeout(hours).catch(() => {});
        console.info({ operation: "session_timeout_saved_on_leave", hours });
      }
    },
    [],
  );

  const saveTimeout = async () => {
    if (!timeoutValid || !timeoutDirty || timeoutBusy) return;
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
      className="flex flex-col gap-5"
      data-testid="admin-signin-pane"
    >
      <div className="flex flex-col gap-2">
        <KitSettingsGroup title="Accounts">
          <KitSettingsRow
            label="Allow registration"
            description="Anyone who can reach the login page can create an account."
            control={toggle("registration", "Allow registration")}
          />
          <KitSettingsRow
            label="Allow password reset"
            description="Users can reset a forgotten password from the login page."
            control={toggle("passwordReset", "Allow password reset")}
          />
          {oidcInUse && (
            <>
              <KitSettingsRow
                label="Allow password login"
                description="When off, users can only sign in through OIDC."
                control={toggle("passwordLogin", "Allow password login")}
              />
              <KitSettingsRow
                label="Auto-create OIDC users"
                description="Create an account the first time someone signs in through OIDC."
                control={toggle("oidcAutoProvision", "Auto-create OIDC users")}
              />
            </>
          )}
        </KitSettingsGroup>
        {error && (
          <KitBanner tone="danger" data-testid="admin-signin-error">
            {error}
          </KitBanner>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <KitSettingsGroup
          title="Staying signed in"
          footer={
            timeoutSaved && !timeoutDirty
              ? "Saved. New sign-ins last this long; ones already made keep their old length."
              : "How long a sign-in lasts before the user has to sign in again — 1 to 720 hours. Applies to new sign-ins."
          }
        >
          <KitSettingsRow
            label="Sign-ins last"
            control={
              timeout === null && !timeoutError ? (
                <span className="k-row-value">Loading…</span>
              ) : (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTimeout();
                  }}
                >
                  <KitInput
                    type="number"
                    size="sm"
                    min={MIN_TIMEOUT_HOURS}
                    max={MAX_TIMEOUT_HOURS}
                    step={1}
                    data-testid="admin-signin-timeout-input"
                    aria-label="Sign-ins last, in hours"
                    value={timeoutDraft}
                    // Read-only (not disabled) while saving, so focus stays put.
                    readOnly={timeoutBusy}
                    disabled={timeout === null}
                    invalid={!timeoutValid && timeoutDraft !== ""}
                    onChange={(e) => {
                      setTimeoutDraft(e.target.value);
                      setTimeoutSaved(false);
                      setTimeoutError(null);
                    }}
                    onBlur={() => void saveTimeout()}
                    {...(timeoutDirty ? { "data-modal-esc-local": "" } : {})}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && timeoutDirty && timeout !== null) {
                        e.preventDefault();
                        setTimeoutDraft(String(timeout));
                        setTimeoutError(null);
                      }
                    }}
                    className="w-20 text-right"
                  />
                  <span className="text-[14px] text-[var(--k-t2)]">{timeoutBusy ? "saving…" : "hours"}</span>
                </form>
              )
            }
          />
        </KitSettingsGroup>
        {!timeoutValid && timeoutDraft !== "" && (
          <KitBanner tone="danger">
            Enter a whole number of hours between {MIN_TIMEOUT_HOURS} and{" "}
            {MAX_TIMEOUT_HOURS}.
          </KitBanner>
        )}
        {timeoutError && (
          <KitBanner tone="danger" data-testid="admin-signin-timeout-error">
            {timeoutError}
          </KitBanner>
        )}
      </div>
    </div>
  );
}
