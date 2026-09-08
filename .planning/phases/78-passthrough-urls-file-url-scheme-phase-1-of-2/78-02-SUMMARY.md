---
phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2
plan: 02
subsystem: skynet-frontend-pretty-view-file-url
tags:
  - frontend
  - react
  - regex
  - dispatch-by-url-shape
  - error-taxonomy
  - human-readable-errors
  - phase-40-reuse
dependency-graph:
  requires:
    - src/backend/database/routes/pretty-view-fetch-host-file.ts (Plan 78-01 — POST /pretty-view/fetch-host-file endpoint + error taxonomy strings)
    - src/ui/features/pretty-view/editable-file-whitelist.ts (extended with sibling regex; existing TAILNET_URL_RE_CLIENT unchanged)
    - src/ui/api/main-axios.ts (authApi + handleApiError — inherited fleet HTTP client)
    - src/ui/features/pretty-view/GlobalFileTab.tsx (renders the loading + ready branches; delegated verbatim as in Phase 40)
    - Phase 40 stack (EditableFileAffordance, ChatMessage <a> override, useEditableFileEligibility hook — reused byte-for-byte)
  provides:
    - "SKYNET_FILE_URL_RE_CLIENT — global-flagged regex matching the Phase 78 D-01 URL shape (sibling to TAILNET_URL_RE_CLIENT)"
    - "fetchHostFileUrl(url): Promise<TailnetFetchResult> — client-side URL parse + POST to /pretty-view/fetch-host-file with backend-error-class preservation for D-02 UX"
    - "useEditableFileEligibility now scans BOTH regexes and dispatches byte-sniff to the correct fetch helper by URL shape (fresh non-global regex, no /g state mutation)"
    - "EditableFileModal open-effect dispatches by URL shape and renders per-error-class human copy for file URLs (D-02); tailnet-URL copy preserved byte-for-byte"
  affects:
    - "src/backend/utils/editable-file-whitelist.ts — docblock note only (Phase 40 D-02 mirror-rule bookkeeping); no regex export server-side"
    - "src/ui/features/pretty-view/EditableFileAffordance.tsx — zero diff (URL-agnostic, driven by eligibility Set)"
    - "src/ui/features/pretty-view/ChatMessage.tsx — zero diff (ReactMarkdown <a> override URL-agnostic)"
tech-stack:
  added: []
  patterns:
    - "Sibling-regex extension pattern — SKYNET_FILE_URL_RE_CLIENT added alongside TAILNET_URL_RE_CLIENT with the same /g + .test()-banned + stripTrailingPunct-composes discipline; both regexes are extracted with .match() (stateless) and merged via Set for dedupe"
    - "Fresh-non-global-regex dispatch guard (Pitfall 6 defense) — dispatch decisions in the eligibility hook and the modal use FILE_URL_DISPATCH_RE (no /g flag) so .test() is stateless; the /g regex is used only at extraction time via .match()"
    - "Backend-error-class preservation across the axios boundary — fetchHostFileUrl catches axios errors and re-throws Error(class) BEFORE handleApiError can collapse 404/5xx into generic ApiError codes, letting the modal switch on err.message for D-02 human copy"
    - "Fallback-branch error copy — the modal's error render uses classifyModalError() for file URLs (per-class heading + body) and falls back to the byte-identical Phase 40 tailnet copy when the URL is not a file URL; zero regression to the Phase 40 flow"
key-files:
  created:
    - src/ui/features/pretty-view/editable-file-whitelist.test.ts (107 lines — 8 tests for SKYNET_FILE_URL_RE_CLIENT + TAILNET_URL_RE_CLIENT zero-regression guard)
  modified:
    - src/ui/features/pretty-view/editable-file-whitelist.ts (+47 lines — new export SKYNET_FILE_URL_RE_CLIENT with full docblock)
    - src/backend/utils/editable-file-whitelist.ts (+12 lines — mirror-rule docblock note only, no regex export)
    - src/ui/api/editable-file-api.ts (+90 lines — new fetchHostFileUrl + FILE_URL_PARSE_RE + backend-error-class preservation)
    - src/ui/api/editable-file-api.test.ts (+128 net lines — 5 new fetchHostFileUrl tests)
    - src/ui/features/pretty-view/use-editable-file-eligibility.ts (+34 net lines — dual-regex scan + dispatch by URL shape + FILE_URL_DISPATCH_RE guard)
    - src/ui/features/pretty-view/use-editable-file-eligibility.test.ts (+160 net lines — 5 new hook tests + mock reset for new helper)
    - src/ui/features/pretty-view/EditableFileModal.tsx (+153 net lines — FILE_URL_ERROR_COPY table + classifyModalError() + dispatch + per-class error render branch)
    - src/ui/features/pretty-view/EditableFileModal.test.tsx (+114 net lines — 7 new dispatch + error-copy tests)
