---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "03"
subsystem: backend/fleet-status + backend/claude-session
tags: [path-rewrite, fleet-tree, ssh-exec, fixtures, bulk-sed]
dependency_graph:
  requires: []
  provides:
    - ssh-poll-orchestrator.ts: all SSH exec strings target fleet tree
    - ssh-poll-orchestrator.test.ts: all 104 fixture path strings target fleet tree
    - session-file-parser.outbound-body.test.ts: corpus reflects post-migration relay-send emission shape
  affects:
    - fleet-status polling SSH commands (identity enumeration + dormancy sentinel stat)
tech_stack:
  added: []
  patterns: [~/fleet/identities/, bulk sed for test fixture rewrite]
key_files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/claude-session/session-file-parser.outbound-body.test.ts
decisions:
  - D-01/D-05/D-06 applied: fleet tree single-source, no dual-path
  - All functional SSH exec strings in ssh-poll-orchestrator.ts now use ~/fleet/identities/
  - Bulk sed on 7207-line test file: 104 hits rewritten to 0
  - session-file-parser corpus: all 34 test cases describe current-shape emission (no legacy compat cases found)
  - ~/skynet-tanya message body content preserved verbatim (fleet rule: literal data, not path refs)
  - ~/.claude/skills/ reference preserved (D-13 RETAIN)
metrics:
  duration: "~5 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 96 Plan 03: ssh-poll-orchestrator + session-file-parser.outbound-body fleet path rewrite

**One-liner:** Fleet-status SSH exec strings + 7200-line test fixture surface + relay-send corpus parser test all rewritten from `~/.claude/identities/` to `~/fleet/identities/` via targeted edits + bulk sed.

## Task 1: ssh-poll-orchestrator.ts + ssh-poll-orchestrator.test.ts

### Source file edits (ssh-poll-orchestrator.ts)

Fresh grep confirmed all lines. RESEARCH.md lines 998, 1022, 1025, 1028, 1564 for functional SSH exec strings; lines 262, 901, 987, 996, 1541 for comment prose.

| Line | Before | After | Type |
|------|--------|-------|------|
| 262 (comment) | `stat ~/.claude/identities/'<tmuxSession>'/.dormant` | `stat ~/fleet/identities/'<tmuxSession>'/.dormant` | PROSE |
| 901 (comment) | `source B: enumerate ~/.claude/identities/` | `source B: enumerate ~/fleet/identities/` | PROSE |
| 987 (comment) | `.DS_Store in ~/.claude/identities/` | `.DS_Store in ~/fleet/identities/` | PROSE |
| 996 (comment) | `~/.claude/identities/ dir doesn't exist` | `~/fleet/identities/ dir doesn't exist` | PROSE |
| 998 (functional) | `"find ~/.claude/identities/ -mindepth 1 ..."` | `"find ~/fleet/identities/ -mindepth 1 ..."` | REWRITE |
| 1022 (functional) | `` `stat ~/.claude/identities/${quotedName}/.dormant ...` `` | `` `stat ~/fleet/identities/${quotedName}/.dormant ...` `` | REWRITE |
| 1025 (functional) | `` `stat ~/.claude/identities/${quotedName}/.recycled-at ...` `` | `` `stat ~/fleet/identities/${quotedName}/.recycled-at ...` `` | REWRITE |
| 1028 (functional) | `` `test -f ~/.claude/identities/${quotedName}/.recycle-requested ...` `` | `` `test -f ~/fleet/identities/${quotedName}/.recycle-requested ...` `` | REWRITE |
| 1541 (comment) | `` `~/.claude/identities/<tmuxSession>/.dormant` sentinel `` | `` `~/fleet/identities/<tmuxSession>/.dormant` sentinel `` | PROSE |
| 1564 (functional) | `` `stat ~/.claude/identities/${quotedTmuxSession}/.dormant ...` `` | `` `stat ~/fleet/identities/${quotedTmuxSession}/.dormant ...` `` | REWRITE |

