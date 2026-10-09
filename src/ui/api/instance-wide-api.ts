import { authApi, handleApiError } from "@/main-axios";

// Client for the /instance-wide router (src/backend/database/routes/instance-wide.ts).
// Instance-wide skills and roles have a master copy in the app that is kept in
// step on every host. Editing an instance-wide skill's files goes through the
// skills-editor API with INSTANCE_HOST_ID.

/** hostId the skills-editor API uses for the instance-wide master copy. */
export const INSTANCE_HOST_ID = 0;

export type InstanceWideKind = "skill" | "role";

export type InstanceWideHostState = "current" | "behind" | "conflict" | "offline";

export type InstanceWideHostStatus = {
  machineId: string;
  hostName: string;
  state: InstanceWideHostState;
  detail?: string;
  lastContactAt?: number;
  conflicts?: string[];
};

export type InstanceWideItem = {
  kind: InstanceWideKind;
  name: string;
  description?: string;
  updatedAt: number;
  /** Hosts not current (offline hosts are never counted). */
  behind: number;
  conflicts: number;
  /** Hosts the item currently sits on. */
  hostCount: number;
  hosts: InstanceWideHostStatus[];
};

export type InstanceWideList = { isAdmin: boolean; items: InstanceWideItem[] };

export async function listInstanceWide(kind: InstanceWideKind): Promise<InstanceWideList> {
  try {
    const res = await authApi.get("/instance-wide/items", { params: { kind } });
    return res.data as InstanceWideList;
  } catch (error) {
    handleApiError(error, "list instance-wide items");
  }
}

export type PromotePreview = {
  files: number;
  bytes: number;
  tooLarge: boolean;
  clashes: string[];
  unreachable: string[];
  sourceHostName: string;
};

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
  if (data?.error) return data.error;
  return error instanceof Error ? error.message : fallback;
}

export class InstanceWideError extends Error {}

export async function previewPromote(
  kind: InstanceWideKind,
  name: string,
  hostId: number,
): Promise<PromotePreview> {
  try {
    const res = await authApi.post("/instance-wide/promote/preview", { kind, name, hostId });
    return res.data as PromotePreview;
  } catch (error) {
    throw new InstanceWideError(errorMessage(error, "Couldn't check the hosts"));
  }
}

export async function promote(kind: InstanceWideKind, name: string, hostId: number): Promise<void> {
  try {
    await authApi.post("/instance-wide/promote", { kind, name, hostId });
  } catch (error) {
    throw new InstanceWideError(errorMessage(error, "Couldn't make it instance-wide"));
  }
}

export async function removeInstanceWide(
  kind: InstanceWideKind,
  name: string,
): Promise<{ hostCount: number }> {
  try {
    const res = await authApi.delete("/instance-wide/items", { data: { kind, name } });
    return res.data as { hostCount: number };
  } catch (error) {
    throw new InstanceWideError(errorMessage(error, "Couldn't remove it"));
  }
}

/** Short status line: "" when every host is current. */
export function syncSummary(item: Pick<InstanceWideItem, "behind" | "conflicts">): string {
  const parts: string[] = [];
  if (item.conflicts > 0) parts.push(`${item.conflicts} conflict${item.conflicts === 1 ? "" : "s"}`);
  if (item.behind > 0) parts.push(`${item.behind} host${item.behind === 1 ? "" : "s"} behind`);
  return parts.join(" · ");
}

/** Text for the promote confirmation (blanket warning + clash list). */
export function promoteConfirmText(kindLabel: string, name: string, p: PromotePreview): string {
  const size = p.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(p.bytes / 1024))} KB` : `${(p.bytes / 1024 / 1024).toFixed(1)} MB`;
  const lines = [
    `Make the ${kindLabel} "${name}" instance-wide?`,
    "",
    `Everything in its folder on ${p.sourceHostName} (${p.files} file${p.files === 1 ? "" : "s"}, ${size}) will be copied to every host and kept in step from now on — including anything private in that folder.`,
  ];
  if (p.clashes.length > 0) {
    lines.push("", `These hosts already have a ${kindLabel} named "${name}", which will be replaced: ${p.clashes.join(", ")}`);
  }
  if (p.unreachable.length > 0) {
    lines.push("", `Couldn't check (offline): ${p.unreachable.join(", ")} — any same-name ${kindLabel} there will be replaced when they come back.`);
  }
  return lines.join("\n");
}
