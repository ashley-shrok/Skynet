---
phase: 126-audio-cue-when-wip-indicator-clears
plan: 01
type: execute-summary
wave: 1
completed: 2026-09-21
duration: ~35 min (interactive execution)
autonomous: true
subsystem: ui/audio
tags: [audio, web-audio-api, ios-unlock, autoplay-policy, leaf-primitive]
requirements_completed: [D-13, D-14, D-15, D-18, D-19, D-20, D-21, D-27]

commits:
  - hash: e72a6c8e
    kind: feat
    subject: "add subtle tink.mp3 audio asset for readiness cue"
    files: [src/ui/assets/sounds/ready-cue/tink.mp3]
  - hash: 33e710b8
    kind: feat
    subject: "add ready-cue audio subsystem module"
    files: [src/ui/audio/ready-cue.ts, src/ui/vite-assets.d.ts]
  - hash: cf1bc740
    kind: test
    subject: "add colocated vitest coverage for ready-cue module"
    files: [src/ui/audio/ready-cue.test.ts]

dependency_graph:
  requires: []
  provides:
    - "@/audio/ready-cue → playTink(), initReadyCueAudioUnlock(), isReadyCueUnlocked()"
    - "Bundled tink.mp3 asset at src/ui/assets/sounds/ready-cue/tink.mp3"
    - "*.mp3?url ambient type declarations (src/ui/vite-assets.d.ts)"
  affects: []

tech_stack:
  added: []  # No new npm dependencies — Web Audio API is a browser built-in.
  patterns:
    - "Vite `?url` static-asset import (mirrors useVoiceRecording.ts)"
    - "Module-level state + __resetForTest reset shape (mirrors session-working-store.ts)"
    - "Four-event {once, capture, passive} unlock listener strategy"

key_files:
  created:
    - src/ui/assets/sounds/ready-cue/tink.mp3
    - src/ui/audio/ready-cue.ts
    - src/ui/audio/ready-cue.test.ts
    - src/ui/vite-assets.d.ts
  modified: []

metrics:
  duration_minutes: 35
  tasks_completed: 3
  files_created: 4
  files_modified: 0
  tests_added: 6
  tests_passing: 6

decisions:
  - "Adopted the ffmpeg sine-burst approach (Task 1 option a) for the tink asset — 80ms 1200Hz sine with 5ms attack + 60ms decay envelope at 0.35 volume. Landed at 1925 bytes, 0.130612s duration. Subtle at repeat exposure; did NOT need to fall back to the two-tone bell (option b)."
  - "Added a *.mp3?url / *.wav?url / *.ogg?url ambient type declaration at src/ui/vite-assets.d.ts. tsconfig.app.json only includes src/main.tsx, src/ui/**, src/types/** — it does NOT pick up the root src/vite-env.d.ts, so the vite/client reference never covered `?url` for the app project. This was a pre-existing gap: useVoiceRecording.ts's four mic-sound imports carried the same typecheck error for months. Adding the shim resolved MY new import AND the four pre-existing ones (net: 5 fewer TS errors). Documented in that file's header comment as a Rule 2 auto-fix."
---

# Phase 126 Plan 01: Ready-Cue Audio Subsystem Summary

Shipped the leaf-level audio primitive (`src/ui/audio/ready-cue.ts`) that owns the shared `AudioContext`, decoded tink `AudioBuffer`, the module-level `unlocked` flag, the first-gesture unlock listener install, and the `playTink()` function — with zero knowledge of rows, WIP, latch state, or pane visibility, per D-21 separation-of-concerns lock. Plan 02 (Wave 2) will import `playTink()` as a real function rather than a stub.

## What Landed

### `src/ui/audio/ready-cue.ts` (~200 lines, 4 exports)

- `playTink(): void` — silent no-op before unlock (D-19); post-unlock creates a **fresh `AudioBufferSourceNode` per fire** (D-21), sets `.buffer`, connects to `audioCtx.destination`, calls `.start(0)`. Buffer decode is lazy on first post-unlock call and cached module-level for subsequent fires. Concurrent playTink() during in-flight decode share the same `decodePending` Promise (no per-fire re-decode, D-14).
- `initReadyCueAudioUnlock(): void` — idempotent. Lazy-creates the shared `AudioContext` from `window.AudioContext ?? webkitAudioContext`. Installs one `document.addEventListener` per event type in `{pointerdown, click, touchend, keydown}` with `{once: true, capture: true, passive: true}`. Each handler calls a shared `doUnlock()` that flips `unlocked = true` and `audioCtx.resume().catch(() => {})`. Second-and-subsequent calls short-circuit on the `initialized` or `unlocked` guards.
- `isReadyCueUnlocked(): boolean` — getter for the unlock flag. Plan 02 doesn't need it; the test suite does.
- `__resetForTest(): void` — nukes ALL module-level state (unlocked, initialized, audioCtx, tinkBuffer, decodePending) AND removes any resident listeners the prior init() installed on `document`. Mirrors `src/ui/state/session-working-store.ts:1151` shape.

