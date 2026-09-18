---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 01
subsystem: backend/claude-session
tags: [backend, artifact-reader, projects, substrate, tdd]
requires: []
provides:
  - PROJECT_SLUG_RE
  - getLocalProjectsRoot
  - readSessionProjectField
  - writeSessionProjectField
  - listProjects
  - readProjectFile
  - createProject
  - archiveProject
affects:
  - src/backend/claude-session/identity-artifact-reader.ts
  - src/backend/claude-session/identity-artifact-reader.projects.test.ts
tech-stack:
  added: []
  patterns:
    - LOCAL/REMOTE conn===null branch discipline (readIdentityFile at :441-475)
    - writeMarkdownFileAtomic atomic tmp+rename (SFTP ext_openssh_rename on REMOTE)
    - yaml.dump options {sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false}
    - Absent-⇒-omit invariant on frontmatter emit
    - Regex-first slug/key validation before any I/O
    - shellEscape single-quote wrapping as defense-in-depth
key-files:
  created:
    - src/backend/claude-session/identity-artifact-reader.projects.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
decisions:
  - "D-01: projects live at ~/fleet/projects/<slug>/ — implemented via getLocalProjectsRoot + PROJECTS_HOST_DIR env with os.homedir fallback"
  - "D-04: PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/ (kebab-case, lowercased, narrower than IDENTITY_KEY_RE — no underscore)"
  - "D-05 + D-32: readSessionProjectField / writeSessionProjectField target the identity file's frontmatter (~/fleet/identities/<key>/<key>.md)"
  - "D-25: createProject mints a bare project.md with only `displayName: <value>` frontmatter and empty body; dupe-slug throws EEXIST-shaped error before any write"
  - "D-30: listProjects excludes archive/ via `! -name archive` (REMOTE find) or name !== 'archive' (LOCAL readdir); archiveProject moves projects/<slug>/ → projects/archive/<slug>/"
  - "D-31 absent-⇒-omit: writeSessionProjectField with slug=null DELETES the project key from the parsed dict, never emits `project: null` or `project: ''`"
  - "Pitfall 5 held: full yaml.load / yaml.dump round-trip NOT extractCosmeticsFromFrontmatter — every unknown frontmatter key survives the write"
metrics:
  duration: ~1h
  completed: 2026-09-18
---

# Phase 117 Plan 01: Backend project primitives Summary

## One-liner

Backend substrate for projects — 7 identity-artifact-reader.ts exports plus the PROJECT_SLUG_RE gate that the entire Wave 2/3 route layer and the archive-cascade in 117-09 build on.

## Exports (verbatim signatures)

```typescript
// Constant
export const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;

// Root resolver
export function getLocalProjectsRoot(): string;

// Identity-file frontmatter read/write (project: field)
export async function readSessionProjectField(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<string | null>;

export async function writeSessionProjectField(
  conn: SSHClientType | null,
  identityKey: string,
  projectSlug: string | null,   // null clears the key entirely
): Promise<void>;

// Project directory primitives
export async function listProjects(
  conn: SSHClientType | null,
): Promise<Array<{ slug: string; displayName: string }>>;

export async function readProjectFile(
  conn: SSHClientType | null,
  slug: string,
): Promise<{ markdown: string }>;

export async function createProject(
  conn: SSHClientType | null,
  slug: string,
  displayName: string,
): Promise<void>;

export async function archiveProject(
  conn: SSHClientType | null,
  slug: string,
): Promise<void>;
```

## Test count and pass status

- **Total tests:** 33 (Task 1: 16, Task 2: 17)
- **All passing** on `vitest run src/backend/claude-session/identity-artifact-reader.projects.test.ts`
- **Scoped vitest-related** over the two touched files: 73 test files, 1254 passing / 1 skipped, zero regressions
- **TypeScript:** `tsc --noEmit -p tsconfig.json` exits clean

