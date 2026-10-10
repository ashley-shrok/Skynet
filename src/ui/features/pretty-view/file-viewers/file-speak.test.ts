import { describe, it, expect, afterEach } from "vitest";
import {
  fileSpeakVoices,
  fileSpeechText,
  isSpeakableFile,
  markdownToSpeech,
  setFileSpeakVoice,
  splitForSpeech,
} from "./file-speak";

describe("isSpeakableFile", () => {
  it("accepts prose files only", () => {
    for (const f of ["notes.md", "README.MD", "a.markdown", "log.txt", "x.text", "/abs/path/doc.md"]) {
      expect(isSpeakableFile(f)).toBe(true);
    }
    for (const f of ["data.json", "app.ts", "config.yaml", "Makefile", ".md", "image.png"]) {
      expect(isSpeakableFile(f)).toBe(false);
    }
  });
});

describe("markdownToSpeech", () => {
  it("strips markdown syntax and keeps the readable text", () => {
    const md = [
      "---",
      "title: x",
      "---",
      "# Heading One",
      "",
      "Some **bold** and *italic* and `code` with a [link](https://example.com).",
      "",
      "![alt](img.png)",
      "- item one",
      "1. item two",
      "- [x] done task",
      "> quoted",
      "",
      "```ts",
      "const hidden = 1;",
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "---",
      "~~gone~~ <b>tag</b> <!-- comment -->",
    ].join("\n");
    const out = markdownToSpeech(md);
    expect(out).toContain("Heading One.");
    expect(out).toContain("Some bold and italic and code with a link.");
    expect(out).toContain("item one\nitem two\ndone task\nquoted");
    expect(out).toContain("A, B\n1, 2");
    expect(out).toContain("gone tag");
    for (const bad of ["#", "**", "`", "https://", "img.png", "hidden", "title:", "|", "<b>", "comment", "~~"]) {
      expect(out).not.toContain(bad);
    }
  });

  it("drops an unterminated code fence to the end", () => {
    expect(markdownToSpeech("Before.\n\n```\ncode forever")).toBe("Before.");
  });

  it("skips indented code fences, URLs, rules and setext underlines", () => {
    const md = [
      "1. Step one",
      "   ```sh",
      "   hidden command",
      "   ```",
      "See <https://a.example/x> and https://b.example/y_z now.",
      "",
      "- - -",
      "* * *",
      "Title",
      "=====",
      "Next",
    ].join("\n");
    const out = markdownToSpeech(md);
    expect(out).toBe("Step one\n\nSee  and  now.\n\nTitle\n\nNext");
  });

  it("keeps heading punctuation, generics and mid-word underscores", () => {
    expect(markdownToSpeech("## What is it?")).toBe("What is it?");
    expect(markdownToSpeech("Use List<T> here")).toBe("Use List<T> here");
    expect(markdownToSpeech("call `__init__` and some__thing")).toBe("call __init__ and some__thing");
    expect(markdownToSpeech("some __bold__ and _em_ text")).toBe("some bold and em text");
  });

  it("leaves snake_case words intact", () => {
    expect(markdownToSpeech("use some_var_name here")).toBe("use some_var_name here");
  });
});

describe("fileSpeechText", () => {
  it("only rewrites markdown files", () => {
    expect(fileSpeechText("a.md", "# Hi")).toBe("Hi.");
    expect(fileSpeechText("a.txt", "  # Hi  ")).toBe("# Hi");
  });
});

describe("splitForSpeech", () => {
  it("returns one piece when under the cap", () => {
    expect(splitForSpeech("short text", 100)).toEqual(["short text"]);
    expect(splitForSpeech("   ", 100)).toEqual([]);
  });

  it("prefers paragraph breaks, then sentence ends, then spaces, never exceeding the cap", () => {
    const para = `${"a".repeat(60)}\n\n${"b".repeat(60)}`;
    expect(splitForSpeech(para, 100)).toEqual(["a".repeat(60), "b".repeat(60)]);

    const sentences = `${"word ".repeat(12)}end. ${"more ".repeat(12)}`;
    const pieces = splitForSpeech(sentences, 80);
    expect(pieces[0].endsWith("end.")).toBe(true);

    const long = "word ".repeat(1000);
    const split = splitForSpeech(long, 97);
    expect(split.every((p) => p.length <= 97)).toBe(true);
    expect(split.join(" ")).toBe(long.trim());

    const noSpaces = "x".repeat(250);
    expect(splitForSpeech(noSpaces, 100)).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });
});

describe("fileSpeakVoices", () => {
  afterEach(() => setFileSpeakVoice(null));
  it("is the fallback voice, else empty (provider default)", () => {
    expect(fileSpeakVoices()).toEqual([]);
    setFileSpeakVoice("marin");
    expect(fileSpeakVoices()).toEqual(["marin"]);
    setFileSpeakVoice("");
    expect(fileSpeakVoices()).toEqual([]);
  });
});
