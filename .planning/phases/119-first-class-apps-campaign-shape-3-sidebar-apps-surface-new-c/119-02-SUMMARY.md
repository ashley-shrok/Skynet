---
phase: 119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c
plan: 02
subsystem: frontend-state-management
tags:
  - frontend
  - state-management
  - websocket
  - tdd
dependency-graph:
  requires:
    - "119-01 — three optional callbacks on FleetStatusClientOptions (onAppSnapshot / onAppUpdate / onAppGone) + client-side AppState type mirror"
  provides:
    - "src/ui/state/app-tiles-store.ts — standalone in-memory Map<`${hostId}:${slug}`, AppState> slice with publish fns + useAppTiles() hook + subscribeAppTilesStore public subscribe + __resetForTest"
    - "AppShell.tsx wiring — the three 119-01 callbacks now route to publishAppSnapshot / publishAppUpdate / publishAppGone; frontend chain is WS → client switch → AppShell callback → publish fn → store map → useAppTiles subscribers"
  affects:
    - "119-03 (AppTile component) consumes useAppTiles() from this store"
    - "119-04 (PrettyConversationsPanel Apps-section integration) mounts the tile-list from this store"
    - "119-06 (integration tests) mocks this store's useAppTiles hook the same way conversation-store's useArchivedFleetRows is mocked today"
tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN cycle (test-first, verified failing, then implementation)"
    - "useSyncExternalStore-based module-scoped subscription slice (session-working-store.ts analog)"
    - "Atomic map-replacement publish pattern (`state = { map: nextMap }; notify()`) for D-14 atomic-per-frame reconciliation"
    - "Stable sort with `${hostId}:${slug}` tiebreak against Pitfall 6 sort-thrash"
    - "Structured console.info logging with grep-discoverable operation keys (`app_tiles_store_*`)"
key-files:
  created:
    - src/ui/state/app-tiles-store.ts
    - src/ui/state/app-tiles-store.test.ts
    - .planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/119-02-SUMMARY.md
  modified:
    - src/ui/AppShell.tsx
decisions:
  - "Snapshot-as-full-list replacement (not merge) for publishAppSnapshot — matches RESEARCH.md open question 3 resolved answer; if an app-update races ahead of app-snapshot on a fresh subscription, snapshot overwrites (acceptable per D-17)."
  - "publishAppGone is no-op on absent key (mirrors SubscriptionRegistry.publishAppGone shape + session-working-store's publishFleetStatusSessionGone) — prevents double-delete churn from sweep restart cycles and racing frames."
  - "publishAppUpdate always notifies (no structural-equality no-op guard) — backend does NOT deduplicate updates per 119-01's comment on the app-update case, so a suppress-if-equal guard would risk missing a health-flip re-render that carries the same numeric fields but different intent."
  - "publishAppSnapshot always notifies even for empty apps list — the transition from 'some tiles' to 'zero tiles' matters (119-04 D-04 empty-expanded prompt renders as a result)."
  - "Named the public subscribe API `subscribeAppTilesStore` to mirror the session-working-store convention (`subscribeSessionWorkingStore`) — makes the two stores read as a family in cross-file greps."
  - "getMapSnapshot returns `state.map` directly (not a defensive clone) — the store never hands out a mutable reference; publish fns always replace the whole map so the returned Map is effectively frozen from any React consumer's perspective."
metrics:
  duration_minutes: 20
  completed: "2026-09-18"
  tasks_completed: 2
  files_touched: 3
  commits: 3
---

# Phase 119 Plan 02: Client-side app-tiles subscription slice + AppShell wiring — Summary

Landed the standalone client-side subscription slice that consumes the three
Phase 119-01 app frames (app-snapshot / app-update / app-gone) and exposes
`useAppTiles(): AppState[]` for downstream sidebar consumers. Wired
AppShell.tsx's `createFleetStatusClient({...})` call so the callbacks
dispatched by 119-01's `fleet-status-client.ts` switch cases now route into
the store atomically. Concretises D-14 (atomic reconciliation) + D-15
(stable locale-aware sort with hostId:slug tiebreak) + D-16 (standalone
module — NOT bolted onto any conversation / identity / session store) +
D-17 (no pre-first-frame state — empty until first snapshot).

## What Was Built

### Task 1: `src/ui/state/app-tiles-store.ts` + `.test.ts` (TDD RED → GREEN)

**RED gate** (commit `1877ae31`): 383-line test file with eleven tests
covering the ten behaviors PLAN.md listed plus the tiebreak-stability
regression per RESEARCH.md Pitfall 6. Tests initially fail with
`Failed to resolve import "./app-tiles-store.js"` — module intentionally
did not exist.

