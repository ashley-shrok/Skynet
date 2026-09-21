/**
 * ready-cue — leaf-level audio primitive for the "agent is ready" chime.
 *
 * Origin: Phase 126 (audio-cue-when-wip-indicator-clears), Plan 01 (Wave 1).
 * Plan 02 (Wave 2) wires the latch state machine + WIP-transition detector +
 * pane-visibility gate that CALL `playTink()`. This module knows NOTHING about
 * rows, WIP, latch state, sessionKey, split-view, or pane visibility. Its API
 * surface is exactly {playTink, initReadyCueAudioUnlock, isReadyCueUnlocked,
 * __resetForTest} per CONTEXT.md D-21 separation of concerns.
 *
 * Locked decisions from 126-CONTEXT.md that this module implements:
 *
 *   D-13: One subtle "tink" sound (~50-150ms). The sample lives at
 *         src/ui/assets/sounds/ready-cue/tink.mp3 and is bundled via Vite's
 *         `?url` static-asset convention (mirrors useVoiceRecording.ts:51-54).
 *
 *   D-14: Fixed playback volume in code — no volume UI, no volume localStorage.
 *         No GainNode is installed here; the sample from Task 1 is recorded
 *         at a subtle amplitude (35% peak).
 *
 *   D-15: Sound ships in the bundle (no CDN fetch, no base64 inline).
 *
 *   D-17: NO preferences surface anywhere — no localStorage, no query params,
 *         no identity file, no settings modal. If future need arises to
 *         disable, it's a code change, not a runtime toggle.
 *
 *   D-18: iOS PWA / Safari autoplay unlock — on first init, install one-shot
 *         document-scope listeners for pointerdown | click | touchend | keydown
 *         with {capture:true, once:true, passive:true}. Whichever gesture
 *         lands first calls audioCtx.resume() and flips unlocked=true.
 *
 *   D-19: If AudioContext hasn't been unlocked when a fire would occur, the
 *         fire is silently dropped — no chime, no queued playback, no attempt
 *         to force a gesture. An unheard chime is the correct outcome on a
 *         fresh iOS PWA session before any tap has landed.
 *
 *   D-20: Desktop browsers may or may not require an unlock depending on
 *         autoplay policy — the same first-gesture unlock handler covers them
 *         uniformly. No browser-sniffing.
 *
 *   D-21: This module owns: (a) the single shared AudioContext, (b) the
 *         decoded tink AudioBuffer, (c) the module-level unlocked flag,
 *         (d) the one-shot unlock listener install, (e) the playTink() fn.
 *         playTink() creates a fresh AudioBufferSourceNode per fire.
 *
 * Four-event unlock strategy: install FOUR separate `document.addEventListener`
 * calls (one per event type) each with `{once:true, capture:true, passive:true}`.
 * Each handler calls a shared `doUnlock()` that short-circuits if already
 * unlocked. Whichever gesture lands first wins; the others fire their `once:true`
 * cleanup naturally on the next matching event or stay resident (but the guard
 * makes them no-op). The four `once:true` listeners are cheap; leaving them
 * resident is acceptable per D-18.
 *
 * Lazy-decode-on-first-fire strategy: the tink URL is imported at module load,
 * but the fetch + decodeAudioData work is deferred until the first post-unlock
 * playTink() call. The decoded AudioBuffer is cached in a module-level variable
 * for subsequent fires (no per-fire re-decode). Concurrent decode attempts are
 * de-duped via a shared `decodePending` Promise so a burst of playTink() during
 * the decode-in-flight window all await the same result.
 *
 * `__resetForTest` scope: nukes ALL module-level state — unlocked flag,
 * initialized flag, cached AudioContext, cached AudioBuffer, in-flight decode
 * Promise — AND removes any resident listeners the prior init() call installed
 * on `document`. Mirrors src/ui/state/session-working-store.ts:1151's shape.
 */

import tinkUrl from "../assets/sounds/ready-cue/tink.mp3?url";

// ─── Module state ────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let unlocked = false;
let initialized = false;
let tinkBuffer: AudioBuffer | null = null;
let decodePending: Promise<AudioBuffer> | null = null;

/**
 * Track installed unlock listeners so `__resetForTest` can `removeEventListener`
 * each one and leave `document` clean between tests. In production, `{once:true}`
 * auto-removes each listener after it fires; the tracking array is defensive.
 */
const unlockListeners: Array<{ type: string; handler: EventListener }> = [];

/** The four DOM events that count as a "user gesture" for AudioContext unlock. */
const UNLOCK_EVENT_TYPES = ["pointerdown", "click", "touchend", "keydown"] as const;

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Called from ANY of the four unlock-event listeners. Idempotent: after the
 * first successful unlock, subsequent invocations are a no-op (any remaining
 * resident listeners that fire due to browser event race short-circuit here).
 */
