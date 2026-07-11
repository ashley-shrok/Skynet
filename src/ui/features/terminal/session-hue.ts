import { useIdentities } from "@/state/identities-store";
import type { Identity } from "@/api/identities-api";

export function firstSessionWord(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const word = name.split(/[-_\s]/, 1)[0].toLowerCase();
  return word || null;
}

export function hueFromSessionName(
  name: string | null | undefined,
): number | null {
  const word = firstSessionWord(name);
  if (!word) return null;
  let h = 5381;
  for (let i = 0; i < word.length; i++) {
    h = ((h << 5) + h + word.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

export function useSessionIdentity(
  name: string | null | undefined,
): { identity: Identity | null; identityHue: number | null } {
  const { byKey } = useIdentities();
  const key = firstSessionWord(name);
  const identity = key ? (byKey.get(key) ?? null) : null;
  const identityHue = identity?.colorHue ?? null;
  return { identity, identityHue };
}
