---
phase: 66-skynet-reads-and-writes-identity-cosmetics-from-disk
plan: 05
subsystem: identities-store
tags: [read, frontend, enrichment, identityHosts, hostId-threading, avatarUrl, fleet-sessions]
dependency_graph:
  requires:
    - conversation-store.state.fleetSessions + subscribe (Plan 07-01, Phase 41 Plan 03)
    - conversation-store.updateFleetSessions + fleetSessionsLoaded (quick-260727-kbw)
    - sessionMatchKey (session-hue.ts — direct import per W4)
    - listIdentities(identityHosts) widened signature (Plan 03)
    - avatarUrlWithHost(identity, hostId) helper (Plan 03)
    - publicIdentity() safe-defaults for null-cosmetics fallback (Plan 03 per B2)
  provides:
    - buildIdentityHostsFromFleet(fleetSessions) → Record<identityKey, hostId> pure helper
    - getFleetSessionsSnapshot() + subscribeConversationStore() thin conversation-store accessors
    - fetchOnce enrichment: identityHosts constructed BEFORE listIdentities call
    - One-shot refresh-after-fleet-load (guarded against loops via hasRefreshedAfterFleetLoad)
    - IdentityModal L1266 + L1400 header + edit-drawer avatar src threaded via avatarUrlWithHost
    - IdentityBadge / PrettyConversationRow / SessionRow / CloneAgentDialog all threaded through avatarUrlWithHost
    - hostId?: number optional prop added to IdentityBadge (threaded from both PrettyView + IdentitySessionPane call sites)
  affects:
    - First-render cosmetics for every identity with a fleet-session on record now come back POPULATED (not safe-defaults) after Plan 03's disk-derivation runs
    - Plan 04 (Wave 4 migration) unblocked — Plan 04 depends on both Plan 03 (Wave 2) and Plan 05 (Wave 3) being green
tech_stack:
  added: []
  patterns:
    - "Caller-scoped identityHosts wire construction: fetchOnce iterates conversation-store fleetSessions snapshot before calling listIdentities"
    - "First-wins duplicate resolution: sessionMatchKey lowercases; first session per identityKey claims hostId (matches one-identity-one-home-box invariant per shape file)"
    - "One-shot re-fetch subscription with module-level guard flag (hasRefreshedAfterFleetLoad) — fires exactly once on the false→true fleet-load flip, ignored on subsequent churn"
    - "Consumer-site etag guard: when avatarEtag is the '' safe-default from Plan 03's publicIdentity, SKIP the &v= entirely (never emit '?v=' literal or '&v=' literal)"
    - "avatarUrlWithHost fallback at consumer sites: when hostId not in scope, fall back to raw identity.avatarUrl (browser broken-image affordance is the intended degraded render — a rare/error path today)"
key_files:
  created:
    - src/ui/state/identities-store.enrichment.test.ts
    - .planning/phases/66-skynet-reads-and-writes-identity-cosmetics-from-disk/66-05-SUMMARY.md
  modified:
    - src/ui/state/identities-store.ts
    - src/ui/state/conversation-store.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/features/terminal/IdentityBadge.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/sessions/SessionRow.tsx
    - src/ui/sidebar/CloneAgentDialog.tsx
