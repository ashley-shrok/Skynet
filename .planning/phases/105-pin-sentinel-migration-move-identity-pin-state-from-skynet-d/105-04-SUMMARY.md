---
phase: 92-pin-sentinel-migration
plan: 04
subsystem: frontend
tags: [pin-sentinel, user-preferences, identities-store, conversation-store, PrettyConversationsPanel, disk-projection, D-04, D-05, D-06, H2-single-derivation]

requires:
  - phase: 92-02
    provides: publicIdentity.pinned:boolean populated from disk-read at request time; PUT /user-preferences accepts identityHosts and drives per-identity `.pinned` sentinel writes
  - phase: 92-03
    provides: DB pinned_conversation_ids column physically dropped — no stale-DB read path can silently re-surface
provides:
  - deriveDiskPinnedIds(identityHosts) selector on identities-store — projects each identity's `pinned: boolean` field into the `fleet::<hostId>::<sessionName>` row id space (D-04)
  - putPinnedIds(ids, identityHosts) widened signature — identityHosts is the second arg, sourced from buildIdentityHostsFromFleet (single derivation site per H2)
  - PrettyConversationsPanel hydrate effect rewired: buildIdentityHostsFromFleet(getFleetSessionsSnapshot()) → deriveDiskPinnedIds(identityHosts) → hydratePinnedIdsFromServer(pinnedIds); hiddenIds path untouched (D-02)
  - conversation-store pinConversation/unpinConversation callsites REUSE buildIdentityHostsFromFleet (no local `deriveIdentityHostsMap`; no `sessionName.toLowerCase()` — H2 anti-pattern absent)
  - Identity type widened with `pinned?: boolean` (identities-api.ts)
  - H2 anti-pattern regression traps: STORE-92-04 (relay-room skip) + PANEL-92-04 (build → derive → hydrate call chain) + grep-hygiene absence of `deriveIdentityHostsMap` and `sessionName.toLowerCase` in conversation-store.ts

affects: []

tech-stack:
  added: []
  patterns:
    - "Frontend disk-authoritative projection: identities-store's per-identity `pinned: boolean` (populated by backend disk-read per D-03) is the source-of-truth substrate; deriveDiskPinnedIds projects it into the fleet::hostId::sessionName id space the row builder emits, guaranteeing byte-for-byte match with state.pinnedIds"
    - "H2 single-derivation-site invariant: buildIdentityHostsFromFleet (identities-store.ts:74-85) is the ONLY place fleetSessions → identityHosts derivation lives; consumed by both the identities-store fetch AND the conversation-store pin toggle callsites AND the panel hydrate effect — reused by import, never re-implemented"
    - "Fail-closed pin projection: an identity with `pinned` field absent from the response is treated as unpinned (matches backend Plan 02's identityFileExists throw → false semantics); an identity not present in identityHosts is filtered out (can't render as pinned without a row-render substrate anyway)"
    - "UI-feel preservation (D-06): pin toggle behavior byte-identical to pre-Phase-92 — same right-click menu, same fire-and-forget putPinnedIds call, same silent-catch on failure, same hydrate-on-mount reconciliation. Only the DATA SOURCE for the reconciliation shifted; failure UX unchanged per Ashley 2026-09-09 'however it would have failed already is how it will fail today'"
    - "Circular-import late-binding: conversation-store.ts imports buildIdentityHostsFromFleet from identities-store, identities-store.ts imports FleetSession + getFleetSessionsSnapshot + subscribeConversationStore from conversation-store. ES module cycles resolve via late-bound function references at call time — verified green across 114 conversation-store tests"

key-files:
  created:
    - src/ui/api/user-preferences-api.test.ts
  modified:
    - src/ui/api/user-preferences-api.ts
    - src/ui/api/identities-api.ts
    - src/ui/state/identities-store.ts
    - src/ui/state/conversation-store.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/state/identities-store.enrichment.test.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/state/conversation-store.cache.test.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
    - src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx

