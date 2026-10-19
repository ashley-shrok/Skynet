import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BENCH_MS,
  PcmResampler,
  RESUME_CHARS_PER_SEC,
  benchProvider,
  clearProviderBench,
  isProviderBenched,
  resumeText,
} from "./tts-fallback.js";

vi.mock("../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function pcm(samples: number[]): Buffer {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((v, k) => b.writeInt16LE(v, k * 2));
  return b;
}
function samples(b: Buffer): number[] {
  return Array.from({ length: b.length / 2 }, (_, k) => b.readInt16LE(k * 2));
}

describe("resumeText", () => {
  const s = ["One two three.", "Four five six.", "Seven eight nine."]; // 14, 14, 17 chars
  const chunk = s.join(" ");

  it("nothing played → the whole failed chunk and everything after it", () => {
    expect(resumeText([chunk, "Later chunk."], 0, 0)).toBe(`${chunk} Later chunk.`);
    expect(resumeText(["Done.", chunk], 1, 0)).toBe(chunk);
  });

  it("backs up to the start of the sentence the guess falls in", () => {
    expect(resumeText([chunk], 0, 10 / RESUME_CHARS_PER_SEC)).toBe(chunk); // inside sentence 0
    expect(resumeText([chunk], 0, 20 / RESUME_CHARS_PER_SEC)).toBe(s.slice(1).join(" "));
    expect(resumeText([chunk, "Later."], 0, 35 / RESUME_CHARS_PER_SEC)).toBe(`${s[2]} Later.`);
  });

  it("a guess past the chunk's end still repeats its last sentence", () => {
    expect(resumeText([chunk, "Later."], 0, 999)).toBe(`${s[2]} Later.`);
  });
});

describe("bench", () => {
  beforeEach(() => clearProviderBench());

  it("benches for BENCH_MS, then lets the provider be tried again", () => {
    const t0 = 1_000_000;
    expect(isProviderBenched("openai", "r", t0)).toBe(false);
    benchProvider("openai", "r", "stall", t0);
    expect(isProviderBenched("openai", "r", t0 + BENCH_MS - 1)).toBe(true);
    expect(isProviderBenched("elevenlabs", "r", t0 + 1)).toBe(false);
    expect(isProviderBenched("openai", "r", t0 + BENCH_MS)).toBe(false);
    expect(isProviderBenched("openai", "r", t0 + BENCH_MS + 1)).toBe(false);
  });
});

describe("PcmResampler", () => {
  it("16 kHz → 24 kHz produces 1.5× the samples and interpolates between them", () => {
    const r = new PcmResampler(16000, 24000);
    const out = samples(r.push(pcm([0, 300, 600, 900])));
    expect(out.slice(0, 5)).toEqual([0, 200, 400, 600, 800]);
  });

  it("24 kHz → 16 kHz keeps 2 of every 3 sample positions", () => {
    const out = samples(new PcmResampler(24000, 16000).push(pcm([0, 30, 60, 90, 120, 150, 180])));
    expect(out).toEqual([0, 45, 90, 135]);
  });

  it("is continuous across pushes, including a sample split between buffers", () => {
    const whole = pcm(Array.from({ length: 200 }, (_, k) => k * 10));
    const one = samples(new PcmResampler(16000, 24000).push(whole));
    const split = new PcmResampler(16000, 24000);
    const parts = [whole.subarray(0, 7), whole.subarray(7, 151), whole.subarray(151)];
    const pieces = samples(Buffer.concat(parts.map((p) => split.push(p))));
    expect(pieces).toEqual(one);
    expect(Math.abs(pieces.length - 300)).toBeLessThanOrEqual(2);
  });
});
