// The New skill questions — name, then description — and the create call
// behind them. Shared by the Skills window's New skill button and the
// composer Skills menu's "New skill…" row, so a skill made from either
// place is made the same way.

import { kitAlert, kitPrompt } from "@/components/kit";
import { createSkill, SkillAlreadyExistsError } from "@/api/skills-api";
import { slugifyRoleName } from "@/lib/slugify-role-name";
import { isBlockedSkillName, SKILL_NAME_REFUSED_MESSAGE } from "@/types/blocked-commands";
import { refreshSkillActions } from "./skill-actions-store";

// The New skill / Rename name field: empty after slugging, or a name the
// composer would refuse as a command.
export function skillNameError(v: string): string | null {
  const slug = slugifyRoleName(v.trim());
  if (slug.length === 0) return "Pick a name with at least one letter or number.";
  if (isBlockedSkillName(slug)) return SKILL_NAME_REFUSED_MESSAGE;
  return null;
}

/**
 * Ask for a name (starting from `initialName`) and a required description,
 * then create the skill on `hostId`. Resolves to the new skill's slug, or
 * null when the user backs out or the create fails (the failure is shown).
 */
export async function promptNewSkill(
  hostId: number,
  opts: { initialName?: string; source: "skills-editor" | "composer-menu" },
): Promise<string | null> {
  const rawName = await kitPrompt({
    title: "New skill",
    label: "Name",
    placeholder: "My skill",
    defaultValue: opts.initialName || undefined,
    confirmLabel: "Next",
    validate: skillNameError,
  });
  if (rawName == null) {
    console.info(`[new-skill] cancelled step=name source=${opts.source} hostId=${hostId}`);
    return null;
  }
  const displayName = rawName.trim();
  const slug = slugifyRoleName(displayName);

  const rawDesc = await kitPrompt({
    title: `Describe "${displayName}"`,
    body: "Agents read this to decide when to use the skill.",
    label: "Description",
    confirmLabel: "Create skill",
    validate: (v) => (v.trim().length === 0 ? "A description is required." : null),
  });
  if (rawDesc == null) {
    console.info(`[new-skill] cancelled step=description source=${opts.source} hostId=${hostId}`);
    return null;
  }

  try {
    const result = await createSkill(hostId, slug, rawDesc.trim());
    console.info(`[new-skill] created source=${opts.source} hostId=${hostId} skill=${result.slug}`);
    // The composer's ⚡ list picks it up for its next open.
    void refreshSkillActions(hostId, "new-skill", { fresh: true });
    return result.slug;
  } catch (err) {
    console.warn(`[new-skill] create-failed source=${opts.source} hostId=${hostId} skill=${slug}`, err instanceof Error ? err.message : err);
    const msg =
      err instanceof SkillAlreadyExistsError
        ? `A skill named "${displayName}" already exists on this host.`
        : err instanceof Error
        ? `Couldn't create "${displayName}": ${err.message}`
        : `Couldn't create "${displayName}".`;
    void kitAlert({ title: "Couldn't create the skill", body: msg });
    return null;
  }
}