key-decisions:
  - "deriveDiskPinnedIds lives on identities-store (not a new module) — colocated with buildIdentityHostsFromFleet keeps the H2 lock visually enforced: reader sees both exports on adjacent lines and understands they're the paired read+write helpers for the fleetSessions → identityHosts identity space"
  - "Identity.pinned is OPTIONAL (`pinned?: boolean`, not `pinned: boolean`) — preserves backward compat with test fixtures constructed via `makeIdentity()` builders across the frontend test suite that don't care about the field, AND matches backend behavior where publicIdentity's sixth arg defaults to false (Plan 92-02). Fail-closed at both boundaries."
  - "Panel hydrate effect projection runs SYNCHRONOUSLY when the fleet-loaded gate flips true — no await needed for the deriveDiskPinnedIds path because it reads module-scoped state.identities from identities-store directly. The hidden-slice fetch (getHiddenIds) stays in the same effect body as an awaited async call — one effect, two data sources, one cancel-token."
  - "Retired getPinnedIds entirely (no compat shim) — a compat shim that throws would surface as an uncaught rejection in the console noise floor; a hard-remove surfaces as `undefined is not a function` at the exact callsite, which is the more useful regression signal. All 6 test files that mocked `getPinnedIds` had the mock line removed simultaneously."
  - "STORE-92-04 (H2 relay-room regression trap) exercises the anti-pattern crash directly: seeds a FleetSession with `sessionName===undefined` (relay-room shape per conversation-store.ts L710-731), asserts pinConversation does NOT throw during identityHosts derivation. Any future refactor that inlines `session.sessionName.toLowerCase()` in the pin path will crash this test loudly."

patterns-established:
  - "Backend-populated disk field → frontend Set projection: publicIdentity's `pinned: boolean` (Plan 02) → deriveDiskPinnedIds projection over identityHosts → state.pinnedIds. Candidate pattern for future D-03-style fields (e.g. `.no-dormancy`, `.recycle-requested` frontend projections if either ever wants a bulk row-state view instead of the current per-identity fetch)"
  - "Reuse-by-import H2 discipline: whenever a helper's semantics matter (sessionMatchKey null-skip, key normalization, host-mapping filter), import the existing helper rather than re-implementing. The identities-store's buildIdentityHostsFromFleet is now consumed at 3 sites (its own fetch, the pin toggle write, the panel hydrate read) — one derivation, one audit surface."

requirements-completed: [D-04, D-05-frontend, D-06, D-09]

duration: 20min
completed: 2026-09-09
---

# Phase 92 Plan 92-04: Rewire pin state — frontend read/write path Summary

**Frontend now derives `state.pinnedIds` by projecting each identity's `pinned: boolean` field (populated on-demand from disk per Plan 92-02) via `deriveDiskPinnedIds(identityHosts)`; the `putPinnedIds` write includes `identityHosts` sourced from `buildIdentityHostsFromFleet` so the backend fanout resolves each host; `getPinnedIds()` retired from user-preferences-api entirely.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-09T19:15:00Z
- **Completed:** 2026-09-09T19:34:00Z
- **Tasks:** 2 (Task 1 API + selector; Task 2 store callsites + panel hydrate — executed TDD RED→GREEN across both)
- **Files modified:** 14 (1 created, 13 modified)

## Accomplishments

- **Task 1 shipped — API surface reshape:**
  - `putPinnedIds(ids, identityHosts)` widened. Body now carries both keys; the backend fanout uses `identityHosts` to route each `.pinned` sentinel write. Server-echo comparison + console.warn on divergence preserved from Phase 15.
  - `getPinnedIds()` DELETED from user-preferences-api. The hydrate path no longer hits GET /user-preferences for the pinned slice.
  - `deriveDiskPinnedIds(identityHosts): string[]` added to identities-store, exported alongside the existing `buildIdentityHostsFromFleet`. Projects `identity.pinned === true` identities into the `fleet::${hostId}::${key}` row id space; fail-closed on missing `pinned` field; filters identities without a host mapping.
  - Identity type widened with `pinned?: boolean` (identities-api.ts) — optional to preserve fixture compat.

- **Task 2 shipped — pin toggle + panel hydrate rewires:**
  - `pinConversation` / `unpinConversation` in conversation-store.ts import `buildIdentityHostsFromFleet` from identities-store and thread the derived map as the second arg to `putPinnedIds`. H2 anti-pattern comment blocks near both callsites explicitly forbid the `sessionName.toLowerCase()` inline pattern.
  - PrettyConversationsPanel hydrate effect (L475+) rewritten:
    ```ts
    const identityHosts = buildIdentityHostsFromFleet(getFleetSessionsSnapshot());
    const pinnedIds = deriveDiskPinnedIds(identityHosts);
    if (cancelled) return;
    hydratePinnedIdsFromServer(pinnedIds);
    ```
    followed by the untouched `getHiddenIds()` fetch (D-02 out-of-scope, still routes through /user-preferences).
  - `getFleetSessionsSnapshot` added to the panel's conversation-store imports so the hydrate effect can read the fleet snapshot at effect-fire time.

