---
phase: quick-260910-ioi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/relay-registry-backfill.ts
  - src/backend/database/routes/relay-registry-backfill.test.ts
  - src/backend/relay-sessions/registry-rooms-backfill.ts
  - src/backend/relay-sessions/registry-rooms-backfill.test.ts
  - src/backend/relay-sessions/enumerate-agent-mxids.ts
  - src/backend/relay-sessions/enumerate-agent-mxids.test.ts
  - src/backend/database/database.ts
  - src/backend/relay-sessions/observation-loop-starter.ts
  - src/backend/relay-sessions/observation-loop-starter.test.ts
  - src/backend/database/routes/users.ts
  - src/backend/database/routes/identity-birth-orchestrator.ts
autonomous: true
requirements: [IOI-DEL-BACKFILL]

must_haves:
  truths:
    - "POST /relay-room/backfill endpoint no longer exists (route file deleted, no mount in database.ts)"
    - "runRegistryRoomsBackfill utility no longer exists in the tree"
    - "enumerateAgentMxids utility no longer exists in the tree (was orphan)"
    - "D-11 mint hooks (joinAgentToAgentsRegistry, joinHumanToHumansRegistry) still fire on new-account create — untouched"
    - "observation-loop-starter boot sequence unchanged: ensureRegistryRoomsExist → enumerate users → loop.start"
    - "TypeScript compiles clean (npx tsc --noEmit)"
    - "relay-sessions vitest suite green after deletions"
  artifacts:
    - path: "src/backend/relay-sessions/registry-rooms.ts"
      provides: "D-11 mint hooks — MUST remain untouched"
      contains: "joinAgentToAgentsRegistry"
  key_links:
    - from: "src/backend/database/database.ts"
      to: "(nothing — relay-registry-backfill removed)"
      via: "import + app.use mount lines deleted at lines 84 and 1964-1969"
      pattern: "relay-registry-backfill"
    - from: "src/backend/relay-sessions/observation-loop-starter.ts"
      to: "./registry-rooms.js only (NOT ./registry-rooms-backfill.js)"
      via: "import block simplified; docblock rewritten"
      pattern: "registry-rooms-backfill"
---

<objective>
Delete the /relay-room/backfill HTTP endpoint, its `runRegistryRoomsBackfill`
utility, and the fully-orphan `enumerate-agent-mxids` helper. Post-deletion,
backfill of pre-existing users/agents into registry rooms is entirely manual
(SSH-based dance, only if ever needed) per Alice's clarification. The D-11
mint hooks in `registry-rooms.ts` stay intact so new accounts continue to
auto-join the agents/humans registry rooms on create.

Purpose: Remove dead-and-brittle in-process backfill code + its docblock/
runbook noise from active source files. The utility was already MANUAL per
instance-deployer (never called from boot); this cleanup finishes the job
by removing the utility surface entirely.

