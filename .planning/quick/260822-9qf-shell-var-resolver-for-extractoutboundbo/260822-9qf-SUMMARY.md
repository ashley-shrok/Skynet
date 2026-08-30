---
phase: quick-260822-9qf
plan: 01
subsystem: relay / pretty-view / session-parser
tags:
  - relay
  - pretty-view
  - session-parser
dependency-graph:
  requires:
    - Phase 49 sanitize pass (sanitizeBashSqEscapeIdioms / APOS_MARKER / restoreApostrophes)
    - Existing 10-strategy extractOutboundBody plumbing
  provides:
    - substituteShellVars(cmd) file-local preprocess helper
    - Resolved `$VAR` / `${VAR}` refs before Strategy 6 jq-arg-inline-dq
  affects:
    - Relay outbound bubble rendering in pretty view (backend parser only)
tech-stack:
  added: []
  patterns:
    - Same architectural philosophy as Phase 49's sanitizeBashSqEscapeIdioms — preprocess cmd BEFORE the 10 strategies run
    - First-assignment-wins + length-descending sort + word-boundary guard
key-files:
  created: []
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/session-file-parser.outbound-body.test.ts
decisions:
  - Preprocess pass over regex-tightening — same reasoning as Phase 49
  - No-op + no log line when zero var refs found (byte-identical guarantee for existing corpus)
  - Length-descending substitution order + `(?![A-Za-z0-9_])` word-boundary guard as defense-in-depth against $BODY_LONG vs $BODY collisions
  - Sanitize FIRST, then substitute (so APOS_MARKER survives both passes and restoreApostrophes restores at return site)
metrics:
  duration: ~15 minutes
  completed: 2026-08-22
---

# quick-260822-9qf: Shell-var resolver for extractOutboundBody Summary

Preprocess pass that resolves `$VAR` / `${VAR}` shell-var references in
relay-outbound cmds before extractOutboundBody's 10 strategies run — closes
the class of failures where the extractor returned literal `$WBODY`,
`$body_var`, or `$PAYLOAD` text into pretty-view bubbles instead of the
resolved human message body.

## What Changed

### `substituteShellVars(cmd: string): string` — file-local preprocess helper

Added in `session-file-parser.ts` immediately before the JSDoc block for
`extractOutboundBody` (matches the file-local, unexported pattern of
`sanitizeBashSqEscapeIdioms` and `restoreApostrophes`).

**Assignment regexes:**

