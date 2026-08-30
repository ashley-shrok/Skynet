---
phase: quick-260823-bap
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
  - src/backend/database/routes/sessions.ts
  - src/backend/database/routes/sessions.test.ts
autonomous: true
requirements:
  - QUICK-260823-BAP

must_haves:
  truths:
    - "A JSONL user turn with plain-string content starting with `<command-` counts toward lastMessageAt (slash-command invocation)."
    - "A JSONL user turn with plain-string content NOT wrapped in `<...>` counts toward lastMessageAt (typed prose)."
    - "A JSONL user turn wrapped like `<task-notification>...</task-notification>` or `<system-reminder>...</system-reminder>` does NOT count."
    - "A JSONL user turn with list-shaped content (tool_result OR skill-body `[{type:'text',text:'...'}]` injection) does NOT count."
    - "A JSONL `type:'assistant'` line — including relay_outbound sends — does NOT count."
    - "A JSONL `type:'user'` task-notification line — including relay_inbound receives — does NOT count."
    - "Both call sites (ssh-poll-orchestrator.ts + sessions.ts) apply the identical predicate — byte-parallel per Phase 43 scope decision."
  artifacts:
    - path: "src/backend/fleet-status/ssh-poll-orchestrator.ts"
      provides: "isAshleyRealUserTurn(rawLine) helper + scanTailForNewestMessageAt using new predicate; MESSAGE_BEARING_KINDS deleted; 2026-08-14 docblock replaced with 2026-08-23 lock verbatim"
      contains: "isAshleyRealUserTurn"
    - path: "src/backend/database/routes/sessions.ts"
      provides: "byte-parallel isAshleyRealUserTurn(rawLine) helper + scanTailForNewestMessageAt using new predicate; MESSAGE_BEARING_KINDS deleted; docblock updated to new lock"
      contains: "isAshleyRealUserTurn"
    - path: "src/backend/fleet-status/ssh-poll-orchestrator.test.ts"
      provides: "7 new predicate-matrix tests + inverted existing tests that seeded relay_inbound/relay_outbound/assistant frames"
    - path: "src/backend/database/routes/sessions.test.ts"
      provides: "same 7-case predicate matrix + any existing assertions that counted relay/assistant frames flipped"
  key_links:
    - from: "scanTailForNewestMessageAt (both sites)"
      to: "isAshleyRealUserTurn(rawLine)"
      via: "per-line predicate replacing MESSAGE_BEARING_KINDS.has(parsed.kind)"
      pattern: "isAshleyRealUserTurn\\(.*rawLine|line\\)"
    - from: "isAshleyRealUserTurn"
      to: "raw JSON.parse of the JSONL line"
      via: "independent parse pattern mirroring scanTailForLatestAiTitle (option (a), NOT extending parseSessionLine)"
      pattern: "JSON\\.parse\\("
---

<objective>
Invert the derivation of `SessionState.lastMessageAt` so conversation-list
ordering reflects ONLY Ashley's real messages going TO agents (typed prose +
slash-command invocations). Currently the derivation counts assistant activity,
relay_inbound / relay_outbound, task-notification wake fires, and (as a latent
bug the 2026-08-14 lock never explicitly excluded) skill-body list-content
injections. Ashley 2026-08-23 verbatim: "only my real messages going to them" —
this INVERTS the 2026-08-14 lock which read "activity = message either
direction, and only that".

Purpose: Recency ordering in the fleet-status conversation list must reflect
Ashley's own outbound cadence to each agent, not agent-side activity or
ambient/wake noise. The recency signal is used to sort the list so the
top-of-list is "the agent I most recently spoke to" — assistant activity and
task notifications drown that signal today.

