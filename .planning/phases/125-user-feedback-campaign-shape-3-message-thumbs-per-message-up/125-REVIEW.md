---
phase: 124-user-feedback-campaign-shape-3-message-thumbs-per-message-up
reviewed: 2026-09-20T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/ui/features/pretty-view/ChatMessage.tsx
  - src/ui/features/pretty-view/ChatMessage.feedback-thumbs.test.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/PrettyView.feedback-thumbs.test.tsx
findings:
  blocker: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 125: Code Review Report

**Reviewed:** 2026-09-20
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Shape 3 code (per-message thumbs affordance) is correct on the happy paths and
faithful to the shape locks. The two blockers pre-caught by the revision loop
(`type === "message"` discriminator, `useCallback` stale-closure) are present and
correctly implemented — no re-flag. The fire-path plumbing at PrettyView is
straightforward and the inline exchangeText computation reads cleanly against the
D-33/D-34/D-35 spec.

The concerns below are all state-management edge cases around the PrettyView-scoped
`feedbackModalContext` state slot and two weak-assertion tests. No blockers; three
warnings; four info items.

## Warnings

### WR-01: `feedbackModalContext` not cleared on fresh-pane reset — stale eventId can post feedback against wrong session

**File:** `src/ui/features/pretty-view/PrettyView.tsx:2164-2222`
**Issue:** The fresh-pane reset block (paneKey change) resets `messages`, `status`,
`inactiveReason`, `errorMessage`, harness tasks, backgrounded agents/shells,
paneState, aside state, autoplay state, and every one of the six Phase 47
load-more slots. It does NOT reset `feedbackModalContext`.

Reachable sequence:
1. User opens conversation A, clicks thumbs-down on assistant message `a1`.
   `handleThumbsDown` fires: `setFeedbackModalContext({ eventId: "a1",
   exchangeText: "**User:**...**Assistant:**..." })`. Modal opens.
2. User switches to conversation B (paneKey changes) WITHOUT closing the modal
   first — same PrettyView instance stays mounted; only paneKey shifts.
3. Fresh-pane reset fires — messages are cleared to `[]`, but
   `feedbackModalContext` retains the conversation-A payload.
4. User types a note and clicks Send. `onSubmit(userNote)` fires
   `postFeedback({ kind:"thumbs_down", userNote, messageRef:"a1",
   exchangeText:"...(from conversation A)..." })` — a feedback record is now
   attributed to the wrong session, with an eventId that no longer exists in
   the current pane's transcript.

The blast radius is small (one mis-attributed feedback record per occurrence,
backend-side `messageRef` will fail any consistency check the operator might run)
but the invariant "feedback always references the pane the user was looking at
when they clicked" is broken silently. No error surface, no toast difference.

**Fix:** Add one line in the fresh-pane reset block alongside the other state
clears (near L2193 with the autoplay clears — same conceptual
"ephemeral-per-pane" bucket):

```tsx
setFeedbackModalContext(null);
```

**Severity rationale:** Warning, not Blocker: the failure mode is a stale
messageRef, not a crash, XSS, or data-loss for other users. But it is
correctness-affecting (D-32 makes eventId the messageRef — a stale eventId
violates the contract), reproducible with normal user gestures, and one-line to
fix.

---

### WR-02: Rapid thumbs-down on a different message replaces modal context without resetting the textarea — user's typed note attaches to the wrong exchange

**File:** `src/ui/features/pretty-view/PrettyView.tsx:1120-1153` (handleThumbsDown) + `src/ui/features/pretty-view/PrettyView.tsx:4515-4545` (modal mount) + `src/ui/feedback/FeedbackModal.tsx:103-108` (draft reset effect)

**Issue:** The ChatMessage-scope `thumbsDownPressed` local state disables the
button on the SAME message after the first tap. But if the user thumbs-down
message `A`, starts typing a note in the modal, then (without closing the modal)
clicks thumbs-down on a DIFFERENT message `B`:

1. Message B's local `thumbsDownPressed` is still `false` (independent
   ChatMessage instance) — click fires.
