---
phase: quick-260808-rtl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/database/routes/identity-avatar-batch.ts
  - src/backend/database/routes/identity-avatar-batch.test.ts
  - src/ui/api/identities-api.ts
  - src/ui/sidebar/NewSessionDialog.tsx
  - src/ui/sidebar/NewSessionDialog.test.tsx
  - src/ui/sidebar/CloneAgentDialog.tsx
  - src/ui/sidebar/CloneAgentDialog.test.tsx
autonomous: true
requirements: [RTL-MANUAL-AVATAR]

must_haves:
  truths:
    - "User can click an Upload… button in NewSessionDialog, pick a local PNG/JPEG/WebP, and the file becomes the avatar for the created identity"
    - "User can click an Upload… button in CloneAgentDialog, pick a local PNG/JPEG/WebP, and the file becomes the avatar for the cloned identity"
    - "Picking Upload… clears any previously generated candidate row + picked id (mutually exclusive)"
    - "Clicking Generate/Regenerate clears any manually uploaded preview + picked id (mutually exclusive)"
    - "Object URLs created for the manual preview are revoked when replaced, when the dialog closes, or when the component unmounts"
    - "Birth (identity-birth) and clone (identity-clone) endpoints are UNCHANGED — they still accept only avatarCandidateId; manual uploads produce an id via the new endpoint"
    - "Unauthenticated requests to /identities/avatar/candidate/manual return 401; disallowed mime types return 4xx; oversize returns 4xx"
  artifacts:
    - path: "src/backend/database/routes/identity-avatar-batch.ts"
      provides: "POST /candidate/manual handler mounted on the same /identities/avatar router (returns {id})"
      contains: "candidate/manual"
    - path: "src/backend/database/routes/identity-avatar-batch.test.ts"
      provides: "Tests for /candidate/manual — happy, auth, mime, oversize"
      contains: "candidate/manual"
    - path: "src/ui/api/identities-api.ts"
      provides: "postManualAvatarCandidate({file}) → {id} client"
      contains: "postManualAvatarCandidate"
    - path: "src/ui/sidebar/NewSessionDialog.tsx"
      provides: "Upload… button + hidden file input + manual preview + mutual-exclusion wiring"
      contains: "manual"
    - path: "src/ui/sidebar/CloneAgentDialog.tsx"
      provides: "Upload… button + hidden file input + manual preview + mutual-exclusion wiring"
      contains: "manual"
  key_links:
    - from: "src/ui/sidebar/NewSessionDialog.tsx"
      to: "/identities/avatar/candidate/manual"
      via: "postManualAvatarCandidate → setPickedCandidateId"
      pattern: "postManualAvatarCandidate"
    - from: "src/ui/sidebar/CloneAgentDialog.tsx"
      to: "/identities/avatar/candidate/manual"
      via: "postManualAvatarCandidate → setPickedCandidateId"
      pattern: "postManualAvatarCandidate"
    - from: "src/backend/database/routes/identity-avatar-batch.ts POST /candidate/manual"
      to: "candidateCache (existing in-memory cache)"
      via: "evictIfNeeded + candidateCache.set — same shape used by POST /batch"
      pattern: "candidateCache\\.set"
---

<objective>
Add manual avatar upload at agent creation time. Both NewSessionDialog (birth path) and CloneAgentDialog (clone path) get an "Upload…" button that posts a local image file to a new backend endpoint (`POST /identities/avatar/candidate/manual`). The endpoint stores the buffer in the existing avatar candidate cache and returns `{id}` — the same shape `postGenerateAvatarBatch` produces per element. The frontend then uses that id as `pickedCandidateId`, so birth/clone endpoints remain UNCHANGED.

Purpose: Ashley wants to hand-pick avatars for some identities without waiting for the LLM+gpt-image-1 pipeline. Reuses the existing candidate cache + auth + scope guard so the birth/clone contracts don't need touching.

