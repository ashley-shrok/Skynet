---
phase: quick-260808-fkg
plan: 01
type: execute
status: complete
subsystem: pretty-conversations (mobile gesture layer)
tags:
  - pretty-view
  - mobile-gestures
  - row-swipe
  - pin+activate composite
  - unpin+deactivate composite
requirements:
  - FKG-ROW-SWIPE-PIN-ACTIVATE
tests_added: 8
  - PrettyConversationRow.test.tsx: TS1, TS2, TS3, TS4, TS5, TS6, TS7
  - PrettyConversationsPanel.test.tsx: TS-P1
files_touched:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (+swipe machine + inline transform + class toggles + shared touch handlers)
  - src/ui/features/pretty-conversations/pretty-conversations.css (+ swipe-past-threshold-right/left inset-glow rules)
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (+ TS1-TS7 describe block)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (+ TS-P1 integration test + `act` import + `afterEach` import)
  - .planning/quick/260808-fkg-add-row-swipe-combined-actions-on-pretty/260808-fkg-PLAN.md (spec)
  - .planning/quick/260808-fkg-add-row-swipe-combined-actions-on-pretty/260808-fkg-SUMMARY.md (this file)
---

# Quick 260808-fkg: Row-swipe combined pin+activate / unpin+deactivate on pretty-conversations

## What changed

Added a **swipe-to-ACT** gesture layer to `PrettyConversationRow` on mobile (non-RDP rows only):

- **Swipe RIGHT past threshold** → composite **pin + activate** (`onTogglePin` if `!pinned` + `onSelect` if `!inActiveSet`). Fires when Ashley wants to keep a session at the top of the chat list and enter it in one motion.
- **Swipe LEFT past threshold** → composite **unpin + deactivate** (`onTogglePin` if `pinned` + `onDeactivate?()` if `inActiveSet`). Fires when Ashley is done with a session and wants to release + close the tab in one motion.
- **Below threshold** → silent snap-back, no callback, no haptic.
- **Vertical drag** → never arms; vertical scroll wins.
- **RDP rows** → swipe machine skipped entirely (long-press context menu still works).
- **Already-both-set rows** (right-swipe on pinned+active, left-swipe on unpinned+inactive) → silent no-op via `wouldChangeState` guard — bounce would falsely imply action fired.

The gesture is swipe-to-ACT (threshold crossed → composite fires immediately → row snaps back), NOT swipe-to-reveal. Nothing is painted behind the row; the past-threshold visual affordance is a `box-shadow inset` glow inside the row body — hue-tinted for right, muted-cream for left.

## Why

From Ashley's bounty: pinning + activating (and later unpinning + deactivating) is a two-tap sequence in the context menu today (Pin → Activate; Unpin → Deactivate). Ashley does this often enough that collapsing to a one-swipe motion per direction is a measurable UX win. Split cases (pin-without-activate, activate-without-pin) still work through the context menu at their existing one-tap cost — the context menu items were not touched.

## Files touched (implementation)

### src/ui/features/pretty-conversations/PrettyConversationRow.tsx (+289 lines / -13 lines)

Added the swipe-to-act state machine alongside the existing long-press → context-menu layer. Both machines share the SAME `onTouchStart/Move/End/Cancel` handlers on the row body; they coexist by cancelling each other on their own movement gates (long-press cancels on `hypot > 10`; swipe arms on `|dx| >= 8 && |dx| > |dy|`, which also clears the long-press timer so the two paths never both fire).

State machine refs (all `useRef` except `dxLive` which is `useState` because the inline transform must re-render on each touchmove):

- `swipeStartRef: { x, y, rowWidth } | null` — captured on `touchStart`; `rowWidth` measured via `getBoundingClientRect().width` on the row body (once per gesture).
- `armedRef: boolean` — true iff the vertical-vs-horizontal gate passed for this touch sequence.
- `disarmedRef: boolean` — true iff the gate failed (vertical wins, disarmed for rest of touch).
- `isSnappingRef: boolean` — true during the 200ms snap-back window; gates new `touchStart` from arming mid-snap.
- `snapTimerRef: number | null` — the setTimeout handle for the snap-back window (drained on unmount).
- `dxLive: number | null` — the currently-translated horizontal offset for the inline transform; null = no transform key emitted (default CSS applies).

Class composition extended to conditionally include `swipe-past-threshold-right` OR `swipe-past-threshold-left` (never both) when armed AND `dxLive !== null` AND the un-scaled `|rawDx| >= threshold`.

`bodyStyle` extended: keeps `--pv-hue` as before, adds `transform: translateX(${dxLive}px)` when `dxLive !== null`, and `transition: transform 180ms cubic-bezier(.2,.9,.3,1)` when `isSnappingRef.current` is true. No transition during the raw drag phase (would fight the finger).

Unmount cleanup drains BOTH the long-press timer AND the snap-back timer.

