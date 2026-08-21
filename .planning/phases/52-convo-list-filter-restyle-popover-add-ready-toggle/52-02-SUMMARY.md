---
phase: 52-convo-list-filter-restyle-popover-add-ready-toggle
plan: "02"
subsystem: pretty-conversations-filter-popover
tags:
  - ui
  - filter
  - popover
  - css
  - react
dependency_graph:
  requires: []
  provides:
    - readyOnly state hook in PrettyConversationsPanel
    - .pv-filter-menu-item CSS class
    - .pv-filter-check CSS class
    - three menuitemcheckbox buttons (Ready, Pinned, Needs desk)
    - glass-chrome PopoverContent (inline style, matches three-dots + context menu)
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
tech_stack:
  added: []
  patterns:
    - inline style on Radix PopoverContent (option a) to override shadcn w-72 fixed-width + bg-popover tokens
    - role="menuitemcheckbox" + aria-checked for accessible toggle buttons
    - data-checked attribute on .pv-filter-check for CSS-driven ON/OFF visual state
    - inline SVG check glyph (path M3.5 8.5 L7 12 L13 5) — avoids unicode encoding trap
key_files:
  modified:
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Chrome override: option (a) — inline style on PopoverContent. Rationale: three-dots MoreVertical menu at Panel.tsx:1622-1675 already uses this pattern (portal div with hand-crafted inline glass), and CONTEXT.md's own hint says match whichever the existing three-dots menu implies. Inline style wins over Tailwind utility class by same-property specificity without !important fights."
  - "W-1 fix applied: added width:\"auto\" to PopoverContent inline style to nullify shadcn's hardcoded w-72 (fixed 288px) Tailwind class. Without this, minWidth:200 alone does not override width (different CSS properties), leaving the popover at 288px wide."
  - "W-2 fix applied: @media (max-width: 767.98px) used for .pv-filter-menu-item mobile touch-target bump, confirmed by pre-flight grep that found exactly this breakpoint at pretty-conversations.css:205 and :1287 (Tailwind v4 md=48rem/768px convention, no tailwind.config.js, config in src/ui/index.css @theme)."
  - "W-4 judgment upheld: Task 2 kept as one task (state + anyFilterOn + markup rewrite + test adaptations). Splitting would have forced two executor sessions to re-read the same Panel.tsx region."
  - "Explicit button elements (not array+map) used so data-testid literal strings appear in source for grep acceptance criteria validation."
metrics:
  duration: "~15 minutes"
  completed: "2026-08-21"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 52 Plan 02: Filter Popover Restyle + readyOnly State Summary

**One-liner:** Glass chrome popover with three menuitemcheckbox buttons (Ready/Pinned/Needs desk) + outlined-square SVG check affordance via .pv-filter-check — visually matches three-dots menu and context menu, with readyOnly state extending anyFilterOn.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite .pv-filter-popover CSS — retire toggle-row, add menu-item + check rules | `6ce685a1` | pretty-conversations.css |
| 2 | Rewrite filter popover markup + readyOnly state + anyFilterOn extension + test adaptations | `7b7027e0` | PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx |

## Chrome Override Decision: Option (a) — Inline Style on PopoverContent

**Option chosen:** (a) — inline `style={{}}` prop on `<PopoverContent>`.

**Rationale:** The three-dots MoreVertical menu at `PrettyConversationsPanel.tsx:1622-1675` uses exactly this pattern: a portal-mounted `<div>` with hand-crafted inline glass styles. CONTEXT.md § Popover chrome says "match whichever the codebase's existing three-dots menu style implies." Option (a) avoids `!important` fights with shadcn's default Tailwind token treatment (`bg-popover`, `text-popover-foreground`, `rounded-md`, `shadow`, `w-72`).

**Exact inline style object written on PopoverContent:**
```tsx
style={{
  padding: 4,
  borderRadius: 12,
  background: "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))",
  border: "1px solid rgba(255,240,215,0.12)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)",
  backdropFilter: "blur(20px) saturate(1.6)",
  WebkitBackdropFilter: "blur(20px) saturate(1.6)",
  color: "#e8e4d8",
  minWidth: 200,
  // W-1 fix: shadcn PopoverContent hardcodes w-72 (fixed 288px). Inline width:"auto"
  // overrides that utility via same-property inline-wins so popover sizes to content.
  width: "auto",
}}
```

## CSS Classes Added

| Class | Purpose |
|-------|---------|
| `.pv-filter-popover` | Marker rule only (no chrome) — chrome is on PopoverContent inline style |
| `.pv-filter-menu-item` | Flex row button: gap 10px, 14px font, 8px/12px padding, transparent bg, 8px border-radius |
| `.pv-filter-menu-item:hover` | `rgba(255, 240, 215, 0.08)` — matches .pv-context-menu-item:hover exactly |
| `.pv-filter-menu-item:active` | `rgba(255, 240, 215, 0.18)` — matches .pv-context-menu-item:active exactly |
| `.pv-filter-check` | 16×16 outlined square, OFF: `rgba(255,240,215,0.32)` border, transparent bg |
| `.pv-filter-check[data-checked="true"]` | ON: `rgba(255,220,170,0.22)` bg + `rgba(255,220,170,0.55)` border |
| `.pv-filter-check svg` | 12×12, opacity:0, stroke `rgba(255,232,200,1)`, stroke-width 2.5 |
| `.pv-filter-check[data-checked="true"] svg` | opacity:1 — reveals the check mark |

