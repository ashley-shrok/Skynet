---
phase: 40-text-editor-in-skynet
plan: 03
subsystem: pretty-view / editor UI components
tags: [text-editor, ui-components, editor-modal, phase-40]
requires:
  - "Plan 40-02: fetchTailnetUrl helper + TailnetFetchResult type + useEditableFileEligibility hook"
provides:
  - "EditableFileAffordance (per-link pencil-icon sibling button, mobile/desktop viewport branch)"
  - "EditableFileModal (fetch-at-open + re-fetch-fail branch + save-to-parent + draft-guard confirm gate)"
  - "GlobalFileTab.tsx additive onDraftChange callback prop (backward-compat)"
affects:
  - src/ui/features/pretty-view/GlobalFileTab.tsx  # optional onDraftChange callback added (5 LoC + docblock; no behavior change for existing callers)
tech-stack:
  added: []  # zero new npm packages
  patterns:
    - "Forked-chrome pattern (D-05): EditableFileModal's Portal+Overlay+Content structure lifted VERBATIM from GlobalFilesModal.tsx L189-217 minus host picker + tabs bar; no shared abstraction (drift-risk cost outweighs bytes saved per Research §Alternatives Considered)"
    - "Stable mtime sentinel via useRef (Pitfall 6 defense): initialMtimeRef.current captured ONCE at fetch-success, never mutated across the modal's open lifecycle — prevents keystroke-reversion regression"
    - "Discard-unsaved-changes gate mirrors IDMEDIT-01 idiom (window.confirm) — routed via a handleOpenChange wrapper on onOpenChange, with a savingRef bypass on save-success closes"
    - "Portal to document.body (Pitfall 7 defense): DialogPrimitive.Portal deliberately omits `container` prop so inset-4 covers composer per UI-SPEC L216 (unlike IdentityModal which portals to chatRegionEl)"
    - "UI-SPEC error copy wrapped in JS string expression to preserve literal apostrophe (grep-gate compliance) without triggering react/no-unescaped-entities"
key-files:
  created:
    - src/ui/features/pretty-view/EditableFileAffordance.tsx
    - src/ui/features/pretty-view/EditableFileAffordance.test.tsx
    - src/ui/features/pretty-view/EditableFileModal.tsx
    - src/ui/features/pretty-view/EditableFileModal.test.tsx
  modified:
    - src/ui/features/pretty-view/GlobalFileTab.tsx  # +optional onDraftChange prop + useEffect (rev-2)
    - src/ui/features/pretty-view/GlobalFileTab.test.tsx  # +2 tests (backward-compat, callback firing)
decisions:
  - "Rev-2 (2026-08-14, Ashley explicit greenlight): draft-guard confirm gate INCLUDED in this plan (originally deferred). Modal fires window.confirm('Discard unsaved changes?') on dirty close; save-success bypasses via savingRef"
  - "GlobalFileTab.tsx extension is a single new optional prop (onDraftChange) — chose the additive-callback path over an internal-owned isDirty state because it keeps GlobalFileTab's contract flat and cross-cuts nothing else for existing GlobalFilesModal callers"
  - "Error copy wrapped in JSX `{'string'}` expression rather than `&apos;` HTML entity — the Task 3 grep gate is source-level and requires the literal apostrophe; the JS-string form satisfies both the gate and react/no-unescaped-entities"
  - "Test 9 (onInteractOutside guard) — assertion uses 'no close call within a tick after mousedown' rather than direct guard-fired inspection; radix's outside-detector wiring is opaque and the observable contract is what matters"
metrics:
  duration_min: 22
  completed_date: 2026-08-14
  tests_added: 23   # 7 affordance + 14 modal + 2 GlobalFileTab callback
  files_created: 4
  files_modified: 2
---

# Phase 40 Plan 40-03: EditableFileAffordance + EditableFileModal + minimal GlobalFileTab callback Summary

One-line: Two net-new UI components (per-link pencil-icon affordance + editor modal that fetches at open, handles re-fetch failure with visible copy + toast, and gates unsaved-changes closes with a confirm dialog) plus a 5-LoC backward-compatible additive callback prop on GlobalFileTab that wires the modal's draft-guard — components are self-contained and testable via mocked props, ready for Plan 40-04's mount + wiring pass.

## What Shipped

Four new files (2 component + 2 test) + two file modifications (one component + one test). Zero new npm dependencies.

