# Fix: appearance cache on cold paint

**Opened:** 2026-09-16
**Vehicle:** /build fix mode (inline execution — small, mirrors an existing pattern)
**Bounty:** conversation-list-live-and-cached (todos "OPEN — Cold-paint appearance cache")
**Context:** .planning/pixel-handoff-continuation.md §Problem 1

## Observed wrong behavior

On a hard reload of Skynet, the conversation list rows appear plain (like ordinary terminal sessions — no colour, no avatar, no title, no task description) for about a second, then dress themselves. The pulse pathway (Phase 111) works — appearance arrives on the fleet-status WebSocket first-frame, `mergeIdentityAppearance` merges it into `identities-store`, rows re-render dressed. But that whole path costs ~1s wall (WS connect → subscribe → server pushes → frontend merges → React re-renders).

Ashley's mental model, verbatim: *"ask for everything on page load and ask for it every time we poll and cache everything so that as soon as pages come up that can be shown until it gets replaced by what's coming from the back end"*. Appearance-in-cache was **never deferred** — the only thing deferred was the "slow first-ever load with nothing remembered" (no cache to draw from at all).

## Correct behavior after the fix

On any hard reload where a prior session cached appearance to localStorage, the rows paint dressed (colour, avatar, name, title, task) immediately on cold paint — before the WebSocket first-frame arrives. When the pulse then arrives, `mergeIdentityAppearance` reconciles (mostly no-ops, same-content). `state.loaded` MUST stay `false` after the cache seed — the fuller `/identities` request remains the sole owner of `loaded: true` (D-10 invariant, load-bearing against the terminal-flash + listener-leak bug).

## Suspected files

- `src/ui/state/identities-store.ts` — the change lives here. Mirror `readFleetSessionsCache` / `writeFleetSessionsCache` (currently at `src/ui/state/conversation-store.ts:1380` const + `:1477-1566` helpers). Add a new storage key `skynet:identities-appearance-cache:v1`, matching helper functions, wire the writer into `notify()` (single-authority write chokepoint), wire the reader at module load carrying `loaded: false`, add `__seedFromCacheForTest()` for test-controlled cache-seed timing.
- `src/ui/state/identities-store.enrichment.test.ts` — new test asserting cold module load with warm cache exposes cached hue via `state.byHostKey` with `state.loaded === false`. Existing D-10 Case 1 must still pass.

## Load-bearing invariants (do NOT regress)

- **D-10:** the seed from cache MUST NOT flip `loaded` to `true`. `setIdentities` remains the sole owner of `loaded: true`. Every cache-seed and every merge carries `loaded: state.loaded` (or `false` on module load).
- **D-09:** the writer only writes what the store currently knows. The cache never contains synthesized values.
- **Silent-write-fail:** cache writes are try/catch-swallowed. Losing the cache is not a user-visible failure.
- **Bumped storage key on schema change:** `skynet:identities-appearance-cache:v1`. Any future field addition or removal bumps the version.

## Close-out (2026-09-17)

**Actual change made:**
- `src/ui/state/identities-store.ts` — added `APPEARANCE_CACHE_KEY = "skynet:identities-appearance-cache:v1"` const; added `readAppearanceCache()` / `writeAppearanceCache()` helpers mirroring `readFleetSessionsCache` / `writeFleetSessionsCache` in shape (defensive per-item `isCachedIdentity` type-guard on read, canonical field-pick on write, silent-on-failure both sides); added `__seedFromCacheForTest()` test helper; wired the writer into `notify()` (single-authority write chokepoint — every state change that reaches listeners also updates the cache); wired the reader into the module-load IIFE that seeds `let state: State` (carries `loaded: false` — D-10 invariant preserved, the fuller `GET /identities` remains the sole owner of `loaded: true`).
- `src/ui/state/identities-store.enrichment.test.ts` — added a new `describe("appearance cache (post-Phase-111 cold-paint fix)")` block with 5 tests: (1) cold load with warm cache seeds `byHostKey` and keeps `loaded=false`, (2) writer emits canonical shape the reader accepts (round-trip), (3) empty/missing/malformed cache is silent — reader returns `[]`, (4) `__seedFromCacheForTest` is a no-op when cache is empty, (5) writer is silent on QuotaExceeded / storage errors.

**done:** cold module load with warm localStorage cache exposes cached hue via `state.byHostKey` at `state.loaded === false`; existing D-10 Case 1 test still passes; all 51 identities-store enrichment tests pass; frontend `tsc --noEmit` clean; `npx vitest related --run` across 53 files exercising 929 tests pass.
