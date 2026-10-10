import { useEffect, useSyncExternalStore } from "react";
import { listSkills, type SkillEntry } from "@/api/skills-api";
import { getCurrentUser } from "@/state/user-scoped-cache";

// Skill-actions menu (campaign skill-actions, shape skill-action-menu): the
// per-host skill list behind the compose-row lightning-bolt button.
//
// The list is remembered per (user, host) in localStorage so the button and
// menu render instantly across reloads — no loading state in normal use.
// Freshness: the first time a host's compose box mounts in an app load the
// list is fetched in the background; every menu open refreshes it again in
// the background. A failed fetch keeps whatever was remembered, silently.
//
// Snapshot semantics: `null` = never known for this host (button hidden),
// `[]` = known to have no skills (button hidden), non-empty = show.

export type SkillActionEntry = { name: string; description?: string };

const LS_PREFIX = "skynet:skill-actions:v1";
const PREFETCH_RETRY_MS = 30_000;

// Keyed by the localStorage key (user + host), so a different login in the
// same app load never sees the previous user's list. A `null` value caches
// "nothing remembered" so the snapshot doesn't re-read storage per render.
const memory = new Map<string, SkillActionEntry[] | null>();
const inFlight = new Map<string, Promise<boolean>>();
const prefetched = new Set<string>();
const listeners = new Set<() => void>();

function lsKey(hostId: number): string {
  return `${LS_PREFIX}:${getCurrentUser() ?? "__anon"}:${hostId}`;
}

function normalize(entries: SkillEntry[]): SkillActionEntry[] {
  return entries
    .filter((e) => typeof e?.name === "string" && e.name.length > 0)
    // Agent-only skills (`user-invocable: false`) can't be run by the user,
    // so the Skills menu leaves them out.
    .filter((e) => e.userInvocable !== false)
    .map((e) =>
      typeof e.description === "string" && e.description.length > 0
        ? { name: e.name, description: e.description }
        : { name: e.name },
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readPersisted(key: string): SkillActionEntry[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return normalize(parsed as SkillEntry[]);
  } catch {
    return null;
  }
}

function writePersisted(key: string, list: SkillActionEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage full / blocked — the in-memory copy still serves this load.
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function sameList(a: SkillActionEntry[], b: SkillActionEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.name === b[i].name && x.description === b[i].description);
}

/** Current known list for a host (memory, else persisted), or null if never known. */
export function getSkillActions(hostId: number): SkillActionEntry[] | null {
  return getByKey(lsKey(hostId));
}

function getByKey(key: string): SkillActionEntry[] | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  const persisted = readPersisted(key);
  memory.set(key, persisted);
  return persisted;
}

/**
 * Fetch the host's list in the background. Concurrent calls for the same host
 * share one request. Never throws; a failure keeps the remembered list.
 * Resolves true on success, false on failure.
 */
export function refreshSkillActions(hostId: number, reason: "prefetch" | "menu-open"): Promise<boolean> {
  const key = lsKey(hostId);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const startedAt = Date.now();
  const p = listSkills(hostId)
    .then((entries) => {
      const next = normalize(entries);
      const prev = getByKey(key);
      const changed = prev === null || !sameList(prev, next);
      memory.set(key, next);
      writePersisted(key, next);
      console.info(
        `[skill-actions] refresh-ok hostId=${hostId} reason=${reason} count=${next.length} changed=${changed} ms=${Date.now() - startedAt}`,
      );
      if (changed) emit();
      return true;
    })
    .catch((err: unknown) => {
      console.warn(
        `[skill-actions] refresh-failed hostId=${hostId} reason=${reason} keptCached=${getByKey(key) !== null} err="${err instanceof Error ? err.message : String(err)}"`,
      );
      return false;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The host's skill list, kept current. `enabled=false` (relay panes) skips
 * the background prefetch and returns null.
 */
export function useSkillActions(hostId: number, enabled: boolean): SkillActionEntry[] | null {
  const list = useSyncExternalStore(subscribe, () => (enabled ? getSkillActions(hostId) : null));
  useEffect(() => {
    if (!enabled) return;
    const key = lsKey(hostId);
    if (prefetched.has(key)) return;
    prefetched.add(key);
    // A failed prefetch with nothing remembered would otherwise leave the
    // host button-less for the whole app load (the menu-open refresh can't
    // run without a button). Retry on a timer while this compose box is
    // mounted; a later mount also retries since the key is released.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (): void => {
      void refreshSkillActions(hostId, "prefetch").then((ok) => {
        if (ok || cancelled) {
          if (!ok) prefetched.delete(key);
          return;
        }
        if (getByKey(key) !== null) return; // remembered list serves; menu-open refreshes
        timer = setTimeout(attempt, PREFETCH_RETRY_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        prefetched.delete(key);
      }
    };
  }, [hostId, enabled]);
  return list;
}

/** Test-only: forget all in-memory state (localStorage is the test's to clear). */
export function __resetSkillActionsStoreForTests(): void {
  memory.clear();
  inFlight.clear();
  prefetched.clear();
  listeners.clear();
}