Header comment block prepended above the swipe refs documents retirement history (why the pq2 strip died, why this doesn't repeat it), the six locked design decisions with brief justifications, and the co-existence contract with long-press. Mirrors the shape of the existing quick-260802-pq2 long-press header block.

### src/ui/features/pretty-conversations/pretty-conversations.css (+29 lines)

Two new selectors at the bottom of the file in a "Swipe-to-act visual feedback (quick-260808-fkg)" block, both keyed on `.pv-row.pv-row--mobile.swipe-past-threshold-{direction}`:

- **swipe-past-threshold-right:** `box-shadow: inset 0 0 0 2px hsla(var(--pv-hue), 65%, 55%, 0.35), inset 0 0 24px hsla(var(--pv-hue), 70%, 55%, 0.28);` — hue-tinted inset ring, reuses the row's own `--pv-hue`.
- **swipe-past-threshold-left:** `box-shadow: inset 0 0 0 2px hsla(35, 20%, 60%, 0.30), inset 0 0 24px hsla(35, 20%, 60%, 0.22);` — muted-cream inset ring, inside the `--color-pv-fg-dim` adjacency at pretty-view palette line 158.

Both are `box-shadow inset` — INSIDE the row body. NO element painted behind the row. NO persistent revealed strip. The retired quick-260802-pq2 bleed-through class of bug (`swipe-actions-visible-through-translucent-rows`) is NOT reintroduced.

### src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (+267 lines)

Appended a new describe block `PrettyConversationRow: mobile swipe-to-act (quick-260808-fkg)` at the bottom of the file, following the TL1-TL5 fixture pattern (fake timers, `fireEvent.touchStart/touchMove/touchEnd` with `touches: [{ clientX, clientY } as Touch]`). Module-level comment above the describe explains what TS1-TS7 cover.

Seven tests:

- **TS1** — Swipe-right past threshold on ambient-unpinned row → onTogglePin + onSelect fire (each once), onDeactivate does NOT.
- **TS2** — Swipe-right past threshold on already-pinned-AND-inActiveSet row → silent no-op (idempotency lock).
- **TS3** — Swipe-left past threshold on active-pinned row → onTogglePin + onDeactivate fire, onSelect does NOT.
- **TS4** — Release BELOW threshold (dx=35 < 90) → neither action fires (snap-back only).
- **TS5** — Vertical drag (dy=50 > dx=5) → never arms, no action, no menu.
- **TS6** — Small horizontal jitter (|dx|=4 < 8) during a tap → onSelect still fires via the existing tap path (swipe never armed).
- **TS7** — RDP row + dx=110 past threshold → no action fires (isRdp early-return).

Fixture note: `rowWidth` defaults to 0 in jsdom (no layout engine), so the swipe threshold `Math.max(90, rowWidth * 0.35)` collapses to 90 in tests — all dx values chosen with the 90 constant in mind (past = 100+, below = 40 or less).

### src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (+79 lines)

Added `act` to the `@testing-library/react` import + `afterEach` to the vitest import. Appended `TS-P1` as its own describe block at the bottom of the file:

- **TS-P1** — Renders a full `<PrettyConversationsPanel variant="mobile" …/>` with a fixture row that is initially NOT pinned AND NOT in active-set. Dispatches the same swipe-right sequence as TS1 on the row body. Asserts on `pinConversationSpy` (called with the canonical shadow-fleet id `fleet::1::swipetgt` per `PrettyConversationsPanel.tsx:696`) + `addToActiveSetSpy` (called with `row.id`) + `selectConversationSpy` (called with `row.id`). Proves the swipe-right composite composes through the panel-level `handleTogglePin` + `handleRowSelect` handlers, NOT through any row-side store bypass.

## Design decisions locked (with justifications)

1. **THRESHOLD: `Math.max(90, rowWidth * 0.35)`** — 35% of the row width for typical mobile column widths (~360-420px → ~126-147px), floored at 90px so unusually narrow rows still require a real deliberate drag. rowWidth measured once per gesture on touchStart (does not change mid-drag). Constants inlined at the call site per the tokens.ts naming rule at lines 12-16 (single call site → no PC_SWIPE_* token). tokens.ts stays header-only.

2. **VERTICAL-vs-HORIZONTAL DISAMBIGUATION** — on the first touchmove that exceeds the 8px gate on either axis, evaluate `|dx| >= 8 && |dx| > |dy|`. Both true → arm the swipe AND clear the long-press timer (paths don't double-fire). Not both true → set disarmedRef and never arm for the rest of this touch sequence (vertical scroll wins). The `disarmedRef` sticks so a slow vertical drag followed by a horizontal correction doesn't retroactively arm the swipe mid-gesture.

3. **VISUAL FEEDBACK DURING DRAG: transform translate scaled by 0.6 factor** — matches iOS native swipe-to-delete's viscous / resistive feel (finger moves faster than glyph). Capped at ±rowWidth via `Math.max/Math.min` so the row cannot slide off. Past-threshold: box-shadow inset glow INSIDE the row (hue-tinted right, muted-cream left) — never behind it.

4. **CANCELLATION UX: 180ms cubic-bezier(.2,.9,.3,1) snap-back** — applied inline ONLY during the snap-back window (not during drag, which would fight the raw translate). isSnappingRef guards new touchStart from arming mid-snap. Same 180ms transition applies AFTER a threshold-cross fires — snap-back + composite fire in the same touchEnd branch.

5. **IDEMPOTENCY: `wouldChangeState` guard** — swipe-right on already-pinned-AND-inActiveSet row (or swipe-left on unpinned-AND-inactive row) is a silent no-op with no callbacks + no vibrate. Bounce would falsely imply action fired — silent snap-back is the correct affordance when there's nothing to do.

6. **TAP-vs-SWIPE DISAMBIGUATION: shared `suppressNextClickRef`** — a touchEnd where `armedRef` stayed false leaves the existing tap path 100% intact (onClick fires onSelect). When the swipe DID arm and fire a composite, `suppressNextClickRef.current = true` is set (jsdom doesn't synthesize the trailing click, but real browsers do). Reuses the same ref the long-press already uses — the click gate is single-source.

## Coexistence with existing behaviors — untouched paths

- Tap-to-activate (short tap → `onSelect` via `onBodyClick`) — untouched.
- Mobile long-press → context menu (500ms hold with <10px total movement) — untouched; coexists via shared onTouchStart/Move/End handlers. When either machine trips its gate, it cancels the other's pending state.
- Desktop right-click context menu — untouched (mobile-only gate on the swipe path).
- RDP row long-press context menu (quick-260804-uo4) — untouched; swipe path early-returns on `isRdp`.
- Context menu Pin/Unpin + Deactivate items — untouched. Split cases (pin-without-activate, activate-without-pin) still work through the menu at their existing one-tap cost.
- No panel-side changes (`PrettyConversationsPanel.tsx` bytes-identical). The row uses the props the panel already wires at lines 942/997/1051/1098/1157.

## Non-goals (deferred, per bounty)

- **Desktop hover-swipe / pointer-drag desktop support.** The bounty explicitly says "Mobile PWA only initially; desktop can be a follow-up if wanted." The `!isMobile` gate at the top of every swipe touch handler cleanly excludes desktop; adding pointer-drag support later would extend that gate to also enable a mouse variant without touching the existing touch path.
- **Multi-touch / pinch during a swipe.** Only `e.touches[0]` is read; second finger is ignored. Standard iOS PWA touch handling.
- **Custom haptic patterns per direction.** Same `navigator.vibrate?.(10)` shape as the long-press path — one pattern, keep it simple.

## Verification checks (all pass)

1. `npx vitest run` → 125 test files, 1550 tests, 6 skipped, 0 failed.
2. `grep -rn "swipe-actions-visible-through-translucent-rows"` → only 3 comment references documenting the RETIRED prior machinery (in `PrettyConversationRow.tsx` header + swipe-machine header + `tokens.ts` header). No active class name / selector.
3. `grep -n "PC_SWIPE_" tokens.ts` → only historical comment references (tokens.ts remains header-only, no exports).
4. `grep -n "swipe-past-threshold" PrettyConversationRow.tsx pretty-conversations.css` → matches in both files (row emits the class; CSS defines the visual response).
5. `grep -c "swipe-past-threshold\|TS1\|TS2\|TS3\|TS4\|TS5\|TS6\|TS7"` (comment-filtered) on the row test file → 7 (one per test).
6. `grep -c "swipe composite\|TS-P1\|quick-260808-fkg"` (comment-filtered) on the panel test file → 2 (TS-P1 test name + describe title).
7. `npx tsc --noEmit` → clean (0 diagnostics).
8. Single commit on `feat/tab-title-from-tmux` tagged with the `quick-260808-fkg` marker.

## Deviations from plan

None. Plan executed exactly as written. One minor test authoring adjustment: TS-P1 uses `hostId "1"` instead of `"h1"` because the panel's `handleTogglePin` runs `parseInt(row.host.id, 10)` — an `"h1"` id resolves to `NaN` and produces `fleet::NaN::swipetgt` which doesn't match the panel's canonical id shape. The plan already directed asserting against `fleet::1::swipetgt`; the fix was a fixture-side change (numeric-parseable host id), not a semantic deviation.

## Deferred issues

None from this quick. One flaky test observed on unrelated code (`IdentityModal.test.tsx > 1: edit-title happy path` occasionally times out at 5000ms on clean HEAD too — pre-existing, unrelated to this quick, not touched here).

## Self-Check: PASSED

- Files created/modified all present:
  - `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — FOUND
  - `src/ui/features/pretty-conversations/pretty-conversations.css` — FOUND
  - `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — FOUND
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — FOUND
  - `.planning/quick/260808-fkg-add-row-swipe-combined-actions-on-pretty/260808-fkg-SUMMARY.md` — FOUND (this file)
- Full vitest suite: 1550 passed, 6 skipped, 0 failed (verified post-implementation).
- Frontend `npx tsc --noEmit`: clean, 0 diagnostics.
