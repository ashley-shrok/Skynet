# Phase 68: compose-send-funnel — Context

**Gathered:** 2026-09-02
**Status:** Ready for planning

<domain>
## Phase Boundary

A universal send-funnel for the PrettyView compose box. Every user affordance that inserts characters and submits them to a Claude session — the main text area, the queued-message text areas, the thumbs-up canned dispatch, the recap canned dispatch, and the reset command — routes through one common helper that wakes the session if dormant, dispatches the text to Claude, and (unless the payload is render-blacklisted) seeds an optimistic bubble via the existing Phase 50 mqid pattern.

Rule of thumb from the user, verbatim: *"does it enter characters into the Harness Compose box and submit it?"* If yes → funnel. No exceptions for slash commands, canned dispatches, reset, queued sends.

**Fixes bundled by this phase:**
1. Queue-slot sends produce no optimistic bubble (Phase 50 out-of-scope).
2. Thumbs-up and recap produce no optimistic bubble.
3. Thumbs-up and recap are disabled-when-dormant — a legacy artifact from when dormant panes required a dedicated wake-up button before any interaction. Both become enabled-when-dormant with wake routing.
4. Reset button drops `/id reset` into bare bash on dormant sessions instead of waking first. Root-cause hypothesis (unproven, absorbed by the refactor): the reset send omits the `messageQueueItemId` field because it calls `onSend(payload)` without an mqid, and the backend's Phase 56 invisible-wake gate silently treats mqid-less sends as non-pretty-view. Routing reset through the funnel means it inherits mqid generation and the payload shape matches.

</domain>

<decisions>
## Implementation Decisions

### Send-funnel API shape
- **D-01:** The funnel is a **hook co-located inside `src/ui/features/pretty-view/ComposeBox.tsx`**, extracted from the current `handleSend`. Not a standalone module. All 5 send-triggers live in ComposeBox; there are zero external consumers today, and extraction to a separate file would add import ceremony without payoff. If a future feature ever adds a send-trigger outside ComposeBox (architecturally unlikely — ComposeBox IS the compose box), extraction is a mechanical refactor at that point.
- **D-02:** The funnel takes an **optional `bubbleTextOverride`** parameter. If provided, the optimistic bubble renders `bubbleTextOverride` instead of the send text. Rationale: the shipped bubble for thumbs-up transforms into a 👍 icon in the final rendered form; the optimistic bubble should match the final form from the start rather than showing "thumbs up" then flipping to 👍. Recap does NOT use the override — its bubble text = send text verbatim.
- **D-03:** The funnel plumbs an mqid through **even for render-blacklisted payloads** (like reset). The backend wake gate needs the pretty-view submit shape; render-blacklist is honored by the render layer downstream, not by suppressing mqid at send time.

### Dormant-session button behavior
- **D-04:** Thumbs-up and recap are **NO LONGER disabled when the session is dormant**. Clicking them triggers wake-then-send via the funnel. UX during the ~1-3s wake window is covered by the **immediate optimistic bubble** — same visual affordance as typing + Enter on the main text area. Reset stays bubble-less (render-blacklisted) but still routes through the funnel for the wake path.
- **D-05:** The `disabled={canSend===false}` gate on thumbs-up and recap gets removed/relaxed. Buttons should remain disabled only when transport is genuinely unavailable (not just because the session is dormant). Researcher/planner to figure out the exact predicate — dormant is NOT the same as "cannot send."

### Test coverage
- **D-06:** One **in-process test per trigger** locking the new behavior — 5 tests minimum (main textarea, queue-slot, thumbs-up, recap, reset) covering: bubble seeded (or blacklisted correctly for reset), wake fires when dormant, dispatch reaches Claude. Style matches existing Phase 50 in-process tests.

### Claude's Discretion
- The specific predicate that replaces `disabled={canSend===false}` for thumbs-up/recap — researcher figures out from `canSend`'s definition and adjacent transport-state props.
- The exact hook name (`useComposeSend`, `useSendFunnel`, `useDispatchMessage` — pick during planning).
- Whether the `bubbleTextOverride` parameter is required for thumbs-up as a positional arg or lives in a per-caller options object — cosmetic API choice.
- How the reset-wake fix is verified — via the in-process test alone, or by an additional targeted assertion on the WS message shape. Planner's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (source of truth for the WHAT)
- `.planning/shapes/shape-compose-send-funnel.md` — full shape agreement from `/open`: philosophy, prior context per-trigger status table, scope edges, "what would make it wrong" invariants.

### Phase 50 prior art (bubble contract + watchdog design)
- `.planning/shapes/shape-optimistic-message-bubbles.closed.md` — Phase 50 shape file with the mqid contract, `pv-optim-<ts>-<rand>` namespace, PendingSend FIFO, signal-driven watchdog escalation. This phase INHERITS Phase 50's contract; do not redesign.
- `.planning/phases/50-optimistic-message-bubbles/50-01..04-SUMMARY.md` (if present) — exhaustive per-plan file breakdown for Phase 50.