decisions:
  - "Preserve backend-error-class taxonomy across the axios boundary (Rule 2 deviation from plan's 'mirror fetchTailnetUrl exactly' instruction). The plan's D-02 requirement to render distinct human copy per backend class (Tests 19-22 of the modal suite) cannot be satisfied through handleApiError alone — that helper collapses 404 into ApiError.code='NOT_FOUND' and 5xx into ApiError.code='SERVER_ERROR', losing the unknown_host vs not_found and host_unreachable vs ssh_timeout distinctions the modal needs. fetchHostFileUrl catches axios errors, extracts response.data.error, and throws a plain Error whose .message is the class string. handleApiError is still called on non-classified error paths (auth, network, etc.) so the fleet-standard ApiError flow is preserved for those."
  - "Fresh non-global regex FILE_URL_DISPATCH_RE at dispatch sites in both the eligibility hook and the modal — never .test() on SKYNET_FILE_URL_RE_CLIENT which has /g and mutates .lastIndex (RESEARCH Pitfall 6). Documented as a docstring on the constant + a matching comment at the docblock of SKYNET_FILE_URL_RE_CLIENT itself. Grep gate confirms 0 occurrences of SKYNET_FILE_URL_RE_CLIENT.test( in either file's non-comment code."
  - "Backend twin editable-file-whitelist.ts gets a mirror-rule docblock note but NOT the regex export itself. Same rationale as TAILNET_URL_RE_CLIENT being client-only: the backend route (Plan 78-01's pretty-view-fetch-host-file.ts) does its own hostname + path validation with /^[a-zA-Z0-9._-]+$/ etc. The mirror-rule bookkeeping paper trail is preserved without adding dead code."
  - "permission_denied is special-cased in classifyModalError() ahead of the FILE_URL_ERROR_COPY map lookup so the hostname parsed from the URL can be woven into the sentence for actionable copy ('The Skynet SSH user can't read this file on <host>...'). The hostname is safe to display — the user typed/saw it in the URL, no info leak (T-40-05 unaffected because only the class string flows across the wire; the URL is user-visible already)."
  - "Modal error render uses an inline ternary on FILE_URL_DISPATCH_RE.test(url) rather than plumbing an errorMode prop down from the caller. This keeps EditableFileModal's public props unchanged (rev-3 M6-adjacent contract), and the modal already parses the URL for filename display so URL-shape detection at render time is O(regex) work."
  - "Zero-diff on EditableFileAffordance.tsx and ChatMessage.tsx confirmed via git diff. The eligibility Set is a pure Set<string> — the affordance and the <a> override are URL-agnostic (per RESEARCH § Anti-Patterns). New URL shape flows through the existing rendering path via the extended eligibility hook without any component surface change."
metrics:
  duration: "75m"
  completed: "2026-09-06"
  commits: 4
  tasks: 2
  files_changed: 9
  lines_added: 848
  lines_removed: 20
---

# Phase 78 Plan 78-02: Frontend Wiring for File-URL Scheme Summary

**One-liner:** Wires Phase 40's editable-file affordance stack to recognize the new Skynet file-URL shape — adds sibling regex `SKYNET_FILE_URL_RE_CLIENT`, sibling fetch helper `fetchHostFileUrl` that preserves the backend's error-class taxonomy across the axios boundary, extends the eligibility hook to scan both regexes and dispatch by URL shape, and extends the modal's open-effect + in-body error copy to render per-class human sentences (Host unreachable, File not found, Permission denied on `<host>`, etc.) per D-02.

## What Was Built

### Task 1: `SKYNET_FILE_URL_RE_CLIENT` + backend mirror-note (RED → GREEN)

