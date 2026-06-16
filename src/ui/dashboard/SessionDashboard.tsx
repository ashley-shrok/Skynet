import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Plus, RefreshCw, Terminal } from "lucide-react";
import { getSessionList, type RemoteTmuxSession } from "@/api/sessions-api";
import { getSSHHosts } from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";
import type { Host, TabType } from "@/types/ui-types";
import { NewSessionDialog } from "@/dashboard/NewSessionDialog";

// Mirror of AppShell's sshHostToHost. Kept local to avoid pulling in
// the giant DashboardTab.tsx import graph.
function sshHostToHost(h: SSHHostWithStatus): Host {
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
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableSsh: h.connectionType === "ssh" || !h.connectionType,
    enableRdp: h.connectionType === "rdp",
    enableVnc: h.connectionType === "vnc",
    enableTelnet: h.connectionType === "telnet",
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: (h.quickActions ?? []).map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    jumpHosts: (h.jumpHosts ?? []).map((j) => ({ hostId: String(j.hostId) })),
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

interface SessionDashboardProps {
  onOpenTab: (
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: { targetTmuxSession?: string | null; label?: string },
  ) => void;
}

type FetchState = "idle" | "loading" | "error";

export function SessionDashboard({ onOpenTab }: SessionDashboardProps) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [sessions, setSessions] = useState<RemoteTmuxSession[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const [rawHosts, sessionList] = await Promise.all([
        getSSHHosts(),
        getSessionList(),
      ]);
      setHosts(Array.isArray(rawHosts) ? rawHosts.map(sshHostToHost) : []);
      setSessions(Array.isArray(sessionList) ? sessionList : []);
      setState("idle");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hostsById = useMemo(() => {
    const m = new Map<number, Host>();
    for (const h of hosts) m.set(parseInt(h.id), h);
    return m;
  }, [hosts]);

  const handleRowClick = (row: RemoteTmuxSession) => {
    const host = hostsById.get(row.hostId);
    if (!host) return;
    onOpenTab(host, "terminal", undefined, {
      targetTmuxSession: row.sessionName,
      label: row.sessionName,
    });
  };

  const handleNewSession = (host: Host, sessionName: string) => {
    setDialogOpen(false);
    onOpenTab(host, "terminal", undefined, {
      targetTmuxSession: sessionName,
      label: sessionName,
    });
    // Optimistic: bump the new session into the list so the user sees
    // it appear immediately instead of needing to refresh.
    setSessions((prev) => [
      {
        hostId: parseInt(host.id),
        hostName: host.name,
        sessionName,
        created: Math.floor(Date.now() / 1000),
      },
      ...prev.filter(
        (s) =>
          !(
            s.hostId === parseInt(host.id) && s.sessionName === sessionName
          ),
      ),
    ]);
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden p-5 gap-4">
      <Card className="flex-row items-center justify-between px-5 py-3 shrink-0 gap-0">
        <div>
          <h1 className="text-lg font-bold leading-tight">Sessions</h1>
          <p className="text-xs text-muted-foreground">
            tmux sessions across your hosts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
            disabled={state === "loading"}
            className="text-xs"
          >
            <RefreshCw
              className={`size-3.5 mr-1 ${state === "loading" ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="text-xs bg-accent-brand hover:bg-accent-brand/90 text-white"
          >
            <Plus className="size-3.5 mr-1" />
            New Session
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden py-0 gap-0">
        {state === "loading" && sessions.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/60">
            Loading sessions…
          </div>
        )}
        {state === "error" && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            Couldn't reach any hosts. Try Refresh.
          </div>
        )}
        {state !== "loading" && state !== "error" && sessions.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground/60">
            <span>No active sessions.</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="text-xs text-accent-brand"
            >
              <Plus className="size-3.5 mr-1" />
              Start one
            </Button>
          </div>
        )}
        {sessions.length > 0 && (
          <div className="flex flex-col overflow-y-auto thin-scrollbar">
            {sessions.map((row) => (
              <button
                key={`${row.hostId}-${row.sessionName}`}
                onClick={() => handleRowClick(row)}
                className="flex items-center justify-between px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer text-left transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0">
                    <Terminal className="size-3 text-accent-brand" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold truncate">
                      {row.sessionName}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-widest font-semibold border border-border px-2 py-0.5 text-muted-foreground shrink-0">
                  {row.hostName}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <NewSessionDialog
        isOpen={dialogOpen}
        hosts={hosts}
        onSubmit={handleNewSession}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  );
}
