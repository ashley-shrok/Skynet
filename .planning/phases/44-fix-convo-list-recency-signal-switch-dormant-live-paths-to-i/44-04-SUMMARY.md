---
phase: 44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i
plan: 04
subsystem: ui/state (conversation-store type + comparator) + ui (AppShell seed-loop wire consumer)
tags: [conversation-list, recency, null-to-bottom-flip, seed-wire-consumer, fleet-session-type, cache-key-bump, comparator-flip, wave-3-final]
requires:
  - Plan 44-01 (backend /sessions/list emits lastMessageAt inline — this plan consumes it end-to-end via the FleetSession type extension)
  - Plan 44-03 (working-store `seedSessionLastMessageAt` chokepoint + `RemoteTmuxSession.lastMessageAt` wire type — this plan is the wire consumer)
provides:
  - "FleetSession type carries optional `lastMessageAt?: number | null`; cache round-trip preserves the field via v2 key (bumped from v1 to force clean rehydrate under the flipped Rule 1)"
  - "compareByRecencyDesc Rule 1 flipped null-to-top → null-to-bottom (Ashley's 2026-08-14 no-history-to-top lock retired per 44-CONTEXT.md § Comparator change)"
  - "AppShell.tsx /sessions/list handler feeds Plan 44-03 chokepoint from BOTH cached-rehydrate path AND fresh-fetch path per-row via seedSessionLastMessageAt(s.hostId, s.sessionName, s.lastMessageAt ?? null)"
affects:
  - src/ui/state/conversation-store.ts (FleetSession type + isFleetSession predicate + cache round-trip + cache key v1→v2 + compareByRecencyDesc Rule 1 flip + docblock updates)
  - src/ui/state/conversation-store.test.ts (Test C flipped ["r2","r1"] → ["r1","r2"]; Test J flipped ["t2","t1"] → ["t1","t2"]; 9 new Phase 44 Plan 04 tests appended in 2 new describe blocks; removeFleetSession Test R1 v2-key update)
  - src/ui/state/conversation-store.cache.test.ts (CACHE_KEY bumped v1→v2; SAMPLE_A/B fixtures gain lastMessageAt; canonical-fields test expects 6 keys)
  - src/ui/AppShell.tsx (seedSessionLastMessageAt import + 2 call sites in the /sessions/list effect: cached loop + fresh loop)
tech-stack:
  added: []
  patterns:
    - Fresh-fetch AND cached-rehydrate BOTH feed the max-wins chokepoint (single-path seed would drop the seed for that source class of session; both paths are load-bearing)
    - Cache-key version bump (v1→v2) as a deploy-time invariant enforcer — v1 rehydrate under the flipped Rule 1 would sink cached rows to bottom; v2 forces one clean cold-start on deploy
    - Comparator flip landed in the SAME plan as its test updates (test-locking-then-code-flip-then-test-update all in one plan; no cross-plan half-state where tests assert stale contract)
key-files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/state/conversation-store.cache.test.ts
    - src/ui/AppShell.tsx
decisions:
  - "Rule 1 flip is UNCONDITIONAL — no feature flag, no toggle. Ashley's 2026-08-14 no-history-to-top lock is DELIBERATELY retired per 44-CONTEXT.md § Comparator change. Rationale locked at CONTEXT.md L59-63: null-to-bottom is Ashley's new preferred contract; no-history rows sink to bottom of middle rather than hoisting above real-message rows."
  - "Cache-key bump v1→v2 is load-bearing (not cosmetic). Without it, v1 rehydrate on Phase 44 first-load seeds objects with `lastMessageAt: undefined` → normalizeUndefinedToNull → null → the flipped Rule 1 (null-to-bottom) sinks them to bottom before the ~200ms fresh fetch resolves. Bumping to v2 forces one clean cold-start post-deploy; small acceptable UX cost, avoids a transient wrong-order paint."
  - "AppShell seed-loop fires in BOTH paths (cached-hit + fresh-fetch) — missing either drops the seed for that source class of session. Cached path paints correct middle-zone order immediately on cold-start (before fresh fetch resolves); fresh path is the wire consumer for Plan 44-01's response."
  - "cache.test.ts fixture update bundled with Task 3 commit as Rule 1 auto-fix. The v1→v2 bump landed in Task 1 broke the cache-test's CACHE_KEY constant and canonical-fields assertion; the fix is a downstream consequence of Task 1's cache-key bump (not an out-of-scope discovery). Documented in Task 3 commit message so the auto-fix scope is traceable in git history."
  - "Test C and Test J assertions flipped IN-PLACE (rather than deleted + replaced) — the pre-Phase-44 assertions locked the load-bearing null-to-top rule; the flipped assertions lock the load-bearing null-to-bottom rule. Test bodies preserved verbatim except for the toEqual argument order and title/comment updates referencing the Phase 44 Plan 04 flip. This keeps git-blame history for the test intact."
