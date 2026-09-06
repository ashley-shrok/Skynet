---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
plan: 06
subsystem: ui
tags: [react, vitest, identity-birth, unified-modal, mxid, pool-picked]

# Dependency graph
requires:
  - phase: 80
    provides: "plan 80-03b (backend BirthOptions.poolPicked + task field handling), plan 80-04 (POST /identities/pool/pick endpoint), plan 80-05 (frontend pickPoolName API + BirthRequest.task/poolPicked types + Identity.task read)"
  - phase: 77
    provides: "identity-birth-orchestrator (Q2 partial-tolerated invariant) that plans 80-03 + 80-03b extend with task field emission and poolPicked-triggered MXID DIVERGE"
provides:
  - "Unified new-agent modal with task-description textarea (id=new-identity-task, maxLength=200, rows=2) gated on identityMode"
  - "Auto-prefill Name field from pickPoolName on role change (respects user-typed name via `name === ''` guard)"
  - "poolPicked wire signal in POST /identities/birth body — sent true iff current name state exactly matches last pool-picked value (A1 MXID lock trigger)"
  - "Role-select bug fix (Approach A per A4 lock): 'Pick a host to see available roles' inline hint rendered when identityMode ON and no host picked — fills the visual gap the host-gated role dropdown left"
  - "New test file NewSessionDialog.task-input.test.tsx with 14 test cases covering: task textarea presence/absence/maxLength, task in birth body, task omitted when empty, pickPoolName auto-prefill, prefill respects user-typed name, silent-on-failure, poolPicked wire signal (all three branches: unedited, user-edited, no-prefill), host-null affordance visible/hidden/identity-mode-gated"