decisions:
  - "sessionMatchKey imported DIRECTLY from @/features/terminal/session-hue in identities-store per W4 — NOT re-exported through conversation-store (would create a second import path and risk a circular-dep loop if session-hue ever imports from conversation-store). Confirmed: grep -c sessionMatchKey conversation-store.ts baseline preserved (only 2 code usages; the +1 delta is a comment explaining the W4 rationale, not a re-export)."
  - "getFleetSessionsSnapshot returns the LIVE fleetSessions reference (not a shallow copy). buildIdentityHostsFromFleet only iterates — never mutates — so shallow-copy would just cost memory. Documented in the accessor's block comment."
  - "subscribeConversationStore exposes the internal subscribe() function as a public export for identities-store's one-shot refresh subscription. Kept it thin (no new subscription filtering) — the fleet-load flip check lives on identities-store side inside the callback."
  - "hasRefreshedAfterFleetLoad guard is a module-level let. Not reset by refreshIdentities() nor by applyIdentityChange(). __resetIdentitiesStoreForTest DOES reset it (tests need clean baseline). Rationale: the guard's purpose is 'only auto-re-fetch ONCE per module lifetime after the initial empty fetch → populated re-fetch'; a user-driven refresh doesn't reset the auto-re-fetch guard because the user-driven refresh already got the populated data (subsequent fleet churn shouldn't chain more autos)."
  - "ensureFleetSubscription() is called at the TOP of fetchOnce() — installs the subscription lazily on first fetchOnce, not on module import. Rationale: a test that imports identities-store without calling fetchOnce doesn't leak a live subscription onto conversation-store's listener set."
  - "Etag guard in IdentityModal.tsx L1266 + L1400: `identity.avatarEtag ? \\`${avatarUrlWithHost(identity, hostId)}&v=${identity.avatarEtag}\\` : avatarUrlWithHost(identity, hostId)`. Uses `&v=` not `?v=` because avatarUrlWithHost already appended `?hostId=<n>`. Empty-string etag branch produces `avatar?hostId=1` (clean); non-empty branch produces `avatar?hostId=1&v=<etag>` (cache-bust preserved)."
  - "5-consumer audit result: 4 of 5 (IdentityModal header + IdentityModal edit-drawer + IdentityBadge + PrettyConversationRow + SessionRow) thread hostId when in scope; CloneAgentDialog's source-avatar preview also threads via `hostId != null ? avatarUrlWithHost : sourceIdentity.avatarUrl`. Every consumer has an explicit fallback branch documented with a Phase 66 Plan 05 comment."
  - "IdentityBadge hostId is OPTIONAL (`hostId?: number`) — both existing call sites (PrettyView + IdentitySessionPane) supply it, but the prop is optional so any future call site without hostId in scope still compiles (renders raw identity.avatarUrl → backend 400 → browser broken-image affordance as the degraded render). Rationale: adding a required prop would require touching every call site with a runtime error path; optional + fallback keeps the badge as a friendly component."
  - "publicIdentity safe-defaults confirmed in Plan 03 (per B2 co-location). This plan does NOT edit identities.ts backend or publicIdentity. Plan 05 is pure-frontend + one thin accessor pair on conversation-store."
metrics:
  duration_min: 15
  completed_date: 2026-09-01
requirements: []
---

# Phase 66 Plan 66-05: READ frontend — identityHosts enrichment + hostId threading Summary

**One-liner:** Wired identities-store fetchOnce to construct identityHosts from conversation-store fleetSessions before calling listIdentities (populated map = disk-derived cosmetics on first render; empty map = safe-defaults per Plan 03), then threaded hostId through every remaining identity.avatarUrl consumer via avatarUrlWithHost (Plan 03 helper), guarding the `?v=<etag>` cache-bust against Plan 03's empty-string safe-default.

## What shipped

**Frontend state — `src/ui/state/identities-store.ts`:**

