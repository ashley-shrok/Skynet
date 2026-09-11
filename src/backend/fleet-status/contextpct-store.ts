/**
 * contextpct-store.ts
 *
 * Phase 90 Wave 0 (D-10 delivery mechanism, Alice 2026-09-08 D-03 waiver).
 *
 * Per-session in-memory shared map that carries the latest `contextPct: number | null`
 * value for each `(hostId, tmuxSession)` pair. Dual-written from the two
 * `context_pct` WS emission sites in `claude-session-server.ts` (L3219 dormant
 * branch + L7074 primary `contextPctTimer` branch); read by the fleet-status
 * publish path (subscription-registry.ts publishSessionState + getSnapshot)
 * so every fleet-status frame carries `contextPct` on its per-session record
 * shape.
 *
 * Purpose: single source of truth for `contextPct` so both PrettyView (after the
 * D-03 mechanical waiver — swap `useState<number|null>` for the fleet-status
 * hook) and the Plan 06 relay-pane badge appendage subscribe to the same value
 * via the same session key. Zero drift risk — the same agent viewed on either
 * surface reads identical values.
 *
 * DESIGN PRINCIPLES (mirror session-file-cache.ts):
 *   - No lifecycle. No TTL. No start/stop. Last-writer-wins.
 *   - Opportunistic read: reads for absent keys return null (no throw).
 *   - Single-tenant, process-local: the Map lives only in this Node process.
 *   - Bounded growth: keyed on identity-shaped tmux sessions; fleet size < ~20.
 *
 * KEY FORMAT: `${String(hostId)}:${tmuxSession}` — matches session-working-
 * store.ts's frontend convention (`${hostId}:${tmuxSession ?? ""}`). Both
 * writer (claude-session-server, numeric hostId in scope via currentHostId /
 * activeHostId) and reader (subscription-registry, string hostId from
 * HostRecord.id) MUST coerce hostId via String() before joining — this is the
 * D-10 correctness invariant.
 *
 * NO DB WRITES — invariant preserved. DatabaseSaveTrigger.forceSave does NOT
 * apply here.
 */

import { databaseLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** Process-local singleton. Values are `number | null` — null is a valid stored
 *  value (dormant → null is the sentinel PrettyView's context_pct dormant branch
 *  historically emitted). Absence from the map is distinct from a stored null. */
const store = new Map<string, number | null>();

// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------

function buildKey(hostId: string | number, tmuxSession: string): string {
  return `${String(hostId)}:${tmuxSession}`;
}

// ---------------------------------------------------------------------------
// Public API — set / get / delete
// ---------------------------------------------------------------------------

/**
 * Write (or overwrite) the contextPct value for the given (hostId, tmuxSession)
 * pair. `null` is a valid explicit value (dormant sentinel semantic).
 *
 * Structured logging is at `debug` level — this API fires ~every 3s per active
 * pane and can be high-volume; production log level typically excludes debug so
 * volume is bounded by default. NEVER JSON.stringify a SyntheticEvent or any
 * cross-cutting object here (fleet-wide logging directive, Alice 2026-08-11).
 */
export function setContextPct(
  hostId: string | number,
  tmuxSession: string,
  pct: number | null,
): void {
  const key = buildKey(hostId, tmuxSession);
  store.set(key, pct);
  // NB: LogContext.hostId is number-typed at logger.ts:38 so we pass the
  // caller's numeric hostId directly when we have one; when the caller passed
  // a string (per the number-or-string signature above), coerce via Number()
  // and omit if NaN. Keeps the grep field name stable.
  const hostIdNum = typeof hostId === "number" ? hostId : Number(hostId);
  databaseLogger.debug("context-pct store set", {
    operation: "context_pct_store_set",
    tmuxSession,
    pct,
    ...(Number.isFinite(hostIdNum) ? { hostId: hostIdNum } : {}),
  });
}

/**
 * Read the contextPct value for (hostId, tmuxSession). Returns `null` when the
 * key is absent from the map OR when the map holds an explicit null (both
 * cases collapse to null at the read boundary — callers cannot distinguish
 * "never written" from "written null"; that's intentional per Test 3/Test 4
 * semantics).
 */
export function getContextPct(
  hostId: string | number,
  tmuxSession: string,
): number | null {
  const key = buildKey(hostId, tmuxSession);
  const val = store.get(key);
  if (val === undefined) return null;
  return val;
}

/**
 * Remove the entry for (hostId, tmuxSession). Subsequent getContextPct returns
 * null. Idempotent — deleting an absent key is a no-op.
 */
export function deleteContextPct(
  hostId: string | number,
  tmuxSession: string,
): void {
  const key = buildKey(hostId, tmuxSession);
  store.delete(key);
}

// ---------------------------------------------------------------------------
// Test-only
// ---------------------------------------------------------------------------

/** TEST ONLY — empties the entire store so each test starts from a clean slate. */
export function __clearAllContextPctForTests(): void {
  store.clear();
}
