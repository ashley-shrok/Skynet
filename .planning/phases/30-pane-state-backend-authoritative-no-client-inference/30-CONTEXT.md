# Phase 30: pane-state-backend-authoritative-no-client-inference — Context

**Gathered:** 2026-08-10
**Status:** Ready for planning
**Source:** In-session design conversation with Ashley 2026-08-10 (post-Phase-29 UAT — reset button overlay flash surfaced the deeper Phase-29 sourcing gap)

<domain>
## Phase Boundary

**What this phase delivers:** the pretty-view pane-entry state machine's phase verdict derives from EXACTLY TWO inputs, both sourced from real state (backend observations of the session file / process / dormancy / classification, plus the transport's own connection state) — not from client-side inference or user-gesture hints.

**Concrete scope:**
- Backend gains a single authoritative `pane_state` frame type that carries `{ state: "active" | "holding" | "dormant" | "inactive" | "error", reason?: string }`. Backend emits it on every WS attach (fresh clients get current truth) and on every state change.
- Backend session-file parser learns to detect `/id reset` (and the `/id reset (...)` form with pasted text) in user turns; when seen, it triggers a `pane_state: holding` emission. **The user-turn message frame CONTINUES to render as a visible chat bubble in pretty view — Ashley's pre-existing HARD LOCK on slash-command visibility (see `claude-session-server.ts:1592-1597` comment: "slash commands must remain visible in pretty view. The state transition is orthogonal to whether the /id reset text renders as a chat bubble") is preserved.** Detection is a pure observation channel that emits the pane_state transition; it does NOT modify the message stream. Earliest real "recycling starts now" signal, replacing today's PID-death /exit-scan heuristic (which stays as a fallback for non-reset session death).
- Existing frame types that today drive phase inference (`dormant`, `session_holding`, `session_holding_cleared`, `session_changed`, `inactive`) either retire outright or become internal implementation details of the pane_state emitter — the wire surface consolidates to one authoritative frame.
- Frontend state machine (`usePaneResolvingMachine`) shrinks to consume exactly two inputs: `paneState` (last received value, or null) and `wsTransportState`. Truth table becomes trivial. All client-side entry-trigger machinery deletes: three entry-trigger effects (cold-mount, warm re-focus, PWA foreground), the `rearmSnapshotRef` pattern, the D-11 "message frame swaps to active" rule, the `backendFirstFrame` concept entirely, all ~10 `captureFirstFrame(...)` call sites, local state slots (`isHolding`, `dormant`, `waking`, `holdingTimeoutError`, etc.) that mirror phase-derived info.
- Patch #381 (in-session frontend client-hint hack for the reset button) becomes redundant and gets deleted as part of this phase's diff.

**Out of scope:**
- Symptom 2 (mobile PWA foreground stuck-in-resolving) — same doctrine applies but the code paths are disjoint from Phase 30. Separate phase to keep this one reviewable.
- Any change to the WS transport / retry ladder itself — that layer stays untouched; the state machine just observes its lifecycle.
- Message frame rendering (content path is unchanged; only the phase-inference side effects go).

</domain>

<decisions>
## Implementation Decisions

### Signal set (LOCKED)

**Exactly two signals into the state machine:**

1. **`pane_state`** — backend-emitted authoritative verdict. One frame type. Values: `active | holding | dormant | inactive | error`. Optional `reason` field for diagnostics. Emitted on WS attach and on every state change.
2. **`wsTransportState`** — client-observed WS lifecycle. Values: `not-connected | opening | open | failed-permanently`. Unavoidably client-side (only the browser knows its own socket).

**No third axis. No entry-trigger inputs. No user-gesture inputs. No frontend inference from content frames.**

### Truth table (LOCKED)

