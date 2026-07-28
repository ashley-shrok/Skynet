/**
 * Phase 17 Plan 03 (RELAYBUB-03) — mxid → identity resolver.
 *
 * Resolves a Matrix user ID (@local-part:server) to a local Identity by
 * lowercasing the local-part and looking it up in the identities byKey map
 * (same lowercasing convention as sessionMatchKey in session-hue.ts).
 *
 * Unresolved mxids (no identity match, or malformed mxid) fall back to:
 *   identity: null, colorHue: null, displayName: <raw mxid>
 *
 * Security (T-17-03-05): colorHue is returned as number | null; callers
 * rendering it into CSS must coerce via Number() to guard against a future
 * stray Identity type change smuggling a string.
 */
import type { Identity } from "@/api/identities-api";

/**
 * Matches a Matrix user ID of the form `@local-part:server`.
 * Group 1 = local-part, Group 2 = server.
 */
export const MXID_REGEX = /^@([^:]+):(.+)$/;

export interface MxidResolution {
  identity: Identity | null;
  colorHue: number | null;
  displayName: string;
}

/**
 * Resolve a Matrix user ID to a local identity.
 *
 * @param mxid   - The Matrix user ID, e.g. `@tina:matrix.example.com`.
 * @param byKey  - The `byKey` map from `useIdentities()` — keyed on lowercased identityKey.
 * @returns      Resolution with `identity`, `colorHue`, and `displayName`.
 */
export function resolveMxidToIdentity(
  mxid: string,
  byKey: Map<string, Identity>,
): MxidResolution {
  const match = mxid.match(MXID_REGEX);
  if (!match) {
    // Malformed mxid — surface raw value as displayName.
    return { identity: null, colorHue: null, displayName: mxid };
  }

  // Lowercase the local-part to match identityKey convention (see session-hue.ts:sessionMatchKey).
  const localPart = match[1].toLowerCase();
  const identity = byKey.get(localPart) ?? null;

  if (identity) {
    return {
      identity,
      colorHue: identity.colorHue,
      displayName: identity.displayName,
    };
  }

  // No identity match — raw mxid shown per UI-SPEC § Sender colorHue chain.
  return { identity: null, colorHue: null, displayName: mxid };
}
