import ICAL from "ical.js";

/**
 * iCalendar (.ics) events via ical.js (Mozilla's parser, as in Thunderbird):
 * times in the viewer's timezone with the event's own zone kept, attendees
 * with their replies, and repeat rules in plain English.
 */

export interface CalAttendee {
  name: string;
  email: string | null;
  status: string | null;
  role: string | null;
}

export interface CalEvent {
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  /** The event's own timezone, when it isn't floating / UTC. */
  timezone: string | null;
  location: string | null;
  description: string | null;
  organizer: string | null;
  attendees: CalAttendee[];
  repeats: string | null;
  url: string | null;
  status: string | null;
}

export interface Calendar {
  name: string | null;
  /** iTIP method: REQUEST = an invitation, CANCEL = a cancellation, … */
  method: string | null;
  events: CalEvent[];
}

const mailto = (v: string | null | undefined) => (v ? v.replace(/^mailto:/i, "") : null);

const DAY_NAMES: Record<string, string> = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };
const ordinal = (n: number) => (n === -1 ? "last" : `${n}${["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`);

/** "Every 2 weeks on Monday and Wednesday, 10 times" from an RRULE. */
export function describeRecurrence(rule: { freq?: string; interval?: number; count?: number; until?: { toJSDate(): Date } | null; parts?: Record<string, (string | number)[]> }): string {
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year", HOURLY: "hour", MINUTELY: "minute", SECONDLY: "second" }[rule.freq ?? ""] ?? "time";
  const n = rule.interval ?? 1;
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.freq === "DAILY" && n === 1) text = "Daily";
  if (rule.freq === "WEEKLY" && n === 1) text = "Weekly";
  if (rule.freq === "MONTHLY" && n === 1) text = "Monthly";
  if (rule.freq === "YEARLY" && n === 1) text = "Yearly";
  const byday = rule.parts?.BYDAY as string[] | undefined;
  if (byday?.length) {
    const days = byday.map((d) => {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(String(d));
      if (!m) return String(d);
      return m[1] ? `the ${ordinal(Number(m[1]))} ${DAY_NAMES[m[2]] ?? m[2]}` : DAY_NAMES[m[2]] ?? m[2];
    });
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days[0];
    text += ` on ${list}`;
  } else if (rule.parts?.BYMONTHDAY?.length) {
    text += ` on day ${(rule.parts.BYMONTHDAY as number[]).join(", ")}`;
  }
  if (rule.count) text += `, ${rule.count} times`;
  else if (rule.until) text += `, until ${rule.until.toJSDate().toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  return text;
}

export function parseCalendar(text: string): Calendar {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new Error("This isn't a calendar file the viewer can read.");
  }
  const roots = Array.isArray((jcal as unknown[])[0]) ? (jcal as unknown[]) : [jcal];
  const events: CalEvent[] = [];
  let name: string | null = null;
  let method: string | null = null;
  for (const root of roots) {
    const cal = new ICAL.Component(root as never);
    if (cal.name !== "vcalendar") continue;
    name ??= (cal.getFirstPropertyValue("x-wr-calname") as string | null) ?? null;
    method ??= (cal.getFirstPropertyValue("method") as string | null) ?? null;
    for (const tz of cal.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
    for (const vevent of cal.getAllSubcomponents("vevent")) {
      const ev = new ICAL.Event(vevent);
      const start = ev.startDate;
      const end = ev.endDate;
      const zone = start?.zone?.tzid && !["floating", "UTC"].includes(start.zone.tzid) ? start.zone.tzid : null;
      const rrule = vevent.getFirstPropertyValue("rrule") as Parameters<typeof describeRecurrence>[0] | null;
      const organizerProp = vevent.getFirstProperty("organizer");
      events.push({
        title: ev.summary || "(untitled event)",
        start: start ? start.toJSDate() : null,
        end: end ? end.toJSDate() : null,
        allDay: !!start?.isDate,
        timezone: zone,
        location: ev.location || null,
        description: ev.description || null,
        organizer: organizerProp ? ((organizerProp.getParameter("cn") as string) || mailto(organizerProp.getFirstValue() as string)) : null,
        attendees: ev.attendees.map((a) => ({
          name: (a.getParameter("cn") as string) || mailto(a.getFirstValue() as string) || "Attendee",
          email: mailto(a.getFirstValue() as string),
          status: (a.getParameter("partstat") as string) || null,
          role: (a.getParameter("role") as string) || null,
        })),
        repeats: rrule ? describeRecurrence(rrule) : null,
        url: (vevent.getFirstPropertyValue("url") as string | null) ?? null,
        status: (vevent.getFirstPropertyValue("status") as string | null) ?? null,
      });
    }
  }
  if (!events.length) throw new Error("This calendar file has no events.");
  events.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  return { name, method, events };
}
