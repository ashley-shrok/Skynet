/**
 * localStorage-backed collapse state for the sidebar's "Projects"
 * super-header (the whole projects zone, not an individual project — that
 * is useCollapsedProjectSlugs). Personal UI preference, not server-synced.
 *
 * Defaults to expanded. Every storage read/write is wrapped in try/catch —
 * private mode / quota-exceeded / no-localStorage environments fall back to
 * expanded and in-memory state.
 */

import { useCallback, useState } from "react";

const PROJECTS_SECTION_COLLAPSED_STORAGE_KEY = "pv-projects-section-collapsed";

function hydrateFromStorage(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(PROJECTS_SECTION_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistToStorage(collapsed: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (collapsed) localStorage.setItem(PROJECTS_SECTION_COLLAPSED_STORAGE_KEY, "1");
    else localStorage.removeItem(PROJECTS_SECTION_COLLAPSED_STORAGE_KEY);
  } catch {
    /* silent — persistence is best-effort */
  }
}

export function useProjectsSectionCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(() => hydrateFromStorage());

  // Side effect kept outside the setState updater (StrictMode double-invokes
  // updaters) — same discipline as useCollapsedProjectSlugs.toggle.
  const toggle = useCallback((): void => {
    const next = !collapsed;
    setCollapsed(next);
    persistToStorage(next);
  }, [collapsed]);

  return { collapsed, toggle };
}
