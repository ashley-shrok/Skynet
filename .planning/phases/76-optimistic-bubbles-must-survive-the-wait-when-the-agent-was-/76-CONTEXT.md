# Phase 76: Optimistic bubbles must survive the wait when the agent was asleep at send time — Context

**Gathered:** 2026-09-06
**Status:** Ready for planning
**Source:** Seeded from `/open` shape file `.planning/shapes/shape-optimistic-during-dormant-wake.md` per /build skill's express-path directive ("seed discuss-phase from the shape file — do not re-do the discovery /open already did"). No additional gray areas surfaced during the /open session that were not resolved there; interactive discuss-phase gray-area round skipped. Ashley 2026-09-06 verbatim on framing: *"do whatever you need to get there"* (full reliability), and *"I have no fucking idea what the right time is... just open the fucking build"* (delegating implementation-detail decisions to shape/plan).

<domain>
## Phase Boundary

Unify the two frontend dormancy signals into a single authoritative source, and wire the pending-send timer to read that source at arm time — so Phase 62's already-shipped widened-timeout branch (`PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000`, `src/ui/features/pretty-view/PrettyView.tsx:140`) actually gets taken when the agent was, in truth, dormant at the moment of send. Also: whole-bubble red visual on flip-to-failed (semantic upgrade — the failed state is now rare-and-truthful post-fix, not the common false alarm it was). Also: verify Phase 62's multi-send-during-wake claim under real conditions (in-process test with reconnect-mid-dormancy setup — Phase 62's CONTEXT explicitly deferred race handling; this phase closes that deferral). Also: enumerate every frontend surface that reads asleep-versus-awake state or arms a pending-related timer, and migrate any such surface reading from the drift-prone signal onto the authoritative one.

**Scope inherits directly from the shape file** — see the "Scope edges" section of `.planning/shapes/shape-optimistic-during-dormant-wake.md`. Recap: reconciling the two dormancy signals into an authoritative source; wiring the pending-send timer at arm time; sourcing the widened value by reference to the backend's give-up constants (`MARKER_FALLBACK_MS_MIRROR + GIVE_UP_MS_DORMANT`, `src/backend/claude-session/pv-send-watchdog.ts:83-100`); surface inventory; multi-send verification; whole-bubble red on failed. Explicitly out: duplicate-real-bubble bug (sister bounty `pv-queue-op-dedup-doesnt-survive-wake-recycle`, still in Phase 62's Wave 2 instrumentation lane), reconnect-during-the-widened-wait behavior (rare, follow-up only if it bites).

</domain>

<decisions>
## Implementation Decisions

### Signal reconciliation

- **D-01: Two signal sources exist and must be reconciled into a single authoritative dormancy source.** Signal A: `{type:"dormant", dormant:boolean}` — emit-on-change from `claude-session-server.ts:2440-2447` (only fires on transitions). Signal B: `{type:"pane_state", state:"active"|"holding"|"dormant"|"inactive"|"error"}` — full re-emit on WS attach from the pane-state-emitter (goes through `startActiveSessionFlow`). Phase 62 wired the widened pending-send timer to Signal A via `dormantRef.current`, which goes stale on any WS reconnect while dormant (backend does not re-emit type:"dormant" on reconnect because state has not "changed" from its perspective). Signal B does not go stale — every WS attach hydrates paneState.

- **D-02: The authoritative source is derived from BOTH signals, with a preference for the more recent / less-stale-vulnerable of the two.** Concrete decision on the derivation function is left to plan-phase, but the derivation lives in one place (a single ref or derived value), not scattered across consumers. Candidates for plan-phase to weigh: (a) make `setDormant` fire from BOTH the type:"dormant" case AND the type:"pane_state" case-when-state===dormant, so `dormantRef` becomes authoritative through both channels; (b) introduce a new `isDormantAuthoritative` derived from `dormant || paneState === "dormant"` and migrate consumers off `dormantRef`. Whichever is chosen: the pending-send timer, and every other surface identified in the inventory (D-04), reads from the authoritative source.

