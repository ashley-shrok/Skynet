import type { LogEntry, ConnectionStage } from "../../types/connection-log.js";

export type StatsCapableHost = {
  connectionType?: string;
  authType?: string;
};

export type TcpPingStatsConfig = {
  statusCheckEnabled: boolean;
  disableTcpPing?: boolean;
};

export function supportsMetrics(host: StatsCapableHost): boolean {
  const connectionType = host.connectionType || "ssh";
  if (connectionType !== "ssh") return false;
  if (host.authType === "none" || host.authType === "opkssh") return false;
  return true;
}

export function isTcpPingEnabled(statsConfig: TcpPingStatsConfig): boolean {
  return statsConfig.statusCheckEnabled && !statsConfig.disableTcpPing;
}

// Only SSH sends a banner unprompted; RDP/VNC/Telnet wait for the client to
// speak first, so tcpPing's passive-listen check aborts every socket after
// 2s. That aborts caused xrdp on peer boxes to log `libxrdp_force_read` and
// leak failed PAM session scopes (2026-08-23, wilma incident on workstation).
export function supportsTcpPing(host: StatsCapableHost): boolean {
  const connectionType = host.connectionType || "ssh";
  return connectionType === "ssh";
}

export function createConnectionLog(
  type: "info" | "success" | "warning" | "error",
  stage: ConnectionStage,
  message: string,
  details?: Record<string, unknown>,
): Omit<LogEntry, "id" | "timestamp"> {
  return {
    type,
    stage,
    message,
    details,
  };
}
