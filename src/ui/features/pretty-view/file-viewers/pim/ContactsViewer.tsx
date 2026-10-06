import { useEffect, useMemo, useState } from "react";
import { Building2, Cake, Globe, Mail, MapPin, Phone, Search, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import { parseContacts, type Contact } from "./contacts-model";

/**
 * Contacts (.vcf) viewer, view-only: a card per contact (photo, name,
 * organisation, phones, emails, addresses, links, birthday, note) with
 * tap-to-call / mail links; files with several contacts get a searchable
 * list beside the card.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function Avatar({ c, size }: { c: Contact; size: number }): JSX.Element {
  return c.photo ? (
    <img src={c.photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-[#3a3428] font-semibold text-[#e8e4d8]" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(c.name)}
    </div>
  );
}

function Row({ icon, children }: { icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-[#a89a80]">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ContactCard({ c }: { c: Contact }): JSX.Element {
  return (
    <article className="flex flex-col gap-3 p-5" data-testid="contact-card">
      <div className="flex items-center gap-4">
        <Avatar c={c} size={72} />
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold text-[#fbf5e8]">{c.name}</h3>
          {c.title || c.org ? <div className="text-[13px] text-[#a89a80]">{[c.title, c.org].filter(Boolean).join(" · ")}</div> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        {c.phones.map((p, i) => (
          <Row key={`p${i}`} icon={<Phone size={14} aria-hidden />}>
            <a href={`tel:${p.value.replace(/[^\d+]/g, "")}`} className="text-[#9fb4e8] hover:underline">{p.value}</a>
            {p.type ? <span className="ml-2 text-[11.5px] text-[#7d725f]">{p.type}</span> : null}
          </Row>
        ))}
        {c.emails.map((e, i) => (
          <Row key={`e${i}`} icon={<Mail size={14} aria-hidden />}>
            <a href={`mailto:${e.value}`} className="break-all text-[#9fb4e8] hover:underline">{e.value}</a>
            {e.type ? <span className="ml-2 text-[11.5px] text-[#7d725f]">{e.type}</span> : null}
          </Row>
        ))}
        {c.addresses.map((a, i) => (
          <Row key={`a${i}`} icon={<MapPin size={14} aria-hidden />}>
            <span>{a.value}</span>
            {a.type ? <span className="ml-2 text-[11.5px] text-[#7d725f]">{a.type}</span> : null}
          </Row>
        ))}
        {c.urls.map((u, i) => (
          <Row key={`u${i}`} icon={<Globe size={14} aria-hidden />}>
            <a href={/^https?:/i.test(u) ? u : `https://${u}`} target="_blank" rel="noopener noreferrer" className="break-all text-[#9fb4e8] hover:underline">{u}</a>
          </Row>
        ))}
        {c.org && !c.title ? null : null}
        {c.birthday ? <Row icon={<Cake size={14} aria-hidden />}>{c.birthday}</Row> : null}
        {c.note ? (
          <Row icon={<StickyNote size={14} aria-hidden />}>
            <p className="whitespace-pre-wrap text-[#cfc8b8]">{c.note}</p>
          </Row>
        ) : null}
        {!c.phones.length && !c.emails.length && !c.addresses.length && c.org ? (
          <Row icon={<Building2 size={14} aria-hidden />}>{c.org}</Row>
        ) : null}
      </div>
    </article>
  );
}

export default function ContactsViewer({ src }: FileModeViewProps): JSX.Element {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setContacts(null);
    setError(null);
    setSelected(0);
    fetch(src, { credentials: "same-origin", signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't download the contacts (HTTP ${r.status}).`);
        return r.text();
      })
      .then((text) => !ctrl.signal.aborted && setContacts(parseContacts(text)))
      .catch((err: unknown) => !ctrl.signal.aborted && setError(err instanceof Error ? err.message : "These contacts couldn't be read."));
    return () => ctrl.abort();
  }, [src]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (contacts ?? [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !q || [c.name, c.org, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value)].some((v) => v?.toLowerCase().includes(q)));
  }, [contacts, query]);

  if (error) return <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="contacts-error">{error}</div>;
  if (!contacts) return <div className="p-6 text-center text-sm text-[#a89a80]">Reading contacts…</div>;
  if (contacts.length === 1) {
    return (
      <div className="h-full min-h-[300px] overflow-y-auto text-[#e8e4d8]" data-testid="contacts-viewer">
        <div className="mx-auto max-w-xl">
          <ContactCard c={contacts[0]} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-[360px] text-[#e8e4d8]" data-testid="contacts-viewer">
      <nav className="flex w-64 shrink-0 flex-col border-r border-[#2e2a22]" aria-label="Contacts">
        <div className="flex items-center gap-1.5 border-b border-[#2e2a22] px-2 py-1.5">
          <Search size={13} className="text-[#7d725f]" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${contacts.length} contacts`} className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map(({ c, i }) => (
            <button key={i} type="button" onClick={() => setSelected(i)} className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[#2a251c]", selected === i && "bg-[#3a3428]")}>
              <Avatar c={c} size={28} />
              <div className="min-w-0">
                <div className="truncate text-[12.5px]">{c.name}</div>
                {c.org ? <div className="truncate text-[11px] text-[#7d725f]">{c.org}</div> : null}
              </div>
            </button>
          ))}
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">{contacts[selected] ? <ContactCard c={contacts[selected]} /> : null}</div>
    </div>
  );
}
