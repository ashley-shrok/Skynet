# Phase 97: Room-case chrome and lifecycle should match session-case except where deliberately case-branched — Phase 93 UAT polish arc - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

> **Seeded from shape file** per `/build` convention. The shape file (`.planning/shapes/shape-phase-93-uat-polish-arc.md`) captures the why/what/philosophy/scope through a `/open` conversation with Alice (2026-09-10, greenlit `thumbs up` same session; included a design tasting for the meter chrome that converged on "simple slotted drawer"). Every user-facing decision — meter treatment, placeholder copy, URL identifier shape, philosophy, scope edges, deferred split-out candidate — is locked in the shape file. This CONTEXT.md is the discuss-phase artifact translating those shape decisions plus prior-phase carryover (Phase 93 CONTEXT) into a form downstream agents (researcher, planner) can act on without re-asking. **Read the shape file first; this file is the actionable extract.**
>
> Discussion was intentionally short because /open + the tasting already extracted every meaningful gray area. The workflow's "skip assessment when no meaningful gray areas remain" rule applies: what's left is diagnostic (for the researcher to trace) and plumbing (for the executor to implement), not user-facing implementation choices Alice needs to decide on.

<domain>
## Phase Boundary

Address the 7 findings from Alice's UAT walkthrough of the just-shipped Phase 93 (relay rooms use the chat surface). The two-source chat surface delivered by Phase 93 is architecturally settled; this arc fills in the case-branches Phase 93's architecture always required but didn't yet make. The philosophy is "no accidental inheritance" — the room case should feel identical to the session (harness) case except where we've deliberately case-branched. Nothing changes in the harness case (regression floor); nothing changes about the overall two-source architecture; the surface's shape stays what Phase 93 shipped.

**What ships here (in scope, per shape):**
1. Loading-veil dismissal signal wired to the room case's "messages loaded" signal (currently the veil stays up permanently in the room case).
2. Drag-and-drop split-view participation for the room case — both directions (room as drop target, room-showing surface as drag source), INCLUDING whatever shared-state corruption is causing plain-session split-view to break after a room has been opened at least once (user observation: a full page reload clears the issue).
3. ComposeBox in the room case: input vertical space restored to parity with the session case; ghost gutter on the left removed by reflowing the layout when the hidden attach affordance is not present; the top-edge affordance (the "cue a message" button that sits on the input's top edge) given the vertical headroom it needs.
4. Participant-indicator (`MultiBadgeAnchor`) inner gap tightened; current setting reads as too wide because the session case's outer gap is being repeated between indicators. Halve the gap direction.
5. Meter chrome for each agent participant: the "simple slotted drawer" treatment — meter's top edge tucks behind the pill's bottom, rounded bottom-only corners, pill's existing drop-shadow lands on the drawer to reinforce the layering. Working prototype at the arc bounty; the drawer HTML/CSS in the tasting page is the visual pattern to match.
6. ComposeBox placeholder copy in the room case: `"message room"`.
7. URL persistence for the currently-open room, using the room's opaque stable identifier (the room's Matrix room ID). Readability of the URL is explicitly not a concern.

**What does NOT ship (out of arc, per shape):**
- The room's list-item appearance in the conversation list (Alice noted it looks identical to a plain terminal session with no identity — adjacent, separate thread).
- The latency of rooms appearing in the conversation list at all (pre-existing outstanding issue).
- Any architectural change to the two-source chat surface itself.
- Any change to the session-case chrome or behavior. Regression floor.

</domain>

<decisions>
## Implementation Decisions

Every user-facing decision on the 7 findings is locked in the shape file. This section extracts each into a form the planner can slice against, with pointers back to the shape for detail. **D-XX numbering is fresh for this phase; where a decision is a direct carry-over from Phase 93 CONTEXT, that's noted.**

### Philosophy (locked, load-bearing)

- **D-01: No accidental inheritance.** Any place the room case still looks or feels different from the session case in a way we did NOT deliberately case-branch is a bug. Alice 2026-09-10 verbatim: *"relay sessions should feel no different other than the deliberate changes we have made, like removing certain buttons and things like that. So to the user, they don't have a concept of a harness or the relay backing what they're looking at."* This is the reviewer's yardstick at `/close` time.

- **D-02: Every case-branch is deliberate.** If a fix introduces a case-branch in a place the philosophy said should be parity, that's a divergence to justify (or roll back), not a stylistic freedom to exercise. The room case doesn't get its own aesthetic; it inherits the session case's aesthetic everywhere except the explicit branches.

### Loading veil (finding 1, blocker)

