---
phase: 16-voice-input-in-composebox-mic-button-tap-to-record-stt-via-s
plan: "01"
subsystem: backend-voice-proxy
tags: [voice, stt, express, multer, nginx, proxy]
dependency_graph:
  requires: []
  provides:
    - POST /voice/transcribe (authenticated STT reverse-proxy)
    - nginx routing for /voice/* in both HTTP and HTTPS configs
  affects:
    - src/backend/database/database.ts (route mount)
    - docker/nginx.conf (new location block)
    - docker/nginx-https.conf (new location block)
tech_stack:
  added: []
  patterns:
    - multer memory-storage upload middleware (25MB cap)
    - globalThis.fetch with AbortController timeout
    - Named handler export for function-level testability (debug.ts pattern)
key_files:
  created:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - Used globalThis.fetch (native Node 20+) instead of undici — no undici import needed since multer already parses the multipart and we reconstruct fresh FormData for the STT call
  - Buffer converted to ArrayBuffer via .buffer.slice() to satisfy TypeScript BlobPart constraint (Buffer.buffer is ArrayBufferLike which includes SharedArrayBuffer; TypeScript strict Blob constructor requires ArrayBuffer)
  - Voice location block inserted after compose-drafts block in both nginx configs (lines ~234 in nginx.conf, ~245 in nginx-https.conf post-insert)
  - handleTranscribe exported as named async function following debug.ts handleConsoleLog pattern for direct function-level testing without Express harness
metrics:
  duration: "~8 minutes"
  completed: "2026-07-27"
  tasks_completed: 2
  files_changed: 5
---

# Phase 16 Plan 01: Backend Voice Transcribe Endpoint Summary

**One-liner:** Express POST /voice/transcribe reverse-proxy to tailnet faster-whisper STT with multer 25MB cap, 30s AbortController timeout, and matching nginx location blocks in both HTTP and HTTPS configs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (TDD RED) | Failing tests for voice/transcribe handler | daff6d3 | voice.test.ts |
| 1 (TDD GREEN) | Implement voice/transcribe handler | 7cffa05 | voice.ts |
| 2 | Mount router + nginx location blocks | 6d83174 | database.ts, nginx.conf, nginx-https.conf |

## Implementation Details

### Test count landed: 6 tests
1. POST with file returns 200 + STT `{text}` verbatim
2. STT HTTP 500 surfaced as `{error, status: 500}`
3. STT HTTP 503 surfaced as `{error, status: 503}` (status code preserved)
4. FormData bytes match req.file.buffer exactly (multipart passthrough verification)
5. No file field returns 400 `{error: "missing file field"}`
6. AbortError returns 504 `{error: "STT timeout", status: 504}`

### fetch implementation: globalThis.fetch (native Node 20+)
Multer already parses the incoming multipart into `req.file.buffer`. The handler then constructs a fresh `FormData` with a `Blob` wrapping the buffer bytes and sends it to the STT URL. This avoids any undici-specific API while achieving the same multipart passthrough semantics. No new packages were added.

### TypeScript deviation: Buffer-to-BlobPart conversion
`Buffer.buffer` is typed as `ArrayBufferLike` (includes `SharedArrayBuffer`), which TypeScript's `Blob` constructor does not accept as `BlobPart`. Fixed by using `buffer.buffer.slice(byteOffset, byteOffset + byteLength)` to extract a clean `ArrayBuffer`. This is a Rule 1 auto-fix (TypeScript error blocking compilation).

### nginx block insertion points
- `docker/nginx.conf`: inserted after the `location ~ ^/compose-drafts` block (around original line 233), before `location ~ ^/debug`
- `docker/nginx-https.conf`: inserted after the matching `compose-drafts` block (around original line 244), before `location ~ ^/debug`
- Both blocks are byte-identical in content (CLAUDE.md nginx caveat requirement)

### Threat model mitigations applied
- T-16-01: `multer({ limits: { fileSize: 25 * 1024 * 1024 } })` caps blob before handler runs
- T-16-02: `AbortController` with 30s `setTimeout` aborts hung STT calls
- T-16-03: Non-2xx returns fixed `{error: "STT non-2xx", status}` shape — no STT body forwarded
- T-16-04: `authenticateJWT` is first in middleware chain — unauthenticated requests get 401 before multer parses anything
- T-16-05: Client multipart parsed by multer into `req.file.buffer`; handler constructs fresh FormData for STT — no client Content-Type header reaches STT

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript BlobPart type error on Buffer**
- **Found during:** Task 1 TDD GREEN — TypeScript compile check
- **Issue:** `Buffer.buffer` is `ArrayBufferLike` (includes `SharedArrayBuffer`), which is not assignable to TypeScript's `BlobPart` (`ArrayBuffer | Blob | DataView<ArrayBuffer>`)
- **Fix:** Used `file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer` to produce a clean `ArrayBuffer` that satisfies the constraint
- **Files modified:** `src/backend/database/routes/voice.ts`
- **Commit:** 7cffa05

## Verification Results

- `npx tsc --noEmit -p tsconfig.node.json` exits 0
- `npx vitest run src/backend/database/routes/voice.test.ts` exits 0 with 6 tests passing
- `grep -c "location ~ ^/voice" docker/nginx.conf` returns 1
- `grep -c "location ~ ^/voice" docker/nginx-https.conf` returns 1
- `grep -c "app.use(\"/voice\"" src/backend/database/database.ts` returns 1

## Known Stubs

None — the handler is fully wired to the live STT URL (Nelly-verified).

## Threat Flags

None — all new surface (POST /voice/transcribe) was covered in the plan's threat model.

## Self-Check: PASSED

- voice.ts exists: FOUND
- voice.test.ts exists: FOUND
- Commit daff6d3 (TDD RED): verified in git log
- Commit 7cffa05 (TDD GREEN): verified in git log
- Commit 6d83174 (Task 2): verified in git log
- TypeScript clean: confirmed
- All 6 tests passing: confirmed
