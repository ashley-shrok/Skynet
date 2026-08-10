---
phase: quick-260810-oig
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/AppShell.tsx
autonomous: true
requirements:
  - QUICK-260810-OIG-01

must_haves:
  truths:
    - "After a successful tmux kill, the killed row disappears from the conversation list immediately (no page reload required)"
    - "The killed fleet session is also removed from the localStorage fleet cache so a page reload does not briefly re-surface the stale row"
    - "removeFleetSession is idempotent — calling it with a (hostId, sessionName) tuple not present in state.fleetSessions is a no-op (no notify, no cache write, no throw)"
    - "removeFleetSession is selective — only the (hostId, sessionName) tuple that matches BOTH axes is removed; sibling sessions with same hostId+different name, or same name+different hostId, remain"
    - "A localStorage.setItem failure during cache trim does NOT block the in-memory state update — state still transitions and notify() still fires"
    - "openTabs-derived rows (closeTab path) continue to work unchanged — removeFleetSession is a no-op for those rows and does not double-remove"
  artifacts:
    - path: "src/ui/state/conversation-store.ts"
      provides: "removeFleetSession(hostId, sessionName) exported mutator"
      contains: "export function removeFleetSession"
    - path: "src/ui/AppShell.tsx"
      provides: "onKillRow closure that calls removeFleetSession after successful kill"
      contains: "removeFleetSession(parseInt"
    - path: "src/ui/state/conversation-store.test.ts"
      provides: "R1-R4 tests for removeFleetSession behavior"
      contains: "describe(\"conversation-store"
  key_links:
    - from: "src/ui/AppShell.tsx onKillRow"
      to: "conversation-store.removeFleetSession"
      via: "direct import + call after closeTab, inside try, before catch"
      pattern: "removeFleetSession\\(parseInt\\(row\\.host\\.id"
    - from: "conversation-store.removeFleetSession"
      to: "writeFleetSessionsCache"
      via: "cache trim after in-memory state transition"
      pattern: "writeFleetSessionsCache\\(nextFleetSessions\\)"
---

<objective>
Follow-up to shipped patch #387 (quick-260810-n3a: Kill context-menu item on
fleet-synthetic rows). Kill terminates the tmux session on the host, but the
row keeps rendering in the conversation list until a page reload because
non-identity throwaway rows are fleet-synthetic (sourced from
state.fleetSessions), and closeTab only removes openTabs-derived rows.

Fix: add a `removeFleetSession(hostId, sessionName)` mutator to
conversation-store.ts that filters state.fleetSessions AND trims the
localStorage cache. AppShell.onKillRow calls it after the successful kill so
the row disappears immediately without waiting for the next mount-effect
getSessionList() fetch (which only fires on page reload — the fleet fetch is
one-shot per mount by design, per Phase 7 shape lock).

Purpose: Complete the Kill UX. Kill in the context menu should visibly remove
the row on click, matching user expectation. Right now the tmux session dies
on the host but the UI stays stale until refresh, which reads as broken.

Output: Frontend-only change. New store export + one-line AppShell wiring +
targeted store tests. No backend, no docker, no push — orchestrator ships.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
# Task context
This is a small, fully-specified follow-up. Diagnosis is DONE — do NOT
re-investigate root cause. All required source excerpts are inline in the
tasks below.

# Files to modify
@src/ui/state/conversation-store.ts
@src/ui/AppShell.tsx
@src/ui/state/conversation-store.test.ts

# Patterns to mirror
- `updateFleetSessions` (conversation-store.ts ~line 794): mutator shape,
  same-content skip pattern, notify() firing pattern, `state = { ...state, ...}`
  reassignment.
- `writeFleetSessionsCache` (conversation-store.ts ~line 900): silent
  try/catch failure policy for localStorage writes.
- Test 27 (conversation-store.test.ts line 898): `__subscribeForTest(cb)` +
  `expect(cb).toHaveBeenCalledTimes(N)` pattern for asserting notify()
  fired / did not fire.
- Storage mocking: `vi.spyOn(Storage.prototype, "setItem")` (conversation-store.test.ts ~line 1529).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add removeFleetSession mutator to conversation-store.ts + tests R1-R4</name>
  <files>src/ui/state/conversation-store.ts, src/ui/state/conversation-store.test.ts</files>
  <behavior>
    - R1 (removes present tuple): Prime state via updateFleetSessions with two sessions {hostId:1, sessionName:"work"} and {hostId:2, sessionName:"idle"}. Subscribe with __subscribeForTest. Call removeFleetSession(1, "work"). Assert: __getFleetOnlyRowsForTest no longer contains a row for (1,"work") but does contain (2,"idle"). Assert: subscribe callback fired exactly 1 time. Assert: writeFleetSessionsCache (via `vi.spyOn(Storage.prototype, "setItem")` filtered for the FLEET_CACHE_KEY "skynet:convo-fleet-cache:v1") called with a JSON payload whose parsed array length is 1 and contains only the surviving session.
    - R2 (idempotent no-op for absent tuple): Prime state with one session {hostId:1, sessionName:"work"}. Subscribe. Spy on Storage.setItem. Call removeFleetSession(99, "nonexistent"). Assert: state.fleetSessions unchanged (still contains the primed session — check via __getFleetOnlyRowsForTest or __getSnapshotForTest). Assert: subscribe callback NOT fired (0 calls). Assert: no setItem call for FLEET_CACHE_KEY.
    - R3 (selectivity on both axes): Prime state with THREE sessions: {hostId:1, sessionName:"work"}, {hostId:1, sessionName:"idle"} (same host, different name), {hostId:2, sessionName:"work"} (different host, same name). Call removeFleetSession(1, "work"). Assert: only the (1,"work") session is gone; both (1,"idle") and (2,"work") remain.
    - R4 (cache-write failure does not block state update): Prime state with one session. Mock Storage.prototype.setItem to throw ("QuotaExceededError"). Subscribe. Call removeFleetSession(1, "work"). Assert: no error propagates (call returns cleanly). Assert: state.fleetSessions IS trimmed (in-memory update happened despite cache write failure). Assert: subscribe callback fired exactly 1 time.
  </behavior>
  <action>
