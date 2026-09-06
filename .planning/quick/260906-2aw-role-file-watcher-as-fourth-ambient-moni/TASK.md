# Task — Role-file watcher as fourth ambient monitor

Ship a fourth ambient monitor across the fleet — a role-file watcher that fires the diff of any change to an identity's role file, so mid-session edits by ONE identity of a multi-identity role become visible to the OTHER identities of that role while they're still running.

## Source of truth for the shape

Read `.planning/shapes/shape-role-file-watch.md` FIRST AND IN FULL. That file is the agreement grilled with the user in /open — it names what's in scope, what's out of scope, the philosophy, and the failure modes. This TASK.md is HOW to build what the shape file describes; if any HOW-detail below conflicts with the shape file, the shape file wins.

## Repo topology (already investigated for you)

- `~/skynet-tanya/substrate/scripts/` — where the shipped helper scripts live in source. Contains: `agent-supervisor.sh`, `context-watch.py`, `wakeup-scheduler.py`, `usage-reporter.sh`, `install-usage-reporter.sh`, `claude-usage-collector.py`. The new script lands here as `role-file-watch.py`.
- `~/skynet-tanya/substrate/skills/` — where the skill sources live. Contains subdirs `id/`, `agent-relay/`, `bounty/`, `queue/`, `next-bounty/`, `backlog/`, `role/`, `promote-to-coordinator/`, `claude-code-harness-auth/`. The `id/SKILL.md` here IS the canonical source that gets bundled + distributed.
- `~/skynet-tanya/docker/Dockerfile:79` — `COPY --chown=node:node substrate /app/fleet-substrate`. So the source tree at `~/skynet-tanya/substrate/` is bundled to `/app/fleet-substrate/` inside the container at image-build time.
- `~/skynet-tanya/src/backend/distributor/catalog.ts` — the 20-entry hand-maintained catalog. Each entry has a `bundledPath` pointing at `/app/fleet-substrate/…` and a `destPath` pointing at where the item lives on managed hosts. Add a 21st entry for the new script.
- `~/skynet-tanya/src/backend/distributor/catalog.test.ts` (if exists) — extend with an assertion that the new entry exists and is well-shaped.
- `~/.claude/roles/box-maintainer/substrate/` — a SEPARATE local-staging tree under the role folder. Different from `~/skynet-tanya/substrate/`. Investigate whether the box-maintainer role's staging is kept in sync with the repo's substrate or is a distinct copy. If distinct: also add `role-file-watch.py` there. If it's just a symlink/reference: skip.

## What to build

### 1. New shipped helper script — `substrate/scripts/role-file-watch.py`

- Language: **Python**, stdlib only. Parity with `wakeup-scheduler.py` and `context-watch.py` — READ THOSE TWO FIRST for shape reference (arg convention, error handling, state-dir layout, shebang, chmod).
- Location on managed hosts (via distributor's destPath): `~/.local/bin/role-file-watch` (no `.py` suffix on the destination — matches how `wakeup-scheduler` and `context-watch` are named on hosts).
- CLI: `role-file-watch <identity-dir>` — single positional arg, an absolute path like `/home/ubuntu/.claude/identities/tanya`. Same shape as `wakeup-scheduler <identity-dir>` and `context-watch <identity-dir>`.

**Behavior:**
- Read the identity name from the last path component of `<identity-dir>` (e.g. `tanya`).
- Read the identity's role from the YAML frontmatter `role:` key in `<identity-dir>/<identity-name>.md`. Handle missing file, missing frontmatter, or missing `role:` key gracefully — print warning to stderr and exit non-zero.
- Resolve the role file path: `~/.claude/roles/<role>/<role>.md`. If it doesn't exist, print warning to stderr and exit non-zero (unusable identity — don't crash the ambient monitor pipeline; just exit cleanly).
- Baseline directory: `<identity-dir>/role-file-watch/`. Baseline file: `<identity-dir>/role-file-watch/last-snapshot`. Create the dir if missing (mkdir -p equivalent).
- Spill directory: `<identity-dir>/role-file-watch/spilled/`. Created lazily on first spill.
- **First-ever-run rule**: if `last-snapshot` does not exist when the script starts, atomically snapshot the current role file bytes into `last-snapshot`, print NOTHING to stdout, then enter the watch loop. This satisfies the shape file's "silent on cold start" invariant.
- **Subsequent-run rule**: if `last-snapshot` exists, compare current role file bytes against baseline bytes at startup. If they differ → emit ONE event (see event format below), then atomically update baseline. If they match → emit nothing. Either way, enter the watch loop.
- **Watch loop**:
  - Prefer `inotifywait -m -e close_write,move_self,moved_to <role-file>` via subprocess. Handle its output line-by-line. On each event line, do the diff-and-emit logic (compare current bytes against baseline, emit if different, update baseline).
  - If `inotifywait` binary is not on PATH (rare — most Ubuntu installs have `inotify-tools`), fall back to polling: check `os.path.getmtime` on the role file every 2 seconds, treat mtime change as an event, do the diff-and-emit logic. Log a one-time stderr warning on startup that inotifywait wasn't found.
  - If the role file is atomically replaced (mv new old), inotifywait's `move_self` catches it — re-arm the watch on the new inode. In fallback polling, mtime-change detection covers it naturally.
  - If the role file is deleted (rare), log a stderr warning and exit non-zero — supervisor will restart on next wake if the file reappears.
