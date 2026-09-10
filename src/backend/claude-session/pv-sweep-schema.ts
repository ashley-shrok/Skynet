/**
 * pv-sweep-schema.ts — v1 JSONL wire contract for the Phase 95 Part C PV
 * context-pct batch sweep.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  WHY SINGLE-TIER (one PvSweepLine per identity, no PID axis)?           │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  The PV context-pct subsystem is identity-keyed, NOT process-keyed.     │
 * │  Unlike Phase 92's fleet-status sweep (which needed a separate PID      │
 * │  line to carry /proc/<pid>/stat + session marker state), the context-   │
 * │  pct computation has exactly one data source per identity: the JSONL    │
 * │  session file. A single `line_kind: "identity"` line per requested      │
 * │  identity carries all state the caller needs. This keeps the wire       │
 * │  small (~120 bytes/line) and the parser simple. Per RESEARCH §4a.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Wire-size estimate: ~120 bytes per line (line_kind + identity + schema_version
 * + context_pct + jsonl_path with typical values). For a Skynet-host connection
 * subscribed to 10 identities, the sweep emits ~1.2 KB per tick — well below
 * any wire concern.
 *
 * Consumers:
 *   - Plan 04 Task 2: substrate/scripts/pv-context-pct-sweep.py — emits lines
 *     with these exact field names + shapes (contract enforced by the parser
 *     tests in pv-sweep-schema.test.ts here).
 *   - Plan 05 Task 1: claude-session-server.ts contextPctTimer callback —
 *     imports parseSweepJsonl + PV_SWEEP_SCHEMA_VERSION; dispatches batch-first
 *     / legacy-fallback based on schemaMismatch flag.
 *   - Plan 05 Task 2: regression tests — use these types + parser as fixtures.
 *
 * Parser discipline (mirrors Phase 92-01's sweep-schema.ts):
 *   - Lenient: NEVER throws. A single malformed JSONL line is silently discarded.
 *   - Per-line try/catch. A garbled line MUST NOT fail the batch.
 *   - schemaMismatch flag set if ANY parseable line has schema_version !== 1.
 *     Caller (claude-session-server.ts) owns the fallback policy — this module
 *     is parser-only.
 *   - Forward-compat: unrecognised line_kind values increment unknownLines (soft
 *     signal) but do NOT set schemaMismatch.
 */

// ---------------------------------------------------------------------------
// Schema version constant
// ---------------------------------------------------------------------------

/**
 * Current wire schema version. Bump on any breaking field-name / field-shape
 * change. Consumers compare their expected version against every emitted line's
 * `schema_version`; mismatch triggers the caller's fallback-to-legacy branch.
 */
export const PV_SWEEP_SCHEMA_VERSION = 1 as const;
export type PvSweepSchemaVersion = typeof PV_SWEEP_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// PvSweepLine — one JSON line per requested identity
// ---------------------------------------------------------------------------

/**
 * A single JSONL line emitted by pv-context-pct-sweep.py for one identity.
 *
 * Field ↔ caller parity:
 *   • line_kind      — discriminator; always "identity" in v1 (single-tier schema).
 *   • schema_version — always 1; must match PV_SWEEP_SCHEMA_VERSION.
 *   • identity       — the tmux session name (= identity name, fleet convention).
 *                      Safe-char validated server-side by the Python script
 *                      (^[a-zA-Z0-9_-]+$) and belt-and-suspenders by the caller.
 *   • context_pct    — autocompact-normalized display percentage (0-100), or null
 *                      when the JSONL had no assistant turn yet (fresh session) or
 *                      file could not be read. Null emits from the caller emit a
 *                      loading placeholder in the frontend (accepted UX per
 *                      CONTEXT.md § Verification and RESEARCH §3g).
 *   • jsonl_path     — absolute path to the discovered active JSONL for this
 *                      identity on the remote host. Null when Phase 32 discovery
 *                      found no match (e.g., identity has never started a session).
 *                      Provided for caller-side observability; Phase 95 caller
 *                      ignores this field (context_pct is already computed).
 */
export interface PvSweepLine {
  "line_kind": "identity";
  "schema_version": PvSweepSchemaVersion;
  "identity": string;
  "context_pct": number | null;
  "jsonl_path": string | null;
}

// ---------------------------------------------------------------------------
// isPvSweepLineOfCurrentSchema — narrow type-guard + validator
// ---------------------------------------------------------------------------

