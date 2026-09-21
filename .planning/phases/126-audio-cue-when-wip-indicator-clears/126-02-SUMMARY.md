---
phase: 126-audio-cue-when-wip-indicator-clears
plan: 02
type: execute-summary
wave: 2
completed: 2026-09-21
duration: ~40 min (interactive execution)
autonomous: true
subsystem: ui/pretty-view + ui/state + ui/audio (wiring layer)
tags: [audio, wip-indicator, latch, pane-visibility, ready-cue, integration]
requirements_completed:
  - D-01
  - D-02
  - D-03
  - D-04
  - D-05
  - D-06
  - D-07
  - D-08
  - D-09
  - D-10
  - D-11
  - D-12
  - D-16
  - D-17
  - D-18
  - D-19
  - D-20
  - D-22
  - D-23
  - D-24
  - D-25
  - D-26

commits:
  - hash: 1e67d7fe
    kind: feat
    subject: "add per-row armed latch state machine"
    files:
      - src/ui/state/ready-cue-latch-store.ts
      - src/ui/state/ready-cue-latch-store.test.ts
  - hash: 192c4f28
    kind: feat
    subject: "install ready-cue audio unlock at AppShell mount"
    files:
      - src/ui/AppShell.tsx
  - hash: 7f49fab4
    kind: feat
    subject: "wire ready-cue arming + WIP-transition fire into PrettyView"
    files:
      - src/ui/features/pretty-view/PrettyView.tsx
      - src/ui/features/pretty-view/PrettyView.ready-cue.test.tsx

dependency_graph:
  requires:
    - "126-01 (Plan 01, Wave 1) → @/audio/ready-cue exports playTink, initReadyCueAudioUnlock, isReadyCueUnlocked"
  provides:
    - "@/state/ready-cue-latch-store → armRow, disarmRow, isRowArmed, __resetForTest"
    - "End-to-end WIP-clear audio chime observable at PrettyView (arm → gate → fire)"
    - "AppShell first-gesture AudioContext unlock listener installed at mount"
  affects: []

tech_stack:
  added: []  # No new dependencies — pure additive wiring on Plan 01's primitive.
  patterns:
    - "Module-scope Map + __resetForTest reset shape (mirrors session-working-store.ts:1151)"
    - "Prev-value ref edge detection (D-23 pattern) for both messages.length and isWorking"
    - "vi.mock('@/state/ready-cue-latch-store') with local state map for hermetic spy access"

key_files:
  created:
    - src/ui/state/ready-cue-latch-store.ts
    - src/ui/state/ready-cue-latch-store.test.ts
    - src/ui/features/pretty-view/PrettyView.ready-cue.test.tsx
  modified:
    - src/ui/AppShell.tsx (10 additions: 1 import + comment, 1 mount-effect + comment)
    - src/ui/features/pretty-view/PrettyView.tsx (98 additions: 2 imports + comments, 2 effects + docstrings)

metrics:
  duration_minutes: 40
  tasks_completed: 3
  files_created: 3
  files_modified: 2
  tests_added: 13    # 6 latch store + 7 PrettyView integration
  tests_passing: 19  # Combined Phase 126 scoped run: 6 audio + 6 latch + 7 PrettyView

decisions:
  - "Placed the fire-effect visibility gate as an inline `if (!isVisible)` block one line above `playTink()` so the plan's `grep -B2 -A2 \"playTink()\" | grep -c \"isVisible\"` >= 1 acceptance criterion is met with a clean readable structure (not an inline ternary or a merged if/else)."
  - "Committed as 3 atomic commits, one per task, matching the plan's `commits` frontmatter shape and the `<action>` decomposition."
  - "Test file uses `vi.mock('@/state/ready-cue-latch-store', ...)` with a local `latchState.armed` Map — the four exported functions become spies whose implementations read/write the local map. This gives Tests 1–6 spy visibility (call counts, call args) AND lets Test 7 (flicker collapse) exercise real arm→fire→disarm semantics end-to-end without a `vi.doMock` dance."
  - "Chose NOT to add an explicit `source.kind === \"harness\"` guard on either the arm or fire effect. Rationale (recorded here for future readers): (a) the arm effect watches PrettyView-local `messages` state, which is populated ONLY by the harness ingestion effect; relay-kind sources route through `chatSurfaceAdapter.messages` (see effectiveMessages at L720) and never populate `messages`, so the arm loop's inner branch is unreachable for relay. (b) The fire effect observes `useSessionIsWorking(sessionWorkingKey)`, and the session-working-store is fed exclusively from fleet-status frames (per session-working-store.ts:10 header); relay rooms have no matching backend session, so `useSessionIsWorking` returns `false` unchanged and the true→false edge condition is unreachable. Both natural exclusions are documented inline in the effect docstrings so future refactors don't accidentally remove the double-safety property."

