/**
 * identity-artifact-reader.ts — Patch #92: shared helper for identity artifact reads.
 *
 * TWO BRANCHES:
 * - LOCAL branch (conn === null): reads from IDENTITIES_HOST_DIR bind-mount (patch #89
 *   fast-path). Used when the pane's hostId is in the IDENTITIES_LOCAL_HOST_IDS allowlist.
 *   Byte-identical to the pre-#92 server.ts handlers — preserves tina's use case.
 * - REMOTE branch (conn is SSHClientType): reads over SSH via execCommand from
 *   src/backend/ssh/tmux-helper.ts. Caller (claude-session-server.ts) opens a fresh
 *   connectOneShot per handler and .end()s it in try/finally (R4 decision: independent
 *   of the pane's own sshConn; identity handlers are one-shot WS connections).
 *
 * ROUTING (in server.ts): `isLocalHostId(hostId)` returns true when the hostId is in the
 * IDENTITIES_LOCAL_HOST_IDS env allowlist. Missing/invalid hostId falls back to LOCAL
 * branch (backward compat with pre-#92 clients — no breakage on deploy day).
 *
 * ENV VARS:
 * - IDENTITIES_LOCAL_HOST_IDS: comma-separated positive integer hostIds for which the
 *   bind-mount is authoritative (e.g. skynet-ec2's own hostId). Parsed once at module load.
 * - IDENTITIES_HOST_DIR: the bind-mount path (patch #89). Used by getLocalIdentitiesRoot().
 *
 * SSH EXEC: all remote reads use execCommand from tmux-helper.ts (R3). Each call wrapped
 * in Promise.race with REMOTE_EXEC_TIMEOUT_MS (3000ms) so the modal stays responsive on
 * unreachable boxes (R3 / T-3n2-04). Timeout or SSH-layer exception → throws; server.ts
 * catches and emits error response.
 *
 * SHELL SAFETY: identityKey is regex-validated by IDENTITY_KEY_RE before reaching this
 * module, AND single-quoted by shellEscape() as defense-in-depth (T-3n2-01).
 *
 * PATH EXPANSION: remote commands use "$HOME" (not tilde ~) — shell-expanded by the
 * remote sshd login shell, consistent with patch #43 execCommand consumers (R3).
 */

import os from "os";
import path from "path";
import fs from "fs/promises";
import { spawnSync } from "child_process";
import type { Client as SSHClientType } from "ssh2";
type SFTPWrapper = import("ssh2").SFTPWrapper;
import yaml from "js-yaml";
// Tolerant YAML parser for READ paths that feed the visibility gate.
// js-yaml is all-or-nothing: one malformed line invalidates the whole block,
// collapsing every field to undefined. When that happens for an identity
// file, the D-3 fallback ("absent users list = no gate on this side, falls
// open") mis-fires — a legitimately-gated identity becomes visible to every
// user because the gate can't SEE the users list even though it's still on
// disk. Eemeli's `yaml` package parses tolerantly: recoverable errors leave
// unaffected fields intact on the returned Document, and the caller can
// still read `users:` / `role:` / etc. through `.toJS()`. WRITE paths keep
// js-yaml (yaml.dump) because writers correctly refuse to touch a broken
// file — different failure semantics from readers.
import { parseDocument as yamlParseDocument } from "yaml";
import { sshLogger, systemLogger } from "../utils/logger.js";
import { execCommand } from "../ssh/tmux-helper.js";
// Phase 85 Plan 85-01 Task 1: role-name gate for readRoleFileByName +
// readAvatarSiblingFileByRole. Same pattern roles-create.ts imports at L87
// (`/^[a-z0-9-]+$/` — kebab-case-lowercase, defense-in-depth against SSH
// shell interpolation of a role name that arrived through the frontmatter
// merge path rather than the identity two-step's IDENTITY_KEY_RE gate).
import { ROLE_NAME_PATTERN } from "../database/routes/identity-birth-orchestrator.js";

// ---------------------------------------------------------------------------
// Wakeup schedule humanizer (exported so server.ts can import it instead of
// maintaining a duplicate; replaces the now-private copy in server.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Days-gate helpers (Phase 65 / D-01..D-07) — file-private, NOT exported
// ---------------------------------------------------------------------------

/** Canonical weekday order mirrors wakeup-scheduler.py L118-119 (mon→sun). */
const CANONICAL_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type WeekdayCode = (typeof CANONICAL_WEEKDAYS)[number];

/** Returns true iff `v` is one of the seven canonical 3-letter weekday strings. */
function isWeekdayCode(v: unknown): v is WeekdayCode {
  return typeof v === "string" && (CANONICAL_WEEKDAYS as readonly string[]).includes(v);
}

/**
 * Defensive normalization of a raw `days` field per D-07.
 * Returns a canonical mon→sun ordered subset, or null if it should be treated
 * as "no gate" (absent / empty / full-7 / non-array / all-invalid).
 */
function normalizeDaysGate(rawDays: unknown): WeekdayCode[] | null {
  if (!Array.isArray(rawDays)) return null;
  // Normalize each entry: string → lowercase+trim; non-string → drop
  const normalized = rawDays
    .map((entry) => (typeof entry === "string" ? entry.toLowerCase().trim() : null))
    .filter(isWeekdayCode);
  // Deduplicate via Set, then sort into canonical mon→sun order
  const unique = [...new Set<WeekdayCode>(normalized)].sort(
    (a, b) => CANONICAL_WEEKDAYS.indexOf(a) - CANONICAL_WEEKDAYS.indexOf(b),
  );
  if (unique.length === 0) return null; // empty === absent === every day (D-04)
  if (unique.length === 7) return null; // full-7 === no gate (D-02)
  return unique;
}

/**
 * Renders a normalized days-gate subset as a human label per D-05.
 * - Exact weekdays {mon..fri} → "Weekdays"
 * - Exact weekends {sat,sun} → "Weekends"
 * - Any other subset → "Mon/Wed/Fri" (capitalized 3-letter, /‑joined, mon→sun order)
 */
function daysGateLabel(days: WeekdayCode[]): string {
  if (
    days.length === 5 &&
    days[0] === "mon" && days[1] === "tue" && days[2] === "wed" &&
    days[3] === "thu" && days[4] === "fri"
  ) {
    return "Weekdays";
  }
  if (days.length === 2 && days[0] === "sat" && days[1] === "sun") {
    return "Weekends";
  }
  return days.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join("/");
}

/**
 * Humanize a wakeup schedule object into a human-readable string.
 * Handles interval / daily / weekly schedule types; falls back to "custom schedule".
 * Exported so claude-session-server.ts can re-export it (patch #92: moved here to
 * avoid a circular dependency — artifact reader must not import from server.ts).
 *
 * Phase 65: extended to render optional `s.days` day-of-week gate per D-01..D-07.
 */
export function humanizeWakeupSchedule(schedule: unknown): string {
  if (typeof schedule !== "object" || schedule === null) return "custom schedule";
  const s = schedule as Record<string, unknown>;
  const type = s.type;
  if (type === "interval") {
    const every = s.every;
    let base: string;
    if (typeof every === "string" && every.length > 0) {
      base = `Every ${every}`;
    } else if (typeof every === "number") {
      base = `Every ${every}m`;
    } else {
      return "custom schedule";
    }
    // Apply days gate: replace "Every " prefix with "<label> every " (D-05)
    const gate = normalizeDaysGate(s.days);
    if (gate !== null) {
      return `${daysGateLabel(gate)} every ${base.slice("Every ".length)}`;
    }
    return base;
  }
  if (type === "daily") {
    const at = typeof s.at === "string" ? s.at : "";
    const gate = normalizeDaysGate(s.days);
    if (gate !== null) {
      // Replace the "Daily" verb with the gate label (D-05)
      return at ? `${daysGateLabel(gate)} at ${at} (box-local)` : `${daysGateLabel(gate)} (box-local)`;
    }
    return at ? `Daily at ${at} (box-local)` : "Daily (box-local)";
  }
  if (type === "weekly") {
    const at = typeof s.at === "string" ? s.at : "";
    const dayRaw = typeof s.day === "string" ? s.day : "";
    const day = dayRaw.length > 0
      ? dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1).toLowerCase()
      : "?";
    const baseWeekly = at ? `Weekly on ${day} at ${at} (box-local)` : `Weekly on ${day} (box-local)`;
    const gate = normalizeDaysGate(s.days);
    if (gate !== null) {
      // Determine if the weekly slot day is inside the gate (D-01)
      const dayLower = dayRaw.toLowerCase();
      const dayInGate = isWeekdayCode(dayLower) && gate.includes(dayLower);
      if (dayInGate) {
        // Render as days-gate-substituted daily-style form; drop redundant "on <Day>" (D-01)
        return at ? `${daysGateLabel(gate)} at ${at} (box-local)` : `${daysGateLabel(gate)} (box-local)`;
      }
      // Malformed NEVER-FIRES case: surface visibly (D-01 defensive branch)
      return `${baseWeekly} — NEVER FIRES (weekly day excluded from days gate)`;
    }
    return baseWeekly;
  }
  if (type === "one_shot") {
    // Phase 128 code-review fix #2: one_shot was falling through to "custom
    // schedule". A one_shot spec has `at`: an ISO datetime string. Render it
    // in the same idiom as daily to keep the shape-3 modal's row-label
    // consistent (label + "at" + human-readable time). No days-gate branch —
    // one_shot fires once, at a moment; a day-of-week gate is meaningless.
    const at = typeof s.at === "string" ? s.at : "";
    return at ? `Once at ${at}` : "Once";
  }
  return "custom schedule";
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Shared validator for identity keys — matches the 5 inline copies in server.ts pre-#92. */
export const IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/;

/**
 * Phase 117 Plan 117-01 (D-04): project slug validator — kebab-case-lowercased,
 * strictly narrower than IDENTITY_KEY_RE. Underscore is REJECTED (D-04 spec
 * calls out kebab-case only); uppercase is REJECTED (lowercased); length capped
 * at 64 chars to match IDENTITY_KEY_RE's bound.
 *
 * The `.` and `/` characters are structurally impossible under this charset,
 * which is the load-bearing path-traversal defense for createProject +
 * archiveProject (Phase 117 threat T-117-01-01). Any user-supplied slug that
 * survives PROJECT_SLUG_RE.test() cannot escape the projects/ root by
 * construction.
 *
 * See Phase 117 CONTEXT.md D-01..D-04, D-25, D-30, D-36. Consumed by every
 * new project primitive below plus every project route in Wave 2 (117-04) and
 * the archive-cascade in 117-09.
 */
export const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Phase 119 Plan 05 (D-06): validator for first-class app slugs.
 * Kebab-case only (shape 1 lock — `create-app.sh` requires kebab-case; no
 * underscores). Bounded length matches IDENTITY_KEY_RE. Enforced BOTH at
 * the route (src/backend/database/routes/apps.ts) AND inside readAppIconFile
 * (defence-in-depth) because the slug is interpolated into a shell `ls`
 * command over SSH on the REMOTE branch.
 */
export const APP_SLUG_RE = /^[a-z0-9-]{1,64}$/;

// ---------------------------------------------------------------------------
// Module-load: parse IDENTITIES_LOCAL_HOST_IDS once
// ---------------------------------------------------------------------------

const LOCAL_HOST_IDS = new Set<number>();
(function parseLocalHostIds() {
  const raw = process.env.IDENTITIES_LOCAL_HOST_IDS ?? "";
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) continue; // skip malformed
    LOCAL_HOST_IDS.add(n);
  }
})();

// ---------------------------------------------------------------------------
// Routing predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when `hostId` is in the IDENTITIES_LOCAL_HOST_IDS allowlist,
 * meaning the local bind-mount (IDENTITIES_HOST_DIR) is authoritative for this host.
 *
 * Returns false for undefined, zero, NaN, negative, non-integer, or any hostId
 * not in the parsed set. Fail-safe: any deploy that forgets IDENTITIES_LOCAL_HOST_IDS
 * will fall through to SSH (still correct — just skips the bind-mount fast-path).
 */
export function isLocalHostId(hostId: number | undefined): boolean {
  if (hostId === undefined || !Number.isFinite(hostId) || hostId <= 0) return false;
  return LOCAL_HOST_IDS.has(hostId);
}

// ---------------------------------------------------------------------------
// Local fleet-subpath roots — HOME_HOST_DIR-derived defaults with
// per-subpath escape hatches (Phase 117 M-K, 2026-09-19)
// ---------------------------------------------------------------------------
//
// PRIMARY control: HOME_HOST_DIR. Container invocations get it from the
// Dockerfile ENV (=/host-home); native-run invocations leave it unset and
// fall back to `os.homedir()`. Every fleet subpath (identities, roles,
// projects) auto-derives as `<HOME_HOST_DIR>/fleet/<type>` — one env var
// covers all four positions.
//
// Prior state: three sibling env vars (PROJECTS_HOST_DIR,
// IDENTITIES_HOST_DIR, ROLES_HOST_DIR) — one per subpath, all with
// identical shape. That antipattern was how PROJECTS_HOST_DIR got
// silently omitted from skynet.env when Phase 117 added projects. Result:
// projects wrote to `/root/fleet/projects/` inside the container's
// ephemeral layer, wiped by every `docker compose up --force-recreate`.
//
// The specific `<TYPE>_HOST_DIR` vars are RETAINED as an escape hatch:
// the LOCAL-branch unit tests set them to per-test scratch dirs to
// isolate one subpath's filesystem without affecting siblings. Production
// deployments should NOT set them — HOME_HOST_DIR (or the Dockerfile
// default) is the operator-facing knob.

/**
 * Returns the local home root directory (`~` from the container's / native
 * process's perspective). Consumed by every `getLocal*Root` helper below.
 * Kept private — the specific-subpath getters are what callers use.
 */
function getLocalHomeRoot(): string {
  return process.env.HOME_HOST_DIR || os.homedir();
}

/**
 * Returns the local identities root directory.
 * Precedence: IDENTITIES_HOST_DIR (test escape hatch) → HOME_HOST_DIR-derived
 * default (`<home>/fleet/identities`).
 */
export function getLocalIdentitiesRoot(): string {
  return (
    process.env.IDENTITIES_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "identities")
  );
}

/**
 * Returns the local roles root directory.
 * Precedence: ROLES_HOST_DIR (test escape hatch) → HOME_HOST_DIR-derived
 * default (`<home>/fleet/roles`).
 */
export function getLocalRolesRoot(): string {
  return (
    process.env.ROLES_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "roles")
  );
}

/**
 * Returns the local projects root directory.
 *
 * D-01: projects live at `~/fleet/projects/<slug>/` — a sibling to
 * ~/fleet/roles/ and ~/fleet/identities/ under the fleet substrate.
 *
 * Precedence: PROJECTS_HOST_DIR (test escape hatch) → HOME_HOST_DIR-derived
 * default (`<home>/fleet/projects`).
 */
export function getLocalProjectsRoot(): string {
  return (
    process.env.PROJECTS_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "projects")
  );
}

/**
 * Returns the local wake-ups root directory (Phase 134 Plan 134-01).
 *
 * D-16: Skynet's own host is a managed host from the wake-ups CRUD API's
 * perspective. The new fleet-wide LIST fan-out reads t1000 (Skynet's own
 * host) via the container bind mount, not loopback SSH. This helper mirrors
 * getLocalIdentitiesRoot + getLocalRolesRoot + getLocalProjectsRoot so
 * every fleet subtree derives its root from the same HOME_HOST_DIR
 * resolution (Phase 117 M-K parity).
 *
 * Precedence: WAKEUPS_HOST_DIR (test escape hatch) → HOME_HOST_DIR-derived
 * default (`<home>/fleet/wakeups`).
 */
export function getLocalWakeupsRoot(): string {
  return (
    process.env.WAKEUPS_HOST_DIR ||
    path.join(getLocalHomeRoot(), "fleet", "wakeups")
  );
}

// ---------------------------------------------------------------------------
// Two-step role resolution — Phase 22 SRIC-01
// ---------------------------------------------------------------------------
//
// The fleet-side role/identity paradigm stores role assignment as YAML
// frontmatter (`role: <name>`) at the top of ~/fleet/identities/<key>/<key>.md.
// Role-scoped artifacts (bounties, history, role-file) live at
// ~/fleet/roles/<role>/... — so any backend op that needs a role artifact
// must first read the identity file, parse the frontmatter, and extract role.
//
// This helper pair (extractRoleFromMarkdown + resolveRoleForIdentity) is the
// SINGLE source of truth for that two-step. Per D-CONTEXT §"No no-role
// fallback branches" (LOCKED with user 2026-08-04), resolveRoleForIdentity
// THROWS when role is missing or fails the shell-safety gate — never returns
// null / undefined / empty. Callers propagate the throw to the WS `error`
// field via the existing claude-session-server.ts error-envelope pattern.

