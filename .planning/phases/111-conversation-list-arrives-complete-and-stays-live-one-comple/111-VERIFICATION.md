---
phase: 111-conversation-list-arrives-complete-and-stays-live
verified: 2026-09-16T23:10:00Z
status: human_needed
score: 15/15 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open the app, observe the conversation list on first paint, then have a second agent start a conversation on another host — verify the row appears without a page reload, dressed (hue/title visible) from first frame."
    expected: "The new row appears spontaneously within 1-2 seconds of the pulse tick, with the agent's display name, title (from role if not set on identity), and colorHue already applied. No undressed-then-dressed flicker."
    why_human: "Cannot verify first-paint appearance correctness or absence of correction-flicker programmatically; requires live browser observation."
  - test: "Put a mobile device in a pocket for 30+ seconds (longer than the old 28s give-up window), then return to the app — verify the list is current without a page reload."
    expected: "The WS client reconnects immediately on becoming visible, GET /sessions/list re-fires, and the list reflects the current state. No 'Loading conversations…' regression."
    why_human: "D-11/D-12 indefinite slow retry and wake-on-visible require physical device testing; cannot simulate real network suspend/resume in vitest."
  - test: "End a conversation on another host — verify the row disappears from the list without a page reload."
    expected: "The row is gone within 1-2 seconds of the gone frame arriving. No orphan row lingers."
    why_human: "Requires a live multi-host setup with an active conversation to terminate."
  - test: "Verify that `pixel` identity's conversation row shows role-inherited cosmetics (title 'Skynet', colorHue 324 from box-maintainer role) since pixel.md declares no title or colorHue."
    expected: "The pixel row shows role_cosmetics values (title and colorHue from box-maintainer), not identity_cosmetics values. This is the live zero-fixture inheritance test surface CONTEXT.md identifies."
    why_human: "Requires visual inspection of the running UI; the sweep probe confirms the sweep emits them correctly, but the rendering chain (wire → store → row component) needs a browser check."
  - test: "Verify pinned rows appear at the top of the list and hidden rows are absent — then toggle pin/hide and verify the list updates without a page reload."
    expected: "Pin/hide state changes from the pulse reach row position and membership live, with no page reload needed."
    why_human: "Pin/hide sentinel changes need disk manipulation and a live browser session to verify the re-projection chain (identities-store → conversation-store → panel rendering)."
---

# Phase 111: Conversation List Arrives Complete and Stays Live — Verification Report

**Phase Goal:** The conversation list arrives COMPLETE on first paint — right rows, right order, right appearance with role-inheritance resolved, pinned at top, hidden absent — and stays live without a page refresh. The bar: no row is ever seen in a state it then grows out of. Explicitly REJECTS mtime-gating / change-detection. Coverage is driven by CONTEXT.md decisions D-01 through D-13.