/**
 * Narrow type-guard used by parseSweepJsonl (and available to tests). Returns
 * true only when `obj` is a plain object with schema_version === 1, line_kind
 * === "identity", identity as a string, context_pct as number|null, and
 * jsonl_path as string|null.
 *
 * Deliberately does NOT validate that every field is present beyond the five
 * wire-contract fields — extra unknown fields are silently ignored (forward
 * compat: a future schema revision may add fields without breaking v1 parsers).
 *
 * This function NEVER throws.
 */
export function isPvSweepLineOfCurrentSchema(obj: unknown): obj is PvSweepLine {
  if (obj === null || typeof obj !== "object") return false;
  const rec = obj as Record<string, unknown>;

  // schema_version must be exactly 1.
  if (rec["schema_version"] !== PV_SWEEP_SCHEMA_VERSION) return false;

  // line_kind must be "identity" (single-tier; no pid axis in v1).
  if (rec["line_kind"] !== "identity") return false;

  // identity must be a non-empty string.
  if (typeof rec["identity"] !== "string") return false;

  // context_pct must be a number or null.
  if (rec["context_pct"] !== null && typeof rec["context_pct"] !== "number") return false;

  // jsonl_path must be a string or null.
  if (rec["jsonl_path"] !== null && typeof rec["jsonl_path"] !== "string") return false;

  return true;
}

// ---------------------------------------------------------------------------
// parseSweepJsonl — the lenient parser
// ---------------------------------------------------------------------------

export interface PvSweepParseResult {
  /** All successfully-parsed and schema-validated identity lines. */
  lines: PvSweepLine[];
  /**
   * Count of JSON-parseable lines whose `line_kind` was not "identity"
   * (and whose schema_version was 1). Observability only — not a failure
   * signal. Parser stays forward-compatible when a future schema adds
   * new line_kind values.
   */
  unknownLines: number;
  /**
   * True if ANY successfully-JSON-parsed line carried `schema_version !== 1`.
   *
   * When true, the caller (claude-session-server.ts contextPctTimer) falls
   * back to the legacy per-tail-expansion path for this tick AND latches the
   * mismatch for the current WS SSH-channel lifetime — prevents repeated
   * schema-mismatch log spam while gracefully degrading to the legacy path.
   * The parser itself does NOT enforce this policy; it only reports the flag.
   */
  schemaMismatch: boolean;
}

/**
 * Parse a raw JSONL blob (one JSON object per line) emitted by
 * pv-context-pct-sweep.py into a typed result.
 *
 * Contract:
 *   - Splits on \n; filters empty/whitespace-only lines.
 *   - Each line goes through JSON.parse in a try/catch: broken JSON is
 *     silently discarded (a single garbled line MUST NOT fail the batch).
 *   - Lines with schema_version !== 1 set schemaMismatch=true and are dropped.
 *   - Lines with line_kind "identity" and valid fields land in lines[].
 *   - Lines with an unrecognised line_kind increment unknownLines.
 *   - NEVER throws, even on bizarre inputs (error traces, bash prompts, etc.).
 */
export function parseSweepJsonl(raw: string): PvSweepParseResult {
  const lines: PvSweepLine[] = [];
  let unknownLines = 0;
  let schemaMismatch = false;

  if (raw === "") {
    return { lines, unknownLines, schemaMismatch };
  }

  for (const rawLine of raw.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Malformed JSON: silently discard. Single bad line MUST NOT fail
      // the batch — matches the "prefer sweep, fall back to legacy" contract.
      continue;
    }

    if (parsed === null || typeof parsed !== "object") {
      // JSON-legal but not an object (bare number, string, array). Discard.
      continue;
    }

    const rec = parsed as Record<string, unknown>;

    if (rec["schema_version"] !== PV_SWEEP_SCHEMA_VERSION) {
      // Any mismatched-version line flips schemaMismatch; caller decides policy.
      schemaMismatch = true;
      continue;
    }

    if (rec["line_kind"] === "identity") {
      // Full shape validation via isPvSweepLineOfCurrentSchema before casting.
      if (isPvSweepLineOfCurrentSchema(rec)) {
        lines.push(rec as PvSweepLine);
      } else {
        // Parseable, right schema_version, right line_kind, but shape invalid
        // (e.g. missing a required field). Treat as unknown for observability.
        unknownLines += 1;
      }
    } else {
      // Unknown line_kind at the current schema version — forward-compat
      // marker, not a failure. Bump counter for observability.
      unknownLines += 1;
    }
  }

  return { lines, unknownLines, schemaMismatch };
}
