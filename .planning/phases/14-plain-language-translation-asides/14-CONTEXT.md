# Phase 14: Plain-language translation asides - Context

**Gathered:** 2026-07-26
**Status:** Ready for planning
**Source:** Verbatim from design session between Ashley and Tina in the `plain-language-translation-asides` bounty (2026-07-26T15:52-15:58Z). Full timeline lives at `~/.claude/identities/tina/bounties/plain-language-translation-asides/bounty.json`.

<domain>
## Phase Boundary

Layer a **plain-language translation aside** feature on top of the existing pretty-view rendering + ComposeBox + fleet-identity-session infrastructure that Skynet already has (Phases 1, 2, 4, 5, 6, 7, 9, 10 shipped or in progress). The feature is purely additive on fork-local pretty-view code paths — no upstream Skynet surfaces are touched. The full feature has to LAND before the queued `#150 A + C` deploy ships (Ashley 2026-07-26 verbatim: "there's no point in deploying until we get it in") — so the deploy sequence when this phase completes is bundled: #150 A + C + this feature's patches together in one deploy event.

### What the feature IS (mental model — read this before anything else)

When Ashley is looking at pretty-view for a fleet-identity session and a Claude Code agent finishes an assistant turn, she frequently comes back to that tab later to find several agent bubbles have accumulated since her last message (because the agent got woken by monitors + relay pings + the like). She wants to walk into the tab and immediately understand what the agent has been saying, without scrolling back and mentally parsing dev-jargon-heavy replies.

