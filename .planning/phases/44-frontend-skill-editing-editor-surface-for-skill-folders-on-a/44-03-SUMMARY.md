---
phase: 44-frontend-skill-editing-editor-surface-for-skill-folders-on-a
plan: 03
subsystem: integration
tags:
  - skynet-fork
  - skills-editor
  - integration
  - uat
  - pretty-conversations
  - handoff

# Dependency graph
requires:
  - phase: 44
    plan: 01
    provides: "7-endpoint /skills-editor backend router + twin nginx blocks — the network surface the Wave 3 mount consumes end-to-end"
  - phase: 44
    plan: 02
    provides: "SkillsEditorModal (with open/onOpenChange/hostTree/defaultHostId props matching GlobalFilesModal byte-shape) + SkillFileTab + DeleteConfirmDialog + skills-api — the component surface the Wave 3 mount imports"
  - phase: 23
    provides: "GlobalFilesModal wiring pattern in PrettyConversationsPanel.tsx (L60 import / L485 useState / L1583 portal mount / L1616 menu-item entry) — this plan mirrors the pattern parallel-sibling style"
provides:
  - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx — 16-line delta wiring the SkillsEditorModal into the panel-header ⋮ menu at position 4 (after Edit global files…)"
  - ".planning/phases/44-.../44-UAT-CHECKLIST.md — 260-line / 14-Step Ashley-facing walkthrough covering D-01..D-16 with Action / Expected / Pass-Fail sub-fields"
  - ".planning/phases/44-.../44-PATCH-DRAFT.md — 118-line skynet-patches.md entry draft ready for orchestrator PIN (motivation, what shipped, backend + frontend surfaces tables, path-safety design, deploy note, rebase risk, related)"
  - "KEEP ORDER: New agent → New role → Edit global files… → Edit skills… guard comment above the menu-items array (T-44-16 regression guard against alphabetization / refactor drift)"
affects:
  - "Deploy pipeline — orchestrator now has PATCH-DRAFT.md ready for the skynet-patches.md pin + docker build + container recreate + HTTPS 200 verify + coord-room announces + 15-min deadman timer"
  - "Ashley UAT walk — orchestrator hands UAT-CHECKLIST.md to Ashley post-deploy for sign-off before considering the phase closed"

# Tech tracking
tech-stack:
  added: []  # No new packages (SkillsEditorModal + its deps landed in Wave 2)
  patterns:
    - "Parallel-sibling menu-wiring: state + portal mount + menu-item entry positioned alongside the Phase 23 GlobalFilesModal wiring — same idiom, same three landmark positions in PrettyConversationsPanel.tsx"
    - "Menu-order guard comment (KEEP ORDER: …) as a T-44-16 mitigation for the tampering vector where a refactor reorders or drops the entry"

key-files:
  created:
    - ".planning/phases/44-.../44-UAT-CHECKLIST.md (260 lines / 15KB — 14 UAT Steps + prep + post-walk sign-off)"
    - ".planning/phases/44-.../44-PATCH-DRAFT.md (118 lines / 14KB — draft ready for skynet-patches.md PIN at ship time)"
    - ".planning/phases/44-.../44-03-SUMMARY.md (this file)"
  modified:
    - "src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (+16 -0 lines — import + useState + portal mount + menu item + KEEP ORDER comment)"

key-decisions:
  - "Placed the SkillsEditorModal mount as an immediate JSX sibling of the GlobalFilesModal mount (not wrapped in a fragment, not lifted to a separate ModalsRegion). Minimizes the diff to the panel component; matches the plan's byte-shape mandate."
  - "Used two comment landmarks (Phase 44 SKILLED-01 on the state + on the mount) to make the parallel-sibling relationship greppable from a fresh reader — mirrors the Phase 23 GEFM-05 comment discipline."
  - "KEEP ORDER guard comment placed OUTSIDE the array literal (as a JSX comment block above the map's `{[` opening) rather than inside as a code comment — this keeps the array literal a clean structural token so future refactors that reformat the array (Prettier's line-per-item, etc.) don't accidentally push the comment inside a specific item's position."
  - "UAT checklist framed as Ashley-does-it-in-the-app steps, never CLI commands, per the box-maintainer role file. Two exceptions where a CLI check was necessary (Step 10 host-side ls verification, Step 13 DevTools console fetch) are called out explicitly as maintainer-assisted."