metrics:
  duration: ~45min (Task 1 TDD + Task 2 comparator flip + Task 2 test updates + Task 3 AppShell wire + Task 4 full-suite verification)
  completed: 2026-08-18
---

# Phase 44 Plan 04: AppShell seed-wire consumer + FleetSession lastMessageAt type + compareByRecencyDesc Rule 1 null-to-bottom flip — Summary

Closes the Phase 44 loop. Plan 44-01 gave dormant identities the /sessions/list lastMessageAt signal; Plan 44-02 gave live identities the discovery-based JSONL derivation; Plan 44-03 landed the max-wins reconciliation chokepoint at the working-store. This plan (a) extends FleetSession type to carry lastMessageAt through updateFleetSessions, (b) wires AppShell to feed the chokepoint from BOTH the cached-rehydrate path AND the fresh-fetch path per-row, and (c) flips compareByRecencyDesc Rule 1 from null-to-top to null-to-bottom — the frontend now actually renders the recency-sorted middle correctly with dormant identities at their true recency position (freshest-known-message at top; no-history rows sunk to bottom).

## What Landed

**`src/ui/state/conversation-store.ts`:**
- `FleetSession` type gained `lastMessageAt?: number | null` (optional — pre-Phase-44 backend responses and v1 cache entries omit it). Field carries from `/sessions/list` response through `getSessionList()` → `updateFleetSessions()` → `state.fleetSessions[]`. Consumed by AppShell to feed `seedSessionLastMessageAt`; does NOT flow into `ConversationRow` directly (that path stays via `resolveLastMessageAt` → working-store `getSessionLastMessageAt`).
- `isFleetSession` predicate extended to accept undefined, null, or number for lastMessageAt; rejects other types defensively so a corrupt cache entry never seeds max-wins with a non-numeric ts.
- `readFleetSessionsCache` preserves lastMessageAt on round-trip; coerces undefined → null so downstream consumers (AppShell seed loop) have a consistent shape.
- `writeFleetSessionsCache` persists lastMessageAt (`?? null` coerce for undefined).
- **Cache-key bumped `skynet:convo-fleet-cache:v1` → `skynet:convo-fleet-cache:v2`.** Load-bearing: v1 entries lack the field, and under the flipped Rule 1 a v1 rehydrate would sink rows to bottom before the fresh /sessions/list fetch resolves. Bump forces one clean cold-start post-deploy.
- `compareByRecencyDesc` Rule 1 flipped:
  ```
  OLD: aTs === null && bTs !== null → return -1  (null-to-top)
       aTs !== null && bTs === null → return  1
  NEW: aTs === null && bTs !== null → return  1  (null-to-bottom)
       aTs !== null && bTs === null → return -1
  ```
  Rules 2 (insertion-order fallback among null rows), 3 (real timestamps DESC), and 4 (identical-ts fallback) preserved verbatim.
- Docblock rewrites: file-header contract summary, ConversationList docblock, row.lastMessageAt JSDoc, and compareByRecencyDesc docblock all updated to reference null-to-bottom and Phase 44 Plan 04 phaseover. Retired the stale "Plan 03 has NOT yet landed" note (Plan 03 landed; Phase 44 completes the wire-through).

**`src/ui/AppShell.tsx`:**
- Added `seedSessionLastMessageAt` to the existing session-working-store import block.
- In the `/sessions/list` mount effect at L587-620:
  - AFTER `updateFleetSessions(cached)`: iterates `cached` and calls `seedSessionLastMessageAt(s.hostId, s.sessionName, s.lastMessageAt ?? null)` for each. Paints correct middle-zone order immediately on cold-start (via flipped null-to-bottom Rule 1) before fresh fetch resolves.
  - AFTER `updateFleetSessions(fresh)`: iterates `fresh` and calls seed for each. Max-wins reconciliation in working-store handles ordering vs. WS-live updates (which may arrive before or after).
- No change to `updateFleetSessions(cached)` / `updateFleetSessions(fresh)` arguments; both remain one-argument shape. TG-17 empty-dep-array shape lock at L620, try/catch failure semantics, cancelled guard, writeFleetSessionsCache call — all preserved verbatim.

