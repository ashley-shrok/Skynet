import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/kbd";
import { Button } from "@/components/button.tsx";
import { RefreshCw, Search } from "lucide-react";
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

interface CommandPaletteProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onOpenTab: (
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
    options?: {
      targetTmuxSession?: string | null;
      label?: string;
      allowCreateTmux?: boolean;
    },
  ) => void;
}

type FetchState = "idle" | "loading" | "error";

export function CommandPalette({
  isOpen,
  setIsOpen,
  onOpenTab,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
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
    if (isOpen) {
      setSearch("");
      setDialogHost(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      refresh();
    }
  }, [isOpen, refresh]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // When the New Session dialog is open it owns ESC — let it close first.
      if (dialogHost !== null) {
        setDialogHost(null);
        return;
      }
      setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setIsOpen, dialogHost]);

  const hostsById = useMemo(() => {
    const m = new Map<number, Host>();
    for (const h of hosts) m.set(parseInt(h.id), h);
    return m;
  }, [hosts]);

  // Cluster sessions by host, most-recent-host first — same ordering as
  // SessionDashboard so the palette feels like the home view in a modal.
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

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedSessions;
    return sortedSessions.filter(
      (s) =>
        s.sessionName.toLowerCase().includes(q) ||
        s.hostName.toLowerCase().includes(q),
    );
  }, [sortedSessions, search]);

  const filteredProtocolHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = hosts.filter(isProtocolHost);
    if (!q) return all;
    return all.filter((h) => h.name.toLowerCase().includes(q));
  }, [hosts, search]);

  const filteredLaunchableHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = hosts.filter(isSshLaunchableHost);
    if (!q) return all;
    return all.filter((h) => h.name.toLowerCase().includes(q));
  }, [hosts, search]);

  const handleRowClick = (row: RemoteTmuxSession) => {
    const host = hostsById.get(row.hostId);
    if (!host) return;
    onOpenTab(host, "terminal", undefined, {
      targetTmuxSession: row.sessionName,
      label: row.sessionName,
    });
    setIsOpen(false);
  };

  const handleNewSession = (host: Host, sessionName: string) => {
    setDialogHost(null);
    onOpenTab(host, "terminal", undefined, {
      targetTmuxSession: sessionName,
      label: sessionName,
      allowCreateTmux: true,
    });
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <>
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-background/40 backdrop-blur-sm transition-all duration-200 animate-in fade-in",
      )}
      onClick={() => setIsOpen(false)}
    >
      <div
        className={cn(
          "w-full max-w-2xl mx-4 overflow-hidden rounded-none border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[70vh]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-border px-4 py-1 shrink-0">
          <Search className="size-4 text-muted-foreground mr-3" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter sessions or remote desktops…"
            className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1.5 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refresh()}
              disabled={state === "loading"}
              className="text-xs h-7"
              title="Refresh"
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  state === "loading" && "animate-spin",
                )}
              />
            </Button>
            <Kbd className="bg-muted/50 border-none h-6 px-2 text-[11px] rounded-none">
              ESC
            </Kbd>
          </div>
        </div>

        {filteredLaunchableHosts.length > 0 && (
          <div className="border-b border-border shrink-0">
            <NewSessionHostChips
              hosts={filteredLaunchableHosts}
              onSelect={(host) => {
                if (isAutoTmuxHost(host)) {
                  setDialogHost(host);
                } else {
                  onOpenTab(host, "terminal");
                  setIsOpen(false);
                }
              }}
            />
          </div>
        )}

        {filteredProtocolHosts.length > 0 && (
          <div className="border-b border-border shrink-0">
            <RemoteHostChips
              hosts={filteredProtocolHosts}
              onSelect={(host, type) => {
                onOpenTab(host, type);
                setIsOpen(false);
              }}
            />
          </div>
        )}

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {state === "loading" && sessions.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/60 py-12">
              Loading sessions…
            </div>
          )}
          {state === "error" && (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-12">
              Couldn't reach any hosts. Try Refresh.
            </div>
          )}
          {state !== "loading" &&
            state !== "error" &&
            sessions.length === 0 && (
              <div className="flex-1 flex items-center justify-center gap-2 text-xs text-muted-foreground/60 py-12">
                <span>
                  {filteredLaunchableHosts.length > 0
                    ? "No active sessions. Pick a host above to open one."
                    : "No active sessions."}
                </span>
              </div>
            )}
          {sessions.length > 0 && filteredSessions.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/60 py-12">
              No sessions match “{search}”.
            </div>
          )}
          {filteredSessions.length > 0 && (
            <div className="flex flex-col overflow-y-auto thin-scrollbar">
              {filteredSessions.map((row, i) => {
                const prevHostId =
                  i > 0 ? filteredSessions[i - 1].hostId : null;
                const newHostGroup =
                  prevHostId !== null && prevHostId !== row.hostId;
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
        </div>

        <div className="border-t border-border px-4 py-3 bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Kbd className="h-5 px-1 bg-background rounded-none">ENTER</Kbd>
              <span>open session</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span>toggle with</span>
            <Kbd className="h-5 px-1.5 bg-background rounded-none">Shift</Kbd>
            <span>+</span>
            <Kbd className="h-5 px-1.5 bg-background rounded-none">Shift</Kbd>
          </div>
        </div>
      </div>
    </div>

    <NewSessionDialog
      isOpen={dialogHost !== null}
      host={dialogHost}
      onSubmit={handleNewSession}
      onCancel={() => setDialogHost(null)}
    />
    </>
  );
}
