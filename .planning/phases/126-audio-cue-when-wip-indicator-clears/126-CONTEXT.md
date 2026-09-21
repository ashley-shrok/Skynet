# Phase 126: Audio cue when WIP indicator clears - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning
**Source:** Pre-seeded from live design conversation between rain and Ashley on 2026-09-21 (origin bounty: `audio-cue-when-wip-indicator-clears`, pinned by Ashley 2026-09-07). No shape file; decisions below are locked in-conversation with Ashley's verbatim quotes cited. Per convention, /gsd:discuss-phase should not re-elicit ground already locked here.

<domain>
## Phase Boundary

Adds a subtle "tink" audio cue that fires each time a conversation row's work-in-progress (WIP) indicator disappears, gated so it only fires when there was genuinely new agent output during that work cycle AND the row's pane is currently visible on screen. The purpose is an audible "the agent is truly idle and ready for more instructions" signal — solving the case where agents produce multiple bubbles in a single work cycle (only one chime should fire at the terminal idle) and the case where a user is looking at another app / another pane / a phone screen when the agent finishes.

**In scope:**
- Per-row latch state machine (arm on agent-side bubble → fire on WIP true→false → disarm).
- Client-side pane-visibility gate on firing.
- Frontend audio playback subsystem (short "tink" sample, per-fire AudioBufferSourceNode, iOS PWA autoplay-unlock on first user gesture).
- The audio asset itself (short subtle sound, delivered inline or as a bundled asset).
- Tests: latch state transitions, visibility gate, iOS unlock guard.

**Explicitly out of scope:**
- **Any settings / preferences surface.** Ashley 2026-09-21 verbatim: *"we're not giving any kind of preferences the app has no preference surface and this isn't going to add it and it would default to on for everyone."* No opt-in toggle, no volume knob, no per-identity setting, no localStorage flag, no DB column, no query param.
- **Any refactor of the `inActiveSet` semantic on the ready-dot.** Ashley identified as a related-but-orthogonal concern in the same conversation ("*even though it's a tangent from what we're talking about now that the in active set concept is wrong as it is because ready dots should not be dependent on whether a session is currently open or was opened recently on the client*") and passed it to a different agent. This phase does NOT touch the ready-dot rules; it uses its own pane-visibility gate that is independent of `inActiveSet`.
- **Cross-user relay-room bubble handling.** Assistant-role bubbles from THIS row's agent are the trigger. Relay bubbles (peer-agent messages in a matrix relay room type of chat) are out of scope for the arming signal in v1; those rooms don't have the same "agent working" WIP lifecycle.
- **Distinct sounds per event type / per identity / per priority.** One sound for all fires.

</domain>

<decisions>
## Implementation Decisions

### The latch state machine — Ashley's rule as stated

- **D-01:** Each conversation row carries an in-memory `armed: boolean` latch. Initial value: `false`.
- **D-02:** **Arm event:** any new agent-side bubble arriving in the row's message stream sets `armed = true`. Ashley 2026-09-21 verbatim on the arming rule: *"i want a noise to go off each time the work in progress indicator disappears and there had been at least one new message bubble from the agent side since the last time it had disappeared."* The latch is the load-bearing encoding of that "at least one new agent bubble since the last time" gate.
- **D-03:** **Fire event:** on the row's `isWorking` transitioning from `true` to `false`, IF `armed === true` AND the fire gate (D-05) passes, play the tink AND set `armed = false`. Both writes happen atomically at the same transition.
- **D-04:** WIP flickers (true→false→true→false) with no intervening agent bubble don't chime — the latch was disarmed on the first fire, and no new bubble arrived to re-arm it. Multiple bubbles between two WIP-off events still fire exactly one chime at the terminal WIP-off (each new bubble sets `armed = true`, but the terminal fire+disarm still runs once). The latch shape naturally collapses multi-bubble work cycles into a single chime.
- **D-04a:** Design refinements rain proposed and Ashley rejected: (i) "arm only while `isWorking === true`" — Ashley 2026-09-21: *"i'm just not seeing how that functionally acts to differ than the original logic"*; concession recorded, D-02's unconditional arm is the locked rule. (ii) "gate the fire on `inActiveSet`" — Ashley rejected on two counts: `inActiveSet` in current code is client-session-history state (not agent-readiness state), and the correct gate is visual pane visibility (D-05), not follow-list membership.

### The fire-gate — pane visibility, not `inActiveSet`

- **D-05:** The chime fires ONLY if the row's chat pane is currently visible on screen at the moment of the WIP true→false transition. "Visible on screen" includes: (a) the row IS the sole visible pretty-view pane in the app, OR (b) the row's pane is one of the multiple panes visible in a split-view layout. Ashley 2026-09-21 verbatim: *"we should only play the sound if the session is currently visible on screen meaning it could be the only session visible or it could be the split view amongst a lot of other sessions."*
- **D-06:** Rows that are present in the conversation list but do NOT have an open pane don't chime. Rows in a background browser tab don't chime. Rows in a minimized / hidden window don't chime.
- **D-07:** Do NOT gate on `inActiveSet` — that variable tracks a different concept (client-side session-open history) and is explicitly the wrong axis for this decision. The visibility gate is computed from the current split-view / active-pane layout state, not from `activeSet`.

