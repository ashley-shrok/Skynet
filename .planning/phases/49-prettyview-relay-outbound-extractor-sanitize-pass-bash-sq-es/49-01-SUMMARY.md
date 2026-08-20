---
phase: 49-prettyview-relay-outbound-extractor-sanitize-pass-bash-sq-es
plan: 01
completed: 2026-08-20
commit: e82e1849
tests: pass_count=2545 fail=0 skipped=9 todo=1
---

# Phase 49-01 SUMMARY — PrettyView relay-outbound extractor sanitize pass

## What shipped

Three helpers ported from the validated Python prototype (`parsers.py`
`extract_sanitized`) into `session-file-parser.ts`: `APOS_MARKER` (U+E000
private-use-area constant), `sanitizeBashSqEscapeIdioms` (replaces both bash
single-quote-escape idioms with the placeholder before any regex runs), and
`restoreApostrophes` (swaps every placeholder back to `'` at the return
boundary). `extractOutboundBody` was refactored to a sanitize-then-extract-
then-restore pipeline: `const s = sanitizeBashSqEscapeIdioms(cmd)` is the
first statement, all 11 strategy `.match()` calls operate on `s` instead of
`cmd`, and every return path is wrapped in `restoreApostrophes(...)`. Four
single-quoted-body strategy regexes were simplified from
`((?:'\\''|[^'])*)` to `([^']*)` (Strategies 1/3/5a/7), and the four
corresponding per-strategy `.replace(/'\''/g, "'")` post-processing calls
were dropped. The test file was extended with the NELLY-SHAPE fixture (proves
the fix end-to-end on the exact `'"'"'` idiom shape Nelly's DM used) and the
SELF-REFERENTIAL KNOWN-LIMITATION test (documents the still-present
heredoc-content-bleed — deferred per CONTEXT.md § Deferred Ideas).

## Files touched

- `src/backend/claude-session/session-file-parser.ts` — +28 lines, -16 lines
  (net +12): added APOS_MARKER constant + sanitizeBashSqEscapeIdioms +
  restoreApostrophes helpers before `extractOutboundBody`; refactored
  extractOutboundBody to sanitize-pass pipeline; 4 regex simplifications; 4
  .replace drops; 11 `cmd.match` → `s.match` substitutions; 11 +1 
  `restoreApostrophes(...)` return-path wraps.

- `src/backend/claude-session/session-file-parser.outbound-body.test.ts` —
  +30 lines (412 lines total, was 382): added NELLY-SHAPE fixture (third
  BODY-sq entry in FIXTURES array) + SELF-REFERENTIAL KNOWN-LIMITATION
  describe block appended at file end.

## Verification

- `npx tsc --noEmit` — exit 0, zero output (no type errors)
- Isolated outbound-body suite: `npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts` — exit 0, **17 passed** (12 pre-existing FIXTURES + NELLY-SHAPE + UNEXTRACTABLE-python + PRIORITY-REGRESSION + SELF-REFERENTIAL)
- NELLY-SHAPE test: `npx vitest run ... -t NELLY-SHAPE` — exit 0, 1 passed (proves Phase 49 fix works end-to-end on the exact Nelly DM shape)
- PRIORITY-REGRESSION test: passes unchanged — BODY-sq still beats heredoc-to-file; strategy priority ordering unchanged by the sanitize pass
- Full suite (Task 1 baseline): `npx vitest run` — exit 0, **198 test files, 2543 passed, 9 skipped, 1 todo** (Task 2 adds 2 more: 2545 total)
- Full suite (final, post-Task-2): exit 0, **2545 passed, 9 skipped, 1 todo**

## Fidelity

Cross-validated against the 182-send local corpus (5 box-maintainer identities:
tiffany 97, tanya 81, tina 3, tabitha 1): 92.9% identical output (169/182),
6.6% rescues (12/182, up to 3.4× more body preserved on the worst case —
tanya's 840 → 2863 char supervisor-bug report), 0.0% regressions (0 cases
where new returns fewer chars), 0.0% fidelity loss (all apostrophes restored
by `restoreApostrophes` wrapper). Source: REPORT.md in
`~/.claude/roles/box-maintainer/bounties/extractor-sanitize-pass/`.

## Deferred (out of this plan's scope)

- **Self-referential heredoc-content-bleed**: a `BODY=$(cat <<'EOF' … EOF)` whose heredoc CONTENT contains a substring `BODY='...'` — Strategy 1 (BODY-sq) matches the inner substring before Strategy 9 (heredoc-inline) fires. Documented by SELF-REFERENTIAL test, not fixed by this phase. Fixing requires heredoc-first reorder (breaks PRIORITY-REGRESSION), a heredoc-content pre-mask, or a shell-aware parser (major rewrite). Deferred per CONTEXT.md § Deferred Ideas and Ashley's 2026-08-20 greenlight.

- **Unextractable-by-design 3.6% tail**: tiffany's `jq -Rs … body: file > req.json; curl … --data-binary @req.json` shape — body is on disk, not in the command. Falls through to rawCommand mono-block render. Not addressed by this phase.

- **Deploy motion (orchestrator-only)**: this plan STOPS at code + tests green. The container rebuild + deploy is orchestrator scope per box-maintainer role file directive "executors don't do deploys — the orchestrator does."

## Ship handoff to orchestrator

The following deploy motion is INFORMATIONAL for the orchestrator — this plan does NOT run any of these steps:

1. Post coord-BEFORE to box-maintainer coord room: "deploying Phase 49 sanitize pass — hold container mutations"
2. `cd /home/ubuntu/skynet-tabitha && npm run build:backend` (TypeScript compilation)
3. `docker build -t skynet:latest .` (full container rebuild — backend TS change requires node process reload; fast-path `docker cp` covers only frontend `/app/html/`)
4. `docker compose up -d --force-recreate skynet`
5. HTTPS 200 verify: `curl -sk https://thenasty.taild9b663.ts.net/api/health | jq .`
6. Byte-verify sanitize function present in built bundle: `grep -c APOS_MARKER dist-backend/backend/claude-session/session-file-parser.js` — must be >= 1
7. Post coord-AFTER to box-maintainer coord room: "Phase 49 sanitize pass deployed — extractOutboundBody now handles '" '"' "' apostrophe idiom"
8. `git push` (push `feat/tab-title-from-tmux` branch)
9. Append patch entry to `~/.claude/roles/box-maintainer/skynet-patches.md`
