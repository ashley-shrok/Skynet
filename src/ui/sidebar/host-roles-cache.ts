// host-roles-cache — the last answer each machine gave the new-conversation
// dialog's roles request, kept for the life of the page. Roles rarely change,
// so a reopened dialog shows these straight away while it asks every machine
// again; each fresh answer replaces its machine's entry. A failed request is
// an answer too (that machine just lists no roles), so a machine that keeps
// failing doesn't hold the reopened list behind "Loading roles…".

import type { RoleSummary } from "@/api/identities-api";

export type CachedHostRoles = { roles: RoleSummary[]; error: string | null };

const cache = new Map<string, CachedHostRoles>();

export function cachedHostRoles(hostId: string): CachedHostRoles | undefined {
  return cache.get(hostId);
}

export function rememberHostRoles(hostId: string, answer: CachedHostRoles): void {
  cache.set(hostId, answer);
}

/** Tests only — every test starts from an empty cache. */
export function clearHostRolesCache(): void {
  cache.clear();
}
