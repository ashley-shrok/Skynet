---
task: 260719-tjk
type: quick
autonomous: false
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
requirements:
  - patch-83-cohesive-instrument-compose-meter
must_haves:
  truths:
    - "Compose row's meter and reset button read as one cohesive segmented-well instrument"
    - "Meter well always mounts (12 segments visible even when contextPct is null, all dim)"
    - "Segments light bottom-to-top per contextPct, colored per position (bottom green / middle amber / top red)"
    - "Reset cell sits at the bottom of the meter well, styled as an unlit-green well cell at rest, lit-green on hover"
    - "Clicking reset fires /id reset dispatch AND triggers a top-to-bottom drain sweep animation (~600ms) with reset cell pulsing lit-green at the drain peak"
    - "Icon column on the right contains only ThumbsUp + Send (RotateCcw is gone from the icon column)"
    - "Compose shelf outer padding matches inner gaps (px-2 py-2 with gap-2)"
    - "All existing behaviors preserved: /id reset dispatch payload, textarea clears on success, errorMessage on failure, ThumbsUp go-ahead, Send handler, draft persistence"
    - "tsc + vite build complete without errors"
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Cohesive segmented-well meter with integrated reset cell + drain animation"
      contains: "SEG_COUNT"
      contains_also: "isDraining"
  key_links:
    - from: "meter well container"
      to: "segments container + divider + reset cell"
      via: "flex flex-col p-[3px]"
    - from: "handleResetSend"
      to: "isDraining state"
      via: "setIsDraining(true) + setTimeout(setIsDraining(false), 800)"
    - from: "each segment"
      to: "drain sweep timing"
      via: "transition-delay: (SEG_COUNT - 1 - i) * 35ms"
---

<objective>
Patch #83 — Restructure the pretty-view ComposeBox compose row so the context-window
meter and the reset button read as ONE cohesive instrument sharing the same segmented-well
visual vocabulary. Add a drain-sweep animation that fires when the reset cell is clicked.

Purpose: The current thin colored strip meter + separate icon-column reset button read as
two unrelated affordances. The new segmented-well design (per Ashley's 2026-07-19 design
session) makes the meter and reset feel like a single instrument — meter fills bottom-to-top
during use, reset drains it top-to-bottom on click.

Output: Single-file mutation to src/ui/features/pretty-view/ComposeBox.tsx. No other files
touched. No prop or backend changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/components/button.tsx
@src/ui/components/textarea.tsx

Key facts extracted during planning (do NOT re-read to re-derive):

- Button's `outline` variant className carries `dark:border-input dark:bg-input/30 dark:hover:bg-input/50`
  (button.tsx line 15). If you use the shadcn `Button` component for the reset cell, any `bg-[...]`
  arbitrary override MUST carry the `!` (Tailwind v4 important) suffix per patch #81-fix precedent
  documented in the existing Textarea comment (ComposeBox.tsx lines 454-475).
- Recommendation from the spec (confirmed sound): use a native `<button>` for the reset cell,
  not the shadcn `Button`. The reset cell needs a visual language that differs from the icon-sm
  Button size (size-7 rounded-none) — it needs to be a rounded-[2px] full-width cell fitting
  inside the w-7 meter well. Native `<button>` sidesteps the `dark:` specificity fight entirely.
- `useState`, `useEffect`, `useRef`, `useCallback` are already imported (line 1). `cn` already
  imported (line 5). `RotateCcw`, `Send`, `ThumbsUp` already imported (line 2). No new imports
  required unless you split the segment renderer into a subcomponent.
- Existing textarea well uses `bg-[rgba(10,12,20,0.5)]!` and `border border-[rgba(220,225,245,0.07)]`
  and inset shadows on rgba(0,0,0,0.4). The meter well's vocabulary in the spec (rgba(10,12,20,0.6)
  bg, rgba(220,225,245,0.1) border, inset_0_2px_6px_rgba(0,0,0,0.55) shadow) intentionally sits
  slightly deeper than the textarea to read as "same family, one shade darker."