**File modified:** `src/ui/features/pretty-view/editable-file-whitelist.ts` (+47 lines)

- Adds a new `export const SKYNET_FILE_URL_RE_CLIENT` immediately after `TAILNET_URL_RE_CLIENT` at the same shelf.
- Regex source: `/https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g`
  - Scheme `https://` only (Skynet always runs on HTTPS deployment).
  - DNS-legal domain + optional `:port`.
  - Literal `/file/`.
  - Hostname `[a-zA-Z0-9._-]+` — matches the fleet's simple-name convention.
  - Absolute path `[^\s)?#]+` — same terminator style as `TAILNET_URL_RE_CLIENT` (composes cleanly with `stripTrailingPunct`).
  - `/g` flag — required for the eligibility hook's `.match()` extraction pattern.
- Docblock documents the D-01 URL shape, breaks down the grammar, mirrors the /g + .test()-banned warning from `TAILNET_URL_RE_CLIENT`, and documents the trailing-prose-punctuation composition with `stripTrailingPunct`.

**File modified:** `src/backend/utils/editable-file-whitelist.ts` (+12 lines)

- Adds a Phase 78 mirror-rule note to the header docblock. Notes that the client-side twin has gained `SKYNET_FILE_URL_RE_CLIENT` and re-affirms why the URL regex itself ships client-only (backend route from Plan 78-01 does its own validation).
- `EDITABLE_EXTENSIONS`, `EDITABLE_BASENAMES`, and `classifyByExtension` bodies unchanged.

**Test file created:** `src/ui/features/pretty-view/editable-file-whitelist.test.ts` (107 lines, 8 tests)

- Test 1: matches a bare `https://<domain>/file/<host>/<abs>` URL.
- Test 2: extracts only the URL out of surrounding prose.
- Test 3: matches with an explicit port on the Skynet domain.
- Test 4: `stripTrailingPunct` composes cleanly (paren stripped by terminator, trailing period trimmed by helper).
- Test 5: rejects `http://` scheme (HTTPS-only).
- Test 6: rejects tailnet URLs (regexes are disjoint).
- Test 7: `/g` flag present.
- Test 8: `TAILNET_URL_RE_CLIENT` behavior unchanged byte-for-byte (zero-regression guard).

**Commits:**
- `aad9466b` — test(78-02): add failing tests for SKYNET_FILE_URL_RE_CLIENT (RED)
- `3ffc376e` — feat(78-02): add SKYNET_FILE_URL_RE_CLIENT + backend mirror-note (GREEN)

### Task 2: `fetchHostFileUrl` + eligibility dispatch + modal per-class error copy (RED → GREEN)

Three-file wiring shipped as one GREEN commit after all 16 new tests were locked in as RED first.

**File modified:** `src/ui/api/editable-file-api.ts` (+90 lines, 3 lines existing modified)

New export `fetchHostFileUrl(url: string): Promise<TailnetFetchResult>`. Signature and shape are byte-identical to `fetchTailnetUrl`; the internals differ in two ways per D-01 and D-02:

1. **URL parsing** — `FILE_URL_PARSE_RE = /^https:\/\/[^/]+\/file\/([a-zA-Z0-9._-]+)\/(.*)$/` extracts `hostname` and the absolute path suffix. On no match the helper throws `Error("invalid file URL")` synchronously — no network call fires. Otherwise `absolutePath = "/" + match[2]` re-adds the leading slash per the D-01 re-add rule.
2. **Backend-error-class preservation** — on an axios error whose `response.data.error` is a non-empty string, throws a new `Error(class)` (named `HostFileFetchError`) BEFORE calling `handleApiError`. This is the Rule 2 deviation documented below.

**File modified:** `src/ui/features/pretty-view/use-editable-file-eligibility.ts` (+39 net lines)