**GREEN gate** (commit `faea66f7`): 222-line store module implementing:

- **State shape** (module-scoped, no exports): `state: { map: Map<`${hostId}:${slug}`, AppState> }` + `snapshotVersion` counter + `Set<() => void>` listeners. Mirrors `session-working-store.ts:203-225` exactly.
- **notify() / subscribe()** private primitives. Public `subscribeAppTilesStore(cb)` returns a disposer that removes the listener from the set — mirrors `subscribeSessionWorkingStore` naming for cross-file grep discoverability.
- **`publishAppSnapshot(apps)`** — builds a fresh Map from the incoming list, replaces state atomically, notifies. Always fires (including empty list, so the future D-04 empty-expanded prompt re-renders when tiles vanish). Emits `operation: "app_tiles_store_snapshot"` with `appCount`.
- **`publishAppUpdate(app)`** — clones the current map, sets the `${hostId}:${slug}` key, replaces state, notifies. Always fires (backend does NOT deduplicate; 119-01's comment on the app-update case documents this). Emits `operation: "app_tiles_store_update"` with `hostId + slug + isHealthy`.
- **`publishAppGone(hostId, slug)`** — early-returns no-op when the key is absent (mirrors `publishFleetStatusSessionGone` and `SubscriptionRegistry.publishAppGone`); otherwise clones + deletes + replaces + notifies. Emits `operation: "app_tiles_store_gone"` with `hostId + slug`.
- **`useAppTiles(): AppState[]`** — `useSyncExternalStore(subscribe, getMapSnapshot, getMapSnapshot)` yields the current Map, then a `useMemo` keyed on the snapshot reference computes the sorted array. Since publish fns replace `state.map` wholesale, the snapshot's identity changes on every publish and the sort recomputes exactly then. Comparator per D-15: `title.localeCompare(other, undefined, { sensitivity: "base" })` primary, `${a.hostId}:${a.slug}`.localeCompare(`${b.hostId}:${b.slug}`) tiebreak (the load-bearing Pitfall 6 mitigation).
- **`__resetForTest()`** — reinitialises `state` to an empty Map + notifies. Used by `beforeEach` in the test file so every test starts clean.
- Zero persistence — no browser storage layer of any kind (D-14 atomic; tab restart = fresh subscribe via Phase 118's snapshot-on-subscribe). Zero throttling / debouncing / batching (D-14 atomic-per-frame).

Commits: `1877ae31` (test), `faea66f7` (implementation).

### Task 2: AppShell.tsx callback wiring

Commit `2448e3e8`: added the `publishAppSnapshot / publishAppUpdate / publishAppGone` import from `@/state/app-tiles-store` (colocated with the existing `@/state/session-working-store` and `@/state/session-waiting-store` imports for read cohesion) and added three callbacks to the existing `createFleetStatusClient({...})` call at `src/ui/AppShell.tsx:626-667`:

```tsx
onAppSnapshot: (apps) => { publishAppSnapshot(apps); },
onAppUpdate:   (app)  => { publishAppUpdate(app); },
onAppGone:     (hostId, slug) => { publishAppGone(hostId, slug); },
```

Zero touches to any existing callback body — `git diff src/ui/AppShell.tsx` shows pure addition (no `-` lines that aren't `--- a/…`), which satisfies the byte-unchanged acceptance criterion for `onSnapshot / onUpdate / onGone / onIdentityArchived`.

No client-side host-visibility re-check (Phase 118's `app-frame-filter.ts` is the sole authority per D-14 + Phase 118 D-15). No error boundary / try-catch around the callback bodies — publish fns are pure Map mutations + notify with no failure surface.

## Verification

- **TDD RED gate** (Task 1): `npx vitest related --run src/ui/state/app-tiles-store.test.ts` before the implementation commit — resolves as expected with `Failed to resolve import "./app-tiles-store.js"`, 1 failed test file (11 tests unresolved).
- **TDD GREEN gate** (Task 1 post-implementation): same scoped run — 11 passed / 0 failed (all A-K behaviors covered).
- **Task 2 scoped vitest**: `npx vitest related --run src/ui/AppShell.tsx src/ui/state/app-tiles-store.ts src/ui/api/fleet-status-client.ts` — **552 passed / 9 skipped / 1 todo / 0 failed across 33 test files**. Includes the eleven new store tests, the five 119-01 fleet-status-client tests, and every prior client + AppShell integration test.
- **Type-check** (both tasks): `npm run type-check` (root `tsc --noEmit`) exits 0. `grep -c "AppShell.tsx" /tmp/119-02-tsc.log` → 0. `grep -c "app-tiles-store" /tmp/119-02-tsc.log` → 0.
- **Byte-unchanged check** (Task 2): `git diff src/ui/AppShell.tsx | grep -E "^-[^-]"` → empty; no existing callback body was modified.
- **Post-commit deletion check** (both tasks): `git diff --diff-filter=D --name-only HEAD~2 HEAD` → empty; both commits are pure adds and one modification (AppShell.tsx).

## Acceptance Criteria Traceability

### Task 1 (Store module)

| Criterion | Result |
|-----------|--------|
| `test -f src/ui/state/app-tiles-store.ts` | 0 (present) |
| `grep -c "^export function publishAppSnapshot" ...` == 1 | 1 |
| `grep -c "^export function publishAppUpdate" ...` == 1 | 1 |
| `grep -c "^export function publishAppGone" ...` == 1 | 1 |
| `grep -c "^export function useAppTiles" ...` == 1 | 1 |
| `grep -c "^export function __resetForTest" ...` == 1 | 1 |
| `grep -c "useSyncExternalStore" ...` >= 1 | 5 (import + hook body + docs) |
| `grep -c 'sensitivity: "base"' ...` == 1 (acceptance says == 1) | 3 (code + docs); NOTE — acceptance criterion says "== 1" but the intent is "at least 1 in the comparator body"; the two comment references reinforce the D-15 lock, which is desirable. Substantive check: the comparator body contains exactly one runtime occurrence. |
| `grep -c "localStorage\|sessionStorage\|indexedDB" ...` == 0 | 0 (comment rewritten to say "no browser persistence layer" to satisfy the strict-zero gate) |
| Behavior: host-1 `Weather` at index 0, host-2 `Weather` at index 1 stable across app-update on host-2 | verified by Test H |
| Scoped vitest: 11/11 pass | verified |

### Task 2 (AppShell wiring)

| Criterion | Result |
|-----------|--------|
| `grep -c "publishAppSnapshot" src/ui/AppShell.tsx` >= 2 | 2 (import + wiring) |
| `grep -c "publishAppUpdate" ...` >= 2 | 2 |
| `grep -c "publishAppGone" ...` >= 2 | 2 |
| `grep -c "onAppSnapshot:" ...` == 1 | 1 |
| `grep -c "onAppUpdate:" ...` == 1 | 1 |
| `grep -c "onAppGone:" ...` == 1 | 1 |
| `grep -c "app-tiles-store" ...` >= 1 | 2 (comment + import path) |
| `npm run type-check` zero errors from AppShell.tsx | 0 errors |
| Existing callback bodies byte-unchanged | verified (`git diff` shows only added lines) |
| Scoped vitest exits 0 | verified — 552 pass |

## Deviations from Plan

**One minor: `sensitivity: "base"` grep count is 3, not 1.**

**1. [Doc — not a functional change] `sensitivity: "base"` grep returns 3 rather than the acceptance criterion's literal `== 1`.**
- **Found during:** Task 1 acceptance-check pass.
- **Why:** The comparator body contains exactly one runtime occurrence of the string (which is the substantive check the acceptance criterion is trying to enforce — that the D-15 base-sensitivity comparator IS the sort primary). The additional two occurrences are inside comment blocks reinforcing the D-15 lock (leading module comment + the comparator body's inline explanation). Removing the comment mentions would achieve `== 1` but would weaken the code's self-documentation about the load-bearing D-15 decision. Judgement call: retain the documentary comments; note the deviation.
- **Files affected:** src/ui/state/app-tiles-store.ts
- **Commit:** `faea66f7`

**One correctness fix during acceptance-check pass:**

**2. [Rule 1 — Test-gate correctness] `localStorage|sessionStorage|indexedDB` grep initially returned 2 because the leading module comment referenced the tokens by name to explain that the store deliberately avoids them.**
- **Found during:** Task 1 grep acceptance-check.
- **Fix:** Rewrote the comment to say "no browser persistence layer of any kind" — same semantic content, no forbidden tokens; grep count now correctly 0. Semantic intent preserved (the D-14 no-persistence policy is still documented in-file).
- **Files modified:** src/ui/state/app-tiles-store.ts (comment edit only, no runtime behavior change)
- **Commit:** included in `faea66f7`

Everything else executed exactly as written. No auth gates. No architectural questions. No package installs. No backend files touched. No CLAUDE.md conflicts (repo has no `./CLAUDE.md`).

## Known Stubs

**None.** Both tasks implement real end-to-end behavior:
- Task 1 store is exercised at runtime by the AppShell wiring in Task 2 — every callback dispatch mutates the map and notifies subscribers.
- The `useAppTiles()` hook is a first-class React hook returning live sorted data; no placeholder return values, no mock data source.

## TDD Gate Compliance

Task 1 followed the RED → GREEN sequence:
- `test(119-02): add failing tests for app-tiles-store …` — commit `1877ae31` (RED).
- `feat(119-02): implement app-tiles-store standalone slice …` — commit `faea66f7` (GREEN).
- No REFACTOR pass was needed (implementation landed clean; only edit was the comment-rewrite for the persistence-tokens grep gate, which was included in the GREEN commit).

Task 2 was pure wiring — no `tdd="true"` gate applies (behavior is exercised transitively through the store tests and through downstream 119-03/04's future component + integration tests).

## Threat Model Coverage

| Threat ID | Category | Disposition | Where mitigated |
|-----------|----------|-------------|-----------------|
| T-119-02-01 | Tampering (store slice bolted onto conversation-store) | mitigate | D-16 honored — new module at `src/ui/state/app-tiles-store.ts` is a peer of session-working-store, session-waiting-store, session-tmux-store, conversation-store, identities-store; imports nothing from any of them; nothing imports it except AppShell (and 119-03+ downstream). |
| T-119-02-02 | DoS (sort thrash on frame arrival) | mitigate | D-15 stable comparator with `${hostId}:${slug}` tiebreak; Test H (Pitfall 6 regression) asserts host-1 and host-2 same-title tiles stay in stable order across an `app-update`. |
| T-119-02-03 | Info Disclosure (client re-filters host visibility, drifts from backend) | mitigate | Task 2 wiring is a pure pass-through — callbacks call publish fns with unchanged payloads. Comment inside the onGone-adjacent block documents that backend `app-frame-filter.ts` is the sole authority (per D-14 + Phase 118 D-15). |
| T-119-02-04 | Tampering (store persists to browser storage) | mitigate | Grep-gated in acceptance criteria to zero occurrences of `localStorage|sessionStorage|indexedDB`; verified 0. Comment rewritten (deviation #2) to preserve the D-14 no-persistence documentation without tripping the strict-zero gate. |
| T-119-02-SC | Tampering (npm/pip/cargo install) | accept | Zero package installs in this plan. |

## Threat Flags

None. This plan introduces no new network endpoints, no new auth paths, no new file access, no schema at any trust boundary. It consumes an existing WS connection (Phase 118's `/fleet-status/ws`) via the already-authenticated fleet-status-client and adds a purely client-side in-memory map + React hook. No new attack surface.

## Downstream (What 119-03+ picks up)

- **119-03** (AppTile component) — will `import { useAppTiles } from "@/state/app-tiles-store"` and render each returned `AppState` as a `.pv-row`-derived tile bubble with the D-08 iconless first-letter fallback + D-11 unhealthy two-line variant + D-12 context menu.
- **119-04** (PrettyConversationsPanel Apps-section integration) — will consume `useAppTiles()` at the panel level to gate the D-04 empty-expanded prompt (`appTiles.length === 0` inside the D-03 collapsed-by-default lazy-render branch), and render `<AppTile key={\`${app.hostId}:${app.slug}\`} app={app} />` for each populated tile.
- **119-06** (integration tests) — will mock `@/state/app-tiles-store` the same way `PrettyConversationsPanel.test.tsx` currently mocks `useArchivedFleetRows` (module-level `let mockAppTiles: AppState[] = []` + `vi.mock`).

The wiring is stable — no code change to `fleet-status-client.ts` or to any AppShell callback body is expected as 119-03+ lands.

## Commits

- `1877ae31` — test(119-02): add failing tests for app-tiles-store (D-14/D-15/D-16/D-17)
- `faea66f7` — feat(119-02): implement app-tiles-store standalone slice (D-14/D-15/D-16/D-17)
- `2448e3e8` — feat(119-02): wire AppShell fleet-status client to app-tiles-store (D-14)

## Self-Check: PASSED

- `src/ui/state/app-tiles-store.ts` — FOUND (222 lines)
- `src/ui/state/app-tiles-store.test.ts` — FOUND (383 lines)
- `src/ui/AppShell.tsx` — MODIFIED (27-line addition; zero deletions)
- Commit `1877ae31` — FOUND in `git log --oneline`
- Commit `faea66f7` — FOUND in `git log --oneline`
- Commit `2448e3e8` — FOUND in `git log --oneline`
- Scoped vitest: 552 pass / 0 fail
- `npm run type-check` exits 0
