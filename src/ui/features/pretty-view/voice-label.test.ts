import { describe, expect, it } from "vitest";
import { VOICE_LABEL, appendVoiceLabel, stripVoiceLabel } from "./voice-label";

describe("voice label", () => {
  it("appends the label on its own line after a blank line", () => {
    expect(appendVoiceLabel("hello there")).toBe(`hello there\n\n${VOICE_LABEL}`);
  });

  it("strips the label back off, round-trip", () => {
    expect(stripVoiceLabel(appendVoiceLabel("hello there"))).toBe("hello there");
  });

  it("tolerates trailing whitespace the harness may add", () => {
    expect(stripVoiceLabel(`hello\n\n${VOICE_LABEL}\n  `)).toBe("hello");
  });

  it("leaves the label alone when it is not at the end", () => {
    const text = `${VOICE_LABEL} is what voice mode adds`;
    expect(stripVoiceLabel(text)).toBe(text);
  });

  it("leaves unlabeled text untouched", () => {
    expect(stripVoiceLabel("typed message")).toBe("typed message");
  });
});

describe("voice label with a heard note", () => {
  it("puts the note in its own brackets after the unchanged label and strips both", () => {
    const sent = appendVoiceLabel("yes", 'The last of your replies the user had heard was the one starting "Ship it".');
    expect(sent).toBe(
      'yes\n\n[sent by voice — your reply will be read aloud] [The last of your replies the user had heard was the one starting "Ship it".]',
    );
    expect(stripVoiceLabel(sent)).toBe("yes");
  });

  it("never lets a stray bracket in the note break the strip", () => {
    const sent = appendVoiceLabel("ok", "they heard [this] one");
    expect(stripVoiceLabel(sent)).toBe("ok");
  });

  it("leaves a user's own bracketed text alone", () => {
    expect(stripVoiceLabel("see [notes]")).toBe("see [notes]");
  });
});
