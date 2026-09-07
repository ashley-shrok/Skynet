---
phase: 83-telegram-bridge-fix-b
plan: 02
subsystem: matrix-admin
tags: [matrix, synapse, admin-api, dm-room, discovery, path-traversal-defense]
requires:
  - "FIXB-03 shape (CONTEXT § 3)"
  - "Phase 79 matrix-admin-creds-store (getMatrixAdminCreds already resolves Synapse admin token from disk)"
provides:
  - "getSharedDMRoom(agentMxid, humanMxid): Promise<string | null> — new export in src/backend/matrix/matrix-admin-client.ts"
affects:
  - "Enables Plan 83-04 bridge-config-writer to populate humans[].room in registry.json (currently hardcoded null at registry-writer.ts:95)"
tech-stack:
  added: []
  patterns:
    - "AdminOk/AdminErr discriminated union NOT used here — this primitive collapses errors to null (CONTEXT § 3, aligns with 'never throws' contract for the Promise.all-across-pairs caller)"
    - "Path-traversal defense via encodeURIComponent on every mxid AND every room_id path segment (T-75-05, mirrors createOrUpdateUser L76)"
    - "Fresh AbortController + REQUEST_TIMEOUT_MS (30s) per fetch — matches every sibling primitive in matrix-admin-client.ts (loginAsUser L127-171 shape)"
    - "Serialized (not parallel) member-count check across shared rooms — short-circuits on first 2-member match; typical case is 1-2 candidates so parallelism gives no wall-clock win"
key-files:
  created: []
  modified:
    - "src/backend/matrix/matrix-admin-client.ts (+101 lines) — new getSharedDMRoom export at end of file"
    - "src/backend/matrix/matrix-admin-client.test.ts (+161 lines, +1 import) — new describe('getSharedDMRoom') with 7 tests (G-01 through G-07)"
decisions:
  - "Errors collapse to null (not discriminated union). Rationale: Plan 83-04 iterates Promise.all across (agent, human) pairs. AdminOk/AdminErr would force try/unwrap at every element site; nullable is cleaner for the 'best-effort discover, fall back' pattern that CONTEXT § 3 mandates."
  - "Member count derivation prefers `total` (Synapse admin returns this on /rooms/{id}/members), falls back to `members.length` when `total` absent, defaults to -1 (no match) otherwise. Handles both /rooms/{id} and /rooms/{id}/members endpoint variants — CONTEXT § 3.4 said 'pick whichever is cheapest'; /members ships a `total` field so we use that, `members.length` is defense in depth."
  - "Filter joined_rooms to only string entries (`.filter(r => typeof r === 'string')`). Defensive against malformed admin API responses — never trust upstream JSON shape."
  - "No caching (v1). CONTEXT § 4 explicit: 'every rewriteRegistryFromCurrentState call re-queries the admin API. Cheap — happens on activation/reconcile events, not per-message.'"
  - "No Skynet-driven room creation. CONTEXT § 3.5: 'if no shared DM room exists, return null. For Phase 83 this depends on pre-existing rooms from the Nina era.' Deferred to a later phase."
  - "No databaseLogger.error() calls. Unlike loginAsUser/createOrUpdateUser which log on proxy errors, this primitive stays silent because the caller (Plan 83-04) aggregates across pairs and will log at that layer — otherwise every DM discovery attempt would spam the log per (agent, human) pair. T-83-02-02 mitigation."
metrics:
  duration_min: 4
  completed_date: "2026-09-07"
  tasks_completed: 1
  files_touched: 2
  commits: 2
requirements: [FIXB-03, FIXB-06]
---

# Phase 83 Plan 02: matrix-admin-client.getSharedDMRoom + unit tests — Summary

One-liner: Added `getSharedDMRoom(agentMxid, humanMxid): Promise<string | null>` to `src/backend/matrix/matrix-admin-client.ts` — composes Synapse admin `/users/{mxid}/joined_rooms` × 2 + `/rooms/{id}/members` to return the first 2-member shared room, or null on any failure. Ships 7 unit tests covering happy path, no-shared-room, 3-member filter-out, joined_rooms 500, missing creds, AbortError, and encodeURIComponent path-traversal defense.

## What Changed

### Exported signature

```typescript
export async function getSharedDMRoom(
  agentMxid: string,
  humanMxid: string,
): Promise<string | null>
```

### Call sequence (happy path)

1. `getMatrixAdminCreds()` — resolve Synapse admin bearer + homeserverBase (Phase 77 primitive)
2. `Promise.all([joinedRooms(agentMxid), joinedRooms(humanMxid)])` — two parallel GETs to `/_synapse/admin/v1/users/{encodeURIComponent(mxid)}/joined_rooms` (each with its own AbortController + 30s timeout)
3. Set-intersect the two room_id arrays
4. For each shared room_id, serialized: GET `/_synapse/admin/v1/rooms/{encodeURIComponent(roomId)}/members`, filter to `total === 2`
5. Return first 2-member match, else `null`

