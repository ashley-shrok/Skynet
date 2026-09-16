---
phase: 111-conversation-list-arrives-complete-and-stays-live
plan: "05"
subsystem: conversation-store/appshell
tags: [typescript, fleet-sessions, pulse-membership, row-create-remove, D-10, additive-merge, fleet-status]
dependency_graph:
  requires:
    - Plan 111-04 (mergeIdentityAppearance + AppShell applyFleetState appearance-first ordering)
  provides:
    - upsertFleetSession: pulse's single-row door — additive, structurally unable to flip fleetSessionsLoaded
    - onGone wired to removeFleetSession: gone frame removes the row immediately
    - 12-case test suite with 3 load-bearing proofs pinning the row-appear contract
  affects:
    - Plan 111-06 (timing change for the one-shot fetch builds on this live path)
    - bounty sidebar-fleet-sessions-refresh-after-identity-create (superseded after UAT)
tech_stack:
  added: []
  patterns:
    - pulse-driven row upsert that is structurally unable to touch fleetSessionsLoaded
    - additive field-wise merge with explicit per-field enumeration (advanceSessionAiTitle pattern)
    - relay-room / empty-sessionName / non-finite-hostId rejection at the door
    - hostsByIdRef pattern for live Map access inside a mount-once effect
    - appearance-before-row ordering enforced by upsertFleetSession being the last call in applyFleetState
    - onGone row removal after the three pre-existing per-session-state publishes

key-files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/AppShell.tsx

key-decisions:
  - "upsertFleetSession omits fleetSessionsLoaded from state assignment — absence is the greppable proof"
  - "relay-room rows rejected at door (arrive only via /sessions/list); empty sessionName rejected (malformed-row prevention)"
  - "hostsByIdRef used to give the mount-once [] effect a live Map without re-subscribing the socket"
  - "role resolved from identityAppearance?.role (appearance arrived first) not widened onto the wire"
  - "created always preserved from existing row — bumping on every tick would reshuffle ordering continuously"
  - "D-08 two hand-wired refresh exceptions deliberately left in place pending UAT confirmation"
  - "D-05 GET /sessions/list one-shot fetch and its error path are untouched"

requirements-completed: []

duration: ~60 minutes
completed: 2026-09-16
---

# Phase 111 Plan 05: pulse row-appear/disappear — upsertFleetSession + onGone wiring

**Conversations starting elsewhere now appear in the list on their own and ones that end disappear — row membership is live from the pulse, dressed on first paint, with no page reload needed.**

## Performance

- **Duration:** ~60 minutes
- **Started:** 2026-09-16T21:15:00Z
- **Completed:** 2026-09-16T21:35:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `upsertFleetSession` — the pulse's narrow single-row door, structurally unable to flip `fleetSessionsLoaded`, with input guards (relay-room, empty sessionName, non-finite hostId) and an additive field-wise merge that never blanks values it doesn't own
- `onGone` wired to `removeFleetSession` so a pulse frame ending a session removes its row without a reload
- `applyFleetState` extended with `upsertFleetSession` as the LAST call, after `mergeIdentityAppearance`, preserving the appearance-before-row ordering contract (T-111-28)
- 12 test cases pinning the row-appear contract; 3 proven load-bearing by deliberate breakage

## Task Commits

1. **Task 1: Add upsertFleetSession** - `c6a0a75f` (feat)
2. **Task 2: Test the row-appear / row-disappear contract** - `5d7f149a` (test)
3. **Task 3: Wire row create into applyFleetState and row remove into onGone** - `ed0cb23c` (feat)

## Files Created/Modified

- `src/ui/state/conversation-store.ts` — `upsertFleetSession` exported, placed immediately after `removeFleetSession` as its sibling
- `src/ui/state/conversation-store.test.ts` — 12 new cases (324 insertions, 0 deletions), `upsertFleetSession` added to imports
- `src/ui/AppShell.tsx` — `hostsByIdRef` added, `upsertFleetSession` imported and called last in `applyFleetState`, `removeFleetSession` called in `onGone`

## Self-Check Results

### 1. Test for new session arriving on pulse creating a row
**Case 1** — "appear: upsert into empty fleetSessions creates a row with correct composite id"  
Asserts `fleetSessions` has one entry with the correct `hostId`/`sessionName`, and that `__getFleetOnlyRowsForTest()` yields a row with id `fleet::6::willow`.

### 2. Test for session going away removing its row
**Case 11** — "removal: upsert then removeFleetSession removes the row; fleetSessionsLoaded unchanged by either call"  
Asserts the row is gone after `removeFleetSession(6, "willow")` and `fleetSessionsLoaded` is unchanged by both calls.

### 3. Test proving relay-room row is REJECTED, verified load-bearing
**Case 8** — "relay-room rejected: upsert with kind='relay-room' is rejected; existing relay-room row from updateFleetSessions is preserved and well-formed"  
Proves the relay-room upsert is a no-op (no notify, no state mutation). Also seeds a relay-room via `updateFleetSessions` and asserts the row survives a subsequent harness upsert with its relay id intact.

**Load-bearing proof:** Temporarily commenting out `if (session.kind === "relay-room") return;` → Case 8 goes RED (1 failed | 135 passed). Restored.

### 4. Test proving FAILING /sessions/list re-ask cannot wipe the list
**AppShell.persistence.test.tsx Test 5** (quick-260821-m36): "getSessionList rejects → updateFleetSessions([]) flips fleetSessionsLoaded false→true"  
This pre-existing test covers the fetch-failure path where `updateFleetSessions([])` runs. The catch branch in AppShell only fires on first load when `fleetSessionsLoaded` is `false`; on a re-ask (Plan 111-06 territory), `fleetSessionsLoaded` is already `true` and the same empty-array call would wipe rows — which is why Plan 111-06 must handle the re-ask path differently.  
The Plan 111-05 contribution to this protection is **Case 9** ("OQ-3 interaction: upsert → fetch-without-it → gone → re-upsert → present") which documents the self-healing behaviour as a decision of record: the pulse re-adds a row on the next tick after a fetch wipes it, and the transient is invisible.