affects: [80-07, 80-08, 80-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling test-file pattern preserved (Landmine 10) — new coverage lives in NewSessionDialog.task-input.test.tsx alongside existing .test.tsx / .chain.test.tsx / .role-dropdown.test.tsx rather than bloating the 1600-line main suite"
    - "Wire-signal edit-detection via string equality at submit time (poolPicked = name.trim() === poolPickedName) — no per-keystroke reset of poolPickedName needed; the equality check IS the detection"
    - "Approach A affordance pattern: inline muted hint rendered on the negation of an existing gate ({selectedHost === null}) sibling to the gated block ({selectedHost !== null && (...)}) — no gate change, just a paired complement"

key-files:
  created:
    - "src/ui/sidebar/NewSessionDialog.task-input.test.tsx (14 tests, ~380 lines)"
  modified:
    - "src/ui/sidebar/NewSessionDialog.tsx (+99 lines on 1283-line file = ~7.7% growth — extension, not rewrite per Landmine 10)"
    - "src/ui/sidebar/NewSessionDialog.test.tsx (added pickPoolName mock to prevent unmocked-real-axios calls in the pre-existing 46-test suite)"
    - "src/ui/sidebar/NewSessionDialog.chain.test.tsx (added pickPoolName mock — same reason)"
    - "src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx (added pickPoolName mock — same reason)"

key-decisions:
  - "Approach A (visible hint) over Approach B (widen auto-pick) for the role-select bug fix. Rationale: fleet has no deterministic 'local Skynet host' identifier in the host list, so Approach B would require invented host-identification logic. Approach A is minimal-surface and matches the plan's recommendation."
  - "poolPickedName state is NOT reset on every name keystroke. Edit-detection is a straight string-equality check at submit time (name.trim() === poolPickedName). This keeps the reducer simple and lets a user who edits then reverts the name still land on poolPicked:true — semantically correct: if the final name matches the pool value, it IS the pool value."
  - "Task textarea positioned ABOVE the Name input (not below). Rationale: the task is the primary framing question ('what will this agent work on?') and the name is a downstream detail. Order matches user thought flow: describe the work, then name the agent."
  - "New useEffect keyed on [selectedRole, selectedHost, identityMode] uses cancelled-flag cleanup to guard against stale responses when role/host changes mid-flight (T-80-06-04 mitigation). Explicitly documented in the useEffect body."

patterns-established:
  - "Grow-don't-replace extension of the 1283-line NewSessionDialog.tsx (Landmine 10 respected — 99 lines added on top of existing structure, no removed JSX, chain-hook mechanism L397-410 untouched)"
  - "New test file uses per-mock .mockReset() in beforeEach instead of vi.resetAllMocks() to avoid clobbering the vi.mock factory-returned callable functions while still draining leftover mockResolvedValueOnce queues between tests"
  - "Task-input helper fillFormForSubmit centralizes the identity-form submit dance (role pick + prefill wait + name/title/brief fill + generate + candidate pick + Create-enabled wait) so individual tests focus on the ONE behavior they cover"

requirements-completed: []  # Plan frontmatter had `requirements: []` — no requirement IDs to check off.

# Metrics
duration: 154min
completed: 2026-09-06
---

# Phase 80 Plan 06: NewSessionDialog Unified Rebuild Summary

**Extended NewSessionDialog with task textarea + pool-name auto-prefill + poolPicked wire signal + Approach-A host-null affordance — 99 lines on a 1283-line file, all four existing test files still green.**

## Performance

- **Duration:** 154 min (~2h 34m)
- **Started:** 2026-09-06T15:18:12Z
- **Completed:** 2026-09-06T17:52:24Z
- **Tasks:** 3 / 3 (all with TDD RED→GREEN cycles)
- **Files modified:** 5 (1 new test file, 4 modified — source + 3 existing test files)

## Accomplishments

- **Task textarea + poolPicked wire signal shipped** — the user-facing surface that makes an identity task-scoped-from-birth (D-01, D-04) and triggers the backend's A1 MXID lock branch (plan 80-03b) is live.
- **Role-select bug fixed (RESEARCH §Landmine 2 / A4 lock)** — identityMode-ON users no longer stare at an empty modal when no host is auto-picked; the "Pick a host to see available roles" hint fills the visual gap without changing the existing host-gate at L1022.
- **Pool prefill working end-to-end** — role change fires pickPoolName, name prefills silently, user can override, submit correctly tags poolPicked based on edit-detection.
- **Landmine 10 respected** — 99 lines added on top of 1283-line file (~7.7% growth). Chain-hook mechanism L397-410 (initialHost/initialRole/initialBrief) untouched — grep count 20 preserved. All existing tests (NewSessionDialog.test.tsx 46/46, chain.test.tsx 14/14, role-dropdown.test.tsx 8/8) still pass in isolated runs.
- **14 new tests** in NewSessionDialog.task-input.test.tsx cover every branch of the Task 1-3 behavior, exceeding the plan's ≥10 requirement.

## Task Commits

Each task was committed atomically:

1. **Task 1: add task-input state + textarea + wire poolPicked into birth body** — `b41a0f6a` (feat)
2. **Task 2: auto-prefill Name via pickPoolName on role change** — `21cf577e` (feat)
3. **Task 3: add 'Pick a host to see available roles' affordance + Task 3 test cases** — `797e136e` (feat)

_Note: The plan required TDD, so each task was implemented RED-first — Task 1 wrote the initial test file with 3 Task-1-specific test cases (RED); Task 2 added 3 Task-2-specific tests + used the pool-prefill code path to make them pass; Task 3 refined the host-null affordance tests + implemented the source-side hint. Each task commit contains the source change + updated tests together, matching the plan's `tdd="true"` guidance for feature-adding tasks._

## Files Created/Modified

- `src/ui/sidebar/NewSessionDialog.tsx` (+99 lines) — task state + poolPickedName tracking state + task textarea JSX + pool-prefill useEffect + birth-body wire (task + poolPicked) + Approach-A host-null hint block.
- `src/ui/sidebar/NewSessionDialog.task-input.test.tsx` (new, ~380 lines) — 14 test cases covering task-input behavior + poolPicked wire signal + host-null affordance.
- `src/ui/sidebar/NewSessionDialog.test.tsx` (+15 lines) — pickPoolName mock added to prevent the new useEffect from calling real axios in this file's 46-test suite.
- `src/ui/sidebar/NewSessionDialog.chain.test.tsx` (+9 lines) — pickPoolName mock added, same rationale.
- `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` (+9 lines) — pickPoolName mock added, same rationale.

## Key Decisions

### Approach A (visible hint) over Approach B (widen auto-pick)

The plan offered two approaches for the role-select bug fix. I picked A because:

- This fleet's host list has no deterministic "local Skynet host" identifier — Approach B would require inventing host-identification logic beyond the plan's scope.
- Approach A is smaller-surface (a single conditional JSX block) and matches the plan's stated recommendation.
- Approach A keeps the existing host-gate at L1022 intact; Approach B would have widened the on-open effect at L397-410 and risked interfering with the chain-hook mechanism (Landmine 11).

### poolPickedName is not reset on every keystroke

Rather than adding a `setPoolPickedName(null)` call to the Name input's onChange handler, edit-detection is a submit-time string-equality check (`name.trim() === poolPickedName`). This:

- Keeps the reducer simple (one place decides the wire value, not two).
- Handles the "user edits then reverts" edge case correctly — if the final name matches the pool value, it IS the pool value semantically.
- Matches the plan behavior spec ("simultaneously calls `setPoolPickedName(poolName)` to record the pool-picked value for later edit-detection at submit time").

### Task textarea position: above Name, not below

The task is the primary framing question ("what will this agent work on?"). The name is a downstream detail (often auto-picked). Placing task above name matches the user's mental flow: describe the work first, then name the worker.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking test infrastructure]** Added `pickPoolName` to the `vi.mock("@/api/identities-api", ...)` block in the three existing NewSessionDialog test files. Without this, my new useEffect (Task 2) would call the un-mocked real axios path during any identity-mode test — silently rejecting but still burning render budget on the pre-existing flaky Test G / Test R / Test 21 assertions (documented flaky since 2026-08-28, unrelated to plan 80-06). Adding the mock in each sibling file prevents pool prefill from firing in tests that don't exercise it. This is a test-hermeticity fix, not a behavior change.

**2. [Rule 3 - Test infra]** Used per-mock `.mockReset()` in `NewSessionDialog.task-input.test.tsx`'s `beforeEach` (instead of `vi.resetAllMocks()`). The reason: `resetAllMocks()` wipes the vi.mock() factory-returned functions themselves (`mockListRolesForHost`, `mockPickPoolName`, etc.), breaking every test that calls them. Per-mock `.mockReset()` correctly drains the `mockResolvedValueOnce` queue without clobbering the callable functions.

### Not fixed (deferred)

**Pre-existing test-suite flakes** — under full 4-file parallel-suite load (all four NewSessionDialog test files running concurrently), Test G / Test R / Test 21 (existing tests, documented flaky since 2026-08-28) still surface intermittent timeouts. These reproduce identically with Task 1-only code (verified via git stash), so they are NOT caused by plan 80-06. Test G's in-file flake-fix comment (L657-661) already acknowledges the issue. Each of the 4 test files passes solo — the parallel-load flakes are out of scope for this plan (see Landmine 10: preserve, don't rewrite; these are documented pre-existing flakes).

