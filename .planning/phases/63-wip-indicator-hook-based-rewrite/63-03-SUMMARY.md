---
phase: 62-wip-indicator-hook-based-rewrite
plan: 03
subsystem: fleet-status wire + backend orchestrator
tags: [fleet-status, wire-protocol, ssh-poll, tdd, additive-optional, phase59-retention, path-traversal-defense]
requires:
  - src/backend/fleet-status/activity-hook.sh (Plan 62-01 output — the write side of the activity marker read by Task 2)
  - src/backend/fleet-status/stopped-hook.sh  (Plan 62-01 output — the write side of the stopped marker read by Task 2)
  - src/backend/fleet-status/remote-hook-install.ts (Plan 62-02 output — installs the two Plan 62-01 scripts onto managed boxes)
provides:
  - src/backend/fleet-status/wire-protocol.ts::SessionStateSchema (extended with activityMtime + stoppedMtime as additive+optional numeric wire fields)
  - src/backend/fleet-status/ssh-poll-orchestrator.ts::processPid (two new per-session marker stat reads; PidCacheEntry + computeFingerprint + SessionState composition + livenessMap.set both branches all extended)
affects:
  - .planning/phases/63-wip-indicator-hook-based-rewrite/63-04-PLAN.md (frontend consumer that will read activityMtime + stoppedMtime from the wire and compute `activityMtime > stoppedMtime` as the new WIP predicate — no state machine, no shell-idle gate)
tech-stack:
  added: []
  patterns:
    - "Sixth iteration of the T-41-03-05 additive-optional wire discipline (FRAME_SCHEMA_VERSION deliberately HELD AT 1 across every prior additive addition: lastMessageAt → aiTitle → dormant → recycling → lastStopAt+lastStatusChangeAt → this Phase 63 addition)"
    - "Two separate stat reads per PID per tick (activity + stopped) — batched read deferred per T-62-03-03 rationale with an inline code comment above the first read pointing at the threat entry (plan-review LOW-#10)"
    - "Character-class regex `/^[a-zA-Z0-9_-]+$/` guards BEFORE shell interpolation on both new stat reads — same defense as Phase 59 lastStopAt at line 1121, matching the write-side regex in activity-hook.sh / stopped-hook.sh (T-62-03-02 mitigation)"
    - "Fail-open cache preservation on SSH hiccup (null return) AND absent-file (empty stdout) AND non-numeric stdout — matches lastMessageAt / aiTitle / dormant / lastStopAt patterns"
    - "SessionId-rotation isNew-equivalent treatment: both new axes null on rotation, matching lastStopAt's rotation-reset at line 1193 — the rotated sessionId's markers may not exist yet"
    - "Both livenessMap.set branches (fingerprint-changed + fingerprint-unchanged) explicitly stamp both new axes — same Pitfall-3 invariant as Phase 59 lastStopAt (missing either branch corrupts cache-vs-derivation lockstep)"
    - "MEDIUM-#4 code comment above the OLD Phase 59 perSessionHookPayloadRaw read block documents Option-1 rollout coupling — prevents a future maintainer from `cleaning up` one of the reads without understanding the retention contract"