- Current DOM landmarks in ComposeBox.tsx:
  - Line 379: compose shelf className (px-3 py-3 → change to px-2 py-2)
  - Lines 390-425: compose row `<div className="flex items-end gap-2">` + old meter tube (delete
    the tube conditional block 397-425)
  - Lines 299-312: `handleResetSend` (add drain trigger)
  - Lines 497-565: icon column (delete the RotateCcw Button 506-525; leave ThumbsUp + Send)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Restructure ComposeBox — meter well + integrated reset cell + drain animation</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx</files>
  <action>
Implement patch #83 as a single coordinated mutation to src/ui/features/pretty-view/ComposeBox.tsx.
Do NOT change any other file. Do NOT change props or backend.

Step A — Compose shelf padding (line ~379).
Change the compose shelf's outer className token `px-3 py-3` to `px-2 py-2` so outer padding matches the inner `gap-2` column gaps. Leave every other class on that line untouched.

Step B — Add drain state and cleanup.
Inside the ComposeBox component body, add:
- `const [isDraining, setIsDraining] = useState(false);`
- `const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);`
- A `useEffect(() => () => { if (drainTimerRef.current) clearTimeout(drainTimerRef.current); }, []);` for unmount cleanup.
Place these near the other state/refs at the top of the component body (after `errorMessage` and `textareaRef`).

Step C — Wire drain trigger into handleResetSend (lines ~299-312).
At the TOP of handleResetSend (before the existing setErrorMessage(null) line, or immediately after it — either is fine), add:
- Clear any existing drainTimerRef.current via clearTimeout.
- setIsDraining(true).
- Schedule setIsDraining(false) via setTimeout at 800ms, storing the handle in drainTimerRef.current.
The drain fires REGARDLESS of dispatch success — per spec, visual feedback on click reads better than post-hoc, and the reset payload IS dispatched immediately below. Do NOT gate the drain on `dispatched`.
Leave the existing `/id reset (payload)` / `/id reset` build logic and the existing setText("") / clearAfterSend() / setErrorMessage error branch UNCHANGED.

Step D — Meter well constants + helper.
Above the component function, add `const SEG_COUNT = 12;` (module-level, near DEBOUNCE_MS is a good home).
Inside the component body (after the drain state block), compute:
- `const litCount = contextPct != null ? Math.round((contextPct / 100) * SEG_COUNT) : 0;`

Step E — Replace the old meter tube with the meter well container.
Delete the entire block at lines ~397-425 (the `{typeof contextPct === "number" && (<div ...meter tube...>)}` conditional). Replace with an UNCONDITIONAL meter well div as the FIRST child of the `<div className="flex items-end gap-2">` row.

Meter well container spec:
- Tag: `<div>`.
- className: `w-7 self-stretch rounded-md flex flex-col p-[3px] bg-[rgba(10,12,20,0.6)] border border-[rgba(220,225,245,0.1)] shadow-[inset_0_2px_6px_rgba(0,0,0,0.55),_0_1px_0_rgba(220,225,245,0.05)]`
- Attributes: role="meter", aria-label="Context window", aria-valuemin={0}, aria-valuemax={100}, aria-valuenow={contextPct ?? undefined}, title={contextPct != null ? `Context ${contextPct}%` : "Context (unknown)"}.
- Three children in order: segments container, divider, reset cell.

