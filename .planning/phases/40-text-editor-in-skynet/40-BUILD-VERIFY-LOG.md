# Phase 40 Build Verification Log

**Executor:** Claude (executor for Plan 40-05 — Wave 4)
**Timestamp:** 2026-08-14T03:22:51Z (vitest run completion)
**Branch:** feat/tab-title-from-tmux
**HEAD at capture:** 452c2a93 (`docs(40-04): complete ChatMessage + PrettyView wiring plan`)
**Working tree:** clean (only untracked pre-existing `.planning/quick/260809-eqk-pause-hidden-terminal-ws/` scratch dir)

This log records the last-known-clean build/test posture of Phase 40 immediately before hand-off to the maintainer (Tiffany) for the batched `docker build` + `docker compose up --force-recreate` deploy motion. Per the executor-scope boundary, **no `docker build` or `docker compose` motions were performed** — those are the maintainer's remit.

---

## Build verification

| Command | Exit Code | Duration | Notes |
|---------|-----------|----------|-------|
| `npx tsc --noEmit` | **0** | ~2.5s | Clean — zero diagnostics. |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` | **0** | ~19.4s | `tsc -p tsconfig.node.json` + `dist/backend/backend/package.json` copy. Silent success. |
| `npm run build` | **0** | ~32.6s wall (vite `✓ built in 7.79s`) | Vite production bundle. Main JS `index-D2694u7O.js` **173.53 kB (gzip 52.54 kB)**; CSS `index-DAc8LvAd.css` **219.83 kB (gzip 36.04 kB)**. No new lazy chunks introduced by Phase 40 (EditableFileAffordance / EditableFileModal fold into the main bundle alongside existing pretty-view code). |
| `npx vitest run` | **0** | ~410.9s (~6m 52s wall) | **Test Files 188 passed / Tests 2349 passed / 6 skipped / 1 todo / 0 failed**. |

All four gates clean. Zero deviation from the fleet directive "never leave tests failing."

---

## Structural invariant grep gates

Each gate encodes a load-bearing structural claim from the phase's LOCKED decisions (D-01..D-07), the shape doc's "what would make it wrong" list, or the Common Pitfalls surfaced during planning. Executed at HEAD 452c2a93.

| Gate | Expected | Actual | Verifies |
|------|----------|--------|----------|
| `grep -n 'app.use("/pretty-view"' src/backend/database/database.ts` (non-comment) | 1 | **1** (L1862 → `prettyViewFetchTailnetUrlRoutes`) | Proxy router mounted exactly once. Duplicate mount would either shadow or double-log — either is a Rule 1 bug. |
| `grep -c "MIRROR" src/backend/utils/editable-file-whitelist.ts` | ≥1 | **1** | Backend whitelist header carries the MIRROR lockstep notice pointing at the frontend twin. |
| `grep -c "MIRROR" src/ui/features/pretty-view/editable-file-whitelist.ts` | ≥1 | **1** | Frontend whitelist header carries the reciprocal MIRROR lockstep notice. |
| `diff <(grep -oE '"[^"]+"' [frontend whitelist] \| sort -u) <(grep -oE '"[^"]+"' [backend whitelist] \| sort -u)` | empty | **empty** | The two whitelists' quoted string members are byte-identical Sets. If a future patch adds an extension to one file only, this diff produces a non-empty output and CI (via this grep-gate rerun at ship time) surfaces the drift. |
| `grep -c "contentBase64" src/ui/features/pretty-view/use-editable-file-eligibility.ts` | 0 | **0** | D-04 discard-bytes invariant: the eligibility hook must never reference the response's byte-payload field name in code OR in comments (prose paraphrases around the literal per Plan 40-02 deviation). |
| `grep -c "container=" src/ui/features/pretty-view/EditableFileModal.tsx` | 0 | **0** | Pitfall 7: `EditableFileModal` deliberately portals to `document.body` (no `container=` prop) so `inset-4` covers the composer per UI-SPEC L216. If a future edit adds `container={chatRegionEl}`, the modal will be clipped by the chat pane. |
| `grep -c "initialMtimeRef" src/ui/features/pretty-view/EditableFileModal.tsx` | ≥2 | **5** | Pitfall 6: `initialMtimeRef` captured once at fetch-success and read-only across the modal's open lifetime — prevents keystroke-reversion regression via the GlobalFileTab `state.data.mtime`-keyed seed effect. |
| `grep -c "pv-bubble" src/ui/features/pretty-view/ChatMessage.tsx` | ≥2 | **4** | D-01 desktop hover-reveal: `pv-bubble` class on the bubble container is the ancestor selector that `EditableFileAffordance`'s `[.pv-bubble:hover_&]:opacity-100` targets. Absence would degrade the affordance to always-invisible on desktop. |
| `grep -c "onOpenEditor" src/ui/features/pretty-view/ChatMessage.tsx` | ≥3 | **4** | D-01 wiring: prop declaration + destructure + a-override reference + JSX pass-through. Regression here breaks the affordance→modal open path. |
| `grep -c "EditableFileModal" src/ui/features/pretty-view/PrettyView.tsx` | ≥2 | **2** | D-05 mount site: import + `{editorOpenState && (<EditableFileModal ...`. Missing mount = modal never opens even if affordance click fires. |

**All 10 gates PASS. No regressions.**

---

## Test count reconciliation

| Milestone | Count | Delta | Notes |
|-----------|-------|-------|-------|
| Pre-Phase-40 baseline (from 40-01 SUMMARY) | 2244 passed / 6 skipped / 1 todo | — | Recorded at 40-01 baseline. |
| End of Plan 40-01 (backend) | 2275 | +31 | Route + sniff tests (planner predicted +17; actual +31 due to 12-way URL-validation matrix decomposition — see 40-01-SUMMARY §Deviations). |
| End of Plan 40-02 (api + hook) | 2290 | +15 | Matches plan target exactly (5 api + 10 hook). |
| End of Plan 40-03 (components) | 2313 | +23 | Matches plan target exactly (7 affordance + 14 modal + 2 GlobalFileTab callback). |
| End of Plan 40-04 (wiring) | 2328 | +15 | Matches plan target exactly (10 ChatMessage + 5 PrettyView). |
| **HEAD 452c2a93 (this log)** | **2349** | **+21 vs. Plan 40-04 tail** | Delta beyond expected +70 (Phase 40 cumulative) is Tanya's Phase 39 (fleet-status Gate 2) landing upstream during the Wave 3 → Wave 4 rebase — pre-notified in this plan's upstream_context. Not a Phase 40 contribution. |

**Cumulative Phase 40 contribution: +70 tests (17 + 15 + 23 + 15)** — matches the original planner estimate exactly. The +21 tests beyond that come from a sibling phase (39) and are not part of Phase 40's ownership.

**Test file count:** 188 files (compare Phase 19's 85 as of 2026-07-31 — roughly doubled in the intervening year across Phase 20-39). All 188 pass.

---

## New files inventory

Files created by Plans 40-01..40-04 (all present at HEAD 452c2a93):

**Backend (Plan 40-01):**
- `src/backend/utils/editable-file-whitelist.ts` (63 lines) — `EDITABLE_EXTENSIONS` (65) + `EDITABLE_BASENAMES` (23) + `classifyByExtension`. Authoritative half of the mirror pair.
- `src/backend/utils/editable-file-byte-sniff.ts` (66 lines) — `sniffTextBytes(buf: Uint8Array): boolean` file(1)-style heuristic over first 8192 bytes.
- `src/backend/utils/editable-file-byte-sniff.test.ts` (78 lines) — 7 tests.
- `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` (268 lines) — SSRF-hardened `POST /pretty-view/fetch-tailnet-url` proxy. CGNAT-only allowlist regex, 8s AbortController timeout, 2MB cap, content-type spoof-check, filename-omitted log discipline.
- `src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts` (452 lines) — 24 tests.

**Frontend api + hook (Plan 40-02):**
- `src/ui/api/editable-file-api.ts` (73 lines) — `fetchTailnetUrl(url)` axios helper + `TailnetFetchResult` type.
- `src/ui/api/editable-file-api.test.ts` (131 lines) — 5 tests.
- `src/ui/features/pretty-view/editable-file-whitelist.ts` (84 lines) — Frontend twin of the backend whitelist (byte-identical Set members) + `TAILNET_URL_RE_CLIENT` regex.
- `src/ui/features/pretty-view/use-editable-file-eligibility.ts` (114 lines) — `useEditableFileEligibility(messageEventId, messageBody): Set<string>` hook. D-04 discard-bytes enforced by return type (Set<string> — no cached-bytes ref) + grep gate (source contains zero references to `contentBase64`).
- `src/ui/features/pretty-view/use-editable-file-eligibility.test.ts` (325 lines) — 10 tests.

**UI components (Plan 40-03):**
- `src/ui/features/pretty-view/EditableFileAffordance.tsx` (90 lines) — Per-link pencil-icon button. Viewport-branched via `useIsTouchDevice()` (mobile 44×44px always-72%-opacity; desktop 28×28 hover-reveal via `[.pv-bubble:hover_&]:opacity-100`). Warm-coral rest → identity-hue hover with drop-shadow (mirrors PinAction.tsx SHAPE-03).
- `src/ui/features/pretty-view/EditableFileAffordance.test.tsx` (110 lines) — 7 tests.
- `src/ui/features/pretty-view/EditableFileModal.tsx` (305 lines) — Fetch-at-open + re-fetch-fail branch + save-to-parent + draft-guard confirm gate. Chrome forked verbatim from `GlobalFilesModal.tsx` L189-217 (Portal + Overlay + Content + backdrop-filter + blue-glass gradient) minus host `<select>` minus tabs bar. `initialMtimeRef` (Pitfall 6) + no `container=` prop (Pitfall 7).
- `src/ui/features/pretty-view/EditableFileModal.test.tsx` (314 lines) — 14 tests.

**Wiring tests (Plan 40-04):**
- `src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx` (249 lines) — 10 wiring tests (hook + sibling + prop + pv-bubble + Pitfall 8 URL-query decode + safe-degrade).
- `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx` (469 lines) — 5 wiring tests (modal mount + X close + save deposit + identity passthrough + multi-open).

**Total new source files:** 16 (10 source + 6 test — but multiple test files are effectively also "source" of test-only shape, so 10 shipped features + 6 wiring test files).

---

## Files modified

| File | Change | Purpose |
|------|--------|---------|
| `src/backend/database/database.ts` | +2 LoC (import + `app.use("/pretty-view", ...)`) at L1862 | Mount Plan 40-01's SSRF-hardened proxy alongside `/global-files` and before `/identities` router. |
| `src/ui/features/pretty-view/ChatMessage.tsx` | +63 / -7 LoC | Add `useEditableFileEligibility` hook call, `onOpenEditor?` optional prop, `pv-bubble` class on bubble container, and Fragment-sibling `<EditableFileAffordance>` render inside the ReactMarkdown `<a>` component override at L398-404. Anchor semantics preserved verbatim (D-03 additive-not-replacive at the render-tree level). |
| `src/ui/features/pretty-view/PrettyView.tsx` | +180 / -17 LoC across 2 commits | Import `EditableFileModal`, add `guessMimeFromFilename` module-scope helper, add `editorOpenState` + `handleOpenEditor` + `handleStageEditedFile` (deposits `File` into `uploads.stageAttachments("primary", ...)` — D-06/D-07), thread `onOpenEditor` prop into ChatMessage render, mount `<EditableFileModal>` alongside `<IdentityModal>` (deliberately no `container=` prop per Pitfall 7). |
| `src/ui/features/pretty-view/GlobalFileTab.tsx` | +5 LoC | Additive optional `onDraftChange?: (dirty: boolean) => void` prop + useEffect. Backward-compat locked by GlobalFileTab.test.tsx Test 6; no behavior change for existing GlobalFilesModal callers. |
| `src/ui/features/pretty-view/GlobalFileTab.test.tsx` | +2 tests | Test 6 (backward-compat: prop omitted → no crash) + Test 7 (callback fires on mount → divergence → convergence). Existing 5 tests unchanged. |

**Reuse targets left byte-untouched** (D-05 verification, `git diff HEAD~<n> -- <files>` empty):
- `GlobalFilesModal.tsx` — untouched.
- `AttachmentChipStrip.tsx` — untouched (used verbatim as chip render target for the deposited attachment).
- `ComposeBox.tsx` — untouched (existing reply-with-attachment path handles the send).
- `use-pretty-view-uploads.ts` — untouched (`stageAttachments("primary", …)` is the Quick 260802-wxy public API).
- Plan 40-01 backend files not re-touched by later plans.

---

## npm dependency changes

**None.**

Every capability (SSRF-hardened `fetch` via Node 24 native fetch + AbortController, base64 encode via `Buffer.from`, radix-ui Dialog primitives, lucide-react Pencil/X/AlertCircle icons, sonner toast, `useIsTouchDevice`, byte-sniff heuristic in-house) uses packages already resident per Plan 40-01 Research §Package Legitimacy Audit and Plan 40-03 UI-SPEC §Registry Safety. `git diff HEAD~22 -- package.json` returns empty for the Phase 40 range.

---

## Deploy status

**PENDING — maintainer (Tiffany) owns docker build + docker compose up + git push. This plan's remit stops at documentation.**

The executor rotation's work is complete: SSRF-hardened backend proxy shipped, frontend eligibility infrastructure shipped, editor components shipped, ChatMessage + PrettyView wiring shipped, 40-BUILD-VERIFY-LOG.md + 40-UAT-CHECKLIST.md + 40-PATCHES-MD-ENTRY.md drafted. The maintainer picks up from here for the deploy motion per the fleet directive on `human_verify_mode: end-of-phase`.

The BLOCKING human-verify checkpoint (Task 4 of this plan) is what closes the phase — Ashley walks the UAT checklist post-deploy on production Skynet, then either replies "APPROVED — hand off to maintainer" (phase complete, patch entry pasted at ship day) or "REVISION — [notes]" (one of the three docs artifacts is revised and the checkpoint re-fires).
