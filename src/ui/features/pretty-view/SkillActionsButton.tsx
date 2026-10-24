import { useEffect, useRef, useState } from "react";
import { Search, Zap } from "lucide-react";
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
// until the host is known to have at least one skill. No curation,
// grouping, or arguments.

// Kit pop-over (shape-conversation-view): a search field on top, a lettered
// tile in each skill's own steady colour, two-line descriptions.
const CONTENT_CLASS = cn(
  "w-[360px] max-md:w-[calc(100vw-24px)] max-w-[calc(100vw-16px)] min-w-0 p-0 pb-1.5",
  "max-h-[min(62vh,460px,var(--radix-dropdown-menu-content-available-height))]",
  "rounded-[16px] border border-[color:var(--k-hair2)] bg-[color:var(--k-menu)] text-[color:var(--k-t1)]",
  "shadow-[0_16px_40px_rgba(0,0,0,0.6)] [scroll-padding-top:56px]",
);

const ITEM_CLASS = cn(
  "grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-[11px] gap-y-px",
  "mx-1.5 px-2 py-[7px] max-md:py-[9px] rounded-[10px] cursor-pointer",
  "focus:bg-[hsl(220,62%,52%)] focus:text-white data-[highlighted]:bg-[hsl(220,62%,52%)]",
);

/** A skill's steady tile colour, from its name. */
function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

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
  const [openList, setOpenList] = useState<SkillActionEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const open = openList !== null;

  useEffect(() => {
    if (disabled) setOpenList(null);
  }, [disabled]);

  // The search field takes the keyboard once the menu has settled (the menu
  // focuses itself on open). Not on touch screens — it would pop the keyboard.
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
    const ids = [60, 160].map((ms) => window.setTimeout(() => searchRef.current?.focus(), ms));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [open]);

  if (!enabled || skills === null || skills.length === 0) return null;
  const all = openList ?? skills;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? all.filter((s) => {
        const hay = `${s.name} ${s.description ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
    : all;

  const fire = (name: string) => {
    console.info(`[skill-actions] fire hostId=${hostId} skill=${name}`);
    onFire(name);
  };

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setOpenList(null);
          setQuery("");
          return;
        }
        if (disabled) return;
        setOpenList(skills);
        console.info(`[skill-actions] menu-open hostId=${hostId} count=${skills.length}`);
        void refreshSkillActions(hostId, "menu-open");
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          aria-label="Skills"
          title="Skills"
          data-testid="skill-actions-button"
          className={buttonClassName}
        >
          <Zap aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={CONTENT_CLASS}
        data-testid="skill-actions-menu"
      >
        <div className="sticky top-0 z-[2] px-2.5 pt-2.5 pb-2 mb-1 bg-[color:var(--k-menu)] border-b border-[color:var(--k-hair)]">
          <label className="flex items-center gap-2 h-[34px] px-2.5 rounded-[10px] bg-[#2a2c33] text-[color:var(--k-t3)] focus-within:shadow-[0_0_0_2px_hsla(220,62%,52%,0.6)]">
            <Search className="size-[15px] shrink-0" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${all.length} skills`}
              aria-label="Search skills"
              data-testid="skill-actions-search"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-[color:var(--k-t1)] placeholder:text-[color:var(--k-t3)]"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                  return;
                }
                if (e.key === "Enter") {
                  // Mid-composition Enter picks the IME's candidate, not a skill.
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  // Only a typed search picks its top match — a reflex Enter
                  // on an opened menu sends nothing.
                  if (query.trim() !== "" && shown[0]) {
                    fire(shown[0].name);
                    setOpenList(null);
                    setQuery("");
                  }
                  return;
                }
                // Keep the menu's own type-to-jump from taking the keys.
                if (e.key !== "Escape") e.stopPropagation();
              }}
            />
          </label>
        </div>
        {shown.length === 0 && (
          <div className="px-3.5 py-4 text-center text-[13px] text-[color:var(--k-t3)]">No skills match</div>
        )}
        {shown.map((skill) => {
          const hue = hueOf(skill.name);
          return (
            <DropdownMenuItem
              key={skill.name}
              textValue={skill.name}
              className={ITEM_CLASS}
              data-testid={`skill-actions-item-${skill.name}`}
              onSelect={() => fire(skill.name)}
            >
              <span
                aria-hidden="true"
                className="row-span-2 grid place-items-center size-[30px] rounded-[8px] text-[13px] font-bold uppercase"
                style={{
                  color: `hsl(${hue}, 70%, 82%)`,
                  background: `hsl(${hue}, 30%, 26%)`,
                  boxShadow: `inset 0 0 0 1px hsla(${hue}, 50%, 70%, 0.2)`,
                }}
              >
                {skill.name.slice(0, 1)}
              </span>
              <span className="text-[13.5px] font-semibold truncate group-focus/dropdown-menu-item:text-white!">/{skill.name}</span>
              {skill.description ? (
                <span
                  className="text-[12px] leading-snug text-[color:var(--k-t2)] group-focus/dropdown-menu-item:text-white/85! line-clamp-2"
                  title={skill.description}
                >
                  {skill.description}
                </span>
              ) : (
                <span />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