- **Circular import handled cleanly:** conversation-store.ts imports `buildIdentityHostsFromFleet` from identities-store.ts; identities-store.ts imports `FleetSession`, `getFleetSessionsSnapshot`, `subscribeConversationStore` from conversation-store.ts. ES module cycles resolve via late-bound function references — verified GREEN across all 114 conversation-store tests + all 51 sibling tests.

- **H2 anti-pattern regression traps landed at 4 sites:**
  - **SEL-92-04** (identities-store.enrichment.test.ts): asserts both `buildIdentityHostsFromFleet` AND `deriveDiskPinnedIds` are exported as functions from identities-store — a rewrite that silently deletes one export trips.
  - **STORE-92-04** (conversation-store.test.ts): seeds a FleetSession with `sessionName===undefined` (relay-room shape per conversation-store.ts L710-731); asserts `pinConversation` does NOT throw during derivation, asserts the identityHosts map omits any `undefined` key and any `undefined` value, asserts byte-for-byte equality with `buildIdentityHostsFromFleet(fleetSessions)`.
  - **PANEL-92-04** (PrettyConversationsPanel.test.tsx): asserts the panel hydrate effect calls `buildIdentityHostsFromFleet(fleetSessions)` → `deriveDiskPinnedIds(identityHosts)` → `hydratePinnedIdsFromServer(pinnedIds)` in that order with those exact arguments.
  - **Grep-hygiene** locked in commit body: `deriveIdentityHostsMap` (H2 forbidden helper name) → 0 hits across `src/ui/`; `sessionName.toLowerCase` in `src/ui/state/conversation-store.ts` → 0 code hits (only 2 anti-pattern warning comments).

- **UI feel invariant preserved (D-06):** pin toggle from the user's perspective is byte-identical to pre-Phase-92. Same right-click menu entry text, same fire-and-forget optimistic flip, same silent-catch on network failure, same hydrate-on-mount reconciliation. Ashley 2026-09-09 verbatim: "however it feels now is how it's going to feel after this."

- **hiddenConversationIds slice UNTOUCHED (D-02 out-of-scope):** PANEL-92-03 asserts `getHiddenIds()` STILL fires from the panel hydrate effect and routes through `hydrateHiddenIdsFromServer`. The hidden path was NOT rewired in Phase 92 — that's a separate future phase's problem if it ever ships.

## Task Commits

Task 1 (TDD RED → GREEN):
1. `4e16f64e` (test) — RED: 8 failing tests (API-92-01..04 + SEL-92-01..05) for putPinnedIds new signature + getPinnedIds removal + deriveDiskPinnedIds selector projection semantics.
2. `ad0d4b8a` (feat) — GREEN: putPinnedIds widened, getPinnedIds deleted, deriveDiskPinnedIds added alongside buildIdentityHostsFromFleet, Identity.pinned optional field added.

Task 2 (TDD RED → GREEN):
3. `304c4268` (test) — RED: 12 failing tests (STORE-92-01..04 in conversation-store.test.ts + PANEL-92-03/04 in PrettyConversationsPanel.test.tsx + Test 21/22 rewires + updated 30j/30k/30p signatures). Sibling test files updated with the new mock shape.
4. `75eccd13` (feat) — GREEN: pinConversation/unpinConversation callsites pass identityHosts via buildIdentityHostsFromFleet; PrettyConversationsPanel hydrate effect uses buildIdentityHostsFromFleet → deriveDiskPinnedIds → hydratePinnedIdsFromServer.

## Files Created/Modified

