import GuacamoleLite from "guacamole-lite";
import { guacLogger } from "../utils/logger.js";
import { GuacamoleTokenService } from "./token-service.js";
import { getDb } from "../database/db/index.js";

const tokenService = GuacamoleTokenService.getInstance();

function parseGuacUrl(url: string): { host: string; port: number } {
  const parts = url.split(":");
  return {
    host: parts[0] || "localhost",
    port: parseInt(parts[1] || "4822", 10),
  };
}

function readGuacdOptions(): { host: string; port: number } {
  let host = process.env.GUACD_HOST || "localhost";
  let port = parseInt(process.env.GUACD_PORT || "4822", 10);
  try {
    const db = getDb();
    const urlRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
      .get() as { value: string } | undefined;
    if (urlRow?.value) {
      const parsed = parseGuacUrl(urlRow.value);
      host = parsed.host;
      port = parsed.port;
    }
  } catch {
    // DB not available yet, use env var defaults
  }
  return { host, port };
}

const GUAC_WS_PORT = 30008;

const websocketOptions = {
  port: GUAC_WS_PORT,
};

const clientOptions = {
  crypt: {
    cypher: "AES-256-CBC",
    key: tokenService.getEncryptionKey(),
  },
  // guacamole-lite defaults this to 10s and tracks Guacamole-protocol-level
  // activity (client input + guacd frames). A backgrounded browser tab stops
  // pushing input within seconds and gets killed with "Session terminated
  // due to inactivity" — exactly the freeze we're trying to prevent. The
  // WebSocket ping/pong heartbeat installed below detects genuinely dead
  // clients at the transport layer (~40s after the browser goes away), so
  // we don't need this app-layer timer doubling up.
  maxInactivityTime: 0,
  log: {
    level: "ERRORS",
    stdLog: (...args: unknown[]) => {
      guacLogger.info(args.join(" "));
    },
    errorLog: (...args: unknown[]) => {
      guacLogger.error(args.join(" "));
    },
  },
  allowedUnencryptedConnectionSettings: {
    rdp: ["width", "height"],
    vnc: ["width", "height"],
    telnet: ["width", "height"],
  },
  connectionDefaultSettings: {
    rdp: {
      security: "any",
      "ignore-cert": true,
      "enable-wallpaper": false,
      "enable-font-smoothing": true,
      "enable-desktop-composition": false,
      "disable-audio": false,
      "enable-drive": false,
      "resize-method": "display-update",
      width: 1280,
      height: 720,
      dpi: 96,
      audio: ["audio/L16"],
    },
    vnc: {
      "swap-red-blue": false,
      cursor: "remote",
      security: "any",
      width: 1280,
      height: 720,
    },
    telnet: {
      "terminal-type": "xterm-256color",
    },
  },
};

const _origConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  const msg = args[0];
  if (typeof msg === "string" && msg.startsWith("New client connection"))
    return;
  _origConsoleLog(...args);
};

// Browsers throttle backgrounded tabs aggressively — JS timers slow to a
// crawl after ~5 minutes hidden, so any client-side keepalive is unreliable.
// WebSocket ping/pong frames are handled by the browser's networking layer
// independently of JS, so a server-driven heartbeat keeps the TCP path warm
// (defeating NAT/firewall idle-drop) without any cooperation from the tab.
// If the client doesn't pong within two intervals, terminate the socket so
// guacd releases the RDP/VNC session promptly instead of holding it open
// until the OS TCP timeout fires.
const WS_PING_INTERVAL_MS = 20_000;

type WsLike = {
  readyState: number;
  OPEN: number;
  ping: () => void;
  terminate: () => void;
  on: (event: string, listener: () => void) => void;
};

function installWsHeartbeat(ws: WsLike): void {
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });

  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(interval);
      return;
    }
    if (!alive) {
      clearInterval(interval);
      try {
        ws.terminate();
      } catch {}
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {}
  }, WS_PING_INTERVAL_MS);

  ws.on("close", () => clearInterval(interval));
}