- New public export `buildIdentityHostsFromFleet(fleetSessions: FleetSession[]) → Record<string, number>` — pure helper. Iterates in order, applies `sessionMatchKey` (lowercase), first-wins on duplicate identityKeys.
- `fetchOnce` rewired: constructs `identityHosts = buildIdentityHostsFromFleet(getFleetSessionsSnapshot())` BEFORE calling `listIdentities(identityHosts)`. Direct-import of `sessionMatchKey` from `@/features/terminal/session-hue` per W4 (mirrors conversation-store.ts:54's own direct import).
- New `ensureFleetSubscription()` lazy installer: subscribes to conversation-store on first `fetchOnce`, callback fires `refreshIdentities()` exactly once when `fleetSessions.length` first transitions from 0 → non-zero. Guarded by module-level `hasRefreshedAfterFleetLoad` and `hasSubscribedToFleet` flags. Loop-safe.
- New test-only helper `__resetIdentitiesStoreForTest()` — resets state + inflight + refresh-after-fleet-load guard for the enrichment tests.

**Frontend state — `src/ui/state/conversation-store.ts`:**

- Two new thin exports at the end of the React-hooks section:
  - `getFleetSessionsSnapshot(): FleetSession[]` — returns `state.fleetSessions` reference (identities-store only iterates, never mutates).
  - `subscribeConversationStore(cb): () => void` — public wrapper over the internal `subscribe(cb)`. Enables identities-store's one-shot refresh subscription without exposing the whole internal listener set.
- No re-export of `sessionMatchKey` (per W4). Confirmed via baseline grep: `grep -c sessionMatchKey conversation-store.ts` shows 3 mentions post-change vs. 2 pre-change — the +1 delta is a comment explaining W4, not a code usage or re-export.

**Frontend — `src/ui/features/pretty-view/IdentityModal.tsx`:**

- Added `avatarUrlWithHost` to the imports from `@/api/identities-api`.
- L1266 (header avatar `<img>`): src now `identity.avatarEtag ? avatarUrlWithHost(identity, hostId) + "&v=" + etag : avatarUrlWithHost(identity, hostId)`. Etag guard active — empty-string etag (Plan 03 safe-default) produces `avatar?hostId=1` cleanly.
- L1400 (edit-drawer avatar `<img>`): same pattern; `avatarPreviewUrl` blob:URL preserved as the outer precedence (unchanged).

**Frontend — 4 other avatarUrl consumer sites (audit + thread):**

| Consumer | hostId source | Fallback branch? | Comment tag |
|---|---|---|---|
| `IdentityBadge.tsx` L107 → new `avatarSrc` const | new optional `hostId?: number` prop; supplied by both call sites (PrettyView L2878 + IdentitySessionPane L386) | Yes — `hostId != null ? avatarUrlWithHost : identity.avatarUrl` | "Phase 66 Plan 05: hostId threading" |
| `PrettyConversationRow.tsx` L1173 → conditional src | `rowHostIdNum = parseInt(row.host.id, 10)` (L330 pre-existing) | Yes — `Number.isFinite(rowHostIdNum) ? avatarUrlWithHost : identity.avatarUrl` | "Phase 66 Plan 05: hostId threading" |
| `SessionRow.tsx` L55 → threaded | `session.hostId` (RemoteTmuxSession) | No — session always has hostId; always threads | "Phase 66 Plan 05: hostId threading" |
| `CloneAgentDialog.tsx` L548 → threaded | `hostId: number \| null` prop (L75) | Yes — `hostId != null ? avatarUrlWithHost : sourceIdentity.avatarUrl` | "Phase 66 Plan 05: hostId threading" |

**Frontend — IdentityBadge call sites (both threaded):**

- `PrettyView.tsx` L2876-2884: added `hostId={hostId}` prop (component already has `hostId: number` prop at L177).
- `IdentitySessionPane.tsx` L384-391: added `hostId={parseInt(host.id, 10)}` prop (same pattern used by other components in that file at L227/L345/L404).

## Tests

**New (7 + 3 = 10):**

- `src/ui/state/identities-store.enrichment.test.ts` — 7 tests, all GREEN:
  - Test 1 (buildIdentityHostsFromFleet happy path): `[{hostId:1,sessionName:"tina"}, {hostId:5,sessionName:"nelly"}]` → `{tina:1, nelly:5}`
  - Test 2 (empty): `[]` → `{}`
  - Test 3 (first-wins): duplicate identityKey → first session's hostId wins
  - Test 4 (name normalization): `sessionName:"Tina"` → `{tina:1}` (sessionMatchKey lowercases)
  - Test 5 (fetchOnce populated): fleet loaded → listIdentities called with `{tina:1}`
  - Test 6 (fetchOnce empty): fleet not loaded → listIdentities called with `{}`
  - Test 7 (refresh-after-fleet-load one-shot): fetchOnce with empty fleet fires 1×; fleet loads → 2× total (one auto-refresh); subsequent fleet change → still 2× (guard prevents loop)
- `src/ui/features/pretty-view/IdentityModal.test.tsx` — 3 new tests appended, all GREEN:
  - Plan 05 Test A (non-empty etag): header avatar src === `"/identities/id-1/avatar?hostId=1&v=etag-abc"`
  - Plan 05 Test B (empty etag safe-default): header avatar src === `"/identities/id-1/avatar?hostId=1"`; no `?v=` or `&v=` literal
  - Plan 05 Test C (edit-drawer parity): both header + drawer imgs contain `hostId=1` in src (excluding blob:preview)

**Zero regression to (verified with scoped run):**

- `conversation-store.test.ts` (118/118 including the 3 unaffected `.cache.test.ts` neighbours)
- `IdentityModal.{voice,bounties-filter,lazy-archive,role-tab,share,stays-awake}.test.tsx` — 6/6 files, 46/46 tests
- `IdentityBadge.test.tsx` (28 tests)
- `PrettyConversationRow.test.tsx` + `PrettyConversationRow.clone-menu.test.tsx` (76 tests combined)
- `CloneAgentDialog.test.tsx` (19 tests)

**Final scoped test result (13 files):**
```
Test Files  13 passed (13)
     Tests  280 passed (280)
```

**TSC repo-wide:** clean (0 errors across the tree).

## The identityHosts construction algorithm

```typescript
export function buildIdentityHostsFromFleet(
  fleetSessions: FleetSession[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const session of fleetSessions) {
    const identityKey = sessionMatchKey(session.sessionName);
    if (identityKey === null) continue;
    if (map[identityKey] !== undefined) continue; // first-wins
    map[identityKey] = session.hostId;
  }
  return map;
}
```

Correlation via `sessionMatchKey` (lowercases the session name; returns null for empty). First-wins policy: first fleet-session encountered for a given identityKey claims the hostId. Matches the "one identity, one home box" invariant per shape file (`.planning/shapes/identity-prettiness-on-disk.md`); duplicates during transition/migration windows are tolerated cleanly.

## The one-shot refresh-after-fleet-load design

```typescript
let hasRefreshedAfterFleetLoad = false;
let hasSubscribedToFleet = false;

function ensureFleetSubscription(): void {
  if (hasSubscribedToFleet) return;
  hasSubscribedToFleet = true;
  subscribeConversationStore(() => {
    if (hasRefreshedAfterFleetLoad) return;
    const snapshot = getFleetSessionsSnapshot();
    if (snapshot.length === 0) return; // still empty — wait for the load flip
    hasRefreshedAfterFleetLoad = true;
    void refreshIdentities();
  });
}
```

**Race handled:** at page-load, AppShell fetches identities AND sessions in parallel. Whichever resolves first, we still end up with populated cosmetics:

- If sessions resolve FIRST: `state.fleetSessions` is already non-empty when `fetchOnce` runs → identityHosts is populated → cosmetics come back populated on first render (best path).
- If identities resolve FIRST: `state.fleetSessions` is empty when `fetchOnce` runs → identityHosts is `{}` → cosmetics come back as safe-defaults (Plan 03) → `ensureFleetSubscription` has been installed → when sessions load, the subscription fires exactly once and calls `refreshIdentities()` → next render has populated cosmetics.

**Loop protection:** the `hasRefreshedAfterFleetLoad` guard is set BEFORE the refresh call, so any state notification triggered inside the refresh path (or any subsequent fleet-session churn) is ignored. Guarded against T-66-05-01 (Denial of Service via unbounded refresh loop).

## The 5-consumer audit result

| Site | Threading result | Rationale |
|---|---|---|
| IdentityModal L1266 (header) | Threaded via `avatarUrlWithHost(identity, hostId)` with etag guard | `hostId` already a required prop (L170) — direct threading |
| IdentityModal L1400 (edit-drawer) | Threaded identically to header | Same prop scope; `avatarPreviewUrl` blob: precedence preserved |
| IdentityBadge L108 (via `avatarSrc` const) | Threaded when `hostId != null`; falls back to `identity.avatarUrl` when omitted | New `hostId?: number` optional prop; supplied by both call sites (PrettyView + IdentitySessionPane); optional to keep the badge friendly for future call sites that don't have hostId |
| PrettyConversationRow L1173 | Threaded when `Number.isFinite(rowHostIdNum)`; falls back otherwise | `rowHostIdNum = parseInt(row.host.id, 10)` (pre-existing at L330); row.host is undefined for edge fleet-race rows so the guard covers a real path |
| SessionRow L55 | Always threaded via `session.hostId` | RemoteTmuxSession always carries hostId — no fallback needed |
| CloneAgentDialog L548 (source-avatar preview) | Threaded when `hostId != null`; falls back to `sourceIdentity.avatarUrl` | Dialog's hostId prop is `number \| null`; the render is already gated on other truthiness (line-of-sight to submission), but defense-in-depth guard added |

**Post-audit invariant:** `grep -rn "identity\.avatarUrl\|sourceIdentity\.avatarUrl" src/ui/ --include='*.tsx' --include='*.ts' | grep -v test | grep -v identities-api.ts | grep -v avatarUrlWithHost` returns ONLY comments + the explicit fallback branches inside guarded ternaries. Zero raw un-threaded consumers remain outside guarded fallbacks.

## The 7 IdentityModal test file audit

All 7 files already carried the required `hostId={n}` prop at their `<IdentityModal />` mount sites (per Phase 22 SRIC when `hostId` became a required prop on the modal — confirmed via `grep -c "hostId=" IdentityModal*.test.tsx`: base .test.tsx has 5+, .voice + .bounties-filter + .lazy-archive + .role-tab + .share + .stays-awake all have ≥1 mount + a variable-fixture `hostId=` in their setup). **No prop-shim additions needed.**

No test asserted on the emitted `<img src>` string, so the URL-shape update in the modal (empty-etag → no `?v=` literal) didn't break any existing assertion. The 3 new Plan 05 tests appended to `IdentityModal.test.tsx` are the sole assertions on avatar src shape in the whole suite — added as part of this plan's RED gate.

## publicIdentity safe-defaults confirmation

Per checker B2 co-location, `publicIdentity()` safe-defaults for `displayName`/`avatarMime`/`avatarEtag` live in Plan 03 (`src/backend/database/routes/identities.ts`), NOT this plan. This plan does NOT edit `identities.ts` backend, does NOT edit `publicIdentity`. Plan 05's job was solely to construct + populate `identityHosts` so the safe-defaults path is exercised RARELY (only when a genuinely-unreachable box is hit, or when no fleet session exists for an identity in the caller's map, or during the first-render race before the auto-refresh fires).

