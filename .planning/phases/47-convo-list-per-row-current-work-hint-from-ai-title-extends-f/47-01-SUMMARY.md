---
phase: 47-convo-list-per-row-current-work-hint-from-ai-title-extends-f
plan: 01
subsystem: wire-type surface (backend zod + ui interfaces) + conversation-store cache key
tags: [wire-type, fleet-status, ai-title, cache-key-bump, sessions-list, additive-optional, wave-1]
requires: []
provides:
  - "SessionStateSchema (backend zod) carries optional nullable `aiTitle` field alongside lastMessageAt (Phase 41 Plan 03 mirror)"
  - "SessionState (ui interface) carries optional `aiTitle?: string | null` alongside lastMessageAt — MUST stay in lockstep with backend schema"
  - "RemoteTmuxSession wire type carries optional `aiTitle?: string | null` alongside lastMessageAt for /sessions/list REST response"
  - "FleetSession type carries optional `aiTitle?: string | null`; readFleetSessionsCache + writeFleetSessionsCache preserve the field round-trip; isFleetSession defensively rejects non-string non-null non-undefined aiTitle to protect last-wins reconciliation from poison"
  - "FLEET_CACHE_KEY bumped `skynet:convo-fleet-cache:v2` → `…:v3` (load-bearing — v2 rehydrate under Phase 47 first-load would seed working-store aiTitle with null and no-op the last-wins reconciliation, silently emptying the row subtitle instead of showing last-known ai-title)"
affects:
  - src/backend/fleet-status/wire-protocol.ts (SessionStateSchema + block comment above the schema)
  - src/backend/fleet-status/wire-protocol.test.ts (4 new zod-parse tests + 1 FRAME_SCHEMA_VERSION guard)
  - src/ui/api/fleet-status-types.ts (SessionState interface + block comment)
  - src/ui/api/sessions-api.ts (RemoteTmuxSession interface)
  - src/ui/state/conversation-store.ts (FleetSession type + isFleetSession predicate + readFleetSessionsCache + writeFleetSessionsCache + FLEET_CACHE_KEY v3 + docblock update)
  - src/ui/state/conversation-store.cache.test.ts (CACHE_KEY v3 + SAMPLE_A/B gain aiTitle + canonical-fields test expects 7 keys)
  - src/ui/state/conversation-store.test.ts (removeFleetSession Test R1 v3 update; Phase 44 Plan 04 describe block renames V2→V3 + wording updates for Tests C/E/F semantics; new Phase 47 Plan 01 describe block with Test G round-trip + Test H defensive-reject)