### Failure branches (all collapse to null)

- Creds absent (getMatrixAdminCreds returns null) → null, zero fetch calls
- Either joined_rooms call throws or returns non-2xx → null, no members lookup
- Shared-room set is empty → null, no members lookup
- Every candidate room's members lookup throws / non-2xx / !=2 members → null

### Test count delta

- Pre-plan: 27 tests in `matrix-admin-client.test.ts`
- Post-plan: 34 tests (delta +7)
- All 34 pass; `npx vitest related run src/backend/matrix/matrix-admin-client.ts src/backend/matrix/matrix-admin-client.test.ts` exits 0 (125 tests across 8 files pass, 1 skipped unrelated).
- `npx tsc --noEmit -p tsconfig.json` exits 0.

## Synapse admin API quirks encountered

- **`/rooms/{id}/members` returns both `members` array AND a `total` number.** We prefer `total` for the count check (single-key comparison) and fall back to `members.length` if `total` is absent. This makes the primitive resilient to admin-API version drift where `total` might not be emitted on older Synapse versions. Sanity: on Synapse 1.115+ (the version thenasty runs, per Phase 77 verification), both fields are always present on the `/members` endpoint.
- **The `/rooms/{id}` endpoint DOES also return `joined_local_members` count** (CONTEXT § 3.4 suggested it as an alternative). We chose `/rooms/{id}/members` instead because:
  1. `/rooms/{id}` returns `joined_local_members` — Nina-era rooms sometimes have remote members from the old federated topology, which would break the "exactly 2 members" check. `/members` returns ALL joined members regardless of homeserver.
  2. For Ashley + agent DM rooms specifically (single homeserver, no federation from thenasty), the two counts would be identical. But defensive programming: use the endpoint that isn't semantically ambiguous.
- **`joined_rooms` array of raw room_ids.** No pagination for `/users/{mxid}/joined_rooms` in Synapse admin API — the response is a single JSON with the full array. T-83-02-04 documented the accept-decision: for our fleet (single-digit users, tens of rooms), no paging needed. Threshold for adding pagination: when any user's joined_rooms > ~500.

## Deviations from Plan

**None.** The plan's Step 1 (RED) → Step 2 (GREEN) TDD flow executed exactly as written. All acceptance criteria satisfied:

| Criterion | Target | Actual |
|-----------|--------|--------|
| `grep -c 'export async function getSharedDMRoom'` | 1 | 1 |
| `grep -c 'joined_rooms'` in matrix-admin-client.ts | ≥2 | 7 |
| `grep -c 'REQUEST_TIMEOUT_MS'` delta | ≥+2 | +3 (7→10) |
| `grep -c 'encodeURIComponent'` delta | ≥+3 | +3 (6→9) |
| New unit tests | 7 (G-01…G-07) | 7 |
| Scoped test-suite pass | 34/34 in file | 34/34 ✓ |
| `npx tsc --noEmit` | exit 0 | exit 0 |

## Threat Model — Mitigations Applied

| Threat ID | Category | Mitigation Applied |
|-----------|----------|--------------------|
| T-83-02-01 | Tampering (path-traversal) | `encodeURIComponent` wraps every mxid and every room_id path segment. Test G-07 asserts a mxid containing `%2f` is double-encoded to `%252f` in the fetch URL (defensive against upstream getting a leaked pre-encoded traversal string). |
| T-83-02-02 | Info Disclosure (admin token leak) | Zero `databaseLogger.error()` calls in this primitive. Errors collapse silently to null; the caller (Plan 83-04) aggregates + logs at the pair layer. Bearer token never surfaces in return type. |
| T-83-02-03 | DoS (slow Synapse) | Every fetch wrapped in fresh AbortController + REQUEST_TIMEOUT_MS (30s). `clearTimeout` in both success and error branches (grep-verifiable: 3 new setTimeout + 3 new clearTimeout calls in the new function). |
| T-83-02-04 | DoS (huge joined_rooms) | Accepted per CONTEXT — no pagination in v1. Fleet size bounds this. |
| T-83-02-SC | Supply-chain (npm) | N/A — no new packages installed. Only new function + tests in existing files. |

## Commits

- `8a1d3499` — `test(83-02): add failing tests for getSharedDMRoom` (RED phase, 7 tests fail on missing export)
- `cbbad09e` — `feat(83-02): getSharedDMRoom for Matrix DM room discovery` (GREEN phase, all 34 tests pass)

## Self-Check: PASSED

- `src/backend/matrix/matrix-admin-client.ts` contains 1 `export async function getSharedDMRoom` (verified)
- `src/backend/matrix/matrix-admin-client.test.ts` contains new `describe("getSharedDMRoom", …)` block with 7 `it()` tests (verified)
- Both commit hashes appear in `git log --oneline` (verified)
- `npx vitest related run` exits 0 (verified in execution transcript)
- No other files modified beyond the two listed in plan's `files_modified` frontmatter (verified via `git diff --stat 8a1d3499^..cbbad09e -- src/`)
