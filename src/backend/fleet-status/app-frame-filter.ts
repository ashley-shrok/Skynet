/**
 * app-frame-filter.ts
 *
 * Phase 118 Plan 118-05 (D-15, D-16): per-user host-visibility filter for the
 * three source-C app frame kinds (`app-snapshot`, `app-update`, `app-gone`).
 * FIRST fleet-status caller of checkHostAccess in the codebase (RESEARCH § Q4
 * grep-verified — the export site is the only pre-118-05 hit). Designed as an
 * adoptable pattern: future identity-frame filtering (D-15's "or will be"
 * language) can wrap identity frames through the same shape.
 *
 * Contract:
 *   - `app-update` / `app-gone` / `gone` / `update`  →
 *     one checkHostAccess call per frame; return the frame or null.
 *   - `app-snapshot` / `snapshot` / `project-list-changed`  → checkHostAccess
 *     per unique hostId in the frame (Promise.all); return a projected COPY
 *     of the frame with only visible entries (empty result is still a valid
 *     frame — the emit happened).
 *   - `pong` and any future frame types  → verbatim pass-through (defense in
 *     depth).
 *
 * Backward-compat guard: `ctx.userId === undefined` → pass every frame
 * through unchanged. Matches the existing bare `subscribe(sendFrame)` shape
 * used by the pre-Phase-39 tests (subscription-registry.test.ts) and any
 * future harness that skips auth.
 *
 * Fail-closed on unknown hosts (resolveHostOwnerById → null) and on
 * checkHostAccess errors — matches the intrinsic `catch { return false }`
 * shape of checkHostAccess itself (host-resolver.ts L515-517).
 *
 * TTL cache (default 30s, RESEARCH § A3) bounds PermissionManager hits — a
 * subscriber with N hosts and a 2s sweep cadence sees N cache-miss checks in
 * the first tick, then cache hits until TTL expiry. Permission-change
 * propagation latency ≤ TTL (the user grants access rarely; 30s staleness is
 * acceptable per D-15 threat register T-118-05-CE).
 */
import { checkHostAccess as defaultCheckHostAccess } from "../ssh/host-resolver.js";
import { systemLogger } from "../utils/logger.js";
import type { AppState, FrontendOutboundFrameType } from "./wire-protocol.js";
import {
  makeAppSnapshotFrame,
  makeProjectListChangedFrame,
  makeSnapshotFrame,
} from "./wire-protocol.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Injectable checkHostAccess signature. Defaults to the imported real one at
 * factory-construction time; tests may pass a mock to `filterAppFrame` or
 * `createAppFrameFilter` for hermetic behavior without vi.mock.
 */
export type CheckHostAccessFn = (
  hostId: number,
  userId: string,
  hostUserId: string,
  requiredPermission: "read" | "execute",
) => Promise<boolean>;

/**
 * Filter context passed per-call to filterAppFrame. `userId` is optional
 * (bare subscribers skip filtering per the backward-compat guard);
 * `resolveHostOwnerById` maps the wire-shaped hostId string used inside
 * fleet-status frames to the (numeric hostId, hostUserId) pair
 * checkHostAccess requires. The resolver is INJECTED — this file owns no
 * DB access.
 *
 * Phase 129 Plan 129-05 (D-2, D-7): the identity-name visibility gate is
 * INJECTED via `resolveIdentityGate`. A closure supplied by the production
 * wiring site (starter.ts / fleet-status-server.ts) reads identity + role
 * frontmatter over SSH, applies `isIdentityVisibleToUser`, and returns a
 * boolean. Keeping this file free of artifact-reader / DB / SSH imports
 * preserves the L66-68 discipline that pre-Phase-129 already documented.
 * Every frame branch that carries an identity name (`update`, `snapshot`,
 * `gone`, `session-project-changed`) MUST invoke this gate AFTER the host
 * gate. (`identity-archived` retired in the Phase 122 shape follow-up.)
 */
export interface AppFrameFilterCtx {
  userId?: string;
  resolveHostOwnerById: (
    hostIdStr: string,
  ) => Promise<{ hostIdNum: number; hostUserId: string } | null>;
  /**
   * Phase 129 Plan 129-05: per-frame identity-name visibility gate.
   * Called AFTER `canUserSee(hostIdStr)` passes; MUST NOT be invoked when
   * the host gate has already closed (defense-in-depth + efficiency —
   * Test J lock). Fail-CLOSED on throw (deny frame; WS frames are less
   * recoverable than REST lists because a leaked frame updates a live
   * sidebar in real time) — mirrors the `canUserSee` catch-and-return-
   * false shape at L185-198. Injected as a closure so this file owns no
   * DB / SSH / artifact-reader imports.
   */
  resolveIdentityGate: (
    identityName: string,
    hostIdStr: string,
    userId: string,
  ) => Promise<boolean>;
}

