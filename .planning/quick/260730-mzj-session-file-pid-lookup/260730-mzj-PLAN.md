---
phase: quick-260730-mzj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/session-file-discovery.ts
  - src/backend/claude-session/session-file-discovery.test.ts
autonomous: true
requirements:
  - PID-LOOKUP-01
must_haves:
  truths:
    - "When two Claude sessions share the same cwd on one box, each pane's pretty-view resolves to its own JSONL (no mtime-based cross-collision)."
    - "discoverClaudeSession returns {status:'active', pid, sessionFile} where sessionFile is derived from ~/.claude/sessions/<PID>.json, not from `ls -t`."
    - "Missing ~/.claude/sessions/<PID>.json returns a distinct inactive reason (no_pid_session_file) so downstream logging can distinguish it from a missing JSONL on disk."
    - "session-file-discovery.test.ts covers all new failure branches (missing PID file, malformed JSON, missing sessionId field, sessionId → JSONL not found) plus the walk-related reasons already tested."
    - "npm run build:backend && npm run build is clean; sibling test suites still pass."
  artifacts:
    - path: "src/backend/claude-session/session-file-discovery.ts"
      provides: "PID-file-based Claude session resolver (Step 5 rewrite)"
      contains: "readlink"
    - path: "src/backend/claude-session/session-file-discovery.test.ts"
      provides: "Vitest coverage for PID-file-based resolver"
      contains: "no_pid_session_file"
  key_links:
    - from: "src/backend/claude-session/session-file-discovery.ts"
      to: "~/.claude/sessions/<PID>.json (remote fs, read via execCommand)"
      via: "SSH exec channel"
      pattern: "\\.claude/sessions/"
    - from: "src/backend/claude-session/session-file-discovery.ts"
      to: "~/.claude/projects/<slug>/<sessionId>.jsonl (remote fs)"
      via: "test -f verification"
      pattern: "\\.claude/projects/"
---

<objective>
Replace the mtime-based JSONL discovery in `session-file-discovery.ts` Step 5 with a per-PID
session-file lookup that reads `~/.claude/sessions/<PID>.json`, extracts `sessionId` + `cwd`, and
constructs the exact transcript path. Eliminates cross-agent JSONL collisions when two Claude
sessions share a cwd on the same box.

Purpose: Fixes the "clicking Aqua on Workstation shows Wilma's bubbles" pretty-view collision
Ashley just hit. Old `ls -t $HOME/.claude/projects/<slug>/*.jsonl | head -n 1` picks by mtime and
races between agents whose cwd slugifies identically. New path is correct-first-time.

