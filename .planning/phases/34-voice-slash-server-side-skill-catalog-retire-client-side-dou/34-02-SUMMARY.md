---
phase: 34-voice-slash-server-side-skill-catalog-retire-client-side-dou
plan: 02
subsystem: backend/voice
tags: [backend, ssh, voice-slash, fail-open, wave-1]
requires:
  - src/backend/ssh/ssh-one-shot.ts (connectOneShot pattern)
  - src/backend/ssh/tmux-helper.ts (execCommand primitive)
  - src/backend/ssh/host-resolver.ts (resolveHostById per-user scoping)
  - src/backend/utils/logger.ts (sshLogger)
provides:
  - fetchSkillCatalog(hostId, userId, timeoutMs?) → Promise<Set<string>>
  - DEFAULT_SKILL_CATALOG_TIMEOUT_MS = 10_000
affects:
  - Plan 34-03 (will import both symbols to wire the STT route wake-word HIT path)
tech-stack:
  added: []
  patterns:
    - "one-shot SSH fetch with Promise.race outer deadline + finally-block conn.end() cleanup (sessions.ts:65-149 pattern verbatim)"
    - "fail-open contract: ANY failure → resolves to empty Set, never throws"
    - "defense-in-depth parse filter (kebab-case regex drops malformed dir entries at the parse boundary — T-34-02-01 mitigation)"
key-files:
  created:
    - src/backend/voice/skill-catalog.ts
    - src/backend/voice/skill-catalog.test.ts
  modified: []
decisions:
  - "Rule 2 tightening: fail-open guard extended to cover resolveHostById throws (plan enumerates 'resolveHostById returning null' as fail-open; invariant #1 says NEVER throws — extending the try/catch upstream satisfies both must-haves without changing the public contract)"
metrics:
  duration: "30m 54s"
  completed: "2026-08-13T02:56:31Z"
  tasks_total: 2
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  tests_added: 13
  tests_passing_full_suite: 2024
---

# Phase 34 Plan 02: SSH-Fetch Skill Catalog Summary

Ship a fail-open SSH fetcher module `src/backend/voice/skill-catalog.ts` (+ vitest coverage) that resolves the target box's user-wide `~/.claude/skills/` catalog into a `Set<string>` — the backend I/O layer that Plan 34-03 will call after the STT wake-word gate hits.

## What Shipped

### `src/backend/voice/skill-catalog.ts` (215 lines)

**Public exports:**
- `DEFAULT_SKILL_CATALOG_TIMEOUT_MS = 10_000` — the CONTEXT.md-locked "generous 10s deadline" on the SSH round-trip. Exported so Plan 34-03 can import + reuse the same constant.
- `fetchSkillCatalog(hostId: number, userId: string, timeoutMs?: number): Promise<Set<string>>` — SSH-fetches the target host's `~/.claude/skills/` directory, parses stdout, returns a kebab-case-filtered Set of skill names.

**Implementation pattern (mirrors `sessions.ts:65-149` verbatim):**
1. `resolveHostById(hostId, userId)` → null-short-circuits to empty Set (fail-open).
2. `connectOneShot(resolved, timeoutMs)` — one-shot SSH connection, bounded by `timeoutMs` for connect + readyTimeout.
3. `Promise.race([execCommand(conn, "ls -1 ~/.claude/skills/ 2>/dev/null"), setTimeout-reject-at-timeoutMs])` — outer deadline that bounds connect+exec together, so a hung exec channel cannot block the caller past `timeoutMs`.
4. Parse stdout: `split(/\r?\n/)` → per-line trim → drop empty → filter to `/^[a-z0-9-]+$/` (kebab-case). Return `new Set<string>(names)`.
5. `finally { conn?.end() }` in its own try/catch — connection ALWAYS closed, even when exec threw.

**Fail-open contract:** ANY failure — `resolveHostById` returning null OR throwing, `connectOneShot` reject, `execCommand` reject, outer `Promise.race` timeout, unparseable output — resolves to `new Set<string>()`. NEVER throws to the caller. Warn-level logging only (SSH failures on per-invocation fetches are expected/benign by design — Ashley 2026-08-13 in 34-CONTEXT.md § Decisions).

### `src/backend/voice/skill-catalog.test.ts` (13 vitest cases across 2 describe blocks)

Mocks the three SSH primitives (`connectOneShot`, `execCommand`, `resolveHostById`) via `vi.mock` at module scope + silences `sshLogger`. Every fail-open branch asserts `.resolves.toEqual(new Set())` — assertion shape that fails loudly if the SUT ever throws.

**Happy-path (6):**
1. Baseline: returns `Set(["gsd", "gsd-quick", "explain", "bounty", "queue"])` from realistic `ls` output. Asserts `conn.end()` called exactly once (cleanup ran).
2. Kebab-case filter drops CAPS/.hidden/spaces/UPPER-CASE entries.
3. Trims trailing/leading whitespace per line.
4. Tolerates CRLF line endings.
5. Default `timeoutMs` is `DEFAULT_SKILL_CATALOG_TIMEOUT_MS` (10000).
6. Custom `timeoutMs` passed through to `connectOneShot`.

