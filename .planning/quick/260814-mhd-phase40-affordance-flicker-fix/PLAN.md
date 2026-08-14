---
phase: 260814-mhd-phase40-affordance-flicker-fix
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/EditableFileAffordance.tsx
  - src/ui/features/pretty-view/EditableFileAffordance.test.tsx
  - src/ui/hooks/use-is-touch-device.ts
  - src/ui/features/pretty-view/ChatMessage.tsx
  - src/ui/features/pretty-view/use-editable-file-eligibility.ts
autonomous: true
requirements:
  - QUICK-BUG-A  # spec-violating "Edit" text label on pencil affordance
  - QUICK-BUG-B  # useIsTouchDevice first-render flash from undefined initial state
  - QUICK-BUG-C  # ReactMarkdown remount storm (inline components + Set identity churn)
user_setup: []

must_haves:
  truths:
    - "Ashley sees a bare pencil icon (no 'Edit' text) next to eligible file links on desktop."
    - "The pencil affordance no longer flips between 'pencil icon' and the word 'Edit' during hover — because the 'Edit' text no longer exists."
    - "Message bubble text below a file link does not jitter after the affordance mounts."
    - "`npx vitest run` is green after EACH of the three commits (no red intermediate state)."
    - "Three atomic commits land on `feat/tab-title-from-tmux` in the specified order."
  artifacts:
    - path: "src/ui/features/pretty-view/EditableFileAffordance.tsx"
      provides: "Pencil affordance component with 'Edit' text label removed (bare icon per UI-SPEC L124)."
      contains: "<Pencil size={16} />"
    - path: "src/ui/hooks/use-is-touch-device.ts"
      provides: "useIsTouchDevice hook with synchronous matchMedia initial-state read (no undefined flash)."
      contains: "window.matchMedia(TOUCH_QUERY).matches"
    - path: "src/ui/features/pretty-view/ChatMessage.tsx"
      provides: "Chat renderer with memoized ReactMarkdown components object to prevent remount churn."
      contains: "useMemo"
    - path: "src/ui/features/pretty-view/use-editable-file-eligibility.ts"
      provides: "Eligibility hook with identity-stable Set updates when contents are unchanged."
      contains: "prev.size === eligible.size"
  key_links:
    - from: "src/ui/features/pretty-view/EditableFileAffordance.tsx"
      to: "src/ui/hooks/use-is-touch-device.ts"
      via: "useIsTouchDevice() call at line 44"
      pattern: "useIsTouchDevice\\(\\)"
    - from: "src/ui/features/pretty-view/ChatMessage.tsx"
      to: "src/ui/features/pretty-view/EditableFileAffordance.tsx"
      via: "ReactMarkdown `a` component override renders <EditableFileAffordance> as fragment sibling"
      pattern: "EditableFileAffordance"
    - from: "src/ui/features/pretty-view/ChatMessage.tsx"
      to: "src/ui/features/pretty-view/use-editable-file-eligibility.ts"
      via: "useEditableFileEligibility(eventId ?? null, content) at line 83; returned Set consumed by the memoized `a` override at line 433 via `eligibleUrls.has(href)`"
      pattern: "useEditableFileEligibility"
---

<objective>
Fix Phase 40 pencil-affordance flicker and message-text jitter reported by Ashley:
"pencil button kind of spazzing out and flipping between the pencil icon and the
word edit" — with message-bubble text below jittering until scroll.

Three independent bugs compound to produce the symptom. Fix all three as three
atomic, independently-shippable commits. Diagnosis is pre-locked by the
orchestrator; this plan is scope-execution only, no re-diagnosis.

