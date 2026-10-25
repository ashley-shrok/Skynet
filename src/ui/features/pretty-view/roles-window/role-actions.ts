// Role actions that run behind a confirm, shared by the detail views and a
// swipe on the row in their lists: archive a role ("Archive role…") and
// delete a role skill ("Delete skill…").

import { kitAlert, kitConfirm } from "@/components/kit";
import { archiveRole } from "@/api/role-archive-api";
import { deleteRoleSkill } from "@/api/role-skills-api";
import type { Identity } from "@/api/identities-api";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Resolves true once the role is archived; false when cancelled or failed
 *  (a failure has already been shown). */
export async function confirmAndArchiveRole(args: {
  hostId: number;
  name: string;
  label: string;
  agents: Pick<Identity, "task" | "displayName">[];
}): Promise<boolean> {
  const { hostId, name, label, agents } = args;
  const body =
    agents.length === 0
      ? "No agents hold it. This can't be undone from here — archived roles can be brought back from Archived roles."
      : `This also archives the ${plural(agents.length, "agent")} holding it:\n` +
        agents.map((i) => `• ${i.task || i.displayName}`).join("\n");
  if (!(await kitConfirm({ title: `Archive ${label}?`, body, confirmLabel: "Archive", destructive: true }))) return false;
  try {
    await archiveRole(hostId, name);
    console.info({ operation: "role_archived", hostId, roleName: name, agentCount: agents.length });
    return true;
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.warn({ operation: "role_archive_failed", hostId, roleName: name, errMessage });
    void kitAlert({ title: `Couldn't archive ${label}`, body: errMessage });
    return false;
  }
}

/** Resolves true once the skill is deleted; false when cancelled or failed
 *  (a failure has already been shown). */
export async function confirmAndDeleteRoleSkill(args: {
  hostId: number;
  roleName: string;
  skill: string;
}): Promise<boolean> {
  const { hostId, roleName, skill } = args;
  if (
    !(await kitConfirm({
      title: `Delete skill "${skill}"?`,
      body: "This removes the skill and every file inside it. This can't be undone.",
      confirmLabel: "Delete skill",
      destructive: true,
    }))
  )
    return false;
  try {
    await deleteRoleSkill(hostId, roleName, skill);
    console.info({ operation: "role_skill_deleted", hostId, roleName, skill });
    return true;
  } catch (err) {
    void kitAlert({ title: "Couldn't delete the skill", body: err instanceof Error ? err.message : undefined });
    return false;
  }
}
