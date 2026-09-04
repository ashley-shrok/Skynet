---
phase: 72-identity-modal-role-identity-scope-split-with-role-level-wak
verified: 2026-09-04T10:34:00Z
status: human_needed
score: 12/12 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Actor identity walk-through — modal opens with segmented Role/Identity switch, actor default = Identity view, tap flip changes bottom-bar 3-tab → 4-tab, Wakeups tab reveals list with scope pills, Add-wakeup pill opens sub-modal titled 'Add role-scope wakeup' (or identity), trash triggers AlertDialog confirm, scope memory persists across reopen."
    expected: "See 72-04-SUMMARY.md § Human Verify Walk-through Step 3."
    why_human: "Segmented control visual affordance, hue-tint palette match to sketch variant D, real-browser modal lifecycle, per-session scope memory across close/reopen cannot be trusted programmatically without a real browser."
  - test: "Coordinator identity walk-through — modal opens on Role view; Identity-view Wakeups tab shows caption 'Coordinators use role-scope wakeups only. Switch to Role view to manage.' with NO Add-wakeup pill; Identity-view Handoff tab shows 'Coordinators are stateless routers — no handoff to display.'; Role-view fully functional."
    expected: "See 72-04-SUMMARY.md § Human Verify Walk-through Step 4."
    why_human: "Requires real coordinator identity in the fleet to open the modal against; empty-state captions vs default rendering only verifiable visually in-browser."
  - test: "Regression sweep — bounty search filter fires, Archive accordion lazy-loads, live pinned-count invalidation works when a bounty is pinned, inline title/avatar/hue/voice editors save, Stays-awake switch toggles cleanly, all under the new scope-split modal shell."
    expected: "See 72-04-SUMMARY.md § Human Verify Walk-through Step 5. Zero regressions from Phase 72 shell changes."
    why_human: "Live filter reactivity, WebSocket-driven pinned-count invalidation, real inline editor persistence require a real browser session against live backend."
  - test: "Sketch fidelity check against .planning/sketches/001-identity-modal-role-vs-identity-split/index.html variant D (Top Scope Switch)."
    expected: "Segmented control position/hue, bottom-bar tab arrangement, Add-wakeup pill visual language match the sketch within pixel tolerance."
    why_human: "Visual pixel-level fidelity vs sketch requires human eyes."
  - test: "Empty-branch first-wakeup flow — for actor+identity-empty AND coord+role-empty a hue-tinted Add-wakeup pill IS rendered; for coord+identity-empty the pill is NOT rendered (only case). Save round-trips through the correct scope's WS handler."
    expected: "See 72-04-SUMMARY.md § Human Verify Walk-through Step 7."
    why_human: "Requires identity+scope combinations with empty wakeup lists in the actual fleet + real WS round-trip of the Save."
---

# Phase 72: Identity Modal Role/Identity Scope Split — Verification Report

**Phase Goal:** Rework the identity modal so a top segmented control switches between Role view and Identity view; the bottom icon-bar reshuffles per scope. Adds role-scope wakeup CRUD. Coordinator identities default to Role view; actor identities default to Identity view. Every wakeup visibly wears its scope. Preserves all existing modal behavior (bounty search, archive lazy-load, live pinned-count invalidation, inline title/avatar/hue/voice editors, stays-awake switch).

