// host-roles-cache — the last roles list each machine gave the
// new-conversation dialog, kept for the life of the page. Roles rarely
// change, so a reopened dialog shows these straight away while it asks every
// machine again; each fresh answer replaces its machine's entry.

import type { RoleSummary } from "@/api/identities-api";

const cache = new Map<string, RoleSummary[]>();

export function cachedHostRoles(hostId: string): RoleSummary[] | undefined {
  return cache.get(hostId);
}

export function rememberHostRoles(hostId: string, roles: RoleSummary[]): void {
  cache.set(hostId, roles);
}

export function forgetHostRoles(hostId: string): void {
  cache.delete(hostId);
}

/** Tests only — every test starts from an empty cache. */
export function clearHostRolesCache(): void {
  cache.clear();
}
