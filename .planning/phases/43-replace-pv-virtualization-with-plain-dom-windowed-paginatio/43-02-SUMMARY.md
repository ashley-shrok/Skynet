---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 02
subsystem: backend/claude-session
tags:
  - backend
  - session-file-range
  - tdd
  - wave-1
  - fetch-older
dependency_graph:
  requires: []
  provides:
    - "readSessionFileRange(conn, sessionFile, startLine, endLine): Promise<ParsedLine[] | null> — one-shot `sed -n 'M,Np'` range read + parseSessionLine per line + skip filter"
    - "resolveEventIdToLine(conn, sessionFile, eventId): Promise<number | null> — one-shot `grep -n '\"uuid\":\"<id>\"' … | head -1 | cut -d: -f1` lookup"
  affects:
    - src/backend/claude-session/claude-session-server.ts (Wave 2 43-04 wires both helpers into handleFetchOlder)
tech_stack:
  added: []
  patterns:
    - "one-shot execCommand + Promise.race timeout + catch-and-return-null (mirrors context-pct-from-jsonl.ts § 3 exactly)"
    - "single-quote path wrap without embedded-quote sanitization — upstream discoverClaudeSession validation, same convention as context-pct-from-jsonl.ts L82"
    - "eventId shell-injection defense via reject-on-embedded-single-quote (no exec) rather than escape-and-substitute — treat unsafe ids as unresolvable"
key_files:
  created:
    - src/backend/claude-session/session-file-range.ts
    - src/backend/claude-session/session-file-range.test.ts
  modified: []
decisions:
  - "One file, two exports — both helpers live in `session-file-range.ts` because the Wave 2 caller invokes them in a bound sequence (eventId→line, then read that slice); keeps the pair discoverable and avoids cross-file coupling for a two-function subsystem."
  - "Duplicated `EXEC_TIMEOUT_MS = 3000` constant (rather than importing from context-pct-from-jsonl.ts) — file stays self-sufficient with no cross-dependencies between two independently-scoped SSH tasks."
  - "MAX_RANGE_SPAN = 10000 — far above any realistic fetch_older batch size (typical is ~50, upper bound on scroll-back-past-cap is a few hundred) while still small enough to reject garbage before it hits `sed`."
  - "EventId with embedded single quote → return null (do NOT sanitize/escape). Treats unsafe ids as unresolvable rather than either throwing or attempting a shell-escape substitution — same posture as the path escape rule, one layer down."
  - "Returning `[]` (empty array, non-null) is semantically distinct from returning null: the former means 'exec succeeded but every line was empty/skip'; the latter means 'the read failed and caller should surface an error'. Caller (Wave 2 handleFetchOlder) can key its `reachedBeginning` vs `error` response frames off this distinction."
metrics:
  duration_sec: 240
  duration_display: "~4m"
  completed_date: "2026-08-18"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  commits: 2
---

# Phase 43 Plan 02: `readSessionFileRange` + `resolveEventIdToLine` helpers — Summary

One-liner: Landed the two atomic backend primitives Wave 2's `handleFetchOlder` will call in sequence — a `sed -n 'M,Np'` range reader that parses each JSONL line via `parseSessionLine` and drops skips, plus a `grep -n '"uuid":"<id>"' … | head -1 | cut -d: -f1` eventId→line lookup — both mirroring `context-pct-from-jsonl.ts`'s discipline (one-shot exec, 3s Promise.race timeout, catch-and-return-null, single-quote path wrap).

## What Was Built

Two exports in a single new file `src/backend/claude-session/session-file-range.ts`:

1. **`readSessionFileRange(conn, sessionFile, startLine, endLine): Promise<ParsedLine[] | null>`**
   - Range validation FIRST (before any exec): rejects `startLine <= 0`, `endLine < startLine`, `(endLine - startLine) >= MAX_RANGE_SPAN`, and non-finite inputs → returns null with zero exec calls.
   - Shell command: `` `sed -n '${startLine},${endLine}p' '${sessionFile}'` `` — single-quote wrap on the path, no embedded-quote sanitization.
   - `Promise.race` at `EXEC_TIMEOUT_MS = 3000` around `execCommand` from `../ssh/tmux-helper.js`.
   - Splits stdout on `\n`, parses each non-empty line via `parseSessionLine` from `./session-file-parser.js`, drops results whose `.kind === "skip"`, returns the surviving `ParsedLine[]` (which will be a mix of `"message"` / `"image"` / `"relay_outbound"` / `"relay_inbound"` / `"malformed"` variants).
   - Any exec-side error (SSH drop, timeout, nonzero-exit-with-empty-stdout via the tmux-helper contract) → returns null. NEVER throws.

