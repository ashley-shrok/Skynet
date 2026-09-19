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
  type SweepAppLine,
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

// Phase 118 Plan 118-02: SweepAppLine fixture. Defaults describe a healthy
// scratch-app on port 9591 with no icon. Callers override any field to exercise
// the D-01 / D-02 / D-05 / D-06 corner cases. Spread `overrides` LAST so any
// field (including line_kind or schema_version) can be flipped for negative
// tests without editing this helper.
function makeAppLine(overrides: Partial<SweepAppLine> = {}): SweepAppLine {
  return {
    line_kind: "app",
    schema_version: 1,
    slug: "test-app",
    title: "Test App",
    description: "A test app",
    port: 9591,
    has_icon: false,
    created_at_ms: 1_700_000_000_000,
    is_healthy: true,
    health_message: null,
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
    // Phase 118 Plan 118-02: SweepParseResult now includes `appLines` — the
    // empty-input fast-path returns [] alongside the existing empty arrays.
    expect(parseSweepJsonl("")).toEqual({
      identityLines: [],
      pidLines: [],
      appLines: [],
      unknownLines: 0,
      schemaMismatch: false,
    });
  });

  it("returns an empty result for whitespace only", () => {
    // Phase 118 Plan 118-02: SweepParseResult now includes `appLines` — the
    // whitespace-only walk path also returns [] alongside the existing arrays.
    expect(parseSweepJsonl("\n\n  \n")).toEqual({
      identityLines: [],
      pidLines: [],
      appLines: [],
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
  //   B1..B9                   — per-identity source-B exec sites
  //   C0                       — per-host source-C enumeration driver (Phase 118)
  //   C1..C8                   — per-app source-C fields (D-05 + D-03 carve-out)
  // Total: 2 + 12 + 9 + 1 + 8 = 32 keys.
  // (B6..B8 added by Plan 111-01/111-02: appearance fields on SweepIdentityLine.
  //  Plan 111-02 also added B9 for `.hidden`; Phase 115 Plan 115-02 retired
  //  the `.hidden` code path per D-21 (freeing the B9 slot); Phase 115 Plan
  //  115-05 reused the freed B9 slot for the `archived` axis. Phase 118 Plan
  //  118-02 added C0..C8 for the source-C app enumeration wire fields.)
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
    "B6",
    "B7",
    "B8",
    "B9",
    "C0",
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
    "C8",
  ];

  it("covers every RESEARCH.md source-A / source-B / source-C row", () => {
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
      // Phase 111 Plan 111-01/111-02 appearance fields:
      "role",
      "identity_cosmetics",
      "role_cosmetics",
      "pinned",
      // Phase 115 Plan 115-05: archived axis (reuses freed B9 slot).
      "archived",
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
    // Phase 118 Plan 118-02: source-C app enumeration fields (D-05 seven fields
    // + D-03 carve-out). Byte-name parity with Python `_build_app_line`.
    const appFields = new Set<string>([
      "line_kind",
      "schema_version",
      "slug",
      "title",
      "description",
      "port",
      "has_icon",
      "created_at_ms",
      "is_healthy",
      "health_message",
    ]);
    const allFields = new Set<string>([
      ...identityFields,
      ...pidFields,
      ...appFields,
    ]);

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

// ---------------------------------------------------------------------------
// Phase 111 Plan 111-01/111-02: mid-distribution older-box case
// ---------------------------------------------------------------------------
//
// When the Plan 111-01 sweep script has NOT yet been distributed to a box,
// that box emits identity lines WITHOUT the appearance fields (role,
// identity_cosmetics, role_cosmetics, pinned). The parser must:
// (Phase 115 Plan 115-02: `hidden` retired from the appearance field list per D-21.)
//   (a) not set schemaMismatch (schema_version is still 1)
//   (b) return BOTH lines (the carrying line and the omitting line)
//   (c) the carrying line's identity_cosmetics is readable
//   (d) the omitting line's identity_cosmetics is strictly undefined
//
// This is the rollout safety test: a mixed fleet (some boxes updated,
// some not) must not cause parse failures or dropped lines.

// ---------------------------------------------------------------------------
// Phase 115 Plan 115-05: `archived?: boolean` on SweepIdentityLine
// ---------------------------------------------------------------------------
//
// Plan 115-05 adds an `archived` axis to SweepIdentityLine — sourced from the
// disk-root (live tree = false, archive tree = true) rather than from any
// sentinel file. Reuses the B9 wire slot vacated by Plan 115-02 when `.hidden`
// was retired per D-21.
//
// The field is optional (?: not required) so mid-distribution older boxes
// (running the pre-115-05 sweep script that walks only the live tree and
// emits neither hidden nor archived) still parse without error.

describe("Phase 115 Plan 115-05: SweepIdentityLine.archived", () => {
  it("parses an identity line with archived: true (archive-tree row)", () => {
    const line = {
      line_kind: "identity",
      schema_version: 1,
      identity: "gamma",
      dormant: false,
      recycled_at: false,
      recycle_requested: false,
      jsonl_path: null,
      layer1_recycling: null,
      pinned: false,
      archived: true,
    };
    const result = parseSweepJsonl(JSON.stringify(line));
    expect(result.identityLines).toHaveLength(1);
    expect(result.identityLines[0].archived).toBe(true);
    expect(result.schemaMismatch).toBe(false);
  });

  it("parses an identity line with archived: false (live-tree row)", () => {
    const line = makeIdentityLine({ archived: false });
    const result = parseSweepJsonl(JSON.stringify(line));
    expect(result.identityLines).toHaveLength(1);
    expect(result.identityLines[0].archived).toBe(false);
  });

  it("parses an identity line WITHOUT the archived field (older-box case)", () => {
    // A mid-distribution box that hasn't picked up Plan 115-05's sweep script
    // yet emits identity lines that omit `archived` entirely. Must parse
    // cleanly — the field is optional, and older-box tolerance matches the
    // established pattern for the Plan 111-01 appearance fields.
    const line = {
      line_kind: "identity",
      schema_version: 1,
      identity: "tabitha",
      dormant: false,
      recycled_at: false,
      recycle_requested: false,
      jsonl_path: null,
      layer1_recycling: null,
      // No `archived` field.
    };
    const result = parseSweepJsonl(JSON.stringify(line));
    expect(result.identityLines).toHaveLength(1);
    expect(result.identityLines[0].archived).toBeUndefined();
    expect(result.schemaMismatch).toBe(false);
  });

  it("SWEEP_FIELD_PARITY has a B9 entry pointing at `archived`", () => {
    // 115-05 reuses the freed B9 slot (115-02 retired `.hidden` at B9).
    // The parity walk asserts that every B* key maps to a real field on
    // SweepIdentityLine — this test locks the specific slot ID for the
    // archived axis, which is a load-bearing rendezvous point between the
    // Python emitter and TS parser.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parity = SWEEP_FIELD_PARITY as any;
    expect(parity.B9).toBeDefined();
    expect(parity.B9.field).toBe("archived");
  });
});

describe("Phase 111 mid-distribution: older-box line (no appearance keys) parses cleanly", () => {
  it("one line carrying appearance + one line omitting appearance — both parse, schemaMismatch=false", () => {
    // A newer box emits the full line with appearance keys.
    const carryingLine = {
      line_kind: "identity",
      schema_version: 1,
      identity: "pixel",
      dormant: false,
      recycled_at: false,
      recycle_requested: false,
      jsonl_path: "/home/ubuntu/.claude/projects/abcd.jsonl",
      layer1_recycling: false,
      role: "box-maintainer",
      identity_cosmetics: { displayName: "Pixel", task: "Building things" },
      role_cosmetics: { title: "Skynet", colorHue: 324 },
      pinned: false,
    };

    // An older box (pre-Plan-111-01 distribution) emits without appearance keys.
    const omittingLine = {
      line_kind: "identity",
      schema_version: 1,
      identity: "tabitha",
      dormant: false,
      recycled_at: false,
      recycle_requested: false,
      jsonl_path: null,
      layer1_recycling: null,
      // No role, identity_cosmetics, role_cosmetics, pinned keys.
    };

    const blob = [carryingLine, omittingLine]
      .map((x) => JSON.stringify(x))
      .join("\n");

    const result = parseSweepJsonl(blob);

    // Schema mismatch must be false — both lines carry schema_version: 1.
    expect(result.schemaMismatch).toBe(false);

    // Both identity lines must be present.
    expect(result.identityLines).toHaveLength(2);

    // Find the carrying and omitting lines.
    const carrying = result.identityLines.find((l) => l.identity === "pixel");
    const omitting = result.identityLines.find((l) => l.identity === "tabitha");
    expect(carrying).toBeDefined();
    expect(omitting).toBeDefined();

    // The carrying line's identity_cosmetics must be readable.
    expect(carrying!.identity_cosmetics).toEqual({
      displayName: "Pixel",
      task: "Building things",
    });
    expect(carrying!.role).toBe("box-maintainer");
    expect(carrying!.role_cosmetics).toEqual({ title: "Skynet", colorHue: 324 });
    expect(carrying!.pinned).toBe(false);

    // The omitting line's identity_cosmetics must be strictly undefined (not null,
    // not an empty object — just absent from the line entirely).
    expect(omitting!.identity_cosmetics).toBeUndefined();
    expect(omitting!.role).toBeUndefined();
    expect(omitting!.role_cosmetics).toBeUndefined();
    expect(omitting!.pinned).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 118 Plan 118-02: SweepAppLine dispatch + type-guard + parity extension
// ---------------------------------------------------------------------------
//
// Plan 118-02 extends sweep-schema.ts with a `line_kind: "app"` line kind that
// mirrors the Python side landed by 118-01. Additive-only: identity + pid
// paths must stay green. Byte-name parity with the Python emit dict is the
// wire contract this test block pins (D-05 seven fields at snake_case).

describe("Phase 118 Plan 118-02: SweepAppLine dispatch", () => {
  it("app line dispatch — parseSweepJsonl pushes a well-formed app line into appLines", () => {
    const app = makeAppLine({ slug: "todo" });
    const result = parseSweepJsonl(JSON.stringify(app));

    expect(result.appLines).toHaveLength(1);
    expect(result.appLines[0]).toEqual(app);
    expect(result.appLines[0].slug).toBe("todo");
    expect(result.appLines[0].line_kind).toBe("app");
    expect(result.appLines[0].schema_version).toBe(1);
    expect(result.appLines[0].title).toBe("Test App");
    expect(result.appLines[0].description).toBe("A test app");
    expect(result.appLines[0].port).toBe(9591);
    expect(result.appLines[0].has_icon).toBe(false);
    expect(result.appLines[0].created_at_ms).toBe(1_700_000_000_000);
    expect(result.appLines[0].is_healthy).toBe(true);
    expect(result.appLines[0].health_message).toBeNull();
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
    // Identity + pid buckets stay empty on an app-only blob.
    expect(result.identityLines).toHaveLength(0);
    expect(result.pidLines).toHaveLength(0);
  });

  it("mixed dispatch — identity + pid + app lines all land in their buckets (regression guard)", () => {
    // Regression guard for the additive extension: adding the `app` case
    // must NOT break the identity or pid dispatch. All three buckets
    // populate from a single blob.
    const id = makeIdentityLine({ identity: "the user" });
    const pid = makePidLine({ pid: 999, identity: "the user" });
    const app = makeAppLine({ slug: "vision" });
    const blob = [id, pid, app].map((x) => JSON.stringify(x)).join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.identityLines).toHaveLength(1);
    expect(result.pidLines).toHaveLength(1);
    expect(result.appLines).toHaveLength(1);
    expect(result.appLines[0].slug).toBe("vision");
    expect(result.identityLines[0].identity).toBe("the user");
    expect(result.pidLines[0].pid).toBe(999);
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("schema mismatch on app — app line at wrong schema_version flips schemaMismatch and does NOT push into appLines", () => {
    // Mirrors the identity schema-mismatch path — the app dispatch must
    // respect the parser's existing "schemaMismatch flag, drop the line"
    // discipline (sweep-schema.ts:301-305). It must NOT sneak into appLines
    // just because line_kind matches.
    const bad = makeAppLine({ slug: "wrong-version" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wire = { ...bad, schema_version: 999 as any };
    const result = parseSweepJsonl(JSON.stringify(wire));

    expect(result.schemaMismatch).toBe(true);
    expect(result.appLines).toHaveLength(0);
    // No collateral damage on the other buckets.
    expect(result.identityLines).toHaveLength(0);
    expect(result.pidLines).toHaveLength(0);
  });

  it("unknown line_kind — banana line at schema_version 1 still bumps unknownLines (forward-compat regression)", () => {
    // The `app` dispatch is inserted BEFORE the `else { unknownLines += 1 }`
    // branch. This test proves the forward-compat branch still fires for
    // truly-unknown kinds, mixed alongside a valid app line.
    const app = makeAppLine({ slug: "real-app" });
    const banana = { line_kind: "banana", schema_version: 1, slug: "fake" };
    const blob = [JSON.stringify(app), JSON.stringify(banana)].join("\n");

    const result = parseSweepJsonl(blob);

    expect(result.appLines).toHaveLength(1);
    expect(result.appLines[0].slug).toBe("real-app");
    expect(result.unknownLines).toBe(1);
    expect(result.schemaMismatch).toBe(false);
  });

  it("isSweepLineOfCurrentSchema app — accepts app at schema_version 1, rejects other versions", () => {
    // Well-formed app line at current schema — the widened type guard MUST
    // accept it so downstream `switch(line.line_kind)` code stays exhaustive.
    expect(
      isSweepLineOfCurrentSchema({
        line_kind: "app",
        schema_version: 1,
        slug: "ok",
      }),
    ).toBe(true);

    // Wrong schema version — the schema_version check ABOVE the line_kind
    // check must still gate this out. Regression guard for the ordering of
    // the two checks (schema first, then kind).
    expect(
      isSweepLineOfCurrentSchema({
        line_kind: "app",
        schema_version: 2,
        slug: "future-schema",
      }),
    ).toBe(false);

    // Missing schema_version entirely — same gate, different failure mode.
    expect(
      isSweepLineOfCurrentSchema({ line_kind: "app", slug: "no-version" }),
    ).toBe(false);
  });

  it("empty input appLines — parseSweepJsonl('') defaults appLines to []", () => {
    // The extended SweepParseResult must always carry an `appLines` array,
    // even in the fast-path empty-string branch (sweep-schema.ts:276-278).
    // Consumers destructuring `parsed.appLines` must never see undefined.
    const result = parseSweepJsonl("");
    expect(result.appLines).toEqual([]);
    expect(result.identityLines).toEqual([]);
    expect(result.pidLines).toEqual([]);
    expect(result.unknownLines).toBe(0);
    expect(result.schemaMismatch).toBe(false);
  });

  it("app line dispatch is lenient — an app line missing `slug` still parses (does not throw)", () => {
    // Plan 118-02 action (e): the app dispatch matches the identity + pid
    // lenience discipline — cast, no runtime validation. A malformed app
    // line (missing required `slug`) is still pushed into appLines with
    // whatever shape it has; downstream consumers (118-04 adapter → 118-03
    // Zod schema) are the runtime validation gate. Critical: parser MUST
    // NOT throw. This test pins the "never throws" invariant explicitly.
    const wire = {
      line_kind: "app",
      schema_version: 1,
      // No slug — deliberately malformed.
      title: "Malformed",
      description: "Missing slug",
      port: null,
      has_icon: false,
      created_at_ms: 0,
      is_healthy: true,
      health_message: null,
    };

    expect(() => parseSweepJsonl(JSON.stringify(wire))).not.toThrow();
    const result = parseSweepJsonl(JSON.stringify(wire));
    // Lenient discipline: the line lands in appLines with its incomplete
    // shape. Runtime validation is downstream's problem (defense in depth).
    expect(result.appLines).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result.appLines[0] as any).slug).toBeUndefined();
    expect(result.schemaMismatch).toBe(false);
    expect(result.unknownLines).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 118 Plan 118-02: SWEEP_FIELD_PARITY C-row extension
// ---------------------------------------------------------------------------
//
// Plan 118-02 chose to extend SWEEP_FIELD_PARITY with C0..C7 entries covering
// the seven D-05 app fields. The parity table's type-safety benefit is real
// (PATTERNS § 2 recommended extending over adding a bare docblock). Keys:
//   C0 — per-host source-C enumeration driver (~/fleet/apps/*/ scandir), skipped
//   C1 — slug            → SweepAppLine.slug
//   C2 — title           → SweepAppLine.title
//   C3 — description     → SweepAppLine.description
//   C4 — port            → SweepAppLine.port
//   C5 — has_icon        → SweepAppLine.has_icon
//   C6 — created_at_ms   → SweepAppLine.created_at_ms
//   C7 — is_healthy      → SweepAppLine.is_healthy
//   C8 — health_message  → SweepAppLine.health_message
//
// (C1..C8 cover all seven emitted fields plus health_message which is the
// D-03 optional carve-out; C0 is the enumeration driver following the
// A0/B0 precedent.)

describe("Phase 118 Plan 118-02: SWEEP_FIELD_PARITY C-row coverage", () => {
  it("C0 is the source-C enumeration driver, marked skipped", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parity = SWEEP_FIELD_PARITY as any;
    expect(parity.C0).toBeDefined();
    expect(parity.C0.field).toBeNull();
    expect(parity.C0.skipped_reason).toMatch(/enumeration/i);
  });

  it("C1..C8 map to real SweepAppLine fields (byte-name parity with Python emit)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parity = SWEEP_FIELD_PARITY as any;
    const expected: Record<string, string> = {
      C1: "slug",
      C2: "title",
      C3: "description",
      C4: "port",
      C5: "has_icon",
      C6: "created_at_ms",
      C7: "is_healthy",
      C8: "health_message",
    };
    for (const [key, field] of Object.entries(expected)) {
      expect(parity[key], `parity row ${key} missing`).toBeDefined();
      expect(
        parity[key].field,
        `parity row ${key} should map to ${field}`,
      ).toBe(field);
    }
  });
});
