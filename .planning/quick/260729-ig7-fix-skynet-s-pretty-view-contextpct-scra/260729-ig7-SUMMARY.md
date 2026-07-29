---
phase: 260729-ig7
plan: 01
subsystem: claude-session/context-pct-scraper
tags: [bug-fix, tdd, backend, ws, pretty-view]
requires:
  - src/backend/claude-session/claude-session-server.ts (existing)
  - src/backend/ssh/tmux-helper.ts (execCommand — existing)
provides:
  - "parseContextPct(paneText: string): number | null — pure bar-anchored context% scraper (patch #187)"
affects:
  - PrettyView / ComposeBox context% indicator (wire shape unchanged: `{type:"context_pct", pct}`)
tech-stack:
  added: []
  patterns:
    - "Extract-to-pure-helper for testability (mirrors session-file-parser.ts pattern in the same directory)"
    - "TDD RED → GREEN with bug-repro as the first failing test"
key-files:
  created:
    - src/backend/claude-session/context-pct-parser.ts
    - src/backend/claude-session/context-pct-parser.test.ts
  modified:
    - src/backend/claude-session/claude-session-server.ts
decisions:
  - "Bar-anchored regex uses `[█▉▊▋▌▍▎▏░]\\s*(\\d{1,3})%` — live Claude Code only renders `█` and `░`, but the wider partial-fill glyph set matches nelly's regex and is defensive against future variants"
  - "Fallback loop's `if (!/[░█]/.test(line)) continue;` line filter dropped — it becomes redundant once the regex itself requires a bar glyph adjacent to `%`"
  - "Range guard folded into the helper (returns null for <0 / >100 / non-finite), so the caller reduces from 4-condition chain to a single `if (pct === null) return;`"
  - "Preserved rightmost-per-line + last-matching-line semantics (patch #59) so the GSD milestone-bar + real context meter same-line collision still resolves correctly"
metrics:
  duration: "~5min"
  completed_date: "2026-07-29"
  tasks: 2
  files: 3
  lines: "+172 / -20"
---

# Phase 260729-ig7 Plan 01: Fix skynet's pretty-view context% scraper (weekly-limit false-positive) Summary

Bar-anchored the context% scraper regex so a weekly-limit warning appended to the Claude Code status line ("... 29% ┃ youve used 95% of your weekly limit") no longer causes rightmost-wins to return the warning % (95) instead of the real meter % (29). Factored the scan into `context-pct-parser.ts` as a pure `parseContextPct(paneText): number | null` helper with vitest coverage on all bug-repro + nelly-parity cases; wired the setInterval callback in `claude-session-server.ts` to delegate to it. Mirrors nelly's vms-apps `context-watch.py` pre-fix bug (f88c928) with the same bar-anchoring hardening.

## What Changed

### New: `src/backend/claude-session/context-pct-parser.ts` (64 lines)

