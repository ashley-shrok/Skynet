---
phase: quick-260829-kmr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
autonomous: true
requirements:
  - quick-260829-kmr-fix-cross-identity-background-tasks-leak

must_haves:
  truths:
    - "Source A reads per-session `~/.claude/fleet-status/stop-<sessionId>.json` before falling back to the box-wide `~/.claude/fleet-status/last-stop-payload.json`."
    - "Per-session read is guarded by the same `/^[a-zA-Z0-9_-]+$/` regex Phase 61 uses at L1089; a sessionId that fails the regex causes the per-session cat to be SKIPPED entirely (no exec)."
    - "Per-session read uses `shellSingleQuote` (already imported) — no new quoting helper introduced."
    - "When the per-session read returns null or empty stdout, source A falls back to the box-wide read (backward compat for sessions that have not fired Stop since Phase 61 hook re-install)."
    - "`emitHookPayloadWarn` fires only when BOTH the per-session AND the box-wide reads are null/empty (widened 'absent' semantic; existing rate-limit debounce contract preserved)."
    - "Cross-identity leak eliminated: identity A's WIP indicator no longer lights up with identity B's non-ambient background_tasks because source A now reads a session-scoped payload."
    - "Backend-only change: no frontend files touched, no wire-schema changes."
    - "Targeted test suite `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` is green."
  artifacts:
    - path: "src/backend/fleet-status/ssh-poll-orchestrator.ts"
      provides: "Per-session hook-payload read inserted into source A's Promise.all pipeline with box-wide fallback"
      contains: "fleet-status/stop-"
    - path: "src/backend/fleet-status/ssh-poll-orchestrator.test.ts"
      provides: "Four new tests (A/B/C/D) covering per-session-wins, fallback, both-missing warn, and regex-guard skip"
      contains: "Quick 260829-kmr"
  key_links:
    - from: "src/backend/fleet-status/ssh-poll-orchestrator.ts (source A per-PID pipeline @ ~L1005-1019)"
      to: "per-session `cat ~/.claude/fleet-status/stop-<sanitized-sid>.json`"
      via: "Promise.all — new exec added alongside sessionJsonPromise/statPromise/hookPayloadPromise"
      pattern: "cat ~/\\.claude/fleet-status/stop-"
    - from: "source A hookPayload consumer @ ~L1335-1351"
      to: "widened 'absent' semantic (both per-session AND box-wide null/empty)"
      via: "compose selected payload from per-session-preferred, box-wide-fallback; drive both `isHookPayloadMissing` and `parseStopHookPayload` off the selected payload"
      pattern: "emitHookPayloadWarn"
---

<objective>
Fix the cross-identity background_tasks leak in source A of the fleet-status SSH poll orchestrator: identity A's WIP indicator currently lights up with identity B's non-ambient background_tasks because source A reads the box-wide `~/.claude/fleet-status/last-stop-payload.json` file (shared across all Claude sessions on the box) instead of the per-session `~/.claude/fleet-status/stop-<sessionId>.json` file that Phase 61's Stop hook already writes.

Fix: read per-session first, fall back to box-wide when the per-session file does not exist (backward compat for sessions that have not fired Stop since Phase 61 hook re-install). Use the SAME regex `/^[a-zA-Z0-9_-]+$/` and `shellSingleQuote` pattern Phase 61's mtime stat uses at L1082-1103 — mirror it exactly for the read side.

Purpose: eliminate WIP-indicator false positives across identities on the same box. The ambient filter itself is correct (`description.startsWith('[ambient]')`); the bug is upstream in what payload we read.

Output: surgical two-file change (source + test) with green targeted tests. Executor stops at commit — orchestrator handles ship motion (docker build, HTTPS verify, git push, patch entry) and batches this with patches #521/#522.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# Target file — Phase 61 fix-pattern lives at L1082-1103, mirror it for the read side.
@src/backend/fleet-status/ssh-poll-orchestrator.ts

# Test harness shape — MockSshChannel iterates responses in insertion order and matches
# by `.includes()`. Phase 59 test region at L5198+ shows the exact pattern to mirror
# (per-session pattern registered BEFORE box-wide pattern; distinct describe block;
# `buildPhase59Deps` / `wirePhase59Base` helpers).
@src/backend/fleet-status/ssh-poll-orchestrator.test.ts

