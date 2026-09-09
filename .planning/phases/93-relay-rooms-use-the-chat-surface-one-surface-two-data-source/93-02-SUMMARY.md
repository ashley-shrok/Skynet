---
phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-source
plan: 02
subsystem: ui/pretty-view
tags:
  - multi-badge
  - port-from-deletion
  - anchor-extension
  - harness-regression-floor
  - slice-2
requires:
  - Phase 93 Slice 1 (source-prop foundation + adapter contract + stubbed relay adapter with isReady=false + participants={humans:[],agents:[]})
  - Slice D still-live retirement source at src/ui/features/relay-room-pane/{AgentBadgeWithAppendage,IdentityBadgeRow}.tsx (port source; unchanged this slice)
provides:
  - AgentBadgeWithMeter — pretty-view/ home for the shrunk-meter+reset agent badge (byte-port of Slice D's AgentBadgeWithAppendage)
  - MultiBadgeAnchor — leftward-growing badge row at absolute top-4 right-5 z-[101], humans-first-alphabetical, agents-alphabetical, self-exclude, isReady loading discrimination
  - PrettyView badge-anchor case-branch — harness renders byte-identical single-badge; relay mounts MultiBadgeAnchor with adapter.participants + adapter.isReady wired through
affects:
  - src/ui/features/pretty-view/PrettyView.tsx (extension in place — 91 additions, 5 deletions; wrapper-only change at badge anchor)
tech-stack:
  added: []
  patterns:
    - useSyncExternalStore over conversation-store fleet-sessions with array-identity caching (ported from Slice D IdentityBadgeRow)
    - Warning 2 loading-vs-empty state discrimination inside a pure-render component
    - D-08 discipline — mount gate reads source.kind; child component is source-oblivious
key-files:
  created:
    - src/ui/features/pretty-view/AgentBadgeWithMeter.tsx
    - src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx
    - src/ui/features/pretty-view/MultiBadgeAnchor.tsx
    - src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx
    - src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "flex-row-reverse for leftward growth (RESEARCH Assumption A3) — agents map FIRST in JSX so they sit visually rightmost (adjacent to harness anchor); humans map SECOND so they grow further left. Verified byte-shape via render tests (Task 2 Test 1 asserts DOM order)."
  - "MultiBadgeAnchor takes explicit props (participants + viewingUserMxid + fleetIdentityHosts + isReady) rather than reading stores directly — pure-render component, easier to test, keeps hooks-order concerns in PrettyView where the case-branch lives."
  - "Loading placeholder renders under the SAME root class as the ready-with-participants branch — anchor position parks at D-01 from mount regardless of adapter readiness. Prevents a visible position-shift when isReady flips."
  - "Empty case (isReady=true + zero non-self participants) renders null, not a placeholder — degenerate case shouldn't happen for a real relay room; if it does, the anchor spot stays clean rather than showing 'no participants' chrome the user might read as a bug."
metrics:
  duration: "~35 min executor wall-clock"
  completed: 2026-09-09
requirements:
  - D-01
  - D-02
  - D-03
  - D-08
  - D-18
---

# Phase 93 Plan 02: Multi-badge extension of PrettyView's badge anchor — Summary

**One-liner:** Extends PrettyView's single upper-right IdentityBadge anchor into a case-branched slot — harness renders exactly one badge byte-identical to master; relay mounts a new leftward-growing MultiBadgeAnchor with per-role sorting, self-exclusion, per-agent context-meter appendage, and loading-vs-empty state discrimination.

## What Landed

Wave 2 of the Phase 93 refactor. Three tasks, three atomic commits, ~1,720 lines of new code (2 new production files + 3 new test files) plus a surgical extension to PrettyView.tsx (91 additions, 5 deletions).

### Task 1: Byte-preserving port AgentBadgeWithAppendage → AgentBadgeWithMeter

Commit: `0472112d`

- `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` (293 lines) — byte-port of Slice D's `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` (292 lines). Preserves verbatim:
  - Shrunk meter width `6rem` (vs. ComposeBox's 12rem)
  - `SEG_COUNT = 12` (visual parity with ComposeBox meter)
  - Read-side: `useSessionIsWorking(\`${hostId}:${tmuxSessionName}\`)`, `useSessionIsRecycling(same key)`, `useSessionContextPct(hostId, tmuxSessionName)` — all three D-10 zero-drift regression gates
  - Write-side: `authApi.post(\`/agent-reset/${hostId}/${encodeURIComponent(tmuxSessionName)}\`, { body: "" })` with `encodeURIComponent` path-traversal defense (T-93-02-01)
  - Structured `agent_reset_failed` warn (never `JSON.stringify` raw error — T-93-02-02)
  - `data-appendage="true"` marker (D-09 discriminator)
  - Band computation (green ≤ 45 < amber ≤ 78 < red)
  - Reset in-flight guard preventing double-fire
  - Recycling gate that dims all segments
- `src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx` (299 lines) — port of Slice D's 13-test assertion set; all D-10 regression gates preserved.
- The retiring source at `src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx` is UNTOUCHED (verified via `git status`) — Slice 4 deletes the whole retiring tree.

### Task 2: MultiBadgeAnchor with humans-first sort + self-exclusion + loading/empty state discrimination

Commit: `01465a7f`

- `src/ui/features/pretty-view/MultiBadgeAnchor.tsx` (224 lines) — new leftward-growing badge row.
  - Root anchor class `absolute top-4 right-5 z-[101] flex flex-row-reverse items-start gap-2` — parity with harness single-badge position at PrettyView.tsx:3417 (D-01).
  - `flex-row-reverse` layout — agents map FIRST in JSX (visually rightmost), humans map SECOND (visually further left). RESEARCH Assumption A3 verified via Task 2 Test 1's DOM-order assertion.
  - Sort discipline ported verbatim from Slice D `IdentityBadgeRow.tsx:242-290`: humans self-excluded then alphabetical by `displayName`; agents alphabetical by `identityKey`.
  - HumanBadgeCell renders bare `<IdentityBadge>` — no meter (D-02).
  - AgentBadgeCell renders `<AgentBadgeWithMeter>` (Task 1 port) with per-agent host resolution via `fleetIdentityHosts[identityKey]`. Missing-host-mapping degrades gracefully to a bare badge + `console.warn({ operation: "agent_badge_no_host_mapping" })` (D-10 correctness log preserved).
  - **Warning 2 fix** — loading vs. empty discrimination via `isReady: boolean` prop:
    - `isReady={false}` → renders subtle `"loading participants..."` placeholder at the D-01 anchor with `data-testid="multi-badge-anchor-loading"`. The relay tab never appears empty during the WS-connecting window.
    - `isReady={true}` + zero non-self participants → renders `null` (empty case).
    - `isReady={true}` with participants → renders the sorted badge row.
  - D-08 discipline: MultiBadgeAnchor reads NO `source.kind` — mount gate lives in PrettyView; component is source-oblivious.
  - D-18 discipline: no `onClick` on human badges; agent-badge click behavior inherited from AgentBadgeWithMeter (badge inert, reset button separately clickable).
- `src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx` (326 lines) — 10 tests: sort discipline, self-exclusion, role attribution, per-role meter presence, position class, flex-row-reverse, graceful degradation, and the three Warning-2 states (loading / empty / ready-with-participants).

### Task 3: PrettyView badge-anchor case-branch

Commit: `85cee03b`

- `src/ui/features/pretty-view/PrettyView.tsx` — extends the badge-anchor block at L3417:
  - New imports: `useSyncExternalStore`, `MultiBadgeAnchor`, `useViewingUserMxid`, `buildIdentityHostsFromFleet`, `getFleetSessionsSnapshot`, `subscribeConversationStore`.
  - New module-level `useFleetIdentityHosts()` hook — `useSyncExternalStore` over `conversation-store` fleet-sessions snapshot, cached on array identity to prevent infinite-update loop (ported verbatim from Slice D's `IdentityBadgeRow.tsx:141-160`).
  - Adapter renamed from `_chatSurfaceAdapter` (unused void) to `chatSurfaceAdapter` — now consumed for its `participants` + `isReady` at the MultiBadgeAnchor mount.
  - Body reads `viewingUserMxid = useViewingUserMxid()` + `fleetIdentityHosts = useFleetIdentityHosts()` unconditionally (Rules of Hooks — harness case ignores them).
  - Badge anchor wrapped: `source.kind === "harness" && pvIdentityKey && (<IdentityBadge ... />)` — subtree BYTE-IDENTICAL to Slice 1 (Pitfall 1 harness regression floor). Sibling `source.kind === "relay" && (<MultiBadgeAnchor participants={...} viewingUserMxid={... ?? ""} fleetIdentityHosts={...} isReady={chatSurfaceAdapter.isReady} />)` block added below.
  - `handleComposeSend` NOT modified (Slice 3 case-selects the send handler per D-13).
  - Ingestion effect NOT modified (Slice 1 gate already in place).
  - Task pill z-[100] STAYS BELOW badge z-[101] — verified via `PrettyView.task-pill.test.tsx` green + source-file grep Test 5.
- `src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx` (409 lines) — 7 behavioral tests covering: harness regression floor (exactly ONE badge at position class + `pv-identity-breathe`), harness DOES NOT mount MultiBadgeAnchor, relay case mounts MultiBadgeAnchor + hides single-badge mount, relay case renders passed participants, task-pill unchanged (grep), source-file discipline (grep — harness gate + relay gate + MultiBadgeAnchor usage + isReady threading), and loading state passthrough with adapter isReady=false.

## Deviations from Plan

**None** — the plan executed exactly as written across all three tasks.

The plan's `<output>` block referenced `92-02-SUMMARY.md` (rescue-rebase filename typo — the phase directory is on `93-...` and the prior slice SUMMARY is at `93-01-SUMMARY.md`). Slice 2's SUMMARY landed at `93-02-SUMMARY.md` to match the on-disk convention. This is a filename normalization, not a scope deviation.

## Authentication Gates

None. Zero user-facing runtime auth state was touched.

## Threat Flags

None net-new. The plan's threat register (T-93-02-01 through T-93-02-06 + T-93-02-SC) is fully addressed:

- **T-93-02-01 (Tampering — path traversal via `tmuxSessionName`)** — mitigated. `AgentBadgeWithMeter.tsx` preserves `encodeURIComponent(tmuxSessionName)` verbatim (Task 1 acceptance grep + Test 8b). Two call sites in the file (one in the JSDoc, one in the actual `authApi.post`).
- **T-93-02-02 (Information Disclosure — structured logging)** — mitigated. Structured `agent_reset_failed` warn preserves verbatim; never `JSON.stringify` raw error object. `agent_badge_no_host_mapping` warn preserves the same discipline.
- **T-93-02-03 (Tampering — harness case regression, Pitfall 1)** — mitigated. Wrapper-only change at PrettyView.tsx:3417 (`source.kind === "harness" &&` prefix). Harness subtree byte-preserved. All 88 pretty-view test files (1015 tests) pass unchanged.
- **T-93-02-04 (XSS — participant `displayName`)** — mitigated. Display names in MultiBadgeAnchor flow through IdentityBadge's existing render path (React text children, never `dangerouslySetInnerHTML`). No new rendering surface introduced.
- **T-93-02-05 (DoS — z-index layering)** — mitigated. Badge z-[101] and task-pill z-[100] preserved. `PrettyView.task-pill.test.tsx` green as an acceptance criterion.
- **T-93-02-06 (DoS UX regression — loading vs empty)** — mitigated. Warning 2 fix in `MultiBadgeAnchor.tsx`: `isReady=false` → subtle placeholder; `isReady=true + zero cells` → null render. Prevents relay tab from appearing empty during the WS-open-but-no-participants-frame-yet window.
- **T-93-02-SC (Supply chain — package installs)** — N/A. No packages installed.

## Known Stubs

- **`useRelayAdapter` stub inside `use-chat-surface-adapter.ts`** — unchanged from Slice 1 (still returns `isReady=false, participants={humans:[],agents:[]}`). Slice 3 replaces this with the real ported hook that flips `isReady=true` when the first participants frame arrives. Slice 2's relay mount correctly displays the loading placeholder until Slice 3 lands.

No new stubs introduced by this slice.

## Rationale for Decisions

- **`flex-row-reverse` for leftward growth (RESEARCH A3):** The alternative (explicit `.reverse()` on the array with `flex-row`) is equally correct but noisier. `flex-row-reverse` at the layout layer + intuitive-order-in-JSX at the code layer keeps the sort discipline readable. Verified visually via Task 2 Test 1's explicit DOM-order assertion.
- **Explicit props for MultiBadgeAnchor (no internal store reads):** Keeps MultiBadgeAnchor a pure-render component. Testing is trivial (all cases driven by props). Store reads live one level up in PrettyView where the case-branch decision happens. Slice 3's real adapter will subscribe to its own store internally for participants + isReady — PrettyView threads them through as adapter output.
- **Loading placeholder shares root class with ready branch:** Prevents a visible position shift when the adapter flips from `isReady=false` to `isReady=true`. The anchor is parked at the D-01 spot from mount.
- **Empty case renders null (not "no participants" chrome):** Degenerate case shouldn't happen for a real relay room. If it does, an empty anchor spot is less confusing than an explicit "empty" message the user might interpret as a bug.

## Test Results

**Aggregate verification per plan verify block:**

```
npx vitest run \
  src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx \
  src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx \
  src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx \
  src/ui/features/pretty-view/PrettyView.test.tsx \
  src/ui/features/pretty-view/PrettyView.task-pill.test.tsx \
  src/ui/features/pretty-view/PrettyView.source-prop.test.tsx \
  src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx \
  src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx

Test Files  8 passed (8)
     Tests  101 passed | 1 skipped | 1 todo (103)
   Duration ~11.4s
```

**Broader pretty-view suite (defensive — 88 test files):**

```
npx vitest run src/ui/features/pretty-view/

Test Files  88 passed (88)
     Tests  1015 passed | 11 skipped | 1 todo (1027)
   Duration ~97s
```

**Retiring pane's own tests (still-live standalone — unchanged this slice):**

```
npx vitest run \
  src/ui/features/relay-room-pane/AgentBadgeWithAppendage.test.tsx \
  src/ui/features/relay-room-pane/IdentityBadgeRow.test.tsx

Both files green — nothing changed there (Slice 4 deletes the tree).
```

**Typecheck:**

```
npx tsc --noEmit
(no output — clean)
```

## Acceptance Criteria Verification

### Plan Success Criteria

- ✅ `AgentBadgeWithMeter.tsx` + tests in pretty-view/ (byte-preserved port).
- ✅ `MultiBadgeAnchor.tsx` + tests in pretty-view/ with leftward-growing layout, humans-first-alphabetical, self-exclusion, role attribution, graceful degradation on missing host mapping, AND loading-vs-empty state discrimination via `isReady` prop (Warning 2).
- ✅ PrettyView's badge anchor has a case-branch — harness renders byte-identical single-badge; relay renders MultiBadgeAnchor with adapter.participants + adapter.isReady wired through.
- ✅ Harness case DOM at the badge anchor is byte-identical to master (wrapper-only change; interior subtree byte-preserved).
- ✅ All existing PrettyView tests pass unchanged.
- ✅ Standalone relay pane STILL routed to and functional (source files at `relay-room-pane/` untouched; Slice 4 retires the tree).
- ✅ `npx tsc --noEmit` passes.

### must_haves.truths (from plan frontmatter)

- ✅ Harness case renders exactly one `<IdentityBadge>` at `absolute top-4 right-5 z-[101]` byte-identical to master (Slice 1 preserved this; Slice 2 preserves it — wrapper-only outer JSX change).
- ✅ Relay case renders `<MultiBadgeAnchor>` at the same anchor position, with badges growing leftward from the right edge (D-01).
- ✅ MultiBadgeAnchor sorts humans-first-then-agents, alphabetical within each role, viewing-user self-excluded (D-03).
- ✅ MultiBadgeAnchor distinguishes 'loading' (adapter isReady=false, WS still connecting) from 'empty' (isReady=true with zero non-self participants) — loading renders a subtle placeholder, empty renders nothing (per Warning 2 UX-regression fix).
- ✅ AgentBadgeWithMeter carries a shrunk meter + reset appendage below the badge (visual reference: retiring `AgentBadgeWithAppendage.tsx` — byte-port).
- ✅ Human badges in relay case render WITHOUT a meter (D-02).
- ✅ Badge-click in relay case is a no-op — no IdentityModal, no navigation (D-18).
- ✅ Every case-based branch in this slice reads `source.kind` (D-08); MultiBadgeAnchor is only mounted when `source.kind === 'relay'`.

## Follow-Ups for Downstream Slices

- **Slice 3** (relay adapter port): drops in the real `useRelayAdapter` at `src/ui/features/pretty-view/sources/use-relay-adapter.ts`, replaces the inline stub in `use-chat-surface-adapter.ts`. New adapter's `participants` output shape must match `ChatSurfaceParticipants` from `chat-surface-source.ts` — MultiBadgeAnchor consumes via structural typing (participants only needs `mxid` + `displayName` for humans; the `userId` field on Slice D's `HumanParticipant` type is not read by MultiBadgeAnchor). Slice 3's adapter should flip `isReady=true` when the first participants frame arrives, at which point the loading placeholder swaps to the real badge row.
- **Slice 4** (retirement + tabUtils rewire): deletes `src/ui/features/relay-room-pane/` entirely + `RelayRoomSessionPane.tsx`. Sweeps comment references at `AppShell.tsx:1448,2156`, `conversation-store.ts:193`, `viewing-user-store.ts:6-10,148,167`, `fleet-status-client.ts:292`, `matrix-message-fetch.ts:106`. Updates `tabUtils.tsx` relay branch to mount `PrettyView` with `source={{ kind: "relay", ... }}` directly. Retires `tabUtils.tsx:306-326` early-return per D-06. Clears vitest cache.
- **Slice 5** (test migration cleanup): retires Slice D pane tests as their production siblings delete in Slice 4. Updates `tabUtils.test.tsx` to assert "sessionKind relay-room routes to shared chat surface with relay source." Consider flipping `source?:` back to `source:` (required) on PrettyView props once every internal caller migrated.

## Self-Check: PASSED

Files created:
- ✅ src/ui/features/pretty-view/AgentBadgeWithMeter.tsx (FOUND)
- ✅ src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx (FOUND)
- ✅ src/ui/features/pretty-view/MultiBadgeAnchor.tsx (FOUND)
- ✅ src/ui/features/pretty-view/MultiBadgeAnchor.test.tsx (FOUND)
- ✅ src/ui/features/pretty-view/PrettyView.multi-badge.test.tsx (FOUND)

Files modified:
- ✅ src/ui/features/pretty-view/PrettyView.tsx (verified via `grep -c "MultiBadgeAnchor" → 8` and `grep -c 'source.kind === "harness"' → 3, source.kind === "relay" → 3`)

Commits:
- ✅ 0472112d feat(93-02): port AgentBadgeWithAppendage → AgentBadgeWithMeter (byte-preserving)
- ✅ 01465a7f feat(93-02): land MultiBadgeAnchor with loading/empty discrimination
- ✅ 85cee03b feat(93-02): add PrettyView badge-anchor case-branch — relay mounts MultiBadgeAnchor

Retirement source untouched:
- ✅ src/ui/features/relay-room-pane/AgentBadgeWithAppendage.tsx (not in git status — Slice 4 retires)
- ✅ src/ui/features/relay-room-pane/IdentityBadgeRow.tsx (not in git status — Slice 4 retires)
