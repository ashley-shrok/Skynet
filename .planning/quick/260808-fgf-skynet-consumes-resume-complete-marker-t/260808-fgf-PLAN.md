---
phase: quick-260808-fgf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/dormant-poll.test.ts
  - /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md
autonomous: true
requirements:
  - QUICK-260808-FGF
must_haves:
  truths:
    - "Backend records wake_trigger_ts at the moment the {type wake} handler successfully SSH-execs rm -f .dormant."
    - "Backend's dormant-poll re-discovery tick stats .resume-complete alongside .dormant, parses the marker's ISO-UTC contents, and treats the marker as valid ONLY when marker_ts > wake_trigger_ts (Nelly freshness contract)."
    - "Dormant to active transition emits dormant false ONLY when BOTH (a) .dormant sentinel is gone AND (b) a FRESH .resume-complete marker is present OR the 90s fallback timer has elapsed since wake_trigger_ts."
    - "If .resume-complete never appears within 90s of wake_trigger_ts, backend falls back to dismissing on sentinel-gone alone AND logs a dormancy_marker_fallback info-level entry so we can spot old-supervisor boxes during rollout."
    - "Frontend's existing first-live-frame auto-dismiss (patch #345, PrettyView.tsx lines 707-722) is preserved unchanged as a belt-and-suspenders strict-safety fallback. This patch is additive."
    - "Full npx vitest run reports 1589 pass / 6 skip / 0 fail (baseline 1585 pass / 6 skip from post-06bcb4d run, plus 4 new marker-consumption tests)."
    - "Ship completes under the 15-min deadman. docker compose up -d --force-recreate skynet plus container healthy sustained plus HTTPS 200 on term.gigaashley.click."
    - "Two patch entries appended to /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md. #347 (copy polish 06bcb4d, riding along) and #348 (marker consumption)."
  artifacts:
    - path: "src/backend/claude-session/claude-session-server.ts"
      provides: "wake_trigger_ts recording plus marker stat plus freshness comparison plus 90s fallback plus updated seam signature"
      contains: "wakeTriggerTs"
    - path: "src/backend/claude-session/dormant-poll.test.ts"
      provides: "New tests L M N O covering marker-fresh, marker-stale, marker-absent-fallback, marker-absent-within-window"
      contains: "resume-complete"
    - path: "/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md"
      provides: "Patch #347 (copy polish standalone tiny entry) plus Patch #348 (marker consumption full entry mirroring #346's format)"
      contains: "Patch #348"
  key_links:
    - from: "src/backend/claude-session/claude-session-server.ts (wake handler around line 3494)"
      to: "src/backend/claude-session/claude-session-server.ts (dormant-poll IIFE around line 4358)"
      via: "wakeTriggerTs closure variable. Set at successful rm -f exec. Read by seam via getter injection."
      pattern: "wakeTriggerTs"
    - from: "src/backend/claude-session/claude-session-server.ts (__applyDormantPollWithRediscoveryForTests seam around line 1036)"
      to: "supervisor's .resume-complete file on target host"
      via: "SSH exec cat ~/.claude/identities/NAME/.resume-complete"
      pattern: "resume-complete"
---

<objective>
Skynet consumes Nelly's .resume-complete supervisor-hands-off marker to dismiss the DormancyOverlay only after supervisor injection completes, per the wake-completion-signal-from-supervisor bounty contract. Extends the existing dormant-poll loop (patch #346 acfdf55) with a marker stat plus freshness comparison (marker_ts > wake_trigger_ts) plus a 90s fallback for mixed-fleet compatibility with pre-marker supervisor versions. The copy polish already committed as 06bcb4d rides along on the same ship.

Purpose. Close the current gap where DormancyOverlay dismisses on the FIRST live Claude frame, which fires DURING the supervisor's ~20s Ctrl-C train plus bracketed-paste plus start-your-monitors nudge Enter, leaving a window where Ashley's typing could interleave with the supervisor's paste and Enter. Contract per Nelly's 2026-08-08T10:55Z DM. Supervisor writes ISO-UTC marker at end of drive() right after final Enter (both fresh and resume paths). Removes at start of drive() and start of do_kill_dormant(). Skynet must NOT trust bare presence. The freshness check kills the stale-marker-across-supervisor-restart footgun.

