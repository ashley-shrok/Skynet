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
import {
  WatcherInboundFrame,
  FrontendInboundFrame,
  makePongFrame,
} from "./wire-protocol.js";
import type { SubscriptionRegistry } from "./subscription-registry.js";
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
  registry: SubscriptionRegistry;
  resolveHostRecordByName: (name: string) => Promise<HostRecord | null>;
}

export interface FleetStatusServer {
  close: () => void;
  wss: WebSocketServer;
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
  const { authManager, registry, resolveHostRecordByName } = opts;
  const port = opts.port ?? 30012;

  // Use path: undefined so we can dispatch manually per req.url
  const wss = new WebSocketServer({ port });

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
