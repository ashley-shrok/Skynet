/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback } from "react";
import type { LogEntry } from "@/types/connection-log.ts";

interface ConnectionLogContextType {
  logs: LogEntry[];
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  setLogs: (entries: Omit<LogEntry, "id" | "timestamp">[]) => void;
  clearLogs: () => void;
  isExpanded: boolean;
  toggleExpanded: () => void;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

const ConnectionLogContext = createContext<
  ConnectionLogContextType | undefined
>(undefined);

export function ConnectionLogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [logs, setLogsState] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "timestamp">) => {
    // Patch #147: mirror every ConnectionLog entry to console.warn so tina's
    // #146 log-forwarder captures the full reconnect/WebSocket diagnostic
    // trail on iOS PWA where DevTools is unreachable. Terminal.tsx and other
    // consumers route all their meaningful diagnostics through addLog()
    // rather than console.*, so the forwarder was silent on the paths that
    // matter most for #143 iOS PWA reconnect debugging.
    console.warn("[SkynetLog]", entry.stage, entry.type, entry.message);
    const newLog: LogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
    };
    setLogsState((prev) => [...prev, newLog]);

    if (entry.type === "error" || entry.type === "warning") {
      setIsExpanded(true);
    }
  }, []);

  const setLogs = useCallback(
    (entries: Omit<LogEntry, "id" | "timestamp">[]) => {
      const newLogs = entries.map((entry, index) => ({
        ...entry,
        id: `${Date.now()}-${index}-${Math.random()}`,
        timestamp: new Date(),
      }));
      setLogsState(newLogs);

      if (entries.some((e) => e.type === "error" || e.type === "warning")) {
        setIsExpanded(true);
      }
    },
    [],
  );

  const clearLogs = useCallback(() => {
    setLogsState([]);
    setIsExpanded(false);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <ConnectionLogContext.Provider
      value={{
        logs,
        addLog,
        setLogs,
        clearLogs,
        isExpanded,
        toggleExpanded,
        setIsExpanded,
      }}
    >
      {children}
    </ConnectionLogContext.Provider>
  );
}

export function useConnectionLog() {
  const context = useContext(ConnectionLogContext);
  if (!context) {
    throw new Error(
      "useConnectionLog must be used within ConnectionLogProvider",
    );
  }
  return context;
}
