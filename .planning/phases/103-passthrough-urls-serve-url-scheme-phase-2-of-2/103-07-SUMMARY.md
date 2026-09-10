---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 07
subsystem: pretty-view
tags:
  - frontend
  - url-detection
  - regex
  - editable-file-whitelist
  - phase-103
  - d-29
requires:
  - src/ui/features/pretty-view/editable-file-whitelist.ts (existing TAILNET + FILE URL regexes)
  - src/backend/utils/editable-file-whitelist.ts (existing mirror-rule docblock)
provides:
  - SKYNET_SERVE_URL_RE_CLIENT — third sibling URL regex for serve URLs
  - Non-overlap invariant test coverage across the three sibling regexes
  - Backend docblock paper trail for Phase 103 mirror rule
affects:
  - Any future frontend consumer that needs to detect serve URLs in message bodies
tech-stack:
  added: []
  patterns:
    - sibling-regex extension (matches Phase 78 + Phase 40 precedent)
    - /g-flag gotcha docblock warning (references PATTERNS.md L444)
    - docstring-only backend mirror-rule bookkeeping
key-files:
  created:
    - (none — test file already existed from Phase 75; extended in place)
  modified:
    - src/ui/features/pretty-view/editable-file-whitelist.ts
    - src/ui/features/pretty-view/editable-file-whitelist.test.ts
    - src/backend/utils/editable-file-whitelist.ts
decisions:
  - "Serve URLs render as plain clickable links via ReactMarkdown default <a> behavior — no pencil affordance, no preview card (D-29 + D-30 defer custom visual to a future shape)"
  - "Frontend regex is the source of truth per PATTERNS.md mirror rule; backend gets docblock update only (no functional change since backend does its own explicit parse per D-11)"
  - "Non-overlap tests use fresh non-global regexes for dispatch-style .test() checks — mirrors the FILE_URL_DISPATCH_RE pattern in use-editable-file-eligibility.ts"
metrics:
  duration_seconds: 132
  completed_date: 2026-09-10
  tasks_completed: 2
  files_changed: 3
  commits: 3
---

# Phase 103 Plan 07: Frontend + backend serve URL regex detection Summary

