---
phase: 69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru
plan: "01"
subsystem: identity
tags: [cleanup, deletion, phase-38-removal, share-flow, dead-endpoint]
dependency_graph:
  requires: []
  provides:
    - "identity-share.ts deleted (share route gone)"
    - "ShareIdentityPicker.tsx deleted (picker component gone)"
    - "identities.ts DELETE handler deleted"
    - "database.ts identityShareRoutes unmounted"
    - "identities-api.ts shareIdentity + deleteIdentity client functions deleted"
    - "IdentityModal.tsx Phase 38 state + JSX pruned"
  affects:
    - "src/backend/database/routes/identities.ts (DELETE handler removed)"
    - "src/backend/database/database.ts (identityShareRoutes import + mount removed)"
    - "src/ui/api/identities-api.ts (shareIdentity + deleteIdentity removed)"
    - "src/ui/features/pretty-view/IdentityModal.tsx (Phase 38 picker slot removed)"
tech_stack:
  added: []
  patterns: ["wholesale deletion — no new patterns; removes Phase 38 copy-and-diverge share model"]
key_files:
  created: []
  modified:
    - src/backend/database/database.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.put-disk.test.ts
    - src/ui/api/identities-api.ts
    - src/ui/api/user-management-api.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
  deleted:
    - src/backend/database/routes/identity-share.ts
    - src/backend/database/routes/identity-share.test.ts
    - src/ui/features/pretty-view/ShareIdentityPicker.tsx
    - src/ui/features/pretty-view/ShareIdentityPicker.test.tsx
    - src/ui/features/pretty-view/IdentityModal.share.test.tsx
decisions:
  - "deleteIdentityBounty false-positive: the plan's grep pattern 'deleteIdentity' as substring matches deleteIdentityBounty (unrelated bounty-deletion function in identity-artifact-reader.ts). This is a pre-existing legitimate function, not Phase 38 dead code. The plan's must-have truth scopes the check to src/ui/ with parenthesis ('deleteIdentity(' in src/ui/ returns zero hits') — that gate is satisfied. The broad grep across src/ returns hits only for deleteIdentityBounty, which is out of scope for this plan."
  - "getUsersListBasic has zero UI consumers after this plan (ShareIdentityPicker was its only consumer). The backend /users/list-basic route + client function in user-management-api.ts become dead-but-harmless code. Per plan instructions, cleanup of this orphaned route is deferred to a future session (not Phase 69 scope)."
metrics:
  duration: "~20 minutes"
  completed: "2026-09-02T01:52:05Z"
  tasks_completed: 1
  tasks_total: 1
  files_deleted: 5
  files_modified: 6
---

# Phase 69 Plan 01: Wave 1 — Kill Phase 38 Share Flow + DELETE Endpoint Summary

Wave 1 wholesale removal: deleted identity-share backend route + picker component + all client functions + IdentityModal Phase 38 state, leaving only the four surviving identities routes (GET /, POST /, PUT /:id, GET /:id/avatar) and a clean IdentityModal header with no share button.

## Tasks Completed

| # | Name | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | Delete identity-share + ShareIdentityPicker + pruned database.ts + identities-api + IdentityModal + user-management-api | 5002c9c4 | 5 deleted, 6 modified |

## Files Deleted (rm)

- `src/backend/database/routes/identity-share.ts` — Phase 38 POST /:id/share backend route (copy-and-diverge row duplicator)
- `src/backend/database/routes/identity-share.test.ts` — 11 tests for the share endpoint
- `src/ui/features/pretty-view/ShareIdentityPicker.tsx` — Phase 38 Wave 2 picker component
- `src/ui/features/pretty-view/ShareIdentityPicker.test.tsx` — 11 tests for the picker
- `src/ui/features/pretty-view/IdentityModal.share.test.tsx` — integration tests for IdentityModal ↔ ShareIdentityPicker wiring

## Files Modified (Edit)

- `src/backend/database/database.ts` — removed `import identityShareRoutes` (L25-29) and `app.use("/identities", identityShareRoutes)` block (L1842-1846)
- `src/backend/database/routes/identities.ts` — removed `router.delete("/:id", ...)` handler block (L667-697); surviving routes (PUT /:id, GET /, GET /:id/avatar, POST /) untouched
- `src/backend/database/routes/identities.put-disk.test.ts` — removed stale comment referencing "identity-share.test.ts" as scaffold (dead reference cleanup)
- `src/ui/api/identities-api.ts` — removed `deleteIdentity()` function (L133-139) and entire Phase 38 block: comment banner + `ShareIdentityResponse` interface + `shareIdentity()` function (L357-396)
- `src/ui/api/user-management-api.ts` — stripped stale `// Consumed by ShareIdentityPicker to populate the DropdownMenu content.` comment (L26)
- `src/ui/features/pretty-view/IdentityModal.tsx` — removed `import { ShareIdentityPicker }` (L99), `alreadySharedUserIds` state + Phase 38 comment (L252-263), reset `useEffect` + comment (L265-278), `handleShareSuccess` useCallback + comment (L280-296), and `<ShareIdentityPicker .../>` JSX element + its comment block (L1366-1375)