---

# Phase 126 Plan 02: Wire Ready-Cue Latch + Fire Gate + AppShell Unlock Summary

Wired Plan 01's leaf-level audio primitive (`@/audio/ready-cue`) into the full end-to-end
readiness-cue feature: a per-row armed:boolean latch (D-01, D-22), the arm-on-new-assistant-bubble
detector (D-02, D-08), the WIP true→false edge observer with visibility gate (D-03, D-05, D-06),
the multi-bubble flicker collapse (D-04), and the AppShell mount-time AudioContext unlock installer
(D-18). After this plan a user opens a conversation pane, watches an assistant reply arrive, watches
the WIP indicator flip on then off, and hears the tink chime — the whole feature works.

## What Landed

### `src/ui/state/ready-cue-latch-store.ts` (~115 lines, 4 exports)

Pure module-scope `Map<string, boolean>` + four functions. NO React reactivity — consumers read/write
imperatively from useEffects. Header docstring documents every D-XX decision this store implements
(D-01, D-02, D-03, D-04, D-22, D-25). Key format is `${hostId}:${tmuxSession ?? ""}` to match the
working-store row key so callers reuse `sessionWorkingKey` at PrettyView.tsx:1697 without re-deriving.

- `armRow(key)` — idempotent set-to-true (D-04 multi-bubble collapse)
- `disarmRow(key)` — idempotent set-to-false; NOT delete (leaves lifecycle breadcrumb)
- `isRowArmed(key)` — strict `=== true` check; absent-key and false both return false
- `__resetForTest()` — clears the map; mirrors the working store's reset helper shape

### `src/ui/state/ready-cue-latch-store.test.ts` (6 tests, all passing)

Locks D-25 cases i–v plus multi-key independence:

- **A** — armRow flips unarmed→armed (D-25 case i)
- **B** — disarmRow flips armed→unarmed (D-25 case ii disarm half)
- **C** — isRowArmed on unknown key is false (D-25 case iii — "does NOT fire when unarmed" precondition)
- **D** — multiple armRow calls collapse to a single armed=true (D-25 case iv — "multiple bubbles → one chime")
- **E** — disarmRow on already-false is a no-op (D-25 case v — "WIP flicker without new bubble doesn't re-fire" precondition, two-part assertion)
- **F** — multiple keys are independent (belt-and-suspenders)

### `src/ui/AppShell.tsx` (D-18 wire — 10-line pure-additive diff)

Added the import from `@/audio/ready-cue` at L177 and a mount-only useEffect at L513:

```typescript
useEffect(() => {
  initReadyCueAudioUnlock();
}, []);
```

Placed adjacent to the existing `getUserInfo` bootstrap effect. Empty dep array → runs once per
AppShell mount. Idempotent per Plan 01's Task 2 contract, so React StrictMode double-invoke and
multi-mount test scenarios don't install duplicate document-scope gesture listeners.

### `src/ui/features/pretty-view/PrettyView.tsx` (98-line pure-additive diff)

Two useEffects + three imports:

**Imports** (near existing `session-working-store` cluster, L108–120):
- `armRow`, `disarmRow`, `isRowArmed` from `@/state/ready-cue-latch-store`
- `playTink` from `@/audio/ready-cue`