**Verified:** 2026-09-04T10:34:00Z
**Status:** human_needed
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Segmented Role/Identity control renders at top of modal body, above the Tabs component. | VERIFIED | `IdentityModal.tsx:1739-1791` renders `<div role="group" aria-label="Scope">` with 2 buttons `data-testid="scope-switch-role"` (L1748) + `scope-switch-identity` (L1770), each carrying `aria-pressed={scope === "..."}`. Mounts above `<Tabs>` at L1801. Scope switch tests S1-S8 in `IdentityModal.scope-switch.test.tsx` pass 8/8. |
| 2 | Bottom icon-bar reshuffles per scope — 4 tabs Role (Role file / Bounties / History / Wakeups), 3 tabs Identity (Identity file / Wakeups / Handoff). | VERIFIED | `IdentityModal.tsx:308-319` declares `NAV_SECTIONS_ROLE` (4 entries) and `NAV_SECTIONS_IDENTITY` (3 entries) then selects via `scope === "role" ? NAV_SECTIONS_ROLE : NAV_SECTIONS_IDENTITY`. Tests 22a/22b in `IdentityModal.role-tab.test.tsx` (6/6 green) assert per-scope button counts. |
| 3 | Coordinator identities default to Role view; actor identities default to Identity view; derived from `identity.coordinator` boolean. | VERIFIED | `IdentityModal.tsx:246` — `const defaultScope: ModalScope = identity.coordinator ? "role" : "identity"; const scope = storedScope ?? defaultScope`. Tests S2/S3 in scope-switch.test.tsx cover both branches. |
| 4 | Scope switch position remembered per-identity within a browser session; NOT persisted to localStorage/sessionStorage. | VERIFIED | `modal-scope-store.ts` — module-scoped `Map<identityKey, ModalScope>`, `useSyncExternalStore`-backed hook, no `localStorage`/`sessionStorage` refs (grep returns 0). Tests S6 (memory across close/open of same identity) and S7 (no cross-identity leak) in scope-switch.test.tsx cover this. 8 unit tests in `modal-scope-store.test.ts` pass. |
| 5 | Role-scope wakeup CRUD (list/update/create/delete) reads/writes `~/.claude/roles/<role>/wakeups/*.json`. | VERIFIED | `identity-artifact-reader.ts` — `readRoleWakeups` (L824), `writeRoleWakeupUpdate` (L1364), `writeRoleWakeupCreate` (L1481), `writeRoleWakeupDelete` (L1575). 5 `roles/${role}/wakeups` path substitutions match target ≥4. 18 backend unit tests green. |
| 6 | Identity-scope create + delete parity (previously missing) now exists. | VERIFIED | `identity-artifact-reader.ts` — `writeIdentityWakeupCreate` (L1625), `writeIdentityWakeupDelete` (L1703). Backend test coverage in `identity-artifact-reader.wakeup-crud.test.ts` (8 tests). |
| 7 | 6 new WS message types dispatched (4 role-scope: list/update/create/delete + 2 identity-scope: create/delete). | VERIFIED | `claude-session-server.ts` — 6 dispatch cases at L5631, L5635, L5639, L5643, L5647, L5651, each routing to an extracted handler. 14 WS handler integration tests in `claude-session-server.role-wakeups.test.ts` green. |
| 8 | 12 new wire type exports + WakeupSpecWire alias + 6 events in `ClaudeSessionEvent` union. | VERIFIED | `claude-session-api.ts` — 6 payload types L769-838, 6 event types L775-844, `WakeupSpecWire` alias L760, all 6 events added to union L404-411. |
| 9 | WakeupsTab is scope-aware — accepts `scope: "role" \| "identity"` prop, threads onCreate/onDelete, renders Add-wakeup pill, per-row scope pill, trash-icon with AlertDialog confirm. | VERIFIED | `WakeupsTab.tsx` — `scope` prop at L122, `isCoordinator` at L130, `data-testid="wakeup-add-button"` at L87, `wakeup-scope-pill` at L372 & L429, `wakeup-delete-icon` at L400 & L469, `AlertDialog` imports L6-12 with delete-confirm at L499. 23 WakeupsTab tests + 12 AddWakeupDialog tests green. |
| 10 | AddWakeupDialog has 6 CONTEXT.md-locked form fields including optional IANA Timezone (hidden for Interval, visible for Daily/Weekly/One-shot). | VERIFIED | `AddWakeupDialog.tsx` — fields 1-6 declared in header L8-15; Name (L76, L176), Schedule type (select at L~200), Schedule params (per-type via `RestrictToDaysChips`), Timezone (`data-testid="add-wakeup-tz-input"` L391, hidden for interval), Instruction (L78, L417), Enabled (`<Switch` L431). 12 tests A-L including I/J/K/L for Timezone behavior. |
| 11 | IdentityModal wires per-scope Wakeups panes to real WS handlers (5 new: createIdentityWakeup, deleteIdentityWakeup, updateRoleWakeup, createRoleWakeup, deleteRoleWakeup) + existing updateWakeup preserved. Wave 2's stub trio removed. | VERIFIED | `IdentityModal.tsx` — 5 new async handlers at L766, L784, L803, L824, L841, each sending the correct wire type payload. `<TabsContent value="identity-wakeups">` at L2144 wired to identity-scope callbacks; `<TabsContent value="role-wakeups">` at L2158 wired to role-scope callbacks. Zero remaining "TODO Wave 3" comments, zero no-op stubs. `IdentityModal.wakeup-crud.test.tsx` W1-W4 tests green. |
| 12 | Coordinator Identity-view empty captions: Wakeups tab shows "Coordinators use role-scope wakeups only. Switch to Role view to manage." with NO Add pill; Handoff tab shows "Coordinators are stateless routers — no handoff to display." Existing modal behaviors (bounty search, archive lazy-load, live pinned-count invalidation, inline editors, stays-awake) preserved. | VERIFIED | `WakeupsTab.tsx:162-171` — `if (isCoordinator && scope === "identity") return <div data-testid="wakeups-coordinator-empty-identity">Coordinators use role-scope wakeups only. Switch to Role view to manage.</div>`. `HandoffTab.tsx:46-55` — `if (isCoordinator) return <div data-testid="handoff-coordinator-empty">Coordinators are stateless routers — no handoff to display.</div>`. IdentityModal threads `isCoordinator={identity.coordinator}` at 3 call sites (L2152, L2166, L2183). `invalidateBountyCount` grep count 11 (unchanged pre-72). VoicePicker + hueDraft + titleDraft + staysAwake + Archive state all intact in IdentityModal. 6 tests C1-C5b in `IdentityModal.coordinator-empty.test.tsx` pass. |