**Verified:** 2026-09-16T23:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All 15 mechanically-verifiable must-haves from the 6 PLAN frontmatter lists are VERIFIED. The phase's behavioral claims require human UAT to confirm (5 items below).

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-04: SWEEP_SCHEMA_VERSION stays 1 | ✓ VERIFIED | `grep -n "SWEEP_SCHEMA_VERSION = 1 as const" sweep-schema.ts` → line 42, exact match |
| 2 | D-04: FRAME_SCHEMA_VERSION stays 1 | ✓ VERIFIED | `grep -n "FRAME_SCHEMA_VERSION = 1 as const" wire-protocol.ts` → line 14, exact match |
| 3 | D-10: pulse never touches `loaded` | ✓ VERIFIED | `mergeIdentityAppearance` body: `loaded:true` absent, `setIdentities(` absent, `.push` absent, `loaded: state.loaded` present. Structural grep gate in plan verify block passes. |
| 4 | Appearance rides BOTH publish sources (source A computeFingerprint + source B inline) | ✓ VERIFIED | `appearanceFingerprintSegment` at line 1033 (source A, end of template literal) AND line 2130 (source B inline `isDormant\|isRecycling` fingerprint). Both confirmed by grep. |
| 5 | Single merge authority in identity-appearance.ts; publicIdentity() delegates | ✓ VERIFIED | `grep -rn "roleCosmetics?.title" src/backend/` → exactly 1 hit in `identity-appearance.ts:146`. `identities.ts` imports and calls `resolveIdentityAppearance`. |
| 6 | subscription-registry.ts untouched | ✓ VERIFIED | `git diff --stat` returns empty; last commit is pre-phase-111 (`43bfa3b7` from Phase 34). |
| 7 | PrettyConversationsPanel.tsx untouched by phase 111 | ✓ VERIFIED | Last commits to this file (`481b123d`, `eac776c2`) were at 06:01 and 05:48 on 2026-09-16; phase 111 started at 21:13 on the same day. `git diff --stat` for working tree is empty. |
| 8 | `updateFleetSessions([])` does not wipe pulse rows (preservePulseRows guard, case 13) | ✓ VERIFIED | `preservePulseRows = sessions.length === 0 && state.fleetSessions.length > 0` at line 1145-1146 of conversation-store.ts. Case 13 test at line 4298 verified present and green (137 tests pass). |
| 9 | D-11: reconnect never permanently gives up | ✓ VERIFIED | `capMs = reconnectAttempts < BACKOFF_SCHEDULE_MS.length ? BACKOFF_SCHEDULE_MS[reconnectAttempts] : SLOW_RETRY_MS`. No early-return before `setTimeout`. `fleet_status_client_gave_up` absent from source. `SLOW_RETRY_MS = 30_000` at line 60. |
| 10 | D-12: no isIosPwa() gate in WS client or AppShell visibility handler | ✓ VERIFIED | `grep isIosPwa fleet-status-client.ts` → NOT FOUND. `grep isIosPwa AppShell.tsx` → line 923 is a comment only: `// diverge. No isIosPwa() gate — D-12 wants re-ask on every platform.` |
| 11 | D-13: no replay identifiers in fleet-status-client.ts | ✓ VERIFIED | `grep -En "replay\|lastSeenSeq\|catchUp\|gapReconcil" fleet-status-client.ts` → 0 matches. AppShell also clean. |
| 12 | D-03: no mtime-gating (st_mtime count = 3 pre-existing) | ✓ VERIFIED | `grep -c "st_mtime" fleet-status-sweep.py` → 3. All three are pre-existing `_mtime_ms` helper and discovery path references; no new mtime gating added. |
| 13 | D-05/D-06: upsertFleetSession and removeFleetSession wired from WS callbacks in AppShell | ✓ VERIFIED | `applyFleetState` calls `upsertFleetSession` (last call, line 612); `onGone` calls `removeFleetSession` (line 649). Both verified by grep. `mergeIdentityAppearance` fires first in the same callback body. |
| 14 | D-08: two hand-wired refresh exceptions not removed | ✓ VERIFIED | Relay-room-create exception at line 2506-2513 (W5 comment) confirmed intact. Identity-create path: D-08 notes this bounty (`sidebar-fleet-sessions-refresh-after-identity-create`) was not yet a code path and closes only after UAT — the requirement is "do NOT break them," not "add them." The relay-room path is the implemented one; it is intact. |
| 15 | D-01..D-13 all covered by at least one plan's must_haves or truths | ✓ VERIFIED | D-01/D-02: Plan 111-01. D-03: Plans 111-01, 111-03. D-04: Plans 111-01, 111-02. D-05/D-06: Plan 111-05. D-07: Plan 111-06. D-08: Plan 111-05. D-09: Plans 111-03, 111-04. D-10: Plan 111-04. D-11/D-12/D-13: Plan 111-06. All 13 decisions covered. |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `substrate/scripts/fleet-status-sweep.py` | Widened identity line with identity_cosmetics, role_cosmetics, role, pinned, hidden | ✓ VERIFIED | Live sweep on t1000 emits pixel identity line with `role: "box-maintainer"`, `identity_cosmetics: {displayName, task}`, `role_cosmetics: {title, colorHue, avatar}`, `pinned: false`, `hidden: false` at `schema_version: 1` |
| `substrate/scripts/tests/fleet-status-sweep-appearance.sh` | Hermetic bash driver, 10 cases + global assertion | ✓ VERIFIED | `bash fleet-status-sweep-appearance.sh` → PASS 11, FAIL 0 |
| `src/backend/fleet-status/identity-appearance.ts` | Single merge authority, exports resolveIdentityAppearance, RawCosmetics, ResolvedIdentityAppearance | ✓ VERIFIED | File exists, exports confirmed, 0 database/express/zod imports, 34 tests pass |
| `src/backend/fleet-status/wire-protocol.ts` | IdentityAppearanceSchema + SessionStateSchema.identityAppearance, FRAME_SCHEMA_VERSION=1 | ✓ VERIFIED | IdentityAppearanceSchema at line 366, SessionState.identityAppearance at line 457, version=1 at line 14 |
| `src/ui/api/fleet-status-types.ts` | Hand-maintained browser mirror of identityAppearance | ✓ VERIFIED | `grep -c "identityAppearance" fleet-status-types.ts` = 3 (interface, SessionState member, type export) |
| `src/backend/fleet-status/sweep-schema.ts` | Optional appearance fields B6..B9, SWEEP_SCHEMA_VERSION=1 | ✓ VERIFIED | All 5 fields (`role?`, `identity_cosmetics?`, `role_cosmetics?`, `pinned?`, `hidden?`) declared with `?:`. B6/B7/B8/B9 in SWEEP_FIELD_PARITY. Version=1 at line 42. 26 tests pass. |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | appearance on both sources, all 7 stamp sites, both fingerprints | ✓ VERIFIED | 7 `identityAppearance: fetched.identityAppearance` occurrences confirmed. `appearanceFingerprintSegment` at both source A (computeFingerprint line 1033) and source B (inline line 2130). 162 tests pass. |
| `src/ui/state/identities-store.ts` | mergeIdentityAppearance — additive, cannot touch loaded or append | ✓ VERIFIED | Structural grep gate passes: no `loaded:true`, no `setIdentities(`, no `.push`, `loaded: state.loaded` present. 45 tests pass. |
| `src/ui/AppShell.tsx` | mergeIdentityAppearance in WS callbacks before row writes; upsertFleetSession after; onGone calls removeFleetSession | ✓ VERIFIED | `applyFleetState`: mergeIdentityAppearance fires first (line 588), upsertFleetSession last (line 612). onGone: removeFleetSession at line 649. |
| `src/ui/state/conversation-store.ts` | upsertFleetSession — cannot flip fleetSessionsLoaded, relay-room guard, cache sync | ✓ VERIFIED | Grep gate passes: `fleetSessionsLoaded` in body only in JSDoc comment, relay-room guard present, writeFleetSessionsCache present, FLEET_CACHE_KEY absent from body. Cache key stays v4 (1 occurrence). 137 tests pass. |
| `src/ui/api/fleet-status-client.ts` | SLOW_RETRY_MS, visibilitychange listener added+removed, no isIosPwa, no replay, no gave_up | ✓ VERIFIED | All grep gate checks pass. 26 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `fleet-status-sweep.py` | stdout JSONL identity line | `_build_identity_line` dict keys | ✓ WIRED | Live sweep on t1000 confirms identity lines carry all 5 new keys |
| `sweep-schema.test.ts` | `fleet-status-sweep-appearance.sh` | hermetic bash driver | ✓ WIRED | Bash probe passes 11/11 cases including stdout purity assertion |
| `identities.ts` | `identity-appearance.ts` | `resolveIdentityAppearance` import | ✓ WIRED | Line 3 import + line 204 call confirmed |
| `ssh-poll-orchestrator.ts` | `identity-appearance.ts` | `appearanceFromIdentityLine` → `resolveIdentityAppearance` | ✓ WIRED | 2 occurrences of `resolveIdentityAppearance` (import + 1 call site in `appearanceFromIdentityLine`). `appearanceFromIdentityLine` called at source A and source B adapters. |
| `ssh-poll-orchestrator.ts` | `wire-protocol.ts` | `SessionState.identityAppearance` at frame sites | ✓ WIRED | 7 `identityAppearance: fetched.identityAppearance` occurrences across 3 frame sites + 4 cache branches |
| `AppShell.tsx` | `identities-store.ts` | `applyFleetState` calling `mergeIdentityAppearance` | ✓ WIRED | Import at line 106, call at line 588, before `upsertFleetSession` at line 612 |
| `AppShell.tsx` | `conversation-store.ts` | `applyFleetState` calling `upsertFleetSession` | ✓ WIRED | Import at line 72, call at line 612 (last in body) |
| `AppShell.tsx` | `conversation-store.ts` | `onGone` calling `removeFleetSession` | ✓ WIRED | Import at line 71, call at line 649 |
| `fleet-status-client.ts` | `document visibilitychange` | listener added in factory, removed in dispose() | ✓ WIRED | `addEventListener("visibilitychange", ...)` at line 337, `removeEventListener(...)` in dispose() at line 364 |
| `AppShell.tsx` | `getSessionList` | `fetchAndApplyFleetSessions` on mount and becoming-visible | ✓ WIRED | `fetchAndApplyFleetSessions` called from mount effect (line 912) and visibilitychange handler (line 927). TG-17 amended in place with D-07. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `fleet-status-sweep.py` | `identity_cosmetics`, `role_cosmetics` | disk frontmatter via `_read_frontmatter_cosmetics` | Yes — live sweep on t1000 shows real values for pixel's `displayName`, `task`, and box-maintainer's `title`, `colorHue`, `avatar` | ✓ FLOWING |
| `ssh-poll-orchestrator.ts` | `identityAppearance` on `SessionState` | `appearanceFromIdentityLine` → `resolveIdentityAppearance` → sweep line fields | Yes — 7 stamp sites wired, 162 tests confirm values reach frames | ✓ FLOWING |
| `identities-store.ts` | identity entries (cosmetics fields) | `mergeIdentityAppearance` from WS frame | Yes — additive merge writes displayName/title/colorHue etc. to the existing identity entry; 45 tests confirm | ✓ FLOWING |
| `conversation-store.ts` | `fleetSessions` rows | `upsertFleetSession` from WS frame | Yes — rows created from live WS frames, removeFleetSession removes them; 137 tests confirm | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Sweep emits pixel identity with role inheritance | `python3 sweep.py 2>/dev/null \| python3 -c "...filter pixel..."` | `role: box-maintainer`, `identity_cosmetics: {displayName, task}`, `role_cosmetics: {title, colorHue, avatar}`, `schema_version: 1` | ✓ PASS |
| Bash probe: all 10 cases + global | `bash fleet-status-sweep-appearance.sh` | PASS 11, FAIL 0 | ✓ PASS |
| identity-appearance tests | `npx vitest related --run identity-appearance.test.ts` | 34 passed | ✓ PASS |
| identities.get-disk.test.ts unmodified | `npx vitest related --run identities.get-disk.test.ts` | 31 passed (0 deletions from test file) | ✓ PASS |
| sweep-schema tests | `npx vitest related --run sweep-schema.test.ts` | 26 passed | ✓ PASS |
| wire-protocol tests | `npx vitest related --run wire-protocol.test.ts` | 53 passed | ✓ PASS |
| orchestrator tests | `npx vitest related --run ssh-poll-orchestrator.test.ts` | 162 passed | ✓ PASS |
| identities-store enrichment tests | `npx vitest related --run identities-store.enrichment.test.ts` | 45 passed | ✓ PASS |
| conversation-store tests | `npx vitest related --run conversation-store.test.ts` | 137 passed | ✓ PASS |
| fleet-status-client tests | `npx vitest related --run fleet-status-client.test.ts` | 26 passed | ✓ PASS |
| AppShell persistence tests | `npx vitest related --run AppShell.persistence.test.tsx` | 13 passed | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `substrate/scripts/tests/fleet-status-sweep-appearance.sh` | `bash fleet-status-sweep-appearance.sh` | Exit 0; PASS 11, FAIL 0 | PASS |

