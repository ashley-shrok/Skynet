import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { cn } from "@/lib/utils";
import { refreshSkillActions, useSkillActions, type SkillActionEntry } from "./skill-actions-store";

// Skill-actions menu (campaign skill-actions, shape skill-action-menu): the
// lightning-bolt aux button left of ThumbsUp. Opens a flat alphabetical list
// of the host's skills (the Skills editor's set, minus agent-only skills —
// `user-invocable: false`, which the harness won't run from `/<name>`); picking one fires it at
// once as `/<name>` through the same quick-send path ThumbsUp uses. Hidden
// until the host is known to have at least one skill. Deliberately no
// curation, grouping, search, or arguments in v1.

const CONTENT_CLASS = cn(
  // Phone: nearly full-width (12px gutters, matching collisionPadding).
  "w-[320px] max-md:w-[calc(100vw-24px)] max-w-[calc(100vw-24px)] min-w-0 p-0 py-1.5",
  "max-h-[min(70vh,560px,var(--radix-dropdown-menu-content-available-height))]",
  "rounded-[14px] border border-[hsla(218,30%,60%,0.25)]",
  "bg-[linear-gradient(180deg,hsl(218_22%_17%),hsl(218_22%_12%))] text-[#e6e8ef]",
  "shadow-[0_18px_50px_rgba(0,0,0,0.6)]",
);

// Name/description colors carry `!` so the shared item's focus rule (which
// recolors every descendant) can't flatten them on the focused row.
const ITEM_CLASS = cn(
  "block cursor-pointer rounded-none px-3.5 py-[7px] max-md:py-2.5",
  "focus:bg-[hsla(218,40%,60%,0.14)] focus:text-inherit",
);

export function SkillActionsButton({
  hostId,
  enabled,
  disabled,
  onFire,
  buttonClassName,
}: {
  hostId: number;
  /** false in relay panes — no prefetch, never shown. */
  enabled: boolean;
  disabled: boolean;
  onFire: (skillName: string) => void;
  buttonClassName?: string;
}): React.JSX.Element | null {
  const skills = useSkillActions(hostId, enabled);
  // While open, the menu shows the list as it was at open time: the
  // background refresh must not reorder rows under the user's finger (a tap
  // fires immediately). A changed list shows on the next open.
  const [openList, setOpenList] = useState<SkillActionEntry[] | null>(null);

  // Becoming disabled (reset / reconnect / aside) closes an open menu so a
  // skill can't fire through a gate the thumbs-up respects.
  useEffect(() => {
    if (disabled) setOpenList(null);
  }, [disabled]);

  if (!enabled || skills === null || skills.length === 0) return null;
  const shown = openList ?? skills;

  return (
    <DropdownMenu
      modal={false}
      open={openList !== null}
      onOpenChange={(open) => {
        if (!open) {
          setOpenList(null);
          return;
        }
        if (disabled) return;
        setOpenList(skills);
        console.info(`[skill-actions] menu-open hostId=${hostId} count=${skills.length}`);
        void refreshSkillActions(hostId, "menu-open");
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          size="icon-sm"
          variant="secondary"
          disabled={disabled}
          aria-label="Skills"
          title="Skills"
          data-testid="skill-actions-button"
          className={buttonClassName}
        >
          <Zap className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={CONTENT_CLASS}
        data-testid="skill-actions-menu"
      >
        {shown.map((skill) => (
          <DropdownMenuItem
            key={skill.name}
            textValue={skill.name}
            className={ITEM_CLASS}
            data-testid={`skill-actions-item-${skill.name}`}
            onSelect={() => {
              console.info(`[skill-actions] fire hostId=${hostId} skill=${skill.name}`);
              onFire(skill.name);
            }}
          >
            <div className="text-[13px] max-md:text-[14px] font-semibold text-[#f1f2f6]!">/{skill.name}</div>
            {skill.description && (
              <div
                className="truncate text-[11.5px] max-md:text-[12.5px] leading-snug text-[#9aa0b2]!"
                title={skill.description}
              >
                {skill.description}
              </div>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
