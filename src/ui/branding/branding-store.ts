// ─── Branding config store (Phase 70 Plan 03) ────────────────────────────────
// Module-scoped in-memory store for the branding config. Sourced exclusively
// from the pre-login GET /api/branding fetch kicked off at boot from main.tsx.
// Mirrors src/ui/state/session-tmux-store.ts in shape (state + listeners +
// notify + subscribe + useSyncExternalStore hook), simplified to hold a single
// global object rather than a keyed Map.
//
// Purpose: gives any surface component (AppShell tab title, PrettyConversations
// header, Auth login header, favicon effect) O(1) access to the operator's
// branding config without prop-drilling and without a React Context wrapper
// (see anti-pattern note below).
//
// Notify contract: typically a single publishBrandingConfig() call per page
// lifecycle (fetch resolves once at boot). Per-write no-op guard via
// JSON.stringify equality on the whole object — cheap because the config is
// tiny (~6 fields) and defends against any future refetch path that would
// otherwise re-notify with an identical config.
//
// Storage layer: NONE. In-memory only. A page refresh triggers a re-fetch
// against /api/branding (which is Cache-Control: no-store per Plan 70-01).
//
// Initial state: bundled-default sentinel that matches
// docker/branding-defaults/branding.json byte-for-byte (appName="Skynet", etc.
// per Plan 70-01 D-14). First-paint is defensible even if the fetch never
// resolves — the sentinel keeps the store readable and consistent from tick 0.
// This is the Pitfall 5 mitigation from 70-RESEARCH.md.
//
// Anti-pattern note: DO NOT introduce a React Context provider for this — there
// are ZERO Context providers used for app-scoped state anywhere in the
// codebase; all shared state is useSyncExternalStore singletons under
// src/ui/state/ (per 70-RESEARCH.md L46+L201). Adding a Context would
// introduce a wrapper hierarchy for a single value. Likewise DO NOT install
// external state-management or head-management packages — codebase house
// style is imperative DOM updates for <head> mutations (favicon,
// document.title). See 70-RESEARCH.md § "Standard Stack" for the full ban
// list rationale.
//
// Threat model:
//   T-70-03-01 (Tampering) — publishBrandingConfig is only called from
//     branding-fetch.ts after the isBrandingConfig shape guard; malformed
//     server responses never reach this writer.
//   T-70-03-03 (Info Disclosure) — appName is inherently a public display
//     value; the structured console.info transition log leaks nothing a user
//     wouldn't already see rendered in the tab title.

import { useSyncExternalStore } from "react";

// ─── Public type ─────────────────────────────────────────────────────────────

export type BrandingConfig = {
  appName: string;
  shortName: string;
  iconPath: string;
  wordmarkPath: string;
  faviconPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  // Phase 74 (avatar-style-through-branding-config) — required extended fields.
  // MUST match backend src/backend/branding/branding-config-loader.ts
  // BrandingConfig field-for-field, in the same order. Wire-format contract:
  // GET /api/branding publishes the whole config; a shape mismatch here
  // becomes a TypeScript compile error at the consumer. No React component
  // reads these fields in Phase 74 (per 74-CONTEXT.md OUT-OF-SCOPE: no UI
  // edit affordance) — the mirror exists solely to preserve type-safety
  // across the wire boundary.
  avatarDirectorSpec: string;
  avatarGammaDefault: number;
};

// ─── Bundled-default sentinel ────────────────────────────────────────────────
//
// Byte-for-byte match with docker/branding-defaults/branding.json (Plan 70-01).
// Extracted into a function so __resetForTest() and the initial state assign
// both reference the same canonical shape without accidental aliasing between
// tests (each call returns a fresh object).

function getBundledDefaultsSentinel(): BrandingConfig {
  return {
    appName: "Skynet",
    shortName: "Skynet",
    iconPath: "/branding/icon.png",
    wordmarkPath: "/branding/wordmark.png",
    faviconPath: "/branding/favicon.svg",
    pwaIcons: [
      { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Phase 74: values MUST match docker/branding-defaults/branding.json
    // byte-for-byte (Plan 70-01 D-14 + Pitfall 5 mitigation contract).
    // avatarDirectorSpec is empty on purpose — the boot gate in Plan 02
    // requires operator to set it; a non-empty sentinel would defeat the gate.
    avatarDirectorSpec: "",
    avatarGammaDefault: 0.7,
  };
}

// ─── Module-scoped state ─────────────────────────────────────────────────────

let state: BrandingConfig = getBundledDefaultsSentinel();

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
 * Replace the branding config wholesale and notify subscribers.
 *
 * Called by branding-fetch.ts once at app boot after the /api/branding
 * response has passed the isBrandingConfig shape guard. May in principle be
 * called again by a future refresh path — the JSON.stringify equality guard
 * ensures repeated calls with identical configs are no-ops.
 *
 * No-op guard: JSON.stringify(state) === JSON.stringify(next). The config is
 * tiny (~6 scalar fields + a 2-element array); stringify is cheap and does
 * a correct deep-equal check for the whole shape without adding a helper.
 *
 * Structured logging per fleet directive (analog: session-tmux-store.ts L100).
 */
export function publishBrandingConfig(next: BrandingConfig): void {
  if (JSON.stringify(state) === JSON.stringify(next)) {
    // No-op: identical config already published — skip notify.
    return;
  }

  console.info({
    operation: "branding_config_publish",
    previous: state.appName,
    next: next.appName,
  });

  state = next;
  notify();
}

/**
 * Hook: return the current branding config.
 *
 * Single global read (not per-key like session-tmux-store's useSessionTmuxName)
 * — the whole config object is returned, and any change to it re-renders the
 * subscribing component. Since publishBrandingConfig is typically called once
 * per page lifecycle, subscribing components re-render at most once after boot
 * (transition from defaults sentinel → operator config).
 *
 * getServerSnapshot === getSnapshot: this store has no SSR concerns and the
 * initial state is the same in-memory value on every render path.
 */
export function useBrandingConfig(): BrandingConfig {
  const getSnapshot = (): BrandingConfig => state;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Unused-variable reference to suppress TypeScript "declared but never read"
// for snapshotVersion — mirrors session-tmux-store.ts L181.
void snapshotVersion;

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to the bundled-default sentinel + bump version + notify.
 * Used by any future branding-store.test.ts's `beforeEach` so each test starts
 * from a known-clean state. NOT a public API — Vite's tree-shaker drops it
 * from the production bundle when no production code imports it.
 */
export function __resetForTest(): void {
  state = getBundledDefaultsSentinel();
  notify();
}
