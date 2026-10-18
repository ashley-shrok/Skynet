import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMicLevelMonitor,
  describeMicTrack,
  HEARD_MIN_MS,
  SILENT_WARN_AFTER_MS,
} from "./mic-level-monitor";

/** AudioContext stub whose analyser reports a constant sample value (`level`). */
class FakeAudioContext {
  state: AudioContextState = "running";
  level = 0;
  close = vi.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  createAnalyser() {
    return {
      fftSize: 0,
      getFloatTimeDomainData: (buf: Float32Array) => buf.fill(this.level),
    };
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
}

const stream = {} as MediaStream;

function asCtx(ctx: FakeAudioContext): AudioContext {
  return ctx as unknown as AudioContext;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createMicLevelMonitor", () => {
  it("warns after SILENT_WARN_AFTER_MS of silence and reports silent=true", () => {
    const ctx = new FakeAudioContext();
    ctx.level = 0.0002; // ≈ −74 dBFS, like the silent recordings in the STT bank
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, onSilentChange);

    vi.advanceTimersByTime(SILENT_WARN_AFTER_MS - 200);
    expect(onSilentChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onSilentChange).toHaveBeenCalledTimes(1);
    expect(onSilentChange).toHaveBeenCalledWith(true);

    const summary = monitor.stop();
    expect(summary.silent).toBe(true);
    expect(summary.peakDb).toBeLessThan(-70);
    expect(ctx.close).toHaveBeenCalled();
  });

  it("never warns when speech-level input is present", () => {
    const ctx = new FakeAudioContext();
    ctx.level = 0.1;
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, onSilentChange);
    vi.advanceTimersByTime(10_000);
    expect(onSilentChange).not.toHaveBeenCalled();
    expect(monitor.stop().silent).toBe(false);
  });

  it("clears the warning when input shows up after it fired", () => {
    const ctx = new FakeAudioContext();
    ctx.level = 0.0002;
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, onSilentChange);
    vi.advanceTimersByTime(SILENT_WARN_AFTER_MS + 200);
    ctx.level = 0.1;
    vi.advanceTimersByTime(HEARD_MIN_MS - 100);
    expect(onSilentChange.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(200);
    expect(onSilentChange.mock.calls).toEqual([[true], [false]]);
    expect(monitor.stop().silent).toBe(false);
  });

  it("a lone transient at mic-open followed by silence still warns and reports silent=true", () => {
    // 2026-10-18 lost clip: headset mic gave a ~−48 dBFS pop in the first
    // ~250 ms, then 20 s of digital silence. A peak-only rule called it heard.
    const ctx = new FakeAudioContext();
    ctx.level = 0.004; // ≈ −48 dBFS, just above SILENT_RMS
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, onSilentChange);
    vi.advanceTimersByTime(200);
    ctx.level = 0.000005;
    vi.advanceTimersByTime(SILENT_WARN_AFTER_MS + 200);
    expect(onSilentChange.mock.calls).toEqual([[true]]);
    const summary = monitor.stop();
    expect(summary.silent).toBe(true);
    expect(summary.heardMs).toBeLessThan(HEARD_MIN_MS);
    expect(summary.peakDb).toBeGreaterThan(-50);
  });

  it("an all-zero feed (analyser not receiving the stream) never warns — verdict unknown", () => {
    const ctx = new FakeAudioContext();
    ctx.level = 0; // iPhone Safari: context running, analyser reads exact zeros
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, onSilentChange);
    vi.advanceTimersByTime(10_000);
    expect(onSilentChange).not.toHaveBeenCalled();
    const summary = monitor.stop();
    expect(summary.silent).toBeNull();
    expect(summary.allZero).toBe(true);
    expect(summary.measuredMs).toBeGreaterThan(0);
  });

  it("does not measure (or warn) while the context is not running — verdict unknown", () => {
    const ctx = new FakeAudioContext();
    ctx.state = "suspended";
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, onSilentChange);
    vi.advanceTimersByTime(10_000);
    expect(onSilentChange).not.toHaveBeenCalled();
    const summary = monitor.stop();
    expect(summary.silent).toBeNull();
    expect(summary.measuredMs).toBe(0);
  });

  it("with no context reports unknown and never warns", () => {
    const onSilentChange = vi.fn();
    const monitor = createMicLevelMonitor(null, stream, onSilentChange);
    vi.advanceTimersByTime(10_000);
    expect(onSilentChange).not.toHaveBeenCalled();
    expect(monitor.stop()).toMatchObject({ silent: null, ctxState: "none" });
  });

  it("stop() is idempotent", () => {
    const ctx = new FakeAudioContext();
    const monitor = createMicLevelMonitor(asCtx(ctx), stream, vi.fn());
    monitor.stop();
    monitor.stop();
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe("describeMicTrack", () => {
  it("includes the device label, mute state and settings", () => {
    const track = {
      label: "AirPods Pro",
      readyState: "live",
      muted: true,
      enabled: true,
      getSettings: () => ({ deviceId: "abcdef0123456789", sampleRate: 48000, channelCount: 1 }),
    };
    const s = describeMicTrack({ getAudioTracks: () => [track] } as unknown as MediaStream);
    expect(s).toContain('label="AirPods Pro"');
    expect(s).toContain("deviceId=abcdef01");
    expect(s).toContain("muted=true");
    expect(s).toContain("sampleRate=48000");
  });

  it("tolerates streams without getAudioTracks", () => {
    expect(describeMicTrack({} as MediaStream)).toBe("tracks=0");
  });
});