patterns-established:
  - "Wave 3 wiring convention for a Phase-23-style mirror-and-fork phase: parallel-sibling in exactly three landmark positions (import / useState / portal mount) + one menu-item entry with a KEEP ORDER guard. Diff should be <20 lines."
  - "Handoff artifact pair convention: UAT-CHECKLIST.md (user-facing, per-decision Steps) + PATCH-DRAFT.md (maintainer-facing, ready for skynet-patches.md pin) live in the phase directory alongside per-plan SUMMARY.md files."

requirements-completed: []  # Plan frontmatter has requirements: [] — phase derives from CONTEXT.md D-01..D-16, not REQ-IDs

# Metrics
duration: 13m 19s
completed: 2026-08-19
---

# Phase 44 Plan 03: Wire SkillsEditorModal into PrettyConversationsPanel menu + generate handoff artifacts — Summary

**Landed the 16-line panel-wiring delta that makes the Phase 44 skill editor reachable from the pretty-conversations panel-header ⋮ menu, then generated the UAT checklist and patch draft the orchestrator needs to close the phase. Full test suite green (2592/2602 pass, 0 fail); no deploy work performed per executor scope.**

## Performance

- **Duration:** ~13m 19s (executor time from plan start to SUMMARY write)
- **Started:** 2026-08-19T04:34:12Z
- **Completed:** 2026-08-19T04:47:31Z
- **Tasks:** 2 completed
- **Files created:** 3 (UAT-CHECKLIST.md + PATCH-DRAFT.md + this SUMMARY.md)
- **Files modified:** 1 (PrettyConversationsPanel.tsx, +16 -0 lines)

## Accomplishments

- **Wired SkillsEditorModal into PrettyConversationsPanel with minimum diff** — 16-line delta across 4 landmark positions: import (L61), useState (L487), portal mount (L1590-1599), menu item (L1632) + KEEP ORDER guard comment (L1627). Zero behavior changes to existing global-files / new-session / new-role flows.
- **Menu ordering guarded** — the KEEP ORDER comment above the menu-items array (T-44-16 mitigation) explicitly locks the sequence to `New agent → New role → Edit global files… → Edit skills…`. UAT Step 1 verifies the ordering post-deploy; grep-based acceptance criterion asserts the source-line ordering.
- **Full test suite green** — `npx vitest run` on the wired panel: 2592 pass / 9 skipped / 1 todo / 0 fail (exit 0). Cleaner than Wave 1's baseline; no cross-identity contention flakes this run. Wave 3 wiring introduces zero regressions.
- **UAT-CHECKLIST.md delivers Ashley's post-deploy walkthrough** — 260 lines / 14 Steps covering every D-01..D-16 decision + regression guards + path-safety verification. Framed for iPhone-primary PWA use; fast-path steps first (menu → host → skill → tab → edit → save); destructive paths (delete-file, delete-skill) and path-safety attack-input verification (Step 13) covered with explicit expected outcomes.
- **PATCH-DRAFT.md ready for orchestrator PIN** — 118 lines / 7 mandated sections (motivation, what shipped, backend + frontend surface tables, path-safety design, files touched, deploy note, rebase risk, related). References patch #446 (layer-enumeration reflex) in both the shipped section and the related section. Deploy note includes verify-in-bundle byte-check strings the orchestrator can grep post-deploy.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: Wire SkillsEditorModal into PrettyConversationsPanel — three-point edit** — `a385a7a9` (feat)
2. **Task 2: Full test suite green + UAT checklist + patch draft** — `05ef8206` (docs)

## Files Created/Modified

### Modified

- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`** (+16 -0 lines) — four landmark additions:
  - **L61** (import): `import SkillsEditorModal from "@/features/pretty-view/SkillsEditorModal";` immediately after the existing `GlobalFilesModal` import.
  - **L486-487** (state): `// Phase 44 SKILLED-01: SkillsEditorModal open/closed toggle (opened from menu item, sibling of GlobalFilesModal).` + `const [skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false);` immediately after the existing `globalFilesModalOpen` state.
  - **L1589-1599** (portal mount): 5-line JSDoc comment mirroring the GEFM-05 header shape + `<SkillsEditorModal open={skillsEditorModalOpen} onOpenChange={setSkillsEditorModalOpen} hostTree={hostTree ?? null} defaultHostId={null} />` mount as immediate JSX sibling of the GlobalFilesModal mount. `defaultHostId={null}` is deliberate — panel-header trigger has no active-conversation context.
  - **L1627** (KEEP ORDER guard comment) + **L1632** (fourth menu-item entry): `{ label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) },` positioned AFTER `Edit global files…` (menu-order lock per UI-SPEC L112 and Pitfall 8).

