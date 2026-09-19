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
// SweepRawCosmetics — raw cosmetics shape as emitted by the sweep script
// ---------------------------------------------------------------------------

/**
 * Raw cosmetics shape emitted by the Plan 111-01 sweep script's frontmatter
 * parser. Every field is optional because identity and role files may omit any
 * subset. Field names and types are BYTE-IDENTICAL to the Python emission
 * (sweep script rule: "Field names + types below must be BYTE-IDENTICAL to
 * the TypeScript").
 *
 * Used by SweepIdentityLine.identity_cosmetics and SweepIdentityLine.role_cosmetics.
 * NOT the same as RawCosmetics in identity-appearance.ts — that type is used
 * after the merge; this one is the pre-merge wire shape.
 */
export interface SweepRawCosmetics {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  task?: string;
  avatar?: string;
  coordinator?: boolean;
  /**
   * Phase 117 M6 follow-up: project slug from identity frontmatter (validated
   * by the sweep script against PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/ before
   * emission — see fleet-status-sweep.py `_read_frontmatter_cosmetics`).
   * Only emitted for identity files, never role files (allowed_keys gate).
   * Consumed by `resolveIdentityAppearance` which threads it into
   * `IdentityAppearance.project`; the frontend's identities-store then keys
   * project-membership derivations on the resulting field.
   */
  project?: string;
}

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
 *   • identity_cosmetics ↔ B6 (Plan 111-01: raw identity frontmatter cosmetics;
 *                          `role` from the same read also arrives here — see B6
 *                          comment in SWEEP_FIELD_PARITY)
 *   • role_cosmetics    ↔ B7 (Plan 111-01: raw role frontmatter cosmetics,
 *                          resolved via per-tick memo; null when no role)
 *   • pinned            ↔ B8 (Plan 111-01: `.pinned` sentinel present)
 *   • archived          ↔ B9 (Phase 115 Plan 115-05: disk-root axis — the
 *                          identity was enumerated from
 *                          `~/fleet/identities-archive/` rather than
 *                          `~/fleet/identities/`. Not a sentinel-file probe.
 *                          Reuses the B9 wire slot vacated by Phase 115
 *                          Plan 115-02's D-21 retirement.)
 *
 * The `archived` field is a wire-shape building block for the sweep JSONL
 * layer; the ssh-poll-orchestrator (115-06) will transform archived-tree
 * identity rows into a DISTINCT wire message shape published to the frontend
 * (`{ kind: "identity-archived", name, hostId, hostname }`) rather than
 * bolting `archived: true` onto the standard identity frame. Keeping
 * `archived` on `SweepIdentityLine` (Python → TS parser) but NOT on the
 * frontend-facing identity frame is intentional: archived rows are inert
 * historical rows, not identity records that participate in the interactive
 * pool.
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
  // Phase 111 Plan 111-01: appearance fields — optional (?: not required) so
  // a mid-distribution older box that emits a line without these keys still
  // parses without error. isSweepLineOfCurrentSchema checks only schema_version
  // and line_kind; the bare cast at the parse loop admits lines with these keys
  // absent, yielding undefined values. The source-B adapter in
  // ssh-poll-orchestrator treats undefined appearance identically to null
  // (fail-open: hold the last resolved appearance, never blank the row).
  role?: string | null;
  identity_cosmetics?: SweepRawCosmetics | null;
  role_cosmetics?: SweepRawCosmetics | null;
  pinned?: boolean;
  // Phase 115 Plan 115-05: disk-root axis. Optional (?:) so mid-distribution
  // older boxes running the pre-115-05 sweep script (single-tree walk, no
  // archived emission) still parse without error. Undefined ≡ live-tree row
  // for the source-B adapter (which treats archived==true as "route this to
  // the archived-rows pool" and undefined-or-false as "route to the standard
  // identity pool").
  archived?: boolean;
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
// SweepAppLine — one per `~/fleet/apps/<slug>/` folder that passes D-01 or D-02
// ---------------------------------------------------------------------------

/**
 * Source-C parity (Phase 118, D-05) — one JSONL line per app folder emitted by
 * the sweep script's server-side enumeration of `~/fleet/apps/*` (added by
 * Plan 118-01's `_enumerate_apps` + `_build_app_line` in
 * `substrate/scripts/fleet-status-sweep.py`).
 *
 * Field ↔ D-05 wire spec (see SWEEP_FIELD_PARITY C0..C8):
 *   • slug            ↔ folder name (kebab-case, APP_SLUG_RE-validated on emit)
 *   • title           ↔ app.json `title` (D-05 required string)
 *   • description     ↔ app.json `description` (D-05 required string)
 *   • port            ↔ systemd unit `PORT=` env, extracted via
 *                      `systemctl --user show -p Environment app-<slug>.service`.
 *                      Nullable when the extract fails or the unit exposes no
 *                      PORT (D-05: port may be null).
 *   • has_icon        ↔ existence of `icon.webp` in the app folder (D-06:
 *                      BOOLEAN, not a URL — shape 4 owns the serving path).
 *   • created_at_ms   ↔ folder mtime × 1000 (D-08: presence-is-meaning; no
 *                      stored field on disk).
 *   • is_healthy      ↔ true iff the systemd unit is `active` (D-01 (c) +
 *                      D-02 carve-out — an app with unit-exists + inactive
 *                      still emits with is_healthy=false).
 *   • health_message  ↔ D-03 human-readable diagnostic; present only when
 *                      is_healthy=false. the user's steer:
 *                      "not running — ask an agent to check on it" (Plan 118-01
 *                      landed the literal Python-side string).
 *
 * Wire-name discipline: byte-identical snake_case to the Python emit dict in
 * `_build_app_line`. The parser dispatch below (`parseSweepJsonl`) casts, does
 * NOT runtime-validate — downstream (118-04 orchestrator adapter → 118-03 Zod
 * schema) is the runtime-validation gate. See threat model T-118-02-IV.
 *
 * Rolling-deploy safety: adding this line kind is ADDITIVE per RESEARCH.md
 * § Pitfall 6. SWEEP_SCHEMA_VERSION is NOT bumped — older parsers hit the
 * `else { unknownLines += 1 }` branch for `line_kind: "app"` and continue
 * processing identity + pid lines fine. Newer parser with older Python gets
 * an empty appLines array (valid state — box has no apps to report).
 */
export interface SweepAppLine {
  line_kind: "app";
  schema_version: SweepSchemaVersion;
  slug: string;
  title: string;
  description: string;
  port: number | null;
  has_icon: boolean;
  created_at_ms: number;
  is_healthy: boolean;
  health_message: string | null;
}

// ---------------------------------------------------------------------------
// Union + narrow validator
// ---------------------------------------------------------------------------

export type SweepLine = SweepIdentityLine | SweepPidLine | SweepAppLine;

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
  // Phase 118 Plan 118-02: widened for `line_kind: "app"` (source-C, D-20).
  // The schema_version gate ABOVE this check still applies — an app line at
  // a mismatched version is rejected before the line_kind branch is reached.
  return (
    rec.line_kind === "identity" ||
    rec.line_kind === "pid" ||
    rec.line_kind === "app"
  );
}