Test coverage by area:
- PROJECT_SLUG_RE positive/negative charset + length + flag-shape assertions (1 test)
- getLocalProjectsRoot env-var override + os.homedir fallback (2 tests)
- readSessionProjectField LOCAL: happy, missing key, no frontmatter, ENOENT, bogus YAML (5 tests)
- writeSessionProjectField LOCAL: set, update, clear, bad slug, bad key, unknown-key preservation (Pitfall 5 regression guard), atomic tmp+rename (7 tests)
- writeSessionProjectField REMOTE: readIdentityFile cat + SFTP ext_openssh_rename to $HOME-relative target (1 test)
- listProjects LOCAL: happy w/ archive-exclusion + displayName fallback + ENOENT-root (3 tests)
- listProjects REMOTE: find-cmd contains `! -name archive` + PROJECT_SLUG_RE filter on returned entries (2 tests)
- readProjectFile: LOCAL happy, LOCAL ENOENT → empty markdown, invalid-slug pre-I/O throw (3 tests)
- createProject LOCAL: happy w/ mkdir+atomic-write, dupe rejection via fs.stat, invalid slug, empty/oversize displayName (4 tests)
- createProject REMOTE: happy w/ test-d probe + shell-escaped mkdir + writeMarkdownFileAtomic, dupe rejection via probe (2 tests)
- archiveProject LOCAL: happy w/ mkdir-archive + fs.rename, path-traversal defense (2 tests)
- archiveProject REMOTE: single exec w/ mkdir-p && mv + shellEscape wrapping (1 test)

## Commits (atomic per TDD gate)

| Task | Gate | Commit | Message |
|------|------|--------|---------|
| Task 1 | RED | `f9c95ed` | `test(117-01): add failing tests for PROJECT_SLUG_RE + session-project-field primitives` |
| Task 1 | GREEN | `f1e2481` | `feat(117-01): add PROJECT_SLUG_RE + getLocalProjectsRoot + session-project-field primitives` |
| Task 2 | RED | `bc082aa` | `test(117-01): add failing tests for listProjects/readProjectFile/createProject/archiveProject` |
| Task 2 | GREEN | `d711ab8` | `feat(117-01): add listProjects/readProjectFile/createProject/archiveProject primitives` |

## Acceptance criteria — all satisfied

- `grep -c "^export const PROJECT_SLUG_RE" identity-artifact-reader.ts` → `1` ✓
- `grep -cE "^export (function|async function|const) (getLocalProjectsRoot|readSessionProjectField|writeSessionProjectField|listProjects|readProjectFile|createProject|archiveProject)"` → `7` ✓ (getLocalProjectsRoot is sync; the other 6 are `export async function`)
- No `extractCosmeticsFromFrontmatter` calls inside the new writer function bodies (Pitfall 5 gate held — the single grep match inside the writeSessionProjectField section is the explicit "NOT extractCosmeticsFromFrontmatter" comment marker, not a call) ✓
- `npx vitest run src/backend/claude-session/identity-artifact-reader.projects.test.ts` exits 0 with 33 passing tests ✓
- `npx tsc --noEmit -p tsconfig.json` exits 0 ✓
- PROJECT_SLUG_RE regex literal is byte-identical to `/^[a-z0-9-]{1,64}$/` (no `i` flag, no `_` in charset — asserted in Test 1) ✓
- listProjects REMOTE find command contains the literal `! -name archive` (verified by grep → 2 hits: one in JSDoc, one in the command string) ✓
- createProject dupe-rejection path proven by tests C2 (LOCAL) and C5 (REMOTE) — mkdir/writeFile spy call count === 0 in the dupe case ✓
- archiveProject rename target path is `$HOME/fleet/projects/archive/<slug>/` — verified by LOCAL rename destination assertion (A1) and REMOTE mv command string assertion (A3) ✓

## Deviations from Plan

