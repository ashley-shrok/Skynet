---
phase: 61-wip-indicator-shell-idle-gate
plan: 02
subsystem: fleet-status
tags: [ssh-poll-orchestrator, pid-cache, fingerprint, status-delta, additive-axis, fail-open]

# Dependency graph
requires:
  - phase: 34-fleet-status
    provides: ssh-poll-orchestrator (2s poll loop), processPid per-PID pipeline, PidCacheEntry cache, shellSingleQuote (T-52-01-02 mitigation pattern), MockSshChannel + MockRegistry test doubles, makeSessionJson fixture
  - phase: 52-dormant
    provides: dormant sentinel stat pattern (identity-folder shellSingleQuote + fail-open), Pitfall 3 (Axis F/G cache preservation on livenessMap.set both branches), tri-valued fingerprint segment convention
  - phase: 53-recycling
    provides: additive-axis fingerprint extension template literal shape, fifth-iteration back-compat discipline
  - phase: 61-01
    provides: SessionStateSchema.lastStopAt + lastStatusChangeAt (z.number().nullable().optional() on the wire); frontend SessionState mirror; STOP_HOOK_SCRIPT_CONTENTS byte-in-sync with per-session `~/.claude/fleet-status/stop-<sessionId>.json` write
provides:
  - PidCacheEntry gains three new fields (`lastStatus`, `lastStatusChangeAt`, `lastStopAt`) grouped as a Phase 61 Plan 02 comment block
  - processPid issues ONE additional `stat -c %Y ~/.claude/fleet-status/stop-<shellSingleQuote(sessionId)>.json` exec per PID per tick (Pattern A — sequential — one extra RTT per PID)
  - processPid derives `lastStatusChangeAt` SERVER-SIDE by comparing this-tick `sessionJson.status` to previous-tick cached `lastStatus`; seed on isNew, deps.now() on transition, cache-preserve on same-status
  - Composed SessionState stamps both new axes at the end of the object literal
  - computeFingerprint template literal extended with `|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}` — both axes participate in delta detection
  - BOTH livenessMap.set branches (fingerprint-changed AND fingerprint-unchanged) cache the three new fields (Pitfall 3 preservation across the fifth iteration of the same pattern)
  - fleet_status_session_state_published logger call includes both new axes for forensic tracing (T-61-02-04 mitigation)
  - 6 new tests in ssh-poll-orchestrator.test.ts cover the four canonical derivation behaviors + first-appearance seed + fail-open on SSH hiccup — reuse existing MockSshChannel via distinct substring pattern