- BUG A: `EditableFileAffordance.tsx` renders a stray "Edit" span next to the
  pencil icon on desktop (spec violation — UI-SPEC L124 + Phase 13 SHAPE-03
  idiom + the component's own docstring all say bare-icon-only). This is what
  Ashley literally sees flip.
- BUG B: `useIsTouchDevice` initializes to `undefined` and returns `!!undefined
  === false`, so every consumer renders one frame as "desktop" before the
  useEffect fires. The pencil affordance renders "Edit" text for a frame, then
  loses it when the hook corrects — hence the "flipping."
- BUG C: A remount storm makes BUG B's one-frame flash happen repeatedly. Two
  sub-fixes in one commit:
  - C1: `ChatMessage.tsx` passes a new inline `components` object literal to
    `<ReactMarkdown>` every render → child overrides may remount → affordance
    (and hence useIsTouchDevice) re-initializes.
  - C2: `use-editable-file-eligibility.ts` calls `setEligibleUrls(new Set(...))`
    every effect run with a fresh Set identity even when contents are identical
    → forces re-render → parent re-render → cascade.

Purpose: eliminate Ashley-visible flicker/jitter without touching upstream
Skynet paths, without introducing dependencies, and without leaving the vitest
suite red at any commit boundary.

Output: three commits on `feat/tab-title-from-tmux` (HEAD `224b2d57`), each
independently visible, each passing full `npx vitest run`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ui/features/pretty-view/EditableFileAffordance.tsx
@src/ui/features/pretty-view/EditableFileAffordance.test.tsx
@src/ui/hooks/use-is-touch-device.ts
@src/ui/features/pretty-view/ChatMessage.tsx
@src/ui/features/pretty-view/use-editable-file-eligibility.ts
</context>

<constraints>
Hard constraints (from fleet directive + orchestrator scope):
- Working tree: `/home/ubuntu/skynet-tiffany`, branch `feat/tab-title-from-tmux`.
- HEAD at start MUST be `224b2d57` (verify with `git rev-parse HEAD`).
- After EACH commit: full `npx vitest run` MUST exit 0. Fleet rule — never leave the suite red. If a test fails, fix it or roll back that commit — never defer.
- No new npm dependencies (do NOT edit `package.json` / `package-lock.json`).
- Fork-local only — every file touched lives under `src/ui/features/pretty-view/` or `src/ui/hooks/`. Do NOT touch upstream Skynet paths.
- Do NOT use git worktrees (fleet rule).
- Executor scope stops at "code done, tests green, 3 commits landed."
  - Do NOT `git push`.
  - Do NOT `docker build` or `docker compose up`.
  - Do NOT edit `skynet-patches.md`.
  - The deploy motion is orchestrator (Tiffany) scope.
- Commits must land in the specified order (A → B → C). Each commit message must match the verbatim message in the task's `<action>` block.
</constraints>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1 (Commit 1 of 3): Drop stray "Edit" text label from pencil affordance</name>
  <files>src/ui/features/pretty-view/EditableFileAffordance.tsx, src/ui/features/pretty-view/EditableFileAffordance.test.tsx</files>
  <behavior>
    Post-fix behavior (verifiable in test suite):
    - Desktop render (useIsTouchDevice=false): `getByRole("button").textContent` does NOT contain "Edit" as visible text. `aria-label` and `title` are still "Edit {filename}" (accessibility unchanged; those are attributes, not textContent).
    - Mobile render (useIsTouchDevice=true): unchanged — already icon-only.
    - The `<Pencil size={16} />` icon is the only child of the <button>.
    - No `<span>` element inside the button.
  </behavior>
  <action>
    Fixes BUG A (spec-violating "Edit" text label). Per UI-SPEC L124, Phase 13 SHAPE-03 "bare-icon-with-hue-drop-shadow" idiom, and the component's own docstring lines 13-17: pencil affordance is BARE ICON ONLY on both desktop and mobile.

    Step 1 — Edit `src/ui/features/pretty-view/EditableFileAffordance.tsx`:
    - Delete line 87 (verbatim): `{!isTouchDevice && <span className="text-[11px]">Edit</span>}`
    - The `<Pencil size={16} />` at line 86 becomes the sole child of `<button>`.
    - Do NOT change `aria-label` or `title` — screen-reader accessibility is preserved via those attributes (they read "Edit {filename}" verbatim per test 2). The visible text is the only thing removed.
    - Do NOT change the mobile/desktop className branching — the desktop hover-reveal via `[.pv-bubble:hover_&]:opacity-100` still applies to the icon-only button.

    Step 2 — Update `src/ui/features/pretty-view/EditableFileAffordance.test.tsx` (locks in the spec violation as-of pre-fix):
    - Test 5 title (line 70): change `"test 5: desktop (useIsTouchDevice=false) → icon + 'Edit' label + opacity-0 rest"` to `"test 5: desktop (useIsTouchDevice=false) → icon-only + opacity-0 rest"`.
    - Test 5 body assertion at line 75: change `expect(btn.textContent).toContain("Edit");` to `expect(btn.textContent).not.toContain("Edit");` — mirroring the mobile test's assertion at line 63. Update the surrounding comment on line 74 (`// Label text visible in DOM...`) to describe icon-only per UI-SPEC L124.
    - Leave `expect(btn.className).toContain("opacity-0")` at line 79 intact — the opacity-0 rest state is unrelated to label removal.
    - Leave tests 1, 2, 3, 4, 6, 7 unchanged. Tests 2 and 3 confirm aria-label/title/onClick still work; test 6 confirms the root is still `<button>`.

    Step 3 — Run full suite: `cd /home/ubuntu/skynet-tiffany && npx vitest run`. Must exit 0.

    Step 4 — Commit:
    ```
    git add src/ui/features/pretty-view/EditableFileAffordance.tsx \
            src/ui/features/pretty-view/EditableFileAffordance.test.tsx
    git commit -m 'fix(40-followup): drop stray "Edit" text label from pencil affordance — spec violation'
    ```
    No Co-Authored-By trailer needed for these commits (matches existing Phase 40 commit style — see HEAD log).
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany && npx vitest run src/ui/features/pretty-view/EditableFileAffordance.test.tsx</automated>
    Also verify globally: `cd /home/ubuntu/skynet-tiffany && npx vitest run` exits 0.

    Grep gates (post-edit):
    - `grep -v '^\s*\*\|^\s*//' src/ui/features/pretty-view/EditableFileAffordance.tsx | grep -c '<span'` → MUST equal 0 (no span in non-comment lines).
    - `grep -v '^\s*\*\|^\s*//' src/ui/features/pretty-view/EditableFileAffordance.tsx | grep -c 'Pencil size={16}'` → MUST equal 1.
    - `git log -1 --format=%s` → MUST equal `fix(40-followup): drop stray "Edit" text label from pencil affordance — spec violation`.
  </verify>
  <done>
    - `EditableFileAffordance.tsx` renders only `<Pencil size={16} />` inside the button (no span).
    - `EditableFileAffordance.test.tsx` test 5 asserts `textContent` does NOT contain "Edit".
    - `npx vitest run` (full suite) exits 0.
    - One commit landed with the exact message above.
    - Working tree clean after commit.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2 (Commit 2 of 3): Read matchMedia synchronously in useIsTouchDevice</name>
  <files>src/ui/hooks/use-is-touch-device.ts</files>
  <behavior>
    Post-fix behavior (verifiable):
    - Return type is `boolean` (was `boolean | undefined` internally, coerced with `!!` at the return). First render returns the actual `matchMedia("(pointer: coarse) and (hover: none)").matches` value, not `false`-from-undefined.
    - The `change` event listener still fires for viewport switches (tablet dock/undock, detachable-keyboard laptops).
    - Return type of the hook is unchanged for callers (`boolean`) — no caller migration needed.
    - SSR guard included (`typeof window === "undefined"`) even though skynet-tiffany is SPA-only, to match React 18 conventions and future-proof against any hypothetical SSR test harness.
  </behavior>
  <action>
    Fixes BUG B (first-render flash from `undefined` initial state).

    Step 1 — Fleet-wide caller audit (already done by planner):
    - 20 callers grep-confirmed across `AppShell.tsx`, `PrettyView.tsx`, `EditableFileAffordance.tsx`, and test mocks.
    - All call sites use the return value as a plain `boolean` (e.g. `const isTouchDevice = useIsTouchDevice();` then `isTouchDevice ? mobileClasses : desktopClasses`). No caller checks for `undefined`. Confirmed: no caller migration needed. The hook's post-fix return type (`boolean`, unwrapped) is drop-in compatible.
    - Test mocks all use `vi.fn(() => false)` — unchanged by this fix.

    Step 2 — Replace `src/ui/hooks/use-is-touch-device.ts` file contents. Keep the module-scope `TOUCH_QUERY` constant and the leading comment block verbatim. Replace only the `useIsTouchDevice` function body:

    ```typescript
    export function useIsTouchDevice(): boolean {
      const [isTouchDevice, setIsTouchDevice] = React.useState<boolean>(() => {
        if (typeof window === "undefined") return false;  // SSR safety, even though skynet is SPA-only
        return window.matchMedia(TOUCH_QUERY).matches;
      });

      React.useEffect(() => {
        const mql = window.matchMedia(TOUCH_QUERY);
        const onChange = () => setIsTouchDevice(mql.matches);
        mql.addEventListener("change", onChange);
        // Re-sync on mount in case matchMedia state changed between the lazy
        // initializer and effect commit (rare — viewport rotation during React
        // commit — but cheap).
        setIsTouchDevice(mql.matches);
        return () => mql.removeEventListener("change", onChange);
      }, []);

      return isTouchDevice;
    }
    ```

    Notes:
    - Return statement drops the `!!` coercion — state is now typed as `boolean`, no coercion needed.
    - Explicit `: boolean` return annotation added (was inferred).
    - `useEffect` retained for `change` events (dock/undock/rotate) — this is not dead code.
    - Lazy state initializer runs exactly once per component-mount (React guarantees) — no perf concern.

    Step 3 — Run full suite: `cd /home/ubuntu/skynet-tiffany && npx vitest run`. Must exit 0. If any hook-specific test asserts an initial `false` value before effect fires (planner confirmed none exist — only `use-mobile.test.ts` and `use-service-worker.test.ts` in `src/ui/hooks/`), update it. If any consumer test asserts an ephemeral "desktop-first" render frame, update it — planner confirmed all consumer tests mock the hook, so this is not expected.

    Step 4 — Commit:
    ```
    git add src/ui/hooks/use-is-touch-device.ts
    git commit -m 'fix(hooks): read matchMedia synchronously in useIsTouchDevice — eliminates first-render flash'
    ```
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany && npx vitest run</automated>

    Grep gates (post-edit):
    - `grep -c 'useState<boolean | undefined>' src/ui/hooks/use-is-touch-device.ts` → MUST equal 0.
    - `grep -c 'window.matchMedia(TOUCH_QUERY).matches' src/ui/hooks/use-is-touch-device.ts` → MUST equal 2 (once in lazy init, once in useEffect re-sync).
    - `grep -c 'return !!isTouchDevice' src/ui/hooks/use-is-touch-device.ts` → MUST equal 0 (coercion removed).
    - `git log -1 --format=%s` → MUST equal `fix(hooks): read matchMedia synchronously in useIsTouchDevice — eliminates first-render flash`.
  </verify>
  <done>
    - `use-is-touch-device.ts` initializes state via lazy initializer calling `window.matchMedia(TOUCH_QUERY).matches` synchronously.
    - `useEffect` retained for `change` event listener.
    - No caller migration needed (all 20 sites use return value as boolean).
    - `npx vitest run` exits 0.
    - One commit landed with the exact message above.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3 (Commit 3 of 3): Memoize ReactMarkdown components + dedupe eligibility Set</name>
  <files>src/ui/features/pretty-view/ChatMessage.tsx, src/ui/features/pretty-view/use-editable-file-eligibility.ts</files>
  <behavior>
    Post-fix behavior (verifiable):
    - C1: `ChatMessage` re-renders where `eventId`, `onOpenEditor`, `eligibleUrls`, and `content` are all reference-equal produce a reference-equal `components` object passed to `<ReactMarkdown>`. This stops the remount storm affecting `<EditableFileAffordance>` children.
    - C2: `useEditableFileEligibility` returns a reference-equal `Set<string>` when a re-run produces identical URL contents. Consumers memoized on `eligibleUrls` identity (like C1's new useMemo) skip work.
    - Zero behavioral change to the affordance's semantic output: same links become editable, same aria-labels, same click handlers.
    - No test rewrites required beyond any incidental snapshot updates (the eligibility hook already asserts "single setState per effect run" in its docstring at line 124 — that invariant is strengthened by C2, not violated).
  </behavior>
  <action>
    Fixes BUG C (remount storm). Two coordinated fixes in one commit, since neither alone fully stops the cascade and they share the same Ashley-visible symptom.

    ═══════════════════════════════════════════════════
    C1 — Memoize ReactMarkdown `components` object
    ═══════════════════════════════════════════════════

    File: `src/ui/features/pretty-view/ChatMessage.tsx`

    Verified closure analysis (planner read lines 400-490):
    - `a` override closes over: `eventId`, `onOpenEditor`, `eligibleUrls`. (Verified via grep — line 426: `if (href && eventId && onOpenEditor)`; line 433: `eligibleUrls.has(href)`; lines 451-453: `eventId!, url: href!, filename` — `href` and `filename` are function-local, not deps.)
    - `p` override closes over: `splitMarkers` (module-scope import from `./commandTags` at line 6 — NOT a dep, module bindings are stable).
    - `pre` override closes over: `CopyableBlock` (module-scope import at line 9 — NOT a dep).
    - `blockquote` override closes over: `CopyableBlock` (same — NOT a dep).

    Therefore the useMemo dep array is exactly: `[eventId, onOpenEditor, eligibleUrls]`.

    Step 1 — Verify `useMemo` is already imported in `ChatMessage.tsx`. If not, add it to the existing React import at line 1. (Planner did NOT verify this — executor MUST check the existing React import statement and add `useMemo` if missing. Do NOT add a duplicate `import`.)

    Step 2 — Above the `return (...)` JSX (find the render function body — the file uses a component named `ChatMessage`, locate the function and its early hooks/refs section), add a `useMemo` for the markdown components object. Extract the current inline object literal from lines 415-470 (bounded by `components={{` and the closing `}}` before `>`). Structure:

    ```typescript
    const markdownComponents = React.useMemo(() => ({
      // D-03: affordance renders as fragment sibling — anchor semantics
      // (target/rel/click) preserved verbatim per LOCKED additive-not-
      // replacive.
      a: ({ node: _node, ...rest }) => {
        const props = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
        const href = props.href;
        // ... (paste the existing `a` body verbatim from lines 419-460) ...
      },
      p: ({ node, children, ...props }) => (
        <p {...props}>{splitMarkers(children)}</p>
      ),
      pre: ({ node, children, ...props }) => (
        <CopyableBlock as="pre" {...props}>{children}</CopyableBlock>
      ),
      blockquote: ({ node, children, ...props }) => (
        <CopyableBlock as="blockquote" {...props}>{children}</CopyableBlock>
      ),
    }), [eventId, onOpenEditor, eligibleUrls]);
    ```

    Then at the `<ReactMarkdown>` call site (line 413-473), replace `components={{ ... }}` with `components={markdownComponents}`:

    ```typescript
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
    >
      {processedContent}
    </ReactMarkdown>
    ```

    IMPORTANT — verbatim preservation: copy the `a` override body EXACTLY as it currently exists (lines 419-460). Do NOT paraphrase, do NOT reformat, do NOT change any type assertions, do NOT drop the D-03 comment. The Phase 40 D-03 contract is locked in that body.

    Note on `remarkPlugins`: the `[remarkGfm]` array literal is also a new identity per render, but a single-element frozen array of a module import is a MUCH smaller re-render trigger than a components object with function values. Not in scope for this fix. If Ashley-visible symptom persists after this commit, consider a follow-up `remarkPluginsMemo = React.useMemo(() => [remarkGfm], [])` — but do NOT include in this commit (out of scope, and would only re-run the plugin pipeline, not remount React children).

    ═══════════════════════════════════════════════════
    C2 — Dedupe identical Set updates in eligibility hook
    ═══════════════════════════════════════════════════

    File: `src/ui/features/pretty-view/use-editable-file-eligibility.ts`

    Step 3 — Replace line 125 `setEligibleUrls(eligible);` with:

    ```typescript
    setEligibleUrls((prev) => {
      if (prev.size === eligible.size && [...prev].every((u) => eligible.has(u))) {
        return prev;  // identity-stable; React skips re-render
      }
      return eligible;
    });
    ```

    Keep the surrounding comment at line 124 (`// Single setState — do not commit per-URL, to avoid render thrash.`) — the new logic strengthens that contract rather than replacing it. Optionally append `// Identity-stable when contents unchanged (BUG C2 fix) — stops downstream remount storm.` on the following line.

    Correctness note: Set order is not part of contents equality, so `[...prev].every((u) => eligible.has(u))` combined with the `size` check is a complete equality check for a Set<string>. No need for a symmetric second-direction check — equal sizes + one-direction subset = set equality.

    ═══════════════════════════════════════════════════
    Verification + commit
    ═══════════════════════════════════════════════════

    Step 4 — Run full suite: `cd /home/ubuntu/skynet-tiffany && npx vitest run`. Must exit 0.

    If any ChatMessage test asserts specific ReactMarkdown internals (unlikely — most tests mock at a higher level), update to reference the new `markdownComponents` symbol. The refactor is purely mechanical: behavior is preserved.

    If any eligibility test asserts a NEW Set identity on every effect run (planner did not audit `use-editable-file-eligibility.test.ts` — executor should grep for one, and if it exists, adjust to test the new identity-stable behavior explicitly).

    Step 5 — Commit:
    ```
    git add src/ui/features/pretty-view/ChatMessage.tsx \
            src/ui/features/pretty-view/use-editable-file-eligibility.ts
    git commit -m 'fix(40-followup): memoize ReactMarkdown components + dedupe eligibility Set updates — stops affordance remount storm'
    ```
  </action>
  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany && npx vitest run</automated>

    Grep gates (post-edit):
    - `grep -c 'markdownComponents' src/ui/features/pretty-view/ChatMessage.tsx` → MUST be >= 2 (one useMemo assignment, one `components={markdownComponents}` prop).
    - `grep -c 'components={{' src/ui/features/pretty-view/ChatMessage.tsx` → MUST equal 0 (inline object literal removed).
    - `grep -v '^\s*\*\|^\s*//' src/ui/features/pretty-view/use-editable-file-eligibility.ts | grep -c 'setEligibleUrls(eligible)'` → MUST equal 0 (bare call replaced by functional-updater form).
    - `grep -c 'prev.size === eligible.size' src/ui/features/pretty-view/use-editable-file-eligibility.ts` → MUST equal 1.
    - `git log -1 --format=%s` → MUST equal `fix(40-followup): memoize ReactMarkdown components + dedupe eligibility Set updates — stops affordance remount storm`.
    - `git log -3 --format=%s` — verify commit order: A (top-of-log now for commit-3), B, C from most recent to oldest actually reads: commit-3, commit-2, commit-1. So `git log -3 --format=%s` output MUST be:
      1. `fix(40-followup): memoize ReactMarkdown components + dedupe eligibility Set updates — stops affordance remount storm`
      2. `fix(hooks): read matchMedia synchronously in useIsTouchDevice — eliminates first-render flash`
      3. `fix(40-followup): drop stray "Edit" text label from pencil affordance — spec violation`
  </verify>
  <done>
    - `ChatMessage.tsx` defines `markdownComponents = React.useMemo(...)` with deps `[eventId, onOpenEditor, eligibleUrls]` and passes it as `components={markdownComponents}` to `<ReactMarkdown>`.
    - `use-editable-file-eligibility.ts` uses functional-updater form of `setEligibleUrls` with identity-stable early-return on content equality.
    - `npx vitest run` (full suite) exits 0.
    - Third commit landed with exact message above.
    - `git log -3 --format=%s` matches the specified 3-commit sequence.
    - Working tree clean after final commit.
  </done>
</task>

</tasks>

<threat_model>
Security enforcement disabled for this quick-mode plan (bugfix-only, no new trust boundaries, no new inputs, no new external calls). None of the three fixes introduce new attack surface:

- BUG A fix: deletes UI text; smaller attack surface, not larger.
- BUG B fix: hook reads `window.matchMedia` synchronously (already trusted browser API called by the same code path in useEffect).
- BUG C fix: memoization + Set-identity dedup — pure performance/rendering, no data flow change.

No `<threat_model>` STRIDE register required.
</threat_model>

<verification>
Phase-level verification (across all 3 commits):

1. **Full test suite green at every commit boundary.** After each of the three `git commit` operations, `cd /home/ubuntu/skynet-tiffany && npx vitest run` MUST exit 0. If any commit fails this check, the executor MUST NOT proceed to the next task — either fix the failure inline (adjust tests locked to the pre-fix behavior) or roll back that specific commit with `git reset --soft HEAD~1`, fix, and re-commit. Never leave the suite red between commits.

2. **Commit graph matches specification.** After Task 3, `git log --format='%h %s' 224b2d57..HEAD` MUST show exactly three commits in the specified order:
   ```
   <hash3> fix(40-followup): memoize ReactMarkdown components + dedupe eligibility Set updates — stops affordance remount storm
   <hash2> fix(hooks): read matchMedia synchronously in useIsTouchDevice — eliminates first-render flash
   <hash1> fix(40-followup): drop stray "Edit" text label from pencil affordance — spec violation
   ```

3. **File touch inventory matches spec.** `git diff --name-only 224b2d57..HEAD` MUST list exactly (in any order):
   ```
   src/ui/features/pretty-view/EditableFileAffordance.tsx
   src/ui/features/pretty-view/EditableFileAffordance.test.tsx
   src/ui/hooks/use-is-touch-device.ts
   src/ui/features/pretty-view/ChatMessage.tsx
   src/ui/features/pretty-view/use-editable-file-eligibility.ts
   ```
   No other files. In particular: no `package.json`, no `package-lock.json`, no `skynet-patches.md`, no files under upstream Skynet paths.

4. **No new dependencies.** `git diff 224b2d57..HEAD -- package.json package-lock.json` MUST be empty.

5. **Working tree clean.** After Task 3 commit, `git status --porcelain` MUST be empty.

6. **Branch unchanged.** `git branch --show-current` MUST return `feat/tab-title-from-tmux`.
</verification>

<success_criteria>
Executor completes successfully when ALL of the following are true:

- [ ] Three commits landed on `feat/tab-title-from-tmux` in the specified order with the specified verbatim messages.
- [ ] Each commit passes `npx vitest run` (exit 0), independently.
- [ ] Fifth-and-final `npx vitest run` (post-Task-3) exits 0.
- [ ] `git diff --name-only 224b2d57..HEAD` lists only the 5 files enumerated above.
- [ ] `git status --porcelain` empty.
- [ ] No push, no docker build, no `docker compose up`, no `skynet-patches.md` edit performed.
- [ ] Ashley's reproducer: pencil affordance no longer has an "Edit" text label (BUG A visible outcome), no first-render flash (BUG B), no remount cascade under normal message-arrival churn (BUG C).

Deploy motion (patch-entry update + docker build + tailnet deploy) is orchestrator (Tiffany) scope and is EXPLICITLY OUT of executor scope per fleet directive.
</success_criteria>

<output>
This is a quick-mode single-plan job; no phase-directory SUMMARY convention applies. The three commits themselves are the artifact. Executor may leave a terse hand-back note listing the three commit hashes (`git log --format='%h %s' -3`) for the orchestrator to pick up.
</output>
