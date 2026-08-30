---
phase: 260806-lzd
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/terminal/IdentityBadge.tsx
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/terminal/IdentityBadge.test.tsx
autonomous: true
requirements:
  - Q-260806-lzd-01
  - Q-260806-lzd-02
  - Q-260806-lzd-03
  - Q-260806-lzd-04

must_haves:
  truths:
    - "IdentityBadge renders exactly one visual treatment (former `lg`) — no `size` prop remains in the source or in the interface"
    - "IdentityBadge no longer hover-fades in terminal mode; the badge stays visible while the user's pointer is over it"
    - "Tapping/clicking IdentityBadge in the terminal-mode surface (Terminal.tsx line ~3100) opens the identity modal — parity with pretty-view surface"
    - "Long-pressing IdentityBadge (~500ms pointerdown timer) toggles pretty-view mode on BOTH the terminal-surface badge and the pretty-view-surface badge, via the same togglePrettyMode() path Ctrl+Shift+O uses"
    - "Pointermove / pointerup / pointercancel before the 500ms threshold cancels the long-press timer and does NOT toggle pretty-view (tap-vs-longpress disambiguation)"
    - "A tap that ended BEFORE the 500ms threshold fires onClick (opens modal), but a completed long-press does NOT also fire onClick"
    - "Ctrl+Shift+O keyboard shortcut on desktop still toggles pretty-view (AppShell.tsx path untouched)"
    - "Unit tests cover: (a) long-press fires onLongPress after 500ms; (b) pointermove cancels; (c) pointerup before 500ms cancels + fires onClick; (d) pointercancel cancels; (e) completed long-press suppresses the subsequent onClick"
  artifacts:
    - path: "src/ui/features/terminal/IdentityBadge.tsx"
      provides: "Single-size IdentityBadge component with onClick + onLongPress props"
      contains: "onLongPress"
    - path: "src/ui/features/terminal/IdentityBadge.test.tsx"
      provides: "Unit tests for long-press timer, cancellation, tap-vs-longpress"
      contains: "fireEvent.pointerDown"
  key_links:
    - from: "src/ui/features/terminal/Terminal.tsx"
      to: "src/ui/features/terminal/IdentityBadge.tsx"
      via: "terminal-surface badge — onClick opens identity modal, onLongPress calls setIsPrettyMode(v => !v)"
      pattern: "<IdentityBadge[\\s\\S]*?onLongPress"
    - from: "src/ui/features/pretty-view/PrettyView.tsx"
      to: "src/ui/features/terminal/IdentityBadge.tsx"
      via: "pretty-view-surface badge — onClick opens identity modal (existing), onLongPress calls onTogglePrettyMode prop"
      pattern: "<IdentityBadge[\\s\\S]*?onLongPress"
    - from: "src/ui/features/terminal/Terminal.tsx"
      to: "src/ui/features/pretty-view/PrettyView.tsx"
      via: "Terminal passes onTogglePrettyMode={() => setIsPrettyMode(v => !v)} to PrettyView so pretty-view badge can toggle back"
      pattern: "onTogglePrettyMode"
---

<objective>
Consolidate `IdentityBadge` to a single size treatment (the former `lg` — glass/breathe/56px avatar), drop the `md` branch and the `size` prop entirely, remove the patch #38 hover-opacity-fade behavior everywhere, and add an `onLongPress` prop (~500ms `pointerdown` timer, cancel on `pointermove` / `pointerup` / `pointercancel`) that both call sites wire to `togglePrettyMode()` — the same imperative-handle path AppShell's Ctrl+Shift+O invokes. Extend the existing tap-to-open-identity-modal behavior (currently pretty-view only) to the terminal-mode call site so tap behavior is uniform across both surfaces.

Purpose: Ashley wants one identity badge treatment across terminal + pretty-view (the "lg" glass one), no fade-on-hover (it hides the affordance), and a tap-and-hold gesture that works on both surfaces to toggle pretty-view — because Ctrl+Shift+O doesn't exist on mobile / gamepad, and the badge is already the identity affordance she reaches for. Preserves the desktop keyboard shortcut path.

