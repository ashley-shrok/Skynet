# Fleet tree migration — per-box runbook

This is a one-shot per-box migration. Run it during a maintenance window when no
identity on this box is mid-flow on something time-sensitive. At the end of this
runbook, all identity metadata and working directories will be consolidated under
`~/fleet/`, and the old scatter of `~/.claude/identities/`, `~/.claude/roles/`,
and `~/skynet-<name>/` folders will be removed.

**Applies to:** t1000 (Alice / tanya box-maintainer), T800 (Stacy), and any
future box running Skynet or AI+.

**Prerequisite:** The campaign ship is live — Shapes 1–4 commits are on
`origin/main` and the new container image is ready to deploy.

---

## Before you begin

- New code (Shape 1 + Shape 2 + Shape 3 + Shape 4 commits) is already on
  `origin/main` and the container image for this box is ready to deploy.
- No identity on this box is mid-flow on something time-sensitive. You do not
  need a long window — copying and restarting takes a few minutes — but pick a
  moment when no one is counting on a specific session to be running.
- You have SSH access to this box (or you are running directly on it).

---

## Step 0: Check for currently-archived identities

```bash
ls ~/.claude/identities/archive/ 2>/dev/null
```

**If that directory exists and contains subdirectory names:**

You have archived identities. Decide what to do with them:

> **Choose one:**
>
> **(a) Migrate them into `~/fleet/identities-archive/`** (recommended — keeps
>     them accessible in the new tree):
>
> ```bash
> mkdir -p ~/fleet/identities-archive
> for dir in ~/.claude/identities/archive/*/; do
>     name=$(basename "$dir")
>     cp -a "$dir" ~/fleet/identities-archive/"$name"
> done
> ```
>
> **(b) Delete them** — if the archived identities are obsolete and you do not
>     need them:
>
> ```bash
> rm -rf ~/.claude/identities/archive/
> ```
>
> **(c) Leave them in place at `~/.claude/identities/archive/`** — they will not
>     be accessible in the new tree, and Step 7 will delete them along with the
>     old folder. Fine if you know they are obsolete.

Write down your choice. If you chose **(a)**, you will run the copy command
above before moving on. If **(b)** or **(c)**, continue.

**If that directory does not exist or is empty:** skip this section entirely.

---

## Step 1: Save every active identity

For each identity that has an active session on this box, send `/id save` in
its Claude session.

- This flushes `handoff.md`, updates bounties, and appends a history entry.
- Confirm every session shows the `/id save` completion message before you
  continue.

If an identity is dormant or has no active session, skip it — there is nothing
to flush.

---

## Step 2: Copy metadata and working directories to `~/fleet/`

Run these commands in order. They copy — they do not delete. The old locations
remain intact through Step 6.

```bash
# Create the new tree root and its three siblings
mkdir -p ~/fleet/identities ~/fleet/roles ~/fleet/identities-archive
```

```bash
# Copy identity metadata folders (skip the archive sub-folder if it exists)
for dir in ~/.claude/identities/*/; do
    name=$(basename "$dir")
    [ "$name" = "archive" ] && continue
    cp -a "$dir" ~/fleet/identities/"$name"
done
```

**Note (2026-09-10 refinement):** the one-shot working-directory COPY step
originally in this runbook has been dropped. This is a change to the migration
mechanics ONLY — the `~/fleet/identities/<name>/workspace/` convention itself
IS a first-class part of Shape 3 and remains untouched:

- `identity-birth-orchestrator.ts` creates `workspace/` at every new identity
  birth (post-ship, every new identity has one).
- `substrate/skills/id/SKILL.md` documents it as an identity-folder sibling
  (D-04).
- `substrate/scripts/agent-supervisor.sh` cd's into `workspace/` when
  launching if it exists; otherwise falls back to `$HOME`.

What we skip is the one-shot copy from existing `~/skynet-<name>/` /
`~/PBMInvoices-<name>/` / etc. into `workspace/` during THIS migration —
because per-box workdir naming patterns vary and there is no clean general
rule for "which identity owns which repo" that would let a single migration
script relocate every existing workdir correctly without risking broken path
assumptions inside those repos (git submodules, docker-compose paths, CI
configs referencing absolute paths).

Post-migration state:
- **Existing identities** (born pre-Shape-3) have their `~/fleet/identities/
  <name>/workspace/` absent, and their current workdirs remain wherever
  they were on their box (`~/skynet-<name>/` on t1000, `~/PBMInvoices-<name>/`
  on workstation, etc.). Agent-supervisor falls back to `$HOME` for them —
  same behavior as today.
