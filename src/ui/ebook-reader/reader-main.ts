import "@/vendor/foliate-js/view.js";
import {
  metaString,
  readerCss,
  THEMES,
  type FromReader,
  type ReaderStyle,
  type TocEntry,
  type ToReader,
} from "@/features/pretty-view/file-viewers/ebook/ebook-protocol";

/**
 * The reader page (ebook-reader.html): hosts foliate-js and follows the
 * Skynet viewer's messages. Runs under a strict CSP so scripts inside
 * books never execute. Only talks to its parent, on the same origin.
 */

type FoliateView = HTMLElement & {
  open(file: File): Promise<void>;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  prev(): Promise<void>;
  next(): Promise<void>;
  goTo(target: string): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  search(opts: { query: string }): AsyncGenerator<unknown>;
  clearSearch(): void;
  book: { metadata?: { title?: unknown; author?: unknown }; toc?: TocItem[]; rendition?: { layout?: string } };
  renderer: HTMLElement & { setStyles?(css: string): void };
};
type TocItem = { label?: string; href?: string; subitems?: TocItem[] };

const view = document.createElement("foliate-view") as FoliateView;
document.body.append(view);

const send = (msg: FromReader) => window.parent.postMessage(msg, window.location.origin);

function flattenToc(items: TocItem[] | undefined, depth = 0, out: TocEntry[] = []): TocEntry[] {
  for (const item of items ?? []) {
    if (item.href) out.push({ label: (item.label ?? "").trim() || "Untitled", href: item.href, depth });
    flattenToc(item.subitems, depth + 1, out);
  }
  return out;
}

function applyStyle(style: ReaderStyle) {
  document.documentElement.style.background = THEMES[style.theme].bg;
  document.body.style.background = THEMES[style.theme].bg;
  view.renderer?.setAttribute("flow", style.flow);
  view.renderer?.setAttribute("margin", "36px");
  view.renderer?.setAttribute("gap", "6%");
  view.renderer?.setStyles?.(readerCss(style));
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === "ArrowLeft" || e.key === "PageUp") send({ type: "nav-key", dir: "prev" });
  else if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) send({ type: "nav-key", dir: "next" });
  else return;
  e.preventDefault();
};
document.addEventListener("keydown", onKey);
// Each section is its own document; forward its keys too.
view.addEventListener("load", (e) => {
  (e as CustomEvent<{ doc: Document }>).detail.doc.addEventListener("keydown", onKey);
});
view.addEventListener("relocate", (e) => {
  const d = (e as CustomEvent<{ fraction?: number; cfi?: string; tocItem?: { label?: string } }>).detail;
  send({ type: "relocate", fraction: d.fraction ?? 0, cfi: d.cfi ?? null, chapter: d.tocItem?.label?.trim() ?? null });
});

let searchId = 0;

async function handle(msg: ToReader) {
  switch (msg.type) {
    case "open": {
      await view.open(msg.file);
      applyStyle(msg.style);
      await view.init({ lastLocation: msg.location, showTextStart: !msg.location });
      const { metadata, toc, rendition } = view.book;
      send({
        type: "opened",
        title: metaString(metadata?.title),
        author: metaString(metadata?.author),
        toc: flattenToc(toc),
        fixedLayout: rendition?.layout === "pre-paginated",
      });
      return;
    }
    case "nav":
      return msg.dir === "prev" ? view.prev() : view.next();
    case "goto":
      if (typeof msg.fraction === "number") return view.goToFraction(msg.fraction);
      if (msg.href) return view.goTo(msg.href);
      return;
    case "style":
      return applyStyle(msg.style);
    case "search-clear":
      searchId++;
      return view.clearSearch();
    case "search": {
      const id = (searchId = msg.id);
      view.clearSearch();
      for await (const result of view.search({ query: msg.query })) {
        if (id !== searchId) return;
        if (result === "done") break;
        const r = result as { label?: string; subitems?: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] };
        for (const item of r.subitems ?? []) {
          send({ type: "search-result", id, cfi: item.cfi, chapter: r.label ?? null, ...item.excerpt });
        }
      }
      if (id === searchId) send({ type: "search-done", id });
      return;
    }
  }
}

window.addEventListener("message", (e: MessageEvent<ToReader>) => {
  if (e.source !== window.parent || e.origin !== window.location.origin) return;
  handle(e.data).catch((err: unknown) => {
    const message =
      err instanceof Error && /not supported|UnsupportedType/i.test(`${err.name} ${err.message}`)
        ? "This file isn't an ebook format the reader can open."
        : "This book couldn't be opened; it may be damaged or DRM-protected.";
    send({ type: "error", message });
  });
});

send({ type: "ready" });