/**
 * Extract the role name from an identity markdown file's YAML frontmatter block.
 *
 * Returns the role string when present + non-empty + string-typed. Returns null
 * on any of: missing `---...---` frontmatter delimiters, missing `role:` key,
 * empty-string value, non-string value, or js-yaml parse error.
 *
 * The caller decides whether null is fatal — resolveRoleForIdentity below
 * treats it as fatal (throws) per D-CONTEXT no-fallback rule. Direct callers
 * (Wave 2 plans that need role-if-present logic) can null-check without
 * catching an exception.
 *
 * Regex bounds the frontmatter to the block between the top-of-file `---`
 * and the next `---` — parser sees a well-formed YAML snippet, not the whole
 * markdown body (which could contain hostile YAML-shaped lines elsewhere).
 * `\r?\n` handles both LF and CRLF line endings (rare but valid on identity
 * files touched by Windows editors).
 */
export function extractRoleFromMarkdown(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  // Tolerant parse: parseDocument does NOT throw on recoverable YAML errors —
  // it collects them on `doc.errors` and still exposes whatever nodes parsed
  // cleanly via doc.toJS(). Critical for the identity-visibility gate: a
  // malformed prose field (bad `task:` with unquoted `: ` — the recurring
  // Pitfall 3 case) used to collapse the whole frontmatter to null and force
  // role=null, which in turn caused the role-side visibility gate to fall
  // open (Phase 135 D-3 fallback conflating "absent" with "unparseable"),
  // silently leaking every affected identity to every user. With the tolerant
  // parser, `role:` on line 1 survives a broken `task:` on line 3, so the
  // role-side gate still closes correctly.
  const doc = yamlParseDocument(match[1]);
  if (doc.errors.length > 0) {
    systemLogger.warn(
      "Identity/role frontmatter YAML had parse errors — using tolerant recovery",
      {
        operation: "frontmatter_yaml_parse_failed",
        site: "extractRoleFromMarkdown",
        errorCount: doc.errors.length,
        firstError: doc.errors[0]?.message?.split("\n")[0],
        snippet: match[1].slice(0, 200),
      },
    );
  }
  const parsed = doc.toJS() as Record<string, unknown> | null;
  if (parsed === null || typeof parsed !== "object") return null;
  const role = parsed.role;
  return typeof role === "string" && role.length > 0 ? role : null;
}

/**
 * Resolve the role name for a given identity by reading the identity file and
 * extracting `role:` from its YAML frontmatter.
 *
 * THROWS Error (never returns null) when:
 *   - identity file body has no frontmatter block, OR
 *   - frontmatter has no `role:` key, OR
 *   - role: value fails the IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ gate.
 *
 * The second gate is defense-in-depth: role is shell-interpolated into
 * SSH exec commands by callers (readIdentityBounties, readIdentityHistory,
 * and future role-scoped writers), so re-validating role with the same
 * regex that guards identityKey shell-safety is required. See threat model
 * T-22-01-01 / T-22-01-02.
 *
 * Per D-CONTEXT (LOCKED 2026-08-04): "No no-role fallback branches anywhere.
 * user confirmed no fleet identity lacks `role:` frontmatter post-migration.
 * Any plan that adds 'graceful (no role)' fallback branches or empty-state
 * handling is a plan-checker BLOCK (dead code)." A throw here is correct
 * behavior for a data-integrity violation, not a bug.
 */
export async function resolveRoleForIdentity(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<string> {
  const { markdown } = await readIdentityFile(conn, identityKey);
  const role = extractRoleFromMarkdown(markdown);
  if (role === null) {
    throw new Error(
      `identity ${identityKey} has no role: frontmatter in identity file`,
    );
  }
  if (!IDENTITY_KEY_RE.test(role)) {
    throw new Error(
      `identity ${identityKey}: role ${role} fails IDENTITY_KEY_RE gate`,
    );
  }
  return role;
}

// ---------------------------------------------------------------------------
// Phase 117 Plan 117-01 — session project-field read/write
// ---------------------------------------------------------------------------
//
// Reads and writes the `project:` frontmatter key on the identity file
// (`~/fleet/identities/<key>/<key>.md`). Membership per D-05 lives WITH the
// thing being grouped: the identity file's frontmatter is the source of truth
// for identity-associated conversations. No parallel index, no separate table.
//
// LOAD-BEARING CONSTRAINT (RESEARCH.md § Common Pitfalls #5):
//   The writer MUST NOT go through extractCosmeticsFromFrontmatter — that
//   helper is field-narrowing (accepts only the 7 known cosmetics fields:
//   displayName, title, colorHue, voice, avatar, coordinator, task). Every
//   other frontmatter field — role, project, and any user-added keys — would
//   silently disappear on the round-trip.
//
//   Instead, both the reader and the writer parse the ENTIRE frontmatter
//   block with yaml.load, and the writer emits via yaml.dump with
//   sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false (matches
//   identity-birth-orchestrator.ts:575's buildIdentityFileBody options).
//
//   Absent-⇒-omit invariant: passing projectSlug=null DELETES the key from
//   the parsed dict; the writer never emits `project: null` or `project: ''`.
//   Matches the invariant identity-birth-orchestrator holds for
//   title/voice/avatar/task.
//
// D-COVERAGE: D-05 (frontmatter IS source of truth), D-32 (id-skill reads
// this same field on /id load), D-36 (backend surface list).
//
// PATH: identity file at $HOME/fleet/identities/<key>/<key>.md — NOT any
// session JSONL file (Pitfall 2 in RESEARCH). readIdentityFile above is the
// authoritative reader; readSessionProjectField delegates to it.

/**
 * Read the `project:` frontmatter key from an identity's markdown file.
 *
 * Returns the project slug when present + non-empty + string-typed. Returns
 * null on any of: identity file missing, no `---...---` frontmatter block,
 * missing `project:` key, empty-string value, non-string value, or js-yaml
 * parse error. All null-returning paths are GRACEFUL — a broken identity
 * file should not break every consumer of the field.
 *
 * D-05 / D-32 (Phase 117): the id-skill's project-awareness clause and the
 * sidebar's project-bucketing selector both use this signal.
 */
export async function readSessionProjectField(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<string | null> {
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  const { markdown } = await readIdentityFile(conn, identityKey);
  if (markdown.length === 0) return null; // ENOENT / missing identity file

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n[\s\S]*$/);
  if (!match) return null; // no frontmatter block

  // Tolerant parse — see extractRoleFromMarkdown docblock for rationale.
  // A broken `task:` should not zero out the `project:` field on the same
  // identity; if project parsed cleanly it's still readable.
  const doc = yamlParseDocument(match[1]);
  if (doc.errors.length > 0) {
    systemLogger.warn(
      "Identity frontmatter YAML had parse errors — using tolerant recovery",
      {
        operation: "frontmatter_yaml_parse_failed",
        site: "readSessionProjectField",
        errorCount: doc.errors.length,
        firstError: doc.errors[0]?.message?.split("\n")[0],
        snippet: match[1].slice(0, 200),
      },
    );
  }
  const parsed = doc.toJS() as unknown;
  if (parsed === null || typeof parsed !== "object") return null;
  const project = (parsed as Record<string, unknown>).project;
  return typeof project === "string" && project.length > 0 ? project : null;
}

/**
 * Write (or clear) the `project:` frontmatter key on an identity's markdown file.
 *
 * Semantics per D-05 + D-31:
 *   - projectSlug === null   → DELETE the `project:` key from the frontmatter
 *                              dict (absent-⇒-omit invariant). Never emits
 *                              `project: null` or `project: ''`.
 *   - projectSlug matches
 *     PROJECT_SLUG_RE          → sets `parsed.project = projectSlug`.
 *   - Any other input        → throws before any I/O.
 *
 * Load-bearing (Pitfall 5): the round-trip is a FULL yaml.load / yaml.dump
 * pair — NOT extractCosmeticsFromFrontmatter. Every unknown frontmatter key
 * survives untouched. If the identity file has a `custom: foo` field, it
 * survives; if it has `role: worker`, it survives; if a future migration
 * adds a new key, it survives without a code change here.
 *
 * yaml.dump options (matches identity-birth-orchestrator.ts:575 verbatim):
 *   sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false.
 *
 * Atomic write via writeMarkdownFileAtomic — tmp+rename discipline; a mid-
 * write crash leaves the prior identity file intact.
 *
 * Throws when the identity file is missing, has no frontmatter block, or the
 * frontmatter fails to parse (write path — cannot silently repair).
 */
export async function writeSessionProjectField(
  conn: SSHClientType | null,
  identityKey: string,
  projectSlug: string | null,
): Promise<void> {
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (projectSlug !== null && !PROJECT_SLUG_RE.test(projectSlug)) {
    throw new Error("invalid project slug");
  }

  const { markdown } = await readIdentityFile(conn, identityKey);
  if (markdown.length === 0) {
    throw new Error(`identity ${identityKey} file missing`);
  }

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`identity ${identityKey} has no frontmatter`);
  }
  const frontmatterRaw = match[1];
  const bodyAfter = match[2];

  // Full yaml.load — preserves ALL keys (NOT extractCosmeticsFromFrontmatter).
  let parsed: Record<string, unknown>;
  try {
    const loaded = yaml.load(frontmatterRaw) as Record<string, unknown> | null;
    parsed = loaded ?? {};
  } catch (err) {
    throw new Error(
      `identity ${identityKey} frontmatter parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Mutate the ONE `project` key. Absent-⇒-omit: DELETE, never null.
  if (projectSlug === null) {
    delete parsed.project;
  } else {
    parsed.project = projectSlug;
  }

  const yamlBody = yaml.dump(parsed, {
    sortKeys: false,
    lineWidth: -1,
    noRefs: true,
    forceQuotes: false,
  });

  const newContents = `---\n${yamlBody}---\n${bodyAfter}`;
  const targetPath = `$HOME/fleet/identities/${identityKey}/${identityKey}.md`;
  await writeMarkdownFileAtomic(conn, targetPath, newContents);
}

// ---------------------------------------------------------------------------
// Shell escape (3-line copy from session-file-tail.ts — same implementation)
// ---------------------------------------------------------------------------

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Phase 117 Plan 117-01 — project directory primitives
// ---------------------------------------------------------------------------
//
// Reads and writes at $HOME/fleet/projects/<slug>/... — a NEW sibling to
// ~/fleet/roles/ and ~/fleet/identities/ under the fleet substrate (D-01).
// Every function branches on conn===null (LOCAL: fs.promises against the
// PROJECTS_HOST_DIR / os.homedir fallback) vs conn!==null (REMOTE: SSH exec
// + SFTP via writeMarkdownFileAtomic) — same discipline as readIdentityFile
// at :441-475.
//
// Slug safety: every entrypoint gates on PROJECT_SLUG_RE BEFORE any I/O.
// `.` and `/` are structurally absent from the charset [a-z0-9-] so path
// traversal (T-117-01-01) is impossible by construction. REMOTE-branch
// shell interpolation additionally passes user-derived values through
// shellEscape as belt-and-suspenders defense against future regex loosening
// (T-117-01-02).
//
// Archive discipline (D-30): listProjects excludes the `archive/` subdirectory
// from the enumeration; archived projects are invisible in v1. archiveProject
// moves the whole slug dir to $HOME/fleet/projects/archive/<slug>/ — mirrors
// the Phase 115 identity-archive tree destination shape.

/**
 * Enumerate all non-archived projects under $HOME/fleet/projects/.
 *
 * Returns an array of {slug, displayName} sorted ascending by slug. Excludes
 * the `archive/` subdirectory per D-30. `displayName` comes from each
 * project.md's frontmatter (system-read `displayName:` key); when missing or
 * unreadable, falls back to the slug itself so a bare directory still shows
 * up in the sidebar.
 *
 * LOCAL branch: fs.readdir with withFileTypes:true, filter to dirs matching
 * PROJECT_SLUG_RE and name !== "archive". ENOENT on the root → [] (graceful).
 *
 * REMOTE branch: `find "$HOME/fleet/projects" -mindepth 1 -maxdepth 1 -type d
 * ! -name archive -printf '%f\\n' 2>/dev/null || true` — the `|| true` handles
 * "projects dir missing" as empty stdout, matching listIdentityKeysOnHost's
 * error tolerance.
 */
export async function listProjects(
  conn: SSHClientType | null,
): Promise<
  Array<{ slug: string; displayName: string; users: string[] | null }>
> {
  let slugs: string[];

  if (conn === null) {
    const root = getLocalProjectsRoot();
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw err;
    }
    slugs = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          e.name !== "archive" &&
          PROJECT_SLUG_RE.test(e.name),
      )
      .map((e) => e.name)
      .sort();
  } else {
    const cmd =
      `find "$HOME/fleet/projects" -mindepth 1 -maxdepth 1 -type d ! -name archive -printf '%f\\n' 2>/dev/null || true`;
    const stdout = await execWithTimeout(conn, cmd);
    slugs = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((n) => n.length > 0 && PROJECT_SLUG_RE.test(n))
      .sort();
  }

  // For each slug, best-effort read of project.md to extract displayName and
  // the `users:` visibility list. Any failure falls back to (slug, null users)
  // — a bare project dir is still a project, and a missing users list falls
  // open per the Phase 135 D-3 fallback (matches identity-appearance discipline).
  const out: Array<{
    slug: string;
    displayName: string;
    users: string[] | null;
  }> = [];
  for (const slug of slugs) {
    let displayName = slug;
    let users: string[] | null = null;
    try {
      const { markdown } = await readProjectFile(conn, slug);
      if (markdown.length > 0) {
        const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          // Tolerant parse — see extractRoleFromMarkdown docblock. Critical
          // for the project-visibility gate: same "malformed prose field
          // shouldn't zero out users:" concern as identities. A broken task
          // (or any other prose field) on project.md must not silently make
          // the project visible to every user by collapsing users to
          // undefined.
          const doc = yamlParseDocument(fmMatch[1]);
          if (doc.errors.length > 0) {
            systemLogger.warn(
              "Project frontmatter YAML had parse errors — using tolerant recovery",
              {
                operation: "frontmatter_yaml_parse_failed",
                site: "listProjects",
                slug,
                errorCount: doc.errors.length,
                firstError: doc.errors[0]?.message?.split("\n")[0],
                snippet: fmMatch[1].slice(0, 200),
              },
            );
          }
          const parsed = doc.toJS() as Record<string, unknown> | null;
          if (parsed !== null && typeof parsed === "object") {
            const dn = (parsed as Record<string, unknown>).displayName;
            if (typeof dn === "string" && dn.length > 0) {
              displayName = dn;
            }
            const rawUsers = (parsed as Record<string, unknown>).users;
            if (
              Array.isArray(rawUsers) &&
              rawUsers.every((u) => typeof u === "string")
            ) {
              users = rawUsers as string[];
            }
          }
        }
      }
    } catch {
      // read failure → keep slug + null users fallback
    }
    out.push({ slug, displayName, users });
  }
  return out;
}

/**
 * Read the project.md file at $HOME/fleet/projects/<slug>/project.md.
 *
 * Returns {markdown: string}; empty string on ENOENT (mirrors readIdentityFile).
 * Throws on invalid slug (before any I/O).
 */
export async function readProjectFile(
  conn: SSHClientType | null,
  slug: string,
): Promise<{ markdown: string }> {
  if (!PROJECT_SLUG_RE.test(slug)) {
    throw new Error("invalid project slug");
  }

  if (conn === null) {
    const root = getLocalProjectsRoot();
    const filePath = path.join(root, slug, "project.md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE — slug is regex-validated so interpolation inside double quotes is
  // safe (same argument as readIdentityFile at :472 patch #95).
  const cmd = `cat "$HOME/fleet/projects/${slug}/project.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

/**
 * Overwrite the project.md file at $HOME/fleet/projects/<slug>/project.md.
 *
 * Byte-shape mirror of readProjectFile above — slug gate, LOCAL vs REMOTE
 * branch, $HOME-literal remote path handed to writeMarkdownFileAtomic (which
 * routes through getLocalIdentitiesRoot's parent locally and SFTP+SSH
 * ext_openssh_rename atomic-overwrite remotely). Server-echoes the written
 * body so callers get an authoritative post-write snapshot without a second
 * read round-trip.
 *
 * Does NOT create the project directory — a missing dir surfaces as ENOENT
 * from the underlying writeFile/SFTP, which is the intended failure mode
 * (edit is only invocable from the context menu of an existing project
 * section header).
 */
export async function writeProjectFile(
  conn: SSHClientType | null,
  slug: string,
  contents: string,
): Promise<{ markdown: string }> {
  if (!PROJECT_SLUG_RE.test(slug)) {
    throw new Error("invalid project slug");
  }

  if (conn === null) {
    const root = getLocalProjectsRoot();
    const filePath = path.join(root, slug, "project.md");
    await writeMarkdownFileAtomic(null, filePath, contents);
    return { markdown: contents };
  }

  await writeMarkdownFileAtomic(
    conn,
    `$HOME/fleet/projects/${slug}/project.md`,
    contents,
  );
  return { markdown: contents };
}

/**
 * Create a new project directory at $HOME/fleet/projects/<slug>/ with a bare
 * project.md whose frontmatter carries `displayName: <value>` and empty body
 * (D-25).
 *
 * Duplicate-slug rejection: probes the target dir BEFORE any write. If it
 * already exists, throws an Error whose `.code === "EEXIST"` so the route
 * layer can 409 it distinguishably.
 *
 * Slug validated via PROJECT_SLUG_RE. displayName validated as string with
 * trimmed length in [1, 80] (T-117-01 security-domain V5 cap). Both gates
 * fire before any I/O.
 */
export async function createProject(
  conn: SSHClientType | null,
  slug: string,
  displayName: string,
  users?: string[] | null,
): Promise<void> {
  if (!PROJECT_SLUG_RE.test(slug)) {
    throw new Error("invalid project slug");
  }
  if (typeof displayName !== "string") {
    throw new Error("invalid displayName (must be string)");
  }
  const trimmed = displayName.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new Error(
      "invalid displayName (length must be between 1 and 80 characters)",
    );
  }

  // Compose the bare project.md body via canonical yaml.dump options.
  // When `users` is a non-empty array of strings, include it in the frontmatter
  // as the Phase 129/130 per-user visibility gate list (D-3 fallback still
  // holds: an absent or empty list means "no gate — visible to all users with
  // host access"). The auto-tag write path in project-list.ts POST populates
  // this on multi-user hosts; single-user hosts pass no users and the file
  // stays byte-identical to a pre-130 project.md.
  const frontmatter: Record<string, unknown> = { displayName };
  if (Array.isArray(users) && users.length > 0) {
    frontmatter.users = users;
  }
  const yamlBody = yaml.dump(frontmatter, {
    sortKeys: false,
    lineWidth: -1,
    noRefs: true,
    forceQuotes: false,
  });
  const body = `---\n${yamlBody}---\n`;

  if (conn === null) {
    const root = getLocalProjectsRoot();
    const projectDir = path.join(root, slug);
    const targetFile = path.join(projectDir, "project.md");

    // Phase 117 M2 fix (2026-09-18): TOCTOU-safe dupe rejection.
    //
    // Pre-fix: probe → mkdir(recursive:true) → write was three separate
    // ops. Two concurrent createProject calls with the same slug both
    // passed the probe (before either had written anything), both
    // mkdir'd (recursive:true is idempotent and succeeds), and both
    // wrote project.md — the second silently clobbered the first with
    // no 409.
    //
    // Fix: ensure the parent projects/ dir exists via a separate
    // recursive mkdir, then use non-recursive fs.mkdir(projectDir).
    // Non-recursive mkdir is atomic at the syscall level and throws
    // EEXIST if the directory already exists — the OS makes this
    // race-safe, no separate probe needed.
    await fs.mkdir(root, { recursive: true });
    try {
      await fs.mkdir(projectDir);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        const dupe = new Error(`project slug already exists: ${slug}`);
        (dupe as NodeJS.ErrnoException).code = "EEXIST";
        throw dupe;
      }
      throw err;
    }
    await writeMarkdownFileAtomic(null, targetFile, body);
    return;
  }

  // REMOTE — TOCTOU-safe dupe rejection via non-recursive mkdir.
  //
  // Phase 117 H3 fix (2026-09-18): use double-quoted "$HOME/..."
  // interpolation directly. shellEscape wraps in single quotes and
  // disables $HOME expansion; PROJECT_SLUG_RE ([a-z0-9-]) blocks all
  // shell metacharacters in the slug so double-quoted interpolation
  // is safe.
  //
  // Phase 117 M2 fix (2026-09-18): pre-fix, this route did probe →
  // mkdir -p → write, which is TOCTOU: two concurrent creates both
  // pass the probe, both mkdir -p succeed (recursive/idempotent), and
  // both write. Fix: ensure the parent projects/ dir exists via a
  // separate mkdir -p, then use plain (non-`-p`) mkdir which fails
  // atomically with a non-zero exit code if the directory already
  // exists. We test the exit path by checking stderr / stdout — the
  // simplest posture is to combine `mkdir -p PARENT && mkdir CHILD`
  // in one exec and detect failure via a sentinel echo on success.
  //
  // Since execWithTimeout throws on non-zero exit, the natural failure
  // path on race-loser is a thrown error. We probe the specific
  // "File exists" / EEXIST shape and re-map it to a clean EEXIST throw
  // for the caller to distinguish.
  try {
    await execWithTimeout(
      conn,
      `mkdir -p "$HOME/fleet/projects" && mkdir "$HOME/fleet/projects/${slug}"`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("File exists") ||
      msg.toLowerCase().includes("already exists") ||
      msg.includes("EEXIST")
    ) {
      const dupe = new Error(`project slug already exists: ${slug}`);
      (dupe as NodeJS.ErrnoException).code = "EEXIST";
      throw dupe;
    }
    throw err;
  }
  await writeMarkdownFileAtomic(
    conn,
    `$HOME/fleet/projects/${slug}/project.md`,
    body,
  );
}

