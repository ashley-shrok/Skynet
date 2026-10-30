// SharedWithDraft — "Shared with" for something not made yet (a new scheduled
// task). Looks and ticks like SharedWithButton, but nothing is saved: the
// choice goes to the caller, who applies it on Create. Starts at everyone on
// the machine; null = everyone (no list). On a machine with one person it
// renders nothing.
//
// Shape: .planning/shape-sharing-apps-tasks.closed.md

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { KitButton, KitCheckbox, kitConfirm } from "@/components/kit";
import { getMachinePeople } from "@/api/sharing-api";
import { SharedWithField, sharedWithLabel } from "./SharedWithButton";

export interface SharedWithDraftProps {
  hostId: number;
  /** null = everyone on the machine. */
  value: string[] | null;
  onChange: (users: string[] | null) => void;
  hint?: string;
  disabled?: boolean;
  /** Shown as a form field labelled "Shared with". */
  field?: boolean;
}

export function SharedWithDraft({ hostId, value, onChange, hint, disabled, field = false }: SharedWithDraftProps) {
  const [machine, setMachine] = useState<{ you: string; people: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // While the take-yourself-off question is up, clicks on it aren't "outside".
  const askingRef = useRef(false);

  useEffect(() => {
    let live = true;
    setMachine(null);
    getMachinePeople(hostId).then(
      (p) => live && setMachine(p.multiUser ? { you: p.you, people: p.people } : null),
      (err: unknown) => {
        console.warn("[sharing] couldn't load the machine's people", {
          operation: "sharing_draft_people_failed",
          hostId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return () => {
      live = false;
    };
  }, [hostId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (askingRef.current) return;
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || askingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (machine === null) return null;

  const ticked = value ?? machine.people;
  const label = sharedWithLabel({
    multiUser: true,
    you: machine.you,
    people: machine.people,
    users: value,
    ticked,
    former: [],
    hiddenBy: {},
    instanceWide: false,
  });
  const people = [machine.you, ...machine.people.filter((u) => u !== machine.you).sort((a, b) => a.localeCompare(b))];

  const toggle = async (person: string, on: boolean) => {
    const next = on ? [...ticked, person] : ticked.filter((u) => u !== person);
    if (next.length === 0) return;
    if (!on && person === machine.you) {
      askingRef.current = true;
      try {
        const go = await kitConfirm({
          title: "Leave yourself off?",
          body: "Once it's created you won't see it in your scheduled tasks. Anyone it's shared with can add you back.",
          confirmLabel: "Leave me off",
          destructive: true,
        });
        if (!go) return;
      } finally {
        askingRef.current = false;
      }
    }
    // Everyone ticked stays a fixed list once someone has been unticked, the
    // same as on a thing that exists.
    onChange(next);
  };

  const control = (
    <div className="relative" ref={wrapRef}>
      <KitButton
        size="sm"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="max-w-[260px]"
        title={`Shared with: ${label}`}
        data-testid="shared-with-button"
      >
        <Users aria-hidden="true" />
        <span className="truncate">{label}</span>
      </KitButton>
      {open && (
        <div
          role="dialog"
          aria-label="Shared with"
          className="k-menu absolute left-0 top-[calc(100%+6px)] z-20 w-[300px] max-w-[calc(100vw-48px)] !p-3 flex flex-col gap-1"
          data-testid="shared-with-popover"
        >
          <div className="k-label">Shared with</div>
          {hint && <div className="text-[12.5px] text-[var(--k-t3)] pb-1">{hint}</div>}
          {people.map((person) => {
            const on = ticked.includes(person);
            const last = on && ticked.length === 1;
            return (
              <label
                key={person}
                className="flex items-center gap-2.5 cursor-pointer py-1"
                title={last ? "Someone has to be on the list" : undefined}
                data-testid={`shared-with-row-${person}`}
              >
                <KitCheckbox
                  checked={on}
                  disabled={disabled || last}
                  onCheckedChange={(v) => void toggle(person, v)}
                  aria-label={person === machine.you ? `${person} (you)` : person}
                />
                <span className="text-[var(--k-t1)]">
                  {person}
                  {person === machine.you && <span className="text-[var(--k-t3)]"> · you</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
  return field ? <SharedWithField>{control}</SharedWithField> : control;
}