Solution: after any completed assistant turn on an actively-watched fleet-identity session, silently ask the agent (via Claude Code's own `/btw` slash-command) to re-explain what's currently going on in plain, non-technical language — then display that plain-language response as an **AsideBubble** at the bottom of pretty-view's message stream, visually distinct enough that she never confuses it with a real assistant reply. While an aside is displayed, sending / queueing / thumbing-up / resetting are all locked — she must first tap the aside's "Resume" affordance (X icon) to dismiss it. Her partial-draft text in the compose textarea is preserved untouched.

Ashley's operational context — she bounces between ~5 active identity sessions doing "answering questions and explaining things," so this feature only earns its keep when it fires across ALL of those sessions, not just the currently-focused one. The intended UX is: leave session X's tab to work on session Y, come back to X later, aside is already there waiting.

### What the feature IS NOT (scope fences — do not violate)

- **Not a custom translation pipeline.** Ashley explicitly rejected the parallel-Anthropic-call design ("I am not going to set up our own custom pipeline for this when the stuff that we need is sitting right there"). The mechanism uses Claude Code's `/btw` verbatim, injected via `tmux send-keys` and extracted via `tmux capture-pane`. There is no separate Anthropic API call, no Haiku detector, no worth-explaining filter, no persona-seeded prompt — the /btw runs against the SAME agent so the aside voice IS the agent's voice by construction.
- **Not an overlay.** The AsideBubble sits in-flow at the bottom of the scrollable message list. Ashley must be able to scroll up freely to re-read history while the aside sits pinned at the bottom.
- **No aside store.** No database row, no in-memory key-value cache, no persistence layer. The tmux BTW overlay itself is the sole source of truth ("fewer moving pieces is better" — Ashley 2026-07-26). Backend is a pure translator.
- **No worth-explaining filter (v1).** Every completed assistant turn fires. If it fires too often in practice, we'll add a Haiku filter later — but not yet.
- **Not for anonymous claude sessions.** Only fleet-identity sessions (i.e., sessions running under `/id <name>` inside a per-identity tmux) get the feature. Anonymous ad-hoc `claude` sessions in random SSH tabs are excluded from scope.
- **Not for sessions with zero open tabs in the current browser window.** If Ashley closed all pretty-view tabs on session Y, then Y stops receiving aside fires until she opens one again.

</domain>

<decisions>
## Implementation Decisions

Every item below is a LOCKED decision from the 2026-07-26 design session. Do not re-litigate.

### Mechanism (empirically verified 2026-07-26 via kumquat test on Claude Code 2.1.150)

- **BTW answer text has zero disk footprint.** The kumquat test confirmed: the test session's JSONL was 12 lines both before AND after a /btw exchange, `sidechain`/`byTheWay`/"btw" as message-content markers = not found, only 6 matches to "kumquat" all from the `cwd` field mentioning `/tmp/btw-kumquat-test`. The BTW question text lands in `~/.claude/history.jsonl` as global CLI input history (one file for the whole box, keyed by sessionId) — but the ANSWER is terminal-only, painted into the tmux buffer and its scrollback.
- **tmux `capture-pane` DOES see the BTW answer** — both the live pane view and scrollback (`-S -N`). End-of-answer marker is a reliable line: `↑/↓ to scroll · f to fork · Esc to close`. Sending `Escape` cleanly closes the overlay and returns the pane to the normal compose prompt with the main conversation intact.

### Trigger — frontend-arm architecture (locked 2026-07-26 post plan-checker B1/B2/B4)

- The frontend PrettyView component ALREADY receives an `isIdle` prop from Terminal.tsx (established during Phase 9's WIP-indicator work — this IS the WIP-indicator's idle-window signal, no reimplementation). On the `isIdle: false → true` transition (agent just settled after a completed turn), PrettyView WS-sends `{type: "aside_arm"}` to the backend's pretty-view WSS (port 30011). Backend receives the message, arms its `/btw`-inject-and-extract poller for THAT connection. No parallel debounce anywhere; the idle-signal source of truth remains where it always was (Terminal.tsx → PrettyView prop).
- **Why frontend-arm and not backend-hooked:** the pretty-view WSS (port 30011, in `claude-session-server.ts`) is a DIFFERENT WSS on a DIFFERENT port from the terminal WSS (port 30002, in `terminal.ts`) where the `type:"idle"` event originates. Those two closures don't share state. Rather than refactor the idle signal into a shared event bus, the frontend — which already has `isIdle` in scope — is the cheapest single source of the arm signal.
- **Identity gating happens frontend-side too.** PrettyView only sends `aside_arm` when its own `pvIdentity` (from `useSessionIdentity(tmuxSession)` in `src/ui/features/terminal/session-hue.ts`) is non-null. Anonymous sessions never emit the arm, so the backend never has to know identity vs anonymous. Fully aligned with ASIDE-02.
- Active-set = "fleet-identity sessions with at least one open pretty-view tab across all currently-connected browser windows/clients that emit `aside_arm` for that session." Aside triggers fire per session where at least one client is arming on turn-idle. If all pretty-view tabs on session X close, no client is emitting `aside_arm`, so aside firing stops naturally.

### Backend per-connection state — MODULE-SCOPE, not closure-scope (locked 2026-07-26 post plan-checker B3)

`asideDisplayed` and `asideExtractionArmed` (and any related per-connection flags) live in a **module-scope `Map<WebSocket, {armed: boolean, displayed: boolean}>`** at the top of `claude-session-server.ts`, NOT as `let` variables inside `wss.on("connection")` closure. This is load-bearing for cross-tab dismiss coherence (ASIDE-11): when broadcast fans out an `aside_dismissed` frame to all peer clients' WSes, the broadcast primitive also flips each peer WS's entry in this Map (so the peer connection's overlap-ignore gate resets correctly for the next turn). Closure-scoped `let` variables would leave stale gates on peer connections and silently break the v1 overlap policy across tabs.

### Injection

- Backend SSHes into the identity's box (existing SSH exec channel — reuse, do not open new subsystem) and `tmux send-keys -t <identity-tmux-target> "/btw <prompt>" Enter` into the agent's tmux.
- **The prompt text is fixed** — inlines the `/explain` skill body verbatim (Ashley 2026-07-26 explicit direction: "we might just take whatever's inside the explain skill and put it into the prompt for this btw thing rather than talk about the explain skill"):

  ```
  /btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.
  ```

- The identity-tmux-target is known to Skynet's session-to-host mapping (already established during Phase 1 backend session-tail work — reuse).

### Extraction

- Backend polls `tmux capture-pane -t <identity-tmux-target> -p` at ~200-400ms cadence after injection.
- Detects end-of-answer by watching for the marker line `↑/↓ to scroll · f to fork · Esc to close` to appear + pane content stable for two consecutive polls.
- Extracts answer text as everything between the echoed `/btw` line and the marker line.
- **Multi-line answers exceeding the visible pane**: primary path is grabbing from `capture-pane -S -<N>` (scrollback — verified to contain the answer text). Fallback: send `↑` keystrokes to scroll the overlay up, capture, `↓` to scroll down, capture, reassemble. Fallback would visually flicker for anyone SSH-attached to that tmux at that moment, but pretty-view users don't render the terminal so they don't see it.

### Rendering (frontend)

- **New bubble type `AsideBubble`.** Rendered at the very bottom of the pretty-view message-bubble list, IN-flow inside the scrollable stream (not an overlay, popup, or fixed-position element). Scroll behavior is unchanged: scrolling up to re-read history works exactly as before; the aside is pinned at the bottom of the list.
- **Visual treatment (Ashley signed off on defaults 2026-07-26 via the `aside-visual-snippet.js` DevTools prototype in the bounty folder):**
  - Background: same identity-hue gradient as normal assistant bubbles (`hsla(var(--pv-id-hue),50%,38%,0.55)` → `hsla(var(--pv-id-hue),45%,24%,0.6)`) — the aside is a bubble from the SAME identity, semantically.
  - Border: **10px solid** `hsla(var(--pv-id-hue), 90%, 65%, 1)` — full saturation, opaque.
  - Neon glow (three stacked outer shadows in the hue at descending alpha, ADDITIVE to the bubble's existing depth shadow + inner rim):
    - `0 0 12px hsla(var(--pv-id-hue), 100%, 60%, 0.7)`
    - `0 0 32px hsla(var(--pv-id-hue), 100%, 55%, 0.5)`
    - `0 0 64px hsla(var(--pv-id-hue), 100%, 50%, 0.3)`
- Component should accept a `glow` multiplier prop (default 1.0) so future iteration can dial the intensity without rewriting the CSS. Border-width should be configurable at the component level (default 10px) but this is not user-tunable at v1.

### ComposeBox morph (frontend)

While an aside is currently displayed for a session:
- **Send button** replaced with an **X icon** (Ashley chose X over play-arrow: "play arrow is too close to the send icon already that's there"). Hover tooltip: "Resume". Style change to visually distinguish from send.
- **Queue-message affordance**: disabled/greyed.
- **Thumbs-up affordance**: disabled/greyed.
- **Reset-session affordance**: disabled/greyed.
- **Textarea**: remains editable. Any partial draft text is preserved verbatim — never cleared or overwritten by the aside displaying.

### Dismiss

- Clicking the X (Resume) affordance triggers:
  1. Frontend removes the AsideBubble from that session's message stream immediately (optimistic).
  2. Frontend reverts ComposeBox to normal state (send button back, all affordances re-enabled).
  3. Frontend WS-sends `aside_dismissed` event to backend for that session.
  4. Backend `tmux send-keys -t <identity-tmux-target> Escape` to close the underlying BTW overlay.
  5. Backend WS-broadcasts `aside_dismissed` to ALL clients subscribed to that session (cross-tab dismiss coherence — any other browser tab viewing the same session also clears its aside).
- Textarea content is preserved through dismiss.

### Overlap policy (new turn while aside displayed)

**v1: ignore.** If a new completed turn arrives on a session that has an aside currently displayed, the currently-displayed aside stays unchanged and the newer turn does NOT fire its own aside. The newer turn is otherwise unaffected. Ashley: "let's just ignore the new turn's aside until the current one is dismissed and we'll see how that goes." Revisit if too much translation coverage is lost in practice.

### Tab close / re-attach

- When a pretty-view tab is closed while its aside is still displayed, the tmux BTW overlay is LEFT OPEN — backend does not send Escape, does not clean up.
- When a pretty-view subsequently mounts for that same session (any browser tab, any browser session — same or new), the backend pane-probes the identity's tmux ONE time via `capture-pane`, detects the still-open BTW overlay if present, extracts its answer, and emits `aside_ready` to the mounting client so the aside is re-rendered in the same displayed state.

### State model (crucial)

**NO aside store anywhere.** The tmux BTW overlay itself is the sole source of truth for "is there an aside for this session and what does it say." Backend is a pure translator:
- Emits `aside_ready` events when it detects an overlay landing.
- Forwards `aside_dismissed` commands to tmux (Escape).
- Broadcasts `aside_dismissed` when it observes the overlay disappearing (either from a client-initiated Escape or from any other reason — Ashley SSH-attaching and pressing Escape herself, tmux session death, etc.).
- Backend restarts recover state by re-probing on next event — no persistence layer, no in-memory KV, no DB row.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source-of-truth
- `~/.claude/identities/tina/bounties/plain-language-translation-asides/bounty.json` — full design session transcript captured in `timeline[]`, including the empirical kumquat-test findings, the /explain-skill-inlining decision, the aesthetic-locking decision, and the deploy-bundling decision
- `~/.claude/identities/tina/bounties/plain-language-translation-asides/aside-visual-snippet.js` — DevTools console recipe Ashley used to sign off on the visual aesthetic; also the canonical source for the exact CSS values planners should replicate

### Existing infrastructure this phase LAYERS ONTO (do not re-implement — read + reuse)
- `src/ui/features/pretty-view/PrettyView.tsx` — the pretty-view surface. New AsideBubble goes into its message-bubble list at the bottom. `--pv-id-hue` CSS var is set on this component (line ~702).
- `src/ui/features/pretty-view/ChatMessage.tsx` — the existing assistant bubble treatment (line 118-129) is the template to fork for AsideBubble's non-neon layers. See lines 124 (background), 126 (border), 127 (existing shadows).
- `src/ui/features/pretty-view/ComposeBox.tsx` — the compose bar. Morph logic goes here (send→X, disable affordances, preserve textarea).
- `src/ui/features/pretty-view/ImageBubble.tsx`, `PlanPendingBubble.tsx` — precedent for how new bubble types are added alongside ChatMessage (both use the same `--pv-id-hue`-tinted glass depth as ChatMessage).
- Backend session-tail infrastructure (established Phase 1, `01-01-PLAN.md` through `01-05-PLAN.md`) — the SSH exec channel discovering the Claude process, locating the JSONL, tailing it, streaming events over WS on port 30011. This phase adds a NEW WS event type (`aside_ready` / `aside_dismissed`) on that same bridge — do NOT open a new port or a new subsystem.
- ComposeBox WIP-indicator idle-window logic (established Phase 9, patches #116-#122). Trigger reuses this — find the existing debounce and hook the aside-fire trigger into the same signal. Do NOT introduce a parallel debounce.
- Fleet-identity session tracking (established Phase 7 shape file `.planning/shapes/shape-fleet-native-conversation-list.md`) — how Skynet knows "this tmux target is identity Y's session." Reuse the mapping; do not re-derive.

### Claude Code /btw behavior (empirically established 2026-07-26)
- `/btw <question>` typed into an interactive Claude Code CLI opens an overlay in the terminal buffer, returns an ephemeral answer, and closes on Escape with zero session-JSONL footprint. The answer is captureable via `tmux capture-pane -p` (visible pane) or `tmux capture-pane -S -N` (scrollback). End-of-answer marker: `↑/↓ to scroll · f to fork · Esc to close`. See bounty timeline for the kumquat-test verification.

### Fleet rules that apply
- `~/.claude/identities/tina/tina.md § Deploy discipline` — every build → deploy is a new "may I?" moment; batching until Ashley says deploy is the norm.
- `~/.claude/identities/tina/tina.md § Skynet direction — the app IS Telegram` — pretty-view chat surface interior is LOCKED; this phase adds a NEW bubble type to it (that IS allowed — the "STRUCTURALLY DONE AND LOCKED" carve-out explicitly allows adding NEW pretty-view features).

</canonical_refs>

<specifics>
## Specific Ideas

- **Prompt text is EXACTLY**: `/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.` (Do not paraphrase, do not tune, do not add framing. This is Ashley's chosen prompt.)
- **End-of-answer marker to grep for**: the literal string `Esc to close` (part of the full marker `↑/↓ to scroll · f to fork · Esc to close`). Stable across BTW invocations in Claude Code 2.1.150.
- **Extraction stability requirement**: two consecutive polls with identical pane content is the "answer complete" condition. Do not emit `aside_ready` on the first poll that sees the marker — the answer may still be streaming.
- **Cross-tab coherence**: WS broadcast to all clients that have subscribed to the session's pretty-view WS stream. No new subscription mechanism needed — the existing per-session pretty-view WS subscription IS the fan-out list.
- **Active-viewer count for triggering**: derived from currently-connected pretty-view WS subscriptions. When count goes 0 → 1 (someone opened a tab), the session becomes eligible for aside firing on the next completed turn. When count goes 1 → 0 (last tab closed), aside firing stops. Do not persist "recently active" — it's a live count.

</specifics>

<deferred>
## Deferred Ideas

- **Worth-explaining Haiku filter.** Ashley: "if we decide that it's fired too often or something, then maybe we will add a haiku call or something, but not yet." Do NOT include in v1.
- **Aside history / stacking.** Only ONE aside displayed at a time per session (the newest, and only when no aside is currently displayed). No queue, no scrollable aside archive.
- **Persona-seeded explainer prompt.** The /btw runs against the SAME agent so the aside voice IS the agent's voice for free — no separate persona seeding needed.
- **Per-tab-focus scoping.** Ashley explicitly rejected: aside firing is per active-set (all tabs across the current browser window), NOT per focused tab. She wants asides to accumulate on tabs she hasn't visited yet.
- **Automatic dismiss on new user message.** Not for v1. She dismisses manually via the X (Resume).

</deferred>

---

*Phase: 14-plain-language-translation-asides*
*Context authored: 2026-07-26 by Tina, verbatim from design session with Ashley (bounty `plain-language-translation-asides`, timeline entries 15:52-15:58Z)*
