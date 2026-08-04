---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
plan: 05
subsystem: frontend/pretty-view

tags: [plan-mode, composebox-disable, prettyview-wiring, raw-keystrokes-callbacks, disable-truth-table, phase-24-close]

# Dependency graph
requires:
  - phase: 24-03
    provides: "widened PlanPendingEvent wire type + RawKeystrokesPayload client→server type + backend raw_keystrokes handler"
  - phase: 24-04
    provides: "PlanPendingBubbleProps interface (planFilePath, planContent, contentError, onApprove, onFeedback) + full 5-prop bubble consumer"
provides:
  - "planPendingActive?: boolean prop on ComposeBox (verbatim clone of recycleActive shape) OR-in'd into every disable predicate that reads recycleActive"
  - "planPendingActive?: boolean prop on QueuedRow (same OR-in pattern for the slot-row aux buttons)"
  - "PrettyView widened planPending state to match Plan 03 wire type; mounted PlanPendingBubble with all 5 props from state"
  - "PrettyView handlePlanApprove callback — sends {type:'raw_keystrokes',bytes:'1\\r'} via wsRef.current when OPEN"
  - "PrettyView handlePlanFeedback(text) callback — sends {type:'raw_keystrokes',bytes:'3<text>\\r'} same way"
  - "PrettyView supplies planPendingActive={planPending !== null} to ComposeBox alongside recycleActive={showOverlay} and asideActive={asideText !== null || asidePending}"
  - "New ComposeBox.plan-pending-disable.test.tsx vitest file covering B1-B6 + C1-C4 truth-table cases (10 tests total)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OR-in-in-every-recycleActive-site: when a new disable mode's semantics match an existing one verbatim, extend every existing predicate additively (`|| newFlag === true` / `&& !newFlag`) rather than collapsing into a combined flag. Preserves per-mode Send-button behavior differences (asideActive morphs; recycleActive + planPendingActive keep Send-as-Send) at the cost of one line per site."
    - "Test-file-per-disable-mode: each independent ComposeBox disable prop gets its OWN test file (ComposeBox.aside-props.test.tsx / ComposeBox.aside-morph.test.tsx / ComposeBox.recycle-disable.test.tsx / ComposeBox.plan-pending-disable.test.tsx) so the truth table stays exhaustively covered per prop without cross-prop collision. New file is a byte-for-byte clone of the closest analog with the prop-name and describe/it/comment substitutions applied."
    - "Parent-owns-wsRef, bubble-owns-callbacks: PlanPendingBubble is prop-driven / callback-out (Plan 04's contract); PrettyView owns the WebSocket ref and constructs the raw_keystrokes payloads at the callback boundary. Bubble never touches wsRef — clean separation lets the bubble stay unit-testable without a WS mock, and lets the parent handle transport concerns (readyState guard, swallow-on-error) uniformly with handleAsideDismiss."

key-files:
  created:
    - "src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx (+322 lines) — new vitest file. B1-B6 primary truth-table cases + C1-C4 mic/paperclip parity cases from bounty mic-available-when-composebox-disabled. Mirrors ComposeBox.recycle-disable.test.tsx byte-for-byte with recycleActive → planPendingActive substitutions in prop names, describe/it strings, and comment prose. Same MockMediaRecorder + navigator.mediaDevices + fetch stubs harness."
  modified:
    - "src/ui/features/pretty-view/ComposeBox.tsx (+40/-9) — new planPendingActive?: boolean prop on ComposeBoxProps interface (docblock mirrors recycleActive verbatim per CONTEXT § 'Do NOT collapse'); new planPendingActive?: boolean on QueuedRowProps interface for slot-paperclip parity; destructured in both ComposeBox and QueuedRow; OR-in'd at all 11 sites where recycleActive already gates a disable predicate (handleKeyDown Enter-swallow, showPrimaryArmButton gate, showSlotArmButton gate, sendDisabled composite, Reset button disabled=, ThumbsUp disabled=, Recap disabled=, QueuedRow prop pass-through, queued-row Paperclip disabled=, handleVoiceSend primary dispatch guard, handleVoiceSend slot dispatch guard). Textarea disabled attribute UNCHANGED (stays typeable). Primary Paperclip + primary MicButton UNCHANGED (mic-available-when-composebox-disabled parity)."
    - "src/ui/features/pretty-view/PrettyView.tsx (+76/-6) — planPending state widened from {planFilePath: string} | null to {planFilePath|null, planContent|null, contentError|null} | null; state docblock extended with Phase 24 stanza; handlePlanApprove + handlePlanFeedback useCallback helpers added adjacent to handleAsideDismiss (mirror its swallow-on-error shape, use wsRef.current + readyState OPEN guard, send bytes only per T-14-02-01 trust boundary); PlanPendingBubble mount updated to pass all 5 props from state; ComposeBox invocation gains planPendingActive={planPending !== null} sibling prop next to recycleActive={showOverlay} with a docblock referencing CONTEXT § 'Do NOT collapse'."

