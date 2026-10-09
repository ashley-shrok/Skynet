/**
 * auto-speak-cue — on/off chimes for the pane-scoped autoplay toggle.
 *
 * Fires when the user holds an assistant bubble's speak button long enough to
 * arm (playAutoSpeakOn) or disarm (playAutoSpeakOff) auto-speak mode. Both
 * fires happen inside a user gesture (the long-press timer), so no autoplay
 * unlock ceremony is needed — the simple `new Audio(url)` pattern used by
 * useVoiceRecording.ts:170-173 is sufficient.
 *
 * Sound sources: Google Material Design Sound Resources (CC-BY-SA 4.0).
 * See src/ui/assets/sounds/auto-speak/CREDITS.md for attribution.
 */

import onUrl from "../assets/sounds/auto-speak/on.mp3?url";
import offUrl from "../assets/sounds/auto-speak/off.mp3?url";

let onAudio: HTMLAudioElement | null = null;
let offAudio: HTMLAudioElement | null = null;

function play(audio: HTMLAudioElement): void {
  audio.currentTime = 0;
  // Promise.resolve wrap: real browsers return a Promise from play(); jsdom
  // returns undefined, so a bare .catch() throws in tests. Mirrors the pattern
  // at src/ui/features/pretty-view/useVoiceRecording.ts:191.
  Promise.resolve(audio.play()).catch(() => {});
}

export function playAutoSpeakOn(): void {
  if (!onAudio) onAudio = new Audio(onUrl);
  play(onAudio);
}

export function playAutoSpeakOff(): void {
  if (!offAudio) offAudio = new Audio(offUrl);
  play(offAudio);
}

/** Test helper — reset cached Audio instances. */
export function __resetForTest(): void {
  onAudio = null;
  offAudio = null;
}
