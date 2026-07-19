import os from "os";
import path from "path";
import fs from "fs/promises";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { sshLogger } from "../utils/logger.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { discoverClaudeSession } from "./session-file-discovery.js";
import { parseSessionLine } from "./session-file-parser.js";
import { tailSessionFile, type TailHandle } from "./session-file-tail.js";
import { execCommand } from "../ssh/tmux-helper.js";

/**
 * Live Claude-session WebSocket server on port 30011.
 *
 * Wire protocol (V1 hard-lock, RENDER-01 — IMAGES EXCEPTED per patch #86):
 *
 *   client -> server:
 *     { type: "connectToPane", hostId: number, tmuxSession: string }
 *     { type: "identity:list-bounties", identityKey: string }    // patch #87: fetch identity bounties (one-shot; no pane needed)
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
 *     { type: "plan_pending", pending }                          // unmatched ExitPlanMode tool_use in the parent JSONL — non-null when Claude is waiting on the user's "1"/"2" Plan Mode reply (patch #63)
 *     { type: "inactive", reason }                               // FALLBACK-01: send once, then silent
 *     { type: "tail_error", message }                            // recoverable: client may render a banner
 *     { type: "error", message, code? }                          // fatal for this pane
 *     { type: "identity:bounties", bounties, archivedBounties, error? } // patch #87: response to identity:list-bounties (one-shot; WS closed by client after receipt)
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

// Phase 3 session-changeover tuning constants. Holding timeout: 15 * 3s = 45s.
// Per D-31 and CONTEXT.md § holding timeout — Nelly's timing note: "new .jsonl
// appears within ~5s; fully-loaded identity ~30-70s later." 45s catches the
// "no new file appeared" degenerate case (recycle failed to relaunch anything)
// while giving normal recycles headroom. If this tunes out on live use, bump
// it up by editing this constant only — no state machine change required.
const HOLDING_TIMEOUT_TICKS = 15;
const DISCOVERY_REPOLL_INTERVAL_MS = 3000;
// Harness-tasks poller tuning — moved to module scope from the pre-refactor
// inline block so the setupHarnessTasksPoller helper (per BLOCKER fix from
// plan-checker 2026-07-18) can reference them without re-allocating per call.
const HARNESS_TASKS_INTERVAL_MS = 3000;
const UUID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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

  sshLogger.info("Claude session WebSocket connection established", {
    operation: "claude_session_ws_connect",
    userId,
    sessionId,
  });

  let sshConn: SSHClientType | null = null;
  let tailHandle: TailHandle | null = null;
  let contextPctTimer: NodeJS.Timeout | null = null;
  let contextPctInFlight = false;
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
  let hasSeenExit = false; // Layer 1 flag; reset on session_changed
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
    if (contextPctTimer) {
      clearInterval(contextPctTimer);
      contextPctTimer = null;
    }
    if (harnessTasksTimer) {
      clearInterval(harnessTasksTimer);
      harnessTasksTimer = null;
    }
    if (discoveryRepollTimer) {
      clearInterval(discoveryRepollTimer);
      discoveryRepollTimer = null;
    }
    harnessTasksLastSerialized = null;
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
    backgroundedAgents.clear();
    backgroundedAgentsLastSerialized = "[]";
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
    hasSeenExit = false;
    holdingTicks = 0;
    discoveryRepollInFlight = false;
    currentHostId = null;
    currentTmuxSession = null;
    if (tailHandle) {
      try {
        tailHandle.stop();
      } catch {
        /* ignore */
      }
      tailHandle = null;
    }
    if (sshConn) {
      try {
        sshConn.end();
      } catch {
        /* ignore */
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
  // pre-refactor code with ONE addition: the Layer 1 raw-line /exit scan
  // right after the ws-open guard.
  const onLine = (line: string) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;

    // Phase 3 Layer 1: raw-line /exit marker scan (BEFORE JSON.parse for
    // cheapness). Empirical (verified 2026-07-18): /exit lands as a
    // type:"user" turn with content
    // "<command-name>/exit</command-name>\n            <command-message>exit</command-message>..."
    // Sub-second edge-triggered detection of graceful recycle. The
    // discovery repoll in the ticker (Layer 2) catches SIGTERM-fallback
    // and recover-in-different-cwd. See CONTEXT.md D-30 for two-layer
    // rationale.
    if (
      !hasSeenExit &&
      changeoverState === "active" &&
      line.includes('"content":"<command-name>/exit</command-name>')
    ) {
      hasSeenExit = true;
      transitionToHolding("exit_marker");
      // Fall through — the parser may still emit the /exit turn as a
      // message (per Ashley's HARD LOCK: slash commands must remain
      // visible in pretty view). The state transition is orthogonal to
      // whether the /exit text renders as a chat bubble. DO NOT `return`
      // here.
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
            b?.input?.run_in_background === true &&
            typeof b?.id === "string"
          ) {
            const startedAt =
              typeof obj.timestamp === "string"
                ? Date.parse(obj.timestamp) || Date.now()
                : Date.now();
            backgroundedAgents.set(b.id, {
              toolUseId: b.id,
              subagentType:
                typeof b.input.subagent_type === "string"
                  ? b.input.subagent_type
                  : "",
              description:
                typeof b.input.description === "string"
                  ? b.input.description
                  : "",
              startedAt,
            });
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
        const isAsyncAck =
          (obj as { toolUseResult?: { isAsync?: boolean } })?.toolUseResult
            ?.isAsync === true;
        if (!isAsyncAck) {
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
            }
          }
        }
      }
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
      const currentPending = pendingIter.done
        ? null
        : { planFilePath: pendingIter.value.planFilePath };
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

    const parsed = parseSessionLine(line);
    // Silent drop on kind === "skip" and kind === "malformed" — this
    // is the RENDER-01 hard-lock enforcement point. `message` and
    // `image` are mutually exclusive per parseSessionLine's contract
    // (a single line returns exactly one kind), so the two branches
    // below never both fire for the same line.
    if (parsed.kind === "message") {
      try {
        ws.send(
          JSON.stringify({
            type: "message",
            role: parsed.role,
            content: parsed.content,
            eventId: parsed.eventId,
            ts: parsed.ts,
          }),
        );
      } catch {
        /* ws may be mid-close; drop */
      }
    }
    if (parsed.kind === "image") {
      // Patch #86: images that survived the parser's dedup + role
      // derivation. Wire shape mirrors the parser's ImageMessage 1:1;
      // frontend adds the `data:${mediaType};base64,` URI prefix when
      // building the <img src>. Same try/catch-empty guard as the
      // text-message branch above.
      try {
        ws.send(
          JSON.stringify({
            type: "image",
            role: parsed.role,
            images: parsed.images,
            text: parsed.text,
            eventId: parsed.eventId,
            ts: parsed.ts,
          }),
        );
      } catch {
        /* ws may be mid-close; drop */
      }
    }
  };

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
    } catch {
      /* ignore */
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
  // hasSeenExit, holdingTicks, ws, sshConn, etc.) and the connection-scoped
  // context (currentHostId, currentTmuxSession — set on connectToPane).
  // ---------------------------------------------------------------------------

  // Called when the tail's onLine sees an `/exit` marker (Layer 1, edge-
  // triggered, sub-second) OR when the ticker's discovery-repoll notices a
  // changed sessionFile without a prior /exit having been seen (Layer 2's
  // SIGTERM-fallback path). Idempotent against double-fire — if state is
  // already `holding` or `dead`, this is a no-op. That protects against the
  // race where Layer 1 fires on the tail's onLine milliseconds before the
  // ticker's Layer 2 repoll notices the same recycle.
  const transitionToHolding = (
    reason: "exit_marker" | "discovery_diff",
  ): void => {
    if (changeoverState !== "active") return;
    changeoverState = "holding";
    holdingTicks = 0;
    if (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session_holding" }));
      } catch {
        /* ws may be mid-close */
      }
    }
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
      } catch {
        /* ignore */
      }
      tailHandle = null;
    }
    // Clear ALL buffered per-session state before the new tail starts so
    // the fresh session's `-n +1` replay converges on clean bookkeeping.
    harnessTasksLastSerialized = null;
    backgroundedAgents.clear();
    backgroundedAgentsLastSerialized = "[]";
    backgroundedShells.clear();
    backgroundedShellsLastSerialized = "[]";
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
    hasSeenExit = false;
    holdingTicks = 0;

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
    if (sshConn) {
      tailHandle = tailSessionFile(
        sshConn,
        newSessionFile,
        onLine,
        onError,
      );
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

  ws.on("close", () => {
    clearInterval(wsPingInterval);
    stopped = true;
    teardownPane();
    sshLogger.info("Claude session WebSocket disconnected", {
      operation: "claude_session_ws_disconnect",
      userId,
      sessionId,
    });
  });

  ws.on("error", (err: Error) => {
    sshLogger.error("Claude session WS error", err, {
      operation: "claude_session_ws_error",
      userId,
      sessionId,
    });
  });

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
      } catch {
        /* ignore */
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

    // Patch #87: identity:list-bounties — read-only bounty fetch, independent
    // of connectToPane. Handled BEFORE the connectToPane branch so the error
    // return below only fires for truly unknown types.
    if (msg.type === "identity:list-bounties") {
      const rawKey = (msg as { type: unknown; identityKey?: unknown }).identityKey;
      const IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/;
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
        } catch { /* ignore */ }
        return;
      }
      const identityKey = rawKey;
      const baseDir = path.join(
        os.homedir(),
        ".claude",
        "identities",
        identityKey,
        "bounties",
      );

      // Helper: read all bounty.json files in a given directory (non-recursive).
      // Skips entries that are not directories (defensive). Wraps each parse in
      // try/catch so one malformed bounty.json does NOT poison the response.
      const readBountiesFromDir = async (dir: string): Promise<unknown[]> => {
        let entries: string[];
        try {
          entries = await fs.readdir(dir);
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
        const results: unknown[] = [];
        for (const entry of entries) {
          const filePath = path.join(dir, entry, "bounty.json");
          try {
            const raw = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            // Normalize to Bounty shape — missing fields get safe defaults.
            results.push({
              id: typeof parsed.id === "string" ? parsed.id : entry,
              title: typeof parsed.title === "string" ? parsed.title : "",
              premise: typeof parsed.premise === "string" ? parsed.premise : "",
              status: typeof parsed.status === "string" ? parsed.status : "",
              priority: typeof parsed.priority === "string" ? parsed.priority : "unprioritized",
              keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
              requested_by: typeof parsed.requested_by === "string" ? parsed.requested_by : null,
              created_at: typeof parsed.created_at === "string" ? parsed.created_at : "",
              updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
              timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
              todos: Array.isArray(parsed.todos) ? parsed.todos : [],
            });
          } catch (err) {
            sshLogger.error(
              "identity:list-bounties failed to parse bounty.json",
              err instanceof Error ? err : new Error(String(err)),
              {
                operation: "identity_list_bounties_parse_error",
                userId,
                identityKey,
                filePath,
              },
            );
            // Skip this entry and continue — one bad file must not poison the list.
          }
        }
        return results;
      };

      try {
        // Open bounties: all subdirs of baseDir EXCEPT "archive".
        // We read baseDir entries and filter out "archive" to exclude it.
        let openEntries: string[];
        try {
          openEntries = (await fs.readdir(baseDir)).filter(
            (e) => e !== "archive",
          );
        } catch (err: unknown) {
          if (
            typeof err === "object" &&
            err !== null &&
            (err as NodeJS.ErrnoException).code === "ENOENT"
          ) {
            // Identity has no bounties dir — valid empty state.
            ws.send(
              JSON.stringify({
                type: "identity:bounties",
                bounties: [],
                archivedBounties: [],
              }),
            );
            return;
          }
          throw err;
        }

        // Read open bounties from the filtered non-archive subdirs.
        const bounties: unknown[] = [];
        for (const entry of openEntries) {
          const filePath = path.join(baseDir, entry, "bounty.json");
          try {
            const raw = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            bounties.push({
              id: typeof parsed.id === "string" ? parsed.id : entry,
              title: typeof parsed.title === "string" ? parsed.title : "",
              premise: typeof parsed.premise === "string" ? parsed.premise : "",
              status: typeof parsed.status === "string" ? parsed.status : "",
              priority: typeof parsed.priority === "string" ? parsed.priority : "unprioritized",
              keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
              requested_by: typeof parsed.requested_by === "string" ? parsed.requested_by : null,
              created_at: typeof parsed.created_at === "string" ? parsed.created_at : "",
              updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
              timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
              todos: Array.isArray(parsed.todos) ? parsed.todos : [],
            });
          } catch (err) {
            sshLogger.error(
              "identity:list-bounties failed to parse open bounty.json",
              err instanceof Error ? err : new Error(String(err)),
              {
                operation: "identity_list_bounties_parse_error",
                userId,
                identityKey,
                filePath,
              },
            );
          }
        }

        // Archived bounties: subdirs of baseDir/archive/*.
        const archivedBounties = await readBountiesFromDir(
          path.join(baseDir, "archive"),
        );

        sshLogger.info("identity:list-bounties", {
          operation: "identity_list_bounties",
          userId,
          identityKey,
          openCount: bounties.length,
          archivedCount: archivedBounties.length,
        });

        try {
          ws.send(
            JSON.stringify({
              type: "identity:bounties",
              bounties,
              archivedBounties,
            }),
          );
        } catch { /* ws may be mid-close */ }
      } catch (err) {
        sshLogger.error(
          "identity:list-bounties unexpected error",
          err instanceof Error ? err : new Error(String(err)),
          { operation: "identity_list_bounties_error", userId, identityKey },
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
        } catch { /* ignore */ }
      }
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
      // FALLBACK-01: emit one inactive frame and STOP. Do not open a tail,
      // do not fall through to any prior session file. The `never reach
      // back` rule is enforced structurally — there is no branch below
      // that could start a tail from an inactive result.
      ws.send(
        JSON.stringify({ type: "inactive", reason: result.reason }),
      );
      // Keep sshConn open? No — releasing the SSH connection here keeps
      // idle inactive WSs cheap. A subsequent connectToPane will reopen.
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      sshConn = null;
      return;
    }

    // Active path: metadata frame first, then start the tail.
    ws.send(
      JSON.stringify({
        type: "session",
        pid: result.pid,
        sessionFile: result.sessionFile,
      }),
    );

    sshLogger.info("Starting Claude session tail", {
      operation: "claude_session_tail_start",
      userId,
      sessionId,
      hostId,
      tmuxSession,
      pid: result.pid,
      sessionFile: result.sessionFile,
    });

    // Phase 3: pin the connection-scoped context so the state-transition
    // helpers can log with the right hostId/tmuxSession without needing to
    // re-thread them through every callsite. Also gives the discovery-repoll
    // ticker its baseline to compare `result.sessionFile` against — without
    // seeding `currentSessionFile` here, the first ticker comparison would
    // treat the current file as "changed" and immediately fire
    // transitionToActiveNew on itself.
    currentHostId = hostId;
    currentTmuxSession = tmuxSession;
    currentSessionFile = result.sessionFile;
    sessionIdFromFile = result.sessionFile
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
    //   * FALLBACK: bar-glyph pattern (░/█ chars unique to the visual
    //     context bar) with the same per-line rightmost-% rule, for hosts
    //     where "(1M context)" is absent but the visual bar remains.
    const CONTEXT_PCT_INTERVAL_MS = 3000;
    // Single-quote wrap for the session name. Tmux session names are
    // validated by the frontend to a tmux-safe subset (alphanumeric,
    // dash, underscore), so single-quote escape is sufficient.
    const captureCmd = `tmux capture-pane -p -t '${tmuxSession}'`;
    contextPctTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (contextPctInFlight) return; // guard against slow SSH pileups
      contextPctInFlight = true;
      const connSnapshot = sshConn;
      execCommand(connSnapshot, captureCmd)
        .then((output) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const lines = output.split("\n").slice(-8);
          // Per-line scan anchored on `context)`, rightmost NN% wins.
          let pct: number | null = null;
          for (const line of lines) {
            if (!line.includes("context)")) continue;
            const pcts = [...line.matchAll(/(\d{1,3})%/g)];
            if (pcts.length === 0) continue;
            pct = parseInt(pcts[pcts.length - 1][1], 10);
          }
          if (pct === null) {
            // Fallback: bar-glyph anchor, same rightmost-per-line rule.
            for (const line of lines) {
              if (!/[░█]/.test(line)) continue;
              const pcts = [...line.matchAll(/(\d{1,3})%/g)];
              if (pcts.length === 0) continue;
              pct = parseInt(pcts[pcts.length - 1][1], 10);
            }
          }
          if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100)
            return;
          try {
            ws.send(JSON.stringify({ type: "context_pct", pct }));
          } catch {
            /* ws may be mid-close */
          }
        })
        .catch(() => {
          /* Silent on scrape failure — the tail's error handler covers
             connection health; this is a nice-to-have signal, not
             load-bearing. */
        })
        .finally(() => {
          contextPctInFlight = false;
        });
    }, CONTEXT_PCT_INTERVAL_MS);

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
    discoveryRepollTimer = setInterval(() => {
      if (stopped || ws.readyState !== WebSocket.OPEN) return;
      if (!sshConn) return;
      if (discoveryRepollInFlight) return;
      discoveryRepollInFlight = true;
      const connSnapshot = sshConn;
      discoverClaudeSession(connSnapshot, tmuxSession)
        .then((result) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (changeoverState === "dead") return; // idempotent guard

          if (result.status === "active") {
            if (result.sessionFile !== currentSessionFile) {
              // File moved: recycle OR recover-in-different-cwd.
              if (changeoverState === "active") {
                // SIGTERM-fallback path: /exit never landed but the file
                // changed. Emit both holding and changed on the SAME tick.
                transitionToHolding("discovery_diff");
              }
              transitionToActiveNew(result.sessionFile);
            }
            // else: same file, still active — no state change here. If we
            // were already in `holding` AND the file matches
            // currentSessionFile, that means our pre-holding file is still
            // on disk (unusual — supervisor should have rotated it after
            // /exit). We fall through to the holdingTicks++ block below,
            // which lets the timeout progress. Do NOT reset holdingTicks
            // in this same-file branch: reset happens only in
            // transitionToActiveNew.
          } else {
            // status === "inactive": no claude in the pane right now.
            // Bare-shell gap during recycle is expected — do NOT flip to
            // dead on a single inactive tick. Only flip on holding
            // timeout. (If we were in `active` and suddenly the pane has
            // no claude AND no /exit was seen, something crashed —
            // transition to holding so the client shows the banner while
            // we wait for a recover.)
            if (changeoverState === "active") {
              transitionToHolding("discovery_diff");
            }
          }

          // W2 fix from plan-checker: the holdingTicks++ check below fires
          // on EVERY holding tick — including this same-file-active branch
          // above (where we did NOT reset holdingTicks) and the inactive
          // branch (which may have just flipped us to holding this tick).
          // Intentional: if the pre-holding file still exists but no new
          // file has appeared for HOLDING_TIMEOUT_TICKS, declare dead. A
          // stuck same-file result during holding still counts against the
          // timeout, otherwise the pane could sit in "recycling…"
          // indefinitely on a supervisor bug.
          if (changeoverState === "holding") {
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

    tailHandle = tailSessionFile(conn, result.sessionFile, onLine, onError);
  });
});

const CLAUDE_SESSION_WS_PORT = 30011;
sshLogger.info("Claude session WebSocket server listening", {
  operation: "claude_session_ws_boot",
  port: CLAUDE_SESSION_WS_PORT,
});
