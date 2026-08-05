---
status: complete
quick_id: 260805-tub
slug: cache-client-side-conversation-list-flee
completed: 2026-08-05
---

# Quick Task 260805-tub: Cache client-side conversation-list fleet snapshot — SUMMARY

## What shipped

localStorage-backed cache of the conversation-list fleet snapshot. Page refresh now paints the last-known row set immediately from the cache; the existing one-shot `getSessionList()` fetch then overwrites with the fresh snapshot when it returns (~200ms later). Row EXISTENCE only — activeSet, WIP dots, pin state, and hostTree remain live-derived.

## Files touched

- **`src/ui/state/conversation-store.ts`** (+83 lines): added `FLEET_CACHE_KEY`, `isFleetSession` type guard, `readFleetSessionsCache()`, `writeFleetSessionsCache()`. Both helpers silent on failure (missing key, corrupt JSON, non-array, shape mismatch, QuotaExceededError, disabled storage). Defensive filter — only the 4 canonical `FleetSession` fields (hostId, hostName, sessionName, created) are read/written even if the type grows.
- **`src/ui/AppShell.tsx`** (+16 lines / -1): the TG-17 empty-dep-array mount effect now (1) seeds the store from cache before firing the fetch, (2) writes the fresh snapshot on fetch success. Fetch failure leaves the cache untouched — last-known-good survives network hiccups.
- **`src/ui/state/conversation-store.cache.test.ts`** (new, 128 lines / 9 tests): roundtrip, cache-miss, corrupt-JSON, non-array, element-shape, extra-field strip, overwrite semantics, empty-write, silent-on-storage-failure.

## Test result

- Cache tests: 9 pass / 0 fail.
- Full suite: 1441 pass / 6 skip / 0 fail across 120 files (was 1432 / 119 pre-change; +9 tests from the new file).
- `npx tsc --noEmit`: clean.

## Cache invalidation strategy

Key is versioned: `skynet:convo-fleet-cache:v1`. If the `FleetSession` shape ever changes, bump the suffix (`:v2`) and every client's stale cache becomes a cache-miss on next load — no admin action needed. Not adding a TTL, size limit, or admin clear button — the snapshot is bounded by real tmux sessions on real hosts (~dozens at most) and rarely churns.

## Ship path

Standard session pattern per Ashley 2026-08-05: commit + push + build + recreate inline. Container recreate happens after code + docs commit lands.
