import { describe, it, expect } from "vitest";
import { findTailGuardCut, tailGuardApplies, TAIL_GUARD_FILLER } from "./tail-guard.js";

/**
 * Tail guard — synthetic PCM truth table. "Speech" is a 440 Hz tone well
 * above the -45 dBFS silence floor; "pause" is digital silence. Real-audio
 * validation (205 clips, 13 voices) lives in the research harness; these
 * pin the rule's shape.
 */

const SR = 24000;

type Seg = ["speech" | "pause", number];

function pcm(segs: Seg[]): Buffer {
  const total = segs.reduce((n, [, sec]) => n + Math.round(sec * SR), 0);
  const buf = Buffer.alloc(total * 2);
  let i = 0;
  for (const [kind, sec] of segs) {
    const n = Math.round(sec * SR);
    for (let k = 0; k < n; k++, i++) {
      const v = kind === "speech" ? Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / SR)) : 0;
      buf.writeInt16LE(v, i * 2);
    }
  }
  return buf;
}

const sec = (bytes: number) => bytes / 2 / SR;

describe("findTailGuardCut", () => {
  it("cuts inside the pause before the filler", () => {
    const d = findTailGuardCut(pcm([["speech", 3], ["pause", 0.5], ["speech", 4.5], ["pause", 0.3]]), SR);
    expect(d.decision).toBe("cut");
    if (d.decision !== "cut") return;
    expect(sec(d.cutByte)).toBeCloseTo(3.15, 2);
    expect(d.pauseSec).toBeCloseTo(0.5, 2);
    expect(d.fillerSec).toBeCloseTo(4.5, 2);
  });

  it("skips short pauses inside the filler and inside the real text", () => {
    const d = findTailGuardCut(
      pcm([
        ["speech", 2], ["pause", 0.3], ["speech", 1], // real text with its own pause
        ["pause", 0.45],
        ["speech", 2], ["pause", 0.3], ["speech", 2.5], // filler with an inner pause
      ]),
      SR,
    );
    expect(d.decision).toBe("cut");
    if (d.decision !== "cut") return;
    expect(sec(d.cutByte)).toBeCloseTo(3.45, 2);
  });

  it("cuts mid-pause when the pause is shorter than twice the cut offset", () => {
    const d = findTailGuardCut(pcm([["speech", 3], ["pause", 0.26], ["speech", 4]]), SR);
    expect(d.decision).toBe("cut");
    if (d.decision !== "cut") return;
    expect(sec(d.cutByte)).toBeCloseTo(3.13, 2);
  });

  it("refuses rather than cut real text when the filler itself was cut short", () => {
    // Real sentence, sentence break, then only ~2s of the filler before the model stopped.
    const d = findTailGuardCut(
      pcm([["speech", 3], ["pause", 0.5], ["speech", 2], ["pause", 0.5], ["speech", 2]]),
      SR,
    );
    expect(d).toMatchObject({ decision: "refused", reason: "filler-truncated" });
  });

  it("refuses on continuous speech (no pause long enough)", () => {
    const d = findTailGuardCut(pcm([["speech", 3], ["pause", 0.2], ["speech", 4.5]]), SR);
    expect(d).toMatchObject({ decision: "refused", reason: "no-qualifying-pause" });
  });

  it("refuses when the speech after the last pause is not filler-length", () => {
    expect(findTailGuardCut(pcm([["speech", 3], ["pause", 0.5], ["speech", 8]]), SR)).toMatchObject({
      decision: "refused",
    });
    expect(findTailGuardCut(pcm([["speech", 3], ["pause", 0.5], ["speech", 2]]), SR)).toMatchObject({
      decision: "refused",
    });
  });

  it("ignores a silent run touching the start of the buffer (may be truncated)", () => {
    const d = findTailGuardCut(pcm([["pause", 0.6], ["speech", 4.5]]), SR);
    expect(d.decision).toBe("refused");
  });

  it("refuses on silence and on empty input", () => {
    expect(findTailGuardCut(pcm([["pause", 2]]), SR)).toMatchObject({ decision: "refused", reason: "no-speech" });
    expect(findTailGuardCut(Buffer.alloc(0), SR)).toMatchObject({ decision: "refused" });
  });

  it("returns a frame-aligned byte offset", () => {
    const d = findTailGuardCut(pcm([["speech", 3], ["pause", 0.5], ["speech", 4.5]]), SR);
    expect(d.decision === "cut" && d.cutByte % 2).toBe(0);
  });
});

describe("tailGuardApplies", () => {
  it("applies only to OpenAI's gpt-4o-mini-tts family", () => {
    expect(tailGuardApplies("openai", "gpt-4o-mini-tts")).toBe(true);
    expect(tailGuardApplies("openai", "gpt-4o-mini-tts-2025-12-15")).toBe(true);
    expect(tailGuardApplies("openai", "tts-1-hd")).toBe(false);
    expect(tailGuardApplies("polly", null)).toBe(false);
    expect(tailGuardApplies("elevenlabs", "eleven_multilingual_v2")).toBe(false);
  });

  it("uses a filler sentence without commas (keeps its inner pauses short)", () => {
    expect(TAIL_GUARD_FILLER).not.toMatch(/,/);
  });
});
