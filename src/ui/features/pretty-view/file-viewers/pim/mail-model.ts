/**
 * Emails (.eml via postal-mime, Outlook .msg via msgreader) as one shape
 * for the viewer: headers, an HTML and/or text body, attachments, and the
 * inline images the HTML refers to by Content-ID.
 */

export interface MailAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MailMessage {
  subject: string | null;
  from: string | null;
  to: string[];
  cc: string[];
  date: Date | null;
  headers: [string, string][];
  html: string | null;
  text: string | null;
  attachments: MailAttachment[];
  /** Content-ID (no angle brackets) → data: URL, for cid: references. */
  inline: Record<string, string>;
}

type PostalAddress = { name: string; address?: string; group?: { name: string; address: string }[] };

function formatAddress(a: PostalAddress | undefined): string[] {
  if (!a) return [];
  if (a.group) return a.group.flatMap((m) => formatAddress(m));
  return [a.name && a.address ? `${a.name} <${a.address}>` : a.address || a.name].filter(Boolean);
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

const cidOf = (id: string | undefined | null) => (id ? id.replace(/^<|>$/g, "").trim() : "");

export async function parseEml(bytes: Uint8Array): Promise<MailMessage> {
  const { default: PostalMime } = await import("postal-mime");
  const email = await PostalMime.parse(bytes, { attachmentEncoding: "arraybuffer" });
  const inline: Record<string, string> = {};
  const attachments: MailAttachment[] = [];
  for (const a of email.attachments) {
    const data = toBytes(a.content as ArrayBuffer | string);
    const cid = cidOf(a.contentId);
    const referenced = cid && email.html?.includes(`cid:${cid}`);
    if (referenced && a.mimeType.startsWith("image/")) {
      inline[cid] = dataUrl(a.mimeType, data);
      continue;
    }
    attachments.push({ filename: a.filename ?? (a.mimeType === "message/rfc822" ? "message.eml" : "attachment"), mimeType: a.mimeType, bytes: data });
  }
  const date = email.date ? new Date(email.date) : null;
  return {
    subject: email.subject ?? null,
    from: formatAddress(email.from as PostalAddress | undefined)[0] ?? null,
    to: (email.to ?? []).flatMap((a) => formatAddress(a as PostalAddress)),
    cc: (email.cc ?? []).flatMap((a) => formatAddress(a as PostalAddress)),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    headers: email.headers.map((h) => [h.originalKey ?? h.key, h.value]),
    html: email.html ?? null,
    text: email.text ?? null,
    attachments,
    inline,
  };
}

export async function parseMsg(bytes: Uint8Array): Promise<MailMessage> {
  const { default: MsgReader } = await import("@kenjiuno/msgreader");
  const reader = new MsgReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const data = reader.getFileData();
  if (data.error) throw new Error(String(data.error));
  const inline: Record<string, string> = {};
  const attachments: MailAttachment[] = [];
  let html = data.bodyHtml ?? (data.html ? new TextDecoder().decode(data.html) : null);
  for (const att of data.attachments ?? []) {
    const got = reader.getAttachment(att);
    const file = toBytes(got.content);
    const name = got.fileName || att.fileName || att.fileNameShort || "attachment";
    const mime = att.attachMimeTag || (att.innerMsgContent ? "application/vnd.ms-outlook" : "application/octet-stream");
    const cid = cidOf(att.pidContentId);
    if (cid && html?.includes(`cid:${cid}`) && mime.startsWith("image/")) {
      inline[cid] = dataUrl(mime, file);
      continue;
    }
    attachments.push({ filename: att.innerMsgContent && !/\.msg$/i.test(name) ? `${name}.msg` : name, mimeType: mime, bytes: file });
  }
  const recipients = data.recipients ?? [];
  const fmt = (r: { name?: string; email?: string; smtpAddress?: string }) => {
    const address = r.smtpAddress || r.email || "";
    return r.name && address && r.name !== address ? `${r.name} <${address}>` : address || r.name || "";
  };
  const when = data.clientSubmitTime || data.messageDeliveryTime;
  const date = when ? new Date(when) : null;
  const headers: [string, string][] = (data.headers ?? "")
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:\s]+):\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1], m[2]]);
  if (html && !/<html|<body/i.test(html)) html = `<div>${html}</div>`;
  return {
    subject: data.subject ?? null,
    from: data.senderName || data.senderEmail ? fmt({ name: data.senderName, email: data.senderSmtpAddress || data.senderEmail }) : null,
    to: recipients.filter((r) => (r.recipType ?? "to") === "to").map(fmt).filter(Boolean),
    cc: recipients.filter((r) => r.recipType === "cc").map(fmt).filter(Boolean),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    headers,
    html,
    text: data.body ?? null,
    attachments,
    inline,
  };
}

export function parseMail(filename: string, bytes: Uint8Array): Promise<MailMessage> {
  return /\.msg$/i.test(filename) ? parseMsg(bytes) : parseEml(bytes);
}
