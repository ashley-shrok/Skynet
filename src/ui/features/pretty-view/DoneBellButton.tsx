import { useEffect, useState } from "react";
import { Bell, Phone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { cn } from "@/lib/utils";
import { maybeAskBrowserNotifications, refreshDoneBellReach, useDoneBellReach } from "./done-bell-reach";

// done-bell (campaign notify-when-done, shape done-bell): the composer's main
// button while the agent is working and nothing is typed. Opens a two-row menu
// — Notify me / Call me — and picking one sends the notify-me / call-me skill
// through the same quick-send path as the Skills menu. Nothing is tracked
// beyond that sent message: the agent reads it when its turn ends and reaches
// the user when the work is done or it needs them.
//
// Call me only when a phone number is on file. Notify me asks the browser's
// permission first when nothing outside the app reaches the user (see
// done-bell-reach). Opened by pointer no row is highlighted; from the keyboard
// the first row takes focus (the menu primitive does both).

// Same pop-over look as the Skills menu, narrower — two short rows.
const CONTENT_CLASS = cn(
  "w-[300px] max-w-[calc(100vw-16px)] min-w-0 py-1.5",
  "rounded-[16px] border border-[color:var(--k-hair2)] bg-[color:var(--k-menu)] text-[color:var(--k-t1)]",
  "shadow-[0_16px_40px_rgba(0,0,0,0.6)]",
);

const ITEM_CLASS = cn(
  "grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-[11px] gap-y-px",
  "mx-1.5 px-2 py-[7px] max-md:py-[9px] rounded-[10px] cursor-pointer",
  "focus:bg-[hsl(220,62%,52%)] focus:text-white data-[highlighted]:bg-[hsl(220,62%,52%)]",
);

const TILE_CLASS = cn(
  "row-span-2 grid place-items-center size-[30px] rounded-[8px]",
  "bg-[#2a2c33] text-[color:var(--k-t2)]",
  "group-focus/dropdown-menu-item:bg-white/20 group-focus/dropdown-menu-item:text-white!",
);

const HINT = "When it's done or needs you";

export type DoneBellChoice = "notify-me" | "call-me";

export function DoneBellButton({
  hostId,
  disabled,
  onChoose,
  buttonClassName,
}: {
  hostId: number;
  disabled: boolean;
  /** Sends the chosen skill (`/<choice>`). */
  onChoose: (choice: DoneBellChoice) => void;
  buttonClassName?: string;
}): React.JSX.Element {
  const reach = useDoneBellReach();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (choice: DoneBellChoice) => {
    const asked = choice === "notify-me" ? maybeAskBrowserNotifications() : false;
    console.info(`[done-bell] choose hostId=${hostId} choice=${choice} askedBrowser=${asked}`);
    onChoose(choice);
  };

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next && disabled) return;
        setOpen(next);
        if (next) {
          console.info(`[done-bell] menu-open hostId=${hostId} hasPhone=${reach.hasPhone}`);
          void refreshDoneBellReach("menu-open");
        }
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={buttonClassName}
          data-main="true"
          data-action="bell"
          disabled={disabled}
          aria-label="Notify or call me when it's done"
          title="Notify or call me when it's done"
          data-testid="done-bell-button"
        >
          <Bell aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={CONTENT_CLASS}
        data-testid="done-bell-menu"
      >
        <DropdownMenuItem
          textValue="Notify me"
          className={ITEM_CLASS}
          data-testid="done-bell-notify"
          onSelect={() => choose("notify-me")}
        >
          <span aria-hidden="true" className={TILE_CLASS}>
            <Bell className="size-[16px]" />
          </span>
          <span className="text-[13.5px] font-semibold truncate group-focus/dropdown-menu-item:text-white!">Notify me</span>
          <span className="text-[12px] leading-snug text-[color:var(--k-t2)] group-focus/dropdown-menu-item:text-white/85!">{HINT}</span>
        </DropdownMenuItem>
        {reach.hasPhone && (
          <DropdownMenuItem
            textValue="Call me"
            className={ITEM_CLASS}
            data-testid="done-bell-call"
            onSelect={() => choose("call-me")}
          >
            <span aria-hidden="true" className={TILE_CLASS}>
              <Phone className="size-[16px]" />
            </span>
            <span className="text-[13.5px] font-semibold truncate group-focus/dropdown-menu-item:text-white!">Call me</span>
            <span className="text-[12px] leading-snug text-[color:var(--k-t2)] group-focus/dropdown-menu-item:text-white/85!">{HINT}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
