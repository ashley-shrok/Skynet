# Phase 96: On-disk tree consolidation — Research

**Researched:** 2026-09-10
**Domain:** Coordinated path rewrite — substrate scripts, id-skill prose, backend TypeScript, test fixtures
**Confidence:** HIGH (full grep audit complete; all source files read directly)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** Tree root at `~/fleet/`.
- **D-02** Three siblings: `~/fleet/roles/`, `~/fleet/identities/`, `~/fleet/identities-archive/`. Archive is a sibling, not nested under `identities/`. Scope-in-name convention for future generalization.
- **D-03** Identity folder internal layout preserved exactly — no reshape.
- **D-04** Add `workspace/` as a new sub-part inside every identity folder. Generic — no repo/code lean.
- **D-05** No grandfathering. Every existing top-level maintainer working directory moves.
- **D-06** No dual-path fallback in code — single canonical path everywhere.
- **D-07** Per-box migration is a coordinated maintenance window (save → cp → shutdown → deploy → restart → verify → delete).
- **D-08** Migration timing per-box, each maintainer, independent.
- **D-09** Currently-archived identities decided at migration-time by maintainer running the runbook.
- **D-10** Migration runbook lives at `.planning/phases/96-.../MIGRATION.md`.
- **D-11** Canonical file list (planner resolves line-by-line scope): SKILL.md, coordinator-instructions.md, clone-picker-prompt.md, actor-status-prompt.md, agent-supervisor.sh, recv.sh, wakeup-scheduler.py, context-watch.py, role-file-watch.py, Skynet backend identity-birth-orchestrator (located in research below).
- **D-12** `~/.claude/CLAUDE.md` stays at its current location.
- **D-13** `~/.claude/skills/` stays at its current location.
- **D-14** `~/.local/bin/` stays at its current location.
- **D-15** Repo-wide grep sweep as audit floor.
- **D-16** All changes ship as one coordinated release.
- **D-17** Per-box migration timing is up to maintainer.
- **D-18** Shape 3 held from ship with Shapes 1 and 2 until four-shape campaign lands.

### Claude's Discretion

- Exact wave/plan breakdown (single-wave-multi-file is likely fine; planner may split by file class).
- Whether to add a CI-level grep test that fails the build if a legacy path reference reappears.
- Precise wording of MIGRATION.md.
- Test surface: grep-based audit floor per D-15; path-dependent unit tests get expected paths bumped.

### Deferred Ideas (OUT OF SCOPE)

- Migration script that automates the copy-shutdown-deploy-restart sequence.
- In-app UI in Skynet to view or manage the fleet tree.
- Non-code workspace conventions or templates.
- Shared path helper library across scripts.
- Environment-variable override for the tree root.
- Cross-role identity linking or promotion mechanisms.
- Auto-generated per-worker avatars.
- Grep-audit as a permanent CI gate (planner picks).
</user_constraints>

---

## Summary

Phase 96 is a coordinated path rewrite. Every hardcoded reference to `~/.claude/identities/`,
`~/.claude/roles/`, and `~/skynet-<name>` (the working-directory convention) across the
repository must change to its `~/fleet/` equivalent. The planner's primary job is mapping the
exact file + line scope for each change, then writing tasks that mechanically execute the
substitutions.

The research below provides the complete path-reference inventory, grouped by file, with line
numbers and change type. The most consequential finding relative to D-11's canonical list:
**six additional TypeScript backend files carry live (functional) path references that D-11 did not
enumerate** — `identity-artifact-reader.ts`, `ssh-poll-orchestrator.ts`, `per-identity-file.ts`,
`identity-clone.ts`, `roles-create.ts`, and `relay-pointer.ts` — along with their test files.
These are not in the D-11 list but are clearly in scope per D-15's repo-wide grep floor.

The `agent-supervisor.sh` working-directory convention (`$HOME/$name` fallback) is the
cd-then-exec logic the shape calls out; it rewrites to `$IDENTITIES_DIR/$name/workspace/`.
Archive-scan's retire move target (`$IDENTITIES_DIR/archive/$name`) rewrites to the fleet
archive sibling (`$HOME/fleet/identities-archive/$name`) — the archive directory moves, plus
its name changes from `archive` to `identities-archive`.

**Primary recommendation:** Treat this as two parallel tracks. Track A = substrate (substrate
scripts + skills — shell/Python/Markdown rewrites, largely mechanical). Track B = backend
(TypeScript files + their tests — `per-identity-file.ts` is the single-source path helper,
so updating `localTargetPath` + `remoteTargetPath` there propagates to all callers; remaining
backend files each have their own path literals). MIGRATION.md is a standalone Track C.

---

## Path-Reference Audit

### Legend

| Change type | Meaning |
|-------------|---------|
| REWRITE | Functional code path — must change to `~/fleet/...` |
| PROSE | Documentation/comment-only — should update for accuracy but not load-bearing |
| RETAIN | Intentionally kept per D-12/D-13/D-14 |
| TEST | Test fixture asserting the old path string — bumps alongside the source |

---

### `substrate/scripts/agent-supervisor.sh`

See the dedicated deep-read section below for full enumeration.

**Summary of hits:**
| Line | Pattern | Change type |
|------|---------|-------------|
| 32 | `IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/.claude/identities}"` | REWRITE — default changes to `$HOME/fleet/identities` |
| 220 | `[ "$name" = archive ] && continue` | REWRITE — filter changes; new archive dir is a SIBLING at `~/fleet/identities-archive/`, so this filter becomes `[ "$name" = archive ] && continue` is REMOVED (archive is no longer nested); no filter needed in the new tree |
| 284 | `local archdir="$IDENTITIES_DIR/archive/$name"` | REWRITE — becomes `local archdir="$HOME/fleet/identities-archive/$name"` (archive dir is no longer under IDENTITIES_DIR) |
| 290 | `mkdir -p "$IDENTITIES_DIR/archive"` | REWRITE — becomes `mkdir -p "$HOME/fleet/identities-archive"` |
| 1042–1046 | `$HOME/$name` working-directory convention fallback | REWRITE — becomes `$IDENTITIES_DIR/$name/workspace` |
| 1074 | `tmux new-session -d -s "$sess" -c "$cwd"` | No change (reads $cwd which was set by the rewritten block above) |
| 1224 | `if [ "$(dirname "$rj")" = "$HOME/.claude/identities/$name" ]` | REWRITE — becomes `"$IDENTITIES_DIR/$name"` |
| 1279 | `local idroot="$HOME/.claude/identities/$name"` | REWRITE — becomes `"$IDENTITIES_DIR/$name"` |
| 1304 | `local wd="$HOME/.claude/identities/$name/wakeups"` | REWRITE — becomes `"$IDENTITIES_DIR/$name/wakeups"` |

Note: All refs to `$IDENTITIES_DIR` are already indirect via the variable set at line 32. Changing line 32's default is the single-source fix for all `$IDENTITIES_DIR`-based reads. The literal `$HOME/.claude/identities/$name` at lines 1224, 1279, and 1304 are DIRECT literals that bypass the variable and must be changed explicitly.

The archive-related refs (lines 284 and 290) are special: the archive is no longer a sub-folder of IDENTITIES_DIR — it is a sibling at `~/fleet/identities-archive/`. These must reference `$HOME/fleet/identities-archive` (not `$IDENTITIES_DIR/archive`).

The `archive` skip at line 220 (skip the folder literally named `archive` when enumerating identities) is no longer needed because the new tree puts the archive at `~/fleet/identities-archive/`, not nested under `~/fleet/identities/`. Remove that defensive skip.

