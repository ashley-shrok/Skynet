---
phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
verified: 2026-08-12T21:10:00Z
status: human_needed
score: 9/9 D-nnn decisions covered in code
overrides_applied: 0
re_verification: null
human_verification:
  - test: "Wake bubble now shows message history for a dormant identity pane (Ashley's original UAT)"
    expected: "After deploy: attach to a dormant identity pane (e.g. tanya or tiffany that hasn't been active); the wake bubble appears AND the messages array is populated with the tail of the identity's most-recent JSONL conversation. Non-empty messages are rendered in the pretty view above/around the bubble."
    why_human: "End-to-end verification requires (a) a live deploy to term.gigaashley.click, (b) an actual dormant identity session on the box, (c) an iOS PWA/browser session so Ashley can see the message history alongside the bubble. Cannot be simulated by grep or unit tests — the integration-test coverage (CASE-DT1-DT7) proves the code path exists; only a real dormant-attach can confirm the historical stream actually flows to the browser."
  - test: "Wake handoff produces no duplicate/out-of-order messages (T-32-04 in production)"
    expected: "Attach to a dormant identity pane, then trigger a wake (send a user turn). Watch the transition: no duplicate eventId frames on the WS, no out-of-order messages in the pretty view."
    why_human: "CASE-DT4 + DT5 prove the code-level invariant (safe-close ordering + stopped-flag guard). Production observability at scale is the confirmation surface — needs a live wake event that crosses the handoff window."
  - test: "Post-deploy hash-match runbook step catches wrong-path docker cp"
    expected: "During the next production deploy, operator runs the codified hash-match snippet from box-map.md; SERVED and LOCAL match after correct docker cp to /app/html/; MISMATCH is caught loudly if docker cp is ever pointed at /app/dist/."
    why_human: "This is the deploy-loop hardening from Plan 32-03. The runbook change is verified as codified in box-map.md, but its correctness under adversarial conditions (wrong-path docker cp) requires an actual deploy attempt to validate."
---

# Phase 32: Identity-first-turn session discovery + wake-bubble message history — Verification Report

**Phase Goal:** Add a process-independent, disk-based helper for finding the current JSONL of a given identity, and wire it into the dormant branch so the wake bubble surfaces the tail of the conversation Ashley is deciding whether to wake — instead of an empty message list.

