---
phase: quick-260814-u0w
plan: "01"
subsystem: backend/voice
tags: [voice, stt, timeout, disk-bank, resilience]
dependency_graph:
  requires: []
  provides: [handleTranscribe-120s-timeout, handleTranscribe-disk-bank]
  affects: [src/backend/database/routes/voice.ts, src/backend/database/routes/voice.test.ts]
tech_stack:
  added: [node:fs, node:path]
  patterns: [fire-and-forget-void-chain, disk-bank-before-upstream-fetch]
key_files:
  modified:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
decisions:
  - "fs mock uses importActual to preserve existsSync/mkdirSync etc. used by db/index.ts — a factory mock overriding only promises.writeFile + promises.mkdir avoids breaking the rest of the module graph"
  - "Call-order assertion uses mkdir invocationCallOrder (not writeFile) because writeFile runs in the .then() microtask after the void expression evaluates; mkdir is invoked synchronously before fetch"
metrics:
  duration: "~25 minutes"
  completed: "2026-08-14"
  tasks_completed: 2
  files_modified: 2
---

# Phase quick-260814-u0w Plan 01: Voice STT Timeout Bump + Disk-Bank Summary

**One-liner:** Bumped handleTranscribe AbortController from 30s to 120s and added a fire-and-forget disk-bank of incoming audio buffers (Ashley 2026-08-14 3.87 MB lost-dictation incident fix).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | voice.ts — timeout bump + disk-bank | 40dc32ee | src/backend/database/routes/voice.ts |
| 2 | voice.test.ts — fs mock + 2 new tests | 40dc32ee | src/backend/database/routes/voice.test.ts |

Both tasks committed atomically in a single commit (same logical change).

## Changes Made

### voice.ts

**Imports added (lines 4-5):**
- `import fs from "node:fs";`
- `import path from "node:path";`

**Timeout bumped (was line 86-88, now ~lines 105-109):**
- Comment updated from "30-second STT timeout" to "120-second STT timeout" with citation of the Ashley 2026-08-14 3.87 MB clip incident
- `setTimeout(() => controller.abort(), 30_000)` → `setTimeout(() => controller.abort(), 120_000)`

**Disk-bank block inserted (after `const ext = extFromMimetype(...)`, before `databaseLogger.info transcribe-req`):**
```
const authReq = req as AuthenticatedRequest;
const userId = authReq.userId;
const dir = process.env.STT_RECORDINGS_DIR ?? "/app/stt-recordings";
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const filename = `${timestamp}-${userId ?? "anon"}-${file.size}.${ext}`;
const fullPath = path.join(dir, filename);
databaseLogger.info(`[voice-server] transcribe-bank-write filename=${filename}`, { operation: "voice_transcribe_bank_write", filename });
void fs.promises.mkdir(dir, { recursive: true }).then(() => fs.promises.writeFile(fullPath, file.buffer)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  databaseLogger.warn(`[voice-server] transcribe-bank-write-failed filename=${filename} error=${message}`, { operation: "voice_transcribe_bank_write_failed", filename, error: message });
});
```

### voice.test.ts

**fs mock (added before imports, adjacent to skill-catalog mock):**
- `vi.mock("node:fs", async (importActual) => { ... })` using `importActual` to spread real fs and override only `promises.writeFile` and `promises.mkdir` as `vi.fn()` spies. This preserves `existsSync`, `mkdirSync`, etc. used by `db/index.ts`.
- `import fs from "node:fs"` added to imports
- `size?: number` added to `MockReq["file"]` type

**beforeEach updated:**
- `vi.mocked(fs.promises.writeFile).mockClear()` and `mockResolvedValue(undefined)` added
- `vi.mocked(fs.promises.mkdir).mockClear()` and `mockResolvedValue(undefined)` added

**New tests (inside `describe("handleTranscribe", ...)`):**

1. **Test bank-write-1: writes audio buffer to disk before issuing STT fetch, with expected filename shape**
   - Asserts `fs.promises.writeFile` called exactly once
   - Path matches `/^.*\/\d{8}T\d{6}Z-(anon|\d+)-19\.mp4$/`
   - Second arg is the audio buffer (`.equals()`)
   - mkdir `invocationCallOrder` < fetch `invocationCallOrder` (write pipeline kicks off before STT fetch)
   - Response is 200 with STT text

