/**
 * Fleet-status wire protocol — versioned zod schemas for every frame shape
 * the fleet-status channel carries (frontend↔backend AND watcher↔backend).
 *
 * schemaVersion is stamped on every frame so future changes can be gated
 * without breaking already-deployed watchers on managed boxes.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const FRAME_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// BackgroundTask — mirrors Stop hook background_tasks[] entry (RESEARCH §1)
// ---------------------------------------------------------------------------

const BackgroundTaskBaseSchema = z.object({
  id: z.string(),
  status: z.string(),
  description: z.string().optional(),
});

const ShellTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("shell"),
  command: z.string().optional(),
});

const SubagentTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("subagent"),
  agent_type: z.string().optional(),
});

const MonitorTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("monitor"),
  server: z.string().optional(),
  tool: z.string().optional(),
});

const WorkflowTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("workflow"),
  name: z.string().optional(),
});

const TeammateTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("teammate"),
});

const CloudSessionTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("cloud session"),
});

const McpTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.literal("MCP task"),
  server: z.string().optional(),
  tool: z.string().optional(),
});

// Fallback for unknown task types
const UnknownTaskSchema = BackgroundTaskBaseSchema.extend({
  type: z.string(),
});

export const BackgroundTaskSchema = z.union([
  ShellTaskSchema,
  SubagentTaskSchema,
  MonitorTaskSchema,
  WorkflowTaskSchema,
  TeammateTaskSchema,
  CloudSessionTaskSchema,
  McpTaskSchema,
  UnknownTaskSchema,
]);

export type BackgroundTask = z.infer<typeof BackgroundTaskSchema>;

// ---------------------------------------------------------------------------
// SessionState — mirrors the watcher's published state for a (host, tmuxSession)
//
// Phase 41 Plan 03 (2026-08-15): added `lastMessageAt` as an OPTIONAL,
// NULLABLE numeric field carrying the unix-millis timestamp of the newest
// message-bearing frame in the underlying session JSONL, EITHER DIRECTION
// (user-sent OR assistant-sent). Tool-use, thinking blocks, streaming ticks,
// lifecycle events, and background-task starts/stops do NOT contribute to
// this signal — the recency signal is edge-triggered ONLY on messages either
// direction (user 2026-08-14 lock: "activity = message either direction,
// and only that"). Semantics:
//   - number (unix millis) → newest message-bearing frame timestamp.
//   - null                → no message-bearing history known for this session.
//   - undefined           → emitting watcher pre-dates Phase 41 Plan 03; the
//                           frontend consumer treats undefined and null
//                           identically (both flip the row to the top of the
//                           middle zone per user's no-history-to-top rule).
// Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is
// deliberately HELD AT 1 — additive+optional extensions never require a
// version bump (T-41-03-05 mitigation). If a future breaking change lands,
// THAT change bumps the version.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 47 Plan 01 (2026-08-20): added `aiTitle` as an OPTIONAL, NULLABLE
// string field carrying the harness-produced current-work hint for a session.
// Source: the LAST JSONL line matching `{"type":"ai-title","aiTitle":"…",
// "sessionId":"…"}` in the session's `.claude/projects/<hash>/<uuid>.jsonl`,
// discovered via the same Phase 32 `discoverIdentitySessionFile` flow the
// lastMessageAt scan uses (see Phase 47 CONTEXT.md § domain). Semantics:
//   - string  → the current ai-title from the session harness (evolves
//               across turns — the LAST line wins).
//   - null    → session has no ai-title yet (fresh session pre-harness-write,
//               or empty JSONL, or malformed line).
//   - undefined → emitting watcher pre-dates Phase 47 Plan 01; the frontend
//               consumer treats undefined and null identically (both flow
//               into the working-store as null → row subtitle renders the
//               fallback ellipsis per the LOCKED v14 design).
// Reconciliation rule at the working-store is LAST-WINS (not max-wins like
// lastMessageAt) — ai-titles evolve as the topic drifts (CONTEXT.md § working-
// store third axis). This schema is purely the wire; reconciliation lives
// downstream in Plan 47-03.
// Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is
// deliberately HELD AT 1 — additive+optional extensions never require a
// version bump (same T-41-03-05 mitigation invariant that Phase 41 Plan 03
// established for lastMessageAt).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 52 Plan 01 (2026-08-20): added `dormant` as an OPTIONAL, NULLABLE
// boolean field carrying the inline supervisor-dormancy signal for a session.
// Source: the `~/fleet/identities/<tmuxSession>/.dormant` sentinel file on
// the target host. Presence of the sentinel ⇔ identity is dormant
// (supervisor-managed pause). Semantics:
//   - true      → sentinel file present; the identity has been parked by the
//                 supervisor and has no live claude process.
//   - false     → sentinel file absent; the identity is in normal operation.
//   - null      → normalised-null in transit (backend may emit null when it
//                 cannot distinguish true/false due to SSH error — treated as
//                 false by the frontend per the AND-of-negations Ready predicate).
//   - undefined → emitting watcher pre-dates Phase 52 Plan 01; frontend
//                 treats undefined and null identically (both → false).
// This field is published by TWO sources in ssh-poll-orchestrator:
//   Source A: per-PID tick — stats the sentinel for live-PID identities.
//   Source B: per-host tick — enumerates ~/fleet/identities/*/ and stats
//             each sentinel for dormant-only identities with no live PID.
// Because the field is `.optional().nullable()`, FRAME_SCHEMA_VERSION is
// deliberately HELD AT 1 — additive+optional extensions never require a
// version bump (same T-41-03-05 mitigation invariant established for
// lastMessageAt and inherited by aiTitle).
//
// Phase 52 Plan 01 Task 3 relaxes `pid` to z.number().int().nullable() so
// source B (dormant-only identities with no live claude process) can publish
// frames with pid:null. Source A still publishes numeric PIDs. Frontend
// consumers treat pid as opaque (Plan 03 only reads dormant + isWorking).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 53 Plan 01 (2026-08-21): added `recycling` as an OPTIONAL, NULLABLE
// boolean field carrying the backend-authoritative identity-recycling signal
// for a session.
//
// Source: the caretaker's `~/fleet/identities/<tmuxSession>/.recycled-at`
// sentinel file on the target host. Presence of the sentinel ⇔ identity is
// currently being replaced via the /id-reset routine (renamed from
// `.recycle-requested` at recycle-intent detection, before the outgoing claude
// PID exits; removed with an 8s delay after the fresh claude is up and driven
// through /id — the whole window is on-disk with no gaps).
//
// Semantics:
//   - true      → sentinel file present; the identity is being replaced via the
//                 /id-reset routine (recycle in flight).
//   - false     → sentinel file absent; the identity is in normal operation OR
//                 dormant OR any other non-recycling state.
//   - null      → normalised-null in transit (backend may emit null when it
//                 cannot distinguish true/false due to SSH error — frontend
//                 store treats as `false` at Axis E because `null === true`
//                 evaluates false. In practice source B never emits null —
//                 fail-open logic collapses null stats to boolean `false`
//                 before construction — so this branch is defensive only.
//   - undefined → the emitting source does NOT participate in the recycling
//                 axis for this frame. Frontend store Axis E preserves the
//                 cached value (session-working-store.ts:382). See §
//                 inline-260830-source-a-omit-recycling below.
//
// Scope-lock: recycling means SPECIFICALLY "identity is being replaced via the
// reset routine." It does NOT expand to memory-cap restarts, dormancy-wake, or
// any other harness-down state. Those have their own overlays (dormant /
// connection-drop / inactive) and MUST NOT flip recycling.
//
// Sole authority: source B (per-identity enumeration in pollDormantOnlyIdentities)
// is the ONLY publisher that stamps recycling. Source A OMITS the field per
// inline-260830-source-a-omit-recycling (user 2026-08-30, taylor) — an
// earlier version had source A stamp `recycling: false` explicitly on every
// per-PID publish, which wiped the frontend cache immediately after source B
// fired `recycling: true` on sentinel drop. Source B's fingerprint dedup then
// suppressed the re-publish, leaving the store stuck at false through the
// rest of the recycle window. Migrating to source-B-only + source-A-omit
// (via undefined preserved by Axis E) closes that gap end-to-end. See
// ssh-poll-orchestrator.ts:1455 and the QT-260823-73o + inline-260830 tests.
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// (same T-41-03-05 mitigation established for lastMessageAt in Phase 41 and
// inherited by aiTitle in Phase 47 + dormant in Phase 52).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 62 Plan 03 (WIP hook-based rewrite 2026-08-30): added `activityMtime`
// and `stoppedMtime` as OPTIONAL, NULLABLE numeric fields carrying the two
// per-session marker-file mtimes that back the new direct-signal WIP
// predicate. The frontend Plan 62-04 will compute the whole predicate as one
// comparison per session per render:
//
//   `activityMtime > stoppedMtime` → working (affordance lit); else → not
//    working (affordance off).
//
// No state machine, no smoothing, no shell-idle gate — just one comparison.
//
// Sources:
//   - `activityMtime`: mtime of `~/.claude/fleet-status/hooks/<sessionId>/activity`
//     on the target host, × 1000 (seconds → unix millis). Touched by the
//     Plan 62-01 activity-hook.sh, installed via Plan 62-02, on two hook
//     events: UserPromptSubmit (user submitted a prompt) and PreToolUse
//     (agent began invoking a tool).
//   - `stoppedMtime`: mtime of `~/.claude/fleet-status/hooks/<sessionId>/stopped`
//     on the target host, × 1000. Touched by the Plan 62-01 stopped-hook.sh,
//     installed via Plan 62-02, on three hook events: Stop (turn finished
//     cleanly), StopFailure (turn ended in error), PermissionRequest (agent
//     blocked waiting on user for a permission decision — same as done from
//     the affordance's perspective).
//
// Semantics (both fields):
//   - number    → mtime present (unix millis).
//   - null      → marker file absent OR SSH-hiccup normalised-null. The
//                 frontend treats both cases IDENTICALLY at the
//                 session-working-store boundary: both signal "no direct
//                 hook signal available for this session — Option-1 rollout
//                 fallback engages, use the retained Phase 59 predicate."
//   - undefined → emitting backend pre-dates Phase 62. Frontend treats
//                 undefined and null identically at the working-store
//                 boundary (matches the Phase 59 pattern established for
//                 lastStopAt).
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// — SIXTH iteration of the T-41-03-05 mitigation. Phase lineage:
//   Phase 41 lastMessageAt (2026-08-15)     → held at 1
//   Phase 47 aiTitle       (2026-08-20)     → held at 1
//   Phase 52 dormant       (2026-08-20)     → held at 1
//   Phase 53 recycling     (2026-08-21)     → held at 1
//   Phase 59 lastStopAt+lastStatusChangeAt  (2026-08-29) → held at 1
//   Phase 62 activityMtime + stoppedMtime   (2026-08-30) → held at 1 (this)
//
// Rollout note (CONTEXT.md § Rollout — Option 1, LOCKED for this phase):
// The Phase 59 lastStopAt + lastStatusChangeAt fields (added directly below
// this comment block, see next section) are RETAINED — NOT retired — for the
// entire duration of Phase 62's rollout window. The backend publishes BOTH
// signal sets simultaneously on every frame; the frontend session-working-
// store (Plan 62-04) chooses which predicate applies per-session based on
// marker presence:
//   - activityMtime !== null || stoppedMtime !== null → new predicate
//     (Plan 62-04 mtime comparison).
//   - both null → fall through to the retained Phase 59 shell-idle-gate
//     predicate (user has adapted to the known bugs on unupgraded boxes;
//     adaptation is intact until each box gets the Plan 62-02 installer).
// A follow-up phase (orchestrator-tracked, post-full-rollout) retires the
// Phase 59 fields cleanly once every managed box is confirmed installed.
// Retention over deletion is the blast-radius-safe direction (CLAUDE.md —
// a bad deploy loses user access to her whole fleet).
//
// Cache-preservation cross-reference: the two mtime reads in
// ssh-poll-orchestrator.ts's processPid loop fail-open on SSH hiccup (null
// return) and absent-file (empty stdout) — the cached value is preserved,
// matching the lastMessageAt / aiTitle / dormant / lastStopAt patterns.
// See ssh-poll-orchestrator.ts PidCacheEntry.activityMtime + stoppedMtime.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 90 Plan 00 (Wave 0, 2026-09-08): added `contextPct` as an OPTIONAL,
// NULLABLE numeric field carrying the per-session context-window fill %
// (0-100) — the same value PrettyView's compose-box meter reads today.
//
// D-10 delivery mechanism (user 2026-09-08 plan-checker resolution): rather
// than let contextPct live ONLY in PrettyView's local `useState`, it is
// PROMOTED to a per-session field on fleet-status. Both surfaces subscribe
// via the frontend hook `useSessionContextPct(hostId, tmuxSession)`:
//   - PrettyView (D-03 mechanical waiver): swaps `useState<number|null>` for
//     the hook; the WS `context_pct` frame handler becomes a no-op.
//   - Plan 06 relay-pane badge appendage (future): the badge meter reads from
//     the same hook. Same session key format, same source of truth.
//
// Source: dual-write from the two existing `context_pct` WS emission sites in
// `claude-session-server.ts` into a per-session in-memory shared map
// (`contextpct-store.ts`), read at fleet-status frame publish time
// (subscription-registry.ts) so every snapshot + update frame carries this
// field.
//
// Semantics:
//   - number    → context% present (0-100, integer).
//   - null      → no value known yet for this session (fresh session pre-scrape,
//                 or dormant → null sentinel, or SSH-hiccup normalised-null).
//                 Frontend treats null as "no meter reading — hold last known
//                 value or render nothing" per the existing PrettyView
//                 hold-last discipline (see PrettyView.tsx L566-569 comment).
//   - undefined → emitting backend pre-dates Phase 90 Plan 00. Frontend
//                 consumer treats undefined and null identically at the hook
//                 boundary. (Same additive-optional discipline as every prior
//                 extension.)
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// — seventh iteration of the T-41-03-05 mitigation. Lineage:
//   Phase 41 lastMessageAt                       → held at 1
//   Phase 47 aiTitle                             → held at 1
//   Phase 52 dormant                             → held at 1
//   Phase 53 recycling                           → held at 1
//   Phase 59 lastStopAt + lastStatusChangeAt     → held at 1
//   Phase 62 activityMtime + stoppedMtime        → held at 1
//   Phase 90 contextPct  (2026-09-08)            → held at 1 (this)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 111 Plan 111-02 (2026-09-16): added `identityAppearance` as an
// OPTIONAL, NULLABLE nested object carrying the resolved identity cosmetics +
// role inheritance — the appearance the conversation list row needs to dress
// itself without a separate GET /identities round-trip.
//
// What and when: Phase 111 appearance resolved from the host-side sweep's raw
// identity + role frontmatter (Plan 111-01 widened the sweep to emit
// `identity_cosmetics`, `role_cosmetics`, `role`, `pinned`). The merge
// (`identity ?? role ?? null`, with the D-05 carve-outs) is applied
// server-side in `ssh-poll-orchestrator`'s source-B adapter (Plan 111-03)
// via `resolveIdentityAppearance` from `fleet-status/identity-appearance.ts`.
// (Phase 115 Plan 115-02: `hidden` retired from the sweep-line appearance set per D-21.)
//
// Source of the value: the sweep's `identity_cosmetics` / `role_cosmetics` /
// `role` / `pinned` fields on each `SweepIdentityLine`, merged in
// the source-B adapter. The resolved object is placed on `SessionState.identityAppearance`
// and flows through `publishSessionState` → `subscription-registry` → snapshot
// and update frames untouched. NOT re-stamped by `subscription-registry`
// (unlike `contextPct` which re-stamps because its source is an out-of-band
// store) — appearance arrives ON the frame already resolved, so re-stamping
// would require a second server-side appearance store, a second authority, which
// D-09 (Plan 111 CONTEXT.md) explicitly forbids.
//
// Semantics (three-valued):
//   - object    → appearance fully resolved from sweep line this tick (Plan
//                 111-04 frontend merge: write these fields onto the identity
//                 row using the names verbatim from `publicIdentity()`).
//   - null      → identity file could not be read on this tick (fail-closed).
//                 Consumer holds its last known appearance and NEVER blanks the
//                 row — an answer that knows less must never blank one that
//                 knew more (D-09). Null is a "hold" signal, not a "clear" signal.
//   - undefined → emitting host predates Plan 111-01 (no appearance fields on
//                 sweep line) OR this is a source-A frame (PID-keyed, not
//                 identity-keyed). Frontend consumer treats undefined identically
//                 to null: hold last, never blank.
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// — eighth iteration of the T-41-03-05 mitigation. Lineage:
//   Phase 41 lastMessageAt                       → held at 1
//   Phase 47 aiTitle                             → held at 1
//   Phase 52 dormant                             → held at 1
//   Phase 53 recycling                           → held at 1
//   Phase 59 lastStopAt + lastStatusChangeAt     → held at 1
//   Phase 62 activityMtime + stoppedMtime        → held at 1
//   Phase 90 contextPct  (2026-09-08)            → held at 1
//   Phase 111 identityAppearance (2026-09-16)    → held at 1 (this)
// ---------------------------------------------------------------------------

