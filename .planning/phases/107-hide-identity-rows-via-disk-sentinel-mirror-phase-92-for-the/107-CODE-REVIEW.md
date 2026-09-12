# Phase 107 — Code Quality Review

**Reviewer:** vega (unbiased fresh-eyes pass)
**Date:** 2026-09-12
**Branch:** feat/tab-title-from-tmux
**Commit range:** 0e818574..HEAD
**Scope:** correctness / edge cases / safety / code quality of the code that landed.
NOT conformance (already verified in /close closed-hit) and NOT testing (no execution).

---

## CRITICAL

None.

---

## HIGH

None.

The heavy-hitters that could realistically break in production are all mitigated:

- Sentinel primitive whitelist gate holds — `ALLOWED_REL_PATHS.has(relPath)` fires unconditionally before I/O, so a hidden allowance cannot leak (see `per-identity-file.ts:82-86, 147-153`).
- GET /identities `.hidden` probe genuinely runs in the SAME `Promise.all` wave as `.pinned` + `readIdentityFile` — verified at `identities.ts:402-422`. Test PUB-92-04 asserts this holds with counts.
- Backend fanout shares `connByHost` correctly and cleans up in a single `finally` — every branch that opens a conn stashes it into the shared map (`user-preferences.ts:276-524`).
- Schema migration ordering is correct: `runPinColumnDrop` and `runHiddenColumnDrop` both run BEFORE `addColumnIfNotExists`, so a stale re-add cannot resurrect the dropped column in the same boot.
- Frontend hydrate gate correctly waits on BOTH `fleetSessionsLoaded` AND `identitiesLoaded` before deriving pin OR hidden. `hydratedRef` covers both mutations in a single pass, so no race between them.
- Affordance narrowing is applied at ALL FOUR render sites (search-flat + pinned + middle + hidden), and `handleToggleHide` cannot be reached from the row context menu unless the panel threaded `onToggleHide`, which the panel gates behind `isFleetIdentityRow` at every site.
- `toBareIdentityKey` is reused, not duplicated (`user-preferences-api.ts:45-49`, called by both `putPinnedIds` and `putHiddenIds`).

---

## MEDIUM

### M1. Partial-failure disk drift when hidden fanout throws after pin fanout succeeded
**File:** `src/backend/database/routes/user-preferences.ts:270-517`

**What's wrong:** When a PUT body carries BOTH `pinnedConversationIds` AND `hiddenConversationIds`, the pin fanout runs first and executes its `writeIdentityFile` / `removeIdentityFile` writes to disk. If the hidden fanout then throws (SSH drop, disk error on a subset of hosts), the outer `catch` returns 500 to the client — but the pin writes have already landed on disk. Client sees a 500 and assumes nothing changed; disk state has actually mutated for pinned. Because the frontend hydrate is disk-authoritative on next mount, the divergence self-heals eventually, but there's a window where the client's optimistic pin state and disk truth are inconsistent AND no compensating action is attempted.

**Why it matters:** Real deploy scenario — one of Alice's fleet hosts is momentarily unreachable during a "reorganize pins and hides" PUT. Pin writes on reachable hosts succeed; hidden probe against the unreachable host throws (openConnForHost line 128 `connectOneShot(host, 5_000)` timeout); everything unwinds with a 500. Alice retries; disk still holds the earlier pin writes; frontend refreshIdentities re-projects. Confusing but not corrupting. Client-visible symptom: a "failed" PUT actually partially succeeded.

**Fix suggestion:** Two options, low-cost first:
1. Document the semantics on the client — `putPinnedIds` + `putHiddenIds` callsites already know disk is truth, so add a `refreshIdentities()` after a 500 caught in the write path so the UI re-derives from disk instead of keeping the pre-write optimistic state.
2. Better: reorder the fanout so BOTH pin+hidden diff computation runs first (parallel probes), then BOTH sets of writes run in one atomic `Promise.all`. A single throw unwinds both — but partial writes to a subset of hosts remain a filesystem-level race not fixable in this layer. Option 1 is sufficient.

