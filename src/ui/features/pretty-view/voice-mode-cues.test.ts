// voice-mode-cues: every voice-mode sound goes through the given (already
// unlocked) AudioContext — never an HTMLAudioElement — so it plays on iOS
// while the mic is open.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVoiceModeCues } from "./voice-mode-cues";

function param() {
  return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

class FakeCtx {
  state = "running";
  currentTime = 0;
  destination = { id: "dest" };
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn(async () => ({ duration: 0.2 }) as unknown as AudioBuffer);
  sources: Array<{ buffer: unknown; start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> = [];
  oscillators: Array<{ type: string; start: ReturnType<typeof vi.fn> }> = [];
  gains: Array<{ gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  createBufferSource() {
    const s = { buffer: null as unknown, start: vi.fn(), connect: vi.fn() };
    this.sources.push(s);
    return s;
  }
  createOscillator() {
    const o = { type: "sine", frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    const g = { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return { type: "", frequency: param(), Q: param(), connect: vi.fn() };
  }
}

const log = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
  log.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function ready() {
  const ctx = new FakeCtx();
  const cues = createVoiceModeCues(ctx as unknown as AudioContext, log);
  await vi.advanceTimersByTimeAsync(0);
  return { ctx, cues };
}

describe("createVoiceModeCues", () => {
  it("plays the sent / your-turn / error samples through the context", async () => {
    const { ctx, cues } = await ready();
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(3);
    cues.play("sent");
    cues.play("yourTurn");
    cues.play("error");
    expect(ctx.sources).toHaveLength(3);
    for (const s of ctx.sources) {
      expect(s.connect).toHaveBeenCalledWith(ctx.destination);
      expect(s.start).toHaveBeenCalled();
    }
  });

  it("wakes a suspended context before playing", async () => {
    const { ctx, cues } = await ready();
    ctx.state = "suspended";
    cues.play("sent");
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("synthesizes a harsh three-burst alarm (no sample needed)", async () => {
    const { ctx, cues } = await ready();
    cues.play("alarm");
    expect(ctx.oscillators).toHaveLength(3);
    expect(ctx.oscillators.every((o) => o.type === "square")).toBe(true);
    expect(ctx.sources).toHaveLength(0);
  });

  it("logs instead of throwing when a sample isn't decoded yet", () => {
    const ctx = new FakeCtx();
    const cues = createVoiceModeCues(ctx as unknown as AudioContext, log);
    expect(() => cues.play("sent")).not.toThrow();
    expect(log).toHaveBeenCalledWith("cue-not-ready cue=sent");
  });

  it("ticks twice a second while on, and goes silent at once when stopped", async () => {
    const { ctx, cues } = await ready();
    cues.startTicking();
    expect(cues.isTicking()).toBe(true);
    const bus = ctx.gains[0];
    for (let i = 0; i < 20; i += 1) {
      ctx.currentTime += 0.1;
      await vi.advanceTimersByTimeAsync(100);
    }
    // ~2s of ticking at 2/s, plus lookahead.
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(4);
    expect(ctx.oscillators.length).toBeLessThanOrEqual(6);
    cues.stopTicking();
    expect(bus.disconnect).toHaveBeenCalled();
    expect(cues.isTicking()).toBe(false);
    const n = ctx.oscillators.length;
    ctx.currentTime += 2;
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.oscillators.length).toBe(n);
  });

  it("startTicking twice keeps a single ticker; dispose stops it", async () => {
    const { ctx, cues } = await ready();
    cues.startTicking();
    cues.startTicking();
    // One output bus wired to the speakers (per-tick gains feed the bus).
    expect(ctx.gains.filter((g) => g.connect.mock.calls.some(([d]) => d === ctx.destination))).toHaveLength(1);
    cues.dispose();
    expect(cues.isTicking()).toBe(false);
    cues.play("sent");
    expect(ctx.sources).toHaveLength(0);
  });
});
