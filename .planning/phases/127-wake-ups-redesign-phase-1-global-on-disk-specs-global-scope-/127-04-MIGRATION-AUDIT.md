# Phase 127 Plan 04 — Migration Audit: Per-Role Wake-Up Specs

**Audit date:** 2026-09-21
**Auditor:** Executor agent (plan 127-04 task 3)
**Host:** `ubuntu@ip-172-31-243-143` (this host — the Skynet/Vector box)

---

## This host — audit

### Commands run

```
find ~/fleet/roles -maxdepth 3 -type f -name '*.json' -path '*/wakeups/*' 2>/dev/null
```
**Output:** *(empty — zero files found)*

```
find ~/fleet/roles -maxdepth 3 -type d -name wakeups 2>/dev/null
```
**Output:**
```
/home/ubuntu/fleet/roles/box-maintainer/wakeups
```

```
find ~/fleet/roles -maxdepth 4 -type f -path '*/wakeups/.state/*' 2>/dev/null
```
**Output:**
```
/home/ubuntu/fleet/roles/box-maintainer/wakeups/.state/scheduler.pid
```

### Summary

**0 specs found (expected 0 per RESEARCH §6).**

The `box-maintainer` role has a `wakeups/` directory structure (the folder and its `.state/`
subdirectory exist) but contains zero `.json` spec files. No migration is required on this
host.

The `.state/scheduler.pid` file is the running per-role scheduler's PID tracking file. This
process will die when `ambient-monitor.py` picks up new bytes and identities recycle (the
per-role scheduler spawn was removed from `ambient-monitor.py` in plan 03 — D-16(a)). No
manual kill is needed; the PID file can remain and will not be repopulated after the new
ambient-monitor.py rolls.

---

## Remote hosts — sweep protocol

For each managed host that holds coordinator identities, the orchestrator should run the
following sweep **after the distributor push lands** (D-14, D-18):

### Step 1: Check for per-role specs

```bash
find ~/fleet/roles -maxdepth 3 -type f -name '*.json' -path '*/wakeups/*' 2>/dev/null
```

If output is empty: no migration needed on this host. Proceed to the next host.

If output is non-empty: proceed with steps 2–6 for each spec found.

### Step 2: For each spec file found

Read the spec's fields:

```bash
SPEC_FILE="~/fleet/roles/<role>/wakeups/<filename>.json"
cat "$SPEC_FILE"
```

Extract:
- `name` (or use filename stem if absent)
- `schedule` (verbatim)
- `instruction` (becomes `prompt` in the new shape per D-05)
- `enabled` (default `true` if absent)

### Step 3: Derive the slug

Use the `name` field if present and kebab-case-safe; otherwise use the filename stem
(e.g. `daily-kanban-check.json` → slug `daily-kanban-check`). Slug must be kebab-case
(lowercase, hyphens, no spaces or underscores per D-03).

### Step 4: Write the global spec

```bash
SLUG="<derived-kebab-slug>"
ROLE="<role-from-source-path>"
mkdir -p ~/fleet/wakeups/$SLUG

cat > ~/fleet/wakeups/$SLUG/wakeup.json << 'EOF'
{
  "name": "<name from source>",
  "enabled": <true|false from source, default true>,
  "schedule": <schedule verbatim from source>,
  "prompt": "<instruction verbatim from source>",
  "roles": ["<role-from-source-path>"],
  "skills": []
}
EOF
```

### Step 5: Write migration provenance file

```bash
cat > ~/fleet/wakeups/$SLUG/migrated-from.md << EOF
# migrated-from

Migrated from per-role wake-up on $(date -u +%Y-%m-%d).

**Original path:** \`~/fleet/roles/$ROLE/wakeups/<filename>.json\`
**Migrated at:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Original fields preserved:**
- \`schedule\`: <schedule type> / <schedule value>
- \`instruction\` → \`prompt\`: verbatim
- \`name\`: verbatim (if present)
**Roles added:** \`["$ROLE"]\` (derived from original path's role name)
EOF
```

### Step 6: Delete the source spec

```bash
rm ~/fleet/roles/$ROLE/wakeups/<filename>.json
```

After deletion, verify the source folder is empty of `.json` files:

```bash
find ~/fleet/roles -maxdepth 3 -type f -name '*.json' -path '*/wakeups/*' 2>/dev/null
```

Expected: empty output.

### Step 7: Verify the global spec is readable

```bash
cat ~/fleet/wakeups/$SLUG/wakeup.json | python3 -m json.tool > /dev/null && echo "valid JSON"
```

---

## Escalation threshold (D-15)

If the **fleet-wide total** of per-role specs found across all managed hosts exceeds
**~10 specs**, the hand-migration protocol above becomes impractical. At that threshold:

1. **Flag the count to Ashley** before executing any migrations.
2. **Request a small automation script** to handle the sweep rather than hand-migrating
   each spec. The script would implement steps 2–6 above in a loop, producing a
   migration report for review.
3. **Do NOT proceed with hand-migration** beyond ~10 specs without explicit user approval
   of the scripted approach.

This decision is deferred to Ashley at the phase-close checkpoint (Task 4). Based on the
pre-verified state of this host (0 specs) and the fleet's likely composition (small,
box-maintainer-centric), the total is expected to remain well below the D-15 threshold.
Ashley should confirm the remote-host count before the distributor push if possible.

---

## Ownership boundary

This audit document covers **only the local-host scan** (the Skynet/Vector box) and
documents the sweep protocol for the orchestrator.

**In scope for this executor:**
- Local `find` audit commands and their output (recorded above)
- This audit document
- Confirming zero specs exist on this host

**Out of scope — orchestrator responsibility post-greenlight:**
- Running the sweep protocol on any other managed host
- Creating any `~/fleet/wakeups/<slug>/wakeup.json` files (even on this host — no specs
  to migrate here)
- Deleting any per-role spec files
- Confirming the fleet-wide spec count on remote hosts
- Executing the distributor push (D-18) and the `systemctl --user restart` that follows

Per the phase-1-ownership-boundary rule: executor scope = code + commit + scoped tests
green on this host. The actual remote-host sweep + coordinator-instructions.md edits on
other hosts are Ashley's greenlight → orchestrator's execution.

**Traceability:** D-14 (hand-migration), D-15 (escalation threshold).
