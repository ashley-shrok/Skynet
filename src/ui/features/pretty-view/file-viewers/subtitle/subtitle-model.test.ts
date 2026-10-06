import { describe, expect, it } from "vitest";
import {
  convertSubtitles,
  cueProblems,
  cuesOf,
  deleteCues,
  formatTime,
  insertCue,
  parseSubtitles,
  parseTime,
  serializeSubtitles,
  shiftCues,
  updateCue,
} from "./subtitle-model";

const SRT = "1\r\n00:00:01,000 --> 00:00:04,000\r\nHello <i>there</i>\r\nsecond\r\n\r\n2\r\n00:00:05,500 --> 00:00:07,000\r\nNext\r\n\r\n3\r\n00:00:08,000 --> 00:00:09,000\r\nLast\r\n";

const VTT = `WEBVTT - Title here
Kind: captions

STYLE
::cue { color: yellow }

NOTE a comment
spanning lines

intro
00:00:01.000 --> 00:00:04.000 align:start position:10%
<v Bob>Hello <b>there</b>
second line

00:05.500 --> 00:07.000
Next
`;

const ASS = `[Script Info]
Title: x
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,Bob,0,0,0,,{\\b1}Hello{\\b0}, there\\Nsecond
Comment: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,a comment
Dialogue: 1,0:00:05.50,0:00:07.00,Sign,,0,0,0,,Next
`;

describe("times", () => {
  it("parses and formats", () => {
    expect(parseTime("01:02:03,450")).toBe(3723450);
    expect(parseTime("02:03.5")).toBe(123500);
    expect(parseTime("0:00:05.50")).toBe(5500);
    expect(parseTime("nope")).toBeNull();
    expect(parseTime("00:61:00,000")).toBeNull();
    expect(formatTime(3723450, "srt")).toBe("01:02:03,450");
    expect(formatTime(3723450, "vtt")).toBe("01:02:03.450");
    expect(formatTime(3723456, "ass")).toBe("1:02:03.46");
  });
});

describe("round trip", () => {
  it.each([
    ["a.srt", SRT],
    ["a.vtt", VTT],
    ["a.ass", ASS],
  ])("writes %s back unchanged", (name, text) => {
    expect(serializeSubtitles(parseSubtitles(name, text))).toBe(text);
  });

  it("reads cues", () => {
    expect(cuesOf(parseSubtitles("a.srt", SRT)).map((c) => [c.start, c.end, c.text])).toEqual([
      [1000, 4000, "Hello <i>there</i>\nsecond"],
      [5500, 7000, "Next"],
      [8000, 9000, "Last"],
    ]);
    const vtt = cuesOf(parseSubtitles("a.vtt", VTT));
    expect(vtt.map((c) => [c.start, c.end])).toEqual([[1000, 4000], [5500, 7000]]);
    const ass = cuesOf(parseSubtitles("a.ssa", ASS));
    expect(ass.map((c) => [c.start, c.end, c.text])).toEqual([
      [1000, 4000, "{\\b1}Hello{\\b0}, there\nsecond"],
      [5500, 7000, "Next"],
    ]);
  });
});

describe("editing rewrites only what changed", () => {
  it("SRT", () => {
    const doc = parseSubtitles("a.srt", SRT);
    const [, second] = cuesOf(doc);
    const out = serializeSubtitles(updateCue(doc, second.key, { text: "Changed\nline two", start: 5000 }));
    expect(out).toBe(SRT.replace("00:00:05,500 --> 00:00:07,000\r\nNext", "00:00:05,000 --> 00:00:07,000\r\nChanged\r\nline two"));
  });

  it("VTT keeps id and settings", () => {
    const doc = parseSubtitles("a.vtt", VTT);
    const [first] = cuesOf(doc);
    const out = serializeSubtitles(updateCue(doc, first.key, { end: 4500 }));
    expect(out).toBe(VTT.replace("00:00:01.000 --> 00:00:04.000 align", "00:00:01.000 --> 00:00:04.500 align"));
  });

  it("ASS keeps the other fields and \\N", () => {
    const doc = parseSubtitles("a.ass", ASS);
    const [first] = cuesOf(doc);
    const out = serializeSubtitles(updateCue(doc, first.key, { text: "One\nTwo", start: 1234 }));
    expect(out).toBe(ASS.replace("Dialogue: 0,0:00:01.00,0:00:04.00,Default,Bob,0,0,0,,{\\b1}Hello{\\b0}, there\\Nsecond", "Dialogue: 0,0:00:01.23,0:00:04.00,Default,Bob,0,0,0,,One\\NTwo"));
  });

  it("drops blank lines inside an SRT cue", () => {
    const doc = parseSubtitles("a.srt", SRT);
    const [first] = cuesOf(doc);
    const out = serializeSubtitles(updateCue(doc, first.key, { text: "a\n\nb" }));
    expect(out.startsWith("1\r\n00:00:01,000 --> 00:00:04,000\r\na\r\nb\r\n\r\n2")).toBe(true);
  });
});