Step F — Segments container (first child of meter well).
- Tag: `<div className="flex-1 flex flex-col-reverse gap-[2px] min-h-[30px]">`.
- Children: 12 segment divs. Use `Array.from({length: SEG_COUNT}, (_, i) => ...)` or a similar loop.
- For each segment index i in 0..SEG_COUNT-1:
  - `posPct = (i / (SEG_COUNT - 1)) * 100`
  - Position band: posPct >= 78 → red; else posPct >= 45 → amber; else green.
  - Lit if `i < litCount` AND contextPct is a number.
  - Segment className: `flex-1 min-h-[2px] rounded-[1.5px] transition-[background,box-shadow] duration-[220ms] ease-out`.
  - Segment style:
    - `transitionDelay: `${(SEG_COUNT - 1 - i) * 35}ms``.
    - `background`: if lit AND NOT isDraining → lit gradient for band; else → dim color for band.
    - `boxShadow`: if lit AND NOT isDraining → lit glow for band; else → "none".
  - CRITICAL: during drain, ALL segments render as dim (their position color). The `flex flex-col-reverse` reversal means index 0 renders at the bottom of the well and index 11 at the top; combined with the transitionDelay formula, drain visually sweeps top-to-bottom (topmost segment fades first, bottommost segment fades last around 385 + 220 = 605ms).
- Color tokens (use exactly these strings — copy verbatim from spec):
  - Lit green bg: `linear-gradient(90deg, hsla(155,45%,52%,1), hsla(155,45%,42%,1))`
  - Lit amber bg: `linear-gradient(90deg, hsla(38,75%,55%,1), hsla(38,75%,45%,1))`
  - Lit red bg:   `linear-gradient(90deg, hsla(0,72%,55%,1), hsla(0,72%,42%,1))`
  - Lit green shadow: `0 0 5px hsla(155,45%,45%,0.5), inset 0 0 2px rgba(220,255,235,0.45)`
  - Lit amber shadow: `0 0 5px hsla(38,75%,55%,0.55), inset 0 0 2px rgba(255,240,200,0.5)`
  - Lit red shadow:   `0 0 6px hsla(0,72%,55%,0.7), inset 0 0 2px rgba(255,220,200,0.5)`
  - Dim green bg: `hsla(155,35%,20%,0.4)`
  - Dim amber bg: `hsla(38,45%,22%,0.4)`
  - Dim red bg:   `hsla(0,50%,22%,0.4)`

Step G — Divider (second child of meter well).
`<div className="h-px my-[3px] bg-[rgba(220,225,245,0.09)] shadow-[0_1px_0_rgba(0,0,0,0.55)]" />`

