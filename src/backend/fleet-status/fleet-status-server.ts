/**
 * fleet-status-server.ts
 *
 * WebSocket server bound to port 30012 with two handshake modes:
 *
 *   /fleet-status/ws      — frontend consumer; JWT-authenticated via cookie or Bearer
 *   /fleet-status/watcher — box-side watcher; trusted via Tailscale network boundary;
 *                           hostname must resolve to a known Skynet host record
 *
 * Frontend lifecycle:
 *   connect → auth → wait for {type:'subscribe'} → send snapshot → fan-out updates
 *
 * Watcher lifecycle:
 *   connect → wait for {type:'hello', hostname} → resolve hostId → dispatch subsequent frames
 *
 * Every inbound frame is validated via zod before dispatch.
 * Structured logs at every WS lifecycle boundary — never JSON.stringify(event) objects.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { systemLogger } from "../utils/logger.js";
import { rejectServeSubdomain } from "../utils/ws-origin-guard.js";
import {
  WatcherInboundFrame,
  FrontendInboundFrame,
  makePongFrame,
} from "./wire-protocol.js";
import {
  createSubscriptionRegistry,
  type SubscriptionRegistry,
} from "./subscription-registry.js";
import {
  createAppFrameFilter,
  type CheckHostAccessFn,
} from "./app-frame-filter.js";
import type { HostRecord } from "./host-id-resolver.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthPayload {
  userId: string;
  sessionId?: string;
  pendingTOTP?: boolean;
}

interface AuthManagerLike {
  verifyJWTToken(token: string): Promise<AuthPayload | null>;
}

export interface FleetStatusServerOptions {
  port?: number;
  authManager: AuthManagerLike;
  /**
   * Optional pre-built registry. When omitted, the server constructs one
   * via `createSubscriptionRegistry` and (if `resolveHostOwnerById` is
   * present) wires the Phase 118 Plan 118-05 per-user host-visibility
   * filter into it. When provided, the server uses the passed registry
   * as-is — the caller owns filter wiring in that case. This dual shape
   * preserves backward-compat for pre-118-05 callers (starter.ts today
   * passes a pre-built registry; starter.ts wiring update is deferred to
   * the deploy motion per fleet directive #10).
   */
  registry?: SubscriptionRegistry;
  resolveHostRecordByName: (name: string) => Promise<HostRecord | null>;
  /**
   * Phase 118 Plan 118-05 (D-15): resolver mapping the wire-shaped
   * hostId string (used inside fleet-status frames) to the numeric
   * hostId + owner userId pair that `checkHostAccess` requires. When
   * present, the server constructs the app-frame filter via
   * `createAppFrameFilter({ resolveHostOwnerById })` and passes it to
   * the internal registry factory. When absent, the registry runs
   * unfiltered — production wiring in starter.ts MUST pass this at
   * deploy time to close T-118-05-IL / T-118-03-IL info-disclosure gap.
   */
  resolveHostOwnerById?: (
    hostIdStr: string,
  ) => Promise<{ hostIdNum: number; hostUserId: string } | null>;
  /**
   * Phase 118 Plan 118-05: TTL override for the app-frame filter's
   * per-(userId, hostIdStr) access cache. Defaults to 30s in
   * createAppFrameFilter. Tests can pass 0 for deterministic per-call
   * behavior.
   */
  appFrameFilterTtlMs?: number;
  /**
   * Phase 118 Plan 118-05: test seam — override the checkHostAccess
   * dependency used inside the filter. Production callers omit this
   * and get the real host-resolver.checkHostAccess.
   */
  _testCheckHostAccessOverride?: CheckHostAccessFn;
  /**
   * Phase 118 code-review HIGH-1b (fix pass 2026-09-18): explicit opt-out
   * for the loud `fleet_status_unfiltered_mode` warn in branch 1 (pre-built
   * registry, no resolveHostOwnerById). Defense-in-depth on top of the
   * starter.ts wiring (HIGH-1a) — if a future regression drops the resolver
   * dep, the log path fires so the state is grep-able. Tests + intentional
   * unfiltered callers (session-only tests using
   * `createSubscriptionRegistry()` with no deps) can pass `true` to
   * suppress the warn. Default undefined → warn fires.
   */
  acknowledgeUnfilteredMode?: boolean;
}

export interface FleetStatusServer {
  close: () => void;
  wss: WebSocketServer;
  /**
   * Phase 118 Plan 118-05: exposes the registry so callers that let the
   * server construct one internally can still call publish* methods on
   * it (tests + potential future in-process publishers). When `registry`
   * was passed via options, this is that same reference.
   */
  registry: SubscriptionRegistry;
}