---

### M2. Response echo mutation via `_echoPinned` / `_echoHidden` attached to the Express `res` object
**File:** `src/backend/database/routes/user-preferences.ts:394, 507, 594-595`

**What's wrong:** The pin and hidden fanouts stash their echo arrays as ad-hoc properties on the `res` object via `(res as unknown as { _echoPinned: string[] })._echoPinned = echoPinned;` — using `res` as scratch state between two blocks of the same handler. This is a functional pattern that works, but it uses the response object as a mutable scratch pad and defeats TypeScript.

**Why it matters:** Fragile — a future refactor that adds middleware between the fanout write and the response construction could observe or clobber `_echoPinned` / `_echoHidden`. The `unknown` cast bypasses type discipline the rest of the file otherwise maintains.

**Fix suggestion:** Extract the echo computation from inside the try block into scalars in the outer function scope:
```ts
let echoPinned: string[] | undefined;
let echoHidden: string[] | undefined;
// ... inside the try, assign these instead of stashing on res.
```
Purely cosmetic-mechanical refactor; behavior identical. Also removes the two `unknown` casts.

---

### M3. `hideConversation` / `unhideConversation` async rejection escapes the `try/catch`
**File:** `src/ui/state/conversation-store.ts:1641-1645, 1658-1662`

**What's wrong:** The pattern
```ts
try {
  void putHiddenIds([...nextHiddenIds], identityHosts);
} catch {
  // Silent — do not block state update on network failure.
}
```
catches ONLY synchronous throws. `putHiddenIds` is an `async` function that returns a Promise; any rejection propagates as an **unhandled promise rejection**, not a synchronous throw. The `try/catch` is dead code. This is a mirror of the pre-existing pin-side pattern at `L1587-1592` and inherits the same bug.