2. **`resolveEventIdToLine(conn, sessionFile, eventId): Promise<number | null>`**
   - EventId validation FIRST: rejects non-string, empty string, AND strings containing a single-quote character (defense-in-depth against shell breakage — the helper does not attempt to sanitize; treats unsafe ids as unresolvable) → returns null with zero exec calls.
   - Shell command: `` `grep -n '"uuid":"${eventId}"' '${sessionFile}' | head -1 | cut -d: -f1` `` — `head -1` short-circuits grep on first match; `cut -d: -f1` isolates the line-number prefix.
   - Same `Promise.race` timeout + try/catch structure as `readSessionFileRange`.
   - Parses stdout via `Number.parseInt(trimmed, 10)`; returns the positive integer or null if the parse yields NaN, non-finite, or `<= 0` (also covers the "grep found nothing → empty stdout" case where `Number.parseInt("", 10) === NaN`).

Test file `src/backend/claude-session/session-file-range.test.ts` locks all eleven documented behaviors (6 for range read, 5 for eventId lookup) via the same vitest + `vi.mock('../ssh/tmux-helper.js')` + stubbed `ssh2.Client` shape used by `context-pct-from-jsonl.test.ts`.

Neither helper is wired into `claude-session-server.ts` in this plan — that's Wave 2 (43-04)'s job. `grep -rn "readSessionFileRange\|resolveEventIdToLine" src/backend/` hits only inside the two new files.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | RED — write session-file-range unit tests locking readSessionFileRange (6 behaviors) + resolveEventIdToLine (5 behaviors) | `6777bd14` | `src/backend/claude-session/session-file-range.test.ts` (new) |
| 2 | GREEN — implement readSessionFileRange + resolveEventIdToLine, mirroring context-pct-from-jsonl shape | `fc022688` | `src/backend/claude-session/session-file-range.ts` (new) |

## Verification Results

- **Target-file tests** — `npx vitest run src/backend/claude-session/session-file-range.test.ts` → **11 passed / 0 failed** (all Task 1 behaviors GREEN post-source-land).
- **Regression-safety across adjacent analog tests** — `npx vitest run src/backend/claude-session/session-file-range.test.ts src/backend/claude-session/context-pct-from-jsonl.test.ts src/backend/claude-session/session-file-tail.test.ts src/backend/claude-session/session-file-parser.test.ts` → **61 passed / 0 failed** across the target file + the three closest analogs (context-pct exact-shape analog, session-file-tail Wave-1 sibling, session-file-parser downstream consumer).
- **Backend build** — `npm run build:backend` → exit 0 (TypeScript strict compile against `tsconfig.node.json`).
- **Zero callers wired** — `grep -rn "readSessionFileRange\|resolveEventIdToLine" src/backend/` hits only inside `session-file-range.ts` (5 refs: 2 doc-comment mentions in header, 2 export declarations, 1 internal cross-ref) and `session-file-range.test.ts` (test-only refs). No callers in `claude-session-server.ts` — Wave 2 wiring untouched as designed.
- **RED gate honesty (Task 1)** — pre-source-land vitest run showed `Cannot find module '/src/backend/claude-session/session-file-range.js'` at test-import time → all 11 `it` blocks failed at module-resolution as designed. Post-source-land turned all 11 GREEN in a single go with zero test-file edits.
- **Task 2 acceptance grep gates** — `grep -c "export async function readSessionFileRange"` = 1, `grep -c "export async function resolveEventIdToLine"` = 1, `grep -c "parseSessionLine"` = 4 (import + call + 2 doc refs), `grep -c "kind"` = 3 (skip-filter comparison + doc refs), `grep -c "EXEC_TIMEOUT_MS"` = 6 (const + 2 usages + 3 doc/error-message refs).

### Acceptance criteria minor notes

Two grep counts on the source file exceed the plan's "= 1" literal:

- `grep -c "sed -n"` returned **2** rather than the plan's exact-1 target. The extra occurrence is a header docstring reference (`Shell primitive: \`sed -n 'M,Np' '<path>'\``) describing the primitive being used — idiomatic (context-pct-from-jsonl.ts does the same for its `tail -c` header). The plan's intent (a SINGLE command construction site, no copy-paste duplication) is satisfied: there is exactly one `sed -n` template-literal at L84.
- `grep -c "grep -n"` returned **3** rather than 1. Same class: two occurrences are doc-comment references describing the shell primitive; the single construction site is the template literal at L149.

Both are documentation-only and preserve the acceptance criterion's real intent (no duplicated construction). No action taken.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes required, no architectural questions surfaced, no auth gates hit, no rules-1-through-4 deviations invoked.

## Key Decisions Made

1. **One file, two exports.** Both helpers land in `session-file-range.ts` because the Wave 2 caller (`handleFetchOlder`) invokes them in a bound two-step sequence. Splitting into two files would optimize for reuse that doesn't exist while making the pair less discoverable. Filename matches the plan's `<files>` annotation exactly.

2. **Duplicated 3000ms timeout constant (no cross-file import).** `EXEC_TIMEOUT_MS = 3000` is declared inline rather than imported from `context-pct-from-jsonl.ts`. Rationale: the two files serve independent SSH tasks (context tail vs range read) on the same conn but there's no semantic reason they must move in lockstep. Keeping this file self-sufficient means a future timeout tuning on one doesn't silently propagate to the other. Matches plan action step L141: *"do not import from there; keep this file self-sufficient."*

