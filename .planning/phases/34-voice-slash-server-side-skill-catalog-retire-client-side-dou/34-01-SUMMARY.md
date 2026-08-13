---
phase: 34-voice-slash-server-side-skill-catalog-retire-client-side-dou
plan: 01
subsystem: backend/voice
tags: [backend, voice, stt, pure-kernel, matcher, tdd-truth-table]
requires: []
provides:
  - "src/backend/voice/slashCommandTransform.ts — pure server-side slash-command matcher (WAKE_WORD_REGEX + applyServerSlashTransform + MAX_SKILL_WORDS + SlashTransformResult)"
affects:
  - "future Plan 34-03: STT-route wiring will import applyServerSlashTransform + WAKE_WORD_REGEX"
  - "future Plan 34-02: skill-catalog SSH fetcher will produce the Set<string> that Plan 34-03 injects into applyServerSlashTransform"
tech_stack_added: []
patterns:
  - "Pure-kernel design: no runtime imports, no I/O, no async, no side effects — exhaustively truth-table testable in isolation without SSH mocking or Express harness"
  - "Sticky-flag anchored regex cursor walk for verbatim-tail extraction (avoids substring allocation while preserving original capitalization / punctuation of the tail past the matched prefix)"
  - "Greedy longest-prefix match by descending K loop (first hit wins by construction, no post-hoc length comparison)"
key_files:
  created:
    - "src/backend/voice/slashCommandTransform.ts (276 lines — 4 public exports)"
    - "src/backend/voice/slashCommandTransform.test.ts (236 lines — 21 vitest cases)"
  modified: []
decisions:
  - "Fail-open on catalog miss: wake-word HIT followed by no catalog prefix match returns byte-identical passthrough with matched:false — same posture as the retired client-side registry gate, so Ashley's transcript still lands even when the matcher can't rewrite it"
  - "Verbatim-tail extraction walks the ORIGINAL post-slash string (not the lowercased tokens) via a sticky-flag anchored regex cursor — preserves capitalization, mid-content punctuation, and multi-line content past the matched prefix exactly as spoken"
  - "MAX_SKILL_WORDS = 5 (defensive cap): real on-disk skill names are almost always ≤3 kebab-tokens; cap prevents pathological 'slash a b c d e f g h i j …' inputs from doing O(N) catalog lookups per STT call"
  - "Zero runtime imports enforced (grep-verified in acceptance criteria): kernel is pure enough that Plan 34-02's SSH fetcher and Plan 34-03's route wiring can layer on top without any dependency-injection ceremony"
metrics:
  duration: "~25 min (start 2026-08-13 01:56 UTC → commit 2026-08-13 02:16 UTC)"
  completed: "2026-08-13"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  tests_added: 21
  commits: 1
---

# Phase 34 Plan 01: voice-slash server-side matcher kernel — Summary

**One-liner:** Ships the pure, side-effect-free `applyServerSlashTransform` kernel (WAKE_WORD_REGEX + greedy longest-prefix matcher + verbatim-tail preservation) that Plan 34-03 will wire into the STT route.

## What Was Built

A single-file pure kernel at `src/backend/voice/slashCommandTransform.ts` implementing the server-side voice-first "slash `<skill-name>` `<args>`" transform contract from CONTEXT.md § Decisions + § Specific Ideas. Public surface:

| Export | Kind | Purpose |
|---|---|---|
| `WAKE_WORD_REGEX` | `RegExp` | Front-anchored (`^\s*`), punctuation-tolerant (`[\s.,;:!?\-]+`), case-insensitive (`i` flag), multi-line (`s` flag), requires-content (`\S.*`) wake-word gate. Literal source verbatim from CONTEXT.md § Specific Ideas. |
| `MAX_SKILL_WORDS` | `number = 5` | Defensive cap on the prefix-join length. |
| `SlashTransformResult` | `interface` | `{ transformed, matched, command }` — mirrors retired client-side `IntentTransformResult` for symmetry. |
| `applyServerSlashTransform(transcript, catalog): SlashTransformResult` | `function` | Pure 7-step matcher: wake-word gate → post-slash capture → tokenize + lowercase + drop-empties → greedy K-from-max-down-to-1 prefix lookup in injected catalog Set → verbatim-tail cursor walk on original string → assembled `/{cmd} {tail}` (or `/{cmd}` if tail is empty/whitespace-only). |

The truth-table test suite at `src/backend/voice/slashCommandTransform.test.ts` covers every row of CONTEXT.md § Specific Ideas as a dedicated `it()` block (for grep-ability and failure-message clarity — the plan explicitly forbade parameterizing them into a single test), plus 8 passthrough cases (empty, mid-message wake-word, bare wake-word with/without trailing whitespace, catalog miss, case-insensitivity of the gate, defensive-degenerate) and MAX_SKILL_WORDS + empty-catalog edge cases.

## Design Invariants Preserved (mirror composeIntentTransform.ts contract)

The new module preserves the same design invariants the retired client-side `composeIntentTransform.ts` documented in its module JSDoc, adapted from doubled-word→wake-word semantics:

