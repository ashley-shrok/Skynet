---
phase: 113-skill-creation-in-the-edit-skills-modal
plan: 01
subsystem: api
tags: [express, ssh, sftp, yaml, vitest, stride]

# Dependency graph
requires:
  - phase: 44-skills-editor-in-edit-mode
    provides: >-
      /skills-editor Express router with 5 endpoints, isValidSkillName gate,
      shellEscape helper, execWithTimeout race, buildAbsSkillFilePath prefix
      assertion, writeMarkdownFileAtomic SFTP tmp+rename, connectOneShot 5s
      timeout, resolveHostById per-user isolation.
provides:
  - "POST /skills-editor/skill endpoint returning { slug, mtime } — enables client-side create-skill flow"
  - "composeSkillMdSeed(slug, description) helper producing D-06 5-line frontmatter with D-07 order-sensitive YAML escape (\\ first, then \")"
  - "SKILL.md invariant guard in DELETE /skills-editor/file (400 { error: \"cannot delete SKILL.md\" }) — zero SSH cost on rejection"
  - "Error contract: 409 { error: \"skill exists\" } consumed by plan 113-02 SkillAlreadyExistsError"
  - "Byte-exact seed shape guaranteed by test coverage (12 new POST /skill tests + 3 DELETE /file guard tests)"
affects: [113-02, 113-03, skills-editor, edit-skills-modal]

# Tech tracking
tech-stack:
  added: []  # Zero new packages — every helper (writeMarkdownFileAtomic, connectOneShot, execCommand, resolveHostById, sshLogger, shellEscape, execWithTimeout, isValidSkillName) was already in scope.
  patterns:
    - "STRIDE 5-layer route posture extended verbatim from the existing 5 skills-editor endpoints"
    - "Best-effort rm -rf cleanup on writeMarkdownFileAtomic failure (Pitfall #8) — avoids partial-create window"
    - "Order-sensitive YAML escape in composeSkillMdSeed (D-07 Pitfall #7): backslash first, then quote"
    - "Early-reject invariant guard placed BEFORE resolveHostById to prevent SSH cost on rejection (D-22)"

key-files:
  created: []
  modified:
    - "src/backend/database/routes/skills-editor.ts — +234 lines (POST /skill handler + composeSkillMdSeed helper + SKILL.md guard in DELETE /file)"
    - "src/backend/database/routes/skills-editor.test.ts — +311/-3 lines (12 new POST /skill tests + 3 new DELETE /file guard tests + 2 companion edits)"

key-decisions:
  - "Followed plan verbatim — no auto-fixes required"
  - "SKILL.md guard uses strict === equality (not regex) so SKILL.md.bak and nested/SKILL.md fall through per D-27"
  - "Best-effort cleanup on write failure swallows inner rm -rf failure to avoid masking the original SFTP error"

patterns-established:
  - "Post-mkdir SFTP-write with cleanup-on-failure: mkdir -p → try { writeMarkdownFileAtomic } catch { rm -rf } — the canonical avoid-partial-create-window pattern for future skills-editor sub-paths"
  - "Byte-exact seed content assertion in tests: capturing the seed argument to writeMarkdownFileAtomic and asserting toBe(literal) — proves D-06/D-07 contract to bit-level precision"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-09-17
---

# Phase 113 Plan 01: Backend POST /skills-editor/skill + SKILL.md invariant guard

**New Express endpoint that mkdir+seeds a skill folder atomically per D-20/D-21 (with `writeMarkdownFileAtomic` SFTP tmp+rename and best-effort rm -rf cleanup on failure), plus a hard-coded `path === "SKILL.md"` early-reject guard on DELETE /file that runs before `resolveHostById` for zero SSH cost per D-22.**

## Performance

