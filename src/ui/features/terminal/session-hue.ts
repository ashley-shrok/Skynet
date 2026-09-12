import { useIdentities } from "@/state/identities-store";
import type { Identity } from "@/api/identities-api";

export function sessionMatchKey(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const key = name.toLowerCase();
  return key || null;
}

export function hueFromSessionName(
  name: string | null | undefined,
): number | null {
  const key = sessionMatchKey(name);
  if (!key) return null;
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/**
 * Resolve the identity object + hue for a session name.
 *
 * quick-260912-0t4: widened to accept an optional `hostId` so callers that
 * render a pane/row belonging to a specific host disambiguate cross-host
 * name collisions (two identities sharing a name on different fleet hosts).
 * When `hostId` is provided, the lookup key is `${hostId}::${matchKey}` and
 * we read from the store's `byHostKey` composite map. When `hostId` is
 * null/undefined (pre-existing untouched callers — e.g. test mocks, the
 * NewSessionDialog role dropdown that has no host context), fall through to
 * the OLD bare-name `byKey.get(key)` path so behavior stays byte-identical.
 * The bare-name fallback is the compat seam for the 15+ existing call sites
 * outside the quick-260912-0t4 fix_scope.
 */
export function useSessionIdentity(
  name: string | null | undefined,
  hostId?: number | null,
): { identity: Identity | null; identityHue: number | null } {
  const { byKey, byHostKey } = useIdentities();
  const key = sessionMatchKey(name);
  let identity: Identity | null = null;
  if (key) {
    // quick-260912-0t4: try hostId-scoped composite first when caller supplied
    // a valid hostId; fall back to bare-name byKey if the composite misses.
    // The fallback preserves compat with test fixtures that seed byKey only
    // (no hostId on identity objects) and with pre-populated wire state that
    // predates the hostId-on-row surface.
    if (typeof hostId === "number" && Number.isFinite(hostId)) {
      identity = byHostKey?.get(`${hostId}::${key}`) ?? null;
    }
    if (!identity) {
      identity = byKey?.get(key) ?? null;
    }
  }
  const identityHue = identity?.colorHue ?? null;
  return { identity, identityHue };
}
