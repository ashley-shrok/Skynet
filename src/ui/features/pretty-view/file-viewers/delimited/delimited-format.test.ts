import { describe, it, expect } from "vitest";
import { columnLetter, parseDelimited, serializeDelimited } from "./delimited-format";

const roundTrip = (text: string, name: string) => serializeDelimited(parseDelimited(text, name));

describe("parseDelimited", () => {
  it("detects a semicolon delimiter, CRLF, BOM and trailing newline", () => {
    const doc = parseDelimited('﻿a;b\r\n1;"x; y"\r\n', "data.csv");
    expect(doc.rows).toEqual([
      ["a", "b"],
      ["1", "x; y"],
    ]);
    expect(doc.format).toMatchObject({
      delimiter: ";",
      newline: "\r\n",
      bom: true,
      trailingNewline: true,
      quoteAll: false,
    });
  });

  it("uses tab for .tsv and pipe for .psv regardless of content", () => {
    expect(parseDelimited("a,b\tc\n", "x.tsv").rows).toEqual([["a,b", "c"]]);
    expect(parseDelimited("a,b|c\n", "x.psv").rows).toEqual([["a,b", "c"]]);
  });

  it("keeps quoted newlines and escaped quotes inside a cell", () => {
    const doc = parseDelimited('a,b\n"line1\nline2","say ""hi"""\n', "x.csv");
    expect(doc.rows[1]).toEqual(["line1\nline2", 'say "hi"']);
  });

  it("keeps ragged rows ragged", () => {
    expect(parseDelimited("a,b,c\n1\n", "x.csv").rows).toEqual([["a", "b", "c"], ["1"]]);
  });

  it("treats an empty file as no rows", () => {
    expect(parseDelimited("", "x.csv").rows).toEqual([]);
  });
});

describe("serializeDelimited", () => {
  it.each([
    ["comma, LF, trailing newline", "a,b\n1,2\n", "x.csv"],
    ["semicolon, CRLF, BOM", "﻿a;b\r\n1;\"x; y\"\r\n", "x.csv"],
    ["no trailing newline", "a,b\n1,2", "x.csv"],
    ["tab", "a\tb\n1\t2\n", "x.tsv"],
    ["pipe", "a|b\n1|2\n", "x.psv"],
    ["quote every field", '"a","b"\n"1","2"\n', "x.csv"],
    ["quoted newline and quotes", 'a,b\n"l1\nl2","say ""hi"""\n', "x.csv"],
  ])("round-trips %s unchanged", (_label, text, name) => {
    expect(roundTrip(text, name)).toBe(text);
  });

  it("an edit keeps the original format", () => {
    const doc = parseDelimited("﻿a;b\r\n1;2\r\n", "x.csv");
    doc.rows[1][1] = "two; 2";
    expect(serializeDelimited(doc)).toBe('﻿a;b\r\n1;"two; 2"\r\n');
  });

  it("only drops quotes that were never needed", () => {
    expect(roundTrip('a,b\n1,"plain"\n', "x.csv")).toBe("a,b\n1,plain\n");
  });

  it("never formula-escapes cell values", () => {
    const doc = parseDelimited("a\n=SUM(1)\n", "x.csv");
    expect(serializeDelimited(doc)).toBe("a\n=SUM(1)\n");
  });
});

describe("columnLetter", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("%i → %s", (i, letter) => {
    expect(columnLetter(i)).toBe(letter);
  });
});
