# Phase 68: compose-send-funnel — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 68-compose-send-funnel
**Areas discussed:** Button behavior when dormant, Funnel module location, Bubble render for canned dispatches

---

## Button behavior when session is dormant

| Option | Description | Selected |
|--------|-------------|----------|
| A | No visual change — button clicks, funnel handles it, user sees nothing until bubble appears or fails | |
| B | Immediate optimistic bubble covers the wake-then-send interval — same UX as typing + Enter on the main text area | ✓ |
| C | Button-local pending state (dim/spin) for the interim, no bubble until Claude accepts | |

**User's choice:** B
**Notes:** Recommendation reasoning: B reuses the mental model users already have — click any send affordance, bubble appears. Consistency across the 5 triggers is the whole point of this phase; treating thumbs-up/recap differently reintroduces the fragmentation the phase is removing. Reset stays bubble-less because render-blacklisted, so B handles that case correctly for free. User agreed without pushback.

---

## Where the funnel module lives

| Option | Description | Selected |
|--------|-------------|----------|
| A | New standalone module (e.g., `src/ui/features/pretty-view/compose-send-funnel.ts` or `useSendMessage.ts`) — imported by ComposeBox and all button handlers | |
| B | Hook co-located inside `ComposeBox.tsx` — extracted from `handleSend` but stays in the same file | ✓ |

**User's choice:** B
**Notes:** All 5 send-triggers live in ComposeBox. Standalone module gives zero external consumers today, buys nothing testability-wise (tests still drive through the rendered ComposeBox), adds import ceremony. If a future feature ever adds a send-trigger OUTSIDE ComposeBox, extraction is a mechanical refactor at that point. Don't design for that hypothetical. User agreed.

---

## Bubble render for canned dispatches (thumbs-up / recap)

| Option | Description | Selected |
|--------|-------------|----------|
| A | Bubble text = send text verbatim — funnel is dumb; bubble shows literal "thumbs up" and "/explain the current situation" | |
| B | Special-render override — funnel takes optional `bubbleTextOverride`; thumbs-up passes "👍" (or icon), recap stays verbatim | ✓ |

**User's choice:** B
**Notes:** My initial recommendation was A (funnel purity, transcript = user perception). User pushed back with the load-bearing counter-argument (2026-09-02, verbatim): *"there's no reason to render the words thumbs up optimistically and then have it transform into a thumbs up emoji after that, or icon, or whatever it is."* The shipped bubble for thumbs-up transforms into a 👍 icon in the final rendered form; the optimistic bubble should match the final form from the start rather than showing "thumbs up" and then flipping to 👍. Final-form-drift argument > funnel-purity argument. Selected B.

---

## Claude's Discretion

- The specific predicate that replaces `disabled={canSend===false}` for thumbs-up/recap — researcher figures out from `canSend`'s definition and adjacent transport-state props.
- Exact hook name (`useComposeSend`, `useSendFunnel`, `useDispatchMessage`) — pick during planning.
- Whether the `bubbleTextOverride` parameter is required for thumbs-up as a positional arg or lives in a per-caller options object — cosmetic API choice.
- How the reset-wake fix is verified — via the in-process test alone, or by an additional targeted assertion on the WS message shape. Planner's call.

## Deferred Ideas

- **System-initiated sends** (WIP-restore replays, agent-relay forwards, session-recycle bootstrap prompts) — explicitly out of scope per shape file; these aren't user-driven and have different invariants.
- **Attachment handling refactor** — stays per-caller; only main-textarea has attachment branching. Funnel is send-transport only.
- **Draft persistence refactor** — stays per-caller (reset has `clearAfterSend()`, main-textarea has its own text state).
- **Bubble render-blacklist logic** — stays as-is in the render layer.
- **Extracting funnel into standalone module** — considered and rejected for this phase; revisit only if a future send-trigger appears outside ComposeBox.
