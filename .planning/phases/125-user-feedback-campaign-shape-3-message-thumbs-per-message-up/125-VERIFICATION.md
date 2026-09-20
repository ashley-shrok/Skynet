---
phase: 124-user-feedback-campaign-shape-3-message-thumbs-per-message-up
verified: 2026-09-20T05:19:00Z
status: passed
score: 54/54 D-XX decisions verified in shipped code
verification_method: goal-backward against CONTEXT.md's 54 D-XX decisions
executor_commits:
  - a11db573 feat(125-01)
  - c279a73e test(125-01)
  - 33c69024 docs(125-01)
  - 0729206d feat(125-02)
  - e74684a6 test(125-02)
  - 70383f42 docs(125-02)
cross_checks:
  tsc_noEmit: exit 0
  vitest_related: 632 tests / 38 files / 9 skipped / 1 todo — all passing
  files_changed_since_pre_phase_base: matches plan frontmatter exactly
  reuse_locks_intact: yes (RelayInboundBubble, WaitingBubble, AppShell, shape-1/2 files untouched)
---

# Phase 125: user-feedback campaign shape 3 — message thumbs — Verification Report

**Phase Goal (from CONTEXT.md § Phase Boundary):** Deliver per-message thumbs up + thumbs down on assistant bubbles in pretty-view chat with a coupled layout swap: on feedback-enabled deployments, the assistant bubble drops its in-bubble speak button and grows a below-bubble action strip carrying speak + thumbs-up + thumbs-down; on feedback-unconfigured deployments, render exactly as today. Reuse shape 1's `postFeedback`, `FeedbackModal` in `thumbs_down` variant, `useFeedbackEnabled` signal, and globally-mounted sonner toast. Zero shape-1 or shape-2 code changes.

**Verification method:** Goal-backward — for each of CONTEXT.md's 54 D-XX decisions, locate the concrete implementation evidence in the shipped code and confirm it's present + correct + at the right scope.

**Verified:** 2026-09-20T05:19:00Z
**Status:** PASSED
**Score:** 54/54 material D-XX decisions verified

---

## Summary Table — D-XX / Status / Evidence

### The coupled layout swap (D-01..D-03) — the load-bearing lock

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-01 | One signal (`useFeedbackEnabled()`) gates BOTH thumbs affordance AND assistant-bubble rendering mode | PASS | ChatMessage.tsx:147 declares `const feedbackEnabled = useFeedbackEnabled()`. Same variable gates: (a) outer wrapper flex-col+group at L484, (b) bubble padding branch at L507, (c) in-bubble speak render at L659 (`!feedbackEnabled &&`), (d) strip render at L758 (`feedbackEnabled &&`). One signal, four coupled decisions. |
| D-02 | Feedback OFF: assistant bubbles render exactly as today (in-bubble speak absolute right-6 bottom-6, `pr-[42px]`, no strip, no thumbs) — pixel-identical | PASS | ChatMessage.tsx:659-756 preserves the original in-bubble speak `<button>` verbatim (style `position:absolute; right:6; bottom:6`) inside the `!isUser && !feedbackEnabled &&` gate. L509 padding branch yields `pl-[12px] pr-[42px] py-[7px]` when `!isUser && !feedbackEnabled`. Outer wrapper at L484 stays `flex justify-start` (no flex-col, no group) when `!feedbackEnabled`. Test 1 asserts these invariants explicitly. |
| D-03 | Feedback ON: in-bubble speak DOM absent, bubble padding collapses to symmetric `pr-[12px]`, strip renders below the bubble | PASS | ChatMessage.tsx:659 gate omits the in-bubble button entirely when `feedbackEnabled`. L508 yields `pl-[12px] pr-[12px] py-[7px]`. L758-935 renders the strip. Test 2 asserts all three. |