/**
 * Move the project directory at $HOME/fleet/projects/<slug>/ to
 * $HOME/fleet/projects/archive/<slug>/ (D-30). Mirrors the identity-archive
 * tree destination pattern from Phase 115.
 *
 * Slug validated via PROJECT_SLUG_RE — since `.` and `/` are not in the
 * charset, path-traversal payloads like `../etc` are rejected before any
 * I/O (T-117-01-01 path-traversal defense).
 *
 * Does NOT overwrite an existing archived slug: fs.rename onto an existing
 * directory is a filesystem error and is allowed to propagate. Callers wanting
 * "archive-anyway" semantics must clear the destination first (not v1 scope).
 */
export async function archiveProject(
  conn: SSHClientType | null,
  slug: string,
): Promise<void> {
  if (!PROJECT_SLUG_RE.test(slug)) {
    throw new Error("invalid project slug");
  }

  if (conn === null) {
    const root = getLocalProjectsRoot();
    const archiveRoot = path.join(root, "archive");
    const src = path.join(root, slug);
    const dest = path.join(archiveRoot, slug);
    await fs.mkdir(archiveRoot, { recursive: true });

    // Phase 117 M1 fix (2026-09-18): probe archive destination BEFORE
    // rename. Pre-fix, POSIX fs.rename onto an existing directory has
    // varied semantics across platforms; more importantly, if a project
    // named "foo" is archived, a new "foo" is created, then archived
    // again, some implementations silently NEST the second archive
    // inside the first (~/fleet/projects/archive/foo/foo/...) — the
    // docblock explicitly promised "Does NOT overwrite" so we throw
    // EEXIST here to make the invariant load-bearing.
    let destExists = false;
    try {
      await fs.stat(dest);
      destExists = true;
    } catch (err: unknown) {
      if (
        !(
          typeof err === "object" &&
          err !== null &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        )
      ) {
        throw err;
      }
    }
    if (destExists) {
      const err = new Error(`archive slug already exists: ${slug}`);
      (err as NodeJS.ErrnoException).code = "EEXIST";
      throw err;
    }

    await fs.rename(src, dest);
    return;
  }

  // Phase 117 H3 fix (2026-09-18): same $HOME shell-quoting bug as
  // createProject — shellEscape wraps in single quotes which disables
  // $HOME expansion. Use double-quoted interpolation directly.
  // PROJECT_SLUG_RE ([a-z0-9-]) blocks all shell metacharacters in the
  // slug, so double-quoted interpolation is safe.
  //
  // Phase 117 M1 fix (2026-09-18): probe archive destination BEFORE
  // mv. POSIX `mv src dest` where dest is an existing directory moves
  // src INSIDE dest (dest/basename(src)) — a silent nested-corruption
  // bug when a slug is archived twice. Throw EEXIST if the archive
  // destination already exists.
  const probeOut = (
    await execWithTimeout(
      conn,
      `test -d "$HOME/fleet/projects/archive/${slug}" && echo ok || echo missing`,
    )
  ).trim();
  if (probeOut === "ok") {
    const err = new Error(`archive slug already exists: ${slug}`);
    (err as NodeJS.ErrnoException).code = "EEXIST";
    throw err;
  }
  const cmd =
    `mkdir -p "$HOME/fleet/projects/archive" && ` +
    `mv "$HOME/fleet/projects/${slug}" "$HOME/fleet/projects/archive/${slug}"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// Timeout constant
// ---------------------------------------------------------------------------

// Bumped 3000 → 15000ms (2026-09-02) — see session-file-discovery.ts for the
// full rationale. tl;dr: patch 260902-3ll's per-connection SSH exec semaphore
// (cap 8, unbounded FIFO wait queue) makes "slow exec" often mean "queued
// behind fleet-status's work" rather than "SSH is broken," so hard 3s
// timeouts here would mis-classify legitimate backpressure as failure.
const REMOTE_EXEC_TIMEOUT_MS = 15000;

/** Wrap a remote execCommand in a Promise.race timeout (REMOTE_EXEC_TIMEOUT_MS). */
async function execWithTimeout(
  conn: SSHClientType,
  command: string,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`remote exec timeout after ${REMOTE_EXEC_TIMEOUT_MS}ms`)),
        REMOTE_EXEC_TIMEOUT_MS,
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// 1. readIdentityFile — <key>/<key>.md
// ---------------------------------------------------------------------------

/** Result shape for identity file reads. Matches the wire shape "identity:identity-file". */
export async function readIdentityFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, identityKey + ".md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #95: shellEscape produces single-quoted
  // 'identityKey', but wrapping that inside outer double-quotes preserves
  // the single quotes as LITERAL path characters (path became
  // $HOME/fleet/identities/'moxie'/'moxie'.md). identityKey is already
  // validated by IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ — none of those
  // characters are shell-special inside double quotes, so direct
  // interpolation is safe. shellEscape is redundant + broken in this
  // wrapping and is dropped for the string readers.
  const cmd = `cat "$HOME/fleet/identities/${identityKey}/${identityKey}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

// ---------------------------------------------------------------------------
// 1a. listIdentityKeysOnHost — Phase 68 fanout enumeration primitive
// ---------------------------------------------------------------------------

/**
 * Lists the identity folder names on the given host (LOCAL bind-mount or REMOTE SSH).
 *
 * Purpose: Phase 68 Plan 02 disk-fanout enumeration primitive. The GET /identities
 * handler calls this once per unique hostId in the caller's identityHosts map, then
 * reads each returned key's .md file via readIdentityFile to build the merged roster.
 *
 * LOCAL branch (conn === null):
 *   - Reads getLocalIdentitiesRoot() via fs.readdir({ withFileTypes: true }).
 *   - ENOENT → returns [].
 *   - Keeps entries where isDirectory() === true AND IDENTITY_KEY_RE.test(name).
 *   - Returns sorted (lexicographic) array of names.
 *
 * REMOTE branch (conn !== null):
 *   - Runs `find "$HOME/fleet/identities" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null || true`
 *     via execWithTimeout (3s timeout matches other REMOTE ops).
 *   - `|| true` handles "identities dir missing" as empty stdout.
 *   - Splits stdout by newline, trims, drops empty strings.
 *   - Filters through IDENTITY_KEY_RE.
 *   - Returns sorted array.
 *
 * Errors propagate up — caller (GET / fanout handler) wraps each host call in
 * try/catch for per-host silent-swallow. Do NOT swallow inside this function:
 * that would mask real SSH exec bugs behind an empty response.
 */
export async function listIdentityKeysOnHost(
  conn: SSHClientType | null,
): Promise<string[]> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory() && IDENTITY_KEY_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  // REMOTE branch — find prints basenames only; || true handles missing dir
  const cmd =
    `find "$HOME/fleet/identities" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.length > 0 && IDENTITY_KEY_RE.test(name))
    .sort();
}

// ---------------------------------------------------------------------------
// 1b. readRoleFile — role/<role>.md via two-step (Phase 22 SRIC-06 / Plan 22-06)
// ---------------------------------------------------------------------------

/**
 * Read the identity's role file (~/fleet/roles/<role>/<role>.md).
 *
 * Byte-shape mirror of readIdentityFile: same wire shape `{markdown}`, same
 * LOCAL vs REMOTE branch structure. The role name is discovered internally
 * via resolveRoleForIdentity — the caller (WS handler / IdentityModal) never
 * sees the role, and the frontend contract stays (identityKey, hostId) per
 * D-CONTEXT § "Backend does the two-step" lock.
 *
 * Two-step happens BEFORE the LOCAL/REMOTE branch split so both branches share
 * the same role → path substitution (matches the pattern established by
 * readIdentityBounties / readIdentityHistory in Plan 22-01).
 *
 * Throws (via resolveRoleForIdentity) when the identity file lacks role:
 * frontmatter — no fallback per D-CONTEXT § "No no-role fallback branches"
 * (LOCKED with user 2026-08-04). Returns {markdown: ""} when the role file
 * itself is missing on disk (LOCAL ENOENT / REMOTE empty stdout via `|| true`)
 * but the identity did have valid role frontmatter — this is normal for a
 * freshly-birthed role that hasn't been edited yet.
 */
export async function readRoleFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  // Two-step: resolve role BEFORE the branch split. Throws (no fallback) if
  // role is missing or fails IDENTITY_KEY_RE. Role is IDENTITY_KEY_RE-safe
  // for shell interpolation after this line (defense-in-depth per T-22-06-01).
  const role = await resolveRoleForIdentity(conn, identityKey);

  if (conn === null) {
    // LOCAL branch — reads from ROLES_HOST_DIR (mirrors readIdentityFile
    // LOCAL pattern rooted at ~/fleet/roles/<role>/<role>.md)
    const root = getLocalRolesRoot();
    const filePath = path.join(root, role, role + ".md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — direct interpolation is safe: role passed
  // IDENTITY_KEY_RE inside resolveRoleForIdentity (same defense as
  // readIdentityFile at patch #95 comment above). `|| true` swallows
  // ENOENT so the response is `{markdown: ""}` on missing role file.
  const cmd = `cat "$HOME/fleet/roles/${role}/${role}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

// ---------------------------------------------------------------------------
// 1c. readRoleFileByName — Phase 85 Plan 85-01 Task 1
// ---------------------------------------------------------------------------

/**
 * Read a role file (~/fleet/roles/<roleName>/<roleName>.md) directly by
 * role name — WITHOUT the identity-file two-step used by readRoleFile above.
 *
 * Wave-1 need: GET /identities per-host fanout resolves each identity's role
 * via extractRoleFromMarkdown, then wants to read that role's cosmetics from
 * the role file. A per-host memo caches the read so multiple identities of
 * the same role don't re-hit disk (T-85-01-03). Since the caller already
 * knows the role name (extracted from the identity markdown), the two-step
 * would be redundant SSH work — this reader takes roleName as an explicit
 * argument.
 *
 * Byte-shape mirror of readRoleFile's LOCAL/REMOTE branch structure:
 *   LOCAL: getLocalRolesRoot() + <roleName>/<roleName>.md via fs.readFile,
 *          ENOENT → {markdown: ""}.
 *   REMOTE: `cat "$HOME/fleet/roles/${roleName}/${roleName}.md" 2>/dev/null
 *           || true` via execWithTimeout, empty stdout → {markdown: ""}.
 *
 * ROLE_NAME_PATTERN gate (T-85-01-01): defense-in-depth for the SSH
 * interpolation. roleName arrives here via the identity's role: frontmatter,
 * which is separately validated by IDENTITY_KEY_RE inside
 * resolveRoleForIdentity — but this reader is also called from paths where
 * roleName arrived via the API layer or the frontend, so re-validate at the
 * function boundary to keep the shell-safety invariant local to this
 * function's body. IDENTITY_KEY_RE (identity keys) permits `_` and 64-char
 * length; ROLE_NAME_PATTERN (role names) is stricter kebab-case-lowercase
 * per the fleet role-naming convention.
 */
export async function readRoleFileByName(
  conn: SSHClientType | null,
  roleName: string,
): Promise<{ markdown: string }> {
  // Gate the roleName BEFORE any I/O — same defense-in-depth pattern as
  // resolveRoleForIdentity's IDENTITY_KEY_RE gate above.
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error(`invalid roleName: ${roleName}`);
  }

  if (conn === null) {
    // LOCAL branch — reads from ROLES_HOST_DIR (mirrors readRoleFile LOCAL
    // pattern; same ~/fleet/roles/<name>/<name>.md path shape).
    const root = getLocalRolesRoot();
    const filePath = path.join(root, roleName, roleName + ".md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — roleName passed ROLE_NAME_PATTERN above, so direct
  // interpolation is shell-safe (same defense as readRoleFile L578).
  const cmd = `cat "$HOME/fleet/roles/${roleName}/${roleName}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

// ---------------------------------------------------------------------------
// 2. readIdentityHistory — <key>/history.md
// ---------------------------------------------------------------------------

/** Result shape for history reads. Matches the wire shape "identity:history".
 * Phase 18 / IDMEDIT-02: widened to also carry `markdown` (raw file body)
 * so the HistoryTab editor can populate its textarea without a separate read.
 * The `entries` field is unchanged — additive widening, no consumers broken.
 *
 * Phase 22 SRIC-01: reads via two-step — identity file → role: frontmatter →
 * role folder (~/fleet/roles/<role>/history.md). Public signature untouched;
 * frontend contract stays (identityKey, hostId) per D-CONTEXT lockdown. See
 * resolveRoleForIdentity above for the no-fallback semantics.
 */
export async function readIdentityHistory(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ entries: string[]; markdown: string }> {
  // Phase 22 SRIC-01: two-step — resolve role from identity file's frontmatter
  // before any artifact read. Throws (no fallback) if role is missing or fails
  // the IDENTITY_KEY_RE shell-safety gate. Propagates to WS `error` field.
  const role = await resolveRoleForIdentity(conn, identityKey);

  if (conn === null) {
    // LOCAL branch — reads from ROLES_HOST_DIR (mirrors identity-folder pattern
    // pre-SRIC-01 but rooted at ~/fleet/roles/<role>/history.md)
    const root = getLocalRolesRoot();
    const filePath = path.join(root, role, "history.md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      const entries = markdown
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .reverse();
      return { entries, markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { entries: [], markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #94: `|| true` so missing history.md resolves as
  // empty stdout instead of throwing "Command exited with code 1".
  // Patch #95: direct interpolation is shell-safe because BOTH identityKey
  // (via caller) AND role (via resolveRoleForIdentity's IDENTITY_KEY_RE gate)
  // are validated by /^[a-z0-9_-]{1,64}$/ — none of those characters are
  // shell-special inside double quotes.
  const cmd = `cat "$HOME/fleet/roles/${role}/history.md" 2>/dev/null || true`;
  const markdown = await execWithTimeout(conn, cmd);
  if (!markdown) return { entries: [], markdown: "" };
  const entries = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reverse();
  return { entries, markdown };
}

// ---------------------------------------------------------------------------
// 3. readIdentityWakeups — <key>/wakeups/*.json
// ---------------------------------------------------------------------------

// Patch #154: expose `slug` (filename stem, addressability for updates) and
// raw `schedule` (unknown, so the modal's editor can render + edit it
// without a wire-side re-humanization round-trip). Existing fields stay
// so the read shape is a superset.
type Wakeup = {
  slug: string;
  name: string;
  enabled: boolean;
  scheduleHuman: string;
  schedule: unknown;
  instruction: string;
};

/** Slug regex for wakeup filenames — kebab/snake, 1-80 chars. Enforced
 *  before we ever touch the filesystem so a hostile slug can't traverse
 *  into `..` or otherwise escape the identity dir. */
export const IDENTITY_SLUG_RE = /^[a-z0-9_-]{1,80}$/i;

/** Result shape for wakeups reads. Matches the wire shape "identity:wakeups". */
export async function readIdentityWakeups(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ wakeups: Wakeup[] }> {
  if (conn === null) {
    // LOCAL branch (mirrors server.ts lines 1319-1351)
    const root = getLocalIdentitiesRoot();
    const wakeupsDir = path.join(root, identityKey, "wakeups");
    let dirEntries: string[];
    try {
      dirEntries = await fs.readdir(wakeupsDir);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { wakeups: [] };
      }
      throw err;
    }
    const jsonFiles = dirEntries.filter((e) => e.endsWith(".json"));
    const wakeups: Wakeup[] = [];
    for (const filename of jsonFiles) {
      const filePath = path.join(wakeupsDir, filename);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const stem = filename.replace(/\.json$/, "");
        const name = typeof parsed.name === "string" ? parsed.name : stem;
        const enabled =
          typeof parsed.enabled === "boolean" ? parsed.enabled : false;
        const instruction =
          typeof parsed.instruction === "string" ? parsed.instruction : "";
        const scheduleHuman = humanizeWakeupSchedule(parsed.schedule);
        wakeups.push({ slug: stem, name, enabled, scheduleHuman, schedule: parsed.schedule ?? null, instruction });
      } catch (err) {
        sshLogger.error(
          "identity-artifact-reader: failed to parse local wakeup JSON",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "identity_wakeups_local_parse_error",
            identityKey,
            filename,
          },
        );
        // Skip poisoned entry — one bad file must not poison the list.
      }
    }
    return { wakeups };
  }

  // REMOTE branch — delimiter-based one-liner (one round-trip for all wakeup files)
  // Patch #95: direct interpolation (see readIdentityFile for the bug).
  const cmd =
    `cd "$HOME/fleet/identities/${identityKey}/wakeups" 2>/dev/null && ` +
    'for f in *.json; do echo "===FILE:$f==="; cat "$f"; done';
  let stdout: string;
  try {
    stdout = await execWithTimeout(conn, cmd);
  } catch {
    // Wakeups dir likely doesn't exist — treat as empty (matches ENOENT semantics).
    return { wakeups: [] };
  }

  if (!stdout) return { wakeups: [] };

  const wakeups: Wakeup[] = [];
  // Split on ===FILE: delimiter; first chunk is empty (before the first marker).
  const chunks = stdout.split("===FILE:");
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    // chunk = "<filename>.json===\n<json content>"
    const separatorIdx = chunk.indexOf("===");
    if (separatorIdx === -1) continue;
    const filename = chunk.slice(0, separatorIdx).trim();
    const jsonContent = chunk.slice(separatorIdx + 3).trim();
    if (!filename.endsWith(".json") || !jsonContent) continue;
    try {
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;
      const stem = filename.replace(/\.json$/, "");
      const name = typeof parsed.name === "string" ? parsed.name : stem;
      const enabled =
        typeof parsed.enabled === "boolean" ? parsed.enabled : false;
      const instruction =
        typeof parsed.instruction === "string" ? parsed.instruction : "";
      const scheduleHuman = humanizeWakeupSchedule(parsed.schedule);
      wakeups.push({ slug: stem, name, enabled, scheduleHuman, schedule: parsed.schedule ?? null, instruction });
    } catch (err) {
      sshLogger.error(
        "identity-artifact-reader: failed to parse remote wakeup JSON",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "identity_wakeups_remote_parse_error",
          identityKey,
          filename,
        },
      );
      // Skip poisoned entry.
    }
  }
  return { wakeups };
}

// ---------------------------------------------------------------------------
// 4. readIdentityHandoff — <key>/handoff.md
// ---------------------------------------------------------------------------

/** Result shape for handoff reads. Matches the wire shape "identity:handoff". */
export async function readIdentityHandoff(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "handoff.md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return { markdown: "" };
      }
      throw err;
    }
  }

  // REMOTE branch — patch #94: `|| true` so missing handoff.md resolves as
  // empty stdout instead of throwing "Command exited with code 1".
  // Patch #95: direct interpolation (see readIdentityFile for the bug).
  const cmd = `cat "$HOME/fleet/identities/${identityKey}/handoff.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}

// ---------------------------------------------------------------------------
// 6. writeIdentityWakeupUpdate — patch a single wakeup spec file
// ---------------------------------------------------------------------------
//
// Patch #154: first write path on identity artifacts. Merges `enabled` and/or
// `schedule` into ~/fleet/identities/<key>/wakeups/<slug>.json. The wakeup
// scheduler reloads specs every ~30s (see id skill § Scheduled wake-ups), so
// the change takes effect within one poll — no scheduler restart.
//
// Local branch: JS reads → mutates → writes with 2-space indent.
// Remote branch: python3 one-liner reads → mutates → writes (jq is not
// universally installed on identity boxes; python3 IS, because the scheduler
// itself is python3). The one-liner writes to a temp file and moves into
// place so a mid-write kill can't leave a truncated JSON file.
//
// Quick 260731-2pa: `WakeupUpdate` widened to also accept `name` and
// `instruction`. The form-based editor in WakeupsTab.tsx (which replaces the
// raw JSON schedule textarea from patch #154) writes the full spec on Save
// — {name, enabled, schedule, instruction} — so all four fields need a
// write path. The remote-branch python script's generic `for k,v in
// u.items(): d[k]=v` already merges any key; only the local branch needs
// the two new explicit assignments.

export type WakeupUpdate = {
  enabled?: boolean;
  schedule?: unknown;
  name?: string;
  instruction?: string;
};

/**
 * Phase 72 Plan 01: full-spec shape for creating a new wakeup file (both
 * identity-scope + role-scope create writers). Slug is derived from `name`
 * via kebab-case normalization inside the writer. All fields required —
 * unlike WakeupUpdate (which is a partial-patch for an existing file),
 * WakeupSpec is the full JSON body of a new file.
 *
 * `schedule` stays `Record<string, unknown>` (not a discriminated union) so
 * Skynet doesn't need a co-deploy every time Nelly adds a new schedule type
 * to the scheduler side — the scheduler owns the schema. The writer only
 * enforces "schedule is an object with a non-empty string `type`".
 */
export type WakeupSpec = {
  name: string;
  enabled: boolean;
  schedule: Record<string, unknown>;
  instruction: string;
};

/** Merge `updates` into wakeups/<wakeupSlug>.json. Caller validates slug
 *  against IDENTITY_SLUG_RE before invoking. Throws on filesystem/parse errors
 *  or if the spec file doesn't exist. */
export async function writeIdentityWakeupUpdate(
  conn: SSHClientType | null,
  identityKey: string,
  wakeupSlug: string,
  updates: WakeupUpdate,
): Promise<void> {
  // Basic schema guard — refuse a schedule payload that isn't an object with a
  // recognized `type`. We deliberately don't lock down further (the scheduler
  // owns the schema; a new schedule type Nelly adds shouldn't require an
  // atomic co-deploy of Skynet).
  if (updates.schedule !== undefined) {
    if (typeof updates.schedule !== "object" || updates.schedule === null) {
      throw new Error("schedule must be an object");
    }
    const t = (updates.schedule as Record<string, unknown>).type;
    if (typeof t !== "string" || t.length === 0) {
      throw new Error("schedule.type must be a non-empty string");
    }
  }
  if (updates.enabled !== undefined && typeof updates.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  // Quick 260731-2pa: name/instruction guards. name must be a non-empty
  // string (empty-name spec files break the scheduler's dedup key); instruction
  // is any string (including empty, in case the user clears it).
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || updates.name.length === 0) {
      throw new Error("name must be a non-empty string");
    }
  }
  if (updates.instruction !== undefined && typeof updates.instruction !== "string") {
    throw new Error("instruction must be a string");
  }

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "wakeups", wakeupSlug + ".json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (updates.enabled !== undefined) parsed.enabled = updates.enabled;
    if (updates.schedule !== undefined) parsed.schedule = updates.schedule;
    // Quick 260731-2pa: name/instruction assignment. Remote branch's python
    // one-liner already merges these generically — no script change needed.
    if (updates.name !== undefined) parsed.name = updates.name;
    if (updates.instruction !== undefined) parsed.instruction = updates.instruction;
    const next = JSON.stringify(parsed, null, 2) + "\n";
    // Atomic-ish write: temp file + rename (fs.writeFile is not atomic on
    // its own; a mid-write crash can leave a truncated file). Same guard the
    // remote branch uses.
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, next, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch: python3 reads the file, applies updates from stdin, writes
  // via tmp+rename. `updates` is JSON-encoded and piped in — no shell escaping
  // concerns for the payload itself.
  // We validate slug shape here as a second belt on top of the caller's check;
  // the slug is interpolated into a shell path so this matters.
  if (!IDENTITY_SLUG_RE.test(wakeupSlug)) {
    throw new Error("invalid wakeup slug");
  }
  const script =
    'import json,os,sys\n' +
    'p=sys.argv[1]\n' +
    'u=json.loads(sys.stdin.read())\n' +
    'with open(p,"r") as f: d=json.load(f)\n' +
    'for k,v in u.items(): d[k]=v\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n';
  const payload = JSON.stringify(updates).replace(/'/g, "'\\''");
  const cmd =
    `printf '%s' '${payload}' | python3 -c ${shellEscape(script)} ` +
    `"$HOME/fleet/identities/${identityKey}/wakeups/${wakeupSlug}.json"`;
  await execWithTimeout(conn, cmd);
}

// ---------------------------------------------------------------------------
// 6a2. Shared wake-up spec helpers — used by writeIdentityWakeupCreate
// ---------------------------------------------------------------------------
//
// Phase 134 Plan 134-02: the role-scope writers that also called these were
// deleted (D-10). The helpers stay live for writeIdentityWakeupCreate below
// (per-identity CRUD is still in use — D-09).
// `normalizeWakeupSlug` is also `export`ed because Plan 128-01 wired the new
// global-wakeups REST router to import it.

/** Kebab-case slug normalizer.
 *  Lowercase, alphanumerics + hyphens, trim leading/trailing hyphens. Empty
 *  result means the input has no legal characters — caller throws in that
 *  case. */
export function normalizeWakeupSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Validate a WakeupSpec's field shapes. Throws with a specific message per
 *  violation. Consumed by writeIdentityWakeupCreate below. */
function validateWakeupSpec(spec: WakeupSpec): void {
  if (typeof spec.name !== "string" || spec.name.length === 0) {
    throw new Error("name must be a non-empty string");
  }
  if (typeof spec.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  if (typeof spec.instruction !== "string") {
    throw new Error("instruction must be a string");
  }
  if (typeof spec.schedule !== "object" || spec.schedule === null) {
    throw new Error("schedule must be an object");
  }
  const t = (spec.schedule as Record<string, unknown>).type;
  if (typeof t !== "string" || t.length === 0) {
    throw new Error("schedule.type must be a non-empty string");
  }
}

// ---------------------------------------------------------------------------
// 6a4. writeIdentityWakeupCreate — create a new identity-scope wakeup
// ---------------------------------------------------------------------------
//
// Phase 72 Plan 01: parity gap closure. Identity-scope wakeups today support
// list + update (patches #17g + #154) but NOT create + delete. This adds the
// create path, mirroring writeRoleWakeupCreate but rooted at
// ~/fleet/identities/<key>/wakeups/ (no two-step).

/** Create a new ~/fleet/identities/<identityKey>/wakeups/<slug>.json where
 *  <slug> is derived from spec.name via kebab-case. Throws "wakeup with this
 *  name already exists" on clobber. Returns the refreshed {wakeups} list
 *  post-write. */
export async function writeIdentityWakeupCreate(
  conn: SSHClientType | null,
  identityKey: string,
  spec: WakeupSpec,
): Promise<{ wakeups: Wakeup[] }> {
  validateWakeupSpec(spec);
  const slug = normalizeWakeupSlug(spec.name);
  if (!IDENTITY_SLUG_RE.test(slug)) {
    throw new Error("name normalizes to empty or invalid slug");
  }
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  const body = JSON.stringify(
    { name: spec.name, enabled: spec.enabled, schedule: spec.schedule, instruction: spec.instruction },
    null,
    2,
  ) + "\n";

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const wakeupsDir = path.join(root, identityKey, "wakeups");
    await fs.mkdir(wakeupsDir, { recursive: true });
    const filePath = path.join(wakeupsDir, slug + ".json");
    try {
      await fs.access(filePath);
      throw new Error("wakeup with this name already exists");
    } catch (err: unknown) {
      const isEnoent =
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT";
      if (!isEnoent) {
        throw err;
      }
    }
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, body, "utf-8");
    await fs.rename(tmpPath, filePath);
    return readIdentityWakeups(conn, identityKey);
  }

  // REMOTE branch — same pattern as writeRoleWakeupCreate, identity path.
  const targetPath = `$HOME/fleet/identities/${identityKey}/wakeups/${slug}.json`;
  const preCheckCmd =
    `mkdir -p "$HOME/fleet/identities/${identityKey}/wakeups" && ` +
    `[ -e "${targetPath}" ] && echo EXISTS || echo OK`;
  const preCheck = (await execWithTimeout(conn, preCheckCmd)).trim();
  if (preCheck.endsWith("EXISTS")) {
    throw new Error("wakeup with this name already exists");
  }
  const script =
    'import json,os,sys\n' +
    'p=sys.argv[1]\n' +
    'd=json.loads(sys.stdin.read())\n' +
    'tmp=p+".tmp"\n' +
    'with open(tmp,"w") as f: json.dump(d,f,indent=2); f.write("\\n")\n' +
    'os.rename(tmp,p)\n';
  const payload = JSON.stringify({
    name: spec.name,
    enabled: spec.enabled,
    schedule: spec.schedule,
    instruction: spec.instruction,
  }).replace(/'/g, "'\\''");
  const writeCmd =
    `printf '%s' '${payload}' | python3 -c ${shellEscape(script)} "${targetPath}"`;
  await execWithTimeout(conn, writeCmd);
  return readIdentityWakeups(conn, identityKey);
}

// ---------------------------------------------------------------------------
// 6a5. writeIdentityWakeupDelete — delete an identity-scope wakeup
// ---------------------------------------------------------------------------

/** Delete ~/fleet/identities/<identityKey>/wakeups/<wakeupSlug>.json.
 *  Idempotent (swallows ENOENT / uses `rm -f`). Returns the refreshed
 *  {wakeups} list post-delete. */
export async function writeIdentityWakeupDelete(
  conn: SSHClientType | null,
  identityKey: string,
  wakeupSlug: string,
): Promise<{ wakeups: Wakeup[] }> {
  if (!IDENTITY_SLUG_RE.test(wakeupSlug)) {
    throw new Error("invalid wakeup slug");
  }
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "wakeups", wakeupSlug + ".json");
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        // Idempotent — file already gone.
      } else {
        throw err;
      }
    }
    return readIdentityWakeups(conn, identityKey);
  }

  const cmd = `rm -f "$HOME/fleet/identities/${identityKey}/wakeups/${wakeupSlug}.json"`;
  await execWithTimeout(conn, cmd);
  return readIdentityWakeups(conn, identityKey);
}