**Verified:** 2026-08-12T21:10:00Z
**Status:** human_needed (all automated checks pass; 3 human UAT items remain)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths — Automated Verification

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `discoverIdentitySessionFile(conn, name)` exists as a pure, disk-based helper returning `Promise<string \| null>` | VERIFIED | `src/backend/claude-session/discover-identity-session-file.ts:287-328` — signature matches spec; 22/22 tests pass |
| 2 | Byte-pattern match (not JSON.parse) per D-01 | VERIFIED | `discover-identity-session-file.ts:131-149` uses only `line.includes` + single char-index; grep confirms 0 `JSON.parse` in module code (3 hits all in docblock text) |
| 3 | First user-role line only per D-02 | VERIFIED | Shell script `head -c 4096 | grep -m 1 '"role":"user"'` at L201; predicate applied to the single line only; CASE-H5 asserts later-in-file `/id` mentions are NOT matched |
| 4 | Mtime-latest tiebreak per D-03 | VERIFIED | Shell `sort -rn` at L198 + belt-and-suspenders JS re-sort at L320; CASE-H2 asserts mtime-latest wins (1000, 2000, 1500 → 2000) |
| 5 | Throwaway/non-identity panes naturally excluded per D-04 | VERIFIED | Falls out of D-01+D-02 constraints; CASE-H4b explicitly asserts a plain first-user-turn (no `/id`) does not match |
| 6 | Cold-start works (no cache/bootstrap) per D-05 | VERIFIED | Zero cache layer in module; module state is only the shell script text. CASE-H3, H6, H7 all assert null-return fallback paths |
| 7 | Stronger identity attribution than pane-based per D-06 | VERIFIED (conceptual) | Byte-pattern distinguishes identity even when project dirs shared — falls out of D-01 partial-name refusal guard; CASE-P2a/P2b assert `tiff` ≠ `tiffany` |
| 8 | Cost negligible / single SSH round-trip per D-07 | VERIFIED | One-round-trip shell script at L170-205; only ONE `execCommand` call per invocation; CASE-H1 asserts call count = 1 |
| 9 | Recycle-boundary parity + wake-handoff safe-close ordering per D-08 | VERIFIED | Safe-close block at `claude-session-server.ts:4916-4930` — `tailHandle.stop() + tailHandle = null` BEFORE `startActiveSessionFlow`; CASE-DT4 asserts invocation-order; CASE-DT5 asserts no eventId double-emit |
| 10 | Live path untouched per D-09 (OUT OF SCOPE enforcement) | VERIFIED | `git diff 8bc2ebc HEAD src/backend/claude-session/session-file-discovery.ts` empty; `layer1-detect.ts` empty; active-flow tail-open at L4776 byte-unchanged (`grep '^[+-].*(startActiveSessionFlow\s*=|tailSessionFile\(sshConn)'` returns only 1 comment-line hit inside the new safe-close block) |
| 11 | Dormant branch calls discoverIdentitySessionFile + opens tail (Wave 2 wire-in) | VERIFIED | Production call site at `claude-session-server.ts:5039-5074` delegates to `__applyDormantBranchTailOpenForTests` seam; seam at L1292 calls helper + opens tail on non-null; CASE-DT1 asserts full call chain |
| 12 | Fallback: null-return degrades gracefully to today's behavior | VERIFIED | Seam at L1316-1323 emits no-match log without opening tail; helper-throw path at L1324-1338 same treatment; CASE-DT2, CASE-DT6 assert |
| 13 | UI byte-untouched invariant | VERIFIED | `git status --porcelain src/ui/` returns empty; `DormancyOverlay.test.tsx` + `PrettyView.test.tsx` 38 passed / 1 skipped / 1 todo (byte-unchanged behavior) |
| 14 | W-4: WS-close teardown still stops tailHandle via teardownPane | VERIFIED | `grep -B2 -A30 'ws.on("close"' \| grep -c teardownPane` = 5; teardownPane at L1701 calls tailHandle.stop() |
| 15 | W-5: log payload downgrade — basename only, no absolute path leak | VERIFIED | `basename(discoveredFile)` in seam L1311; `grep 'discoveredFile:' \| grep -v 'discoveredFileBasename'` returns 0; CASE-DT1 explicitly asserts `.not.toHaveProperty("discoveredFile")` |
| 16 | Full vitest suite green | VERIFIED | 155 files pass, 1972 tests pass, 7 skipped + 1 todo (unchanged); zero regressions |
| 17 | TypeScript clean | VERIFIED | `npx tsc --noEmit` returns 0 output |
| 18 | Deploy runbook: /app/html/ correction + hash-match check codified (Plan 32-03) | VERIFIED | `~/.claude/roles/box-maintainer/box-map.md` L94-135 has: `/app/html/` correction (×6), 260812-ma8 incident cross-reference (×2), MISMATCH/hash-match verify block (×3) |

**Score:** 18/18 automated must-haves verified

### D-nnn Coverage Matrix

