---
phase: 43-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i
plan: 01
subsystem: backend/database/routes + backend/claude-session (consumer)
tags: [fleet-status, recency, sessions-list, dormant-identity, jsonl-discovery]
requires:
  - src/backend/claude-session/discover-identity-session-file.ts (Phase 32 mechanism — consumed as-is)
  - src/backend/claude-session/session-file-parser.ts (parseSessionLine + MESSAGE_BEARING_KINDS shapes)
provides:
  - "GET /sessions/list now emits `lastMessageAt: number | null` on every TmuxSessionRow"
  - "Per-session Promise.all dispatch of discoverIdentitySessionFile + tail scan on the same already-open per-host SSH conn"
  - "Per-session try/catch + Promise.race(PER_HOST_TIMEOUT_MS) isolates one failure from siblings"
affects:
  - src/backend/database/routes/sessions.ts (route handler)
  - src/backend/database/routes/sessions.test.ts (coverage)
tech-stack:
  added: []
  patterns:
    - Same-conn parallel dispatch mirroring the pre-existing resolveRoleForIdentity block at sessions.ts:108
    - Local re-declaration of MESSAGE_BEARING_KINDS (canonical in ssh-poll-orchestrator.ts) — no cross-cutting shared module
    - vi.mock("../../claude-session/discover-identity-session-file.js") for test-side control of discovery result
key-files:
  created: []
  modified:
    - src/backend/database/routes/sessions.ts
    - src/backend/database/routes/sessions.test.ts
decisions:
  - "MESSAGE_BEARING_KINDS re-declared locally in sessions.ts (not cross-imported) per 43-CONTEXT.md scope decision — orchestrator owns the canonical copy; both sites are single-source at the module level."
  - "Field on TmuxSessionRow is required-on-the-server-but-null-when-unknown (`lastMessageAt: number | null;`, NOT optional) — wire optionality lives at the wire schema, route always emits."
  - "Per-session discovery + tail dispatched INSIDE the existing rows.map Promise.all, in a nested Promise.all([roleResolveBlock, lastMessageAtBlock]) so wall-clock stays bounded by max(role, lastMessageAt) per session."
  - "Discovery-null path returns lastMessageAt: null (same semantics as identities that never sent /id as first turn — not a regression)."
metrics:
  duration: ~35min (implementation + tests + full-suite green)
  completed: 2026-08-18
---

# Phase 43 Plan 01: /sessions/list route extended with per-session lastMessageAt derivation — Summary

Dormant identities now carry an inline `lastMessageAt: number | null` on every `/sessions/list` row, derived per-session on the same already-open per-host SSH conn via `discoverIdentitySessionFile(conn, sessionName)` + `tail -n 200` + MESSAGE_BEARING_KINDS filter — closing the dormant-side data gap that made Rule 1 hoist supervisor-killed identity rows to the top of the middle zone.

## What Landed

**Route change (`src/backend/database/routes/sessions.ts`):**
- `TmuxSessionRow` interface gains `lastMessageAt: number | null;` (required, always emitted; null when discovery fails / no history / timeout).
- Two new imports: `discoverIdentitySessionFile` (Phase 32 mechanism, consumed as-is) and `parseSessionLine` (for kind + ts extraction).
- Module-scoped `MESSAGE_BEARING_KINDS = new Set(["message", "image", "relay_outbound", "relay_inbound"])` + local `scanTailForNewestMessageAt(tailContents)` helper. Values IDENTICAL to `ssh-poll-orchestrator.ts:146-206`. Re-declared locally rather than cross-imported per 43-CONTEXT.md "no new shared module" scope decision; the doc comment above the constant flags the dual-site invariant so a future edit to one won't drift from the other.
- Row-init assigns `lastMessageAt: null as number | null` alongside `role: null`.
- Inside the existing `rows.map(async (row) => {...})` Promise.all, added a SECOND per-session block (`lastMessageAtBlock`) dispatched concurrently with the existing `roleResolveBlock` via nested `Promise.all([roleResolveBlock, lastMessageAtBlock])`. Wall-clock per session stays bounded by `max(roleResolve, lastMessageAtDerive)`.
- The lastMessageAt block wraps its work in `Promise.race([<discovery-then-tail>, timeoutRejection(PER_HOST_TIMEOUT_MS=3000)])` + try/catch. On any failure (discovery returns null, tail is empty, tail scan finds zero message-bearing frames, discovery rejects, discovery times out, tail exec throws), the catch sets `row.lastMessageAt = null` and emits `sshLogger.debug` with `operation: "sessions_list_last_message_at_skip"` — mirrors the pre-existing role-resolve skip pattern byte-for-byte.
- Path is single-quote-wrapped defensively (`tail -n 200 '${jsonlPath}' 2>/dev/null || true`); discovery module's output is by-construction shell-safe (absolute `~/.claude/projects/<slug>/<uuid>.jsonl` path).