- **D-03: The read is at arm time and latched to the pending-send.** Same principle Phase 62 established for `dormantRef.current` (Phase 62 CONTEXT §Wave 1 D-62-03). The fact that the agent was dormant at send-time belongs to that particular pending-send for its lifetime — does not change if the agent wakes mid-flight or sleeps again. This is symmetric with the backend `__applyInputMessageForTests` entry-time read of `dormantLastEmitted`.

### Symmetric-surface inventory

- **D-04: Plan phase must produce an explicit inventory of every frontend surface that reads asleep-versus-awake state or arms a timer tied to a pending-send's lifetime.** Known starting points (confirmed by 2026-09-06 grep): the `dormant` state slot (`PrettyView.tsx:715`), `dormantRef` (`PrettyView.tsx:1413`) and its mirror useEffect (`PrettyView.tsx:2555-2559`), consumers of `dormantRef.current` at `PrettyView.tsx:1233` (pending-send arm site — the load-bearing consumer), `PrettyView.tsx:1741` (WS onmessage stale-closure guard), and the `paneState` slot (`PrettyView.tsx:1447`) + `paneStateRef` (`PrettyView.tsx:1451`) which feeds `usePaneResolvingMachine` for overlay mount gates. Plan-phase must produce the full inventory as a required artifact — not just take this starting list as complete. Every surface on the inventory that currently reads from Signal A gets migrated onto the authoritative source unified in D-02.

### Timeout value sourcing

- **D-05: Widened timeout value continues to be sourced by reference to the backend's give-up constants, not an independent hardcoded number.** Phase 62 already did this correctly — `PENDING_SEND_TIMEOUT_MS_DORMANT = 220_000` was derived from `MARKER_FALLBACK_MS_MIRROR (90_000) + GIVE_UP_MS_DORMANT (120_000) + 10_000ms margin = 220_000` (Phase 62 CONTEXT §Wave 1 sizing rationale). Preserve that. If the backend's give-up ceiling changes, the frontend value follows. Plan-phase should confirm the current constants are still authoritative and add a drift-catch comment/test if warranted.

### Failed-state visual

- **D-06: Whole-bubble red fill on the flip-to-failed state, not just a red border.** Ashley 2026-09-06 verbatim: *"I imagined that like the original red bubble concept was that the whole bubble would just turn red instead of the blue hue that normal messages have from the user instead of what actually is what I got, which is just a red border. So it would be nice to change that visual during this. and then you know it's kind of more fitting anyways since hopefully after we do this work a failed bubble will be a truly failed bubble and that is worth being that loud about."* Rationale: post-fix, a failed bubble means the server tried its full budget and actually gave up — the visual should carry that stronger meaning. Plan-phase decides the exact CSS/tailwind approach; the intent is "whole bubble red fill, decisive."

### Multi-send verification

- **D-07: Multi-send during a widened wait must be verified under real conditions in an in-process test, including a reconnect-mid-dormancy setup.** Phase 62's implementation claim was that multiple pending sends during a wake all deliver in order when the wake completes. Nobody has confirmed that under real conditions, and the specific failure mode Phase 76 fixes (dormantRef stale after reconnect) is exactly the setup where the multi-send claim would break. In-process test drives: agent goes dormant → WS reconnects (dormant frame emit-on-change does not re-fire) → Ashley sends TWO messages back-to-back → both must land as real bubbles in order after the wake completes. Ashley 2026-09-06 verbatim: *"that exact model was agreed upon when we first tried to implement this. So I imagine there's an attempt to have that already be happening in the current code. Although I don't think I've ever tried to send a follow-up message, so I can't really confirm if it works or not."* Verify, not assume.

### Awake-case unchanged

- **D-08: The awake-case pending-send stopwatch (20s / `PENDING_SEND_TIMEOUT_MS_NORMAL`) is unchanged.** It was never the broken case. If the fix accidentally widens the awake case too (e.g., by applying the widened timeout uniformly instead of on the latched "asleep-at-send" fact), that trades one bug for another. Plan-phase confirms every arm site correctly branches on the authoritative signal.

### Claude's Discretion

The following are implementation details the planner is free to decide, subject to the D-01–D-08 decisions above:

