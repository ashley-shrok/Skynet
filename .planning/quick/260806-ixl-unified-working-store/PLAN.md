---
quick_id: 260806-ixl
slug: unified-working-store
date: 2026-08-06
status: ready
branch: feat/tab-title-from-tmux
mode: quick
worktree: false
autonomous: false
requirements: [UNIFY-WS-01]
files_modified:
  - src/ui/state/session-working-store.ts
  - src/ui/state/session-working-store.test.ts
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
must_haves:
  truths:
    - "PrettyConversationsPanel row-dot and PrettyView WipBubble derive their working-state from ONE store hook (useSessionIsWorking), producing identical answers for the same session key."
    - "A session with an idle PTY + non-empty backgroundedAgents OR backgroundedShells surfaces as working (row-dot suppressed AND WipBubble mounted) — no more disagreement between the two surfaces."
    - "A session with a busy PTY + empty backgrounded lists surfaces as working (existing behavior preserved)."
    - "A session with idle PTY + empty backgrounded lists surfaces as not-working (row-dot renders if inActiveSet, WipBubble does NOT mount)."
    - "session_changed / fresh-pane-mount reset paths clear hasBgWork in the store (no phantom working-state carried across recycles)."
    - "Full Vitest suite exits 0 with zero failures before any commit is called done."
  artifacts:
    - path: "src/ui/state/session-working-store.ts"
      provides: "New composite shape { ttyBusy, hasBgWork } + publishSessionTtyBusy + publishSessionHasBackgroundedWork + useSessionIsWorking"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "hasBgWork publishes on backgrounded_agents/backgrounded_shells + reset paths; WipBubble mount routes through useSessionIsWorking"
  key_links:
    - from: "src/ui/features/terminal/Terminal.tsx"
      to: "session-working-store"
      via: "publishSessionTtyBusy(key, isIdle === null ? null : isIdle === false)"
      pattern: "publishSessionTtyBusy"
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "session-working-store"
      via: "publishSessionHasBackgroundedWork on WS frames + reset paths; useSessionIsWorking for WipBubble mount"
      pattern: "publishSessionHasBackgroundedWork|useSessionIsWorking"
    - from: "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx"
      to: "session-working-store"
      via: "useSessionIsWorking(sessionKey) → row.isWorking"
      pattern: "useSessionIsWorking"
---

<objective>
Unify the "is this session working?" derivation between two UI surfaces that today
disagree:

1. **Sidebar `PrettyConversationsPanel` ready-dot** — currently gated on
   `inActiveSet && isWorking === false` where `isWorking` comes from Terminal's
   PTY idle signal alone.
2. **PrettyView `WipBubble` mount** — currently gated on
   `wipActive || backgroundedAgents.length > 0 || backgroundedShells.length > 0`.

On a session with backgrounded shells but an idle PTY, sidebar shows the ready-dot
AND WipBubble mounts — contradiction. This plan extends `session-working-store`
into a composite `{ ttyBusy, hasBgWork }` with a single derived `useSessionIsWorking`
hook that BOTH surfaces consume, so future rule changes hit both surfaces in
lockstep.

**Coverage claim (already verified by orchestrator, do not re-derive):**
`AppShell.tsx:1832-1863`'s `tabs.map` mounts Terminal + WS for every active-set
tab (`shouldAttach = inPane || activeInline || isInActiveSet`), and active-set
pretty-mode tabs also mount PrettyView. Therefore PrettyView's claude-session WS
is receiving `backgrounded_agents` / `backgrounded_shells` frames continuously
for ALL active-set panes, and publishing from PrettyView gives the sidebar dot
full parity for every session the dot could ever paint on. Tier-1 client-only
unify is complete — no pane-scrape, no `/sessions/list` extension, no new
subsystem.

Purpose: Single source of truth for "working" — eliminate the drift between
sidebar-dot and WipBubble on the same session; make future rule changes
(e.g., "also suppress on plan_pending") a one-line change in
`session-working-store.ts` that both surfaces inherit automatically.

Output: 4 atomic commits on `feat/tab-title-from-tmux` in `~/skynet` (no
worktree). Each commit compiles + full-suite green.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/ui/state/session-working-store.ts
@src/ui/state/session-working-store.test.ts
@src/ui/features/terminal/Terminal.tsx
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
@src/ui/features/pretty-conversations/PrettyConversationRow.tsx
</context>

