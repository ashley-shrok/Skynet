# Phase 29: Unified session-entry state machine — single resolving spinner fronts every overlay until deterministic verdict - Context

**Gathered:** 2026-08-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current patchwork of ~5 racing overlays on pretty-view pane entry (isBooting/PrettyViewLoadingOverlay, isHolding/SessionHoldingOverlay, dormant/DormancyOverlay + waking, status connecting/streaming/error, WS reconnect flashes) with a single unified state machine that displays ONE spinner during a `resolving` phase, waits for a fully deterministic set of two inputs (`wsState` + `backendFirstFrame`) to report their verdict, then transitions to exactly ONE of five terminal states (active / holding / dormant / inactive / error) and renders the corresponding UI. No timeout heuristics in the machine — the resolving spinner stays up until inputs settle. Scoped to pretty-view panes only (Terminal xterm.js panes + RDP/VNC/Guacamole panes explicitly out of scope for this phase).

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**7 requirements are locked.** See `29-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `29-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Pretty-view pane entry state machine + resolving-phase spinner
- Migration of `PrettyView.tsx`'s local `isBooting`/`isHolding`/`showOverlay`/`holdingTimeoutError`/`dormant`/`waking` state to derived values from the new hook (or explicit subordination to `phase`)
- Retirement of the 10-min holding-timeout watchdog, the 10s loading-overlay auto-dismiss, and any other in-pane wall-clock heuristics that fight the new deterministic machine
- Retirement of transient "Connecting…" / "Connection lost" text rendered inline in PrettyView during entry
- Full test coverage: input truth-table + entry-edge tests + structural-grep gates on overlay render sites + real-device UAT plan
- Update `session-recycling-store` publisher call site to derive from the new `phase`

**Out of scope (from SPEC.md):**
- Terminal panes (xterm.js SSH mode)
- RDP/VNC/Guacamole panes
- WS retry-ladder or connection-layer behavioral changes
- Backend changes to `claude-session-server.ts` frame protocol
- Visual redesign of any specific overlay (SessionHoldingOverlay / DormancyOverlay / spinner keep their current visuals)
- The two open Ashley-questions from session 9 on `pretty-view-conversation-pick-loading-feedback` bounty
- MessageQueueDrawer, ComposeBox internal state (only rewired, not restructured)
- WebSocket infrastructure sharing across identities

</spec_lock>

<decisions>
## Implementation Decisions

### Spinner Visual Identity + Copy
- **D-01:** Reuse `PrettyViewLoadingOverlay` visual as-is — Loader2 spinning glyph in glass card with existing `isolate [transform:translateZ(0)]` iOS backdrop-filter hardening, existing warm-cream text color, existing scrim geometry. NO visual redesign. Keep the file (or absorb into the new hook's render output — implementation call).
- **D-02:** Keep "Loading…" copy verbatim. Changing the copy is not part of this phase's win; Ashley already knows what that spinner means.
- **D-03:** Motion channel: `animate-spin` on the Loader2 glyph is semantically correct here (surface work in progress) — mirrors the existing motion-deviation locked in by patch quick-260808-ho2's regression test. Static-glyph guardrail (patch #72) applies to TERMINAL-state overlays only (SessionHoldingOverlay + DormancyOverlay); the resolving spinner is state = work.

### Anti-Flash Delay
- **D-04:** ~150ms armed delay before the resolving spinner mounts on any of the three entry-trigger edges. Genuinely-instant resolutions (warm re-focus where WS reopens fast + cache-warm backend responds fast — typically <100ms) never flash the spinner.
- **D-05:** Symmetry with patch #74's 350ms delay-arm on holding — this is NOT a resolve timeout (which the phase bans), it's a paint delay that suppresses spinner-flash for fast paths. The `resolving` phase itself enters immediately on the entry-trigger edge; only the SPINNER RENDER is delay-armed. If inputs settle before the ~150ms elapses, `resolving` transitions to the terminal state and the spinner never mounts.
- **D-06:** Exact delay value (150ms suggested) is a planner default — planner may choose anywhere in the 100-200ms range with reasoning; final value locked via UAT with Ashley on her PWA.

### Error Phase UI (`phase === "error"`)
- **D-07:** Full-surface warm-red error card mirroring `SessionHoldingOverlay`'s error variant one-to-one — same geometry (glass card centered on scrim), same warm-red gradient (`bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]`), same warm-red text (`text-[#f5d0d4]`), same inset-glow shadow. Static `RefreshCcw` glyph (state, not work — motion channel intact). NOT a small inline banner.
- **D-08:** Copy: "Connection failed — retry" (planner default; final copy locked via UAT). Retry button rendered inside the card.
- **D-09:** Retry button triggers a fresh WS reconnect attempt from user gesture — same UX shape as `DormancyOverlay`'s Wake button. This may need a new "manual retry" event surfaced from the WS layer, or the button can simply re-enter the resolving phase via a synthetic entry-trigger edge and let the WS reconnect happen underneath (planner's call).

