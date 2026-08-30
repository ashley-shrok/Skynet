# Phase 3: Session changeover detection — Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Source:** Design synthesized in-turn with Ashley 2026-07-18, grounded in supervisor mechanics from Nelly (supervisor maintainer, DM'd via relay + confirmed from actual code), and empirical `/exit` verification against tina's own recycled session JSONLs.

<domain>
## Phase Boundary

This phase closes the "pretty-view stops updating after `/id reset`" gap. Concretely:

1. Detects when the current Claude Code session in a pane has been **recycled** (`/id reset` → supervisor kills claude → drives a fresh `claude` in the same tmux pane → new session id + new .jsonl filename).
2. Detects when the current session has been **recovered** (`claude --resume <oldId>` after a crash/reboot → same session id BUT can move to a different `projects/<slug>/` subdir if the resume-workdir differs from the original — 2026-07-15 supervisor change).
3. Handles the ~5s "bare-shell" gap between the old process dying and the new one launching without dropping the WebSocket or showing the terminal `no-active-session` fallback.
4. On detected changeover: tears down the old file tail, clears buffered per-session state (context-% last-value, harness-tasks dedupe, initialStateEmitted equivalent for the WIP signal), restarts the tail on the new session's file, and resets the client-side message list / harness-tasks / context-% so the new session's conversation re-hydrates from the top via existing `tail -F -n +1` semantics.
5. Provides a subtle "session recycling…" UI indication during the gap so the user knows the pane didn't just silently die.

