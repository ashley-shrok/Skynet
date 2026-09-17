/**
 * WebAudioStreamPlayer — factory for progressive streaming WAV playback via Web Audio API.
 *
 * Takes a Response (from postSpeakStream) with an unread streaming body, reads
 * it chunk-by-chunk, decodes each PCM chunk into an AudioBuffer, and schedules
 * playback via AudioBufferSourceNodes so audio starts playing before synthesis
 * finishes (~30ms TTFB per Chatterbox streaming endpoint).
 *
 * Scheduling recipe: "nextStartTime running clock" pattern lifted from Nelly's
 * streaming Chatterbox demo (https://example.com/tts-demo/ view-source,
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

// Client-side playback speedup. Applied per AudioBufferSourceNode; pitch scales
// with rate (Web Audio API has no native time-stretch), so keep this modest.
// Advancing `nextStartTimeRef` must divide by this value to stay gapless.
const TTS_PLAYBACK_RATE = 1.25;

// the operator 2026-09-17 — bug fix: Chrome silently drops audio output for
// AudioBufferSourceNodes scheduled too far ahead of the playhead, while
// still firing their onended callbacks on schedule. Symptom: a long
// message hard-cuts partway through and finishes with silence, media-ended
// fires legitimately at the end of the expected duration.
//
// Cause: Polly generative streams the whole audio faster than we play it
// (5-6x faster at the 1.25x client rate), so the reader loop schedules
// every ~2s source immediately as it arrives. For a ~150s message, that
// leaves ~60s worth of sources queued ahead of the playhead by the time
// the reader finishes, and Chrome starts silently dropping past its
// internal-but-undocumented ~30-60s scheduling window.
//
// Fix: cap the number of sources scheduled-but-not-yet-ended. When the
// scheduler window is full, the reader loop awaits an onended before
// scheduling the next chunk. This naturally backpressures the fetch()
// body stream — network layer stops reading, TCP window shrinks, Polly
// slows down — and keeps the audio-thread schedule shallow.
//
// Sizing: TTS_PLAYBACK_RATE=1.25 with ~2s buffers → each source spans
// ~1.6s of ctx clock. Horizon of 8 sources = ~13s of scheduled audio
// ahead of the playhead. Well below the Chrome drop threshold, generous
// enough that a brief main-thread stall never underruns playback.
const SCHEDULE_HORIZON_SOURCES = 8;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WebAudioStreamPlayerOptions {
  onEnded?: () => void;
  onError?: (err: Error) => void;
  // Phase 31 instrumentation hooks — fired at observable Web Audio lifecycle
  // transitions (analogous to HTMLAudioElement media events per D-02).
  onCanPlay?: () => void;   // first audio chunk decoded and scheduled
  onPlaying?: () => void;  // AudioContext resumed from suspended (resume path)
  onPause?: () => void;    // AudioContext suspended (pause path)
  onStalled?: () => void;  // reader stall detected (done=false, value=undefined)
  onSuspend?: () => void;  // AudioContext moved to suspended state unexpectedly
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
  // Parallel to `sources` — one entry per scheduled source with the timing
  // metadata needed to diagnose "audio hard-cut before it should" reports
  // (the operator 2026-09-17 — media-ended fired legitimately but tail audio was
  // silent; instrumentation exists to pin the source-ended fire pattern next
  // occurrence). idx counts from 0, matches sources[] index.
  const scheduledMeta: Array<{
    idx: number;
    startTime: number;
    bufferDuration: number;
    audibleDuration: number;
    expectedEnd: number;
  }> = [];
  let endedSources = 0;
  let readerDone = false;
  let stopped = false;
  let onEndedFired = false;
  let onErrorFired = false;
  // Backpressure state — see SCHEDULE_HORIZON_SOURCES rationale at top of file.
  // scheduleWakeup is set by the reader loop when it's waiting for horizon
  // room, cleared+invoked by onSourceEnded when a source finishes.
  let scheduleWakeup: (() => void) | null = null;

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
    // Wake the reader loop if it's parked at the backpressure gate. Any
    // teardown path (natural end, external stop, resume-closed error) needs
    // to release the wait so the loop can observe the new state and exit
    // instead of hanging on a wake signal that will never come once
    // audioContext is set to null below.
    if (scheduleWakeup) {
      const wake = scheduleWakeup;
      scheduleWakeup = null;
      wake();
    }
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
      const ctxTime = audioContext?.currentTime ?? -1;
      const lastMeta = scheduledMeta[scheduledMeta.length - 1];
      console.info(
        `[tts-player] fire-ended ctxTime=${ctxTime.toFixed(3)} endedSources=${endedSources} sources=${sources.length} lastScheduledEnd=${lastMeta?.expectedEnd.toFixed(3) ?? "n/a"} ctxState=${audioContext?.state ?? "null"}`,
      );
      teardown();
      opts.onEnded?.();
    }
  }

  /** Called by each source's onended. `idx` matches sources[] index. */
  function onSourceEnded(idx: number): void {
    endedSources += 1;
    const meta = scheduledMeta[idx];
    const ctxTime = audioContext?.currentTime ?? -1;
    const drift = meta ? ctxTime - meta.expectedEnd : 0;
    console.info(
      `[tts-player] source-ended idx=${idx} expectedEnd=${meta?.expectedEnd.toFixed(3) ?? "n/a"} ctxTime=${ctxTime.toFixed(3)} drift=${drift.toFixed(3)} endedCount=${endedSources} totalCount=${sources.length} ctxState=${audioContext?.state ?? "null"}`,
    );
    // Wake the reader loop if it's parked waiting for horizon room.
    if (scheduleWakeup) {
      const wake = scheduleWakeup;
      scheduleWakeup = null;
      wake();
    }
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
    source.playbackRate.value = TTS_PLAYBACK_RATE;
    source.connect(ctx.destination);
    const idx = sources.length;
    source.onended = () => onSourceEnded(idx);

    // If we've fallen behind the playhead (e.g. a slow decode stall), reset
    // nextStartTime to now + epsilon to avoid queuing a backlog of silent gaps.
    const preClampNextStart = nextStartTimeRef.value;
    if (nextStartTimeRef.value < ctx.currentTime) {
      nextStartTimeRef.value = ctx.currentTime + 0.02;
    }

    source.start(nextStartTimeRef.value);
    // Audible duration = buffer.duration / playbackRate. Advance by that so
    // consecutive sources remain gapless at the accelerated rate.
    const audibleDuration = buffer.duration / TTS_PLAYBACK_RATE;
    const startTime = nextStartTimeRef.value;
    const expectedEnd = startTime + audibleDuration;
    nextStartTimeRef.value = expectedEnd;
    sources.push(source);
    scheduledMeta.push({ idx, startTime, bufferDuration: buffer.duration, audibleDuration, expectedEnd });
    const clamped = preClampNextStart !== startTime;
    console.info(
      `[tts-player] schedule idx=${idx} start=${startTime.toFixed(3)} bufDur=${buffer.duration.toFixed(3)} audible=${audibleDuration.toFixed(3)} expectedEnd=${expectedEnd.toFixed(3)} ctxTime=${ctx.currentTime.toFixed(3)} clamped=${clamped} ctxState=${ctx.state}`,
    );
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
    let firstChunkScheduled = false;

    try {
      while (true) {
        if (stopped) return;

        const { done, value } = await reader.read();
        if (done) {
          readerDone = true;
          const ctxTime = audioContext?.currentTime ?? -1;
          const lastMeta = scheduledMeta[scheduledMeta.length - 1];
          console.info(
            `[tts-player] reader-done sources=${sources.length} endedSoFar=${endedSources} ctxTime=${ctxTime.toFixed(3)} lastScheduledEnd=${lastMeta?.expectedEnd.toFixed(3) ?? "n/a"} ctxState=${audioContext?.state ?? "null"}`,
          );
          maybeFireEnded();
          return;
        }
        // value=undefined mid-stream → stall condition (reader returned without
        // data and without signalling done).
        if (!value) {
          opts.onStalled?.();
          continue;
        }

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

        // Backpressure: hold off scheduling if the audio thread already has
        // SCHEDULE_HORIZON_SOURCES worth of pending (scheduled-but-not-ended)
        // sources ahead of the playhead. Wake when a source ends. See
        // SCHEDULE_HORIZON_SOURCES rationale at top of file for why this
        // exists (Chrome silently drops far-future scheduled buffer output).
        while (
          !stopped &&
          audioContext !== null &&
          sources.length - endedSources >= SCHEDULE_HORIZON_SOURCES
        ) {
          console.info(
            `[tts-player] backpressure-wait pending=${sources.length - endedSources} horizon=${SCHEDULE_HORIZON_SOURCES} ctxTime=${audioContext.currentTime.toFixed(3)} ctxState=${audioContext.state}`,
          );
          await new Promise<void>((resolve) => {
            scheduleWakeup = resolve;
          });
        }
        // audioContext may have been nulled by teardown() while we were parked
        // (external stop, resume-closed error). Bail cleanly rather than
        // dereferencing null below.
        if (stopped || audioContext === null) return;

        scheduleChunk(pcmChunk, header, audioContext, nextStartTimeRef);
        // Fire onCanPlay on the first successfully scheduled chunk — analogous
        // to HTMLAudioElement's canplay event (enough data to start playback).
        if (!firstChunkScheduled) {
          firstChunkScheduled = true;
          opts.onCanPlay?.();
        }
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
    const pending = sources.length - endedSources;
    console.info(
      `[tts-player] stop pending=${pending} sources=${sources.length} ctxTime=${(audioContext?.currentTime ?? -1).toFixed(3)} ctxState=${audioContext?.state ?? "null"}`,
    );
    // Release the reader loop if it's parked at the backpressure gate so it
    // can observe stopped=true and exit its while(true).
    if (scheduleWakeup) {
      const wake = scheduleWakeup;
      scheduleWakeup = null;
      wake();
    }
    teardown();
    // Do NOT fire onEnded or onError — external stop is the caller's own action.
  }

  async function pause(): Promise<void> {
    // No-op if stopped, if play() hasn't started, or if context is already
    // suspended/closed. suspend() is safe to call in "running" state only.
    if (stopped || !audioContext) {
      console.info(`[tts-player] pause-noop reason=${stopped ? "stopped" : "no-context"}`);
      return;
    }
    if (audioContext.state !== "running") {
      console.info(`[tts-player] pause-noop reason=state-${audioContext.state} ctxTime=${audioContext.currentTime.toFixed(3)}`);
      return;
    }
    const stateBefore = audioContext.state;
    const ctxTimeBefore = audioContext.currentTime;
    const pending = sources.length - endedSources;
    try {
      await audioContext.suspend();
      console.info(
        `[tts-player] pause stateBefore=${stateBefore} stateAfter=${audioContext.state} ctxTime=${ctxTimeBefore.toFixed(3)} pending=${pending}`,
      );
      // Fire onPause after successful suspend — analogous to HTMLAudioElement
      // pause event (audio stream paused at user/system request).
      opts.onPause?.();
    } catch (err) {
      // Rare — browser may reject if the context was killed under us.
      // Treat as a no-op; the next resume attempt will surface it via onError.
      // Fire onSuspend to signal unexpected context state change.
      const errMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[tts-player] pause-error errMessage="${errMessage}" ctxState=${audioContext?.state ?? "null"}`);
      opts.onSuspend?.();
    }
  }

  async function resume(): Promise<void> {
    // No-op if stopped or if play() hasn't started. If the context isn't
    // actually suspended (already running / already closed / gone), a
    // resume() call would either be pointless or fail — surface a killed
    // context to the caller via onError so the UI can flip back to idle.
    if (stopped || !audioContext) {
      console.info(`[tts-player] resume-noop reason=${stopped ? "stopped" : "no-context"}`);
      return;
    }
    if (audioContext.state === "running") {
      console.info(`[tts-player] resume-noop reason=already-running ctxTime=${audioContext.currentTime.toFixed(3)}`);
      return;
    }
    if (audioContext.state === "closed") {
      const pending = sources.length - endedSources;
      console.error(`[tts-player] resume-closed pending=${pending} sources=${sources.length}`);
      if (!onErrorFired) {
        onErrorFired = true;
        teardown();
        opts.onError?.(new Error("AudioContext closed — cannot resume"));
      }
      return;
    }
    const stateBefore = audioContext.state;
    const ctxTimeBefore = audioContext.currentTime;
    const pending = sources.length - endedSources;
    try {
      await audioContext.resume();
      console.info(
        `[tts-player] resume stateBefore=${stateBefore} stateAfter=${audioContext.state} ctxTime=${ctxTimeBefore.toFixed(3)} pending=${pending}`,
      );
      // Fire onPlaying after successful resume — analogous to HTMLAudioElement
      // playing event (playback restarted after being paused/suspended).
      opts.onPlaying?.();
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`[tts-player] resume-error errMessage="${errMessage}" stateBefore=${stateBefore} ctxState=${audioContext?.state ?? "null"} pending=${pending}`);
      if (!onErrorFired) {
        onErrorFired = true;
        teardown();
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  return { play, stop, pause, resume };
}
