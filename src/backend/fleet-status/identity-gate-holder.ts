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
 */

export type IdentityGateFn = (
  identityName: string,
  hostIdStr: string,
  userId: string,
) => Promise<boolean>;

let gateRef: IdentityGateFn | null = null;

export function setIdentityGate(fn: IdentityGateFn): void {
  gateRef = fn;
}

/** True when `userId` can see identity `identityName` on host `hostIdStr`. Never throws. */
export async function canUserSeeIdentity(
  identityName: string,
  hostIdStr: string,
  userId: string,
): Promise<boolean> {
  if (gateRef === null) return false;
  try {
    return await gateRef(identityName, hostIdStr, userId);
  } catch {
    return false;
  }
}

export function _resetIdentityGateForTesting(): void {
  gateRef = null;
}
