---
phase: 115-identity-archiving-from-the-frontend
plan: 02
subsystem: backend + frontend (pan-repo retirement)
tags: [phase-107-retirement, hidden-code-path, sentinel, D-21, pre-115-06-cleanup]

# Dependency graph
requires:
  - phase: 115
    plan: 01
    provides: "ALLOWED_REL_PATHS gate now REFUSES `.hidden` — any lingering caller would 400 at the primitive gate rather than silently succeed"
  - phase: 107
    provides: "the whole `.hidden` code path this plan retires (Phase 107's frontend hide affordance + backend fanout)"
provides:
  - "Zero production references to `.hidden`, `hiddenIds`, `hideConversation`, `unhideConversation`, `putHiddenIds`, `getHiddenIds`, `deriveDiskHiddenIds`, `hydrateHiddenIdsFromServer`, `hiddenConversationIds` in `src/`"
  - "`SweepIdentityLine` without `hidden` field (B9 wire slot vacated — 115-05 reuses it for `archived`)"
  - "`publicIdentity()` without `hidden` field on returned object or 7th arg"
  - "`IdentityAppearance` / `ResolvedIdentityAppearance` schemas without `hidden`"
  - "`Identity` frontend type without `hidden?: boolean` field"
  - "`APPEARANCE_CACHE_KEY` bumped v1 → v2 so any localStorage records that carry the retired `hidden` field are invalidated on cold boot"
  - "Between this plan and 115-06 landing, the sidebar row + identity badge context menus no longer offer Hide — an intentional temporary regression that closes once 115-06 lands the Archive affordance"