tech-stack:
  added: []
  patterns:
    - Additive+optional wire extension (T-41-03-05 mitigation — FRAME_SCHEMA_VERSION deliberately NOT bumped)
    - Optional field mirrored across four sites (backend zod, ui interface, REST type, ui-state type)
    - Defensive predicate rejection for corrupt cache entries (protects last-wins reconciliation from poison)
    - Cache-key version bump as deploy-time invariant enforcer (matches Phase 44 Plan 04's v1→v2 pattern)
    - undefined → null coerce at read/write boundary so downstream consumers (AppShell seed loop) always see either null or the concrete type
key-files:
  created: []
  modified:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/wire-protocol.test.ts
    - src/ui/api/fleet-status-types.ts
    - src/ui/api/sessions-api.ts
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.cache.test.ts
    - src/ui/state/conversation-store.test.ts
decisions:
  - "aiTitle treated as string | null (not string | undefined). Wire uses `.optional().nullable()` and the ui interface uses `?: string | null` so an explicit null carries `no-ai-title-yet` semantics distinct from a pre-Phase-47 watcher (undefined). Frontend consumer treats undefined and null identically (both → working-store cache holds null → row subtitle renders fallback ellipsis per the LOCKED v14 design)."
  - "Reconciliation rule at the working-store is LAST-WINS (not max-wins like lastMessageAt) — ai-titles evolve over the course of a session as the topic drifts (CONTEXT.md § working-store third axis). This plan is wire-only; reconciliation lives downstream in Plan 47-03. The isFleetSession predicate's defensive rejection of non-string aiTitle is specifically to protect last-wins from poisoning — a bogus value would stick until the next legitimate write, unlike max-wins where a stale value naturally loses to any newer real value."
  - "FRAME_SCHEMA_VERSION HELD AT 1. Additive+optional wire extensions never require a version bump per the T-41-03-05 mitigation invariant Phase 41 Plan 03 established. New guard test (P47-01 A-guard) locks against inadvertent bumps."
  - "Cache-key bump v2 → v3 is load-bearing (not cosmetic). Same rationale as Phase 44 Plan 04's v1→v2 bump but for aiTitle instead of lastMessageAt. Because ai-title reconciliation is LAST-WINS, a v2 rehydrate would seed the working-store with objects lacking aiTitle → coerced null via readFleetSessionsCache → AppShell seed loop's `?? null` fires seedSessionAiTitle with null → last-wins no-op → row subtitle silently renders the fallback ellipsis instead of the last-known ai-title from the v2 cache. Small acceptable UX cost of one clean cold-start on deploy."
  - "Scope fence held tight — no consumer wiring in this plan. Backend scraper (47-02), working-store third axis (47-03), AppShell seed (47-04), row redesign (47-05) all untouched. This plan is pure additive-optional type extension + cache-key bump + cache-layer round-trip preservation. Verified via `git diff feat/tab-title-from-tmux~2..HEAD -- src/backend/database/routes/ src/backend/fleet-status/ssh-poll-orchestrator.ts src/ui/state/session-working-store.ts src/ui/AppShell.tsx src/ui/features/pretty-conversations/` = empty (excluding the one wire-protocol.ts + wire-protocol.test.ts touch in fleet-status/)."
metrics:
  duration: ~25min (Task 1 TDD + Task 2 TDD + full-suite verification)
  completed: 2026-08-20
---

# Phase 47 Plan 01: Wire-type extension (SessionState/RemoteTmuxSession/FleetSession gain optional aiTitle, FLEET_CACHE_KEY v2→v3) — Summary

Extend the wire-type surface for the Phase 47 ai-title signal across four sites (backend zod schema, ui interface, sessions-list REST type, conversation-store FleetSession type) plus a load-bearing cache-key bump from v2 to v3. Pure additive-optional extension mirroring the Phase 44 Plan 04 pattern for lastMessageAt. No consumer wiring; unblocks Phase 47 Plans 02-05.

## What Landed

### Task 1 — Wire-type surface with aiTitle on all four sites

**`src/backend/fleet-status/wire-protocol.ts`:**
- New block comment above `SessionStateSchema` describing the aiTitle field's semantics (string / null / undefined treatment), the harness source format `{"type":"ai-title","aiTitle":"…","sessionId":"…"}`, the LAST-WINS reconciliation rule at the working-store (differs from lastMessageAt's max-wins), and the FRAME_SCHEMA_VERSION-not-bumped invariant.
- `SessionStateSchema` gained `aiTitle: z.string().nullable().optional()` immediately below `lastMessageAt`. Field ordering: `hostId / tmuxSession / sessionId / pid / status / waitingFor / backgroundTasks / updatedAt / lastMessageAt / aiTitle`.
- `FRAME_SCHEMA_VERSION` UNCHANGED at 1.

**`src/backend/fleet-status/wire-protocol.test.ts`:**
- 4 new zod-parse tests + 1 guard test appended in the existing `wire-protocol` describe:
  - Test P47-01 A: string value round-trips through `.safeParse`.
  - Test P47-01 B: null value round-trips.
  - Test P47-01 C: field OMITTED (undefined) parses successfully — optional at wire level.
  - Test P47-01 D: wrong type (number 42) rejected with an error issue path referencing `aiTitle`.
  - Test P47-01 A-guard: FRAME_SCHEMA_VERSION stays at 1 (locks against inadvertent bumps for additive-optional).
- 15/15 tests pass in this file (was 11/11 pre-plan).

**`src/ui/api/fleet-status-types.ts`:**
- `SessionState` interface gained `aiTitle?: string | null` immediately below `lastMessageAt`.
- Matching block comment references Phase 47 CONTEXT.md § domain, cites the harness source format, restates the undefined/null equivalence rule for the frontend consumer, and reiterates the lockstep-with-backend-schema constraint.

**`src/ui/api/sessions-api.ts`:**
- `RemoteTmuxSession` gained `aiTitle?: string | null` immediately below `lastMessageAt`.
- Single-line inline comment identical shape to the lastMessageAt comment (Phase 47 note, optional-for-compat rationale, undefined-treated-as-null consumer contract).

