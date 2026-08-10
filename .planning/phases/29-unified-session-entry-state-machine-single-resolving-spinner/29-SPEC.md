# Phase 29: Unified session-entry state machine — single resolving spinner fronts every overlay until deterministic verdict — Specification

**Created:** 2026-08-10
**Ambiguity score:** 0.18 (gate: ≤ 0.20)
**Requirements:** 7 locked

## Goal

Replace the current patchwork of ~5 racing overlays (isBooting/PrettyViewLoadingOverlay, isHolding/SessionHoldingOverlay, dormant/DormancyOverlay + waking, status connecting/streaming/error, WS reconnect flashes) on pretty-view pane entry with a single unified state machine that displays ONE spinner during a `resolving` phase, waits for a fully deterministic set of inputs to report their verdict, then transitions to exactly ONE terminal state and renders the corresponding UI. No timeout heuristics anywhere — the machine waits as long as its inputs need.

## Background

Symptom (Ashley 2026-08-10, verbatim): *"my read on that is that there is no unified piece of logic governing like okay the user has entered this session let's see what state it's actually in so i know what to display and instead there's just a patchwork of bullshit trying to fight for what should be displayed on the screen"*. Concretely, entering a pretty-view pane from the conversation list produces: (a) screen flickers fully black with "Connecting…" even for panes that were active moments ago; (b) a "Connection lost" box briefly covers half the screen before disappearing; (c) "Waking up…" flashes for a second on panes that have been awake for a while; and other mixed-overlay races.

