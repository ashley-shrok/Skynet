---
phase: 10-pretty-conversations-visual-language-rework
plan: 01
subsystem: ui/pretty-conversations
tags: [ui, pretty-conversations, row-component, swipe-gesture, hue-treatment, tdd]
dependency_graph:
  requires:
    - src/ui/state/conversation-store.ts (ConversationRow type)
    - src/ui/features/terminal/session-hue.ts (sessionMatchKey)
    - src/ui/state/identities-store.ts (useIdentities)
    - src/ui/shell/tabUtils.tsx (tabIcon)
    - src/ui/features/pretty-view/ChatMessage.tsx (verbatim hue-treatment reference)
  provides:
    - PrettyConversationRow — chunky Telegram-style row driving both mobile + desktop
    - PinAction — shared hue-tinted pin button (mobile disc / desktop rounded-md)
    - tokens (PC_ROW_MIN_H_MOBILE, PC_ROW_MIN_H_DESKTOP, PC_SWIPE_REVEAL, PC_SWIPE_THRESHOLD, PC_SWIPE_ANGLE_TOLERANCE)
  affects:
    - Wave 2 (panel) will mount PrettyConversationRow inside a scroller container
    - Wave 3 (AppShell) will swap ConversationRow mount site for this component
tech_stack:
  added: []
  patterns:
    - Variant-prop driven pin mechanism (mobile swipe / desktop hover) inside a single component
    - Inline hsla(${hue},...) interpolation via template literals (no new CSS custom properties)
    - Passive touch gesture handling with 12px vertical bail-out
    - forceClosed prop as the Wave 2 coordination surface (panel-driven, effect-free)
key_files:
  created:
    - src/ui/features/pretty-conversations/tokens.ts
    - src/ui/features/pretty-conversations/PinAction.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  modified: []
decisions:
  - "Test 7 split into 7 + 7b for symmetric variant coverage of T-Test-34 (RDP-can't-be-pinned)"
  - "PinAction exposes optional data-testid prop; defaults to 'pin-action' so tests can query without ambiguity"
  - "Test 1 reads raw style attribute (getAttribute('style')) instead of body.style.background — jsdom's CSSOM normalizes hsla→rgba on the parsed side; raw attribute preserves the source-of-truth hsla string"
  - "Avatar renders identity.displayName.charAt(0) upper-cased when avatarUrl is present but empty (initial letter fallback path per prototype spec)"
  - "forceClosed prop lives on the row; Wave 2's panel will drive it from a `currentlySwipedId` state — keeps coordination outside the row"
metrics:
  tasks: 3
  files_created: 4
  files_modified: 0
  loc_total: 1143
  loc_source: 614
  loc_test: 529
  vitest_pass: 12
  vitest_total: 12
  tsc: clean
  duration_minutes: 8
  completed: 2026-07-22
---

# Phase 10 Plan 01: Foundation — PrettyConversationRow + PinAction + tokens Summary

Delivered the foundation of the Phase 10 pretty-conversations component tree
in isolation. Every visual decision Ashley signed off on 2026-07-22 —
chunky Telegram-style row, 48/40 identity-hue avatar disc with hue ring,
ChatMessage-verbatim selected-row hue treatment, no identity chip,
variant-driven mobile-swipe / desktop-hover pin mechanism — lives inside
`PrettyConversationRow.tsx`. tsc-clean; 12/12 Vitest green.

## What shipped

**One-liner:** Single `PrettyConversationRow` component drives both mobile
(72px, swipe-left pin) and desktop (62px, hover-reveal pin) via a `variant`
prop, with a ChatMessage-verbatim hue-gradient selected-row treatment and
zero new dependencies.

**Files created** (4 total, 1,143 LOC — 614 source + 529 test):

| File | LOC | Purpose |
|---|---|---|
| `tokens.ts` | 50 | 5 named constants for values reused 3+ times (row heights, swipe geometry) per Ashley naming rule |
| `PinAction.tsx` | 123 | Shared hue-tinted pin/unpin button — 48x48 disc for mobile swipe strip, 24x24 rounded-md for desktop hover-reveal |
| `PrettyConversationRow.tsx` | 441 | Chunky row with variant-based pin mechanism, identity-hue avatar, selected-row ChatMessage-verbatim treatment |
| `PrettyConversationRow.test.tsx` | 529 | 12 tests: swipe state machine, pin toggle, RDP exclusion, selected-state, avatar fallback, hover-reveal |

