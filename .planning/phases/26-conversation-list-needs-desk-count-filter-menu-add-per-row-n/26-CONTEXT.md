# Phase 26: Conversation-list needs-desk count + filter menu — Context

**Gathered:** 2026-08-06
**Status:** Ready for planning
**Source:** In-chat design lock with Ashley 2026-08-06 (bounty `conversation-list-needs-desk-count-and-filter-menu`)

<domain>
## Phase Boundary

Adds per-row needs-desk bounty count to pretty-conversations rows alongside the existing pinned count, and widens the panel-header Filter icon from a single toggle to a two-toggle popover.

**In scope:**
- Widen `readIdentityPinnedBountyCount` (`src/backend/claude-session/identity-artifact-reader.ts` §10) to return `{pinnedCount, needsDeskCount}` on a single fs walk.
- Widen the WS response payload of `identity:count-bounties` → `identity:bounty-counts` (`src/backend/claude-session/claude-session-server.ts`) to carry both counts per identity.
- Widen `src/ui/state/bounty-counts-store.ts` keyed value from `number` to `{pinnedCount, needsDeskCount}`; keep same poller/focus-listener/invalidate-on-priority-update piggyback.
- Refactor `PrettyBountyCountBadge` (`src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx`) to render the combined `pin·desk` pill described below.
- Refactor Filter button in `PrettyConversationsPanel.tsx` (around line 777, `data-testid="pv-filter-pinned-bounties"`) into a popover with two independent toggles and a small "any filter on" indicator dot.
- Update tests that reference the old wire shape, old badge shape, or the old filter testid.

**Out of scope:**
- New backend endpoint (widening the existing one is the whole mechanism).
- New WS message type (widening the existing response is the whole mechanism).
- New nginx location block.
- Schema migration (both `pinned` and `needs_desk` are already on the bounty schema per id skill).
- Per-user filter persistence across sessions (in-memory only, matches today).
- Animation transitions on popover open/close.
- Hover-hue on the pill halves.
- Any visible chrome elsewhere in the panel (no header changes, no row-height changes).
</domain>

<decisions>
## Implementation Decisions (locked with Ashley 2026-08-06)

### Row-display format — LOCKED

Combined pill `"3·1"` (pin·desk). Left number = pinned count, right number = needs-desk count, middle-dot separator (`·`, U+00B7).

