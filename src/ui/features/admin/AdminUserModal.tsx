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
import { Switch } from "@/components/switch";
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
  AdminBadge,
  AdminButton,
  AdminError,
  AdminMuted,
  AdminRow,
  AdminSection,
  UserAvatar,
  adminErrorMessage,
  adminInputClass,
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
        title={
          user ? (
            <span className="flex items-center gap-2">
              <UserAvatar
                userId={user.id}
                username={user.username}
                avatarPath={user.avatarPath}
                size={24}
              />
              <span className="truncate">{user.username}</span>
              {user.isAdmin && <AdminBadge tone="accent">Admin</AdminBadge>}
              {oidcInUse && user.isOidc && <AdminBadge>OIDC</AdminBadge>}
            </span>
          ) : (
            "User"
          )
        }
      />
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
        <AdminButton onClick={() => onOpenChange(false)}>Close</AdminButton>
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
    const prompt = next
      ? `Make ${user.username} an admin? They will be able to manage every user and instance setting.`
      : `Remove admin access from ${user.username}?`;
    if (!window.confirm(prompt)) return;
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
    const typed = window.prompt(
      `Delete ${user.username}? This removes their account and all of their data, and can't be undone.\n\nType the username to confirm:`,
    );
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
      className="flex flex-col gap-6 px-6 py-5"
      data-testid="admin-user-account"
    >
      <AdminSection title="Access">
        <div className="flex flex-col">
          <AdminRow
            label="Admin"
            description={
              isSelf
                ? "You can't remove your own admin access."
                : "Admins can manage users and instance settings."
            }
            control={
              <Switch
                data-testid="admin-user-admin-switch"
                checked={user.isAdmin}
                disabled={adminBusy || isSelf}
                onCheckedChange={(v) => void toggleAdmin(v)}
                aria-label="Admin"
              />
            }
          />
          <AdminRow
            label="Push notifications"
            description={
              user.isAdmin
                ? "Admins always have push notifications."
                : "Gives this user the Notifications section in Preferences. Turning it off stops their pushes right away."
            }
            control={
              <Switch
                data-testid="admin-user-notifications-switch"
                checked={user.isAdmin || user.notificationsEnabled}
                disabled={notifBusy || user.isAdmin}
                onCheckedChange={(v) => void toggleNotifications(v)}
                aria-label="Push notifications"
              />
            }
          />
          <AdminRow
            label="Two-factor authentication"
            control={
              <span className="text-[12.5px] text-[#cfc8b8]">
                {user.totpEnabled ? "On" : "Off"}
              </span>
            }
          />
        </div>
        {adminError && (
          <AdminError testId="admin-user-admin-error">{adminError}</AdminError>
        )}
        {notifError && (
          <AdminError testId="admin-user-notifications-error">
            {notifError}
          </AdminError>
        )}
      </AdminSection>

      <AdminSection
        title="Phone"
        description="The number agents call this user on. Setting it also turns on the phone feature for them."
      >
        <form
          className="flex gap-2 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (phoneDirty && phoneTrimmed) void savePhone();
          }}
        >
          <input
            type="tel"
            inputMode="tel"
            data-testid="admin-user-phone-input"
            aria-label="Phone number"
            value={phoneDraft}
            disabled={phoneBusy}
            placeholder="+17165550100"
            onChange={(e) => {
              setPhoneDraft(e.target.value);
              setPhoneError(null);
              setPhoneSaved(false);
            }}
            className={`${adminInputClass} flex-1 min-w-[180px]`}
          />
          <AdminButton
            type="submit"
            data-testid="admin-user-phone-save"
            disabled={phoneBusy || !phoneDirty || !phoneTrimmed}
          >
            {phoneBusy ? "Saving…" : "Save"}
          </AdminButton>
        </form>
        <span className="text-[12px] text-[#a89a80]">
          E.164 format with the country code, e.g. +1 for US/Canada. The user
          can remove it themselves from Preferences.
        </span>
        {phoneError && (
          <AdminError testId="admin-user-phone-error">{phoneError}</AdminError>
        )}
        {phoneSaved && !phoneError && (
          <span className="text-[12px] text-[#8fd39e]">✓ Number saved</span>
        )}
      </AdminSection>

      <AdminServiceSecrets userId={user.id} />

      <AdminSection title="Identity">
        <div className="flex flex-col">
          <AdminRow
            label="Matrix ID"
            description="Read-only here; it's minted when the user is created."
            control={
              <span
                className="text-[12.5px] font-mono text-[#cfc8b8] break-all"
                data-testid="admin-user-mxid"
              >
                {user.mxid ?? "—"}
              </span>
            }
          />
          <AdminRow
            label="User ID"
            control={
              <span className="text-[12px] font-mono text-[#a89a80] break-all">
                {user.id}
              </span>
            }
          />
        </div>
      </AdminSection>

      <AdminSection title="Danger zone">
        <AdminRow
          label="Delete user"
          description={
            deleteBlockedReason ??
            "Removes the account and everything it owns. This can't be undone."
          }
          control={
            <AdminButton
              tone="danger"
              data-testid="admin-user-delete"
              disabled={deleteBusy || deleteBlockedReason !== null}
              onClick={() => void handleDelete()}
            >
              {deleteBusy ? "Deleting…" : "Delete user"}
            </AdminButton>
          }
        />
        {deleteError && (
          <AdminError testId="admin-user-delete-error">
            {deleteError}
          </AdminError>
        )}
      </AdminSection>
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
    const prompt = s.isCurrentSession
      ? "This is the session you're using right now. Revoking it will log you out. Continue?"
      : "Revoke this session? That device will be logged out.";
    if (!window.confirm(prompt)) return;
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
    const prompt = isSelf
      ? "Log out every other device you're signed in on? This session stays signed in."
      : `Log ${user.username} out of every device?`;
    if (!window.confirm(prompt)) return;
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
      className="flex flex-col gap-3 px-6 py-5"
      data-testid="admin-user-sessions"
    >
      <div className="flex items-center gap-3">
        <AdminMuted>
          {sessions === null
            ? "Loading sessions…"
            : sessions.length === 0
              ? "No active sessions."
              : `${sessions.length} active ${sessions.length === 1 ? "session" : "sessions"}`}
        </AdminMuted>
        <AdminButton
          tone="danger"
          className="ml-auto"
          data-testid="admin-user-sessions-revoke-all"
          disabled={busyId !== null || revocable.length === 0}
          onClick={() => void revokeAll()}
        >
          {isSelf ? "Log out other devices" : "Log out everywhere"}
        </AdminButton>
      </div>
      {error && (
        <AdminError testId="admin-user-sessions-error">{error}</AdminError>
      )}
      <ul className="flex flex-col gap-1.5">
        {(sessions ?? []).map((s) => (
          <li
            key={s.id}
            data-testid={`admin-session-${s.id}`}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black/15"
          >
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-[13px] text-[#e8e4d8]">
                  {s.deviceInfo || s.deviceType}
                </span>
                {s.deviceType && <AdminBadge>{s.deviceType}</AdminBadge>}
                {s.isCurrentSession && (
                  <AdminBadge tone="accent">This session</AdminBadge>
                )}
              </span>
              <span className="text-[11.5px] text-[#a89a80]">
                Last active {formatAdminDate(s.lastActiveAt)} · signed in{" "}
                {formatAdminDate(s.createdAt)} · expires{" "}
                {formatAdminDate(s.expiresAt)}
              </span>
            </div>
            <AdminButton
              tone="danger"
              data-testid={`admin-session-revoke-${s.id}`}
              disabled={busyId !== null}
              onClick={() => void revokeOne(s)}
            >
              {busyId === s.id ? "Revoking…" : "Revoke"}
            </AdminButton>
          </li>
        ))}
      </ul>
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
      className="flex flex-col gap-3 px-6 py-5"
      data-testid="admin-user-hosts"
    >
      {error ? (
        <AdminError testId="admin-user-hosts-error">{error}</AdminError>
      ) : (
        <AdminMuted>
          {hosts === null
            ? "Loading hosts…"
            : hosts.length === 0
              ? `${user.username} doesn't own any hosts.`
              : `${hosts.length} ${hosts.length === 1 ? "host" : "hosts"}`}
        </AdminMuted>
      )}
      <ul className="flex flex-col gap-1.5">
        {(hosts ?? []).map((h) => (
          <li
            key={h.id}
            data-testid={`admin-host-${h.id}`}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black/15"
          >
            <span
              aria-label={h.status}
              title={h.status}
              className="size-2 rounded-full shrink-0"
              style={{
                background:
                  h.status === "online"
                    ? "#8fd39e"
                    : h.status === "offline"
                      ? "#d38f8f"
                      : "rgba(200,196,184,0.4)",
              }}
            />
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="truncate text-[13px] text-[#e8e4d8]">
                {h.name || h.ip}
              </span>
              <span className="truncate text-[11.5px] font-mono text-[#a89a80]">
                {h.username ? `${h.username}@` : ""}
                {h.ip}
                {h.port ? `:${h.port}` : ""}
              </span>
            </div>
            {h.connectionType && h.connectionType !== "ssh" && (
              <AdminBadge>{h.connectionType}</AdminBadge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
