---
phase: quick-260730-qbl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/state/session-recycling-store.ts
  - src/ui/state/session-recycling-store.test.ts
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
autonomous: true
requirements:
  - QBL-01  # recycling detection located (showOverlay in PrettyView.tsx)
  - QBL-02  # recycling wired into ready-dot gate (row-level !isRecycling conjunct + panel forwarding)
  - QBL-03  # test added asserting suppression on isRecycling=true

must_haves:
  truths:
    - "A pretty-conversation row whose pretty-view surface is currently rendering SessionHoldingOverlay (showOverlay=true) does NOT render its ready-for-attention dot, regardless of inActiveSet/isWorking state."
    - "The row-level JS gate for the ready-dot is `inActiveSet && isWorking === false && !isRecycling`."
    - "The store pattern mirrors session-working-store byte-for-byte: module-scoped Map, useSyncExternalStore hook, publisher useEffect in the surface component keyed on `${hostId}:${tmuxSession ?? ''}`."
    - "tsc --noEmit exits 0 and full vitest suite reports 0 failed."
  artifacts:
    - path: "src/ui/state/session-recycling-store.ts"
      provides: "publishSessionRecycling, useSessionRecycling, getSessionRecyclingSnapshot, __resetForTest"
      exports: ["publishSessionRecycling", "useSessionRecycling", "getSessionRecyclingSnapshot", "__resetForTest"]
    - path: "src/ui/state/session-recycling-store.test.ts"
      provides: "5 vitest cases covering round-trip / unknown-key / null-key / multi-key / no-op-notify"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "publisher useEffect on [showOverlay, hostId, tmuxSession] calling publishSessionRecycling"
    - path: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      provides: "PrettyConversationRowLive reads useSessionRecycling(sessionKey) and forwards isRecycling to <PrettyConversationRow>"
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      provides: "isRecycling?: boolean prop; extended dot gate `inActiveSet && isWorking === false && !isRecycling`; `recycling` classname when isRecycling===true"
    - path: "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx"
      provides: "New test: inActiveSet=true, isWorking=false, isRecycling=true -> queryByLabelText('ready') is null"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx (showOverlay useState)"
      to: "src/ui/state/session-recycling-store.ts (publishSessionRecycling)"
      via: "useEffect on [showOverlay, hostId, tmuxSession]"
      pattern: "publishSessionRecycling\\("
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (PrettyConversationRowLive)"
      to: "src/ui/state/session-recycling-store.ts (useSessionRecycling)"
      via: "hook call at top of PrettyConversationRowLive alongside useSessionWorking"
      pattern: "useSessionRecycling\\("
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx"
      via: "isRecycling prop forwarding (coerced to boolean via `isRecycling === true`)"
      pattern: "isRecycling="
    - from: "src/ui/features/pretty-conversations/PrettyConversationRow.tsx (dot gate)"
      to: "isRecycling prop"
      via: "`!isRecycling` conjunct in JSX render condition at ~line 528"
      pattern: "!isRecycling"
---

