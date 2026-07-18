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
 * Wire protocol (V1 hard-lock, RENDER-01):
 *
 *   client -> server:
 *     { type: "connectToPane", hostId: number, tmuxSession: string }
 *
 *   server -> client:
 *     { type: "session", pid, sessionFile }                      // metadata
 *     { type: "message", role, content, eventId, ts }            // per parsed JSONL line
 *     { type: "wip", active }                                    // work-in-progress state (emitted on transitions + once as initial state)
 *     { type: "context_pct", pct }                               // 0-100, live scrape of Claude Code status-line "context) NN%"
 *     { type: "harness_tasks", tasks }                           // Claude Code /queue + TaskCreate items — read from ~/.claude/tasks/<sid>/*.json
 *     { type: "backgrounded_agents", agents }                    // currently-running Agent{run_in_background:true} subagents — derived from JSONL tool_use/tool_result correlation (patch #61)
 *     { type: "plan_pending", pending }                          // unmatched ExitPlanMode tool_use in the parent JSONL — non-null when Claude is waiting on the user's "1"/"2" Plan Mode reply (patch #63)
 *     { type: "inactive", reason }                               // FALLBACK-01: send once, then silent
 *     { type: "tail_error", message }                            // recoverable: client may render a banner
 *     { type: "error", message, code? }                          // fatal for this pane
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

  const teardownPane = () => {
    if (contextPctTimer) {
      clearInterval(contextPctTimer);
      contextPctTimer = null;
    }
    if (harnessTasksTimer) {
      clearInterval(harnessTasksTimer);
      harnessTasksTimer = null;
    }
    harnessTasksLastSerialized = null;
    pendingPlans.clear();
    pendingPlansLastSerialized = "null";
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
    // sessionId is derived from the JSONL basename (verified 2026-07-18:
    // the tasks dir UUID matches the JSONL basename exactly — Claude Code
    // keys both on the same sessionId).
    const sessionIdFromFile = result.sessionFile
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, "");
    // Defensive: only run the poller if sessionId looks like a UUID —
    // otherwise skip. Prevents shell-injection via a malformed path.
    const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (UUID_RE.test(sessionIdFromFile)) {
      const HARNESS_TASKS_INTERVAL_MS = 3000;
      const tasksCmd = `for f in "$HOME/.claude/tasks/${sessionIdFromFile}"/*.json; do [ -f "$f" ] && { tr '\\n' ' ' < "$f"; echo; }; done 2>/dev/null`;
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
              const ai = parseInt(String((a as { id?: unknown }).id ?? ""), 10);
              const bi = parseInt(String((b as { id?: unknown }).id ?? ""), 10);
              if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
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
    }

    tailHandle = tailSessionFile(
      conn,
      result.sessionFile,
      (line: string) => {
        if (stopped || ws.readyState !== WebSocket.OPEN) return;

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
            }
          } else if (obj?.type === "user" && Array.isArray(content)) {
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
        } catch {
          /* malformed line — silently ignore, same posture as parser */
        }

        const parsed = parseSessionLine(line);
        // Silent drop on kind === "skip" and kind === "malformed" — this
        // is the RENDER-01 hard-lock enforcement point.
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
      },
      (err: Error) => {
        sshLogger.error("Claude session tail error", err, {
          operation: "claude_session_tail_error",
          userId,
          sessionId,
          hostId,
          tmuxSession,
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
      },
    );
  });
});

const CLAUDE_SESSION_WS_PORT = 30011;
sshLogger.info("Claude session WebSocket server listening", {
  operation: "claude_session_ws_boot",
  port: CLAUDE_SESSION_WS_PORT,
});