Output: Rewritten `session-file-discovery.ts` (Steps 1-4 preserved verbatim, Step 5 replaced) and
rewritten `session-file-discovery.test.ts` covering the new failure taxonomy. Commit-only — no
push, no deploy (Tina handles that after this task returns).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/backend/claude-session/session-file-discovery.ts
@src/backend/claude-session/session-file-discovery.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rewrite session-file-discovery.ts Step 5 to read ~/.claude/sessions/&lt;PID&gt;.json</name>
  <files>src/backend/claude-session/session-file-discovery.ts</files>
  <behavior>
    Preserved behavior (Steps 1-4 unchanged):
    - `queryPanePid` returns null → `{status:"inactive", reason:"no_tmux_session"}`
    - walk script (ps -eo … | awk) empty → `{status:"inactive", reason:"not_claude"}`
    - walk script throws / times out → `{status:"inactive", reason:"exec_error"}`
    - walk output non-numeric → `{status:"inactive", reason:"exec_error"}`
    - `pid_unavailable` remains in the type union (backcompat comment kept; not emitted).

    New Step 5 behavior (replaces the readlink+slug+`ls -t` block):
    - Reads `$HOME/.claude/sessions/&lt;claudePid&gt;.json` on the remote host via `execCommand` (single
      SSH round trip). The remote script cats the file and, on success, prints its raw contents.
    - Parses the returned string as JSON. Extracts string fields `sessionId` and `cwd`.
    - Slugifies `cwd` with the same transform the old code used: every `/` and `.` replaced by
      `-` (implemented in JS as `cwd.replace(/[./]/g, "-")`, matching `sed 's|[./]|-|g'`).
    - Constructs `$HOME/.claude/projects/&lt;slug&gt;/&lt;sessionId&gt;.jsonl`. `$HOME` on the remote host is
      resolved by the shell script (do not hardcode `/home/ubuntu`); the JS layer receives the
      already-expanded absolute path from the shell script's second echo, OR the JS assembles
      the path from `cwd` (which is absolute) and a separately-fetched `$HOME`. Executor's
      judgment — a single combined shell script that emits both the JSON blob AND `$HOME` on
      separate lines is acceptable and preferred (one SSH round trip beats two).
    - `test -f` on the constructed path over the same SSH channel to verify existence. If the
      script bundles this into the same exec so everything happens in one round trip, fine.
    - Return `{status:"active", pid: claudePid, sessionFile:&lt;absolute-path&gt;}` on success.

    New failure taxonomy (Step 5):
    - `~/.claude/sessions/&lt;PID&gt;.json` does not exist (cat/test failure, empty output where JSON
      was expected) → `{status:"inactive", reason:"no_pid_session_file"}`.
    - SSH exec throws / times out during Step 5 → `{status:"inactive", reason:"exec_error"}`
      (same as walk-step behavior).
    - JSON parse error, missing `sessionId` field, missing `cwd` field, or either field not a
      non-empty string → `{status:"inactive", reason:"no_pid_session_file"}`. (Single reason for
      "we couldn't get a valid sessionId out of the PID file" — simpler downstream.)
    - `sessionId` resolved successfully but the constructed `.jsonl` does not exist on disk →
      `{status:"inactive", reason:"no_open_session_file"}` (existing reason, semantically
      correct: we know which file it should be, but it's not there).

    Type union export update:
    - `ClaudeSessionDiscoveryResult` inactive `reason` union becomes:
      `"no_tmux_session" | "not_claude" | "pid_unavailable" | "no_pid_session_file" | "no_open_session_file" | "exec_error"`.
    - Order in the source: keep `pid_unavailable` where it is (backcompat comment references it);
      add `"no_pid_session_file"` immediately before `"no_open_session_file"` for readability.
    - Discriminated union stays exhaustive — downstream `switch (result.reason)` consumers
      compile against the new member (find them with grep — likely `claude-session-server.ts`
      around lines 2201-2267; do NOT retire the ticker there, only widen its exhaustiveness
      handling if TS complains).
  </behavior>
  <action>
    Rewrite Step 5 of `discoverClaudeSession` per D-PID-LOOKUP-01. Keep Steps 1-4 (queryPanePid,
    walkScript with the load-bearing `;` separators, Promise.race timeout wrapper, claudePid
    parsing) byte-identical — do NOT re-shape or "clean up" the walk block. The walk-script
    comment about `;` separators being LOAD-BEARING (lines ~63-71 of the current file) is a
    scar from patch #170→#174 (fleet-wide outage) and must survive verbatim.

    New Step 5 script assembly discipline (LOAD-BEARING, same rule as walkScript): when
    concatenating shell fragments in JS via `+`, terminate each statement with `;`. Do not
    rely on newlines or `\n` — JS `+` collapses fragments onto one line and the shell parses
    without statement separators unless you provide them explicitly. Add a comment above the
    new script block echoing this discipline, cross-referencing the walkScript comment so a
    future reader understands both are the same class of hazard.

    Suggested Step 5 script shape (single exec, one round trip):
    - `PID=&lt;claudePid&gt;; F=$HOME/.claude/sessions/$PID.json; if [ ! -f "$F" ]; then exit 10; fi; cat "$F"; printf '\n---HOME---\n'; printf '%s' "$HOME"`
    - JS side: check exit-code-ish via presence of the delimiter. If output empty or delimiter
      absent → `no_pid_session_file`. Otherwise split on the delimiter, parse the first half as
      JSON, use the second half as `$HOME`. Then a SECOND exec: `test -f &lt;constructed-path&gt; && printf '%s' &lt;constructed-path&gt;`. Empty output → `no_open_session_file`; non-empty →
      return active.
    - Executor may collapse to one exec if a cleaner assembly exists — the contract is (a) one
      round trip preferred, (b) statement separators discipline preserved, (c) failure branches
      map to the taxonomy above.

    Wrap each `execCommand` in the same `Promise.race([execCommand(...), timeout])` pattern the
    walk uses, reusing `DISCOVERY_EXEC_TIMEOUT_MS = 3000`. Timeouts → `exec_error`.

    Update `ClaudeSessionDiscoveryResult` type union per behavior spec above. Grep the repo for
    consumers of `ClaudeSessionDiscoveryResult` and `no_open_session_file` to verify no
    downstream exhaustive-switch breaks: `grep -rn "ClaudeSessionDiscoveryResult\|no_open_session_file\|no_pid_session_file" src/`. Fix any TS errors that surface (widen
    switches, add `case "no_pid_session_file":` arms, etc.) — likely in
    `claude-session-server.ts` around the discovery-repoll ticker (lines ~2201-2267). DO NOT
    retire that ticker; it still serves the session-recycle-picked-new-PID case (out of scope
    per task boundary).

    Comment updates:
    - Top-of-file JSDoc `Flow:` section: rewrite the Step 5 description. Replace the
      `readlink /proc/&lt;pid&gt;/cwd + slug transform + ls -t` explanation with the new PID-file
      flow: "Read $HOME/.claude/sessions/&lt;PID&gt;.json (Claude Code v2.1.150+), parse sessionId +
      cwd, slugify cwd, construct $HOME/.claude/projects/&lt;slug&gt;/&lt;sessionId&gt;.jsonl, verify
      exists." Explain WHY: mtime disambiguation broke when two Claude sessions shared a cwd
      on one box; PID-file lookup is correct-first-time. Reference the pretty-view-shows-wrong-session-jsonl bounty.
    - The multi-line comment block above the OLD `discoveryScript` (lines ~122-139) describing
      readlink + slug + `ls -t` mtime pick: DELETE it. Replace with a shorter comment block
      describing the PID-file lookup and its failure taxonomy.
    - Backcompat comment about `pid_unavailable` (lines ~46-48): KEEP verbatim. That reason is
      still emitted by Step 1 (well — no, Step 1 currently returns `no_tmux_session` for
      `panePid <= 0`; `pid_unavailable` is genuinely dead code kept only for the type union
      backcompat contract). Comment already says "no longer emitted" — leave it.
    - Walk-script `;`-separator comment (~63-71): KEEP verbatim. Add a cross-reference from
      the new Step 5 comment: "See walk-script comment above — same JS-concat hazard applies."

    NO push, NO docker build, NO deploy — commit-only work. Do NOT edit anything under
    `~/.claude/identities/tina/` (Tina handles patch #206 + bounty status flip + timeline
    after this task returns).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npm run build:backend &amp;&amp; npm run build</automated>
  </verify>
  <done>
    - Step 5 of `discoverClaudeSession` reads `~/.claude/sessions/&lt;PID&gt;.json` instead of running
      `ls -t` on the slug dir.
    - `ClaudeSessionDiscoveryResult` type union includes `"no_pid_session_file"`.
    - Steps 1-4 unchanged (walkScript byte-identical including all `;` separators and the
      load-bearing comment).
    - `npm run build:backend && npm run build` exits 0 with no TS errors anywhere in the repo.
    - `grep -n "ls -t" src/backend/claude-session/session-file-discovery.ts` returns no matches
      (the mtime pick is gone).
    - `grep -n "\\.claude/sessions/" src/backend/claude-session/session-file-discovery.ts`
      returns at least one match (the new PID-file read).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rewrite session-file-discovery.test.ts for the PID-file flow</name>
  <files>src/backend/claude-session/session-file-discovery.test.ts</files>
  <behavior>
    Preserved tests (walk-step coverage — still passes after Task 1's rewrite):
    - Test A: kiro-cli-term wrapper — walk emits "102", PID-file lookup succeeds, returns
      `{status:"active", pid:102, sessionFile:...}`.
    - Test B: 4-level wrapper chain — walk emits "103", PID-file lookup succeeds.
    - Test C: pane_pid IS claude directly (backcompat) — walk emits "200".
    - Test D: no claude in descendant tree — walk emits "" → `not_claude`.
    - Test E: queryPanePid returns null → `no_tmux_session`, `execCommand` never called.
    - Test F: walk exec times out → `exec_error`.

    Deleted tests (mtime-based path is gone — these tests exercised behavior that no longer
    exists in production code):
    - The existing test's Case 7 ("walk succeeds but CWD/JSONL script exec rejects") IS still
      valid semantically — becomes "walk succeeds but PID-file exec rejects → exec_error".
      Rewrite rather than delete.
    - The existing test's Case 8 ("walk succeeds but CWD/JSONL script returns empty →
      no_open_session_file") splits into TWO tests in the new taxonomy: PID-file missing
      (new reason `no_pid_session_file`) vs. sessionId resolved but JSONL not on disk
      (existing reason `no_open_session_file`).

    New tests (Step 5 failure branches):
    - Test G: Happy path (PID-file exists, valid JSON, sessionId → JSONL found on disk).
      Explicit assertion that the returned `sessionFile` path equals
      `$HOME/.claude/projects/&lt;slug-of-cwd&gt;/&lt;sessionId&gt;.jsonl` for a known input, so the slug
      transform is regression-guarded (e.g. `cwd="/home/ubuntu/proj"`, `HOME="/home/ubuntu"`,
      `sessionId="abc-def"` → `/home/ubuntu/.claude/projects/-home-ubuntu-proj/abc-def.jsonl`).
    - Test H: PID-file missing (Step 5 exec emits empty output / delimiter absent) →
      `{status:"inactive", reason:"no_pid_session_file"}`.
    - Test I: PID-file returns malformed JSON (not-JSON string) → `no_pid_session_file`.
    - Test J: PID-file returns valid JSON but no `sessionId` field → `no_pid_session_file`.
      (One test covering "no sessionId" is sufficient — no need to enumerate missing-cwd,
      non-string-sessionId, empty-string-sessionId as separate cases; the code either accepts
      the payload or falls to the same reason.)
    - Test K: PID-file valid, sessionId resolved, but final `test -f` on constructed path
      returns empty (JSONL not on disk) → `no_open_session_file`.
    - Test L (rewrite of old Case 7): PID-file exec rejects (SSH channel error) →
      `exec_error`.

    Mock harness discipline:
    - Reuse the existing `vi.mock("../ssh/tmux-helper.js", ...)` factory unchanged (still needs
      `execCommand`, `queryPanePid`, `queryPaneCurrentCommand` per module contract).
    - `mockExecCommand` helper is the right shape but its parameter names / dispatch keys
      change: the second argument is no longer "discoveryOutput" but a MAP of outputs keyed by
      script-substring so the two Step 5 execs (PID-file read + test -f) can each return their
      own scripted output. Or: pass a single function that inspects the script and returns the
      correct output. Executor's judgment on the exact shape — the contract is (a) tests can
      script all Step 5 execs independently, (b) `if (script.includes("ps -eo"))` walk branch
      stays as-is.
    - The dispatch keys the helper looks for change from `"readlink -f"` (dead) to whatever
      distinctive substring the new PID-file script uses (e.g. `".claude/sessions/"` for the
      cat step, `"test -f"` for the existence check — pick strings that CANNOT collide with
      the walk script or with each other).
  </behavior>
  <action>
    Rewrite `session-file-discovery.test.ts` to cover the new Step 5 flow per D-PID-LOOKUP-01
    behavior spec above.

    Keep the top-of-file `vi.mock("../ssh/tmux-helper.js", …)` factory unchanged. Keep the
    `fakeConn` stub. Update `mockExecCommand` helper's shape to script the new Step 5 execs;
    the "walk branch" dispatch on `script.includes("ps -eo")` stays as-is.

    Test list to produce (12 tests total, in this describe order for readability):
      1. kiro-cli-term wrapper → active pid 102 (preserved)
      2. 4-level chain → active pid 103 (preserved)
      3. pane_pid IS claude → active pid 200 (preserved)
      4. no claude in tree → `not_claude` (preserved)
      5. queryPanePid null → `no_tmux_session`, execCommand never called (preserved)
      6. walk exec timeout → `exec_error` (preserved, uses `vi.useFakeTimers()`)
      7. happy path with explicit slug-transform assertion — Test G
      8. PID-file missing → `no_pid_session_file` — Test H
      9. PID-file malformed JSON → `no_pid_session_file` — Test I
      10. PID-file missing sessionId field → `no_pid_session_file` — Test J
      11. sessionId resolved but JSONL not on disk → `no_open_session_file` — Test K
      12. PID-file exec rejects → `exec_error` — Test L

    For each new test, script all execs the code will make (walk exec + PID-file exec + optional
    `test -f` exec). Assert the exact result object shape (status + reason OR status + pid +
    sessionFile), not just the reason string.

    DELETE any test that specifically depends on the mtime `ls -t` script substring or the
    readlink `/proc/&lt;pid&gt;/cwd` substring — those scripts no longer exist in production code.
    Rewrite of Case 7/8 into Tests K + L as described.

    Run the suite with `npx vitest run src/backend/claude-session/session-file-discovery.test.ts`
    to confirm all 12 pass BEFORE running the sibling suites.

    Then run the sibling suites listed in the task scope (they should be unaffected by the
    signature-preserving rewrite of `discoverClaudeSession`; if any fails, it means Task 1's
    consumer-side widening missed a spot — fix in Task 1's file, not here):
      `npx vitest run src/backend/claude-session/claude-session-server.count-bounties.test.ts src/backend/claude-session/claude-session-server.aside.test.ts src/backend/claude-session/claude-session-server.aside.integration.test.ts src/backend/claude-session/identity-artifact-reader.test.ts`

    NO push, NO deploy — commit-only.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet &amp;&amp; npx vitest run src/backend/claude-session/session-file-discovery.test.ts src/backend/claude-session/claude-session-server.count-bounties.test.ts src/backend/claude-session/claude-session-server.aside.test.ts src/backend/claude-session/claude-session-server.aside.integration.test.ts src/backend/claude-session/identity-artifact-reader.test.ts</automated>
  </verify>
  <done>
    - `session-file-discovery.test.ts` contains 12 tests, all passing.
    - No test in the file references `"readlink -f"`, `"ls -t"`, or `"/proc/"` as a dispatch key
      (verify with `grep -c '"readlink\|"ls -t\|"/proc/"' src/backend/claude-session/session-file-discovery.test.ts` — expected 0).
    - At least one test references `"no_pid_session_file"` (verify with
      `grep -v '^#' src/backend/claude-session/session-file-discovery.test.ts | grep -c no_pid_session_file` returns >= 4 — Tests H, I, J at minimum).
    - Sibling suites (count-bounties, aside, aside.integration, identity-artifact-reader) all
      pass unchanged.
  </done>
</task>

</tasks>

<verification>
Whole-phase gates the executor MUST run before committing:

1. `npm run build:backend && npm run build` exits 0. Fleet-strict check per patch #154 arc
   (2026-07-27) — a bare `npx tsc --noEmit` does NOT catch backend TS errors because the
   frontend tsconfig doesn't compile backend the same way.
2. `npx vitest run src/backend/claude-session/session-file-discovery.test.ts` = 12/12 pass.
3. `npx vitest run src/backend/claude-session/claude-session-server.count-bounties.test.ts src/backend/claude-session/claude-session-server.aside.test.ts src/backend/claude-session/claude-session-server.aside.integration.test.ts src/backend/claude-session/identity-artifact-reader.test.ts` all pass.
4. `grep -n "ls -t" src/backend/claude-session/session-file-discovery.ts` → no matches.
5. `grep -n "\\.claude/sessions/" src/backend/claude-session/session-file-discovery.ts` → at least one match.
6. Commit boundary: STOP. Do NOT push. Do NOT `docker compose up`. Do NOT edit anything under
   `~/.claude/identities/tina/`. Tina handles patch #206, bounty status, deploy queueing after
   this task returns.
</verification>

<success_criteria>
- `discoverClaudeSession` resolves the pane's JSONL from `~/.claude/sessions/<PID>.json`
  (sessionId + cwd) instead of `ls -t $HOME/.claude/projects/<slug>/*.jsonl`, eliminating the
  mtime race between two Claude sessions sharing a cwd on one box.
- `ClaudeSessionDiscoveryResult` type union widened with `"no_pid_session_file"`; discriminated
  union stays exhaustive; downstream consumers (likely `claude-session-server.ts`) compile.
- Steps 1-4 of `discoverClaudeSession` (queryPanePid, walkScript with load-bearing `;`
  separators, Promise.race timeout, claudePid parsing) are byte-identical to before.
- The walk-script `;`-separator comment (patch #170→#174 scar) survives verbatim; the new
  Step 5 script has an equivalent discipline comment cross-referencing it.
- `session-file-discovery.test.ts` has 12 tests covering the new failure taxonomy (happy path,
  PID-file missing, malformed JSON, missing sessionId, JSONL not on disk, exec reject) plus
  the preserved walk-step tests.
- `npm run build:backend && npm run build` clean; sibling test suites still pass.
- Discovery-repoll ticker in `claude-session-server.ts:2201-2267` NOT retired — still serves
  the session-recycle case.
- Two commits max (Task 1 impl, Task 2 tests), atomic, on the current working branch. No push,
  no deploy, no identity-side bookkeeping.
</success_criteria>

<output>
Create `.planning/quick/260730-mzj-session-file-pid-lookup/260730-mzj-SUMMARY.md` when done,
summarizing what changed, what tests were added/deleted, and confirming the boundary was
respected (no push, no deploy, no identity edits).
</output>
