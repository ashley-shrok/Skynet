/**
 * Admin → Users: everyone on the instance, admins in their own group above
 * everyone else, alphabetical within each. A row opens that user one level
 * deeper in the same window. A search box appears once the list is long.
 *
 * OIDC marks only render when `oidcInUse` — on instances that never set up
 * OIDC there is nothing OIDC-shaped in the panel at all.
 */

import { useMemo } from "react";
import type { AdminUser } from "@/api/user-management-api";
import {
  KitAvatar,
  KitBanner,
  KitEmpty,
  KitLoading,
  KitSearch,
  KitSettingsGroup,
  KitSettingsRow,
} from "@/components/kit";
import { userAvatarUrl, userInitial } from "./admin-ui";

/** More users than this and the list gets a search box. */
const SEARCH_FROM = 8;

export interface AdminUsersPaneProps {
  users: AdminUser[] | null;
  error: string | null;
  currentUserId: string;
  oidcInUse: boolean;
  /** The search text — the window keeps it across opening someone. */
  query: string;
  onQueryChange: (query: string) => void;
  onOpenUser: (userId: string) => void;
}

export function AdminUsersPane({
  users,
  error,
  currentUserId,
  oidcInUse,
  query,
  onQueryChange,
  onOpenUser,
}: AdminUsersPaneProps) {
  const groups = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const sorted = [...(users ?? [])]
      .filter((u) => {
        const hay = `${u.username} ${u.mxid ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
    return [
      { title: "Admins", rows: sorted.filter((u) => u.isAdmin) },
      { title: "Members", rows: sorted.filter((u) => !u.isAdmin) },
    ].filter((g) => g.rows.length > 0);
  }, [users, query]);

  if (error) {
    return (
      <KitBanner tone="danger" data-testid="admin-users-error">
        {error}
      </KitBanner>
    );
  }
  if (!users) return <KitLoading label="Loading users…" />;

  return (
    <div className="flex flex-col" data-testid="admin-users-pane">
      {/* Still shown while a search is on, so a list that shrank under it can be cleared. */}
      {(users.length > SEARCH_FROM || query !== "") && (
        <KitSearch
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search users"
          aria-label="Search users"
          wrapperClassName="mb-5"
          data-testid="admin-users-search"
        />
      )}
      {groups.length === 0 && <KitEmpty title="No matches" data-testid="admin-users-no-matches" />}
      {groups.map((g) => (
        <KitSettingsGroup key={g.title} title={`${g.title} · ${g.rows.length}`} data-testid={`admin-users-${g.title.toLowerCase()}`}>
          {g.rows.map((u) => (
            <KitSettingsRow
              key={u.id}
              data-testid={`admin-user-row-${u.id}`}
              leading={<KitAvatar src={userAvatarUrl(u.id, u.avatarPath)} fallback={userInitial(u.username)} size={34} />}
              label={u.username}
              description={u.mxid ? <span className="font-mono text-[12px]">{u.mxid}</span> : undefined}
              truncate
              value={
                [u.id === currentUserId ? "You" : null, oidcInUse && u.isOidc ? "OIDC" : null]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              onClick={() => onOpenUser(u.id)}
            />
          ))}
        </KitSettingsGroup>
      ))}
    </div>
  );
}