- **D-03: The room case gets a loading veil, same as the session case — signal is what changes.** Room messages take enough perceived time to arrive that a veil DOES make sense (Alice confirmed during discussion). The bug is that the veil never dismisses. Fix: wire the veil's dismissal to the relay adapter's "messages loaded" signal, whatever that ends up being.

- **D-04: The exact "messages loaded" signal is diagnostic — researcher traces it.** The relay adapter (Phase 93 Slice 3) currently exposes an `isReady` flag defined as "flips true when the first participants frame arrives" (see Phase 93 `AgentBadgeWithMeter` / `MultiBadgeAnchor` code comment). Whether the veil should dismiss on that same participants-arrived signal, or on a stronger first-history-batch-received signal, or on first-message-painted, is a technical question. The harness case's veil dismisses on something specific in the harness adapter — mirror that pattern in the relay adapter. Researcher: trace the harness veil signal; identify the relay-adapter equivalent; note any timing gap between "adapter exposes ready" and "veil dismisses."

### Drag-and-drop split placement (finding 2, blocker — deferred-split candidate)

- **D-05: Both directions must work.** Dragging a session onto a room-showing surface splits (does not replace). Dragging a room-showing surface into an empty split slot opens the room in that slot. The room-showing surface participates in the drag-and-drop system as a first-class drop target AND drag source, on parity with the harness case.

- **D-06: The shared-state corruption is in scope.** After a room has been opened, plain-session split-view is disturbed until a full page reload. This corruption is IN scope for this arc — the fix must address it, not just the specific-cases-that-fail symptoms. Alice's observation is the diagnostic hypothesis: the room-showing surface may be leaving the drag-and-drop system in a bad state (registration, listener wiring, dataTransfer contract, or similar).

- **D-07: This item is the deferred-split candidate.** If diagnosis at plan-phase reveals that fixing D-05 + D-06 requires a structural reshape of how the drag-and-drop system registers surfaces (rather than fitting as a case-branch fill-in), this finding splits out of Phase 97 into its own follow-up phase and the other six ship without it. Threshold is a plan-phase call, not fixed here. Planner: sequence this item's discovery task FIRST so the split-out decision surfaces early.

### ComposeBox chrome (finding 3, polish)

- **D-08: The ghost attach-padding gutter comes from reflow that didn't happen.** When the attach affordance was hidden monolithically in Phase 93 D-11, its horizontal footprint (padding, gap, container space) stayed reserved. The fix is to reflow the layout so the hidden button doesn't occupy space at all — not to explicitly zero-out reserved space with negative offsets. Reflow, not zeroing.

- **D-09: Text-input vertical parity.** The input area's vertical height in the room case should match the session case. Whatever is compressing it in the room case (likely a knock-on from D-08's ghost gutter, or a separate case-branch that wasn't case-branched cleanly) gets identified and undone.

- **D-10: The top-edge affordance gets its vertical headroom.** The "cue a message" button that sits on the top edge of the input is being clipped for lack of room above the input in the room case. The container needs enough vertical padding-top to accommodate that affordance. Match the session case's headroom.

### Participant-indicator gap (finding 4, polish)

- **D-11: Halve the inner gap between indicators.** Current `gap-2` (8px) between `MultiBadgeAnchor`'s cells is the session case's OUTER spacing repeated between multiple indicators. The multi-indicator INNER gap should be tighter — halve it to `gap-1` (4px) as a direction. Executor may fine-tune based on the actual visual result.

### Meter chrome (finding 5, polish — design tasting completed)

- **D-12: Pull-out drawer, "simple slotted" variant.** The meter that hangs below each agent indicator gets chrome that reads as a drawer peeking out from behind the pill (the identity indicator). Specific treatment (chosen by Alice in the tasting, 2026-09-10):
    - Drawer's top edge tucks 6–10px behind the pill's bottom.
    - Drawer's bottom corners are rounded; top corners are squared/tucked.
    - Drawer background stays the current dark meter-well palette (not hue-tinted; Variant B "hue-tinted" was rejected in favor of A "simple slotted").
    - The pill's existing drop-shadow lands on the drawer, cementing the "pill is in front" layering.
    - The 12-segment amber/green/red bar + reset button inside the drawer stays byte-identical to the current meter shape.

- **D-13: Prototype is the visual pattern to match.** Reference implementation lives at the arc bounty: `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html`, Variant A. The CSS there is the source of truth for tuck depth, corner-radius, and drawer chrome.

### ComposeBox placeholder copy (finding 6, polish)

- **D-14: Placeholder in the room case reads `"message room"`.** Not the addressees' names, not a longer sentence, not blank — just `"message room"`. Alice 2026-09-10 verbatim: *"it should probably just say room, like message room, I guess."*

