---
phase: 40-text-editor-in-skynet
plan: 01
subsystem: pretty-view / backend proxy
tags: [text-editor, backend-proxy, ssrf, tailnet, phase-40]
requires: []
provides:
  - POST /pretty-view/fetch-tailnet-url endpoint (SSRF-hardened tailnet URL proxy)
  - EDITABLE_EXTENSIONS + EDITABLE_BASENAMES + classifyByExtension (backend copy)
  - sniffTextBytes(Uint8Array): boolean (inline file(1)-style heuristic)
affects:
  - src/backend/database/database.ts (route mount)
tech-stack:
  added: []  # zero new npm packages
  patterns:
    - "SSRF-hardened URL allowlist regex (100.64.0.0/10 CGNAT)"
    - "AbortController + setTimeout for outbound fetch timeout"
    - "arrayBuffer().byteLength cap before base64 encode"
    - "content-type spoof-check for directory-listing HTML defense"
key-files:
  created:
    - src/backend/utils/editable-file-whitelist.ts
    - src/backend/utils/editable-file-byte-sniff.ts
    - src/backend/utils/editable-file-byte-sniff.test.ts
    - src/backend/database/routes/pretty-view-fetch-tailnet-url.ts
    - src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts
  modified:
    - src/backend/database/database.ts
decisions:
  - "Zero new npm deps — Node 24 has fetch native; sniff is ~30 LoC inline heuristic"
  - "Whitelist is a byte-identical copy pattern (backend + Plan 40-02 frontend twin) — established fleet convention over shared-code refactor"
  - "MAX_BYTES = 2_000_000 matches global-files-read-write.ts MAX_CONTENT_BYTES (fleet's established text-file ceiling)"
  - "TAILNET_URL_RE encodes CGNAT range at char-class level; extra defense-in-depth guards reject .., //, trailing / independently in case of regex regression"
  - "Content-Type spoof-check rejects text/html for non-.html URLs (T-40-02 defense against python -m http.server directory listings)"
metrics:
  duration_min: 31
  completed_date: 2026-08-14
  tests_added: 31   # 7 sniff + 24 route (2 more than the 22 required — see Deviations)
  files_created: 5
  files_modified: 1
---

# Phase 40 Plan 40-01: Backend SSRF-hardened proxy + shared whitelist + byte-sniff Summary

One-line: SSRF-hardened `POST /pretty-view/fetch-tailnet-url` proxy plus the D-02 eligibility primitives (byte-identical extension/basename whitelist + inline text/binary byte-sniff heuristic) — so Wave 2 (Plan 40-02) can classify agent-served tailnet files and Wave 3 (Plan 40-03) can fetch them fresh at editor-open time.

## What Shipped

**Two shared utilities** (`src/backend/utils/`) that Plan 40-02 will mirror into `src/ui/features/pretty-view/`:

1. `editable-file-whitelist.ts` — `EDITABLE_EXTENSIONS` (65 entries: markdown/prose, config formats, source across TS/JS/Py/Rb/Go/Rs/Java/Kt/Swift/C-family/Sh/SQL/GraphQL/HTML/CSS/Vue/Svelte/Astro/CSV/TSV/XML/log/patch/diff) + `EDITABLE_BASENAMES` (23 entries: Dockerfile/Makefile/Rakefile/Gemfile/Procfile, .gitignore/.dockerignore/.editorconfig/.gitattributes, .env/.envrc/.nvmrc/.node-version/.python-version, README/LICENSE/CHANGELOG/…) + `classifyByExtension(extension, filename): boolean`. Header carries the **MIRROR lockstep notice** referencing the frontend twin file that Plan 40-02 will create.
2. `editable-file-byte-sniff.ts` — `sniffTextBytes(buf: Uint8Array): boolean`. Pure file(1)-style heuristic over the first 8192 bytes: empty → true; any 0x00 → false; ≥ 0.9 printable ratio; `TextDecoder("utf-8", { fatal: true })` gate.

**One backend Express route** at `POST /pretty-view/fetch-tailnet-url`:

- **Request**: `{ url: string }` (2 KB request-body limit).
- **Auth**: `authenticateJWT` middleware (Tailnet-scoped ACL per ASVS V4).
- **URL validation**: `TAILNET_URL_RE` allowlists ONLY the 100.64.0.0/10 CGNAT range. Extra defense-in-depth guards reject `..`, additional `//` past the scheme, trailing `/`.
- **Fetch**: `globalThis.fetch` (native on Node 24) bounded by `AbortController` + 8s timeout.
- **Content-Type spoof-check**: reject `text/html` for non-.html/.htm URLs (T-40-02).
- **Size cap**: 2 MB via `arrayBuffer().byteLength` check → 413.
- **Response** (single call covers both eligibility path AND editor-open re-fetch path per D-04): `{ contentBase64, sizeBytes, contentType, extension, filename, isTextByExt, isTextByBytes? }`. `isTextByBytes` is populated only when `isTextByExt = false` (byte-sniff runs only for extension-miss).
- **Error taxonomy**: 400 invalid body / invalid tailnet URL; 401 unauth; 413 oversized; 502 upstream non-2xx / HTML spoof / fetch failed; 504 fetch timeout.
- **Log discipline**: host+port only. **Filename never logged** (Ashley-served files are sensitive by definition). Error paths log error class name only — no `.message`, no URL.