3. **`MAX_RANGE_SPAN = 10000` guardrail.** Client-side typical fetch_older batch is ~50 (initial-connect window size); scroll-back-past-cap refetches are bounded by the working-set cap (~150 per plan 43-07b). 10000 is far above any realistic ask and small enough to reject garbage before it hits `sed`. Plan spec at L141 mandates `(endLine - startLine) < 10000`.

4. **EventId containing `'` → return null (no shell-escape).** Same posture as the path escape rule one layer down: paths are validated upstream by `discoverClaudeSession`, so we don't sanitize embedded quotes at the escape layer. EventIds are uuids that originate from `parseSessionLine` (via the client-side messages[]), so a `'` in an eventId is anomalous — treat as unresolvable rather than either throwing or attempting an escape-and-substitute. Plan spec at L103 and L148 mandate this: *"treat as unresolvable rather than throwing."*

5. **Non-null empty array is distinct from null.** `readSessionFileRange` returning `[]` means "exec succeeded but every line was empty or `kind:'skip'`"; returning `null` means "the read failed." Wave 2's caller can key the `reachedBeginning: true` short-circuit response frame off empty-array-non-null vs an `error: "..."` response frame off null — no ambiguity at the boundary.

## Files Created

- `src/backend/claude-session/session-file-range.ts` (177 lines) — the two exports plus header docstring, `EXEC_TIMEOUT_MS` + `MAX_RANGE_SPAN` module-scope constants, and per-function inline docstrings covering validation, timeout, path-escape convention, and error posture.
- `src/backend/claude-session/session-file-range.test.ts` (336 lines) — 11 vitest `it` blocks split across two `describe` groups. Mocks `../ssh/tmux-helper.js` with `vi.fn()` on `execCommand`. Uses fake-timers + `advanceTimersByTimeAsync` for timeout tests (Test 4, Test 11-B). Builds realistic JSONL fixture lines via `validUserLine()` / `skipLine()` helpers so `parseSessionLine` sees genuine input shapes.

## Files Modified

None.

## Wave-Handoff

Wave 2 (plan 43-04) will:

1. Import both helpers: `import { readSessionFileRange, resolveEventIdToLine } from "./session-file-range.js";` inside `claude-session-server.ts`.
2. Add a `handleFetchOlder(ws, msg, sshConn, currentSessionFile)` extracted handler mirroring `handleIdentityGetRoleFile` shape (per 43-PATTERNS.md § 2 test-seam convention: `handleIdentityGetRoleFile` at L717-793 + `__handleIdentityCountBountiesForTests` at L715).
3. Inside `handleFetchOlder`:
   - Validate `msg.anchorEventId` (string, non-empty) and `msg.count` (positive int within cap).
   - Call `const anchorLine = await resolveEventIdToLine(sshConn, currentSessionFile, msg.anchorEventId);` — if null, emit `{ type: "fetch_older_batch", frames: [], error: "anchor not found" }`.
   - Compute `const startLine = Math.max(1, anchorLine - msg.count);` and `const endLine = anchorLine - 1;`.
   - If `endLine < 1` (anchor is the file's first line), emit `{ type: "fetch_older_batch", frames: [], reachedBeginning: true }`.
   - Call `const frames = await readSessionFileRange(sshConn, currentSessionFile, startLine, endLine);` — if null, emit `{ type: "fetch_older_batch", frames: [], error: "range read failed" }`.
   - On success, emit `{ type: "fetch_older_batch", frames, reachedBeginning: startLine === 1 }`.
4. Register `handleFetchOlder` in the msg-switch under `case "fetch_older":`.
5. Export a `__handleFetchOlderForTests` seam alongside the existing `__*ForTests` exports at L715.

This plan (43-02) DID NOT touch `claude-session-server.ts`, the observation channel, or any wire types — Wave 2 owns those edits.

## Threat Flags

None. This plan adds a new backend helper module with two functions, no new network endpoints (Wave 2 owns the WS request wiring), no new auth surface, no schema changes, no new file access patterns beyond what `context-pct-from-jsonl.ts` already exercises (SSH exec of `sed` / `grep` against paths validated by `discoverClaudeSession`). The two shell-string construction sites both use the same single-quote-path-wrap convention the existing `context-pct-from-jsonl.ts` uses; the eventId-embedded-quote defense-in-depth check (`resolveEventIdToLine` rejects any id containing `'`) forecloses the one novel injection surface an unvalidated string arg could otherwise introduce.

## Self-Check: PASSED

Verified files exist:
- FOUND: `/home/ubuntu/skynet/src/backend/claude-session/session-file-range.ts` (177 lines)
- FOUND: `/home/ubuntu/skynet/src/backend/claude-session/session-file-range.test.ts` (336 lines)

Verified commits exist:
- FOUND: `6777bd14` — `test(43-02): add failing readSessionFileRange + resolveEventIdToLine spec`
- FOUND: `fc022688` — `feat(43-02): add readSessionFileRange + resolveEventIdToLine one-shot helpers`
