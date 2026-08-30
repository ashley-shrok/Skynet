---
phase: 26-conversation-list-needs-desk-count-filter-menu
plan: "01"
subsystem: backend-reader, ws-handler, frontend-api-types
tags: [bounty-counts, identity-artifact-reader, websocket, wave-1]
dependency_graph:
  requires: []
  provides:
    - readIdentityBountyCounts(conn, identityKey) -> {pinnedCount, needsDeskCount}
    - WS identity:bounty-counts per-target shape carries needsDeskCount
    - BountyCountResult frontend type exposes needsDeskCount
  affects:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
tech_stack:
  added: []
  patterns:
    - single-fs-walk invariant (both counters accumulated in one readdir pass)
    - remote python3 emits JSON instead of integer (two-counter transport)
key_files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.count-bounties.test.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/api/claude-session-api.count-bounties.test.ts
decisions:
  - Renamed readIdentityPinnedBountyCount to readIdentityBountyCounts per CONTEXT.md D-05 discretion
  - Remote branch python3 script rewired to emit single-line JSON {"pinnedCount":P,"needsDeskCount":D} instead of integer
  - bounty-counts-store.ts intentionally NOT updated in this wave (Plan 26-02 wave-2 job)
metrics:
  duration: ~25 minutes
  completed: 2026-08-07
  tasks: 2
  files: 6
---

# Phase 26 Plan 01: Backend widening + WS wire + frontend API types Summary

Widened the pinned-bounty counter into a dual-counter returning both `pinnedCount` and `needsDeskCount` from a single fs walk. The WS response payload and frontend API types were widened accordingly. All changes are additive and backwards-compatible.

## What Shipped

### Task 1: Widen reader to readIdentityBountyCounts

**Exact new signature:**
```typescript
export async function readIdentityBountyCounts(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ pinnedCount: number; needsDeskCount: number }>
```

- LOCAL branch: single `await fs.readdir(baseDir)` call; both `pinnedCount` and `needsDeskCount` incremented in the same loop on the same parsed object.
- REMOTE branch: python3 script rewritten to emit `{"pinnedCount":P,"needsDeskCount":D}` on one stdout line. Parsed via `JSON.parse(stdout.trim())`; both fields validated with `Number.isFinite` + non-negative guard.
- IDENTITY_KEY_RE validation guard preserved.
- ENOENT-to-zero handling returns `{pinnedCount: 0, needsDeskCount: 0}`.
- Per-file parse errors swallowed as "counted in neither".

**Tests (9 pass):** Tests A through I including:
- Test G: `{pinned:true, needs_desk:true}` single bounty → `{pinnedCount: 1, needsDeskCount: 1}` (orthogonality on same pass)
- Test I: `vi.spyOn(fs, "readdir")` proves exactly one bounties-dir readdir call per function invocation

### Task 2: Widen WS handler + wire types

**Updated CountBountiesResult type (server):**
```typescript
type CountBountiesResult = {
  identityKey: string;
  hostId: number | null;
  pinnedCount: number;
  needsDeskCount: number;
  error?: string;
};
```

**Exact widened BountyCountResult type (claude-session-api.ts):**
```typescript
export type BountyCountResult = {
  identityKey: string;
  hostId: number | null;
  pinnedCount: number;
  needsDeskCount: number;
  error?: string;
};
```

- All 4 entry-construction sites widened: local-fulfilled, local-rejected, remote-fulfilled, remote-rejected, host-not-found, group-level-failure (all carry `needsDeskCount: 0` on error paths, `s.value.needsDeskCount` on fulfilled paths).
- `readOneTarget` return type changed from `Promise<number>` to `Promise<{pinnedCount: number; needsDeskCount: number}>`.
- `readIdentityPinnedBountyCount` import renamed to `readIdentityBountyCounts` throughout server.

**WS message type strings: UNCHANGED**
- `identity:count-bounties` (request) — byte-identical to pre-plan
- `identity:bounty-counts` (response) — byte-identical to pre-plan

**Tests (10 pass across 2 files):**
- server test: 6 tests including per-host-grouping test proving `needsDeskCount=2` on desk-only identity, `pinnedCount=4` on pin-only identity
- frontend test: 3 tests including Test I2 asserting `counts[0].pinnedCount === 5 && counts[0].needsDeskCount === 1` (distinct, neither undefined)

## Test Run Snippets

### Task 1 (identity-artifact-reader):
```
Test Files  1 passed (1)
Tests  9 passed (9)
```
Orthogonality test (G) and single-walk invariant (I) both pass.

### Task 2 (server + frontend):
```
Test Files  2 passed (2)
Tests  10 passed (10)
```

### Wave-1 combined:
```
Test Files  3 passed (3)
Tests  19 passed (19)
```

## Backend Build

`npx tsc -p tsconfig.node.json` exits 0 (no TypeScript errors).
Note: `npm run build:backend` OOMs on this instance (254MB heap limit hit) — the underlying tsc succeeds cleanly with `NODE_OPTIONS=--max-old-space-size=4096`.

## Intentional Deferred Type Red

`bounty-counts-store.ts` still uses `Map<string, number>` (keyed to `pinnedCount` only). The store reads `c.pinnedCount` which still resolves — widening BountyCountResult only adds a required field, which doesn't break reads from existing consumers. Plan 26-02 widens the store key type from `number` to `{pinnedCount, needsDeskCount}` in wave 2.

## Deviations from Plan

None — plan executed exactly as written. The python3 remote-branch rewrite in Task 1 matches the `<action>` spec verbatim (JSON stdout, both counters, FileNotFoundError early-exit with zeros).

## Threat Model Compliance

- T-26-01 (Tampering — remote python3 stdout): Mitigated. `JSON.parse(stdout.trim())` + `Number.isFinite` + non-negative guard on both fields. Throws descriptive error on malformed payload.
- T-26-03 (DoS — remote python3 script): Mitigated. `execWithTimeout` bound preserved; swallow-per-file-exception pattern retained.

## Self-Check

Files exist:
- src/backend/claude-session/identity-artifact-reader.ts — FOUND (contains readIdentityBountyCounts)
- src/backend/claude-session/claude-session-server.ts — FOUND (contains needsDeskCount x10)
- src/ui/api/claude-session-api.ts — FOUND (BountyCountResult widened)

Commits exist:
- 334db1f: refactor(26-01): rename readIdentityPinnedBountyCount
- 553ca27: feat(26-01): widen WS handler + wire types to carry needsDeskCount

## Self-Check: PASSED
