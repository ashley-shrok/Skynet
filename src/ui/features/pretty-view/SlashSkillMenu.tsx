import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SkillActionEntry } from "./skill-actions-store";
import { skillHue } from "./skill-match";

// Slash skill list (shape slash-skill-menu): the list that floats above the
// compose box while a skill name is being typed after a leading slash. Pure
// presentation — the compose box owns the query, the highlight and every key;
// the keyboard never leaves the compose box. Same family as the
// lightning-bolt menu: lettered tiles, slash names, two-line descriptions.
//
// Rows never take focus: a pointerdown is prevented so the compose box keeps
// the caret (and a phone keeps its keyboard up); the pick happens on click,
// which a swipe-to-scroll never produces.

// ~6 rows tall before it scrolls, never past the top of what's on screen.
const MAX_HEIGHT = 318;
const TOP_MARGIN = 8;
const GAP = 12;

const LIST_CLASS = cn(
  "absolute left-0 bottom-[calc(100%+12px)] z-30 overflow-y-auto overscroll-contain",
  "w-[360px] max-w-full py-1.5",
  "rounded-[16px] border border-[color:var(--k-hair2)] bg-[color:var(--k-menu)] text-[color:var(--k-t1)]",
  "shadow-[0_16px_40px_rgba(0,0,0,0.6)]",
);

const ROW_CLASS = cn(
  "grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-[11px] gap-y-px",
  "mx-1.5 px-2 py-[7px] rounded-[10px] cursor-pointer select-none",
);

export function SlashSkillMenu({
  id,
  skills,
  highlighted,
  touch,
  onHighlight,
  onPick,
}: {
  /** Element id, referenced by the compose box's aria-controls. */
  id: string;
  skills: SkillActionEntry[];
  highlighted: number;
  touch: boolean;
  onHighlight: (index: number) => void;
  onPick: (name: string) => void;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState(MAX_HEIGHT);
  // Last pointer position: a scroll can make the browser send a mousemove
  // without the pointer moving, which must not steal the keyboard highlight.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Fit between the top of the visible area and the compose box. The visual
  // viewport shrinks for a phone's on-screen keyboard; the layout one doesn't.
  useLayoutEffect(() => {
    const anchor = listRef.current?.parentElement;
    if (!anchor || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const fit = () => {
      const visibleTop = vv ? vv.offsetTop : 0;
      const room = anchor.getBoundingClientRect().top - GAP - visibleTop - TOP_MARGIN;
      setMaxHeight(Math.max(96, Math.min(MAX_HEIGHT, Math.floor(room))));
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    // JSDOM has no scrollIntoView.
    row?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Skills"
      data-testid="slash-skill-menu"
      className={cn(LIST_CLASS, touch && "w-full")}
      style={{ maxHeight }}
    >
      {skills.map((skill, i) => {
        const hue = skillHue(skill.name);
        const active = i === highlighted;
        return (
          <div
            key={skill.name}
            id={`${id}-${i}`}
            role="option"
            aria-selected={active}
            data-index={i}
            data-testid={`slash-skill-item-${skill.name}`}
            className={cn(ROW_CLASS, touch && "py-[9px]", active && "bg-[hsl(220,62%,52%)] text-white")}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={(e) => {
              const last = lastPointerRef.current;
              lastPointerRef.current = { x: e.clientX, y: e.clientY };
              if (last && last.x === e.clientX && last.y === e.clientY) return;
              if (!active) onHighlight(i);
            }}
            onClick={() => onPick(skill.name)}
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
            <span className="text-[13.5px] font-semibold truncate">/{skill.name}</span>
            {skill.description ? (
              <span
                className={cn(
                  "text-[12px] leading-snug line-clamp-2",
                  active ? "text-white/85" : "text-[color:var(--k-t2)]",
                )}
                title={skill.description}
              >
                {skill.description}
              </span>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}