key-decisions:
  - "OR-in showSlotArmButton with BOTH recycleActive AND planPendingActive (parity with primary L1445-ish). PATTERNS.md flagged this as parity-add for planPendingActive; on inspection the existing slot gate did NOT include recycleActive either, so this closes a pre-existing consistency gap in the same edit. Rule 2 (missing critical functionality — slot arm-idle button should not be reachable during recycle for the same reason it's hidden on primary). No user-visible break because the slot arm-idle only appears when there's slot text AND the slot isn't already armed AND asideActive is false — an already-narrow gate. Adding two more clauses tightens it to match the primary's shape."
  - "handleVoiceSend dispatch guards updated in BOTH branches (primary + slot). Existing shape was `if (!recycleActive)`; extended to `if (!recycleActive && !planPendingActive)` so a completed voice transcript during the plan-approval window lands in the textarea/slot (via the setText / setQueueSlots calls above the guard) but does NOT auto-dispatch. C3 test case in the new test file exercises exactly this invariant for the primary branch. Slot-branch is symmetric; C5 deferred per the same rationale used in recycle-disable.test.tsx (fixture cost outweighs coverage margin)."
  - "Test file created with tdd='true' plan-level marker but NOT strict RED-first because the code exists (Task 1). Reading the plan text: the test-file's purpose is truth-table coverage of an already-shipped prop, not a behavior-driving new feature. Wrote all 10 tests, all pass on first run. This matches the recycle-disable file's history — same pattern, same posture. No 'red' gate commit; the plan-level `tdd: false` phase marker + gate-sequence check is not violated because plan 24-05 itself has `type: execute` (not `type: tdd`) so plan-level TDD gate does not apply."
  - "vitest reporter=basic flag rejected by installed vitest 4.1.8 (Reporter 'basic' not found). Removed the flag; default reporter output is unambiguous ('10 passed / 10 tests'). Not a plan deviation — plan's automated verify grep used --reporter=basic which is documentation-of-command-shape only; the underlying test outcome is what the acceptance criteria measure."
  - "Extended PrettyView planPending state docblock with a Phase 24 stanza rather than replacing the existing patch #63 provenance comment. Preserves the historical rationale (Plan Mode is between Ashley and Claude Code; presence-only original intent) at the top and adds the Phase 24 expansion (bubble now renders contents + buttons + WS-send handlers) as a sequential addition. Reads chronologically. Matches PlanPendingBubble's docblock-ordering convention (Plan 04 SUMMARY key-decisions)."

patterns-established:
  - "OR-in-every-site-additively: when a new disable-mode prop is a verbatim clone of an existing one (recycleActive → planPendingActive), the mechanical process is: (1) grep every occurrence of the existing prop; (2) at each site, add the new prop's clause in the same expression shape (`|| newProp === true`, `&& !newProp`, `!recycleActive && !newProp`); (3) verify count parity (new prop count >= old prop count minus documentation-only references); (4) do NOT collapse into a combined variable — differences in Send-button behavior across the three modes lock the independent-props posture (CONTEXT § 'Do NOT collapse'). This pattern has now been used for three additions in ComposeBox (asideActive → recycleActive → planPendingActive)."
  - "New-test-file-per-disable-mode: instead of extending an existing test file with a new prop's cases, create a new file that mirrors the closest existing analog byte-for-byte with prop-name substitutions. Prevents cross-prop test collisions, keeps each disable-mode's truth-table self-documenting, and makes bisecting a per-mode regression trivial (`vitest run *.NEWMODE-disable.test.tsx`). File naming convention: ComposeBox.{mode}-{treatment}.test.tsx (aside-morph, aside-props, recycle-disable, plan-pending-disable)."
  - "Callback-out bubble + parent-owns-transport: presentational bubbles (PlanPendingBubble, AsideBubble) expose callback props (onApprove, onFeedback, onDismiss) and never touch wsRef. Parent PrettyView owns the wsRef and constructs the WS payload at the callback boundary, using a consistent `readyState !== OPEN` early-return + `try/swallow` on send. Same posture across handleAsideDismiss / handlePlanApprove / handlePlanFeedback — easy to audit for trust-boundary violations (send only what the parent computes; ignore any bubble-supplied hostId/tmuxSession)."

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-08-04
---

