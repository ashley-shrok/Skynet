/**
 * AdminUserView — one user, one level deeper in the Admin window
 * (apple-ux shape-admin-modals). "‹ Users" (or Esc) goes back.
 *
 * One page, top to bottom: the user's picture, name and standing; Access
 * (admin, push notifications, two-factor); Phone; agent service keys; where
 * they're signed in (log out one, or everywhere); the hosts they own;
 * details (Matrix ID, user ID); Delete user.
 *
 * The Matrix ID is shown read-only on purpose: re-pointing a user's mxid
 * from here would not reconcile their relay rooms, so it stays a
 * backend-only operation for now.
 *
 * Backend guards are authoritative (can't demote yourself, can't delete
 * yourself, can't delete the last admin); the UI mirrors them so the
 * controls are disabled rather than failing on click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  KitAvatar,
  KitBanner,
  KitButton,
  KitInput,
  KitLoading,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  kitConfirm,
  kitPrompt,
} from "@/components/kit";
import {
  deleteUser,
  getSessions,
  makeUserAdmin,
  removeAdminStatus,
  revokeAllUserSessions,
  revokeSession,
  setUserNotificationsEnabled,
  setUserPhone,
  type AdminUser,
} from "@/api/user-management-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHostWithStatus } from "@/main-axios";
import { AdminServiceSecrets } from "./AdminServiceSecrets";
import type { AdminLeaveGuard } from "./AdminModal";
import {
  AdminBack,
  adminErrorMessage,
  formatAdminDate,
  relativeAdminTime,
  useEscBack,
  userAvatarUrl,
  userInitial,
} from "./admin-ui";

export interface AdminUserViewProps {
  user: AdminUser;
  currentUserId: string;
  adminCount: number;
  oidcInUse: boolean;
  /** Back to the list (the window asks first if the phone number is unsaved). */
  onBack: () => void;
  /** The window asks this before leaving the page. */
  registerLeaveGuard: (guard: AdminLeaveGuard | null) => void;
  /** Re-fetch the user list after any change to a user row. */
  onUserChanged: () => Promise<void>;
  /** Called after the user is deleted (the parent goes back to the list). */
  onUserDeleted: () => void;
}

