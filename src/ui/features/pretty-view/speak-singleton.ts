/**
 * Shared speak singleton — module-scope pair for the app-wide "one bubble
 * speaks at a time" invariant.
 *
 * Extracted from ChatMessage.tsx (Phase 97 UAT batch #6, 2026-09-10) so
 * BOTH ChatMessage and RelayInboundBubble can consume the same singleton.
 * Tapping speak on a ChatMessage stops speak on a RelayInboundBubble and
 * vice versa — one owner at a time, cross-bubble preempt intact.
 *
 * Cross-bubble Stop / new-bubble-preempt semantics preserved:
 *   - Starting on bubble A while bubble B plays stops B first.
 *   - Clicking Stop on the playing bubble stops it.
 *   - Unmount cleanup stops if this bubble owns the singleton.
 *
 * Deliberately a mutable module-scope pair (not React context / not a hook
 * wrapper / not an event bus) — that is the pattern the existing
 * cross-bubble preempt relies on and every test in
 * ChatMessage.speak.test.tsx pins.
 *
 * Speak buttons (useSpeakPlayback) also publish their state here, and
 * listeners hear every change of owner or button state. Voice mode watches
 * it so a speak button talking counts as "speaking" (no listening), and a
 * preempted button watches it to fall back to idle.
 */
import type { WebAudioStreamPlayer } from "./webAudioStreamPlayer";

let currentPlayer: WebAudioStreamPlayer | null = null;
let currentOwner: symbol | null = null;

export type ButtonSpeechState = "loading" | "playing" | "paused";
let buttonSpeech: { owner: symbol; state: ButtonSpeechState } | null = null;

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of [...listeners]) l();
}

/** Hear every change of owner or speak-button state. Returns the unsubscribe. */
export function subscribeSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A speak button reports its state while it holds (or is taking) ownership. */
export function setButtonSpeechState(owner: symbol, state: ButtonSpeechState): void {
  if (buttonSpeech?.owner === owner && buttonSpeech.state === state) return;
  buttonSpeech = { owner, state };
  emit();
}

/**
 * A speak button takes playback over in ONE step: the previous player (already
 * stopped by the caller) is dropped and this button owns it, "loading", with a
 * single notification. Separate clear + set calls would show listeners a
 * moment of "nothing speaking" between two bubbles.
 */
export function takeOverForButton(owner: symbol): void {
  currentPlayer = null;
  currentOwner = owner;
  buttonSpeech = { owner, state: "loading" };
  emit();
}

/** State of the speak button that currently owns playback; null when none does. */
export function getButtonSpeechState(): ButtonSpeechState | null {
  return buttonSpeech !== null && buttonSpeech.owner === currentOwner ? buttonSpeech.state : null;
}

export function getCurrentPlayer(): WebAudioStreamPlayer | null {
  return currentPlayer;
}

export function setCurrentPlayer(p: WebAudioStreamPlayer | null): void {
  currentPlayer = p;
}

export function getCurrentOwner(): symbol | null {
  return currentOwner;
}

export function setCurrentOwner(o: symbol | null): void {
  if (currentOwner === o) return;
  currentOwner = o;
  if (buttonSpeech !== null && buttonSpeech.owner !== o) buttonSpeech = null;
  emit();
}

/** Convenience: set both to null in one call (matches the paired-clear
 * pattern used at every ownership-release site in ChatMessage/RelayInboundBubble). */
export function clearCurrentPlayer(): void {
  const changed = currentOwner !== null || buttonSpeech !== null;
  currentPlayer = null;
  currentOwner = null;
  buttonSpeech = null;
  if (changed) emit();
}
