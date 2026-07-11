import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { RefreshCw } from "lucide-react";
import { getSessionList, type RemoteTmuxSession } from "@/api/sessions-api";
import { getSSHHosts } from "@/main-axios";
import type { Host, TabType } from "@/types/ui-types";
import { sshHostToHost } from "@/dashboard/sshHostToHost";
import { SessionRow } from "@/features/sessions/SessionRow";

type FetchState = "idle" | "loading" | "error";

interface SessionsPanelProps {
  onOpenTab: (
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: { targetTmuxSession?: string | null; label?: string },
  ) => void;
}

export function SessionsPanel({ onOpenTab }: SessionsPanelProps) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [sessions, setSessions] = useState<RemoteTmuxSession[]>([]);
  const [state, setState] = useState<FetchState>("loading");

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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight">Sessions</div>
          <div className="text-[10px] text-muted-foreground truncate">
            tmux sessions across your hosts
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refresh()}
          disabled={state === "loading"}
          className="text-xs shrink-0"
        >
          <RefreshCw
            className={`size-3.5 mr-1 ${state === "loading" ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto thin-scrollbar">
        {state === "loading" && sessions.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/60 p-6">
            Loading sessions…
          </div>
        )}
        {state === "error" && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-6 text-center">
            Couldn't reach any hosts. Try Refresh.
          </div>
        )}
        {state !== "loading" && state !== "error" && sessions.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/60 p-6">
            No active sessions.
          </div>
        )}
        {sortedSessions.length > 0 &&
          sortedSessions.map((row, i) => {
            const prevHostId = i > 0 ? sortedSessions[i - 1].hostId : null;
            const newHostGroup =
              prevHostId !== null && prevHostId !== row.hostId;
            return (
              <SessionRow
                key={`${row.hostId}-${row.sessionName}`}
                session={row}
                newHostGroup={newHostGroup}
                onSelect={handleRowClick}
                variant="compact"
              />
            );
          })}
      </div>
    </div>
  );
}
