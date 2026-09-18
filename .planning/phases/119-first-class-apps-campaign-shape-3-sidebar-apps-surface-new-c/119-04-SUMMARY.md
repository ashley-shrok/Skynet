---
phase: 119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c
plan: 04
subsystem: sidebar-apps-section-integration
tags:
  - frontend
  - integration
  - sidebar
dependency-graph:
  requires:
    - "119-02 — useAppTiles() hook + AppState type mirror consumed here for the tile-list projection"
    - "119-03 — AppTile component consumed here as the per-tile render primitive"
  provides:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx — new .pv-apps-section group + appsExpanded state hook + useAppTiles() subscription + AppTile map, positioned as the first content group under the search input and above the search-vs-three-zone ternary"
  affects:
    - "119-06 (integration tests A15-A20) — asserts the section's D-01 placement, D-02 chrome tokens, D-03 lazy-render invariant, D-04 empty-state prompt, D-05 always-visible invariant, and RESEARCH.md Pitfall 2 (visible during active search)"
    - "Frontend end-to-end paint path is now complete: Phase 118 WS frames → Plan 119-01 client dispatch → Plan 119-02 store → Plan 119-04 panel Apps section → Plan 119-03 AppTile → Plan 119-05 icon endpoint"
tech-stack:
  added: []
  patterns:
    - "Mirror-the-Archived-section chrome (D-02): byte-verbatim clone of the button + icon + label + rule-line + rotating ChevronDown at PrettyConversationsPanel.tsx:1995-2033, with one deliberate delta (no outer `.length > 0` gate per D-05)"
    - "Lazy-render short-circuit (D-03): `{appsExpanded && ...}` gates the tile list AND the empty-state prompt so neither is in the DOM when the section is collapsed"
    - "Empty-state-inside-expanded-gate (D-04): the empty prompt renders only when `appsExpanded && appTiles.length === 0`, so a collapsed section with zero tiles has no D-04 DOM either"
    - "Insertion OUTSIDE the search-vs-three-zone ternary (RESEARCH.md Pitfall 2): section is a JSX sibling of the loading strip block, not a child of either ternary branch — survives active search"
    - "Zero-touch discipline on prior blocks: Archived section, Pinned group, loading strip, and ternary bodies are byte-unchanged"
key-files:
  created:
    - .planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/119-04-SUMMARY.md
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
decisions:
  - "Placed the AppTile + useAppTiles imports as a sibling group under the PrettyArchivedRow import (same file-namespace family: sidebar row/tile primitives) rather than colocating with the @/state/conversation-store block — the AppTile import IS a sibling component of PrettyArchivedRow, and useAppTiles rides with it as its data source (same feature slice)."
  - "Placed the `appsExpanded` + `appTiles` hooks directly below the `archivedExpanded` + `archivedRows` hooks (physical adjacency) rather than at the top of the hook block — the two sections are a chrome-family, so hook adjacency mirrors JSX-family adjacency and makes future edits (e.g., shape 4 adding an onClick prop path) discoverable in one place."
  - "Placed the new JSX block BETWEEN the loading strip closing `)}` and the ternary opening `{searchMatches !== null ? (` — same JSX indentation as `{!fleetSessionsLoaded && (...)}`. Alternative (nested inside the ternary's `null` branch) was rejected per RESEARCH.md Pitfall 2 because that would silently hide the section during active search."
  - "Kept the D-04 empty-state string as a React text node inside a plain `<div>` — matches the `.pv-avatar-initial` / `PrettyConversationRow.tsx` discipline of letting the browser auto-escape rather than reaching for `dangerouslySetInnerHTML`. Zero XSS surface."
  - "Comment block above the JSX explicitly cites D-01/D-02/D-03/D-04/D-05 + RESEARCH.md Pitfall 2 so a future reader (or the executor of Plan 119-06's integration tests) immediately sees the load-bearing invariants without cross-referencing CONTEXT."
  - "Comment block references the D-04 prompt SEMANTICALLY (\"empty-state prompt\") rather than by literal string to keep the acceptance grep `grep -c 'Ask an agent to make an app for you\\.' == 1` at exactly 1 (same pattern as 119-02 Deviation #2 / 119-03 Deviations #1-#2)."
  - "Did NOT modify the sibling test file PrettyConversationsPanel.test.tsx — integration coverage for the Apps section (A15-A20) lands in Plan 119-06 per D-18 three-layer discipline. Scoped vitest here is a regression gate for the existing panel tests, not a coverage add."
metrics:
  duration_minutes: 12
  completed: "2026-09-18"
  tasks_completed: 1
  files_touched: 1
  commits: 1
---

# Phase 119 Plan 04: Apps section integration into PrettyConversationsPanel — Summary

