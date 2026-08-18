// ─── WeeklyUsageMeter ─────────────────────────────────────────────────────────
// Single-bar fill+tick meter (Ashley 2026-07-29 pick — B variant from the
// tune-meter picker). Two rows (5h + Week), each showing:
//   full-height coral usage fill (width = data.X.used_percentage %)
//   thin cyan tick at the elapsed-time position (left = elapsedPct %)
// No numeric percentage text — bars alone communicate progress (Ashley
// 2026-07-29, bounty `remove-percentages-on-5h-weekly-meters`).
//
// Polling: fetch('/api/usage') immediately on mount, then every 15s.
// Failure: silently retains last-known data; never clears state on error.
// First-load failure: renders aria-busy empty container (layout stable).

import { useEffect, useState } from "react";

// Green→amber→red band matches the ComposeBox context-window meter
// (ComposeBox.tsx §Phase 9 UAT, patch #83+ — thresholds locked 2026-07-22).
// Same thresholds, same hsla values, same visual language; values duplicated
// rather than shared because the two meters have different geometry
// (12-segment well vs single continuous fill) and no other consumer.
type UsageBand = "green" | "amber" | "red";

function bandFor(pct: number): UsageBand {
  if (pct >= 78) return "red";
  if (pct >= 45) return "amber";
  return "green";
}

const BAND_FILL_STYLE: Record<UsageBand, { background: string; boxShadow: string }> = {
  green: {
    background: "linear-gradient(90deg, hsla(155,45%,52%,1), hsla(155,45%,42%,1))",
    boxShadow: "0 0 12px hsla(155,45%,45%,0.6), inset 0 1px 0 rgba(220,255,235,0.35)",
  },
  amber: {
    background: "linear-gradient(90deg, hsla(38,75%,55%,1), hsla(38,75%,45%,1))",
    boxShadow: "0 0 12px hsla(38,75%,55%,0.6), inset 0 1px 0 rgba(255,240,200,0.35)",
  },
  red: {
    background: "linear-gradient(90deg, hsla(0,72%,55%,1), hsla(0,72%,42%,1))",
    boxShadow: "0 0 12px hsla(0,72%,55%,0.7), inset 0 1px 0 rgba(255,220,200,0.35)",
  },
};

interface UsageWindow {
  /** 0–100 (percentage of the rate-limit window consumed) */
  used_percentage: number;
  /** Unix timestamp (seconds) when this window resets */
  resets_at: number;
}

interface UsageResponse {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  updated_at: number;
  source_box: string;
}

/** 5-hour window in seconds */
const FIVE_HOUR_WINDOW_S = 18000;
/** 7-day window in seconds */
const SEVEN_DAY_WINDOW_S = 604800;

/**
 * Compute the elapsed percentage for a given window.
 * elapsed% = (now - windowStart) / windowS * 100
 *          = (now - (resets_at - windowS)) / windowS * 100
 * Clamped to [0, 100].
 */
function elapsedPct(resetsAt: number, windowS: number): number {
  const nowS = Date.now() / 1000;
  const raw = ((nowS - (resetsAt - windowS)) / windowS) * 100;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Format seconds as a compact `Xd Yh Zm` duration string, dropping
 * leading zero units. Never returns empty — clamped to `0m` at/below 0.
 * Used for the bar hover tooltip so Ashley can see exactly how much
 * time is left in the window (the cyan tick indicates elapsed position
 * visually; this puts a number on the remainder). 2026-08-18.
 */
export function formatDurationRemaining(seconds: number): string {
  if (seconds <= 0) return "0m";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function WeeklyUsageMeter() {
  const [data, setData] = useState<UsageResponse | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/usage");
        if (!res.ok) return; // non-2xx: retain last-known, do not clear
        const json = (await res.json()) as UsageResponse;
        setData(json);
      } catch {
        // Network error / timeout: silently retain last-known values (WEEKLY-METER-04)
      }
    }

    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, []);

  if (data === null) {
    // Stable empty container while first fetch is in-flight
    return <div className="pv-usage-meter" aria-busy="true" />;
  }

  const fiveHourElapsed = elapsedPct(data.five_hour.resets_at, FIVE_HOUR_WINDOW_S);
  const sevenDayElapsed = elapsedPct(data.seven_day.resets_at, SEVEN_DAY_WINDOW_S);

  const nowS = Date.now() / 1000;

  return (
    <div className="pv-usage-meter">
      <MeterRow
        label="5h"
        usagePct={data.five_hour.used_percentage}
        elapsedPct={fiveHourElapsed}
        secondsUntilReset={data.five_hour.resets_at - nowS}
      />
      <MeterRow
        label="Week"
        usagePct={data.seven_day.used_percentage}
        elapsedPct={sevenDayElapsed}
        secondsUntilReset={data.seven_day.resets_at - nowS}
      />
    </div>
  );
}

// ─── MeterRow ─────────────────────────────────────────────────────────────────
// Renders one row (label + bar). Bar = full-height coral usage fill (width =
// usagePct%) plus a thin cyan tick at the elapsed-time position (left =
// elapsedPct%). One bar, two pieces of information.
function MeterRow({
  label,
  usagePct,
  elapsedPct,
  secondsUntilReset,
}: {
  label: string;
  usagePct: number;
  elapsedPct: number;
  secondsUntilReset: number;
}) {
  const bandStyle = BAND_FILL_STYLE[bandFor(usagePct)];
  // Native title hover — pairs with the visual tick so Ashley can read the
  // exact remaining time instead of eyeballing the gap. Refreshes each
  // 15s poll, so displayed value is within 15s of real (fine at m-precision).
  const title = `Resets in ${formatDurationRemaining(secondsUntilReset)}`;
  return (
    <div className="pv-usage-meter-row">
      <span className="pv-usage-meter-label">{label}</span>
      <div className="pv-usage-meter-bar" title={title}>
        <div
          className="pv-usage-meter-fill-usage"
          style={{ width: `${usagePct}%`, ...bandStyle }}
        />
        <div
          className="pv-usage-meter-tick"
          style={{ left: `${elapsedPct}%` }}
        />
      </div>
    </div>
  );
}

export default WeeklyUsageMeter;
