---
phase: 80
plan: 03
subsystem: backend/identities
tags: [identity-frontmatter, task-field, cosmetics, disk-authoritative, tdd, D-05, A3]
dependency_graph:
  requires:
    - phase: 66
      provides: "extractCosmeticsFromFrontmatter narrowing pattern + buildIdentityFileBody emission pattern (voice/title/avatar cosmetics)"
    - phase: 68
      provides: "publicIdentity DTO shape + disk-fanout GET /identities handler"
  provides:
    - "extractCosmeticsFromFrontmatter narrows task?: string via voice/title-shape guard"
    - "publicIdentity emits task: string | null on every identity"
    - "BirthOptions.task?: string (optional, write-once at birth per D-05)"
    - "buildIdentityFileBody emits task frontmatter key after avatar (absent-⇒-omit)"
    - "POST /identities/birth accepts + validates task (nullable optional string, ≤500 chars)"
    - "POST /identities/clone accepts + validates task (fresh per spawn — never inherits source.task per A3)"
  affects:
    - "Plan 80-05 (frontend Identity.task type) — GET /identities response body now includes task field"
    - "Plan 80-07 (chat surface task pill) — pvIdentity.task drives pill render gate"
    - "Plan 80-08 (conversation list task-primary row) — identity.task drives row layout gate"
tech_stack:
  added: []
  patterns:
    - "extractCosmeticsFromFrontmatter task narrowing (mirror of voice/title): typeof string + length > 0 → keep; else drop"
    - "buildIdentityFileBody task emission (mirror of voice/title): typeof string + trim().length > 0 → push; else omit"
    - "publicIdentity task fallback (mirror of voice/title): typeof string → value; else null"
    - "identity-birth / identity-clone task body validation (mirror of colorHue/voice nullable-optional shape): nullable OR string; ≤500 chars hard-cap"
    - "A3 regression guard by absence: grep -cE 'source(Identity)?\\.task|sourceCosmetics\\.task' src/backend/database/routes/identity-clone.ts → 0"
key_files:
  created: []
  modified:
    - "src/backend/claude-session/identity-artifact-reader.ts (extend extractCosmeticsFromFrontmatter return type + narrowing chain)"
    - "src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts (add 5 TASK-* cases)"
    - "src/backend/database/routes/identities.ts (extend publicIdentity cosmetics arg + emit task on returned object)"
    - "src/backend/database/routes/identities.get-disk.test.ts (add 3 PUB-* cases + 2 Fanout-task-* cases + mock task narrowing)"
    - "src/backend/database/routes/identity-birth-orchestrator.ts (extend BirthOptions.task?: string + emit ['task', opts.task] in buildIdentityFileBody after avatar)"
    - "src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts (add 5 T-80-03-* cases: present, empty, whitespace, undefined, colon-round-trip)"
    - "src/backend/database/routes/identity-birth.ts (destructure task from body, validate nullable+cap, thread parsedTask ?? undefined through birthIdentity opts)"
    - "src/backend/database/routes/identity-birth.test.ts (add 5 T-80-03-birth-* cases)"
    - "src/backend/database/routes/identity-clone.ts (destructure task from body, validate nullable+cap, push ['task', parsedTask] onto cloneFrontmatterPairs after avatar)"
    - "src/backend/database/routes/identity-clone.test.ts (add 6 T-80-03-clone-* cases including A3 regression asserting request task overrides source's on-disk task)"
decisions:
  - "task hard-cap 500 chars on server (defense-in-depth vs frontend soft-cap ~200 chars) — T-80-03-02 DoS mitigation"
  - "task validation lands BEFORE flushHeaders in identity-birth.ts — 400s emit as JSON, not as SSE frames (RESEARCH §7 landmine preserved)"
  - "task emitted AFTER avatar in buildIdentityFileBody (per plan spec) — canonical ordering keyed off the existing role/displayName/title/colorHue/voice/avatar sequence"
  - "yaml.dump forceQuotes:false left unchanged — auto-quoting handles YAML metachars in task strings (colons, quotes) per T-66-01-04 precedent; round-trip test asserts preservation"
  - "Clone A3 lock enforced by absence: identity-clone.ts contains zero source.task / sourceIdentity.task / sourceCosmetics.task reads (grep gate passes with 0 hits); regression test asserts request task 'fresh' emits even when source frontmatter carries task 'original'"
  - "Empty/whitespace-only task strings are silently omitted from frontmatter (absent-⇒-omit invariant) rather than throwing 400 — matches voice/title semantic"
