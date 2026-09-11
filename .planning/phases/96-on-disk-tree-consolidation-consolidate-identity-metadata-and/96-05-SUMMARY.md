---
phase: 96-on-disk-tree-consolidation-consolidate-identity-metadata-and
plan: "05"
subsystem: substrate-skills
tags: [path-rewrite, fleet-tree, prose, id-skill, agent-relay, coordinator]
dependency_graph:
  requires: []
  provides: [fleet-path-refs-in-id-skill, fleet-path-refs-in-agent-relay-skill]
  affects: [substrate/skills/id/SKILL.md, substrate/skills/id/coordinator-instructions.md, substrate/skills/id/clone-picker-prompt.md, substrate/skills/id/actor-status-prompt.md, substrate/skills/agent-relay/SKILL.md]
tech_stack:
  added: []
  patterns: [hand-audited-path-replacement, exact-string-edit]
key_files:
  created: []
  modified:
    - substrate/skills/id/SKILL.md
    - substrate/skills/id/coordinator-instructions.md
    - substrate/skills/id/clone-picker-prompt.md
    - substrate/skills/id/actor-status-prompt.md
    - substrate/skills/agent-relay/SKILL.md
decisions:
  - "workspace/ sub-part added to File locations section in SKILL.md and workspace mkdir added to coordinator-instructions.md new-identity flow per D-04 + orchestrator-resolved-Q4"
  - "agent-relay/SKILL.md line 481 ~/skynet-<name>/ reference rewritten to ~/fleet/identities/<name>/workspace/ per orchestrator-resolved-Q1"
  - "STATE_DIR setup block in SKILL.md updated to ~/fleet/identities/<name>/relay-state to align recv.sh cred-path derivation (Trap 8)"
  - "coordinator-instructions.md spawn steps renumbered: mkdir workspace becomes step 3, verify workspace becomes step 7"
  - "~/.claude/CLAUDE.md, ~/.claude/skills/, ~/.local/bin/ retained throughout per D-12/D-13/D-14"
metrics:
  duration: "~25 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  files_modified: 5
---

# Phase 96 Plan 05: Skill Prose Path Rewrite (id + agent-relay) Summary

**One-liner:** Rewrote all ~56 `~/.claude/identities/` and `~/.claude/roles/` prose references across 5 substrate skill files to `~/fleet/` tree paths; added `workspace/` sub-part to id-skill on-disk layout and coordinator new-identity flow; migrated agent-relay line 481 from `~/skynet-<name>/` to `~/fleet/identities/<name>/workspace/`.

---

## Task 1: substrate/skills/id/SKILL.md

### Path-rewrite edit counts by section

| Section | Legacy refs rewritten | Notes |
|---|---|---|
| What this skill does (lines 19-25) | 2 | role + identity folder bullets |
| The four artifacts (line 39, 65) | 2 | role folder + identity folder headings |
| Role file section (line 126) | 1 | box-map.md path |
| Creating a new identity §2 (lines 241, 260, 264, 271) | 4 | IDENTITY_FILE var, verify role, create folder, slim template |
| Relay self-register block (lines 343-344) | 2 | $HOME/.claude/ form (relay.json write + chmod) |
| Loading an identity §3 (lines 370, 389-390, 397) | 4 | identity file path, role folder, role file, handoff path |
| Coordinator mode actor list (line 477) | 1 | grep identities glob |
| On-wake relay receiver (line 537) | 1 | relay.json reference in prose |
| STATE_DIR setup block (lines 566-568) | 3 | mkdir + STATE_DIR + SINCE_FILE |
| Wake-up scheduler launch (line 605) | 1 | Monitor command arg |
| Context-watch nudge prose (lines 642, 646) | 2 | .recycle-requested sentinel |
| Context-watch launch (line 636) | 1 | Monitor command arg |
| Role-file watch cases (lines 667, 671) | 2 | role file + identity file bullets |
| Role-file watch launch (line 690) | 1 | Monitor command arg |
| .no-dormancy sentinels (lines 727-728) | 2 | touch + rm |
| Recall section (lines 826, 829) | 2 | grep bounties + history.md |
| /id save §2 (lines 972, 976, 981, 1007-1008) | 5 | bounties pool, history append, handoff overwrite, history trim |
| /id reset §2 (lines 1019, 1051) | 2 | .recycle-requested in save and reset |
| File locations section (lines 1074-1098) | 4 (full section rewrite) | See workspace addition below |
| Bounties §Bounties (lines 1109, 1164) | 2 | bounty folder paths |
| Archiving bounties (lines 1315-1317) | 3 | mkdir + mv archive commands |
| Runbooks storage (line 1342) | 1 | runbook path |
| Scheduled wake-ups scope (lines 1420, 1424, 1454-1455) | 4 | identity-level + role-level wakeup paths |
| **TOTAL** | **~56** | Zero legacy .claude/identities or .claude/roles remain |

