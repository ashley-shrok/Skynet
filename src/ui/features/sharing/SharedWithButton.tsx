// SharedWithButton — "Shared with" for an agent, role or project on a machine
// more than one person uses. The button names who can see the thing; it opens
// a ticked list of everyone on the machine. A tick takes effect straight
// away; a confirm comes first only where the change reaches further than the
// thing itself (sharing its role too, a project's contents, a role's agents,
// taking yourself off). On a machine with one person it renders nothing.
//
// Shape: .planning/shape-sharing-agents-roles-projects.md

import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { KitButton, KitCheckbox, kitConfirm } from "@/components/kit";
import {
  applySharing,
  getSharing,
  planSharing,
  type ShareKind,
  type SharePlanSummary,
  type ShareState,
} from "@/api/sharing-api";

type Loaded = Extract<ShareState, { multiUser: true }>;

export interface SharedWithButtonProps {
  hostId: number;
  kind: ShareKind;
  /** Agent name, role name or project slug. */
  slug: string;
  /** How confirms name the thing: "Scout", "the Painter role", "Garden". */
  itemLabel: string;
  /** One line under the list's title. */
  hint?: string;
  disabled?: boolean;
  /** The caller took themselves off — the thing has left their view. */
  onGone?: () => void;
  className?: string;
}

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The button's words for who can see it. */
export function sharedWithLabel(s: Loaded): string {
  const onMachine = s.ticked.filter((u) => s.people.includes(u));
  if (s.users === null && onMachine.length === s.people.length) return "Everyone on this machine";
  const others = onMachine.filter((u) => u !== s.you);
  const names = onMachine.includes(s.you) ? ["You", ...others] : others;
  if (names.length === 0) return "Nobody on this machine";
  if (names.length === 1) return names[0] === "You" ? "Only you" : names[0];
  if (names.length <= 3) return joinAnd(names);
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "the Prints sub-project, 2 agents (A and B), the Painter role and 1 more you can't see". */
export function describeReach(reach: { projects: string[]; agents: string[]; roles?: string[]; hidden?: number }): string {
  const parts: string[] = [];
  if (reach.projects.length === 1) parts.push(`the ${reach.projects[0]} sub-project`);
  else if (reach.projects.length > 1) {
    parts.push(`${count(reach.projects.length, "sub-project", "sub-projects")} (${joinAnd(reach.projects)})`);
  }
  if (reach.agents.length === 1) parts.push(reach.agents[0]);
  else if (reach.agents.length > 1) {
    parts.push(`${count(reach.agents.length, "agent", "agents")} (${joinAnd(reach.agents)})`);
  }
  const roles = reach.roles ?? [];
  if (roles.length === 1) parts.push(`the ${roles[0]} role`);
  else if (roles.length > 1) parts.push(`the ${joinAnd(roles)} roles`);
  const hidden = reach.hidden ?? 0;
  if (hidden > 0) parts.push(parts.length > 0 ? `${hidden} more you can't see` : `${count(hidden, "thing", "things")} you can't see`);
  return joinAnd(parts);
}

const hasReach = (r: { projects: string[]; agents: string[]; roles?: string[]; hidden?: number }) =>
  r.projects.length + r.agents.length + (r.roles?.length ?? 0) + (r.hidden ?? 0) > 0;

function keptLine(plan: SharePlanSummary): string {
  const lines = plan.keptShared.map(
    (k) => `${k.agent} stays shared with ${joinAnd(k.people)}, since nobody else is on its list, and shows in their Conversations.`,
  );
  if (plan.keptHidden > 0) {
    lines.push(
      `${count(plan.keptHidden, "agent you can't see stays", "agents you can't see stay")} shared with them for the same reason.`,
    );
  }
  return lines.join(" ");
}

/**
 * The confirm a change needs, or null when it can go straight through.
 * Resolves to { go, shareRoles }.
 */
async function confirmChange(
  kind: ShareKind,
  itemLabel: string,
  person: string,
  you: string,
  adding: boolean,
  plan: SharePlanSummary,
): Promise<{ go: boolean; shareRoles: boolean }> {
  if (adding) {
    if (kind === "agent" && plan.rolesToShare.length > 0) {
      const roles = plan.rolesToShare.map((r) => r.label);
      const go = await kitConfirm({
        title: `Share the ${joinAnd(roles)} ${roles.length === 1 ? "role" : "roles"} with ${person} too?`,
        body: `${itemLabel} shows up only for people who can see its ${roles.length === 1 ? "role" : "roles"}. Sharing just the agent won't make it show up for ${person}.`,
        confirmLabel: "Share both",
      });
      return { go, shareRoles: go };
    }
    if (kind === "project" && hasReach(plan.alsoShared)) {
      const go = await kitConfirm({
        title: `Share ${itemLabel} with ${person}?`,
        body: `It also shares ${describeReach(plan.alsoShared)} with ${person}.`,
        confirmLabel: "Share",
      });
      return { go, shareRoles: false };
    }
    return { go: true, shareRoles: false };
  }

  const reachLine =
    kind === "project" && hasReach(plan.alsoUnshared) ? describeReach(plan.alsoUnshared) : "";
  const kept = kind === "project" ? keptLine(plan) : "";
  const goneCount = plan.disappearing.length + plan.disappearingHidden;
  const gone =
    kind === "role" && goneCount > 0
      ? joinAnd([
          ...plan.disappearing,
          ...(plan.disappearingHidden > 0
            ? [plan.disappearing.length > 0 ? `${plan.disappearingHidden} more you can't see` : count(plan.disappearingHidden, "agent you can't see", "agents you can't see")]
            : []),
        ])
      : "";

  if (person === you) {
    const extra = [
      reachLine ? `It also takes you off ${reachLine}.` : "",
      gone ? `${gone} ${goneCount === 1 ? "disappears" : "disappear"} for you too.` : "",
      kept,
    ]
      .filter(Boolean)
      .join(" ");
    const go = await kitConfirm({
      title: `Take yourself off ${itemLabel}?`,
      body: `It leaves your sidebar right away.${extra ? ` ${extra}` : ""} Anyone it's still shared with can add you back.`,
      confirmLabel: "Take me off",
      destructive: true,
    });
    return { go, shareRoles: false };
  }
  if (reachLine || kept) {
    const go = await kitConfirm({
      title: `Stop sharing ${itemLabel} with ${person}?`,
      body: [reachLine ? `It also stops sharing ${reachLine} with ${person}.` : "", kept].filter(Boolean).join(" "),
      confirmLabel: "Stop sharing",
      destructive: true,
    });
    return { go, shareRoles: false };
  }
  if (gone) {
    const go = await kitConfirm({
      title: `Stop sharing ${itemLabel} with ${person}?`,
      body: `${gone} ${goneCount === 1 ? "disappears" : "disappear"} for ${person}, since agents with this role show up only for people it's shared with.`,
      confirmLabel: "Stop sharing",
      destructive: true,
    });
    return { go, shareRoles: false };
  }
  return { go: true, shareRoles: false };
}

export function SharedWithButton({
  hostId,
  kind,
  slug,
  itemLabel,
  hint,
  disabled,
  onGone,
  className,
}: SharedWithButtonProps) {
  const [state, setState] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy !== null;

  const load = useCallback(async () => {
    try {
      const next = await getSharing({ hostId, kind, slug });
      setState(next.multiUser ? next : null);
    } catch (err) {
      console.warn("[sharing] load failed", {
        operation: "sharing_load_failed",
        hostId,
        kind,
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
      setState(null);
    }
  }, [hostId, kind, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening re-reads, so a list changed elsewhere is current.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Click outside closes — not while a change (and its confirm) is in hand.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (busyRef.current) return;
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Esc closes the list before it reaches the window around it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || busyRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const change = useCallback(
    async (person: string, opts: { adding: boolean; shareRolesFor?: string[] }) => {
      if (!state) return;
      const target = { hostId, kind, slug };
      const delta = opts.shareRolesFor ? {} : opts.adding ? { add: [person] } : { remove: [person] };
      setBusy(person);
      setError(null);
      try {
        let shareRoles = false;
        if (!opts.shareRolesFor) {
          const plan = await planSharing(target, delta);
          const answer = await confirmChange(kind, itemLabel, person, state.you, opts.adding, plan);
          if (!answer.go) return;
          shareRoles = answer.shareRoles;
        }
        const res = await applySharing(target, {
          ...delta,
          shareRoles,
          ...(opts.shareRolesFor ? { shareRolesFor: opts.shareRolesFor } : {}),
        });
        console.info("[sharing] changed", {
          operation: "sharing_changed",
          hostId,
          kind,
          slug,
          adding: opts.adding,
          self: person === state.you,
          shareRoles,
          fixRoles: opts.shareRolesFor !== undefined,
        });
        if ("gone" in res) {
          setOpen(false);
          onGone?.();
          return;
        }
        setState(res.multiUser ? res : null);
      } catch (err) {
        console.warn("[sharing] change failed", {
          operation: "sharing_change_failed",
          hostId,
          kind,
          slug,
          error: err instanceof Error ? err.message : String(err),
        });
        setError("Couldn't change who it's shared with. Try again.");
        // Part of a change may have landed — show the list as it is now.
        void load();
      } finally {
        setBusy(null);
      }
    },
    [state, hostId, kind, slug, itemLabel, onGone, load],
  );

  if (state === null) return null;

  const ticked = (u: string) => state.ticked.includes(u);
  const tickedCount = state.ticked.length;
  const people = [state.you, ...state.people.filter((u) => u !== state.you).sort((a, b) => a.localeCompare(b))].filter(
    (u) => state.people.includes(u),
  );

  const toggle = (person: string, on: boolean) => void change(person, { adding: on });

  const row = (person: string, former: boolean) => {
    const on = ticked(person);
    const last = on && tickedCount === 1;
    const hidden = !former && on ? (state.hiddenBy[person] ?? []) : [];
    const fixable = hidden.filter((r) => r.fixable);
    const hiderKind = hidden[0]?.kind === "project" ? "project" : "role";
    return (
      <div key={person} className="flex flex-col gap-0.5 py-1" data-testid={`shared-with-row-${person}`}>
        <label
          className="flex items-center gap-2.5 cursor-pointer"
          title={last ? "Someone has to be on the list" : undefined}
        >
          <KitCheckbox
            checked={on}
            disabled={disabled || busy !== null || last}
            onCheckedChange={(v) => toggle(person, v)}
            aria-label={person === state.you ? `${person} (you)` : person}
          />
          <span className={former ? "text-[var(--k-t3)]" : "text-[var(--k-t1)]"}>
            {person}
            {person === state.you && <span className="text-[var(--k-t3)]"> · you</span>}
          </span>
        </label>
        {former && <div className="pl-7 text-[12px] text-[var(--k-t3)]">No longer on this machine</div>}
        {hidden.length > 0 && (
          <div className="pl-7 flex flex-wrap items-center gap-2 text-[12px] text-[var(--k-warn)]">
            <span>
              Hidden by the {joinAnd(hidden.map((r) => r.label))} {hidden.length === 1 ? hiderKind : `${hiderKind}s`}
            </span>
            {fixable.length > 0 && (
              <KitButton
                size="sm"
                disabled={disabled || busy !== null}
                onClick={() => void change(person, { adding: false, shareRolesFor: [person] })}
                data-testid={`shared-with-share-role-${person}`}
              >
                Share role
              </KitButton>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("relative", className)} ref={wrapRef}>
      <KitButton
        size="sm"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="max-w-[260px]"
        title={`Shared with: ${sharedWithLabel(state)}`}
        data-testid="shared-with-button"
      >
        <Users aria-hidden="true" />
        <span className="truncate">{sharedWithLabel(state)}</span>
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
          {people.map((p) => row(p, false))}
          {state.former.map((p) => row(p, true))}
          {error && (
            <div role="alert" className="pt-1 text-[12.5px] text-[var(--k-danger-text)]">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