### `src/ui/audio/ready-cue.test.ts` (6 tests, all passing)

- **A** — pre-unlock silent no-op (D-19, D-27 half 1): `playTink()` with no init and no gesture does not throw; unlocked stays false; no `AudioContext` is constructed.
- **B** — init installs listeners at document scope (D-18): 4 gesture types × 1 listener each, all with `{once, capture, passive} = true`.
- **C** — first gesture flips unlocked=true and calls `audioCtx.resume()` exactly once (D-18).
- **D** — post-unlock playback (D-27 half 2, D-21): `playTink()` after unlock creates a fresh `AudioBufferSourceNode`, wires `.buffer` to the decoded tinkBuffer, connects to `audioCtx.destination`, calls `.start(0)`.
- **E** — init-twice is a no-op (idempotent): 4 listener installs total across 2 init calls, not 8.
- **F** — init-after-unlock is a no-op: 0 new listeners on the second init after a gesture unlocked the context; same AudioContext instance; unlock state preserved.

### `src/ui/assets/sounds/ready-cue/tink.mp3`

Concrete asset properties (as generated by ffmpeg):

| Property     | Value       |
| ------------ | ----------- |
| Codec        | MP3         |
| Bitrate      | 96 kbps     |
| Sample rate  | 44100 Hz    |
| Channels     | 1 (mono)    |
| Frequency    | 1200 Hz     |
| Duration     | 0.130612 s  |
| File size    | 1925 bytes  |
| Attack       | 5 ms fade-in |
| Decay        | 60 ms fade-out (starting at 20ms) |
| Peak volume  | 0.35 (subtle) |
| Git storage  | Plain binary (NOT LFS) |

Generated via: `ffmpeg -f lavfi -i "sine=frequency=1200:duration=0.08" -af "afade=t=in:d=0.005,afade=t=out:st=0.02:d=0.06,volume=0.35" -b:a 96k …`. The 8-fold size margin under the plan's 20 KB budget leaves ample room if the sample is ever swapped for a richer two-tone bell or a longer decay.

### `src/ui/vite-assets.d.ts` (ambient shim — Rule 2 auto-fix)

Added `declare module "*.mp3?url" { … }` (plus `.wav?url` and `.ogg?url` for future-proofing). Header comment documents the origin: `src/vite-env.d.ts` references `vite/client` (which supplies `*?url` globally), but `tsconfig.app.json` only includes `src/main.tsx`, `src/ui/**`, and `src/types/**` — so the root vite-env.d.ts is invisible to the app project's typecheck. This is a pre-existing gap: `useVoiceRecording.ts:51-54` carried four identical `?url` typecheck errors for months. Adding the ambient shim inside `src/ui/` resolved my new import AND the four pre-existing ones — net **5 fewer TS errors** (baseline 368 → post-shim 364).

## Verification Results

### 1. Typecheck (`npx tsc --noEmit -p tsconfig.app.json`)

- Errors in `src/ui/audio/*`: **0**
- Total errors: 364 (all pre-existing, unrelated to Phase 126 — `conversation-store.test.ts`, `identities-store.ts`, `search-store.test.ts`, `ElectronVersionCheck.tsx`)
- Baseline before this plan: 368
- Net delta: **−4 errors** (via the ambient shim)

### 2. Scoped vitest (`npx vitest run src/ui/audio/ready-cue.test.ts`)

```
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    3.05s
```

### 3. Related-tests sweep (`npx vitest related --run src/ui/audio/ready-cue.ts src/ui/audio/ready-cue.test.ts`)

```
Test Files  1 passed (1)
Tests       6 passed (6)
```

No cross-module impact — nothing else in the codebase depends on `@/audio/ready-cue` yet (Plan 02 will).

### 4. Asset validation

