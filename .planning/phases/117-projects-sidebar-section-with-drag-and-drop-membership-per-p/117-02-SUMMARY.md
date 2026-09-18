---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 02
subsystem: backend/matrix
tags: [matrix, account_data, m.tag, projects, relay-room, read-modify-write]
requires:
  - src/backend/matrix/matrix-admin-client.ts
  - src/backend/matrix/matrix-admin-creds-store.ts
  - src/backend/claude-session/identity-artifact-reader.ts (PROJECT_SLUG_RE)
provides:
  - matrix-room-tag-client.getRoomTags — GET m.tag account_data (per-user)
  - matrix-room-tag-client.setRoomProjectTag — D-05a read-modify-write PUT
affects:
  - Wave 2 Plan 117-05 (route: POST /relay-rooms/:roomId/project) — consumes setRoomProjectTag
  - src/backend/matrix/matrix-admin-client.ts — ensureUserToken now exported (was file-private)
tech_stack:
  added: []
  patterns:
    - "matrix-admin-client fetch shape (AbortController + AdminOk/AdminErr + ERR_ codes) applied to a new sibling module"
    - "ensureUserToken reuse (loginAsUser cache) — per-user token for m.tag writes, NEVER admin token"
    - "encodeURIComponent on every user-supplied path segment (T-117-02-02 path-traversal defense)"
key_files:
  created:
    - src/backend/matrix/matrix-room-tag-client.ts
    - src/backend/matrix/matrix-room-tag-client.test.ts
  modified:
    - src/backend/matrix/matrix-admin-client.ts (single export keyword insertion — line 1274)
decisions:
  - "D-05 + D-05a: relay-room project membership carrier is Matrix account_data m.tag, written via 5-step read-modify-write (GET → preserve non-project → strip u.project.* → optional add u.project.<slug> → PUT)"
  - "D-06: single-project invariant enforced defensively — strip ALL u.project.* keys, not just the one the caller may know, so a pre-existing multi-tag state collapses to at-most-one on any write"
  - "T-117-02-01: use ensureUserToken (per-user token) NOT admin token — Matrix m.tag is a per-user account_data event per Client-Server spec § 13.4; an admin-token write would attach tags to @skynet-admin"
  - "T-117-02-04: non-object `tags` field in GET response → return matrix_room_tag_malformed_response (502) rather than attempt a merged write from garbage"
metrics:
  duration: "~15 minutes"
  completed: 2026-09-18
  tests_passing: 16
  test_file_loc: 396
  impl_file_loc: 255
---

# Phase 117 Plan 117-02: matrix-room-tag-client Summary

Two-function Matrix account_data `m.tag` client — the relay-room half of the
project-membership carrier for Phase 117. Identity conversations use identity-
file frontmatter (Plan 117-01 handled that); relay-room conversations use
this module.

## What ships

### `src/backend/matrix/matrix-room-tag-client.ts` (new — 255 lines)

Two exports, signatures verbatim:

```typescript
export async function getRoomTags(
  userMxid: string,
  roomId: string,
): Promise<GetRoomTagsOk | AdminErr>;

export async function setRoomProjectTag(
  userMxid: string,
  roomId: string,
  projectSlug: string | null,
): Promise<{ ok: true } | AdminErr>;
```

Plus a supporting type:

```typescript
export type GetRoomTagsOk = { ok: true; tags: Record<string, unknown> };
export type AdminErr = { ok: false; status: number; error: string };
```

Shape mirrors `matrix-admin-client.ts:1-125` verbatim (imports, constants,
AdminErr shape, per-primitive invariants: creds gate, encodeURIComponent path
safety, Bearer auth, AbortController + 30s timeout, discriminated-union
return, clearTimeout in both branches, no upstream body / token leaks).

### `src/backend/matrix/matrix-room-tag-client.test.ts` (new — 396 lines)

16 vitest tests (15 planned + 1 additional path-traversal defense test —
see § "Deviations" below):

