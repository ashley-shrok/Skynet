# Phase 27: Virtualize PrettyView message list (iter 3 of hidden-pane-cost-mitigation) — Context

**Gathered:** 2026-08-09
**Status:** Ready for planning
**Source:** In-chat design lock with Ashley 2026-08-09 (iter 3 dispatch + ⌘F decision) + parent bounty `hidden-pane-cost-mitigation-empirical-rotation` + iter-3 bounty `pretty-view-message-list-virtualization` (both LOCKED)

<domain>
## Phase Boundary

Third and final iteration of the hidden-pane-cost-mitigation empirical rotation. Iters 1+2 empirically closed the HIDDEN-pane cost story (post-iter-2 diag confirms 0 SSH bytes / 0 PV frames per 30s across all hidden panes). Iter 3 targets the remaining cost on the VISIBLE pane: long-conversation DOM node counts scale linearly with message count and reach ~2,500-3,200 nodes on a 200-msg conversation, degrading layout/paint/scroll performance forever as conversations grow.

Approach: virtualize the PrettyView message list so only viewport-visible messages (~5-15 + small buffer) render at any time. DOM stays constant (~200-300 nodes) regardless of conversation length.

**In scope:**
- Introduce `@tanstack/react-virtual` as a new dep.
- Refactor the scrollable message column in `src/ui/features/pretty-view/PrettyView.tsx` to render only viewport-visible messages via the virtualizer.
- Preserve existing scroll anchor behavior (auto-scroll-to-bottom-when-pinned; don't-yank-when-scrolled-up).
- Preserve initial-slice-from-bottom hydration (opening a session paints from the bottom — last N messages first — not the top).
- Handle image bubble grow: bubbles containing images may change height after their image loads (`onLoad`). The virtualizer must re-measure via ResizeObserver / measure hooks so no visible jitter results.
- Post-iter-3 diag pull on the same long conversation to measure DOM drop (target: 2,500+ → ~300 nodes for a 200-msg conversation).
- After iter 3 verifies: rip out the diag emitter (~5 min per patch #342 notes) and mark the parent rotation bounty done.

**Out of scope:**
- WipBubble, PlanPendingBubble, AsideBubble — these live in a separate slot BELOW the message list (one-per-view accessories). Do NOT virtualize them.
- ComposeBox, IdentityBadge, chat-column background, message bubble interior visual language — locked from previous phases, do NOT touch.
- Custom in-app message search — the ⌘F regression is accepted (see decisions below); no sibling bounty spun up.
- Terminal / RDP / Guacamole panes — untouched.
- Any change to the JSONL frame protocol, message reducer, or store shape — the virtualizer sits BETWEEN the reduced message list and the DOM.
- Any change to bubble content components (ChatMessage, image bubbles, code blocks, tool-use, plan bubble, relay bubbles, aside bubbles) — the virtualizer treats them as opaque children.

## Related work

- Parent bounty: `hidden-pane-cost-mitigation-empirical-rotation` (still open, tracking the rotation; marks done when iter 3 ships and post-iter-3 diag confirms visible-pane cost drop).
- Iter 3 bounty: `pretty-view-message-list-virtualization` (in_progress, tiffany started 2026-08-09).
- Iter 1: patch #344 (PV Claude-session WS pause) — shipped.
- Iter 2: patches #367+#368 (Terminal SSH WS pause with setup-effect gate) — shipped 2026-08-09.
- Diag emitter still live post-iter-2 with the stale-closure fix (patch #367). Baseline snapshot for iter 3 saved at `~/.claude/roles/box-maintainer/bounties/pretty-view-message-list-virtualization/pre-iter3-baseline-diag.jsonl` — post-iter-3 diag will compare to this.
</domain>

<decisions>
## Implementation Decisions (locked)

### Vehicle — LOCKED (Ashley 2026-08-09)

Full `/gsd:plan-phase` with a real roadmap phase entry (Phase 27), NOT a `/gsd:quick`. Ashley verbatim rebuke: *"Why are you guys always allergic to setting up phases for the work you do? If you are doing a phase then obviously a phase has to be set up. Simple."* Fleet-wide learning: phase-sized work gets a real phase, no rerouting through quicks to skip the ~5 min of roadmap setup.

### Library choice — RECOMMENDED (planner may reconfirm during pattern mapping)

**`@tanstack/react-virtual`** — modern, tree-shaken (~5KB), first-class support for variable-item heights via ResizeObserver, React-idiomatic hook API, actively maintained (part of TanStack Query/Router/Table family). Handles the image-bubble-grow re-measure case cleanly.

Rejected alternatives:
- **`react-window`** — older, less ergonomic for variable-height + dynamic-measure. No first-class ResizeObserver integration; requires manual reset on height change.
- **`react-virtuoso`** — feature-rich (built-in scroll anchor + reverse-list), but larger footprint and more opinionated. Adopts too much of our existing scroll-anchor logic that we already have working.
- **Hand-rolled IntersectionObserver approach** — reinventing solved problems; not worth the maintenance burden vs a 5KB battle-tested dep.

### ⌘F/find-in-page regression on long conversations — ACCEPTED (Ashley 2026-08-09)

Verbatim: *"For the ctrl-F, I don't really care about losing that functionality."*

Browser find-in-page can only search rendered DOM. With virtualization, only ~5-15 messages render at any moment, so ⌘F on a long conversation will not find text above the current viewport. This regression is ACCEPTED — do NOT build in-app message search as a sibling workstream. Users who need to search a long conversation can either scroll to it OR use the tmux terminal pane below the pretty-view (which has full scrollback).

### Streaming bubble re-measure — MOOT (design confirmation, Ashley 2026-08-09)

Verbatim: *"We don't do streaming tokens."* Our assistant bubbles do NOT grow token-by-token; they land atomically as whole messages when a JSONL frame arrives. So the "virtualizer has to re-measure per frame while tokens stream in" failure mode does not apply. Planner does not need to design around it.

### Scroll anchor preservation — LOCKED (existing behavior + Ashley 2026-08-09)

Verbatim: *"we already have scroll anchor."* The real API (per pattern-mapper 27-PATTERNS.md) is `useAutoScroll(paneKey) → { scrollRef, contentRef, isPinnedToBottom, forceStickAndJump, scrollToBottomAndFollow }` (see `src/ui/features/pretty-view/hooks/use-auto-scroll.ts`). The virtualization refactor MUST preserve this existing anchor logic — `scrollRef` plugs into the virtualizer's scroll container and `contentRef` becomes the sized-height wrapper. Do NOT invent a new anchor mechanism. If TanStack Virtual's built-in scroll helpers conflict with our existing anchor pattern, prefer to keep OUR pattern and treat the virtualizer as headless-measurement-only.

**⚠️ CONTEXT.md correction: an earlier draft referenced `chatScrollBottomRef` / `chatScrollAtBottomRef` / `pv-scroll-to-bottom-request` custom event — those names do NOT exist in the current code. The `useAutoScroll` hook API above is authoritative.**

### Initial-slice-from-bottom hydration — LOCKED (existing behavior)

Opening a session paints from the bottom (recent messages first, not the top). The virtualizer's initial render MUST hydrate with the visible slice being the LAST N messages, not the first N. Standard chat-app pattern; TanStack Virtual supports it via `initialOffset` or `scrollToIndex(count-1, {align:'end'})` in a layout effect.

### Image bubble height unknown until load — HANDLED via ResizeObserver

Image bubbles start at a small placeholder height and grow when the image loads (`onLoad`). The virtualizer's ResizeObserver-based measure hook (`measureElement` in TanStack Virtual) auto-re-measures items when their DOM height changes and re-lays out subsequent items without visible jitter. Plan MUST verify this actually works on a real image-bearing conversation before shipping (image bubble bug case in acceptance criteria).

### Below-list accessories stay unvirtualized — LOCKED (with layout change)

WipBubble, PlanPendingBubble, AsideBubble must NOT be part of the virtualized set — they render as siblings of the scroller.

**⚠️ CONTEXT.md correction / pattern-mapper finding (27-PATTERNS.md): today these three accessories are NOT physically below the list — they render as siblings INSIDE the same `contentRef` flex column that holds the mapped messages (PrettyView.tsx:1725-1781, especially AsideBubble at 1776-1779). The refactor MUST physically MOVE them OUT of the sized virtualizer container into a sibling block below it, keeping them in-flow (not sticky/overlay). This is a scope-required layout change, not scope creep.**

### Rebase risk — LOW

Additive integration on fork-local PrettyView. No upstream Skynet surfaces touched.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### PrettyView + message list
- `src/ui/features/pretty-view/PrettyView.tsx` — the file being refactored (message-mapping block at :1715-1817, scroll-anchor consumer, initial-slice hydration).
- `src/ui/features/pretty-view/ChatMessage.tsx` — bubble render (opaque child of virtualizer, unchanged).
- `src/ui/features/pretty-view/hooks/use-auto-scroll.ts` — the scroll-anchor hook (:97-159) whose `scrollRef` / `contentRef` seams plug into the virtualizer directly. **DO NOT modify this hook** — it's preservable as-is per pattern-mapper.
- **⚠️ CONTEXT.md correction: `messages` is component-local `useState<StreamEvent[]>` in PrettyView.tsx — NOT a store selector. No selector paths to identify. `eventId` on each StreamEvent is a ready-made virtualizer `getItemKey` (pattern-mapper finding).**

### Iter 1 + iter 2 shipped work (patterns to respect, NOT to touch)
- `~/.claude/roles/box-maintainer/bounties/hidden-pane-cost-mitigation-empirical-rotation/bounty.json` — parent rotation record.
- `~/.claude/roles/box-maintainer/bounties/pretty-view-message-list-virtualization/bounty.json` — iter 3 record + baseline reference.
- `~/.claude/roles/box-maintainer/bounties/pretty-view-message-list-virtualization/pre-iter3-baseline-diag.jsonl` — pre-iter-3 diag emit snapshot for post-ship comparison.

### Diag emitter (still live)
- `src/ui/lib/diag-emitter.ts` / `src/ui/lib/diag-registry.ts` — the DIAG-REPORT emitter feeding baseline + post-ship measurement.
- `src/main.tsx` — registration point.
- Backend receiver: `src/backend/database/routes/debug.ts` `/console-log` — mirrors to `/var/log/skynet/console-forward/console-forward.log` (bind-mounted to `/opt/skynet/console-forward-logs/console-forward.log`).

### Fleet standing directives (box-maintainer)
- ⚠️ NO worktrees — all work on `feat/tab-title-from-tmux` in `~/skynet-tiffany`.
- ⚠️ Executor's remit stops at code + commit + tests green — DEPLOY (docker build + coord-room announce + recreate + HTTPS verify + push + patch entry) is orchestrator-only.
- ⚠️ Multi-identity role — `git pull --rebase origin feat/tab-title-from-tmux` before every push.
- ⚠️ Container mutations serialize across identities — announce BEFORE + AFTER in the box-maintainer coord room.
- ⚠️ Never mask exit codes with `| tail` / `| head` on build commands.
- ⚠️ Frontend `tsc --noEmit` does NOT catch backend TS errors — this phase is frontend-only, but if any file under `src/backend/` gets touched, use `npm run build:backend && npm run build` for typecheck.
</canonical_refs>

<specifics>
## Specific Ideas

### Wave decomposition hint (planner may adjust)

- **Wave 1** — add TanStack Virtual dep + skeleton wiring (import, virtualizer hook, keep old rendering path behind a runtime toggle for A/B iteration during dev if planner deems useful; otherwise straight swap).
- **Wave 2** — replace message-list rendering path with virtualized rendering; hook up ResizeObserver-based measurement for variable heights; preserve scroll anchor + initial-slice-from-bottom.
- **Wave 3** — tests: unit tests for the virtualization wrapper if extracted; integration tests for scroll-anchor behavior across conversation lengths (short, medium, long, image-bearing); regression tests for the below-list accessories.
- **Wave 4** — post-ship diag verification instructions embedded in the phase's `must_haves` so verification proves the DOM drop empirically before the parent rotation bounty closes.

### Verification anchor

The phase's core `must_have` is empirical: **on a 100+ msg conversation, the visible PrettyView message column MUST render ≤ 30 message-bubble DOM subtrees at any moment** (buffer for variable heights + overscan; TanStack Virtual defaults to ~5 overscan items each direction). Baseline is 100+ (13-16 nodes × 100 msgs = 1,300-1,600 nodes today). Post-ship should show DOM stays flat as conversation grows.

### Success criteria to bake into `must_haves`

1. `@tanstack/react-virtual` present in `package.json` dependencies (not devDependencies).
2. Opening a session with 100+ messages: DOM contains ≤ 30 bubble subtrees at initial render.
3. Scrolling up N screens then back down: bubble subtree count stays bounded (≤ 30 at all times).
4. Auto-scroll-to-bottom-when-pinned still works (send a message, scroll snaps to bottom).
5. Don't-yank-when-scrolled-up still works (user scrolled up manually stays put when new messages arrive).
6. Initial paint lands at the BOTTOM of the conversation (recent messages visible), not the top.
7. Image-bearing bubbles grow to their loaded height without visible jitter and without pushing subsequent items off-screen.
8. WipBubble / PlanPendingBubble / AsideBubble still render below the list normally.
9. Full test suite (`npx vitest run`) exits 0 — zero failures.
10. Post-ship diag comparison: pre-iter3-baseline-diag.jsonl showed ~2,500+ DOM nodes on a 200-msg conversation; post-iter-3 shows ≤ 400.
</specifics>

<deferred>
## Deferred Ideas

- **Custom in-app message search** — user-facing recovery for the ⌘F regression. Ashley explicitly declined this (2026-08-09). If she changes her mind later, spin as a sibling bounty then.
- **Virtualizing the message list of OTHER long-list surfaces** (fleet aside history, plan-pending history, etc.) — none exist today; not applicable to this phase.
- **Windowing the conversation list itself** (pretty-conversations panel) — the conversation list is bounded by fleet identity count (~20-30 rows), not message count. Not worth virtualizing.
- **Streaming-bubble re-measure logic** — moot per Ashley's "we don't do streaming tokens." If we ever add streaming tokens later, that's a different phase.
</deferred>

---

*Phase: 27-virtualize-prettyview-message-list-iter-3-of-hidden-pane-cos*
*Context gathered: 2026-08-09 via direct decision-lock (all decisions were already answered in ROADMAP entry + bounty + Ashley's in-chat responses; discuss-phase skipped to avoid re-eliciting settled context)*
