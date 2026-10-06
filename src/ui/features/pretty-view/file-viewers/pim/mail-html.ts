import DOMPurify from "dompurify";

/**
 * An HTML email body made safe to show: sanitized (no scripts, handlers,
 * forms, meta refresh, frames), inline cid: images resolved, and wrapped in
 * a document whose CSP allows no scripts and — unless the reader asks —
 * no remote images (tracking pixels). Shown in a sandboxed frame.
 */

const REMOTE = /(?:src|background|href)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i;

export function hasRemoteContent(html: string): boolean {
  return REMOTE.test(html);
}

export function safeEmailDocument(html: string, inline: Record<string, string>, allowRemote: boolean): string {
  const resolved = html.replace(/cid:([^"')\s>]+)/gi, (m, id: string) => inline[decodeURIComponent(id)] ?? inline[id] ?? m);
  const clean = DOMPurify.sanitize(resolved, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "meta", "link", "base", "iframe", "frame", "object", "embed"],
    FORBID_ATTR: ["srcset"],
  }) as string;
  const imgSrc = allowRemote ? "data: https: http:" : "data:";
  const head =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:">` +
    `<base target="_blank">` +
    `<style>html{background:#fff;color:#1f1f1f;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}body{margin:12px 16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>`;
  return clean.includes("<head>") ? clean.replace("<head>", `<head>${head}`) : `<!doctype html><html><head>${head}</head><body>${clean}</body></html>`;
}
