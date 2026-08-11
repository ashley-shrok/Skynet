/**
 * WebAudioStreamPlayer — factory for progressive streaming WAV playback via Web Audio API.
 *
 * Takes a Response (from postSpeakStream) with an unread streaming body, reads
 * it chunk-by-chunk, decodes each PCM chunk into an AudioBuffer, and schedules
 * playback via AudioBufferSourceNodes so audio starts playing before synthesis
 * finishes (~30ms TTFB per Chatterbox streaming endpoint).
 *
 * Scheduling recipe: "nextStartTime running clock" pattern lifted from Nelly's
 * streaming Chatterbox demo (https://gigaashley.click/tts-demo/ view-source,
 * Nelly's permission to lift wholesale). Each source is scheduled at
 * nextStartTime; nextStartTime advances by buffer.duration after each schedule.
 *
 * A fresh AudioContext is created per play() invocation — locked by
 * 19-CONTEXT.md § Frontend player to avoid sample-rate-mismatch bugs across
 * calls (Chatterbox voices may have different sample rates).
 *
 * Patch #237 (Phase 19 Plan 04).
 */

import { parseRiffHeader, decodePcmChunk, type RiffHeader } from "./riffPcmDecode";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WebAudioStreamPlayerOptions {
  onEnded?: () => void;
  onError?: (err: Error) => void;
}

export interface WebAudioStreamPlayer {
  play(response: Response): Promise<void>;
  stop(): void;
  // Pause/resume suspend and resume the underlying AudioContext. Already-
  // scheduled AudioBufferSourceNodes hold their start times against the
  // context clock, which freezes while suspended — so on resume, everything
  // continues from where it left off, and any chunks the reader loop schedules
  // during the pause naturally queue up for post-resume playback. Both are
  // best-effort: if the browser has already killed the AudioContext (long tab
  // background, memory pressure), resume() fires onError with the underlying
  // failure so the caller can flip back to idle.
  pause(): Promise<void>;
  resume(): Promise<void>;
}

/**
 * Create a WebAudioStreamPlayer that drives progressive WAV playback.
 *
 * Returns an object with:
 * - play(response): starts the read loop; resolves when the reader signals done
 *   (NOT when all audio has played — onEnded fires later after sources complete)
 * - stop(): tears down all scheduled sources + AudioContext; idempotent
 *
 * Callbacks:
 * - onEnded: fires when reader is done AND all scheduled sources have ended
 * - onError: fires on non-ok response or mid-stream reader error; NOT fired by
 *   an external stop() call
 *
 * onEnded and onError are mutually exclusive for a single play session.
 */