export const IdentityAppearanceSchema = z.object({
  // Field names are publicIdentity()'s names verbatim so the frontend merge
  // (Plan 111-04) is a straight field copy, not a translation layer.
  displayName: z.string(),
  title: z.string().nullable(),
  colorHue: z.number().nullable(),
  voice: z.string().nullable(),
  task: z.string().nullable(),
  coordinator: z.boolean(),
  role: z.string().nullable(),
  // Three-valued semantics: null → no role; {} → role with no cosmetics; {...} → role values.
  roleDefaults: z.record(z.string(), z.unknown()).nullable(),
  avatarUrl: z.string(),
  pinned: z.boolean(),
  // Phase 117 M6 fix (2026-09-18): `project` field from the identity file's
  // frontmatter (D-05 identity carrier). resolveIdentityAppearance already
  // returns this on the resolved appearance, and the source-B publisher hands
  // it to the frontend via SessionState.identityAppearance — but pre-fix,
  // this schema did NOT declare it, so zod's default strip behavior removed
  // it in transit. Combined with H1, that made live-updating identity
  // project assignments impossible over the WS. Nullable (identity file
  // has no project frontmatter) + optional (backward compat with older
  // publishers that don't emit the field yet).
  project: z.string().nullable().optional(),
});

export type IdentityAppearance = z.infer<typeof IdentityAppearanceSchema>;

