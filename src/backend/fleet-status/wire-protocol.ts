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
// direction (Ashley 2026-08-14 lock: "activity = message either direction,
// and only that"). Semantics:
//   - number (unix millis) → newest message-bearing frame timestamp.
//   - null                → no message-bearing history known for this session.
//   - undefined           → emitting watcher pre-dates Phase 41 Plan 03; the
//                           frontend consumer treats undefined and null
//                           identically (both flip the row to the top of the
//                           middle zone per Ashley's no-history-to-top rule).
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
// Source: the `~/.claude/identities/<tmuxSession>/.dormant` sentinel file on
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
//   Source B: per-host tick — enumerates ~/.claude/identities/*/ and stats
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
// Source: the caretaker's `~/.claude/identities/<tmuxSession>/.recycled-at`
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
// inline-260830-source-a-omit-recycling (Ashley 2026-08-30, taylor) — an
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
//     events: UserPromptSubmit (Ashley submitted a prompt) and PreToolUse
//     (agent began invoking a tool).
//   - `stoppedMtime`: mtime of `~/.claude/fleet-status/hooks/<sessionId>/stopped`
//     on the target host, × 1000. Touched by the Plan 62-01 stopped-hook.sh,
//     installed via Plan 62-02, on three hook events: Stop (turn finished
//     cleanly), StopFailure (turn ended in error), PermissionRequest (agent
//     blocked waiting on Ashley for a permission decision — same as done from
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
//     predicate (Ashley has adapted to the known bugs on unupgraded boxes;
//     adaptation is intact until each box gets the Plan 62-02 installer).
// A follow-up phase (orchestrator-tracked, post-full-rollout) retires the
// Phase 59 fields cleanly once every managed box is confirmed installed.
// Retention over deletion is the blast-radius-safe direction (CLAUDE.md —
// a bad deploy loses Ashley access to her whole fleet).
//
// Cache-preservation cross-reference: the two mtime reads in
// ssh-poll-orchestrator.ts's processPid loop fail-open on SSH hiccup (null
// return) and absent-file (empty stdout) — the cached value is preserved,
// matching the lastMessageAt / aiTitle / dormant / lastStopAt patterns.
// See ssh-poll-orchestrator.ts PidCacheEntry.activityMtime + stoppedMtime.
// ---------------------------------------------------------------------------

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

export const FrontendOutboundFrame = z.discriminatedUnion("type", [
  FrontendSnapshotFrameSchema,
  FrontendUpdateFrameSchema,
  FrontendGoneFrameSchema,
  FrontendPongFrameSchema,
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
