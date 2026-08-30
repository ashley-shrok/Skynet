# Phase 59: Coral drop-target affordance on empty PrettyView + conv-list-close — Context

**Gathered:** 2026-08-29
**Status:** Ready for planning
**Source:** Ashley UAT of the completed `bring-back-split-view` arc (patches #515 Phase 57 + #516 Phase 58) on 2026-08-28/29. Two symmetric coral-affordance gaps surfaced. Ashley greenlight verbatim for bounty-and-next-session-start: *"Sure, you can bounty them and then reset yourself and we can work on them next session."* Bounty: `drop-target-affordance-empty-pv-and-convlist-close`. Discuss-phase skipped per `/build` convention when scope + palette source of truth + failure-mode taxonomy are already locked (precedent: Phase 53, 56, 57, 58).

## What this is

**Ships as patch #517.** A visual-affordance follow-up on the completed visual-session-management arc. Two symmetric coral-tint gaps on drop targets that are NOT Panes:

1. **Empty PrettyView area** (patch #509 code path, `AppShell.tsx` outer container when `splitTree === null`) — drop mechanics work; there is no coral tint when a conv-list row is dragged over.
2. **Conv-list panel drop-to-close** (patch #516 code path, `PrettyConversationsPanel.tsx` outer container) — drop mechanics work; there is no coral tint / highlight when an identity badge is dragged over.

**Neither is a correctness bug** — both drop targets accept + handle drops per spec. This phase adds ONLY the visual layer that Phase 57 established for Panes: a coral overlay (fill + border) that appears during a compatible drag-over and dismisses on drop / dragleave / dragend.

## Why this matters (per gap)

**Gap 1: empty PrettyView.** Small papercut. The whole area is the target so there's no ambiguity about *where* a session will land, but there's no signal that it *will* land. Consistency with Phase 57's Pane preview matters — the two drop-target flavors should feel like the same visual language.

**Gap 2: conv-list panel drop-to-close.** Higher-impact. Ashley verbatim: *"when I'm hovering over the conversation list, and I have her badge in hand, there's no tint or anything. So it doesn't necessarily seem interactable."* A silent drop target on a **destructive gesture** (dragging a badge to the list closes the session — WS torn down, tab removed) erodes trust: the user completes a destructive action without visual confirmation the target accepted the drag. The tint IS the "yes, dropping here will do something" signal.

## Solution shape (identical for both gaps)

Apply **Phase 57's coral overlay palette** as a `pointer-events:none` layered tint when a compatible drag is over the target. Palette source of truth, verbatim from `src/ui/shell/SplitView.tsx:446-447`:

```
background: "rgba(255, 184, 150, 0.22)"
border: "2px solid rgba(255, 184, 150, 0.60)"
```

Palette lineage (from `SplitView.tsx:434-438` comment): matches `--color-pv-code-fg` at `src/ui/index.css:159` and the prototype's `--highlight rgba(255,184,150,0.20)` / `--highlight-strong rgba(255,184,150,0.55)`. Same palette Phase 57 used for the Pane preview — deliberately reused so the two drop-target flavors feel unified.

**Overlay rendering pattern**: absolutely-positioned sibling of the drop target's content, `pointer-events:none` so it doesn't intercept the drop (drop still fires on the underlying container), CSS transition on opacity for a soft fade (optional — plan-phase decides).

**State pattern**: local `useState<boolean>` (or `null | true`) — set on dragover, cleared on drop / dragleave (bounding-rect guarded) / dragend. Unlike Phase 57's Pane which tracked `{zone, rect}` for four edge zones, these targets are single-zone (whole area lights up), so a boolean suffices.

**MIME discriminator per gap** (locked, matches the existing drop-handler contract on each target):
- **Gap 1 (empty PV)**: `text/plain` — matches Phase 56 conv-list row payload (per `AppShell.tsx:2271` existing `onDragOver` type-gate). ALSO exclude `Files` (matches existing `AppShell.tsx:2272` guard for OS file drags).
- **Gap 2 (conv-list panel)**: `application/x-skynet-badge` — matches Phase 58 Plan 02 discriminator (per `PrettyConversationsPanel.tsx:1300` existing type-gate). Row drags (`application/x-skynet-row`) and OS file drags must NOT trigger the tint.

## Existing code the tint layers on top of

### Gap 1 target site: `src/ui/AppShell.tsx:2258-2379`

Outer container div with React synthetic `onDragOver` (`:2260`) and `onDrop` (`:2275`). Existing type-gate at `:2271-2273`:

```tsx
if (!e.dataTransfer.types.includes("text/plain")) return;
if (e.dataTransfer.types.includes("Files")) return;
e.preventDefault();
```

Existing behavior spec (from `:2300-2306` comment): when `splitTree === null`, drops into the empty PV plant the payload as leaf, then either become `leaf(payload)` (no active session) or `split(existing, payload)` at nearest edge (active session shown). Payload extraction is a two-step ladder: parse `application/x-skynet-row` JSON via `resolveRowPayloadTabId`, fall back to `text/plain` for legacy drags.

**Phase 59 change**: add a coral tint overlay INSIDE this container, sibling to the current `<PrettyView …/>` etc. content, controlled by a `dragOverActive` boolean set/cleared by the outer `onDragOver` / `onDrop` handlers plus a new `onDragLeave` handler with bounding-rect guard.

**Portal caveat (relevant to plan-phase)**: PrettyView content is portaled. Patch #514 (traced 2026-08-28) established that ANY drop-target owning a DOM area containing portaled content MUST use native DOM listeners, not React synthetic `onDrop`, because React SyntheticEvents bubble via the React tree — portal content's React parent is the map-render site, not the portal target. The Phase 57 Pane fix moved to native DOM listeners for exactly this reason. HOWEVER, the empty-PV path (patch #510) uses React synthetic listeners today AND has been working since patch #510 shipped — this is because when `splitTree === null`, the SplitView subtree is `display:none` and PrettyView is NOT portaled into this container in that state (it's rendered in a different code path or not at all until a session is planted). Plan-phase must verify: does the empty-PV wrapper have portaled content in its React-tree-child position during the drag-over event? If YES, the dragover tint state won't fire from React synthetic events on the portaled content; must move to native DOM listeners. If NO (empty state renders no portaled child), React synthetic is safe. **Working hypothesis**: no portaled content in the drag-over target when `splitTree === null` — but plan-phase confirms by inspection before coding.

### Gap 2 target site: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1358-1364`

Outer panel div with React synthetic `onDragOver` (`handlePanelDragOver`) and `onDrop` (`handlePanelDrop`) — the Phase 58 Plan 02 wiring. Existing type-gate at `:1300`:

```tsx
if (types && Array.from(types).indexOf("application/x-skynet-badge") !== -1) {
  e.preventDefault();
}
```

Existing behavior (per Phase 58 Plan 02 6-step validation gauntlet at `:1304-1337`): MIME check → safe `JSON.parse` → tabId shape validation → `openTabIds` security guard → `preventDefault` → structured `[convlist-drop]` log → `onCloseSession?.(tabId)` callback.

**Phase 59 change**: add a coral tint overlay INSIDE this panel div, sibling to the existing conv-list rendering, controlled by a `badgeDragOverActive` boolean set by `handlePanelDragOver` (only when the badge MIME is present — same type-gate as existing preventDefault) and cleared by `handlePanelDrop` + a new `handlePanelDragLeave` (bounding-rect guard) + a window-level `dragend` cleanup for Escape-cancel.

**Portal note**: PrettyConversationsPanel does NOT contain portaled content. The conv-list rows and header are all normal React children. React synthetic listeners are safe here — Phase 58 shipped and Ashley UAT confirmed the drop mechanics work end-to-end. No native-DOM-listener migration needed.

## In-scope this phase

1. **Gap 1: coral overlay on empty PrettyView drop target (`AppShell.tsx`).**
   - Add local state (e.g. `[isConvRowDragOver, setIsConvRowDragOver] = useState(false)`) inside the empty-PV drop wrapper (or in the AppShell component if simpler — plan decides scope).
   - Extend the existing `onDragOver` at `:2260` to also `setIsConvRowDragOver(true)` when the type-gate passes.
   - Add `onDragLeave` with Phase 57's bounding-rect stateless guard (`stillInside = clientX/Y inside getBoundingClientRect`) to clear state — robust against dragleaves fired when the cursor crosses child DOM boundaries. Type-gate FIRST (only clear on `text/plain` drags) to avoid unrelated dragleaves (browser file drags, native OS drags) prematurely clearing state.
   - Clear state in `onDrop` (Phase 57 precedent — drop handlers clear the preview immediately).
   - Add window-level `dragend` cleanup for Escape-cancel (Phase 57 precedent at `SplitView.tsx:378-381`).
   - Render the overlay as an absolutely-positioned sibling with `pointer-events:none`, palette per §Solution shape, only when `isConvRowDragOver && splitTree === null` (empty-PV state gate is load-bearing — we don't want the tint firing when the Pane's own overlay is already handling the preview).

2. **Gap 2: coral overlay on conv-list panel drop-to-close (`PrettyConversationsPanel.tsx`).**
   - Add local state `[isBadgeDragOver, setIsBadgeDragOver] = useState(false)`.
   - Extend `handlePanelDragOver` to also `setIsBadgeDragOver(true)` when the badge MIME type-gate passes.
   - Add `handlePanelDragLeave` with bounding-rect stateless guard, type-gated to badge drags (mirror the dragover gate).
   - Clear state in `handlePanelDrop` (immediately, before or after the existing 6-step validation gauntlet — plan decides ordering; clearing FIRST is the safe path).
   - Add window-level `dragend` cleanup for Escape-cancel.
   - Render the overlay as an absolutely-positioned sibling to the panel content with `pointer-events:none`, palette per §Solution shape.

3. **Structured logging** (per box-maintainer standing directive Ashley 2026-08-11). Two new prefixes, both zone-change-gated (mirror Phase 57's `prevZoneRef` pattern to avoid drag-hover log spam):
   - `[empty-pv-drop-preview]` on Gap 1 — fires once per state transition (`false → true`, `true → false`). Format: `[empty-pv-drop-preview] visible=<bool> splitTreeNull=<bool>`.
   - `[convlist-drop-preview]` on Gap 2 — fires once per state transition. Format: `[convlist-drop-preview] visible=<bool>`.
   - Do NOT log on every dragover — that would flood the console-forward log with per-mouse-move noise. Zone-change gate is the discipline.

4. **Ship as one combined patch #517.** Small blast radius (2 files + tests). Deploy runbook per box-maintainer § Container mutations serialize directive.

## Explicitly OUT of scope this phase

- Any changes to drop mechanics on either target — Gaps 1 + 2 both work; Phase 59 is purely additive visual affordance.
- Any changes to Phase 57 Pane drop-preview or edge-zone hit-testing.
- Any changes to Phase 58 badge drag source or its dual-MIME payload contract.
- Any changes to the coral palette values themselves — reuse Phase 57's `rgba(255, 184, 150, 0.22)` fill + `0.60` border verbatim. Any palette change would be a design decision that should go through Ashley separately.
- New edge-zone semantics on the empty-PV target. Phase 57 has 4 edges + center-dead-zone for split-decision preview because the drop can land in different geometries. Empty-PV drops always plant as `leaf(payload)` OR `split(active, payload)` at nearest edge — but the user's visible action is unambiguous (whole area accepts, no need for per-zone preview at this affordance level). Same argument for conv-list panel (single close action, no per-zone semantics).
- Animation timing (fade-in / fade-out durations) beyond a reasonable default. If the plan proposes a CSS transition, keep it short (100-200ms).
- Any mobile handling. Both drop targets are desktop-only surfaces in practice (SplitView is desktop-gated per Phase 57; conv-list panel drops are desktop-only per Phase 58 `draggable={!isMobile}` gate on the IdentityBadge). No mobile-specific tint work.

## Edge cases the plan MUST cover

1. **Cursor crosses child DOM boundaries mid-drag** (empty-PV OR conv-list). Native `dragleave` fires on every child boundary crossing. Bounding-rect guard on `dragleave` (Phase 57 pattern) is the fix — DO NOT clear state unless the cursor has actually left the container's bounds. If the executor implements `dragleave` naively without the guard, the tint will flicker on every child boundary crossing.

2. **Escape cancels the drag WITHOUT moving cursor** (both gaps). No `dragleave` fires, no `drop` fires — only `dragend` on the drag source. Window-level `dragend` cleanup (per Phase 57 pattern at `SplitView.tsx:378-381`) is the only reliable signal. Idempotent — clearing already-false state is a no-op.

3. **Non-matching drag type crosses the drop target** (both gaps). E.g. OS file drag over empty PV, or row drag over conv-list panel. The type-gate on `dragover` must return early WITHOUT setting state true. Otherwise the tint would flash on unrelated drags and confuse the user.

4. **`splitTree` transitions from null to non-null during a drag** (Gap 1 only). Unlikely but conceivable if a drop is racing another state update. Overlay's render gate `isConvRowDragOver && splitTree === null` handles this — the tint disappears the moment splitTree becomes non-null even if state hasn't been cleared, deferring to the Pane's own overlay.

5. **Portaled content re-renders during a drag** (Gap 1 caveat). Per §Existing code / Portal caveat above — plan-phase confirms whether the empty-PV wrapper has React-child portaled content during drag. If YES, React synthetic listeners on the wrapper won't fire for dragover events on the portaled content, and the tint won't update. If NO (working hypothesis), React synthetic is safe. Plan-phase must verify.

6. **Both drop targets active simultaneously**. Not possible in practice — the empty-PV target requires `splitTree === null` (no session open); the conv-list panel target is always mounted but only tints on badge drags (which require a session to be open, which means splitTree is likely non-null). Overlapping states are architecturally excluded.

## Files most likely touched (implementation-side)

Small blast radius — 2 files + tests.

- **`src/ui/AppShell.tsx`** — extend the existing empty-PV drop wrapper at `:2258-2379` with (a) new local state, (b) extended `onDragOver`, (c) new `onDragLeave` with bounding-rect guard, (d) window-level `dragend` cleanup effect, (e) sibling absolutely-positioned overlay div. Existing `onDrop` extends to clear state. NO change to the drop-payload resolution ladder or the `setSplitTree` logic.
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`** — extend the existing panel drop wrapper at `:1358-1364` with the same pattern: (a) new local state, (b) extended `handlePanelDragOver`, (c) new `handlePanelDragLeave`, (d) window-level `dragend` cleanup effect, (e) sibling absolutely-positioned overlay div. Existing `handlePanelDrop` extends to clear state. NO change to the 6-step validation gauntlet.
- **`src/ui/AppShell.test.tsx`** (or equivalent PrettyView-drop-integration test file) — 3-5 new tests for Gap 1: tint appears on text/plain dragover with splitTree null, tint does NOT appear on Files dragover, tint does NOT appear when splitTree is non-null, tint clears on drop, tint clears on Escape (dragend).
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`** — 3-5 new tests for Gap 2: tint appears on badge dragover, tint does NOT appear on row-drag dragover, tint does NOT appear on Files dragover, tint clears on drop, tint clears on Escape (dragend), tint state does NOT flicker when cursor crosses a child row boundary (bounding-rect guard assertion).

Files that stay untouched:
- `src/ui/shell/SplitView.tsx` — Pane overlay unchanged; Phase 59 is a different code path (empty-PV, not Pane).
- `src/ui/lib/split-tree.ts` — no tree-logic changes.
- `src/ui/features/terminal/IdentityBadge.tsx` — badge drag source unchanged.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — row drag source unchanged.
- `src/ui/index.css` / `src/ui/features/pretty-view/pretty-view.css` — palette values inlined via style prop (Phase 57 precedent); no new CSS custom properties needed unless plan-phase decides otherwise.

## Test coverage additions (foreseen — plan-phase locks the exact set)

**Gap 1 (empty PrettyView tint):**
- Test A: dragover with `text/plain` when `splitTree === null` → overlay is rendered (assert on `data-testid` or class).
- Test B: dragover with `Files` (OS file drag) → overlay is NOT rendered.
- Test C: dragover with `text/plain` when `splitTree !== null` → overlay is NOT rendered (Pane's own overlay handles this).
- Test D: drop → overlay clears immediately.
- Test E: dragend on window → overlay clears (Escape-cancel path).
- Test F: dragleave inside bounding rect (child boundary crossing) → overlay STAYS visible (bounding-rect guard).
- Test G: dragleave outside bounding rect → overlay clears.
- Test H: `[empty-pv-drop-preview] visible=true` structured log fires on state transition (zone-change-gated).

**Gap 2 (conv-list panel tint):**
- Test A: dragover with `application/x-skynet-badge` → overlay is rendered.
- Test B: dragover with `application/x-skynet-row` (stray row drag) → overlay is NOT rendered.
- Test C: dragover with `Files` (OS file drag) → overlay is NOT rendered.
- Test D: drop with badge MIME → overlay clears AND existing 6-step gauntlet still fires (regression assertion).
- Test E: dragend on window → overlay clears (Escape-cancel path).
- Test F: dragleave inside bounding rect (row boundary crossing) → overlay STAYS visible.
- Test G: dragleave outside bounding rect → overlay clears.
- Test H: `[convlist-drop-preview] visible=true` structured log fires on state transition.

## What would make Phase 59 wrong (checkpoints for /close)

- **Tint flickers on child boundary crossings.** Bounding-rect guard on dragleave is the fix; if the plan skips it and just `setState(false)` on dragleave, the tint will strobe as the cursor crosses conv-list rows or PrettyView children. Test F is the guard.
- **Tint appears on unrelated OS file drags.** Type-gate on dragover must return early for `Files` type. Test B on both gaps.
- **Tint fails to clear on Escape.** Window-level `dragend` cleanup is the only reliable signal (drag was cancelled, cursor didn't move, no drop fired). Test E on both gaps.
- **Overlay captures the drop and prevents the underlying handler from firing.** Overlay MUST be `pointer-events:none`. If a plan proposes tracking hover state on the overlay itself, that's wrong — the overlay is inert paint only.
- **Both overlays fire simultaneously.** Architecturally excluded (see edge case #6), but if the plan somehow allows both gates to be true concurrently, it's wrong.
- **Log spam on every dragover event.** Zone-change gate is the discipline (Phase 57 precedent). If logs fire per mouse-move, the executor missed the pattern.
- **Palette drift.** Any value other than `rgba(255, 184, 150, 0.22)` fill + `0.60` border is wrong — must be verbatim Phase 57.

## Vehicle notes

**Skip discuss-phase** (Phase 53 + 56 + 57 + 58 precedent). This CONTEXT.md IS the discuss-phase output.

**Plan-phase**: expected to produce 1-2 plans. Two natural shapes:
- **1 plan option (recommended)**: 59-01 covers both gaps in one plan — the pattern is identical, the code is small, and shipping both in one atomic patch #517 matches Ashley's expressed intent (bounty is one thing, both gaps land together).
- **2 plan option**: 59-01 = Gap 1 (empty-PV), 59-02 = Gap 2 (conv-list panel). Independent, safe to parallelize. Slightly higher planning overhead but cleaner test-file separation.

Plan-phase decides. Prefer the 1-plan shape unless there's a concrete reason to split (e.g. plan-checker flags surface area).

**Executor scope**: code + commit + scoped tests green. Full-suite + docker build + deploy are orchestrator-only per role directive (subagents don't do deploys).

**Rebase risk**: LOW. `AppShell.tsx` sees heavy cross-fleet activity but the touch is localized to the empty-PV wrapper's onDragOver/onDrop/onDragLeave handlers and a sibling overlay div — additive on existing wiring. `PrettyConversationsPanel.tsx` was just modified by Phase 58 patch #516 (my own work last session, HEAD `cb80f673`) — additive additions to `handlePanelDragOver` + new `handlePanelDragLeave` + overlay sibling. Coordinate at ship time per the standard `git pull --rebase` + coord-room BEFORE/AFTER motion.

**Parent bounty**: `drop-target-affordance-empty-pv-and-convlist-close`. Closes on ship. Parent visual-session-management arc (bounty `bring-back-split-view`) already closed at end of last session with patch #516.

**Reference precedent**: Phase 57 CONTEXT.md + Phase 57 shipped code (`SplitView.tsx:429-459`) is the direct pattern to mirror — same palette, same state-clear discipline, same window-level dragend cleanup, same bounding-rect flicker guard on dragleave.