### Strip structure + visual (D-04..D-10)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-04 | Strip directly below the bubble, left-edge aligned, ~4px left indent | PASS | ChatMessage.tsx:484 sets `flex-col items-start` on outer wrapper; L771 strip has `pl-[4px]`. |
| D-05 | Icon order left-to-right: speak · thumbs-up · thumbs-down | PASS | ChatMessage.tsx:776/862/900 in that order. Test 2 asserts child ordering. |
| D-06 | All three icons share one button shell (same size/radius/bg/border/padding at rest) | PASS | All three strip buttons carry `className="pv-speak-btn hover:!opacity-100 hover:!bg-[rgba(0,0,0,0.42)] focus-visible:!opacity-100 active:scale-[0.92] [@media(hover:none)]:!opacity-[0.72]"` (L845, L892, L931) — same shared shell recipe. |
| D-07 | Strip resting opacity 62%; bubble/strip hover lifts to 100% | PASS | L771: `opacity-[0.62] group-hover:opacity-100 transition-opacity`. L484 sets `group` on outer wrapper so hovering bubble OR strip both trigger group-hover. |
| D-08 | Touch baseline: `@media (hover: none)` → 72% always-visible | PASS | L771 also carries `[@media(hover:none)]:opacity-[0.72]`. |
| D-09 | Vertical gap ~4-6px between bubble and strip | PASS | L771: `mt-[4px]`. |
| D-10 | Volume2/ThumbsUp/ThumbsDown from lucide-react, ~14-16px icons in ~24-28px shells | PASS | L5 imports `ThumbsUp, ThumbsDown, Volume2, Loader2, Pause, Play` from `lucide-react`. All icons rendered at `size={16}` (L747, L849, L894, L933). Shell size inherited from `.pv-speak-btn` class hook (unchanged from shape 1 baseline). |

### Scope of the layout swap (D-11..D-14) — assistant bubbles ONLY

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-11 | ONLY assistant bubbles rendered by ChatMessage with role="assistant" get the swap | PASS | ChatMessage.tsx:484 and L758 both gate on `!isUser` (i.e., `role === "assistant"`). L505/507 gate the padding-swap branch on `!isUser && feedbackEnabled`. Verified by inspection + Test 8 (user role) + Test 2 (assistant role). |
| D-12 | RelayInboundBubble unaffected — keeps in-bubble speak, no thumbs, no strip, no swap | PASS | `git diff --name-only c050cc44..HEAD -- src/ui/features/pretty-view/RelayInboundBubble.tsx` → empty (file untouched). PrettyView.tsx L4047 invokes RelayInboundBubble without `onThumbsUp`/`onThumbsDown` props. Test 6 asserts no strip/thumbs testids present when a relay_inbound frame renders. |
| D-13 | WaitingBubble unchanged — no thumbs, no strip | PASS | `git diff` shows WaitingBubble.tsx untouched. PrettyView.tsx L4148 invokes WaitingBubble without thumbs props. Test 7 asserts no strip/thumbs testids. |
| D-14 | User bubbles unchanged (role="user" and pending-send optimistic variant) — never get thumbs | PASS | ChatMessage.tsx:484/507/659/758 all gate on `!isUser`, so `role === "user"` bypasses the entire strip/swap. Pending-sends map at PrettyView.tsx:4123 does NOT thread thumbs props (only role/content/pendingState/attachments). Verified by ChatMessage Test 8 + PrettyView Test 8. |

### Speak button state preservation (D-15..D-17) — all existing state carries into the strip

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-15 | ALL existing speak visuals preserved in the strip (Volume2/Loader2/Pause/Play + autoplay-armed hue tint) | PASS | Strip speak button glyph state ternary at L847-855 identical to in-bubble at L746-754 (`loading→Loader2 spin`, `playing→Pause`, `paused→Play`, else `Volume2`). L833-840 preserves `autoplayArmed ? "hsla(var(--pv-id-hue),60%,70%,0.28)" : "rgba(0,0,0,0.28)"` background + matching border. |
| D-16 | ALL existing speak interactions preserved (long-press 500ms, 10px drift cancel, tap onSpeakClick, speak-singleton) | PASS | Strip speak button at L779-821 duplicates in-bubble handlers verbatim: `onPointerDown` (500ms setTimeout at L785-790), `onPointerMove` with 10px drift check at L797, `onPointerCancel/Up` at L802-813, `onClick` calling `onSpeakClick(e)` at L820. Uses the existing `startSpeak`, `onSpeakClick`, `longPressTimerRef`, `pointerStartRef`, and `speak-singleton` module state — no duplication of that layer. |
| D-17 | Autoplay-armed identity-hue tint applies to strip's speak button verbatim | PASS | Strip speak at L833-840: `background: autoplayArmed ? "hsla(var(--pv-id-hue),60%,70%,0.28)" : ...` — same recipe as in-bubble version. |

