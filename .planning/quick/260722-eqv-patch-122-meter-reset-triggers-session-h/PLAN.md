---
title: "Patch #122 — meter reset triggers session-holding overlay immediately + lit-but-no-segments during holding + red-bubble failure"
task_id: 260722-eqv
slug: patch-122-meter-reset-triggers-session-h
description: >
  Reset button currently drains the meter cosmetically but segments pop back
  because underlying contextPct doesn't reset until session_changed fires
  (~seconds later). Make the click IMMEDIATELY show the existing
  SessionHoldingOverlay, lock the meter well to lit-but-no-segments during
  holding, and turn the overlay's bubble RED after a 120s timeout as Ashley's
  cue to hit browser refresh.
created: 2026-07-22
status: planned
---

## Task Summary

Wire the meter well's reset button to flip `PrettyView.isHolding = true`
IMMEDIATELY on click (via a new `onResetClicked` callback prop threaded
through ComposeBox), instead of waiting for the backend `session_holding`
WS frame. While `isHolding` is true, force all 12 meter segments to their
unlit state (well/border/glow preserved). If 120s elapses without the
`session_changed` recycle-completed frame — OR the backend fires an
`inactive { reason: "holding_timeout" }` frame first — flip a new
`holdingTimeoutError` state true, which passes an `error` prop to the
existing `SessionHoldingOverlay` to swap the RefreshCcw glyph and text
copy to warm-red ("Session recycle failed — refresh to check"). Reuses
patch #74's overlay + 350ms delay-arm gate untouched.

## Files to modify

- `src/ui/features/pretty-view/ComposeBox.tsx` — add `onResetClicked` +
  `isHolding` props, call `onResetClicked?.()` at the top of
  `handleResetSend()`, and force meter segments unlit when
  `isHolding === true`.
- `src/ui/features/pretty-view/PrettyView.tsx` — add
  `holdingTimeoutError` state, `onResetClicked` callback (sets
  `isHolding=true`), 120s belt-and-suspenders timer, `inactive` /
  `session_changed` / `isHolding=false` reset paths, thread new props
  to `ComposeBox` and `SessionHoldingOverlay`. Add `useCallback` to
  react import (currently not imported).
- `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` — accept
  `error?: boolean` prop, swap RefreshCcw color + text copy + card
  shadow tint to warm-red when true. Motion-channel guardrail (no
  spinner) preserved.

## Detailed change list

### 1. `src/ui/features/pretty-view/ComposeBox.tsx`

**Props interface (`ComposeBoxProps` at line 89):**

- Add `onResetClicked?: () => void` in the props block. Slot it near
  `onSend` (line 97) since it's semantically paired with dispatch
  callbacks. Suggested placement: right after `onSend` on ~line 98 (or
  just before `onGoodToGo`), with a JSDoc comment explaining
  "Fired synchronously when the meter well's Reset button is clicked,
  BEFORE the `/id reset` payload is dispatched via `onSend`. Lets
  PrettyView flip `isHolding` true immediately instead of waiting for
  the backend `session_holding` WS frame (~seconds delayed).
  Optional — omitted when the caller isn't wiring the session-holding
  overlay."
- Add `isHolding?: boolean` in the props block. Slot near `canSend`
  (line 114) since both gate render state on external session
  condition. JSDoc: "When true, force all meter well segments to their
  unlit state (well glow, border, and background stay intact). Ashley
  UX rule: during session recycle the meter should read as `powered
  but empty`, not `powered and filled` — segments only re-populate
  when the backend emits `context_pct` on the fresh session."

**Destructure block (line 173–190):**

- Add `onResetClicked,` — slot in alphabetically or after `onSend`.
- Add `isHolding,` — slot in near `canSend`.

**`handleResetSend()` at line 685:**

- Insert `onResetClicked?.();` on the FIRST line of the function body
  (before the `if (queuedText !== null)` block at line 687). This
  matches the patch #83 "immediate action wins" pattern already
  established for queue cancellation and drain-sweep animation.
  Comment: "Patch #122: fire the PrettyView `isHolding` signal
  synchronously so `SessionHoldingOverlay`'s 350ms delay-arm timer
  starts NOW, not when the backend's `session_holding` WS frame
  arrives (~seconds later). The `/id reset` payload still routes
  through the normal `onSend` path below — this is purely a
  UI-latency shortcut."

**Meter segment render (line 966 `Array.from({ length: SEG_COUNT }...`):**

- The lit computation lives at line 993–996:
  ```
  const isLit =
    typeof contextPct === "number" &&
    i < litCount &&
    !isDraining;
  ```
- Add `&& !isHolding` to the tail of the `isLit` conjunction. Result:
  ```
  const isLit =
    typeof contextPct === "number" &&
    i < litCount &&
    !isDraining &&
    !isHolding;
  ```
