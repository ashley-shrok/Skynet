# Phase 41: Defer terminal view mount until user summons it — Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Source:** /build shape (`.planning/shapes/shape-deferred-terminal-mount.md`)

<domain>
## Phase Boundary

For identity-based sessions (where PrettyView is the default landing view), defer the mount of the Terminal component so it does not exist at all until the user summons it via Ctrl+Shift+O or long-press-identity-badge. On summon, cold-boot the terminal fully (fresh xterm instance, fresh SSH WebSocket, tmux reattach on the backend). On toggle-back-to-PrettyView, tear the terminal down completely (unmount, close WS) to reclaim resources.

Currently PrettyView is rendered *inside* Terminal.tsx JSX (siblings-of-xterm inside TerminalInner) — unmounting Terminal today would kill PrettyView too. This phase restructures the pane so PrettyView and Terminal are independent siblings under a new pane wrapper; PrettyView survives Terminal being unmounted; Terminal is dormant by default.

Two Terminal-owned signals that PrettyView depends on today are re-sourced from the Phase 39 fleet-status backend broadcast so PrettyView can stand alone:
- **isIdle** (drives WipBubble + conversation-list ready-dot) — already broadcast per-session by fleet-status; PrettyView reads from the broadcast instead of terminal WS frames.
- **Tab title (tmux session name)** — extend the fleet-status broadcast to include the tmux session name as an additional per-session property; AppShell's tab-title mechanism reads from the broadcast.

