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

export function useSessionIdentity(
  name: string | null | undefined,
): { identity: Identity | null; identityHue: number | null } {
  const { byKey } = useIdentities();
  const key = sessionMatchKey(name);
  const identity = key ? (byKey.get(key) ?? null) : null;
  const identityHue = identity?.colorHue ?? null;
  return { identity, identityHue };
}
