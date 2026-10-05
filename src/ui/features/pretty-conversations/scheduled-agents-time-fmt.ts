/**
 * Compact relative-time formatters for the scheduled-agents modal row's
 * "Last run / Next run" line. Kept small on purpose — the modal shows
 * approximate elapsed/remaining time ("3h ago", "in 27m") with the absolute
 * datetime on hover; this file supplies both.
 *
 * The design idiom: single largest unit, rounded down. "1h 59m" → "1h".
 * Zero/negative inputs clamp sensibly ("just now" / "due now"). Thresholds:
 *   < 60s   → "just now" / "due now"
 *   < 60m   → "<n>m"
 *   < 24h   → "<n>h"
 *   < 30d   → "<n>d"
 *   >= 30d  → fallback to absolute `MMM D, YYYY` so "in 243d" doesn't appear.
 *
 * `nowSecs` is a parameter (not a `Date.now()` capture) so component callers
 * can thread a frozen-for-render timestamp if they ever want flicker-free
 * rendering during re-renders. For now, the row component passes
 * `Date.now()/1000` directly.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Absolute `MMM D, HH:MM` — the title/tooltip rendering for a last/next
 *  epoch. Year is appended when the timestamp isn't in the same calendar
 *  year as `nowSecs`, so a spec due in Feb 2027 doesn't read ambiguously. */
export function formatAbsolute(epochSecs: number, nowSecs: number): string {
  const d = new Date(epochSecs * 1000);
  const now = new Date(nowSecs * 1000);
  const same = d.getFullYear() === now.getFullYear();
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return same ? base : `${base}, ${d.getFullYear()}`;
}

/** "3h ago" / "47m ago" / "2d ago". Returns "just now" within 60s. For
 *  deltas >= 30d, returns the absolute MMM-D-YYYY date — the "ago" grammar
 *  reads awkwardly past a month and the exact date is more useful. */
export function formatRelativePast(epochSecs: number, nowSecs: number): string {
  const delta = Math.max(0, nowSecs - epochSecs);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 30 * 86400) return `${Math.floor(delta / 86400)}d ago`;
  const d = new Date(epochSecs * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "in 27m" / "in 3h" / "in 2d" — the forward mirror of formatRelativePast.
 *  Returns "due now" when the slot is in the past (scheduler would fire on
 *  the next tick, within ~30s). */
export function formatRelativeFuture(epochSecs: number, nowSecs: number): string {
  const delta = epochSecs - nowSecs;
  if (delta <= 0) return "due now";
  if (delta < 60) return "in <1m";
  if (delta < 3600) return `in ${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `in ${Math.floor(delta / 3600)}h`;
  if (delta < 30 * 86400) return `in ${Math.floor(delta / 86400)}d`;
  const d = new Date(epochSecs * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