<standing_directives>

**These bind every task below. Executor must not violate them even under time pressure.**

- **No worktrees.** Work in `/home/ubuntu/skynet` on branch `feat/tab-title-from-tmux`.
  Any Agent tool spawn is main-tree, never `isolation: worktree`. (Ashley fleet
  rule 2026-07-31, plus `workflow.use_worktrees=false` in project config.)
- **Never leave tests failing.** After EVERY edit that could plausibly affect
  a test, run `npx vitest run > /tmp/vitest.log 2>&1; echo "EXIT: $?"; tail -80 /tmp/vitest.log`.
  Exit 0 with zero failures is a precondition for calling any commit done. If a
  pre-existing failure surfaces from an earlier commit on the branch, fix it in
  the same task — do not defer.
- **Typecheck gate:** `npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT: $?"; tail -60 /tmp/tsc.log`
  must exit 0 before any commit.
- **Backend build (defensive only):** at the very end of Task 4, run
  `npm run build:backend > /tmp/build-be.log 2>&1; echo "EXIT: $?"; tail -40 /tmp/build-be.log`.
  This task is frontend-only, but the check is cheap insurance.
- **Do NOT push, docker build, or deploy.** Executor's job ends at atomic
  commits on the local branch. Tina (orchestrator) handles the ship gate.
- **Atomic commits.** One commit per task below. Each commit must compile +
  full-suite green independently. If the executor discovers a saner split
  mid-task, deviate per `gsd-quick`'s deviation policy (state reason in the
  commit body) — but do NOT bundle multiple tasks into one commit without
  stating why.
- **NO `| tail` on long-running commands whose exit code matters.** Always
  redirect to `/tmp/<cmd>.log 2>&1; echo "EXIT: $?"; tail /tmp/<cmd>.log`.
  Pipe-to-tail eats the upstream exit code and silently green-lights failures.