Total functional REWRITE lines: **5** (lines 998, 1022, 1025, 1028, 1564).
Total fleet/identities references post-rewrite: **10** (5 functional + 5 comment).

### Test file rewrite (ssh-poll-orchestrator.test.ts)

Bulk sed command executed:
```bash
sed -i 's|~/\.claude/identities/|~/fleet/identities/|g; s|~/\.claude/roles/|~/fleet/roles/|g; s|\$HOME/\.claude/identities/|$HOME/fleet/identities/|g; s|\$HOME/\.claude/roles/|$HOME/fleet/roles/|g; s|/home/ubuntu/\.claude/identities/|/home/ubuntu/fleet/identities/|g; s|/home/ubuntu/\.claude/roles/|/home/ubuntu/fleet/roles/|g' src/backend/fleet-status/ssh-poll-orchestrator.test.ts
```

Post-sed grep verification:
```
grep -c "\.claude/identities\|\.claude/roles" src/backend/fleet-status/ssh-poll-orchestrator.test.ts
→ 0
```

**File stats:** 7207 lines, 104 legacy path hits → 0 after sed.

### Verification
- Non-comment grep on `ssh-poll-orchestrator.ts` for `\.claude/(identities|roles)`: **0**
- Full-file grep on `ssh-poll-orchestrator.test.ts` for `\.claude/(identities|roles)`: **0**
- `grep -c "fleet/identities" ssh-poll-orchestrator.ts`: **10** (≥5 required)
- `npm test -- src/backend/fleet-status/ssh-poll-orchestrator.test.ts`: **128/128 pass**

**Commit:** `00787092`

---

## Task 2: session-file-parser.outbound-body.test.ts

### Fixture path audit

Total lines in file: 788. Grep enumerated all legacy path hits (34 lines total across 10 distinct test cases plus PURE_PYTHON_CMD constant).

**Test case enumeration — all current-shape, no legacy-compat cases:**

| Test name | Legacy path context | Rewritten? | Justification |
|-----------|---------------------|------------|---------------|
| BODY-sq — coord room initial setup report (tanya) | `CREDS=~/.claude/identities/tanya/relay.json` | Yes | Current emission shape |
| BODY-sq — ack short message (tanya) | `CREDS=~/.claude/identities/tanya/relay.json` | Yes | Current emission shape |
| NELLY-SHAPE — BODY-sq with '"'"' apostrophe escape | `~/.claude/identities/nelly/relay.json` × 2 | Yes | Current emission shape |
| BODY-dq — deploy announce starting (tanya) | `~/.claude/identities/tanya/relay-state`, `relay.json` × 3 | Yes | Current emission shape |
| MSG-dq — deploy announce starting (tanya) | `~/.claude/identities/tanya/relay.json` | Yes | Current emission shape |
| MSG-sq — deploy announce with apostrophe (tanya) | `~/.claude/identities/tanya/relay.json` | Yes | Current emission shape |
| jq-arg-inline-dq — tiffany BEFORE announce phase-31 | `~/.claude/identities/tiffany/relay.json` | Yes | Current emission shape |
| jq-arg-inline-sq — tiffany takes lead on Phase 31 | `~/.claude/identities/tiffany/relay.json` × 2 | Yes | Current emission shape |
| heredoc-to-file — tanya ack after rebase | `~/.claude/identities/tanya/relay-state`, `relay.json` × 3 | Yes | Current emission shape |
| heredoc-to-file — tanya LGTM final state | `~/.claude/identities/tanya/relay-state`, `relay.json` × 3 | Yes | Current emission shape |
| UNEXTRACTABLE-cross-turn — --data-binary @req.json | `~/.claude/identities/tiffany/relay-state`, `$HOME/.claude/identities/tiffany/relay.json` × 2 | Yes | Current emission shape |
| BODY-sq-after-python-PY-block | `/home/ubuntu/.claude/roles/box-maintainer/...`, `~/.claude/identities/tiffany/relay.json` | Yes | Current emission shape; Python path inside PY block also updated |
| PURE_PYTHON_CMD (constant) | `/home/ubuntu/.claude/identities/tiffany/relay.json` inside Python heredoc | Yes | Current emission shape |
| A1: BODY=$(cat <<'EOF' short body EOF) | `~/.claude/identities/isabella/relay.json` | Yes | Current emission shape |
| A2: BODY=$(cat <<'EOF' multi-line body EOF) | `~/.claude/identities/wendy/relay.json` | Yes | Current emission shape |
| A3: BODY=$(cat <<'EOF' body with apostrophes EOF) | `~/.claude/identities/wendy/relay.json` | Yes | Current emission shape |
| Bjq-1: BODY=$(jq -nc --arg m "$MSG" ...) | `~/.claude/identities/tina/relay.json` | Yes | Current emission shape |
| Bjq-2: BODY=$(jq -n '{body:"literal"}') | `~/.claude/identities/tina/relay.json` | Yes | Current emission shape |
| C1: BODY=$'ansi-c body' | `~/.claude/identities/aqua/relay.json` | Yes | Current emission shape |
| C2: MSG=$'tab and apos escapes' | `~/.claude/identities/aqua/relay.json` | Yes | Current emission shape |
| D1: read -r -d '' MSG <<'EOF' (poppy) | `~/.claude/identities/poppy/relay.json` | Yes | Current emission shape |
| S12-1: Strategy 12 preflight (isabella) | `~/.claude/identities/isabella/relay.json` | Yes | Current emission shape |
| LB-1: latent bug regression (tabitha) | `~/.claude/identities/tabitha/relay.json` × 2 | Yes | Current emission shape |
| NO-OP invariant (tanya) | `~/.claude/identities/tanya/relay.json` | Yes | Current emission shape |

