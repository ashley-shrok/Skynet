---
phase: 14-plain-language-translation-asides
plan: 03
subsystem: frontend
tags: [frontend, pretty-view, aside, bubble, arm-emitter, composebox-interface, tdd]

# Dependency graph
requires:
  - phase: 14-plain-language-translation-asides plan 01
    provides: Wave 1 primitives (BTW_PROMPT + injectBtw + sendEscapeToBtw + extractBtwAnswer + ASIDE_END_MARKER + shellQuote) — landed in backend, not directly imported by frontend but form the contract this wave's arm-emitter targets
  - phase: 14-plain-language-translation-asides plan 02
    provides: AsideReadyEvent + AsideDismissedEvent + AsideArmPayload + AsideDismissedPayload WS wire types — Wave 3 consumes the server-event union (implicitly via PrettyView's existing ClaudeSessionServerEvent switch) and sends aside_arm + aside_dismissed by wire-shape (not by import — the payloads are compile-time-constant JSON.stringify literals so no runtime type import is required)
  - phase: 09 (WIP-indicator idle-window signal)
    provides: PrettyView's existing isIdle?: boolean | null prop (Terminal.tsx → PrettyView via L94/L137) — Wave 3 hooks its false→true transition to emit aside_arm
  - phase: 04-05 (identity-hue infra + useSessionIdentity)
    provides: --pv-id-hue CSS var + useSessionIdentity(tmuxSession) — AsideBubble consumes the CSS var; PrettyView consumes the identity-gate for arm emission
provides:
  - AsideBubble React component at src/ui/features/pretty-view/AsideBubble.tsx (130 lines) with locked CONTEXT.md § Rendering aesthetic
    - Props: text: string, glow?: number (default 1.0), borderWidthPx?: number (default 10)
    - Pure function of props (no state / no effects / no refs / no event handlers)
    - role='note' + aria-label='Plain-language aside from the identity' — semantic wrapper
    - Identity-hue gradient background copied VERBATIM from ChatMessage L124 (inlined class strings, no cross-component import)
    - 10px opaque hue border + three-layer neon glow at 12/32/64px, alphas 0.7/0.5/0.3 — ADDITIVE to base depth shadow + inner rim
    - whitespace-pre-wrap inner div — preserves multi-line /btw answer newlines; React default text-child escaping mitigates T-14-03-01
  - ComposeBoxProps interface extension (interface-only; body consumption Wave 4):
    - asideActive?: boolean
    - onAsideDismiss?: () => void
  - PrettyView wiring (10 additive edits, zero existing logic modified):
    - AsideBubble import
    - asideText useState<string | null>(null)
    - prevIsIdleRef useRef<boolean | null | undefined>(isIdle)
    - Fresh-pane reset block extended with setAsideText(null)
    - WS event switch extended with aside_ready (→ setAsideText(parsed.text)) and aside_dismissed (→ setAsideText(null)) cases
    - handleAsideDismiss useCallback — optimistic clear + WS-send {type:'aside_dismissed', hostId, tmuxSession}
    - isIdle-transition arm-emitter useEffect — SOLE trigger source per CONTEXT.md § Trigger LOCK; guards on prev===false && isIdle===true && pvIdentity != null && ws.OPEN
    - AsideBubble render slot immediately after {planPending && <PlanPendingBubble />} (in-flow at bottom of message stream per ASIDE-05)
    - ComposeBox mount extended with asideActive={asideText !== null} and onAsideDismiss={handleAsideDismiss}
affects:
  - 14-04 (Wave 4: ComposeBox morph — consumes asideActive prop to gate aux buttons + morph Send→X; consumes onAsideDismiss prop as X-click handler)
  - 14-05 (Wave 5: integration + smoke tests — validates end-to-end aside cycle across the full stack)

# Tech tracking
tech-stack:
  added: []  # Zero new deps — reuses React (useCallback / useEffect / useRef / useState), cn from @/lib/utils, existing WS connection, existing testing infra (@testing-library/react + vitest)
  patterns:
    - "aesthetic-locked-inline-style — CSS values (border-width, box-shadow) that are prop-driven use inline style (JIT can't pre-compile them as Tailwind arbitrary-value classes); base identity-hue treatment uses Tailwind arbitrary-value classes (stable across every render, JIT pre-compilable). Consistent with aside-visual-snippet.js prototype Ashley signed off on."
    - "verbatim-class-string-copy — AsideBubble copies the identity-hue gradient / prose-invert / Inter-font class strings from ChatMessage L124-127 rather than importing. Keeps AsideBubble self-contained per PATTERNS.md § Analog rationale — no cross-component coupling means future ChatMessage refactors can't break AsideBubble by surprise."
    - "interface-first-across-wave-boundaries — plan-checker W3 correction: interface extensions land in the CONSUMING wave (here Wave 3), NOT in the PRODUCING wave (Wave 4). PrettyView passes asideActive + onAsideDismiss to ComposeBox in Wave 3; ComposeBox's interface accepts them in Wave 3; ComposeBox's BODY consumes them in Wave 4. Wave-boundary tsc gate stays clean at every commit."
    - "prev-value ref for transition detection — useRef holding the previous render's value + useEffect updating the ref before evaluating the guard. Standard React pattern for 'fire once on X → Y transition' without a race with the render cycle. Initialization to CURRENT value on mount ensures mount-with-already-Y doesn't false-trigger."
    - "frontend-arm-single-source-of-truth — extends Wave 2's backend contract: the SOLE aside trigger comes from PrettyView's isIdle-transition arm-emitter. Backend has no cross-WSS coupling; frontend has no parallel debounce. Identity gating happens frontend-side (before emit); backend gates only on connection-state (asideState Map)."
    - "doc-comment-vs-negative-grep-rewrite — Wave 2 precedent (14-02-SUMMARY.md § Deviations #2) applied prophylactically to Task 2's JSDoc: describes the future Wave 4 edit in prose WITHOUT using the literal comparison expression the negative grep gate is checking for."
    - "additive-only wiring — Wave 3 modifies existing files (PrettyView.tsx + ComposeBox.tsx) purely by ADDING new lines. Zero existing state, callback, WS handler, reset logic, effect, or render branch removed or rewritten. All existing behavior byte-preserved."

key-files:
  created:
    - src/ui/features/pretty-view/AsideBubble.tsx (130 lines) — new pretty-view bubble type with locked CONTEXT.md aesthetic
    - src/ui/features/pretty-view/AsideBubble.test.tsx (85 lines) — 5 vitest cases covering render, glow multiplier, borderWidthPx, whitespace-pre-wrap
    - src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx (56 lines) — 2 type-shape tests for the interface extension (RED at tsc-compile time, GREEN after)
    - src/ui/features/pretty-view/PrettyView.aside.test.tsx (279 lines) — 5 integration tests: aside_ready render, aside_dismissed clear, isIdle-transition arm on identity, isIdle-transition NO-arm on anonymous, fresh-pane reset
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx (+152 lines) — 10 additive wiring edits (import + state + ref + reset extension + WS handlers + callback + effect + render slot + prop plumbing)
    - src/ui/features/pretty-view/ComposeBox.tsx (+32 lines) — ComposeBoxProps interface extension only (asideActive + onAsideDismiss). Body untouched.

key-decisions:
  - "AsideBubble is a NEW sibling of ChatMessage / ImageBubble / PlanPendingBubble / WipBubble — NOT a fork of any existing component. Copies class strings verbatim from ChatMessage L124 rather than importing, so ChatMessage can be refactored in the future without breaking AsideBubble."
  - "AsideBubble aesthetic locked per CONTEXT.md § Rendering + aside-visual-snippet.js: 10px opaque hue border + three-layer neon glow at 12/32/64px alphas 0.7/0.5/0.3. Prop-driven glow multiplier and borderWidthPx are seams for future iteration without rewrite (per CONTEXT.md § Rendering final sentence)."
  - "AsideBubble mounts as the LAST child of contentRef's flex column (immediately after PlanPendingBubble) — inherits pin-to-bottom from useAutoScroll's existing ResizeObserver. In-flow (per ASIDE-05), NOT an overlay / popup / fixed-position element. Scrolling up while aside is displayed works exactly as before."
  - "PrettyView emits {type:'aside_arm'} on isIdle:false→true when pvIdentity != null && wsRef.OPEN — THE SOLE trigger source per CONTEXT.md § Trigger LOCK 2026-07-26 (frontend-arm architecture, decided post plan-checker B1/B2/B4). Backend does NOT observe terminal WSS idle frame; the two WSSes stay decoupled."
  - "Identity gating happens FRONTEND-SIDE (per CONTEXT.md § Trigger + ASIDE-02). Anonymous sessions never emit arm; backend accepts any aside_arm on a connected pretty-view WS without checking identity. Aligned with Wave 2's backend contract."
  - "prevIsIdleRef initialized to CURRENT isIdle prop on mount — a component that mounts WITH isIdle already true does NOT fire arm on first paint. Only a REAL false→true transition (prev===false && isIdle===true) arms. Also excludes prev===undefined (initial mount) and prev===null (backend hasn't spoken yet)."
  - "handleAsideDismiss is a two-step callback: (1) optimistic setAsideText(null) — AsideBubble unmounts immediately, no visible latency waiting for the WS round-trip; (2) WS-send {type:'aside_dismissed', hostId, tmuxSession} — Wave 2 backend does sendEscapeToBtw + broadcastAsideDismissed. Backend IGNORES msg.hostId/msg.tmuxSession for send-keys routing per T-14-02-01 mitigation; these fields are informational only. Idempotent: if the WS is closed, the optimistic clear still happened; peer tabs' subsequent aside_dismissed WS frames re-clear (no-op on this tab; visible clear on peers)."
  - "ComposeBoxProps interface extension (asideActive + onAsideDismiss) landed in Wave 3 per plan-checker W3 correction — NOT in Wave 4. This split-wave ordering means PrettyView's mount can typesafely pass these props in Wave 3; Wave 4 then implements only the body consumption with zero interface risk. Wave 3 does NOT modify ComposeBox's body — all three negative-grep gates (no 'asideActive === true' anywhere, no aria-label morph, no lucide X import) confirm."
  - "Fresh-pane reset extended with setAsideText(null) — a pane switch clears any aside carried over from the prior pane. Wave 2 backend's connect-time re-attach probe (ASIDE-09) will re-emit aside_ready if the NEW pane's tmux still has an open BTW overlay, so this reset is safe."
  - "ChatMessage / ImageBubble / PlanPendingBubble / WipBubble bytes UNCHANGED — git diff --stat over the wave's commit range confirms only PrettyView.tsx and ComposeBox.tsx are modified. Preserves Ashley's 'pretty-view chat surface interior is LOCKED — add NEW bubble types, don't modify existing ones' invariant from CONTEXT.md canonical_refs."
  - "Doc-comment prophylaxis for negative-grep gate — Task 2's JSDoc for asideActive originally read 'extend each aux-button disabled predicate with `|| asideActive === true`' but the plan verify block's negative grep on `asideActive === true` false-positive'd on prose. Rewrote in-place to describe the same Wave 4 edit without using the literal expression. Precedent: 14-02-SUMMARY.md § Deviations #2 (same doc-vs-grep pattern from Wave 2)."

patterns-established:
  - "Verbatim-class-string copy for aesthetically-related sibling components — when two components share a base visual treatment but need different override layers, prefer inlining the base class strings in both rather than exporting/importing them. Keeps each component independently refactorable and colocated with its overrides. Applies to any future pretty-view bubble variant."
  - "Prev-value useRef + useEffect for false→true transition detection — this pattern is a fixture in React (there's no built-in usePrevious hook), and Wave 3's isIdle-transition arm emitter is its canonical usage in this codebase. Generalizes to any 'fire once on state X transition' pattern."
  - "Interface-first split-wave ordering — when Wave N passes props and Wave N+1 consumes them inside the destination component's body, the interface EXTENSION must land in Wave N (not N+1) so Wave N's mount site typechecks immediately. Same-wave alternative would require touching both the passing side and the consuming body in one wave, ballooning scope."
  - "Additive-only editing of large existing components — PrettyView is 996 lines pre-wave; Task 3 adds 152 lines with zero existing lines modified or deleted. Pattern: identify insertion anchors via grep of stable existing patterns (useState block, WS switch cases, effect declarations, ComposeBox mount) and INSERT new siblings/cases in-place. Preserves rebase-ability against upstream and keeps blast radius minimal."

requirements-completed: [ASIDE-01, ASIDE-02, ASIDE-05, ASIDE-09]
# ASIDE-01 (arm emitter) — frontend fires aside_arm on isIdle:false→true; Wave 2 backend receives + injects /btw. Full trigger loop closed.
# ASIDE-02 (identity gate) — frontend gates arm emission on pvIdentity != null; anonymous sessions never emit.
# ASIDE-05 (rendering) — AsideBubble mounts in-flow at bottom of message stream with locked aesthetic; NOT an overlay.
# ASIDE-09 (re-attach) — Wave 2's connect-time probe emits aside_ready to a late-mounting client; Wave 3's WS handler in PrettyView is the receiver that renders it.
# ASIDE-06 / ASIDE-07 (ComposeBox morph + dismiss behavior) — Wave 4 owns the button gate + Send→X morph body; Wave 3 ships the interface contract + the handleAsideDismiss callback that Wave 4 will wire to the morphed X-click.
# ASIDE-08 / ASIDE-11 (cross-tab dismiss coherence + overlap policy) — Wave 2 owns the atomic BOTH-STEPS broadcast primitive; Wave 3's aside_dismissed WS handler is the peer-tab receive path.

# Metrics
duration: ~14min
completed: 2026-07-26
---

# Phase 14 Plan 03: Aside Wave 3 Frontend Rendering + Arm-Emitter + ComposeBox Interface Summary

**Three tasks land the frontend arm of the aside subsystem: (1) the new AsideBubble React component with the locked 10px + three-layer neon-glow identity-hue aesthetic Ashley signed off on, (2) the ComposeBoxProps interface extension carrying asideActive + onAsideDismiss for Wave 4's body consumption, (3) PrettyView's ten-edit wiring layer — state + refs + WS event handlers + isIdle-transition arm emitter + handleAsideDismiss callback + AsideBubble mount + ComposeBox prop plumbing + fresh-pane reset extension. Full frontend-arm architecture (per CONTEXT.md § Trigger LOCK 2026-07-26) is now closed: PrettyView emits aside_arm on isIdle:false→true when pvIdentity != null, and receives aside_ready + aside_dismissed WS frames to drive AsideBubble mount/unmount with cross-tab dismiss coherence. Landed via strict TDD RED→GREEN with 12 passing new vitest cases across three test files and full pretty-view regression at 117/119 (2 pre-existing ComposeBox.test.tsx failures documented in deferred-items.md, unrelated to Phase 14).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-26T18:24:47Z (PLAN_START_TIME)
- **Completed:** 2026-07-26T18:38:39Z
- **Tasks:** 3 (all TDD, each RED→GREEN)
- **Files modified:** 6 (1 source file created, 2 source files extended, 3 test files created)

## Accomplishments

- AsideBubble component created with all nine identity-hue class strings copied VERBATIM from ChatMessage L124-127 + LOCKED 10px border + LOCKED three-layer neon-glow inline style; prop-driven glow multiplier (default 1.0) and borderWidthPx (default 10) as future dial-back seams
- ComposeBoxProps interface extended with asideActive + onAsideDismiss as optional additive fields; ComposeBox function body UNCHANGED (three negative-grep gates confirm: no 'asideActive === true' anywhere, no aria-label morph, no lucide X import)
- PrettyView wired end-to-end with 10 additive edits — import + state + prev-ref + reset extension + two WS switch cases + handleAsideDismiss callback + isIdle-transition arm-emitter useEffect + AsideBubble render slot + ComposeBox prop plumbing
- Frontend-arm architecture single-source-of-truth CLOSED: PrettyView emits aside_arm on isIdle:false→true when pvIdentity != null && wsRef.OPEN — Wave 2's backend already listens for this signal and injects /btw + arms the extraction poller
- Identity gating happens FRONTEND-SIDE per CONTEXT.md § Trigger LOCK 2026-07-26 + ASIDE-02 — anonymous sessions never emit arm; verified by Test 4 of PrettyView.aside.test.tsx
- Fresh-pane reset clears asideText — new pane starts clean; Wave 2's connect-time re-attach probe (ASIDE-09) will re-emit aside_ready if the new pane's tmux still has an open BTW overlay
- ChatMessage / ImageBubble / PlanPendingBubble / WipBubble bytes UNCHANGED (git diff --stat confirms)
- ComposeBox BODY unchanged — Wave 4 will implement button gates + Send→X morph consuming Wave 3's interface

## Task Commits

Each task followed strict TDD RED→GREEN with a commit at each gate:

1. **Task 1 RED:** `8c266a5` — test(14-03): add failing RED-gate tests for AsideBubble component (5 vitest cases; fails at import-resolution time since AsideBubble.tsx does not exist yet)
2. **Task 1 GREEN:** `01d9350` — feat(14-03): add AsideBubble component with locked identity-hue + neon-glow aesthetic (5/5 pass, 9/9 plan grep gates pass, tsc clean)
3. **Task 2 RED:** `88eaf0e` — test(14-03): add failing RED-gate type-shape test for ComposeBoxProps aside fields (fails at tsc-compile time with TS2353 — precedent 14-02-SUMMARY.md L233: RED gate at tsc-compile time is standard for interface-additive changes; vitest runtime accepts satisfies-erased shape)
4. **Task 2 GREEN:** `e9b0790` — feat(14-03): extend ComposeBoxProps with asideActive + onAsideDismiss (interface-only) (2/2 new tests pass, all 5 plan grep gates pass including 3 negative-greps confirming body untouched, tsc clean)
5. **Task 3 RED:** `322e67f` — test(14-03): add failing RED-gate tests for PrettyView aside subsystem wiring (5 integration tests; 4/5 fail as expected on RED — Test 4's negative-case trivially passes when no arm-emitter exists to violate the anonymous gate)
6. **Task 3 GREEN:** `8640804` — feat(14-03): wire PrettyView aside subsystem — state + WS handlers + arm-emitter + AsideBubble mount (5/5 pass, all 13 plan grep gates pass, setAsideText(null) count = 3, tsc clean)

## Files Created/Modified

- **CREATED** `src/ui/features/pretty-view/AsideBubble.tsx` (130 lines) — new pretty-view bubble type; pure function of props; role='note' + aria-label constant string; identity-hue gradient background via inlined Tailwind arbitrary-value classes; inline style for prop-driven border-width and five-layer boxShadow (three neon glow + additive depth + inner rim); whitespace-pre-wrap inner div for multi-line answer text preservation
- **CREATED** `src/ui/features/pretty-view/AsideBubble.test.tsx` (85 lines) — 5 vitest cases: (1) renders text with role='note'; (2) default props render 10px border + 0.7/0.5/0.3 glow alphas; (3) glow=0.5 halves alphas to 0.35/0.25/0.15; (4) borderWidthPx=6 renders 6px; (5) whitespace-pre-wrap preserves multi-line text
- **CREATED** `src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx` (56 lines) — 2 type-shape tests: (1) accepts both new fields via satisfies clause (tsc-time RED gate); (2) legacy caller without the new fields still satisfies ComposeBoxProps (backward-compat guard against non-optional typo)
- **CREATED** `src/ui/features/pretty-view/PrettyView.aside.test.tsx` (279 lines) — 5 integration tests using WS-stub scaffolding + ResizeObserver stub: (1) aside_ready renders AsideBubble; (2) aside_dismissed clears; (3) isIdle:false→true on identity-attached session emits aside_arm; (4) same transition on anonymous session does NOT emit; (5) fresh-pane mount clears asideText
- **MODIFIED** `src/ui/features/pretty-view/PrettyView.tsx` (+152 lines) — 10 additive edits per plan Task 3 action block; zero existing state / effect / WS handler / reset logic / render branch modified
- **MODIFIED** `src/ui/features/pretty-view/ComposeBox.tsx` (+32 lines) — ComposeBoxProps interface extension only (asideActive?: boolean + onAsideDismiss?: () => void as optional additive fields with JSDoc referencing Wave 4 body consumption); function body byte-unchanged

## Approximate Line Ranges (post-wiring)

For Wave 4 that needs to reference PrettyView / ComposeBox insertion points landed by this wave, the key additions are at:

**PrettyView.tsx (`src/ui/features/pretty-view/PrettyView.tsx`):**
- AsideBubble import — L19 (added alongside PlanPendingBubble import)
- asideText useState declaration — L202-221 (in the state block near setPlanPending)
- prevIsIdleRef useRef declaration — L266-274 (near reconnect refs)
- Fresh-pane reset extended with setAsideText(null) — L342-346 (inside the paneKeyRef guard block)
- WS event switch aside_ready case — L438-450 (immediately after plan_pending case)
- WS event switch aside_dismissed case — L451-462 (immediately after aside_ready case)
- handleAsideDismiss useCallback — L262-289 (immediately after onResetClicked callback)
- isIdle-transition arm-emitter useEffect — L779-813 (immediately after the last isHolding effect, before return statement)
- AsideBubble render slot — L926-931 (immediately after {planPending && <PlanPendingBubble />})
- ComposeBox mount extended with asideActive + onAsideDismiss props — L1004-1010 (in the ComposeBox mount JSX)

Line numbers are approximate; grep-verify before editing in Wave 4 — Wave 4 will touch ComposeBox.tsx and may shift these numbers if additional PrettyView edits are needed (unlikely — Wave 4's scope is body-only in ComposeBox).

**ComposeBox.tsx (`src/ui/features/pretty-view/ComposeBox.tsx`):**
- ComposeBoxProps interface — L89-215 (extended from prior 89-193; two new fields inserted before `className?: string;` at L214)
- asideActive?: boolean — L207
- onAsideDismiss?: () => void — L213

**Wave 4 does NOT need to import any new symbols from Wave 3.** The Wave 3 → Wave 4 contract is entirely (a) the ComposeBoxProps interface fields Wave 3 added, (b) PrettyView's existing prop-passing mount in PrettyView.tsx. Wave 4 destructures asideActive + onAsideDismiss inside ComposeBox's body and consumes them: aux-button disable predicates gain the asideActive gate; the Send button morphs to X (aria-label / title / onClick / icon branch on asideActive); X import from lucide-react is added.

## Verification Evidence

### Task 1 verify (all 9 grep gates + tsc + vitest)

- `grep -q "export function AsideBubble"` = **OK**
- `grep -q "borderWidthPx"` = **OK**
- `grep -q "glow"` = **OK**
- `grep -q "hsla(var(--pv-id-hue), 90%, 65%, 1)"` = **OK** (opaque border color)
- `grep -q "0 0 12px hsla(var(--pv-id-hue)"` = **OK** (inner glow layer)
- `grep -q "0 0 32px hsla(var(--pv-id-hue)"` = **OK** (mid glow layer)
- `grep -q "0 0 64px hsla(var(--pv-id-hue)"` = **OK** (outer glow layer)
- `grep -q 'role="note"'` = **OK**
- `grep -q "whitespace-pre-wrap"` = **OK**
- `npx tsc --noEmit` = **exit 0**
- `npx vitest run src/ui/features/pretty-view/AsideBubble.test.tsx` = **5/5 pass** (Test Files 1 passed)

### Task 2 verify (5 grep gates including 3 negative-greps + tsc + existing tests)

- `grep -q "asideActive?:"` = **OK**
- `grep -q "onAsideDismiss?:"` = **OK**
- **NEGATIVE** `! grep -q "asideActive === true"` = **OK** (Wave 4 will add these to aux-button disable predicates; doc comment rewritten to avoid false-positive per 14-02-SUMMARY.md § Deviations #2 precedent)
- **NEGATIVE** `! grep -q 'aria-label={asideActive'` = **OK** (Wave 4 will add this to Send button)
- **NEGATIVE** `! grep -E "import ... X ... from lucide-react"` = **OK** (Wave 4 will add this)
- `npx tsc --noEmit` = **exit 0**
- `npx vitest run src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx` = **2/2 pass**
- `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` = **18 passed | 2 failed** — identical baseline to pre-Wave-3 per deferred-items.md (2 pre-existing failures unrelated to Phase 14; Wave 4 is the natural touchpoint for these fixes since it's already modifying ComposeBox)

### Task 3 verify (13 grep gates including 1 count-gate + tsc)

- `grep -q 'import { AsideBubble }'` = **OK**
- `grep -q 'asideText'` = **OK**
- `grep -q 'setAsideText'` = **OK**
- `grep -q '"aside_ready"'` = **OK**
- `grep -q '"aside_dismissed"'` = **OK**
- `grep -q '"aside_arm"'` = **OK**
- `grep -q '<AsideBubble'` = **OK**
- `grep -q 'asideActive'` = **OK**
- `grep -q 'onAsideDismiss'` = **OK**
- `grep -q 'handleAsideDismiss'` = **OK**
- `grep -q 'prevIsIdleRef'` = **OK**
- `grep -q "isIdle === true && pvIdentity"` = **OK** (transition guard)
- `grep -c 'setAsideText(null)'` = **3** (plan expects ≥ 2 — fresh-pane reset + aside_dismissed WS case + handleAsideDismiss body)
- `npx tsc --noEmit` = **exit 0**

### Test results

- `npx vitest run src/ui/features/pretty-view/AsideBubble.test.tsx` = **5/5 pass**
- `npx vitest run src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx` = **2/2 pass**
- `npx vitest run src/ui/features/pretty-view/PrettyView.aside.test.tsx` = **5/5 pass**
- `npx vitest run src/ui/features/pretty-view/` (full pretty-view suite) = **117 passed | 2 failed (119 total)** — 2 failures are pre-existing ComposeBox.test.tsx `getByLabelText(/send 'yes'/i)` cases documented in deferred-items.md (baseline 2/20 → still 2/20 after Wave 3, i.e. zero regression from Wave 3 work)

### Locked-file byte-preservation confirmations

- `git diff --stat HEAD~5 -- src/ui/features/pretty-view/{ChatMessage,ImageBubble,PlanPendingBubble,WipBubble}.tsx` = **empty** (zero lines changed in any of the four LOCKED bubble files)
- `git diff --stat HEAD~5` reports 6 files touched total: AsideBubble.tsx (created), AsideBubble.test.tsx (created), ComposeBox.aside-props.test.tsx (created), PrettyView.aside.test.tsx (created), ComposeBox.tsx (+32 interface-only), PrettyView.tsx (+152 additive wiring)

## Decisions Made

See frontmatter `key-decisions` block above. Highlights:

- **AsideBubble is a NEW sibling** to ChatMessage / ImageBubble / PlanPendingBubble / WipBubble — not a fork, not a modification of any existing bubble. Copies class strings VERBATIM from ChatMessage L124 rather than importing, so AsideBubble stands alone and ChatMessage refactors can't blast-radius it.
- **Aesthetic LOCKED per CONTEXT.md § Rendering + aside-visual-snippet.js.** Prop-driven glow multiplier + borderWidthPx are seams for future dial-back per CONTEXT.md § Rendering's final sentence — not user-tunable at v1 but the wire is in place.
- **Frontend-arm architecture SOLE trigger source.** PrettyView emits aside_arm on isIdle:false→true when pvIdentity != null && ws.OPEN. Backend has no cross-WSS coupling. Identity gating happens frontend-side per ASIDE-02 lock.
- **prevIsIdleRef initialized to CURRENT isIdle** — a component that mounts with isIdle already true does NOT fire arm on first paint. Only REAL false→true transitions arm, not initial steady-state observation.
- **handleAsideDismiss is two-step atomic:** optimistic setAsideText(null) BEFORE the WS-send + WS-send {type:'aside_dismissed', hostId, tmuxSession}. Optimistic clear happens even if WS is closed; peer tabs' subsequent aside_dismissed WS frames re-clear (idempotent).
- **ComposeBoxProps interface extension moved to Wave 3 per plan-checker W3.** Body consumption stays in Wave 4. Wave-boundary tsc gate stays clean.
- **Doc-comment prophylaxis for negative-grep gate** — same pattern as 14-02-SUMMARY.md § Deviations #2. Task 2's JSDoc for asideActive describes the Wave 4 edit in prose without using the literal comparison expression the negative grep is checking for.

## Deviations from Plan

One structural deviation from the strict letter of the plan, applied as an auto-fix per Rule 1 (bug):

### 1. [Rule 1 - Bug] Task 2 JSDoc doc-comment rewrite for negative-grep compliance

**Found during:** Task 2 GREEN verify — running the plan's negative-grep gate `! grep -q "asideActive === true"`.

**Issue:** The initial JSDoc I wrote for the new `asideActive` field on ComposeBoxProps included the literal prose 'extend each aux-button `disabled` predicate with `|| asideActive === true`' describing what Wave 4 would do. This false-positive'd the plan's negative grep gate that checks for `asideActive === true` in the source (the gate is meant to confirm Wave 3 doesn't accidentally implement Wave 4's body-level predicate extension).

**Fix:** Rewrote the JSDoc prose in-place to describe the Wave 4 edit WITHOUT using the literal comparison expression: `'extend each aux-button disabled predicate to also gate on this flag being true'`. Architectural intent + Wave 4 signposting preserved; negative-grep gate now passes clean. Added a defense-in-depth doc-comment note explicitly flagging the pattern for future editors.

**Precedent:** 14-02-SUMMARY.md § Deviations #2 documents the exact same doc-comment-vs-negative-grep pattern from Wave 2 (rewrote `type:"idle"` → `idle-signal frame` in prose). Same fix pattern applied here.

**Files modified:** src/ui/features/pretty-view/ComposeBox.tsx (JSDoc prose only; no behavior change)

**Commit:** `e9b0790` (rolled into the Task 2 GREEN commit — the rewrite was part of the same edit session; single self-consistent commit is cleaner than a separate fix commit)

### Not deviated (documented design choices per the plan)

- **Task 1 does NOT import cn conditionally.** Plan says "Import cn from `@/lib/utils`" — done.
- **AsideBubble does NOT accept an onDismiss prop.** Dismiss lives on ComposeBox morph (Wave 4) per CONTEXT.md § ComposeBox morph; the bubble is passive display. Followed spec exactly.
- **Task 3 does NOT use a new WS subscription for aside events.** The existing wsRef IS the pretty-view WS on port 30011; Wave 2 backend emits aside_ready / aside_dismissed on it and receives aside_arm / aside_dismissed from it. No new subscription mechanism needed. Followed spec.
- **prev===false guard on the arm-emitter** — plan explicitly says to exclude both prev===undefined and prev===null. Followed exactly; documented in the effect's inline comment.

## Authentication Gates

None. All work is pure code additions to frontend TypeScript + React; no environment variables, no external services, no infrastructure changes.

## Issues Encountered

**One RED-gate quirk on Task 3:** the initial RED test run failed with a ReferenceError: `ResizeObserver is not defined` from useAutoScroll's effect (jsdom doesn't ship ResizeObserver). Root cause: the WS-stub scaffolding I forked from PrettyView.test.tsx's Phase 05 tests didn't include the ResizeObserver stub — only the patch #148 reconnect describe block includes it. Fix: added the same `resizeObserverStub = vi.fn(function () { return { observe, unobserve, disconnect }; }); vi.stubGlobal('ResizeObserver', resizeObserverStub);` pattern to my beforeEach. After this fix, 4/5 tests failed as expected (aside functionality not yet wired) and 1/5 trivially passed (Test 4's negative case).

Otherwise: single-attempt RED→GREEN on all three tasks, no additional auto-fix cycles beyond the Task 2 doc-comment rewrite documented above.

## User Setup Required

None. Pure code additions to frontend TypeScript + React; no environment variables, no external services, no infrastructure changes. Wave 4 will land the ComposeBox morph body; still no user setup required. Wave 5 (integration + smoke tests) may need Ashley to eyeball the aesthetic in situ once end-to-end wiring is complete — but that's a Wave 5 concern, not a Wave 3 setup step.

## Next Phase Readiness

**Ready for 14-04 (Wave 4: ComposeBox morph body consumption).** The interface + wiring contract is complete:

- ComposeBoxProps accepts `asideActive?: boolean` + `onAsideDismiss?: () => void` (Wave 3 Task 2).
- PrettyView passes `asideActive={asideText !== null}` + `onAsideDismiss={handleAsideDismiss}` to ComposeBox (Wave 3 Task 3).
- Wave 4's ONLY remaining work: destructure the two props in ComposeBox's function signature, extend each aux-button disable predicate to gate on `asideActive`, morph the Send button (aria-label + title + onClick + icon branch), add `X` to the lucide-react import.

**Wave 4 should also absorb the pre-existing ComposeBox.test.tsx failures** documented in deferred-items.md (2/20 baseline unrelated to Phase 14). Wave 4 is already touching ComposeBox — this is the natural touchpoint per the deferred log.

**Wave 5 (integration + smoke tests) is the natural place for end-to-end aesthetic UAT** — Ashley eyeballs the aside in situ across the full stack (arm emit → backend inject → poller extract → aside_ready → AsideBubble render → X click → dismiss round-trip → cross-tab dismiss).

No blockers, no concerns.

## Threat Flags

None. The frontend surface added by this plan (AsideBubble component + PrettyView WS handlers + arm-emitter useEffect + handleAsideDismiss callback + ComposeBox interface extension) reuses the pretty-view WS on port 30011 already established by Phase 1 backend session-tail. Zero new trust boundaries, zero new endpoints, zero new schema at trust boundaries. All threats enumerated in `<threat_model>` (T-14-03-01 through T-14-03-SC) are mitigated by the code as landed:

- **T-14-03-01 (Injection):** AsideBubble renders text via `<div className="whitespace-pre-wrap">{text}</div>` — React's default text-child escaping ensures any `<script>` or `<img onerror>` in the /btw answer renders as literal text. No `dangerouslySetInnerHTML`, no markdown pipeline. Matches ChatMessage precedent since Phase 1.
- **T-14-03-02 (Tampering):** asideText state is set ONLY from server-authoritative WS frames (aside_ready / aside_dismissed) OR from the optimistic clear on X-click. No user-input path from the compose textarea reaches asideText.
- **T-14-03-03 (DoS via rapid arm sends):** Frontend's `prev === false && isIdle === true` guard filters transitions — only REAL false→true transitions emit; mount-with-idle-true does NOT. Backend Wave 2's overlap-ignore policy (`asideState.armed || asideState.displayed → no-op`) absorbs any residual rapid-arms.
- **T-14-03-04 (Info Disclosure):** AsideBubble aria-label is the compile-time-constant string `"Plain-language aside from the identity"` — no session PII.
- **T-14-03-05 (EoP — client spoofing arm for foreign session):** Per T-14-02-02 mitigation, the pretty-view WS is per-connection authenticated via connectToPane; a WS can only send messages that will execute against ITS OWN pane's authenticated tmux target. No cross-session escalation surface.
- **T-14-03-SC (Supply chain):** Zero new package installs. `cn` from `@/lib/utils` already used everywhere; `@testing-library/react` + `vitest` already in devDeps. No package legitimacy audit required.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/AsideBubble.tsx`
- FOUND: `src/ui/features/pretty-view/AsideBubble.test.tsx`
- FOUND: `src/ui/features/pretty-view/ComposeBox.aside-props.test.tsx`
- FOUND: `src/ui/features/pretty-view/PrettyView.aside.test.tsx`
- FOUND: `src/ui/features/pretty-view/PrettyView.tsx` (modified — verified via grep for AsideBubble import, asideText, setAsideText, aside_ready, aside_dismissed, aside_arm, <AsideBubble, asideActive, onAsideDismiss, handleAsideDismiss, prevIsIdleRef, transition guard)
- FOUND: `src/ui/features/pretty-view/ComposeBox.tsx` (modified — verified via grep for asideActive?: and onAsideDismiss?: plus three negative-greps confirming body untouched)
- FOUND commit `8c266a5` — test(14-03): add failing RED-gate tests for AsideBubble component
- FOUND commit `01d9350` — feat(14-03): add AsideBubble component with locked identity-hue + neon-glow aesthetic
- FOUND commit `88eaf0e` — test(14-03): add failing RED-gate type-shape test for ComposeBoxProps aside fields
- FOUND commit `e9b0790` — feat(14-03): extend ComposeBoxProps with asideActive + onAsideDismiss (interface-only)
- FOUND commit `322e67f` — test(14-03): add failing RED-gate tests for PrettyView aside subsystem wiring
- FOUND commit `8640804` — feat(14-03): wire PrettyView aside subsystem — state + WS handlers + arm-emitter + AsideBubble mount

## TDD Gate Compliance

Plan Task 1 (`tdd="true"`): RED (`8c266a5`) → GREEN (`01d9350`) — sequence correct.
Plan Task 2 (`tdd="true"`): RED (`88eaf0e`) → GREEN (`e9b0790`) — sequence correct.
Plan Task 3 (`tdd="true"`): RED (`322e67f`) → GREEN (`8640804`) — sequence correct.

No REFACTOR commits — implementation was clean on first pass; no cleanup needed.

---
*Phase: 14-plain-language-translation-asides*
*Completed: 2026-07-26*
