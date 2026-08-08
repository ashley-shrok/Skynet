---
quick_id: 260808-ohn
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/layer1-detect.ts
  - src/backend/claude-session/layer1-detect.test.ts
  - src/backend/claude-session/claude-session-server.layer1.test.ts
autonomous: true
requirements:
  - BOUNTY-session-holding-layer1-detect-id-reset-not-exit

must_haves:
  truths:
    - "SessionHoldingOverlay does not flash on WS reconnect for sessions whose most-recent user turn is not /id reset (even when historical /exit or historical /id reset lines exist in the JSONL)"
    - "SessionHoldingOverlay DOES arm on a session whose most-recent user turn IS /id reset (arm-on-load parity with true recycle)"
    - "Layer 2 discovery-repoll (new-UUID sessionFile) still fires transitionToHolding(\"discovery_diff\") + session_changed exactly as before — refactor only touches Layer 1"
    - "All existing tests continue to pass (fleet rule: never leave tests failing)"
  artifacts:
    - path: "src/backend/claude-session/layer1-detect.ts"
      provides: "Pure detection helpers (isUserTurn, isIdResetUserTurn) + Layer1 tail-state reducer + test seam"
    - path: "src/backend/claude-session/layer1-detect.test.ts"
      provides: "Unit tests for pure helpers + reducer state cases"
    - path: "src/backend/claude-session/claude-session-server.layer1.test.ts"
      provides: "Integration tests through the exported __applyLayer1LineForTests seam covering the concrete arm/clear/no-op cases"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts onLine handler (~line 1232-1255)"
      to: "src/backend/claude-session/layer1-detect.ts"
      via: "imports isIdResetUserTurn + isUserTurn; onLine now updates layer1State via applyLineToLayer1State and reads .action to fire transitionToHolding(\"id_reset\") or transitionFromHoldingToActiveSameFile()"
      pattern: "import.*layer1-detect|applyLineToLayer1State"
    - from: "src/backend/claude-session/claude-session-server.ts transitionToHolding (~line 1774)"
      to: "reason type union"
      via: "type change: \"exit_marker\" | \"discovery_diff\" → \"id_reset\" | \"discovery_diff\""
      pattern: "\"id_reset\"\\s*\\|\\s*\"discovery_diff\""
---