### Thumbs-up behavior (D-18..D-22)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-18 | One tap → `postFeedback({ kind: "thumbs_up", userNote: "", messageRef, exchangeText })` fires | PASS | ChatMessage.tsx:869-874 fires `onThumbsUp?.(eventId)`. PrettyView.tsx:1084-1118 defines `handleThumbsUp` which computes exchangeText inline and fires `void postFeedback({ kind: "thumbs_up", userNote: "", messageRef: eventId, exchangeText })` at L1109. PrettyView Test 1 asserts payload shape. |
| D-19 | Toast `"Thanks — feedback sent."` with 2000ms duration | PASS | PrettyView.tsx:1115: `toast.success("Thanks — feedback sent.", { duration: 2000 })`. PrettyView Test 1 asserts `toast.success` called with exact text + duration object. |
| D-20 | Pressed thumb identity-hue fill at 100% opacity, overriding 62% resting weight | PASS | ChatMessage.tsx:879-891: pressed branch → `background: "hsla(var(--pv-id-hue),65%,55%,0.36)"` (D-20 tasting recipe verbatim) + `borderColor: "hsla(var(--pv-id-hue),70%,70%,0.45)"` + `opacity: thumbsUpPressed ? 1 : undefined`. Same recipe applied at L918-927 for thumbs-down. Tests 3/4 assert hue string in background style. |
| D-21 | Pressed state persists as long as message stays hydrated | PASS | ChatMessage.tsx:154: `useState<boolean>(false)` for `thumbsUpPressed` — component-scoped, resets on unmount (D-30). |
| D-22 | Second tap on pressed thumb is no-op (no callback, no state change, no visual flash) | PASS | ChatMessage.tsx:869-874: `if (thumbsUpPressed) return;` BEFORE any callback fire or `setThumbsUpPressed(true)`. Test 5 asserts single callback fire + stable background across two clicks. |

### Thumbs-down behavior (D-23..D-28)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-23 | One tap opens FeedbackModal in `variant="thumbs_down"` | PASS | ChatMessage.tsx:908-913 fires `onThumbsDown?.(eventId)`. PrettyView.tsx:1120-1153 sets `feedbackModalContext` state which drives `<FeedbackModal open={feedbackModalContext !== null} variant="thumbs_down" .../>` at L4515-4517. Test 3 asserts the dialog opens after thumbs-down click. |
| D-24 | Modal does NOT quote message back to user | PASS | FeedbackModal.tsx D-11 lock (unchanged from shape 1): line 26 comment "message being reacted to is NOT rendered back to the user in [the modal]". Shape 3 uses the same modal without adding a quote surface. |
| D-25 | Modal Send OR modal dismiss both fire exactly ONE email (submit → typed note, dismiss → empty note); each fires toast | PASS | PrettyView.tsx:4521-4530 `onSubmit`: `postFeedback({ kind: "thumbs_down", userNote, ...})` + `toast.success(...)`. L4532-4544 `onDismissWithoutSubmit`: `postFeedback({ kind: "thumbs_down", userNote: "", ...})` + `toast.success(...)`. Distinct `userNote` values ("typed" vs "") but both are single-fire paths (`postFeedback` called once per handler). PrettyView Tests 4/5 assert both paths fire exactly once with correct userNote. `onOpenChange(false)` at L4518 is a pure close (`setFeedbackModalContext(null)`) — no additional POST there, so no double-fire risk. |
| D-26 | Pressed state fires on tap (before modal opens), same visual as thumbs-up | PASS | ChatMessage.tsx:908-913: `setThumbsDownPressed(true)` runs BEFORE `onThumbsDown?.(eventId)`. Same style ternary at L918-927 as thumbs-up (hue fill 65/55/0.36 + hue border 70/70/0.45 + opacity 1). Test 4 asserts pressed-state background applied after single click. |
| D-27 | Toast fires after modal closes (either path) | PASS | PrettyView.tsx:4529 (submit path) and L4540 (dismiss path) both fire `toast.success("Thanks — feedback sent.", { duration: 2000 })`. Tests 4/5 assert. |
| D-28 | Already-pressed thumbs-down tapped again while modal closed: no-op, does NOT reopen modal | PASS | ChatMessage.tsx:908-913: `if (thumbsDownPressed) return;` before firing `onThumbsDown`. Since the callback is what triggers modal-open (via `setFeedbackModalContext`), skipping the callback prevents modal reopen. ChatMessage Test 6 asserts single callback fire on double-tap. |