Output: Single-variant `IdentityBadge` component with `onLongPress` primitive, both terminal-mode + pretty-view-mode call sites wired for tap-to-open-modal + long-press-to-toggle, unit tests defending the timer/cancellation/disambiguation contract, all existing tests still passing. Committed on `feat/tab-title-from-tmux`, NOT pushed / NOT built / NOT deployed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

@src/ui/features/terminal/IdentityBadge.tsx
@src/ui/features/terminal/terminal-types.ts

# Ground truth for both call sites — read these EAGERLY, they define the wiring
# (Terminal.tsx is 3300+ lines — use Grep for context beyond the block ranges below)
# - Terminal.tsx line 3100: `{isConnected && identityKey && !isPrettyMode && <IdentityBadge identityKey={identityKey} />}`
# - Terminal.tsx line 874:  `togglePrettyMode: () => { setIsPrettyMode((v) => !v); }` — the imperative-handle path
# - Terminal.tsx line 2999-3005: `{isPrettyMode && ... && <PrettyView ... />}` — where the toggle-callback prop needs to be threaded
# - PrettyView.tsx line 1243-1249: existing `<IdentityBadge size="lg" onClick={...} />` — this is the pretty-view call site
# - PrettyView.tsx line 95-131: `PrettyViewProps` — this is where the new `onTogglePrettyMode` prop gets added
# - AppShell.tsx line 200-204: `useKeyboardTogglePrettyMode` -> `handle?.togglePrettyMode?.()` — reference for what "toggle pretty-view" means. DO NOT modify.
</context>

<truths_verified>
Discovery findings that override the planning-context brief:

1. **RelayInboundBubble.tsx and RelayOutboundBubble.tsx do NOT render IdentityBadge.** RELAYBUB-06 is a locked constraint (see the source-file header comments): "does NOT import IdentityBadge, ChatMessage, ComposeBox (locked)." Grepping `<IdentityBadge` under `src/ui/features/pretty-view/` returns exactly one match: `PrettyView.tsx:1244`. The planning-context's mention of these two files as call sites is incorrect — only PrettyView.tsx (pretty-view surface) and Terminal.tsx (terminal surface) render IdentityBadge. Do NOT modify the Relay bubbles.

2. **No test file currently references `size="md"`** — grep across `src/ui/features/` returns zero hits. The only `size="lg"` reference is `PrettyView.tsx:1246`. `PrettyView.test.tsx` + `PrettyView.aside.test.tsx` mock IdentityBadge as `() => null` (props-ignored), so removing the `size` prop is source-only and does not require test edits in those files. The "update tests referencing `size='md'`" line in the constraints is a no-op — the actual test work is (a) new IdentityBadge unit tests for the long-press timer contract (in a new `IdentityBadge.test.tsx`), and (b) leaving the two pretty-view mock files alone.