### workspace/ sub-part addition (File locations section)

The "File locations" section was rewritten to reflect the new tree root. Exact prose added for `workspace/`:

```
- `workspace/` — the identity's working directory (D-04). Generic — no repo-leaning; for
  maintainer identities it holds the repo they maintain, for other identities it may hold
  anything or nothing. Empty at identity creation; populated as the identity does work.
```

Additionally:

- Section heading changed from "Two peer folders at the top of `~/.claude/`" to "Three siblings under `~/fleet/`"
- `identities-archive/` sibling documented as a new bullet under the fleet root
- Closing sentence updated from "Both folders sit outside any project" to "All three siblings sit outside any project"

### STATE_DIR setup block (Trap 8 alignment)

Before:
```
mkdir -p ~/.claude/identities/<name>/relay-state
export STATE_DIR=~/.claude/identities/<name>/relay-state
export SINCE_FILE=~/.claude/identities/<name>/relay-state/since
```

After:
```
mkdir -p ~/fleet/identities/<name>/relay-state
export STATE_DIR=~/fleet/identities/<name>/relay-state
export SINCE_FILE=~/fleet/identities/<name>/relay-state/since
```

`$(dirname "$STATE_DIR")` in recv.sh now naturally resolves to `~/fleet/identities/<name>/` where `relay.json` lives.

### Retained references (unchanged per D-12/D-13/D-14)

- `~/.claude/CLAUDE.md` — 1 occurrence (line 111 area: "SKILL.md loads on every `/id <name>` invocation, and `~/.claude/CLAUDE.md` loads on every...")
- `~/.claude/skills/id/coordinator-instructions.md`, `~/.claude/skills/id/clone-picker-prompt.md`, `~/.claude/skills/id/actor-status-prompt.md`, `~/.claude/skills/agent-relay/recv.sh`, `~/.claude/skills/agent-relay/SKILL.md` — skill install-location references (D-13)
- `~/.local/bin/wakeup-scheduler`, `~/.local/bin/context-watch`, `~/.local/bin/role-file-watch` — installed binary paths (D-14)

Total retained `~/.claude/` count: 14 (confirmed unchanged via grep).

---

## Task 2: coordinator-instructions.md + clone-picker + actor-status + agent-relay SKILL.md

### coordinator-instructions.md

**Path rewrites applied:**
- Line 94: role wakeups folder `~/.claude/roles/<role>/wakeups/` → `~/fleet/roles/<role>/wakeups/`
- Line 98: `~/.claude/identities/<your-name>/wakeups/` → `~/fleet/identities/<your-name>/wakeups/`
- Line 232: name collision check `~/.claude/identities/<candidate>/` → `~/fleet/identities/<candidate>/`
- Lines 278-297: full spawn block (4 path refs in mkdir, touch, write, cp, relay.json write)
- Line 319: supervisor identity list `~/.claude/identities/*/` → `~/fleet/identities/*/`
- Line 342: role wakeups `~/.claude/roles/<role>/wakeups/` → `~/fleet/roles/<role>/wakeups/`
- Line 386: grep enumerate `~/.claude/identities/*/*.md` → `~/fleet/identities/*/*.md`
- Lines 415, 420-421: wakeup-scheduler role folder arg + state paths

**workspace mkdir step — full text as inserted:**

Step 3 added immediately after step 2 (`mkdir wakeups`):
```
3. `mkdir -p ~/fleet/identities/<name>/workspace` — generic working directory per D-04.
   Empty at birth; for maintainer identities it will later contain the repo they maintain;
   for others it may hold anything or nothing.
```

Step numbering: original steps 3→4, 4→5, 5→6 (relay.json write). Original step 6 (workdir mkdir + verify) was split: mkdir moved to new step 3, verification became new step 7.

Step 7 text:
```
7. ⚠️ **Verify the workspace exists** (`[ -d ~/fleet/identities/<name>/workspace ]`) before
   proceeding to dispatch. If the mkdir in step 3 failed silently (permissions / filesystem
   full / anything), escalate to Ashley per § Failure and cleanup — do NOT retry, do NOT
   proceed to dispatch. A missing workdir here means the actor's first launch would
   silently fall back to `$HOME`, which is not a supervised state.
```

**Retained:** `~/.local/bin/wakeup-scheduler` binary path (only its argument `~/fleet/roles/<role>` changed).

### clone-picker-prompt.md

3 rewrites:
- Line 17: `~/.claude/identities/<name>/handoff.md` → `~/fleet/identities/<name>/handoff.md`
- Line 19: `~/.claude/roles/<role>/bounties/*/bounty.json` → `~/fleet/roles/<role>/bounties/*/bounty.json`
- Line 37: `grep -l "^role: <TARGET_ROLE>$" ~/.claude/identities/*/*.md` → `~/fleet/identities/*/*.md`

