/**
 * Admin → Users: every user on the instance. Clicking a row opens that
 * user's own modal (AdminUserModal) with account controls, login sessions
 * and owned hosts.
 *
 * OIDC badges only render when `oidcInUse` — on instances that never set up
 * OIDC there is nothing OIDC-shaped in the panel at all.
 */

import { ChevronRight } from "lucide-react";
import type { AdminUser } from "@/api/user-management-api";
import { AdminBadge, AdminError, AdminMuted, UserAvatar } from "./admin-ui";

export interface AdminUsersPaneProps {
  users: AdminUser[] | null;
  error: string | null;
  currentUserId: string;
  oidcInUse: boolean;
  onOpenUser: (userId: string) => void;
}

export function AdminUsersPane({
  users,
  error,
  currentUserId,
  oidcInUse,
  onOpenUser,
}: AdminUsersPaneProps) {
  if (error) {
    return (
      <div className="px-6 py-5">
        <AdminError testId="admin-users-error">{error}</AdminError>
      </div>
    );
  }
  if (!users) {
    return (
      <div className="px-6 py-5">
        <AdminMuted>Loading users…</AdminMuted>
      </div>
    );
  }

  const sorted = [...users].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
  );
  const adminCount = users.filter((u) => u.isAdmin).length;

  return (
    <div
      className="flex flex-col gap-3 px-6 py-5"
      data-testid="admin-users-pane"
    >
      <AdminMuted>
        {users.length} {users.length === 1 ? "user" : "users"} · {adminCount}{" "}
        {adminCount === 1 ? "admin" : "admins"}
      </AdminMuted>
      <ul className="flex flex-col gap-1">
        {sorted.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              data-testid={`admin-user-row-${u.id}`}
              onClick={() => onOpenUser(u.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left cursor-pointer bg-black/15 hover:bg-white/[0.06] transition-colors duration-100"
            >
              <UserAvatar
                userId={u.id}
                username={u.username}
                avatarPath={u.avatarPath}
              />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-[13.5px] text-[#fbf5e8]">
                    {u.username}
                  </span>
                  {u.id === currentUserId && <AdminBadge>You</AdminBadge>}
                  {u.isAdmin && <AdminBadge tone="accent">Admin</AdminBadge>}
                  {oidcInUse && u.isOidc && <AdminBadge>OIDC</AdminBadge>}
                </span>
                {u.mxid && (
                  <span className="truncate text-[11.5px] font-mono text-[#a89a80]">
                    {u.mxid}
                  </span>
                )}
              </span>
              <ChevronRight size={16} className="shrink-0 text-[#a89a80]" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
