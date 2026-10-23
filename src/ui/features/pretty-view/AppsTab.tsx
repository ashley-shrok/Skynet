// convo-scoped apps: the identity modal's Apps tab — the conversation's own
// apps, so they can be found again after their chip has scrolled away.
// Clicking a row closes the modal and opens the app (same as a sidebar tile
// click). Each row's ⋮ holds one item: Move to sidebar, which asks the agent
// to move the app. No drag, no rename, no archive (the app goes with the
// conversation).

import { useState } from "react";
import { AppWindow } from "lucide-react";
import type { AppState } from "@/api/fleet-status-types";
import { KitSettingsGroup, KitSettingsRow } from "@/components/kit";
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
    <KitSettingsGroup data-testid="identity-apps-tab">
      {apps.map((app) => (
        <AppsTabRow key={`${app.hostId}/${app.slug}`} app={app} onClose={onClose} />
      ))}
    </KitSettingsGroup>
  );
}

function AppsTabRow({ app, onClose }: { app: AppState; onClose: () => void }) {
  usePromoteRequestsVersion();
  const [imgFailed, setImgFailed] = useState(false);
  const open = () => {
    onClose();
    requestOpenApp({ hostId: Number(app.hostId), slug: app.slug, title: app.title });
  };
  const menu = buildAppMenuItems({ hostId: app.hostId, slug: app.slug, title: app.title });
  return (
    <KitSettingsRow
      data-testid="identity-apps-row"
      leading={
        app.hasIcon && !imgFailed ? (
          <img
            src={appIconUrl(app.hostId, app.slug, app.iconVersion)}
            alt=""
            className="size-[34px] shrink-0 rounded-[9px]"
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="size-[34px] shrink-0 rounded-[9px] bg-[var(--k-s3)] grid place-items-center text-[var(--k-t2)]">
            <AppWindow className="size-4" aria-hidden />
          </span>
        )
      }
      label={<span className="font-semibold">{app.title}</span>}
      description={app.description || undefined}
      truncate
      openLabel={`Open ${app.title}`}
      onClick={open}
      chevron={false}
      control={
        <RowKebabMenu ariaLabel={`${app.title} menu`} testId="identity-apps-row-kebab" items={[menu.moveToSidebar]} />
      }
    />
  );
}