```
file:      Audio file with ID3 version 2.4.0, contains: MPEG ADTS, layer III, v1, 96 kbps, 44.1 kHz, Monaural
stat -c %s: 1925                       (well under the 20480 budget)
ffprobe duration: 0.130612             (within the 0.03–0.20 range)
git check-attr filter: unspecified     (NOT LFS)
```

### 5. Grep discipline (Task 2 acceptance criteria)

All 12 grep assertions passed exactly as specified in the plan — see task-level acceptance criteria in `126-01-PLAN.md` for the full list.

## Deviations from the Plan

### Rule 2 auto-fix: added `src/ui/vite-assets.d.ts`

The plan's Task 2 `<action>` explicitly anticipated this case: *"TypeScript needs a `.d.ts` shim; check whether `src/ui/vite-env.d.ts` or similar already declares `"*.mp3?url"` — if it does, great; if not, add a one-line ambient module declaration at the top of `ready-cue.ts` OR extend the existing declarations file"*. Chose to extend the declarations file (as its own new file at `src/ui/vite-assets.d.ts`) rather than inline it in `ready-cue.ts`, because doing so also fixed 4 pre-existing `?url` errors in `useVoiceRecording.ts`. Net delta: **−4 baseline errors**, zero regressions.

Not a plan-violating deviation — the plan explicitly permitted this path. Called out here for provenance.

### No other deviations

The three tasks executed exactly as written. The ffmpeg command from Task 1 option (a) produced a pleasant subtle tink on the first attempt; no iteration was needed on frequency, duration, volume, or envelope. Two-tone bell (option b) not needed.

## Confirmations for Downstream Consumers

**Plan 02 (Wave 2) will import** `playTink`, `initReadyCueAudioUnlock`, `isReadyCueUnlocked` from `@/audio/ready-cue`. Signature stability confirmed:

```typescript
export function playTink(): void
export function initReadyCueAudioUnlock(): void
export function isReadyCueUnlocked(): boolean
```

No arguments, no return values that require handling (playTink is fire-and-forget), no thrown exceptions. Plan 02's tests may safely `vi.mock("@/audio/ready-cue")` with any subset of these functions replaced by `vi.fn()` stubs.

**Vite `?url` import path** — the exact string is `"../assets/sounds/ready-cue/tink.mp3?url"` (relative to `src/ui/audio/ready-cue.ts`). Vite's asset pipeline resolves this at build time; the module load path was validated indirectly by vitest, which uses Vite's resolver (all 6 tests passing = module + asset load path clean).

## Open Items

None. Zero consumers wired (by design — Plan 02 owns wiring). Zero stubs. Zero placeholders. The tink asset is a real playable MP3 (not a silence placeholder). Ashley can swap in a different sample later without touching any code — the file at `src/ui/assets/sounds/ready-cue/tink.mp3` is the only change needed for an asset revision.

## Success-Criteria Checklist (from PLAN.md)

- [x] `src/ui/audio/ready-cue.ts` exists with exactly four exports: `playTink`, `initReadyCueAudioUnlock`, `isReadyCueUnlocked`, `__resetForTest`.
- [x] `src/ui/audio/ready-cue.test.ts` exists with six passing tests covering the D-18 / D-19 / D-20 / D-21 / D-27 behaviors A–F.
- [x] `src/ui/assets/sounds/ready-cue/tink.mp3` exists, is a valid MP3, is ≤ 20 KB (1925 bytes), has duration between 0.03 and 0.20 s (0.130612 s), is committed as a plain binary (not LFS).
- [x] The module imports NOTHING from `src/ui/state/`, `src/ui/features/`, `src/ui/shell/`, or React. Its only imports are the tinkUrl asset.
- [x] `npx tsc --noEmit -p tsconfig.app.json` reports zero errors in `src/ui/audio/*` (364 pre-existing errors remain in unrelated files, none introduced by this plan; net delta −4 vs. baseline).
- [x] `npx vitest run src/ui/audio/ready-cue.test.ts` is green (6/6).
- [x] All acceptance criteria in tasks 1–3 pass verbatim.
- [x] Zero consumers wired — Plan 02 owns wiring.

## Self-Check: PASSED

- `src/ui/audio/ready-cue.ts`: FOUND
- `src/ui/audio/ready-cue.test.ts`: FOUND
- `src/ui/assets/sounds/ready-cue/tink.mp3`: FOUND
- `src/ui/vite-assets.d.ts`: FOUND
- Commit `e72a6c8e`: FOUND
- Commit `33e710b8`: FOUND
- Commit `cf1bc740`: FOUND