**Score:** 12/12 truths verified.

### Failure Modes (from shape file "What would make it wrong") — Cleared

| # | Failure Mode | Status | Evidence |
| - | ------------ | ------ | -------- |
| 1 | Scope split reads as decoration — reader can't tell which view they're in. | CLEARED | Top segmented control uses `aria-pressed` + hue-tinted selected style (IdentityModal.tsx L1749, L1771, L1757-1786). NAV_SECTIONS composition is per-scope. Per-row scope pill (wakeup-scope-pill) makes wakeup rows self-labeling. |
| 2 | Role- and identity-scoped wakeups bleed together. | CLEARED | Two separate state slots (`identityWakeupsState`, `roleWakeupsState`), two separate TabsContent panes (value="identity-wakeups" vs "role-wakeups"), two separate WS handler pairs. Backend uses two-step (identity file frontmatter → role folder) via `resolveRoleForIdentity` — the storage layer physically can't cross-scope. |
| 3 | Coordinator identities open modal to mostly-empty regions with no explanation. | CLEARED | Coord defaults to Role view (`defaultScope: identity.coordinator ? "role" : "identity"`). Identity-view Wakeups + Handoff tabs have explicit captions. C1 + C2 tests lock this behavior. |
| 4 | Scope switch has surprising memory across identity swaps. | CLEARED | modal-scope-store keys by identityKey. Test S7 verifies no cross-key leak. In-memory only (Map, no browser-storage) — a reload wipes state entirely (session-scoped, no cross-day surprise). |
| 5 | Existing modal behavior regresses (bounty search / archive lazy / pinned-count / inline editors / stays-awake). | CLEARED | All 11 existing `invalidateBountyCount` refs preserved. Existing `IdentityModal.bounties-filter.test.tsx` 11/11, `IdentityModal.lazy-archive.test.tsx` 6/6, `IdentityModal.voice.test.tsx` 8/8, `IdentityModal.stays-awake.test.tsx` 6/6 all green after scope-split test-file surgery. `titleDraft`/`hueDraft`/`voiceDraft` state + VoicePicker + Archive state preserved in IdentityModal.tsx. |
| 6 | Role-scope wakeup surface missing an obvious CRUD action. | CLEARED | Role-scope now has full parity — list (readRoleWakeups), enable-disable + edit (writeRoleWakeupUpdate), add (writeRoleWakeupCreate + AddWakeupDialog), delete (writeRoleWakeupDelete + trash + AlertDialog confirm). Same affordances as identity-scope. |

### Locked Decisions (from CONTEXT.md) — Honored

