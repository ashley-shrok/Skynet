---
quick_id: 260727-gm3
type: summary
completed: 2026-07-27
autonomous: true
tasks_completed: 2
tests_added:
  - "Test 30f (conversation-store): removeFromActiveSet no-op on absent id"
  - "Test 30g (conversation-store): removeFromActiveSet removes + writes storage + notifies once"
  - "Test 30h (conversation-store): add → remove → add round-trip smoke"
  - "Test 30i (conversation-store): removeFromActiveSet leaves selectedId untouched"
  - "Test 20A (PrettyConversationsPanel): desktop active-set row renders deactivate-action inside .pv-meta BEFORE pin-action"
  - "Test 20B (PrettyConversationsPanel): desktop ambient row renders NO deactivate-action"
  - "Test 20C (PrettyConversationsPanel): desktop RDP row suppresses deactivate-action even when id is in mockActiveSet"
  - "Test 20D (PrettyConversationsPanel): mobile active-set strip has BOTH pin + deactivate; ambient mobile strip has ONLY pin"
  - "Test 20E (PrettyConversationsPanel): clicking deactivate fires removeFromActiveSet(row.id) + onDeactivateRow(row); onSelect NOT fired"
files_created:
  - src/ui/features/pretty-conversations/DeactivateAction.tsx
files_modified:
  - src/ui/state/conversation-store.ts
  - src/ui/state/conversation-store.test.ts
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
  - src/ui/features/pretty-conversations/tokens.ts
  - src/ui/AppShell.tsx
  - src/ui/locales/en.json
commits:
  - "1be8f35: feat(pretty-conversations): removeFromActiveSet + DeactivateAction component (quick-260727-gm3 Task 1)"
  - "8c1bd65: feat(pretty-conversations): row + panel + AppShell deactivate wiring (quick-260727-gm3 Task 2)"
metrics:
  duration: ~15min
  tests_passing: 619 / 619
  tsc_clean: true
---

# Quick Task 260727-gm3: Wire Deactivate Conversation Action Summary

One-liner: End-to-end wire of Ashley's deactivate-preview.js console snippet — active-set rows grow a red-tinted X glyph (desktop hover-reveal / mobile widened swipe strip); click removes id from activeSet AND closes the tab; row recedes to ambient. Agent keeps running under the hood.

## What shipped

### Task 1 — Store mutator + DeactivateAction component + CSS + widened swipe strip

- **`removeFromActiveSet(id)`** in `conversation-store.ts`: mirrors `addToActiveSet` shape verbatim — idempotent no-op when absent, silent try/catch on sessionStorage, new Set reference + notify on real removal. Deliberately does NOT touch `state.selectedId` (deactivation is orthogonal to selection at the store layer).
- **Comment updates**: header at L107-114 and JSDoc at L162-167 now reflect "add + remove APIs" (pre-gm3 lock "no remove API by design" retired). Test file `beforeEach` comment (L69-72) mirrors.
- **`DeactivateAction.tsx`**: dumb visual mirroring PinAction — bare lucide `X` icon, `data-size` attr, `data-testid="deactivate-action"` default, red-tinted palette (hue=4 red-orange). Drops PinAction's `pinned` toggle (no toggled state) and identity `--pv-hue` in favor of a fixed red palette. i18n key `nav.conversations.deactivate` with `defaultValue: "Deactivate"`.
- **`tokens.ts`**: `PC_SWIPE_REVEAL` 88 → 132 so mobile swipe strip fits both pin + deactivate side-by-side. All three call sites (row body `baseDxRef`, touch clamp, `targetDx`) pick up the new value automatically via the shared import.
- **CSS**: `.pv-deactivate-action` base + hover + focus-visible + mobile size variant + desktop hover-reveal (gated on `.active-set`) + ambient/RDP defense-in-depth safety nets. Palette rationale documented inline: red tuned to hue=4 to sit adjacent to pin's identity-hue without clashing; bare icon + drop-shadow, NOT a red pill.
- **`en.json`**: added `nav.conversations.deactivate: "Deactivate"`.
- **Tests 30f/30g/30h/30i**: no-op / real-remove / round-trip / selectedId-untouched. All following the byte-lockstep pattern of existing pin/active-set tests.

### Task 2 — Row + Panel + AppShell wiring

