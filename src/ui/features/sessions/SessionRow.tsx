import { Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemoteTmuxSession } from "@/api/sessions-api";
import { useSessionIdentity } from "@/features/terminal/session-hue";
// Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar requires
// hostId query param. session.hostId is authoritative on RemoteTmuxSession.
import { avatarUrlWithHost } from "@/api/identities-api";

interface SessionRowProps {
  session: RemoteTmuxSession;
  newHostGroup: boolean;
  onSelect: (session: RemoteTmuxSession) => void;
  variant?: "default" | "compact";
}

export function SessionRow({
  session,
  newHostGroup,
  onSelect,
  variant = "default",
}: SessionRowProps) {
  const { identity, identityHue } = useSessionIdentity(session.sessionName);
  const compact = variant === "compact";

  return (
    <button
      onClick={() => onSelect(session)}
      className={cn(
        "relative flex items-center justify-between border-b border-[color:var(--color-pv-border-quiet)] last:border-b-0 hover:bg-[hsla(var(--pv-hue,35),40%,25%,0.18)] cursor-pointer text-left transition-colors",
        compact ? "px-3 py-2" : "px-4 py-3",
        newHostGroup && "border-t-[3px] border-t-accent-brand/40",
      )}
    >
      {identityHue != null && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `hsla(${identityHue}, 75%, 52%, 0.18)`,
          }}
        />
      )}
      <div
        className={cn(
          "relative flex items-center min-w-0",
          compact ? "gap-2" : "gap-3",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center shrink-0 overflow-hidden",
            compact ? "size-6" : "size-7",
            identity ? "" : "border border-[color:var(--color-pv-border-quiet-strong)] bg-[color:var(--color-pv-surface-quiet)]",
          )}
        >
          {identity ? (
            <img
              // Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar
              // requires hostId query param. session.hostId comes straight
              // from RemoteTmuxSession (populated by /sessions/list).
              src={avatarUrlWithHost(identity, session.hostId)}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <Terminal className="size-3 text-[color:var(--color-pv-code-fg)]" />
          )}
        </div>
        <span className="text-sm font-semibold truncate">
          {session.sessionName}
        </span>
      </div>
      <span
        className={cn(
          "relative uppercase tracking-widest font-semibold border border-[color:var(--color-pv-border-quiet-strong)] text-[color:var(--color-pv-fg-muted)] shrink-0",
          compact
            ? "text-[9px] px-1.5 py-0.5 ml-2 truncate max-w-[40%]"
            : "text-[10px] px-2 py-0.5",
        )}
      >
        {session.hostName}
      </span>
    </button>
  );
}