- **New identities** (born post-Shape-3) automatically get `workspace/` at
  birth. Their agent-supervisor session launches into it.
- **Migrating an existing identity's workdir into `workspace/` on demand**
  is trivially doable per-identity at any later time (`mv` + `cd`); it's
  just not batched here because the general rule isn't clean.

So: identity METADATA + role KNOWLEDGE move into `~/fleet/` as a fleet-wide
batch operation now; existing project repos stay at their existing paths
until (optionally) each identity opts them into their `workspace/` later.
Consumers that assume `workspace/` exists (Phase 104's trapped-work detector,
future tooling) should treat "workspace/ absent OR empty" as a valid state
meaning "no identity-scoped workdir here" — same shape as a fresh new
identity that hasn't cloned anything yet.

```bash
# Copy role knowledge homes
for dir in ~/.claude/roles/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    cp -a "$dir" ~/fleet/roles/"$name"
done
```

```bash
# If you chose option (a) in Step 0 (migrate archived identities):
for dir in ~/.claude/identities/archive/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    cp -a "$dir" ~/fleet/identities-archive/"$name"
    echo "Archived identity copied: $name"
done
```

---

## Step 3: Verify the copy

Pick one identity by name and spot-check its files made it.

```bash
# Replace <yourname> with an actual identity name on this box
ls ~/fleet/identities/<yourname>/
# Expected: <name>.md, handoff.md, relay.json, wakeups/, relay-state/, plus
# any sentinels (.pinned, .no-dormancy, etc.)

ls ~/fleet/identities/<yourname>/workspace/
# Expected: the repo or working content that was in ~/skynet-<yourname>/

ls ~/fleet/roles/
# Expected: one subfolder per role (e.g. box-maintainer/)
```

If anything looks wrong, stop here. The old locations are still intact — you can
re-run the copy commands to fix any gaps before continuing.

---

## Step 4: Shut down Skynet host container and agent-supervisor

```bash
# Adjust the compose file path if your box installs Skynet elsewhere
# (default: /opt/skynet/docker-compose.yml)
docker compose -f /opt/skynet/docker-compose.yml down

systemctl --user stop agent-supervisor
```

Confirm both stop cleanly before continuing. No sessions should be running
after this step.

---

## Step 5: Deploy new Skynet code

```bash
cd /opt/skynet
git pull origin main
docker compose -f docker/docker-compose.yml build
docker compose -f /opt/skynet/docker-compose.yml up -d
```

When the container starts, it runs the fleet-substrate distributor sweep. The
sweep pushes the new substrate assets — updated id-skill, updated
agent-supervisor, updated monitor scripts — to every managed host it can reach,
including this one. This is what makes the box's installed substrate aware of
the new `~/fleet/` path layout.

---

## Step 6: Verify the new tree is live

```bash
# Bring agent-supervisor back up
systemctl --user start agent-supervisor
```

Then verify:

1. **Identities load.** In the Skynet UI, the conversation list should show
   your identities within a minute or two as the supervisor brings sessions up.

2. **Distributor sweep completed cleanly.** Check the container logs:

   ```bash
   docker compose -f /opt/skynet/docker-compose.yml logs --tail=100 | grep -i distributor
   ```

   Look for a "sweep complete" or similar completion line with no errors.

3. **Bounties visible, monitors running.** Open one identity's session, check
   that bounties show up and that context-watch and wakeup-scheduler are active.

**Do NOT proceed to Step 7 if you see any error here.** The old locations still
exist — roll back (see Rollback note below) if something is wrong.

---

## Step 7: Tombstone the old locations (defense-in-depth against stale references)

**ONLY after Step 6 verification passes** — identities loadable, bounties
visible, monitors running, distributor sweep clean.