### Transient WS Drops After Resolve-to-Active
- **D-10:** Option (b) — stay `active` on network blips. Once the machine has resolved to `active` (or any terminal state) via first entry-trigger resolution, subsequent WS drops do NOT re-enter `resolving`. Only the three named entry triggers (cold mount, warm hidden→visible re-focus, PWA foreground) can re-arm `resolving`.
- **D-11:** Post-resolve state derivation remains pure-function: if the backend re-emits a new `firstFrame` value on WS reconnect (e.g. session went dormant while user was offline), the machine transitions directly from `active` → `dormant` (or whichever value the new input dictates) WITHOUT going through `resolving`. Overlay swap is clean, no spinner in between.
- **D-12:** Model shape: state machine has TWO modes — "initial resolving" (entered on entry-trigger, exited when both inputs settle) and "post-resolve steady state" (inputs still drive terminal phase, but resolving is not re-entered on input changes). A flag like `hasEverResolved: boolean` or a separate machine layer captures this. Planner picks the exact implementation.
- **D-13:** Explicit non-goal: this phase does NOT try to unify or optimize the WS retry ladder itself. Retry-ladder behavior (backoff, max attempts, iOS PWA visibilitychange handler behavior) is unchanged from patches #148 + #344 + #367.

### Claude's Discretion (implementation-level, planner/researcher decides)
- Hook file location + name (`usePaneResolvingMachine` in `src/ui/state/` or in `src/ui/features/pretty-view/` — either works)
- Exact mechanism for surfacing `wsState = failed-permanently` from the existing WS retry ladder (add explicit state slot vs. observe absence of scheduled retry + `status === "error"`)
- Migration order for the 6 existing local state hooks — one atomic PR that removes them all vs. phased migration with brief coexistence
- Exact wiring of the three entry-trigger edges (subscribe to `isVisible` prop + `retryKey` bump + `document.visibilityState` — some combination of these three signals)
- `session-recycling-store` publish site relocation (keep in `PrettyView.tsx` with new deps, or move into the hook itself)
- Precise value of the anti-flash delay (100-200ms range, D-06)
- Exact error-card copy ("Connection failed — retry" is a suggestion, D-08)
- Retry button implementation mechanism (D-09)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 29 requirements + spec
- `.planning/phases/29-unified-session-entry-state-machine-single-resolving-spinner/29-SPEC.md` — Locked requirements (7), boundaries, acceptance criteria. MUST read before planning.