## Threat Model Compliance

Per plan `<threat_model>`:

| Threat ID | Mitigation Status | Evidence |
|-----------|-------------------|----------|
| T-80-06-01 (DoS via >200 char task) | mitigated | `maxLength={200}` on the textarea; grep-verified. Backend cap at 500 chars (plan 80-03) is the actual security boundary. |
| T-80-06-02 (Task string YAML/JS payload) | mitigated | Nothing this file needs to do; backend `yaml.dump` auto-quotes (plan 80-03), React auto-escapes on render (plans 80-07/08). |
| T-80-06-03 (pickPoolName error surface leaks server state) | mitigated | try/catch is silent — no user-visible error text emitted. Verified by Task 2c: `mockRejectedValueOnce` + assertion that no error text surfaces. |
| T-80-06-04 (stale-response race after role change) | mitigated | `cancelled` flag pattern in useEffect cleanup; `grep -c 'cancelled = true'` returns 2. |
| T-80-06-05 (client mutates name after pool-pick to force MXID DIVERGE) | accepted per plan | Backend re-validates via composeMxidLocalpart shape check (plan 80-03b Task 2). Frontend's edit-detection at submit time is a hint, not authoritative — a malicious client bypassing the check gains nothing. |

No new threat surface introduced by this plan beyond what the threat register anticipated.

