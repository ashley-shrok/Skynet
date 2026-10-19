// Converts a host from the host API into the sidebar's Host shape.

import type { SSHHostWithStatus } from "@/main-axios";
import type { Host } from "@/types/ui-types";

export function sshHostToHost(h: SSHHostWithStatus): Host {
  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: 0,
    ram: 0,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableSsh: h.enableSsh ?? (h.connectionType === "ssh" || !h.connectionType),
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableRdp: h.enableRdp ?? h.connectionType === "rdp",
    enableVnc: h.enableVnc ?? h.connectionType === "vnc",
    enableTelnet: h.enableTelnet ?? h.connectionType === "telnet",
    // Gates which hosts the new-conversation and scheduled-task pickers offer.
    runsFleetSubstrate: h.runsFleetSubstrate === true,
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: (h.quickActions ?? []).map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    jumpHosts: (h.jumpHosts ?? []).map((j) => ({
      hostId: String(j.hostId),
    })),
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: h.terminalConfig as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
    socks5ProxyChain: h.socks5ProxyChain ?? [],
  };
}
