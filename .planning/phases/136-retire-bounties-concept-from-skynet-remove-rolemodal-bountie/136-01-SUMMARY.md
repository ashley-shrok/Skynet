---
phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie
plan: 01
subsystem: role-creation
tags: [dead-code-removal, substrate, ssh-exec, bounties-retirement]
dependency_graph:
  requires: []
  provides:
    - "Bounty-free /role provisioning on managed hosts"
    - "Bounty-free POST /roles endpoint on Skynet"
  affects:
    - "substrate distributor push cycle (SKILL.md re-pushed on next sweep)"
    - "R-5 / R-5b atomicity tests (comment-only touch, behavior unchanged)"
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - substrate/skills/role/SKILL.md
    - src/backend/database/routes/roles-create.ts
    - src/backend/database/routes/roles-create.test.ts
decisions:
  - "Kept the atomic-mkdir chain shape (mkdir -p PARENT && mkdir CHILD); dropped only the trailing bounties/ leg. R-5 / R-5b collision-to-409 semantics preserved because CHILD is the racing dir."
  - "Substrate SKILL.md edit is fire-and-forget per Pitfall 5 — distributor picks up the change on next sweep after Skynet deploys; no in-phase verification of managed-host propagation."
metrics:
  duration: "~5m (execution only; env prep + npm install add ~2m)"
  completed: 2026-09-23
  tasks_completed: 2
  files_modified: 3
  commits: 2
---

# Phase 136 Plan 01: Wave 0 foundation — stop the bounties/ folder bleeding

**One-liner:** Removed the two code sites that CREATE `bounties/` subfolders on new-role setup — the substrate-distributed `role` skill and the Skynet `POST /roles` SSH exec chain — so no new managed host ever spawns another empty `bounties/` dir even before the rest of the retirement chain lands.

## What was built

Two surgical edits, one per file target, plus a one-line comment update in the associated test:

1. **`substrate/skills/role/SKILL.md`** — five surgical edits per plan action:
   - L4 top-of-file description: `"shared knowledge/bounty/history home"` → `"shared knowledge/history home"`
   - L18 directory-layout bullet: `"role file, bounty pool, history, deeper"` → `"role file, history, deeper"`
   - L64 provisioning block: `mkdir -p "$ROLE_DIR/bounties"` deleted; the only remaining mkdir in the block became `mkdir -p "$ROLE_DIR"` (retains the parent-dir creation guarantee)
   - L89 leanness note: `"war-stories live in bounties, not here."` → `"war-stories live in the role file body, not here."`
   - L96 announcement: `"empty starter file + empty bounties/ + empty history.md"` → `"empty starter file + empty history.md"`
   - Verification: `grep -cEi 'bount' substrate/skills/role/SKILL.md` returns `0`; `grep -c 'mkdir -p "\$ROLE_DIR/bounties"' …` returns `0`.

2. **`src/backend/database/routes/roles-create.ts`** — four edits per plan action:
   - L509 SSH exec chain: dropped the trailing ` && mkdir "$HOME/fleet/roles/${name}/bounties"` from the atomic mkdir command string. The chain is now `mkdir -p "$HOME/fleet/roles" && mkdir "$HOME/fleet/roles/${name}"`.
   - L44 Sequence docblock step 8: `"Provision: mkdir -p bounties/, touch history.md (Phase 22, unchanged)."` → `"Provision: touch history.md (Phase 22, bounties/ removed Phase 136)."`
   - L292 POST / header comment: `"Provisions ~/fleet/roles/<name>/ + bounties/ + history.md + <name>.md"` → `"Provisions ~/fleet/roles/<name>/ + history.md + <name>.md"`.
   - L500-501 in-body comment (the atomic-mkdir explanation): rewrote the `"The nested bounties/ subdir is added in the same exec so the winner still gets the full folder layout."` line to `"Only the CHILD dir is created atomically — Phase 136 dropped the nested bounties/ subdir; the bounties concept was retired from Skynet in that phase."` The comment retains the load-bearing atomic-mkdir + race-loser-EEXIST explanation.
   - Verification: `grep -vE '^\s*(//|\*|#)' src/backend/database/routes/roles-create.ts | grep -cEi 'bount'` returns `0`; `grep -c 'mkdir "\$HOME/fleet/roles/\${name}"' …` returns `1` (the CHILD mkdir survives).

