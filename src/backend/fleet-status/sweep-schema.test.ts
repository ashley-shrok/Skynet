/**
 * sweep-schema.test.ts — Unit tests for the Phase 92 v1 JSONL sweep schema.
 *
 * Covers:
 *   - SWEEP_SCHEMA_VERSION constant equals 1
 *   - Round-trip: hand-crafted JSONL blob → typed structure
 *   - Schema-version mismatch detection (per-line schema_version !== 1)
 *   - Malformed-line resilience (broken JSON skipped, good lines returned)
 *   - stat_result discriminated-union survives round-trip
 *   - Empty blob → empty result (matches "empty box, sweep exits 0 with empty stdout")
 *   - Parity map walk: every RESEARCH.md-enumerated exec site (A0/A1–A12, B0/B1–B5)
 *     is either declared as a schema field on a line type OR has a documented
 *     skipped_reason. This is the parity guarantee for Phase 92.
 */
import { describe, it, expect } from "vitest";
import {
  SWEEP_SCHEMA_VERSION,
  SWEEP_FIELD_PARITY,
  parseSweepJsonl,
  isSweepLineOfCurrentSchema,
  type SweepIdentityLine,
  type SweepPidLine,
} from "./sweep-schema.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeIdentityLine(
  overrides: Partial<SweepIdentityLine> = {},
): SweepIdentityLine {
  return {
    line_kind: "identity",
    schema_version: 1,
    identity: "tabitha",
    dormant: false,
    recycled_at: false,
    recycle_requested: false,
    jsonl_path: "/home/ubuntu/.claude/projects/-home-ubuntu/abcd-1234.jsonl",
    layer1_recycling: false,
    ...overrides,
  };
}