**Fail-open (7):**
1. `resolveHostById` returns null → empty Set + `connectOneShot` not called.
2. `connectOneShot` rejects → empty Set + `execCommand` not called.
3. `execCommand` rejects → empty Set + `conn.end()` still called (finally cleanup ran despite exec failure).
4. Empty stdout (fresh box, no skills dir) → empty Set (clean happy path).
5. Output with ONLY non-kebab-case entries → empty Set (parse-filter drops everything).
6. `Promise.race` timeout branch fires (with `vi.useFakeTimers()` + `advanceTimersByTimeAsync`) → empty Set + `conn.end()` called.
7. `resolveHostById` throws (DB fault) → empty Set + `connectOneShot` not called (invariant #1: NEVER throws).

## Verification

- `npm run build:backend` → exit 0. No TypeScript errors.
- `npx vitest run src/backend/voice/skill-catalog.test.ts` → 13 passed, 0 failed.
- `npx vitest run` (full suite, verbose reporter) → **156 files pass, 2024 tests pass, 6 skipped, 1 todo, ZERO failures**. Duration 577s.
- Acceptance grep checks (Task 1): all 8 gates return the required counts.
- Acceptance grep checks (Task 2): all 8 gates pass (`it()` count 13 ≥ 12, `vi.mock` count 3, `resolves.toEqual` count 8 ≥ 6, `conn.end` count 8 ≥ 2, `useFakeTimers` count 2 ≥ 1).
- Git deletion check (`git diff --diff-filter=D HEAD~1 HEAD`): none — commit is additive-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Extended fail-open guard to cover `resolveHostById` throws**
- **Found during:** Task 2 (writing tests)
- **Issue:** Plan behavior contract step 1 places `resolveHostById` call BEFORE the try/catch, so a DB fault throwing from `resolveHostById` would propagate to the caller — contradicting invariant #1 ("NEVER throws to the caller") and the must-have "fail-opens on ANY failure". The plan text enumerates "`resolveHostById` returning null" as a fail-open branch but omits the throw case.
- **Fix:** Moved the `resolveHostById` call and its null-check INSIDE the fail-open try block. The null-short-circuit still returns early via `return new Set<string>()` (no behavior change on the null path). The catch block now handles resolver throws with the same warn-level "ssh-error" log the SSH failures produce. Test 7 in the fail-open describe block ("resolveHostById itself throws") pins this behavior.
- **Files modified:** `src/backend/voice/skill-catalog.ts` (moved lines 125-138 inside the try block; catch/finally structure unchanged).
- **Impact on public contract:** none — externally still `Promise<Set<string>>`, still never-throws. This is a strict tightening of the fail-open guard.
- **Commit:** `b7b906d` (single atomic commit for Plan 34-02).

### Build-time JSDoc parser hiccup (self-corrected, not tracked as a deviation)

Initial draft of `skill-catalog.ts` included the string `ls -1d */` inside a JSDoc block explaining why we don't use the dir-only ls variant — the `*/` inside the comment prematurely terminated the block and TypeScript emitted 15 parser errors. Rewrote the JSDoc line to say `ls -1d <dir>/` instead of the literal `*/`. Not a plan deviation — plan action step never dictated the exact prose of the comment.

## Threat Flags

None. Plan 34-02's threat model already registered T-34-02-01 (Tampering — kebab-case filter), T-34-02-02 (DoS — Promise.race timeout), and T-34-02-03 (Info Disclosure — `2>/dev/null` suppression) with `mitigate` disposition; all three mitigations are implemented and covered by tests. No new security surface introduced beyond the plan's threat register.

## Known Stubs

None. The module is a leaf helper with a fully-realized contract — no placeholder returns, no TODO branches, no mocked data sources at runtime (mocks live only in the test file's `vi.mock` calls).

## Key Decisions Recorded

- **Fail-open guard extends over `resolveHostById`.** The plan enumerated the null-return branch but not the throw branch; invariant #1 ("NEVER throws") requires the throw branch also fail-open. Moved the resolver call inside the try/catch as a strict tightening.
- **Warn-level logging only.** SSH failures on per-invocation fetches are expected/benign by design (fail-open UX means the user just sees "voice slash rewrite didn't happen"). Error-level would spam logs against a temporarily-offline box.
- **`ls -1 ~/.claude/skills/ 2>/dev/null` + in-process kebab-case filter** (vs `ls -1d */` dir-only) — keeps the shell command minimal and pushes the "malformed dir names" filter to a testable code path, which is also our T-34-02-01 defense.

## Self-Check: PASSED

- File exists: `src/backend/voice/skill-catalog.ts` — FOUND.
- File exists: `src/backend/voice/skill-catalog.test.ts` — FOUND.
- Commit exists: `b7b906d` — FOUND (`git log --oneline -3` confirms).
- `npm run build:backend` exit 0 — CONFIRMED.
- Full `npx vitest run` exit 0 with zero failures — CONFIRMED (2024 pass, 6 skip, 1 todo, 0 fail).
- Zero deletions in the commit (`git diff --diff-filter=D HEAD~1 HEAD` empty) — CONFIRMED.
- No 34-01 files touched (`src/backend/voice/slashCommandTransform.ts` and `slashCommandTransform.test.ts` untouched) — CONFIRMED by `git show --stat HEAD` showing only 2 new files.
