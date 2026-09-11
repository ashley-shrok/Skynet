---
phase: quick-260910-jqx
plan: 01
subsystem: ui-state / conversation-store cache
tags: [cache, validator, relay-room, phase-90, backward-compat, cold-boot-paint]
requires:
  - Phase 90 Plan 01 (FleetSession `kind`/`roomId`/`roomTitle` optional fields + v3→v4 cache-key bump)
  - Phase 89 Plan 04 (backend /sessions/list emits relay-room row shape)
provides:
  - Kind-aware `isFleetSession` validator that accepts backend-shaped relay-room rows
  - Regression coverage for relay round-trip / mixed round-trip / legacy-harness compat / malformed-relay rejection
affects:
  - AppShell first-paint of relay rooms on cold-boot (unblocks ~10s /sessions/list wait)
tech_stack:
  added: []
  patterns:
    - Kind-discriminated shape validation (discriminator check hoisted above shape gate; per-kind branching preserves backward-compat)
key_files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts (isFleetSession function; 39 insertions / 16 deletions)
    - src/ui/state/conversation-store.cache.test.ts (4 new it() cases at end of describe block; 104 insertions)
decisions:
  - Hoist the kind-literal check above the harness-shape gate rather than inline a per-branch duplicate — keeps the "reject kind='banana'" invariant in one place.
  - Preserve `undefined kind` → harness-branch routing verbatim (Phase 90 doctrine); do NOT change the FleetSession interface, the write path, or the readFleetSessionsCache filter loop.
  - Cast test-fixture relay rows via `as unknown as FleetSession` — TS type still lists harness fields as required; runtime shape is what round-trips and the write/read path already tolerates missing fields.
metrics:
  duration: ~4 minutes
  completed: 2026-09-10
---

# quick-260910-jqx Plan 01: Fix cache-read validator to accept relay rows — Summary

Kind-aware `isFleetSession` validator so relay-room cache rows survive `readFleetSessionsCache()` — restores instant paint of relay rooms on cold-boot instead of Alice's observed ~10s wait for the `/sessions/list` round-trip.

## What Shipped

**Task 1 — `c002b5c0` (`fix`, 1 file, +39/-16)**: Refactored `isFleetSession` in `src/ui/state/conversation-store.ts` (previously at lines 1232-1293) so the pre-existing kind-literal check (Phase 90 Plan 01, "accept undefined OR the two known kind literals") runs BEFORE the harness-shape gate. Added a branch:

- **Relay branch** (`r.kind === "relay-room"`): requires `typeof r.roomId === "string" && r.roomId.length > 0`. Does NOT check hostId / hostName / sessionName / created / role.
- **Harness / legacy branch** (`r.kind === "harness"` OR `r.kind === undefined`): preserves the pre-existing strict harness-shape check verbatim (typeof hostId==="number", hostName==="string", sessionName==="string", created==="number", role null-or-string). Backward-compat with pre-Phase-90 v3-shape rows that have no `kind` field is preserved by the else-branch routing.

Common checks (lastMessageAt / aiTitle / roomId-type / roomTitle) still apply to both branches after the branch resolves.

**Task 2 — `d5656557` (`test`, 1 file, +104/-0)**: Added four regression `it(...)` cases inside the existing `describe("FleetSession localStorage cache (quick-260805-tub)", ...)` block in `src/ui/state/conversation-store.cache.test.ts`. All four use the exported `readFleetSessionsCache` / `writeFleetSessionsCache` helpers (or direct `localStorage.setItem` for the malformed / legacy edge cases). No new mocks.

- **Test 1 — relay-row round-trip**: writes a backend-shaped relay row (`kind:"relay-room", roomId, roomTitle, lastMessageAt, aiTitle` — NO harness fields), reads it back, asserts kind/roomId/roomTitle intact.
- **Test 2 — mixed round-trip**: writes `SAMPLE_A` (harness) + a fresh relay row, asserts both survive with correct kind counts.
- **Test 3 — legacy harness row (no `kind`)**: seeds localStorage directly with a harness-shape row that has NO kind property; asserts it validates as harness (`kind === undefined`).
- **Test 4 — malformed relay row rejected**: seeds `kind:"relay-room"` with NO roomId alongside a valid SAMPLE_A; asserts only the harness row survives (per-item filter).

## Root Cause / Purpose

Backend `/sessions/list` emits relay-room rows at `src/backend/database/routes/sessions.ts:592-601` in the shape:

```
{ kind: "relay-room", id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt }
```

No `hostId` / `hostName` / `sessionName` / `created`. But the pre-Phase-90 `isFleetSession` validator (unchanged in Phase 90 Plan 01 aside from the added kind/roomId/roomTitle common checks) still gated the top of the function on a strict harness-shape check:

```ts
if (
  typeof r.hostId !== "number" ||
  typeof r.hostName !== "string" ||
  typeof r.sessionName !== "string" ||
  typeof r.created !== "number" ||
  !(r.role === null || typeof r.role === "string")
) return false;
```

