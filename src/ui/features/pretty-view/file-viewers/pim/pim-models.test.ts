import { describe, it, expect } from "vitest";
import { describeRecurrence, parseCalendar } from "./calendar-model";
import { parseContacts, parseRawVcards } from "./contacts-model";
import { parseEml } from "./mail-model";
import { hasRemoteContent, safeEmailDocument } from "./mail-html";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
METHOD:REQUEST
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:1@test
DTSTART;TZID=Europe/Berlin:20261012T100000
DTEND;TZID=Europe/Berlin:20261012T110000
SUMMARY:Design review
LOCATION:Room 4
DESCRIPTION:Agenda:\\n- viewers\\n- converter
ORGANIZER;CN=Ada:mailto:ada@example.com
ATTENDEE;CN=Linus;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:linus@example.com
ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:grace@example.com
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10
END:VEVENT
BEGIN:VEVENT
UID:2@test
DTSTART;VALUE=DATE:20261001
DTEND;VALUE=DATE:20261002
SUMMARY:Holiday
END:VEVENT
END:VCALENDAR`;

describe("calendar", () => {
  it("reads events with zone, people and repeats, sorted by start", () => {
    const cal = parseCalendar(ICS);
    expect(cal.method).toBe("REQUEST");
    expect(cal.events.map((e) => e.title)).toEqual(["Holiday", "Design review"]);
    const review = cal.events[1];
    expect(review.timezone).toBe("Europe/Berlin");
    expect(review.start?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(review.description).toBe("Agenda:\n- viewers\n- converter");
    expect(review.organizer).toBe("Ada");
    expect(review.attendees).toEqual([
      { name: "Linus", email: "linus@example.com", status: "ACCEPTED", role: "REQ-PARTICIPANT" },
      { name: "grace@example.com", email: "grace@example.com", status: "NEEDS-ACTION", role: null },
    ]);
    expect(review.repeats).toBe("Every 2 weeks on Monday and Wednesday, 10 times");
    expect(cal.events[0].allDay).toBe(true);
  });

  it("phrases common rules", () => {
    expect(describeRecurrence({ freq: "MONTHLY", parts: { BYDAY: ["-1FR"] } })).toBe("Monthly on the last Friday");
    expect(describeRecurrence({ freq: "DAILY" })).toBe("Daily");
  });

  it("rejects non-calendars", () => {
    expect(() => parseCalendar("hello")).toThrow();
  });
});

describe("contacts", () => {
  it("reads vCard 3 with multiple cards", () => {
    const vcf = `BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada;;;\nFN:Ada Lovelace\nORG:Analytical Engines Ltd\nTITLE:Mathematician\nTEL;TYPE=CELL:+44 20 7946 0000\nEMAIL;TYPE=INTERNET,WORK:ada@example.com\nADR;TYPE=HOME:;;12 St James's Square;London;;SW1Y 4JH;UK\nBDAY:1815-12-10\nNOTE:First programmer\\, probably.\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:Babbage\nEND:VCARD\n`;
    const [ada, charles] = parseContacts(vcf);
    expect(ada.name).toBe("Ada Lovelace");
    expect(ada.org).toBe("Analytical Engines Ltd");
    expect(ada.phones).toEqual([{ value: "+44 20 7946 0000", type: "cell" }]);
    expect(ada.emails).toEqual([{ value: "ada@example.com", type: "work" }]);
    expect(ada.addresses[0].value).toBe("12 St James's Square, London, SW1Y 4JH, UK");
    expect(ada.note).toBe("First programmer, probably.");
    expect(charles.name).toBe("Babbage");
  });

  it("reads phone-exported vCard 2.1 with quoted-printable", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:2.1\r\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;\r\nTEL;CELL;PREF:+49 30 123456\r\nEND:VCARD\r\n";
    const [c] = parseContacts(vcf);
    expect(c.name).toBe("Jürgen Müller");
    expect(c.phones).toEqual([{ value: "+49 30 123456", type: "cell" }]);
    expect(parseRawVcards(vcf)).toHaveLength(1);
  });
});

const EML = [
  "From: Ada Lovelace <ada@example.com>",
  "To: Linus <linus@example.com>, grace@example.com",
  "Subject: =?UTF-8?Q?Quarterly_report_=E2=80=94_draft?=",
  "Date: Mon, 05 Oct 2026 09:30:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="mix"',
  "",
  "--mix",
  'Content-Type: multipart/related; boundary="rel"',
  "",
  "--rel",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Hi <b>team</b></p><img src="cid:logo@x"><img src="https://tracker.example/p.gif"><script>alert(1)</script><a href="https://example.com" onclick="evil()">link</a><meta http-equiv="refresh" content="0;url=https://evil.example">',
  "--rel",
  "Content-Type: image/png",
  "Content-ID: <logo@x>",
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--rel--",
  "--mix",
  'Content-Type: text/csv; name="numbers.csv"',
  'Content-Disposition: attachment; filename="numbers.csv"',
  "",
  "a,b",
  "1,2",
  "--mix--",
  "",
].join("\r\n");

describe("email", () => {
  it("reads headers, html, inline images and attachments", async () => {
    const mail = await parseEml(new TextEncoder().encode(EML));
    expect(mail.subject).toBe("Quarterly report — draft");
    expect(mail.from).toBe("Ada Lovelace <ada@example.com>");
    expect(mail.to).toEqual(["Linus <linus@example.com>", "grace@example.com"]);
    expect(mail.date?.toISOString()).toBe("2026-10-05T09:30:00.000Z");
    expect(Object.keys(mail.inline)).toEqual(["logo@x"]);
    expect(mail.attachments.map((a) => [a.filename, a.mimeType])).toEqual([["numbers.csv", "text/csv"]]);
    expect(new TextDecoder().decode(mail.attachments[0].bytes)).toContain("1,2");
  });

  it("sanitizes the body, resolves cid: and blocks remote images until allowed", async () => {
    const mail = await parseEml(new TextEncoder().encode(EML));
    const html = mail.html!;
    expect(hasRemoteContent(html)).toBe(true);
    const blocked = safeEmailDocument(html, mail.inline, false);
    expect(blocked).not.toMatch(/<script|onclick|http-equiv="refresh"/i);
    expect(blocked).toContain("data:image/png;base64");
    expect(blocked).toContain("img-src data:;");
    expect(safeEmailDocument(html, mail.inline, true)).toContain("img-src data: https: http:");
  });
});
