---
phase: 92-fleet-status-poller-batch-sweep-one-exec-per-host-not-one-pe
plan: 01
subsystem: backend/fleet-status
tags: [schema, jsonl, wire-contract, tdd]
dependency_graph:
  requires: []
  provides:
    - v1 JSONL wire schema (SweepIdentityLine + SweepPidLine)
    - parseSweepJsonl() lenient parser
    - SWEEP_SCHEMA_VERSION constant (=1)
    - SWEEP_FIELD_PARITY exec-site → field map
    - isSweepLineOfCurrentSchema() narrow validator
  affects:
    - Plan 92-02 (sweep script — must emit these exact field names)
    - Plan 92-04 (caller rewire — imports parseSweepJsonl + schema constant)
    - Plan 92-05 (regression tests — reuse types as fixtures)
tech-stack:
  added: []
  patterns:
    - "Discriminated-union line kinds (line_kind: 'identity' | 'pid')"
    - "Lenient never-throws parser; caller owns fallback policy (mirrors L1770–L1790 perSessionUsable pattern)"
    - "Schema-version guard at the parser boundary (matches RESEARCH.md Backward-compat)"
    - "Stat-result mirror of ssh-poll-orchestrator.ts StatReadResult so isStaleFromStat feeds unchanged (Bounty 9c8d4a72)"
key-files:
  created:
    - src/backend/fleet-status/sweep-schema.ts
    - src/backend/fleet-status/sweep-schema.test.ts
  modified: []
decisions:
  - "Open question #1 (JSONL shape): two-tier — one SweepIdentityLine per identity + zero-or-more SweepPidLine per live claude PID, joined by identity name"
  - "Parser is lenient: broken JSON silently discarded, schema mismatch reported (not thrown), caller decides fallback"
  - "A11 (per-PID JSONL discovery) folded server-side into SweepIdentityLine.jsonl_path — no separate per-PID discovery on wire"
  - "A4 + A5 (PID→tmux→identity) folded server-side into SweepPidLine.identity — replaces two-exec resolvePidToTmuxSession"
  - "A3 (box-wide last-stop-payload) documented as skipped — legacy per RESEARCH G9; per-session A9 supersedes"
  - "dormant_a kept as distinct SweepPidLine field despite equalling SweepIdentityLine.dormant in common case (RESEARCH G7) — preserves Plan 04 dual-frame code path byte-for-byte"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-09"
  tasks: 1
  files_created: 2
  files_modified: 0
  tests_added: 25
---

# Phase 92 Plan 01: Lock v1 JSONL Sweep Schema — Summary

Locked the v1 JSONL wire contract for the fleet-status batch sweep in a single TypeScript module that both the sweep-script producer (Plan 02) and the caller-side parser (Plan 04) will depend on. The schema, parser, parity map, and 25 unit tests all live together in `sweep-schema.ts` + `sweep-schema.test.ts` — no downstream file touched.

## Chosen schema shape

**Two-tier emission** — one `SweepIdentityLine` per identity folder followed by zero-or-more `SweepPidLine` per live claude PID for that identity. Rows are joined by the `identity` field. A single flat "one line per identity" shape was rejected because source A is PID-keyed and source B is identity-keyed (RESEARCH G1), forcing either null-padding of the PID axis or array-nesting for identities running multiple parallel claude sessions. Two-tier keeps each JSONL line flat, matches the caller's own internal decomposition (`livenessMap` by PID, `identityRecycleState` by identity name), and keeps the wire small.

Every line carries `schema_version: 1` and a `line_kind` discriminator (`"identity"` or `"pid"`).

## Final field lists

### `SweepIdentityLine` (source-B parity)

| Field               | Type                     | RESEARCH row |
| ------------------- | ------------------------ | ------------ |
| `line_kind`         | `"identity"`             | discriminator |
| `schema_version`    | `1`                      | version guard |
| `identity`          | `string`                 | identity folder name |
| `dormant`           | `boolean`                | B1 (`.dormant`) |
| `recycled_at`       | `boolean`                | B2 (`.recycled-at`) |
| `recycle_requested` | `boolean`                | B3 (`.recycle-requested`) |
| `jsonl_path`        | `string \| null`         | B4 (Phase 32 discovery) |
| `layer1_recycling`  | `boolean \| null`        | B5 (tail-scan verdict, null = tail unreadable this tick) |