- Zero on one side renders that side blank (e.g. `"·1"` or `"3·"`).
- Both zero renders no pill (matches today's `count=0/undefined renders null`).
- Position stays where the current pin-count badge sits in `.pv-meta`: `[deactivate][pin][badge][ready-dot]`.
- Both halves inherit `--pv-hue` (no dual hues — Ashley did not lock a two-hue scheme).

Rejected alternatives (do NOT re-litigate):
- (a) Two side-by-side badges — hue conflict, doubles `.pv-meta` width when both nonzero.
- (c) Tiny icon+number pairs — self-documenting but heavier `.pv-meta`.

### Filter-toggle combination rule — LOCKED

AND (intersection). Both toggles on = keep rows that have BOTH ≥1 pinned bounty AND ≥1 needs-desk bounty. Each toggle is subtractive; each independent when the other is off.

### Filter icon active-state affordance — LOCKED

Small dot indicator on the Filter icon when at least one toggle is on. NO icon swap (no filled variant) — matches the row-badge presence-is-signal pattern and avoids flicker. Dot inherits `--pv-hue` (single hue — no per-toggle color coding).

### Active-set exemption — LOCKED

Symmetric with the existing pinned filter — the needs-desk filter also exempts active-set rows (active-set rows always render regardless of filter state). Rationale: active-set is Ashley's "currently paying attention to" set; filters must never hide those.

### Backend widening — LOCKED

- Widen existing `readIdentityPinnedBountyCount` to return `{pinnedCount, needsDeskCount}` on the SAME fs walk. Do NOT walk twice.
- Rename the function to reflect the wider job (e.g. `readIdentityBountyCounts`) — planner picks the exact name.
- WS response `identity:bounty-counts` widens its per-identity value from `number` to `{pinnedCount, needsDeskCount}`. No new WS message type.

### Frontend store — LOCKED

- `bounty-counts-store.ts` keys a pair per identity: `{pinnedCount, needsDeskCount}`.
- Same poller cadence, same focus-listener, same invalidate-on-priority-update piggyback.
- Existing hook (currently `useBountyCount(identityKey): number`) either widens to return the pair, or is split into two hooks — planner picks based on ergonomics and consumer count.

### Filter UI shape — LOCKED design, planner-picked mechanism

- Filter button opens a popover on click. Popover contains two independent toggle controls (Switch or Checkbox — planner picks based on existing panel style) labeled:
  - "Only rows with pinned bounties"
  - "Only rows with needs-desk bounties"
- Popover mechanism: reuse the popover primitive already in use elsewhere in pretty-conversations (Phase 23 GEFM-01 introduced a Radix DropdownMenu for the panel header — check whether it's Radix Popover/DropdownMenu, headless, or shadcn wrapper before adding a new dep).
- Testid on the Filter button renames from `pv-filter-pinned-bounties` → `pv-filter-toggles` (or planner-chosen equivalent). Update tests.

### Backwards-compat wire shape

The WS payload widens with the `needsDeskCount` field alongside the existing `pinnedCount`. Old clients that only read `pinnedCount` continue to work. This is a single-tenant deploy so hard-strictness is fine, but the additive widening keeps the diff small and the plan-checker happy.

### Claude's Discretion (planner picks)

- Exact function rename target for the widened reader (e.g. `readIdentityBountyCounts`).
- Whether to keep one hook (`useBountyCounts(): {pinnedCount, needsDeskCount}`) or split into two.
- Exact Switch-vs-Checkbox affordance inside the popover (match existing panel style).
- Exact positioning of the "any filter on" dot on the Filter icon (top-right corner is the codebase-standard pattern).
- Whether to reuse an existing popover/dropdown import from Phase 23 GEFM-01 vs introduce a new one.
- Test rename target for the filter button testid.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend — bounty-count wire
- `src/backend/claude-session/identity-artifact-reader.ts` (§10) — `readIdentityPinnedBountyCount`. Also houses `resolveRoleForIdentity` (Phase 25) using the same fs-read pattern.
- `src/backend/claude-session/claude-session-server.ts` — WS handler for `identity:count-bounties` → `identity:bounty-counts`.
- `~/.claude/skills/id/SKILL.md` — bounty schema (both `pinned` and `needs_desk` are optional booleans, absent = false; `needs_desk` added 2026-08-06).

### Frontend — row display + filter
- `src/ui/state/bounty-counts-store.ts` — `useSyncExternalStore`-based store, poller, focus-listener, invalidate-on-priority-update piggyback.
- `src/ui/features/pretty-conversations/PrettyBountyCountBadge.tsx` — the row's badge component; today renders a bare number.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — Filter icon around line 777 (`data-testid="pv-filter-pinned-bounties"`); row rendering with `.pv-meta` composition; active-set exemption in the filtered-list computation.

### Existing patterns to mirror
- Phase 23 GEFM-01 (panel-header MoreVertical dropdown) — analog for the Popover / DropdownMenu library choice.
- Phase 25 `resolveRoleForIdentity` — same fs-side walk semantics for the widened reader.

### Design tokens
- `src/ui/index.css:117-146` — the `--color-pv-*` and `--pv-hue` token block. Row badge and filter dot both inherit `--pv-hue`.
</canonical_refs>

<specifics>
## Specific Ideas

- Backend fs walk: today iterates `bounties/*/bounty.json`, skips `archive/`, counts `parsed.pinned === true`. Add a parallel counter for `parsed.needs_desk === true` on the same iteration.
- WS response per-identity shape: today `{ [identityKey]: number }`, new `{ [identityKey]: { pinnedCount: number, needsDeskCount: number } }`.
- Badge component: rendering rule table —
  - `pinnedCount === 0 && needsDeskCount === 0` → render null (no pill)
  - `pinnedCount > 0 && needsDeskCount === 0` → `"3·"` (right side blank)
  - `pinnedCount === 0 && needsDeskCount > 0` → `"·1"` (left side blank)
  - both nonzero → `"3·1"`
- Filter popover: two toggles. AND rule for the filtered-list computation: `keep(row) = activeSet(row) || ((!pinnedFilter || row.pinnedCount > 0) && (!needsDeskFilter || row.needsDeskCount > 0))`.
- Small dot on Filter icon: rendered when `pinnedFilter || needsDeskFilter`. Uses `--pv-hue` for color.
- Tests to update:
  - Any tests referencing `data-testid="pv-filter-pinned-bounties"` (rename).
  - Any tests reading the WS bounty-counts payload shape (widen expected object).
  - Any tests asserting `PrettyBountyCountBadge` renders a bare number (update to the pill shape rules above).
  - Backend tests for `readIdentityPinnedBountyCount` (rename + wider return shape).
</specifics>

<deferred>
## Deferred Ideas

- Separate WS message per count-type (widening the existing message is the whole mechanism).
- New nginx location block (no new endpoint).
- Per-user filter persistence across sessions.
- Animation transitions on popover open/close (keep instant).
- Hover-hue on the pill halves.
- Any additional bounty-status filters (waiting-on-someone-else, priority-high, etc.) — future bounties if wanted.
- Any additional per-row indicators beyond the pin·desk pill.
</deferred>

---

*Phase: 26-conversation-list-needs-desk-count-filter-menu*
*Context gathered: 2026-08-06 via in-chat design lock with Ashley*
