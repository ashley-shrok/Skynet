---
status: complete
phase: quick-260730-mzj
plan: 01
completed: "2026-07-30"
commits:
  - sha: ca6f2a9
    message: "feat(claude-session): replace mtime JSONL pick with PID-file lookup in discoverClaudeSession"
    files:
      - src/backend/claude-session/session-file-discovery.ts
  - sha: 72ae72a
    message: "test(claude-session): rewrite session-file-discovery.test.ts for PID-file flow"
    files:
      - src/backend/claude-session/session-file-discovery.test.ts
tags:
  - claude-session
  - session-file-discovery
  - pid-file
  - pretty-view
  - bug-fix
---

# Phase quick-260730-mzj Plan 01: Session File PID Lookup Summary

## One-liner

Replaced mtime-based `ls -t *.jsonl` session resolution with per-PID `~/.claude/sessions/<PID>.json` lookup — each agent's PID file carries its own `sessionId` so two Claude sessions sharing a cwd can no longer steal each other's transcript.

## Files Touched

| File | Commit | Change |
|------|--------|--------|
| `src/backend/claude-session/session-file-discovery.ts` | ca6f2a9 | Step 5 rewrite: PID-file-based JSONL resolution; type union widened with `no_pid_session_file` |
| `src/backend/claude-session/session-file-discovery.test.ts` | 72ae72a | Full rewrite: 12 tests covering new failure taxonomy + preserved walk-step tests |

## What Changed

### Task 1: Source rewrite (`session-file-discovery.ts`)

Steps 1-4 (queryPanePid, walkScript BFS awk, Promise.race timeout, claudePid parse) are byte-identical. The walk-script `;`-separator comment (patch #170→#174 scar) survives verbatim.

Step 5 was replaced:

**Old:** `readlink /proc/<pid>/cwd` → slugify → `ls -t ~/.claude/projects/<slug>/*.jsonl | head -n 1` (mtime-based, races between two agents sharing a cwd)

**New:** Cat `~/.claude/sessions/<PID>.json` + emit `$HOME` via `---HOME---` delimiter in a single SSH exec round trip. Parse `sessionId` + `cwd`. Slugify `cwd` via `cwd.replace(/[./]/g, "-")` (same transform as the old sed). Construct `$HOME/.claude/projects/<slug>/<sessionId>.jsonl`. Verify with `test -f` in a second exec.

`ClaudeSessionDiscoveryResult` inactive reason union widened:
- Added `"no_pid_session_file"` (between `pid_unavailable` and `no_open_session_file`)

New failure taxonomy:
- PID file missing / empty output → `no_pid_session_file`
- JSON parse error / missing `sessionId` or `cwd` / non-string fields → `no_pid_session_file`
- sessionId resolved but JSONL not on disk → `no_open_session_file` (existing reason, correct semantics)
- SSH exec throws / times out → `exec_error` (same as walk-step)

Consumer audit: `claude-session-server.ts` accesses `result.reason` generically (no exhaustive switch over reason strings), so the union widening required no changes there.

The discovery-repoll ticker at `claude-session-server.ts:2201-2267` was NOT retired — it correctly serves the session-recycle-picked-new-PID case (out of scope).

### Task 2: Test rewrite (`session-file-discovery.test.ts`)

12 tests total:

| Test | Description | Result |
|------|-------------|--------|
| 1 | kiro-cli-term wrapper → active pid 102 (preserved) | PASS |
| 2 | 4-level chain → active pid 103 (preserved) | PASS |
| 3 | pane_pid IS claude → active pid 200 (preserved) | PASS |
| 4 | no claude in tree → not_claude (preserved) | PASS |
| 5 | queryPanePid null → no_tmux_session, execCommand never called (preserved) | PASS |
| 6 | walk exec timeout → exec_error (preserved) | PASS |
| 7 | Happy path with slug-transform assertion (cwd="/home/ubuntu/proj" → slug="-home-ubuntu-proj") | PASS |
| 8 | PID-file missing (delimiter absent) → no_pid_session_file | PASS |
| 9 | PID-file malformed JSON → no_pid_session_file | PASS |
| 10 | PID-file missing sessionId field → no_pid_session_file | PASS |
| 11 | sessionId resolved but JSONL not on disk → no_open_session_file | PASS |
| 12 | PID-file exec rejects (SSH error) → exec_error | PASS |

`mockExecCommand` dispatches on three unique substrings:
- `"ps -eo"` → walk branch
- `".claude/sessions/"` → PID-file read branch
- `'if [ -f "'` → JSONL existence test branch

Old dispatch keys (`"readlink -f"`, `"ls -t"`, `"/proc/"`) fully removed.

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build:backend` | EXIT 0 |
| `npm run build` (full) | EXIT 0 |
| `npx vitest run session-file-discovery.test.ts` | 12/12 PASS |
| `claude-session-server.count-bounties.test.ts` | PASS (part of 41 total sibling tests) |
| `claude-session-server.aside.test.ts` | PASS |
| `claude-session-server.aside.integration.test.ts` | PASS |
| `identity-artifact-reader.test.ts` | PASS |
| `grep -n "ls -t" session-file-discovery.ts` | 0 matches |
| `grep -n ".claude/sessions/" session-file-discovery.ts` | 3 matches |
| No `"readlink\|ls -t\|/proc/"` dispatch keys in test | 0 matches |
| `no_pid_session_file` references in test | 10 matches (>= 4 required) |

## Deviations from Plan

None — plan executed exactly as specified. The two SSH exec round trips (PID-file read + `test -f`) match the plan's suggested shape. The slug transform `cwd.replace(/[./]/g, "-")` matches the spec's `sed 's|[./]|-|g'` semantics verified by Test 7's explicit slug assertion.

## Boundary Respected

- NO push
- NO docker build/deploy
- NO edits under `~/.claude/identities/tina/`
- Discovery-repoll ticker NOT retired

## Follow-ups Worth Noting

- **Ticker semantics**: The discovery-repoll ticker now calls the PID-file-based `discoverClaudeSession` on each tick. If Claude recycles to a new session (new PID), the new PID's session file will differ from `currentSessionFile`, correctly triggering `transitionToActiveNew`. The ticker's semantics are unchanged and correct.
- **Patch catalog**: Tina should file this as patch #206 and close the `pretty-view-shows-wrong-session-jsonl` bounty.
- **Two-exec design**: The PID-file script uses two SSH execs (PID-file cat + `test -f`) rather than one. The plan allowed this; a future optimization could combine them if round-trip latency becomes noticeable on high-latency hosts.