/**
 * Small per-(userId, hostIdStr) TTL cache. Default TTL = 30s. Cache is per
 * server-instance and dies with the process (no persistence — same D-10
 * discipline the apps map itself uses). Backing store is a Map<string, {
 * value: boolean; expiresAt: number }> keyed on `${userId}:${hostIdStr}`.
 * `get` returns undefined on miss OR stale (also deletes stale entries on
 * read); `set` writes with `expiresAt = Date.now() + ttlMs`.
 */
export interface AccessCache {
  get(userId: string, hostIdStr: string): boolean | undefined;
  set(userId: string, hostIdStr: string, value: boolean): void;
}

/**
 * Async filter shape produced by `createAppFrameFilter` and consumed by the
 * subscription-registry's `deps.appFrameFilter`. Takes the frame + the
 * subscribing user's userId (optional — bare subscribers pass through) and
 * returns the projected frame or null (drop).
 */
export type AppFrameFilter = (
  frame: FrontendOutboundFrameType,
  userId?: string,
) => Promise<FrontendOutboundFrameType | null>;

// ---------------------------------------------------------------------------
// Cache implementation
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 30_000;

export function createAccessCache(ttlMs: number = DEFAULT_TTL_MS): AccessCache {
  const store = new Map<string, { value: boolean; expiresAt: number }>();

  function key(userId: string, hostIdStr: string): string {
    return `${userId}:${hostIdStr}`;
  }

  return {
    get(userId, hostIdStr) {
      const k = key(userId, hostIdStr);
      const entry = store.get(k);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= Date.now()) {
        // Stale — evict on read.
        store.delete(k);
        return undefined;
      }
      return entry.value;
    },
    set(userId, hostIdStr, value) {
      store.set(key(userId, hostIdStr), {
        value,
        expiresAt: Date.now() + ttlMs,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Core filter
// ---------------------------------------------------------------------------

/**
 * Filter one outbound frame against a subscriber's userId. See file header
 * for contract details. The optional `cache` and `_checkHostAccess`
 * parameters exist for two reasons:
 *   1. Tests can pass a mock checkHostAccess without vi.mock.
 *   2. The production path (via createAppFrameFilter) closes over a shared
 *      AccessCache so TTL hits persist across fan-outs.
 */
export async function filterAppFrame(
  frame: FrontendOutboundFrameType,
  ctx: AppFrameFilterCtx,
  cache?: AccessCache,
  _checkHostAccess: CheckHostAccessFn = defaultCheckHostAccess,
): Promise<FrontendOutboundFrameType | null> {
  // Backward-compat: bare subscribers (no userId) pass through unchanged.
  // Matches the existing subscribe(sendFrame) shape used by pre-Phase-39
  // tests and any test harness that skips auth.
  if (ctx.userId === undefined) {
    return frame;
  }
  const userId = ctx.userId;

  // Internal per-hostId visibility check. Cache-first; on miss, resolve the
  // host record, call checkHostAccess("read"), and cache the boolean.
  async function canUserSee(hostIdStr: string): Promise<boolean> {
    const cached = cache?.get(userId, hostIdStr);
    if (cached !== undefined) {
      return cached;
    }

    let allowed: boolean;
    try {
      const owner = await ctx.resolveHostOwnerById(hostIdStr);
      if (owner === null) {
        // Deny-by-default on unknown host (Test 9) — safer than allow.
        // A stale-host frame slipping through the filter would leak
        // metadata about a host the user can't map (the identifier
        // itself is the leak).
        allowed = false;
      } else {
        allowed = await _checkHostAccess(
          owner.hostIdNum,
          userId,
          owner.hostUserId,
          "read",
        );
      }
    } catch (err) {
      // Deny-by-default on error (Test 10) — matches checkHostAccess's own
      // catch-and-return-false shape (host-resolver.ts L515-517).
      systemLogger.warn(
        "Fleet-status app-frame filter — checkHostAccess/resolver threw; denying",
        {
          operation: "app_frame_filter_error",
          userId,
          hostIdStr,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      allowed = false;
    }

    cache?.set(userId, hostIdStr, allowed);
    return allowed;
  }

  /**
   * Phase 129 Plan 129-05 (D-2, D-7): per-identity visibility check.
   * Delegates to the injected `ctx.resolveIdentityGate` closure — this
   * file owns no artifact-reader / SSH / DB imports (L66-68 discipline).
   *
   * Fail-CLOSED on resolver throw (deny frame). WS frames are less
   * recoverable than REST lists because a leaked frame updates a live
   * sidebar in real time; mirrors the `canUserSee` catch-and-return-
   * false shape at L185-198. NO cache in v1 (Assumption A3 lock) —
   * per-request fresh reads preserve the "picked up on next read"
   * shape-file promise; add a 2-5s TTL cache in a follow-up phase if
   * SSH profiling shows the per-call cost is prohibitive.
   */
  async function canUserSeeIdentity(
    identityName: string,
    hostIdStr: string,
  ): Promise<boolean> {
    try {
      return await ctx.resolveIdentityGate(identityName, hostIdStr, userId);
    } catch (err) {
      systemLogger.warn(
        "Fleet-status app-frame filter — identity gate resolver threw; denying",
        {
          operation: "app_frame_filter_identity_gate_error",
          userId,
          hostIdStr,
          identityName,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      return false;
    }
  }

  if (frame.type === "app-update") {
    return (await canUserSee(frame.app.hostId)) ? frame : null;
  }

  if (frame.type === "app-gone") {
    return (await canUserSee(frame.hostId)) ? frame : null;
  }

  if (frame.type === "gone") {
    return (await canUserSee(frame.hostId)) ? frame : null;
  }

  if (frame.type === "update") {
    return (await canUserSee(frame.state.hostId)) ? frame : null;
  }

  if (frame.type === "snapshot") {
    // Same projection shape as app-snapshot below. Empty states array short-
    // circuits (no filter calls needed — an empty snapshot proves the emit
    // happened and the frontend renders empty state gracefully).
    const states = frame.states;
    if (states.length === 0) {
      return frame;
    }

    const uniqueHostIds = Array.from(new Set(states.map((s) => s.hostId)));
    const visibility = await Promise.all(
      uniqueHostIds.map(async (hid) => [hid, await canUserSee(hid)] as const),
    );
    const visible = new Set(
      visibility.filter(([, ok]) => ok).map(([hid]) => hid),
    );

    const projectedStates = states.filter((s) => visible.has(s.hostId));
    return makeSnapshotFrame(projectedStates);
  }

  if (frame.type === "project-list-changed") {
    const projects = frame.projects;
    if (projects.length === 0) {
      return frame;
    }

    const uniqueHostIds = Array.from(new Set(projects.map((p) => p.hostId)));
    const visibility = await Promise.all(
      uniqueHostIds.map(async (hid) => [hid, await canUserSee(hid)] as const),
    );
    const visible = new Set(
      visibility.filter(([, ok]) => ok).map(([hid]) => hid),
    );

    const projectedProjects = projects.filter((p) => visible.has(p.hostId));
    return makeProjectListChangedFrame(projectedProjects);
  }

  if (frame.type === "app-snapshot") {
    // Collect unique hostIds, check in parallel, filter the apps array.
    // Return a NEW frame (do not mutate the input). Empty result is still a
    // valid app-snapshot with apps: [] — proves the emit happened; frontend
    // renders empty state gracefully.
    const apps = frame.apps;
    if (apps.length === 0) {
      return frame;
    }

    const uniqueHostIds = Array.from(new Set(apps.map((a) => a.hostId)));
    const visibility = await Promise.all(
      uniqueHostIds.map(async (hid) => [hid, await canUserSee(hid)] as const),
    );
    const visible = new Set(
      visibility.filter(([, ok]) => ok).map(([hid]) => hid),
    );

    const projectedApps: AppState[] = apps.filter((a) => visible.has(a.hostId));
    return makeAppSnapshotFrame(projectedApps);
  }

  // Unmigrated frame types pass through verbatim (defense in depth). See file
  // header Contract.
  return frame;
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

export interface CreateAppFrameFilterDeps {
  resolveHostOwnerById: AppFrameFilterCtx["resolveHostOwnerById"];
  /**
   * Phase 129 Plan 129-05 (D-2, D-7): identity-name gate resolver injected
   * from starter.ts / fleet-status-server.ts. See `AppFrameFilterCtx`
   * JSDoc above for contract (fail-closed on throw; no cache in v1).
   */
  resolveIdentityGate: AppFrameFilterCtx["resolveIdentityGate"];
  ttlMs?: number;
  /**
   * Test seam — inject a mock checkHostAccess without vi.mock. Production
   * callers (starter.ts / fleet-status-server.ts) omit this and get the
   * real host-resolver.checkHostAccess.
   */
  _checkHostAccess?: CheckHostAccessFn;
}

/**
 * Build a production-ready AppFrameFilter with an internal 30s TTL cache
 * scoped to the returned closure. Wire this into
 * `createSubscriptionRegistry({ appFrameFilter })` — the registry's async
 * fanOutApp path calls it per subscriber per app frame.
 */
export function createAppFrameFilter(
  deps: CreateAppFrameFilterDeps,
): AppFrameFilter {
  const cache = createAccessCache(deps.ttlMs ?? DEFAULT_TTL_MS);
  const check = deps._checkHostAccess ?? defaultCheckHostAccess;
  const resolveHostOwnerById = deps.resolveHostOwnerById;
  const resolveIdentityGate = deps.resolveIdentityGate;

  return async (frame, userId) => {
    return filterAppFrame(
      frame,
      { userId, resolveHostOwnerById, resolveIdentityGate },
      cache,
      check,
    );
  };
}