# Phase 24 Plan 05: ComposeBox planPendingActive + PrettyView wire-up Summary

**Added `planPendingActive?: boolean` prop to `ComposeBox` (verbatim clone of `recycleActive`) and OR-in'd at every one of the 11 existing recycleActive disable sites (Enter-swallow, showPrimaryArmButton, showSlotArmButton, sendDisabled, Reset/ThumbsUp/Recap/queued-Paperclip disabled= attrs, QueuedRow prop pass-through + interface + destructure, handleVoiceSend primary + slot dispatch guards) while leaving the textarea disabled attribute + primary Paperclip + primary MicButton untouched (mic-available-when-composebox-disabled parity); wired `PrettyView.tsx` to widen its `planPending` state to `{planFilePath|null, planContent|null, contentError|null} | null` (matches Plan 03 wire type), mount `PlanPendingBubble` with all 5 props, add `handlePlanApprove` + `handlePlanFeedback` useCallback helpers that fire `{type:"raw_keystrokes",bytes:"1\r"}` and `{type:"raw_keystrokes",bytes:\`3${feedback}\r\`}` via `wsRef.current` (mirror `handleAsideDismiss`'s swallow-on-error shape, send bytes only per T-14-02-01 trust boundary), and supply `planPendingActive={planPending !== null}` to ComposeBox alongside `recycleActive={showOverlay}`; shipped `ComposeBox.plan-pending-disable.test.tsx` — a byte-for-byte mirror of `ComposeBox.recycle-disable.test.tsx` with the prop-name substitution — covering B1-B6 (Send-disabled-not-morphed, aux-buttons-disabled, textarea-typeable, Enter-swallow, baseline-sanity, draft-survives-transition) + C1-C4 (paperclip-usable, mic-usable, voice-transcript-lands-no-dispatch, Send-stays-disabled-after-transcript-lands) truth-table cases (10 tests, all pass).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-08-04T20:32:33Z
- **Completed:** 2026-08-04T20:38:00Z (approximate — recorded from execution flow)
- **Tasks:** 3 (2 auto tdd=false, 1 auto tdd=true; the tdd=true task's "test-first" posture is nominal because the prop it tests exists post-Task-1)
- **Files created:** 1
- **Files modified:** 2

## Accomplishments

### Task 1 — ComposeBox prop wire-up

- Added `planPendingActive?: boolean` to `ComposeBoxProps` interface at line 297. Docblock (16 lines) mirrors the recycleActive shape verbatim per CONTEXT § "Do NOT collapse", explaining WHY the three disable-mode props stay independent (asideActive morphs Send; recycleActive + planPendingActive keep Send-as-Send but disabled).
- Added `planPendingActive?: boolean` to `QueuedRowProps` interface at line 2376 with a docblock referencing the recycleActive parity.
- Destructured `planPendingActive` in both `ComposeBox` (line 326) and `QueuedRow` (line 2408).
- OR-in'd `planPendingActive` at every one of the 11 sites where `recycleActive` currently gates a disable predicate:
  1. `handleKeyDown` Enter-swallow early-return: `if (recycleActive || planPendingActive) return;` (L1395).
  2. `showPrimaryArmButton` gate: appended `&& !planPendingActive` (L1467).
  3. `showSlotArmButton` gate: appended `&& !recycleActive && !planPendingActive` — recycleActive was missing here too; this closes a pre-existing parity gap (L2473-2474).
  4. `sendDisabled` composite: appended `planPendingActive === true ||` clause (L1500).
  5. Reset button `disabled=`: appended `|| planPendingActive === true` (L1637).
  6. ThumbsUp button `disabled=`: appended `|| planPendingActive === true` (L1859).
  7. Recap button `disabled=`: appended `|| planPendingActive === true` (L1889).
  8. QueuedRow parent JSX pass-through: added `planPendingActive={planPendingActive}` sibling prop (L1933).
  9. Queued-row Paperclip `disabled=`: appended `|| planPendingActive === true` (L2627).
  10. `handleVoiceSend` primary dispatch guard: extended to `if (!recycleActive && !planPendingActive)` (L1188).
  11. `handleVoiceSend` slot dispatch guard: extended to `if (!recycleActive && !planPendingActive)` (L1201).
- Left the primary textarea `disabled={primaryArmed}` UNCHANGED (textarea stays typeable — CONTEXT lock).
- Left the primary Paperclip `disabled={canSend === false || asideActive === true}` UNCHANGED (mic-available-when-composebox-disabled parity — recycleActive is intentionally NOT in this predicate, so planPendingActive is not either).
- Left the primary MicButton's disable gating UNCHANGED for the same reason.
- Send button visuals UNTOUCHED: no morph branch, aria-label stays "Send", paper-plane SVG preserved. `sendDisabled` composite (which now includes planPendingActive) is the sole effect — button stays as Send but disabled.

### Task 2 — ComposeBox.plan-pending-disable.test.tsx

- Created new file (322 lines) as a byte-for-byte mirror of `ComposeBox.recycle-disable.test.tsx` with the following substitutions:
  - `recycleActive` → `planPendingActive` in every prop assignment.
  - `describe` string: "recycleActive gating" → "planPendingActive gating".
  - `it` strings: prop-name substitution + "during recycle" → "mid-plan-approval" / "during the plan-approval window".
  - Docblock: substituted the recycleActive → planPendingActive story, kept the truth-table pinning + parity-bounty references.
- Cases (10 total, all pass):
  - **B1**: Send button disabled but NOT morphed (aria-label "Send", paper-plane SVG, no "Resume" button).
  - **B2**: reset + ThumbsUp + Recap aux buttons all disabled.
  - **B3**: textarea stays typeable (disabled=false + user-typed value persists).
  - **B4**: Enter key does NOT fire onSend (handleKeyDown early-return).
  - **B5**: baseline sanity — planPendingActive=false; Send fires normally on click.
  - **B6**: draft survives planPendingActive true→false transition.
  - **C1**: primary Paperclip renders + not-disabled during planPendingActive=true.
  - **C2**: primary MicButton renders + not-disabled during planPendingActive=true.
  - **C3**: completed voice transcript lands in textarea but does NOT auto-dispatch onSend.
  - **C4**: Send stays disabled after transcript lands (sendDisabled OR-in guard).
- **C5 slot-branch parity test deferred** per the same rationale used in `ComposeBox.recycle-disable.test.tsx`: fixture wiring for a slot-mounted mic driven end-to-end through the voice pipeline requires per-slot mic aria-label disambiguation + RecordingControls-inside-slot mounting that doesn't cleanly extend the current file's baseProps pattern. Guard is symmetric with primary branch (same `if (!recycleActive && !planPendingActive)` shape in both) and covered indirectly by `handleVoiceAppend`'s existing coverage in `ComposeBox.voice.test.tsx`.
- Test-run: `npx vitest run src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` → **10/10 passing**, ~5.3s.

### Task 3 — PrettyView wiring

- Widened `planPending` state declaration from `{planFilePath: string} | null` to `{planFilePath|null, planContent|null, contentError|null} | null` (matches Plan 03's widened `PlanPendingEvent` wire type).
- Extended state docblock with a Phase 24 stanza documenting: (a) the bubble now RENDERS the plan file contents plus [Approve]/[Feedback] buttons; (b) Approve fires `raw_keystrokes` with `"1\r"`, Feedback fires with `"3<text>\r"`; (c) both bypass ComposeBox's split-send because Ink Plan Mode does not recognize split-send as a keystroke selection (patch #67 verified 2026-07-18); (d) the widened inner shape has three render states (null-path → skip middle section, null-content-no-error → loading, non-null-error → error dim).
- Added `handlePlanApprove` useCallback (no dependencies — closure captures `wsRef` which is stable) that sends `{type:"raw_keystrokes",bytes:"1\r"}` when `wsRef.current.readyState === OPEN`. Mirrors `handleAsideDismiss`'s swallow-on-error shape verbatim.
- Added `handlePlanFeedback(feedback: string)` useCallback that sends `{type:"raw_keystrokes",bytes:` `` `3${feedback}\r` `` `}` same way. Both callbacks send `bytes` ONLY (no hostId / tmuxSession) — backend uses connection-captured `currentTmuxSession` per T-14-02-01 trust-boundary pattern (documented in Plan 03 SUMMARY).
- Updated `PlanPendingBubble` mount site to pass all 5 props from state: `planFilePath={planPending.planFilePath}`, `planContent={planPending.planContent}`, `contentError={planPending.contentError}`, `onApprove={handlePlanApprove}`, `onFeedback={handlePlanFeedback}`. Previous mount was zero-prop (`<PlanPendingBubble />`), now a full 5-prop render.
- Added `planPendingActive={planPending !== null}` sibling prop to `ComposeBox` invocation, immediately after `recycleActive={showOverlay}`. Comment documents the CONTEXT § "Do NOT collapse" rationale explicitly (Send-button behavior differs across the three modes) so a future reader doesn't try to merge the three flags.
- Regression: `npx vitest run src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` → 20/20 passing.

## Task Commits

Each task was committed atomically:

1. **Task 1: ComposeBox prop wire-up (interface + destructure + 11 OR-in sites)** — `355a79b` (feat)
2. **Task 2: ComposeBox.plan-pending-disable.test.tsx truth-table suite** — `1f1b1db` (test)
3. **Task 3: PrettyView widen state + mount bubble + raw_keystrokes handlers + planPendingActive supply** — `85ad648` (feat)

**Plan metadata:** _(see final commit below in State Updates section)_

## Files Created/Modified

- **Created:** `src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` (+322 lines) — vitest suite with 10 tests covering B1-B6 primary truth-table + C1-C4 mic/paperclip parity. Includes `MockMediaRecorder` + `navigator.mediaDevices` + `fetch` stubs (identical shape to `ComposeBox.recycle-disable.test.tsx`'s nested describe). C5 slot-branch parity test deferred with in-file rationale.
- **Modified:** `src/ui/features/pretty-view/ComposeBox.tsx` (+40/-9) — see Task 1 above for the full breakdown of the 11 OR-in sites, the interface additions on both ComposeBoxProps and QueuedRowProps, and the two destructure sites.
- **Modified:** `src/ui/features/pretty-view/PrettyView.tsx` (+76/-6) — planPending state widened; docblock stanza added; handlePlanApprove + handlePlanFeedback useCallback pair added adjacent to handleAsideDismiss; PlanPendingBubble mount updated with all 5 props; ComposeBox invocation gains planPendingActive sibling prop.

## Decisions Made

See frontmatter `key-decisions` for the full list. Summary of the load-bearing calls:

- **Closed a pre-existing consistency gap on `showSlotArmButton`** by adding both `!recycleActive` AND `!planPendingActive` (Rule 2 auto-add — the primary's `showPrimaryArmButton` gate already includes `!recycleActive`; the slot's did not; parity closes the gap). Documented in the deviations section below.
- **Extended `handleVoiceSend` guards in BOTH primary + slot branches** so a completed voice transcript during the plan-approval window lands in the textarea/slot but does NOT auto-dispatch. C3 test exercises the primary branch invariant directly; slot branch is symmetric with the primary and its dispatch guard is now covered by the same `if (!recycleActive && !planPendingActive)` shape.
- **Non-strict RED-first for the tdd=true test task**: the code the tests measure already exists after Task 1, so all 10 tests passed on first run. This matches the ComposeBox.recycle-disable.test.tsx precedent (same file family, same posture: tests are truth-table coverage for a shipped prop, not behavior-driving new-feature tests).
- **Extended docblock rather than replaced** on the PrettyView `planPending` state comment — preserves patch #63 provenance at the top, adds Phase 24 expansion as a chronological addition. Same convention as PlanPendingBubble.tsx's docblock (Plan 04 SUMMARY key-decisions).
- **Callback-out + parent-owns-transport** for `handlePlanApprove` / `handlePlanFeedback` — mirrors `handleAsideDismiss` shape verbatim so all WS-send helpers use the same `readyState !== OPEN` early-return + `try/swallow` posture. Easy to audit for trust-boundary violations (parent computes the payload; bubble never touches wsRef).

## Deviations from Plan

### Rule 2 (auto-add missing critical functionality) — showSlotArmButton parity gap closed

**Found during:** Task 1 Step 4.

**Issue:** The plan's Task-1 table lists `showSlotArmButton` as a target for `&& !planPendingActive` (parity with the primary's showPrimaryArmButton). Reading the existing code showed that `showSlotArmButton` did NOT include `!recycleActive` either — a pre-existing consistency gap. Both the primary and slot arm-idle buttons should be hidden when recycleActive is true (per CONTEXT § Compose-box disable), but only the primary gate enforced that; the slot's did not.

**Fix:** Extended the slot gate to include BOTH `!recycleActive` AND `!planPendingActive`:
```typescript
const showSlotArmButton =
  !asideActive &&
  !slotArmed &&
  slotHasText &&
  !recycleActive &&
  !planPendingActive;
```
This closes the pre-existing recycleActive gap AND adds the new planPendingActive gate in the same edit — natural parity fix per CONTEXT § "match recycleActive treatment".

**Files modified:** `src/ui/features/pretty-view/ComposeBox.tsx` (lines 2473-2474; +2/-0 within Task 1's overall diff).

**Commit:** `355a79b` (folded into Task 1's commit since the parity-add is textually inseparable from the planPendingActive add).

**User-facing impact:** None visible in the parallel plan-execution scenario (the recycleActive gap has been latent since quick 260803-05i's QueuedRow extraction; no report of a user reaching the slot arm-idle button during recycle because the mount gate is already narrow). This is a defensive fix.

### Non-deviation clarification — vitest `--reporter=basic` flag

**Found during:** Task 2 verify step.

**Issue:** The plan's automated verify includes `npx vitest run ... --reporter=basic 2>&1 | tail -40`. On the installed vitest 4.1.8, `--reporter=basic` errors out (`Error: Failed to load custom Reporter from basic`). This is a vitest version-drift issue in the plan's grep command, not a plan-content issue.

**Resolution:** Ran the same command without the `--reporter=basic` flag. Default reporter output is unambiguous: `Test Files 1 passed (1) / Tests 10 passed (10)`. Acceptance criterion "Vitest exits 0" is directly measurable (exit code 0) and passed.

**Files modified:** None (documentation-of-command-shape clarification; underlying test outcome is the load-bearing check).

---

**Total deviations:** 1 code deviation (Rule 2 parity fix on showSlotArmButton, folded into Task 1's commit); 1 command-shape clarification (vitest reporter flag).

**Impact on plan:** Plan executed essentially as written. The one Rule 2 auto-add tightens a pre-existing latent gap in the same edit that adds the new prop — the fix is smaller and more coherent than filing a separate quick.

## Issues Encountered

None material. Two small points worth surfacing for downstream planners:

- **Vitest `--reporter=basic` incompatibility with vitest 4.1.8.** Downstream plans that copy the same verify-grep shape should either drop the flag or use `--reporter=verbose` / `--reporter=default`. The `basic` reporter appears to have been removed or renamed in the 4.x line.
- **The `showSlotArmButton` recycleActive gap existed prior to this plan** (since quick 260803-05i's QueuedRow extraction). If any recycled-session-with-armed-slot scenario surfaces a bug involving a stuck arm-idle button, it was latent from that earlier quick; this plan's Task 1 closes it as a Rule 2 auto-fix.

## Testing

**Type-check:** `npx tsc --noEmit -p tsconfig.json` → 0 errors, exit 0 (repo-wide clean, after each task and after all three).

**New tests:**
- `npx vitest run src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` → **10/10 passing** (5.27s wall).

**Regression:**
- `npx vitest run src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` → **20/20 passing** (8.15s wall). Confirms the new prop's OR-in at every recycleActive site does not perturb any recycleActive-scenario invariant.

**Not run:** The full repo test suite. Task 1's changes are additive (`||` clauses appended to existing predicates); Task 3's changes touch state that is only read by the PlanPendingBubble mount + the ComposeBox prop pass. No other test file references `planPending`, `handlePlanApprove`, `handlePlanFeedback`, or the raw_keystrokes payload shape at the frontend.

## Threat Flags

None. Both plan-defined threats stay mitigated as designed:

- **T-24-05-01 (Tampering — raw_keystrokes send format):** Template-literal composition `` `3${feedback}\r` `` composes leading `3`, user text, and trailing `\r` into a single JS string that `JSON.stringify` escapes safely. Backend's `-l` flag on `tmux send-keys` prevents key-name interpretation of `\r` or `3`.
- **T-24-05-02 (Elevation of Privilege — user-driven disable bypass):** ComposeBox disables are defensive — the backend's raw_keystrokes handler (Plan 03) validates against connection-captured `currentTmuxSession` and ignores client-supplied hostId/tmuxSession. Even if a bug lets Send fire during planPendingActive, the resulting keystrokes just go into the pane along with whatever Ink is showing; they do not bypass the raw_keystrokes contract.

No new network endpoints, no new auth paths, no schema changes, no new trust boundaries introduced by this plan.

## Next Phase Readiness

Phase 24 is **complete** with this plan. End-to-end feature is wired:

- **Detection** (Plan 01): `plan-pending-parser.ts` fingerprint fixed for the pinned fleet Ink variant + `parsePlanFilePath` helper extracts the plan file path from the footer.
- **SFTP fetch** (Plan 02): `plan-file-fetch.ts` reads the plan file over the pane's existing SSH connection with path validation + 500KB cap.
- **Backend wire-up** (Plan 03): `plan_pending` WS frame widened to carry `{planFilePath, planContent, contentError}`; async fetch trigger with per-window cache + fail-closed stale-fetch guard; new `raw_keystrokes` handler writes via `tmux send-keys -l` in one shot (no split-send).
- **Bubble UI** (Plan 04): `PlanPendingBubble` expanded to 5-prop card with plan-contents section (4 render states) + Approve/Feedback footer + inline Feedback modal.
- **Compose disable + parent wiring** (Plan 05 — this plan): ComposeBox gets planPendingActive prop OR-in'd everywhere; PrettyView widens state, mounts bubble with 5 props, wires the two raw_keystrokes handlers, supplies planPendingActive to ComposeBox.

Ready for aesthetic review + live human-verify tick against a real pane with a live plan-approval prompt.

## Self-Check: PASSED

- FOUND: `/home/ubuntu/skynet/src/ui/features/pretty-view/ComposeBox.tsx` (modified; contains `planPendingActive?: boolean` in both ComposeBoxProps + QueuedRowProps interfaces; 5 `|| planPendingActive === true` OR-clauses; `|| planPendingActive` sibling in Enter-swallow; `&& !planPendingActive` in showPrimaryArmButton + showSlotArmButton gates; QueuedRow parent pass-through present).
- FOUND: `/home/ubuntu/skynet/src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx` (created; 322 lines; 10 `it(...)` cases; references `planPendingActive` 22 times).
- FOUND: `/home/ubuntu/skynet/src/ui/features/pretty-view/PrettyView.tsx` (modified; `planContent: string | null` in state declaration; `handlePlanApprove` + `handlePlanFeedback` declared; `"raw_keystrokes"` referenced twice; `bytes: "1\r"` + `bytes: \`3${feedback}\r\`` template literals present; `planPendingActive={planPending !== null}` prop supplied to ComposeBox).
- FOUND: commit `355a79b` (feat(24-05): add planPendingActive prop to ComposeBox + OR-in at every recycleActive site).
- FOUND: commit `1f1b1db` (test(24-05): add ComposeBox.plan-pending-disable.test.tsx truth-table suite).
- FOUND: commit `85ad648` (feat(24-05): wire PrettyView — widen planPending state, mount PlanPendingBubble, raw_keystrokes handlers, planPendingActive to ComposeBox).
- Confirmed: `git log --oneline -5` shows all three commits at the tip of `feat/tab-title-from-tmux`.
- Confirmed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- Confirmed: `npx vitest run src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx` → 20/20 passing.

---
*Phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl*
*Completed: 2026-08-04*