**Test coverage (`src/backend/database/routes/sessions.test.ts`):**
- New `vi.mock("../../claude-session/discover-identity-session-file.js", ...)` above the imports; `mockedDiscover = vi.mocked(discoverIdentitySessionFile)` for per-test setup.
- Top-of-file `beforeEach` defaults `mockedDiscover.mockResolvedValue(null)` so tests that don't specifically care about discovery get the null-fallback behavior (matches the "identity never invoked /id" case).
- JSONL fixture builders `jsonlMessageLine`, `jsonlToolUseLine`, `jsonlBackgroundTaskLine` copied verbatim from `ssh-poll-orchestrator.test.ts:969-1019` to lock filter-symmetry with the live-side poller — same fixtures, same expected outcomes.
- New `describe("GET /sessions/list — lastMessageAt derivation", ...)` block with 6 tests corresponding to Task 1 `<behavior>` Tests 1-6:
  1. Happy path: two sessions get numeric lastMessageAt from discovered JSONL tail (assertion: `tanya.lastMessageAt === 5000`, `tiffany.lastMessageAt === 7000`).
  2. Discovery returns null: dormant identity lands `lastMessageAt: null`, sibling with successful discovery keeps its numeric value.
  3. Discovery hangs: mocked discovery returns a never-resolving Promise; `Promise.race(PER_HOST_TIMEOUT_MS)` rejects, row lands null, sibling unaffected. Elapsed-time assertion bounds the response by <8s.
  4. Tail zero message-bearing frames: discovery succeeds, tail contains only tool_use lines (parseSessionLine returns `kind:"skip"`); row lands null.
  5. Message-bearing filter lock: fixture with `user@1000 + tool_use@1500 + assistant@2000 + bg_task@2500` → assertion `lastMessageAt === 2000` (tool_use + bg_task excluded because parseSessionLine returns `kind:"skip"` for them). Mirrors ssh-poll-orchestrator.test.ts Test D at :1055-1088 to prove filter symmetry.
  6. Contract lock: every row's response has `"lastMessageAt" in row === true` and the value is `null` (not undefined, not absent) — locks the "server always emits" invariant.
