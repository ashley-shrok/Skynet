---
phase: quick-260823-hd6
plan: 01
subsystem: claude-session/session-file-parser
tags: [relay-outbound, pretty-view, corpus-driven, extractor-v3]
requires:
  - session-file-parser.ts (existing extractOutboundBody + substituteShellVars + sanitizeBashSqEscapeIdioms)
  - quick-260822-9qf shell-var resolver (extended, not replaced)
provides:
  - substituteShellVars now handles 6 assignment shapes (was 2)
  - Strategy 11 json-envelope-any final catch-all
  - Strategy 12 jq-arg-passthrough-known-var pre-substitution preflight
  - _buildAssignments extracted as shared helper
  - _extractJqBody + _decodeAnsiC support helpers
affects:
  - pretty-view relay bubbles now render actual body text for ~19 pp more
    of real fleet corpus (v0 → v3 coverage gain, per bounty measurement)
  - 2 latent wrong-body bugs (secondary --arg captured before primary heredoc,
    embedded-double-quote regex fragility) now correctly return primary body
tech-stack:
  added: []
  patterns:
    - "assignment-map-then-preflight-then-substitute-then-strategies"
    - "char-by-char ANSI-C decoder (not regex substitution)"
    - "backreference in Strategy 12 regex (\\1 pins arg name)"
key-files:
  created: []
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/session-file-parser.outbound-body.test.ts
decisions:
  - "Verbatim port from Python source-of-truth: no re-derivation, no optimization,
     no shape omission. Every regex + every fallthrough order + first-assignment-wins
     rule mirrors extractor_v3.py exactly. This is a mechanical translation."
  - "One 'known limitations' test (SELF-REFERENTIAL) flipped from
     documentation-of-bug to regression-guard: v3's Strategy 12 preflight
     correctly returns the primary heredoc body instead of the inner
     BODY='relaying Ashley' substring — v3 explicitly fixes this per plan's
     must_haves.truths."
metrics:
  duration_seconds: 240
  tasks_completed: 1
  files_created: 0
  files_modified: 2
  new_tests_added: 11
  total_tests_passing: 34
  completed_date: "2026-08-23"
---

# quick-260823-hd6: Outbound Body Parser v3 Port Summary

One-liner: verbatim TS port of `extractor_v3.py` — extends `substituteShellVars` from 2 to 6 assignment shapes and adds two new strategies (11 = json-envelope-any, 12 = jq-arg-passthrough-known-var) into `extractOutboundBody`, corpus-validated at 96.3% ok on 787 real fleet outbound cmds with 2 latent wrong-body bugs fixed.

## Objective (recap)

Port the finalized `extractor_v3.py` algorithm verbatim into TypeScript. The Python source-of-truth is corpus-validated end-to-end (787 real fleet outbound cmds across t1000 + workstation over 2 weeks): 96.3% ok extraction, 0 regressions vs v0, catches 2 latent wrong-body bugs. Purpose: pretty-view relay bubbles render actual body text instead of `rawCommand` fallback for ~19 percentage points more of real corpus, and eliminate the two known wrong-body render cases.

## Tasks Executed

### Task 1: Port extractor_v3.py verbatim to TS + corpus-derived fixtures (RED → GREEN)

Two commits:
- `61575eb7` **test(quick-260823-hd6): add RED fixtures for v3 port (11 tests)**
  - 11 new fixtures grouped by shape (A/B/C/D + Strategy 12 preflight + LB-1 latent-bug regression + NO-OP invariant guard).
  - 9 fail RED (missing v3 features); Bjq-1 (MSG-sq passthrough) and NO-OP (BODY-sq duplicate) pass under v0 as invariance anchors.
  - Every fixture cites provenance: real corpus fixtures cite `project + ts` from `all.jsonl`; two synthetic fixtures (A3 apostrophe-in-heredoc, Bjq-2 jq -n embedded quotes, LB-1 latent-bug regression) explicitly marked SYNTHETIC.

- `a2e84b36` **feat(quick-260823-hd6): port extractor_v3.py — 6 assignment shapes + Strategies 11/12**
  - `substituteShellVars` extended from 2 shapes to 6 (A→B→C→D→E→F, first-assignment-wins).
  - `_buildAssignments` extracted as shared helper; `substituteShellVars` accepts optional pre-built map.
  - Helpers `_extractJqBody` (Shape B) and `_decodeAnsiC` (Shape C char-by-char state machine, NOT regex substitution) added.
  - Strategy 11 (`json-envelope-any`) inserted as final catch-all before `return null`.
  - Strategy 12 (`jq-arg-passthrough-known-var`) inserted as PRE-substitution preflight with `\1` backreference pinning arg-name to `body:$X` slot.
  - `extractOutboundBody` control flow restructured to mirror extractor_v3.py lines 144-177 exactly: sanitize → build assignments → Strategy 12 preflight → substitute (reusing map) → Strategies 1-10 → Strategy 11 → null.
  - Required verbatim comment block near `substituteShellVars` citing extractor_v3.py + 787-cmd corpus + 96.3% ok + 2 latent bugs.
  - `restoreApostrophes` preserved at every new return site.
  - One `known limitations` test (SELF-REFERENTIAL) flipped from documentation-of-bug to regression-guard: v3 explicitly fixes this per plan's `must_haves.truths` (secondary --arg captured before primary heredoc).

