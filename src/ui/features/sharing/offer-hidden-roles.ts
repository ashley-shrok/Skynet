// After a new scheduled task is created shared with some people: any of them
// its roles hide its conversations from are offered the roles too — the same
// "Share both" question ticking them on an existing task asks.
//
// Shape: .planning/shape-sharing-apps-tasks.closed.md

import { kitConfirm } from "@/components/kit";
import { applySharing, getSharing } from "@/api/sharing-api";
import { joinAnd } from "./SharedWithButton";

export async function offerHiddenRoles(t: { hostId: number; slug: string; label: string }): Promise<void> {
  const target = { hostId: t.hostId, kind: "task" as const, slug: t.slug };
  try {
    const state = await getSharing(target);
    if (!state.multiUser) return;
    const people = state.ticked.filter((p) => (state.hiddenBy[p] ?? []).some((r) => r.fixable));
    if (people.length === 0) return;
    const roles = [...new Set(people.flatMap((p) => state.hiddenBy[p].filter((r) => r.fixable).map((r) => r.label)))];
    const roleWord = roles.length === 1 ? "role" : "roles";
    const go = await kitConfirm({
      title: `Share the ${joinAnd(roles)} ${roleWord} with ${joinAnd(people)} too?`,
      body: `The conversations ${t.label} starts show up only for people who can see its ${roleWord}. Sharing just the task won't make them show up for ${joinAnd(people)}.`,
      confirmLabel: "Share both",
      cancelLabel: "Just the task",
    });
    console.info("[sharing] new task's hidden roles", {
      operation: "sharing_new_task_roles",
      hostId: t.hostId,
      slug: t.slug,
      people: people.length,
      shared: go,
    });
    if (go) await applySharing(target, { shareRolesFor: people });
  } catch (err) {
    console.warn("[sharing] couldn't check a new task's roles", {
      operation: "sharing_new_task_roles_failed",
      hostId: t.hostId,
      slug: t.slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