Scope: identity-based agent sessions only. Non-identity SSH-terminal sessions (workstation-style pure SSH) and RDP/Guacamole sessions are unaffected (they don't render PrettyView; Terminal or the RDP client IS the primary surface).
</domain>

<decisions>
## Implementation Decisions

### Load behavior — cold-every-time
- **LOCKED:** For identity-based sessions, Terminal component does not mount when the session opens. PrettyView mounts and connects on its own.
- **LOCKED:** First press of Ctrl+Shift+O or long-press-identity-badge triggers cold-boot: fresh Terminal component mount, fresh xterm instance, fresh SSH WebSocket dial, backend tmux reattach.
- **LOCKED:** Toggling back to PrettyView tears Terminal down completely — unmount the component, close the WebSocket, destroy the xterm instance. Every visit is a fresh cold-boot.
- **LOCKED:** No "keep warm" mode. No opt-out toggle. No feature flag to disable the deferral. If cold-boot ever feels slow, the answer is to make cold-boot faster — not to add warm-keep.
- **LOCKED:** Reuse existing terminal "Connecting…" UX for the cold-boot moment. Do NOT design a new loading state for deferred-mount specifically.

### Pane restructure — PrettyView promoted, Terminal becomes dormant peer
- **LOCKED:** PrettyView and Terminal become independent siblings under a new pane wrapper component (not PrettyView nested inside Terminal as today).
- **LOCKED:** State currently owned by TerminalInner that must survive Terminal being unmounted is hoisted OUT to the new pane wrapper: `isPrettyMode`, `togglePrettyMode` imperative ref, `pvSendInputRef`, `pvSendInterruptRef`.
- **LOCKED:** The wrapper owns the mount decision — Terminal mounts iff `isPrettyMode === false`. Toggle flips `isPrettyMode`, which mounts/unmounts Terminal as a side effect of the render.
- **LOCKED:** Ctrl+Shift+O keyboard handler and long-press-identity-badge handler both drive the wrapper's `isPrettyMode` state (no change to their user-facing behavior; just a different state target).
- **LOCKED:** Terminal's imperative-handle contract (currently exposing `togglePrettyMode`) is replaced/re-hosted so AppShell's `terminalRefs.get(id).current?.togglePrettyMode?.()` still works. Ref may now point at the wrapper instead of Terminal.

### isIdle re-sourcing
- **LOCKED:** PrettyView reads isIdle from the fleet-status backend broadcast (Phase 39 mechanism) instead of Terminal's SSH-WS-derived signal. The broadcast already carries `isWorking` per session (post-patch #442 composite).
- **LOCKED:** Slight lag from broadcast poll cadence vs. real-time WS frames is accepted. If it ever feels wrong, the answer is to poll more often (cheap over tailnet), not to add a shadow live connection.
- **LOCKED:** Graceful degradation — if the broadcast has never delivered isIdle for a session yet (fresh session, first poll hasn't landed), the WIP indicator + ready-dot are ABSENT (not stuck-on). No "assume working" or "assume idle" default that could pin the indicator.

### Tab title re-sourcing
- **LOCKED:** Extend the fleet-status backend broadcast payload to include `tmuxSessionName` per session (or equivalent — whatever key matches the current wire schema).
- **LOCKED:** Backend fills tmuxSessionName from the same SSH poll that fills isWorking (single round-trip; do not add a second SSH call).
- **LOCKED:** AppShell / tab-title mechanism reads tmuxSessionName from the fleet-status broadcast instead of receiving it via Terminal's `onTmuxSessionChange` callback.
- **LOCKED:** Before the first broadcast lands for a fresh session, the tab title shows a sensible placeholder (implementation choice — host name, "…", identity name, or blank all acceptable). Not worth designing.

### Scope boundary
- **LOCKED:** Deferred-mount applies ONLY to panes where PrettyView is the default landing view (identity-based agent sessions).
- **LOCKED:** Non-identity SSH terminal sessions (e.g. workstation as pure-SSH host) render Terminal directly with no PrettyView — unaffected by this phase.
- **LOCKED:** RDP/Guacamole panes use a different render path entirely — unaffected.
- **LOCKED:** The wrapper must correctly detect "is this pane an identity-based agent session with a PrettyView default" vs. "is this pane terminal-only or RDP" and only apply deferred-mount to the former.

### Send path
- **Established prior:** Phase 35 (patch #435) migrated the send path off borrowing Terminal's WebSocket. PrettyView owns `pvSendInputRef` / `pvSendInterruptRef` and dials its own claude-session WebSocket. No send-path work required in this phase — just ensure these refs are hoisted correctly.

### Claude's discretion
- Exact name and location of the new pane wrapper component (naming, file placement).
- Exact mechanism for state hoisting (React composition patterns, prop drilling vs context).
- Exact wire-schema additions to fleet-status broadcast (property name, encoding).
- Placeholder-string content for tab title before first broadcast (per LOCKED above — sensible default).
- Test structure (unit vs integration vs in-process), test file layout, mock strategies.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape (user-approved design contract)
- `.planning/shapes/shape-deferred-terminal-mount.md` — the /open shape file. LOCKED decisions are drawn from here. Overrides everything else on scope + philosophy conflicts.

### Current pane architecture
- `src/ui/features/terminal/Terminal.tsx` — TerminalInner component (~3700 lines). PrettyView currently rendered inside its JSX (L3308-3379 conditional render). Owns: `webSocketRef` (SSH WS, L175), `pvSendInputRef` + `pvSendInterruptRef` (L181-182), `isPrettyMode` state (L274), `useImperativeHandle` exposing `togglePrettyMode` (L132-150 + L3699-3707), `isIdle` state (L289 → PrettyView prop L3314). All of these must be hoisted or re-sourced.
- `src/ui/features/pretty-view/PrettyView.tsx` — the chat surface. Owns its claude-session WS. Reads `isIdle` as prop today (needs re-sourcing from fleet-status broadcast).
- `src/ui/shell/tabUtils.tsx` L90-139 — `TerminalTabContent` wrapper. Currently the pane wrapper for terminal-typed tabs; this is the likely site for the new pane restructure.
- `src/ui/AppShell.tsx` L1911-1942 — tab portal loop (`createPortal(renderTabContent(...), tabNode, tab.id)`). Also L208-212 `useKeyboardTogglePrettyMode` invoking `terminalRefs.current.get(id).current?.togglePrettyMode?.()` — the Ctrl+Shift+O path.

### Toggle entry points
- `src/ui/AppShell.tsx` L208-212 — Ctrl+Shift+O handler (calls Terminal's imperative `togglePrettyMode`).
- `src/ui/features/terminal/Terminal.tsx` L3421 — IdentityBadge `onLongPress={() => setIsPrettyMode((v) => !v)}` — long-press-identity-badge handler.

### Fleet-status backend broadcast (Phase 39 source)
- `src/backend/fleet-status/` — the fleet-status subsystem (Phase 34 backend + Phase 39 Gate 2 SSH-poll + patch #442 composite formula tuning). This is where the `tmuxSessionName` property gets added to the broadcast payload.
- Backend session-working-store: `src/backend/fleet-status/session-working-store.ts` L89 — composite formula (post-#442: `main = status === "busy"` only). Reference for how per-session state is currently computed.
- Nginx routing: `docker/nginx.conf` — `/fleet-status/` location block (added in patch #439).

### Prior phases (locked context)
- Phase 35 (patch #435) — `pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow`. `.planning/phases/35-*/`. Established PrettyView-owned send refs; makes this phase possible.
- Phase 39 (patch #441) — `fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presence-driven-lifecycle`. `.planning/phases/39-*/`. Established the backend broadcast this phase depends on. Includes presence-driven SSH-poll lifecycle (poller starts on first WS subscriber, stops on last unsubscriber).
- Patch #442 (this session, tanya) — Phase 39 UAT regression fix: dropped `status: "shell"` from working composite so persistent Monitors don't pin every session as WIP. Confirms the composite formula post-fix reads `main = status === "busy"` only.

### Fleet rules the executor must respect
- `.planning/CLAUDE.md` (project) + `~/.claude/roles/box-maintainer/box-maintainer.md` (role) — box-maintainer standing directives.
- Working tree: `~/skynet-tanya/` on `feat/tab-title-from-tmux`. `git pull --rebase origin feat/tab-title-from-tmux` before every push. NO worktrees (fleet rule 2026-07-31).
- Deploy motion is orchestrator-owned, NOT executor-owned (fleet rule 2026-08-08). Plan MUST NOT include a "ship" or "deploy" task at executor scope. Executor's remit stops at "code done, tests green."
- Container-mutation coordination (BEFORE + AFTER announcements in box-maintainer coord room) is orchestrator-owned during deploy — not the planner/executor's concern.
- Logging directive (2026-08-11): add structured logs at interaction/lifecycle/effect boundaries — decision points, edge transitions, close reasons, refs flipping. Extract event context explicitly (never `JSON.stringify(event)` on DOM Event objects).
- Full-suite green (`npx vitest run` exit 0, zero failures) is a precondition for any code change being considered done.
- Frontend `tsc --noEmit` does NOT catch backend TS errors. When touching backend files under `src/backend/`, pre-push typecheck is `npm run build:backend && npm run build`, not just `npx tsc --noEmit`.

</canonical_refs>

<specifics>
## Specific Ideas

- The Explore agent's earlier feasibility read (available in this conversation's history) already mapped: TerminalInner state to hoist, forwarded refs, isIdle prop flow, tab-title callback, cold-boot cost. Researcher / planner can lean on this as a starting map but MUST verify by reading the current source (Terminal.tsx has evolved rapidly this week — patches #431, #432, #435, #436, #437, #438, #441, #442 all touched this area).
- Natural plan-slice split (from vehicle notes): (P1) pane restructure + hoist state (PrettyView promoted to standalone under new wrapper; Terminal becomes dormant peer; Ctrl+Shift+O + long-press wired to wrapper state); (P2) re-source isIdle + tmux session name through fleet-status broadcast (backend broadcast payload extension + AppShell tab-title read-path + PrettyView isIdle read-path + kill Terminal-dependent paths in PrettyView).
- Plan-slice ordering — P1 first, then P2. But: the two are interdependent (P1's Terminal-unmount will REGRESS isIdle + tab-title until P2 lands). Options: (a) land both plans before shipping and only deploy after both green; (b) plan P2's read-path additions BEFORE P1's Terminal-signal removals (PrettyView reads from fleet-status broadcast AND still receives terminal prop as fallback), then P1 removes the fallback. Planner to decide which ordering minimizes intermediate broken states.
- Backend broadcast schema change is additive (new property), so it's backwards-compatible on the wire. Frontend clients that don't know about `tmuxSessionName` just ignore it.
- Testing strategy: PrettyView unit tests already exist; new tests must verify PrettyView correctly reads isIdle + tab-title from broadcast source and behaves correctly when Terminal is NOT mounted. Terminal-side tests may need updates where they assumed PrettyView-inside-Terminal composition.

</specifics>

<deferred>
## Deferred Ideas

- Faster fleet-status poll cadence — deferred until user reports isIdle lag feels wrong.
- Cold-boot performance optimizations beyond what falls out naturally from the pane restructure — deferred until user reports slowness.
- Any "keep this one warm" pin, escape hatch, or feature flag — explicitly rejected (see LOCKED).
- Visible "deferred / cold" badge on the tab or pane — explicitly rejected (adds noise for an implementation detail).
- Rewriting PrettyView's own architecture beyond what's needed to stand alone — out of scope.
- Migrating non-identity SSH terminal sessions to also gain a PrettyView surface — out of scope.

</deferred>

---

*Phase: 41-defer-terminal-view-mount-until-user-summons-it*
*Context gathered: 2026-08-14 via /build → /open shape (`.planning/shapes/shape-deferred-terminal-mount.md`)*