patterns-established:
  - "Cosmetics scalar extension pattern (Phase 66 precedent): (a) narrowing case in extractCosmeticsFromFrontmatter, (b) type + null-fallback in publicIdentity, (c) BirthOptions optional field, (d) buildIdentityFileBody pair-push, (e) route body validator, (f) test cases across all 5 files. Applied here for task; ready for future cosmetics scalars."
  - "A3 regression guard by absence: grep for source-field reads in clone handler must return 0; comments describing the absence must avoid the literal grep pattern to keep the gate hermetic."
requirements-completed: []
metrics:
  duration: "~14 min"
  completed: "2026-09-06T14:15:52Z"
tasks_completed: 3
tasks_total: 3
files_created: 0
files_modified: 10
---

# Phase 80 Plan 03: task field end-to-end wiring Summary

**Task frontmatter scalar wired end-to-end through Skynet backend disk-read / write / emit path — additive extension of Phase 66 cosmetics pattern for voice/title/avatar, implementing D-05 (write-once, disk-only, no DB caching) and A3 lock (clone gets fresh task, never inherits source.task).**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-06T14:02:02Z
- **Completed:** 2026-09-06T14:15:52Z
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 10 (5 source + 5 test)

## Accomplishments

- `extractCosmeticsFromFrontmatter` narrows `task?: string` per existing voice/title pattern; parse-error swallow at outer try/catch preserved (RESEARCH §5 landmine)
- `publicIdentity` emits `task: string | null` on every returned identity (D-05 write-once semantics; disk-only, no DB caching)
- `BirthOptions.task?: string` optional; `buildIdentityFileBody` emits `task:` frontmatter key after `avatar:` when non-empty-after-trim (absent-⇒-omit)
- `POST /identities/birth` + `POST /identities/clone` both accept + validate task (nullable optional string, ≤500 chars hard-cap); validation errors surface as JSON before SSE opens
- Clone endpoint enforces A3 lock: `parsedTask` sourced from request body only, NEVER copied from source identity's on-disk frontmatter; regression test asserts fresh-task-wins-over-source-task
- YAML dump options unchanged (`forceQuotes: false` + `sortKeys: false` + `lineWidth: -1` + `noRefs: true`) — task strings with YAML metacharacters (colons, quotes) round-trip via `yaml.load` correctly (T-66-01-04 precedent, T-80-03-01 mitigation)
- Atomic-write invariant preserved (RESEARCH §12): task lands as part of the single `buildIdentityFileBody` string that goes to `writeMarkdownFileAtomic` — no separate write step, no new SSE step number

## Task Commits

Each task followed TDD RED → GREEN cycle:

1. **Task 1: extractCosmeticsFromFrontmatter + publicIdentity for task**
   - RED: `0e09a7e0` — `test(80-03)` — 10 failing tests added (5 narrowing + 3 PUB + 2 fanout)
   - GREEN: `67b81c8b` — `feat(80-03)` — narrowing + emission implemented; 43/43 tests pass

2. **Task 2: BirthOptions.task + buildIdentityFileBody emission**
   - RED: `3d53bfd1` — `test(80-03)` — 5 failing tests added (present, empty, whitespace, undefined, colon-round-trip)
   - GREEN: `1f2f5173` — `feat(80-03)` — BirthOptions field + pair-push after avatar; 22/22 tests pass

3. **Task 3: identity-birth + identity-clone POST body validation**
   - RED: `f7d3f959` — `test(80-03)` — 11 failing tests added (5 birth + 6 clone including A3 regression)
   - GREEN: `53c16e54` — `feat(80-03)` — body destructure + validation + parsedTask threading + cloneFrontmatterPairs push; 40/40 tests pass

## Files Created/Modified

**Source (5):**
- `src/backend/claude-session/identity-artifact-reader.ts` — extend `extractCosmeticsFromFrontmatter` return-type + narrowing chain with `task?: string`
- `src/backend/database/routes/identities.ts` — extend `publicIdentity` cosmetics arg + emit `task: typeof cosmetics.task === "string" ? cosmetics.task : null`
- `src/backend/database/routes/identity-birth-orchestrator.ts` — extend `BirthOptions` with `task?: string`; push `["task", opts.task]` in `buildIdentityFileBody` after avatar (absent-⇒-omit)
- `src/backend/database/routes/identity-birth.ts` — destructure `task` from body, validate (nullable optional + ≤500 chars) BEFORE `flushHeaders`, thread `parsedTask ?? undefined` through `birthIdentity` opts
- `src/backend/database/routes/identity-clone.ts` — destructure `task` from body, mirror validation, push `["task", parsedTask]` onto `cloneFrontmatterPairs` after avatar; A3 lock enforced by absence (no source.task read)

