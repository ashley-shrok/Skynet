---
phase: quick-260727-ejk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
autonomous: true
requirements:
  - ASHLEY-MOBILE-SIZING
must_haves:
  truths:
    - "On mobile viewports (<768px), every ComposeBox button roughly doubles in tap-target size"
    - "On mobile viewports (<768px), the PrettyView scroll-to-bottom button is roughly 4× (112×112) with a size-14 ArrowDown icon"
    - "On desktop viewports (>=768px), sizing is byte-for-byte identical to pre-change (no regressions)"
    - "No JS logic changed, no re-render on resize, no SSR flash — pure CSS media-query variants"
    - "isTouchDevice gate at Row-1 container is preserved (semantic ≠ viewport)"
  artifacts:
    - path: "src/ui/features/pretty-view/ComposeBox.tsx"
      provides: "Mobile max-md: className bumps on retry-upload button, Row-1 container, meter well, reset button + icon, five Row-2 icon-sm buttons, textarea min-height + right padding, Send button padding + inline SVG + X icon"
      contains: "max-md:"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Mobile max-md: className bumps on scroll-to-bottom button and ArrowDown icon"
      contains: "max-md:size-28"
  key_links:
    - from: "src/ui/features/pretty-view/ComposeBox.tsx L1004"
      to: "isTouchDevice gate"
      via: "cn() third argument"
      pattern: "max-md:min-h-16"
    - from: "src/ui/features/pretty-view/ComposeBox.tsx L1429"
      to: "Send button clearance (patch #129)"
      via: "textarea right padding"
      pattern: "max-md:pr-14"
    - from: "src/ui/features/pretty-view/PrettyView.tsx L1179"
      to: "ArrowDown icon size"
      via: "size-4 → size-14 at mobile"
      pattern: "max-md:size-14"
---

<objective>
Ashley finds ComposeBox controls and the PrettyView jump-to-latest button cramped on her mobile viewport. Apply purely-additive Tailwind `max-md:` className variants (viewport <768px, same threshold as `useIsMobile()`) so every ComposeBox button roughly doubles in tap-target size and the scroll-to-bottom button roughly quadruples on mobile — with zero desktop visual changes and zero JS/logic touched.

Purpose: Ashley-requested mobile ergonomics batch. Stacks on top of cdccd4f (this session's earlier ComposeBox amendment) and is held for a single combined deploy after Ashley's UAT greenlight — do NOT deploy inside this task.

Output: ~11-12 className touches across exactly 2 files. No new files, no new imports, no test files, no logic changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/PrettyView.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Apply max-md: mobile-sizing className bumps to ComposeBox + PrettyView scroll-to-bottom</name>
  <files>src/ui/features/pretty-view/ComposeBox.tsx, src/ui/features/pretty-view/PrettyView.tsx</files>
  <action>
Purely additive Tailwind `max-md:` variant bumps — no existing classes removed, no logic changes, no imports touched. All target strings verified unique via grep during planning; line numbers in the task_context drift by a few lines from the actual file but the target substrings are unambiguous. Match on target strings, not on line numbers.

**File 1: `src/ui/features/pretty-view/ComposeBox.tsx`** — 9 className touches:

1. **Retry-upload Button** (`size="xs"`, className `"gap-1 text-xs"`): append `" max-md:h-12 max-md:px-4 [&_svg]:max-md:size-6"` to the className string. Find it by looking for the Button that has `size="xs"` combined with `className="gap-1 text-xs"` in the retry-upload block.

2. **Row-1 container** (currently `<div className={cn("flex items-center gap-2", isTouchDevice ? "min-h-[44px]" : "min-h-8")}>`): add a THIRD argument to cn() — `"max-md:min-h-16"`. Result: `cn("flex items-center gap-2", isTouchDevice ? "min-h-[44px]" : "min-h-8", "max-md:min-h-16")`. Do NOT modify the isTouchDevice ternary.

3. **Meter well** (className string starts `"h-7 w-[var(--meter-width)] rounded-md flex flex-row p-[3px] ..."`): change the leading `h-7` token to `h-7 max-md:h-14`. Leave `w-[var(--meter-width)]` and all other tokens untouched.

4. **Reset button** (cn() className starting `"h-full w-6 rounded-[2px] border-0 flex items-center justify-center p-0 cursor-pointer"`): change `w-6` to `w-6 max-md:w-12`. Keep `h-full` (it inherits from the enlarged meter well).

5. **Reset button inner icon** (`<RotateCcw className="size-3.5" />`): change to `<RotateCcw className="size-3.5 max-md:size-7" />`.

6. **Five Row-2 icon-sm Buttons** (Terminal, Paperclip, ThumbsUp, plan-mode Hourglass, lock/RefreshCw or Square — five `<Button size="icon-sm" ...>` occurrences in the Row-2 block): for EACH of the five, append `" max-md:size-14 [&_svg]:max-md:size-6"` to the button's className (whether it's a plain string or a cn() call — append inside the last string arg of cn(), or concat onto a plain string). Verify count = 5 after edit (grep `max-md:size-14` should return exactly 5 hits in this file).