- **`PrettyConversationRow`**: new `onDeactivate` prop + `onDeactivateClick` handler mirroring the pin's stopPropagation discipline. Mobile swipe strip (inside `isMobile && !isRdp`) now conditionally renders `<DeactivateAction />` after `<PinAction />` when `inActiveSet === true`; both children live in a flex container (`gap-3`) inside the widened 132px strip. Desktop `.pv-meta` block: `<DeactivateAction />` renders BEFORE `<PinAction />` when `!isMobile && !isRdp && inActiveSet === true`, matching Ashley's preview layout (X on left, pin on right in meta column).
- **`PrettyConversationsPanel`**: imported `removeFromActiveSet`. Added `handleRowDeactivate(row)` that composes `removeFromActiveSet(row.id)` + `onDeactivateRow(row)`. Extended `PrettyConversationRowLive` props with optional `onDeactivate` pass-through. Wired `onDeactivate={() => handleRowDeactivate(row)}` at three render sites: active-set group, pinned group, non-RDP grouped block. RDP sentinel deliberately omits it.
- **`PrettyConversationsPanel` prop**: new required `onDeactivateRow: (row: ConversationRowShape) => void`. Making it required forces every call site (production + tests) to explicitly wire the tab-close side.
- **`AppShell`**: `onDeactivateRow={(row) => closeTab(row.id)}` at the `PrettyConversationsPanel` mount site. Reuses the existing L1169 `closeTab` function verbatim — no new tab-close path invented; confirm-tab-close toast branch preserved.
- **Test suite**: added `removeFromActiveSetSpy` + mutable `mockActiveSet` so Tests 20A/20C/20D can override which ids appear active per-test. Tests 20A-20E cover the render gates + click behavior. Updated all 20+ existing `<PrettyConversationsPanel …>` mount sites in the test file to pass the new required `onDeactivateRow` prop.

## Deviations from Plan

None — plan executed exactly as written.

The plan's action prose for Test 20E called out "Clear the `addToActiveSetSpy`'s mount-time invocation from the panel's useEffect on `[selectedId]`; we care only about the click-driven calls to removeFromActiveSet + onDeactivateRow below." I followed that pattern verbatim — `removeFromActiveSetSpy.mockClear()` + `selectConversationSpy.mockClear()` + `onConversationSelected.mockClear()` before the click. Not a deviation, just noting the plan's specificity flowed through the implementation exactly.

## Truths verified

- Clicking Deactivate on an active-set row calls `removeFromActiveSet(id)` AND closes its tab (Test 20E asserts both); the row recedes to ambient (CSS `.pv-row:not(.active-set)` treatment).
- Ambient (non-active-set) rows never render a `DeactivateAction` (Test 20B); RDP rows never render a `DeactivateAction` (Test 20C).
- Desktop active-set rows show `DeactivateAction` inside `.pv-meta`, positioned BEFORE `PinAction` (Test 20A `compareDocumentPosition` assertion); hidden until row is hovered/focus-within (CSS `.pv-row.pv-row--desktop.active-set:not(:hover):not(:focus-within) .pv-deactivate-action { display: none }`).
- Mobile active-set non-RDP rows expose BOTH `PinAction` and `DeactivateAction` inside the swipe-reveal strip; ambient mobile rows expose only `PinAction` (Test 20D).
- `removeFromActiveSet(id)` is idempotent (Test 30f), updates sessionStorage under `ACTIVE_SET_STORAGE_KEY` (Test 30g), and notifies subscribers once (Test 30g).
- `PC_SWIPE_REVEAL` widens to 132; the three call sites (row body swipe transform + strip anchor + touch clamp) pick it up automatically because they all import the same constant.
- `state.selectedId` untouched by `removeFromActiveSet` (Test 30i).

## Verification

- `./node_modules/.bin/vitest run` → **619 / 619 tests passing** (up from 610 pre-gm3: +4 store tests 30f/g/h/i, +5 panel tests 20A-E).
- `./node_modules/.bin/tsc --noEmit` → **clean** (0 errors).
- Manual sanity (Ashley UAT — gated for ship): open the app, click any ambient row → row lights up in active-set treatment + tab opens. Hover the row on desktop → X icon appears alongside pin. Click X → row recedes to ambient, tab closes, agent process continues running server-side. On mobile: swipe row left → both pin and X icons appear in the widened 132px strip.

## Out of scope (intentional)

- **Ghost-through-row-body fix**: the plan's `constraints` section explicitly noted this lives in a follow-up bounty; nothing in this quick task touches the row-body pointer-events behavior.
- **Locale files other than en.json**: `nav.conversations.deactivate` added only to `en.json`; `defaultValue: "Deactivate"` in the `useTranslation` call is the fallback for other locales until translations sync.
- **DeactivateAction.test.tsx**: no separate component-level test file — behavior covered via the panel tests (Tests 20A-20E). PinAction has none either; consistent with the shape lock.
- **AppShell.tsx tests / tokens.ts tests**: none touched — the plan explicitly scoped these out.

## Commits

- `1be8f35` — feat(pretty-conversations): removeFromActiveSet + DeactivateAction component (quick-260727-gm3 Task 1)
- `8c1bd65` — feat(pretty-conversations): row + panel + AppShell deactivate wiring (quick-260727-gm3 Task 2)

## Self-Check: PASSED

- `src/ui/features/pretty-conversations/DeactivateAction.tsx` → FOUND
- `src/ui/state/conversation-store.ts` (removeFromActiveSet export) → FOUND
- Commit `1be8f35` → FOUND on branch `feat/tab-title-from-tmux`
- Commit `8c1bd65` → FOUND on branch `feat/tab-title-from-tmux`
- Full test sweep + tsc clean confirmed pre-commit for both tasks.