- Single-quoted: `/(^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)='([\s\S]*?)'/g`
  Captures VAR='...' verbatim (sanitize pass has already normalized the two
  bash apostrophe-escape idioms into `APOS_MARKER`, which round-trips
  correctly through substitution and gets restored by `restoreApostrophes`
  at each strategy's return site).
- Double-quoted: `/(^|[\s;\n]|&&|\|\|)([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"\\])*)"/g`
  Value decoded via `.replace(/\\(.)/g, "$1")`.
- Boundary group `(^|[\s;\n]|&&|\|\|)` in both regexes to keep the match at
  a plausible statement boundary (best-effort — this is a preprocess pass,
  not a shell parser).

**First-assignment-wins** across BOTH scans — sq wins over dq if both
appear for the same name, mirroring the ordering.

**Sort order:** keys sorted length DESCENDING before substitution so
`$BODY_LONG` resolves to the `BODY_LONG` value, NOT the `$BODY` value + a
literal `"_LONG"` suffix.

**Substitution forms:**

1. `${name}` braces form via `String.prototype.split(bracesToken).join(value)`
2. `$name` bare form via `new RegExp('\\$' + escapeRegex(name) + '(?![A-Za-z0-9_])', 'g')`

The `(?![A-Za-z0-9_])` guard is defense-in-depth alongside the
length-descending sort.

**Log-line format** (matches existing `sessionParserLogger.debug` style):

```
[session-parser] extract preprocess vars-substituted=<n> uniqueVars=<m>
```

Emitted ONLY when `n > 0`. When zero var refs found: returns the input
string byte-identically AND emits no log line — guarantees the pre-existing
30+ outbound-body corpus fixtures continue to render byte-identical.

### Wire-up in `extractOutboundBody`

At the entry point of `extractOutboundBody`:

```ts
const s0 = sanitizeBashSqEscapeIdioms(cmd);
const s = substituteShellVars(s0);
```

Order matters: sanitize FIRST (converts bash apostrophe-escape idioms into
`APOS_MARKER`), THEN substitute (so single-quoted var values that used
those idioms carry the marker through into the substituted cmd, and
`restoreApostrophes` at each strategy's return site restores them).

## Test Coverage — 6 New Tests (A-F)

Added a new `describe("extractOutboundBody — shell-var substitution", ...)`
block at the END of `session-file-parser.outbound-body.test.ts` (after the
existing `— corpus fixtures`, `— priority order`, and `— known limitations`
describes). Each test closes a specific extraction gap:

| Test | Name                       | Gap closed                                                                                          |
| ---- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| A    | WBODY-jq-arg-dq            | Primary bug — pre-fix Strategy 6 returned literal `$WBODY`; now returns `"literal message"`         |
| B    | body_var-jq-arg-dq (lower) | Lowercase var-name pattern is accepted by the assignment regex (`[A-Za-z_][A-Za-z0-9_]*`)           |
| C    | PAYLOAD-multiline-sq       | Embedded newlines preserved through substitution — `[\s\S]*?` non-greedy multi-line capture works   |
| D    | `${MSG_TEXT}` braces form  | Braces syntax substituted correctly (separate replace path from `$name`)                            |
| E    | NAME-COLLISION guard       | `$MYBODY_LONG` resolves to `MYBODY_LONG`, not `$MYBODY` + `_LONG` — length-desc sort + `(?!\w)` guard |
| F    | APOSTROPHE round-trip      | Phase 49 sanitize + shell-var substitution compose — `'"'"'` idiom survives both passes             |

## Verification

Executor scoped gate:

```bash
npx vitest run \
  src/backend/claude-session/session-file-parser.test.ts \
  src/backend/claude-session/session-file-parser.outbound-body.test.ts \
  src/backend/claude-session/session-file-parser.id-reset.test.ts
```

Result: **3 test files passed, 84 tests passed** (78 pre-existing + 6 new).
The pre-existing corpus battery is byte-identical-passing — `substituteShellVars`
is a no-op when zero var references are found.

Backend build:

```bash
npm run build:backend
```

Result: **exit 0, zero TypeScript errors, zero output**.

Manual sanity check:

```bash
grep -n 'substituteShellVars\|extract preprocess vars-substituted' \
  src/backend/claude-session/session-file-parser.ts
```

Yields:
- L245: `function substituteShellVars(cmd: string): string {` (helper definition)
- L310: `[session-parser] extract preprocess vars-substituted=…` (log line)
- L343: `const s = substituteShellVars(s0);` (call site in `extractOutboundBody`)

## Commit SHAs

| Phase | SHA        | Message                                                                                          |
| ----- | ---------- | ------------------------------------------------------------------------------------------------ |
| RED   | `9e052eed` | `test(quick-260822-9qf): 6 failing tests A-F for shell-var substitution in extractOutboundBody`  |
| GREEN | `94a3386e` | `feat(quick-260822-9qf): substituteShellVars preprocess pass for extractOutboundBody`            |

Base: `d5663c12` on `feat/tab-title-from-tmux`.

## Deviations from Plan

**1. [Rule 3 — Blocking] Scoped test invocation swapped from `vitest --related` to explicit file list**

- **Found during:** RED-phase test run (before implementation).
- **Issue:** vitest 4.1.8 (installed in this repo) no longer supports the
  `--related <path>` flag — it exits with `CACError: Unknown option '--related'`.
  vitest 4 replaced related-file discovery with `changed`-mode filtering,
  which is not equivalent for this use case.
- **Fix:** Ran the three session-file-parser-related test files by explicit
  path, matching the plan's stated expectation of "≥ 36 tests total (existing
  30+ in `outbound-body.test.ts` + additional related tests in
  `session-file-parser.test.ts` and `id-reset.test.ts` + 6 new)":

  ```bash
  npx vitest run \
    src/backend/claude-session/session-file-parser.test.ts \
    src/backend/claude-session/session-file-parser.outbound-body.test.ts \
    src/backend/claude-session/session-file-parser.id-reset.test.ts
  ```

  Result: 84 tests passed — well above the ≥ 36 gate.
- **Files modified:** none (invocation-only change).
- **Commit:** captured inline in RED / GREEN commit messages.

**2. [Test E] Var names renamed BODY → MYBODY / BODY_LONG → MYBODY_LONG**

- **Found during:** RED test authoring.
- **Issue:** Plan's Test E used `BODY='short'` and `BODY_LONG='long text here'`.
  But Strategy 1 (BODY-sq) matches `BODY='...'` with FIRST-MATCH-WINS priority
  BEFORE Strategy 6 (jq-arg-inline-dq) ever fires — so the collision-guard
  behavior of `substituteShellVars` couldn't be observed end-to-end; the test
  would return `"short"` from Strategy 1 regardless of substitution correctness.
- **Fix:** Renamed the vars in Test E to `MYBODY` / `MYBODY_LONG` so
  Strategy 1 doesn't shortcut, forcing the flow through Strategy 6 with
  `$MYBODY_LONG` substituted first. The semantic property under test
  (length-descending sort + word-boundary guard resolving `$BODY_LONG`-shape
  refs to the longer var, not the shorter var + suffix) is preserved unchanged.
- **Files modified:** `src/backend/claude-session/session-file-parser.outbound-body.test.ts`.
- **Commit:** captured inline in RED commit.

## Handoff Back to tina (Orchestrator)

- **Branch/HEAD:** `feat/tab-title-from-tmux` at `94a3386e`
- **Files touched (source):**
  - `src/backend/claude-session/session-file-parser.ts` (+96 net lines: helper + 2-line call-site wire-up)
  - `src/backend/claude-session/session-file-parser.outbound-body.test.ts` (+74 lines: new describe + 6 `it` blocks)
- **Tests added:** 6 (A-F) under `extractOutboundBody — shell-var substitution`
- **Scoped test result:** 3 files / 84 passed (78 pre-existing byte-identical + 6 new)
- **Build result:** `npm run build:backend` exit 0
- **Commit SHAs:** RED `9e052eed`, GREEN `94a3386e`
- **NOT done (orchestrator's remit):** full suite `npx vitest run`, `docker build`, `docker compose up`, `git push`

## Self-Check: PASSED

- `src/backend/claude-session/session-file-parser.ts` modified (verified by `git diff --stat`)
- `src/backend/claude-session/session-file-parser.outbound-body.test.ts` modified (verified by `git diff --stat`)
- RED commit `9e052eed` present in `git log`
- GREEN commit `94a3386e` present in `git log`
- Scoped vitest: 3 files / 84 passed
- Backend build: exit 0, zero output
- Grep sanity: helper (L245) + log line (L310) + call site (L343) — 3 matches, all present
