// RolePickList — the new-conversation dialog's roles, as a list in the
// dialog itself (apple-ux shape-creation-and-search-dialogs) instead of a
// drop-down.
//
// One group per machine (titled only when there are several), each starting
// with "No roles", then that machine's roles: picture, name, the role's
// one-line description, a check when picked. Several roles can be picked;
// what picking means (No roles is exclusive, a role from another machine
// moves the agent there) is the caller's — this only reports the next list
// of picked values. A search box appears once there are more than eight
// roles; "New role…" sits at the bottom.

import { useMemo, useState } from "react";
import { Check, CircleDashed, Plus } from "lucide-react";
import {
  KitAvatar,
  KitEmpty,
  KitLoading,
  KitSearch,
  KitSettingsGroup,
  KitSettingsRow,
} from "@/components/kit";

export interface RolePickItem {
  value: string;
  label: string;
  description?: string;
  avatarSrc?: string | null;
  /** The "No roles" entry of its machine. */
  noRoles?: boolean;
}

export interface RolePickGroup {
  key: string;
  /** Shown only when there is more than one group. */
  title: string;
  items: RolePickItem[];
}

/** More roles than this and the list gets a search box. */
const SEARCH_FROM = 8;

export function RolePickList({
  groups,
  value,
  onChange,
  onNewRole,
  loading,
  disabled,
}: {
  groups: RolePickGroup[];
  value: string[];
  onChange: (next: string[]) => void;
  onNewRole?: () => void;
  /** Roles are still arriving and nothing is listed yet. */
  loading?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const roleCount = groups.reduce((n, g) => n + g.items.filter((i) => !i.noRoles).length, 0);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          if (i.noRoles) return false;
          const hay = `${i.label} ${i.description ?? ""} ${g.title}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const toggle = (v: string): void => {
    if (disabled) return;
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <div className="flex flex-col gap-3 min-w-0" data-testid="role-pick-list">
      {roleCount > SEARCH_FROM && (
        <KitSearch
          value={query}
          onValueChange={setQuery}
          placeholder="Search roles"
          aria-label="Search roles"
          disabled={disabled}
          data-testid="role-pick-search"
        />
      )}
      <div className="max-h-[min(46vh,360px)] overflow-y-auto overscroll-contain -mx-1 px-1">
        {loading ? (
          <KitLoading label="Loading roles…" />
        ) : shown.length === 0 ? (
          <KitEmpty title="No matching roles" data-testid="role-pick-no-matches" />
        ) : (
          shown.map((g) => (
            <KitSettingsGroup key={g.key} title={groups.length > 1 ? g.title : undefined} data-testid={`role-pick-group-${g.key}`}>
              {g.items.map((i) => {
                const picked = value.includes(i.value);
                return (
                  <KitSettingsRow
                    key={i.value}
                    data-testid={`role-pick-${i.value}`}
                    leading={
                      i.noRoles ? (
                        <span className="size-[34px] rounded-full grid place-items-center text-[var(--k-t3)] shrink-0">
                          <CircleDashed className="size-5" aria-hidden="true" />
                        </span>
                      ) : (
                        <KitAvatar src={i.avatarSrc} fallback={i.label.charAt(0).toUpperCase()} size={34} />
                      )
                    }
                    label={<span className={picked ? "text-[var(--k-acc-text)]" : undefined}>{i.label}</span>}
                    description={i.noRoles ? "A plain agent — give it roles later if you like." : i.description || undefined}
                    truncate
                    chevron={false}
                    disabled={disabled}
                    onClick={() => toggle(i.value)}
                    control={
                      picked ? (
                        <Check className="size-[18px] text-[var(--k-acc-text)] shrink-0" aria-label="Picked" />
                      ) : (
                        <span className="size-[18px] shrink-0" aria-hidden="true" />
                      )
                    }
                  />
                );
              })}
            </KitSettingsGroup>
          ))
        )}
        {onNewRole && (
          <KitSettingsGroup className="mt-[22px]">
            <KitSettingsRow
              tone="accent"
              chevron={false}
              leading={
                <span className="size-[34px] rounded-full grid place-items-center shrink-0">
                  <Plus className="size-5" aria-hidden="true" />
                </span>
              }
              label="New role…"
              disabled={disabled}
              onClick={onNewRole}
              data-testid="role-pick-new-role"
            />
          </KitSettingsGroup>
        )}
      </div>
    </div>
  );
}