// Single-active-RDP-per-(user, host) enforcement — when a new RDP client
// opens for a (userId, hostId) that already has a live client, the prior
// one is closed with a Guacamole "error" instruction whose message starts
// with the marker below. The frontend detects the marker and switches its
// disconnect overlay to the Reconnect + Close Tab pair, so a window that
// gets taken over reads as "moved to another window, not broken." Killing
// the prior client also releases its guacd worker (the CPU-heavy piece of
// each concurrent RDP session — 50-80% of a core per stream), which is the
// whole point: Ashley opens the same host in multiple browser windows to
// grab it quickly, and only the newest window should hold a live guacd.
//
// Scoped to RDP only. VNC and Telnet don't insert into the map, don't get
// taken over. If a future patch wants to widen it, insert on those types
// too — nothing else changes.
type TrackableConn = {
  // Post-decrypt token payload. guacamole-lite overwrites `.connection` with a
  // flat guacd-param dict, so takeover metadata (userId/hostId) has to sit at
  // the TOP LEVEL of the token to survive — see token-service.ts. The protocol
  // type is captured earlier by guacamole-lite into `connectionSelector`
  // (ClientConnection.js line 42), so we read type from there.
  connectionSettings?: {
    userId?: string;
    hostId?: number;
  };
  connectionSelector?: string;
  webSocket?: WsLike;
  sendErrorToClient?: (message: string, errorCode?: string) => void;
  close?: (error?: unknown) => void;
};
const TAKEOVER_MARKER = "TERMIX_SUPERSEDED:";
const activeGuacClients = new Map<string, TrackableConn>();
function takeoverKey(userId: string, hostId: number, type: string): string {
  return `${userId}:${hostId}:${type}`;
}
function readTakeoverIds(
  conn: TrackableConn,
): { userId: string; hostId: number; type: string } | null {
  const type = conn.connectionSelector;
  if (type !== "rdp") return null;
  const s = conn.connectionSettings;
  if (!s) return null;
  if (typeof s.userId !== "string" || typeof s.hostId !== "number") return null;
  return { userId: s.userId, hostId: s.hostId, type };
}

function createGuacServer(): GuacamoleLite {
  const guacdOptions = readGuacdOptions();
  const server = new GuacamoleLite(
    websocketOptions,
    guacdOptions,
    clientOptions,
  );

  server.on("open", (clientConnection: TrackableConn) => {
    guacLogger.info("Guacamole connection opened", {
      operation: "guac_connection_open",
      type: clientConnection.connectionSelector,
    });
    if (clientConnection.webSocket) {
      installWsHeartbeat(clientConnection.webSocket);
    }
    const ids = readTakeoverIds(clientConnection);
    if (ids) {
      const key = takeoverKey(ids.userId, ids.hostId, ids.type);
      const prior = activeGuacClients.get(key);
      if (prior && prior !== clientConnection) {
        try {
          prior.sendErrorToClient?.(
            `${TAKEOVER_MARKER} This session was taken over by another window.`,
            "SUPERSEDED",
          );
        } catch {
          // guacamole-lite may not expose sendErrorToClient in all versions;
          // fall through to close() which the frontend surfaces as generic
          // disconnect (still functional, just no "superseded" copy).
        }
        try {
          prior.close?.();
        } catch {
          // best-effort: if close throws, the ws heartbeat / guacd close
          // path will eventually reap the connection.
        }
        guacLogger.info("Guacamole session taken over", {
          operation: "guac_session_takeover",
          userId: ids.userId,
          hostId: ids.hostId,
        });
      }
      activeGuacClients.set(key, clientConnection);
    }
  });

  server.on("close", (clientConnection: TrackableConn) => {
    guacLogger.info("Guacamole connection closed", {
      operation: "guac_connection_close",
      type: clientConnection.connectionSelector,
    });
    const ids = readTakeoverIds(clientConnection);
    if (ids) {
      const key = takeoverKey(ids.userId, ids.hostId, ids.type);
      // Only delete if this connection still owns the slot — a takeover in
      // between opens set the slot to a different (newer) connection, and
      // this close is the old one's cleanup firing after we already
      // replaced it. Deleting there would nuke the newer window's entry.
      if (activeGuacClients.get(key) === clientConnection) {
        activeGuacClients.delete(key);
      }
    }
  });

  server.on(
    "error",
    (
      clientConnection: { connectionSettings?: Record<string, unknown> },
      error: Error,
    ) => {
      guacLogger.error("Guacamole connection error", error, {
        operation: "guac_connection_error",
        type: clientConnection.connectionSettings?.type,
      });
    },
  );

  return server;
}

let guacServer = createGuacServer();

export async function restartGuacServer(): Promise<void> {
  try {
    guacServer.close();
  } catch (err) {
    guacLogger.error("Error closing guac server during restart", err as Error);
  }
  guacServer = createGuacServer();
}

export { guacServer, tokenService };
