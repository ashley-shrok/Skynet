import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { sshLogger, databaseLogger } from "../utils/logger.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { discoverClaudeSession } from "./session-file-discovery.js";
import { discoverIdentitySessionFile } from "./discover-identity-session-file.js";
import { parseSessionLine, detectIdReset } from "./session-file-parser.js";
import { tailSessionFile, type TailHandle } from "./session-file-tail.js";
// Phase 50 Plan 02 — signal-driven send-path watchdog. Replaces the OLD
// PTY-activity-proxy watchdog formerly at src/backend/ssh/ (patch quick
// 260803-1xw, deleted in Phase 50 Plan 02 Task 3). See pv-send-watchdog.ts file header for the
// three-stage timing chain + hash-derivation contract.
import {
  armPvSendWatchdog,
  clearPvSendWatchdog,
  clearPvSendWatchdogsForSession,
  notifyMatched as notifyPvSendMatched,
} from "./pv-send-watchdog.js";
// Phase 47 Plan 03: bounded JSONL slice reader for the load-more button
// (Plan 01 output). Used by handleFetchOlderRange below AND by
// startActiveSessionFlow's Hunk B totalLines probe.
import { readSessionFileRange } from "./session-file-range-reader.js";
import {
  applyLineToLayer1State,
  type Layer1State,
} from "./layer1-detect.js";
import { __applySentinelCheckForTests } from "./sentinel-detect.js";
import {
  createPaneStateEmitter,
  type PaneStateEmitter,
} from "./pane-state-emitter.js";
import { parseContextPct } from "./context-pct-parser.js";
import { readContextPctFromJsonl } from "./context-pct-from-jsonl.js";
import { isPlanPending, parsePlanFilePath } from "./plan-pending-parser.js";
import { fetchPlanFile } from "../ssh/plan-file-fetch.js";
import { execCommand } from "../ssh/tmux-helper.js";
import {
  handleUploadStart,
  handleUploadChunk,
  handleUploadAbort,
  cleanupBatchesForConnection,
} from "../ssh/pretty-view-upload.js";
import type {
  UploadStartPayload,
  UploadChunkPayload,
  UploadAbortPayload,
} from "../../ui/api/pretty-view-upload-protocol.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
  IDENTITY_SLUG_RE,
  BOUNTY_PRIORITY_VALUES,
  BOUNTY_STATUS_VALUES,
  humanizeWakeupSchedule,
  readIdentityFile,
  readIdentityHistory,
  readIdentityWakeups,
  readIdentityHandoff,
  readIdentityBounties,
  readIdentityBountyCounts,
  readRoleFile,
  writeIdentityWakeupUpdate,
  writeIdentityFile,
  writeIdentityHistory,
  writeIdentityHandoff,
  writeRoleFile,
  writeIdentityBountyPriority,
  writeIdentityBountyStatus,
  writeIdentityBountyPinned,
  writeIdentityBountyNeedsDesk,
  writeIdentityBountyFields,
  archiveIdentityBounty,
  deleteIdentityBounty,
  type BountyPriority,
  type BountyStatus,
  type BountyFieldsPatch,
} from "./identity-artifact-reader.js";

/**
 * Live Claude-session WebSocket server on port 30011.
 *
 * Wire protocol (V1 hard-lock, RENDER-01 — IMAGES EXCEPTED per patch #86):
 *
 *   client -> server:
 *     { type: "connectToPane", hostId: number, tmuxSession: string }
 *     { type: "identity:list-bounties", identityKey: string, hostId?: number }    // patch #87/#92: fetch identity bounties; hostId routes to pane's box (omit = local bind-mount)
 *     { type: "identity:count-bounties", targets: Array<{ identityKey: string; hostId: number | null }> } // quick 260727-tb1 / Phase 26: batched bounty counter (pinned + needs-desk) for the per-row badge (one WS request per poll)
 *     // patch #17g/#92: identity artifact fetches (one-shot; no pane needed):
 *     { type: "identity:get-identity-file", identityKey: string, hostId?: number } // patch #17g/#92: fetch <key>.md
 *     { type: "identity:get-role-file", identityKey: string, hostId?: number }     // Phase 22 SRIC-06: fetch ~/.claude/roles/<role>/<role>.md via backend two-step (identity file → role: frontmatter → role artifact)
 *     { type: "identity:get-history", identityKey: string, hostId?: number }       // patch #17g/#92: fetch history.md
 *     { type: "identity:list-wakeups", identityKey: string, hostId?: number }      // patch #17g/#92: list wakeups/*.json
 *     { type: "identity:get-handoff", identityKey: string, hostId?: number }       // patch #17g/#92: fetch handoff.md
 *     // patch #154: first WRITE paths on identity artifacts. Same hostId routing.
 *     { type: "identity:update-wakeup", identityKey: string, hostId?: number, wakeupSlug: string, updates: { enabled?: boolean, schedule?: object } } // patch #154: patch wakeups/<slug>.json
 *     { type: "identity:update-bounty-priority", identityKey: string, hostId?: number, bountySlug: string, priority: "urgent"|"high"|"medium"|"low"|"unprioritized" } // patch #154: patch bounties/<slug>/bounty.json
 *     { type: "identity:update-bounty-status", identityKey: string, hostId?: number, bountySlug: string, status: "in_progress"|"waiting_on_someone_else"|"done"|"dropped" } // quick 260727-v0b / patch #168: patch bounties/<slug>/bounty.json status field. Allowed values: in_progress, waiting_on_someone_else, done, dropped. "pinned" removed from enum (now an independent boolean field). Folder NOT moved even for done/dropped — supports Ashley's resurrect flow via a pure JSON patch.
 *     { type: "identity:update-bounty-pinned", identityKey: string, hostId?: number, bountySlug: string, pinned: boolean } // quick 260728-sqk / patch #172: patch bounties/<slug>/bounty.json pinned field. `pinned` is an independent boolean orthogonal to status per fleet migration #168. Byte-shape mirror of update-bounty-status — flips the boolean, bumps updated_at, appends timeline line, folder untouched.
 *     { type: "identity:update-bounty-fields", identityKey: string, hostId: number, bountySlug: string, patch: BountyFieldsPatch } // Phase 18 / IDMEDIT-04: partial-JSON-patch write for bounty fields (title/premise/todos/keywords/source_links/deadline/meeting_questions). Only fields present in `patch` are written; server-owned fields (id/created_at/updated_at/timeline/pinned/requested_by) are protected. updated_at bumped unconditionally; one timeline entry per changed field. pinned rejected — use update-bounty-pinned. Returns fresh {bounties,archivedBounties} for BountyCard rehydration.
 *     { type: "identity:archive-bounty", identityKey: string, hostId?: number, bountySlug: string } // quick 260727-wd0: server decides new status internally (flip live→done or preserve terminal), then mv bounties/<slug>/ under bounties/archive/<slug>/ (mkdir -p archive/ if absent). No client-supplied status field.
 *     { type: "identity:delete-bounty", identityKey: string, hostId?: number, bountySlug: string } // quick 260729-g5r / patch #183: permanent rm -rf of a bounty folder. Applies to BOTH open (bounties/<slug>/) AND archived (bounties/archive/<slug>/) cards — server rm's both candidate paths with force:true so one call covers both locations. No confirmation gate here; window.confirm() lives in BountyCard.
 *     // Phase 18 / IDMEDIT-06: markdown write surfaces (full-overwrite, tmp+rename atomic):
 *     { type: "identity:update-identity-file", identityKey: string, hostId: number, contents: string } // Phase 18: full-overwrite <key>/<key>.md via SFTP tmp+rename (REMOTE) or fs tmp+rename (LOCAL)
 *     { type: "identity:update-role-file", identityKey: string, hostId: number, contents: string }     // Phase 22 SRIC-06: full-overwrite ~/.claude/roles/<role>/<role>.md via backend two-step
 *     { type: "identity:update-history", identityKey: string, hostId: number, contents: string }       // Phase 18: full-overwrite <key>/history.md
 *     { type: "identity:update-handoff", identityKey: string, hostId: number, contents: string }       // Phase 18: full-overwrite <key>/handoff.md
 *     // hostId routing (patch #92): when omitted OR when the hostId is in IDENTITIES_LOCAL_HOST_IDS,
 *     // reads from the local bind-mount (IDENTITIES_HOST_DIR); otherwise SSHes to the pane's host.
 *     // Response shapes UNCHANGED — only request payloads gain the optional hostId field.
 *
 *   server -> client:
 *     { type: "session", pid, sessionFile }                      // metadata
 *     { type: "message", role, content, eventId, ts }            // per parsed JSONL line
 *     { type: "image", role, images, text, eventId, ts }         // per parsed JSONL turn carrying base64 image content (patch #86, WS-inline b64)
 *     { type: "wip", active }                                    // work-in-progress state (emitted on transitions + once as initial state)
 *     { type: "context_pct", pct }                               // 0-100, live scrape of Claude Code status-line "context) NN%"
 *     { type: "harness_tasks", tasks }                           // Claude Code /queue + TaskCreate items — read from ~/.claude/tasks/<sid>/*.json
 *     { type: "backgrounded_agents", agents }                    // currently-running Agent{run_in_background:true} subagents — derived from JSONL tool_use/tool_result correlation (patch #61)
 *     { type: "backgrounded_shells", shells }                    // currently-running Bash{run_in_background:true} shells — derived from JSONL tool_use / task-notification correlation (patch #68)
 *     { type: "plan_pending", pending }                          // pending = { planFilePath: string|null, planContent: string|null, contentError: string|null } | null (Phase 24 widened; presence via pane-scrape quick 260802-rps + parent-JSONL fallback patch #63; planContent fetched async via SFTP side-channel Phase 24 Plan 02)
 *     // (client -> server, Phase 24) { type: "raw_keystrokes", bytes: string } — one-shot PTY write via `tmux send-keys -l`, NO split-send. Used by PlanPendingBubble Approve ("1\r") + Feedback ("3<text>\r"). Split-send (patch #44) is NOT recognized by Ink Plan Mode as a keystroke selection.
 *     // quick 260808-cd6 — dormancy overlay + wake button:
 *     { type: "dormant", dormant: boolean }                      // server -> client: emit-only-on-change; identity pane's .dormant sentinel state
 *     { type: "pane_state", state: "active"|"holding"|"dormant"|"inactive"|"error", reason?: string } // Phase 30 PS30-01: authoritative pane-entry state verdict; emitted alongside every existing dormant/session_holding/session_holding_cleared/session_changed/inactive transition + on connectToPane attach. Legacy frames remain on the wire this phase for backward compat (deprecation deferred per 30-CONTEXT.md § Deferred).
 *     // (client -> server, quick 260808-cd6) { type: "wake" } — delete ~/.claude/identities/<name>/.dormant via SSH exec; backend uses connection-scoped currentTmuxSession (T-cd6-01 mitigation)
 *     { type: "wake_result", ok: boolean, error?: string }       // server -> client: response to { type: "wake" }
 *     { type: "inactive", reason }                               // FALLBACK-01: send once, then silent
 *     { type: "tail_error", message }                            // recoverable: client may render a banner
 *     { type: "error", message, code? }                          // fatal for this pane
 *     { type: "identity:bounties", bounties, archivedBounties, error? } // patch #87: response to identity:list-bounties (one-shot; WS closed by client after receipt)
 *     { type: "identity:bounty-counts", counts: Array<{ identityKey, hostId, pinnedCount, needsDeskCount, error? }> } // quick 260727-tb1 / Phase 26: response to identity:count-bounties (one-shot; WS closed by client after receipt)
 *     // patch #17g: identity artifact responses (one-shot; WS closed by client after receipt):
 *     { type: "identity:identity-file", markdown: string, error?: string } // patch #17g: response to identity:get-identity-file
 *     { type: "identity:role-file", markdown: string, error?: string }      // Phase 22 SRIC-06: response to identity:get-role-file
 *     { type: "identity:history", entries: string[], error?: string }       // patch #17g: response to identity:get-history
 *     { type: "identity:wakeups", wakeups: Wakeup[], error?: string }       // patch #17g: response to identity:list-wakeups
 *     { type: "identity:handoff", markdown: string, error?: string }        // patch #17g: response to identity:get-handoff
 *     // patch #154: post-write responses carry the FRESH list so the client can atomically re-render without a follow-up read.
 *     { type: "identity:wakeup-updated", wakeups: Wakeup[], error?: string }  // patch #154: response to identity:update-wakeup (includes refreshed list)
 *     { type: "identity:bounty-priority-updated", bounties, archivedBounties, error?: string } // patch #154: response to identity:update-bounty-priority (includes refreshed lists)
 *     { type: "identity:bounty-status-updated", bounties, archivedBounties, error?: string } // quick 260727-v0b: response to identity:update-bounty-status (includes refreshed lists)
 *     { type: "identity:bounty-pinned-updated", bounties, archivedBounties, error?: string } // quick 260728-sqk / patch #172: response to identity:update-bounty-pinned (includes refreshed lists — normalizeBounty carries `pinned:boolean` on every bounty)
 *     { type: "identity:bounty-fields-updated", bounties, archivedBounties, error?: string } // Phase 18 / IDMEDIT-04: response to identity:update-bounty-fields (fresh bounty lists for BountyCard rehydration — same convention as priority/status/pinned echoes)
 *     { type: "identity:bounty-archived", bounties, archivedBounties, error?: string } // quick 260727-wd0: response to identity:archive-bounty (includes refreshed lists — bounty moved from `bounties` list to `archivedBounties` list)
 *     { type: "identity:bounty-deleted", bounties, archivedBounties, error?: string } // quick 260729-g5r / patch #183: response to identity:delete-bounty (includes refreshed lists — bounty drops out of BOTH lists since its folder is gone)
 *     // Phase 18 / IDMEDIT-06: post-write echoes — server re-reads after write so client rehydrates from server-side truth:
 *     { type: "identity:identity-file-updated", markdown: string, error?: string } // Phase 18: response to identity:update-identity-file (confirmed markdown post-write)
 *     { type: "identity:role-file-updated", markdown: string, error?: string }      // Phase 22 SRIC-06: response to identity:update-role-file (confirmed markdown post-write, re-read via two-step)
 *     { type: "identity:history-updated", entries: string[], error?: string }       // Phase 18: response to identity:update-history (server re-reads + re-parses entries)
 *     { type: "identity:handoff-updated", markdown: string, error?: string }        // Phase 18: response to identity:update-handoff (confirmed markdown post-write)
 *
 * Image frames carry inline base64 payloads: each `images[]` element is
 * `{ data: string, mediaType: string, toolUseId?: string }` where `data`
 * is raw base64 with no `data:` URI prefix (the frontend adds one at
 * render time). A typical PNG Read is ~150KB on the wire — acceptable
 * for the read-only sessions pretty-view targets, and there is no HTTP
 * fallback endpoint to bolt onto (pretty-view is WS-only architecture).
 *
 * Auth model mirrors `src/backend/ssh/terminal.ts` exactly: cookie `jwt=`
 * then `Authorization: Bearer <token>` then `?token=` query fallback. JWT
 * verified by AuthManager singleton; UserCrypto data-key must be resolved
 * (otherwise close 1008 with DATA_LOCKED per the terminal WS posture).
 *
 * Keep-alive follows patch #10's convention: `ws.ping()` every 30 s and
 * terminate on a double-miss of `pong`. This survives Chrome's
 * intensive-throttling on backgrounded tabs because ping/pong frames are
 * dispatched by the browser's networking layer, not the JS event loop.
 *
 * FALLBACK-01 enforcement (never reach back to a prior session file):
 * when discovery returns `inactive`, the server emits a single
 * `{type:"inactive",reason}` frame and STOPS. It does not open a tail; it
 * does not look at any other file. Any future scope creep here should
 * touch this comment first.
 */

const authManager = AuthManager.getInstance();
const userCrypto = UserCrypto.getInstance();

// Patch #92: humanizeWakeupSchedule moved to identity-artifact-reader.ts to avoid
// circular dependency (reader imports from server → server imports from reader would cycle).
// Imported above and re-exported so callers outside this module can still use it if needed.
export { humanizeWakeupSchedule };

// pv-malformed-line-dedup-across-tail-restarts (2026-08-10): stable eventId
// derived from the raw malformed line so appendDedup can collapse replays.
// tailSessionFile runs `tail -F -n +1`, which re-reads from line 1 on every
// (re)start (WS reconnect / session_changed / patch #344 visibility resume);
// without a content-derived id, each replay of the same malformed line got a
// fresh random id and stacked as a new bubble. 12 hex chars = 48 bits, ample
// for line-uniqueness within one session file.
function malformedEventId(rawLine: string): string {
  return (
    "malformed-" +
    createHash("sha1").update(rawLine).digest("hex").slice(0, 12)
  );
}
export const __malformedEventIdForTests = malformedEventId;

// ─── Phase 47 Plan 03 Hunk A: shared reshape helper ─────────────────────────
//
// `reshapeParsedLineToWireFrame` was extracted from the streaming-tail
// dispatch switch (was inline at ~L2416-2522). It is the SINGLE source of
// truth for turning a `ParsedLine` (from parseSessionLine) into a wire
// frame — used by both:
//   (a) the streaming-tail onLine callback (real-time playback of new lines
//       written to the JSONL as the conversation progresses); and
//   (b) `handleFetchOlderRange` (Plan 47-03 Hunk C — the load-more button's
//       WS request handler, reads a bounded slice of older lines).
//
// Wire-shape parity between the two paths is structurally guaranteed by
// their SHARED call to this helper. Without the extraction, streaming-tail
// and range-fetch would drift on frame shape (parser produces {kind:"..."},
// wire expects {type:"..."} with role/content/eventId/ts fields — the
// reshape is 100+ lines of case handling; duplicating would guarantee bugs).
//
// Signature:
//   parsed:  the discriminated-union output of parseSessionLine
//   rawLine: the original raw JSONL line (needed by the malformed branch for
//            malformedEventId(rawLine))
//   line:    the 1-indexed JSONL line-number that produced `parsed` — Plan
//            01 widened every per-turn wire type with an optional `line?:
//            number` field so the client can track `oldestLoadedLine` and
//            derive the next `beforeLine` cursor value.
// Returns:
//   The wire-frame object (a member of the `StreamEvent` union below),
//   OR null when `parsed.kind === "skip"` (silent-drop policy inherited
//   from the streaming-tail's original switch — RENDER-01 hard-lock).
//
// The `StreamEvent` local type alias mirrors Plan 01's
// `FetchOlderRangeBatchEvent.messages[]` union in claude-session-api.ts —
// the same 5 per-turn types the streaming tail emits. Local alias (rather
// than an import) keeps this backend file free of a cross-boundary type
// coupling for what is effectively a purely-local emit shape.
type StreamEvent =
  | {
      type: "message";
      role: "user" | "assistant";
      content: string;
      eventId: string;
      ts: number;
      line: number;
    }
  | {
      type: "image";
      role: "user" | "assistant" | "tool_result";
      images: import("./session-file-parser.js").ImageBlock[];
      text: string;
      eventId: string;
      ts: number;
      line: number;
    }
  | {
      type: "relay_outbound";
      room: string | null;
      rawCommand: string;
      body: string | null;
      eventId: string;
      ts: number;
      line: number;
    }
  | {
      type: "relay_inbound";
      room: string;
      sender: string;
      matrixEventId: string;
      body: string;
      raw: string;
      eventId: string;
      ts: number;
      line: number;
    }
  | {
      type: "malformed_line";
      bytes: number;
      eventId: string;
      ts: number;
      line: number;
    };

export function reshapeParsedLineToWireFrame(
  parsed: import("./session-file-parser.js").ParsedLine,
  rawLine: string,
  line: number,
): StreamEvent | null {
  switch (parsed.kind) {
    case "message":
      return {
        type: "message",
        role: parsed.role,
        content: parsed.content,
        eventId: parsed.eventId,
        ts: parsed.ts,
        line,
      };
    case "image":
      return {
        type: "image",
        role: parsed.role,
        images: parsed.images,
        text: parsed.text,
        eventId: parsed.eventId,
        ts: parsed.ts,
        line,
      };
    case "relay_outbound":
      // bounty pretty-view-outgoing-relay-render: body ?? null so JSON.stringify
      // emits an explicit null; the frontend's `body !== null` check would take
      // the pretty branch on undefined and produce an invisible bubble.
      return {
        type: "relay_outbound",
        room: parsed.room,
        rawCommand: parsed.rawCommand,
        body: parsed.body ?? null,
        eventId: parsed.eventId,
        ts: parsed.ts,
        line,
      };
    case "relay_inbound":
      return {
        type: "relay_inbound",
        room: parsed.room,
        sender: parsed.sender,
        matrixEventId: parsed.matrixEventId,
        body: parsed.body,
        raw: parsed.raw,
        eventId: parsed.eventId,
        ts: parsed.ts,
        line,
      };
    case "malformed":
      // pv-malformed-jsonl-placeholder-bubble: eventId is a content-hash of
      // the raw line so tail-restart replays dedupe via appendDedup instead
      // of stacking a fresh placeholder each restart.
      return {
        type: "malformed_line",
        bytes: parsed.bytes,
        eventId: malformedEventId(rawLine),
        ts: Date.now(),
        line,
      };
    case "skip":
      // RENDER-01 hard-lock: kind:"skip" (meta / empty_content /
      // harness_wrapper / no_message / unknown-type) is silently dropped.
      // Caller filters nulls before pushing to the messages array.
      return null;
    default: {
      // Exhaustive-check guard — TS narrows `parsed` to `never` here if
      // every case is covered. If parseSessionLine gains a new kind and
      // this switch isn't updated, the assignment fails compilation.
      const _exhaustive: never = parsed;
      void _exhaustive;
      return null;
    }
  }
}
export const __reshapeParsedLineToWireFrameForTests = reshapeParsedLineToWireFrame;

// ─── Phase 51 Plan 01: backgrounded-agents correlator (extracted test seam) ──
//
// State type for the extracted correlator. Mirrors the closure-local Map value
// shapes at ~L2143 (backgroundedAgents), ~L2162 (backgroundedShells), and the
// new pendingAgentAdmission scratch map introduced in Task 2 of Phase 51 Plan
// 01 (see 51-RESEARCH.md § "Fix Shape (recommended)"). Kept as an inline type
// bag rather than a shared interface because the per-connection closure owns
// the concrete Maps — the helper only mutates them in place.
export type __BackgroundedAgentsCorrelatorStateForTests = {
  backgroundedAgents: Map<
    string,
    {
      toolUseId: string;
      subagentType: string;
      description: string;
      startedAt: number;
    }
  >;
  pendingAgentAdmission: Map<
    string,
    {
      toolUseId: string;
      subagentType: string;
      description: string;
      startedAt: number;
    }
  >;
  backgroundedShells: Map<
    string,
    {
      toolUseId: string;
      description: string;
      command: string;
      ts: number;
    }
  >;
};

// Phase 51 Plan 01 refactor-extract: the raw-line scan for backgrounded
// Agent / Bash tool_use → tool_result correlation used to live inline inside
// the wss.on("connection") closure (~L2527-2620 pre-refactor). Extracting
// into a module-scope helper makes the correlator unit-testable without
// spinning up a full WS server + SSH pair. The in-closure call site invokes
// this SAME helper against its own state Maps, so what tests exercise is
// what production runs.
//
// Phase 51 Plan 01 Task 2 extends the Agent branch to admit modern-shape
// (v2.1.150+) invocations via a two-step scratch-and-promote path:
//   (a) At tool_use time, Agents WITHOUT `input.run_in_background` (modern
//       shape) stash into `state.pendingAgentAdmission`. Agents WITH the
//       legacy flag admit directly to `state.backgroundedAgents` (backward
//       compat — older Claude Code or any future harness that reintroduces
//       the flag).
//   (b) At tool_result time, if `toolUseResult.isAsync === true` (the async-
//       launch-ack), any pending scratch entry with matching tool_use_id is
//       promoted into `state.backgroundedAgents`. If NOT isAsync (a real
//       sync completion), any lingering scratch entry is dropped alongside
//       the existing `backgroundedAgents.delete` — this is the "sync Agent
//       silently dropped" behavior.
// The Bash branch is UNTOUCHED — Claude Code v2.1.150+ still writes Bash
// {run_in_background:true} in the legacy shape per RESEARCH.md § "Bash
// shape on v2.1.150" empirical finding.
//
// Malformed / non-JSON lines are silently ignored — same posture as the
// parser (see the surrounding try/catch at ~L2527).
export function __admitBackgroundedAgentsLineForTests(
  line: string,
  state: __BackgroundedAgentsCorrelatorStateForTests,
): void {
  const { backgroundedAgents, pendingAgentAdmission, backgroundedShells } =
    state;
  try {
    const obj = JSON.parse(line) as {
      type?: string;
      timestamp?: string;
      message?: { content?: unknown };
    };
    const content = obj?.message?.content;
    if (obj?.type === "assistant" && Array.isArray(content)) {
      for (const block of content as unknown[]) {
        const b = block as {
          type?: string;
          name?: string;
          id?: string;
          input?: {
            run_in_background?: boolean;
            subagent_type?: unknown;
            description?: unknown;
            command?: unknown;
          };
        };
        if (
          b?.type === "tool_use" &&
          b?.name === "Agent" &&
          typeof b?.id === "string"
        ) {
          const startedAt =
            typeof obj.timestamp === "string"
              ? Date.parse(obj.timestamp) || Date.now()
              : Date.now();
          const info = {
            toolUseId: b.id,
            subagentType:
              typeof b.input?.subagent_type === "string"
                ? b.input.subagent_type
                : "",
            description:
              typeof b.input?.description === "string"
                ? b.input.description
                : "",
            startedAt,
          };
          if (b?.input?.run_in_background === true) {
            // Legacy shape (older Claude Code, or any harness that
            // reintroduces the field): admit directly — backward compat.
            backgroundedAgents.set(b.id, info);
          } else {
            // Modern shape (Claude Code v2.1.150+): stash for late admission
            // on the async-launch-ack (toolUseResult.isAsync === true). A
            // synchronous Agent will never receive the ack — its scratch
            // entry is silently dropped in the non-async completion branch
            // below (never enters backgroundedAgents, never emitted).
            pendingAgentAdmission.set(b.id, info);
          }
        }
        if (
          b?.type === "tool_use" &&
          b?.name === "Bash" &&
          b?.input?.run_in_background === true &&
          typeof b?.id === "string"
        ) {
          const ts =
            typeof obj.timestamp === "string"
              ? Date.parse(obj.timestamp) || Date.now()
              : Date.now();
          const rawCommand =
            typeof b.input.command === "string" ? b.input.command : "";
          backgroundedShells.set(b.id, {
            toolUseId: b.id,
            description:
              typeof b.input.description === "string"
                ? b.input.description
                : "",
            command: rawCommand.slice(0, 120),
            ts,
          });
        }
      }
    } else if (obj?.type === "user" && Array.isArray(content)) {
      // Async launch acks (patch #66 fix): for run_in_background:true Agent
      // invocations, Claude Code writes a tool_result within ~100ms of the
      // tool_use as a LAUNCH ACKNOWLEDGEMENT ("Async agent launched
      // successfully...") — NOT completion. The turn carries
      // toolUseResult.isAsync === true and status: "async_launched". Real
      // completion arrives ~seconds-to-minutes later as a task-notification
      // attachment turn (see the new branch below). Skip removal for the
      // ack so the panel stays mounted; the attachment branch clears it
      // on the actual completion event.
      //
      // Phase 51 Plan 01 Task 2: additionally use the ack as an ADMIT signal
      // for modern-shape (v2.1.150+) Agent invocations — the tool_use for
      // these lacked `run_in_background:true`, so they stashed to
      // `pendingAgentAdmission` instead of admitting immediately. Promote
      // any matching scratch entry into `backgroundedAgents` here.
      const isAsyncAck =
        (obj as { toolUseResult?: { isAsync?: boolean } })?.toolUseResult
          ?.isAsync === true;
      if (isAsyncAck) {
        for (const block of content as unknown[]) {
          const b = block as {
            type?: string;
            tool_use_id?: string;
          };
          if (
            b?.type === "tool_result" &&
            typeof b?.tool_use_id === "string"
          ) {
            const info = pendingAgentAdmission.get(b.tool_use_id);
            if (info) {
              backgroundedAgents.set(b.tool_use_id, info);
              pendingAgentAdmission.delete(b.tool_use_id);
            }
          }
        }
      } else {
        for (const block of content as unknown[]) {
          const b = block as {
            type?: string;
            tool_use_id?: string;
          };
          if (
            b?.type === "tool_result" &&
            typeof b?.tool_use_id === "string"
          ) {
            backgroundedAgents.delete(b.tool_use_id);
            // Phase 51 Plan 01 Task 2: sync-Agent scratch-drop. If a modern-
            // shape Agent invocation was synchronous (no async-launch-ack
            // ever arrived — first tool_result is a real completion), the
            // scratch entry lingers from tool_use time. Drop it here so it
            // never leaks into backgroundedAgents on a later replay and
            // never grows unbounded. Delete-on-absent is a no-op, so this
            // is safe for tool_use_ids that never had a scratch entry.
            pendingAgentAdmission.delete(b.tool_use_id);
          }
        }
      }
    }
  } catch {
    /* malformed line — silently ignore, same posture as parser */
  }
}

// Phase 3 session-changeover tuning constants. Holding timeout: 200 * 3s = 600s (10min).
// Per D-31 and CONTEXT.md § holding timeout — Nelly's original timing note said "new .jsonl
// appears within ~5s; fully-loaded identity ~30-70s later" but real /id reset flows
// under load can take multiple minutes (Ashley 2026-08-09: original 45s tripped the
// "recycle failed — refresh to check" red overlay ~60s into a normal reset that later
// completed fine; then teardownPane meant even after success nothing cleared the overlay).
// 10min matches the client-side belt-and-suspenders watchdog at
// src/ui/features/pretty-view/PrettyView.tsx (was 5min, bumped in the same change) so
// the two agree; the client watchdog covers the WS-drop case where the backend can't
// deliver the frame. Keep the two constants in lockstep on any future retune.
const HOLDING_TIMEOUT_TICKS = 200;
const DISCOVERY_REPOLL_INTERVAL_MS = 3000;
// Harness-tasks poller tuning — moved to module scope from the pre-refactor
// inline block so the setupHarnessTasksPoller helper (per BLOCKER fix from
// plan-checker 2026-07-18) can reference them without re-allocating per call.
const HARNESS_TASKS_INTERVAL_MS = 3000;
// quick 260808-fgf — Nelly's .resume-complete marker freshness contract.
// If marker never appears within 90s of wake_trigger_ts, fall back to
// sentinel-gone-alone dismiss (mixed-fleet compat for pre-marker supervisor boxes).
const MARKER_FALLBACK_MS = 90_000;
const UUID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Phase 14 (plain-language-translation-asides) Wave 1 — module-scope primitives.
//
// The aside subsystem injects a fixed `/btw` prompt into an identity's tmux
// pane, extracts the BTW-overlay answer, and dismisses the overlay via
// Escape. All three operations reuse the pane's existing sshConn + the
// existing execCommand primitive (per PATTERNS.md L438-440 and CONTEXT.md
// § canonical_refs: no new SSH subsystem, no new port).
//
// Per ASIDE-10 (no aside store): these helpers carry NO module-scope state —
// they are pure request/response over the passed-in SSH connection. Wave 2
// (14-02) composes them into the frontend-arm-driven poller + WS event
// surface.
//
// BTW_PROMPT is the EXACT literal text from CONTEXT.md § Injection (per
// ASIDE-03 no-paraphrase rule). The em-dash MUST be a real U+2014 character.
export const BTW_PROMPT =
  "/btw Re-explain concisely whatever's currently going on to me since my last message without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.";

// ASIDE_END_MARKER is the literal end-of-answer substring from the BTW
// overlay's footer line (full marker: `↑/↓ to scroll · f to fork · Esc to
// close`). Stable across BTW invocations in Claude Code 2.1.150 per the
// kumquat-test verification (CONTEXT.md § Mechanism).
export const ASIDE_END_MARKER = "Esc to close";

// BTW_CLEAR_HISTORY_KEY — key sent into the tmux pane before Escape to
// clear Claude Code's in-overlay /btw history before dismissing the
// overlay. Rationale: /btw history within a Claude Code session poisons
// subsequent aside answers (the model self-references prior "please
// explain" turns from earlier asides). Sending this key first gives every
// new aside a clean slate. Lowercase `x` per the overlay's clear-history
// keybinding (Ashley 2026-07-27). If UAT reveals a different key (e.g.
// `c`, `Ctrl+L`), change this constant only — the two-keystroke shape
// stays the same.
export const BTW_CLEAR_HISTORY_KEY = "x";

// Local shellQuote — byte-identical to src/backend/ssh/terminal.ts L123.
// Kept local (not cross-module import) to preserve terminal.ts's
// "no new deps, no new modules" comment above L122. If a future refactor
// promotes shellQuote to a shared module, update both call sites in lock-step.
const shellQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}'`;

// Test-only re-export of the local shellQuote helper. NOT for production
// callers — the underscore prefix marks it as an internal test seam. Lets
// claude-session-server.aside.test.ts verify byte-parity with terminal.ts L123
// without duplicating the 2-line body in the test file.
export const __asideShellQuoteForTests = shellQuote;

