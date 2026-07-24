import React from "react";
import { Button } from "@/components/button.tsx";
import { Terminal, Monitor, Users, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TmuxSessionInfo {
  name: string;
  created: number;
  lastActivity: number;
  windows: number;
  attachedClients: number;
}

interface TmuxSessionPickerProps {
  isOpen: boolean;
  sessions: TmuxSessionInfo[];
  onSelect: (sessionName: string) => void;
  onCreateNew: () => void;
  onCancel: () => void;
  backgroundColor?: string;
}

function formatTimestamp(
  unix: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!unix) return "---";
  const date = new Date(unix * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return t("terminal.tmuxTimeJustNow");
  if (diffMin < 60) return t("terminal.tmuxTimeMinutes", { count: diffMin });
  if (diffHr < 24) return t("terminal.tmuxTimeHours", { count: diffHr });
  if (diffDays < 7) return t("terminal.tmuxTimeDays", { count: diffDays });
  return date.toLocaleDateString();
}

export function TmuxSessionPicker({
  isOpen,
  sessions,
  onSelect,
  onCreateNew,
  onCancel,
  backgroundColor,
}: TmuxSessionPickerProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-[color:var(--color-pv-base)] rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-sm mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-[color:var(--color-pv-border-quiet)]">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-[color:var(--color-pv-code-fg)]" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {t("terminal.tmuxSessionPickerTitle")}
            </h3>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-tight text-[color:var(--color-pv-fg-muted)] mt-1">
            {t("terminal.tmuxSessionPickerDesc")}
          </p>
        </div>
        <div className="flex flex-col max-h-60 overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.name}
              onClick={() => onSelect(session.name)}
              className="w-full text-left px-4 py-3 border-b border-[color:var(--color-pv-border-quiet)] hover: transition-colors last:border-b-0"
            >
              <div className="font-mono text-xs font-bold">{session.name}</div>
              <div className="flex gap-3 mt-1 text-[10px] text-[color:var(--color-pv-fg-muted)]">
                <span
                  className="flex items-center gap-1"
                  title={t("terminal.tmuxWindows")}
                >
                  <Monitor className="size-3" />
                  {t("terminal.tmuxWindowCount", { count: session.windows })}
                </span>
                {session.attachedClients > 0 && (
                  <span
                    className="flex items-center gap-1"
                    title={t("terminal.tmuxAttached")}
                  >
                    <Users className="size-3" />
                    {t("terminal.tmuxAttachedCount", {
                      count: session.attachedClients,
                    })}
                  </span>
                )}
                <span
                  className="flex items-center gap-1"
                  title={t("terminal.tmuxLastActivity")}
                >
                  <Clock className="size-3" />
                  {formatTimestamp(session.lastActivity, t)}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-[color:var(--color-pv-border-quiet)] flex justify-end gap-2">
          <Button
            onClick={onCancel}
            variant="ghost"
            className=" text-[10px] font-bold uppercase tracking-widest"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onCreateNew}
            variant="outline"
            className=" text-[10px] font-bold uppercase tracking-widest"
          >
            {t("terminal.tmuxCreateNew")}
          </Button>
        </div>
      </div>
    </div>
  );
}