- All 4 pre-existing role-resolution tests extended with `expect(row?.lastMessageAt).toBeNull()` presence assertions (Test 4's empty-body case documented as vacuously satisfied).

## Verification Results

- `npx vitest run src/backend/database/routes/sessions.test.ts` — **10/10 pass** (4 pre-existing role + 6 new lastMessageAt).
- `npm run build:backend` — exit 0.
- `npm run build` — exit 0 (frontend + backend both green).
- Full suite `npx vitest run` — **191 test files, 2440 pass / 9 skipped / 1 todo / 0 fail**. Duration 1083s. Exit 0.

## Acceptance Criteria Grep Verification

| Criterion | Result |
|---|---|
| `grep -c lastMessageAt src/backend/database/routes/sessions.ts` >= 4 | 13 hits |
| `grep -n "discoverIdentitySessionFile" ...sessions.ts` returns exactly 1 call site + 1 import | 1 call (`L195`) + 1 import (`L14`) ✓ |
| `grep -Fn 'new Set(["message", "image", "relay_outbound", "relay_inbound"])'` exactly 1 line | 1 hit (`L37`) ✓ |
| `grep -c "MESSAGE_BEARING_KINDS"` >= 2 | 4 hits ✓ |
| `grep -n "sessions_list_last_message_at_skip"` exactly 1 | 1 hit (`L229`) ✓ |
| `grep -c "PER_HOST_TIMEOUT_MS"` >= 3 | 6 hits ✓ |
| Interface declaration reads `lastMessageAt: number \| null;` (NOT optional) | `L70` — exact match ✓ |
| Test: `grep -c lastMessageAt sessions.test.ts` >= 12 | 42 hits ✓ |
| Test: `grep -c 'describe("GET /sessions/list'` >= 2 | 2 hits ✓ |
| Test: `grep -n "vi.mock.*discover-identity-session-file"` exactly 1 | 1 hit (`L71`) ✓ |
| Test: JSONL helpers declared >= 3 | 3 hits (jsonlMessageLine `L184`, jsonlToolUseLine `L202`, jsonlBackgroundTaskLine `L222`) ✓ |
| Test 5 asserts `lastMessageAt === 2000` (filter lock) | Present in new describe block ✓ |
| `grep -c 'as any\|@ts-expect-error'` in diff | 0 ✓ |

## Deviations from Plan

**None.** Plan executed exactly as written. Two minor formatting choices worth noting (not deviations):

1. The `MESSAGE_BEARING_KINDS` Set literal was initially written as a multi-line array-of-strings for readability, then collapsed to a single line to satisfy the acceptance-criteria grep spec (`grep -n 'new Set(\[...\])'` explicitly required "exactly 1 line" match). Semantically identical either way.

2. The per-session parallel dispatch was expressed as `await Promise.all([roleResolveBlock, lastMessageAtBlock])` inside the existing `rows.map(async (row) => {...})` outer Promise.all — verbatim per plan step 5. Each inner block is a self-contained IIFE async closure that owns its own try/catch + Promise.race, matching the plan's requirement that "one hung/failed frontmatter read OR JSONL discovery must NOT kill the whole host."

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `bb50407d` | `feat(43-01): extend /sessions/list route with per-session lastMessageAt derivation` |
| 2 | `369f06ce` | `test(43-01): cover lastMessageAt derivation on /sessions/list route` |
| 3 | *(no code change — verification only)* | build:backend + build both exit 0; no `as any`/`@ts-expect-error` added |

## Known Stubs

None. `lastMessageAt` is fully wired end-to-end at the route layer — it either carries the newest MESSAGE_BEARING_KINDS ts from the discovered JSONL, or explicit `null` on any failure path.

## Downstream Blockers Unblocked

Wave 2 Plan 43-03 (session-working-store reconciliation chokepoint) can now consume `lastMessageAt` from the `/sessions/list` payload via the seed API it will introduce — the wire-side shape is stable and additive-optional per 43-CONTEXT.md.

## Self-Check: PASSED

- Files present: `src/backend/database/routes/sessions.ts` (modified, present), `src/backend/database/routes/sessions.test.ts` (modified, present), `.planning/phases/43-fix-convo-list-recency-signal-switch-dormant-live-paths-to-i/43-01-SUMMARY.md` (created, present).
- Commits present in git log: `bb50407d`, `369f06ce`.
- Full-suite green: `npx vitest run` → 2440 pass / 0 fail / exit 0.
- Backend build green: `npm run build:backend && npm run build` → both exit 0.
- Scope fence honored: only `src/backend/database/routes/sessions.ts` + its test file modified. No edits to `wire-protocol.ts`, `discover-identity-session-file.ts`, `ssh-poll-orchestrator.ts`, or any UI file.