Step H — Reset cell (third child of meter well).
Use a NATIVE `<button type="button">` (NOT the shadcn Button — per spec recommendation and confirmed by planner: the outline variant carries `dark:bg-input/30` which would force `!` gymnastics and the size-7 rounded-none default doesn't fit the w-full h-6 rounded-[2px] cell shape we need).

Reset cell requirements:
- Attributes: type="button", onClick={handleResetSend}, disabled={canSend === false}, aria-label="Send with /id reset prefix", title="Send with /id reset prefix".
- Base className tokens (combine via cn):
  - `w-full h-6 rounded-[2px] border-0 flex items-center justify-center p-0 cursor-pointer`
  - `transition-[background,box-shadow,color] duration-[180ms]`
  - `disabled:opacity-40 disabled:cursor-not-allowed`
- Resting/unlit-green (when NOT isDraining):
  - `bg-[hsla(155,35%,20%,0.5)]`
  - `shadow-[inset_0_0_3px_rgba(0,0,0,0.4)]`
  - `text-[rgba(220,255,235,0.55)]`
- Hover (only apply when NOT isDraining — apply as a `:not-disabled:hover:` prefixed set, or wrap in a conditional array so the drain state's lit styling isn't fighting a hover selector at the same time):
  - `hover:bg-[linear-gradient(90deg,hsla(155,45%,52%,1),hsla(155,45%,42%,1))]`
  - `hover:shadow-[0_0_8px_hsla(155,45%,45%,0.6),_inset_0_0_3px_rgba(220,255,235,0.4)]`
  - `hover:text-[#f0f8f4]`
- Drain-pulse (when isDraining === true, applied as static classes not hover): same lit-green styling as hover — bg linear-gradient, shadow with outer glow + inset, text-[#f0f8f4].
- Timing detail: use the SIMPLER ALTERNATIVE from the spec — set a second boolean via nested setTimeout so the pulse peaks near the end of the drain rather than at click time. Concretely:
  - Add `const [isPulsing, setIsPulsing] = useState(false);` next to isDraining.
  - Extend the drain trigger in handleResetSend: alongside the existing 800ms setIsDraining(false) timer, schedule a setIsPulsing(true) at ~420ms and a setIsPulsing(false) at ~770ms, storing handles so they're cleaned up. Simplest form: use two additional refs (or extend drainTimerRef to a small array/tuple) and clear ALL of them at the top of each new click AND in the unmount cleanup effect.
  - Apply the lit-green styling on the reset cell when `isPulsing === true` (not when `isDraining` alone).
- Content: `<RotateCcw className="size-3.5" />`.

Step I — Icon column trim (lines ~497-565).
Delete the RotateCcw `<Button>` block (currently lines ~506-525). Leave the `<div className="flex flex-col gap-1">` wrapper. Leave the ThumbsUp Button and Send Button EXACTLY as they are — do not touch their className strings, disabled logic, aria-labels, or handlers.

Step J — Comment hygiene.
The comment at lines ~490-496 describes the OLD three-button icon column ("rotate-ccw ... on top, thumbs-up ... in the middle, paper-airplane Send on the bottom"). Update this JSX comment to reflect the new two-button column: ThumbsUp on top, Send on the bottom. Keep the tone consistent with the surrounding comments (short, grounded in mechanical facts).

The comment at lines ~391-396 describes the OLD thin fill bar meter. Replace it with a JSX comment describing the new meter well: 12-segment vertical instrument that always mounts, fills bottom-to-top per contextPct with position-colored bands (green low → amber mid → red high), integrates the reset cell as its bottom slot, drains top-to-bottom on reset click. Keep it factual, no marketing prose.

Do NOT touch: handleSend, handleQuickSend, handleTextChange, handleBlur, handleKeyDown, clearAfterSend, scheduleAutosave, flushDirty, the load-on-mount useEffect, the pagehide/visibilitychange useEffect, the 10s retry interval useEffect, the auto-focus useEffect, the auto-grow `rows` calculation, the Textarea JSX, the errorMessage render, or anything in the surrounding Layout comment block (lines ~357-360).

Do NOT introduce any new imports beyond what's already at the top of the file. `useEffect`, `useRef`, `useState`, `useCallback` are already imported. `RotateCcw`, `Send`, `ThumbsUp` are already imported. `cn` is already imported. If you factor the segment mapper into an inline arrow function or helper, keep it inside ComposeBox — do not export it.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet && npx tsc --noEmit 2>&1 | tail -30 && npx vite build 2>&1 | tail -20</automated>
  </verify>
  <done>
- Compose shelf outer padding is px-2 py-2 (was px-3 py-3).
- Compose row's first child is the new meter well div (w-7 self-stretch rounded-md, always mounted, role="meter").
- Meter well contains: 12-segment container (flex-col-reverse), divider (h-px), and native-button reset cell (w-full h-6 rounded-[2px]) in that order.
- Segments light bottom-to-top per litCount = round(contextPct/100 * 12) when contextPct is a number; all dim when contextPct is null.
- Position colors follow the 45/78 posPct thresholds (green / amber / red).
- Each segment carries transitionDelay = (SEG_COUNT - 1 - i) * 35ms so drain sweeps top→bottom, refill sweeps bottom→top.
- Icon column on the right has exactly two buttons: ThumbsUp then Send. RotateCcw is gone from the column.
- ThumbsUp and Send Button JSX blocks are unchanged (classNames, handlers, aria, disabled logic all identical to pre-patch).
- isDraining state exists, drainTimerRef exists, isPulsing state exists (with its own timer refs), and cleanup on unmount clears all pending timers.
- handleResetSend triggers isDraining=true immediately, isPulsing=true at ~420ms, isPulsing=false at ~770ms, isDraining=false at 800ms — regardless of dispatch success. All other handleResetSend logic (payload build, onSend, setText, clearAfterSend, errorMessage) is unchanged.
- Reset cell wears resting/unlit-green at rest, lit-green on hover (only when NOT isDraining), and lit-green while isPulsing.
- The RotateCcw icon size dropped from size-4 (old Button) to size-3.5 (new native cell).
- JSX comments above the meter well and above the icon column reflect the new structure.
- `npx tsc --noEmit` completes with zero errors.
- `npx vite build` completes with zero errors.
- Manual browser verification is deferred to the human-verify checkpoint below.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Ashley browser eyeball — cohesive instrument + drain animation</name>
  <what-built>
Patch #83 restructures the ComposeBox compose row: the old thin colored strip meter and the separate RotateCcw icon-column button have been replaced by a single segmented-well "instrument" — a 12-segment vertical meter with an integrated reset cell at its bottom. Clicking reset triggers a top-to-bottom drain sweep (~600ms) with the reset cell pulsing lit-green at the drain peak.
  </what-built>
  <how-to-verify>
1. `npm run dev` (or whatever the fork's dev command is) and open a Skynet window with a pretty-view pane where `contextPct` is set (any pane with a Claude Code session running).
2. Confirm visual: meter and reset button read as ONE instrument (shared well, shared vocabulary) — not two separate widgets.
3. Confirm segments: 12 stacked segments, position-colored (bottom green → middle amber → top red), lit up to the current contextPct level. Dim segments above the lit line show their position color at low alpha.
4. Confirm reset cell rests as unlit-green; hover it — cell brightens to lit-green with outer glow. Move mouse away — cell settles back.
5. Click the reset cell.
   - `/id reset` (or `/id reset (your typed body)`) should arrive at the underlying Claude session.
   - Drain animation runs top-to-bottom over ~400-600ms (topmost segment fades first, bottommost last).
   - Near the end of the drain (~420ms after click), reset cell pulses lit-green, then settles back to unlit-green.
6. Type some text, click reset — payload should be `/id reset (typed text)`, textarea clears after successful dispatch.
7. Open a pretty-view pane where `contextPct` is null / unknown (fresh attach before the meter has been scraped). Confirm meter well STILL mounts (all-dim segments visible), reset cell still functional.
8. Confirm icon column on the right is now ThumbsUp + Send only (RotateCcw gone from that column). ThumbsUp still fires "go ahead". Send still fires the current textarea body.
9. Compose shelf outer padding should visually match the inner column gaps (no asymmetric gap around the meter well or icon column edge).
  </how-to-verify>
  <resume-signal>Type "approved" if everything reads correctly, or describe visual/behavioral issues so we can iterate before commit.</resume-signal>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` — zero errors.
- `npx vite build` — clean build.
- No files touched outside src/ui/features/pretty-view/ComposeBox.tsx.
- Ashley browser eyeball (Task 2 checkpoint) — cohesive instrument reads correctly, drain animation runs, reset dispatch fires, null-contextPct case handled.
</verification>

<success_criteria>
- Single-file patch to ComposeBox.tsx committed to `feat/tab-title-from-tmux` after Ashley's approval.
- tsc + vite build pass.
- All existing behaviors preserved: /id reset dispatch (with and without typed body), textarea clears on success, errorMessage on failed dispatch, ThumbsUp go-ahead, Send handler, draft persistence (autosave/keepalive/retry), auto-focus, auto-grow rows.
- New behaviors delivered: 12-segment cohesive meter well always mounts, integrated reset cell with resting/hover/drain-pulse states, top-to-bottom drain sweep animation on reset click, symmetric compose shelf padding.
- Deploy is a SEPARATE step Ashley controls (per tina.md deploy discipline) — this task stops at commit.
</success_criteria>

<output>
Create `.planning/quick/260719-tjk-patch-83-cohesive-instrument-compose-met/260719-tjk-SUMMARY.md` when Ashley approves the checkpoint and the commit lands.
</output>