3. **The comment block in `src/ui/index.css` (lines 154, 155, 158, 424) that references `IdentityBadge md` / `size=lg`** is comment-only documentation of the retired treatment. The `.pv-identity-breathe` keyframes (index.css:424+) are STILL used by the surviving (former-lg) treatment — do NOT delete them. Optionally update the comment lines to drop the "md" references, but the plan doesn't require it (comments-only, no behavior).
</truths_verified>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Consolidate IdentityBadge to single variant + add onLongPress primitive + unit tests</name>
  <files>
    src/ui/features/terminal/IdentityBadge.tsx
    src/ui/features/terminal/IdentityBadge.test.tsx
  </files>
  <behavior>
    IdentityBadge (single-variant refactor):
      - Props shape becomes `{ identityKey: string | null; onClick?: () => void; onLongPress?: () => void }` — `size` REMOVED, no default value, no branch.
      - Only the former `lg` treatment renders (glass pill, 56px avatar left, name+title right, hue-driven rim/glow, `pv-identity-breathe` 5s animation).
      - When `onClick` is provided, root element is `<button type="button" aria-label="Open identity info" title="Identity info" className="... cursor-pointer">`; when omitted, root element is `<div aria-hidden="true">` (backward-compat, matches existing lg behavior).
      - The patch #38 hover-opacity-fade class (`transition-opacity duration-150 hover:opacity-0`) is GONE — the badge does not fade on hover in any state.
      - When `onLongPress` is provided, pointer handlers are wired on the root element:
        * `onPointerDown(e)`: start a `setTimeout(onLongPress, 500)`, capture the timer id in a ref, set a `longPressFiredRef` = false; on `e.pointerType !== "mouse"` do NOT need special handling (touch/pen/mouse all follow the same timer). Do NOT call `e.preventDefault()` (breaks synthetic click on mobile).
        * `onPointerMove`: if the timer is armed, clear it and mark it cancelled. (Simplest correct rule — any pointer movement while the timer is armed cancels the long-press. Ashley wants deliberate press, not accidental hover-slide.)
        * `onPointerUp`: if the timer is armed (not fired yet), clear it → the subsequent `onClick` (React's synthetic click after pointerup on the button) fires normally = tap.
        * `onPointerCancel`: clear the timer, mark cancelled, do NOT fire onLongPress.
        * On successful timer fire: call `onLongPress()`, set `longPressFiredRef = true`.
        * Suppress the trailing `onClick`: wrap the button's `onClick` in a handler that early-returns if `longPressFiredRef.current === true`, then resets the ref. This prevents "long-press-toggles-pretty-view AND also opens the modal" double-fire.
      - Timer id + longPressFired flag live in `useRef` (survives re-renders without triggering them).
      - When `onLongPress` is NOT provided, pointer handlers are omitted entirely and the button behaves exactly like a plain click target (backward-compat with pretty-view's current behavior if a future caller wants tap-only).

    IdentityBadge.test.tsx (new file — vitest + @testing-library/react):
      - Use fake timers (`vi.useFakeTimers()` in beforeEach, `vi.useRealTimers()` in afterEach) so 500ms is not real wall-clock.
      - Mock `useIdentities` (identities-store) to return a byKey Map with one entry so the badge renders (mirror the pattern already used in this codebase — grep for `vi.mock("@/state/identities-store"` under `src/ui/features/` for a working example).
      - Test A (RED first): "onLongPress fires after 500ms of held pointerdown" — pointerDown, advance 500ms, expect callback called once.
      - Test B: "pointermove before 500ms cancels" — pointerDown, advance 200ms, pointerMove, advance 400ms, expect callback NOT called.
      - Test C: "pointerup before 500ms cancels the long-press AND fires onClick as a tap" — pointerDown, advance 200ms, pointerUp (which in JSDOM synthesizes a click on the button), expect onLongPress NOT called and onClick called once. Note: In JSDOM the click event fires programmatically via `fireEvent.click` after `fireEvent.pointerUp` — verify by dispatching both.
      - Test D: "pointercancel clears the timer" — pointerDown, advance 200ms, pointerCancel, advance 400ms, expect callback NOT called.
      - Test E: "completed long-press suppresses onClick" — pointerDown, advance 500ms (fires onLongPress), then fireEvent.click on the button, expect onClick NOT called.
      - Test F: "hover-fade class is GONE" — render badge, query root by testid (add `data-testid="identity-badge-root"` to the button/div in the source) or by role="button", assert `className` does NOT contain `hover:opacity-0`. This is the anti-regression gate for the patch #38 removal.
      - Test G: "when onClick omitted, root is a non-interactive div with aria-hidden" — smoke test of the backward-compat branch.

    Implementation constraints:
      - Keep the identity-hue math (`identity.colorHue ?? 35`), the inline style blob, the `pv-identity-breathe` animation, the exact border/box-shadow/backdrop-filter values, and the `<img>` avatar block byte-identical to the current lg branch — this is a "delete-md-branch, add-longpress-plumbing" refactor, not a visual redesign.
      - Preserve the `absolute top-4 right-5 z-[101]` positioning (existing lg positioning), which is what Terminal.tsx line 3100 expects when it drops the badge into the terminal-mode surface. NOTE: the old `md` positioning was `absolute top-2 right-2` — this is a deliberate visual change (Ashley wants uniform placement across surfaces).
  </behavior>
  <action>
    Write IdentityBadge.test.tsx FIRST following the behavior block (Tests A-G), run it, confirm it fails (RED). Then refactor IdentityBadge.tsx: strip the `md` branch entirely (lines 130-161 in current source), remove `size` from `IdentityBadgeProps`, add `onLongPress?: () => void` to props, add the useRef-backed pointer-timer logic described above, add a `data-testid="identity-badge-root"` attribute to both the button and div branches (needed by Test F), wrap the button's `onClick` prop to gate on `longPressFiredRef`. Do NOT change any visual class or inline style value from the surviving (former-lg) branch. Run tests — expect all pass (GREEN). Keep the file focused: one component, no shared timer helper hoist.
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx vitest run src/ui/features/terminal/IdentityBadge.test.tsx</automated>
  </verify>
  <done>
    IdentityBadge.tsx has no `size` prop, no `md` branch, no `hover:opacity-0` class. `onLongPress?: () => void` is on `IdentityBadgeProps`. IdentityBadge.test.tsx exists with tests A-G, all pass under `npx vitest run src/ui/features/terminal/IdentityBadge.test.tsx`. `npx tsc --noEmit` shows no errors introduced by this task's file scope (callsites will still have `size="lg"` at this point — that's Task 2's fix, so tsc will fail there; verify by running tsc scoped to the two files with `--project` if convenient, or defer the full tsc pass until end of Task 2).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire tap-to-open-modal + long-press-to-toggle at both IdentityBadge call sites</name>
  <files>
    src/ui/features/terminal/Terminal.tsx
    src/ui/features/pretty-view/PrettyView.tsx
  </files>
  <behavior>
    Terminal.tsx (line ~3100 — terminal-mode surface):
      - Currently: `{isConnected && identityKey && !isPrettyMode && <IdentityBadge identityKey={identityKey} />}`
      - Change to: `{isConnected && identityKey && !isPrettyMode && <IdentityBadge identityKey={identityKey} onClick={() => setIsIdentityModalOpen(true)} onLongPress={() => setIsPrettyMode(v => !v)} />}`
      - Terminal.tsx does NOT currently have an IdentityModal mounted (that lives in PrettyView.tsx only). Task 2 mounts it in Terminal.tsx for the terminal-mode surface — parity with PrettyView. Add:
        * A `const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false)` alongside existing Terminal state.
        * Resolve `identity` and `hue` from the same `useIdentities()` byKey lookup Terminal already uses (Terminal.tsx lines 283-290 have `identityKey` and `sessionHue` — reuse those).
        * Mount `<IdentityModal open={isIdentityModalOpen} onOpenChange={setIsIdentityModalOpen} identity={identity} hue={sessionHue ?? 35} hostId={hostConfig.id} container={... same container element the terminal renders into, or `null` for document.body portal — pick whichever matches how PrettyView.tsx uses it. If the container-portal semantic is non-trivial to replicate, pass `null` (portals to document.body) — the modal is app-modal at z-[500], overlay at z-[110], both above the terminal surface, so root-body portal is behaviorally correct. Ashley explicitly cares about modal reachability from terminal mode, not about a specific portal target.>`
      - Preserve `!isPrettyMode` guard so the terminal-surface badge does not double up with the pretty-view-surface badge.
      - Also preserve the outer `{isConnected && identityKey && !isPrettyMode && ... }` gate (do not lift the modal mount inside that gate — the modal should stay reachable during a pretty-view flip only if we choose; safest is to nest modal under the same gate so it unmounts cleanly when identityKey clears).

    Terminal.tsx (line ~3000 — where PrettyView is mounted):
      - Add a new prop `onTogglePrettyMode` on the existing `<PrettyView ... />` mount: `onTogglePrettyMode={() => setIsPrettyMode(v => !v)}`.

    PrettyView.tsx:
      - PrettyViewProps: add optional `onTogglePrettyMode?: () => void` to the interface (lines 95-131 range), destructure it in the component signature (line 163-173 range).
      - PrettyView badge call site (line ~1244): change `<IdentityBadge identityKey={pvIdentityKey} size="lg" onClick={() => setIsIdentityModalOpen(true)} />` to `<IdentityBadge identityKey={pvIdentityKey} onClick={() => setIsIdentityModalOpen(true)} onLongPress={onTogglePrettyMode} />`. The `size="lg"` prop is removed (no longer exists). `onLongPress={onTogglePrettyMode}` — if the parent didn't pass the prop, onLongPress is undefined and IdentityBadge falls back to no-pointer-handlers behavior (defined in Task 1). Terminal.tsx always passes it, so in practice the pretty-view badge is always long-pressable.

    Ctrl+Shift+O keyboard shortcut (AppShell.tsx line 200-204): DO NOT touch. It still routes through `handle.togglePrettyMode()` which flips the same `isPrettyMode` state Terminal.tsx owns. The long-press just hits `setIsPrettyMode(v => !v)` directly — semantically equivalent.

    Test coverage for wiring:
      - This task's wiring change is exercised end-to-end when running the full vitest suite; specifically the existing `PrettyView.test.tsx` mocks IdentityBadge as `() => null` (props-ignored), so the props-shape change compiles + tests still pass. Terminal.wiring.test.ts covers the imperative handle (`togglePrettyMode` on the ref); that path is untouched.
      - No new integration test is required for Task 2 — the primitive contract (long-press → callback) is unit-tested in Task 1, and the wiring is a compile-time contract (TS enforces prop types).
  </behavior>
  <action>
    Edit Terminal.tsx: add `isIdentityModalOpen` state alongside existing state, resolve `identity` from `identitiesByKey.get(identityKey)` (Terminal already has this map — line 289-290), import `IdentityModal` from `@/features/pretty-view/IdentityModal`, mount `<IdentityModal .../>` inside the `!isPrettyMode && identityKey` render branch near the badge, update line 3100 to add `onClick` + `onLongPress` props on `<IdentityBadge>`, add `onTogglePrettyMode` on the `<PrettyView>` mount at ~line 3000. Edit PrettyView.tsx: add `onTogglePrettyMode?: () => void` to `PrettyViewProps` (in the interface block ~line 95-131), destructure it in the function signature (~line 163-173), remove `size="lg"` and add `onLongPress={onTogglePrettyMode}` on the `<IdentityBadge>` at ~line 1244. Run `npx tsc --noEmit` — expect EXIT 0. Run `npx vitest run` — expect the full suite green (existing 1491 pass baseline + Task 1's new tests, so ~1497-1500 pass depending on how Task 1 test count settles). If any pre-existing test fails, diagnose whether it's a genuine regression or a snapshot that needs regenerating for the visual change (single-variant badge now renders in terminal mode too, previously md — accept snapshot updates ONLY if the diff matches the intended visual change; otherwise fix the code).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run</automated>
  </verify>
  <done>
    `npx tsc --noEmit` EXIT 0. `npx vitest run` shows 0 failures across the full suite; pass count ≥ prior baseline (1491) plus Task 1's new tests. Terminal.tsx line 3100 area renders `<IdentityBadge identityKey={identityKey} onClick={...} onLongPress={...} />` (no `size` prop). PrettyView.tsx line 1244 area renders `<IdentityBadge identityKey={pvIdentityKey} onClick={...} onLongPress={onTogglePrettyMode} />` (no `size` prop). PrettyViewProps has `onTogglePrettyMode?: () => void`. Terminal.tsx mounts `<IdentityModal>` in the terminal-mode surface. All changes committed as one atomic commit (or split into 2 — one per file — if that reads cleaner in the log) on `feat/tab-title-from-tmux`. NOT pushed / NOT built / NOT deployed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user pointer -> IdentityBadge | Untrusted pointer/gesture events cross into React handlers |
| Terminal.tsx state -> PrettyView.tsx | Callback prop (`onTogglePrettyMode`) crosses component boundary |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260806-lzd-01 | Denial-of-Service | IdentityBadge onLongPress timer | mitigate | Timer id stored in `useRef`; cleared on pointermove/pointerup/pointercancel AND on component unmount (add cleanup in useEffect return). Single 500ms timeout per pointerdown — no unbounded queueing. |
| T-260806-lzd-02 | Tampering | Ctrl+Shift+O AppShell path | accept | Not modified. Long-press uses direct setIsPrettyMode(v => !v); AppShell path uses imperative handle. Both flip the same state atom — no divergence risk unless Terminal.tsx's state ownership changes, which is out of scope. |
| T-260806-lzd-03 | Repudiation | Long-press vs tap disambiguation | mitigate | `longPressFiredRef` gate on onClick prevents "long-press ALSO opened the modal" double-action — deterministic single-outcome per gesture. Unit-tested (Test E). |
| T-260806-lzd-04 | Elevation-of-privilege | IdentityBadge onClick handler | accept | onClick just opens a modal that reads identity metadata from a store the user already sees. No new privilege surface. |
| T-260806-lzd-SC | Tampering | package installs | accept | No new packages installed by this plan. All imports (`react`, `@/features/pretty-view/IdentityModal`, `@/state/identities-store`, `@testing-library/react`, `vitest`) already in the tree — grep for existing usages confirms. |
</threat_model>

<verification>
Phase-level verification (run after both tasks complete):

1. **Full test suite green**: `cd /home/ubuntu/skynet-tiffany && npx vitest run` — expect 0 failures, pass count ≥ 1491 (prior baseline) + Task 1's new tests (Tests A-G = ~7 new tests, so target ~1498).
2. **Type check clean**: `npx tsc --noEmit` EXIT 0.
3. **Grep gates**:
   - `grep -n 'size:' src/ui/features/terminal/IdentityBadge.tsx | grep -v '^#' | wc -l` = 0 (no `size` remains in the interface — filter out comment lines).
   - `grep -n 'hover:opacity-0' src/ui/features/terminal/IdentityBadge.tsx | wc -l` = 0.
   - `grep -n 'size="md"' src/ 2>/dev/null | wc -l` = 0 (guard against re-introduction).
   - `grep -n 'size="lg"' src/ 2>/dev/null | wc -l` = 0.
   - `grep -n 'onLongPress' src/ui/features/terminal/IdentityBadge.tsx | wc -l` ≥ 1.
   - `grep -n 'onLongPress' src/ui/features/terminal/Terminal.tsx | wc -l` ≥ 1.
   - `grep -n 'onLongPress' src/ui/features/pretty-view/PrettyView.tsx | wc -l` ≥ 1.
   - `grep -n 'onTogglePrettyMode' src/ui/features/pretty-view/PrettyView.tsx | wc -l` ≥ 2 (interface + destructure).
4. **Build not required** (constraint: NO docker build / NO deploy). If a developer sanity-check is desired, `npm run build` may be run locally but is not a gate for this plan.
</verification>

<success_criteria>
- [ ] `size` prop and `md` branch are gone from IdentityBadge.tsx (grep gates in verification block pass).
- [ ] `hover:opacity-0` class is gone from IdentityBadge.tsx (grep gate passes).
- [ ] `onLongPress?: () => void` is added to `IdentityBadgeProps` and wired to a 500ms `pointerdown` timer with pointermove/pointerup/pointercancel cancellation, plus a `longPressFiredRef` gate that suppresses onClick after a completed long-press.
- [ ] Terminal.tsx line ~3100 badge passes `onClick={() => setIsIdentityModalOpen(true)}` and `onLongPress={() => setIsPrettyMode(v => !v)}`. `<IdentityModal>` is mounted in the terminal-mode surface with matching state.
- [ ] PrettyView.tsx line ~1244 badge passes `onLongPress={onTogglePrettyMode}` and no longer passes `size="lg"`. `PrettyViewProps` has `onTogglePrettyMode?: () => void`.
- [ ] Terminal.tsx passes `onTogglePrettyMode={() => setIsPrettyMode(v => !v)}` to `<PrettyView>`.
- [ ] AppShell.tsx (Ctrl+Shift+O path) is untouched.
- [ ] Relay bubble files are untouched (RELAYBUB-06 locked constraint honored — see `<truths_verified>` block).
- [ ] IdentityBadge.test.tsx exists with Tests A-G, all pass.
- [ ] `npx tsc --noEmit` EXIT 0 and `npx vitest run` shows 0 failures.
- [ ] All changes committed on `feat/tab-title-from-tmux` in ≤3 atomic commits (Task 1 = 1 commit for IdentityBadge refactor + tests; Task 2 = 1 or 2 commits for the two call-site files).
- [ ] NOT pushed / NOT docker built / NOT docker cp'd / NOT deployed. Plan ends at "committed on branch, local tests green" per fleet constraint.
</success_criteria>

<output>
Create `.planning/quick/260806-lzd-consolidate-identitybadge-to-a-single-si/260806-lzd-SUMMARY.md` when done.
</output>
