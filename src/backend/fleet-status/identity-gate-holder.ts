/**
 * identity-gate-holder.ts
 *
 * convo-scoped apps: module-scope holder for the fleet-status identity
 * visibility gate ("can user U see identity N on host H"). The gate is a
 * closure built in starter.ts (it needs the per-user orchestrators and the
 * SSH slow path) and injected into the WS app-frame filter. HTTP routes that
 * serve a conversation app — the app-pane proxy, the app icon, the
 * Move-to-sidebar request — need the same answer, so starter.ts also parks
 * the closure here.
 *
 * Fail closed: until the gate is set, `canUserSeeIdentity` answers false, so
 * a conversation app is never served before the gate exists.
 *
 * Answers are cached per (user, host, identity) for GATE_TTL_MS: one app page
 * load fans out into dozens of asset requests, and each would otherwise run
 * the gate (a DB lookup, and on a cosmetics-cache miss an SSH read). A change
 * in visibility takes effect within the TTL — the same staleness the WS app
 * frames accept.
 */

export type IdentityGateFn = (
  identityName: string,
  hostIdStr: string,
  userId: string,
) => Promise<boolean>;

let gateRef: IdentityGateFn | null = null;

const GATE_TTL_MS = 10_000;
const GATE_CACHE_MAX = 2_000;
const gateCache = new Map<string, { at: number; answer: Promise<boolean> }>();

export function setIdentityGate(fn: IdentityGateFn): void {
  gateRef = fn;
  gateCache.clear();
}

/** True when `userId` can see identity `identityName` on host `hostIdStr`. Never throws. */
export async function canUserSeeIdentity(
  identityName: string,
  hostIdStr: string,
  userId: string,
): Promise<boolean> {
  if (gateRef === null) return false;
  const gate = gateRef;
  const key = `${userId}\u0000${hostIdStr}\u0000${identityName}`;
  const now = Date.now();
  const hit = gateCache.get(key);
  if (hit && now - hit.at < GATE_TTL_MS) return hit.answer;
  // Concurrent asset requests share one in-flight check.
  const answer = (async () => {
    try {
      return await gate(identityName, hostIdStr, userId);
    } catch {
      return false;
    }
  })();
  if (gateCache.size >= GATE_CACHE_MAX) {
    for (const [k, v] of gateCache) if (now - v.at >= GATE_TTL_MS) gateCache.delete(k);
    if (gateCache.size >= GATE_CACHE_MAX) gateCache.clear();
  }
  gateCache.set(key, { at: now, answer });
  return answer;
}

export function _resetIdentityGateForTesting(): void {
  gateRef = null;
  gateCache.clear();
}