### `SweepPidLine` (source-A parity)

| Field                        | Type                          | RESEARCH row |
| ---------------------------- | ----------------------------- | ------------ |
| `line_kind`                  | `"pid"`                       | discriminator |
| `schema_version`             | `1`                           | version guard |
| `identity`                   | `string`                      | join key (A4+A5 folded server-side) |
| `pid`                        | `number`                      | from ~/.claude/sessions/<pid>.json filename |
| `session_json`               | `string \| null`              | A1 (raw contents; caller runs parseSessionJson) |
| `stat_result`                | `SweepStatResult` (union)     | A2 (mirrors StatReadResult; caller runs isStaleFromStat) |
| `per_session_stop_mtime_ms`  | `number \| null`              | A6 (Phase 59 stop-<sid>.json mtime → ms) |
| `activity_mtime_ms`          | `number \| null`              | A7 (Phase 62 activity marker mtime → ms) |
| `stopped_mtime_ms`           | `number \| null`              | A8 (Phase 62 stopped marker mtime → ms) |
| `per_session_stop_payload`   | `string \| null`              | A9 (raw payload; caller runs parseStopHookPayload) |
| `dormant_a`                  | `boolean`                     | A10 (source-A dormant path; kept distinct from B1 per RESEARCH G7) |
| `jsonl_tail`                 | `string \| null`              | A12 (up-to-256KB tail for ai-title scan; caller runs scanTailForLatestAiTitle) |

`SweepStatResult` mirrors `StatReadResult` from `ssh-poll-orchestrator.ts`:
```ts
type SweepStatResult =
  | { ok: true; content: string }
  | { ok: false; reason: "enoent" | "transport" };
```

## Skipped RESEARCH rows (documented in `SWEEP_FIELD_PARITY`)

