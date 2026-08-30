# Phase 52: Convo-list filter — restyle popover + add Ready toggle — Context

**Gathered:** 2026-08-20
**Status:** Ready for planning
**Source:** In-session design conversation with Ashley + Explore-agent codebase scan

<domain>
## Phase Boundary

Two independent pieces that ship together because they touch the same
`.pv-filter-popover` code + wire the same third toggle:

**Piece 1 (Ready toggle) — new filter option.** Add a third toggle to the
conversation-list filter menu whose semantic is *"idle AND not dormant"* — i.e.
sessions ready for the user's next instruction, in the current work session.
Concretely: predicate is `!isWorking && !dormant` on the ConversationRow.

**Piece 2 (restyle) — popover chrome + item styling matches the rest of the
panel's menu vocabulary.** Kill the shadcn `PopoverContent` chrome + checkbox
rows. Adopt the exact chrome used by `PrettyConversationContextMenu.tsx`
(right-click row menu) and the panel-header three-dots `MoreVertical` menu in
`PrettyConversationsPanel.tsx:1622-1675` (glass gradient, warm-cream border,
`border-radius: 12`, `backdrop-filter: blur(20) saturate(1.6)`, deep drop
shadow + inset top highlight, warm-cream item hover flash). Replace checkbox
rows with menu-item buttons that carry a leading outlined-square checkbox
affordance (visible when off, warm-amber fill + inline-SVG check when on).

Both pieces ship as one phase because (a) the third toggle mounts INSIDE the
restyled popover; (b) they touch the same `.pv-filter-popover` markup +
`.pv-filter-toggle-row` CSS + `matchesFilterForRow` predicate.

</domain>

<decisions>
## Implementation Decisions

### Filter semantic — "Ready" means idle-and-not-dormant

- **Predicate:** `!isWorking && !dormant` on the row. Both signals ANDed.
- **`isWorking`** comes from `useSessionIsWorking(sessionKey)` at
  `src/ui/state/session-working-store.ts:425-432`. Composite `main || bg`
  where `main = status === "busy"` and `bg = backgroundTasks.length > 0`.
  Already available on `ConversationRow` today (used by the ready-dot at
  PrettyConversationRow.tsx and by rendering code at PrettyConversationsPanel.tsx:206).
- **`dormant`** — real supervisor-dormancy signal (Option C, Ashley's pick over
  the time-threshold approximation and active-set alternatives). See § "Dormant
  plumbing gap" below — value exists partially in the codebase today (in the
  context-meter wire only, via tiffany's b8942cde) but does NOT reach
  ConversationRow. Planning MUST decide the cleanest path to surface it there.

### Popover chrome — mirror context-menu + three-dots exactly

Reference implementations (identical inline styles in both):

- **Context menu:** `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx:161-181`
- **Three-dots menu:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1626-1640`

The exact chrome tokens to lift onto `.pv-filter-popover`:

- `border-radius: 12px`
- `background: linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))`
- `border: 1px solid rgba(255, 240, 215, 0.12)`
- `box-shadow: 0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)`
- `backdrop-filter: blur(20px) saturate(1.6)` + `-webkit-backdrop-filter` mirror
- `color: #e8e4d8`
- `padding: 4px`
- `min-width: 200px`

**Retire the shadcn PopoverContent tokens** (`bg-popover text-popover-foreground border rounded-md shadow`) that are currently in play — those are the Skynet-general theme tokens, not the pv-* palette. The mismatch is what Ashley named ("doesn't fit").

**Preferred implementation shape:** Keep using Radix Popover for the trigger +
portal + open/close, but override PopoverContent's chrome. Either
(a) apply inline styles on the `<PopoverContent>` matching the above tokens
(mirrors how PrettyConversationContextMenu is hand-styled with inline glass),
OR (b) update the `.pv-filter-popover` CSS class to carry the glass rules with
`!important` if needed to overpower shadcn defaults. Planner picks — no strong
preference. Match whichever the codebase's existing three-dots menu style
implies (three-dots is inline-styled, but that's a hand-crafted portal not a
Radix wrapper).

### Menu items — checkbox affordance + hover pattern from three-dots

Each of the three toggles renders as a `<button role="menuitemcheckbox"
aria-checked="…">` styled to mirror the three-dots menu's item buttons at
PrettyConversationsPanel.tsx:1649-1671:

