---
phase: 260909-dls
plan: 01
subsystem: backend/identities
tags: [tdd, avatar, identity, PUT, sibling-file, frontmatter]
key-files:
  modified:
    - src/backend/database/routes/identities.ts
    - src/backend/database/routes/identities.put-disk.test.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
decisions:
  - "Use oldAvatar (exact captured filename from pre-write frontmatter) verbatim for sibling unlink — not reconstructed ${identityKey}.${oldExt}, per plan spec."
  - "Sibling unlink placed AFTER writeIdentityFile to ensure frontmatter delete persists before sibling removal (crash-safe: orphaned sibling is benign, role fallback still works)."
  - "Folded Task 3 (IdentityModal comment sweep) into the GREEN feat commit — single conceptual change, smaller audit surface."
  - "Used vi.hoisted() for fsUnlinkSpy to avoid vi.mock factory hoisting issue with module-scope let declarations."
metrics:
  duration: "~15 minutes"
  completed: "2026-09-09"
  tasks: 3
  files: 3
---

# Phase 260909-dls Plan 01: Fix identity avatar-revert wire-only no-op Summary

**One-liner:** Extended backend PUT /identities/:key handler to delete `avatar:` frontmatter key + hard-delete sibling file when `meta.avatar === null` — closing the gap left by the Phase 86-05 wire-only stub.

## What Changed

### 1. `src/backend/database/routes/identities.ts` (backend impl)

**Type widening (IdentityMetadata):** Added `avatar?: string | null` field with JSDoc explaining that null = delete, absent = leave alone, non-null string = ignored (bytes arrive via req.file).

**Overlay null-delete branch** (inserted after `voice` branch, before "Avatar handling" block):
```ts
if (meta.avatar !== undefined) {
  if (meta.avatar === null) delete overlaid.avatar;
  // Non-null values silently ignored — avatar bytes arrive via req.file.
}
```

**Post-writeIdentityFile sibling-unlink block** (inserted after ext-swap cleanup, before post-write re-read):
```ts
if (meta.avatar === null && oldAvatar) {
  if (local) {
    await fs.unlink(path.join(getLocalIdentitiesRoot(), identityKey, oldAvatar)).catch(() => {});
  } else if (conn) {
    await execCommand(conn, `rm -f "$HOME/.claude/identities/${identityKey}/${oldAvatar}"`).catch(() => {});
  }
}
```
Uses `oldAvatar` verbatim (exact captured filename from pre-write frontmatter), not reconstructed. Both branches are best-effort via `.catch(() => {})`.

### 2. `src/backend/database/routes/identities.put-disk.test.ts` (TDD RED → GREEN)

Added `vi.hoisted()` fsUnlinkSpy to intercept `node:fs/promises` unlink calls. Added three new tests inside the existing describe block:

- **Test 12a (LOCAL):** PUT avatar:null → frontmatter avatar key deleted + `fs.unlink` called with `testkey/testkey.webp` path + no execCommand rm -f.
- **Test 12b (REMOTE):** PUT avatar:null → frontmatter avatar key deleted + `execCommand rm -f "$HOME/.claude/identities/testkey/testkey.png"` called + no fs.unlink.
- **Test 12c (idempotent):** PUT avatar:null when identity has no avatar override → 200, no crash, no unlink, no rm -f.

### 3. `src/ui/features/pretty-view/IdentityModal.tsx` (stale comment sweep)

Replaced the 12-line "wire-only-no-op" comment block at ~L1373-1384 with a 4-line accurate comment:
```
// 260909-dls: avatar-revert wire — backend PUT handler deletes the
// identity's `avatar:` frontmatter key + sibling file on disk (see
// src/backend/database/routes/identities.ts null-delete branch).
// Post-revert GET falls back to the role's avatar via Phase 86 Plan 86-01.
```
The `if (avatarReverting) { meta.avatar = null; }` wire code is unchanged.

## Verification (all green)

1. **Primary scoped test:**
   `npx vitest run src/backend/database/routes/identities.put-disk.test.ts`
   → 14 tests pass (11 pre-existing + Test 12a + 12b + 12c)

2. **Sanity GET-disk test:**
   `npx vitest run src/backend/database/routes/identities.get-disk.test.ts`
   → 31 tests pass, no regressions

3. **Backend TS build:**
   `npm run build:backend`
   → Clean, no new type errors

4. **Stale comment removed:**
   `grep -c "backend PUT handler does not read meta.avatar" src/ui/features/pretty-view/IdentityModal.tsx`
   → 0

5. **Overlay branch present:**
   `grep -c "meta.avatar === null" src/backend/database/routes/identities.ts`
   → 2 (overlay delete branch + sibling-unlink guard)

## Commit Hashes

| Commit | Message |
|--------|---------|
| `435094e7` | `test(260909-dls): RED — assert PUT avatar-null deletes frontmatter key + sibling file` |
| `0fcbd570` | `feat(260909-dls): PUT identities avatar-null revert deletes frontmatter + sibling file end-to-end` |

RED → GREEN. Task 3 (IdentityModal comment sweep) folded into the GREEN commit.

## Deviations from Plan

**[vi.hoisted pattern]** The plan suggested `export let fsUnlinkMock` assigned inside `vi.mock` factory. This fails because Vitest hoists `vi.mock` calls before module-scope `let` declarations, causing "Cannot access before initialization". Used `vi.hoisted(() => ({ fsUnlinkSpy: vi.fn() }))` instead — functionally equivalent, hoisting-safe. The spy is named `fsUnlinkSpy` to avoid collision with the holder pattern that was attempted first.

## Self-Check

- [x] `src/backend/database/routes/identities.ts` modified with all 3 edits
- [x] `src/backend/database/routes/identities.put-disk.test.ts` has Tests 12a/12b/12c + fsUnlinkSpy
- [x] `src/ui/features/pretty-view/IdentityModal.tsx` stale comment replaced
- [x] RED commit `435094e7` exists in git log
- [x] GREEN commit `0fcbd570` exists in git log
- [x] 14/14 put-disk tests green, 31/31 get-disk tests green, backend build clean