/**
 * injectBtw — send the fixed /btw prompt into the identity's tmux pane via
 * the pane's existing SSH connection. Wraps the send-keys payload and target
 * in shellQuote (house-style parity with terminal.ts L574 + L760). Failures
 * are logged and swallowed — a failed injection is not fatal; Wave 2's
 * poll-timeout logic handles the "no answer arrived" case.
 */
async function injectBtw(
  conn: SSHClientType,
  tmuxSession: string,
): Promise<void> {
  try {
    // Patch #152 (2026-07-26): Send BTW_PROMPT text and the Enter keystroke
    // as TWO separate tmux send-keys invocations with a 200ms gap. In one
    // call, Claude Code v2.1.150's Ink-based REPL treats the ~300-char
    // BTW_PROMPT burst as a paste and absorbs the trailing Enter into the
    // paste buffer — /btw overlay never opens. Two calls + delay lets the
    // paste buffer flush before Enter arrives as a distinct keystroke.
    // See ~/.claude/identities/tina/bounties/aside-btw-enter-not-submitting/
    // for the live reproduction + fix verification against v2.1.150.
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} ${shellQuote(BTW_PROMPT)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} Enter`,
    );
  } catch (err) {
    sshLogger.info("aside injectBtw failed", {
      operation: "aside_inject",
      tmuxSession,
      err,
    });
  }
}

// Test-only re-export of injectBtw. Same underscore-prefix convention as
// __asideShellQuoteForTests — internal seam so the vitest suite can assert
// the two-call shape locked by Patch #152. NOT for production callers.
export const __injectBtwForTests = injectBtw;

/**
 * dismissBtw — close the /btw overlay via a TWO-keystroke sequence into the
 * identity's tmux pane. Replaces the previous single-Escape dismiss so that
 * the /btw overlay's in-session history is cleared BEFORE the overlay
 * closes; without this, prior aside answers within the same Claude Code
 * session poison subsequent asides (the model self-references earlier
 * "please explain" turns from the same overlay history buffer).
 *
 * Sequence:
 *   1. tmux send-keys BTW_CLEAR_HISTORY_KEY (`x`) — clear /btw history.
 *   2. Wait 100ms (see gap rationale below).
 *   3. tmux send-keys Escape — close the /btw overlay.
 *
 * The 100ms gap mirrors the SHAPE of patch #152's injectBtw two-call
 * workaround but uses a shorter delay: dismiss is a pair of single-key
 * presses, not the ~300-char BTW_PROMPT paste that needs Ink's paste
 * buffer to flush. 100ms is enough for tmux to deliver the first keystroke
 * to the overlay before the second is queued.
 *
 * The WS frame shape (`{type:'aside_dismissed', hostId, tmuxSession}`) and
 * the frontend dismiss handler are UNCHANGED — only the backend tmux
 * keystroke sequence differs from the prior single-Escape dispatch. Both
 * send-keys calls are wrapped in a single try/catch (log-and-swallow) so a
 * failed dismiss is not fatal; the pane's Escape recovery is best-effort.
 *
 * Both send-keys payloads use shellQuote for the tmux target (house-style
 * parity with terminal.ts L574 + L760). Escape is an unquoted tmux
 * send-keys key name — same shape as `Enter` / `C-c` in terminal.ts.
 */
async function dismissBtw(
  conn: SSHClientType,
  tmuxSession: string,
): Promise<void> {
  try {
    // Step 1: clear /btw history via BTW_CLEAR_HISTORY_KEY before Escape.
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} ${shellQuote(BTW_CLEAR_HISTORY_KEY)}`,
    );
    // Step 2: 100ms gap so tmux delivers the clear-history key to the
    // overlay before Escape is queued. Shorter than injectBtw's 200ms —
    // no paste-buffer flush needed for a single-key press.
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Step 3: send Escape to close the (now history-cleared) /btw overlay.
    await execCommand(
      conn,
      `tmux send-keys -t ${shellQuote(tmuxSession)} Escape`,
    );
  } catch (err) {
    sshLogger.info("aside dismissBtw failed", {
      operation: "aside_dismiss",
      tmuxSession,
      err,
    });
  }
}

// Test-only re-export of dismissBtw. Same underscore-prefix convention as
// __injectBtwForTests — internal seam so the vitest suite can assert the
// two-call shape locked by the quick 260727-lbr change. NOT for production
// callers.
export const __dismissBtwForTests = dismissBtw;

/**
 * extractBtwAnswer — pure string function that extracts the /btw answer
 * text from a raw tmux capture-pane output snapshot.
 *
 * Input:
 *   paneOutput: raw multi-line output from `tmux capture-pane -p -S -200`
 *   marker:     the end-of-answer substring (typically ASIDE_END_MARKER,
 *               i.e. "Esc to close")
 *
 * Behavior contract (validated by claude-session-server.aside.test.ts
 * cases A-E; per 14-01-PLAN.md Task 2 <behavior>):
 *
 *   A. marker absent            → null   (answer still streaming)
 *   B. single-line answer       → the trimmed text between /btw echo + marker
 *   C. multi-line with scrollback → last-occurrence anchors on BOTH the marker
 *      AND the /btw echo pick the CURRENT invocation, not any prior BTW echo
 *      still visible in scrollback (ASIDE-04 scrollback-recovery requirement)
 *   D. marker present but no /btw echo → null (malformed; do not emit garbage
 *      to the frontend — Wave 3 renders this string into React and we do not
 *      want a false-positive aside from parsing noise)
 *   E. marker + /btw echo + zero lines between → "" (degenerate valid case;
 *      Wave 2's poll-stability guard filters these — the extractor itself
 *      does not judge)
 *
 * The `/^\s*(>\s*)?\/btw\b/` regex allows for tmux prompt prefixes like
 * `> ` that Claude Code renders before the echoed slash-command. The `\b`
 * word-boundary prevents matching random lines that happen to contain
 * `/btw` as a substring (e.g. a URL or a file path).
 */
export function extractBtwAnswer(
  paneOutput: string,
  marker: string,
): string | null {
  const lines = paneOutput.split("\n");

  // (2) Find the LAST index containing the marker substring.
  let endIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(marker)) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null; // CASE A

  // (3) Find the LAST index BEFORE endIdx that matches the /btw echo pattern.
  //     Allow optional tmux prompt prefix (e.g. `> `).
  const btwEchoRe = /^\s*(>\s*)?\/btw\b/;
  let startIdx = -1;
  for (let i = endIdx - 1; i >= 0; i--) {
    if (btwEchoRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null; // CASE D

  // (5) Slice between the two anchors (exclusive of both), join, trim.
  //     May return "" for CASE E (valid degenerate).
  return lines.slice(startIdx + 1, endIdx).join("\n").trim();
}

// Phase 14 Wave 2 (14-02) — Aside subsystem module-scope state + helpers.
//
// Non-negotiable architecture (per CONTEXT.md § Trigger + § Backend per-
// connection state locks, 2026-07-26):
//
//   * asideState MUST live at MODULE SCOPE, not inside wss.on("connection").
//     Cross-tab dismiss coherence (ASIDE-11) requires broadcastAsideDismissed
//     to flip peer WSes' `displayed` flags — closure-scoped `let` variables
//     would leave stale gates on peer connections and silently break the v1
//     overlap policy (ASIDE-08) across tabs.
//
//   * The SOLE trigger source is the client's `aside_arm` WS message. The
//     backend does NOT observe the terminal WSS idle-signal frame
//     (that runs on port 30002 in terminal.ts, a separate closure with no
//     shared state). Identity gating happens frontend-side.
//
//   * No aside store beyond these two ephemeral Maps — the tmux BTW overlay
//     is source of truth (ASIDE-10). Both Maps are keyed by live WS
//     connections / session identity and are dropped on disconnect.
//
// `asideState` — per-WS overlap-ignore gate flags.
//   `armed`: /btw has been injected on this WS, poller should scrape.
//   `displayed`: an aside is currently rendered on this WS (own render OR
//                broadcast render from another tab's arm on the same session).
//
// Phase 14 Plan 05 Task 1: `export` added so Wave 5's integration test
// suite can inspect the source-of-truth Map directly (`import { asideState }`)
// to assert cross-tab peer-state-flip coherence — the atomic BOTH-STEPS
// rule from CONTEXT.md § Backend per-connection state LOCK. This is a
// legitimate observation seam, NOT a test-only export: the Map IS the
// source of truth per the CONTEXT lock, and observing it is the same
// posture as any other exported module constant. The pre-existing
// `__asideStateForTests` alias (below) is preserved for backward
// compatibility with Wave 2's structural tests.
export const asideState = new Map<
  import("ws").WebSocket,
  { armed: boolean; displayed: boolean }
>();

// `activeViewers` — fan-out registry keyed by `${hostId}::${tmuxSession}`.
// Set on connectToPane discovery success; peer entry removed on ws.close.
const activeViewers = new Map<string, Set<import("ws").WebSocket>>();

// ASIDE_POLL_INTERVAL_MS — extraction poll cadence (per CONTEXT.md
// § Extraction: ~200-400ms; picked 300ms as the mid-point, matching the
// house-style grouping with other polling-interval constants like
// HARNESS_TASKS_INTERVAL_MS.
const ASIDE_POLL_INTERVAL_MS = 300;

// sessionKey — build the `${hostId}::${tmuxSession}` composite key used
// as the activeViewers Map's index. Delimiter `::` avoids collision with
// tmux-safe session names (frontend restricts to alphanumeric + dash +
// underscore, so `::` never appears inside the session name half).
function sessionKey(hostId: number, tmuxSession: string): string {
  return `${hostId}::${tmuxSession}`;
}

// broadcastAsideDismissed — atomic fan-out for the dismiss signal.
// LOAD-BEARING per CONTEXT.md § Backend per-connection state (2026-07-26 lock):
// MUST perform BOTH steps for every OPEN peer in activeViewers.get(key):
//   (a) send `{type:"aside_dismissed"}` frame to peer's client
//   (b) flip `asideState.get(peer).displayed = false` — resets the peer's
//       overlap-ignore gate so it can arm on the next isIdle transition.
// Missing step (b) silently breaks the v1 overlap policy (ASIDE-08) across
// tabs — the peer stays stuck on `displayed:true` forever.
function broadcastAsideDismissed(key: string): void {
  const peers = activeViewers.get(key);
  if (!peers) return;
  const frame = JSON.stringify({ type: "aside_dismissed" });
  for (const peer of peers) {
    // WebSocket.OPEN = 1 (from the "ws" package). Use the numeric sentinel
    // rather than the class constant to avoid coupling this helper to a
    // direct WebSocketServer import here (the class is imported at file top).
    if (peer.readyState !== WebSocket.OPEN) continue;
    // (a) Send the dismiss frame to the peer's client.
    try {
      peer.send(frame);
    } catch {
      /* peer may be mid-close — swallow, matching the sibling send-guards
         throughout this file */
    }
    // (b) MANDATORY per CONTEXT.md § Backend per-connection state:
    // flip the peer's `displayed` flag so its overlap-ignore gate resets
    // and the peer can arm on next turn's isIdle transition.
    const peerState = asideState.get(peer);
    if (peerState) peerState.displayed = false;
  }
}

// Test-only re-exports — internal test seams. Underscore prefix marks them
// as private; NO production caller should reference these. Enables the
// vitest suite to assert the module-scope Map identities + the atomic
// BOTH-STEPS rule of broadcastAsideDismissed without spinning up a full
// WebSocketServer.
export const __asideStateForTests = asideState;
export const __activeViewersForTests = activeViewers;
export const __sessionKeyForTests = sessionKey;
export const __broadcastAsideDismissedForTests = broadcastAsideDismissed;

// ---------------------------------------------------------------------------
// Quick 260727-tb1: identity:count-bounties handler + test seam
// ---------------------------------------------------------------------------
//
// The handler is extracted from the switch-dispatcher's message-router so the
// vitest suite can drive it without a real WebSocketServer. Wire shape:
//
//   in:  { type: "identity:count-bounties", targets: [{identityKey, hostId}, ...] }
//   out: { type: "identity:bounty-counts", counts:  [{identityKey, hostId, pinnedCount, needsDeskCount, error?}, ...] }
//
// Semantics:
//   - hostId=null OR hostId in IDENTITIES_LOCAL_HOST_IDS → local (bind-mount) branch.
//   - Otherwise: group targets by hostId, resolve host once, connectOneShot
//     once per hostId, run every identity in that hostId's group through the
//     single conn, close via try/finally.
//   - Every per-target read is wrapped in Promise.allSettled so one dead
//     SSH host cannot block the batch.
//   - Rejected reads → {pinnedCount: 0, error: String(reason)}.

type CountBountiesTarget = { identityKey: string; hostId: number | null };
type CountBountiesResult = {
  identityKey: string;
  hostId: number | null;
  pinnedCount: number;
  needsDeskCount: number;
  error?: string;
};

async function readOneTarget(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ pinnedCount: number; needsDeskCount: number }> {
  // The reader itself validates identityKey; forwarding invalid keys is fine
  // — the rejection lands in the per-target error field via allSettled.
  return readIdentityBountyCounts(conn, identityKey);
}

export async function handleIdentityCountBounties(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const rawTargets = (msg as { targets?: unknown }).targets;
  const targets: CountBountiesTarget[] = Array.isArray(rawTargets)
    ? rawTargets
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => {
          const key = typeof t.identityKey === "string" ? t.identityKey : "";
          const hostIdRaw = t.hostId;
          const hostId =
            typeof hostIdRaw === "number" &&
            Number.isFinite(hostIdRaw) &&
            hostIdRaw > 0
              ? hostIdRaw
              : null;
          return { identityKey: key, hostId };
        })
    : [];

  if (targets.length === 0) {
    try {
      ws.send(JSON.stringify({ type: "identity:bounty-counts", counts: [] }));
    } catch (err) {
      databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-counts err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" });
    }
    return;
  }

  // Group targets by "routing key": hostId=null / local hosts → "local";
  // otherwise the numeric hostId. Each group opens one conn (or zero for
  // the local group) and reads all its identities through the same conn.
  const groups = new Map<string | number, CountBountiesTarget[]>();
  for (const t of targets) {
    const useLocal = t.hostId === null || isLocalHostId(t.hostId);
    const groupKey: string | number = useLocal ? "local" : t.hostId!;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(t);
    else groups.set(groupKey, [t]);
  }

  // Fan-out: each group returns Array<CountBountiesResult>. Group-level
  // failures (host not found, connectOneShot rejection) collapse into
  // per-target error entries so the caller still gets a uniform response.
  const groupPromises: Array<Promise<CountBountiesResult[]>> = [];
  for (const [groupKey, bucket] of groups) {
    if (groupKey === "local") {
      groupPromises.push(
        (async () => {
          const settled = await Promise.allSettled(
            bucket.map((t) => readOneTarget(null, t.identityKey)),
          );
          return settled.map((s, i) => {
            const t = bucket[i];
            if (s.status === "fulfilled") {
              return {
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: s.value.pinnedCount,
                needsDeskCount: s.value.needsDeskCount,
              };
            }
            return {
              identityKey: t.identityKey,
              hostId: t.hostId,
              pinnedCount: 0,
              needsDeskCount: 0,
              error: String((s.reason as Error)?.message ?? s.reason),
            };
          });
        })(),
      );
    } else {
      const hostIdNum = groupKey as number;
      groupPromises.push(
        (async () => {
          let conn: SSHClientType | null = null;
          try {
            const resolved = await resolveHostById(hostIdNum, userId!);
            if (!resolved) {
              return bucket.map((t) => ({
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: 0,
                needsDeskCount: 0,
                error: "host not found",
              }));
            }
            conn = await connectOneShot(
              resolved as unknown as Parameters<typeof connectOneShot>[0],
              5000,
            );
            const settled = await Promise.allSettled(
              bucket.map((t) => readOneTarget(conn, t.identityKey)),
            );
            return settled.map((s, i) => {
              const t = bucket[i];
              if (s.status === "fulfilled") {
                return {
                  identityKey: t.identityKey,
                  hostId: t.hostId,
                  pinnedCount: s.value.pinnedCount,
                  needsDeskCount: s.value.needsDeskCount,
                };
              }
              return {
                identityKey: t.identityKey,
                hostId: t.hostId,
                pinnedCount: 0,
                needsDeskCount: 0,
                error: String((s.reason as Error)?.message ?? s.reason),
              };
            });
          } catch (err) {
            // Group-level failure (resolveHostById throw or connect timeout).
            const msgStr = err instanceof Error ? err.message : String(err);
            return bucket.map((t) => ({
              identityKey: t.identityKey,
              hostId: t.hostId,
              pinnedCount: 0,
              needsDeskCount: 0,
              error: msgStr,
            }));
          } finally {
            if (conn) {
              try {
                conn.end();
              } catch (err) {
                databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" });
              }
            }
          }
        })(),
      );
    }
  }

  const groupResults = await Promise.all(groupPromises);
  const counts: CountBountiesResult[] = groupResults.flat();

  try {
    ws.send(JSON.stringify({ type: "identity:bounty-counts", counts }));
  } catch {
    /* ws may be mid-close */
  }
}

// Test seam — quick 260727-tb1. Vitest drives the handler directly rather
// than spinning up a WebSocketServer + ssh2 pair. Aliased to underscore so
// production consumers stay clear of the internal handler.
export const __handleIdentityCountBountiesForTests = handleIdentityCountBounties;

// ─── Phase 22 SRIC-06 / Plan 22-06: identity:get-role-file WS handler ──────────
//
// Byte-shape mirror of the identity:get-identity-file handler at L1928+ (which
// remains inline; extracting it would break the "byte-shape mirror" audit
// principle established in this plan). The new handlers are extracted to give
// them the same test seam as handleIdentityCountBounties above — vitest can
// drive them directly with mocked readRoleFile / resolveHostById / connectOneShot
// without a full WSS bring-up.
//
// Wire shape (mirrors identity:get-identity-file exactly):
//   request:  { type: "identity:get-role-file", identityKey: string, hostId?: number }
//   response: { type: "identity:role-file", markdown: string, error?: string }
//
// Backend does the two-step (identity file → role: frontmatter → role artifact)
// inside readRoleFile — the WS handler is a mechanical mirror of the
// identity-file version and does NOT parse frontmatter itself. Missing role:
// frontmatter surfaces as {error: "..."} per D-CONTEXT § "No no-role fallback
// branches" (LOCKED with Ashley 2026-08-04).

