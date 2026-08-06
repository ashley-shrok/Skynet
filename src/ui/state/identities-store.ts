import { useEffect, useState } from "react";
import { listIdentities, type Identity } from "@/api/identities-api";

type State = {
  identities: Identity[];
  byKey: Map<string, Identity>;
  loaded: boolean;
};

let state: State = { identities: [], byKey: new Map(), loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

// displayName is display-only (identityKey is the canonical id); normalize
// to first-letter-capitalized at store-load time so every consumer — sidebar
// rows, chat headers, badges, modals — reads a consistent shape regardless
// of whether the row was birthed with a capitalized name or cloned (clone
// sets displayName=newName which is lowercase per IDENTITY_KEY_RE).
function withDisplayCap(i: Identity): Identity {
  if (!i.displayName || i.displayName.length === 0) return i;
  const first = i.displayName.charAt(0);
  const capped = first.toUpperCase();
  if (capped === first) return i;
  return { ...i, displayName: capped + i.displayName.slice(1) };
}

function setIdentities(list: Identity[]) {
  const normalized = list.map(withDisplayCap);
  state = {
    identities: normalized,
    byKey: new Map(normalized.map((i) => [i.identityKey.toLowerCase(), i])),
    loaded: true,
  };
  notify();
}

async function fetchOnce(): Promise<void> {
  if (state.loaded || inflight) return inflight ?? Promise.resolve();
  inflight = (async () => {
    try {
      const list = await listIdentities();
      setIdentities(list);
    } catch {
      state = { ...state, loaded: true };
      notify();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function refreshIdentities(): Promise<void> {
  state = { ...state, loaded: false };
  return fetchOnce();
}

export function applyIdentityChange(
  next: Identity | null,
  removedId?: string,
): void {
  let list = state.identities.slice();
  if (removedId) {
    list = list.filter((i) => i.id !== removedId);
  } else if (next) {
    const idx = list.findIndex((i) => i.id === next.id);
    if (idx >= 0) list[idx] = next;
    else list.push(next);
  }
  setIdentities(list);
}

export function useIdentities(): {
  identities: Identity[];
  byKey: Map<string, Identity>;
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    listeners.add(cb);
    void fetchOnce();
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return {
    identities: state.identities,
    byKey: state.byKey,
    loaded: state.loaded,
    refresh: refreshIdentities,
  };
}