export function AdminUserView({
  user,
  currentUserId,
  adminCount,
  oidcInUse,
  onBack,
  registerLeaveGuard,
  onUserChanged,
  onUserDeleted,
}: AdminUserViewProps) {
  const isSelf = user.id === currentUserId;
  useEscBack(true, onBack);

  // An unsaved phone number is asked about before the page is left.
  const phoneDirty = useRef(false);
  const setPhoneDirty = useCallback((d: boolean) => {
    phoneDirty.current = d;
  }, []);
  useEffect(() => {
    registerLeaveGuard(async () =>
      phoneDirty.current
        ? kitConfirm({
            title: "Discard the new number?",
            body: `${user.username}'s phone number hasn't been saved.`,
            confirmLabel: "Discard",
            cancelLabel: "Keep editing",
            destructive: true,
          })
        : true,
    );
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard, user.username]);

  return (
    <div data-testid="admin-user-view">
      <AdminBack label="Users" onBack={onBack} testId="admin-user-back" />
      <div className="flex flex-col items-center text-center gap-1 pt-1 pb-6">
        <KitAvatar src={userAvatarUrl(user.id, user.avatarPath)} fallback={userInitial(user.username)} size={84} />
        <h2 className="m-0 mt-2 text-[22px] font-bold tracking-[-0.02em] text-[var(--k-t1)]" data-testid="admin-user-name">
          {user.username}
        </h2>
        <p className="m-0 text-[13.5px] text-[var(--k-t2)]" data-testid="admin-user-standing">
          {[user.isAdmin ? "Administrator" : "Member", isSelf ? "You" : null, oidcInUse && user.isOidc ? "Signs in with OIDC" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex flex-col gap-5">
        <AccessGroup user={user} isSelf={isSelf} onUserChanged={onUserChanged} />
        <PhoneGroup user={user} onUserChanged={onUserChanged} onDirtyChange={setPhoneDirty} />
        <AdminServiceSecrets userId={user.id} />
        <SessionsGroup user={user} isSelf={isSelf} />
        <HostsGroup user={user} />
        <KitSettingsGroup title="Details" footer="The Matrix ID is set when the account is made and can't be changed here.">
          <KitSettingsRow
            label="Matrix ID"
            value={
              <span className="font-mono text-[12.5px] break-all" data-testid="admin-user-mxid">
                {user.mxid ?? "—"}
              </span>
            }
          />
          <KitSettingsRow label="User ID" value={<span className="font-mono text-[12px] break-all">{user.id}</span>} />
        </KitSettingsGroup>
        <DeleteGroup user={user} isSelf={isSelf} adminCount={adminCount} onUserDeleted={onUserDeleted} />
      </div>
    </div>
  );
}

// ─── Access ──────────────────────────────────────────────────────────────

function AccessGroup({
  user,
  isSelf,
  onUserChanged,
}: {
  user: AdminUser;
  isSelf: boolean;
  onUserChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"admin" | "notif" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleAdmin = async (next: boolean) => {
    const ok = await kitConfirm(
      next
        ? {
            title: `Make ${user.username} an admin?`,
            body: "They will be able to manage every user and instance setting.",
            confirmLabel: "Make admin",
          }
        : {
            title: `Remove admin access from ${user.username}?`,
            body: "They will lose access to the admin panel and its settings.",
            confirmLabel: "Remove admin",
            destructive: true,
          },
    );
    if (!ok) return;
    setBusy("admin");
    setError(null);
    try {
      if (next) await makeUserAdmin(user.id);
      else await removeAdminStatus(user.id);
      // The switch follows the list — keep it busy until the list has the change.
      await onUserChanged();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to change admin access."));
    } finally {
      setBusy(null);
    }
  };

  const toggleNotifications = async (next: boolean) => {
    setBusy("notif");
    setError(null);
    try {
      await setUserNotificationsEnabled(user.id, next);
      await onUserChanged();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to change notifications access."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <KitSettingsGroup title="Access">
        <KitSettingsRow
          label="Admin"
          description={isSelf ? "You can't remove your own admin access." : "Can manage users and instance settings."}
          control={
            <KitSwitch
              data-testid="admin-user-admin-switch"
              checked={user.isAdmin}
              disabled={busy !== null || isSelf}
              onCheckedChange={(v) => void toggleAdmin(v)}
              aria-label="Admin"
            />
          }
        />
        <KitSettingsRow
          label="Push notifications"
          description={
            user.isAdmin
              ? "Admins always have push notifications."
              : "Gives them Notifications in Preferences. Turning it off stops their pushes right away."
          }
          control={
            <KitSwitch
              data-testid="admin-user-notifications-switch"
              checked={user.isAdmin || user.notificationsEnabled}
              disabled={busy !== null || user.isAdmin}
              onCheckedChange={(v) => void toggleNotifications(v)}
              aria-label="Push notifications"
            />
          }
        />
        <KitSettingsRow
          label="Two-factor authentication"
          description="They turn it on or off themselves."
          value={user.totpEnabled ? "On" : "Off"}
        />
      </KitSettingsGroup>
      {error && (
        <KitBanner tone="danger" data-testid="admin-user-access-error">
          {error}
        </KitBanner>
      )}
    </div>
  );
}

// ─── Phone ───────────────────────────────────────────────────────────────

function PhoneGroup({
  user,
  onUserChanged,
  onDirtyChange,
}: {
  user: AdminUser;
  onUserChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(user.phoneE164 ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // What was last saved here — the user list's refresh can lag or fail.
  const [savedNumber, setSavedNumber] = useState<string | null>(null);

  useEffect(() => {
    setDraft(user.phoneE164 ?? "");
    setSavedNumber(null);
  }, [user.phoneE164]);

  const trimmed = draft.trim();
  // An empty field can't be saved (only the user removes their number), so
  // it isn't an unsaved change.
  const dirty = trimmed !== "" && trimmed !== (savedNumber ?? user.phoneE164 ?? "");
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    if (!dirty || !trimmed) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setUserPhone(user.id, trimmed);
      setSavedNumber(trimmed);
      setSaved(true);
      await onUserChanged();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to save number."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <KitSettingsGroup
        title="Phone"
        footer={
          saved && !dirty
            ? "Saved. They can remove it themselves from Preferences."
            : "The number agents call them on — include the country code (+1 for the US and Canada). Setting one turns the phone feature on for them."
        }
      >
        <KitSettingsRow
          label="Number"
          control={
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <KitInput
                type="tel"
                inputMode="tel"
                mono
                size="sm"
                data-testid="admin-user-phone-input"
                aria-label="Phone number"
                value={draft}
                disabled={busy}
                placeholder="None"
                invalid={!!error}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                  setSaved(false);
                }}
                // While changed, Esc puts the saved number back instead of
                // leaving the page.
                {...(dirty ? { "data-modal-esc-local": "" } : {})}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && dirty) {
                    e.preventDefault();
                    setDraft(savedNumber ?? user.phoneE164 ?? "");
                    setError(null);
                  }
                }}
                className="w-[180px] text-right"
              />
              {dirty && trimmed && (
                <KitButton type="submit" size="sm" variant="primary" data-testid="admin-user-phone-save" busy={busy}>
                  {busy ? "Saving…" : "Save"}
                </KitButton>
              )}
            </form>
          }
        />
      </KitSettingsGroup>
      {error && (
        <KitBanner tone="danger" data-testid="admin-user-phone-error">
          {error}
        </KitBanner>
      )}
    </div>
  );
}