**Test (5):**
- `src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts` — 5 TASK-* cases
- `src/backend/database/routes/identities.get-disk.test.ts` — 3 PUB-* cases + 2 Fanout-task-* cases + mock task narrowing
- `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` — 5 T-80-03-* cases (colon round-trip via yaml.load asserts T-80-03-01 mitigation)
- `src/backend/database/routes/identity-birth.test.ts` — 5 T-80-03-birth-* cases
- `src/backend/database/routes/identity-clone.test.ts` — 6 T-80-03-clone-* cases including A3 regression

## Acceptance criteria (all green)

**Task 1:**

| Criterion | Expected | Actual |
|---|---|---|
| `grep -c "task" src/backend/claude-session/identity-artifact-reader.ts` | ≥ 2 | 7 |
| `grep -c 'typeof src.task === "string"'` on identity-artifact-reader.ts | 1 | 1 |
| `grep -c 'task: typeof cosmetics.task'` on identities.ts | 1 | 1 |
| `grep -c 'task?: string'` on identities.ts | ≥ 1 | 1 |
| Parse-error swallow preserved (`return {}` after yaml.load try) | ≥ 1 | 1 |
| Task-tagged tests in identity-artifact-reader.avatar-read.test.ts (`-t "task"`) | ≥ 4 | 5 |
| identities.get-disk.test.ts total | all pass | 24/24 |

**Task 2:**

| Criterion | Expected | Actual |
|---|---|---|
| `grep -c 'task?: string' src/backend/database/routes/identity-birth-orchestrator.ts` | ≥ 1 | 1 |
| `grep -c 'pairs.push(\["task"' src/backend/database/routes/identity-birth-orchestrator.ts` | 1 | 1 |
| `grep -c 'opts.task.trim().length > 0'` on identity-birth-orchestrator.ts | 1 | 1 |
| `forceQuotes: false` unchanged | baseline preserved | 2 (unchanged) |
| task pair-push after avatar pair-push (line order) | task line > avatar line | 385 > 379 |
| Task-tagged tests in role-frontmatter.test.ts (`-t "task"`) | ≥ 5 | 5 (T-80-03-a..e) |
| No new SSE step introduced (`step: N:` count unchanged) | baseline | 3 (unchanged) |

**Task 3:**

| Criterion | Expected | Actual |
|---|---|---|
| `grep -c 'task must be a string or null'` on identity-birth.ts | 1 | 1 |
| `grep -c 'task must be ≤500 chars'` on identity-birth.ts | 1 | 1 |
| `grep -c 'task must be a string or null'` on identity-clone.ts | 1 | 1 |
| `grep -c 'task must be ≤500 chars'` on identity-clone.ts | 1 | 1 |
| `grep -c 'parsedTask'` on identity-birth.ts | ≥ 2 | 3 |
| `grep -c 'cloneFrontmatterPairs.push(\["task"'` on identity-clone.ts | 1 | 1 |
| task validation lands BEFORE `flushHeaders` (line order) | task lines < flushHeaders lines | 147, 151 < 192, 373 |
| Task-tagged tests in identity-birth.test.ts (`-t "task"`) | ≥ 4 | 5 (T-80-03-birth-a..e) |
| Task-tagged tests in identity-clone.test.ts (`-t "task"`) | ≥ 5 | 6 (T-80-03-clone-a..f) |
| **A3 regression grep gate:** `grep -cE 'source(Identity)?\.task\|sourceCosmetics\.task'` on identity-clone.ts | **0** | **0** |

## Verification

- `npx vitest run src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts src/backend/database/routes/identities.get-disk.test.ts src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts src/backend/database/routes/identity-birth.test.ts src/backend/database/routes/identity-clone.test.ts` → **105/105 pass**, exit 0
- No new npm dependencies added (no `package.json` diff)
- Sequential mode: no worktree / no push / no docker

## Landmines preserved

| # | Landmine | How preserved |
|---|----------|---------------|
| §5 | Frontmatter YAML parse-error swallow returns `{}` | Outer try/catch at extractCosmeticsFromFrontmatter L2106-2110 UNTOUCHED; TASK-5 test regression-guards it |
| §7 | Fail-early 503 gate + 400 validation before SSE flush | New task validation lands at identity-birth.ts:145-152 (BEFORE flushHeaders at L192); test T-80-03-birth-c/d assert 400 JSON not SSE frames |
| §12 | Birth-orchestrator atomic-write invariant (single string → writeMarkdownFileAtomic) | task pushed onto `pairs` array; single `yaml.dump` + template literal call; no new write step introduced |
| §12 | Birth-orchestrator Q2 no-rollback (partial-tolerated) | Nothing changed in step failure semantics — task is just one more pair in the atomic string |
| — | No new SSE step number introduced | grep for `step: N:` in orchestrator unchanged (3, same baseline) |