| Row | Why skipped |
| --- | --- |
| A0  | Per-host source-A enumeration driver (`ls ~/.claude/sessions/*.json`) — server-side loop; each live PID becomes its own `SweepPidLine`. No wire field needed. |
| A3  | Box-wide `last-stop-payload.json` — legacy per RESEARCH G9. Per-session A9 supersedes it. Plan 04 caller MUST NOT fall back to A3 when `per_session_stop_payload` is null (matches today's `perSessionUsable` branch). |
| A4  | `cat /proc/<pid>/environ` — folded server-side. Result surfaces as `SweepPidLine.identity`. |
| A5  | `tmux display-message` — folded server-side alongside A4. Result surfaces as `SweepPidLine.identity`. |
| A11 | Per-PID Phase 32 JSONL discovery — folded into `SweepIdentityLine.jsonl_path`. Source-A PIDs whose identity matches a `SweepIdentityLine` reuse that path. |
| B0  | Per-host source-B enumeration driver (`find ~/.claude/identities/`) — server-side loop; each identity folder becomes its own `SweepIdentityLine`. No wire field needed. |

12 mapped rows (A1, A2, A6, A7, A8, A9, A10, A12, B1, B2, B3, B4, B5) + 6 skipped rows (A0, A3, A4, A5, A11, B0) = **19 rows total** (2 enumeration drivers + 12 per-PID source-A + 5 per-identity source-B).

## Test count

**25 tests, all green.** Coverage:
- `SWEEP_SCHEMA_VERSION` constant equals 1 (1 test).
- `isSweepLineOfCurrentSchema` accepts valid identity/pid lines, rejects null/non-object/version-mismatch/unknown-kind (6 tests).
- `parseSweepJsonl` round-trip: hand-crafted 1-identity + 2-pid blob, trailing newline, blank lines (3 tests).
- `parseSweepJsonl` schema mismatch: sets flag on any `schema_version !== 1`, stays false on clean input (2 tests).
- `parseSweepJsonl` malformed lines: broken JSON silently skipped, unknown `line_kind` increments counter without flipping mismatch (2 tests).
- `stat_result` discriminated-union survives round-trip in all three shapes (ok=true, ok=false enoent, ok=false transport) (3 tests).
- `parseSweepJsonl` empty input: empty string and whitespace-only both return empty result (2 tests).
- `SWEEP_FIELD_PARITY` parity walk: all 19 keys present, all mapped fields exist on a line type, all skipped rows have non-empty reason, A0/B0 flagged as enumeration drivers, A3/A11/A4/A5 flagged as skipped with reasons (6 tests).

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Fixed parser-breaking `*/` inside JSDoc comment**
- **Found during:** Task 1 GREEN phase (first vitest run failed with oxc parse error).
- **Issue:** A JSDoc comment referenced `~/.claude/identities/*/` — the `*/` sequence closed the JSDoc block prematurely, breaking the entire file's parse and cascading a spurious "expected semicolon" error at the next tokenised word.
- **Fix:** Reworded the comment to "subdirectories under `~/.claude/identities/`" — no functional change to the file's exports or contract.
- **Files modified:** `src/backend/fleet-status/sweep-schema.ts` (comment text only).
- **Rationale for auto-fix:** Rule 3 (blocking — tests literally cannot run without this fix). No architectural or behavioral change.

## Unexpected findings

- **oxc parser is unusually strict about `*/` inside JSDoc comments.** Node's regular TS toolchain would also flag this, but the oxc-based vite pipeline surfaces it as a downstream parse error rather than an obvious "comment closed early" message. Worth remembering for future doc-heavy files with shell-path examples.
- **The parity-map test caught a real design surface.** Writing the test forced explicit enumeration of every skipped row's reason — matches Ashley's "enumerate first, code second" preference from CONTEXT.md and gives Plan 02 a durable checklist of what NOT to emit.

## Latitude decisions (where plan left room)

- **`unknownLines` semantics for broken JSON vs unknown `line_kind`.** The plan says "broken JSON is silently skipped" and "unknown `line_kind` values increment `unknownLines`." Both are honoured; broken JSON is discarded BEFORE the `unknownLines` counter can see it (pre-discrimination). Test coverage asserts both branches distinctly so Plan 04 can rely on `unknownLines === 0` meaning "no forward-compat-marker lines" specifically.
- **`isSweepLineOfCurrentSchema` deliberately shallow.** It checks schema_version + line_kind only — does NOT deep-validate every field. Rationale: the parser's job is to shape input enough for the caller; deep validation lives in the caller's existing helpers (`parseSessionJson`, `parseStopHookPayload`, `isStaleFromStat`) which are already well-tested. Adding a redundant deep validator here would duplicate contract and drift risk.
- **`SweepFieldParityEntry` split-union type.** Uses TypeScript's `{ field: string; skipped_reason?: never } | { field: null; skipped_reason: string }` so mapped rows CANNOT accidentally carry a `skipped_reason` and skipped rows CANNOT accidentally omit one. Compile-time contract, not runtime — small ergonomic win.

## Verification results

```
$ npx vitest run src/backend/fleet-status/sweep-schema.test.ts
Test Files  1 passed (1)
Tests       25 passed (25)

$ grep -c "SWEEP_FIELD_PARITY" src/backend/fleet-status/sweep-schema.ts
4

$ npx vitest run src/backend/fleet-status/
Test Files  17 passed (17)
Tests       362 passed (362)   # zero regressions in unrelated modules

$ npx tsc --noEmit 2>&1 | grep sweep-schema
(no output — no type errors)
```

All done criteria in the plan's `<done>` block satisfied.

## Self-Check: PASSED

- `src/backend/fleet-status/sweep-schema.ts` — FOUND
- `src/backend/fleet-status/sweep-schema.test.ts` — FOUND
- Exports required by plan (SWEEP_SCHEMA_VERSION, SweepIdentityLine, SweepPidLine, parseSweepJsonl, isSweepLineOfCurrentSchema, SWEEP_FIELD_PARITY) — all present
- 25 tests green, 0 regressions
- Only 2 files touched (matches `files_modified` allow-list)
