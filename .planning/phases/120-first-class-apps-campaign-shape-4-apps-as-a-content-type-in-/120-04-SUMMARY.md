---
phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-
plan: 04
subsystem: ui
tags: [typescript, discriminated-union, tab-url, react]

# Dependency graph
requires:
  - phase: 90
    provides: Optional-field-with-JSDoc backward-compat discipline (sessionKind pattern)
  - phase: 97
    provides: TabSpec discriminated-union `?: never` marker pattern (relay variant)
  - phase: 119
    provides: (hostId, slug) app-tuple convention + APP_SLUG_RE grammar
provides:
  - TabType six-arm union with the new "app" arm
  - Tab.app?: { hostId: number; slug: string } optional field
  - isAppTab narrowing predicate exported from src/types/ui-types.ts
  - TabSpec seventh variant { protocol: "app"; hostId: string; slug: string }
  - parseTabParam recognition of app:<hostId>:<slug> URL-fragment grammar
  - encodeTabSpec branch for the app protocol (round-trip safe)
  - specForTab input widened with app?: { hostId; slug } + early branch
  - PROTOCOLS runtime array extended with "app"
affects: [120-06 (tabUtils dispatch + AppPane), 120-07 (AppShell wiring + URL round-trip)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Phase 97's `?: never` discriminated-union marker preserved symmetrically across a third variant
    - Phase 90's optional-field backward-compat discipline extended to `Tab.app`
    - hostId type-boundary cast (number in Tab.app, string in TabSpec.app — String()-cast at specForTab)

key-files:
  created: []
  modified:
    - src/types/ui-types.ts — TabType L157-163, Tab.app L232-247, isAppTab L249-259
    - src/ui/lib/tab-url.ts — TabSpec union L43-90, PROTOCOLS L114-122, parseTabParam L185-207, encodeTabSpec L239-247, specForTab input+branch L291-320

key-decisions:
  - "isAppTab lives adjacent to Tab shape in ui-types.ts (co-located with the type it narrows, per CONTEXT.md Claude's Discretion)"
  - "Existing TabSpec variants receive hostId?: never + slug?: never markers symmetrically so consumers reading spec.hostId / spec.slug narrow correctly under the new discriminant"
  - "parseTabParam's app branch mirrors the tmux two-argument grammar (both use single ':' delimiter; both wrap decodeURIComponent in try/catch for URIError fail-safe)"
  - "encodeTabSpec places the app branch AFTER relay and BEFORE the host-carrying fall-through — the never-marker would otherwise emit 'app:undefined'"
  - "specForTab casts Tab.app.hostId (number) to String() at the boundary; TabSpec.app.hostId is textual because URL fragments are textual"

patterns-established:
  - "Symmetric ?: never marker discipline across a three-way discriminated union (harness | relay | app)"

requirements-completed: [D-01, D-02, D-16]

# Metrics
duration: 3m 24s
completed: 2026-09-19
---

# Phase 120 Plan 04: TabType + TabSpec type-surface extension for app content type

**Six-arm TabType union with Tab.app tuple, isAppTab narrowing predicate, and a matching seventh TabSpec URL-fragment variant with symmetric `?: never` discriminated-union markers.**

## Performance

- **Duration:** 3m 24s
- **Started:** 2026-09-19T03:25:44Z
- **Completed:** 2026-09-19T03:29:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `TabType` from a five-arm union to a six-arm union with `"app"` (D-01)
- Added `Tab.app?: { hostId: number; slug: string }` optional field mirroring Phase 90's `sessionKind` backward-compat discipline (D-02)
- Exported `isAppTab(tab): tab is Tab & { app: {...} }` narrowing predicate co-located with the `Tab` shape it narrows
- Extended `TabSpec` from a two-variant to a three-variant discriminated union with the app variant carrying the (hostId, slug) tuple (D-16)
- Preserved the Phase-97 `?: never` marker discipline SYMMETRICALLY: added `hostId?: never; slug?: never` to both pre-existing variants; added `host?: never; session?: never; roomId?: never` to the new app variant
- Wired `parseTabParam`, `encodeTabSpec`, `specForTab`, and `PROTOCOLS` so the app tuple round-trips through the URL fragment (workspace-share + Chrome-tab-restore)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend TabType union + Tab shape + isAppTab predicate** — `c76fd02b` (feat)
2. **Task 2: Extend TabSpec union + parseTabParam + specForTab + encodeTabSpec + PROTOCOLS** — `1c136800` (feat)

## Files Created/Modified

- `src/types/ui-types.ts` — TabType six-arm union (L157-163), Tab.app optional field with JSDoc rationale (L232-247), `isAppTab` narrowing predicate (L249-259). +28 lines / -1 line.
- `src/ui/lib/tab-url.ts` — TabSpec three-way discriminated union with symmetric `?: never` markers (L43-90), PROTOCOLS extended (L114-122), parseTabParam app branch (L185-207), encodeTabSpec app branch (L239-247), specForTab input widening + early app branch (L291-320). +76 lines / -0 lines.

## Decisions Made

- **isAppTab placement:** Co-located with `Tab` in `ui-types.ts` (not in `tabUtils.tsx`) so downstream consumers can `import { isAppTab } from "@/types/ui-types"` without a shell dependency. Matches the pattern of pure type utilities living next to types.
- **Symmetric `?: never` marker sweep on existing variants:** The plan called this out explicitly (Task 2(a) — "extend the TWO EXISTING variants with matching `?: never` markers"). Without this, consumers reading `spec.hostId` or `spec.slug` in the app branch would not narrow correctly against the two pre-existing arms, breaking the exhaustive-narrowing invariant.
- **encodeTabSpec branch ordering:** Placed the app branch BETWEEN the relay branch and the host-carrying fall-through. Placing it after the fall-through would cause the never-marker to emit `app:undefined` (`spec.host` is `undefined`), breaking the URL round-trip — the plan's revision iteration 1 called this out as load-bearing.
- **Textual hostId at the URL boundary:** `Tab.app.hostId` is `number`; `TabSpec.app.hostId` is `string`. `specForTab` calls `String(input.app.hostId)` at the boundary. URL fragments are textual and Phase 119's `/apps/:hostId/:slug` REST endpoints already accept the stringified form (with `Number(req.params.hostId)` on the backend), so the boundary convention is consistent with the existing wire.

## Deviations from Plan

None — plan executed exactly as written. Every acceptance-criterion grep gate met the threshold or exceeded it:

- `grep -c '| "app"' src/types/ui-types.ts` = 1 (≥ 1 required)
- `grep -c 'app?: { hostId: number; slug: string }' src/types/ui-types.ts` = 1 (exactly 1 required)
- `grep -c 'export function isAppTab' src/types/ui-types.ts` = 1 (exactly 1 required)
- `grep -c 'tab is Tab & { app: { hostId: number; slug: string } }' src/types/ui-types.ts` = 1 (exactly 1 required)
- `grep -cE 'Phase 120 D-01|Phase 120 D-02' src/types/ui-types.ts` = 3 (≥ 2 required)
- `grep -c 'protocol: "app"' src/ui/lib/tab-url.ts` = 4 (≥ 3 required)
- `grep -c 'Phase 120' src/ui/lib/tab-url.ts` = 7 (≥ 1 required)
- `grep -c '"app"' src/ui/lib/tab-url.ts` = 11 (≥ 4 required)
- `grep -c 'hostId?: never' src/ui/lib/tab-url.ts` = 2 (≥ 2 required)
- `grep -c 'slug?: never' src/ui/lib/tab-url.ts` = 2 (≥ 2 required)
- `grep -c 'host?: never' src/ui/lib/tab-url.ts` = 4 (existing 2 + new app variant + comment)
- `grep -c 'session?: never' src/ui/lib/tab-url.ts` = 3 (existing 2 + new app variant marker)
- `grep -c 'roomId?: never' src/ui/lib/tab-url.ts` = 3 (existing 2 + new app variant marker)
- `grep -c 'spec.protocol === "app"' src/ui/lib/tab-url.ts` = 1 (≥ 1 required)
- `grep -c 'app?: { hostId: number; slug: string }' src/ui/lib/tab-url.ts` = 1 (≥ 1 required)

## Residual tsc Errors

**None.** `SKYNET_COOKIE_DOMAIN=https://skynet.test npx tsc --noEmit -p tsconfig.json` exits 0 across the whole composite build (client `tsconfig.app.json` + backend `tsconfig.node.json`). No `switch(tab.type)` sites surfaced exhaustive-check errors — the existing switches in `tabUtils.tsx` and elsewhere all use `default` cases, so the six-arm extension propagates cleanly. Plans 06 and 07 will convert the dispatch to `Record<TabType, ...>` for compile-time exhaustiveness per D-03/D-04.

## Scoped Tests

`npx vitest related --run src/types/ui-types.ts src/ui/lib/tab-url.ts` → **14 test files / 349 tests / all passing** (22.25s). Existing URL-fragment tests (workspace round-trip + Phase 97 relay variant) continue to pass without modification, confirming the discriminated-union extension is fully backward-compatible.

## Issues Encountered

None.

## isAppTab Import Path Confirmation

`isAppTab` is exported from `src/types/ui-types.ts` and importable from anywhere in `src/ui/` via the existing path alias:

```typescript
import { isAppTab } from "@/types/ui-types";
```

Plan 06's `tabUtils.tsx` will consume it inside `renderAppTab` for the defensive-narrowing guard before accessing `tab.app.hostId` / `tab.app.slug`.

## Next Phase Readiness

- **Plan 05 (backend proxy + CSRF middleware):** Independent — no dependency on this plan's type surface.
- **Plan 06 (tabUtils dispatch refactor + AppPane):** UNBLOCKED. `TabType`, `Tab`, and `isAppTab` are available; the `Record<TabType, Renderer>` refactor per D-04 will now compile-time-exhaust six arms including `app`.
- **Plan 07 (AppShell wiring + URL fragment):** UNBLOCKED. `TabSpec.app`, `parseTabParam("app:...")`, `specForTab({ type: "app", app: {...} })`, and `encodeTabSpec` are all wired for the URL round-trip. Plan 07 owns the AppShell callsite + a URL-fragment round-trip integration test.

## Self-Check: PASSED

- `[ -f src/types/ui-types.ts ]` → FOUND
- `[ -f src/ui/lib/tab-url.ts ]` → FOUND
- `git log --all | grep c76fd02b` → FOUND (Task 1)
- `git log --all | grep 1c136800` → FOUND (Task 2)

---
*Phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-*
*Completed: 2026-09-19*
