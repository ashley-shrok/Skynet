# Phase 93: Relay rooms use the chat surface — one surface, two data sources - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 93-relay-rooms-use-the-chat-surface-one-surface-two-data-sources
**Areas discussed:** Multi-badge row placement, Retirement of the standalone pane, Source-prop shape, Message-list source integration

Discuss-phase followed a `/build → /open → /gsd:phase → /gsd:discuss-phase` chain the same session. The shape file (`.planning/shapes/shape-relay-room-pane-reuse-prettyview-pieces.md`) locked most of the phase's philosophy and scope edges via the `/open` grill. Discuss-phase surfaced four remaining implementation gray areas one-at-a-time. The first was RESOLVED BY CORRECTION rather than by option-select (my initial framing had the wrong mental model of where the harness pane's current badge lives; Ashley corrected me, and the correct model collapsed the gray area).

---

## Multi-badge row placement

Initially framed as a gray area choosing between (a) no participants row in harness or (b) a top-of-pane participants row with one badge in harness. Ashley corrected the framing:

**Ashley 2026-09-09 verbatim:** *"the current harness session pretty view has one badge in the upper right for whoever you're talking to, and the only differences that are going on here is that we are allowing multiple badges to be displayed if desired, which obviously in the cases of the harness and relay sessions would be used differently and so you have the one badge that's already there and every pretty view regardless of the session type is going to have at least that one badge but then you might also have more that grow left from where the original sits. And then some of them might have the context meters as well."*

**Correction adopted:** the extension is not a new top-of-pane participants row — it's an extension of the existing upper-right badge anchor to accept N badges growing leftward. Harness supplies one (visually unchanged); relay supplies many, with meters on the ones that need them.

**Notes:** I should have inspected the current harness pane's badge placement before framing the question. Standing directive "Look at the actual subject matter before you discuss, propose, or recommend" applies — didn't apply it here. Captured in CONTEXT.md as D-01, D-02, D-03.

---

## Retirement of the standalone pane

| Option | Description | Selected |
|--------|-------------|----------|
| (a) | Delete the whole standalone tree; route relay tabs to the shared chat surface via prop. Nothing of the standalone survives. | ✓ |
| (b) | Keep the shell wrapper as a thin adapter; delete the pane guts. `RelayRoomSessionPane` survives as a small file mounting the shared surface with a relay source. | |
| (c) | Drop the `sessionKind` distinction entirely. Tab kind unifies; dispatcher stops branching. | |

**User's choice:** (a) — my lean, thumbs up.

**Notes:** (a) is the cleanest artifact and cleanest routing. (b) leaves a redundant shell layer. (c) is structurally purest but has the largest blast radius (touches the tab model and every path reading `sessionKind`). Captured in CONTEXT.md as D-04, D-05, D-06.

---

## Source-prop shape (case cue)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) | Explicit `mode: "harness" \| "relay"` prop. Simple but permits invalid states (e.g. mode=harness with a roomId set). | |
| (b) | Discriminated-union `source` prop with `kind` field. TypeScript makes invalid states unrepresentable; every branch reads `source.kind`. | ✓ |
| (c) | Duck-typed inference from which optional props are present. Most fragile — silently mis-behaves on both/neither, unreadable at future call sites. | |

**User's choice:** (b) — my lean, thumbs up (bundled with the message-list source question below).

**Notes:** Correctness matters more than caller-side conciseness here. Concentrating case-detection at exactly one boundary (`source.kind`) is the drift-risk containment. Captured in CONTEXT.md as D-07, D-08.

---

## Message-list source integration

| Option | Description | Selected |
|--------|-------------|----------|
| (a) | One message store on the shared surface; source-specific adapter hooks feed it. Downstream rendering entirely case-agnostic. | ✓ |
| (b) | Case-aware surface reads different stores based on the case cue. Two stores stay separate in memory. | |

**User's choice:** (a) — my lean, thumbs up (bundled with the source-prop shape question above).

**Notes:** A single store means scroll, hydration, pagination, empty-state cannot drift between the two cases. The adapter is the only case-aware layer. Captured in CONTEXT.md as D-09, D-10.

---

## Claude's Discretion

Documented in CONTEXT.md § Claude's Discretion. Summary:
- Concrete file layout for the shared surface's case-aware bits (inline vs. extract to sibling modules).
- Slice breakdown for the phase.
- Retirement ordering (extensions first with standalone still routed to, or all-at-once).
- Concrete error-state UX / copy.
- Concrete optimistic-bubble plumbing for relay send (match harness pattern).
- Whether `use-relay-room-stream`'s content moves as one blob or gets factored during migration.

## Deferred Ideas

Documented in CONTEXT.md § Deferred Ideas. Summary:
- Badge-click affordance in relay rooms (no-op v1).
- Relay-message system-event kinds (participant joins/leaves) — a later phase.
- Collapsing `sessionKind` entirely — a future refactor, not this phase.
- Mobile / narrow-viewport behavior for the multi-badge row when it grows to many participants (Slice D's D-20 deferral carries forward).
- Extract-and-rebuild refactor path — explicitly rejected per shape "Tempting but no."