- **`src/ui/api/user-preferences-api.test.ts`** (created, 100 lines) — 4 tests: API-92-01 (putPinnedIds body shape), API-92-02 (empty identityHosts permitted), API-92-03 (getPinnedIds export removed), API-92-04 (server-echo return preserved).
- **`src/ui/api/user-preferences-api.ts`** (modified) — deleted `getPinnedIds`, widened `putPinnedIds` signature to `(ids, identityHosts)` with body shape `{pinnedConversationIds, identityHosts}`. Header docblock updated with Phase 92 context.
- **`src/ui/api/identities-api.ts`** (modified) — Identity type grew optional `pinned?: boolean` field with a Phase 92 D-03/D-04 docblock.
- **`src/ui/state/identities-store.ts`** (modified) — added `deriveDiskPinnedIds(identityHosts): string[]` export with a 30-line docblock covering H2 lock rationale + fail-closed semantics + H3 lowercase-on-disk invariant. `buildIdentityHostsFromFleet` export unchanged (H2 reuse lock).
- **`src/ui/state/conversation-store.ts`** (modified) — imported `buildIdentityHostsFromFleet` from identities-store; pinConversation and unpinConversation both build `identityHosts` via that helper and pass it as the second arg to `putPinnedIds`. H2 anti-pattern comment blocks at both callsites.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`** (modified) — retired `getPinnedIds` import; added `deriveDiskPinnedIds` + `buildIdentityHostsFromFleet` imports from identities-store; added `getFleetSessionsSnapshot` import from conversation-store; hydrate effect at L475+ rewritten to run the projection synchronously (no await needed) then `await getHiddenIds()` for the hidden slice.
- **`src/ui/state/identities-store.enrichment.test.ts`** (modified) — appended 5 SEL-92-* tests + updated user-preferences-api mock (dropped `getPinnedIds`).
- **`src/ui/state/conversation-store.test.ts`** (modified) — dropped `getPinnedIds` mock; updated tests 30j/30k/30p to expect the new signature; appended STORE-92-01..04 tests locking identityHosts derivation + H2 relay-room-skip regression trap.
- **`src/ui/state/conversation-store.cache.test.ts`** (modified) — dropped `getPinnedIds` mock (mock-hygiene).
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`** (modified) — dropped `getPinnedIds` mock; added `deriveDiskPinnedIds` + `buildIdentityHostsFromFleet` spies to identities-store mock; added `getFleetSessionsSnapshot` to conversation-store mock; rewrote Test 21 + Test 22 for the new hydrate path; added PANEL-92-03 (hidden hydrate unchanged trap) + PANEL-92-04 (H2 build→derive→hydrate lock).
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx`** (modified) — sibling mock updates (mock-hygiene: deriveDiskPinnedIds + buildIdentityHostsFromFleet + getFleetSessionsSnapshot + removed getPinnedIds).
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx`** (modified) — sibling mock updates.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx`** (modified) — sibling mock updates.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx`** (modified) — sibling mock updates.
- **`src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx`** (modified) — sibling mock updates + removed the getPinnedIds/getHiddenIds mock from the user-management-api mock block (was orphaned there).

## Decisions Made

- **deriveDiskPinnedIds lives on identities-store, not a new module.** Colocating with buildIdentityHostsFromFleet keeps the H2 lock visually enforced. A future reader landing on this file sees both exports adjacent and understands they're the paired read+write helpers for the fleet-sessions → identity-space projection. Splitting them across modules would let a future refactorer forget one exists.

- **Identity.pinned is `pinned?: boolean` (optional), not `pinned: boolean` (required).** Rationale: (a) preserves backward compat with the ~15 `makeIdentity()` fixture builders scattered across the frontend test suite that never cared about pin state; (b) matches Plan 92-02's backend contract where `publicIdentity`'s sixth arg defaults to false; (c) fail-closed at both boundaries — a caller who forgets to set the field sees `undefined`, which `identity.pinned !== true` treats as false, which is the intended safe-default.

- **Panel hydrate effect projection is synchronous, hidden fetch is async.** The pinned-side projection reads module-scoped state.identities from identities-store synchronously — no await needed. The hidden slice still needs an async fetch. Rather than wrap both in `Promise.allSettled` (which forced an unnecessary microtask for the sync path), the effect body runs the projection first (immediate) then awaits `getHiddenIds()`. Cancel-token guards both dispatches.

- **Retired getPinnedIds entirely — no compat shim.** A compat shim that `throw new Error("...")` would surface as an uncaught rejection in the console noise floor (bad diagnostic). A hard-remove surfaces as `undefined is not a function` at the exact callsite line (good diagnostic). All 6 test files that mocked `getPinnedIds` had the mock line removed simultaneously in the same commit that deleted the export — no phase mismatch window.

- **STORE-92-04 seeds a FleetSession with `sessionName===undefined` to exercise the H2 anti-pattern crash surface directly.** The plan's `<action>` explicitly named this. The test file uses `as unknown as FleetSession` to satisfy the discriminated-union type gate for the relay-room-shape fixture (relay-room sessions carry `kind: "relay-room"`, no `hostId`/`hostName`/`sessionName`). Any future refactorer who tries to inline `session.sessionName.toLowerCase()` in the pin path will crash this test on the relay-room entry.

