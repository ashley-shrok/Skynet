import { describe, expect, it } from "vitest";
import { createTimeStretcher } from "./timeStretch";

const SR = 24000;

function sine(freq: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

/** Run `input` through a stretcher in chunks of `chunk` samples. */
function stretch(input: Float32Array, rate: number, chunk: number): Float32Array {
  const t = createTimeStretcher(SR, 1, rate);
  const parts: Float32Array[] = [];
  for (let o = 0; o < input.length; o += chunk) parts.push(t.process([input.slice(o, o + chunk)])[0]);
  parts.push(t.flush()[0]);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Dominant frequency from the zero-crossing rate. */
function zeroCrossingHz(x: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) crossings++;
  return crossings / 2 / (x.length / SR);
}

describe("createTimeStretcher", () => {
  it("rate 1 passes audio through untouched", () => {
    const x = sine(220, 0.5);
    const t = createTimeStretcher(SR, 1, 1);
    expect(t.process([x])[0]).toBe(x);
    expect(t.flush()[0]).toHaveLength(0);
  });

  it.each([0.25, 0.5, 0.8, 1.3, 1.6, 2, 3, 4])("rate %s: output is exactly input / rate long, whatever the chunking", (rate) => {
    const x = sine(180, 1.7);
    for (const chunk of [1, 333, 4801, x.length]) {
      expect(stretch(x, rate, chunk)).toHaveLength(Math.round(x.length / rate));
    }
  });

  it.each([1.3, 2])("rate %s keeps the pitch (no chipmunk)", (rate) => {
    const out = stretch(sine(200, 2), rate, 2400);
    // Skip the edges (fade-in of the first frame, padded tail).
    expect(zeroCrossingHz(out.subarray(SR * 0.1, out.length - SR * 0.1))).toBeCloseTo(200, -1);
  });

  it("a steady tone stays steady (frames line up — no warble or level dips)", () => {
    const out = stretch(sine(150, 2), 1.3, 1000);
    const mid = out.subarray(SR * 0.1, out.length - SR * 0.1);
    // RMS of each 20ms window stays near the tone's 0.354.
    for (let o = 0; o + 480 <= mid.length; o += 480) {
      let e = 0;
      for (let i = o; i < o + 480; i++) e += mid[i] * mid[i];
      expect(Math.sqrt(e / 480)).toBeGreaterThan(0.3);
    }
  });

  it("doesn't fade in the start of the audio", () => {
    const x = new Float32Array(SR).fill(0.5);
    expect(stretch(x, 1.3, 4800)[0]).toBeCloseTo(0.5, 5);
  });

  it("emits the end of the audio at high rates instead of overshooting", () => {
    const x = sine(200, 2);
    const t = createTimeStretcher(SR, 1, 4);
    let n = 0;
    for (let o = 0; o < x.length; o += 4800) n += t.process([x.slice(o, o + 4800)])[0].length;
    expect(n).toBeLessThanOrEqual(Math.round(x.length / 4));
    expect(t.flush()[0].length).toBeGreaterThan(0);
  });

  it("stretches every channel by the same amount", () => {
    const t = createTimeStretcher(SR, 2, 1.5);
    const a = sine(200, 1);
    const out = [...[t.process([a, a])], t.flush()];
    const len = (ch: number) => out.reduce((n, p) => n + p[ch].length, 0);
    expect(len(0)).toBe(Math.round(a.length / 1.5));
    expect(len(1)).toBe(len(0));
  });
});