Add a new exported function `removeFleetSession` to
src/ui/state/conversation-store.ts, placed IMMEDIATELY AFTER the
`updateFleetSessions` function (around line 830, before the "FleetSession
localStorage cache" section header comment). This keeps it adjacent to its
sibling mutator so future readers find both in one hop.

Exact signature and body:

```
/**
 * Surgically remove one FleetSession from state (by hostId + sessionName)
 * AND trim it out of the localStorage cache so a page reload does not briefly
 * re-show the row from stale cache before the next getSessionList() resolves.
 *
 * Idempotent no-op when the (hostId, sessionName) tuple is not present in
 * state.fleetSessions — same shape as updateFleetSessions' same-content
 * short-circuit (skip notify(), skip cache write).
 *
 * Used by AppShell.onKillRow (quick-260810-oig) after a successful tmux
 * kill-session so the fleet-synthetic row disappears immediately without
 * waiting for a page reload. Companion to closeTab, which only removes
 * openTabs-derived rows; non-identity throwaway rows are fleet-synthetic and
 * closeTab is a no-op for them.
 */
export function removeFleetSession(hostId: number, sessionName: string): void {
  const nextFleetSessions = state.fleetSessions.filter(
    (s) => !(s.hostId === hostId && s.sessionName === sessionName),
  );
  // No-op path: tuple was not present — no state mutation, no cache write, no notify.
  if (nextFleetSessions.length === state.fleetSessions.length) return;

  state = { ...state, fleetSessions: nextFleetSessions };
  notify();

  // Cache trim. Silent on write failure — mirrors writeFleetSessionsCache's
  // own failure policy. Do NOT block or unwind the in-memory update if the
  // cache write throws (localStorage quota, disabled storage, private mode).
  try {
    writeFleetSessionsCache(nextFleetSessions);
  } catch {
    // Silent — cache-write failure is non-fatal; next getSessionList() fetch
    // on the next page load will re-persist the fresh (post-kill) snapshot.
  }
}
```

Note: `writeFleetSessionsCache` is defined LATER in the file (~line 900).
JS hoisting makes this reference legal at call time. If TypeScript complains
about use-before-declare, hoist the try/catch call into a locally-declared
arrow that captures `nextFleetSessions` — but first attempt should work as
written since function declarations are hoisted.

Then add the R1-R4 tests to
src/ui/state/conversation-store.test.ts. Place them in a new
`describe("conversation-store (quick-260810-oig): removeFleetSession", ...)`
block located IMMEDIATELY AFTER the existing Test 27
(`describe("conversation-store (Plan 07-01): updateFleetSessions no-op guards", ...)`
at line 898) so the two related mutators live adjacent in the file.

Import `removeFleetSession` at the top of the test file in the existing
import block from `"./conversation-store.js"` (alongside `updateFleetSessions`
on line 16).

Use the fixture patterns already in this file:
  - `FleetSession` literal objects with the 4 canonical fields (see line 900-902 for shape).
  - `__subscribeForTest(cb)` + `expect(cb).toHaveBeenCalledTimes(N)` for notify assertions.
  - `__getFleetOnlyRowsForTest()` OR `__getSnapshotForTest()` for state-shape assertions.
  - `vi.spyOn(Storage.prototype, "setItem")` for cache-write observations (mirroring line 1529).

For R1 cache assertion: filter `spy.mock.calls` for calls where the first arg equals `"skynet:convo-fleet-cache:v1"` (the FLEET_CACHE_KEY constant — value inlined; do NOT export the constant just for the test). Parse the second arg (JSON string) and assert length + surviving session.

For R4: use `spy.mockImplementation(() => { throw new Error("QuotaExceededError"); })` scoped to the setItem spy, then restore via `spy.mockRestore()` in a finally.

Do NOT invent a new mock strategy. Do NOT wrap `writeFleetSessionsCache` in a
`vi.mock()` — the Storage.setItem spy is the existing idiom and it exercises
the real writeFleetSessionsCache try/catch path (which is exactly what R4
needs to validate).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tanya && npx vitest run src/ui/state/conversation-store.test.ts</automated>
  </verify>
  <done>
- `removeFleetSession` exported from conversation-store.ts, placed after updateFleetSessions
- 4 new tests (R1-R4) added in a dedicated describe block after Test 27
- All 4 new tests pass; existing conversation-store.test.ts tests still pass (no regressions)
- No TypeScript errors (function-hoisting reference to writeFleetSessionsCache resolves cleanly)
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire removeFleetSession into AppShell.onKillRow + full test/build verification</name>
  <files>src/ui/AppShell.tsx</files>
  <action>
Two edits in src/ui/AppShell.tsx:

**Edit 1 — Import (~line 56):** Add `removeFleetSession` to the existing
import block from `"@/state/conversation-store"`. It currently imports
`updateFleetSessions` on line 56; add `removeFleetSession` immediately after
it (alphabetize-adjacent is fine but not required — just mirror the local
convention of adjacent related mutators).

**Edit 2 — onKillRow closure (~line 1508):** After the existing
`closeTab(row.id);` line (currently line 1526) and BEFORE the `} catch (err) {`
line, add:

```
removeFleetSession(parseInt(row.host.id, 10), row.targetTmuxSession);
```

The row.host and row.targetTmuxSession guards at the top of the closure
(currently line 1514) already narrow both to non-null before the try block,
so no additional guarding is needed inside try.

Rationale for placement (INSIDE try, AFTER closeTab, BEFORE catch):
  - INSIDE try: If closeTab were to throw (it should not in practice), we
    skip removeFleetSession — the next page reload will drop the row when
    getSessionList() returns without it. Acceptable degradation.
  - AFTER closeTab: closeTab handles openTabs-derived rows; removeFleetSession
    handles fleet-synthetic rows. Both are idempotent no-ops for the "other"
    row type. Typical row is one type or the other; the double call costs
    ~nothing when either mutator's target set does not contain the row.
  - BEFORE catch: The kill has already succeeded at this point (killTmuxSession
    resolved). If the local state cleanup somehow throws, we still want the
    user-visible error path (window.alert) to fire — but neither closeTab nor
    removeFleetSession are expected to throw in practice.

Do NOT add a new AppShell test file. Panel-level tests K8-K10 in
PrettyConversationsPanel.test.tsx already verify the onKillRow prop wiring
(confirm dialog + prop invocation with the correct row). The Task 1 store
tests (R1-R4) verify removeFleetSession behavior in isolation. The AppShell
onKillRow closure is 6 lines of glue between those two well-tested layers;
adding a full AppShell integration test would cost significant context for
minimal marginal coverage. If a lightweight assertion becomes cheap later,
extend an existing AppShell.persistence.test.tsx case — but do NOT expand
scope for this quick task.

After code edits, run the full test suite + both build commands as
gate-blocking verification steps.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tanya && npx vitest run &amp;&amp; npm run build:backend &amp;&amp; npm run build</automated>
  </verify>
  <done>
- `removeFleetSession` imported in AppShell.tsx alongside updateFleetSessions
- `removeFleetSession(parseInt(row.host.id, 10), row.targetTmuxSession);` present in onKillRow closure after closeTab, inside try
- Full `npx vitest run` EXIT 0 (no regressions in any test file)
- `npm run build:backend` EXIT 0 (backend build smoke test — no exit-code masking via | tail or | head)
- `npm run build` EXIT 0 (frontend build)
- NO push, NO docker build, NO docker compose up — stop after builds green
  </done>
</task>

</tasks>

<verification>
Full-suite verification is performed as Task 2's `<automated>` step. The
chained command sequence (`npx vitest run && npm run build:backend && npm run build`)
requires all three to exit 0 in sequence; any failure stops the chain and
must be fixed before the task is marked done.

Manual verification is out of scope for this executor. Orchestrator (tanya)
handles the docker build + compose up + smoke test on ship.
</verification>

<success_criteria>
- removeFleetSession export exists in conversation-store.ts with the exact signature and behavior specified in Task 1
- 4 new store tests (R1-R4) pass, covering: happy-path removal + cache trim, idempotent no-op for absent tuple, selectivity on both hostId and sessionName axes, resilience to cache-write failure
- AppShell.onKillRow calls removeFleetSession(hostId, sessionName) after closeTab on successful kill
- Full `npx vitest run` EXIT 0 (no regressions)
- `npm run build:backend` EXIT 0
- `npm run build` EXIT 0
- No git worktree activity — all work committed on feat/tab-title-from-tmux in ~/skynet-tanya
- No push, no docker build, no docker compose up
</success_criteria>

<output>
Create `.planning/quick/260810-oig-kill-remove-fleet-synthetic-row/260810-oig-SUMMARY.md` when done, following the template at $HOME/.claude/get-shit-done/templates/summary.md. Capture:
  - Files modified with line counts
  - Test additions (R1-R4 describe block + any extensions)
  - Test suite result (must be EXIT 0)
  - Build results (both backend + frontend must be EXIT 0)
  - Any unexpected findings during implementation
  - Explicit statement that NO push and NO docker were performed
</output>
