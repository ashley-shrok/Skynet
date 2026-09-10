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
 */
import type { WebAudioStreamPlayer } from "./webAudioStreamPlayer";

let currentPlayer: WebAudioStreamPlayer | null = null;
let currentOwner: symbol | null = null;

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
  currentOwner = o;
}

/** Convenience: set both to null in one call (matches the paired-clear
 * pattern used at every ownership-release site in ChatMessage/RelayInboundBubble). */
export function clearCurrentPlayer(): void {
  currentPlayer = null;
  currentOwner = null;
}
