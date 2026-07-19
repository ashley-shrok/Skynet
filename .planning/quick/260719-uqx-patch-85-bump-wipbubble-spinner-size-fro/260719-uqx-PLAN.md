---
phase: 260719-uqx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/WipBubble.tsx
autonomous: true
requirements:
  - PATCH-85
must_haves:
  truths:
    - "WipBubble spinner renders at h-7 w-7 (larger than previous h-5 w-5)"
    - "No other classes, attributes, or comments in WipBubble.tsx are modified"
    - "TypeScript compilation succeeds with zero errors"
  artifacts:
    - path: "src/ui/features/pretty-view/WipBubble.tsx"
      provides: "WipBubble component with bumped spinner size"
      contains: "h-7 w-7 animate-spin"
  key_links:
    - from: "src/ui/features/pretty-view/WipBubble.tsx"
      to: "Loader2 className"
      via: "single className string on Loader2 element"
      pattern: "h-7 w-7 animate-spin"
---

<objective>
Patch #85 — bump the Loader2 spinner in `WipBubble.tsx` from `h-5 w-5` to `h-7 w-7`.

Purpose: Make the WIP indicator slightly more visible in PrettyView. The docstring already
explains the semantics (naked spinner = "session is busy"); the size bump is a pure visual
tweak with no semantic change.
Output: Single one-line className edit on line 25 of `src/ui/features/pretty-view/WipBubble.tsx`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/ui/features/pretty-view/WipBubble.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bump WipBubble Loader2 size from h-5 w-5 to h-7 w-7</name>
  <files>src/ui/features/pretty-view/WipBubble.tsx</files>
  <action>Open `src/ui/features/pretty-view/WipBubble.tsx`. On line 25, in the Loader2 `className` string, replace the leading `"h-5 w-5"` with `"h-7 w-7"`. The rest of the className string (`animate-spin motion-reduce:animate-none text-[rgba(150,180,220,0.9)]`) is unchanged. Do not modify the docstring, imports, JSX structure, `role`, or `aria-label`. Do not update the "patch #72 reworked it" comment on line 1 — the docstring is about semantics, not sizing. This is a single-token edit; scope is JUST the size bump per the spec.</action>
  <verify>
    <automated>grep -q 'className="h-7 w-7 animate-spin motion-reduce:animate-none text-\[rgba(150,180,220,0.9)\]"' src/ui/features/pretty-view/WipBubble.tsx && ! grep -q 'h-5 w-5' src/ui/features/pretty-view/WipBubble.tsx && npx tsc --noEmit</automated>
  </verify>
  <done>Line 25 of `WipBubble.tsx` contains `className="h-7 w-7 animate-spin motion-reduce:animate-none text-[rgba(150,180,220,0.9)]"`, the string `h-5 w-5` no longer appears anywhere in the file, and `npx tsc --noEmit` reports 0 errors.</done>
</task>

</tasks>

<verification>
- `grep -n 'h-7 w-7' src/ui/features/pretty-view/WipBubble.tsx` → matches line 25
- `grep -c 'h-5 w-5' src/ui/features/pretty-view/WipBubble.tsx` → `0`
- `npx tsc --noEmit` → exit 0
- File line count remains 29 lines (30 with trailing newline) — no structural changes
</verification>

<success_criteria>
- `WipBubble.tsx` line 25 Loader2 className begins with `h-7 w-7` (not `h-5 w-5`)
- All other lines byte-identical to the pre-change file
- TypeScript compilation clean
- Ready for commit: `chore(pretty-view): bump WipBubble size h-5 → h-7 (patch #85)`
</success_criteria>

<output>
Create `.planning/quick/260719-uqx-patch-85-bump-wipbubble-spinner-size-fro/260719-uqx-SUMMARY.md` when done
</output>
