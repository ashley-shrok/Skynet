// ─── Host tree localStorage cache ───────────────────────────────────────────
//
// Cold-boot paint hint for AppShell's host tree state. The uncached
// getSSHHosts() fetch lands ~200ms-1s post-mount, which delays TWO
// downstream sidebar surfaces that depend on state.hostsFlat being
// populated:
//
//   1. Project sections: conversation-store's projectForRow() (~L1146)
//      requires `row.host` to be truthy to resolve the identity carrier
//      into a project slug. row.host derives from hostsFlat which
//      derives from realHostTree which derives from getSSHHosts. Empty
//      hostsFlat → every identity row falls into pinnedUnassigned /
//      derivedMiddle instead of its project section, then re-migrates
//      when hosts land. User-visible: flash of pinned-in-project rows
//      showing in the top-level pinned section on cold refresh.
//
//   2. RDP synthetic rows at the bottom of the sidebar: iterated from
//      hostsFlat with `host.enableRdp === true`. Missing until hosts
//      land.
//
// Cache is a paint hint: fresh getSSHHosts() response overwrites
// wholesale. Stale online/offline status seeded from cache is corrected
// on the same first fetch. Silent on read/write failure — losing the
// cache is not a user-visible failure; identical to today's
// pre-cache cold-start behavior.
//
// Versioned key so a shape change to SSHHostWithStatus can invalidate
// every client's cache in one deploy by bumping the suffix.

import type { SSHHostWithStatus } from "@/main-axios";

const HOST_TREE_CACHE_KEY = "skynet:host-tree-cache:v1";

/**
 * Minimal shape validation: an object with a numeric or numeric-string `id`
 * and a string `name`. buildHostTree + sshHostToHost tolerate missing
 * optional fields (defaults kick in) but need these two to produce a
 * well-formed HostFolder / Host. Everything else passes through as-is;
 * schema drift on optional fields is absorbed by the same field-defaults
 * in sshHostToHost. Bump the cache-key suffix on breaking changes to
 * required fields.
 */
function isCacheableHost(x: unknown): x is SSHHostWithStatus {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  const idOk = typeof h.id === "number" || typeof h.id === "string";
  const nameOk = typeof h.name === "string" && h.name.length > 0;
  return idOk && nameOk;
}

/**
 * Read the last-persisted host list from localStorage. Returns [] on any
 * failure mode (missing key, malformed JSON, non-array top level, elements
 * that fail the minimal shape check) — the caller treats an empty cache
 * identically to a cold start.
 *
 * Silent by contract: no throws, no console noise, no toasts.
 */
export function readHostTreeCache(): SSHHostWithStatus[] {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(HOST_TREE_CACHE_KEY)
        : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: SSHHostWithStatus[] = [];
    for (const item of parsed) {
      if (isCacheableHost(item)) valid.push(item);
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Write the host list to localStorage. Overwrites; no TTL, no merge.
 * Silent on any storage error (QuotaExceededError, disabled storage,
 * private-mode failures) — losing the cache is not user-visible.
 */
export function writeHostTreeCache(hosts: readonly SSHHostWithStatus[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(HOST_TREE_CACHE_KEY, JSON.stringify(hosts));
  } catch {
    // Silent — cache-write failure is non-fatal.
  }
}
