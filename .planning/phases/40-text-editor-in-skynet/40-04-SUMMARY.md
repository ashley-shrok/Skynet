---
phase: 40-text-editor-in-skynet
plan: 04
subsystem: pretty-view / ChatMessage + PrettyView wiring (Wave 3)
tags: [text-editor, wiring, chat-message, pretty-view, phase-40]
requires:
  - "Plan 40-02: useEditableFileEligibility hook (Set<string> per-message eligibility)"
  - "Plan 40-03: EditableFileAffordance (named export) + EditableFileModal (default export)"
provides:
  - "ChatMessage.onOpenEditor prop threaded end-to-end (props type + destructure + a-override + JSX render)"
  - "pv-bubble className on the bubble container (unlocks EditableFileAffordance desktop hover-reveal)"
  - "PrettyView.handleOpenEditor callback (snapshots pvIdentity.displayName at click-time)"
  - "PrettyView.handleStageEditedFile callback (D-06 save→primary-target attachment deposit)"
  - "guessMimeFromFilename helper (module-scope in PrettyView.tsx; nice-to-have MIME hint for chip UX per Research A8)"
  - "EditableFileModal mount alongside IdentityModal, portaled to document.body (Pitfall 7 — inset-4 covers composer per UI-SPEC L216)"
affects:
  - src/ui/features/pretty-view/ChatMessage.tsx  # +hook call, +onOpenEditor prop, +pv-bubble class, +a-override extension (+63/-7 LoC)
  - src/ui/features/pretty-view/PrettyView.tsx   # +import, +guessMime helper, +useState, +2 useCallbacks, +ChatMessage prop, +modal mount (+180/-17 LoC across two commits)
tech-stack:
  added: []  # zero new npm packages
  patterns:
    - "Fragment-sibling render inside ReactMarkdown component override (D-03 additive-not-replacive at the render-tree level; anchor semantics preserved verbatim)"
    - "Snapshot-at-click-time identity displayName (handleOpenEditor captures pvIdentity?.displayName ?? null so the modal sub-header stays stable across the modal's open lifecycle even if identity re-resolves mid-open)"
    - "Reuse-not-invent for the return trip (D-07): the modal's onStageEditedFile handler is wired to uploads.stageAttachments('primary', [File]) — the Quick 260802-wxy public API shipped for exactly this pattern. Zero new backend routes, zero new WebSocket message types, zero new plumbing on the composebox → send path"
    - "Test scoping to [role=\"dialog\"] where the container renders another textbox (PrettyView also renders a ComposeBox textarea in the same document — global getByRole would be ambiguous)"
    - "Wait-for-seed pattern in tests (textarea presence is not enough — the GlobalFileTab useEffect keyed on state.data.mtime populates draft AFTER the fetch resolves; typing before the seed fires would be stomped)"
key-files:
  created:
    - src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx  # 10 wiring tests
    - src/ui/features/pretty-view/PrettyView.editable-file.test.tsx   # 5 wiring tests
  modified:
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "guessMimeFromFilename co-located as a module-scope const in PrettyView.tsx (not extracted to a new file per Research A8: 15-line helper; extraction cost outweighs bytes saved). Callers-of-one keep the helper next to its consumer."
  - "onOpenEditor is optional on ChatMessage props: existing test suites (ChatMessage.autoplay.test.tsx, ChatMessage.speak.test.tsx, ChatMessage.instrumentation.test.tsx, ChatMessage.test.tsx) mount ChatMessage without the prop and remain unaffected (safe-degrade to no-affordance-render). This preserved 43 existing tests unchanged."
  - "handleOpenEditor snapshots pvIdentity.displayName at click-time into editorOpenState — the modal receives a stable string across its lifetime rather than reading pvIdentity live on every render. Rationale: identity resolution can re-fire during PrettyView's lifecycle; a stable snapshot means the modal's sub-header doesn't flicker."
  - "Test 3's textarea seed race required a wait-for-value check: the GlobalFileTab useEffect keyed on state.data.mtime fires setDraft(state.data.content) AFTER the fetch resolves. Typing between the ready-state render and the seed effect would get overwritten. Fixed by waiting until textarea.value === expected fetched content BEFORE fireEvent.change."
