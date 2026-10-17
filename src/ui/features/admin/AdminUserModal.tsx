/**
 * AdminUserModal — one user's admin view, opened from Admin → Users.
 *
 * Tabs:
 *   - Account:  admin access, push-notification access, phone number,
 *               agent service keys, read-only identity details, delete user.
 *   - Sessions: that user's live login sessions; revoke one or all.
 *   - Hosts:    hosts the user owns (read-only).
 *
 * The Matrix ID is shown read-only on purpose: re-pointing a user's mxid
 * from here would not reconcile their relay rooms, so it stays a
 * backend-only operation for now.
 *
 * Backend guards are authoritative (can't demote yourself, can't delete
 * yourself, can't delete the last admin); the UI mirrors them so the
 * controls are disabled rather than failing on click.
 */

import { useCallback, useEffect, useState } from "react";
import { MonitorSmartphone, Server, UserCog } from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalFoot,
  ModalHead,
  ModalSidebar,
  type ModalTabDef,
} from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitChip,
  KitEmpty,
  KitInput,
  KitList,
  KitListRow,
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
import { AdminServiceSecrets } from "./AdminServiceSecrets";
import type { SSHHostWithStatus } from "@/main-axios";
import {
  UserAvatar,
  adminErrorMessage,
  formatAdminDate,
} from "./admin-ui";

type UserTab = "account" | "sessions" | "hosts";

const TABS: ReadonlyArray<ModalTabDef<UserTab>> = [
  { value: "account", label: "Account", Icon: UserCog },
  { value: "sessions", label: "Sessions", Icon: MonitorSmartphone },
  { value: "hosts", label: "Hosts", Icon: Server },
];

export interface AdminUserModalProps {
  user: AdminUser | null;
  currentUserId: string;
  adminCount: number;
  oidcInUse: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-fetch the user list after any change to a user row. */
  onUserChanged: () => void;
  /** Called after the user is deleted (the parent closes this modal). */
  onUserDeleted: () => void;
}

export default function AdminUserModal({
  user,
  currentUserId,
  adminCount,
  oidcInUse,
  onOpenChange,
  onUserChanged,
  onUserDeleted,
}: AdminUserModalProps) {
  const [tab, setTab] = useState<UserTab>("account");
  const open = user !== null;

  useEffect(() => {
    if (!open) setTab("account");
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="settings"
      data-testid="admin-user-modal"
    >
      <ModalHead
        meta="User"
        leading={
          user ? (
            <UserAvatar
              userId={user.id}
              username={user.username}
              avatarPath={user.avatarPath}
              size={40}
            />
          ) : undefined
        }
        title={user ? <span className="truncate">{user.username}</span> : "User"}
      >
        {user && (user.isAdmin || (oidcInUse && user.isOidc)) && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {user.isAdmin && <KitChip tone="accent">Admin</KitChip>}
            {oidcInUse && user.isOidc && <KitChip>OIDC</KitChip>}
          </div>
        )}
      </ModalHead>
      {/* Side list on desktop, drill-in on mobile — same shape as the
          Admin modal behind it. */}
      <ModalSidebar<UserTab>
        tabs={TABS}
        value={tab}
        onValueChange={setTab}
        testIdPrefix="admin-user-tab"
        backLabel={user?.username ?? "User"}
      >
        <ModalBody className="p-0">
          {user && tab === "account" && (
            <AccountTab
              user={user}
              isSelf={user.id === currentUserId}
              adminCount={adminCount}
              onUserChanged={onUserChanged}
              onUserDeleted={onUserDeleted}
            />
          )}
          {user && tab === "sessions" && (
            <SessionsTab user={user} isSelf={user.id === currentUserId} />
          )}
          {user && tab === "hosts" && <HostsTab user={user} />}
        </ModalBody>
      </ModalSidebar>
      <ModalFoot>
        <KitButton onClick={() => onOpenChange(false)}>Close</KitButton>
      </ModalFoot>
    </Modal>
  );
}

// ─── Account ─────────────────────────────────────────────────────────────

