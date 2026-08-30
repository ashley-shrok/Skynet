---
phase: 260731-khv
plan: 01
type: quick
tags: [voice, tts, chatterbox, speak-button, identity-modal, patch-223]
tech-stack:
  added: []
  patterns: [STT-proxy-pattern, AbortController-30s, Promise.resolve-play-pattern, module-level-single-active-playback]
key-files:
  created:
    - src/ui/api/voice-api.ts
    - src/ui/features/pretty-view/ChatMessage.speak.test.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
  modified:
    - src/backend/database/routes/voice.ts
    - src/backend/database/routes/voice.test.ts
    - src/backend/database/routes/identities.ts
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/ui/api/identities-api.ts
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
decisions:
  - Promise.resolve(audio.play()).catch(() => {}) pattern enforced (patch #211 lesson)
  - Module-level refs (not React state) for single-active-playback global invariant
  - Voice column added in three places: drizzle schema + CREATE TABLE + migrateSchema
metrics:
  duration: "~15 minutes"
  completed: "2026-07-31"
  tasks: 3
  files: 11
---

# Phase 260731-khv Plan 01: Patch #223 Speak Messages — Click-to-Speak Summary

One-liner: Per-bubble click-to-speak on assistant messages via Chatterbox TTS reverse-proxy, plus per-identity voice picker + sample button in IdentityModal.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Backend POST /voice/speak + GET /voice/voices + identities voice column | 166ab56 | voice.ts, voice.test.ts, identities.ts, schema.ts, index.ts |
| 2 | Frontend voice-api + ChatMessage speak button on assistant bubbles | 9e0166c | voice-api.ts, ChatMessage.tsx, ChatMessage.speak.test.tsx, PrettyView.tsx, identities-api.ts |
| 3 | IdentityModal voice picker + sample button | 9564f98 | IdentityModal.tsx, IdentityModal.voice.test.tsx, IdentityModal.test.tsx |

## What Was Built

### Backend (Task 1)
- `handleSpeak` (POST /voice/speak): validates text (1..25000 chars) + voice (regex), proxies to Chatterbox TTS at `100.80.122.111:8001/v1/audio/speech`, streams audio/wav bytes back. Fixed-shape error responses (no upstream body leak, T-16-03 analog). 30s AbortController timeout.
- `handleListVoices` (GET /voice/voices): fetches predefined voices from Chatterbox, forwards verbatim.
- `DEFAULT_VOICE = "Elena.wav"`, `SPEAK_TEXT_MAX = 25000`, `SAMPLE_PHRASE = "Hi, this is your voice."`, `VOICE_FILENAME_RE = /^[A-Z][A-Za-z]+\.wav$/` constants added.
- `identities.voice TEXT` column: added to drizzle schema, CREATE TABLE block, and `migrateSchema()` addColumnIfNotExists — all three required locations.
- `identities.ts`: `IdentityMetadata.voice`, POST insert, PUT conditional-block (mirrors colorHue pattern with regex validation), `publicIdentity()` output all updated.
- 11 new tests (A-K) covering handleSpeak + handleListVoices behaviors.

### Frontend (Task 2)
- `voice-api.ts`: `postSpeak(text, voice?)` → Blob, `getVoices()` → list, `SAMPLE_PHRASE` constant (single source of truth).
- `identities-api.ts`: `Identity.voice: string | null` + `IdentityInput.voice?: string | null`.
- `ChatMessage.tsx`: `identityVoice` prop + module-level `currentAudio/currentAudioUrl/currentAudioOwner` refs for page-global single-active-playback. SpeakButton (Volume2/Loader2) renders only on assistant bubbles (never user). Loading state (Loader2 spinner while postSpeak in flight) + playing state. `Promise.resolve(audio.play()).catch(() => {})` strictly followed.
- `PrettyView.tsx`: `identityVoice={pvIdentity?.voice ?? null}` threaded to ChatMessage.
- 6 tests in ChatMessage.speak.test.tsx.

### Frontend (Task 3)
- `IdentityModal.tsx`: Voice row (select + 32px sample button) inserted in Identity tab between Title and inline error. `getVoices()` fetched on modal open. State: `voices`, `voiceDraft`, `committedVoice`. `onSampleClick` plays `SAMPLE_PHRASE` with selected voice (omit when "(default)"). `onSave` includes `voice` in meta diff; `onCancel` reverts `voiceDraft`. Save disabled predicate accounts for voice changes.
- 8 tests in IdentityModal.voice.test.tsx (6 required + 2 bonus edge-cases).

## Test Results

- Task 1: 18 tests passed (handleTranscribe + handleSpeak + handleListVoices)
- Task 2: 6 tests passed (ChatMessage.speak.test.tsx)
- Task 3: 8 tests passed (IdentityModal.voice.test.tsx)
- Full suite: 82 test files, 943 tests passed, 6 skipped — 0 failed

## Build Verification

Both `npm run build:backend` and `npm run build` passed after each task. Frontend-only tsc --noEmit skipped per patch #154 lesson (backend build catches backend TS errors).

## Cross-Task Verification

- Anti-pattern grep (`audio.play().catch`): 0 matches (correct — only comments)
- Correct pattern grep (`Promise.resolve(audio.play()).catch`): 2 matches (one per file)
- Voice column in all three DB locations: confirmed
- Three routes mounted in voice.ts: /transcribe + /speak + /voices
- Git log: 3 atomic commits in correct order

## Git

Branch: feat/tab-title-from-tmux
Previous tip: a3e571b (patch #222)
New tip: 9564f98
Push: succeeded to origin

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- `src/ui/api/voice-api.ts`: exists
- `src/ui/features/pretty-view/ChatMessage.speak.test.tsx`: exists
- `src/ui/features/pretty-view/IdentityModal.voice.test.tsx`: exists
- Commits 166ab56, 9e0166c, 9564f98: confirmed in git log

## Self-Check: PASSED