### Created

- **`.planning/phases/44-.../44-UAT-CHECKLIST.md`** (260 lines / ~15KB) — 14-Step Ashley-facing walkthrough. Every Step has `**D-XX**` reference, `**Action:**`, `**Expected:**`, and `**Pass/Fail:** ☐ Pass ☐ Fail — Notes:` sub-fields. Coverage:
  - **Fast-path (Steps 1-6):** menu ordering (D-01) → modal opens (D-02) → skill dropdown appears (D-03) → file tabs load with flat path-relative labels (D-04, D-05) → many-file horizontal scroll (D-06) → text-file edit + save (D-07).
  - **Branch coverage (Steps 7-10):** non-text placeholder AlertTriangle (D-08) → `+ Add file` prompt round-trip with subpath + duplicate rejection (D-09) → delete-file confirm dialog with copy verification (D-10) → delete-skill confirm dialog (D-11).
  - **Regression guards (Steps 11-14):** menu item no-icon-no-shortcut-no-badge (D-01 + UI-SPEC L116) → GlobalFilesModal still works (D-01 regression) → path-safety DevTools attack input (D-16 / T-44-02) → Esc closes but outside-click does NOT (D-02 modal chrome inheritance).
  - **Prep section** + **post-walk sign-off** with cleanup reminders for throwaway UAT skills.
- **`.planning/phases/44-.../44-PATCH-DRAFT.md`** (118 lines / ~14KB) — skynet-patches.md entry draft ready for orchestrator PIN at ship time. All 7 mandated sections present:
  - `## Motivation` — Ashley's fast-path trigger, three selections max
  - `## What shipped` — backend router + 7 endpoints + 6 new frontend files + panel wiring delta + twin nginx blocks
  - `## Backend surface` — 7-row endpoints table with method / path / body / 200 response / notable errors
  - `## Frontend surface` — 5-row components table with role
  - `## Path-safety design` — four-layer defense paragraph (SKILL_NAME_RE + isSafeRelativePath + buildAbsSkillFilePath prefix assertion + shellEscape) + SEC-1..SEC-8 test coverage callout
  - `## Files touched` — 8 created (with line counts) + 5 modified (with line counts)
  - `## Deploy note` — mandatory 15-min deadman timer + full container rebuild (twin nginx blocks NOT css fast-path) + verify-in-bundle grep strings + live-fire HTTPS curl example
  - `## Rebase risk` — LOW rationale with 5 bullet items
  - `## Related` — Phase 23, patch #446, quick-260805-7rq, patch #1503c40c (Wave 1 test-drift fix)
  - `## Bounty tracker` — reference to box-maintainer bounty tree (orchestrator fills in at PIN time)

## Verification Evidence