// ---------------------------------------------------------------------------
// parseSweepJsonl — the lenient parser
// ---------------------------------------------------------------------------

export interface SweepParseResult {
  identityLines: SweepIdentityLine[];
  pidLines: SweepPidLine[];
  /**
   * Phase 118 (source C): app enumeration lines from `_enumerate_apps` in
   * `fleet-status-sweep.py`. Empty when no `~/fleet/apps/` folder exists on
   * the box or when no app passes D-01/D-02 inclusion checks. Downstream
   * consumers (118-04 orchestrator adapter) iterate this array to publish
   * per-app frames + reconcile `lastTickLiveApps` between ticks.
   */
  appLines: SweepAppLine[];
  /**
   * Count of JSON-parseable lines whose `line_kind` was neither "identity",
   * "pid", nor "app". Observability only; not a failure signal — the parser
   * stays forward-compatible if a future schema adds line kinds. Phase 118
   * (Plan 118-02) added `app` to the known set — pre-118-02 parsers hit
   * this counter for app lines during the rolling-deploy window.
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
  // Phase 118 Plan 118-02 (D-20): source-C app lines from `_enumerate_apps`.
  // Sibling to identityLines / pidLines; the empty-input fast-path below
  // returns this array so consumers can safely destructure appLines.
  const appLines: SweepAppLine[] = [];
  let unknownLines = 0;
  let schemaMismatch = false;

  if (raw === "") {
    return {
      identityLines,
      pidLines,
      appLines,
      unknownLines,
      schemaMismatch,
    };
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
    } else if (rec.line_kind === "app") {
      // Phase 118 Plan 118-02 (D-20): source-C dispatch. Matches the
      // identity/pid lenience discipline — cast, no runtime validation
      // beyond the schema_version + line_kind gates above. Downstream
      // (118-04 orchestrator adapter → 118-03 Zod schema) is the runtime-
      // validation gate for the ten-key D-05 shape. Threat T-118-02-IV.
      appLines.push(parsed as SweepAppLine);
    } else {
      // Unknown line_kind at the current schema version — forward-compat
      // marker, not a failure. Bump the counter for observability.
      unknownLines += 1;
    }
  }

  return { identityLines, pidLines, appLines, unknownLines, schemaMismatch };
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
 *   • B1..B9            — per-identity source-B exec sites
 *   • C0                — per-host source-C (Phase 118) app enumeration driver
 *   • C1..C8            — per-app source-C fields (D-05 seven emitted fields
 *                        + D-03 health_message carve-out)
 *
 * A `field: string` value means "this read lands in that named field on one of
 * the SweepLine types". A `field: null` + `skipped_reason: string` value means
 * "this read is intentionally NOT emitted this phase" — the reason must be
 * grep-able and match the sweep script's own comment about why.
 *
 * The unit test walks every key and asserts:
 *   (a) declared `field` values exist as actual keys on SweepIdentityLine,
 *       SweepPidLine, or SweepAppLine (typo protection), and
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
  | "B5"
  | "B6"
  | "B7"
  | "B8"
  | "B9"
  | "C0"
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "C5"
  | "C6"
  | "C7"
  | "C8",
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
  // Phase 111 Plan 111-01 appearance fields (Plan 111-02 adds TypeScript coverage).
  // Note for B6: the `role` field on SweepIdentityLine also arrives from the same
  // identity-frontmatter read (B6 exec site). A separate B10 was not invented
  // because `role` is a side-effect of the same read as identity_cosmetics.
  B6: { field: "identity_cosmetics" },
  B7: { field: "role_cosmetics" },
  B8: { field: "pinned" },
  // Phase 115 Plan 115-05: disk-root axis. NOT a sentinel-file probe like
  // the other B* rows — the field is populated from which root the sweep
  // walked (identities/ = false, identities-archive/ = true) inside
  // _enumerate_identities' unified loop. Reuses the wire slot vacated by
  // Phase 115 Plan 115-02's D-21 retirement.
  B9: { field: "archived" },

  // --- Per-host source-C enumeration driver (Phase 118 Plan 118-02, D-20) ---
  C0: {
    field: null,
    skipped_reason:
      "server-side enumeration driver (os.scandir ~/fleet/apps/*/) — no wire field needed; each app folder that passes D-01 or D-02 becomes its own SweepAppLine",
  },

  // --- Per-app source-C fields (Phase 118, D-05 seven fields + D-03 carve-out) ---
  // Byte-name parity with the Python emit dict in _build_app_line (Plan 118-01):
  // snake_case names verbatim, no camelCase drift at this boundary.
  C1: { field: "slug" },
  C2: { field: "title" },
  C3: { field: "description" },
  C4: { field: "port" },
  C5: { field: "has_icon" },
  C6: { field: "created_at_ms" },
  C7: { field: "is_healthy" },
  // C8 covers the D-03 optional carve-out: health_message is only populated
  // when is_healthy=false. Still a wire slot — the field always exists on the
  // interface (nullable). Python emits null when is_healthy=true.
  C8: { field: "health_message" },
};
