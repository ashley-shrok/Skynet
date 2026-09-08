---
phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session
plan: 01
subsystem: frontend
tags:
  [
    types,
    discriminator,
    session-list,
    tab-model,
    foundation,
    slice-d,
    kind-marker,
    cache-bump,
    wave-1,
    tdd,
  ]

# Dependency graph
requires:
  - phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
    provides: /sessions/list backend returns discriminated union HarnessSessionRow | RelayRoomSessionRow with `kind: "harness" | "relay-room"` marker (Plan 89-04 wire-protocol lock)
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-00
    provides: Wave 0 fleet-status contextPct hook + agent-reset endpoint (unblocks Plan 05/06 badge appendage — no dependency ON Wave 0 for the type widening itself but Plan 01 lands ON TOP of Wave 0 commits)
provides:
  - RemoteTmuxSession widened with optional `kind` discriminator + relay identity fields (id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt)
  - FleetSession widened with optional `kind` + `roomId` + `roomTitle`
  - Tab widened with optional `sessionKind` + `relayRoomId` + `relayRoomTitle`
  - FLEET_CACHE_KEY bumped v3 → v4 (invalidates pre-Phase-90 caches cleanly on first mount)
  - isFleetSession predicate accepts new fields defensively (rejects bad kind literals + non-string roomId + non-string/non-null roomTitle)
  - readFleetSessionsCache/writeFleetSessionsCache round-trip preserves the three new fields