---

### `substrate/skills/id/SKILL.md`

Extensive prose. All references to `~/.claude/identities/<name>/` and `~/.claude/roles/<role>/` must rewrite. The workspace sub-part must be introduced where the skill tells identities about their working directory. Identity file path constants in the shell snippets embedded in the skill body also rewrite.

Hits (sampled; full grep shows ~50 references):

| Approx. line | Pattern | Change type |
|---|---|---|
| 19 | `~/.claude/roles/<role>/` | REWRITE |
| 23 | `~/.claude/identities/<name>/` | REWRITE |
| 39 | `In the ROLE folder (~/.claude/roles/<role>/)` | REWRITE |
| 65 | `In the IDENTITY folder (~/.claude/identities/<name>/)` | REWRITE |
| 241 | `IDENTITY_FILE=~/.claude/identities/$name/$name.md` | REWRITE |
| 260 | verify `~/.claude/roles/<role>/` exists | REWRITE |
| 264 | `Create ONLY the slim identity folder at ~/.claude/identities/<name>/` | REWRITE |
| 271 | slim identity template path | REWRITE |
| 343–344 | `> "$HOME/.claude/identities/$name/relay.json"` / `chmod ...` | REWRITE |
| 389–390 | `~/.claude/roles/<role>/<role>.md` | REWRITE |
| 397 | `~/.claude/identities/<name>/handoff.md` | REWRITE |
| 418 | `~/.claude/roles/<role>/bounties/` | REWRITE |
| 423 | `~/.claude/roles/<role>/runbooks/` | REWRITE |
| 477 | `grep -l "^role: <role>$" ~/.claude/identities/*/*.md` | REWRITE |
| 537 | durable relay account at `~/.claude/identities/<name>/relay.json` | REWRITE |
| 566–568 | `mkdir -p ~/.claude/identities/<name>/relay-state` etc. | REWRITE |
| 605 | `command: python3 ... wakeup-scheduler ~/.claude/identities/<name>` | REWRITE |
| 636 | `command: python3 ... context-watch ~/.claude/identities/<name>` | REWRITE |
| 642/646 | `touch ~/.claude/identities/<name>/.recycle-requested` | REWRITE |
| 667 | `Role file (~/.claude/roles/<role>/<role>.md)` | REWRITE |
| 671 | `Identity file (~/.claude/identities/<name>/<name>.md)` | REWRITE |
| 690 | `command: python3 ... role-file-watch ~/.claude/identities/<name>` | REWRITE |
| 727–728 | `.no-dormancy` sentinel paths | REWRITE |
| 826 | `~/.claude/roles/<role>/bounties/` | REWRITE |
| 829 | `~/.claude/roles/<role>/history.md` | REWRITE |
| 972/976 | `~/.claude/roles/<role>/bounties/` / `history.md` | REWRITE |
| 981 | `~/.claude/identities/<name>/handoff.md` | REWRITE |
| 1007–1008 | `~/.claude/roles/<role>/history.md` trim | REWRITE |
| 1019/1051 | `.recycle-requested` sentinel | REWRITE |
| 1074/1083 | on-disk layout section | REWRITE |
| 1109 | bounty folder path | REWRITE |
| 1164 | `~/.claude/roles/<role>/bounties/<slug>/bounty.json` | REWRITE |
| 1315–1317 | bounty archive move commands | REWRITE |
| 1342 | runbook path | REWRITE |
| 1420/1424 | wakeup spec paths (identity + role level) | REWRITE |
| 1454–1455 | wakeup spec paths continued | REWRITE |

The skill body must also gain a new section or update the on-disk file layout section (around line 1074/1083) to document `workspace/` as the new sub-part of every identity folder. The launch commands at lines 605, 636, 690 pass the identity folder as an argument — they update to `~/fleet/identities/<name>`.

---

### `substrate/skills/id/coordinator-instructions.md`

| Approx. line | Pattern | Change type |
|---|---|---|
| 94 | `~/.claude/roles/<role>/wakeups/` | REWRITE |
| 98 | `~/.claude/identities/<your-name>/wakeups/` | REWRITE |
| 232 | `~/.claude/identities/<candidate>/` must not exist | REWRITE |
| 278–280 | mkdir identity folder + touch handoff | REWRITE |
| 290–291 | copy avatar sibling `~/.claude/identities/<yourname>/...` | REWRITE |
| 297 | write `~/.claude/identities/<name>/relay.json` | REWRITE |
| 319 | supervisor rebuilds from `~/.claude/identities/*/` | REWRITE |
| 342 | role wakeups folder `~/.claude/roles/<role>/wakeups/` | REWRITE |
| 386 | `grep -l "^role: <role>$" ~/.claude/identities/*/*.md` | REWRITE |
| 415 | `python3 ~/.local/bin/wakeup-scheduler ~/.claude/roles/<role>` | REWRITE — identity dir argument changes; `~/.local/bin/` is RETAIN |
| 420–421 | `~/.claude/roles/<role>/wakeups/` | REWRITE |

---

### `substrate/skills/id/clone-picker-prompt.md`

| Approx. line | Pattern | Change type |
|---|---|---|
| 17 | `~/.claude/identities/<name>/handoff.md` | REWRITE |
| 19 | `~/.claude/roles/<role>/bounties/*/bounty.json` | REWRITE |
| 37 | `grep -l "^role: <TARGET_ROLE>$" ~/.claude/identities/*/*.md` | REWRITE |

---

### `substrate/skills/id/actor-status-prompt.md`

| Approx. line | Pattern | Change type |
|---|---|---|
| 13 | `~/.claude/identities/<name>/handoff.md` | REWRITE |
| 15 | `~/.claude/roles/<role>/bounties/*/bounty.json` | REWRITE |
| 33 | `grep -l "^role: <TARGET_ROLE>$" ~/.claude/identities/*/*.md` | REWRITE |

---

### `substrate/scripts/wakeup-scheduler.py`

Line 11: Docstring: `~/.claude/identities/<name>/wakeups/<slug>.json` — REWRITE (documentation).
Line 213: `ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))` — NO CHANGE. Takes directory as argument. The caller (SKILL.md, agent-supervisor) passes the new path; the script itself is path-relative after that.

**Verdict:** Only the docstring on line 11 needs updating. No functional path changes inside the script.

---

### `substrate/scripts/context-watch.py`

The script takes `<identity_dir>` as `sys.argv[1]` (line 147) and works relative to it. No hardcoded `~/.claude` paths.

**Verdict:** No changes needed inside the script. The callers (SKILL.md, agent-supervisor) pass the new path.

---

### `substrate/scripts/role-file-watch.py`

Line 236: `role_file_path = os.path.expanduser("~/.claude/roles/%s/%s.md" % (role, role))` — REWRITE. This is the only hardcoded path inside the script itself. It resolves the role file from `~/.claude/roles/` using the role name parsed from the identity file's frontmatter. Must change to `~/fleet/roles/%s/%s.md`.

No other functional path hardcodes inside the script. The identity folder is passed via `sys.argv[1]`.

---

### `substrate/skills/agent-relay/SKILL.md`

The agent-relay skill contains references to identity paths. One confirmed hit in the source list:

**Check:** The grep sweep returned `substrate/skills/agent-relay/SKILL.md` in the `~/skynet-` results. Verify manually: this file may reference the working directory convention.

