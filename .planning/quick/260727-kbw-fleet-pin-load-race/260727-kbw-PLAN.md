---
task: 260727-kbw-fleet-pin-load-race
type: quick
mode: quick
autonomous: true
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx

must_haves:
  truths:
    - "On page load, a fleet-row pin persisted server-side (e.g. fleet::7::aqua) survives the first background updateOpenTabs after hydration, and remains visible in the pinned tier until Ashley unpins."
    - "Panel mount does NOT call getPinnedIds until state.fleetSessionsLoaded === true."
    - "Once fleetSessionsLoaded flips true, panel calls getPinnedIds exactly once per mount (hydratedRef gate); subsequent renders do not re-fire the fetch."
    - "updateFleetSessions([]) with an empty array still counts as loaded — users with zero fleet sessions unblock hydration."
  artifacts:
    - path: "src/ui/state/conversation-store.ts"
      provides: "fleetSessionsLoaded state field + updateFleetSessions setter flip + getFleetSessionsLoadedSnapshot + useFleetSessionsLoaded hook"
      contains: "fleetSessionsLoaded"
      exports: ["useFleetSessionsLoaded"]
    - path: "src/ui/state/conversation-store.test.ts"
      provides: "Unit coverage for the flag field, the setter flip semantics (empty + non-empty), the notify() firing when flag flips false→true, the useFleetSessionsLoaded hook, and the regression test that fleet pins survive updateOpenTabs([]) when hydrated after fleet load."
      contains: "fleet::7::aqua"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "Fleet-loaded-gated mount effect for pinnedIds hydration (replaces empty-deps effect at 204-218)"
      contains: "useFleetSessionsLoaded"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx"
      provides: "Test asserting getPinnedIds is NOT called while fleetSessionsLoaded=false, and IS called exactly once when it flips to true."
      contains: "useFleetSessionsLoaded"
  key_links:
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (mount effect)"
      to: "src/ui/state/conversation-store.ts (useFleetSessionsLoaded)"
      via: "subscription gates the fetch-then-hydrate IIFE"
      pattern: "useFleetSessionsLoaded\\(\\)"
    - from: "src/ui/state/conversation-store.ts (updateFleetSessions)"
      to: "src/ui/state/conversation-store.ts (state.fleetSessionsLoaded)"
      via: "unconditional flag set on first call; notify() fires on false→true even for identical-sessions no-op"
      pattern: "fleetSessionsLoaded\\s*[:=]\\s*true"
---

<objective>
Close the Phase 15 fleet-pin load-order race: pins persisted server-side must survive a page refresh. The current empty-deps mount effect in PrettyConversationsPanel fires getPinnedIds() in a microtask while state.fleetSessions is still empty; the next routine updateOpenTabs prunes the freshly-hydrated fleet pin because fleetPinKeepSet is empty. Fix: gate the panel's fetch-then-hydrate on a new store flag (fleetSessionsLoaded) that flips true the first time updateFleetSessions is called. When gated, the pruner's fleetPinKeepSet is always populated before pinnedIds is populated, and the race window is closed.

Purpose: Ashley's server-authoritative pin persistence (shipped Phase 15, 14:20 UTC) is unusable for fleet-row pins today. Ashley's own UAT flagged it; the server side is verified correct. This is a client-side ordering fix.

