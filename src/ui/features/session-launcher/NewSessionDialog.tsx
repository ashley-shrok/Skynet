import React, { useEffect, useState } from "react";
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
  host: Host | null;
  onSubmit: (host: Host, sessionName: string) => void;
  onCancel: () => void;
}

export function NewSessionDialog({
  isOpen,
  host,
  onSubmit,
  onCancel,
}: NewSessionDialogProps) {
  const [name, setName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
    }
  }, [isOpen, host?.id]);

  if (!isOpen || !host) return null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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
      <div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-sm mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-[color:var(--color-pv-border-quiet)]">
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-[color:var(--color-pv-code-fg)]" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              New Session
            </h3>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-tight text-[color:var(--color-pv-fg-muted)] mt-1">
            On <span className="text-[color:var(--color-pv-fg)]">{host.name || host.ip}</span>
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
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
              className="rounded-none border-[color:var(--color-pv-border-quiet-strong)] text-sm"
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
              className="border-[hsla(var(--pv-hue,35),55%,50%,0.4)] text-[color:var(--color-pv-code-fg)] hover:bg-[hsla(var(--pv-hue,35),55%,45%,0.9)]/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              Start
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