1. **`src/ui/features/pretty-view/EditableFileAffordance.tsx`** — 90 LoC. Single `<button>` (never a wrapper), warm-coral (`#ffb896` via `--color-pv-code-fg`) at rest, identity-hue text on hover with 6px `hsla(var(--pv-id-hue), 80%, 60%, 0.55)` drop-shadow (mirrors PinAction.tsx Phase 13 SHAPE-03 idiom). Viewport branch via `useIsTouchDevice()`:
   - Mobile: always visible via `[@media(hover:none)]:!opacity-[0.72]`, 44×44 touch target (Apple HIG), icon-only (no "Edit" label).
   - Desktop: `opacity-0` at rest, `[.pv-bubble:hover_&]:opacity-100` reveal — depends on Plan 40-04 adding `pv-bubble` class to ChatMessage bubble div; degrades gracefully to always-invisible if the parent class is absent (Assumption A5).
   - Named export (not default) per fleet naming convention (AttachmentChipStrip pattern).

2. **`src/ui/features/pretty-view/EditableFileModal.tsx`** — 304 LoC. Default export.
   - Chrome forked VERBATIM from GlobalFilesModal.tsx L189-217 (Portal+Overlay+Content, `bg-black/15` overlay w/ backdrop-blur-xs, `inset-4` blue-glass Content with backdropFilter + boxShadow) MINUS the host `<select>` and the bottom tabs bar (D-05).
   - Header: `Edit {filename}` (`text-[15px] font-semibold`) + optional `from {agentIdentityName}` sub-header (muted) + glass X close (verbatim from L246-270).
   - Fetch-at-open lifecycle keyed on `[open, url, filename]` — success populates `TabState.ready({ content: atob(base64), mtime: initialMtimeRef.current })`; failure sets `TabState.error(...)` AND fires `toast.error(...)` (D-04 dual-signal).
   - `initialMtimeRef` (Pitfall 6): captured ONCE at fetch-success; reset only when the modal closes. Prevents draft reset on renders.
   - Error branch renders in-body copy per UI-SPEC L110 verbatim (wrapped in `{'string'}` JSX expression to keep the literal apostrophe past the grep gate) + a Close button.
   - Ready branch delegates to `<GlobalFileTab state={fetchState} onSave={handleSave} onDraftChange={setIsDirty} />`.
   - `handleSave` discards `expectedMtime` (D-06 stateless), calls `onStageEditedFile(filename, content)`, fires `toast.success(...)`, and closes — but sets `savingRef.current = true` FIRST so `handleOpenChange` bypasses the confirm gate.
   - `handleOpenChange` (rev-2 draft-guard): on close (open→false) with dirty draft AND not saving, fires `window.confirm("Discard unsaved changes?")`. Confirm → onOpenChange(false). Cancel → suppress. Routes ALL close paths (X button, Esc, any escaped outside-click).
   - Portal deliberately OMITS `container` prop (Pitfall 7) so `inset-4` covers the composer per UI-SPEC L216.

3. **`src/ui/features/pretty-view/GlobalFileTab.tsx` MODIFIED** — 5-LoC additive:
   - Props type gains `onDraftChange?: (dirty: boolean) => void` (optional; existing callers unaffected).
   - New useEffect keyed on `[draft, state, onDraftChange]` fires the callback only when state is ready and the prop is provided — no-op for GlobalFilesModal.
   - Docblock cites Plan 40-03 rev-2 rationale.

4. **`src/ui/features/pretty-view/EditableFileAffordance.test.tsx`** — 7 tests: render-as-button, aria+title, onClick, mobile icon-only + 44×44, desktop icon+label+opacity-0, sibling-not-wrapper regression gate, hover drop-shadow apply/clear.

5. **`src/ui/features/pretty-view/EditableFileModal.test.tsx`** — 14 tests covering fetch-once-on-open, no-fetch-on-open=false, ready-state textarea seed, error-body copy + toast, error Close button, save wiring, mtime sentinel stability (Pitfall 6), portal target === document.body (Pitfall 7), onInteractOutside guard + Esc close, state reset on reopen, and the four draft-guard branches (dirty+cancel keeps open, dirty+confirm closes, save-success bypass, clean-close no-prompt).

6. **`src/ui/features/pretty-view/GlobalFileTab.test.tsx` MODIFIED** — +2 tests:
   - Test 6: backward-compat — prop-omitted render + typing does not throw; existing save-flow unchanged.
   - Test 7: callback fires `false` on mount (matches), `true` on divergence, `false` on convergence back to fetched content.

## Commits

| SHA        | Type         | Message                                                             |
| ---------- | ------------ | ------------------------------------------------------------------- |
| `0c1ffa13` | `test(40-03)` | add failing tests for EditableFileAffordance (RED)                  |
| `58401ecb` | `feat(40-03)` | EditableFileAffordance component (GREEN)                            |
| `97799930` | `feat(40-03)` | add optional onDraftChange callback to GlobalFileTab                |
| `03245410` | `test(40-03)` | add failing tests for EditableFileModal (RED)                       |
| `c4e51538` | `feat(40-03)` | EditableFileModal component (GREEN)                                 |
| `9e4b2911` | `fix(40-03)`  | use JS string literal for UI-SPEC L110 error copy verbatim          |

