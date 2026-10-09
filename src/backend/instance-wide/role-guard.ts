/**
 * instance-wide/role-guard.ts — app-side writes into a role folder.
 *
 * When the role is instance-wide: non-admins are refused (their change would
 * only be put back at the next sync); an admin's write goes to the host as
 * usual and then a sync runs that treats that host's change as an admin
 * change, so it flows into the master and out to every machine — even when the
 * host itself is not admin-owned.
 */
import type { Response } from "express";
import { getInstanceWide, machineForHostRow } from "./production.js";
import { callerIsAdmin } from "./admin.js";

export const INSTANCE_WIDE_ROLE_REFUSAL =
  "this role is managed instance-wide — only an admin can change it";

/**
 * Returns "allow" (not instance-wide, or not a synced host), "admin" (allowed;
 * call afterAdminWrite once the write lands) or "refuse".
 */
export async function checkInstanceWideRoleWrite(
  userId: string,
  hostId: number,
  role: string,
): Promise<{ verdict: "allow" | "refuse" } | { verdict: "admin"; machineId: string }> {
  const engine = getInstanceWide();
  if (!engine || !(await engine.isInstanceWide("role", role))) return { verdict: "allow" };
  const machine = await machineForHostRow(hostId);
  if (!machine) return { verdict: "allow" };
  if (!(await callerIsAdmin(userId))) return { verdict: "refuse" };
  return { verdict: "admin", machineId: machine.machineId };
}

export function afterAdminWrite(machineId: string): void {
  getInstanceWide()?.requestSync({ adminSourcedMachineId: machineId });
}

/**
 * Express helper: refuses with 403, or (for an admin) arranges the sync once
 * the response finishes successfully. Returns false when it has responded.
 */
export async function guardInstanceWideRoleWrite(
  res: Response,
  userId: string,
  hostId: number,
  role: string,
): Promise<boolean> {
  const check = await checkInstanceWideRoleWrite(userId, hostId, role);
  if (check.verdict === "refuse") {
    res.status(403).json({ error: INSTANCE_WIDE_ROLE_REFUSAL, code: "instance_wide" });
    return false;
  }
  if (check.verdict === "admin") {
    res.on("finish", () => {
      if (res.statusCode < 400) afterAdminWrite(check.machineId);
    });
  }
  return true;
}