// ---------------------------------------------------------------------------
// 6b. Markdown atomic write primitives — Phase 18 (IDMEDIT-06)
// ---------------------------------------------------------------------------
//
// Three exported writers (writeIdentityFile, writeIdentityHistory,
// writeIdentityHandoff) plus one exported SFTP helper (writeMarkdownFileAtomic —
// exported in Phase 22 Plan 22-02 SRIC-02 for the identity-birth Step 2.5
// pre-write, which needs to write a role-frontmatter-seeded identity file
// before the id skill's load-existing branch fires. Previously private.)
// and a byte-cap constant (IDMEDIT_MAX_MARKDOWN_BYTES).
//
// LOCAL branch (conn === null): tmp+rename via fs.writeFile + fs.rename —
//   mirrors the wakeup writer's lines 713-718 pattern byte-for-byte.
// REMOTE branch (conn is SSHClientType): SFTP tmp+rename via ssh2 SFTPWrapper.
//   execCommand in tmux-helper.ts does NOT support stdin (see lines 1-50 there),
//   so arbitrary markdown payloads cannot be safely streamed through shell
//   interpolation. SFTP delivers UTF-8 bytes as a first-class stream and
//   matches the SFTP idiom already used in file-manager-session.ts and
//   host-transfer.ts. Only the target path is interpolated into a string;
//   identityKey is regex-validated before path construction (D-IDMEDIT-06).
//
// Security posture per threat model:
//   T-18-01 / T-18-02: IDENTITY_KEY_RE validated at handler AND inside each
//     REMOTE branch (double-belt, matches writeIdentityWakeupUpdate line 727).
//   T-18-03: IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000 hard cap checked via
//     Buffer.byteLength before opening SFTP — mirrors SPEAK_TEXT_MAX pattern.
//   T-18-06 / T-18-07: writeMarkdownFileAtomic uses SFTP tmp+rename with
//     try/finally sftp.end() and best-effort tmp cleanup on error.