Output: 6 files deleted, 5 files edited (imports/mounts/docblocks pruned),
git tree passes the three verification gates (grep-zero, tsc, vitest).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/backend/database/database.ts
@src/backend/relay-sessions/observation-loop-starter.ts
@src/backend/relay-sessions/observation-loop-starter.test.ts
@src/backend/database/routes/users.ts
@src/backend/database/routes/identity-birth-orchestrator.ts
@src/backend/relay-sessions/registry-rooms.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Delete backfill route + utility + orphan enumerator (6 files) and commit the pure-deletion</name>
  <files>
    src/backend/database/routes/relay-registry-backfill.ts,
    src/backend/database/routes/relay-registry-backfill.test.ts,
    src/backend/relay-sessions/registry-rooms-backfill.ts,
    src/backend/relay-sessions/registry-rooms-backfill.test.ts,
    src/backend/relay-sessions/enumerate-agent-mxids.ts,
    src/backend/relay-sessions/enumerate-agent-mxids.test.ts
  </files>
  <action>
    Delete these six files exactly:
      1. src/backend/database/routes/relay-registry-backfill.ts (HTTP route file for POST /relay-room/backfill)
      2. src/backend/database/routes/relay-registry-backfill.test.ts (route test)
      3. src/backend/relay-sessions/registry-rooms-backfill.ts (runRegistryRoomsBackfill utility)
      4. src/backend/relay-sessions/registry-rooms-backfill.test.ts (utility test)
      5. src/backend/relay-sessions/enumerate-agent-mxids.ts (zero-caller orphan helper)
      6. src/backend/relay-sessions/enumerate-agent-mxids.test.ts (orphan helper test)

    Use `git rm` (not raw `rm`) so the deletions are staged and the commit is
    reviewable as a clean "deletions only" diff.

    DO NOT touch src/backend/relay-sessions/registry-rooms.ts (base module —
    still exports the D-11 mint hooks joinAgentToAgentsRegistry,
    joinHumanToHumansRegistry, ensureRegistryRoomsExist, getAgentsRegistryRoomId,
    getHumansRegistryRoomId used by observation-loop-starter, users.ts,
    identity-birth-orchestrator).

    DO NOT use `git stash` at any point (has caused sibling-worktree
    contamination in this arc). If you need a baseline for any file use
    `git show HEAD:<file>`.

    After deletion, commit the code-only deletion:
      git commit -m "chore(quick-260910-ioi): delete /relay-room/backfill endpoint + runRegistryRoomsBackfill utility + orphan enumerate-agent-mxids"

    DO NOT bundle .planning/ docs into this commit — code files only.

    Note: after this task the tree will NOT compile (dangling import/mount in
    database.ts + dangling mock/refs in observation-loop-starter*). Task 2
    fixes those. That is the intended intermediate state.
  </action>
  <verify>
    <automated>
      # 1. All six files are gone from the working tree.
      test ! -e src/backend/database/routes/relay-registry-backfill.ts \
        && test ! -e src/backend/database/routes/relay-registry-backfill.test.ts \
        && test ! -e src/backend/relay-sessions/registry-rooms-backfill.ts \
        && test ! -e src/backend/relay-sessions/registry-rooms-backfill.test.ts \
        && test ! -e src/backend/relay-sessions/enumerate-agent-mxids.ts \
        && test ! -e src/backend/relay-sessions/enumerate-agent-mxids.test.ts \
        && echo OK_DELETED

      # 2. base module still present + still exports D-11 mint hooks (regression guard).
      grep -c "export.*joinAgentToAgentsRegistry\|export.*joinHumanToHumansRegistry" \
        src/backend/relay-sessions/registry-rooms.ts

      # 3. The deletion commit exists at HEAD and touches ONLY src/ files (no .planning/).
      git show --stat HEAD | grep -v "^ .planning/" | grep -q "6 files changed" \
        || git log -1 --name-only --pretty=format:"" | grep -v "^\.planning/" | wc -l
    </automated>
  </verify>
  <done>
    All six target files removed from the working tree AND staged/committed via
    `git rm`. registry-rooms.ts still contains the D-11 mint-hook exports.
    HEAD commit message begins `chore(quick-260910-ioi):` and touches only
    src/ paths. Tree is expected to fail `tsc` at this point — Task 2 fixes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Prune dangling refs (imports, mounts, mocks, docblocks) + run three verification gates + commit</name>
  <files>
    src/backend/database/database.ts,
    src/backend/relay-sessions/observation-loop-starter.ts,
    src/backend/relay-sessions/observation-loop-starter.test.ts,
    src/backend/database/routes/users.ts,
    src/backend/database/routes/identity-birth-orchestrator.ts
  </files>
  <action>
    Edit each file per the spec below. All line numbers are current-HEAD as
    of planning; re-locate by content string if the file has drifted.

    ── src/backend/database/database.ts ──────────────────────────────────
    (a) Delete line 84:
          import relayRegistryBackfillRoutes from "./routes/relay-registry-backfill.js";
    (b) Delete lines ~1964-1969 (the entire mount block + its five-line comment):
          // Admin one-shot: POST /relay-room/backfill — runs runRegistryRoomsBackfill
          // inside the live backend (necessary because Skynet's :memory: SQLite means
          // docker-exec-node opens a fresh empty DB). See routes/relay-registry-backfill.ts
          // docblock + bounty registry-rooms-backfill-runbook-broken-in-memory-db.
          // Piggybacks on the /relay-room/ nginx block above — no new location required.
          app.use("/relay-room", relayRegistryBackfillRoutes);
        Keep the surrounding `app.use("/relay-room", relayRoomParticipantsRoutes);`
        line (above) and the `app.use("/user-preferences", ...)` line (below)
        exactly as-is.

    ── src/backend/relay-sessions/observation-loop-starter.ts ────────────
    Simplify the docblock (lines ~23-40 and the sub-comment at ~63-68). Replace
    the entire "## D-12 backfill is MANUAL per instance-deployer" section
    (currently ~lines 23-40) with a shorter block that reflects the new reality:

      ## Backfill is fully manual (SSH-based dance if ever needed)

      Per Alice 2026-09-10: there is no in-process backfill path. If pre-
      existing users/agents ever need to be added to the registry rooms, the
      instance-deployer does it manually via SSH — no HTTP endpoint, no
      importable utility. The D-11 mint hooks (registry-rooms.ts) cover ALL
      new accounts from create onward. Between deploy and any manual
      backfill, pre-existing accounts are NOT in the registry rooms and the
      classifier's D-09 fallthrough conservatively materializes their
      two-party DMs.

    Then delete the ~6-line sub-comment at lines ~63-68 that references
    `./registry-rooms-backfill.js` and "SUMMARY.md § Manual backfill runbook"
    — that import is no longer here and the utility no longer exists.

    Keep the imports for `ensureRegistryRoomsExist` and `getAgentsRegistryRoomId`
    from `./registry-rooms.js` exactly as-is.

    ── src/backend/relay-sessions/observation-loop-starter.test.ts ───────
    IMPORTANT: read the current file first (only Test 1 mentions
    runRegistryRoomsBackfill in the assertion phase — Tests 2 and 3 also use
    the mock in their default setup + `.not.toHaveBeenCalled()` assertions).
    Do the following surgical edits:

    (a) DELETE the hoisted mock handle `mockRunRegistryRoomsBackfill` from
        the `vi.hoisted(() => ({...}))` block (line ~49) and from the
        destructuring at lines ~60-67.
    (b) DELETE the entire `vi.mock("./registry-rooms-backfill.js", ...)`
        block at lines ~74-76 (three lines including the trailing blank
        line if any).
    (c) DELETE `mockRunRegistryRoomsBackfill.mockReset();` from the
        `beforeEach` (line ~124).
    (d) DELETE the `mockRunRegistryRoomsBackfill.mockResolvedValue({...})`
        default-happy-path block from `beforeEach` (lines ~136-142).
    (e) In Test 1: delete the three lines of docblock/comment about the
        regression guard (lines ~158-160) AND delete the assertion line
        `expect(mockRunRegistryRoomsBackfill).not.toHaveBeenCalled();`
        (line ~161). Also shorten Test 1's `it()` description string:
        remove the trailing "; auto-backfill NOT called (D-12 is manual
        per instance-deployer)" clause — the new description reads:
          "Test 1: happy path — ensure → enumerate → loop.start called in order"
    (f) In Test 2: delete the assertion line
        `expect(mockRunRegistryRoomsBackfill).not.toHaveBeenCalled();`
        (line ~188). Keep the surrounding assertions (mockLoopStart not
        called, result.ok false, reason creds_missing).
    (g) Update the top-of-file docblock (lines ~1-20): drop the sentence
        "Auto-backfill is DELIBERATELY OMITTED — D-12 backfill is MANUAL
        per instance-deployer..." and the "The registry-rooms-backfill
        mock is retained..." sentence. Replace with a single sentence:
          "There is no in-process backfill path — pre-existing accounts
          are handled by a manual SSH dance if ever needed; D-11 mint
          hooks cover all new accounts."
    (h) If Test 3 also references `mockRunRegistryRoomsBackfill` in any
        assertion, delete that line too. (It uses the default happy-path
        but does not seem to assert on it in the excerpt — verify by
        reading the file.)

    ── src/backend/database/routes/users.ts ──────────────────────────────
    Line ~341-350: rewrite the stale D-12 runbook comment. Replace the
    current 5-line block:
      // Phase 89 D-11 hook. Best-effort per D-12 (REFINED 2026-09-08 post-
      // verifier — backfill is MANUAL per instance-deployer, NOT automatic).
      // A failed join does NOT fail the create — the observation loop's
      // classification for this human will fall back to 'unknown foreign
      // account' until the instance-deployer runs the manual backfill (see
      // phase 89-02 SUMMARY § Manual backfill runbook) or a follow-up mint
      // corrects it. ...
    with:
      // Phase 89 D-11 hook. Best-effort: a failed join does NOT fail the
      // create — the observation loop's classification for this human will
      // fall back to 'unknown foreign account'. Backfill of pre-existing
      // users is FULLY MANUAL (SSH-based dance if ever needed) — there is
      // no in-process backfill path. Hook fires AFTER the INSERT
      // transaction commits (so the row exists even if the join fails)
      // and BEFORE forceSave (so RAM state is fully in place before flush).
    Do NOT change the try/catch body — only the comment above it.

    ── src/backend/database/routes/identity-birth-orchestrator.ts ────────
    Line ~795-802: same rewrite. Replace the current 7-line block:
      // Phase 89 D-11 hook. Best-effort per D-12 (REFINED 2026-09-08 post-
      // verifier — backfill is MANUAL per instance-deployer, NOT automatic).
      // A failed join does NOT fail the birth — the observation loop's
      // classification will fall back to 'unknown foreign account' until the
      // instance-deployer runs the manual backfill (see phase 89-02 SUMMARY
      // § Manual backfill runbook) or a follow-up mint corrects it.
    with:
      // Phase 89 D-11 hook. Best-effort: a failed join does NOT fail the
      // birth — the observation loop's classification will fall back to
      // 'unknown foreign account'. Backfill of pre-existing agents is
      // FULLY MANUAL (SSH-based dance if ever needed) — no in-process path.
    Preserve the section-divider comment lines above/below if they exist.
    Do NOT change the try/catch body.

    ── VERIFICATION GATES (run in this order; must all pass before commit) ──

    Gate 1 — grep-zero orphan refs:
      grep -rn "runRegistryRoomsBackfill\|registry-rooms-backfill\|enumerate-agent-mxids\|relay-registry-backfill" src/
    Expect: ZERO hits. Any hit means an edit was missed.

    Gate 2 — TypeScript clean:
      npx tsc --noEmit
    Expect: exit 0, no errors.

    Gate 3 — relay-sessions suite green:
      npx vitest run src/backend/relay-sessions/
    Expect: exit 0, all tests pass.

    ── COMMIT ────────────────────────────────────────────────────────────
    After all three gates pass, commit ONLY the code edits (no .planning/):
      git add src/backend/database/database.ts \
              src/backend/relay-sessions/observation-loop-starter.ts \
              src/backend/relay-sessions/observation-loop-starter.test.ts \
              src/backend/database/routes/users.ts \
              src/backend/database/routes/identity-birth-orchestrator.ts
      git commit -m "chore(quick-260910-ioi): prune dangling refs after backfill deletion (imports, mounts, mocks, docblocks)"

    Do NOT use `git add -A` or `git add .` — stage the five files by name.
    Do NOT bundle .planning/ files.
  </action>
  <verify>
    <automated>
      # Gate 1: zero orphan refs anywhere in src/ (grep -c across all matches).
      # -v '^\s*//' would filter comments, but we want ZERO including comments
      # because docblocks were the whole point of the edit.
      test "$(grep -rn 'runRegistryRoomsBackfill\|registry-rooms-backfill\|enumerate-agent-mxids\|relay-registry-backfill' src/ | wc -l)" = "0" \
        && echo GATE1_OK

      # Gate 2: tsc clean.
      npx tsc --noEmit && echo GATE2_OK

      # Gate 3: relay-sessions vitest suite green.
      npx vitest run src/backend/relay-sessions/ && echo GATE3_OK

      # Gate 4: HEAD commit exists, is on quick-260910-ioi topic, and touches
      # exactly the five expected src/ files (no .planning/).
      git log -1 --name-only --pretty=format:"%s" | head -1 | grep -q "quick-260910-ioi" \
        && test "$(git log -1 --name-only --pretty=format:'' | grep -v '^$' | grep -v '^\.planning/' | sort | tr '\n' ',')" \
             = "src/backend/database/database.ts,src/backend/database/routes/identity-birth-orchestrator.ts,src/backend/database/routes/users.ts,src/backend/relay-sessions/observation-loop-starter.test.ts,src/backend/relay-sessions/observation-loop-starter.ts,"
    </automated>
  </verify>
  <done>
    All three verification gates pass (grep-zero, tsc, vitest relay-sessions).
    The five edited files are committed at HEAD with a `chore(quick-260910-ioi):`
    message. No .planning/ files in the commit. D-11 mint hooks in users.ts and
    identity-birth-orchestrator.ts still fire (try/catch bodies unchanged; only
    comments above them were rewritten). observation-loop-starter's boot
    sequence is unchanged (ensureRegistryRoomsExist → enumerate → loop.start);
    Tests 1/2/3 still assert the sequence + creds-missing early-return + empty
    user list. registry-rooms.ts is untouched.
  </done>