- Exact derivation function for the authoritative dormancy source (candidates in D-02).
- Test framework choice for the multi-send-during-reconnect scenario — pick whatever fits the existing PrettyView test infrastructure.
- Wave split (single-plan vs. multi-plan phase) — whichever produces cleaner atomic commits + review surface.
- Exact CSS/tailwind approach for whole-bubble red (D-06).
- Whether to retain the "dormant" state slot at all after unification, or collapse it into paneState-derived logic.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape and phase-scope

- `.planning/shapes/shape-optimistic-during-dormant-wake.md` — full /open shape file: what this is, shape, philosophy, prior context, what would make it wrong, scope edges. Every decision above traces back to this. The scope edges section is authoritative for what's in / out / deferred.

### Directly upstream phase

- `.planning/phases/62-invisible-dormancy-client-side-follow-up-widen-client-pendin/62-CONTEXT.md` — Phase 62 CONTEXT, especially §Wave 1 (the widening that got shipped but got wired to the drift-prone signal), the race-handling deferral note ("If the dormant frame arrives AFTER the send... Race handling is out of scope for this phase"), and the sizing rationale for `PENDING_SEND_TIMEOUT_MS_DORMANT`.
- `.planning/phases/62-invisible-dormancy-client-side-follow-up-widen-client-pendin/62-01-SUMMARY.md` — Phase 62 Wave 1 SUMMARY: exact files touched, exact test added (Test 5b in `PrettyView.optimistic-bubbles.test.tsx`), exact constants introduced.

### Phase 60 (the upstream backend widening that Phase 62 tried to mirror)

- `.planning/shapes/shape-invisible-dormancy.closed.md` — the shape file that used the singular "widen THE watchdog" language, which is the root process cause of the Phase 62 miss. Reading this makes clear what Phase 76 must NOT do (assume a single-signal / single-surface fix).
- Phase 60 SUMMARY files under `.planning/phases/60-invisible-dormancy-wakes-.../` — Phase 60 backend side (send-path + backend watchdog widening + deletion patterns) — these are what Phase 62 mirrored on the client, and they're what defines the backend's give-up ceiling that D-05 references.

### Live diagnosis

- `~/.claude/roles/box-maintainer/bounties/pv-client-pending-send-timer-dormancy-blind/bounty.json` — bounty premise + log traces. 2026-08-30 trace (Phase 62 diagnosis moment) and 2026-09-06 trace (tiffany repro that surfaced the reconnect-drift root cause) both matter.

### Sister-bounty (out of scope for Phase 76 but relevant context)

- `~/.claude/roles/box-maintainer/bounties/pv-queue-op-dedup-doesnt-survive-wake-recycle/bounty.json` — the duplicate real bubble bug. Phase 62 Wave 2 shipped instrumentation for this; the actual fix is deferred. Phase 76 must NOT widen the dedup gap.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`PENDING_SEND_TIMEOUT_MS_NORMAL` (20_000) and `PENDING_SEND_TIMEOUT_MS_DORMANT` (220_000)** — `src/ui/features/pretty-view/PrettyView.tsx:139-140`. Phase 62 shipped both. Reuse verbatim; do not re-derive.
- **`dormantRef` mirror useEffect** — `src/ui/features/pretty-view/PrettyView.tsx:2555-2559`. Established stale-closure-safe pattern; extend or replace per D-02.
- **`paneStateRef` mirror useEffect** — same pattern, parallel to `dormantRef`.
- **`handleOptimisticSend` arm site** — `src/ui/features/pretty-view/PrettyView.tsx:1227-1245`. Phase 62 added the `armedDormant = dormantRef.current === true` read at line 1233. This is the LOAD-BEARING consumer to migrate first.
- **`[diag-dormant-send] arm` / `fire` / `flip-to-failed` diagnostic logging** — already in place at the pending-send lifecycle (see `PrettyView.tsx:1243` for arm log). Existing log fields let the fix be verified from console-forward-logs post-deploy without new instrumentation.
- **`PrettyView.optimistic-bubbles.test.tsx` Test 5 and Test 5b** — Phase 62's test scaffolding for the pending-send timer. Test 5b in particular exercises the dormant-branch defer + eventual fire behavior. Extend with a Test 5c (or similar) covering the reconnect-mid-dormancy setup for the authoritative-signal path.

### Established Patterns

