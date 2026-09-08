---
phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
plan: 01
subsystem: matrix
tags: [phase-88, matrix, sanitizer, mxid, pure-helper]
requires: []
provides:
  - sanitizeUsernameToLocalpart (src/backend/matrix/username-to-mxid.ts)
  - buildHumanMxid (src/backend/matrix/username-to-mxid.ts)
  - generateHumanRelayPassword (src/backend/matrix/username-to-mxid.ts)
  - extractServerName (src/backend/matrix/username-to-mxid.ts)
affects: []
tech-stack:
  added: []
  patterns:
    - bijective-escape-table (escape-the-escape-char-first ordering, D-07)
    - pure-module (zero I/O, zero cross-module imports)
key-files:
  created:
    - src/backend/matrix/username-to-mxid.ts
    - src/backend/matrix/username-to-mxid.test.ts
  modified: []
decisions:
  - "D-07 escape table: _ → __ FIRST (escape-the-escape), then @ → _at_, . → _dot_"
  - "D-08 mirror: randomBytes(24).toString(hex) — 48 hex chars, 96 bits entropy"
  - "extractServerName duplicated from identity-birth-orchestrator to keep module self-contained (zero cross-module coupling)"
metrics:
  duration_minutes: 12
  completed: "2026-09-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
---

# Phase 88 Plan 01: Username-to-MXID Pure Helper Summary

**One-liner:** Bijective username→mxid sanitizer + password generator for Phase 88 slice A — four pure exports, self-contained via node:crypto only, 16 unit tests at 100% pass rate.

## Exported Symbols and Signatures

```typescript
// src/backend/matrix/username-to-mxid.ts

export function sanitizeUsernameToLocalpart(username: string): string
// Bijective escape: lowercase → ESCAPE_TABLE in order → return localpart string.
// Does NOT append _human suffix (caller's concern per D-06).

export function buildHumanMxid(username: string, serverName: string): string
// Returns `@${sanitizeUsernameToLocalpart(username)}_human:${serverName}` (D-06).
// serverName must already be extracted (no scheme, no port).

export function generateHumanRelayPassword(): string
// Returns randomBytes(24).toString("hex") — 48 hex chars, 96 bits entropy (D-08).
// Value is discarded on the spot by caller; never logged, never stored.

export function extractServerName(homeserverBase: string): string
// Strips scheme (http:// / https://), trailing path, and port suffix.
// Duplicated from identity-birth-orchestrator.ts lines 470-478.
```

## Escape Table Ordering (Proof that `_` → `__` is FIRST)

```typescript
const ESCAPE_TABLE: readonly (readonly [RegExp, string])[] = [
  [/_/g, "__"],   // line 32 — MUST be first (escape the escape character)
  [/@/g, "_at_"], // line 33
  [/\./g, "_dot_"],
];
```

`grep -n '/_/g\|/@/g' src/backend/matrix/username-to-mxid.ts` confirms `/_/g` on line 32 (lower) and `/@/g` on line 33 (higher). The ordering is grep-verifiable by line-number comparison.

**Why ordering is load-bearing (Pitfall 3):** If `@` → `_at_` ran first, a subsequent `_` → `__` pass would double the underscores already inside `_at_`, making `foo@bar` and `foo_at_bar` produce the same output. With `_` → `__` first: literal underscores in input are doubled before any other escape introduces them, so all escape-sequence underscores are new and cannot be confused with pre-existing ones.

## Canonical Input → Output Table

| Input username | sanitizeUsernameToLocalpart output | buildHumanMxid output (server: thenasty.taild9b663.ts.net) |
|---|---|---|
| `ashley` | `ashley` | `@ashley_human:thenasty.taild9b663.ts.net` |
| `Ashley` | `ashley` | `@ashley_human:thenasty.taild9b663.ts.net` |
| `ashley@aitherhealth.com` | `ashley_at_aitherhealth_dot_com` | `@ashley_at_aitherhealth_dot_com_human:thenasty.taild9b663.ts.net` |
| `snake_case` | `snake__case` | `@snake__case_human:thenasty.taild9b663.ts.net` |
| `foo@bar` | `foo_at_bar` | — |
| `foo_at_bar` | `foo__at__bar` | — |

The last two rows demonstrate bijectivity: distinct inputs → distinct outputs.

## Test Run Output (16/16)

```
 RUN  v4.1.8 /home/ubuntu/skynet-taylor

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  09:59:47
   Duration  4.63s (transform 1.07s, setup 610ms, import 906ms, tests 243ms, environment 4ms)
```

Test file: `src/backend/matrix/username-to-mxid.test.ts` (135 lines, 5 describe blocks)

- `sanitizeUsernameToLocalpart` (4 tests): lowercase, passthrough, email escaping, escape-the-escape
- `bijectivity guards (D-07)` (2 tests): `_at_` collision prevention, distinct outputs proof
- `buildHumanMxid (D-06)` (3 tests): simple mxid shape, email mxid shape, MXID_RE gate
- `generateHumanRelayPassword (D-08)` (3 tests): length 48, hex charset, non-determinism
- `extractServerName` (4 tests): https+port, http+IP+port, bare hostname, trailing path

Zero mocks used — pure functions require no stubbing.

## Confirmation: No Cross-Module Imports

```
grep -cE 'from "(\.\.?/|src/)' src/backend/matrix/username-to-mxid.ts
→ 0
```

Only import is `import { randomBytes } from "node:crypto"` (Node built-in). Module is fully self-contained — Plan 03 can import it without any additional setup or transitive dependencies.

## Commits

| SHA | Message |
|-----|---------|
| 486ecfaa | test(88-01-02): add 16 pure unit tests for username-to-mxid.ts |
| cf2b0de3 | feat(88-01-01): add username-to-mxid.ts — pure sanitizer + mxid builder |

## Deviations from Plan

None — plan executed exactly as written. Both tasks implemented in TDD order (source file first, then tests). All 16 test behaviors from the plan's `<behavior>` block are represented as distinct `it()` cases.

## Threat Model Compliance

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-88-01 | Escape-the-escape `_` → `__` first; tests 4-6 prove bijectivity | Implemented + tested |
| T-88-02 | Regex-based escape table covers disallowed chars; test 9 (MXID_RE gate) proves Synapse compliance | Implemented + tested |
| T-88-03 | No logging side-effects; JSDoc mandates discard; module has no logger import | Implemented |
| T-88-04 | Single-char literal regexes in ESCAPE_TABLE — provably ReDoS-safe; length gated upstream | Accepted |
| T-88-SC | No new packages — only node:crypto (Node built-in) | Confirmed |

## Known Stubs

None — all four exports are fully functional. No placeholder values, no hardcoded returns.

## Threat Flags

None — no new network endpoints, no auth paths, no file access, no schema changes. The module is pure computation only.

## Self-Check: PASSED

- [x] `src/backend/matrix/username-to-mxid.ts` exists
- [x] `src/backend/matrix/username-to-mxid.test.ts` exists
- [x] Commit cf2b0de3 exists (feat Task 1)
- [x] Commit 486ecfaa exists (test Task 2)
- [x] 16/16 tests pass
- [x] tsc --noEmit: zero errors