**Commits** (all on `feat/tab-title-from-tmux`):

- `06c12fc` — `feat(pretty-conversations): tokens.ts + PinAction.tsx shared helpers`
- `55624a9` — `feat(pretty-conversations): PrettyConversationRow with variant-based pin mechanism`
- `06d8a93` — `test(pretty-conversations): PrettyConversationRow Vitest coverage (12/12 green)`

## Non-negotiables baked in

- **Session name IS identity name.** No IdentityBadge chip on rows. Grep confirms zero `IdentityBadge` references in the source file. Label carries the identity presence; avatar hue-ring reinforces it.
- **Variant prop drives pin-mechanism branching.** Mobile → swipe-left reveals 88px strip with 48x48 PinAction. Desktop → hover-reveal 24x24 PinAction in right meta column (always visible for pinned rows).
- **PinAction is shared.** Single component with `size: "mobile" | "desktop"` prop; caller controls visibility.
- **No motion on pin action.** Static Pin / PinOff glyph only. No `animate-spin`, no rotate transforms, no pulse.
- **RDP rows can't be pinned (T-Test-34 preserved).** No swipe wiring, no PinAction, no swipe strip — verified in both variants by Tests 7 + 7b.
- **Selected-row treatment = ChatMessage.tsx assistant bubble, verbatim.** Linear-gradient bg + hue border + inset+outer hue glow, adapted with reduced alpha per prototype.html lines 231-239 for row geometry (background dilution vs. bubble focal treatment).

## How this component talks to Wave 2

Wave 2 will build a thin `ConversationsPanel` container around this row.
Two coordination surfaces are already exposed:

**Coordination API for one-row-swiped-at-a-time policy:**

- **`onSwipeOpenChange?: (open: boolean) => void`** — observer callback. The row calls this whenever `swipedOpen` transitions. Panel uses it to track `currentlySwipedId`.
- **`forceClosed?: boolean`** — imperative close signal. When `true`, the row renders as if closed regardless of internal `swipedOpen` state (transform snaps to translateX(0), data-swiped-open attr is removed, tap fires onSelect normally). Panel passes `forceClosed={true}` to every row whose id differs from `currentlySwipedId`.

**Recommended Wave 2 wiring pattern:**

```tsx
const [swipedId, setSwipedId] = useState<string | null>(null);
// ...
<PrettyConversationRow
  row={row}
  variant={isMobile ? "mobile" : "desktop"}
  onSwipeOpenChange={(open) => setSwipedId(open ? row.id : null)}
  forceClosed={swipedId !== null && swipedId !== row.id}
  // ...
/>
```

Also: rendering the tap-body-closes semantic on mobile already ships from
the row; the panel does NOT need to swallow onSelect for swiped-open rows —
onSelect only fires when the row is closed.

## Deviations from Plan

### Auto-added coverage (documentation, not code change)

**1. [Rule 2 - Coverage] Test 7 split into 7 + 7b**