/** Maximum UTF-8 byte size for markdown payloads written via the three
 *  identity markdown writers. Mirrors SPEAK_TEXT_MAX = 25000 from voice.ts;
 *  2MB is generous for identity files (nelly.md is ~40KB) while capping DoS. */
export const IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000;

/** Maximum binary byte size for avatar sibling files written via
 *  writeAvatarSiblingFile (Phase 66 Plan 66-01 Track 1 / T-66-01-02).
 *  5MB — headroom over multer's 2MB birth cap (see identities.ts fileSize
 *  limit); avatar cannot exceed this even if a future manual-upload path
 *  raises the multer cap. Mirrors the SPEAK_TEXT_MAX / IDMEDIT_MAX_MARKDOWN_BYTES
 *  DoS-cap-before-open-SFTP pattern. */
export const IDMEDIT_MAX_AVATAR_BYTES = 5_000_000;

/** Canonical avatar file extensions accepted on disk. Kept as a typed const
 *  tuple so the writeAvatarSiblingFile parameter typing statically forbids
 *  arbitrary strings (T-66-01-01). image/jpeg → jpg (not jpeg) matches the
 *  fleet's Phase A sibling-file extensions. */
export const AVATAR_EXT_VALUES = [
  "webp",
  "png",
  "jpg",
  "gif",
  "svg",
] as const;
export type AvatarExt = typeof AVATAR_EXT_VALUES[number];

/** MIME → on-disk extension map for the birth avatar sibling file. Only the
 *  five image types Skynet's birth upload path accepts are present; anything
 *  else returns undefined so writeAvatarSiblingFile's caller can throw a loud
 *  "unsupported avatar mime for on-disk write" instead of silently no-op'ing. */
export const MIME_TO_AVATAR_EXT: Record<string, AvatarExt> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * SFTP helper — promise-wraps conn.sftp → sftp.writeFile(tmp) →
 * sftp.ext_openssh_rename(tmp, target). On any error: best-effort
 * sftp.unlink(tmp) cleanup (fire-and-forget) then re-throw. Always closes
 * SFTP in finally.
 *
 * Called from the three REMOTE-branch identity writers below AND from the
 * Phase 22 Plan 22-02 identity-birth Step 2.5 pre-write (needs to write a
 * role-frontmatter-seeded identity file BEFORE the id skill fires). The
 * SFTP tmp+rename byte-shape is defined in one place (one audit surface per
 * D-IDMEDIT-06).
 *
 * WHY ext_openssh_rename AND NOT sftp.rename (quick 260802-qrw, root-caused
 * by @stacy on ceo-skynet 2026-08-02, confirmed on skynet-ec2):
 *
 *   SFTPv3's SSH_FXP_RENAME cannot atomically overwrite an existing target.
 *   OpenSSH's process_rename tries link(old, new) first; when `new` already
 *   exists, link() returns EEXIST. OpenSSH's errno_to_portable() has no
 *   case for EEXIST and falls through to SSH2_FX_FAILURE — the ssh2 client
 *   surfaces this as a generic `Error: Failure` with code 4 and an empty
 *   error string. Every overwrite of an existing identity file therefore
 *   fails; only first-time writes (target missing) succeed. That was the
 *   root cause of user's IdentityModal "sometimes it works, sometimes
 *   it doesn't" saves — all her edits are on EXISTING identity files.
 *
 *   The posix-rename@openssh.com extension (ext_openssh_rename) has POSIX
 *   rename(2) semantics: atomic overwrite of an existing target, no
 *   link()/EEXIST detour. It is advertised by every OpenSSH ≥5.1 (2008+)
 *   and is universal across user's fleet — no fallback needed. Any
 *   hypothetical missing-extension case surfaces as ssh2 throwing
 *   "Server does not support this extended request" synchronously, which
 *   gets caught by the try/catch below and logged with the existing shape.
 *
 *   The regression test at identity-artifact-reader.remote-writes.test.ts
 *   installs a throwing trap on sftp.rename that fails loudly with a
 *   diagnostic naming the fix if a future refactor reverts this call site.
 */
