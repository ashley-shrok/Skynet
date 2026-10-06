import { useEffect, useState } from "react";
import { Captions } from "lucide-react";
import { fetchTextPrefix, useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";

/** Chat-chip preview: the first few lines with their times, the line count and running time. */

const MAX_BYTES = 2 * 1024 * 1024;

interface ChipData {
  lines: { at: string; text: string }[];
  count: number;
  runtime: string;
  partial: boolean;
}

export function SubtitleChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [data, setData] = useState<ChipData | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      const { text, partial } = await fetchTextPrefix(url, MAX_BYTES, ctrl.signal);
      const { parseSubtitles, cuesOf, plainText, formatTime } = await import("./subtitle-model");
      const doc = parseSubtitles(filename, text);
      const cues = cuesOf(doc);
      const short = (ms: number) => formatTime(ms, "vtt").replace(/^00:/, "").replace(/\.\d+$/, "");
      if (ctrl.signal.aborted) return;
      setData({
        lines: cues.slice(0, 4).map((c) => ({ at: short(c.start), text: plainText(c.text, doc.format).replace(/\s+/g, " ").trim() })),
        count: cues.length,
        runtime: short(cues.length ? Math.max(...cues.map((c) => c.end)) : 0),
        partial,
      });
    })().catch(() => !ctrl.signal.aborted && onError());
    return () => ctrl.abort();
    // onError is a fresh closure each render; the work depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="subtitle-chip-preview">
      {data ? (
        <div className="px-2.5 py-2 text-[11.5px] leading-[1.5]">
          {data.lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-[#7d725f]">{l.at}</span>
              <span className="truncate text-[#e8e4d8]">{l.text || " "}</span>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-1 text-[#a89a80]">
            <Captions size={12} aria-hidden />
            {data.count.toLocaleString()}
            {data.partial ? "+" : ""} {data.count === 1 ? "line" : "lines"}
            {data.partial ? "" : ` · ${data.runtime}`}
          </div>
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading…</div>
      )}
    </div>
  );
}