# Ambient filter — read-only confirmation that the filter is correct.
@src/backend/fleet-status/ambient-filter.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Backend fix — per-session read with box-wide fallback in source A</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.ts</files>
  <action>
Insert a per-session `cat ~/.claude/fleet-status/stop-<sanitized-sid>.json` read into source A's per-PID pipeline and consume it in preference to the box-wide payload. Preserve the existing box-wide cat as a fallback.

STEP 1 — Preserve the existing box-wide `hookPayloadPromise` at L1009 unchanged (it fires alongside the session-JSON and stat execs). The `hookPayloadRaw` value returned from Promise.all is renamed conceptually to "box-wide raw" but the variable can keep its name.

STEP 2 — After the Phase 61 mtime stat block completes (immediately after L1106, before the "Phase 59 Plan 02 — server-side status-delta tracking" comment at L1108), insert a new block that reads the per-session PAYLOAD (this is a separate exec from Phase 61's mtime `stat -c %Y`; do NOT combine them per Locked scope #5). Structure:

  a. Declare `let perSessionHookPayloadRaw: string | null = null;`.
  b. Reuse the SAME regex guard used by the Phase 61 mtime stat: `if (/^[a-zA-Z0-9_-]+$/.test(sessionJson.sessionId)) { ... }`. Do NOT introduce a new regex. If the sessionId fails the guard, `perSessionHookPayloadRaw` stays null and control falls through to the box-wide branch downstream — mirrors the Phase 61 stat's fail-open-on-skip at L1104-1106.
  c. Inside the guard, call `shellSingleQuote(sessionJson.sessionId)` to produce `quotedSessionId` (reuse the local from the Phase 61 block if still in scope; otherwise recompute — cheap). Then `perSessionHookPayloadRaw = await channel.exec(\`cat ~/.claude/fleet-status/stop-${quotedSessionId}.json 2>/dev/null || true\`);`.
  d. This adds ONE extra SSH exec per PID per tick (allowed per Locked scope #5; matches the Pattern-A rationale at L1058-1062).

STEP 3 — At the hook-payload consumer block (L1335-1351), rewrite the "select payload" step:
  a. Introduce a local `selectedHookPayloadRaw: string | null` that prefers per-session when it is non-null and non-empty-after-trim, else falls back to the box-wide `hookPayloadRaw`.
     Exact selection logic (spelled out to remove ambiguity):
       `const perSessionUsable = perSessionHookPayloadRaw !== null && perSessionHookPayloadRaw.trim() !== "";`
       `const selectedHookPayloadRaw = perSessionUsable ? perSessionHookPayloadRaw : hookPayloadRaw;`
  b. Recompute `isHookPayloadMissing` off `selectedHookPayloadRaw` (same predicate: `=== null || trim === ""`). This widens "absent" to mean BOTH files are absent per Locked scope #4.
  c. Feed `selectedHookPayloadRaw!` (non-null-asserted inside the else branch as before) into `parseStopHookPayload(...)`.
  d. `emitHookPayloadWarn` continues to fire ONLY when `isHookPayloadMissing` is true (now driven by BOTH sources) OR when `parseStopHookPayload` returns null on the selected payload. Same debounce contract — no change to `emitHookPayloadWarn` itself or its cooldown.

STEP 4 — Add a patch-comment banner ABOVE the new per-session read block using the file's existing style:
  `// Quick 260829-kmr: per-session Stop-hook PAYLOAD read (separate from Phase 61's mtime`
  `//   stat above). Mirrors Phase 61's regex + shellSingleQuote pattern so an illegal`
  `//   sessionId cannot path-traverse a foreign identity's payload. On null/empty here`
  `//   the consumer below falls back to the box-wide `hookPayloadRaw` for backward compat`
  `//   with sessions that have not fired Stop since the Phase 61 hook re-install.`
  `//   THIS FIXES the cross-identity background_tasks leak — the box-wide file is shared`
  `//   across all Claude sessions on the box, so identity A previously saw identity B's`
  `//   non-ambient tasks in its WIP indicator. Per-session file is session-scoped.`

STEP 5 — Add a shorter `// Fix (quick-260829-kmr):` comment above the rewritten selection at L1335 explaining the "per-session preferred, box-wide fallback, both-missing → warn once" contract.

STEP 6 — Do NOT touch: `emitHookPayloadWarn` itself, the Phase 61 stat block (L1082-1103), source B, the Promise.all shape for the existing 3 execs, the fingerprint composition, `computeFingerprint`, any wire-schema field. If a change looks tempting outside these steps, STOP — it is out of scope (see Locked scope #7).

CONSTRAINTS enforced from the planning context:
- Locked scope #1: swap the READ path only (not the wire-schema, not the write path).
- Locked scope #2: reuse Phase 61's regex + shellSingleQuote verbatim. NO new regex.
- Locked scope #3: fallback preserves backward compat.
- Locked scope #4: both-missing warn semantics.
- Locked scope #5: separate cat from Phase 61's stat — one extra exec per PID per tick is fine.
- Locked scope #6: preserve the existing Promise.all shape for the original 3 execs; the new cat can be added alongside them in the Promise.all OR fired sequentially after the Phase 61 stat block (either is acceptable — sequential is simpler and keeps the diff smaller; the Phase 61 stat block is already sequential so this matches the surrounding style).
- Locked scope #7: no cleanup of Phase 61 axis derivation, no source B changes, no exec-pattern refactoring.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "ssh-poll-orchestrator\.ts" ; test $? -eq 1 &amp;&amp; echo "OK: no ssh-poll-orchestrator.ts type errors"</automated>
    <automated>grep -n "Quick 260829-kmr\|Fix (quick-260829-kmr)" /home/ubuntu/skynet-tina/src/backend/fleet-status/ssh-poll-orchestrator.ts | grep -v '^#' | wc -l | awk '$1 >= 2 { print "OK: patch-comment banners present"; exit 0 } { print "FAIL: expected >=2 patch-comment banners"; exit 1 }'</automated>
    <automated>grep -c "cat ~/.claude/fleet-status/stop-" /home/ubuntu/skynet-tina/src/backend/fleet-status/ssh-poll-orchestrator.ts | awk '$1 >= 1 { print "OK: per-session cat exec present"; exit 0 } { print "FAIL: per-session cat not found"; exit 1 }'</automated>
  </verify>
  <done>
    - `src/backend/fleet-status/ssh-poll-orchestrator.ts` compiles cleanly (no tsc errors on this file).
    - Per-session `cat ~/.claude/fleet-status/stop-<quoted-sid>.json` exec inserted in source A, gated by `/^[a-zA-Z0-9_-]+$/` and using `shellSingleQuote`.
    - Box-wide `hookPayloadPromise` at L1009 is UNCHANGED (backward compat preserved).
    - Consumer at L1335-1351 rewritten to prefer per-session, fall back to box-wide, and fire `emitHookPayloadWarn` only when both sources are missing.
    - Patch-comment banners identify the fix as `Quick 260829-kmr` in at least two places.
    - Source B untouched (grep for the fix marker in source-B blocks returns zero).
  </done>
</task>

<task type="auto">
  <name>Task 2: Add 4 targeted tests for the per-session-first / fallback / warn / regex-guard contract</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.test.ts</files>
  <action>
Add a new `describe` block at the END of the file (after the Phase 59 tests that end at ~L5566). Reuse the existing test harness — `MockSshChannel`, `MockRegistry`, `makeSessionJson`, `makeValidPayload`, and follow the shape of `wirePhase59Base` / `buildPhase59Deps` at L5218-5273 (which already handle setInterval capture + per-tick advancement).

CRITICAL — pattern collision avoidance in MockSshChannel:
MockSshChannel iterates registered patterns in INSERTION ORDER and matches by `.includes()`. The Phase 61 stat command shape is:
   `stat -c %Y ~/.claude/fleet-status/stop-'test-session-id'.json 2>/dev/null || true`
The new fix's cat command shape is:
   `cat ~/.claude/fleet-status/stop-'test-session-id'.json 2>/dev/null || true`
Both contain the substring `fleet-status/stop-`. Using `"fleet-status/stop-"` as the pattern would match BOTH commands and give the WRONG response to one of them.

Register these two patterns as DISTINCT strings, in this order (per-session cat BEFORE the Phase 59 stat pattern, and BEFORE the box-wide cat pattern):
  1. `"cat ~/.claude/fleet-status/stop-"` → per-session PAYLOAD (this fix's read)
  2. `"stat -c %Y ~/.claude/fleet-status/stop-"` → per-session MTIME (Phase 61)
  3. `"cat ~/.claude/fleet-status/last-stop-payload.json"` → box-wide payload

Pattern (1) does NOT contain "stat -c %Y" so no collision with (2). Pattern (1) does NOT contain "last-stop-payload.json" so no collision with (3). Pattern (2) does NOT contain "cat " so no collision with (1). Order matters ONLY within the responses map, but disjoint substrings mean the order is defensive rather than load-bearing here.

Create a helper `wireQuick260829Base(channel, sessionJsonOverride?)` (mirror `wirePhase59Base` but register the three payload-related patterns from the list above) and reuse `buildPhase59Deps` (it is already generic — takes a channel and clock — but it lives in the Phase 59 describe scope; either promote it to file scope, or duplicate the tiny function locally in the new describe block. Duplicating is fine — 20 lines — and avoids touching the Phase 59 tests).

Emit exactly FOUR tests:

TEST A — per-session PAYLOAD wins over box-wide when present:
  - Register per-session pattern → a JSON payload containing background_tasks with ONE non-ambient task, `description: "identity-A task"`.
  - Register box-wide pattern → a DIFFERENT JSON payload with a non-ambient task `description: "identity-B task"` (this is the poisoned box-wide file simulating another identity's payload).
  - Register the Phase 61 stat pattern → `""` (no per-session mtime — the mtime axis is not what this test cares about).
  - Start orchestrator, assert `publishedStates[0].state.backgroundTasks` contains ONE task with description "identity-A task", DOES NOT contain "identity-B task". This is the load-bearing proof that per-session wins.

TEST B — per-session file empty → falls back to box-wide payload:
  - Per-session pattern → `""` (empty stdout — file absent).
  - Box-wide pattern → JSON payload with a non-ambient task description "box-wide fallback task".
  - Start orchestrator, assert `publishedStates[0].state.backgroundTasks` contains ONE task with description "box-wide fallback task". Proves backward compat.

TEST C — BOTH sources empty → `backgroundTasks: []` AND ONE `emitHookPayloadWarn`:
  - Per-session pattern → `""`.
  - Box-wide pattern → `""`.
  - Phase 61 stat pattern → `""`.
  - Start orchestrator, assert `publishedStates[0].state.backgroundTasks` is `[]`.
  - Assert `systemLogger.warn` was called EXACTLY ONCE with `operation === "fleet_status_hook_payload_missing"` (proves the widened-absent semantic AND the debounce contract are preserved).
  - Use the same warn-count filter shape used at L361-368 / L399-405 in Test 5 (do not invent a new assertion helper).

TEST D — sessionId with path-traversal characters fails the regex guard → per-session cat is SKIPPED entirely (no exec fired for it), and the consumer falls back to box-wide immediately:
  - Override `makeSessionJson({ sessionId: "../evil" })`.
  - Register the per-session cat pattern with a value that should NEVER be observed (e.g. `"POISON — must not be read"`).
  - Register box-wide pattern → JSON payload with a non-ambient task description "regex-guarded fallback".
  - Register a `ls -1 ~/.claude/sessions/` response referencing the SAME PID 12345 so the session-JSON path still resolves (the file name doesn't include the sessionId; the sessionId comes from inside the JSON).
  - Register `cat ~/.claude/sessions/12345.json` to return the overridden sessionJson.
  - Start orchestrator, assert:
    (a) `deps.channel.getCalls()` does NOT contain any command matching regex `/cat .*fleet-status\/stop-/` (i.e. no per-session cat was fired — the regex guard skipped it entirely, matching Phase 61's stat behavior for the same case at L1109);
    (b) `publishedStates[0].state.backgroundTasks` contains the "regex-guarded fallback" task (proves box-wide was consulted directly).
  - Notes: MockSshChannel logs every `.exec` call in `callLog`, so `channel.getCalls().some(c => /cat .*fleet-status\/stop-/.test(c.command))` is the guard assertion. Do NOT check the responses map — check the call log (observable behavior only).

Place the describe block at the very end of the file with the title:
  `describe("quick-260829-kmr — cross-identity background_tasks leak: per-session hook-payload read + fallback", () => { ... })`

STYLE: match the surrounding tests — `beforeEach(vi.clearAllMocks)`, single-line `it()` names identifying the test letter (A/B/C/D), block-comment above each `it` explaining the load-bearing invariant (mirror Phase 59 Test P57-02-B's style at L5303-5329).

DO NOT change any existing test. DO NOT edit `wirePhase59Base`, `buildPhase59Deps`, or the Phase 52/59 describe blocks. Add only.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; grep -c "quick-260829-kmr" src/backend/fleet-status/ssh-poll-orchestrator.test.ts | awk '$1 >= 4 { print "OK: quick-260829-kmr marker appears in >=4 places (describe + comments)"; exit 0 } { print "FAIL: expected >=4 marker occurrences"; exit 1 }'</automated>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts 2>&amp;1 | tail -40</automated>
  </verify>
  <done>
    - Four new tests (A/B/C/D) are added inside a new `describe("quick-260829-kmr — ...")` block at the end of the file.
    - `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` reports 0 failed tests and includes the four new tests in the pass count.
    - Existing Phase 41/44/47/52/53/55/59 test suites are untouched and still green (their counts are unchanged in the vitest output).
    - Test C's warn assertion matches exactly ONE call — proving the widened-absent semantic + debounce.
    - Test D's assertion checks the `channel.getCalls()` call log for the ABSENCE of a per-session cat command, proving the regex-guard skip semantic.
  </done>
</task>

<task type="auto">
  <name>Task 3: Full targeted-suite verification, backend-only guard, and single commit</name>
  <files>(no file changes — verification + git commit only)</files>
  <action>
STEP 1 — Run the full targeted test file and confirm 0 failures. Capture the final pass/fail line for the commit body:
   `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts`
If ANY test fails, STOP and diagnose (do not proceed to commit).

STEP 2 — Backend-only guard: confirm no frontend files were modified. Run:
   `git diff --name-only HEAD` — must ONLY list `src/backend/fleet-status/ssh-poll-orchestrator.ts` and `src/backend/fleet-status/ssh-poll-orchestrator.test.ts`. If ANY path outside `src/backend/` appears, STOP.

STEP 3 — Regression sanity: confirm the box-wide read (`hookPayloadPromise` @ L1009) is still present and NOT removed. Run:
   `grep -c "hookPayloadPath" src/backend/fleet-status/ssh-poll-orchestrator.ts` — must return >= 3 (declaration, box-wide exec, plus the fallback consumer reference).

STEP 4 — Commit as a single atomic commit. Do NOT push (Ashley's fleet rule: full-suite green is a precondition for PUSH not COMMIT; orchestrator batches this ship with patch #521 + #522 and runs full-suite at ship time). Commit message via HEREDOC:

   `git commit -m "$(cat <<'EOF'`
   `fix(quick-260829-kmr): source A reads per-session Stop payload, not box-wide`

   `Source A's hookPayload read went through the box-wide`
   `~/.claude/fleet-status/last-stop-payload.json file, which is shared across`
   `every Claude session on the box. Result: identity A's WIP indicator lit up`
   `with identity B's non-ambient background_tasks whenever B was the most`
   `recent Stop-hook writer.`

   `Switch source A to read the per-session ~/.claude/fleet-status/stop-<sid>.json`
   `file already written by Phase 61's Stop hook. Fall back to the box-wide file`
   `when the per-session read is null/empty (backward compat for sessions that`
   `have not fired Stop since the Phase 61 hook re-install). emitHookPayloadWarn`
   `fires only when both files are absent; debounce contract preserved.`

   `Guard: reuse Phase 61's regex `/^[a-zA-Z0-9_-]+$/` + shellSingleQuote for the`
   `sessionId interpolation to block path-traversal reads of foreign identities'`
   `payloads. sessionId failing the regex → per-session cat is skipped entirely,`
   `matching Phase 61's stat behavior at ssh-poll-orchestrator.ts:1109.`

   `Tests: 4 new tests in ssh-poll-orchestrator.test.ts cover per-session-wins,`
   `box-wide fallback, both-missing warn semantics, and regex-guard skip.`
   `Targeted suite green: 0 failed.`

   `Non-goals per plan: stat+cat combining (Locked scope #5), Phase 61 axis`
   `cleanup (Bug 1b, separate bounty), source B changes.`
   `EOF`
   `)"`

STEP 5 — After commit, run `git log --oneline -1` and `git status` and paste them into the executor summary so the orchestrator can pick the commit up cleanly for the ship batch.

DO NOT push. DO NOT run `docker compose`. DO NOT run the full test suite (fleet rule updated 2026-08-29 — targeted-pass is the commit gate; full-suite is the push gate and lives with the orchestrator). DO NOT edit `skynet-patches.md` (orchestrator handles patch entries).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts 2>&amp;1 | tail -5 | grep -E "Test Files.*passed|failed" | grep -v "failed" &amp;&amp; echo "OK: vitest green"</automated>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; git log --oneline -1 | grep -c "quick-260829-kmr" | awk '$1 == 1 { print "OK: commit landed with quick-260829-kmr marker"; exit 0 } { print "FAIL: commit not found or marker missing"; exit 1 }'</automated>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; git status --porcelain | wc -l | awk '$1 == 0 { print "OK: working tree clean post-commit"; exit 0 } { print "FAIL: dirty working tree"; exit 1 }'</automated>
    <automated>cd /home/ubuntu/skynet-tina &amp;&amp; git show --name-only HEAD | grep -E "^src/" | grep -vE "^src/backend/" | wc -l | awk '$1 == 0 { print "OK: backend-only commit"; exit 0 } { print "FAIL: non-backend files in commit"; exit 1 }'</automated>
  </verify>
  <done>
    - `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` reports 0 failed.
    - Working tree is clean post-commit (`git status --porcelain` returns nothing).
    - `git log -1` shows a single new commit with subject prefix `fix(quick-260829-kmr):` and body describing the per-session read swap + fallback + regex guard.
    - `git show --name-only HEAD` lists ONLY `src/backend/fleet-status/ssh-poll-orchestrator.ts` and `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — no other files.
    - Executor summary paste-in of `git log --oneline -1` + `git status` is included in the returned SUMMARY.md.
    - NO push, NO docker, NO full-suite run, NO patch-entry edit (orchestrator handles ship motion + patch #520-ish sequence).
  </done>
</task>

</tasks>

<verification>
  Phase-level checks (executor confirms all before returning):
  - `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` → all green, 4 new tests included in the pass count.
  - `git log --oneline -1` → single commit, `fix(quick-260829-kmr):` subject.
  - `git show --name-only HEAD` → only the two backend files.
  - `grep -n "Quick 260829-kmr\|Fix (quick-260829-kmr)" src/backend/fleet-status/ssh-poll-orchestrator.ts` → at least two patch-comment banners identifying the fix.
  - Source B code path (`pollDormantOnlyIdentities`, source B recycling stat, source B fingerprint) is untouched: `git diff HEAD~1 HEAD -- src/backend/fleet-status/ssh-poll-orchestrator.ts | grep -c "pollDormantOnly\|source B"` → 0.
</verification>

<success_criteria>
  - Source A's per-PID pipeline reads the per-session Stop payload FIRST, with box-wide fallback and both-missing warn semantics preserved.
  - Path-traversal sessionIds cannot cause the orchestrator to cat a foreign identity's payload file (regex guard + shellSingleQuote enforced).
  - Targeted test suite is green with 4 new tests that observably prove: (A) per-session wins over box-wide, (B) fallback to box-wide when per-session absent, (C) both-missing fires exactly one warn, (D) regex-guard skips per-session cat entirely for illegal sessionIds.
  - Commit is a single, atomic backend-only patch with the `quick-260829-kmr` marker in the subject.
  - Nothing outside `src/backend/fleet-status/` was touched; no push, no docker, no ship motion (orchestrator scope).
</success_criteria>

<output>
Create `.planning/quick/260829-kmr-fix-cross-identity-background-tasks-leak/260829-kmr-SUMMARY.md` when done. SUMMARY.md must include:
- The commit hash + one-line subject from `git log --oneline -1`.
- The vitest tail lines showing 0 failures + the four new test names.
- A one-line handoff note: "Ready for orchestrator ship-batch with patches #521 (search box) + #522 (dormant Send). Full-suite run is orchestrator responsibility."
- Any deviations from the plan (there should be none — if there are, explain in one line).
</output>