function AccountTab({
  user,
  isSelf,
  adminCount,
  onUserChanged,
  onUserDeleted,
}: {
  user: AdminUser;
  isSelf: boolean;
  adminCount: number;
  onUserChanged: () => void;
  onUserDeleted: () => void;
}) {
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  const [phoneDraft, setPhoneDraft] = useState(user.phoneE164 ?? "");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSaved, setPhoneSaved] = useState(false);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setPhoneDraft(user.phoneE164 ?? "");
  }, [user.phoneE164]);

  const toggleNotifications = async (next: boolean) => {
    setNotifBusy(true);
    setNotifError(null);
    try {
      await setUserNotificationsEnabled(user.id, next);
      onUserChanged();
    } catch (err) {
      setNotifError(
        adminErrorMessage(err, "Failed to change notifications access."),
      );
    } finally {
      setNotifBusy(false);
    }
  };

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
    setAdminBusy(true);
    setAdminError(null);
    try {
      if (next) await makeUserAdmin(user.id);
      else await removeAdminStatus(user.id);
      onUserChanged();
    } catch (err) {
      setAdminError(adminErrorMessage(err, "Failed to change admin access."));
    } finally {
      setAdminBusy(false);
    }
  };

  const phoneTrimmed = phoneDraft.trim();
  const phoneDirty = phoneTrimmed !== (user.phoneE164 ?? "");

  const savePhone = async () => {
    setPhoneBusy(true);
    setPhoneError(null);
    setPhoneSaved(false);
    try {
      await setUserPhone(user.id, phoneTrimmed);
      setPhoneSaved(true);
      onUserChanged();
    } catch (err) {
      setPhoneError(adminErrorMessage(err, "Failed to save number."));
    } finally {
      setPhoneBusy(false);
    }
  };

  const isLastAdmin = user.isAdmin && adminCount <= 1;
  const deleteBlockedReason = isSelf
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
      validate: (v) =>
        v.trim() === user.username ? null : "Username doesn't match.",
    });
    if (typed === null) return;
    if (typed.trim() !== user.username) {
      setDeleteError("Username didn't match. Nothing was deleted.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteUser(user.username);
      onUserDeleted();
    } catch (err) {
      setDeleteError(adminErrorMessage(err, "Failed to delete user."));
      setDeleteBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-[22px] px-6 py-5 max-sm:px-5"
      data-testid="admin-user-account"
    >
      <div className="flex flex-col gap-2">
        <KitSettingsGroup title="Access">
          <KitSettingsRow
            label="Admin"
            description={
              isSelf
                ? "You can't remove your own admin access."
                : "Admins can manage users and instance settings."
            }
            control={
              <KitSwitch
                data-testid="admin-user-admin-switch"
                checked={user.isAdmin}
                disabled={adminBusy || isSelf}
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
                : "Gives this user the Notifications section in Preferences. Turning it off stops their pushes right away."
            }
            control={
              <KitSwitch
                data-testid="admin-user-notifications-switch"
                checked={user.isAdmin || user.notificationsEnabled}
                disabled={notifBusy || user.isAdmin}
                onCheckedChange={(v) => void toggleNotifications(v)}
                aria-label="Push notifications"
              />
            }
          />
          <KitSettingsRow
            label="Two-factor authentication"
            value={user.totpEnabled ? "On" : "Off"}
          />
        </KitSettingsGroup>
        {adminError && (
          <KitBanner tone="danger" data-testid="admin-user-admin-error">
            {adminError}
          </KitBanner>
        )}
        {notifError && (
          <KitBanner tone="danger" data-testid="admin-user-notifications-error">
            {notifError}
          </KitBanner>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <KitSettingsGroup
          title="Phone"
          footer="E.164 format with the country code, e.g. +1 for US/Canada. The user can remove it themselves from Preferences."
        >
          <KitSettingsRow
            stacked
            label="Phone number"
            description="The number agents call this user on. Setting it also turns on the phone feature for them."
          >
            <form
              className="flex gap-2 flex-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (phoneDirty && phoneTrimmed) void savePhone();
              }}
            >
              <KitInput
                type="tel"
                inputMode="tel"
                mono
                data-testid="admin-user-phone-input"
                aria-label="Phone number"
                value={phoneDraft}
                disabled={phoneBusy}
                placeholder="+17165550100"
                invalid={!!phoneError}
                onChange={(e) => {
                  setPhoneDraft(e.target.value);
                  setPhoneError(null);
                  setPhoneSaved(false);
                }}
                className="flex-1 min-w-[180px] w-auto"
              />
              <KitButton
                type="submit"
                variant="primary"
                data-testid="admin-user-phone-save"
                busy={phoneBusy}
                disabled={!phoneDirty || !phoneTrimmed}
              >
                {phoneBusy ? "Saving…" : "Save"}
              </KitButton>
            </form>
          </KitSettingsRow>
        </KitSettingsGroup>
        {phoneError && (
          <KitBanner tone="danger" data-testid="admin-user-phone-error">
            {phoneError}
          </KitBanner>
        )}
        {phoneSaved && !phoneError && (
          <KitBanner tone="ok">Number saved</KitBanner>
        )}
      </div>

      <AdminServiceSecrets userId={user.id} />

      <KitSettingsGroup title="Identity">
        <KitSettingsRow
          label="Matrix ID"
          description="Read-only here; it's minted when the user is created."
          value={
            <span
              className="font-mono break-all"
              data-testid="admin-user-mxid"
            >
              {user.mxid ?? "—"}
            </span>
          }
        />
        <KitSettingsRow
          label="User ID"
          value={<span className="font-mono text-[12px] break-all">{user.id}</span>}
        />
      </KitSettingsGroup>

      <div className="flex flex-col gap-2">
        <KitSettingsGroup title="Danger zone">
          <KitSettingsRow
            label="Delete user"
            description={
              deleteBlockedReason ??
              "Removes the account and everything it owns. This can't be undone."
            }
            control={
              <KitButton
                variant="danger-quiet"
                size="sm"
                data-testid="admin-user-delete"
                busy={deleteBusy}
                disabled={deleteBlockedReason !== null}
                onClick={() => void handleDelete()}
              >
                {deleteBusy ? "Deleting…" : "Delete user"}
              </KitButton>
            }
          />
        </KitSettingsGroup>
        {deleteError && (
          <KitBanner tone="danger" data-testid="admin-user-delete-error">
            {deleteError}
          </KitBanner>
        )}
      </div>
    </div>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────────

type SessionRow = Awaited<ReturnType<typeof getSessions>>["sessions"][number];

function isLive(s: SessionRow, now: number): boolean {
  if (s.isRevoked) return false;
  const exp = Date.parse(s.expiresAt);
  return Number.isNaN(exp) || exp > now;
}

function SessionsTab({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
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
            title: "Revoke your current session?",
            body: "This is the session you're using right now. Revoking it will log you out.",
            confirmLabel: "Revoke and log out",
            destructive: true,
          }
        : {
            title: "Revoke this session?",
            body: "That device will be logged out.",
            confirmLabel: "Revoke",
            destructive: true,
          },
    );
    if (!ok) return;
    setBusyId(s.id);
    try {
      await revokeSession(s.id);
      await load();
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to revoke session."));
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async () => {
    const ok = await kitConfirm(
      isSelf
        ? {
            title: "Log out your other devices?",
            body: "Every other device you're signed in on will be logged out. This session stays signed in.",
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
      setError(adminErrorMessage(err, "Failed to revoke sessions."));
    } finally {
      setBusyId(null);
    }
  };

  const revocable = (sessions ?? []).filter(
    (s) => !(isSelf && s.isCurrentSession),
  );

  return (
    <div
      className="flex flex-col gap-3 px-6 py-5 max-sm:px-5"
      data-testid="admin-user-sessions"
    >
      <div className="flex items-center gap-3">
        <p className="m-0 text-[13px] text-[var(--k-t2)]">
          {sessions === null
            ? "Loading sessions…"
            : sessions.length === 0
              ? "No active sessions."
              : `${sessions.length} active ${sessions.length === 1 ? "session" : "sessions"}`}
        </p>
        <KitButton
          variant="danger-quiet"
          size="sm"
          className="ml-auto"
          data-testid="admin-user-sessions-revoke-all"
          busy={busyId === "__all__"}
          disabled={busyId !== null || revocable.length === 0}
          onClick={() => void revokeAll()}
        >
          {isSelf ? "Log out other devices" : "Log out everywhere"}
        </KitButton>
      </div>
      {error && (
        <KitBanner tone="danger" data-testid="admin-user-sessions-error">
          {error}
        </KitBanner>
      )}
      {sessions === null && !error && <KitLoading lines={2} />}
      <KitList>
        {(sessions ?? []).map((s) => (
          <KitListRow
            key={s.id}
            data-testid={`admin-session-${s.id}`}
            title={s.deviceInfo || s.deviceType}
            wrapSubtitle
            subtitle={
              <>
                Last active {formatAdminDate(s.lastActiveAt)} · signed in{" "}
                {formatAdminDate(s.createdAt)} · expires{" "}
                {formatAdminDate(s.expiresAt)}
              </>
            }
            trailing={
              <>
                {s.deviceType && <KitChip>{s.deviceType}</KitChip>}
                {s.isCurrentSession && (
                  <KitChip tone="accent">This session</KitChip>
                )}
                <KitButton
                  variant="danger-quiet"
                  size="sm"
                  data-testid={`admin-session-revoke-${s.id}`}
                  busy={busyId === s.id}
                  disabled={busyId !== null}
                  onClick={() => void revokeOne(s)}
                >
                  {busyId === s.id ? "Revoking…" : "Revoke"}
                </KitButton>
              </>
            }
          />
        ))}
      </KitList>
    </div>
  );
}

// ─── Hosts ───────────────────────────────────────────────────────────────

function HostsTab({ user }: { user: AdminUser }) {
  const [hosts, setHosts] = useState<SSHHostWithStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // ownedOnly=false: an admin caller gets every user's hosts; narrow to
    // the ones this user owns.
    getSSHHosts(false)
      .then((all) => {
        if (cancelled) return;
        setHosts(
          all
            .filter((h) => h.userId === user.id)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((err) => {
        if (!cancelled)
          setError(adminErrorMessage(err, "Failed to load hosts."));
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <div
      className="flex flex-col gap-3 px-6 py-5 max-sm:px-5"
      data-testid="admin-user-hosts"
    >
      {error ? (
        <KitBanner tone="danger" data-testid="admin-user-hosts-error">
          {error}
        </KitBanner>
      ) : hosts === null ? (
        <KitLoading label="Loading hosts…" />
      ) : hosts.length === 0 ? (
        <KitEmpty title={`${user.username} doesn't own any hosts.`} />
      ) : (
        <p className="m-0 text-[13px] text-[var(--k-t2)]">
          {hosts.length} {hosts.length === 1 ? "host" : "hosts"}
        </p>
      )}
      <KitList>
        {(hosts ?? []).map((h) => (
          <KitListRow
            key={h.id}
            data-testid={`admin-host-${h.id}`}
            title={
              <>
                <span
                  role="img"
                  aria-label={h.status}
                  title={h.status}
                  className="k-status inline-block align-middle mr-2"
                  data-status={
                    h.status === "online"
                      ? "ok"
                      : h.status === "offline"
                        ? "bad"
                        : undefined
                  }
                />
                {h.name || h.ip}
              </>
            }
            subtitle={
              <span className="font-mono">
                {h.username ? `${h.username}@` : ""}
                {h.ip}
                {h.port ? `:${h.port}` : ""}
              </span>
            }
            trailing={
              h.connectionType && h.connectionType !== "ssh" ? (
                <KitChip>{h.connectionType}</KitChip>
              ) : undefined
            }
          />
        ))}
      </KitList>
    </div>
  );
}