describe("adding and removing", () => {
  it("inserts after a cue and renumbers SRT", () => {
    const doc = parseSubtitles("a.srt", SRT);
    const [first] = cuesOf(doc);
    const { doc: next, key } = insertCue(doc, first.key);
    const out = serializeSubtitles(updateCue(next, key, { text: "New" }));
    expect(out).toBe(
      "1\r\n00:00:01,000 --> 00:00:04,000\r\nHello <i>there</i>\r\nsecond\r\n\r\n2\r\n00:00:04,100 --> 00:00:06,100\r\nNew\r\n\r\n3\r\n00:00:05,500 --> 00:00:07,000\r\nNext\r\n\r\n4\r\n00:00:08,000 --> 00:00:09,000\r\nLast\r\n",
    );
  });

  it("deletes middle and last SRT cues", () => {
    const doc = parseSubtitles("a.srt", SRT);
    const [, second, third] = cuesOf(doc);
    expect(serializeSubtitles(deleteCues(doc, new Set([second.key])))).toBe(
      "1\r\n00:00:01,000 --> 00:00:04,000\r\nHello <i>there</i>\r\nsecond\r\n\r\n2\r\n00:00:08,000 --> 00:00:09,000\r\nLast\r\n",
    );
    expect(serializeSubtitles(deleteCues(doc, new Set([third.key])))).toBe(
      "1\r\n00:00:01,000 --> 00:00:04,000\r\nHello <i>there</i>\r\nsecond\r\n\r\n2\r\n00:00:05,500 --> 00:00:07,000\r\nNext\r\n",
    );
  });

  it("deletes and inserts ASS lines, copying the style", () => {
    const doc = parseSubtitles("a.ass", ASS);
    const [first, second] = cuesOf(doc);
    expect(serializeSubtitles(deleteCues(doc, new Set([first.key])))).toBe(
      ASS.replace("Dialogue: 0,0:00:01.00,0:00:04.00,Default,Bob,0,0,0,,{\\b1}Hello{\\b0}, there\\Nsecond\n", ""),
    );
    const { doc: next, key } = insertCue(doc, second.key);
    const out = serializeSubtitles(updateCue(next, key, { text: "Hi" }));
    expect(out).toBe(ASS + "Dialogue: 1,0:00:07.10,0:00:09.10,Sign,,0,0,0,,Hi\n");
  });

  it("adds a first cue to empty files", () => {
    let { doc, key } = insertCue(parseSubtitles("a.srt", ""), null);
    expect(serializeSubtitles(updateCue(doc, key, { text: "A" }))).toBe("1\n00:00:00,000 --> 00:00:02,000\nA\n");
    ({ doc, key } = insertCue(parseSubtitles("a.vtt", "WEBVTT\n"), null));
    expect(serializeSubtitles(updateCue(doc, key, { text: "A" }))).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA\n");
    const empty = ASS.split("Dialogue:")[0];
    ({ doc, key } = insertCue(parseSubtitles("a.ass", empty), null));
    expect(serializeSubtitles(updateCue(doc, key, { text: "A" }))).toBe(empty + "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,A\n");
  });

  it("shifts all or some cues, not below zero", () => {
    const doc = parseSubtitles("a.srt", SRT);
    const [first] = cuesOf(doc);
    expect(cuesOf(shiftCues(doc, null, -1500)).map((c) => c.start)).toEqual([0, 4000, 6500]);
    expect(cuesOf(shiftCues(doc, new Set([first.key]), 250)).map((c) => c.start)).toEqual([1250, 5500, 8000]);
  });
});

describe("checks and export", () => {
  it("flags overlaps, reversed times and fast lines", () => {
    const doc = parseSubtitles("a.srt", "1\n00:00:01,000 --> 00:00:03,000\nok\n\n2\n00:00:02,000 --> 00:00:02,500\nthis is far too much text for half a second\n\n3\n00:00:05,000 --> 00:00:04,000\nback\n");
    const cues = cuesOf(doc);
    const p = cueProblems(cues, "srt");
    expect(p.get(cues[0].key)).toBeUndefined();
    expect(p.get(cues[1].key)).toEqual([expect.stringMatching(/Too fast/), "Overlaps the line before"]);
    expect(p.get(cues[2].key)).toEqual(["Ends before it starts"]);
  });

  it("converts between formats", () => {
    expect(convertSubtitles(parseSubtitles("a.vtt", VTT), "srt")).toBe(
      "1\n00:00:01,000 --> 00:00:04,000\nHello <b>there</b>\nsecond line\n\n2\n00:00:05,500 --> 00:00:07,000\nNext\n",
    );
    expect(convertSubtitles(parseSubtitles("a.ass", ASS), "vtt")).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello, there\nsecond\n\n00:00:05.500 --> 00:00:07.000\nNext\n",
    );
  });
});