## Verification (scoped — orchestrator handles full ship-gate)

| Check | Result |
| ----- | ------ |
| `npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts src/backend/claude-session/session-file-parser.ts` | **34/34 pass** |
| `npm run build:backend` | exit 0 (backend typecheck green) |
| `npm run build` | exit 0 (frontend typecheck green) |
| `grep -c "quick-260823-hd6: substituteShellVars extended to 6 assignment shapes" src/backend/claude-session/session-file-parser.ts` | 1 (verbatim comment block present) |
| `grep -c "jq-arg-passthrough-known-var\|json-envelope-any" src/backend/claude-session/session-file-parser.ts` | 6 (both new strategies referenced by name multiple times) |
| Two commits landed (RED test + GREEN implementation) | 61575eb7 + a2e84b36 |

## Fixture Provenance

Corpus source: `/home/ubuntu/.claude/roles/box-maintainer/bounties/relay-outbound-cmdsub-heredoc-body/corpus/all.jsonl` (787 records).

| Fixture | Type | Provenance |
| ------- | ---- | ---------- |
| A1 short cat-heredoc | REAL | isabella 2026-08-10T01:07:57.309Z (adapted body) |
| A2 multi-line cat-heredoc | REAL | wendy 2026-08-22T09:03:23.065Z (verbatim) |
| A3 apostrophes inside cat-heredoc | SYNTHETIC | wendy A2 shape + apostrophe body (no corpus record combines both) |
| Bjq-1 MSG=' … ' + BODY=$(jq -nc --arg m …) | REAL | tina 2026-08-20T21:12:15.830Z (verbatim shape) |
| Bjq-2 jq -n {body:"literal"} with embedded \" | SYNTHETIC | Shape B literal decoding validation |
| C1 ANSI-C multi-line \n | REAL | aqua morning digest 2026-08-14T12:35:12.928Z (adapted body) |
| C2 ANSI-C tab + \'apos\' | SYNTHETIC | _decodeAnsiC escape-table coverage |
| D1 read -r -d '' MSG <<'EOF' | REAL | poppy → vicky column-filter 2026-08-12T17:28:50.581Z (adapted body) |
| S12-1 Strategy 12 heredoc+embedded quotes | REAL | isabella 2026-08-10T01:07:57.309Z (verbatim) |
| LB-1 secondary --arg body 'label' regression | SYNTHETIC | composed to guard latent bug (cites nelly fixture at file line 70) |
| NO-OP BODY-sq ack short | DUPLICATE | duplicates existing tanya fixture at file line 51 (byte-identical invariant) |

## Deviations from Plan

**1. [Rule 1 - Bug] Flipped SELF-REFERENTIAL "known limitations" test from documentation-of-bug to regression-guard**
- **Found during:** Task 1 GREEN verification (scoped vitest run after implementation)
- **Issue:** The pre-existing test at file line 394 pinned the OLD wrong behavior: v0's Strategy 1 (BODY-sq) matched the inner `BODY='relaying Ashley'` substring inside a cat-heredoc body and returned it instead of the primary heredoc body. This was documented as a "known limitation, deferred per Phase 49 CONTEXT.md." Under v3 this bug IS fixed by Strategy 12 preflight — one of the plan's `must_haves.truths` explicitly says "Two latent wrong-body bugs (secondary --arg captured before primary heredoc, embedded double quotes) are fixed."
- **Fix:** Flipped the test's expected value from the inner substring `"relaying Ashley"` to the full primary heredoc body. Updated the test name from `"...(documented, not fixed by Phase 49)"` to `"...FIXED by quick-260823-hd6 (v3 port) via Strategy 12 preflight"` and rewrote the comment block explaining the fix path.
- **Files modified:** `src/backend/claude-session/session-file-parser.outbound-body.test.ts` (SELF-REFERENTIAL test)
- **Commit:** `a2e84b36` (GREEN implementation commit — updated test bundled with GREEN)
- **Rationale:** This is exactly what the plan promises. The original test's own comment said "If a future phase addresses this, this test flips from documentation to regression guard." v3 IS that future phase.

## Self-Check: PASSED

**Files:**
- `src/backend/claude-session/session-file-parser.ts` — FOUND (contains "quick-260823-hd6" verbatim comment block; contains "jq-arg-passthrough-known-var" and "json-envelope-any" strategy names)
- `src/backend/claude-session/session-file-parser.outbound-body.test.ts` — FOUND (contains 11 new `it()` blocks across the 6 new shapes + Strategy 12 + LB-1 + NO-OP; contains "quick-260823-hd6" reference)

**Commits:**
- `61575eb7` (test) — FOUND in git log
- `a2e84b36` (feat) — FOUND in git log

**Scoped test suite:**
- `npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts src/backend/claude-session/session-file-parser.ts` → 34/34 pass (0 failures, 0 skipped)

**Typecheck:**
- `npm run build:backend` → exit 0
- `npm run build` → exit 0 (frontend also green)

## Executor Remit Ended

Per plan STOP-LIST — did NOT run:
- Full vitest suite (`npx vitest run` without scoped paths)
- `docker build` / `docker compose`
- `git push`
- Edits to `~/.claude/roles/box-maintainer/skynet-patches.md`
- Agent spawns

Orchestrator handles full-suite green-gate + patch-file entry + ship + deploy after this plan.
