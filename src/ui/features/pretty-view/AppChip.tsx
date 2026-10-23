// convo-scoped apps: an app link in a chat bubble, rendered as a chip — the
// app's icon and title, like a file chip. Click opens the app (same as a
// sidebar tile click); drag splits it into the view (desktop), carrying the
// same payload a sidebar tile drag does. Works for conversation apps and
// sidebar apps alike. An app the browser doesn't know (e.g. its conversation
// was archived) still renders as a chip, with a generic glyph and the slug.

import { useState, type DragEvent, type MouseEvent } from "react";
import { AppWindow } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { systemLogger } from "@/lib/frontend-logger";
import { useAppTiles } from "@/state/app-tiles-store";
import { appIconUrl } from "../pretty-conversations/app-icon-url";
import { APP_TILE_MIME, requestOpenApp, type AppAddress } from "../apps/app-link";

export interface AppChipProps {
  url: string;
  address: AppAddress;
  className?: string;
}

export function AppChip({ url, address, className }: AppChipProps) {
  const isMobile = useIsMobile();
  const app = useAppTiles().find(
    (a) => a.hostId === String(address.hostId) && a.slug === address.slug,
  );
  const [imgFailed, setImgFailed] = useState(false);
  const title = app?.title ?? address.slug;
  const showIcon = app?.hasIcon === true && !imgFailed;

  const handleOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    systemLogger.info("[app-chip] open", {
      operation: "app_chip_open",
      hostId: address.hostId,
      slug: address.slug,
      known: app !== undefined,
    });
    requestOpenApp({ hostId: address.hostId, slug: address.slug, title });
  };

  const handleDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.clearData();
    e.dataTransfer.setData(
      APP_TILE_MIME,
      JSON.stringify({ hostId: address.hostId, slug: address.slug, title }),
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <a
      href={url}
      onClick={handleOpen}
      {...(isMobile ? {} : { draggable: true, onDragStart: handleDragStart })}
      className={cn(
        "inline-flex max-w-full items-center gap-2 px-2.5 py-1.5",
        "rounded-lg border text-xs no-underline",
        "bg-[rgba(10,12,20,0.5)] border-white/10 text-[#e8e4d8]",
        "shadow-[inset_0_1px_0_rgba(220,225,245,0.05)]",
        "hover:bg-[rgba(20,24,34,0.65)] hover:border-white/[0.18]",
        "transition-[background-color,border-color] duration-[120ms]",
        "cursor-pointer [&_img]:[-webkit-user-drag:none]",
        className,
      )}
      title={app?.description ? `${title} — ${app.description}` : title}
      data-app-chip=""
      data-app-chip-known={app ? "true" : "false"}
    >
      {showIcon ? (
        <img
          src={appIconUrl(address.hostId, address.slug, app?.iconVersion)}
          alt=""
          className="size-5 shrink-0 rounded-[5px]"
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <AppWindow className="size-4 shrink-0 opacity-70" aria-hidden />
      )}
      <span
        className={cn(
          "max-w-[220px] truncate underline underline-offset-[3px]",
          "decoration-white/[0.35] hover:decoration-white/[0.85]",
        )}
      >
        {title}
      </span>
    </a>
  );
}