2. `handleThumbsDown` fires, computes B's exchangeText, and calls
   `setFeedbackModalContext({ eventId: "b1", exchangeText: "...B..." })`.
3. FeedbackModal's `open` prop stays `true` throughout — no false→true edge —
   so the `useEffect(() => if (open) setDraft("")..., [open])` at
   FeedbackModal.tsx:103-108 does NOT reset the draft.
4. User clicks Send — `postFeedback({ kind:"thumbs_down", userNote:<the
   note-typed-for-A>, messageRef:"b1", exchangeText:"...B..." })` — the
   user's opinion of A is now attached to B's feedback record.

Second-tap-no-op (line 909 `if (thumbsDownPressed) return;`) is per-message-
local, so it does NOT catch the cross-message case.

**Fix:** In `handleThumbsDown` (L1120), early-return if a modal is already open
so the user must complete-or-dismiss the current modal before starting another:

```tsx
const handleThumbsDown = useCallback(
  (eventId: string) => {
    if (feedbackModalContext !== null) return;  // modal already open — ignore
    // ...existing lookup + setFeedbackModalContext...
  },
  [effectiveMessages, feedbackModalContext],
);
```

The visual pressed-state on message B's button still applies (ChatMessage set
it before invoking the callback). That's fine — the user sees their tap was
"registered" but the modal doesn't swap payloads mid-note. Alternative fix: in
`handleThumbsDown`, always clear draft before opening the new context, which
means teaching FeedbackModal to reset draft on context change; the early-return
is simpler and matches the "one modal at a time" mental model.

**Severity rationale:** Warning, not Blocker: reachable, but requires a
non-obvious two-message gesture in quick succession. Failure mode is a
mis-attributed userNote — same correctness bucket as WR-01 (attribution
integrity) but harder to hit accidentally.

---

### WR-03: Test 7 (WaitingBubble) does not actually mount a WaitingBubble — assertion is vacuously true

**File:** `src/ui/features/pretty-view/PrettyView.feedback-thumbs.test.tsx:457-480`
**Issue:** Test 7 claims to verify "WaitingBubble renders no strip and no
thumbs even when feedback is ON" (D-53 case 9). The test body:
- Delivers zero messages to the WS stub.
- Waits 0ms.
- Asserts absence of the three thumbs-related testids.

`WaitingBubble` renders when `waitingFor !== null` (PrettyView.tsx L4148). The
test never triggers that state. The assertion "no strip on the surface" is
trivially true because no messages are rendered AT ALL — the assertion does not
distinguish "WaitingBubble correctly does not carry thumbs" from "no bubbles are
present." The test comment (L462-474) acknowledges this ("The absence-of-strip
assertion is what the D-53 case 9 test is actually protecting"), but the
assertion covers a superset that would pass even if WaitingBubble DID mistakenly
carry thumbs — the test would only fail if a rendering-mode-independent leak
existed somewhere else.

**Fix:** Either (a) drive `useSessionWaitingFor` to return a non-null value via
a mock (parallel to the existing `useFeedbackEnabled` mock), then assert that
a WaitingBubble-y element IS present AND thumbs testids are absent; or (b)
delete this test and document in Plan 02's SUMMARY that D-53 case 9 is verified
by inspection (WaitingBubble is a separate component; ChatMessage's thumbs
plumbing is impossible to leak into it structurally). Option (a) is stronger;
option (b) is honest.

**Severity rationale:** Warning, not Blocker: the shape-3 code is correct; this
is a test-integrity issue that would let a regression through if WaitingBubble
ever mounted a ChatMessage internally.

---

## Info

### IN-01: `handleThumbsUp` and `handleThumbsDown` bodies are near-duplicates — extracted helper considered and rejected but the rejection lives in a comment only