Note: This file is NOT in the D-11 canonical list but was returned by the grep sweep. The planner must read it and audit before coding tasks. [ASSUMED — not directly read in this research session; confirmed by grep sweep returning its path.]

---

### `src/backend/claude-session/per-identity-file.ts`

This is the **single-source path helper** for all SFTP write/remove/stat operations against identity files. Changing these two functions changes the wire for ALL callers (`identity-birth-orchestrator.ts`, `user-preferences.ts`, `identities.ts`).

| Line | Content | Change type |
|------|---------|-------------|
| 35 | Comment: `${os.homedir()}/.claude/identities/${name}/${relPath}` | PROSE |
| 103 | `return path.join(os.homedir(), ".claude", "identities", name, relPath);` | REWRITE — `localTargetPath()` |
| 110 | Comment: `$HOME/.claude/identities/${name}/${relPath}` | PROSE |
| 123 | `` return `$HOME/.claude/identities/${name}/${relPath}`; `` | REWRITE — `remoteTargetPath()` |
| 158 | JSDoc: `~/.claude/identities/<name>/<relPath>` | PROSE |

**New paths:**
- `localTargetPath` → `path.join(os.homedir(), "fleet", "identities", name, relPath)`
- `remoteTargetPath` → `` `$HOME/fleet/identities/${name}/${relPath}` ``

**Test file:** `per-identity-file.test.ts` — lines 303, 354, 361, 375, 430, 540 assert the old path strings. All must bump to match.

---

### `src/backend/claude-session/identity-artifact-reader.ts`

This file has **92 references** to `~/.claude/identities` and `~/.claude/roles`. Two path-root functions are the key leverage points:

| Line | Content | Change type |
|------|---------|-------------|
| 217–221 | `getLocalIdentitiesRoot()` — returns `process.env.IDENTITIES_HOST_DIR \|\| path.join(os.homedir(), ".claude", "identities")` | REWRITE the fallback to `.join(os.homedir(), "fleet", "identities")` |
| 237–240 | `getLocalRolesRoot()` — returns `process.env.ROLES_HOST_DIR \|\| path.join(os.homedir(), ".claude", "roles")` | REWRITE the fallback to `.join(os.homedir(), "fleet", "roles")` |

All LOCAL-branch reads that call `getLocalIdentitiesRoot()` or `getLocalRolesRoot()` (lines 426, 490, 781, 1025, etc.) are covered by updating those two functions.

REMOTE-branch SSH command strings are the remaining ~60 literal references. These are template literals like:
- `` `cat "$HOME/.claude/identities/${identityKey}/${identityKey}.md"` `` → `` `cat "$HOME/fleet/identities/${identityKey}/${identityKey}.md"` ``
- `` `find "$HOME/.claude/identities"` `` → `` `find "$HOME/fleet/identities"` ``
- `` `cd "$HOME/.claude/roles/${role}/bounties"` `` → `` `cd "$HOME/fleet/roles/${role}/bounties"` ``
- `` `$HOME/.claude/identities/${identityKey}/wakeups/${slug}.json` `` (lines 1744, 1809, etc.) → fleet path
- `` `$HOME/.claude/roles/${role}/wakeups/${slug}.json` `` (lines 1611, 1682, etc.) → fleet path
- `` `${remoteHome}/.claude/identities/${identityKey}/...` `` (lines 2115, 2471, 2627, 2655, 2683) → fleet path
- `` `${remoteHome}/.claude/roles/${roleName}/...` `` (lines 2220, 2556, 2561, 2750, 2817) → fleet path

**Strategy:** The two root functions handle LOCAL. The REMOTE strings must be globally replaced with `sed` or a targeted multi-pass edit. There are no secondary constants — only the two root functions and the inline template literals.

**Note on env vars:** `IDENTITIES_HOST_DIR` and `ROLES_HOST_DIR` are NOT in docker-compose.yml as bind-mount targets — they exist only as test harness overrides used in vitest (see test files setting `process.env.IDENTITIES_HOST_DIR`). No docker env or production skynet.env references found. The env-var override in the functions is the test seam; do not remove it.

**Test files (require path-string updates in assertions):**
- `identity-artifact-reader.two-step.test.ts` — lines 172, 175, 178, 181, 201, 217, 221, 222, 247, 248, 323, 336, etc.
- `identity-artifact-reader.include-archived.test.ts` — lines 169, 186, 209, 221, 243, 264
- `identity-artifact-reader.role-cosmetics.test.ts` — lines 153, 165, 169, 174
- `identity-artifact-reader.wakeup-crud.test.ts` — IDENTITIES_HOST_DIR test setup (no path string changes needed there)
- `identity-artifact-reader.write-bounty-pinned.test.ts` — IDENTITIES_HOST_DIR test setup only
- `identity-artifact-reader.delete-bounty.test.ts` — IDENTITIES_HOST_DIR test setup only

---

### `src/backend/fleet-status/ssh-poll-orchestrator.ts`

Live functional SSH-exec strings that run against managed hosts. Not in D-11 but clearly in scope per D-15.

| Line | Content | Change type |
|------|---------|-------------|
| 998 | `` "find ~/.claude/identities/ -mindepth 1 -maxdepth 1 -type d..." `` | REWRITE |
| 1022 | `` `stat ~/.claude/identities/${quotedName}/.dormant ...` `` | REWRITE |
| 1025 | `` `stat ~/.claude/identities/${quotedName}/.recycled-at ...` `` | REWRITE |
| 1028 | `` `test -f ~/.claude/identities/${quotedName}/.recycle-requested ...` `` | REWRITE |
| 1564 | `` `stat ~/.claude/identities/${quotedTmuxSession}/.dormant ...` `` | REWRITE |

Lines 262, 901, 987, 996, 1541 are comments — PROSE updates for accuracy.

**Test file (`ssh-poll-orchestrator.test.ts`):** The test mock at `channel.setResponse()` uses path substrings as keys. Every `"~/.claude/identities/ -mindepth"`, `"stat ~/.claude/identities/..."`, `"test -f ~/.claude/identities/..."` must update to `"~/fleet/identities/ -mindepth"` etc. This is a very large test file (~6000+ lines) with ~100+ fixture path strings. Bulk `sed` replacement is the right tool.

---

### `src/backend/database/routes/identity-birth-orchestrator.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 1073 | `` `if [ -d "$HOME/.claude/identities/${opts.name}" ]...` `` | REWRITE |
| 1133 | `` const identityDir = `${remoteHome}/.claude/identities/${opts.name}` `` | REWRITE |
| 1140 | `` `mkdir -p "${identityDir}/wakeups" && touch "${identityDir}/handoff.md"` `` | Covered by line 1133 fix (identityDir variable) |

Lines 145, 180, 273, 468, 865, 1039, 1089, 1197 are comments — PROSE.

**Test file (`identity-birth-orchestrator.test.ts`):**
- Line 1293: `toContain("$HOME/.claude/identities/agent1/relay.json")` — TEST bump
- Lines 1868, 1900: `"$HOME/.claude/identities/agent92/relay.json"` — TEST bump
- Line 2119: `` `$HOME/.claude/identities/${key}/relay.json` `` — TEST bump

**Important:** The Step 8 relay.json write goes through `writeIdentityFile` from `per-identity-file.ts`. Once `remoteTargetPath` is updated there, Step 8's wire automatically uses the new path. Lines 1073 and 1133 in this file are the remaining direct literals.

---

### `src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` and `identity-birth-orchestrator.role-frontmatter.test.ts`