## TSC + Test Results

- `npx tsc --noEmit` — exits 0 (clean across entire codebase)
- `npx vitest run src/backend/database/routes/identities.put-disk.test.ts src/ui/features/pretty-view/IdentityModal.test.tsx src/ui/features/pretty-view/IdentityModal.stays-awake.test.tsx` — 3 files, 29 tests, all passed
- `npx vitest run src/ui/api/identities-api.test.ts` — 1 file, 8 tests, all passed

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Missing critical cleanup] Stale scaffold comment in identities.put-disk.test.ts**
- **Found during:** Post-deletion grep sweep
- **Issue:** `identities.put-disk.test.ts` line 37 had `* Scaffold follows identity-share.test.ts + identity-birth.test.ts:` — a dead reference to the deleted test file
- **Fix:** Stripped `identity-share.test.ts +` from the comment, leaving `identity-birth.test.ts` as the scaffold reference
- **Files modified:** `src/backend/database/routes/identities.put-disk.test.ts`
- **Commit:** 5002c9c4

### Known false positive in grep gate

The plan's done-criteria combined grep `"deleteIdentity"` matches `deleteIdentityBounty` (a completely different function in `src/backend/claude-session/identity-artifact-reader.ts` that deletes bounties, not identities). This function is legitimate, unrelated to Phase 38, and out of this plan's scope.

The plan's `must_haves.truths` scopes the check precisely: `"Grep for 'deleteIdentity(' in src/ui/ returns zero hits"` — this gate passes (0 hits). The broad `src/` grep returns only `deleteIdentityBounty` as survivors. No Phase 38 code survives.

## No Lingering Phase 38 References

After the above changes, the following searches return 0 hits in `src/` (excluding `deleteIdentityBounty` which is an unrelated function):

```
grep -rn "identity-share" src/ | grep -v ".planning/" → 0 hits
grep -rn "ShareIdentityPicker" src/ → 0 hits
grep -rn "shareIdentity(" src/ → 0 hits
grep -rn "deleteIdentity(" src/ui/ → 0 hits
grep -c "router.delete" src/backend/database/routes/identities.ts → 0
grep -c "identityShareRoutes" src/backend/database/database.ts → 0
grep -c "ShareIdentityPicker" src/ui/api/user-management-api.ts → 0
```

## Nginx Note

No nginx changes needed. The plan notes this plan is deletions only; the `location /identities` blocks in `docker/nginx.conf` and `docker/nginx-https.conf` still correctly absorb the four surviving routes (GET /, POST /, PUT /:id, GET /:id/avatar). Wave 2 will handle URL rekeying when PUT /:id and GET /:id/avatar migrate to /:identityKey.

## getUsersListBasic Disposition

After this plan, `getUsersListBasic` in `src/ui/api/user-management-api.ts` has zero UI consumers — `ShareIdentityPicker` was its only caller. The backend `/users/list-basic` route in `src/backend/database/routes/user-admin-routes.ts` is now dead-but-harmless. Per plan instructions: "if getUsersListBasic has zero consumers after this plan, flag as future-cleanup candidate (out of Phase 69 scope)." Flagged. The function + route + their tests can be pruned together in a future cleanup session.

## Handoff to Wave 2

`identities.ts` still contains four routes that Wave 2 will rewire:
- `POST /` — birth route (disk-only; row INSERT no longer needed post-69-02)
- `PUT /:id` — cosmetics update; Wave 2 rekeys to `PUT /:identityKey` and drops the `updatedAt` bump
- `GET /` — list route; Wave 2 rewires to per-request fanout enumeration from disk
- `GET /:id/avatar` — avatar serve; Wave 2 rekeys to `GET /:identityKey/avatar`

The `publicIdentity()` helper in `identities.ts` (L112-149) still emits `id`, `createdAt`, `updatedAt` — Wave 2 drops those from the response shape as part of the wire-type cleanup.

## Self-Check

**Files confirmed deleted:**
- `ls src/backend/database/routes/identity-share.ts` → No such file
- `ls src/backend/database/routes/identity-share.test.ts` → No such file
- `ls src/ui/features/pretty-view/ShareIdentityPicker.tsx` → No such file
- `ls src/ui/features/pretty-view/ShareIdentityPicker.test.tsx` → No such file
- `ls src/ui/features/pretty-view/IdentityModal.share.test.tsx` → No such file

**Commit confirmed:**
- `git log --oneline | head -1` → `5002c9c4 chore(69-01): kill Phase 38 share flow + DELETE endpoint — wholesale removal`

## Self-Check: PASSED