export async function writeMarkdownFileAtomic(
  conn: SSHClientType | null,
  targetPath: string,
  contents: string,
): Promise<void> {
  const tmpPath = targetPath + ".tmp";
  const buf = Buffer.from(contents, "utf-8");
  const bytes = buf.byteLength;

  // LOCAL branch — conn === null routes to Node fs tmp+rename (mirrors
  // writeAvatarSiblingFile's LOCAL branch structure at L2104-L2111 and
  // per-identity-file.ts writeIdentityFile's LOCAL branch). Callers may
  // pass a $HOME-prefixed path (matching the REMOTE $HOME-literal convention
  // used by identity-birth Step 2.5).
  //
  // $HOME resolution — do NOT use os.homedir(). Inside the Skynet container
  // os.homedir() returns the runtime user's home (e.g. /root) which is NOT
  // where the host-home bind mount lives. The bind mount is at /host-home
  // (via HOME_HOST_DIR), and IDENTITIES_HOST_DIR points inside it at
  // /host-home/fleet/identities. Take the parent of IDENTITIES_HOST_DIR as
  // the "fleet root inside the container" (= /host-home/fleet) and
  // substitute `$HOME/fleet` → that. Fallback for non-container runs uses
  // os.homedir()/fleet, mirroring getLocalIdentitiesRoot's fallback shape.
  //
  // LOCAL contract: `$HOME/fleet/*` and `$HOME/fleet` route through the fleet
  // root; anything else is treated as an absolute path. Plain `$HOME/<non-fleet>`
  // shapes are NOT supported — a future caller needing user-home writes outside
  // the fleet subtree must route through HOME_HOST_DIR explicitly (see
  // local-fleet-install.ts's getLocalHomeRoot pattern).
  if (conn === null) {
    // Phase 117 M-K (2026-09-19): derive fleet root from getLocalIdentitiesRoot's
    // parent — that helper now HOME_HOST_DIR-based, so this stays correct
    // whether the container / native / test-override path is in effect.
    const fleetRoot = path.dirname(getLocalIdentitiesRoot());
    let localPath: string;
    if (targetPath.startsWith("$HOME/fleet/")) {
      localPath = path.join(fleetRoot, targetPath.slice("$HOME/fleet/".length));
    } else if (targetPath === "$HOME/fleet") {
      localPath = fleetRoot;
    } else {
      localPath = targetPath;
    }
    const localTmpPath = localPath + ".tmp";
    try {
      await fs.writeFile(localTmpPath, buf, { mode: 0o644 });
      await fs.rename(localTmpPath, localPath);
      sshLogger.info("identity-artifact-reader: identity_markdown_write (local)", {
        operation: "identity_markdown_write",
        targetPath: localPath,
        bytes,
        branch: "local",
      });
    } catch (err) {
      sshLogger.error(
        "identity-artifact-reader: identity_markdown_write (local) failed",
        err instanceof Error ? err : new Error(String(err)),
        { operation: "identity_markdown_write_error", targetPath: localPath, bytes, branch: "local" },
      );
      // Best-effort cleanup of the .tmp file — fire-and-forget
      fs.unlink(localTmpPath).catch(() => {});
      throw err;
    }
    return;
  }

  // Promise-wrap conn.sftp — mirrors file-manager-session.ts getSessionSftp idiom
  // but without session caching (identity writes are one-shot per WS message).
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });

  // $HOME expansion — SFTP servers don't expand shell variables. If caller
  // passed a `$HOME/...`-prefixed path (the fleet-broker convention shared
  // with spawn-requests + image-gen), resolve the remote home via
  // sftp.realpath(".") — SFTP cwd on connection is the user's home dir.
  let resolvedTarget = targetPath;
  let resolvedTmp = tmpPath;
  if (targetPath.startsWith("$HOME/") || targetPath === "$HOME") {
    const remoteHome = await new Promise<string>((resolve, reject) => {
      sftp.realpath(".", (err, absPath) => {
        if (err) return reject(err);
        resolve(absPath);
      });
    });
    if (targetPath === "$HOME") {
      resolvedTarget = remoteHome;
    } else {
      resolvedTarget = remoteHome + "/" + targetPath.slice("$HOME/".length);
    }
    resolvedTmp = resolvedTarget + ".tmp";
  }

  try {
    // Write to .tmp first (atomic-write pattern: crash leaves prior file intact)
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(resolvedTmp, buf, { mode: 0o644 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Rename tmp → target via posix-rename@openssh.com (atomic overwrite;
    // see prologue for the EEXIST → SSH2_FX_FAILURE trap that made
    // plain sftp.rename unsafe for existing-file overwrites).
    await new Promise<void>((resolve, reject) => {
      sftp.ext_openssh_rename(resolvedTmp, resolvedTarget, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    sshLogger.info("identity-artifact-reader: identity_markdown_write", {
      operation: "identity_markdown_write",
      targetPath: resolvedTarget,
      bytes,
    });
  } catch (err) {
    sshLogger.error(
      "identity-artifact-reader: identity_markdown_write failed",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_markdown_write_error", targetPath: resolvedTarget, bytes },
    );
    // Best-effort cleanup of the .tmp file — fire-and-forget
    sftp.unlink(resolvedTmp, () => {});
    throw err;
  } finally {
    sftp.end();
  }
}

/**
 * SFTP binary tmp+rename helper — Phase 66 Plan 66-01 Track 1.
 *
 * Byte-for-byte mirror of writeMarkdownFileAtomic's promise-wrap discipline:
 * conn.sftp → sftp.writeFile(tmp, bytes, {mode:0o644}) →
 * sftp.ext_openssh_rename(tmp, target). On any error: best-effort
 * sftp.unlink(tmp) fire-and-forget then re-throw. Always closes SFTP in
 * finally. See writeMarkdownFileAtomic's prologue (above) for the quick
 * 260802-qrw rationale on why ext_openssh_rename is used instead of
 * sftp.rename — the same POSIX-rename atomic-overwrite semantics apply to
 * avatar sibling files that get replaced on subsequent identity edits.
 *
 * WHY NOT COLLAPSE INTO writeMarkdownFileAtomic:
 *   - writeMarkdownFileAtomic's signature accepts `contents: string` and its
 *     logger operation tag is `identity_markdown_write`. Avatar payloads are
 *     binary bytes with their own log tag `identity_avatar_write`. Keeping
 *     the two helpers separate preserves the log-tag separation for on-call
 *     debugging (grep for `identity_avatar_write` when an avatar write is
 *     the suspected culprit) and avoids leaking a string-vs-buffer overload
 *     into a helper whose current call sites are all string-payload markdown.
 *   - The regression trap in identity-artifact-reader.remote-writes.test.ts's
 *     buildMockConn() (sftp.rename → throws with the fix name) still guards
 *     this helper transitively because the throwing trap is on the SFTP mock,
 *     not on any specific caller.
 */
async function sftpWriteBinaryAtomic(
  conn: SSHClientType,
  targetPath: string,
  bytes: Buffer,
): Promise<void> {
  const tmpPath = targetPath + ".tmp";
  const byteLen = bytes.byteLength;

  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });

  // $HOME expansion — same rationale as writeMarkdownFileAtomic's REMOTE
  // branch above: SFTP doesn't expand shell variables. Resolve via
  // sftp.realpath(".") whose cwd is the connecting user's home dir.
  let resolvedTarget = targetPath;
  let resolvedTmp = tmpPath;
  if (targetPath.startsWith("$HOME/") || targetPath === "$HOME") {
    const remoteHome = await new Promise<string>((resolve, reject) => {
      sftp.realpath(".", (err, absPath) => {
        if (err) return reject(err);
        resolve(absPath);
      });
    });
    if (targetPath === "$HOME") {
      resolvedTarget = remoteHome;
    } else {
      resolvedTarget = remoteHome + "/" + targetPath.slice("$HOME/".length);
    }
    resolvedTmp = resolvedTarget + ".tmp";
  }

  try {
    // Write to .tmp first (atomic-write pattern: crash leaves prior file intact)
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(resolvedTmp, bytes, { mode: 0o644 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Rename tmp → target via posix-rename@openssh.com (atomic overwrite;
    // see writeMarkdownFileAtomic's prologue for the EEXIST → SSH2_FX_FAILURE
    // trap that made plain sftp.rename unsafe for existing-file overwrites).
    await new Promise<void>((resolve, reject) => {
      sftp.ext_openssh_rename(resolvedTmp, resolvedTarget, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    sshLogger.info("identity-artifact-reader: identity_avatar_write", {
      operation: "identity_avatar_write",
      targetPath: resolvedTarget,
      bytes: byteLen,
    });
  } catch (err) {
    sshLogger.error(
      "identity-artifact-reader: identity_avatar_write failed",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_avatar_write_error", targetPath: resolvedTarget, bytes: byteLen },
    );
    // Best-effort cleanup of the .tmp file — fire-and-forget
    sftp.unlink(resolvedTmp, () => {});
    throw err;
  } finally {
    sftp.end();
  }
}

/**
 * Public binary tmp+rename helper — Phase 116 Plan 116-03 Task 1.
 *
 * The generic, path-arbitrary counterpart to writeMarkdownFileAtomic for
 * binary payloads. Two branches, byte-shape-identical to
 * writeMarkdownFileAtomic:
 *
 *   LOCAL (conn === null)  — resolves $HOME/fleet in the same way
 *     writeMarkdownFileAtomic does (IDENTITIES_HOST_DIR parent for
 *     $HOME/fleet; anything else is treated as an absolute path) and writes
 *     bytes via fs.writeFile(tmp) → fs.rename(tmp, target). Best-effort tmp
 *     cleanup on error.
 *   REMOTE (conn is SSHClientType) — delegates to the existing private
 *     sftpWriteBinaryAtomic above (ext_openssh_rename atomic overwrite).
 *
 * Callers pass a "$HOME/fleet/..." path convention (matching the REMOTE-
 * side SFTP $HOME expansion) and the LOCAL branch's substitution logic
 * routes it to the correct bind-mounted directory. This mirrors
 * writeMarkdownFileAtomic's LOCAL branch at L1968-L2005 exactly, only
 * substituting `bytes` (Buffer, no UTF-8 encoding) for `contents` (string).
 *
 * WHY NOT REUSE writeAvatarSiblingFile: writeAvatarSiblingFile carries three
 * avatar-specific guards (IDENTITY_KEY_RE, AVATAR_EXT_VALUES,
 * IDMEDIT_MAX_AVATAR_BYTES) plus a hard-coded target-path derivation that
 * doesn't apply to arbitrary $HOME/fleet-scoped writes (like the image-gen
 * PNG drops). This wrapper is the generic-shape counterpart.
 *
 * WHY NOT COLLAPSE INTO writeMarkdownFileAtomic: writeMarkdownFileAtomic's
 * signature accepts `contents: string` and its logger operation tag is
 * `identity_markdown_write`. Binary payloads deserve their own tag
 * (`image_gen_binary_write` here) for grep-ability during on-call debugging
 * and to avoid a string-vs-buffer overload leaking into a helper whose
 * markdown call sites all pass strings.
 */
export async function writeBinaryFileAtomic(
  conn: SSHClientType | null,
  targetPath: string,
  bytes: Buffer,
): Promise<void> {
  const byteLen = bytes.byteLength;

  // LOCAL branch — mirrors writeMarkdownFileAtomic. Same contract:
  // `$HOME/fleet/*` and `$HOME/fleet` route through the fleet root; anything
  // else is treated as an absolute path. Non-fleet `$HOME/` shapes not
  // supported (would need HOME_HOST_DIR routing — see local-fleet-install.ts).
  if (conn === null) {
    // Phase 117 M-K (2026-09-19): derive fleet root from getLocalIdentitiesRoot's
    // parent — that helper now HOME_HOST_DIR-based, so this stays correct
    // whether the container / native / test-override path is in effect.
    const fleetRoot = path.dirname(getLocalIdentitiesRoot());
    let localPath: string;
    if (targetPath.startsWith("$HOME/fleet/")) {
      localPath = path.join(fleetRoot, targetPath.slice("$HOME/fleet/".length));
    } else if (targetPath === "$HOME/fleet") {
      localPath = fleetRoot;
    } else {
      localPath = targetPath;
    }
    const localTmpPath = localPath + ".tmp";
    try {
      await fs.writeFile(localTmpPath, bytes, { mode: 0o644 });
      await fs.rename(localTmpPath, localPath);
      sshLogger.info("identity-artifact-reader: image_gen_binary_write (local)", {
        operation: "image_gen_binary_write",
        targetPath: localPath,
        bytes: byteLen,
        branch: "local",
      });
    } catch (err) {
      sshLogger.error(
        "identity-artifact-reader: image_gen_binary_write (local) failed",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "image_gen_binary_write_error",
          targetPath: localPath,
          bytes: byteLen,
          branch: "local",
        },
      );
      // Best-effort cleanup of the .tmp file — fire-and-forget.
      fs.unlink(localTmpPath).catch(() => {});
      throw err;
    }
    return;
  }

  // REMOTE branch — delegate to the existing private helper.
  return sftpWriteBinaryAtomic(conn, targetPath, bytes);
}

/** Write the avatar sibling file (<key>/<key>.<ext>) atomically.
 *
 * Phase 66 Plan 66-01 Track 1: the identity-birth orchestrator's Step 2.5
 * uses this after writeMarkdownFileAtomic to land the uploaded avatar bytes
 * next to the identity markdown, matching the fleet's Phase A on-disk
 * cosmetics layout (a sibling image file named by the `avatar:` frontmatter
 * key). Future manual identity-edit flows (Plan 66-02 UPDATE) reuse this
 * same helper.
 *
 * Guards run in this order (defense-in-depth per T-66-01-01 / T-66-01-02):
 *   1. IDENTITY_KEY_RE.test(identityKey) — throws before any I/O.
 *   2. AVATAR_EXT_VALUES.includes(ext) — throws before any I/O; the typed
 *      parameter already blocks arbitrary strings at compile time, but the
 *      runtime check catches any caller that widens its own typing via
 *      `as unknown as AvatarExt`.
 *   3. bytes.byteLength ≤ IDMEDIT_MAX_AVATAR_BYTES — throws before opening
 *      SFTP; mirrors IDMEDIT_MAX_MARKDOWN_BYTES DoS-cap pattern.
 *
 * LOCAL branch (conn === null): tmp+rename via Node fs — mirrors
 *   writeIdentityFile LOCAL pattern at ~/fleet/identities/<key>/<key>.<ext>.
 * REMOTE branch (conn is SSHClientType): SFTP tmp+rename via
 *   sftpWriteBinaryAtomic above (ext_openssh_rename discipline). remoteHome
 *   is resolved via `echo $HOME` on the target box; targetPath is
 *   <home>/fleet/identities/<key>/<key>.<ext> — remoteHome is server-side
 *   only (not attacker-influenceable via any birth-payload field).
 */
export async function writeAvatarSiblingFile(
  conn: SSHClientType | null,
  identityKey: string,
  ext: AvatarExt,
  bytes: Buffer,
): Promise<void> {
  // Guards 1 + 2 + 3 fire regardless of branch (LOCAL or REMOTE) so a bad
  // key / bad ext / oversized payload is rejected without ever touching the
  // network or the disk.
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (!(AVATAR_EXT_VALUES as readonly string[]).includes(ext)) {
    throw new Error("invalid avatar ext");
  }
  if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
    throw new Error("avatar payload exceeds IDMEDIT_MAX_AVATAR_BYTES");
  }

  if (conn === null) {
    // LOCAL branch — tmp+rename via Node fs, mirrors writeIdentityFile LOCAL.
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, `${identityKey}.${ext}`);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — resolve $HOME then SFTP write via ext_openssh_rename.
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/identities/${identityKey}/${identityKey}.${ext}`;
  await sftpWriteBinaryAtomic(conn, targetPath, bytes);
}

// ---------------------------------------------------------------------------
// 6a-bis. writeRoleAvatarByName — Phase 90 Plan 90-08 Task 1
// ---------------------------------------------------------------------------

/** Regex for accepted role avatar filenames — kebab-case-lowercase basename
 *  + one of the four canonical raster-image extensions accepted at write
 *  time. Mirrors readAvatarSiblingFileByRole's filename gate at L2417-2419
 *  MINUS the `svg` alternative — the POST /roles/:name/avatar upload endpoint
 *  intentionally rejects svg (frontend picker doesn't offer it; svg carries
 *  script-injection risk that raster formats don't). The reader tolerates
 *  svg for legacy on-disk files that predate this write-side gate. */
const ROLE_AVATAR_FILENAME_RE = /^[a-z0-9-]+\.(webp|png|jpg|gif)$/;

/**
 * Write a role's sibling avatar file (~/fleet/roles/<roleName>/<filename>).
 *
 * Sibling of writeRoleFileByName (L2678) — role-name-keyed write helper that
 * lands the uploaded avatar bytes next to the role markdown. Called by the
 * POST /roles/:name/avatar handler (Phase 90 Plan 90-08 Task 2) AFTER
 * server-side MIME + size validation, and AFTER the frontmatter round-trip
 * (readRoleFileByName → splice `avatar:` key → writeRoleFileByName).
 *
 * Byte-shape mirror of writeAvatarSiblingFile (L2084) — same guard order,
 * same LOCAL vs REMOTE branch structure, same underlying SFTP helper
 * (sftpWriteBinaryAtomic → ext_openssh_rename atomic overwrite).
 *
 * Guards run in this order (defense-in-depth per T-90-08-01/02/03):
 *   1. ROLE_NAME_PATTERN.test(roleName) — shell-safety gate; rejects
 *      before any I/O. Same regex writeRoleFileByName enforces at L2685.
 *   2. ROLE_AVATAR_FILENAME_RE.test(filename) — filename gate; forbids
 *      path traversal (`../`, `/`) and non-canonical extensions. Also
 *      rejects at the syntactic level any filename with shell-special
 *      characters — none of `[a-z0-9-]` require quoting inside the
 *      double-quoted paths below.
 *   3. Buffer.isBuffer(bytes) — reject non-Buffer inputs at the boundary
 *      so a misuse from a future caller (passing a string or array) surfaces
 *      as a loud throw instead of an SFTP-layer crash.
 *   4. bytes.byteLength ≤ IDMEDIT_MAX_AVATAR_BYTES — DoS cap BEFORE
 *      opening SFTP; mirrors writeAvatarSiblingFile L2099.
 *
 * LOCAL branch (conn === null):
 *   - Defensive mkdir -p on the role folder (mirrors writeRoleFileByName
 *     L2699 — role folder is expected to exist post-create but a stale
 *     ROLES_HOST_DIR may be missing it).
 *   - tmp+rename atomic write via Node fs.
 *
 * REMOTE branch (conn is SSHClientType):
 *   - Defensive `mkdir -p "$HOME/fleet/roles/<roleName>"` via execWithTimeout
 *     BEFORE the SFTP write, matching the LOCAL branch's mkdir. Cheap and
 *     forgiving on a role folder that already exists.
 *   - Resolve $HOME then SFTP tmp+rename via sftpWriteBinaryAtomic.
 *
 * Throws on any guard failure, mkdir failure, or SFTP failure. Caller in
 * roles.ts POST handler catches + returns 502 (upstream-detail-suppressed).
 */
export async function writeRoleAvatarByName(
  conn: SSHClientType | null,
  roleName: string,
  filename: string,
  bytes: Buffer,
): Promise<void> {
  // Guard 1: role-name gate BEFORE any I/O.
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("invalid roleName");
  }
  // Guard 2: filename gate BEFORE any I/O. Rejects `../` traversal, `/`
  // path separators, uppercase, non-canonical exts, shell metachars.
  if (typeof filename !== "string" || !ROLE_AVATAR_FILENAME_RE.test(filename)) {
    throw new Error("invalid avatar filename");
  }
  // Guard 3: reject non-Buffer inputs at the boundary.
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("bytes must be a Buffer");
  }
  // Guard 4: DoS cap BEFORE opening SFTP — mirrors writeAvatarSiblingFile L2099.
  if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
    throw new Error("avatar payload exceeds IDMEDIT_MAX_AVATAR_BYTES");
  }

  if (conn === null) {
    // LOCAL branch — mkdir -p + tmp+rename via Node fs. Mirrors
    // writeRoleFileByName LOCAL pattern (L2693-2704) minus utf-8 encoding.
    const root = getLocalRolesRoot();
    const roleDir = path.join(root, roleName);
    await fs.mkdir(roleDir, { recursive: true });
    const filePath = path.join(roleDir, filename);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — defensive mkdir -p, then SFTP tmp+rename via
  // sftpWriteBinaryAtomic (ext_openssh_rename). Both roleName and filename
  // have passed regex gates above; direct interpolation into the mkdir
  // command is shell-safe (same defense as writeRoleFile L2644-2646).
  await execWithTimeout(
    conn,
    `mkdir -p "$HOME/fleet/roles/${roleName}"`,
  );
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/roles/${roleName}/${filename}`;
  await sftpWriteBinaryAtomic(conn, targetPath, bytes);
}

// ---------------------------------------------------------------------------
// 6c. Cosmetics reads — Phase 66 Plan 03
// ---------------------------------------------------------------------------
//
// Two new exports that support the READ flip in identities.ts:
//   - AVATAR_MIME_FROM_EXT: inverse of MIME_TO_AVATAR_EXT — ext → mime string.
//     Used by GET /:id/avatar to set Content-Type from the on-disk file's ext.
//   - readAvatarSiblingFile(conn, identityKey): discovers + reads the sibling
//     avatar file (frontmatter authoritative when present; ls / fs cascade
//     otherwise). Returns null when no sibling exists; throws on SSH errors.
//   - extractCosmeticsFromFrontmatter(markdown): parses the .md's frontmatter
//     block, type-narrows each of the 5 cosmetic keys, returns whatever
//     validates. Empty {} means "no cosmetics on disk" (caller renders
//     safe-defaults via publicIdentity).
//
// Both readAvatarSiblingFile branches (LOCAL + REMOTE) go through
// readIdentityFile first to check for an authoritative avatar: <filename>
// frontmatter key. When absent OR malformed, we fall through to a
// cascade/enumeration over AVATAR_EXT_VALUES.

/**
 * Inverse of MIME_TO_AVATAR_EXT (Plan 01) — maps a canonical on-disk avatar
 * extension back to its MIME string for HTTP Content-Type headers. Used by
 * GET /identities/:id/avatar's response construction (Plan 03 Task 2).
 * image/jpeg → jpg (matches Nelly's Phase A sibling-file convention on disk).
 */
export const AVATAR_MIME_FROM_EXT: Record<AvatarExt, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/**
 * Extract cosmetics scalars from an identity markdown file's YAML frontmatter.
 *
 * Uses the same regex as extractRoleFromMarkdown (top-of-file `---...---`
 * block, tolerant of CRLF). yaml.load is wrapped in try/catch — any parse
 * error returns {} rather than throwing (caller treats malformed frontmatter
 * as "no cosmetics on disk" and renders safe-defaults, matching the shape
 * file's "accept the ugly render" degradation).
 *
 * Each field is type-narrowed via typeof + range checks (T-66-03-03):
 *   - displayName / title / voice / avatar: non-empty string
 *   - colorHue: integer-or-float number in [0, 359]
 *   - coordinator: boolean (typeof === "boolean") — Phase 67 Plan 67-01
 * Anything failing its gate is DROPPED (not defaulted) — the caller
 * distinguishes "not present" from "present with bad value" by checking
 * `field in cosmetics`.
 *
 * Phase 85 Plan 85-01 Task 1: reused unchanged against ROLE-file markdown
 * as the source of cosmetic defaults. Role markdown carries the same YAML
 * frontmatter shape (`title`, `colorHue`, `voice`, `avatar`) — the four
 * cosmetic fields — and the narrowing contract above is load-bearing for
 * the identity/role merge in publicIdentity(). No shape change here; the
 * caller in publicIdentity applies `identity ?? role ?? null` per field.
 */
export function extractCosmeticsFromFrontmatter(markdown: string): {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  avatar?: string;
  coordinator?: boolean;
  /**
   * Phase 80 Plan 80-03: task string written at identity creation (write-once
   * per D-05). Same narrowing shape as voice/title — non-empty string kept,
   * anything else dropped. Never defaulted; caller distinguishes absent from
   * present-with-bad-value via `"task" in cosmetics`.
   */
  task?: string;
  /**
   * Phase 117 Plan 117-07 (D-05 identity carrier): project slug from the
   * identity's frontmatter `project:` field. Permissive narrowing — dangling
   * / mistyped slugs are handled at render time by the frontend selector's
   * graceful-degradation branch per D-07. Strict PROJECT_SLUG_RE validation
   * fires only at the WRITE path (writeSessionProjectField from 117-01).
   */
  project?: string;
  /**
   * Phase 129 Plan 01 (D-10 field name locked): per-user visibility gate —
   * YAML list of Skynet usernames. Absent-⇒-omit — an empty or missing list
   * yields a returned object where the `users` key does NOT exist (D-3
   * fallback: "no gate on this side" / zero-migration invariant). Case-
   * sensitive strings compared at gate-apply time in
   * isIdentityVisibleToUser (identity-visibility-gate.ts).
   */
  users?: string[];
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  // Tolerant parse: see the docblock on extractRoleFromMarkdown above for the
  // full rationale. Same call pattern here — any field that parsed cleanly
  // survives into `parsed`, even if a sibling field on another line had a
  // YAML error. The narrowing gates below (typeof / Array.isArray / range
  // checks) still drop anything that came out mis-shaped, so a nested-map
  // corruption of the value (like when a bad `task:` swallows subsequent
  // list items) is silently rejected rather than surfaced as a garbage cos.
  const doc = yamlParseDocument(match[1]);
  if (doc.errors.length > 0) {
    systemLogger.warn(
      "Identity/role frontmatter YAML had parse errors — using tolerant recovery",
      {
        operation: "frontmatter_yaml_parse_failed",
        site: "extractCosmeticsFromFrontmatter",
        errorCount: doc.errors.length,
        firstError: doc.errors[0]?.message?.split("\n")[0],
        snippet: match[1].slice(0, 200),
      },
    );
  }
  const parsed = doc.toJS() as unknown;
  if (parsed === null || typeof parsed !== "object") return {};
  const src = parsed as Record<string, unknown>;
  const out: {
    displayName?: string;
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
    coordinator?: boolean;
    task?: string;
    project?: string;
    users?: string[];
  } = {};
  if (typeof src.displayName === "string" && src.displayName.length > 0) {
    out.displayName = src.displayName;
  }
  if (typeof src.title === "string" && src.title.length > 0) {
    out.title = src.title;
  }
  // colorHue: accept number OR numeric string. WYSIWYG frontmatter editors
  // (MDXEditor's dialog, and typical YAML round-trippers when a value was
  // ever quoted) serialize `324` as `'324'`, so a strict typeof-number gate
  // silently drops the field on save — the visible symptom is losing the
  // identity/role's color the moment someone edits their frontmatter. Coerce
  // string→number and enforce the same [0, 359] range post-parse.
  const rawColorHue = src.colorHue;
  const parsedColorHue =
    typeof rawColorHue === "number"
      ? rawColorHue
      : typeof rawColorHue === "string" && rawColorHue.trim() !== ""
        ? Number(rawColorHue)
        : Number.NaN;
  if (
    Number.isFinite(parsedColorHue) &&
    parsedColorHue >= 0 &&
    parsedColorHue <= 359
  ) {
    out.colorHue = parsedColorHue;
  }
  if (typeof src.voice === "string" && src.voice.length > 0) {
    out.voice = src.voice;
  }
  if (typeof src.avatar === "string" && src.avatar.length > 0) {
    out.avatar = src.avatar;
  }
  // coordinator: accept boolean OR "true"/"false" string (same resilience
  // as colorHue — WYSIWYG editors quote booleans on round-trip).
  if (typeof src.coordinator === "boolean") {
    out.coordinator = src.coordinator;
  } else if (src.coordinator === "true") {
    out.coordinator = true;
  } else if (src.coordinator === "false") {
    out.coordinator = false;
  }
  // Phase 80 Plan 80-03: task narrowing — mirrors voice/title pattern.
  if (typeof src.task === "string" && src.task.length > 0) {
    out.task = src.task;
  }
  // Phase 117 Plan 117-07 (D-05 identity carrier): project narrowing — same
  // permissive shape as task. PROJECT_SLUG_RE strict-check lives at the WRITE
  // path (writeSessionProjectField from 117-01); the reader is permissive so
  // dangling / mistyped slugs surface for the frontend selector's
  // graceful-degradation branch (D-07) instead of being silently dropped.
  if (typeof src.project === "string" && src.project.length > 0) {
    out.project = src.project;
  }
  // Phase 129 Plan 01 (D-10): users list narrowing — array-of-non-empty-strings.
  // Empty array → out.users stays absent (absent-⇒-omit fallback semantic:
  // caller sees "no gate on this side" via `!Array.isArray(out.users) ||
  // out.users.length === 0`). Scalars / non-arrays are rejected by the
  // Array.isArray gate — same discipline as every other narrower in this
  // function (typed-shape acceptance, silent-drop on wrong-type input).
  if (Array.isArray(src.users)) {
    const normalized = src.users
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (normalized.length > 0) {
      out.users = normalized;
    }
  }
  return out;
}

/**
 * Return a shallow copy of `obj` with `colorHue` coerced from number → decimal
 * string, so a subsequent `yaml.dump` emits `colorHue: '324'` (single-quoted)
 * instead of a bare `324`. Matches the shape MDXEditor's frontmatter dialog
 * produces on save — see the numeric-string branch in
 * extractCosmeticsFromFrontmatter above, which already tolerates both shapes
 * on read. Standardizing every writer on the quoted form keeps identity/role
 * frontmatter byte-shape-consistent whether it was last touched by Skynet's
 * routes or by an in-browser MDXEditor edit.
 *
 * Returns the same reference (no clone) when colorHue is absent or already a
 * non-number — callers can pass any dict without paying for an allocation on
 * the common path. When colorHue IS a number, a shallow-copy is returned so
 * the caller's original object is safe to reuse for a JSON response echo
 * (where numeric colorHue is the wire type).
 */
export function stringifyColorHueForYaml<T extends Record<string, unknown>>(
  obj: T,
): T {
  if (typeof obj.colorHue !== "number") return obj;
  return { ...obj, colorHue: String(obj.colorHue) };
}

/**
 * Read the identity's sibling avatar file (~/fleet/identities/<key>/<key>.<ext>).
 *
 * Discovery order:
 *   1. Read <key>.md's frontmatter via readIdentityFile. If it has a valid
 *      `avatar: <key>.<ext>` key naming a canonical extension, use that ext.
 *   2. Otherwise, cascade through AVATAR_EXT_VALUES = [webp,png,jpg,gif,svg]
 *      to find which sibling file exists. LOCAL: fs.readFile per ext until
 *      one succeeds (ENOENT → next). REMOTE: single `ls` shell round-trip
 *      that returns the first matching filename (bash brace expansion).
 *   3. If none exist, return null.
 *
 * Returns {bytes, mime, ext} on success; null when no sibling exists.
 * Throws on invalid identityKey, SSH-layer errors, or files exceeding
 * IDMEDIT_MAX_AVATAR_BYTES (defense-in-depth — writers cap at write-time).
 *
 * Caller policy on SSH errors: GET /identities SWALLOWS (returns row with
 * safe-default cosmetics for that identity — user: "accept the ugly
 * render"). GET /:id/avatar surfaces as 502.
 */
export async function readAvatarSiblingFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ bytes: Buffer; mime: string; ext: AvatarExt } | null> {
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  // Step 1: try to read the markdown and extract the authoritative avatar key.
  let authoritativeExt: AvatarExt | null = null;
  try {
    const { markdown } = await readIdentityFile(conn, identityKey);
    if (markdown && markdown.length > 0) {
      const cos = extractCosmeticsFromFrontmatter(markdown);
      if (cos.avatar) {
        // Match `<identityKey>.<ext>` exactly; ext must be one of the 5 canonical.
        const re = new RegExp(
          `^${identityKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(webp|png|jpg|gif|svg)$`,
        );
        const m = cos.avatar.match(re);
        if (m) {
          authoritativeExt = m[1] as AvatarExt;
        }
      }
    }
  } catch {
    // If reading the markdown itself throws (SSH error), swallow here —
    // the caller's discovery cascade will surface the same error if it
    // hits SSH again below. This keeps the code path uniform for the
    // "no md file but sibling exists" case (rare — but possible on a
    // half-populated identity folder).
  }

  if (conn === null) {
    // ─── LOCAL branch ────────────────────────────────────────────────
    const root = getLocalIdentitiesRoot();
    const tryRead = async (ext: AvatarExt): Promise<Buffer | null> => {
      const filePath = path.join(root, identityKey, `${identityKey}.${ext}`);
      try {
        const bytes = await fs.readFile(filePath);
        if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
          throw new Error("avatar exceeds cap on disk");
        }
        return bytes;
      } catch (err: unknown) {
        if (
          typeof err === "object" &&
          err !== null &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          return null;
        }
        throw err;
      }
    };

    if (authoritativeExt) {
      const bytes = await tryRead(authoritativeExt);
      if (bytes) {
        return { bytes, mime: AVATAR_MIME_FROM_EXT[authoritativeExt], ext: authoritativeExt };
      }
      // authoritative ext named a file that doesn't exist — fall through to
      // cascade so we can still discover a real sibling if the frontmatter
      // is stale.
    }

    for (const ext of AVATAR_EXT_VALUES) {
      const bytes = await tryRead(ext);
      if (bytes) {
        return { bytes, mime: AVATAR_MIME_FROM_EXT[ext], ext };
      }
    }
    return null;
  }

  // ─── REMOTE branch ─────────────────────────────────────────────────
  // Single `ls` round-trip: bash brace expansion enumerates the 5 canonical
  // sibling paths; `2>/dev/null` swallows the "no such file" per-path errors;
  // `head -n1` picks the first hit; `xargs -r basename` strips the directory
  // to yield just `<key>.<ext>` (or empty string on no matches). identityKey
  // is IDENTITY_KEY_RE-validated so direct interpolation is shell-safe (same
  // pattern as readIdentityFile at L440).
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();

  let extToRead: AvatarExt | null = authoritativeExt;
  if (!extToRead) {
    // Brace expansion must sit OUTSIDE double quotes — bash does NOT expand
    // `{a,b,c}` inside quotes, so the previous shape emitted a literal path
    // with brace text and `ls` always errored → cascade returned null (dead
    // code). identityKey is IDENTITY_KEY_RE-validated (^[a-z0-9_-]{1,64}$) so
    // direct interpolation without quoting is shell-safe. Code review HIGH #2,
    // 2026-09-01.
    const lsCmd =
      `ls "$HOME/fleet/identities/${identityKey}/${identityKey}".{webp,png,jpg,gif,svg} 2>/dev/null | head -n1 | xargs -r basename`;
    const basename = (await execWithTimeout(conn, lsCmd)).trim();
    if (!basename) return null;
    // Extract ext from basename like "tina.webp"
    const re = new RegExp(
      `^${identityKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(webp|png|jpg|gif|svg)$`,
    );
    const m = basename.match(re);
    if (!m) return null;
    extToRead = m[1] as AvatarExt;
  }

  const targetPath = `${remoteHome}/fleet/identities/${identityKey}/${identityKey}.${extToRead}`;
  const bytes = await sftpReadFile(conn, targetPath);
  if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
    throw new Error("avatar exceeds cap on disk");
  }
  return { bytes, mime: AVATAR_MIME_FROM_EXT[extToRead], ext: extToRead };
}

// ---------------------------------------------------------------------------
// App-icon reader — Phase 119 Plan 05 Task 1 (D-06)
// ---------------------------------------------------------------------------

/**
 * Read a first-class app's icon file (~/fleet/apps/<slug>/icon.webp).
 *
 * Mirrors readAvatarSiblingFile's LOCAL/REMOTE branching discipline but with
 * ONE deliberate simplification: a SINGLE filename (`icon.webp`) — no
 * multi-extension cascade. Shape 1 §80-82 locks the disk contract: agents
 * convert artwork to WebP before dropping it in, so the reader never has to
 * guess at an extension (Pitfall 5 lock from Phase 119 RESEARCH.md).
 *
 * Contract:
 *   - Returns {bytes, mime: "image/webp"} when the file exists and is under
 *     IDMEDIT_MAX_AVATAR_BYTES.
 *   - Returns null when the file is absent (LOCAL: ENOENT; REMOTE: the `ls`
 *     probe returns empty stdout).
 *   - Throws on invalid slug (defence-in-depth — the route also gates,
 *     but this helper is the shell-safety guard for the interpolation
 *     inside the REMOTE-branch `ls` command).
 *   - Throws on oversized file (defence-in-depth against a corrupt/attacker
 *     drop that bypassed write-side capping).
 *   - Throws on SSH-layer errors (route catches and returns 502 with a
 *     canned "unreachable" body — matches identity-avatar discipline).
 *
 * Shell safety: APP_SLUG_RE forbids `/`, `.`, `..`, `$`, `;`, `&`, backtick,
 * and whitespace — the double-quoted interpolation `"${targetPath}"` is
 * therefore safe for the `ls` probe. See threat-register T-119-05-01 and
 * T-119-05-02 in the plan for STRIDE analysis.
 */
export async function readAppIconFile(
  conn: SSHClientType | null,
  slug: string,
): Promise<{ bytes: Buffer; mime: "image/webp" } | null> {
  if (!APP_SLUG_RE.test(slug)) {
    throw new Error("invalid slug");
  }

  if (conn === null) {
    // ─── LOCAL branch ────────────────────────────────────────────────
    // Rooted at $HOME/fleet/apps/<slug>/icon.webp. Uses os.homedir() rather
    // than an env-var-configurable root because first-class apps are always
    // sibling to the identities tree on the same box (no bind-mount split
    // like IDENTITIES_HOST_DIR — apps live under the user's real home).
    const filePath = path.join(os.homedir(), "fleet", "apps", slug, "icon.webp");
    try {
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
        throw new Error("icon exceeds cap on disk");
      }
      return { bytes, mime: "image/webp" };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw err;
    }
  }

  // ─── REMOTE branch ─────────────────────────────────────────────────
  // Mirror the readAvatarSiblingFile REMOTE-branch shape: probe with `ls`
  // first (short round-trip, distinguishes ENOENT cleanly from SSH errors),
  // then read via SFTP. Interpolating ${slug} directly is shell-safe because
  // APP_SLUG_RE has already gated the value.
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/apps/${slug}/icon.webp`;
  const lsCmd = `ls "${targetPath}" 2>/dev/null || true`;
  const lsOut = (await execWithTimeout(conn, lsCmd)).trim();
  if (lsOut === "") return null;

  // Code-review MEDIUM-2 (fix pass 2026-09-18): the `ls` probe races the
  // `sftpReadFile` — the file can be deleted between the two SSH
  // round-trips (rare, but possible during a sweep tick or app removal
  // in-flight). When that happens, `sftpReadFile` throws with an
  // ENOENT-shaped error. Route-level `catch` maps THAT throw to 502
  // ("app home box unreachable") — but the file is genuinely absent,
  // so the accurate code is 404. Catch ENOENT-shaped errors here and
  // return null (route maps null → 404); rethrow other errors (route
  // maps thrown → 502). Detection is duck-typed on the string / code:
  // ssh2 SFTP errors expose `.code === 2` for NO_SUCH_FILE, and the
  // message string typically contains "No such file" or "ENOENT".
  let bytes: Buffer;
  try {
    bytes = await sftpReadFile(conn, targetPath);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      ((err as { code?: unknown }).code === 2 ||
        (err as { code?: unknown }).code === "ENOENT" ||
        /no such file|enoent/i.test(
          (err as { message?: unknown }).message?.toString() ?? "",
        ))
    ) {
      return null;
    }
    throw err;
  }
  if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
    throw new Error("icon exceeds cap on disk");
  }
  return { bytes, mime: "image/webp" };
}

// ---------------------------------------------------------------------------
// Role-side avatar sibling reader — Phase 85 Plan 85-01 Task 1
// ---------------------------------------------------------------------------

/**
 * Read a role's sibling avatar file (~/fleet/roles/<roleName>/<avatarFilename>).
 *
 * Wave-1 role-fallback for GET /identities/:key/avatar: when an identity has
 * no sibling avatar of its own, the endpoint reads the identity's role
 * frontmatter, extracts the role's `avatar:` filename, and calls this
 * function to serve the role's shared avatar instead. Returns null when the
 * role folder has no such sibling — the caller then 404s.
 *
 * Mirrors readAvatarSiblingFile above but simplified for the role case:
 *   - Takes `avatarFilename` as an explicit argument (already known from the
 *     role's frontmatter `avatar:` field). No frontmatter re-read needed —
 *     the caller has already parsed it.
 *   - Rooted at getLocalRolesRoot()/<roleName>/<avatarFilename> (LOCAL)
 *     or "$HOME/fleet/roles/<roleName>/<avatarFilename>" (REMOTE).
 *   - Enforces the IDMEDIT_MAX_AVATAR_BYTES cap on both branches, mirroring
 *     the identity-side defense at L2219-2221 / L2286-2288.
 *
 * Validation (T-85-01-02):
 *   - roleName must pass ROLE_NAME_PATTERN (SSH interpolation).
 *   - avatarFilename must match `^[a-z0-9-]+\.(webp|png|jpg|gif|svg)$` — the
 *     ext is one of the five canonical AVATAR_EXT_VALUES, and the basename
 *     is kebab-case-lowercase (matches role-file naming; forbids traversal
 *     via `../` or subshell chars).
 *
 * Returns null when the file doesn't exist on disk (LOCAL ENOENT / REMOTE
 * empty stdout). Throws on invalid inputs, SSH-layer errors, or files
 * exceeding IDMEDIT_MAX_AVATAR_BYTES.
 */
export async function readAvatarSiblingFileByRole(
  conn: SSHClientType | null,
  roleName: string,
  avatarFilename: string,
): Promise<{ bytes: Buffer; mime: string; ext: AvatarExt } | null> {
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error(`invalid roleName: ${roleName}`);
  }
  // Explicit filename ext regex: mirrors AVATAR_EXT_VALUES tuple exactly.
  // Kebab-case basename + canonical ext; nothing else reaches disk.
  const filenameMatch = avatarFilename.match(
    /^([a-z0-9-]+)\.(webp|png|jpg|gif|svg)$/,
  );
  if (!filenameMatch) {
    throw new Error(`invalid avatarFilename: ${avatarFilename}`);
  }
  const ext = filenameMatch[2] as AvatarExt;

  if (conn === null) {
    // LOCAL branch — mirrors readAvatarSiblingFile LOCAL tryRead helper.
    const root = getLocalRolesRoot();
    const filePath = path.join(root, roleName, avatarFilename);
    try {
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
        throw new Error("avatar exceeds cap on disk");
      }
      return { bytes, mime: AVATAR_MIME_FROM_EXT[ext], ext };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw err;
    }
  }

  // REMOTE branch — probe existence first (avoid throwing "no such file"
  // from sftpReadFile), then read via SFTP. Mirror the readAvatarSiblingFile
  // REMOTE-branch shape: single existence probe via bash, then sftpReadFile.
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const probeCmd = `ls "$HOME/fleet/roles/${roleName}/${avatarFilename}" 2>/dev/null || true`;
  const probeOut = (await execWithTimeout(conn, probeCmd)).trim();
  if (!probeOut) {
    return null;
  }
  const targetPath = `${remoteHome}/fleet/roles/${roleName}/${avatarFilename}`;
  const bytes = await sftpReadFile(conn, targetPath);
  if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
    throw new Error("avatar exceeds cap on disk");
  }
  return { bytes, mime: AVATAR_MIME_FROM_EXT[ext], ext };
}

/**
 * Private SFTP helper — reads a remote file into a Buffer via SFTP.
 * Promise-wraps conn.sftp → sftp.readFile(remotePath) → sftp.end() in finally.
 * Returns Buffer (sftp.readFile default). Throws on any SSH/SFTP error.
 *
 * Mirrors writeMarkdownFileAtomic's promise-wrap discipline. Used by the
 * REMOTE branch of writeIdentityBountyFields so JSON mutation stays in Node
 * process memory rather than being piped through a python shell script.
 */
async function sftpReadFile(conn: SSHClientType, remotePath: string): Promise<Buffer> {
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  } finally {
    sftp.end();
  }
}

/** Write the identity file (<key>/<key>.md) atomically.
 *
 * LOCAL branch (conn === null): tmp+rename via Node fs — mirrors
 *   writeIdentityWakeupUpdate lines 713-718.
 * REMOTE branch (conn is SSHClientType): SFTP tmp+rename via
 *   writeMarkdownFileAtomic. Validates identityKey and byte-caps contents
 *   before opening SFTP (D-IDMEDIT-06 / T-18-02 / T-18-03). */
export async function writeIdentityFile(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  if (conn === null) {
    // LOCAL branch — tmp+rename, mirrors writeIdentityWakeupUpdate lines 713-718
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, identityKey + ".md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — validate + cap before opening SFTP (D-IDMEDIT-06)
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/identities/${identityKey}/${identityKey}.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

/** Write the identity history file (<key>/history.md) atomically.
 *
 * Identical shape to writeIdentityFile; targetPath basename is history.md. */
export async function writeIdentityHistory(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "history.md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/identities/${identityKey}/history.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

/** Write the identity handoff file (<key>/handoff.md) atomically.
 *
 * Identical shape to writeIdentityFile; targetPath basename is handoff.md. */
export async function writeIdentityHandoff(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, "handoff.md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/identities/${identityKey}/handoff.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

/** Write the identity's role file (~/fleet/roles/<role>/<role>.md) atomically.
 *
 * Byte-shape mirror of writeIdentityFile: same signature, same LOCAL vs REMOTE
 * branch structure, same byte-cap constant (IDMEDIT_MAX_MARKDOWN_BYTES), same
 * IDENTITY_KEY_RE guard. The role name is discovered internally via
 * resolveRoleForIdentity — frontend contract stays (identityKey, hostId).
 *
 * Guards run in this order (defense-in-depth per T-22-06-01/02/03/04):
 *   1. IDENTITY_KEY_RE.test(identityKey) — rejects before any I/O.
 *   2. Byte cap (IDMEDIT_MAX_MARKDOWN_BYTES = 2MB) — rejects before any I/O.
 *   3. resolveRoleForIdentity(conn, identityKey) — throws when identity file
 *      lacks role: frontmatter (no fallback per D-CONTEXT).
 *
 * REMOTE branch uses writeMarkdownFileAtomic (SFTP tmp+rename via
 * posix-rename@openssh.com) — the SAME helper that carries the EEXIST fix
 * from quick 260802-qrw / patch #268. The regression test at
 * identity-artifact-reader.role-file.test.ts installs a throwing trap on
 * sftp.rename that fires if a future refactor reverts this call site.
 *
 * LOCAL branch does defensive mkdir -p on the role folder before the atomic
 * write — Plan 22-04 creates the folder as part of the create-role flow, so
 * the folder is expected to already exist for any identity that resolved
 * a role successfully; the defensive mkdir is cheap and forgiving.
 */
export async function writeRoleFile(
  conn: SSHClientType | null,
  identityKey: string,
  contents: string,
): Promise<void> {
  // Guard 1 + 2 fire regardless of branch (LOCAL or REMOTE) so a bad key or
  // oversized payload is rejected without ever touching the network / disk.
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }

  // Guard 3: two-step BEFORE branch split — resolves role from identity file
  // frontmatter. Throws (no fallback) on missing / bad role. Role is
  // IDENTITY_KEY_RE-safe after this line (defense-in-depth per T-22-06-01).
  const role = await resolveRoleForIdentity(conn, identityKey);

  if (conn === null) {
    // LOCAL branch — tmp+rename via Node fs, mirrors writeIdentityFile
    // LOCAL pattern rooted at ~/fleet/roles/<role>/<role>.md
    const root = getLocalRolesRoot();
    const roleDir = path.join(root, role);
    // Defensive mkdir -p — Plan 22-04's create-role flow makes the folder,
    // but a stale env pointing at a fresh ROLES_HOST_DIR may be missing it.
    await fs.mkdir(roleDir, { recursive: true });
    const filePath = path.join(roleDir, role + ".md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — echo $HOME then SFTP write to
  // <home>/fleet/roles/<role>/<role>.md via writeMarkdownFileAtomic
  // (ext_openssh_rename — see writeMarkdownFileAtomic prologue for the
  // EEXIST rationale that made plain sftp.rename unsafe).
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/roles/${role}/${role}.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

// ---------------------------------------------------------------------------
// 6b. writeRoleFileByName — Phase 90 Plan 90-03 Task 1 (D-08.3)
// ---------------------------------------------------------------------------

/** Write a role file (~/fleet/roles/<roleName>/<roleName>.md) atomically,
 * keyed directly on roleName — WITHOUT the identity two-step used by writeRoleFile
 * above. Byte-shape mirror of writeRoleFile MINUS the resolveRoleForIdentity
 * step at L2623 (since roleName arrives directly, use it after ROLE_NAME_PATTERN
 * validation).
 *
 * Sibling of readRoleFileByName (L615) — both are the role-name-keyed
 * counterparts of the identity-key-keyed readRoleFile/writeRoleFile pair. The
 * RoleModal (Phase 90 Plan 90-04) has no identity context, so it needs a save
 * path that doesn't require an identityKey (D-08.3 planner-pick — rejected the
 * "frontend synthesizes identityKey" fallback because it breaks if the
 * roles-list host has no local identities).
 *
 * Guards run in this order (defense-in-depth per T-22-06-01/02/03/04):
 *   1. ROLE_NAME_PATTERN.test(roleName) — rejects before any I/O.
 *   2. Byte cap (IDMEDIT_MAX_MARKDOWN_BYTES = 2MB) — rejects before any I/O.
 *
 * REMOTE branch uses writeMarkdownFileAtomic (SFTP tmp+rename via
 * posix-rename@openssh.com) — the SAME helper writeRoleFile uses, carrying
 * the EEXIST fix from quick 260802-qrw / patch #268.
 *
 * LOCAL branch does defensive mkdir -p on the role folder before the atomic
 * write — mirrors writeRoleFile L2632. Cheap and forgiving for a fresh role
 * whose folder was created via a separate flow (or a stale env).
 */
export async function writeRoleFileByName(
  conn: SSHClientType | null,
  roleName: string,
  contents: string,
): Promise<void> {
  // Guard 1: role-name gate BEFORE any I/O — same defense-in-depth pattern as
  // readRoleFileByName's ROLE_NAME_PATTERN gate (L621).
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("invalid roleName");
  }
  // Guard 2: byte cap BEFORE any I/O.
  if (Buffer.byteLength(contents, "utf-8") > IDMEDIT_MAX_MARKDOWN_BYTES) {
    throw new Error("markdown payload exceeds IDMEDIT_MAX_MARKDOWN_BYTES");
  }

  if (conn === null) {
    // LOCAL branch — tmp+rename via Node fs, mirrors writeRoleFile LOCAL
    // pattern rooted at ROLES_HOST_DIR/<roleName>/<roleName>.md
    const root = getLocalRolesRoot();
    const roleDir = path.join(root, roleName);
    // Defensive mkdir -p — mirrors writeRoleFile L2632.
    await fs.mkdir(roleDir, { recursive: true });
    const filePath = path.join(roleDir, roleName + ".md");
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, contents, "utf-8");
    await fs.rename(tmpPath, filePath);
    return;
  }

  // REMOTE branch — echo $HOME then SFTP write to
  // <home>/fleet/roles/<roleName>/<roleName>.md via writeMarkdownFileAtomic
  // (ext_openssh_rename — see writeMarkdownFileAtomic prologue for the
  // EEXIST rationale that made plain sftp.rename unsafe).
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/roles/${roleName}/${roleName}.md`;
  await writeMarkdownFileAtomic(conn, targetPath, contents);
}

// ---------------------------------------------------------------------------
// 6c. Phase 136 retired the role-scope bounty readers/writers/deleters
// (readRoleBountiesByName, writeRoleBountyByName, archiveRoleBountyByName,
// deleteRoleBountyByName). Phase 134 Plan 134-02 retired the role-scope
// wakeup helpers (readRoleWakeupsByName, writeRoleWakeupByName,
// deleteRoleWakeupByName). Both concept surfaces are gone.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 11. readIdentityTrappedWork — Phase 104 Plan 01 (D-01/D-02/D-06/D-09)
// ---------------------------------------------------------------------------
//
// Per-identity binary "hasTrappedWork" answer for the trapped-work indicator
// (Phase 104). Structural notes:
//
//   1. D-02 workspace path: hard-coded ~/fleet/identities/<identityKey>/workspace/
//      (Shape 3 substrate migration path). NO env-var override; NO "skynet/"
//      subdir; NO configurability. Pre-migration identities that don't have
//      workspace/ silently return {hasTrappedWork:false}.
//
//   2. D-06 silent-fail: workspace/ absent OR empty → {hasTrappedWork:false}.
//      No error, no fallback path, no probe of alternative locations.
//
//   3. D-09 skip role lookup: trapped-work is workspace-scoped, not role-scoped.
//      Do NOT call resolveRoleForIdentity — the workspace path has no role
//      indirection. Saves one SSH round-trip per probe (research Pitfall #6).
//
// Detection semantics (D-01, all "any of" — short-circuit on first hit):
//   Eligible project: git repo with at least one remote configured.
//   Eligible trapped state:
//     - Dirty tracked files (staged or unstaged) — untracked files ignored.
//     - Local commits not reachable from any remote (git rev-list --branches
//       --not --remotes --count > 0). Handles local-only branches with no
//       upstream correctly.
//     - Stashes on the reflog.
//   Ignored: untracked files (loose scratch), repos without a remote (personal
//   scratch), nested repos (only outermost is probed).
//
// LOCAL branch walks the filesystem via fs/promises + spawnSync("git", ...).
// REMOTE branch runs a python3 -c '...' script over SSH that walks the
// remote workspace and shells out to `git` per-repo with a 5s per-subprocess
// timeout and a global try/except to swallow poisoned-repo failures. Script
// short-circuits on first trapped state (print + sys.exit(0)).

/** Depth of the workspace/ walk (D-01). Repos at depth 1-MAX_DEPTH are probed;
 *  deeper trees are not. 3 covers workspace/<repo>/.git and
 *  workspace/<category>/<repo>/.git without pathological fan-out. */
const TRAPPED_WORK_MAX_DEPTH = 3;

/** Workspace path prefix (D-02). Hard-coded, NOT env-configurable. */
const WORKSPACE_PATH_PREFIX = "fleet/identities";

/** Run a git command in `repoDir`, capturing stdout. Returns "" on any error
 *  (mirrors the "swallow per-repo failures" invariant at L4096 for bounties). */
function safeGitStdout(args: string[], repoDir: string): string {
  try {
    const r = spawnSync("git", ["-C", repoDir, ...args], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (r.status !== 0) return "";
    return r.stdout ?? "";
  } catch {
    return "";
  }
}

/** True if this repo has any "trapped work" per D-01 eligibility rules. */
function repoHasTrappedWork(repoDir: string): boolean {
  // Eligibility: repo MUST have at least one remote configured, else it's
  // personal scratch and ignored (D-01).
  const remotes = safeGitStdout(["remote"], repoDir).trim();
  if (remotes === "") return false;

  // Dirty tracked files (any line whose 2nd char is NOT '?' — '?' means untracked).
  const status = safeGitStdout(["status", "--porcelain=v1"], repoDir);
  for (const line of status.split("\n")) {
    if (line.length < 2) continue;
    if (line[1] !== "?") return true;
  }

  // Local commits not on any remote (handles local-only branches).
  const localOnly = safeGitStdout(
    ["rev-list", "--branches", "--not", "--remotes", "--count"],
    repoDir,
  ).trim();
  const n = Number(localOnly);
  if (Number.isFinite(n) && n > 0) return true;

  // Stash on reflog.
  const stash = safeGitStdout(["stash", "list"], repoDir).trim();
  if (stash !== "") return true;

  return false;
}

/** Depth-bounded walker that emits outermost .git-containing repo dirs.
 *  Once a .git dir is found in `dir`, we DO NOT descend into `dir` — matches
 *  D-01 "only outermost repo is probed" rule (nested/vendored repos ignored).
 *  Symlinks are skipped to prevent loops. */
async function walkForRepos(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > TRAPPED_WORK_MAX_DEPTH) return;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  // Check if this dir itself is a repo (has a .git subdir OR gitfile).
  if (entries.includes(".git")) {
    try {
      const st = await fs.lstat(path.join(dir, ".git"));
      // Accept BOTH a .git directory (normal repo) AND a .git file (git
      // worktree gitlink). A worktree is a legitimate primary checkout
      // and git commands (status/rev-list/stash) work in it exactly as
      // in a normal repo — so it belongs in the detector's coverage.
      //
      // D-01's outermost-only rule is preserved: once we detect ANY .git
      // marker at this level we push + return WITHOUT descending, so
      // submodules or nested repos inside a parent-repo tree are never
      // reached (the parent repo's .git got detected first). Submodules
      // in a WORKTREE parent are similarly covered — parent worktree's
      // .git file detects, walker returns, submodule .git files never
      // visited.
      //
      // Symlinks to a .git dir/file are rejected here (lstat returns the
      // link itself, not target) to avoid loops. Malformed .git files
      // that lstat can inspect but git can't parse fall through to git
      // command failure and are silently ignored downstream.
      // Phase 104 code-review finding #6.
      if (
        (st.isDirectory() || st.isFile()) &&
        !st.isSymbolicLink()
      ) {
        out.push(dir);
        return; // outermost-only — do NOT descend
      }
    } catch {
      // lstat failed — treat as no repo, keep walking siblings.
    }
  }
  // Descend into subdirs (skip symlinks to prevent loops).
  for (const e of entries) {
    const p = path.join(dir, e);
    let st: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      st = await fs.lstat(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (!st.isDirectory()) continue;
    if (e === ".git") continue; // never descend into a .git internals dir
    await walkForRepos(p, depth + 1, out);
  }
}

/**
 * Per-identity binary "hasTrappedWork" answer. See file-top comment block
 * (section 11) for full semantics — D-01 eligibility rules, D-02 workspace
 * path, D-06 silent-fail, D-09 skip-role-lookup.
 *
 * This function deliberately DOES NOT call resolveRoleForIdentity, and DOES NOT
 * read from ROLES_HOST_DIR; the workspace path has no role indirection.
 */
export async function readIdentityTrappedWork(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ hasTrappedWork: boolean }> {
  // Validation guard — reuse the same regex the bounty-counts reader uses
  // (defense-in-depth against shell interpolation, path traversal).
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    throw new Error("invalid identityKey");
  }

  if (conn === null) {
    // LOCAL branch — walk os.homedir()/fleet/identities/<key>/workspace/.
    // D-06: silent-fail on absent workspace (returns false without throwing).
    const wsRoot = path.join(
      os.homedir(),
      WORKSPACE_PATH_PREFIX,
      identityKey,
      "workspace",
    );
    const repos: string[] = [];
    await walkForRepos(wsRoot, 0, repos);
    for (const repo of repos) {
      if (repoHasTrappedWork(repo)) return { hasTrappedWork: true };
    }
    return { hasTrappedWork: false };
  }

  // REMOTE branch — one round-trip; python3 emits a single JSON line.
  // The identityKey is validated above; the remote path interpolation is
  // safe because the regex forbids shell-special characters (see L4102-4124
  // for the mirror comment about direct-interpolation-inside-double-quotes).
  const script =
    "import os, sys, subprocess, json\n" +
    "root = os.path.expanduser(sys.argv[1])\n" +
    "MAX_DEPTH = 3\n" +
    "if not os.path.isdir(root):\n" +
    '    print(json.dumps({"hasTrappedWork": False})); sys.exit(0)\n' +
    "found = []\n" +
    "def walk(p, d):\n" +
    "    if d > MAX_DEPTH: return\n" +
    "    try: es = os.listdir(p)\n" +
    "    except Exception: return\n" +
    '    if ".git" in es:\n' +
    "        try:\n" +
    '            gp = os.path.join(p, ".git")\n' +
    "            # Accept .git as dir (normal repo) OR file (worktree gitlink)\n" +
    "            # per Phase 104 code-review finding #6. Reject symlinks to\n" +
    "            # avoid loops. D-01 outermost-only preserved via early return.\n" +
    "            if (os.path.isdir(gp) or os.path.isfile(gp)) and not os.path.islink(gp):\n" +
    "                found.append(p); return\n" +
    "        except Exception: pass\n" +
    "    for e in es:\n" +
    '        if e == ".git": continue\n' +
    "        q = os.path.join(p, e)\n" +
    "        try:\n" +
    "            if os.path.islink(q): continue\n" +
    "            if not os.path.isdir(q): continue\n" +
    "        except Exception: continue\n" +
    "        walk(q, d + 1)\n" +
    "walk(root, 0)\n" +
    "def sh(args, cwd):\n" +
    "    try:\n" +
    "        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=5)\n" +
    "        if r.returncode != 0: return ''\n" +
    "        return r.stdout or ''\n" +
    "    except Exception: return ''\n" +
    "for repo in found:\n" +
    "    try:\n" +
    '        if not sh(["git", "remote"], repo).strip(): continue\n' +
    '        status = sh(["git", "status", "--porcelain=v1"], repo)\n' +
    "        if any(len(l) >= 2 and l[1] != '?' for l in status.split('\\n')):\n" +
    '            print(json.dumps({"hasTrappedWork": True})); sys.exit(0)\n' +
    "        try:\n" +
    '            n = int((sh(["git", "rev-list", "--branches", "--not", "--remotes", "--count"], repo).strip() or "0"))\n' +
    "        except ValueError: n = 0\n" +
    "        if n > 0:\n" +
    '            print(json.dumps({"hasTrappedWork": True})); sys.exit(0)\n' +
    '        if sh(["git", "stash", "list"], repo).strip():\n' +
    '            print(json.dumps({"hasTrappedWork": True})); sys.exit(0)\n' +
    "    except Exception: pass\n" +
    'print(json.dumps({"hasTrappedWork": False}))\n';
  const cmd =
    `python3 -c ${shellEscape(script)} ` +
    `"$HOME/${WORKSPACE_PATH_PREFIX}/${identityKey}/workspace"`;
  const stdout = await execWithTimeout(conn, cmd);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`remote trapped-work returned malformed payload: ${stdout}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).hasTrappedWork !== "boolean"
  ) {
    throw new Error(`remote trapped-work returned malformed payload: ${stdout}`);
  }
  return { hasTrappedWork: (parsed as { hasTrappedWork: boolean }).hasTrappedWork };
}