- **Panel Test 21 + Test 22 REWRITTEN (not deleted).** Both tests carried valuable load-order + hydratedRef-dedupe invariants that are unchanged by Phase 92 — only the internal projection wiring shifted. Rather than delete + re-author, I edited them to swap the getPinnedIds mock spy for the deriveDiskPinnedIds mock spy while preserving the fleetSessionsLoaded gate + hydratedRef re-render count assertions.

- **`getFleetSessionsSnapshot` added to the panel's conversation-store imports (not a new hook).** The hydrate effect fires once per fleet-loaded flip; the fleet snapshot doesn't need to trigger the effect body's re-run beyond the initial flip (fleetSessionsLoaded already does that). A hook `useFleetSessions()` would over-subscribe and cause unnecessary re-renders of the entire panel. The imperative snapshot getter matches the identities-store's own consumption pattern (identities-store.ts:126 uses `getFleetSessionsSnapshot()` inside its fetch loop).

## Deviations from Plan

### None (Rule 1/2/3 clean)

No auto-fix deviations were needed. The plan's `<action>` sections mapped cleanly onto the implementation. One flow adjustment worth noting (not a deviation, just an ordering decision within TDD-mode's RED→GREEN structure):

**Task 2 RED lifted mock updates for 6 sibling test files into the same commit as the core RED tests.** The plan's action for Task 2 named the sibling files (`PrettyConversationsPanel.relay-room.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`, etc.) as "unregressed" — but the panel imports `deriveDiskPinnedIds` + `buildIdentityHostsFromFleet` at module load, so any panel test file that mocks identities-store without those exports crashes on render. Consolidating the sibling mock updates into the RED commit was the pragmatic ordering to keep the working tree in a coherent test-passable state at every commit boundary.

**Existing tests 30j/30k/30p updated in-place rather than retired.** The plan's `<action>` said "Update the mocked putPinnedIds signature at L10, L136, L2036, L2057, L2077 areas to expect two args." I updated the actual assertion (`toHaveBeenCalledWith(..., {})` instead of `toHaveBeenCalledWith(...)`) with a Phase 92 explainer comment inline. Tests 30l/30m/30n/30o are untouched (they don't assert the putPinnedIds signature — they assert other invariants).

## Threat Flags

None. The frontend attack surface is UNCHANGED by this plan:
- Same JWT-authed PUT /user-preferences endpoint. Same axios auth path.
- Same fire-and-forget silent-catch on the pin write. Failure UX identical.
- Same fleet-loaded gate + hydratedRef dedupe protecting against pin-write-then-scrub race conditions from the initial-fetch-then-fleet-arrival ordering (quick-260727-kbw).
- Client-forged identityHosts values in the PUT body carry no new authority — the backend re-resolves each hostId via `resolveHostById(hostId, userId)` (Plan 92-02 Task 2), which enforces user-scoped access checks. A client forging a hostId they don't own gets a 403/404 at resolveHostById, no sentinel written.
- T-92-04-05 (H2 identityHosts drift): mitigated by STORE-92-04 + PANEL-92-04 + SEL-92-04 regression traps + grep-hygiene absence of `deriveIdentityHostsMap` and `sessionName.toLowerCase` in the pin path.

## Issues Encountered

None — no blockers, no auth gates, no architectural surprises. The plan's `<action>` sections gave a precise implementation blueprint; execution followed it directly.

