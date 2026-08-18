# Phase 43: Replace PrettyView virtualization with plain-DOM windowed pagination (drop-oldest working set) — Context

**Gathered:** 2026-08-18
**Status:** Ready for planning
**Source:** Design conversation between Ashley + Tina 2026-08-18 (this session) — decisions locked below. Two pre-plan backend research questions answered before context was frozen (see `<canonical_refs>` for the file evidence).

<domain>
## Phase Boundary

Retire the TanStack Virtual message list in PrettyView (Phase 27/28/32) in favor of a plain-DOM scroller backed by a bounded working-set window. The message list becomes an ordinary scrollable div holding N recent messages as normal children. Scrolling near the top fetches and prepends the previous batch. When the loaded window grows past a cap during a long live session, the oldest messages drop from the DOM; if the user later scrolls back past the cap, the dropped range is refetched from the JSONL file (source-of-truth on disk).

The browser's built-in `overflow-anchor: auto` (default in modern browsers) preserves visible content across prepends and image-load height changes — a solved problem the virtualizer was fighting rather than leveraging. Auto-scroll simplifies from three fighting actors (user scroll, virtualizer correction writes, follow-to-bottom heuristics) to one: user scroll. The follow-to-bottom rule becomes "if pinned when a new message arrives, scroll to bottom." No RO-vs-scroll delta heuristics, no virtualizer-write filtering.

Backend WS gains a `historyWindow: N` handshake param bounding the initial `-n +1` replay to `-n N`, and a new `fetch_older` request for range reads triggered by scroll-up. The observation channel (layer1-detect, context-pct, plan-pending, backgroundedAgents/Shells, id-reset detection) still tails the whole file untouched — only the emission channel is windowed.

This phase does NOT change what a message bubble looks like, does NOT change parseSessionLine or the wire frame shapes for `message`/`image`/`relay_outbound`/`relay_inbound`/malformed emissions, and does NOT change any observation-channel derivation. It changes HOW MANY frames the client holds and WHEN they arrive.

</domain>

<decisions>
## Implementation Decisions

### Architecture — the escape from estimate-and-correct

- **Delete TanStack Virtual entirely from PrettyView.tsx.** The message list becomes a plain-DOM scroller. Messages render as normal children of a scrollable div; heights are what the browser measures. Ashley 2026-08-18 verbatim: *"I really feel like a solution where we don't virtualize but instead load as the user scrolls up would be most of what we need because we don't have to care about heights then."*
- **`overflow-anchor: auto` is load-bearing.** It's browser default; the plan MUST verify no CSS anywhere in the PrettyView tree disables it (`overflow-anchor: none`). This is what preserves visible content when older messages are prepended, when images load and grow their bubbles, and when code blocks re-layout on width changes.
- **The virt-jitter class of bugs disappears by construction.** No estimate-then-correct. No RO firing on ambiguous signals. No scroll-adjustment writes competing with user scrolls. If the plan verifies the plain-DOM path renders correctly at the load-older prepend seam, the pattern is done.

### Working set — sizes are DESIGN DECISIONS for the planner to lock

- **Initial window size `N` (last N messages loaded on connect):** planner picks with rationale. Starting point: 50. Threshold: enough to cover the visible viewport plus a few screens of scroll-back so the load-older fetch isn't triggered on trivial scrolls. Ashley did not specify a hard number — planner call.
- **Working-set cap `M` (max messages held in DOM at once):** planner picks with rationale. Starting point: 150. Threshold: high enough that a single-session-worth of talking doesn't hit it frequently, low enough that plain-DOM cost stays bounded. Ashley did not specify a hard number — planner call.
- **Drop policy: drop from the OLDEST end when live-append pushes past cap.** Live tail always keeps the newest messages; oldest fall off. Ashley's framing: *"they'll probably never scroll back up that far. But then on sessions where... they accumulate the whole 200 messages during that client session and in that case that would start to become a problem except they're probably not scrolling back up a lot so we just drop the old messages as they go."*
- **Refetch dropped range on scroll-back:** if the user scrolls to the top of the loaded window and the window's oldest message is NOT the file's line 1, fire a fetch_older to pull the previous batch and prepend.
- **Refetch batch size `K` (how many messages per fetch_older request):** planner picks. Reasonable default: same as N (so scroll-back feels like "load another screen"). Planner call.

### Backend contract additions

