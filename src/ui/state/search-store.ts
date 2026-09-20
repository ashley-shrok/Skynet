/**
 * Phase 122 Plan 122-03 Task 1 — Module-scoped store for the conversation
 * search modal.
 *
 * WHY this exists at module scope (not inside the modal component):
 * D-05 in CONTEXT.md says the modal MUST remember its state across
 * open/close cycles — the user should be able to search, click a wrong
 * result, come back, and see the same query and accumulated results still
 * there. If the state lived inside the component, modal unmount would
 * discard it. Module-scoped `let state` + `useSyncExternalStore` is the
 * established two-tier pattern (mirror of conversation-store.ts:2345-2424
 * archived-rows slice).
 *
 * D-06 empty-state gate: the placeholder "type a query and press Enter"
 * only renders on FIRST-EVER open OR after the user explicitly clears the
 * input. That's what `hasEverOpened` tracks. `clearSearch()` deliberately
 * does NOT reset `hasEverOpened` — after a search-then-clear the empty
 * state should NOT reappear (the user has already "used" the modal in this
 * page-load).
 *
 * Not persisted to localStorage: search results are transient (in-memory
 * only, page-load lifetime). Reloading the page clears everything by
 * design; the D-05 persistence is only "across modal opens", not across
 * page reloads (RESEARCH.md Assumption A3).
 */

import { useSyncExternalStore } from "react";
import type { ConversationSearchResult } from "@/api/conversation-search-api";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface SearchState {
  query: string; // last-fired query (updated at startNewSearch); also seeds the input on reopen
  results: ConversationSearchResult[]; // accumulated across load-more calls
  hasMore: boolean; // backend hasMore from the most recent response
  isFetching: boolean; // true while a request is in flight (bounds the load-more disabled state)
  hasEverOpened: boolean; // D-06 empty-state gate — true after any user interaction
  error: string | null; // backend error-class string (e.g. "query_too_long") or null
}

const INITIAL_STATE: SearchState = {
  query: "",
  results: [],
  hasMore: false,
  isFetching: false,
  hasEverOpened: false,
  error: null,
};

let state: SearchState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

function getSnapshot(): SearchState {
  return state;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribe to the search-store slice. The returned snapshot is stable
 * between mutations (identity-equal), so React re-renders only when a
 * mutator has fired `notify()`.
 */
export function useSearchState(): SearchState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

/**
 * Set the current query string. Also flips `hasEverOpened` true (any
 * typing interaction counts as "the modal has been used"). Does NOT fire
 * the network — D-01 makes Enter the sole trigger.
 */
export function setSearchQuery(q: string): void {
  state = { ...state, query: q, hasEverOpened: true };
  notify();
}

/**
 * Explicit "clear" — the user clicked the X in the input or otherwise
 * requested a wipe. Resets query, results, hasMore, error to initial;
 * PRESERVES `hasEverOpened` so the empty-state placeholder does NOT
 * reappear (D-06 corner).
 */
export function clearSearch(): void {
  state = {
    ...state,
    query: "",
    results: [],
    hasMore: false,
    error: null,
  };
  notify();
}

/**
 * Start a brand-new search (Enter pressed with a non-empty query).
 * Atomically sets query, wipes prior results/hasMore, flips isFetching
 * true, and clears any error. A SINGLE notify() fires so subscribers see
 * one coherent transition (not a flicker of intermediate states).
 */
export function startNewSearch(q: string): void {
  state = {
    query: q,
    results: [],
    hasMore: false,
    isFetching: true,
    hasEverOpened: true,
    error: null,
  };
  notify();
}

/**
 * Append a page of results (from either the initial fetch or a
 * load-more). Concatenates to existing results (D-12 load-more semantics),
 * updates hasMore, flips isFetching false, clears error.
 */
export function appendResults(
  rows: ConversationSearchResult[],
  hasMore: boolean,
): void {
  state = {
    ...state,
    results: [...state.results, ...rows],
    hasMore,
    isFetching: false,
    error: null,
  };
  notify();
}

/**
 * Set the isFetching flag without touching results. Used before a
 * load-more request begins so the load-more button binds `disabled` to
 * this flag (T-122-FE-03 DoS mitigation — user can't rapid-click while a
 * request is in flight). Setting true clears prior error; setting false
 * leaves error alone.
 */
export function setFetching(v: boolean): void {
  state = {
    ...state,
    isFetching: v,
    ...(v ? { error: null } : {}),
  };
  notify();
}

/**
 * Record a backend error-class string (e.g. "query_too_long"). Flips
 * isFetching false. Consumers render this in the modal footer.
 */
export function setError(msg: string): void {
  state = { ...state, error: msg, isFetching: false };
  notify();
}

// ---------------------------------------------------------------------------
// Test helper — NOT exported from any public barrel; ONLY used by tests
// ---------------------------------------------------------------------------

/**
 * Reset the module-scoped state to initial. Vitest re-uses the module
 * across tests in the same file, so the store must be reset in
 * `beforeEach` or state bleeds between tests. Named `_resetForTests` (with
 * a leading underscore) to make its purpose obvious and discourage
 * production consumers.
 */
export function _resetForTests(): void {
  state = { ...INITIAL_STATE };
  notify();
}
