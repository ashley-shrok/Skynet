---
phase: quick-260809-cnx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.test.tsx
autonomous: true
requirements:
  - CNX-A  # ComposeBox mounts in reduced state during dormant so Ashley can pre-draft
  - CNX-B  # Waking-related local state resets on isVisible false→true edge so re-dormanted sessions don't stick on "Waking up…"

must_haves:
  truths:
    - "When the backend emits {type:'dormant', dormant:true}, the DormancyOverlay mounts AND the ComposeBox is present in the DOM with textarea + mic typeable (Send/reset/queue/thumbsUp/paperclip disabled via existing dormantActive prop)."
    - "When the pretty-view pane transitions from isVisible=false back to isVisible=true, any stale local waking state (waking, wakingStartTs, elapsedSeconds, wakeError) is cleared so the next backend dormant frame paints truth."
    - "The initial mount of PrettyView with isVisible=true does NOT clear waking state (edge detector fires only on false→true transitions)."
    - "Existing dormant behaviors are unchanged: live-frame auto-dismiss still works, Wake click still sends {type:'wake'}, wake_result error still shows warm-red variant."
    - "Full-suite `npx vitest run` is green after the change."
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Extended ComposeBox mount gate (fix A) + new visibility-edge waking-reset useEffect (fix B)"
      contains: "|| dormant"
    - path: "src/ui/features/pretty-view/PrettyView.test.tsx"
      provides: "Two new tests in a `quick 260809-cnx dormant flow refinements` describe block covering fix A (mount) and fix B (visibility-edge reset)"
      contains: "260809-cnx"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx (mount gate ~line 1834)"
      to: "ComposeBox dormantActive prop (~line 1871)"
      via: "same JSX block — dormantActive={dormant || waking} already handles reduced-state disables"
      pattern: "status === \"streaming\" \\|\\| status === \"error\" \\|\\| dormant"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (new useEffect near ~line 1155-1163 dormantRef mirror)"
      to: "waking / wakingStartTs / elapsedSeconds / wakeError setters"
      via: "prevIsVisibleRef edge detector on false→true transition"
      pattern: "prevIsVisibleRef"
---

<objective>
Two additive DormancyOverlay refinements, both landing in `PrettyView.tsx`, with matching tests in `PrettyView.test.tsx`.

**Fix A** (CNX-A): Extend the ComposeBox mount gate at `PrettyView.tsx:~1834` to include `dormant`, so Ashley can pre-draft messages during the dormant/waking window. All existing reduced-state prop wiring (`dormantActive={dormant || waking}`) already disables Send/reset/queue/thumbsUp/paperclip while leaving textarea + mic typeable — the mount gate is the only thing missing.

**Fix B** (CNX-B): Add a new small `useEffect` on `[isVisible]` that uses a `prevIsVisibleRef` edge detector to reset local waking state (`setWaking(false)`, `setWakingStartTs(null)`, `setElapsedSeconds(0)`, `setWakeError(null)`) whenever the pane transitions from `isVisible=false` to `isVisible=true`. This clears stale waking state when Ashley returns to a pane whose WS was closed by patch #344 during hidden-time and whose session has since re-dormanted, so the next backend dormant frame (within one 3s poll cycle) paints an accurate "Session is asleep" overlay with a working Wake button instead of a stuck "Waking up…".

Purpose: Fixes two related UX papercuts in the dormant flow — one lets Ashley pre-draft during wake, the other prevents a stuck-waking overlay after visibility-driven WS reconnects.