Output.
- Backend. wake_trigger_ts recording in the wake handler. Extended seam with marker-stat plus freshness compare plus 90s fallback plus fallback log line.
- Tests. 4 new marker-consumption tests (L M N O) extending the existing 11-test dormant-poll.test.ts suite.
- Docs. patch #347 (copy polish, standalone tiny entry) plus patch #348 (marker consumption, full entry) in skynet-patches.md.
- Ship. docker compose deploy under 15-min deadman. HTTPS 200 plus full test suite green.
</objective>

<execution_context>
@/home/ubuntu/.claude/get-shit-done/workflows/execute-plan.md
@/home/ubuntu/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/ubuntu/skynet/.planning/PROJECT.md
@/home/ubuntu/skynet/.planning/STATE.md
@/home/ubuntu/skynet/CLAUDE.md

# Nelly's contract (REQUIRED READING, has full timeline)
@/home/ubuntu/.claude/roles/box-maintainer/bounties/wake-completion-signal-from-supervisor/bounty.json

# Prior art. Patch #346 that we're extending.
@/home/ubuntu/.claude/roles/box-maintainer/bounties/archive/dormancy-overlay-inactive-branch-fix/bounty.json
@/home/ubuntu/skynet/.planning/quick/260808-dmz-dormancy-overlay-never-shows-for-dormant/260808-dmz-SUMMARY.md