</standing_directives>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rework session-working-store to composite { ttyBusy, hasBgWork } + rewrite tests</name>
  <files>
    src/ui/state/session-working-store.ts
    src/ui/state/session-working-store.test.ts
  </files>
  <behavior>
    New store shape: `Map<string, { ttyBusy: boolean | null; hasBgWork: boolean }>`.
    Default record when creating an entry via one-sided publish: the other field
    takes its default (`ttyBusy: null`, `hasBgWork: false`).

    Public API changes:
    - REMOVE `publishSessionWorking(key, boolean|null)`.
    - ADD `publishSessionTtyBusy(key: string, ttyBusy: boolean | null): void`.
    - ADD `publishSessionHasBackgroundedWork(key: string, hasBgWork: boolean): void`.
    - REMOVE `useSessionWorking(key): boolean | null`.
    - ADD `useSessionIsWorking(key: string | null): boolean`.
      Semantics: returns `state.ttyBusy === true || state.hasBgWork`.
      Null ttyBusy counts as not-working (matches today's "suppress ready-dot
      until backend has emitted at least one idle frame" — the dot semantic is
      unchanged).
      Null key short-circuits to `false` (was `null` — the caller is a
      hostless row and now gets a plain boolean).
    - UPDATE `getSessionWorkingSnapshot()` return type to
      `ReadonlyMap<string, { ttyBusy: boolean | null; hasBgWork: boolean }>`.
    - UPDATE `__resetForTest()` to reset the new Map shape.

    Publisher invariant (preserve for BOTH publishers, independently per-field):
    "No-op notify if the target field is unchanged AND the key already existed
    in the map." Publishing an unchanged ttyBusy MUST NOT re-notify even if
    hasBgWork was published in between (and vice versa). First-time publish of
    a null/false value still notifies (React may be observing the key).

    Publishing rule when key does NOT yet exist: create the record with the
    published field set to the given value and the OTHER field set to its
    default (`ttyBusy: null`, `hasBgWork: false`). This is a first-time publish,
    so notify.

    Header comment: keep the "publishing null OVERWRITES to null (does NOT
    delete the key)" rationale — extend it to explain the composite shape and
    the "either-side-true = working" derivation.

    Tests to write (`session-working-store.test.ts`):
    - Test A: `publishSessionTtyBusy(k, true)` alone → `useSessionIsWorking(k)`
      returns `true`.
    - Test B: `publishSessionTtyBusy(k, false)` alone → returns `false`.
    - Test C: `publishSessionHasBackgroundedWork(k, true)` alone → returns
      `true` (proves hasBgWork independently flips the composite).
    - Test D: both `true` → returns `true`; both `false` → returns `false`.
    - Test E: `ttyBusy=null` + `hasBgWork=false` → returns `false` (no
      false-positive from "unknown" ttyBusy).
    - Test F: `ttyBusy=null` + `hasBgWork=true` → returns `true` (hasBgWork
      alone dominates unknown ttyBusy).
    - Test G: no-op notify guard, ttyBusy field: publishing an unchanged
      ttyBusy after an intervening hasBgWork publish does NOT re-notify. Use
      a listener spy: subscribe via `useSyncExternalStore` (or the internal
      subscribe if exported for test) and assert render count.
    - Test H: mirror of Test G for hasBgWork field.
    - Test I: unknown key → `useSessionIsWorking(k)` returns `false` (was
      `null`, semantics change per new API contract).
    - Test J: null key → `useSessionIsWorking(null)` returns `false` and does
      not subscribe (short-circuit — same rationale as before, just a boolean
      return now).
    - Test K: multiple keys are independent (mirror old Test 4 but with the
      new shape — publishing to key A does not alter key B's composite).

    All tests use `renderHook` from `@testing-library/react` and `act()` around
    publishes, matching the existing pattern. `beforeEach(__resetForTest)`.

    Tests G and H are the load-bearing addition — they prove the per-field
    guard is truly per-field, not "cleared when the other field is touched".
    If the executor cannot easily assert render count from renderHook,
    equivalent proof is acceptable: e.g., install a subscribe spy or verify
    via `getSessionWorkingSnapshot()` reference-equality before/after the
    unchanged publish.
  </behavior>
  <action>
    Rewrite `src/ui/state/session-working-store.ts` to the composite shape above.
    Preserve the module-scoped-Map + Set-of-listeners + snapshotVersion pattern
    verbatim (it's mirrored by three sibling stores). Update the header comment
    to describe the composite shape, the two publishers, and the OR-derived hook.

    Rewrite `src/ui/state/session-working-store.test.ts` from scratch to cover
    Tests A–K above. Keep the file structure (top comment block enumerating
    tests, `beforeEach(__resetForTest)`, one `describe` per test group).

    RED→GREEN→REFACTOR: it is acceptable to write the tests first, watch them
    fail against the OLD store, then flip the store implementation to the new
    shape and watch them pass — but a single-commit "store + tests together" is
    also acceptable since callers of the OLD API will break at the type level
    anyway (compilation errors in Terminal.tsx / PrettyConversationsPanel /
    test mocks — those are addressed in Tasks 2–4).

    **Commit only after step below is green.** Do NOT run the full app-wide
    typecheck yet — Terminal.tsx and PrettyConversationsPanel still import the
    old symbols and will not compile until Tasks 2 + 4 land. Scope the gate to
    this file's tests only:

    ```
    npx vitest run src/ui/state/session-working-store.test.ts > /tmp/vitest-store.log 2>&1; echo "EXIT: $?"; tail -60 /tmp/vitest-store.log
    ```

    Deviation-from-standing-directive note this task carries: the "full suite
    green before commit" rule is RELAXED for Task 1 ONLY because Tasks 2–4 are
    the mechanical fanout that fixes the type errors caused by the API rename.
    Document this in the commit body: "commits 2–4 in this series restore
    full-suite green; commit 1 is intentionally red at the app-wide-typecheck
    level pending those." This is the atomic-commit style — commit 1 must at
    minimum have its OWN tests green.
  </action>
  <verify>
    <automated>npx vitest run src/ui/state/session-working-store.test.ts > /tmp/vitest-store.log 2>&1; echo "EXIT: $?"; tail -60 /tmp/vitest-store.log</automated>
  </verify>
  <done>
    - `src/ui/state/session-working-store.ts` exports `publishSessionTtyBusy`,
      `publishSessionHasBackgroundedWork`, `useSessionIsWorking`,
      `getSessionWorkingSnapshot` (new shape), `__resetForTest`. Old
      `publishSessionWorking` / `useSessionWorking` are GONE (no soft
      backward-compat shim — clean rename).
    - Store's test file covers Tests A–K per the behavior block. All tests
      pass (`npx vitest run src/ui/state/session-working-store.test.ts` exits 0).
    - Header comment updated to reflect composite shape + per-field guard.
    - Committed with message like `refactor(session-working-store): composite { ttyBusy, hasBgWork } shape + useSessionIsWorking`.
      Commit body notes the intentional temporary red on app-wide typecheck (see action block).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Terminal.tsx — rename publisher call to publishSessionTtyBusy</name>
  <files>
    src/ui/features/terminal/Terminal.tsx
  </files>
  <action>
    Two edits, both mechanical:

    1. Line ~49 import: change
       `import { publishSessionWorking } from "@/state/session-working-store";`
       to
       `import { publishSessionTtyBusy } from "@/state/session-working-store";`.

    2. Line ~259 call: change
       `publishSessionWorking(key, isIdle === null ? null : isIdle === false);`
       to
       `publishSessionTtyBusy(key, isIdle === null ? null : isIdle === false);`.

    Semantics of the ternary are identical (`ttyBusy` = "PTY is busy" =
    "isIdle is false"), so no behavior change here — pure symbol rename.

    Update the surrounding comment block (~L249-254) to say "ttyBusy field" of
    session-working-store rather than "session-working-store" alone; a one-line
    comment tweak keeps future readers oriented.

    Do NOT re-plumb `isIdle` or touch the effect deps. Do NOT change the
    `hostId == null` early-return guard.

    After this task, Terminal.tsx compiles clean against the new store API.
    PrettyConversationsPanel + its test mocks are still broken (Task 4).
  </action>
  <verify>
    <automated>npx tsc --noEmit src/ui/features/terminal/Terminal.tsx > /tmp/tsc-terminal.log 2>&1; echo "EXIT: $?"; tail -40 /tmp/tsc-terminal.log</automated>
  </verify>
  <done>
    - Terminal.tsx has NO reference to `publishSessionWorking` (grep -c returns 0).
    - `grep -n 'publishSessionTtyBusy' src/ui/features/terminal/Terminal.tsx`
      returns exactly the import line + the call line.
    - Commit message like `refactor(terminal): rename publishSessionWorking → publishSessionTtyBusy`.
    - Full-suite gate still deferred — see Task 4 for the app-wide sweep.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: PrettyView.tsx — publish hasBgWork on WS frames + reset paths; WipBubble mount uses useSessionIsWorking</name>
  <files>
    src/ui/features/pretty-view/PrettyView.tsx
  </files>
  <behavior>
    Add a new PrettyView test (or extend the closest existing PrettyView test
    file — check `src/ui/features/pretty-view/` for `PrettyView.*.test.tsx`;
    if none is a natural home, create `PrettyView.wip-bubble.test.tsx`):

    - Wip A: mount PrettyView with `isIdle={true}` (i.e., not-working) and a
      claude-session WS mock that emits no backgrounded frames → after mount +
      any status transition to "streaming" the WipBubble should NOT be present.
    - Wip B: while mounted, simulate the WS emitting a
      `{type:"backgrounded_shells", shells:[{...one shell...}]}` frame →
      WipBubble IS present.
    - Wip C: emit `{type:"backgrounded_shells", shells:[]}` (clear) AND ensure
      no backgrounded_agents pending, and `isIdle=true` → WipBubble is GONE.
    - Wip D: with cleared backgrounded lists, flip `isIdle={false}` prop →
      WipBubble IS present (routed via ttyBusy path, proving BOTH paths flow
      through `useSessionIsWorking`).

    Alternative if end-to-end WS mocking is heavy in this codebase: pivot to
    a store-level test that mounts a minimal component using `useSessionIsWorking`
    and directly calls `publishSessionTtyBusy` / `publishSessionHasBackgroundedWork`
    to prove the composite drives the boolean — this proof already lives in
    Task 1's store tests (Tests A–F), so a second component-level test is
    only needed if the executor can wire it cheaply. **If wiring the full
    PrettyView WS mock costs >30% of the task budget, drop tests Wip A–D and
    rely on Task 1's coverage plus a one-shot manual smoke note in the commit
    body.** State the deviation reason.
  </behavior>
  <action>
    **Edit 1 — imports (~L41-ish, near `publishSessionRecycling` import):**
    Add
    ```
    import {
      publishSessionHasBackgroundedWork,
      useSessionIsWorking,
    } from "@/state/session-working-store";
    ```
    (Or extend the existing session-working-store import if PrettyView.tsx
    already imports from that module — grep to confirm; today it does NOT.)

    **Edit 2 — top-of-body hook (~L169-ish, after the useState block but before
    the first useEffect):** add
    ```
    const sessionWorkingKey = `${hostId}:${tmuxSession ?? ""}`;
    const isWorking = useSessionIsWorking(sessionWorkingKey);
    ```
    The key format is CRITICAL — must match Terminal.tsx's
    `${hostId}:${tmuxSessionName ?? ""}` exactly. Note that PrettyView's prop is
    called `tmuxSession` (Terminal.tsx calls it `tmuxSessionName`); the STRING
    output is what must match, not the variable name.

    **Edit 3 — `case "backgrounded_agents":` (~L685-687):** replace body with
    ```
    case "backgrounded_agents": {
      setBackgroundedAgents(parsed.agents);
      // Publish composite has-bg-work flag. Read the CURRENT
      // backgroundedShells via functional-setter trick or a ref — the
      // frame only tells us agents, but the composite needs BOTH arrays.
      // Use functional setter form to sample the latest shells synchronously.
      setBackgroundedShells((currentShells) => {
        const key = `${hostId}:${tmuxSession ?? ""}`;
        publishSessionHasBackgroundedWork(
          key,
          parsed.agents.length > 0 || currentShells.length > 0,
        );
        return currentShells; // no state change to shells
      });
      break;
    }
    ```

    **Edit 4 — `case "backgrounded_shells":` (~L689-691):** mirror image
    ```
    case "backgrounded_shells": {
      setBackgroundedShells(parsed.shells);
      setBackgroundedAgents((currentAgents) => {
        const key = `${hostId}:${tmuxSession ?? ""}`;
        publishSessionHasBackgroundedWork(
          key,
          parsed.shells.length > 0 || currentAgents.length > 0,
        );
        return currentAgents;
      });
      break;
    }
    ```

    Rationale for the functional-setter-as-reader pattern: at the moment the WS
    frame arrives, the OTHER array is stale in the closure that owns
    `messages` / `backgroundedAgents` / `backgroundedShells` (the WS `onmessage`
    was set inside the WS-setup effect and closed over the initial state). The
    functional setter callback gets the LATEST value from React. This is the
    idiomatic React pattern for "read latest state from an async callback
    without adding refs." No new state or refs required.

    If the executor prefers explicit refs (mirroring the reconnectAttemptsRef
    style already in this file at L479), that is equally acceptable — pick one
    and be consistent. Either pattern satisfies the "read other side's current
    value" requirement.

    **Edit 5 — fresh-pane reset (~L578-579):** add a hasBgWork clear alongside
    the setBackgroundedAgents/Shells resets:
    ```
    setBackgroundedAgents([]);
    setBackgroundedShells([]);
    // Composite store: clear hasBgWork for this key. Guard on hostId
    // being non-null (matches Terminal.tsx pattern at line 257) —
    // hostId is a prop, could in principle be null though the parent
    // never actually mounts PrettyView without one; defensive.
    if (hostId != null) {
      const key = `${hostId}:${tmuxSession ?? ""}`;
      publishSessionHasBackgroundedWork(key, false);
    }
    ```

    **Edit 6 — session_changed reset (~L780-781):** same three-line addition
    verbatim (same guard, same key computation, same `false` publish). Place
    directly after `setBackgroundedShells([])`.

    **Edit 7 — WipBubble mount (~L1324):** change
    ```
    {(wipActive || backgroundedAgents.length > 0 || backgroundedShells.length > 0) && <WipBubble />}
    ```
    to
    ```
    {isWorking && <WipBubble />}
    ```
    where `isWorking` is the hook result from Edit 2.

    **DO NOT touch:**
    - `wipActive = isIdle === false` at ~L466 — it's a local const consumed
      elsewhere in the file? Actually grep confirms it's only referenced at
      L1324. Once L1324 no longer references it, `wipActive` becomes dead
      code. **Delete the `wipActive` const declaration** (L466) once it has
      no consumers — cleaner. Verify with grep before deleting.
    - The `prevIsIdleRef` / arm-emitter useEffect at ~L1003-1046 — that
      subsystem consumes the `isIdle` PROP directly, not the store. Leave
      unchanged.
    - `BackgroundedAgentsPanel` mount at ~L1410-1412 and `BackgroundedShellsPanel`
      mount at ~L1419-1421 — both KEEP reading local `backgroundedAgents` /
      `backgroundedShells` arrays because those panels render the LIST
      CONTENTS, not the mount decision. Only the WipBubble mount decision
      routes through the shared hook.

    **Sanity check the hostId+tmuxSession key stability:** PrettyView's
    hostId/tmuxSession are props, so if the parent swaps them mid-life the key
    changes. That's fine — the hook re-subscribes to the new key on the render
    where `sessionWorkingKey` changes, and the fresh-pane reset effect (L570)
    also runs on paneKey change and clears the OLD key's hasBgWork before the
    new key takes over. Wait — the reset publishes `false` to the NEW key, not
    the OLD key. That's actually correct behavior: the OLD key's hasBgWork
    state stays live in the store (whichever Terminal + PrettyView instance
    remounts on that pane will overwrite it). Do NOT try to be clever with a
    cleanup that publishes false to the OLD key; that mirrors the
    "no-cleanup" rationale on the existing Terminal.tsx publish effect (L253).

    **After all edits, run:**
    ```
    npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT: $?"; tail -60 /tmp/tsc.log
    ```
    PrettyView + Terminal should now typecheck clean. PrettyConversationsPanel +
    the 4 test mocks are still red — that's Task 4.

    Also run the PrettyView tests (whichever exist that could be affected):
    ```
    npx vitest run src/ui/features/pretty-view > /tmp/vitest-pv.log 2>&1; echo "EXIT: $?"; tail -80 /tmp/vitest-pv.log
    ```
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view src/ui/state/session-working-store.test.ts > /tmp/vitest-pv-store.log 2>&1; echo "EXIT: $?"; tail -80 /tmp/vitest-pv-store.log</automated>
  </verify>
  <done>
    - PrettyView.tsx WipBubble mount condition is `{isWorking && <WipBubble />}`.
    - `grep -c 'wipActive' src/ui/features/pretty-view/PrettyView.tsx` returns 0
      (dead const removed) OR at most 1 (if the executor left the const
      declaration and killed only the usage — either is acceptable, but the
      cleaner answer is 0).
    - Both `backgrounded_agents` and `backgrounded_shells` WS cases publish to
      the composite store using the paired-array read pattern.
    - Both reset paths (`paneKey !== paneKeyRef.current` + `session_changed`)
      also publish `hasBgWork=false` guarded on `hostId != null`.
    - PrettyView-scope Vitest run exits 0.
    - Wip A–D tests present in a PrettyView test file (OR: commit body cites the
      Task 1 store coverage + deviation reason if the WS mock was too costly to
      wire — see behavior block).
    - Commit message like `feat(pretty-view): publish hasBgWork + route WipBubble mount through useSessionIsWorking`.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: PrettyConversationsPanel + all test mocks — swap to useSessionIsWorking, restore full-suite green</name>
  <files>
    src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx
    src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx
    src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx
    src/ui/features/pretty-conversations/PrettyConversationRow.tsx (optional narrowing)
    src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (comment updates only if any)
  </files>
  <action>
    **Edit 1 — PrettyConversationsPanel.tsx L76 import:** change
    `import { useSessionWorking } from "@/state/session-working-store";`
    to
    `import { useSessionIsWorking } from "@/state/session-working-store";`

    **Edit 2 — PrettyConversationsPanel.tsx L158 call:** change
    `const isWorking = useSessionWorking(sessionKey);`
    to
    `const isWorking = useSessionIsWorking(sessionKey);`

    Now `isWorking` is a plain `boolean` (was `boolean | null`). Passed down to
    `<PrettyConversationRow isWorking={isWorking} />` at L174.

    **Decision on Row's isWorking prop shape:**
    `PrettyConversationRow`'s `isWorking?: boolean | null` prop (default
    `null`) is used at L373 (`isWorking === true && "working"`) and L551
    (`inActiveSet && isWorking === false && !isRecycling && !hasQueuePending`).
    Both use STRICT-EQUALS comparisons. If the panel now passes a `boolean`,
    the strict-equals gates work correctly:
    - `isWorking === true` → matches when working (paint working class)
    - `isWorking === false` → matches when not-working (paint ready dot)
    - `null` default is now unreachable from the panel path, BUT test callers
      still pass `isWorking={null}` explicitly (Test 16), and RDP rows / non-
      panel callers implicitly get the null default.

    **Chosen approach: keep Row's prop shape as `boolean | null` (default
    `null`) UNCHANGED.** Rationale:
    - The Row is a pure UI component; keeping the nullable prop preserves
      the "unknown" tri-state semantics for test authors and for any future
      caller that legitimately doesn't know.
    - The panel-side coercion is unnecessary — Row's strict-equals gates
      handle a plain boolean correctly.
    - Zero risk of breaking PrettyConversationRow's existing tests (13–17
      exercise all three prop values).

    So NO CHANGE to PrettyConversationRow.tsx source. Also no change to
    PrettyConversationRow.test.tsx tests themselves — but the comment at L533
    that says "useSessionWorking returns null" should be updated to
    "useSessionIsWorking returns false" for accuracy. Comment-only edit; not
    load-bearing but nice-to-have.

    **Edit 3 — 4 test mock files (mechanical fanout):**
    In EACH of:
    - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (~L244-246)
    - `src/ui/features/pretty-conversations/PrettyConversationsPanel.chain.test.tsx` (~L90-92)
    - `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` (~L81-83)
    - `src/ui/features/pretty-conversations/PrettyConversationsPanel.clone-dialog.test.tsx` (~L136-138)

    Change
    ```
    vi.mock("@/state/session-working-store", () => ({
      useSessionWorking: () => null,
    }));
    ```
    to
    ```
    vi.mock("@/state/session-working-store", () => ({
      useSessionIsWorking: () => false,
    }));
    ```

    `false` matches the previous semantics: "unknown / no dot suppression from
    the working-store axis" — was `null`, is now `false` because
    `useSessionIsWorking` returns a plain boolean and `null` was the "not
    working" case (via `isWorking === false` gate). The composite hook's
    "return false" is the equivalent no-suppression signal.

    **Edit 4 — comment updates in comments elsewhere (grep sweep, optional):**
    `session-queue-pending-store.ts` L93 comment references
    `publishSessionWorking's guard` — update to `publishSessionTtyBusy /
    publishSessionHasBackgroundedWork guards`. Nice-to-have.
    `session-recycling-store.ts` L38 comment (module pattern reference) —
    already accurate.
    `bounty-counts-store.ts` L5 comment — already accurate.
    Only update if the editor is right there; do not go on a comment-cleanup
    tour.

    **Full-suite gate — MANDATORY, this is the recovery point:**
    ```
    npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT: $?"; tail -80 /tmp/tsc.log
    npx vitest run > /tmp/vitest.log 2>&1; echo "EXIT: $?"; tail -120 /tmp/vitest.log
    npm run build:backend > /tmp/build-be.log 2>&1; echo "EXIT: $?"; tail -40 /tmp/build-be.log
    ```
    All three MUST exit 0 before the commit is called done. If Vitest surfaces
    any pre-existing failure that pre-dates this quick task, fix in this same
    commit (Ashley's fleet rule — never leave tests failing). Note the fix in
    the commit body.

    Then commit. If any of the three checks fails, fix the root cause and re-run
    ALL THREE before considering the task complete. Do NOT commit at
    partial-green.
  </action>
  <verify>
    <automated>npx tsc --noEmit > /tmp/tsc.log 2>&1; TSC=$?; npx vitest run > /tmp/vitest.log 2>&1; VITEST=$?; npm run build:backend > /tmp/build-be.log 2>&1; BUILD=$?; echo "TSC=$TSC VITEST=$VITEST BUILD=$BUILD"; tail -40 /tmp/tsc.log; echo '---'; tail -80 /tmp/vitest.log; echo '---'; tail -40 /tmp/build-be.log</automated>
  </verify>
  <done>
    - `grep -rn 'useSessionWorking\|publishSessionWorking' src/ui tests 2>/dev/null` returns 0 matches
      (or only matches inside comments that reference historical context; grep with
      `-v '^[[:space:]]*//\|^[[:space:]]*\*'` if noise).
    - PrettyConversationsPanel.tsx uses `useSessionIsWorking(sessionKey)`.
    - All 4 test mocks now mock `useSessionIsWorking: () => false`.
    - `npx tsc --noEmit` exits 0.
    - `npx vitest run` exits 0 with zero failures. Any pre-existing failures on
      the branch were fixed in this same commit (per Ashley's rule) and the fix
      is documented in the commit body.
    - `npm run build:backend` exits 0 (defensive check).
    - Commit message like `refactor(pretty-conversations): swap useSessionWorking → useSessionIsWorking + update mocks`.
    - Final git log on branch shows 4 atomic commits from this quick task
      (Tasks 1–4).
  </done>
</task>

</tasks>

<verification>

## Phase-level verification (after Task 4)

Manual smoke — NOT a checkpoint (the executor is autonomous), but call out in
the final commit body that the following was NOT smoke-tested locally by the
executor (Skynet is a browser SSH/RDP manager that requires the full docker
stack running; not part of this task's blast radius):

- Real-world verify Ashley will run herself post-ship:
  1. Open a session with a Bash{run_in_background:true} shell still running.
  2. Wait for Claude to go idle (PTY silent).
  3. Sidebar-dot on that session should NOT appear (was appearing prior to fix).
  4. WipBubble in PrettyView should still be mounted (unchanged).
  5. Cancel the background shell; both surfaces should update in lockstep to
     "ready" (dot appears, bubble unmounts) on the next
     `backgrounded_shells: []` frame.

## Automated coverage checklist

- [ ] session-working-store: 11 tests (A–K) all green.
- [ ] PrettyView WS-frame publishing exercised (Wip A–D) OR waived with reason
      per Task 3 behavior block.
- [ ] PrettyConversationsPanel-side tests all green with new mock signature.
- [ ] PrettyConversationRow tests unchanged and green (component contract preserved).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run` clean.
- [ ] `npm run build:backend` clean (defensive; task is frontend-only).

## Symbol-hygiene grep gates (run after Task 4)

```
grep -rn 'publishSessionWorking\|useSessionWorking' src tests 2>/dev/null | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*\*'
# Expected: 0 matches. Any hit is a missed consumer.

grep -rn 'publishSessionTtyBusy\|publishSessionHasBackgroundedWork\|useSessionIsWorking' src tests 2>/dev/null | wc -l
# Expected: >=6 (2 in store, 1 in Terminal, 3-4 in PrettyView, 1 in Panel, 4 in test mocks).
```

</verification>

<success_criteria>

**All must hold true before executor returns to orchestrator:**

1. `session-working-store` exports the new composite API and passes Tests A–K.
2. Terminal.tsx publishes via `publishSessionTtyBusy` (rename only).
3. PrettyView.tsx publishes `hasBgWork` on backgrounded_agents / backgrounded_shells
   frames AND on both reset paths (fresh-pane mount, session_changed) — using
   the composite-key format `${hostId}:${tmuxSession ?? ""}` that matches
   Terminal.tsx.
4. PrettyView.tsx WipBubble mount condition is `{isWorking && <WipBubble />}`
   where `isWorking = useSessionIsWorking(sessionWorkingKey)`.
5. PrettyConversationsPanel.tsx consumes `useSessionIsWorking(sessionKey)` and
   passes the resulting boolean to `<PrettyConversationRow isWorking=...>`;
   Row's tri-state prop shape preserved unchanged for test-authoring convenience.
6. All 4 pretty-conversations test-mock files updated to mock
   `useSessionIsWorking: () => false`.
7. Full test suite green (`npx vitest run` exits 0, zero failures).
8. Typecheck clean (`npx tsc --noEmit` exits 0).
9. Backend build clean (`npm run build:backend` exits 0) — defensive.
10. 4 atomic commits on `feat/tab-title-from-tmux`, each independently green
    (with Task 1's documented exception per its action block).
11. No push, no docker build, no deploy — executor stops after the last commit
    and returns control to Tina.

</success_criteria>

<output>
No SUMMARY file required for a quick task. Executor returns a
plain-text summary to Tina with:
- Commit SHAs (4 of them) on `feat/tab-title-from-tmux`.
- Confirmation the full-suite gate + typecheck + backend build all exit 0.
- Any deviations from the plan (e.g., "Task 3 dropped Wip A–D per behavior
  block escape hatch; store-level Tests A–K plus manual note cover the gap").
- Any pre-existing failures fixed en-route + one-line explanation.
</output>