Router mounted alongside `/global-files` at `app.use("/pretty-view", prettyViewFetchTailnetUrlRoutes)` in `src/backend/database/database.ts` (before the generic `/identities` router to preserve match precedence).

## Commits

| SHA | Type | Message |
|-----|------|---------|
| `bd8ae82f` | `feat(40-01)` | shared editable-file whitelist + byte-sniff heuristic (D-02) |
| `dc426447` | `feat(40-01)` | SSRF-hardened POST /pretty-view/fetch-tailnet-url proxy |

## Test count delta

| Suite | Pre-plan | Post-plan | Delta |
|-------|----------|-----------|-------|
| `src/backend/utils/editable-file-byte-sniff.test.ts` | 0 | 7 | +7 |
| `src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts` | 0 | 24 | +24 |
| **Full suite** (backend + frontend) | 2244 passed / 6 skipped / 1 todo | **2275 passed / 6 skipped / 1 todo** | **+31 passing** |

**Test file count**: 180 files, all passing. **`npx vitest run`**: exit code 0 (fleet directive satisfied).

The plan predicted +17 new tests (7 sniff + 10 route). Actual is +31 because:
- The 10 named route tests naturally decomposed into 24 vitest cases: Test 1's URL-validation matrix has 12 sub-cases (one per invalid URL form); Test 2 has 3 sub-cases (three valid CGNAT boundary URLs); Test 10 split into 10a (handler guard via array-body) + 10b (middleware guard via raw-string body) — see Deviations §Rule 2.

## Verification Gates