Output: Store gains one boolean + one hook; panel mount effect gains a gate + a ref-based dedupe. Two test files gain regression + hook coverage. No skynet-patches.md write-up (folds into pending backlog flush per identity-file rule).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/state/conversation-store.ts
@src/ui/state/conversation-store.test.ts
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add fleetSessionsLoaded flag + useFleetSessionsLoaded hook to conversation-store, with tests</name>
  <files>src/ui/state/conversation-store.ts, src/ui/state/conversation-store.test.ts</files>
  <behavior>
    Store shape:
    - state.fleetSessionsLoaded: boolean, defaults false in the initial state at L176-184.

    updateFleetSessions() (currently at L611-629):
    - MUST set fleetSessionsLoaded: true on every call, unconditionally — including when the sessions array is empty (a user with zero fleet sessions still counts as "loaded").
    - MUST preserve the existing ref-equal and shallow no-op short-circuits for the sessions array itself.
    - CRITICAL semantic: if the flag is transitioning from false→true, notify() MUST fire even when the sessions array short-circuits as identical. In practice, the first call to updateFleetSessions always transitions the flag (since it starts false), so the very first call must always notify().
    - Subsequent calls where the flag is already true AND the sessions array is a ref/shallow no-op MUST remain full no-ops (do not gratuitously bump snapshotVersion).

    Hook surface (mirror usePinnedIds at L844-855):
    - getFleetSessionsLoadedSnapshot(): boolean — returns state.fleetSessionsLoaded. Primitive boolean is Object.is-safe; no memoization needed.
    - useFleetSessionsLoaded(): boolean — useSyncExternalStore(subscribe, getFleetSessionsLoadedSnapshot, getFleetSessionsLoadedSnapshot). Exported.

    Test additions in conversation-store.test.ts (import useFleetSessionsLoaded alongside the existing hook imports at L26-29):
    - "fleetSessionsLoaded starts false": read via __getSnapshotForTest or the new hook via renderHook; assert false at t=0.
    - "updateFleetSessions with a non-empty [{hostId, sessionName}] array flips fleetSessionsLoaded to true and fires one notify()": subscribe a listener spy, dispatch, assert listener called + hook returns true.
    - "updateFleetSessions with an empty [] array ALSO flips fleetSessionsLoaded to true and fires one notify()": critical case — empty counts as loaded.
    - "second updateFleetSessions call with the SAME ref array does NOT fire notify() (flag already true, sessions array ref-equal)": subscribe listener, dispatch same-ref twice, assert listener called exactly once total from these two dispatches.
    - "useFleetSessionsLoaded re-renders when the flag flips false→true": renderHook, assert false, act(() => updateFleetSessions([])), assert true.
    - REGRESSION for the exact bug — this is the load-bearing test:
      Sequence:
        1. updateFleetSessions([{ hostId: 7, sessionName: "aqua" }])  // fleet loads first, mirroring the fixed order
        2. hydratePinnedIdsFromServer(["fleet::7::aqua"])
        3. updateOpenTabs([])  // routine empty tab-list re-emission
      Assert: state.pinnedIds (via __getSnapshotForTest / usePinnedIds hook) STILL contains "fleet::7::aqua".
      Rationale: pre-fix, if hydrate happened before updateFleetSessions, updateOpenTabs pruner would have nuked the pin because fleetPinKeepSet would have been empty. This test locks the post-fix invariant that once the panel gates properly, the pruner sees the fleet id in fleetPinKeepSet and keeps it.
      NOTE: this test does NOT itself exercise the panel gate — it locks the store-level invariant that IF the ordering is correct (fleet first, then hydrate), the pin survives. The panel test in Task 2 locks the ordering itself.
  </behavior>
  <action>
    Edit src/ui/state/conversation-store.ts:
    1. Add fleetSessionsLoaded: boolean to the State type (append after activeSet at L173 for locality with the other flags; or place adjacent to fleetSessions at L155 for topical grouping — pick the topical grouping since it's the domain-related flag).
    2. Add fleetSessionsLoaded: false to the initial state literal at L176-184, in the same relative position.
    3. Modify updateFleetSessions (starts L611). Restructure to compute the shallow no-op result FIRST but do not early-return purely on it — the flag transition can force a notify. Concretely:
       - Compute sessionsRefEqual = (sessions === state.fleetSessions).
       - Compute sessionsShallowEqual = ref-equal OR (same length AND every element ref-equal) — folding in the existing L617-625 shallow check.
       - Compute needsFlagFlip = !state.fleetSessionsLoaded.
       - If sessionsShallowEqual && !needsFlagFlip → return (full no-op, preserves current fast-path semantics).
       - Else build the new state object. sessions field: if sessionsShallowEqual, reuse state.fleetSessions; else use the new array. Always set fleetSessionsLoaded: true.
       - Assign state and call notify().
    4. Add getFleetSessionsLoadedSnapshot() + export useFleetSessionsLoaded() adjacent to usePinnedIds at L844-855, mirroring its shape verbatim (primitive returning-snapshot; useSyncExternalStore call).
    5. Add a short block comment above the new hook explaining WHY it exists (load-order race with updateOpenTabs pruner + panel mount effect gate) — reference the quick-task slug 260727-kbw so future readers grep-find it alongside the panel change.

    Edit src/ui/state/conversation-store.test.ts:
    6. Add useFleetSessionsLoaded to the import block at L13-37.
    7. Add a new describe block (e.g. "fleetSessionsLoaded flag + useFleetSessionsLoaded hook (quick-260727-kbw)") holding the tests listed in <behavior>. Mirror the existing renderHook + act patterns; use __subscribeForTest + __getSnapshotForTest for direct-state assertions.
    8. Add the regression test in its own describe block ("regression: fleet pin survives updateOpenTabs pruner when hydrated after fleet load (quick-260727-kbw)").
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/ui/state/conversation-store.test.ts</automated>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -n "fleetSessionsLoaded" src/ui/state/conversation-store.ts | grep -v '^[[:space:]]*#' &amp;&amp; grep -cE "fleetSessionsLoaded" src/ui/state/conversation-store.ts | awk '$1 &gt;= 4 { exit 0 } { exit 1 }'</automated>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -n "useFleetSessionsLoaded" src/ui/state/conversation-store.ts</automated>
  </verify>
  <done>
    - fleetSessionsLoaded exists in State type + initial state (default false).
    - updateFleetSessions sets it true unconditionally on every call (empty and non-empty).
    - First-call flag flip triggers notify() even when sessions array is a shallow no-op.
    - Second-call same-ref sessions with flag already true is a full no-op (no notify).
    - useFleetSessionsLoaded exported, subscribes via useSyncExternalStore with primitive snapshot.
    - All new tests pass; existing tests in conversation-store.test.ts still pass.
    - Regression test locks: fleet::7::aqua survives updateOpenTabs([]) when hydrated after fleet loaded.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Gate PrettyConversationsPanel mount hydration on fleetSessionsLoaded + hydratedRef, with test</name>
  <files>src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx, src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</files>
  <behavior>
    Panel effect (currently L204-218) MUST:
    - Read useFleetSessionsLoaded() at the top of the component (alongside the other store hooks at L46-53 or near the existing effect).
    - Maintain a useRef&lt;boolean&gt; (hydratedRef, default false) that guards against re-hydration even if the flag were to flip back-and-forth (defense-in-depth per the bug spec).
    - Inside the useEffect body: if !fleetSessionsLoaded → return early. If hydratedRef.current → return early. Otherwise set hydratedRef.current = true, then run the existing async IIFE (getPinnedIds → hydratePinnedIdsFromServer, silent-catch, cancel-token). Keep the cleanup that sets cancelled = true.
    - Depend on [fleetSessionsLoaded] (not empty deps).

    Preserve/adapt the existing (a)/(b)/(c) block comment above the effect at L188-203 (fetch-then-hydrate rationale + silent-catch + cancel-token). Add a new paragraph (d) explaining the fleet-loaded gate + the exact race it closes (updateOpenTabs pruner running with pinnedIds populated but fleetPinKeepSet empty), reference the quick-task slug 260727-kbw.

    New test in PrettyConversationsPanel.test.tsx (numbering: whichever is next — Test 22 based on the file's current terminal test at L1267 being Test 21):
    - Add useFleetSessionsLoaded to the mocked conversation-store module at L127-150. Back it with a mutable module-level let mockFleetSessionsLoaded: boolean; the mock's implementation reads that variable each call. beforeEach resets it to false.
    - Test title: "Test 22 (quick-260727-kbw): mount does NOT call getPinnedIds while fleetSessionsLoaded=false; DOES call once after it flips to true"
    - Setup: mockFleetSessionsLoaded = false. Render the panel with a minimal snapshot (same shape as Test 21 at L1276-1286, e.g. one hostA row). Assert vi.mocked(getPinnedIds) has NOT been called.
    - Flip: mockFleetSessionsLoaded = true, then trigger a rerender (either rerender() from render's return or by re-invoking render — mirror the pattern used elsewhere in this file if one exists; else use rerender from RTL).
    - Assert (await waitFor): vi.mocked(getPinnedIds) called exactly once; hydratePinnedIdsFromServerSpy called exactly once with the fixture ids.
    - Second flip / third render: mockFleetSessionsLoaded stays true, rerender again → assert getPinnedIds STILL called exactly once (hydratedRef dedupe holds).
  </behavior>
  <action>
    Edit src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:
    1. Add useRef to the react import at L42 ("useEffect, useRef, useState").
    2. Add useFleetSessionsLoaded to the conversation-store import block at L46-53.
    3. Inside the component (near the existing usePinnedIds / useSelectedConversationId hook calls), add:
       const fleetSessionsLoaded = useFleetSessionsLoaded();
       const hydratedRef = useRef(false);
    4. Replace the existing mount effect at L204-218 with the fleet-loaded-gated version:
       useEffect(() =&gt; {
         if (!fleetSessionsLoaded) return;
         if (hydratedRef.current) return;
         hydratedRef.current = true;
         let cancelled = false;
         (async () =&gt; {
           try {
             const ids = await getPinnedIds();
             if (cancelled) return;
             hydratePinnedIdsFromServer(ids);
           } catch {
             // Silent — pinnedIds stays as-is; next remount refetches.
           }
         })();
         return () =&gt; { cancelled = true; };
       }, [fleetSessionsLoaded]);
    5. Update the block comment above the effect: keep (a)(b)(c) verbatim (or lightly adjust wording — do NOT strip the Phase 15 rationale). Add (d): "quick-260727-kbw fleet-loaded gate — the fetch-then-hydrate IIFE is deferred until useFleetSessionsLoaded() returns true so that the first background updateOpenTabs after hydration has a populated fleetPinKeepSet (from state.fleetSessions) and does NOT nuke freshly-hydrated fleet pins via the pruner at conversation-store.ts L536-547. hydratedRef guards defense-in-depth against a hypothetical false→true→false→true flip (Ashley confirmed the flag stays true after first flip, but the ref costs nothing)."

    Edit src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx:
    6. Add mockFleetSessionsLoaded (module-level let) near mockActiveSet at L125.
    7. In the vi.mock("@/state/conversation-store", ...) factory at L127-150, add: useFleetSessionsLoaded: () =&gt; mockFleetSessionsLoaded.
    8. Reset mockFleetSessionsLoaded = false in the file's beforeEach (find the existing beforeEach — mirror the mockActiveSet reset).
    9. Append a new describe block after Test 21 (the current terminal test at L1266-1304): "PrettyConversationsPanel (quick-260727-kbw): mount hydration gated on fleetSessionsLoaded" with the single Test 22 described in <behavior>. Reuse the Test 21 fixture pattern (getPinnedIds mockResolvedValueOnce, makeHost, setSnapshot).
    10. Use render(...).rerender(...) from @testing-library/react to trigger re-render after mutating mockFleetSessionsLoaded. If rerender isn't already imported in this file's destructure at L29, add it.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx</automated>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -nE "useFleetSessionsLoaded|hydratedRef" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx</automated>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -c "!fleetSessionsLoaded" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx | awk '$1 &gt;= 1 { exit 0 } { exit 1 }'</automated>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx tsc --noEmit</automated>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run</automated>
  </verify>
  <done>
    - Panel imports useFleetSessionsLoaded from the store and useRef from react.
    - Mount effect gates on fleetSessionsLoaded === true before invoking getPinnedIds.
    - hydratedRef prevents duplicate hydration across re-renders.
    - Effect deps are [fleetSessionsLoaded], not [].
    - Block comment updated with a (d) paragraph explaining the fleet-loaded gate + race closure.
    - New Test 22 passes: getPinnedIds not called while flag false, called once after flip, still once after further re-renders.
    - hydratePinnedIdsFromServerSpy called exactly once with the fixture ids after flip.
    - Full test suite (npx vitest run) green.
    - Typecheck (npx tsc --noEmit) clean.
  </done>
</task>

</tasks>

<verification>
Overall gate — run from repo root /home/ubuntu/skynet:

- Typecheck: `npx tsc --noEmit` exits 0.
- Full test suite: `npx vitest run` exits 0.
- Store surface grep:
  - `grep -n "fleetSessionsLoaded" src/ui/state/conversation-store.ts` shows: State type field, initial-state entry, updateFleetSessions setter, snapshot getter, hook definition. (≥ 4 non-comment hits.)
  - `grep -n "export function useFleetSessionsLoaded" src/ui/state/conversation-store.ts` shows exactly one match.
- Panel surface grep:
  - `grep -n "useFleetSessionsLoaded" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` shows import + call site.
  - `grep -n "hydratedRef" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` shows the ref creation + guard.
  - `grep -n "if (!fleetSessionsLoaded)" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` shows the gate.
- Regression assertion holds: the conversation-store.test.ts regression test proves fleet::7::aqua survives updateOpenTabs([]) when hydrated after updateFleetSessions.
- Panel gate assertion holds: Test 22 proves getPinnedIds fires zero times pre-flip, once post-flip, still once after re-render.
</verification>

<success_criteria>
- All must_haves.truths verifiable by the added automated tests.
- All must_haves.artifacts present with the declared exports/contents.
- Both must_haves.key_links greppable.
- No changes to skynet-patches.md (per identity-file rule; this quick fix folds into the pending backlog flush).
- No other files touched beyond the four in files_modified.
</success_criteria>

<output>
Report completion at conversation end. No SUMMARY.md required for quick-mode tasks unless the executor's workflow demands one — follow /gsd-quick conventions.
</output>