Output:
- New backend endpoint on the existing /identities/avatar router
- Client wrapper `postManualAvatarCandidate`
- Upload… affordance + mutual-exclusion state in BOTH NewSessionDialog and CloneAgentDialog
- Backend + frontend tests
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

# Backend
@src/backend/database/routes/identity-avatar-batch.ts
@src/backend/database/routes/identity-avatar-batch.test.ts
@src/backend/database/routes/identities.ts
@src/backend/database/routes/voice.ts
@src/backend/database/routes/identity-birth.ts

# Frontend
@src/ui/features/pretty-view/IdentityModal.tsx
@src/ui/sidebar/NewSessionDialog.tsx
@src/ui/sidebar/NewSessionDialog.test.tsx
@src/ui/sidebar/CloneAgentDialog.tsx
@src/ui/sidebar/CloneAgentDialog.test.tsx
@src/ui/api/identities-api.ts

# Nginx (READ-ONLY — verify no change needed; see design notes)
@docker/nginx.conf
@docker/nginx-https.conf
</context>

<design_notes>
- **Nginx**: verified in planning — both `docker/nginx.conf` and `docker/nginx-https.conf` already contain `location ~ ^/identities/avatar(/.*)?$`, which covers `/identities/avatar/candidate/manual`. **NO nginx changes required.** The executor must NOT edit either nginx.conf file.
- **Cache reuse**: the existing `candidateCache` + `evictIfNeeded` in `identity-avatar-batch.ts` is the exact target — do NOT introduce a parallel store. The new handler lives IN THE SAME FILE so it has direct access to `candidateCache` and `evictIfNeeded`. This also means `getCandidateForBirth`/`consumeCandidateForBirth` transparently accept manually-uploaded ids (they only check TTL + userId scope), so birth/clone need zero changes.
- **Auth model**: use the same `authenticateJWT` middleware the sibling routes use in this file. Order MUST be `authenticateJWT` BEFORE `multer` (T-16-04 pattern from voice.ts) — unauth = 401 before parse.
- **Size cap**: locked context says "match generate endpoint; if none, 5 MB". Generate endpoint (`/batch`) is JSON-only and has no upload cap. Sibling `identities.ts` avatar upload uses 2 MB. Use **5 MB** per locked spec. multer `limits.fileSize: 5 * 1024 * 1024`.
- **Mime filter**: use multer `fileFilter` accepting only `image/png`, `image/jpeg`, `image/webp` — mirror the `ALLOWED_AVATAR_MIMES` set in `identities.ts:17-21` (reuse a local constant or copy the shape). Rejected mime → multer surfaces an error → return 400 with a clear message. Oversize → multer emits `LIMIT_FILE_SIZE` → return 413.
- **Response shape**: return `{ id: string }` (NOT the full `{id, url}` shape from /batch — callers only need the id to set `pickedCandidateId`).
- **Frontend mutual exclusion**: reuse existing `candidates` + `pickedCandidateId` state. Add a NEW piece of state `manualPreviewUrl: string | null` per dialog. When user picks a file successfully:
  - clear `candidates` (`setCandidates([])`)
  - set `pickedCandidateId` to the id returned by the endpoint
  - revoke prior `manualPreviewUrl` (if any) and set the new object URL
  When user clicks Generate/Regenerate (existing `handleGenerate`):
  - revoke `manualPreviewUrl` and set it to null
  - (existing behavior already sets `candidates` + clears `pickedCandidateId`)
