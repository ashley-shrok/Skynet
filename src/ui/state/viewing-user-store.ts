/**
 * Phase 90 Plan 05 Task 1 — viewing-user-store (W#8 resolution).
 *
 * Small state module exposing `useViewingUserMxid(): string | null` — the
 * single source of truth for the viewing user's Matrix mxid. Drives:
 *   (a) MultiBadgeAnchor's D-03 self-exclusion filter (viewing user is not
 *       rendered as a badge in the participant row of the shared chat
 *       surface per Phase 93 Slice 2).
 *   (b) PrettyView's shared inbound-vs-outbound bubble discrimination via
 *       RelayInboundBubble (events with `sender === viewingUserMxid` render
 *       as OutboundBubble; others render as RelayInboundBubble per Phase 93
 *       Slice 3).
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

/**
 * L2 fixup 2026-09-09: cached userId, sourced from the SAME `/users/me`
 * response that populates `cachedMxid`. Threaded through to the relay-
 * room pane so structured logs carry the real userId instead of the
 * hardcoded `0` placeholder that used to pollute ops-grep. Null in the
 * same three cases as `cachedMxid` (fetch not yet resolved, fetch failed,
 * or backend response omitted the field).
 */
let cachedUserId: string | null = null;

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
      // L2 fixup 2026-09-09: also cache the userId from the SAME response.
      // Backend guarantees `userId: string` when the fetch succeeds; we
      // still coerce non-string / empty to null defensively.
      const nextUserId =
        typeof info.userId === "string" && info.userId.length > 0
          ? info.userId
          : null;
      fetchState = "settled";
      const mxidChanged = nextMxid !== cachedMxid;
      const userIdChanged = nextUserId !== cachedUserId;
      if (mxidChanged) cachedMxid = nextMxid;
      if (userIdChanged) cachedUserId = nextUserId;
      if (mxidChanged || userIdChanged) notifyListeners();
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
      // cachedMxid / cachedUserId stay null. No notify — value unchanged.
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

function getUserIdSnapshot(): string | null {
  return cachedUserId;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * React hook returning the viewing user's Matrix mxid, or `null` if the
 * fetch has not yet resolved / failed / the user has no mxid in the DB.
 *
 * The hook is deliberately shape-simple: a single nullable string. Callers
 * that need to distinguish "loading" from "no mxid known" should wait for a
 * non-null value before rendering downstream state (PrettyView with relay
 * source does this validation via useRelayAdapter per Phase 93 Slice 3 —
 * the adapter is inert while `viewingUserMxid === null` and the shared
 * chat surface's loading affordances cover the pending state).
 *
 * Fetch semantics: fires ONCE per app-mount on first subscription; all
 * subsequent consumers read the cached value. See module docblock for the
 * W#8 sourcing decision (Option A — extend getUserInfo() rather than add a
 * dedicated endpoint).
 */
export function useViewingUserMxid(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * L2 fixup 2026-09-09: React hook returning the viewing user's userId
 * (string from the Skynet users table), or `null` in the same three cases
 * as `useViewingUserMxid` (fetch pending, fetch failed, backend omitted
 * the field). Sourced from the SAME `/users/me` response — combining
 * both hooks costs zero extra network round-trips.
 *
 * Used by useRelayAdapter (the shared chat surface's relay source per Phase
 * 93 Slice 3) so its structured logs carry the real userId instead of the
 * previous hardcoded `0` placeholder that polluted ops-grep across every
 * log line the relay-source path emits.
 */
export function useViewingUserId(): string | null {
  return useSyncExternalStore(subscribe, getUserIdSnapshot, getUserIdSnapshot);
}

// ─── Test hooks (not part of the public API) ─────────────────────────────────

/**
 * TEST ONLY — reset the module-scoped store so each test starts from a clean
 * slate (no cached mxid/userId, no in-flight fetch). NOT a public API.
 */
export function __resetViewingUserStoreForTests(): void {
  cachedMxid = null;
  cachedUserId = null;
  fetchState = "idle";
  listeners.clear();
}