### Both-thumbs semantics (D-29)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-29 | Both thumbs-up AND thumbs-down allowed on same message, independently | PASS | Independent `useState` slots at ChatMessage.tsx:154 (`thumbsUpPressed`) and L155 (`thumbsDownPressed`); no cross-lockout in onClick logic (L869-874 checks only `thumbsUpPressed`; L908-913 checks only `thumbsDownPressed`). Test 7 asserts both callbacks fire once each and both buttons show pressed-state hue fill. |

### Persistence (D-30..D-31)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-30 | Pressed state in-memory only, resets on unmount; no server-side vote record, no cross-reload persistence | PASS | ChatMessage.tsx:154-155 uses `useState` scoped to the ChatMessage instance — resets on unmount naturally. No IndexedDB/localStorage/atom-persistence writes; no new backend routes (verified in D-43). Test 5/6 exercises the ephemeral in-session semantics via same-render state. |
| D-31 | No un-vote / cancel-my-thumb / edit-vote affordance | PASS | ChatMessage.tsx:869-874 and L908-913: pressed-state onClick short-circuits on `pressed === true` (D-22/D-28), so there is no code path that fires `setThumbsUpPressed(false)` or an "un-vote" postFeedback. No new prop, no unmount hook writing zeros. Verified by inspection. |

### Payload construction (D-32..D-35)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-32 | `messageRef` = the assistant's eventId | PASS | PrettyView.tsx:1112 uses `messageRef: eventId` in handleThumbsUp; L4526/L4537 uses `messageRef: feedbackModalContext.eventId` (which was set from the assistant's eventId in handleThumbsDown at L1150). eventId is threaded from ChatMessage.tsx:874 (`onThumbsUp?.(eventId)` where eventId came from PrettyView's `<ChatMessage eventId={m.eventId}>` at L4075). Tests 1/2/4/5 assert `messageRef` on the payload matches the eventId. |
| D-33 | `exchangeText` = markdown source of user turn + assistant reply; format planner's discretion | PASS | PrettyView.tsx:1105-1108 (and L1142-1145 mirror): `**User:**\n\n${priorUserContent}\n\n---\n\n**Assistant:**\n\n${assistant.content}` — labeled two-block with `---` separator per SUMMARY.md § "exchangeText format — recipe used". Tests 1/4/5 assert both user and assistant content present in exchangeText via `expect.stringContaining(...)` on both strings. |
| D-34 | ChatMessage accesses prior user turn via PrettyView's `effectiveMessages` — computed at PrettyView and threaded via callback | PASS | PrettyView.tsx:1084-1118 (handleThumbsUp) and L1120-1153 (handleThumbsDown) both walk `effectiveMessages` backward from the assistant message's index and select the first `m.type === "message" && m.role === "user"` entry. Uses `useCallback([effectiveMessages])` so the closure always sees the latest array. Discriminator `m.type === "message"` matches `MessageEvent.type` at claude-session-api.ts:43-46. |
| D-35 | Assistant with no prior user turn → assistant-only exchangeText | PASS | PrettyView.tsx:1105-1108 (and L1142-1145): if `priorUserContent === null` after the backward walk, emit `**Assistant:**\n\n${assistant.content}` alone (no user block). Test 2 asserts exchangeText for a lone assistant greeting contains the assistant content but does NOT contain `**User:**`. |

### Reuse locks (D-36..D-37) — no shape 1 or shape 2 changes

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-36 | ZERO changes to files under `src/backend/feedback/`, `src/ui/feedback/`, or `src/ui/features/pretty-conversations/` | PASS | `git diff --name-only c050cc44..HEAD -- src/backend/feedback/ src/ui/feedback/ src/ui/features/pretty-conversations/` → empty. AppShell.tsx also untouched. |
| D-37 | No new payload fields, no new backend routes, no new modal variants, no new toast primitives | PASS | Payload uses only existing shape-1 fields (`kind`, `userNote`, `messageRef`, `exchangeText`) — verified in PrettyView.tsx:1109-1114, L4523-4528, L4534-4539. No backend routes changed (D-43). `variant="thumbs_down"` at L4517 is a shape-1 variant. Toast is `toast.success` from `sonner` (globally mounted at src/main.tsx per SUMMARY.md) — no new toast primitive. |