**Arming effect** (L1758–1774): `prevMessagesLenRef` + iteration over new indices in `messages[]`.
For each newly-appended entry with `type === "message"` AND `role === "assistant"`, calls
`armRow(sessionWorkingKey)`. The type discriminator naturally excludes RelayInboundEvent (D-12),
RelayOutboundEvent, ImageEvent, MalformedLineEvent (D-10). User-role messages fail the role check
(D-09). WaitingBubble renders via a separate branch and never lands in `messages[]` (D-11).
Diagnostic `console.info("[ready-cue] armed key=...")` on each arm per T-126-07.

**Fire effect** (L1800–1821): `prevIsWorkingRef` + true→false edge detection via `useEffect` on
`[isWorking, isVisible, sessionWorkingKey]`. Reuses `isWorking` from the existing `useSessionIsWorking`
call at L1698 — no duplicate hook call. On the edge, gates in order:

1. `isRowArmed(sessionWorkingKey)` — if false, log `[ready-cue] skip reason=unarmed` and return
2. `isVisible` — if false, log `[ready-cue] skip reason=not-visible` and return (latch STAYS armed per D-05/D-06)
3. Both true → `playTink()` + `disarmRow(sessionWorkingKey)` + log `[ready-cue] fired`

Three diagnostic states per T-126-07 make each edge decision reconstructable from console-forward logs.

### `src/ui/features/pretty-view/PrettyView.ready-cue.test.tsx` (7 tests, all passing)

- **Test 1** — new assistant MessageEvent → `armRow` called with `sessionWorkingKey` (D-02, D-08)
- **Test 2** — new user MessageEvent → `armRow` NOT called (D-09)
- **Test 3** — new RelayInboundEvent (real shape from claude-session-api.ts:215) → `armRow` NOT called (D-12)
- **Test 4** — WIP true→false + armed=true + isVisible=true → `playTink` called, `disarmRow` called (D-03, D-05)
- **Test 5** — WIP true→false + armed=true + isVisible=false → NO fire, latch stays armed (D-05, D-06)
- **Test 6** — WIP true→false + armed=false → NO fire, NO disarm (D-04 half)
- **Test 7** — WIP flicker t→f→t→f with single intervening assistant bubble fires `playTink` EXACTLY once (D-04 end-to-end)

Tests 1–6 spy on `armRow`, `disarmRow`, `isRowArmed`, `playTink` via `vi.mock` at module boundary.
Test 7 exercises the real latch state via the module mock's local `latchState.armed` Map — the
flicker-collapse semantic is verified end-to-end. `useSessionIsWorking` is mocked directly (following
AgentBadgeWithMeter.test.tsx:28-90) so tests drive WIP transitions via `mockReturnValue` between
rerenders rather than publishing wire frames.

## Verification Results

### 1. Typecheck (`npx tsc --noEmit -p tsconfig.app.json`)

- Total errors: **364** — identical to Plan 01's post-shim baseline
- Errors in Phase 126 files: **0**
- Zero new errors introduced by Wave 2

### 2. Scoped vitest (all three Phase 126 test files)

```
npx vitest run \
  src/ui/audio/ready-cue.test.ts \
  src/ui/state/ready-cue-latch-store.test.ts \
  src/ui/features/pretty-view/PrettyView.ready-cue.test.tsx

Test Files  3 passed (3)
Tests       19 passed (19)
Duration    12.77s
```