| wsTransportState | paneState received? | → what renders |
|---|---|---|
| `failed-permanently` | any | error overlay (transport failure, Retry button) |
| `not-connected` / `opening` | never received | resolving spinner |
| `not-connected` / `opening` | previously received | last known pane_state's overlay (transient drop; don't flicker) |
| `open` | not yet received | resolving spinner (waiting for backend's initial pane_state emit) |
| `open` | received | overlay for the state (holding / dormant / inactive) or normal message view (active) |

### Backend observations feeding pane_state

**→ holding** (in priority order):
- Session-file parser sees `/id reset` in a user turn (the earliest real signal — /id reset lands in session.jsonl before Claude terminates). **Detection is a pure observation channel; the user-turn message frame is NOT suppressed — it renders normally per Ashley's pre-existing slash-command-visibility HARD LOCK (`claude-session-server.ts:1592-1597`).**
- Fallback: existing PID-death detection + /exit scan (for crash / kill / manual exit / any non-reset termination).
- Fallback: tmux pane scrape sees the harness's terminal death markers (backup for session-file lag).

**→ active:**
- New session file inode/UUID appears (session_changed detection — Claude Code opens a fresh session.jsonl on reset completion or fresh start). Currently emitted as the `session_changed` frame.
- Live turn written to the currently-attached session file, only when we weren't already active.
- PID for the tmux session's Claude process detected running when it wasn't before.

**→ dormant:**
- Agent-supervisor marks the session dormant (backend already tracks this; source of today's `dormant` frame).

**→ inactive:**
- Backend classification (no session running for this pane key, no session file, or session marked inactive by backend logic).
- Backend fires `inactive` with `reason: "holding_timeout"` when a hold exceeded the backend's give-up window.

**→ error:**
- Session file unreadable/corrupt or backend hit unrecoverable state tracking this pane.
- Distinct from WS transport error (which is client-observed).

### Migration strategy

- Backend: add `pane_state` emitter as a new top-level layer that composes the existing dormancy / session_holding / session_changed / inactive detectors. Existing frame types can stay on the wire (backward compat with any in-flight clients) but frontend stops consuming them for phase inference.
- Frontend: strip inference logic in one pass. `usePaneResolvingMachine` reduces to a trivial derivation. All `captureFirstFrame` call sites delete. Local state slots mirroring phase delete. Patch #381 deletes.
- Parser `/id reset` detection: new test-first change in `src/backend/claude-session/session-file-parser.ts`. **Detect-and-emit only — do NOT suppress the user-turn message frame.** Ashley's pre-existing HARD LOCK on slash-command visibility in pretty view is preserved verbatim (`claude-session-server.ts:1592-1597`). Detection is an observation channel exposed alongside the normal parse output; the onLine consumer calls the pane_state emitter on the observation, and the message frame emits as it does today.

### Overlay mount gates (LOCKED)

- `SessionHoldingOverlay`: `paneState === "holding"`
- `DormancyOverlay`: `paneState === "dormant"`
- `PrettyViewErrorOverlay`: `wsTransportState === "failed-permanently"` OR `paneState === "error"`
- Inactive fallback: `paneState === "inactive"`
- Resolving spinner: transport not open AND (no pane_state received yet OR chose not to show stale)

### Test strategy

- Backend parser test: `/id reset` in user turn → detection observation fires + pane_state emit observed + message frame still renders normally (slash-command-visibility HARD LOCK preserved).
- Backend pane_state emitter unit tests: each transition trigger fires the correct state + reason.
- Frontend: existing Phase-29 tests for `usePaneResolvingMachine` entry-triggers / snapshot rearm all DELETE (that machinery is gone). New tests: state machine derives correct rendered state from each `(wsTransportState, paneState)` combination. Truth table stays testable but shrinks.
- Integration: click reset → single-frame path from parser observation to overlay mount, no flash. `session_changed` follows → clean swap to active view. No client-side race machinery to test.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 29 (the source of the sourcing gap being closed)
- `.planning/phases/29-unified-session-entry-state-machine-single-resolving-spinner/29-SPEC.md` — Phase 29 spec; requirements 3-6 describe the two-input state machine that Phase 30 is refactoring the SOURCES of.
- `.planning/phases/29-unified-session-entry-state-machine-single-resolving-spinner/29-CONTEXT.md` — Phase 29 locked design decisions Phase 30 must not accidentally regress.
- `src/ui/features/pretty-view/usePaneResolvingMachine.ts` — the hook whose entry-trigger machinery deletes in Phase 30.
- `src/ui/features/pretty-view/resolve-phase.ts` — the pure truth-table reducer; may simplify or delete as inputs change.
- `src/ui/features/pretty-view/PrettyView.tsx` — hosts all `captureFirstFrame` call sites (~10 of them), the `onResetClicked` patch #381 fix, and every case-branch that will simplify to "handle content frame OR handle pane_state frame."

### Backend session-file layer
- `src/backend/claude-session/session-file-parser.ts` — parser to extend with `/id reset` **detect-and-emit** (do NOT suppress the message frame; slash-command-visibility HARD LOCK preserved). Existing test: `session-file-parser.test.ts` (has 700+ lines of existing coverage — extend, don't rewrite).
- `src/backend/claude-session/claude-session-server.ts` — hosts the WS frame emit paths (dormant / session_holding / session_changed / inactive). Consolidates via the new pane_state emitter.
- `src/backend/claude-session/layer1-detect.ts` — the /exit-scan fallback path (stays).

### Wire protocol (frame types touched)
- Search-anchor: `type: "session_holding"` / `type: "dormant"` / `type: "inactive"` / `type: "session_changed"` — every emit site of these gets funneled through the new `pane_state` emitter.

</canonical_refs>

<specifics>
## Specific Ideas

- Patch #381's `captureFirstFrame("session_holding")` in `onResetClicked` is the concrete anti-pattern this phase eliminates. It exists in `PrettyView.tsx` around line 379-383 as of commit `76e29cb`. Delete it explicitly as part of the frontend simplification pass.
- The D-11 "any live message swaps back to active" rule (the L1069 comment block in `PrettyView.tsx` and equivalent for image / relay_outbound / relay_inbound / malformed_line cases) is the client-inference pattern this phase most directly kills. Backend emits active via pane_state; frontend stops inferring.
- Existing test: `usePaneResolvingMachine.test.tsx` has extensive coverage of entry-trigger + snapshot rearm behavior. Most of it deletes; keep only tests that exercise the trivial (wsTransportState, paneState) → rendered-state truth table.
- The `SessionHoldingOverlay` component itself doesn't change (visual UX is the same); only its mount gate flips from client-derived to backend-derived.

</specifics>

<deferred>
## Deferred Ideas

- **Symptom 2 (mobile PWA foreground stuck in resolving):** same doctrine applies (kill client-state entry-triggers, trust backend truth), but the code paths are disjoint from Phase 30's parser + emitter work. Deserves its own phase after this one lands.
- **Distinct warm-red UI for `inactive { reason: "holding_timeout" }`:** Phase 29's implementation retired the warm-red timeout-error variant. If Ashley wants it back later, add a `holding_timeout` variant to the pane_state enum or handle the reason field in the overlay. Out of scope here.
- **Retiring the legacy frame types entirely** (removing `session_holding` / `session_changed` / `dormant` / `inactive` from the wire): keep them alive for backward compat this phase. Deprecation is a follow-up once no client depends on them.

</deferred>

---

*Phase: 30-pane-state-backend-authoritative-no-client-inference*
*Context gathered: 2026-08-10 via in-session design conversation with Ashley*
