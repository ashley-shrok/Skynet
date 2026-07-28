---
phase: quick-260728-gdy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/index.css
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/ComposeBox.tsx
  - src/ui/features/pretty-view/MicButton.tsx
  - src/ui/features/pretty-view/RecordingControls.tsx
  - src/ui/features/pretty-view/ChatMessage.tsx
  - /home/ubuntu/.claude/identities/tina/skynet-patches.md
autonomous: true
requirements: [PATCH-163]
---

<objective>
Skynet patch #163 — mobile font & chrome sizing strategy pivot. Replace patch #162's
per-surface `.prose-sm` override with a single global `html { font-size: 24px; }` mobile
bump, strip 27 pre-emptive `max-md:*` chrome overrides in pretty-view (they were
compensation for html=16 and become oversized at html=24), and add two defensive
overflow guards (`overflow-x-hidden` on the message scroll container and
`[overflow-wrap:anywhere]` on message bubbles). Ship in a single turn including
skynet-patches.md documentation.

Purpose: post-#162 UAT — bubbles are right size but everything else on mobile is too
small and composebox/jump-to-bottom feel too big. Ashley's design pivot: one global
html lever instead of patchwork per-surface overrides. Math: `.prose-sm` = 0.875rem ×
24px = 21px (Telegram parity, same as #162's override, no override needed).

Output: 6 modified source files, 1 patches doc appended, clean tsc + backend build +
test suite (baseline: 62 files, 715 passed, 6 skipped).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/ui/index.css
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/ComposeBox.tsx
@src/ui/features/pretty-view/MicButton.tsx
@src/ui/features/pretty-view/RecordingControls.tsx
@src/ui/features/pretty-view/ChatMessage.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Apply all six source edits for patch #163</name>
  <files>
    src/ui/index.css,
    src/ui/features/pretty-view/PrettyView.tsx,
    src/ui/features/pretty-view/ComposeBox.tsx,
    src/ui/features/pretty-view/MicButton.tsx,
    src/ui/features/pretty-view/RecordingControls.tsx,
    src/ui/features/pretty-view/ChatMessage.tsx
  </files>
  <action>
Execute the exact line-level edits below verbatim. Do NOT invent alternate approaches.
Read each file first to lock down current line contents before editing (line numbers in
the brief are approximate — locate by string match, not line number).

(1) src/ui/index.css — rewrite the #162 media query block:
    - Locate the existing `@media (max-width: 768px) { .prose-sm { font-size: 1.3125rem !important; line-height: 1.55 !important; } }` block (sits between `.fs-xl` and the `@supports (padding-bottom: env(safe-area-inset-bottom))` block, preceded by a comment).
    - Replace the `.prose-sm` rule inside the media query with `html { font-size: 24px; }` (no `!important` needed — no competing rule).
    - Rewrite the preceding comment (5-8 lines) to explain: patch #163 supersedes #162; global html-font-size lever + strip mobile chrome overrides is the "no patchwork" approach; `.prose-sm` naturally lands at 21px (0.875rem × 24) via cascade so #162's override is redundant; chrome overrides in pretty-view are stripped in this patch.

(2) src/ui/features/pretty-view/PrettyView.tsx — three edits:
    - Jump-to-bottom Button className list (~L1223): remove the literal `"max-md:size-28",` entry; preserve every other class (border, backgrounds, hover states) verbatim.
    - Jump-to-bottom icon (~L1226): `<ArrowDown className="size-4 max-md:size-14" />` → `<ArrowDown className="size-4" />`.
    - Message-list scroll container (~L1151): `className="flex-1 min-h-0 overflow-y-auto px-4 py-3"` → `className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3"` (defensive: guarantees no horizontal scroll regardless of content).

(3) src/ui/features/pretty-view/ComposeBox.tsx — strip every max-md:* chrome override:
    - ~L1074: `"gap-1 text-xs max-md:h-12 max-md:px-4 [&_svg]:max-md:size-6"` → `"gap-1 text-xs"`.
    - ~L1103: inside the cn() drop the trailing `"max-md:min-h-16"` string arg; preserve the rest of the cn() call verbatim.
    - ~L1118: `"h-7 max-md:h-14 w-[var(--meter-width)] ..."` → drop `max-md:h-14`, preserve rest verbatim.
    - ~L1142: `"h-full w-6 max-md:w-12 rounded-[2px] ..."` → drop `max-md:w-12`, preserve rest verbatim.
    - ~L1163: `<RotateCcw className="size-3.5 max-md:size-7" />` → `<RotateCcw className="size-3.5" />`.
    - ~L1303, 1334, 1364, 1394, 1421, 1471: six action-button className entries — each has `"max-md:size-14 [&_svg]:max-md:size-6",` on its own line inside a cn(...) list — remove those six lines entirely including trailing comma.
    - ~L1528: `"min-h-8! max-md:min-h-16!"` → `"min-h-8!"` (keep the `!` — load-bearing per patch #81 shadcn cascade).
    - ~L1560: `"pr-10 max-md:pr-14"` → `"pr-10"`.
    - ~L1664: `"p-2 max-md:p-3"` → `"p-2"`.
    - ~L1686: `<X className="size-6 max-md:size-10" strokeWidth={2.25} aria-hidden="true" />` → `<X className="size-6" strokeWidth={2.25} aria-hidden="true" />`.
    - ~L1699: READ CONTEXT FIRST — className `"max-md:w-10 max-md:h-10"`. If this is a standalone className that would become empty after stripping, remove the whole className prop entirely. If it's inside a cn() with other classes, just drop those two tokens.

(4) src/ui/features/pretty-view/MicButton.tsx:
    - Comment block at top (~L7): update to reflect strip — mention mobile scale is now handled globally via html font-size bump (patch #163), not per-button max-md overrides.
    - ~L35: `"p-2 max-md:p-3"` → `"p-2"`.
    - ~L44: `<Mic className="size-6 max-md:size-10" aria-hidden="true" />` → `<Mic className="size-6" aria-hidden="true" />`.

(5) src/ui/features/pretty-view/RecordingControls.tsx:
    - ~L45: `"p-2 max-md:p-3 text-[hsla(0,72%,72%,0.85)] ..."` → drop `max-md:p-3`, preserve rest verbatim.
    - ~L47: `<X className="size-6 max-md:size-10" ...>` → drop `max-md:size-10`; preserve strokeWidth, aria-hidden, etc.
    - ~L56: same `max-md:p-3` strip.
    - ~L58: same `max-md:size-10` strip on `<ArrowDownToLine>`.
    - ~L67: same `max-md:p-3` strip.
    - ~L69: same `max-md:size-10` strip on `<Send>`.

(6) src/ui/features/pretty-view/ChatMessage.tsx:
    - ~L84: `"max-w-[85%] break-words text-sm leading-relaxed"` → `"max-w-[85%] [overflow-wrap:anywhere] text-sm leading-relaxed"` (replaces `break-words` with `[overflow-wrap:anywhere]` — critical at 21px where long unbroken tokens like URLs/hashes/identifiers exceed 85vw more often and must break inside the bubble instead of forcing horizontal overflow).

Do NOT touch any other lines, files, or classes. Every non-max-md class stays as-is.
Preserve indentation, trailing commas on adjacent lines, and formatter conventions.
  </action>
  <verify>
    <automated>grep -rn "max-md:" src/ui/features/pretty-view/PrettyView.tsx src/ui/features/pretty-view/ComposeBox.tsx src/ui/features/pretty-view/MicButton.tsx src/ui/features/pretty-view/RecordingControls.tsx src/ui/features/pretty-view/ChatMessage.tsx | grep -v '^#' | wc -l | xargs -I{} test {} = 0 && grep -n "font-size: 24px" src/ui/index.css && grep -n "overflow-x-hidden" src/ui/features/pretty-view/PrettyView.tsx && grep -n "\[overflow-wrap:anywhere\]" src/ui/features/pretty-view/ChatMessage.tsx</automated>
  </verify>
  <done>
- src/ui/index.css contains `html { font-size: 24px; }` inside the `@media (max-width: 768px)` block and no `.prose-sm` override there.
- Zero `max-md:*` classes remain in the five pretty-view source files listed above.
- PrettyView.tsx scroll container has `overflow-x-hidden`.
- ChatMessage.tsx bubble className has `[overflow-wrap:anywhere]` in place of `break-words`.
- MicButton.tsx top comment mentions patch #163 / global html font-size lever.
  </done>
</task>

<task type="auto">
  <name>Task 2: Run typecheck, backend build, and full test suite</name>
  <files>(no writes — verification only)</files>
  <action>
Run the three commands below in order and report any non-zero exit. Do not fix errors
by loosening the changes from Task 1 — if a genuine regression appears (e.g., a
className assumption in a test snapshot), report it and stop.

1. `npx tsc --noEmit` — must be clean.
2. `npm run build:backend` — must be clean (cheap insurance per patch #154 lesson;
   frontend-only tsc misses backend errors).
3. `npm test` — expect the #162 baseline: 62 files, 715 passed, 6 skipped, zero
   behavioral deltas (this patch is purely CSS class stripping + one media query
   rewrite + doc changes).
  </action>
  <verify>
    <automated>npx tsc --noEmit && npm run build:backend && npm test</automated>
  </verify>
  <done>
All three commands exit 0. Test-suite totals match #162 baseline (62 files, 715 passed,
6 skipped) — no unexpected failures introduced.
  </done>
</task>

<task type="auto">
  <name>Task 3: Append patch #163 entry to skynet-patches.md and bump patch count</name>
  <files>/home/ubuntu/.claude/identities/tina/skynet-patches.md</files>
  <action>
Read `/home/ubuntu/.claude/identities/tina/skynet-patches.md` first to see current
header language (may say "62", "SIXTY-TWO", or similar) and existing entry conventions.

Then in a single edit pass:

1. Bump the patch count in the header from SIXTY-TWO → SIXTY-THREE (match whatever
   casing/format is currently in use — numeric, spelled-out, or both).

2. Append a new entry for patch #163 following the existing entry format in the file.
   The entry MUST include these sections (adapt section headings to match file
   convention if the existing entries use a different heading style):

   - **Motivation**: post-#162 UAT — message bubbles are right size but the rest of
     mobile app is too small (bounties in identity modal, conversation list rows,
     tasks/shells/BG-agents display) AND composebox action buttons + jump-to-bottom
     button feel too big. Ashley's design pivot: instead of per-surface patchwork,
     do ONE global html font-size bump on mobile (24px, previously confirmed via
     `?fonttune=1` live tuner as Telegram parity) and STRIP the pre-emptive
     `max-md:*` chrome overrides in pretty-view.
   - **Root cause of the shift**: the pre-emptive `max-md:*` chrome overrides
     throughout pretty-view were compensation for html=16px making touch-target
     chrome look too small; at html=24 they become oversized. Removing them lets
     html-scale do the work uniformly.
   - **Fix summary**: html=24 mobile bump (single rule in `@media (max-width: 768px)`)
     + strip 27 `max-md:*` overrides across pretty-view + retire #162's `.prose-sm`
     rule as redundant (0.875rem × 24 = 21px via cascade) + defensive
     `overflow-x-hidden` on the message scroll container + defensive
     `[overflow-wrap:anywhere]` on the message bubble.
   - **Files touched**: src/ui/index.css, src/ui/features/pretty-view/PrettyView.tsx,
     src/ui/features/pretty-view/ComposeBox.tsx,
     src/ui/features/pretty-view/MicButton.tsx,
     src/ui/features/pretty-view/RecordingControls.tsx,
     src/ui/features/pretty-view/ChatMessage.tsx.
   - **Rebase risk**: low — deleting overrides is compatible with any upstream change
     to the same lines.
   - **See also**: patch #162 — this supersedes it (the `.prose-sm` rule from #162 is
     removed as redundant under html=24).
  </action>
  <verify>
    <automated>grep -c "163" /home/ubuntu/.claude/identities/tina/skynet-patches.md | awk '{ if ($1 >= 1) exit 0; else exit 1 }' && grep -Ei "sixty-three|63" /home/ubuntu/.claude/identities/tina/skynet-patches.md | head -3</automated>
  </verify>
  <done>
skynet-patches.md contains a patch #163 entry with all six required sections
(Motivation, Root cause, Fix summary, Files touched, Rebase risk, See also), and the
file header patch count has been bumped from SIXTY-TWO to SIXTY-THREE (matching the
existing casing convention).
  </done>
</task>

</tasks>

<verification>
- No `max-md:*` class remains in the five pretty-view source files.
- `src/ui/index.css` uses `html { font-size: 24px; }` (not `.prose-sm` override) inside
  `@media (max-width: 768px)`.
- `PrettyView.tsx` scroll container has `overflow-x-hidden`.
- `ChatMessage.tsx` bubble uses `[overflow-wrap:anywhere]` instead of `break-words`.
- `npx tsc --noEmit`, `npm run build:backend`, and `npm test` all pass; test suite
  matches #162 baseline (62 files, 715 passed, 6 skipped).
- `~/.claude/identities/tina/skynet-patches.md` has a patch #163 entry and the header
  count is bumped to SIXTY-THREE.
</verification>

<success_criteria>
Patch #163 shipped in a single turn: 6 source files edited, 1 patches doc updated,
clean typecheck + backend build + test suite. Mobile chrome is no longer over-padded
and non-bubble mobile UI is Telegram-parity via the global html=24 lever with zero
per-surface patchwork.
</success_criteria>

<output>
No SUMMARY required (quick mode). Update STATE.md `last_activity` after ship if the
executor conventionally does so; otherwise leave it to the wrapping quick workflow.
</output>
