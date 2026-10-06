import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { metaString } from "./ebook-protocol";

/**
 * Chat-chip preview for ebooks: cover, title and author. Only the book's
 * package files are parsed here (inert DOMParser documents, nothing is
 * rendered or run); books over PREVIEW_MAX_BYTES fall back to the plain chip.
 */

const PREVIEW_MAX_BYTES = 40 * 1024 * 1024;

export function EbookChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [info, setInfo] = useState<{ title: string | null; author: string | null; cover: string | null } | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    let coverUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
        const blob = await res.blob();
        if (blob.size > PREVIEW_MAX_BYTES) throw new Error("too large");
        const { makeBook } = await import("@/vendor/foliate-js/view.js");
        const book = await makeBook(new File([blob], filename.slice(filename.lastIndexOf("/") + 1)));
        const cover = await book.getCover?.().catch(() => null);
        if (ctrl.signal.aborted) return;
        if (cover) coverUrl = URL.createObjectURL(cover);
        setInfo({ title: metaString(book.metadata?.title), author: metaString(book.metadata?.author), cover: coverUrl });
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => {
      ctrl.abort();
      if (coverUrl) URL.revokeObjectURL(coverUrl);
    };
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="ebook-chip-preview">
      {info ? (
        <div className="flex gap-2.5 p-2.5 text-[11.5px] leading-[1.4]">
          {info.cover ? (
            <img src={info.cover} alt="" className="h-[104px] w-auto max-w-[80px] shrink-0 rounded-sm object-cover shadow" draggable={false} />
          ) : (
            <div className="flex h-[104px] w-[72px] shrink-0 items-center justify-center rounded-sm bg-[#2a251c]">
              <BookMarked size={22} className="text-[#7d725f]" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <div className="line-clamp-3 font-medium text-[#e8e4d8]">{info.title ?? "Untitled book"}</div>
            {info.author ? <div className="mt-0.5 line-clamp-2 text-[#a89a80]">{info.author}</div> : null}
          </div>
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading book…</div>
      )}
    </div>
  );
}
