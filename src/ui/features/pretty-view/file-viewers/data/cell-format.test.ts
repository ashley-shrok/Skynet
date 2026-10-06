import { describe, it, expect } from "vitest";
import { baseName, formatCell, isNumericValue } from "./cell-format";

describe("formatCell", () => {
  it("formats the value kinds data files produce", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(12n)).toBe("12");
    expect(formatCell(1.5)).toBe("1.5");
    expect(formatCell(true)).toBe("true");
    expect(formatCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(formatCell(new Uint8Array(1500))).toBe("‹binary, 1,500 bytes›");
    expect(formatCell({ a: 1n, b: [1, 2], c: new Uint8Array(3) })).toBe('{"a":"1","b":[1,2],"c":"<3 bytes>"}');
    expect(formatCell("x".repeat(3000))).toHaveLength(2001);
  });

  it("knows numbers and base names", () => {
    expect(isNumericValue(3)).toBe(true);
    expect(isNumericValue(3n)).toBe(true);
    expect(isNumericValue("3")).toBe(false);
    expect(baseName("dir/data.v2.parquet")).toBe("data.v2");
  });
});