Diagnosis (tiffany 2026-08-10): PrettyView + surrounding chrome have ~5 independent overlay-driving state machines, each with its own local arm/dismiss logic and its own local timer, all racing on entry. On the pane-entry edge (activeSet mount, tab-select, PWA foreground), the WS-pause layer (patch #344) closes the pretty-view WS and reopens it, backend re-does its discovery, various frame types arrive on the WS in whatever order they land — and each of the 5 machines reacts independently. No single source of truth governs "what state is this pane in right now"; the visible UI is whichever machine's overlay wins the paint race.

**Existing overlay components** (fate defined in Requirements below):
- `src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx` (patch quick-260808-ho2)
- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` (patch #74 + #122 + #127)
- `src/ui/features/pretty-view/DormancyOverlay.tsx` (patch quick-260808-cd6 + #345)
- Transient "Connecting…" / "Connection lost" text tied to `status="connecting"|"error"` in `PrettyView.tsx`

**Existing state hooks / stores** (to be subsumed or migrated):
- Local `useState`s in `PrettyView.tsx`: `status`, `isHolding`, `showOverlay`, `holdingTimeoutError`, `dormant`, `waking`, `wakingStartTs`, `wakeError`, `isBooting`, etc.
- Delay-armed timers (`isHolding→showOverlay` at ~350ms, holding-timeout watchdog at 600000ms, loading-overlay 10s auto-dismiss)
- `session-recycling-store.ts` publishing signal to `PrettyConversationsPanel` row dots — must remain accurate through the refactor

**Entry-edge triggers** (backed by `AppShell.tsx:~1832-1863` mount gate `shouldAttach = inPane || activeInline || isInActiveSet` + patch #344's `isVisible` prop): cold mount, warm re-focus (hidden→visible flip on an already-mounted pane), and PWA foreground events all cause structurally identical work — WS reopen, backend re-discovery, first-frame settling.

## Requirements

1. **Explicit `resolving` phase on every entry edge**: The pane state machine enters `resolving` on any of {cold mount, warm hidden→visible re-focus, PWA foreground} and remains in `resolving` until every resolution input has reported at least once.
   - Current: No explicit `resolving` phase exists. On entry, ~5 independent local state machines each begin their own arm/dismiss cycle simultaneously and race to paint.
   - Target: Exactly one authoritative pane-entry state machine, hosted at a single site in the PrettyView subtree, whose `phase` prop can only be `resolving | active | holding | dormant | inactive | error`. All three trigger edges enter the same `resolving` state via the same code path.
   - Acceptance: A unit test drives each of the three trigger edges against a mocked-input harness and asserts `phase === "resolving"` immediately after the edge fires; a second assertion verifies no other overlay component is mounted during that window.

2. **Only the resolving spinner renders during `phase === "resolving"`**: While the machine is resolving, the pane displays a single spinner overlay (visually the current `PrettyViewLoadingOverlay` treatment or a direct evolution of it) and NOTHING ELSE from the previous overlay set. Message view, SessionHoldingOverlay, DormancyOverlay, "Connecting…" text, and "Connection lost" text are all suppressed.
   - Current: All those overlays and status texts can render during the same window, producing flicker.
   - Target: JSX render gate at the pane's overlay-mount site permits only the resolving spinner during this phase; every other overlay component is inside a `phase !== "resolving"` guard.
   - Acceptance: Structural-grep test on the pane's overlay-mount site asserts that `SessionHoldingOverlay`, `DormancyOverlay`, the inactive-fallback banner, the error banner, and any "Connecting…" / "Connection lost" text nodes are all reachable ONLY when `phase !== "resolving"`. Additional integration test: fire each entry edge, assert only one overlay DOM node exists (the resolving spinner) throughout the resolving window.

3. **Deterministic resolution input set — no additional axes**: The machine subscribes to exactly two resolution inputs:
   - `wsState`: one of `not-connected` | `opening` | `open` | `failed-permanently` (from the existing WS retry ladder — the "failed-permanently" value already exists implicitly when `reconnectAttemptsRef.current` exhausts and no further retry is scheduled)
   - `backendFirstFrame`: one of `not-yet` | `active` | `inactive` | `session_holding` | `dormant` (whichever backend frame arrives first after `connectToPane` is sent — the frame types already exist in the backend's WS protocol)
   Pane visibility is an entry trigger, NOT a resolution input. "Session probe in flight" is folded into `backendFirstFrame === not-yet` — no separate axis.
   - Current: State signals arrive as free-form frame side effects on multiple `useState` hooks; no consolidated input model.
   - Target: A single `usePaneResolvingMachine()` hook (or equivalent) exposes `{ wsState, backendFirstFrame, phase }` derived from these two subscribed inputs and the entry-trigger edges.
   - Acceptance: The hook's TypeScript signature lists exactly `wsState` and `backendFirstFrame` as its resolution inputs. A grep for "input" comments or type members in the hook file returns exactly those two — no third axis. Unit tests exercise the full input-value cross product and assert the derived `phase`.

4. **Deterministic (wsState × backendFirstFrame) → phase truth table**: The mapping from input combinations to the terminal phase is fully enumerable and unit-testable:
   | wsState | backendFirstFrame | → phase |
   |---|---|---|
   | `not-connected` / `opening` | any | `resolving` |
   | `open` | `not-yet` | `resolving` |
   | `open` | `active` | `active` |
   | `open` | `session_holding` | `holding` |
   | `open` | `dormant` | `dormant` |
   | `open` | `inactive` | `inactive` |
   | `failed-permanently` | any | `error` |

   - Current: There is no such table. Phase-like outcomes emerge from a race between independent state machines.
   - Target: The mapping is encoded as a pure function `resolvePhase(wsState, backendFirstFrame): Phase` next to the hook, and the hook's `phase` derives from it.
   - Acceptance: A unit-test truth-table exercises every one of the 24 (wsState × backendFirstFrame) combinations (4 × 6 = 24, though some collapse) and asserts the exact `phase` for each. Adding a new row to the table without updating the resolver function fails a structural-grep assertion.

5. **NO timeout heuristics anywhere in the machine**: The resolving spinner stays up until either `wsState` transitions to `failed-permanently` (WS retry ladder terminally gives up — an existing signal) OR `backendFirstFrame` moves off `not-yet`. There is NO wall-clock deadline that resolves to `error` or dismisses the spinner on its own.
   - Current: Client-side belt-and-suspenders 600000ms (10 min) watchdog in `PrettyView.tsx:~1435` on holding; 10s auto-dismiss on `PrettyViewLoadingOverlay`; 8s watchdogs elsewhere. All are timing heuristics that produce wrong-state UI when they fire on a slow-but-healthy pane.
   - Target: The 600000ms watchdog and any equivalent are REMOVED from this pane-entry state machine. The only "give up" signal is the WS layer's own `failed-permanently` terminal state.
   - Acceptance: Grep for `setTimeout` in the new hook file returns zero hits (no timers in the machine itself; existing WS retry-ladder timers stay in the WS layer). Existing `holdingTimeoutError` state + its watchdog effect are deleted from `PrettyView.tsx`. Existing 10s `PrettyViewLoadingOverlay` auto-dismiss is deleted (its useEffect at ~L1468).

6. **Existing terminal-state overlays kept as post-resolution UI**: `SessionHoldingOverlay`, `DormancyOverlay` + Wake button, the inactive fallback banner, and an error banner all remain mounted — but ONLY when `phase` has resolved to their respective terminal value. `PrettyViewLoadingOverlay` is either subsumed (its visual becomes the resolving spinner) or retired as a separate component in favor of a single spinner rendered by the pane at `phase === "resolving"`.
   - Current: All four (plus loading) can co-mount and race.
   - Target: `SessionHoldingOverlay` mounts iff `phase === "holding"`, `DormancyOverlay` iff `phase === "dormant"`, inactive fallback iff `phase === "inactive"`, error banner iff `phase === "error"`. `PrettyViewLoadingOverlay` is retired or repurposed as the resolving spinner (visual identity preserved).
   - Acceptance: JSX render sites for each of the four kept overlays include a `phase === "<terminal-value>"` guard verified by structural grep. `PrettyViewLoadingOverlay` file either deleted (if fully replaced by inline spinner) or its render callsites all gated by `phase === "resolving"`.

7. **Session-recycling-store publish contract preserved**: The `publishSessionRecycling(key, isRecycling)` publish in `session-recycling-store.ts` — consumed by `PrettyConversationsPanel` to suppress the ready-for-attention dot on rows whose pane is currently showing the holding overlay — continues to accurately reflect "SessionHoldingOverlay is currently visible on this key's pretty-view pane."
   - Current: PrettyView publishes on `[showOverlay, hostId, tmuxSession]`.
   - Target: PrettyView publishes on `[phase === "holding", hostId, tmuxSession]`. Semantic identical (the observable UI state), source-of-truth changed.
   - Acceptance: Existing session-recycling-store tests continue to pass; a new test asserts that entering `phase === "holding"` publishes `true` and leaving it publishes `false`, with `resolving` publishing `false` (dot NOT suppressed during resolving — the pane isn't showing the holding overlay).

## Boundaries

**In scope:**
- Pretty-view pane entry state machine + resolving-phase spinner
- Migration of `PrettyView.tsx`'s local `isBooting`/`isHolding`/`showOverlay`/`holdingTimeoutError`/`dormant`/`waking` state to derived values from the new hook (or explicit subordination to `phase`)
- Retirement of the 10-min holding-timeout watchdog, the 10s loading-overlay auto-dismiss, and any other in-pane wall-clock heuristics that fight the new deterministic machine
- Retirement of transient "Connecting…" / "Connection lost" text rendered inline in PrettyView during entry
- Full test coverage: input truth-table + entry-edge tests + structural-grep gates on overlay render sites + real-device UAT plan
- Update `session-recycling-store` publisher call site to derive from the new `phase`

**Out of scope:**
- Terminal panes (xterm.js SSH mode) — Ashley: "unless it makes it more difficult to exclude terminal, then we could just go with that". Terminal has its own connection-status story and follows the same PATTERN if useful, but this phase does not touch Terminal.tsx overlay/state code beyond passing the `isVisible` prop through.
- RDP/VNC/Guacamole panes — same rationale as Terminal.
- WS retry-ladder or connection-layer changes — this phase consumes the WS state signals as-is; if the "failed-permanently" signal is only implicit today, this phase makes it explicit but does not change reconnect behavior.
- Backend changes to `claude-session-server.ts` frame protocol — this phase consumes existing frame types as-is.
- Redesign of any specific overlay's visual — `SessionHoldingOverlay`, `DormancyOverlay`, and the loading spinner keep their current visuals (only their mount-gate changes).
- The two open Ashley-questions from session 9 on the `pretty-view-conversation-pick-loading-feedback` bounty (revert-#351 timing; app-root-overlay-vs-anchored) — this phase may supersede or subsume that bounty but does NOT commit to answers for those pending questions; loading-overlay's `PrettyViewLoadingOverlay` component is either retired here or migrated in a way that leaves those questions still open for that bounty to close separately.
- Message queue interaction — MessageQueueDrawer is not part of the entry state machine; it renders independently.
- WebSocket infrastructure sharing across identities (dep on other in-flight work).
- ComposeBox's own disable states (`recycleActive`/`dormantActive`/`reconnectingActive`) — those already exist and correctly derive from `isHolding`/`dormant`/`status`; this phase rewires their derivation to the new `phase` but does not change ComposeBox itself.

## Constraints

- **iOS Safari PWA compatibility**: Ashley uses this primarily on her iPhone PWA. The resolving spinner must carry the existing `isolate [transform:translateZ(0)]` iOS backdrop-filter hardening from sibling overlays (per patch #333 lesson), and any new render gate must handle the visibility flip caused by iOS backgrounding without regressing patch #344's WS-pause behavior.
- **Motion channel guardrail** (patch #72 lineage): The resolving spinner IS the pane's work-in-progress indicator during entry, so `animate-spin` on its glyph is semantically correct — mirrors the existing `PrettyViewLoadingOverlay` motion deviation which was explicitly documented and regression-guarded. Terminal-state overlays (`SessionHoldingOverlay`, `DormancyOverlay`) keep their STATIC glyphs (state, not work).
- **No worktrees** (fleet rule): All work happens directly on `feat/tab-title-from-tmux` — no `git worktree add`, no `isolation: "worktree"` Agent spawns.
- **Executor scope**: Per box-maintainer role directive on subagents, the executor's remit stops at code + commit + tests-green. The deploy motion (rebase, coord announce, build, verify, push, patches.md entry) is orchestrator-only.
- **Full-suite green precondition**: `npx vitest run` must exit 0 with zero failures for this phase to be considered code-complete.

## Acceptance Criteria

- [ ] Pane state machine exists as a named hook (e.g. `usePaneResolvingMachine`) with a single `phase` return whose type is exactly `"resolving" | "active" | "holding" | "dormant" | "inactive" | "error"`.
- [ ] All three entry-edge triggers (cold mount, warm hidden→visible, PWA foreground) enter `phase === "resolving"` via one shared code path.
- [ ] The resolving-phase truth-table test exercises every (wsState × backendFirstFrame) combination and asserts the exact resulting `phase`.
- [ ] Structural-grep tests assert that during `phase === "resolving"`, ONLY the resolving spinner is renderable — every other overlay's JSX site is gated on `phase !== "resolving"` (specifically: `SessionHoldingOverlay` gated on `phase === "holding"`; `DormancyOverlay` on `phase === "dormant"`; inactive fallback on `phase === "inactive"`; error banner on `phase === "error"`).
- [ ] The strings "Connection lost" and "Connecting…" are not rendered anywhere in the pretty-view surface during any phase (grep test).
- [ ] The 600000ms holding-timeout client watchdog (`PrettyView.tsx:~1435`) is deleted; the 10s `PrettyViewLoadingOverlay` auto-dismiss (`PrettyView.tsx:~1468`) is deleted; no new `setTimeout` calls exist in the new hook (grep test).
- [ ] `session-recycling-store.publishSessionRecycling` is called from the new `phase === "holding"` derivation and preserves its semantic (dot suppressed exactly when holding overlay is visible); existing store tests still pass; a new test locks the `resolving → holding` transition.
- [ ] Regression tests for each of the three named flicker cases: (a) black-screen "Connecting…" on entry to a pane that was active moments ago; (b) "Connection lost" half-screen box; (c) stale "Waking up…" on a session that has been awake — each test drives the input sequence that produced the flicker under the old model and asserts the resolving spinner is the only thing shown until the true state resolves.
- [ ] Real-device UAT on Ashley's iPhone PWA: entering panes from the conversation list under each of the three trigger scenarios shows only the resolving spinner until the pane settles, then the correct terminal-state UI — no flicker, no wrong-state flash.
- [ ] Full `npx vitest run` exits 0 with zero failures; `npx tsc --noEmit` exits 0; `npm run build:backend` exits 0 (if any file under `src/backend/` is touched — expected NOT to be touched in this phase, but check regardless).

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                          |
|--------------------|-------|------|--------|------------------------------------------------|
| Goal Clarity       | 0.85  | 0.75 | ✓      | Single machine, single spinner, deterministic  |
| Boundary Clarity   | 0.80  | 0.70 | ✓      | Pretty-view only; terminal/RDP excluded; overlay fates locked |
| Constraint Clarity | 0.80  | 0.65 | ✓      | No timeouts; iOS hardening; motion channel     |
| Acceptance Criteria| 0.80  | 0.70 | ✓      | Truth-table + structural-grep + flicker regressions + UAT |
| **Ambiguity**      | 0.18  | ≤0.20| ✓      |                                                |

## Interview Log

| Round | Perspective       | Question summary                                          | Decision locked                                                                 |
|-------|-------------------|-----------------------------------------------------------|---------------------------------------------------------------------------------|
| 1     | Researcher        | Pretty-view only or all pane types?                       | Pretty-view only; terminal excluded unless carveout costs more than it saves.   |
| 1     | Researcher        | What counts as "entering the session"? Which triggers?    | All three: cold mount, warm hidden→visible, PWA foreground — all structurally identical work. |
| 2     | Boundary Keeper   | Fate of existing overlays — subsume or keep-and-gate?     | PrettyViewLoadingOverlay subsumed (becomes resolving spinner). Transient "Connecting…"/"Connection lost" text retired. SessionHoldingOverlay + DormancyOverlay + Wake + inactive fallback + error banner KEPT and gated to their terminal `phase` values. |
| 2     | Boundary Keeper   | What counts as "resolved to error"?                       | Option (a): no wall-clock timeout; error resolves only when WS retry ladder terminally fails. Option (b) rejected (reintroduces the heuristic timeout we're eliminating). |
| 3     | Boundary Keeper   | Enumerate deterministic input signals; visibility as input? probe-in-flight as input? | Exactly two resolution inputs: `wsState` + `backendFirstFrame`. Visibility is an entry TRIGGER (edge), not a resolution input. Probe-in-flight is `backendFirstFrame === "not-yet"` — no separate axis. Terminal states = 5: active/holding/dormant/inactive/error. |
| 3     | Boundary Keeper   | Acceptance criteria — truth-table + regression tests + UAT? | Locked verbatim as drafted: single-spinner-during-resolving assertion, snap-table truth test, three named flicker regression tests, real-device UAT. |

---

*Phase: 29-unified-session-entry-state-machine-single-resolving-spinner*
*Spec created: 2026-08-10*
*Next step: /gsd-discuss-phase 29 — implementation decisions (hook location, how phase derives from existing WS/session hooks, how the three trigger edges are threaded from AppShell mount-gate through PrettyView, spinner visual identity vs PrettyViewLoadingOverlay, migration order for the 6 existing state hooks, etc.)*