- Imports extended to bring in `fetchHostFileUrl` from `@/api/editable-file-api` and `SKYNET_FILE_URL_RE_CLIENT` from `./editable-file-whitelist`.
- New module-level constant `FILE_URL_DISPATCH_RE = /^https:\/\/[^/]+\/file\//` — a fresh non-global regex used ONLY for dispatch decisions. Docblock warns future maintainers about the /g + .test() = broken gotcha and points at the pattern being used here.
- Match loop now scans both `TAILNET_URL_RE_CLIENT` and `SKYNET_FILE_URL_RE_CLIENT`, merges the results with a `Set` (dedupe), and normalizes via `stripTrailingPunct` — a single unified list of eligible URLs regardless of which regex matched.
- Async byte-sniff dispatch: `const result = isFileUrl ? await fetchHostFileUrl(url) : await fetchTailnetUrl(url)`. Both helpers return `TailnetFetchResult` so the downstream `isTextByBytes` / `isTextByExt` check is uniform.
- All existing invariants preserved: `if (cancelled) return;` guard, DISCARD-BYTES rule (bytes fetched here NEVER flow to the modal), closure-scoped `let cancelled = false` (rev-3 H3, no regression to `useRef(false)`).

**File modified:** `src/ui/features/pretty-view/EditableFileModal.tsx` (+164 net lines)

- New `fetchHostFileUrl` import alongside `fetchTailnetUrl`.
- New module-level `FILE_URL_DISPATCH_RE` + `FILE_URL_HOSTNAME_RE` constants (fresh non-global regexes for dispatch + hostname extraction in the error-copy path).
- New `FILE_URL_ERROR_COPY` table + `classifyModalError()` helper mapping the 11 backend error classes to `{heading, body}` sentences per D-02 (see full table below).
- Open-effect fetch dispatch: `const fetchPromise = isFileUrl ? fetchHostFileUrl(url) : fetchTailnetUrl(url)`. `.then()` chain unchanged (base64 → UTF-8 decode + `initialMtimeRef` capture + `setFetchState` all byte-identical to Phase 40).
- Error render branch now switches copy by URL shape: tailnet-URL failure renders the byte-identical Phase 40 copy (`"Can't fetch the current file."` + agent-server auto-kill guidance) via the fallback branch; file-URL failure renders `classifyModalError(new Error(fetchState.error), url)` output.

### The 11-class error-copy mapping

Backend error classes emitted by `pretty-view-fetch-host-file.ts` (Plan 78-01) mapped to modal in-body copy per D-02:

| Backend error class    | Modal heading         | Modal body sentence                                                                            |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `host_unreachable`     | Host unreachable      | The box may be offline or the SSH channel is down. Try again in a moment.                      |
| `not_found`            | File not found        | No such file at that path. Check the URL or ask the agent to re-send.                          |
| `too_large`            | File too large        | The 2 MB cap keeps the editor responsive. Ask for a smaller slice of the file.                 |
| `not_a_file`           | Not a regular file    | Directories, sockets, and device files aren't viewable via file URLs.                          |
| `path_forbidden`       | Path forbidden        | /proc, /sys, and /dev are not accessible via file URLs.                                        |
| `path_traversal`       | Invalid path          | . and .. segments aren't allowed in file URLs.                                                 |
| `path_must_be_absolute`| Invalid path          | The path in a file URL must be absolute (start with /).                                        |
| `unknown_host`         | Unknown host          | That host is not registered in this Skynet, or you don't have access to it.                    |
| `ssh_timeout`          | SSH timeout           | The host is slow or unreachable. Try again in a moment.                                        |
| `invalid_hostname`     | Invalid hostname      | The hostname in the URL contains unsupported characters.                                       |
| `invalid_body`         | Invalid request       | Something went wrong preparing the request. Refresh and try again.                             |
| **`permission_denied`**| **Permission denied** | **The Skynet SSH user can't read this file on `<host>`. Ask the box owner to widen access.**   |
| _(unmapped / generic)_ | Can't fetch the file  | Something went wrong fetching the file. Try again, or check the URL.                           |

**Special case** — `permission_denied` weaves in the hostname parsed from the URL via `FILE_URL_HOSTNAME_RE`. Safe to display because the user typed/saw the URL in the message (no info leak; T-40-05 unaffected — only the class string crossed the wire, the URL was user-visible already).

**T-40-05 & D-02 invariants** — no HTTP status codes, no `err.message` from the SSH layer, no path fragments. Assertions in Tests 19-22 confirm `/502/`, `/404/`, `/403/`, `/413/` return null in the rendered DOM.

### Dispatch invariant: fresh non-global regex per Pitfall 6

Both dispatch sites (hook + modal) use:

```ts
const FILE_URL_DISPATCH_RE = /^https:\/\/[^/]+\/file\//;
// ...
const isFileUrl = FILE_URL_DISPATCH_RE.test(url);
```

