---
quick_id: 260829-r9i
slug: skip-5-session-lifecycle-shapes-from-pre
date: 2026-08-29
status: in-progress
---

# Skip 5 Session-Lifecycle Noise Shapes from Pretty-View Bubbles

## Description

Five `type:"user"` events currently render as user-role bubbles in PrettyView that Ashley wants hidden — they're all session-lifecycle noise injected by Claude Code or agent-supervisor ("hide how the sausage is made"). Add skip rules in `session-file-parser.ts` alongside the existing `harness_wrapper` skip.

## Target file

`src/backend/claude-session/session-file-parser.ts`

## Skip conditions to add

All go inside the existing `if (isUser && imageRefs.length === 0)` block (~line 1279-1287), after the empty-content skip and before the final `kind:"message"` return. Return `{ kind: "skip", why: "<reason>" }` when matched.

1. **`slash_exit`** — `content.includes("<command-name>/exit</command-name>")`
   - JSONL shape: `<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>`
2. **`slash_id`** — `content.includes("<command-name>/id</command-name>")`
   - JSONL shape: `<command-message>id</command-message>\n<command-name>/id</command-name>\n<command-args>tina</command-args>` (args-agnostic — /id reset, /id save, /id <name> all skip)
3. **`goodbye_echo`** — `content.trim() === "<local-command-stdout>Goodbye!</local-command-stdout>"`
   - Narrow: only this literal string; other `<local-command-stdout>...</local-command-stdout>` blocks stay (Ashley uses other slash-commands intentionally and their stdout should render)
4. **`resume_injection`** — `content.startsWith("Your session was just resumed by the agent-supervisor")`
   - Prefix-anchored (guards against matching real prose that quotes the sentinel)
   - Mirrors form at `src/backend/fleet-status/ssh-poll-orchestrator.ts:320`
5. **`ctrl_c_kill`** — after trim, stripping ASCII control chars (`[\x00-\x1F]`) yields empty string
   - Matches `\x03\x03` (double Ctrl-C) and any pure-control-char noise
   - Port the exact regex from `ssh-poll-orchestrator.ts:317`: `t.replace(/[\x00-\x1F]/g, "") === ""`

## Order in the file

Place the block BEFORE the existing `harness_wrapper` strip (line 1279 today) — that skip does regex work on content; these five are cheaper substring/prefix checks and should short-circuit first. All five checks share the same `isUser && imageRefs.length === 0` guard, so put them all in one adjacent block.

## Tasks

### Task 1 — implement the 5 skip conditions
- File: `src/backend/claude-session/session-file-parser.ts`
- Add block after `if (content === "" && imageRefs.length === 0)` skip (line ~1251-1253) and before the current `if (isUser && imageRefs.length === 0)` harness_wrapper strip (~line 1279).
- Guard: `if (isUser && imageRefs.length === 0 && typeof content === "string")` — technically content is already `string` from `extractText` but explicit guard makes intent clear.
- One `if` per skip reason, in the order above. Each returns `{ kind: "skip", why: "<reason>" }`.
- The `ctrl_c_kill` check needs `content.trim().replace(/[\x00-\x1F]/g, "") === ""` — trim first so trailing/leading whitespace doesn't hide the control-only nature.

### Task 2 — add tests
- File: `src/backend/claude-session/session-file-parser.test.ts`
- Grep existing `harness_wrapper` tests for pattern reference.
- Add one negative test per skip reason (5 total) verifying the parser returns `{ kind: "skip", why: "<reason>" }` for a real-JSONL-shaped fixture.
- Add three positive-passthrough tests:
  - User turn that CONTAINS `Your session was just resumed by the agent-supervisor` as quoted prose inside a longer sentence (not at position 0) — must return `kind:"message"`.
  - `<command-name>/gsd:quick</command-name>` invocation — must return `kind:"message"` (only /id and /exit are skipped, not all slash-commands).
  - A legitimate user turn that starts with `<` or ends with `>` but isn't one of the 5 shapes (e.g. `"< 100 rows returned >"` or `"the ratio is > 0.5"`) — must return `kind:"message"`.

### Task 3 — scoped tests + commit
- Run `npx vitest run src/backend/claude-session/session-file-parser.test.ts` — must exit 0, zero failures.
- Commit with message:
  ```
  feat(quick-260829-r9i): skip 5 session-lifecycle shapes from pretty-view bubbles

  Adds five skip conditions to session-file-parser.ts to hide session-lifecycle
  noise from PrettyView bubbles:

  - slash_exit: <command-name>/exit</command-name> — supervisor-injected /exit
  - slash_id: <command-name>/id</command-name> — any /id invocation, args-agnostic
  - goodbye_echo: <local-command-stdout>Goodbye!</local-command-stdout> literal
  - resume_injection: "Your session was just resumed by the agent-supervisor" (prefix)
  - ctrl_c_kill: content with only ASCII control chars (Ctrl-C double-tap etc)

  Mirrors the isAshleyRealUserTurn predicate in ssh-poll-orchestrator.ts for
  items 1, 4, 5. /id is NOT excluded there (used as "Ashley present" signal)
  but IS excluded here (bubble noise). goodbye_echo is deliberately narrow —
  other <local-command-stdout>...</local-command-stdout> blocks still render
  because Ashley intentionally invokes other slash-commands whose output is
  useful context.
  ```

## Constraints

- **DO NOT deploy.** Executor's remit stops at code + commit + scoped-tests-green. Orchestrator picks up ship motion after Ashley greenlights push.
- **DO NOT modify** `~/.claude/roles/box-maintainer/skynet-patches.md`. Patch number claimed at ship time post-rebase by the orchestrator.
- **DO NOT modify** `src/backend/fleet-status/ssh-poll-orchestrator.ts` or `src/backend/database/routes/sessions.ts`. Those hold the backend predicate which is intentionally different (does NOT skip /id).
- **Scoped tests only** — do NOT run full `npx vitest run` (that's the orchestrator's ship-gate).

## Success criteria

1. `session-file-parser.ts` has 5 new skip conditions returning distinct `why` values.
2. `session-file-parser.test.ts` has 5 new negative tests + 3 new positive-passthrough tests, all passing.
3. `npx vitest run src/backend/claude-session/session-file-parser.test.ts` exits 0.
4. One atomic commit on `feat/tab-title-from-tmux` with the message above.
5. No changes to backend fleet-status predicate files, patches file, or any non-listed file.