Adds `SKYNET_SERVE_URL_RE_CLIENT` as a third sibling to the existing
`TAILNET_URL_RE_CLIENT` + `SKYNET_FILE_URL_RE_CLIENT` in the frontend
editable-file-whitelist module, matching the D-01 serve URL grammar
(`https://<hostname>-<port>.serve.term.<domain>[/path]`) per D-29's
plain-clickable-link approach. Backend twin gets a docstring-only mirror-rule
paragraph documenting that the regex is client-only (backend validates via
subdomain-dispatch's own parse per D-11). No whitelist data changes, no
edit-file eligibility wiring for serve URLs.

## What Was Built

### Task 1: SKYNET_SERVE_URL_RE_CLIENT + test coverage
- **`src/ui/features/pretty-view/editable-file-whitelist.ts`** (+51 lines)
  - New `SKYNET_SERVE_URL_RE_CLIENT` export:
    `/https:\/\/[a-zA-Z0-9._-]+-\d{1,5}\.serve\.term\.[a-zA-Z0-9.-]+(?::\d{1,5})?(?:\/[^\s)?#]*)?/g`
  - Full docblock covers: grammar (scheme, hostname per D-13 case preservation,
    port, `.serve.term.`, domain, optional path), D-11/D-12 registration
    constraint reference, /g gotcha warning referencing PATTERNS.md L444,
    D-29 "not threaded through eligibility" note, D-30 deferred visual bounty
    note, mirror-rule bookkeeping paragraph referencing the backend twin.
  - Existing `TAILNET_URL_RE_CLIENT` and `SKYNET_FILE_URL_RE_CLIENT` UNCHANGED.
  - Data arrays (`EDITABLE_EXTENSIONS`, `EDITABLE_BASENAMES`,
    `classifyByExtension`, `stripTrailingPunct`) UNCHANGED.
  - `use-editable-file-eligibility.ts` UNCHANGED — serve URLs are NOT added
    to the byte-sniff loop; they render as plain `<a>` per D-29.

- **`src/ui/features/pretty-view/editable-file-whitelist.test.ts`** (+112 lines)
  - Extended existing Phase 75 test file (which already imported
    `SKYNET_FILE_URL_RE_CLIENT` + `TAILNET_URL_RE_CLIENT`) rather than
    creating a parallel file.
  - New import: `SKYNET_SERVE_URL_RE_CLIENT`.
  - New `describe("SKYNET_SERVE_URL_RE_CLIENT ...")` block with 10 `it(` cases:
    1. matches basic serve URL
    2. matches serve URL with path
    3. matches serve URL with different hostname + port (thenasty-8080)
    4. matches mixed-case hostname (D-13 case preservation)
    5. rejects URL without a digit port (`foo-bar` has no numeric suffix)
    6. rejects a file URL (belongs to SKYNET_FILE_URL_RE_CLIENT)
    7. rejects a tailnet URL (belongs to TAILNET_URL_RE_CLIENT)
    8. rejects an arbitrary web URL
    9. rejects http:// scheme (HTTPS-only)
    10. uses the /g flag
  - New `describe("non-overlap invariants ...")` block with 3 reciprocal
    disjointness checks. Uses fresh non-global regex duplicates for
    dispatch-style `.test()` calls to keep /g state hygienic.
  - Total test count: 21 (10 pre-existing + 11 new); all pass.

### Task 2: Backend mirror-rule docblock update
- **`src/backend/utils/editable-file-whitelist.ts`** (+13 lines)
  - Appended a new `PHASE 103 D-29 MIRROR-RULE UPDATE (2026-09-10)`
    paragraph after the existing PHASE 75 paragraph in the top-of-file
    docblock.
  - Documents: the frontend twin has gained `SKYNET_SERVE_URL_RE_CLIENT`;
    backend does NOT re-export it; backend validates via subdomain-dispatch
    per D-11; whitelist data remains mirrored in lockstep; Phase 103 does
    NOT change whitelist data.
  - Zero code changes below the docblock. `EDITABLE_EXTENSIONS`,
    `EDITABLE_BASENAMES`, `classifyByExtension` unchanged byte-for-byte.

## Verification

### Automated
- `npx vitest run src/ui/features/pretty-view/editable-file-whitelist.test.ts`
  → 21/21 pass, exit 0.
- `npx tsc --noEmit` → exit 0 (whole-project typecheck clean).
- `grep -c 'SKYNET_SERVE_URL_RE_CLIENT' src/ui/features/pretty-view/editable-file-whitelist.ts`
  → 2 (declaration line + docblock reference).
- `grep 'serve\.term' src/ui/features/pretty-view/editable-file-whitelist.ts`
  → matches the regex literal.
- `grep 'PHASE 103.*MIRROR-RULE' src/backend/utils/editable-file-whitelist.ts`
  → matches (Task 2 acceptance).
- `! grep '^export const SKYNET_SERVE_URL' src/backend/utils/editable-file-whitelist.ts`
  → no code export leaked into backend file (docstring-only confirmed).

### Manual / spot-check
- Confirmed via file read that `use-editable-file-eligibility.ts` does NOT
  import `SKYNET_SERVE_URL_RE_CLIENT` and therefore serve URLs are not
  swept into the byte-sniff eligibility loop. Per D-29, they will render
  via ReactMarkdown's default `<a>` handling — no additional wiring
  required in ChatMessage.tsx or elsewhere (the "spot-check" mentioned in
  the plan's must_haves).

## Deviations from Plan

None — plan executed exactly as written. The plan's "create if not exists"
clause for the test file resolved to "extend existing" (the file already
existed from Phase 75); this was anticipated by the plan text and required
no deviation.

## Commits

| Task | Type | Hash       | Message |
|------|------|------------|---------|
| 1 (RED)   | test | 5cf147cd | test(103-07): add failing tests for SKYNET_SERVE_URL_RE_CLIENT |
| 1 (GREEN) | feat | 94726d39 | feat(103-07): add SKYNET_SERVE_URL_RE_CLIENT sibling regex |
| 2         | docs | b7bb9cf3 | docs(103-07): backend mirror-rule docblock notes Phase 103 D-29 serve URL regex |

## TDD Gate Compliance

Task 1 followed RED → GREEN cycle:
- RED (`5cf147cd`): test file extended with 11 new tests referencing
  `SKYNET_SERVE_URL_RE_CLIENT` before the regex existed. Confirmed failing
  (11 failed / 10 passed) before implementation.
- GREEN (`94726d39`): regex added; all 21 tests pass; tsc clean.
- REFACTOR: none required — new export mirrors existing sibling structure
  exactly; no dead code, no duplication to consolidate.

Task 2 was type=`auto` (not TDD) — pure docstring edit with no behavior
change; verified via grep-based acceptance criteria per the plan.

## Follow-ups / Known Stubs

None. This plan is complete on its own terms:
- Regex is exported, tested, and typechecks.
- Backend twin's paper trail is preserved.
- Serve URL clickable-rendering flows through the pre-existing ReactMarkdown
  `<a>` default (no new frontend wiring needed per D-29).

The custom visual affordance for serve URLs (icon, preview card, "live app"
indicator) is DEFERRED to the future `serve-and-file-url-visual-affordances`
bounty per D-30 — this plan explicitly does not touch that surface.

## Self-Check: PASSED

- Files exist:
  - `src/ui/features/pretty-view/editable-file-whitelist.ts` — FOUND (regex export present)
  - `src/ui/features/pretty-view/editable-file-whitelist.test.ts` — FOUND (21 tests)
  - `src/backend/utils/editable-file-whitelist.ts` — FOUND (docblock updated)
- Commits exist:
  - `5cf147cd` — FOUND (RED)
  - `94726d39` — FOUND (GREEN)
  - `b7bb9cf3` — FOUND (backend docblock)