- Comment above: "Patch #122: during session recycle (`isHolding`
  from PrettyView, flipped synchronously by the meter well's own
  Reset click or by the backend `session_holding` WS frame), lock
  every segment to unlit so the well reads as `powered but empty`.
  The well container, border, glow, and reset-cell styling stay
  intact — only the per-segment lit branch flips off."
- Do NOT touch the well container (line 902 style prop), border, or
  reset-cell styling. Do NOT touch the drain-sweep timer branches
  (`transitionDelay = (SEG_COUNT - 1 - i) * 35ms` at line 1032) —
  those still animate on click before `isHolding` gates in.
- Do NOT touch the `band` computation or `dimNeutralBg` — the
  existing `background = dimNeutralBg` unlit branch is exactly what
  we want during holding.

### 2. `src/ui/features/pretty-view/PrettyView.tsx`

**Import at line 1:**

- Change `import { useEffect, useRef, useState } from "react";` to
  `import { useCallback, useEffect, useRef, useState } from "react";`

**State declarations block (line 128–190):**

- Add `const [holdingTimeoutError, setHoldingTimeoutError] = useState(false);`
  Slot it after `showOverlay` on line 190 (both are patch-derived
  overlay-state, keeps them adjacent for a future reader). Comment:
  "Patch #122: when true, `SessionHoldingOverlay` renders in its
  warm-red 'recycle failed — refresh to check' variant. Set by
  either the client-side 120s watchdog (see effect below) OR by the
  backend `inactive { reason: 'holding_timeout' }` WS frame
  (see `case 'inactive'` handler). Persists until `isHolding` flips
  back to false (via `session_changed`, another reset click, or
  user-initiated refresh)."