## Threat model mitigations verified

| Threat ID | Category | Mitigation | Verified via |
|---|---|---|---|
| T-80-03-01 | Tampering (YAML injection via task string) | `yaml.dump` with `forceQuotes:false` auto-quotes YAML metachars | Test T-80-03-e: `task="fix the pool: shape gate"` → `yaml.load(match[1]).task === "fix the pool: shape gate"` (round-trip preserved) |
| T-80-03-02 | DoS (oversized task string) | Server hard-cap `task.length > 500` → 400 | Tests T-80-03-birth-d + T-80-03-clone-d assert 501-char body → 400 with error containing "500" |
| T-80-03-03 | Info Disclosure (parse errors leak to frontend) | Outer try/catch swallow at extractCosmeticsFromFrontmatter returns `{}` on parse fail; publicIdentity emits `task: null` | TASK-5 test asserts malformed YAML → `{}` returned |
| T-80-03-04 | EoP (clone body overrides permissions) | N/A — task is display metadata, not auth material | Accepted, not tested |
| T-80-03-05 | Tampering (mid-flight write leaves partial state) | Task lands as part of single atomic string via writeMarkdownFileAtomic (ext_openssh_rename) | No code path change — Task 2 preserved single-string invariant |
| T-80-03-06 | Tampering (clone inherits source.task) | Clone handler NEVER reads source.task; grep gate returns 0 hits; regression test asserts request task wins | Test T-80-03-clone-f: source frontmatter task="original task" + body task="fresh task" → emitted contains "fresh task", NOT "original task" |

## Deviations from Plan

None — plan executed exactly as written. Zero deviation rules triggered. No auth gates. No checkpoints. No follow-up bounties.

One minor comment-wording adjustment during Task 3 GREEN: the A3-lock explanatory comments in identity-clone.ts originally contained the literal phrase `source.task` (referring to what the code does NOT do), which tripped the A3 grep gate (`grep -cE 'source(Identity)?\.task|sourceCosmetics\.task'` returned 2 instead of 0). Reworded three comments to describe the invariant without repeating the grep pattern — grep gate now returns 0. This is a documentation micro-edit, not a behavior change; all Task 3 tests remained passing throughout.

## Issues Encountered

None — TDD cycle progressed cleanly for all three tasks. Each RED test set exercised the correct absence-of-implementation failure mode; each GREEN implementation made only the additive edits described in PATTERNS.md § "Frontmatter scalar narrowing" and § "Frontmatter scalar emission on birth".

## Next Phase Readiness

- **Plan 80-03b** can now proceed with MXID handle derivation (`<PoolName>-<Role>[-N]` shape) — the task field wiring is orthogonal and does not touch MXID composition.
- **Plan 80-05** (frontend Identity.task type) can proceed against the new GET /identities response body shape — every returned identity now carries `task: string | null`.
- **Plans 80-07 (chat surface task pill) + 80-08 (conversation list task-primary row)** can gate on `identity.task` truthy per D-06 fallback semantics; the fallback ("no pill" / "name-primary row") continues to work identically for identities without a task on disk.
- Existing identities on disk without a `task:` frontmatter key continue to surface as `task: null` in the GET /identities response (backward-compat preserved for pre-Phase-80 identities).

## Self-Check: PASSED

- `src/backend/claude-session/identity-artifact-reader.ts` — FOUND (contains `task?: string` in return type + narrowing guard)
- `src/backend/database/routes/identities.ts` — FOUND (contains `task: typeof cosmetics.task === "string" ? cosmetics.task : null`)
- `src/backend/database/routes/identity-birth-orchestrator.ts` — FOUND (contains `task?: string` in BirthOptions + `pairs.push(["task", opts.task])` after avatar)
- `src/backend/database/routes/identity-birth.ts` — FOUND (contains `task must be a string or null` + `task must be ≤500 chars` + `parsedTask`)
- `src/backend/database/routes/identity-clone.ts` — FOUND (contains same validation strings + `cloneFrontmatterPairs.push(["task", parsedTask])`; A3 grep gate = 0)
- All 5 test files extended (verified via `-t "task"` counts ≥ 4 per file where applicable)
- Commits `0e09a7e0`, `67b81c8b`, `3d53bfd1`, `1f2f5173`, `f7d3f959`, `53c16e54` — FOUND (all in git log)

---
*Phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool*
*Completed: 2026-09-06*