- **Ref-mirrors-state via useEffect** — pattern used for `dormantRef`, `paneStateRef`, `isVisibleRef`, `statusRef`, `autoplayArmedRef`. If the authoritative dormancy source is a new derived value, its ref mirror follows this pattern.
- **Named constant + rationale comment coupling across frontend/backend** — Phase 62 used this for `PENDING_SEND_TIMEOUT_MS_DORMANT` referencing backend constants that can't be imported. Preserve this pattern; do not introduce independent constants that could silently drift.
- **Arm-time read of ref, not state, inside async callbacks** — established pattern to avoid stale-closure bugs. `handleOptimisticSend` reads `dormantRef.current` at arm time (line 1233); the fix must preserve this semantics for the authoritative source.

### Integration Points

- **The wire contract is unchanged.** Backend continues to emit `{type:"dormant"}` and `{type:"pane_state"}` as it does today; the fix is entirely inside PrettyView. No backend changes, no wire-format changes, no new API surface.
- **`usePaneResolvingMachine`** — currently reads `paneState` for overlay mount gates. If the authoritative source is derived from paneState, this consumer stays authoritative naturally.
- **WS onmessage handler in PrettyView (line 1741 area)** — currently uses `dormantRef.current` inside a stale-closure guard. Depending on D-02 choice, this consumer either migrates to the authoritative source or stays put (guard purpose may not be dormancy-truth-dependent).

</code_context>

<specifics>
## Specific Ideas

- **Ashley 2026-09-06 on framing (verbatim, load-bearing):** *"such shoddy work gets done in this app where things are just touched without considering how it affects other pieces. And things constantly break and are unreliable because of it."* Every decision above (D-01–D-08) traces back to preventing this exact class of miss — Phase 60 shipped assuming one watchdog; Phase 62 shipped assuming one dormancy signal. Phase 76 must produce the surface inventory as a hard artifact so this iteration cannot ship the same class of miss for a third time.

- **Ashley 2026-09-06 on the 20s vs longer-window UX tradeoff:** *"For now the silent three-minute spin is acceptable because most of the time it doesn't take anywhere near that to wake the agent up."* Silent spin is fine. Do NOT add interim status text, wake-progress indicators, cancel-in-flight affordances, or any new UX surfaces during this phase.

- **Ashley 2026-09-06 on the 90s-vs-190s question:** she waved this off — decision was made in-shape to source the value by reference to the backend give-up ceiling (D-05), not by picking a number. Do not re-litigate.

- **Multi-send-during-wake user model:** two spinning bubbles in flight during a widened wait, both deliver in order when wake completes, no bubbles lost or reordered, no dedup collision. Ashley confirmed this is the intended model — verify it works.

</specifics>

<deferred>
## Deferred Ideas

- **Duplicate real bubble on wake-triggered session recycle** — sister bounty `pv-queue-op-dedup-doesnt-survive-wake-recycle`. Priority two behind this phase per Ashley's ordering. Phase 62 Wave 2 shipped instrumentation for this; actual fix requires a repro with the instrumentation live to nail the mechanism. Follow-up build after the next dormant-wake repro produces the trace.

- **Reconnect during the widened wait (survive-and-re-anchor pending)** — Ashley 2026-09-06 verbatim: *"you're talking about a rare scenario that probably needs a bunch of its own custom mechanisms. So I'm trying not to push my luck here."* Scope creep. Follow-up bounty only if it bites in practice.

- **Cancel-in-flight affordance during a widened wait** — three minutes of silent spin might feel like an eternity if Ashley regrets sending. She confirmed silent spin is acceptable because wakes usually complete well before ceiling. Not adding new UX surface here.

- **Interim status text during the spin** — "waking her up" / "sending" / etc. Same rationale: no new UX surface during this phase.

- **Retire the `dormant` state slot entirely** — if D-02 lands on "collapse into paneState-derived logic," there may be no need for a separate `dormant` state slot at all. Plan-phase discretion; may fall out of the implementation naturally, or may be its own follow-up cleanup.

</deferred>

---

*Phase: 76-optimistic-bubbles-must-survive-the-wait-when-the-agent-was-*
*Context gathered: 2026-09-06*
*Express path per /build skill: shape file drove decisions; interactive gray-area round skipped by design.*
</content>