// ─── Signed in ───────────────────────────────────────────────────────────

type SessionRow = Awaited<ReturnType<typeof getSessions>>["sessions"][number];

function isLive(s: SessionRow, now: number): boolean {
  if (s.isRevoked) return false;
  const exp = Date.parse(s.expiresAt);
  return Number.isNaN(exp) || exp > now;
}

function SessionsGroup({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { sessions: all } = await getSessions();
      const now = Date.now();
      setSessions(
        all
          .filter((s) => s.userId === user.id && isLive(s, now))
          .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)),
      );
      setError(null);
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to load sessions."));
    }
  }, [user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOne = async (s: SessionRow) => {
    const ok = await kitConfirm(
      s.isCurrentSession
        ? {
            title: "Log out this device?",
            body: "This is the browser you're using right now — you'll be logged out.",
            confirmLabel: "Log out",
            destructive: true,
          }
        : {
            title: "Log out this device?",
            body: `${s.deviceInfo || s.deviceType || "That device"} will have to sign in again.`,
            confirmLabel: "Log out",
            destructive: true,
          },
    );
    if (!ok) return;
    setBusyId(s.id);
    try {
      await revokeSession(s.id);
      await load();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to log out that device."));
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async () => {
    const ok = await kitConfirm(
      isSelf
        ? {
            title: "Log out your other devices?",
            body: "Every other device you're signed in on will be logged out. This one stays signed in.",
            confirmLabel: "Log out other devices",
            destructive: true,
          }
        : {
            title: `Log ${user.username} out everywhere?`,
            body: "Every device they're signed in on will be logged out.",
            confirmLabel: "Log out everywhere",
            destructive: true,
          },
    );
    if (!ok) return;
    setBusyId("__all__");
    try {
      await revokeAllUserSessions(user.id, isSelf);
      await load();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to log out."));
    } finally {
      setBusyId(null);
    }
  };

  const revocable = (sessions ?? []).filter((s) => !(isSelf && s.isCurrentSession));
  const now = Date.now();

  return (
    <div className="flex flex-col gap-2" data-testid="admin-user-sessions">
      <KitSettingsGroup title={sessions && sessions.length > 0 ? `Signed in · ${sessions.length}` : "Signed in"}>
        {sessions === null && !error ? (
          <div className="px-3.5 py-3">
            <KitLoading lines={2} />
          </div>
        ) : sessions !== null && sessions.length === 0 ? (
          <KitSettingsRow label="Not signed in anywhere" tone="default" data-testid="admin-user-sessions-empty" />
        ) : (
          (sessions ?? []).map((s) => (
            <KitSettingsRow
              key={s.id}
              data-testid={`admin-session-${s.id}`}
              label={
                <>
                  {s.deviceInfo || s.deviceType || "Unknown device"}
                  {s.isCurrentSession && (
                    <span className="ml-2 text-[12px] font-normal text-[var(--k-acc-text)]">This browser</span>
                  )}
                </>
              }
              description={
                <span title={`Signed in ${formatAdminDate(s.createdAt)} · expires ${formatAdminDate(s.expiresAt)}`}>
                  Active {relativeAdminTime(s.lastActiveAt, now)} · signed in {formatAdminDate(s.createdAt)}
                </span>
              }
              control={
                <KitButton
                  variant="danger-quiet"
                  size="sm"
                  data-testid={`admin-session-revoke-${s.id}`}
                  busy={busyId === s.id}
                  disabled={busyId !== null}
                  onClick={() => void revokeOne(s)}
                >
                  {busyId === s.id ? "Logging out…" : "Log out"}
                </KitButton>
              }
            />
          ))
        )}
      </KitSettingsGroup>
      {/* Only when it does more than one row's own Log out would. */}
      {revocable.length > 1 ? (
        <KitSettingsGroup>
          <KitSettingsRow
            tone="danger"
            chevron={false}
            label={isSelf ? "Log out other devices" : "Log out everywhere"}
            disabled={busyId !== null}
            onClick={() => void revokeAll()}
            data-testid="admin-user-sessions-revoke-all"
          />
        </KitSettingsGroup>
      ) : null}
      {error && (
        <KitBanner tone="danger" data-testid="admin-user-sessions-error">
          {error}
        </KitBanner>
      )}
    </div>
  );
}

// ─── Hosts they own ───────────────────────────────────────────────────

function HostsGroup({ user }: { user: AdminUser }) {
  const [hosts, setHosts] = useState<SSHHostWithStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // ownedOnly=false: an admin caller gets every user's hosts; narrow to
    // the ones this user owns.
    getSSHHosts(false)
      .then((all) => {
        if (cancelled) return;
        setHosts(all.filter((h) => h.userId === user.id).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => {
        if (!cancelled) setError(adminErrorMessage(err, "Failed to load hosts."));
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <div className="flex flex-col gap-2" data-testid="admin-user-hosts">
      <KitSettingsGroup
        title={hosts && hosts.length > 0 ? `Hosts · ${hosts.length}` : "Hosts"}
        footer="Hosts they added. Only they can change them."
      >
        {hosts === null && !error ? (
          <div className="px-3.5 py-3">
            <KitLoading lines={1} />
          </div>
        ) : hosts !== null && hosts.length === 0 ? (
          <KitSettingsRow label="None" data-testid="admin-user-hosts-empty" />
        ) : (
          (hosts ?? []).map((h) => (
            <KitSettingsRow
              key={h.id}
              data-testid={`admin-user-host-${h.id}`}
              leading={
                <span
                  role="img"
                  aria-label={h.status}
                  title={h.status}
                  className="k-status shrink-0"
                  data-status={h.status === "online" ? "ok" : h.status === "offline" ? "bad" : undefined}
                />
              }
              label={h.name || h.ip}
              description={
                <span className="font-mono text-[12px]">
                  {h.username ? `${h.username}@` : ""}
                  {h.ip}
                  {h.port ? `:${h.port}` : ""}
                </span>
              }
              value={h.connectionType && h.connectionType !== "ssh" ? h.connectionType.toUpperCase() : undefined}
            />
          ))
        )}
      </KitSettingsGroup>
      {error && (
        <KitBanner tone="danger" data-testid="admin-user-hosts-error">
          {error}
        </KitBanner>
      )}
    </div>
  );
}

// ─── Delete ──────────────────────────────────────────────────────────────

function DeleteGroup({
  user,
  isSelf,
  adminCount,
  onUserDeleted,
}: {
  user: AdminUser;
  isSelf: boolean;
  adminCount: number;
  onUserDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLastAdmin = user.isAdmin && adminCount <= 1;
  const blocked = isSelf
    ? "You can't delete your own account from here."
    : isLastAdmin
      ? "This is the only admin, so it can't be deleted."
      : null;

  const handleDelete = async () => {
    const typed = await kitPrompt({
      title: `Delete ${user.username}?`,
      body: "This removes their account and all of their data, and can't be undone.",
      label: "Type the username to confirm",
      placeholder: user.username,
      confirmLabel: "Delete user",
      destructive: true,
      validate: (v) => (v.trim() === user.username ? null : "Username doesn't match."),
    });
    if (typed === null) return;
    if (typed.trim() !== user.username) {
      setError("Username didn't match. Nothing was deleted.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteUser(user.username);
      onUserDeleted();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to delete user."));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <KitSettingsGroup footer={blocked ?? "Removes the account and everything it owns. This can't be undone."}>
        <KitSettingsRow
          tone="danger"
          chevron={false}
          label={busy ? "Deleting…" : "Delete user…"}
          disabled={busy || blocked !== null}
          onClick={() => void handleDelete()}
          data-testid="admin-user-delete"
        />
      </KitSettingsGroup>
      {error && (
        <KitBanner tone="danger" data-testid="admin-user-delete-error">
          {error}
        </KitBanner>
      )}
    </div>
  );
}
