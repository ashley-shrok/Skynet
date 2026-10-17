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
import {
  KitBanner,
  KitChip,
  KitList,
  KitListRow,
  KitLoading,
} from "@/components/kit";
import { userAvatarUrl, userInitial } from "./admin-ui";

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
      <div className="px-6 py-5 max-sm:px-5">
        <KitBanner tone="danger" data-testid="admin-users-error">
          {error}
        </KitBanner>
      </div>
    );
  }
  if (!users) {
    return (
      <div className="px-6 py-5 max-sm:px-5">
        <KitLoading label="Loading users…" />
      </div>
    );
  }

  const sorted = [...users].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
  );
  const adminCount = users.filter((u) => u.isAdmin).length;

  return (
    <div
      className="flex flex-col gap-3 px-6 py-5 max-sm:px-5"
      data-testid="admin-users-pane"
    >
      <p className="m-0 text-[13px] text-[var(--k-t2)]">
        {users.length} {users.length === 1 ? "user" : "users"} · {adminCount}{" "}
        {adminCount === 1 ? "admin" : "admins"}
      </p>
      <KitList>
        {sorted.map((u) => (
          <KitListRow
            key={u.id}
            data-testid={`admin-user-row-${u.id}`}
            onActivate={() => onOpenUser(u.id)}
            avatarSrc={userAvatarUrl(u.id, u.avatarPath)}
            avatar={userInitial(u.username)}
            title={u.username}
            subtitle={
              u.mxid ? <span className="font-mono">{u.mxid}</span> : undefined
            }
            trailing={
              <>
                {u.id === currentUserId && <KitChip>You</KitChip>}
                {u.isAdmin && <KitChip tone="accent">Admin</KitChip>}
                {oidcInUse && u.isOidc && <KitChip>OIDC</KitChip>}
                <ChevronRight
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--k-t3)]"
                />
              </>
            }
          />
        ))}
      </KitList>
    </div>
  );
}