None — plan executed exactly as written. One minor test-expectation adjustment during Task 1 GREEN self-check: the plan's implicit expectation that `yaml.dump` would preserve single-quote wrapping (e.g., `displayName: 'W'`) does not hold because js-yaml's default behavior with `forceQuotes:false` is to emit `W` unquoted since `W` has no YAML metacharacters. Test assertions were tightened to `toMatch(/displayName: '?W'?/)` — accepting both quoted and unquoted forms — because the SEMANTIC invariant (value preservation across round-trip) holds either way. This is not a code deviation, just a test-precision fix. All 33 tests pass.

## Threat model outcome

| Threat ID | Category | Disposition | Held |
|-----------|----------|-------------|------|
| T-117-01-01 | Tampering (path traversal via slug) | mitigate | ✓ PROJECT_SLUG_RE charset excludes `.` and `/` structurally; every entrypoint gates BEFORE I/O |
| T-117-01-02 | Tampering (shell injection in mv/mkdir) | mitigate | ✓ archiveProject and createProject REMOTE branches pass all user-derived values through shellEscape |
| T-117-01-03 | Info disclosure (cross-user reads) | accept | Route-layer gate (unchanged — Wave 2's problem) |
| T-117-01-04 | Tampering (frontmatter round-trip clobbers keys) | mitigate | ✓ Test 12 regression guard — custom key survives |
| T-117-01-05 | Denial of service (corrupt frontmatter) | mitigate | ✓ writeSessionProjectField throws with identity key in message on parse failure — no "repair" attempted |
| T-117-01-06 | Tampering (mkdir+probe race) | accept | Single-user, single-writer fleet model — theoretical only |
| T-117-01-SC | Tampering (npm slopsquat) | accept | ✓ Zero new packages installed |

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary shapes introduced by this plan — it is a pure-utility extension of an existing artifact reader. Wave 2 (117-04, 117-05) is where the route surface lands, and that plan's threat model covers the JSON-body-parse and cross-user-host gates.

## Known Stubs

None. Every function is fully implemented with LOCAL + REMOTE branches. No placeholder returns, no TODO markers, no "coming in the next plan" comments.

## Notes for Wave 2 (117-04 / 117-05)

- **execWithTimeout is NOT exported** from identity-artifact-reader.ts — it's a private helper. Route plans that need REMOTE-branch enumeration must call into the exported functions (listProjects, readProjectFile, etc.) rather than compose their own SSH exec.
- **Import path is unchanged** — the 7 new exports are additive; no existing consumer breaks. Wave 2 can import from `./identity-artifact-reader.js` with the same barrel-import shape it already uses for `IDENTITY_KEY_RE`, `readIdentityFile`, etc.
- **The exported PROJECT_SLUG_RE** is the single-source-of-truth for slug validation. Route plans MUST import and reuse it — do not redefine.
- **createProject's EEXIST signal** is a plain `Error` with `.code === "EEXIST"` (via `NodeJS.ErrnoException` cast). Wave 2's route can `if (err.code === "EEXIST") return res.status(409).json(...)` to distinguish dupe from generic 500.
- **Slug computation is intentionally NOT part of this plan** per Pitfall 1 in RESEARCH — the auto-slugify happens at the route layer or a shared helper module (Wave 2 responsibility). `createProject` accepts a pre-computed slug and validates it.

## Self-Check: PASSED

Files present:
- FOUND: `src/backend/claude-session/identity-artifact-reader.projects.test.ts`
- FOUND: `src/backend/claude-session/identity-artifact-reader.ts` (modified — 8 additive insertions verified via grep)

Commits present in git log:
- FOUND: `f9c95ed` — test(117-01) Task 1 RED
- FOUND: `f1e2481` — feat(117-01) Task 1 GREEN
- FOUND: `bc082aa` — test(117-01) Task 2 RED
- FOUND: `d711ab8` — feat(117-01) Task 2 GREEN

All 4 gate commits confirmed via `git log --oneline`; 33 tests pass under scoped vitest; tsc --noEmit clean; scoped vitest-related over the touched files shows 1254 passing / 0 failing / 1 skipped across 73 test files (no regressions in any consumer of identity-artifact-reader.ts).
