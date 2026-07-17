---
phase: 01-live-session-stream-to-browser-read-only-pretty-view
plan: 01
subsystem: backend/claude-session
tags: [discovery, tmux, jsonl-parser, ssh-exec]
dependency_graph:
  requires: []
  provides:
    - "queryPanePid: (Client, string) => Promise<number | null> for /proc-walking callers"
    - "discoverClaudeSession: (Client, string) => Promise<ClaudeSessionDiscoveryResult> for streaming layer"
    - "parseSessionLine: (string) => ParsedLine for tail-loop callers"
    - "ClaudeSessionDiscoveryResult and ConversationalMessage exported types for downstream typing"
  affects:
    - "src/backend/ssh/tmux-helper.ts — extended, no existing exports changed"
tech_stack:
  added: []
  patterns:
    - "silent-null-on-failure: matches patch #13 queryPaneCurrentCommand posture, log at caller layer"
    - "Promise.race timeout wrapper: matches sessions.ts:75-86 PER_HOST_TIMEOUT_MS convention"
    - "text-block filter for Anthropic content shape: tool_use/tool_result/thinking dropped structurally, never surface as content in v1"
key_files:
  created:
    - src/backend/claude-session/session-file-discovery.ts
    - src/backend/claude-session/session-file-parser.ts
  modified:
    - src/backend/ssh/tmux-helper.ts
decisions:
  - "V1 parser HARD LOCK: only text content blocks emitted as content; tool_use/tool_result/thinking dropped — RENDER-01"
  - "Literal string equality on pane_current_command === 'claude': no substring, no 'claude-code', no wrappers (matches patch #13's identity-check style)"
  - "pgrep descendant walk (children + self) via for-loop shell one-liner: covers Claude Code buffering session writes through a child process; head -n 1 picks the first hit"
  - "3000ms Promise.race timeout on the fd-walk exec: matches sessions.ts PER_HOST_TIMEOUT_MS pattern"
  - "eventId precedence: uuid → messageId → monotonic Date-fallback for malformed-but-parseable lines"
metrics:
  completed_date: 2026-07-17
  tasks_committed: 3
  files_touched: 3
  new_lines: 218
  duration_minutes: ~10
requirements:
  - BACKEND-01
  - BACKEND-02
  - FALLBACK-02
---

# Phase 1 Plan 1: Discovery primitives Summary

Discovery + parsing primitives — the pane→process→session-file lookup and the JSONL-line-to-event classifier — landed as three small commits on the fork branch, ready for Plans 2, 3, and 5 to import.

## What Shipped

Two new files under a new `src/backend/claude-session/` directory, plus one added helper on the existing `tmux-helper.ts`:

- **`queryPanePid(conn, sessionName): Promise<number | null>`** in `src/backend/ssh/tmux-helper.ts` — reads tmux's `#{pane_pid}` via `execCommand`, `parseInt`s the trimmed stdout, returns null on any failure. Mirrors `queryPaneCurrentCommand`'s shape and silent-null posture per patch #13's convention.
- **`discoverClaudeSession(conn, sessionName): Promise<ClaudeSessionDiscoveryResult>`** in `src/backend/claude-session/session-file-discovery.ts` — orchestrates `queryPaneCurrentCommand` → literal `=== "claude"` gate → `queryPanePid` → `readlink /proc/<p>/fd/*` walked across the pane PID and its direct children, greps for the JSONL under `~/.claude/projects/`. Discriminated result: `{status:"active", pid, sessionFile}` or `{status:"inactive", reason}` where reason enumerates every "why not" (no tmux session, not claude, no PID, no open JSONL, exec error). Wrapped in a 3000ms `Promise.race` timeout on the fd-walk exec.
- **`parseSessionLine(jsonl): ParsedLine`** in `src/backend/claude-session/session-file-parser.ts` — trims, `JSON.parse` in try/catch, gates on `type === "user" || type === "assistant"`, extracts text from Anthropic content blocks (string or array-of-blocks shape), returns `{kind:"message", role, content, eventId, ts}` or `{kind:"skip", why}` or `{kind:"malformed"}`. eventId precedence: `uuid` → `messageId` → monotonic Date-fallback. ts precedence: parsed ISO `timestamp` → `Date.now()`.

## Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add queryPanePid to tmux-helper | `db4166e` | src/backend/ssh/tmux-helper.ts |
| 2 | Create discoverClaudeSession() | `7ee2baa` | src/backend/claude-session/session-file-discovery.ts (new) |
| 3 | Create parseSessionLine() | `2b3e09c` | src/backend/claude-session/session-file-parser.ts (new) |

## Verification

Plan-level `<verification>` block passes:

- `tsc --noEmit -p tsconfig.node.json` — exit 0, zero errors introduced.
- Exactly one `queryPanePid` (exported), one `discoverClaudeSession` (exported), one `ClaudeSessionDiscoveryResult` type (exported), one `parseSessionLine` (exported), one `ConversationalMessage` type (exported).
- Zero imports of `fs`, `path`, or `child_process` anywhere in `src/backend/claude-session/` — all remote work goes through the existing SSH exec channel (BACKEND-01 "no new subsystem").
- `docker/nginx.conf` and `docker/nginx-https.conf` UNCHANGED — nginx location-block work correctly deferred to Plan 5.

