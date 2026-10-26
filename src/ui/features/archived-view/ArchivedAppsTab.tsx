// The Apps tab of an archived agent's view-only window: its conversation apps,
// read from the archived folder. They aren't running, so rows don't open and
// carry no menu.

import { useState } from "react";
import { AppWindow } from "lucide-react";
import { KitSettingsGroup, KitSettingsRow } from "@/components/kit";
import type { ArchivedConversationApp } from "@/api/claude-session-api";

export const ARCHIVED_APPS_NOTE = "This agent is archived, so its apps aren't running. Un-archive it to use them again.";

export function ArchivedAppsTab({ apps }: { apps: ArchivedConversationApp[] }) {
  return (
    <KitSettingsGroup note={ARCHIVED_APPS_NOTE} data-testid="identity-apps-tab">
      {apps.map((app) => (
        <ArchivedAppRow key={app.slug} app={app} />
      ))}
    </KitSettingsGroup>
  );
}

function ArchivedAppRow({ app }: { app: ArchivedConversationApp }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <KitSettingsRow
      data-testid="identity-apps-row"
      leading={
        app.iconDataUrl && !imgFailed ? (
          <img
            src={app.iconDataUrl}
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
      chevron={false}
    />
  );
}