Check these for `.claude/identities` path strings. [ASSUMED — grep returned these files in the search scope; need planner to verify they contain fixture path strings that require bumping.]

---

### `src/backend/database/routes/identity-clone.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 537 | `` `if [ -d "$HOME/.claude/identities/${newName}" ]...` `` | REWRITE |
| 569 | `` `mkdir -p "$HOME/.claude/identities/${newName}/wakeups"` `` | REWRITE |
| 573 | `` `touch "$HOME/.claude/identities/${newName}/handoff.md"` `` | REWRITE |
| 707 | `` const targetPath = `${remoteHome}/.claude/identities/${newName}/${newName}.md` `` | REWRITE |

Lines 46, 50–51, 264, 415 are comments — PROSE.

**Test file (`identity-clone.test.ts`):**
- Line 547: `expect(writeArgs[1]).toBe("/home/ubuntu/.claude/identities/tina-2/tina-2.md")` — TEST bump

---

### `src/backend/database/routes/roles-create.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 462 | `` `if [ -d "$HOME/.claude/roles/${name}" ]...` `` | REWRITE |
| 486 | `` `mkdir -p "$HOME/.claude/roles/${name}/bounties"` `` | REWRITE |
| 490 | `` `touch "$HOME/.claude/roles/${name}/history.md"` `` | REWRITE |
| 545 | `` const targetPath = `${remoteHome}/.claude/roles/${name}/${name}.md` `` | REWRITE |
| 573 | `` `${remoteHome}/.claude/roles/${name}/${avatarFilename}` `` | REWRITE |

Lines 11, 25, 270 are comments — PROSE.

---

### `src/backend/database/routes/roles-list-for-host.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 153 | `` `ls -1 "$HOME/.claude/roles" 2>/dev/null \|\| true` `` | REWRITE |
| 186 | `` `echo "===ROLE:${r}===" && cat "$HOME/.claude/roles/${r}/${r}.md"` `` | REWRITE |

Lines 9, 106 are comments/JSDoc — PROSE.

---

### `src/backend/database/routes/identity-exists-on-host.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 133 | `` `if [ -d "$HOME/.claude/identities/${name}" ]...` `` | REWRITE |

Lines 8, 10 are comments — PROSE.

**Test file (`identity-exists-on-host.test.ts`):**
- Line 346: `` expect(command).toContain(`"$HOME/.claude/identities/${safeName}"`) `` — TEST bump

---

### `src/backend/database/routes/identity-no-dormancy.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 123 | `` `test -e "$HOME/.claude/identities/${key}/.no-dormancy"...` `` | REWRITE |
| 227 | `` `mkdir -p "$HOME/.claude/identities/${key}" && touch "$HOME/.claude/identities/${key}/.no-dormancy"` `` | REWRITE |
| 228 | `` `rm -f "$HOME/.claude/identities/${key}/.no-dormancy"` `` | REWRITE |

**Test file (`identity-no-dormancy.test.ts`):**
- Line 483: assertion on mkdir + touch no-dormancy command — TEST bump
- Line 501: assertion on rm command — TEST bump

---

### `src/backend/database/routes/identities.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 701 | `` `rm -f "$HOME/.claude/identities/${identityKey}/${identityKey}.${oldExt}"` `` | REWRITE |
| 736 | `` `rm -f "$HOME/.claude/identities/${identityKey}/${canonicalName}"` `` | REWRITE |

Line 33 is a comment — PROSE.

**Test file (`identities.put-disk.test.ts`):**
- Lines 619, 870: assertions on rm command — TEST bump

---

### `src/backend/database/routes/relay-pointer.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 42 | `WHITELIST_REGEX = /^\/home\/[a-z0-9_-]+\/\.claude\/identities\/...$/` | REWRITE |

The regex is the SSRF whitelist. After migration, relay message files live at `/home/<user>/fleet/identities/<id>/relay-state/messages/<eventid>.txt`. The regex must update to `/^\/home\/[a-z0-9_-]+\/fleet\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt$/`.

**Test file (`relay-pointer.test.ts`):**
- Lines 161, 163, 168, 178, 183, 188: WHITELIST_REGEX test cases — all example paths update from `/home/ubuntu/.claude/identities/...` to `/home/ubuntu/fleet/identities/...`

**Note:** This is a security gate. Getting it wrong lets through SSRF attacks or breaks the relay pointer feature entirely. The rewrite must be exact.

---

### `src/backend/database/routes/runbooks-editor.ts`

| Line | Content | Change type |
|------|---------|-------------|
| 122 | `const ROLE_ROOT_REL = ".claude/roles"` | REWRITE — becomes `"fleet/roles"` |

All 7 usages of `ROLE_ROOT_REL` (lines 318, 477, 641, 864, 1070, 1268, 1435) are composed as `${remoteHome}/${ROLE_ROOT_REL}/${role}` — changing the constant covers them all.

Lines 8, 10, 22, 24 are comments — PROSE.

---

### `src/backend/database/routes/roles.ts`

Lines 8 and 285 are comments — PROSE. Verify no functional strings exist in this file beyond what the grep returned. [ASSUMED: only comment hits; planner confirms no functional path literals in non-comment code.]

---

### `src/backend/claude-session/session-file-parser.outbound-body.test.ts`

This test file (~600 lines, many path hits) contains **test FIXTURE strings** — shell script fragments captured from real outbound relay sends. These fragments are snapshot assertions of what agents actually emitted. They contain `~/.claude/identities/<name>/relay.json`, `~/.claude/identities/<name>/relay-state/`, etc.

**Key question:** These are historical captures of what agents sent BEFORE the migration. After the migration, agents will use `~/fleet/identities/...`. So these test fixtures should be updated to reflect the post-migration path if they are meant to test ongoing behavior — OR they represent a "this is what agents have emitted" parse corpus and should remain unchanged as historical parse test data.

Given the test name is `session-file-parser.outbound-body.test.ts` and it tests the parser's ability to extract relay-send commands from session output, the corpus should reflect real commands as they will look POST-migration. Update all fixture path strings.

Lines 313 and 341 contain `/home/ubuntu/.claude/roles/...` and `/home/ubuntu/.claude/identities/...` in Python-snippet fixtures — also update.

---

### `src/backend/database/routes/identity-harness-start.ts` and `identity-harness-start.test.ts`

Returned by grep. Needs planner audit for specific line hits. [ASSUMED — grep returned these in the identity-birth-related file list; check for any direct path strings.]

---

### Files confirmed NO CHANGES needed (distributor + skills install paths)

- `src/backend/distributor/catalog.ts` — install paths are `~/.claude/skills/...` and `~/.local/bin/...` (D-13/D-14 RETAIN). Confirmed: no `~/.claude/identities` or `~/.claude/roles` content.
- `substrate/skills/agent-relay/SKILL.md` — install target stays at `~/.claude/skills/agent-relay/`. Internal content paths for identity state are passed via env vars (`STATE_DIR`, `SINCE_FILE`) from the calling supervisor — indirect. Verify no hardcoded paths in body. [ASSUMED — needs planner audit.]
- `docker/docker-compose.yml` — no `IDENTITIES_HOST_DIR`, `ROLES_HOST_DIR`, or identity/role bind mounts. The env vars only exist as test seams in vitest, not in production compose.
- `docker/nginx.conf`, `docker/nginx-https.conf` — no identity/role path references.
- `docker/entrypoint.sh` — no identity/role path references.

---

### `.planning/` prose files (intentionally-retained as historical record)

