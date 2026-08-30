---
phase: quick-260806-dwe
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/identity-harness-start.ts
  - src/backend/database/routes/identity-harness-start.test.ts
  - src/backend/database/routes/identity-birth-orchestrator.ts
  - src/backend/database/routes/identity-clone.ts
  - src/backend/database/routes/identity-clone.test.ts
  - src/ui/sidebar/CloneAgentDialog.tsx
  - src/ui/sidebar/CloneAgentDialog.test.tsx
autonomous: true
requirements:
  - quick-260806-dwe

must_haves:
  truths:
    - "Clone flow leaves the new tmux session with a live Claude harness and an /id-set identity BEFORE the frontend routes the user into the new tab (pretty-view shows a real session, not 'no active Claude session')"
    - "Birth flow behavior is byte-identical to before: same SSH commands sent in the same order, same SSE step 1..5 events emitted to the frontend, same tuned constants (7 Enters × 3s, 2s post-launch sleep, CLAUDE_LAUNCH_CMD_PREFIX)"
    - "The harness-start sequence (trust-flag pre-write, claude launch, 2s sleep, 7-Enter train × 3s spacing, /id <name> + Enter) lives in exactly ONE place — identity-harness-start.ts — and is imported by both birth and clone"
    - "CloneAgentDialog gives the user a visible signal ('Preparing session…' or equivalent) during the ~25s wait so the modal does not feel hung"
    - "npx vitest run exits 0 — the existing 18 birth-orchestrator tests and 12 clone-route tests still pass with the same OUTCOME assertions"
  artifacts:
    - path: "src/backend/database/routes/identity-harness-start.ts"
      provides: "startHarnessOnIdentity({exec, name, remotePath}) — extracted verbatim from birth-orchestrator L505-573"
      exports: ["startHarnessOnIdentity"]
    - path: "src/backend/database/routes/identity-harness-start.test.ts"
      provides: "Unit tests asserting the extracted helper fires the exact 11-command tmux sequence (trust-flag → launch → Enter → 7×Enter train → /id → Enter)"
    - path: "src/backend/database/routes/identity-birth-orchestrator.ts"
      provides: "Rewired steps 3-5 to delegate to startHarnessOnIdentity; existing behavior preserved"
    - path: "src/backend/database/routes/identity-clone.ts"
      provides: "Calls startHarnessOnIdentity after tmux new-session succeeds; endpoint response shape unchanged"
    - path: "src/ui/sidebar/CloneAgentDialog.tsx"
      provides: "Existing 'Creating…' state extended with 'Preparing session…' subtext during the slow await"
  key_links:
    - from: "src/backend/database/routes/identity-birth-orchestrator.ts"
      to: "src/backend/database/routes/identity-harness-start.ts"
      via: "import { startHarnessOnIdentity }"
      pattern: "startHarnessOnIdentity"
    - from: "src/backend/database/routes/identity-clone.ts"
      to: "src/backend/database/routes/identity-harness-start.ts"
      via: "import { startHarnessOnIdentity }"
      pattern: "startHarnessOnIdentity"
    - from: "src/ui/sidebar/CloneAgentDialog.tsx"
      to: "src/backend/database/routes/identity-clone.ts"
      via: "cloneIdentity() await — blocks until harness-start completes on backend"
      pattern: "await cloneIdentity"
---

<objective>
Extract the birth-orchestrator's harness-start sequence (steps 3-5: trust-flag pre-write, claude launch, 2s sleep, 7-Enter train × 3s, /id <name> + Enter) into a shared module `identity-harness-start.ts`, rewire birth to use it (behavioral parity — same commands, same SSE events), then call it from `identity-clone.ts` immediately after `tmux new-session -d ...` so cloneIdentity's HTTP response only fires once the Claude harness is live and `/id <name>` has been sent. This closes the UAT gap surfaced by patch #321: NewSessionDialog's `onCreate` was routing into a bare tmux with no Claude process, and pretty-view rendered "no active Claude session".

Purpose: Give clone the same three-step post-tmux bootstrap that birth already runs. Zero duplication of the Nelly-tuned constants — helper IMPORTS the constants from birth-orchestrator so birth stays the source of truth for the settings (already tagged "Nelly §..." + cross-ref agent-supervisor.sh:333). Small frontend UX addition so the ~25s spin doesn't feel hung.

