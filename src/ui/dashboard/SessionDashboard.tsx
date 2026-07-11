import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { RefreshCw } from "lucide-react";
import { getSessionList, type RemoteTmuxSession } from "@/api/sessions-api";
import { getSSHHosts } from "@/main-axios";
import type { Host, TabType } from "@/types/ui-types";
import { NewSessionDialog } from "@/dashboard/NewSessionDialog";
import { sshHostToHost } from "@/dashboard/sshHostToHost";
import {
  RemoteHostChips,
  isProtocolHost,
} from "@/dashboard/RemoteHostChips";
import {
  NewSessionHostChips,
  isAutoTmuxHost,
  isSshLaunchableHost,
} from "@/dashboard/NewSessionHostChips";
import { SessionRow } from "@/features/sessions/SessionRow";

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
  const [dialogHost, setDialogHost] = useState<Host | null>(null);

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

  const protocolHosts = useMemo(() => hosts.filter(isProtocolHost), [hosts]);
  const launchableHosts = useMemo(
    () => hosts.filter(isSshLaunchableHost),
    [hosts],
  );

  // Cluster sessions by host. Host order = the host whose most recent
  // session is newest goes first (so "what I was just working on" stays
  // on top), and within each host, sessions are still newest-first.
  const sortedSessions = useMemo(() => {
    if (sessions.length === 0) return sessions;
    const newestByHost = new Map<number, number>();
    for (const s of sessions) {
      const cur = newestByHost.get(s.hostId) ?? 0;
      if (s.created > cur) newestByHost.set(s.hostId, s.created);
    }
    return [...sessions].sort((a, b) => {
      const hostDelta =
        (newestByHost.get(b.hostId) ?? 0) - (newestByHost.get(a.hostId) ?? 0);
      if (hostDelta !== 0) return hostDelta;
      // Same host: secondary sort by hostId so ties are stable across reloads,
      // then by created desc.
      if (a.hostId !== b.hostId) return a.hostId - b.hostId;
      return b.created - a.created;
    });
  }, [sessions]);

  const handleRowClick = (row: RemoteTmuxSession) => {
    const host = hostsById.get(row.hostId);
    if (!host) return;
    onOpenTab(host, "terminal", undefined, {
      targetTmuxSession: row.sessionName,
      label: row.sessionName,
    });
  };

  const handleNewSession = (host: Host, sessionName: string) => {
    setDialogHost(null);
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
      {launchableHosts.length > 0 && (
        <Card className="shrink-0 py-0 gap-0">
          <NewSessionHostChips
            hosts={launchableHosts}
            onSelect={(host) => {
              if (isAutoTmuxHost(host)) {
                setDialogHost(host);
              } else {
                onOpenTab(host, "terminal");
              }
            }}
          />
        </Card>
      )}
      {protocolHosts.length > 0 && (
        <Card className="shrink-0 py-0 gap-0">
          <RemoteHostChips
            hosts={protocolHosts}
            onSelect={(host, type) => onOpenTab(host, type)}
          />
        </Card>
      )}
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
          <div className="flex-1 flex items-center justify-center gap-2 text-xs text-muted-foreground/60">
            <span>
              {launchableHosts.length > 0
                ? "No active sessions. Pick a host above to open one."
                : "No active sessions."}
            </span>
          </div>
        )}
        {sortedSessions.length > 0 && (
          <div className="flex flex-col overflow-y-auto thin-scrollbar">
            {sortedSessions.map((row, i) => {
              const prevHostId =
                i > 0 ? sortedSessions[i - 1].hostId : null;
              const newHostGroup = prevHostId !== null && prevHostId !== row.hostId;
              return (
                <SessionRow
                  key={`${row.hostId}-${row.sessionName}`}
                  session={row}
                  newHostGroup={newHostGroup}
                  onSelect={handleRowClick}
                />
              );
            })}
          </div>
        )}
      </Card>

      <NewSessionDialog
        isOpen={dialogHost !== null}
        host={dialogHost}
        onSubmit={handleNewSession}
        onCancel={() => setDialogHost(null)}
      />
    </div>
  );
}