**`src/ui/state/conversation-store.ts`:**
- `FleetSession` type gained `aiTitle?: string | null` immediately below `lastMessageAt`.
- Block comment above the new field references Plan 47-03 chokepoint (working-store `useSessionAiTitle` hook), NOT-stamped-on-row rule (unlike Phase 44's rules that flowed through row derivation), and the optional-for-cache-rehydrate-compat contract.
- `isFleetSession` predicate extended with an aiTitle defensive-accept block: accepts `undefined | null | string`; rejects anything else so a corrupt cache entry cannot seed the working-store with a bogus non-string aiTitle (would stick under last-wins until next legitimate write).
- `readFleetSessionsCache` preserves aiTitle on round-trip via `aiTitle: item.aiTitle ?? null` (undefined → null coerce, matching lastMessageAt's shape).
- `writeFleetSessionsCache` persists aiTitle via `aiTitle: s.aiTitle ?? null` in the canonical projection map.

### Task 2 — FLEET_CACHE_KEY v2 → v3 + aiTitle cache round-trip tests

**`src/ui/state/conversation-store.ts`:**
- `FLEET_CACHE_KEY` bumped `"skynet:convo-fleet-cache:v2"` → `"skynet:convo-fleet-cache:v3"`.
- Docblock above the constant extended with a Phase 47 Plan 01 rationale block explaining the load-bearing nature of the bump (v2 rehydrate would seed FleetSession without aiTitle → coerced null → AppShell seed loop fires seedSessionAiTitle with null → last-wins no-op → row silently blanks; small UX cost of one clean cold-start preferred over silent-blank rehydrate).

**`src/ui/state/conversation-store.cache.test.ts`:**
- `CACHE_KEY` bumped v2 → v3.
- `SAMPLE_A` gained `aiTitle: null` (fresh-session case, comment referencing Phase 47 Plan 01 round-trip preservation contract).
- `SAMPLE_B` gained `aiTitle: "Fix cache round-trip"` (populated case, exercises string round-trip branch).
- "write-only-canonical-fields" test now expects 7 keys `[aiTitle, created, hostId, hostName, lastMessageAt, role, sessionName]` (was 6 pre-plan; aiTitle takes alphabetical first position).

**`src/ui/state/conversation-store.test.ts`:**
- `removeFleetSession` describe block's `FLEET_CACHE_KEY` const bumped v2 → v3 with an updated Phase 47 Plan 01 rationale comment.
- Phase 44 Plan 04 describe block ("FleetSession lastMessageAt cache round-trip"):
  - `FLEET_CACHE_KEY_V2` renamed to `FLEET_CACHE_KEY_V3`.
  - `beforeEach` cleanup now removes v1 + v2 + v3 keys (defence in depth for prior-run leaks).
  - Test C wording updated ("pre-Phase-44 v2" → "current-key") with a Phase 47 note.
  - Test D uses `FLEET_CACHE_KEY_V3` for the payload write.
  - Test E flipped: writes to v3, asserts v3-written / v2-not-written (was v2/v1).
  - Test F flipped: writes v2 pre-bump payload, asserts read returns `[]` (was v1 pre-bump). Extended comment explains the Phase 47 rationale for the bump.
- New Phase 47 Plan 01 describe block appended at the end: `"conversation-store (Phase 47 Plan 01): FleetSession aiTitle cache round-trip"`:
  - Test G: writeFleetSessionsCache + readFleetSessionsCache round-trip preserves aiTitle for both null and string cases (two-item fleet, both branches exercised).
  - Test H: isFleetSession defensively rejects aiTitle: 42 (number, wrong type); good sibling entry with aiTitle: "OK" survives, proving per-entry filtering not whole-batch failure.

## Verification Results

- `npx vitest run src/backend/fleet-status/wire-protocol.test.ts` — **15/15 pass** (11 pre-existing + 4 new Phase 47 Plan 01 aiTitle tests + implicit A-guard).
- `npx vitest run src/ui/state/conversation-store.cache.test.ts` — **9/9 pass** (all SAMPLE fixture updates + canonical-fields expansion + CACHE_KEY bump green).
- `npx vitest run src/ui/state/conversation-store.test.ts` — **101/101 pass** (99 pre-Phase-47 + 2 new Phase 47 Plan 01 tests G + H).
- `npm run build:backend` — exit 0.
- `npm run build` — exit 0 (no frontend TS regressions from the additive-optional field).
- **Full suite `npx vitest run` — 198 test files, 2579 pass / 9 skipped / 1 todo / 0 fail. Exit 0. Duration 526s.**

## Acceptance Criteria Grep Verification

### Task 1

| Criterion | Target | Actual |
|---|---|---|
| aiTitle count in backend/wire-protocol.ts | ≥ 2 | 3 ✓ |
| aiTitle count in ui/fleet-status-types.ts | ≥ 2 | 3 ✓ |
| aiTitle count in ui/sessions-api.ts | ≥ 1 | 1 ✓ (interface line only; comment did not mention the word again) |
| aiTitle count in ui/conversation-store.ts | ≥ 5 | 10 ✓ (type field + isFleetSession predicate + readFleetSessionsCache + writeFleetSessionsCache + several comment refs) |
| `z.string().nullable().optional()` count | ≥ 1 | 1 ✓ |
| FRAME_SCHEMA_VERSION unchanged | == 1 (same as git show HEAD~) | 1 ✓ |
| aiTitle count in wire-protocol.test.ts | ≥ 3 | 16 ✓ |
| wire-protocol.test.ts exit 0 | exit 0 | exit 0 (15/15) ✓ |
| `as any` / `@ts-expect-error` count in 4 files | == 0 | 0 real hits (1 pre-existing comment substring in conversation-store.ts L596 mentions "as any" but is not code) ✓ |
| `npm run build:backend` | exit 0 | exit 0 ✓ |
| `npm run build` | exit 0 | exit 0 ✓ |

### Task 2

| Criterion | Target | Actual |
|---|---|---|
| cache:v3 in conversation-store.ts | == 1 | 1 ✓ |
| cache:v3 in cache.test.ts | ≥ 1 | 1 ✓ |
| cache:v2 in conversation-store.ts | == 0 | 0 ✓ |
| cache:v2 in cache.test.ts | == 0 | 0 ✓ |
| `FLEET_CACHE_KEY_V2` in store.test.ts | == 0 | 0 ✓ |
| `FLEET_CACHE_KEY_V3` in store.test.ts | ≥ 1 | 7 ✓ |
| aiTitle count in cache.test.ts | ≥ 3 | 7 ✓ (SAMPLE_A + SAMPLE_B + canonical-fields + comments) |
| aiTitle count in store.test.ts | ≥ 2 | 21 ✓ (isFleetSession block + Test G + Test H + surrounding comments) |
| cache.test.ts exit 0 | exit 0 (9/9) | exit 0 (9/9) ✓ |
| conversation-store.test.ts exit 0 | exit 0 | exit 0 (101/101) ✓ |
| `npm run build` | exit 0 | exit 0 ✓ |
| `as any` / `@ts-expect-error` count | == 0 | 0 real hits ✓ |

## Deviations from Plan

**None.** Plan executed exactly as written. No auto-fix scope invoked. No architectural decisions surfaced. No auth gates.

## Auth Gates

None. No external service auth required.

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `1b08ac1f` | `feat(47-01): extend wire-type surface with aiTitle on all four sites` |
| 2 | `efc5d618` | `feat(47-01): bump FLEET_CACHE_KEY v2 → v3 + aiTitle cache round-trip` |

## Known Stubs

None. This plan is pure type-surface extension; no data-flow paths introduced, no UI rendered. The aiTitle field simply becomes accepted at the four sites and preserved through the cache round-trip — consumer wiring lives in downstream plans (47-02 scraper populates the field on the backend; 47-03 working-store third axis stores it in-memory; 47-04 AppShell seed loop feeds it into the working-store; 47-05 row redesign renders it as the subtitle).

## Downstream Blockers Unblocked

Every subsequent Phase 47 plan can now assume the wire-type surface accepts aiTitle without further edits:
- **Plan 47-02** (backend scraper): can populate `aiTitle` on the /sessions/list response row + WS-published SessionState frame without touching wire-protocol.ts or fleet-status-types.ts.
- **Plan 47-03** (working-store third axis): can add `aiTitle: string | null` to the working-store record without any wire-type coordination.
- **Plan 47-04** (AppShell seed): can call `seedSessionAiTitle(s.hostId, s.sessionName, s.aiTitle ?? null)` in the /sessions/list handler because FleetSession now carries the field through updateFleetSessions.
- **Plan 47-05** (row redesign): can read the value via `useSessionAiTitle(sessionKey)` (once Plan 47-03 exports the hook) without any wire-type coordination.

## Threat Flags

None. This plan is a pure additive type extension on files already covered by Phase 34 trust-boundary review (fleet-status WS + /sessions/list REST). No new network endpoints, no new auth paths, no new file access patterns, no schema changes at trust boundaries. The aiTitle field flows the SAME transport surfaces the lastMessageAt field already established — attack surface unchanged.

## TDD Gate Compliance

Both Task 1 and Task 2 had `tdd="true"`. Full plan-level cycle:

- **Task 1 RED gate:** Wrote 4 new zod-parse tests (P47-01 A/B/C/D) against the pre-Task-1 SessionStateSchema; ran `npx vitest run src/backend/fleet-status/wire-protocol.test.ts` → **3 failed / 12 passed / 15 total** (Tests A, B, D failed as expected; Test C spuriously passed because zod's default schema is passthrough-tolerant for absent fields — the assertion `aiTitle === undefined` was trivially true). The 3 failures locked the RED gate.
- **Task 1 GREEN gate:** Added `aiTitle: z.string().nullable().optional()` to SessionStateSchema; ran the same test file → **15/15 pass**. RED→GREEN transition verified.
- **Task 2 RED gate:** Updated `conversation-store.cache.test.ts` (CACHE_KEY, SAMPLE_A/B, canonical-fields) + `conversation-store.test.ts` (renames + wording + 2 new tests G/H) BEFORE bumping FLEET_CACHE_KEY in source; ran both test files → **10 failed / 100 passed / 110 total**. RED gate confirmed.
- **Task 2 GREEN gate:** Bumped `FLEET_CACHE_KEY = "…v3"` in source; ran the same test files → **110/110 pass**. RED→GREEN transition verified.
- **REFACTOR gate:** No refactor commits needed — implementations were minimal (add one zod field; bump one string literal) with no obvious cleanups after passing tests. One minor post-GREEN comment edit removed a `FLEET_CACHE_KEY_V2` substring from a comment to satisfy the acceptance criterion `grep -Fc 'FLEET_CACHE_KEY_V2' == 0`; not counted as a REFACTOR gate since it was still Task 2 GREEN scope.

Per-task git-log gate sequence (each task combines TDD RED+GREEN in one commit per the plan's `tdd="true"` scope, matching the Phase 44 Plan 04 pattern):
- Task 1 commit `1b08ac1f` (RED tests P47-01 A/B/C/D, plus GREEN implementation adding aiTitle to all four sites): `feat(47-01)`.
- Task 2 commit `efc5d618` (RED via Task 2's pre-committed test updates that failed on the un-bumped v2 source, plus GREEN implementation bumping the source constant to v3): `feat(47-01)`.

## Self-Check: PASSED

- Files present:
  - `src/backend/fleet-status/wire-protocol.ts` — FOUND (SessionStateSchema gained aiTitle; block comment landed; FRAME_SCHEMA_VERSION unchanged at 1).
  - `src/backend/fleet-status/wire-protocol.test.ts` — FOUND (4 new zod-parse tests + guard).
  - `src/ui/api/fleet-status-types.ts` — FOUND (SessionState interface + block comment).
  - `src/ui/api/sessions-api.ts` — FOUND (RemoteTmuxSession interface + inline comment).
  - `src/ui/state/conversation-store.ts` — FOUND (FleetSession + isFleetSession + read/write cache + FLEET_CACHE_KEY v3 + docblock).
  - `src/ui/state/conversation-store.cache.test.ts` — FOUND (CACHE_KEY v3 + SAMPLE_A/B + canonical-fields 7-key expansion).
  - `src/ui/state/conversation-store.test.ts` — FOUND (removeFleetSession R1 v3 + FLEET_CACHE_KEY_V3 rename + Tests C/E/F wording + new Phase 47 Plan 01 describe with Tests G + H).
  - `.planning/phases/47-convo-list-per-row-current-work-hint-from-ai-title-extends-f/47-01-SUMMARY.md` — FOUND (created).
- Commits present in git log: `1b08ac1f` + `efc5d618` — verified via `git log --oneline -5`.
- Full-suite green: `npx vitest run` → 198 test files, 2579 pass / 9 skipped / 1 todo / 0 fail / exit 0.
- Backend build green: `npm run build:backend` → exit 0.
- Frontend build green: `npm run build` → exit 0.
- Scope fence honored: only 7 files modified (matches plan's `files_modified` list exactly). No edits to backend scraper (routes/sessions.ts, ssh-poll-orchestrator.ts), session-working-store.ts, AppShell.tsx, or any pretty-conversations file — Plans 47-02 through 47-05 own those surfaces.
- No type-safety escape hatches added: `git diff HEAD~2 HEAD | grep -c 'as any\|@ts-expect-error'` returns 0.