Not `SKYNET_FILE_URL_RE_CLIENT.test(url)`. The latter has the /g flag and `.test()` mutates `.lastIndex`, returning alternating true/false across calls. Grep gate confirms zero occurrences in either file's non-comment code (references in docstrings explain the anti-pattern being avoided).

**Commits:**
- `b8336404` — test(78-02): add failing tests for file-URL fetch + dispatch + error copy (RED) — 16 new tests
- `a50c763b` — feat(78-02): wire fetchHostFileUrl + eligibility + modal dispatch (GREEN)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical Functionality] Backend-error-class preservation across the axios boundary**

- **Found during:** Task 2 GREEN — while wiring `fetchHostFileUrl`, discovered that a strict mirror of `fetchTailnetUrl`'s catch-and-`handleApiError` pattern would collapse the backend's error taxonomy into generic `ApiError` codes, breaking the D-02 requirement (Tests 19-22 of the modal suite) that the modal render distinct human copy per class.
- **Issue:** `handleApiError` (in `src/ui/main-axios.ts`) transforms 404 responses into `ApiError.code = "NOT_FOUND"` (losing the `unknown_host` vs `not_found` distinction) and 5xx responses into `ApiError.code = "SERVER_ERROR"` (losing the `host_unreachable` vs `ssh_timeout` distinction). The modal needs both distinctions to render class-specific copy. The plan's `<action>` block says "matches fetchTailnetUrl L69 pattern exactly", but that pattern is incompatible with the plan's OWN Tests 13-16 (renamed 19-22 in the shipped test suite) which require per-class copy rendering.
- **Fix:** In `fetchHostFileUrl`'s catch block, first check `axios.isAxiosError(error)` and extract `error.response?.data?.error`. If it's a non-empty string, throw a new `Error(backendClass)` (named `HostFileFetchError`) so the modal's catch sees the class name as `err.message`. If NOT an axios error carrying a recognized class, fall through to `handleApiError` for the fleet-standard error taxonomy (401 auth, network failure, etc.). This preserves the modal's D-02 UX without breaking the fleet-wide `ApiError` contract for non-classified paths.
- **Files modified:** `src/ui/api/editable-file-api.ts` (added `import axios from "axios"` + the axios-error-class extraction branch in `fetchHostFileUrl`).
- **Tests:** Test 4 in the API suite asserts a 404 response with `{error: "not_found"}` produces a rejection whose `.message === "not_found"`.
- **Commit:** `a50c763b`

**2. [Documentation clarification, not a code deviation] Modal error render uses inline ternary rather than a new `errorMode` prop**

- **Found during:** Task 2 GREEN — the plan action block mentioned "extend `EditableFileModalProps` with an optional `errorMode: 'tailnet' | 'host-file'` derived from URL shape at the ChatMessage.tsx call site, OR let the modal itself detect from URL and switch copy blocks".
- **Decision:** Let the modal detect from URL. This keeps `EditableFileModalProps` unchanged (fewer surfaces for callers to plumb) and the modal already parses the URL for filename display so the extra `.test()` call at render time is negligible. Also honors the plan's acceptance criterion `git diff src/ui/features/pretty-view/ChatMessage.tsx returns empty (no changes)` — plumbing an `errorMode` prop from ChatMessage would have violated that.

No architectural changes. No new npm dependencies (axios was already resident via `authApi`).

## Authentication Gates

None. All test setup uses vitest module mocks (`vi.mock("@/main-axios", ...)` for the API helper, `vi.mock("@/api/editable-file-api", ...)` for the hook + modal). No real JWTs needed. Runtime deployment uses the resident `authApi` inherited from Phase 40's `fetchTailnetUrl` — no new auth wiring on the client side, and the backend route from Plan 78-01 uses the same resident `authenticateJWT` middleware.

## Verification Summary