### The definition of "agent-side bubble" (D-02 arming signal)

- **D-08:** "Agent-side bubble" for arming purposes = a bubble representing the agent producing output in THIS conversation during a work cycle. In today's `ChatMessage` type in `src/ui/features/pretty-view/`, this means bubbles with `role === "assistant"` (the assistant reply bubbles). Ashley 2026-09-21 verbatim on the definition: *"i don't know what kind of bubbles exist so i can't really answer your agent side definition but i feel like it's fairly obvious like you want to know when the agent was working and stopped working"* — planner picks the exact predicate, but the intent is "did the agent produce output during this work cycle."
- **D-09:** User bubbles (`role === "user"` and pending-send optimistic user variants) do NOT arm the latch.
- **D-10:** System / event / notification bubbles (if any exist in this render pipeline) do NOT arm the latch. Only the agent's substantive reply content counts.
- **D-11:** `WaitingBubble` (the assistant-is-thinking placeholder) does NOT arm the latch — it's a placeholder for content that hasn't arrived yet; it's not the agent producing output.
- **D-12:** `RelayInboundBubble` (relay messages from other users' agents into a matrix relay room) does NOT arm the latch in v1. Rationale: relay rooms are agent-to-agent conversations, not "the row's agent working" — their WIP lifecycle isn't the same, and the semantic value of the chime doesn't cleanly apply. Explicitly deferred; can revisit if in-practice signal is that relay rooms want this too.

### The sound

- **D-13:** ONE sound, subtle, described as a "tink." Ashley 2026-09-21 verbatim: *"the sound can be a tank"* (voice-transcription "tank" understood as "tink"). No user-facing sound selector. Planner picks a specific short (~50-150ms) sample. Should be non-annoying at repeat firing volume — this cue fires many times per active session across many rows.
- **D-14:** Fixed playback volume in the code — no volume UI, no volume localStorage. If a volume adjustment turns out to be needed later, that's a follow-up phase, not this one.
- **D-15:** Sound asset ships in the bundle (no CDN fetch). Small enough to embed via `import` or `URL.createObjectURL(new Blob([...]))` from a base64-encoded const, OR referenced as a bundled static asset — planner picks by asset size and existing bundling conventions.

### Default-on, no preferences surface

- **D-16:** Default-on for all users, on every deployment, on every identity, on every client instance. Ashley 2026-09-21 verbatim: *"it would default to on for everyone."*
- **D-17:** NO preferences surface anywhere. Not in a settings modal, not in a right-click menu, not in the identity file, not in `localStorage`, not in URL params. Ashley 2026-09-21 verbatim: *"we're not giving any kind of preferences the app has no preference surface and this isn't going to add it."* If a future need arises to disable it, it's a code change, not a runtime toggle.

### iOS PWA autoplay unlock

- **D-18:** iOS Safari + iOS PWA installs block `AudioContext.resume()` and `HTMLAudioElement.play()` until a user gesture has fired in the current page session. Standard workaround: on app mount, install a one-time user-gesture listener that calls `audioCtx.resume()` (or plays an inaudible priming buffer) on the first `click`, `touchend`, `keydown`, or `pointerdown` event, then removes itself. rain 2026-09-21: *"I'll do that quietly"* (Ashley 2026-09-21 did not object).
- **D-19:** If the AudioContext hasn't been unlocked yet at the moment a fire would occur, the fire is silently dropped (no chime, no queued playback, no attempt to force a gesture). Rationale: an unheard chime is the correct outcome on a fresh iOS PWA session before any tap has landed; the user isn't interacting with the app yet so there's nothing to alert them about anyway.
- **D-20:** Desktop browsers (Chrome, Firefox, Safari, Edge) may or may not require an unlock depending on autoplay policy — the same first-gesture unlock handler covers them uniformly. No browser-sniffing.

### The audio subsystem module

- **D-21:** A new module (e.g. `src/ui/audio/ready-cue.ts` — planner picks exact path per conventions) owns: (a) the single shared `AudioContext`, (b) the buffered / decoded tink sample, (c) the `unlocked: boolean` state, (d) the first-gesture unlock listener install/uninstall, (e) the `playTink()` function. It has NO knowledge of rows, WIP, or the latch — it just plays a sample when called.
- **D-22:** The latch state lives per-row in the same store or component tree that already tracks `isWorking` per row (likely `session-working-store.ts` or its consumer in `PrettyConversationsPanel.tsx` — planner picks by existing structure). Latch reads/writes are cheap and do not need Zustand-store persistence — pure in-memory session state.
- **D-23:** The WIP-transition detection wires up in whichever hook currently reads `isWorking` for the row and re-renders on change (e.g. `useSessionIsWorking` at `PrettyConversationsPanel.tsx:265`). On observing the true→false edge with `armed === true` AND visibility gate passing, call `playTink()` and reset `armed`.
- **D-24:** The pane-visibility gate reads current split-view / active-pane state from wherever it's tracked (planner audits — likely `AppShell.tsx` or a split-view store). Returns a boolean per-row: "is this row's pane currently rendered as visible in the current app layout?"

### Testing

- **D-25:** Unit tests for the latch state machine: (i) arms on agent bubble, (ii) fires + disarms on WIP true→false when armed, (iii) does NOT fire when unarmed, (iv) multiple bubbles collapse to one chime, (v) WIP flicker without new bubble doesn't re-fire.
- **D-26:** Unit tests for the visibility gate: (i) fires when pane is sole-visible, (ii) fires when pane is one of many in a split, (iii) does NOT fire when row has no open pane, (iv) does NOT fire when app is in a background tab (if that state is observable via `document.visibilityState`).
- **D-27:** Unit test for iOS unlock guard: `playTink()` before unlock is a silent no-op, after unlock plays.
- **D-28:** Playwright smoke coverage NOT required for this phase — the audio cue is not observable in a headless browser meaningfully. Vitest coverage is the acceptance bar.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The WIP signal
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — the row-level render, the `useSessionIsWorking(sessionKey)` hook at :265, and the current `inActiveSet` prop threading. Understand this end-to-end before planning the WIP-transition hook.
- Session working store (path TBD by planner — likely `src/ui/lib/session-working-store.ts` or similar) — the source of truth for the per-row `isWorking` boolean; planner audits how transitions can be observed without polling.

### The visible-panes surface
- `src/ui/features/pretty-view/` — the pretty-view chat pane component; how it mounts / unmounts on split-view changes.
- `AppShell.tsx` — the shell that owns the top-level layout, sidebar toggle, and (presumably) the split-view state.

### The ChatMessage type + bubble taxonomy
- `src/ui/features/pretty-view/ChatMessage.tsx` (or wherever the assistant-role bubble renders) — the definitive taxonomy of "what is a bubble" and how `role === "assistant"` is expressed.
- `src/ui/features/pretty-view/WaitingBubble.tsx` and `RelayInboundBubble.tsx` (if present) — the two other bubble variants explicitly out-of-scope for arming (D-11, D-12).

### The role-file locked semantic
- The box-maintainer role file's § "Skynet conversation-list dot semantics" — Ashley's locked rule: dot has ONE meaning ("ready for your attention"), gated on `inActiveSet && !isWorking`. This phase does NOT modify that rule; the visibility gate (D-05) is a separate concept that lives per-fire, not on the ready-dot.

### Origin bounty
- `~/fleet/roles/box-maintainer/bounties/audio-cue-when-wip-indicator-clears/bounty.json` — the pinned Ashley 2026-09-07 capture.

</canonical_refs>

<specifics>
## Specific Ideas

- **Tink asset origin:** planner picks a concrete short sample. Options include: (a) a bundled ~50-100ms synthetic ping generated at build time (smallest bundle), (b) a small mp3/wav asset in `src/ui/assets/audio/`, (c) a base64-inlined const in the audio module. All three are viable; planner picks based on existing bundling conventions and asset-hosting story in the repo.
- **First-gesture unlock — event surface:** listen for `pointerdown | click | touchend | keydown` at `document` scope, `{ capture: true, once: true, passive: true }`. The `once: true` auto-removes; the handler internally calls `audioCtx.resume()` and sets an `unlocked = true` module-level flag. Idempotent — safe if called multiple times.
- **Latch state placement — two reasonable options:** (a) a `Map<sessionKey, boolean>` inside the session-working-store next to the per-row `isWorking` state (co-locates state that changes on the same edge), or (b) a `useRef<Map<...>>()` in the `PrettyConversationsPanel` consumer that reads the transitions. Planner picks by whichever composes cleaner with the current store.
- **Visibility computation:** a hook like `useRowIsVisible(sessionKey)` that reads the split-view / active-pane state and returns `boolean`. Called once per transition, not every render.

</specifics>

<deferred>
## Deferred Ideas

- **`inActiveSet` semantic on ready-dot** — passed to a different agent 2026-09-21. Orthogonal to this phase; no cross-dependency.
- **Volume adjustment / user preference** — punted per D-14, D-17. If future need arises, it's a follow-up phase.
- **Relay-room bubble arming** (D-12) — deferred until in-practice signal that relay rooms want the cue too. Would require a separate arming rule anyway (matrix relay bubbles have a different lifecycle than direct-agent bubbles).
- **Different sounds per event type / priority** — one sound in v1.
- **Cross-tab / cross-window silencing** (e.g. don't chime if the same session is visible in another window on the same machine) — not designed. Ashley did not raise this concern.

</deferred>

---

*Phase: 126-audio-cue-when-wip-indicator-clears*
*Context gathered: 2026-09-21 via live design conversation between rain and Ashley*