### actor-status-prompt.md

3 rewrites (identical pattern to clone-picker):
- Line 13: handoff.md path
- Line 15: bounties glob
- Line 33: identities grep

### agent-relay/SKILL.md

**7 total rewrites (6 identity-path refs + 1 skynet-<name> ref):**

| Line (approx) | Before | After |
|---|---|---|
| 27 | `~/.claude/identities/<name>/` (prose) | `~/fleet/identities/<name>/` |
| 110 | `~/.claude/identities/<name>/relay.json` (creds prose) | `~/fleet/identities/<name>/relay.json` |
| 166 | `~/.claude/identities/<name>/relay.json` (comment in bash block) | `~/fleet/identities/<name>/relay.json` |
| 206 | `mkdir -p ~/.claude/identities/<name>` (commented snippet) | `mkdir -p ~/fleet/identities/<name>` |
| 208 | `> ~/.claude/identities/<name>/relay.json` (commented snippet) | `> ~/fleet/identities/<name>/relay.json` |
| 209 | `chmod 600 ~/.claude/identities/<name>/relay.json` (commented snippet) | `chmod 600 ~/fleet/identities/<name>/relay.json` |
| 481 | `~/skynet-<name>/substrate/skills/agent-relay/` | `~/fleet/identities/<name>/workspace/substrate/skills/agent-relay/` |

**Line 481 exact before/after:**

Before:
```
version through the normal Skynet path (edit under `~/skynet-<name>/substrate/skills/agent-relay/`,
commit, push, docker build + `--force-recreate` on t1000) and let the distributor propagate.
```

After:
```
version through the normal Skynet path (edit under `~/fleet/identities/<name>/workspace/substrate/skills/agent-relay/`,
commit, push, docker build + `--force-recreate` on t1000) and let the distributor propagate.
```

**Retained (D-13):** `~/.claude/skills/agent-relay/recv.sh` install path at lines 552–560 area (2 occurrences) — unchanged.

---

## Deviations from Plan

None. Plan executed exactly as written.

The only structural choice was splitting the original step 6 in coordinator-instructions.md (which combined mkdir + verify) across new step 3 (mkdir alongside wakeups) and new step 7 (verify before dispatch). This produces cleaner numbered flow with workspace creation happening immediately after wakeups creation, and the verification remaining as the final pre-dispatch gate.

---

## Historical Narrative Paragraphs

No prose paragraphs describing "before Phase 96" state were found. The id-skill body contains no historical narrative that needed to be preserved with legacy paths.

---

## Verification Output

```
# Task 1 automated verify:
bash -c 'c=$(grep -c "\.claude/identities\|\.claude/roles" substrate/skills/id/SKILL.md); \
  [ "$c" -eq 0 ] && grep -q "workspace/" substrate/skills/id/SKILL.md && \
  grep -q "~/fleet/identities" substrate/skills/id/SKILL.md'
→ VERIFY PASSED

# Task 2 automated verify:
bash -c 'for f in ...; do c=$(grep -c "\.claude/identities\|\.claude/roles" "$f"); \
  [ "$c" -eq 0 ] || { echo "FAIL: $f"; exit 1; }; done && \
  grep -q "mkdir -p ~/fleet/identities/<name>/workspace" coordinator-instructions.md && \
  ! grep -q "skynet-<name>" agent-relay/SKILL.md'
→ VERIFY PASSED

# Final counts per file:
substrate/skills/id/SKILL.md: 0 legacy hits | 30 fleet/identities refs | 14 retained refs
substrate/skills/id/coordinator-instructions.md: 0 legacy hits
substrate/skills/id/clone-picker-prompt.md: 0 legacy hits
substrate/skills/id/actor-status-prompt.md: 0 legacy hits
substrate/skills/agent-relay/SKILL.md: 0 legacy hits | 2 retained .claude/skills refs
```

---

## Known Stubs

None. All path references are fully wired to the fleet tree.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. All changes are prose rewrites in skill body files.

---

## Self-Check: PASSED

- substrate/skills/id/SKILL.md modified and committed: 23856c53
- substrate/skills/id/coordinator-instructions.md modified and committed: 9b1a2db1
- substrate/skills/id/clone-picker-prompt.md modified and committed: 9b1a2db1
- substrate/skills/id/actor-status-prompt.md modified and committed: 9b1a2db1
- substrate/skills/agent-relay/SKILL.md modified and committed: 9b1a2db1
- workspace/ documented in SKILL.md File locations section: confirmed
- workspace mkdir step in coordinator-instructions.md: confirmed
- STATE_DIR fleet path: confirmed
- Zero skynet-<name> references in touched files: confirmed
- D-12/D-13/D-14 retained references: confirmed (14 retained hits in SKILL.md, 2 in agent-relay/SKILL.md)