metrics:
  duration_min: 20
  completed_date: 2026-08-14
  tests_added: 15   # 10 ChatMessage + 5 PrettyView (matches plan target exactly)
  files_created: 2
  files_modified: 2
---

# Phase 40 Plan 40-04: ChatMessage + PrettyView wiring Summary

One-line: The Wave-3 wiring pass that closes the LOCKED D-03 render-tree contract (affordance renders as a Fragment sibling of the ReactMarkdown-emitted `<a>`, never as a wrapper), D-06 save-deposit path (save closure → `uploads.stageAttachments("primary", [new File(...)])`), and D-07 return-trip invariant (zero new backend routes, zero new WebSocket message types — the deposited attachment flows through the existing ComposeBox send-with-attachments pipeline byte-untouched). Two files modified, two new test files added, zero new npm dependencies.

## What Shipped

Two modified source files + two new test files. No new components — Plan 40-03 pre-built EditableFileAffordance and EditableFileModal; this plan is purely the wiring pass.

1. **`src/ui/features/pretty-view/ChatMessage.tsx` MODIFIED** — +63 LoC / -7 LoC.
   - Two new imports: `useEditableFileEligibility` (Plan 40-02) + `EditableFileAffordance` (Plan 40-03).
   - New optional prop `onOpenEditor?: (input: { messageEventId: string; url: string; filename: string }) => void` — safe-degrade when absent (all existing test call sites remain unaffected).
   - `useEditableFileEligibility(eventId ?? null, content)` called once per render at the top of the function body (D-01: hook fires for both roles; user messages simply return an empty Set — simpler than a conditional hook, which would violate the Rules of Hooks).
   - Bubble container div gains `"pv-bubble"` as the FIRST class in `cn()` — this token is what the EditableFileAffordance's desktop hover-reveal selector (`[.pv-bubble:hover_&]:opacity-100`) targets. A comment above the `cn()` warns future editors not to rename it without updating the child selectors.
   - `a` component override in ReactMarkdown restructured: returns a React Fragment containing (1) the existing `<a>` with `target="_blank" rel="noopener noreferrer"` (unchanged semantics per D-03) AND (2) a conditional `<EditableFileAffordance>` sibling when `href && eventId && onOpenEditor && eligibleUrls.has(href)`.
   - Filename extraction: `decodeURIComponent(new URL(href).pathname.split('/').pop() ?? "")` — Pitfall 8 defense (URL constructor strips `?query` before we split); Pitfall 1 defense (`href` destructured from `props`, not from `node`).