</task>

</tasks>

<verification>
Phase-level verification is the union of Task 2's four automated gates plus
a manual grep to confirm the D-11 mint hooks still exist and still fire in
the create paths:

  # D-11 mint hooks still wired in users.ts + identity-birth-orchestrator.ts.
  grep -n "joinHumanToHumansRegistry\|joinAgentToAgentsRegistry" \
    src/backend/database/routes/users.ts \
    src/backend/database/routes/identity-birth-orchestrator.ts
  # Expect: at least one call site per file, inside a try{...}.

  # registry-rooms.ts untouched (git shows no changes on this file).
  git diff HEAD~2 -- src/backend/relay-sessions/registry-rooms.ts | wc -l
  # Expect: 0
</verification>

<success_criteria>
- 6 files deleted, 5 files edited, 2 atomic commits (deletions, then edits).
- POST /relay-room/backfill endpoint no longer routable (import + mount gone).
- `runRegistryRoomsBackfill` and `enumerateAgentMxids` no longer importable
  (source files gone).
- `grep -rn "runRegistryRoomsBackfill\|registry-rooms-backfill\|enumerate-agent-mxids\|relay-registry-backfill" src/` returns zero hits.
- `npx tsc --noEmit` exits clean.
- `npx vitest run src/backend/relay-sessions/` exits clean.
- registry-rooms.ts (base module) is byte-identical to HEAD~2 (D-11 mint
  hooks preserved).
- Neither commit contains .planning/ files.
</success_criteria>

<output>
Create `.planning/quick/260910-ioi-delete-the-relay-room-backfill-endpoint-/260910-ioi-SUMMARY.md`
when done, recording: files deleted, files edited, gate outputs, commit SHAs,
and a one-line reminder that backfill is now fully manual (SSH dance) with
no in-process path.
</output>