### Phase 56 prior art (invisible-wake gate on backend)
- `src/backend/claude-session/claude-session-server.ts` L2070-2076 — the Phase 56 dormant-wake branch that the funnel's mqid-carrying sends must trigger. Sub-agent found the branch "doesn't technically gate on mqid presence" but reset (which omits mqid) doesn't wake — the exact mechanism is a hypothesis until execution verifies.

### Frontend surface (all touched by this phase)
- `src/ui/features/pretty-view/ComposeBox.tsx` — all 5 trigger handlers live here:
  - `handleSend` L1413–1534 (main textarea) — the reference implementation to extract.
  - `handleQueueSlotSend` L1348–1405 (queue-slot).
  - `handleQuickSend` L1790–1816 (thumbs-up L2378 wire, recap L2411 wire).
  - `dispatchResetPayload` / `handleResetSend` / `handleVoiceResetSend` L1735–1767 (reset).
- `src/ui/features/pretty-view/PrettyView.tsx` L1004 — WS message construction with conditional `messageQueueItemId`; the load-bearing site for the mqid-in-payload contract.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 50 mqid generator + PendingSend FIFO** — the `pv-optim-<ts>-<rand>` pattern in `ComposeBox.tsx:1502` and the `onOptimisticSend` seed at L1506. The funnel wraps and reuses these, not replaces.
- **Phase 50 pv-send-watchdog** — the signal-driven retry-Enter → full-resend → paste_send_failed escalation ladder. Funnel routes through it unchanged.
- **Phase 56 backend invisible-wake gate** — already handles dormant panes correctly for mqid-carrying sends; the funnel just needs to make sure every send carries an mqid.

### Established Patterns
- **`onSend(payload, mqid?)` callback contract** — the funnel's dispatch step is a call to `onSend`; PrettyView.tsx conditionally includes `messageQueueItemId` in the WS message when mqid is truthy. Funnel MUST always pass an mqid (even for blacklisted-render sends) so the WS message shape is uniform and the backend wake gate fires.
- **Per-caller UI cleanup stays with the caller** — the current `handleSend` bakes together textarea clearing, draft clearing, attachment branching, error state, focus. Funnel handles ONLY the send-transport (wake + dispatch + optional bubble seed). Each caller keeps its own input-clearing / error-display concerns.

### Integration Points
- **Render-blacklist for reset** — already exists somewhere in the render layer (needs research to locate exactly). Funnel does NOT know about it; render layer honors it. The funnel always seeds an optimistic bubble via `onOptimisticSend`, and the render layer decides whether to actually show it based on the payload's blacklist status.
- **Thumbs-up render override** — new: funnel exposes `bubbleTextOverride`, thumbs-up caller passes it, the optimistic-bubble render layer respects the override. Recap does not use it.

</code_context>

<specifics>
## Specific Ideas

- **User's rule of thumb, verbatim** (2026-09-02): *"does it enter characters into the Harness Compose box and submit it? Like, it's that simple. It doesn't matter if it's a slash command, a reset command, a thumbs up, something from the text areas of the Compose box, you know, it's all that stuff."*
- **User's reset-bug repro** (2026-09-02): *"after I hit the reset button on one of the sessions, I waited a while and was confused why it wasn't resetting. So then I went and looked at the actual terminal, and I saw that the ID reset command had just been entered into the bash."*
- **User's disable-when-dormant framing** (2026-09-02): *"regarding the thumbs up and the recap being disabled uh i mean that's just something that needs to be fixed because that was an artifact from when a dormant session wasn't interactable at all and there was a dedicated wake up button that you had to hit first but that hasn't been there in a while and so it seems like those just got missed"*
- **User's thumbs-up-render argument** (2026-09-02, verbatim): *"there's no reason to render the words thumbs up optimistically and then have it transform into a thumbs up emoji after that, or icon, or whatever it is."* → this is the load-bearing rationale for D-02's bubbleTextOverride.

</specifics>

<deferred>
## Deferred Ideas

- **System-initiated sends** (WIP-restore replays, agent-relay forwards, session-recycle bootstrap prompts) — explicitly out of scope per the shape file. These aren't user-driven affordances; they have their own paths and different invariants (e.g., WIP-restore replays should NOT wake dormant sessions — they're catch-up). Leave alone.
- **Attachment handling refactor** — stays per-caller; only main-textarea currently has attachment branching. Funnel is send-transport only.
- **Draft persistence refactor** — stays per-caller. Reset has a `clearAfterSend()` on the persisted draft; main-textarea has its own text state. Funnel doesn't touch either.
- **Bubble render-blacklist logic** — stays as-is in the render layer. Funnel plumbs mqid through for all sends; render layer honors blacklist for reset.
- **Extracting the funnel into a standalone module** — considered and rejected for this phase (D-01). Revisit only if a future send-trigger appears outside ComposeBox.

None from cross-reference-todos — the todo scan returned zero matches for phase 68.

</deferred>

---

*Phase: 68-compose-send-funnel*
*Context gathered: 2026-09-02*