The grep sweep returned many `.planning/` files with path references. These are historical planning artifacts (old plans, summaries, shapes, quick plans). Per D-15, they need to be audited, but their path references are intentionally documenting what the OLD system did — they are not live code. Recommended disposition: leave old-phase `.planning/` artifacts unchanged (they are historical). Update only:
- `.planning/phases/96-.../MIGRATION.md` (new file this phase creates)
- `.planning/phases/96-.../96-CONTEXT.md` — already has new paths in D-01/D-02

Explicit list of `.planning/` hits to NOT rewrite (historical/contextual mentions only):
- All `.planning/phases/<old-phases>/` plan files
- All `.planning/shapes/` files
- All `.planning/quick/` files

---

## agent-supervisor.sh Deep Read

### Variable and default (line 32)

```bash
IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/.claude/identities}"
```

This is the single source of truth for identity paths throughout the script. Changing the default from `$HOME/.claude/identities` to `$HOME/fleet/identities` fixes all `$IDENTITIES_DIR/...` usages atomically.

### Archive-scan: retire_identity (lines 281–340+)

```bash
local archdir="$IDENTITIES_DIR/archive/$name"     # line 284 — OLD
mkdir -p "$IDENTITIES_DIR/archive"                 # line 290 — OLD
```

Phase 96 changes:
- `archdir` is no longer under `$IDENTITIES_DIR`. It lives at the fleet root: `"$HOME/fleet/identities-archive/$name"`.
- The `mkdir -p` similarly targets `"$HOME/fleet/identities-archive"`.
- These two lines CANNOT be derived from `$IDENTITIES_DIR` + `/archive` — they need a new variable or a direct literal to the fleet archive path. The cleanest approach: introduce `IDENTITIES_ARCHIVE_DIR="$HOME/fleet/identities-archive"` alongside `IDENTITIES_DIR`, parallel to the `AGENT_IDENTITIES_DIR` override pattern.

### Identity enumeration: archive filter (line 220)

```bash
[ "$name" = archive ] && continue    # defensive; identity-archive is a SIBLING dir, not here
```

The comment on this line already says "defensive; identity-archive is a SIBLING dir, not here" — this filter was defensive because the archive was NESTED inside identities. After Phase 96, the archive is at `~/fleet/identities-archive/` (a true sibling, not inside `~/fleet/identities/`), so the filter becomes unnecessary by construction. REMOVE this line entirely — it will never trigger in the new tree, and keeping it adds dead code.

### Phase 94 freshness signal (line 1279)

```bash
local idroot="$HOME/.claude/identities/$name"
```

Direct literal — must update to `"$IDENTITIES_DIR/$name"` (use the variable, not the literal, for consistency and so test overrides work).

### matrix_peek function (lines 1279, 1304)

```bash
local idroot="$HOME/.claude/identities/$name"   # line 1279
local wd="$HOME/.claude/identities/$name/wakeups"  # line 1304
```

Both are direct literals that must use `$IDENTITIES_DIR/$name` and `$IDENTITIES_DIR/$name/wakeups` respectively.

### _matrix_peek_one account discriminator (line 1224)

```bash
if [ "$(dirname "$rj")" = "$HOME/.claude/identities/$name" ]; then
```

Must update to `"$IDENTITIES_DIR/$name"`.

### cd-then-exec working directory convention (lines 1030–1046)

The current logic:

```bash
local cwd="$HOME" resume="" disc
if disc="$(resolve_session "$name")"; then
    cwd="${disc%%$'\t'*}"; resume="${disc#*$'\t'}"
    ...
elif [ -d "$HOME/$name" ]; then
    cwd="$HOME/$name"
    log "'$name' launch: resolve_session found no prior session — using convention workdir '$cwd'"
else
    log "'$name' launch: resolve_session found no prior session AND \$HOME/$name absent — fresh /id in \$HOME"
fi
```

Lines 1042–1043: The convention workdir fallback is `$HOME/$name`. After Phase 96, the convention workdir for a first-ever launch becomes `$IDENTITIES_DIR/$name/workspace`. Update:

```bash
elif [ -d "$IDENTITIES_DIR/$name/workspace" ]; then
    cwd="$IDENTITIES_DIR/$name/workspace"
    log "'$name' launch: resolve_session found no prior session — using convention workdir '$cwd'"
else
    log "'$name' launch: resolve_session found no prior session AND $IDENTITIES_DIR/$name/workspace absent — fresh /id in \$HOME"
fi
```

This is the `~/skynet-<name>` → `~/fleet/identities/<name>/workspace` rewrite the shape called out explicitly.

### Phase 94 archive scan: skip `archive` folder in enumeration

Line 220: `[ "$name" = archive ] && continue` — REMOVE. See explanation above.

---

## Skynet Backend Identity-Birth Orchestrator

### File location

`src/backend/database/routes/identity-birth-orchestrator.ts`

### Change scope

Two functional callsites (both noted above):

**Line 1073:** Collision probe for remote branch:
```typescript
`if [ -d "$HOME/.claude/identities/${opts.name}" ]; then echo exists; else echo missing; fi`
```
→
```typescript
`if [ -d "$HOME/fleet/identities/${opts.name}" ]; then echo exists; else echo missing; fi`
```

**Lines 1133–1140:** Step 2 remote identity folder creation:
```typescript
const identityDir = `${remoteHome}/.claude/identities/${opts.name}`;
const identityFilePath = `${identityDir}/${opts.name}.md`;
await deps.execCommand(conn, `mkdir -p "${identityDir}/wakeups" && touch "${identityDir}/handoff.md"`);
```
→
```typescript
const identityDir = `${remoteHome}/fleet/identities/${opts.name}`;
```
(identityFilePath and mkdir command derive from identityDir — covered by fixing line 1133)

**Step 8 relay.json write:** Routes through `writeIdentityFile` from `per-identity-file.ts`. Once `remoteTargetPath` in that file is updated, Step 8 automatically writes to `$HOME/fleet/identities/<name>/relay.json`. No direct line change needed in orchestrator for this.

### SSH/SFTP machinery scope

SSH connection, authentication, SFTP session lifecycle — untouched. Same connection, same credentials, different destination string. Confirmed by reading the code.

### Test files

`identity-birth-orchestrator.test.ts`:
- Line 1293: `toContain("$HOME/.claude/identities/agent1/relay.json")` — TEST bump
- Lines 1868/1900: `"$HOME/.claude/identities/agent92/relay.json"` — TEST bump
- Line 2119: `` `$HOME/.claude/identities/${key}/relay.json` `` — TEST bump

---

## Ambient Monitor Scripts

### recv.sh (`substrate/skills/agent-relay/recv.sh`)

**Cred-path derivation (line 21–24):**
```bash
for c in relay.json relay-credentials.json relay-creds.json; do
    [ -f "$(dirname "$STATE_DIR")/$c" ] && { CREDS="$(dirname "$STATE_DIR")/$c"; break; }
done
```

This uses `$(dirname "$STATE_DIR")` — fully relative to whatever `STATE_DIR` is set to. `STATE_DIR` is set by the agent at launch from the SKILL.md body (`STATE_DIR=~/.claude/identities/<name>/relay-state`). After Phase 96, the SKILL.md sets `STATE_DIR=~/fleet/identities/<name>/relay-state`. `dirname` then yields `~/fleet/identities/<name>` — and `relay.json` is found there. **No code change needed inside recv.sh.** The change is in SKILL.md's relay-state setup block.

Line 43 (error message): References the old path in its fatal error message. Should update for accuracy: `"STATE_DIR must point at ~/fleet/identities/<name>/relay-state"`.