Output:
  - New: `src/backend/database/routes/identity-harness-start.ts` (~60 lines) + its `.test.ts` (~150 lines)
  - Modified: `src/backend/database/routes/identity-birth-orchestrator.ts` (steps 3-5 delegate to helper)
  - Modified: `src/backend/database/routes/identity-clone.ts` (calls helper after tmux new-session)
  - Modified: `src/backend/database/routes/identity-clone.test.ts` (asserts helper invoked)
  - Modified: `src/ui/sidebar/CloneAgentDialog.tsx` (subtext during slow await) + its `.test.tsx` (assertion on the new text)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
# Source-of-truth for the extraction (steps 3-5 body lives here at L505-573,
# constants at L28-59). Task 1 lifts this VERBATIM.
@src/backend/database/routes/identity-birth-orchestrator.ts

# Existing 18-test suite — the regression guard for Task 2. Behavioral parity
# means these must still pass (call-order + emitted events + exec strings).
@src/backend/database/routes/identity-birth-orchestrator.test.ts

# Task 3 caller. The insertion point is right after L497-500 (the mkdir + tmux
# new-session exec) inside the same try/catch that catches "SSH exec failed".
# Note: identity-clone.ts already re-declares local copies of shellSingleQuote,
# shellPath, and normalizeRemotePath — the helper does its OWN escaping so
# clone's local copies remain undisturbed.
@src/backend/database/routes/identity-clone.ts

# Task 3 test extension.
@src/backend/database/routes/identity-clone.test.ts

# Task 3 UI edit. Existing "Creating…" state comes from patch #320 at L476
# (`{submitting ? "Creating..." : createLabel}`). New subtext goes near the
# submitError span (L451-455) so it renders in the same visual slot when
# submitting=true (mutually exclusive with an error).
@src/ui/sidebar/CloneAgentDialog.tsx

# Existing CloneAgentDialog test file (Tests 17-23 already present). New test
# is Test 24 (or equivalent index) at the end of the describe block.
@src/ui/sidebar/CloneAgentDialog.test.tsx

