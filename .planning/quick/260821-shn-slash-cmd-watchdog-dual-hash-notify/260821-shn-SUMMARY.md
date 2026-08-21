---
quick: 260821-shn-slash-cmd-watchdog-dual-hash-notify
status: complete
branch: feat/tab-title-from-tmux
commits:
  - 5ce21b89  # test(quick-260821-shn): failing dual-hash notify tests (RED)
  - 0f3f8e7a  # fix(quick-260821-shn): dual-hash notify for slash-command wrappers (GREEN)
files_modified:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/claude-session-server.compose-send.test.ts
requirements_satisfied:
  - QUICK-260821-SHN-01  # reconstructRawSlashCommand pure helper
  - QUICK-260821-SHN-02  # dual-hash notify at tail-side onLine block
  - QUICK-260821-SHN-03  # vitest coverage: 6 cases
tests:
  scoped_file: src/backend/claude-session/claude-session-server.compose-send.test.ts
  scoped_result: "Test Files 1 passed | 0 failed / Tests 31 passed (25 pre-existing + 6 new)"
  related_scan:
    files_run: 13
    result: "Test Files 13 passed / Tests 151 passed | 1 skipped"
    note: |
      vitest v4.1.8 dropped `--related`; substituted an explicit file list
      of every test in src/backend/claude-session/ that imports from
      ./claude-session-server. Same coverage intent.
completed_at: 2026-08-21T20:44Z
---

# Quick 260821-shn: dual-hash notifyPvSendMatched for slash-command watchdog

## One-liner

Backend now double-notifies `pv-send-watchdog` for slash-command wrappers —
once with the JSONL wrapper hash (pre-fix behavior), once with the reconstructed
raw `/NAME[ ARGS]` body hash (the fix) — clearing the frontend's pending
watchdog and stopping the T+2500ms retry + T+5500ms double-submit that
corrupted `/id tabitha`-style commands in tina's 20:19 session.

## What changed

### `src/backend/claude-session/claude-session-server.ts`

1. **New pure helper `reconstructRawSlashCommand(content: string): string | null`**
   at ~L400 (right after `__reshapeParsedLineToWireFrameForTests`).

   Detection contract:
   - Content is a slash-command wrapper IFF `<command-name>/NAME</command-name>`
     is present AND at least one sibling wrapper tag (`<command-message>` or
     `<command-args>`) is present.
   - `<command-name>` alone (no sibling) → malformed, INFO log, return null.
   - `<command-name>` present but inner text does not start with `/`, is
     empty, whitespace-only, or `/` alone → malformed, INFO log, return null.
   - No `<command-name>` tag at all → hot path (non-slash user turns), return
     null with NO log (role directive: "logging is cheap and batched" —
     batched here means not-per-message on the common path).

   Extraction:
   - NAME captured via `[^<]+` (bounded, non-empty).
   - ARGS captured via `[\s\S]*?` (dotall-safe; multi-line verbatim — the
     `.*?` idiom would have failed multi-line test 4).
   - `<command-args>` missing OR args.trim() === "" → `/NAME` (no trailing space).
   - Otherwise → `/NAME ARGS` (single space; args inserted verbatim).

2. **New test seam `__applyOnLineNotifyForTests(deps)`** at ~L486.

   Owns:
   - Guard: skip unless `frame.type === "message" && frame.role === "user" &&
     typeof frame.content === "string" && frame.content.length > 0 &&
     sessionIdFromFile` is truthy.
   - Wrapper-hash notify (pre-fix behavior, unchanged).
   - Raw-body reconstruction via `reconstructRawSlashCommand`.
   - If non-null: INFO log with `sessionId`, `name`, `argsLen` meta + operation
     `pv_send_watchdog_dual_hash_notify`, then second notify with raw-body hash.
   - Optional `logger` dep; defaults to module-level `sshLogger`.

3. **Refactored call site at ~L3676-3688:** replaced the inline
   `if (frame.type === "message" && frame.role === "user" && ...) { const contentHash = ...; notifyPvSendMatched(...); }`
   block with a single call to `__applyOnLineNotifyForTests({ frame, sessionIdFromFile, notifyMatched: notifyPvSendMatched })`.
   Existing Plan 50 Task 2 comment block preserved and extended with a
   `quick-260821-shn` reference paragraph.

### `src/backend/claude-session/claude-session-server.compose-send.test.ts`

Added a new describe block at end of file:
`describe("reconstructRawSlashCommand + __applyOnLineNotifyForTests — dual-hash notify (quick-260821-shn)", ...)`
with 6 tests exactly as spec'd in the plan:

