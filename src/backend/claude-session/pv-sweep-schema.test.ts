/**
 * pv-sweep-schema.test.ts — Unit tests for the Phase 95 v1 JSONL PV context-pct
 * sweep schema.
 *
 * Covers:
 *   - PV_SWEEP_SCHEMA_VERSION constant equals 1
 *   - Round-trip: hand-crafted JSONL blob → typed PvSweepLine array
 *   - Schema-version mismatch detection (per-line schema_version !== 1)
 *   - Malformed-line resilience (broken JSON skipped, good lines returned)
 *   - Unknown line_kind handling (forward-compat — increments unknownLines)
 *   - Empty blob → empty result
 *   - null context_pct survives round-trip
 *   - isPvSweepLineOfCurrentSchema shape validation (valid/missing/wrong-type/extra)
 *   - Wire-contract grep-guard: all 5 required field-name strings present in source
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  PV_SWEEP_SCHEMA_VERSION,
  parseSweepJsonl,
  isPvSweepLineOfCurrentSchema,
  type PvSweepLine,
} from "./pv-sweep-schema.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeLine(overrides: Partial<PvSweepLine> = {}): PvSweepLine {
  return {
    line_kind: "identity",
    schema_version: 1,
    identity: "tiffany",
    context_pct: 24,
    jsonl_path: "/home/ubuntu/.claude/projects/-home-ubuntu-skynet-tiffany/abc.jsonl",
    ...overrides,
  };
}

function makeJsonl(...lines: PvSweepLine[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

// ---------------------------------------------------------------------------
// Schema version constant
// ---------------------------------------------------------------------------

describe("PV_SWEEP_SCHEMA_VERSION", () => {
  it("is the literal number 1 (v1 wire contract)", () => {
    expect(PV_SWEEP_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isPvSweepLineOfCurrentSchema — narrow validator
// ---------------------------------------------------------------------------

describe("isPvSweepLineOfCurrentSchema", () => {
  it("accepts a valid identity line with non-null context_pct", () => {
    expect(isPvSweepLineOfCurrentSchema(makeLine())).toBe(true);
  });

  it("accepts a valid identity line with null context_pct", () => {
    expect(isPvSweepLineOfCurrentSchema(makeLine({ context_pct: null }))).toBe(true);
  });

  it("accepts a valid identity line with null jsonl_path", () => {
    expect(isPvSweepLineOfCurrentSchema(makeLine({ jsonl_path: null }))).toBe(true);
  });

  it("accepts a line with extra unknown fields (forward compat)", () => {
    const extraFields = { ...makeLine(), future_field: "value", another: 42 };
    expect(isPvSweepLineOfCurrentSchema(extraFields)).toBe(true);
  });

  it("rejects null", () => {
    expect(isPvSweepLineOfCurrentSchema(null)).toBe(false);
  });

  it("rejects a non-object (string)", () => {
    expect(isPvSweepLineOfCurrentSchema("not a line")).toBe(false);
  });

  it("rejects a non-object (number)", () => {
    expect(isPvSweepLineOfCurrentSchema(42)).toBe(false);
  });

  it("rejects when schema_version mismatches", () => {
    const bad = { ...makeLine(), schema_version: 999 };
    expect(isPvSweepLineOfCurrentSchema(bad)).toBe(false);
  });

  it("rejects when line_kind is missing", () => {
    const { line_kind: _lk, ...withoutKind } = makeLine();
    expect(isPvSweepLineOfCurrentSchema(withoutKind)).toBe(false);
  });

  it("rejects when line_kind is wrong type (not 'identity')", () => {
    const bad = { ...makeLine(), line_kind: "pid" };
    expect(isPvSweepLineOfCurrentSchema(bad)).toBe(false);
  });

  it("rejects when identity is missing", () => {
    const { identity: _id, ...withoutIdentity } = makeLine();
    expect(isPvSweepLineOfCurrentSchema(withoutIdentity)).toBe(false);
  });

  it("rejects when identity is non-string", () => {
    const bad = { ...makeLine(), identity: 123 };
    expect(isPvSweepLineOfCurrentSchema(bad)).toBe(false);
  });

  it("rejects when context_pct is a non-number, non-null value", () => {
    const bad = { ...makeLine(), context_pct: "24" };
    expect(isPvSweepLineOfCurrentSchema(bad)).toBe(false);
  });

  it("rejects when jsonl_path is a non-string, non-null value", () => {
    const bad = { ...makeLine(), jsonl_path: 42 };
    expect(isPvSweepLineOfCurrentSchema(bad)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — round-trip
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — round-trip", () => {
  it("parses a hand-crafted JSONL blob with 3 identity lines", () => {
    const l1 = makeLine({ identity: "tiffany", context_pct: 24 });
    const l2 = makeLine({ identity: "alice", context_pct: 67 });
    const l3 = makeLine({ identity: "zoeysephilya", context_pct: null });
    const blob = makeJsonl(l1, l2, l3);

    const result = parseSweepJsonl(blob);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toEqual(l1);
    expect(result.lines[1]).toEqual(l2);
    expect(result.lines[2]).toEqual(l3);
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("tolerates trailing newline (typical stdout shape)", () => {
    const l = makeLine();
    const blob = JSON.stringify(l) + "\n";
    const result = parseSweepJsonl(blob);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual(l);
  });

  it("tolerates blank lines between records", () => {
    const l1 = makeLine({ identity: "tiffany" });
    const l2 = makeLine({ identity: "alice" });
    const blob = [JSON.stringify(l1), "", JSON.stringify(l2), ""].join("\n");
    const result = parseSweepJsonl(blob);
    expect(result.lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — schema mismatch
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — schema mismatch", () => {
  it("sets schemaMismatch=true when ANY line has schema_version !== 1", () => {
    const good = makeLine({ identity: "tiffany" });
    const bad = { ...makeLine({ identity: "other" }), schema_version: 999 };
    const blob = [JSON.stringify(good), JSON.stringify(bad)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.schemaMismatch).toBe(true);
    // The good line is still parsed (schema_version check happens per-line;
    // the bad line is dropped but the good line is preserved)
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.lines.some((l) => l.identity === "tiffany")).toBe(true);
  });

  it("keeps schemaMismatch=false on a clean blob", () => {
    const blob = JSON.stringify(makeLine());
    expect(parseSweepJsonl(blob).schemaMismatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — malformed line resilience
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — malformed lines", () => {
  it("silently skips broken-JSON lines and still returns good lines", () => {
    const good = makeLine({ identity: "tiffany" });
    const blob = ["not-json{{{", JSON.stringify(good)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual(good);
    // Broken JSON is NOT counted as an "unknown line_kind" — it's discarded
    // pre-discrimination. unknownLines only counts JSON-parseable lines whose
    // line_kind is unrecognised.
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("never throws on arbitrary non-JSON input (error trace, bash prompt)", () => {
    const garbage = "bash: command not found\n$ ls\n/proc/sys/net/core: Permission denied";
    expect(() => parseSweepJsonl(garbage)).not.toThrow();
    const result = parseSweepJsonl(garbage);
    expect(result.lines).toHaveLength(0);
  });

  it("never throws on an empty string", () => {
    expect(() => parseSweepJsonl("")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — unknown line_kind (forward compat)
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — unknown line_kind", () => {
  it("increments unknownLines for JSON with an unrecognised line_kind, does NOT set schemaMismatch", () => {
    const good = makeLine({ identity: "tiffany" });
    const future = { line_kind: "future_type", schema_version: 1, identity: "other", data: "xyz" };
    const blob = [JSON.stringify(good), JSON.stringify(future)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual(good);
    expect(result.unknownLines).toBe(1);
    // schema_version matches — line_kind unknown is a soft forward-compat signal,
    // NOT a schema mismatch.
    expect(result.schemaMismatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — empty blob
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — empty blob", () => {
  it("returns empty result for an empty string", () => {
    expect(parseSweepJsonl("")).toEqual({
      lines: [],
      unknownLines: 0,
      schemaMismatch: false,
    });
  });

  it("returns empty result for whitespace-only input", () => {
    expect(parseSweepJsonl("\n\n  \n")).toEqual({
      lines: [],
      unknownLines: 0,
      schemaMismatch: false,
    });
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — null context_pct round-trip
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — null context_pct", () => {
  it("parses a line with context_pct: null correctly (JSON null → TS null)", () => {
    const line = makeLine({ context_pct: null });
    const blob = JSON.stringify(line);
    const result = parseSweepJsonl(blob);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].context_pct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wire-contract grep-guard
// ---------------------------------------------------------------------------

describe("pv-sweep-schema.ts wire-contract grep-guard", () => {
  it("source file contains all 5 required field-name string literals", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = resolve(here, "./pv-sweep-schema.ts");
    const body = readFileSync(src, "utf8");

    // These 5 field names must appear as string literals in the schema module.
    // A typo in the TS schema would silently drop data from the Python emitter;
    // this test catches at least the TS side's schema stability.
    const requiredFields = [
      "line_kind",
      "identity",
      "schema_version",
      "context_pct",
      "jsonl_path",
    ];

    for (const field of requiredFields) {
      expect(
        body.includes(`"${field}"`),
        `pv-sweep-schema.ts is missing field-name literal "${field}"`,
      ).toBe(true);
    }
  });
});
