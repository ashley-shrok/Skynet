/**
 * Phase 117 Plan 117-07 Task 2 — useCollapsedProjectSlugs hook (D-40).
 *
 * localStorage-backed per-project collapse state. This is a personal UI
 * preference, NOT server-synced (D-40). The Wave 4 (117-08) sidebar reads
 * `collapsed` to render chevron state on each project header row, and
 * invokes `toggle(slug)` on chevron click.
 *
 * Storage discipline (mirrors conversation-store.ts:270 hydrateActiveSetFromStorage):
 *   - Storage key: "pv-collapsed-project-slugs"
 *   - Value: JSON string of `string[]` (Set → Array for JSON serialization)
 *   - EVERY read + write wrapped in try/catch — silent on failure. Mobile
 *     Safari private mode + quota-exceeded browsers make localStorage throw;
 *     the correct fallback is an empty Set (defer collapse state to a fresh
 *     start rather than crash the sidebar).
 *   - Hydration filters non-string entries (defense against tampered storage).
 *
 * Contract for callers:
 *   - `collapsed: ReadonlySet<string>` — immutable snapshot; identity flips
 *     on every toggle so React consumers re-render.
 *   - `toggle(slug)` — additive on absent, removes on present; persists via
 *     silent-catch write. Never throws.
 *
 * Backward-compat: this hook is NEW in Phase 117; no pre-Phase-117 consumers
 * exist. Wave 4 (117-08) is the first consumer.
 */

import { useCallback, useState } from "react";

const COLLAPSED_PROJECT_SLUGS_STORAGE_KEY = "pv-collapsed-project-slugs";

/**
 * Read the stored Set from localStorage. Silent try/catch on the whole path
 * — missing key, corrupt JSON, non-array root, unsupported storage layer
 * (SSR / JSDOM edge / private mode) ALL fall back to an empty Set.
 * Non-string entries in the array are filtered out (defensive against
 * a tampered storage blob).
 */
function hydrateFromStorage(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set<string>();
    const raw = localStorage.getItem(COLLAPSED_PROJECT_SLUGS_STORAGE_KEY);
    if (raw === null) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    const out = new Set<string>();
    for (const v of parsed) if (typeof v === "string") out.add(v);
    return out;
  } catch {
    return new Set<string>();
  }
}

/**
 * Persist the Set to localStorage. Silent try/catch — a full storage
 * (quota-exceeded) or an SSR/JSDOM environment without localStorage MUST
 * NOT throw into the caller. The in-memory Set is the authoritative state
 * for this session; persistence is best-effort recovery on next mount.
 */
function persistToStorage(slugs: ReadonlySet<string>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      COLLAPSED_PROJECT_SLUGS_STORAGE_KEY,
      JSON.stringify([...slugs]),
    );
  } catch {
    /* silent — persistence is best-effort */
  }
}

/**
 * localStorage-backed collapse state for project sections.
 *
 * @returns `{collapsed, toggle}` — `collapsed` is a stable ReadonlySet whose
 * identity flips on every toggle, so consumers using `collapsed.has(slug)`
 * inside memoized selectors re-render only when the set genuinely changes.
 */
export function useCollapsedProjectSlugs(): {
  collapsed: ReadonlySet<string>;
  toggle: (slug: string) => void;
} {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    hydrateFromStorage(),
  );

  const toggle = useCallback(
    (slug: string): void => {
      // Phase 117 M4 fix (2026-09-18): pre-fix, this called
      // persistToStorage(next) INSIDE the functional setCollapsed
      // updater. React StrictMode double-invokes updaters in
      // development, which caused localStorage.setItem to run TWICE
      // per toggle in dev. setState updaters must be pure — no side
      // effects.
      //
      // Fix: compute `next` explicitly outside the updater based on
      // the current committed `collapsed` value from the render pass,
      // call setCollapsed(next) with the pre-built Set, then call
      // persistToStorage(next) exactly once. Because `collapsed` is
      // captured in the useCallback closure, we depend on it in the
      // deps array so `toggle` re-creates when `collapsed` flips
      // identity (which it does on every real change).
      const next = new Set(collapsed);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      setCollapsed(next);
      persistToStorage(next);
    },
    [collapsed],
  );

  return { collapsed, toggle };
}