**Mobile-touch breakpoint:** `@media (max-width: 767.98px)` — bumps `.pv-filter-menu-item` padding to `18px 14px`.

**Breakpoint confirmation grep output:**
```
205:@media (max-width: 767.98px)   ← existing .pv-filter-dot mobile bump
1287:@media (max-width: 767.98px)  ← existing pattern at :1287
```
After Task 1, the CSS file now has 4 hits (≥3 required). Confirms Tailwind v4 md=48rem/768px alignment (W-2 fix).

## readyOnly State

```tsx
const [readyOnly, setReadyOnly] = useState(false);
// ...
const anyFilterOn = readyOnly || pinnedOnly || needsDeskOnly;
```

`anyFilterOn` order is Ready-leftmost per the V2 snippet. The Ready toggle lights the `.pv-filter-dot` immediately when on. **The predicate wiring (`matchesFilterForRow` extension) is Plan 03's job** — between Plan 02 and Plan 03, the Ready button flips state and lights the dot but does not yet filter rows.

## TestID Mapping (Old → New Element)

| Old Element | Old Attribute | New Element | New Attribute |
|-------------|---------------|-------------|---------------|
| `<button>` (Checkbox root, shadcn) | `data-testid="pv-filter-toggle-pinned"` | `<button role="menuitemcheckbox">` | `data-testid="pv-filter-toggle-pinned"` |
| `<button>` (Checkbox root, shadcn) | `data-testid="pv-filter-toggle-needs-desk"` | `<button role="menuitemcheckbox">` | `data-testid="pv-filter-toggle-needs-desk"` |
| (new) | (new) | `<button role="menuitemcheckbox">` | `data-testid="pv-filter-toggle-ready"` |

TestIDs preserved on the two existing toggles — the same string now points to the new `<button>` element instead of the shadcn Checkbox root. Tests that fire `fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"))` continue working because the new button is a real clickable element with the same testid.

## Test File Adaptations

**Test 24** — adapted from `data-state` (shadcn Checkbox) to `aria-checked` (new button):

```ts
// Before (shadcn Checkbox Radix state attribute):
expect(pinnedCb.getAttribute("data-state")).toBe("unchecked");
expect(deskCb.getAttribute("data-state")).toBe("unchecked");

// After (menuitemcheckbox aria-checked):
expect(readyBtn.getAttribute("aria-checked")).toBe("false");
expect(pinnedBtn.getAttribute("aria-checked")).toBe("false");
expect(deskBtn.getAttribute("aria-checked")).toBe("false");
```

Test 24 also now verifies the new Ready button (pv-filter-toggle-ready) is present and unchecked. All other tests (25, 25b, 26, 27, 27b, etc.) only fire `fireEvent.click(screen.getByTestId(...))` — no attribute assertions — so they pass without adaptation.

**Final test result:** 91 tests passed, 0 failed (`npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel`).

## Deviations from Plan

None — plan executed exactly as written.

The only execution note: the initial implementation used an array+map approach for the three buttons (matching the three-dots menu pattern). This was refactored to three explicit `<button>` elements so that literal `data-testid="..."` strings appear in source and the plan's static grep acceptance criteria are satisfiable. Functionally identical; the explicit form is also more readable.

## Retired

- `.pv-filter-toggle-row` and `.pv-filter-toggle-row:hover` CSS rules — fully deleted, 0 references remain anywhere in `src/`.
- `import { Checkbox } from "@/components/checkbox"` — removed from PrettyConversationsPanel.tsx after Checkbox became unreferenced.
- `<label className="pv-filter-toggle-row">` elements — replaced by `<button role="menuitemcheckbox">`.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. All changes are CSS + React state + JSX markup. The inline SVG approach for the check glyph directly mitigates T-52-02-01 (unicode encoding trap on Ashley's iPhone PWA when charset header absent).

## Self-Check: PASSED

- `src/ui/features/pretty-conversations/pretty-conversations.css` — modified and committed at `6ce685a1`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — modified and committed at `7b7027e0`
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — modified and committed at `7b7027e0`
- `git log --oneline -2` confirms both commits on `feat/tab-title-from-tmux`
- `npx tsc --noEmit`: 0 error TS
- `npx vitest run`: 91 passed, 0 failed
- `grep -rn "pv-filter-toggle-row" src/`: 0 lines (fully retired)
- `grep -q 'width: "auto"'`: exits 0 (W-1 fix present)
- `grep -c "@media (max-width: 767.98px)" pretty-conversations.css`: 4 (≥3, W-2 fix present)
