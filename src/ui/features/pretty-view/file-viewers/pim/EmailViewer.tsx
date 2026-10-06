import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ImageOff, Paperclip } from "lucide-react";
import type { FileModeViewProps } from "../registry";
import { FileView } from "../FileView";
import { isTextByName } from "../registry";
import { parseMail, type MailAttachment, type MailMessage } from "./mail-model";
import { hasRemoteContent, safeEmailDocument } from "./mail-html";
import { formatBytes } from "../data/columnar/columnar-source";

/**
 * Email viewer (.eml, Outlook .msg), view-only. The HTML body is sanitized
 * and shown in a sandboxed frame (no scripts) whose CSP blocks remote
 * images until the reader chooses to load them. Attachments open in
 * Skynet's own viewers (or download).
 */

const MAX_BYTES = 50 * 1024 * 1024;

function download(att: MailAttachment) {
  const url = URL.createObjectURL(new Blob([att.bytes as BlobPart], { type: att.mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = att.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function AttachmentView({ att, onBack }: { att: MailAttachment; onBack: () => void }): JSX.Element {
  const url = useMemo(() => URL.createObjectURL(new Blob([att.bytes as BlobPart], { type: att.mimeType })), [att]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const text = useMemo(() => {
    if (!isTextByName(att.filename) && !att.mimeType.startsWith("text/")) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(att.bytes);
    } catch {
      return null;
    }
  }, [att]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[#2e2a22] px-2 py-1 text-[12px]">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-[#2a251c]">
          <ArrowLeft size={13} aria-hidden /> Back to message
        </button>
        <span className="truncate text-[#a89a80]">{att.filename}</span>
      </div>
      <div className="min-h-0 flex-1">
        <FileView
          filename={att.filename}
          state={{ status: "ready", data: { content: text ?? "", mtime: 0, isText: text !== null, bytes: att.bytes } }}
          mediaUrl={url}
          downloadUrl={url}
        />
      </div>
    </div>
  );
}

export default function EmailViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const [mail, setMail] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowRemote, setAllowRemote] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [openAtt, setOpenAtt] = useState<MailAttachment | null>(null);

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setMail(null);
    setError(null);
    setAllowRemote(false);
    setOpenAtt(null);
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the email (HTTP ${res.status}).`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_BYTES) throw new Error("This email is too large to open here (over 50 MB).");
        const parsed = await parseMail(filename, bytes);
        if (!ctrl.signal.aborted) setMail(parsed);
      } catch (err) {
        if (!ctrl.signal.aborted) setError(err instanceof Error && /^(Couldn't|This)/.test(err.message) ? err.message : "This email couldn't be read.");
      }
    })();
    return () => ctrl.abort();
  }, [src, filename]);

  const doc = useMemo(() => (mail?.html ? safeEmailDocument(mail.html, mail.inline, allowRemote) : null), [mail, allowRemote]);
  const remote = useMemo(() => !!mail?.html && hasRemoteContent(mail.html), [mail]);

  if (error) return <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="email-error">{error}</div>;
  if (!mail) return <div className="p-6 text-center text-sm text-[#a89a80]">Opening email…</div>;
  if (openAtt) return <AttachmentView att={openAtt} onBack={() => setOpenAtt(null)} />;

  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex gap-2">
        <span className="w-10 shrink-0 text-[#7d725f]">{label}</span>
        <span className="min-w-0 break-words">{value}</span>
      </div>
    ) : null;

  return (
    <div className="flex h-full min-h-[420px] flex-col text-[13px] text-[#e8e4d8]" data-testid="email-viewer">
      <div className="border-b border-[#2e2a22] px-4 py-3">
        <div className="mb-1.5 text-[16px] font-semibold text-[#fbf5e8]" data-testid="email-subject">{mail.subject || "(no subject)"}</div>
        <div className="flex flex-col gap-0.5 text-[12.5px]">
          {row("From", mail.from)}
          {row("To", mail.to.join(", "))}
          {row("Cc", mail.cc.join(", "))}
          {row("Date", mail.date?.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }))}
        </div>
        {mail.headers.length ? (
          <button type="button" onClick={() => setShowHeaders(!showHeaders)} className="mt-1 text-[11.5px] text-[#9fb4e8] hover:underline">
            {showHeaders ? "Hide all headers" : "Show all headers"}
          </button>
        ) : null}
        {showHeaders ? (
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[#13151c] p-2 font-mono text-[11px] text-[#cfc8b8]" data-testid="email-headers">
            {mail.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
          </pre>
        ) : null}
      </div>
      {mail.attachments.length ? (
        <div className="flex flex-wrap gap-1.5 border-b border-[#2e2a22] px-4 py-2" data-testid="email-attachments">
          {mail.attachments.map((att, i) => (
            <div key={i} className="flex items-center overflow-hidden rounded border border-[#3a3428] text-[12px]">
              <button type="button" onClick={() => setOpenAtt(att)} className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-[#2a251c]" title="Open">
                <Paperclip size={12} aria-hidden />
                <span className="max-w-[16rem] truncate">{att.filename}</span>
                <span className="text-[#7d725f]">{formatBytes(att.bytes.byteLength)}</span>
              </button>
              <button type="button" onClick={() => download(att)} className="border-l border-[#3a3428] px-1.5 py-1 hover:bg-[#2a251c]" aria-label={`Download ${att.filename}`} title="Download">
                <Download size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {remote && !allowRemote ? (
        <div className="flex items-center gap-2 border-b border-[#2e2a22] bg-[#24201a] px-4 py-1.5 text-[12px] text-[#d9b98a]" data-testid="email-remote-blocked">
          <ImageOff size={13} aria-hidden />
          Remote images are blocked to protect your privacy.
          <button type="button" onClick={() => setAllowRemote(true)} className="rounded border border-[#5a4a2a] px-2 py-0.5 text-[#f0dcb4] hover:bg-[#3a3020]">
            Load remote images
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {doc ? (
          <iframe
            key={allowRemote ? "remote" : "local"}
            title="Email body"
            // No scripts and no same-origin access; links open in new tabs.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={doc}
            className="h-full w-full border-0 bg-white"
            data-testid="email-body"
          />
        ) : (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-sans text-[13.5px] leading-relaxed" data-testid="email-text">
            {mail.text || "(no message body)"}
          </pre>
        )}
      </div>
    </div>
  );
}