- **`historyWindow: N` on WS handshake.** Client sends `N` in the connect params (or first message; planner picks wire shape). Server parameterizes the initial `tail -F -n +1` command to `tail -F -n N` (or equivalent — planner may prefer `tail -n N + tail -F` composition if `tail -F -n N` semantics differ). Missing/unset → current unbounded behavior (backcompat for callers that don't opt in).
- **`fetch_older` WS request.** Payload includes an anchor (either the oldest currently-loaded eventId, or a line offset the client tracks) and a count. Server does a one-shot ssh exec to read the target line range from the JSONL file (`sed -n 'M,Np'` or equivalent; planner picks the shell primitive), parses each line through `parseSessionLine`, and emits the parsed frames back as a batched response (typed distinctly from live-tail frames so the client knows they're historical). Client prepends them to `messages[]`.
- **Observation channel UNTOUCHED.** `onLine` in `claude-session-server.ts` continues to receive every line from the whole-file tail. Every observation derivation (layer1-detect for /id reset arm+clear + tail-state, context-pct-from-jsonl, plan-pending-parser, backgroundedAgents + backgroundedShells sets, notification-payload detection at ~L2200, id-reset detector at ~L2044) reads every line regardless of what the client sees. This decoupling is the reason the refactor is small and safe.
- **Backcompat / migration:** client requests `historyWindow` on every new connect once shipped. Legacy clients (any that don't send it) get the current unbounded behavior — the server does NOT unilaterally window emissions unless the client asks. Planner: verify no other clients (tests, dev tools, external harnesses) rely on the current always-full behavior.

### Frontend simplifications enabled

- **`useAutoScroll` collapses dramatically.** Delete the RO gymnastics, the `<20px` scroll-delta heuristic that filters virtualizer writes from user scrolls, the sticky-vs-programmatic tracking, and the tall-bubble jump-to-different-area protection. Keep only: track "is user pinned to bottom" as a boolean derived from `scrollTop + clientHeight >= scrollHeight - EPSILON`; when messages.length grows AND pinned, scroll to bottom. That's the whole hook. Planner: rewrite (or delete + inline) `use-auto-scroll.ts`; the hook is currently 245 lines and should end well under 60.
- **The three-actor scroll problem collapses to one actor.** No more virtualizer writing to scrollTop. `overflow-anchor` handles the "content above viewport changed size" case. Auto-scroll only fires on new-message-append while pinned.
- **Delete TanStack Virtual dependency.** `@tanstack/react-virtual@3.14.9` removed from package.json. Bundle shrinks by ~5KB.
- **`estimatePvBubbleSize` and `getItemKey` are dead code.** Remove.

### Aside-arm suppression walk (frontend all-messages-in-memory audit)

- **Confirmed safe with windowing.** The one backwards-walk over `messages[]` (PrettyView.tsx:2056, aside-arm suppression on /id commands) walks from `messages.length - 1` backward looking for the last user turn. With drop-oldest windowing, the LAST user turn is always still in the loaded window because we drop from the OLDEST end, never the newest. No changes required.

### Load-older UX

- **Silent-when-fast, indicator-when-slow.** If the fetch_older response lands within ~150ms, don't show a loading indicator (would flicker). If it takes longer, show a subtle "loading older messages…" hint at the top of the scroller. Planner: define the exact threshold and hint styling.
- **Fetch trigger: near-top scroll.** When user scrolls within ~500px of the top of the loaded window AND older messages exist (i.e., the oldest loaded message isn't the file's first message), fire the fetch. Debounce so a fast flick-scroll doesn't fire multiple parallel fetches. Planner: pick threshold + debounce window.
- **Fetch failure handling:** if the WS request fails or times out, log and leave the scroll where it is. Do NOT retry infinitely. User can scroll back down and up again to re-trigger. This is a rare edge case; keep it dumb.

### Accepted tradeoffs (Ashley + Tina 2026-08-18)

- **Browser find-in-page (⌘F) searches loaded window only.** Same behavior as iMessage / most modern chat clients. Ashley already accepted this in Phase 27 CONTEXT.md verbatim: *"I don't really care about losing that functionality."* No in-app search sibling bounty required.
- **Load-older adds a round-trip on scroll-back past the window.** User perceptible on slow connections. Ashley framing: *"they'll probably never scroll back up that far."* Load-older is expected to be uncommon, not routine.
- **Refetch of dropped ranges is not free.** If the working set has cycled and the user scrolls back past everything currently loaded, we re-tail the JSONL for that range. Cheap on disk (single-digit ms typical for a few-KB range on this box), plus WS round-trip. Acceptable for the pattern Ashley described.
- **This phase does NOT solve very-long-session memory growth on the SERVER side.** The server still tails the whole JSONL for its observation channel. That's a separate concern (out of scope; JSONL files are typically <10 MB in practice; observation-channel derivations don't accumulate state proportional to line count).

### Deletion scope

- **PLAN.md-declared deletes:** every use of `useVirtualizer`, `VirtualItem`, `observeElementRect`, `estimatePvBubbleSize`, `getItemKey`, `initialRect`, `scrollMargin` in `PrettyView.tsx`. Plus `@tanstack/react-virtual` from package.json / package-lock.json. Plus the entire `PrettyView.virtualization.test.tsx` file. Plus `PrettyView.estimateSize.test.tsx`. Plus the RO/delta/programmatic-scroll machinery in `use-auto-scroll.ts` (rewrite from scratch).
- **PLAN.md-declared preserves:** every rendered bubble component (ChatMessage, ImageBubble, RelayInboundBubble, RelayOutboundBubble, MalformedBubble, WipBubble, PlanPendingBubble, AsideBubble, WaitingBubble). Every wire-frame parsing type in session-file-parser.ts. Every observation-channel derivation in claude-session-server.ts. All rendering styles beyond the virtualizer container div itself.
- **Planning artifacts left as historical record:** Phase 27, 28, 32 planning directories stay on disk untouched. They document why we tried virt, what didn't work, and what we learned. Not deleted, not renamed.

### Claude's Discretion

- **Exact wire shape for `historyWindow` and `fetch_older`:** query param, first WS message payload, or field on existing `openClaudeSessionSubscribe` payload — planner picks. Rationale: whichever is smallest change to the existing `claude-session-server.ts` request-handling switch, without introducing a new WS route.
- **Exact anchor mechanism for `fetch_older`:** oldest-loaded eventId vs line offset. eventId is more portable across file rotations; line offset is simpler on the backend. Planner: pick with rationale, document the tradeoff.
- **Whether to use `sed -n 'M,Np'` vs `awk 'NR>=M && NR<=N'` vs a small Node-side stream reader** for the range read on the backend. Any of these are fine; pick the one that matches existing `session-file-tail.ts` style closest.
- **CSS/DOM structure of the plain-DOM scroller.** Any structure that (a) has a scrollable overflow, (b) does NOT set `overflow-anchor: none`, (c) renders each message as an in-flow child so `overflow-anchor` can pick anchor elements. Planner: pick concretely and lock it, don't leave to executor.
- **Test coverage shape.** Delete virt-specific tests, but the phase MUST land tests locking (a) initial-connect emits only last-N frames, (b) fetch_older returns a range and client prepends, (c) drop-oldest fires when messages.length exceeds cap on live-append, (d) refetch-on-scroll-back rehydrates a previously-dropped range, (e) auto-scroll follows-when-pinned and doesn't yank when scrolled up, (f) `overflow-anchor` is not disabled anywhere in the tree.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design conversation (authoritative — this session)

- Ashley + Tina 2026-08-18 conversation locked the direction. Ashley's verbatim: *"I really feel like a solution where we don't virtualize but instead load as the user scrolls up would be most of what we need because we don't have to care about heights then. And most of the time, if you load in the last X messages, it would be enough for anything that you're doing in that session. and we could even drop old message bubbles if a session was long lived enough on the client meaning like it's easy to talk about a conversation where there are 200 back and forth messages but the user comes in on a fresh client clicks on that session and then you know we only load in a handful of recent messages, and they keep going because they'll probably never scroll back up that far. But then on sessions where, let's say it was a new conversation started on that client during that client session, and they talk to that conversation long enough where they accumulate the whole 200 messages during that client session and in that case that would start to become a problem except they're probably not scrolling back up a lot so we just drop the old messages as they go."*
- Bounty: `~/.claude/roles/box-maintainer/bounties/replace-pv-virtualization-with-windowed-pagination/bounty.json` — captures the same design + pre-plan backend research answers.

### Live backend code (must read before planning backend contract additions)

- `src/backend/claude-session/session-file-tail.ts` — the `tail -F -n +1` helper (~100 lines). Header comment locks the "read from the beginning, then keep emitting" design (BACKEND-03). Phase 43 parameterizes this to accept an initial-lines override.
- `src/backend/claude-session/claude-session-server.ts` — the WS handler (~5638 lines). Key regions:
  - `onLine` handler at ~L2014 — the two-path split (observation vs emission). PHASE 43 MUST NOT TOUCH THE OBSERVATION HALF.
  - `parseSessionLine` emission switch at ~L2394-2460 — the five emission cases (message/image/relay_outbound/relay_inbound/malformed). Phase 43 preserves these frame shapes exactly; only the QUANTITY emitted at connect changes.
  - `dormant-poll` + `layer1-detect` observation branches — reads `layer1.mostRecentUserTurnIsIdReset` from EVERY line. Untouched.
- `src/backend/claude-session/session-file-parser.ts` — parser + emission types (`ConversationalMessage`, `ImageMessage`, `RelayOutboundMessage`, `RelayInboundMessage`, `ParsedLine`). Wire shapes MUST NOT change (backcompat with live clients on the same branch until deploy).
- `src/ui/api/claude-session-api.ts` — WS client hook (~889 lines). Read the frame-handling shape before designing the `fetch_older` response type.

### Live frontend code (must read before rewriting scroller + auto-scroll)

- `src/ui/features/pretty-view/PrettyView.tsx` — the message list surface (~2732 lines). Virtualizer usage clusters at ~L920-1000 (setup) + ~L2370-2440 (render). Aside-arm backwards-walk at L2056 — CONFIRMED SAFE WITH DROP-OLDEST WINDOWING per `<decisions>` above.
- `src/ui/features/pretty-view/use-auto-scroll.ts` — 245 lines to be replaced with a much smaller plain-DOM version (see `<decisions>` for target shape).
- `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — delete after new tests land.
- `src/ui/features/pretty-view/PrettyView.estimateSize.test.tsx` — delete.

### Historical planning docs (do NOT delete — they're the "why we tried virt" record)

- `.planning/phases/27-*` — Phase 27 (virt introduction, patch #371). Load-bearing to READ so the planner understands the invariants Phase 27 established that Phase 43 is undoing.
- `.planning/phases/28-*` — Phase 28 (virt correctness cluster, patch #374).
- `.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/*` — Phase 32 (auto-scroll three-case redesign, plus tall-bubble-remeasure fix in patch #437).

### Related bounties (context for the multi-attempt saga being retired)

- `~/.claude/roles/box-maintainer/bounties/archive/pv-virtualization-correctness-fixes/bounty.json` — Phase 28 record.
- `~/.claude/roles/box-maintainer/bounties/archive/pv-auto-scroll-redesign/bounty.json` — Phase 32 record.
- `~/.claude/roles/box-maintainer/bounties/archive/pv-autoscroll-jumps-on-tall-bubble-remeasure/bounty.json` — patch #437 record. Same class of bug pattern that motivated Phase 43.
- `~/.claude/roles/box-maintainer/bounties/pretty-view-message-list-virtualization/bounty.json` — parent iter-3 bounty; will be closed alongside Phase 43 verification.

### CSS + browser-behavior reference

- `overflow-anchor` (browser default `auto`): plan-phase MUST verify no CSS in PrettyView subtree sets `overflow-anchor: none`. Widespread but not universal browser support caveat: Safari added support in 2023 (all versions since Safari 17 have it enabled by default). No fallback path needed for the fleet's target platforms (Ashley: iOS Safari PWA on modern iPhone, Chrome/Firefox on modern desktop).

</canonical_refs>

<specifics>
## Specific Ideas

- **First-turn cold load happy path:** user opens PrettyView on a 300-message conversation. WS connects with `historyWindow: 50`. Server tails file starting at line 251 (assuming ~1 line per message; planner: verify against actual JSONL frame ratios — messages are 1 line each, but not every line is a message). Client renders 50 messages, scrolls to bottom (no anchor — cold load starts at bottom). User replies; new user turn appended; already-pinned = follow-scroll to bottom. Zero jitter class.
- **Live-append past cap happy path:** user leaves a session open, talks for a long time, messages.length grows to 150. Next message arrives → drop oldest, append newest. If user was pinned, still pinned (dropping oldest doesn't affect scroll). If user was scrolled up, `overflow-anchor` preserves visible content across the drop.
- **Scroll-back-past-window path:** user scrolls up, near-top-trigger fires. Client sends `fetch_older` with anchor=oldest-loaded-eventId, count=50. Server reads corresponding line range, parses, batches, replies. Client prepends. `overflow-anchor` preserves visible content across the prepend. User sees new content ABOVE where they were reading, but their read position stays put. If they keep scrolling up, keeps fetching.
- **fetch_older past file line 1:** trivial — server replies with empty batch; client marks the top as "reached beginning" and stops firing fetch_older on further top-scrolls.
- **Cross-session-switch:** switching between two identity panes preserves each pane's messages[] and scroll position (this is already how PrettyView works today via `pvIdentity` in state; nothing changes).
- **Reconnect after WS drop:** client re-connects with `historyWindow: currentLoadedCount` (or a fresh 50; planner picks). appendDedup handles overlap by eventId.

</specifics>

<deferred>
## Deferred Ideas

Explicit deferrals (worth naming so the planner doesn't get pulled in):

- **In-app message search** to compensate for ⌘F on unloaded messages. Ashley already declined this in Phase 27. Not a follow-up bounty.
- **Server-side pagination optimization** — reading line ranges by seeking to file offsets rather than re-tailing from line 1. Present approach (sed/awk range read) is fine at fleet scales; revisit only if profiling shows it as a hotspot.
- **Persistent scroll position across page reloads.** Currently scroll resets on cold load. Not touched in this phase; if desired later, add a per-session-key localStorage bookmark.
- **Streaming token-by-token bubble growth.** Skynet doesn't do this today (whole assistant turns land atomically as one JSONL line). Phase 43's plain-DOM scroller would handle it fine via `overflow-anchor` if we ever added it — no code changes required.

Out of scope entirely (rejected):

- Keeping virtualization for very long conversations as a hybrid. Ashley wants virt gone. If plain-DOM cost ever becomes a real user-observable problem at high message counts (it won't at cap 150), we revisit — but not by re-adding virt.
- Any change to the observation channel (context-%, plan-pending, backgroundedAgents/Shells, id-reset). Not this phase.
- Any change to wire-frame shapes for existing emission types. Not this phase.
- Any change to PrettyView bubble components. Not this phase.
- Any auto-scroll behavior change beyond simplification. Follow-when-pinned + don't-yank-when-scrolled-up is preserved semantically.

</deferred>

<scope_fence>
## Scope Fence

**In:**
- Delete TanStack Virtual from PrettyView.tsx + its dependency + its two dedicated test files.
- Rewrite the message list as a plain-DOM scroller (in-flow children on a scrollable overflow container).
- Simplify use-auto-scroll.ts to a small pinned-to-bottom + follow-on-new hook (~50 lines).
- Add `historyWindow: N` WS handshake param; parameterize the tail command to bound initial replay.
- Add `fetch_older` WS request + server-side range-read handler; parse frames via existing `parseSessionLine`.
- Add client-side load-older trigger (near-top scroll fires fetch_older, prepends response) + debounce.
- Add client-side drop-oldest logic (when messages.length > M on live-append, drop head).
- Add client-side refetch-on-scroll-back logic (when scrolling into a dropped range, fetch_older).
- Add loading indicator for slow fetches (>150ms threshold or similar).
- Tests locking: initial-window bounded, fetch_older prepends, drop-oldest fires, refetch-on-scroll-back, auto-scroll pinned-follow + no-yank, overflow-anchor preserved in the tree.
- Verify no CSS sets `overflow-anchor: none` anywhere in the PrettyView tree.
- Delete Phase 27/28/32 virt-specific tests (already listed in decisions).

**Out (this phase):**
- Observation-channel changes (context-%, plan-pending, backgroundedAgents/Shells, id-reset detection).
- Wire-frame shape changes for message/image/relay_outbound/relay_inbound/malformed emissions.
- Bubble component internals.
- In-app message search sibling bounty.
- Persistent scroll bookmark across page reloads.
- Server-side seek-based optimization (sed/awk range read is fine).
- Deleting Phase 27/28/32 planning docs (they're historical record).

**Deferred (see above).**

</scope_fence>

---

*Phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio*
*Context gathered: 2026-08-18 via design conversation between Ashley + Tina; two pre-plan backend research questions answered before context freeze.*