- **Front-only anchoring** (`^\s*`) — mid-message "not slash gsd status" passes through unchanged.
- **Requires-content clause** (`\S.*`) — bare "slash" / "slash   " passes through unchanged.
- **Punctuation tolerance** (`[\s.,;:!?\-]+`) — used identically in the wake-word regex AND in the tokenizer split, so Whisper-inserted commas/periods around "slash" and between post-slash words don't break the match.
- **Case-insensitive gate** (`i` flag) with lowercased tokens for catalog lookup — "SLASH GSD status" resolves to `/gsd status` because catalog keys are on-disk kebab-lowercase.
- **Multi-line rest** (`s` flag) — the `.` in `(\S.*)` crosses newlines; verified by the `"slash bounty add a thing\nand more"` test case.
- **ReDoS safety** — single unbounded `.*` inside a capture group, no nested quantifiers, no backreferences, bounded punctuation class only. Threat surface equivalent to retired composeIntentTransform.ts (STRIDE T-54e-03 lineage).

## Verification

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `npm run build:backend` | exit 0 (clean) |
| Isolated test run | `npx vitest run src/backend/voice/slashCommandTransform.test.ts` | 21 passed / 21 total |
| Full-suite regression check | `npx vitest run` | 155 files, 2011 passed, 6 skipped, 1 todo, **0 failed** |
| Zero runtime imports (pure module) | `grep -cE "^import " src/backend/voice/slashCommandTransform.ts` | 0 |
| WAKE_WORD_REGEX literal verbatim from CONTEXT.md | `grep -cF 'slash[\s.,;:!?\-]+(\S.*)' …` | 1 |
| it() block count (need ≥ 20) | `grep -c "^  it(" …test.ts` | 21 |

## Truth-Table Row Coverage (CONTEXT.md § Specific Ideas)

Every row from the CONTEXT.md truth table has a dedicated test:

| Input | Expected | Test present |
|---|---|---|
| `"slash gsd quick fix the login bug"` | `/gsd-quick fix the login bug` (longest-prefix wins over `/gsd`) | Yes |
| `"slash gsd status"` | `/gsd status` (1-token fallback — `gsd-status` not in catalog) | Yes |
| `"slash explain the NDA thing."` | `/explain the NDA thing.` (trailing period preserved) | Yes |
| `"slash bounty, add a banana button"` | `/bounty add a banana button` (leading comma+space eaten) | Yes |
| `"slash queue"` | `/queue` (empty tail → no trailing space) | Yes |
| `"slash queue   "` | `/queue` (whitespace-only tail → no trailing space) | Yes |
| `"slash gsd quick.  Fix the login bug"` | `/gsd-quick Fix the login bug` (period+spaces eaten, uppercase F preserved) | Yes |
| `"slash. gsd status"` (Whisper period after wake-word) | `/gsd status` | Yes |
| `"slash, bounty add a thing"` (Whisper comma after wake-word) | `/bounty add a thing` | Yes |
| `"  slash bounty add a thing"` (leading whitespace) | `/bounty add a thing` | Yes |
| `"slash bounty add a thing\nand more"` (multi-line via `s` flag) | `/bounty add a thing\nand more` | Yes |
| MAX_SKILL_WORDS cap (7 tokens exceeds cap) | passthrough | Yes |
| empty catalog | passthrough, no crash | Yes |

Passthrough coverage (guarding false-positive rate):

| Input | Reason for passthrough | Test present |
|---|---|---|
| `""` | empty | Yes |
| `"hello world"` | no wake-word | Yes |
| `"not slash gsd status"` | front-anchor rejects mid-message | Yes |
| `"slash"` | `\S.*` clause rejects (no content) | Yes |
| `"slash   "` | `\S.*` clause rejects (whitespace-only content) | Yes |
| `"slash nonesuch do a thing"` | wake-word HIT, no catalog match | Yes |
| `"SLASH GSD status"` | (actually a MATCH — proves case-insensitive gate + lowercased catalog lookup work together) | Yes |
| defensive degenerate | wake-word HIT, single-token miss | Yes |

## Deviations from Plan

**None.** Plan 34-01 executed exactly as written. Two files created, two tasks completed in order, all acceptance criteria met.

## Commits

| Hash | Message |
|---|---|
| `756c6e3` | `feat(34-01): pure server-side slash-command matcher kernel` |

Single atomic commit per plan constraint (planning docs — SUMMARY.md, STATE.md, ROADMAP.md — will be committed by the orchestrator in the final step, not by this executor).

## What's Next (out of scope for this plan)

- **Plan 34-02:** SSH-based skill-catalog fetcher `fetchSkillCatalog(hostId, timeoutMs = 10000): Promise<Set<string>>` — produces the `Set<string>` that this kernel consumes. Fail-open on SSH timeout/error.
- **Plan 34-03:** STT-route integration — wake-word regex gate on the transcript, `fetchSkillCatalog` on hit, `applyServerSlashTransform` on the fetched catalog, return transformed transcript in the response envelope. Deletes `composeIntentTransform.ts` + `INTENT_REGISTRY` + doubled-word regex + the two call sites in `useVoiceRecording.ts` in the same plan (per CONTEXT.md § Client responsibilities).

The kernel shipped here is standalone: it has zero runtime imports and is exhaustively truth-table tested, so Plans 34-02 and 34-03 can layer on it in parallel without any risk of drift on the matcher contract.

## Self-Check: PASSED

Verified files exist at the expected paths and the commit exists in the branch history:

- `src/backend/voice/slashCommandTransform.ts` — FOUND (276 lines, 4 public exports, 0 runtime imports)
- `src/backend/voice/slashCommandTransform.test.ts` — FOUND (236 lines, 21 vitest cases)
- Commit `756c6e3` — FOUND on branch `feat/tab-title-from-tmux`
- All plan verification gates green: full vitest suite 2011 passed / 0 failed, `npm run build:backend` exit 0.
