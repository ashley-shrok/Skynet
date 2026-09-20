// ─── Feedback-enabled store (Phase 121 Plan 02) ──────────────────────────────
// Module-scoped in-memory store for the "is feedback configured?" boolean
// signal (per Phase 121 CONTEXT D-08). Sourced exclusively from the
// authenticated GET /api/feedback/enabled fetch fired by feedback-fetch.ts
// AFTER the user has logged in (auth-gated route — contrast with
// pre-login /api/branding). Mirrors src/ui/branding/branding-store.ts
// verbatim, simplified from a full BrandingConfig object to a single boolean.
//
// Purpose: gives any surface component (Plan 04's dev-trigger, Plan 121-shape-2's
// general button, Plan 121-shape-3's message-thumbs affordances) O(1) access
// to whether feedback is enabled on this instance, without prop-drilling and
// without a React Context wrapper (see anti-pattern note below).
//
// Storage layer: NONE. In-memory only. A page refresh triggers a re-fetch
// against /api/feedback/enabled (Plan 03's backend route). Default is false
// until the fetch resolves — D-08 default-disabled sentinel keeps all
// feedback UI hidden on first paint if the backend never reaches us.
//
// Anti-pattern note: DO NOT introduce a React Context provider for this — there
// are ZERO Context providers used for app-scoped state anywhere in the
// codebase; all shared state is useSyncExternalStore singletons under
// src/ui/state/ and src/ui/branding/ (per 70-RESEARCH.md L46+L201). Adding a
// Context would introduce a wrapper hierarchy for a single boolean. NO React
// Context provider for this state — module-scoped useSyncExternalStore
// singleton, same as branding-store.ts and session-tmux-store.ts.
//
// Threat model (from 121-02-PLAN.md):
//   T-121-05 (Tampering) — publishFeedbackEnabled is only called from
//     feedback-fetch.ts after the isFeedbackEnabledResponse shape guard;
//     malformed server responses never reach this writer.

import { useSyncExternalStore } from "react";

// ─── Module-scoped state ─────────────────────────────────────────────────────

let state: { enabled: boolean } = { enabled: false };

let snapshotVersion = 0;

const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Set the feedback-enabled flag and notify subscribers.
 *
 * Called by feedback-fetch.ts once after the /api/feedback/enabled response
 * has passed the isFeedbackEnabledResponse shape guard. May in principle be
 * called again by a future refresh path — the same-value guard ensures
 * repeated calls with identical values are no-ops.
 *
 * No-op guard: `state.enabled === next` is a cheap boolean equality — simpler
 * than the JSON.stringify comparison used in branding-store.ts (which handles
 * an object with multiple fields). For a single boolean, reference equality
 * IS value equality.
 *
 * Structured logging per fleet directive (analog: branding-store.ts L141-146).
 */
export function publishFeedbackEnabled(next: boolean): void {
  if (state.enabled === next) {
    // No-op: identical value already published — skip notify to avoid
    // spurious re-renders in subscribers.
    return;
  }

  console.info({
    operation: "feedback_enabled_publish",
    previous: state.enabled,
    next,
  });

  state = { enabled: next };
  notify();
}

/**
 * Hook: return the current feedback-enabled flag.
 *
 * getServerSnapshot === getSnapshot: this store has no SSR concerns and the
 * initial state is the same in-memory value on every render path.
 */
export function useFeedbackEnabled(): boolean {
  const getSnapshot = (): boolean => state.enabled;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Unused-variable reference to suppress TypeScript "declared but never read"
// for snapshotVersion — mirrors branding-store.ts L170 / session-tmux-store.ts L181.
void snapshotVersion;

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to {enabled:false} + notify subscribers. Used by any test
 * `beforeEach` so each test starts from a known-clean state. NOT a public
 * API — Vite's tree-shaker drops it from the production bundle when no
 * production code imports it.
 */
export function __resetForTest(): void {
  state = { enabled: false };
  notify();
}
