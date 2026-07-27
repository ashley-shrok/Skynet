import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import type { Wakeup } from "@/api/claude-session-api";
import type { TabState } from "./IdentityFileTab";

// Patch #17g: tab renderer for the identity's wakeups/*.json files.
// Patch #154: adds inline editing — an enabled toggle + a schedule JSON editor.
//   Enabled writes are optimistic-agnostic (we wait on the server response
//   and rely on the fresh wakeups[] the server sends back to reflect state).
//   Schedule editing is a raw-JSON textarea because the wakeup schema
//   (interval/daily/weekly/one_shot + optional timezone) is Nelly-owned and
//   evolves; a structured field editor would need to co-evolve. The textarea
//   validates parse-ability locally before it sends.
//
// Card treatment mirrors BountyCard's glass token family.

type OnUpdate = (
  slug: string,
  updates: { enabled?: boolean; schedule?: unknown },
) => Promise<void>;

export function WakeupsTab({
  state,
  hue,
  onUpdate,
}: {
  state: TabState<Wakeup[]>;
  hue: number;
  onUpdate: OnUpdate;
}) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="text-sm text-[color:var(--color-pv-code-fg)]">
        Couldn&apos;t load wakeups: {state.error}
      </div>
    );
  }

  if (state.data.length === 0) {
    return (
      <div className="text-sm text-[var(--color-pv-fg-muted)]">
        No scheduled wake-ups.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.data.map((wakeup) => (
        <WakeupRow
          key={wakeup.slug}
          wakeup={wakeup}
          hue={hue}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}

function WakeupRow({
  wakeup,
  hue,
  onUpdate,
}: {
  wakeup: Wakeup;
  hue: number;
  onUpdate: OnUpdate;
}) {
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(() =>
    JSON.stringify(wakeup.schedule, null, 2),
  );
  const [saving, setSaving] = useState<null | "enabled" | "schedule">(null);
  const [error, setError] = useState<string | null>(null);

  // When the underlying wakeup identity changes (post-save refresh or a
  // different card in the same list), reset the draft to match the fresh
  // server-provided schedule.
  useEffect(() => {
    setScheduleDraft(JSON.stringify(wakeup.schedule, null, 2));
  }, [wakeup.slug, wakeup.schedule]);

  async function toggleEnabled() {
    setError(null);
    setSaving("enabled");
    try {
      await onUpdate(wakeup.slug, { enabled: !wakeup.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function saveSchedule() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(scheduleDraft);
    } catch (e) {
      setError("Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      setError("Schedule must be a JSON object with a `type` field.");
      return;
    }
    if (typeof (parsed as Record<string, unknown>).type !== "string") {
      setError("Schedule must have a string `type` (interval, daily, weekly, one_shot).");
      return;
    }
    setSaving("schedule");
    try {
      await onUpdate(wakeup.slug, { schedule: parsed });
      setEditingSchedule(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  function cancelScheduleEdit() {
    setScheduleDraft(JSON.stringify(wakeup.schedule, null, 2));
    setEditingSchedule(false);
    setError(null);
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-pv-bubble)] px-4 py-3 flex flex-col gap-2",
        "backdrop-blur-lg saturate-[1.3] [-webkit-backdrop-filter:blur(16px)_saturate(1.3)]",
        "font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]",
      )}
      style={{
        background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.5), hsla(${hue}, 35%, 14%, 0.55))`,
        border: `1px solid hsla(${hue}, 60%, 50%, 0.24)`,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.10)",
      }}
    >
      {/* Row 1: name + enabled toggle button (patch #154). Clicking flips
          enabled with an inline write; the fresh chip color comes back with
          the server response, so this is the sole source of truth. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-[15px] text-[#f0ebe0] flex-1">
          {wakeup.name}
        </span>
        <button
          type="button"
          onClick={toggleEnabled}
          disabled={saving === "enabled"}
          aria-label={wakeup.enabled ? "Disable this wakeup" : "Enable this wakeup"}
          title={wakeup.enabled ? "Disable" : "Enable"}
          className={cn(
            "cursor-pointer px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide border transition-opacity",
            saving === "enabled" && "opacity-50 cursor-wait",
            wakeup.enabled
              ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/35"
              : "bg-slate-500/25 text-slate-300 border-slate-500/40 hover:bg-slate-500/35",
          )}
        >
          {wakeup.enabled ? "on" : "off"}
        </button>
      </div>

      {/* Row 2: schedule human OR schedule JSON editor. Edit toggle is a
          small pencil next to the humanized line; expands the whole row into
          a textarea + Save/Cancel below. */}
      {!editingSchedule ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-pv-fg-muted)] font-mono flex-1">
            {wakeup.scheduleHuman}
          </span>
          <button
            type="button"
            onClick={() => setEditingSchedule(true)}
            aria-label="Edit schedule"
            title="Edit schedule"
            className="cursor-pointer text-[#a89a80] hover:text-[#f0ebe0] p-1 rounded transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={scheduleDraft}
            onChange={(e) => setScheduleDraft(e.target.value)}
            spellCheck={false}
            rows={Math.min(10, Math.max(3, scheduleDraft.split("\n").length))}
            className={cn(
              "w-full font-mono text-xs px-2 py-1.5 rounded",
              "bg-black/30 text-[#e8e4d8] border border-white/10",
              "focus:outline-none focus:border-white/25",
            )}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={saveSchedule}
              disabled={saving === "schedule"}
              className="cursor-pointer h-7 gap-1"
            >
              <Check className="size-3.5" />
              {saving === "schedule" ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={cancelScheduleEdit}
              disabled={saving === "schedule"}
              className="cursor-pointer h-7 gap-1"
            >
              <X className="size-3.5" />
              Cancel
            </Button>
            <span className="text-[10px] text-[var(--color-pv-fg-dim)] font-mono">
              Scheduler reloads every ~30s
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-300 whitespace-pre-wrap">{error}</div>
      )}

      {/* Row 3: instruction prose (unchanged from #17g). */}
      {wakeup.instruction && (
        <div className="whitespace-pre-wrap text-sm text-[#e8e4d8]/90 leading-relaxed">
          {wakeup.instruction}
        </div>
      )}
    </div>
  );
}