- **Preview render**: when `manualPreviewUrl` is set AND `candidates.length === 0`, render a single tile (aspect-square, same rounded/border classes as the candidate button, `aria-selected="true"`) in the candidate row area — so downstream visual + selection state is coherent.
- **Cleanup**: revoke `manualPreviewUrl` in the same on-close/on-unmount effects that already reset `candidates` / `pickedCandidateId`. NewSessionDialog has the reset block at ~line 402-438; CloneAgentDialog has it at ~line 136-160.
- **Copy the IdentityModal shape**: `onAvatarPick` at IdentityModal.tsx:799-807 is the canonical revoke-prior + `URL.createObjectURL(file)` pattern. Same idiom, wrapped in a fetch to the new endpoint.
- **Hidden file input pattern**: use the label+`sr-only` file input + Button `onClick` delegator pattern from IdentityModal.tsx:1083-1106 (already reads `accept="image/png,image/jpeg,image/webp"`).
- **Ship boundary**: executor stops at code + commit + tests green. Do NOT deploy, do NOT edit `skynet-patches.md`, do NOT run docker builds.
</design_notes>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend — POST /identities/avatar/candidate/manual + tests</name>
  <files>src/backend/database/routes/identity-avatar-batch.ts, src/backend/database/routes/identity-avatar-batch.test.ts</files>
  <behavior>
    - Test happy: POST multipart with field `avatar` (a small PNG buffer) and valid auth → 200 with body `{ id: string }`. The returned id can then be fetched via GET /candidate/:id (existing handler) and returns the SAME bytes with content-type image/png. Also assert the entry lands in `candidateCache` (via `_getCandidateCacheForTest`) scoped to the mocked userId.
    - Test auth: POST with `mockUserId = null` → 401. multer must NOT parse the body (assert by asserting no candidate cache entry created).
    - Test mime: POST multipart with field `avatar` mime `text/plain` → 4xx (400 preferred), with a clear error string mentioning PNG/JPEG/WebP. No cache entry created.
    - Test oversize: POST multipart with a > 5 MB dummy buffer (mime image/png) → 4xx (413 preferred) via multer's `LIMIT_FILE_SIZE`. No cache entry created.
    - Test missing field: POST with no `avatar` field → 400 "missing avatar field". No cache entry created.
  </behavior>
  <action>
    Add a new POST /candidate/manual handler to `src/backend/database/routes/identity-avatar-batch.ts`. Keep it in this file so it can reuse `candidateCache`, `evictIfNeeded`, and the existing router mount.

    Implementation shape (do not paste code — this describes what to write):
    - Import `multer` at the top of the file (new import) and wire a memory-storage upload with `limits.fileSize: 5 * 1024 * 1024` and a `fileFilter` that accepts only `image/png`, `image/jpeg`, `image/webp`. Reject others with an Error whose message names the allowed types (multer surfaces this via `next(err)`).
    - Define a local `ALLOWED_MANUAL_AVATAR_MIMES` Set mirroring the shape in `identities.ts:17-21`. Do not import from `identities.ts` — copy the constant locally to keep this route self-contained.
    - Register the route BEFORE the default export: `router.post("/candidate/manual", authenticateJWT, upload.single("avatar"), handler)`. Order matters: `authenticateJWT` first (T-16-04), then multer. Also add an express error handler at the bottom of the file (or scoped to this router) that turns multer's `LIMIT_FILE_SIZE` into a 413 with `{error: "file too large (max 5 MB)"}`, mime-rejection Errors into a 400 with the multer error's message, and everything else into 500.
    - Handler responsibilities:
      1. `userId = (req as AuthenticatedRequest).userId` (guaranteed by authenticateJWT).
      2. If `!req.file` → 400 `{error: "missing avatar field"}`.
      3. Generate `id = nanoid()`.
      4. Call `evictIfNeeded(userId)` then `candidateCache.set(id, { userId, bytes: req.file.buffer, createdAt: Date.now(), mime: req.file.mimetype })`.
      5. Respond 200 `{ id }`.
    - Do NOT introduce any new exported helper (`putAvatarCandidate` is not required — the handler talks directly to the module-scoped cache, same as the /batch handler does inline at lines 314-323).
    - Because `express.json()` is registered globally on `router.use(express.json())` at line 33, this is a `multipart/form-data` route. That is fine — express.json is a no-op on non-JSON content-types. Verify the router.use line is unchanged; do NOT wrap the multipart route in json parsing.

    Tests: add a new `describe("POST /candidate/manual", ...)` block to `identity-avatar-batch.test.ts`. This test file already sets up an express app with the same auth mock and a `httpRequest` helper. Extend the helper (or add a sibling) to send `multipart/form-data` bodies — you can either construct the multipart body by hand as a Buffer (the existing test file already uses raw node http, so a small helper that emits `--boundary\r\nContent-Disposition: form-data; name="avatar"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n<bytes>\r\n--boundary--\r\n` is fine), or import `form-data` if it is already in devDependencies (grep first — do not add a new npm dep). Reset `mockUserId = "user-1"` in `beforeEach` and `null` in the auth test, matching the file's existing pattern. Use `_clearCandidateCacheForTest()` between tests. For the "no cache entry created" assertions on error paths, use `_getCandidateCacheForTest()?.size` before/after.

    Small PNG fixture for the happy path: a 1x1 PNG can be produced inline with sharp (already imported: `sharp({create:{width:1,height:1,channels:3,background:{r:0,g:0,b:0}}}).png().toBuffer()`).

    Oversize test: allocate a `Buffer.alloc(6 * 1024 * 1024, 0xff)` with `content-type: image/png` — multer will reject at the LIMIT_FILE_SIZE gate before the file lands in memory in a meaningful way (still cheap for the test).

    Do NOT modify /batch, /candidate/:id, getCandidateForBirth, or consumeCandidateForBirth. Do NOT touch nginx configs (both configs already proxy /identities/avatar/*).
  </action>
  <verify>
    <automated>npx vitest run src/backend/database/routes/identity-avatar-batch.test.ts</automated>
  </verify>
  <done>
    New POST /candidate/manual handler exists in identity-avatar-batch.ts, uses authenticateJWT + multer memory storage + 5 MB cap + png/jpeg/webp filter, writes to the existing candidateCache with the requesting userId, and returns {id}. All 5 new tests (happy, auth, mime, oversize, missing-field) pass. Existing tests in the file still pass. No new npm deps added.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Frontend — Upload… button in NewSessionDialog + CloneAgentDialog + api client + tests</name>
  <files>src/ui/api/identities-api.ts, src/ui/sidebar/NewSessionDialog.tsx, src/ui/sidebar/NewSessionDialog.test.tsx, src/ui/sidebar/CloneAgentDialog.tsx, src/ui/sidebar/CloneAgentDialog.test.tsx</files>
  <behavior>
    - NewSessionDialog: renders an "Upload…" button next to Generate/Regenerate in the avatar section. Clicking it opens a hidden file picker (accept="image/png,image/jpeg,image/webp"). On file pick → POST to /identities/avatar/candidate/manual → returned id is stored as pickedCandidateId. Generated candidate row (if any) is cleared. A single preview tile (object URL) shows in the candidate row area with aria-selected="true".
    - NewSessionDialog: clicking Generate/Regenerate AFTER a manual upload clears the manual preview + revokes the object URL. Existing generate flow otherwise unchanged.
    - NewSessionDialog: closing the dialog OR unmounting revokes any live manual object URL (no leak).
    - NewSessionDialog: after manual upload → click Create with all other required fields valid → openBirthStream is called with `avatarCandidateId` set to the id returned by the manual endpoint (proves birth endpoint is UNCHANGED and receives the manual id transparently).
    - CloneAgentDialog: same four behaviors, but the Create action calls `cloneIdentity` with `avatarCandidateId` set to the manual id.
  </behavior>
  <action>
    1) `src/ui/api/identities-api.ts` — add `postManualAvatarCandidate({file}: {file: File}): Promise<{id: string}>`. Build a `FormData`, append `avatar` = file, POST to `/identities/avatar/candidate/manual` via `authApi.post` (do NOT set Content-Type header manually — let axios/browser set the boundary). Reuse the same `handleApiError` pattern used by neighbours (`postGenerateAvatarBatch` at lines 89-109). Do NOT bump the global timeout — a 5 MB upload well within default. Export the function.

    2) `src/ui/sidebar/NewSessionDialog.tsx`:
       - Import `postManualAvatarCandidate` from `@/api/identities-api`.
       - Add state: `const [manualPreviewUrl, setManualPreviewUrl] = useState<string | null>(null);` and `const [uploadLoading, setUploadLoading] = useState(false);` and `const [uploadError, setUploadError] = useState<string | null>(null);`.
       - Add handler `handleManualUpload(e: React.ChangeEvent<HTMLInputElement>)` that:
         a. Grabs `const file = e.target.files?.[0]; if (!file) return;`.
         b. Resets the input value (`e.target.value = ""`) so re-picking the same file re-fires change (standard idiom).
         c. Sets `uploadLoading=true`, `uploadError=null`.
         d. Calls `postManualAvatarCandidate({file})`. On success: revoke prior `manualPreviewUrl`, `setManualPreviewUrl(URL.createObjectURL(file))`, `setCandidates([])`, `setPickedCandidateId(data.id)`, `setGenError(null)`. On error: `setUploadError(msg)`. Finally: `setUploadLoading(false)`.
       - In the JSX at the avatar section (~lines 1020-1039), place a NEW button "Upload…" adjacent to the existing Generate/Regenerate button. Use the same file-input-inside-label + delegator pattern from IdentityModal.tsx:1083-1106 (label with `sr-only` input `type="file" accept="image/png,image/jpeg,image/webp"`; visible Button that programmatically clicks the input via `e.currentTarget.parentElement?.querySelector("input[type='file']")`). Disable it when `formDisabled || uploadLoading`. aria-label "Upload avatar".
       - In the same avatar section, after the existing `{candidates.length > 0 && ...}` render block, add a NEW render block: `{candidates.length === 0 && manualPreviewUrl && (...single tile...)}` that shows the object URL as an `<img>` inside a `<button aria-selected="true" data-manual-avatar="true">` (same rounded/border classes as candidate buttons, centered via `flex justify-center`).
       - Render `{uploadError && <span className="text-xs text-[color:var(--color-pv-code-fg)]">{uploadError}</span>}` next to the existing genError.
       - Modify existing `handleGenerate` (around line 564): at the top, revoke `manualPreviewUrl` and setManualPreviewUrl(null), setUploadError(null). (existing setCandidates + setPickedCandidateId(null) already runs at completion.)
       - Modify the on-close reset effect (around lines 402-438): revoke `manualPreviewUrl` and set to null; also reset `uploadLoading` and `uploadError`.
       - Add an unmount cleanup: extend the existing `useEffect(() => { return () => { abortControllerRef.current?.abort(); }; }, [])` at line 444-448 to also revoke the current `manualPreviewUrl` via a ref (or add a second effect that tracks the latest url in a ref and revokes it on unmount). Prefer a small `manualUrlRef = useRef<string | null>(null)` kept in sync via a `useEffect([manualPreviewUrl])` — this avoids stale-closure issues on unmount.
       - No changes to `handleBirth` — it already reads `pickedCandidateId` and passes it as `avatarCandidateId`. That is the whole point: manual just supplies the id.

    3) `src/ui/sidebar/CloneAgentDialog.tsx`:
       - Import `postManualAvatarCandidate`.
       - Add the same `manualPreviewUrl` / `uploadLoading` / `uploadError` state.
       - Add the same `handleManualUpload` handler (identical body).
       - In the avatar section (~lines 383-406), add the "Upload…" Button next to the Regenerate Button. Same label + hidden input + delegator pattern.
       - Preview render: the existing default preview at ~lines 416-424 shows the source's avatar when `!hasCandidates`. Adjust so the manual preview WINS when set: `{manualPreviewUrl && !hasCandidates ? <manualTile/> : (!hasCandidates && sourceIdentity && <sourcePreviewTile/>)}`. Manual tile is a centered `<button aria-selected="true" data-manual-avatar="true">` wrapping the object-URL `<img>` (same 16x16 rounded classes as the source preview).
       - Modify existing `handleGenerate` (line 176): at the top, revoke `manualPreviewUrl` + setManualPreviewUrl(null) + setUploadError(null).
       - Modify the open/close reset effect (line 136-160): on OPEN — reset `manualPreviewUrl` (revoke) + `uploadLoading` + `uploadError`. On CLOSE — same.
       - Add an unmount ref (same pattern as NewSessionDialog) to revoke `manualPreviewUrl` if the modal is unmounted while a preview is live.
       - No changes to `handleSubmit` — it already reads `pickedCandidateId` and passes it as `avatarCandidateId`.

    4) `src/ui/sidebar/NewSessionDialog.test.tsx` — add:
       - Test "Upload picks manual candidate": mock `postManualAvatarCandidate` (extend the existing `vi.mock("@/api/identities-api", ...)` at lines 41-51 by adding it to the mock map). Render the dialog with the identity-mode ON default. Fill name+title+brief. Trigger the file picker by grabbing the file input by `[type="file"]` selector (or by `aria-label`), and fire `change` with a `new File([new Uint8Array(4)], "a.png", { type: "image/png" })`. Assert `mockPostManualAvatarCandidate` was called with `{file}`. After it resolves with `{id: "manual-1"}`, assert an `<img>` renders (the preview) AND `candidates` are cleared (no other candidate tiles).
       - Test "Upload then Generate clears preview": upload a file, then click Generate → assert the manual preview img disappears and 3 candidate imgs appear.
       - Test "Manual upload → Create calls openBirthStream with the manual id as avatarCandidateId": upload file (mock resolves with id "manual-42"), pick a host, fill role/name/title/brief, click Create, assert `mockOpenBirthStream` invoked with `avatarCandidateId: "manual-42"`. Reuse the existing renderDialog + mock stream helpers; mirror Test Q pattern for enabling Create.
       - Small note: `URL.createObjectURL`/`revokeObjectURL` need stubs — add `beforeEach: (globalThis as any).URL.createObjectURL = vi.fn(() => "blob:mock"); (globalThis as any).URL.revokeObjectURL = vi.fn();` if not already present in the test setup.

    5) `src/ui/sidebar/CloneAgentDialog.test.tsx` — add:
       - Test "Upload picks manual candidate": mock `postManualAvatarCandidate`; render dialog with a `sourceIdentity`; grab file input; fire change with an image File; assert mock called; assert preview img present; assert source preview NOT shown while manual is set.
       - Test "Manual upload → Clone calls cloneIdentity with the manual id as avatarCandidateId": mock returns `{id: "manual-99"}`; user fills name; clicks Clone; assert `mockCloneIdentity` invoked with `avatarCandidateId: "manual-99"`. Mirror Test 21 patterns.
       - Same URL.createObjectURL stub if not already present.

    6) Do NOT add npm deps, do NOT touch nginx configs, do NOT touch identity-birth / identity-clone routes. Executor stops at code + commit + tests green — no docker build, no ship, no patches.md.
  </action>
  <verify>
    <automated>npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx src/ui/sidebar/CloneAgentDialog.test.tsx</automated>
  </verify>
  <done>
    Both dialogs render an "Upload…" button next to Generate/Regenerate. Picking a file posts to /identities/avatar/candidate/manual, shows a preview, sets pickedCandidateId, and Create/Clone forwards that id as `avatarCandidateId` to the unchanged birth/clone endpoints. Manual and generated are mutually exclusive. Object URLs are revoked on replace, close, and unmount. New tests pass (3 in NewSessionDialog.test.tsx, 2 in CloneAgentDialog.test.tsx) and all previously-passing tests in both files still pass. `postManualAvatarCandidate` is exported from identities-api.ts.
  </done>
</task>

<task type="auto">
  <name>Task 3: Full-suite verification</name>
  <files></files>
  <action>
    Run the full vitest suite from repo root. All previously-green tests must remain green in addition to the new tests added in Tasks 1 and 2. Investigate and fix any regression before declaring done. If the full suite has a pre-existing unrelated failure (surface it in the summary), still declare non-regression by confirming the failing test was failing on `HEAD~1` — do not skip or delete tests to make the run green.
  </action>
  <verify>
    <automated>npx vitest run</automated>
  </verify>
  <done>
    `npx vitest run` completes with all tests green (or with the exact same pre-existing failure set as on `HEAD~1`, documented in the SUMMARY). No new test failures introduced by this change.
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → /identities/avatar/candidate/manual | Untrusted multipart upload (image bytes) crossing the JWT-authenticated API boundary |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-QUICK-01 | Denial of Service | POST /candidate/manual | mitigate | multer `limits.fileSize: 5 * 1024 * 1024` — oversize rejected at parse time (T-16-01 analog from voice.ts) |
| T-QUICK-02 | Tampering | POST /candidate/manual | mitigate | multer `fileFilter` restricts to image/png,image/jpeg,image/webp — non-image payloads rejected before landing in memory. Content is stored as opaque bytes in memory only (10 min TTL); never rendered as HTML or executed |
| T-QUICK-03 | Spoofing / Info Disclosure | GET /identities/avatar/candidate/:id (existing) | accept | Existing userId scope guard in `getCandidateForBirth` (line 402) and GET /candidate/:id handler (line 359) — a manual id from user A cannot be fetched or consumed by user B. Same guarantee as generated candidates; no new surface. |
| T-QUICK-04 | Authentication bypass | POST /candidate/manual | mitigate | `authenticateJWT` wired BEFORE `multer` in the middleware chain — unauthenticated requests return 401 before body parse (T-16-04 pattern) |
| T-QUICK-05 | Cache exhaustion | candidateCache | mitigate | Reuses existing `evictIfNeeded` (per-user cap 15, global cap 100). Manual uploads participate in the same eviction so they cannot cause unbounded growth |

No new npm packages installed → no supply-chain gate needed.
</threat_model>

<verification>
- Backend endpoint accepts multipart with field `avatar`, valid image mime, ≤5 MB, valid JWT → returns 200 `{id}`
- Auth missing → 401 before parse
- Mime rejected (text/plain) → 400 with clear error, no cache entry
- Oversize → 413, no cache entry
- Missing avatar field → 400
- Frontend: Upload… button visible in BOTH dialogs
- Frontend: manual upload → preview renders + generated candidates cleared
- Frontend: Generate clears manual preview + revokes object URL
- Frontend: dialog close revokes any live object URL
- Frontend: birth path forwards manual id verbatim as `avatarCandidateId`
- Frontend: clone path forwards manual id verbatim as `avatarCandidateId`
- Birth/clone route files (`identity-birth.ts`, `identity-clone.ts`) are untouched (git diff confirms zero changes)
- Nginx configs untouched (git diff confirms zero changes to docker/nginx.conf and docker/nginx-https.conf)
- Full suite green
</verification>

<success_criteria>
- POST /identities/avatar/candidate/manual returns `{id}` on happy path; 401/400/413 on the appropriate failure modes
- `putAvatarCandidate`-equivalent write goes to the same `candidateCache` used by /batch (verified via `_getCandidateCacheForTest`)
- BOTH dialogs (NewSessionDialog, CloneAgentDialog) render an Upload… button and support manual-vs-generated mutual exclusion + object URL cleanup
- Birth (`identity-birth.ts`) and clone (`identity-clone.ts`) endpoint files are untouched
- Nginx configs untouched
- `npx vitest run src/backend/database/routes/identity-avatar-batch.test.ts` → green
- `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx src/ui/sidebar/CloneAgentDialog.test.tsx` → green
- `npx vitest run` (full suite) → green (or no new failures vs HEAD~1)
- Zero new npm dependencies added
</success_criteria>

<output>
Create `.planning/quick/260808-rtl-manual-avatar-upload-at-agent-creation/260808-rtl-SUMMARY.md` when done.
</output>