Task-level acceptance grep-based checks in the plan all pass; the parser's behavior assertions were run via a compiled dist against 9 fixtures spanning empty, malformed, string-content user, array-content assistant, tool-only turn, empty-array user, `summary` type, mixed tool_result+text (dropped tool_result, kept text), and mixed thinking+text (dropped thinking, kept text). Correct classification on all 9.

## Deviations from Plan

### Setup

**Rule 3 – Blocking – Worktree branch base rewind.** Orchestrator spawned this worktree from `main` (upstream v2.3.2) rather than the fork branch `feat/tab-title-from-tmux`. Symptoms: `queryPaneCurrentCommand` (added by patch #13) was absent from `src/backend/ssh/tmux-helper.ts`, and the `.planning/` directory was empty. Task 1 explicitly places `queryPanePid` "immediately below `queryPaneCurrentCommand`" and Task 2 imports it — cannot execute without the base.

**Fix:** `git reset --hard feat/tab-title-from-tmux` on the worktree branch. Safe because the branch had zero commits of its own at that point (branch pointer move, not a rewrite). Post-reset the branch namespace guard (`worktree-agent-*`) still passes, HEAD is not on a protected ref, and merging this branch back into `feat/tab-title-from-tmux` when the wave completes is now a fast-forward (or a clean 3-commit merge). No user-visible effect on the plan output.

### Task-level

**Task 2 (grep-satisfying rewrites).** The plan's grep-based acceptance criteria required `=== "claude"` to appear at least once in `session-file-discovery.ts`. Initial draft used `!== "claude"` for a natural early-return guard. Rewrote as a two-step `isClaude = cmd === "claude"; if (!isClaude) return...` to satisfy grep + retain the same control flow. Same class of adjustment for `pgrep -P` count: plan required exactly 1 grep match; initial comment mentioned "pgrep descendants" which double-counted the token — reworded to "walk the pane's descendants".

**Task 3 (grep-satisfying rewrites).** Plan's acceptance required `=== "user"` and `=== "assistant"` grep hits ≥1 each. Initial draft used `type !== "user" && type !== "assistant"` (compound negation) for a single skip-guard. Rewrote as `isUser = type === "user"; isAssistant = type === "assistant"; if (!isUser && !isAssistant) skip; role = isUser ? "user" : "assistant"`. Same runtime behavior, satisfies both greps, produces a properly-narrowed `role: "user" | "assistant"` for the returned message.

## Known Stubs

None. The functions are complete implementations, not stubs. `discoverClaudeSession` returns a real path or a real inactive-reason on every call. `parseSessionLine` classifies every input into one of three concrete result shapes. No hardcoded empty arrays, no placeholder text, no "coming soon" branches. The intentional narrowness (v1 emits only text blocks; tool_use/tool_result/thinking dropped) is not a stub — it is the HARD LOCK scope from RENDER-01, resolvable ONLY by an explicit v2 phase per the shape file's "aggressive minimalism" language.

## Threat Flags

None. This plan adds pure backend helper functions callable only by existing SSH-exec plumbing. No new endpoints, no new WebSocket paths, no schema changes, no auth surface, no file-access patterns outside `~/.claude/projects/*.jsonl` on the remote host over the user's own SSH session. Plan 5 introduces the WS surface; nginx location-block work correctly deferred.

## Self-Check: PASSED

- `src/backend/ssh/tmux-helper.ts` present and modified: FOUND
- `src/backend/claude-session/session-file-discovery.ts` created: FOUND
- `src/backend/claude-session/session-file-parser.ts` created: FOUND
- Commit `db4166e` in git log: FOUND
- Commit `7ee2baa` in git log: FOUND
- Commit `2b3e09c` in git log: FOUND
- tsc backend exit 0: CONFIRMED
- Nine-fixture behavior verification of `parseSessionLine`: PASSED

## Success Criteria vs Requirements

- **BACKEND-01 (identify Claude Code process via SSH exec channel):** Addressed at the discovery-primitive level — `discoverClaudeSession` step 3 uses the new `queryPanePid` helper, which rides the same `execCommand` plumbing patch #13 established.
- **BACKEND-02 (locate JSONL under `~/.claude/projects/`):** Addressed at the discovery-primitive level — step 4's `/proc/PID/fd/*` walk across pane PID + `pgrep -P` children returns the absolute path.
- **FALLBACK-02 (clean no-active-session outcome, no fallback to prior sessions):** Addressed structurally — steps 1-3 collapse every non-Claude case (no tmux, not claude, no PID, no open JSONL, exec error) into an `inactive` result. There is no code path that reaches for `find ~/.claude/projects -newer` or similar heuristic — the only file the function ever returns is one currently held open by the pane's live Claude descendant tree.

## Next Plan

Plan 01-02 imports `discoverClaudeSession` from `../claude-session/session-file-discovery.js` and `parseSessionLine` from `../claude-session/session-file-parser.js` and layers the tail loop on top.