| Decision | Assertion | Status |
| -------- | --------- | ------ |
| 6 new WS message types | 4 role-scope + 2 identity-scope create/delete | VERIFIED — 6 dispatch cases confirmed at IdentityModal.tsx L5631-5651 |
| In-memory scope-switch memory (no localStorage/sessionStorage) | Zustand slice, browser-session lifetime | VERIFIED — `grep -cE "localStorage\|sessionStorage" src/ui/state/modal-scope-store.ts` = 0 |
| AddWakeupDialog 6 fields including optional Timezone | Name / Schedule type / Schedule params / Timezone (IANA) / Instruction / Enabled | VERIFIED — 6 fields present, Timezone hidden for interval / visible for daily-weekly-one_shot |
| Delete uses Radix AlertDialog | Not silent-delete | VERIFIED — 6 AlertDialog imports at WakeupsTab.tsx L6-12 + AlertDialog confirm at L499 |
| Coord default = Role, actor default = Identity | Derived from `identity.coordinator` | VERIFIED — L246 |
| Every wakeup wears its scope | Per-row scope pill | VERIFIED — `wakeup-scope-pill` at L372 (view mode) + L429 (edit mode) |
| Coordinator Identity-view Wakeups tab caption + NO Add pill | Empty state text + branch structure | VERIFIED — WakeupsTab.tsx L162-171; only case that returns before AddWakeupPill render |
| Coordinator Identity-view Handoff tab caption | Empty state text | VERIFIED — HandoffTab.tsx L46-55 |
| Existing modal behaviors preserved | 11 `invalidateBountyCount` refs + inline editors + stays-awake | VERIFIED — grep counts unchanged, all 6 pre-existing IdentityModal test files green |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/backend/claude-session/identity-artifact-reader.ts` | 6 new fns + WakeupSpec type | VERIFIED | readRoleWakeups L824, writeRoleWakeupUpdate L1364, writeRoleWakeupCreate L1481, writeRoleWakeupDelete L1575, writeIdentityWakeupCreate L1625, writeIdentityWakeupDelete L1703, WakeupSpec type L1238. |
| `src/backend/claude-session/claude-session-server.ts` | 6 new WS handlers | VERIFIED | 6 dispatch cases + 6 extracted handlers + 6 msg-type doc entries. |
| `src/ui/api/claude-session-api.ts` | 12 new wire types + WakeupSpecWire + 6 union entries | VERIFIED | 6 payloads + 6 events + `WakeupSpecWire` L760 + 6 union additions L406-411. |
| `src/ui/features/pretty-view/IdentityModal.tsx` | Segmented control + per-scope NAV + coord-default + real WS wiring | VERIFIED | Scope switch at L1739-1791, useModalScope/setModalScope wired L245-251, NAV_SECTIONS split L308-319, 5 new CRUD handlers L766-855, isCoordinator threaded to 3 call sites (L2152, L2166, L2183). |
| `src/ui/state/modal-scope-store.ts` | Zustand-shaped, in-memory-only | VERIFIED | Module-scoped Map + useSyncExternalStore + 5 exports; 0 browser-storage refs. |
| `src/ui/features/pretty-view/WakeupsTab.tsx` | scope prop + Add/Delete + 3-branch empty | VERIFIED | scope L122, isCoordinator L130, wakeup-add-button L87, three-branch empty state L155-193, wakeup-scope-pill 2×, wakeup-delete-icon 2×, AlertDialog delete-confirm L499. |
| `src/ui/features/pretty-view/AddWakeupDialog.tsx` | 6-field form with Timezone | VERIFIED | 6 fields including `add-wakeup-tz-input` at L391, hidden for interval / visible for daily/weekly/one_shot. |
| `src/ui/features/pretty-view/HandoffTab.tsx` | Coordinator empty state | VERIFIED | isCoordinator prop L34, coord short-circuit L46-55 with `handoff-coordinator-empty` testid. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| IdentityModal | modal-scope-store | useModalScope / setModalScope | WIRED | L112 imports; L245, L249 uses. |
| IdentityModal | WakeupsTab (2×) | scope + onCreate + onDelete + isCoordinator | WIRED | L2144-2171 both TabsContent panes carry all 4 props to different WS handlers. |
| IdentityModal | HandoffTab | isCoordinator | WIRED | L2181-2185. |
| WakeupsTab | AddWakeupDialog | scope + onSubmit (points to onCreate) | WIRED | L184-190 (empty branch) + data branch. |
| createIdentityWakeup | WS server | identity:create-wakeup payload | WIRED | IdentityModal L768-780 sends payload + awaits `identity:wakeup-created` echo, replaces state. |
| deleteIdentityWakeup | WS server | identity:delete-wakeup | WIRED | L786-798. |
| updateRoleWakeup | WS server | identity:update-role-wakeup | WIRED | L808-821. |
| createRoleWakeup | WS server | identity:create-role-wakeup | WIRED | L826-838. |
| deleteRoleWakeup | WS server | identity:delete-role-wakeup | WIRED | L843-855. |
| WS server handlers | identity-artifact-reader helpers | direct fn calls (with test seams) | WIRED | Each of 6 handlers at L1555+ calls its corresponding read/write helper. |
| identity-artifact-reader | disk (roles/*/wakeups) | fs / SSH one-shot | WIRED | Two-step (resolveRoleForIdentity → roles/<role>/wakeups) present in all 4 role-scope writers/reader. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None found in Phase 72-scoped files | — | No debt markers (TBD/FIXME/XXX), no stubs, no dead branches, no console.log-only impls in the 8 modified/new files. |

### Test Verification

**Phase 72 test surface — all green:**

- Backend `identity-artifact-reader` + `claude-session-server` tests → 327 passed / 1 skipped (327/328; the 1 skipped is pre-existing, not Phase 72).
- Phase 72 frontend files scoped run — `IdentityModal.*`, `WakeupsTab.*`, `AddWakeupDialog.*`, `HandoffTab.*`, `modal-scope-store.*` → 12 files / 110 tests, all pass.
- `npx tsc --noEmit` → exit 0.

**Pre-existing failures OUTSIDE Phase 72 scope (unchanged by this phase, flagged but not blocking):**
- `PrettyView.load-more.test.tsx` — 9/10 failing.
- `PrettyView.hydration-cap.test.tsx` — 1/8 failing.
- `PrettyView.editable-file.test.tsx` — 5/5 failing.
- `PrettyView.plain-dom.test.tsx` — 1/7 failing (Test 2: outer scroll container should NOT contain `[overflow-anchor:none]` — contract broken by Phase 70/71 which explicitly added `overflow-anchor:none`).

Git log confirms none of these files were touched during Phase 72; failures pre-date this phase's commits (last touched commits 4c8f7d5e / 82e71256 / older, prior to any 72-* commit).

### Commit Hygiene

Phase 72 commits (14 total, atomic per-task, matching CLAUDE.md "atomic per-task commits" directive):

```
3b75e633 feat(72-01): add role-scope wakeup reader/writers + identity-scope create/delete parity
0e837451 feat(72-01): add 6 WS handlers for role-scope wakeup CRUD + identity-scope create/delete
dcad8ed4 docs(72-01): complete backend wakeup CRUD parity plan
e7aa6e00 refactor(72-02): extract shared wakeup-form helpers to WakeupFormShared
20f13402 feat(72-02): add AddWakeupDialog sub-modal + 12 tests
0d485305 feat(72-02): WakeupsTab scope prop + Add-wakeup pill + trash-with-confirm + scope pill
7389c73f docs(72-02): complete frontend WakeupsTab scope + full-CRUD affordances plan
cc99d4af feat(72-03): add modal-scope-store (Zustand-shaped per-identity scope memory)
ad308adc feat(72-03): IdentityModal scope switch + per-scope tab shuffle + wakeup CRUD handlers
ff225269 test(72-03): scope-split test-file surgery + scope-switch + wakeup-crud coverage
0d0c6cfd docs(72-03): complete IdentityModal scope switch + per-scope Wakeups panes plan
47d798db test(72-04): add failing IdentityModal.coordinator-empty tests (RED)
1a817962 feat(72-04): coordinator-Identity-view empty captions + Add-wakeup pill polish (GREEN)
ce8d83db docs(72-04): complete coordinator empty states + polish plan
```

Wave 4 shows explicit TDD RED → GREEN commit pair (47d798db test → 1a817962 feat).

### Human Verification Required

See `human_verification` in the frontmatter above. The five items ARE the walk-through spec that Ashley must run against the deployed build. This maps 1:1 to 72-04-SUMMARY.md § "Human Verify Walk-through" Steps 3-7. The `Human Verify Walk-through` artifact exists in 72-04-SUMMARY.md and is well-scoped; the actual real-browser confirmation is the pending activity, per the human-verify checkpoint gate.

### Gaps Summary

No blocking gaps. Phase 72 delivers what the goal promised at the code level:
- Segmented Role/Identity control lives at the top of the modal body with aria-pressed encoding + hue-tinted selected state.
- Bottom icon-bar reshuffles per scope (4 tabs Role, 3 tabs Identity), driven by NAV_SECTIONS split.
- Coordinator-vs-actor default is `identity.coordinator ? "role" : "identity"`, exactly as CONTEXT.md locked.
- Scope memory is in-memory only, keyed by identityKey, session-lifetime (no localStorage/sessionStorage).
- All 6 new WS message types dispatched + backed by 6 new reader/writer helpers + 12 new wire types.
- Every wakeup wears its scope via a per-row scope pill.
- Coordinator identity-view Wakeups + Handoff carry the CONTEXT.md-mandated empty captions with the exact wording specified.
- All 6 pre-existing IdentityModal test files pass unchanged after test-file surgery — no regression of bounty search, archive lazy-load, pinned-count invalidation, inline editors, or stays-awake.
- 14 atomic commits, TDD RED→GREEN pair on Wave 4, matches CLAUDE.md commit-hygiene directive.

Remaining is Ashley's real-browser walk-through (5 items in `human_verification`), which is the human-verify checkpoint that Phase 72 explicitly deferred to post-ship. Pre-existing PrettyView test failures are documented + flagged as outside Phase 72 scope.

---

_Verified: 2026-09-04T10:34:00Z_
_Verifier: Claude (gsd-verifier)_
