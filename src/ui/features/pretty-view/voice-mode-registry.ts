/**
 * App-wide mic-ownership flags (2026-10-10).
 *
 * Only one listener on the microphone at a time — two would transcribe and
 * send the same words twice (and on iOS a second getUserMedia can end the
 * first one's track). Two flags:
 *
 *   - voice mode on: while any pane's useVoiceMode phase is not "off", every
 *     mic and every other pane's voice-mode button is disabled.
 *   - manual recording: while any pane's tap/hold mic is recording or
 *     transcribing, every pane's voice-mode button is disabled.
 *
 * Module scope (same window only), same pattern as speak-singleton.ts.
 * Panes opened with "Open in new window" are separate documents and are not
 * covered.
 */
import { useSyncExternalStore } from "react";

function createFlag() {
  const active = new Set<symbol>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => active.size > 0;
  return {
    /** Mark one owner as active. Returns the matching release. */
    register(token: symbol): () => void {
      active.add(token);
      emit();
      return () => {
        if (active.delete(token)) emit();
      };
    },
    useAnywhere(): boolean {
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    },
    reset(): void {
      active.clear();
      emit();
    },
  };
}

const voiceModeFlag = createFlag();
const manualRecordingFlag = createFlag();

export const registerVoiceModeActive = voiceModeFlag.register;
export const registerManualRecording = manualRecordingFlag.register;

/** True while any pane in this window has voice mode on. */
export function useVoiceModeActiveAnywhere(): boolean {
  return voiceModeFlag.useAnywhere();
}

/** True while any pane in this window has its manual mic recording/transcribing. */
export function useManualRecordingAnywhere(): boolean {
  return manualRecordingFlag.useAnywhere();
}

/** Test-only: clear leaked registrations between tests. */
export function __resetVoiceModeRegistryForTests(): void {
  voiceModeFlag.reset();
  manualRecordingFlag.reset();
}
