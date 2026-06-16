import React, { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Plus } from "lucide-react";
import type { Host } from "@/types/ui-types";

// tmux session names cannot contain `.` or `:`; whitespace is rejected
// pre-submit so the user doesn't have to learn that the hard way.
function sanitize(name: string): string {
  return name.replace(/[.:\s]+/g, "");
}

interface NewSessionDialogProps {
  isOpen: boolean;
  hosts: Host[];
  onSubmit: (host: Host, sessionName: string) => void;
  onCancel: () => void;
}

export function NewSessionDialog({
  isOpen,
  hosts,
  onSubmit,
  onCancel,
}: NewSessionDialogProps) {
  const candidateHosts = useMemo(
    () =>
      hosts.filter((h) => h.enableSsh && h.terminalConfig?.autoTmux === true),
    [hosts],
  );
  const [hostId, setHostId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setHostId(candidateHosts[0]?.id ?? "");
      setName("");
      setError(null);
    }
  }, [isOpen, candidateHosts]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const host = candidateHosts.find((h) => h.id === hostId);
    if (!host) {
      setError("Pick a host");
      return;
    }
    const cleaned = sanitize(name).trim();
    if (!cleaned) {
      setError("Name required (letters, digits, dashes — no dots, colons, or spaces)");
      return;
    }
    onSubmit(host, cleaned);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[500] animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
      />
      <div className="bg-card border border-border w-full max-w-sm mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-accent-brand" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              New Session
            </h3>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground mt-1">
            Pick a host and name the tmux session
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Host
            </label>
            {candidateHosts.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                No tmux-enabled hosts available. Turn on autoTmux in a host's
                terminal config to add it here.
              </div>
            ) : (
              <select
                value={hostId}
                onChange={(e) => setHostId(e.target.value)}
                className="bg-muted/50 border border-border text-sm h-9 px-2 outline-none focus:border-accent-brand"
              >
                {candidateHosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name || h.ip}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Session name
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. fix-login-bug"
              className="rounded-none bg-muted/50 border-border text-sm"
            />
          </div>
          {error && (
            <div className="text-[11px] text-red-400">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={candidateHosts.length === 0}
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              Start
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