**`src/ui/state/conversation-store.test.ts`:**
- Pre-existing Test C (line 2683) flipped: title + assertion `expect(snap.middle.map(r => r.id)).toEqual(["r2", "r1"])` → `toEqual(["r1", "r2"])` — real-ts row first, null second. Inline comment references Phase 44 Plan 04.
- Pre-existing Test J (line 2866) flipped: title + assertion `["t2", "t1"]` → `["t1", "t2"]` — via the real fleet-status wire path. Locks that the flip lands correctly through the full pipeline (publishFleetStatusSessionState → working-store cache → conversation-store row derivation → comparator).
- Tests D/G/H unchanged (D uses two real timestamps → Rule 3; G/H exercise pinned/RDP zones where recency is ignored).
- Pre-existing Test L (line 2934 — pinned zone via real wire) unchanged.
- **6 new Phase 44 Plan 04 Task 1 tests** in `describe("conversation-store (Phase 44 Plan 04): FleetSession lastMessageAt cache round-trip")`:
  - Test A: writeFleetSessionsCache persists lastMessageAt (number + null both survive read).
  - Test B: writeFleetSessionsCache normalizes undefined → null on the wire (read yields null).
  - Test C: readFleetSessionsCache accepts pre-Phase-44 v2 entries missing lastMessageAt (coerces to null).
  - Test D: readFleetSessionsCache rejects entries whose lastMessageAt is neither undefined/null/number.
  - Test E: writeFleetSessionsCache writes to v2 cache key (v1 not written).
  - Test F: readFleetSessionsCache returns [] when only a v1 (pre-bump) cache entry exists.
- **3 new Phase 44 Plan 04 Task 2 tests** in `describe("conversation-store (Phase 44 Plan 04): compareByRecencyDesc — null-to-bottom flip")`:
  - Test L: null-cluster insertion-order stability under the flip (three null rows keep insertion order).
  - Test M: mixed real + null — 4 rows `[r1@1000, r2@null, r3@2000, r4@null]` → `["r3", "r1", "r2", "r4"]` (real DESC first, then null insertion-order).
  - Test N: single-real-vs-single-null — real-ts row lands at position 0, null at position 1 (direct semantic inverse of pre-Phase-44 Test C).
- Existing `removeFleetSession` Test R1 (line 1008) — `FLEET_CACHE_KEY` constant updated `v1` → `v2`.
- Imports: added `readFleetSessionsCache` + `writeFleetSessionsCache` to the top-of-file import block (needed by the new Task 1 tests).

**`src/ui/state/conversation-store.cache.test.ts`:**
- `CACHE_KEY` constant bumped `v1` → `v2` (Task 1 bump downstream).
- `SAMPLE_A` gains `lastMessageAt: null`; `SAMPLE_B` gains `lastMessageAt: 1_700_000_200` — both preserved through round-trip.
- "write-only-canonical-fields" test now expects 6 keys `[created, hostId, hostName, lastMessageAt, role, sessionName]` (was 5 pre-Phase-44).

## Verification Results

- `npx vitest run src/ui/state/conversation-store.test.ts` — **99/99 pass** (90 pre-existing + 9 new Phase 44 Plan 04 tests).
- `npx vitest run src/ui/state/conversation-store.cache.test.ts` — **9/9 pass** (all v2-key + lastMessageAt round-trip updates green).
- `npx vitest run src/ui/AppShell.persistence.test.tsx` — **4/4 pass** (no regression on additive seed loop).
- `npm run build:backend` — exit 0.
- `npm run build` — exit 0.
- `npx tsc --noEmit` — exit 0.
- **Full suite `npx vitest run` — 198 test files, 2538 pass / 9 skipped / 1 todo / 0 fail.** Exit 0. Duration 971s.

## Acceptance Criteria Grep Verification

