import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChipPreviewProps } from "../registry";
import { parsePatch, type DiffLine } from "./parse-diff";

/**
 * Inline chat-chip preview for .diff / .patch: a "3 files · +42 −17"
 * summary plus the first few changed lines. Fetches only once the chip
 * scrolls into view, and reads at most PREVIEW_MAX_BYTES so a huge patch
 * doesn't download in full; counts from a cut-off read say "at least".
 */

const PREVIEW_MAX_BYTES = 256 * 1024;
const PREVIEW_LINES = 6;

interface Summary {
  files: number;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  partial: boolean;
}

async function readCapped(res: Response): Promise<{ text: string; partial: boolean }> {
  if (!res.body) return { text: await res.text(), partial: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), partial: false };
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= PREVIEW_MAX_BYTES) {
      void reader.cancel();
      // Drop the last (probably cut) line so it doesn't parse as garbage.
      return { text: text.slice(0, text.lastIndexOf("\n") + 1), partial: true };
    }
  }
}

export function DiffChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [el, visible]);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { text, partial } = await readCapped(res);
        const patch = parsePatch(text);
        if (patch.files.length === 0) throw new Error("no diff");
        const lines: DiffLine[] = [];
        outer: for (const f of patch.files) {
          for (const h of f.hunks) {
            for (const l of h.lines) {
              if (l.kind !== "add" && l.kind !== "del") continue;
              lines.push(l);
              if (lines.length >= PREVIEW_LINES) break outer;
            }
          }
        }
        if (!ctrl.signal.aborted) {
          setSummary({
            files: patch.files.length,
            additions: patch.additions,
            deletions: patch.deletions,
            lines,
            partial,
          });
        }
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the fetch only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="min-h-[52px] px-2.5 py-2 font-mono text-[11.5px] leading-[18px]" data-testid="diff-chip-preview">
      {summary ? (
        <>
          <div className="text-[#a89a80] mb-1">
            {summary.files} {summary.files === 1 ? "file" : "files"}
            {summary.partial ? "+" : ""} ·{" "}
            <span className="text-[#7fd49a]">+{summary.additions}{summary.partial ? "+" : ""}</span>{" "}
            <span className="text-[#f08a8a]">−{summary.deletions}{summary.partial ? "+" : ""}</span>
          </div>
          {summary.lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                "truncate whitespace-pre px-1 rounded-sm",
                l.kind === "add"
                  ? "bg-[hsla(140,55%,40%,0.20)] text-[#cdeed6]"
                  : "bg-[hsla(0,65%,45%,0.20)] text-[#f3d0d0]",
              )}
            >
              {l.kind === "add" ? "+" : "-"}
              {l.text}
            </div>
          ))}
        </>
      ) : (
        <div className="text-[#a89a80]">Loading diff…</div>
      )}
    </div>
  );
}