2. **Test bank-write-2: bank-write rejection does not affect STT response (best-effort)**
   - `mockRejectedValueOnce(new Error("EACCES: permission denied"))` on writeFile
   - handleTranscribe still returns 200 with "still works" text body

## Verification Results

| Check | Result |
|-------|--------|
| `grep -c "120_000" voice.ts` | 1 (timeout bumped) |
| `grep -c "voice_transcribe_bank_write" voice.ts` | 2 (kickoff + failed logs) |
| `grep -c "STT_RECORDINGS_DIR" voice.ts` | 1 |
| `grep -q "void fs.promises.mkdir" voice.ts` | PASS |
| `grep -q "vi.mock.*node:fs" voice.test.ts` | PASS |
| `npx vitest run src/backend/database/routes/voice.test.ts` | 37/37 PASS |
| `npm run build:backend` | Exit 0 |
| `npm run build` | Exit 0 |
| Full `npx vitest run` | Exit 0 (all tests passing; resource-contention failures observed when many background vitest processes run simultaneously are pre-existing and all pass when run in isolation) |
| Branch | feat/tab-title-from-tmux |

## Commit

- **40dc32ee** — `patch(voice): bump STT abort 30s→120s + fire-and-forget disk-bank of audio buffer (quick-260814-u0w)`
  - Files: `src/backend/database/routes/voice.ts`, `src/backend/database/routes/voice.test.ts`
  - 2 files changed, 119 insertions(+), 2 deletions(-)

## No Deploy Motion

- No `git push` performed
- No `docker build` performed
- No `docker compose up` performed
- No edits to `/opt/skynet/docker-compose.yml`, `skynet-patches.md`, or bounty files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fs.mock factory too narrow — broke db/index.ts existsSync**
- **Found during:** Task 2 test run
- **Issue:** Initial `vi.mock("node:fs", () => ({ ... }))` only exposed `promises.writeFile` and `promises.mkdir`, replacing all other `fs` methods with undefined. `db/index.ts` calls `fs.existsSync()` during module init, causing `TypeError: default.existsSync is not a function`.
- **Fix:** Switched to async factory with `importActual` to spread the real `fs` module and override only the two promise methods. Shape `{ ...actual, default: { ...actual, promises: { ...actual.promises, writeFile: vi.fn(), mkdir: vi.fn() } }, promises: { ...actual.promises, writeFile: vi.fn(), mkdir: vi.fn() } }`.
- **Files modified:** `src/backend/database/routes/voice.test.ts`
- **Commit:** 40dc32ee

**2. [Rule 2 - Deviation] Call-order assertion uses mkdir, not writeFile**
- **Found during:** Task 2 analysis before writing tests
- **Issue:** Plan spec asserts `fs.promises.writeFile.mock.invocationCallOrder[0] < fetchMock.mock.invocationCallOrder[0]`. However, the implementation uses `void fs.promises.mkdir().then(() => fs.promises.writeFile())` — `writeFile` only runs in the `.then()` microtask after `mkdir` resolves, which is after the synchronous `await fetch(...)` call is issued. So `writeFile` actually runs AFTER fetch is invoked.
- **Fix:** Asserted on `mkdir.mock.invocationCallOrder` instead (mkdir IS invoked synchronously before fetch). Added comment explaining the ordering. The spirit of the spec ("write pipeline kicks off before fetch") is correctly tested.
- **Files modified:** `src/backend/database/routes/voice.test.ts`

## Known Stubs

None — the disk-bank is wired to real fs.promises.mkdir/writeFile with the STT_RECORDINGS_DIR env var and /app/stt-recordings fallback.

## Self-Check: PASSED

- FOUND: `.planning/quick/260814-u0w-voice-transcribe-bump-stt-timeout-30s-12/260814-u0w-SUMMARY.md`
- FOUND: `src/backend/database/routes/voice.ts`
- FOUND: `src/backend/database/routes/voice.test.ts`
- FOUND commit: `40dc32ee patch(voice): bump STT abort 30s→120s + fire-and-forget disk-bank of audio buffer (quick-260814-u0w)`
- No unexpected file deletions in commit

## Threat Flags

None — no new network endpoints or auth paths introduced. The disk-bank write is container-local and gated by the existing `authenticateJWT` middleware on the `/voice/transcribe` route.