// ---------------------------------------------------------------------------
// JWT extraction from request (cookie + Bearer fallback — mirrors terminal.ts:129-160)
// ---------------------------------------------------------------------------

function extractJwtToken(req: IncomingMessage): string | undefined {
  // 1. Cookie header — jwt=<token>
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  // 2. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function startFleetStatusServer(
  opts: FleetStatusServerOptions,
): FleetStatusServer {
  const { authManager, resolveHostRecordByName } = opts;
  const port = opts.port ?? 30012;

  // Phase 118 Plan 118-05: build the per-user host-visibility filter when
  // a resolver dep is provided AND no pre-built registry was passed in.
  // The filter's TTL cache is scoped to this server instance's lifetime
  // and dies when the WSS closes.
  //
  // When `opts.registry` is provided (starter.ts's current shape), the
  // caller owns filter wiring — we do NOT construct one here to avoid
  // double-filtering. starter.ts update to pass resolveHostOwnerById +
  // let the server own registry construction is deferred to the deploy
  // motion per fleet directive #10.
  let registry: SubscriptionRegistry;
  if (opts.registry !== undefined) {
    registry = opts.registry;
    if (opts.resolveHostOwnerById !== undefined) {
      systemLogger.warn(
        "Fleet-status: resolveHostOwnerById passed alongside pre-built registry — filter NOT wired (caller owns wiring)",
        {
          operation: "fleet_status_filter_wiring_skipped",
          reason: "external_registry",
        },
      );
    } else if (opts.acknowledgeUnfilteredMode !== true) {
      // Phase 118 code-review HIGH-1b (fix pass 2026-09-18): defense in
      // depth. Branch 1 (pre-built registry, no resolver) is the SILENT
      // unfiltered path — the regression HIGH-1a fixed lived here. Emit
      // the same loud warn the fully-default branch 3 emits so if a
      // future caller drops resolveHostOwnerById the state is grep-able
      // via `operation: "fleet_status_unfiltered_mode"`. Callers that
      // WANT the unfiltered shape (session-only tests + backward-compat
      // harnesses) pass acknowledgeUnfilteredMode: true.
      systemLogger.warn(
        "Fleet-status: pre-built registry provided without resolveHostOwnerById — running UNFILTERED (T-118-05-BF risk)",
        {
          operation: "fleet_status_unfiltered_mode",
          source: "external_registry",
        },
      );
    }
  } else if (opts.resolveHostOwnerById !== undefined) {
    const appFrameFilter = createAppFrameFilter({
      resolveHostOwnerById: opts.resolveHostOwnerById,
      ttlMs: opts.appFrameFilterTtlMs,
      _checkHostAccess: opts._testCheckHostAccessOverride,
    });
    registry = createSubscriptionRegistry({ appFrameFilter });
    systemLogger.info(
      "Fleet-status: app-frame filter attached to internal registry",
      {
        operation: "fleet_status_filter_attached",
        ttlMs: opts.appFrameFilterTtlMs ?? "default",
      },
    );
  } else {
    // Backward-compat: neither a registry nor a resolver was provided.
    // Build an unfiltered registry (matches pre-118-05 default behavior).
    registry = createSubscriptionRegistry();
    systemLogger.warn(
      "Fleet-status: no registry + no resolveHostOwnerById — running UNFILTERED (T-118-05-BF risk)",
      {
        operation: "fleet_status_unfiltered_mode",
      },
    );
  }

  // Use path: undefined so we can dispatch manually per req.url
  const wss = new WebSocketServer({
    port,
    // Phase 103 D-08: reject WS upgrades from *.serve.<domain> origins
    // at the handshake layer — WS complement to Plan 02's CORS reject.
    verifyClient: (info, done) => {
      if (rejectServeSubdomain(info.req)) {
        systemLogger.warn("ws-origin-guard: rejected serve subdomain", {
          operation: "ws_origin_guard_reject",
          origin: info.req.headers.origin,
          wss: "fleet-status",
        });
        return done(false, 403, "Serve subdomain origin not permitted");
      }
      return done(true);
    },
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const reqUrl = req.url ?? "";
    const remoteIp = req.socket.remoteAddress ?? "unknown";

    systemLogger.info("Fleet-status WS connect", {
      operation: "fleet_status_connect",
      url: reqUrl,
      remoteIp,
    });

    // Path dispatch
    if (reqUrl.startsWith("/fleet-status/ws")) {
      await handleFrontendConnection(ws, req, remoteIp, authManager, registry);
    } else if (reqUrl.startsWith("/fleet-status/watcher")) {
      await handleWatcherConnection(
        ws,
        req,
        remoteIp,
        registry,
        resolveHostRecordByName,
      );
    } else {
      systemLogger.warn("Fleet-status WS unknown path — closing 4000", {
        operation: "fleet_status_unknown_path",
        url: reqUrl,
        remoteIp,
      });
      ws.close(4000, "Unknown path");
    }
  });

  wss.on("error", (err: Error) => {
    systemLogger.error("Fleet-status WSS error", err, {
      operation: "fleet_status_wss_error",
      error: err.message,
    });
  });

  systemLogger.info("Fleet-status WS server started", {
    operation: "fleet_status_server_start",
    port,
  });

  return {
    close: () => {
      wss.close();
      systemLogger.info("Fleet-status WS server closed", {
        operation: "fleet_status_server_close",
      });
    },
    wss,
    registry,
  };
}