```bash
# Task 1: grep-based landmark verification
$ grep -c "skillsEditorModalOpen\|SkillsEditorModal" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
8   # (>=5 required — import + state x2 + JSX open + open prop + onOpenChange prop + menu onClick + comment)

$ grep -c "Edit skills" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
3   # (comment + menu-item label + KEEP ORDER guard)

$ grep -c "KEEP ORDER" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
1

$ grep -n "Edit skills\|Edit global files" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
1180:                Edit global files…. Gated on the same showPencilButton
1583:          "Edit global files…" item. defaultHostId={null} is deliberate: the
1593:          GlobalFilesModal. Opened via the header menu's "Edit skills…" item.
1627:          {/* KEEP ORDER: New agent → New role → Edit global files… → Edit skills… (Phase 44 Pitfall 8 guard — do not alphabetize or reshuffle). */}
1631:            { label: "Edit global files…", onClick: () => setGlobalFilesModalOpen(true) },
1632:            { label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) },
# → L1631 (Edit global files…) < L1632 (Edit skills…) ✓ ordering correct

$ git diff --stat src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
1 file changed, 16 insertions(+)
# (<20 lines required — 16 ✓)

$ npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error TS" | head -20
# (empty output — 0 errors)

# Task 2: full-suite green + artifact acceptance
$ npx vitest run 2>&1 | tail -5
 Test Files  202 passed (202)
      Tests  2592 passed | 9 skipped | 1 todo (2602)
   Start at  04:35:13
   Duration  512.03s
# (exit 0 ✓)

$ wc -l .planning/phases/44-.../44-UAT-CHECKLIST.md .planning/phases/44-.../44-PATCH-DRAFT.md
  260 44-UAT-CHECKLIST.md   # (>=60 required ✓)
  118 44-PATCH-DRAFT.md     # (>=40 required ✓)

$ grep -cE "^## Step " .planning/phases/44-.../44-UAT-CHECKLIST.md
14   # (>=14 required ✓)

$ grep -c '\*\*D-' .planning/phases/44-.../44-UAT-CHECKLIST.md
14   # (>=14 required ✓)

$ grep -c "Pass/Fail:" .planning/phases/44-.../44-UAT-CHECKLIST.md
14   # (>=14 required ✓)

$ for h in "## Motivation" "## What shipped" "## Backend surface" "## Frontend surface" "## Path-safety design" "## Deploy note" "## Rebase risk"; do echo -n "$h: "; grep -c "^$h" .planning/phases/44-.../44-PATCH-DRAFT.md; done
## Motivation: 1
## What shipped: 1
## Backend surface: 1
## Frontend surface: 1
## Path-safety design: 1
## Deploy note: 1
## Rebase risk: 1
# (all 7 required sections present ✓)

$ grep -c "patch #446" .planning/phases/44-.../44-PATCH-DRAFT.md
3   # (>=1 required ✓)

$ grep -cE "TODO|FIXME" .planning/phases/44-.../44-PATCH-DRAFT.md
0   # (must be 0 ✓)
```

## Decisions Made