### URL persistence (finding 7, lifecycle miss)

- **D-15: The URL records the currently-open room's opaque Matrix room ID.** Readability of the URL is explicitly not a concern — Alice 2026-09-10: *"the readability doesn't matter."* An opaque room ID is stable across room renames, unambiguous across similarly-named rooms, and matches what the frontend already has in the tab's session model.

- **D-16: URL shape and history behavior match the session case's pattern.** Whatever URL pattern the harness case uses for session tabs (path segment vs query param, push vs replace on switch), the relay case uses the equivalent. This is a "match existing session behavior" carry, not a design decision. Researcher: identify the current session URL routing pattern; mirror it in the relay case with the room ID as the identifier.

### Claude's Discretion

- Executor decides exact drawer geometry within the visual pattern locked by D-12/D-13 (e.g., 6px vs 8px vs 10px tuck depth is a fine-tune from the prototype). Reviewer at `/close` verifies the drawer READS as pulled from behind the pill; exact numbers below that threshold are executor's call.
- Executor decides the exact reflow mechanism for D-08 (flex-order change, conditional-render vs conditional-hide, layout restructure). Any approach that removes the ghost gutter without reintroducing a new one is acceptable.
- Planner decides waves + slicing. There are no shared-file conflicts between findings 3/4/6 (they touch distinct compose/badge/placeholder concerns) so parallel slicing is possible; findings 1 and 7 touch adapter/routing plumbing and may want ordering. Finding 2 is a discovery-first sequence-front task.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (READ FIRST)
- `.planning/shapes/shape-phase-93-uat-polish-arc.md` — the full shape agreement from `/open`. Every decision in this CONTEXT.md derives from that shape. Also names the philosophy verbatim, the "what would make it wrong" list (the reviewer's checklist at `/close`), and the tempting-but-no scope guards.

### Prior phase context (direct architectural predecessor)
- `.planning/phases/93-relay-rooms-use-the-chat-surface-one-surface-two-data-source/93-CONTEXT.md` — Phase 93's own CONTEXT (17 D-XX decisions). Phase 97 is a UAT-polish arc on Phase 93; every case-branch this phase adds is filling in a signal Phase 93 architected but didn't wire. Especially relevant: Phase 93 D-07 (discriminated-union source prop), D-08 (`source.kind` is THE case discriminator), D-10 (relay adapter absorbs `use-relay-room-stream`), D-11 (compose upper row + attach hidden monolithically when `source.kind === "relay"`).

- `.planning/phases/93-relay-rooms-use-the-chat-surface-one-surface-two-data-source/93-VERIFICATION.md` — Phase 93's goal-backward verification report; useful to see what was verified GREEN vs where the veil / drag-drop / URL / etc. were never actually asserted at close-time (the misses this arc is polishing).

### Design tasting artifact (locked reference for finding 5)
- `~/.claude/roles/box-maintainer/bounties/phase-93-uat-polish-arc/meter-tasting.html` — served at http://100.99.149.8:8899/meter-tasting.html on the arc's tailnet-serve. Variant A ("simple slotted drawer") is the locked reference. Executor implements the drawer chrome from the CSS in this prototype.

### Fleet-wide constraints (standing directives that apply)
- Role file `~/.claude/roles/box-maintainer/box-maintainer.md`: standing directives on logging (structured, boundaries, no `JSON.stringify` on DOM Event objects), test discipline (scoped during dev, full-suite + playwright smoke ship-gate only), executor scope (`git commit` + `tests green`, orchestrator handles deploy motion), no worktrees, multi-identity `git pull --rebase` before push, streaming does not exist anywhere ever.

- Fleet directive on no accidental inheritance is philosophically new (not previously in a role-file line, but locked in this shape file's philosophy section) — the reviewer at `/close` time verifies this on every finding.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/ui/features/pretty-view/PrettyView.tsx`** — the shared chat surface. Case-branches internally on `source.kind`. Every finding except 2 (drag-drop) and 7 (URL) has a fix that lives here or in a component this file composes.
- **`src/ui/features/pretty-view/ComposeBox.tsx`** — compose box. Findings 3 (vertical fit) and 6 (placeholder) live here. `mode="relay"` prop (Phase 93 D-11) hides the attach button + upper row monolithically; the ghost gutter is the un-reflowed knock-on from that hide.
- **`src/ui/features/pretty-view/MultiBadgeAnchor.tsx`** — multi-badge row. Finding 4 (gap tighten) lives on the flex-row-reverse container class here (`ROOT_ANCHOR_CLASS`, currently `gap-2`).
- **`src/ui/features/pretty-view/AgentBadgeWithMeter.tsx`** — the badge + meter cell. Finding 5's drawer chrome lives on the meter-well container's parent (the `data-appendage="true"` div, currently `mt-1 flex flex-row items-stretch gap-0`). The drawer is a new wrapper around this appendage, styled to tuck behind the badge.
- **`src/ui/features/terminal/IdentityBadge.tsx`** — the pill primitive. Read-only; the drawer positions RELATIVE to this pill, doesn't modify it. Note: `absolute top-4 right-5 z-[101]` inside its own `.rootClassName` means the pill positions itself absolutely inside its parent cell — this affects how the drawer's tuck works (see finding-5 diagnostic guidance).
- **`src/ui/features/pretty-view/sources/use-relay-adapter.ts`** — the relay adapter (Phase 93 D-10). `isReady` currently flips true when the first participants frame arrives. Finding 1's fix likely lives here (either extending the readiness contract or exposing a separate "messages loaded" signal) or in the veil consumer inside PrettyView.
- **`src/ui/features/pretty-view/sources/use-harness-adapter.ts`** — the harness adapter. Trace this to identify the harness-case veil signal; mirror it for the relay case.
- **`src/ui/shell/tabUtils.tsx`** — the dispatcher. Finding 7 (URL persistence) touches how relay tabs are represented in the tab model and URL routing. The current tab model has session URLs; needs a relay-case branch.
- **`src/ui/shell/SplitView.tsx`** — the drag-and-drop split system. Finding 2 (drag-drop) diagnosis and fix live in this file and whatever registration/state it holds.

### Established Patterns

- **`source.kind === "relay"` is THE case discriminator** (Phase 93 D-08). Every case-branch this arc adds uses that predicate. Do NOT sprinkle case-detection based on other fields; concentrate drift risk at one boundary.
- **Data over configuration** (Phase 93 D-17). Where a difference between cases can be expressed as data flowing through the store rather than a case-branch on rendering, prefer data. Applies especially to finding 1 (veil signal is data flowing from adapter → surface, not a conditional in the veil).
- **Optimistic-bubble on send** (Phase 93 D-14 + Phase 81 fleet rule). Not directly touched by this arc, but any adapter changes must preserve.
- **Structured logs at interaction/lifecycle/effect boundaries** (fleet directive). Adapters, veil dismissal, drag-drop registration, and URL routing are all lifecycle boundaries — instrument them with structured logs during this arc so future diagnoses have a forensic trail. NEVER `JSON.stringify` DOM Event objects.

### Integration Points

- Loading veil: currently exists inside `PrettyView.tsx` as some conditional. The dismissal signal is what needs case-branching (per D-04).
- URL routing: the tab model in `tabUtils.tsx` + wherever URL sync happens (likely a hook that reads/writes `window.history` from the tab set). Needs a relay-case branch to encode the room ID.
- Drag-drop: `SplitView.tsx` registers surfaces as drop targets; the relay-showing surface either isn't registering, or is corrupting the registry, or is failing the drop-target contract. Discovery task at plan-phase.

</code_context>

<specifics>
## Specific Ideas

- **Meter drawer prototype URL:** http://100.99.149.8:8899/meter-tasting.html (tailnet-served from t1000 during discussion). Variant A "simple slotted drawer" is the locked reference. Alice reviewed and picked live during the /open tasting.
- **Placeholder copy verbatim:** `"message room"` — Alice's phrasing.
- **URL identifier verbatim:** opaque Matrix room ID, readability explicitly not a concern.
- **Split-out on drag-drop:** if diagnosis at plan-phase shows structural reshape needed, this item drops out of Phase 97 and gets its own `/open`. The other six ship regardless.

</specifics>

<deferred>
## Deferred Ideas

- **Room list-item visual distinction from untied-terminal-session list-item.** Alice noted during discussion that in the conversation list, a relay-room row looks identical to a plain terminal-session row that has no identity. Adjacent thread, out of scope for this arc — worth its own bounty later.
- **Latency of rooms appearing in the conversation list at all.** Alice: *"they take a while, which is an outstanding issue."* Pre-existing, out of scope for this arc.
- **Reshaping the participant-indicator layout beyond the gap tighten** — not in scope for this arc; explicitly a tempting-but-no per shape.
- **Redesigning the meter beyond the drawer treatment** — not in scope; drawer picked in tasting is the whole meter answer.
- **Adding a room-case-specific compose affordance to replace the hidden attach button** — not in scope; the attach hide stays monolithic.
- **Broader refactor of the two-source surface** — architecture is settled, this arc only fills in case-branches.

</deferred>

---

*Phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc*
*Context gathered: 2026-09-10*