| D-ID | Decision | Coverage | Evidence |
|------|----------|----------|----------|
| **D-01** | Byte-pattern match, not JSON parse | COVERED | `discover-identity-session-file.ts:131-149` line.includes only; 0 JSON.parse in code; CASE-P1..P7 predicate tests all pass; CASE-P2a/P2b assert partial-name refusal |
| **D-02** | First user-role line only | COVERED | Shell `grep -m 1 '"role":"user"'` at L201; CASE-H5 asserts later-line mention ignored |
| **D-03** | Mtime-latest tiebreak | COVERED | Shell `sort -rn` L198 + JS re-sort L320; CASE-H2 asserts mtime tiebreak |
| **D-04** | Throwaway/non-identity naturally excluded | COVERED | Falls out of D-01+D-02; CASE-H4b explicitly asserts non-`/id` first turn produces no match |
| **D-05** | Cold-start works | COVERED | No cache layer in module code; CASE-H3, H6, H7 all assert null-return fallback |
| **D-06** | Stronger identity attribution than pane-based | COVERED (conceptual) | Byte-pattern distinguishes identity even when project dirs shared; CASE-P2 partial-name refusal is the load-bearing check |
| **D-07** | Cost negligible / single round-trip | COVERED | One-round-trip shell script at L170-205; single execCommand call per invocation asserted in tests |
| **D-08** | Recycle-boundary parity + wake-handoff safe-close ordering | COVERED | `claude-session-server.ts:4916-4930` safe-close block; CASE-DT4 (call order) + CASE-DT5 (no double-emit) |
| **D-09** | OUT OF SCOPE: live path untouched | COVERED | session-file-discovery.ts / layer1-detect.ts git-diff empty; startActiveSessionFlow declaration and its tail-open call byte-unchanged |

