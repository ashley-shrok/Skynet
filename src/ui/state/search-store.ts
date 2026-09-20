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

// Monotonic request generation counter. Every request-start (startNewSearch,
// beginLoadMore) bumps this and returns the new id. Callers snapshot the id
// before the fetch and pass it to appendResults/setError on resolve; the
// finishers no-op if a newer request has since started. Prevents stale-
// request writes from clobbering fresh state (query "foo" in flight, user
// changes to "bar", "foo" response lands on "bar" state).
let currentRequestId = 0;

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
 * true, and clears any error. Bumps the request-id counter and returns
 * the new id — callers snapshot it before the fetch and pass it to
 * appendResults/setError so a stale response can be discarded if the user
 * fired a newer query in the meantime.
 */
export function startNewSearch(q: string): number {
  currentRequestId += 1;
  state = {
    query: q,
    results: [],
    hasMore: false,
    isFetching: true,
    hasEverOpened: true,
    error: null,
  };
  notify();
  return currentRequestId;
}

/**
 * Begin a load-more request. Flips isFetching true (leaves results/query
 * alone), bumps the request-id counter, returns the new id. Same
 * stale-guard contract as startNewSearch. Replaces the pre-fix
 * setFetching(true) call at the load-more site.
 */
export function beginLoadMore(): number {
  currentRequestId += 1;
  state = { ...state, isFetching: true, error: null };
  notify();
  return currentRequestId;
}

/**
 * Append a page of results (from either the initial fetch or a
 * load-more). Guarded by requestId — a stale response (one whose id no
 * longer matches currentRequestId) is silently dropped. Dedups by
 * transcriptPath to prevent React duplicate-key warnings + repeat rows
 * when mtimes shift between the initial fetch and a load-more (D-12
 * correctness edge). Concatenates only rows whose transcriptPath is not
 * already in state.results.
 */
export function appendResults(
  rows: ConversationSearchResult[],
  hasMore: boolean,
  requestId: number,
): void {
  if (requestId !== currentRequestId) return;
  const seen = new Set(state.results.map((r) => r.transcriptPath));
  const deduped = rows.filter((r) => !seen.has(r.transcriptPath));
  state = {
    ...state,
    results: [...state.results, ...deduped],
    hasMore,
    isFetching: false,
    error: null,
  };
  notify();
}

/**
 * Record a backend error-class string (e.g. "query_too_long"). Guarded by
 * requestId — a stale error from a superseded request is silently
 * dropped. Flips isFetching false when applied. Consumers render this in
 * the modal footer.
 */
export function setError(msg: string, requestId: number): void {
  if (requestId !== currentRequestId) return;
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
  currentRequestId = 0;
  state = { ...INITIAL_STATE };
  notify();
}

/**
 * Test helper — read the current request-id counter for assertions.
 * Production code should NEVER call this; the id is opaque outside of
 * the fetch guard flow.
 */
export function _currentRequestIdForTests(): number {
  return currentRequestId;
}
