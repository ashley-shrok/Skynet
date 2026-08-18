---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 01
subsystem: backend/claude-session
tags:
  - backend
  - session-file-tail
  - tdd
  - backcompat
  - wave-1
dependency_graph:
  requires: []
  provides:
    - "tailSessionFile with optional bounded-initial-lines parameter"
  affects:
    - src/backend/claude-session/claude-session-server.ts
tech_stack:
  added: []
  patterns:
    - "validated-int helper (typeof + Number.isFinite + range clamp) before shell string interpolation"
key_files:
  created:
    - src/backend/claude-session/session-file-tail.test.ts
  modified:
    - src/backend/claude-session/session-file-tail.ts
decisions:
  - "Optional 5th positional parameter (not options object) — smallest diff for the two existing 4-arg call sites; keeps `tailSessionFile(conn, path, onLine, onError)` source-compatible byte-for-byte"
  - "Validation window is [1, 1_000_000] positive finite integer; anything outside falls back to the legacy `-n +1` default rather than passing a nonsense shell arg"
  - "`Math.floor` normalizes fractional inputs before they hit the shell — defense-in-depth against a bad `historyWindow` handshake value in Wave 2"
metrics:
  duration_sec: 225
  duration_display: "~4m"
  completed_date: "2026-08-18"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  commits: 2
---

# Phase 43 Plan 01: Parameterize `tailSessionFile` initial-lines slice — Summary

One-liner: Added an optional bounded-initial-lines parameter to `tailSessionFile` so Wave 2 can thread the `historyWindow` WS handshake through to `tail -F -n N` while every existing 4-arg call site keeps its current unbounded `-n +1` behavior byte-for-byte.

## What Was Built

`tailSessionFile` in `src/backend/claude-session/session-file-tail.ts` grew a fifth optional parameter `initialLines?: number`. Inside the function a small validated-int helper (`boundedN`) clamps the value to the finite-positive-int ≤ 1_000_000 window; the shell command branches on the result:

- `boundedN === null` (unset / invalid) → `tail -F -n +1 '<escaped-path>'` — legacy backcompat, byte-for-byte identical to the pre-Phase-43 command.
- `boundedN` positive int → `tail -F -n <boundedN> '<escaped-path>'` — starts at the last N lines from EOF, then follows.

A new dedicated test file `src/backend/claude-session/session-file-tail.test.ts` locks both branches, the invalid-override coercion, and path escaping across both branches. The tests were landed as a RED commit first (2 of 4 failing against the current source) and turn GREEN via the source change in Task 2.

The two existing 4-arg call sites in `claude-session-server.ts` (`:2826` and `:5210`) were NOT modified — Wave 2 (43-04) will thread the handshake value through them. This plan is strictly the atomic helper-API change.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | RED — write session-file-tail unit test that pins backcompat + parameterized command shapes | `39e427e0` | `src/backend/claude-session/session-file-tail.test.ts` (new) |
| 2 | GREEN — extend tailSessionFile signature + command branch, keep every non-opt-in caller unchanged | `b267bb59` | `src/backend/claude-session/session-file-tail.ts` |

## Verification Results

