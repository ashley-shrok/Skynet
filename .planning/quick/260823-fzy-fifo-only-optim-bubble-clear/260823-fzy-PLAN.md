---
phase: quick-260823-fzy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
autonomous: true
requirements:
  - QUICK-260823-FZY-01
must_haves:
  truths:
    - "Incoming kind:message role:user WS frame clears the OLDEST sending pending regardless of content byte-equality (FIFO + role + state gate alone)."
    - "Ashley's real /fake slash-command jsonl frame (XML-wrapped by Claude Code) clears the seeded pending whose content is the pre-wrap typed text."
    - "JSON-paste-shape mismatch (compact seed vs pretty WS frame) clears the pending."
    - "FIFO tiebreaker (Test 4) still works: two identical-content sends clear in insertion order, oldest first."
    - "D-05 invariant preserved: matched bubble never flips to failed (clearTimeout on match still present)."
    - "collapseNewlinesForMatch helper still exists at ~L959 and is still called from handleOptimisticSend at L1001 for seed-side storage / failed-flip refill."
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "FIFO-only head-match in case 'message' user-role branch + rewritten rationale comment"
      contains: "quick-260823-fzy: FIFO-only head-match"
    - path: "src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx"
      provides: "Flipped Test 3 (regression guard) + added Test 3b (slash-command XML wrap) + added Test 3c (JSON-paste)"
      contains: "quick-260823-fzy"
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx case 'message' user-role branch"
      to: "pendingSendsRef.current + setPendingSends"
      via: "list.findIndex(p => p.state === 'sending')"
      pattern: "oldestSendingIdx"
    - from: "src/ui/features/pretty-view/PrettyView.tsx handleOptimisticSend"
      to: "collapseNewlinesForMatch (unchanged, still used for seed-side storage)"
      via: "collapseNewlinesForMatch(payload) at L1001"
      pattern: "collapseNewlinesForMatch\\(payload\\)"
---

<objective>
Drop content byte-equality from the optimistic-bubble head-match in
`PrettyView.tsx` `case "message"` `parsed.role === "user"` branch. Replace
with a FIFO + role + state gate alone: the first incoming user-role message
frame clears the oldest pending in `state:"sending"`, no content compare.

Purpose: The byte-strict head-match was fighting every Claude Code input
transformation. Concrete evidence in Ashley's tina session
(~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl,
ts=2026-08-23T01:41:48.723Z): user types `/fake we can try this one, problem
happens 100% of the time` — ComposeBox seeds pending with that literal
string. Claude Code re-writes the jsonl frame content to
`<command-message>fake</command-message>\n<command-name>/fake</command-name>\n<command-args>we can try this one, problem happens 100% of the time</command-args>`.
Byte comparison fails, pending survives, 20s timer flips it red — DOUBLE
BUBBLE. Same class covers every future CC wrap (JSON-paste normalization
Ashley also reported, XML-wrapping for other slash commands, etc.). Send
order itself IS the match signal: CC processes user input serially, session
file writes in order, WS preserves order. Order-based semantic is the correct
invariant.

Output:
- `PrettyView.tsx` simplified head-match block + rewritten comment (single
  ~15-line edit at L1570-1594).
- `PrettyView.optimistic-bubbles.test.tsx` Test 3 flipped from "does NOT
  match" to "STILL clears" + Test 3b real-corpus slash-command fixture added
  + Test 3c synthetic JSON-paste representative added.
- All 3 target tests green under
  `npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx src/ui/features/pretty-view/PrettyView.tsx`.
