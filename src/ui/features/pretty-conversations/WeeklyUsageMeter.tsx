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

  return (
    <div className="pv-usage-meter">
      <MeterRow
        label="5h"
        usagePct={data.five_hour.used_percentage}
        elapsedPct={fiveHourElapsed}
      />
      <MeterRow
        label="Week"
        usagePct={data.seven_day.used_percentage}
        elapsedPct={sevenDayElapsed}
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
}: {
  label: string;
  usagePct: number;
  elapsedPct: number;
}) {
  return (
    <div className="pv-usage-meter-row">
      <span className="pv-usage-meter-label">{label}</span>
      <div className="pv-usage-meter-bar">
        <div
          className="pv-usage-meter-fill-usage"
          style={{ width: `${usagePct}%` }}
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