- Pure function `parseContextPct(paneText: string): number | null`.
- Bar-anchored regex: `/[█▉▊▋▌▍▎▏░]\s*(\d{1,3})%/g` — `%` must be immediately preceded (with optional whitespace) by a Claude Code meter glyph.
- Semantics preserved from the inline scan:
  - 8-line tail slice (patch #56)
  - Primary pass: rightmost bar-anchored NN% on `context)`-labeled lines; last matching line across the 8-line window wins (patch #59)
  - Fallback pass: bar-glyph anchor, same rightmost-per-line rule
  - Range guard: null for out-of-range or non-finite parses
- Dropped the fallback's `if (!/[░█]/.test(line)) continue;` line filter — the bar-anchored regex makes it redundant.

### New: `src/backend/claude-session/context-pct-parser.test.ts` (89 lines, 10 tests)

Vitest suite following the co-located sibling convention (`session-file-parser.test.ts` style):

1. Primary path, single line, bar-anchored → returns meter %
2. **Bug repro** — same line with weekly-limit warning appended → returns 29 (not 95)
3. Patch #59 milestone-bar + real meter collision on one line → rightmost bar-anchored wins
4. `context)`-labeled but no bar-adjacent % → null (weekly-warning-only text does not fabricate a reading)
5. No `context)`, no bar glyph, unrelated % → null
6. Upper edge (100%) → 100
7. Primary/fallback split (line has bar-anchored NN% but no `context)` label) → falls through primary, matched by fallback
8. 8-line tail: 10-line pane, line 1 has a distractor bar-anchored NN%, line 10 has the real reading → returns line 10's value
9. Last-matching-line wins (multi-line last-wins semantic)
10. Range guard: `███░ 250%` → null

### Modified: `src/backend/claude-session/claude-session-server.ts` (+3 imports, -20/+16 in the setInterval callback)

1. Added `import { parseContextPct } from "./context-pct-parser.js";` alongside sibling imports.
2. Replaced the inline `output.split("\n").slice(-8)` scan (former L2669-L2688) with:
   ```ts
   const pct = parseContextPct(output);
   if (pct === null) return;
   ```
3. Updated the block-comment header at L2644-L2666 to add a `BAR-ANCHORED regex (patch #187 / quick 260729-ig7)` bullet explaining the false-positive fix, and to note that scan logic now lives in `context-pct-parser.ts` for testability. Kept the patch #59 milestone-bar reference — that discrimination is preserved because both meters are now bar-anchored and rightmost still wins.

**Everything else in the setInterval callback is unchanged:** `CONTEXT_PCT_INTERVAL_MS = 3000`, `stopped` / `ws.readyState !== WebSocket.OPEN` early-returns, `sshConn` null-guard, `contextPctInFlight` in-flight guard, `connSnapshot` capture, `execCommand(connSnapshot, captureCmd).then(...)` shape, `ws.send(JSON.stringify({ type: "context_pct", pct }))` emit, silent `.catch()`, `.finally(() => { contextPctInFlight = false; })`. Miss-holds-last-value is preserved because null returns early without emitting.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Task 1 targeted vitest (RED) | `npx vitest run src/backend/claude-session/context-pct-parser.test.ts` | 0 tests (module missing) — expected RED |
| Task 1 targeted vitest (GREEN) | `npx vitest run src/backend/claude-session/context-pct-parser.test.ts` | 10/10 passed |
| Task 2 backend build | `npm run build:backend` | Clean (exit 0) |
| Task 2 frontend build | `npm run build` | Clean (exit 0) |
| Task 2 sibling vitest | `npx vitest run src/backend/claude-session/` | 11 files / 110 tests passed |
| Scope check | `git diff --name-only HEAD~3 HEAD` | Only the 3 declared files — no frontend, no identity paths |

## Commits

| # | Type | Hash | Message |
|---|------|------|---------|
| 1 | test (RED) | `a76c0c8` | test(260729-ig7-01): add failing tests for parseContextPct helper |
| 2 | feat (GREEN) | `4a4f5ad` | feat(260729-ig7-01): implement bar-anchored parseContextPct helper |
| 3 | refactor | `c8a52ed` | refactor(260729-ig7-02): delegate context% scan to parseContextPct helper |

## Success Criteria — All Met

- [x] parseContextPct returns 29 (not 95) for the weekly-warning-appended case — bug closed (test 2)
- [x] Rightmost-wins preserved for GSD milestone-bar + context meter same-line collision (test 3 — patch #59 semantic intact)
- [x] No behavior change beyond the false-positive fix: interval (3s), in-flight guard, ws readyState guard, miss-holds-last-value, 0-100 range clamp — all identical to pre-fix
- [x] Backend build green, frontend build green, targeted vitest 10/10 green, sibling vitest 110/110 green
- [x] No wire-shape change to `{type:"context_pct", pct}` message — PrettyView + ComposeBox untouched
- [x] Stopped after commits — no push, no docker, no deploy

## Deviations from Plan

None — plan executed exactly as written. TDD sequence proceeded cleanly: 10 tests written first, all failed (module missing), implementation ported the inline scan with the two prescribed changes (bar-anchored regex, dropped redundant line filter) plus the range-guard fold-in, all 10 tests green on first implementation attempt. No refactor commit needed — the ported code was already minimal and clean.

## Known Stubs

None. `parseContextPct` is a real pure function with production coverage; no placeholder values, no TODO/FIXME markers, no hardcoded mock data.

## TDD Gate Compliance

Sequence verified in git log:
1. RED gate: `a76c0c8` — `test(...)` commit (failing test) ✓
2. GREEN gate: `4a4f5ad` — `feat(...)` commit (implementation) ✓
3. REFACTOR gate: not required — GREEN implementation was already minimal

Task 2 (`c8a52ed`) is a `refactor` commit that delegates the caller to the helper; the helper itself needed no post-GREEN cleanup.

## Self-Check: PASSED

Verified via file existence + git log:

- FOUND: `src/backend/claude-session/context-pct-parser.ts`
- FOUND: `src/backend/claude-session/context-pct-parser.test.ts`
- MODIFIED: `src/backend/claude-session/claude-session-server.ts` (import added, inline scan replaced by delegating call)
- FOUND: commit `a76c0c8` (RED)
- FOUND: commit `4a4f5ad` (GREEN)
- FOUND: commit `c8a52ed` (Task 2 wire-in)