7. **Textarea min-height**: find the textarea className token `"min-h-8!"` and change to `"min-h-8! max-md:min-h-16!"`.

8. **Textarea right padding (Send clearance, patch #129)**: find the textarea className token `"pr-10"` and change to `"pr-10 max-md:pr-14"`. This token is unique in the textarea's className list — do NOT touch any `pr-10` outside the textarea's className array (grep before/after: expect exactly one `pr-10` → `pr-10 max-md:pr-14` change in this file).

9. **Send button trio** (the `<button>` with className cn() containing `"absolute right-1 bottom-0.5"` and `"p-2"`):
   - In the cn() list, change the `"p-2"` string arg to `"p-2 max-md:p-3"`.
   - On the inline `<svg width="24" height="24" ...>` immediately inside that button, ADD a `className="max-md:w-10 max-md:h-10"` attribute (KEEP the existing `width="24"` and `height="24"` attributes — they act as SSR/no-CSS fallback; the className overrides via Tailwind's higher specificity when mobile viewport applies).
   - On the `<X className="size-6" strokeWidth={2.25} aria-hidden="true" />` inside that same button, change to `<X className="size-6 max-md:size-10" strokeWidth={2.25} aria-hidden="true" />`.

**File 2: `src/ui/features/pretty-view/PrettyView.tsx`** — 2 className touches:

10. **Scroll-to-bottom Button** (`size="icon-sm"` with cn() className containing `"pointer-events-auto rounded-full cursor-pointer"`): append `"max-md:size-28"` as an additional string arg to the cn() call.

11. **ArrowDown icon** (`<ArrowDown className="size-4" />`): change to `<ArrowDown className="size-4 max-md:size-14" />`.

**Explicitly DO NOT touch** (per locked design decisions in task_context):
- Meter well `w-[var(--meter-width)]` — CSS-variable driven
- Meter segment cells wrapper `min-w-[100px] flex-1 h-full` — auto-inherits
- Segment separator `w-px mx-[3px] h-full` — auto-inherits
- Send button positioning `absolute right-1 bottom-0.5` — position stays
- `isTouchDevice` gate itself — semantic signal, not viewport
- Any Row-2 layout/gap/flex classes
- Any code outside the ~11-12 className touches enumerated above
- No new imports, no new state, no new components, no test files

**Batch-deploy rule**: Do NOT run `docker compose up -d --force-recreate skynet` inside this task. This change stacks on cdccd4f and awaits Ashley's combined-batch UAT greenlight before deploy (per the 15-min deadman rollback constraint — one deploy, not two).
  </action>
  <verify>
    <automated>bash -lc 'set -e; cd /home/ubuntu/skynet; \
      # ComposeBox: expect exactly 5 icon-sm bumps + 1 min-h + 1 pr + 1 h-7 + 1 w-6 + 1 h-12 retry + 1 min-h-16 row-1 + 1 p-3 send + 1 w-10 svg + 1 size-10 X + 1 size-7 rotate = 14 max-md hits minimum in ComposeBox
      COMPOSE_HITS=$(grep -c "max-md:" src/ui/features/pretty-view/ComposeBox.tsx); \
      PRETTY_HITS=$(grep -c "max-md:" src/ui/features/pretty-view/PrettyView.tsx); \
      test "$COMPOSE_HITS" -ge 14 || { echo "FAIL: ComposeBox max-md hits=$COMPOSE_HITS, expected >=14"; exit 1; }; \
      test "$PRETTY_HITS" -ge 2 || { echo "FAIL: PrettyView max-md hits=$PRETTY_HITS, expected >=2"; exit 1; }; \
      # Specific token checks
      grep -q "max-md:min-h-16" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing Row-1/textarea max-md:min-h-16"; exit 1; }; \
      grep -q "max-md:h-14" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing meter well max-md:h-14"; exit 1; }; \
      grep -q "max-md:w-12" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing reset button max-md:w-12"; exit 1; }; \
      grep -q "max-md:size-7" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing RotateCcw max-md:size-7"; exit 1; }; \
      test "$(grep -c "max-md:size-14 \[&_svg\]:max-md:size-6" src/ui/features/pretty-view/ComposeBox.tsx)" = "5" || { echo "FAIL: expected exactly 5 Row-2 icon-sm bumps"; exit 1; }; \
      grep -q "max-md:pr-14" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing textarea max-md:pr-14"; exit 1; }; \
      grep -q "max-md:p-3" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing Send button max-md:p-3"; exit 1; }; \
      grep -q "max-md:w-10 max-md:h-10" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing Send inline SVG max-md:w-10 max-md:h-10"; exit 1; }; \
      grep -q "size-6 max-md:size-10" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing X icon max-md:size-10"; exit 1; }; \
      grep -q "max-md:h-12 max-md:px-4" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: missing retry-upload button max-md:h-12 max-md:px-4"; exit 1; }; \
      grep -q "max-md:size-28" src/ui/features/pretty-view/PrettyView.tsx || { echo "FAIL: missing scroll-to-bottom max-md:size-28"; exit 1; }; \
      grep -q "size-4 max-md:size-14" src/ui/features/pretty-view/PrettyView.tsx || { echo "FAIL: missing ArrowDown max-md:size-14"; exit 1; }; \
      # Guard: isTouchDevice gate at Row-1 container is preserved
      grep -q "isTouchDevice ? \"min-h-\[44px\]\" : \"min-h-8\"" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: isTouchDevice ternary at Row-1 container was modified — must stay untouched"; exit 1; }; \
      # Guard: Send button positioning preserved
      grep -q "absolute right-1 bottom-0.5" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: Send button positioning removed"; exit 1; }; \
      # Guard: meter width CSS var preserved
      grep -q "w-\[var(--meter-width)\]" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: meter width CSS var removed"; exit 1; }; \
      # Guard: Send inline SVG width/height fallback preserved
      grep -q "width=\"24\" height=\"24\"" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: Send inline SVG width/height fallback removed"; exit 1; }; \
      # Guard: no new imports (lucide-react import line unchanged)
      grep -q "^import { Hourglass, Paperclip, RefreshCw, RotateCcw, Square, Terminal, ThumbsUp, X } from \"lucide-react\";" src/ui/features/pretty-view/ComposeBox.tsx || { echo "FAIL: ComposeBox lucide-react import line changed — no new imports allowed"; exit 1; }; \
      grep -q "^import { ArrowDown } from \"lucide-react\";" src/ui/features/pretty-view/PrettyView.tsx || { echo "FAIL: PrettyView lucide-react import line changed — no new imports allowed"; exit 1; }; \
      # Typecheck
      npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20; \
      echo "PASS: mobile sizing bumps applied — ComposeBox max-md hits=$COMPOSE_HITS, PrettyView max-md hits=$PRETTY_HITS"'</automated>
    <human-check>Ashley: verify on mobile that (a) every ComposeBox button feels doubled in tap-target size, (b) the jump-to-latest scroll-to-bottom button is ~4× bigger and comfortable to tap, (c) desktop view is byte-for-byte identical (no button size regression), (d) no SSR flash or layout jump on load, (e) textarea Send button has enough right padding that cursor/text doesn't collide with it on mobile.</human-check>
  </verify>
  <done>
    - Exactly 2 files modified: `src/ui/features/pretty-view/ComposeBox.tsx` and `src/ui/features/pretty-view/PrettyView.tsx`
    - ~11-12 additive className changes total (all Tailwind `max-md:` variants)
    - Zero JS/logic changes, zero new imports, zero new files
    - All `grep -q` guards in the automated verify pass
    - `npx tsc --noEmit` clean
    - NOT deployed — stacks with cdccd4f pending Ashley's combined-batch UAT greenlight
  </done>
