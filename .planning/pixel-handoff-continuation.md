# Pixel handoff continuation — Phase 111 post-ship

**Written:** 2026-09-16 (end of Pixel's first session, running the whole Phase 111 arc)
**Next session picks up:** the two remaining UAT-surfaced problems on the shipped Phase 111 code.

## Read this first, in order

1. **Ashley's corrective framing at the end of the session, verbatim** — the load-bearing thing to internalize before writing any code:

   > "i deferred it my whole picture of this thing high concept that i thought we were doing is ask for everything on page load and ask for it every time we poll and cache everything so that as soon as pages come up that can be shown until it gets replaced by what's coming from the back end"

   She said this correcting me after I framed "appearance in localStorage" as "deferred." **It was never deferred.** I misread the shape file's Out-of-scope entry ("slow first-ever load with nothing remembered") as covering the whole cache-and-show pattern. It doesn't. The Out-of-scope entry is specifically about *what to show the very first time somebody ever opens the app* — the case where there is no cache to draw from at all. Caching what you know and painting it instantly on every subsequent visit was always the plan; the shape file's "browser-side remembering as the primary fix" rejection was about the *server* being the primary answer, not about caching being off-scope.

   **Her mental model, and what she keeps saying we agreed to:** ask for everything the list needs on page load, cache all of it, paint from cache the instant the app opens, replace with fresh backend data as it arrives. That is the goal state. Anything you propose that doesn't satisfy that is wrong.

2. **The bounty that governs this work:** `~/fleet/roles/box-maintainer/bounties/conversation-list-live-and-cached/bounty.json`. Its `todos[]` is the concrete work list. This handoff explains the WHY behind each todo in enough detail to act on them.

3. **Phase 111 verification report:** `.planning/phases/111-conversation-list-arrives-complete-and-stays-live-one-comple/111-VERIFICATION.md` — 15/15 mechanical must-haves passed; UAT `human_needed` on 5 items (that's what the current UAT round is testing).

## What is actually broken RIGHT NOW on the shipped app

Ashley did two rounds of UAT after ship. Round 2 (post cache-cook) is her current state.

### Problem 1 — ~1 second undressed flash on cold paint (still)

**What she sees:** hard reload → rows appear plain (like ordinary terminal sessions) for about a second, then dress themselves (color, avatar, title, task all populate).

**Why:** the pulse pathway is working — appearance arrives on WS frames, `mergeIdentityAppearance` merges it into `identities-store`, and the row-render lookup at `PrettyConversationRow.tsx:346-351` picks up `identity.colorHue`/etc. But that whole path costs roughly one WebSocket round-trip: connect → subscribe → server pushes snapshot frame → frontend merges → React re-renders. That's ~1s wall.

**The row-set cache already exists** at `conversation-store.ts` — `readFleetSessionsCache`/`writeFleetSessionsCache` around L1000-1100. It seeds `fleetSessions` on module load from localStorage, then the fresh fetch overwrites. But it stores only row identity (hostId, sessionName, created, lastMessageAt, aiTitle, kind, roomId, roomTitle) — **NO appearance.** So even with the cache warm, the row exists in the store but has no color/name/title/task until the pulse arrives.

**What needs to happen:** mirror that row-set cache pattern for `identities-store`. On every meaningful change to `state.identities` (setIdentities OR mergeIdentityAppearance), write a compact appearance record to localStorage. On module load, read it and seed the store BEFORE the WS first-frame arrives. Result: cold refresh paints dressed rows immediately from cache, then the WS first-frame arrives and reconciles.

**Load-bearing property to preserve (D-10):** the seed from localStorage MUST NOT flip `identities-store.loaded` to true. That flag stays owned by the fuller `/identities` request. The seed should populate `state.identities`/`byKey`/`byHostKey` from cached rows without touching `loaded`. The exact same shape as `mergeIdentityAppearance` — carry `loaded: state.loaded` forward.

**Where to put it:**
- New `readAppearanceCache()`/`writeAppearanceCache()` helpers in `identities-store.ts`. Mirror `readFleetSessionsCache`/`writeFleetSessionsCache` byte-for-byte in shape. Pick a bumped storage key (e.g. `skynet.identities.appearance.v1`) so a schema change is a version bump not a stale-cache footgun.
- Cache the fields that make a row dressed: `identityKey, hostId, displayName, title, colorHue, voice, role, avatarUrl, avatarEtag, coordinator, task, pinned, hidden, roleDefaults`. Keep `avatarMime` too if it matters for rendering — check.
- Call the writer from `reindex` or the state-write chokepoints (currently `setIdentities` and `mergeIdentityAppearance` both funnel through `reindex(list)` — writing in the shared function is the cleanest single-authority pattern, same principle as D-09).
- Call the reader on module load (before `fetchOnce`) and populate state via reindex, carrying `loaded: false`.

**Verification (proven load-bearing by deliberate breakage):**
- New test: on a cold module load with cache warm, `state.byHostKey.get("hostId::key")?.colorHue` returns the cached hue with `state.loaded === false`. Breaks red if the writer is disabled OR the reader isn't wired.
- Existing D-10 test (Case 1 in identities-store.enrichment.test.ts) must still pass — the cache seed doesn't flip loaded.

### Problem 2 — Pin and hide organization takes ~8 seconds

**What she sees:** rows appear dressed within ~1s (Problem 1), but for another ~7s hidden rows are visible in the main list instead of being tucked into the hidden section, and pinned rows aren't at the top. Then everything organizes correctly.

**Why:** `PrettyConversationsPanel.tsx:556-602` — the panel's hydrate effect. It gates on BOTH `fleetSessionsLoaded` AND `identitiesLoaded`, then latches via `hydratedRef.current`. Post-Phase-111, the pulse populates `identity.pinned`/`identity.hidden` into `state.identities` well before `/identities` returns — but the panel is still gated on the SLOW `identitiesLoaded` signal (which only flips when `/identities` completes via `setIdentities`). So the effect sits and waits for /identities to land, exactly the 8s Ashley sees. Once /identities lands, `identitiesLoaded` flips, effect fires, `deriveDiskPinnedIds` runs, `hydratePinnedIdsFromServer(pinnedIds)` writes to `state.pinnedIds`, the panel re-derives, hidden rows go to the hidden section, pinned rows go to top.

**The load-bearing quick-260912-5q2 property this gate was protecting:** if you fire the effect before `state.identities` has data, `deriveDiskPinnedIds` returns `[]`, `hydratePinnedIdsFromServer([])` wipes existing `pinnedIds`, `hydratedRef` latches so it never re-fires — cold reload permanently loses pins. Do NOT regress this.

**The fix, in two parts:**

1. **Change the effect's gate** from `if (!identitiesLoaded) return;` to something like `if (state.identities.length === 0) return;` (i.e. wait for ANY appearance data, not specifically the fuller-fetch signal). Or drop the latch entirely and let the effect fire multiple times as identities grows — see part 2.

2. **Make `hydratePinnedIdsFromServer` and `hydrateHiddenIdsFromServer` additive-on-empty** — mirror the `updateFleetSessions([])` `preservePulseRows` fix. When incoming is `[]` and existing `state.pinnedIds` (or `hiddenIds`) is non-empty, preserve existing. This is the correct home for the quick-260912-5q2 property. Once these two functions can't wipe from an empty derivation, the identitiesLoaded gate is no longer needed to protect them, and the panel effect can fire whenever `state.identities` has data.

**Why the additive-on-empty pattern is right here specifically:** same class of fix as the two hotfixes I did mid-Phase-111 (`updateFleetSessions([])` and `mergeIdentityAppearance` appending on absent). All three are the same principle: **"an answer that knows less must never blank an answer that knew more."** The store's current pin/hide state IS an answer that knows more; a fresh derivation from an empty `state.identities` knows less. Preserve the more-informed answer.

**Where to touch:**
- `src/ui/state/conversation-store.ts` around line 1878 (`hydratePinnedIdsFromServer`) and its `hydrateHiddenIdsFromServer` sibling. Add the guard: if `ids.length === 0 && state.pinnedIds.size > 0`, return without notify. Same for hidden.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:556-602`. Loosen the `identitiesLoaded` gate. If you remove `hydratedRef` entirely, the effect fires whenever `identities` changes — idempotent because both hydrate functions are same-content-guarded already.

**Verification (deliberate-breakage load-bearing proofs required):**
- New test: cold-boot pulse populates `identities-store` with a pinned identity, panel's hydrate effect projects it into `state.pinnedIds` WITHOUT `identitiesLoaded === true`. Breaks red if the panel gate isn't loosened.
- New test: `hydratePinnedIdsFromServer([])` with `state.pinnedIds.size > 0` is a no-op. Breaks red if the additive-on-empty guard is dropped.
- Existing quick-260912-5q2 protection: cold reload with `state.identities === []` does NOT wipe `pinnedIds`. This should now be enforced by the hydrate-function guard rather than the panel gate.

## Pre-existing bug I diagnosed but did NOT fix (per Ashley's call)

**Tina's identity shows avatar + name but no color, from before this ship.**

Her frontmatter task line:
```yaml
task: "we want the best outcome we can so regardless of how much we have to replace" — running the campaign so nothing ever gets silently dropped anywhere in terms of SSH.
```

`js-yaml` at `identity-artifact-reader.ts:2375` sees the leading `"`, reads a double-quoted string, closes at the matching `"`, then finds `— running the campaign...` after the closing quote on the same line. That's a YAML syntax error. The catch at `:2382` returns `{}` — no role, no title, no colorHue, no task extracted. Backend `/identities` returns `role: null, colorHue: null, roleDefaults: null` for tina. Row renders without color because `identity?.colorHue ?? null` is null.

Everything else she shows (avatar + name) comes from paths that don't fail: avatarUrl is deterministic from identityKey/hostId, displayName falls back to `capitalizeFirst(identityKey)` when frontmatter parsing gives nothing.

**The sweep uses a forgiving stdlib line-based parser and DOES extract her role correctly** — so the pulse pathway (which now carries appearance post-Phase-111) probably renders her color correctly on the LIVE path. But `/identities` is what the identity modal, avatar handling, and role-inheritance display use. And it's what seeds the store on cold load until the pulse arrives.

**Ashley's call:** leave for tina to fix her own file. When she does, single-quote the outer wrap or use a YAML block scalar.

**Structural follow-up worth considering (as its own bounty):** give `extractCosmeticsFromFrontmatter` a line-based fallback when strict YAML throws, mirroring what the Python sweep does. Closes the whole class of bug for anyone else who writes an inline quote in their frontmatter. Do NOT do this speculatively — offer it if she asks.

## What Phase 111 did ship — the honest inventory

So you know exactly what code exists and how it behaves before you touch it.

**Sweep (Python) — `substrate/scripts/fleet-status-sweep.py`:**
- Emits `role`, `identity_cosmetics`, `role_cosmetics`, `pinned`, `hidden` on every identity line at `SCHEMA_VERSION = 1` (unchanged — do NOT bump).
- `_extract_frontmatter_head` reads a capped 4KB head with a stdlib line-based parser. Forgiving compared to js-yaml.
- `role_cosmetics_memo` in `main()` ensures each role file is read at most once per tick.
- No mtime gating anywhere (D-03 explicitly rejected on evidence).

**Backend TS — `src/backend/fleet-status/`:**
- `identity-appearance.ts` is the SINGLE merge authority for `identity ?? role ?? null`. `publicIdentity()` in `identities.ts` delegates to it (proven by unmodified 979-line get-disk.test.ts).
- `wire-protocol.ts:355+` `SessionStateSchema` carries an optional nested `identityAppearance` field at `FRAME_SCHEMA_VERSION = 1` (unchanged — do NOT bump).
- `ssh-poll-orchestrator.ts` stamps appearance on BOTH publish sources (source A `computeFingerprint` at ~L1033 + source B inline fingerprint at ~L2130) with deterministic-key `appearanceFingerprintSegment`. All frame construction sites, all cache-write branches.
- `subscription-registry.ts` UNTOUCHED. Do NOT re-stamp appearance in the registry — that's the wrong analog (contextPct re-stamps because its source is a separate out-of-band store; appearance arrives ON the frame, so re-stamping would be a second authority = D-09 violation).

**Frontend TS — `src/ui/`:**
- `state/identities-store.ts` — `mergeIdentityAppearance` (Phase 111 Plan 04, plus my 2026-09-16 hotfix `295ea0ef`) writes appearance additively AND appends on absent-row. Never touches `loaded`. `setIdentities` is the ONLY place `loaded: true` is set (D-10).
- `state/conversation-store.ts` — `upsertFleetSession` for pulse-driven row appear (Phase 111 Plan 05); `removeFleetSession` for pulse-driven row disappear (via `onGone`); `updateFleetSessions([])` no longer wipes pulse rows (2026-09-16 hotfix `993048cd`, `preservePulseRows` branch).
- `api/fleet-status-client.ts` — reconnect never permanently gives up (settles into `SLOW_RETRY_MS = 30_000` indefinitely after `MAX_RECONNECT_ATTEMPTS`); wakes on visibilitychange on every platform (no iOS-PWA gate); `Math.floor(Math.random() * capMs)` full-jitter preserved byte-identical; no replay/reconciliation on reconnect.
- `AppShell.tsx` — `fetchAndApplyFleetSessions({ isColdStart })` shared by mount + visibility effect; `getSessionList` fires on mount AND on becoming-visible (D-07 shape-lock comment amended in place); cold-start catch branch calls `updateFleetSessions([])` (safe post-hotfix); re-ask catch branch does NOTHING to state (defense-in-depth).
- `features/pretty-conversations/PrettyConversationsPanel.tsx` UNTOUCHED (its hydrate gate is exactly what Problem 2 needs to fix — do NOT touch until you're ready to work Problem 2).

## Deployment state at time of writing

- HEAD `295ea0ef` on `feat/tab-title-from-tmux`, pushed to origin.
- Image `skynet-patched:local` fresh from that HEAD.
- Container recreated 2026-09-16 T23:40Z, healthy, HTTPS 200.
- All expected startup lines present in `docker logs`; no phase-111-introduced warnings.
- Two pre-existing warnings still there and unrelated (hostIds 10 and 17 fail `echo $HOME`; documented earlier-phase bug).

## Working tree state at time of writing

- On `feat/tab-title-from-tmux`, matches origin HEAD (`git status` clean).
- No stray worktrees (`git worktree list` shows only the primary).
- No stashes.
- `.planning/phases/111-conversation-list-arrives-complete-and-stays-live-one-comple/` has all six PLAN/SUMMARY pairs + CONTEXT.md + RESEARCH.md + PATTERNS.md + VERIFICATION.md.
- `.planning/shapes/shape-conversation-list-complete-and-live.md` is the shape file the whole thing was built against. `/close conversation-list-complete-and-live` was NOT run yet — it's the arc-closer once these two remaining problems are landed, and it will verify the built result against the shape both ways (nothing missing, nothing added).

## Recommended vehicle for the next session

Both problems are small — each is roughly the size of the two hotfixes I did mid-Phase-111 (`993048cd` and `295ea0ef`). Neither warrants a full phase.

My recommendation: `/build` mode, treat each as its own fix-mode arc (skip the full shape-first ceremony), do them in sequence:

1. **First:** Problem 1 (appearance cache) — because Problem 2 becomes trivial to test once cold paint is already dressed.
2. **Then:** Problem 2 (pin/hide organization).
3. **Then:** run `/close conversation-list-complete-and-live` to close the campaign arc against the shape file.
4. **Then:** account for the 5 overlapping bounties (see bounty.json `related` field).

Ship both together as one deploy motion once Ashley greenlights.

## What NOT to do

- Do NOT frame the appearance cache as "deferred" or "the follow-up piece" — Ashley corrected me sharply on this at the end of the session. It was always in scope; her mental model has always been "cache everything and paint from cache instantly."
- Do NOT bump `SWEEP_SCHEMA_VERSION` or `FRAME_SCHEMA_VERSION`. Both stay 1.
- Do NOT touch `subscription-registry.ts` or `PrettyConversationsPanel.tsx` for Problem 1. The panel is only touched for Problem 2, and only its hydrate effect gate.
- Do NOT let any pulse-fed write flip `identities-store.loaded` (D-10). Every seed from cache and every merge from the pulse carries `loaded: state.loaded`.
- Do NOT try to fix tina's frontmatter yourself — Ashley said leave it for tina.
- Do NOT propose worktrees for anything.
- Do NOT try mtime-gating anywhere — measured and rejected.
- Do NOT run the full unscoped test suite in executor scope — that's a deploy-gate, orchestrator-only.

## First action of the next session

Read this file. Then read the bounty.json above. Then read the shape file at `.planning/shapes/shape-conversation-list-complete-and-live.md`. Then start Problem 1.