- **Baseline update atomicity**: write the new baseline to a temp file in the same dir, `os.replace` onto `last-snapshot`. Never leave a half-written baseline.

**Event format (stdout):**
- One line per event.
- Prefix: `📝 [role-file: <role>]` — matches the emoji-prefix convention of `⏰ [scheduled: <name>]` (wakeup-scheduler) and `⚠️ [context-watch: <name>]` (context-watch).
- Payload:
  - Compute unified diff via `subprocess.run(["diff", "-u", baseline_path, current_path], capture_output=True, text=True)` — capture stdout regardless of exit code (diff exits 1 when files differ, that's normal).
  - If the total assembled event line (prefix + space + diff) is under the harness event char cap → emit inline as one line, with the diff content joined by `\\n` escape sequences OR (simpler) as a multi-line block whose FIRST line carries the prefix and diff subsequent lines follow. Investigate `~/.claude/skills/agent-relay/recv.sh` for how IT emits multi-line inbound-message events; match that convention exactly. If recv.sh escapes newlines to `\\n` in-line, do that. If recv.sh emits multi-line stdout batched via the 200ms grouping rule (per the Monitor tool description), do that.
  - If over the cap → spill full diff to `<identity-dir>/role-file-watch/spilled/<ISO-timestamp>.diff`, emit ONLY: `📝 [role-file: <role>] diff too large to inline — read from <path>`.
- **Threshold**: investigate recv.sh line-by-line for its long-message spill threshold. Match that exact number in `role-file-watch.py` and cite the recv.sh line reference in a comment: `# spill threshold matches recv.sh:<line> — <brief rationale>`. If recv.sh does not have a hard-coded threshold and instead uses a different approach (e.g. always-spill above a smaller inline preview), adopt that shape too.
- Do NOT auto-clean spilled diffs. They're small, useful for debugging, and match recv.sh's stashed-message handling.

**Robustness:**
- Zero third-party deps. Stdlib + `inotifywait` subprocess only.
- On any unhandled exception in the watch loop, log traceback to stderr and exit non-zero (supervisor restarts).
- `SIGTERM` / `SIGINT` → clean shutdown, kill inotifywait subprocess if running.
- Set the script executable (chmod +x) in the same commit — `git update-index --chmod=+x` if needed.

### 2. Distributor catalog entry — `src/backend/distributor/catalog.ts`

- Add a 21st entry for `role-file-watch`.
- Shape: match the closest analog. Look at how `wakeup-scheduler` and `context-watch` are cataloged (they're the two Python scripts installed to `~/.local/bin/`). Copy their entry shape verbatim, swap the paths + name.
- `bundledPath`: `/app/fleet-substrate/scripts/role-file-watch.py`.
- `destPath` on managed hosts: `~/.local/bin/role-file-watch` (no `.py`).
- Mode: executable (whatever mode the analog entries use for their scripts).
- Update any docblock/comment in the file that says "20-row hand-maintained catalog" to say "21-row".

### 3. Extend catalog tests if present — `src/backend/distributor/catalog.test.ts`

- If a test file exists that asserts the count / shape of catalog entries, extend it with a case for `role-file-watch`.
- If NO test file exists for the catalog, skip — don't create one just for this.
- The recently-added `run-bootstrap.test.ts` (from 20260905-distributor-bootstrap) may have relevant catalog assertions — check + extend if so.

### 4. id skill body edit — `substrate/skills/id/SKILL.md`

**This is the canonical source that ships in the docker image and gets distributed. DO NOT edit `~/.claude/skills/id/SKILL.md` on the live filesystem — that's a downstream copy the orchestrator handles separately post-executor via distributor / self-update / Stacy briefing.**

Edits needed:
- Add a new section titled `## On wake: start your role-file watch` **immediately after** the existing `## On wake: start your context watch` section. Body shape: same as the three sibling sections — one paragraph on why it exists, what it fires on, the one-shot Monitor launch pattern, description prefix, example command. Reference the shape file at `.planning/shapes/shape-role-file-watch.md` (in the box-maintainer role's Skynet repo) for full rationale, but keep the section itself self-contained enough that a fresh identity understands it without needing to fetch the shape.
- Update the `## On-wake Monitors: description: [ambient] ...` filter contract section to add `[ambient] <name> role-file watch` to the enumerated list. Currently the list names the three existing monitors; make it four.
- Update the `## File locations` section under `~/.claude/identities/<name>/`: add `role-file-watch/` as a new per-identity dir (analogous to `wakeups/` and `ctxwatch/`), one-line description matching the sibling entries.
- If the section that enumerates the on-wake sequence at a high level ("start your relay receiver / wake-up scheduler / context watch") exists anywhere else in the SKILL.md, update it to include the fourth watch.

The example command in the new section should be, matching the pattern from the other three:

```
# via the harness Monitor tool (persistent:true):
#   description:  [ambient] <name> role-file watch
#   command:      python3 ~/.local/bin/role-file-watch ~/.claude/identities/<name>
```

### 5. id-skill-handoff.md update — box-maintainer role folder

- Path: `~/.claude/roles/box-maintainer/id-skill-handoff.md`.
- This is a LIVE-filesystem file, not in the repo. It's the role's local handoff reference for id-skill work.
- Add a subsection near the existing "on-wake sections" reference that names the fourth ambient monitor: `role-file watch`. One-line summary + cross-reference to the shape file at `~/skynet-tanya/.planning/shapes/shape-role-file-watch.md` for the design rationale.
- The point of this update is that any future box-maintainer identity working on id-skill changes has a pointer to the fact that a 4th ambient monitor exists and where its design lives.

### 6. box-maintainer role folder's substrate/ staging

- Investigate: does `~/.claude/roles/box-maintainer/substrate/scripts/` currently exist with copies of the shipped scripts? If yes → add a copy of `role-file-watch.py` there. If it's empty or the substrate/ tree is only partial → judge whether to add. The role's `substrate/` was described in the role file as "local staging of all 15 authorship-transferred fleet-substrate items". If it's currently a stale mirror, ADD the new script there for consistency; if it's genuinely retired in favor of the repo, skip.

## Constraints

- **NEVER use worktrees** — fleet rule. Work in the main tree. (`workflow.use_worktrees=false` already set.)
- **Do NOT push, do NOT build docker, do NOT deploy** — stop at "code committed + scoped tests green." Push is orchestrator-only per the tightened deploy-window rule.
- **Scoped tests only for the executor green-gate**: run `npx vitest run` on any distributor-related test files touched (likely `catalog.test.ts` or `run-bootstrap.test.ts`). Do NOT run the full vitest suite. If `npx tsc --noEmit` is needed after `catalog.ts` edits, run it too.
- **Rebase before commit**: `git pull --rebase origin feat/tab-title-from-tmux` before creating the commit. Recent SHAs already on origin from this session: `9c6beeab`, `e354ecaa`, `49c0680d`, `5b69cc75`, `36e05077`.
- **Symmetry with the other three ambient monitors is a design requirement, not a nice-to-have.** If the new script diverges from `wakeup-scheduler.py`/`context-watch.py`'s shape (arg convention, error handling, state-dir layout, output format, shebang, error-exit codes), the executor should surface that as a deviation for review rather than silently pick a different convention.
- **Commit atomically per GSD conventions.** Suggested single commit message: `feat(substrate): role-file watcher as fourth ambient monitor`. Alternative: two commits if the natural boundary is (a) new script + local staging + catalog entry (b) id-skill body + handoff. Executor picks based on what actually reads better in git-log.
- **The live-filesystem edits** (`~/.claude/skills/id/SKILL.md` and `~/.claude/roles/box-maintainer/id-skill-handoff.md`) are NOT git-tracked in `~/skynet-tanya`, so they won't be part of the atomic git commit. Do those edits in the same executor session, but they land as filesystem writes not commits. Mention them explicitly in the SUMMARY.md so the orchestrator knows they're done.

## Files (paths, canonical)

- New: `~/skynet-tanya/substrate/scripts/role-file-watch.py` (chmod +x)
- Edit: `~/skynet-tanya/substrate/skills/id/SKILL.md` (add 4th on-wake section + filter contract entry + file-locations entry)
- Edit: `~/skynet-tanya/src/backend/distributor/catalog.ts` (add 21st entry, update docblock)
- Possibly-edit: `~/skynet-tanya/src/backend/distributor/catalog.test.ts` or `run-bootstrap.test.ts` (investigate + extend if present)
- Live edit (not git-tracked): `~/.claude/skills/id/SKILL.md` (mirror of the substrate/skills/id/SKILL.md edit — the LIVE copy the CURRENT session and future `/id` loads on THIS box read from). This is what makes the change effective on THIS box before the next docker build.
- Live edit (not git-tracked): `~/.claude/roles/box-maintainer/id-skill-handoff.md` (add subsection)
- Optional live edit: `~/.claude/roles/box-maintainer/substrate/scripts/role-file-watch.py` (staged copy if the role's substrate tree exists and is being kept current)
- Reference (do NOT modify, but read for context): 
  - `~/.claude/skills/agent-relay/recv.sh` for spill-threshold pattern (need exact line number to cite)
  - `~/skynet-tanya/substrate/scripts/wakeup-scheduler.py` for shape parity
  - `~/skynet-tanya/substrate/scripts/context-watch.py` for shape parity + inotify-fallback pattern if it has one

## What to include in SUMMARY.md

- Files changed (git-tracked): list.
- Live-filesystem edits made (not git-tracked): list + one-line per edit describing what changed.
- The spill threshold picked and the recv.sh line it was cited from.
- Whether the box-maintainer role's substrate/ staging got the new script or was skipped, with rationale.
- Scoped test result (exact command + exit code).
- Any deviations from TASK.md (what + why).
