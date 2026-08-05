---
status: in-progress
quick_id: 260805-tub
slug: cache-client-side-conversation-list-flee
created: 2026-08-05
---

# Quick Task 260805-tub: Cache client-side conversation-list fleet snapshot to localStorage

## Description

Cache the client-side conversation-list fleet snapshot to localStorage so a page refresh paints the last-known row set immediately, then reconciles when the one-shot `getSessionList()` fetch returns. Scope: row EXISTENCE only (the fields getSessionList() already returns: hostId, hostName, sessionName, created). Active/inactive state, WIP dots, pin state, and hostTree remain live-derived — do NOT persist them.

Ashley 2026-08-05: fleet-shape rarely changes, no reason for a page refresh to paint an empty list for the ~200ms until the fetch lands.

## Behavior

- On AppShell mount: read cached fleet snapshot from localStorage BEFORE firing the existing one-shot `getSessionList()` fetch. If a valid array is present, call `updateFleetSessions(cached)` so the store paints rows immediately.
- On fetch success: write the fresh snapshot to localStorage (overwrite; no TTL, no merge).
- On fetch failure: leave whatever's in localStorage untouched (silent, per existing Phase 6 fallback contract).
- On JSON parse failure or missing key: treat as empty cache; no throw, no toast, no log noise — Phase 6 openTabs-only rendering takes over just like today's cold cache.
- localStorage key: `skynet:convo-fleet-cache:v1` (versioned so a shape change can invalidate all clients by bumping the suffix).

## Files touched

1. **`src/ui/state/conversation-store.ts`** — export two new pure functions next to `updateFleetSessions`:
   - `readFleetSessionsCache(): FleetSession[]` — safe read, returns `[]` on missing key / parse error / non-array / element-shape-mismatch. No throws.
   - `writeFleetSessionsCache(sessions: FleetSession[]): void` — silent write, swallows QuotaExceededError. Only writes the 4 `FleetSession` fields (defensive against future field bloat leaking to storage).

2. **`src/ui/AppShell.tsx`** (~L465-481, the TG-17 empty-dep-array useEffect) — before the async fetch fires, seed the store from the cache; on fetch success, write the fresh snapshot to the cache.

## Non-goals

- Not caching `hostTree` (already has its own polling loop with server-authoritative hash checks).
- Not caching pin state (already persisted server-side via `putPinnedIds` and threaded through user-preferences-api).
- Not caching activeSet / WIP / isWorking — all derived live from live sockets/events.
- Not adding TTL, size limits, or LRU eviction — the fleet snapshot is bounded by real tmux sessions on real hosts (~dozens at most) and rarely churns.
- Not adding a `?nocache` URL param or admin-side clear button — the version suffix in the key handles the escape hatch if we ever need it.

## Tests

Add to `src/ui/state/conversation-store.test.ts` (or a sibling `.cache.test.ts` — same style as other test-file splits in the folder). Four cases:

1. **roundtrip**: `writeFleetSessionsCache([...])` then `readFleetSessionsCache()` returns the same array (deep equal on all 4 fields).
2. **cache-miss fallback**: with localStorage empty, `readFleetSessionsCache()` returns `[]`.
3. **corrupt-JSON fallback**: `localStorage.setItem("skynet:convo-fleet-cache:v1", "not-json")` → `readFleetSessionsCache()` returns `[]` (no throw).
4. **non-array fallback**: `localStorage.setItem(key, '{"foo":1}')` → returns `[]` (no throw).
5. **element-shape fallback**: `localStorage.setItem(key, '[{"foo":1}]')` → returns `[]` (missing hostId/hostName/sessionName/created).
6. **write-only-4-fields**: pass a session with extra fields → `readFleetSessionsCache` returns only the 4 canonical fields (defensive filter).

The AppShell wire is a two-line change (read before fetch, write after) — verified by the store-level tests + full-suite run. No new AppShell test needed; the existing AppShell.test.tsx covers the mount-effect fire.

## Ship gates

- `npx tsc --noEmit` clean.
- `npx vitest run` — full suite green (currently 1432 pass / 6 skip / 0 fail across 119 files; expect +6 tests, still 0 fail).
- No new production dependencies.
- Commit + push + build + recreate inline (session pattern — Ashley 2026-08-05).

## Not folded in (deferred)

- N/A — self-contained.
