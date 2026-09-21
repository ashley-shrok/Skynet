/**
 * ready-cue-latch-store — per-row armed:boolean latch for the readiness cue.
 *
 * Origin: Phase 126 (audio-cue-when-wip-indicator-clears), Plan 02 (Wave 2).
 * Wave 1 shipped the leaf-level audio primitive (`@/audio/ready-cue`);
 * Wave 2 wires the latch state machine that gates when `playTink()` fires.
 *
 * Locked decisions from 126-CONTEXT.md that this module implements:
 *
 *   D-01: Each conversation row carries an in-memory `armed: boolean` latch.
 *         Initial value: false (encoded here as "absent-key" — see D-04).
 *
 *   D-02: Arm event — new agent-side bubble arriving in the row's message
 *         stream sets `armed = true`. Consumer (PrettyView) calls `armRow(key)`
 *         from a message-observer effect.
 *
 *   D-03: Fire event — on the row's `isWorking` true→false transition, IF
 *         `isRowArmed(key) === true` AND the visibility gate passes, the
 *         consumer fires the chime AND calls `disarmRow(key)`. Both writes
 *         happen atomically at the same transition point in the consumer.
 *
 *   D-04: WIP flicker (true→false→true→false) with no intervening agent bubble
 *         does NOT re-fire — the latch was disarmed on the first fire and no
 *         new bubble arrived to re-arm it. Multiple bubbles between two WIP-off
 *         events still fire exactly one chime at the terminal WIP-off (each
 *         new bubble sets armed=true, but the fire+disarm pair still runs
 *         once). The latch shape naturally collapses multi-bubble work cycles
 *         into a single chime.
 *
 *   D-22: Latch state placement — pure in-memory session state. NO Zustand
 *         store, NO useSyncExternalStore, NO subscribe/notify surface. The
 *         consumer reads/writes IMPERATIVELY from a useEffect (not rendered),
 *         so React reactivity would be over-engineering. The store's public
 *         API is exactly four functions.
 *
 *   D-25: Test coverage — the colocated
 *         `src/ui/state/ready-cue-latch-store.test.ts` covers the state
 *         machine cases i–v (arms on armRow, fires+disarms modeled as
 *         isRowArmed→disarmRow, does-not-fire when unarmed, multiple arms
 *         collapse to one armed=true, disarmRow on already-false is a no-op)
 *         plus multi-key independence.
 *
 * Key format: `${hostId}:${tmuxSession ?? ""}` — the SAME shape as the working
 * store's row key so callers reuse `sessionWorkingKey` derived at
 * PrettyView.tsx:1697 without re-deriving.
 *
 * Sibling of the working store — NOT stacked. The two stores live in separate
 * files so the latch mutation surface is narrow (four functions vs. the
 * working store's twenty-odd exports) and the D-25 tests drive it in
 * isolation without pulling in fleet-status types.
 *
 * `disarmRow` semantics: sets the map entry to `false` (NOT delete). Absent
 * key and value=false both mean "not armed" per `isRowArmed`, but explicit
 * false-write leaves a lifecycle breadcrumb ("this row was armed once, then
 * fired") that future readers may find useful. `isRowArmed` treats absent and
 * false uniformly, so the distinction is presentational only.
 *
 * `__resetForTest` scope: clears the map entirely. Mirrors the working
 * store's reset helper shape (both reset their Map to empty in `beforeEach`).
 */

// ─── Module-scope state ──────────────────────────────────────────────────────

const armedRows: Map<string, boolean> = new Map();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Arm the row identified by `key`. Idempotent — calling twice leaves the
 * entry at `true`. Multiple armings between two fire cycles collapse to one
 * chime at the terminal WIP-off (D-04).
 *
 * Called from PrettyView.tsx's arm-on-new-assistant-bubble effect for each
 * newly-appended `ChatMessageEvent` with `role === "assistant"` (D-02, D-08).
 */
export function armRow(key: string): void {
  armedRows.set(key, true);
}

/**
 * Disarm the row identified by `key`. Sets the entry to `false` (not delete);
 * `isRowArmed` treats both false and absent as "not armed". Idempotent —
 * calling twice leaves the entry at `false`.
 *
 * Called from PrettyView.tsx's fire-on-WIP-true→false effect immediately
 * after `playTink()` (D-03). Also a no-op when the row was never armed —
 * this is the "WIP flicker without new bubble doesn't re-fire" precondition
 * (D-25 case v).
 */
export function disarmRow(key: string): void {
  armedRows.set(key, false);
}

/**
 * Whether the row identified by `key` is currently armed. Returns `true` iff
 * the map has the key AND its value is exactly `true`. Absent-key → false.
 * Value-is-false → false. Never throws.
 *
 * Called from PrettyView.tsx's fire-on-WIP-true→false effect as the FIRST
 * gate — if false, the effect returns without firing (and without disarming,
 * which would be a no-op anyway) (D-03).
 */
export function isRowArmed(key: string): boolean {
  return armedRows.get(key) === true;
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the latch to an empty Map. Used by
 * src/ui/state/ready-cue-latch-store.test.ts's `beforeEach` so each test
 * starts from a known-empty state. NOT a public API.
 *
 * Mirrors the working store's reset helper shape.
 */
export function __resetForTest(): void {
  armedRows.clear();
}