affects:
  [
    Phase-90-Plan-02 (shared primitives can now consume `kind` at tab-open sites),
    Phase-90-Plan-03 (backend Matrix primitives — informed by frontend shape but no direct code dependency),
    Phase-90-Plan-04 (WS server — informed by shape),
    Phase-90-Plan-05 (context meter appendage — receives sessionKind on Tab),
    Phase-90-Plan-06 (badge appendage — receives sessionKind on Tab),
    Phase-90-Plan-07 (pane-mount dispatcher in tabUtils.tsx will branch on `tab.sessionKind === "relay-room"`),
    Any future consumer of /sessions/list that needs to distinguish harness vs relay-room rows,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flat-optional widening over discriminated-union refactor: keeps ~10 existing call sites (AppShell.tsx, CommandPalette.tsx) working without narrow branches; downstream consumers switch on `kind ?? \"harness\"` for backward-compat"
    - "Cache-version bump (v3→v4) as the sole rehydrate-invalidation mechanism — no runtime data migration (mirrors Phase 44 v1→v2 and Phase 47 v2→v3 pattern)"
    - "Undefined-vs-explicit distinction preserved for `kind` and `roomId` at reader boundary — load-bearing for backward-compat semantics (`kind === undefined` means 'unknown, assume harness'; `kind === \"harness\"` means 'definitely harness')"
    - "roomTitle uses same `?? null` coerce pattern as lastMessageAt + aiTitle (Matrix wire has explicit `null` for 'no title set' — consumers should never see undefined after a round-trip)"
    - "Field-name discrimination: `sessionKind` on Tab (not `kind`) to disambiguate from existing `Tab.type` dispatch axis"

key-files:
  created:
    - src/ui/api/sessions-api.test.ts
  modified:
    - src/ui/api/sessions-api.ts (RemoteTmuxSession +7 optional fields: kind, id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt)
    - src/ui/state/conversation-store.ts (FleetSession +3 optional fields; FLEET_CACHE_KEY v3→v4; isFleetSession predicate defense; readFleetSessionsCache + writeFleetSessionsCache round-trip)
    - src/ui/state/conversation-store.test.ts (+8 Phase-90 tests P/Q/R/S/T/U/V/W/X in new describe block; 3 pre-existing tests bumped v3→v4 references)
    - src/ui/state/conversation-store.cache.test.ts (CACHE_KEY bumped v3→v4; SAMPLE_A + SAMPLE_B fixtures gain kind + roomId + roomTitle; canonical-field-keys test updated for +2 keys)
    - src/types/ui-types.ts (Tab +3 optional fields: sessionKind, relayRoomId, relayRoomTitle)

key-decisions:
  - "Flat-optional widening over discriminated-union refactor — planner discretion per PLAN.md `<action>` guidance; keeps call-site diff surgical and pre-Phase-89 rehydrated caches typecheck valid"
  - "FLEET_CACHE_KEY bumped v3 → v4 — clean cold-start after deploy trades ~200ms empty-sidebar paint for correct pane routing on first click; same rationale as Phase 44 v1→v2 and Phase 47 v2→v3"
  - "Tab field named `sessionKind` (not `kind`) — disambiguates from existing Tab.type dispatch axis; per PLAN.md planner-discretion clause"
  - "Undefined-vs-explicit `kind` distinction preserved at reader boundary — reader does NOT synthesize `\"harness\"` default (that's the CONSUMER's job per PATTERNS.md backward-compat rule); preserves forensic signal for future 'unknown kind' rows"
  - "isFleetSession predicate hardened defensively: rejects `kind: \"banana\"` (arbitrary strings) + rejects non-string `roomId` + rejects non-string/non-null `roomTitle` — corrupt cache entries could route rows through wrong pane orchestrator downstream"
  - "SAMPLE_A / SAMPLE_B cache-test fixtures updated to include the new fields (harness kind on A, relay-room kind + full relay axis on B) — matches the pattern from Phase 44 and Phase 47 fixture updates"

patterns-established:
  - "Fifth iteration of frontend FleetSession additive-optional widening: v1 base → v2 lastMessageAt (Phase 44) → v3 aiTitle (Phase 47) → v4 kind + roomId + roomTitle (Phase 90). Each iteration preserves the pattern: (a) optional field on type, (b) predicate accepts old absent/new present, (c) reader coerces undefined → null on nullable fields, (d) writer persists new fields, (e) cache key bumped so v(N-1) rehydrate is discarded"
  - "Downstream Tab-model widening pattern: new optional fields flow from row (FleetSession) → tab-open handler (Plan 07 territory) → Tab type (sessionKind + relayRoomId + relayRoomTitle) — pattern for future Tab-shape extensions is the same three-hop widening"
  - "RED/GREEN TDD cycle for pure type widening: write failing test file (fails at `tsc -p tsconfig.app.json --noEmit`, passes at runtime under permissive config) → commit as test(...) RED → implement widening → commit as feat(...) GREEN. tsc-strict-app-config is the enforceable RED signal for type-only work"

requirements-completed:
  [
    D-01-scope-anchor,
    D-15-kind-discriminator-consumption,
  ]

# Metrics
duration: 14 min
completed: 2026-09-08
---

# Phase 90 Plan 01: Widen frontend types with Phase-89 kind discriminator + relay-room identity fields

**RemoteTmuxSession + FleetSession + Tab now carry the Phase-89 `kind` marker plus the relay-room identity axis (roomId + roomTitle) end-to-end from /sessions/list down to the tab that hosts the pane; FLEET_CACHE_KEY bumped v3 → v4 so pre-Phase-90 rehydrated caches are discarded cleanly rather than misrouting relay-room rows through the harness pane orchestrator.**

## Performance

- **Duration:** ~14 minutes (RED committed 20:16:xxZ; GREEN committed 20:26:xxZ)
- **Started:** 2026-09-08T20:12:00Z (plan-loaded)
- **Completed:** 2026-09-08T20:26:00Z (final task committed)
- **Tasks:** 1 of 1 executed
- **Files modified:** 5 (1 created + 4 modified — all frontend, all under `src/ui/` + `src/types/`)

## Accomplishments

- **RemoteTmuxSession now carries the Phase-89 wire contract.** `src/ui/api/sessions-api.ts` widened with seven optional fields — `kind: "harness" | "relay-room"`, plus the relay-room identity axis (`id`, `roomId`, `roomTitle`, `lastActivityAt`, `createdAt`, `updatedAt`). Flat-optional widening (not discriminated-union refactor) keeps the ~10 existing call sites in AppShell.tsx + CommandPalette.tsx working without narrow branches. Consumers reading `kind` treat `undefined` as `"harness"` (backward-compat rule for pre-Phase-89 rehydrated caches).

- **FleetSession row-shape mirror updated.** `src/ui/state/conversation-store.ts` widened FleetSession with the three fields that need to flow from row to tab (kind + roomId + roomTitle — the other four Phase-89 fields are consumed at the API boundary and don't need to persist in the sidebar row model). `isFleetSession` predicate hardened to reject invalid `kind` literals (e.g. `"banana"`), non-string `roomId` (e.g. `42`), and non-string-non-null `roomTitle`. `readFleetSessionsCache`/`writeFleetSessionsCache` round-trip preserves the three fields verbatim; `roomTitle` uses the same `?? null` coerce as lastMessageAt + aiTitle; `kind` and `roomId` preserve their undefined-vs-explicit distinction (load-bearing for backward-compat semantics).

- **FLEET_CACHE_KEY bumped v3 → v4.** Fifth iteration of the additive-optional cache-key sequence (v1 base → v2 lastMessageAt Phase 44 → v3 aiTitle Phase 47 → v4 kind+roomId+roomTitle Phase 90). Rationale: v3 rehydrate on a Phase-90 client would seed FleetSession objects lacking the relay identity axis — while consumers treat `kind === undefined` as harness (backward-compat), the CORRECT interpretation of a v3 cache is "we don't know which kind — force a re-fetch". A cached row that IS a relay-room but rehydrates as harness would route through the wrong pane on click (PrettyView won't find a matching tmux session → PrettyView error state). Trades ~200ms empty-sidebar paint for correct pane routing on first click. Documented via extensive JSDoc at the FLEET_CACHE_KEY const site.

- **Tab widened with sessionKind + relay identity axis.** `src/types/ui-types.ts` widened with `sessionKind?: "harness" | "relay-room"`, `relayRoomId?: string`, `relayRoomTitle?: string | null`. Field name is `sessionKind` (not `kind`) to disambiguate from the existing `Tab.type` dispatch axis (`"dashboard" | "terminal" | "rdp" | "vnc" | "telnet"`) — a bare `kind` next to `type` would read ambiguously. Plan 07's pane-mount dispatcher (tabUtils.tsx) will branch on `tab.sessionKind === "relay-room"` to route to RelayRoomSessionPane; that dispatcher does not exist yet — Plan 07 territory.

- **8 new tests + 3 pre-existing tests bumped.** New describe block `conversation-store (Phase 90 Plan 01)` in `conversation-store.test.ts` covers tests P/Q/R/S/T/U/V/W/X: type-level acceptance for the three new fields, round-trip preservation (both harness and relay-room in one merged list), undefined-vs-explicit kind distinction, defensive rejection of bad `kind` literal + bad `roomId` type, cache-key bump verification (v4 written, v3 not), prior-version cache invalidation (v3 entry → reader returns []), end-to-end relay-room integration (round-trip a relay-room session, confirm it's still identified as relay-room on rehydrate). New `sessions-api.test.ts` file with 5 tests covering the widened RemoteTmuxSession shape. 3 pre-existing tests in `conversation-store.test.ts` + 1 in `conversation-store.cache.test.ts` had their hardcoded `v3` references bumped to `v4` (same mechanical pattern Phase 47 used when it bumped v2→v3).

- **SAMPLE_A / SAMPLE_B cache-test fixtures updated.** `conversation-store.cache.test.ts` fixtures gain the new fields to exercise both branches of the widening: SAMPLE_A carries `kind: "harness"` + `roomTitle: null` (harness row); SAMPLE_B carries `kind: "relay-room"` + `roomId: "!room:matrix.example"` + `roomTitle: "Working session"` (relay-room row). Canonical-field-keys test updated to expect the two new keys in alphabetical order (kind + roomTitle join the set — roomId is undefined on SAMPLE_A so JSON.stringify drops it, correct steady-state for a harness row).

## Task Commits

Each phase of the TDD cycle was committed atomically:

1. **RED (Task 1 test): sessions-api type-widening tests** — `5cdce36e` (test)
2. **GREEN (Task 1 implementation): widen RemoteTmuxSession + FleetSession + Tab** — `559be6c9` (feat)

## Files Created/Modified

**Created (1):**

- `src/ui/api/sessions-api.test.ts` — 5 Phase-90 tests covering harness-with-explicit-kind acceptance, relay-room shape acceptance, backward-compat with kind absent, merged /sessions/list round-trip, kind-is-optional-at-type-level

**Modified (5):**

- `src/ui/api/sessions-api.ts` — RemoteTmuxSession + 7 optional fields (kind, id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt) with load-bearing JSDoc explaining flat-optional-vs-discriminated-union choice and backward-compat rule
- `src/ui/state/conversation-store.ts` — FleetSession + 3 optional fields (kind, roomId, roomTitle); FLEET_CACHE_KEY v3 → v4 with 15-line rationale comment; isFleetSession predicate hardened for the three new fields; readFleetSessionsCache/writeFleetSessionsCache round-trip the three new fields
- `src/ui/state/conversation-store.test.ts` — 8 new Phase-90 tests (P/Q/R/S/T/U/V/W/X); 3 pre-existing tests updated for v4 (Phase 44 Test E/F + FLEET_CACHE_KEY const at L1014 in removeFleetSession describe block); Phase 47 test block also bumped
- `src/ui/state/conversation-store.cache.test.ts` — CACHE_KEY bumped v4; SAMPLE_A + SAMPLE_B fixtures gain kind + relay fields; canonical-field-keys test expects +2 keys
- `src/types/ui-types.ts` — Tab + 3 optional fields (sessionKind, relayRoomId, relayRoomTitle) with JSDoc explaining sessionKind-vs-kind naming choice

## Decisions Made

All 6 key decisions captured in the frontmatter `key-decisions` field. The two most consequential:

1. **Flat-optional widening over discriminated-union refactor** — planner's discretion per PLAN.md `<action>` guidance ("a discriminated-union refactor is optional and only if it does not cascade into >5 call-site edits; if it does, keep the flat-optional shape"). Grep verified 3 existing call sites (AppShell.tsx L745, CommandPalette.tsx L47/L137) plus the state-layer FleetSession mirror. A full discriminated-union refactor would have forced every one of them to add a `kind` narrow branch. Flat-optional is the strictly smaller diff.

2. **FLEET_CACHE_KEY v3 → v4 with clean-cold-start over migration** — Sequence-preserving decision. Phase 44 and Phase 47 both chose bump-over-migration for the same reason: runtime migration code introduces its own bug surface (per-shape adapter logic, upgrade-path testing, downgrade-path handling), while a clean bump is provably zero-behavior: the reader simply returns `[]` when it encounters a v3 key, downstream code treats an empty cache identically to a cold start (existing behavior), the fresh `/sessions/list` fetch populates the v4 key. Trade-off: ~200ms of empty-sidebar paint on first load post-deploy vs. any risk of misrouting a relay-room row through PrettyView.

## Deviations from Plan

**None** — plan executed exactly as written.

The plan called for a single TDD task widening three type surfaces; that's exactly what shipped. No auth gates encountered. No checkpoints. No architectural changes needed. Rule 1/2/3 auto-fixes NOT invoked.

Minor note: existing tests in `conversation-store.test.ts` + `conversation-store.cache.test.ts` had hardcoded `v3` references that mechanically needed to be bumped to `v4` when I bumped the constant. This is a routine mechanical change that Phase 47 also had to do when it bumped v2→v3 (visible in the Phase 47 test-file diff, preserved in comments in this file). Not counted as a deviation — it's part of the widening's own scope (the plan's `<action>` explicitly says "Bump the localStorage cache-version constant" which implies updating any test that pinned the old constant).

## Issues Encountered

- **Pre-existing frontend TypeScript errors** in `conversation-store.test.ts` (~20 instances of `role: missing`), `AppShell.persistence.test.tsx`, `identities-api.test.ts`, several other files. All PRE-EXISTING (verified against `git show HEAD~1`). Out of scope per SCOPE BOUNDARY rule. My own touched files (sessions-api.ts, conversation-store.ts, ui-types.ts) plus my authored test sections emit ZERO tsc errors. Full list logged in `.planning/phases/90-.../deferred-items.md` under "Plan 90-01 — Pre-existing Frontend TS Errors (out of scope)".

- **Runtime `vitest` initially passed before the widening landed**, which is expected — tsc-strict-app-config (`tsconfig.app.json`) is the enforceable RED gate for type-only work, not runtime. Test-runner tsx-compilation strips excess-property checks under this project's permissive config. Documented in the RED commit message so future maintainers understand the RED signal was at the tsc level, not the vitest level.

## User Setup Required

None. Pure code + type changes. No external service configuration. No env var changes. No infrastructure touches. Ship-time: users' pre-Phase-90 localStorage caches will be silently discarded on first mount (~200ms empty-sidebar paint), then repopulated from the fresh /sessions/list — same UX as prior cache-key bumps.

## Next Phase Readiness

- **Plan 90-02 unblocked:** shared primitives (OutboundBubble, ComposeBoxShell) can now be authored knowing they'll be consumed under a `sessionKind === "relay-room"` branch — no scavenger hunt for the discriminator shape.
- **Plan 90-03 unblocked:** backend Matrix primitives (getRoomMessages, sendMessageAsUser in matrix-admin-client.ts) can proceed in parallel — informed by but not gated on the frontend type widening.
- **Plan 90-04 unblocked:** WS server (relay-room-stream-server.ts) can proceed in parallel — same shape parity story.
- **Plan 90-05 / 90-06 unblocked:** context meter appendage + badge appendage receive `sessionKind` on Tab at mount time (via Plan 07's dispatcher when it lands).
- **Plan 90-07 unblocked:** the pane-mount dispatcher in tabUtils.tsx now has the type surface it needs to branch on `tab.sessionKind === "relay-room"` → RelayRoomSessionPane. The tab-open handler (in Plan 07 territory) will propagate `kind` / `roomId` / `roomTitle` from FleetSession → Tab.

## Self-Check: PASSED

Verified all claims before proceeding to state updates:

- `src/ui/api/sessions-api.test.ts` exists ✓
- `git log --oneline` shows `5cdce36e` (RED) and `559be6c9` (GREEN) ✓
- Grep gates: `kind?: "harness" | "relay-room"` present in both sessions-api.ts (L41) and conversation-store.ts (L183) ✓
- Grep gate: `sessionKind?: ` exactly one match in ui-types.ts (L228) ✓
- Grep gate: `relayRoomId?: string` exactly one match in ui-types.ts (L229) ✓
- Grep gate: FLEET_CACHE_KEY = "skynet:convo-fleet-cache:v4" (bumped one from v3) ✓
- `npx vitest run src/ui/api/sessions-api.test.ts` → 5 passed ✓
- `npx vitest run src/ui/state/conversation-store.test.ts` → 110 passed (was 102 pre-plan — 8 net new, 0 regressions) ✓
- `npx vitest run src/ui/state/conversation-store.cache.test.ts` → 9 passed ✓
- `npx vitest run src/ui/AppShell.persistence.test.tsx` → 5 passed (indirect user, no regression) ✓
- No file under `src/ui/features/pretty-view/` modified ✓
- No file under `src/backend/` modified ✓
- `git diff --stat HEAD~2..HEAD` limited to expected files (sessions-api.ts, conversation-store.ts, conversation-store.test.ts, conversation-store.cache.test.ts, ui-types.ts, sessions-api.test.ts) ✓

---
*Phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session*
*Plan: 01*
*Completed: 2026-09-08*
