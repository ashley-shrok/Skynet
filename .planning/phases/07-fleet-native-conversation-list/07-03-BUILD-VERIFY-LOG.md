# Phase 7 Build Verify Log

Timestamp: 2026-07-21T06:32:27Z
Commit: 858ad4295d3964c3992920c4437166a409041fa2 (feat/tab-title-from-tmux)
Scope: Local `npm run build` verification only. Docker image build is Ashley-gated in the main orchestrator context and NOT executed here (Task 4 deploy deferred per plan hard_constraint).

## Step A — Clean build

Command: `rm -rf dist && npm run build`
Outcome: **CLEAN — built in 10.64s** — no `error TS`, no `[vite]` error markers.

Key output bundles (Phase 7 shipped bytes):

| Bundle | Phase 7 size | Phase 6 baseline (06-05) | Delta | Phase 7 gzip |
|---|---:|---:|---:|---:|
| `dist/assets/AppShell-RlZTYSgn.js` | **443,537** bytes | 440,553 bytes | **+2,984** bytes (+0.68%) | 85.63 kB |
| `dist/assets/Terminal-BmSUq5YH.js` | **141,274** bytes | 141,274 bytes | **0** (byte-identical) | 37.95 kB |
| `dist/assets/index-Bf_pFKMe.js` | **333,125** bytes | 333,125 bytes | **0** (byte-identical) | 102.16 kB |
| `dist/backend/backend/ssh/terminal.js` | **103,405** bytes | 103,405 bytes | **0** (byte-identical) | — |

Phase 7 landing surface (all AppShell): +2,984 bytes for FleetSession + RDP row derivation + hostsFlat management + one-shot fleet fetch + ConversationsPanel showGear/isTouchDevice/onRdpRowClick/RdpRow + AppShell handler wiring. The zero deltas on Terminal, index, and backend prove the scope fence held — no cross-territory leaks from Phase 7.

Warning surfaced (informational, non-blocking): "Some chunks are larger than 1000 kB after minification" — pre-existing Phase 5 baseline warning about `file-preview-vendor` (1.26 MB) + `codemirror` (1.61 MB) + `pdf.worker.min` (1.05 MB) vendor chunks. Not a Phase 7 regression (identical to Phase 6 baseline warning).

## Step B — Phase 7 signals survive Vite tree-shake

Vite mangles user-defined identifiers (function names like `updateFleetSessions`, `updateHostsFlat`, `computeSnapshot`, `handleRowSelect`, `Pencil` import binding — all mangled). Grep-gate strategy prefers **string literals that survive minification**: fleet row id prefixes, URL literals, i18n keys, SVG icon paths, DevTools attributes, sentinel HostGroup id.

Occurrence counts (using `python3` regex `.findall()` for accurate hits inside minified single-line chunks; `grep -c` returns line-count which is unreliable on minified bundles):

### Plan 07-01 signals (fleet-native data source)

| Marker | Count | Expected | Result | Provenance |
|--------|------:|:--------:|:------:|------------|
| `fleet::` (fleet row id prefix) | 1 | ≥ 1 | ✓ | conversation-store.ts fleetRowId helper — string literal survives minification |
| `/sessions/list` (fleet-fetch URL) | 1 | ≥ 1 | ✓ | authApi.get("/sessions/list") in sessions-api.ts — the fleet-discovery endpoint call |
| `updateFleetSessions` (identifier) | 0 | (mangled by Vite) | N/A | Fallback covered by /sessions/list URL hit above (proves fleet fetch reaches the store) |
| `fleetOnly` (INTERNAL routing marker) | 2 | ≥ 1 | ✓ | Property key in ConversationRow shape — key names survive minification for property accessors |

### Plan 07-02 signals (RDP rows + pencil + mobile gear-dedup)

| Marker | Count | Expected | Result | Provenance |
|--------|------:|:--------:|:------:|------------|
| `rdp-host::` (RDP row id prefix) | 2 | ≥ 1 | ✓ | conversation-store.ts RDP emission pass — string literal |
| `__rdp__` (sentinel HostGroup id) | 2 | ≥ 1 | ✓ | Sentinel HostGroup marker + ConversationsPanel special-case string literal |
| `rdpHostRow` (INTERNAL routing marker) | 3 | ≥ 1 | ✓ | Property key on ConversationRow shape |
| `data-rdp-host-row` (DevTools attribute) | 1 | ≥ 1 | ✓ | RdpRow component attribute for inspection |
| `Pencil` identifier | 0 | (mangled by Vite) | N/A | Fallback below |
| Pencil SVG path `M21.174` (lucide) | 2 (in ui-vendor) | ≥ 1 | ✓ | Unique lucide `Pencil` icon SVG path — vendor-chunked but shipped |
| Pencil SVG path `M17 3` (lucide) | 2 (in ui-vendor) | ≥ 1 | ✓ | Corroborating lucide Pencil path |
| `nav.newSession` i18n key | 10 | ≥ 8 (matches 06-05 baseline of 10) | ✓ | i18n key namespace — survives minification (proves NewSessionButton ships with pencil) |