affects: [115-05, 115-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wholesale-retirement-with-historical-comment: retired symbols leave a single retirement note at each former site so a future reader (or a grep sweep) sees the intent, not a silent absence. Applies verbatim to future sentinel retirements."
    - "Test-block retirement pattern: prior Phase 107 describe blocks (STORE-107, PANEL-107, AFF-107, SEL-107, HID-107, Hidden section, Hide/Show wiring) are DELETED wholesale — not commented out. A single trailing comment marks the retirement so the grep-verifier sees which coverage vacated."
    - "Cache-key version bump on schema retirement (APPEARANCE_CACHE_KEY v1 → v2): a one-line change that invalidates every user's localStorage cache on the next cold boot. Preferred over a per-field migration for one deprecated axis."

key-files:
  created: []
  modified:
    - "src/backend/database/routes/identities.ts (publicIdentity 7th `hidden` arg + disk-fanout `.hidden` probe + return-field removal)"
    - "src/backend/database/routes/user-preferences.ts (HIDDEN_CONVERSATION_IDS_MAX_LENGTH const + validation block + full HIDDEN FANOUT block + response-echo removal + OpenAPI schema)"
    - "src/backend/database/routes/identities.disk-read.test.ts (PUB-107-* + HID-107-* describe blocks removed; PUB-92-04..06 probe counts adjusted 6→3 / 4→2 to reflect .pinned-only fanout)"
    - "src/backend/database/routes/user-preferences.test.ts (HID-107-GET / HID-107-PUT / HID-107-DB / SAVE-107 blocks removed; Row type + mock DB shape trimmed of hiddenConversationIds; SAVE-3 validation-trigger swapped hidden → pinned)"
    - "src/backend/fleet-status/sweep-schema.ts (`hidden?: boolean` on SweepIdentityLine + B9 parity entry + B9 union type)"
    - "src/backend/fleet-status/sweep-schema.test.ts (B9 in EXPECTED_KEYS + mid-distribution fixture `hidden` assertions)"
    - "src/backend/fleet-status/ssh-poll-orchestrator.ts (`hidden` in appearanceFromIdentityLine hasAnyAppearanceKey guard + resolver call + fingerprint segment)"
    - "src/backend/fleet-status/ssh-poll-orchestrator.test.ts (Case 1 desc + Case 6/6b assertions + field-changes parametrized entry + hidden fixture defaults)"
    - "src/backend/fleet-status/identity-appearance.ts (`hidden: boolean` on ResolvedIdentityAppearance + resolver arg + return-field)"
    - "src/backend/fleet-status/identity-appearance.test.ts (`describe pinned and hidden` collapsed to `describe pinned`, complete-shape assertion trimmed)"
    - "src/backend/fleet-status/wire-protocol.ts (`hidden: z.boolean()` in IdentityAppearanceSchema + docstring)"
    - "src/backend/fleet-status/wire-protocol.test.ts (validAppearance fixture `hidden: false` removed)"
    - "src/ui/api/user-preferences-api.ts (putHiddenIds export + Phase 107 comment block)"
    - "src/ui/api/user-preferences-api.test.ts (API-107-01..04 describe block replaced with retirement-verification test)"
    - "src/ui/api/identities-api.ts (`hidden?: boolean` on Identity type)"
    - "src/ui/state/identities-store.ts (hydrateHiddenIdsFromServer import + deriveDiskHiddenIds function + `hidden` in mergeIdentityAppearance / readAppearanceCache / writeAppearanceCache / patchIdentityFlag; reprojectDiskPinHideIntoRows renamed reprojectDiskPinIntoRows; APPEARANCE_CACHE_KEY bumped v1→v2)"
    - "src/ui/state/identities-store.enrichment.test.ts (SEL-107 describe block replaced with retirement-verification test; Pin/Hide remount HIDE/UNHIDE tests removed; patchIdentityFlag hidden test removed; mergeIdentityAppearance Case 9 hidden trimmed + Case 14 removed; hydrateHiddenIdsFromServer Sink 2 + Sink 4 removed; makeIdentityWithHidden renamed → makeIdentityWithFlags with `hidden` opt now a no-op; APPEARANCE_CACHE_KEY v1→v2 mirror)"
    - "src/ui/state/conversation-store.ts (hiddenIds state slice + hideConversation / unhideConversation / toggleHideConversation / hydrateHiddenIdsFromServer / useHiddenIds / getHiddenIdsSnapshot / __resetHiddenIdsForTest exports; SnapshotForTest `hiddenIds` field; putHiddenIds import; syncIdentityFlagAfterWrite field union narrowed)"
    - "src/ui/state/conversation-store.test.ts (STORE-107-01..04 + STORE-HIDDEN-01..03 describe blocks removed; mock db Row type + putHiddenIds mock + __resetHiddenIdsForTest beforeEach cleanup)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (imports: useHiddenIds / hideConversation / unhideConversation / hydrateHiddenIdsFromServer / deriveDiskHiddenIds; helpers: canonicalHideIdForRow + isRowHidden; state: hiddenExpanded; memos: hiddenRows; handlers: handleToggleHide; hydrate: sibling `.hidden` block; render: 4 prop-pair callsites for hidden/onToggleHide, entire Hidden section render block; unused icon imports EyeOff / ChevronDown / ChevronRight)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx (deriveDiskHiddenIdsSpy + hideConversationSpy + unhideConversationSpy + hydrateHiddenIdsFromServerSpy + all their reset lines + Hidden-section describe block + Hide/Show-wiring describe block + PANEL-107-* describe block + AFF-107-* describe block + PANEL-92-03 + Test I + Test I2)"
    - "src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx (deriveDiskHiddenIds + useHiddenIds + hideConversation + unhideConversation + hydrateHiddenIdsFromServer + putHiddenIds mocks)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx (same mock stubs)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx (same mock stubs)"
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.relay-room.test.tsx (same mock stubs + MockSnapshot.hiddenIds field + setSnapshot arg + spy defs + snapshot init)"
    - "src/ui/shell/IdentitySessionPane.tsx (useHiddenIds import + call + isHidden calc + Hide/Unhide menu item + useMemo dep)"

key-decisions:
  - "Historical-context comments preserved. Every retirement site (function, describe block, prop, mock stub) leaves a one-line `(Phase 115 Plan 115-02: ... retired per D-21 alongside ...)` note. Grep sweep finds these; the executable-lines grep excludes comment lines. Comments are the trail that helps a future reader understand `why was this thing here in the past` without git-archaeology."
  - "Test blocks deleted WHOLESALE, not commented out. Prior Phase 107 describe blocks (STORE-107, PANEL-107, AFF-107, SEL-107, HID-107, Hidden section, Hide/Show wiring) are gone from the file body — replaced by a single retirement-note comment. Rationale: keeping them around as .skip'd or /* commented-out */ blocks would (a) bit-rot silently as surrounding code drifts, and (b) invite a future refactor to un-comment them without checking whether the underlying code path still exists."
  - "The `makeIdentityWithHidden` fixture helper in enrichment.test.ts was RENAMED to `makeIdentityWithFlags` rather than deleted. It has 13 call sites (mostly in the remount-cycle + patchIdentityFlag tests); deleting it would force a rewrite of every call site. Renaming plus voiding the `hidden` opt (`void opts.hidden;`) preserves the callsite compat while making it a no-op — cleaner than a full call-site sweep for one axis retirement."
  - "APPEARANCE_CACHE_KEY bumped v1 → v2. The cached record shape post-Plan carries `pinned` but no `hidden`; a pre-Plan v1 record with `hidden: true` still parses (JSON.parse survives extra fields, and the reader's per-field pick at identities-store.ts:865+ silently drops unknown fields). The bump is a belt-and-suspenders correctness measure: a v1 record read into a v2-shaped codebase would silently succeed with `hidden` dropped, but bumping the key wipes the surface entirely — cheaper than a per-field migration for one axis."
  - "Backend + frontend split into two commits. Task 1 (backend) landed first at commit 4f7197a3; Task 2 (frontend) at 6c561a18. Each is independently green — the backend commit's own tests pass with the retirement, and the frontend commit's tests pass against the retired backend. Serial commit order was chosen because the backend removal creates the vacuum (publicIdentity no longer emits `hidden`; SweepIdentityLine no longer carries it) that the frontend then adapts to (Identity type no longer expects it; deriveDiskHiddenIds function no longer exists to be called). Reversing the order would have produced a middle state where the frontend still consumed a field the backend no longer emitted — the reader's silent-drop for unknown fields would have handled it, but the diff is cleaner backend-first."
  - "Test count reductions in disk-read.test.ts (PUB-92-04 `.pinned + .hidden = 4` → `.pinned = 2`; PUB-92-05 `6` → `3`; PUB-92-06 `both .pinned and .hidden` → `.pinned only`) are LOAD-BEARING assertions of the retirement, not cosmetic — a future refactor that accidentally re-introduces a parallel `.hidden` probe would double the call count and trip these gates."
  - "The Hidden-section render block was removed as ONE atomic edit (48 lines of JSX: divider button, EyeOff glyph, expand chevron, aria-expanded state, mapped hiddenRows PrettyConversationRowLive children). Kept as a single-shot deletion because splitting it into `Hidden section header` + `Hidden section body` sub-edits would leave a broken intermediate state; the render block is a cohesive unit and treating it as such is the natural shape."
  - "IdentitySessionPane.tsx Hide/Unhide menu item deletion: previously 12 lines of items.push(...) inside the useMemo, gated on `if (shadowFleetId !== null)`. The 115-06 plan will re-introduce a similar block in the same slot with `label: \"Archive\"`, `danger: true`, red-styled onClick behind a confirmation dialog. This retirement leaves a marker comment (`(Phase 115 Plan 115-02: prior Hide/Unhide item retired ... 115-06 re-introduces an Archive item in this same slot.)`) as a signpost for the 115-06 implementer."

patterns-established:
  - "Wholesale-code-path-retirement across a cross-cutting axis: when a code path (`.hidden`) spans backend routes + backend schema + backend wire protocol + backend tests + frontend API + frontend state + frontend panel + frontend badge + all their tests, executing it as one plan with two atomic commits (backend + frontend) — each independently green — produces a clean bisect surface and a legible git log."
  - "Retirement-with-marker-comments: prefer leaving a one-line retirement note at each former site over deleting silently. Grep sweeps then find retirement notes AND find that no executable references remain. Trail-of-breadcrumbs for future readers costs one line per retirement site."
  - "Cache-key-version-bump on schema retirement: when a persisted cache carries a retired field, bumping the key version invalidates all cached records on next cold boot. Cleaner than a per-field migration for one deprecated axis. Applies to any localStorage / sessionStorage / IndexedDB-backed cache with a versioned key."

requirements-completed: []

# Metrics
duration: ~90min
completed: 2026-09-17
---

# Phase 115 Plan 115-02: Retire the entire `.hidden` code path Summary

**Deleted every backend and frontend reference to Phase 107's `.hidden` sentinel machinery per D-21 — 26 files touched, +442/-3191 lines net, 597 tests scoped-green, zero production references to `.hidden` / `hiddenIds` / `hideConversation` / `useHiddenIds` / `deriveDiskHiddenIds` / `hydrateHiddenIdsFromServer` / `putHiddenIds` remaining in `src/`.**

## Performance

- **Duration:** ~90 min wall-clock across two tasks
- **Started:** 2026-09-17 (executor spawn)
- **Backend commit:** `4f7197a3` — 12 files, +133/-1026
- **Frontend commit:** `6c561a18` — 14 files, +309/-2165
- **Total:** 26 files, +442/-3191 lines net, executor-scoped vitest sweep 597 tests / 100% green

## Accomplishments

### Task 1 — backend (`4f7197a3`)

- `src/backend/database/routes/identities.ts`: dropped `hidden: boolean = false` 7th param from `publicIdentity()`, dropped `hidden: resolved.hidden` return field, dropped parallel `.hidden` `identityFileExists` probe from the disk-fanout, dropped the three-tuple destructure back to two-tuple. Updated the 8-slot semaphore comment "3 channels per identity (24)" → "2 channels (16)".
- `src/backend/database/routes/user-preferences.ts`: deleted `HIDDEN_CONVERSATION_IDS_MAX_LENGTH` constant, `hiddenConversationIds` destructure + validation block (~30 lines), the full HIDDEN FANOUT block (~110 lines including `previousStates` / `postStates` / `echoHiddenFinal` / conn-map extension), response-echo of `hiddenConversationIds`, OpenAPI schema `hiddenConversationIds` property. Simplified branch condition `if (pinnedConversationIds !== undefined || hiddenConversationIds !== undefined)` → `if (pinnedConversationIds !== undefined)`.
- `src/backend/fleet-status/sweep-schema.ts`: dropped `hidden?: boolean` from `SweepIdentityLine`, dropped B9 entry from `SWEEP_FIELD_PARITY`, dropped "B9" from the `"B0"|..."B9"` union type.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts`: dropped `hidden` from `appearanceFromIdentityLine`'s `hasAnyAppearanceKey` guard, dropped `hidden: identityLine.hidden === true` from the resolver call, dropped `hidden === true ? "1" : "0"` from `appearanceFingerprintSegment`.
- `src/backend/fleet-status/identity-appearance.ts`: dropped `hidden: boolean` from `ResolvedIdentityAppearance` type, dropped the arg from `resolveIdentityAppearance`, dropped the return-field.
- `src/backend/fleet-status/wire-protocol.ts`: dropped `hidden: z.boolean()` from `IdentityAppearanceSchema`.
- Tests: full Phase 107 test blocks retired (`PUB-107-signature-*` + `HID-107-01..06` in disk-read; `HID-107-GET` + `HID-107-PUT-*` + `HID-107-DB-*` + `SAVE 107-01` in user-preferences); PUB-92-04..06 probe-count assertions adjusted 4→2, 6→3, and the `[".pinned", ".hidden"]` allow-list narrowed to `".pinned"` only; B9 dropped from `EXPECTED_KEYS` in sweep-schema.test; hidden entries removed from fixture objects in wire-protocol.test / identity-appearance.test / ssh-poll-orchestrator.test; parametrized `field: "hidden"` fingerprint-axis case dropped from ssh-poll-orchestrator.test (fieldChanges.length 9 → 8).
- **Scoped verify:** `./node_modules/.bin/vitest run <6 backend test files>` → **305 tests / 100% green** in 2.12s.
- **`tsc --noEmit` on `tsconfig.node.json`:** clean, zero output.

### Task 2 — frontend (`6c561a18`)

- `src/ui/api/user-preferences-api.ts`: deleted `putHiddenIds` export (~34 lines including SC6 rollout scaffold + echo-comparison warn). Kept the shared `toBareIdentityKey` helper (still used by `putPinnedIds`).
- `src/ui/api/identities-api.ts`: dropped `hidden?: boolean` from the `Identity` type.
- `src/ui/state/identities-store.ts`:
  - Dropped `hydrateHiddenIdsFromServer` import.
  - Deleted `deriveDiskHiddenIds` function entirely (~45 lines).
  - Renamed `reprojectDiskPinHideIntoRows` → `reprojectDiskPinIntoRows` (only pinned axis remains).
  - Narrowed `patchIdentityFlag`'s `field` union `"pinned" | "hidden"` → `"pinned"`.
  - Dropped `hidden` from `mergeIdentityAppearance`'s appearance-field union, from its cold-boot append shape, from `readAppearanceCache` / `writeAppearanceCache`.
  - **Bumped `APPEARANCE_CACHE_KEY` v1 → v2** to invalidate cached v1 records that carry the retired `hidden` field.
- `src/ui/state/conversation-store.ts`:
  - Deleted `hiddenIds: Set<string>` state slice + init.
  - Deleted `hideConversation`, `unhideConversation`, `toggleHideConversation`, `hydrateHiddenIdsFromServer` exports (~76 lines).
  - Deleted `useHiddenIds` hook + `getHiddenIdsSnapshot` helper.
  - Deleted `__resetHiddenIdsForTest` test helper.
  - Deleted `hiddenIds: state.hiddenIds` from the `SnapshotForTest` getter.
  - Deleted `putHiddenIds` import.
  - Narrowed `syncIdentityFlagAfterWrite`'s `field` arg `"pinned" | "hidden"` → `"pinned"`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`:
  - Dropped `useHiddenIds` / `hideConversation` / `unhideConversation` / `hydrateHiddenIdsFromServer` from the `@/state/conversation-store` import.
  - Dropped `deriveDiskHiddenIds` from the `@/state/identities-store` import.
  - Deleted `canonicalHideIdForRow` helper + `isRowHidden` helper (~30 lines).
  - Deleted `hidden?: boolean` prop + `onToggleHide?: () => void` prop from `PrettyConversationRowLive`.
  - Deleted `useHiddenIds()` call + `hiddenIds` local.
  - Deleted `hiddenExpanded` state.
  - Deleted `hiddenRows` useMemo.
  - Deleted `handleToggleHide` handler (~26 lines).
  - Deleted sibling `.hidden` hydrate block from the mount effect.
  - Deleted all 4 render-site `hidden={isRowHidden(...)}` + `onToggleHide={canonicalHideIdForRow(...) ? ... : undefined}` prop pairs.
  - Deleted the entire Hidden section render block (~54 lines: divider button + EyeOff glyph + expand chevron + aria-expanded state + mapped `hiddenRows.map(...)` children).
  - Dropped `visiblePinned` / `visibleMiddle` filter-partition (every row in the pinned/middle tiers is now unconditionally visible).
  - Dropped `EyeOff` / `ChevronDown` / `ChevronRight` icon imports (no longer referenced after the Hidden section deletion).
- `src/ui/shell/IdentitySessionPane.tsx`:
  - Dropped `useHiddenIds` / `hideConversation` / `unhideConversation` imports.
  - Deleted `useHiddenIds()` call + `isHidden` variable.
  - Deleted the Hide/Unhide menu item (`items.push({ label: isHidden ? "Unhide" : "Hide", onClick: ... })`), guarded by `if (shadowFleetId !== null)`.
  - Dropped `isHidden` from the useMemo deps array.
- Tests: All Phase 107 describe blocks + supporting mock stubs / spies / helpers retired across 5 panel test files + 3 state test files + 1 api test file. Preserved (via rename) the `makeIdentityWithFlags` helper so its 13 existing call sites in `identities-store.enrichment.test.ts` still compile; the `hidden` opt is a no-op (`void opts.hidden;`).
- **Scoped verify:** `./node_modules/.bin/vitest run <8 frontend test files>` → **292 tests / 100% green** in 14.09s.
- **`tsc --noEmit` on `tsconfig.app.json`:** zero plan-related type errors. Pre-existing type errors in unrelated files (AppShell.persistence.test.tsx, claude-session-api.ts, compose-drafts-api.ts, LoginPage.tsx, FullScreenAppWrapper.tsx, etc.) are out of scope per the plan's `<verification>` grep clause and remain untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete backend `.hidden` — routes, fleet-status schema, wire protocol, and their tests** — `4f7197a3` (`refactor`)
2. **Task 2: Delete frontend `.hidden` — API layer, stores, panel, badge, and their tests** — `6c561a18` (`refactor`)

## Files Created/Modified

See `key-files.modified` in the frontmatter above (26 files total).

## Decisions Made

1. **Retirement-note comments preserved at every former call site.** Every deleted symbol leaves a one-line `(Phase 115 Plan 115-02: ... retired per D-21 alongside ...)` note. Rationale: a future reader (or a git-log-less code archaeologist) benefits from seeing the "why was this thing here" context inline; the marker also acts as a stable regression signpost for a search across the codebase.

2. **Test blocks deleted wholesale, not commented out.** Rationale: `describe.skip(...)` or `/* commented-out */` describe blocks bit-rot silently. Keeping them out of the file body forces a future re-introduction to explicitly re-add the coverage, matching the retirement-then-re-introduce shape 115-06 will follow.

3. **`makeIdentityWithHidden` helper renamed to `makeIdentityWithFlags`.** Rationale: 13 call sites, most in remount-cycle + patchIdentityFlag tests. Rename + `void opts.hidden;` makes it a no-op-accepting helper with zero call-site churn. Cleaner than a full call-site sweep for one axis retirement.

4. **APPEARANCE_CACHE_KEY bumped v1 → v2 rather than adding per-field migration.** The reader's per-field pick at identities-store.ts:865+ silently drops unknown fields, so a v1 record with `hidden: true` would still parse into a v2-shaped codebase without incident. The bump is a belt-and-suspenders correctness measure — cheaper than a per-field migration for one axis retirement, and follows the pattern established by prior schema versions.

5. **Backend + frontend split into two commits, backend-first.** Task 1 (backend) landed first at commit `4f7197a3`; Task 2 (frontend) at `6c561a18`. Serial commit order was chosen because the backend removal creates the vacuum (publicIdentity no longer emits `hidden`; SweepIdentityLine no longer carries it) that the frontend then adapts to. Reversing the order would have produced a middle state where the frontend still consumed a field the backend no longer emitted — the reader's silent-drop for unknown fields would have handled it, but the diff is cleaner backend-first.

6. **Probe-count assertions in PUB-92-04..06 tuned load-bearing.** Test counts of 4→2, 6→3, and the `.pinned`-only relPath allow-list are deliberate assertions of the retirement — a future refactor that accidentally re-introduces a parallel `.hidden` probe would double the call count and trip these gates. Not cosmetic edits.

7. **Full 26-file cross-cutting scope executed in one plan.** The retirement crosses backend routes + backend schema + backend wire + backend tests + frontend api + frontend state + frontend panel + frontend badge + all their tests. Splitting into sub-plans would produce mid-state builds where symbols exist on one side but not the other. Keeping it as one plan with two atomic commits (each independently green) gives the cleanest bisect surface.

## Deviations from Plan

**None** — plan executed as written. Two minor implementation choices worth flagging:

- **[Rule 3 — Blocking issue] The `handleApiError` call in `user-preferences-api.ts` L76 has a pre-existing tsc error (`Expected 2 arguments, but got 1`).** Not caused by this plan (predates it) — flagged in the tsc output but out of scope per the plan's `<verification>` "explain each remaining hit" clause. Would fix in a follow-up unrelated cleanup.
- **[Rule 2 — Critical mock-shape cleanup] Panel test files needed BOTH `hidden`-slot removal AND mock-stub removal.** For each of `PrettyConversationsPanel.test.tsx`, `NewConversationModal.flow.test.tsx`, `PrettyConversationsPanel.new-role-button.test.tsx`, `PrettyConversationsPanel.role-management-flow.test.tsx`, `PrettyConversationsPanel.relay-room.test.tsx`, the module-level `vi.mock("@/state/conversation-store", () => ({...}))` and `vi.mock("@/state/identities-store", () => ({...}))` factories carried stubs for the retired exports (`useHiddenIds: () => new Set()`, `hideConversation: () => {}`, `unhideConversation: () => {}`, `hydrateHiddenIdsFromServer: () => {}`, `deriveDiskHiddenIds: () => []`). These weren't in the plan's explicit `<action>` list but their removal was necessary to keep the tests importable — Vitest hoists `vi.mock` factories above imports, so a stub referencing a now-non-existent export at runtime silently succeeds, but leaving them creates a false surface. Removed per scope-boundary Rule 2 (correctness-critical: dead mock stubs mislead a future reader).

## Issues Encountered

- **First tsc pass surfaced pre-existing errors in `AppShell.persistence.test.tsx`, `claude-session-api.ts`, `compose-drafts-api.ts`, `LoginPage.tsx`, `FullScreenAppWrapper.tsx`, etc.** All unrelated to `.hidden` retirement. Filtered the tsc output to `hiddenIds|deriveDiskHiddenIds|useHiddenIds|hideConversation|unhideConversation|putHiddenIds|hydrateHiddenIdsFromServer|patchIdentityFlag.*hidden|__resetHiddenIds` and confirmed zero matches → the plan's changes are clean.

- **`Cache 3` test in `identities-store.enrichment.test.ts` initially FAILED after the APPEARANCE_CACHE_KEY bump v1 → v2.** The test hardcoded the cache key as `"skynet:identities-appearance-cache:v1"`. Fixed by mirroring the bump in the test file — `const APPEARANCE_CACHE_KEY = "skynet:identities-appearance-cache:v2"` with a comment explaining the sync-point with the source module. This is the ONLY test that needed a cache-key-specific edit; the other cache tests either use the constant symbolically or exercise the read/write round-trip via public helpers.

## RESEARCH.md line-number drift report (plan `<output>` requirement)

Per the plan's `<output>` section, all RESEARCH.md-cited line numbers were checked against the actual file content at edit time. Findings:

| Cited location (RESEARCH §2) | Cited lines | Actual lines | Drift |
|---|---|---|---|
| `identities.ts` publicIdentity hidden param | L189-197 | L189-197 | 0 |
| `identities.ts` resolveIdentityAppearance hidden arg | L211 | L211 | 0 |
| `identities.ts` return object hidden field | L252-257 | L252-257 | 0 |
| `identities.ts` disk-fanout `.hidden` probe | L414-424 | L414-424 | 0 |
| `identities.ts` three-tuple destructure | L426 | L426 | 0 |
| `identities.ts` publicIdentity call site | L441-449 | L441-449 | 0 |
| `identities.ts` 3-channels comment | L402 | L336-339 | -63 (comment was ~5 lines further UP than cited; still trivially locatable via grep for "3 channels per identity") |
| `user-preferences.ts` HIDDEN_CONVERSATION_IDS_MAX_LENGTH const | L33-37 | L33-37 | 0 |
| `user-preferences.ts` HIDDEN FANOUT block | L402-511 | L400-512 | +1 line block (minor comment-length variance) |
| `sweep-schema.ts` `hidden?: boolean` on SweepIdentityLine | L109-131 | L109-131 | 0 |
| `sweep-schema.ts` B9 entry in SWEEP_FIELD_PARITY | L353 | L353 | 0 |
| `sweep-schema.ts` "B8"|"B9" union | L410-411 | L410-411 | 0 |
| `ssh-poll-orchestrator.ts` hidden in appearanceFromIdentityLine | L1131-1162 | L1131-1162 | 0 |
| `identity-appearance.ts` hidden in ResolvedIdentityAppearance | L73-74 | L73-74 | 0 |
| `identity-appearance.ts` hidden in resolver body | L134-136, L138, L200-201 | L134-136, L138, L200-201 | 0 |
| `wire-protocol.ts` hidden in IdentityAppearanceSchema | L332, L366-383 | L332, L366-383 | 0 |
| `identities.disk-read.test.ts` HID-107-* + PUB-107-* | L491-513, L516-557 | L505-729 | +14 line block (test file has grown since RESEARCH captured); locatable via grep for "HID-107" and "PUB-107-signature" |
| `user-preferences-api.ts` putHiddenIds | L18-27, L87-134 | L18-27, L87-134 | 0 |
| `identities-store.ts` deriveDiskHiddenIds | L217-258 | L217-258 | 0 |
| `identities-store.ts` hydrateHiddenIdsFromServer call in reprojectDiskPinHideIntoRows | L529 | L529 | 0 |
| `identities-store.ts` APPEARANCE_CACHE_KEY | L37 | L37 | 0 |
| `conversation-store.ts` hiddenIds slice + hooks + exports | L227, L350, L399, L995-997, L1804-1880, L1941-1945, L2091, L2125-2128 | all matched within ±3 lines | trivial |
| `PrettyConversationsPanel.tsx` L231-256 (canonicalHideIdForRow/isRowHidden) | L231-256 | L231-256 | 0 |
| `PrettyConversationsPanel.tsx` L281 (hidden prop) | L281 | L281 | 0 |
| `PrettyConversationsPanel.tsx` L291 (onToggleHide prop) | L291 | L291 | 0 |
| `PrettyConversationsPanel.tsx` L748 (hiddenExpanded) | L748 | L748 | 0 |
| `PrettyConversationsPanel.tsx` L974-988 (hiddenRows useMemo) | L974-988 | L974-988 | 0 |
| `PrettyConversationsPanel.tsx` L1154 (handleToggleHide comment) | L1154 | L1154 | 0 |
| `PrettyConversationsPanel.tsx` L1406-1430 (handleToggleHide) | L1406-1430 | L1406-1430 | 0 |
| `PrettyConversationsPanel.tsx` L1848-1849 / 1881-1882 / 1911-1912 / 2021-2022 (4 render sites) | as cited | as cited | 0 |
| `PrettyConversationsPanel.tsx` L1973-2031 (Hidden section) | L1973-2031 | L1973-2031 | 0 |
| `IdentitySessionPane.tsx` L140-141 / L150-152 / L170-182 / L212-213 | as cited | as cited | 0 |

Overall drift is negligible; every citation locates unambiguously via grep for the actual identifier. Anchoring via `grep -n` at edit time is the load-bearing lookup mechanism (this executor followed that discipline) — line numbers are hints, not addresses.

## Metrics detail (plan `<output>` requirement)

- **Line delta:** +442 insertions / −3191 deletions net across 26 files (net −2749 lines, ~35% file-size reduction on average across the touched files).
- **Test count delta:** removed 4 Phase 107 describe blocks + inline tests across backend tests (~15 tests deleted) + 6 describe blocks / inline test groups across frontend tests (~25+ tests deleted). Rough estimate: ~40 test cases retired plus their supporting fixtures. All remaining tests in the 8 touched frontend files + 6 touched backend files pass 100% green: 305 backend + 292 frontend = 597 tests green in scoped runs.
- **Symbol delta:** 12 exports deleted from `conversation-store.ts` (hideConversation, unhideConversation, toggleHideConversation, hydrateHiddenIdsFromServer, useHiddenIds, __resetHiddenIdsForTest, getHiddenIdsSnapshot, hiddenIds state field), 3 exports deleted from `identities-store.ts` (deriveDiskHiddenIds, and narrowed patchIdentityFlag field union), 2 exports deleted from `user-preferences-api.ts` (putHiddenIds, and comment blocks). 6 fields deleted from wire/schema types (`hidden` on SweepIdentityLine, ResolvedIdentityAppearance, IdentityAppearanceSchema, publicIdentity return, Identity type, and B9 from SWEEP_FIELD_PARITY).

## Grep sweep results (plan `<verification>` requirement)

```
$ grep -rn 'hideConversation\|unhideConversation\|useHiddenIds\|hiddenIds\|putHiddenIds\|getHiddenIds\|deriveDiskHiddenIds\|hydrateHiddenIdsFromServer' src/ui/ src/backend/ --include='*.ts' --include='*.tsx' | grep -v -E 'test\.(ts|tsx):|\.test\.ts|SEARCH_HIDDEN|search-hidden|search-hide|// |^ \*|/\*|aria-hidden|pv-conv-search-hidden|overflow-hidden|Phase 115 Plan 115-02'
src/ui/state/identities-store.ts:474: * per D-21 alongside the deriveDiskHiddenIds function.)
```

Only one match — inside a JSDoc-comment retirement note (the JSDoc marker `*` was not matched by the `-v '^ \*'` filter because it has non-space indentation). Non-executable. PASS.

```
$ grep -rn '\.hidden\b' src/ui/ src/backend/ --include='*.ts' --include='*.tsx' | grep -v -E 'test\.(ts|tsx):|\.test\.ts|// |^ \*|/\*|aria-hidden|overflow-hidden|Phase 115 Plan 115-02'
```

Zero matches. PASS.

## APPEARANCE_CACHE_KEY bump (plan `<output>` requirement)

**Before:** `const APPEARANCE_CACHE_KEY = "skynet:identities-appearance-cache:v1";`
**After:** `const APPEARANCE_CACHE_KEY = "skynet:identities-appearance-cache:v2";`

**Mirror site:** `src/ui/state/identities-store.enrichment.test.ts` — same constant bumped v1 → v2 with a comment explaining the sync-point with the source module. Both files carry a retirement-note comment explaining why the bump is a belt-and-suspenders invalidation over any localStorage records that carry the retired `hidden` field.

## Threat Flags

Nothing new surfaced beyond the plan's `<threat_model>`. All three registered threats (T-115-02-01 DoS via stale `hiddenConversationIds` PUT payload; T-115-02-02 DoS via `hidden: true` from unpatched managed hosts; T-115-02-03 information disclosure via stale `.hidden` sentinels; T-115-02-SC package supply chain) are unchanged. The `.passthrough()` recommendation on T-115-02-02 was not implemented — the SweepIdentityLine parse path uses a bare cast (`isSweepLineOfCurrentSchema` type guard checks only `schema_version` and `line_kind`), which admits extra unknown fields silently; a mid-distribution host that still emits `hidden: true` on its sweep line parses cleanly, the field lands in the parsed object but has no consumer (all readers of the field are deleted in this plan). Accepted risk as documented.

## Self-Check: PASSED

**File existence:**
- `src/backend/database/routes/identities.ts` — FOUND (git show 4f7197a3:src/backend/database/routes/identities.ts | wc -l → 954 lines, was 1014 before edit)
- `src/backend/database/routes/user-preferences.ts` — FOUND
- `src/backend/fleet-status/sweep-schema.ts` — FOUND
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — FOUND
- `src/backend/fleet-status/identity-appearance.ts` — FOUND
- `src/backend/fleet-status/wire-protocol.ts` — FOUND
- All backend test files — FOUND
- `src/ui/api/user-preferences-api.ts` — FOUND
- `src/ui/api/identities-api.ts` — FOUND
- `src/ui/state/identities-store.ts` — FOUND
- `src/ui/state/conversation-store.ts` — FOUND
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND
- `src/ui/shell/IdentitySessionPane.tsx` — FOUND
- All frontend test files — FOUND

**Commit existence:**
- `4f7197a3` — `git log --oneline | grep 4f7197a3` → PRESENT (`refactor(115-02): delete backend .hidden code path — routes, sweep schema, wire protocol`)
- `6c561a18` — `git log --oneline | grep 6c561a18` → PRESENT (`refactor(115-02): delete frontend .hidden code path — api/state/panel/badge`)

**Done-criteria greps (from plan Task 1 + Task 2 `<done>` blocks):**
- `grep -rn '\.hidden' src/backend/database/routes/identities.ts src/backend/database/routes/user-preferences.ts` → 3 hits, all in `(Phase 115 Plan 115-02: ... `.hidden`...)` retirement-note comments. PASS.
- `grep -rn 'hiddenConversationIds\|HIDDEN_CONVERSATION_IDS\|echoHiddenFinal' src/backend/database/routes/user-preferences.ts` → 2 hits, both in retirement-note comments. PASS.
- `grep -rn 'hidden' src/backend/fleet-status/sweep-schema.ts src/backend/fleet-status/wire-protocol.ts src/backend/fleet-status/identity-appearance.ts src/backend/fleet-status/ssh-poll-orchestrator.ts | grep -v '// ' | grep -v '^ \*'` → 0 executable-line matches. PASS.
- `grep -rn 'hideConversation\|unhideConversation\|useHiddenIds\|hiddenIds\|putHiddenIds\|getHiddenIds\|deriveDiskHiddenIds\|hydrateHiddenIdsFromServer' src/ui/` → all matches are in retirement-note comments or the search-hidden sentinel (unrelated feature). PASS.
- `grep -rn '\.hidden\b' src/ui/` → all matches are in retirement-note comments. PASS.

**Verify commands (from plan Task 1 + Task 2 `<verify>` blocks):**
- Task 1: `./node_modules/.bin/vitest run <6 backend test files>` → **305 tests / 100% green** in 2.12s. PASS.
- Task 2: `./node_modules/.bin/vitest run <8 frontend test files>` → **292 tests / 100% green** in 14.09s. PASS.
- `./node_modules/.bin/tsc -p tsconfig.node.json --noEmit` → clean. PASS.
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` (filtered to plan-related errors) → zero plan-related errors. PASS.

## Next Plan Readiness

- **115-05 (SweepIdentityLine.archived add, Wave 4):** the B9 wire slot is now vacated — 115-05 can reuse it for `archived` without conflict. The `SweepIdentityLine` interface has no `hidden` field; the parity map has no `B9` entry; the wire union type is now `"B0"|..."B8"` awaiting `"B9"` re-introduction for the archived axis.
- **115-06 (frontend archive flow, Wave 4):** the panel + badge menus are ready to receive the Archive item. The 4 render-site prop-pair slots that previously held `hidden={...} onToggleHide={...}` are now empty; 115-06 will re-fill them with `onArchive={...}` (per the plan's `handleArchive(row)` sketch in RESEARCH §2). The IdentitySessionPane menu builder's Hide/Unhide slot is marked with a `(Phase 115 Plan 115-02: prior Hide/Unhide item retired ... 115-06 re-introduces an Archive item in this same slot.)` comment as a signpost.
- **Deploy-motion coordination:** this plan lands the retirement; 115-06 lands the replacement. Between the two, users lose the Hide affordance temporarily. Both plans ship together at deploy time per the plan's `<action>` note, so the deployment window sees the whole phase, not intermediate states.
- **HEAD `6c561a18` LOCAL** — NOT pushed / NOT built / NOT deployed. Held at push boundary per the fleet's greenlight-at-push rule. Orchestrator (tina) picks up ship motion on user greenlight.

---
*Phase: 115-identity-archiving-from-the-frontend*
*Completed: 2026-09-17*