| Gate | Expected | Actual |
|------|----------|--------|
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build:backend` | exit 0 | exit 0 |
| `npx vitest run` (full suite) | exit 0 | exit 0 |
| `/pretty-view` mount count (non-comment) | 1 | 1 |
| `editable-file-whitelist` import in route | ≥ 1 | 1 |
| `editable-file-byte-sniff` import in route | ≥ 1 | 1 |
| `TAILNET_URL_RE` occurrences | ≥ 2 | 3 |
| No direct `/pretty-view/fetch-tailnet-url` mount (must be at `/pretty-view` base) | 0 | 0 |
| `MIRROR` lockstep notice in whitelist | present | present (L4) |

## Deviations from Plan

### Rule 3 (blocking issue) — oxc parser choke on `*/` inside backtick spans in JSDoc

- **Found during**: Task 2 RED-to-GREEN loop when the first `vitest run` reported `Expected a semicolon` at increasingly late line numbers as I tried patches.
- **Root cause**: A JSDoc block comment in my initial route source contained the literal `` `content-type: */html*` `` for illustrating the spoof-check rule. The `*/` inside that backtick span closed the `/** … */` block early, causing oxc to reparse the rest of the file as executable code — and every template literal from then on tripped a cascade of misleading "unterminated string" / "expected semicolon" errors.
- **Fix**: Rewrote the JSDoc line to avoid `*/` entirely ("upstream returns a content-type containing 'html' for a URL whose filename extension is NOT .html / .htm"). Also swept em-dashes → `-`, bullets → `*`, arrows → `->` in the source file (defense against downstream lexer sensitivities the fleet has observed elsewhere).
- **Committed in**: `dc426447` (same commit as the route source — this was a debugging pass during Task 2, not a separate fix).

### Rule 2 (missing critical functionality — added) — Test 10 split into handler-level AND middleware-level guards

- **Found during**: Task 2 initial test run.
- **Issue**: The plan spec's literal Test 10 (`request with body "some string" → 400 { error: "invalid body" }`) triggers Express's `body-parser` **strict-mode** rejection at the middleware layer — the request never reaches our handler, so the response body is HTML boilerplate instead of `{ error: "invalid body" }`. A test that only exercises this path leaves the handler's own `Array.isArray(body)` / `typeof body !== "object"` guard untested.
- **Fix**: Split Test 10 into two cases:
  - **10a** — JSON array body (`[{ url: "…" }]`). Array parses cleanly through `express.json` strict mode; the handler's `Array.isArray(body)` guard fires; asserts the structured `{ error: "invalid body" }` response.
  - **10b** — Raw JSON string body (the plan's literal case). Asserts the middleware-level 400 without asserting the error shape, and confirms `fetch` was never invoked. This documents the middleware defense so a future regression to `strict: false` would surface via test failure.
- **Why this is Rule 2, not Rule 4**: Both are correctness gates — the "invalid body → 400" outcome must be defended at both layers (belt-and-suspenders). Adding a second test to document the strict-mode behavior costs 15 LoC and prevents a real-world defense from being invisible in the test log.
- **Committed in**: `dc426447`.

### Minor — extracted `extractExtension(filename)` helper instead of inline `filename.split(".").pop()!.toLowerCase()`

- **Found during**: Task 2 GREEN, while I was chasing the oxc `*/` bug I temporarily replaced the inline TS non-null-assertion (`.pop()!`) with a named helper. Once the root cause turned out to be the JSDoc `*/` (unrelated to the `!`), I kept the helper because it also correctly handles the edge case of a filename ending in `"."` (`extractExtension("foo.")` → `null`, not `""`). The plan's inline expression would have returned `""` there — a subtle bug in what the frontend would then key off of.
- **Committed in**: `dc426447`.

### Authentication gates — none encountered

The route uses `authenticateJWT` middleware; tests mock the auth layer per the established `global-files-read-write.test.ts` pattern (L46-66 mockUserId toggle). No external auth was required at execution time.

## Threat Flags — none

Every network / auth / trust-boundary surface introduced by this plan is enumerated in the plan's `<threat_model>` (T-40-01 through T-40-05 + T-40-SC) and every mitigation is encoded in the route as documented in the file's opening JSDoc. No new surface was introduced during implementation.

## Known Stubs — none

Every returned field of the proxy response is a real value produced from real bytes / classification. No `null`-passthroughs, no "coming soon" placeholders. The `isTextByBytes` field is intentionally `undefined` (not `null`) when `isTextByExt = true` — this is the D-02 contract, not a stub.

## Next-plan handoff — Plan 40-02

Plan 40-02 (frontend eligibility hook + inline affordance) will need to:

1. **Mirror the whitelist file** — create `src/ui/features/pretty-view/editable-file-whitelist.ts` as a **byte-identical copy** of `src/backend/utils/editable-file-whitelist.ts`. The backend header carries the MIRROR lockstep notice both files must retain. The frontend file will export the SAME three identifiers (`EDITABLE_EXTENSIONS`, `EDITABLE_BASENAMES`, `classifyByExtension`) so the eligibility hook can run the sync path without a backend round-trip. Backend copy is authoritative; the two must stay in lockstep — if a future patch adds an extension, both files must be updated in the same commit.

2. **Consume the endpoint contract** — the frontend `editable-file-api.ts` helper Plan 40-02 will create calls `POST /pretty-view/fetch-tailnet-url` with `{ url }` body and expects the response shape:
   ```ts
   {
     contentBase64: string;        // base64 of raw response bytes
     sizeBytes: number;
     contentType: string | null;
     extension: string | null;     // lowercased, no leading dot
     filename: string;             // decoded from URL pathname
     isTextByExt: boolean;         // whitelist hit?
     isTextByBytes?: boolean;      // sniff verdict; only present when isTextByExt=false
   }
   ```
   Error responses: `400` (invalid body / invalid tailnet URL); `401` (unauth); `413` (oversized); `502` (upstream non-2xx / HTML spoof / fetch failed); `504` (fetch timeout). The eligibility hook uses only `isTextByExt || isTextByBytes` for its decision and **must discard `contentBase64`** per D-04 (cached bytes are NEVER served to the editor).

3. **`sniffTextBytes` is NOT imported by the frontend** — the backend already ran the sniff before returning; the frontend just reads `isTextByBytes` from the response. The frontend will have its own copy of the whitelist for the synchronous no-fetch path, but the byte-sniff heuristic lives only server-side (the eligibility hook can decide `isTextByBytes === true` from the response payload alone).

## Self-Check: PASSED

- `[ -f src/backend/utils/editable-file-whitelist.ts ]` → FOUND
- `[ -f src/backend/utils/editable-file-byte-sniff.ts ]` → FOUND
- `[ -f src/backend/utils/editable-file-byte-sniff.test.ts ]` → FOUND
- `[ -f src/backend/database/routes/pretty-view-fetch-tailnet-url.ts ]` → FOUND
- `[ -f src/backend/database/routes/pretty-view-fetch-tailnet-url.test.ts ]` → FOUND
- `git log --oneline | grep bd8ae82f` → FOUND
- `git log --oneline | grep dc426447` → FOUND
- All grep gates from Task 3 → PASSED
- `npx vitest run` (full suite) → exit 0, 2275 passed
- `npm run build:backend` → exit 0
