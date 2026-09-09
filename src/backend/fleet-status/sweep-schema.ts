/**
 * sweep-schema.ts — v1 JSONL wire contract for the Phase 92 fleet-status batch sweep.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  WHY TWO-TIER (SweepIdentityLine + SweepPidLine), NOT ONE-LINE-PER-ID?  │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  The current poller has TWO keying axes:                                │
 * │    • Source A is PID-keyed  (iterates ~/.claude/sessions/*.json).       │
 * │    • Source B is identity-keyed (iterates ~/.claude/identities/*).      │
 * │  A single flat "one line per identity" shape would (a) force null-pad-  │
 * │  ding of the PID axis for identities with no live claude process, and   │
 * │  (b) force array-nesting when one identity has multiple live PIDs (rare │
 * │  but real — coordinator identities can run parallel claude sessions).   │
 * │  Two-tier keeps each JSONL line flat, matches the caller's own internal │
 * │  decomposition (livenessMap keyed by PID, identityRecycleState keyed    │
 * │  by identity), and keeps the wire small. Rows are joined by `identity`. │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Every line carries `schema_version: 1` and a `line_kind` discriminator so the
 * parser can dispatch. The parser is deliberately LENIENT (never throws): a
 * single malformed line is discarded, mismatched schema_version is REPORTED on
 * the result (not thrown), and the caller — not the parser — owns the "fall
 * back to legacy plumbing" policy (see RESEARCH.md § Backward-compat).
 *
 * Consumers:
 *   - Plan 02: substrate/scripts/fleet-status-sweep.py — emits lines with these
 *     exact field names + shapes (contract enforced by parser tests here).
 *   - Plan 04: ssh-poll-orchestrator.ts — imports parseSweepJsonl +
 *     SWEEP_SCHEMA_VERSION; wires the fallback branch when schemaMismatch=true.
 *   - Plan 05: regression tests — use these types + parser as fixtures.
 */

// ---------------------------------------------------------------------------
// Schema version constant
// ---------------------------------------------------------------------------

/**
 * The current wire schema version. Bump on any breaking field-name / field-
 * shape change. Consumers compare their expected version against every line's
 * `schema_version`; mismatch triggers the caller's fall-back-to-legacy branch.
 */
export const SWEEP_SCHEMA_VERSION = 1 as const;
export type SweepSchemaVersion = typeof SWEEP_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Stat-result discriminated union — mirrors StatReadResult in ssh-poll-orchestrator.ts
// ---------------------------------------------------------------------------

/**
 * Server-side stat outcome for a per-PID `/proc/<pid>/stat` read. MUST match
 * the shape of `StatReadResult` in ssh-poll-orchestrator.ts so the caller can
 * feed it into `isStaleFromStat` unchanged (Bounty 9c8d4a72 fix — distinguish
 * transport failure from real PID-dead ENOENT).
 *
 * The sweep script (Plan 02) is responsible for classifying the read outcome
 * server-side and emitting one of these three shapes verbatim. The caller
 * does NOT re-classify — the wire IS the classification.
 */
export type SweepStatResult =
  | { ok: true; content: string }
  | { ok: false; reason: "enoent" | "transport" };

// ---------------------------------------------------------------------------
// SweepIdentityLine — one per identity folder under ~/.claude/identities/
// ---------------------------------------------------------------------------

/**
 * Source-B parity — one JSONL line per identity name emitted by the sweep
 * script's server-side enumeration of subdirectories under `~/.claude/identities/`.
 *
 * Field ↔ RESEARCH.md exec-site parity (see SWEEP_FIELD_PARITY):
 *   • dormant           ↔ B1 (`.dormant` sentinel present)
 *   • recycled_at       ↔ B2 (`.recycled-at` sentinel present)
 *   • recycle_requested ↔ B3 (`.recycle-requested` sentinel present)
 *   • jsonl_path        ↔ B4 (Phase 32 discovery result, null when no match)
 *   • layer1_recycling  ↔ B5 (tail-scan verdict; null = tail unreadable this
 *                          tick, caller preserves cached value — fail-open)
 */
export interface SweepIdentityLine {
  line_kind: "identity";
  schema_version: SweepSchemaVersion;
  identity: string;
  dormant: boolean;
  recycled_at: boolean;
  recycle_requested: boolean;
  jsonl_path: string | null;
  layer1_recycling: boolean | null;
}

// ---------------------------------------------------------------------------
// SweepPidLine — one per live claude PID discovered under ~/.claude/sessions/*.json
// ---------------------------------------------------------------------------