export async function handleIdentityGetRoleFile(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const m = (msg ?? {}) as { identityKey?: unknown; hostId?: unknown };
  const rawKey = m.identityKey;
  if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
    try {
      ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: "invalid identityKey" }));
    } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
    return;
  }
  const identityKey = rawKey;
  const rawHostId = m.hostId;
  const hostIdNum =
    typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
      ? rawHostId
      : undefined;
  const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

  try {
    let markdown: string;
    if (useLocal) {
      ({ markdown } = await readRoleFile(null, identityKey));
      sshLogger.info("identity:get-role-file", {
        operation: "identity_get_role_file",
        userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: markdown.length,
      });
    } else {
      const resolved = await resolveHostById(hostIdNum!, userId!);
      if (!resolved) {
        try { ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
      try {
        ({ markdown } = await readRoleFile(conn, identityKey));
        sshLogger.info("identity:get-role-file", {
          operation: "identity_get_role_file",
          userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: markdown.length,
        });
      } finally {
        try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
      }
    }
    try { ws.send(JSON.stringify({ type: "identity:role-file", markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
  } catch (err: unknown) {
    sshLogger.error(
      "identity:get-role-file error",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_get_role_file_error", userId, identityKey, hostId: hostIdNum },
    );
    try {
      ws.send(JSON.stringify({ type: "identity:role-file", markdown: "", error: err instanceof Error ? err.message : String(err) }));
    } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
  }
}

// ─── Phase 22 SRIC-06 / Plan 22-06: identity:update-role-file WS handler ───────
//
// Byte-shape mirror of the identity:update-identity-file handler at L2213+.
// After write, re-reads via readRoleFile so the client rehydrates from
// server-side truth (T-22-06-05 mitigation — no client-side draft trust,
// server echo is authoritative). writeRoleFile handles the two-step, byte
// cap, and IDENTITY_KEY_RE guards internally.

export async function handleIdentityUpdateRoleFile(
  ws: WebSocket,
  msg: unknown,
  userId: string | undefined,
): Promise<void> {
  const m = (msg ?? {}) as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
  const rawKey = m.identityKey;
  const rawContents = m.contents;
  if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
    try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
    return;
  }
  if (typeof rawContents !== "string") {
    try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: "contents must be a string" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
    return;
  }
  const identityKey = rawKey;
  const contents = rawContents;
  const rawHostId = m.hostId;
  const hostIdNum =
    typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
      ? rawHostId
      : undefined;
  const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
  try {
    let markdown: string;
    if (useLocal) {
      await writeRoleFile(null, identityKey, contents);
      ({ markdown } = await readRoleFile(null, identityKey));
      sshLogger.info("identity:update-role-file", {
        operation: "identity_update_role_file",
        userId, identityKey, hostId: hostIdNum, useLocal: true,
        bytes: Buffer.byteLength(contents, "utf-8"),
      });
    } else {
      const resolved = await resolveHostById(hostIdNum!, userId!);
      if (!resolved) {
        try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
      try {
        await writeRoleFile(conn, identityKey, contents);
        ({ markdown } = await readRoleFile(conn, identityKey));
        sshLogger.info("identity:update-role-file", {
          operation: "identity_update_role_file",
          userId, identityKey, hostId: hostIdNum, useLocal: false,
          bytes: Buffer.byteLength(contents, "utf-8"),
        });
      } finally {
        try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
      }
    }
    try { ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
  } catch (err) {
    sshLogger.error(
      "identity:update-role-file unexpected error",
      err instanceof Error ? err : new Error(String(err)),
      { operation: "identity_update_role_file_error", userId, identityKey, hostId: hostIdNum },
    );
    try {
      ws.send(JSON.stringify({ type: "identity:role-file-updated", markdown: "", error: err instanceof Error ? err.message : String(err) }));
    } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:role-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
  }
}

// Test seams — Plan 22-06. Same pattern as __handleIdentityCountBountiesForTests
// above. Vitest drives the handlers directly with mocked reader/writer helpers.
export const __handleIdentityGetRoleFileForTests = handleIdentityGetRoleFile;
export const __handleIdentityUpdateRoleFileForTests = handleIdentityUpdateRoleFile;

// ─── Phase 47 Plan 03 Hunk C: handleFetchOlderRange WS handler ────────────────
//
// Client → server request: `{ type: "fetch_older_range", beforeLine, count }`
// (see FetchOlderRangePayload in src/ui/api/claude-session-api.ts). Server
// reads lines `[max(1, beforeLine - count), beforeLine - 1]` inclusive via
// the Plan 01 range reader, parses+reshapes each via the shared
// `reshapeParsedLineToWireFrame` helper (also used by the streaming-tail
// dispatch — this shared helper is what makes streaming and range-fetched
// frames byte-identical on the wire, including the additive `line: number`
// field Plan 01 widened onto every per-turn wire type), filters skip nulls,
// and emits a `fetch_older_range_batch` response.
//
// Trust boundary (T-47-09, mirror of raw_keystrokes' T-14-02-01 at L4349):
// `currentSessionFile` is read from `deps` (the dispatch branch captures it
// from connection scope at L1845). Never accepted from the client payload.
//
// v1 skip-frame policy (LOCKED via Test 8 of the plan's test suite): skip
// frames drop out, batch may be shorter than count. We do NOT re-read to
// refill — additive behavior means clicking again works, and the client's
// next `beforeLine` uses the batch's oldest visible line via `oldestLine`.
//
// Reject-not-clamp (LOCKED via Test 4): count > 20 or < 1 emits an error
// frame; matches Plan 01's reader-side 200-cap defense-in-depth and
// prevents silent client/server drift (asked for 1e9, got 20 without notice).
//
// Error frame (LOCKED via Test 2): missing sshConn or currentSessionFile
// emits `{ ..., messages: [], oldestLine: 0, hasMore: false, error: "no
// active session" }`, NOT silent return — the client's in-flight state
// needs to be dismissible without hanging forever, and Plan 04's button
// error-state variant is what shows the user "the click did something".
//
// Cursor semantic: LINE-cursor, not eventId-cursor. Plan 01's revision
// (see 47-01-SUMMARY.md § key-decisions) eliminated any need to scan
// the JSONL to resolve an eventId to a line — handler does ONE bounded
// `readSessionFileRange` call per request. No scan, no search step of
// any kind (this is what allows the 200-line reader cap to be
// architecturally sufficient rather than a fragile invariant).

export async function handleFetchOlderRange(
  ws: WebSocket,
  msg: unknown,
  deps: {
    sshConn: SSHClientType | null;
    currentSessionFile: string | null;
    currentHostId: number | null;
    // Phase 50 Plan 01 Task 2: thread the JSONL session UUID so the
    // parser's queue-operation branch produces the same deterministic
    // eventId shape that the streaming-tail dispatch produces (the
    // frontend's per-eventId dedup Set is keyed line-scoped by eventId).
    // Optional — legacy callers/tests can omit; parser falls back to
    // fallbackEventId() for the queue-op branch only.
    sessionIdFromFile?: string | null;
  },
): Promise<void> {
  // Inline helper: DRY the error-emit sites. Every error path emits the
  // same shape — `messages:[], oldestLine:0, hasMore:false, error:<msg>` —
  // and the client's gate is the presence of `error`.
  const emitErrorFrame = (errMsg: string): void => {
    try {
      ws.send(
        JSON.stringify({
          type: "fetch_older_range_batch",
          messages: [],
          oldestLine: 0,
          hasMore: false,
          error: errMsg,
        }),
      );
    } catch (err) {
      databaseLogger.warn(
        `[ws-server] send-failed msgType=fetch_older_range_batch err="${err instanceof Error ? err.message : String(err)}"`,
        { operation: "ws_send_failed" },
      );
    }
  };

  // ─ Input-validation gate — BEFORE any I/O. Same discipline as
  //   handleIdentityGetRoleFile L744-750 (validate shape+bounds first,
  //   trust-boundary second, work third).
  const m = (msg ?? {}) as {
    type?: unknown;
    beforeLine?: unknown;
    count?: unknown;
  };
  if (m.type !== "fetch_older_range") {
    emitErrorFrame("invalid type");
    return;
  }
  if (!Number.isInteger(m.beforeLine) || (m.beforeLine as number) < 1) {
    emitErrorFrame("invalid beforeLine");
    return;
  }
  const beforeLine = m.beforeLine as number;
  if (
    !Number.isInteger(m.count) ||
    (m.count as number) < 1 ||
    (m.count as number) > 20
  ) {
    // Reject-not-clamp: matches Plan 01's reader-side throw on count > 200
    // (defense-in-depth) and CONTEXT.md § scope-edges batch-size lock of 20
    // (client always passes 20). Silent clamping would drift semantics.
    emitErrorFrame("invalid count");
    return;
  }
  const count = m.count as number;

  // ─ Trust-boundary gate (T-47-09): both `sshConn` and `currentSessionFile`
  //   MUST originate from connection scope. Missing = pane not yet
  //   discovered (client sent fetch_older_range before connectToPane
  //   completed, or after teardownPane cleared them). Not silent return —
  //   the client needs the error frame to dismiss in-flight state.
  if (!deps.sshConn || !deps.currentSessionFile) {
    emitErrorFrame("no active session");
    return;
  }

  // ─ Clamp the LINE range so we never ask the reader for lines <1 or an
  //   empty range. `beforeLine=1` means client is already at the top.
  const startLine = Math.max(1, beforeLine - count);
  const rangeCount = Math.min(count, beforeLine - 1);
  if (rangeCount <= 0) {
    // Nothing to read — client's beforeLine=1 (or lower after gate). Emit
    // an empty success (not error) so the client updates hasMore=false
    // and unmounts the button gracefully.
    try {
      ws.send(
        JSON.stringify({
          type: "fetch_older_range_batch",
          messages: [],
          oldestLine: 1,
          hasMore: false,
        }),
      );
    } catch (err) {
      databaseLogger.warn(
        `[ws-server] send-failed msgType=fetch_older_range_batch err="${err instanceof Error ? err.message : String(err)}"`,
        { operation: "ws_send_failed" },
      );
    }
    return;
  }

  // ─ Read the range. try/catch surfaces reader errors as an error frame
  //   without crashing the WS.
  let readResult: { lines: string[]; totalLines: number };
  try {
    readResult = await readSessionFileRange(
      deps.sshConn,
      deps.currentSessionFile,
      startLine,
      rangeCount,
    );
  } catch (err) {
    emitErrorFrame(err instanceof Error ? err.message : String(err));
    return;
  }

  // ─ Parse + reshape each line via the SHARED helper (Hunk A output). Skip
  //   frames reshape to null; filter them out (v1 partial-batch policy,
  //   Test 8 lock — no refill).
  const messages: StreamEvent[] = [];
  for (let i = 0; i < readResult.lines.length; i++) {
    const lineNumber = startLine + i;
    const rawLine = readResult.lines[i];
    // Phase 50 Plan 01 Task 2: sessionId threaded from connection scope
    // so the parser's queue-operation branch (Task 1) derives a
    // deterministic eventId matching the streaming-tail dispatch's shape.
    // Note: dedup is NOT applied here — the range-fetch path emits older
    // history whose enqueue → dequeue pairs already surfaced live; the
    // frontend's per-eventId dedup Set handles collapse on the client.
    const parsed = parseSessionLine(rawLine, deps.sessionIdFromFile ?? undefined);
    const frame = reshapeParsedLineToWireFrame(parsed, rawLine, lineNumber);
    if (frame !== null) {
      messages.push(frame);
    }
  }

  // ─ oldestLine reflects the LINE range asked (startLine), not the
  //   wire-frame count. hasMore = startLine > 1 (there are still older
  //   lines behind this batch).
  const oldestLine = startLine;
  const hasMore = startLine > 1;

  try {
    ws.send(
      JSON.stringify({
        type: "fetch_older_range_batch",
        messages,
        oldestLine,
        hasMore,
      }),
    );
  } catch (err) {
    databaseLogger.warn(
      `[ws-server] send-failed msgType=fetch_older_range_batch err="${err instanceof Error ? err.message : String(err)}"`,
      { operation: "ws_send_failed" },
    );
  }
}

// Test seam — mirrors __handleIdentityGetRoleFileForTests convention above.
// Vitest drives the handler directly (with a mocked readSessionFileRange)
// via this alias, without needing a real WebSocketServer + ssh2 pair.
export const __handleFetchOlderRangeForTests = handleFetchOlderRange;

// ─── Test seam: discovery-repoll tick logic (Fix A + Fix B, quick 260730-sjf) ──
//
// The discoveryRepollTimer .then() callback is a per-connection closure over
// ~8 mutable state variables and 4 helper functions. Spinning up the full
// WS server + SSH pair just to observe repoll branch behavior is impractical
// (requires 7+ dependency mocks to reach the connectToPane path). Instead,
// extract the core decision logic into a module-scope function with injectable
// deps so vitest can cover the five branch cases without I/O.
//
// Production code calls this via the per-connection discoveryRepollTimer
// .then() body by delegating to it with the closure-bound state refs.
// Tests instantiate a plain state box + helper stubs and call it directly.
//
// This is the same "function seam" pattern as __handleIdentityCountBountiesForTests
// (which also extracted per-connection handler logic so vitest can drive it
// without a real WebSocketServer).

/** Mutable state box shared between the per-connection closure and the test seam. */
export type __RepollStateForTests = {
  changeoverState: "active" | "holding" | "dead";
  currentSessionFile: string | null;
  holdingTicks: number;
  // Follow-up to patch #356: the reason we entered holding. Used by the
  // real transitionFromHoldingToActiveSameFile helper to skip the same-file
  // self-clear when the overlay was armed by a real /id reset (Layer 1)
  // OR by a `.recycle-requested` sentinel probe (Layer 3, 2026-08-18).
  // The reducer __applyRepollResultForTests does NOT read this field —
  // it belongs to the helper's guard, not the reducer's dispatch. Kept on
  // the shared state box so tests that inline the real helper's shape
  // (see case (b) in claude-session-server.repoll.test.ts) can drive it.
  holdingReason: "id_reset" | "discovery_diff" | "sentinel" | null;
};

/** Helpers injected into the repoll tick logic. */
export type __RepollHelpersForTests = {
  // quick 260808-ohn: reason union renamed "exit_marker" → "id_reset" to
  // match the new Layer 1 tail-state detector. Layer 2 (this file) still
  // passes "discovery_diff"; Layer 1 (onLine, via layer1-detect.ts) now
  // passes "id_reset"; Layer 3 (sentinel-detect.ts, 2026-08-18) passes
  // "sentinel". All three reasons flow into the same transitionToHolding
  // signature — no behavior change from Layer 2's perspective.
  transitionToHolding: (reason: "id_reset" | "discovery_diff" | "sentinel") => void;
  transitionToActiveNew: (newSessionFile: string) => void;
  transitionFromHoldingToActiveSameFile: () => void;
  transitionToDead: (reason: string) => void;
};

/**
 * Apply one repoll tick's decision logic for a given discovery result.
 * Mutates `state` in-place (changeoverState, holdingTicks) and calls into
 * helpers (transitionToHolding / transitionToActiveNew / etc.) as needed.
 * Mirrors the .then() callback body in discoveryRepollTimer exactly.
 *
 * Returns immediately if changeoverState is already "dead" (idempotent guard).
 *
 * @param result  - discovery result for this tick
 * @param state   - mutable per-connection state box (mutated in-place)
 * @param helpers - injectable transition helpers (stubs in tests, real fns in prod)
 */
export function __applyRepollResultForTests(
  result: import("./session-file-discovery.js").ClaudeSessionDiscoveryResult,
  state: __RepollStateForTests,
  helpers: __RepollHelpersForTests,
): void {
  if (state.changeoverState === "dead") return;

  const isExecErrorTick =
    result.status === "inactive" && result.reason === "exec_error";

  if (result.status === "active") {
    if (result.sessionFile !== state.currentSessionFile) {
      if (state.changeoverState === "active") {
        helpers.transitionToHolding("discovery_diff");
      }
      helpers.transitionToActiveNew(result.sessionFile);
    } else if (state.changeoverState === "holding") {
      helpers.transitionFromHoldingToActiveSameFile();
    }
  } else if (!isExecErrorTick) {
    if (state.changeoverState === "active") {
      helpers.transitionToHolding("discovery_diff");
    }
  }

  if (state.changeoverState === "holding" && !isExecErrorTick) {
    state.holdingTicks++;
    if (state.holdingTicks >= HOLDING_TIMEOUT_TICKS) {
      helpers.transitionToDead("holding_timeout");
    }
  }
}

// ─── Test seam: attach-path inactive classifier (quick 260813-0qx) ───────────
//
// The initial-attach `if (result.status === "inactive") { ... }` block has to
// decide, between the dormant-identity branch and FALLBACK-01, whether the
// discovery result signals a /id-reset (or fresh-spawn) window on THIS pane
// — in which case we enter holding + start the discovery-repoll timer instead
// of tearing down. Terminal reasons (no_tmux_session, exec_error) fall through
// unchanged to FALLBACK-01; not_claude on a non-identity pane (bare shell)
// also falls through.
//
// This pure classifier is the SINGLE SOURCE OF TRUTH for the "reset_window vs
// fallback_01" decision — the production branch calls it directly (so the
// reducer and the test-observed classifier are the same code), and the tests
// exercise the same function via this seam. That guarantees drift between
// "what tests assert" and "what production does" cannot arise here.
//
// Reset-window reasons (map to "reset_window"):
//   • no_pid_session_file
//   • no_open_session_file
//   • not_claude AND isIdentityShapedCached === true
//
// Terminal reasons (map to "fallback_01"):
//   • no_tmux_session, exec_error
//   • not_claude AND isIdentityShapedCached !== true (bare shell OR probe
//     never ran / threw → conservative fallback)
//   • defensive: status === "active" (attach path only calls this on inactive)
export function __classifyAttachInactiveForTests(
  result: import("./session-file-discovery.js").ClaudeSessionDiscoveryResult,
  isIdentityShapedCached: boolean | null,
): "reset_window" | "fallback_01" {
  if (result.status === "active") return "fallback_01";
  const reason = result.reason;
  if (reason === "no_pid_session_file" || reason === "no_open_session_file") {
    return "reset_window";
  }
  if (reason === "not_claude" && isIdentityShapedCached === true) {
    return "reset_window";
  }
  return "fallback_01";
}

// ─── Test seam: dormant poll tick logic (quick 260808-cd6) ───────────────────
//
// The dormant stat check lives inside the contextPctTimer IIFE alongside a
// closure over 4 mutable state variables. Spinning up the full WS server + SSH
// pair to test it is impractical. Instead we export the core logic as a
// module-scope function with injectable deps (same pattern as
// __applyRepollResultForTests above). Tests instantiate a plain state box +
// mock execCommand + mock ws.send and call __applyDormantPollTickForTests directly.

/** Mutable dormant-state box shared between the per-connection closure and the test seam. */
export type __DormantStateForTests = {
  isIdentityShapedCached: boolean | null;
  identityShapeProbeInFlight: boolean;
  dormantLastEmitted: boolean | null;
  // quick 260809-ha3: optional getter for the wake-trigger timestamp closure.
  // When present and non-null, the dormant:true emit carries this as
  // wakingSince so the client can restore the wake-progress bar after Fix B
  // (visibility false->true) wipes local wakingStartTs. Absent/undefined =>
  // wakingSince: null (natural-dormant path — no user-initiated wake in flight).
  wakeTriggerTs?: () => number | null;
};

/**
 * Apply one dormant-poll tick for the given connection state.
 * Mutates `state` in-place and calls `wsSend` if the dormant state changed.
 * `execCommand` is injectable so tests can control its output.
 *
 * @param deps.connSnapshot  - SSH connection (typed as any in the seam; tests pass a stub)
 * @param deps.escapedName   - tmux session name (already validated to safe subset)
 * @param deps.execCommand   - injectable SSH exec helper
 * @param deps.wsSend        - injectable ws.send stub
 * @param state              - mutable per-connection dormant state box
 */
export async function __applyDormantPollTickForTests(
  deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connSnapshot: any;
    escapedName: string;
    execCommand: (conn: unknown, cmd: string) => Promise<string>;
    wsSend: (data: string) => void;
  },
  state: __DormantStateForTests,
): Promise<void> {
  const { connSnapshot, escapedName, execCommand: exec, wsSend } = deps;
  if (state.isIdentityShapedCached === null && !state.identityShapeProbeInFlight) {
    state.identityShapeProbeInFlight = true;
    try {
      const probeOut = await exec(
        connSnapshot,
        `test -d ~/.claude/identities/'${escapedName}' && echo yes || echo no`,
      );
      state.isIdentityShapedCached = probeOut.trim() === "yes";
    } catch {
      state.isIdentityShapedCached = false;
    } finally {
      state.identityShapeProbeInFlight = false;
    }
  } else if (state.isIdentityShapedCached === true) {
    try {
      const statOut = await exec(
        connSnapshot,
        `stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
      );
      const isDormant = statOut.trim() === "yes";
      if (isDormant !== state.dormantLastEmitted) {
        state.dormantLastEmitted = isDormant;
        // quick 260809-ha3: dormant:true carries wakingSince so client can
        // restore the wake-progress bar after Fix B (visibility false->true)
        // wipes local wakingStartTs. dormant:false is unchanged (client
        // clears waking state on the false-branch already).
        if (isDormant) {
          const wakingSince = state.wakeTriggerTs?.() ?? null;
          wsSend(JSON.stringify({ type: "dormant", dormant: true, wakingSince }));
        } else {
          wsSend(JSON.stringify({ type: "dormant", dormant: false }));
        }
      }
    } catch {
      /* SSH error — skip this tick silently */
    }
  }
  // isIdentityShapedCached === false → skip entirely (never re-probe on this connection)
}

/**
 * Fix #2 (post-Phase-50 code review): shared cleanup helper for the
 * session-recycle path (transitionToActiveNew). Called from the closure
 * transitionToActiveNew AND directly from optimistic-bubbles.integration.test.ts
 * scenario (h) via the __applyTransitionToActiveNewCleanupForTests export.
 *
 * Clears three per-connection state slots that previously survived the
 * recycle and could leak OLD-session behavior into the NEW session:
 *
 *   1. queueEnqueueDedup Map — stale content-hash entries could suppress
 *      fresh-session type:"user" frames on content collision.
 *   2. pv-send-watchdog module `pending` (via clearPvSendWatchdogsForSession)
 *      — a mid-arm watchdog for the OLD sessionId whose full-resend timer
 *      fires post-recycle would retype OLD body into NEW composebox,
 *      violating the shape invariant "retry never submits unintended
 *      message" and leaking OLD-session content into the NEW transcript.
 *   3. pendingMqidsForThisConnection Set — stale mqid bookkeeping so the
 *      ws.on("close") cleanup does not attempt to clear already-cancelled
 *      watchdogs and stays in sync with the pending Map.
 *
 * The cleared-mqid list from clearPvSendWatchdogsForSession is used to
 * scrub matching entries from pendingMqidsForThisConnection.
 */
function applyTransitionToActiveNewCleanup(args: {
  oldSessionId: string;
  queueEnqueueDedup: Map<string, number>;
  pendingMqidsForThisConnection: Set<string>;
}): void {
  const {
    oldSessionId,
    queueEnqueueDedup,
    pendingMqidsForThisConnection,
  } = args;
  // (1) queueEnqueueDedup is per-connection scope (declared in the ws-server
  //     closure at L~2419) — not sessionId-keyed at the top level. A recycle
  //     is a session boundary; every stale hash was scoped to the OLD
  //     session's content flow, so blanket .clear() is correct.
  queueEnqueueDedup.clear();
  // (2) Watchdog module state — clear every pending entry matching the OLD
  //     sessionId. Returns cleared mqids so we can prune the per-connection
  //     Set below.
  const clearedMqids = clearPvSendWatchdogsForSession(oldSessionId);
  // (3) Remove cleared mqids from pendingMqidsForThisConnection so
  //     ws.on("close") does not attempt double-clears on already-cancelled
  //     watchdogs (harmless but noise). Any mqids for OTHER sessions on
  //     this connection stay — a WS connection could in principle hold
  //     watchdogs for different session UUIDs during a rapid recycle,
  //     though the common case is a 1:1 connection:session mapping.
  for (const mqid of clearedMqids) {
    pendingMqidsForThisConnection.delete(mqid);
  }
}

/**
 * Test-only re-export of the applyTransitionToActiveNewCleanup helper.
 * Consumed by optimistic-bubbles.integration.test.ts scenario (h) so
 * the recycle cleanup contract is exercised without needing to spin up
 * a full WS server + SSH connection + tail restart.
 */
export const __applyTransitionToActiveNewCleanupForTests =
  applyTransitionToActiveNewCleanup;

/**
 * Apply the input message handler logic for tests.
 * Phase 35 — pretty-view compose-send migrated onto claude-session WS.
 * Mirrors __applyWakeMessageForTests shape (Tests D/E/F from dormant-poll.test.ts).
 *
 * Handles both the split-send case (mqid non-empty + data ends in \r →
 * body write, 250ms delay, Enter write) and the non-split case (one send-keys call).
 *
 * @param deps.sshConn              - SSH connection (null if not connected)
 * @param deps.currentTmuxSession   - current pane tmux session name (null if none)
 * @param deps.currentHostId        - connection-scoped host ID (for logging)
 * @param deps.execCommand          - injectable SSH exec helper
 * @param deps.data                 - the input data string (may contain trailing \r for split-send)
 * @param deps.messageQueueItemId   - optional mqid; non-empty triggers split-send gate
 */
export async function __applyInputMessageForTests(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any | null;
  currentTmuxSession: string | null;
  currentHostId: number | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
  data: string;
  messageQueueItemId?: string;
  // Phase 50 Plan 02 Task 2 — optional wire-up for the signal-driven send
  // watchdog. All four are optional to preserve backward compat with the
  // pre-Phase-50 test call sites (they omit these and get the log-and-swallow-
  // only path unchanged).
  sessionId?: string;
  wsSend?: (frame: object) => void;
  armWatchdog?: typeof armPvSendWatchdog;
  trackMqid?: (mqid: string) => void;
}): Promise<void> {
  const { sshConn, currentTmuxSession, currentHostId, execCommand: exec } = deps;
  if (!sshConn || !currentTmuxSession) return;
  const data = String(deps.data ?? "");
  if (data.length === 0) return;
  // Cap payload size before handing to tmux send-keys (mirrors MAX_RAW_KEYSTROKES_BYTES
  // at :4025 — same ARG_MAX rationale; 16KB is comfortably above any realistic composebox
  // input. Per D-PVWS-04).
  const MAX_INPUT_BYTES = 16 * 1024;
  if (data.length > MAX_INPUT_BYTES) {
    sshLogger.warn("input rejected: payload too large", {
      operation: "input_reject_size",
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      dataLength: data.length,
      maxBytes: MAX_INPUT_BYTES,
    });
    return;
  }
  const mqid = String(deps.messageQueueItemId ?? "");
  // Split-send gate (mirrors terminal.ts:499 split-send semantics):
  // mqid non-empty + data ends in \r → pretty-view compose-send shape (patch #110).
  // Body write first, then 250ms (matches terminal.ts:842 — patch #111 raised from 50ms
  // after Ashley UAT confirmed 50ms caused paste-detection-still-active symptom), then Enter.
  const isSplitSend = mqid.length > 0 && data.endsWith("\r");
  // Phase 50 Plan 02 Task 2 — track which exec call threw so the send_keys_error
  // frame (D-21) can carry a precise reason. Body throw short-circuits Enter.
  let bodyExecFailed = false;
  let enterExecFailed = false;
  const body = isSplitSend ? data.slice(0, -1) : "";
  try {
    if (isSplitSend) {
      if (body.length > 0) {
        try {
          await exec(
            sshConn,
            `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(body)}`,
          );
        } catch (bodyErr) {
          bodyExecFailed = true;
          throw bodyErr;
        }
      }
      // 250ms — matches terminal.ts:842 (patch #111). Do NOT change to 50ms.
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        await exec(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} Enter`);
      } catch (enterErr) {
        enterExecFailed = true;
        throw enterErr;
      }
    } else {
      await exec(
        sshConn,
        `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(data)}`,
      );
    }

    // Phase 50 Plan 02 Task 2 — arm the signal-driven watchdog on successful
    // split-send. contentHash derivation MUST match the arm-time key derivation
    // in the onLine notifyMatched call site AND Plan 50-01 Task 2's dedup Map
    // key (sha256(content).slice(0,32) — content-only). If any of the three
    // drift, watchdogs never notify and every real send escalates unnecessarily.
    // See 50-01-PLAN.md § objective "Hash-derivation contract".
    //
    // Fix #1 (post-Phase-50 code review): bare-Enter split-sends (data="\r"
    // with an mqid — the second half of MessageQueueDrawer's split-write
    // shape) have body="" after slicing the trailing \r. Arming a watchdog
    // against sha256("").slice(0,32) is a dead arm: the parser never emits
    // an empty-content message frame, so notifyMatched never fires → the
    // full 2.5s→5.5s→20s escalation runs on every queue-drawer send. The
    // body write already happened in the prior WS input event (queue-drawer
    // step (a) — body without \r without mqid). Gate the arm on
    // body.length > 0 so the bare Enter alone stays silent.
    if (
      isSplitSend &&
      body.length > 0 &&
      mqid.length > 0 &&
      deps.sessionId &&
      deps.wsSend &&
      deps.armWatchdog
    ) {
      const contentHash = createHash("sha256")
        .update(body)
        .digest("hex")
        .slice(0, 32);
      deps.armWatchdog({
        sessionId: deps.sessionId,
        mqid,
        body,
        contentHash,
        // Bind sshConn into the exec signature the watchdog expects.
        execCommand: (cmd: string) => exec(sshConn, cmd),
        tmuxTarget: currentTmuxSession,
        wsSend: deps.wsSend,
        logger: sshLogger,
      });
      deps.trackMqid?.(mqid);
    }
  } catch (err) {
    // Phase 50 Plan 02 D-21 — surface execCommand throws as a new
    // send_keys_error WS frame instead of the pre-Phase-50 log-and-swallow.
    // The log stays (extended, not removed) for backend audit continuity.
    sshLogger.warn("input send failed", {
      operation: "input_send_error",
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      dataLength: data.length,
      error: err instanceof Error ? err.message : String(err),
    });
    if (deps.wsSend) {
      const reason = isSplitSend
        ? bodyExecFailed
          ? "exec_throw_body"
          : enterExecFailed
            ? "exec_throw_enter"
            : "exec_throw"
        : "exec_throw";
      try {
        deps.wsSend({
          type: "send_keys_error",
          mqid: mqid.length > 0 ? mqid : null,
          reason,
          message: err instanceof Error ? err.message : String(err),
        });
      } catch (wsErr) {
        sshLogger.warn("send_keys_error frame emit failed", {
          operation: "input_send_error_ws_emit_failed",
          error: wsErr instanceof Error ? wsErr.message : String(wsErr),
        });
      }
    }
  }
}

// ─── Phase 50 Plan 01 Task 2 — per-session queue-enqueue dedup ────────────────
//
// A queued user message appears in the JSONL TWICE: first as a
// `type:"queue-operation", operation:"enqueue"` entry at enqueue time
// (~T+0, ~111ms post-send), and again as a regular `type:"user"` turn at
// dequeue time (up to ~2 MINUTES later per 50-CONTEXT.md § Empirical
// evidence). Task 1's parser change means the first entry now emits as
// kind:"message"; without dedup, the second would also emit and the
// bubble would render twice.
//
// Dedup strategy (D-11 revised, see 50-01-PLAN.md § objective
// "Hash-derivation contract"):
//   • Key = contentHash = sha256(content).slice(0, 32) — content-only,
//     NO sessionId, NO timestamp. Content-only because the enqueue and
//     dequeue timestamps differ by minutes; any timestamp-inclusive key
//     would fail to match across the enqueue → dequeue span. Per-session
//     scope comes from the Map living on the per-connection tail-watcher
//     closure — NOT from the key.
//   • Value = wall-clock ms epoch of insertion; used for lazy TTL
//     eviction (10 minutes per D-11 Discretion) and for the "unexpired"
//     lookup check.
//   • Capacity capped at 100 entries; on insert, oldest-first eviction
//     (Map preserves insertion order in JS).
//   • Single-shot: a successful suppress DELETES the matched entry so
//     it can't accidentally suppress a genuine third occurrence of the
//     same body later.
//   • Task-notification enqueues skip upstream at the parser (Task 1
//     guard) and thus never reach this seam; even if they did, the
//     rawObj.type === "queue-operation" gate here plus a defense-in-depth
//     check on the parsed content would prevent them from populating the
//     Map. Patch #66's separate task-notification handler in onLine
//     stays entirely intact.
//
// The seam is a pure function so tests can drive it without spinning up
// the tail watcher or a WS server. Production onLine calls it BEFORE
// `ws.send(JSON.stringify(frame))` for kind:"message" frames on user
// role; when `suppress: true` the frame is dropped silently.
// ─────────────────────────────────────────────────────────────────────────────

/** TTL for a dedup Map entry — 10 minutes, per D-11 Discretion. */
export const __QUEUE_DEDUP_TTL_MS = 10 * 60 * 1000;
/** Cap on Map size — bounds memory at ~100 * (~48B key + 8B value) ≈ 5.6KB/session. */
export const __QUEUE_DEDUP_CAP = 100;

/** Task-notification / system-reminder wrapper guards (mirrors parser Task 1). */
function isWrapperContent(content: string): boolean {
  return (
    content.startsWith("<task-notification>") ||
    content.startsWith("<system-reminder>")
  );
}

/**
 * Prune dedup Map entries older than the TTL. Walks from Map-insertion
 * head; stops at the first non-expired entry because insertion order is
 * monotonic (values are wall-clock ms epochs at insertion time and now
 * is monotonic-ish for our purposes — the tail-watcher lifetime is at
 * most a WS-connection lifetime, hours not months).
 */
function pruneExpiredQueueDedupEntries(
  dedupMap: Map<string, number>,
  now: number,
): void {
  for (const [key, insertedAt] of dedupMap) {
    if (now - insertedAt > __QUEUE_DEDUP_TTL_MS) {
      dedupMap.delete(key);
    } else {
      // Insertion order is monotonic — first non-expired means the rest
      // are also non-expired. Break to avoid scanning the full 100-entry Map.
      break;
    }
  }
}

/**
 * Enforce the capacity cap on the dedup Map. Called AFTER prune (so we
 * only evict live entries when we're genuinely at capacity, not just
 * because we haven't pruned in a while). Oldest-first eviction — Map
 * preserves insertion order in JS, so `.keys().next().value` is the
 * oldest.
 */
function enforceQueueDedupCap(dedupMap: Map<string, number>): void {
  while (dedupMap.size >= __QUEUE_DEDUP_CAP) {
    const oldest = dedupMap.keys().next();
    if (oldest.done) break;
    dedupMap.delete(oldest.value);
  }
}

/**
 * Apply the queue-enqueue dedup logic for a single parsed frame.
 *
 * Test seam mirroring the __applyInputMessageForTests convention. Called
 * from the production tail-watcher onLine right before ws.send for
 * kind:"message" frames.
 *
 * @param deps.parsedFrame - the ParsedLine returned by parseSessionLine
 * @param deps.rawObj      - the JSON.parse'd raw JSONL object (must expose
 *                           `.type` and `.operation`; other fields ignored)
 * @param deps.dedupMap    - per-session Map<contentHash, insertedAt-ms>
 * @param deps.now         - injectable wall-clock epoch (Date.now() in prod)
 *
 * @returns `{ suppress, dedupMap }`. `suppress:true` means the caller
 *          MUST NOT emit the WS frame (the frame was already emitted
 *          from an earlier enqueue entry). `dedupMap` is the same Map
 *          reference passed in — returned for test ergonomics.
 */
export function __applyQueueDedupForTests(deps: {
  parsedFrame: import("./session-file-parser.js").ParsedLine;
  rawObj: Record<string, unknown>;
  dedupMap: Map<string, number>;
  now: number;
}): { suppress: boolean; dedupMap: Map<string, number> } {
  const { parsedFrame, rawObj, dedupMap, now } = deps;

  // Only user-role message frames participate. Assistant turns, images,
  // relay frames, skips, malformed lines all pass through unchanged.
  if (parsedFrame.kind !== "message") return { suppress: false, dedupMap };
  if (parsedFrame.role !== "user") return { suppress: false, dedupMap };
  if (typeof parsedFrame.content !== "string" || parsedFrame.content.length === 0) {
    return { suppress: false, dedupMap };
  }

  // Defensive: task-notification / system-reminder content should have
  // been skipped upstream at the parser; if it somehow reaches here (e.g.
  // a future parser change), still don't touch the Map.
  if (isWrapperContent(parsedFrame.content)) {
    return { suppress: false, dedupMap };
  }

  // contentHash = sha256(content).slice(0, 32) — content-only, matches
  // the derivation Plan 50-02's watchdog uses for arm-time + notifyMatched
  // keys (see 50-01-PLAN.md § objective "Hash-derivation contract").
  const contentHash = createHash("sha256")
    .update(parsedFrame.content)
    .digest("hex")
    .slice(0, 32);

  const rawType = rawObj.type;
  const rawOperation = rawObj.operation;

  if (rawType === "queue-operation" && rawOperation === "enqueue") {
    // Populate branch: parser confirmed this is a normal-content enqueue
    // and the frame is emitting. Insert into dedup Map so a later
    // dequeue-time user turn with matching content can be suppressed.
    // Lazy TTL prune + cap enforcement before insert.
    pruneExpiredQueueDedupEntries(dedupMap, now);
    enforceQueueDedupCap(dedupMap);
    dedupMap.set(contentHash, now);
    return { suppress: false, dedupMap };
  }

  if (rawType === "user") {
    // Lookup branch: matching enqueue entry within TTL suppresses the
    // frame (dequeue-time double-write). Single-shot — matched entry
    // is consumed so a later genuine third occurrence still emits.
    const insertedAt = dedupMap.get(contentHash);
    if (insertedAt !== undefined) {
      if (now - insertedAt <= __QUEUE_DEDUP_TTL_MS) {
        dedupMap.delete(contentHash);
        return { suppress: true, dedupMap };
      }
      // Expired entry — clean up and continue to emit.
      dedupMap.delete(contentHash);
    }
    return { suppress: false, dedupMap };
  }

  // Any other rawType (attachment/queued_command, relay_inbound wrappers
  // that surfaced as user turns via a different path, etc.) is out of
  // scope for this dedup path.
  return { suppress: false, dedupMap };
}

/**
 * Apply the interrupt message handler logic for tests.
 * Phase 35 — pretty-view compose-send migrated onto claude-session WS.
 * Mirrors __applyWakeMessageForTests shape (Tests D/E/F from dormant-poll.test.ts).
 *
 * Fires a single `tmux send-keys -t <session> C-c` to send Ctrl-C into the pane.
 * Original safety-valve Ctrl-C was patch #120 on the terminal WS (Terminal.tsx:3300-3311).
 *
 * @param deps.sshConn              - SSH connection (null if not connected)
 * @param deps.currentTmuxSession   - current pane tmux session name (null if none)
 * @param deps.currentHostId        - connection-scoped host ID (for logging)
 * @param deps.execCommand          - injectable SSH exec helper
 */
export async function __applyInterruptMessageForTests(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any | null;
  currentTmuxSession: string | null;
  currentHostId: number | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
}): Promise<void> {
  const { sshConn, currentTmuxSession, currentHostId, execCommand: exec } = deps;
  if (!sshConn || !currentTmuxSession) return;
  try {
    // C-c is a tmux key name for Ctrl-C — no -l flag (it's a key name, not literal bytes),
    // no shellQuote around C-c (it's a fixed constant from our code, not user input).
    await exec(sshConn, `tmux send-keys -t ${shellQuote(currentTmuxSession)} C-c`);
  } catch (err) {
    sshLogger.warn("interrupt send failed", {
      operation: "interrupt_send_error",
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Apply the wake message handler logic for tests.
 * Tests D/E/F from dormant-poll.test.ts use this seam.
 *
 * @param deps.sshConn              - SSH connection (null if not connected)
 * @param deps.currentTmuxSession   - current pane tmux session name (null if none)
 * @param deps.isIdentityShapedCached - identity shape probe cache
 * @param deps.execCommand          - injectable SSH exec helper
 * @param deps.wsSend               - injectable ws.send stub
 */
export async function __applyWakeMessageForTests(deps: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any | null;
  currentTmuxSession: string | null;
  isIdentityShapedCached: boolean | null;
  execCommand: (conn: unknown, cmd: string) => Promise<string>;
  wsSend: (data: string) => void;
}): Promise<void> {
  const { sshConn, currentTmuxSession, isIdentityShapedCached, execCommand: exec, wsSend } = deps;
  if (!sshConn || currentTmuxSession === null || isIdentityShapedCached !== true) {
    wsSend(JSON.stringify({ type: "wake_result", ok: false, error: "not connected to an identity pane" }));
    return;
  }
  const wakeEscapedName = currentTmuxSession;
  try {
    await exec(sshConn, `rm -f ~/.claude/identities/'${wakeEscapedName}'/.dormant`);
    wsSend(JSON.stringify({ type: "wake_result", ok: true }));
  } catch (err) {
    wsSend(JSON.stringify({ type: "wake_result", ok: false, error: err instanceof Error ? err.message : String(err) }));
  }
}

// ─── Test seam: dormant-poll-with-rediscovery logic (quick 260808-dmz) ────────
//
// The dormant-poll IIFE in the inactive branch polls the sentinel and, on
// disappearance, calls discoverClaudeSession + startActiveSessionFlow. Exported
// as a test seam so tests G-K can exercise sentinel-disappearance + re-discovery
// without spinning up the full WS server + SSH pair.
//
// Uses a two-arg "state accessor" pattern rather than a mutable box because the
// production code stores dormantLastEmitted in the connection closure (not in a
// box struct). The accessor pair {dormantLastEmitted, setDormantLastEmitted} lets
// tests inject a plain variable capture and assert on it.

/** Result type returned by discoverClaudeSession (subset used by the seam). */
export type __DiscoveryResultForTests =
  | { status: "active"; pid: number; sessionFile: string }
  | { status: "inactive"; reason: string };

/**
 * Apply one dormant-poll tick with sentinel check + optional re-discovery.
 * Called by the 3s setInterval in the inactive→dormant branch.
 *
 * quick 260808-fgf: extended with markerCommand (stat .resume-complete),
 * state.wakeTriggerTs (getter for the wake-handler-set timestamp), and
 * deps.now (injectable clock for deterministic tests). When wakeTriggerTs
 * is non-null, dismiss requires EITHER a fresh marker (marker_ts > triggerTs)
 * OR the 90s MARKER_FALLBACK_MS window to have elapsed.
 *
 * @param deps.connSnapshot        - SSH connection (stub in tests)
 * @param deps.escapedName         - tmux session name (already validated)
 * @param deps.execCommand         - injectable SSH exec helper
 * @param deps.discoverSession     - injectable discoverClaudeSession callback
 * @param deps.wsSend              - injectable ws.send stub
 * @param deps.startActiveFlow     - injectable callback to transition to active flow
 * @param deps.markerCommand       - injectable: cat .resume-complete; returns trimmed body or null
 * @param deps.now                 - injectable clock; defaults to Date.now
 * @param state.dormantLastEmitted - getter for current dormantLastEmitted closure value
 * @param state.setDormantLastEmitted - setter for dormantLastEmitted
 * @param state.wakeTriggerTs      - getter for wake_trigger_ts closure value (null = natural resume)
 */
export async function __applyDormantPollWithRediscoveryForTests(
  deps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connSnapshot: any;
    escapedName: string;
    execCommand: (conn: unknown, cmd: string) => Promise<string>;
    discoverSession: (conn: unknown, session: string) => Promise<__DiscoveryResultForTests>;
    wsSend: (data: string) => void;
    startActiveFlow: (pid: number, sessionFile: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    markerCommand: (conn: any, name: string) => Promise<string | null>;
    now: () => number;
    // Optional dormant-branch context-pct emit. When both the getter returns a
    // resolved session file path AND readJsonlPct returns a non-null pct, emits
    // {type:"context_pct", pct, dormant:true} on the same "sentinel present"
    // tick. Absence of either (no session file resolved yet, or JSONL read
    // returned null) is a silent skip — the meter stays on whatever value the
    // frontend last held. The `dormant:true` flag stops the frontend's live-
    // frame auto-dismiss from wiping the DormancyOverlay (PrettyView.tsx L1149).
    readJsonlPct?: (conn: unknown, sessionFile: string) => Promise<number | null>;
    dormantSessionFile?: () => string | null;
  },
  state: {
    dormantLastEmitted: () => boolean | null;
    setDormantLastEmitted: (v: boolean | null) => void;
    wakeTriggerTs: () => number | null;
  },
): Promise<void> {
  const { connSnapshot, escapedName, execCommand: exec, discoverSession, wsSend, startActiveFlow, markerCommand, now, readJsonlPct, dormantSessionFile } = deps;
  try {
    // Poll the .dormant sentinel (reuse exact command from seam line 956-961)
    const statOut = await exec(
      connSnapshot,
      `stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
    );
    const isDormant = statOut.trim() === "yes";
    if (isDormant) {
      // Sentinel still present — emit only on change (state-change guard)
      if (state.dormantLastEmitted() !== true) {
        state.setDormantLastEmitted(true);
        // quick 260809-ha3: dormant:true carries wakingSince (server-authoritative
        // wake-trigger timestamp) so the client can restore the wake-progress
        // bar after Fix B (visibility false->true edge) wipes local wakingStartTs.
        // Natural-resume path (wakeTriggerTs null) sends wakingSince:null.
        wsSend(JSON.stringify({ type: "dormant", dormant: true, wakingSince: state.wakeTriggerTs() }));
      }
      // Dormant-branch context-pct: read the last assistant turn's `usage`
      // block from the identity's cached JSONL and emit. The JSONL is
      // authoritative for token-usage (readContextPctFromJsonl docblock) so
      // this stays correct even though claude is not running. Silent-skip
      // when either injectable is absent (getter returns null before the
      // tail-open discovery completes, or a test omits readJsonlPct).
      if (readJsonlPct && dormantSessionFile) {
        const sessionFile = dormantSessionFile();
        if (sessionFile !== null) {
          try {
            const pct = await readJsonlPct(connSnapshot, sessionFile);
            if (pct !== null) {
              wsSend(JSON.stringify({ type: "context_pct", pct, dormant: true }));
            }
          } catch {
            // Silent — nice-to-have, not load-bearing. Mirrors the outer
            // catch's posture (skip this tick, keep polling).
          }
        }
      }
      return; // keep polling
    }
    // Sentinel disappeared. Apply Nelly's freshness contract when this was a
    // user-initiated wake (wakeTriggerTs non-null). Natural resumes (wakeTriggerTs
    // null) skip the check entirely — preserves Test H / prior behavior.
    const triggerTs = state.wakeTriggerTs();
    if (triggerTs !== null) {
      // User-initiated wake path: require fresh marker OR 90s fallback.
      const markerBody = await markerCommand(connSnapshot, escapedName);
      let markerFresh = false;
      let fellBack = false;
      if (markerBody !== null) {
        const markerTs = Date.parse(markerBody.trim());
        if (Number.isFinite(markerTs) && markerTs > triggerTs) {
          markerFresh = true;
        }
      }
      if (!markerFresh) {
        const elapsed = now() - triggerTs;
        if (elapsed >= MARKER_FALLBACK_MS) {
          markerFresh = true;
          fellBack = true;
        }
      }
      if (!markerFresh) {
        // Neither fresh marker nor fallback window elapsed — keep polling.
        return;
      }
      if (fellBack) {
        sshLogger.info("Dormancy marker fallback — supervisor pre-dates .resume-complete contract", {
          operation: "dormancy_marker_fallback",
          escapedName,
        });
      }
    }
    // Sentinel disappeared (and freshness check passed if applicable).
    // Emit dormant:false (state-change guard).
    if (state.dormantLastEmitted() !== false) {
      state.setDormantLastEmitted(false);
      wsSend(JSON.stringify({ type: "dormant", dormant: false }));
    }
    // Re-run discovery to see if claude has come back
    const rediscovery = await discoverSession(connSnapshot, escapedName);
    if (rediscovery.status === "active") {
      // Transition to normal active session flow
      startActiveFlow(rediscovery.pid, rediscovery.sessionFile);
      return;
    }
    // Still inactive (supervisor may not have reconciled yet) — keep polling.
    // dormantLastEmitted stays false so if the sentinel comes back, we re-emit
    // dormant:true on the next tick. No teardown; no clearing of dormant-poll timer.
  } catch {
    // SSH error — skip this tick silently (same posture as __applyDormantPollTickForTests)
  }
}

// ─── Test seam: dormant-branch tail-open (Phase 32 Wave 2 / 32-02) ────────────
//
// Phase 32 wires the Wave 1 `discoverIdentitySessionFile` helper into the
// dormant branch of the message handler so the wake-bubble message list is
// backed by the identity's most-recently active JSONL, streamed through the
// SAME onLine/onError closures the active flow uses (D-08 latency parity).
// That branch lives INSIDE a deeply-nested closure chain (`ws.on
// ("connection")` → per-conn state setup → message handler → `if (result
// .status === "inactive")` → dormancy probe) with every state variable it
// touches being closure-scoped — so it is NOT reachable via any pre-existing
// test seam.
//
// This seam encapsulates the helper-call + tail-open + structured-log logic
// as a pure, dependency-injected function so CASE-DT1..DT3 + DT6 are
// directly assertable without a live WebSocketServer or SSH conn. It is the
// SINGLE production implementation entry point — the dormant branch calls
// this seam and does no discovery work itself (matches D-09's "one call
// site" invariant for `discoverIdentitySessionFile`).
//
// Follows the same injectable-helpers shape as __applyDormantPollTickForTests
// (L984-1033) and __applyDormantPollWithRediscoveryForTests (L1106-1198):
// `deps` object holds all module-side collaborators + fixed inputs; `state`
// object holds mutable outputs (here just `setTailHandle`).

/** Dependencies for the dormant-branch tail-open seam. */
export type __DormantBranchTailOpenDepsForTests = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any; // SSH conn used by discoverIdentitySessionFile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sshConn: any; // SSH conn used by tailSessionFile
  tmuxSession: string;
  discoverIdentitySessionFile: (
    conn: unknown,
    identityName: string,
  ) => Promise<string | null>;
  tailSessionFile: (
    conn: unknown,
    file: string,
    onLine: (line: string) => void,
    onError: (err: Error) => void,
  ) => { stop: () => void };
  onLine: (line: string) => void;
  onError: (err: Error) => void;
  wsSend: (data: string) => void; // parity with other seams — may be unused
  logger: {
    info: (msg: string, meta: Record<string, unknown>) => void;
  }; // sshLogger stub
};

/** Mutable state for the dormant-branch tail-open seam. */
export type __DormantBranchTailOpenStateForTests = {
  setTailHandle: (h: { stop: () => void } | null) => void;
  // Called with the discovered JSONL path (or null on no-match / throw) so the
  // connection closure can cache it for the dormant-poll timer's JSONL-read
  // context-pct emit. Called BEFORE setTailHandle when discovery succeeds; on
  // null-return / helper-throw it is called with null.
  setDormantSessionFile?: (f: string | null) => void;
};

/**
 * Apply the dormant-branch tail-open sequence for tests (and, in
 * production, called by the dormant branch itself — the seam IS the
 * production implementation, not test-only scaffolding).
 *
 * Called ONCE per dormant-branch entry, immediately after the dormant
 * frame + dormantPollTimer start, before `enteredDormantPoll = true`.
 *
 * Behavior:
 *   - Calls `deps.discoverIdentitySessionFile(deps.conn, deps.tmuxSession)`.
 *   - On non-null return: emits `deps.logger.info("Dormant tail
 *     discovered", ...)` with `discoveredFileBasename:
 *     path.basename(discoveredFile)` (T-32-05 mitigation — the JSONL's
 *     session UUID is already discoverable via existing session-scoped
 *     logs; the encoded project-dir path segment is dropped from log
 *     output). Then calls `deps.tailSessionFile(deps.sshConn,
 *     discoveredFile, deps.onLine, deps.onError)` and passes the handle
 *     to `state.setTailHandle`.
 *   - On null return: emits `deps.logger.info("Dormant tail not
 *     discovered — no matching identity session file", ...)` with
 *     `operation: "claude_session_dormant_tail_no_match"`. Does NOT call
 *     `setTailHandle`. No path payload — nothing to disclose (T-32-02).
 *   - On `discoverIdentitySessionFile` (or `tailSessionFile`) throw:
 *     emits the same no-match log shape (fail-safe fallback, mirrors
 *     the Wave 1 caller contract). Does NOT call `setTailHandle`; does
 *     NOT re-throw.
 *
 * D-05: null / throw path is byte-identical to today's dormant behavior
 *   (dormant frame sent, no tail opened, no messages).
 * D-08: `onLine` and `onError` are passed through UNWRAPPED — the seam
 *   does not create a new lambda. The dormant tail's line-emission path
 *   IS the active-flow line-emission path (same `appendDedup` + `eventId`
 *   pipeline).
 * D-09: helper is called from EXACTLY ONE production site (the dormant
 *   branch's call to this seam). Active-flow discovery at L~4634
 *   stays on `discoverClaudeSession`.
 */
export async function __applyDormantBranchTailOpenForTests(
  deps: __DormantBranchTailOpenDepsForTests,
  state: __DormantBranchTailOpenStateForTests,
): Promise<void> {
  const {
    conn,
    sshConn,
    tmuxSession,
    discoverIdentitySessionFile: discover,
    tailSessionFile: tail,
    onLine,
    onError,
    logger,
  } = deps;
  try {
    const discoveredFile = await discover(conn, tmuxSession);
    if (discoveredFile !== null) {
      logger.info("Dormant tail discovered", {
        operation: "claude_session_dormant_tail_discovered",
        discoveredFileBasename: basename(discoveredFile),
      });
      // Cache the resolved path for the dormant-poll timer's JSONL-read
      // context-pct emit (piggybacked on the sentinel poll).
      state.setDormantSessionFile?.(discoveredFile);
      // SAME onLine/onError refs — no wrapping (D-08).
      const handle = tail(sshConn, discoveredFile, onLine, onError);
      state.setTailHandle(handle);
    } else {
      state.setDormantSessionFile?.(null);
      logger.info(
        "Dormant tail not discovered — no matching identity session file",
        {
          operation: "claude_session_dormant_tail_no_match",
        },
      );
    }
  } catch (err) {
    // Defense-in-depth: the Wave 1 helper contract is no-throw (SSH
    // errors return null); tailSessionFile funnels errors through
    // onError. If anything here does throw, degrade gracefully to
    // today's dormant behavior (no tail opened) and log via the
    // no-match op code so post-deploy dashboards see it as fallback
    // traffic. NEVER rethrow.
    logger.info(
      "Dormant tail not discovered — no matching identity session file",
      {
        operation: "claude_session_dormant_tail_no_match",
        err: err instanceof Error ? err.message : String(err),
      },
    );
    state.setDormantSessionFile?.(null);
  }
}

/**
 * Phase 41 Plan 04 + code-review M1: shared upload dispatch used by both
 * the production `ws.on("message")` handler below AND the
 * `__dispatchUploadMessageForTests` seam. Extracting the branch logic into
 * one function eliminates the drift risk of a hand-copied test-only
 * dispatch body — anything added to the real path (new field, changed
 * cleanup ordering, new branch) is exercised by the test seam
 * automatically. Logging + return semantics stay in the outer caller so
 * production can emit its `claude_session_upload_*` logs at the point
 * where it has full context (sshLogger, sessionId), and tests can skip
 * the log path without needing a logger stub.
 *
 * Returns void; branch selection matches production. On upload_chunk with
 * a pending parent start, awaits the parent (Quick-fix 260801-29v race
 * guard) before dispatching the chunk.
 */
async function dispatchUploadMessage(
  msg: { type?: unknown } & Record<string, unknown>,
  uploadDeps: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sshConn: any | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws: any;
    userId: string | undefined;
    currentSessionId: string | null;
  },
  ownedUploadBatches: Set<string>,
  pendingStarts: Map<string, Promise<void>>,
): Promise<void> {
  if (msg.type === "upload_start") {
    const uploadStart = msg as unknown as UploadStartPayload;
    const startMqid = uploadStart.messageQueueItemId;
    if (typeof startMqid === "string" && startMqid.length > 0) {
      ownedUploadBatches.add(startMqid);
    }
    const startPromise = handleUploadStart(uploadDeps, uploadStart);
    if (typeof startMqid === "string" && startMqid.length > 0) {
      pendingStarts.set(startMqid, startPromise);
      startPromise.finally(() => {
        pendingStarts.delete(startMqid);
      });
    }
    return;
  }
  if (msg.type === "upload_chunk") {
    const uploadChunk = msg as unknown as UploadChunkPayload;
    const chunkMqid = uploadChunk.messageQueueItemId;
    const pending =
      typeof chunkMqid === "string" && chunkMqid.length > 0
        ? pendingStarts.get(chunkMqid)
        : undefined;
    if (pending) {
      await pending
        .then(() => handleUploadChunk(uploadDeps, uploadChunk))
        .catch(() => {
          // A rejected start already emitted its own upload_failed event
          // inside handleUploadStart; if handleUploadChunk then finds no
          // batch it will emit unknown_temp_id, which is the CORRECT
          // signal for a truly-failed start (vs. the race we are fixing
          // here). Swallow to avoid an unhandled rejection.
        });
    } else {
      handleUploadChunk(uploadDeps, uploadChunk);
    }
    return;
  }
  if (msg.type === "upload_abort") {
    const uploadAbort = msg as unknown as UploadAbortPayload;
    handleUploadAbort(uploadDeps, uploadAbort);
    if (
      !uploadAbort.tempId &&
      typeof uploadAbort.messageQueueItemId === "string"
    ) {
      ownedUploadBatches.delete(uploadAbort.messageQueueItemId);
    }
    return;
  }
}

/**
 * Phase 41 Plan 04: testability seam for the upload_start / upload_chunk /
 * upload_abort dispatch logic. Post code-review M1, this is a thin
 * re-export of `dispatchUploadMessage` so tests exercise the same code
 * path production runs — no drift possible.
 *
 * Pattern mirrors `__applyInputMessageForTests` / `__applyWakeMessageForTests`
 * above — zero new npm dependencies; test-only callpath.
 */
export const __dispatchUploadMessageForTests = dispatchUploadMessage;

const wss = new WebSocketServer({ port: 30011 });

wss.on("connection", async (ws: WebSocket, req) => {
  let userId: string | undefined;
  let sessionId: string | undefined;

  try {
    let token: string | undefined;

    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length);
      }
    }

    if (!token) {
      const urlObj = new URL(req.url || "", "http://localhost");
      const qp = urlObj.searchParams.get("token");
      if (qp) token = qp;
    }

    if (!token) {
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload?.userId || payload.pendingTOTP) {
      ws.close(1008, "Authentication required");
      return;
    }

    userId = payload.userId;
    sessionId = payload.sessionId;
  } catch (error) {
    sshLogger.error(
      "Claude session WS JWT verification failed",
      error,
      {
        operation: "claude_session_ws_error",
        ip: req.socket.remoteAddress,
      },
    );
    ws.close(1008, "Authentication required");
    return;
  }

  const dataKey = userCrypto.getUserDataKey(userId);
  if (!dataKey) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Data locked - re-authenticate with password",
        code: "DATA_LOCKED",
      }),
    );
    ws.close(1008, "Data access required");
    return;
  }

  databaseLogger.info(`[ws-server] accept userId=${userId ?? 'null'} wsUrl=${req.url ?? ''}`, { operation: "ws_accept" });
  sshLogger.info("Claude session WebSocket connection established", {
    operation: "claude_session_ws_connect",
    userId,
    sessionId,
  });

  // Phase 14 Wave 2: initialize this WS's overlap-ignore state in the
  // module-scope asideState Map (per CONTEXT.md § Backend per-connection
  // state lock 2026-07-26). Cleaned up in ws.on("close") below.
  asideState.set(ws, { armed: false, displayed: false });

  let sshConn: SSHClientType | null = null;
  let tailHandle: TailHandle | null = null;
  // Phase 47 Plan 03 Hunk A: 1-indexed line-number counter for the
  // streaming-tail's per-line dispatch. tail -F -n +1 starts at line 1 of
  // the current file; each onLine invocation is the NEXT line, so we
  // pre-increment (0 → 1 on first invocation) and pass to
  // reshapeParsedLineToWireFrame(parsed, rawLine, lineNum). Reset to 0 in
  // transitionToActiveNew below when the tail restarts against a new file
  // (fresh -n +1 replay converges on lineNum=1 again).
  let lineNum = 0;
  let contextPctTimer: NodeJS.Timeout | null = null;
  let contextPctInFlight = false;
  // Phase 41 Plan 04: pretty-view upload handler state, ported from
  // src/backend/ssh/terminal.ts L228-246 verbatim. Owner-set of batch mqids
  // this WS started (drained on ws.close + teardownPane); pendingStarts is
  // the Quick-fix 260801-29v race guard preventing "no active batch" errors
  // when upload_chunk arrives on the same tick as its parent upload_start.
  const ownedUploadBatches = new Set<string>();
  const pendingStarts = new Map<string, Promise<void>>();
  // quick 260808-cd6 — dormancy overlay + wake button.
  // Per-connection (closure-scoped) dormancy guards. Mirror the
  // contextPctInFlight pattern: only the dormant-state stat check is
  // guarded; the one-shot identity-shape probe is separately guarded
  // by identityShapeProbeInFlight. All four reset naturally with the
  // closure on WS close — no explicit teardown step needed as long as
  // these bindings live inside the same per-connection closure scope.
  let dormantInFlight = false;
  let dormantLastEmitted: boolean | null = null;       // change-only emit guard, mirrors planPendingLastSerialized = "null"
  let isIdentityShapedCached: boolean | null = null;  // null = not yet probed; true = identity pane; false = skip dormancy forever
  let identityShapeProbeInFlight = false;
  // quick 260808-dmz — dormant-poll loop (inactive-branch fix).
  // Lightweight 3s poll that replaces the SSH teardown in the inactive branch
  // when a dormant sentinel is detected. Mirrors contextPctTimer/contextPctInFlight
  // pattern for lifecycle (cleared in teardownPane, guarded against pileups).
  let dormantPollTimer: NodeJS.Timeout | null = null;
  let dormantPollInFlight = false;
  // Cached path of the identity's most-recent JSONL, resolved by the
  // dormant-branch tail-open seam and consumed by the dormant-poll timer
  // for the piggyback context-pct emit (readContextPctFromJsonl). Null
  // until discovery completes; also null when discovery returns no-match.
  let dormantSessionFile: string | null = null;
  // 2026-08-18 Layer 3 (session-holding-overlay-arm-on-recycle-sentinel):
  // per-tick in-flight guard for the `.recycle-requested` sentinel probe
  // that piggybacks on the context-pct tick. Mirrors dormantInFlight —
  // prevents slow-SSH pileups if a probe takes longer than the 3s tick.
  let sentinelInFlight = false;
  // quick 260808-fgf — Nelly's .resume-complete freshness contract.
  // Set to Date.now() when the wake handler successfully SSH-execs rm -f .dormant.
  // Read by the dormant-poll seam via a getter accessor. Null means natural resume
  // (no user-initiated Wake click) → skip freshness check entirely.
  // Cleared inside startActiveFlow callback to avoid leaking into a subsequent
  // dormancy cycle on the same WS connection.
  let wakeTriggerTs: number | null = null;
  // Phase 14 Wave 2: per-connection aside extraction bookkeeping. These
  // are per-connection (not cross-tab-shared) so closure-scope is correct.
  // Only `armed`/`displayed` MUST live in module-scope asideState — per
  // CONTEXT.md § Backend per-connection state lock.
  let asideExtractionTimer: NodeJS.Timeout | null = null;
  let asideExtractionInFlight = false;
  let lastStableCapture: string | null = null;
  let hadMarkerLastCapture = false;
  let harnessTasksTimer: NodeJS.Timeout | null = null;
  let harnessTasksInFlight = false;
  let harnessTasksLastSerialized: string | null = null;
  // Backgrounded-agent tracking (patch #61): parent-JSONL scan for Agent
  // tool_use blocks with run_in_background:true, paired against subsequent
  // tool_result blocks by tool_use_id. Emit on serialized-change only.
  // `backgroundedAgentsLastSerialized` is initialized to "[]" (not "") so
  // a JSONL with no background agents produces net-zero emits after the
  // initial `tail -F -n +1` replay.
  const backgroundedAgents = new Map<
    string,
    {
      toolUseId: string;
      subagentType: string;
      description: string;
      startedAt: number;
    }
  >();
  let backgroundedAgentsLastSerialized = "[]";
  // Phase 51 Plan 01: pendingAgentAdmission scratch map. Claude Code v2.1.150+
  // Agent tool_use payloads dropped `input.run_in_background === true`; the
  // async signal moved to the tool_result launch-ack (toolUseResult.isAsync
  // === true). Every modern Agent tool_use is stashed here at tool_use time,
  // then promoted into `backgroundedAgents` when the async-ack arrives (~100ms
  // later). Synchronous Agents (whose first tool_result is a real completion,
  // no isAsync) have their scratch entry silently dropped in the else branch —
  // they never enter `backgroundedAgents`, exactly the desired behavior. See
  // 51-RESEARCH.md § "Fix Shape (recommended)" for the design contract and
  // 51-CONTEXT.md § "Parser admission gate" for the dual-admission decision
  // (legacy `run_in_background === true` still admits directly, belt-and-
  // suspenders). Cleared alongside `backgroundedAgents` at both reset sites.
  const pendingAgentAdmission = new Map<
    string,
    {
      toolUseId: string;
      subagentType: string;
      description: string;
      startedAt: number;
    }
  >();
  // Backgrounded-shells tracking (patch #68): parent-JSONL scan for Bash
  // tool_use blocks with run_in_background:true, paired against subsequent
  // <task-notification> completion payloads. Unlike backgroundedAgents,
  // there is NO tool_result-removal branch — Bash BG tool_results are
  // ALWAYS launch-acks (content starts with "Command running in background
  // with ID:"). Real completion arrives via task-notification only, handled
  // in the shared patch-#66 IIFE below.
  // `backgroundedShellsLastSerialized` is initialized to "[]" (not "") so
  // an empty initial state doesn't emit a spurious frame.
  const backgroundedShells = new Map<
    string,
    {
      toolUseId: string;
      description: string;
      command: string;
      ts: number;
    }
  >();
  let backgroundedShellsLastSerialized = "[]";
  // Phase 50 Plan 01 Task 2 — per-session queue-enqueue dedup. Populated
  // when the parser (Task 1) surfaces a normal-content queue-operation
  // enqueue entry as kind:"message"; consumed when the same content
  // reappears as a normal type:"user" turn (harness dequeue → normal
  // user-turn write path, up to ~2 MINUTES later per 50-CONTEXT.md §
  // Empirical evidence).
  //
  // D-11 revised: KEY = contentHash ONLY (sha256(content).slice(0,32));
  // dropped the ±2-second-bucket sketch after empirical evidence showed
  // enqueue→dequeue can span ~2 minutes (see 50-CONTEXT.md § Empirical
  // evidence). Per-session scope via closure; wall-clock TTL via the
  // number value.
  //
  // See __applyQueueDedupForTests (~L1560) for the dedup logic + hash
  // derivation contract. Lifetime is the tail-watcher closure — the Map
  // is destroyed on WS disconnect / pane teardown along with every
  // other per-connection state slot in this scope.
  const queueEnqueueDedup = new Map<string, number>();
  // Phase 50 Plan 02 D-15 cleanup — per-connection tracking of every mqid
  // armed via armPvSendWatchdog on this WS. Iterated on ws.on("close") to
  // fire clearPvSendWatchdog for each pending mqid — prevents orphan
  // paste_send_failed frames firing against a torn-down socket. T-50-02-06
  // mitigation (Warning #5 mandated this, not optional). See the ws.on("close")
  // handler at L~3660 for the iteration + clear + Set.clear() sequence.
  const pendingMqidsForThisConnection = new Set<string>();
  // Plan-pending tracking (patch #63): parent-JSONL scan for
  // ExitPlanMode tool_use blocks (Claude asking Ashley to accept /
  // keep-planning in Plan Mode), paired against subsequent
  // tool_result blocks by tool_use_id. Emit on serialized-change
  // only. `pendingPlansLastSerialized` is initialized to "null" (not
  // "") so a JSONL with no unmatched ExitPlanMode produces net-zero
  // emits after the initial `tail -F -n +1` replay — the emit shape
  // when pending is null is `{ type: "plan_pending", pending: null }`
  // and JSON.stringify(null) === "null", so matching the initial
  // sentinel to "null" suppresses the spurious first empty emit.
  const pendingPlans = new Map<
    string,
    { planFilePath: string; ts: number }
  >();
  let pendingPlansLastSerialized = "null";
  // Plan-pending PANE-SCRAPE sentinel (quick 260802-rps). Independent of
  // `pendingPlansLastSerialized` (which gates the legacy patch #63 JSONL
  // scan below) because the two signal sources have different resolution
  // timing under Claude Code 2.1.150 — the pane transitions to pending
  // instantly when the Ink prompt opens, while the JSONL only shows the
  // ExitPlanMode tool_use after the user resolves. Both emit onto the
  // same `{type:"plan_pending", pending}` WS frame; whichever transitions
  // first wins on the frontend (see PlanPendingBubble.tsx). Same "null"
  // initial sentinel as `pendingPlansLastSerialized` — matches
  // JSON.stringify(null) so an initial `pending:null` scrape does not
  // fire a spurious first emit.
  let planPendingLastSerialized = "null";
  // Phase 24 Plan 03: plan-content cache — keyed by planFilePath, cleared
  // when the pending window closes (isPlanPending returns false). When the
  // SAME slug reappears immediately (edge: feedback → regenerate same
  // name), we refetch because we cleared on the intermediate close.
  // `planPendingFetchInFlightForPath` ensures at most one in-flight SFTP
  // fetch per (pending-window, planFilePath) pair (T-24-03-02). Both are
  // cleared alongside `planPendingLastSerialized = "null"` on teardown
  // (~L1121) and on session_changed clean-slate (~L1805).
  const planPendingContentByPath: Map<
    string,
    { content: string | null; error: string | null }
  > = new Map();
  const planPendingFetchInFlightForPath: Set<string> = new Set();
  // Phase 24 CR-01 fix: per-pending-window token. Bumped at EVERY cache-clear
  // site (transition-to-closed, teardownPane, session_changed clean-slate).
  // Captured at fetch kickoff; late-arriving `.then()`/`.catch()` callbacks
  // compare `fetchToken !== planPendingWindowToken` and drop the result
  // silently if the window they were dispatched for is no longer current.
  //
  // Why this is necessary: the pre-fix guard only checked
  // `planPendingLastSerialized === "null"` (i.e. pending fully closed). If
  // the pending window transitioned from PlanA → PlanB (different slug, OR
  // same slug regenerated after Feedback) WITHOUT an intervening null-tick
  // that the fetch outlived, that guard is false and a stale PlanA fetch
  // could overwrite PlanB's cache + emit stale content. The token-compare
  // covers BOTH the fully-closed case AND the window-transition case with
  // a single monotonic counter — no need to separately compare planFilePath
  // against the current pane state.
  let planPendingWindowToken = 0;
  let stopped = false;

  // Phase 3 session-changeover state machine. Per D-30 (two-layer detection):
  // `active`  — currently tailing a live session; ticker also polls context-% + tasks.
  // `holding` — recycle in progress: /exit was seen OR discovery repoll showed a
  //             changed sessionFile, but the new tail has not started yet
  //             (Layer 1 fires this on `/exit`; Layer 2 fires it same-tick when
  //             it spots a changed file with no prior /exit).
  // `dead`    — holding timed out (~45s); one final `{type:"inactive"}` was sent
  //             and all pollers/tail were stopped. WS remains open so the client
  //             can render FALLBACK-01; no auto-restart from here.
  type ChangeoverState = "active" | "holding" | "dead";
  let changeoverState: ChangeoverState = "active";
  let currentSessionFile: string | null = null; // set on first discovery success and each session_changed
  let sessionIdFromFile: string | null = null; // UUID basename of currentSessionFile; drives harness-tasks poller cmd (BLOCKER fix)
  // Layer 1 tail-state (quick 260808-ohn / bounty
  // session-holding-layer1-detect-id-reset-not-exit): tracks whether the
  // most-recent user turn observed on this pane's session file is /id
  // reset. Reset to {mostRecentUserTurnIsIdReset: null} on teardownPane
  // and transitionToActiveNew — both are per-connection resets where a
  // fresh tail is about to start. See layer1-detect.ts for the reducer
  // + rationale. Replaces the pre-refactor `hasSeenExit` boolean.
  let layer1: Layer1State = { mostRecentUserTurnIsIdReset: null };
  // Phase 30 Plan 30-01 (PS30-01): per-connection authoritative pane_state
  // emitter. Consolidates today's five racing wire frames (dormant /
  // session_holding / session_holding_cleared / session_changed / inactive)
  // into ONE authoritative { type: "pane_state", state, reason? } frame.
  // Legacy frames stay on the wire alongside (backward-compat this phase);
  // the emitter is ADDITIVE — every existing ws.send at the transition sites
  // below gets a matching paneStateEmitter.emit(...) call. Deduped on strict
  // (state, reason) equality against the last emit (mirrors dormantLastEmitted
  // at lines 1010-1022). See pane-state-emitter.ts for the pure module +
  // 30-CONTEXT.md § Signal set for the LOCKED wire contract.
  const paneStateEmitter: PaneStateEmitter = createPaneStateEmitter({
    wsSend: (data: string) => {
      if (!stopped && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          /* ws may be mid-close */
        }
      }
    },
  });
  // Follow-up to patch #356 (2026-08-08): the reason we entered holding.
  // Layer 2's transitionFromHoldingToActiveSameFile helper reads this to
  // decide whether a "same-file active" repoll tick should self-clear the
  // overlay. When holdingReason === "id_reset" the overlay stays up until
  // the NEW session file appears (transitionToActiveNew) — because Claude
  // is still running its /id save flow before the real recycle, and
  // Layer 2's same-file reading is stale.
  let holdingReason: "id_reset" | "discovery_diff" | "sentinel" | null = null;
  let holdingTicks = 0; // # of 3s ticks in `holding`; timeout at HOLDING_TIMEOUT_TICKS
  let discoveryRepollInFlight = false; // guard against slow SSH pileups (mirrors contextPctInFlight)
  let discoveryRepollTimer: NodeJS.Timeout | null = null;
  // Phase 3: current pane's hostId/tmuxSession hoisted to connection scope so
  // the state-transition helpers (defined once per connection) can log with
  // the right context and so `transitionToActiveNew` can pass tmuxSession into
  // `discoverClaudeSession` if needed. Set on connectToPane after successful
  // discovery; cleared in teardownPane. The connection callback enforces
  // one active pane per WS (line 295 `if (sshConn || tailHandle) teardownPane()`),
  // so these are effectively read-only for the lifetime of a pane.
  let currentHostId: number | null = null;
  let currentTmuxSession: string | null = null;

  const teardownPane = () => {
    if (currentHostId !== null || currentTmuxSession !== null) {
      databaseLogger.info(`[session-server] detach hostId=${currentHostId ?? 'null'} tmuxSession=${currentTmuxSession ?? 'null'} userId=${userId ?? 'null'}`, { operation: "session_detach" });
    }
    if (contextPctTimer) {
      clearInterval(contextPctTimer);
      contextPctTimer = null;
    }
    // quick 260808-dmz: clear dormant-poll loop on pane teardown.
    if (dormantPollTimer) {
      clearInterval(dormantPollTimer);
      dormantPollTimer = null;
    }
    dormantPollInFlight = false;
    // 2026-08-18 Layer 3: reset sentinel probe in-flight flag on teardown so
    // the next connect starts clean. No timer of its own — piggybacks on
    // context-pct tick.
    sentinelInFlight = false;
    if (harnessTasksTimer) {
      clearInterval(harnessTasksTimer);
      harnessTasksTimer = null;
    }
    if (discoveryRepollTimer) {
      clearInterval(discoveryRepollTimer);
      discoveryRepollTimer = null;
    }
    // Phase 14 Wave 2: extraction poller lifecycle is tied to the pane —
    // teardownPane fires on connectToPane rebind and (via ws.on("close"))
    // on disconnect. activeViewers Set membership is torn down in
    // ws.on("close") only (not here) because a pane-switch keeps the WS
    // itself alive; the fan-out registry is per-WS, not per-pane.
    if (asideExtractionTimer) {
      clearInterval(asideExtractionTimer);
      asideExtractionTimer = null;
    }
    asideExtractionInFlight = false;
    lastStableCapture = null;
    hadMarkerLastCapture = false;
    // Reset per-WS aside gates on pane rebind — the fresh pane has no
    // aside in flight yet. asideState entry itself stays (module-scope,
    // lifetime = WS connection); we just clear the flags.
    const st = asideState.get(ws);
    if (st) {
      st.armed = false;
      st.displayed = false;
    }
    // Phase 14 Wave 2: on pane rebind, remove this WS from any prior
    // pane's fan-out registry so a subsequent broadcast doesn't spuriously
    // dismiss on the new pane. The current-pane registration happens
    // freshly in the connectToPane handler below (after discovery success).
    if (currentHostId != null && currentTmuxSession != null) {
      const priorKey = sessionKey(currentHostId, currentTmuxSession);
      const priorPeers = activeViewers.get(priorKey);
      if (priorPeers) {
        priorPeers.delete(ws);
        if (priorPeers.size === 0) activeViewers.delete(priorKey);
      }
    }
    harnessTasksLastSerialized = null;
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
    planPendingLastSerialized = "null";
    // Phase 24 Plan 03: invalidate the fetched plan-content cache and drop
    // any in-flight fetch trackers. Late arrivals from a pre-teardown fetch
    // are short-circuited by the per-window token compare in .then()/.catch()
    // (CR-01 fix — token bump on every cache-clear invalidates in-flight
    // closures regardless of what planPendingLastSerialized currently holds).
    planPendingContentByPath.clear();
    planPendingFetchInFlightForPath.clear();
    planPendingWindowToken += 1;
    backgroundedAgents.clear();
    backgroundedAgentsLastSerialized = "[]";
    // Phase 51 Plan 01: clear the pendingAgentAdmission scratch map alongside
    // backgroundedAgents so a teardown drops any half-lifecycle modern Agent
    // (tool_use seen, ack/completion not yet). Same rationale as clearing
    // backgroundedAgents — the fresh session's `-n +1` replay repopulates.
    pendingAgentAdmission.clear();
    backgroundedShells.clear();
    backgroundedShellsLastSerialized = "[]";
    // Phase 3: reset changeover state so a full pane teardown-and-reconnect
    // (e.g. via a fresh connectToPane) starts clean. connectToPane already
    // calls teardownPane before starting a new pane; being defensive here
    // means the state is guaranteed reset even if teardownPane is called
    // from elsewhere (e.g. transitionToDead) without a follow-up reconnect.
    changeoverState = "active";
    currentSessionFile = null;
    sessionIdFromFile = null;
    layer1 = { mostRecentUserTurnIsIdReset: null };
    holdingReason = null;
    holdingTicks = 0;
    discoveryRepollInFlight = false;
    currentHostId = null;
    currentTmuxSession = null;
    if (tailHandle) {
      try {
        tailHandle.stop();
      } catch (err) {
        databaseLogger.warn(`[ws-server] tail-stop-failed hostId=${currentHostId ?? 'null'} err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_tail_stop_failed" });
      }
      tailHandle = null;
    }
    // Phase 41 Plan 04: drain in-flight upload batches when the pane's SSH
    // conn is being closed — an orphaned batch would keep writing to a
    // destroyed conn otherwise. Mirrors terminal.ts's ws.on("close") posture
    // ported to per-teardown scope since claude-session-server does pane-
    // switching within one WS.
    if (ownedUploadBatches.size > 0) {
      cleanupBatchesForConnection(Array.from(ownedUploadBatches));
      ownedUploadBatches.clear();
    }
    if (sshConn) {
      try {
        sshConn.end();
      } catch (err) {
        databaseLogger.warn(`[ws-server] conn-end-failed hostId=${currentHostId ?? 'null'} err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" });
      }
      sshConn = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Phase 3 canonical declaration order (W1 fix from plan-checker):
  //   state vars (above)
  //   → teardownPane (above)
  //   → const onLine (here)
  //   → const onError (here)
  //   → setupHarnessTasksPoller (here)
  //   → transitionToHolding (here)
  //   → transitionToActiveNew (here; references onLine, onError, setupHarnessTasksPoller)
  //   → transitionToDead (here; references teardownPane)
  //   → ws.on("message") handler body (below, unchanged shape)
  //
  // All cross-references between helpers happen at call-time inside async
  // callbacks (setInterval, tail's onLine), never at synchronous handler-body
  // execution — so TypeScript's TDZ and JS's const-scoping are both happy
  // with this order. `hostId` and `tmuxSession` from the connectToPane
  // message handler are captured via connection-scoped `let currentHostId` /
  // `let currentTmuxSession` (set on discovery success, cleared in
  // teardownPane) so these helpers can log with the correct context.
  // ---------------------------------------------------------------------------

  // Tail's onLine handler — extracted from the pre-Phase-3 inline lambda so
  // `transitionToActiveNew` can restart the tail with the SAME callbacks
  // rather than duplicating them. Body is byte-for-byte preserved from the
  // pre-refactor code with ONE addition: the Layer 1 tail-state-derived
  // /id reset detector right after the ws-open guard (quick 260808-ohn).
  // ── PHASE-43 OBSERVATION CHANNEL START — DO NOT EDIT BODY BELOW; extend switch cases in Region B only ──
  const onLine = (line: string) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;

    // Phase 30 Plan 30-02 (PS30-02): parser observation channel for
    // /id reset. Runs BEFORE Layer 1 dispatch so the earliest real
    // "recycling starts now" signal fires first — /id reset lands in
    // the JSONL BEFORE Claude Code terminates, so this beats the
    // PID-death /exit-scan heuristic that Layer 1's tail-state reducer
    // + Layer 2's discovery-repoll fall back to. Detection is
    // ORTHOGONAL to the parseSessionLine message-emission path below:
    // the /id reset user turn STILL renders as a normal chat bubble
    // in pretty view (Ashley's HARD LOCK on slash-command visibility —
    // see the doctrine comment above the Layer 1 dispatch block below).
    // The observation channel just fires an ADDITIONAL
    // pane_state:holding emission on the same line. On real /id reset
    // the emitter's dedupe (Plan 30-01 pane-state-emitter.ts) collapses
    // this + the Layer 1 tail-state reducer's own transitionToHolding
    // ("id_reset") below into ONE wire frame.
    //
    // Fresh JSON.parse here mirrors the backgrounded-agents parallel
    // scan pattern at ~L1665 below — cheap at these volumes and keeps
    // the observation channel decoupled from parseSessionLine's
    // internal implementation (parseSessionLine JSON.parses again
    // internally; the two parses are independent and the aggregate
    // cost is still negligible on live tail volumes).
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (detectIdReset(obj)) {
        paneStateEmitter.emit("holding", "id_reset");
      }
    } catch {
      /* malformed line — parseSessionLine below will surface as kind:"malformed" */
    }

    // Phase 30 F2 acknowledgment: after the parser observation channel
    // above fires paneStateEmitter.emit("holding", "id_reset") on real
    // /id reset lines, this Layer 1 arm_holding path is functionally
    // redundant for wire emission (emitter dedupe collapses both to
    // one frame). The branch stays intact as defense-in-depth against
    // future parser regressions (raw-string detection in layer1-detect.ts
    // is a disjoint code path from object-based detection in
    // session-file-parser.ts:detectIdReset), and because Layer 1 ALSO
    // owns the clear_holding transition + the holdingReason === "id_reset"
    // guard at L2232 in transitionFromHoldingToActiveSameFile that this
    // arm path is the sole producer of. Do NOT delete this branch.

    // Phase 3 Layer 1 (rewired 2026-08-08, quick 260808-ohn / bounty
    // session-holding-layer1-detect-id-reset-not-exit):
    //
    // Feed every raw JSONL line through the tail-state reducer in
    // layer1-detect.ts. The reducer updates `layer1.mostRecentUserTurnIsIdReset`
    // iff the line is a user turn, then decides an action based on
    // the new state + current changeoverState. The SessionHoldingOverlay
    // is armed IFF the file's most-recent user turn is /id reset —
    // computed uniformly across `-n +1` replay AND live-append, so
    // historical /exit or historical /id reset lines from prior
    // recycles no longer re-flash the overlay on WS reconnect (Ashley
    // empirically saw 14 arm+clear pairs in ~1h under the pre-refactor
    // /exit edge-triggered detector). Sub-second detection of the
    // current session's /id reset is preserved. Layer 2 (discovery
    // repoll in the ticker) still catches SIGTERM-fallback and
    // recover-in-different-cwd via sessionFile diff. See
    // layer1-detect.ts for the reducer's rationale + unit tests, and
    // CONTEXT.md D-30 for the two-layer architecture.
    //
    // Fall through — the parser may still emit the /id reset turn as
    // a message (per Ashley's HARD LOCK: slash commands must remain
    // visible in pretty view). The state transition is orthogonal to
    // whether the /id reset text renders as a chat bubble. DO NOT
    // `return` here.
    const layer1Action = applyLineToLayer1State(line, layer1, changeoverState);
    if (layer1Action === "arm_holding") {
      transitionToHolding("id_reset");
    } else if (layer1Action === "clear_holding") {
      transitionFromHoldingToActiveSameFile();
    }

    // Parallel raw-line scan for backgrounded Agent invocations (patch
    // #61). Runs ALONGSIDE parseSessionLine, not through it — RENDER-01
    // HARD LOCK strips tool_use/tool_result blocks structurally at the
    // parser, so they never reach parseSessionLine's output. A second
    // JSON.parse is trivially cheap at these volumes.
    //
    // Detection (from github.com/delexw/claude-code-trace spec 09):
    //   - tool_use with name === "Agent" and input.run_in_background ===
    //     true → started; keyed by tool_use.id.
    //   - tool_result with matching tool_use_id → completed; drop.
    // Emit `backgrounded_agents` only when the sorted-serialized list
    // changes vs last emit. The tail's `-n +1` replay converges the map
    // naturally through history — a completed subagent adds then removes
    // within a few lines, and the initial `lastSerialized = "[]"` matches
    // the empty-list stringification so no spurious empty emit fires.
    try {
      const obj = JSON.parse(line) as {
        type?: string;
        timestamp?: string;
        message?: { content?: unknown };
      };
      const content = obj?.message?.content;
      // Phase 51 Plan 01 refactor-extract: the assistant/user branches that
      // maintain `backgroundedAgents` + `backgroundedShells` (and, after
      // Task 2, the `pendingAgentAdmission` scratch map) now live in a
      // module-scope helper so they can be unit-tested without spinning up
      // a full WS server + SSH pair. Behavior is identical to the pre-
      // refactor inline block (see the helper docblock at
      // __admitBackgroundedAgentsLineForTests ~L352 for details). The
      // helper re-parses `line` internally — a second JSON.parse is
      // trivially cheap at these volumes (same rationale as the parallel
      // parse note above).
      __admitBackgroundedAgentsLineForTests(line, {
        backgroundedAgents,
        pendingAgentAdmission,
        backgroundedShells,
      });
      // Patch #66 completion signal for backgrounded Agents. Claude Code /
      // its harness lands the task-notification payload in the JSONL in
      // AT LEAST three observed shapes across versions and states:
      //   (1) type:"attachment" with attachment.commandMode:"task-
      //       notification" and attachment.prompt carrying the XML.
      //   (2) type:"queue-operation" with a top-level `content` string
      //       carrying the XML (harness enqueue bookkeeping).
      //   (3) type:"user" with message.content being a raw STRING that
      //       starts with "<task-notification>" (the user-turn form
      //       observed on this box's Claude Code v2.1.143).
      // Detect any of the three by picking whichever field carries the
      // payload; require the STRING to START with "<task-notification>"
      // (not merely contain it) so a normal user message or tool_result
      // that happens to quote the phrase does NOT false-positive — same
      // discipline as patch #65's anchored /exit scan.
      const notifPayload = ((): string | null => {
        // Shape 1: type:"attachment" + attachment.prompt
        const attachmentAny = obj as {
          type?: string;
          attachment?: { commandMode?: string; prompt?: unknown };
        };
        if (
          attachmentAny?.type === "attachment" &&
          attachmentAny?.attachment?.commandMode === "task-notification" &&
          typeof attachmentAny?.attachment?.prompt === "string" &&
          attachmentAny.attachment.prompt.startsWith("<task-notification>")
        ) {
          return attachmentAny.attachment.prompt;
        }
        // Shape 2: type:"queue-operation" + top-level content string
        const qopAny = obj as { type?: string; content?: unknown };
        if (
          qopAny?.type === "queue-operation" &&
          typeof qopAny?.content === "string" &&
          qopAny.content.startsWith("<task-notification>")
        ) {
          return qopAny.content;
        }
        // Shape 3: type:"user" + message.content as raw XML string
        if (
          obj?.type === "user" &&
          typeof content === "string" &&
          content.startsWith("<task-notification>")
        ) {
          return content;
        }
        return null;
      })();
      if (notifPayload) {
        const idMatch = notifPayload.match(
          /<tool-use-id>(toolu_[^<]+)<\/tool-use-id>/,
        );
        const statusMatch = notifPayload.match(
          /<status>(completed|failed|stopped|cancelled|error)<\/status>/,
        );
        if (idMatch && statusMatch) {
          backgroundedAgents.delete(idMatch[1]);
          backgroundedShells.delete(idMatch[1]);
        }
      }
      // ── DEPRECATED FOR PENDING-WINDOW DETECTION (quick 260802-rps) ─────
      // Claude Code 2.1.150's `ExitPlanModeV2Tool` BUFFERS the tool_use in
      // Ink UI memory and only flushes it to the parent JSONL when the user
      // resolves the plan-approval prompt (approve or reject). Live
      // confirmation on Moxie's workstation 2026-08-02: 57-minute gap
      // between the model calling ExitPlanMode and the JSONL write, which
      // landed at the exact moment Ashley approved. As a result THIS SCAN
      // IS EFFECTIVELY DEAD CODE for pending-window detection — during the
      // entire pending window the JSONL has zero signal.
      //
      // The authoritative live signal is now the pane-scrape via
      // `isPlanPending` wired into the context-pct setInterval (see
      // ~line 3106). This scan is RETAINED as belt-and-suspenders for two
      // remaining edges: (1) the resolution edge — after V2 flushes both
      // the tool_use and the matching tool_result on user resolution, this
      // scan will re-emit `pending: null` (harmless coalesce with the
      // pane-scrape's own null-emit); (2) backward-compat for any older
      // Claude Code sessions still writing ExitPlanMode eagerly (v1 tool
      // behavior). Do NOT delete without confirming both edges are
      // covered by the pane-scrape.
      // ────────────────────────────────────────────────────────────────
      // Plan-pending scan (patch #63). Reuses `obj` + `content` from the
      // patch-#61 backgrounded-agents scan above; do NOT re-parse.
      //   - assistant turn whose content[] contains a tool_use block with
      //     name === "ExitPlanMode" → pending; keyed by tool_use.id.
      //   - user turn whose content[] contains a tool_result with matching
      //     tool_use_id → cleared. (The patch-#61 branch already iterates
      //     tool_result blocks for its Agent correlation; adding one more
      //     `pendingPlans.delete(id)` call in the same loop is the cheap
      //     option, but for readability we do a fresh iteration here — the
      //     line volume is low enough that it does not matter.)
      if (obj?.type === "assistant" && Array.isArray(content)) {
        for (const block of content as unknown[]) {
          const b = block as {
            type?: string;
            name?: string;
            id?: string;
            input?: { planFilePath?: unknown };
          };
          if (
            b?.type === "tool_use" &&
            b?.name === "ExitPlanMode" &&
            typeof b?.id === "string"
          ) {
            pendingPlans.set(b.id, {
              planFilePath:
                typeof b.input?.planFilePath === "string"
                  ? b.input.planFilePath
                  : "",
              ts:
                typeof obj.timestamp === "string"
                  ? Date.parse(obj.timestamp) || Date.now()
                  : Date.now(),
            });
          }
        }
      } else if (obj?.type === "user" && Array.isArray(content)) {
        for (const block of content as unknown[]) {
          const b = block as { type?: string; tool_use_id?: string };
          if (
            b?.type === "tool_result" &&
            typeof b?.tool_use_id === "string"
          ) {
            pendingPlans.delete(b.tool_use_id);
          }
        }
      }
      // Only one ExitPlanMode can be pending at a time in practice (Claude
      // Code's Ink UI serializes Plan Mode prompts), so taking any entry
      // (via `.values().next()`) is correct. If somehow more than one
      // survives, we still emit a stable answer — whichever entry the map
      // returns first — until one is closed.
      const pendingIter = pendingPlans.values().next();
      // Phase 24 Plan 03: widen the JSONL-scan emit shape to match the
      // pane-scrape emit (`{planFilePath, planContent, contentError}` or
      // null). JSONL is a resolution-edge fallback per patch #63 docblock;
      // do NOT trigger an SFTP fetch here — the pane-scrape at ~L3355 is
      // the authoritative live signal that owns the fetch trigger. Content
      // will always be null on this path; the frontend renders "Loading
      // plan…" until (in the unlikely event a JSONL-first pending appears)
      // the pane-scrape catches up on its next tick.
      const currentPending = pendingIter.done
        ? null
        : {
            planFilePath: pendingIter.value.planFilePath || null,
            planContent: null,
            contentError: null,
          };
      const planSerialized = JSON.stringify(currentPending);
      if (planSerialized !== pendingPlansLastSerialized) {
        pendingPlansLastSerialized = planSerialized;
        try {
          ws.send(
            JSON.stringify({
              type: "plan_pending",
              pending: currentPending,
            }),
          );
        } catch {
          /* ws may be mid-close */
        }
      }
      const agents = Array.from(backgroundedAgents.values()).sort(
        (a, b) => a.startedAt - b.startedAt,
      );
      const serialized = JSON.stringify(agents);
      if (serialized !== backgroundedAgentsLastSerialized) {
        backgroundedAgentsLastSerialized = serialized;
        try {
          ws.send(
            JSON.stringify({ type: "backgrounded_agents", agents }),
          );
        } catch {
          /* ws may be mid-close */
        }
      }
      const shells = Array.from(backgroundedShells.values()).sort(
        (a, b) => a.ts - b.ts,
      );
      const shellsSerialized = JSON.stringify(shells);
      if (shellsSerialized !== backgroundedShellsLastSerialized) {
        backgroundedShellsLastSerialized = shellsSerialized;
        try {
          ws.send(
            JSON.stringify({ type: "backgrounded_shells", shells }),
          );
        } catch {
          /* ws may be mid-close */
        }
      }
    } catch {
      /* malformed line — silently ignore, same posture as parser */
    }

    // Phase 47 Plan 03 Hunk A: pre-increment the outer `lineNum` counter
    // (declared at ~L1839, reset in transitionToActiveNew). tail -F -n +1
    // starts at line 1 of the current file; this is the NEXT line, so
    // lineNum becomes 1 on first invocation and matches sed's 1-indexing
    // used by session-file-range-reader.ts.
    lineNum += 1;

    // Phase 50 Plan 01 Task 2: thread sessionIdFromFile so the parser's
    // queue-operation branch derives a deterministic eventId per
    // (sessionId, timestamp, content) — see 50-01-PLAN.md § objective
    // "Hash-derivation contract". Non-queue-operation branches ignore
    // the sessionId argument (unchanged uuid/messageId chain).
    const parsed = parseSessionLine(line, sessionIdFromFile ?? undefined);
    // Discriminator switch on parsed.kind — RENDER-01 hard-lock enforcement.
    // kind:"skip" and kind:"malformed" are silently dropped. Each emitting
    // branch sends exactly one WS frame per parsed turn; the switch guarantees
    // mutual exclusivity (only one case fires per line).
    //
    // Phase 47 Plan 03 Hunk A: the case-by-case switch that lived here was
    // extracted into the shared `reshapeParsedLineToWireFrame` helper (~L280).
    // Both the streaming-tail (here) AND `handleFetchOlderRange` (Plan 47-03
    // Hunk C) call the SAME helper — this is what guarantees wire-shape
    // parity between the two emit paths (streaming vs. range-fetch). If you
    // are tempted to add a new per-kind case, extend the shared helper
    // instead — do NOT reintroduce a switch here.
    const frame = reshapeParsedLineToWireFrame(parsed, line, lineNum);
    // Phase 50 Plan 01 Task 2: per-session queue-enqueue dedup applied
    // BEFORE ws.send. Suppresses the dequeue-time normal-user-turn
    // duplicate emission when the same content was already emitted
    // from an enqueue entry within the 10-minute TTL window. Requires a
    // fresh JSON.parse of the raw line so we can inspect rawObj.type +
    // rawObj.operation without re-widening reshapeParsedLineToWireFrame's
    // contract. Cost is one small JSON.parse per line on kind:"message"
    // frames only — negligible on live tail volumes and consistent with
    // the existing parallel-scan pattern above.
    if (frame !== null) {
      let suppress = false;
      if (frame.type === "message" && frame.role === "user") {
        try {
          const rawObj = JSON.parse(line) as Record<string, unknown>;
          const result = __applyQueueDedupForTests({
            parsedFrame: parsed,
            rawObj,
            dedupMap: queueEnqueueDedup,
            now: Date.now(),
          });
          suppress = result.suppress;
        } catch {
          /* malformed line — already surfaced by parseSessionLine as kind:"malformed"
             which is never a message frame, so we shouldn't hit this path. */
        }
      }
      if (!suppress) {
        try {
          ws.send(JSON.stringify(frame));
        } catch {
          /* ws may be mid-close; drop */
        }
        // Phase 50 Plan 02 Task 2 — notify any pending pv-send-watchdog that
        // the matching parser signal has arrived. Fires for BOTH the direct-
        // user-turn path AND the queue-operation-enqueue path (Plan 50-01 T1).
        // contentHash derivation MUST match the arm-time key at
        // __applyInputMessageForTests L~1585 AND Plan 50-01 Task 2's dedup
        // Map key — if any of the three drift, watchdogs never notify and
        // every send escalates unnecessarily. See 50-01-PLAN.md § objective
        // "Hash-derivation contract".
        if (
          frame.type === "message" &&
          frame.role === "user" &&
          typeof frame.content === "string" &&
          frame.content.length > 0 &&
          sessionIdFromFile
        ) {
          const contentHash = createHash("sha256")
            .update(frame.content)
            .digest("hex")
            .slice(0, 32);
          notifyPvSendMatched(sessionIdFromFile, contentHash);
        }
      }
    }
    // kind:"skip" returns null and is silently dropped (RENDER-01 lock;
    // skip covers meta, empty_content, harness_wrapper, no_message,
    // unknown-type — same policy as the pre-refactor switch's implicit
    // no-case default fallthrough).
  };
  // ── PHASE-43 OBSERVATION CHANNEL END ──

  // Tail's onError handler — byte-for-byte preserved from the pre-refactor
  // inline lambda apart from swapping the message-scoped `hostId` /
  // `tmuxSession` for the connection-scoped `currentHostId` /
  // `currentTmuxSession` (set on connectToPane discovery success, both are
  // non-null whenever the tail is running).
  const onError = (err: Error) => {
    sshLogger.error("Claude session tail error", err, {
      operation: "claude_session_tail_error",
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
    });
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          type: "tail_error",
          message: err.message,
        }),
      );
    } catch (sendErr) {
      databaseLogger.warn(`[ws-server] send-failed msgType=tail_error err="${sendErr instanceof Error ? sendErr.message : String(sendErr)}"`, { operation: "ws_send_failed" });
    }
  };

  // BLOCKER fix (plan-checker 2026-07-18): the harness-tasks poller setup
  // is extracted into a helper so `transitionToActiveNew` can rebind it
  // against the NEW sessionId after a recycle. The pre-Phase-3 code baked
  // the initial-connect UUID into `tasksCmd` as a `const`, so post-recycle
  // the poller kept querying the DEAD session's tasks directory forever.
  //
  // The helper is idempotent — safe to call at any state; teardown-and-
  // restart against any UUID (including the same UUID, which is the
  // CHANGEOVER-05 recover-in-different-cwd case). The setInterval body is
  // byte-for-byte preserved from the pre-refactor block.
  const setupHarnessTasksPoller = (
    newSessionIdFromFile: string,
  ): void => {
    if (harnessTasksTimer) {
      clearInterval(harnessTasksTimer);
      harnessTasksTimer = null;
    }
    // Belt-and-braces: clear the dedupe sentinel so the first emit after
    // a restart fires unconditionally. transitionToActiveNew ALSO resets
    // this — doing it here means direct callers (e.g. the initial-connect
    // path) don't need to remember.
    harnessTasksLastSerialized = null;
    // No UUID → no tasks dir → no poller. Same guard the pre-refactor
    // patch-#52c code used; also protects against shell injection via a
    // malformed sessionId basename.
    if (!UUID_RE.test(newSessionIdFromFile)) return;

    const tasksCmd = `for f in "$HOME/.claude/tasks/${newSessionIdFromFile}"/*.json; do [ -f "$f" ] && { tr '\\n' ' ' < "$f"; echo; }; done 2>/dev/null`;
    harnessTasksTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (harnessTasksInFlight) return;
      harnessTasksInFlight = true;
      const connSnapshot = sshConn;
      execCommand(connSnapshot, tasksCmd)
        .then((output) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const tasks: unknown[] = [];
          for (const raw of output.split("\n")) {
            const line = raw.trim();
            if (!line) continue;
            try {
              tasks.push(JSON.parse(line));
            } catch {
              /* skip malformed lines silently */
            }
          }
          // Sort by numeric id ascending so display order matches /queue.
          tasks.sort((a, b) => {
            const ai = parseInt(
              String((a as { id?: unknown }).id ?? ""),
              10,
            );
            const bi = parseInt(
              String((b as { id?: unknown }).id ?? ""),
              10,
            );
            if (Number.isFinite(ai) && Number.isFinite(bi))
              return ai - bi;
            return 0;
          });
          const serialized = JSON.stringify(tasks);
          if (serialized === harnessTasksLastSerialized) return;
          harnessTasksLastSerialized = serialized;
          try {
            ws.send(
              JSON.stringify({ type: "harness_tasks", tasks }),
            );
          } catch {
            /* ws may be mid-close */
          }
        })
        .catch(() => {
          /* Silent — same posture as the context-pct poller. */
        })
        .finally(() => {
          harnessTasksInFlight = false;
        });
    }, HARNESS_TASKS_INTERVAL_MS);
  };

  // ---------------------------------------------------------------------------
  // Phase 3 state-transition helpers. All three close over the connection-
  // scoped state (changeoverState, currentSessionFile, sessionIdFromFile,
  // layer1, holdingTicks, ws, sshConn, etc.) and the connection-scoped
  // context (currentHostId, currentTmuxSession — set on connectToPane).
  // ---------------------------------------------------------------------------

  // Called when the tail's onLine dispatches Layer 1's tail-state-derived
  // /id reset detector (sub-second, quick 260808-ohn) OR when the ticker's
  // discovery-repoll notices a changed sessionFile (Layer 2's
  // SIGTERM-fallback path). Idempotent against double-fire — if state is
  // already `holding` or `dead`, this is a no-op. That protects against the
  // race where Layer 1 fires on the tail's onLine milliseconds before the
  // ticker's Layer 2 repoll notices the same recycle.
  const transitionToHolding = (
    reason: "id_reset" | "discovery_diff" | "sentinel",
  ): void => {
    if (changeoverState !== "active") return;
    changeoverState = "holding";
    holdingReason = reason;
    holdingTicks = 0;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session_holding" }));
      } catch {
        /* ws may be mid-close */
      }
    }
    // Phase 30 Plan 30-01 (PS30-01): authoritative pane_state alongside the
    // legacy session_holding frame. `reason` forwards through — Layer 1
    // dispatches "id_reset"; Layer 2 discovery-repoll dispatches
    // "discovery_diff". The emitter's own guard + dedupe make this safe
    // even under the pre-existing idempotent-double-fire race between L1
    // and L2 (both funnel here with the same reason on rare co-fires).
    paneStateEmitter.emit("holding", reason);
    sshLogger.info("Claude session entering holding state", {
      operation: "claude_session_holding",
      reason,
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      oldSessionFile: currentSessionFile,
    });
  };

  // Fix B (2026-07-30): self-clear the holding overlay when the repoll's
  // active-branch sees the SAME sessionFile while changeoverState === "holding".
  // This means the overlay was armed by a false alarm (e.g. a transient SSH
  // blip that slipped through before Fix A, or a brief bare-shell gap that
  // resolved on the next tick), NOT a real recycle. The same-file result on
  // an active tick proves claude never actually stopped writing to this file.
  //
  // Contrast with transitionToActiveNew (called when sessionFile CHANGED) which
  // is a heavy-reset for a confirmed real recycle. This helper is surgical:
  // flip changeoverState back to active, reset holdingTicks, emit
  // session_holding_cleared. The frontend handler clears only isHolding +
  // holdingTimeoutError and does NOT touch messages / contextPct / harnessTasks
  // / backgroundedAgents / plan_pending / asideText — false-alarm recovery
  // must not discard the conversation the user is looking at.
  //
  // Idempotency: if changeoverState is not "holding", this is a no-op. Guards
  // against double-fire (e.g. from a fast repoll that fires twice before the
  // first tick's WS send completes).
  const transitionFromHoldingToActiveSameFile = (): void => {
    if (changeoverState !== "holding") return;
    // Follow-up to patch #356 (2026-08-08): if we entered holding because
    // Layer 1 saw a real /id reset in the tail, the 3-second repoll tick's
    // "same-file active" reading is STALE — Claude is still running its
    // /id save flow (many tool invocations) before exit, so discovery
    // correctly reports the OLD session file as active. Clearing here
    // would flash the SessionHoldingOverlay off within ~1-3s of Ashley
    // typing /id reset even though the real recycle is still coming.
    // Skip the clear; wait for transitionToActiveNew when the new session
    // file appears (Layer 2's real-recycle path, unchanged).
    //
    // 2026-08-18: Same rule extended to `holdingReason === "sentinel"`.
    // Layer 3 (sentinel-detect) arms when `.recycle-requested` is present
    // on the target box, but the agent-supervisor's kill+respawn is
    // asynchronous and typically lags the sentinel drop by seconds.
    // Discovery may still see the OLD session file as active during that
    // window — same "stale-active-reading" trap as id_reset, same fix:
    // defer the clear to transitionToActiveNew.
    if (holdingReason === "id_reset" || holdingReason === "sentinel") {
      sshLogger.debug(
        `Layer 2 same-file-active during ${holdingReason} holding — deferring clear to transitionToActiveNew`,
        {
          operation: "claude_session_holding_same_file_deferred",
          holdingReason,
          userId,
          sessionId,
          hostId: currentHostId,
          tmuxSession: currentTmuxSession,
          sessionFile: currentSessionFile,
        },
      );
      return;
    }
    changeoverState = "active";
    holdingReason = null;
    holdingTicks = 0;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session_holding_cleared" }));
      } catch {
        /* ws may be mid-close */
      }
    }
    // Phase 30 Plan 30-01: false-alarm-recovery case. Surface the recovery
    // reason so the frontend + logs can distinguish this "we armed holding
    // then discovery repoll proved it was a false alarm" path from the
    // real-recycle transitionToActiveNew ("session_changed") path.
    paneStateEmitter.emit("active", "same_file_recovery");
    sshLogger.info("Claude session self-cleared from holding on same-file recovery", {
      operation: "claude_session_holding_cleared",
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      sessionFile: currentSessionFile,
    });
  };

  // Called by the discovery-repoll branch when a changed sessionFile is
  // detected. Tears down the old tail, clears ALL buffered per-session
  // state (CHANGEOVER-04 backend-side reset), rebinds the harness-tasks
  // poller against the new UUID (BLOCKER fix), starts a new tail on the
  // new file, and emits `session_changed`. Does NOT close the WS and does
  // NOT touch `sshConn` — the same SSH connection multiplexes the new tail
  // + the same three pollers.
  const transitionToActiveNew = (newSessionFile: string): void => {
    const oldSessionFile = currentSessionFile;
    const oldSessionIdFromFile = sessionIdFromFile;
    if (tailHandle) {
      try {
        tailHandle.stop();
      } catch (err) {
        databaseLogger.warn(`[ws-server] tail-stop-failed hostId=${currentHostId ?? 'null'} err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_tail_stop_failed" });
      }
      tailHandle = null;
    }
    // Fix #2 (post-Phase-50 code review): clear session-scoped state that
    // previously survived the recycle and could leak OLD-session behavior:
    //   • queueEnqueueDedup Map (stale hashes suppress fresh frames)
    //   • pv-send-watchdog `pending` for the OLD sessionId (a mid-arm
    //     watchdog whose full-resend fires post-recycle would retype OLD
    //     body into NEW composebox — shape-invariant violation)
    //   • pendingMqidsForThisConnection Set entries for those cleared mqids
    // Runs BEFORE the other buffered-state resets so OLD-session watchdogs
    // are cancelled before any onLine callback from the fresh tail's
    // `-n +1` replay can race with them. The helper is a pure function
    // (applyTransitionToActiveNewCleanup at ~L1470) — re-exported for
    // integration test scenario (h) in optimistic-bubbles.integration.test.ts.
    if (oldSessionIdFromFile !== null) {
      applyTransitionToActiveNewCleanup({
        oldSessionId: oldSessionIdFromFile,
        queueEnqueueDedup,
        pendingMqidsForThisConnection,
      });
    }
    // Clear ALL buffered per-session state before the new tail starts so
    // the fresh session's `-n +1` replay converges on clean bookkeeping.
    harnessTasksLastSerialized = null;
    backgroundedAgents.clear();
    backgroundedAgentsLastSerialized = "[]";
    // Phase 51 Plan 01: clear the pendingAgentAdmission scratch map alongside
    // backgroundedAgents on session recycle. Same rationale — the fresh
    // session's `-n +1` replay repopulates from scratch.
    pendingAgentAdmission.clear();
    backgroundedShells.clear();
    backgroundedShellsLastSerialized = "[]";
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
    planPendingLastSerialized = "null";
    // Phase 24 Plan 03: clean-slate the plan-content cache on session recycle.
    // CR-01 fix: bump the window token so any in-flight fetch dispatched
    // against the OLD session's pending window drops its result silently.
    planPendingContentByPath.clear();
    planPendingFetchInFlightForPath.clear();
    planPendingWindowToken += 1;
    // quick 260808-ohn: reset Layer 1 tail-state on session recycle so the
    // new tail's -n +1 replay converges on clean bookkeeping.
    layer1 = { mostRecentUserTurnIsIdReset: null };
    holdingReason = null;
    holdingTicks = 0;
    // Phase 47 Plan 03 Hunk A: reset the streaming-tail line-counter for
    // the new session file. The new `tail -F -n +1` will re-play from line
    // 1, so the counter must return to 0 (pre-increment brings it back to
    // 1 on first callback).
    lineNum = 0;

    // Derive the new UUID basename using the same slug logic the initial-
    // connect path uses. Kept inline to keep this file self-contained.
    const newSessionIdFromFile = newSessionFile
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, "");
    currentSessionFile = newSessionFile;
    sessionIdFromFile = newSessionIdFromFile;

    // BLOCKER fix: rebind the harness-tasks poller against the NEW UUID.
    // For CHANGEOVER-05 (recover-in-different-cwd, UUID preserved), this
    // is an idempotent no-op restart against the same UUID — still safe.
    setupHarnessTasksPoller(newSessionIdFromFile);

    changeoverState = "active";

    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type: "session_changed",
            newSessionFile,
          }),
        );
      } catch {
        /* ws may be mid-close */
      }
    }
    // Phase 30 Plan 30-01: real-recycle path. The new session file's UUID
    // stays on the legacy session_changed frame only — pane_state's
    // reason field is enum-shaped (no filesystem paths per T-30-01
    // mitigation). "session_changed" as reason keeps parity with the
    // legacy frame's meaning.
    paneStateEmitter.emit("active", "session_changed");
    sshLogger.info("Claude session changed", {
      operation: "claude_session_changed",
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      oldSessionFile,
      newSessionFile,
      // For post-deploy debugging: distinguishes recycle (UUID changed)
      // from recover-in-different-cwd (UUID preserved, projects/slug
      // subdir moved).
      sessionIdChanged:
        oldSessionIdFromFile !== newSessionIdFromFile,
    });

    // Restart the tail on the new file with the SAME onLine/onError
    // closures — do NOT create new lambdas; that would defeat the point
    // of extracting them.
    //
    if (sshConn) {
      tailHandle = tailSessionFile(sshConn, newSessionFile, onLine, onError);
    }
  };

  // Called by the discovery-repoll branch when holdingTicks reaches the
  // timeout without a new sessionFile having appeared. Emits a terminal
  // inactive frame with `reason:"holding_timeout"`, then teardownPane
  // (which stops all pollers, stops the tail, and closes the SSH
  // connection). WS stays open by default so the client renders FALLBACK-01
  // per the existing initial-inactive-exit path (~line 407-423).
  const transitionToDead = (reason: "holding_timeout"): void => {
    const finalSessionFile = currentSessionFile;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "inactive", reason }));
      } catch {
        /* ws may be mid-close */
      }
    }
    // Phase 30 Plan 30-01: terminal inactive from holding-timeout. Reason
    // forwards through as "holding_timeout" (the only current caller).
    paneStateEmitter.emit("inactive", reason);
    sshLogger.info("Claude session dead", {
      operation: "claude_session_dead",
      reason,
      userId,
      sessionId,
      hostId: currentHostId,
      tmuxSession: currentTmuxSession,
      currentSessionFile: finalSessionFile,
    });
    // teardownPane resets changeoverState back to "active" among other
    // things — set `dead` AFTER teardown so the state accurately reflects
    // "terminal, no recovery attempts."
    teardownPane();
    changeoverState = "dead";
  };

  // quick 260813-0qx — shared discovery-repoll timer setup (Option A).
  //
  // Extracted from the inline `discoveryRepollTimer = setInterval(...)` block
  // that used to live inside startActiveSessionFlow (~L4700 pre-refactor).
  // Now both call sites use this single helper:
  //   1. startActiveSessionFlow (steady-state — active session established
  //      on initial attach or via wake-from-dormant handoff).
  //   2. The attach-path reset-window branch inside the initial-attach
  //      inactive block (see below near L~5087) — flips changeoverState
  //      to "holding" then starts the timer here so the /id-reset window
  //      recovery uses the same recovery reducer the steady-state ticker uses.
  //
  // Behavior is byte-preserved for the steady-state site (same closure vars,
  // same helper calls, same interval, same catch/finally shape). The .then()
  // body IS the same code the __applyRepollResultForTests reducer at ~L920
  // covers — no drift.
  //
  // Declared at connection scope AFTER transitionToActiveNew /
  // transitionFromHoldingToActiveSameFile / transitionToDead / transitionToHolding
  // so all closure references are visible. Reads discoveryRepollTimer,
  // discoveryRepollInFlight, currentSessionFile, changeoverState, holdingTicks,
  // stopped, ws, sshConn — the same set the inline block closed over.
  const startDiscoveryRepollTimer = (activeTmuxSession: string): void => {
    discoveryRepollTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (discoveryRepollInFlight) return;
      discoveryRepollInFlight = true;
      const connSnapshot = sshConn;
      discoverClaudeSession(connSnapshot, activeTmuxSession)
        .then((result) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (changeoverState === "dead") return; // idempotent guard

          // Fix A (2026-07-30): hoist isExecErrorTick flag so BOTH the
          // inactive branch (which must not arm holding) and the
          // holdingTicks++ block (which must not burn the timeout budget)
          // can check the same value without duplicating the predicate.
          //
          // exec_error = "we couldn't reliably ask" (SSH-side failure at
          // any of the four SSH-throw sites: queryPanePid, descendant walk,
          // PID-file read, JSONL test). Categorically different from the
          // real-inactive reasons below, which mean "we asked and got a
          // definitive no":
          //   • not_claude            — pane has no claude in its tree
          //   • no_pid_session_file   — claude PID exists but no PID file
          //   • no_open_session_file  — PID file found but JSONL missing
          //   • no_tmux_session       — no tmux pane to query at all
          //   • pid_unavailable       — kept for backcompat; no longer emitted
          // A transient SSH round-trip failure must NOT arm the overlay.
          const isExecErrorTick =
            result.status === "inactive" && result.reason === "exec_error";

          if (result.status === "active") {
            if (result.sessionFile !== currentSessionFile) {
              // File moved: recycle OR recover-in-different-cwd.
              if (changeoverState === "active") {
                // SIGTERM-fallback path: /exit never landed but the file
                // changed. Emit both holding and changed on the SAME tick.
                transitionToHolding("discovery_diff");
              }
              transitionToActiveNew(result.sessionFile);
            } else if (changeoverState === "holding") {
              // Fix B (2026-07-30): same file + still active + we're in holding
              // → the overlay was a false alarm. Self-clear on this repoll tick.
              transitionFromHoldingToActiveSameFile();
            }
            // else: same file + active + changeoverState === "active"
            // — nominal steady-state, no state change needed.
          } else if (!isExecErrorTick) {
            // status === "inactive" with a REAL inactive reason (not an SSH
            // failure). Bare-shell gap during recycle is expected.
            if (changeoverState === "active") {
              transitionToHolding("discovery_diff");
            }
          }
          // else: isExecErrorTick — SSH-side failure; silent tick.
          // Do NOT call transitionToHolding. !isExecErrorTick guard below
          // also prevents burning the holding budget.

          // Fix A (2026-07-30): guard with !isExecErrorTick so transient SSH
          // failures don't burn the 5-min holding budget on no-signal ticks.
          if (changeoverState === "holding" && !isExecErrorTick) {
            holdingTicks++;
            if (holdingTicks >= HOLDING_TIMEOUT_TICKS) {
              transitionToDead("holding_timeout");
            }
          }
        })
        .catch(() => {
          /* Silent — same posture as the context-pct and harness-tasks
             pollers. A discovery failure on one tick shouldn't kill the
             session; the next tick tries again. */
        })
        .finally(() => {
          discoveryRepollInFlight = false;
        });
    }, DISCOVERY_REPOLL_INTERVAL_MS);
  };

  let wsAlive = true;

  ws.on("pong", () => {
    wsAlive = true;
  });

  const wsPingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!wsAlive) {
        sshLogger.warn(
          "Claude session WS pong timeout - terminating",
          {
            operation: "claude_session_ws_error",
            userId,
            sessionId,
          },
        );
        ws.terminate();
        return;
      }
      wsAlive = false;
      ws.ping();
    }
  }, 30000);

  ws.on("close", (code: number, reason: Buffer) => {
    databaseLogger.info(`[ws-server] close userId=${userId ?? 'null'} hostId=${currentHostId ?? 'null'} tmuxSession=${currentTmuxSession ?? 'null'} code=${code} reason="${reason?.toString() ?? ''}"`, { operation: "ws_close" });
    clearInterval(wsPingInterval);
    stopped = true;
    // Phase 50 D-15 cleanup: cancel any pending pv-send-watchdog escalations for
    // mqids armed under this WS connection — prevents paste_send_failed frames
    // firing against a torn-down socket. Warning #5 (checker feedback iteration 1)
    // made this mandatory rather than aspirational. Iterated BEFORE teardownPane
    // so the clear is not gated on any downstream side effect.
    if (pendingMqidsForThisConnection.size > 0) {
      for (const mqid of pendingMqidsForThisConnection) {
        clearPvSendWatchdog(mqid);
      }
      pendingMqidsForThisConnection.clear();
    }
    teardownPane();
    // Phase 41 Plan 04: unlink any orphaned .partial temp files for pretty-
    // view upload batches this WS owned. teardownPane() above already drains
    // ownedUploadBatches for the active pane; this guard handles any batches
    // that started after the last teardownPane (e.g. if upload_start arrived
    // after the most recent pane switch). Mirrors terminal.ts L297-302.
    if (ownedUploadBatches.size > 0) {
      cleanupBatchesForConnection(Array.from(ownedUploadBatches));
      ownedUploadBatches.clear();
    }
    // Phase 14 Wave 2: WS lifetime ended — drop this WS from all module-
    // scope aside state. teardownPane already unregistered this WS from
    // activeViewers[currentSessionKey] (via the per-pane branch), but we
    // defensively iterate here in case any prior state escaped that path
    // (e.g. a bug in a future patch). Cheap: activeViewers is small.
    asideState.delete(ws);
    for (const [key, peers] of activeViewers) {
      if (peers.delete(ws) && peers.size === 0) {
        activeViewers.delete(key);
      }
    }
    sshLogger.info("Claude session WebSocket disconnected", {
      operation: "claude_session_ws_disconnect",
      userId,
      sessionId,
    });
  });

  ws.on("error", (err: Error) => {
    databaseLogger.error(`[ws-server] error userId=${userId ?? 'null'} hostId=${currentHostId ?? 'null'} tmuxSession=${currentTmuxSession ?? 'null'}`, err, { operation: "ws_error" });
    sshLogger.error("Claude session WS error", err, {
      operation: "claude_session_ws_error",
      userId,
      sessionId,
    });
  });

  // quick 260808-dmz: connection-scoped forward reference for startActiveSessionFlow.
  // Assigned on the first connectToPane message (before discovery), so it is
  // in scope when the dormant-poll timer callback fires 3 seconds later even if
  // the message handler returned early via the inactive→dormant branch.
  // Phase 47 Plan 03 Hunk B: widened return type from `void` to
  // `Promise<void> | void` to accommodate the totalLines probe (Plan 03
  // makes the assignment async). Callers use fire-and-forget shape
  // (no `await`) so both the pre-Phase-47 sync path and the Phase 47+
  // async path work uniformly at the call sites.
  // eslint-disable-next-line prefer-const
  let startActiveSessionFlow: (params: {
    pid: number;
    sessionFile: string;
    tmuxSession: string;
    hostId: number;
  }) => Promise<void> | void = () => { /* noop until assigned by connectToPane */ };

  ws.on("message", async (raw: RawData) => {
    // Idempotency guard: once stopped, refuse all traffic.
    if (stopped) {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Connection closing",
          }),
        );
      } catch (err) {
        databaseLogger.warn(`[ws-server] send-failed msgType=error err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" });
      }
      return;
    }

    let msg: { type?: unknown; hostId?: unknown; tmuxSession?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(
        JSON.stringify({ type: "error", message: "Malformed message" }),
      );
      return;
    }

    // Patch #87/#92: identity:list-bounties — read-only bounty fetch, independent
    // of connectToPane. Patch #92: routes via identity-artifact-reader.ts helper;
    // local branch when hostId is in IDENTITIES_LOCAL_HOST_IDS, SSH branch otherwise.
    if (msg.type === "identity:list-bounties") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(
            JSON.stringify({
              type: "identity:bounties",
              bounties: [],
              archivedBounties: [],
              error: "invalid identityKey",
            }),
          );
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounties err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];

        if (useLocal) {
          // LOCAL branch — bind-mount fast-path (patch #89, preserved byte-for-byte)
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:list-bounties", {
            operation: "identity_list_bounties",
            userId,
            identityKey,
            hostId: hostIdNum,
            useLocal: true,
            openCount: bounties.length,
            archivedCount: archivedBounties.length,
          });
        } else {
          // REMOTE branch — SSH to the pane's host
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try {
              ws.send(JSON.stringify({ type: "identity:bounties", bounties: [], archivedBounties: [], error: "host not found" }));
            } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounties err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:list-bounties", {
              operation: "identity_list_bounties",
              userId,
              identityKey,
              hostId: hostIdNum,
              useLocal: false,
              openCount: bounties.length,
              archivedCount: archivedBounties.length,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }

        try {
          ws.send(JSON.stringify({ type: "identity:bounties", bounties, archivedBounties }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounties err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:list-bounties unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_list_bounties_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(
            JSON.stringify({
              type: "identity:bounties",
              bounties: [],
              archivedBounties: [],
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounties err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Quick 260727-tb1: identity:count-bounties — batched pinned bounty
    // counter powering the per-row bounty badge in pretty-conversations.
    // ONE WS request carrying [{identityKey, hostId}, ...]; ONE response
    // carrying [{identityKey, hostId, pinnedCount, error?}, ...].
    //
    // Design decisions the tests lock in:
    //   1. Targets are grouped by hostId. Local group (hostId=null OR in
    //      IDENTITIES_LOCAL_HOST_IDS) reads via the bind-mount branch —
    //      no SSH connection needed.
    //   2. Each non-local hostId opens EXACTLY ONE SshConnection via
    //      connectOneShot; every identity in that hostId's group is read
    //      through that single conn; conn.end() runs in try/finally.
    //   3. Every per-target read is wrapped in Promise.allSettled — one
    //      slow or dead SSH host does not block the batch.
    //   4. Rejected reads surface as {pinnedCount:0, error:string};
    //      successful reads omit the error field. Zero-with-error keeps
    //      the wire shape uniform.
    if (msg.type === "identity:count-bounties") {
      await handleIdentityCountBounties(ws, msg, userId);
      return;
    }

    // Patch #17g/#92: identity:get-identity-file — read <identityKey>/<identityKey>.md as markdown.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:get-identity-file") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:identity-file", markdown: "", error: "invalid identityKey" }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let markdown: string;
        if (useLocal) {
          ({ markdown } = await readIdentityFile(null, identityKey));
          sshLogger.info("identity:get-identity-file", {
            operation: "identity_get_identity_file",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: markdown.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:identity-file", markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ markdown } = await readIdentityFile(conn, identityKey));
            sshLogger.info("identity:get-identity-file", {
              operation: "identity_get_identity_file",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: markdown.length,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:identity-file", markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-identity-file error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_identity_file_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:identity-file", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Phase 22 SRIC-06 / Plan 22-06: identity:get-role-file — byte-shape mirror
    // of identity:get-identity-file above. Delegates to handleIdentityGetRoleFile
    // (exported for tests) so the entire byte-shape mirror body is a single
    // audit surface. See handler prologue at the module-scope function below.
    if (msg.type === "identity:get-role-file") {
      await handleIdentityGetRoleFile(ws, msg, userId);
      return;
    }

    // Patch #17g/#92: identity:get-history — read history.md; reverse lines for most-recent-first.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:get-history") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:history", entries: [], error: "invalid identityKey" }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let entries: string[];
        let markdown: string;
        if (useLocal) {
          ({ entries, markdown } = await readIdentityHistory(null, identityKey));
          sshLogger.info("identity:get-history", {
            operation: "identity_get_history",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: entries.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:history", entries: [], markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ entries, markdown } = await readIdentityHistory(conn, identityKey));
            sshLogger.info("identity:get-history", {
              operation: "identity_get_history",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: entries.length,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        // Phase 18 / IDMEDIT-02: emit markdown alongside entries so HistoryTab
        // can populate its textarea editor without a separate raw-file fetch.
        try { ws.send(JSON.stringify({ type: "identity:history", entries, markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-history error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_history_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:history", entries: [], markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Patch #17g/#92: identity:list-wakeups — enumerate wakeups/*.json and humanize each schedule.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:list-wakeups") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:wakeups", wakeups: [], error: "invalid identityKey" }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeups err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let wakeups: { name: string; enabled: boolean; scheduleHuman: string; instruction: string }[];
        if (useLocal) {
          ({ wakeups } = await readIdentityWakeups(null, identityKey));
          sshLogger.info("identity:list-wakeups", {
            operation: "identity_list_wakeups",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: wakeups.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:wakeups", wakeups: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeups err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ wakeups } = await readIdentityWakeups(conn, identityKey));
            sshLogger.info("identity:list-wakeups", {
              operation: "identity_list_wakeups",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: wakeups.length,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:wakeups", wakeups })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeups err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:list-wakeups unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_list_wakeups_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:wakeups", wakeups: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeups err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Patch #154: identity:update-wakeup — patch a single wakeups/<slug>.json
    // (enabled and/or schedule) and return the fresh list so the modal can
    // atomically re-render. Same local/SSH routing as list-wakeups.
    //
    // Quick 260731-2pa: `updates` widened to also accept `name` (non-empty
    // string) and `instruction` (string). Backs the form-based editor in
    // WakeupsTab.tsx which writes the full spec on Save. Filter, validate,
    // and thread each field into `filtered` the same way enabled/schedule
    // already do; the `no updates` guard now considers all four.
    if (msg.type === "identity:update-wakeup") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; wakeupSlug?: unknown; updates?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.wakeupSlug;
      const rawUpdates = raw.updates;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "invalid wakeup slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawUpdates !== "object" || rawUpdates === null) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "invalid updates" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const wakeupSlug = rawSlug;
      const updates = rawUpdates as { enabled?: unknown; schedule?: unknown; name?: unknown; instruction?: unknown };
      const filtered: { enabled?: boolean; schedule?: unknown; name?: string; instruction?: string } = {};
      if (updates.enabled !== undefined) {
        if (typeof updates.enabled !== "boolean") {
          try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "enabled must be boolean" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
          return;
        }
        filtered.enabled = updates.enabled;
      }
      if (updates.schedule !== undefined) {
        filtered.schedule = updates.schedule;
      }
      if (updates.name !== undefined) {
        if (typeof updates.name !== "string" || updates.name.length === 0) {
          try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "name must be a non-empty string" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
          return;
        }
        filtered.name = updates.name;
      }
      if (updates.instruction !== undefined) {
        if (typeof updates.instruction !== "string") {
          try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "instruction must be a string" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
          return;
        }
        filtered.instruction = updates.instruction;
      }
      if (filtered.enabled === undefined && filtered.schedule === undefined && filtered.name === undefined && filtered.instruction === undefined) {
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "no updates" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let wakeups: Awaited<ReturnType<typeof readIdentityWakeups>>["wakeups"];
        if (useLocal) {
          await writeIdentityWakeupUpdate(null, identityKey, wakeupSlug, filtered);
          ({ wakeups } = await readIdentityWakeups(null, identityKey));
          sshLogger.info("identity:update-wakeup", {
            operation: "identity_update_wakeup",
            userId, identityKey, wakeupSlug, hostId: hostIdNum, useLocal: true,
            fields: Object.keys(filtered).join(","),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityWakeupUpdate(conn, identityKey, wakeupSlug, filtered);
            ({ wakeups } = await readIdentityWakeups(conn, identityKey));
            sshLogger.info("identity:update-wakeup", {
              operation: "identity_update_wakeup",
              userId, identityKey, wakeupSlug, hostId: hostIdNum, useLocal: false,
              fields: Object.keys(filtered).join(","),
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-wakeup unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_wakeup_error", userId, identityKey, wakeupSlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:wakeup-updated", wakeups: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:wakeup-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Phase 18 / IDMEDIT-06: identity:update-identity-file — full-overwrite
    // <key>/<key>.md via SFTP tmp+rename (REMOTE) or fs tmp+rename (LOCAL).
    // After write, re-reads the file via readIdentityFile so the client
    // rehydrates from server-side truth. Mirror of identity:update-wakeup.
    if (msg.type === "identity:update-identity-file") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
      const rawKey = raw.identityKey;
      const rawContents = raw.contents;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawContents !== "string") {
        try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: "contents must be a string" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const contents = rawContents;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let markdown: string;
        if (useLocal) {
          await writeIdentityFile(null, identityKey, contents);
          ({ markdown } = await readIdentityFile(null, identityKey));
          sshLogger.info("identity:update-identity-file", {
            operation: "identity_update_identity_file",
            userId, identityKey, hostId: hostIdNum, useLocal: true,
            bytes: Buffer.byteLength(contents, "utf-8"),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityFile(conn, identityKey, contents);
            ({ markdown } = await readIdentityFile(conn, identityKey));
            sshLogger.info("identity:update-identity-file", {
              operation: "identity_update_identity_file",
              userId, identityKey, hostId: hostIdNum, useLocal: false,
              bytes: Buffer.byteLength(contents, "utf-8"),
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-identity-file unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_identity_file_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:identity-file-updated", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:identity-file-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Phase 22 SRIC-06 / Plan 22-06: identity:update-role-file — byte-shape
    // mirror of identity:update-identity-file above. Delegates to
    // handleIdentityUpdateRoleFile (exported for tests). See handler prologue
    // at the module-scope function below.
    if (msg.type === "identity:update-role-file") {
      await handleIdentityUpdateRoleFile(ws, msg, userId);
      return;
    }

    // Phase 18 / IDMEDIT-06: identity:update-history — full-overwrite
    // <key>/history.md. After write, re-reads via readIdentityHistory so the
    // client receives parsed entries (mirrors HistoryTab's existing wire shape).
    if (msg.type === "identity:update-history") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
      const rawKey = raw.identityKey;
      const rawContents = raw.contents;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawContents !== "string") {
        try { ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], error: "contents must be a string" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const contents = rawContents;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let entries: string[];
        let markdown: string;
        if (useLocal) {
          await writeIdentityHistory(null, identityKey, contents);
          ({ entries, markdown } = await readIdentityHistory(null, identityKey));
          sshLogger.info("identity:update-history", {
            operation: "identity_update_history",
            userId, identityKey, hostId: hostIdNum, useLocal: true,
            bytes: Buffer.byteLength(contents, "utf-8"),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityHistory(conn, identityKey, contents);
            ({ entries, markdown } = await readIdentityHistory(conn, identityKey));
            sshLogger.info("identity:update-history", {
              operation: "identity_update_history",
              userId, identityKey, hostId: hostIdNum, useLocal: false,
              bytes: Buffer.byteLength(contents, "utf-8"),
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        // Phase 18 / IDMEDIT-02: echo both entries and markdown so HistoryTab
        // rehydrates the textarea from server truth after Save.
        try { ws.send(JSON.stringify({ type: "identity:history-updated", entries, markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-history unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_history_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:history-updated", entries: [], markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:history-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Phase 18 / IDMEDIT-06: identity:update-handoff — full-overwrite
    // <key>/handoff.md. After write, re-reads via readIdentityHandoff so the
    // client rehydrates from server-side truth.
    if (msg.type === "identity:update-handoff") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; contents?: unknown };
      const rawKey = raw.identityKey;
      const rawContents = raw.contents;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawContents !== "string") {
        try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: "contents must be a string" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const contents = rawContents;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let markdown: string;
        if (useLocal) {
          await writeIdentityHandoff(null, identityKey, contents);
          ({ markdown } = await readIdentityHandoff(null, identityKey));
          sshLogger.info("identity:update-handoff", {
            operation: "identity_update_handoff",
            userId, identityKey, hostId: hostIdNum, useLocal: true,
            bytes: Buffer.byteLength(contents, "utf-8"),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityHandoff(conn, identityKey, contents);
            ({ markdown } = await readIdentityHandoff(conn, identityKey));
            sshLogger.info("identity:update-handoff", {
              operation: "identity_update_handoff",
              userId, identityKey, hostId: hostIdNum, useLocal: false,
              bytes: Buffer.byteLength(contents, "utf-8"),
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-handoff unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_handoff_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:handoff-updated", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Quick 260727-wd0: identity:archive-bounty — sibling of the v0b status
    // handler below on the archive axis. Server decides the new status
    // internally (flip live→done, or preserve done/dropped), tmp+rename
    // patches bounty.json at the CURRENT (open) path, then mv's
    // bounties/<slug>/ under bounties/archive/<slug>/ (mkdir -p archive/
    // if absent). Returns the fresh bounty lists so the modal atomically
    // re-renders — the archived bounty moves from `bounties` to
    // `archivedBounties`. No client-supplied status field: semantics are
    // fully server-locked per PLAN.md § Semantics.
    if (msg.type === "identity:archive-bounty") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-archived err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-archived err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await archiveIdentityBounty(null, identityKey, bountySlug);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:archive-bounty", {
            operation: "identity_archive_bounty",
            userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-archived err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await archiveIdentityBounty(conn, identityKey, bountySlug);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:archive-bounty", {
              operation: "identity_archive_bounty",
              userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-archived err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:archive-bounty unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_archive_bounty_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-archived", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-archived err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Quick 260729-g5r / patch #183: identity:delete-bounty — byte-shape
    // mirror of the archive handler above but with rm -rf semantics
    // (no JSON patch, no timeline entry, no status flip, no folder move).
    // Applies to BOTH open AND archived cards — the writer rm's both
    // candidate paths with force:true so one call covers both locations.
    // Returns fresh {bounties, archivedBounties} so the modal atomically
    // re-renders and the deleted card unmounts naturally when its slug
    // drops out of both lists. window.confirm() gate lives in BountyCard.
    if (msg.type === "identity:delete-bounty") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-deleted err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-deleted err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await deleteIdentityBounty(null, identityKey, bountySlug);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:delete-bounty", {
            operation: "identity_delete_bounty",
            userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-deleted err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await deleteIdentityBounty(conn, identityKey, bountySlug);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:delete-bounty", {
              operation: "identity_delete_bounty",
              userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-deleted err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:delete-bounty unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_delete_bounty_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-deleted", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-deleted err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Quick 260727-v0b: identity:update-bounty-status — byte-shape mirror of
    // the priority handler below for the `status` field. Server patches
    // bounty.json IN PLACE (folder NOT moved even when transitioning to/from
    // done/dropped) and returns the fresh bounty lists so the modal can
    // atomically re-render. Editable for ALL bounties including archived —
    // that IS the resurrect flow (click "pinned" on a done/dropped card to
    // pull it back into working set).
    if (msg.type === "identity:update-bounty-status") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; status?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawStatus = raw.status;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-status-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-status-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawStatus !== "string" || !(BOUNTY_STATUS_VALUES as readonly string[]).includes(rawStatus)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "invalid status" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-status-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const status = rawStatus as BountyStatus;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyStatus(null, identityKey, bountySlug, status);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-status", {
            operation: "identity_update_bounty_status",
            userId, identityKey, bountySlug, status, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-status-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyStatus(conn, identityKey, bountySlug, status);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-status", {
              operation: "identity_update_bounty_status",
              userId, identityKey, bountySlug, status, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-status-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-status unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_status_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-status-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-status-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Quick 260728-sqk / patch #172: identity:update-bounty-pinned —
    // byte-shape mirror of the status handler above for the `pinned` boolean
    // field. Post-Nelly-fleet-migration (#168, 2026-07-28), `pinned` is an
    // independent boolean orthogonal to lifecycle `status`. Server patches
    // bounty.json IN PLACE (folder NOT moved) and returns the fresh bounty
    // lists so the modal can atomically re-render. Editable for ALL bounties
    // including archived — unpinning an archived pinned bounty stays legal
    // and re-pinning is the resurrect signal on the pinned axis.
    if (msg.type === "identity:update-bounty-pinned") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; pinned?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawPinned = raw.pinned;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-pinned-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-pinned-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawPinned !== "boolean") {
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "invalid pinned" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-pinned-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const pinned = rawPinned;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyPinned(null, identityKey, bountySlug, pinned);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-pinned", {
            operation: "identity_update_bounty_pinned",
            userId, identityKey, bountySlug, pinned, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-pinned-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyPinned(conn, identityKey, bountySlug, pinned);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-pinned", {
              operation: "identity_update_bounty_pinned",
              userId, identityKey, bountySlug, pinned, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-pinned-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-pinned unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_pinned_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-pinned-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-pinned-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // This quick: identity:update-bounty-needs-desk — byte-shape mirror of the
    // pinned handler above for the parallel `needs_desk` boolean field. User-
    // reserved flag independent of both `status` and `pinned`. Server patches
    // bounty.json IN PLACE (folder NOT moved) and returns fresh bounty lists
    // so the modal atomically re-renders. Editable for ALL bounties including
    // archived.
    if (msg.type === "identity:update-bounty-needs-desk") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; needs_desk?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawNeedsDesk = raw.needs_desk;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-needs-desk-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-needs-desk-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-needs-desk-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-needs-desk-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawNeedsDesk !== "boolean") {
        try { ws.send(JSON.stringify({ type: "identity:bounty-needs-desk-updated", bounties: [], archivedBounties: [], error: "invalid needs_desk" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-needs-desk-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const needsDesk = rawNeedsDesk;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyNeedsDesk(null, identityKey, bountySlug, needsDesk);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-needs-desk", {
            operation: "identity_update_bounty_needs_desk",
            userId, identityKey, bountySlug, needsDesk, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-needs-desk-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-needs-desk-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyNeedsDesk(conn, identityKey, bountySlug, needsDesk);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-needs-desk", {
              operation: "identity_update_bounty_needs_desk",
              userId, identityKey, bountySlug, needsDesk, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-needs-desk-updated", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-needs-desk-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-needs-desk unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_needs_desk_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-needs-desk-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-needs-desk-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Phase 18 / IDMEDIT-04: identity:update-bounty-fields — partial-JSON-patch
    // writer for bounty fields. Accepts title/premise/todos/keywords/source_links/
    // deadline/meeting_questions; rejects pinned (has its own handler). Per-field
    // validation runs inside writeIdentityBountyFields — handler only validates the
    // top-level shape. Returns fresh {bounties, archivedBounties} so BountyCard
    // rehydrates from server truth (same convention as the priority/status/pinned echoes).
    if (msg.type === "identity:update-bounty-fields") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; patch?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawPatch = raw.patch;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-fields-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-fields-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawPatch !== "object" || rawPatch === null) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "invalid patch" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-fields-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      // Per-field type validation (title length, todos shape, etc.) runs inside
      // writeIdentityBountyFields. Handler-level check only ensures patch is an object.
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const patch = rawPatch as BountyFieldsPatch;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyFields(null, identityKey, bountySlug, patch);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-fields", {
            operation: "identity_update_bounty_fields",
            userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: true,
            fields: Object.keys(patch).join(","),
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-fields-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyFields(conn, identityKey, bountySlug, patch);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-fields", {
              operation: "identity_update_bounty_fields",
              userId, identityKey, bountySlug, hostId: hostIdNum, useLocal: false,
              fields: Object.keys(patch).join(","),
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-fields-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-fields unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_fields_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-fields-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-fields-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Patch #154: identity:update-bounty-priority — patch bounty.json's
    // priority field, bump updated_at, append a timeline line. Returns the
    // fresh bounty lists so the modal can atomically re-render.
    if (msg.type === "identity:update-bounty-priority") {
      const raw = msg as { identityKey?: unknown; hostId?: unknown; bountySlug?: unknown; priority?: unknown };
      const rawKey = raw.identityKey;
      const rawSlug = raw.bountySlug;
      const rawPriority = raw.priority;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "invalid identityKey" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-priority-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawSlug !== "string" || !IDENTITY_SLUG_RE.test(rawSlug)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "invalid bounty slug" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-priority-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      if (typeof rawPriority !== "string" || !(BOUNTY_PRIORITY_VALUES as readonly string[]).includes(rawPriority)) {
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "invalid priority" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-priority-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const bountySlug = rawSlug;
      const priority = rawPriority as BountyPriority;
      const rawHostId = raw.hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);
      try {
        let bounties: unknown[];
        let archivedBounties: unknown[];
        if (useLocal) {
          await writeIdentityBountyPriority(null, identityKey, bountySlug, priority);
          ({ bounties, archivedBounties } = await readIdentityBounties(null, identityKey));
          sshLogger.info("identity:update-bounty-priority", {
            operation: "identity_update_bounty_priority",
            userId, identityKey, bountySlug, priority, hostId: hostIdNum, useLocal: true,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-priority-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            await writeIdentityBountyPriority(conn, identityKey, bountySlug, priority);
            ({ bounties, archivedBounties } = await readIdentityBounties(conn, identityKey));
            sshLogger.info("identity:update-bounty-priority", {
              operation: "identity_update_bounty_priority",
              userId, identityKey, bountySlug, priority, hostId: hostIdNum, useLocal: false,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties, archivedBounties })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-priority-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err) {
        sshLogger.error(
          "identity:update-bounty-priority unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_update_bounty_priority_error", userId, identityKey, bountySlug, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:bounty-priority-updated", bounties: [], archivedBounties: [], error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:bounty-priority-updated err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Patch #17g/#92: identity:get-handoff — read handoff.md as markdown.
    // Patch #92: routes via helper; local branch for local hosts, SSH branch for remote hosts.
    if (msg.type === "identity:get-handoff") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      if (typeof rawKey !== "string" || !IDENTITY_KEY_RE.test(rawKey)) {
        try {
          ws.send(JSON.stringify({ type: "identity:handoff", markdown: "", error: "invalid identityKey" }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        return;
      }
      const identityKey = rawKey;
      const rawHostId = (msg as { type: unknown; hostId?: unknown }).hostId;
      const hostIdNum =
        typeof rawHostId === "number" && Number.isFinite(rawHostId) && rawHostId > 0
          ? rawHostId
          : undefined;
      const useLocal = hostIdNum === undefined || isLocalHostId(hostIdNum);

      try {
        let markdown: string;
        if (useLocal) {
          ({ markdown } = await readIdentityHandoff(null, identityKey));
          sshLogger.info("identity:get-handoff", {
            operation: "identity_get_handoff",
            userId, identityKey, hostId: hostIdNum, useLocal: true, payloadSize: markdown.length,
          });
        } else {
          const resolved = await resolveHostById(hostIdNum!, userId!);
          if (!resolved) {
            try { ws.send(JSON.stringify({ type: "identity:handoff", markdown: "", error: "host not found" })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
            return;
          }
          const conn = await connectOneShot(resolved as unknown as Parameters<typeof connectOneShot>[0], 5000);
          try {
            ({ markdown } = await readIdentityHandoff(conn, identityKey));
            sshLogger.info("identity:get-handoff", {
              operation: "identity_get_handoff",
              userId, identityKey, hostId: hostIdNum, useLocal: false, payloadSize: markdown.length,
            });
          } finally {
            try { conn.end(); } catch (err) { databaseLogger.warn(`[ws-server] conn-end-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" }); }
          }
        }
        try { ws.send(JSON.stringify({ type: "identity:handoff", markdown })); } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      } catch (err: unknown) {
        sshLogger.error(
          "identity:get-handoff error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_get_handoff_error", userId, identityKey, hostId: hostIdNum },
        );
        try {
          ws.send(JSON.stringify({ type: "identity:handoff", markdown: "", error: err instanceof Error ? err.message : String(err) }));
        } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=identity:handoff err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
      }
      return;
    }

    // Phase 14 Wave 2: aside_arm — the SOLE trigger source per CONTEXT.md
    // § Trigger lock (2026-07-26). Frontend PrettyView WS-sends this on
    // the `isIdle:false -> true` transition when `pvIdentity !== null`.
    // The backend does NOT gate identity (delegated to the frontend) and
    // does NOT observe the terminal WSS's idle-signal frame (that runs
    // on port 30002 in a separate closure with no shared state). If a WS
    // sends aside_arm, backend arms — trust boundary is frontend-owned.
    //
    // v1 overlap policy (ASIDE-08): if this WS's state has `armed` OR
    // `displayed` set, the incoming aside_arm is a no-op — no re-inject
    // of /btw while an aside is armed OR displayed. Bounds the tmux
    // send-keys rate to ONE /btw per aside-cycle-completion per WS.
    if (msg.type === "aside_arm") {
      const state = asideState.get(ws);
      if (!state) return; // defensive — asideState.set(ws) fires at connect init
      if (state.armed || state.displayed) return; // overlap-ignore gate
      if (!sshConn || !currentTmuxSession) return; // no pane bound yet
      state.armed = true;
      lastStableCapture = null;
      hadMarkerLastCapture = false;
      sshLogger.info("aside poll diag: armed", {
        hostId: currentHostId,
        tmuxSession: currentTmuxSession,
      });
      // injectBtw log-and-swallows internally; do NOT roll back state.armed
      // on failure — the poller's disarm-on-emit path handles the "no
      // answer arrived" case, and a stuck armed flag clears on next
      // dismiss cycle. Keeps the dispatch simple.
      await injectBtw(sshConn, currentTmuxSession);
      return;
    }

    // Phase 14 Wave 2: aside_dismissed — client clicked the X (Resume)
    // affordance on ComposeBox. Send Escape into the pane's tmux to close
    // the BTW overlay, then broadcast the dismiss to all peer WSes on the
    // same session so cross-tab tabs also clear their aside display.
    //
    // Per T-14-02-01 mitigation: we IGNORE msg.hostId / msg.tmuxSession
    // for send-keys routing. The connection's own captured
    // currentHostId / currentTmuxSession is the trusted source (set at
    // connectToPane discovery success). Client-supplied fields cannot
    // spoof a dismiss for a session the client doesn't own.
    //
    // Do NOT set asideState.get(ws).armed = false here — the poller's
    // marker-disappearance path (or the extract-and-emit path) owns that.
    // broadcastAsideDismissed flips this ws's `displayed=false` (since
    // this ws IS in its own activeViewers set) and all peers' atomically.
    if (msg.type === "aside_dismissed") {
      if (sshConn && currentTmuxSession) {
        await dismissBtw(sshConn, currentTmuxSession);
      }
      if (currentHostId != null && currentTmuxSession != null) {
        broadcastAsideDismissed(sessionKey(currentHostId, currentTmuxSession));
      }
      return;
    }

    // Phase 24 Plan 03: raw_keystrokes — one-shot PTY write for plan-mode
    // Approve ("1\r") + Feedback ("3<text>\r"). Deliberately NOT the
    // ComposeBox split-send path (patch #44's body+\r-with-60ms-gap) — Ink
    // Plan Mode does NOT recognize split-send as a keystroke selection
    // (PlanPendingBubble.tsx L14-21 lesson; verified by Ashley 2026-07-18).
    // `tmux send-keys -l` (literal flag) prevents a leading `1`, `3`, or
    // `\r` inside the payload from being interpreted as a tmux key-name.
    //
    // Trust boundary (mirrors aside_dismissed T-14-02-01): the send target
    // is derived from the connection's captured currentTmuxSession (set on
    // connectToPane discovery success). We IGNORE any client-supplied
    // hostId/tmuxSession in the payload — a client cannot spoof a raw
    // keystroke into a pane it doesn't own.
    if (msg.type === "raw_keystrokes") {
      if (!sshConn || !currentTmuxSession) return;
      const bytes = String((msg as { bytes?: unknown }).bytes ?? "");
      if (bytes.length === 0) return;
      // WR-03 fix: cap the payload size before it hits `tmux send-keys -l`.
      // A misbehaving/buggy client (or forced payload) with a multi-megabyte
      // feedback string would otherwise flow straight to a single-argv shell
      // command that guaranteed-fails at POSIX ARG_MAX, wasting a channel
      // open + a serialize pass. 16KB is comfortably above any legitimate
      // plan-approval feedback (Claude Code's own input is smaller).
      const MAX_RAW_KEYSTROKES_BYTES = 16 * 1024;
      if (bytes.length > MAX_RAW_KEYSTROKES_BYTES) {
        sshLogger.warn("raw_keystrokes rejected: payload too large", {
          operation: "raw_keystrokes_reject_size",
          hostId: currentHostId,
          tmuxSession: currentTmuxSession,
          bytesLength: bytes.length,
          maxBytes: MAX_RAW_KEYSTROKES_BYTES,
        });
        return;
      }
      try {
        await execCommand(
          sshConn,
          `tmux send-keys -l -t ${shellQuote(currentTmuxSession)} ${shellQuote(bytes)}`,
        );
      } catch (err) {
        // Log but do not throw — the bubble stays mounted and the user can
        // retry via the pane keyboard directly. Fail-quietly here matches
        // the injectBtw / dismissBtw posture (they also log-and-swallow).
        sshLogger.warn("raw_keystrokes send failed", {
          operation: "raw_keystrokes_send_error",
          hostId: currentHostId,
          tmuxSession: currentTmuxSession,
          bytesLength: bytes.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // Phase 47 Plan 03 Hunk D: load-more button — client asks for a
    // bounded slice of older JSONL lines. Placed here (alongside
    // raw_keystrokes) because both are pane-scoped WS requests that
    // require connection-scoped SSH + session state. The handler
    // (handleFetchOlderRange ~L900) validates payload shape+bounds,
    // enforces the T-47-09 trust boundary (reads currentSessionFile
    // from closure scope, never from msg), and emits a single
    // `fetch_older_range_batch` response frame.
    if (msg.type === "fetch_older_range") {
      await handleFetchOlderRange(ws, msg, {
        sshConn,
        currentSessionFile,
        currentHostId,
        // Phase 50 Plan 01 Task 2 — thread the JSONL session UUID so
        // the parser's queue-operation branch derives the same
        // deterministic eventId shape as the streaming-tail dispatch.
        sessionIdFromFile,
      });
      return;
    }

    // Phase 35 — pretty-view compose-send owns its own WebSocket instead of
    // borrowing the terminal SSH WS (see bounty: terminal-ws-silent-death-on-session-return).
    //
    // `input` handler: accepts the same payload shape as terminal.ts:499's split-send gate
    // ({ type: "input", data: string, messageQueueItemId?: string }) and replicates the
    // split-send semantics via tmux send-keys:
    //   - Split-send (mqid non-empty + data ends in \r): body write → 250ms → Enter write.
    //   - Non-split (no mqid OR no trailing \r): one send-keys -l call.
    // Citation: 250ms delay from src/backend/ssh/terminal.ts:842, patch #111.
    //
    // Trust boundary (mirrors aside_dismissed T-14-02-01): the send target
    // is derived from the connection's captured currentTmuxSession (set on
    // connectToPane discovery success). We IGNORE any client-supplied
    // hostId/tmuxSession in the payload — a client cannot spoof an input
    // frame into a pane it doesn't own.
    if (msg.type === "input") {
      // Phase 50 Plan 02 Task 2 — wire the signal-driven send watchdog into
      // the production input handler. sessionId comes from the connection-
      // scoped sessionIdFromFile (set on connectToPane discovery success);
      // wsSend is a WS-OPEN-guarded JSON.stringify shim; armWatchdog is the
      // real module export; trackMqid records into the per-connection
      // pendingMqidsForThisConnection Set (iterated on ws.on("close") for
      // orphan-frame prevention — T-50-02-06 mitigation).
      await __applyInputMessageForTests({
        sshConn,
        currentTmuxSession,
        currentHostId,
        execCommand,
        data: String((msg as { data?: unknown }).data ?? ""),
        messageQueueItemId: String((msg as { messageQueueItemId?: unknown }).messageQueueItemId ?? "") || undefined,
        sessionId: sessionIdFromFile ?? undefined,
        wsSend: (frame: object) => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify(frame));
            } catch {
              /* ws may be mid-close; drop */
            }
          }
        },
        armWatchdog: armPvSendWatchdog,
        trackMqid: (mqid: string) => {
          pendingMqidsForThisConnection.add(mqid);
        },
      });
      return;
    }

    // Phase 35 — pretty-view owns its own safety-valve Ctrl-C after migrating off the
    // borrowed terminal WS. Original Ctrl-C was patch #120 on terminal WS (Terminal.tsx:3300-3311).
    //
    // Trust boundary (mirrors T-14-02-01): target pane derived exclusively from
    // connection-scoped currentTmuxSession. Client-supplied hostId/tmuxSession IGNORED.
    // Ancestor: Terminal.tsx:3300-3311 (patch #120).
    if (msg.type === "interrupt") {
      await __applyInterruptMessageForTests({
        sshConn,
        currentTmuxSession,
        currentHostId,
        execCommand,
      });
      return;
    }

    // quick 260808-cd6 — wake message: client -> server sentinel delete.
    // Guard: require currentTmuxSession + sshConn + isIdentityShapedCached === true
    // (T-cd6-01: backend ignores any hostId/tmuxSession in the payload and uses
    // only connection-scoped currentTmuxSession set at connectToPane discovery).
    // (T-cd6-02: single-quote wrap on escapedName; already validated to safe subset).
    // (T-cd6-03: path hard-coded to ~/.claude/identities/<name>/.dormant).
    // Does NOT try to fast-poke the supervisor; next CHECK_INTERVAL tick picks it up.
    if (msg.type === "wake") {
      // quick 260808-fgf: intercept wsSend to detect a successful wake_result
      // and record wakeTriggerTs at the moment the rm -f exec succeeded.
      // We wrap wsSend (not the seam itself) so __applyWakeMessageForTests's
      // signature contract (Tests E/F/K) is preserved unchanged.
      let lastWakeOk = false;
      await __applyWakeMessageForTests({
        sshConn,
        currentTmuxSession,
        isIdentityShapedCached,
        execCommand,
        wsSend: (data: string) => {
          try {
            const frame = JSON.parse(data);
            if (frame.type === "wake_result" && frame.ok === true) {
              lastWakeOk = true;
            }
          } catch { /* ignore parse failures — still forward the frame */ }
          try { ws.send(data); } catch (err) { databaseLogger.warn(`[ws-server] send-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
        },
      });
      if (lastWakeOk) {
        wakeTriggerTs = Date.now();
      }
      return;
    }

    // Phase 41 Plan 04: pretty-view upload dispatch — ported verbatim from
    // src/backend/ssh/terminal.ts's upload_start/upload_chunk/upload_abort cases
    // (removed from terminal.ts as part of this plan). The receiving WebSocket
    // is now PrettyView's own claude-session WS (port 30011) rather than the
    // Terminal SSH WS (port 30002). The reusable handler module (pretty-view-upload.ts)
    // is unchanged — it takes UploadDeps { sshConn, ws, userId, currentSessionId }
    // and emits the same server-to-client events. Wire protocol is byte-identical.
    //
    // Trust boundary: this WS is already JWT-authenticated (JWT verified at L1528,
    // userId + sessionId extracted before ANY message dispatch). The T-05-07 guard
    // inside pretty-view-upload.ts silently no-ops if sshConn is null (upload_*
    // received before connectToPane completed).
    // Phase 41 code-review M1: upload dispatch extracted to
    // `dispatchUploadMessage` (module-scope) so the test seam
    // `__dispatchUploadMessageForTests` exercises the same code path
    // production runs. Logging stays inline here because the dispatcher
    // is intentionally logger-free — production emits per-branch
    // diagnostics with full sshLogger/sessionId context; tests skip logs.
    if (
      msg.type === "upload_start" ||
      msg.type === "upload_chunk" ||
      msg.type === "upload_abort"
    ) {
      const uploadDeps = {
        sshConn,
        ws,
        userId,
        currentSessionId: sessionId ?? null,
      };
      if (msg.type === "upload_start") {
        const uploadStart = msg as unknown as UploadStartPayload;
        sshLogger.info("claude-session upload_start", {
          operation: "claude_session_upload_start",
          userId,
          sessionId,
          messageQueueItemId: uploadStart.messageQueueItemId,
          hasSshConn: !!sshConn,
        });
      } else if (msg.type === "upload_chunk") {
        const uploadChunk = msg as unknown as UploadChunkPayload;
        // Snapshot pending presence BEFORE dispatch — dispatchUploadMessage
        // may await the pending promise, and we want the diagnostic to
        // reflect the state at the dispatch instant.
        const chunkMqid = uploadChunk.messageQueueItemId;
        const hasPending =
          typeof chunkMqid === "string" &&
          chunkMqid.length > 0 &&
          pendingStarts.has(chunkMqid);
        sshLogger.debug?.("claude-session upload_chunk", {
          operation: "claude_session_upload_chunk",
          userId,
          sessionId,
          messageQueueItemId: chunkMqid,
          offset: uploadChunk.offset,
          hasPending,
        });
      } else {
        const uploadAbort = msg as unknown as UploadAbortPayload;
        sshLogger.info("claude-session upload_abort", {
          operation: "claude_session_upload_abort",
          userId,
          sessionId,
          messageQueueItemId: uploadAbort.messageQueueItemId,
          tempId: uploadAbort.tempId ?? null,
        });
      }
      // Dispatch — the same function the __dispatchUploadMessageForTests
      // seam calls. Await so upload_chunk's pending-parent race guard
      // completes before we return control to the WS message loop (the
      // dispatcher awaits internally for chunk).
      await dispatchUploadMessage(
        msg,
        uploadDeps,
        ownedUploadBatches,
        pendingStarts,
      );
      return;
    }

    if (msg.type !== "connectToPane") {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unknown message type: " + String(msg.type),
        }),
      );
      return;
    }

    const hostId = msg.hostId;
    const tmuxSession = msg.tmuxSession;
    if (
      typeof hostId !== "number" ||
      !Number.isFinite(hostId) ||
      hostId <= 0 ||
      typeof tmuxSession !== "string" ||
      tmuxSession.length === 0
    ) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "connectToPane requires hostId and tmuxSession",
        }),
      );
      return;
    }

    databaseLogger.info(`[session-server] attach hostId=${hostId} tmuxSession=${tmuxSession} userId=${userId ?? 'null'}`, { operation: "session_attach" });
    // Enforce one active pane per WS: any prior tail/conn is torn down first.
    if (sshConn || tailHandle) {
      sshLogger.info("Claude session pane switch", {
        operation: "claude_session_pane_switch",
        userId,
        sessionId,
        hostId,
        tmuxSession,
      });
      teardownPane();
    }

    const resolved = await resolveHostById(hostId, userId!);
    if (!resolved) {
      ws.send(
        JSON.stringify({ type: "error", message: "Host not found" }),
      );
      return;
    }

    let conn: SSHClientType;
    try {
      conn = await connectOneShot(
        resolved as unknown as Parameters<typeof connectOneShot>[0],
        5000,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "SSH connect failed: " + message,
        }),
      );
      return;
    }

    // Store immediately so a WS close during discovery still tears down.
    sshConn = conn;
    if (stopped) {
      teardownPane();
      return;
    }

    // quick 260808-dmz: closure-scoped helper — extracted active-flow start.
    // Called from (a) the initial active discovery path below, and (b) the
    // dormant-poll wake path above when sentinel disappears + re-discovery
    // finds an active session. Extracts SESSION-METADATA-EMIT + TAIL-START +
    // CONTEXT-PCT-TIMER-START (lines originally ~3503-3841). The aside
    // subsystem block is NOT extracted — it stays inline in the initial-active
    // path and is re-invoked separately in the dormant-poll wake path.
    //
    // Captures closure state: ws, sshConn, sshLogger, userId, sessionId,
    // tailHandle, contextPctTimer, contextPctInFlight, dormantInFlight,
    // dormantLastEmitted, isIdentityShapedCached, identityShapeProbeInFlight,
    // planPendingContentByPath, pendingPlans, pendingPlansLastSerialized,
    // planPendingLastSerialized, planPendingWindowToken,
    // planPendingFetchInFlightForPath, backgroundedAgents,
    // backgroundedAgentsLastSerialized, backgroundedShells,
    // backgroundedShellsLastSerialized, changeoverState, currentSessionFile,
    // sessionIdFromFile, hasSeenExit, holdingTicks, discoveryRepollInFlight,
    // currentHostId, currentTmuxSession, stopped.
    startActiveSessionFlow = async ({ pid, sessionFile, tmuxSession: activeTmuxSession, hostId: activeHostId }: {
      pid: number;
      sessionFile: string;
      tmuxSession: string;
      hostId: number;
    }) => {
    // Phase 47 Plan 03 Hunk B: probe totalLines once so the connect-time
    // session metadata frame can carry it. The client (PrettyView.tsx,
    // Plan 47-04) gates the load-more button's initial visibility on
    // `totalLines > messages.length` — without this field the button
    // can't decide whether to mount. `readSessionFileRange(count=1)` is
    // the cheapest possible probe: on the REMOTE branch it still runs
    // the sentinel-split sed+wc pipeline in ONE round-trip; on the LOCAL
    // branch it reads the whole file and returns just totalLines. We
    // discard the returned line (only totalLines matters here).
    //
    // On probe failure emit `totalLines: 0` so the client hides the
    // button gracefully (0 <= any messages count, gate fails, button
    // stays unmounted). Structured log for post-deploy dashboards. This
    // is non-fatal: the streaming tail delivers lines as they arrive and
    // the pane still functions in full — the user just can't load history.
    //
    // Session frame is emitted BEFORE tail start (unchanged ordering);
    // the probe runs on the same SSH connection so ssh2's channel
    // multiplexing keeps this from blocking anything downstream.
    let totalLinesProbe = 0;
    if (sshConn) {
      try {
        const probeResult = await readSessionFileRange(sshConn, sessionFile, 1, 1);
        totalLinesProbe = probeResult.totalLines;
      } catch (err) {
        sshLogger.warn("pv_totalLines_probe_failed", {
          operation: "pv_totalLines_probe_failed",
          hostId: activeHostId,
          tmuxSession: activeTmuxSession,
          sessionFile,
          err: err instanceof Error ? err.message : String(err),
        });
        // totalLinesProbe stays 0 — client-side gate is `totalLines > messages.length`;
        // 0 fails the gate and the button hides gracefully.
      }
    }

    // Active path: metadata frame first, then start the tail.
    ws.send(
      JSON.stringify({
        type: "session",
        pid,
        sessionFile,
        totalLines: totalLinesProbe,
      }),
    );
    // Phase 30 Plan 30-01 (PS30-07): attach-time pane_state establishment.
    // Fires right after the session metadata so a fresh client that has
    // never received a pane_state before immediately learns "this pane is
    // active" — no wait for the first transition tick. Same call site is
    // reused by the dormant-poll → wake path (startActiveFlow callback)
    // which routes through startActiveSessionFlow, so both attach flows
    // (fresh connectToPane AND wake-from-dormant) establish pane_state
    // uniformly through this one line. No reason (bare "active") — reasons
    // decorate transitions, not the initial establishment.
    paneStateEmitter.emit("active");

    sshLogger.info("Starting Claude session tail", {
      operation: "claude_session_tail_start",
      userId,
      sessionId,
      hostId: activeHostId,
      tmuxSession: activeTmuxSession,
      pid,
      sessionFile,
    });

    // Phase 3: pin the connection-scoped context so the state-transition
    // helpers can log with the right hostId/tmuxSession without needing to
    // re-thread them through every callsite. Also gives the discovery-repoll
    // ticker its baseline to compare `sessionFile` against — without
    // seeding `currentSessionFile` here, the first ticker comparison would
    // treat the current file as "changed" and immediately fire
    // transitionToActiveNew on itself.
    currentHostId = activeHostId;
    currentTmuxSession = activeTmuxSession;
    currentSessionFile = sessionFile;
    sessionIdFromFile = sessionFile
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, "");

    // Context-% poller: scrape Claude Code's status-line percentage every
    // ~3s via `tmux capture-pane -p -t <session>` over a fresh exec channel
    // on the same SSH connection. ssh2 multiplexes channels so this runs
    // alongside the JSONL tail without blocking it. On miss we DON'T emit;
    // the client holds its last known value rather than blank out. Recipe
    // cribbed from nelly's context-watch.py (2026-07-18).
    //
    // Three-part hardening:
    //   * BOTTOM 8 LINES (patch #56): only look at the footer region so
    //     transcript quotes of "context) NN%" elsewhere in the pane can't
    //     win. N=8: footer=5 lines (2 separator + prompt + status +
    //     bypass/permissions) plus a 3-line buffer for footer variations
    //     (weekly-limit warnings, narrow-terminal wrap).
    //   * PER-LINE + RIGHTMOST-% anchored on `context)` (patch #59): for
    //     each line containing the label, take the RIGHTMOST NN% on that
    //     line. Claude Code's real context % renders far-right, so a
    //     custom statusline (opengsd's milestone bar was the observed
    //     case) that injects a NN% between `context)` and the real % on
    //     the SAME line can't win. Mirrors nelly's source-side hardening
    //     in context-watch.py. Last matching line across the 8-line slice
    //     wins (multi-line last-wins semantic preserved).
    //   * BAR-ANCHORED regex (patch #187 / quick 260729-ig7): the `%`
    //     must be immediately preceded (with optional whitespace) by a
    //     Claude Code meter glyph (`[█▉▊▋▌▍▎▏░]\s*NN%`). Closes the
    //     false-positive where a weekly-limit warning appended to the
    //     same line ("... 29% ┃ youve used 95% of your weekly limit")
    //     caused rightmost-wins to return 95 instead of 29. Rightmost
    //     still wins for the patch #59 milestone-bar case because both
    //     meters are bar-anchored.
    //   * FALLBACK: bar-glyph pattern (░/█ chars unique to the visual
    //     context bar) with the same per-line rightmost-% rule, for hosts
    //     where "(1M context)" is absent but the visual bar remains.
    //
    // Scan logic lives in ./context-pct-parser.ts for testability; this
    // callback just delegates to parseContextPct(output).
    const CONTEXT_PCT_INTERVAL_MS = 3000;
    // Single-quote wrap for the session name. Tmux session names are
    // validated by the frontend to a tmux-safe subset (alphanumeric,
    // dash, underscore), so single-quote escape is sufficient.
    const captureCmd = `tmux capture-pane -p -t '${activeTmuxSession}'`;
    contextPctTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (contextPctInFlight) return; // guard against slow SSH pileups
      contextPctInFlight = true;
      const connSnapshot = sshConn;
      // Read currentSessionFile at poll-fire time (not up-front) so a
      // session recycle after connect is picked up on the next tick —
      // matches how other closure-scoped fields are consulted inside
      // this callback.
      const sessionFileSnapshot = currentSessionFile;
      // TODO(post-260808-11l): once JSONL is confirmed stable in prod,
      // the capture-pane call could be skipped in the pct-only path when
      // plan-pending is disabled. Deferred — keep behavior symmetric
      // while validating the swap.
      (async () => {
        try {
          // PRIMARY: JSONL read (authoritative, pane-width-independent).
          // See ./context-pct-from-jsonl.ts docblock for the WHY / the
          // 16.5% autocompact normalization mirror / the ±1 rounding
          // note. Returns null on any error — helper never throws.
          let pct: number | null = null;
          if (sessionFileSnapshot) {
            pct = await readContextPctFromJsonl(
              connSnapshot,
              sessionFileSnapshot,
            );
          }
          // Get pane output once — needed for parseContextPct fallback
          // AND for isPlanPending / parsePlanFilePath below (they still
          // key off the pane's overlay text, not the JSONL).
          let output = "";
          try {
            output = await execCommand(connSnapshot, captureCmd);
          } catch {
            // Silent — scrape failure is nice-to-have, not load-bearing.
            // pct stays whatever the JSONL path produced; plan-pending
            // simply sees "" and reports null.
          }
          // FALLBACK: only invoke the scrape parser if JSONL yielded no
          // value (no sessionFile resolved yet, or fresh session with
          // no assistant turn). context-pct-parser.ts is preserved as
          // the fallback path per quick-260808-11l.
          if (pct === null && output !== "") {
            pct = parseContextPct(output);
          }
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (pct !== null) {
            try {
              ws.send(JSON.stringify({ type: "context_pct", pct }));
            } catch {
              /* ws may be mid-close */
            }
          }
          // Plan-pending PANE-SCRAPE (quick 260802-rps; extended Phase 24
          // Plan 03). Reuses the same `output` capture-pane payload that
          // just fed parseContextPct above — no additional SSH round-trip.
          //
          // Phase 24 extended shape: `{planFilePath, planContent, contentError}`
          // (or null when the prompt is absent). The IMMEDIATE emit carries
          // presence + planFilePath only; planContent is populated by an
          // async SFTP fetch that fires once per (pending-window, planFilePath)
          // pair and re-emits with the same de-dup guard.
          //
          // De-dup guard preserved verbatim: `JSON.stringify(currentPending)`
          // vs `planPendingLastSerialized`. On the transition-to-closed edge
          // (isPending false + we previously had cached content or an
          // in-flight fetch), we invalidate the caches — the same slug
          // reappearing after a close is treated as a fresh window and
          // refetched (per CONTEXT § "cache keyed by pending window").
          const isPending = isPlanPending(output);
          const planFilePath = isPending ? parsePlanFilePath(output) : null;

          // Transition-to-closed: clear the per-window content cache and
          // any in-flight tracker. Late-arriving fetches short-circuit via
          // the per-window token compare in .then()/.catch() (CR-01 fix).
          if (
            !isPending &&
            (planPendingContentByPath.size > 0 ||
              planPendingFetchInFlightForPath.size > 0)
          ) {
            planPendingContentByPath.clear();
            planPendingFetchInFlightForPath.clear();
            planPendingWindowToken += 1;
          }

          // CR-01 fix: window-transition invalidation. If the pane is still
          // pending but the planFilePath differs from what any in-flight
          // fetch was dispatched for, we need to invalidate the prior
          // window's token too — otherwise a PlanA → PlanB slug swap (or a
          // same-slug regenerate that never went through a null tick) lets
          // a stale PlanA fetch write into what the UI has now moved on
          // from. We detect this by: pane is pending + we have EITHER
          // in-flight fetches for paths that don't match the current path,
          // OR cached content for paths that don't match. In either case,
          // clear caches for stale paths and bump the token so the stale
          // fetches drop silently on arrival.
          if (
            isPending &&
            planFilePath &&
            (Array.from(planPendingContentByPath.keys()).some(
              (p) => p !== planFilePath,
            ) ||
              Array.from(planPendingFetchInFlightForPath).some(
                (p) => p !== planFilePath,
              ))
          ) {
            planPendingContentByPath.clear();
            planPendingFetchInFlightForPath.clear();
            planPendingWindowToken += 1;
          }

          const cached = planFilePath
            ? planPendingContentByPath.get(planFilePath)
            : null;
          const currentPending = isPending
            ? {
                planFilePath,
                planContent: cached?.content ?? null,
                contentError: cached?.error ?? null,
              }
            : null;
          const pendingSerialized = JSON.stringify(currentPending);
          if (pendingSerialized !== planPendingLastSerialized) {
            planPendingLastSerialized = pendingSerialized;
            try {
              ws.send(
                JSON.stringify({
                  type: "plan_pending",
                  pending: currentPending,
                }),
              );
            } catch {
              /* ws may be mid-close */
            }
          }

          // Kick off async SFTP fetch once per (pending-window, planFilePath)
          // pair. Guards: pane must actually be pending; parser must have
          // yielded a path; sshConn must still be bound; we don't already
          // have a cached result; and no fetch is already in flight.
          if (
            isPending &&
            planFilePath &&
            sshConn &&
            !planPendingContentByPath.has(planFilePath) &&
            !planPendingFetchInFlightForPath.has(planFilePath)
          ) {
            planPendingFetchInFlightForPath.add(planFilePath);
            const targetPath = planFilePath; // capture for the async closure
            const activeSshConn = sshConn; // narrow non-null for the closure
            // CR-01 fix: capture the current window token at fetch-dispatch
            // time. Any cache-clear site (transition-to-closed, teardown,
            // session_changed, slug-swap-during-pending) bumps
            // planPendingWindowToken; a mismatch in .then()/.catch() means
            // this fetch was dispatched for a window that no longer exists,
            // and its result must be discarded rather than written into a
            // future window's cache (which would flip-flop the UI or make
            // it stick on a stale plan).
            const fetchToken = planPendingWindowToken;
            void fetchPlanFile(activeSshConn, targetPath)
              .then((result) => {
                planPendingFetchInFlightForPath.delete(targetPath);
                // CR-01 fix: per-window token guard. Drops the result
                // silently if the pending window this fetch was dispatched
                // for is no longer current (closed OR transitioned to a
                // different slug). Replaces the pre-fix
                // `planPendingLastSerialized === "null"` guard, which only
                // caught the fully-closed case.
                if (fetchToken !== planPendingWindowToken) return;
                const cacheEntry =
                  "content" in result
                    ? { content: result.content, error: null }
                    : { content: null, error: result.error };
                planPendingContentByPath.set(targetPath, cacheEntry);
                // Re-emit with populated planContent OR contentError. De-dup
                // guard reused so back-to-back identical emits collapse.
                const nextPending = {
                  planFilePath: targetPath,
                  planContent: cacheEntry.content,
                  contentError: cacheEntry.error,
                };
                const nextSerialized = JSON.stringify(nextPending);
                if (nextSerialized !== planPendingLastSerialized) {
                  planPendingLastSerialized = nextSerialized;
                  try {
                    ws.send(
                      JSON.stringify({
                        type: "plan_pending",
                        pending: nextPending,
                      }),
                    );
                  } catch {
                    /* ws may be mid-close */
                  }
                }
              })
              .catch((err) => {
                planPendingFetchInFlightForPath.delete(targetPath);
                // CR-01 fix: same per-window token guard on the error path —
                // if the window is stale we must not cache the error either
                // (would poison the new window's slot if the slug matches).
                if (fetchToken !== planPendingWindowToken) return;
                // Cache the error so subsequent ticks don't re-fire the
                // fetch until the pending window closes and re-opens.
                const message =
                  err instanceof Error ? err.message : String(err);
                planPendingContentByPath.set(targetPath, {
                  content: null,
                  error: message,
                });
              });
          }

          // quick 260808-cd6 — dormancy stat check (two-tier: identity-shape probe
          // on first tick, dormant sentinel stat on subsequent ticks).
          // Runs AFTER the plan_pending block, BEFORE the finally.
          // Uses the SAME connSnapshot + tmuxSession captured above — zero new SSH
          // connections, zero new timers. The dormantInFlight guard mirrors
          // contextPctInFlight to prevent slow-SSH pileups.
          // Only VISIBLE panes are polled — hidden-pane suppression is inherited
          // from patch #344's WS-pause on !isVisible (the WS is closed, so poll
          // never fires). No additional gate needed here.
          if (!dormantInFlight && currentTmuxSession !== null && !stopped && ws.readyState === WebSocket.OPEN) {
            // Use the escapedName for single-quote shell wrapping. tmuxSession is
            // already validated to alphanumeric/dash/underscore by the frontend
            // (same rule as captureCmd at line ~3441 above). Per T-cd6-02: the
            // single-quote wrap prevents any $(…) or backtick injection.
            const escapedName = currentTmuxSession;
            // Build a per-connection state box pointing at the closure-scoped lets.
            // __applyDormantPollTickForTests mutates this box; we sync back below.
            const dormantState: __DormantStateForTests = {
              isIdentityShapedCached,
              identityShapeProbeInFlight,
              dormantLastEmitted,
              // quick 260809-ha3: pipe closure-scoped wakeTriggerTs through the
              // state box so the tick seam can emit wakingSince on dormant:true.
              wakeTriggerTs: () => wakeTriggerTs,
            };
            dormantInFlight = true;
            // Phase 30 Plan 30-01: capture dormantLastEmitted BEFORE the seam
            // runs so we can detect a change post-return and funnel it through
            // paneStateEmitter WITHOUT adding paneStateEmitter as an injected
            // dep on the pure __applyDormantPollTickForTests seam (that would
            // break the test-seam contract — every existing test constructs
            // deps by name).
            const dormantEmittedBefore = dormantLastEmitted;
            (async () => {
              try {
                await __applyDormantPollTickForTests(
                  {
                    connSnapshot,
                    escapedName,
                    execCommand,
                    wsSend: (data: string) => {
                      try { ws.send(data); } catch (err) { databaseLogger.warn(`[ws-server] send-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
                    },
                  },
                  dormantState,
                );
                // Sync mutation back to closure-scoped state.
                isIdentityShapedCached = dormantState.isIdentityShapedCached;
                identityShapeProbeInFlight = dormantState.identityShapeProbeInFlight;
                dormantLastEmitted = dormantState.dormantLastEmitted;
                // Phase 30 Plan 30-01: if the tick's dormancy state changed,
                // funnel the equivalent pane_state alongside the legacy
                // {type:"dormant",...} frame the seam already emitted. Compare
                // captured-before value to the post-sync value; on transition
                // to true → emit("dormant"), on transition to false →
                // emit("active", "dormancy_cleared").
                if (
                  dormantLastEmitted !== dormantEmittedBefore &&
                  dormantLastEmitted !== null
                ) {
                  if (dormantLastEmitted === true) {
                    paneStateEmitter.emit("dormant");
                  } else {
                    paneStateEmitter.emit("active", "dormancy_cleared");
                  }
                }
              } finally {
                dormantInFlight = false;
              }
            })();
          }

          // 2026-08-18 Layer 3 — sentinel-present recycle detector.
          // Piggybacks the same context-pct tick + connSnapshot the dormant
          // block above uses: check whether `~/.claude/identities/<name>/
          // .recycle-requested` exists on the pane's target box; if yes AND
          // we're currently `active`, arm the SessionHoldingOverlay via
          // transitionToHolding("sentinel"). Covers the window between the
          // agent dropping the sentinel and the supervisor tearing down
          // claude — Layer 1 (/id reset in JSONL) and Layer 2 (session-file
          // swap) both miss that window because they need the recycle to
          // have visibly progressed.
          //
          // Identity name = currentTmuxSession (fleet convention pairs tmux
          // session name with identity name). If they don't match, the
          // probe silently returns "no" (path doesn't exist) and no-ops —
          // Layer 1 still covers the /id reset case regardless.
          //
          // See sentinel-detect.ts for the pure reducer + rationale.
          if (
            !sentinelInFlight &&
            currentTmuxSession !== null &&
            changeoverState === "active" &&
            !stopped &&
            ws.readyState === WebSocket.OPEN
          ) {
            sentinelInFlight = true;
            const sentinelConnSnapshot = connSnapshot;
            const sentinelIdentityName = currentTmuxSession;
            (async () => {
              try {
                await __applySentinelCheckForTests(
                  {
                    connSnapshot: sentinelConnSnapshot,
                    identityName: sentinelIdentityName,
                    execCommand,
                  },
                  { changeoverState },
                  { transitionToHolding },
                );
              } finally {
                sentinelInFlight = false;
              }
            })();
          }
        } finally {
          contextPctInFlight = false;
        }
      })();
    }, CONTEXT_PCT_INTERVAL_MS);

    // Phase 14 Wave 2: aside subsystem — register this WS in the fan-out
    // registry, run the connect-time re-attach probe, and arm the
    // extraction poller. All three pieces reuse the pane's existing sshConn
    // (established above during connectToPane discovery); no new SSH
    // subsystem, no new port. Per CONTEXT.md § canonical_refs.
    //
    // Runs REGARDLESS of activeViewers.get(key).size — each connection
    // independently discovers overlay presence via capture-pane on mount
    // (per plan-checker W7 clarification). No "wait for another viewer"
    // gate.
    const asideKey = sessionKey(currentHostId, currentTmuxSession);
    if (!activeViewers.has(asideKey)) activeViewers.set(asideKey, new Set());
    activeViewers.get(asideKey)!.add(ws);

    // Connect-time re-attach probe (ASIDE-09): one-shot capture-pane on
    // mount. If the BTW overlay is already open (Ashley closed a prior tab
    // without dismissing, or her SSH session left a /btw hanging), emit
    // aside_ready to THIS client so the aside re-renders in-place, and
    // flip THIS ws's asideState.displayed = true so the overlap-ignore
    // gate blocks new aside_arms from firing until dismiss.
    //
    // Do NOT broadcast to peers on this probe — other tabs either already
    // have it displayed (their own state carries it) or their own connect-
    // time probes will fire independently. Broadcasting here would race
    // against peers' initial state and could double-fire aside_ready.
    (async () => {
      // Snapshot sshConn + currentTmuxSession — teardownPane may fire while
      // this promise is in flight (fast connectToPane rebind), nulling the
      // closure vars. Snapshot at kick-off preserves the correct target
      // for this probe attempt.
      const probeConn = sshConn;
      const probeSession = currentTmuxSession;
      if (!probeConn || !probeSession) return;
      try {
        const probeOutput = await execCommand(
          probeConn,
          `tmux capture-pane -p -S -200 -t ${shellQuote(probeSession)}`,
        );
        if (stopped || ws.readyState !== WebSocket.OPEN) return;
        if (!probeOutput.includes(ASIDE_END_MARKER)) return;
        const text = extractBtwAnswer(probeOutput, ASIDE_END_MARKER);
        if (text === null || text === "") return;
        try {
          ws.send(JSON.stringify({ type: "aside_ready", text }));
        } catch {
          /* ws may be mid-close */
        }
        const st = asideState.get(ws);
        if (st) st.displayed = true;
        // Set hadMarkerLastCapture so the subsequent poll's marker-
        // disappearance detection works from mount forward (if Ashley
        // Escape-closes the overlay via SSH, we want to broadcast dismiss).
        hadMarkerLastCapture = true;
      } catch {
        /* Silent — probe failure is not fatal; a later aside_arm will
           re-trigger the normal inject + poll cycle. */
      }
    })();

    // Extraction poller (ASIDE-04) — one setInterval per WS connection,
    // gated on `asideState.get(ws)?.armed`. When disarmed, the poll body
    // early-returns without capturing (idle-cheap; only armed connections
    // do exec calls). Same setInterval + execCommand + inFlight + silent-
    // catch posture as the context-pct poller above (per PATTERNS.md
    // L303-370). Uses scrollback (-S -200) to catch multi-line answers
    // exceeding the visible pane per CONTEXT.md § Extraction.
    const asideCaptureCmd =
      `tmux capture-pane -p -S -200 -t ${shellQuote(currentTmuxSession)}`;
    asideExtractionTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (asideExtractionInFlight) return; // guard against slow SSH pileups
      const st = asideState.get(ws);
      if (!st?.armed) return; // gate — only poll when armed
      asideExtractionInFlight = true;
      const connSnapshot = sshConn;
      execCommand(connSnapshot, asideCaptureCmd)
        .then((output) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const markerPresent = output.includes(ASIDE_END_MARKER);
          sshLogger.info("aside poll diag: poll", {
            hostId: currentHostId,
            tmuxSession: currentTmuxSession,
            len: output.length,
            markerPresent,
            hadMarkerLast: hadMarkerLastCapture,
            lastStableLen: lastStableCapture === null ? null : lastStableCapture.length,
            tail: output.slice(-60),
          });

          // Marker-disappearance detection FIRST — cross-tab coherence
          // when Ashley externally Escapes via SSH, or tmux dies. If we
          // saw the marker last poll and it's gone now AND this ws has
          // displayed=true, the overlay closed externally. broadcast
          // dismiss to all peers (flips this ws AND peers' displayed
          // flags per the atomic BOTH-STEPS rule) and reset stability.
          if (
            hadMarkerLastCapture &&
            !markerPresent &&
            asideState.get(ws)?.displayed === true &&
            currentHostId != null &&
            currentTmuxSession != null
          ) {
            sshLogger.info("aside poll diag: marker-disappeared → dismiss");
            broadcastAsideDismissed(
              sessionKey(currentHostId, currentTmuxSession),
            );
            lastStableCapture = null;
            hadMarkerLastCapture = false;
            return;
          }

          if (!markerPresent) {
            // Still streaming, or nothing to see. Update flag; wait.
            hadMarkerLastCapture = false;
            return;
          }

          // markerPresent === true from here on.
          if (lastStableCapture !== output) {
            // First capture with the marker, OR a later capture that has
            // still-changing content (agent finalizing the answer). Store
            // and wait for stability on the next poll.
            sshLogger.info("aside poll diag: unstable-or-first", {
              wasNull: lastStableCapture === null,
              prevLen: lastStableCapture?.length ?? null,
              nowLen: output.length,
            });
            lastStableCapture = output;
            hadMarkerLastCapture = true;
            return;
          }

          // Stable: same output as last capture, marker present.
          sshLogger.info("aside poll diag: stable-extracting", {
            len: output.length,
            outputTail: output.slice(-400),
          });
          const text = extractBtwAnswer(output, ASIDE_END_MARKER);
          if (text === null) {
            // Degenerate — marker + no /btw echo. Disarm; swallow.
            sshLogger.info("aside poll diag: extract-null → disarm");
            const s = asideState.get(ws);
            if (s) s.armed = false;
            lastStableCapture = null;
            hadMarkerLastCapture = true; // overlay still displayed on pane
            return;
          }

          // Still-working guard (Ashley 2026-07-26 UAT, iterating).
          // The stability check (`lastStableCapture !== output`) alone
          // false-positives when Claude Code's spinner sits byte-
          // identical across a 300ms poll window.
          //
          // Guard: reject any extract ending in horizontal ellipsis `…`
          // (U+2026). Every Claude spinner variant is `<glyph> <Verb>…`
          // — universal suffix regardless of the ~10 dingbat asterisks
          // Claude cycles through (✻ ✢ ✶ ✳ etc.). Real /btw answers
          // end with normal punctuation.
          //
          // Ruled-out alternatives:
          //   - `esc to close`: shown in BOTH working and done states.
          //   - `esc to interrupt`: not present in the compact /btw
          //      overlay layout in Claude Code v2.1.150+.
          //   - `f to fork` in raw pane: false-positive from scrollback
          //      containing prior completed overlays (capture-pane -S -200
          //      includes 200 lines of scrollback).
          //
          // Reset lastStableCapture so the NEXT real-quiescence pair of
          // polls re-establishes stability on the finished answer.
          // Do NOT disarm — the /btw is still valid.
          if (/…\s*$/.test(text)) {
            sshLogger.info("aside poll diag: still-working → reset stability", {
              textPreview: text.slice(0, 80),
            });
            lastStableCapture = null;
            hadMarkerLastCapture = true;
            return;
          }

          // Emit aside_ready to THIS ws AND every peer in the fan-out
          // registry. For each recipient (including self), flip
          // asideState.displayed = true so the overlap-ignore gate
          // blocks further aside_arm re-injection until dismiss.
          const frame = JSON.stringify({ type: "aside_ready", text });
          const key =
            currentHostId != null && currentTmuxSession != null
              ? sessionKey(currentHostId, currentTmuxSession)
              : null;
          const peers = key ? activeViewers.get(key) : undefined;
          const recipients = peers ?? new Set<import("ws").WebSocket>([ws]);
          sshLogger.info("aside poll diag: emit aside_ready", {
            textLen: text.length,
            recipients: recipients.size,
            keyPresent: key !== null,
            peerRegistryHit: peers !== undefined,
          });
          // Fallback single-recipient set covers the pathological case
          // where the pane's connectToPane hadn't yet registered this ws
          // in activeViewers (shouldn't happen — registration is
          // synchronous above the poller — but defensive).
          for (const recipient of recipients) {
            if (recipient.readyState !== WebSocket.OPEN) continue;
            try {
              recipient.send(frame);
            } catch {
              /* recipient may be mid-close */
            }
            const recState = asideState.get(recipient);
            if (recState) recState.displayed = true;
          }

          // Disarm THIS ws only — peers arm/disarm on their own
          // aside_arm messages independently.
          const s = asideState.get(ws);
          if (s) s.armed = false;
          lastStableCapture = null;
          // hadMarkerLastCapture stays true — the overlay IS still
          // displayed on the pane; marker-disappearance detection
          // above needs this to fire when Ashley externally Escapes.
          hadMarkerLastCapture = true;
        })
        .catch(() => {
          /* Silent on scrape failure — matches the context-pct poller
             posture. A miss on one tick is fine; next tick tries again. */
        })
        .finally(() => {
          asideExtractionInFlight = false;
        });
    }, ASIDE_POLL_INTERVAL_MS);

    // Harness-tasks poller: read Claude Code's on-disk task queue (populated
    // by TaskCreate + /queue) and emit it to the client on change. Storage
    // layout: ~/.claude/tasks/<sessionId>/<n>.json — one JSON file per task
    // numbered from 1. sessionId is the JSONL basename we already have from
    // the discovery result. Each task is
    //   { id, subject, description?, activeForm?, status, blocks[], blockedBy[] }
    // with status in {pending, in_progress, completed, ...}. Files are
    // pretty-printed multi-line JSON; we collapse each to one line with
    // `tr '\n' ' '` on the remote (valid JSON is whitespace-insensitive,
    // and escaped `\n` inside string literals is TWO bytes `\` + `n` so
    // tr on real LF only touches formatter whitespace, not string data).
    //
    // Live update: 3s polling on the same SSH connection as the tail (ssh2
    // multiplexes channels — concurrent execs are fine). On payload change
    // vs last-emitted, emit a fresh `{type:"harness_tasks", tasks}` frame;
    // when unchanged, skip the emit to avoid pushing identical arrays every
    // tick. The client filters completed tasks for display and hides the
    // panel entirely when no active tasks remain.
    //
    // BLOCKER fix (plan-checker 2026-07-18): setup is now via the module-
    // scoped `setupHarnessTasksPoller` helper so `transitionToActiveNew`
    // can rebind against the fresh session's UUID after a recycle. Pre-
    // Phase-3, the poller was baked into a local `const tasksCmd` at
    // connect time and stayed pointed at the DEAD session's UUID forever
    // after a recycle. `sessionIdFromFile` is set just above in the initial
    // session-file assignment block.
    setupHarnessTasksPoller(sessionIdFromFile!);

    // Phase 3 Layer 2: discovery-repoll backstop. Runs the SAME full
    // `discoverClaudeSession` call the initial connectToPane branch used,
    // once per tick, on the same SSH connection. On change:
    //   - active + new file  → transitionToHolding("discovery_diff") then
    //                          transitionToActiveNew(newFile) same tick
    //                          (SIGTERM-fallback path — /exit never landed)
    //   - holding + new file → transitionToActiveNew(newFile)
    //                          (normal recycle after /exit)
    //   - holding + no file  → increment holdingTicks; if >= timeout, dead
    //   - active + inactive  → transitionToHolding (defensive — treated as
    //                          recover-pending; may resolve as file appears
    //                          in a future tick or as dead on timeout)
    //
    // Full discovery each tick (not a cached `ls -t $projects_dir/*.jsonl`)
    // is LOAD-BEARING per Nelly's recover-in-different-cwd case (2026-07-15):
    // the same session id can move projects subdirs, so the projects dir
    // may not be the same one we started from. `discoverClaudeSession`
    // walks pane→pid→cwd→slug fresh each tick and correctly follows the
    // move. See CONTEXT.md D-30 and CHANGEOVER-05.
    //
    // quick 260813-0qx: timer setup extracted to the connection-scoped
    // startDiscoveryRepollTimer helper (~L2600) so the attach-path
    // reset-window branch can start the same timer without duplicating the
    // body. Behavior byte-preserved for this steady-state site.
    startDiscoveryRepollTimer(activeTmuxSession);

    tailHandle = tailSessionFile(sshConn!, sessionFile, onLine, onError);
    }; // end of startActiveSessionFlow

    const result = await discoverClaudeSession(conn, tmuxSession);
    sshLogger.info("Claude session discovery result", {
      operation: "claude_session_discovery",
      userId,
      sessionId,
      hostId,
      tmuxSession,
      status: result.status,
    });

    if (result.status === "inactive") {
      // quick 260808-dmz — dormancy probe BEFORE teardown.
      // FIX §1-2: if this is an identity-shaped pane AND the .dormant sentinel
      // exists, enter the dormant state instead of tearing down SSH. The probe is
      // inline+await so the branch decision (teardown vs. keep-alive) is synchronous.
      // Fail-safe: any SSH throw here falls through to the normal teardown path
      // (do not hold an SSH conn open on error).
      //
      // Phase 32 (identity-first-turn session-discovery-wake-bubble-message-hi):
      // on the DORMANT branch (identity-shape probe = yes AND .dormant present),
      // we ALSO call discoverIdentitySessionFile(conn, tmuxSession) and — when
      // the helper returns a non-null absolute path — open a tail on that file
      // through the SAME onLine/onError closures the active flow uses. That
      // wires the wake-bubble's historical message list into the existing
      // appendDedup + eventId pipeline (D-08 latency parity — no new lambdas,
      // no new frame types). Null-return preserves today's dormant-branch
      // behavior byte-for-byte (D-05 fallback). This is a DIFFERENT contract
      // from the L145-150 FALLBACK-01 rule — FALLBACK-01 governs the ACTIVE-
      // path `inactive` handling ("never reach back to a prior session
      // file"); this branch is dormant + identity-attributed, where the
      // "identity's own JSONL" IS the intended source of truth. D-09 keeps
      // the active-flow discovery at L~4634 UNCHANGED — the helper is called
      // from this one dormant site only.
      let enteredDormantPoll = false;
      if (result.reason === "not_claude") {
        // Only probe for dormancy on not_claude (the signal that no claude process is
        // running); exec_error / no_tmux_session / no_pid_session_file / etc. are
        // not dormancy candidates — treat them as plain inactive.
        try {
          const escapedName = tmuxSession; // validated to safe subset by frontend
          // Tier 1: is this an identity-shaped pane? (reuse exact command from seam line 946-950)
          const identityProbeOut = await execCommand(
            conn,
            `test -d ~/.claude/identities/'${escapedName}' && echo yes || echo no`,
          );
          const isIdentityShape = identityProbeOut.trim() === "yes";
          // Cache for the connection lifetime so dormant-poll and wake handler use it.
          isIdentityShapedCached = isIdentityShape;
          if (isIdentityShape) {
            // Tier 2: .dormant sentinel present? (reuse exact command from seam line 956-961)
            const dormantProbeOut = await execCommand(
              conn,
              `stat ~/.claude/identities/'${escapedName}'/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
            );
            if (dormantProbeOut.trim() === "yes") {
              // This IS a dormant pane. Seed closure state so wake handler +
              // dormant-poll can operate, then emit dormant:true and start poll.
              currentHostId = hostId;
              currentTmuxSession = tmuxSession;
              dormantLastEmitted = true;
              sshLogger.info("Claude session dormant state entered", {
                operation: "claude_session_dormant_entered",
                userId,
                sessionId,
                hostId,
                tmuxSession,
              });
              try {
                // quick 260809-ha3: dormant:true carries wakingSince (closure-scoped
                // wakeTriggerTs at ~L1264) so the client's wake-progress bar survives
                // Fix B (visibility false->true edge). Natural-dormant path (fresh
                // WS, no prior wake click) sends wakingSince:null.
                ws.send(JSON.stringify({ type: "dormant", dormant: true, wakingSince: wakeTriggerTs }));
              } catch (err) { databaseLogger.warn(`[ws-server] send-failed msgType=dormant err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
              // Phase 30 Plan 30-01 (PS30-07): initial-discovery-dormant path
              // establishes attach-time pane_state alongside the legacy dormant
              // frame. wakingSince stays on the legacy frame only — pane_state's
              // reason enum is qualitative, not timestamp-carrying (T-30-01).
              paneStateEmitter.emit("dormant");
              // FIX §3: Start the lightweight dormant-poll loop (3s cadence).
              // The loop polls the sentinel; on disappearance re-runs discovery;
              // on active → transitions to active flow via startActiveSessionFlow.
              // dormantPollInFlight guards against slow-SSH pileups.
              dormantPollTimer = setInterval(() => {
                if (stopped || ws.readyState !== WebSocket.OPEN || !sshConn || dormantPollInFlight) return;
                dormantPollInFlight = true;
                // Phase 30 Plan 30-01: capture dormantLastEmitted BEFORE the
                // seam runs so we can detect a change post-return and funnel
                // it through paneStateEmitter WITHOUT injecting the emitter
                // into the pure __applyDormantPollWithRediscoveryForTests
                // seam (that would break the test-seam contract). The
                // startActiveFlow callback below routes through
                // startActiveSessionFlow which fires paneStateEmitter.emit
                // ("active") on its own; here we cover the dormant:true and
                // dormant:false wire emits the seam does directly.
                const dormantEmittedBefore = dormantLastEmitted;
                (async () => {
                  try {
                    await __applyDormantPollWithRediscoveryForTests(
                      {
                        connSnapshot: sshConn!,
                        escapedName: currentTmuxSession!,
                        execCommand,
                        discoverSession: (c, s) => discoverClaudeSession(c as import("ssh2").Client, s),
                        wsSend: (data: string) => {
                          try { ws.send(data); } catch (err) { databaseLogger.warn(`[ws-server] send-failed err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_send_failed" }); }
                        },
                        startActiveFlow: (pid, sessionFile) => {
                          // Transition from dormant-poll to active flow.
                          // Clear dormant-poll timer — contextPctTimer takes over from here.
                          if (dormantPollTimer) { clearInterval(dormantPollTimer); dormantPollTimer = null; }
                          // Phase 32 Wave 2 (T-32-04, D-08): SAFE-CLOSE ORDERING.
                          //
                          // If a dormant tail was opened by the dormant-branch
                          // wire-in above (Task 1 / __applyDormantBranchTailOpen
                          // ForTests), stop + null it BEFORE
                          // startActiveSessionFlow reassigns tailHandle via
                          // `tailHandle = tailSessionFile(sshConn!, sessionFile,
                          // onLine, onError)` at L~4634. Otherwise two tails on
                          // different files briefly overlap: the dormant file's
                          // tail's `s.on("data")` callback continues to fire
                          // lines from the PRIOR file into the SAME `onLine`
                          // closure, interleaving with the NEW active-file
                          // tail's replay lines — producing either duplicate
                          // eventId emissions (distinct eventIds for the same
                          // logical position across two files) or out-of-order
                          // emissions (dormant-file buffered lines arriving
                          // AFTER the active file's initial replay begins).
                          //
                          // session-file-tail.ts:54-78's synchronous `stopped`
                          // closure flag makes the stop() call itself immediate
                          // — any subsequent s.on("data") callback early-
                          // returns and never invokes onLine — so this
                          // ordering is safe even if the underlying SSH
                          // channel close is async (channel teardown is idem
                          // potent-with-stopped-flag). See CASE-DT4 + DT5 in
                          // claude-session-server.dormant-tail.test.ts.
                          if (tailHandle) {
                            tailHandle.stop();
                            tailHandle = null;
                            sshLogger.info(
                              "Dormant tail stopped for wake handoff",
                              {
                                operation:
                                  "claude_session_dormant_tail_stopped_for_wake",
                                userId,
                                sessionId,
                                hostId: currentHostId,
                                tmuxSession: currentTmuxSession,
                              },
                            );
                          }
                          // Belt-and-suspenders: clear wakeTriggerTs so a subsequent
                          // dormancy+wake cycle on this same WS doesn't see a stale ts.
                          wakeTriggerTs = null;
                          startActiveSessionFlow({ pid, sessionFile, tmuxSession: currentTmuxSession!, hostId: currentHostId! });
                          // Aside subsystem registration for the wake path.
                          // Dormant panes had no active aside connection — register now.
                          if (currentHostId != null && currentTmuxSession != null) {
                            const wakeAsideKey = sessionKey(currentHostId, currentTmuxSession);
                            if (!activeViewers.has(wakeAsideKey)) activeViewers.set(wakeAsideKey, new Set());
                            activeViewers.get(wakeAsideKey)!.add(ws);
                          }
                        },
                        // quick 260808-fgf: cat .resume-complete; returns trimmed body or null.
                        markerCommand: async (conn: unknown, name: string): Promise<string | null> => {
                          try {
                            const out = await execCommand(
                              conn as import("ssh2").Client,
                              `cat ~/.claude/identities/'${name}'/.resume-complete 2>/dev/null || echo`,
                            );
                            const trimmed = out.trim();
                            return trimmed.length > 0 ? trimmed : null;
                          } catch {
                            return null;
                          }
                        },
                        // Injectable clock — Date.now in production, deterministic in tests.
                        now: () => Date.now(),
                        // Dormant-branch context-pct plumbing (piggyback on this tick).
                        readJsonlPct: readContextPctFromJsonl,
                        dormantSessionFile: () => dormantSessionFile,
                      },
                      {
                        dormantLastEmitted: () => dormantLastEmitted,
                        setDormantLastEmitted: (v) => { dormantLastEmitted = v; },
                        wakeTriggerTs: () => wakeTriggerTs,
                      },
                    );
                    // Phase 30 Plan 30-01: if the seam flipped
                    // dormantLastEmitted, mirror the change onto pane_state.
                    // - false→true (sentinel re-appeared during poll):
                    //     emit("dormant")
                    // - true→false (sentinel disappeared; freshness check
                    //   passed; re-discovery about to run):
                    //     emit("active", "dormancy_cleared")
                    // The startActiveFlow callback above ALSO fires
                    // paneStateEmitter.emit("active") through
                    // startActiveSessionFlow if re-discovery reports active.
                    // The emitter's dedupe on identical (state, reason)
                    // safely collapses the resulting back-to-back
                    // ("active","dormancy_cleared") → ("active") pair to two
                    // distinct wire frames (different reason), which is the
                    // correct behavior — the first tells the client "we've
                    // exited dormancy" and the second establishes the fresh
                    // active session's attach-time pane_state.
                    if (
                      dormantLastEmitted !== dormantEmittedBefore &&
                      dormantLastEmitted !== null
                    ) {
                      if (dormantLastEmitted === true) {
                        paneStateEmitter.emit("dormant");
                      } else {
                        paneStateEmitter.emit("active", "dormancy_cleared");
                      }
                    }
                  } finally {
                    dormantPollInFlight = false;
                  }
                })();
              }, 3000);
              // Phase 32 Wave 2: open a dormant tail on the identity's most-
              // recently active JSONL so the wake-bubble is backed by the
              // historical conversation the user is deciding whether to
              // wake. Uses the SAME closure-scoped `tailHandle` variable
              // (L1279) as the active flow so:
              //   1. WS-close cleanup via teardownPane() → tailHandle.stop()
              //      at L1557-1564 works unchanged (no new ws.on("close")
              //      code needed — this is by construction — see T-32-06).
              //   2. Wake-handoff safe-close ordering (Task 2 Part A) can
              //      call `if (tailHandle) { tailHandle.stop(); tailHandle
              //      = null; }` BEFORE startActiveSessionFlow reassigns
              //      tailHandle at L~4634 (prevents dormant+active tail
              //      overlap — see T-32-04 + D-08).
              //
              // D-01: byte-pattern match delegated entirely to the helper
              //   (which uses `line.includes` on the identity's first
              //   `/id <name>` user turn — no JSON.parse).
              // D-05: on null return the dormant branch is byte-identical
              //   to today (dormant frame sent, no tail opened, no
              //   messages). Never throws.
              // D-08: SAME `onLine` closure (L1601) and SAME `onError`
              //   closure (L2102) as the active flow — the dormant tail's
              //   line-emission path IS the active-flow line-emission
              //   path. No new lambdas, no wrapping.
              // D-09: active-flow discovery at L~4634 UNTOUCHED — this is
              //   the ONE production call site for the helper.
              //
              // T-32-05 (info disclosure): the discovered-file log payload
              // carries `discoveredFileBasename` (the JSONL's UUID, e.g.
              // `abc-123.jsonl`) — NOT the absolute path (which would
              // leak the encoded project-dir path segment). The
              // no-match log carries no path payload at all.
              //
              // Delegate to __applyDormantBranchTailOpenForTests — the
              // seam is the SINGLE production implementation entry point
              // for the discovery + tail-open + logging sequence (matches
              // D-09's "one call site" invariant). The seam handles the
              // null-return fallback + helper-throw fallback internally;
              // see its docblock (~L1200) for the full contract. Log
              // context (userId, sessionId, hostId, tmuxSession) is
              // enriched here at the production boundary so the seam
              // itself stays free of connection-scoped state.
              await __applyDormantBranchTailOpenForTests(
                {
                  conn,
                  sshConn: sshConn!,
                  tmuxSession,
                  discoverIdentitySessionFile,
                  tailSessionFile,
                  onLine,
                  onError,
                  wsSend: (data) => {
                    try {
                      ws.send(data);
                    } catch (err) {
                      databaseLogger.warn(
                        `[ws-server] send-failed err="${err instanceof Error ? err.message : String(err)}"`,
                        { operation: "ws_send_failed" },
                      );
                    }
                  },
                  logger: {
                    info: (msg, meta) =>
                      sshLogger.info(msg, {
                        userId,
                        sessionId,
                        hostId,
                        tmuxSession,
                        ...meta,
                      }),
                  },
                },
                {
                  setTailHandle: (h) => {
                    tailHandle = h;
                  },
                  setDormantSessionFile: (f) => {
                    dormantSessionFile = f;
                  },
                },
              );
              enteredDormantPoll = true;
            }
          }
        } catch {
          // SSH throw during probe — fall through to normal teardown (fail-safe).
          isIdentityShapedCached = false;
        }
      }
      if (enteredDormantPoll) {
        // SSH stays alive; dormant-poll loop is running. Return WITHOUT teardown.
        return;
      }

      // quick 260813-0qx — attach-path reset-window branch.
      //
      // If discoverClaudeSession returned inactive with a reason that signals we
      // are inside a /id reset (or fresh spawn) window on THIS pane — rather
      // than a terminal "no claude here" verdict — enter holding + start the
      // discovery-repoll timer instead of falling through to FALLBACK-01. The
      // repoll timer's existing branches (see startDiscoveryRepollTimer /
      // __applyRepollResultForTests) then own the recovery path: active with a
      // new session file -> transitionToActiveNew; HOLDING_TIMEOUT_TICKS
      // elapsed with no recovery -> transitionToDead('holding_timeout') which
      // emits the terminal inactive frame FALLBACK-01 would have sent
      // immediately.
      //
      // Reset-window reasons (classified via __classifyAttachInactiveForTests
      // — the SINGLE SOURCE OF TRUTH shared with the test suite so the
      // production branch and the classifier tests never drift):
      //   * no_pid_session_file  — claude process exists but hasn't written a
      //                            fresh PID file yet
      //   * no_open_session_file — PID file found but new JSONL not yet open
      //   * not_claude AND identity-shape pane WITHOUT .dormant sentinel — the
      //                            identity pane is mid-reset (claude process
      //                            gone briefly), not a bare shell. Piggybacks
      //                            on isIdentityShapedCached set inside the
      //                            dormant-identity probe block above; we do
      //                            NOT re-run the SSH probe.
      //
      // Terminal reasons (no_tmux_session, exec_error, and not_claude on a
      // non-identity pane) fall through unchanged to FALLBACK-01 below.
      //
      // WIRING CHOICE — reuse transitionToHolding("discovery_diff"): at attach
      // time changeoverState === "active" (module default at L1690), so the
      // helper's `if (changeoverState !== "active") return;` guard passes and
      // it flips state to "holding", sets holdingReason = "discovery_diff",
      // resets holdingTicks = 0, sends {type:"session_holding"} on the WS,
      // fires paneStateEmitter.emit("holding", "discovery_diff"), and logs
      // "claude_session_holding". currentSessionFile is null at this point
      // (no baseline yet — the attach-time active path hadn't run) — the
      // helper's log payload records that as `oldSessionFile: null`, which is
      // the correct semantics: there IS no old file. Below we seed
      // currentHostId / currentTmuxSession so the log payload references the
      // right pane, then add an extra reset-window-specific log line and start
      // the discovery-repoll timer via the shared helper.
      if (
        __classifyAttachInactiveForTests(result, isIdentityShapedCached) ===
        "reset_window"
      ) {
        currentHostId = hostId;
        currentTmuxSession = tmuxSession;
        transitionToHolding("discovery_diff");
        sshLogger.info(
          "Claude session entering attach-path reset-window holding",
          {
            operation: "claude_session_holding_attach_reset_window",
            reason: result.reason,
            identityShape: isIdentityShapedCached,
            userId,
            sessionId,
            hostId,
            tmuxSession,
          },
        );
        // Start the discovery-repoll timer via the shared helper (Option A).
        // Same helper startActiveSessionFlow uses — the ticker's reducer
        // branches (see __applyRepollResultForTests at ~L920) own the
        // recovery path: active-with-new-file → transitionToActiveNew;
        // HOLDING_TIMEOUT_TICKS elapsed → transitionToDead('holding_timeout').
        // currentSessionFile stays null so the first tick that finds a real
        // file trips the sessionFile !== currentSessionFile branch and fires
        // transitionToActiveNew (correct recovery).
        startDiscoveryRepollTimer(tmuxSession);
        // SSH stays alive; repoll timer is running. Return WITHOUT teardown
        // (mirrors the enteredDormantPoll early-return above).
        return;
      }

      // FALLBACK-01: emit one inactive frame and STOP. Do not open a tail,
      // do not fall through to any prior session file. The `never reach
      // back` rule is enforced structurally — there is no branch below
      // that could start a tail from an inactive result.
      ws.send(
        JSON.stringify({ type: "inactive", reason: result.reason }),
      );
      // Phase 30 Plan 30-01 (PS30-07): initial-discovery-inactive path
      // establishes attach-time pane_state before the WS drops back to
      // "waiting for the next connectToPane". Reason forwards the
      // discovery result verbatim — same string set that already reached
      // the wire via the legacy inactive frame pre-Phase-30 (not_claude,
      // no_pid_session_file, no_open_session_file, no_tmux_session,
      // exec_error), so no new information disclosure surface per T-30-01.
      paneStateEmitter.emit("inactive", result.reason);
      // Keep sshConn open? No — releasing the SSH connection here keeps
      // idle inactive WSs cheap. A subsequent connectToPane will reopen.
      try {
        conn.end();
      } catch (err) {
        databaseLogger.warn(`[ws-server] conn-end-failed hostId=${currentHostId ?? 'null'} err="${err instanceof Error ? err.message : String(err)}"`, { operation: "ws_conn_end_failed" });
      }
      sshConn = null;
      return;
    }

    // Initial active discovery path: call startActiveSessionFlow now.
    // The aside subsystem (fan-out registration, connect-time probe,
    // extraction poller, harness-tasks poller, discovery-repoll timer,
    // tail start) is ALL inside startActiveSessionFlow and runs here.
    // The dormant-poll wake path calls startActiveSessionFlow() too,
    // then does a guarded aside fan-out registration (see startActiveFlow
    // callback in the dormant-poll block above).
    startActiveSessionFlow({ pid: result.pid, sessionFile: result.sessionFile, tmuxSession, hostId });
  });
});

const CLAUDE_SESSION_WS_PORT = 30011;
sshLogger.info("Claude session WebSocket server listening", {
  operation: "claude_session_ws_boot",
  port: CLAUDE_SESSION_WS_PORT,
});