- `npx vitest run src/backend/claude-session/session-file-tail.test.ts` → **4 passed / 0 failed**.
- `npm run build:backend` → exit 0 (TypeScript strict compile against `tsconfig.node.json`).
- `git grep -n "tailSessionFile(" src/backend/` → both production call sites (`claude-session-server.ts:2826`, `claude-session-server.ts:5210`) still use the 4-arg positional shape; adding an optional 5th param is source-compatible so no caller-side edit was needed.
- `grep -c "tail -F -n +1" src/backend/claude-session/session-file-tail.ts` → 1 (backcompat literal preserved verbatim in the fallback branch; header comment's stray `-n +1` reference does not match this pattern).
- `grep -c "tail -F -n " src/backend/claude-session/session-file-tail.ts` → 2 (both branches present).
- `grep -c "initialLines" src/backend/claude-session/session-file-tail.ts` → 7 (signature, header block, validator, header cross-refs).
- Adjacent test that mocks `tailSessionFile` still passes: `npx vitest run src/backend/claude-session/claude-session-server.dormant-tail.test.ts` → 7/7 passed. Backcompat empirically confirmed against a real consumer's expectations.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes required, no architectural questions surfaced, no auth gates hit.

Notes on RED-gate honesty (Task 1): the plan action text says "each `it` block FAILS" but the test spec explicitly writes tests 1 and 3 as backcompat/invalid-fallback pins that would pass against the current unparameterized source (which always emits `-n +1`). The plan's `<verify>` block uses `grep -E "failed|FAIL" ; test $? -eq 0` which only requires ≥1 failure. The actual RED signal was tests 2 and 4 (the two `-n 50` override assertions) failing against the current source — sufficient to satisfy the verify and honestly pin the parameterization behavior. Tests 1 and 3 legitimately pass on both source states; that's the correct behavior for a backcompat lock.

## Key Decisions Made

1. **Positional 5th parameter over options-object.** The two existing 4-arg call sites in `claude-session-server.ts` and the current test-mock-consumer in `claude-session-server.dormant-tail.test.ts` all rely on the 4-arg positional shape. An optional 5th parameter is 100% source-compatible; an options-object refactor would require touching every caller. Wave 2 threads a single scalar value through, so an options object would be over-engineering.

2. **Validation window `[1, 1_000_000]`.** Positive-finite-int lower bound is obvious (0 and negative are nonsense for `tail -n`); the 1_000_000 upper bound is a defensive cap so a runaway `historyWindow` handshake value can't hand `tail` an absurd arg. Ashley's fleet has JSONL files typically <10 MB (<~50k lines), so 1M is far above any realistic setting while still being small enough to reject obvious garbage. `Math.floor` normalizes fractional inputs before they touch the shell.

3. **Header comment kept intact.** The existing header comment at lines 3-23 already anticipates the `-n +1` design choice ("`-n +1` starts the read at line 1 so we deliver the current conversation from the top before switching to live-follow"). Phase 43 documents the override as an inline block on the new parameter rather than rewriting the header — keeps the diff small and grep-obvious for reviewers, and the header still accurately describes the DEFAULT behavior.

## Files Created

- `src/backend/claude-session/session-file-tail.test.ts` (177 lines) — vitest coverage for command-string shape: backcompat literal, override happy path (`-n 50`), invalid-override coercion (0, negative, NaN, 1e12), path escaping preserved across both branches. Mocks a minimal ssh2 `Client` with an `exec` spy — never drives stdout, only asserts on the command string handed to `exec`.

## Files Modified

- `src/backend/claude-session/session-file-tail.ts` — added optional `initialLines?: number` parameter (with inline doc block referencing Phase 43 backcompat rule) and a validated-int helper (`boundedN`) that gates the command-shape branch. Header comment and error handling (STDERR_ACCUMULATION_LIMIT_BYTES gate, stderr-vs-stdout truth signal, stop() helper) untouched.

## Wave-Handoff

Wave 2 (plan 43-04) will:
1. Read `historyWindow` off the WS handshake `req.url` search params (mirror JWT-token URL-param fallback pattern documented in 43-PATTERNS.md § 2 at `claude-session-server.ts:1618-1622`).
2. Validate with the same defensive int-parsing shape as this plan's `boundedN` helper.
3. Thread the value into `tailSessionFile(sshConn, sessionFile, onLine, onError, historyWindow)` at both call sites (`:2826` and `:5210`).

No frontend, no observation-channel changes, no wire-frame changes touched by 43-01 — Wave 2 owns the emission-channel wiring end.

## Threat Flags

None. This plan modifies a purely internal helper's signature; no new network endpoints, no auth surface, no schema, no new file access patterns. The one shell-string construction site (`tail -F -n <boundedN> <escapedPath>`) uses the same local `shellEscape` helper the pre-Phase-43 default branch has always used, and `boundedN` is a validated integer (not a string) before it is concatenated into the command — no injection surface introduced.

## Self-Check: PASSED

Verified files exist:
- FOUND: `/home/ubuntu/skynet/src/backend/claude-session/session-file-tail.test.ts`
- FOUND: `/home/ubuntu/skynet/src/backend/claude-session/session-file-tail.ts` (modified)

Verified commits exist:
- FOUND: `39e427e0` — `test(43-01): add failing session-file-tail unit tests for initialLines parameterization`
- FOUND: `b267bb59` — `feat(43-01): parameterize tailSessionFile initial-lines slice`