// ---------------------------------------------------------------------------
// Phase 59 Plan 01 (2026-08-29): added `lastStopAt` and `lastStatusChangeAt`
// as OPTIONAL, NULLABLE numeric fields carrying the two axes that back the
// WIP-shell-idle-gate predicate on the frontend.
//
// Sources:
//   - `lastStopAt`: UNCONDITIONALLY the mtime of the per-session Stop file
//     `~/.claude/fleet-status/stop-<sessionId>.json` on the target host,
//     derived via `stat -c %Y * 1000` (seconds → unix millis). Does NOT
//     fall back to the box-wide `last-stop-payload.json` mtime — the
//     box-wide file's mtime bumps on EVERY session's turn-end and would
//     be a false positive for any session that is not the last one to end
//     a turn on that box.
//   - `lastStatusChangeAt`: derived SERVER-SIDE by comparing this-tick
//     `sessionJson.status` to the previous-tick cached status held in
//     `PidCacheEntry.lastStatus`. Updated ONLY when the two differ; on
//     first appearance seeded to `deps.now()`. MUST NOT be sourced from
//     `sessionJson.updatedAt` — the harness bumps `updatedAt` on
//     compose-box typing without a real state transition (would defeat
//     the whole point of the stop-gate).
//
// Semantics (both fields):
//   - number    → value present (unix millis).
//   - null      → normalised-null in transit (backend may emit null when
//                 it cannot distinguish — treated as "no signal" by the
//                 frontend predicate, which then default-ons per rollout
//                 safety).
//   - undefined → emitting backend pre-dates Phase 59 Plan 01. Frontend
//                 consumer treats undefined and null identically at the
//                 session-working-store boundary (see 59-03).
//
// Additive-optional invariant: FRAME_SCHEMA_VERSION deliberately HELD AT 1
// — fifth iteration of the T-41-03-05 mitigation established for
// lastMessageAt in Phase 41 and inherited by aiTitle in Phase 47 + dormant
// in Phase 52 + recycling in Phase 53.
// ---------------------------------------------------------------------------

