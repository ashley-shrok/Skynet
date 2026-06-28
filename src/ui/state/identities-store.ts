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

function setIdentities(list: Identity[]) {
  state = {
    identities: list,
    byKey: new Map(list.map((i) => [i.identityKey.toLowerCase(), i])),
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