# Key files. Read specific ranges only, do not re-read the whole 4441-line server file.
# claude-session-server.ts key ranges.
#   - lines 918-1085. __applyDormantPollTickForTests plus __applyWakeMessageForTests plus __applyDormantPollWithRediscoveryForTests seams.
#   - lines 1160-1330. Connection-scoped state block (add wakeTriggerTs here).
#   - lines 3487-3505. Wake message handler (record wakeTriggerTs on successful exec).
#   - lines 4300-4433. Inactive-branch dormancy probe plus dormant-poll IIFE that wires the seam.
# PrettyView.tsx key ranges (READ ONLY, no edits in this quick).
#   - lines 419-434. handleWake callback (frontend wake trigger, no changes needed).
#   - lines 693-722. WS onmessage handler plus live-frame auto-dismiss (preserved unchanged).
#   - lines 780-810. dormant plus wake_result case handlers (preserved unchanged).
#   - lines 1561-1568. DormancyOverlay mount (no changes needed).
@/home/ubuntu/skynet/src/backend/claude-session/dormant-poll.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend. Extend seam signature, record wake_trigger_ts, add marker stat, add freshness compare, add 90s fallback.</name>
  <files>src/backend/claude-session/claude-session-server.ts</files>
  <behavior>
    Extend the existing __applyDormantPollWithRediscoveryForTests seam (currently at lines 1036-1085) and its caller (the dormant-poll IIFE at lines 4358-4395) to consume Nelly's .resume-complete marker per contract. Behaviors that MUST be true after this task (Task 2 tests L M N O will enforce).

    - Test L (marker present plus fresh, dismiss plus rediscover). sentinel gone AND marker present AND marker_ts > wake_trigger_ts, emit dormant false, invoke discoverSession, call startActiveFlow if active. Same behavior as current Tests H plus I but gated additionally on the marker.
    - Test M (marker present plus STALE, keep waiting). sentinel gone AND marker present BUT marker_ts less-than-or-equal-to wake_trigger_ts, do NOT emit dormant false, do NOT invoke discoverSession, keep polling. This is the stale-marker-across-supervisor-restart guard from Nelly's contract.
    - Test N (marker absent plus 90s elapsed since wake_trigger_ts, fallback dismiss). sentinel gone AND marker absent AND (now minus wake_trigger_ts) is greater-than-or-equal-to 90000ms, emit dormant false anyway, invoke discoverSession, log dormancy_marker_fallback info-level. This is the mixed-fleet compat path for boxes still running the pre-marker supervisor.
    - Test O (marker absent plus within 90s window, keep waiting). sentinel gone AND marker absent AND (now minus wake_trigger_ts) less-than 90000ms, do NOT emit dormant false, do NOT invoke discoverSession, keep polling. Gives fresh supervisor time to write the marker.
    - Regression. Existing Tests G H I J K MUST continue to pass. In particular, Test H (sentinel-gone, dismiss) MUST continue to pass. This means when wake_trigger_ts is null (natural resume path where user never clicked Wake, supervisor auto-woke), we still fall through to the current dismiss-on-sentinel-gone behavior. Freshness check applies ONLY when wake_trigger_ts is non-null.
  </behavior>
  <action>
    Implementation plan. Follow in this order to avoid re-reads. NO fenced code blocks below. This is directive prose only.

    STEP A. Extend connection-scoped state in claude-session-server.ts near line 1180-1185, alongside the existing dormantPollTimer and dormantPollInFlight declarations from patch #346. Add one new let. Name it wakeTriggerTs. Type it as number-or-null. Initialize to null. This records Date.now() at the moment the wake handler successfully SSH-execs rm -f. Add a brief comment referencing the Nelly freshness contract. Reset naturally with closure on WS close. Also cleared inside the startActiveFlow callback below (STEP D) when we transition to active. A completed wake cycle should not leak into a subsequent dormancy.

    STEP B. Wire wake_trigger_ts recording in the wake handler at claude-session-server.ts line 3494-3505. The current handler delegates to __applyWakeMessageForTests which does the rm -f exec internally and emits wake_result via wsSend. Do NOT modify __applyWakeMessageForTests. Its Test E and F and K signature (returns void, emits wake_result via wsSend) is a shape contract already covered by tests. The wake handler owns the timestamp lifecycle. The seam owns the SSH exec and emit. To capture the success moment, in the wake handler, declare a small local let named lastWakeOk. Initialize to false. Wrap the wsSend passed to the seam so that when the emitted frame's type is wake_result and ok is true, lastWakeOk becomes true. After awaiting the seam call, if lastWakeOk is true, set wakeTriggerTs to Date.now(). Do NOT set wakeTriggerTs on failure. Do NOT set it before the SSH exec succeeds. Keep the try-catch around the JSON.parse of the frame (parser may fail if a future frame shape changes, do not tank the handler).

    STEP C. Extend the dormant-poll-with-rediscovery seam signature at claude-session-server.ts lines 1036-1085. Add three deps to the deps object. First, markerCommand. Signature (conn, name) returning Promise of string-or-null. Returns the marker file contents (trimmed) or null on absent or on empty or on error. Second, on the state accessor object, add wakeTriggerTs. Signature no-arg returning number-or-null. Getter, matches the accessor pattern already used for dormantLastEmitted. Third, on the deps object, add now. Signature no-arg returning number. Defaults to Date.now. Injectable for deterministic time in tests. Also add ONE new module-scope constant near other constants at top of file. Name MARKER_FALLBACK_MS. Value 90000. Underscore-separated is fine, use the JavaScript numeric-separator syntax. Add a one-line comment referencing Nelly's contract and the mixed-fleet compat rationale.

    STEP D. Rewrite the sentinel-gone branch (currently lines 1067-1081 inside the seam body). Semantics in prose. When sentinel is gone (isDormant is false), read triggerTs via state.wakeTriggerTs(). If triggerTs is null (natural resume path with no user Wake click), skip the freshness check entirely and use the existing dismiss-plus-rediscover behavior (preserves Test H). Otherwise (user-initiated wake path). Call markerCommand(connSnapshot, escapedName). If it returns a non-null string, Date.parse the trimmed body. If the parsed number is finite AND greater than triggerTs, mark markerFresh true. Otherwise (marker was null OR unparseable OR stale), compute elapsed as deps.now() minus triggerTs. If elapsed is greater-than-or-equal-to MARKER_FALLBACK_MS, set fellBack true and markerFresh true. If markerFresh is still false after both checks, return early. Do NOT emit dormant false. Do NOT invoke discoverSession. Poll continues on next tick. If markerFresh is true and fellBack is true, log via sshLogger.info with message about dormancy marker fallback and operation dormancy_marker_fallback and include escapedName in the log context object. Same log pattern as the operation claude_session_dormant_entered at line 4344. Then fall through to the existing dismiss-plus-rediscover-plus-maybe-startActiveFlow behavior unchanged (emit dormant false, invoke discoverSession, if active call startActiveFlow, else keep dormantLastEmitted false and continue polling).

    STEP E. Wire the new deps in the dormant-poll IIFE at claude-session-server.ts line 4358-4395. Provide markerCommand as an inline async arrow. Body. Try to await execCommand on the SSH conn with the shell command that cats the marker path. Use the exact same single-quote-wrapped escaping pattern as the existing stat command at line 4336. Concretely, the SSH command string should read (backticks around the outer template literal, single quotes around the identity name portion) cat tilde slash dot claude slash identities slash single-quote NAME single-quote slash dot resume-complete then 2>/dev/null then two-pipe echo. On the resulting stdout, trim it. If length is greater than zero return the trimmed string, else return null. On any thrown exception return null. Empty-file and absent-file collapse to null so downstream logic treats them identically. Also add to the state accessor object a wakeTriggerTs getter returning the closure-scoped wakeTriggerTs. Also add to the deps object a now field. Value () returning Date.now(). Do NOT hardwire a stub in production. Inside the existing startActiveFlow callback (line 4372-4383) that fires when rediscovery yields active, add one new line. Set wakeTriggerTs (the closure-scoped variable) to null. This is belt-and-suspenders. The natural closure reset handles WS-close but this handles a within-single-WS pane rediscover to dormant to rediscover cycle.

    STEP F. Do NOT modify. PrettyView.tsx (frontend is intentionally unchanged. Live-frame auto-dismiss preserved as strict-safety fallback per constraints). __applyDormantPollTickForTests or __applyWakeMessageForTests seams (would break Tests A through F, plus K). The active-poll dormancy piggyback at around line 943-970 (dormant panes never reach it. Kept as defense-in-depth per patch #346 rationale). Supervisor-side anything (Nelly owns agent-supervisor. Contract already shipped 2026-08-08T10:55Z).

    STEP G. Run tsc after edits. npx tsc --noEmit. MUST exit 0 before proceeding to Task 2. Also grep to confirm the four required identifiers (wakeTriggerTs, MARKER_FALLBACK_MS, dormancy_marker_fallback, resume-complete) all appear in the modified file. See verify block.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | tail -20 && echo "---" && grep -c "wakeTriggerTs" src/backend/claude-session/claude-session-server.ts && grep -c "MARKER_FALLBACK_MS" src/backend/claude-session/claude-session-server.ts && grep -c "dormancy_marker_fallback" src/backend/claude-session/claude-session-server.ts && grep -c "resume-complete" src/backend/claude-session/claude-session-server.ts</automated>
  </verify>
  <done>tsc exits 0. wakeTriggerTs count is greater-than-or-equal-to 4 (declaration, wake-handler set, seam-accessor use, startActiveFlow clear). MARKER_FALLBACK_MS count is greater-than-or-equal-to 2 (declaration plus at-least-one usage). dormancy_marker_fallback count is greater-than-or-equal-to 1 (log call). resume-complete count is greater-than-or-equal-to 1 (the cat SSH command). Seam signature extended with markerCommand plus wakeTriggerTs plus now. Freshness plus fallback logic in place per Nelly's contract. Wake handler records wakeTriggerTs on success only. wakeTriggerTs cleared inside startActiveFlow callback.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Backend tests. Add L M N O covering marker-fresh, marker-stale, marker-absent-fallback, marker-absent-within-window. Verify G H I J K still green plus full suite baseline.</name>
  <files>src/backend/claude-session/dormant-poll.test.ts</files>
  <behavior>
    - Test L. sentinel stat returns no, markerCommand returns an ISO string parseable to wakeTriggerTs plus 5000ms, discoverSession returns active with pid 999 and sessionFile /x/y.jsonl. Expect. markerCommand called exactly once. wsSend called exactly once with dormant false. discoverSession called exactly once. startActiveFlow called once with 999 and /x/y.jsonl.
    - Test M. sentinel stat returns no, markerCommand returns an ISO string parseable to wakeTriggerTs minus 5000ms (STALE). Expect. markerCommand called exactly once. wsSend called ZERO times. discoverSession called ZERO times. startActiveFlow called ZERO times. state.current (dormantLastEmitted) remains true (unchanged).
    - Test N. sentinel stat returns no, markerCommand returns null (absent), now returns wakeTriggerTs plus 91000ms (fallback fired), discoverSession returns inactive not_claude. Expect. markerCommand called exactly once. wsSend called exactly once with dormant false. discoverSession called exactly once. startActiveFlow called ZERO times (still inactive).
    - Test O. sentinel stat returns no, markerCommand returns null (absent), now returns wakeTriggerTs plus 30000ms (within window). Expect. markerCommand called exactly once. wsSend called ZERO times. discoverSession called ZERO times. startActiveFlow called ZERO times.
    - Regression. Re-run existing Tests G H I J K. Tests G H I J will need their makeDormantState invocations updated to accept the new second argument (wakeTriggerTs default null) AND their seam invocations updated to pass markerCommand (a no-op returning null is fine since wakeTriggerTs null short-circuits) and now (also unused when wakeTriggerTs is null, but must be present to satisfy the seam signature). Test K is untouched. It exercises __applyWakeMessageForTests which we did not modify.
  </behavior>
  <action>
    Implementation plan. Extend the existing test suite following its patterns. Do NOT invent new infrastructure. NO fenced code blocks below.

    STEP A. Extend the makeDormantState helper at dormant-poll.test.ts lines 264-271. Currently it takes one arg (initialDormant with default null) and returns an object with dormantLastEmitted getter plus setDormantLastEmitted setter plus a current getter. Add a second parameter named initialWakeTriggerTs with default null typed number-or-null. Add a closure-scoped let named wts initialized to initialWakeTriggerTs. Return two additional accessors on the object. wakeTriggerTs no-arg getter returning wts. setWakeTriggerTs setter taking number-or-null and assigning to wts. Also add a currentWts getter for test-side introspection (mirrors the existing current getter for dormantLastEmitted).

    STEP B. Update existing Tests G H I J invocations of __applyDormantPollWithRediscoveryForTests to pass the three new deps. markerCommand as a vitest fn resolving to null (never called on those paths because wakeTriggerTs is null which short-circuits to the natural-resume branch in the production code). now as an arrow returning zero (unused when wakeTriggerTs is null). Leave state factory calls as-is. The new second-arg default of null preserves natural-resume semantics for G H I J. Do NOT change the assertions in G H I J. They must all still pass with the natural-resume behavior preserved from patch #346.

    STEP C. Add Test L (marker present plus fresh, dismiss plus rediscover plus startActiveFlow). Use describe-it pattern matching Tests G through K. Setup. const wakeTs equals 1000000. const markerTs equals wakeTs plus 5000. const markerBody equals new Date(markerTs).toISOString(). const wsSend equals vi.fn(). const startActiveFlow equals vi.fn(). const exec equals vi.fn resolving to "no\n". const discoverSession equals vi.fn resolving to an object with status active and pid 999 and sessionFile "/x/y.jsonl". const markerCommand equals vi.fn resolving to markerBody. const state equals makeDormantState(true, wakeTs). Await the seam call with all deps wired (connSnapshot fakeConn, escapedName tiffany, execCommand exec, discoverSession, wsSend, startActiveFlow, markerCommand) and state. Pass now as an arrow returning wakeTs plus 6000. Assertions. markerCommand called once. wsSend called once. JSON.parse of the first wsSend call arg equals dormant false frame. discoverSession called once. startActiveFlow called with 999 and "/x/y.jsonl".

    STEP D. Add Test M (marker present plus STALE, keep waiting). Setup identical to Test L except staleMarkerTs equals wakeTs minus 5000 and markerBody uses staleMarkerTs. discoverSession is vi.fn (no resolver, must not be called). now returns wakeTs plus 1000. Assertions. markerCommand called once. wsSend NOT called. discoverSession NOT called. startActiveFlow NOT called. state.current remains true (dormantLastEmitted unchanged).

    STEP E. Add Test N (marker absent plus 90s elapsed, fallback dismiss). Setup. wakeTs equals 1000000. exec resolves to "no\n". discoverSession resolves to inactive not_claude object. markerCommand resolves to null. state equals makeDormantState(true, wakeTs). now returns wakeTs plus 91000. Assertions. markerCommand called once. wsSend called once with dormant false. discoverSession called once. startActiveFlow NOT called (still inactive).

    STEP F. Add Test O (marker absent plus within window, keep waiting). Setup. wakeTs equals 1000000. exec resolves to "no\n". discoverSession is vi.fn (must not be called). markerCommand resolves to null. state equals makeDormantState(true, wakeTs). now returns wakeTs plus 30000. Assertions. markerCommand called once. wsSend NOT called. discoverSession NOT called. startActiveFlow NOT called.

    STEP G. Run the fast target first. npx vitest run src/backend/claude-session/dormant-poll.test.ts. All 15 tests (A B C D E F G H I J K L M N O) must pass. Then run the full suite. npx vitest run. Baseline was 1585 pass / 6 skip. Expected new total 1589 pass / 6 skip / 0 fail. If any regression, fix Task 1 first before adding more tests.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx vitest run src/backend/claude-session/dormant-poll.test.ts 2>&1 | tail -15 && echo "---FULL SUITE---" && npx vitest run 2>&1 | tail -10</automated>
  </verify>
  <done>dormant-poll.test.ts shows 15 pass / 0 fail. Full suite shows 1589 pass / 6 skip / 0 fail (baseline 1585 plus 4 new). Regression Tests G H I J K continue to pass. New Tests L M N O all pass. If the full suite total differs by anything other than exactly +4 pass, investigate before proceeding to Task 3.</done>
</task>

<task type="auto">
  <name>Task 3: Ship. docker compose deploy under 15-min deadman plus HTTPS 200 health check plus append patch #347 (copy polish) plus patch #348 (marker consumption) to skynet-patches.md.</name>
  <files>/home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md</files>
  <action>
    STEP A. Verify build. cd /home/ubuntu/skynet && npx tsc --noEmit exits 0. npm run build exits 0. If either fails, stop and fix. Do NOT proceed to deploy on a broken build.

    STEP B. Commit the code changes as ONE atomic commit before deploy. Use commit message. feat(quick-260808-fgf-01) backend consume .resume-complete marker with freshness check plus 90s fallback plus tests L M N O. Include the two changed source files (claude-session-server.ts and dormant-poll.test.ts). This lands on top of 06bcb4d (the copy polish already committed) so both ride the same deploy.

    STEP C. Deploy under 15-min deadman per PROJECT constraint. cd /home/ubuntu/skynet && follow the standard ship dance from prior quick summaries (260808-dmz-SUMMARY.md is the reference). docker compose up -d --force-recreate skynet. Immediately arm the 15-min deadman rollback timer per Ashley 2026-07-03 constraint. Poll container health until healthy sustained. Curl HTTPS to https://term.gigaashley.click and confirm 200 response. If any of container-unhealthy, HTTPS non-200, or 15-min elapsed fires, roll back. If all three succeed, disarm the deadman.

    STEP D. After successful deploy, append TWO patch entries to /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md. Use the exact format of the existing patch #345 and patch #346 entries (H2 heading with patch number and title and bounty slug in brackets, followed by root-cause and changes sections and verification section with test counts and image sha and byte-verify note, followed by commits list and rebase-risk line).

    Patch #347 entry (small standalone). H2 title. Patch #347 DormancyOverlay copy polish sentence-case plus friendlier wording [ad-hoc]. One-paragraph body. Reference commit 06bcb4d. Note the four copy changes verbatim from the commit body (session is asleep to This session is asleep. waking ellipsis to Waking up ellipsis. wake failed dash err to Couldn't wake dash err. this can take up to 60s to This can take up to a minute period.). Note that aria-labels and the Wake button label are unchanged. Verification. Tests updated in DormancyOverlay.test.tsx and PrettyView.test.tsx already covered by the same commit. Rebase risk NIL.

    Patch #348 entry (marker consumption, full entry). H2 title. Patch #348 Skynet consumes .resume-complete supervisor-hands-off marker for DormancyOverlay dismissal [quick-260808-fgf]. Body sections. Root cause (verbatim from bounty premise. Patch #345 dismisses on first live Claude frame which fires DURING the supervisor Ctrl-C train plus bracketed-paste plus nudge Enter, leaving a typing-interleave window). Nelly's contract (the six bullets from the bounty timeline. path, contents, write, remove, freshness check, belt-and-suspenders). Backend changes (list Task 1 STEPS A through E in prose. wakeTriggerTs closure state. wake handler records on success. seam signature extended. sentinel-gone branch gated on markerFresh with freshness plus fallback plus dormancy_marker_fallback log). Test additions (L M N O described briefly). Rationale for preserving frontend live-frame auto-dismiss (strict-safety fallback, additive not replacement). Verification (tsc exit 0, npm run build exit 0, full npx vitest run 1589 pass 6 skip 0 fail baseline 1585 plus 4 new, image sha to be filled in from deploy output, container Up and healthy T+Ns, HTTPS 200 confirmed on term.gigaashley.click, byte-verify note for wakeTriggerTs and resume-complete tokens in the backend bundle). Commits list (the single commit from STEP B above). Rebase risk NIL.

    STEP E. Commit the docs update. docs(quick-260808-fgf) patch #347 copy polish plus patch #348 marker consumption entries in skynet-patches.md.

    STEP F. Optional. Write the SUMMARY. Per templates/summary.md, drop a SUMMARY.md alongside this PLAN.md in the same quick directory with the standard shape (what, why, how, verify, commits). This is expected for quick tasks by the orchestrator handoff.
  </action>
  <verify>
    <human-check>
      1. docker compose ps skynet shows Up and healthy sustained for at least 60 seconds.
      2. curl -s -o /dev/null -w "%{http_code}" https://term.gigaashley.click returns 200.
      3. /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md contains a Patch #347 heading and a Patch #348 heading (grep -c "^## Patch #34[78]" returns 2).
      4. git log --oneline -5 shows both the feat commit and the docs commit landed on top of 06bcb4d.
    </human-check>
    <automated>docker compose -f /home/ubuntu/skynet/docker-compose.yml ps skynet 2>&1 | tail -5 && echo "---HTTP---" && curl -s -o /dev/null -w "%{http_code}\n" https://term.gigaashley.click && echo "---PATCHES---" && grep -c "^## Patch #34[78]" /home/ubuntu/.claude/roles/box-maintainer/skynet-patches.md</automated>
  </verify>
  <done>Container Up healthy. HTTPS returns 200. Patches file has both #347 and #348 headings. Feat commit plus docs commit both present on branch on top of 06bcb4d. 15-min deadman disarmed cleanly (no rollback fired). Ashley UAT pending per usual quick-task handoff.</done>
</task>

</tasks>

<verification>
Phase-level checks summarizing what must be true at end of plan.

- Backend claude-session-server.ts contains a wakeTriggerTs closure variable set in the wake handler on rm-f success and cleared inside startActiveFlow.
- Backend claude-session-server.ts contains a MARKER_FALLBACK_MS constant (value 90000) used in the seam's sentinel-gone branch.
- Backend claude-session-server.ts wires a markerCommand SSH exec (cat ~/.claude/identities/'NAME'/.resume-complete) into the dormant-poll IIFE.
- The __applyDormantPollWithRediscoveryForTests seam gates dismiss-plus-rediscover on (a) natural-resume path with wakeTriggerTs null OR (b) markerFresh via marker_ts > wake_trigger_ts OR (c) 90s fallback window elapsed with dormancy_marker_fallback log entry.
- Frontend PrettyView.tsx is unchanged. Live-frame auto-dismiss (patch #345) preserved as strict-safety fallback.
- dormant-poll.test.ts contains Tests L M N O plus preserved G H I J K. Full suite runs 1589 pass / 6 skip / 0 fail.
- docker compose deploy completes under 15-min deadman with container healthy plus HTTPS 200.
- skynet-patches.md contains patch #347 (copy polish 06bcb4d, standalone entry) plus patch #348 (marker consumption, full entry matching #346 format).
</verification>

<success_criteria>
Objective is achieved when.

- Full npx vitest run reports 1589 pass / 6 skip / 0 fail (baseline 1585 plus 4 new marker tests).
- npx tsc --noEmit exits 0. npm run build exits 0.
- Container skynet is Up and healthy on the box after docker compose up -d --force-recreate skynet. HTTPS 200 on term.gigaashley.click sustained.
- 15-min deadman timer disarmed cleanly (no rollback fired).
- skynet-patches.md updated with both patch #347 and #348 entries.
- Ashley can UAT. Open Tiffany's PWA pane while dormant. Click Wake. Overlay stays up through the entire ~10s Ctrl-C train (Nelly reduced from 20s per her concern-1 ship) plus bracketed-paste plus final Enter. Overlay dismisses ONLY after Nelly's marker appears with a fresh ISO-UTC ts (or after 90s fallback if the target box is running the pre-marker supervisor). Typing during the wait window is safe (no interleave with supervisor paste).
</success_criteria>

<output>
Create /home/ubuntu/skynet/.planning/quick/260808-fgf-skynet-consumes-resume-complete-marker-t/260808-fgf-SUMMARY.md when done, following /home/ubuntu/.claude/get-shit-done/templates/summary.md shape (what, why, how, verify, commits, rebase-risk).
</output>