// ---------------------------------------------------------------------------
// Frontend connection handler
// ---------------------------------------------------------------------------

async function handleFrontendConnection(
  ws: WebSocket,
  req: IncomingMessage,
  remoteIp: string,
  authManager: AuthManagerLike,
  registry: SubscriptionRegistry,
): Promise<void> {
  let userId: string | undefined;
  let sessionId: string | undefined;

  // 1. Auth
  try {
    const token = extractJwtToken(req);

    if (!token) {
      systemLogger.warn("Fleet-status frontend auth failed — no token", {
        operation: "fleet_status_auth_failed",
        remoteIp,
      });
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload?.userId || payload.pendingTOTP) {
      systemLogger.warn("Fleet-status frontend auth failed — invalid token", {
        operation: "fleet_status_auth_failed",
        remoteIp,
      });
      ws.close(1008, "Authentication required");
      return;
    }

    userId = payload.userId;
    sessionId = payload.sessionId;

    systemLogger.info("Fleet-status frontend auth passed", {
      operation: "fleet_status_auth_passed",
      userId,
      sessionId,
      remoteIp,
    });
  } catch (err) {
    systemLogger.warn("Fleet-status frontend auth error", {
      operation: "fleet_status_auth_failed",
      remoteIp,
      error: err instanceof Error ? err.message : "unknown",
    });
    ws.close(1008, "Authentication required");
    return;
  }

  // 2. Wait for the first {type: 'subscribe'} frame, then subscribe
  let subscribeHandled = false;
  let disposer: (() => void) | undefined;

  // Heartbeat — 30s ws.ping() with pong-timeout terminate. Mirrors
  // terminal.ts:234-257 and claude-session-server.ts:5594-5615. Keeps
  // NAT entries warm on cellular paths (idle-drop is ~30-90s) and lets
  // the server detect zombie connections whose TCP silently died.
  let wsAlive = true;
  ws.on("pong", () => {
    wsAlive = true;
  });
  const wsPingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!wsAlive) {
        systemLogger.warn(
          "Fleet-status frontend WS pong timeout — terminating zombie connection",
          {
            operation: "fleet_status_pong_timeout",
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

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch (err) {
      systemLogger.warn("Fleet-status frontend frame parse error", {
        operation: "fleet_status_parse_error",
        userId,
        error: err instanceof Error ? err.message : "unknown",
      });
      ws.close(1003, "Invalid data");
      return;
    }

    const result = FrontendInboundFrame.safeParse(parsed);
    if (!result.success) {
      systemLogger.warn("Fleet-status frontend frame invalid", {
        operation: "fleet_status_parse_error",
        userId,
        zodError: result.error.message,
      });
      ws.close(1003, "Invalid data");
      return;
    }

    const frame = result.data;

    if (frame.type === "subscribe" && !subscribeHandled) {
      subscribeHandled = true;
      systemLogger.info("Fleet-status frontend subscribed", {
        operation: "fleet_status_subscribed",
        userId,
        sessionId,
      });
      disposer = registry.subscribe((outFrame) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(outFrame));
        }
      }, { userId: userId! });
    } else if (frame.type === "ping") {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(makePongFrame()));
      }
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(wsPingInterval);
    if (disposer) disposer();
    systemLogger.info("Fleet-status frontend disconnected", {
      operation: "fleet_status_disconnect",
      userId,
      sessionId,
      wsState: code,
      reason: reason.toString(),
    });
  });

  ws.on("error", (err: Error) => {
    systemLogger.warn("Fleet-status frontend WS error", {
      operation: "fleet_status_error",
      userId,
      sessionId,
      error: err.message,
    });
  });
}