<objective>
Hide the pretty-conversations idle "ready-for-attention" dot on rows whose session-recycling overlay (SessionHoldingOverlay, patch #74) is currently visible on their pretty-view surface. Extend the existing row-level dot gate (`inActiveSet && isWorking === false`, patch #137) with a `!isRecycling` conjunct, sourced from a new session-recycling-store that mirrors the patch #137 session-working-store byte-for-byte in structure.

Purpose: A row whose pretty-view surface is showing the "session recycling..." overlay is NOT ready for Ashley's next instruction; showing the ready-dot on such a row is a false-positive signal. Correct that.

Output: New store module + tests + publisher wiring in PrettyView + consumer wiring in PrettyConversationsPanel + gate extension in PrettyConversationRow + new suppression test. Ships as two atomic commits.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md

# The pattern being mirrored — read verbatim before copying its shape.
@src/ui/state/session-working-store.ts
@src/ui/state/session-working-store.test.ts

# Publisher pattern — Terminal.tsx lines 240-290 shows the reference publish useEffect
# that the new PrettyView.tsx publisher must mirror (deliberately NO cleanup, comment
# header cites the originating patch).

# Consumer pattern — PrettyConversationsPanel.tsx lines 55-125 shows the
# PrettyConversationRowLive wrapper that already reads useSessionWorking + forwards
# isWorking; the new isRecycling read + forward slots in beside it.

# Row prop interface + dot gate — PrettyConversationRow.tsx lines 90-160 shows the
# props interface where isRecycling?: boolean is added; lines 495-545 shows the
# ready-dot JSX where !isRecycling is added to the gate.

# CSS gate (defense-in-depth) — pretty-conversations.css line 463:
#   `.pv-row.active-set:not(.working) .pv-ready-dot { display: block }`
# extend to `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot`.
# The rowClassName cn() call at PrettyConversationRow.tsx:325-334 already lists
# every state as a className toggle — add `isRecycling === true && "recycling"`
# alongside the existing `isWorking === true && "working"`.

# Existing test file to append to — PrettyConversationRow.test.tsx uses a
# per-test inline render; new test follows Test 15's shape (no shared factory
# to extend, just add default isRecycling to existing tests as needed — but
# because the prop is optional and defaults to `undefined` (falsy in the
# `!isRecycling` gate), existing tests need NO changes).
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create session-recycling-store module + its vitest coverage</name>
  <files>
    src/ui/state/session-recycling-store.ts,
    src/ui/state/session-recycling-store.test.ts
  </files>
  <behavior>
    - publish(true) -> hook returns true; publish(false) -> hook returns false; publish(null) -> hook returns null (overwrite, not delete).
    - useSessionRecycling on a never-published key returns null.
    - useSessionRecycling(null) short-circuits to null (no useSyncExternalStore subscribe work required, hook is still called at stable position).
    - Multiple distinct keys are independent — publishing to key A does NOT alter key B's snapshot.
    - No-op guard: publishSessionRecycling(k, v) twice in a row does NOT double-notify listeners (subscribe callback should be invoked exactly once for the initial publish + not again for the redundant second publish).
  </behavior>
  <action>
    Create src/ui/state/session-recycling-store.ts as a byte-for-byte structural mirror of src/ui/state/session-working-store.ts with these substitutions:

    Naming:
    - Type name / hook name / publisher name / snapshot name / semantic doc references all rename working -> recycling.
    - Public API: publishSessionRecycling(key: string, isRecycling: boolean | null), useSessionRecycling(key: string | null): boolean | null, getSessionRecyclingSnapshot(), __resetForTest().

    Semantic doc header (adapt from working-store's header):
    - Cite THIS bounty (quick-260730-qbl hide-idle-dot-when-session-recycling-overlay-active) instead of patch #137.
    - Cite the ORIGINATING patch as patch #74 (SessionHoldingOverlay) — reader must understand recycling means "overlay currently visible in pretty-view", NOT "isHolding" and NOT "isRecycling in some other sense".
    - Semantics table: true = overlay visible on this key's pretty-view pane; false = overlay not visible; null = never observed (pane never mounted OR PrettyView never mounted for this session yet).
    - Publisher: driven by PrettyView.tsx's `showOverlay` state (the delay-armed patch #74 gate at PrettyView.tsx:869-880), NOT `isHolding` directly.
    - Consumer: driven by PrettyConversationsPanel's PrettyConversationRowLive alongside the existing useSessionWorking read.

    Storage rationale — copy verbatim from working-store (in-memory only, no persistence, page refresh resets, cross-tab isolation is a side benefit).

    No-op notify guard: same shape — `if (has && prev === isRecycling) return;` — distinguishing "never published" from "explicitly null" so a first-time null publish still fires.

    Hook: same shape — useSyncExternalStore with a getSnapshot closure that short-circuits when key===null; hook is always called at the same top-level position (Rules-of-Hooks compliance comment kept).

    Then create src/ui/state/session-recycling-store.test.ts mirroring src/ui/state/session-working-store.test.ts's 4-test shape PLUS a 5th test for the no-op notify guard:

    Test 1: publish -> hook round-trip through true / false / null on a single key. Assert overwrite-not-delete on the null publish.
    Test 2: useSessionRecycling on a never-published key returns null.
    Test 3: useSessionRecycling(null) short-circuits to null.
    Test 4: multi-key isolation — publish to h1:s1 must not alter h2:s2's snapshot; overwriting h1:s1 to null must not touch h2:s2.
    Test 5 (NEW vs working-store's 4): no-op notify guard — subscribe a listener via the store's internal `subscribe` (or, if not exported, assert indirectly by calling publishSessionRecycling(k, true) twice and using useSyncExternalStore's rerender count / renderHook's result-stability — simpler: use vi.fn() as a listener registered through a shim if store exposes one; if not, rely on renderHook rerender count NOT increasing on the duplicate publish. Concrete assertion pattern: track rerender count via a counter ref inside the hook wrapper — a spy React that counts renderHook invocations of the wrapping function). Simplest robust variant: publish (k, true); publish (k, true) again; assert hook value is still true and no error thrown; also assert the second publish did NOT bump some observable — since the store does not export snapshotVersion, the concrete test is: subscribe via a manual subscribe() call using a re-exported test-only alias OR assert renderHook `result.current` reference stability (React's useSyncExternalStore reuses the same snapshot object when notify does not fire — but for primitive booleans reference stability is trivially always the case, so this test is best written by wrapping the useSessionRecycling hook in `useRef(0)` + increment on every render and asserting the counter increments by 1 for the first publish and 0 for the redundant second publish). Use the counter-in-hook-wrapper pattern.

    beforeEach: call __resetForTest() (mirror working-store test).

    Imports: mirror working-store test — { describe, it, expect, beforeEach } from "vitest"; { renderHook, act } from "@testing-library/react".

    IMPORTANT — the import path in the test file MUST end in `.js` to match the working-store test's `./session-working-store.js` import — this is the ESM-with-.js-extension convention the codebase enforces.

    Nothing else touched in this task. This is commit (a).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/ui/state/session-recycling-store.test.ts</automated>
  </verify>
  <done>
    - src/ui/state/session-recycling-store.ts exists, exports publishSessionRecycling / useSessionRecycling / getSessionRecyclingSnapshot / __resetForTest, and is structurally identical to session-working-store.ts (same module-scoped state, same notify/subscribe pattern, same no-op guard, same short-circuit hook, same tree-shake-friendly comment on getSessionRecyclingSnapshot).
    - src/ui/state/session-recycling-store.test.ts exists with 5 tests, all passing under vitest.
    - vitest run of the new test file reports 0 failed.
    - No other files modified in this commit.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire publisher (PrettyView), consumer (Panel), gate (Row + CSS + test)</name>
  <files>
    src/ui/features/pretty-view/PrettyView.tsx,
    src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx,
    src/ui/features/pretty-conversations/PrettyConversationRow.tsx,
    src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx,
    src/ui/features/pretty-conversations/pretty-conversations.css
  </files>
  <behavior>
    - Publisher useEffect in PrettyView.tsx fires on any change to [showOverlay, hostId, tmuxSession] and calls publishSessionRecycling(`${hostId}:${tmuxSession ?? ""}`, showOverlay). Deliberately no cleanup.
    - PrettyConversationRowLive in PrettyConversationsPanel.tsx reads useSessionRecycling(sessionKey) at the top of the component (alongside useSessionWorking) and forwards `isRecycling={isRecycling === true}` to <PrettyConversationRow>.
    - PrettyConversationRow gates the ready-dot on `inActiveSet && isWorking === false && !isRecycling` — a row rendered with inActiveSet=true, isWorking=false, isRecycling=true renders NO span with data-pv-conv-ready-dot.
    - PrettyConversationRow adds `isRecycling === true && "recycling"` to its rowClassName cn() call so the CSS defense-in-depth gate can key off `.pv-row.recycling`.
    - CSS gate at line 463 extends from `.pv-row.active-set:not(.working) .pv-ready-dot { display: block }` to `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot { display: block }`.
    - Existing PrettyConversationRow tests (13, 14, 15, 16, 17) still pass — isRecycling is optional and defaults to undefined (falsy under the `!isRecycling` gate), so unchanged renders behave identically.
    - NEW test: inActiveSet=true, isWorking=false, isRecycling=true -> queryByLabelText("ready") is null.
  </behavior>
  <action>
    Step 1 — PrettyView.tsx publisher effect.

    Locate the existing patch #74 delay-armed showOverlay useEffect (PrettyView.tsx:869-880, the effect that flips setShowOverlay based on isHolding + 350ms timer). Directly ADJACENT to it (below the sibling effects at lines 894-913, i.e. after the holdingTimeoutError effects), add a new useEffect:

    - Deps: [showOverlay, hostId, tmuxSession] — use whatever variable names PrettyView.tsx currently uses for host id + tmux session (grep result confirms PrettyView receives them as props named `hostId: number` at line 91 and `tmuxSession: string` at line 92; destructured at lines 159-160). Reference them directly (not through props.hostId).
    - Body: `const key = `${hostId}:${tmuxSession ?? ""}`; publishSessionRecycling(key, showOverlay);`
    - NO cleanup. Comment header must cite (a) patch #74 (SessionHoldingOverlay — the origin of showOverlay), (b) this bounty (quick-260730-qbl), and (c) the deliberate no-cleanup rationale mirrored from Terminal.tsx:253's patch #137 publish effect (preserve last-known state across route changes so a remount does not stall on null waiting for the next state flip).
    - IMPORTANT: the gate value passed to publishSessionRecycling is EXACTLY `showOverlay` (a boolean, never null). Do NOT introduce a separate check for `holdingTimeoutError` — the SessionHoldingOverlay mount at line 1163 is `{showOverlay && <SessionHoldingOverlay error={holdingTimeoutError} />}`, so `holdingTimeoutError` only changes the overlay's inner copy variant; showOverlay is the single authoritative visibility flag. Publish `showOverlay` verbatim.

    Add `import { publishSessionRecycling } from "@/state/session-recycling-store";` at the top of PrettyView.tsx alongside the existing state-store imports.

    Step 2 — PrettyConversationsPanel.tsx consumer.

    - Add `import { useSessionRecycling } from "@/state/session-recycling-store";` on the line immediately after `import { useSessionWorking } from "@/state/session-working-store";` (line 60).
    - Inside `PrettyConversationRowLive` (currently at lines 92-124), after the existing `const isWorking = useSessionWorking(sessionKey);` line (line 116), add `const isRecycling = useSessionRecycling(sessionKey);`.
    - In the returned <PrettyConversationRow> JSX, add prop `isRecycling={isRecycling === true}` alongside `isWorking={isWorking}`. Coerce with `=== true` because the row prop is a strict boolean (both null and undefined mean "not recycling"). Do NOT change any other prop.
    - The `sessionKey` reused here is exactly the same key the working-store subscription uses — `${host.id}:${targetTmuxSession ?? ""}` per `sessionWorkingKey()` at line 81-84. Both stores are keyed identically because PrettyView.tsx and Terminal.tsx compute the same `${hostId}:${tmuxSession ?? ""}` shape. Confirm this alignment in a one-line comment beside the new useSessionRecycling call.

    Step 3 — PrettyConversationRow.tsx interface + gate + classname.

    - Add prop to the destructured signature at ~line 96-98: add `isRecycling = false,` between `isWorking = null,` and `inActiveSet = false,` (or wherever alphabetically/logically neighbouring). Default false.
    - Add to the typed props object at ~lines 100-146: `isRecycling?: boolean;` with a header comment referencing this bounty (quick-260730-qbl) that explains: "true when the row's pretty-view surface is currently rendering SessionHoldingOverlay (patch #74). Suppresses the ready-dot regardless of other conditions. Panel resolves via useSessionRecycling(sessionWorkingKey(row))." Note that we reuse `sessionWorkingKey` — both stores are keyed identically.
    - Update rowClassName at lines 325-334: add `isRecycling === true && "recycling",` on its own line between the existing `isWorking === true && "working",` and `pinned && "pinned",` entries. This lets the CSS defense-in-depth gate key off `.pv-row.recycling`.
    - Update the JS dot gate at line 528: change `{inActiveSet && isWorking === false && (` to `{inActiveSet && isWorking === false && !isRecycling && (`.
    - Update the multi-line inline comment block ending at line 527 to append a sentence describing the new conjunct: `!isRecycling` (this bounty, quick-260730-qbl) suppresses the dot whenever the row's pretty-view surface is currently showing SessionHoldingOverlay. Keep the existing JS-narrower-than-CSS lineage note; explicitly note that the CSS gate at pretty-conversations.css line 463 has been extended in parallel to `:not(.recycling)` for defense-in-depth.

    Step 4 — pretty-conversations.css defense-in-depth gate.

    - Extend the selector at line 463 from `.pv-row.active-set:not(.working) .pv-ready-dot` to `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot`.
    - Update the comment on the preceding line (currently "Shown only when row is in the active set AND NOT currently working") to append ` AND NOT currently recycling`.
    - No new rule block for `.pv-row.recycling` at the row level (mirror the treatment of `.pv-row.working` at line 471-473 — an empty reserved selector is optional; if adding one, use the same "Reserved for downstream extension" comment shape. Prefer to SKIP adding an empty selector — the class presence alone is the CSS gate signal, no row-level visual change is needed).

    Step 5 — PrettyConversationRow.test.tsx new suppression test.

    Add a new `describe(...)` block after Test 17 (currently at ~line 761) and before Test 18. Match Test 15's shape verbatim:

    - Set currentIdentity via makeIdentity(210) (mirror Test 15).
    - Render <PrettyConversationRow> with: row={makeRow()}, selected={false}, pinned={false}, variant="desktop", onSelect={vi.fn()}, onTogglePin={vi.fn()}, inActiveSet={true}, isWorking={false}, isRecycling={true}.
    - Assert: `expect(queryByLabelText("ready")).toBeNull();`
    - Additionally assert the row DOES carry the `recycling` className: `expect(container.querySelector('.pv-row')?.className).toContain("recycling");` (parallel to Test 15's `working` class assertion — proves the classname gate wired end-to-end for the CSS defense-in-depth).

    Test name: `Test 15b: inActiveSet+isWorking===false+isRecycling===true renders NO ready-dot AND row carries \`recycling\` class`.

    Update the header block at lines 1-64 to bump the test count in the header comment (currently `18 (+18b) tests`) to include the new test — e.g. `18 (+18b, +15b) tests` or renumber to whatever pattern is consistent. Add a one-line entry to the numbered list explaining Test 15b: `15b) [quick-260730-qbl] inActiveSet+isWorking===false+isRecycling===true renders NO ready-dot (JS gate) AND row carries `recycling` class (CSS defense-in-depth gate)`.

    Do NOT modify any existing test (13, 14, 15, 16, 17, 18, 18b/c/d/e/f). The new isRecycling prop defaults to `false` in the destructure, so all existing tests continue to render dots exactly as before.

    Nothing outside the six listed files is touched. This is commit (b).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit && npx vitest run</automated>
  </verify>
  <done>
    - PrettyView.tsx has the new publisher useEffect adjacent to the patch #74 showOverlay effects, keyed on [showOverlay, hostId, tmuxSession], with the correct comment header citing patch #74 + quick-260730-qbl.
    - PrettyConversationsPanel.tsx imports useSessionRecycling, reads it inside PrettyConversationRowLive, forwards `isRecycling={isRecycling === true}` to PrettyConversationRow.
    - PrettyConversationRow.tsx has the `isRecycling?: boolean` prop, includes `isRecycling === true && "recycling"` in rowClassName, gates the ready-dot render on `inActiveSet && isWorking === false && !isRecycling`, and the associated comment block cites quick-260730-qbl.
    - pretty-conversations.css line 463 selector reads `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot`.
    - PrettyConversationRow.test.tsx has the new Test 15b asserting null-dot + `recycling` className when isRecycling=true.
    - `npx tsc --noEmit` exits 0.
    - `npx vitest run` reports 0 failed. Report total files and pass/skip counts in the summary.
  </done>
</task>

</tasks>

<verification>
- After Task 1: `npx vitest run src/ui/state/session-recycling-store.test.ts` — 5 tests, 0 failed.
- After Task 2: `npx tsc --noEmit && npx vitest run` — 0 typescript errors, 0 vitest failures. Report vitest summary numbers.
- Grep sanity (post-Task-2): `grep -n "!isRecycling" src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — exactly 1 match, on the dot-gate JSX line.
- Grep sanity (post-Task-2): `grep -n "publishSessionRecycling" src/ui/features/pretty-view/PrettyView.tsx` — exactly 1 match, inside the new useEffect body.
- Grep sanity (post-Task-2): `grep -n "useSessionRecycling" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — exactly 2 matches (import + call site).
- No backend build required — zero backend files modified.
</verification>

<success_criteria>
- All three bounty todos satisfied:
  1. Recycling detection located: showOverlay in PrettyView.tsx published to session-recycling-store.
  2. Recycling wired into dot gate: row-level `!isRecycling` conjunct + CSS `:not(.recycling)` defense-in-depth + panel forwarding.
  3. Test added: Test 15b asserts dot suppression when isRecycling=true.
- `npx tsc --noEmit` exits 0.
- `npx vitest run` reports 0 failed.
- Two atomic commits, imperative present tense:
  - Commit (a): `add session-recycling-store + tests` (files: session-recycling-store.ts, session-recycling-store.test.ts).
  - Commit (b): `hide idle dot when session-recycling overlay is active` (files: PrettyView.tsx, PrettyConversationsPanel.tsx, PrettyConversationRow.tsx, PrettyConversationRow.test.tsx, pretty-conversations.css).
- NO push, docker build, or docker compose recreate.
- NO edits to any file outside the seven listed files (six code + one CSS).
- NO identity-file bookkeeping under ~/.claude/identities/tina/ — orchestrator handles that after execution.
</success_criteria>

<output>
Create `.planning/quick/260730-qbl-hide-idle-dot-when-session-recycling-ove/260730-qbl-SUMMARY.md` when done, including:
- The two commit SHAs.
- The vitest summary line (files + tests + pass/skip counts).
- Confirmation `npx tsc --noEmit` exited 0.
- Any deviation from this plan (expected: none).
</output>
