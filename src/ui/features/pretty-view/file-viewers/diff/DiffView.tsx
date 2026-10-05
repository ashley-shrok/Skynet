import { Fragment, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import {
  displayPath,
  parsePatch,
  toSplitRows,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
} from "./parse-diff";

/**
 * Rendered view for .diff / .patch files. A dropdown picks one file of a
 * multi-file patch (or "All files", stacked); single-file patches skip the
 * dropdown. Side-by-side falls back to unified when the pane is narrower
 * than SPLIT_MIN_WIDTH.
 */

const SPLIT_MIN_WIDTH = 640;
/** Above this many diff lines, open on the first file instead of "All files". */
const ALL_FILES_DEFAULT_MAX_LINES = 4000;
const ALL = "all";

// Native <option> popups ignore the select's Tailwind colours on desktop
// Chrome/Linux (same fix as SkillsEditorModal's OPTION_STYLE).
const OPTION_STYLE = { backgroundColor: "#1a1a1a", color: "#e8e4d8" } as const;

const STATUS_LABEL: Record<DiffFile["status"], string | null> = {
  modified: null,
  added: "new",
  deleted: "deleted",
  renamed: "renamed",
  binary: "binary",
};

function counts(add: number, del: number): string {
  return `+${add} −${del}`;
}

/**
 * Container width via ResizeObserver; null when it can't be measured.
 * Takes the element (from a callback ref) so a swapped container re-observes.
 */
function useWidth(el: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

export function DiffView({
  content,
  layout,
}: {
  content: string;
  layout: "unified" | "split";
}): JSX.Element {
  const patch = useMemo(() => parsePatch(content), [content]);
  const { files } = patch;
  const totalLines = useMemo(
    () => files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.length, 0), 0),
    [files],
  );
  const [selected, setSelected] = useState<string>(() =>
    totalLines > ALL_FILES_DEFAULT_MAX_LINES ? "0" : ALL,
  );
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const width = useWidth(container);
  const narrow = width !== null && width < SPLIT_MIN_WIDTH;
  const effectiveLayout = layout === "split" && narrow ? "unified" : layout;

  if (files.length === 0) {
    return (
      <div
        ref={setContainer}
        className="p-6 text-sm text-[#a89a80] text-center"
        data-testid="diff-view-empty"
      >
        No file changes found in this patch. Switch to Raw to see the text.
      </div>
    );
  }

  // An edit in Raw can shrink the file list under the current selection.
  const index = selected === ALL ? null : Number(selected);
  const shown = index === null || index >= files.length ? files : [files[index]];

  return (
    <div ref={setContainer} className="flex flex-col gap-3 min-w-0" data-testid="diff-view">
      {files.length > 1 ? (
        <select
          aria-label="File in patch"
          value={index !== null && index < files.length ? selected : ALL}
          onChange={(e) => setSelected(e.target.value)}
          data-testid="diff-view-file-select"
          className={cn(
            "w-full min-w-0 text-[12px] px-2 py-1.5 rounded-md outline-none cursor-pointer",
            "bg-black/20 border border-[hsla(var(--pv-id-hue,220),65%,55%,0.22)]",
            "text-[#fbf5e8]",
          )}
        >
          <option value={ALL} style={OPTION_STYLE}>
            {`All files (${files.length}) · ${counts(patch.additions, patch.deletions)}`}
          </option>
          {files.map((f, i) => {
            const status = STATUS_LABEL[f.status];
            return (
              <option key={i} value={String(i)} style={OPTION_STYLE}>
                {`${displayPath(f)}${status ? ` (${status})` : ""} · ${counts(f.additions, f.deletions)}`}
              </option>
            );
          })}
        </select>
      ) : null}
      {layout === "split" && narrow ? (
        <div className="text-[11.5px] text-[#a89a80]">
          Side-by-side needs a wider window, so this is the unified view.
        </div>
      ) : null}
      {shown.map((f, i) => (
        <DiffFileBlock key={`${displayPath(f)}-${i}`} file={f} layout={effectiveLayout} />
      ))}
    </div>
  );
}