key-files:
  created: []
  modified:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/wire-protocol.test.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - "LOCKED Option 1 rollout (CONTEXT.md § Rollout): backend publishes BOTH the two new Phase 63 mtime axes AND the retained Phase 59 lastStopAt + lastStatusChangeAt axes simultaneously for the entire rollout window. Frontend Plan 62-04 chooses which predicate to consume per-session based on marker presence. Zero deletions from the Phase 59 pipeline — a follow-up phase (post-full-rollout) retires it cleanly. Rationale: blast-radius rule (CLAUDE.md — a bad deploy loses Ashley access to her whole fleet)."
  - "Two separate stat reads (not one batched `stat -c %Y activity stopped`) per T-62-03-03 deferral: (a) profiling has not shown regression at the 2s poll cadence, (b) two separate reads let each empty-stdout / SSH-hiccup branch preserve its cached value INDEPENDENTLY (batched read must disambiguate two absent-file cases from a single blob), (c) two separate reads match the Phase 59 pattern the reader is familiar with. Inline code comment above the first read documents this — plan-review LOW-#10 acknowledgement."
  - "MEDIUM-#4 comment on the perSessionHookPayloadRaw block (installed by quick-260829-kmr, feeds the Phase 59 background_tasks[] pipeline + the retained Phase 59 lastStopAt fallback signal set): the comment cites CONTEXT.md § Out of scope AND § Rollout Option 1 as the two orthogonal constraints requiring the OLD path to stay. Prevents a future maintainer from `cleaning up` one of the reads mid-rollout."
  - "Test G-bis added beyond the plan's Test G to prove BOTH new axes (not just activityMtime) participate independently in computeFingerprint. Cheap belt-and-suspenders coverage — the second axis could theoretically be omitted from the fingerprint if the diff went wrong."
metrics:
  duration: "~25 minutes"
  completed: "2026-08-30T16:12:00Z"
  tasks: 2
  files: 4
---

# Phase 63 Plan 03: WIP-indicator hook-based rewrite — wire schema + backend orchestrator Summary

One-liner: Extended the fleet-status wire protocol with two additive+optional numeric fields (activityMtime + stoppedMtime) — sixth iteration of the T-41-03-05 discipline holding FRAME_SCHEMA_VERSION at 1 — and wired ssh-poll-orchestrator's processPid loop to derive both fields per PID per tick from the two Plan 62-01 marker files installed via Plan 62-02, with 10 new wire-schema tests and 9 new orchestrator tests covering successful stat / SSH-hiccup fail-open / absent-file fail-open / character-class-guard skip / sessionId-rotation reset / fingerprint-axis-inclusion / Phase 59 retention proof, all under the Option-1 rollout contract that keeps the Phase 59 lastStopAt + lastStatusChangeAt fields on the wire alongside for the entire rollout window.

## What shipped

Four files modified, no files created (all Phase 63 wire + orchestrator changes are additions to existing files):

- **`src/backend/fleet-status/wire-protocol.ts`** — extended SessionStateSchema with two new `z.number().nullable().optional()` fields (activityMtime + stoppedMtime). Added a full block-comment doc above SessionStateSchema (~50 lines) mirroring the Phase 59 comment shape: title, sources (both marker paths with hook-event routing), three-valued semantics (number / null / undefined with rollout-fallback interpretation of null on the frontend side), phase lineage of the additive-optional invariant, Option-1 rollout note explaining why the Phase 59 fields are RETAINED not retired, and a cross-reference to the orchestrator's cache-preservation discipline. FRAME_SCHEMA_VERSION unchanged. Final size: 454 lines (was 381).

- **`src/backend/fleet-status/wire-protocol.test.ts`** — added a new `describe` block after the existing Phase 59 block containing 10 new test cases: A-D per axis (number preserved, null preserved, omitted → undefined back-compat, wrong type → parse error path includes field name), E (both new fields populated together), F (FRAME_SCHEMA_VERSION guard), G (Option-1 retention proof — Phase 63 + Phase 59 axes coexist in the same frame with all four values preserved). Final size: 609 lines (was 454).

