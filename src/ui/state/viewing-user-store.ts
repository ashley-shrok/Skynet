/**
 * Phase 90 Plan 05 Task 1 — viewing-user-store (W#8 resolution).
 *
 * Small state module exposing `useViewingUserMxid(): string | null` — the
 * single source of truth for the viewing user's Matrix mxid. Drives:
 *   (a) IdentityBadgeRow's D-07 self-exclusion filter (viewing user is not
 *       rendered as a badge in the participant row).
 *   (b) RelayMessageList's inbound-vs-outbound bubble discrimination
 *       (events with `sender === viewingUserMxid` render as OutboundBubble;
 *       others render as RelayRoomInboundBubble).
 *
 * ## W#8 sourcing decision (Option A per PLAN.md)
 *
 * The mxid is fetched via `getUserInfo()` (widened in main-axios.ts to
 * carry `mxid?: string | null` on `UserInfo`) rather than a dedicated
 * `/users/me/mxid` endpoint. Rationale: the smallest-diff path — the
 * backend `/users/me` handler simply reads `users.mxid` (Phase 88 slice A
 * durable column) alongside the existing UserInfo fields; no new route,
 * no new client helper, no new integration test.
 *
 * ## Fetch-once semantics
 *
 * The fetch fires exactly once per app-mount. Subsequent hook consumers
 * read the cached value without triggering a re-fetch. If the fetch
 * fails, the cached value stays `null` and a structured warning is logged
 * (never `JSON.stringify` the raw error — PATTERNS.md § 2 discipline).
 *
 * ## Reactive contract
 *
 * The hook subscribes via `useSyncExternalStore`. When the fetch resolves
 * and publishes into the store, all mounted consumers re-render with the
 * new value. Mirrors `session-tmux-store.ts` + `fleet-status-client.ts`'s
 * useSessionContextPct pattern — module-scoped state + Set of listeners.
 */

import { useSyncExternalStore } from "react";
import { getUserInfo } from "@/main-axios";

// ─── Module-scoped state ─────────────────────────────────────────────────────

/**
 * Cached mxid. `null` when: (a) fetch has not yet resolved, (b) fetch failed,
 * or (c) fetch succeeded but the user has no mxid in the DB (pre-Phase-88
 * users). All three cases collapse to the same UX (viewing-user filter is a
 * no-op, everything renders as inbound) — a distinguished "loading" vs
 * "no-mxid" state is not needed at this seam.
 */
let cachedMxid: string | null = null;

/** Listener registry for useSyncExternalStore subscribers. */
const listeners = new Set<() => void>();

/**
 * Fetch state guard — ensures the fetch fires exactly once per app-mount
 * regardless of how many consumers subscribe. `pending` = in flight;
 * `settled` = fetch completed (success or failure) and no further fetch
 * should fire.
 */
type FetchState = "idle" | "pending" | "settled";
let fetchState: FetchState = "idle";

function notifyListeners(): void {
  for (const cb of listeners) cb();
}

/**
 * Kick off the fetch if it has not yet been started. Idempotent — safe to
 * call from every subscriber's mount path; only the first call fires the
 * request. Errors are swallowed at this layer (logged structurally); the
 * store's cached value stays `null` on failure.
 */
function ensureFetch(): void {
  if (fetchState !== "idle") return;
  fetchState = "pending";
  // Fire-and-forget — the .then handler publishes into the store when the
  // response arrives.
  void getUserInfo()
    .then((info) => {
      // Success — cache the mxid (may be null/undefined for pre-Phase-88
      // users; coerce undefined → null so the store has a consistent shape).
      const nextMxid = info.mxid ?? null;
      fetchState = "settled";
      if (nextMxid !== cachedMxid) {
        cachedMxid = nextMxid;
        notifyListeners();
      }
    })
    .catch((err: unknown) => {
      // Structured warn — never JSON.stringify the raw error (PATTERNS.md § 2:
      // Matrix response bodies may contain tokens; SyntheticEvent-like errors
      // may carry huge object graphs). Extract explicit fields only.
      const errMessage =
        err instanceof Error ? err.message : "unknown error";
      // eslint-disable-next-line no-console
      console.warn({
        operation: "viewing_user_mxid_fetch_failed",
        err: errMessage,
      });
      fetchState = "settled";
      // cachedMxid stays null. No notify — value unchanged.
    });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Trigger the fetch on first subscription so the value is populated for
  // consumers as soon as they mount.
  ensureFetch();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  return cachedMxid;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * React hook returning the viewing user's Matrix mxid, or `null` if the
 * fetch has not yet resolved / failed / the user has no mxid in the DB.
 *
 * The hook is deliberately shape-simple: a single nullable string. Callers
 * that need to distinguish "loading" from "no mxid known" should wait for a
 * non-null value before rendering downstream state (RelayRoomPane does this
 * by rendering a small loading indicator while `viewingUserMxid === null`).
 *
 * Fetch semantics: fires ONCE per app-mount on first subscription; all
 * subsequent consumers read the cached value. See module docblock for the
 * W#8 sourcing decision (Option A — extend getUserInfo() rather than add a
 * dedicated endpoint).
 */
export function useViewingUserMxid(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─── Test hooks (not part of the public API) ─────────────────────────────────

/**
 * TEST ONLY — reset the module-scoped store so each test starts from a clean
 * slate (no cached mxid, no in-flight fetch). NOT a public API.
 */
export function __resetViewingUserStoreForTests(): void {
  cachedMxid = null;
  fetchState = "idle";
  listeners.clear();
}