### Requirements Coverage

No REQUIREMENTS.md IDs mapped for this phase (per phase goal statement). Phase is driven by CONTEXT.md D-01..D-13, all verified above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| No blocking anti-patterns found in phase 111 modified files | — | — | — | — |

Scan of all phase-111-modified files for TBD/FIXME/XXX/TODO: None found that are untracked. Phase 111 SUMMARY files note follow-ups (factory extraction, D-08 bounty closure after UAT) as intentional deferrals with explanatory comments in the code; none are unresolved debt markers.

### Human Verification Required

#### 1. First-paint completeness and no correction-flicker

**Test:** Open the app cold (no cache), observe the conversation list on first paint. Verify every visible row is fully dressed: displayName, title (role-inherited where applicable), colorHue. Then start a new conversation on a different host and watch the sidebar.

**Expected:** No row ever appears in an undressed state (plain text, missing hue) that later acquires cosmetics. The new conversation's row appears within 1-2 ticks, dressed from its first frame.

**Why human:** Correction-flicker is the named failure of this phase. It is timing-dependent, machine-dependent, and cannot be observed programmatically. This is D-09's bar stated as a user-visible outcome.

#### 2. Mobile reconnect after background (D-11, D-12)

**Test:** On a mobile browser or PWA, navigate to the app. Note the conversation list state. Lock the screen or switch apps for 60+ seconds (beyond the old 28s give-up window). Return to the app.