- `display: flex; align-items: center; gap: 10px; width: 100%; text-align: left`
- `background: transparent; border: none; border-radius: 8px`
- `padding: 8px 12px; max-md:padding: 18px 14px` (mobile touch-target bump)
- `font-family: inherit; font-size: 14px; line-height: 18px; color: #e8e4d8`
- Hover: `background: rgba(255, 240, 215, 0.08)` (identical to
  `.pv-context-menu-item:hover`)
- Tap-flash: `background: rgba(255, 240, 215, 0.18)` (identical to
  `.pv-context-menu-item:active`)

Each item has a leading **outlined-square checkbox affordance** — 16x16 with:

- Off: `border: 1px solid rgba(255, 240, 215, 0.32)`, transparent bg
- On: `background: rgba(255, 220, 170, 0.22); border-color: rgba(255, 220, 170, 0.55)`
  + inline-SVG check inside (opacity 0 → 1 transition)
- 12×12 SVG check, stroke `rgba(255, 232, 200, 1)`, `stroke-width: 2.5`,
  `stroke-linecap: round`, `stroke-linejoin: round`, path `d="M3.5 8.5 L7 12 L13 5"`
- **Inline SVG, NOT a unicode glyph** — a served `✓` character was mis-decoded
  as `âœ"` on Ashley's iPhone PWA when the earlier snippet omitted charset;
  inline SVG dodges the class entirely.

### Labels + wording — short forms

- "Ready" (new — was going to be "Awaiting" / "Focus"; Ashley picked Ready
  since it matches the ready-dot semantic already locked in).
- "Pinned" (was "Only rows with pinned bounties")
- "Needs desk" (was "Only rows with needs-desk bounties")

Same short-form aesthetic as the three-dots menu's "New agent" / "New role" /
"Edit global files…" labels.

### Filter logic — extend `matchesFilterForRow`

Existing at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:609-623`:

```ts
const matchesFilterForRow = (row) => {
  const pair = /* identity lookup */;
  return (!pinnedOnly    || (pair?.pinnedCount    > 0))
      && (!needsDeskOnly || (pair?.needsDeskCount > 0));
};
```

Extend to:

```ts
const matchesFilterForRow = (row) => {
  const pair = /* identity lookup */;
  const isWorking = /* useSessionIsWorking equivalent — see plan for hook shape */;
  const isDormant = /* row.dormant */;
  return (!readyOnly     || (!isWorking && !isDormant))
      && (!pinnedOnly    || (pair?.pinnedCount    > 0))
      && (!needsDeskOnly || (pair?.needsDeskCount > 0));
};
```

AND-intersection stays (all active toggles must pass). Existing behavior:
`.filter(matchesFilterForRow)` on pinned/middle tiers ONLY; RDP-group rows
pass through unfiltered (Panel.tsx:634-637). Ready toggle inherits the SAME
"RDP pass-through" behavior (no dormancy for RDP hosts — dormancy is an
identity concept, not a host concept). Hidden rows remain excluded (Panel.tsx:806).

State + persistence: add `readyOnly` to the same state shape as `pinnedOnly` /
`needsDeskOnly` (currently just `useState<boolean>(false)`). No localStorage
persistence in the current setup — keep parity, don't add persistence here.

### `.pv-filter-dot` (filter-icon dot indicator)

The small warm-hue pip in the top-right of the filter icon (fires when
`anyFilterOn === true`) stays exactly as-is — semantic already covers "any
toggle on" and Ready extends `anyFilterOn` naturally (`pinnedOnly ||
needsDeskOnly || readyOnly`). No CSS or markup change to `.pv-filter-dot` or
its mobile bump at pretty-conversations.css:194-212.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Reference implementations for chrome + items (must match visually)
- `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` — hand-crafted portal menu, the primary reference for the popover chrome + item styling. Lines 161-181 (chrome), 183-218 (items).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1622-1675` — the three-dots MoreVertical menu, same chrome/item shape as the context menu. Second confirmation of the pattern.
- `src/ui/features/pretty-conversations/pretty-conversations.css:1397-1418` — `.pv-context-menu-item` hover + `:active` tap-flash CSS. Menu-item hover in the restyled popover must match these tokens.

