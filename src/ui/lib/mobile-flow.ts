// ─── mobile-flow ──────────────────────────────────────────────────────────────
// The mobile list-vs-view state machine. Reads/writes an `mv=1` key in the URL
// fragment (NOT the query string — see patch #25 and tab-url.ts's module
// doc-comment for the Chrome-window-restore lesson that forced fragment
// storage) and exposes a small React hook + imperative action functions so
// AppShell's mobile branch (Plan 06-03) can render either the full-screen
// conversation list ("list") or the full-screen conversation view ("view").
//
// Design notes:
//   - Module-scoped subscription with useSyncExternalStore. Matches the
//     idiom used by conversation-store.ts (Plan 06-01) and jsdom-friendly
//     per Plan 06-02's tests.
//   - `mv=1` layers onto the existing `#tab=X&tab=Y&active=N&only=1` fragment
//     via WorkspaceSpec.mobileView (tab-url.ts) — same URLSearchParams-based
//     encoding, so patch #25's parser continues to see `tab=` untouched.
//   - navigateToView uses history.pushState with a sentinel state object,
//     so the browser back gesture pops the entry and lands the user on the
//     list. navigateToList prefers history.back() when the state sentinel
//     is present, else strips `mv` via replaceState (the "pasted a deep
//     mv=1 URL and pressed back" edge case exits the app, per shape).
//   - Viewport-agnostic. This module never reads `useIsTouchDevice()` — the
//     AppShell caller is responsible for gating mobile-flow reads/writes on
//     `isTouchDevice`. That keeps mobile-flow trivial to unit-test with
//     just window.location.hash manipulation.
//   - Zero new npm dependencies. Uses Web platform APIs only.

import { useSyncExternalStore } from "react";

export type MobileScreen = "list" | "view";

const MV_KEY = "mv";
const MV_VALUE = "1";
const HISTORY_STATE_SENTINEL = "__skynetMobileView";

// Module-scoped listener registry. Mirrors the conversation-store subscribe
// pattern (Plan 06-01) so useSyncExternalStore + jsdom play together cleanly.
let listeners = new Set<() => void>();
let currentScreen: MobileScreen = readScreenFromLocation();

function readScreenFromLocation(): MobileScreen {
  if (typeof window === "undefined") return "list";
  const hash = window.location.hash;
  if (hash.length <= 1) return "list";
  const params = new URLSearchParams(hash.slice(1));
  return params.get(MV_KEY) === MV_VALUE ? "view" : "list";
}

function emit() {
  for (const listener of listeners) listener();
}

function recomputeAndMaybeEmit() {
  const next = readScreenFromLocation();
  if (next !== currentScreen) {
    currentScreen = next;
    emit();
  }
}

// Wire the browser-side listeners exactly once at module load. hashchange
// fires when `window.location.hash =` is assigned; popstate fires on user
// back/forward gestures AND on `history.back()`. Both need the same
// recompute-and-emit path.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", recomputeAndMaybeEmit);
  window.addEventListener("popstate", recomputeAndMaybeEmit);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MobileScreen {
  return currentScreen;
}

// SSR-safe snapshot for useSyncExternalStore; matches conversation-store's
// approach of returning the initial state.
function getServerSnapshot(): MobileScreen {
  return "list";
}

export function useMobileScreen(): MobileScreen {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Imperative navigation actions. Called by AppShell's mobile branch on
// conversation-row taps (view) and the back-button click / popstate (list).

export function navigateToView(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.slice(1));
  if (hashParams.get(MV_KEY) === MV_VALUE) {
    // Already on the view screen — no-op. Keeps repeated row taps from
    // stacking history entries.
    return;
  }
  hashParams.set(MV_KEY, MV_VALUE);
  const nextHash = "#" + hashParams.toString();
  const nextUrl = url.pathname + url.search + nextHash;
  // pushState so the browser back-stack has the "list" entry to return to.
  // Sentinel on history.state lets navigateToList prefer history.back()
  // over replaceState so the browser back-stack stays consistent with the
  // user's mental model.
  window.history.pushState({ [HISTORY_STATE_SENTINEL]: true }, "", nextUrl);
  // pushState does NOT fire hashchange or popstate — manually recompute
  // and notify subscribers so React re-renders in the same tick.
  const next = readScreenFromLocation();
  if (next !== currentScreen) {
    currentScreen = next;
    emit();
  }
}

export function navigateToList(): void {
  if (typeof window === "undefined") return;
  const state = window.history.state as
    | { [HISTORY_STATE_SENTINEL]?: boolean }
    | null;
  if (state && state[HISTORY_STATE_SENTINEL]) {
    // The current history entry is our own pushState from navigateToView.
    // Prefer history.back() so the browser back-stack stays consistent —
    // popstate will fire and recomputeAndMaybeEmit will pick up the hash
    // change.
    window.history.back();
    return;
  }
  // Fallback: user landed on this URL directly (pasted `#mv=1` link,
  // Chrome window-restore) with no prior list entry in the back-stack.
  // Strip `mv=1` via replaceState so browser back doesn't leave the app
  // unnecessarily. The pasted-URL back-exits-the-app edge case is
  // acceptable per the shape's "browser back also works" requirement.
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.slice(1));
  hashParams.delete(MV_KEY);
  const rest = hashParams.toString();
  const nextHash = rest ? "#" + rest : "";
  const nextUrl = url.pathname + url.search + nextHash;
  window.history.replaceState({}, "", nextUrl);
  // replaceState also doesn't fire hashchange — manually recompute.
  const next = readScreenFromLocation();
  if (next !== currentScreen) {
    currentScreen = next;
    emit();
  }
}

// ─── Test-only helpers ──────────────────────────────────────────────────────
// Exported so vitest specs can reset module-scoped state between cases.
// Not part of the public API — production code should never call these.

export function __resetMobileFlowForTest(): void {
  listeners = new Set();
  currentScreen = readScreenFromLocation();
}

export function __recomputeForTest(): void {
  recomputeAndMaybeEmit();
}