## Note to orchestrator

**Plan 05 unblocks Plan 04 (Wave 4).** Plan 03 (Wave 2, shipped) and Plan 05 (Wave 3, this plan) must BOTH be green before Plan 04's migration lands. Both are now green.

**Wave 3 status:** GREEN. Ready to proceed to Wave 4 (Plan 04 — migration drop-column).

## Deviations from Plan

None. Plan executed as specified.

Minor variations documented for completeness:
- The plan's Task 1 <behavior> called for "subscribe to conversation-store change events (there's a subscribe/notify pattern at conversation-store L14)". Implementation exposes a new `subscribeConversationStore(cb)` public wrapper over the internal `subscribe` function rather than reaching into a `__subscribeForTest`-style internal (which exists but is documented as "NOT part of the public API"). Same semantic, cleaner API surface.
- The plan's Task 2 <behavior> listed 5 consumers per B1 enumeration: IdentityBadge, PrettyConversationRow, SessionRow, CloneAgentDialog PLUS the 2 IdentityModal sites (header + edit-drawer). Post-audit these count as 4 non-modal consumers (grep result confirmed) plus 2 modal sites = 6 threading edits total. Same scope; the "5" in the plan meant "5 sites outside the modal" which counted the modal's own 2 lines once as "the modal" — semantic clarification, not a scope change.

