---
phase: 50-optimistic-message-bubbles
plan: 03
subsystem: frontend/pretty-view
tags: [compose-box, pretty-view, chat-message, identity-session-pane, optimistic-bubbles, pending-sends, mqid-threading, spinner, muted-red, blocker-4-fix]

# Dependency graph
requires:
  - phase: 50-01-PLAN.md
    provides: kind:"message" role:"user" WS frames for BOTH direct-user-turn AND queue-op-enqueue paths (single wire shape; frontend consumes uniformly for head-match)
  - phase: 50-02-PLAN.md
    provides: paste_send_failed + send_keys_error WS frames carrying an mqid; per-connection pendingMqidsForThisConnection cleanup on the backend so paired with this plan's frontend clearAllPendingSends
provides:
  - ChatMessage pendingState prop ('sending' | 'failed' | null) with trailing-edge Loader2 spinner + muted-red data-pv-bubble-failed styling
  - ComposeBox onOptimisticSend synchronous seed prop + overrideText / onOverrideTextConsumed ack-based repopulate surface + widened onSend(text, mqid?) signature
  - PrettyView pendingSends FIFO state machine (seed → head-match by content → 20s timer OR paste_send_failed OR send_keys_error → flipToFailed → composeOverrideText repopulate)
  - PrettyView latest-only render gate (D-04 iMessage-style — only newest 'sending' shows spinner; every 'failed' shows red)
  - IdentitySessionPane onSend widening + retirement of the pv-adhoc mqid generation (Blocker #4 root-cause fix)
  - Single-source mqid contract end-to-end: ComposeBox → onOptimisticSend seeds pendingSends[mqid] → onSend(text, mqid) → handleComposeSend(text, mqid) → parent onSend(text, mqid) → IdentitySessionPane forwards to pvSendInputRef(text+"\r", mqid) → backend armPvSendWatchdog(mqid) → paste_send_failed / send_keys_error frames carry SAME mqid → PrettyView.flipToFailed(mqid) matches
affects:
  - 50-04 (in-process end-to-end integration tests — will exercise the full send → parse → head-match → clear-spinner path OR the 20s-timer failure path OR the paste_send_failed / send_keys_error failure paths against the state machine this plan built)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies (Loader2 already in lucide-react; no new spinner lib)
  patterns:
    - "Optimistic-bubble state machine: parent-owned FIFO queue seeded synchronously with the send; head-matched by content equality on WS message frames; timer-driven OR frame-driven flip to failed; cleared on WS close + unmount"
    - "Ack-based one-way trigger: parent-set prop → child useEffect populates + fires ack callback synchronously → parent resets state slot on same tick (avoids repeated re-fire on unchanged references — Warning #6 pattern)"
    - "Single-source mqid contract: identifier generated once at the innermost caller (ComposeBox), forwarded unchanged through every layer, keyed uniformly on both sides of the WS. Blocker #4 fix by structural discipline (delete the second generation site) rather than by matching multiple identifiers"
    - "Latest-only visual gate: derivation via filter().at(-1) with strict identity comparison in the render loop; every non-latest 'sending' pending renders pendingState=null (plain), only the newest one renders 'sending' (spinner)"
    - "Content-collapse mirroring: PrettyView.collapseNewlinesForMatch mirrors ComposeBox.collapseNewlinesForSend byte-for-byte so head-match content equality stays consistent with the emitted payload (D-50 policy contract)"

key-files:
  created:
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
    - .planning/phases/50-optimistic-message-bubbles/50-03-SUMMARY.md
  modified:
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/ChatMessage.test.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.test.tsx
    - src/ui/features/pretty-view/ComposeBox.dormant-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.plan-pending-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.recycle-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.reconnecting-disable.test.tsx
    - src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx
    - src/ui/features/pretty-view/ComposeBox.voice.test.tsx
    - src/ui/features/pretty-view/ComposeBox.hold-to-mic.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.compose-send.test.tsx
    - src/ui/shell/IdentitySessionPane.tsx
    - src/backend/claude-session/claude-session-server.compose-send.test.ts

key-decisions:
  - "mqid pattern is 'pv-optim-<ms>-<random8hex>' with Math.random().toString(36).slice(2, 10).padEnd(8, '0') — the padEnd prevents the toString(36) occasional short-suffix case where the slice would yield 0-7 chars (which would break the regex-based FIFO ordering + break tests that assert the fixed-width shape)"
  - "20000ms timer chosen to match Plan 50-02's GIVE_UP_MS exactly (D-15 shared outer signal) — the frontend timer and the backend paste_send_failed emit fire at the same wall-clock boundary; whichever arrives first at flipToFailed does the state transition, the other becomes a no-op"
  - "flipToFailed is idempotent — the reducer's `p.state === 'sending'` guard means a second call for the same mqid (e.g., 20s-timer + paste_send_failed racing at ~T+20s) is a silent no-op that neither double-flips nor mutates already-failed state"
  - "handleOptimisticSend's immediateFailure:true path flips an EXISTING pending (from ComposeBox's first-call seed) rather than seeding a fresh record — this handles ComposeBox's dual-call pattern (seed then flip) cleanly and avoids a phantom 'sending' bubble that briefly renders before the immediateFailure call arrives on the same tick"
  - "collapseNewlinesForMatch mirrors ComposeBox.collapseNewlinesForSend byte-for-byte — if ComposeBox's collapse ever diverges (e.g., D-50 policy revision), the head-match content-string equality would silently no-op and every send would appear to be stuck on the spinner; keep the two in lockstep"
  - "Pending bubbles render AFTER confirmed messages in a SEPARATE .map() (not interleaved through appendDedup) — this preserves the existing appendDedupWithCap invariants + accessory-siblings layout in PrettyView.tsx and lets Task 3b's D-04 latest-only + failed-red rules live in a small self-contained render block"
  - "WS-close cleanup calls clearAllPendingSends (unlike unmount which does the same via useEffect return) — this is the load-bearing T-50-03-05 mitigation: an intermittent WS blip must not leave orphan 20s timers armed against dead-connection state that will never see a paste_send_failed frame"
  - "IdentitySessionPane's onSend callback still passes an mqid to pvSendInputRef even if the mqid arg is empty (mqid ?? '') — the backend's isPrettyViewSubmit gate treats empty mqid as 'not a pretty-view submit' and skips the split-send + watchdog arm, which is a safe no-op. This is defensive; production always has ComposeBox generating a pv-optim-<...> mqid"
  - "COMPOSE-04 sweep chose to REMOVE the string 'COMPOSE-04' from the primary HARD LOCK breadcrumb (replaced with 'prior HARD LOCK removed') — the strict grep -c 'COMPOSE-04' == 0 acceptance criterion conflicts with a breadcrumb comment that references the OLD identifier by name; per Plan 50-02 Deviation #1 precedent, the grep gate is honored and the breadcrumb uses descriptive language instead"

patterns-established:
  - "Ack-based one-way trigger (overrideText + onOverrideTextConsumed): a parent-to-child one-way data push where the child ACKs consumption synchronously in the same useEffect as it applies the value — pattern reusable for any parent-driven ephemeral prop where the parent needs a deterministic 'reset to null' opportunity"
  - "Single-source mqid discipline (Blocker #4 fix): generate identifiers at the innermost caller once, forward unchanged through every layer, key uniformly on both wire endpoints. Delete every intermediate generation site — the discipline is enforced structurally (via grep gates) rather than by manual identifier-matching audits"
  - "Latest-only visual gate via filter+at(-1): the derivation is a one-liner co-located with the render; no ref-mirror needed because it's derived from state directly and re-runs on every render; the strict-identity `p === latestSendingPending` comparison in the render loop is the O(1) hot path"

requirements-completed: []  # Phase 50 has no formal REQ-ID mapping per 50-CONTEXT.md; coverage is against D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-15, D-18, D-19, D-20, D-21 decisions

# Metrics
duration: ~45min
completed: 2026-08-20
---

# Phase 50 Plan 03: Frontend optimistic-bubble state machine Summary

**ChatMessage renders a trailing-edge spinner (sending) or muted-red border (failed); PrettyView owns a FIFO pendingSends queue seeded synchronously with ComposeBox's Enter press, matched by content on incoming user-role WS frames, flipped to failed by a 20s timer OR paste_send_failed OR send_keys_error frames; COMPOSE-04 HARD LOCK fully swept from ComposeBox; single-source mqid threads from ComposeBox through PrettyView → IdentitySessionPane → backend armPvSendWatchdog (Blocker #4 root-cause fix — pv-adhoc mqid generation retired).**

## Performance

- **Duration:** ~45 minutes
- **Started:** 2026-08-20T15:21:20Z
- **Completed:** 2026-08-20T16:06:59Z
- **Tasks:** 5 (Task 1 TDD, Task 2 TDD, Task 3a+3b combined GREEN, Task 4 fix)
- **Files modified:** 14 (source + test files)
- **Files created:** 2 (PrettyView.optimistic-bubbles.test.tsx + this SUMMARY)
- **Files deleted:** 0

## Accomplishments

- **Pressing Enter now renders a bubble immediately.** ComposeBox generates an mqid, seeds an optimistic PendingSend on PrettyView via onOptimisticSend synchronously with the WS write, and PrettyView renders the pending bubble on the same React frame. The COMPOSE-04 HARD LOCK ("no optimistic display") is fully reversed. Bubbles are always ONE of: (a) confirmed via signal or (b) in optimistic-with-spinner state waiting for signal — no third path per D-19.
- **Spinner clears on match.** A kind:"message" role:"user" WS frame arriving with matching (collapsed) content head-matches the oldest pending, removes it from state, AND clears its 20s timer. Consumes BOTH the direct-user-turn path AND the queue-op-enqueue-derived path from Plan 50-01 uniformly (same wire shape → same match rule; single-signal contract).
- **20s timer → red bubble + composebox repopulate.** flipToFailed marks the pending state:'failed', sets composeOverrideText to the pending's content; ComposeBox's overrideText useEffect populates the textarea AND fires onOverrideTextConsumed synchronously; PrettyView resets composeOverrideText back to null (Warning #6 ack pattern — no re-fire on subsequent parent re-renders).
- **paste_send_failed + send_keys_error WS frames flip immediately.** Both use flipToFailed(parsed.mqid, reason) — the mqid pass-through end-to-end is what makes the lookup succeed. Same outcome as the 20s timer path (red bubble + composebox repopulate) but fires the INSTANT the backend reports the failure.
- **Only the latest 'sending' pending shows the spinner (D-04 iMessage-style).** Older 'sending' pendings render plain; every 'failed' pending stays red regardless of position so the user sees every retry candidate.
- **D-05 invariant enforced structurally.** Once matched, a pending is REMOVED from pendingSends AND its 20s timer is cleared — there is no code path that can flip a matched (removed) pending back to failed.
- **Blocker #4 root-cause fix (Iteration 1 checker feedback).** IdentitySessionPane's `pv-adhoc-<uuid>` mqid generation at L268 is deleted. The ComposeBox-generated `pv-optim-<ms>-<random8hex>` mqid now threads unchanged through onSend → handleComposeSend → parent onSend → IdentitySessionPane → pvSendInputRef → backend armPvSendWatchdog. The paste_send_failed and send_keys_error frames carry the SAME mqid that PrettyView's flipToFailed lookup expects — the correspondence is now single-source. Task 3a Test 11 asserts this end-to-end.
- **Full-file COMPOSE-04 sweep (Blocker #3).** All 11 mentions of "COMPOSE-04" in ComposeBox.tsx are removed or replaced with Phase 50 D-01/D-18/D-19/D-20 breadcrumbs (`grep -c 'COMPOSE-04' src/ui/features/pretty-view/ComposeBox.tsx` returns 0). Load-bearing HARD LOCK block at L1281 says "prior HARD LOCK removed" and points to the new onOptimisticSend seam.
- **WS-close + unmount cleanup (T-50-03-05).** clearAllPendingSends iterates pendingSends, clears every timer, empties the array + composeOverrideText slot. Pairs with Plan 50-02's backend per-connection pendingMqidsForThisConnection cleanup so both sides release together on WS teardown.
- **Zero new dependencies.** Loader2 was already imported from lucide-react (existing speak-button use); no new spinner/anim library added. Muted-red color uses inline hsla values per D-06 Discretion (no new theme token).
- **Full-suite tests: 2708 pass** / 9 skip / 1 todo, exit 0 (up +28 from Plan 50-02's 2680 baseline — 6 ChatMessage + 5 ComposeBox + 17 PrettyView optimistic-bubbles = 28 new tests). Backend build + full frontend build both exit 0. tsc clean.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1 RED: ChatMessage pendingState tests** — `ef9780a3` (test)
2. **Task 1 GREEN: ChatMessage pendingState prop** — `f0173615` (feat)
3. **Task 2 RED: ComposeBox optimistic-bubble props + widened onSend** — `433a2897` (test)
4. **Task 2 GREEN: COMPOSE-04 sweep + onOptimisticSend + mqid + overrideText ack** — `28739e79` (feat)
5. **Task 3a+3b RED: PrettyView state machine + latest-only render tests** — `74f2bace` (test)
6. **Task 3a+3b GREEN: PrettyView pendingSends state machine + interleaved render** — `b8dfcdbe` (feat)
7. **Task 4: IdentitySessionPane forwards ComposeBox mqid; retire pv-adhoc** — `90b56b79` (fix)

Plan metadata commit follows this SUMMARY (final commit — includes SUMMARY.md + STATE.md + ROADMAP.md).

## Files Created/Modified

- `src/ui/features/pretty-view/ChatMessage.tsx` — extended props with `pendingState?: 'sending' | 'failed' | null` (defaults null for back-compat). Added `showSendingSpinner` + `showFailedBubble` derivations gated on `isUser`. Bubble root gains `data-pv-bubble-failed` attribute + inline muted-red border/tint (hsla(0,60%,55%,0.4) border, hsla(0,40%,50%,0.08) tint) when failed. Trailing-edge `<Loader2 h-3 w-3 animate-spin>` renders inside bubble root when sending (mutually exclusive with failed).
- `src/ui/features/pretty-view/ChatMessage.test.tsx` — appended 6 new tests in a new `describe("ChatMessage — pendingState")` block covering spinner render, no-spinner cases, failure styling, assistant-ignores-prop, mutual exclusivity.
- `src/ui/features/pretty-view/ComposeBox.tsx` — **full-file COMPOSE-04 sweep**: 11 mentions removed or replaced with Phase 50 D-* breadcrumbs (grep count → 0). Props interface widened: `onSend: (text, mqid?) => boolean` (Blocker #4 pre-req); new optional `onOptimisticSend?` + `overrideText?` + `onOverrideTextConsumed?` props. `handleSend` generates mqid once via `\`pv-optim-\${Date.now()}-\${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}\``; fires `onOptimisticSend?.({ payload, mqid, immediateFailure: false })` before `onSend(payload, mqid)`; on onSend-returned-false, fires a second `onOptimisticSend?.({ payload, mqid, immediateFailure: true })`. New `useEffect([overrideText, onOverrideTextConsumed])` populates textarea when overrideText transitions null→non-empty AND fires ack in same effect.
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — appended 5 tests in a new `describe("ComposeBox — optimistic bubble seeding")` block. Updated 3 pre-existing assertions from `toHaveBeenCalledWith("text")` → `toHaveBeenCalledWith("text", expect.stringMatching(/^pv-optim-/))` (D-23 adapt-not-delete).
- `src/ui/features/pretty-view/ComposeBox.{dormant-disable,plan-pending-disable,recycle-disable,reconnecting-disable,aside-morph,voice,hold-to-mic}.test.tsx` — updated 8 pre-existing assertions per D-23 adapt-not-delete. Voice reset-path (`/id reset (...)`) assertions kept single-arg because that path uses `dispatchResetPayload` (a separate single-arg onSend call site not touched by this plan).
- `src/ui/features/pretty-view/PrettyView.tsx` — widened `PrettyViewProps.onSend?: (text, mqid?) => boolean` + `handleComposeSend` forwards mqid. Added `PendingSend` type + `pendingSends` state + `pendingSendsRef` mirror + `composeOverrideText` state. Added `collapseNewlinesForMatch`, `flipToFailed`, `handleOptimisticSend`, `handleOverrideTextConsumed`, `clearAllPendingSends` callbacks. Extended `case "message"` with FIFO head-match by content for user-role frames (removes head-pending + clears timer on match). Added new `case "paste_send_failed"` and `case "send_keys_error"` branches that call flipToFailed(parsed.mqid, parsed.reason). Added clearAllPendingSends invocation in ws.onclose + useEffect return (unmount). Added `latestSendingPending` derivation + pendingSends.map() interleaved AFTER confirmed messages.map() with per-pending render gate (`'failed'` → failed; `'sending' && ===latest` → sending; else null). Wired new props to ComposeBox mount site: `onOptimisticSend`, `overrideText`, `onOverrideTextConsumed`.
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` (NEW, 762 lines) — 17 tests across 2 describe blocks: 13 state-machine tests (seed, match, mismatch, FIFO, 20s-timer, paste_send_failed, send_keys_error, immediateFailure, D-05 invariant, one-shot dedup, Blocker #4 end-to-end mqid, WS-close cleanup, onOverrideTextConsumed ack) + 4 render tests (latest-only spinner, failed always-red, insertion order, transition stability). Uses WS-stub scaffolding mirroring PrettyView.compose-send.test.tsx.
- `src/ui/shell/IdentitySessionPane.tsx` — onSend arrow function widened to `(text: string, mqid?: string): boolean`. DELETED `const mqid = "pv-adhoc-" + crypto.randomUUID();` at L268. Return line uses `send(text + "\r", mqid ?? "")` — the `?? ""` guards the defensive no-mqid case. Comment block updated with new mqid-source narrative and cross-reference to 50-03-PLAN.md.
- `src/backend/claude-session/claude-session-server.compose-send.test.ts` — renamed 3 test-string placeholders `"pv-adhoc-1"` → `"pv-test-mqid-1"` (test-file hygiene so the strict grep -rn 'pv-adhoc' src/ returns zero live-code hits).
- `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` — renamed 2 test-string placeholders `"pv-adhoc-abc"` → `"pv-test-mqid-abc"` (same hygiene).

## Decisions Made

- **mqid pattern uses padEnd(8, "0") on the random suffix.** `Math.random().toString(36).slice(2, 10)` occasionally yields 0-7 characters (when Math.random produces a value with fewer significant base-36 digits). Without padEnd the mqid could be `pv-optim-<ms>-abc` (3-char suffix) which breaks the regex `^pv-optim-\d+-[0-9a-z]{8}$` used in tests AND could confuse anyone reading the mqids in logs assuming a fixed width. padEnd guarantees the fixed 8-char shape.
- **20000ms client-side timer matches Plan 50-02's GIVE_UP_MS exactly.** Two independent code paths fire at ~T+20000ms: the frontend timer's `flipToFailed('client_timeout_20s')` and the backend's `paste_send_failed` emit. Whichever arrives first at flipToFailed does the state transition; the second becomes a no-op via the `p.state === 'sending'` guard in the reducer. Single outer signal path per D-15.
- **handleOptimisticSend's immediateFailure:true path FLIPS an existing record.** ComposeBox's D-20 flow calls onOptimisticSend TWICE per failed send: once with immediateFailure:false (pre-onSend), once with immediateFailure:true (post-onSend-returned-false). If we seeded a fresh record on the second call, we'd have TWO pending bubbles for the same send — visual glitch. Instead the second call finds the existing pending by mqid, cancels its 20s timer, marks it failed. Falls back to seed-as-failed only if the first seed was somehow missed (defensive; shouldn't happen in practice).
- **collapseNewlinesForMatch is a fresh helper (not imported from ComposeBox).** The two implementations are byte-identical — `replace(/\r?\n/g, " ")` — but they live in separate modules. This is intentional: PrettyView doesn't take a runtime dependency on ComposeBox's internals; the collapse policy is a shared contract (D-50) that both sides implement independently. If D-50 ever changes, BOTH implementations must be updated in lockstep. Cross-referenced in inline comments.
- **Pending bubbles render in a SEPARATE .map() block AFTER confirmed messages.map().** Interleaving into `appendDedup` would require weaving pendingSends into the messages array on every render — messy + would break the existing per-eventId dedup Set. Keeping pendings separate lets the render logic be a small self-contained block (Task 3b scope) and preserves all Phase-43+ layout invariants (data-pv-bubble wrapper, data-event-id witness, paddingBottom:9, accessory-siblings-below).
- **latestSendingPending derivation uses filter().at(-1), not a ref.** Derivation happens once per render; re-runs on every state change; O(pendingSends.length). Practical bound: ~10-20 pendings at most (user typing cadence × 20s window). Not a ref because refs are stale-closure-safe FOR HANDLER CLOSURES ONLY — the render code always reads fresh state directly.
- **IdentitySessionPane's onSend passes empty-string fallback (`mqid ?? ""`) rather than undefined.** The pvSendInputRef signature is `(text: string, mqid?: string) => boolean`; passing undefined would result in the backend receiving `messageQueueItemId: undefined` which JSON-serializes to omit the field entirely — the backend's `isPrettyViewSubmit` gate reads the field's presence, so this WOULD accidentally trip the split-send path with no mqid to key the watchdog under. Empty string is the safest no-op — the backend gate reads empty as "not a pretty-view submit" and skips arm.
- **COMPOSE-04 sweep DELETED the string from the primary breadcrumb.** The plan's Task 2 action text asked for a breadcrumb saying `"COMPOSE-04 HARD LOCK removed"` AND the acceptance grep required `grep -c 'COMPOSE-04' == 0`. Self-contradictory. Resolved by rewording the breadcrumb: `"Phase 50 D-18: prior HARD LOCK removed"` — grep gate honored (0 hits) + intent preserved. Same tension pattern as Plan 50-02 Deviation #1.
- **Test-file placeholder-string rename (`pv-adhoc-*` → `pv-test-mqid-*`).** Task 4 acceptance said `grep -rn 'pv-adhoc' src/` returns ZERO. Strict interpretation would fail on test files that arbitrarily use "pv-adhoc-1" as a mqid string. Renamed to a non-colliding placeholder so the audit gate is clean; the tests are byte-equivalent (the mqid string is just a label, not a semantic value).

## Deviations from Plan

None substantive — plan executed as written. Four minor procedural notes:

1. **Task 3a and Task 3b GREEN commits combined.** The plan called for separate commits (Warning #8 split into two tasks for review shape). Combined the GREEN commits because the state slots + WS handlers + render interleaving in PrettyView.tsx are TIGHTLY coupled: `latestSendingPending` derivation reads `pendingSends`, the render block reads both. Splitting into two commits would have left an intermediate commit where the state machine existed but the render was still empty — reviewable in isolation but semantically incomplete. The test file is combined too (17 tests across 2 describe blocks in one file). RED commit stays combined for the same reason. Both tasks are represented in the commit message body.

2. **COMPOSE-04 sweep grep gate vs. breadcrumb comment.** Documented above in Decisions Made. Same self-contradiction pattern as Plan 50-02 Deviation #1. Resolved by prioritizing the grep gate (0 hits) and rewording the breadcrumb.

3. **Task 4 pv-adhoc grep audit — expanded scope.** Task 4 acceptance required `grep -rn 'pv-adhoc' src/` returns ZERO across the WHOLE codebase. Two test files (unrelated to Task 4) used "pv-adhoc-1" and "pv-adhoc-abc" as arbitrary test-string placeholders (mqids for test purposes only, not runtime generation). Renamed them to "pv-test-mqid-*" to satisfy the strict grep. Recorded as procedural because these test-file changes weren't in the plan's `<files>` list for Task 4.

4. **Pre-existing test assertion updates spanned 6 additional ComposeBox test files.** The plan's Task 2 acceptance targeted three test files (ComposeBox.test.tsx + dormant-disable + plan-pending-disable). Running the full pretty-view suite surfaced regressions in 6 additional files (recycle-disable, reconnecting-disable, aside-morph, voice, hold-to-mic — plus the two voice-reset assertions that STAYED single-arg because they use dispatchResetPayload, a separate call site). Updated all per D-23 "adapt-not-delete" — the semantic assertion (onSend was called with the right text) is preserved; the extra mqid arg is matched via `expect.stringMatching(/^pv-optim-/)`.

## Issues Encountered

- **Math.random().toString(36).slice(2, 10) yields fewer than 8 chars sometimes.** Discovered when writing Test 5 (mqid format regex). The Math.random() value can be small enough that toString(36) produces a short string (e.g., "abc" instead of "abcdefgh"). The slice then yields whatever's left; a 3-char suffix like `pv-optim-1787239601000-abc` breaks the regex + could confuse log readers. Fixed with `.padEnd(8, "0")` — guarantees fixed-width shape without changing entropy meaningfully (an mqid that used to have 3 chars now has 3 chars + 5 "0"s; still uniqueness-comparable at the collision-avoidance level Phase 50 needs).
- **Voice-test (Test 13, 14) reset path is a SEPARATE single-arg onSend call site.** Initially updated their assertions to expect (text, mqid) — tests failed because dispatchResetPayload uses `onSend(payload)` (single-arg) and was NOT touched by Task 2 (which only widened handleSend's onSend call site). Reverted those two assertions to single-arg and documented inline that the /id reset path is separate. Not a bug — the reset path just doesn't participate in the optimistic-bubble threading.

## User Setup Required

None — no external service configuration required. Zero new dependencies. Zero new theme tokens.

## Next Phase Readiness

- **Plan 50-04 is unblocked.** Ready to write in-process end-to-end integration tests covering the 7 D-22 scenarios (happy path / queued path / failure path / retry-Enter path / full-resend path / latest-only / dedup). The frontend state machine + backend watchdog + parser emissions are all in place. Plan 50-02's `__resetPvSendWatchdogForTests` seam is exported for beforeEach state reset.
- **Wire protocol UNCHANGED.** The mqid threading discipline is now single-source (ComposeBox generates it; every layer forwards unchanged). paste_send_failed + send_keys_error frame shapes are byte-identical to Plan 50-02's emissions (this plan only ADDS consumer handlers).
- **The Blocker #4 correspondence fix is proven end-to-end.** Task 3a Test 11 mounts PrettyView, presses Enter, captures the mqid at the parent-onSend layer, simulates a paste_send_failed frame with that SAME mqid, and asserts the bubble flips to failed. Every layer of the chain is exercised.
- **Baseline test count for Plan 50-04:** 2708 passing tests (up +28 from Plan 50-02's 2680). Any Plan 50-04 additions add to this floor.

## Self-Check: PASSED

All claimed files exist:
- `.planning/phases/50-optimistic-message-bubbles/50-03-SUMMARY.md` — this file
- `src/ui/features/pretty-view/ChatMessage.tsx` — modified (pendingState prop + spinner + failed render)
- `src/ui/features/pretty-view/ChatMessage.test.tsx` — modified (6 new tests)
- `src/ui/features/pretty-view/ComposeBox.tsx` — modified (COMPOSE-04 sweep + new props + handleSend + overrideText useEffect)
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — modified (5 new tests + 3 assertion updates)
- `src/ui/features/pretty-view/ComposeBox.{dormant,plan-pending,recycle,reconnecting,aside-morph,voice,hold-to-mic}*.test.tsx` — modified (assertion updates only)
- `src/ui/features/pretty-view/PrettyView.tsx` — modified (state machine + WS branches + interleaved render + widened onSend + wired props)
- `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` — created (17 tests)
- `src/ui/features/pretty-view/PrettyView.compose-send.test.tsx` — modified (test-string rename)
- `src/ui/shell/IdentitySessionPane.tsx` — modified (widened onSend + pv-adhoc removed)
- `src/backend/claude-session/claude-session-server.compose-send.test.ts` — modified (test-string rename)

All claimed commits exist on `feat/tab-title-from-tmux`:
- `ef9780a3` test(50-03) RED for Task 1
- `f0173615` feat(50-03) GREEN for Task 1
- `433a2897` test(50-03) RED for Task 2
- `28739e79` feat(50-03) GREEN for Task 2
- `74f2bace` test(50-03) RED for Tasks 3a+3b
- `b8dfcdbe` feat(50-03) GREEN for Tasks 3a+3b
- `90b56b79` fix(50-03) for Task 4

Verification commands all pass:
- `node_modules/.bin/vitest run src/ui/features/pretty-view/ChatMessage.test.tsx` → 24/24 pass
- `node_modules/.bin/vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` → 58/58 pass
- `node_modules/.bin/vitest run src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx` → 17/17 pass
- `node_modules/.bin/vitest run src/ui/features/pretty-view/` → 66 files / 704 pass, exit 0
- `node_modules/.bin/vitest run src/ui/` → 116 files / 1515 pass, exit 0
- Full `node_modules/.bin/vitest run` → 203 files / 2708 pass / 9 skip / 1 todo, exit 0
- `npm run build:backend` → exit 0
- `npm run build` → exit 0
- `node_modules/.bin/tsc --noEmit` → exit 0
- `grep -c 'COMPOSE-04' src/ui/features/pretty-view/ComposeBox.tsx` → 0 (Blocker #3 full-file sweep verified)
- `grep -n 'Phase 50 D-18' src/ui/features/pretty-view/ComposeBox.tsx` → hits at multiple sites (breadcrumb sweep verified)
- `grep -n 'pendingState' src/ui/features/pretty-view/ChatMessage.tsx` → 4 hits (props type + prop default + derivation + render gate)
- `grep -n 'pendingSends\|handleOptimisticSend\|flipToFailed\|composeOverrideText\|handleOverrideTextConsumed' src/ui/features/pretty-view/PrettyView.tsx` → hits for all 5 identifiers
- `grep -n 'case "paste_send_failed"\|case "send_keys_error"' src/ui/features/pretty-view/PrettyView.tsx` → 2 hits
- `grep -rn 'pv-adhoc' src/` → only 2 comment-breadcrumb hits in IdentitySessionPane.tsx (permitted per success criteria; live-code generation removed)
- `grep -n 'Blocker #4\|Phase 50 D-01' src/ui/shell/IdentitySessionPane.tsx` → hits at comment block

---
*Phase: 50-optimistic-message-bubbles*
*Completed: 2026-08-20*