export const SessionStateSchema = z.object({
  hostId: z.string(),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
  // Phase 52 Plan 01 Task 3 — relaxed from z.number() to z.number().int().nullable()
  // so source B (dormant-only identity frames with no live claude process) can
  // publish pid:null. Source A still publishes numeric PIDs from /proc enumeration.
  pid: z.number().int().nullable(),
  status: z.enum(["busy", "shell", "idle", "waiting"]),
  waitingFor: z.string().optional(),
  backgroundTasks: z.array(BackgroundTaskSchema),
  updatedAt: z.number(),
  // Phase 41 Plan 03 — recency signal (see block comment above).
  lastMessageAt: z.number().nullable().optional(),
  // Phase 47 Plan 01 — inline current-work hint (see block comment above).
  aiTitle: z.string().nullable().optional(),
  // Phase 52 Plan 01 — inline supervisor-dormancy signal (see block comment above).
  dormant: z.boolean().nullable().optional(),
  // Phase 53 Plan 01 — inline backend-authoritative recycling signal (see block comment above).
  recycling: z.boolean().nullable().optional(),
  // Phase 59 Plan 01 — mtime of the per-session Stop file (see block comment above).
  lastStopAt: z.number().nullable().optional(),
  // Phase 59 Plan 01 — server-derived status-transition timestamp (see block comment above).
  lastStatusChangeAt: z.number().nullable().optional(),
  // Phase 62 Plan 03 — mtime of the per-session activity marker (see block comment above).
  activityMtime: z.number().nullable().optional(),
  // Phase 62 Plan 03 — mtime of the per-session stopped marker (see block comment above).
  stoppedMtime: z.number().nullable().optional(),
  // Phase 90 Plan 00 (Wave 0, D-10 delivery mechanism) — per-session context %
  // fill (0-100, integer). Populated by subscription-registry.publishSessionState
  // + getSnapshot at frame-publish time from the contextpct-store shared map,
  // which is dual-written by the two `context_pct` WS emission sites in
  // claude-session-server.ts. See block comment above.
  contextPct: z.number().nullable().optional(),
  // Phase 111 Plan 111-02 — resolved identity appearance (see block comment above).
  identityAppearance: IdentityAppearanceSchema.nullable().optional(),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------------------------------------------------------------------------
// WatcherInboundFrame — frames sent FROM watcher TO backend
// ---------------------------------------------------------------------------

const WatcherHelloFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("hello"),
  hostname: z.string(),
});

const WatcherSessionStateFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("session_state"),
  state: SessionStateSchema,
});

const WatcherSessionGoneFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("session_gone"),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
});

export const WatcherInboundFrame = z.discriminatedUnion("type", [
  WatcherHelloFrameSchema,
  WatcherSessionStateFrameSchema,
  WatcherSessionGoneFrameSchema,
]);

export type WatcherInboundFrameType = z.infer<typeof WatcherInboundFrame>;

// ---------------------------------------------------------------------------
// FrontendInboundFrame — frames sent FROM frontend client TO backend
// ---------------------------------------------------------------------------

const FrontendSubscribeFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("subscribe"),
});

const FrontendPingFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("ping"),
});

export const FrontendInboundFrame = z.discriminatedUnion("type", [
  FrontendSubscribeFrameSchema,
  FrontendPingFrameSchema,
]);

export type FrontendInboundFrameType = z.infer<typeof FrontendInboundFrame>;

// ---------------------------------------------------------------------------
// FrontendOutboundFrame — frames sent FROM backend TO frontend clients
// ---------------------------------------------------------------------------

const FrontendSnapshotFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("snapshot"),
  states: z.array(SessionStateSchema),
});

const FrontendUpdateFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("update"),
  state: SessionStateSchema,
});

const FrontendGoneFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("gone"),
  hostId: z.string(),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
});

const FrontendPongFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("pong"),
});

// ---------------------------------------------------------------------------
// Phase 115 Plan 115-06 (D-06, D-18): FrontendIdentityArchivedFrame — DISTINCT
// wire message for identity rows sourced from ~/fleet/identities-archive/
// (SweepIdentityLine.archived === true, added by Plan 115-05).
//
// Locked wire-shape decision (from 115-06 plan `<action>` block): archived
// rows are NOT bolted onto the standard identity frame as `archived: true` —
// they get their OWN frame kind. Rationale:
//   1. D-06 lock: archived rows are inert. A phantom `archived` boolean on
//      the standard identity frame would leak that inertness across every
//      active identity (which is always `archived: false`) — extra state
//      the frontend must destructure on every frame for no purpose.
//   2. Frontend routing: archived rows go into a distinct store slice
//      (conversation-store.archivedFleetRows), NOT state.identities. A
//      distinct frame kind maps 1:1 onto that routing.
//   3. Future extension: if archive-tree rows grow additional fields (e.g.
//      archived-at timestamp), they live on this frame without polluting
//      the standard identity frame.
//
// Shape: { kind: "identity-archived", name, hostId, hostname }
//   - name: identity name (matches SweepIdentityLine.identity — the same
//     value the standard identity frame carries as tmuxSession).
//   - hostId: string (matches SessionState.hostId's string convention).
//   - hostname: the friendly host name (frontend renders it in the archived
//     row's parenthetical hostname suffix).
//
// FRAME_SCHEMA_VERSION deliberately HELD AT 1 — adding a new discriminated-
// union entry is additive and does NOT break older clients: they simply
// drop the frame at the `default` branch of the ws.onmessage switch (see
// fleet-status-client.ts § "Unknown frame type — drop silently"). Same
// mitigation invariant every prior appearance/session extension has
// followed since Phase 41.
// ---------------------------------------------------------------------------

const FrontendIdentityArchivedFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("identity-archived"),
  name: z.string(),
  hostId: z.string(),
  hostname: z.string(),
});

// ---------------------------------------------------------------------------
// Phase 117 Plan 117-03 (D-37): FrontendProjectListChangedFrame — DISTINCT
// wire message for the projects pool.
//
// Locked wire-shape decision (from 117-03 plan `<action>` block): projects
// are NOT bolted onto SessionState or the identity-archived frame — they get
// their OWN frame kind. Rationale:
//   1. D-37 lock: projects are a distinct pool (host-level, not session-level
//      or identity-level). Same rationale that separated identity-archived
//      from SessionState in Phase 115.
//   2. Full-array-on-every-emit (RESEARCH § Open Q #4): projects are cheap
//      (< 20 typical), and a full replace is simpler than a delta. Frontend
//      snapshotVersion invalidates on every publish which is fine per
//      RESEARCH § Pitfall 4.
//   3. Registry-cache-then-fanout discipline (matches Phase 115): the
//      subscription-registry maintains a single-cell cache and byte-compares
//      on publish to skip idempotent republishes. Snapshot-on-subscribe
//      replays the cached array to reconnecting clients.
//
// Shape: { schemaVersion, type: "project-list-changed", projects: [...] }
//   - projects: Array of { slug, displayName, hostId, hostname, archived }.
//     Each project field is server-derived from the project's frontmatter
//     (Wave 1's Phase 117 Plan 01 primitives).
//
// FRAME_SCHEMA_VERSION deliberately HELD AT 1 — ninth iteration of the
// T-41-03-05 mitigation. Adding a new discriminated-union entry is additive
// and does NOT break older clients (they see a `type` value they don't
// handle and drop it silently at the default branch of the WS switch).
// ---------------------------------------------------------------------------

export const FrontendProjectListChangedFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("project-list-changed"),
  projects: z.array(
    z.object({
      slug: z.string(),
      displayName: z.string(),
      hostId: z.string(),
      hostname: z.string(),
      archived: z.boolean(),
    }),
  ),
});

export const FrontendOutboundFrame = z.discriminatedUnion("type", [
  FrontendSnapshotFrameSchema,
  FrontendUpdateFrameSchema,
  FrontendGoneFrameSchema,
  FrontendPongFrameSchema,
  FrontendIdentityArchivedFrameSchema,
  FrontendProjectListChangedFrameSchema,
]);

export type FrontendOutboundFrameType = z.infer<typeof FrontendOutboundFrame>;

// ---------------------------------------------------------------------------
// Helper: build outbound frames with schemaVersion stamped automatically
// ---------------------------------------------------------------------------

export function makeSnapshotFrame(
  states: SessionState[],
): FrontendOutboundFrameType {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "snapshot", states };
}

export function makeUpdateFrame(state: SessionState): FrontendOutboundFrameType {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "update", state };
}

export function makeGoneFrame(
  hostId: string,
  tmuxSession: string | null,
  sessionId: string,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "gone",
    hostId,
    tmuxSession,
    sessionId,
  };
}

export function makePongFrame(): FrontendOutboundFrameType {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "pong" };
}

/**
 * Phase 115 Plan 115-06 (D-06, D-18): construct an `identity-archived` frame
 * for a row sourced from the archive tree. Called by ssh-poll-orchestrator's
 * source-B loop when a SweepIdentityLine has `archived === true`.
 */
export function makeIdentityArchivedFrame(
  name: string,
  hostId: string,
  hostname: string,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "identity-archived",
    name,
    hostId,
    hostname,
  };
}

/**
 * Phase 117 Plan 117-03 (D-37): construct a `project-list-changed` frame
 * carrying the FULL projects array. Called by subscription-registry's
 * publishProjectListChanged after cache-hit deduplication. Wave 2 write
 * routes invoke publishProjectListChanged (not this helper directly).
 */
export function makeProjectListChangedFrame(
  projects: Array<{
    slug: string;
    displayName: string;
    hostId: string;
    hostname: string;
    archived: boolean;
  }>,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "project-list-changed",
    projects,
  };
}