**File:** `src/ui/features/pretty-view/PrettyView.tsx:1084-1153`
**Issue:** The 34-line bodies of `handleThumbsUp` (L1084-1118) and
`handleThumbsDown` (L1120-1153) share ~26 lines of identical exchangeText
lookup + formatting. The comment at L1080-1083 states this is "Option A per
PLAN 125-02 — NO separately-extracted helper," and the rationale
("keeps [effectiveMessages] as the direct closure dependency and makes
exhaustive-deps analysis correct without indirection") is sound but weak — a
helper taking `(messages, eventId)` and returning
`{ found: boolean; exchangeText: string }` would keep exhaustive-deps happy and
cut ~26 lines. Not a bug; a maintainability item that will bite the next
person who has to modify the format (D-33) or the frame-type filter (T-125-05).

**Fix:** Consider (post-shape) extracting to a pure helper:
```tsx
function computeExchangeText(
  messages: StreamEvent[], eventId: string
): { assistant: Extract<StreamEvent, {type:"message"}> | null; exchangeText: string | null } { ... }
```

**Severity rationale:** Info — locked by shape as Option A, and the shape lock
does have merit for exhaustive-deps clarity. Flagging for the next maintainer.

---

### IN-02: `void postFeedback(...)` fire-and-forget with no error observability at the caller

**File:** `src/ui/features/pretty-view/PrettyView.tsx:1109-1115`, `4523-4529`, `4534-4540`
**Issue:** All three `postFeedback` invocations use `void postFeedback(...)`
followed by an unconditional `toast.success`. Per D-27, this is intentional —
`postFeedback` swallows errors, and the toast fires regardless of outcome. But
the client-side console has no signal that the POST failed beyond whatever
`handleApiError` logs inside `postFeedback`. If an operator asks "did shape-3
fire for user X's thumbs-up on message Y?", the only answer is "check the
backend log for the 202" — no client-side breadcrumb exists.

**Fix:** Optional — add a `.catch(() => {})` with an inline
`console.info("[feedback] fire kind=... messageRef=...")` before the toast for
operator forensics. Non-load-bearing; skip if the D-27 shape lock is strict.

**Severity rationale:** Info — behavior is per-spec, but observability is
weak enough to note for the next debug session.

---

### IN-03: ChatMessage.tsx thumb button `data-testid` values are stable but not documented in the component header

**File:** `src/ui/features/pretty-view/ChatMessage.tsx:770-934`
**Issue:** The strip and its three buttons carry stable testids
(`pv-chat-message-action-strip`, `pv-chat-message-speak`,
`pv-chat-message-thumbs-up`, `pv-chat-message-thumbs-down`). Both test files
depend on these. There is no header-level comment naming these as
"stable test attachment points — do not rename." The comment at L493-494 does
this correctly for `pv-bubble`. Same convention should apply here.

**Fix:** Add a one-line comment near the strip render (L770) noting that
the four testids are load-bearing for shape-3 tests. Non-load-bearing; a
maintainability nice-to-have.

**Severity rationale:** Info — no code correctness impact.

---

### IN-04: Test 6 (RelayInboundBubble) asserts only absence — does not verify the RelayInboundBubble actually rendered

**File:** `src/ui/features/pretty-view/PrettyView.feedback-thumbs.test.tsx:428-453`
**Issue:** Test 6 delivers a `relay_inbound` frame and asserts absence of the
three thumbs-related testids. It never asserts that the RelayInboundBubble
itself rendered. If a wire-format tweak silently broke `type === "relay_inbound"`
routing (say, a typo made every relay_inbound render as MalformedBubble), the
test would still pass — MalformedBubble also does not carry thumbs. The test
name (D-53 case 8) implies RelayInboundBubble is under test; the assertion
does not scope tightly to that component.

**Fix:** Add a positive assertion that some RelayInboundBubble-specific DOM
lands. RelayInboundBubble has no direct testid per the test comment (L442-445),
but the frame content "external msg" should be findable via `screen.getByText`
or a data-attribute selector. Alternative: add a stable
`data-testid="pv-relay-inbound-bubble"` on the bubble root and use it here.

**Severity rationale:** Info — test-strength issue, not a code bug.

---

## Structural Findings (fallow)

No structural findings block was provided by the workflow. This section is
retained for spec compliance; no cross-module structural findings from a
pre-pass are surfaced here.

---

## CODE REVIEW COMPLETE: 0 blockers / 3 warnings / 4 info

_Reviewed: 2026-09-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
