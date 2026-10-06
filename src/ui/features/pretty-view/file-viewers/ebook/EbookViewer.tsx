import { useCallback, useEffect, useRef, useState } from "react";
import { AArrowDown, AArrowUp, ChevronLeft, ChevronRight, List, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBasePath } from "@/lib/base-path";
import type { FileModeViewProps } from "../registry";
import type { FromReader, ReaderStyle, TocEntry, ToReader } from "./ebook-protocol";

/**
 * Ebook reader (EPUB, Kindle MOBI/AZW3, FictionBook, comic CBZ), view-only.
 * The book renders in ebook-reader.html — a separate page under a strict
 * CSP, because foliate-js renders book HTML in frames that allow scripts —
 * and this component is its controls: contents, search, text size, theme,
 * pages vs scrolling, progress, and the position remembered per book.
 */

const MAX_BYTES = 200 * 1024 * 1024;
const STYLE_KEY = "skynet.ebook.style";
const posKey = (name: string, size: number) => `skynet.ebook.pos:${name}:${size}`;

const DEFAULT_STYLE: ReaderStyle = { fontSize: 100, theme: "light", flow: "paginated" };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

type Hit = { cfi: string; chapter: string | null; pre: string; match: string; post: string };

export default function EbookViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<File | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({ kind: "loading" });
  const [meta, setMeta] = useState<{ title: string | null; author: string | null; toc: TocEntry[]; fixedLayout: boolean } | null>(null);
  const [loc, setLoc] = useState<{ fraction: number; chapter: string | null }>({ fraction: 0, chapter: null });
  const [style, setStyle] = useState<ReaderStyle>(() => readJson(STYLE_KEY, DEFAULT_STYLE));
  const [panel, setPanel] = useState<"toc" | "search" | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchId = useRef(0);
  const name = filename.slice(filename.lastIndexOf("/") + 1);

  const post = useCallback((msg: ToReader) => {
    frameRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  const openIfReady = useCallback(() => {
    const file = fileRef.current;
    if (!file || !readyRef.current) return;
    const location = (() => {
      try {
        return localStorage.getItem(posKey(file.name, file.size));
      } catch {
        return null;
      }
    })();
    post({ type: "open", file, location, style: readJson(STYLE_KEY, DEFAULT_STYLE) });
  }, [post]);

  // Download the book.
  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setStatus({ kind: "loading" });
    fileRef.current = null;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the book (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("This book is too large to open here (over 200 MB).");
        const blob = await res.blob();
        if (blob.size > MAX_BYTES) throw new Error("This book is too large to open here (over 200 MB).");
        if (ctrl.signal.aborted) return;
        // The reader picks the format partly by name (e.g. .cbz, .fb2).
        fileRef.current = new File([blob], name);
        openIfReady();
      } catch (err) {
        if (!ctrl.signal.aborted) setStatus({ kind: "error", message: err instanceof Error ? err.message : "This book couldn't be opened." });
      }
    })();
    return () => ctrl.abort();
  }, [src, name, openIfReady]);

  // Messages from the reader page.
  useEffect(() => {
    const onMessage = (e: MessageEvent<FromReader>) => {
      if (e.source !== frameRef.current?.contentWindow || e.origin !== window.location.origin) return;
      const msg = e.data;
      switch (msg.type) {
        case "ready":
          readyRef.current = true;
          openIfReady();
          break;
        case "opened":
          setMeta({ title: msg.title, author: msg.author, toc: msg.toc, fixedLayout: msg.fixedLayout });
          setStatus({ kind: "ready" });
          break;
        case "relocate":
          // Some books (e.g. comics) don't report a position.
          setLoc({ fraction: Number.isFinite(msg.fraction) ? msg.fraction : 0, chapter: msg.chapter });
          if (msg.cfi && fileRef.current) writeLocal(posKey(fileRef.current.name, fileRef.current.size), msg.cfi);
          break;
        case "search-result":
          if (msg.id === searchId.current) setHits((h) => (h.length < 500 ? [...h, msg] : h));
          break;
        case "search-done":
          if (msg.id === searchId.current) setSearching(false);
          break;
        case "nav-key":
          post({ type: "nav", dir: msg.dir });
          break;
        case "error":
          setStatus({ kind: "error", message: msg.message });
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openIfReady, post]);

  const changeStyle = (patch: Partial<ReaderStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    writeLocal(STYLE_KEY, JSON.stringify(next));
    post({ type: "style", style: next });
  };

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    setHits([]);
    if (!q) {
      post({ type: "search-clear" });
      return;
    }
    const id = ++searchId.current;
    setSearching(true);
    post({ type: "search", id, query: q });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    if (e.key === "ArrowLeft") post({ type: "nav", dir: "prev" });
    else if (e.key === "ArrowRight") post({ type: "nav", dir: "next" });
  };

  const readerUrl = `${getBasePath()}/ebook-reader.html`;
  const ready = status.kind === "ready";
  const btn = "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[#cfc8b8] hover:bg-[#2a251c] disabled:opacity-40";

  return (
    <div className="flex h-full min-h-[420px] flex-col text-[13px] text-[#e8e4d8]" onKeyDown={onKeyDown} tabIndex={-1} data-testid="ebook-viewer">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#2e2a22] px-2 py-1 text-[12px]">
        <button type="button" className={cn(btn, panel === "toc" && "bg-[#3a3428]")} onClick={() => setPanel(panel === "toc" ? null : "toc")} disabled={!ready} aria-label="Contents" title="Contents">
          <List size={14} aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate" data-testid="ebook-title">
          <span className="font-medium">{meta?.title ?? name}</span>
          {meta?.author ? <span className="text-[#a89a80]"> · {meta.author}</span> : null}
        </span>
        <button type="button" className={cn(btn, panel === "search" && "bg-[#3a3428]")} onClick={() => setPanel(panel === "search" ? null : "search")} disabled={!ready} aria-label="Search" title="Search">
          <Search size={14} aria-hidden />
        </button>
        {!meta?.fixedLayout ? (
          <>
            <button type="button" className={btn} onClick={() => changeStyle({ fontSize: Math.max(70, style.fontSize - 10) })} aria-label="Smaller text" title="Smaller text">
              <AArrowDown size={15} aria-hidden />
            </button>
            <span className="w-9 text-center tabular-nums text-[#a89a80]">{style.fontSize}%</span>
            <button type="button" className={btn} onClick={() => changeStyle({ fontSize: Math.min(220, style.fontSize + 10) })} aria-label="Larger text" title="Larger text">
              <AArrowUp size={15} aria-hidden />
            </button>
          </>
        ) : null}
        <div className="mx-1 flex overflow-hidden rounded border border-[#3a3428]" role="group" aria-label="Theme">
          {(["light", "sepia", "dark"] as const).map((t) => (
            <button key={t} type="button" onClick={() => changeStyle({ theme: t })} aria-pressed={style.theme === t} className={cn("px-2 py-0.5 capitalize", style.theme === t ? "bg-[#3a3428] text-[#fbf5e8]" : "text-[#cfc8b8] hover:bg-[#2a251c]")}>
              {t}
            </button>
          ))}
        </div>
        <button type="button" className={btn} onClick={() => changeStyle({ flow: style.flow === "paginated" ? "scrolled" : "paginated" })} title="Switch between pages and scrolling">
          {style.flow === "paginated" ? "Pages" : "Scroll"}
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1">
        {panel === "toc" && meta ? (
          <nav className="w-64 shrink-0 overflow-y-auto border-r border-[#2e2a22] py-1 text-[12.5px]" aria-label="Contents" data-testid="ebook-toc">
            {meta.toc.length === 0 ? <div className="px-3 py-2 text-[#7d725f]">No table of contents.</div> : null}
            {meta.toc.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => post({ type: "goto", href: t.href })}
                className={cn("block w-full truncate py-1 pr-2 text-left hover:bg-[#2a251c]", loc.chapter === t.label && "text-[#fbf5e8] bg-[#2a251c]")}
                style={{ paddingLeft: 12 + t.depth * 14 }}
                title={t.label}
              >
                {t.label}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <iframe ref={frameRef} src={readerUrl} title={meta?.title ?? name} className="absolute inset-0 h-full w-full border-0" data-testid="ebook-frame" />
          {status.kind !== "ready" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1712] p-6 text-center text-sm text-[#a89a80]" data-testid={status.kind === "error" ? "ebook-error" : undefined}>
              {status.kind === "error" ? (
                <div className="flex flex-col items-center gap-3 text-[#cfc8b8]">
                  <div>{status.message}</div>
                  {src ? (
                    <a href={src} download={name} className="rounded border border-[#3a3428] px-3 py-1.5 hover:bg-[#2a251c]">
                      Download
                    </a>
                  ) : null}
                </div>
              ) : (
                "Opening book…"
              )}
            </div>
          ) : null}
        </div>
        {panel === "search" ? (
          <aside className="flex w-72 shrink-0 flex-col border-l border-[#2e2a22]" data-testid="ebook-search">
            <form onSubmit={runSearch} className="flex items-center gap-1 border-b border-[#2e2a22] p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this book"
                autoFocus
                className="min-w-0 flex-1 rounded border border-[#3a3428] bg-[#13151c] px-2 py-1 text-[12.5px] outline-none focus:border-[#6b7fb8]"
              />
              {query ? (
                <button type="button" aria-label="Clear search" className={btn} onClick={() => { setQuery(""); setHits([]); post({ type: "search-clear" }); }}>
                  <X size={13} aria-hidden />
                </button>
              ) : null}
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto text-[12px]">
              <div className="px-3 py-1 text-[#7d725f]">
                {searching ? "Searching…" : hits.length ? `${hits.length}${hits.length >= 500 ? "+" : ""} matches` : query && searchId.current ? "No matches" : ""}
              </div>
              {hits.map((h, i) => (
                <button key={i} type="button" onClick={() => post({ type: "goto", href: h.cfi })} className="block w-full px-3 py-1.5 text-left hover:bg-[#2a251c]" data-testid="ebook-hit">
                  {h.chapter ? <div className="truncate text-[11px] text-[#7d725f]">{h.chapter}</div> : null}
                  <div className="text-[#cfc8b8]">
                    …{h.pre}
                    <mark className="rounded bg-[#6b5a1f] px-0.5 text-[#fbf5e8]">{h.match}</mark>
                    {h.post}…
                  </div>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-[#2e2a22] px-2 py-1 text-[12px]">
        <button type="button" className={btn} onClick={() => post({ type: "nav", dir: "prev" })} disabled={!ready} aria-label="Previous page">
          <ChevronLeft size={15} aria-hidden />
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(loc.fraction * 1000)}
          disabled={!ready}
          onChange={(e) => post({ type: "goto", fraction: Number(e.target.value) / 1000 })}
          className="min-w-0 flex-1 accent-[#9fb4e8]"
          aria-label="Position in book"
        />
        <button type="button" className={btn} onClick={() => post({ type: "nav", dir: "next" })} disabled={!ready} aria-label="Next page">
          <ChevronRight size={15} aria-hidden />
        </button>
        <span className="w-12 text-right tabular-nums text-[#a89a80]" data-testid="ebook-progress">
          {Math.round(loc.fraction * 100)}%
        </span>
        <span className="hidden max-w-[40%] truncate text-[#7d725f] sm:inline">{loc.chapter ?? ""}</span>
      </div>
    </div>
  );
}
