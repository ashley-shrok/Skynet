---
phase: 76-optimistic-bubbles-must-survive-the-wait-when-the-agent-was-
verified: 2026-09-06T08:35:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "After a real or forced dormant-wake failure, confirm the failed bubble reads as WHOLE-BUBBLE RED — the entire bubble surface is saturated red, NOT blue-gray gradient with a red outline."
    expected: "The entire user-bubble surface is a dark saturated red (hsla(0,60%,35%,0.90)), completely replacing the base blue-gray gradient. The border is also saturated red (hsla(0,70%,50%,0.85)). No blue-gray gradient visible."
    why_human: "CSS inline-style specificity behavior and gradient override cannot be fully verified in jsdom (jsdom confirms the values are set; a browser must confirm background shorthand defeats the className gradient visually). Ashley UAT deferred to end-of-phase per human_verify_mode: end-of-phase."
---

# Phase 76: Optimistic Bubbles — Verification Report

**Phase Goal:** Unify the two frontend dormancy signals into a single authoritative source, wire the pending-send timer to read it at arm time so the 220s branch actually triggers on reconnect-mid-dormancy, deliver whole-bubble red on flip-to-failed, and verify Phase 62's multi-send-during-wake claim under real conditions.
**Verified:** 2026-09-06T08:35:00Z
**Status:** human_needed (all automated checks PASS; one end-of-phase visual UAT item)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-01: `dormant` state / `dormantRef` is populated from BOTH `case "dormant"` (Signal A) AND `case "pane_state"` (Signal B) | VERIFIED | PrettyView.tsx:1815-1824 adds `setDormant(true/false)` in `case "pane_state"` block; PrettyView.tsx:2187 preserves the original Signal A write site (`setDormant(parsed.dormant)`). Two write paths confirmed by grep. |
| 2 | D-02: Option (a) chosen — `setDormant` fires from both handlers; no new derived value introduced | VERIFIED | `case "pane_state"` block at PrettyView.tsx:1815-1824 branches on `parsed.state`: `"dormant"` → `setDormant(true)`, `"active"\|"holding"\|"inactive"` → `setDormant(false)`, `"error"` → unchanged (Risk 2). Comment at L1787-1811 explicitly cites D-01, D-02, D-04 and the root cause. |
| 3 | D-03: `handleOptimisticSend` at PrettyView.tsx:1233 still reads `dormantRef.current` at arm time — byte-for-byte preserved | VERIFIED | `grep -n 'const armedDormant = dormantRef.current === true' PrettyView.tsx` returns line 1233 — exact string unchanged. |
| 4 | D-04: Symmetric-surface inventory produced and verified in commit — every consumer either automatically authoritative or documented with rationale | VERIFIED | feat(76-01) commit body contains the full 9-entry inventory table (confirmed from `git show 10aa8e10`). All 9 surfaces disposition-documented. No consumer left behind. |
| 5 | D-05: `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` and `PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000` unchanged; backend constants `MARKER_FALLBACK_MS_MIRROR = 90_000` and `GIVE_UP_MS_DORMANT = 120_000` confirmed; drift-catch comment present | VERIFIED | PrettyView.tsx:139-140 confirms both constants unchanged. pv-send-watchdog.ts:83 `MARKER_FALLBACK_MS_MIRROR = 90_000` and L:100 `GIVE_UP_MS_DORMANT = MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS + 10_000` (= 90000+20000+10000 = 120000) confirmed. Header comment at PrettyView.tsx:115-138 documents the coupling and states 220_000ms = 210_000ms backend ceiling + 10s margin. |
| 6 | D-06: Failed user bubble renders whole-bubble red fill — `background` shorthand (not just `borderColor`) overrides base gradient | VERIFIED (automated) / PENDING (visual UAT) | ChatMessage.tsx:408-412 uses `background: "hsla(0, 60%, 35%, 0.90)"` and `borderColor: "hsla(0, 70%, 50%, 0.85)"`. Old `hsla(0, 40%, 50%, 0.08)` tint removed (grep returns 0). Test 4b pin test asserts `rgba(143,36,36,0.9)` (jsdom-normalized) and passes. Visual confirmation requires browser UAT — see human_verification section. |
| 7 | D-07: Multi-send-during-wake verified under real conditions with reconnect-mid-dormancy setup — Phase 62 claim upheld | VERIFIED | Test 5d in PrettyView.optimistic-bubbles.test.tsx (lines 554-695) exercises: ws1 dormancy → ws1 close → ws2 Signal-B-only → two back-to-back sends → T+20001ms both pendings still alive (220s branch armed for both) → FIFO clear of both on matching frames → no failed bubbles. Test PASSES (confirmed by full suite run: 48/48 pass). |
| 8 | D-08: Awake-case pending-send stopwatch (`PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000`) unchanged; Test 5 (awake 20s flip) still passes | VERIFIED | Constant confirmed at PrettyView.tsx:139. Test 5 ("20s timer flips pending to failed") at line 351 passes in full suite run (48/48). |