- **`src/backend/fleet-status/ssh-poll-orchestrator.ts`** — extended processPid with two new stat exec blocks (immediately after the Phase 59 lastStopAt block at line ~1138 and before the perSessionHookPayloadRaw cat at line ~1150), extended PidCacheEntry with two new fields (activityMtime + stoppedMtime) plus a ~40-line block comment above them, extended sessionId-rotation reset (line ~1192) with the two additional axis nulls, extended computeFingerprint (line ~597) with two new pipe-separated axes appended at the END of the template literal, extended SessionState composition (line ~1442) with the two new stamps, extended the fleet_status_session_state_published log with two new forensic fields, extended BOTH livenessMap.set branches (fingerprint-changed line ~1488 + fingerprint-unchanged line ~1509) with the two new axis writes. Inserted the MEDIUM-#4 explanatory code comment (~25 lines) above the perSessionHookPayloadRaw read explaining Option-1 rollout coupling. Zero changes to Phase 59 lastStopAt / lastStatusChangeAt derivation code paths (retention proof). Zero changes to source B (pollDormantOnlyIdentities). Zero changes to the ambient-filter / backgroundTasks pipeline. Zero changes to the JSONL tail-scan. Final size: 2019 lines (was 1823) — +197 insertions, −1 deletion (the fingerprint template literal was rewritten to append two axes; every other Phase 59 code path is preserved).