### Files that WILL be modified
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — filter state (add `readyOnly`), filter popover markup (rewrite content + chrome, replace shadcn Checkbox rows with menu-item buttons), `matchesFilterForRow` predicate (add Ready branch), `anyFilterOn` derivation.
- `src/ui/features/pretty-conversations/pretty-conversations.css` — `.pv-filter-popover` chrome rules (glass gradient, blur, border, radius); new `.pv-filter-menu-item` + `.pv-filter-check` classes for the menu-item + checkbox affordance styling. Retire or repurpose `.pv-filter-toggle-row`.
- `src/ui/state/conversation-store.ts` — extend `ConversationRow` with `dormant?: boolean` (per exploration report — currently absent from the row shape at :65-108).
- Backend/wire files determining where `dormant` gets published onto per-row state — planner decides based on cleanest path. Candidates surfaced during scoping: `src/backend/fleet-status/*` (existing per-row broadcast pipeline), `src/backend/claude-session/claude-session-server.ts` (already computes dormancy for the context-meter path at :1684-1690), `session-working-store.ts` (may be the right consumer since it already fans out per-key state).

### Palette + design tokens
- `src/ui/index.css:143-158` — `--color-pv-*` palette definitions (base gradient, fg, fg-muted, borders). Use these tokens where a token exists; use the hardcoded hex/rgba values from the reference menus where those menus hardcoded them (chrome gradient at `rgba(20,21,32,0.94)` etc. — those are inline hex in the reference menus, not tokens).

### Iteration artifacts (design source of truth)
- `~/.claude/roles/box-maintainer/bounties/convo-list-ready-filter-and-restyle/filter-restyle-v2.js` — the console-snippet V2 that Ashley signed off on ("yep perfect"). This is the visual target. The final .tsx/.css shape MUST match V2's rendered result. Bounty folder also holds V1 (rejected: always-visible chips) and the bounty.json.

</canonical_refs>

<specifics>
## Specific Ideas

### Dormant plumbing gap (planner must scope this)

**What exists today:** tiffany's b8942cde ("feat(pretty-view) keep context
meter populated for dormant identities") added a `dormant?: boolean` flag on
`ContextPctEvent` at `src/ui/api/claude-session-api.ts:95-104`. Backend
derivation at `src/backend/claude-session/claude-session-server.ts:1667-1690`
— when a `.dormant` sentinel is present on the identity folder, the polling
tick reads the JSONL directly (not from a live process) and emits
`{type:"context_pct", pct, dormant:true}`.

**What's missing:** the flag stops at the context-meter wire event. It never
reaches `ConversationRow` (verified — the row shape at conversation-store.ts:65-108
has no `dormant` field). `matchesFilterForRow` at Panel.tsx:609-623 cannot see
it. Something must plumb dormant state to the per-row layer.