Every relay-row cache entry hit that gate on read and got silently filtered out. `readFleetSessionsCache()` returned only the harness rows. On cold-boot, AppShell painted the harness rooms instantly from cache but had to wait for the fresh `/sessions/list` fetch (~10s under Alice's load) before relay rooms materialized in the sidebar.

The write path at `conversation-store.ts:1361` (canonical map at 1377-1388) was already correct — it serialized both kinds. The FleetSession type at `conversation-store.ts:161` was already correct — all relay identity fields (`kind` / `roomId` / `roomTitle` etc.) were already optional. This was purely a read-side validator gap.

## Verification Gates

**Combined phase-level check** (both must exit 0):

```bash
cd /home/ubuntu/skynet-taylor && \
  npx vitest run src/ui/state/conversation-store.cache.test.ts && \
  npx tsc --noEmit
```

Result:
- `npx vitest run src/ui/state/conversation-store.cache.test.ts` = **13/13 tests pass exit 0** (9 pre-existing + 4 new)
- `npx tsc --noEmit` = **exit 0, clean project-wide** (0 lines of output)

**Baseline (pre-Task-1)**: 9/9 tests pass, tsc clean — confirmed before starting Task 1.

**Post-Task-1 (pre-Task-2)**: 9/9 tests still pass (no behavior change for harness or legacy rows — refactor is behavior-preserving on the existing test surface), tsc clean.

**Post-Task-2 (final)**: 13/13 tests pass, tsc clean.

**Grep spot-checks**:
- `grep -c "quick-260910-jqx" src/ui/state/conversation-store.ts` = 2 (hoist comment + branch comment)
- `grep -c "quick-260910-jqx" src/ui/state/conversation-store.cache.test.ts` = 5 (opening comment block + 4 test `it()` names)

## Behavior Preserved

- **FleetSession interface unchanged**: no field additions, removals, or type changes.
- **Write path unchanged**: `writeFleetSessionsCache` canonical map at conversation-store.ts:1377-1388 still serializes all 10 fields for both kinds.
- **`readFleetSessionsCache` filter loop unchanged**: still calls `isFleetSession(item)` and constructs the same 10-field FleetSession object at conversation-store.ts:1333-1344.
- **Backend contract unchanged**: this is a frontend-only cache-layer fix; `/sessions/list` behavior is untouched.
- **Backward-compat with pre-Phase-90 v3-shape rows**: `kind === undefined` still routes through the harness branch. (Largely theoretical after the v3→v4 cache-key bump discards persisted v3 objects, but the validator must still handle it — a v4-key entry that lands without a kind field for any reason must not get silently dropped.)
- **Malformed-relay defense**: `kind:"relay-room"` without a non-empty string roomId is still rejected — Test 4 pins this.
- **Malformed-kind defense**: `kind:"banana"` still rejected by the hoisted kind-literal check (unchanged from Phase 90 Plan 01).
- **Existing "element-shape fallback" test at line 102-113**: continues to pass because the harness branch is byte-identical to the pre-existing strict check.

## Deviations from Plan

**None** — the plan executed exactly as written. Both tasks landed in the declared order (Task 1 source, Task 2 tests). Both verification gates green. No Rule 1/2/3 auto-fixes triggered. No Rule 4 architectural decisions required. No auth gates. No checkpoints.

## Scope Discipline

Exactly the two files declared in the plan `files_modified` were touched:

- `src/ui/state/conversation-store.ts` — only the `isFleetSession` function body (previously lines 1232-1293) modified.
- `src/ui/state/conversation-store.cache.test.ts` — only the four new `it()` cases appended before the closing `});` of the existing `describe(...)`.

Zero touches to: `FleetSession` interface, `writeFleetSessionsCache`, `readFleetSessionsCache` filter loop, `FLEET_CACHE_KEY` constant, backend `sessions.ts`, any other file in `src/`.

## Constraint Compliance

- **Zero `git stash` invocations at any point**. Used `Read` tool for all baseline context; used `git log --oneline` / `git status --short` / `git rev-parse` for git introspection. Three prior contamination events in this arc (documented in the STATE.md "Last activity" entries for 260910-gxl and 260910-ay4) informed the discipline — the shared stash stack across sibling worktrees is exactly the failure mode called out in the executor prompt's destructive-git prohibition.
- Zero destructive git commands (no `git clean`, no `git reset --hard`, no `git checkout -- .`, no `git rm`, no `git push --force`).
- Two atomic code commits on `feat/tab-title-from-tmux`: `c002b5c0` (fix quick-260910-jqx-01) + `d5656557` (test quick-260910-jqx-02).
- Neither commit contains `.planning/` files (bundled separately in the follow-up docs commit).
- Working on the main repo checkout (not a worktree — `.git` is a directory), so the worktree-branch pre-commit assertion did not fire; branch is `feat/tab-title-from-tmux` which matches the STATE.md active branch.

## HEAD Status

- HEAD `d5656557` LOCAL, NOT pushed / NOT built / NOT deployed per code-work-doesn't-authorize-ship rule.
- Ship gate: this fix belongs with the broader UAT / Phase 97 polish arc currently held for greenlight. Alice owns the push decision.

## Self-Check

**Files claimed vs. exist on disk:**
- `src/ui/state/conversation-store.ts` — FOUND (modified in commit `c002b5c0`)
- `src/ui/state/conversation-store.cache.test.ts` — FOUND (modified in commit `d5656557`)

**Commits claimed vs. exist in git log:**
- `c002b5c0` — FOUND (`fix(quick-260910-jqx-01): kind-aware isFleetSession — accept relay-room cache rows`)
- `d5656557` — FOUND (`test(quick-260910-jqx-02): regression tests for kind-aware cache-read validator`)

## Self-Check: PASSED