Six atomic commits. TDD RED/GREEN gates observed on both new components; the GlobalFileTab additive change committed separately for reviewability; the copy-fix committed on its own so the grep-gate-driven adjustment is self-documenting.

## Test count delta

| Suite                                                                     | Pre-plan | Post-plan | Delta   |
| ------------------------------------------------------------------------- | -------- | --------- | ------- |
| `src/ui/features/pretty-view/EditableFileAffordance.test.tsx`             | 0        | 7         | +7      |
| `src/ui/features/pretty-view/EditableFileModal.test.tsx`                  | 0        | 14        | +14     |
| `src/ui/features/pretty-view/GlobalFileTab.test.tsx`                      | 5        | 7         | +2      |
| **Full suite** (backend + frontend)                                       | 2290 passed / 6 skipped / 1 todo | **2313 passed / 6 skipped / 1 todo** | **+23 passing** |

**Test file count**: 184 files, all passing. `npx vitest run`: exit code 0. Delta is +23 exactly (matches plan target: 7+14+2).

## Verification Gates (Task 3)

| Gate                                                                                      | Expected | Actual |
| ----------------------------------------------------------------------------------------- | -------- | ------ |
| `npx tsc --noEmit`                                                                        | exit 0   | exit 0 |
| `npm run build`                                                                           | exit 0   | exit 0 (vite build 20.94s) |
| `npx vitest run [3 targeted suites]`                                                      | 28 pass, exit 0 | 28/28 pass, exit 0 |
| `npx vitest run` — full suite                                                             | exit 0   | 2313 passed / 6 skipped / 1 todo, exit 0 |
| Full-suite delta (2290 → 2313)                                                            | +23      | +23 exactly |
| `grep -c "GlobalFileTab" src/ui/features/pretty-view/EditableFileModal.tsx`               | ≥ 2      | 7 |
| `grep -c "container=" src/ui/features/pretty-view/EditableFileModal.tsx`                  | 0        | 0 |
| `grep -c "initialMtimeRef" src/ui/features/pretty-view/EditableFileModal.tsx`             | ≥ 2      | 5 |
| `grep -c "toast.error" src/ui/features/pretty-view/EditableFileModal.tsx`                 | ≥ 1      | 2 |
| `grep -c "toast.success" src/ui/features/pretty-view/EditableFileModal.tsx`               | ≥ 1      | 1 |
| `grep -c "The agent's temporary server may have shut down" [modal]`                       | 1        | 1 |
| `grep -c "onInteractOutside" src/ui/features/pretty-view/EditableFileModal.tsx`           | ≥ 1      | 1 |
| Sibling-not-wrapper anti-pattern regex on affordance file                                 | 0        | 0 |
| `git diff HEAD package.json` (no dep changes)                                             | empty    | empty |

All 14 gates green. The single deviation (grep gate 6) is documented below and fixed via commit `9e4b2911`.

## Deviations from Plan

### Rule 3 (blocking-issue fix) — JSX apostrophe escaping vs. grep gate

- **Found during:** Task 3 static grep gate check after Task 2 GREEN commit landed.
- **Issue:** UI-SPEC L110 error copy contains a literal apostrophe (`agent's`). JSX text nodes cannot render a bare apostrophe without violating the `react/no-unescaped-entities` lint rule, so the initial GREEN commit used `&apos;`. The Task 3 grep gate however greps the SOURCE file for the literal apostrophe — which is what the UI-SPEC prescribes.
- **Fix:** Wrapped both the heading (`Can't fetch the current file.`) and body text in JSX `{'...'}` string expressions. The rendered DOM is identical to `&apos;`, but the source file now contains the literal apostrophe verbatim, satisfying both the lint rule and the grep gate.
- **Committed in:** `9e4b2911` (separate fix commit for self-documenting audit trail).
- **Rationale for Rule 3 disposition:** The Task 3 gate is a hard verification requirement of the plan. Rewording the JSX form is zero-behavior-change. Rule 3 (auto-fix blocking issues) applies.

### None-otherwise deviations

No Rule 1 bugs, no Rule 2 missing critical functionality, no Rule 4 architectural questions. The plan's task breakdown, TDD RED/GREEN sequencing, mock strategy, and grep gate list all matched the codebase's actual shape. The rev-2 draft-guard scope (added post-original-planning by Ashley on 2026-08-14) landed exactly as specified in the revised plan.

## Authentication gates