**Options for the planner to weigh:**
- (a) Extend the existing fleet-status broadcast to include `dormant` per session — most work but cleanest, mirrors the wire pattern.
- (b) Consume `ContextPctEvent` in a lightweight subscriber that populates
      `session-working-store` (or a sibling store) keyed by session — reuses
      existing plumbing, but only fires when the context meter ticks (may be
      lagging for a session that's never had its meter queried).
- (c) Backend adds a lightweight `.dormant` sentinel poll as its own
      broadcast frame independent of the context-meter — same shape as (a)
      but scoped to sentinel-existence only.

Whichever path the planner picks, the source of truth for "dormant" is the
`.dormant` sentinel file at `~/.claude/identities/<name>/.dormant`; that
sentinel exists ⇔ identity is dormant (supervisor-managed).

### The `isWorking` predicate inside `matchesFilterForRow`

`matchesFilterForRow` runs at Panel level, not per-row (it's a pure fn over
row data). But `useSessionIsWorking(sessionKey)` is a React hook and can't
be called inside a pure function. Two shapes for the planner to weigh:

- (a) Compute `isWorking` per row in the row-render context (where
      `useSessionIsWorking` is already called at Panel.tsx:206) and inject
      it into the row shape or a parallel map before filtering.
- (b) Read the working-store's snapshot directly in `matchesFilterForRow`
      (skip the hook, subscribe imperatively). Panel is not a hot render
      path so an imperative subscribe is fine.

Existing pattern: Panel.tsx:206 already calls `useSessionIsWorking(sessionKey)`
per rendered row. The natural extension is (a) — thread `isWorking` (and
`isDormant`) alongside `pair.pinnedCount` in the filter's input map.

### Filter apply model — no change

Existing AND-intersection at Panel.tsx:621 stays. Adding `readyOnly` extends
the AND chain; RDP-group pass-through at Panel.tsx:634-637 stays.

</specifics>

<deferred>
## Deferred Ideas

- **Filter state persistence.** Currently none — filters reset on remount.
  Not part of this phase (parity with existing behavior). If Ashley wants
  persistence later, it's a separate one-liner via localStorage.
- **Filter behavior on the RDP group.** Ready toggle explicitly SKIPS RDP-group
  rows (they pass through unfiltered) — same as pinned/needs-desk today. If
  Ashley later wants Ready to hide the RDP zone, that's a separate change.
- **Distinguishing "dormant AND working" edge case.** By construction, a
  dormant identity has no live claude process, so `isWorking` should be
  false for it. If both flags simultaneously true occurs, it's a signal
  bug (something desynced). Ready predicate treats it as "not ready" (per
  the AND-of-negations) which is the safe read.
- **Backend/wire cache-key bumps.** If the planner picks option (a) or (c) for
  dormant plumbing, they may want a `sessionsListCacheKey` bump. Handle at
  plan time, not spec'd here.

</deferred>

<constraints>
## Constraints (non-negotiable)

- **Ready-dot semantics locked** (Ashley 2026-07-23, per box-maintainer role
  file § "Skynet conversation-list dot semantics"). The DOT's meaning stays
  `inActiveSet(row) === true && isWorking(row) === false`. **Ready FILTER's
  predicate differs** — it uses `!isWorking && !dormant`, NOT active-set
  membership. This is intentional and correct: the DOT is per-window
  ephemeral ("in the current window's active set"), the FILTER cuts across
  the whole fleet ("ready for direction anywhere"). Do not conflate the two.
- **Stripped surfaces stay stripped** (box-maintainer role file). Do not
  reintroduce: gear settings icon, SettingsRow, host-manager UI pages,
  admin console, top-level Skynet settings surfaces, Skynet tab bar chrome,
  keyboard shortcut editor, etc. This phase touches only the filter menu.
- **No new nginx routes.** All changes are frontend + fleet-status-adjacent
  backend. No new HTTP routes → no `location` block work required.
- **No worktrees** (fleet rule 2026-07-31). All work happens in the main
  `~/skynet-tina` tree on `feat/tab-title-from-tmux`.
- **Palette authority: `--color-pv-*`** (box-maintainer role file). Any color
  decision draws from the pv-* palette, NOT Skynet's `--background`/
  `--foreground` shadcn tokens (which are on the chopping block anyway).
- **Container mutations serialize** (box-maintainer role file). At ship time,
  post to the box-maintainer coord room BEFORE `docker build` + AFTER
  `docker compose up --force-recreate`.
- **Deploy pre-work is orchestrator-only** (fleet rule 2026-08-08). Plans
  MUST NOT include a "ship" task at executor scope — deploy motion (push,
  build, force-recreate) is handled by me (tina) after executor returns
  code-done + tests-green.
- **After-ship Stacy-notify ASK** (tina identity file). This phase touches
  fork behavior → after the ship completes, I ASK Ashley whether to DM
  Stacy that a new version is ready to pull. Do NOT DM Stacy on my own.

</constraints>

<success_criteria>
## Success Criteria

- Popover chrome is visually indistinguishable from PrettyConversationContextMenu
  and the three-dots MoreVertical menu (same glass gradient, border, radius,
  blur, shadow, item hover/active flash).
- Three menu items render inside the popover: "Ready" · "Pinned" · "Needs desk",
  each with a leading outlined-square checkbox affordance that fills warm-amber
  + reveals an inline-SVG check when toggled on.
- Ready toggle predicate: rows are hidden UNLESS `!isWorking && !dormant`.
- Existing Pinned + Needs desk toggles continue to work identically (same
  `pair.pinnedCount > 0` / `pair.needsDeskCount > 0` predicates).
- Filter icon `.pv-filter-dot` continues to appear when ANY of the three
  toggles is on (extends `anyFilterOn` to include `readyOnly`).
- RDP-group rows continue to pass through the filter unfiltered.
- Full `npx vitest run` green (exit 0).
- Backend `npm run build:backend` clean (any backend-touching change requires
  this per role file lesson).

</success_criteria>

---

*Phase: 52-convo-list-filter-restyle-popover-add-ready-toggle*
*Context gathered: 2026-08-20 by tina, from in-session Ashley design conversation + Explore-agent codebase scan*