function doUnlock(): void {
  if (unlocked) return;
  unlocked = true;
  if (audioCtx !== null && audioCtx.state === "suspended") {
    // iOS Safari's resume() rejects when called outside a gesture, but this
    // handler IS inside a gesture, so resolution is expected. .catch swallows
    // any surprise rejection so nothing throws upward.
    audioCtx.resume().catch(() => {});
  }
  console.info("[ready-cue] audio unlocked via user gesture");
}

/**
 * Play the cached tink buffer as a fresh AudioBufferSourceNode.
 * Per D-21: a NEW node is created per fire — nodes are single-use in the
 * Web Audio API. The node self-terminates when the buffer ends and is GC'd
 * once its `ended` event fires (browsers handle this natively).
 * Fixed volume per D-14 — no GainNode.
 */
function playFromBuffer(): void {
  if (audioCtx === null || tinkBuffer === null) return;
  const src = audioCtx.createBufferSource();
  src.buffer = tinkBuffer;
  src.connect(audioCtx.destination);
  src.start(0);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Install the one-shot user-gesture listeners that unlock the AudioContext.
 * Idempotent — a second call while the first is still pending is a no-op; a
 * call AFTER unlock is already true is a no-op.
 *
 * Consumers (Plan 02 wires this) should call this once at app mount.
 */
export function initReadyCueAudioUnlock(): void {
  if (initialized) return;
  if (unlocked) return;

  // Lazy-create the shared AudioContext. In non-browser or unsupported
  // environments (e.g. an older browser without Web Audio), silently disable
  // the readiness chime — this is not an error condition worth throwing over.
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AC = win.AudioContext ?? win.webkitAudioContext;
  if (!AC) {
    console.warn(
      "[ready-cue] Web Audio API not available; readiness chime disabled",
    );
    return;
  }
  audioCtx = new AC();

  // Install one listener per event type. `{once:true}` gives us free cleanup
  // after the first fire; `{capture:true}` catches the gesture at the earliest
  // dispatch phase; `{passive:true}` signals no preventDefault() so the browser
  // can optimize scroll/gesture handling. Whichever gesture lands first wins.
  for (const type of UNLOCK_EVENT_TYPES) {
    const handler: EventListener = () => doUnlock();
    document.addEventListener(type, handler, {
      once: true,
      capture: true,
      passive: true,
    });
    unlockListeners.push({ type, handler });
  }

  initialized = true;
}

/**
 * Play the readiness tink cue.
 *
 * Pre-unlock (D-19): silent no-op. No throw, no queued playback, no attempt
 * to synthesize a gesture. An unheard chime before the user has interacted
 * with the app is the correct outcome — nothing to alert them about anyway.
 *
 * Post-unlock: creates a fresh `AudioBufferSourceNode` per fire, connects it
 * to the shared destination, and calls `.start(0)` (D-21). On the FIRST
 * post-unlock call, if the buffer hasn't been decoded yet, kick off a
 * fetch+decode; subsequent concurrent calls await the same in-flight promise.
 *
 * Fire-and-forget. Returns synchronously. Never throws.
 */
export function playTink(): void {
  if (!unlocked) return;
  if (audioCtx === null) return;

  if (tinkBuffer !== null) {
    playFromBuffer();
    return;
  }

  // Buffer not yet decoded. Kick off decode if not already in flight, then
  // schedule a play when it lands. Concurrent playTink() calls during the
  // decode-in-flight window all await the same Promise, so the buffer decodes
  // exactly once even under a burst.
  if (decodePending === null) {
    // Capture audioCtx locally so TS narrows away null inside the async chain
    // (audioCtx could theoretically be reset via __resetForTest mid-flight).
    const ctx = audioCtx;
    decodePending = fetch(tinkUrl)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab));
  }
  decodePending
    .then((buf) => {
      tinkBuffer = buf;
      playFromBuffer();
    })
    .catch((err) => {
      console.warn("[ready-cue] tink decode failed:", err);
      decodePending = null;
    });
}

/**
 * Whether the audio subsystem has been unlocked by a user gesture yet.
 * Plan 02 doesn't consume this, but the colocated test suite does.
 */
export function isReadyCueUnlocked(): boolean {
  return unlocked;
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset ALL module-level state and detach any resident unlock listeners.
 * Used by src/ui/audio/ready-cue.test.ts's `beforeEach` so each test starts
 * from a known-empty state. NOT a public API.
 *
 * Mirrors src/ui/state/session-working-store.ts:1151's shape.
 */
export function __resetForTest(): void {
  for (const { type, handler } of unlockListeners) {
    // Remove with capture:true to match the addEventListener option — the DOM
    // spec distinguishes capture-phase listeners from bubble-phase ones.
    document.removeEventListener(type, handler, true);
  }
  unlockListeners.length = 0;
  unlocked = false;
  initialized = false;
  audioCtx = null;
  tinkBuffer = null;
  decodePending = null;
}