# execCommand's shape — helper's `exec` param is exactly this Promise<string>
# shape. Clone builds `(cmd) => execWithTimeout(conn, cmd)` closure; birth
# already builds an `exec` closure inside birthIdentity() (L329-335).
@src/backend/ssh/tmux-helper.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract startHarnessOnIdentity helper + unit tests</name>
  <files>src/backend/database/routes/identity-harness-start.ts, src/backend/database/routes/identity-harness-start.test.ts</files>
  <behavior>
    - Test A: FIRST exec call after invocation is the trust-flag node one-liner: matches /node -e/ AND contains "hasTrustDialogAccepted=true" AND ends with the escaped remotePath as the trailing argv (e.g. `'/home/test'`).
    - Test B: SECOND exec call is `tmux send-keys -t test -l '<launch cmd>'` where the launch cmd contains BOTH `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999` AND `CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999` AND `claude --dangerously-skip-permissions` (import CLAUDE_LAUNCH_CMD_PREFIX from birth-orchestrator to make the assertion self-checking).
    - Test C: THIRD exec call is exactly `tmux send-keys -t test Enter` (the first Enter after launch — no -l flag).
    - Test D: Between the launch-Enter (call #3) and the /id call, EXACTLY 7 more `tmux send-keys -t test Enter` calls fire (ENTER_TRAIN_COUNT = 7 imported from birth-orchestrator). Assert via a filter of mock.calls whose cmd matches /tmux send-keys -t test Enter$/ AND does not include "-l" — count === 8 total (1 launch-Enter + 7 train).
    - Test E: SECOND-TO-LAST exec call is `tmux send-keys -t test -l '/id test'`.
    - Test F: LAST exec call is `tmux send-keys -t test Enter`.
    - Test G: Timing — with vi.useFakeTimers() + advancing 2000ms + 6*3000ms (last Enter has no post-sleep per birth's `if (i < ENTER_TRAIN_COUNT - 1)`), the helper's returned promise resolves; a sanity assertion that the promise does NOT resolve when timers are only advanced 1999ms (proves the 2s sleep exists).
    - Test H: The remotePath is passed through shellSingleQuote-style escaping — call `startHarnessOnIdentity({exec, name: "test", remotePath: "/home/user's dir"})` and assert the trust-flag command's trailing arg is `'/home/user'\''s dir'` (single-quote escape). This guards against future refactors dropping the escape.
    - Test I: name is shell-escaped in the /id payload — call with name containing a single-quote-safe char (test with name: "test") and assert `/id test` appears literally inside single quotes (`'/id test'`). Note: the helper does not need to re-validate name against IDENTITY_KEY_RE / TMUX_SAFE_NAME_RE — those gates already run in birthIdentity(); clone gates via IDENTITY_KEY_RE at the HTTP body validation layer. Add a JSDoc note on the exported function stating "caller must pre-validate name against tmux-safe pattern".
  </behavior>
  <action>
    Create `src/backend/database/routes/identity-harness-start.ts` exporting ONE function:

    ```
    export async function startHarnessOnIdentity(opts: {
      exec: (cmd: string) => Promise<string>;
      name: string;
      remotePath: string;
    }): Promise<void>
    ```

    Body is a VERBATIM extraction of identity-birth-orchestrator.ts L505-573 (the three runStep(3), runStep(4), runStep(5) BODIES — NOT the runStep wrappers themselves; those stay in birth for the SSE contract). The extracted body must:
      1. Build the trust-flag command exactly as birth does (node -e one-liner + escaped remotePath as trailing argv).
      2. Call `exec(trustCmd)`.
      3. Call `exec(`tmux send-keys -t ${name} -l ${shellSingleQuote(claudeCmd)}`)`.
      4. Call `exec(`tmux send-keys -t ${name} Enter`)`.
      5. `await sleep(STEP_3_SLEEP_MS)`.
      6. Loop i=0..ENTER_TRAIN_COUNT-1: `await exec(`tmux send-keys -t ${name} Enter`)` then `if (i < ENTER_TRAIN_COUNT - 1) await sleep(ENTER_TRAIN_SPACING_MS)`.
      7. `await exec(`tmux send-keys -t ${name} -l ${shellSingleQuote(`/id ${name}`)}`)`.
      8. `await exec(`tmux send-keys -t ${name} Enter`)`.

    Constants: IMPORT `CLAUDE_LAUNCH_CMD_PREFIX`, `STEP_3_SLEEP_MS`, `ENTER_TRAIN_COUNT`, `ENTER_TRAIN_SPACING_MS` from `./identity-birth-orchestrator.js` (they're already `export const` at L28-59). Do NOT duplicate them and do NOT move them out of birth — birth stays the authoritative source (they carry "Nelly §..." tags + cross-ref to agent-supervisor.sh line 333, and moving them would force cascading test-import updates).

    Local helpers: copy `shellSingleQuote` and `sleep` from birth-orchestrator (both are tiny private functions there — birth's private copies stay put; helper gets its own copies to keep the module standalone). Do NOT try to `export` them from birth just to import here — the diff cost is not worth the shared-utility abstraction for two functions each < 10 lines.

    JSDoc on the export: brief summary, a note that the caller MUST have pre-validated `name` against tmux-safe pattern (IDENTITY_KEY_RE at minimum), and a note that remotePath must ALREADY be normalized ($HOME-expanded — helper does NOT re-run birth's step 0b path normalization; that's the caller's job). Cross-reference agent-supervisor.sh:105-142 + 326-340 as the source-of-truth for the sequence.

    Create `src/backend/database/routes/identity-harness-start.test.ts` mirroring the mock pattern from identity-birth-orchestrator.test.ts:
      - `vi.useFakeTimers({ shouldAdvanceTime: false })` in beforeEach; `vi.useRealTimers()` + `vi.clearAllMocks()` in afterEach.
      - Test helper: `const exec = vi.fn().mockResolvedValue("")`.
      - For tests A-F+H+I: call `startHarnessOnIdentity({exec, name, remotePath})`, `await vi.runAllTimersAsync()`, `await` the returned promise, then inspect `exec.mock.calls` (each call is a single-arg `[cmd: string]` tuple). Use index-based assertions (`exec.mock.calls[0][0]`, `[1][0]`, etc.) for A/B/C/E/F ordering; use filter+length for D.
      - For test G (timing): use `vi.advanceTimersByTimeAsync(1999)` and assert the promise did NOT resolve (via a Promise.race with `Promise.resolve("still-pending")`), then advance the remaining ms and assert it resolves. Match the timing-test pattern from birth-orchestrator.test.ts Test 7 / Test 11.

    Follow existing test file conventions (imports style, describe blocks, `it()` names starting with "Test X:"). Backend edit → after implementation run `npm run build:backend && npm run build` before verify (per patch #154 learned rule) — if build fails, fix TS errors before proceeding.
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identity-harness-start.test.ts</automated>
  </verify>
  <done>
    identity-harness-start.ts exports startHarnessOnIdentity with the documented signature; identity-harness-start.test.ts asserts all 9 behaviors (A-I) and exits 0 under `npx vitest run`; `npm run build:backend && npm run build` succeeds with no TS errors; constants CLAUDE_LAUNCH_CMD_PREFIX / STEP_3_SLEEP_MS / ENTER_TRAIN_COUNT / ENTER_TRAIN_SPACING_MS are IMPORTED from identity-birth-orchestrator.ts (grep for `import.*identity-birth-orchestrator` in the new file returns a match).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rewire birth-orchestrator to delegate steps 3-5 to the helper</name>
  <files>src/backend/database/routes/identity-birth-orchestrator.ts</files>
  <behavior>
    - All 18 existing tests in identity-birth-orchestrator.test.ts continue to pass without modifying their OUTCOME assertions.
    - Specifically: Test 1 (happy path emits 11 events in order — 5 started + 5 completed + 1 ended); Test 8 (trust-flag BEFORE launch); Test 9 (no `-t "=` syntax); Test 10 (both env-vars present, launch uses -l, separate Enter follows); Test 11 (>= 7 non-literal Enters fire); Test 13 (`/id testkey` with -l then Enter); Test 14 (step-3 failure emits step:3:failed and skips /id — the helper's rejected exec must propagate through the runStep(3) wrapper).
    - The three `runStep(3, ...)`, `runStep(4, ...)`, `runStep(5, ...)` calls REMAIN as three separate calls, each emitting `step:{3|4|5}:{started,completed,failed}` events to preserve the SSE contract (identity-birth.ts:224-226 forwards every BirthEvent as `event: birth\ndata: {...}\n\n`; the frontend's BirthProgress checklist depends on step 3/4/5 arriving as distinct events).
  </behavior>
  <action>
    First, confirm the SSE contract dependency: identity-birth.ts (already read in context) emits every BirthEvent verbatim as `event: birth`. The frontend consumer treats step 3/4/5 as separate progress ticks. Therefore, keep three runStep() calls in birthIdentity — do NOT collapse into a single runStep(3, () => startHarnessOnIdentity(...)).

    Rewire strategy: split the helper's internal sequence at step boundaries by having the orchestrator call the helper as ONE unit but keep the emitted events. Two approaches — pick ONE:

    Approach A (preferred, simpler diff): Keep three runStep wrappers but SYNTHETICALLY complete steps 3+4 back-to-back via emit calls, and run the helper inside runStep(3). Concretely:
      - Replace L509-573 with:
        ```
        await runStep(3, async () => {
          await startHarnessOnIdentity({
            exec,       // birth's local exec closure at L329-335
            name: opts.name,
            remotePath: escPath,   // already normalized+escaped at L431
          });
        });
        // Preserve the SSE 5-event contract: emit synthetic started/completed
        // for steps 4 and 5 so the frontend checklist still ticks 5 items.
        // These are informational only — the actual work happened inside step 3.
        emit({ type: "step", n: 4, phase: "started" });
        emit({ type: "step", n: 4, phase: "completed" });
        emit({ type: "step", n: 5, phase: "started" });
        emit({ type: "step", n: 5, phase: "completed" });
        ```
      - Trade-off: on failure inside the helper, the whole harness-start attributes to step 3 (so a /id-send failure surfaces as step:3:failed, not step:5:failed). This is acceptable because the frontend's failure UX just shows "step failed at N" and offers no per-step recovery. Test 14 already asserts step 3 as the failure step for a claude-launch failure — that assertion still passes.
      - Downside: Test 11 counts Enters and expects the timing between step 2 and the Enter train to be observable via callLog. Since the helper is inside runStep(3), timing is still tracked correctly (the runStep wrapper doesn't insert sleeps).

    Approach B (if Approach A breaks Tests 7/11 timing assertions): Add an OPTIONAL `emit` callback parameter to startHarnessOnIdentity that fires `{type:"step", n: 4|5, phase: "started"|"completed"}` at the natural boundaries (after the 2s sleep completes → step 3 completed, step 4 started; after the last Enter of the train → step 4 completed, step 5 started; after the final Enter → step 5 completed). Then in birth, wrap the helper in runStep(3, () => startHarnessOnIdentity({exec, name, remotePath, emit: birthEmit})). Trade-off: helper is no longer purely "run this sequence" — it knows about birth's SSE contract. This is a leaky abstraction, hence Approach A is preferred.

    IMPLEMENTATION STEPS:
      1. Add import at top of identity-birth-orchestrator.ts: `import { startHarnessOnIdentity } from "./identity-harness-start.js";`
      2. Try Approach A first (delete L509-573, replace with the block above).
      3. Run `npm run build:backend && npm run build`.
      4. Run `npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts`.
      5. If all 18 tests pass — done. If a test breaks on ORDERING/OUTCOME (not just call-count), diagnose:
         - If Test 7 (timing between step 2 and step 3) fails because the callLog no longer shows a distinct step-3 command signature: the helper's calls still contain `hasTrustDialogAccepted` and `dangerously-skip-permissions`, so Test 7's step3Calls filter still matches. Should pass.
         - If Test 11 (Enter train count >= 7) fails: the helper still fires 8 non-literal Enters (1 post-launch + 7 train). Should pass.
         - If Test 14 (step 3 failure) fails on `failedStep === 3`: the helper's claude-launch exec still rejects, still propagates out of runStep(3), still emits step:3:failed. Should pass.
      6. If a test breaks on the ORCHESTRATION-level events (e.g. "expected 5 step:started events, got 3"), the synthetic emit block for steps 4+5 is the fix — verify it's present and correctly ordered.
      7. Any test that introspects the private `runStep` boundaries between steps 3/4/5 (e.g. asserts step 4 started AFTER step 3 completed with a specific timing gap): adjust the ORCHESTRATION assertion (e.g. change "step 4 started after step 3 completed" to "step 4 started event exists after step 3 completed event" — which the synthetic emits satisfy). Do NOT change the OUTCOME (Enter count, cmd shape, failure attribution).
      8. DO NOT remove the `sleep` function or the ENTER_TRAIN_COUNT/ENTER_TRAIN_SPACING_MS/STEP_3_SLEEP_MS/CLAUDE_LAUNCH_CMD_PREFIX exports from birth-orchestrator — the helper imports them, and the test file at L62-72 imports them for constant-sanity checks.

    After tests pass, `git diff` should show the diff is ~65 removed lines (steps 3-5 bodies) + ~10 added lines (import + delegating runStep call + synthetic step 4+5 emits) = net ~55 lines smaller in birth-orchestrator.ts.
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts src/backend/database/routes/identity-birth.test.ts</automated>
  </verify>
  <done>
    All 18 birth-orchestrator tests + role-frontmatter tests + identity-birth route tests pass exit 0; `npm run build:backend && npm run build` succeeds; `grep -c "startHarnessOnIdentity" src/backend/database/routes/identity-birth-orchestrator.ts` returns >= 2 (one import, one call site); `grep -c "hasTrustDialogAccepted\|dangerously-skip-permissions\|ENTER_TRAIN_COUNT.*for\|/id \${" src/backend/database/routes/identity-birth-orchestrator.ts | grep -v '^#'` shows the extracted sequence is no longer present in birth (constants may still appear at the export declarations at L28-59 — those STAY).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add harness-start to clone endpoint + extend clone tests + CloneAgentDialog subtext</name>
  <files>src/backend/database/routes/identity-clone.ts, src/backend/database/routes/identity-clone.test.ts, src/ui/sidebar/CloneAgentDialog.tsx, src/ui/sidebar/CloneAgentDialog.test.tsx</files>
  <behavior>
    Backend (identity-clone.ts):
    - After the `tmux new-session -d ...` exec at L497-500 succeeds, cloneIdentity calls `startHarnessOnIdentity({exec: (cmd) => execWithTimeout(conn, cmd), name: newName, remotePath: escWorkingPath})` and AWAITS it before proceeding to $HOME resolution / SFTP write / DB insert.
    - Endpoint response shape is UNCHANGED (still 201 + publicIdentity(newRow); no new fields; error status codes unchanged).
    - If startHarnessOnIdentity throws, the outer try/catch at L501-511 catches it and returns 502 "SSH exec failed" (same as an mkdir failure — same class of error, same recovery UX).
    - Latency increases by ~25s (2s post-launch sleep + 6 × 3s Enter-train gaps + exec RTT overhead). Frontend already awaits the fetch.

    Clone tests (identity-clone.test.ts):
    - Extend Test 8 (happy path) OR add a new Test 13 that asserts `startHarnessOnIdentity` (mocked) was called exactly once, with `{name: <newName>, remotePath: <escaped-path>}` and an `exec` function that when invoked routes through the mocked execCommand. Simplest form: mock the helper module wholesale via `vi.mock("./identity-harness-start.js", () => ({ startHarnessOnIdentity: vi.fn().mockResolvedValue(undefined) }))` and assert `expect(startHarnessOnIdentity).toHaveBeenCalledWith(expect.objectContaining({ name: "clone-name", remotePath: expect.any(String) }))` after a successful clone.
    - Add a Test 14 (or equivalent) asserting that if `startHarnessOnIdentity` REJECTS (mock `.mockRejectedValueOnce(new Error("harness failed"))`), the endpoint returns 502 with `{error: "SSH exec failed"}` AND the DB insert did NOT run (dbState.rows is unchanged after the call). This guards the ordering: harness-start must happen BEFORE DB insert, so a failure cleanly rolls back the "identity registered but harness dead" half-state.

    Frontend (CloneAgentDialog.tsx):
    - While `submitting === true`, an accessible status line reading "Preparing session…" (or a similar signal) renders under the modal body — sibling to the existing `submitError` span. It disappears when submitting flips false (either on resolve or on error). The button label continues to show "Creating..." (unchanged from patch #320).
    - The subtext is a single short line, no spinner glyph needed (the "Creating..." button text is the primary spinner-equivalent). Use `role="status"` + `aria-live="polite"` so screen readers announce it.

    Frontend test (CloneAgentDialog.test.tsx):
    - Add a Test (index sequential to existing Test 23 — call it Test 24) asserting: while `mockCloneIdentity` is pending (use a Promise that doesn't resolve immediately: `let resolvePromise: (v: Identity) => void; mockCloneIdentity.mockReturnValueOnce(new Promise(r => { resolvePromise = r; }))`), fill the form, click Clone, and `await waitFor(() => screen.getByText(/preparing session/i))` succeeds. Then call `resolvePromise(makeIdentity(...))`, `await waitFor(() => expect(screen.queryByText(/preparing session/i)).toBeNull())` succeeds.
  </behavior>
  <action>
    STEP A — identity-clone.ts backend edit:
      1. Add import near L114: `import { startHarnessOnIdentity } from "./identity-harness-start.js";`
      2. Locate the exec block at L497-500 (the `mkdir ${escWorkingPath} && (tmux has-session ... || tmux new-session ...)` call). This is inside the try/catch that ends at L511 (catches provision errors and returns 502).
      3. Immediately AFTER that `execWithTimeout(...)` call, still INSIDE the same try block, add:
         ```
         // quick-260806-dwe: launch the Claude harness on the newly-created tmux
         // session so cloneIdentity does not return until /id <newName> has been
         // sent and the harness is live. Without this, patch #321's auto-route
         // fires onCreateSession on a bare login shell → pretty-view shows
         // "no active Claude session". Extracted from birth-orchestrator L505-573.
         await startHarnessOnIdentity({
           exec: (cmd) => execWithTimeout(conn, cmd),
           name: newName,
           remotePath: escWorkingPath,
         });
         ```
      4. Verify the outer try/catch's `catch (err)` block at L501-511 will catch a helper rejection (it will — helper's exec rejections propagate). The 502 "SSH exec failed" response is the correct error class.
      5. Do NOT move the $HOME resolution + SFTP write + DB insert steps that follow — they still run AFTER harness-start succeeds. Order becomes: mkdir → tmux new-session → HARNESS-START (new) → $HOME → SFTP identity file → DB insert → response.
      6. Do NOT touch identity-clone.ts's local `shellSingleQuote`, `shellPath`, or `normalizeRemotePath` — the helper does its own escaping; clone's local copies are used elsewhere (for the collision probe path and the tmux new-session flags) and stay put.

    STEP B — identity-clone.test.ts extension:
      1. Add mock declaration alongside the other `vi.mock()` calls (around L93-103):
         ```
         vi.mock("./identity-harness-start.js", () => ({
           startHarnessOnIdentity: vi.fn().mockResolvedValue(undefined),
         }));
         ```
      2. Add import of the mock reference near L206-213 (the "Import mocked modules AFTER vi.mock() declarations" section):
         ```
         import { startHarnessOnIdentity } from "./identity-harness-start.js";
         ```
      3. Cast the mock: `const mockStartHarness = startHarnessOnIdentity as unknown as Mock;`
      4. Reset the mock in beforeEach: `mockStartHarness.mockReset().mockResolvedValue(undefined);` (add to the existing beforeEach block).
      5. Extend Test 8 (happy path) with two assertions AFTER the existing 201 response check:
         - `expect(mockStartHarness).toHaveBeenCalledTimes(1);`
         - `expect(mockStartHarness).toHaveBeenCalledWith(expect.objectContaining({ name: <newName>, remotePath: expect.any(String) }));`
         - Also assert the call ORDER: helper is called AFTER the tmux new-session exec (check `mockStartHarness.mock.invocationCallOrder[0] > execCommand.mock.invocationCallOrder[<newSessionCallIdx>]`) — this defends the ordering invariant.
      6. Add a new Test 13 (place after existing Test 12) — "harness-start failure → 502, no DB insert":
         ```
         it("Test 13: startHarnessOnIdentity rejection → 502 and DB insert does NOT run", async () => {
           mockStartHarness.mockRejectedValueOnce(new Error("harness failed"));
           // ... setup source row + mocks as in Test 8 ...
           // ... POST /identities/clone ...
           expect(status).toBe(502);
           expect(body).toEqual({ error: "SSH exec failed" });
           expect(dbState.rows.filter(r => r.identityKey === newName)).toEqual([]);
         });
         ```

    STEP C — CloneAgentDialog.tsx UI edit:
      1. Locate the inline submitError span at L451-455.
      2. Insert immediately BEFORE it (so the layout order is: status-while-submitting, then error-when-failed):
         ```
         {submitting && (
           <span
             role="status"
             aria-live="polite"
             className="text-xs text-[color:var(--color-pv-fg-muted)]"
           >
             Preparing session… (this can take ~25s while the new agent's Claude harness starts up)
           </span>
         )}
         ```
      3. Do NOT change the button label at L476 (`{submitting ? "Creating..." : createLabel}`) — leave patch #320's copy intact.

    STEP D — CloneAgentDialog.test.tsx extension:
      1. After the existing Test 23 block, add a new test:
         ```
         it("Test 24: shows 'Preparing session…' while cloneIdentity is pending, clears on resolve", async () => {
           const source = makeIdentity();
           let resolveClone: (v: Identity) => void = () => {};
           mockCloneIdentity.mockReturnValueOnce(
             new Promise<Identity>((r) => { resolveClone = r; }),
           );
           render(
             <CloneAgentDialog
               open={true}
               onClose={() => {}}
               sourceIdentity={source}
               hostId={5}
             />,
           );
           // Fill required fields
           fireEvent.change(screen.getByLabelText("Name"), { target: { value: "tina-2" } });
           // Title/path/voice already pre-filled or default; click Clone
           fireEvent.click(screen.getByText(/^Clone$/i).closest("button")!);
           // Preparing text appears
           await waitFor(() => expect(screen.getByText(/preparing session/i)).toBeInTheDocument());
           // Resolve the promise
           resolveClone(makeIdentity({ id: "new-id", identityKey: "tina-2", displayName: "tina-2" }));
           // Preparing text disappears
           await waitFor(() => expect(screen.queryByText(/preparing session/i)).toBeNull());
         });
         ```
      2. If Test 24's `getByText(/^Clone$/i)` matches multiple elements (dialog title + button), narrow the selector — use `screen.getByRole("button", { name: /^Clone$/i })` instead.

    STEP E — Build + verify:
      - `npm run build:backend && npm run build` (backend edit → mandatory per patch #154).
      - `npx vitest run` (all suites — backend + frontend — to catch cross-suite regressions).
  </action>
  <verify>
    <automated>npm run build:backend && npm run build && npx vitest run</automated>
  </verify>
  <done>
    identity-clone.ts imports startHarnessOnIdentity and calls it exactly once after the tmux new-session exec (grep: `grep -c "startHarnessOnIdentity" src/backend/database/routes/identity-clone.ts` returns >= 2 — one import, one call). Extended Test 8 asserts mockStartHarness called after tmux new-session with the correct name+remotePath. New Test 13 asserts harness failure → 502 + no DB row. CloneAgentDialog.tsx renders "Preparing session…" while submitting. New Test 24 asserts the preparing text appears and disappears. Full `npx vitest run` exits 0. `npm run build:backend && npm run build` exits 0. No git worktrees used. No git push. No docker build. No docker compose up.
  </done>
</task>

</tasks>

<verification>
Overall phase checks after all three tasks:

1. `npm run build:backend && npm run build` exits 0 (learned rule patch #154 — backend edits require both builds).
2. `npx vitest run` exits 0 across all suites — specifically:
   - identity-harness-start.test.ts (NEW, ~9 tests)
   - identity-birth-orchestrator.test.ts (18 existing tests — regression guard)
   - identity-birth-orchestrator.role-frontmatter.test.ts (existing — regression guard)
   - identity-birth.test.ts (existing SSE wrapper tests — regression guard)
   - identity-clone.test.ts (12 existing tests + Test 13 for harness failure = 13)
   - CloneAgentDialog.test.tsx (7 existing tests + Test 24 = 8)
3. `grep -c "startHarnessOnIdentity" src/backend/database/routes/identity-harness-start.ts` >= 1 (export).
4. `grep -c "startHarnessOnIdentity" src/backend/database/routes/identity-birth-orchestrator.ts` >= 2 (import + call).
5. `grep -c "startHarnessOnIdentity" src/backend/database/routes/identity-clone.ts` >= 2 (import + call).
6. `grep -c "Preparing session" src/ui/sidebar/CloneAgentDialog.tsx` >= 1 (new subtext).
7. birth-orchestrator.ts no longer contains the extracted sequence body — spot-check: the `for (let i = 0; i < ENTER_TRAIN_COUNT; i++)` loop should no longer appear in birth (it now lives in the helper). Confirm via `grep -c "for.*ENTER_TRAIN_COUNT" src/backend/database/routes/identity-birth-orchestrator.ts` returns 0.
8. Constants still exported from birth-orchestrator (helper depends on them + Test file at L62-72 imports them): `grep -c "^export const \\(CLAUDE_LAUNCH_CMD_PREFIX\\|STEP_3_SLEEP_MS\\|ENTER_TRAIN_COUNT\\|ENTER_TRAIN_SPACING_MS\\)" src/backend/database/routes/identity-birth-orchestrator.ts` returns 4.

Manual sanity (optional, developer at keyboard):
- Trigger a clone via the UI on any fleet host; observe the modal shows "Preparing session…" for ~25s; on completion the new terminal tab opens with a live Claude REPL prompt (not a bare shell) and the identity name is already set (proven by the `/id` marker appearing near the top of the Claude session transcript).
</verification>

<success_criteria>
- Both birth and clone use the same shared helper for post-tmux harness startup — no duplicated Nelly-tuned constants or extracted sequence body.
- Birth's SSE contract is preserved: 5 step events + 1 ended event, in order, with the same failure semantics.
- Clone's HTTP contract is preserved: same status codes, same response body shape; only latency changes (+~25s) and error surface widens by one class (harness failure → 502).
- User-visible fix: after clone completes, pretty-view routes into a live Claude session (not "no active Claude session"), with the identity name already sent via `/id`.
- Frontend gives a visible signal during the slow await ("Preparing session…") so the modal does not feel hung.
- All tests green: `npx vitest run` exits 0.
- Both backend + frontend builds succeed: `npm run build:backend && npm run build` exits 0.
- No git worktrees used, no `git push`, no `docker build`, no `docker compose up`. Orchestrator handles patch numbering + bounty JSON post-execution.
</success_criteria>

<output>
Create `.planning/quick/260806-dwe-extract-harness-start-helper-for-birth-c/260806-dwe-SUMMARY.md` when done, following the standard SUMMARY template. Include:
- What shipped (helper + rewiring + UI subtext)
- Files touched with line-count deltas
- Behavioral parity confirmation (test counts before/after)
- Any diagnostic notes if Approach B was needed in Task 2 instead of Approach A
- Follow-ups (none expected for this scope — patch numbering + skynet-patches.md entry + bounty JSON are orchestrator responsibilities)
</output>