Phase 3 does NOT change:
- Session-file discovery (`session-file-discovery.ts`) — reused as-is per poll tick.
- The tail primitive (`session-file-tail.ts`) — reused as-is; the server just cycles start/stop calls.
- The parser (`session-file-parser.ts`) — **explicitly OUT OF SCOPE.** Ashley wants to keep seeing her own slash commands (`/id`, `/queue`, etc.) rendered in pretty view, so we do NOT add wrapper filters for `<command-name>` / `<local-command-stdout>`. The `/exit` raw-line scan is at the tail layer, before the parser — it's a signal detection, not a display filter.
- The identity badge / pane-tint state (both are pane-scoped and correctly follow the pane rather than the session).
- The WS URL, port, or nginx `location` block (`/claude-session/websocket/` on port 30011, patch #43). No new backend routes.

</domain>

<decisions>
## Implementation Decisions

### Two-layer detection: `/exit` raw-line scan + discovery-repoll backstop (HARD LOCK, greenlit by Ashley)

Not one, not the other — both. Reasons captured below.

**Layer 1 — raw-line scan on `<command-name>/exit</command-name>`** in the existing `tailSessionFile` `onLine` handler (BEFORE the parser). If the line matches, emit `{type:"session_holding"}` to the WS INSTANTLY. Edge-triggered, sub-second latency. Follows the precedent set by patch #61 (parallel raw-line scan for ExitPlanMode tool_use / tool_result correlation).

**Empirical basis** (verified 2026-07-18 on tina's own recycled JSONLs):
- `/exit` lands as a `type:"user"` turn with content `<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>`.
- `isMeta` is `null`, NOT `true` — patch #46's meta filter does NOT skip it.
- Reinforcing marker `<local-command-stdout>Catch you later!</local-command-stdout>` lands ~1ms later.
- 4 of 5 recent recycled sessions had the marker; 1 was killed via SIGTERM fallback with no marker (matches Nelly's 2-step recycle sequence exactly).

**Layer 2 — full discovery repoll on the existing 3s poller**. The `claude-session-server.ts` already runs a 3s `setInterval` on the same SSH exec channel for context-% and harness-tasks (patches #52/#56/#59). Add a discovery branch to that same ticker: **re-run the FULL `discoverClaudeSession(conn, sessionName)` each tick, NOT a cached `ls -t $projects_dir/*.jsonl`**. The cached-dir shortcut would break Nelly's recover-in-different-cwd case (2026-07-15) where the same session id can move projects subdirs. Compare the resolved `sessionFile` to the currently-tailed path; on change, transition state.

**Why both layers are load-bearing**:
- `/exit` catches the ~80% happy-path recycle instantly (<1s latency, no ~3s wait).
- Discovery repoll catches: (a) the SIGTERM-fallback path where `/exit` never landed (Nelly's step 2 kicks in when `/exit` didn't take a graceful REPL exit), (b) recover-in-different-cwd (no `/exit` at all — process died on its own).
- Removing either layer creates a class of missed changeovers.

### Backend state machine (per pane WS session)

Three states: `active` (currently tailing a live session), `holding` (recycle in progress, no live session yet), `dead` (terminal `inactive` — recycle failed / no claude ever came back).

Transitions:
- `active` → (see `<command-name>/exit</command-name>` in tail) → `holding`. Emit `{type:"session_holding"}`.
- `active` → (poll detects `sessionFile` changed AND no prior `/exit` seen) → `holding` + `active_new` in same tick (SIGTERM-fallback path). Emit `session_holding` then `session_changed`.
- `holding` → (poll detects new `sessionFile`) → `active_new`. Emit `{type:"session_changed"}` carrying the new sessionFile path. Stop old tail, clear buffered per-session state, start new tail.
- `holding` → (N consecutive inactive polls, ~30-60s window) → `dead`. Emit terminal `{type:"inactive"}` and stop polling. Client falls to existing FALLBACK-01 behavior.
- `active_new` → `active` (immediate — it's just a labeling state to distinguish "fresh session started" from steady-state; a plain state variable would work).

The `holding` timeout is critical: without it, a genuinely-dead pane (recycle failed, no claude ever comes back) leaves pretty view stuck showing "recycling…" forever. Planner picks the exact tick count; suggest 15 ticks (45s) based on Nelly's timing note ("new .jsonl appears within ~5s; fully-loaded identity ~30-70s later" — 45s catches the "no new file appeared" degenerate case while giving normal recycles headroom).

### Buffered per-session state that must be cleared on session_changed

The 3s poller carries state across ticks. When we tear down a session, ALL of it must reset or the new session inherits stale bookkeeping. Concretely:

- `contextPctLastEmitted` — patch #52b holds-last-known-value; a fresh session should NOT inherit the old session's %.
- `harnessTasksLastSerialized` — patch #52c dedupe key; without a reset the new session's first task list would silently no-emit if it happened to match the old.
- `initialStateEmitted` (or equivalent) on the terminal-idle path — patch #51's WIP-bubble signal; the new session's first ticker tick must emit fresh.
- Any partial line buffer in `session-file-tail.ts` — should be empty on new-tail start, but confirm the tail primitive doesn't leak buffer across calls.

Planner: enumerate exhaustively from the current server file at plan time; the list above is a starting point, not a full inventory.

### Frontend event handling (`PrettyView.tsx`)

Two new WS event types in the discriminated union:

- `SessionHoldingEvent = { type: "session_holding" }`
- `SessionChangedEvent = { type: "session_changed" }` (optional field: `newSessionFile?: string` for diagnostics/logging, but the client shouldn't need to care about the path — the fresh tail will re-hydrate its own state).

Client behavior:
- On `session_holding`: mount a subtle "session recycling…" band above the messages (not modal, not blocking, not obscuring). Do NOT tear down the WS. Do NOT clear messages yet — the user may want to scroll back through the old conversation while the new one starts.
- On `session_changed`: reset `messages` to `[]`, `harnessTasks` to `[]`, `contextPct` to `null`. Auto-dismiss the holding band. The subsequent `message` events from the fresh tail will re-hydrate the new conversation from line 1.
- The `IdentityBadge` / pane-tint state is pane-scoped in `Terminal.tsx` and MUST NOT be touched — those follow the pane, not the session.
- `ComposeBox` state (patch #57 draft persistence): the persisted draft is keyed on `(userId, hostId, tmuxSession)`, NOT on Claude session id. So the draft correctly SURVIVES a session recycle — same pane, same tmux session, same identity, same draft. Do not touch this on session_changed. (Verified as correct design: if Ashley was composing a message before running `/id reset`, she probably wants that draft available in the new session.)

### Holding-band UI (Claude's Discretion within constraints)

- Muted, non-alarming. NOT the loud red "connection lost" toast pair from patch #27. NOT the WipBubble style (that's for "Claude is thinking," different signal).
- Position: above the messages list, at the top of the scrollable pretty-view region. Sticky if the user scrolls up in the old conversation (so they can still see "recycling…" while scrolling back).
- Copy: single line. Suggest "Session recycling — reconnecting…" or similar. Planner picks final copy.
- Auto-dismiss on `session_changed`. Also auto-dismiss on `inactive` (dead) — the terminal fallback takes over.
- Prefer a small component (`SessionHoldingBanner.tsx` or similar) alongside `WipBubble.tsx` in `src/ui/features/pretty-view/` — matches the fork's convention.

### Deploy discipline — do NOT deploy in this phase

Ashley's standing decision (bounty `pending-patch-batch-post-60`): Phase 3 patches queue up with the already-committed-but-undeployed batch (#61 backgrounded-agents panel, #62 markdown links in new tab, #63 plan-mode pending indicator). The deploy will be a single batched flow AT ASHLEY'S GREENLIGHT, running the standard 15-min deadman → force-recreate → pin cycle from `AGENTS.md`. Phase 3 execution ends at "committed to `feat/tab-title-from-tmux`, build clean, ready to batch-deploy."

Phase 3's UAT is deferred to the batch deploy. No separate deploy plan in Phase 3 unless the planner has strong justification.

### Claude's Discretion (planner decides)

- **Exact plan/wave decomposition**. Recommend 2-3 waves: (1) backend state machine + raw-line scan + discovery repoll + WS emits; (2) frontend WS handlers + state reset + holding band; (3) integration smoke test locally (no deploy). Planner may split differently if it makes sense.
- **The `holding` timeout tick count** — 15 (45s) is a reasonable starting suggestion per Nelly's timing note; planner can adjust.
- **Whether to add a small dedicated `SessionHoldingBanner.tsx` file or inline in `PrettyView.tsx`** — dedicated is more consistent with the fork's `WipBubble.tsx` / `PlanPendingBubble.tsx` (patch #63) precedent, but inline is fine if the component is trivial. Planner's call.
- **Whether the raw-line scan lives inline in the tail's `onLine` handler in `claude-session-server.ts` or gets its own tiny helper** (`detectExitMarker(line): boolean`). Inline is fine for a one-line check; extract if the check grows.
- **How to identify "no prior `/exit` seen" for the SIGTERM-fallback branch** — a simple `hasSeenExit: boolean` flag on the per-connection state, reset on `session_changed`. Planner confirms.
- **Any behavior around WebSocket lifecycle** — the WS should NOT auto-close on session change; the client-side auto-reconnect (patch #10 pattern) is orthogonal. Planner verifies no accidental teardown.
- **Whether to add a small backend log line** on session_holding / session_changed for post-deploy debugging (recommended — the fork already has similar log lines for other rare state transitions).

### Rejected / out-of-scope explicitly

- Parser wrapper filter for `<command-name>` / `<local-command-stdout>` — Ashley wants to see her own slash commands rendered. **HARD REJECTED.**
- Supervisor-side signal file — Nelly rejected this on architectural grounds (supervisor shouldn't grow UI-signaling responsibility; would duplicate discovery logic in a safety-critical always-on service). Filesystem IS the source of truth; polling it directly is the decoupled design.
- Persisting the changeover across page reload (e.g., encoding "was recycling" in the URL fragment). Not useful — the fresh page load will run discovery again immediately.
- Detecting `/exit` via keystroke on the terminal side (before it hits the JSONL). Would require plumbing changes to the terminal WS. JSONL landing is fast enough.
- Faster polling than 3s. Nelly explicitly confirmed 3s is plenty ("You do NOT need faster") and adds no value given the ~5s minimum before the new file exists anyway.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (planner, executor) MUST read these before proceeding.**

### The design authority
- **Nelly's supervisor mechanics DM** (2026-07-18, in relay room `!UkPPpD1NMBMLQ9-ehs4Jgaop54PydKQziW-NRqeJJZ4`) — the load-bearing reference for recycle sequence, timing, and the recycle-vs-recover distinction. Reprinted in relevant excerpts throughout this CONTEXT.md but the original DM is authoritative.
- **Empirical `/exit` verification** (2026-07-18) — 4/5 recent recycled sessions in `~/.claude/projects/-home-ubuntu/` have the `<command-name>/exit</command-name>` marker at their tail; the 5th ended via SIGTERM fallback. Full raw JSONL line format:
  ```
  {"type":"user","message":{"role":"user","content":"<command-name>/exit</command-name>\n            <command-message>exit</command-message>\n            <command-args></command-args>"},"isMeta":null,...}
  ```
- **Patch #43 shape file** — `.planning/shapes/shape-pretty-session-view.md`. Phase 3 preserves all Phase 1/2 hard locks (no optimism on sends, no persistence of mode choice, RENDER-01 conversational-only). Any Phase 3 decision that touches the parser or messages what to render must re-consult the shape.

### Backend files to modify (Phase 3 primary surface)
- `src/backend/claude-session/claude-session-server.ts` — **the main file this phase changes.** Add raw-line scan branch to the tail's `onLine` handler; add discovery repoll to the existing 3s ticker; add per-connection state for `hasSeenExit`, `holdingTicks`, `currentSessionFile`; emit new WS event types. **DO NOT rewrite the file** — layer the new behavior alongside existing context-% and harness-tasks pollers. Read the whole file end-to-end before editing so you preserve the shape.

### Backend files that Phase 3 reuses but MUST NOT change
- `src/backend/claude-session/session-file-discovery.ts` — reused per tick.
- `src/backend/claude-session/session-file-tail.ts` — reused; server cycles start/stop.
- `src/backend/claude-session/session-file-parser.ts` — **DO NOT ADD FILTERS.** Ashley explicitly wants slash commands visible.

### Frontend files to modify (Phase 3 primary surface)
- `src/ui/api/claude-session-api.ts` — add `SessionHoldingEvent` and `SessionChangedEvent` to the discriminated union.
- `src/ui/features/pretty-view/PrettyView.tsx` — handle two new WS event types; reset state on `session_changed`; mount the holding banner.
- Possibly `src/ui/features/pretty-view/SessionHoldingBanner.tsx` (new file) — see Claude's Discretion above.

### Prior-art code to reference
- `src/backend/claude-session/claude-session-server.ts` **the 3s ticker itself** — patches #52b (context-%), #52c (harness-tasks), #56 + #59 (context-% robustness). The discovery-repoll branch layers onto this same ticker; DO NOT add a second ticker.
- `src/backend/claude-session/session-file-tail.ts` — the `onLine` callback shape. The raw-line scan hooks here.
- Patch #61 (backgrounded-agents panel) — precedent for parallel raw-line scan in the tail. Referenced in `src/ui/features/pretty-view/BackgroundedAgentsPanel.tsx` and its server-side plumbing. Same discipline: raw-line detection at the tail layer, no parser changes.
- `src/ui/features/pretty-view/WipBubble.tsx` (patch #51) and `PlanPendingBubble.tsx` (patch #63) — pattern for a small dedicated component alongside `PrettyView.tsx`.
- `src/ui/features/pretty-view/PrettyView.tsx` `useEffect` neighborhood for WS lifecycle — new handlers slot in alongside existing `case "message":` / `case "inactive":` / `case "context_pct":` / `case "harness_tasks":` / `case "backgrounded_agent_*":` / `case "plan_pending_*":`.

### Standing fork rules (must be honored)
- Every fork commit must survive rebases against upstream `main`. Numbered commits, no squashes.
- Nginx caveat does NOT apply (no new backend route — reuses `/claude-session/websocket/`).
- Deploy discipline: NOT deploying in this phase (batched with #61/#62/#63 per Ashley).

</canonical_refs>

<success_criteria>
## Success Criteria

Phase 3 is complete when:

1. Ashley runs `/id reset` in a pane whose pretty view is open. Within ~1s of the `/exit` marker landing in the JSONL, the pretty view shows a "session recycling…" banner. Within ~5s of the new .jsonl appearing (typically 5-10s total), the banner clears and the new session's conversation appears from the top.
2. If graceful `/exit` fails and supervisor falls through to SIGTERM fallback (no `/exit` line in the JSONL), the same end state is reached within ~5s of the new .jsonl appearing — driven by discovery repoll.
3. If a pane's claude crashes and supervisor recovers via `claude --resume <oldId>` to a different cwd (same session id, new `projects/<slug>/` subdir), pretty view detects the file has moved and re-tails it. No user intervention required.
4. During the ~5s bare-shell gap, the WebSocket is NOT torn down and the terminal `no-active-session` fallback does NOT flash. The holding banner covers the gap.
5. On successful changeover, `messages`, `harnessTasks`, and `contextPct` all reset. `IdentityBadge` and pane-tint remain unchanged. `ComposeBox` draft (per patch #57) also remains unchanged (same pane = same draft key).
6. If no new session appears within the `holding` timeout window (~45s, planner may adjust), pretty view falls through to the terminal `no-active-session` state per existing FALLBACK-01.
7. All CHANGEOVER-01..05 requirements land as passing.
8. Build clean (`npm run build` from repo root, no TypeScript errors, no lint warnings introduced).
9. Committed to `feat/tab-title-from-tmux` with a `feat(pretty-view):` commit message following the fork convention.
10. NOT deployed. Batched with pending patches #61/#62/#63 per bounty `pending-patch-batch-post-60`.

</success_criteria>
