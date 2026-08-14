# Patch entry draft — Phase 40 — in-app text editor for agent-served tailnet files (D-01..D-07)

**Paste target:** `~/.claude/roles/box-maintainer/skynet-patches.md`

**Paste timing:** Only after Ashley greenlights the batched deploy that includes Phase 40. Phase 40 does NOT ship standalone — it bundles with whatever other unpushed-to-container commits are held in the deploy queue at ship day. Rides the same `docker build` + `docker compose up -d --force-recreate skynet` motion.

**No Co-Authored-By trailer** — fork convention (patterns from Phase 19 patch #237 and earlier).

This doc has two shapes: a section-by-section reference (below, with `##`-headed sections mirroring the plan's required content categories) and a **consolidated paste-ready block** at the bottom (matches the shape of neighboring patches in `skynet-patches.md`).

---

## Patch title

**`## Patch #442 — Phase 40 — in-app text editor for agent-served tailnet files (D-01..D-07)`**

(Increment to `#443`+ if additional patches queue up between now and ship day.)

---

## Motivation

Ashley 2026-08-13, shape doc + `/build` → `/open` scope-lock session in `.planning/shapes/shape-skynet-text-editor.md`.

Ashley's current workflow for editing files an agent shares with her is a multi-agent round-trip — the working agent sends the file to a second local agent, that agent opens it in a local editor, Ashley edits, closes, and tells the original agent to pull it back. On desktop that's seconds-to-minutes of dead air on a whole side-conversation between two agents when the actual editing takes seconds. **On mobile the workflow has no viable equivalent at all** — no local agent, no clean iOS editor story for received files. This is the load-bearing case.

Ashley's exact scope from the shape doc: "text-shaped files that agents serve via tailnet links; edit-then-attach-to-reply flow; reuse of the existing global-files editor modal (minus host picker, minus tabs); extension whitelist + byte-sniff eligibility check; fetch-at-detection for the eligibility check + fresh re-fetch at open time." Everything lives inside Skynet in the middle — no new agent-side primitive, no new receive convention.

---

## What shipped

Four functional pieces across four waves:

- **(a) Backend SSRF-hardened proxy** at `POST /pretty-view/fetch-tailnet-url` (Plan 40-01) — CGNAT-only URL allowlist regex (`100.64.0.0/10`), 8-second AbortController timeout, 2 MB size cap, content-type spoof-check (rejects `text/html` on non-.html URLs — defense against `python -m http.server` directory-listing HTML), filename-omitted log discipline. Plus a shared `EDITABLE_EXTENSIONS`/`EDITABLE_BASENAMES` whitelist (65 extensions + 23 basenames) and an inline `sniffTextBytes` file(1)-style byte-heuristic for extensionless-but-text files.

- **(b) Frontend api + eligibility hook** (Plan 40-02) — `fetchTailnetUrl(url)` axios helper, byte-identical whitelist twin in the frontend (so the common case classifies synchronously without a round-trip), and a `useEditableFileEligibility(messageEventId, messageBody): Set<string>` hook that scans messages for CGNAT URLs and produces a Set of eligible URLs. **D-04 discard-bytes invariant** enforced by return-type discipline (`Set<string>`, no cached-bytes ref) + grep gate (source contains zero references to `contentBase64`).

- **(c) UI components** (Plan 40-03) — `EditableFileAffordance` (per-link pencil-icon button; viewport-branched via `useIsTouchDevice()` — mobile 44×44px always-72%-opacity, desktop 28×28 hover-reveal via `[.pv-bubble:hover_&]:opacity-100`; warm-coral rest → identity-hue hover with drop-shadow mirroring PinAction.tsx Phase 13 SHAPE-03) and `EditableFileModal` (chrome forked verbatim from `GlobalFilesModal.tsx` L189-217 minus host `<select>` minus tabs bar; fetch-at-open + re-fetch-fail branch + save-to-parent + draft-guard confirm gate; `initialMtimeRef` stable-across-lifetime per Pitfall 6; deliberately no `container=` prop per Pitfall 7 so `inset-4` covers the composer).

- **(d) ChatMessage + PrettyView wiring** (Plan 40-04) — hook call at ChatMessage top, `pv-bubble` class on the bubble container (unlocks the desktop hover-reveal), Fragment-sibling render inside the ReactMarkdown `<a>` override (D-03 additive-not-replacive at the render-tree level — anchor semantics preserved verbatim), and PrettyView mount site with `handleOpenEditor` (snapshots pvIdentity.displayName at click-time so the modal sub-header stays stable) + `handleStageEditedFile` (wraps content in `new File(...)` and calls `uploads.stageAttachments("primary", [file])` — D-06 save-deposit path).

---

## Files touched

**NEW (backend, Plan 40-01):**
- `src/backend/utils/editable-file-whitelist.ts` — 63 lines. `EDITABLE_EXTENSIONS` (65) + `EDITABLE_BASENAMES` (23) + `classifyByExtension`. Authoritative half of the mirror pair (MIRROR lockstep notice in header).
- `src/backend/utils/editable-file-byte-sniff.ts` — 66 lines. `sniffTextBytes(buf)` — file(1)-style heuristic over first 8192 bytes: empty→true; any 0x00→false; ≥0.9 printable ratio; TextDecoder utf-8 fatal-mode gate.
- `src/backend/utils/editable-file-byte-sniff.test.ts` — 78 lines, 7 tests.
- `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` — 268 lines. `POST /pretty-view/fetch-tailnet-url` handler + `TAILNET_URL_RE` allowlist + `MAX_BYTES` (2 MB) + `FETCH_TIMEOUT_MS` (8000).
- `src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts` — 452 lines, 24 tests.

**NEW (frontend api + hook, Plan 40-02):**
- `src/ui/api/editable-file-api.ts` — 73 lines. `fetchTailnetUrl(url): Promise<TailnetFetchResult>` (authApi.post wrapper, JWT auto-attached via existing interceptor).
- `src/ui/api/editable-file-api.test.ts` — 131 lines, 5 tests.
- `src/ui/features/pretty-view/editable-file-whitelist.ts` — 84 lines. Byte-identical frontend twin (mirror of the backend file's Set members) + `TAILNET_URL_RE_CLIENT` (`/g` flag for `.match()` scanning).
- `src/ui/features/pretty-view/use-editable-file-eligibility.ts` — 114 lines. Effect-driven hook returning `Set<string>` of eligible URLs per message; sync path via whitelist, async path via `fetchTailnetUrl` reading only `isTextByBytes`.
- `src/ui/features/pretty-view/use-editable-file-eligibility.test.ts` — 325 lines, 10 tests.

**NEW (UI components, Plan 40-03):**
- `src/ui/features/pretty-view/EditableFileAffordance.tsx` — 90 lines. Named export. Warm-coral `Pencil` glyph, viewport-branched via `useIsTouchDevice()`.
- `src/ui/features/pretty-view/EditableFileAffordance.test.tsx` — 110 lines, 7 tests.
- `src/ui/features/pretty-view/EditableFileModal.tsx` — 305 lines. Default export. Fetch-at-open + re-fetch-fail + save + draft-guard confirm gate + `initialMtimeRef` stability.
- `src/ui/features/pretty-view/EditableFileModal.test.tsx` — 314 lines, 14 tests.

**NEW (wiring tests, Plan 40-04):**
- `src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx` — 249 lines, 10 tests.
- `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx` — 469 lines, 5 tests.

**MODIFIED:**
- `src/backend/database/database.ts` — +2 LoC at L1862 (import + `app.use("/pretty-view", prettyViewFetchTailnetUrlRoutes)`).
- `src/ui/features/pretty-view/ChatMessage.tsx` — +63/-7 LoC. Hook call + `onOpenEditor?` prop + `pv-bubble` class on bubble container + Fragment-sibling render in ReactMarkdown `<a>` override.
- `src/ui/features/pretty-view/PrettyView.tsx` — +180/-17 LoC. Import + `guessMimeFromFilename` helper + `editorOpenState` + `handleOpenEditor` + `handleStageEditedFile` + prop threading + modal mount alongside IdentityModal.
- `src/ui/features/pretty-view/GlobalFileTab.tsx` — +5 LoC. Additive optional `onDraftChange?: (dirty: boolean) => void` prop + useEffect. Backward-compat locked by GlobalFileTab.test.tsx Test 6.
- `src/ui/features/pretty-view/GlobalFileTab.test.tsx` — +2 tests (backward-compat + callback firing).

---

## Tests added

Per-plan breakdown:

| Plan | Category | Tests |
|------|----------|-------|
| 40-01 | Backend (byte-sniff + SSRF proxy) | 31 (7 sniff + 24 route — plan predicted 17; 12-way URL-validation matrix + Test 10 split into handler/middleware guards drove the +14) |
| 40-02 | Frontend api helper + eligibility hook | 15 (5 api + 10 hook) |
| 40-03 | Editor components + GlobalFileTab callback | 23 (7 affordance + 14 modal + 2 GlobalFileTab callback) |
| 40-04 | ChatMessage + PrettyView wiring | 15 (10 ChatMessage + 5 PrettyView) |
| **Phase 40 total** | — | **+70 net-new tests** (matches original planner estimate exactly) |

**Running total:** pre-Phase-40 baseline **2244 passed** → post-Phase-40 (end of Wave 3) **2328 passed** → HEAD 452c2a93 **2349 passed / 6 skipped / 1 todo across 188 files** (the +21 tests beyond Phase 40's +70 came from Tanya's Phase 39 fleet-status Gate 2 landing upstream during the Wave 3 → Wave 4 rebase — not Phase 40's contribution). `npx vitest run`: **exit 0** at capture (2026-08-14T03:22:51Z). Full details in `40-BUILD-VERIFY-LOG.md`.

---

## Threat model summary

See Plan 40-01's `<threat_model>` block for full detail; T-40-01 through T-40-05 + T-40-SC covered:

- **T-40-01 — SSRF (server-side request forgery):** The proxy is the *only* backend surface that makes an outbound HTTP request based on user-supplied URL. Mitigation: CGNAT-only allowlist regex `TAILNET_URL_RE` restricting the URL host to the `100.64.0.0/10` range (Tailscale-assigned addresses) at the character-class level; extra defense-in-depth guards reject `..`, additional `//` past the scheme, and trailing `/` independently in case of regex regression. No DNS lookup on user-supplied hostnames; no ability to reach RFC1918, localhost, cloud metadata, or arbitrary internet URLs.
- **T-40-02 — Directory-listing HTML spoof:** Python's `http.server` returns HTML directory listings when the URL path is a directory (not a file). If an attacker's URL points at a directory, the proxy would return the HTML body — client would then treat it as file content. Mitigation: `Content-Type` spoof-check rejects `text/html` for URLs whose filename extension is NOT `.html` / `.htm`.
- **T-40-03 — DoS via oversized or slow response:** An attacker (or a legitimate but pathological agent) could serve a multi-GB file or hang the connection indefinitely, exhausting backend memory or blocking the request queue. Mitigation: 8-second `AbortController` timeout on the outbound fetch + 2 MB response size cap via `arrayBuffer().byteLength` check → 413 error.
- **T-40-04 — Auth bypass / cross-tenant use:** The endpoint reads bytes from the tailnet on behalf of the caller. Mitigation: `authenticateJWT` middleware (Tailnet-scoped ACL per ASVS V4) — the same middleware that gates every other authenticated Skynet endpoint. Tailnet membership IS the ACL — only tailnet members can reach both the proxy and its upstream targets.
- **T-40-05 — Log privacy:** Filenames Ashley receives from agents are sensitive by definition (may contain PII, credentials, project names). Mitigation: **filename never logged.** Error paths log error class name only — no `.message`, no URL. Only host+port is logged.
- **T-40-SC (supply chain):** Zero new npm dependencies across the entire phase. Every package used (radix-ui Dialog primitives, lucide-react Pencil/X icons, sonner toast, `useIsTouchDevice`, Node 24 native fetch, `Buffer.from`) was already resident and previously vetted. `git diff HEAD~22 -- package.json` returns empty for the Phase 40 range.

---

## Nginx changes

**None.**

Unlike Phase 19's `/voice/speak-stream` which needed `proxy_buffering off; proxy_request_buffering off; chunked_transfer_encoding on; proxy_read_timeout 300s;` for the streaming property, `POST /pretty-view/fetch-tailnet-url` is a plain request/response cycle that returns JSON — inherits the default nginx `location /` block behavior. No new location block in either `docker/nginx.conf` or `docker/nginx-https.conf`.

---

## Rebase risk

**LOW.**

Fork-local — additive backend route (new file + one L1862 mount in `database.ts`), additive frontend files (10 new + 6 test), surgical extension of `ChatMessage.tsx` `<a>` override at L398-404, surgical mount of `EditableFileModal` in `PrettyView.tsx` alongside `IdentityModal`. **No upstream Skynet surfaces disturbed.**

The D-05 reuse targets — `GlobalFilesModal.tsx`, `AttachmentChipStrip.tsx`, `ComposeBox.tsx`, `use-pretty-view-uploads.ts` — are all left byte-untouched (`git diff <phase-40-range> -- <files>` empty). The `pretty-view/` directory is entirely fork-local (added by Phase 1), so even the modified files (`ChatMessage.tsx`, `PrettyView.tsx`, `GlobalFileTab.tsx`) carry zero upstream diff surface.

---

## Deploy note

Bundles with the current deploy queue held under the maintainer (Tiffany). No standalone ship.

Deploy motion (git pull --rebase → coord-room BEFORE announce → docker build → deadman-guarded docker compose up --force-recreate → HTTPS 200 verify → coord-room AFTER announce → git push → this patch entry pasted into `~/.claude/roles/box-maintainer/skynet-patches.md` with ordinal-count normalization) is the maintainer's remit — not the executor's.

Executor rotation stopped at doc drafts + local build-verify per fleet directive. Owner from here forward: **Tiffany (maintainer)**.

---

## Ordinal-count guidance

The header line in `~/.claude/roles/box-maintainer/skynet-patches.md` currently reads **"TWO HUNDRED AND NINETY-SIX numbered patches"** (verified 2026-08-14 by `grep -n "numbered patches" ~/.claude/roles/box-maintainer/skynet-patches.md`, matches L17). On paste, update the header to the accurate count.

Phase 40 lands as `## Patch #442` if it ships as the next single patch after `## Patch #441` (the current tail per `grep -oE "^## Patch #[0-9]+" ~/.claude/roles/box-maintainer/skynet-patches.md | tail -1`). If additional patches queue up between now and ship day, increment accordingly.

**Grep to verify current count before pasting:**
```
grep -c "^## Patch #" ~/.claude/roles/box-maintainer/skynet-patches.md
```
(Returns 249 titled entries as of 2026-08-14; the header line says 296 numbered patches — the two counts differ because not all numbered patches have full write-up entries. Both counts may have advanced by ship day; the header-line count matters more for the "TWO HUNDRED AND …" phrasing.)

---

## Cross-references

- **Phase 05** (`pretty-view-file-upload-support`) — the upload pipeline this deposit rides on. Phase 40's `handleStageEditedFile` calls `uploads.stageAttachments("primary", [file])` — the Quick 260802-wxy public API that Phase 05 codified. Zero new upload plumbing.
- **Phase 23 GEFM-05** — the `GlobalFilesModal` + `GlobalFileTab` reuse target. Phase 40 forks the modal chrome verbatim (Portal + Overlay + Content + `inset-4` + blue-glass gradient) minus the host picker + tabs bar. `GlobalFileTab.tsx` gained one backward-compatible optional prop (`onDraftChange`); `GlobalFilesModal.tsx` was NOT touched.
- **Phase 4 Glass visual language** — the `--color-pv-*` tokens + `--pv-id-hue` runtime CSS custom property. `EditableFileAffordance`'s hover state uses `hsla(var(--pv-id-hue), 80%, 60%, 0.55)` drop-shadow (mirrors PinAction.tsx Phase 13 SHAPE-03); `EditableFileModal` chrome uses the same blue-glass gradient tokens as `GlobalFilesModal`.
- **Phase 13 SHAPE-03** — bare-glyph-with-hue-drop-shadow interaction idiom (PinAction.tsx) — reused for the affordance hover state.
- **id skill § "Sending files to the user"** (`~/.claude/skills/id/SKILL.md`) — the canonical tailnet-served-file pattern being detected (`python3 -m http.server 0 --bind <tailnet-ip>` + 30-minute `sleep 1800; kill "$PID"` auto-kill window).
- **`.planning/shapes/shape-skynet-text-editor.md`** — shape doc (load-bearing agreement, contains the "what would make it wrong" list every design decision was checked against).
- **`.planning/phases/40-text-editor-in-skynet/40-CONTEXT.md`** — LOCKED user decisions D-01..D-07.
- **`.planning/phases/40-text-editor-in-skynet/40-UI-SPEC.md`** — approved design contract (visual/interaction contract with UI-checker sign-off).
- **`.planning/phases/40-text-editor-in-skynet/40-BUILD-VERIFY-LOG.md`** — build/test posture at hand-off.
- **`.planning/phases/40-text-editor-in-skynet/40-UAT-CHECKLIST.md`** — 7-item post-deploy verification walk.
- **`.planning/phases/40-text-editor-in-skynet/40-0[1-4]-SUMMARY.md`** — per-plan implementation summaries.

---

# Consolidated paste-ready draft

Copy from `## Patch #442 —` through the last bullet into `~/.claude/roles/box-maintainer/skynet-patches.md` at the tail (before any post-ship trailing notes if present). The section-by-section shape above unbundles into the bullet list below (matches the shape of Phase 19 patch #237 and the neighboring 249+ patch entries in the file).

---

## Patch #442 — Phase 40 — in-app text editor for agent-served tailnet files (D-01..D-07)

- **Motivation** (Ashley 2026-08-13, shape doc + `/build` → `/open` scope-lock session in `.planning/shapes/shape-skynet-text-editor.md`): Ashley's current workflow for editing files an agent shares with her is a multi-agent round-trip — the working agent sends the file to a second local agent, that agent opens it in a local editor, Ashley edits, closes, and tells the original agent to pull it back. On desktop that's seconds-to-minutes of dead air on a whole side-conversation between two agents when the actual editing takes seconds. **On mobile the workflow has no viable equivalent at all** — no local agent, no clean iOS editor story for received files. This is the load-bearing case. Ashley's exact scope: "text-shaped files that agents serve via tailnet links; edit-then-attach-to-reply flow; reuse of the existing global-files editor modal (minus host picker, minus tabs); extension whitelist + byte-sniff eligibility check; fetch-at-detection for the eligibility check + fresh re-fetch at open time." Everything lives inside Skynet in the middle — no new agent-side primitive, no new receive convention.

- **Root cause vs previous approach**: Pre-Phase 40, Skynet's pretty-view rendered agent-served tailnet URLs as plain `<a target="_blank">` anchors — clickable but not editable. The multi-agent workaround exists because there's no in-app editor for files-received-from-an-agent (there IS one for global files at `GlobalFilesModal.tsx`, but it requires host selection and multi-file tab management, neither of which applies to "the one file whose link Ashley just tapped"). Phase 40 wires the existing global-files editor guts to a per-link affordance in message bubbles, hooked up via a SSRF-hardened backend proxy that fetches the served bytes on Skynet's behalf.

- **Fix summary — backend SSRF-hardened proxy** (Plan 40-01): New `POST /pretty-view/fetch-tailnet-url` handler + `TAILNET_URL_RE` allowlist (`100.64.0.0/10` CGNAT range, character-class-level) + extra defense-in-depth guards (reject `..`, additional `//` past scheme, trailing `/`) + 8-second `AbortController` timeout + 2 MB size cap via `arrayBuffer().byteLength` check + content-type spoof-check rejecting `text/html` on non-.html URLs (T-40-02 defense against `python -m http.server` directory listings). Response shape: `{ contentBase64, sizeBytes, contentType, extension, filename, isTextByExt, isTextByBytes? }` (single call covers both eligibility path AND editor-open re-fetch path per D-04). Auth: `authenticateJWT` middleware. Log discipline: **filename never logged.** Error paths log error class name only — no `.message`, no URL. Only host+port is logged.

- **Fix summary — frontend eligibility infrastructure** (Plan 40-02): `fetchTailnetUrl(url): Promise<TailnetFetchResult>` axios helper (JWT auto-attached via existing interceptor). Byte-identical whitelist twin at `src/ui/features/pretty-view/editable-file-whitelist.ts` (mirror of the backend file's 65 extensions + 23 basenames + `classifyByExtension` + `TAILNET_URL_RE_CLIENT` with `/g` flag) — MIRROR lockstep notice on both files. `useEditableFileEligibility(messageEventId, messageBody): Set<string>` hook — sync path via `classifyByExtension` (no backend round-trip in the common case), async path via `fetchTailnetUrl` reading only `isTextByBytes`. **D-04 discard-bytes invariant** enforced structurally (return type `Set<string>` has no shape that could carry bytes) + belt-and-suspenders grep gate (source contains zero references to `contentBase64`).

- **Fix summary — UI components** (Plan 40-03): `EditableFileAffordance` (per-link pencil-icon button; viewport-branched via `useIsTouchDevice()` — mobile 44×44px always-72%-opacity, desktop 28×28 hover-reveal via `[.pv-bubble:hover_&]:opacity-100`; warm-coral `#ffb896` rest → identity-hue `hsla(var(--pv-id-hue), 80%, 60%, 0.55)` drop-shadow on hover mirroring PinAction.tsx Phase 13 SHAPE-03). `EditableFileModal` (chrome forked verbatim from `GlobalFilesModal.tsx` L189-217 minus host `<select>` minus tabs bar; fetch-at-open + re-fetch-fail branch renders the copywritten error state per UI-SPEC L110 + sonner toast; save-to-parent via `onStageEditedFile` closure; draft-guard `window.confirm("Discard unsaved changes?")` gate; `initialMtimeRef` captured once at fetch-success and read-only for the modal's open lifetime per Pitfall 6; deliberately no `container=` prop per Pitfall 7 so `inset-4` covers the composer per UI-SPEC L216). Additive `onDraftChange?: (dirty: boolean) => void` prop on `GlobalFileTab` — backward-compat locked by Test 6.

- **Fix summary — ChatMessage + PrettyView wiring** (Plan 40-04): `useEditableFileEligibility(eventId ?? null, content)` hook call once per rendered message (D-01: hook fires for both roles; user messages simply return an empty Set — simpler than a conditional hook which would violate the Rules of Hooks). `pv-bubble` class added as FIRST token in the bubble container's `cn()` — this is what `EditableFileAffordance`'s desktop hover-reveal selector targets; absence would degrade the affordance to always-invisible on desktop. ReactMarkdown `<a>` component override restructured: returns a React Fragment containing (1) the existing `<a>` with `target="_blank" rel="noopener noreferrer"` (unchanged semantics per D-03) AND (2) a conditional `<EditableFileAffordance>` sibling when `href && eventId && onOpenEditor && eligibleUrls.has(href)`. Filename extraction: `decodeURIComponent(new URL(href).pathname.split('/').pop() ?? "")` — Pitfall 8 defense (URL constructor strips `?query` before we split). PrettyView mount site: `handleOpenEditor` snapshots `pvIdentity?.displayName ?? null` at click-time into `editorOpenState` (stable sub-header across the modal's open lifetime even if identity re-resolves mid-open); `handleStageEditedFile` wraps `content` in `new File([content], filename, { type: guessMimeFromFilename(filename) ?? "text/plain" })` and calls `uploads.stageAttachments("primary", [file])` — the Quick 260802-wxy public API. `EditableFileModal` mount alongside `IdentityModal` with `{editorOpenState && (<EditableFileModal ... />)}` null-guard; **no `container=` prop** (deliberate; unlike IdentityModal, this modal's inset-4 backdrop covers the composer per UI-SPEC L216).

- **Files touched:**
  - **NEW (backend):** `src/backend/utils/editable-file-whitelist.ts` (+63), `src/backend/utils/editable-file-byte-sniff.ts` (+66), `src/backend/utils/editable-file-byte-sniff.test.ts` (+78, 7 tests), `src/backend/database/routes/pretty-view-fetch-tailnet-url.ts` (+268), `src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts` (+452, 24 tests).
  - **NEW (frontend api + hook):** `src/ui/api/editable-file-api.ts` (+73), `src/ui/api/editable-file-api.test.ts` (+131, 5 tests), `src/ui/features/pretty-view/editable-file-whitelist.ts` (+84), `src/ui/features/pretty-view/use-editable-file-eligibility.ts` (+114), `src/ui/features/pretty-view/use-editable-file-eligibility.test.ts` (+325, 10 tests).
  - **NEW (UI components):** `src/ui/features/pretty-view/EditableFileAffordance.tsx` (+90), `src/ui/features/pretty-view/EditableFileAffordance.test.tsx` (+110, 7 tests), `src/ui/features/pretty-view/EditableFileModal.tsx` (+305), `src/ui/features/pretty-view/EditableFileModal.test.tsx` (+314, 14 tests).
  - **NEW (wiring tests):** `src/ui/features/pretty-view/ChatMessage.editable-file.test.tsx` (+249, 10 tests), `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx` (+469, 5 tests).
  - **MODIFIED:** `src/backend/database/database.ts` (+2 LoC at L1862), `src/ui/features/pretty-view/ChatMessage.tsx` (+63/-7), `src/ui/features/pretty-view/PrettyView.tsx` (+180/-17), `src/ui/features/pretty-view/GlobalFileTab.tsx` (+5), `src/ui/features/pretty-view/GlobalFileTab.test.tsx` (+2 tests).

- **Tests added: +70 net-new across the phase** (17 + 15 + 23 + 15 by plan — matches the original planner estimate exactly). Pre-Phase-40 baseline 2244; end-of-Phase-40 (executor-side, HEAD 452c2a93): 2349 passed / 6 skipped / 1 todo across 188 files (the +21 tests beyond +70 came from Tanya's Phase 39 landing upstream during the Wave 3 → Wave 4 rebase — not Phase 40's contribution). `npx vitest run` exit 0 at capture (2026-08-14T03:22:51Z).

- **Threat model summary** (see Plan 40-01's `<threat_model>` block for full detail):
  - T-40-01 (SSRF): CGNAT allowlist regex + defense-in-depth guards (reject `..`, `//`, trailing `/`).
  - T-40-02 (dir-listing HTML spoof): content-type check rejects `text/html` for non-.html URLs.
  - T-40-03 (DoS): 8-second AbortController timeout + 2 MB size cap.
  - T-40-04 (auth): `authenticateJWT` middleware — tailnet-as-ACL per ASVS V4.
  - T-40-05 (log privacy): filename never logged; error paths log class name only.
  - T-40-SC (supply chain): zero new npm deps; `git diff HEAD~22 -- package.json` empty for the phase range.

- **Nginx changes:** **None.** `POST /pretty-view/fetch-tailnet-url` is a plain request/response cycle inheriting the default nginx `location /` block. No new location block in either `docker/nginx.conf` or `docker/nginx-https.conf`.

- **Rebase risk: LOW.** Fork-local — additive backend route + one L1862 mount in `database.ts`, additive frontend files (10 new + 6 test), surgical extension of `ChatMessage.tsx` `<a>` override at L398-404, surgical mount of `EditableFileModal` in `PrettyView.tsx` alongside `IdentityModal`. No upstream Skynet surfaces disturbed. D-05 reuse targets (`GlobalFilesModal.tsx`, `AttachmentChipStrip.tsx`, `ComposeBox.tsx`, `use-pretty-view-uploads.ts`) all left byte-untouched.

- **Deploy note:** Bundles with the current deploy queue held under the maintainer (Tiffany). No standalone ship. Deploy motion is the maintainer's remit — executor rotation stopped at doc drafts + local build-verify per fleet directive.

- **UAT plan:** 7-item checklist covering each of the LOCKED decisions D-01..D-07 as an observable UI behavior on production Skynet, see `.planning/phases/40-text-editor-in-skynet/40-UAT-CHECKLIST.md`. Summary: (1) D-01 passive URL detection, (2) D-02 whitelist + byte-sniff, (3) D-03 additive-not-replacive, (4) D-04 fresh refetch + visible failure, (5) D-05 forked modal chrome minus host picker minus tabs, (6) D-06 save deposits fresh attachment (multi-version supported), (7) D-07 return trip via existing Phase 05 reply-with-attachment pipeline. Bonus: full iPhone PWA walk (the load-bearing case per the shape doc).

- **See also:** shape doc `.planning/shapes/shape-skynet-text-editor.md`; Phase 40 CONTEXT `.planning/phases/40-text-editor-in-skynet/40-CONTEXT.md`; Phase 40 UI-SPEC `.planning/phases/40-text-editor-in-skynet/40-UI-SPEC.md`; per-plan summaries `40-0[1-4]-SUMMARY.md`; BUILD-VERIFY-LOG `.planning/phases/40-text-editor-in-skynet/40-BUILD-VERIFY-LOG.md`; UAT-CHECKLIST `.planning/phases/40-text-editor-in-skynet/40-UAT-CHECKLIST.md`. Adjacent patches: Phase 05 upload pipeline (this deposit rides on), Phase 23 GEFM-05 (`GlobalFilesModal` + `GlobalFileTab` reuse target), Phase 4 Glass visual language (`--color-pv-*` + `--pv-id-hue` tokens), Phase 13 SHAPE-03 (bare-glyph-with-hue-drop-shadow idiom).
