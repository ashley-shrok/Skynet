import { useEffect, useState } from "react";
import { CalendarDays, Clock, Download, MapPin, Repeat, User, Users } from "lucide-react";
import type { FileModeViewProps } from "../registry";
import { parseCalendar, type CalEvent, type Calendar } from "./calendar-model";

/**
 * Calendar (.ics) viewer, view-only: one event as a card, several as an
 * agenda grouped by day. Times in the viewer's timezone, with the event's
 * own zone noted when it differs. Download adds it to a calendar app.
 */

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function when(ev: CalEvent): string {
  if (!ev.start) return "No date";
  const dateOpts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
  if (ev.allDay) {
    const last = ev.end ? new Date(ev.end.getTime() - 86_400_000) : null;
    const first = ev.start.toLocaleDateString(undefined, dateOpts);
    return last && last.toDateString() !== ev.start.toDateString() ? `${first} – ${last.toLocaleDateString(undefined, dateOpts)} (all day)` : `${first} (all day)`;
  }
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = ev.end && ev.end.toDateString() === ev.start.toDateString();
  return `${ev.start.toLocaleDateString(undefined, dateOpts)}, ${time(ev.start)}${ev.end ? ` – ${sameDay ? time(ev.end) : `${ev.end.toLocaleDateString(undefined, dateOpts)}, ${time(ev.end)}`}` : ""}`;
}

function zoneNote(ev: CalEvent): string | null {
  if (!ev.timezone || ev.timezone === localZone || ev.allDay || !ev.start) return null;
  const there = ev.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: ev.timezone });
  return `${there} in ${ev.timezone.replace(/_/g, " ")}`;
}

const STATUS: Record<string, string> = {
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "maybe",
  "NEEDS-ACTION": "hasn't replied",
  DELEGATED: "delegated",
};

function EventCard({ ev }: { ev: CalEvent }): JSX.Element {
  const zone = zoneNote(ev);
  return (
    <article className="rounded-lg border border-[#2e2a22] bg-[#1d1a15] p-4" data-testid="calendar-event">
      <h3 className="mb-2 text-[16px] font-semibold text-[#fbf5e8]">
        {ev.title}
        {ev.status === "CANCELLED" ? <span className="ml-2 rounded bg-[#5a2e22] px-1.5 text-[11px] text-[#fbe3d8]">Cancelled</span> : null}
      </h3>
      <div className="flex flex-col gap-1.5 text-[13px]">
        <div className="flex gap-2">
          <Clock size={14} className="mt-0.5 shrink-0 text-[#a89a80]" aria-hidden />
          <span>
            {when(ev)}
            {zone ? <span className="text-[#a89a80]"> · {zone}</span> : null}
          </span>
        </div>
        {ev.repeats ? (
          <div className="flex gap-2">
            <Repeat size={14} className="mt-0.5 shrink-0 text-[#a89a80]" aria-hidden />
            <span>{ev.repeats}</span>
          </div>
        ) : null}
        {ev.location ? (
          <div className="flex gap-2">
            <MapPin size={14} className="mt-0.5 shrink-0 text-[#a89a80]" aria-hidden />
            <span className="whitespace-pre-wrap">{ev.location}</span>
          </div>
        ) : null}
        {ev.organizer ? (
          <div className="flex gap-2">
            <User size={14} className="mt-0.5 shrink-0 text-[#a89a80]" aria-hidden />
            <span>Organised by {ev.organizer}</span>
          </div>
        ) : null}
        {ev.attendees.length ? (
          <div className="flex gap-2">
            <Users size={14} className="mt-0.5 shrink-0 text-[#a89a80]" aria-hidden />
            <ul className="flex flex-col gap-0.5">
              {ev.attendees.map((a, i) => (
                <li key={i}>
                  {a.name}
                  {a.email && a.email !== a.name ? <span className="text-[#7d725f]"> &lt;{a.email}&gt;</span> : null}
                  {a.status && STATUS[a.status] ? <span className="ml-1.5 text-[11.5px] text-[#a89a80]">— {STATUS[a.status]}</span> : null}
                  {a.role === "OPT-PARTICIPANT" ? <span className="ml-1 text-[11.5px] text-[#7d725f]">(optional)</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {ev.url ? (
          <a href={ev.url} target="_blank" rel="noopener noreferrer" className="w-fit text-[#9fb4e8] hover:underline">
            {ev.url}
          </a>
        ) : null}
        {ev.description ? <p className="mt-1 whitespace-pre-wrap rounded bg-[#13151c] p-2.5 text-[12.5px] text-[#cfc8b8]">{ev.description}</p> : null}
      </div>
    </article>
  );
}

export default function CalendarViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const [cal, setCal] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setCal(null);
    setError(null);
    fetch(src, { credentials: "same-origin", signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't download the calendar (HTTP ${r.status}).`);
        return r.text();
      })
      .then((text) => !ctrl.signal.aborted && setCal(parseCalendar(text)))
      .catch((err: unknown) => !ctrl.signal.aborted && setError(err instanceof Error ? err.message : "This calendar couldn't be read."));
    return () => ctrl.abort();
  }, [src]);

  if (error) return <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="calendar-error">{error}</div>;
  if (!cal) return <div className="p-6 text-center text-sm text-[#a89a80]">Reading calendar…</div>;

  // Agenda: group by local day.
  const groups = new Map<string, CalEvent[]>();
  for (const ev of cal.events) {
    const key = ev.start ? ev.start.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "No date";
    groups.set(key, [...(groups.get(key) ?? []), ev]);
  }
  const heading =
    cal.method === "REQUEST" ? "Invitation" : cal.method === "CANCEL" ? "Cancellation" : cal.name ?? (cal.events.length === 1 ? "Event" : `${cal.events.length} events`);

  return (
    <div className="h-full min-h-[360px] overflow-y-auto text-[#e8e4d8]" data-testid="calendar-viewer">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-[12.5px] text-[#a89a80]">
          <CalendarDays size={14} aria-hidden />
          <span>{heading}</span>
          {src ? (
            <a href={src} download={filename.slice(filename.lastIndexOf("/") + 1)} className="ml-auto inline-flex items-center gap-1 rounded border border-[#3a3428] px-2 py-0.5 text-[#e8e4d8] hover:bg-[#2a251c]">
              <Download size={12} aria-hidden /> Add to calendar (.ics)
            </a>
          ) : null}
        </div>
        {cal.events.length === 1 ? (
          <EventCard ev={cal.events[0]} />
        ) : (
          [...groups.entries()].map(([day, evs]) => (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="text-[12px] font-medium uppercase tracking-wide text-[#a89a80]">{day}</h2>
              {evs.map((ev, i) => (
                <EventCard key={i} ev={ev} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