| Criterion | Target | Actual |
|---|---|---|
| Rule 1 flip lands (`null-to-bottom` present in comparator) | ≥ 2 | 2 hits (docblock header + branch comment) ✓ |
| Rule 1 branches literal check: `if (aTs === null && bTs !== null) return 1;` | 1 line | 1 hit ✓ |
| Cache-key bump: `grep 'skynet:convo-fleet-cache:v2'` | ≥ 1 | 1 hit ✓ |
| Cache-key retirement: `grep 'skynet:convo-fleet-cache:v1'` | 0 | 0 hits ✓ |
| AppShell seed wiring: `grep -c 'seedSessionLastMessageAt' AppShell.tsx` | ≥ 2 (spec) / actual 3 (1 import + 2 sites) | 3 ✓ |
| Exact call shape: `grep -Fc 'seedSessionLastMessageAt(s.hostId, s.sessionName, s.lastMessageAt ?? null)' AppShell.tsx` | 2 (both call sites) | 2 ✓ |
| `Phase 44 Plan 04` comment markers on AppShell seed sites | ≥ 2 | 3 hits ✓ |
| Scope fence: only 4 files touched | 4 | conversation-store.ts + conversation-store.test.ts + conversation-store.cache.test.ts + AppShell.tsx ✓ |
| No type-safety escape hatches: `git diff HEAD~3 HEAD \| grep -c 'as any\|@ts-expect-error'` | 0 | 0 ✓ |
| Scope_fence hard blocks: `git diff HEAD~3 HEAD -- src/ui/features/pretty-conversations/ src/backend/fleet-status/wire-protocol.ts` | empty | 0 lines ✓ |
| Rule 1 test L/M/N appear in test file | ≥ 2 | 3 (Test L + Test M + Test N under new Phase 44 Plan 04 describe) ✓ |
| Test C flipped assertion | `["r1", "r2"]` | present ✓ |
| Test J flipped assertion | `["t1", "t2"]` | present ✓ |

## Deviations from Plan

**Rule 1 auto-fix bundled with Task 3.** The cache-key v1→v2 bump landed in Task 1 broke `src/ui/state/conversation-store.cache.test.ts` (a separate cache test file the Task 1 plan didn't enumerate — it was discovered when running the full state directory sweep before Task 3 commit). The break: hardcoded `CACHE_KEY = "skynet:convo-fleet-cache:v1"` and the "write-only-canonical-fields" test expected 5 keys `[created, hostId, hostName, role, sessionName]`.

**Rationale for bundling with Task 3:** the fix is a downstream consequence of Task 1's cache-key bump (not an out-of-scope discovery — it's Rule 1 auto-fix scope). Rather than amend Task 1's commit (destructive) or spin a new fifth commit, bundled into Task 3's commit with an explicit call-out in the commit message so the auto-fix scope is traceable in git history. Files updated:
- `CACHE_KEY` bumped `v1` → `v2` (matches conversation-store.ts).
- `SAMPLE_A` + `SAMPLE_B` gain `lastMessageAt` field (null + number to exercise both cases through round-trip).
- "write-only-canonical-fields" test asserts 6 canonical keys now (added `lastMessageAt`).

All 9 cache tests pass after the update.

Otherwise the plan executed exactly as written — no other deviations.

## Auth Gates

None. No external service auth required for this plan.

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `88d14dd0` | `feat(44-04): extend FleetSession with optional lastMessageAt + bump cache key v1→v2` |
| 2 | `d78d839a` | `feat(44-04): flip compareByRecencyDesc Rule 1 null-to-top → null-to-bottom` |
| 3 | `95fff43b` | `feat(44-04): wire AppShell /sessions/list handler to seed working-store per row` (includes cache.test.ts Rule 1 auto-fix bundled) |
| 4 | *(no code change — verification only per Plan 44-01/03 precedent)* | build:backend + build both exit 0; full suite 2538 pass |

## Known Stubs

None. Recency signal is wired end-to-end:
- Backend: /sessions/list emits inline lastMessageAt (Plan 44-01); orchestrator publishes via WS with JSONL-discovery-derived ts (Plan 44-02).
- Frontend chokepoint: working-store max-wins reconciliation (Plan 44-03).
- Wire consumer: AppShell seed loop (this plan) + comparator consumes via row derivation (this plan).
- No placeholder text, no hardcoded empty arrays, no TODOs. The middle-zone ordering fix ships purely by giving the existing comparator + snapshot pipeline correct inputs (per CONTEXT.md scope decision).

## Downstream Blockers Unblocked

Phase 44 code work is now COMPLETE. All 4 plans landed. Recency signal correct end-to-end for both dormant + live sessions; no-history rows sink to bottom of middle; tier-flip scroll-lurch resolved via correct-data-source-first (scroll-anchor engineering deferred per CONTEXT.md § non-goals). Verification + shipping are orchestrator-scope after this handoff:
- Full HTTPS 200 UAT walk of the pretty-conversations middle zone (dormant identities should sit at bottom; live identities at their DESC recency position).
- `docker build` + `docker compose up -d --force-recreate skynet` (orchestrator scope — Ashley 2026-08-08 fleet directive).
- Byte-verify post-deploy of the flipped comparator branches + seedSessionLastMessageAt call sites in the built AppShell chunk.
- Bounty archive: whichever bounty tracks "convo-list dormant rows hoist to top" or equivalent recency-signal correctness.

