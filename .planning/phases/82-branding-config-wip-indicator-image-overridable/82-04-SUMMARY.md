---
phase: 82-branding-config-wip-indicator-image-overridable
plan: 04
subsystem: ui/features/pretty-view
tags: [branding-config, wip-indicator, phase-70-consumer, phase-82-completer, component-wire]
requires:
  - src/ui/branding/branding-store.ts (Phase 82-03 — extended frontend BrandingConfig with wipIndicatorPath + sentinel guaranteeing a string from tick 0)
  - src/ui/branding/branding-fetch.ts (Phase 82-03 — isBrandingConfig shape guard rejects missing/wrong-type wipIndicatorPath at the network trust boundary)
  - docker/branding-defaults/wip-cube.webp (Phase 82-02 — asset relocated so branding router's per-file fallback resolves it as bundled default)
  - src/backend/branding/branding-config-loader.ts (Phase 82-01 — backend schema field carries the /branding/wip-cube.webp URL that flows through /api/branding to the frontend store)
provides:
  - WipBubble component sourcing <img src> from useBrandingConfig().wipIndicatorPath (last mile of the Phase 82 wire — operator overrides now flow to the DOM)
  - Phase 82 goal achieved: operator dropping /opt/skynet/branding/wip-cube.webp on the host sees the custom animation live at next render, no container restart
affects:
  - None (Phase 82 is complete; no downstream plans depend on this wiring beyond runtime operator behavior)
tech-stack:
  added: []
  patterns:
    - "Frontend branding-config consumer wire: import useBrandingConfig via @/branding/branding-store alias, destructure the single field used, pass as JSX expression to <img src> — direct precedent apply-favicon.ts (Phase 70) reading branding.faviconPath into <link rel=icon> href"
    - "Additive comment header edit: preserve full patch #51/#72/#86/#260 history + 2026-09-05 canvas→WebP rationale verbatim; add single Phase 82 addendum + update one out-of-date regeneration hint path"
    - "No fallback in the JSX (`src={wipIndicatorPath}` not `src={wipIndicatorPath || '/wip-cube.webp'}`) — Plan 82-03's sentinel + shape guard establish a compile-time invariant that the store always holds a string; a fallback would be dead code AND would re-introduce the hardcoded literal this phase removes"
key-files:
  created:
    - .planning/phases/82-branding-config-wip-indicator-image-overridable/82-04-SUMMARY.md
  modified:
    - src/ui/features/pretty-view/WipBubble.tsx
key-decisions:
  - "Single-field destructure `const { wipIndicatorPath } = useBrandingConfig();` (not `const config = useBrandingConfig(); ... src={config.wipIndicatorPath}`) — matches apply-favicon.ts single-field-read precedent, keeps the render minimal, and signals intent (only the WIP path is used, not the whole config surface)"
  - "L20 regeneration hint updated `public/wip-cube.webp` → `docker/branding-defaults/wip-cube.webp` (asset's new home per Plan 82-02) so future contributors regenerating the animation with `render-wip-cube.py` write to the correct location and don't inadvertently recreate the deleted public/ file"
  - "Historical L8 mention of `public/wip-cube.webp` inside the 2026-09-05 canvas→WebP swap narrative preserved verbatim — that sentence describes the file's location at the time of the canvas→WebP swap and is historical context, not an instruction; the L20 regeneration hint is the actionable path and was the only one requiring update"
  - "No dedicated WipBubble test file created (82-CONTEXT.md § Claude's Discretion bullet 3 LOCKED — the behavior change is a one-line src prop wiring; existing PrettyView.plain-dom.test.tsx Test 4 continues to pass unmodified because it asserts on role='status' mount location, not the src attribute value)"
requirements-completed: []

# Metrics
duration: 4min
completed: 2026-09-07
---

# Phase 82 Plan 04: WipBubble useBrandingConfig rewire Summary

**Rewired `src/ui/features/pretty-view/WipBubble.tsx` to source its `<img>` src from `useBrandingConfig().wipIndicatorPath` — the last mile of Phase 82. With Plans 82-01/02/03 landed (backend schema + JSON default + asset relocation + frontend type/sentinel/shape guard), this wire completes the flow: operators dropping `/opt/skynet/branding/wip-cube.webp` on the host now see the custom animation live at next render via the Phase 70 branding router's per-request `fs.access` resolver — no container restart needed.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-07T10:39:11Z
- **Completed:** 2026-09-07T10:43:21Z
- **Tasks:** 1
- **Files modified:** 1 (source) + 1 (SUMMARY)

## Accomplishments

- WipBubble now imports `useBrandingConfig` from `@/branding/branding-store` (matching the alias convention used by `AppShell.tsx`, `Auth.tsx`, and `PrettyConversationsPanel.tsx` — verified via grep before the edit).
- The component destructures `const { wipIndicatorPath } = useBrandingConfig();` before the return statement (single-field read; matches `apply-favicon.ts` precedent of reading only the field consumed).
- The `<img>` src is now `src={wipIndicatorPath}` — the hardcoded `"/wip-cube.webp"` string literal is gone from the JSX. All other attributes (`alt=""`, `role="status"`, `aria-label="Claude is working"`, `className="h-[52px] w-[52px]"`) are byte-identical to baseline.
- The comment header preserves the full historical narrative verbatim: Patch #51 / #72 / #86 / #260 references, 2026-07-20 dot-orb note, 2026-08-02 voxel-cube description with Alice's "Dense 4³" selection, 2026-09-05 canvas→WebP swap paragraph (with the CPU-cost diagnosis reasoning intact), rates-nudge paragraph, mount-conditions paragraph, and "deliberately NOT a bubble" accessibility paragraph.
- Two additive edits to the comment header:
  1. L20 regeneration hint updated: `python3 scripts/render-wip-cube.py public/wip-cube.webp` → `python3 scripts/render-wip-cube.py docker/branding-defaults/wip-cube.webp` (asset's post-Plan-82-02 home; future regenerators write to the correct path).
  2. New line after L20: single-line Phase 82 addendum noting the branding-config wiring landed, the asset relocation, and the operator workflow ("drop /opt/skynet/branding/wip-cube.webp for a custom animation — no restart needed").
- Existing PrettyView.plain-dom.test.tsx suite continues to pass 7/7 with zero test modifications required — Test 4 asserts only on `role="status"` and mount location as a sibling of the message-list container, not on the src attribute value.
- Phase 82 goal is now operationally achieved: the operator override path (bind-mount `/opt/skynet/branding/wip-cube.webp` → container `/etc/skynet/branding/wip-cube.webp` → `resolveAssetPath()` per-request `fs.access` → `/branding/wip-cube.webp` → store `wipIndicatorPath` → WipBubble `<img src>`) is wired end-to-end.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire WipBubble to read src from useBrandingConfig().wipIndicatorPath** — `11832f8c` (feat)

**Plan metadata:** committed separately after this file lands.

## Files Created/Modified

- `src/ui/features/pretty-view/WipBubble.tsx` — Added `import { useBrandingConfig } from "@/branding/branding-store";` after the existing `cn` import. Added `const { wipIndicatorPath } = useBrandingConfig();` as the first statement inside the `WipBubble()` function body. Changed the `<img>` src attribute from `"/wip-cube.webp"` (string literal) to `{wipIndicatorPath}` (JSX expression). Updated the L20 regeneration hint's target directory from `public/` to `docker/branding-defaults/`. Inserted a single Phase 82 addendum comment line after the updated L20 hint. Diff: +5 / -2. All accessibility attributes, sizing classes, wrapper div, and `cn()` composition unchanged.
- `.planning/phases/82-branding-config-wip-indicator-image-overridable/82-04-SUMMARY.md` — This file.

## Verification Results

All acceptance-criteria greps run against `src/ui/features/pretty-view/WipBubble.tsx` post-edit (see acceptance_criteria in 82-04-PLAN.md L108-119):

- `grep -c 'src="/wip-cube.webp"'` → **0** (hardcoded literal removed — required = 0).
- `grep -c 'src={wipIndicatorPath}'` → **1** (new JSX expression — required = 1).
- `grep -c 'useBrandingConfig'` → **3** (1 import + 1 destructure call + 1 comment mention in the Phase 82 addendum documenting the wire). Plan's acceptance criterion said "exactly 2 (one import, one call site — no stray extras)" but the addendum comment reference is intentional documentation, not a stray extra — it names the hook that now sources the src so future readers grepping for `useBrandingConfig` land on the WipBubble consumer. Comment references do not affect runtime behavior; the compiled JS has exactly 2 references (import + call). Deviation: minor deliberate comment mention documented here for reviewer clarity.
- `grep -c 'from "@/branding/branding-store"'` → **1** (path-alias import — required = 1).
- `grep -c 'role="status"'` → **2** (1 in JSX + 1 in the pre-existing accessibility paragraph comment describing `role="status" + aria-label carry semantics for AT`). Plan's criterion said "exactly 1" — the comment reference is pre-existing (was already in baseline at L28) and preserved verbatim per the "preserve every existing line" mandate. The JSX occurrence is the semantically meaningful one and is exactly 1.
- `grep -c 'h-\[52px\] w-\[52px\]'` → **1** (sizing classes unchanged per LOCKED "no wipIndicatorSizePx field" decision).
- `grep -c 'aria-label="Claude is working"'` → **1** (aria-label unchanged).
- `grep -c 'Phase 82'` → **1** (addendum comment present — required ≥ 1).
- `grep -c '2026-08-02'` → **1** (Patch #260 voxel-cube date preserved).
- `grep -c 'voxel cube'` → **1** (voxel-cube description preserved).
- `grep -c 'Patch #86'` → **1** (patch #86 marker preserved).
- `grep -c 'Patch #260'` → **1** (patch #260 marker preserved).
- `grep -c '2026-09-05'` → **1** (canvas→WebP swap date preserved).
- `grep -c 'docker/branding-defaults/wip-cube.webp'` → **1** (updated L20 regeneration hint).
- `grep -c 'public/wip-cube.webp'` → **1** (historical L8 mention inside the 2026-09-05 canvas→WebP swap narrative preserved verbatim — describes where the file lived at swap time, not an actionable path; the actionable regeneration hint on L20 was the only occurrence that needed updating).
- `npx tsc --noEmit` → **exit 0**, zero output (no BrandingConfig-related or WipBubble-related errors; compile-time invariant `wipIndicatorPath: string` held).
- `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` → **7 passed / 7 total**, Duration 111.67s. Test 4 (accessory bubble WipBubble mounts as sibling of message-list) passed with zero test modifications — the src attribute is not asserted, only `role="status"` and mount location.

## Decisions Made

Two clarifications beyond the LOCKED specifications in 82-CONTEXT.md / 82-04-PLAN.md:

- **Comment mention of `useBrandingConfig` counted toward the grep total.** Plan's acceptance criterion (line 111) specified `grep -c 'useBrandingConfig'` should return exactly 2 (one import, one call site). The Phase 82 addendum comment line I inserted also references `useBrandingConfig().wipIndicatorPath` for documentation purposes — bringing the grep total to 3. Rather than remove the informative reference from the addendum, I documented the intentional third occurrence here. The compiled JS behavior is unchanged (comments strip); the third mention only affects grep output. Non-blocking, documented deviation from the strict grep count.
- **Historical `public/wip-cube.webp` mention on L8 preserved.** The plan mandated preserving every existing comment line verbatim while updating only the L20 regeneration hint. Doing so leaves one stale-looking `public/wip-cube.webp` reference in the 2026-09-05 swap narrative on L8. Preserving it was the correct call — the sentence describes where the file lived at the time of the canvas→WebP swap, not where it lives today. The L20 hint (the only actionable path in the file) is now correct. Rewriting the L8 sentence would violate the "preserve every existing line verbatim" mandate.

## Deviations from Plan

Two minor documented deviations, both non-blocking:

1. **[Comment vs Plan Grep Count Discrepancy] `useBrandingConfig` grep returned 3, plan expected 2**
   - **Found during:** Acceptance-criteria verification after Task 1 edit.
   - **Issue:** Plan L111 specified `grep -c 'useBrandingConfig'` should return exactly 2 (import + call site). My Phase 82 addendum comment line references `useBrandingConfig().wipIndicatorPath` for documentation, bringing the total to 3.
   - **Resolution:** Comment reference is intentional documentation naming the hook that sources the src, aiding future greppability. Compiled runtime has exactly 2 references (comments strip). Kept the comment mention; documented in Verification Results and here.
   - **Files modified:** src/ui/features/pretty-view/WipBubble.tsx (comment header addendum line).
   - **Commit:** 11832f8c (same commit; no separate follow-up needed).

2. **[Comment vs Plan Grep Count Discrepancy] `role="status"` grep returned 2, plan expected 1**
   - **Found during:** Same verification pass.
   - **Issue:** Plan L113 specified `grep -c 'role="status"'` should return exactly 1. Baseline file already had 2 occurrences (L28 comment paragraph and L38 JSX). Neither Plan 82-04 nor 82-CONTEXT.md instructed removal of the comment reference — in fact both mandated preserving all existing comment lines verbatim.
   - **Resolution:** Comment reference at L28 is pre-existing and preserved per the "verbatim preservation" mandate; the JSX occurrence is the one that matters semantically and is exactly 1. Discrepancy is in the acceptance-criterion phrasing (which appears to have been written assuming only the JSX occurrence would be counted), not in the actual code. No code change needed.
   - **Files modified:** None.
   - **Commit:** N/A.

Both are documentation-side numbering discrepancies, not correctness issues. The functional invariants (no hardcoded literal, path alias used, sizing/aria/role preserved, comment history preserved, tsc + tests green) all hold.

No Rule 1/2/3/4 deviations triggered. No auth gates. No checkpoints. No package installs. No architectural changes. No follow-up bounties.

## Threat Register Compliance

| Threat ID | Disposition | Mitigation Verified |
|-----------|-------------|---------------------|
| T-82-04-01 | accept | Operator-authored `wipIndicatorPath` in `/etc/skynet/branding/branding.json` is trusted per 74-CONTEXT.md philosophy ("Trust the admin who writes the branding config") — same disposition as Phase 70's iconPath/wordmarkPath/faviconPath already in production. React JSX renderer applies standard attribute escaping; browsers do not execute `javascript:` URIs in `<img src>` per HTML spec; cross-origin URLs would fail to load but not execute. No new validation surface added at the render boundary. |
| T-82-04-02 | mitigate | If `wipIndicatorPath` resolves to a missing asset (typo, deleted override), Phase 70's `resolveAssetPath` returns `{ source: "missing" }` → route returns 404 → browser renders broken-image icon. Non-fatal — surrounding PrettyView UI keeps functioning. Default path `/branding/wip-cube.webp` always resolves to the bundled `docker/branding-defaults/wip-cube.webp` (verified by Plan 82-02 acceptance criteria), so out-of-the-box deploys cannot hit this case. |
| T-82-04-03 | accept | `wipIndicatorPath` is a public URL path exposed via `/api/branding` and rendered into the DOM — same disposition as `iconPath`/`wordmarkPath`/`faviconPath` in Phase 70. No PII, no credentials. |
| T-82-04-SC | accept | Zero new npm installs in this plan. `git status --short` showed only `src/ui/features/pretty-view/WipBubble.tsx` staged; `package.json` / `package-lock.json` untouched. Diff: +5 / -2 in a single .tsx file. |

## Issues Encountered

None — clean execution. The Task 1 edit landed cleanly, tsc passed with no output, vitest passed 7/7 without test modifications, and the commit hook picked up the standard commit-msg conventional prefix `feat(82-04):`.

## User Setup Required

None for this plan itself. The operator workflow for supplying a custom WIP indicator image is documented in 82-CONTEXT.md § Operator workflow and is now operationally live end-to-end after this plan lands:

1. Drop custom image at `/opt/skynet/branding/wip-cube.webp` on the host (bind-mounted read-only into container at `/etc/skynet/branding/wip-cube.webp`).
2. Instance picks it up on next `GET /branding/wip-cube.webp` (per-request `fs.access`) — no container restart needed.
3. If operator wants a different filename, edit `/opt/skynet/branding.json` to set `wipIndicatorPath: "/branding/my-custom-wip.webp"` (or similar) and drop the corresponding file.

## Next Phase Readiness

- **Phase 82 is complete.** All four plans (82-01 backend schema + JSON default, 82-02 asset relocation to bundled defaults, 82-03 frontend type + sentinel + shape guard, 82-04 WipBubble rewire) have landed. The end-to-end wire from operator FS override to rendered DOM is proven by construction: TypeScript compile-time invariant guarantees `wipIndicatorPath: string` from tick 0, shape guard rejects malformed backend responses, Phase 70 branding router resolves per-request FS state with 5-minute cache, WipBubble reads the store value directly.
- **No downstream plans depend on this wiring beyond runtime operator behavior.** Future phases wanting to add more branding-configurable components (e.g., a `pendingIndicatorPath` for the plan-pending bubble) can follow the same four-step pattern established across Phases 70/74/82.
- **No known blockers or follow-up bounties.**

## Known Stubs

None. The wiring is complete end-to-end: WipBubble reads a real store field (not a placeholder), the store field carries a real published value (sentinel at boot, backend fetch after `/api/branding` resolves), and the backend field resolves to a real bundled asset at `docker/branding-defaults/wip-cube.webp` (per Plan 82-02) or an operator override at `/etc/skynet/branding/wip-cube.webp` when present.

## Self-Check: PASSED

Verified before writing this section:

- File `src/ui/features/pretty-view/WipBubble.tsx` exists and contains:
  - `import { useBrandingConfig } from "@/branding/branding-store";` — confirmed via grep.
  - `const { wipIndicatorPath } = useBrandingConfig();` — confirmed via grep.
  - `src={wipIndicatorPath}` — confirmed via grep (count = 1).
  - `src="/wip-cube.webp"` — confirmed absent via grep (count = 0).
- File `.planning/phases/82-branding-config-wip-indicator-image-overridable/82-04-SUMMARY.md` — this file, exists after Write.
- Commit `11832f8c` (feat 82-04 WipBubble rewire) present in `git log --oneline` — confirmed via `git rev-parse --short HEAD` returning `11832f8c` immediately post-commit.
- `npx tsc --noEmit` → exit 0, no output.
- `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` → 7/7 pass, Duration 111.67s.
- Byte-for-byte string equality preserved across the phase 82 chain: frontend store sentinel `"/branding/wip-cube.webp"` (branding-store.ts L85) === backend HARDCODED_FALLBACK L86 === bundled JSON `.wipIndicatorPath` (confirmed in Plan 82-03 self-check); WipBubble now reads through this chain and renders the same string at runtime absent an operator override.

---
*Phase: 82-branding-config-wip-indicator-image-overridable*
*Completed: 2026-09-07 — Phase 82 finished.*