### 5. No fleetSessionsLoaded gate on the upsert — grep evidence

```
node -e "
const src=fs.readFileSync('src/ui/state/conversation-store.ts','utf8');
const m=src.match(/export function upsertFleetSession[\s\S]*?\n}\n/);
const codeLines = m[0].split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
console.log(codeLines.filter(l => /fleetSessionsLoaded/.test(l)));
"
→ []
```

No `fleetSessionsLoaded` appears in the executable code body of `upsertFleetSession`. It appears only in comments (intentionally, as the rationale for its absence).

### 6. git diff --stat PrettyConversationsPanel.tsx → EMPTY

```
git diff --stat src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
(no output)
```

File untouched.

### 7. npm run build exits 0

```
✓ built in 3.81s
```

`npm run build:backend` not needed — no files under `src/backend/` were modified in this plan.

### 8. Scoped tests green for all modified files

```
npx vitest related --run src/ui/state/conversation-store.test.ts src/ui/AppShell.persistence.test.tsx src/ui/api/fleet-status-client.test.ts
Test Files  3 passed (3)
Tests  159 passed (159)
```

### Load-bearing breakage proofs

- **Case 2** (fleetSessionsLoaded NOT flipped): temporarily added `fleetSessionsLoaded: true` to upsert's state assignment → Cases 2, 9, 11 went RED (3 failed | 133 passed). Restored.
- **Case 5** (created preserved): temporarily changed `created: existing.created` to `created: session.created` → Case 5 went RED (1 failed | 135 passed). Restored.
- **Case 8** (relay-room guard): temporarily commented out relay-room guard → Case 8 went RED (1 failed | 135 passed). Restored.

## Deviations from Plan

### Plan's grep-gate specification

The plan's `<verify>` node for Task 1 uses a grep that matches the full function body including comment lines. The comment in `upsertFleetSession` intentionally mentions `fleetSessionsLoaded` (explaining why it is absent from the state assignment). The grep-gate as written would incorrectly flag this — the guard was verified by filtering out comment lines, which is what the intent of "the greppable proof" means.

The state assignment `state = { ...state, fleetSessions: nextFleetSessions }` contains no `fleetSessionsLoaded` reference whatsoever. The load-bearing test (Case 2) is a stronger proof than the grep anyway.

### D-08 hand-wired refresh exceptions — deliberately retained

Per the plan's `resolved_open_questions`: the two hand-wired refresh exceptions (identity create, relay-room create) are deliberately left in place. They are now likely redundant since rows self-appear via the pulse, but removing a working refresh path in the same plan that first makes rows self-appearing would make a regression in either half indistinguishable from a regression in the other.

**Bounty `sidebar-fleet-sessions-refresh-after-identity-create` closes as superseded ONLY after UAT confirms the self-appearing behaviour.**

### Case 9 uses __resetFleetSessionsForTest

The `beforeEach` in `conversation-store.test.ts` calls `updateFleetSessions([])` which unconditionally flips `fleetSessionsLoaded: true`. Cases 2, 9, and 11 assert on the loaded flag starting false, so they call `__resetFleetSessionsForTest()` at the start — this is the exact isolation helper documented in the test file's comment ("flag-flip subtlety"). This is correct usage of the existing test infrastructure, not a workaround.

## Known Stubs

None. All three tasks deliver complete, wired functionality:
- `upsertFleetSession` is wired from `applyFleetState` in AppShell via the fleet-status WS
- `removeFleetSession` is wired from `onGone` in AppShell via the fleet-status WS  
- Both are synchronous in one callback body so React batches them into a single render

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

T-111 mitigations verified:
- **T-111-25** (fleetSessionsLoaded flipped by pulse): `upsertFleetSession` omits the flag; Task 2 Case 2 verified load-bearing.
- **T-111-26** (malformed row / relay-room manufactured): three input guards at the door; Cases 8 and 10, Case 8 load-bearing.
- **T-111-27** (null tmuxSession matching unintended row): explicit null/empty guard in `onGone` before `removeFleetSession`.
- **T-111-28** (row paints undressed): `upsertFleetSession` is LAST in `applyFleetState` after `mergeIdentityAppearance`; synchronous writes → single React render.
- **T-111-29** (less-informed answer blanks better one): merge lists every field explicitly with never-blank rules; Cases 4, 5, 6, 7.
- **T-111-30** (upsert per-frame thrash): field-for-field idempotence guard; Case 3.
- **T-111-31** (stale localStorage rehydrate): FLEET_CACHE_KEY stays v4 (unbumped); `writeFleetSessionsCache` whitelist unchanged; `isFleetSession` unchanged.
- **T-111-SC** (npm installs): zero packages installed.

## Self-Check: PASSED

All modified files confirmed present:
- `src/ui/state/conversation-store.ts` — modified (upsertFleetSession + exports)
- `src/ui/state/conversation-store.test.ts` — modified (12 new cases, 0 deletions)
- `src/ui/AppShell.tsx` — modified (hostsByIdRef, upsertFleetSession call, removeFleetSession in onGone)

All commits confirmed:
- `c6a0a75f` — Task 1 (upsertFleetSession)
- `5d7f149a` — Task 2 (12-case test suite)
- `ed0cb23c` — Task 3 (AppShell wiring)
