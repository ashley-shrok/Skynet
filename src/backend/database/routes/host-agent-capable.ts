// Whether a user's host row can host agents. The fleet substrate flag
// (runsFleetSubstrate) lives on one row per machine — the row the distributor
// installs through. Other users' copies of the same machine keep the flag off
// so the distributor doesn't install twice, but they can still host agents.

export type MachineRow = {
  ip?: unknown;
  port?: unknown;
  username?: unknown;
  credentialId?: unknown;
  enableSsh?: unknown;
  runsFleetSubstrate?: unknown;
};

function norm(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function portOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : 22;
}

// Same address, same port, and the same login — by username, or by the
// shared credential the copy was made with.
export function sameMachine(a: MachineRow, b: MachineRow): boolean {
  const ip = norm(a.ip);
  if (!ip || ip !== norm(b.ip)) return false;
  if (portOf(a.port) !== portOf(b.port)) return false;
  const user = norm(a.username);
  if (user && user === norm(b.username)) return true;
  return a.credentialId != null && a.credentialId === b.credentialId;
}

export function canHostAgents(row: MachineRow, substrateRows: MachineRow[]): boolean {
  if (!row.enableSsh) return false;
  if (row.runsFleetSubstrate === true || row.runsFleetSubstrate === 1) return true;
  return substrateRows.some((s) => sameMachine(row, s));
}