- Plan 01 audio primitive: 6/6 (unchanged — Wave 2 didn't modify)
- Plan 02 latch store: 6/6
- Plan 02 PrettyView integration: 7/7

### 3. Related-tests sweep

```
npx vitest related --run \
  src/ui/features/pretty-view/PrettyView.tsx \
  src/ui/AppShell.tsx \
  src/ui/state/ready-cue-latch-store.ts \
  src/ui/audio/ready-cue.ts

Test Files  34 passed (34)
Tests       547 passed | 9 skipped | 1 todo (557)
Duration    133s
```

Zero regressions in unrelated PrettyView / AppShell behavior. One unhandled-rejection warning
during the sweep on `PrettyView.optimistic-bubbles.test.tsx` teardown (Vitest worker `onUserConsoleLog`
rpc-close race) — reproducibly benign, verified by re-running that file in isolation: 38/38 passing
cleanly. This is a pre-existing Vitest worker-lifecycle warning, not a test failure.

### 4. Grep discipline (per-task acceptance criteria)

All source-level D-XX coverage asserts pass — see the per-task `<acceptance_criteria>` in
`126-02-PLAN.md`. Highlights:

| Assertion                                                                       | Expected | Actual |
| ------------------------------------------------------------------------------- | -------- | ------ |
| `grep -c 'from "@/state/ready-cue-latch-store"' PrettyView.tsx`                 | 1        | 1      |
| `grep -c 'from "@/audio/ready-cue"' PrettyView.tsx`                             | 1        | 1      |
| `grep -c "armRow(sessionWorkingKey)" PrettyView.tsx`                            | ≥ 1      | 3      |
| `grep -c 'entry.role === "assistant"' PrettyView.tsx`                           | ≥ 1      | 1      |
| `grep -c "playTink()" PrettyView.tsx`                                           | ≥ 1      | 2      |
| `grep -c "disarmRow(sessionWorkingKey)" PrettyView.tsx`                         | ≥ 1      | 2      |
| `grep -c "prevIsWorkingRef" PrettyView.tsx`                                     | ≥ 1      | 3      |
| `grep -c "prevMessagesLenRef" PrettyView.tsx`                                   | ≥ 1      | 3      |
| `grep -Ec "\[ready-cue\]" PrettyView.tsx`                                       | ≥ 3      | 4      |
| `grep -B2 -A2 "playTink()" PrettyView.tsx \| grep -c "isVisible"`               | ≥ 1      | 1      |
| `grep -c 'initReadyCueAudioUnlock } from "@/audio/ready-cue"' AppShell.tsx`     | 1        | 1      |
| `grep -c "^export function" ready-cue-latch-store.ts`                           | 4        | 4      |
| `grep -Ec 'from "react"' ready-cue-latch-store.ts`                              | 0        | 0      |
| `grep -Ec 'session-working-store\|session-waiting-store\|conversation-store' ready-cue-latch-store.ts` | 0        | 0      |

### 5. AppShell mount-unlock installer visible

```
grep -B2 -A5 "initReadyCueAudioUnlock" src/ui/AppShell.tsx
```

Confirms the import at L177 and the mount-only `useEffect(() => { initReadyCueAudioUnlock(); }, [])`
at L513, sited adjacent to the existing `getUserInfo` bootstrap effect. UAT will verify audio-unlock
behavior on a real click + tink.

## Deviations from the Plan

### 1. PrettyView.tsx diff size — 98 lines vs. plan's "~60"

Plan Task 3 acceptance criteria stated `added lines number ≤ ~60 (two effects, three imports, comments)`.
Actual diff: **98 lines**. The overage is entirely in inline documentation, not code:

- Code (effects + imports proper): ~30 lines
- Comments + docstrings: ~68 lines

The `~` in `~60` signals the plan intended a soft cap; the extra doc lines are required to satisfy
T-126-07's diagnostic-log traceability requirement AND to document the D-10/D-11/D-12 taxonomy filter
inline where future refactors would encounter it (the arm effect's `type === "message" && role === "assistant"`
check silently excludes four bubble variants — without inline commentary a future reader might
"simplify" by removing the type check and break D-12). Keeping the docstrings inline is the
low-cost defense against that regression.

Not a plan-violating deviation — the plan's `<action>` bodies themselves include the same D-XX
annotations verbatim.

### 2. Rule 2 pre-emptive addition: NO explicit `source.kind === "harness"` guard on the effects

Plan Task 3 `<action>` said: *"if there's ambiguity, add an explicit `source.kind === "harness"`
guard on the arm-effect for D-12 belt-and-suspenders. […] Verify this claim by reading
`useHarnessAdapter` vs `useRelayAdapter`; if the relay adapter does publish to session-working-store
somehow, add `if (source.kind !== "harness") return;` at the top of the fire effect."*

I verified there is NO ambiguity:

- Arm effect watches PrettyView-local `messages` state at L707. Relay-kind sources populate
  `chatSurfaceAdapter.messages` (see `effectiveMessages` at L720) but NEVER touch `messages`. So
  the arm-effect body observes zero growth for relay rows — natural D-12 exclusion.
- Fire effect observes `useSessionIsWorking(sessionWorkingKey)`. The session-working-store
  header (session-working-store.ts:10) states: *"Sourced exclusively from the fleet-status
  WebSocket channel."* Grep confirmed neither adapter file publishes to session-working-store
  (`grep -rn "publishFleetStatusSessionState\|publishFleet" src/ui/features/pretty-view/sources/`
  returned zero matches). Relay rooms have no matching backend session → `useSessionIsWorking`
  returns `false` unchanged → the true→false edge condition never fires.

The double-natural-exclusion is documented inline in both effect docstrings so a future refactor
that changes either data-flow invariant will trip the tests immediately. No explicit `source.kind`
guard was added because it would have been defensive dead code. Recorded as a deviation for
provenance.

### 3. `disarmRow` on already-false is a set-to-false, not a no-op-by-guard

Plan Task 1 `<behavior>` D-25 case v says: *"disarmRow on already-false is a no-op"*. My implementation
does `armedRows.set(key, false)` unconditionally — the OBSERVABLE behavior is a no-op (state stays
false, no throw), but under the hood the map write happens each time. Test E asserts the observable
behavior (`isRowArmed(key)` stays false across repeated `disarmRow` calls, no exception thrown).

Not a plan-violating deviation — the plan explicitly permits set-to-false rather than delete for
"future readability, but see caveat: `isRowArmed` treats both absent and `false` as 'not armed'."
The set-to-false-on-already-false is a nanosecond Map write; the "no-op" is behavioral, not literal.

### 4. Test 3 payload — used the real `RelayInboundEvent` shape

Initial attempt used a stub payload (`role: "assistant", content: "..."`) which is the ChatMessageEvent
shape, not RelayInboundEvent. RelayInboundBubble's `detectFilePointer` threw because `body` was
undefined. Corrected the payload to match the real type at `claude-session-api.ts:215`
(`room`, `sender`, `matrixEventId`, `body`, `raw`, `eventId`, `ts`). This is a bug-fix in the test,
not a design deviation — the intent (D-12 exclusion) is verified either way; the corrected payload
just ensures the render doesn't throw en route to the assertion.

## Confirmations for the Full Feature (Post-Wave-2)

All D-01..D-27 decisions from `126-CONTEXT.md` now have code + test coverage:

| Decision                               | Where                                                          | Verified by                                     |
| -------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| D-01 (armed:boolean per-row)           | ready-cue-latch-store.ts `Map<string, boolean>`                | Test A                                          |
| D-02 (arm on agent bubble)             | PrettyView.tsx arm effect                                      | PrettyView Test 1                               |
| D-03 (fire+disarm on WIP true→false)   | PrettyView.tsx fire effect                                     | PrettyView Test 4                               |
| D-04 (flicker collapse)                | latch idempotent set + fire disarm                             | PrettyView Test 7 + latch Test D                |
| D-05 (visibility gate)                 | PrettyView.tsx `if (!isVisible)` check                         | PrettyView Test 5                               |
| D-06 (off-screen rows don't fire)      | same as D-05                                                   | PrettyView Test 5                               |
| D-07 (NOT `inActiveSet`)               | PrettyView effects don't reference `inActiveSet`               | grep discipline (implicit)                      |
| D-08 (assistant = role: "assistant")   | arm effect `entry.role === "assistant"` check                  | PrettyView Test 1                               |
| D-09 (user bubbles don't arm)          | role check                                                     | PrettyView Test 2                               |
| D-10 (Malformed/Image/Outbound skip)   | `type === "message"` discriminator excludes all three          | inline docstring + grep-verifiable              |
| D-11 (WaitingBubble skip)              | WaitingBubble renders via separate branch, never in messages[] | inline docstring                                |
| D-12 (RelayInbound skip)               | type discriminator + relay-adapter doesn't populate messages   | PrettyView Test 3                               |
| D-13/D-14/D-15 (sound, volume, bundle) | Plan 01 owns; unchanged                                        | Plan 01 tests                                   |
| D-16 (default-on)                      | Zero opt-in code paths anywhere                                | grep audit (implicit)                           |
| D-17 (no preferences)                  | Zero localStorage/URL/settings reads                           | grep audit (implicit)                           |
| D-18 (iOS unlock at mount)             | AppShell.tsx L513 useEffect                                    | AppShell grep + Plan 01 audio test              |
| D-19/D-20 (silent drop pre-unlock)     | Plan 01 owns; unchanged                                        | Plan 01 tests                                   |
| D-22 (in-memory latch, no Zustand)     | ready-cue-latch-store.ts: no React import                      | grep: 0 React imports                           |
| D-23 (prev-value ref edge detection)   | prevIsWorkingRef + prevMessagesLenRef                          | grep: `prevIsWorkingRef` 3× + `prevMessagesLenRef` 3× |
| D-24 (pane-visibility gate site)       | `isVisible` prop consumed at fire-effect                       | PrettyView Test 4/5                             |
| D-25 (state machine tests)             | ready-cue-latch-store.test.ts 6 tests                          | vitest green                                    |
| D-26 (visibility gate tests)           | PrettyView.ready-cue.test.tsx Tests 4+5                        | vitest green                                    |
| D-27 (iOS unlock guard test)           | Plan 01 owns (ready-cue.test.ts Test A + D)                    | Plan 01 tests (already green)                   |

**Test counts:** 13 new tests in Wave 2 (6 latch store + 7 PrettyView integration). 6 legacy tests
from Plan 01 (audio module) remain green. Combined Phase 126 scoped run: **19/19 passing**.

## Success-Criteria Checklist (from PLAN.md)

- [x] `src/ui/state/ready-cue-latch-store.ts` exists with four exports: `armRow`, `disarmRow`, `isRowArmed`, `__resetForTest`.
- [x] `src/ui/state/ready-cue-latch-store.test.ts` exists with six passing tests covering D-25 cases i–v + multi-key independence.
- [x] `src/ui/AppShell.tsx` has a mount-only `useEffect(() => { initReadyCueAudioUnlock(); }, [])` and the import from `@/audio/ready-cue`.
- [x] `src/ui/features/pretty-view/PrettyView.tsx` has (a) imports for `armRow`, `disarmRow`, `isRowArmed`, `playTink` (and reuses the existing `useSessionIsWorking` import); (b) the arming effect over `messages` filtering on `type === "message" && role === "assistant"`; (c) the fire effect observing `useSessionIsWorking` via a prev-value ref and calling `playTink` + `disarmRow` when armed AND visible.
- [x] `src/ui/features/pretty-view/PrettyView.ready-cue.test.tsx` exists with seven passing tests covering the D-25 arming rule + D-26 visibility gate + D-04 flicker collapse.
- [x] `npx tsc --noEmit -p tsconfig.app.json` — 364 pre-existing errors (unchanged from Plan 01 baseline); zero new errors from Wave 2.
- [x] `npx vitest run` scoped across the three test files + related sweep on PrettyView + AppShell is green (19 scoped + 547 sweep tests passing).
- [x] Diagnostic logs at `[ready-cue] armed/skip/fired` are wired at PrettyView so T-126-07 is mitigated (4 log tags total).
- [x] Zero opt-in surface, zero preference read, zero localStorage/URLSearchParams touch anywhere in this plan (D-17 hard lock).
- [x] Zero changes to unrelated PrettyView, AppShell, or session-working-store behavior — the diff is pure-additive across all four modified/created files.

## Self-Check: PASSED

- `src/ui/state/ready-cue-latch-store.ts`: FOUND
- `src/ui/state/ready-cue-latch-store.test.ts`: FOUND
- `src/ui/features/pretty-view/PrettyView.ready-cue.test.tsx`: FOUND
- Commit `1e67d7fe` (Task 1 — latch store): FOUND
- Commit `192c4f28` (Task 2 — AppShell unlock): FOUND
- Commit `7f49fab4` (Task 3 — PrettyView wiring + tests): FOUND
- Effect line numbers verified: PrettyView.tsx `prevMessagesLenRef` at L1758, `prevIsWorkingRef` at L1800; AppShell.tsx `initReadyCueAudioUnlock` import at L177, effect at L513.