1. **Mount SkillsEditorModal as an immediate JSX sibling of GlobalFilesModal** — not wrapped in a fragment, not lifted to a separate `ModalsRegion` component. Minimizes the diff to `PrettyConversationsPanel.tsx`; matches the plan's byte-shape mandate; the two modals never render simultaneously (they're both opened from mutually-exclusive menu clicks), so no z-index conflict.
2. **KEEP ORDER guard placed as a JSX comment ABOVE the array literal** — not as a code-comment inside the array. Rationale: keeps the array literal a clean structural token; future refactors (Prettier's line-per-item reformat, ESLint's array-order-check rule, etc.) don't push the comment into an arbitrary item's position. The guard is intended to be read by humans before they touch the array, so it lives above the opening bracket where a code review can't miss it.
3. **Two Phase 44 SKILLED-01 comment landmarks (on state + on mount)** — mirrors the Phase 23 GEFM-05 comment discipline for parallel-sibling wiring. Makes the relationship between the state / mount / menu-item greppable from a fresh reader without having to trace through the whole 1700-line panel component.
4. **UAT checklist steps are Ashley-does-it-in-the-app, never CLI commands** — the two exceptions where a CLI check is unavoidable (Step 10 host-side `ls` verification of skill deletion, Step 13 DevTools console `fetch` for path-safety attack inputs) are explicitly called out as maintainer-assisted, per the box-maintainer role file's "audience is Ashley on iPhone-primary PWA" instruction.
5. **PATCH-DRAFT.md leaves patch number as `#TBD` and bounty path as a placeholder** — the orchestrator claims a real patch number at ship time (mirror of skynet-patches.md's numbered patch discipline) and confirms the box-maintainer's local bounty path (`~/.claude/roles/box-maintainer/bounties/frontend-skill-editing/`) at PIN time.

## Deviations from Plan

**None from the plan's byte-shape mandate.** Every plan action executed as specified:
- Import at L61 (immediately after GlobalFilesModal import at L60): ✓
- State declaration at L486-487 (immediately after globalFilesModalOpen at L485): ✓
- Portal mount at L1589-1599 (immediately after GlobalFilesModal mount at L1583-1588): ✓
- Menu item at L1632 (immediately after Edit global files… at L1631, position 4): ✓
- KEEP ORDER guard comment at L1627 (above the menu-items array opening bracket): ✓
- All 14 UAT Steps covering the 14 mandated verifications: ✓
- All 7 mandated PATCH-DRAFT.md sections: ✓

Two minor implementation choices are documented in "Decisions Made" (KEEP ORDER comment placement style, comment-landmark discipline) — neither deviates from stated requirements.

## Issues Encountered

None. Both tasks executed cleanly:
- Task 1: 4 Edits, 0 typescript errors, 16-line diff (<20 required).
- Task 2: full-suite vitest exit 0 on first run, both artifacts written with all acceptance criteria met on first draft (one small addition: added D-XX refs to Steps 12 and 14 to lift the `**D-` grep count from 12 to 14 required).

## Deferred Issues (out of Phase 44 Plan 03 scope)

None triggered during this plan. Wave 1 documented DEF-1 (PrettyView.windowed-pagination RED-phase spec — 43-07b responsibility) and DEF-2 (cross-identity contention flakes); Wave 2 confirmed neither surfaced. Wave 3's full-suite run reaffirms: no failures, no flakes, box was quiet.

## Authentication Gates

None — this plan is purely code + docs. No auth prompts needed.

## Known Stubs

None. The Wave 3 wiring is a real, complete integration — every menu-item onClick fires a real state setter, every portal mount receives the real component with real props, and every JSX branch renders the real Wave 2 component. No hardcoded placeholders, no "TODO wire this up later", no mock data anywhere in the panel delta.

## Handoff — Orchestrator's Next Motion

Executor scope ends here. Orchestrator owns:

1. **skynet-patches.md PIN** — copy `44-PATCH-DRAFT.md` into `~/.claude/roles/box-maintainer/skynet-patches.md` with a real patch number claimed (replacing `#TBD`). Do NOT let the executor touch skynet-patches.md.
2. **Docker build + container recreate** — `docker compose build skynet && docker compose up -d --force-recreate skynet` (twin nginx blocks require full rebuild, NOT css fast-path).
3. **15-min deadman timer** — `/opt/skynet/.tmp-revert.sh 15m` BEFORE recreate completes.
4. **HTTPS 200 verify** — live-fire `curl -sS -H "Authorization: Bearer $TOKEN" "https://gigaashley.click/skills-editor/skills?hostId=<n>" | jq` and confirm JSON payload shape (NOT the frontend index.html — that would mean the nginx block is missing).
5. **Verify-in-bundle byte checks** — grep the deployed bundle for `"Edit skills…"`, `"skills-editor/skills"`, and either `"SkillsEditorModal"` (unminified) or `"Edit skills"` fallback.
6. **Cancel the deadman** — only after Steps 4-5 pass.
7. **Coord-room announcement** — post that patch #<claimed> landed with the UAT-CHECKLIST.md link for Ashley to walk when she's ready.
8. **Bounty close** — mark the box-maintainer bounty at `~/.claude/roles/box-maintainer/bounties/frontend-skill-editing/` as delivered once Ashley signs off on the UAT.

## Self-Check: PASSED

- ✓ `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` modified (+16 -0 lines confirmed by `git diff --stat`)
- ✓ `.planning/phases/44-.../44-UAT-CHECKLIST.md` exists (260 lines)
- ✓ `.planning/phases/44-.../44-PATCH-DRAFT.md` exists (118 lines)
- ✓ `.planning/phases/44-.../44-03-SUMMARY.md` exists (this file)
- ✓ Commit `a385a7a9` exists in git log (Task 1)
- ✓ Commit `05ef8206` exists in git log (Task 2)
- ✓ `npx tsc --noEmit -p tsconfig.json` exits 0
- ✓ `npx vitest run` = 2592 pass / 9 skipped / 1 todo / 0 fail (exit 0)
- ✓ Menu-item ordering source-line-verified: L1631 (Edit global files…) < L1632 (Edit skills…)
- ✓ KEEP ORDER guard present exactly once
- ✓ UAT checklist has 14 Steps + 14 D-XX refs + 14 Pass/Fail sub-fields
- ✓ PATCH-DRAFT.md has all 7 mandated sections + patch #446 reference + 0 TODO/FIXME placeholders
- ✓ No deploy work performed (no `git push`, no `docker` commands, no coord-room touch, no skynet-patches.md edit)

---
*Phase: 44-frontend-skill-editing-editor-surface-for-skill-folders-on-a*
*Plan: 03*
*Completed: 2026-08-19*