</task>

</tasks>

<verification>
- Automated grep-based checks (see task verify block) enforce: exact 5 Row-2 button bumps, presence of every enumerated max-md: token, preservation of isTouchDevice gate / Send positioning / meter CSS var / SVG width-height fallback / lucide-react import lines.
- `npx tsc --noEmit` typechecks cleanly.
- No new tests added (JSDOM cannot reliably assert viewport-relative CSS media queries; pure CSS additive changes have no unit-testable behavior surface).
- Human verification (Ashley on mobile) is the definitive UAT signal — deferred to post-deploy alongside cdccd4f.
</verification>

<success_criteria>
- On mobile viewport (<768px): every ComposeBox button is roughly doubled in tap-target size; PrettyView scroll-to-bottom is roughly 4× (112×112) with a size-14 arrow.
- On desktop viewport (>=768px): pixel-identical to pre-change state.
- No SSR flash, no re-render on viewport resize (pure CSS media queries).
- `isTouchDevice` gate at Row-1 container preserved (both signals coexist).
- Change is held (NOT deployed) until Ashley greenlights the combined batch with cdccd4f.
</success_criteria>

<output>
Create `.planning/quick/260727-ejk-mobile-sizing-bumps-for-composebox-butto/260727-ejk-SUMMARY.md` when done, recording:
- Final file paths + line ranges touched (may drift from planning-time line numbers)
- Total count of `max-md:` occurrences added per file
- Confirmation that no imports, logic, or non-className code was changed
- Deploy status: HELD (batched with cdccd4f, awaiting Ashley UAT)
</output>