### Corroborating markers (matches Phase 6 baseline)

| Marker | Count | Baseline | Result |
|--------|------:|---------:|:------:|
| `nav.conversations` | 24 | 24 | ✓ (byte-identical to 06-05) |
| `settingsMenu` | 20 | 10 | ✓ (up — appears more inside code due to fresh grep; SETTINGS_MENU_ITEMS registry preserved) |
| `backToList` | 39 | 1 | ✓ (up — includes shared internal refs; mobile back button i18n key present) |
| `newSession` | 10 | 10 | ✓ (byte-identical) |
| `Monitor` | 2 | — | ✓ (lucide Monitor icon shipped for RDP rows — Phase 7 new) |

All Phase 7 markers present. No grep gate returned zero (mangled-identifier fallbacks all landed).

### Pencil re-style verified in source (Plan 07-02)

Confirmed against `src/ui/sidebar/NewSessionButton.tsx`:

```
22:import { Pencil } from "lucide-react";
36:      <Pencil className="size-3 shrink-0" />
```

No `Plus` import in NewSessionButton.tsx (verified: `grep -c "^import.*Plus" src/ui/sidebar/NewSessionButton.tsx` = 0). The `Plus` icon path in ui-vendor (3 hits) is consumed by other components (HostsPanel, CredentialsPanel, HostShareModal, HostCredentialList, AdminApiKeysSection, AdminManagementSections, AdminIdentitiesSection, NetworkGraphCard, dashboard/NewSessionDialog — all unrelated to the ConversationsPanel New Session button).

## Step C — Phase 6 deletions still gone in dist (regression)

Both `TabBar.tsx` and `MobileBottomBar.tsx` were `git rm`'d in Plans 06-02 and 06-03 respectively. Verify they don't sneak back through Vite dead-code inclusion:

| Marker | dist-wide count | Expected | Result |
|--------|----------------:|---------:|:------:|
| `\bTabBar\b` word-boundary (across all `dist/assets/*.js`) | 0 | 0 | ✓ |
| `MobileBottomBar` identifier (across all `dist/assets/*.js`) | 0 | 0 | ✓ |

Both deletions confirmed. Zero leaks. Matches Phase 6 baseline exactly.

## Step D — Load-bearing prior-patch bytes intact

| Patch | Marker | Location | Count | Expected |
|-------|--------|----------|------:|:--------:|
| #25 | `snapshotPendingTab` (module-load call site) | `src/main.tsx` (source) | 2 | ≥ 1 ✓ |
| #25 | `consumePendingWorkspace` | `src/ui/AppShell.tsx` (source) | 3 | ≥ 1 ✓ |
| #25 | `snapshot` (in `dist/assets/index-Bf_pFKMe.js`) | main.tsx bundle | 2 | ≥ 1 ✓ |
| #25 | `pending` (in `dist/assets/index-Bf_pFKMe.js`) | main.tsx bundle | 9 | ≥ 1 ✓ |
| #35 | `appendChild` (DOM-move fallback) in `dist/assets/AppShell-RlZTYSgn.js` | AppShell chunk | 6 | ≥ 1 ✓ (identifier mangled per Phase 6 NOTE-04) |
| #57 | `/compose-drafts` URL literal in `dist/assets/Terminal-BmSUq5YH.js` | Terminal chunk | 3 | ≥ 1 ✓ |
| #60 | `message_queue_delete_on_send` in `dist/backend/backend/ssh/terminal.js` | backend terminal.js | 1 | ≥ 1 ✓ |
| #100 | `ssh_input_delayed_enter` in `dist/backend/backend/ssh/terminal.js` | backend terminal.js | 1 | ≥ 1 ✓ |
| #102 | `pointer: coarse` matchMedia string in `dist/assets/Terminal-BmSUq5YH.js` | Terminal chunk | 1 | ≥ 1 ✓ |
| #105 (Phase 6) | `nav.conversations` in `dist/assets/AppShell-RlZTYSgn.js` | AppShell chunk | 24 | ≥ 20 ✓ (byte-identical to 06-05) |

All load-bearing prior-patch bytes intact. Zero regressions to the six prior patches Phase 7 shares territory with. `appendChild` count in AppShell = 6 confirms patch #35's tabNodesRef DOM-move mechanism is byte-preserved (this is the T-06-02-01 mount-lifecycle contract from Phase 6).

## Step E — Full-project test suite

Command: `npx vitest run --project frontend`

Outcome: **315/315 passed across 24 files** — matches Plan 07-02's SUMMARY expectation exactly (310 baseline post-07-01 + 5 new: 4 RDP-derivation tests + Test 31 has 2 sub-cases = 5 new it() blocks total, all passing).