// ---------------------------------------------------------------------------
// Watcher connection handler
// ---------------------------------------------------------------------------

async function handleWatcherConnection(
  ws: WebSocket,
  req: IncomingMessage,
  remoteIp: string,
  registry: SubscriptionRegistry,
  resolveHostRecordByName: (name: string) => Promise<HostRecord | null>,
): Promise<void> {
  // No JWT auth — trusted via Tailscale network boundary
  // Wait for the first 'hello' frame to identify the watcher's hostId
  let hostId: string | undefined;
  let helloReceived = false;

  // Heartbeat — 30s ws.ping() with pong-timeout terminate. Mirrors the
  // frontend handler above and terminal.ts:234-257. Cellular-NAT idle
  // drop doesn't apply here (watcher runs over Tailscale) but zombie
  // detection does — a crashed/partitioned watcher box otherwise leaks
  // a dead subscriber on the server side until the OS notices.
  let wsAlive = true;
  ws.on("pong", () => {
    wsAlive = true;
  });
  const wsPingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!wsAlive) {
        systemLogger.warn(
          "Fleet-status watcher WS pong timeout — terminating zombie connection",
          {
            operation: "fleet_status_pong_timeout",
            fleetHostId: hostId,
            remoteIp,
          },
        );
        ws.terminate();
        return;
      }
      wsAlive = false;
      ws.ping();
    }
  }, 30000);

  ws.on("message", async (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch (err) {
      systemLogger.warn("Fleet-status watcher frame parse error", {
        operation: "fleet_status_parse_error",
        remoteIp,
        fleetHostId: hostId,
        error: err instanceof Error ? err.message : "unknown",
      });
      ws.close(1003, "Invalid data");
      return;
    }

    const result = WatcherInboundFrame.safeParse(parsed);
    if (!result.success) {
      systemLogger.warn("Fleet-status watcher frame invalid", {
        operation: "fleet_status_parse_error",
        remoteIp,
        fleetHostId: hostId,
        zodError: result.error.message,
      });
      ws.close(1003, "Invalid data");
      return;
    }

    const frame = result.data;

    // First frame must be hello
    if (!helloReceived) {
      if (frame.type !== "hello") {
        systemLogger.warn("Fleet-status watcher — first frame is not hello", {
          operation: "fleet_status_parse_error",
          remoteIp,
          frameType: frame.type,
        });
        ws.close(1003, "Expected hello frame first");
        return;
      }

      helloReceived = true;
      const hostname = frame.hostname;

      systemLogger.info("Fleet-status watcher hello received", {
        operation: "fleet_status_hello_received",
        hostname,
        remoteIp,
      });

      // Resolve hostname → Skynet host record
      const hostRecord = await resolveHostRecordByName(hostname);
      if (!hostRecord) {
        systemLogger.warn(
          "Fleet-status watcher hostname not in Skynet host DB",
          {
            operation: "fleet_status_watcher_host_unknown",
            hostname,
            remoteIp,
          },
        );
        ws.close(1008, "Unknown host");
        return;
      }

      hostId = hostRecord.id;
      systemLogger.info("Fleet-status watcher host resolved", {
        operation: "fleet_status_watcher_host_resolved",
        hostname,
        fleetHostId: hostId,
        remoteIp,
      });
      return;
    }

    // Subsequent frames require hostId to be set
    if (!hostId) {
      // Still waiting for hello resolution — drop frame
      return;
    }

    if (frame.type === "session_state") {
      registry.publishSessionState(hostId, frame.state);
    } else if (frame.type === "session_gone") {
      registry.publishSessionGone(hostId, frame.tmuxSession, frame.sessionId);
    }
    // hello after first hello: no-op (already identified)
  });

  ws.on("close", (code, reason) => {
    clearInterval(wsPingInterval);
    systemLogger.info("Fleet-status watcher disconnected", {
      operation: "fleet_status_disconnect",
      fleetHostId: hostId,
      wsState: code,
      reason: reason.toString(),
      remoteIp,
    });
  });

  ws.on("error", (err: Error) => {
    systemLogger.warn("Fleet-status watcher WS error", {
      operation: "fleet_status_error",
      fleetHostId: hostId,
      remoteIp,
      error: err.message,
    });
  });
}