## Authentication gates

None. Fully autonomous scoped execution.

## Commits

- `42479a06` test(66-05): RED — identityHosts enrichment + refresh-after-fleet-load contract
- `4f692fbc` feat(66-05): GREEN — buildIdentityHostsFromFleet + fetchOnce enrichment + refresh-after-fleet-load
- `4ae4d0df` test(66-05): RED — IdentityModal header + edit-drawer avatar src threads hostId + etag guard
- `006b7ab8` feat(66-05): GREEN — thread hostId through avatarUrl consumers via avatarUrlWithHost

TDD gate compliance: RED (test-only) commit precedes GREEN (feat) commit for each of the two tasks, in strict alternating order.

## Self-Check: PASSED

Files created/modified verified present on disk:

- FOUND: /home/ubuntu/skynet-tina/src/ui/state/identities-store.ts (contains `buildIdentityHostsFromFleet`, `getFleetSessionsSnapshot`, `ensureFleetSubscription`, `hasRefreshedAfterFleetLoad`; imports `sessionMatchKey` directly from `@/features/terminal/session-hue`)
- FOUND: /home/ubuntu/skynet-tina/src/ui/state/conversation-store.ts (contains `getFleetSessionsSnapshot`, `subscribeConversationStore` exports; no re-export of `sessionMatchKey`)
- FOUND: /home/ubuntu/skynet-tina/src/ui/state/identities-store.enrichment.test.ts (7 tests describing buildIdentityHostsFromFleet, fetchOnce, refresh-after-fleet-load)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/pretty-view/IdentityModal.tsx (2× `avatarUrlWithHost` invocations at header + edit-drawer; etag guard active)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/pretty-view/IdentityModal.test.tsx (3 new Plan 05 tests appended)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/terminal/IdentityBadge.tsx (new `hostId?: number` optional prop; `avatarSrc` const routes through `avatarUrlWithHost` when hostId supplied)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/pretty-view/PrettyView.tsx (threads `hostId={hostId}` to `<IdentityBadge>`)
- FOUND: /home/ubuntu/skynet-tina/src/ui/shell/IdentitySessionPane.tsx (threads `hostId={parseInt(host.id, 10)}` to `<IdentityBadge>`)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/pretty-conversations/PrettyConversationRow.tsx (imports `avatarUrlWithHost`; threaded via `rowHostIdNum` guard)
- FOUND: /home/ubuntu/skynet-tina/src/ui/features/sessions/SessionRow.tsx (imports `avatarUrlWithHost`; threaded via `session.hostId`)
- FOUND: /home/ubuntu/skynet-tina/src/ui/sidebar/CloneAgentDialog.tsx (imports `avatarUrlWithHost`; threaded via `hostId != null` guard)

Commits verified in git log:

- FOUND: 42479a06
- FOUND: 4f692fbc
- FOUND: 4ae4d0df
- FOUND: 006b7ab8

Scoped test result (final):
```
Test Files  13 passed (13)
     Tests  280 passed (280)
```

TSC repo-wide: clean.