**Why it matters:** In production, browser-console pollution ("Uncaught (in promise) Error: ...") on every failed PUT. In modern browsers with strict unhandled-rejection handling (Chrome DevTools' auto-pause-on-exceptions), Alice sees a stack trace every time a hide toggle hits a network hiccup. Also breaks test suites that fail on unhandled promise rejections.

**Fix suggestion:** Change `void putHiddenIds(...)` to `putHiddenIds(...).catch(() => { /* silent */ })` — same fire-and-forget semantics, no unhandled rejection. Fix pin side symmetrically (out of Phase-107 scope but same file so worth including in the same commit).

---

## LOW

### L1. `pickPreferences` argument type still references dropped column indirectly
**File:** `src/backend/database/routes/user-preferences.ts:69`

**What's wrong:** `pickPreferences(row?: typeof userPreferences.$inferSelect)` uses the Drizzle-inferred type for `userPreferences`. That schema-type mirror was correctly updated (schema.ts no longer defines `hiddenConversationIds` or `pinnedConversationIds`), so the inference is correct. This is not a bug — flagging as LOW because the JSDoc `@openapi` block at `L620-641` still lists `hiddenConversationIds` in the GET response schema, which is now a lie. Downstream OpenAPI tooling would emit an inaccurate spec.

**Why it matters:** Documentation drift — a client generated off the OpenAPI schema would expect `hiddenConversationIds` in the GET response. In practice consumers are internal-only right now, but the annotation is misleading.

**Fix suggestion:** Delete the `hiddenConversationIds:` block from the `@openapi` GET annotation at `user-preferences.ts:637-641`. The PUT annotation at `L673-676` correctly still lists `hiddenConversationIds` as an input, which is accurate.

---

### L2. `didFanoutSentinels` flag can be double-set but never read for that
**File:** `src/backend/database/routes/user-preferences.ts:371, 484`

**What's wrong:** Both fanout blocks set `didFanoutSentinels = true;` — the flag is a boolean gate for the "did we do anything?" check at `L532`. Setting it twice is a no-op (same value). But if some future maintainer changes it to a counter or an enum, the twin assignments could confuse. Micro-nit.

**Why it matters:** Zero real impact. Flagging as documentation opportunity: rename to `didAnyFanout` or drop the second assignment (any one true → skip the "no preferences provided" 400).

**Fix suggestion:** Comment or single assignment site. Not blocking.

---

### L3. `hiddenRows` `useMemo` accumulator pattern papers over a real design limitation
**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:922-1001`

**What's wrong:** The `knownRowsRef` accumulator that captures rows across renders so that hidden rows can be re-materialized has a well-documented gap: rows that are hidden on the FIRST render (server hydrated with hidden state before the panel ever saw them) are absent from `knownRowsRef` and thus don't appear in the Hidden section until they cycle through visible tiers. The comment explicitly acknowledges this trade-off. Post-phase-107, this behavior is inherited unchanged from `quick-260731-tgg` and does NOT regress.

**Why it matters:** Not a Phase 107 regression, but if Alice loads Skynet and her hidden identities are already-hidden on disk (which is now the persistence model), the panel might briefly not show them in the Hidden section until the fleet-session updates make them known through some other path. The identities-store `useIdentities` result is now the primary source of hidden state, so this accumulator is arguably obsolete — the Hidden section could be re-derived directly from `state.identities.filter(i => i.hidden === true)`.

**Fix suggestion:** Refactor `hiddenRows` to derive from `identities` (via the disk-authoritative `hidden: boolean` field) rather than the ref-accumulator over tier flow-through. Out of scope for Phase 107 fixup but worth queueing as a follow-up bounty because Phase 107 changes the truth model from "server-persisted set" to "disk sentinel per identity" — the accumulator design pre-dates disk-truth and is now the wrong shape.

---

### L4. `parseIdentityHosts` duplicated across `identities.ts` and `user-preferences.ts` with subtle behavioral difference
**File:** `src/backend/database/routes/user-preferences.ts:57-67` and `src/backend/database/routes/identities.ts:292-308`

**What's wrong:** The two implementations claim behavioral parity in their JSDoc (`user-preferences.ts:48-51` says "MUST stay behaviorally identical"). They ARE identical in normalization semantics, but the identities.ts version accepts a URL-encoded JSON string and the user-preferences.ts version accepts an object directly. That's fine (different input shapes for query-param vs body-field). BUT — the duplicated normalization logic is a maintenance hazard: someone changing one side's normalization (say, dropping the positive-integer restriction) has to remember to change the other side too.

**Why it matters:** Real risk that a future change diverges one side silently. Ideally the normalization core (`positive integer + lowercase key`) lives in a shared helper, and both routes call it with their input-preprocess step.

**Fix suggestion:** Extract the loop body to `normalizeIdentityHostsRecord(obj: Record<string, unknown>): Record<string, number>` in a shared module. Not urgent.

---

### L5. Comment references outdated line numbers throughout
**File:** several — e.g. `user-preferences.ts:262-263, 300, 419, 456`; `identities.ts:280+, 415+`

**What's wrong:** Multiple comments reference "identities.ts:239-255", "L710-731", "L280+", "L370+" — these were correct at write time but they'll rot as the file evolves. Some already refer to line numbers that no longer contain what the comment claims (harmless but confusing when grepping).

**Why it matters:** Slows future readers. Not a bug.

**Fix suggestion:** Prefer semantic anchors ("§Sort model", `parseIdentityHosts()`, function-name references) over line numbers in comments. Not blocking.

---

### L6. `identityHostsKeys` is `Object.keys(identityHosts)` — depends on insertion order for correctness of `previousStates[i]` alignment
**File:** `src/backend/database/routes/user-preferences.ts:322-340, 439-456, 375-391, 488-504`

**What's wrong:** The code takes `Object.keys(identityHosts)` once and then indexes into `previousStates[i]` in a `.forEach((k, i) => ...)` on the same array. This is correct because `Object.keys` returns a snapshot and both iterations share the same array. It's not a bug — but the index-alignment invariant is fragile: if a future refactor swaps `Object.keys` for `Object.entries` in one place and forgets the other, the `previousStates[i]` correlation silently breaks and pins/hides drift arbitrarily.

**Why it matters:** The pattern works but has no runtime check that the two arrays stay aligned. A future refactor could break it silently.

**Fix suggestion:** Use `identityHostsKeys.map((key, i) => ({ key, exists: previousStates[i] }))` and reduce over that structure to build previousSet. Ties the key and its exists-result together in one shape so re-ordering cannot desync them. Minor.

---

### L7. Frontend `hidden` field naming collision between `Identity.hidden` (disk truth) and JSX `hidden={boolean}` prop (React attribute)
**File:** `src/ui/api/identities-api.ts:54` and PrettyConversationRow `hidden` prop, plus the row component's `hidden={false}` render prop.

**What's wrong:** `Identity.hidden` (boolean disk-sentinel presence) has the same name as HTML's global `hidden` attribute. If someone spreads `{...identity}` onto a DOM element in a future refactor, `hidden={true}` would nuke the element from rendering. Currently no spread-of-identity pattern exists on DOM elements in the touched code, but this is a landmine.

**Why it matters:** Future refactor hazard. Low probability but high impact if it lands.

**Fix suggestion:** Non-blocking. If naming it `hiddenOnDisk` or `isHidden` on the wire were done, it would be safer. The shape mirrors pin (`pinned: boolean`, same shape) so the naming choice is symmetric — worth calling out but not worth churning.

---

### L8. No test for `.hidden` sentinel presence being served under fanout when `.pinned` also present on the same identity
**Files:** `src/backend/database/routes/user-preferences.test.ts` and `identities.disk-read.test.ts`

**What's wrong:** Tests cover pin-only, hidden-only, and combined pin+hidden (HID-107-PUT-09) at the fanout level. But no test asserts that when an identity has BOTH `.pinned` AND `.hidden` present on disk, GET /identities returns `pinned: true` AND `hidden: true` simultaneously. The two `identityFileExists` probes are independent, so this "obviously works" — but there's no explicit lock against a future refactor that accidentally makes them mutually exclusive.

**Why it matters:** Edge case coverage gap. Pin-hide independence is asserted at the frontend level (SEL-107-05) but not end-to-end.

**Fix suggestion:** Add one test in `identities.disk-read.test.ts` where `identityFileExistsMock` returns true for both `.pinned` AND `.hidden` on the same identity; assert the response row has `pinned: true, hidden: true`.

---

## Summary

- CRITICAL: **0**
- HIGH: **0**
- MEDIUM: **3** (M1 partial-failure disk drift; M2 res object mutation for echo state; M3 async rejection escaping try/catch)
- LOW: **8** (documentation drift, refactor hygiene, coverage gaps, naming caution)

**Overall read: green — minor cleanup recommended, safe to deploy as-is.**

The phase is a faithful mirror of the phase-92 pin pattern with symmetric extensions. Every shape-agreed invariant is genuinely enforced in code, tests cover the mirrored contract points, and error paths behave predictably. The three MEDIUM findings are all inherited from the pin-side pattern (M1, M2 have direct pin equivalents; M3 is a pattern bug shared with `pinConversation`) — none are Phase-107 regressions. The LOW findings are documentation / refactor / naming hygiene, not bugs.

If Ashley wants a follow-up cleanup pass, the highest-value single change is M3 (`.catch(...)` instead of `void ...` for async fire-and-forget) applied symmetrically to both pin and hidden mutators — small, safe, and eliminates a class of console-noise / unhandled-rejection surprise. M1 and M2 can wait; the disk-drift window is self-healing on next hydrate and the res-mutation pattern works today.
