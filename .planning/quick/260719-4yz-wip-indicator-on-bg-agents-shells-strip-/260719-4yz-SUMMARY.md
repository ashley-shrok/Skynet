---
phase: quick-260719-4yz
plan: 01
subsystem: pretty-view
tags: [wip-indicator, backgrounded-agents, backgrounded-shells, glass-strip, patch-72]
requires: []
provides: [broadened-wip-render-condition, naked-spinner-wip-indicator]
affects: [PrettyView, WipBubble]
tech_stack:
  added: []
  patterns: [semantic-shape-distinction-busy-vs-message]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/WipBubble.tsx
decisions:
  - Broaden WIP trigger to a union of (wipActive, backgroundedAgents live, backgroundedShells live) — all three states mean the same thing to the operator ("session is busy")
  - Strip glass-card chrome from WipBubble — spinner alone is instantly readable as an indicator, not content
  - Leave PlanPendingBubble bubble intact — plan-pending is "idle, waiting on you" = message-shaped semantics
  - Bump spinner from h-4 w-4 to h-5 w-5 so the naked spinner reads clearly without the card scaffolding
  - Move role="status" + aria-label onto Loader2 directly (SVG accepts both) rather than a wrapper div
metrics:
  duration_seconds: 180
  completed: 2026-07-19
---

# Quick 260719-4yz: WIP indicator during BG activity + strip bubble Summary

Patch #72 — Broadened the pretty-view WIP indicator trigger to fire when EITHER Claude is mid-turn OR any backgrounded agent/shell is running, AND stripped the glass-card chrome from `WipBubble` so it renders as a naked assistant-aligned Loader2 (visually distinct from actual message bubbles).

## What Changed

### `src/ui/features/pretty-view/PrettyView.tsx` (~line 464)

Broadened the render guard from `wipActive` alone to the three-state union:

```tsx
{(wipActive || backgroundedAgents.length > 0 || backgroundedShells.length > 0) && <WipBubble />}
```

All three variables were already in scope in the render function (line 110, 120, 146) — no imports or new state needed. No preceding block comment mentioned "active turn only" semantics, so no comment update was made (per plan's instruction not to invent one).

### `src/ui/features/pretty-view/WipBubble.tsx` (full rewrite)

- Removed the inner glass-card wrapper `<div>` entirely — no more `rounded-[var(--radius-pv-bubble)]`, `backdrop-blur-xl`, `saturate-150`, `[-webkit-backdrop-filter:...]`, `bg-[linear-gradient(...)]`, `text-[#dfe3ee]`, `border border-white/[0.08]`, `shadow-[...]`, `leading-relaxed`, `px-3 py-2`.
- Outer `<div className={cn("flex", "justify-start")}>` preserved for assistant-side alignment.
- `<Loader2>` is now the direct child of the flex wrapper.
- Spinner size bumped from `h-4 w-4` → `h-5 w-5` (16px → 20px) so it reads clearly without card scaffolding.
- `role="status"` and `aria-label="Claude is working"` moved onto the Loader2 element directly.
- Kept `animate-spin motion-reduce:animate-none` and the existing color `text-[rgba(150,180,220,0.9)]`.
- Kept both `Loader2` and `cn` imports (both still used).
- Top-of-file comment rewritten to explain patch #72's trigger union + non-bubble intent + PlanPending contrast, preserving patch #51 provenance.

## Verification

- `npx tsc --noEmit` → exit 0 (clean).
- `grep -c 'backgroundedAgents.length > 0 || backgroundedShells.length > 0' src/ui/features/pretty-view/PrettyView.tsx` → `1`.
- `grep -vE '^\s*//' src/ui/features/pretty-view/WipBubble.tsx | grep -cE 'backdrop-blur|rounded-\[|shadow-\[|bg-\[linear|border '` → `0` (all glass-card classes gone from live code).
- `grep -c 'h-5 w-5' src/ui/features/pretty-view/WipBubble.tsx` → `1`.
- Live-code (comment-stripped) `grep -c 'role="status"' src/ui/features/pretty-view/WipBubble.tsx` → `1`.
- `git diff --stat HEAD~1 HEAD` → exactly 2 files under `src/ui/features/pretty-view/` (PrettyView.tsx +2/-2 lines, WipBubble.tsx +16/-30 lines).
- `git status -- PlanPendingBubble.tsx BackgroundedAgentsPanel.tsx BackgroundedShellsPanel.tsx` → all clean (untouched).
- `ls ~/.claude/identities/tina/bounties/wip-indicator-on-bg-agents-or-shells` → No such file or directory (folder moved).
- `jq -r .status ~/.claude/identities/tina/bounties/archive/wip-indicator-on-bg-agents-or-shells/bounty.json` → `done`.
- `~/git/termix-patches.md` untouched (write-up happens at pin time per Tina fleet rule).

## Commits

- Code: `9dfc406` — `feat(quick-260719-4yz): patch #72 — WIP shows during BG activity + strip bubble (semantics: busy vs message)` (2 files, +16/-32 lines)

## Housekeeping (outside repo)

- Bounty JSON at `~/.claude/identities/tina/bounties/archive/wip-indicator-on-bg-agents-or-shells/bounty.json`:
  - `status`: `on_deck` → `done`
  - `updated_at`: `2026-07-18T21:33:30Z` → `2026-07-19T03:38:38Z`
  - Timeline entry appended: `"2026-07-19T03:38:38Z: done via patch #72 — commit 9dfc406f357fe94a8b21fbb1483f3392ba2eb073"`
  - Sole todo entry marked `done: true`
  - JSON re-serialized with 2-space indent (matches prior style)
- Folder moved: `~/.claude/identities/tina/bounties/wip-indicator-on-bg-agents-or-shells/` → `~/.claude/identities/tina/bounties/archive/wip-indicator-on-bg-agents-or-shells/`
- Archive parent directory `mkdir -p`'d (was already present, no-op).

## Deviations from Plan

None — plan executed exactly as written.

## Semantic Intent

Three visual shapes now map to three session states:

| State | Visual | File |
|-------|--------|------|
| Session busy (Claude mid-turn OR live BG agents/shells) | Naked floating spinner | WipBubble.tsx |
| Assistant said something | Glass-card message bubble | ChatMessage.tsx (assistant branch) |
| Idle, waiting on user (plan-pending) | Message-shaped card | PlanPendingBubble.tsx |

The naked-spinner treatment prevents the first-glance ambiguity where a bubble containing only a spinner reads as "assistant is composing a message" — instead, the spinner-alone shape reads as "session state indicator" instantly, matching Ashley's operator model.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/PrettyView.tsx` (modified — 1 line changed at ~464)
- FOUND: `src/ui/features/pretty-view/WipBubble.tsx` (modified — full rewrite)
- FOUND commit: `9dfc406` on branch `worktree-agent-a57f7c329e4dd052a`
- FOUND archive: `~/.claude/identities/tina/bounties/archive/wip-indicator-on-bg-agents-or-shells/bounty.json` (`status: done`)
- MISSING (as expected): `~/.claude/identities/tina/bounties/wip-indicator-on-bg-agents-or-shells/` (source folder removed)
- All done-criteria items in PLAN.md `<done>` block satisfied.