<objective>
Refactor Layer 1 fast-path recycle detector in `src/backend/claude-session/claude-session-server.ts` from an edge-triggered /exit scan (broken across WS reconnects: `hasSeenExit` resets on every `-n +1` tail replay, and every historical /exit line re-fires the overlay) to a tail-state-derived /id reset detector (correct across reconnects: the overlay is armed IFF the file's most-recent user turn is `/id reset`, computed uniformly across replay and live-append).

Purpose: Fixes Ashley's observed bug — SessionHoldingOverlay flashes for a few seconds on every conversation-list revisit of any session whose JSONL contains a historical /exit turn (empirically 14 arm+clear pairs in ~1h on session `owGv_6oxMc7Sd5o8kzt3O`; bounty `session-holding-layer1-detect-id-reset-not-exit`).

Output: Two production files (one refactored, one new pure-helper sibling) + two test files (helpers + integration via a new `__applyLayer1LineForTests` seam mirroring the existing `__applyRepollResultForTests` pattern), full vitest suite green, tsc clean.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/backend/claude-session/claude-session-server.ts
@src/backend/claude-session/session-file-tail.ts
@src/backend/claude-session/claude-session-server.repoll.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract Layer 1 detection into pure helpers + tail-state reducer, unit-tested</name>
  <files>
    src/backend/claude-session/layer1-detect.ts,
    src/backend/claude-session/layer1-detect.test.ts
  </files>
  <behavior>
    Pure helpers (no I/O, no dependencies on ssh2 / WebSocket / logger):

    - `isUserTurn(line: string): boolean` — cheapest raw-string check that the JSONL line represents a Claude Code user-role turn. Uses `line.includes('"type":"user"')`. Verified byte shape: session-file-parser.ts:213 filters on `obj.type !== "user"` after JSON.parse, so the raw-line substring form matches the same set. Does NOT JSON.parse.

    - `isIdResetUserTurn(line: string): boolean` — true iff `isUserTurn(line)` AND the line contains BOTH `<command-name>/id</command-name>` AND `<command-args>reset`. Uses `line.includes(...)` — no JSON.parse. The `<command-args>reset` check is intentionally a prefix match (args-STARTS-with `reset`) so Ashley's freeform explanation (e.g. `<command-args>reset because X</command-args>`) still fires. This is the ONLY function that decides "this line is an /id reset user turn".

    Tail-state reducer (stateful in the caller's box, itself pure of I/O):

    - `type Layer1State = { mostRecentUserTurnIsIdReset: boolean | null }` where `null` means "no user turn observed yet".
    - `type Layer1Action = "none" | "arm_holding" | "clear_holding"`.
    - `applyLineToLayer1State(line: string, state: Layer1State, currentChangeoverState: "active" | "holding" | "dead"): Layer1Action` — updates `state.mostRecentUserTurnIsIdReset` iff the line is a user turn (assistant / tool_use / tool_result / thinking / system-reminder / any non-user line: no state change, returns `"none"`), then decides an action from the new state + current changeoverState:
        - user turn AND now `mostRecentUserTurnIsIdReset === true` AND `currentChangeoverState === "active"` → `"arm_holding"`
        - user turn AND now `mostRecentUserTurnIsIdReset === false` AND `currentChangeoverState === "holding"` → `"clear_holding"`
        - otherwise → `"none"`
      The reducer itself does NOT call transitionToHolding / transitionFromHoldingToActiveSameFile — caller (claude-session-server onLine) does that based on the returned action. Same logic applies uniformly on `-n +1` replay AND live appends — this is Ashley's tail-state-derived model.

    Test cases (extend as needed to hit the acceptance criteria):

    `isIdResetUserTurn` positive:
    - Line with `"type":"user"` + `<command-name>/id</command-name>` + `<command-args>reset</command-args>` → true
    - Line with `"type":"user"` + `<command-name>/id</command-name>` + `<command-args>reset because I want to change roles</command-args>` (freeform trailing) → true

    `isIdResetUserTurn` negative:
    - `/id save` (args does not start with `reset`) → false
    - `/id tanya` (args does not start with `reset`) → false
    - `/gsd:quick` user turn (different slash command) → false
    - `/exit` user turn (leftover from before this refactor) → false
    - `"type":"assistant"` line that quotes the string `<command-args>reset` inside message content (assistant reflection) → false (fails `isUserTurn`)
    - Line with `<command-args>reset` but NOT `<command-name>/id</command-name>` (some other future /reset command) → false

    `isUserTurn`:
    - `"type":"user"` line → true
    - `"type":"assistant"` line → false
    - `"type":"system"` line → false
    - garbage/empty string → false

    `applyLineToLayer1State`:
    - initial state `{mostRecentUserTurnIsIdReset: null}` + non-user line → returns `"none"`, state unchanged
    - initial + /id reset user turn + changeoverState "active" → returns `"arm_holding"`, state now `{...: true}`
    - initial + /id reset user turn + changeoverState "holding" → returns `"none"` (already holding; no double-arm), state now `{...: true}`
    - state `{...: true}` + non-reset user turn + changeoverState "holding" → returns `"clear_holding"`, state now `{...: false}`
    - state `{...: true}` + non-reset user turn + changeoverState "active" → returns `"none"` (was already active; no spurious clear), state now `{...: false}`
    - state `{...: true}` + assistant/tool_use/tool_result/thinking line → returns `"none"`, state unchanged (non-user turns never change state)
    - state anything + changeoverState "dead" → returns `"none"` (dead is terminal — no arm, no clear)
    - Historical /id reset followed by a later regular user turn (fed line-by-line) → after the later user turn, `mostRecentUserTurnIsIdReset` is `false`, and if changeoverState was "active" throughout, no `"arm_holding"` action is ever produced. This is the Ashley bug fix in its purest form.
  </behavior>
  <action>
    Create `src/backend/claude-session/layer1-detect.ts` exporting `isUserTurn`, `isIdResetUserTurn`, the `Layer1State` / `Layer1Action` types, and `applyLineToLayer1State`. All functions pure, no imports from ssh2 / WebSocket / logger / anything I/O-shaped. Match project TypeScript style (single-quotes NOT used elsewhere in this dir — use double-quotes; explicit return types on exports; block comments explaining the WHY, not just the WHAT).

    Create `src/backend/claude-session/layer1-detect.test.ts` covering every case listed in `<behavior>`. Follow the vitest style used by neighbors (see `session-file-parser.test.ts` and `context-pct-from-jsonl.test.ts`): one top-level `describe` per function, `it()` per case, plain `expect(...).toBe(...)`. Use realistic JSONL line fixtures — build them by JSON.stringify-ing an object shaped like the empirical `/id` turn documented in the bounty spec (`"content":"<command-message>id</command-message>\\n<command-name>/id</command-name>\\n<command-args>reset</command-args>"`) so the tests protect against future refactors that change the byte-shape assumptions.

    TDD order: write `layer1-detect.test.ts` first (RED — file layer1-detect.ts does not exist yet, imports fail), then create `layer1-detect.ts` (GREEN — all tests pass). One RED commit + one GREEN commit is fine, or a single combined commit is fine per project convention (see e95a9cd/91c5893 pattern in STATE.md for TDD splits, and the recent 260808-1pa single commit for combined). Executor picks whichever fits the change size.

    Do NOT touch `claude-session-server.ts` in this task — helper extraction ships standalone and can be reviewed/reverted independently.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tanya &amp;&amp; npx vitest run src/backend/claude-session/layer1-detect.test.ts</automated>
  </verify>
  <done>
    - `layer1-detect.ts` exists, exports the four named symbols above, uses no I/O imports
    - `layer1-detect.test.ts` exists, all cases from `<behavior>` are covered, all pass
    - `npx tsc --noEmit` still exits 0 (no type errors introduced in the extraction)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rewire onLine to use tail-state reducer; delete /exit path; update transitionToHolding reason type; integration tests via new __applyLayer1LineForTests seam</name>
  <files>
    src/backend/claude-session/claude-session-server.ts,
    src/backend/claude-session/layer1-detect.ts,
    src/backend/claude-session/claude-session-server.layer1.test.ts
  </files>
  <behavior>
    Integration behavior through the new `__applyLayer1LineForTests` seam (mirrors `__applyRepollResultForTests` at line 868 exactly in shape — pure function, injectable state + helpers, no WS / SSH / logger):

    Signature:
    ```
    export type __Layer1StateForTests = {
      changeoverState: "active" | "holding" | "dead";
      layer1: Layer1State;
    };
    export type __Layer1HelpersForTests = {
      transitionToHolding: (reason: "id_reset" | "discovery_diff") =&gt; void;
      transitionFromHoldingToActiveSameFile: () =&gt; void;
    };
    export function __applyLayer1LineForTests(
      line: string,
      state: __Layer1StateForTests,
      helpers: __Layer1HelpersForTests,
    ): void;
    ```

    Test cases (in `claude-session-server.layer1.test.ts`, mirroring the case-by-case describe blocks of `claude-session-server.repoll.test.ts`):

    - Case 1: Fresh `-n +1` replay of a session whose history is: user turn (regular text) → assistant → user turn (/id reset) → assistant → user turn (regular text). Fed line-by-line, changeoverState starts "active", stubs bound. Expected: `transitionToHolding` fires once (with reason "id_reset") after the /id reset line while state is still "active", then when the seam's stub for transitionToHolding flips changeoverState to "holding", the LAST regular user turn fires `transitionFromHoldingToActiveSameFile`. Final state.changeoverState === "active". Total transitions: 1 arm + 1 clear.

    - Case 2: Same shape but the final turn is ALSO a /id reset user turn (i.e. most-recent-user-turn IS /id reset). Expected: 1 arm, 0 clears, final state.changeoverState === "holding".

    - Case 3: History contains ONLY regular user turns (no /id reset at all) + a stray line containing the literal bytes `<command-args>reset` inside an assistant message. Expected: zero calls to either helper, state.changeoverState stays "active" throughout. This is the exact Ashley-bug regression guard.

    - Case 4: History contains a historical `/exit` user turn (leftover from pre-refactor sessions). Expected: zero calls to either helper (the whole /exit path is gone from Layer 1).

    - Case 5: While changeoverState === "holding" (set up by test seed), an assistant / tool_use / tool_result / thinking line is fed. Expected: NO clear fires (only USER turns can clear).

    - Case 6: changeoverState === "dead" (terminal). Any line fed. Expected: NO helper call under any circumstance.

    - Case 7: Live-append after a session has already stabilized: state.layer1.mostRecentUserTurnIsIdReset === false, changeoverState === "active". A NEW user turn arrives that IS /id reset. Expected: `transitionToHolding("id_reset")` fires. (Live-tail path shares the same seam — same-code-path guarantee.)

    - Case 8: Live-append clear: state.layer1.mostRecentUserTurnIsIdReset === true, changeoverState === "holding". A NEW regular user turn arrives. Expected: `transitionFromHoldingToActiveSameFile()` fires.
  </behavior>
  <action>
    In `src/backend/claude-session/layer1-detect.ts` (already created by Task 1), ALSO export `__applyLayer1LineForTests` plus its two types. Implementation just calls `applyLineToLayer1State`, switches on the returned action, and invokes the appropriate helper — the exact code path production `onLine` will use. This co-locates the seam with the reducer so the two cannot drift.

    In `src/backend/claude-session/claude-session-server.ts`:

    1. Delete `hasSeenExit` declaration at line 1100 and its two reset sites at line 1183 (teardownPane) and line 1871 (transitionToActiveNew). Instead declare `let layer1: Layer1State = { mostRecentUserTurnIsIdReset: null };` at the same scope as `changeoverState` (line 1097 area). Reset it to `{ mostRecentUserTurnIsIdReset: null }` at the same two sites (teardownPane + transitionToActiveNew — both are per-connection resets where a fresh tail is about to start).

    2. Replace the lines 1235-1255 block (the raw-line /exit include-check that fires `transitionToHolding("exit_marker")`) with a call into the extracted reducer:
       ```
       const action = applyLineToLayer1State(line, layer1, changeoverState);
       if (action === "arm_holding") transitionToHolding("id_reset");
       else if (action === "clear_holding") transitionFromHoldingToActiveSameFile();
       ```
       Update the surrounding block comment to describe the new tail-state-derived model (Ashley's design point 2) and to cite the bounty `session-holding-layer1-detect-id-reset-not-exit`. Remove the "DO NOT return here" caveat's /exit-specific wording; the same "fall through to the JSON.parse-based paths below" invariant still holds (the state transition is orthogonal to whether the /id reset turn renders as a chat bubble), so preserve a version of that comment adapted to /id reset.

    3. Update `transitionToHolding`'s reason type at line 1774-1776: `"exit_marker" | "discovery_diff"` → `"id_reset" | "discovery_diff"`. The Layer 2 call sites at lines 881, 889, 3975, 3989 already pass `"discovery_diff"` — leave alone (verify via grep after the change: `grep -n '"exit_marker"' src/backend/claude-session/claude-session-server.ts` MUST return zero hits post-refactor).

    4. Also update the `__RepollHelpersForTests` type at line 850: `transitionToHolding: (reason: "exit_marker" | "discovery_diff")` → `transitionToHolding: (reason: "id_reset" | "discovery_diff")`. This keeps the test-seam type union honest and matches the production signature.

    5. Import `isUserTurn`, `isIdResetUserTurn`, `applyLineToLayer1State`, `Layer1State` from `./layer1-detect.js` at the top of `claude-session-server.ts` (alongside the existing `./session-file-parser.js` and `./session-file-tail.js` imports — match the ESM `.js` extension convention already in use).

    Create `src/backend/claude-session/claude-session-server.layer1.test.ts` with the 8 cases in `<behavior>`. Follow the harness pattern from `claude-session-server.repoll.test.ts` verbatim: `makeState()` helper for the state box, `makeHelpers()` helper returning stubs + individual refs, one `describe` per case, stubs that mutate `state.changeoverState` when needed to mirror the real helper's effect (see repoll.test.ts case (b) and (c) for the two mutating-stub styles).

    TDD order: write `claude-session-server.layer1.test.ts` referencing `__applyLayer1LineForTests` first (RED — the export does not exist), then add the export to `layer1-detect.ts` and rewire `claude-session-server.ts` (GREEN — all tests pass). Existing tests must ALSO all pass (repoll.test.ts case type change from "exit_marker" to "id_reset" only affects the type union used in its type declarations — it never passes "exit_marker" as an argument, so the change should be either transparent or a one-line type-annotation edit; make whatever minimal edits repoll.test.ts needs to typecheck without weakening its assertions).

    Byte gates after code change (run before final commit):
    - `grep -n '"exit_marker"' src/backend/claude-session/claude-session-server.ts` → 0 hits
    - `grep -n 'hasSeenExit' src/backend/claude-session/claude-session-server.ts` → 0 hits
    - `grep -n "line.includes('\"content\":\"&lt;command-name&gt;/exit&lt;/command-name&gt;')" src/backend/claude-session/claude-session-server.ts` → 0 hits
    - `grep -n '"id_reset"' src/backend/claude-session/claude-session-server.ts` → at least 2 hits (type union + call site)
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tanya &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
  </verify>
  <done>
    - `hasSeenExit` and the `"exit_marker"` literal are gone from `claude-session-server.ts`
    - onLine invokes `applyLineToLayer1State` and dispatches to `transitionToHolding("id_reset")` / `transitionFromHoldingToActiveSameFile()`
    - `transitionToHolding`'s reason union is `"id_reset" | "discovery_diff"` in both the function signature (line ~1774) AND the `__RepollHelpersForTests` type (line ~850)
    - Layer 2 call sites (lines 881, 889, 3975, 3989) are unchanged — still pass `"discovery_diff"`
    - `__applyLayer1LineForTests` is exported from `layer1-detect.ts` with types `__Layer1StateForTests` and `__Layer1HelpersForTests`
    - `claude-session-server.layer1.test.ts` covers all 8 cases and passes
    - `npx tsc --noEmit` exits 0
    - Full `npx vitest run` reports zero failing tests (fleet rule: never leave tests failing regardless of where they came from). Prior baseline from STATE.md 2026-08-08 was 1526 passed / 6 skipped / 0 failed across 123 files; expect at minimum +2 new files (helper unit tests + integration seam tests) with all new tests passing and zero regressions in the pre-existing 1526.
  </done>
</task>

</tasks>

<verification>
Whole-refactor sanity checks (in addition to per-task <verify> commands):

1. Symptom reproduction check (manual reasoning — no live SSH needed): Trace the code path for the Ashley bug scenario. WS reconnect on a session whose JSONL contains 2 historical /exit lines followed by 12 assistant/user turns none of which are /id reset. With the refactor:
   - teardownPane runs → layer1 resets to `{mostRecentUserTurnIsIdReset: null}`, changeoverState resets to "active"
   - Fresh tail with `-n +1` replays every line
   - Each /exit line: `isUserTurn` may match (user turn with /exit content) → `isIdResetUserTurn` returns false → layer1.mostRecentUserTurnIsIdReset becomes false → action "none" (state is "active", not "holding")
   - Each subsequent regular user turn: same → mostRecentUserTurnIsIdReset stays false → "none"
   - Zero calls to transitionToHolding from Layer 1 during replay → overlay never flashes → bug fixed.

2. `grep -c "hasSeenExit" src/backend/claude-session/claude-session-server.ts` → 0 (via `grep -v '^#' | grep -c` if the file had shell-style comments; TS block comments are not counted by grep-line so plain grep is fine).

3. `grep -c "exit_marker" src/backend/claude-session/claude-session-server.ts` → 0.

4. Full `npx vitest run` reports zero failing tests across all files.

5. `npx tsc --noEmit` exits 0.
</verification>

<success_criteria>
- Layer 1 detector is now tail-state-derived (arms iff most-recent user turn is /id reset), not edge-triggered
- The /exit code path is entirely removed (hasSeenExit gone, `<command-name>/exit</command-name>` literal gone, "exit_marker" reason gone)
- Pure detection helpers `isUserTurn` + `isIdResetUserTurn` + reducer `applyLineToLayer1State` live in a sibling `layer1-detect.ts` and are unit-tested with realistic JSONL fixtures
- Integration seam `__applyLayer1LineForTests` co-located with the reducer, mirrors the `__applyRepollResultForTests` pattern, covers all 8 acceptance cases including the exact Ashley-bug regression guard (Case 3 + Case 4)
- Layer 2 (discovery-repoll) is byte-untouched — same session_holding_cleared + session_changed WS frame behavior
- `npx tsc --noEmit` exits 0, full `npx vitest run` is fully green with zero regressions vs the 1526/6/0 baseline from STATE.md 2026-08-08
- No push, no build, no deploy performed by this plan (per project rule: code work doesn't authorize ship; Ashley greenlights deploys separately)
</success_criteria>

<output>
Two atomic commits recommended (TDD split, matching prior quick-task convention):

1. `feat(quick-260808-ohn-01): extract Layer 1 detection helpers + reducer with unit tests` (Task 1 output)
2. `refactor(quick-260808-ohn-02): Layer 1 fast-path uses /id reset tail-state, drop /exit edge-trigger` (Task 2 output — combines the rewire + integration tests + type union update; the type change is inseparable from the call-site change)

A single combined commit is also acceptable if the executor prefers (see 260807-igo pattern in STATE.md). Do NOT push. Do NOT build. Do NOT deploy. Ashley greenlights ship separately.

Create `.planning/quick/260808-ohn-refactor-layer-1-fast-path-recycle-detec/260808-ohn-SUMMARY.md` when done, following the quick-task summary shape used by prior quicks (short — what changed, why, verification result line, ship-status line).
</output>
