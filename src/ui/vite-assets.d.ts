// Ambient module declarations for Vite `?url` and `?raw` static-asset imports
// that the app tree uses. The root src/vite-env.d.ts already references
// `vite/client`, which supplies these declarations globally — but tsconfig.app.json
// only includes `src/main.tsx`, `src/ui/**`, and `src/types/**`, so the root
// declarations are not visible to the app project's typecheck. This file lives
// under `src/ui/` so the app tsconfig picks it up.
//
// Origin: Phase 126 Plan 01 (rain 2026-09-21). The mic-sound imports in
// useVoiceRecording.ts have carried this pre-existing gap for months; adding
// the readiness-chime asset was the forcing function to formalize the shim.

declare module "*.mp3?url" {
  const src: string;
  export default src;
}

declare module "*.wav?url" {
  const src: string;
  export default src;
}

declare module "*.ogg?url" {
  const src: string;
  export default src;
}