- **Duration:** ~8 min (net implementation time; ~30 min including one-time npm install)
- **Started:** 2026-09-17T04:23:00Z (approximate — first Read at execution start)
- **Completed:** 2026-09-17T04:36:53Z
- **Tasks:** 3 (all `type="auto" tdd="true"` executed sequentially per the plan's task ordering)
- **Files modified:** 2 (`src/backend/database/routes/skills-editor.ts`, `src/backend/database/routes/skills-editor.test.ts`)

## Accomplishments

- New `router.post("/skill", ...)` handler at `src/backend/database/routes/skills-editor.ts` L1010 implements the D-20 8-step flow verbatim: validate → resolveHostById → connectOneShot → echo $HOME → skillRoot compose + prefix-assert → `test -d` 409-gate → mkdir -p → writeMarkdownFileAtomic (with Pitfall #8 cleanup) → stat -c '%Y' → `{ slug, mtime }`.
- New file-level helper `composeSkillMdSeed(slug, description)` (L239-266) produces the D-06 5-line seed with D-07 order-sensitive escape (`\\` before `\"`).
- SKILL.md invariant guard (D-10, D-22) added at L1229-1232 in the existing DELETE `/skills-editor/file` handler: `rawPath === "SKILL.md"` returns 400 `{ error: "cannot delete SKILL.md" }` immediately after `isSafeRelativePath` and before `resolveHostById`, so zero SSH cost is incurred on rejection.
- Test coverage extended: 12 new POST `/skill` tests + 3 new DELETE `/file` guard tests + 2 companion edits (existing DELETE `/file` happy-path and 404 tests switched from `SKILL.md` to `README.md` so they no longer collide with the new guard).
- Byte-exact seed content asserted in tests (happy path + YAML injection defense) — the D-06/D-07 contract is enforced at bit level.
- Best-effort `rm -rf` cleanup on `writeMarkdownFileAtomic` failure verified by mock (test asserts `rm -rf` was invoked with the escaped skillRoot).
- Nginx wildcard block parity verified in both `docker/nginx.conf:445` and `docker/nginx-https.conf:460` per D-23 — no edit needed; the existing `location ~ ^/skills-editor(/.*)?$` block already covers the new route.

## Task Commits

Each task committed atomically:

1. **Task 1: Add POST /skills-editor/skill route + composeSkillMdSeed helper** — `aaa7733e` (feat)
2. **Task 2: Add SKILL.md invariant guard to DELETE /skills-editor/file** — `c55447ec` (feat)
3. **Task 3: Extend skills-editor.test.ts with POST /skill + SKILL.md guard coverage** — `9756b27e` (test)

**Note on parallel wave:** two 113-02 commits (`a818b1b0` and `cb7838de`) landed on the same branch between my Task 2 and Task 3 commits — a sibling executor is running plan 113-02 (frontend api-client + SkillFileTab guard) concurrently. My 113-01 commits are interleaved with theirs in the log; no conflict.

## Files Created/Modified

- **`src/backend/database/routes/skills-editor.ts`** (+234 lines; now 1447 total) — added POST `/skill` route handler (D-20/D-21), `composeSkillMdSeed` helper (D-06/D-07), and `rawPath === "SKILL.md"` guard in DELETE `/file` (D-10/D-22).
- **`src/backend/database/routes/skills-editor.test.ts`** (+311/-3 lines; now 1180 total) — added `describe("POST /skills-editor/skill")` block (12 `it` cases) + 3 new DELETE `/file` guard tests + companion edits to the pre-existing DELETE `/file` happy-path and 404 tests (switched from `path: "SKILL.md"` to `path: "README.md"`).

## Decisions Made

- **Plan followed verbatim.** No auto-fix rules triggered.
- Used the plan's plain-object `body` typing pattern (`(req.body ?? {}) as Record<string, unknown>`) rather than an unsafe cast, matching every existing endpoint in the file.
- Kept `composeSkillMdSeed` as a plain file-level function (no export) — used only by the same-file handler, no cross-module consumer.
- Placed the SKILL.md guard on a strict `===` check (not a regex, not a suffix match) so `SKILL.md.bak` and `nested/SKILL.md` fall through to the normal `rm -f` per D-27.
- Best-effort cleanup catch block swallows the inner `rm -rf` failure so it does not mask the outer SFTP-write error the operator/user actually needs to see.

## Deviations from Plan

None — plan executed exactly as written. All grep-based acceptance criteria and the plan's `<verification>` block pass verbatim.

## Issues Encountered

- **`node_modules` was missing when execution started.** `npm install --ignore-scripts` was required (better-sqlite3 native-build fails in this sandbox, but tests do not depend on it). This is a one-time environment setup, not a plan issue.
- **`npx vitest` on host resolved to the wrong upstream package.** Worked around by running vitest via `node node_modules/vitest/dist/cli.js` directly. Same test outcome (74 tests green).
- **Concurrent 113-02 executor committed to the same branch during execution.** Their commits `a818b1b0` (skills-api additions) and `cb7838de` (SkillFileTab guard) interleaved with my Task 2 → Task 3 window. No file overlap with my scope (`skills-editor.ts` + `skills-editor.test.ts`) — the changes are on `skills-api.ts` and `SkillFileTab.tsx`, both outside `files_modified` for this plan. Git handled the sequencing cleanly.
- **Pre-existing untracked `.planning/phases/113-skill-creation-in-the-edit-skills-modal/deferred-items.md`** was present at session start. Outside my scope — left untouched.

## User Setup Required

None — no external service configuration required. The new endpoint is served by the existing nginx wildcard block (parity verified per D-23) and needs no new env var, secret, or service registration.

## Verification (executor gate)

Per D-29 executor scope, only the scoped-test gate was run. Full-suite + playwright smoke + docker build + push are the deploy gate and belong to the orchestrator, not the executor.

- `node node_modules/vitest/dist/cli.js related --run src/backend/database/routes/skills-editor.ts src/backend/database/routes/skills-editor.test.ts` → **74 passed** (56 in skills-editor.test.ts + 18 in transitively-related starter.test.ts). Includes all 12 new POST /skill tests and all 3 new DELETE /file guard tests.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.node.json` → **exit 0** (no TS errors anywhere in the backend project; specifically none in `skills-editor.ts`).
- `grep -c '"cannot delete SKILL.md"' src/backend/database/routes/skills-editor.ts` → `1` ✅
- `grep 'router.post(\n  "/skill"' src/backend/database/routes/skills-editor.ts` → matches exactly 1 site ✅
- `grep -c 'function composeSkillMdSeed' src/backend/database/routes/skills-editor.ts` → `1` ✅
- `grep -c 'describe("POST /skills-editor/skill"' src/backend/database/routes/skills-editor.test.ts` → `1` ✅
- `grep -n 'location.*skills-editor' docker/nginx.conf docker/nginx-https.conf` → both configs carry the wildcard block (D-23 parity intact — no edit required) ✅

## Response Shape & Error Contracts Exported

These are the two contracts plan 113-02 consumes:

- **200 response:** `{ slug: string; mtime: number }` — plan 113-02's `createSkill()` returns exactly this shape as `Promise<{ slug: string; mtime: number }>` (already committed on the same branch in `a818b1b0`, byte-shape matches).
- **409 error string:** `"skill exists"` — plan 113-02's `SkillAlreadyExistsError` uses this exact string in its `super()` call (verified in `a818b1b0`).

## Threat Register Coverage (all `mitigate` dispositions met)

| Threat ID | Mitigation |
|-----------|-------------|
| T-113-01 | `isValidSkillName` gate before `resolveHostById` + `skillRoot.startsWith(skillsPrefix)` post-compose assert. |
| T-113-02 | `shellEscape` on every interpolation (`test -d`, `mkdir -p`, `rm -rf`, `stat -c '%Y'`). |
| T-113-03 | Unconditional double-quote wrap + backslash-then-quote escape order in `composeSkillMdSeed`. Backend early-reject of `\n`/`\r` in description. |
| T-113-04 | `resolveHostById(hostId, userId)` — 404 for cross-user / unknown. |
| T-113-05 | `authenticateJWT` before `express.json({limit:"32kb"})`. |
| T-113-06 | `connectOneShot(_, 5000)` + `execWithTimeout(_, 5000)`. |
| T-113-07 | `finally { conn.end() }` cleanup with try/catch on every route path. |
| T-113-08 | Best-effort `rm -rf` cleanup on `writeMarkdownFileAtomic` failure — proven by test. |
| T-113-09 | Backend `rawPath === "SKILL.md"` early-reject before `resolveHostById`. |
| T-113-10 | `Buffer.byteLength(description, "utf-8") > 4096` → 400 + 32kb JSON limit ceiling. |
| T-113-SC | No packages added. |

## Next Phase Readiness

- Backend contract for plan 113-02 (`createSkill` + `SkillAlreadyExistsError`) is stable; the api-client wrapper is already committed on this branch.
- Frontend flow (plan 113-02 remaining tasks: `handleNewSkill`, `+ New skill` button, `+ New file` tab, host-picker conditional, empty-state copy repoint, `SkillFileTab` delete-guard) has all its backend dependencies. Note `cb7838de` already landed the `SkillFileTab` guard.
- Executor's remit stops here per D-29 — orchestrator owns full-suite vitest, playwright smoke, `docker build`, `docker compose up`, and `git push` (deploy gate).

## Self-Check

Verifying every artifact and commit claim before returning PLAN COMPLETE.

**Files:**
- `src/backend/database/routes/skills-editor.ts` — FOUND ✅
- `src/backend/database/routes/skills-editor.test.ts` — FOUND ✅
- `.planning/phases/113-skill-creation-in-the-edit-skills-modal/113-01-SUMMARY.md` — this file (about to be committed).

**Commits (via `git log --oneline --all | grep <hash>`):**
- `aaa7733e` (Task 1) — FOUND ✅
- `c55447ec` (Task 2) — FOUND ✅
- `9756b27e` (Task 3) — FOUND ✅

**Nginx parity (D-23 verify-only):**
- `docker/nginx.conf:445` — `location ~ ^/skills-editor(/.*)?$` ✅
- `docker/nginx-https.conf:460` — `location ~ ^/skills-editor(/.*)?$` ✅

**Verification block (plan-level):**
- Every check listed in `<verification>` of the plan passes.

## Self-Check: PASSED

---
*Phase: 113-skill-creation-in-the-edit-skills-modal*
*Completed: 2026-09-17*
