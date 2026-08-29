---
phase: quick-260829-nzn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts
  - src/backend/database/routes/sessions.ts
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
  - src/backend/database/routes/sessions.test.ts
autonomous: true
requirements: [quick-260829-nzn]
---

<objective>
Tighten `isAshleyRealUserTurn` to reject three harness-injected shapes that today
pass the predicate and spuriously bump `lastMessageAt`, floating agents Ashley
hasn't messaged in days to the top of the conversation list (compareByRecencyDesc
in `src/ui/state/conversation-store.ts:565` reads `lastMessageAt`).

Confirmed empirically 2026-08-29 on Tabitha's session file
(`/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tabitha/7443cb12-ea03-4cd2-afeb-75d64f003a89.jsonl`):
she ranks #2 by recency with ZERO real Ashley messages in the 256KB tail — the
newest passing line (`2026-08-29T15:12:49.598Z`) is a Ctrl-C kill signal (two
`\x03` bytes as plain-string content).

Purpose: Fix conversation-list recency at the source (predicate) so ordering
reflects Ashley's actual attention, not agent-supervisor housekeeping.

Output: Two predicate copies updated in the SAME commit (byte-parallel
discipline), matching docblock refinements, and mirrored negative/positive
regression tests in both test files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/backend/fleet-status/ssh-poll-orchestrator.ts
@src/backend/database/routes/sessions.ts
@src/backend/fleet-status/ssh-poll-orchestrator.test.ts
@src/backend/database/routes/sessions.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add three new exclusions to both byte-parallel predicate copies + refresh docblocks</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.ts, src/backend/database/routes/sessions.ts</files>
  <behavior>
    Predicate `isAshleyRealUserTurn` — same identical body in BOTH files — must
    reject these three additional shapes while keeping every currently-passing
    shape intact:

    - DROP: content includes the exact substring `<command-name>/exit</command-name>`
      (agent-supervisor-fired `/exit` slash-command before recycle; never Ashley-authored)
    - DROP: `t.replace(/[\x00-\x1F]/g, "") === ""` where `t` is the already-trimmed
      content (empty after stripping ASCII control chars — catches Ctrl-C kill signals
      like `"\x03\x03"` and any other control-only injection)
    - DROP: `content.startsWith("Your session was just resumed by the agent-supervisor")`
      (supervisor-injection sentinel baked into agent-supervisor source; stable prefix)

    All three checks fire on the `content` string that has already cleared the
    `typeof content === "string"` gate. The `/exit` and resumed-sentinel checks
    operate on the raw `content` (substring / prefix), the control-only check
    operates on `t` (the already-trimmed value). Order the three new gates
    AFTER the existing XML-wrapper exclusion at step 4 and BEFORE the
    final `rawTs` extraction and `{ok: true, ts}` return.

    Every previously-passing shape must still return `{ok: true, ts}`:
    - Real chat prose (Case 1)
    - Real slash-commands like `/id save`, `/id reset`, `/build`, `/gsd:*` (Case 2)
    Every previously-dropped shape must still return `{ok: false}`.
  </behavior>
  <action>
Update BOTH copies of `isAshleyRealUserTurn` (canonical at
`src/backend/fleet-status/ssh-poll-orchestrator.ts` ~L275 and byte-parallel
copy at `src/backend/database/routes/sessions.ts` ~L81) with three new
exclusion gates. Insert AFTER the existing XML-wrapper check
(`if (!isCommand && isXmlWrapper) return { ok: false };` at step 4) and
BEFORE the `rawTs = top.timestamp` extraction:

1. `/exit` slash-command drop — `if (content.includes("<command-name>/exit</command-name>")) return { ok: false };`
   Rationale: agent-supervisor fires `/exit` before recycle; passes the XML gate
   today because content starts with `<command-`. Ashley's own slash-commands
   (`/id save`, `/id reset`, `/build`, `/gsd:*`) MUST keep counting — exclusion
   is scoped tightly to the `/exit` command-name substring.

2. Control-only content drop — `if (t.replace(/[\x00-\x1F]/g, "") === "") return { ok: false };`
   Rationale: supervisor's Ctrl-C kill signal (two `\x03` chars) is delivered as
   plain-string content and slips the XML gate. Latest Tabitha line
   `2026-08-29T15:12:49.598Z` is exactly this shape — the primary reason her
   recency is spuriously inflated. Note `t` is already trimmed (regular
   whitespace including tab/newline stripped by `content.trim()` above), so
   this catches any residual pure-control-char payload.

