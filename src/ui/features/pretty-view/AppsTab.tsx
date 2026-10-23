// convo-scoped apps: the identity modal's Apps tab — the conversation's own
// apps, so they can be found again after their chip has scrolled away.
// Clicking a row closes the modal and opens the app (same as a sidebar tile
// click). Each row's ⋮ holds one item: Move to sidebar, which asks the agent
// to move the app. No drag, no rename, no archive (the app goes with the
// conversation).

import { useState, type KeyboardEvent } from "react";
import { AppWindow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppState } from "@/api/fleet-status-types";
import { usePromoteRequestsVersion } from "@/state/app-promote-requests";
import { appIconUrl } from "../pretty-conversations/app-icon-url";
import { buildAppMenuItems } from "../pretty-conversations/app-menu-items";
import { RowKebabMenu } from "../pretty-conversations/RowKebabMenu";
import { requestOpenApp } from "../apps/app-link";

/** The apps owned by one identity on one host, in the store's sort order. */
export function conversationAppsFor(
  apps: AppState[],
  hostId: number,
  identityKey: string | null | undefined,
): AppState[] {
  if (!identityKey) return [];
  const key = identityKey.toLowerCase();
  return apps.filter((a) => a.hostId === String(hostId) && a.owner?.toLowerCase() === key);
}

export interface AppsTabProps {
  apps: AppState[];
  /** Close the identity modal (before the app opens behind it). */
  onClose: () => void;
}

export function AppsTab({ apps, onClose }: AppsTabProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3" data-testid="identity-apps-tab">
      <ul className="flex flex-col gap-1.5">
        {apps.map((app) => (
          <AppsTabRow key={`${app.hostId}/${app.slug}`} app={app} onClose={onClose} />
        ))}
      </ul>
    </div>
  );
}

function AppsTabRow({ app, onClose }: { app: AppState; onClose: () => void }) {
  usePromoteRequestsVersion();
  const [imgFailed, setImgFailed] = useState(false);
  const open = () => {
    onClose();
    requestOpenApp({ hostId: Number(app.hostId), slug: app.slug, title: app.title });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  const menu = buildAppMenuItems({ hostId: app.hostId, slug: app.slug, title: app.title });
  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2",
        "bg-black/20 border border-white/10 hover:bg-black/30 hover:border-white/[0.18]",
      )}
      data-testid="identity-apps-row"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={onKeyDown}
        className="flex flex-1 min-w-0 items-center gap-3 cursor-pointer"
        aria-label={`Open ${app.title}`}
      >
        {app.hasIcon && !imgFailed ? (
          <img
            src={appIconUrl(app.hostId, app.slug, app.iconVersion)}
            alt=""
            className="size-8 shrink-0 rounded-[8px]"
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="size-8 shrink-0 rounded-[8px] bg-white/[0.06] flex items-center justify-center">
            <AppWindow className="size-4 opacity-70" aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-[#e8e4d8]">{app.title}</span>
          {app.description ? (
            <span className="truncate text-[12px] text-[#e8e4d8]/60">{app.description}</span>
          ) : null}
        </span>
      </div>
      <RowKebabMenu
        ariaLabel={`${app.title} menu`}
        testId="identity-apps-row-kebab"
        items={[menu.moveToSidebar]}
      />
    </li>
  );
}