**Why tombstone instead of `rm -rf`.** A `rm -rf` erases the old locations
entirely, leaving anything downstream that still references old paths (a script,
a bounty with a hardcoded path, an agent's in-memory session running stale
substrate that survived the supervisor restart via `KillMode=process`, a human
who ls's the old tree) to hit silent ENOENT. Tombstoning replaces the old
contents with a `READ_ME_MIGRATED.md` marker in each identity/role folder that
explains what happened and where to look now — plus makes the tombstoned tree
read-only via `chmod -R a-w` so any stale-substrate write attempt fails visibly
(permission denied) instead of silently landing in the abandoned tree.

Working directories (project repos on this box) stay in place — the migration
never touched them, so no tombstoning needed for them.

```bash
# --- Per-identity tombstone: empty contents, drop marker ---
for dir in ~/.claude/identities/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" = "archive" ] && continue  # handled by same loop shape below if archive was kept in place
    rm -rf "$dir"/*
    rm -rf "$dir"/.[!.]* 2>/dev/null  # dotfiles too (.pinned, .no-dormancy, .recycle-requested)
    cat > "$dir/READ_ME_MIGRATED.md" <<EOF
# This identity location has been migrated

**Migrated:** $(date -u +%Y-%m-%d) as part of the id-skill-revamp campaign
(Phase 96 on-disk-tree-consolidation).

**Old location (here):** \`~/.claude/identities/$name/\`
**New location:**         \`~/fleet/identities/$name/\`

All contents — identity file, handoff.md, bounties/, wakeups/, relay.json,
relay-state/, sentinels — moved to the new location. New substrate reads from
there directly.

If you got here because a script or an old session referenced the old path,
update the reference to \`~/fleet/identities/$name/\` and it'll work.

If you're an agent that woke up and can't find your state, your session is
running stale substrate. Recycle (drop \`.recycle-requested\` in your NEW fleet
path at \`~/fleet/identities/$name/.recycle-requested\`) and re-load — the new
session will read the new tree correctly.

Contact \`tanya\` (box-maintainer role, t1000) if anything downstream broke.
EOF
done
```

```bash
# --- Per-role tombstone: same shape ---
for dir in ~/.claude/roles/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    rm -rf "$dir"/*
    rm -rf "$dir"/.[!.]* 2>/dev/null
    cat > "$dir/READ_ME_MIGRATED.md" <<EOF
# This role location has been migrated

**Migrated:** $(date -u +%Y-%m-%d) as part of the id-skill-revamp campaign
(Phase 96 on-disk-tree-consolidation).

**Old location (here):** \`~/.claude/roles/$name/\`
**New location:**         \`~/fleet/roles/$name/\`

All contents — role file, bounties/, history.md, runbooks/, reference files —
moved to the new location. New substrate reads from there directly.

If you got here because a script or an old session referenced the old path,
update the reference to \`~/fleet/roles/$name/\` and it'll work.

Contact \`tanya\` (box-maintainer role, t1000) if anything downstream broke.
EOF
done
```

```bash
# --- Tree-level markers (for people who ls ~/.claude/ before drilling in) ---
cat > ~/.claude/identities/README-TREE-MIGRATED.md <<EOF
# All identities on this box migrated to ~/fleet/identities/

Migrated $(date -u +%Y-%m-%d) as part of the id-skill-revamp campaign.
Each identity folder in this tree is a tombstone with a READ_ME_MIGRATED.md
explaining where to look. New home: \`~/fleet/identities/\`.
EOF

cat > ~/.claude/roles/README-TREE-MIGRATED.md <<EOF
# All roles on this box migrated to ~/fleet/roles/

Migrated $(date -u +%Y-%m-%d) as part of the id-skill-revamp campaign.
Each role folder in this tree is a tombstone with a READ_ME_MIGRATED.md
explaining where to look. New home: \`~/fleet/roles/\`.
EOF
```

```bash
# --- Make tombstones read-only ---
chmod -R a-w ~/.claude/identities/ ~/.claude/roles/
```

After this step, `~/fleet/` is the sole live home for identity metadata and role
state on this box. The old paths remain as read-only forensic breadcrumbs; any
future reference to them finds a clear explanation instead of ENOENT confusion.
The migration is complete.

---

## Rollback note

Steps 2 through 6 do not delete anything from the old locations. If something
goes wrong before you reach Step 7, the old locations are still intact:

1. `docker compose -f /opt/skynet/docker-compose.yml down`
2. `git -C /opt/skynet checkout <previous-tag-or-commit>`
3. `docker compose -f /opt/skynet/docker-compose.yml build && docker compose -f /opt/skynet/docker-compose.yml up -d`
4. `systemctl --user start agent-supervisor`

Identities will resume on the old tree (the old code still reads
`~/.claude/identities/` and `~/.claude/roles/`).

**Rollback after Step 7 is not possible without restoring from backup.** Step 7
is the point of no return. Only run Step 7 after Step 6 is clean.

---

## Anti-pattern warning

**Do NOT hand-patch fleet-substrate content on this box after the migration.**

If the distributor sweep did not reach this box (or missed a file), fix the
distributor or the credentials — do not SSH in and manually edit installed
files under `~/.claude/skills/` or `~/.local/bin/`. Hand-patching masks
distribution failures and leaves the box in a state that diverges silently from
what the distributor thinks it pushed. Fix the distribution path; let the
distributor do its job.