- **Task:** Task 3
- **What plan called for:** 11 tests, Test 7 asserts RDP exclusion on mobile only
- **What shipped:** 12 tests, Test 7 (mobile) + Test 7b (desktop) both assert RDP-no-PinAction
- **Rationale:** T-Test-34 (RDP rows can't be pinned) is a variant-invariant constraint. Only asserting it on mobile leaves the desktop branch to Wave 2's regression net — cheaper to assert both here since the code path is nearly identical.
- **Not a scope creep:** same behavior surface, symmetric coverage
- **Files:** `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx`
- **Commit:** `06d8a93`

**2. [Rule 3 - Testability] PinAction accepts optional `data-testid` prop (defaults to `"pin-action"`)**

- **Task:** Task 1 revised during Task 3
- **What plan called for:** "Add a data-testid="pin-action" to PinAction if the role query is ambiguous (Task 1 revision — call out in commit message)"
- **What shipped:** Plan already called this out. Prop is optional so callers (row + tests) can override if needed.
- **Files:** `src/ui/features/pretty-conversations/PinAction.tsx`
- **Commit:** `06c12fc` (called out in Task 1 message)

**3. [Rule 3 - Test-tooling] Test 1 reads `getAttribute("style")` instead of `.style.background`**

- **Task:** Task 3
- **Root cause:** jsdom's CSSOM normalizes `hsla(H, S%, L%, A)` to `rgba(R, G, B, A)` when a style is read through `HTMLElement.style.<property>`. That's a lossy round-trip that hides the row's source-of-truth `hsla(${hue}, ...)` interpolation from downstream assertions.
- **Fix:** Read the raw `style` attribute string via `getAttribute("style")` — bypasses CSSOM parsing and preserves the interpolated `hsla(30, ...)` substring for `.toContain()` assertions.
- **Not a change to the row's behavior:** the DOM ships the hsla string exactly as authored; this is just how the test reads it back.
- **Files:** `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx`
- **Commit:** `06d8a93`

### Authentication gates

None — pure UI work, no backend calls, no auth-required paths touched.

### Package installs

None — Rule 3 package-legitimacy checkpoint N/A. Only imports from the
existing `lucide-react` + `react-i18next` deps already in package.json.

## Threat Model Compliance

Reviewed `<threat_model>` from the plan:

| Threat ID | Category | Disposition | Compliance |
|---|---|---|---|
| T-10-01-01 | className hue interpolation | accept | ✅ hue is number 0-360 from identity-store; no new attack surface |
| T-10-01-02 | swipe touch DoS | mitigate | ✅ no `e.preventDefault()` inside touch handlers; vertical-gesture bail-out at 12px yields to native scroll |
| T-10-01-03 | avatar image src | accept | ✅ `identity.avatarUrl` sourced from existing identities-store — same surface as ConversationRow.tsx |
| T-10-01-SC | npm install slopsquat | mitigate | ✅ zero new deps |

No new threat surface introduced beyond the four already documented.

## Handoff to Wave 2

**Wave 2 scope (from planner brief):** Build `PrettyConversationsPanel.tsx`
as a thin container that maps over `useConversations()` output, renders
`PrettyConversationRow` per row, and wires the `onSwipeOpenChange` +
`forceClosed` pair to a shared `currentlySwipedId` state.

**What Wave 2 does NOT need to build:**

- Identity resolution (already inside the row)
- Selected-row treatment (already inside the row)
- Pin action visuals (PinAction is imported and consumed by the row)
- Swipe state machine (fully contained in the row)
- RDP-row exclusion (already handled by `row.rdpHostRow` branch inside the row)

**What Wave 2 DOES need to build:**

- Panel scroller container with proper `overflow-y-auto` + top-of-scroller NewSessionButton mount site
- Per-row loop over `useConversations()` grouped structure (pinned + host groups + RDP sentinel group)
- HostGroup header render (semibold host name; special-case `hostId === "__rdp__"` to suppress header per NOTE-A from Phase 7)
- `currentlySwipedId` state + effect-free wiring to `onSwipeOpenChange` / `forceClosed`
- Panel-level effect: when the selected conversation changes, force all rows closed (Ashley: "changing conversations should snap any swiped row shut")
- Variant selection via `useIsMobile()` (width-based) — NOT via `useIsTouchDevice()`, because the row's mobile-variant swipe behavior wants to fire on narrow desktop windows too where the touch device may still be a laptop
- HostGroup separator styling from prototype.html / desktop.html — these are panel-owned, not row-owned

**What Wave 2 should NOT touch:**

- `src/ui/sidebar/*` (Wave 3+4 concern)
- `src/ui/AppShell.tsx` (Wave 3 mount-site swap)
- `src/ui/state/conversation-store.ts` (contract-locked by Phase 6)

## Verification checklist

- [x] tokens.ts, PinAction.tsx, PrettyConversationRow.tsx, PrettyConversationRow.test.tsx exist
- [x] `npx tsc --noEmit` — clean
- [x] `npx vitest run src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — 12/12 green
- [x] Grep confirms 6 occurrences of `hsla(${hue}` (interpolated) in PrettyConversationRow.tsx
- [x] Grep confirms zero `IdentityBadge` references in PrettyConversationRow.tsx (chip absent)
- [x] Grep confirms `variant === "mobile"` branch present
- [x] Zero touches to `src/ui/sidebar/*` (git diff HEAD~3..HEAD -- src/ui/sidebar/ = empty)
- [x] Zero touches to `src/ui/AppShell.tsx`
- [x] Zero new npm deps (package.json / package-lock.json untouched)

## Self-Check: PASSED