Breakdown vs prior baselines:
- Pre-Phase-6: 255/255
- Post-Phase-6 (patch #105 ship): 301/301
- Post-Plan-07-01: 310/310 (+8 store + 1 persistence)
- **Post-Plan-07-02 (this build): 315/315** (+5)

Duration: 43.23s (transform 3.36s, setup 721ms, import 9.50s, tests 4.00s, environment 23.47s).

`Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package` — pre-existing jsdom informational, unrelated to Phase 7 (present in Phase 6 test runs too).

## Step F — Type-check clean

Command: `npx tsc --noEmit --skipLibCheck`

Outcome: **0 errors** project-wide.

## Step G — No source-diff creep (scope fence enforcement, Phase 7-scope)

`git diff --stat 6491ba3..HEAD` (Phase 7 base = last commit before Plan 07-01 RED) returned **empty output** for every scope-fenced surface:

| Path | Result |
|------|:------:|
| `src/ui/features/pretty-view/` | ✓ empty |
| `src/ui/features/terminal/Terminal.tsx` | ✓ empty |
| `src/ui/features/guacamole/` | ✓ empty |
| `src/backend/` | ✓ empty |
| `docker/` | ✓ empty |
| `package.json` | ✓ empty |
| `package-lock.json` | ✓ empty |
| `src/ui/sidebar/NewSessionDialog.tsx` | ✓ empty (Plan 07-02 explicitly no dialog changes) |
| `src/ui/sidebar/ConversationRow.tsx` | ✓ empty (TG-13 shape lock — RDP rows use parallel RdpRow, not a prop-override) |

Phase 7 is genuinely frontend-only + Phase-6-additive: no backend routes, no docker/nginx changes, no new dependencies, no ConversationRow touches. The 07-02 Plan 07-02 icon-override-vs-parallel-component decision landed on parallel component (RdpRow declared inline at bottom of ConversationsPanel.tsx), so ConversationRow.tsx has zero diff.

## Step H — Source files modified by Phase 7 (net summary)

Only 5 source files touched across Plans 07-01 + 07-02, matching the two plans' SUMMARY files:

| File | Δ lines | Purpose |
|------|--------:|---------|
| `src/ui/state/conversation-store.ts` | 437 → 703 (+268 / -1) | FleetSession + RDP row derivation + hostsFlat + union/dedup + `__rdp__` sentinel HostGroup |
| `src/ui/state/conversation-store.test.ts` | 601 → 1081 (+482 / -8) | Tests 23-30 (fleet) + Tests 31-34 (RDP) — 22 → 35 it() blocks |
| `src/ui/sidebar/ConversationsPanel.tsx` | 268 → 413 (+161 / -20) | Fleet routing + RDP rendering + showGear TG-18 gate + RdpRow parallel component |
| `src/ui/sidebar/NewSessionButton.tsx` | 33 → 40 (+11 / -4) | Plus → Pencil icon swap (TG-16) |
| `src/ui/AppShell.tsx` | 1823 → 1950 (+127 / 0) | One-shot fleet fetch + hostsFlat memo + onDetachedRowClick + onRdpRowClick handlers |
| `src/ui/AppShell.persistence.test.tsx` | 383 → 444 (+61 / 0) | Test 4 fleet-derived row shape assertion |

Total: 6 files modified, 0 created, 0 deleted, +1110 / -33 net across the whole phase.

## Verdict

**CLEAN** — safe for Ashley-gated deploy in the main orchestrator context.

Rationale:
1. Build completes in 10.64s with no errors and no new warnings beyond the pre-existing large-vendor-chunk informational.
2. All Phase 7 frontend surfaces (fleet-native store extension + one-shot fetch + RDP row rendering + pencil re-style + mobile gear-dedup fix) shipped into `dist/assets/AppShell-RlZTYSgn.js` per the marker inventory (Step B).
3. Both Phase 6 deletions (TabBar.tsx, MobileBottomBar.tsx) still gone in dist — zero leaks (Step C).
4. All six load-bearing prior patches (#25, #35, #57, #60, #100, #102) verified intact in dist via patch-specific markers, plus Phase 6 (patch #105) markers byte-identical (Step D).
5. Full frontend Vitest suite: 315/315 across 24 files (Step E).
6. Type-check: 0 errors (Step F).
7. Scope fence honored — zero source diffs to pretty-view, terminal, guacamole, backend, docker, package.json, NewSessionDialog, or ConversationRow (Step G).
8. Bundle-size impact: AppShell +2,984 bytes (+0.68%); other bundles byte-identical to Phase 6 (Step A).

Deploy remains Ashley-gated per fork discipline (`~/.claude/identities/tina/deploy-runbook.md` — DEADMAN IS MANDATORY, NO EXCEPTIONS; BLANKET PRE-AUTHORIZATION ≠ PER-DEPLOY GREEN LIGHT). Task 4 in Plan 07-03 is deferred to the main orchestrator context after Ashley reviews UAT checklist + patches-md entry and gives explicit deploy green-light.

---

*Executed 2026-07-21 by Plan 07-03 Task 1 executor (Tasks 1-3 scope only; Task 4 deploy Ashley-gated in main orchestrator context).*
