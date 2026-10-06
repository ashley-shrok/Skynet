import { useEffect, useState } from "react";
import { Database, Table2 } from "lucide-react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { extensionOf } from "../registry-ext";

/**
 * Chat-chip previews for data files. SQLite: table names and row counts
 * (files up to PREVIEW_MAX_BYTES). Parquet: row/column counts and column
 * names from the footer alone. Arrow: the same, for files up to the cap.
 */

const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

interface Summary {
  headline: string;
  items: { name: string; detail?: string }[];
  more: number;
}

const MAX_ITEMS = 6;

function useSummary(url: string, visible: boolean, load: () => Promise<Summary>, onError: () => void): Summary | null {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    load().then(
      (s) => !cancelled && setSummary(s),
      () => !cancelled && onError(),
    );
    return () => {
      cancelled = true;
    };
    // onError / load are fresh closures each render; the work depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);
  return summary;
}

function SummaryCard({ summary, icon }: { summary: Summary | null; icon: JSX.Element }): JSX.Element {
  if (!summary) return <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading…</div>;
  return (
    <div className="px-2.5 py-2 text-[11.5px] leading-[1.45] text-[#cfc8b8]">
      <div className="mb-1 flex items-center gap-1.5 text-[#e8e4d8]">
        {icon}
        {summary.headline}
      </div>
      <ul>
        {summary.items.map((it) => (
          <li key={it.name} className="flex gap-2">
            <span className="min-w-0 flex-1 truncate font-mono">{it.name}</span>
            {it.detail ? <span className="text-[#7d725f]">{it.detail}</span> : null}
          </li>
        ))}
      </ul>
      {summary.more > 0 ? <div className="text-[#7d725f]">+{summary.more} more</div> : null}
    </div>
  );
}

async function fetchCapped(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("too large");
  return bytes;
}

export function SqliteChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const summary = useSummary(
    url,
    visible,
    async () => {
      const bytes = await fetchCapped(url);
      const [{ isSqliteFile, withoutWalFlag }, { SqliteClient }] = await Promise.all([
        import("./sqlite/sqlite-header"),
        import("./sqlite/sqlite-client"),
      ]);
      if (!isSqliteFile(bytes)) throw new Error("not sqlite");
      const { client, tables } = await SqliteClient.open(withoutWalFlag(bytes));
      client.close();
      const shown = tables.filter((t) => t.kind === "table");
      const views = tables.length - shown.length;
      return {
        headline: `${shown.length} table${shown.length === 1 ? "" : "s"}${views ? ` · ${views} view${views === 1 ? "" : "s"}` : ""}`,
        items: shown.slice(0, MAX_ITEMS).map((t) => ({
          name: t.name,
          detail: t.rowCount === null ? undefined : `${t.rowCount.toLocaleString()} rows`,
        })),
        more: Math.max(0, shown.length - MAX_ITEMS),
      };
    },
    onError,
  );
  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="sqlite-chip-preview">
      <SummaryCard summary={summary} icon={<Database size={12} aria-hidden />} />
    </div>
  );
}

export function ColumnarChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const summary = useSummary(
    url,
    visible,
    async () => {
      const { openArrow, openParquet } = await import("./columnar/columnar-source");
      const file = extensionOf(filename) === "parquet" ? await openParquet(url) : await openArrow(url, PREVIEW_MAX_BYTES);
      return {
        headline: `${file.rowCount.toLocaleString()} rows · ${file.columns.length} columns`,
        items: file.columns.slice(0, MAX_ITEMS).map((c) => ({ name: c.name, detail: c.type })),
        more: Math.max(0, file.columns.length - MAX_ITEMS),
      };
    },
    onError,
  );
  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="columnar-chip-preview">
      <SummaryCard summary={summary} icon={<Table2 size={12} aria-hidden />} />
    </div>
  );
}