/**
 * Source-A parity — one JSONL line per live claude PID emitted by the sweep
 * script's server-side enumeration of `~/.claude/sessions/*.json`.
 *
 * Field ↔ RESEARCH.md exec-site parity (see SWEEP_FIELD_PARITY):
 *   • identity                 ↔ A4+A5 folded server-side (PID → tmux pane →
 *                                tmux session name = identity). Replaces the
 *                                two-exec `resolvePidToTmuxSession` fan-out.
 *   • pid                      ↔ A0 (PID lifted from filename)
 *   • session_json             ↔ A1 (~/.claude/sessions/<pid>.json contents;
 *                                null when file missing/unreadable; caller
 *                                still runs parseSessionJson unchanged)
 *   • stat_result              ↔ A2 (discriminated union — see SweepStatResult)
 *   • per_session_stop_mtime_ms ↔ A6 (Phase 59 `stop-<sid>.json` mtime → ms)
 *   • activity_mtime_ms         ↔ A7 (Phase 62 `activity` marker mtime → ms)
 *   • stopped_mtime_ms          ↔ A8 (Phase 62 `stopped` marker mtime → ms)
 *   • per_session_stop_payload  ↔ A9 (per-session Stop payload; null when
 *                                absent; caller runs parseStopHookPayload
 *                                unchanged)
 *   • dormant_a                 ↔ A10 (dormant sentinel probed via source-A
 *                                path; equal to SweepIdentityLine.dormant in
 *                                the common case per RESEARCH G7, but kept
 *                                as a distinct field so the caller's dual-
 *                                frame code path in Plan 04 stays byte-for-
 *                                byte unchanged)
 *   • jsonl_tail                ↔ A12 (up-to-256KB tail of the identity's
 *                                active JSONL for the ai-title scan; null
 *                                when path unknown/unreadable; caller runs
 *                                scanTailForLatestAiTitle unchanged)
 *
 * G6 note (safe-char guard): sessionIds failing the /^[a-zA-Z0-9_-]+$/ regex
 * cause the server-side script to emit null for per_session_stop_mtime_ms,
 * activity_mtime_ms, stopped_mtime_ms, and per_session_stop_payload — matches
 * the caller's existing fail-open contract for path-traversal defense.
 */
export interface SweepPidLine {
  line_kind: "pid";
  schema_version: SweepSchemaVersion;
  identity: string;
  pid: number;
  session_json: string | null;
  stat_result: SweepStatResult;
  per_session_stop_mtime_ms: number | null;
  activity_mtime_ms: number | null;
  stopped_mtime_ms: number | null;
  per_session_stop_payload: string | null;
  dormant_a: boolean;
  jsonl_tail: string | null;
}

// ---------------------------------------------------------------------------
// Union + narrow validator
// ---------------------------------------------------------------------------

export type SweepLine = SweepIdentityLine | SweepPidLine;

/**
 * Narrow type-guard used by parseSweepJsonl (and available to tests). Returns
 * true only when `obj` is a plain object with the current schema_version AND a
 * recognised line_kind. Deliberately does NOT deep-validate every field — the
 * parser's job is "shape it enough for the caller"; the caller's own consumers
 * (parseSessionJson, parseStopHookPayload, isStaleFromStat) handle deeper
 * validation of the payload fields.
 */
export function isSweepLineOfCurrentSchema(obj: unknown): obj is SweepLine {
  if (obj === null || typeof obj !== "object") return false;
  const rec = obj as Record<string, unknown>;
  if (rec.schema_version !== SWEEP_SCHEMA_VERSION) return false;
  return rec.line_kind === "identity" || rec.line_kind === "pid";
}

// ---------------------------------------------------------------------------
// parseSweepJsonl — the lenient parser
// ---------------------------------------------------------------------------

export interface SweepParseResult {
  identityLines: SweepIdentityLine[];
  pidLines: SweepPidLine[];
  /**
   * Count of JSON-parseable lines whose `line_kind` was neither "identity"
   * nor "pid". Observability only; not a failure signal — the parser stays
   * forward-compatible if a future schema adds line kinds.
   */
  unknownLines: number;
  /**
   * True iff ANY successfully-JSON-parsed line carried `schema_version !== 1`.
   *
   * SCHEMA_VERSION_MISMATCH_FALLBACK: Plan 04 wires this flag to the "fall
   * back to legacy plumbing this cycle" branch (mirroring the perSessionUsable
   * pattern at ssh-poll-orchestrator.ts L1770–L1790). The parser deliberately
   * does not throw — the caller, not the parser, owns the fallback policy per
   * RESEARCH.md § Backward-compat.
   */
  schemaMismatch: boolean;
}

/**
 * Parse a raw JSONL blob (one JSON object per line) emitted by the sweep
 * script into typed identity + pid buckets.
 *
 * Contract:
 *   - Splits on \n, trims empty lines.
 *   - Each line goes through JSON.parse in a try/catch: broken JSON is
 *     silently discarded (a single garbled line MUST NOT fail the batch,
 *     matches "prefer sweep, fall back to legacy" contract).
 *   - Successfully parsed objects with `schema_version !== 1` flip
 *     `schemaMismatch` to true but are otherwise dropped.
 *   - Objects with a known line_kind land in the appropriate bucket; objects
 *     with an unrecognised line_kind increment `unknownLines`.
 *   - NEVER throws.
 */