**All 9 locked decisions covered with grep + code + test evidence.**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/claude-session/discover-identity-session-file.ts` | Pure helper module | VERIFIED | 328 lines; exports `discoverIdentitySessionFile`, `__matchesIdentityFirstTurnForTests`, `DISCOVERY_EXEC_TIMEOUT_MS` |
| `src/backend/claude-session/discover-identity-session-file.test.ts` | 22 test cases | VERIFIED | 461 lines; 22/22 tests pass |
| `src/backend/claude-session/claude-session-server.ts` | Dormant branch wired in | VERIFIED | 5128 lines; imports added at L3 (basename) + L11 (discoverIdentitySessionFile); seam exported at L1292; production call site at L5039; safe-close block at L4916 |
| `src/backend/claude-session/claude-session-server.dormant-tail.test.ts` | 7 CASE-DT integration tests | VERIFIED | 422 lines; 7/7 tests pass |
| `~/.claude/roles/box-maintainer/box-map.md` | Deploy runbook hardened | VERIFIED | /app/html/ correction, 260812-ma8 cross-ref, hash-match snippet all present |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| Dormant branch (L5039) | discoverIdentitySessionFile | `await __applyDormantBranchTailOpenForTests(...)` seam call | WIRED |
| Seam (L1307) | discoverIdentitySessionFile | `await discover(conn, tmuxSession)` | WIRED |
| Seam (L1314) | tailSessionFile | `tail(sshConn, discoveredFile, onLine, onError)` — SAME onLine/onError refs (D-08 latency parity, CASE-DT3) | WIRED |
| startActiveFlow callback (L4916) | closure-scoped tailHandle | `if (tailHandle) { tailHandle.stop(); tailHandle = null; ... }` | WIRED |
| ws.on("close") | teardownPane → tailHandle.stop() | pre-existing wire preserved | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| Wake bubble (UI) | `messages` array on WS client | Backend `appendDedup` pipeline fed by `onLine` closure | Depends on real JSONL content on box — code path verified, dynamic content requires live UAT | FLOWING (code); requires human UAT for actual browser render |
| Dormant tail | JSONL lines | `tail -F -n +1` on discovered file via `session-file-tail.ts` | tail-follow of a real disk file; will produce historical + live stream when file exists | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Discover helper unit tests | `npx vitest run src/backend/claude-session/discover-identity-session-file.test.ts` | 22/22 pass | PASS |
| Dormant-tail integration tests | `npx vitest run src/backend/claude-session/claude-session-server.dormant-tail.test.ts` | 7/7 pass | PASS |
| Dormant-poll regression | `npx vitest run src/backend/claude-session/dormant-poll.test.ts` | 19/19 pass | PASS |
| UI regression | `npx vitest run src/ui/features/pretty-view/DormancyOverlay.test.tsx src/ui/features/pretty-view/PrettyView.test.tsx` | 38 pass, 1 skipped, 1 todo (unchanged) | PASS |
| Full vitest suite | `npx vitest run` | 155 files, 1972 tests pass, 7 skipped, 1 todo | PASS |
| TypeScript typecheck | `npx tsc --noEmit` | 0 errors | PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| N/A | — | No TBD/FIXME/XXX debt markers in modified files | Info | Clean |

Grep for anti-patterns in the Phase 32 modified files:
- `discover-identity-session-file.ts` — 0 TODO/FIXME/HACK/TBD in code (docblock references to "JSON.parse" and "layer1-detect" are prose only)
- `claude-session-server.ts` new sections — 0 debt markers; extensive intentional comments citing D-01..D-09 + T-32-04..T-32-06 for future readers
- `claude-session-server.dormant-tail.test.ts` — 0 debt markers
- Test files use fixture builders + explicit `vi.fn()` mocks; no hardcoded empty data flowing to production

### Requirements Coverage

Requirements from plan frontmatter (`requirements: [D-01, D-02, D-03, D-04, D-05, D-06, D-07]` for plan 32-01; `[D-01, D-02, D-05, D-07, D-08, D-09]` for plan 32-02; `[D-05]` for plan 32-03):

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| D-01 | 32-01, 32-02 | Byte-pattern match, not JSON parse | SATISFIED | See D-nnn Coverage Matrix above |
| D-02 | 32-01, 32-02 | First user-role line only | SATISFIED | See matrix |
| D-03 | 32-01 | Mtime-latest tiebreak | SATISFIED | See matrix |
| D-04 | 32-01 | Throwaway/non-identity excluded | SATISFIED | See matrix |
| D-05 | 32-01, 32-02, 32-03 | Cold-start works | SATISFIED | See matrix |
| D-06 | 32-01 | Stronger identity attribution | SATISFIED | See matrix |
| D-07 | 32-01, 32-02 | Cost negligible | SATISFIED | See matrix |
| D-08 | 32-02 | Recycle-boundary parity + wake-handoff safe-close | SATISFIED | See matrix |
| D-09 | 32-02 | Live path untouched | SATISFIED | See matrix |

**All 9 D-nnn requirements SATISFIED. No orphaned requirements.**

### Human Verification Required

3 items need human testing (see YAML `human_verification` above for structured detail):

1. **Wake bubble now shows message history for a dormant identity pane** — Ashley's original UAT complaint from 2026-08-12: *"the bubble looks good, but unfortunately, the rest of the messages that would be in that session are not showing up."* Backend code path is verified end-to-end; final confirmation requires attaching to a real dormant identity pane in the iOS PWA/browser after deploy.

2. **Wake handoff produces no duplicate/out-of-order messages** — CASE-DT4 + DT5 prove the code-level invariant. Production confirmation requires an actual wake event across the dormant→active handoff window.

3. **Post-deploy hash-match runbook step catches wrong-path docker cp** — Plan 32-03 codified the mandatory hash-match verify snippet in `~/.claude/roles/box-maintainer/box-map.md`. Its correctness under adversarial conditions (wrong-path docker cp) requires an actual deploy attempt.

### Gaps Summary

**No blockers, no gaps.** All 18 automated must-haves verified. All 9 locked D-nnn decisions have code artifacts + test coverage. Full test suite green. TypeScript clean. UI byte-untouched. Live-path (D-09) enforced by git-diff. Log-payload downgrade (T-32-05) enforced by both code (`basename()`) and test (`.not.toHaveProperty('discoveredFile')`).

The 3 human-UAT items exist because the phase's user-visible outcome ("wake bubble now shows messages") cannot be simulated without (a) a live deploy, (b) a real dormant identity session on the box, and (c) an actual iOS PWA/browser session. The backend code path is verified; only the end-to-end browser render requires Ashley's eyes.

**Orchestrator route recommendation:** proceed to deploy. After deploy verification via hash-match snippet, request Ashley UAT of the wake-bubble message-history flow.

---
*Verified: 2026-08-12T21:10:00Z*
*Verifier: Claude (gsd-verifier)*