- Untouched tests (2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12b, 13, 14, 15, 16, 17)
  remain green (regression coverage on the surrounding state machine).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: FIFO-only head-match — drop content equality, rewrite rationale, flip Test 3, add Tests 3b + 3c</name>
  <files>src/ui/features/pretty-view/PrettyView.tsx, src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx</files>
  <behavior>
    Behavior 1 (existing Test 3, FLIPPED — regression guard for quick-260823-fzy):
      - Seed pending with content "hello".
      - Send WS frame kind:"message" role:"user" content:"goodbye" eventId:"ev2".
      - Expected: `countPendingBubbles(container) === 0` (pending CLEARED
        under FIFO-only, despite content mismatch).
      - Expected: `countConfirmedBubbles(container) === 1` (the incoming
        frame still lands as a confirmed message).

    Behavior 2 (new Test 3b — real slash-command XML wrap):
      - Seed pending with content
        `/fake we can try this one, problem happens 100% of the time`
        (literal string user typed).
      - Send WS frame content
        `<command-message>fake</command-message>\n<command-name>/fake</command-name>\n<command-args>we can try this one, problem happens 100% of the time</command-args>`
        (what CC re-wrote into the jsonl frame).
      - Expected: `countPendingBubbles(container) === 0` (cleared under
        FIFO-only despite the pending's content bearing zero byte-overlap
        with the frame's content).
      - Corpus provenance: ~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl
        ts=2026-08-23T01:41:48.723Z (Ashley's real /fake send in tina).

    Behavior 3 (new Test 3c — synthetic JSON-paste representative):
      - Seed pending with content `{"foo": "bar"}` (compact single-line, what
        the user pasted).
      - Send WS frame content `{\n  "foo": "bar"\n}` (2-space pretty, what CC
        re-serialized into the jsonl frame).
      - Expected: `countPendingBubbles(container) === 0` (cleared under
        FIFO-only). This is synthetic; represents the class Ashley reported
        ("pasting JSON in fail as well"). Corpus TBD — marked in a comment.

    Behavior 4 (untouched — regression coverage):
      - Test 2 (matching content clears head) — still passes; FIFO-only
        clears the head whether content matches or not.
      - Test 4 (FIFO tiebreaker: two "hello" sends, one frame clears the
        oldest) — still passes; findIndex(p => p.state === "sending") is
        stable and returns the earliest.
      - Test 10 (subsequent identical frame appends without re-matching) —
        still passes; after the first frame consumes the single pending, no
        more `state === "sending"` entries exist, so the next findIndex
        returns -1.
  </behavior>
  <action>
    Two edits, one commit.

    EDIT A — `src/ui/features/pretty-view/PrettyView.tsx` at L1569-1595 (the
    `case "message":` block that opens with the "Phase 50 D-02/D-07/D-08"
    comment through the closing `}` of the `if (parsed.role === "user") {`
    branch, before the Phase 43 Plan 43-07b `setMessages` call):

    Replace the ENTIRE existing block (L1569-1595) with this new block. Keep
    surrounding lines (L1568 `}` closing the session case, L1596 `// Phase 43
    Plan 43-07b — drop-oldest cap enforcement on live-append.` and below)
    untouched.

    New block content (place at L1569 immediately after the `case "message":
    {` opener line — verify column alignment with the surrounding 10-space
    switch-case indentation):

    - Opening comment block replaces the existing "Phase 50 D-02/D-07/D-08:
      FIFO head-match…" prose with the quick-260823-fzy rationale, prose
      only, no fenced code (per planner action rules). Exact text:

        // quick-260823-fzy: FIFO-only head-match. Byte equality on collapsed
        // content was fighting every Claude Code input transformation:
        // slash-command XML wrap (typed `/fake args` → jsonl frame
        // `<command-message>fake</command-message>\n<command-name>/fake</command-name>\n<command-args>args</command-args>`),
        // JSON paste normalization, and every future CC wrap. Real evidence:
        // ~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl
        // ts=2026-08-23T01:41:48.723Z (Ashley's /fake in tina session).
        // Order-based semantic is preserved by the transport: CC processes
        // user input serially, session file is written in order, WS preserves
        // order — SEND ORDER itself IS the match signal. First incoming
        // user-role frame clears the oldest sending pending (FIFO + role +
        // state gate), period. Independent of appendDedupWithCap below
        // (per-eventId dedup, different purpose).

    - Body (replaces the old `const collapsedParsed = collapseNewlinesForMatch(parsed.content);`
      + `list.findIndex((p) => p.state === "sending" && p.content === collapsedParsed)`
      with the simplified oldest-sending lookup, exactly as specified):

        if (parsed.role === "user") {
          const list = pendingSendsRef.current;
          const oldestSendingIdx = list.findIndex((p) => p.state === "sending");
          if (oldestSendingIdx !== -1) {
            const match = list[oldestSendingIdx]!;
            if (match.timer !== null) window.clearTimeout(match.timer);
            setPendingSends((prev) => prev.filter((p) => p.mqid !== match.mqid));
          }
        }

    DO NOT delete the `collapseNewlinesForMatch` helper at ~L959. Verify via
    grep after edit that it still exists AND is still called at L1001 inside
    `handleOptimisticSend` (feeds failed-flip refill into ComposeBox). The
    `collapseNewlinesForMatch` reference in the head-match branch is the
    ONLY call site being removed.

    EDIT B — `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx`:

    B.1 FLIP Test 3 (currently at L232-253):

    - Rename the test to:
        `Test 3 (quick-260823-fzy regression guard): incoming user-role frame with mismatched content STILL clears oldest sending pending — FIFO+role+state gate, no content equality`
    - Add a block comment immediately above the `it()` line referencing
      quick-260823-fzy, the Ashley `/fake` shape-gap, and citing the corpus
      path `~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl`
      + timestamp `2026-08-23T01:41:48.723Z`. Prose comment; explain that
      pre-quick-260823-fzy this test asserted the OPPOSITE (pending survived)
      but that behavior was the bug.
    - Change the two assertions at L251-252:
        FROM:
          `await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));`
          `expect(countPendingBubbles(container)).toBe(1);`
        TO:
          `await waitFor(() => expect(countPendingBubbles(container)).toBe(0));`
          `await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));`
      (Assert pending clears first, then confirmed appears — order reflects
      the state transition.)

    B.2 ADD Test 3b — new `it()` block inserted IMMEDIATELY AFTER the closing
    `});` of Test 3 (so Test 4 remains at its original position, just shifted
    down by however many lines Test 3b + 3c add):

    - Name: `Test 3b (quick-260823-fzy): real slash-command XML wrap clears pending under FIFO-only`
    - Structure mirrors Test 3 (mount, flipToStreaming, wait for textarea).
    - Above the `typeAndEnter` line, add a comment:
        `// corpus: ~/.claude/projects/-home-ubuntu-skynet-tina/e958881b-e151-443b-b91f-af2973c00d4e.jsonl ts=2026-08-23T01:41:48.723Z`
    - `typeAndEnter(container, "/fake we can try this one, problem happens 100% of the time");`
    - `await waitFor(() => expect(countPendingBubbles(container)).toBe(1));`
    - `sendWsFrame(ws, { type: "message", role: "user", content: "<command-message>fake</command-message>\n<command-name>/fake</command-name>\n<command-args>we can try this one, problem happens 100% of the time</command-args>", eventId: "ev-fake", ts: Date.now() });`
      (Use a JS string literal with `\n` escape sequences — TypeScript
      double-quoted string.)
    - `await waitFor(() => expect(countPendingBubbles(container)).toBe(0));`
    - `await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));`

    B.3 ADD Test 3c — new `it()` block inserted IMMEDIATELY AFTER the closing
    `});` of Test 3b:

    - Name: `Test 3c (quick-260823-fzy): JSON-paste transformation still clears pending under FIFO-only (synthetic)`
    - Same mount / flipToStreaming / waitFor-textarea setup.
    - Above the `typeAndEnter` line, add a comment:
        `// SYNTHETIC — represents Ashley-reported class ("pasting JSON in fail as well"), corpus TBD`
    - `typeAndEnter(container, '{"foo": "bar"}');`
    - `await waitFor(() => expect(countPendingBubbles(container)).toBe(1));`
    - `sendWsFrame(ws, { type: "message", role: "user", content: "{\n  \"foo\": \"bar\"\n}", eventId: "ev-json", ts: Date.now() });`
      (Note the escaped inner quotes; the pretty-JSON payload is
      `{\n  "foo": "bar"\n}` as parsed at runtime.)
    - `await waitFor(() => expect(countPendingBubbles(container)).toBe(0));`
    - `await waitFor(() => expect(countConfirmedBubbles(container)).toBe(1));`

    Do NOT touch Tests 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12b, 13, 14, 15,
    16, 17 — they exercise the surrounding state machine and provide
    regression coverage that must remain green.

    Executor's remit is CODE + COMMIT + SCOPED TESTS GREEN ONLY. Explicitly
    forbidden this task:
      - Running the full vitest suite (`npx vitest run` with no path) — the
        ship-gate orchestrator owns that.
      - Any `npm run build:*` command.
      - `git push`.
      - Any `docker build` / `docker compose up` / deploy step.
      - Editing `skynet-patches.md`.
      - Spawning other agents (Task/Agent tools).

    Commit message (single commit, conventional format matching repo style,
    e.g. `feat(quick-260823-fzy): drop content equality from optim-bubble head-match`
    or `fix(quick-260823-fzy): FIFO-only optim-bubble head-match`). Include a
    body paragraph citing the Ashley /fake corpus (path + timestamp) as the
    proximate cause.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx src/ui/features/pretty-view/PrettyView.tsx &amp;&amp; grep -c "quick-260823-fzy: FIFO-only head-match" src/ui/features/pretty-view/PrettyView.tsx | grep -qv '^0$' &amp;&amp; grep -c "Test 3b (quick-260823-fzy)" src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx | grep -qv '^0$' &amp;&amp; grep -c "Test 3c (quick-260823-fzy)" src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx | grep -qv '^0$' &amp;&amp; grep -c "collapseNewlinesForMatch" src/ui/features/pretty-view/PrettyView.tsx | awk '{ if ($1 &lt; 2) exit 1; else exit 0 }'</automated>
  </verify>
  <done>
    - `PrettyView.tsx` `case "message"` user-role branch contains the FIFO-only
      lookup (`findIndex((p) => p.state === "sending")`, no `p.content ===`
      check, no `collapsedParsed` local) and the new `quick-260823-fzy:
      FIFO-only head-match` rationale comment.
    - `collapseNewlinesForMatch` helper still defined at ~L959 AND still
      referenced at L1001 inside `handleOptimisticSend` (grep confirms ≥ 2
      occurrences: 1 declaration + 1 call site).
    - Test 3 renamed to `Test 3 (quick-260823-fzy regression guard): ...`,
      assertions flipped to expect `pendingBubbles === 0` after the
      mismatched-content frame.
    - New Test 3b (`real slash-command XML wrap`) present with the Ashley
      `/fake` corpus fixture + provenance comment (path + timestamp).
    - New Test 3c (`JSON-paste transformation … (synthetic)`) present with
      the SYNTHETIC-marker comment.
    - Scoped test command
      `npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx src/ui/features/pretty-view/PrettyView.tsx`
      exits 0 with 3b + 3c PASSING and Test 3 PASSING under the flipped
      assertions.
    - `npx tsc --noEmit` exits 0 (no TypeScript regressions from the delete
      of the `collapsedParsed` local).
    - Single commit landed on the current branch. No push. No build. No
      deploy. No skynet-patches.md edit.
  </done>
</task>

</tasks>

<verification>
Scoped verification only (executor remit):

1. `npx tsc --noEmit` — proves no TypeScript regressions from deleting the
   `collapsedParsed` local (the only place using the removed intermediate
   binding).
2. `npx vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx src/ui/features/pretty-view/PrettyView.tsx`
   — runs only the target test file. Green run proves:
   - Test 3 flipped-assertion passes (FIFO-only clears mismatched-content pending)
   - Test 3b passes (real /fake XML wrap fixture clears pending)
   - Test 3c passes (synthetic JSON-paste representative clears pending)
   - Tests 2, 4, 10 (surrounding FIFO/match behavior) still pass
   - Tests 5-9, 11-13 (state machine: 20s timer, paste_send_failed,
     send_keys_error, immediateFailure, D-05 invariant, mqid threading,
     WS close cleanup, session_changed, overrideText ack) still pass
   - Tests 14-17 (render latest-only + interleaving) still pass
3. Grep gates confirm the code edit + comment landed and did NOT delete the
   still-needed `collapseNewlinesForMatch` helper.

Explicitly NOT performed by executor (owned by ship-gate orchestrator):
- Full vitest suite
- Any build command
- git push
- Any docker / deploy step
</verification>

<success_criteria>
- Automated verification chain (tsc + scoped vitest + grep gates) exits 0.
- All named test cases in the target file are green (17 originals with Test 3
  flipped + 2 new = 19 tests total in that file).
- Single commit on `feat/tab-title-from-tmux` (current branch) with a
  conventional `feat(quick-260823-fzy): ...` or `fix(quick-260823-fzy): ...`
  message that cites the corpus in its body.
- No secondary edits, no push, no build, no deploy.
- Ashley's stated behavior fixed at the source: every future Claude Code
  input transformation (slash-command wraps, JSON paste normalization,
  etc.) will no longer create a double bubble, because the head-match no
  longer depends on the exact wire-frame content matching the seeded
  payload.
</success_criteria>

<output>
Create `.planning/quick/260823-fzy-fifo-only-optim-bubble-clear/260823-fzy-SUMMARY.md`
when the single task completes. Summary must record:
- The exact before/after of the head-match block (5-line diff excerpt).
- Confirmation that `collapseNewlinesForMatch` is still called from
  `handleOptimisticSend`.
- Test names + statuses for Tests 3, 3b, 3c.
- Commit SHA.
- Explicit note that ship-gate steps (full suite / build / push / deploy)
  were NOT executed and are the orchestrator's responsibility.
</output>