Output: Both `scanTailForNewestMessageAt` implementations (fleet-status
live-poll + dormant /sessions/list) switched to a `isAshleyRealUserTurn(rawLine)`
predicate. Old `MESSAGE_BEARING_KINDS` constant deleted (verified single-caller
before delete). Docblocks updated to cite the 2026-08-23 lock verbatim.
Byte-parallel between the two sites (43-CONTEXT.md pattern — no new shared
module). Wire schema unchanged (`SessionState.lastMessageAt: number | null`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

@src/backend/fleet-status/ssh-poll-orchestrator.ts
@src/backend/database/routes/sessions.ts
@src/backend/claude-session/session-file-parser.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add the 7-case predicate matrix as failing tests at BOTH sites (RED)</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.test.ts, src/backend/database/routes/sessions.test.ts</files>
  <behavior>
    New describe block per test file — `describe("isAshleyRealUserTurn — Ashley 2026-08-23 lock predicate matrix")`. Same 7 cases per site (byte-parallel):

    Case 1 (KEEP — typed prose): `{"type":"user","message":{"role":"user","content":"Hello Amelia"},"timestamp":"2026-08-23T10:00:00.000Z","uuid":"u1"}` → predicate returns true; scanTailForNewestMessageAt returns Date.parse("2026-08-23T10:00:00.000Z").
    Case 2 (KEEP — slash-command invocation): user turn with plain-string content `"<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>tina</command-args>"` → predicate true; scanTail returns that line's ts.
    Case 3 (DROP — task-notification wrapper): user turn with plain-string content `"<task-notification>wakeup</task-notification>"` → predicate false; scanTail with only this line returns null.
    Case 4 (DROP — system-reminder wrapper): user turn with plain-string content `"<system-reminder>reminder body</system-reminder>"` → predicate false; scanTail returns null.
    Case 5 (DROP — tool_result list content, regression lock): user turn with content `[{"tool_use_id":"toolu_x","type":"tool_result","content":"...","is_error":false}]` → predicate false; scanTail returns null.
    Case 6 (DROP — skill-body list-content injection, NEW exclusion): user turn with content `[{"type":"text","text":"skill body..."}]` → predicate false; scanTail returns null. Comment must call out "pre-Aug-23 this was silently counted".
    Case 7 (DROP — any assistant turn, regression lock): `{"type":"assistant","message":{"role":"assistant","content":"reply"},"timestamp":"...","uuid":"u7"}` → predicate false; scanTail returns null. Second assertion in same test: an assistant relay_outbound line (curl -X PUT with rooms/…/send/m.room.message URL shape — reuse an existing outbound fixture already present in the test file if one exists, else construct minimal one) → predicate false.

    Also add ONE mixed-tail integration case per site: seed a tail with lines in the order [Case 5, Case 7, Case 3, Case 1@ts=T1, Case 2@ts=T2>T1] — assert scanTailForNewestMessageAt returns T2 (the newest KEEP line's ts) even with 3 DROP lines interleaved.

    Use `Date.parse(...)` (millis) — NOT hardcoded epoch numbers — so timestamps stay grep-legible on future maintenance.

    Both files: the predicate is not yet exported. Import it inline once implemented. For RED, either:
      (a) declare a `const isAshleyRealUserTurn: (raw: string) => boolean` binding that references the not-yet-exported symbol (will fail at import time — acceptable RED), OR
      (b) call the still-existing scanTailForNewestMessageAt with a single-line tail composed of the case's raw JSONL and assert on its return value (this is the CLEANER RED path — scanTail is the observable; the predicate is the internal seam. Prefer this shape for all 7 cases + the mixed-tail case).

    Path (b) preferred — makes the tests survive if the internal helper is ever renamed. Only add a direct predicate-import test IF the file already exports helper-level fixtures for similar helpers.
  </behavior>
  <action>
    Locate the existing describe block that owns tail-scan tests in each file (grep for `scanTailForNewestMessageAt` — Test D / Test F region in ssh-poll-orchestrator.test.ts ~L950-1250; in sessions.test.ts search from top). Insert the new describe block immediately AFTER the existing one to preserve fixture-line-number legibility for git-blame on the older tests. Do NOT modify existing tests in this task — that is Task 3. Every case constructs a single-line JSONL string and calls scanTailForNewestMessageAt(tailContents) directly. Run the two test files scoped: `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts` — the new tests MUST FAIL because MESSAGE_BEARING_KINDS still gates via kind-based match (Cases 3,4,5,6,7 either wrongly return non-null OR wrongly return null depending on which kind parseSessionLine emits for them). Commit as `test(quick-260823-bap): RED — Ashley 2026-08-23 msg-only-recency predicate matrix`.
  </action>
  <verify>
    <automated>npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts 2>&1 | grep -E "FAIL|(\d+) failed" | head -20</automated>
  </verify>
  <done>The new describe blocks exist in both test files. Running the scoped vitest command shows at least 7 new failing tests per file (14+ new failures total). Commit created with `test(quick-260823-bap): RED — …` message. No production files touched.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add isAshleyRealUserTurn helper + swap the predicate at BOTH sites (GREEN)</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.ts, src/backend/database/routes/sessions.ts</files>
  <behavior>
    After this task, all 14+ RED tests from Task 1 pass AND no pre-existing tests regress that weren't scheduled for inversion in Task 3.

    Behavior of the new predicate `isAshleyRealUserTurn(rawLine: string): boolean` — verbatim from the LOCKED spec:

    Returns true iff ALL:
      1. `rawLine.trim()` is non-empty AND parseable as JSON.
      2. Parsed top-level `type === "user"`.
      3. `message.content` is a plain string (typeof === "string"); list content returns false.
      4. Either:
         (a) trimmed content starts with `<command-` → true, OR
         (b) NOT (trimmed content starts with `<` AND ends with `>`) → true.
      Otherwise → false.

    Anything else (assistant lines, list-content user turns, XML-wrapped user turns that aren't `<command-`) → false.

    Note that step 3 alone excludes tool_result (list content) AND skill-body injections (`[{type:"text",text:...}]`). Step 2 excludes assistant lines including relay_outbound. Step 4b excludes `<task-notification>...</task-notification>` and `<system-reminder>...</system-reminder>` wrappers.
  </behavior>
  <action>
    In `src/backend/fleet-status/ssh-poll-orchestrator.ts`:

    (a) DELETE the `MESSAGE_BEARING_KINDS` set at ~L247 (verified single-caller: only `scanTailForNewestMessageAt` at ~L305 in this file; no external imports — confirmed via grep `MESSAGE_BEARING_KINDS` returns only the two file-local sites).

    (b) Add new helper `isAshleyRealUserTurn(rawLine: string): boolean` immediately BEFORE `scanTailForNewestMessageAt`. Structure mirrors the independent-JSON.parse pattern of `scanTailForLatestAiTitle` in sessions.ts (option (a) per the change spec — do NOT extend parseSessionLine to expose raw content; keep parallel-copy discipline per 43-CONTEXT.md). Implementation: trim → early-return false on empty → `try { obj = JSON.parse(trimmed) } catch { return false }` → check `typeof obj === "object" && obj !== null` → check `(obj as any).type === "user"` → dig `message.content`, verify `typeof content === "string"` (return false for list/undefined) → `const t = content.trim()` → return true if `t.startsWith("<command-")` OR NOT (`t.startsWith("<") && t.endsWith(">")`).

    (c) In `scanTailForNewestMessageAt`: replace `if (!MESSAGE_BEARING_KINDS.has(parsed.kind)) continue;` with `if (!isAshleyRealUserTurn(line)) continue;`. Keep the existing `parseSessionLine(line)` call ONLY if the `ts` extraction still needs it — recheck: yes, `parsed.ts` is still the source of truth for the timestamp (parseSessionLine handles the `Date.parse(rawTs)` fallback). Rewire: call `isAshleyRealUserTurn(line)` FIRST as the cheap filter, then call `parseSessionLine(line)` and pull `ts`. If parseSessionLine returns kind:"skip" or "malformed" for a line that passed the predicate (edge case — e.g. `queue-operation` enqueue with non-user role), fall back to reading `obj.timestamp` directly via a second local JSON.parse — DO NOT trust `parsed.ts` if kind is not one that carries ts. Simplest correct shape: after the predicate passes, do `const obj = JSON.parse(line)` inside `isAshleyRealUserTurn` AND return the `ts` too — refactor helper to return `{ok: true, ts: number} | {ok: false}` so scanTail avoids a second JSON.parse. Update the helper name accordingly (still `isAshleyRealUserTurn` — the object return is the internal contract, the semantic name stays). ts extraction: `Date.parse(obj.timestamp)` when `typeof obj.timestamp === "string"`, else return `{ok: false}`.

    (d) REPLACE the docblock at ~L229-246 verbatim with:
        ```
        /**
         * Ashley 2026-08-23 lock: "only my real messages going to them" —
         * INVERTS the 2026-08-14 lock. Assistant activity, incoming/outgoing
         * DMs, scheduled wakes, task notifications, skill-body injections all
         * excluded. See quick-260823-bap plan for the full predicate matrix.
         *
         * Predicate: a JSONL line counts iff top-level type==="user" AND
         * message.content is a plain string AND (starts with "<command-" OR
         * NOT (starts with "<" AND ends with ">") on trimmed content).
         *
         * Independent JSON.parse (mirrors scanTailForLatestAiTitle pattern) —
         * do NOT extend parseSessionLine to expose raw content. Parallel-copy
         * discipline preserved per 43-CONTEXT.md scope decision (canonical
         * copy in sessions.ts must stay byte-parallel).
         */
        ```

    In `src/backend/database/routes/sessions.ts`:

    (e) DELETE `MESSAGE_BEARING_KINDS` at ~L68 (single-caller verified — only scanTailForNewestMessageAt at ~L85).

    (f) Add the SAME `isAshleyRealUserTurn` helper — byte-parallel with site #1. Copy-paste allowed and expected (43-CONTEXT.md "no new shared module" scope decision inherited).

    (g) Replace the predicate check in scanTailForNewestMessageAt identically to site #1.

    (h) Update the docblock at ~L54-68 to reflect the new lock — retain the "canonical copy in ssh-poll-orchestrator.ts" cross-reference (with the current line number of the helper — grep to confirm before writing), just invert the meaning-carrying paragraph to cite Ashley 2026-08-23 verbatim.

    Verify no other callers of MESSAGE_BEARING_KINDS exist AFTER the delete: `grep -rn 'MESSAGE_BEARING_KINDS' src/` must return zero hits.

    Run: `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts` — the 14+ Task 1 tests MUST PASS. Some pre-existing tests that seeded relay_inbound/relay_outbound/assistant frames as "should count" fixtures WILL FAIL — that is expected and is Task 3's scope; do not fix them here. Commit as `feat(quick-260823-bap): GREEN — Ashley 2026-08-23 msg-only-recency predicate at both sites`.
  </action>
  <verify>
    <automated>grep -rn 'MESSAGE_BEARING_KINDS' src/ | grep -v '^#' | wc -l</automated>
  </verify>
  <done>
    `grep -rn 'MESSAGE_BEARING_KINDS' src/` returns 0.
    `grep -c 'isAshleyRealUserTurn' src/backend/fleet-status/ssh-poll-orchestrator.ts` returns ≥ 3 (helper decl + scanTail call + docblock mention).
    `grep -c 'isAshleyRealUserTurn' src/backend/database/routes/sessions.ts` returns ≥ 3 (same shape).
    Task 1's 14+ new tests all pass.
    Commit created with `feat(quick-260823-bap): GREEN — …` message.
    Docblock at site #1 contains the exact string "Ashley 2026-08-23 lock" AND "INVERTS the 2026-08-14 lock".
    Docblock at site #2 contains "Ashley 2026-08-23 lock".
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Invert existing tests that seeded now-excluded frames as "should count"</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.test.ts, src/backend/database/routes/sessions.test.ts</files>
  <behavior>
    After this task, the FULL scoped test file suite passes (both files) with no unaddressed failures. Every existing test that asserted a relay_inbound / relay_outbound / assistant-role message frame COUNTS toward lastMessageAt now asserts it does NOT count. Fixture line numbers preserved where possible for git-blame legibility.
  </behavior>
  <action>
    Run `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts` and collect the failure list from Task 2's GREEN commit. Every failing test in that list is either:

    (i) A test that was CORRECTLY asserting the old 2026-08-14 lock behavior (relay_inbound/outbound/assistant counts as recency-bearing) → INVERT the assertion: expected recency was the ts of a relay/assistant frame → new expectation is either `null` (if no user-real turn was present in the tail) or the ts of the nearest user-real-turn line in the fixture. Update in-place; keep the test name accurate to what it now tests (e.g. rename "Test D: relay_outbound advances lastMessageAt" → "Test D: relay_outbound does NOT advance lastMessageAt (Ashley 2026-08-23 lock)").

    (ii) A test whose fixture is now degenerate (ALL lines were relay/assistant, so scanTail correctly returns null) → either delete the test (if it no longer proves anything meaningful) OR augment its fixture with one user-real turn so it still tests the scan mechanics. Prefer augmenting — deleting loses test-count coverage.

    For ssh-poll-orchestrator.test.ts specifically, audit the ~L950-1250 range (Test D message-bearing filter, Test F user-only counts, Test I) as flagged in the change spec. Also grep for `relay_inbound`, `relay_outbound`, and `"role":"assistant"` fixture strings across the whole file to catch anything outside that range.

    For sessions.test.ts, do the same grep-based audit — the file is smaller so a full-file scan is cheap.

    When updating a test's assertion, ALSO update its inline comment (if any) so future maintainers see the lock inversion documented at the point of test. Cite "Ashley 2026-08-23 lock" in the comment.

    Do NOT change fixture line numbers unnecessarily. If a test's fixture must grow (case ii above), append the new line at the END of the fixture rather than the middle so upstream line offsets stay stable.

    After all inversions, run the full scoped suite and confirm zero failures across both files. Then commit as `test(quick-260823-bap): invert existing tests to Ashley 2026-08-23 msg-only-recency lock`.

    Executor scope explicitly STOPS here — do NOT run the full-repo test suite (that is the orchestrator's ship-gate per fleet directive Ashley 2026-08-20), do NOT deploy, do NOT `git push`, do NOT edit `~/.claude/roles/box-maintainer/box-maintainer.md`, do NOT edit `skynet-patches.md`.
  </action>
  <verify>
    <automated>npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>
    Scoped vitest run of the two test files returns exit 0.
    `grep -c 'Ashley 2026-08-23 lock' src/backend/fleet-status/ssh-poll-orchestrator.test.ts` returns ≥ 1 (at least one inline comment cites the lock, plus the new describe block from Task 1).
    Same grep for sessions.test.ts returns ≥ 1.
    Commit created with `test(quick-260823-bap): invert existing tests …` message.
    No production files touched in this commit.
    `git log --oneline -3` shows the three atomic commits in order: RED (Task 1) → GREEN (Task 2) → invert (Task 3).
  </done>
</task>

</tasks>

<verification>
Scoped test files pass end-to-end:
  npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/database/routes/sessions.test.ts

Predicate is present at both sites:
  grep -rn 'isAshleyRealUserTurn' src/backend/ | wc -l   # ≥ 6 (helper decl + scanTail call + docblock mention per site)

Old kind-based filter is fully gone:
  grep -rn 'MESSAGE_BEARING_KINDS' src/ | wc -l          # 0

Both docblocks cite the new lock:
  grep -c 'Ashley 2026-08-23 lock' src/backend/fleet-status/ssh-poll-orchestrator.ts   # ≥ 1
  grep -c 'Ashley 2026-08-23 lock' src/backend/database/routes/sessions.ts             # ≥ 1

Byte-parallel discipline preserved (43-CONTEXT.md): the isAshleyRealUserTurn helper body at both sites is textually identical (comments allowed to differ):
  diff <(sed -n '/function isAshleyRealUserTurn/,/^}/p' src/backend/fleet-status/ssh-poll-orchestrator.ts) \
       <(sed -n '/function isAshleyRealUserTurn/,/^}/p' src/backend/database/routes/sessions.ts)
  # expected empty diff (or comment-only differences)

Three atomic commits on the current branch (`feat/tab-title-from-tmux`), no worktrees used.
</verification>

<success_criteria>
- Both `scanTailForNewestMessageAt` functions use `isAshleyRealUserTurn` (raw-line, independent JSON.parse) — parseSessionLine's return kind is no longer the recency filter.
- `MESSAGE_BEARING_KINDS` constant deleted from both files; zero remaining callers.
- Docblocks at both sites cite the Ashley 2026-08-23 lock verbatim (with cross-reference to canonical copy site — line numbers grep-refreshed).
- 7-case predicate matrix (typed prose, slash-command, task-notification, system-reminder, tool_result list, skill-body list, assistant) plus one mixed-tail integration test covered at each site — 16+ new tests total.
- Every pre-existing test that assumed relay_inbound/relay_outbound/assistant frames were message-bearing is inverted; scoped suite green.
- Three atomic commits in RED → GREEN → invert order.
- Executor stopped: no push, no deploy, no docs edits, no box-maintainer.md edits, no skynet-patches.md edits.
</success_criteria>

<output>
Create `.planning/quick/260823-bap-ashley-msg-only-recency/260823-bap-SUMMARY.md` when done — record:
  - The three commit SHAs (RED / GREEN / invert)
  - The final test count delta (new tests added, existing tests inverted, existing tests unchanged)
  - Any documented deviations from this plan (e.g. helper name if you refactored to `{ok, ts}` return shape, per Task 2 action step (c))
  - Confirmation that `grep -rn 'MESSAGE_BEARING_KINDS' src/` returns 0 post-Task-2
  - Confirmation that both docblocks cite "Ashley 2026-08-23 lock"
  - Any pre-existing test files OUTSIDE the two scoped files whose behavior appeared affected but were left alone per executor scope (flag for orchestrator's ship-gate)
</output>