**One pre-existing test failure logged to deferred-items.md:**
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx > Test 4 (menu order)` — confirmed pre-existing via `git stash` verification (fails identically on the pre-Plan-92-04 codebase with the same `expected -1 to be greater than 1` shape). This is a Phase 91 menu-order regression that's been red on this branch; belongs to the header three-dot menu's maintainer, not Phase 92 scope.

**Circular import between conversation-store and identities-store:** flagged during implementation; resolved via ES module's late-bound function references. `import { buildIdentityHostsFromFleet } from "./identities-store"` in conversation-store.ts pairs with `import { getFleetSessionsSnapshot, subscribeConversationStore, type FleetSession } from "./conversation-store"` in identities-store.ts. Verified GREEN across all 114 conversation-store tests + all 12 identities-store.enrichment tests + all 4 user-preferences-api tests. No workaround needed.

## User Setup Required

None — pure frontend refactor. No new dependencies, no new env vars, no external service configuration, no nginx changes (routes unchanged). Existing pin sentinel files on disk (touched manually per D-07/D-08 by each box's maintainer) render as pinned rows via the new projection path automatically on next panel mount.

## End-to-End UAT Expectation (post-deploy)

- Right-click Pin on a conversation → sentinel file appears at `~/.claude/identities/<name>/.pinned` on the target host (verified via SSH `ls`).
- Reload the panel → the row still shows pinned (disk-authoritative read at hydrate time).
- Right-click Unpin → file removed (`ls` shows absence).
- Reload → row no longer pinned.
- All UI feel identical to pre-Phase-92 (D-06).
- With an active relay-room in state.fleetSessions, pinning a harness row does NOT throw and produces an identityHosts map that omits the relay-room entry (STORE-92-04 empirical validation).

## Next Phase Readiness

- **Phase 92 is COMPLETE.** All four plans shipped:
  - Plan 92-01: per-identity-file primitive (writeIdentityFile / removeIdentityFile / identityFileExists with H1 write⇔read regex parity lock).
  - Plan 92-02: publicIdentity read path + PUT /user-preferences fanout write path.
  - Plan 92-03: DB pin column dropped physically.
  - Plan 92-04 (this one): frontend rewired to disk-projection reads + identityHosts-carrying writes.

- **Manual per-box migration is orchestrator-owned:** Per D-07 / D-08, each box maintainer (Ashley for t1000, Stacy for T800) runs the pre-deploy `touch ~/.claude/identities/<name>/.pinned` sequence before their container recreate for each identity currently in their pinnedConversationIds list. The DB column is already physically dropped (Plan 92-03), so post-deploy the pin state reads exclusively from disk.

- **id-skill-revamp campaign context:** This phase completes Shape 1 of 4. Shape 2 (agent-supervisor archive extension) can now assume the sentinel-per-identity-folder convention is production-live. Shapes 3/4 (on-disk tree consolidation, substrate prose polish) remain future phase work.

## Self-Check: PASSED

- Created files (verified at git-diff level):
  - `src/ui/api/user-preferences-api.test.ts` — FOUND (4 API-92-* tests, all pass).
- Modified files (all touched at git-diff level):
  - `src/ui/api/user-preferences-api.ts` — verified getPinnedIds removed + putPinnedIds signature widened.
  - `src/ui/api/identities-api.ts` — verified Identity.pinned optional field added.
  - `src/ui/state/identities-store.ts` — verified deriveDiskPinnedIds export added + buildIdentityHostsFromFleet unchanged.
  - `src/ui/state/conversation-store.ts` — verified buildIdentityHostsFromFleet import + pin/unpinConversation callsites pass identityHosts.
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — verified hydrate effect rewired + getPinnedIds import removed + getFleetSessionsSnapshot import added.
  - All 6 sibling test files with mock updates — verified.
- Commits (all short hashes exist on `feat/tab-title-from-tmux`):
  - `4e16f64e` — FOUND (Task 1 RED)
  - `ad0d4b8a` — FOUND (Task 1 GREEN)
  - `304c4268` — FOUND (Task 2 RED)
  - `75eccd13` — FOUND (Task 2 GREEN)
- Scoped-test result: 284/285 in-scope tests green across 10 test files. 1 pre-existing failure (menu order) logged to deferred-items.md.
- Grep-hygiene:
  - `getPinnedIds` remaining refs in `src/ui/` (non-test): all comments referencing the retirement OR the internal `getPinnedIdsSnapshot` (usePinnedIds snapshot accessor — unrelated). 0 actual callsites.
  - `deriveIdentityHostsMap` in `src/ui/`: 0 hits (H2 forbidden helper name absent). ✓
  - `sessionName.toLowerCase` in `src/ui/state/conversation-store.ts`: 2 hits, both in anti-pattern warning comments (0 code hits). ✓
  - `buildIdentityHostsFromFleet` in `src/ui/state/conversation-store.ts`: 5 refs (import + 2 callsites + 2 comments). ✓
  - `buildIdentityHostsFromFleet` in `PrettyConversationsPanel.tsx`: 4 refs (import + hydrate-effect callsite + 2 comments). ✓
  - `deriveDiskPinnedIds` in `PrettyConversationsPanel.tsx`: 5 refs (import + hydrate-effect callsite + 3 comments). ✓
  - `deriveDiskPinnedIds` in `src/ui/state/identities-store.ts`: 3 refs (export + 2 docblock references). ✓

---

*Phase: 92-pin-sentinel-migration*
*Completed: 2026-09-09*
