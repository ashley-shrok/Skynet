/**
 * App-wide "voice mode is on somewhere" flag (2026-10-10).
 *
 * Only one voice mode runs at a time, and while it is on every mic and every
 * other voice-mode button in every pane is disabled — two listeners on one
 * microphone would transcribe and send the same words twice. Each useVoiceMode
 * instance registers a token while its phase is not "off"; ComposeBox reads
 * the count through useVoiceModeActiveAnywhere().
 *
 * Module scope (same window only), same pattern as speak-singleton.ts.
 * Panes opened with "Open in new window" are separate documents and are not
 * covered.
 */
import { useSyncExternalStore } from "react";

const active = new Set<symbol>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Mark one voice-mode instance as on. Returns the matching release. */
export function registerVoiceModeActive(token: symbol): () => void {
  active.add(token);
  emit();
  return () => {
    if (active.delete(token)) emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return active.size > 0;
}

/** True while any pane in this window has voice mode on. */
export function useVoiceModeActiveAnywhere(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only: clear leaked registrations between tests. */
export function __resetVoiceModeRegistryForTests(): void {
  active.clear();
  emit();
}
