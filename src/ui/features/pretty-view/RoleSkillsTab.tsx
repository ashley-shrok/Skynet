// Skills tab body for the role modal — the role's role skills (Phase 89's
// Runbooks tab, renamed with runbooks → role skills).
//
// Lists role skill slugs for the role. Clicking a row fires onOpenRoleSkill(slug)
// up to the caller (PrettyView / the sidebar panel own the swap-not-stack
// coordination — close the role modal and open RoleSkillEditorModal).
// "+ New skill" asks for a name and a required description, creates the role
// skill in the standard SKILL.md shape, and opens it the same way.
//   D-09: alphabetically sorted by slug.
//   D-11: tab is always rendered even when the role has no role skills.

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import {
  createRoleSkill,
  listRoleSkills,
  RoleSkillAlreadyExistsError,
  type RoleSkillEntry,
} from "@/api/role-skills-api";
import type { TabState } from "./IdentityFileTab";
import { roleDisplayName } from "@/lib/role-display-name";
import { slugifyRoleName } from "@/sidebar/CreateRoleDialog";

export interface RoleSkillsTabProps {
  /** SSH host id — inherited from the role modal upstream. */
  hostId: number;
  /** Role slug (may be null). */
  roleName: string | null;
  /** Called with a role skill's slug when its row is clicked, or right after
   *  "+ New skill" creates it. Fires the swap-not-stack coordination (D-06):
   *  the parent closes the role modal and opens RoleSkillEditorModal. */
  onOpenRoleSkill: (roleSkillName: string) => void;
}

export function RoleSkillsTab({ hostId, roleName, onOpenRoleSkill }: RoleSkillsTabProps): JSX.Element {
  const [roleSkills, setRoleSkills] = useState<TabState<RoleSkillEntry[]>>({ status: "loading" });

  useEffect(() => {
    // D-11: tab is always rendered, even when the role has no skills folder.
    // With no role resolved, skip the fetch and show the empty state.
    if (roleName === null) {
      setRoleSkills({ status: "ready", data: [] });
      return;
    }
    let cancelled = false;
    setRoleSkills({ status: "loading" });
    console.debug("[RoleSkillsTab] fetch", { hostId, roleName });
    listRoleSkills(hostId, roleName)
      .then((entries) => {
        if (cancelled) return;
        console.debug("[RoleSkillsTab] fetch-ready", { count: entries.length });
        setRoleSkills({ status: "ready", data: entries });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.debug("[RoleSkillsTab] fetch-error", { err });
        setRoleSkills({
          status: "error",
          error: err instanceof Error ? err.message : "Failed to load skills",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, roleName]);

  // Same two-prompt flow as the lightning-bolt Skills editor's "+ New skill":
  // a name (slugified; asked again if it has no letters or digits), then a
  // required one-line description.
  const handleNewSkill = useCallback(async (): Promise<void> => {
    if (roleName === null) return;
    let displayName = "";
    let slug: string | null = null;
    while (slug === null) {
      const rawName = window.prompt("New skill name:", "");
      if (rawName == null) return;
      const candidate = slugifyRoleName(rawName.trim());
      if (candidate.length === 0) {
        window.alert("Please pick a name with at least one letter or number.");
        continue;
      }
      displayName = rawName.trim();
      slug = candidate;
    }
    let description: string | null = null;
    while (description === null) {
      const rawDesc = window.prompt(
        `Description for "${displayName}" — what it does and when an agent should use it:`,
        "",
      );
      if (rawDesc == null) return;
      const trimmed = rawDesc.trim();
      if (trimmed.length === 0) {
        window.alert("A description is required.");
        continue;
      }
      description = trimmed;
    }
    try {
      const result = await createRoleSkill(hostId, roleName, slug, description);
      console.debug("[RoleSkillsTab] created", { roleName, slug: result.slug });
      onOpenRoleSkill(result.slug);
    } catch (err) {
      console.debug("[RoleSkillsTab] create-error", { roleName, slug, err });
      window.alert(
        err instanceof RoleSkillAlreadyExistsError
          ? `This role already has a skill named "${slug}".`
          : `Couldn't create "${displayName}": ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }, [hostId, roleName, onOpenRoleSkill]);

  const newSkillButton = (
    <button
      type="button"
      onClick={() => void handleNewSkill()}
      disabled={roleName === null}
      aria-label="+ New skill"
      title="New skill"
      data-testid="role-skills-tab-new-skill"
      className="self-start flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 text-[#e8e4d8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Plus className="w-3.5 h-3.5" />
      New skill
    </button>
  );

  if (roleSkills.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  }

  if (roleSkills.status === "error") {
    return (
      <div className="text-sm text-red-400">
        Couldn&apos;t load skills: {roleSkills.error}
      </div>
    );
  }

  // Empty state explains what role skills ARE, so a first-time user knows
  // what the button makes.
  if (roleSkills.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-sm text-[var(--color-pv-fg-muted)] text-center px-6 py-8">
        <div>This role has no skills yet.</div>
        <div className="text-xs opacity-70">
          Role skills are skills that belong to this role — steps for work the
          role repeats, with a short description of when to use them. Every
          agent that takes on this role is told about them when it starts.
        </div>
        <div className="self-center">{newSkillButton}</div>
      </div>
    );
  }

  // D-09: alphabetically sorted (backend already sorts via `find | sort`,
  // but sort locally too as a defense against wire-order-drift).
  const sorted = [...roleSkills.data].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-1.5">
      {newSkillButton}
      {sorted.map((entry) => (
        <button
          key={entry.name}
          type="button"
          onClick={() => {
            console.debug("[RoleSkillsTab] row-click", { name: entry.name });
            onOpenRoleSkill(entry.name);
          }}
          className="text-left px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[#e8e4d8] text-sm cursor-pointer transition-colors"
        >
          {/* Slug title-cased for display; the click still fires the raw slug. */}
          {roleDisplayName(entry.name)}
        </button>
      ))}
    </div>
  );
}