function DiffFileBlock({
  file,
  layout,
}: {
  file: DiffFile;
  layout: "unified" | "split";
}): JSX.Element {
  const status = STATUS_LABEL[file.status];
  return (
    <section
      className="rounded-lg border border-white/10 overflow-hidden bg-black/20"
      data-testid="diff-file"
    >
      <header className="flex items-center gap-2 px-3 py-1.5 text-[12px] bg-white/[0.04] border-b border-white/10">
        <span className="font-mono truncate min-w-0 text-[#e8e4d8]" title={displayPath(file)}>
          {displayPath(file)}
        </span>
        {status ? (
          <span className="shrink-0 rounded px-1.5 text-[10.5px] uppercase tracking-wide bg-white/[0.08] text-[#a89a80]">
            {status}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono">
          <span className="text-[#7fd49a]">+{file.additions}</span>{" "}
          <span className="text-[#f08a8a]">−{file.deletions}</span>
        </span>
      </header>
      {file.status === "binary" ? (
        <div className="px-3 py-2 text-[12px] text-[#a89a80]">Binary file, no text changes shown.</div>
      ) : file.hunks.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-[#a89a80]">No content changes.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[12px] leading-5">
            <tbody>
              {file.hunks.map((h, hi) => (
                <Fragment key={hi}>
                  <tr className="bg-[hsla(var(--pv-id-hue,220),40%,45%,0.16)] text-[#a89a80]">
                    <td colSpan={4} className="px-3 py-0.5 whitespace-pre">
                      {h.header}
                    </td>
                  </tr>
                  {layout === "split" ? <SplitHunkRows hunk={h} /> : <UnifiedHunkRows hunk={h} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const ROW_BG: Record<DiffLine["kind"], string> = {
  add: "bg-[hsla(140,55%,40%,0.20)]",
  del: "bg-[hsla(0,65%,45%,0.20)]",
  ctx: "",
  note: "",
};
const MARK: Record<DiffLine["kind"], string> = { add: "+", del: "-", ctx: " ", note: "" };
const NUM = "w-[1%] px-2 text-right select-none text-[#a89a80]/70 align-top";

function UnifiedHunkRows({ hunk }: { hunk: DiffHunk }): JSX.Element {
  return (
    <>
      {hunk.lines.map((l, i) =>
        l.kind === "note" ? (
          <tr key={i}>
            <td colSpan={4} className="px-3 text-[11px] italic text-[#a89a80]">
              {l.text}
            </td>
          </tr>
        ) : (
          <tr key={i} className={ROW_BG[l.kind]} data-diff-line={l.kind}>
            <td className={NUM}>{l.oldNo ?? ""}</td>
            <td className={NUM}>{l.newNo ?? ""}</td>
            <td className="w-[1%] select-none text-[#a89a80] align-top">{MARK[l.kind]}</td>
            <td className="pr-3 whitespace-pre text-[#e8e4d8]">{l.text}</td>
          </tr>
        ),
      )}
    </>
  );
}

function SplitHunkRows({ hunk }: { hunk: DiffHunk }): JSX.Element {
  const rows = toSplitRows(hunk);
  const cell = (l: DiffLine | null, side: "left" | "right") => {
    const no = l ? (side === "left" ? l.oldNo : l.newNo) : null;
    const bg = l && l.kind !== "ctx" ? ROW_BG[l.kind] : l ? "" : "bg-black/20";
    return (
      <>
        <td className={cn(NUM, bg)}>{no ?? ""}</td>
        <td
          className={cn(
            "w-1/2 pr-3 whitespace-pre-wrap break-all text-[#e8e4d8] align-top",
            side === "left" && "border-r border-white/10",
            bg,
          )}
          data-diff-line={l?.kind ?? "empty"}
        >
          {l?.text ?? ""}
        </td>
      </>
    );
  };
  return (
    <>
      {rows.map((r, i) =>
        r.left?.kind === "note" ? (
          <tr key={i}>
            <td colSpan={4} className="px-3 text-[11px] italic text-[#a89a80]">
              {r.left.text}
            </td>
          </tr>
        ) : (
          <tr key={i}>
            {cell(r.left, "left")}
            {cell(r.right, "right")}
          </tr>
        ),
      )}
    </>
  );
}

export function UnifiedDiffMode({ content }: FileModeViewProps): JSX.Element {
  return <DiffView content={content} layout="unified" />;
}

export function SplitDiffMode({ content }: FileModeViewProps): JSX.Element {
  return <DiffView content={content} layout="split" />;
}