function makePidLine(overrides: Partial<SweepPidLine> = {}): SweepPidLine {
  return {
    line_kind: "pid",
    schema_version: 1,
    identity: "tabitha",
    pid: 12345,
    session_json:
      '{"pid":12345,"sessionId":"abc123","cwd":"/home/ubuntu","startedAt":1,"procStart":"53836667","version":"2.1.150","status":"idle","updatedAt":2}',
    stat_result: {
      ok: true,
      content:
        "12345 (claude) S 1 12345 12345 0 -1 4194304 1000 0 0 0 100 200 0 0 20 0 4 0 53836667 0 0 0",
    },
    per_session_stop_mtime_ms: 1728000000000,
    activity_mtime_ms: 1728000001000,
    stopped_mtime_ms: 1728000002000,
    per_session_stop_payload: null,
    dormant_a: false,
    jsonl_tail: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema version constant
// ---------------------------------------------------------------------------

describe("SWEEP_SCHEMA_VERSION", () => {
  it("is the literal number 1 (v1 wire contract)", () => {
    expect(SWEEP_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isSweepLineOfCurrentSchema — narrow validator
// ---------------------------------------------------------------------------

describe("isSweepLineOfCurrentSchema", () => {
  it("accepts a valid identity line", () => {
    expect(isSweepLineOfCurrentSchema(makeIdentityLine())).toBe(true);
  });

  it("accepts a valid pid line", () => {
    expect(isSweepLineOfCurrentSchema(makePidLine())).toBe(true);
  });

  it("rejects a null", () => {
    expect(isSweepLineOfCurrentSchema(null)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isSweepLineOfCurrentSchema("not a line")).toBe(false);
    expect(isSweepLineOfCurrentSchema(42)).toBe(false);
  });

  it("rejects when schema_version mismatches", () => {
    const bad = { ...makeIdentityLine(), schema_version: 999 };
    expect(isSweepLineOfCurrentSchema(bad)).toBe(false);
  });

  it("rejects when line_kind is unknown", () => {
    const bad = { ...makeIdentityLine(), line_kind: "mystery" };
    expect(isSweepLineOfCurrentSchema(bad)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSweepJsonl — round-trip & error handling
// ---------------------------------------------------------------------------

describe("parseSweepJsonl — round-trip", () => {
  it("parses a hand-crafted blob with one identity + two pid lines", () => {
    const id = makeIdentityLine();
    const p1 = makePidLine({ pid: 111 });
    const p2 = makePidLine({ pid: 222 });
    const blob = [id, p1, p2].map((x) => JSON.stringify(x)).join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.identityLines).toHaveLength(1);
    expect(result.identityLines[0]).toEqual(id);
    expect(result.pidLines).toHaveLength(2);
    expect(result.pidLines.map((l) => l.pid)).toEqual([111, 222]);
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("tolerates trailing newline (typical stdout shape)", () => {
    const id = makeIdentityLine();
    const blob = JSON.stringify(id) + "\n";
    const result = parseSweepJsonl(blob);
    expect(result.identityLines).toHaveLength(1);
    expect(result.pidLines).toHaveLength(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("tolerates blank lines between records", () => {
    const id = makeIdentityLine();
    const p = makePidLine();
    const blob = [JSON.stringify(id), "", JSON.stringify(p), ""].join("\n");
    const result = parseSweepJsonl(blob);
    expect(result.identityLines).toHaveLength(1);
    expect(result.pidLines).toHaveLength(1);
  });
});

describe("parseSweepJsonl — schema mismatch", () => {
  it("sets schemaMismatch=true when ANY line has schema_version !== 1", () => {
    const good = makeIdentityLine();
    // Wire-shape: an unrecognised schema version. The parser must still walk
    // every line to detect the mismatch, but callers treat this as a hard
    // "fall back to legacy" signal per CONTEXT.md Decisions § Output schema.
    const bad = { ...makeIdentityLine(), schema_version: 999, identity: "other" };
    const blob = [JSON.stringify(good), JSON.stringify(bad)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.schemaMismatch).toBe(true);
  });

  it("keeps schemaMismatch=false on a clean blob", () => {
    const blob = JSON.stringify(makeIdentityLine());
    expect(parseSweepJsonl(blob).schemaMismatch).toBe(false);
  });
});

describe("parseSweepJsonl — malformed lines", () => {
  it("silently skips broken-JSON lines and still returns good lines", () => {
    const good = makeIdentityLine();
    const blob = ["not-json{{{", JSON.stringify(good)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.identityLines).toHaveLength(1);
    expect(result.identityLines[0]).toEqual(good);
    // Broken JSON is NOT counted as an "unknown line_kind" — it's discarded
    // pre-discrimination. unknownLines only counts JSON-parseable lines whose
    // line_kind is unrecognised.
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("increments unknownLines for JSON with an unrecognised line_kind", () => {
    const good = makeIdentityLine();
    const mystery = { line_kind: "mystery", schema_version: 1 };
    const blob = [JSON.stringify(good), JSON.stringify(mystery)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.identityLines).toHaveLength(1);
    expect(result.unknownLines).toBe(1);
    // unknown line_kind at the CURRENT schema_version is not a mismatch — it's
    // a forward-compat marker (a future schema might add line kinds; parser
    // stays lenient and callers keep going).
    expect(result.schemaMismatch).toBe(false);
  });
});

describe("parseSweepJsonl — discriminated union round-trip", () => {
  it("preserves stat_result ok=true shape", () => {
    const p = makePidLine({
      stat_result: { ok: true, content: "12345 (claude) S ..." },
    });
    const result = parseSweepJsonl(JSON.stringify(p));
    expect(result.pidLines).toHaveLength(1);
    const back = result.pidLines[0].stat_result;
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.content).toBe("12345 (claude) S ...");
    }
  });

  it("preserves stat_result ok=false enoent shape", () => {
    const p = makePidLine({
      stat_result: { ok: false, reason: "enoent" },
    });
    const result = parseSweepJsonl(JSON.stringify(p));
    expect(result.pidLines[0].stat_result).toEqual({
      ok: false,
      reason: "enoent",
    });
  });

  it("preserves stat_result ok=false transport shape", () => {
    const p = makePidLine({
      stat_result: { ok: false, reason: "transport" },
    });
    const result = parseSweepJsonl(JSON.stringify(p));
    expect(result.pidLines[0].stat_result).toEqual({
      ok: false,
      reason: "transport",
    });
  });
});

describe("parseSweepJsonl — empty input", () => {
  it("returns an empty result for an empty string", () => {
    expect(parseSweepJsonl("")).toEqual({
      identityLines: [],
      pidLines: [],
      unknownLines: 0,
      schemaMismatch: false,
    });
  });

  it("returns an empty result for whitespace only", () => {
    expect(parseSweepJsonl("\n\n  \n")).toEqual({
      identityLines: [],
      pidLines: [],
      unknownLines: 0,
      schemaMismatch: false,
    });
  });
});

// ---------------------------------------------------------------------------
// SWEEP_FIELD_PARITY — every RESEARCH.md exec site is mapped or skipped
// ---------------------------------------------------------------------------

describe("SWEEP_FIELD_PARITY — parity map walk", () => {
  // The keys are the RESEARCH.md exec-inventory row labels:
  //   A0                       — per-host source-A enumeration driver
  //   A1..A12                  — per-PID source-A exec sites
  //   B0                       — per-host source-B enumeration driver
  //   B1..B5                   — per-identity source-B exec sites
  // Total: 2 + 12 + 5 = 19 keys.
  const EXPECTED_KEYS: readonly string[] = [
    "A0",
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "A8",
    "A9",
    "A10",
    "A11",
    "A12",
    "B0",
    "B1",
    "B2",
    "B3",
    "B4",
    "B5",
  ];

  it("covers every RESEARCH.md source-A / source-B row", () => {
    const actualKeys = Object.keys(SWEEP_FIELD_PARITY).sort();
    const expected = [...EXPECTED_KEYS].sort();
    expect(actualKeys).toEqual(expected);
  });

  it("every entry is either mapped to a line-type field or has a non-empty skipped_reason", () => {
    // Known fields on each line type — the source of truth for parity check.
    const identityFields = new Set<string>([
      "line_kind",
      "schema_version",
      "identity",
      "dormant",
      "recycled_at",
      "recycle_requested",
      "jsonl_path",
      "layer1_recycling",
    ]);
    const pidFields = new Set<string>([
      "line_kind",
      "schema_version",
      "identity",
      "pid",
      "session_json",
      "stat_result",
      "per_session_stop_mtime_ms",
      "activity_mtime_ms",
      "stopped_mtime_ms",
      "per_session_stop_payload",
      "dormant_a",
      "jsonl_tail",
    ]);
    const allFields = new Set<string>([...identityFields, ...pidFields]);

    for (const key of EXPECTED_KEYS) {
      const entry = SWEEP_FIELD_PARITY[key as keyof typeof SWEEP_FIELD_PARITY];
      if (entry.field !== null) {
        // Mapped: the declared field must actually exist on one of the line types.
        expect(
          allFields.has(entry.field),
          `parity row ${key}: field "${entry.field}" is not declared on any line type`,
        ).toBe(true);
      } else {
        // Skipped: must document why.
        expect(
          typeof entry.skipped_reason === "string" &&
            entry.skipped_reason.length > 0,
          `parity row ${key}: field is null but skipped_reason is missing/empty`,
        ).toBe(true);
      }
    }
  });

  it("A0 and B0 (enumeration drivers) are marked as skipped with a reason", () => {
    expect(SWEEP_FIELD_PARITY.A0.field).toBeNull();
    expect(SWEEP_FIELD_PARITY.A0.skipped_reason).toMatch(/enumeration/i);
    expect(SWEEP_FIELD_PARITY.B0.field).toBeNull();
    expect(SWEEP_FIELD_PARITY.B0.skipped_reason).toMatch(/enumeration/i);
  });

  it("A3 (box-wide last-stop-payload) is documented as skipped (per RESEARCH G9)", () => {
    expect(SWEEP_FIELD_PARITY.A3.field).toBeNull();
    expect(SWEEP_FIELD_PARITY.A3.skipped_reason).toBeTruthy();
  });

  it("A11 (per-PID JSONL discovery) is documented as skipped (folded into SweepIdentityLine.jsonl_path)", () => {
    expect(SWEEP_FIELD_PARITY.A11.field).toBeNull();
    expect(SWEEP_FIELD_PARITY.A11.skipped_reason).toBeTruthy();
  });

  it("A4 + A5 (PID→tmux resolution) are documented as skipped (resolved server-side into SweepPidLine.identity)", () => {
    expect(SWEEP_FIELD_PARITY.A4.field).toBeNull();
    expect(SWEEP_FIELD_PARITY.A4.skipped_reason).toBeTruthy();
    expect(SWEEP_FIELD_PARITY.A5.field).toBeNull();
    expect(SWEEP_FIELD_PARITY.A5.skipped_reason).toBeTruthy();
  });
});