export function createWebAudioStreamPlayer(
  opts: WebAudioStreamPlayerOptions = {},
): WebAudioStreamPlayer {
  // ─── Internal state ─────────────────────────────────────────────────────────
  let audioContext: AudioContext | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const sources: AudioBufferSourceNode[] = [];
  let endedSources = 0;
  let readerDone = false;
  let stopped = false;
  let onEndedFired = false;
  let onErrorFired = false;

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** Concatenate two Uint8Arrays into a new one. */
  function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a, 0);
    out.set(b, a.byteLength);
    return out;
  }

  /** Tear down the reader, all scheduled sources, and the AudioContext. */
  function teardown(): void {
    if (reader) {
      try {
        reader.cancel();
      } catch {
        /* ignore — reader may already be closed */
      }
      reader = null;
    }
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already ended — stop() on an ended source throws InvalidStateError */
      }
    }
    sources.length = 0;
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch(() => {});
    }
    audioContext = null;
  }

  /**
   * Fire opts.onEnded if and only if:
   * - reader has signalled done (last chunk processed)
   * - all scheduled sources have fired their onended callbacks
   * - it hasn't fired before (one-shot)
   * - stop() was not called externally (external stop is not a natural end)
   */
  function maybeFireEnded(): void {
    if (readerDone && endedSources >= sources.length && !onEndedFired && !stopped) {
      onEndedFired = true;
      teardown();
      opts.onEnded?.();
    }
  }

  /** Called by each source's onended. */
  function onSourceEnded(): void {
    endedSources += 1;
    maybeFireEnded();
  }

  /**
   * Decode a PCM chunk and schedule an AudioBufferSourceNode on the given context.
   *
   * Uses the nextStartTime running clock pattern from Nelly's demo:
   * schedule at nextStartTime, then advance nextStartTime by buffer.duration
   * so consecutive buffers play gaplessly.
   */
  function scheduleChunk(
    pcmChunk: Uint8Array,
    hdr: RiffHeader,
    ctx: AudioContext,
    nextStartTimeRef: { value: number },
  ): void {
    const channelData = decodePcmChunk(pcmChunk, hdr);
    if (channelData[0].length === 0) return;

    const buffer = ctx.createBuffer(hdr.channels, channelData[0].length, hdr.sampleRate);
    for (let ch = 0; ch < hdr.channels; ch++) {
      buffer.getChannelData(ch).set(channelData[ch]);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = onSourceEnded;

    // If we've fallen behind the playhead (e.g. a slow decode stall), reset
    // nextStartTime to now + epsilon to avoid queuing a backlog of silent gaps.
    if (nextStartTimeRef.value < ctx.currentTime) {
      nextStartTimeRef.value = ctx.currentTime + 0.02;
    }

    source.start(nextStartTimeRef.value);
    nextStartTimeRef.value += buffer.duration;
    sources.push(source);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async function play(response: Response): Promise<void> {
    // Guard: non-ok response → error immediately, no AudioContext created.
    if (!response.ok) {
      onErrorFired = true;
      opts.onError?.(
        new Error(`postSpeakStream returned ${response.status}`),
      );
      return;
    }

    // Guard: response with no body (shouldn't happen in practice but defensive).
    if (!response.body) {
      onErrorFired = true;
      opts.onError?.(new Error("Response has no body"));
      return;
    }

    // Fresh AudioContext per invocation — avoids sample-rate mismatch across calls
    // (19-CONTEXT.md § Frontend player, locked decision).
    audioContext = new AudioContext();
    reader = response.body.getReader();

    let headerBytes: Uint8Array | null = null;
    let header: RiffHeader | null = null;
    // Trailing bytes from the previous chunk that didn't complete a full PCM
    // frame — prepended to the next chunk before decoding. Without this,
    // chunks arriving at odd byte boundaries silently drop 1-3 bytes per
    // occurrence in decodePcmChunk's frame truncation, and every subsequent
    // Int16 sample is misaligned by that offset. Symptom: audio starts clean,
    // drifts to gibberish, then to static as more misaligned chunks accumulate.
    let pcmRemainder = new Uint8Array(0);
    // 20ms epsilon — small enough to be imperceptible, large enough to prevent
    // underrun on the very first scheduled source.
    const nextStartTimeRef = { value: audioContext.currentTime + 0.02 };

    try {
      while (true) {
        if (stopped) return;

        const { done, value } = await reader.read();
        if (done) {
          readerDone = true;
          maybeFireEnded();
          return;
        }
        if (!value) continue;

        // Accumulate bytes until we have the full 44-byte RIFF header.
        let pcmChunk: Uint8Array;
        if (header === null) {
          headerBytes = headerBytes ? concat(headerBytes, value) : value;
          if (headerBytes.byteLength < 44) continue;
          header = parseRiffHeader(headerBytes);
          pcmChunk = headerBytes.subarray(header.pcmDataOffset);
          headerBytes = null;
        } else {
          pcmChunk = value;
        }

        // Prepend any trailing partial-frame bytes from the previous chunk,
        // then split off any new trailing partial-frame bytes to carry over.
        // This keeps every scheduleChunk call frame-aligned, regardless of
        // where the HTTP chunked-transfer boundaries fall in the byte stream.
        if (pcmRemainder.byteLength > 0) {
          pcmChunk = concat(pcmRemainder, pcmChunk);
          pcmRemainder = new Uint8Array(0);
        }
        const frameBytes = header.channels * (header.bitDepth / 8);
        const alignedLen = Math.floor(pcmChunk.byteLength / frameBytes) * frameBytes;
        if (alignedLen < pcmChunk.byteLength) {
          pcmRemainder = pcmChunk.subarray(alignedLen);
          pcmChunk = pcmChunk.subarray(0, alignedLen);
        }

        if (pcmChunk.byteLength === 0) continue;
        scheduleChunk(pcmChunk, header, audioContext, nextStartTimeRef);
      }
    } catch (err) {
      if (!stopped && !onErrorFired) {
        onErrorFired = true;
        teardown();
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  function stop(): void {
    if (stopped) return; // idempotent
    stopped = true;
    teardown();
    // Do NOT fire onEnded or onError — external stop is the caller's own action.
  }

  async function pause(): Promise<void> {
    // No-op if stopped, if play() hasn't started, or if context is already
    // suspended/closed. suspend() is safe to call in "running" state only.
    if (stopped || !audioContext) return;
    if (audioContext.state !== "running") return;
    try {
      await audioContext.suspend();
    } catch {
      // Rare — browser may reject if the context was killed under us.
      // Treat as a no-op; the next resume attempt will surface it via onError.
    }
  }

  async function resume(): Promise<void> {
    // No-op if stopped or if play() hasn't started. If the context isn't
    // actually suspended (already running / already closed / gone), a
    // resume() call would either be pointless or fail — surface a killed
    // context to the caller via onError so the UI can flip back to idle.
    if (stopped || !audioContext) return;
    if (audioContext.state === "running") return;
    if (audioContext.state === "closed") {
      if (!onErrorFired) {
        onErrorFired = true;
        teardown();
        opts.onError?.(new Error("AudioContext closed — cannot resume"));
      }
      return;
    }
    try {
      await audioContext.resume();
    } catch (err) {
      if (!onErrorFired) {
        onErrorFired = true;
        teardown();
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  return { play, stop, pause, resume };
}
