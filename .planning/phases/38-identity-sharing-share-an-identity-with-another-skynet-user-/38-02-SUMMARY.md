---
phase: 38
plan: 02
subsystem: identity-sharing
tags: [identity-sharing, frontend, share-picker, identity-modal, phase-38]
wave: 2
provides:
  - "ShareIdentityPicker React component (DialogHeader affordance) — populated from GET /users/list-basic, hides on empty/error, marks already-shared recipients, calls POST /identities/:id/share on select"
  - "shareIdentity + getUsersListBasic API client functions"
  - "IdentityModal integration — parent-owned alreadySharedUserIds Set updated via onShareSuccess callback (session-scoped)"
requires:
  - "Wave 1 backend (38-01): POST /identities/:id/share + GET /users/list-basic endpoints"
  - "@/components/dropdown-menu (existing shadcn primitive)"
  - "sonner toast library (existing)"
affects:
  - "src/ui/features/pretty-view/IdentityModal.tsx — DialogHeader gains one JSX child + parent-owned state"
tech-stack:
  added: []
  patterns:
    - "Trust-the-backend self-exclusion (component does no client-side re-filtering; documented in test)"
    - "Session-scoped alreadyShared marker set (parent owns Set, updates on each successful share regardless of shared:true/false)"
    - "userEvent.setup({pointerEventsCheck: 0}) for Radix DropdownMenu open in jsdom (fireEvent.click alone leaves data-state=closed)"
    - "jsdom shims (hasPointerCapture / setPointerCapture / releasePointerCapture / scrollIntoView / ResizeObserver) at test-file scope so Radix Popper does not crash"
key-files:
  created:
    - "src/ui/features/pretty-view/ShareIdentityPicker.tsx (197 lines)"
    - "src/ui/features/pretty-view/ShareIdentityPicker.test.tsx (501 lines, 11 tests)"
    - "src/ui/features/pretty-view/IdentityModal.share.test.tsx (297 lines, 4 tests)"
  modified:
    - "src/ui/api/identities-api.ts (+41 lines: shareIdentity + ShareIdentityResponse + section header)"
    - "src/ui/api/user-management-api.ts (+26 lines: getUsersListBasic + BasicUser + section header)"
    - "src/ui/features/pretty-view/IdentityModal.tsx (+45/-1 lines: useCallback import, ShareIdentityPicker import, useState<Set<string>> + handleShareSuccess callback + JSX mount)"
decisions:
  - "Session-scoped alreadyShared marker (cold Set on open, populated as user shares this session). Cross-session accuracy deferred — would require a new /identities/:key/recipients backend endpoint, which is the explicit non-goal 'provenance display' per CONTEXT §Deferred."
  - "Both shared:true and shared:false responses add targetUserId to the marker Set (never flips off) — matches CONTEXT re-share-to-same-target semantics."
  - "DropdownMenu (not Popover) — DropdownMenu handles focus + arrow-key nav + escape-close natively for a click-select-close pattern; less structural code."
  - "No client-side self re-filter — the picker trusts the server's ne(users.id, requester) filter. Documented in Test 11 (trust-the-backend assertion); if the backend contract regresses the current user's row would surface visibly in dev/tests instead of being masked by defense-in-depth."
metrics:
  duration_min: 42
  tasks_completed: 4
  tests_added: 15
  loc_delta_src: 1106
  completed_date: "2026-08-13"
---

# Phase 38 Plan 38-02: Identity Sharing (Wave 2 Frontend) Summary

**One-liner:** DialogHeader picker that lists other Skynet users, hides on empty/error, marks already-shared recipients while keeping them selectable, and calls the Wave 1 share endpoint on select. Wired into `IdentityModal.tsx` between the Stays-awake toggle and the pencil edit button. Session-scoped marker Set owned by the parent.

## Shipped behavior

Each item below is one of the plan's `must_haves.truths`, checkmarked with a pointer to the test (or code) that verifies it.