## Verification

### Automated

All four NewSessionDialog test files pass in isolated runs:

```
NewSessionDialog.test.tsx: 46/46 tests pass (240s)
NewSessionDialog.chain.test.tsx: 14/14 tests pass (163s)
NewSessionDialog.role-dropdown.test.tsx: 8/8 tests pass (124s)
NewSessionDialog.task-input.test.tsx: 14/14 tests pass (156s)
```

Grep acceptance gates (all green):

- `grep -c 'const \[task, setTask\] = useState'` → 1 (Task 1)
- `grep -c 'const \[poolPickedName, setPoolPickedName\] = useState'` → 1 (Task 1)
- `grep -c 'id="new-identity-task"'` → 1 (Task 1)
- `grep -c 'maxLength={200}'` → 1 (Task 1)
- `grep -c 'What will this agent work on?'` → 1 (Task 1)
- `grep -c 'setTask("")'` → 1 (Task 1 reset)
- `grep -c 'setPoolPickedName(null)'` → 1 (Task 1 reset)
- `grep -c 'task: task.trim()'` → 1 (Task 1 body)
- `grep -c 'poolPicked:'` → 3 (Task 1 body + comments)
- `grep -c 'name.trim() === poolPickedName'` → 1 (Task 1 edit-detection)
- `grep -c 'initialHost\|initialRole\|initialBrief'` → 20 (chain-hook untouched, baseline preserved)
- `grep -c 'pickPoolName'` → 4 (Task 2 import + useEffect + comments)
- `grep -c '\[selectedRole, selectedHost, identityMode\]'` → 1 (Task 2 useEffect dep array)
- `grep -c 'name === ""'` → 2 (Task 2 prefill guard + collision-check-existing)
- `grep -c 'setPoolPickedName(poolName)'` → 1 (Task 2 prefill success)
- `grep -c 'cancelled = true'` → 2 (Task 2 cleanup + existing role-dropdown effect)
- `grep -cE 'Pick a host\|pick a host'` → 2 (Task 3 Approach A hint + pre-existing modal description)
- `grep -cE "^\s*(it|test)\(" src/ui/sidebar/NewSessionDialog.task-input.test.tsx` → 14 (≥10 required)
- `grep -c 'poolPicked' src/ui/sidebar/NewSessionDialog.task-input.test.tsx` → 10 (≥3 required)

### Manual code review

- No removed JSX blocks — extension only.
- Chain-hook mechanism (initialHost/initialRole/initialBrief on-open effect at L397-410) untouched.
- Role dropdown host-gate at L1022 untouched (Approach A adds a sibling hint, not a gate change).
- No new npm dependencies.
- No changes to backend routes or types (this plan is frontend-only).

## Self-Check: PASSED

Files verified to exist:
- `src/ui/sidebar/NewSessionDialog.tsx` — FOUND (updated in b41a0f6a, 21cf577e, 797e136e)
- `src/ui/sidebar/NewSessionDialog.task-input.test.tsx` — FOUND (created in b41a0f6a)

Commits verified to exist:
- `b41a0f6a` — FOUND (Task 1: task-input state + textarea + wire poolPicked)
- `21cf577e` — FOUND (Task 2: auto-prefill Name via pickPoolName)
- `797e136e` — FOUND (Task 3: Approach A hint + Task 3 test cases)