## Threat Flags

None. This plan is a pure client-side type + comparator + wire-consumer change on files already covered by Phase 34 trust-boundary review (fleet-status WS + REST). No new network endpoints, no new auth paths, no new file access patterns, no schema changes at trust boundaries.

## TDD Gate Compliance

Tasks 1 + 2 + 3 all had `tdd="true"`. Full plan-level cycle:
- **RED gates:** Task 1 tests (A-F) initially failed on the old cache-key-v1 + missing-lastMessageAt reader/writer; Task 2 tests (M, N) initially failed on the old null-to-top comparator (verified: at end of Task 1 code, running the full test file showed 97 pass / 2 fail — the 2 fails were Tests M + N under the un-flipped comparator).
- **GREEN gates:** After each Task's code change, the tests introduced during that task's RED phase all pass. Full conversation-store.test.ts suite: 99/99 pass. Full cache.test.ts: 9/9 pass. AppShell.persistence.test.tsx: 4/4 pass.
- **REFACTOR gate:** No refactor commit needed — the implementations were minimal (no obvious cleanups after passing tests).

Per-task git-log gate sequence (each Task 1-3 combines TDD RED+GREEN in one commit per the plan's `tdd="true"` scope, since each task's tests + implementation were coordinated additions rather than separate RED/GREEN commits — same pattern as Plans 44-01 Task 1 through 44-03 Task 3):
- Task 1 commit `88d14dd0` (RED tests A-F for cache round-trip + isFleetSession predicate + cache-key v2, plus GREEN implementation extending FleetSession + isFleetSession + read/write + bumping key): `feat(44-04)`.
- Task 2 commit `d78d839a` (RED via Task 1's pre-committed Tests M + N which failed on the un-flipped comparator; GREEN via the branch flip + docblock updates + Test C + Test J flips): `feat(44-04)`.
- Task 3 commit `95fff43b` (no dedicated test additions per the plan — validated via existing AppShell.persistence.test.tsx + the implicit chain via 44-03 seedSessionLastMessageAt max-wins tests; GREEN implementation adds the import + 2 seed loops + bundled Rule 1 fix for cache.test.ts): `feat(44-04)`.

## Self-Check: PASSED

- Files present:
  - `src/ui/state/conversation-store.ts` — FOUND (modified — FleetSession + isFleetSession + cache key v2 + cache round-trip + Rule 1 flip + docblock updates all landed).
  - `src/ui/state/conversation-store.test.ts` — FOUND (modified — Test C + Test J flipped; 9 new Phase 44 Plan 04 tests appended; removeFleetSession R1 v2-key update; imports extended).
  - `src/ui/state/conversation-store.cache.test.ts` — FOUND (modified — CACHE_KEY v2 + SAMPLE_A/B lastMessageAt + canonical-fields test expects 6 keys).
  - `src/ui/AppShell.tsx` — FOUND (modified — seedSessionLastMessageAt import + 2 seed loops in /sessions/list effect).
  - `.planning/phases/44-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/44-04-SUMMARY.md` — FOUND (created).
- Commits present in git log: `88d14dd0` + `d78d839a` + `95fff43b` — verified via `git log --oneline -10`.
- Full-suite green: `npx vitest run` → 2538 pass / 0 fail / exit 0.
- Backend build green: `npm run build:backend` → exit 0.
- Frontend build + typecheck green: `npm run build` → exit 0; `npx tsc --noEmit` → exit 0.
- Scope fence honored: only 4 files (conversation-store.ts + conversation-store.test.ts + conversation-store.cache.test.ts + AppShell.tsx) modified. No edits to PrettyConversationsPanel.tsx, pretty-conversations.css, wire-protocol.ts, discover-identity-session-file.ts, ssh-poll-orchestrator.ts, or any file outside this plan's file list. Scope_fence hard blocks (PrettyConversationsPanel.tsx, pretty-conversations.css, wire-protocol.ts) verified: `git diff HEAD~3 HEAD -- src/ui/features/pretty-conversations/ src/backend/fleet-status/wire-protocol.ts` returns empty.
- No type-safety escape hatches: `git diff HEAD~3 HEAD | grep -c 'as any\|@ts-expect-error'` returns 0.