**Preserved legacy-path test cases:** None — no test description contained "legacy", "old format", "pre-migration", "backwards compat", "compatibility", or equivalent keywords.

**Preserved content per fleet rule:**
- `~/skynet-tanya` in BODY='...' shell variable values and `expectedBody:` strings: UNTOUCHED — these are verbatim message body content, not path references
- `~/.claude/skills/agent-relay/lib.sh` at line 166: UNTOUCHED — D-13 RETAIN (skills path stays)

### Verification

Post-sed counts:
```
grep -c "\.claude/identities\|\.claude/roles" → 0
grep -c "fleet/identities\|fleet/roles" → 35
```

`npm test -- src/backend/claude-session/session-file-parser.outbound-body.test.ts`: **34/34 pass**

**Commit:** `7ddef5b7`

---

## Deviations from Plan

None — plan executed exactly as written. Bulk sed covered all four documented path forms (`~/`, `$HOME/`, `/home/ubuntu/`) in both test files. No legacy-compat test cases found in session-file-parser test.

---

## Pre-existing Issue (Out of Scope)

`src/backend/database/routes/identity-birth-orchestrator.ts(886,20): error TS2339: Property 'hostId' does not exist` — pre-exists this plan's changes, documented in 96-01-SUMMARY.md. Build error is not caused by 96-03.

---

## Known Stubs

None.

---

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

---

## Self-Check: PASSED

- [x] `ssh-poll-orchestrator.ts`: 0 non-comment `.claude/identities|roles` hits, 10 `fleet/identities` hits (5 functional ≥ 5 required)
- [x] `ssh-poll-orchestrator.test.ts`: 0 `.claude/identities|roles` hits
- [x] `session-file-parser.outbound-body.test.ts`: 0 `.claude/identities|roles` hits, 35 `fleet/identities|roles` hits (≥ 20 required)
- [x] Task 1 commit `00787092` exists: `git log --oneline | grep 00787092`
- [x] Task 2 commit `7ddef5b7` exists: `git log --oneline | grep 7ddef5b7`
- [x] 128 tests pass (ssh-poll-orchestrator)
- [x] 34 tests pass (session-file-parser.outbound-body)