**`onResetClicked` callback (add after state declarations, before line
196's `wipActive` derived value):**

- Add:
  ```
  // Patch #122: synchronous session-holding trigger fired by the
  // meter well's Reset button BEFORE `/id reset` reaches the WS.
  // Flipping isHolding here starts the SessionHoldingOverlay's
  // 350ms delay-arm timer immediately instead of waiting for the
  // backend `session_holding` frame. If the backend confirms with
  // its own `session_holding` frame later, setIsHolding(true) is
  // idempotent — no double-fire. If Ashley clicks reset a second
  // time while the overlay is up (e.g. after a red-bubble
  // failure), the error state is intentionally reset to give the
  // fresh attempt a clean 120s window.
  const onResetClicked = useCallback(() => {
    setIsHolding(true);
    setHoldingTimeoutError(false);
  }, []);
  ```

**`case "inactive"` at line 317 — augment for `holding_timeout`
reason:**

- Current handler:
  ```
  case "inactive": {
    setStatus("inactive");
    setInactiveReason(parsed.reason);
    setIsHolding(false);
    break;
  }
  ```
- Change to:
  ```
  case "inactive": {
    // Patch #122: backend fires `inactive { reason: 'holding_timeout' }`
    // from claude-session-server.ts transitionToDead() (line 1645)
    // when the ~holding timeout expires without a fresh session.
    // Flip the overlay to its red-bubble variant instead of taking
    // the normal inactive path — the surface should stay covered so
    // Ashley sees the failure explicitly, not drop back to the
    // "no active Claude session" fallback where the compose box
    // silently disappears.
    if (parsed.reason === "holding_timeout") {
      setHoldingTimeoutError(true);
      // Deliberately do NOT setIsHolding(false) here — the overlay
      // must stay mounted showing the red bubble until session_changed
      // (recycle actually completed after all) OR another reset click
      // clears it. Deliberately do NOT setStatus("inactive") either
      // for the same reason — flipping to inactive would unmount the
      // compose box and the overlay's parent surface flex layout.
      setInactiveReason(parsed.reason);
      break;
    }
    setStatus("inactive");
    setInactiveReason(parsed.reason);
    setIsHolding(false);
    break;
  }
  ```

**`case "session_changed"` at line 352 — add error reset:**

- Inside the existing block, alongside the existing `setIsHolding(false);`
  at line 379, add:
  ```
  setHoldingTimeoutError(false);
  ```
- Slot it right after `setIsHolding(false);` so the two are visually
  paired. Comment inline: "Patch #122: safe reset — if user clicks
  reset again after this success, error state must not persist."

**Client-side 120s watchdog effect (add after the delay-arm effect at
line 436–447):**

- New effect:
  ```
  // Patch #122: client-side belt-and-suspenders holding_timeout
  // watchdog. When isHolding flips true, start a 120000ms timer;
  // when it fires, flip the overlay to its red-bubble variant.
  // Redundant with the backend's own `inactive { reason:
  // 'holding_timeout' }` frame (claude-session-server.ts line 1645),
  // but survives the case where the WS connection drops during the
  // hold — the backend can't deliver the frame if the socket is
  // gone. Cleanup clears the timer on unmount OR when isHolding
  // flips back false (session_changed, another reset click).
  useEffect(() => {
    if (!isHolding) return;
    const t = setTimeout(() => {
      setHoldingTimeoutError(true);
    }, 120000);
    return () => {
      clearTimeout(t);
    };
  }, [isHolding]);
  ```

**`isHolding` false → error reset (add after 120s watchdog effect):**

- New effect to keep `holdingTimeoutError` from lingering after
  `isHolding` clears:
  ```
  // Patch #122: reset error state when isHolding clears via any
  // path (session_changed, `inactive` non-holding_timeout reason,
  // component unmount). Kept as a dedicated effect rather than
  // inlined into each clear-site so future code that flips
  // isHolding false can't forget the paired cleanup. Guard on
  // !isHolding so this NEVER runs while isHolding is still true —
  // the entire window in which the error can be displayed is
  // exactly the isHolding=true window.
  useEffect(() => {
    if (!isHolding) setHoldingTimeoutError(false);
  }, [isHolding]);
  ```

**`SessionHoldingOverlay` mount at line 572:**

- Change from `{showOverlay && <SessionHoldingOverlay />}` to:
  `{showOverlay && <SessionHoldingOverlay error={holdingTimeoutError} />}`

**`ComposeBox` prop-pass at line 744:**

- Add two new props to the existing prop list (any slot near
  `contextPct` / `canSend` is fine):
  ```
  onResetClicked={onResetClicked}
  isHolding={isHolding}
  ```

### 3. `src/ui/features/pretty-view/SessionHoldingOverlay.tsx`

**Signature (line 48):**

- Change:
  ```
  export function SessionHoldingOverlay() {
  ```
  to:
  ```
  interface SessionHoldingOverlayProps {
    // Patch #122: when true, render the warm-red "recycle failed —
    // refresh to check" variant instead of the neutral "Session
    // recycling…" variant. PrettyView flips this after 120s
    // without session_changed OR on `inactive { reason:
    // 'holding_timeout' }` from the backend. Motion channel
    // guardrail (see file header) is unchanged: static glyph in
    // both variants — NO spinner even on error.
    error?: boolean;
  }
  export function SessionHoldingOverlay({ error = false }: SessionHoldingOverlayProps) {
  ```

**Card shadow (line 79):**

- Wrap in a ternary. Neutral (existing) shadow stays as-is; error
  variant uses a warm-red inset glow matching the fork's existing
  meter-well red-band palette (`hsla(0,72%,55%,...)` — see
  ComposeBox.tsx line 981–987).
  ```
  error
    ? "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,200,200,0.14)_inset,_0_0_18px_hsla(0,72%,55%,0.18)]"
    : "shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)]",
  ```
  Keep the ternary tasteful — the goal is a subtle red warmth on the
  card edge, not a warning-banner blare.

**RefreshCcw glyph (line 83):**

- Change:
  ```
  <RefreshCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
  ```
  to:
  ```
  <RefreshCcw
    className={cn(
      "h-4 w-4 shrink-0",
      // Patch #122: warm-red on error, matches the fork's existing
      // meter-well red-band hue (ComposeBox.tsx line 981) so the
      // whole app reads with one warm-red palette rather than a
      // clash of destructive-reds.
      error && "text-[hsl(0,72%,60%)]",
    )}
    aria-hidden="true"
  />
  ```

**Text (line 84):**

- Change:
  ```
  <span>Session recycling…</span>
  ```
  to:
  ```
  <span>
    {error ? "Session recycle failed — refresh to check" : "Session recycling…"}
  </span>
  ```

**Header comment addendum (near line 44, just before the export):**

- Append the following paragraph to the file-header block (BEFORE
  the import statement at line 45):
  ```
  // Patch #122 — error variant:
  //   Accepts an optional `error` prop. When true, the card renders
  //   the same geometry with a warm-red glyph and copy: "Session
  //   recycle failed — refresh to check." Trigger is a 120s timeout
  //   without `session_changed` OR a backend `inactive { reason:
  //   'holding_timeout' }` frame. The motion-channel guardrail
  //   above (STATIC RefreshCcw — NO animate-spin) still applies —
  //   error state ≠ work state. Warm-red hue matches the fork's
  //   existing meter-well red-band palette (ComposeBox.tsx line 981
  //   `hsla(0,72%,55%,1)`) to keep one warm-red across the app.
  ```

**aria-label (line 52):**

- Optional but recommended: change from a static string to a ternary
  so screen readers announce the correct state:
  ```
  aria-label={
    error
      ? "Session recycle failed — refresh the browser to check"
      : "Session recycling — pretty view temporarily unavailable"
  }
  ```

## Verification steps

1. `cd ~/skynet && npx tsc --noEmit` — MUST be clean (no type errors
   introduced by the new props or state additions).
2. `git diff --stat` — expect exactly 3 files changed:
   `ComposeBox.tsx`, `PrettyView.tsx`, `SessionHoldingOverlay.tsx`.
   No test files, no config, no lockfile.
3. `git diff src/ui/features/pretty-view/ComposeBox.tsx` — inspect
   the meter segment render at ~line 993. Verify:
   - The `isHolding` conjunction reaches ONLY the `isLit` boolean.
   - The well container (line 902 style with `--seg-count` /
     `--meter-width`), border, reset-cell styling, and drain-sweep
     transition (line 1032 `transitionDelay`) are untouched.
   - No changes to the `band` computation or `dimNeutralBg` constant.
4. `git diff src/ui/features/pretty-view/PrettyView.tsx` — inspect the
   `case "inactive"` handler (line 317). Verify:
   - The `parsed.reason === "holding_timeout"` branch fires
     `setHoldingTimeoutError(true)` and RETURNS before the normal
     inactive-state flip (no `setStatus("inactive")`, no
     `setIsHolding(false)` on the timeout path).
   - The non-timeout branch is unchanged from current behavior.
   - The `session_changed` handler at line 352 pairs the new
     `setHoldingTimeoutError(false)` with the existing
     `setIsHolding(false)`.
5. `git diff src/ui/features/pretty-view/SessionHoldingOverlay.tsx` —
   verify:
   - No `animate-spin` class added anywhere (motion-channel
     guardrail — patch #72 rule).
   - `role="status"` wrapper unchanged.
   - Scrim (`backdrop-blur-md bg-black/40`, `pointer-events-auto`)
     unchanged.
   - Glass card geometry (`px-4 py-3`, `gap-3`, `rounded-[var(--radius-pv-bubble)]`)
     unchanged.
6. Manual (deferred, no deploy this patch): once loaded, click Reset
   with a live session and confirm the scrim + glass card appear
   within ~350ms, meter reads lit-well-no-segments, and the card
   goes red at ~120s if `session_changed` never arrives.

## Non-goals

- Do NOT change the drain-sweep animation timing/curve (patch #83).
- Do NOT change the 350ms `showOverlay` delay-arm gate (patch #74).
- Do NOT change what `/id reset` sends to the backend.
- Do NOT change `session_changed` handling beyond the safe
  `holdingTimeoutError` reset paired with the existing
  `setIsHolding(false)`.
- Do NOT touch backend files — `claude-session-server.ts` already
  emits `inactive { reason: 'holding_timeout' }` (line 1645); this
  patch is frontend-only.
- Do NOT add a spin/pulse animation to the RefreshCcw glyph, even
  in the error variant — motion channel is owned by `WipBubble`
  (patch #72 guardrail).
- Do NOT deploy — this patch stops at type-clean + reviewed diff.
- Do NOT add tests. Manual verification is the loop for this patch;
  formal tests can follow if the mechanism proves stable.

## Rebase risk

**LOW-MEDIUM.** Additive-only changes across three files, no removals,
no signature breaks, no import surgery beyond adding `useCallback` to
the existing React import in `PrettyView.tsx`.

- `SessionHoldingOverlay.tsx` — fork-only file (patch #74). Upstream
  `main` has no equivalent. **Conflict risk: ~zero.**
- `PrettyView.tsx` — heavily patched (session-recycling state machine
  is Phase 3 fork-only territory). This patch adds:
  - one line to the React import,
  - one `useState` slot after `showOverlay`,
  - one `useCallback` after state declarations,
  - one branch inside `case "inactive"`,
  - one call inside `case "session_changed"`,
  - two new `useEffect`s after the existing delay-arm effect,
  - two new props on the `<ComposeBox>` element,
  - one new prop on the `<SessionHoldingOverlay>` element.
  All insertion sites are on lines that already exist in fork-only
  patch territory. Upstream `main` changes to any of these are
  possible but the conflict windows are narrow. **Conflict risk:
  low-medium.**
- `ComposeBox.tsx` — fork-heavy (60+ patches through it). This patch
  adds:
  - two prop entries in `ComposeBoxProps`,
  - two entries in the destructure block,
  - one line at the top of `handleResetSend()`,
  - one clause in the `isLit` conjunction.
  All in dense fork patch territory. Upstream `main` almost
  certainly has none of this. **Conflict risk: low.**

Overall: no signature-breaking, no file-move, no dep bump. Rebase
should be a mechanical merge on the three insertion sites.