Output: Two-line change at the mount gate (fix A), a ~10-line new useEffect + one new `prevIsVisibleRef` declaration (fix B), and two new integration tests in `PrettyView.test.tsx`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/PrettyView.test.tsx
@src/ui/features/pretty-view/DormancyOverlay.tsx
@src/ui/features/pretty-view/ComposeBox.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Apply Fix A (ComposeBox mount gate) + Fix B (visibility-edge waking reset) in PrettyView.tsx</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx</files>
  <behavior>
    - After fix A: When `dormant === true` and `onSend` is provided, the ComposeBox JSX block renders (mounts). The existing `dormantActive={dormant || waking}` prop keeps textarea + mic typeable and disables Send/reset/queue/thumbsUp/paperclip.
    - After fix B: On the false→true transition of `isVisible`, `waking`, `wakingStartTs`, `elapsedSeconds`, and `wakeError` are all reset to their initial values (`false`, `null`, `0`, `null`).
    - The initial mount of PrettyView with `isVisible=true` MUST NOT trigger the reset (prevIsVisibleRef initialized to current isVisible so the effect body's `if (!prev && isVisible)` guard is false on first run).
    - All existing dormant behaviors remain unchanged: `case "dormant"` handler (~line 826), `case "wake_result"` handler (~line 847), live-frame auto-dismiss (~line 727-742), and the ComposeBox `dormantActive={dormant || waking}` prop (~line 1871).
  </behavior>
  <action>
    Make two additive edits to `src/ui/features/pretty-view/PrettyView.tsx`. Both are locked-context edits (per CNX-A and CNX-B) — do not deviate from the specified shape.

    **Edit 1 (Fix A — CNX-A, mount gate, ~line 1834):**
    Change the ComposeBox mount gate from:
    `{onSend && (status === "streaming" || status === "error") && (`
    to:
    `{onSend && (status === "streaming" || status === "error" || dormant) && (`

    Nothing else in the ComposeBox JSX block changes. `handleComposeSend`, `canSend`, `isHolding`, `recycleActive`, `planPendingActive`, `reconnectingActive`, `dormantActive`, `contextPct`, `isIdle`, and all other props stay exactly as-is. Their current values are already safe during dormant (e.g. `canSend = status === "streaming"` naturally becomes false when status flips off streaming, and `dormantActive={dormant || waking}` disables the WS-side-effecting controls). This is intentional belt-and-suspenders wiring per locked context; do NOT try to consolidate.

    **Edit 2 (Fix B — CNX-B, visibility-edge waking reset, place immediately after the existing `dormantRef` mirror useEffect at ~line 1158-1163):**
    Add a new ref declaration and a new `useEffect` on `[isVisible]`:

    ```
    // quick 260809-cnx: prevIsVisibleRef edge detector for the waking-reset
    // useEffect below. Initialized to current isVisible so the initial mount
    // (prev === isVisible) does NOT fire the reset — only true false→true
    // transitions (pane returning after being hidden) clear waking state.
    const prevIsVisibleRef = useRef<boolean>(isVisible);

    // quick 260809-cnx: reset local waking-related state on isVisible false→true.
    // Patch #344 closes the WS while isVisible=false, so any pre-hidden `waking`
    // state is unreliable on re-visibility. Clearing it lets the next backend
    // dormant frame (arrives within one 3s poll cycle) paint the accurate
    // overlay: "Session is asleep" + working Wake button, instead of a stuck
    // "Waking up…" indicator. Visibility transition is the truth signal —
    // do NOT use a time-based threshold (locked context).
    useEffect(() => {
      const prev = prevIsVisibleRef.current;
      prevIsVisibleRef.current = isVisible;
      if (!prev && isVisible) {
        setWaking(false);
        setWakingStartTs(null);
        setElapsedSeconds(0);
        setWakeError(null);
      }
    }, [isVisible]);
    ```

    Placement rationale: putting it adjacent to the existing dormantRef mirror useEffect keeps all dormant/waking-related state-management effects colocated. The `prevIsVisibleRef.current = isVisible` assignment happens BEFORE the `if` guard so the ref always tracks the latest value; the guard reads the captured `prev` value.

    Do NOT touch: `case "dormant"` handler at ~line 826, `case "wake_result"` handler at ~line 847, the live-frame auto-dismiss at ~line 727-742, the existing `isVisibleRef` mirror useEffect at ~line 1154-1156, the elapsed-seconds ticker useEffect at ~line 1177, the DormancyOverlay mount block at ~line 1646, or the `dormantActive={dormant || waking}` prop at ~line 1871. The new useEffect is purely additive.

    After both edits, run `npx tsc --noEmit` (or the project's typecheck script if there is one) to confirm the added `prevIsVisibleRef` typing (`useRef<boolean>(isVisible)`) resolves. `useRef` is already imported in this file.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && grep -n "|| dormant)" src/ui/features/pretty-view/PrettyView.tsx | grep -v '^[^:]*:[^:]*://' | grep -c 'status === "error"' | grep -q '^1$' &amp;&amp; grep -c "prevIsVisibleRef" src/ui/features/pretty-view/PrettyView.tsx | grep -qv '^0$' &amp;&amp; grep -c "260809-cnx" src/ui/features/pretty-view/PrettyView.tsx | grep -qv '^0$' &amp;&amp; npx tsc --noEmit 2>&amp;1 | tail -5</automated>
  </verify>
  <done>
    - Line ~1834 mount gate reads `{onSend && (status === "streaming" || status === "error" || dormant) && (` (fix A applied).
    - New `prevIsVisibleRef` useRef declaration exists near the dormantRef mirror (~line 1158-1163).
    - New useEffect on `[isVisible]` exists that calls `setWaking(false)`, `setWakingStartTs(null)`, `setElapsedSeconds(0)`, `setWakeError(null)` only when `!prev && isVisible` (fix B applied).
    - `npx tsc --noEmit` reports no new errors in PrettyView.tsx.
    - No other lines in PrettyView.tsx were modified (diff shows only the two additive edits).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add two new integration tests in PrettyView.test.tsx covering fix A (mount) and fix B (visibility-edge reset)</name>
  <files>src/ui/features/pretty-view/PrettyView.test.tsx</files>
  <behavior>
    - **Test A (fix A, CNX-A):** After `mountDormancyPV()` and `sendDormantFrame(ws, true)`, the DormancyOverlay is in the DOM AND a ComposeBox textarea (or the send button) is in the DOM. Assertion target: the mount-time presence of a ComposeBox element (e.g. `button[aria-label="Send"]` or the textarea locator used by neighboring tests) is truthy AFTER the dormant frame — proving the mount gate now includes `dormant`. This is complementary to the pre-existing Test 1 in the `quick 260808-cd6` block (which asserts Send is DISABLED given ComposeBox is mounted); the new test asserts the mount ITSELF.
    - **Test B (fix B, CNX-B):** After `mountDormancyPV()` + `sendDormantFrame(ws, true)` + Wake click (produces `Waking up…` in the DOM per existing Test 3), rerender PrettyView with `isVisible={false}` then rerender again with `isVisible={true}`. After the visibility cycle, assert the `Waking up…` copy is gone from `container.textContent`. (The overlay's post-cycle content depends on subsequent WS frames; asserting absence of the stale "Waking up…" indicator is the truth signal for the reset.)
    - Both tests live in a new `describe("quick 260809-cnx dormant flow refinements", () => { ... })` block placed IMMEDIATELY after the existing `quick 260808-cd6 dormancy overlay integration` describe block (which ends around line 1210).
    - Reuse the existing `mountDormancyPV()`, `sendDormantFrame()`, `flipToStreaming()`, `getCurrentWs()`, and `wsStubs` helpers/state from the 260808-cd6 describe block. Do NOT duplicate them — extract to shared scope or (simpler) call them from the new describe block by keeping them at module scope if they already are, else the new describe defines minimal local copies that mirror the pattern. Match the exact `beforeEach` / `afterEach` shape (`vi.useFakeTimers()`, `vi.clearAllMocks()`, `wsStubs.length = 0`, `vi.useRealTimers()`, `vi.restoreAllMocks()`, `vi.unstubAllGlobals()`).
  </behavior>
  <action>
    Open `src/ui/features/pretty-view/PrettyView.test.tsx`. First read lines ~1030-1215 to confirm the exact scope of `mountDormancyPV`, `sendDormantFrame`, `flipToStreaming`, `getCurrentWs`, and `wsStubs` — determine whether they are module-scoped helpers (reusable from a sibling describe) or nested inside the `quick 260808-cd6` describe block. If nested, either (a) hoist them to module scope in a small refactor, OR (b) inline minimal copies in the new describe block; prefer (b) if it keeps the diff surgical (locked context favors additive changes).

    Add a new `describe` block immediately AFTER the existing `quick 260808-cd6 dormancy overlay integration` describe (which closes around line 1210) and BEFORE the `quick 260808-ho2 loading overlay integration` describe (starts ~1214):

    Structure of the new describe block (pseudocode; write the real TS):

    ```
    // ── quick 260809-cnx dormant flow refinements ─────────────────────────────

    describe("quick 260809-cnx dormant flow refinements", () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        wsStubs.length = 0;
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      });

      // (Reuse mountDormancyPV + sendDormantFrame from module scope if hoisted;
      // otherwise define minimal local copies here mirroring the 260808-cd6 pattern.)

      it("Fix A: dormant frame mounts ComposeBox in reduced state (typeable textarea, disabled Send)", () => {
        const { container, ws } = mountDormancyPV();

        // Before dormant: ComposeBox may or may not be mounted depending on flipToStreaming.
        // After dormant frame: overlay AND ComposeBox must both be present.
        sendDormantFrame(ws, true);

        // DormancyOverlay is mounted.
        const overlay = container.querySelector('[role="status"]');
        expect(overlay).not.toBeNull();
        expect(overlay!.getAttribute('aria-label')).toContain('asleep');

        // ComposeBox is mounted (fix A: mount gate now includes `dormant`).
        const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
        expect(sendBtn).toBeTruthy();
        // Send disabled via dormantActive={dormant||waking} (pre-existing wiring).
        expect(sendBtn.disabled).toBe(true);
        // Textarea is present and NOT disabled (dormantActive keeps textarea typeable).
        const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();
        expect(textarea.disabled).toBe(false);
      });

      it("Fix B: visibility false→true transition resets stale waking state", () => {
        const { container, ws, rerender } = mountDormancyPV();

        sendDormantFrame(ws, true);

        // Enter waking state via Wake click (mirrors 260808-cd6 Test 3).
        const wakeBtn = container.querySelector('button[aria-label="Wake identity"]') as HTMLButtonElement;
        expect(wakeBtn).toBeTruthy();
        act(() => { fireEvent.click(wakeBtn); });

        // Confirm we entered waking state.
        expect(container.textContent).toContain('Waking up…');

        // Hide the pane (simulates Ashley navigating away — patch #344 closes WS).
        rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={false} />);

        // Return to the pane (visibility false → true transition).
        rerender(<PrettyView hostId={1} tmuxSession="s1" onSend={vi.fn(() => true)} isVisible={true} />);

        // The stale "Waking up…" indicator should be gone (fix B reset).
        expect(container.textContent).not.toContain('Waking up…');
      });
    });
    ```

    Notes on the Fix B test:
    - The `onSend` in the rerenders can be a fresh `vi.fn(() => true)` — the assertion targets the waking-copy absence, not identity stability. If matching the exact `onSend` reference matters for React reconciliation of the tree, capture the original `onSend` from `mountDormancyPV()` (it returns `onSend`) and reuse it across rerenders.
    - `hostId` and `tmuxSession` MUST match the initial mount values (1, "s1") so the WS-setup effect does not tear down/rebuild the socket (paneKey-change reset path). This isolates the test to the visibility-transition path.
    - If the overlay's post-cycle content is uncertain (e.g. it shows "Session is asleep" via a re-emitted dormant frame that has not arrived yet in the test), the "does not contain 'Waking up…'" assertion is the SIMPLEST and most robust signal per locked context. Do not attempt to assert the presence of the Wake button post-cycle without also driving a backend dormant re-emit — omitting that keeps the test tight.

    After writing, run the file:
    `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx`

    Then the full suite:
    `npx vitest run`

    Both must pass green with zero failures / zero new skips.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; grep -c "260809-cnx dormant flow refinements" src/ui/features/pretty-view/PrettyView.test.tsx | grep -q '^1$' &amp;&amp; grep -c "Fix A: dormant frame mounts ComposeBox" src/ui/features/pretty-view/PrettyView.test.tsx | grep -q '^1$' &amp;&amp; grep -c "Fix B: visibility false→true transition resets stale waking state" src/ui/features/pretty-view/PrettyView.test.tsx | grep -q '^1$' &amp;&amp; npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx 2>&amp;1 | tail -20 &amp;&amp; npx vitest run 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    - A new `describe("quick 260809-cnx dormant flow refinements", ...)` block exists in PrettyView.test.tsx, positioned between the `quick 260808-cd6` and `quick 260808-ho2` describes.
    - The block contains exactly two `it()` tests: one for fix A (mount + textarea typeable + Send disabled), one for fix B (visibility cycle clears "Waking up…").
    - `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx` passes green, including both new tests and all pre-existing 260808-cd6 dormancy tests.
    - `npx vitest run` (full suite) passes green with no new failures or skips.
    - Executor commits the change (single commit or two commits — either shape is fine; commit message references quick 260809-cnx and both CNX-A and CNX-B).
  </done>
</task>

</tasks>

<verification>
- Both edits in PrettyView.tsx are additive; diff of PrettyView.tsx shows only the mount-gate line change (fix A) and the new `prevIsVisibleRef` + useEffect block (fix B). No other lines touched.
- DormancyOverlay.tsx unchanged (not modified).
- ComposeBox.tsx unchanged (not modified — `dormantActive` prop wiring from patch #345 already handles reduced state).
- Full-suite `npx vitest run` is green.
- Executor stops after commit — no ship, no push, no docker recreate, no patches.md edit (per constraints).
</verification>

<success_criteria>
- Fix A applied: mount gate at ~line 1834 reads `... || dormant) && (`.
- Fix B applied: new `prevIsVisibleRef` + `useEffect([isVisible])` near ~line 1158-1163, resets all four waking-related state slots on false→true.
- Two new integration tests exist in PrettyView.test.tsx under `quick 260809-cnx dormant flow refinements` describe, both passing.
- No changes to DormancyOverlay.tsx, ComposeBox.tsx, backend code, SessionHoldingOverlay, or loading overlay (patch #ho2).
- No time-based threshold introduced for waking reset (visibility transition is the truth signal).
- Full-suite `npx vitest run` green.
- Change committed on `feat/tab-title-from-tmux` on top of the existing 3 unshipped commits.
</success_criteria>

<output>
Create `.planning/quick/260809-cnx-dormancy-overlay-compose-typeable-and-wa/260809-cnx-SUMMARY.md` when done, following `$HOME/.claude/get-shit-done/templates/summary.md`. Reference both CNX-A (fix A: mount gate) and CNX-B (fix B: visibility-edge waking reset), the two new tests, and the full-suite vitest green result.
</output>