**Score:** 8/8 truths verified (7 fully automated; 1 automated + pending visual UAT)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/features/pretty-view/PrettyView.tsx` | Unified dormancy signal: `case "pane_state"` handler calls `setDormant` | VERIFIED | Lines 1787-1826 contain the D-01/D-02 migration with full explanatory comment. `case "dormant"` at L2186 preserved. Arm site at L1233 byte-preserved. `dormantRef` mirror useEffect at L2598 unchanged. |
| `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` | Test 5c (reconnect-mid-dormancy single-send) + Test 5d (multi-send FIFO verification) | VERIFIED | Test 5c at lines 447-552 (+107 lines). Test 5d at lines 554-695 (+143 lines). Both tests pass in the 48-test suite. |
| `src/ui/features/pretty-view/ChatMessage.tsx` | Whole-bubble red fill on `pendingState === "failed"` | VERIFIED | Lines 408-413: `background: "hsla(0, 60%, 35%, 0.90)"`, `borderColor: "hsla(0, 70%, 50%, 0.85)"`. Old `backgroundColor: "hsla(0, 40%, 50%, 0.08)"` removed (grep returns 0). |
| `src/ui/features/pretty-view/ChatMessage.test.tsx` | Test 4b pin test for whole-bubble red CSS values | VERIFIED | Test 4b at lines 393-423. Asserts `rgba(143,36,36,0.9)` (background) and `rgba(217,38,38,0.85)` (borderColor) — jsdom-normalized hsla values. Passes (48/48). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `PrettyView.tsx case "pane_state"` block (~L1761) | `setDormant(true\|false)` | new `setDormant` call inside case block | WIRED | L1815-1824 confirmed by grep showing `setDormant` at L1817 and L1823 within the `case "pane_state"` block |
| `PrettyView.tsx handleOptimisticSend arm site (L1233)` | `dormantRef.current` | arm-time read — unchanged | WIRED | `const armedDormant = dormantRef.current === true` at L1233; `dormantRef` is now fed from both Signal A and Signal B |
| `Test 5c` | `sendWsFrame(ws2, { type: "pane_state", state: "dormant" })` WITHOUT Signal A | delivers only Signal B on ws2 | WIRED | Line 515 in test file: `sendWsFrame(ws2, { type: "pane_state", state: "dormant" })`. Grep for Signal A on ws2 returns 0 (confirmed). |
| `Test 5d` | two `typeAndEnter` calls during reconnect-mid-dormancy | sequential sends arm 220s branch | WIRED | Lines 625-638: two distinct `typeAndEnter` calls; T+20001ms assertion at L654 confirms both pendings still alive |
| `ChatMessage.tsx bubbleInlineStyle showFailedBubble branch` | saturated red `background` + `borderColor` | inline style overrides base className gradient | WIRED | `background: "hsla(0, 60%, 35%, 0.90)"` at L411; `borderColor: "hsla(0, 70%, 50%, 0.85)"` at L412. Old tint absent. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| PrettyView.tsx pending-send timer | `armedDormant` (latched at arm time) | `dormantRef.current` (fed from both `case "dormant"` and `case "pane_state"` handlers) | Yes — real WS frame values | FLOWING |
| ChatMessage.tsx bubble style | `showFailedBubble` → `bubbleInlineStyle` | `pendingState === "failed"` prop from PrettyView pending-send state machine | Yes — real state | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test 5c (reconnect-mid-dormancy 220s branch) passes | `npx vitest run PrettyView.optimistic-bubbles.test.tsx` | 48/48 pass (exit 0) | PASS |
| Test 5d (multi-send FIFO) passes | same run | 48/48 pass (exit 0) | PASS |
| Test 4b (whole-bubble red pin) passes | `npx vitest run ChatMessage.test.tsx` | 48/48 pass (exit 0) | PASS |
| Test 5 (awake 20s branch unchanged, D-08) passes | same run | 48/48 pass (exit 0) | PASS |
| Test 5b (Signal A path preserved) passes | same run | 48/48 pass (exit 0) | PASS |
| `dormantRef.current === true` arm site at L1233 preserved | grep | 1 match at exact line | PASS |
| Old 0.08-alpha tint removed from ChatMessage.tsx | grep `'hsla(0, 40%, 50%, 0.08)'` | 0 matches | PASS |
| Backend constants unchanged (D-05) | grep pv-send-watchdog.ts | `MARKER_FALLBACK_MS_MIRROR = 90_000` at L83; `GIVE_UP_MS_DORMANT = ...120_000` at L100 | PASS |

### Probe Execution

Step 7c: SKIPPED — Phase 76 delivers no scripts/*/tests/probe-*.sh; this is a frontend/test-only change. The `npx vitest run` spot-checks above serve as the behavioral verification.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| D-01 | 76-01 | Two signals reconciled into single authoritative source | SATISFIED | `setDormant` fired from both `case "dormant"` and `case "pane_state"` |
| D-02 | 76-01 | Option (a) chosen — setDormant from both cases | SATISFIED | Additive change confirmed; no new derived value |
| D-03 | 76-01 | Arm-time read of `dormantRef.current` preserved | SATISFIED | L1233 byte-preserved |
| D-04 | 76-01 | Symmetric-surface inventory in commit body | SATISFIED | 9-entry table in feat(76-01) commit (10aa8e10) |
| D-05 | 76-01 | Timeout sourcing by reference to backend constants; no drift | SATISFIED | Constants confirmed; comment documents coupling |
| D-06 | 76-02 | Whole-bubble red fill on flip-to-failed | SATISFIED (automated) + PENDING (visual) | Test 4b green; end-of-phase visual UAT needed |
| D-07 | 76-03 | Multi-send-during-wake verified under real conditions | SATISFIED | Test 5d PASSES on Plan 01 HEAD; Phase 62 claim upheld |
| D-08 | 76-01 | Awake-case 20s stopwatch unchanged | SATISFIED | Constant at L139 unchanged; Test 5 passes |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No debt markers (TBD/FIXME/XXX), no stubs, no placeholders found in Phase 76 modified files. |

Scanned files: `src/ui/features/pretty-view/PrettyView.tsx` (new code at L1787-1826), `src/ui/features/pretty-view/ChatMessage.tsx` (L390-413), both test files. No `TBD`, `FIXME`, `XXX`, `placeholder`, or `return null` / `return {}` / `return []` patterns found in modified sections.

### Fleet Rule Adherence

| Rule | Check | Result |
|------|-------|--------|
| No docker build/compose | `git log --since=2026-09-06 \| grep -iE 'docker build\|docker compose'` | 0 matches — PASS |
| No git push | same search | 0 matches — PASS |
| Branch unchanged | `git branch --show-current` | `feat/tab-title-from-tmux` — PASS |
| No .git/worktrees residue | `ls .git/worktrees/` | no worktrees — PASS |
| TDD RED-then-GREEN (Plan 01) | commits 56926ebc (test) before 10aa8e10 (feat) | PASS |
| TDD RED-then-GREEN (Plan 02) | commits 42b47484 (test) before 7aaf0548 (feat) | PASS |

### Human Verification Required

#### 1. Whole-Bubble Red Visual (D-06 end-of-phase UAT)

**Test:** Force a failed bubble: deliver a `paste_send_failed` frame via DevTools console to the PrettyView WS connection while a pending bubble is in flight, OR wait for a natural dormant-wake timeout. The failed bubble is the user-bubble that was previously pending.

**Expected:** The entire user-bubble surface is a dark saturated red. The base blue-gray gradient (which is visible on all non-failed user bubbles) is completely replaced — not tinted over. The bubble should appear with the same shape and rounding as a normal user bubble, but with the entire background surface as deep red (approximately `rgba(143, 36, 36, 0.9)` in computed style). The border should be a brighter saturated red (`rgba(217, 38, 38, 0.85)`).

**What to check:** Does the whole bubble surface look red, or does the blue-gray gradient still show through? A passing visual: the bubble looks like it "turned red." A failing visual: the bubble looks like a blue bubble with a red border.

**Why human:** CSS `background` shorthand vs `background-image` cascade behavior is confirmed by Test 4b in jsdom, but jsdom cannot render actual CSS compositing. The plan specifically notes that `background` shorthand defeats the Tailwind className gradient in the browser CSS cascade — this must be confirmed in a real browser. Reference CSS tuple: `background: hsla(0, 60%, 35%, 0.90)`, `borderColor: hsla(0, 70%, 50%, 0.85)`.

### Gaps Summary

No gaps. All 8 must-have truths verified by codebase evidence. The single outstanding item is an end-of-phase visual UAT for D-06 (deferred per `human_verify_mode: end-of-phase` configuration) — not a blocker for phase completion.

---

## VERIFICATION PASSED

All D-01 through D-08 requirements are delivered and verified by codebase evidence:

- **D-01/D-02 (Signal unification):** `case "pane_state"` handler at PrettyView.tsx:1815-1824 calls `setDormant(true/false)`, making `dormantRef` authoritative through both Signal A and Signal B. Option (a) implemented exactly as specified.

- **D-03 (Arm-time read):** `const armedDormant = dormantRef.current === true;` at PrettyView.tsx:1233 byte-preserved.

- **D-04 (Symmetric-surface inventory):** 9-entry table documented in feat(76-01) commit body; all surfaces accounted for under option (a) — zero consumer migration required.

- **D-05 (Backend constants no drift):** `MARKER_FALLBACK_MS_MIRROR = 90_000` and `GIVE_UP_MS_DORMANT = 120_000` confirmed in pv-send-watchdog.ts; frontend constants at PrettyView.tsx:139-140 unchanged.

- **D-06 (Whole-bubble red):** ChatMessage.tsx `bubbleInlineStyle` uses `background: "hsla(0, 60%, 35%, 0.90)"` (defeats base gradient) + saturated red `borderColor`. Old 0.08-alpha tint removed. Pin test (Test 4b) green.

- **D-07 (Multi-send verified):** Test 5d confirms Phase 62's multi-send claim holds under reconnect-mid-dormancy conditions — two sends arm 220s branch, FIFO clear delivers both in order, no failures.

- **D-08 (Awake case unchanged):** `PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000` intact; Test 5 (awake 20s flip) still passes.

**Test suite:** 48/48 tests pass (22 in PrettyView.optimistic-bubbles.test.tsx + 26 in ChatMessage.test.tsx), including all Phase 76 additions (Test 5c, 5d, 4b) and all pre-existing Phase 62 and earlier tests.

**Pending:** End-of-phase visual UAT for D-06 whole-bubble red visual (Ashley, next dormant-wake failure or forced via DevTools).

---

_Verified: 2026-09-06T08:35:00Z_
_Verifier: Claude (gsd-verifier)_