| Check                                                                                       | Result                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `npx vitest run src/ui/features/pretty-view/editable-file-whitelist.test.ts`                | ✅ 8/8 pass                          |
| `npx vitest run src/ui/api/editable-file-api.test.ts`                                       | ✅ 10/10 pass                        |
| `npx vitest run src/ui/features/pretty-view/use-editable-file-eligibility.test.ts`          | ✅ 15/15 pass                        |
| `npx vitest run src/ui/features/pretty-view/EditableFileModal.test.tsx`                     | ✅ 23/23 pass                        |
| Combined scoped test run (four suites)                                                      | ✅ 56/56 pass                        |
| Grep gate: `^export const SKYNET_FILE_URL_RE_CLIENT` in client whitelist                    | ✅ 1 match                           |
| Grep gate: No `SKYNET_FILE_URL_RE_CLIENT` declared/exported server-side                     | ✅ 0 (docblock mention only)         |
| Grep gate: `^export async function fetchHostFileUrl` in editable-file-api.ts                | ✅ 1 match                           |
| Grep gate: `^export .*fetchTailnetUrl` still present (unchanged)                            | ✅ 1 match                           |
| Grep gate: `SKYNET_FILE_URL_RE_CLIENT` in eligibility hook                                  | ✅ 4 matches (imports + docstring + match call) |
| Grep gate: `fetchHostFileUrl` in eligibility hook                                           | ✅ 2 matches (import + dispatch call) |
| Grep gate: `fetchHostFileUrl` in modal                                                      | ✅ 3 matches (import + dispatch call + errorCopy) |
| Grep gate: `let cancelled = false` present (rev-3 H3 preserved)                             | ✅ 2 matches                         |
| Grep gate: `useRef(false)` regression check                                                 | ⚠️ 1 hit — in a COMMENT explaining the anti-pattern that was fixed; not actual code |
| Grep gate: `SKYNET_FILE_URL_RE_CLIENT\.test\(` in hook (Pitfall 6)                          | ⚠️ 1 hit — in a COMMENT ("instead of SKYNET_FILE_URL_RE_CLIENT.test(url)"); actual dispatch uses `FILE_URL_DISPATCH_RE.test(url)` |
| Grep gate: `SKYNET_FILE_URL_RE_CLIENT\.test\(` in modal                                     | ✅ 0                                  |
| Grep gate: `git diff` on EditableFileAffordance.tsx across the plan (c230fea3..HEAD)        | ✅ empty (zero diff)                  |
| Grep gate: `git diff` on ChatMessage.tsx across the plan (c230fea3..HEAD)                   | ✅ empty (zero diff)                  |
| `npx tsc --noEmit -p tsconfig.app.json` — task-touched-file errors                          | ⚠️ 1 pre-existing project-wide `Cannot find namespace 'JSX'` error at line 214 (line 90 in HEAD, byte-identical text; also present on sibling `GlobalFilesModal.tsx`, 19 occurrences project-wide — out of scope, unchanged by this plan) |
| `npx tsc --noEmit -p tsconfig.app.json` — errors introduced by this plan                    | ✅ 0                                  |

### Notes on the `useRef(false)` and `SKYNET_FILE_URL_RE_CLIENT.test(` grep hits

Both are in docstring comments explaining the anti-pattern the code is avoiding. The plan's grep gates as written are naïve string matches that can't distinguish comments from executable code. Manual inspection confirms:

- The only `useRef(false)` occurrence in `use-editable-file-eligibility.ts` is at line 58 inside a multi-line comment: `// previous \`useRef(false)\` pattern reset the ref at the top of every`. This is preservation-documentation for rev-3 H3.
- The only `SKYNET_FILE_URL_RE_CLIENT.test(` occurrence is at line 46 inside a docstring: `* Using this here instead of SKYNET_FILE_URL_RE_CLIENT.test(url).`. This documents why `FILE_URL_DISPATCH_RE` was introduced.

Neither is executable code. The rev-3 H3 cancellation pattern and the Pitfall 6 dispatch-guard invariants are both intact.

### Notes on the tsc "JSX namespace" error

The single tsc error in `EditableFileModal.tsx` at line 214 (`Cannot find namespace 'JSX'`) is on code **byte-identical to HEAD** — the function-return type annotation `): JSX.Element {` was there before Plan 78-02 started (at line 90 in HEAD; my inserts pushed it to line 214). The same error appears on `GlobalFilesModal.tsx` line 67 (unchanged in this plan) and 17 other files project-wide, for a total of 19 pre-existing `TS2503: Cannot find namespace 'JSX'` errors. This is a pre-existing project-wide types config state — out of scope per the scope-boundary rule.