### Existing state machines being subsumed / rewired
- `src/ui/features/pretty-view/PrettyView.tsx` — Hosts all ~5 racing state machines today (isBooting, isHolding/showOverlay/holdingTimeoutError, dormant/waking/wakingStartTs/wakeError, status). Key regions: WS setup effect ~L720-1109, session_holding case ~L1015, session_changed case ~L1042, inactive case ~L854, dormant case ~L888, wake_result case ~L926, delay-arm useEffect for showOverlay ~L1398, holding-timeout watchdog ~L1420 (DELETE per D-08 SPEC req 5), loading-overlay 10s auto-dismiss ~L1468 (DELETE per SPEC req 5), fresh-pane reset block ~L716-747.
- `src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx` — Current spinner visual. Reuse as-is per D-01. File may be renamed/moved by planner but visual + iOS hardening preserved.
- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` — Keep as-is; gate mount on `phase === "holding"`. Error variant shape is the template for D-07.
- `src/ui/features/pretty-view/DormancyOverlay.tsx` — Keep as-is; gate mount on `phase === "dormant"`. Wake button UX shape is the template for D-09.
- `src/ui/state/session-recycling-store.ts` — Publish contract preserved via SPEC req 7. Change the SOURCE of the publish call (from `showOverlay` to `phase === "holding"`), preserve the semantics.

### Terminal-side integration point
- `src/ui/features/terminal/Terminal.tsx:3181-3186` — PrettyView mount site. `isPrettyMode && hostConfig.id != null && tmuxSessionName` gates the whole subtree; `isVisible={isVisible}` prop is the source of truth for the warm re-focus entry trigger (patch #344 threading). No changes to Terminal.tsx expected in this phase beyond passing the same `isVisible` through.

### AppShell mount gate
- `src/ui/AppShell.tsx:~1832-1863` — `shouldAttach = inPane || activeInline || isInActiveSet` governs whether the Terminal + PrettyView subtree renders at all. Cold mount (activeSet add) and warm hidden→visible flips both flow through this gate. No changes expected; documented for downstream understanding.

### WS lifecycle behavior (READ but do NOT modify in this phase)
- `src/ui/features/pretty-view/PrettyView.tsx` WS-pause useEffect ~L1229-1240 (patch #344, `Quick 260808-b74`) — Closes WS on `!isVisible`; reopens on visible via `setRetryKey(k=>k+1)`. Retry-ladder onclose scheduler ~L1109-1160 (patch #148 lineage). iOS PWA visibilitychange handler ~L1189-1215.
- `src/ui/features/terminal/Terminal.tsx` mirror WS-pause effect ~L600 (patch quick-260809-eqk / #367 iter2) — Same pattern for Terminal SSH WS. Documented for context; this phase touches PrettyView only.

### Backend frame protocol (READ, do NOT modify)
- `src/backend/claude-session/claude-session-server.ts` — Emits the `active` / `inactive` / `session_holding` / `dormant` frames that populate `backendFirstFrame`. transitionToActiveNew ~L2201 (emits `session_changed` on Phase 3 recycle), transitionToDead ~L2297 (emits `inactive holding_timeout`), dormant-poll ~L3445 (emits `dormant true/false`). HOLDING_TIMEOUT_TICKS ~L164 (200 * 3s = 600s backend-side; frontend's 600000ms watchdog was in lockstep, both retire per D-04).

### Cross-cutting patterns (fork-specific rules — MUST honor)
- Motion channel guardrail (patch #72 lineage) — Static glyphs on state overlays, animated glyphs only on work-in-progress. Applied per D-03 + D-07.
- iOS Safari backdrop-filter hardening (patch #333 lesson) — `isolate [transform:translateZ(0)]` on any new backdrop-filter surface. The resolving spinner inherits this from PrettyViewLoadingOverlay.
- ComposeBox `*Active` props pattern — `recycleActive`, `dormantActive`, `reconnectingActive` prop-driven disable. Existing props stay wired; only their DERIVATION site changes (from local state to `phase`).

### Related bounty (may be superseded — evaluate at plan-phase)
- `~/.claude/roles/box-maintainer/bounties/pretty-view-conversation-pick-loading-feedback/` — Two open Ashley-questions from session 9 about revert-#351 timing and app-root-overlay-vs-anchored. This phase does NOT commit answers to those questions; loading-overlay is subsumed here in a way that leaves the questions still open for that bounty to close separately.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`PrettyViewLoadingOverlay`** (`src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx`): current spinner visual — glass card + Loader2 + "Loading…" copy + iOS hardening. Reused verbatim per D-01.
- **`SessionHoldingOverlay` error variant** (`SessionHoldingOverlay.tsx` `error` prop): full-surface warm-red card with RefreshCcw static glyph — template for D-07 error-phase UI. Copy this shape, don't reinvent.
- **`DormancyOverlay` + Wake button** (`DormancyOverlay.tsx`): UX shape for D-09 retry button (button inside card triggers user-initiated recovery action).
- **`session-recycling-store`** (`src/ui/state/session-recycling-store.ts`): pure module-scoped Map + subscribe pattern. Publish contract preserved per SPEC req 7. No refactor needed; only the publish call site's source changes.
- **`session-working-store`** (`src/ui/state/session-working-store.ts`): same publish pattern as recycling-store — if the new hook needs to expose derived state cross-pane (e.g. for future features), this pattern is the fork's convention.
- **`useSyncExternalStore`** — used by both stores; the new hook likely uses local `useState` + `useEffect` for its two subscribed inputs, not a global store (state is per-pane, not cross-pane).
- **Delay-arm useEffect pattern** — patch #74's `showOverlay` delay-arm at PrettyView.tsx:~1398 is the exact template for D-04's 150ms spinner-mount delay.

### Established Patterns
- **`isVisibleRef` mirror pattern** (patch #344) — refs mirrored via `useEffect([prop])` so callbacks (onclose scheduler, visibilitychange handler) read fresh values without stale-closure hazards. The new hook likely follows the same pattern for `wsState` + `backendFirstFrame` if they're consumed inside WS callbacks.
- **Ref-based mirrors for stale-closure protection**: `statusRef`, `dormantRef`, `isBootingRef` — same pattern each. New hook state that's consumed inside `ws.onmessage` needs the same treatment.
- **Structural-grep test gates** — Terminal.wiring.test.ts's `describe("quick-260809-eqk — hidden-pane WS-pause + diag fix")` block uses planted comment tags for reformatting-safe assertions. SPEC req 2 + 6 need equivalent grep gates on the overlay render sites.
- **Test seams for pure logic** — `layer1-detect.ts` (patch quick-260808-ohn) extracted pure state-derivation logic to a sibling file for unit-testable reducer + actions. The `resolvePhase(wsState, backendFirstFrame) → Phase` pure function (SPEC req 4) benefits from the same extraction pattern.
- **Existing tests to preserve** — full-suite green precondition (SPEC constraint). New tests build on top; existing PrettyView.test.tsx / PrettyViewLoadingOverlay.test.tsx / SessionHoldingOverlay.test.tsx / DormancyOverlay.test.tsx describe blocks must continue passing (mount-gate changes may require adjusting some existing assertions — planner audits).

### Integration Points
- **Terminal.tsx:3185** — `isVisible={isVisible}` prop pathway is source of truth for warm re-focus trigger. No changes expected.
- **AppShell.tsx:~1832-1863** — Cold-mount trigger via `shouldAttach` gate + createPortal. No changes expected.
- **Backend WS message types** — SPEC req 3's `backendFirstFrame` values map to existing frame types (`active` from initial `session` frame? Need planner clarity — TBD in plan-phase; may need to define an explicit "first frame" observation site because the current code has NO single "first-frame received" hook, it just reacts to each frame type as it arrives).
- **ComposeBox prop derivation** — `recycleActive={isHolding}`, `dormantActive={dormant || waking}`, `reconnectingActive={status === "error"}` currently. Post-phase: `recycleActive={phase === "holding"}`, `dormantActive={phase === "dormant"}`, `reconnectingActive={phase === "error"}`. Wiring layer only.

</code_context>

<specifics>
## Specific Ideas

- Ashley's flicker cases she named verbatim (SPEC background section captures these — regression tests must cover each):
  1. "screen fully black with Connecting…" on entry to a pane that was active moments ago
  2. "Connection lost" box covering half the screen briefly before disappearing
  3. "Waking up" showing for a second on a session that has been awake for a while
- Determinism framing (Ashley verbatim): *"there's no reason for this not to be deterministic"* — no timeout heuristics anywhere. Machine waits as long as inputs need.
- Entry-trigger set (Ashley verbatim on the 3-way ask): *"the answer is all three, because all three of those situations cause reconnections and settling of the state"* — cold mount, warm re-focus, PWA foreground all arm resolving.

</specifics>

<deferred>
## Deferred Ideas

- **Extend to Terminal panes.** Terminal has its own connection-status story (`status="connecting"|"streaming"|"error"` and reconnection UI) that shows analogous flicker on entry. Ashley: "I really only care about pretty view for this, so unless it makes it more difficult to exclude terminal, then we could just go with that." → excluded from this phase; future phase can apply the same pattern to Terminal if the win in pretty-view proves out.
- **Extend to RDP/VNC/Guacamole panes.** Same rationale as Terminal.
- **Two open Ashley-questions on `pretty-view-conversation-pick-loading-feedback` bounty** (revert-#351 timing; app-root-overlay-vs-anchored) — this phase leaves those questions untouched. That bounty stays open for Ashley to close separately.
- **WS retry-ladder redesign.** Explicit "failed-permanently" state may need to be surfaced from the WS layer (D-09). If a full retry-ladder redesign is preferred over an observation-based derivation, that's a separate phase — this phase consumes the signal as-is.
- **Backend "first frame" observation site.** Currently backend fires each frame type reactively; there's no single "first frame received" hook. If planner finds that this needs to be added (rather than observed by client), consider a small backend-side helper (still preserving frame protocol). Could be a small tag-along commit or a separate follow-up.

</deferred>

---

*Phase: 29-unified-session-entry-state-machine-single-resolving-spinner*
*Context gathered: 2026-08-10*