| # | Scenario | Expected `reconstructRawSlashCommand` | Expected notify calls |
|---|----------|--------------------------------------|-----------------------|
| 1 | with-args `/id tabitha` wrapper | `"/id tabitha"` | 2 (wrapper-hash, then raw-hash) |
| 2 | no-args, missing `<command-args>` block | `"/help"` | 2 |
| 3 | empty `<command-args></command-args>` block | `"/help"` (no trailing space) | 2 |
| 4 | multi-line args verbatim (real `\n` in args) | `"/note line one\nline two"` | 2 |
| 5 | non-slash control (`"hello"`) | `null` | 1 (byte-identical pre-fix) |
| 6 | malformed (`<command-message>foo</command-message>` no `<command-name>`) | `null` | 1 (safe fallthrough) |

Import block updated to include `reconstructRawSlashCommand` and
`__applyOnLineNotifyForTests`. No pre-existing test modified. Injectable-deps
pattern mirrors the existing `__applyInputMessageForTests` convention.

## Decisions / edge cases discovered during implementation

1. **Plan Test 6 wording inconsistency, resolved in favor of behavior spec.**
   The plan's Test 6 description says the malformed case is "has
   `<command-message>` but no `<command-name>`" AND asserts "An INFO log fires
   on the malformed path" — but the behavior spec (§ A detection contract +
   § malformed handling) says the "no `<command-name>` at all" path is the
   hot path and MUST NOT log (per role directive on hot-path logging).
   Resolved by treating that path as the safe fallthrough with no INFO log,
   and adding a `logger` dep + `expect(infoSpy).not.toHaveBeenCalledWith(...)`
   assertion to Test 6 to pin that behavior. INFO logs for the truly
   "wrapper-detected but malformed name" cases (e.g. `<command-name>foo</command-name>`
   without a slash prefix, `<command-name>/</command-name>` alone, empty inner
   text) route through the module-level `sshLogger` and are not pinned by a
   test to avoid coupling to the logger transport.

2. **`vitest v4.1.8` dropped `--related` flag.** The plan's related-file scan
   step used `npx vitest run --related src/backend/claude-session/claude-session-server.ts`,
   which errors out in v4 with `Unknown option --related`. Substituted an
   explicit file list of all 13 `src/backend/claude-session/*.test.ts` files
   that import from `./claude-session-server`. Same coverage intent, and all
   13 pass green (151 passed, 1 pre-existing skipped).

3. **INFO log on the wrapper-detected dual-hash path** flows through the
   injectable `logger` dep so tests can pin its shape without mocking the
   `sshLogger` module. INFO log on the malformed-wrapper path (helper
   internal) flows through the module-level `sshLogger` — tests don't pin
   its shape (out of scope for this quick, and it's observable via
   structured runtime logs in production).

4. **Regex idiom `[\s\S]*?` for args capture is load-bearing** — `.*?` would
   have failed Test 4 (multi-line args). Both `CMD_NAME_ANY_RE` (for the
   fast-path "any wrapper tag present?" check) and `CMD_ARGS_RE` use this
   idiom. `CMD_NAME_RE` uses `[^<]+` because name is single-line and bounded
   by the closing tag.

5. **Log-and-notify order pinned by tests.** Wrapper-hash notify fires FIRST
   (unchanged from pre-fix; preserves FIFO semantics inside `notifyMatched`'s
   pending Map scan), then INFO log, then raw-hash notify. Tests 1-4 use
   `toHaveBeenNthCalledWith(1, ...)` / `toHaveBeenNthCalledWith(2, ...)` to
   pin that ordering so a later refactor that swaps the two calls surfaces
   immediately.

## Test results (verbatim last lines)

**Scoped file:**
```
 Test Files  1 passed (1)
      Tests  31 passed (31)
```

**Related-file scan (13 files that import from ./claude-session-server):**
```
 Test Files  13 passed (13)
      Tests  151 passed | 1 skipped (152)
```

**Typechecks:**
```
npx tsc --noEmit          → EXIT=0
npm run build:backend     → EXIT=0
```

## Deferred follow-ups (for orchestrator ship-gate)

- None specific to this quick. Full-suite vitest + `docker compose build` +
  deploy motion are the orchestrator's ship-gate per fleet rules.
- Consider a follow-up if the malformed-wrapper INFO log ever fires in
  production logs — it indicates either a Claude Code wire-shape change
  (upstream) or a new code path emitting `<command-name>` in unexpected
  shape. Grep for `pv_send_watchdog_malformed_wrapper` to observe.

## Fleet-rule compliance

- Single worktree confirmed (`git worktree list` shows one entry).
- No `git push` executed.
- No `docker build` / `docker compose` / `docker cp`.
- No full-suite vitest — scoped + related-file scan only.
- No touching `~/.claude/roles/box-maintainer/skynet-patches.md`.
- No `--no-verify` / `--no-gpg-sign` on commits.
- Two atomic commits per plan (RED then GREEN), no squash.
- INFO log added at dual-hash promotion point with `sessionId + name + argsLen`
  and operation `pv_send_watchdog_dual_hash_notify` (per role directive on
  interaction/lifecycle/effect boundary logging).
