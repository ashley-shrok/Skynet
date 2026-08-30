---
phase: 03-session-changeover-detection
plan: 02
subsystem: ui
tags: [pretty-view, react, websocket, typescript, session-changeover]

# Dependency graph
requires:
  - phase: 03-session-changeover-detection
    provides: "Wave 1 backend state machine emitting {type:'session_holding'}, {type:'session_changed', newSessionFile}, and {type:'inactive', reason:'holding_timeout'} WS frames on the claude-session bridge (commit 99f1837)"
provides:
  - "Frontend consumer for Wave 1's three new/updated WS event types — banner mount on holding, state reset on changed, banner dismiss on holding_timeout"
  - "New SessionHoldingBanner.tsx small stateless component (sibling of WipBubble.tsx / PlanPendingBubble.tsx)"
  - "SessionHoldingEvent + SessionChangedEvent added to the client discriminated union"
  - "W3 defensive setStatus('streaming') in session_changed handler — closes the rare fatal-error-then-recycle edge case at zero cost"
  - "W4 FRAGILITY WARNING code comment naming ancestor CSS properties (transform, will-change, filter, perspective, backdrop-filter) that would silently break the sticky banner"
affects: [future-pretty-view-patches, future-terminal-layout-changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Small stateless functional component alongside PrettyView.tsx for status indicators (WipBubble → PlanPendingBubble → SessionHoldingBanner)"
    - "Sticky-positioned banner inside a scroll container with -mx/-mt padding-cancellation trick + explicit FRAGILITY WARNING documenting ancestor CSS gotchas"

key-files:
  created:
    - src/ui/features/pretty-view/SessionHoldingBanner.tsx
  modified:
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/PrettyView.tsx

key-decisions:
  - "Shipped copy exactly as planner-suggested: 'Session recycling — reconnecting…'"
  - "Shipped icon: RefreshCcw (planner's canonical suggestion)"
  - "W3 defensive setStatus('streaming') is the 7th setter in session_changed after the six state-reset setters — order matches plan"
  - "W4 FRAGILITY WARNING code comment names all five ancestor CSS properties (transform, will-change, filter, perspective, backdrop-filter), both remediation options (a) find-and-remove offender and (b) hoist banner out of scroll container, AND the 'backdrop-filter on the sticky element itself is fine' clarification"

patterns-established:
  - "Sticky banner inside scroll container: `sticky top-0 z-10 -mx-4 -mt-3 mb-3 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border` + explicit code comment documenting fragility against ancestor transforms/filters"

requirements-completed: [CHANGEOVER-01, CHANGEOVER-03, CHANGEOVER-04]

# Metrics
duration: ~12min
completed: 2026-07-18
---

# Phase 3 Plan 02: Session-Changeover Frontend Summary

**Pretty view now visibly handles Claude Code session recycles — banner during the ~5s gap, state reset on the fresh session, no manual tab close/reopen — via three localized edits (two files touched, one file created).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-18T17:04:00Z
- **Completed:** 2026-07-18T17:16:29Z
- **Tasks:** 3
- **Files modified:** 3 (2 edited + 1 new)

## Accomplishments
- Added `SessionHoldingEvent` and `SessionChangedEvent` to the `ClaudeSessionServerEvent` discriminated union in `claude-session-api.ts` — pure type addition, no runtime code.
- Created `SessionHoldingBanner.tsx` (48 lines including doc comment) — muted static `RefreshCcw` glyph + copy "Session recycling — reconnecting…", `role="status"` + aria-label, mirrors the WipBubble / PlanPendingBubble small-component convention.
- Wired six localized edits into `PrettyView.tsx`: `SessionHoldingBanner` import; new `isHolding` state hook with doc comment; `setIsHolding(false)` in the mount-effect reset block; two new WS handler cases (`case "session_holding"` sets holding true; `case "session_changed"` resets six state hooks + defensively `setStatus("streaming")` per W3); one new `setIsHolding(false)` line in existing `case "inactive"` for holding_timeout dismissal; sticky-positioned banner mount inside the scroll container above the content wrapper with the W4 FRAGILITY WARNING code comment.
- Build clean via `npm run build` — no TS errors, no lint warnings introduced.

## Task Commits

Wave 2 lands as ONE atomic commit at Ashley's request (all three touches ship together as a coherent unit; the type-only change on its own is unusable, and the banner component on its own is unmounted dead code):

1. **All three tasks (Wave 2 Frontend)** — one atomic `feat(pretty-view):` commit as directed by the prompt

## Files Created/Modified

- `src/ui/api/claude-session-api.ts` — Added two new exported types (`SessionHoldingEvent`, `SessionChangedEvent`) between `PlanPendingEvent` and `TailErrorEvent`; extended the `ClaudeSessionServerEvent` discriminated union with both new members in the matching slot.
- `src/ui/features/pretty-view/SessionHoldingBanner.tsx` — NEW. Small stateless functional component (48 lines total including 26 lines of doc comment). Renders a muted pill (`bg-muted/60 text-muted-foreground border border-border text-xs rounded-md px-3 py-1.5`) with a static `RefreshCcw` icon and the single-line copy "Session recycling — reconnecting…". No `Loader2`, no `animate-spin` — motion channel remains owned by WipBubble per patch #53's precedent.
- `src/ui/features/pretty-view/PrettyView.tsx` — Six localized edits (+91 insertions):
  1. `SessionHoldingBanner` import alongside the other pretty-view component imports.
  2. `isHolding: boolean` state hook (default false) after `planPending`, with a 7-line doc comment explaining lifecycle and the "WS is NOT closed during holding" invariant.
  3. `setIsHolding(false)` in the mount `useEffect` reset block alongside the other setters.
  4. Two new WS handler cases (`case "session_holding"` and `case "session_changed"`) inserted BEFORE `case "tail_error"` per plan's specified slot. The `session_changed` case includes the W3 defensive `setStatus("streaming")` as the 7th setter after `setMessages([]) / setHarnessTasks([]) / setContextPct(null) / setBackgroundedAgents([]) / setPlanPending(null) / setIsHolding(false)`.
  5. One new `setIsHolding(false)` line in the existing `case "inactive"` for holding_timeout dismissal (bringing that case body to three lines).
  6. Sticky-positioned `<SessionHoldingBanner />` mounted inside the scroll container BEFORE the `contentRef` wrapper, gated on `{isHolding && ...}`, with the W4 FRAGILITY WARNING code comment naming all five ancestor CSS properties (`transform`, `will-change`, `filter`, `perspective`, `backdrop-filter`) plus both remediation options and the "backdrop-filter on the sticky element itself is fine" clarification.

## Decisions Made

- **Copy shipped exactly as planner-suggested**: "Session recycling — reconnecting…" — matches Nelly's supervisor terminology per CONTEXT.md, terse, single-line, em-dash + ellipsis reads as "state description — in progress" which is exactly the semantic.
- **Icon shipped: `RefreshCcw`** — planner's canonical pick; the alternative `RotateCcw` (patch #52a precedent) would have been a valid substitute per the plan, but no reason to deviate.
- **W3 defensive `setStatus("streaming")` is the 7th setter** in the `session_changed` handler AFTER the six state-reset setters. Explanatory comment inline names the rare "fatal error frame between holding and session_changed" edge case this closes at zero cost.
- **W4 FRAGILITY WARNING code comment** is present on the sticky-positioning JSX, verbatim from the plan's suggested text including both remediation options and the "backdrop-filter on the sticky element itself is fine — it establishes a containing block only for its own descendants, not for the sticky element itself" clarification.
- **NO diagnostic `console.debug`** was added for `parsed.newSessionFile` — plan explicitly directed against ambient debug logging. The field is available if a future patch wants it.
- **Layout gotchas: none discovered.** The `-mx-4 -mt-3` padding-cancellation trick landed cleanly as documented; no alternative positioning was needed. `bg-background/95 backdrop-blur-sm` gives the sticky banner a subtle scroll-under polish without touching any transform-inducing property.
- **TypeScript exhaustiveness**: The switch statement has no `default` clause and no `never`-asserted default, so adding the two new discriminated-union members did NOT surface any TS error (there's no exhaustiveness check to trip). Existing pattern preserved — matches how `case "tail_error"` was already handled without exhaustive-check machinery.

## Explicit non-changes (verified)

- **`Terminal.tsx` NOT modified** — IdentityBadge (patch #17) and pane-tint (patch #26) are pane-scoped and correctly follow the pane, not the session. Verified via `git diff --stat src/` returning only the two intended file paths.
- **`ComposeBox` NOT modified** — draft persistence key (patch #57) is `(userId, hostId, tmuxSession)` which excludes Claude session id, so drafts correctly SURVIVE a recycle without any code changes needed.
- **`AppShell.tsx` NOT modified** — no chord/keyboard/shortcut work in this plan.
- **`session-file-parser.ts` NOT modified** — Ashley wants `<command-name>` / `<local-command-stdout>` visible in pretty view (CONTEXT.md HARD REJECTED).
- **Existing WS handler cases** (`session`, `message`, `context_pct`, `harness_tasks`, `backgrounded_agents`, `plan_pending`, `tail_error`, `error`) — byte-for-byte preserved.
- **`onopen`, `onclose`, `onerror`** handlers — byte-for-byte preserved.
- **`useAutoScroll`, `ChatMessage`, `HarnessTasksPanel`, `BackgroundedAgentsPanel`** — unchanged.

## Deviations from Plan

None — plan executed exactly as written. All grep-verify checks pass. `npm run build` succeeds without new errors. File count matches `files_modified` frontmatter (`git diff --stat` shows only the two edited files; `git status --short` shows one new untracked file `SessionHoldingBanner.tsx`).

## Issues Encountered

None.

## Combined Phase 3 status

With this Wave 2 commit landing alongside Wave 1's backend commit `99f1837`, all five CHANGEOVER requirements are delivered end-to-end:

- **CHANGEOVER-01** (detect + surface the recycle): Wave 1 backend detects `/exit` marker OR discovery-repoll `sessionFile` change; Wave 2 frontend mounts the banner and rehydrates the fresh conversation.
- **CHANGEOVER-02** (handle SIGTERM-fallback recycle): Wave 1 backend's Layer 2 discovery-repoll catches the case where `/exit` never lands; Wave 2 frontend handles the same `session_holding` + `session_changed` sequence emitted by both layers.
- **CHANGEOVER-03** (holding-band UI + no WS teardown): Wave 1 backend keeps `sshConn` alive across the recycle; Wave 2 frontend mounts a subtle muted banner (not the loud red disconnect toast pair) and does NOT close the WebSocket on either handler.
- **CHANGEOVER-04** (client-side state reset on new session): Wave 2 frontend resets `messages / harnessTasks / contextPct / backgroundedAgents / planPending / isHolding` on `session_changed` and defensively re-mounts the scroll region via `setStatus("streaming")` (W3). Wave 1 backend independently resets ALL per-connection buffered state.
- **CHANGEOVER-05** (recover-in-different-cwd handled identically): Wave 1's discovery repoll detects `sessionFile` moving to a different `projects/<slug>/` subdir with the same session UUID; Wave 2's `session_changed` handler treats it identically to a recycle — no special-case branch.

## Next Phase Readiness

- Phase 3 is committed to `feat/tab-title-from-tmux` (Wave 1: `99f1837`, Wave 2: THIS COMMIT) but NOT deployed.
- Ready to batch-deploy with pending patches #61/#62/#63 at Ashley's greenlight per bounty `pending-patch-batch-post-60`.

---
*Phase: 03-session-changeover-detection*
*Completed: 2026-07-18*