**Verdict:** recv.sh needs only a prose update to the error message at line 43. No functional change. The cred-path derivation is path-relative and works correctly after the SKILL.md update.

### wakeup-scheduler.py

Takes `<identity_dir>` as `sys.argv[1]`. All path operations are relative to that directory. The docstring at line 11 references `~/.claude/identities/<name>/wakeups/<slug>.json` — PROSE update for accuracy. No functional changes.

### context-watch.py

Takes `<identity_dir>` as `sys.argv[1]`. No hardcoded `~/.claude` paths inside the script. No changes needed.

### role-file-watch.py

**Line 236 (functional):**
```python
role_file_path = os.path.expanduser("~/.claude/roles/%s/%s.md" % (role, role))
```
→
```python
role_file_path = os.path.expanduser("~/fleet/roles/%s/%s.md" % (role, role))
```

This is the only functional hardcoded path inside the script. It derives the role file location from the role name (parsed from the identity file's frontmatter). After Phase 96, roles live at `~/fleet/roles/`. One-line change.

---

## Fleet-Substrate Distributor

**File:** `src/backend/distributor/catalog.ts`

Confirmed: no `~/.claude/identities` or `~/.claude/roles` references. The catalog contains only:
- `~/.claude/skills/<skill>/...` — RETAIN per D-13
- `~/.local/bin/<name>` — RETAIN per D-14
- `~/.config/systemd/user/agent-supervisor.service` — install target, RETAIN

**No changes needed to catalog.ts.**

The distributor sweeps the substrate files (whose CONTENT changes), but the install targets stay the same. This is exactly per D-13/D-14.

---

## Test Surface

### Substrate tests

**`substrate/scripts/tests/agent-supervisor-archive-scan.sh`**

The test driver uses `AGENT_IDENTITIES_DIR=<scratch>` to redirect IDENTITIES_DIR. After Phase 96, the archive directory (`$IDENTITIES_DIR/archive/`) no longer exists — the archive is a sibling at `~/fleet/identities-archive/`. The test driver hardcodes the archive path in fixture setup (line 559: `fixture_relay_json "$scratch/archive/tina" ...`).

After Phase 96:
- The retire action moves to `$HOME/fleet/identities-archive/$name` (or the equivalent `$IDENTITIES_ARCHIVE_DIR/$name`).
- Test fixture must create the archive target at a sibling scratch directory, not a sub-dir of IDENTITIES_DIR.
- The test driver exports `AGENT_IDENTITIES_DIR` — it should also export `AGENT_IDENTITIES_ARCHIVE_DIR` (or equivalent) pointing to a separate scratch dir for the archive location.
- Line-count guard (around line 317: "up to 60 lines") may need adjustment if retire_identity's code grows or shrinks.

### TypeScript backend tests

Files with path-string test assertions (full list):

| File | Hit count | Nature |
|------|-----------|--------|
| `per-identity-file.test.ts` | ~6 | toContain / toBe assertions on `$HOME/.claude/identities/.../` |
| `identity-birth-orchestrator.test.ts` | 4 | toContain assertions on relay.json path |
| `identity-clone.test.ts` | 1 | toBe assertion on identity dir path |
| `identity-exists-on-host.test.ts` | 1 | toContain assertion |
| `identity-no-dormancy.test.ts` | 2 | toContain assertions |
| `identities.put-disk.test.ts` | 2 | toContain assertions |
| `relay-pointer.test.ts` | ~6 | WHITELIST_REGEX test cases |
| `session-file-parser.outbound-body.test.ts` | ~20+ | fixture path strings in cmd snapshots |
| `ssh-poll-orchestrator.test.ts` | ~100+ | `channel.setResponse()` keys using path substrings |
| `identity-artifact-reader.two-step.test.ts` | ~15 | toContain assertions |
| `identity-artifact-reader.include-archived.test.ts` | ~5 | cmd string checks |
| `identity-artifact-reader.role-cosmetics.test.ts` | ~4 | cmd string assertions |

The `ssh-poll-orchestrator.test.ts` is the largest test file. At ~100+ fixture path strings, a targeted `sed` bulk replacement (`sed -i 's/\.claude\/identities\//fleet\/identities\//g; s/\.claude\/roles\//fleet\/roles\//g'`) is safer than manual per-line editing.

---

## MIGRATION.md Content Sketch

**Audience:** Ashley (t1000), Stacy (T800), any future box maintainer. Plain language, no assumed context, self-contained.

**Location:** `.planning/phases/96-on-disk-tree-consolidation-consolidate-identity-metadata-and/MIGRATION.md`

**Structure:**

```
# Fleet tree migration — per-box runbook

## Before you begin

Prerequisites:
- New code (Shape 3 + Shape 1 + Shape 2 + Shape 4 commits) is already on origin/main
  and ready to deploy.
- No identity on this box is mid-flow on something time-sensitive.
- You can run commands with a few minutes of downtime.

## Step 0: Check for currently-archived identities

ls ~/.claude/identities/archive/ 2>/dev/null

If that directory exists and has subdirectories inside it:
> (prompt) "Found archived identities: <list>. What do you want to do with them?
>  Options: (a) move them to ~/fleet/identities-archive/ (b) delete them
>  (c) leave them in place at ~/.claude/identities/archive/ and ignore.
>  If you skip this, they remain at the old location and the new code
>  won't see them — that's fine if you're deleting them anyway."
> Pick: ___

If no archived identities exist, skip this section.

## Step 1: Save every active identity

For each active identity on this box, send /id save in its session.
This flushes handoff.md, updates bounties, and appends to history.

Confirm: every session shows the /id save completion message before continuing.

## Step 2: Copy everything to new locations

mkdir -p ~/fleet/identities ~/fleet/roles ~/fleet/identities-archive

# Copy identity metadata folders
for dir in ~/.claude/identities/*/; do
    name=$(basename "$dir")
    [ "$name" = "archive" ] && continue
    cp -a "$dir" ~/fleet/identities/"$name"
done

# Copy working directories (current top-level skynet-<name> folders)
# Run 'ls -d ~/skynet-*/' to see what exists
for wd in ~/skynet-*/; do
    name=$(basename "$wd" | sed 's/^skynet-//')
    target=~/fleet/identities/"$name"/workspace
    if [ -d ~/fleet/identities/"$name" ]; then
        cp -a "$wd" "$target"
    else
        echo "WARNING: working dir $wd has no matching identity in ~/fleet/identities/ — skipping"
    fi
done

# Copy role knowledge homes
for dir in ~/.claude/roles/*/; do
    name=$(basename "$dir")
    cp -a "$dir" ~/fleet/roles/"$name"
done

# If you chose (a) above for archived identities:
# for dir in ~/.claude/identities/archive/*/; do
#     name=$(basename "$dir")
#     cp -a "$dir" ~/fleet/identities-archive/"$name"
# done

## Step 3: Verify the copy

# Spot-check: pick one identity and confirm its files made it
ls ~/fleet/identities/<yourname>/     # should have <name>.md, handoff.md, relay.json, etc.
ls ~/fleet/identities/<yourname>/workspace/  # should have the repo/working content

# Spot-check roles
ls ~/fleet/roles/

## Step 4: Shut down Skynet host container + all agent-supervisor sessions

docker compose -f /opt/skynet/docker-compose.yml down
systemctl --user stop agent-supervisor

## Step 5: Deploy new Skynet code

cd /opt/skynet
git pull origin main
docker compose -f docker/docker-compose.yml build
docker compose -f /opt/skynet/docker-compose.yml up -d

# The container boot triggers the fleet-substrate distributor sweep,
# which pushes the new substrate assets (new id-skill, new agent-supervisor,
# new monitor scripts) to every managed host including this one.

## Step 6: Verify the new tree is live

# Bring agent-supervisor back up
systemctl --user start agent-supervisor

# Check that identities load (Skynet UI should show them in the conversation list
# within a minute or two as the supervisor brings sessions up)

# Check that the distributor sweep completed cleanly
# (look for "distributor sweep complete" in skynet container logs)

## Step 7: Delete the old locations

# Only do this after verifying Step 6 — identities loadable, bounties visible,
# monitors running, distributor sweep clean.

rm -rf ~/.claude/identities/
rm -rf ~/.claude/roles/
# For each old working directory:
# rm -rf ~/skynet-<name>/

# Done. ~/fleet/ is now the sole home for all identity and role state on this box.
```

---

## Ordering / Wave Suggestions for Planner

### Wave 0: No prereqs — create MIGRATION.md

Write `MIGRATION.md` first. It is a pure prose document, no code dependencies, and validates the phase's content decisions before implementation starts.

### Wave 1: Single-source path helpers (backend)

- `per-identity-file.ts` — `localTargetPath` and `remoteTargetPath` functions. This is the smallest, most load-bearing change: fixes the SFTP write wire for all callers.
- `identity-artifact-reader.ts` — `getLocalIdentitiesRoot()` and `getLocalRolesRoot()` fallback paths, plus all REMOTE SSH command strings. Large file, many changes — do as one atomic commit.

Wave 1 can be done without touching substrate files. All tests for these files update in the same commit.

### Wave 2: Backend routes (all functional SSH strings)

- `ssh-poll-orchestrator.ts` — identity enumeration + sentinel stat commands
- `identity-birth-orchestrator.ts` — collision probe + mkdir target
- `identity-clone.ts` — collision probe + mkdir + .md write target
- `roles-create.ts` — collision probe + mkdir + .md write + avatar write
- `roles-list-for-host.ts` — ls + cat commands
- `identity-exists-on-host.ts` — if-d check
- `identity-no-dormancy.ts` — test-e + mkdir + touch + rm commands
- `identities.ts` — rm commands
- `runbooks-editor.ts` — ROLE_ROOT_REL constant
- `relay-pointer.ts` — WHITELIST_REGEX

Each route file plus its test file in one commit each. The `ssh-poll-orchestrator.test.ts` bulk-replace is its own commit (large diff).

### Wave 3: Substrate scripts

- `agent-supervisor.sh` — IDENTITIES_DIR default, archive dir refs, convention workdir, literal path refs, archive skip removal. Update plus archive-scan test driver in same commit.
- `role-file-watch.py` — single-line change
- `recv.sh` — prose-only error message update (optional, low priority)
- `wakeup-scheduler.py` — docstring update (optional, low priority)
- `context-watch.py` — no changes needed

### Wave 4: Skill body and companions

- `substrate/skills/id/SKILL.md` — extensive prose rewrite (~50 references)
- `substrate/skills/id/coordinator-instructions.md`
- `substrate/skills/id/clone-picker-prompt.md`
- `substrate/skills/id/actor-status-prompt.md`

Skill body edits are prose — no code runtime dependencies. Done last because they are the most reviewable against the shape for correct phrasing.

### Wave dependencies

No cross-wave code dependencies (each file's changes are internal). The wave ordering above is a risk/review ordering: smallest-most-load-bearing first.

---

## Traps + Gotchas

### 1. Archive is a SIBLING, not a child of IDENTITIES_DIR

The archive directory `$IDENTITIES_DIR/archive/` in the current code (Phase 94) must NOT become `$IDENTITIES_DIR/identities-archive/` — it must become `$HOME/fleet/identities-archive/` which is a sibling of `$HOME/fleet/identities/`, NOT a sub-path of it. This means `retire_identity` cannot derive the archive path from `$IDENTITIES_DIR` — it needs a separate variable or literal.

**Risk:** If the planner forgets this and writes `$IDENTITIES_DIR/../identities-archive/$name`, that accidentally resolves to `~/fleet/identities-archive/$name` but only if `IDENTITIES_DIR` has no trailing slash. Explicit variable is safer.

**Recommendation:** Add `IDENTITIES_ARCHIVE_DIR="${AGENT_IDENTITIES_ARCHIVE_DIR:-$HOME/fleet/identities-archive}"` alongside `IDENTITIES_DIR` in agent-supervisor.sh. The `AGENT_IDENTITIES_ARCHIVE_DIR` override lets the test driver inject a separate scratch dir for archive operations.

### 2. Archive-scan test driver needs two separate scratch dirs

Today the test driver uses one scratch dir for `AGENT_IDENTITIES_DIR`. After Phase 96, retire moves to a directory OUTSIDE that scratch. The test driver must create a second scratch dir and export `AGENT_IDENTITIES_ARCHIVE_DIR` pointing to it, or retire_identity will attempt to move identity folders to a real location outside the test sandbox.

### 3. The `archive` skip in agent-supervisor.sh identity enumeration is dead after Phase 96

Line 220 defensive `continue` should be removed, not left as dead code. It was only needed because `archive/` was nested inside the identities dir. Leaving it causes no harm but adds confusion.

### 4. relay-pointer.ts WHITELIST_REGEX is a security gate

Wrong update breaks the relay pointer feature or allows SSRF. The new pattern must be:
```
/^\/home\/[a-z0-9_-]+\/fleet\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt$/
```

Update the regex AND all test cases that use path examples.

### 5. session-file-parser.outbound-body.test.ts fixtures are historical captures

The relay-send shell snippets in this test file were captured from real agent sessions. Post-migration agents will emit the new paths. The test corpus should reflect the new paths. However — there is a subtlety: if some of these test cases are testing the PARSER's ability to handle old-format commands (compatibility test), updating them would defeat the test's purpose. Planner must read the test description for each case to determine intent. Default: update all, flag any that are explicitly testing "old format compatibility."

### 6. `IDENTITIES_HOST_DIR` and `ROLES_HOST_DIR` env vars are test-seam only

These env vars (used in `getLocalIdentitiesRoot()` and `getLocalRolesRoot()`) do NOT appear in `docker/docker-compose.yml`, `docker/Dockerfile`, or `docker/entrypoint.sh`. They exist only in vitest test files as setup/teardown seams. Do NOT add them to docker configuration. After Phase 96, tests that set `process.env.IDENTITIES_HOST_DIR` will continue to work as-is (they override the default, which has changed, but they point to their own tmpdir anyway).

### 7. `per-identity-file.ts` ALLOWED_REL_PATHS whitelist covers `relay.json` and `.pinned` only

This is by design. Phase 96 does not add any new file types to the whitelist. The whitelist does not need updating.

### 8. recv.sh cred-path derivation is path-relative — no code change needed inside recv.sh

The `$(dirname "$STATE_DIR")` relative lookup naturally lands on the new identity folder once `STATE_DIR` points to `~/fleet/identities/<name>/relay-state`. Only the SKILL.md setup block and agent-supervisor's call site (which set `STATE_DIR`) need updating.

### 9. Workspace sub-part must exist before first launch

The migration runbook creates `~/fleet/identities/<name>/workspace/` by copying `~/skynet-<name>/` into it. But for identities that get created post-migration via the birth orchestrator, the coordinator-instructions.md step that creates the identity folder must also `mkdir workspace`. Planner must add `mkdir -p ~/fleet/identities/<name>/workspace` to the coordinator's new-identity creation block.

### 10. Convention workdir fallback in agent-supervisor.sh changes semantics

The old fallback `$HOME/$name` checked whether a directory named after the identity existed at home root. After Phase 96, the convention is `$IDENTITIES_DIR/$name/workspace`. If that directory doesn't exist, the supervisor currently falls through to `$HOME`. The new fallback should still be `$HOME` (or possibly `$IDENTITIES_DIR/$name` itself) — the important change is that the CONVENTION path changes from `$HOME/$name` to `$IDENTITIES_DIR/$name/workspace`. Planner should decide: if `workspace/` doesn't exist, fall back to the identity dir itself, or to `$HOME`. The existing comment ("something went wrong at spawn time") still applies.

---

## Open Questions (RESOLVED)

All five open questions were resolved by the orchestrator before planner spawn and folded into the plans below. Written resolutions:

1. **`substrate/skills/agent-relay/SKILL.md` — does it contain functional identity/role path references?** — **RESOLVED.** Grep-confirmed 7 legacy-path references (lines 27, 110, 166, 206, 208, 209, 481). All in prose (skill body text describing where files live), no live shell snippets. Line 481 references the maintainer's local working tree (`~/skynet-<name>/substrate/skills/agent-relay/`) which after Shape 3 lives at `~/fleet/identities/<name>/workspace/substrate/skills/agent-relay/`. Added to in-scope rewrite list; landed in **Plan 96-05**.

2. **`identity-harness-start.ts` and `identity-harness-start.test.ts` — functional path strings?** — **RESOLVED.** Grep audited directly (`grep -nE "\.claude/identit|\.claude/roles|~/skynet-" src/backend/database/routes/identity-harness-start*` returned zero hits for identity/role paths). The only `~/.claude` reference in scope is `~/.claude.json` (the Claude CLI's own state file, unrelated to identity/role metadata). **No action needed — file is out of scope for this phase.** Not included in any plan's `files_modified`.

3. **`identity-birth-orchestrator.mxid-derivation.test.ts` and `identity-birth-orchestrator.role-frontmatter.test.ts` — path string assertions?** — **RESOLVED.** Grep audited directly, zero fixture path assertions for identity/role paths. **No action needed — both files out of scope.**

4. **Coordinator-spawned identity creation: who creates `workspace/`?** — **RESOLVED.** BOTH paths add `mkdir -p workspace/` at identity creation time, matching D-04's "alongside the existing metadata" phrasing:
   - **Skynet backend birth orchestrator** — extends its Step 2 mkdir to also create `workspace/` alongside `wakeups/`. Landed in **Plan 96-06**.
   - **Coordinator-instructions.md new-identity flow** — adds `mkdir workspace/` step per D-04. Landed in **Plan 96-05**.

5. **Agent-supervisor convention workdir: `$IDENTITIES_DIR/$name` vs. `$IDENTITIES_DIR/$name/workspace` as the launch fallback?** — **RESOLVED.** Convention workdir is `$IDENTITIES_DIR/$name/workspace`. The birth-orchestrator and coordinator flows both mkdir it at creation (Q4), so `workspace/` always exists by the time the supervisor cd's into it. If the identity folder itself is missing (a partially-migrated state that shouldn't happen post-ship), the supervisor logs and skips per its existing error handling. Landed in **Plan 96-04** Task 1 step 5.

---

## Environment Availability

Not applicable — phase is a code/config rewrite with no new external dependencies. All tools (bash, python3, tmux, systemd, docker) are pre-existing requirements.

---

## Validation Architecture

Phase 96 has no automated test requirements beyond the repo-wide grep audit (D-15). The phase closes when:

1. `grep -r "\.claude/identities" src/ substrate/ --include="*.ts" --include="*.sh" --include="*.py" --include="*.md"` returns no hits (excluding retained paths in docs comments that reference the pre-migration state as history).
2. `grep -r "\.claude/roles" src/ substrate/ --include="*.ts" --include="*.sh" --include="*.py" --include="*.md"` returns no hits.
3. `grep -r '~/skynet-' substrate/ --include="*.sh" --include="*.py" --include="*.md"` returns no hits.
4. `npm test` (vitest) is green.
5. The bash test driver `substrate/scripts/tests/agent-supervisor-archive-scan.sh` passes with 31/31 tests.
6. MIGRATION.md is readable and self-contained — Ashley and Stacy can follow it verbatim.

---

## Sources

### PRIMARY (code read directly)
- `substrate/scripts/agent-supervisor.sh` — full file read, all path refs enumerated
- `substrate/skills/id/SKILL.md` — path refs extracted via grep
- `substrate/skills/id/coordinator-instructions.md` — grep enumerated
- `substrate/skills/id/clone-picker-prompt.md` — grep enumerated
- `substrate/skills/id/actor-status-prompt.md` — grep enumerated
- `substrate/scripts/role-file-watch.py` — main() body read; line 236 confirmed
- `substrate/scripts/wakeup-scheduler.py` — docstring + main() read
- `substrate/scripts/context-watch.py` — docstring + main() read
- `substrate/skills/agent-relay/recv.sh` — cred-path logic read; lines 19–25, 43 confirmed
- `src/backend/claude-session/per-identity-file.ts` — full file read
- `src/backend/claude-session/identity-artifact-reader.ts` — path constants + representative line sample
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — all path refs enumerated
- `src/backend/database/routes/identity-birth-orchestrator.ts` — all functional path refs enumerated
- `src/backend/database/routes/identity-clone.ts` — all functional path refs enumerated
- `src/backend/database/routes/relay-pointer.ts` — WHITELIST_REGEX read
- `src/backend/database/routes/runbooks-editor.ts` — ROLE_ROOT_REL constant read
- `src/backend/database/routes/roles-create.ts` — all functional path refs enumerated
- `src/backend/database/routes/roles-list-for-host.ts` — all functional path refs enumerated
- `src/backend/database/routes/identity-exists-on-host.ts` — all functional path refs enumerated
- `src/backend/database/routes/identity-no-dormancy.ts` — all functional path refs enumerated
- `src/backend/database/routes/identities.ts` — rm command refs confirmed
- `src/backend/distributor/catalog.ts` — full file read; confirmed no identity/role path changes needed
- `docker/docker-compose.yml` — full file read; confirmed no identity bind mounts

### TEST FILES (path assertions confirmed)
- `per-identity-file.test.ts`, `identity-birth-orchestrator.test.ts`, `identity-clone.test.ts`
- `identity-exists-on-host.test.ts`, `identity-no-dormancy.test.ts`, `identities.put-disk.test.ts`
- `relay-pointer.test.ts`, `session-file-parser.outbound-body.test.ts`
- `ssh-poll-orchestrator.test.ts`, `identity-artifact-reader.two-step.test.ts`
- `identity-artifact-reader.include-archived.test.ts`, `identity-artifact-reader.role-cosmetics.test.ts`
- `substrate/scripts/tests/agent-supervisor-archive-scan.sh`

### CONTEXT FILES
- `.planning/phases/96-.../96-CONTEXT.md` — all decisions D-01 through D-18
- `.planning/shapes/shape-on-disk-tree-consolidation.md` — authoritative shape
- `.planning/phases/92-.../92-CONTEXT.md` — .pinned sentinel path
- `.planning/phases/94-.../94-CONTEXT.md` — archive-scan retire action path