None. All 14 modal tests mock `@/api/editable-file-api` (for `fetchTailnetUrl`) and `sonner` (for `toast`) at module scope — no live JWT flow, no live tailnet fetches. The real `handleApiError` remains in the api helper itself (verified in Plan 40-02).

## Known Stubs

None. Both new components are fully realized. `onStageEditedFile` is an interface hole intended for Plan 40-04's wiring pass (mount site supplies the closure that calls `uploads.stageAttachments("primary", [new File(...)])`) — this is by-design per plan spec, not a stub.

## Threat Flags

None. This plan introduces zero new network surface — the modal's fetch path routes through `fetchTailnetUrl` (Plan 40-02's already-threat-modelled helper for Plan 40-01's SSRF-hardened proxy). No new auth paths, no file-access patterns, no schema changes. The fetched content is placed into a `<textarea>` (inherently HTML-safe) and never into any innerHTML sink. The `onStageEditedFile` callback interface pushes an in-memory string to a caller — no injection surface.

## Next-plan handoff — Plan 40-04

**Plan 40-04 (ChatMessage wiring + mount site)** will import:

- `EditableFileAffordance` from `./EditableFileAffordance` — render inside the ReactMarkdown `<a>` component override in `ChatMessage.tsx` (L395-417) as a SIBLING to the anchor, wrapped in a React fragment. The affordance is eligible ⇔ the URL is in `useEditableFileEligibility(messageEventId, messageBody)`'s returned Set.
  - **Critical follow-up:** ChatMessage.tsx's bubble div at L305 needs the `pv-bubble` class added to its className list (or a switch to a Tailwind `group`/`group-hover:` pattern). Without it, the desktop hover-reveal degrades to "always invisible". Test 5 in `EditableFileAffordance.test.tsx` only locks the initial `opacity-0` class — the actual ancestor-hover CSS variant is JSDOM-unverifiable and must be visually validated in Plan 40-04.

- `EditableFileModal` (default export) from `./EditableFileModal` — mount alongside `IdentityModal` in `PrettyView.tsx` (L2082 vicinity). Manage `open` + `{url, filename, messageEventId, agentIdentityName}` state via a small reducer or `useState` triggered by the affordance's `onOpen` callback (thread from ChatMessage upward — the fleet's Zustand-style prop-drilling convention).
  - **onStageEditedFile wiring:** The mount site owns the closure. Per Research §Pattern 2:
    ```typescript
    onStageEditedFile={(filename, content) => {
      const type = guessMimeFromFilename(filename) ?? "text/plain";
      const file = new File([content], filename, { type });
      uploads.stageAttachments("primary", [file]);
    }}
    ```
  - No new hook wiring required — `usePrettyViewUploads()` already runs at `PrettyView.tsx` L800-830.

- The `onDraftChange` callback prop on `GlobalFileTab` is now part of the public component API — safe for other future callers to consume if they need dirty-tracking (e.g., a future "unsaved changes" indicator in `GlobalFilesModal`). Backward-compat is locked by Test 6 in `GlobalFileTab.test.tsx`.

**Not touched by this plan (deferred to downstream plans):**

- `ChatMessage.tsx` `<a>` override extension — Plan 40-04
- `PrettyView.tsx` mount site + open-state management — Plan 40-04
- `pv-bubble` class addition on the bubble div — Plan 40-04 (see critical follow-up above)
- `guessMimeFromFilename` helper for the save closure — Plan 40-04 may create it inline or extract to `editable-file-whitelist.ts` if it grows past 5 lines
- Any live tailnet fetch flow — deferred to end-to-end validation checkpoint

## Self-Check: PASSED

- `[ -f src/ui/features/pretty-view/EditableFileAffordance.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/EditableFileAffordance.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/EditableFileModal.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/EditableFileModal.test.tsx ]` → FOUND
- `[ -f src/ui/features/pretty-view/GlobalFileTab.tsx ]` → FOUND (modified — new prop present)
- `[ -f src/ui/features/pretty-view/GlobalFileTab.test.tsx ]` → FOUND (modified — 7 tests total)
- `git log --oneline | grep 0c1ffa13` → FOUND (test/RED affordance)
- `git log --oneline | grep 58401ecb` → FOUND (feat/GREEN affordance)
- `git log --oneline | grep 97799930` → FOUND (feat additive GlobalFileTab callback)
- `git log --oneline | grep 03245410` → FOUND (test/RED modal)
- `git log --oneline | grep c4e51538` → FOUND (feat/GREEN modal)
- `git log --oneline | grep 9e4b2911` → FOUND (fix UI-SPEC copy)
- All 14 Task 3 grep + build + test gates → PASSED
- `npx vitest run` (full suite) → exit 0, 2313 passed
- `npm run build` → exit 0
- `npx tsc --noEmit` → exit 0
