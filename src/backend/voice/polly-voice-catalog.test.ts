import { describe, it, expect } from "vitest";
import {
  POLLY_VOICES,
  POLLY_VOICE_IDS,
  isValidPollyVoice,
  type PollyVoice,
} from "./polly-voice-catalog.js";

/**
 * Phase 98 plan 02 — polly-voice-catalog truth-table test suite.
 *
 * Locks the static 7-voice generative-engine catalog + validator per
 * D-Voice-catalog and D-Per-identity-voice-binding from 98-CONTEXT.md.
 *
 * Coverage rationale:
 *
 * - The catalog structure block guards the shape invariant — exactly 7
 *   voices, correct IDs, correct genders, correct ordering (Danielle,
 *   Joanna, Ruth, Salli, Tiffany, Matthew, Stephen), and the ID Set
 *   derivation.
 *
 * - The isValidPollyVoice block covers the validator contract that
 *   `src/backend/database/routes/identities.ts:51` will consume once
 *   Phase 98 replaces `IDENTITY_VOICE_RE`. Every falsy / non-string /
 *   old-Chatterbox-shape / wrong-case input MUST return false; every
 *   exact-match Polly voice ID MUST return true.
 */

describe("POLLY_VOICES catalog structure", () => {
  it("has exactly 7 entries", () => {
    expect(POLLY_VOICES.length).toBe(7);
  });

  it("voice IDs are exactly [Danielle, Joanna, Ruth, Salli, Tiffany, Matthew, Stephen] in that order", () => {
    expect(POLLY_VOICES.map((v) => v.voiceId)).toEqual([
      "Danielle",
      "Joanna",
      "Ruth",
      "Salli",
      "Tiffany",
      "Matthew",
      "Stephen",
    ]);
  });

  it("the first 5 voices are female (Danielle, Joanna, Ruth, Salli, Tiffany)", () => {
    const females = POLLY_VOICES.filter((v) => v.gender === "female").map((v) => v.voiceId);
    expect(females).toEqual(["Danielle", "Joanna", "Ruth", "Salli", "Tiffany"]);
  });

  it("the last 2 voices are male (Matthew, Stephen)", () => {
    const males = POLLY_VOICES.filter((v) => v.gender === "male").map((v) => v.voiceId);
    expect(males).toEqual(["Matthew", "Stephen"]);
  });

  it("every entry has voiceId, displayName, and gender fields", () => {
    for (const v of POLLY_VOICES) {
      expect(typeof v.voiceId).toBe("string");
      expect(typeof v.displayName).toBe("string");
      expect(v.gender === "female" || v.gender === "male").toBe(true);
      expect(v.voiceId.length).toBeGreaterThan(0);
      expect(v.displayName.length).toBeGreaterThan(0);
    }
  });

  it("PollyVoice type is structurally usable (compile-time smoke)", () => {
    const sample: PollyVoice = { voiceId: "Joanna", displayName: "Joanna", gender: "female" };
    expect(sample.voiceId).toBe("Joanna");
  });
});

describe("POLLY_VOICE_IDS Set", () => {
  it("size === 7", () => {
    expect(POLLY_VOICE_IDS.size).toBe(7);
  });

  it("contains every voiceId from POLLY_VOICES", () => {
    for (const v of POLLY_VOICES) {
      expect(POLLY_VOICE_IDS.has(v.voiceId)).toBe(true);
    }
  });

  it("does not contain any of the old Chatterbox .wav filenames", () => {
    expect(POLLY_VOICE_IDS.has("Elena.wav")).toBe(false);
    expect(POLLY_VOICE_IDS.has("Alice.wav")).toBe(false);
    expect(POLLY_VOICE_IDS.has("Danielle.wav")).toBe(false);
  });
});

describe("isValidPollyVoice — accepts each of the 7 supported voices", () => {
  it("Danielle", () => {
    expect(isValidPollyVoice("Danielle")).toBe(true);
  });

  it("Joanna", () => {
    expect(isValidPollyVoice("Joanna")).toBe(true);
  });

  it("Ruth", () => {
    expect(isValidPollyVoice("Ruth")).toBe(true);
  });

  it("Salli", () => {
    expect(isValidPollyVoice("Salli")).toBe(true);
  });

  it("Tiffany", () => {
    expect(isValidPollyVoice("Tiffany")).toBe(true);
  });

  it("Matthew", () => {
    expect(isValidPollyVoice("Matthew")).toBe(true);
  });

  it("Stephen", () => {
    expect(isValidPollyVoice("Stephen")).toBe(true);
  });
});

describe("isValidPollyVoice — rejects old-Chatterbox shapes and non-string/malformed inputs", () => {
  it("rejects 'Elena.wav' (old Chatterbox filename)", () => {
    expect(isValidPollyVoice("Elena.wav")).toBe(false);
  });

  it("rejects 'Alice.wav'", () => {
    expect(isValidPollyVoice("Alice.wav")).toBe(false);
  });

  it("rejects 'Danielle.wav' (Polly voice name + .wav suffix)", () => {
    expect(isValidPollyVoice("Danielle.wav")).toBe(false);
  });

  it("rejects '' (empty string)", () => {
    expect(isValidPollyVoice("")).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidPollyVoice(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidPollyVoice(undefined)).toBe(false);
  });

  it("rejects a number (42)", () => {
    expect(isValidPollyVoice(42)).toBe(false);
  });

  it("rejects an object", () => {
    expect(isValidPollyVoice({ voiceId: "Joanna" })).toBe(false);
  });

  it("rejects lowercase 'danielle' (voice IDs are exact-match, case-sensitive)", () => {
    expect(isValidPollyVoice("danielle")).toBe(false);
  });

  it("rejects uppercase 'JOANNA'", () => {
    expect(isValidPollyVoice("JOANNA")).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(isValidPollyVoice("Kimberly")).toBe(false);
    expect(isValidPollyVoice("Ivy")).toBe(false);
    expect(isValidPollyVoice("hello")).toBe(false);
  });
});