| # | Test | Covers |
|---|------|--------|
| 1 | happy 200 → tags + per-user-token audit | T-117-02-01 |
| 2 | 404 → `{ok:true, tags: {}}` | Matrix spec § 13.3 (absent = valid) |
| 3 | 500 non-2xx → `matrix_room_tag_non_2xx` | error surface |
| 4 | creds missing → 500, fetch NOT called | T-117-02-05 |
| 5 | timeout → 504 `matrix_room_tag_timeout` | T-117-02-06 |
| 6 | ensureUserToken failure → propagates verbatim | error surface uniformity |
| 7 | assign — RMW preserves non-project keys | D-05a step 2 |
| 8 | rewrite — strips existing u.project.old | D-05a step 3 |
| 9 | strips ALL u.project.* (defensive) | D-06 single-project invariant |
| 10 | clear (slug=null) — removes, adds nothing | D-05a step 4 skipped |
| 11 | clear on already-empty (404 GET) → PUT `{tags:{}}` | byte-consistency |
| 12 | invalid slug — throws BEFORE HTTP | T-117-02-03 |
| 13 | GET failure → NO PUT issued | fail-safe |
| 14 | PUT failure → surfaced as AdminErr | error surface |
| 15 | encodeURIComponent — @ and : encoded | T-117-02-02 |
| 15b | encodeURIComponent — / encoded (path-traversal) | T-117-02-02 (extra) |

### `src/backend/matrix/matrix-admin-client.ts` (modified — 1 line)

Single `export` keyword insertion at line 1274 to expose the pre-existing
`ensureUserToken` function (previously file-private) so the room-tag module
can reuse its per-user token cache (Map + 1-hour TTL + loginAsUser round-
trip on miss) without duplicating the plumbing.

`git diff` on matrix-admin-client.ts shows exactly this one-word change:

```diff
-async function ensureUserToken(
+export async function ensureUserToken(
```

No other lines touched. Verified via `git diff HEAD~2 HEAD -- src/backend/matrix/matrix-admin-client.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 – Bug] Test 15 assertion contradicted `encodeURIComponent` behavior**

- **Found during:** GREEN phase test run (14/15 passing on first execution)
- **Issue:** Plan Test 15 asserts `!` in a Matrix roomId is percent-encoded to `%21`. `encodeURIComponent` leaves `!` verbatim because RFC 3986 § 2.3 classifies it as a URI-unreserved character. Matrix uses `encodeURIComponent` on roomIds everywhere in `matrix-admin-client.ts:1315-1316` and the raw `!` prefix survives every existing test — so the plan's assertion was aspirational, not what the codebase actually does.
- **Fix:** Reworded Test 15 to assert what `encodeURIComponent` actually produces (`!id%3Ahost` — @ and : encoded, ! left verbatim, matching matrix-admin-client precedent). Added Test 15b to verify the actual path-traversal defense: hostile inputs containing `/` or `..` DO get encoded to `%2F` and no `/../` sequence survives, which is the load-bearing security property that T-117-02-02 in the threat model cares about.
- **Rationale:** Preserving the plan's Test 15 expectation would have required over-encoding on top of `encodeURIComponent`, which would diverge from `matrix-admin-client.ts` shape — a bigger deviation than a test-spec correction. `encodeURIComponent` is the right primitive; the plan's assertion mistake was subtle.
- **Files modified:** src/backend/matrix/matrix-room-tag-client.test.ts (Test 15 wording + added Test 15b)
- **Commit:** afd1ed5

### Architectural Decisions Made During Execution

**Test 11 disambiguation (planner's-discretion choice per plan Test 11):**

The plan gave the executor discretion on whether `setRoomProjectTag(mxid, roomId, null)` on an already-empty room issues a PUT `{tags: {}}` or no-ops. Chose to PUT `{tags: {}}` for byte-consistency with the assign path — same GET → merge → PUT flow, no branch on "was there anything to clear". Matches the plan's recommendation.

## Was ensureUserToken exported from matrix-admin-client?

**Yes.** The plan's action step allowed for the possibility of duplicating the cache-map + loginAsUser plumbing, but that would double the surface area. A single `export` keyword insertion on line 1274 is the minimum-change approach the plan hints at with "Do this with the minimum change (one `export` keyword in front of the existing function declaration)".

Diff scope:
```
$ git diff HEAD~2..HEAD~1 -- src/backend/matrix/matrix-admin-client.ts | wc -l
7
```
7 lines of diff — 3 context, 1 `-`, 1 `+`, 2 diff-header — exactly one meaningful change: the `export` keyword.

## Matrix Spec Ambiguity Encountered

None. The Matrix Client-Server spec § 13.3 ("Client Config") and § 13.4 ("Room Tagging") were unambiguous on:
- Endpoint path shape: `/user/{userId}/rooms/{roomId}/account_data/m.tag`
- Absent account_data → 404 is a valid state (mapped to `{tags: {}}` here)
- `m.tag` is a per-user event (drives the ensureUserToken decision)
- Tag content shape: `{tags: {"u.<name>": {}}}` with `u.` prefix for user-defined tags

The only spec subtlety worth documenting is that `encodeURIComponent` in JavaScript follows RFC 3986's unreserved-character list, which leaves `!`, `~`, `*`, `'`, `(`, `)` verbatim. This is standard and matches matrix-admin-client's existing behavior — see Test 15 deviation above.