export function parseSweepJsonl(raw: string): SweepParseResult {
  const identityLines: SweepIdentityLine[] = [];
  const pidLines: SweepPidLine[] = [];
  let unknownLines = 0;
  let schemaMismatch = false;

  if (raw === "") {
    return { identityLines, pidLines, unknownLines, schemaMismatch };
  }

  for (const rawLine of raw.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Malformed JSON: silently discard. This matches the "single bad line
      // must not fail the batch" contract; observability lives in the sweep
      // script's own logging, not here.
      continue;
    }

    if (parsed === null || typeof parsed !== "object") {
      // JSON-legal but not an object (e.g. a bare number or string). Discard.
      continue;
    }

    const rec = parsed as Record<string, unknown>;

    if (rec.schema_version !== SWEEP_SCHEMA_VERSION) {
      // Any mismatched-version line flips the flag; caller decides policy.
      schemaMismatch = true;
      continue;
    }

    if (rec.line_kind === "identity") {
      identityLines.push(parsed as SweepIdentityLine);
    } else if (rec.line_kind === "pid") {
      pidLines.push(parsed as SweepPidLine);
    } else {
      // Unknown line_kind at the current schema version — forward-compat
      // marker, not a failure. Bump the counter for observability.
      unknownLines += 1;
    }
  }

  return { identityLines, pidLines, unknownLines, schemaMismatch };
}

// ---------------------------------------------------------------------------
// SWEEP_FIELD_PARITY — parity map (RESEARCH.md exec sites → schema fields)
// ---------------------------------------------------------------------------

/**
 * Parity map from RESEARCH.md's per-host / per-PID / per-identity exec
 * inventory to the v1 schema fields that carry those reads (or a documented
 * reason the read is NOT collected in this phase's sweep).
 *
 * Row keys mirror RESEARCH.md § "Current per-identity / per-host exec inventory":
 *   • A0                — per-host source-A enumeration driver
 *   • A1..A12           — per-PID source-A exec sites
 *   • B0                — per-host source-B enumeration driver
 *   • B1..B5            — per-identity source-B exec sites
 *
 * A `field: string` value means "this read lands in that named field on one of
 * the SweepLine types". A `field: null` + `skipped_reason: string` value means
 * "this read is intentionally NOT emitted this phase" — the reason must be
 * grep-able and match the sweep script's own comment about why.
 *
 * The unit test walks every key and asserts:
 *   (a) declared `field` values exist as actual keys on SweepIdentityLine or
 *       SweepPidLine (typo protection), and
 *   (b) skipped rows have a non-empty `skipped_reason` (documentation
 *       protection).
 */
export type SweepFieldParityEntry =
  | { field: string; skipped_reason?: never }
  | { field: null; skipped_reason: string };

export const SWEEP_FIELD_PARITY: Record<
  | "A0"
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "A7"
  | "A8"
  | "A9"
  | "A10"
  | "A11"
  | "A12"
  | "B0"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5",
  SweepFieldParityEntry
> = {
  // --- Per-host source-A / source-B enumeration drivers ---
  A0: {
    field: null,
    skipped_reason:
      "server-side enumeration driver (ls ~/.claude/sessions/*.json) — no wire field needed; each live PID becomes its own SweepPidLine",
  },
  B0: {
    field: null,
    skipped_reason:
      "server-side enumeration driver (find ~/.claude/identities/) — no wire field needed; each identity folder becomes its own SweepIdentityLine",
  },

  // --- Per-PID source-A exec sites ---
  A1: { field: "session_json" },
  A2: { field: "stat_result" },
  A3: {
    field: null,
    skipped_reason:
      "box-wide last-stop-payload.json is legacy per RESEARCH.md G9; per-session A9 supersedes it. Sweep does NOT emit A3; Plan 04 caller MUST NOT fall back to A3 when per_session_stop_payload is null (matches today's perSessionUsable branch)",
  },
  A4: {
    field: null,
    skipped_reason:
      "PID→tmux pane resolution (cat /proc/<pid>/environ) folded server-side; result surfaces as SweepPidLine.identity",
  },
  A5: {
    field: null,
    skipped_reason:
      "tmux display-message pane→session resolution folded server-side alongside A4; result surfaces as SweepPidLine.identity",
  },
  A6: { field: "per_session_stop_mtime_ms" },
  A7: { field: "activity_mtime_ms" },
  A8: { field: "stopped_mtime_ms" },
  A9: { field: "per_session_stop_payload" },
  A10: { field: "dormant_a" },
  A11: {
    field: null,
    skipped_reason:
      "per-PID Phase 32 JSONL discovery folded into SweepIdentityLine.jsonl_path; source-A PIDs whose identity matches a SweepIdentityLine reuse that path — no separate per-PID discovery on the wire",
  },
  A12: { field: "jsonl_tail" },

  // --- Per-identity source-B exec sites ---
  B1: { field: "dormant" },
  B2: { field: "recycled_at" },
  B3: { field: "recycle_requested" },
  B4: { field: "jsonl_path" },
  B5: { field: "layer1_recycling" },
};
