import type { SkillActionEntry } from "./skill-actions-store";

// One ranking for both skill menus (shape slash-skill-menu): the
// lightning-bolt menu's search and the compose box's slash list order any
// search the same way.
//
// Tiers, alphabetical within each (the store's list is already sorted):
//   0 — the name is exactly the query
//   1 — the name starts with the query
//   2 — the name contains the query
//   3 — every word of the query appears somewhere in the name or description
// An empty query keeps every skill, alphabetically.

export function rankSkills(skills: readonly SkillActionEntry[], query: string): SkillActionEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...skills];
  const words = q.split(/\s+/).filter(Boolean);
  const ranked: { skill: SkillActionEntry; tier: number; i: number }[] = [];
  skills.forEach((skill, i) => {
    const name = skill.name.toLowerCase();
    let tier: number;
    if (name === q) tier = 0;
    else if (name.startsWith(q)) tier = 1;
    else if (name.includes(q)) tier = 2;
    else {
      const hay = `${name} ${(skill.description ?? "").toLowerCase()}`;
      if (!words.every((w) => hay.includes(w))) return;
      tier = 3;
    }
    ranked.push({ skill, tier, i });
  });
  ranked.sort((a, b) => a.tier - b.tier || a.i - b.i);
  return ranked.map((r) => r.skill);
}

/** A skill's steady tile colour, from its name. */
export function skillHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