affects: [61-03 (frontend session-working-store predicate consumes the two new axes)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sixth iteration of the additive per-PID derivation pattern on processPid (lastMessageAt Phase 41 → aiTitle Phase 47 → dormant Phase 52 → recycling Phase 53 → source B migration quick-260823 → lastStopAt+lastStatusChangeAt Phase 61). Same shape: cached fail-open + fingerprint axis + BOTH livenessMap.set branches"
    - "Server-side status-value delta tracking via prev-tick cached lastStatus vs this-tick sessionJson.status. FIRST NEW-AXIS in this subsystem that is derived from a PID-cache internal state transition (all prior axes were derived from disk / SSH-read data). Explicitly excludes sessionJson.updatedAt as source (Pitfall 4 — harness bumps updatedAt on compose-box typing)"
    - "shellSingleQuote applied to sessionJson.sessionId before shell interpolation (T-61-02-01 mitigation — same defense pattern as Phase 52's dormant stat's tmuxSession quoting)"

key-files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts

key-decisions:
  - "Used Pattern A (sequential — one extra RTT per PID per tick) NOT Pattern B (restructure Promise.all). Rationale: matches the Phase 52 dormant sentinel stat placement immediately below the tmux resolution block; one extra RTT is <100ms overhead per host per tick; simpler diff; parallels the existing `stat ~/.claude/identities/…/.dormant` call shape exactly. No perf regression risk — the box-wide hookPayload read at line 971 is already one round-trip per PID per tick."
  - "Both livenessMap.set branches explicitly stamp all three new fields (lastStatus, lastStatusChangeAt, lastStopAt) rather than relying on the spread + selective override pattern. Rationale: the fingerprint-unchanged branch uses `...(livenessMap.get(pid) as PidCacheEntry)` spread; while the spread would preserve the OLD lastStopAt on a same-status tick, a fresh mtime read might have advanced lastStopAt in a same-fingerprint tick (extremely unlikely given lastStopAt participates in fingerprint, but explicit stamps are defensive against future refactor drift). Zero cost, maximum clarity."
  - "MockSshChannel pattern reused (not extended with a new mechanism). Used the `fleet-status/stop-` substring pattern to uniquely identify the new stat command vs the box-wide `cat …/last-stop-payload.json` pattern. Also registered the new pattern FIRST in wirePhase59Base to control MockSshChannel's insertion-order iteration match precedence — belt-and-suspenders against future pattern-collision surprises."
  - "Test P57-02-B uses a three-tick observable-behavior-only pattern to prove same-status cache preservation. Tick 2 fingerprint-suppresses (not directly observable as an assertion), so the load-bearing proof is: (a) tick 2 emits NO publish (fingerprint identical iff cache preserved), (b) tick 3 status transition publishes lastStatusChangeAt=tick-3-now (a fresh deps.now()), disproving the false-positive where tick 2 might have incorrectly bumped the cache. No cache introspection — the observable contract is the SessionState frame published to MockRegistry."

patterns-established:
  - "First 'server-side delta' axis on the SessionState wire. Prior axes were either raw reads (lastMessageAt, aiTitle from JSONL tail; dormant from stat) or box-side computed booleans (recycling from Layer 1). lastStatusChangeAt is the first axis whose value is a function of the PidCacheEntry's own prior state (a two-tick temporal reduction). Any future axis with this shape should follow the isNew || cold-cache seed rule + transition detection + preserve otherwise (Research § Code Examples 'Status-delta tracking')."

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-08-29
---

# Phase 61 Plan 02: WIP-Indicator Shell-Idle-Gate Backend Consumer Summary

**Backend `processPid` now stamps both lastStopAt (per-session Stop-hook file mtime × 1000) and lastStatusChangeAt (server-side status-value-delta with isNew seed rule) into every SessionState frame; both axes participate in `computeFingerprint` so an axis-only flip publishes a new frame; PidCacheEntry gains three cache fields preserved across both livenessMap.set branches (Pitfall 3); 6 new tests cover the canonical derivations without introducing a new mock class or cache introspection.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-29T08:11:20Z
- **Completed:** 2026-08-29T08:23Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `PidCacheEntry` interface (`ssh-poll-orchestrator.ts`) with three Phase 61 Plan 02 fields (`lastStatus`, `lastStatusChangeAt`, `lastStopAt`) wrapped in a documented comment block that explicitly cites Pitfall 4 (never source lastStatusChangeAt from sessionJson.updatedAt) and the fail-open convention.
- Extended `processPid` with TWO new derivation blocks inserted between the tmux-resolution block and the Phase 52 dormant sentinel stat:
  - **Per-session Stop file mtime read** — one `stat -c %Y ~/.claude/fleet-status/stop-<shellSingleQuote(sessionId)>.json 2>/dev/null || true` exec per PID per tick. Seconds × 1000 → wire millis. Fail-open on null (SSH hiccup) / empty (file absent) / non-numeric (unexpected output). T-61-02-01 mitigation applied via `shellSingleQuote(sessionJson.sessionId)`.
  - **Server-side status-delta** — three mutually-exclusive branches: isNew || cold-cache lastStatus → seed to `deps.now()` (Pitfall 5); transition (cached.lastStatus !== sessionJson.status) → `deps.now()`; same-status → preserve cached `lastStatusChangeAt`.
- Extended composed `SessionState` at line ~1237 with `lastStopAt: derivedLastStopAt` and `lastStatusChangeAt: derivedLastStatusChangeAt`.
- Extended `computeFingerprint` template literal at line 537 with `|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}` — both new axes participate in delta detection so an axis-only flip on either publishes a new frame.
- Extended BOTH `livenessMap.set` branches (fingerprint-changed at former line 1273; fingerprint-unchanged at former line 1286) with `lastStatus: sessionJson.status`, `lastStatusChangeAt: derivedLastStatusChangeAt`, `lastStopAt: derivedLastStopAt`. Pitfall 3 preservation — same-status-many-ticks does not regress the cache.
- Extended `fleet_status_session_state_published` logger call with `lastStopAt` and `lastStatusChangeAt` entries for forensic tracing of which axis drove a publish (T-61-02-04 mitigation).
- Added 6 new tests to `ssh-poll-orchestrator.test.ts` in a new describe block appended at end of file, covering all four canonical derivation behaviors + first-appearance seed + fail-open on SSH hiccup + fingerprint-participation invariant. Reused `MockSshChannel` via the distinct `fleet-status/stop-` substring pattern (no new mock class introduced).
- `npm run build:backend` clean (backend TypeScript compiles with the new PidCacheEntry fields; every existing consumer accounted for).
- `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator` — 94 tests green (88 pre-existing + 6 new Phase 61 tests).

## Task Commits

Each task committed atomically:

1. **Task 1: processPid derives lastStopAt + lastStatusChangeAt server-side** — `2d29a734` (feat)
   - Touched: `src/backend/fleet-status/ssh-poll-orchestrator.ts` (141 additions)
   - PidCacheEntry extension + processPid derivation blocks + composed SessionState stamps + computeFingerprint extension + both livenessMap.set branch updates + logger call extension.
   - Scoped tests remained 88/88 green after this commit; backend build clean; no test additions in this commit (Task 2 provides those).

2. **Task 2: 6 new tests for Phase 61 lastStopAt + lastStatusChangeAt derivation** — `cf9ff531` (test)
   - Touched: `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (392 additions)
   - New describe block at end of file with 6 tests (P57-02-A through P57-02-F). Reused existing MockSshChannel + MockRegistry + makeSessionJson fixtures. No cache introspection — assertions target only the published SessionState frame.
   - Scoped tests 94/94 green after this commit.

_Note: No `refactor` step needed — the diffs are strictly additive and match the shape of prior additive-axis phases (recycling / dormant / aiTitle / lastMessageAt)._

## Files Created/Modified

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (Task 1) — PidCacheEntry gains three new fields; processPid gains two new derivation blocks (per-session Stop file mtime + status-delta) inserted between tmux-resolution and the Phase 52 dormant stat; composed SessionState stamps both new axes; computeFingerprint extended; both livenessMap.set branches updated; logger call gains forensic entries.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (Task 2) — appended a new describe block at end of file with 6 tests covering first-appearance seed, same-status preserve, transition bump, missing-vs-present per-session file, SSH-hiccup fail-open, and fingerprint delta on lastStopAt-only change.

## Verification

### Scoped test suite
```
$ npx vitest run src/backend/fleet-status/ssh-poll-orchestrator
Test Files  1 passed (1)
Tests       94 passed (94)
```
(88 pre-existing + 6 new Phase 61 tests)

### Backend build
```
$ NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend
> tsc -p tsconfig.node.json && node -e "require('fs').copyFileSync(...)"
(exit 0 — no output errors)
```

### Task 1 acceptance-criteria greps (all met)

| Grep | Threshold | Actual |
| --- | --- | --- |
| `grep -v '^ *//' ssh-poll-orchestrator.ts \| grep -c 'lastStopAt'` | ≥5 | **7** |
| `grep -v '^ *//' ssh-poll-orchestrator.ts \| grep -c 'lastStatusChangeAt'` | ≥5 | **7** |
| `grep -v '^ *//' ssh-poll-orchestrator.ts \| grep -c 'lastStatus:'` | ≥2 | **3** |
| `grep -c 'shellSingleQuote(sessionJson.sessionId)' ssh-poll-orchestrator.ts` | ≥1 | **1** |
| `grep -c 'state.lastStopAt' ssh-poll-orchestrator.ts` | ≥1 | **2** |
| `grep -c 'state.lastStatusChangeAt' ssh-poll-orchestrator.ts` | ≥1 | **2** |
| `sessionJson.updatedAt` NEW uses as lastStatusChangeAt source | 0 (Pitfall 4 guard) | **0** (only pre-existing `updatedAt: sessionJson.updatedAt` line + 2 comment references documenting the Pitfall) |

### Task 2 acceptance-criteria greps (all met)

| Grep | Threshold | Actual |
| --- | --- | --- |
| `grep -c 'Test P57-02-[A-F]' ssh-poll-orchestrator.test.ts` | ≥6 | **12** (each name appears in both the `it(...)` string and a documentation reference — 6 tests × 2 lines each) |
| `grep -c 'describe.*Phase 61' ssh-poll-orchestrator.test.ts` | ≥1 | **1** |
| `grep -c 'lastStopAt' ssh-poll-orchestrator.test.ts` | ≥8 | **32** |
| `grep -c 'lastStatusChangeAt' ssh-poll-orchestrator.test.ts` | ≥6 | **31** |

### All six new tests present and passing

| Test | Name | Result |
| --- | --- | --- |
| P57-02-A | first-appearance PID seeds lastStatusChangeAt to deps.now() and reads per-session mtime if present | ✅ |
| P57-02-B | same-status tick preserves cached lastStatusChangeAt (no bump) | ✅ |
| P57-02-C | status-transition tick bumps lastStatusChangeAt to deps.now() | ✅ |
| P57-02-D | per-session file missing → lastStopAt is null; presence → lastStopAt is mtime × 1000 | ✅ |
| P57-02-E | SSH hiccup on stat call preserves cached lastStopAt (fail-open) | ✅ |
| P57-02-F | fingerprint includes lastStopAt + lastStatusChangeAt — lastStopAt-only delta causes a new publish | ✅ |

## Decisions Made

None beyond the plan-listed decisions and the four in `key-decisions` frontmatter. Both tasks executed exactly as specified in the plan's `<action>` steps. Pattern A (sequential per-PID stat call) was used verbatim as recommended by Research § "Backend read pattern"; no reconsideration of Pattern B was warranted.

## Deviations from Plan

None. Plan executed exactly as written.

- **Rule 1 (auto-fix bugs):** not triggered. All pre-existing tests remained green after every increment.
- **Rule 2 (auto-add missing critical functionality):** not triggered — plan's action steps and threat model pre-covered every mitigation (T-61-02-01 through T-61-02-04 explicitly addressed in the code).
- **Rule 3 (auto-fix blocking issues):** not triggered.
- **Rule 4 (architectural questions):** not triggered.

**One minor implementation note (not a deviation):** The plan mentioned inserting the per-session Stop file mtime read "AFTER the `sessionJson = parseSessionJson(sessionJsonRaw)` null-check (line ~991) and AFTER the tmux-resolution block (line ~1015), BEFORE the dormant sentinel stat (line ~1038)." The actual insertion point ended up immediately before the dormant sentinel stat comment block (which starts at "Phase 52 Plan 01 Task 2 — source A dormant sentinel stat."), grouping the two Phase 61 derivations as a contiguous block ahead of the Phase 52 block. This is spatially inside the plan-specified window and matches the plan's intent (both new derivations grouped together, both stat-shape-similar to the dormant stat that follows immediately after).

## Issues Encountered

None.

## User Setup Required

None — no new packages installed, no external service configuration, no environment-variable changes. The plan's `<threat_model>` T-61-02-SC ("Package installs") explicitly notes "No new packages installed in this plan."

## Known Stubs

None. Every code path in the two new derivation blocks handles its full contract:
- Per-session stat: null (SSH hiccup) / empty (file absent) / non-numeric (bad output) / numeric — all four paths covered with fail-open semantics.
- Status-delta: isNew / cold-cache lastStatus / transition / same-status — all four branches covered with correct seeding/updating/preservation.

## Threat Flags

None. The plan's `<threat_model>` already covered every new surface (T-61-02-01 through T-61-02-04). The new SSH exec (`stat -c %Y …`) reuses the existing `SshChannel.exec` primitive with `shellSingleQuote(sessionJson.sessionId)` T-61-02-01 mitigation applied — no new trust boundary, no new network surface, no new auth path introduced.

## TDD Gate Compliance

This plan's `<task type="auto" tdd="true">` declarations are two-task per-file — Task 1 is source code (`ssh-poll-orchestrator.ts`) and Task 2 is tests (`ssh-poll-orchestrator.test.ts`). Because Task 1's PidCacheEntry / processPid extension makes the runtime path exist but the existing 88 tests do not exercise the new axes, the "RED gate" for the new-axis behavior is inherently deferred to Task 2. This is the same TDD-gate shape as prior additive-axis phases (52-Task-2 dormant / 53-Task-1 recycling) where the source and test tasks were committed sequentially in a `feat` → `test` cadence. Wave 1 (61-01) already established a full RED-then-GREEN cycle for the wire schema extension via its 10 new wire-protocol tests, so the phase's cumulative TDD gate compliance is intact.

## Next Phase Readiness

**61-03 unblocked** — the backend now populates both `lastStopAt` and `lastStatusChangeAt` on every SessionState frame source A publishes. The wire schema (Wave 1) accepts both as `z.number().nullable().optional()`. The frontend `SessionState` interface mirror (Wave 1) exposes both as `?: number | null`. Wave 3 (61-03) can now consume the two axes at the `main = busy || (shell && stopIsFresh)` predicate location in `src/ui/state/session-working-store.ts` line 207 without any backend-side blocking dependency.

**Rollout is still lazy per Phase 61 CONTEXT** — existing stale-shell sessions (Poppy, aqua, wilma) stay lit until their next real turn-end. Their next real turn-end fires the Wave 1 stop hook (which writes the per-session file for the first time), the backend's next 2s poll tick picks up the new file's mtime via this wave's stat, and lastStopAt is stamped for the first time. Combined with the Wave 3 frontend predicate, that flips the indicator off. Ashley's UAT (Poppy/aqua/wilma → next turn-end → indicator flips) becomes actionable once Wave 3 lands.

## Self-Check: PASSED

Verified all claims:

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — FOUND (modified in `2d29a734`).
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — FOUND (modified in `cf9ff531`).
- Commit `2d29a734` — FOUND in `git log`.
- Commit `cf9ff531` — FOUND in `git log`.
- Scoped test suite `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator` — 94/94 green.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` — exit 0.
- Every acceptance-criteria grep passes at or above threshold.

---
*Phase: 61-wip-indicator-shell-idle-gate*
*Completed: 2026-08-29*
