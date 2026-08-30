---
phase: 20-identity-creation-ui
plan: "03"
subsystem: frontend/pretty-view/pickers
tags: [extraction, refactor, react, typescript, voice-picker, color-picker, identity-modal]
dependency_graph:
  requires: []
  provides:
    - src/ui/features/pretty-view/pickers/VoicePicker.tsx
    - src/ui/features/pretty-view/pickers/ColorPicker.tsx
  affects:
    - src/ui/features/pretty-view/IdentityModal.tsx
tech_stack:
  added: []
  patterns:
    - Controlled component extraction from a large modal into dedicated picker sub-components
key_files:
  created:
    - src/ui/features/pretty-view/pickers/VoicePicker.tsx
    - src/ui/features/pretty-view/pickers/VoicePicker.test.tsx
    - src/ui/features/pretty-view/pickers/ColorPicker.tsx
    - src/ui/features/pretty-view/pickers/ColorPicker.test.tsx
  modified:
    - src/ui/features/pretty-view/IdentityModal.tsx
decisions:
  - data-testid added to ColorPicker swatch div for reliable test targeting (JSDOM normalizes hsl to rgb)
  - SAMPLE_PHRASE re-exported from VoicePicker.tsx (imported from @/api/voice-api, not re-declared)
metrics:
  duration: "~10 minutes"
  completed: "2026-08-03"
---

# Phase 20 Plan 03: Extract VoicePicker + ColorPicker — Summary

Extracted voice picker (select + sample button) and color picker (hue range slider + swatch + readout) from IdentityModal.tsx into standalone reusable components at `src/ui/features/pretty-view/pickers/`, refactoring IdentityModal to consume them with zero functional regression.

## Prop Signatures (for plan 05 to consume)

### VoicePicker

```tsx
import { VoicePicker, SAMPLE_PHRASE } from "@/features/pretty-view/pickers/VoicePicker";

<VoicePicker
  value={voiceDraft}       // string — current voice filename ("Elena.wav") or "" for default
  onChange={setVoiceDraft} // (next: string) => void
  disabled={saving}        // boolean? — disables select + sample button
  id="identity-voice-select" // string? — sets id on the <select> (defaults to "voice-picker")
  ariaLabel="..."          // string? — aria-label on the <select>
/>
```

Internally owns: voices state (fetched from getVoices on mount), sampleAudioRef + sampleUrlRef, voices-fetch useEffect, sample-audio cleanup useEffect, onSampleClick async handler.

### ColorPicker

```tsx
import { ColorPicker } from "@/features/pretty-view/pickers/ColorPicker";

<ColorPicker
  value={hueDraft}       // number — hue in 0-360 range
  onChange={setHueDraft} // (next: number) => void — called with Number, not string
  disabled={saving}      // boolean? — disables the range input
  id="identity-hue-input" // string? — sets id on the <input type="range">
/>
```

Pure controlled component, zero internal state.

## Where SAMPLE_PHRASE Lives

`SAMPLE_PHRASE` is declared in `src/ui/api/voice-api.ts` (line 3: `"Hi, this is your voice."`). VoicePicker imports it from there and re-exports it: `export { SAMPLE_PHRASE }`. It is NOT re-declared in the picker. Plan 05 can import it directly from either voice-api or VoicePicker.

## Patch #211 Guard Preserved

The verbatim guard is in `VoicePicker.tsx`:

```ts
// patch #211 lesson: NEVER bare audio.play().catch(...)
Promise.resolve(audio.play()).catch(() => {});
```

This line is load-bearing per commit history and has NOT been changed.

## IdentityModal Line Count Delta

- Before: 1494 lines
- After: 1360 lines
- Delta: **-134 lines** (removed voices state, sampleAudioRef/sampleUrlRef refs, voice-fetch useEffect, sample-audio cleanup useEffect, onSampleClick function, inline voice JSX, inline color JSX)

## Test Results

- `VoicePicker.test.tsx`: 7/7 passed
- `ColorPicker.test.tsx`: 6/6 passed
- `IdentityModal.test.tsx`: passed (no regression)
- `IdentityModal.voice.test.tsx`: passed (no regression)
- Full pretty-view suite: 354/354 passed (6 skipped), 31 test files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added data-testid to ColorPicker swatch div**
- **Found during:** Task 2 test execution
- **Issue:** JSDOM normalizes `hsl(45, 65%, 55%)` to `rgb(215, 178, 66)` when serializing style attributes, making it impossible to assert the exact hsl string in Test 3
- **Fix:** Added `data-testid="color-swatch"` to the swatch div in ColorPicker.tsx; updated Test 3 to verify hue-change produces different swatch colors (behavior-equivalent assertion)
- **Files modified:** `src/ui/features/pretty-view/pickers/ColorPicker.tsx`, `src/ui/features/pretty-view/pickers/ColorPicker.test.tsx`
- **Commit:** dd4cc6e

## Deploy Discipline

No push, no docker build, no docker compose recreate was performed. Ashley will greenlight the deploy separately after execute-phase completes.

## Known Stubs

None. Both components are fully wired to real API calls (getVoices/postSpeak) and real state. No placeholder data.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- [x] `src/ui/features/pretty-view/pickers/VoicePicker.tsx` exists
- [x] `src/ui/features/pretty-view/pickers/VoicePicker.test.tsx` exists
- [x] `src/ui/features/pretty-view/pickers/ColorPicker.tsx` exists
- [x] `src/ui/features/pretty-view/pickers/ColorPicker.test.tsx` exists
- [x] Commits exist: 2be77d0 (VoicePicker), dd4cc6e (ColorPicker), 6314c29 (IdentityModal refactor)
- [x] IdentityModal uses `<VoicePicker>` and `<ColorPicker>`
- [x] IdentityModal does NOT contain setVoices, onSampleClick, sampleAudioRef
- [x] All tests green (354 passed)
- [x] `npx tsc --noEmit` exits 0