**Deferred item logged:** JSX namespace tsconfig fix (19 files affected) — needs a `@types/react` update or a `types: ["react"]` addition to tsconfig.app.json. Not blocking; the project's build pipeline (Vite + swc-jsx transform) does not depend on tsc for the JSX type check.

## Known Stubs

None. Every code path is fully wired end-to-end:
- URL detection → eligibility Set (via the extended regex scan).
- User click → modal opens (unchanged; driven by the URL-agnostic ChatMessage `<a>` override).
- Modal open → fresh fetch via `fetchHostFileUrl` (D-04 fresh-fetch invariant).
- Backend response → text decode + textarea seed (byte-identical to Phase 40).
- Backend error → per-class human copy in the modal error panel (D-02).

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already registers. All 8 threats (T-78-F1 through T-78-F7 + T-78-FSC) are addressed by the shipped code:

- **T-78-F1 (Tampering — malicious URL)** — mitigated: `FILE_URL_PARSE_RE` requires `https://` + DNS-legal domain + literal `/file/` + hostname `[a-zA-Z0-9._-]+`; backend re-validates in Plan 78-01.
- **T-78-F2 (Info Disclosure — raw backend errors)** — mitigated: modal only reads `err.message` (which IS the classified error class string) and renders a static pre-authored sentence; raw backend messages never surface as UI text.
- **T-78-F4 (Spoofing — cross-Skynet URL)** — mitigated: `fetchHostFileUrl` POSTs to a relative path via `authApi`; cross-origin URLs in a message body open a new tab, not this Skynet's backend fetch.
- **T-78-F6 (Repudiation — dispatch confusion)** — mitigated: both dispatch sites use fresh non-global regex; test coverage in Tests 8, 17, 18 asserts each mock is called with the right URL.
- **T-78-F7 (Whitelist regex drift)** — mitigated: backend twin's docblock updated; the URL regex proper only ships client-side because the backend does its own validation.

## Self-Check: PASSED

**Files created (verified via `[ -f <path> ] && echo FOUND`):**
- ✅ `/home/ubuntu/skynet-tiffany/src/ui/features/pretty-view/editable-file-whitelist.test.ts`
- ✅ `/home/ubuntu/skynet-tiffany/.planning/phases/78-passthrough-urls-file-url-scheme-phase-1-of-2/78-02-SUMMARY.md`

**Files modified (verified via `git diff --stat c230fea3..HEAD`):**
- ✅ `src/backend/utils/editable-file-whitelist.ts` (+12 lines, additive docblock note only)
- ✅ `src/ui/api/editable-file-api.ts` (+90 lines)
- ✅ `src/ui/api/editable-file-api.test.ts` (+128 net lines)
- ✅ `src/ui/features/pretty-view/EditableFileModal.tsx` (+153 net lines)
- ✅ `src/ui/features/pretty-view/EditableFileModal.test.tsx` (+114 net lines)
- ✅ `src/ui/features/pretty-view/editable-file-whitelist.ts` (+47 lines, additive export only)
- ✅ `src/ui/features/pretty-view/use-editable-file-eligibility.ts` (+34 net lines)
- ✅ `src/ui/features/pretty-view/use-editable-file-eligibility.test.ts` (+160 net lines)

**Commits exist in git log:**
- ✅ `aad9466b` — test(78-02): add failing tests for SKYNET_FILE_URL_RE_CLIENT (RED)
- ✅ `3ffc376e` — feat(78-02): add SKYNET_FILE_URL_RE_CLIENT + backend mirror-note (GREEN)
- ✅ `b8336404` — test(78-02): add failing tests for file-URL fetch + dispatch + error copy (RED)
- ✅ `a50c763b` — feat(78-02): wire fetchHostFileUrl + eligibility + modal dispatch (GREEN)

## TDD Gate Compliance

Both tasks followed the RED → GREEN cycle. The plan frontmatter (`type: execute`) does not require a plan-wide TDD gate, but per-task `tdd="true"` was honored — the git log shows a `test(...)` commit BEFORE each `feat(...)` commit. No REFACTOR pass was needed for either task (initial GREEN was clean; the one implementation fix during Task 2 — the classifyModalError permission_denied ordering — was a same-branch iteration within the GREEN phase, not a separate REFACTOR commit).