3. **`src/backend/database/routes/roles-create.test.ts`** — one-line comment update:
   - R-5 test comment around L405-410: updated the description of the atomic mkdir chain from `mkdir -p PARENT && mkdir CHILD && mkdir CHILD/bounties` to `mkdir -p PARENT && mkdir CHILD` and added a Phase 136 note that the trailing bounties leg was removed. Test body, mock, and assertions are byte-identical — the mock's `if (cmd.includes("mkdir") && cmd.includes("fleet/roles"))` predicate still trips because the CHILD mkdir still runs.

## Verification (per plan gate)

| Gate | Command | Result |
|------|---------|--------|
| SKILL.md bounty-clean | `grep -cEi 'bount' substrate/skills/role/SKILL.md` | `0` |
| SKILL.md mkdir-bounties gone | `grep -c 'mkdir -p "\$ROLE_DIR/bounties"' …` | `0` |
| roles-create.ts non-comment bounty refs | `grep -vE '^\s*(//\|\*\|#)' … \| grep -cEi 'bount'` | `0` |
| roles-create.ts old exec fragment | `grep -c 'mkdir "\$HOME/fleet/roles/\${name}/bounties"' …` | `0` |
| roles-create.ts CHILD mkdir preserved | `grep -c 'mkdir "\$HOME/fleet/roles/\${name}"' …` | `1` |
| Backend build | `npm run build:backend` | exit 0 |
| Scoped tests | `npx vitest related --run src/backend/database/routes/roles-create.test.ts` | 28/28 pass, exit 0 |

## Truth-check against `must_haves`

- ✓ New `/role <name>` invocations on managed hosts no longer create a `bounties/` subfolder — the `mkdir -p "$ROLE_DIR/bounties"` line is gone from `substrate/skills/role/SKILL.md`.
- ✓ New role creation via Skynet's POST /roles endpoint no longer creates `~/fleet/roles/<name>/bounties/` — the trailing `&& mkdir "$HOME/fleet/roles/${name}/bounties"` is gone from the SSH exec chain at `roles-create.ts:509`.
- ✓ The substrate-distributed `role` SKILL.md no longer describes bounties as the role's knowledge home — description prose at L4, directory-layout bullet at L18, and leanness note at L89 all reworded.

## Deviations from Plan

None — plan executed exactly as written. All five SKILL.md edits and all four `roles-create.ts` edits (plus the one test-file comment update) landed as specified in the plan's `<action>` blocks. No Rule 1-4 deviations triggered.

**Pre-execution environment note (not a deviation):** node_modules was not present in the workspace at agent start (fresh worktree). Ran `npm install --no-audit --no-fund` once to install the ~1200 packages required for `tsc` + `vitest`. This is workspace bring-up, not a plan modification.

## Authentication gates

None — pure code edit; no external service auth touched.

## Commits

| Task | Type | Hash | Message |
|------|------|------|---------|
| 1 | chore(136-01) | `8e13c753` | strip bounty prose + mkdir line from role SKILL.md |
| 2 | feat(136-01) | `b1533f78` | remove bounty mkdir from POST /roles handler |

## Known Stubs

None — this is a deletion plan; no new UI, no new data source, no new placeholder text introduced.

## Files touched summary

- Modified: 3
- Created: 0
- Deleted: 0

## Wave-0 gate status

Wave-0 gate satisfied. Wave 1 (leaf-file deletions of bounty-only test + component files) is unblocked and independent — nothing in Wave 1 depends on the SKILL.md or roles-create.ts edits landing first.

## Self-Check: PASSED

- `substrate/skills/role/SKILL.md` — modified, verified zero bounty refs remain
- `src/backend/database/routes/roles-create.ts` — modified, verified zero non-comment bounty refs remain, CHILD mkdir preserved
- `src/backend/database/routes/roles-create.test.ts` — modified (comment only)
- Commit `8e13c753` — verified present via `git log`
- Commit `b1533f78` — verified present via `git log`
- `npm run build:backend` — exit 0
- `npx vitest related --run src/backend/database/routes/roles-create.test.ts` — 28/28 pass