3. Resumed-injection sentinel drop —
   `if (content.startsWith("Your session was just resumed by the agent-supervisor")) return { ok: false };`
   Rationale: agent-supervisor injects the sentinel `"Your session was just
   resumed by the agent-supervisor. Your background Monitors stopped with the
   previous session — start them again per the id skill."` as a `type:"user"`
   turn in some code paths (8 occurrences in Tabitha's file are `type:"user"`,
   14 later ones correctly shipped as `type:"last-prompt"`). Prefix match
   because the exact tail wording is stable but keep the check anchored to
   the start — do NOT switch to `includes` (avoids matching quoted mentions
   in real Ashley prose).

Both files MUST land in the SAME commit. The predicate body must remain
byte-parallel between the two files after your edits — no divergence,
including comment prose inside the function body.

Also update the docblock in BOTH files:
- Canonical docblock at `ssh-poll-orchestrator.ts:260-274` (the "Ashley 2026-08-23
  lock" block that starts `Ashley 2026-08-23 lock: "only my real messages…"`).
- Byte-parallel docblock at `sessions.ts:66-80` (identical prose).

Extend both with a 2026-08-29 refinement paragraph listing the three new
exclusions with a one-line reason each (Ctrl-C kill signal / `/exit`
slash-command / resumed-injection sentinel). Keep the "Predicate:" summary
line in sync — mention the three new drops explicitly. Do NOT rewrite the
2026-08-23 lock paragraph; append after it.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; diff &lt;(awk '/^function isAshleyRealUserTurn/,/^}$/' src/backend/fleet-status/ssh-poll-orchestrator.ts) &lt;(awk '/^function isAshleyRealUserTurn/,/^}$/' src/backend/database/routes/sessions.ts) &amp;&amp; echo "BYTE-PARALLEL OK"</automated>
  </verify>
  <done>
    - Both predicate bodies produce zero-line diff (byte-parallel confirmed).
    - Both docblocks include the 2026-08-29 refinement note listing all three new exclusions.
    - No new imports, no new helpers, no signature change on `isAshleyRealUserTurn`.
    - `tsc --noEmit` (or project's typecheck) succeeds without new errors in the two edited files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add mirrored predicate-matrix cases to both test files (Cases 8, 9, 10)</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.test.ts, src/backend/database/routes/sessions.test.ts</files>
  <behavior>
    Extend the existing `describe("isAshleyRealUserTurn — Ashley 2026-08-23 lock predicate matrix", …)`
    block in BOTH test files (ssh-poll-orchestrator.test.ts:1243 and
    sessions.test.ts:796) with three new DROP cases and two positive
    regression checks. Use the existing local `scanSingleLine` helper in each
    file — do NOT introduce new fixture harnesses.

    New cases in each file (mirrored exactly — same case numbers, same names,
    same fixtures, same expectations):

    - Case 8 (DROP — Ctrl-C kill signal, 2026-08-29 refinement): user turn
      with plain-string content of two `\x03` bytes must NOT count.
      Fixture: `{"type":"user","message":{"role":"user","content":""},"timestamp":"2026-08-29T15:12:49.598Z","uuid":"u8"}`
      Assert: `scanSingleLine(rawLine)` resolves to `null`.

    - Case 9 (DROP — /exit slash-command, 2026-08-29 refinement): user turn
      with the agent-supervisor's `/exit` command envelope must NOT count.
      Fixture content (exact substring must match the predicate's
      `<command-name>/exit</command-name>` check):
      `"<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>"`
      Assert: `scanSingleLine(rawLine)` resolves to `null`.

    - Case 10 (DROP — resumed-injection sentinel, 2026-08-29 refinement):
      user turn whose content is the agent-supervisor's resume sentinel
      must NOT count.
      Fixture content: `"Your session was just resumed by the agent-supervisor. Your background Monitors stopped with the previous session — start them again per the id skill."`
      Assert: `scanSingleLine(rawLine)` resolves to `null`.

    Positive regression locks (add as assertions inside a single new
    `it("2026-08-29 refinement — positive regression: real chat + real slash-command still count")`
    or as two separate `it` blocks — either shape is fine):

    - Real chat message (Case 1 shape at a fresh timestamp) still returns the
      parsed ts. Fixture content: `"hey can you look at this thing"`, timestamp
      `2026-08-29T16:00:00.000Z` → expect `scanSingleLine` resolves to
      `Date.parse("2026-08-29T16:00:00.000Z")`.

    - Real `/id` slash-command still returns the parsed ts. Fixture content:
      `"<command-name>/id</command-name>\n            <command-message>id</command-message>\n            <command-args>tina</command-args>"`,
      timestamp `2026-08-29T16:01:00.000Z` → expect `scanSingleLine` resolves to
      `Date.parse("2026-08-29T16:01:00.000Z")`.
  </behavior>
  <action>
Append the five new test-case bodies (three DROP cases + two positive
regressions) to the existing predicate-matrix `describe` block in BOTH
files. Insert AFTER the existing Case 7 and BEFORE the "Mixed-tail
integration" test so numbering stays sequential (Case 8, 9, 10, then two
positive regressions, then the pre-existing Mixed-tail test unchanged).

Use the file-local `scanSingleLine` helper (defined at
ssh-poll-orchestrator.test.ts:1292 and sessions.test.ts:801 respectively).
Do NOT copy the helper across files or refactor it out — keep the existing
per-file harness patterns intact.

Test-name prose in both files must be identical (same `it(...)` strings) so
the byte-parallel discipline that already governs Cases 1-7 extends to the
new cases. The only per-file difference is the surrounding harness the
local `scanSingleLine` implementation exercises (orchestrator publishedStates
vs `/sessions/list` HTTP route) — that's already the established pattern
and does not affect fixture content.

Also — IMPORTANT — extend the existing "Mixed-tail integration" test in
BOTH files to include one of the new DROP fixtures (Case 8 Ctrl-C kill is
the strongest choice — it is the empirically-newest shape on Tabitha's
file). Interleave the Case 8 fixture with a timestamp NEWER than T2 so the
test proves the DROP takes effect even when the injected line is the
freshest in the tail. Assertion still expects `T2` to be returned. Keep
this edit to a small addition — do not rewrite the surrounding test body.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts -t "Ashley 2026-08-23 lock predicate matrix"</automated>
  </verify>
  <done>
    - Both test files contain identically-named `it(...)` blocks for Case 8, 9, 10 plus positive regressions.
    - All new DROP cases assert `scanSingleLine(...)` resolves to `null`.
    - Both positive-regression assertions resolve to the expected `Date.parse(...)` value.
    - Mixed-tail integration test in BOTH files includes the Ctrl-C kill fixture as a NEWER-than-T2 interleaved line and still expects T2.
    - All predicate-matrix tests (existing Cases 1-7, new Cases 8-10, positive regressions, Mixed-tail) pass in both files.
  </done>
</task>

</tasks>

<verification>
Scoped test suite for the two edited source files:

```
cd /home/ubuntu/skynet-tina && npx vitest run \
  src/backend/fleet-status/ssh-poll-orchestrator.test.ts \
  src/backend/database/routes/sessions.test.ts
```

Both files green end-to-end (not just the predicate-matrix describe block) —
this proves the three new exclusions did not accidentally regress anything
else in the scan/route paths.

Byte-parallel discipline final check:

```
cd /home/ubuntu/skynet-tina && diff \
  <(awk '/^function isAshleyRealUserTurn/,/^}$/' src/backend/fleet-status/ssh-poll-orchestrator.ts) \
  <(awk '/^function isAshleyRealUserTurn/,/^}$/' src/backend/database/routes/sessions.ts)
```

Must produce zero output (identical predicate bodies).
</verification>

<success_criteria>
- `isAshleyRealUserTurn` in BOTH source files rejects the three empirically-confirmed harness shapes (Ctrl-C-only content, `/exit` slash-command, resumed-injection sentinel).
- Predicate bodies are byte-parallel (zero-diff between the two functions).
- Docblocks in BOTH source files include the 2026-08-29 refinement note.
- Test-matrix describe blocks in BOTH test files contain Cases 8/9/10 (mirrored identically) plus positive regressions confirming real chat + real slash-commands still count.
- Mixed-tail integration test in BOTH files includes a Case-8-shape line NEWER than T2 and still returns T2.
- Both scoped test files pass end-to-end (`npx vitest run` on the two files).
- All changes ship in ONE commit (both source files + both test files).
</success_criteria>

<output>
Create `.planning/quick/260829-nzn-tighten-isashleyrealuserturn-predicate-t/260829-nzn-SUMMARY.md` when done.
</output>