### Wiring pattern (D-38..D-40)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-38 | Callback prop threaded from PrettyView through ChatMessage; PrettyView owns exchange-text + modal state | PASS | ChatMessage.tsx:101-102 declares `onThumbsUp?: (eventId: string) => void` and `onThumbsDown?: (eventId: string) => void`. PrettyView.tsx:4087-4088 threads `onThumbsUp={handleThumbsUp}` and `onThumbsDown={handleThumbsDown}` at the ChatMessage invocation site (and only there — grep confirms zero occurrences on RelayInboundBubble / RelayOutboundBubble / ImageBubble / MalformedBubble / WaitingBubble / pendingSends.map bubbles). |
| D-39 | `useFeedbackEnabled()` read at ChatMessage leaf per Pattern S-01 | PASS | ChatMessage.tsx:11 imports `useFeedbackEnabled`; L147 calls it inside the component body — leaf-level subscription, not threaded as a prop. |
| D-40 | Pressed state storage — planner picks; must reset when message unhydrates | PASS | ChatMessage.tsx:154-155: two `useState<boolean>(false)` slots at ChatMessage-instance scope. Component unmount tears down the state (D-30 satisfied for free). Option (a) per SUMMARY.md — matches ChatMessage's existing `speakState` pattern. |

### Non-goals (D-41..D-52) — verify NONE shipped

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-41 | No changes to shape 1's backend, payload contract, modal, toast, or enabled signal | PASS | `git diff` shows no files under `src/backend/feedback/` or `src/ui/feedback/` changed. Same as D-36. |
| D-42 | No changes to shape 2's general feedback button | PASS | `git diff --name-only c050cc44..HEAD -- src/ui/AppShell.tsx` → empty (shape 2's button lives there). |
| D-43 | No new backend routes or endpoints | PASS | `git diff` shows zero files under `src/backend/` changed by this phase. |
| D-44 | No "your reactions" history surface | PASS | No new files/components introduced; no persistence of vote history anywhere (D-30 verified). |
| D-45 | No cross-session or server-side vote records | PASS | ChatMessage.tsx pressed state lives in `useState` only — resets on unmount. No fetch/POST writes vote records; `postFeedback` is the shape-1 fire-and-forget which does NOT persist a vote record (per shape 1's email-out-only stance). |
| D-46 | No un-vote, cancel, or edit-vote affordance | PASS | Same as D-31 — no code path that flips `pressed` back to false. |
| D-47 | No filtering thumbs by content type | PASS | ChatMessage.tsx:758 renders the strip for every `!isUser && feedbackEnabled` branch regardless of `content` shape (text/code/images/attachments all take the same render). |
| D-48 | No rate limiting or spam throttling | PASS | No throttle/debounce logic added to thumbs handlers or `postFeedback` — verified by inspection of ChatMessage.tsx:869-874 and PrettyView.tsx:1084-1118. |
| D-49 | No production keyboard shortcut for firing thumbs | PASS | No `useEffect(() => document.addEventListener("keydown", ...))` added; thumbs fire only from button `onClick` (L873, L912). |
| D-50 | No telemetry / click analytics / vote-rate measurement | PASS | No new analytics/telemetry imports in ChatMessage.tsx or PrettyView.tsx (verified via grep). |
| D-51 | No animation on strip appearance beyond CSS defaults | PASS | Strip uses `transition-opacity` (L771) for the hover-lift — that's the CSS default per the plan. No @keyframes, no framer-motion, no explicit `motion.div`. |
| D-52 | No differentiator styling on strip vs current speak button visual weight | PASS | All three strip buttons share the same `.pv-speak-btn` class hook (L845/892/931) — same shell recipe as the pre-existing in-bubble speak button. |

### Test scope (D-53..D-54)

| D-XX | Decision | Status | Evidence |
|------|----------|--------|----------|
| D-53 | 11 test cases across the two files | PASS | See enumeration below. All 11 cases + intentional overlap coverage + defensive edge cases (T-125-05 mitigation) shipped. |
| D-54 | Test file location — planner picks | PASS | Two colocated files: `ChatMessage.feedback-thumbs.test.tsx` (D-53 cases 1-7 + defensive #9) and `PrettyView.feedback-thumbs.test.tsx` (D-53 cases 8-11 + T-125-05 mitigation). Mirrors the existing `.speak.test.tsx` / `.autoplay.test.tsx` colocated-test naming convention. |

### D-53 test-case enumeration (11 cases, mapped to actual tests)

| D-53 case | Description | Test file / name | Status |
|-----------|-------------|------------------|--------|
| 1 | Feedback OFF rendering (in-bubble speak, pr-[42px], no strip, no thumbs) | ChatMessage.feedback-thumbs.test.tsx Test 1 | PASS |
| 2 | Feedback ON rendering (strip with 3 peers in order, pr-[12px]) | ChatMessage Test 2 | PASS |
| 3 | Thumbs-up flow (postFeedback fires, correct kind + messageRef + exchangeText, toast fires, pressed-state) | ChatMessage Test 3 (callback+pressed) + PrettyView Test 1 (postFeedback payload + toast + exchangeText both sides) | PASS |
| 4 | Thumbs-down open + submit (modal opens in thumbs_down variant; submit fires postFeedback with kind + userNote; toast; pressed persists) | ChatMessage Test 4 (callback+pressed) + PrettyView Test 3 (open) + PrettyView Test 4 (submit fires with typed userNote + toast + modal closes) | PASS |
| 5 | Thumbs-down open + dismiss (dismiss fires postFeedback with empty userNote; toast; pressed persists) | PrettyView Test 5 (close-X path fires empty-userNote payload + toast + closes) | PASS |
| 6 | Second-tap no-op (no second fire, no state change, no toast) | ChatMessage Test 5 (thumbs-up) + Test 6 (thumbs-down) | PASS |
| 7 | Both-thumbs allowed (two separate fires, both pressed) | ChatMessage Test 7 | PASS |
| 8 | RelayInboundBubble unaffected | PrettyView Test 6 | PASS |
| 9 | WaitingBubble unaffected | PrettyView Test 7 | PASS |
| 10 | User bubble unaffected (feedback ON or OFF) | ChatMessage Test 8 (leaf angle) + PrettyView Test 8 (tree angle) — intentional overlap | PASS |
| 11 | exchangeText carries prior user turn for normal exchange; carries assistant-only for D-35 edge | PrettyView Test 1 (normal exchange has both) + PrettyView Test 2 (no prior turn has no "**User:**" prefix) | PASS |

**Bonus coverage** (not required by D-53 but shipped):
- ChatMessage Test 9: `eventId=undefined` is a defensive no-op (guards against D-32 misuse).
- PrettyView Test 9: prior-turn lookup skips an interposed `relay_inbound` frame (T-125-05 threat mitigation).

### Cross-cutting cross-checks

| Check | Command | Result |
|-------|---------|--------|
| TypeScript clean | `npx tsc --noEmit` | exit 0 |
| Vitest related pass | `npx vitest related --run` on all four shape-3 files | 632 tests / 38 files passed, 9 skipped, 1 todo — no regressions in sibling suites |
| Files changed match plan | `git diff --name-only c050cc44..HEAD` | Only `ChatMessage.tsx`, `ChatMessage.feedback-thumbs.test.tsx`, `PrettyView.tsx`, `PrettyView.feedback-thumbs.test.tsx`, and the two SUMMARY.md docs — matches plan frontmatter `files_modified` exactly |
| Reuse locks intact | `git diff --name-only c050cc44..HEAD -- src/ui/feedback/ src/backend/feedback/ src/ui/features/pretty-conversations/ src/ui/AppShell.tsx src/ui/features/pretty-view/RelayInboundBubble.tsx src/ui/features/pretty-view/WaitingBubble.tsx` | empty — all reuse-locked files untouched |
| No debt markers | `grep -nE "TBD\|FIXME\|XXX"` on all four shipped files | zero matches |
| postFeedback call count | `grep -c postFeedback src/ui/features/pretty-view/PrettyView.tsx` | 4 (1 import + 3 distinct call sites: thumbs_up, thumbs_down submit, thumbs_down dismiss) — matches plan acceptance |
| No extracted helper | `grep -c computeExchangeText src/ui/features/pretty-view/PrettyView.tsx` | 0 (Option A — inline computation preserved) |
| Toast fires (PrettyView) | `grep -c "toast.success" src/ui/features/pretty-view/PrettyView.tsx` | 3 (thumbs_up, thumbs_down submit, thumbs_down dismiss) |
| ChatMessage doesn't fire postFeedback | `grep -c postFeedback src/ui/features/pretty-view/ChatMessage.tsx` | 1 (only in a documentary comment, no import, no call) |
| ChatMessage doesn't fire toast | `grep -c "^import.*toast\|toast\\." src/ui/features/pretty-view/ChatMessage.tsx` | 0 (only a pre-existing "auto-toast" documentary comment matches broad grep, no import) |

### Concerns

**None.** Every material D-XX decision has clear evidence in the shipped code. The two intentional planner-discretion picks (D-20 pressed-state hue recipe → tasting recipe `hsla(var(--pv-id-hue),65%,55%,0.36)`; D-33 exchangeText format → labeled two-block with `---` separator) are documented in the SUMMARY files and match implementations verbatim. No stubs, no debt markers, no missing wiring, no scope creep, and no shape-1/shape-2 file changes.

**Minor documentary note (not a gap):** Both SUMMARYs note "task ordering ran impl-first, test-second" instead of strict TDD RED-first. This is documented as a deliberate deviation because the tests target testids that are the impl's own DOM contribution — RED-first would degenerate to typing the impl twice. This is a process observation, not a correctness gap for the phase goal.

---

## VERIFICATION PASSED

**54 of 54 material D-XX decisions verified in shipped code.**

The load-bearing coupled dual-mode rendering lock (D-01..D-03) holds: one `useFeedbackEnabled()` signal gates the strip render, the layout swap, the bubble padding pocket, AND the in-bubble speak button presence — all four decisions are downstream of the same variable, verified by direct code inspection at ChatMessage.tsx:147/484/507/659/758.

Scope constraints (D-11..D-14) hold: only ChatMessage's assistant-role branch renders the strip; RelayInboundBubble, WaitingBubble, and user bubbles are structurally excluded, verified by both the render-path gates and the PrettyView prop-threading site (`onThumbsUp`/`onThumbsDown` appear ONLY at the ChatMessage invocation, never on RelayInboundBubble/RelayOutboundBubble/ImageBubble/WaitingBubble/pendingSends bubbles).

Speak-button state preservation (D-15..D-17) holds: the strip's speak button duplicates every glyph state, every interaction handler, and the autoplay-armed identity-hue tint verbatim from the in-bubble version, minus the `position: absolute` positioning.

Payload construction (D-32..D-35) holds: `messageRef` = eventId; `exchangeText` = labeled two-block for normal exchanges, assistant-only for the no-prior-user-turn edge case; discriminator uses `m.type === "message"` matching `MessageEvent.type` at claude-session-api.ts:43-46; T-125-05 mitigation (skip relay_inbound frames in prior-turn walk) is enforced by the type-narrowing filter and exercised by a dedicated test.

Reuse locks (D-36..D-37, D-41..D-42) hold: `git diff` since the pre-phase base (`c050cc44`) confirms zero changes to `src/backend/feedback/`, `src/ui/feedback/`, `src/ui/features/pretty-conversations/`, `src/ui/AppShell.tsx`, `src/ui/features/pretty-view/RelayInboundBubble.tsx`, or `src/ui/features/pretty-view/WaitingBubble.tsx`.

Non-goals (D-41..D-52) hold: no new payload fields, no new backend routes, no new modal variants (only `variant="thumbs_down"`), no un-vote surface, no telemetry, no rate limiting, no keyboard shortcut, no filtering-by-content-type, no differentiator styling — verified by inspection + `git diff` scope.

Test scope (D-53) holds: 11 required cases + 2 defensive bonuses across two colocated test files, 18 total `it(...)` cases, all green. Broader `vitest related` regression run reports 632 tests / 38 files passing with zero regressions in colocated sibling suites.

TypeScript compilation is clean (`npx tsc --noEmit` exit 0).

Shape 3 is code-complete and ready for the end-of-arc deploy gesture on `feat/tab-title-from-tmux`.

---

_Verified: 2026-09-20T05:19:00Z_
_Verifier: Claude (gsd-verifier)_