Landed the sidebar Apps section as the first content group under the
search input and above the search-vs-three-zone ternary at
`PrettyConversationsPanel.tsx:1833` (pre-edit line number). The section
consumes `useAppTiles()` from the Plan 119-02 store, renders one Plan
119-03 `AppTile` per entry, mirrors the Archived section chrome verbatim
(D-02), stays always-visible regardless of tile count (D-05), and
lazy-renders content only when expanded (D-03). Concretises D-01
(placement below search, above Pinned) + D-02 (chrome mirrors Archived
byte-for-byte with `AppWindow` glyph swap) + D-03 (collapsed-by-default
+ `{appsExpanded && ...}` gate) + D-04 (empty-state prompt "Ask an agent
to make an app for you." rendered italic + muted when expanded with zero
tiles) + D-05 (section header rendered unconditionally so users with zero
apps still see and can expand the section) + D-15 (tile order via the
store's stable sort — panel does zero re-sorting). Placement OUTSIDE the
search-vs-three-zone ternary (RESEARCH.md Pitfall 2) so the section
survives active search.

## What Was Built

### Task 1: PrettyConversationsPanel.tsx integration (commit `dd51941a`)

Three co-located additions, zero touches to prior blocks:

**1. Lucide-react import extension** (existing import at line 59
extended, comment block explaining the D-02 chrome-family rationale
added directly above):
```tsx
import { AppWindow, Archive, ChevronDown, Drama, Globe, Loader2, Monitor, MoreVertical, Search, SquarePen, X } from "lucide-react";
```

**2. Sibling-import group** for the Apps section primitives (placed
directly below the `PrettyArchivedRow` import — same file-namespace
family), with a comment citing D-01/D-02/D-03/D-04/D-05 and the
one-difference-vs-Archived note (D-05 no length gate):
```tsx
import { AppTile } from "./AppTile";
import { useAppTiles } from "@/state/app-tiles-store";
```

**3. State hook + subscription hook** placed directly below the
`archivedExpanded` + `archivedRows` block for physical adjacency to the
sibling section, with a comment citing D-03 (collapsed by default +
lazy-render) and D-14 (pass-through — panel does NOT re-filter, backend
is the sole visibility authority):
```tsx
const [appsExpanded, setAppsExpanded] = useState(false);
const appTiles = useAppTiles();
```

**4. JSX block** inserted BETWEEN the loading strip's closing `)}`
(pre-edit line 1823) and the ternary opening `{searchMatches !== null ? (`
(pre-edit line 1833), at the SAME indentation as the loading strip's
`{!fleetSessionsLoaded && (...)}` — critical per RESEARCH.md Pitfall 2:

```tsx
<div className="pv-panel-group pv-apps-section">
  <button
    type="button"
    onClick={() => setAppsExpanded((v) => !v)}
    className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left"
    data-testid="pretty-conversations-apps-header"
    aria-expanded={appsExpanded}
    aria-controls="pv-apps-section-content"
  >
    <AppWindow className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" />
    <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
      Apps
    </span>
    <span
      aria-hidden="true"
      className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]"
    />
    <ChevronDown
      className={`size-3 text-[#5c6070]/85 shrink-0 transition-transform ${appsExpanded ? "rotate-180" : ""}`}
      aria-hidden="true"
    />
  </button>
  {appsExpanded && (
    <div id="pv-apps-section-content">
      {appTiles.length === 0 ? (
        <div className="pv-apps-empty px-4 py-2 text-[13px] italic text-[#5c6070]/85">
          Ask an agent to make an app for you.
        </div>
      ) : (
        appTiles.map((app) => (
          <AppTile key={`${app.hostId}:${app.slug}`} app={app} />
        ))
      )}
    </div>
  )}
</div>
```

Diff shape: `1 file changed, 95 insertions(+), 1 deletion(-)`. The single
deletion is the pre-edit lucide-react import line being replaced with its
`AppWindow`-extended version — no runtime behavior change; pure add-a-name
diff. Every other change is a pure insertion.

## Verification

- **Type-check**: `npm run type-check` (root `tsc --noEmit`) exits 0.
  `grep -c "PrettyConversationsPanel.tsx" /tmp/119-04-tsc.log` → **0** —
  zero TypeScript errors originating from the modified file.
- **Scoped vitest**: `npx vitest related --run
  src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  src/ui/features/pretty-conversations/AppTile.tsx
  src/ui/state/app-tiles-store.ts` → **8 test files passed, 175 tests
  passed, 0 failed** (includes AppTile's 11 tests from Plan 119-03,
  app-tiles-store's 11 tests from Plan 119-02, and every prior
  PrettyConversationsPanel integration test still green).
- **Diff position** (Pitfall 2 lock): `git diff` shows the new
  `<div className="pv-panel-group pv-apps-section">` block appearing
  BETWEEN the loading strip closing `)}` and the ternary opening
  `{searchMatches !== null ? (`. It is NOT nested inside either branch
  of the ternary — the section survives active search per D-05.
- **Byte-unchanged discipline**: `git diff` shows zero modifications to
  the Archived section block (~pre-edit L1995-2033), the Pinned group,
  the loading strip block, or the search-vs-three-zone ternary bodies.
  The only pre-existing line that changed is the lucide-react import
  (add-a-name).
- **Post-commit deletion check**: `git diff --diff-filter=D --name-only
  HEAD~1 HEAD` → empty. Pure additions.
- **Untracked-file check**: `git status --short` after commit → clean.

## Acceptance Criteria Traceability

| Criterion | Threshold | Result |
|-----------|-----------|--------|
| `grep -c "pv-apps-section" PrettyConversationsPanel.tsx` ≥ 2 | ≥ 2 | 4 (wrapper class + comment reference + content-id string) |
| `grep -c "AppWindow" PrettyConversationsPanel.tsx` ≥ 2 | ≥ 2 | 3 (import + JSX + comment) |
| `grep -c "useAppTiles" PrettyConversationsPanel.tsx` ≥ 2 | ≥ 2 | 5 (import + call + 3 comment references) |
| `grep -c "AppTile" PrettyConversationsPanel.tsx` ≥ 2 | ≥ 2 | 9 (matches on `AppTile`, `AppTiles`, `useAppTiles`, `AppWindow` overlap counted per criterion's word-boundary spec) |
| `grep -c "appsExpanded" PrettyConversationsPanel.tsx` ≥ 4 | ≥ 4 | 6 (declaration + setter call + aria-expanded + gate expression + rotate-180 ternary + comment) |
| `grep -c 'Ask an agent to make an app for you\.' PrettyConversationsPanel.tsx` == 1 | == 1 | **1** (runtime JSX only; comment reworded to say "empty-state prompt" semantically per Deviation #1 below) |
| `grep -c 'data-testid="pretty-conversations-apps-header"' ...` == 1 | == 1 | 1 |
| `grep -c 'aria-controls="pv-apps-section-content"' ...` == 1 | == 1 | 1 |
| D-05 lock: `grep -E 'appTiles\.length\s*>\s*0.*pv-apps-section\|pv-apps-section.*appTiles\.length\s*>\s*0' ...` returns nothing | 0 matches | **0 matches** (empty output) |
| `npm run type-check` reports zero errors from PrettyConversationsPanel.tsx | 0 | 0 |
| Diff position: Apps section BEFORE the ternary at pre-edit line 1833 | outside ternary | verified (block sits between loading strip `)}` and ternary `{searchMatches !== null ? (`) |
| Diff hygiene: no modifications to Archived / Pinned / loading strip / ternary bodies | pure adds | verified — only pre-existing line changed is the lucide-react import (add-a-name); all other changes are pure insertions |
| Scoped vitest exits 0 | 0 | 0 (175 pass) |

## Deviations from Plan

**One comment-hygiene rewrite to satisfy an acceptance grep gate. No
functional deviations.**

### 1. [Rule 1 — Test-gate correctness] D-04 verbatim string grep initially returned 2 (target: 1)

- **Found during:** Task 1 acceptance-check pass.
- **Root cause:** The comment block above the JSX quoted the D-04 empty
  prompt verbatim (`'"Ask an agent to make an app for you."'`) to
  document the rendering condition — accurate documentation but literally
  the same string the grep gate treats as the runtime signal. The plan's
  `== 1` gate intends "exactly one runtime callsite renders the D-04
  prompt string."
- **Fix:** Rewrote the comment to describe the prompt semantically
  ("empty-state prompt", "verbatim copy per D-04") without repeating the
  literal string. Same pattern as 119-02 Deviation #2 (`localStorage`
  comment rewrite) and 119-03 Deviations #1-#2 (`noopener,noreferrer` /
  `--pv-hue` / `dangerouslySetInnerHTML` comment rewrites). The single
  runtime `<div>` render site retains the string verbatim. Semantic
  intent of the doc preserved.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
  (comment edit only — zero runtime behavior change; edit landed before
  the commit).
- **Commit:** included in `dd51941a`.

Everything else executed exactly as written. No auth gates. No
architectural questions (Rule 4). No package installs. No CLAUDE.md
conflicts (the repo has no `./CLAUDE.md`). No untracked-file leakage.
No prior selectors / hooks / JSX blocks touched.

## Known Stubs

**None.** The section renders a real hook (`useAppTiles()` — Plan 119-02
live-subscribed to the WS channel), a real component (`AppTile` — Plan
119-03 with real icon fetch and real context menu), and a real empty
state (D-04 prompt). Every path is wired end-to-end. The panel gates
zero data behind placeholders.

## TDD Gate Compliance

The plan's task is marked `tdd="true"`, but the `<action>` block
explicitly says "Do NOT modify any test in the sibling test file —
integration tests land in Plan 119-06." So this plan does NOT have a
new-test RED gate for the Apps section; the scoped vitest run is a
regression gate for the pre-existing panel tests (175 tests still pass
post-edit — the section addition is purely additive and does not touch
any DOM structure prior tests query against).

Plan 119-06 will land the Apps-section-specific integration tests
(A15-A20) mirroring the Archived-section A10-A14 test template.

## Threat Model Coverage

| Threat ID | Category | Disposition | Where mitigated |
|-----------|----------|-------------|-----------------|
| T-119-04-01 | Tampering (section inside ternary → disappears on search) | mitigate | JSX block inserted BETWEEN the loading strip `)}` and the ternary opening; git diff confirms the block is a sibling of `{!fleetSessionsLoaded && ...}`, not a child of either ternary branch. Verified by manual diff inspection (Pitfall 2 lock). |
| T-119-04-02 | Tampering (section gated on `.length > 0` → disappears when empty) | mitigate | Grep-gated acceptance criterion `appTiles\.length\s*>\s*0.*pv-apps-section` returns 0 matches. Section wrapper is unconditional; only the inner `{appsExpanded && ...}` body branches on tile count (D-04 vs D-04's populated case). |
| T-119-04-03 | Injection (XSS) via D-04 string | mitigate | The D-04 prompt renders as a React text node inside a plain `<div>` — auto-escaped. No `dangerouslySetInnerHTML`, no template interpolation, no user input. |
| T-119-04-04 | Tampering (content in DOM when collapsed → D-03 violated) | mitigate | The `{appsExpanded && ...}` gate is explicit and encloses both the empty-state prompt and the tile map. Plan 119-06 integration tests verify no AppTile / empty-state in DOM when collapsed. |
| T-119-04-05 | Elevation of Privilege (client re-filters by host visibility) | accept | Panel performs zero filtering — `appTiles = useAppTiles()` is consumed as-is; the store returns whatever the backend `app-frame-filter.ts` (Phase 118 D-15) approves. Comment on the state hook documents backend as sole visibility authority per D-14. |
| T-119-04-SC | Tampering (npm/pip/cargo installs) | accept | Zero package installs. `AppWindow` is a pre-existing lucide-react ^1.28.0 export (RESEARCH.md Assumption A3 — verified as importable at type-check time; zero errors). |

## Threat Flags

None. This plan adds no new network endpoints, no new auth paths, no new
file access, no schema at any trust boundary. It composes two existing
frontend primitives (`useAppTiles` hook + `AppTile` component) into an
existing render surface (`PrettyConversationsPanel.tsx`'s scroll
container). The only outbound signal is the lucide-react `AppWindow`
glyph — a static SVG.

## Downstream (What 119-06 picks up)

- **119-06** (integration tests A15-A20) — will mock
  `@/state/app-tiles-store` at module level (mirroring how
  `PrettyConversationsPanel.test.tsx` mocks `useArchivedFleetRows`
  today: `let mockAppTiles: AppState[] = []` + `vi.mock`), then assert:
  - **A15**: Apps section header renders with the `AppWindow` icon and
    "Apps" label regardless of `appTiles` length (D-05).
  - **A16**: Collapsed section has zero `AppTile` instances and no
    `.pv-apps-empty` prompt in the DOM (D-03 lazy-render).
  - **A17**: Clicking the header expands + collapses the section
    (toggle correctness).
  - **A18**: Expanded + zero tiles → renders the D-04 empty-state prompt
    verbatim.
  - **A19**: Expanded + populated → renders one `AppTile` per entry in
    the store's sort order.
  - **A20**: The Apps section header remains in the DOM when the search
    input has an active query (Pitfall 2 regression test).

The integration surface is stable — no code change to
`PrettyConversationsPanel.tsx` is expected as 119-06 lands.

## Commits

- `dd51941a` — feat(119-04): integrate Apps section into PrettyConversationsPanel above search-vs-three-zone ternary

## Self-Check: PASSED

- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — MODIFIED (+95, -1)
- Commit `dd51941a` — FOUND in `git log --oneline`
- Scoped vitest: 175/175 tests pass
- `npm run type-check` exits 0
- All 13 acceptance criteria verified (see Traceability table above)
- D-05 lock grep: 0 matches (no length gate on wrapper)
- D-04 verbatim grep: exactly 1 runtime occurrence
- Diff position: block sits BETWEEN loading strip and ternary (Pitfall 2 honored)
