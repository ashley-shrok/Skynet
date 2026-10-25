// The agent window's Wake-ups tab: a short note on what wake-ups are, then
// one row per wake-up — its kind, name, schedule and last fire (or its
// sensor's state), an on/off switch that saves at once, and a chevron. The
// row opens the wake-up one level deeper in the same window (WakeupView);
// "New wake-up" opens a blank one there.
//
// Coordinators manage wake-ups from their roles, so a coordinator with none
// gets the caption and no button.

import { useState } from "react";
import { AlarmClock, CalendarClock, Plus, Radio } from "lucide-react";
import {
  KitBanner,
  KitButton,
  KitEmpty,
  KitLoading,
  KitSettingsGroup,
  KitSettingsRow,
  KitSwitch,
  kitConfirm,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import { RowGestures } from "@/features/pretty-conversations/RowKebabMenu";
import type { Wakeup } from "@/api/claude-session-api";
import type { SensorStatus } from "@/api/sensor-status-types";
import {
  formatAbsolute,
  formatRelativePast,
} from "@/features/pretty-conversations/scheduled-agents-time-fmt";
import type { TabState } from "./IdentityFileTab";
import { SENSOR_MARK, SensorStateChip, lastFiredLabel, trippedReasonText } from "./SensorStatusView";
import { isOnceSensorSchedule, isSensorSchedule } from "./WakeupFormShared";

export const WAKEUPS_NOTE =
  "Instructions that wake this agent on a clock, or when a sensor sees something happen. They go when the agent is archived.";

/** The unopened row's sensor line: "📡 Sensor [Healthy] · Last fired 3h ago · 2 waiting". */
function WakeupSensorSummary({
  sensor,
  lastFiredAt,
  once,
  testId,
}: {
  sensor: SensorStatus;
  lastFiredAt: number | null | undefined;
  once: boolean;
  testId: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 flex-wrap" data-testid={testId}>
      <span>
        <span aria-hidden="true">{SENSOR_MARK} </span>
        {once ? "Sensor · once" : "Sensor"}
      </span>
      <SensorStateChip state={sensor.state} testId={`${testId}-state`} />
      <span title={typeof lastFiredAt === "number" ? formatAbsolute(lastFiredAt, now) : undefined}>
        {typeof lastFiredAt === "number"
          ? `Last fired ${formatRelativePast(lastFiredAt, now)}`
          : "Never fired"}
      </span>
      {trippedReasonText(sensor) && (
        <span data-testid={`${testId}-tripped`}>· {trippedReasonText(sensor)}</span>
      )}
    </span>
  );
}

/** Small tile showing what kind of trigger a wake-up has. */
export function WakeupKindTile({ wakeup, off }: { wakeup: Pick<Wakeup, "schedule">; off?: boolean }) {
  const type = (wakeup.schedule as { type?: unknown } | null)?.type;
  const Icon = isSensorSchedule(wakeup.schedule) ? Radio : type === "one_shot" ? CalendarClock : AlarmClock;
  return (
    <span
      className={cn(
        "size-8 rounded-[9px] bg-[var(--k-s2)] text-[var(--k-t2)] grid place-items-center shrink-0",
        off && "opacity-50",
      )}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

function NewWakeupButton({ onClick, variant }: { onClick: () => void; variant: "plain" | "primary" }) {
  return (
    <KitButton size="sm" variant={variant} onClick={onClick} data-testid="wakeup-add-button">
      <Plus />
      New wake-up
    </KitButton>
  );
}

export function WakeupsTab({
  state,
  isCoordinator,
  onToggle,
  onOpen,
  onNew,
  onDelete,
}: {
  state: TabState<Wakeup[]>;
  /** Coordinators manage wake-ups from their roles: no button on an empty list. */
  isCoordinator: boolean;
  onToggle: (slug: string, enabled: boolean) => Promise<void>;
  onOpen: (slug: string) => void;
  onNew: () => void;
  /** Swipe left on a row (touch) deletes it, after the same confirm as the
   *  wake-up's own "Delete wake-up…". */
  onDelete?: (slug: string) => Promise<void>;
}) {
  // Rows with an on/off save in flight (several can be at once).
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") return <KitLoading lines={3} />;
  if (state.status === "error") {
    return <KitBanner tone="danger">Couldn&apos;t load wake-ups: {state.error}</KitBanner>;
  }

  if (state.data.length === 0) {
    if (isCoordinator) {
      return (
        <KitEmpty
          data-testid="wakeups-coordinator-empty-identity"
          title="Coordinators use role-scope wakeups only."
          body="Switch to Role view to manage."
        />
      );
    }
    return (
      <KitEmpty
        icon={<AlarmClock />}
        title="No wake-ups yet"
        body={`${WAKEUPS_NOTE} Ask the agent to make one, or add one here.`}
        action={<NewWakeupButton variant="primary" onClick={onNew} />}
      />
    );
  }

  const toggle = async (w: Wakeup, enabled: boolean): Promise<void> => {
    setError(null);
    setBusy((b) => new Set(b).add(w.slug));
    try {
      await onToggle(w.slug, enabled);
    } catch (e) {
      setError(`Couldn't turn “${w.name}” ${enabled ? "on" : "off"}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(w.slug);
        return next;
      });
    }
  };

  const remove = async (w: Wakeup): Promise<void> => {
    if (!onDelete) return;
    const ok = await kitConfirm({
      title: "Delete this wake-up?",
      body: `“${w.name}” will stop firing. This can't be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await onDelete(w.slug);
      console.info({ operation: "wakeup_deleted", slug: w.slug, from: "list-swipe" });
    } catch (e) {
      setError(`Couldn't delete “${w.name}”: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <KitSettingsGroup note={WAKEUPS_NOTE} data-testid="wakeups-list">
        {state.data.map((w) => (
          <RowGestures
            key={w.slug}
            swipe={onDelete ? { label: "Delete", onSwipe: () => remove(w) } : undefined}
          >
            {(g) => (
          <KitSettingsRow
            holdProps={g.holdProps}
            data-testid={`wakeup-row-${w.slug}`}
            leading={<WakeupKindTile wakeup={w} off={!w.enabled} />}
            label={<span className={cn("font-semibold", !w.enabled && "text-[var(--k-t2)]")}>{w.name}</span>}
            openLabel={`Open ${w.name}`}
            description={
              w.sensor ? (
                <WakeupSensorSummary
                  sensor={w.sensor}
                  lastFiredAt={w.lastFiredAt}
                  once={isOnceSensorSchedule(w.schedule)}
                  testId="wakeup-sensor-summary"
                />
              ) : (
                <span>
                  {w.scheduleHuman}
                  <span data-testid="wakeup-last-fired">
                    {" · "}
                    {lastFiredLabel(w.lastFiredAt)}
                  </span>
                </span>
              )
            }
            control={
              <KitSwitch
                checked={w.enabled}
                onCheckedChange={(next) => void toggle(w, next)}
                disabled={busy.has(w.slug)}
                aria-label={w.enabled ? `Turn off ${w.name}` : `Turn on ${w.name}`}
                data-testid={`wakeup-switch-${w.slug}`}
              />
            }
            onClick={() => onOpen(w.slug)}
          >
            {g.swipeAction}
          </KitSettingsRow>
            )}
          </RowGestures>
        ))}
      </KitSettingsGroup>
      {error && (
        <KitBanner tone="danger" onDismiss={() => setError(null)}>
          <span className="whitespace-pre-wrap">{error}</span>
        </KitBanner>
      )}
      <div>
        <NewWakeupButton variant="plain" onClick={onNew} />
      </div>
    </div>
  );
}