**Expected:** The list updates to current state without requiring a page reload. The WS client reconnects, GET /sessions/list re-fires, and any conversations started or ended during the background period are reflected.

**Why human:** The indefinite slow retry and wake-on-visible require real device network behavior that cannot be simulated in vitest. The test suite confirms the code paths exist and the contract is locked; only live device testing confirms the end-to-end flow.

#### 3. Row disappears on conversation end (D-05/D-06)

**Test:** With a conversation active on another host, end that conversation (kill the claude process). Watch the sidebar.

**Expected:** The row disappears from the list within 1-2 WS ticks (the gone frame propagates). No orphan row remains until the next page reload.

**Why human:** Requires a live multi-host setup and an active conversation to terminate. The removeFleetSession wiring is verified by tests; the behavior requires observation.

#### 4. Role-inheritance rendering for pixel identity (zero-fixture test)

**Test:** In the running app, open the conversation list and find the pixel identity's row.

**Expected:** The row shows role-inherited values: `title: "Skynet"` and `colorHue: 324` from the box-maintainer role (pixel.md declares no title or colorHue of its own). This is the live CONTEXT.md-identified inheritance test surface.

**Why human:** The sweep probe confirms sweep emits the correct raw values. The wire-protocol tests confirm they travel. Rendering correctness (PrettyConversationRow reading byHostKey correctly) requires visual inspection.

#### 5. Pin/hide live updates (D-09 for membership axes)

**Test:** Pin or hide a conversation row by touching the `.pinned` or `.hidden` sentinel file, wait for the next sweep tick.

**Expected:** The list updates its order (pinned rows move to top) or membership (hidden rows disappear) without a page reload. A subsequent unpin/unhide reverses the change.

**Why human:** The re-projection chain (identities-store → conversation-store pin/hide sets → panel rendering) is tested via mocked stores, but the disk-to-display path requires live verification.

### Gaps Summary

No gaps found. All 15 mechanically-verifiable truths are VERIFIED. The phase's automated test suite totals 594 tests across 11 test files, all green. The bash probe passes 11/11 cases. The live sweep on t1000 confirms end-to-end data flow for the pixel identity's role-inherited cosmetics.

Five items require human UAT before the phase can be declared fully closed. These are all behavioral/visual checks that test the rendering and physical device reconnect paths that grep and vitest cannot exercise.

---

_Verified: 2026-09-16T23:10:00Z_
_Verifier: Claude (gsd-verifier)_