- **`src/backend/fleet-status/ssh-poll-orchestrator.test.ts`** — added a new `describe` block after the existing quick-260829-kmr block containing 9 new test cases + two new reusable helpers (wirePhase62Base + buildPhase62Deps, mirroring wirePhase59Base + buildPhase59Deps). Tests: A (activity successful stat), B (stopped successful stat), C (SSH hiccup on activity preserves cached value), D (absent-file empty stdout on stopped preserves cached value), E (character-class-guard-skipped sessionId → neither Phase 63 stat command issued; call-log introspection), F (sessionId rotation nulls both axes), G (activityMtime fingerprint axis — mtime-only delta fires a new publish), G-bis (stoppedMtime fingerprint axis — proves both axes participate independently, executor-added beyond the plan's Test G for belt-and-suspenders), H (Phase 59 retention proof — same publish carries Phase 63 axes AND Phase 59 lastStopAt + lastStatusChangeAt). Final size: 6500 lines (was 6040).

## Tasks executed

### Task 1: Extend wire-protocol.ts SessionStateSchema — additive+optional activityMtime + stoppedMtime (TDD RED → GREEN)

- **RED commit `8ca72817`**: `test(62-03): add failing tests for wire-protocol activityMtime + stoppedMtime (RED)` — 10 tests fail with `expected undefined to be <number>` because the two fields are not yet in the schema (z.object without .strict() ignores unknown fields entirely, so both parse-preservation tests and D-type-enforcement tests fail).
- **GREEN commit `05fe64d6`**: `feat(62-03): add activityMtime + stoppedMtime to SessionStateSchema (GREEN)` — two `z.number().nullable().optional()` fields appended after lastStatusChangeAt, plus the ~50-line block comment above SessionStateSchema. All 48 wire-protocol tests pass (38 pre-plan + 10 new). Backend TS build (`npm run build:backend`) exits 0.

### Task 2: Extend ssh-poll-orchestrator.ts processPid — two new per-session marker stat reads + PidCacheEntry + computeFingerprint + SessionState composition + livenessMap.set both branches (TDD RED → GREEN)

- **RED commit `d83a5c45`**: `test(62-03): add failing tests for ssh-poll-orchestrator Phase 63 marker reads (RED)` — 9 tests fail with `expected undefined to be <number>` (or `expected null` for the guard-skip test) because the two new axes are not yet stamped by processPid.
- **GREEN commit `9431efdf`**: `feat(62-03): extend processPid with two per-session marker mtime reads (GREEN)` — all seven plan-action-step changes applied verbatim to the surgical scope named in the plan. All 161 tests pass across both files (98 pre-plan orchestrator + 9 new + 38 pre-plan wire-protocol + 10 new + 6 executor test G-bis+H additions counted once). Backend TS build exits 0.

## Verification evidence

Combined scoped-test gate (executor's ship-boundary per fleet standing directive — full suite is orchestrator-scope at ship time):

```
$ npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts \
                 src/backend/fleet-status/wire-protocol.test.ts
Test Files  2 passed (2)
     Tests  161 passed (161)
  Duration  22.41s
```

Backend TS strictness gate (per fleet standing directive — backend files touched):

```
$ npm run build:backend
> tsc -p tsconfig.node.json && node -e "require('fs').copyFileSync('src/backend/package.json','dist/backend/package.json')"
$ echo $?
0
```

Task 1 acceptance-criteria greps:

```
$ grep -c 'activityMtime\|stoppedMtime' src/backend/fleet-status/wire-protocol.ts
10          # need >= 2 ✓ (each field declared once + referenced multiple times inside the ~50-line block comment)
$ grep -c 'FRAME_SCHEMA_VERSION = 1' src/backend/fleet-status/wire-protocol.ts
1           # need exactly 1 ✓ (version deliberately unchanged)
$ grep -c 'lastStopAt\|lastStatusChangeAt' src/backend/fleet-status/wire-protocol.ts
9           # need >= 2 ✓ (Phase 59 fields retained — count actually grew because the Phase 63 comment cites Phase 59 as the retention reference)
$ grep -c 'activityMtime\|stoppedMtime' src/backend/fleet-status/wire-protocol.test.ts
39          # need >= 10 ✓ (each field referenced by 4-5 tests × 2 fields + Tests E/G both-field checks)
```

Task 2 acceptance-criteria greps:

```
$ grep -c 'activityMtime\|stoppedMtime' src/backend/fleet-status/ssh-poll-orchestrator.ts
30          # need >= 16 (plan-review LOW-#9 raised threshold) ✓
              # Enumerated: PidCacheEntry field decls 2 + block comment refs ~8 +
              #   computeFingerprint 2 + comment above 2 + derived-var decls 2 +
              #   stat commands 2 + parse branches 2 + sessionId-rotation resets 2 +
              #   SessionState composition 2 + forensic log 2 + livenessMap.set BOTH
              #   branches 4 = 30 total.
$ grep -c 'fleet-status/hooks' src/backend/fleet-status/ssh-poll-orchestrator.ts
5           # need >= 2 ✓ (two new stat commands + three comment references)
$ grep -c 'lastStopAt\|lastStatusChangeAt' src/backend/fleet-status/ssh-poll-orchestrator.ts
40          # pre-plan: 27 → post-plan: 40. All 13 new references are inside Phase 63
              # comments citing the RETAINED Phase 59 axes (block comments, MEDIUM-#4
              # rollout-coupling comment, rotation-reset explanation). The Phase 59
              # CODE PATHS themselves are byte-identical — verified by:
$ git diff HEAD~2..HEAD~1 src/backend/fleet-status/ssh-poll-orchestrator.ts | grep '^-' | grep -v '^---' | wc -l
1           # only ONE line removed: the fingerprint template literal (which was
              # rewritten in place to append the two new axes; the Phase 59 axes
              # inside it are preserved verbatim).
$ git diff --stat HEAD~2..HEAD~1 -- src/backend/fleet-status/ssh-poll-orchestrator.ts
 src/backend/fleet-status/ssh-poll-orchestrator.ts | 198 +++++++++++++++++++++-
 1 file changed, 197 insertions(+), 1 deletion(-)
```

## Deviations from Plan

### Structural / process choices worth flagging (all Rule 2 — belt-and-suspenders coverage additions, no code-behavior changes beyond the plan)

**1. [Rule 2 — Coverage improvement] Test G-bis added alongside Test G to prove stoppedMtime is independently a fingerprint axis (not just activityMtime).**

The plan's Test G specification proves activityMtime participates in computeFingerprint via a mtime-only-delta publish. The stoppedMtime axis has the same load-bearing invariant and would be silently broken if the executor omitted it from the fingerprint template literal. Adding Test G-bis (a near-verbatim copy of Test G targeting the stopped marker instead) makes that second axis explicitly covered — cheap safety net given the tests share the same test-scaffolding shape. Total new tests: 9 instead of the plan's 8.

**2. [Rule 2 — Documentation improvement] Test H's assertion set widened beyond the plan's minimum.**

The plan's Test H bullet says "confirm the same publish also carries lastStopAt + lastStatusChangeAt (retention proof)". The executor's Test H asserts all four axes (activityMtime + stoppedMtime + lastStopAt + lastStatusChangeAt) on the same published frame, using the seeded lastStatusChangeAt (isNew branch → deps.now()) as the retention proof for the Phase 59 status-delta derivation. Extra assertion is `expect(published.state.lastStatusChangeAt).toBe(1730500000000)` — proves the whole Phase 59 pipeline (not just the stat read) is still running end-to-end.

**3. [Executor process note — no plan text drift] The plan's `<action>` steps are numbered 1-9 but skip step 8 (jumping from step 7 to step 8 to step 9 in the ssh-poll-orchestrator.test.ts list where the second "9" is actually a Task-2-tests entry).**

Executor read this as intentional (step 8 in Task 2's action list is the MEDIUM-#4 code-comment insertion above the perSessionHookPayloadRaw block, which is `9. Do NOT modify source B...` in the source listing — but the code-comment step lands as an implicit step-8 slot). Both were applied: MEDIUM-#4 comment inserted at the specified location, no source B / ambient-filter / JSONL / emitHookPayloadWarn changes made. No behavior deviation from the plan's intent.

No Rule 1 (bug), Rule 3 (blocking-issue), or Rule 4 (architectural) deviations. No auth gates hit.

## Threat register cross-check (STRIDE from plan §threat_model)

| Threat ID | Category | Disposition | Mitigation evidence |
|-----------|----------|-------------|---------------------|
| T-62-03-01 | Tampering — marker mtime spoofing by hostile local identity | accept | Documented in the plan as `accept` — box-level trust model unchanged. No code mitigation required at this layer. |
| T-62-03-02 | Information-Disclosure — path traversal via malicious sessionId reads foreign file's mtime | mitigate | Character-class regex `/^[a-zA-Z0-9_-]+$/` applied BEFORE both new stat commands (matching the Phase 59 line 1121 pattern verbatim). Verified by Test P62-03 E which uses sessionId `"../evil"` and asserts `channel.getCalls().filter(c => c.command.includes("fleet-status/hooks/")).length === 0` — no exec issued, cached values preserved. Belt-and-suspenders POISON responses registered for the two stat patterns in Test E prove no value leaks through. |
| T-62-03-03 | Denial-of-Service — two additional stat execs per PID per tick | accept | Two extra stats on top of the existing lastStopAt stat = 3 total per PID per tick. The 2s poll cadence + typical <50 PIDs per box means negligible added load. Batched-read optimization deferred with an inline code comment in ssh-poll-orchestrator.ts above the first Phase 63 stat block pointing at this threat entry (plan-review LOW-#10 acknowledgement). |
| T-62-03-04 | Spoofing — wire schema addition without version bump masks a truly breaking change | mitigate | Both new fields are `.optional().nullable()` — parse succeeds on pre-Phase-62 emitters that omit them. Sixth iteration of the T-41-03-05 pattern. Verified by wire-protocol.test.ts Tests P62-03 C for both fields (schema back-compat on omission). FRAME_SCHEMA_VERSION guard verified by Test P62-03 F. |
| T-62-03-SC | Tampering — package installs | n/a | No new package dependencies introduced. No `npm install <pkg>` invoked. |

## Known Stubs

None. The wire schema and backend orchestrator now emit the two new axes in production shape. Frontend consumer (Plan 62-04) will pick them up on the next tick from every managed box that has the Plan 62-02 installer applied. Boxes without the installer will emit both fields as `null` — the Option-1 rollout fallback, per the plan's LOCKED design. This is not a stub — it is the plan's explicit Option-1 rollout contract.

## Downstream contract

**Plan 62-04 will:**
- Add `activityMtime` and `stoppedMtime` field mirrors to `src/ui/api/fleet-status-types.ts` (browser-side wire mirror of the two new fields added to the backend wire in this plan's Task 1).
- Change the frontend `session-working-store.ts` WIP predicate to:
    ```typescript
    if (activityMtime !== null || stoppedMtime !== null) {
      // New direct-signal predicate (Plan 62-01/02/03 installed on this box):
      isWorking = (activityMtime ?? 0) > (stoppedMtime ?? 0);
    } else {
      // Fall through to the retained Phase 59 shell-idle-gate predicate for
      // boxes not yet upgraded (Option-1 rollout).
      isWorking = /* existing shell-idle-gate composition using lastStopAt + lastStatusChangeAt */;
    }
    ```
- No backend or wire changes in Plan 62-04 — the two new axes are already flowing per this plan's Task 2 output.
- No installer or hook-script changes in Plan 62-04 — Plans 62-01 + 62-02 own the write side.

**Follow-up phase (post-full-rollout, orchestrator-tracked, NOT this phase):**
- Retire the Phase 59 lastStopAt + lastStatusChangeAt derivations from ssh-poll-orchestrator.ts.
- Retire the Phase 59 fields from wire-protocol.ts (breaking-change wire bump if any consumer still reads them — verifier check).
- Retire the OLD stop-hook.sh + its Stop-only settings.json entry in remote-hook-install.ts.
- Retire the perSessionHookPayloadRaw cat read in processPid (MEDIUM-#4 comment now points at this future retirement).

## Executor remit boundary honored

Per fleet standing directive (Ashley 2026-07-27) and this plan's `<sequential_execution>` block:

- NO `git push` (deploy-window boundary at push — orchestrator handles).
- NO `docker build` / `docker compose up` (deploys are orchestrator-only).
- NO branch changes (stayed on `feat/tab-title-from-tmux`).
- NO full-suite `npx vitest run` gate (full-suite is orchestrator ship-gate per "scoped during dev, full suite as a deploy gate" directive).
- NO `--no-verify` flag on any commit (all four commits went through hook gates — husky hooks were noted as non-executable in the git output, so they no-op'd naturally, which is upstream project state, not a bypass).
- NO worktrees used (project fleet rule — `use_worktrees: false` in .planning/config.json).
- Scoped-test gate met: 161/161 pass on the two touched test files.
- Backend build gate met: `npm run build:backend` exit 0 (verified twice — after Task 1 GREEN and after Task 2 GREEN).
- Four atomic commits on `feat/tab-title-from-tmux`: `8ca72817` (Task 1 RED), `05fe64d6` (Task 1 GREEN), `d83a5c45` (Task 2 RED), `9431efdf` (Task 2 GREEN).

## Self-Check: PASSED

Files verified present on disk:
- `src/backend/fleet-status/wire-protocol.ts` (454 lines, +73 insertions)
- `src/backend/fleet-status/wire-protocol.test.ts` (609 lines, +155 insertions, 48 tests)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (2019 lines, +197 insertions, −1 deletion)
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (6500 lines, +460 insertions, 113 tests in file)

Commits verified in `git log --oneline`:
- `8ca72817` test(62-03): add failing tests for wire-protocol activityMtime + stoppedMtime (RED)
- `05fe64d6` feat(62-03): add activityMtime + stoppedMtime to SessionStateSchema (GREEN)
- `d83a5c45` test(62-03): add failing tests for ssh-poll-orchestrator Phase 63 marker reads (RED)
- `9431efdf` feat(62-03): extend processPid with two per-session marker mtime reads (GREEN)

Working tree clean (`git status --short` empty). All acceptance-criteria greps satisfied. All 161 scoped tests pass. Backend TS build exits 0. Ready for Plan 62-04.