## Verification

```
$ npx vitest run src/backend/matrix/matrix-room-tag-client.test.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  1.40s
```

```
$ npx tsc --noEmit -p tsconfig.json ; echo EXIT=$?
EXIT=0
```

```
$ grep -c "^export async function \(getRoomTags\|setRoomProjectTag\)" src/backend/matrix/matrix-room-tag-client.ts
2

$ grep -c "ensureUserToken" src/backend/matrix/matrix-room-tag-client.ts
7   # imported once + used twice (getRoomTags + setRoomProjectTag) + JSDoc mentions

$ grep -c "getMatrixAdminCreds().*accessToken" src/backend/matrix/matrix-room-tag-client.ts
0   # T-117-02-01 upheld: admin token is NEVER used for m.tag operations

$ grep -c "u\\\\\.project" src/backend/matrix/matrix-room-tag-client.ts
2   # /^u\.project\./ regex present twice — once in the filter, once in Object.fromEntries chain
```

## Commits

| Commit | Message |
|--------|---------|
| c28ca63 | `test(117-02): add failing tests for matrix-room-tag-client (RED)` — 15 tests + export prep of ensureUserToken |
| afd1ed5 | `feat(117-02): implement matrix-room-tag-client per D-05a read-modify-write` — impl + Test 15 fixup + Test 15b |

## Downstream Consumers

Wave 2 Plan 117-05 (route: `POST /relay-rooms/:roomId/project`) will import
this module with:

```typescript
import { setRoomProjectTag } from "../../matrix/matrix-room-tag-client.js";
```

The route layer validates the slug against `PROJECT_SLUG_RE`, resolves the
requesting user's mxid from the session, and calls `setRoomProjectTag(userMxid,
roomId, slug)`. On thrown "invalid project slug" it returns 400; on
`{ok: false, status, error}` it forwards the status + short error code; on
`{ok: true}` it returns 200 and (per D-37) may broadcast a
`project-list-changed` wire frame.

## Self-Check: PASSED

- src/backend/matrix/matrix-room-tag-client.ts: FOUND
- src/backend/matrix/matrix-room-tag-client.test.ts: FOUND
- Commit c28ca63: FOUND
- Commit afd1ed5: FOUND
- Test suite: 16/16 passing
- tsc --noEmit: EXIT=0
- Acceptance criteria: all 7 met (2 exports, ensureUserToken reused, 0 admin-token usage, u.project regex present, tests green, tsc clean, matrix-admin-client diff is single `export` keyword)