2. **`src/ui/features/pretty-view/PrettyView.tsx` MODIFIED** — +180 LoC / -17 LoC across two commits.
   - New import: `import EditableFileModal from "./EditableFileModal";`.
   - New module-scope helper `guessMimeFromFilename(filename: string): string | null` — a switch over common text-file extensions (md→text/markdown, json→application/json, yaml→application/yaml, ts/tsx→text/typescript, py→text/x-python, sh/bash/zsh→application/x-sh, txt/log/env→text/plain, html→text/html, css→text/css, xml→application/xml, csv→text/csv, sql→application/sql, toml→application/toml). Falls back to `null` → caller uses `"text/plain"`. Per Research A8, this is a nice-to-have chip UX hint — the chip strip renders name + size, not MIME.
   - New local state `editorOpenState: { url; filename; messageEventId; agentIdentityName: string | null } | null` alongside the existing `isIdentityModalOpen` useState.
   - Two new `useCallback` handlers alongside pvIdentity resolution at ~L1050:
     - `handleOpenEditor` — snapshots `pvIdentity?.displayName ?? null` into `editorOpenState` at click-time (stable sub-header across the modal's open lifecycle).
     - `handleStageEditedFile` — wraps `content` in `new File([content], filename, { type: guessMime… ?? "text/plain" })` and calls `uploads.stageAttachments("primary", [file])`.
   - `onOpenEditor={handleOpenEditor}` threaded into the ChatMessage render at L2274.
   - `EditableFileModal` mount alongside IdentityModal (~L2082). The mount is `{editorOpenState && (<EditableFileModal ... />)}` — the null-guard means React unmounts the modal cleanly when state clears. **No `container=` prop** (Pitfall 7 — deliberate; unlike IdentityModal, this modal's inset-4 backdrop covers the composer per UI-SPEC L216).

3. **`src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx` CREATED** — 10 tests covering:
   - Assistant + whitelist-hit URL → anchor AND affordance sibling (with parentElement identity assertion).
   - User message → no affordance (hook returns empty Set for user messages).
   - Assistant + non-eligible URL → link-only, no affordance.
   - Anchor semantics preserved (target=`_blank`, rel=`noopener noreferrer`, href unchanged).
   - Affordance onClick → `onOpenEditor({ messageEventId, url, filename })` with exact payload.
   - Multi-URL message → one affordance per eligible URL.
   - Bubble container has `pv-bubble` class.
   - `onOpenEditor` prop optional → no crash, no affordance render (safe-degrade).
   - Query-string URL → filename decoded from pathname (Pitfall 8 defense).
   - Hook called with `(eventId, content)` signature (asserts wiring shape).

4. **`src/ui/features/pretty-view/PrettyView.editable-file.test.tsx` CREATED** — 5 tests covering:
   - Affordance click → modal opens (dialog present in `document.body`).
   - X close button → dialog unmounts.
   - Save flow → `stageAttachments("primary", [File])` called with correct filename, content, and MIME.
   - agentIdentityName passthrough → "from tanya" sub-header when pvIdentity has displayName.
   - Multiple opens for different URLs → modal receives the current URL, not stale state.

## Commits

| SHA         | Type              | Message                                                                        |
| ----------- | ----------------- | ------------------------------------------------------------------------------ |
| `b401587b`  | `test(40-04)`     | add failing tests for ChatMessage editable-file wiring (RED)                   |
| `7e536842`  | `feat(40-04)`     | wire EditableFileAffordance into ChatMessage `<a>` override                    |
| `36f932f2`  | `test(40-04)`     | add failing tests for PrettyView editable-file modal wiring (RED)              |
| `fb366e42`  | `feat(40-04)`     | mount EditableFileModal + wire onOpenEditor / stageAttachments in PrettyView   |
| `3db51688`  | `refactor(40-04)` | rephrase editor-modal mount comment to keep container= grep-gate at baseline   |

Five atomic commits. TDD RED/GREEN gates observed on both wiring tasks; the container= comment fix committed separately so the grep-gate-driven adjustment is self-documenting (mirrors Plan 40-03's `9e4b2911` copy-fix commit pattern).

## Test count delta

| Suite                                                          | Pre-plan | Post-plan | Delta |
| -------------------------------------------------------------- | -------- | --------- | ----- |
| `src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx` | 0        | 10        | +10   |
| `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx`  | 0        | 5         | +5    |
| **Full suite** (backend + frontend)                              | 2313 passed / 6 skipped / 1 todo | **2328 passed / 6 skipped / 1 todo** | **+15 passing** |

**Test file count**: 186 files, all passing. `npx vitest run`: exit code 0. Delta is +15 exactly (matches plan target: 10 + 5).

**Cumulative Phase 40 test delta:**

| Plan     | Baseline | New    | Cumulative |
| -------- | -------- | ------ | ---------- |
| 40-01    | 2258     | +17    | 2275       |
| 40-02    | 2275     | +15    | 2290       |
| 40-03    | 2290     | +23    | 2313       |
| **40-04** | **2313** | **+15** | **2328**  |

Total Phase 40 test contribution across four plans: **+70 tests** (17 + 15 + 23 + 15) — matches the Task 3 acceptance-criterion cumulative expectation exactly.

## Verification Gates (Task 3)

| Gate                                                                                                            | Expected      | Actual |
| --------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| `npx tsc --noEmit`                                                                                              | exit 0        | exit 0 |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend`                                                  | exit 0        | exit 0 |
| `npm run build`                                                                                                 | exit 0        | exit 0 (vite build 7.16s) |
| `npx vitest run` — full suite                                                                                   | exit 0        | 2328 passed / 6 skipped / 1 todo, exit 0 |
| Full-suite delta (2313 → 2328)                                                                                  | +15           | +15 exactly |
| Cumulative Phase 40 delta (baseline → 2328)                                                                     | +70           | +70 exactly |
| `grep -c "onOpenEditor" src/ui/features/pretty-view/ChatMessage.tsx`                                            | ≥ 3           | 4 |
| `grep -c "onOpenEditor" src/ui/features/pretty-view/PrettyView.tsx`                                             | ≥ 1           | 1 |
| `grep -c "pv-bubble" src/ui/features/pretty-view/ChatMessage.tsx`                                               | ≥ 2           | 4 |
| `grep -c "EditableFileModal" src/ui/features/pretty-view/PrettyView.tsx`                                        | ≥ 2           | 2 |
| `grep -c "stageAttachments" src/ui/features/pretty-view/PrettyView.tsx`                                         | ≥ 2           | 6 |
| `grep -c "handleStageEditedFile" src/ui/features/pretty-view/PrettyView.tsx`                                    | ≥ 2           | 3 |
| `grep -c "container=" src/ui/features/pretty-view/PrettyView.tsx` (unchanged from pre-plan baseline of 1)       | 1             | 1 |
| `git diff HEAD~5 -- package.json` (no dependency changes)                                                       | empty         | empty |

All 14 gates green.

## Reuse Targets Left BYTE-UNTOUCHED (D-05 verification)

Per plan `success_criteria` — every reuse target from D-05 must be left byte-untouched by this plan:

| File                                                          | Diffed?  | Status                              |
| ------------------------------------------------------------- | -------- | ----------------------------------- |
| `src/ui/features/pretty-view/GlobalFileTab.tsx`               | No       | Untouched (Plan 40-03 added onDraftChange; this plan zero diff) |
| `src/ui/features/pretty-view/GlobalFilesModal.tsx`            | No       | Untouched |
| `src/ui/features/pretty-view/AttachmentChipStrip.tsx`         | No       | Untouched (used verbatim by ComposeBox as the recipient of the deposited attachment) |
| `src/ui/features/pretty-view/ComposeBox.tsx`                  | No       | Untouched (the reply-with-attachment path is Phase 05's shipped surface — closes D-07 by construction) |
| `src/ui/features/pretty-view/use-pretty-view-uploads.ts`      | No       | Untouched (`stageAttachments("primary", …)` is the Quick 260802-wxy public API surface) |
| `src/ui/features/pretty-view/EditableFileAffordance.tsx`      | No       | Untouched from Plan 40-03 |
| `src/ui/features/pretty-view/EditableFileModal.tsx`           | No       | Untouched from Plan 40-03 |
| `src/backend/routes/pretty-view.ts` (proxy)                   | No       | Untouched from Plan 40-01 |

`git diff HEAD~5 -- src/ui/features/pretty-view/{GlobalFileTab,GlobalFilesModal,AttachmentChipStrip,ComposeBox,use-pretty-view-uploads,EditableFileAffordance,EditableFileModal}.ts?` returns empty. `git diff HEAD~5 -- src/backend/routes/pretty-view.ts` returns empty (no such route file — the proxy lives elsewhere; verified via grep that Plan 40-01 backend files were not touched).

## Deviations from Plan

### Rule 3 (blocking-issue fix) — container= grep-gate collision with mount comment

- **Found during:** Task 3 static grep-gate audit after the Task 2 GREEN commit landed.
- **Issue:** The Task 3 gate `grep -c "container=" PrettyView.tsx` must remain at the pre-plan baseline (1 — the existing IdentityModal `container={chatRegionEl}` at L2186). My initial Task 2 comment above the EditableFileModal mount cited the invariant using backticked `container=` in prose, which tripped the counter to 2.
- **Fix:** Rephrased the prose (`NO \`container=\` prop here` → `no portal-container prop`). The invariant remains explicit and reviewer-visible; the count returns to 1.
- **Committed in:** `3db51688` (separate refactor commit for self-documenting audit trail — mirrors Plan 40-03's `9e4b2911` copy-fix commit pattern).
- **Rationale for Rule 3 disposition:** The Task 3 gate is a hard verification requirement. Rewording a comment is a zero-behavior-change fix. Rule 3 (auto-fix blocking issues) applies.

### Test scaffolding refinement — dialog-scoped queries + wait-for-seed

Two test-scaffolding refinements added during Task 2 GREEN so Test 3 could resolve cleanly. Both are test-only, no source change:

1. **Multiple textboxes in the document.** PrettyView renders a ComposeBox `<textarea>` at all times. The modal's textarea is a second one. `screen.getByRole("textbox")` failed with "Found multiple elements" — resolved by scoping to `document.body.querySelector('[role="dialog"]') .querySelector('textarea')`.
2. **Textarea seed race.** GlobalFileTab's `useEffect` keyed on `state.data.mtime` fires `setDraft(state.data.content)` AFTER the fetch resolves. If the test called `fireEvent.change(textarea, ...)` before the seed effect ran, the seed would stomp the typed value. Resolved by waiting for `textarea.value === "original"` (the fetched content) BEFORE typing. Recorded in the `decisions` frontmatter block so downstream test authors can adopt the same pattern.

Neither is a source-code deviation — both are wiring-test hygiene notes.

### None-otherwise deviations

No Rule 1 bugs, no Rule 2 missing critical functionality, no Rule 4 architectural questions. The plan's task breakdown, TDD RED/GREEN sequencing, mock strategy, grep-gate list, and cumulative test-count math all matched the codebase's actual shape. Plan 40-02 (hook) + Plan 40-03 (components) shipped exactly what Plan 40-04 needed at the boundaries the plan predicted — no interface surprises.

## Authentication gates

None. All tests mock `@/api/editable-file-api` (for `fetchTailnetUrl`), `@/api/claude-session-api` (for WS), `@/api/compose-drafts-api`, and `@/features/terminal/session-hue` at module scope — no live JWT flow, no live tailnet fetches, no live identity resolution. The real `handleApiError` remains in the api helper itself (verified in Plan 40-02).

## Known Stubs

None. The wiring is fully realized end-to-end at the file-boundary level. The remaining "not yet exercised in production" surfaces are downstream of this plan:

- The actual tailnet-URL fetch on `POST /pretty-view/fetch-tailnet-url` is exercised end-to-end only when an assistant message truly contains a `http://100.x.x.x:PORT/…` URL. Plan 40-05 (deploy checkpoint) verifies this against a live Skynet with an agent-served file.
- The composebox chip → send-with-attachment path is Phase 05's shipped surface — this plan doesn't touch it. Plan 40-05 UAT confirms the round-trip.

## Threat Flags

None. This plan wires already-modeled surfaces:
- The fetch path routes through Plan 40-02's `fetchTailnetUrl` (which routes to Plan 40-01's SSRF-hardened proxy — already threat-modeled T-40-01 through T-40-05 + T-40-SC).
- The modal's edited content is passed to `uploads.stageAttachments("primary", [File])` — an in-memory File object, no injection surface, no new network endpoint.
- The `onOpenEditor` callback carries only `{messageEventId, url, filename}` — three plain strings, no code paths, no eval.

Zero new network endpoints, zero new auth paths, zero schema changes, zero new file-access patterns.

## Next-plan handoff — Plan 40-05

**Plan 40-05 (deploy checkpoint + UAT)** needs three artifacts:

1. **Build-verify log** — capture the exact `npm run build` + `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` + `npx vitest run` output from this HEAD (all green as of `3db51688`). The deploy checkpoint runs on a fresh `git checkout` so bundle-size drift or environment-specific test failures surface before Ashley sees them.
2. **UAT checklist** — end-to-end validation on production Skynet covering all seven LOCKED decisions:
   - **D-01** (frontend-only URL detection): assistant sends a tailnet URL → affordance appears without any agent-side round-trip.
   - **D-02** (whitelist first, byte-sniff fallback): sync-path (`.md` extension) affordance appears at message-arrival with no backend fetch; extension-miss URL (e.g. `.dat`) affordance appears only after the eligibility fetch classifies as text.
   - **D-03** (additive-not-replacive): the anchor still opens in a new tab on click; the pencil affordance is a separate click target.
   - **D-04** (fresh fetch + visible failure): open the modal → fresh fetch fires; if the agent's HTTP server has died, in-body error copy renders + toast fires.
   - **D-05** (chrome forked from GlobalFilesModal): modal chrome (Portal + Overlay + Content + X close) visually matches GlobalFilesModal minus the host `<select>` and the tabs bar.
   - **D-06** (save deposits fresh attachment): type edits → click Save → attachment chip appears in the composebox strip with the correct filename.
   - **D-07** (return trip uses existing reply-with-attachment path): with the chip mounted, type a reply and send → agent receives the edited file via the existing Phase 05 injected-turn path with zero new backend telemetry.
3. **Patch-entry draft** — draft the fleet patch entry pointing at the four Phase 40 commits + this SUMMARY.md so the deploy log has a single citable artifact.

**Critical follow-up items surfaced during Wave 3:**

- **CSS hover-reveal cannot be JSDOM-verified.** Test 7 in `ChatMessage.editable-file.test.tsx` verifies the `pv-bubble` class is present. Plan 40-03 Test 5 in `EditableFileAffordance.test.tsx` verifies the `opacity-0` initial class. The actual ancestor-hover reveal (`.pv-bubble:hover &` → `opacity-100`) requires a real browser to fire — Plan 40-05 UAT must include a desktop hover-reveal walkthrough on production Skynet.
- **Textarea seed pattern** documented in `decisions[3]` — downstream tests that mount PrettyView-hosted modals with fetch-at-open effects should adopt the wait-for-seed pattern.

## Self-Check: PASSED

- `[ -f src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/PrettyView.editable-file.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/ChatMessage.tsx ]` → FOUND (modified — hook call, prop, pv-bubble, a-override sibling)
- `[ -f src/ui/features/pretty-view/PrettyView.tsx ]` → FOUND (modified — import, helper, state, 2 callbacks, ChatMessage prop, modal mount)
- `git log --oneline | grep b401587b` → FOUND (test/RED ChatMessage wiring)
- `git log --oneline | grep 7e536842` → FOUND (feat/GREEN ChatMessage wiring)
- `git log --oneline | grep 36f932f2` → FOUND (test/RED PrettyView wiring)
- `git log --oneline | grep fb366e42` → FOUND (feat/GREEN PrettyView wiring)
- `git log --oneline | grep 3db51688` → FOUND (refactor container= grep-gate fix)
- All 14 Task 3 gates → PASSED
- `npx vitest run` (full suite) → exit 0, 2328 passed / 6 skipped / 1 todo
- `npm run build` → exit 0 (vite 7.16s)
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` → exit 0
- `npx tsc --noEmit` → exit 0
