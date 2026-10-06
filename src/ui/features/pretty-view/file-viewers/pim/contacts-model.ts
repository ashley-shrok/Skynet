import ICAL from "ical.js";

/**
 * vCards (.vcf): v3 / v4 through ical.js; the older v2.1 that phones still
 * export (QUOTED-PRINTABLE, bare type parameters) through a small tolerant
 * line parser.
 */

export interface ContactField {
  value: string;
  type: string | null;
}

export interface Contact {
  name: string;
  org: string | null;
  title: string | null;
  phones: ContactField[];
  emails: ContactField[];
  addresses: ContactField[];
  urls: string[];
  birthday: string | null;
  note: string | null;
  photo: string | null;
}

type RawProp = { name: string; params: Record<string, string>; value: string };

function decodeQP(text: string, charset: string | undefined): string {
  const bytes: number[] = [];
  const s = text.replace(/=\r?\n/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i));
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}

/** Minimal vCard reader (any version); used for 2.1 and as a fallback. */
export function parseRawVcards(text: string): RawProp[][] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else if (unfolded.length && /=$/.test(unfolded[unfolded.length - 1]) && /QUOTED-PRINTABLE/i.test(unfolded[unfolded.length - 1])) unfolded[unfolded.length - 1] += `\n${line}`;
    else unfolded.push(line);
  }
  const cards: RawProp[][] = [];
  let current: RawProp[] | null = null;
  for (const line of unfolded) {
    const m = /^(?:[\w-]+\.)?([\w-]+)((?:;[^:]*)?):(.*)$/s.exec(line);
    if (!m) continue;
    const name = m[1].toUpperCase();
    if (name === "BEGIN" && /vcard/i.test(m[3])) current = [];
    else if (name === "END" && /vcard/i.test(m[3])) {
      if (current) cards.push(current);
      current = null;
    } else if (current) {
      const params: Record<string, string> = {};
      for (const p of m[2].split(";").filter(Boolean)) {
        const [k, v] = p.split("=");
        if (v === undefined) params.TYPE = params.TYPE ? `${params.TYPE},${k}` : k;
        else params[k.toUpperCase()] = params[k.toUpperCase()] ? `${params[k.toUpperCase()]},${v}` : v;
      }
      let value = m[3];
      if (/QUOTED-PRINTABLE/i.test(params.ENCODING ?? "")) value = decodeQP(value, params.CHARSET);
      current.push({ name, params, value });
    }
  }
  return cards;
}

const typeLabel = (t: string | undefined | null) =>
  t
    ? t
        .split(",")
        .map((x) => x.replace(/^"|"$/g, "").toLowerCase())
        .filter((x) => !["pref", "internet", "voice", "x400"].includes(x))
        .join(", ") || null
    : null;

const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

function fromRaw(props: RawProp[]): Contact {
  const get = (n: string) => props.find((p) => p.name === n);
  const all = (n: string) => props.filter((p) => p.name === n);
  const n = get("N")?.value.split(";").map(unescape);
  const fn = get("FN")?.value;
  const photo = get("PHOTO");
  let photoUrl: string | null = null;
  if (photo) {
    if (/^data:image\//.test(photo.value)) photoUrl = photo.value;
    else if (/^(b|base64)$/i.test(photo.params.ENCODING ?? "")) {
      const t = (photo.params.TYPE ?? "jpeg").toLowerCase().replace(/^image\//, "");
      photoUrl = `data:image/${t === "jpg" ? "jpeg" : t};base64,${photo.value.replace(/\s+/g, "")}`;
    }
  }
  const name = unescape(fn ?? [n?.[3], n?.[1], n?.[0], n?.[4]].filter(Boolean).join(" ") ?? "") || "(no name)";
  return {
    name,
    org: get("ORG") ? unescape(get("ORG")!.value).split(";").filter(Boolean).join(" · ") : null,
    title: get("TITLE") ? unescape(get("TITLE")!.value) : null,
    phones: all("TEL").map((p) => ({ value: p.value.replace(/^tel:/i, ""), type: typeLabel(p.params.TYPE) })),
    emails: all("EMAIL").map((p) => ({ value: p.value.replace(/^mailto:/i, ""), type: typeLabel(p.params.TYPE) })),
    addresses: all("ADR").map((p) => ({
      value: unescape(p.value)
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", "),
      type: typeLabel(p.params.TYPE),
    })),
    urls: all("URL").map((p) => p.value),
    birthday: get("BDAY")?.value ?? null,
    note: get("NOTE") ? unescape(get("NOTE")!.value) : null,
    photo: photoUrl,
  };
}

/** jCard (from ical.js) → the raw shape fromRaw understands. */
function jcardToRaw(card: InstanceType<typeof ICAL.Component>): RawProp[] {
  return card.getAllProperties().map((p) => {
    const params: Record<string, string> = {};
    const json = p.toJSON() as [string, Record<string, string | string[]>, string, ...unknown[]];
    for (const [k, v] of Object.entries(json[1] ?? {})) params[k.toUpperCase()] = Array.isArray(v) ? v.join(",") : String(v);
    const values = json.slice(3).map((v) => (Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? x.join(" ") : x)).join(";") : String(v)));
    return { name: json[0].toUpperCase(), params, value: values.join(",") };
  });
}

export function parseContacts(text: string): Contact[] {
  let cards: RawProp[][] = [];
  if (!/VERSION:2\.1/i.test(text)) {
    try {
      const jcal = ICAL.parse(text) as unknown[];
      const roots = Array.isArray(jcal[0]) ? jcal : [jcal];
      cards = roots.map((r) => jcardToRaw(new ICAL.Component(r as never)));
    } catch {
      cards = [];
    }
  }
  if (!cards.length) cards = parseRawVcards(text);
  if (!cards.length) throw new Error("This isn't a contacts file the viewer can read.");
  return cards.map(fromRaw).sort((a, b) => a.name.localeCompare(b.name));
}
