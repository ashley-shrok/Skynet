import { useEffect, useState } from "react";
import { CalendarDays, Mail, Paperclip, UserRound } from "lucide-react";
import { fetchTextPrefix, useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";

/** Chat-chip previews: email summary, next event(s), contact(s). */

const MAX_BYTES = 5 * 1024 * 1024;

function useChipData<T>(url: string, onError: () => void, load: (signal: AbortSignal) => Promise<T>) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    load(ctrl.signal).then(
      (d) => !ctrl.signal.aborted && setData(d),
      () => !ctrl.signal.aborted && onError(),
    );
    return () => ctrl.abort();
    // load / onError are fresh closures each render; the work depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);
  return { setEl, data };
}

const Loading = () => <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading…</div>;

export function EmailChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const { setEl, data } = useChipData(url, onError, async (signal) => {
    const res = await fetch(url, { credentials: "same-origin", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES * 4) throw new Error("too large");
    const { parseMail } = await import("./mail-model");
    const mail = await parseMail(filename, bytes);
    const plain = mail.text ?? (mail.html ? new DOMParser().parseFromString(mail.html, "text/html").body.textContent ?? "" : "");
    return { ...mail, snippet: plain.replace(/\s+/g, " ").trim().slice(0, 220) };
  });
  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="email-chip-preview">
      {data ? (
        <div className="px-2.5 py-2 text-[11.5px] leading-[1.45]">
          <div className="flex items-center gap-1.5 font-medium text-[#e8e4d8]">
            <Mail size={12} aria-hidden />
            <span className="truncate">{data.subject || "(no subject)"}</span>
          </div>
          <div className="truncate text-[#a89a80]">
            {data.from}
            {data.date ? ` · ${data.date.toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}
          </div>
          {data.snippet ? <p className="mt-1 line-clamp-3 text-[#cfc8b8]">{data.snippet}</p> : null}
          {data.attachments.length ? (
            <div className="mt-1 flex items-center gap-1 text-[#7d725f]">
              <Paperclip size={11} aria-hidden /> {data.attachments.length} attachment{data.attachments.length === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

export function CalendarChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const { setEl, data } = useChipData(url, onError, async (signal) => {
    const { text, partial } = await fetchTextPrefix(url, MAX_BYTES, signal);
    if (partial) throw new Error("too large");
    const { parseCalendar } = await import("./calendar-model");
    return parseCalendar(text);
  });
  const ev = data?.events[0];
  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="calendar-chip-preview">
      {data && ev ? (
        <div className="px-2.5 py-2 text-[11.5px] leading-[1.45]">
          <div className="flex items-center gap-1.5 font-medium text-[#e8e4d8]">
            <CalendarDays size={12} aria-hidden />
            <span className="truncate">{data.events.length === 1 ? ev.title : `${data.events.length} events`}</span>
          </div>
          {data.events.slice(0, data.events.length === 1 ? 1 : 3).map((e, i) => (
            <div key={i} className="truncate text-[#a89a80]">
              {data.events.length > 1 ? `${e.title} · ` : ""}
              {e.start ? e.start.toLocaleString(undefined, e.allDay ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }) : ""}
              {data.events.length === 1 && e.location ? ` · ${e.location}` : ""}
            </div>
          ))}
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

export function ContactsChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const { setEl, data } = useChipData(url, onError, async (signal) => {
    const { text, partial } = await fetchTextPrefix(url, MAX_BYTES, signal);
    if (partial) throw new Error("too large");
    const { parseContacts } = await import("./contacts-model");
    return parseContacts(text);
  });
  const c = data?.[0];
  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="contacts-chip-preview">
      {data && c ? (
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-[11.5px] leading-[1.4]">
          {c.photo && data.length === 1 ? (
            <img src={c.photo} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a3428]">
              <UserRound size={16} className="text-[#cfc8b8]" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-[#e8e4d8]">{data.length === 1 ? c.name : `${data.length} contacts`}</div>
            <div className="truncate text-[#a89a80]">
              {data.length === 1 ? [c.org, c.emails[0]?.value ?? c.phones[0]?.value].filter(Boolean).join(" · ") : data.slice(0, 3).map((x) => x.name).join(", ")}
            </div>
          </div>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}