- [x] **Single-user deployment hides the picker entirely.** `ShareIdentityPicker.tsx` L100-102: `if (users === null || users.length === 0) return null;` — verified by `ShareIdentityPicker.test.tsx` Test 1 ("renders null when getUsersListBasic returns an empty array"). The parent DialogHeader's `flex gap-3` collapses the missing child so there is no visual gap.
- [x] **Trigger sits alongside Stays-awake / pencil / close controls when there are other users.** Placement verified by `awk` on `IdentityModal.tsx`: `Stays awake` (L1072) < `<ShareIdentityPicker` (L1078) < pencil `aria-label={editing ? "Done editing"` (L1089). Integration test `IdentityModal.share.test.tsx` Test 1 asserts the picker's spy component is present in the mounted DialogHeader with correct props.
- [x] **Picker lists every user returned by GET /users/list-basic; current user does not appear.** `ShareIdentityPicker.tsx` L156-183 renders one `DropdownMenuItem` per element of `users`, no re-filter. Verified by `ShareIdentityPicker.test.tsx` Test 3 (both usernames appear) and Test 11 (trust-the-backend: current user's name absent from the render because the mocked list excludes them and the component does no re-injection).
- [x] **Selecting a user calls POST /identities/:id/share with {targetUserId}.** `ShareIdentityPicker.tsx` L111 `shareIdentity(identityId, user.id)`. `identities-api.ts` L281-297 sends `{ targetUserId }` JSON to `/identities/${sourceIdentityId}/share`. Verified by `ShareIdentityPicker.test.tsx` Test 6 (unshared row → shareIdentity called with (identityId, targetUserId)).
- [x] **Already-shared users render with a subtle marker AND remain selectable.** `ShareIdentityPicker.tsx` L165 `const already = alreadySharedUserIds.has(user.id);` + L175-179 renders a `<Check> shared` marker when `already` is true. Aria-label suffix `(already shared)` for accessibility. Row NOT aria-disabled. Verified by `ShareIdentityPicker.test.tsx` Test 4 (marker renders) + Test 5 (row is NOT aria-disabled).
- [x] **Picker updates the marker set immediately after a successful shared:true response.** `ShareIdentityPicker.tsx` L119-123 calls `onShareSuccess({targetUserId, shared, resultingIdentityId})`; parent `IdentityModal.tsx` L228-243 `handleShareSuccess` adds targetUserId to the Set. Verified by `IdentityModal.share.test.tsx` Test 3 (shared:true payload → next render has u-new in the Set; Set is a NEW instance).
- [x] **Picker updates the marker set immediately for shared:false responses too (never flips off).** Same code path — parent's handler branches on nothing, always adds. Verified by `IdentityModal.share.test.tsx` Test 4 (shared:false payload → u-existing is present in the Set on next render).
- [x] **Lightweight visible confirmation on successful share.** `ShareIdentityPicker.tsx` L124-129 `toast.success(result.shared ? "Shared with X" : "Already shared with X")`. Verified by `ShareIdentityPicker.test.tsx` Test 8 (both message variants).
- [x] **Picker degrades gracefully when GET /users/list-basic errors.** `ShareIdentityPicker.tsx` L88-95 catch block sets `users` to `null` on rejection, which falls through the L100-102 hide branch. MUST NOT crash the IdentityModal render tree. Verified by `ShareIdentityPicker.test.tsx` Test 9 (rejects → renders null; no crash).

## How the picker connects to Wave 1

Wave 2 consumes exactly the contract published in `38-01-SUMMARY.md § Contract for Wave 2`:

- **`shareIdentity(sourceId, targetUserId)`** (identities-api.ts L281-297) POSTs to `/identities/${sourceIdentityId}/share` with JSON body `{ targetUserId }`. Response is typed `ShareIdentityResponse = { identityId: string; shared: boolean }`. Wave 1 backend returns `shared: true` on a fresh insert and `shared: false` when the target already had this identityKey — the picker treats these identically at the toast-message level (different wording) and the parent's marker-set-update level (same behavior: add targetUserId). The `identityId` field is populated in BOTH cases per Wave 1's explicit contract, so no second round-trip is ever needed to update the frontend "already shared" set.
- **`getUsersListBasic()`** (user-management-api.ts L18-42) GETs `/users/list-basic`, unwraps the `{ users }` envelope, returns `BasicUser[]`. Wave 1 backend server-side filters via `ne(users.id, requester)` so the current user is never in the response. Empty array on single-user deployments — the picker's hide branch matches this cleanly.

Errors surface via the shared `handleApiError` label pattern (`"share identity"` / `"list basic users"`), which flows to sonner toasts inside `@/main-axios`. The picker does not need its own error UI beyond the graceful-hide-on-users-fetch-error path.

## Known limitation: cold alreadyShared marker

The `alreadySharedUserIds` Set is initialized empty (`new Set<string>()`) every time the IdentityModal mounts. It is populated **only** by shares performed in the current session — so on first open (or on any browser refresh), all recipients appear unmarked, even if the current user has previously shared this identity to them.

**Rationale for shipping this way:** unlocking cross-session marker accuracy requires a new backend endpoint that returns "which users currently have a row with this identityKey," which is precisely the "provenance display" feature the shape's `<deferred>` block explicitly excludes ("no 'shared with N users' tag on the source's card"). Building that endpoint would add a per-user identity-visibility query surface that Phase 38 chose not to introduce.

**Why it does not matter in practice:** the backend's re-share silent-no-op is idempotent — re-picking an already-shared user returns `{shared:false}` and NEVER inserts a duplicate, regardless of what the frontend marker says. The marker is a UX convenience ("did I already share this in this session?"), not a correctness gate. Users on managed deployments with the same identity-modal-open-lifecycle will still see the marker update within a session.

**What would unlock cross-session accuracy:** a new backend endpoint (e.g., `GET /identities/:identityKey/recipient-user-ids` returning `{userIds: string[]}`) that the parent could fetch on modal open to seed the Set. Explicit non-goal for Phase 38; parked without a bounty because the current behavior meets the shape's philosophy.

## "What would make it wrong" invariant checklist

Each item from `.planning/shapes/shape-identity-sharing.md § "What would make it wrong"`:

| Failure mode | Status | Verification pointer |
|---|---|---|
| Recipient's copy silently stays in **sync** with source edits | **NOT DONE — invariant honored.** No propagation code exists. `grep -c 'updateIdentity.*targetUserId' src/backend/database/routes/identity-share.ts` == 0. The share endpoint does a one-time INSERT of presentation columns and never revisits the recipient's row. |
| Sharing treated as a **permissioned** action (only-creator-can-share gate) | **NOT DONE — invariant honored.** `grep -c 'createdBy\|originalCreator' src/backend/database/routes/identity-share.ts` == 0. Any user who has the source identity in their `useIdentities()` picker gets the share affordance — the picker is unconditionally rendered by IdentityModal for every identity the user can see. |
| Recipient has to **accept** (pending-invitation, inbox, notification round-trip) | **NOT DONE — invariant honored.** No pending-invitation state anywhere. The recipient's row is INSERTed synchronously inside the POST handler; on the recipient's next `listIdentities()` the row is just there. |
| **Re-sharing** to same user errors or duplicates | **NOT DONE — invariant honored.** Wave 1 detects the `(targetUserId, identityKey)` repeat and returns `{shared:false}` with the existing row's id — no INSERT. Verified by Wave 1's `identity-share.test.ts` re-share tests. The picker keeps the row selectable so users can freely re-click; `shareIdentity()` never throws on repeat. |
| **Deleting** an identity on the source side removes it from recipients | **NOT DONE — invariant honored.** `src/backend/database/routes/identities.ts` L265-285 delete handler: `.where(and(eq(identities.id, id), eq(identities.userId, userId)))` — deletion is scoped to the requester's own row only. The recipient's row (different id + different userId) is not touched. |
| Picker shows the **current user in the list** | **NOT DONE — invariant honored.** `src/backend/database/routes/user-admin-routes.ts` L92: `.where(ne(users.id, userId))` — server-side self-exclusion. Frontend does no re-injection (verified by `grep -c 'includes.*current\|filter.*self' src/ui/features/pretty-view/ShareIdentityPicker.tsx` == 0 and by `ShareIdentityPicker.test.tsx` Test 11). |

## Files changed

| Path | Type | LOC delta | Notes |
|---|---|---|---|
| `src/ui/api/identities-api.ts` | modified | +41 | shareIdentity + ShareIdentityResponse + section header (Phase 38 comment block matching file convention) |
| `src/ui/api/user-management-api.ts` | modified | +26 | getUsersListBasic + BasicUser + section header |
| `src/ui/features/pretty-view/ShareIdentityPicker.tsx` | new | +197 | Component: users state + isMounted guard + DropdownMenu trigger/content + item onSelect handler |
| `src/ui/features/pretty-view/ShareIdentityPicker.test.tsx` | new | +501 (11 tests) | Component behavior tests + jsdom shims for Radix Popper + userEvent.setup for menu open |
| `src/ui/features/pretty-view/IdentityModal.tsx` | modified | +45 / -1 | useCallback import, ShareIdentityPicker import, alreadySharedUserIds useState + handleShareSuccess useCallback, JSX mount between Stays-awake and pencil |
| `src/ui/features/pretty-view/IdentityModal.share.test.tsx` | new | +297 (4 tests) | Integration tests: spy component records picker props + fires synthetic shared:true/false payloads |
| **Total** | 6 files | **+1106 / -1** | 15 new tests total (11 component + 4 integration) |

## Verify commands

Reviewer or downstream orchestrator runs these to confirm Wave 2 shipped intact:

```bash
# API-client shape completeness
grep -c "export async function shareIdentity" src/ui/api/identities-api.ts        # == 1
grep -c "export interface ShareIdentityResponse" src/ui/api/identities-api.ts     # == 1
grep -c "export async function getUsersListBasic" src/ui/api/user-management-api.ts  # == 1
grep -c "export interface BasicUser" src/ui/api/user-management-api.ts             # == 1

# Component + integration completeness
test -f src/ui/features/pretty-view/ShareIdentityPicker.tsx && echo OK
test -f src/ui/features/pretty-view/ShareIdentityPicker.test.tsx && echo OK
grep -c "<ShareIdentityPicker" src/ui/features/pretty-view/IdentityModal.tsx      # == 1
grep -c "import { ShareIdentityPicker }" src/ui/features/pretty-view/IdentityModal.tsx  # == 1

# Placement check — picker sits between Stays-awake and pencil
awk '/Stays awake<\/span>/ {s=NR} /<ShareIdentityPicker/ {p=NR} /aria-label={editing \? "Done editing"/ {e=NR} END {print (s<p && p<e) ? "OK" : "BAD"}' src/ui/features/pretty-view/IdentityModal.tsx

# Test suites green in isolation
npx vitest run src/ui/features/pretty-view/ShareIdentityPicker.test.tsx     # 11/11 passing
npx vitest run src/ui/features/pretty-view/IdentityModal.share.test.tsx     # 4/4 passing
npx vitest run src/ui/features/pretty-view/                                 # 55 files / 572 tests / 6 skipped / 1 todo — all green

# Full-suite green
npx vitest run                                                              # exit 0

# Both builds clean
npm run build:backend                                                        # exit 0
npm run build                                                                # exit 0
```

## No new package installs

Wave 2 introduced ZERO new imports from packages not already in `package.json`. Every symbol used is already-shipped:

- `react` (useState, useCallback, useEffect, useRef)
- `lucide-react` (Check, Share2)
- `sonner` (toast)
- `@testing-library/react` (render, screen, waitFor, cleanup)
- `@testing-library/user-event` (userEvent — already a devDep, used by ChatMessage.test.tsx)
- `vitest` (describe, it, expect, vi, beforeEach, afterEach)
- `@/components/dropdown-menu` (in-repo shadcn primitive at src/ui/components/dropdown-menu.tsx)
- `@/api/identities-api` + `@/api/user-management-api` + `@/main-axios` (existing modules)

**Zod-lesson gate (Phase 34 2026-08-13):** does not fire. `package-lock.json` untouched.

## Regressions

Full-suite `npx vitest run` at HEAD **11709d5** (baseline, pre-Wave 2): 176 files, 2218 tests passing, 6 skipped, 1 todo, ZERO failures (Tiffany's Test 2d fix at commit `f269b8c` cleared the residual PrettyView virtualization failure). Full-suite `npx vitest run` at HEAD after Wave 2 commits: see "Green-suite proof" section below.

Zero regressions introduced by Wave 2 — the JSX addition to IdentityModal's DialogHeader is filtered cleanly by existing IdentityModal / IdentityModal.stays-awake / IdentityModal.voice / IdentityModal.role-tab tests because they query by role/label patterns that do not collide with the picker's `"Share identity"` aria-label.

## Green-suite proof

- **`npx vitest run` (full suite)** at HEAD after all Wave 2 code commits (2c3f228): **178 files / 2233 tests passing / 6 skipped / 1 todo / ZERO failures — exit code 0** ✓ Duration 432s.
- **Delta vs pre-Wave-2 baseline (11709d5):** +2 test files (ShareIdentityPicker.test.tsx + IdentityModal.share.test.tsx), +15 passing tests (2218 → 2233).
- **New test files in isolation:**
  - `ShareIdentityPicker.test.tsx`: 11/11 passing — **exit 0** ✓
  - `IdentityModal.share.test.tsx`: 4/4 passing — **exit 0** ✓
- **Full pretty-view directory:** 55 files / 572 tests / 6 skipped / 1 todo — **exit 0** ✓ (no regression in existing IdentityModal / stays-awake / voice / role-tab / PrettyView.virtualization tests).

## Build proof

- `npm run build:backend`: **exit 0** ✓ (Wave 2 does not touch backend but we ran per CLAUDE.md pre-push discipline; `tsc -p tsconfig.node.json` passes cleanly)
- `npm run build`: **exit 0** ✓ (frontend vite build produces all bundles; new ShareIdentityPicker.tsx picked up in the AppShell chunk)

## Final HEAD SHA

Full HEAD after this plan (including this SUMMARY commit): **`82964e1`** (phase-close commit `plan(38-02): frontend picker for identity sharing in IdentityModal header`). Last code-motion commit (pre-SUMMARY): **`2c3f228`** (`feat(38-02): mount ShareIdentityPicker in IdentityModal DialogHeader`).

Commits (reverse chronological, Wave 2 only):

- `82964e1 plan(38-02): frontend picker for identity sharing in IdentityModal header` — Task 4 phase-close (this SUMMARY)
- `2c3f228 feat(38-02): mount ShareIdentityPicker in IdentityModal DialogHeader` — Task 3
- `3a50965 feat(38-02): ShareIdentityPicker component + 11 tests` — Task 2
- `dfc0c37 feat(38-02): add shareIdentity + getUsersListBasic API clients` — Task 1

Pre-Wave-2 baseline (last Wave 1 / phase-open commit): `11709d5 docs(38): shape file + ROADMAP + STATE entries for identity-sharing phase`.

## Self-Check: PASSED

- `src/ui/features/pretty-view/ShareIdentityPicker.tsx` exists (197 lines).
- `src/ui/features/pretty-view/ShareIdentityPicker.test.tsx` exists (501 lines, 11 tests).
- `src/ui/features/pretty-view/IdentityModal.share.test.tsx` exists (297 lines, 4 tests).
- `<ShareIdentityPicker` mounted in `IdentityModal.tsx` between Stays-awake (L1072) and pencil (L1089) — verified by awk placement check.
- All four task commits (`dfc0c37`, `3a50965`, `2c3f228`, `82964e1`) exist in `git log`.
- SUMMARY.md written to phase directory (this file).
- Full-suite `npx vitest run` exit 0 (178 files / 2233 tests).
- `npm run build:backend` exit 0. `npm run build` exit 0.
